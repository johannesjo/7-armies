import { Graphics } from 'pixi.js';
import { mixColor } from '../charge/view';
import { mulberry32 } from '../charge/sim';

/**
 * Towers and keeps for the lanes mode, drawn in vector at their base point (0, 0).
 * `upright` is the painted three-quarter view (Classic RTS): walls rise up the screen.
 * Otherwise they're seen from above (ink and the flat styles). `hurt` 0..3 adds cracks,
 * scorching, lost merlons and finally a broken roof.
 */
export interface CastleLook {
  /** Team colour, its dark shade and a pale trim. */
  team: number;
  teamDark: number;
  trim: number;
  /** Ink & watercolour: outlines and washes instead of solid paint. */
  ink: boolean;
  /** Seeds the stonework so each tower is a little different. */
  seed: number;
}

const STONE = 0xb4ab98;
const STONE_DARK = 0x6e6656;
const MORTAR = 0x5a5246;
const WOOD = 0x5a3c22;
const IRON = 0x2a2a2e;
const SLIT = 0x1c1610;
const INK = 0x2a2018;

/** Light on the left (the sun), shade on the right: how bright a round wall is across its width. */
function roundLight(t: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(t - 0.3) * 1.35));
}

/** Fill style: solid paint, or a translucent wash for ink. */
function paint(look: CastleLook, color: number, alpha = 1) {
  return look.ink ? { color, alpha: 0.42 * alpha } : { color, alpha };
}

function outline(look: CastleLook, width = 1) {
  return look.ink ? { width: width * 1.1, color: INK, alpha: 0.85 } : { width: width * 0.7, color: mixColor(STONE_DARK, 0x000000, 0.35), alpha: 0.7 };
}

/**
 * A round stone wall from `y0` (bottom) up to `y1`, half-width `w`: shaded strips for
 * the curve, courses of stone bowed round it, and staggered joints.
 */
function roundWall(g: Graphics, look: CastleLook, w: number, y0: number, y1: number, rand: () => number, stone = STONE): void {
  const strips = look.ink ? 4 : 12;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips, t1 = (i + 1) / strips;
    const light = roundLight((t0 + t1) / 2);
    const c = mixColor(mixColor(stone, STONE_DARK, 0.75), mixColor(stone, 0xfff4dc, 0.25), light);
    g.rect(-w + t0 * 2 * w, y1, (t1 - t0) * 2 * w + 0.4, y0 - y1).fill(paint(look, c));
  }
  // Bottom curve (the wall is round).
  g.ellipse(0, y0, w, w * 0.32).fill(paint(look, mixColor(stone, STONE_DARK, 0.4)));
  const course = 7;
  let row = 0;
  for (let y = y0 - course; y > y1 + 2; y -= course, row++) {
    const bow = w * 0.3;
    g.moveTo(-w, y).quadraticCurveTo(0, y + bow, w, y).stroke({ width: 0.6, color: look.ink ? INK : MORTAR, alpha: look.ink ? 0.35 : 0.45 });
    // Joints: staggered every other course, bunching toward the edges as the wall turns away.
    const n = 5;
    for (let k = 0; k < n; k++) {
      const u = -1 + (2 * (k + (row % 2 ? 0.5 : 0) + 0.5)) / (n + 0.5);
      if (u <= -0.95 || u >= 0.95) continue;
      const x = Math.sin(u * Math.PI / 2) * w;
      const yy = y + bow * (1 - (x / w) ** 2) * 0.5;
      g.moveTo(x, yy).lineTo(x, yy - course + 1).stroke({ width: 0.5, color: look.ink ? INK : MORTAR, alpha: look.ink ? 0.25 : 0.35 });
    }
    // A few stones a shade lighter or darker.
    if (!look.ink && rand() < 0.8) {
      const x = (rand() * 1.6 - 0.8) * w;
      g.rect(x - 3, y - course + 1.5, 6, course - 2).fill({ color: rand() < 0.5 ? 0xffffff : 0x000000, alpha: 0.07 });
    }
  }
  g.rect(-w, y1, w * 2, y0 - y1).stroke(outline(look, 0.8));
}

/** A conical roof on a round tower, base half-width `w` at height `y`, tiled in the team colour. */
function coneRoof(g: Graphics, look: CastleLook, w: number, y: number, h: number, broken: boolean): void {
  const tile = mixColor(look.team, 0x2a1a10, 0.25);
  const peakY = y - h;
  if (broken) {
    // Burnt through: a ragged stub of rafters.
    g.poly([-w, y, -w * 0.5, y - h * 0.4, -w * 0.15, y - h * 0.25, w * 0.2, y - h * 0.5, w * 0.55, y - h * 0.3, w, y]).fill(paint(look, mixColor(tile, 0x1a1008, 0.55)));
    for (const x of [-0.4, -0.05, 0.3]) g.moveTo(x * w, y).lineTo(x * w * 0.6, y - h * 0.55).stroke({ width: 1.2, color: 0x2a1a0e });
    return;
  }
  // Two halves: lit and shaded.
  g.poly([-w, y, 0, peakY, w * 0.15, y + 2]).fill(paint(look, mixColor(tile, 0xffffff, 0.18)));
  g.poly([w * 0.15, y + 2, 0, peakY, w, y]).fill(paint(look, mixColor(tile, 0x000000, 0.25)));
  // Rows of tiles following the cone.
  for (let k = 1; k < 5; k++) {
    const f = k / 5, yy = y - h * f, ww = w * (1 - f);
    g.moveTo(-ww, yy).quadraticCurveTo(0, yy + ww * 0.35, ww, yy).stroke({ width: 0.6, color: mixColor(tile, 0x000000, 0.45), alpha: 0.55 });
  }
  g.moveTo(-w, y).quadraticCurveTo(0, y + w * 0.35, w, y).stroke({ width: 1.2, color: mixColor(tile, 0x000000, 0.5), alpha: 0.8 });
  g.poly([-w, y, 0, peakY, w, y]).stroke(outline(look, 0.8));
  // Finial.
  g.circle(0, peakY - 1, 1.6).fill(paint(look, 0xd8b050));
}

/** A swallowtail pennant on a pole, streaming to the right. */
function pennant(g: Graphics, look: CastleLook, x: number, y: number, pole: number, size: number): void {
  g.moveTo(x, y).lineTo(x, y - pole).stroke({ width: 1.3, color: look.ink ? INK : 0x3a2a1a });
  const top = y - pole, s = size;
  g.poly([x, top, x + s * 1.6, top + s * 0.25, x + s * 1.2, top + s * 0.55, x + s * 1.6, top + s * 0.85, x, top + s * 0.9])
    .fill(paint(look, look.team)).stroke({ width: 0.7, color: look.ink ? INK : look.teamDark, alpha: 0.8 });
  g.moveTo(x + 1, top + s * 0.45).lineTo(x + s * 1.1, top + s * 0.5).stroke({ width: 0.8, color: look.trim, alpha: 0.7 });
}

/** A hanging banner on a wall: team cloth with a pale chevron. */
function banner(g: Graphics, look: CastleLook, x: number, y: number, w: number, h: number): void {
  g.rect(x - w / 2 - 1, y - 1, w + 2, 2).fill(paint(look, WOOD));
  g.poly([x - w / 2, y, x + w / 2, y, x + w / 2, y + h, x, y + h - w * 0.4, x - w / 2, y + h]).fill(paint(look, look.team)).stroke({ width: 0.6, color: look.ink ? INK : look.teamDark, alpha: 0.8 });
  g.poly([x - w * 0.35, y + h * 0.35, x, y + h * 0.55, x + w * 0.35, y + h * 0.35, x + w * 0.35, y + h * 0.48, x, y + h * 0.68, x - w * 0.35, y + h * 0.48]).fill(paint(look, look.trim, 0.85));
}

/** Arched opening (window or gate), bottom centre at (x, y). */
function arch(g: Graphics, look: CastleLook, x: number, y: number, w: number, h: number, color = SLIT): void {
  g.moveTo(x - w / 2, y).lineTo(x - w / 2, y - h + w / 2).arc(x, y - h + w / 2, w / 2, Math.PI, 0).lineTo(x + w / 2, y).closePath().fill(paint(look, color));
  if (!look.ink) g.moveTo(x - w / 2 - 0.8, y - h + w / 2).arc(x, y - h + w / 2, w / 2 + 0.8, Math.PI, 0).stroke({ width: 1, color: mixColor(STONE, 0xffffff, 0.3), alpha: 0.6 });
}

/** Battlements: a band with merlons across the front. Lost merlons as the tower is battered. */
function battlements(g: Graphics, look: CastleLook, w: number, y: number, hurt: number, rand: () => number, round: boolean): void {
  const band = 7;
  const lite = mixColor(STONE, 0xfff4dc, 0.3), shade = mixColor(STONE, STONE_DARK, 0.55);
  // Corbels under the parapet.
  for (let x = -w + 2; x <= w - 2; x += 5) g.poly([x - 1.6, y + band, x + 1.6, y + band, x + 0.8, y + band + 3.5, x - 0.8, y + band + 3.5]).fill(paint(look, shade));
  g.rect(-w - 1, y, w * 2 + 2, band).fill(paint(look, round ? mixColor(lite, shade, 0.35) : lite)).stroke(outline(look, 0.7));
  if (round && !look.ink) g.rect(w * 0.25, y, w * 0.75 + 1, band).fill({ color: 0x000000, alpha: 0.15 });
  const merlons = Math.max(3, Math.round((w * 2) / 7));
  const mw = (w * 2 + 2) / (merlons * 2 - 1);
  for (let i = 0; i < merlons; i++) {
    if (hurt >= 2 && rand() < 0.15 * hurt) continue;
    const x = -w - 1 + i * mw * 2;
    const tone = round ? mixColor(lite, shade, 1 - roundLight((x + w) / (2 * w))) : lite;
    g.rect(x, y - 5, mw, 5).fill(paint(look, tone)).stroke(outline(look, 0.5));
  }
}

/** Cracks, soot and creeping damage on a wall face. */
function damage(g: Graphics, look: CastleLook, hurt: number, w: number, y0: number, y1: number, rand: () => number): void {
  if (hurt <= 0) return;
  // Hairline cracks that stay on the wall face.
  for (let i = 0; i < hurt * 2 + 1; i++) {
    let x = (rand() * 1.3 - 0.65) * w, y = y1 + (y0 - y1) * (0.08 + rand() * 0.6);
    g.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x = Math.max(-w * 0.85, Math.min(w * 0.85, x + (rand() - 0.5) * 4));
      y = Math.min(y0 - 2, y + 2 + rand() * 3);
      g.lineTo(x, y);
    }
    g.stroke({ width: 0.7, color: SLIT, alpha: 0.55 });
  }
  if (hurt >= 2 && !look.ink) {
    for (let i = 0; i < hurt; i++) {
      const x = (rand() * 1.2 - 0.6) * w, y = y1 + (y0 - y1) * rand() * 0.5;
      g.ellipse(x, y, 5 + rand() * 6, 7 + rand() * 6).fill({ color: 0x14100c, alpha: 0.22 });
    }
  }
}

/** A round wall tower seen in the three-quarter view: base at (0, 0). Returns its height. */
export function towerUpright(g: Graphics, look: CastleLook, r: number, hurt: number): number {
  const rand = mulberry32(look.seed);
  const w = r * 0.95, plinth = 10, h = 62;
  g.ellipse(r * 0.8, 3, r * 1.9, r * 0.6).fill({ color: 0x000000, alpha: look.ink ? 0.12 : 0.28 });
  // Battered base: wider where it meets the ground.
  g.poly([-w - 5, 0, w + 5, 0, w, -plinth, -w, -plinth]).fill(paint(look, mixColor(STONE, STONE_DARK, 0.35))).stroke(outline(look, 0.6));
  g.poly([w * 0.3, 0, w + 5, 0, w, -plinth, w * 0.3, -plinth]).fill({ color: 0x000000, alpha: look.ink ? 0.05 : 0.15 });
  roundWall(g, look, w, -plinth, -h, rand);
  // Moss creeping up the shaded foot.
  if (!look.ink) for (let i = 0; i < 6; i++) g.circle(w * (0.2 + rand() * 0.75), -plinth - rand() * 8, 1.5 + rand() * 2).fill({ color: 0x4a6a2a, alpha: 0.55 });
  // Door, windows, arrow slits.
  arch(g, look, -w * 0.25, -plinth, 8, 13, WOOD);
  if (!look.ink) for (const yy of [-plinth - 4, -plinth - 8]) g.moveTo(-w * 0.25 - 4, yy).lineTo(-w * 0.25 + 4, yy).stroke({ width: 0.8, color: IRON, alpha: 0.8 });
  arch(g, look, -w * 0.1, -h * 0.6, 4, 9);
  arch(g, look, w * 0.45, -h * 0.42, 2.5, 7);
  arch(g, look, -w * 0.62, -h * 0.82, 2.5, 6);
  damage(g, look, hurt, w, -plinth, -h, rand);
  battlements(g, look, w + 3, -h - 7, hurt, rand, true);
  const broken = hurt >= 3;
  coneRoof(g, look, w + 1, -h - 12, 30, broken);
  if (!broken) pennant(g, look, 0, -h - 43, 16, 9);
  return h + 12 + 30 + 18;
}

/** The keep: a great tower behind a curtain wall, corner towers and a gatehouse. Base at (0, 0). Returns its height. */
export function keepUpright(g: Graphics, look: CastleLook, R: number, hurt: number): number {
  const rand = mulberry32(look.seed);
  const w = R * 1.3, wallH = 40, plinth = 8;
  g.ellipse(R * 0.4, 6, w * 1.45, R * 0.7).fill({ color: 0x000000, alpha: look.ink ? 0.12 : 0.28 });
  // The great tower (donjon), rising behind the wall.
  const dw = 22, dh = 96;
  const dTop = -dh;
  g.rect(-dw, dTop, dw * 2, dh - wallH + 6).fill(paint(look, mixColor(STONE, 0xfff4dc, 0.12))).stroke(outline(look, 0.8));
  g.rect(dw * 0.35, dTop, dw * 0.65, dh - wallH + 6).fill({ color: 0x000000, alpha: look.ink ? 0.06 : 0.17 });
  for (let y = dTop + 8; y < -wallH; y += 8) g.moveTo(-dw, y).lineTo(dw, y).stroke({ width: 0.6, color: look.ink ? INK : MORTAR, alpha: look.ink ? 0.3 : 0.4 });
  arch(g, look, -8, dTop + 30, 5, 11);
  arch(g, look, 8, dTop + 30, 5, 11);
  arch(g, look, 0, dTop + 48, 4, 9);
  battlements(g, look, dw + 2, dTop - 7, hurt, rand, false);
  const broken = hurt >= 3;
  if (!broken) {
    // Hipped roof in the team colour.
    const tile = mixColor(look.team, 0x2a1a10, 0.25);
    g.poly([-dw + 2, dTop - 12, 0, dTop - 40, dw * 0.1, dTop - 12]).fill(paint(look, mixColor(tile, 0xffffff, 0.18)));
    g.poly([dw * 0.1, dTop - 12, 0, dTop - 40, dw - 2, dTop - 12]).fill(paint(look, mixColor(tile, 0x000000, 0.25)));
    for (let k = 1; k < 4; k++) { const yy = dTop - 12 - 7 * k, ww = (dw - 2) * (1 - k / 4); g.moveTo(-ww, yy).lineTo(ww, yy).stroke({ width: 0.6, color: mixColor(tile, 0x000000, 0.45), alpha: 0.5 }); }
    g.poly([-dw + 2, dTop - 12, 0, dTop - 40, dw - 2, dTop - 12]).stroke(outline(look, 0.8));
    pennant(g, look, 0, dTop - 40, 22, 12);
  } else {
    g.poly([-dw + 2, dTop - 12, -6, dTop - 22, 2, dTop - 16, 9, dTop - 26, dw - 2, dTop - 12]).fill(paint(look, 0x2a1a10));
  }
  // Curtain wall: battered plinth, coursed stone, banners, crenellations.
  g.poly([-w - 4, 0, w + 4, 0, w, -plinth, -w, -plinth]).fill(paint(look, mixColor(STONE, STONE_DARK, 0.35))).stroke(outline(look, 0.6));
  g.rect(-w, -wallH, w * 2, wallH - plinth).fill(paint(look, STONE)).stroke(outline(look, 0.8));
  g.rect(w * 0.35, -wallH, w * 0.65, wallH - plinth).fill({ color: 0x000000, alpha: look.ink ? 0.05 : 0.12 });
  for (let y = -plinth - 6, row = 0; y > -wallH + 2; y -= 6, row++) {
    g.moveTo(-w, y).lineTo(w, y).stroke({ width: 0.6, color: look.ink ? INK : MORTAR, alpha: look.ink ? 0.3 : 0.4 });
    for (let x = -w + (row % 2 ? 6 : 0); x < w; x += 12) g.moveTo(x, y).lineTo(x, y + 6).stroke({ width: 0.5, color: look.ink ? INK : MORTAR, alpha: look.ink ? 0.2 : 0.3 });
  }
  banner(g, look, -w * 0.55, -wallH + 6, 9, 20);
  banner(g, look, w * 0.55, -wallH + 6, 9, 20);
  damage(g, look, hurt, w, -plinth, -wallH, rand);
  battlements(g, look, w, -wallH - 7, hurt, rand, false);
  // Corner towers.
  // Corner towers, each drawn in place.
  for (const sx of [-1, 1]) {
    const tw = 13, th = 62;
    g.save().translateTransform(sx * w, 0);
    g.ellipse(0, 0, tw + 3, 4).fill({ color: 0x000000, alpha: 0.15 });
    roundWall(g, look, tw, -2, -th, rand);
    arch(g, look, 0, -th * 0.55, 3, 7);
    battlements(g, look, tw + 2, -th - 7, hurt, rand, true);
    coneRoof(g, look, tw, -th - 12, 22, hurt >= 3 && sx > 0);
    if (!(hurt >= 3 && sx > 0)) pennant(g, look, 0, -th - 34, 10, 6);
    g.restore();
  }
  // Gatehouse: two drum towers and an arched gate with its portcullis half raised.
  for (const sx of [-1, 1]) {
    g.save().translateTransform(sx * 17, 0);
    roundWall(g, look, 9, -1, -50, rand);
    arch(g, look, 0, -32, 2.5, 6);
    battlements(g, look, 10, -57, hurt, rand, true);
    g.restore();
  }
  arch(g, look, 0, 0, 16, 26, 0x241a10);
  for (let x = -6; x <= 6; x += 3) g.moveTo(x, -26 + 8).lineTo(x, -9).stroke({ width: 0.9, color: IRON, alpha: 0.9 });
  for (let y = -16; y >= -24; y -= 4) g.moveTo(-7, y).lineTo(7, y).stroke({ width: 0.8, color: IRON, alpha: 0.9 });
  g.rect(-9, -30, 18, 4).fill(paint(look, mixColor(STONE, 0xfff4dc, 0.2))).stroke(outline(look, 0.6));
  return dh + 40 + 22;
}

/** A round tower seen from above: shadow, crenellated wall-walk and a conical team roof. */
export function towerTop(g: Graphics, look: CastleLook, r: number, hurt: number): void {
  const rand = mulberry32(look.seed);
  g.circle(4, 5, r + 3).fill({ color: 0x000000, alpha: look.ink ? 0.1 : 0.28 });
  g.circle(0, 0, r).fill(paint(look, STONE)).stroke(outline(look, 1.2));
  const merlons = 12;
  for (let i = 0; i < merlons; i++) {
    if (hurt >= 2 && rand() < 0.15 * hurt) continue;
    const a = (i / merlons) * Math.PI * 2;
    g.rect(Math.cos(a) * (r - 2.5) - 2, Math.sin(a) * (r - 2.5) - 2, 4, 4).fill(paint(look, mixColor(STONE, 0xfff4dc, 0.3))).stroke(outline(look, 0.5));
  }
  const rr = r * 0.66;
  if (hurt >= 3) {
    g.circle(0, 0, rr).fill(paint(look, 0x2a1a10));
  } else {
    // The cone from above: a lit wedge toward the sun, shaded away from it.
    const tile = mixColor(look.team, 0x2a1a10, 0.2);
    g.circle(0, 0, rr).fill(paint(look, mixColor(tile, 0x000000, 0.2)));
    g.moveTo(0, 0).arc(0, 0, rr, Math.PI * 0.8, Math.PI * 1.75).closePath().fill(paint(look, mixColor(tile, 0xffffff, 0.2)));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.moveTo(0, 0).lineTo(Math.cos(a) * rr, Math.sin(a) * rr).stroke({ width: 0.6, color: mixColor(tile, 0x000000, 0.4), alpha: 0.6 });
    }
    g.circle(0, 0, rr).stroke(outline(look, 0.8));
    g.circle(0, 0, 1.8).fill(paint(look, 0xd8b050));
  }
  if (hurt > 0) for (let i = 0; i < hurt * 2; i++) {
    const a = rand() * Math.PI * 2;
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r).lineTo(Math.cos(a) * (r - 5 - rand() * 4), Math.sin(a) * (r - 5 - rand() * 4)).stroke({ width: 1, color: SLIT, alpha: 0.7 });
  }
}

/** The keep from above: curtain wall round a courtyard, corner towers, the gate toward the enemy, the great tower. */
export function keepTop(g: Graphics, look: CastleLook, R: number, hurt: number, gateDir: number): void {
  const rand = mulberry32(look.seed);
  g.rect(-R + 5, -R + 6, R * 2, R * 2).fill({ color: 0x000000, alpha: look.ink ? 0.1 : 0.28 });
  g.rect(-R, -R, R * 2, R * 2).fill(paint(look, mixColor(STONE, 0x8a7a5a, 0.4))).stroke(outline(look, 1.2));
  // Wall-walk round the inside, the courtyard beyond.
  g.rect(-R + 7, -R + 7, R * 2 - 14, R * 2 - 14).fill(paint(look, mixColor(0x9a8a62, 0x6a7a3a, 0.3))).stroke(outline(look, 0.8));
  for (let i = -R + 3; i < R - 2; i += 6) {
    for (const [x, y] of [[i, -R + 1.5], [i, R - 4.5], [-R + 1.5, i], [R - 4.5, i]]) {
      if (hurt >= 2 && rand() < 0.12 * hurt) continue;
      g.rect(x, y, 3, 3).fill(paint(look, mixColor(STONE, 0xfff4dc, 0.3)));
    }
  }
  // The gate, facing the enemy.
  g.rect(gateDir * (R - 4) - 5, -9, 10, 18).fill(paint(look, 0x3a2a18)).stroke(outline(look, 0.7));
  // Great tower in the middle with a hipped roof.
  const d = R * 0.5;
  if (hurt >= 3) {
    g.rect(-d, -d, d * 2, d * 2).fill(paint(look, 0x2a1a10)).stroke(outline(look, 0.9));
  } else {
    const tile = mixColor(look.team, 0x2a1a10, 0.2);
    g.poly([-d, -d, d, -d, 0, 0]).fill(paint(look, mixColor(tile, 0xffffff, 0.2)));
    g.poly([-d, -d, -d, d, 0, 0]).fill(paint(look, mixColor(tile, 0xffffff, 0.08)));
    g.poly([d, -d, d, d, 0, 0]).fill(paint(look, mixColor(tile, 0x000000, 0.2)));
    g.poly([-d, d, d, d, 0, 0]).fill(paint(look, mixColor(tile, 0x000000, 0.32)));
    g.rect(-d, -d, d * 2, d * 2).stroke(outline(look, 0.9));
    g.moveTo(-d, -d).lineTo(d, d).moveTo(d, -d).lineTo(-d, d).stroke({ width: 0.7, color: mixColor(tile, 0x000000, 0.5), alpha: 0.6 });
  }
  // Corner towers.
  for (const [cx, cy] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
    g.save().translateTransform(cx, cy);
    towerTop(g, { ...look, seed: look.seed + cx * 3 + cy }, R * 0.34, hurt);
    g.restore();
  }
}

/** What's left of a tower: a broken stump in a spill of stone, the banner fallen across it. */
export function rubble(g: Graphics, look: CastleLook, r: number, upright: boolean): void {
  const rand = mulberry32(look.seed);
  const R = r * 1.6;
  g.ellipse(0, 0, R * 1.3, R * 0.65).fill({ color: 0x000000, alpha: look.ink ? 0.1 : 0.22 });
  if (upright) {
    // The stump: a short, ragged ring of wall, blackened inside.
    const w = r * 0.9, h = 16;
    g.rect(-w, -h, w * 2, h).fill(paint(look, mixColor(STONE, STONE_DARK, 0.3)));
    g.rect(w * 0.3, -h, w * 0.7, h).fill({ color: 0x000000, alpha: 0.15 });
    const pts: number[] = [-w, -h];
    for (let x = -w; x <= w; x += w / 4) pts.push(x, -h - 2 - rand() * 12);
    pts.push(w, -h);
    g.poly(pts).fill(paint(look, mixColor(STONE, STONE_DARK, 0.2))).stroke(outline(look, 0.7));
    g.ellipse(0, -h, w * 0.75, w * 0.25).fill(paint(look, 0x1a120c));
  }
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R;
    const s = 1.8 + rand() * 3.6;
    const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.55;
    g.poly([x - s, y, x - s * 0.4, y - s * 0.8, x + s * 0.7, y - s * 0.6, x + s, y + s * 0.2, x, y + s * 0.4])
      .fill(paint(look, mixColor(STONE, STONE_DARK, rand() * 0.6))).stroke(outline(look, 0.35));
  }
  // The fallen banner and a broken roof beam.
  g.moveTo(-R * 0.8, R * 0.2).lineTo(R * 0.1, -R * 0.05).stroke({ width: 1.4, color: look.ink ? INK : 0x3a2a1a });
  g.poly([R * 0.1, -R * 0.05, R * 0.6, R * 0.05, R * 0.45, R * 0.18, R * 0.62, R * 0.32, R * 0.08, R * 0.2]).fill(paint(look, look.team, 0.8));
  g.moveTo(-R * 0.2, -R * 0.3).lineTo(R * 0.7, R * 0.12).stroke({ width: 2.2, color: 0x2a1a0e, alpha: 0.85 });
}
