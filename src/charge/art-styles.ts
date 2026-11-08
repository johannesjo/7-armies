import { Graphics, GraphicsContext } from 'pixi.js';
import { Team, UnitType } from '../types';
import { ArtStyle, Theme } from '../theme';
import { drawUnitArt, HORSE_VARIANTS } from '../unit-art';
import { fbm } from '../ground';

type Canvas = Graphics | GraphicsContext;

/**
 * Prototype art styles for the cavalry mode (pick one from the Style menu):
 * - classic: the current look.
 * - mini: painted tabletop miniatures on bases, felt table, toy-like motion.
 * - ink: ink and watercolour on paper, line boil, brush-stroke trails.
 * - rts: upright three-quarter-view figures in the classic painted-RTS manner. Those are
 *   posed and baked per facing and frame (see figure-art.ts), not drawn here.
 */
export type { ArtStyle };

type FlatStyle = 'mini' | 'ink';

const HORSES: Record<FlatStyle, [number, number][]> = {
  mini: [[0x6a4a32, 0x2a1c12], [0x9a7a54, 0x4a3828], [0xb8b2a6, 0x6a645c], [0x3a302a, 0x161210]],
  ink: [[0x8a6a4a, 0x3a2a1a], [0xa08868, 0x4a3a2a], [0xb0a898, 0x5a5448], [0x5a4a3a, 0x2a2018]],
};

function horse(style: FlatStyle, variant: number): [number, number] {
  const list = HORSES[style];
  return list[((variant % HORSE_VARIANTS) + HORSE_VARIANTS) % HORSE_VARIANTS % list.length];
}

function darken(c: number, k: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v: number) => Math.round(v * (1 - k));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** Draw a unit in the given style. Local +X is the facing, +Y the unit's right. */
export function drawStyledUnit(style: ArtStyle, shape: Canvas, weapon: Canvas, type: UnitType, team: Team, r: number, theme: Theme, variant = 0): void {
  if (style === 'mini') drawMini(shape, weapon, type, team, r, theme, variant);
  else if (style === 'ink') drawInk(shape, weapon, type, team, r, theme, variant);
  else drawUnitArt(shape, weapon, type, team, r, theme, variant);
}

// --- Living miniatures -------------------------------------------------------------------

/** A painted metal figure on a bevelled base, lit from the top left. */
function drawMini(shape: Canvas, weapon: Canvas, type: UnitType, team: Team, r: number, theme: Theme, variant: number): void {
  const color = team === 'blue' ? theme.blue : theme.red;
  const dark = team === 'blue' ? theme.blueDark : theme.redDark;
  const gloss = { color: 0xffffff, alpha: 0.45 };
  const cav = type === 'cavalry';
  // Base: drop shadow, dark rim, flocked top, a lit bevel on the top-left edges and
  // a pale front edge so you can always tell which way the figure faces.
  const bw = cav ? r * 3.5 : r * 1.95, bh = cav ? r * 1.45 : r * 1.95;
  const bx = -bw / 2 - (cav ? r * 0.15 : 0), by = -bh / 2;
  shape.roundRect(bx + r * 0.3, by + r * 0.4, bw, bh, r * 0.25).fill({ color: 0x000000, alpha: 0.3 });
  shape.roundRect(bx, by, bw, bh, r * 0.25).fill(0x3a3a2c);
  shape.roundRect(bx + r * 0.1, by + r * 0.1, bw - r * 0.2, bh - r * 0.2, r * 0.18).fill(0x5d7d3e);
  shape.moveTo(bx + r * 0.2, by + bh - r * 0.2).lineTo(bx + r * 0.2, by + r * 0.2).lineTo(bx + bw - r * 0.2, by + r * 0.2)
    .stroke({ width: Math.max(0.4, r * 0.1), color: 0x8aa860, alpha: 0.7 });
  shape.moveTo(bx + bw - r * 0.08, by + r * 0.3).lineTo(bx + bw - r * 0.08, by + bh - r * 0.3)
    .stroke({ width: Math.max(0.5, r * 0.14), color: 0xd8d0b0, alpha: 0.85 });

  if (cav) {
    const [coat, mane] = horse('mini', variant);
    shape.poly([-r * 1.05, -r * 0.13, -r * 1.7, -r * 0.05, -r * 1.7, r * 0.05, -r * 1.05, r * 0.13]).fill(mane);
    shape.ellipse(-r * 0.1, 0, r * 1.1, r * 0.48).fill(coat).stroke({ width: 0.6, color: darken(coat, 0.45) });
    shape.ellipse(r * 1.0, 0, r * 0.4, r * 0.24).fill(coat);
    shape.ellipse(r * 1.4, 0, r * 0.3, r * 0.19).fill(coat).stroke({ width: 0.5, color: darken(coat, 0.45) });
    shape.ellipse(-r * 0.35, -r * 0.2, r * 0.55, r * 0.14).fill({ color: 0xffffff, alpha: 0.28 });
    shape.moveTo(r * 0.55, 0).lineTo(r * 1.15, 0).stroke({ width: Math.max(0.6, r * 0.15), color: mane });
    shape.roundRect(-r * 0.85, -r * 0.55, r * 1.2, r * 1.1, r * 0.25).fill(color).stroke({ width: 0.6, color: dark });
    shape.ellipse(-r * 0.12, 0, r * 0.28, r * 0.47).fill(color).stroke({ width: 0.5, color: dark });
    shape.circle(-r * 0.08, 0, r * 0.24).fill(theme.steel).stroke({ width: 0.4, color: theme.steelDark });
    shape.circle(-r * 0.16, -r * 0.1, r * 0.08).fill(gloss);
    shape.ellipse(-r * 0.3, -r * 0.28, r * 0.25, r * 0.08).fill({ color: 0xffffff, alpha: 0.35 });
    weapon.moveTo(-r * 0.7, r * 0.38).lineTo(r * 2.25, r * 0.38).stroke({ width: Math.max(0.8, r * 0.15), color: theme.wood });
    weapon.poly([r * 2.25, r * 0.26, r * 2.7, r * 0.38, r * 2.25, r * 0.5]).fill(theme.steel);
    weapon.poly([r * 1.7, r * 0.38, r * 2.1, r * 0.38, r * 1.88, r * 0.7]).fill(color);
    return;
  }
  // Infantry: enamel-bright tunic with a gloss highlight, steel helmet catching the light.
  shape.ellipse(0, 0, r * 0.62, r * 1.05).fill(color).stroke({ width: 0.7, color: dark });
  shape.ellipse(-r * 0.15, -r * 0.42, r * 0.28, r * 0.4).fill({ color: 0xffffff, alpha: 0.22 });
  if (type === 'swordsman') {
    shape.circle(r * 0.4, -r * 0.82, r * 0.55).fill(color).stroke({ width: 0.8, color: theme.trim });
    shape.circle(r * 0.4, -r * 0.82, r * 0.16).fill(theme.steel);
    shape.circle(r * 0.28, -r * 0.95, r * 0.12).fill(gloss);
  } else if (type === 'archer') {
    shape.roundRect(-r * 0.95, r * 0.05, r * 0.7, r * 0.42, r * 0.15).fill(theme.leather);
  }
  const helm = type === 'archer' ? dark : theme.steel;
  shape.circle(r * 0.05, 0, r * (type === 'pikeman' ? 0.58 : 0.42)).fill(helm).stroke({ width: 0.5, color: theme.steelDark });
  shape.circle(-r * 0.08, -r * 0.13, r * 0.13).fill(gloss);
  if (type === 'pikeman') {
    const len = r * 3.4;
    weapon.moveTo(-r * 1.1, r * 0.35).lineTo(len, r * 0.35).stroke({ width: Math.max(0.8, r * 0.2), color: theme.wood });
    weapon.poly([len, r * 0.13, len + r * 0.8, r * 0.35, len, r * 0.57]).fill(theme.steel);
  } else if (type === 'archer') {
    weapon.arc(0, 0, r * 1.6, -0.95, 0.95).stroke({ width: Math.max(0.9, r * 0.3), color: theme.wood });
  } else {
    const y = r * 0.72;
    weapon.moveTo(r * 0.5, y).lineTo(r * 1.8, y).stroke({ width: Math.max(0.8, r * 0.22), color: theme.steel });
    weapon.moveTo(r * 0.55, y - r * 0.05).lineTo(r * 1.6, y - r * 0.05).stroke({ width: 0.35, color: 0xffffff, alpha: 0.7 });
    weapon.moveTo(r * 0.5, y - r * 0.32).lineTo(r * 0.5, y + r * 0.32).stroke({ width: Math.max(0.6, r * 0.15), color: 0xc9a227 });
  }
}

// --- Ink & watercolour -------------------------------------------------------------------

const INK = 0x2a2018;

/** A loose watercolour wash, slightly off-register, under a confident ink outline. */
function drawInk(shape: Canvas, weapon: Canvas, type: UnitType, team: Team, r: number, theme: Theme, variant: number): void {
  const color = team === 'blue' ? theme.blue : theme.red;
  const wash = { color, alpha: 0.5 };
  const line = { width: Math.max(0.55, r * 0.13), color: INK, alpha: 0.9, cap: 'round' as const, join: 'round' as const };
  const ox = r * 0.18, oy = -r * 0.14; // the wash misses the outline a little
  if (type === 'cavalry') {
    const [coat] = horse('ink', variant);
    shape.ellipse(-r * 0.1 + ox, oy, r * 1.25, r * 0.6).fill({ color: coat, alpha: 0.4 });
    shape.ellipse(-r * 0.25 + ox, oy, r * 0.65, r * 0.62).fill(wash);
    shape.ellipse(-r * 0.12, 0, r * 1.1, r * 0.48).stroke(line);
    shape.moveTo(r * 0.85, -r * 0.18).quadraticCurveTo(r * 1.6, -r * 0.2, r * 1.7, 0).quadraticCurveTo(r * 1.6, r * 0.2, r * 0.85, r * 0.18).stroke(line);
    shape.moveTo(-r * 1.15, 0).lineTo(-r * 1.8, r * 0.12).stroke(line);
    shape.circle(-r * 0.1, 0, r * 0.26).fill({ color: INK, alpha: 0.85 });
    weapon.moveTo(-r * 0.6, r * 0.4).lineTo(r * 2.6, r * 0.36).stroke({ ...line, width: Math.max(0.5, r * 0.1) });
    weapon.poly([r * 1.75, r * 0.37, r * 2.1, r * 0.37, r * 1.9, r * 0.7]).fill({ color, alpha: 0.75 });
    return;
  }
  shape.ellipse(ox, oy, r * 0.85, r * 1.2).fill(wash);
  shape.ellipse(0, 0, r * 0.6, r * 1.02).stroke(line);
  shape.circle(r * 0.05, 0, r * (type === 'pikeman' ? 0.48 : 0.36)).fill({ color: INK, alpha: 0.85 });
  // A short stroke out of the front shows which way he faces.
  shape.moveTo(r * 0.45, 0).lineTo(r * 0.9, 0).stroke(line);
  if (type === 'swordsman') shape.arc(r * 0.4, -r * 0.82, r * 0.5, -Math.PI * 0.9, Math.PI * 0.4).stroke(line);
  if (type === 'pikeman') {
    weapon.moveTo(-r * 1.1, r * 0.35).lineTo(r * 4.1, r * 0.32).stroke({ ...line, width: Math.max(0.5, r * 0.11) });
  } else if (type === 'archer') {
    weapon.arc(0, 0, r * 1.55, -0.95, 0.95).stroke(line);
  } else {
    weapon.moveTo(r * 0.5, r * 0.72).lineTo(r * 1.8, r * 0.7).stroke(line);
    weapon.moveTo(r * 0.5, r * 0.42).lineTo(r * 0.5, r * 1.02).stroke({ ...line, width: Math.max(0.45, r * 0.09) });
  }
}

// --- Ground ----------------------------------------------------------------------------

const tiles = new Map<string, HTMLCanvasElement>();

/** Wargames felt: fine fibre noise over gentle mottling. Tiles seamlessly. */
export function paintFeltTile(theme: Theme, size = 512): HTMLCanvasElement {
  const key = `felt:${theme.grassDark}:${size}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const n = fbm(17, 4);
  const [r0, g0, b0] = [(theme.grassDark >> 16) & 255, (theme.grassDark >> 8) & 255, theme.grassDark & 255];
  const [r1, g1, b1] = [(theme.grassLight >> 16) & 255, (theme.grassLight >> 8) & 255, theme.grassLight & 255];
  let seed = 99;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Periodic noise so the tile repeats without seams.
      const u = x / size, v = y / size;
      const m = n(Math.cos(u * Math.PI * 2) * 2 + 5, Math.sin(v * Math.PI * 2) * 2 + Math.sin(u * Math.PI * 2) * 2);
      const t = Math.min(1, Math.max(0, (m - 0.3) * 1.6));
      const fibre = (rnd() - 0.5) * 18;
      const i = (y * size + x) * 4;
      img.data[i] = r0 + (r1 - r0) * t + fibre;
      img.data[i + 1] = g0 + (g1 - g0) * t + fibre;
      img.data[i + 2] = b0 + (b1 - b0) * t + fibre * 0.8;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tiles.set(key, cv);
  return cv;
}

/** Cold-pressed watercolour paper: warm off-white, soft blotches and fibres. */
export function paintPaperTile(theme: Theme, size = 512): HTMLCanvasElement {
  const key = `paper:${theme.bg}:${size}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const n = fbm(5, 5);
  const [r0, g0, b0] = [(theme.bg >> 16) & 255, (theme.bg >> 8) & 255, theme.bg & 255];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const m = n(Math.cos(u * Math.PI * 2) * 3 + 9, Math.sin(v * Math.PI * 2) * 3 + Math.sin(u * Math.PI * 2) * 3);
      const tooth = (rnd() - 0.5) * 10;
      const k = (m - 0.5) * 26 + tooth;
      const i = (y * size + x) * 4;
      img.data[i] = r0 + k;
      img.data[i + 1] = g0 + k;
      img.data[i + 2] = b0 + k * 1.1;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tiles.set(key, cv);
  return cv;
}
