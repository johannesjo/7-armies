import { Application, BitmapFont, BitmapText, CanvasSource, Container, Graphics, Rectangle, RenderTexture, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { paintGrassTile, paintGroundOverlay } from '../ground';
import { Team, UnitType, Vec2 } from '../types';
import { Theme } from '../theme';
import { drawUnitArt, HORSE_VARIANTS, attackPose, attackDuration } from '../unit-art';
import { CHARGE as C } from './config';
import { ArtStyle, drawStyledUnit, paintFeltTile, paintPaperTile } from './art-styles';
import { CORPSE_FRAME, FRAMES, DRAWN_DIRS, IDLE_FRAME, INFANTRY_LOOKS, WeaponSegment, attackFrame, buildFigure, canvasPainter, deathFrame, dirAngle, facingFrame, fleeFrame, paintLongWeapon, projectLocal, walkFrame } from './figure-art';
import { Battalion, ChargeSim, SimEvent, Soldier, Squadron, angleDiff, attackSide, mulberry32 } from './sim';
import { PathPoint } from './path';
import { DirectZones } from './direct';

interface UnitGfx {
  root: Container;
  body: Sprite;
  weapon: Sprite;
  pulse: number;
  fleeing: boolean;
  /** Current weapon turn toward the nearest enemy (eased). */
  aimRot: number;
  /** Frame on which this unit was last seen alive (avoids a Set per frame). */
  stamp: number;
  /** Last position and gait phase (advances with distance travelled), for walk/gallop motion. */
  px: number;
  py: number;
  phase: number;
  /** Upright figures: measured ground speed, and the frame sheet and frame on show. */
  speed: number;
  sheet: FigureSheet | null;
  frame: number;
  /** Last hoof fall stamped into the ground (gait quarter-cycles), for hoof prints. */
  hoofBeat: number | null;
}

/** Every facing and frame of one upright unit design: textures and their foot anchors. */
interface FigureSheet {
  frames: Texture[];
  ax: number[];
  ay: number[];
  /**
   * Levelled pikes and couched lances aren't in the frames: they're a sprite of their
   * own, turned to the unit's exact heading so they swing smoothly. Per frame (any
   * facing): the shaft in unit-local 3D, or null when nothing is carried detached.
   */
  weapons: (WeaponSegment | null)[];
  /** The weapon sprite's texture (drawn along +x from the butt) and its shaft length. */
  weaponTex: Texture | null;
  weaponLen: number;
  /** Where the butt sits in the weapon texture (its anchor). */
  weaponAnchor: { x: number; y: number };
}

/** Baked figure sheets live for the whole session: only the first battle pays to draw them. */
const figureSheets = new Map<string, FigureSheet>();

interface Dying {
  root: Container;
  vx: number;
  vy: number;
  spin: number;
  age: number;
  /** How high the body is thrown (0 = slumps, 1 = launched). */
  lift: number;
  /** Upright figures play their falling frames from this facing. */
  fig: { u: UnitGfx; dir: number } | null;
}

/** A charge connecting: slash, shockwave and (against pikes) sparks. */
interface ImpactFx {
  x: number;
  y: number;
  angle: number;
  age: number;
  strength: number;
  rear: boolean;
  pike: boolean;
}

const IMPACT_FX_LIFE = 0.26;
/** Enemy formations within this distance of your leader show their open sides. */
const EXPOSE_RANGE = 320;
const EXPOSE_RANGE_SQUAD = 240;
/** ...but only the one you are riding at: within this angle of the leader's heading. */
const EXPOSE_CONE = 0.6;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  grow: number;
  color: number;
  alpha: number;
  stain: boolean;
}

interface Popup {
  text: BitmapText;
  x: number;
  y: number;
  age: number;
  life: number;
}

const MAX_PARTICLES = 900;

const sharedTextures = new Map<HTMLCanvasElement, Texture>();
/** One long-lived texture per cached canvas (never destroyed, reused across battles). */
function sharedTexture(canvas: HTMLCanvasElement): Texture {
  let tex = sharedTextures.get(canvas);
  if (!tex) {
    tex = Texture.from(canvas);
    sharedTextures.set(canvas, tex);
  }
  return tex;
}

/**
 * Combat text uses a bitmap font: glyphs are rasterised once, so changing a popup's
 * text costs nothing (a canvas Text re-renders and re-uploads its texture each time).
 * White fill and a black outline, tinted per popup.
 */
const COMBAT_FONT = 'ChargeCombat';
let combatFontInstalled = false;
function ensureCombatFont(): void {
  if (combatFontInstalled) return;
  BitmapFont.install({
    name: COMBAT_FONT,
    style: { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: 40, fontWeight: '800', fill: 0xffffff, stroke: { color: 0x101408, width: 7 }, letterSpacing: 1 },
    chars: [['A', 'Z'], ['a', 'z'], ['0', '9'], ' !+×-·:'],
    resolution: 1,
    padding: 4,
  });
  combatFontInstalled = true;
}
const MAX_POPUPS = 14;

/** Linear blend between two 0xRRGGBB colors. */
export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** A rotated oval as polygon points (Pixi ellipses can't be rotated in place). */
function ovalPoints(x: number, y: number, rx: number, ry: number, angle: number): number[] {
  const c = Math.cos(angle), s = Math.sin(angle), pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
    pts.push(x + ex * c - ey * s, y + ex * s + ey * c);
  }
  return pts;
}

/**
 * A painted standard: a wooden staff with a gilt finial and a crossbar, from which a
 * swallow-tailed banner hangs in three folds that catch the light as it stirs.
 */
function paintStandard(g: Graphics, x: number, y: number, h: number, color: number, trim: number, wave: number, s = 1, gilt = false): void {
  const top = y - h;
  const bar = top + 1.6 * s, bw = 7.5 * s, len = 10 * s, rows = 5;
  g.moveTo(x + 0.35 * s, y).lineTo(x + 0.35 * s, top).stroke({ width: 1.5 * s, color: 0x24180c });
  g.moveTo(x - 0.1 * s, y).lineTo(x - 0.1 * s, top).stroke({ width: 0.7 * s, color: 0x9a7244 });
  // Three vertical folds, each a strip of the banner shaded by how it faces the sun.
  const edge = (u: number, i: number): [number, number] => {
    const k = i / rows;
    return [x + u * bw + Math.sin(wave + i * 0.9 + u * 2.2) * 1.1 * s * k, bar + len * k + (u === 0.5 && i === rows ? -2.6 * s : 0)];
  };
  const folds = [0, 1 / 3, 2 / 3, 1];
  g.poly([...Array.from({ length: rows + 1 }, (_, i) => edge(0, i)).flat(), ...edge(0.5, rows), ...Array.from({ length: rows + 1 }, (_, i) => edge(1, rows - i)).flat()].map((v, i) => v + (i % 2 ? 0.6 : 0.4) * s))
    .fill({ color: 0x000000, alpha: 0.35 });
  for (let j = 0; j < 3; j++) {
    const u0 = folds[j], u1 = folds[j + 1];
    const k = 0.78 + 0.32 * Math.cos(wave * 0.8 + j * 2.1);
    const c = k >= 1 ? mixColor(color, 0xfff4dc, k - 1) : mixColor(color, 0x0c0e18, 1 - k);
    const left = Array.from({ length: rows + 1 }, (_, i) => edge(u0, i)).flat();
    const right = Array.from({ length: rows + 1 }, (_, i) => edge(u1, rows - i)).flat();
    // The swallowtail notch dips into the middle fold's hem.
    const notch = j === 1 ? [...edge(0.5, rows)] : [];
    g.poly([...left, ...notch, ...right]).fill(c);
  }
  // A pale band across the banner.
  const b0 = 0.28, b1 = 0.4;
  const band = [...[0, 1].flatMap(u => edge(u, rows * b0)), ...[1, 0].flatMap(u => edge(u, rows * b1))];
  g.poly([band[0], band[1], band[2], band[3], band[4], band[5], band[6], band[7]]).fill({ color: trim, alpha: 0.85 });
  g.moveTo(x - 0.5 * s, bar).lineTo(x + bw + 0.6 * s, bar).stroke({ width: 1 * s, color: 0x24180c });
  g.circle(x, top - 0.9 * s, (gilt ? 1.7 : 1.2) * s).fill(0xc8a040);
  g.circle(x - 0.35 * s, top - 1.3 * s, 0.5 * s).fill({ color: 0xfff0b0, alpha: 0.8 });
}

/** Arc as its own sub-path — Pixi otherwise joins it to the previous path's last point. */
function arcPath(g: Graphics, x: number, y: number, r: number, a0: number, a1: number): Graphics {
  return g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1);
}

/** Pixi rendering for the cavalry action mode: follow camera, ground, units, arrows, effects. */
export class ChargeView {
  readonly root = new Container();
  private readonly world = new Container();
  private readonly ground = new Graphics();
  private readonly stainRT: RenderTexture;
  private readonly stainSprite: Sprite;
  private readonly stainBatch = new Graphics();
  /** Off-stage container baked into the ground texture: stains plus fallen soldiers. */
  private readonly bakeRoot = new Container();
  private stainDirty = false;
  private readonly telegraph = new Graphics();
  private readonly route = new Graphics();
  private readonly aimG = new Graphics();
  /** A route is being drawn: follow more gently and keep the zoom steady. */
  holdCamera = false;
  private readonly unitLayer = new Container();
  private readonly fx = new Graphics();
  private readonly arrowsG = new Graphics();
  private readonly overlay = new Graphics();
  private readonly popupLayer = new Container();
  /** Screen-space pointers to calls for help that are off screen. */
  private readonly callG = new Graphics();

  private readonly units = new Map<number, UnitGfx>();
  private unitStamp = 0;
  private dying: Dying[] = [];
  private particles: Particle[] = [];
  private impacts: ImpactFx[] = [];
  private popups: Popup[] = [];
  /** Pre-rendered unit art: a body and a weapon texture per unit design. */
  private readonly unitTextures = new Map<string, { body: Texture; weapon: Texture; bx: number; by: number; wx: number; wy: number }>();
  /** Textures this view created and must free. */
  private readonly ownedTextures: Texture[] = [];
  private readonly particleLayer = new Container();
  private readonly particlePool: Sprite[] = [];
  private dotHard: Texture | null = null;
  private dotSoft: Texture | null = null;
  private readonly ink: number;
  private readonly dust: number;

  private camX: number = C.CAMPS[0].x;
  private camY: number = C.CAMPS[0].y - 200;
  private zoom = 2;
  private viewW = 800;
  private viewH = 450;
  private sidePopupCooldown = 0;
  private hoofTimer = 0;
  private readonly rand = mulberry32(99);

  private readonly style: ArtStyle;
  /** Upright three-quarter-view figures (the classic RTS style) instead of top-down art. */
  private readonly upright: boolean;

  constructor(private readonly app: Application, private readonly theme: Theme) {
    this.style = theme.artStyle ?? 'classic';
    this.upright = this.style === 'rts';
    // Upright figures overlap: whoever stands nearer the camera (lower on screen) is drawn on top.
    this.unitLayer.sortableChildren = this.upright;
    this.ink = theme.labelFill;
    this.dust = theme.grass ? mixColor(theme.dirt, theme.trim, 0.45) : mixColor(theme.bg, theme.obstacleBorder, 0.35);
    // Beyond the field: forest floor on grass, a darker margin otherwise.
    app.renderer.background.color = this.style === 'mini' ? 0x4e3420 // the wooden table under the felt
      : this.style === 'ink' ? 0xd6c7a2
      : theme.grass ? 0x33441f : mixColor(theme.bg, this.ink, 0.18);

    this.stainRT = RenderTexture.create({ width: C.WORLD_W, height: C.WORLD_H, resolution: 1.25 });
    this.bakeRoot.addChild(this.stainBatch);
    this.stainSprite = new Sprite(this.stainRT);

    this.drawGround();
    this.world.addChild(this.ground, this.stainSprite, this.route, this.aimG, this.telegraph, this.unitLayer, this.particleLayer, this.fx, this.arrowsG, this.overlay);
    this.root.addChild(this.world, this.callG, this.popupLayer);
    app.stage.addChild(this.root);
    this.prewarm();
    // Start from a blank stain layer (render textures may hold stale GPU memory).
    app.renderer.render({ container: new Container(), target: this.stainRT, clear: true, clearColor: [0, 0, 0, 0] });
  }

  destroy(): void {
    this.app.stage.removeChild(this.root);
    this.root.destroy({ children: true });
    this.bakeRoot.destroy({ children: true });
    this.stainRT.destroy(true);
    this.grassTexture?.destroy(true);
    for (const c of this.unitTextures.values()) { c.body.destroy(true); c.weapon.destroy(true); }
    this.unitTextures.clear();
    for (const tex of this.ownedTextures) tex.destroy(true);
    this.ownedTextures.length = 0;
    this.units.clear();
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  private baseZoom(): number {
    const long = Math.max(this.viewW, this.viewH), short = Math.min(this.viewW, this.viewH);
    let zoom = long / 740;
    // Phones: frame ~260 world units across the short side so units aren't tiny.
    if (short < 600) zoom = Math.max(zoom, short / 260);
    // Dev builds: window.chargeZoom scales the camera (for close-up recordings).
    const devZoom = import.meta.env.DEV ? (window as { chargeZoom?: number }).chargeZoom ?? 1 : 1;
    return Math.max(0.8, Math.min(3, zoom)) * devZoom;
  }

  /** Snap the camera to the squadron (on start). */
  focus(p: Vec2): void {
    this.camX = p.x;
    this.camY = p.y;
    this.zoom = this.baseZoom();
  }

  worldToScreen(p: Vec2): Vec2 {
    return {
      x: this.world.x + p.x * this.zoom,
      y: this.world.y + p.y * this.zoom,
    };
  }

  screenToWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.world.x) / this.zoom,
      y: (p.y - this.world.y) / this.zoom,
    };
  }

  /**
   * Draw the squadron's planned route from the leader: canter stretches as a dashed
   * line, gallop stretches as a bold line with chevrons, and a marker at the end.
   */
  drawRoute(points: PathPoint[], leader: Soldier | null, drawing: boolean): void {
    const g = this.route;
    g.clear();
    if (points.length === 0) return;
    const t = this.theme;
    const canterColor = t.blue;
    const gallopColor = t.hpMid;
    const boost = drawing ? 1 : 0.8;

    let px = leader ? leader.x : points[0].x;
    let py = leader ? leader.y : points[0].y;
    let dashPhase = 0;
    let chevronPhase = 10;
    const DASH = 6, GAP = 5, CHEV = 20;

    for (const p of points) {
      const dx = p.x - px, dy = p.y - py;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const nx = dx / len, ny = dy / len;
      if (p.gallop) {
        g.moveTo(px, py).lineTo(p.x, p.y).stroke({ width: 3, color: gallopColor, alpha: 0.7 * boost, cap: 'round' });
        // Chevrons point the way at full tilt.
        let d = CHEV - chevronPhase;
        while (d < len) {
          const cx = px + nx * d, cy = py + ny * d;
          g.moveTo(cx - nx * 4 - ny * 4, cy - ny * 4 + nx * 4).lineTo(cx, cy).lineTo(cx - nx * 4 + ny * 4, cy - ny * 4 - nx * 4)
            .stroke({ width: 1.6, color: t.bg, alpha: 0.9 });
          d += CHEV;
        }
        chevronPhase = (chevronPhase + len) % CHEV;
        dashPhase = 0;
      } else {
        // Dashes carry their phase across segments so the pattern stays even.
        let d = 0;
        while (d < len) {
          const cycle = (dashPhase + d) % (DASH + GAP);
          if (cycle < DASH) {
            const run = Math.min(DASH - cycle, len - d);
            g.moveTo(px + nx * d, py + ny * d).lineTo(px + nx * (d + run), py + ny * (d + run));
            d += run;
          } else {
            d += DASH + GAP - cycle;
          }
        }
        g.stroke({ width: 1.6, color: canterColor, alpha: 0.75 * boost });
        dashPhase = (dashPhase + len) % (DASH + GAP);
      }
      px = p.x; py = p.y;
    }

    const end = points[points.length - 1];
    const endColor = end.gallop ? gallopColor : canterColor;
    g.circle(end.x, end.y, 6).stroke({ width: 1.5, color: endColor, alpha: 0.85 * boost });
    g.circle(end.x, end.y, 2).fill({ color: endColor, alpha: 0.85 * boost });
  }

  /**
   * Point-and-ride feedback while the pointer is held: just a small marker where
   * you point, turning amber when it is far enough away to gallop.
   */
  drawAim(leader: Soldier | null, aim: Vec2 | null, zones: DirectZones): void {
    const g = this.aimG;
    g.clear();
    if (!leader || !aim) return;
    const t = this.theme;
    const z = this.zoom;
    const dx = aim.x - leader.x, dy = aim.y - leader.y;
    const d = Math.hypot(dx, dy);
    // Pointing past the gallop distance turns the marker amber; nothing else marks the zones.
    const galloping = d * z >= zones.gallop;
    const color = galloping ? t.hpMid : t.trim;
    // Line widths in screen pixels, so the pointer stays thin at any zoom.
    const px = 1 / z;
    if (d * z < zones.dead) {
      g.circle(aim.x, aim.y, 6 * px).stroke({ width: 1.2 * px, color, alpha: 0.4 });
      return;
    }
    g.circle(aim.x, aim.y, 5 * px).stroke({ width: 1.3 * px, color, alpha: 0.5 });
    g.circle(aim.x, aim.y, 1.4 * px).fill({ color, alpha: 0.6 });
  }

  /** Visible world rectangle (for the minimap). */
  get viewport(): { x: number; y: number; w: number; h: number } {
    return {
      x: -this.world.x / this.zoom,
      y: -this.world.y / this.zoom,
      w: this.viewW / this.zoom,
      h: this.viewH / this.zoom,
    };
  }

  // --- Static ground -------------------------------------------------------------

  private grassTexture: Texture | null = null;

  /** Amount of bare, trampled earth: where the lines clash and around both camps. */
  private earthAt = (x: number, y: number): number => {
    const cx = C.WORLD_W / 2;
    const xFade = Math.max(0, 1 - Math.max(0, Math.abs(x - cx) - 380) / 160);
    const front = Math.max(0, 1 - Math.abs(y - C.FRONT_Y) / 80) * xFade;
    let camp = 0;
    for (const c of C.CAMPS) camp = Math.max(camp, 1 - Math.hypot(x - c.x, y - c.y) / (C.CAMP_R * 1.15));
    const redCamp = y < 200 ? Math.max(0, 1 - Math.max(0, Math.abs(x - cx) - 300) / 120) * (1 - y / 200) * 0.8 : 0;
    return Math.max(front, camp, redCamp);
  };

  /** Realistic meadow: tiled close-up grass, broad colour patches, trampled earth and scenery sprites. */
  private drawGrass(): void {
    const t = this.theme;
    const rand = mulberry32(4321);
    // The grass tile and its texture live for the whole session (shared by every battle).
    const tile = this.style === 'mini' ? paintFeltTile(t) : this.style === 'ink' ? paintPaperTile(t) : paintGrassTile(t, 768, 3);
    const grass = new TilingSprite({ texture: sharedTexture(tile), width: C.WORLD_W, height: C.WORLD_H });
    grass.tileScale.set(this.style === 'mini' || this.style === 'ink' ? 0.75 : 0.5);
    const overlay = new Sprite(sharedTexture(paintGroundOverlay(C.WORLD_W, C.WORLD_H, t, this.earthAt, 4, 11, 'charge')));
    overlay.width = C.WORLD_W;
    overlay.height = C.WORLD_H;
    if (this.style === 'ink') overlay.alpha = 0.6; // pale washes over the paper
    this.world.addChild(grass, overlay);
    if (this.style === 'mini') {
      // Scatter-flock patches, the way terrain is dressed on a wargames table.
      const flock = new Graphics();
      const fr = mulberry32(77);
      const tones = [t.grassLight, t.grassDry, mixColor(t.grassDark, 0x1a2a10, 0.4), t.dirt];
      for (let i = 0; i < 420; i++) {
        const x = fr() * C.WORLD_W, y = fr() * C.WORLD_H;
        const color = tones[Math.floor(fr() * tones.length)];
        const spread = 8 + fr() * 22;
        // A patch is a drift of fine grains, denser in the middle.
        for (let k = 0; k < 40; k++) {
          const a = fr() * Math.PI * 2, d = Math.pow(fr(), 1.6) * spread;
          flock.circle(x + Math.cos(a) * d * 1.4, y + Math.sin(a) * d, 0.5 + fr() * 1.1)
            .fill({ color, alpha: 0.35 + fr() * 0.3 });
        }
      }
      this.world.addChild(flock);
      // The felt's cut edge, with the table showing beyond.
      const edge = new Graphics();
      edge.rect(-6, -6, C.WORLD_W + 12, C.WORLD_H + 12).stroke({ width: 10, color: 0x000000, alpha: 0.25 });
      this.world.addChild(edge);
    }

    // Scenery as sprites baked from a handful of drawings.
    const deco = new Container();
    deco.sortableChildren = this.upright;
    this.world.addChild(deco);
    const keep = (b: { tex: Texture; ax: number; ay: number }) => { this.ownedTextures.push(b.tex); return b; };
    const INK = 0x2a2018;
    const inkTree = (v: number, r: number) => keep(this.bake(g => {
      g.circle(r * 0.12, r * 0.1, r).fill({ color: t.grassDark, alpha: 0.55 });
      g.circle(-r * 0.15, -r * 0.15, r * 0.7).fill({ color: t.grassLight, alpha: 0.4 });
      const r2 = mulberry32(31 + v);
      for (let i = 0; i < 7; i++) {
        const a0 = (i / 7) * Math.PI * 2 + r2() * 0.3, a1 = a0 + 0.7 + r2() * 0.3;
        const rr = r * (0.85 + r2() * 0.2);
        g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1).stroke({ width: 1.1, color: INK, alpha: 0.75 });
      }
      for (let i = 0; i < 5; i++) {
        const o = r * (0.15 + i * 0.13);
        g.moveTo(o, r * 0.55).lineTo(r * 0.55, o).stroke({ width: 0.7, color: INK, alpha: 0.45 });
      }
    }, 2));
    // Upright trees for the three-quarter view: a trunk under a heaped, sunlit crown.
    const uprightTree = (v: number, r: number, trunk: number) => keep(this.bake(g => {
      const r2 = mulberry32(57 + v * 13);
      const leaf = mixColor(t.grassDark, 0x0e1a06, 0.35 + 0.08 * (v % 3));
      g.ellipse(r * 0.45, 0, r * 1.05, r * 0.42).fill({ color: 0x000000, alpha: 0.3 });
      g.moveTo(0, 0).lineTo(0, -trunk - r * 0.4).stroke({ width: Math.max(1.5, r * 0.22), color: 0x4a3420, cap: 'round' });
      g.moveTo(-r * 0.04, 0).lineTo(-r * 0.04, -trunk).stroke({ width: Math.max(0.6, r * 0.07), color: 0x7a5a38, cap: 'round' });
      const cy = -trunk - r * 0.75;
      const blobs: [number, number, number][] = [];
      for (let i = 0; i < 9 + v; i++) {
        const a = r2() * Math.PI * 2, d = Math.sqrt(r2()) * r * 0.55;
        blobs.push([Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, r * (0.38 + r2() * 0.22)]);
      }
      blobs.sort((a, b) => a[1] - b[1]);
      for (const [x, y, br] of blobs) g.circle(x, y, br + 0.6).fill(mixColor(leaf, 0x000000, 0.5));
      for (const [x, y, br] of blobs) {
        g.circle(x, y, br).fill(leaf);
        g.circle(x - br * 0.25, y - br * 0.3, br * 0.6).fill(mixColor(leaf, t.grassLight, 0.35));
        g.circle(x - br * 0.38, y - br * 0.45, br * 0.25).fill({ color: mixColor(t.grassLight, 0xfff0a0, 0.3), alpha: 0.6 });
      }
    }, 2));
    // Pines: tiers of dark boughs, lit on the sunward side, over a short trunk.
    const uprightPine = (v: number, r: number, h: number) => keep(this.bake(g => {
      const r2 = mulberry32(91 + v * 7);
      const dark = mixColor(t.grassDark, 0x0a1a10, 0.55 + 0.05 * v), lit = mixColor(dark, t.grassLight, 0.35);
      g.ellipse(r * 0.3, 0, r * 0.9, r * 0.36).fill({ color: 0x000000, alpha: 0.3 });
      g.moveTo(0, 0).lineTo(0, -h * 0.3).stroke({ width: Math.max(1.4, r * 0.18), color: 0x4a3420, cap: 'round' });
      const tiers = 4 + (v % 2);
      for (let i = 0; i < tiers; i++) {
        const k = i / tiers;
        const base = -h * (0.18 + k * 0.62), w = r * (1 - k * 0.72) * (0.9 + r2() * 0.2), th = h * 0.36;
        g.poly([-w - 0.8, base + 0.8, 0, base - th - 0.8, w + 0.8, base + 0.8]).fill(mixColor(dark, 0x000000, 0.45));
        g.poly([-w, base, 0, base - th, w, base]).fill(dark);
        g.poly([-w, base, 0, base - th, -w * 0.15, base]).fill(lit);
        g.poly([-w * 0.15, base, 0, base - th, w * 0.25, base]).fill({ color: lit, alpha: 0.35 });
      }
    }, 2));
    const treeTex = this.upright ? [
      ...[0, 1, 2, 3, 4].map(v => uprightTree(v, 15 + v * 1.5, 9 + (v % 2) * 4)),
      ...[0, 1, 2].map(v => uprightPine(v, 11 + v * 1.5, 38 + v * 6)),
    ]
      : this.style === 'ink' ? [0, 1, 2].map(v => inkTree(v, 24)) : [0, 1, 2].map(v => keep(this.bake(g => {
      const r = 26;
      g.circle(r * 0.28, r * 0.34, r).fill({ color: 0x000000, alpha: 0.28 });
      const lobes = 6 + v;
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2 + v;
        g.circle(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.6).fill(mixColor(t.grassDark, 0x16220c, 0.45 + 0.05 * v));
      }
      g.circle(-r * 0.12, -r * 0.12, r * 0.62).fill(mixColor(t.grassDark, 0x1c2a10, 0.15));
      g.circle(-r * 0.32, -r * 0.34, r * 0.3).fill({ color: t.grassLight, alpha: 0.32 });
    }, 2)));
    const bushTex = this.upright ? [5, 6, 7].map(v => uprightTree(v, 6, -3))
      : this.style === 'ink' ? [0, 1, 2].map(v => inkTree(v + 5, 8)) : [0, 1, 2].map(v => keep(this.bake(g => {
      const r = 8;
      g.ellipse(r * 0.3, r * 0.4, r * 1.3, r * 0.9).fill({ color: 0x000000, alpha: 0.25 });
      for (let i = 0; i < 4 + v; i++) {
        const a = (i / (4 + v)) * Math.PI * 2;
        g.circle(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.3, r * 0.55).fill(mixColor(t.grassDark, 0x1c2a10, 0.3 + v * 0.08));
      }
      g.circle(-r * 0.25, -r * 0.25, r * 0.3).fill({ color: t.grassLight, alpha: 0.35 });
    }, 3)));
    const stoneTex = [0, 1, 2].map(v => keep(this.bake(g => {
      const r = 2.2 + v * 0.6;
      g.ellipse(0.6, 0.7, r * 1.25, r).fill({ color: 0x000000, alpha: 0.25 });
      g.ellipse(0, 0, r * 1.25, r).fill(mixColor(t.obstacleFill, 0x000000, v * 0.12));
      g.circle(-r * 0.35, -r * 0.3, r * 0.4).fill({ color: 0xffffff, alpha: 0.2 });
    }, 4)));
    const petals = [0xf6f2e4, 0xf0d24a, 0xb592d8, 0xe9a0b4];
    const flowerTex = petals.map(color => keep(this.bake(g => {
      const r2 = mulberry32(color);
      for (let k = 0; k < 7; k++) g.circle((r2() - 0.5) * 14, (r2() - 0.5) * 14, 0.7 + r2() * 0.5).fill({ color, alpha: 0.95 });
    }, 4)));
    const place = (b: { tex: Texture; ax: number; ay: number }, x: number, y: number, scale: number) => {
      const sp = new Sprite(b.tex);
      sp.anchor.set(b.ax, b.ay);
      sp.position.set(x, y);
      sp.scale.set(scale);
      sp.rotation = rand() * Math.PI * 2;
      if (this.upright && (treeTex.includes(b) || bushTex.includes(b))) {
        // Upright scenery stands up the screen; nearer trees overlap farther ones.
        sp.rotation = 0;
        sp.scale.x *= rand() < 0.5 ? -1 : 1;
        sp.zIndex = y;
      }
      deco.addChild(sp);
    };

    // Forest beyond the field edge (on the table: just the felt's edge).
    const band = 170;
    // Upright trees crowd into a dense wood, crowns overlapping, right up to the field's edge.
    const trees = this.style === 'mini' ? 0 : this.upright ? 1400 : 300;
    for (let i = 0; i < trees; i++) {
      const side = Math.floor(rand() * 4);
      const along = rand();
      const depth = (this.upright ? 2 : 14) + rand() * band;
      const x = side === 0 || side === 2 ? along * (C.WORLD_W + band * 2) - band : side === 1 ? C.WORLD_W + depth : -depth;
      const y = side === 0 ? -depth : side === 2 ? C.WORLD_H + depth : along * (C.WORLD_H + band * 2) - band;
      place(treeTex[Math.floor(rand() * treeTex.length)], x, y, this.upright ? 0.8 + rand() * 0.5 : 0.6 + rand() * 0.7);
    }
    for (let i = 0; i < 70; i++) {
      const edge = Math.floor(rand() * 4);
      const inset = 15 + rand() * 90;
      const x = edge === 1 ? C.WORLD_W - inset : edge === 3 ? inset : rand() * C.WORLD_W;
      const y = edge === 0 ? inset : edge === 2 ? C.WORLD_H - inset : rand() * C.WORLD_H;
      if (this.earthAt(x, y) > 0.1) continue;
      place(bushTex[Math.floor(rand() * bushTex.length)], x, y, 0.7 + rand() * 0.7);
    }
    for (let i = 0; i < 140; i++) {
      const x = rand() * C.WORLD_W, y = rand() * C.WORLD_H;
      place(stoneTex[Math.floor(rand() * stoneTex.length)], x, y, 0.7 + rand() * 0.6);
    }
    for (let i = 0; i < (this.style === 'classic' || this.style === 'rts' ? 170 : 0); i++) {
      const x = rand() * C.WORLD_W, y = rand() * C.WORLD_H;
      if (this.earthAt(x, y) > 0.3) continue;
      place(flowerTex[Math.floor(rand() * flowerTex.length)], x, y, 0.8 + rand() * 0.5);
    }
  }

  private drawGround(): void {
    const g = this.ground;
    const t = this.theme;
    const rand = mulberry32(1234);
    if (t.grass) {
      this.drawGrass();
      this.drawCamps(g, rand);
      return;
    }
    g.rect(0, 0, C.WORLD_W, C.WORLD_H).fill(t.bg);

    // Churned earth where the lines meet.
    const mud = mixColor(t.bg, t.obstacleBorder, 0.16);
    for (let i = 0; i < 40; i++) {
      const x = C.WORLD_W / 2 + (rand() - 0.5) * 900;
      const y = C.FRONT_Y + (rand() - 0.5) * 70;
      g.ellipse(x, y, 40 + rand() * 70, 14 + rand() * 20).fill({ color: mud, alpha: 0.18 });
    }

    // Grass tufts and stones give the eye something to track at speed.
    const tuft = mixColor(t.bg, t.obstacleBorder, 0.3);
    g.setStrokeStyle({ width: 1, color: tuft, alpha: 0.55 });
    for (let i = 0; i < 2200; i++) {
      const x = rand() * C.WORLD_W;
      const y = rand() * C.WORLD_H;
      const s = 2 + rand() * 2.5;
      g.moveTo(x - s, y - s * 0.2).lineTo(x - s * 0.2, y + s * 0.5).lineTo(x + s * 0.4, y - s * 0.6);
    }
    g.stroke();
    for (let i = 0; i < 260; i++) {
      g.circle(rand() * C.WORLD_W, rand() * C.WORLD_H, 0.8 + rand() * 1.8)
        .fill({ color: t.obstacleBorder, alpha: 0.18 + rand() * 0.15 });
    }

    // Field edge.
    g.rect(0, 0, C.WORLD_W, C.WORLD_H).stroke({ width: 4, color: t.obstacleBorder, alpha: 0.5 });
    this.drawCamps(g, rand);
  }

  private drawCamps(g: Graphics, rand: () => number): void {
    const t = this.theme;
    // Blue rally camps behind each wing.
    const blue = t.blue;
    for (const c of C.CAMPS) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        this.drawTent(g, c.x + Math.cos(a) * (C.CAMP_R + 26), c.y + Math.sin(a) * (C.CAMP_R + 26), blue);
      }
      g.circle(c.x, c.y, C.CAMP_R).fill({ color: blue, alpha: 0.07 });
      const dashes = 28;
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / dashes * 0.55;
        arcPath(g, c.x, c.y, C.CAMP_R, a0, a1).stroke({ width: 2, color: blue, alpha: 0.5 });
      }
      this.drawBanner(g, c.x + C.CAMP_R * 0.55, c.y - C.CAMP_R * 0.55, blue);
    }

    // Red camp along the far edge (scenery).
    for (let i = 0; i < 9; i++) {
      this.drawTent(g, C.WORLD_W / 2 + (i - 4) * 70 + (rand() - 0.5) * 20, 70 + rand() * 40, t.red);
    }
    this.drawBanner(g, C.WORLD_W / 2, 150, t.red);

    for (const c of C.CAMPS) {
      const label = new Text({
        text: 'CAMP',
        style: { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: 12, fontWeight: '800', fill: blue, letterSpacing: 3 },
        resolution: 4,
      });
      label.anchor.set(0.5);
      label.alpha = 0.6;
      label.position.set(c.x, c.y + C.CAMP_R - 16);
      this.world.addChild(label);
    }
  }

  private drawTent(g: Graphics, x: number, y: number, color: number): void {
    if (this.upright) {
      // A round pavilion seen from the side: striped wall, conical roof, pennant on the pole.
      const cloth = mixColor(this.theme.trim, 0xffffff, 0.3), w = 11, wall = 9, roof = 12;
      g.ellipse(x + 4, y + 1, w + 4, w * 0.45).fill({ color: 0x000000, alpha: 0.3 });
      g.rect(x - w, y - wall, w * 2, wall).fill(cloth);
      g.ellipse(x, y, w, w * 0.4).fill(cloth);
      for (const k of [-0.6, 0, 0.6]) g.rect(x + k * w - 1.6, y - wall, 3.2, wall + w * 0.4 * Math.sqrt(1 - k * k)).fill(color);
      g.rect(x + w * 0.35, y - wall, w * 0.65, wall).fill({ color: 0x000000, alpha: 0.18 });
      g.poly([x - w - 1.5, y - wall, x, y - wall - roof, x + w + 1.5, y - wall]).fill(color);
      g.ellipse(x, y - wall, w + 1.5, w * 0.35).fill(color);
      g.poly([x, y - wall - roof, x + w + 1.5, y - wall, x + w * 0.3, y - wall + w * 0.3]).fill({ color: 0x000000, alpha: 0.2 });
      g.moveTo(x - w - 1.5, y - wall + 0.5).quadraticCurveTo(x, y - wall + w * 0.5, x + w + 1.5, y - wall + 0.5)
        .stroke({ width: 1.2, color: this.theme.trim });
      g.moveTo(x, y - wall - roof).lineTo(x, y - wall - roof - 6).stroke({ width: 0.9, color: 0x3a2a1a });
      g.poly([x, y - wall - roof - 6, x + 6, y - wall - roof - 4.5, x, y - wall - roof - 3]).fill(color);
      return;
    }
    g.poly([x - 11, y + 8, x, y - 9, x + 11, y + 8]).fill({ color: mixColor(this.theme.trim, color, 0.22) })
      .stroke({ width: 1.2, color, alpha: 0.6 });
    g.moveTo(x, y - 9).lineTo(x, y + 8).stroke({ width: 0.8, color, alpha: 0.5 });
  }

  private drawBanner(g: Graphics, x: number, y: number, color: number): void {
    g.moveTo(x, y + 10).lineTo(x, y - 24).stroke({ width: 1.5, color: this.theme.obstacleBorder });
    g.poly([x, y - 24, x + 16, y - 19, x, y - 14]).fill(color);
  }

  // --- Units -----------------------------------------------------------------------

  /** Resolution for pre-rendered art: crisp at the closest zoom on dense screens. */
  private get artResolution(): number {
    return Math.min(6, 3 * this.app.renderer.resolution);
  }

  /** Render vector art once into a texture; returns it with the anchor that keeps its origin. */
  private bake(draw: (g: Graphics) => void, resolution = this.artResolution): { tex: Texture; ax: number; ay: number } {
    const g = new Graphics();
    draw(g);
    const b = g.getLocalBounds();
    const tex = this.app.renderer.generateTexture({ target: g, resolution, antialias: true });
    g.destroy();
    const w = Math.max(1e-3, b.width), h = Math.max(1e-3, b.height);
    return { tex, ax: -b.x / w, ay: -b.y / h };
  }

  /**
   * Bake every unit design up front: baking on first sight (the first knights, a new
   * horse coat) would hitch the game mid-battle.
   */
  private prewarm(): void {
    ensureCombatFont();
    this.dotTextures();
    for (const team of ['blue', 'red'] as const) {
      for (const type of ['swordsman', 'pikeman', 'archer'] as const) {
        if (this.upright) for (let v = 0; v < INFANTRY_LOOKS; v++) this.sheetFor(type, team, C.INFANTRY_RADIUS[type], v);
        else this.texturesFor(type, team, C.INFANTRY_RADIUS[type], 0);
      }
      for (let v = 0; v < HORSE_VARIANTS; v++) {
        if (this.upright) this.sheetFor('cavalry', team, C.RIDER_RADIUS, v);
        else this.texturesFor('cavalry', team, C.RIDER_RADIUS, v);
      }
    }
  }

  /**
   * Bake every facing and frame of an upright unit design into one texture: rows of
   * facings, columns of frames. Frames are sub-rectangles anchored at the feet.
   */
  private sheetFor(type: UnitType, team: Team, r: number, variant: number): FigureSheet {
    const res = Math.min(2.5, this.artResolution);
    const t = this.theme;
    const key = `${type}:${team}:${r}:${variant}:${res}:${t.blue}:${t.red}:${t.steel}:${t.wood}`;
    const hit = figureSheets.get(key);
    if (hit) return hit;
    // Shelf-pack every facing and frame into one canvas no wider than a safe texture.
    // Sheets are many and large, so their resolution is capped: units are small on screen.
    const maxW = Math.floor(4096 / res);
    const PAD = 1;
    const detach = type === 'pikeman' || type === 'cavalry';
    const figs = [];
    for (let d = 0; d < DRAWN_DIRS; d++) {
      for (let f = 0; f < FRAMES; f++) figs.push(buildFigure(type, team, r, this.theme, variant, dirAngle(d), f, detach));
    }
    const cells: { x: number; y: number; w: number; h: number }[] = [];
    let x = 0, y = 0, rowH = 0, width = 0;
    for (const fr of figs) {
      const w = Math.ceil(fr.maxX - fr.minX + PAD * 2), h = Math.ceil(fr.maxY - fr.minY + PAD * 2);
      if (x + w > maxW) { x = 0; y += rowH; rowH = 0; }
      cells.push({ x, y, w, h });
      x += w;
      rowH = Math.max(rowH, h);
      width = Math.max(width, x);
    }
    const height = y + rowH;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * res);
    canvas.height = Math.ceil(height * res);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(res, res);
    const painter = canvasPainter(ctx);
    figs.forEach((fr, i) => fr.draw(painter, cells[i].x + PAD - fr.minX, cells[i].y + PAD - fr.minY));
    const source = new CanvasSource({ resource: canvas, resolution: res });
    const frames = cells.map(c => new Texture({ source, frame: new Rectangle(c.x, c.y, c.w, c.h) }));
    // The detached weapon: the same in every facing, so take it from the first row.
    const weapons = figs.slice(0, FRAMES).map(fr => fr.weapon);
    let weaponTex: Texture | null = null, weaponLen = 0;
    const weaponAnchor = { x: 0, y: 0.5 };
    const seg = weapons.find(w => w);
    if (seg) {
      weaponLen = Math.hypot(seg.tip[0] - seg.butt[0], seg.tip[1] - seg.butt[1], seg.tip[2] - seg.butt[2]);
      const kind = type === 'cavalry' ? 'lance' : 'pike';
      const wPad = 1, tw = weaponLen * 1.15 + r * 0.6 + wPad * 2, th = r * 0.8 + wPad * 2;
      const wc = document.createElement('canvas');
      wc.width = Math.ceil(tw * res);
      wc.height = Math.ceil(th * res);
      const wctx = wc.getContext('2d')!;
      wctx.scale(res, res);
      const oy = wPad + r * 0.2;
      paintLongWeapon(canvasPainter(wctx), kind, team, r, this.theme, weaponLen, wPad, oy);
      weaponTex = new Texture({ source: new CanvasSource({ resource: wc, resolution: res }) });
      weaponAnchor.x = wPad / tw;
      weaponAnchor.y = oy / th;
    }
    const sheet = {
      frames,
      ax: figs.map((fr, i) => (PAD - fr.minX) / cells[i].w),
      ay: figs.map((fr, i) => (PAD - fr.minY) / cells[i].h),
      weapons,
      weaponTex,
      weaponLen,
      weaponAnchor,
    };
    figureSheets.set(key, sheet);
    return sheet;
  }

  private texturesFor(type: UnitType, team: Team, r: number, variant: number) {
    const key = `${type}:${team}:${r}:${variant}`;
    let t = this.unitTextures.get(key);
    if (!t) {
      // Body and weapon are baked separately so the weapon can still swing and thrust.
      const scratch = new Graphics();
      const body = this.bake(g => drawStyledUnit(this.style, g, scratch, type, team, r, this.theme, variant));
      scratch.clear();
      const weapon = this.bake(g => drawStyledUnit(this.style, scratch, g, type, team, r, this.theme, variant));
      scratch.destroy();
      t = { body: body.tex, weapon: weapon.tex, bx: body.ax, by: body.ay, wx: weapon.ax, wy: weapon.ay };
      this.unitTextures.set(key, t);
    }
    return t;
  }

  private gfxFor(s: Soldier): UnitGfx {
    let u = this.units.get(s.id);
    if (u) return u;
    const variant = s.type === 'cavalry' ? s.id % HORSE_VARIANTS : this.upright ? s.id % INFANTRY_LOOKS : 0;
    const root = new Container();
    let body: Sprite, weapon: Sprite, sheet: FigureSheet | null = null;
    if (this.upright) {
      // The weapon is part of each frame; the spare sprite stays hidden.
      sheet = this.sheetFor(s.type, s.team, s.radius, variant);
      body = new Sprite(sheet.frames[0]);
      body.anchor.set(sheet.ax[0], sheet.ay[0]);
      // No two men quite alike: a touch lighter or darker each (plus the size jitter).
      const tone = 0xe4 + ((s.id * 37) % 28);
      body.tint = (tone << 16) | (tone << 8) | tone;
      weapon = new Sprite(sheet.weaponTex ?? Texture.EMPTY);
      weapon.anchor.set(sheet.weaponAnchor.x, sheet.weaponAnchor.y);
      weapon.visible = false;
      // The weapon goes in front of the body or behind it, depending on where it points.
      root.sortableChildren = true;
    } else {
      const t = this.texturesFor(s.type, s.team, s.radius, variant);
      body = new Sprite(t.body);
      body.anchor.set(t.bx, t.by);
      weapon = new Sprite(t.weapon);
      weapon.anchor.set(t.wx, t.wy);
    }
    root.addChild(body, weapon);
    this.unitLayer.addChild(root);
    u = { root, body, weapon, pulse: 0, fleeing: false, aimRot: 0, stamp: this.unitStamp, px: s.x, py: s.y, phase: (s.id * 1.7) % 6.28, speed: 0, sheet, frame: -1, hoofBeat: null };
    this.units.set(s.id, u);
    return u;
  }

  /** The fallen stay on the field: bake the body, darkened, with its weapon dropped beside it. */
  private layCorpse(root: Container): void {
    root.removeFromParent();
    root.alpha = 0.78;
    root.scale.set(0.95);
    const body = root.children[0] as Sprite | undefined;
    const weapon = root.children[1] as Sprite | undefined;
    if (body) body.tint = 0x8c8c8c;
    if (this.upright) {
      // The fall ended on the lying pose; he stays where he fell, a little darker.
      root.alpha = 1;
      root.scale.set(1);
      if (body) { body.position.set(0, 0); body.tint = 0xa8a8a8; }
      this.bakeRoot.addChild(root);
      this.stainDirty = true;
      return;
    }
    if (this.style === 'mini') {
      // A toppled miniature: knocked flat on its side, paint intact.
      root.alpha = 1;
      root.scale.set(1, 0.62);
      if (body) body.tint = 0xd6d6d6;
    } else if (this.style === 'ink') {
      root.alpha = 0.55;
      if (body) body.tint = 0xffffff;
    }
    if (weapon) {
      weapon.visible = true;
      weapon.tint = 0x9a9a9a;
      weapon.rotation = (this.rand() - 0.5) * 2.4;
      weapon.position.set((this.rand() - 0.5) * 4, (this.rand() - 0.5) * 4);
    }
    this.bakeRoot.addChild(root);
    this.stainDirty = true;
  }

  private killUnit(id: number, angle: number, speed: number, lift: number): void {
    const u = this.units.get(id);
    if (!u) return;
    this.units.delete(id);
    if (this.upright) u.weapon.visible = false; // the falling frames have no pike or lance
    // Trampled men are flung along the charge, a little to either side.
    const a = angle + (this.rand() - 0.5) * 0.9;
    this.dying.push({
      root: u.root,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      spin: (this.rand() - 0.5) * (6 + lift * 14),
      age: 0,
      lift,
      fig: u.sheet && u.frame >= 0 ? { u, dir: Math.floor(u.frame / FRAMES) } : null,
    });
  }

  /** Slash, shockwave and flying earth where a charge connects. */
  private impactFx(x: number, y: number, angle: number, side: 'front' | 'flank' | 'rear', pike: boolean): void {
    const strength = side === 'rear' ? 1.7 : side === 'flank' ? 1.35 : 0.8;
    if (this.impacts.length > 40) this.impacts.shift();
    this.impacts.push({ x, y, angle, age: 0, strength, rear: side === 'rear', pike });
    // Clods of earth thrown forward and to the sides.
    const n = 2 + Math.floor(this.rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = angle + (this.rand() - 0.5) * 2.2;
      const sp = 50 + this.rand() * 90;
      this.addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
        life: 0.35 + this.rand() * 0.25, size: 0.8 + this.rand() * 0.9, grow: -0.6,
        color: this.theme.dirt, alpha: 0.9, stain: false,
      });
    }
    this.burstDust(x, y, angle, side === 'rear' ? 5 : side === 'flank' ? 3 : 2);
    if (side !== 'front' && !pike) {
      // Caught from the side or behind: men and shields thrown along the charge.
      for (let i = 0; i < (side === 'rear' ? 6 : 4); i++) {
        const a = angle + (this.rand() - 0.5) * 0.9;
        const sp = 90 + this.rand() * 110;
        this.addParticle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
          life: 0.25 + this.rand() * 0.2, size: 1 + this.rand() * 0.8, grow: -1,
          color: 0xffffff, alpha: 0.8, stain: false,
        });
      }
    }
    if (pike) {
      // Splinters from shattered lances.
      for (let i = 0; i < 4; i++) {
        const a = angle + Math.PI + (this.rand() - 0.5) * 2.6;
        const sp = 60 + this.rand() * 80;
        this.addParticle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
          life: 0.4 + this.rand() * 0.3, size: 0.7, grow: 0,
          color: this.theme.wood, alpha: 1, stain: false,
        });
      }
    }
  }

  private drawImpacts(dt: number): void {
    const g = this.fx;
    g.clear();
    const t = this.theme;
    this.impacts = this.impacts.filter(fx => {
      fx.age += dt;
      const k = fx.age / IMPACT_FX_LIFE;
      if (k >= 1) return false;
      const fade = 1 - k;
      const c = Math.cos(fx.angle), sn = Math.sin(fx.angle);
      // Shockwave ring.
      const ringColor = fx.rear ? t.hpMid : t.trim;
      g.circle(fx.x, fx.y, (3 + k * 13) * fx.strength).stroke({ width: 1.6 * fade, color: ringColor, alpha: 0.55 * fade });
      if (fx.strength > 1.2) {
        // A second, wider shockwave for blows that land on an open side.
        g.circle(fx.x, fx.y, (2 + k * 24) * fx.strength).stroke({ width: 1.2 * fade, color: 0xffffff, alpha: 0.3 * fade });
      }
      // Crescent slash facing the direction of the charge.
      const r = 8 * fx.strength;
      const cx = fx.x - c * r * 0.55, cy = fx.y - sn * r * 0.55;
      const a0 = fx.angle - 0.95, a1 = fx.angle + 0.95;
      g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, a1)
        .stroke({ width: (2.6 - k * 2) * fx.strength, color: 0xffffff, alpha: 0.85 * fade * fade, cap: 'round' });
      if (fx.pike) {
        // Sparks off steel.
        for (let i = 0; i < 5; i++) {
          const a = fx.angle + Math.PI + (i - 2) * 0.55;
          const d0 = 2 + k * 6, d1 = d0 + 4 * fade;
          g.moveTo(fx.x + Math.cos(a) * d0, fx.y + Math.sin(a) * d0).lineTo(fx.x + Math.cos(a) * d1, fx.y + Math.sin(a) * d1)
            .stroke({ width: 1, color: 0xfff1b0, alpha: fade });
        }
      }
      return true;
    });
  }

  // --- Frame ---------------------------------------------------------------------------

  render(sim: ChargeSim, events: SimEvent[], dt: number): void {
    this.handleEvents(sim, events, dt);
    this.syncUnits(sim, dt);
    this.spawnTrail(sim, dt);
    this.spawnHaze(sim, dt);
    this.updateParticles(dt);
    this.drawImpacts(dt);
    this.drawArrows(sim);
    this.drawTelegraphs(sim);
    this.drawOverlay(sim);
    this.updateCamera(sim, dt);
    this.updatePopups(dt);
    this.flushStains(dt);
  }

  private handleEvents(sim: ChargeSim, events: SimEvent[], dt: number): void {
    const t = this.theme;
    this.sidePopupCooldown -= dt;
    for (const e of events) {
      switch (e.type) {
        case 'impact': {
          this.impactFx(e.x, e.y, e.angle, e.side, e.pike);
          if (e.pike) this.popup(e.x, e.y, 'PIKES!', t.labelWarn, 13);
          else if (e.side !== 'front' && this.sidePopupCooldown <= 0) {
            this.sidePopupCooldown = 0.5;
            this.popup(e.x, e.y, e.side === 'rear' ? 'REAR ×3' : 'FLANK ×2', e.side === 'rear' ? t.labelWarn : t.elevationBonus, e.side === 'rear' ? 17 : 15);
          }
          break;
        }
        case 'rally':
          this.popup(e.x, e.y - 16, 'Rallied!', e.team === 'blue' ? t.blue : t.red, 15, 1.4);
          break;
        case 'call-done':
          this.popup(e.x, e.y - 22, `+${e.points}`, t.elevationBonus, 20, 1.6);
          break;
        case 'clash': {
          // Your squadron crashes home: a big shockwave, flying earth and splinters.
          if (this.impacts.length > 40) this.impacts.shift();
          this.impacts.push({ x: e.x, y: e.y, angle: e.angle, age: 0, strength: 2.6, rear: !e.pike, pike: e.pike });
          this.burstDust(e.x, e.y, e.angle, 6);
          for (let i = 0; i < 7; i++) {
            const a = e.angle + Math.PI + (this.rand() - 0.5) * 2.6, sp = 60 + this.rand() * 110;
            this.addParticle({
              x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
              life: 0.3 + this.rand() * 0.3, size: 0.7 + this.rand() * 0.6, grow: -0.5,
              color: e.pike ? t.steel : t.wood, alpha: 0.95, stain: false,
            });
          }
          break;
        }
        case 'general-down':
          if (this.impacts.length > 40) this.impacts.shift();
          this.impacts.push({ x: e.x, y: e.y, angle: 0, age: 0, strength: 3, rear: true, pike: false });
          this.burstDust(e.x, e.y, 0, 10);
          this.blood(e.x, e.y, 0, 10, 1.5);
          break;
        case 'hit':
          if (this.rand() < 0.5) this.blood(e.x, e.y, e.angle, 2, 0.8);
          this.pulse(e.id);
          break;
        case 'kill':
          this.killUnit(e.id, e.angle, e.byPlayer ? 190 : 70, e.byPlayer ? 1 : 0.15);
          this.blood(e.x, e.y, e.angle, e.byPlayer ? 7 : 4, 1.2);
          this.stainBatch.circle(e.x, e.y, 2 + this.rand() * 2).fill({ color: t.redStain, alpha: 0.35 * t.bloodAlpha });
          this.stainDirty = true;
          break;
        case 'volley':
          break;
        case 'arrow-land':
          if (!e.hit) this.stickArrow(e.x, e.y, e.angle);
          else this.blood(e.x, e.y, e.angle, 2, 0.8);
          break;
        case 'rider-hit':
          this.pulse(e.id);
          break;
        case 'rider-down':
          this.killUnit(e.id, e.angle, 120, 0.6);
          this.blood(e.x, e.y, e.angle, e.mine ? 8 : 5, 1.4);
          this.burstDust(e.x, e.y, e.angle, e.mine ? 8 : 4);
          if (e.mine) {
            this.popup(e.x, e.y, e.wasLeader ? 'Leader down!' : 'Rider down', t.labelWarn, 13);
          } else if (e.byPlayer) {
            this.popup(e.x, e.y, `Knight down +${e.points}`, t.elevationBonus, 14);
          } else if (e.lured) {
            this.popup(e.x, e.y, `Lured +${e.points}`, t.elevationBonus, 15);
          }
          break;
        case 'squad-break':
          this.popup(e.x, e.y - 14, e.team === 'red' ? 'Scattered!' : 'Our riders scatter', e.team === 'red' ? t.elevationBonus : t.labelWarn, 17, 1.2);
          this.burstDust(e.x, e.y, 0, 6);
          break;
        case 'join':
          this.popup(e.x, e.y - 16, `+${e.count} riders!`, t.blue, 20, 1.4);
          break;
        case 'muster':
          this.popup(e.x, e.y - 20, 'Fresh riders!', t.blue, 16, 1.6);
          break;
        case 'garrison':
          this.popup(e.x, e.y - 10, '+1 rider', t.blue, 13);
          break;
        case 'rout':
          if (e.team === 'red') {
            this.popup(e.x, e.y, e.byPlayer ? `ROUTED! +${C.ROUT_SCORE}` : 'ROUTED!', t.red, 22, 1.8);
          } else {
            this.popup(e.x, e.y, 'Our men flee!', t.blue, 16, 1.6);
          }
          break;
        case 'wave':
          this.popup(e.x, e.y + 40, 'Reinforcements!', t.red, 18, 2);
          break;
        case 'combo': {
          const L = sim.leader;
          if (L) this.popup(L.x, L.y - 22, `${e.count} COMBO!`, t.elevationBonus, 18, 1.2);
          break;
        }
      }
    }
  }

  private pulse(id: number): void {
    const u = this.units.get(id);
    if (u) u.pulse = 0.12;
  }

  private syncUnits(sim: ChargeSim, dt: number): void {
    const stamp = ++this.unitStamp;
    for (const s of sim.soldiers) {
      if (!s.alive) continue;
      const u = this.gfxFor(s);
      u.stamp = stamp;
      u.root.position.set(s.x, s.y);
      // Men in the ranks don't all face exactly the same way.
      const quirk = ((s.id * 0.618034) % 1) - 0.5;
      u.root.rotation = s.facing + (s.rider || s.fleeing ? 0 : quirk * 0.28);
      // Knocked down: lying tipped over on his side, weapon dropped, until he gets up.
      const down = !s.rider && s.down > 0;
      if (this.upright) {
        // Upright figures turn by showing another facing; the sprite itself stays upright.
        // Knocked down, he lies on the ground (the corpse pose) until he gets up.
        u.root.rotation = 0;
        u.root.zIndex = s.y;
      } else if (down) u.root.rotation += (s.id % 2 === 0 ? 1 : -1) * 1.35;
      u.fleeing = s.fleeing;
      u.weapon.visible = !this.upright && !s.fleeing && !down; // weapons thrown down
      this.animateFighting(u, s, sim.time, dt);
      const hpK = s.hp / s.maxHp;
      u.root.alpha = (s.fleeing ? 0.6 : 0.55) + 0.45 * hpK;
      let scale = 0.94 + ((s.id * 0.3779) % 1) * 0.12;
      let sx = 1, sy = 1;
      if (u.pulse > 0) {
        // Squash and stretch when struck.
        u.pulse = Math.max(0, u.pulse - dt);
        const q = Math.sin((u.pulse / 0.12) * Math.PI);
        sx = 1 + 0.3 * q;
        sy = 1 - 0.22 * q;
      }
      if (s.rider && s.speed > C.CHARGE_MIN_SPEED) {
        // Galloping bob.
        scale *= 1 + 0.06 * Math.sin(sim.time * 18 + s.id);
      }
      if (down) { sx *= 1.12; sy *= 0.7; }
      if (this.style !== 'classic') ({ scale, sx, sy } = this.styleMotion(u, s, sim.time, dt, scale, sx, sy, down));
      if (this.upright) this.poseFigure(u, s, sim.time, down, quirk);
      u.root.scale.set(scale * sx, scale * sy);
    }
    for (const [id, u] of this.units) {
      if (u.stamp !== stamp) {
        u.root.destroy({ children: true });
        this.units.delete(id);
      }
    }

    const DUR = 0.55;
    this.dying = this.dying.filter(d => {
      d.age += dt;
      const k = d.age / DUR;
      if (k >= 1) {
        // Thud: a puff of dust where the body lands.
        if (d.lift > 0.4) this.burstDust(d.root.x, d.root.y, Math.atan2(d.vy, d.vx), 3);
        this.layCorpse(d.root);
        return false;
      }
      const decel = 1 - k * 0.9;
      d.root.x += d.vx * dt * decel;
      d.root.y += d.vy * dt * decel;
      const air = Math.sin(k * Math.PI) * d.lift;
      d.root.alpha = 1;
      if (this.upright) {
        // Falling: play the fall from the way he faced, thrown up and along by the blow.
        if (d.fig) this.showFrame(d.fig.u, d.fig.dir * FRAMES + deathFrame(Math.min(1, k * 1.6)));
        const body = d.root.children[0];
        if (body) body.y = -air * 9;
        return true;
      }
      d.root.rotation += d.spin * dt * (1 - k * 0.7);
      // Up through the air and back down (seen from above: grows, then shrinks to rest).
      d.root.scale.set(1 + 0.4 * air);
      return true;
    });
  }

  /**
   * Motion that sells each prototype style: toy hops and rocking-horse gallops for
   * miniatures, hand-drawn line boil for ink, sprite bobbing for the painted RTS look.
   */
  private styleMotion(u: UnitGfx, s: Soldier, time: number, dt: number, scale: number, sx: number, sy: number, down: boolean) {
    const dist = Math.hypot(s.x - u.px, s.y - u.py);
    u.px = s.x;
    u.py = s.y;
    const speed = dt > 0 ? dist / dt : 0;
    u.speed += (speed - u.speed) * Math.min(1, dt * 10);
    // Upright figures stride further per cycle: a full gallop stride is about a horse length and a half.
    u.phase += Math.min(dist, 12) * (this.upright ? (s.type === 'cavalry' ? 0.2 : 0.55) : s.rider ? 0.32 : 0.75);
    const moving = speed > 6 && !down;
    if (this.style === 'mini') {
      if (down) {
        // Knocked flat: the figure lies on its side, base and all.
        u.root.rotation += (s.id % 2 === 0 ? 0.25 : -0.25);
        sy *= 0.8;
      } else if (s.rider) {
        // Rocking horse: pitch fore and aft (seen from above it lengthens and shortens)
        // and a lift on every stride.
        const rock = Math.sin(u.phase);
        const k = Math.min(1, speed / C.CANTER_SPEED);
        sx *= 1 + 0.08 * rock * k;
        u.root.x += Math.cos(s.facing) * rock * 0.9 * k;
        u.root.y -= Math.abs(rock) * 1.6 * k;
        scale *= 1 + Math.abs(rock) * 0.05 * k;
      } else if (moving) {
        // Hopping across the table as if moved by hand, with a little wobble.
        const hop = Math.abs(Math.sin(u.phase));
        u.root.y -= hop * 1.5;
        scale *= 1 + hop * 0.06;
        u.root.rotation += Math.sin(u.phase) * 0.09;
      }
    } else if (this.style === 'ink') {
      // Line boil: every few frames each figure is "redrawn" a hair differently.
      const k = Math.floor(time * 8);
      const h = (n: number) => { const x = Math.sin((s.id * 12.9898 + k * 78.233 + n * 37.719)) * 43758.5453; return x - Math.floor(x); };
      u.root.x += (h(1) - 0.5) * 0.6;
      u.root.y += (h(2) - 0.5) * 0.6;
      u.root.rotation += (h(3) - 0.5) * 0.08;
      sx *= 1 + (h(4) - 0.5) * 0.06;
    }
    return { scale, sx, sy };
  }

  /**
   * Pick an upright figure's frame: the facing nearest its heading (mirrored for the
   * west half), then an attack, a walk or gallop step, or standing still.
   */
  private poseFigure(u: UnitGfx, s: Soldier, time: number, down: boolean, quirk: number): void {
    const sheet = u.sheet;
    if (!sheet) return;
    const { dir, mirror } = facingFrame(s.facing + (s.rider || s.fleeing ? 0 : quirk * 0.28));
    const since = time - s.lastAttack;
    const dur = attackDuration(s.type);
    const moving = u.speed > (s.type === 'cavalry' ? 10 : 5);
    let frame = IDLE_FRAME;
    if (down) frame = CORPSE_FRAME;
    else if (s.fleeing) frame = moving ? fleeFrame(u.phase) : IDLE_FRAME;
    else if (since >= 0 && since < dur) frame = attackFrame(since / dur);
    else if (moving) frame = walkFrame(u.phase);
    this.showFrame(u, dir * FRAMES + frame);
    u.body.scale.x = mirror ? -1 : 1;
    this.poseWeapon(u, s, frame, mirror, quirk);
  }

  /**
   * Lay the detached pike or lance from the unit's hands along its exact heading:
   * the body shows one of 16 facings, but the long weapon turns smoothly.
   */
  private poseWeapon(u: UnitGfx, s: Soldier, frame: number, mirror: boolean, quirk: number): void {
    const sheet = u.sheet!;
    const seg = sheet.weapons[frame];
    if (!seg || !sheet.weaponTex) { u.weapon.visible = false; return; }
    // Mirrored sprites stand for the opposite heading, flipped; the weapon follows the
    // true heading with the handedness the mirrored art shows.
    const heading = s.facing + (s.rider || s.fleeing ? 0 : quirk * 0.28);
    const a = projectLocal(seg.butt, heading, mirror), b = projectLocal(seg.tip, heading, mirror);
    const dx = b.x - a.x, dy = b.y - a.y;
    const rot = Math.atan2(dy, dx);
    u.weapon.visible = true;
    u.weapon.position.set(u.body.x + a.x, u.body.y + a.y);
    u.weapon.rotation = rot;
    // Foreshortened as it points toward or away from the camera; the pennant hangs down.
    u.weapon.scale.set(Math.hypot(dx, dy) / sheet.weaponLen, Math.cos(rot) < 0 ? -1 : 1);
    u.weapon.zIndex = (a.depth + b.depth) / 2 > -0.1 * s.radius ? 1 : -1;
  }

  private showFrame(u: UnitGfx, i: number): void {
    if (!u.sheet || i === u.frame) return;
    u.frame = i;
    u.body.texture = u.sheet.frames[i];
    u.body.anchor.set(u.sheet.ax[i], u.sheet.ay[i]);
  }

  /**
   * Weapon and body motion for a blow (sword cut, pike thrust, lance thrust) and a
   * restless sway for soldiers locked in the line.
   */
  private animateFighting(u: UnitGfx, s: Soldier, time: number, dt: number): void {
    const r = s.radius;
    let wRot = 0, wX = 0, bX = 0, bY = 0;
    if (!s.fleeing) {
      const since = time - s.lastAttack;
      if (since >= 0 && since < attackDuration(s.type)) {
        ({ wRot, wX, bX } = attackPose(s.type, r, since));
      } else if (s.bat && s.bat.engagedTimer > 0) {
        // Shoving and bracing in the press of the line.
        bX = Math.sin(time * 6 + s.id * 1.7) * r * 0.12;
        bY = Math.sin(time * 4.3 + s.id) * r * 0.08;
      }
    }
    // Weapons track the nearest enemy, within what an arm (or a horse's neck) allows.
    const reach = s.type === 'cavalry' ? 0.55 : s.type === 'pikeman' ? 1.0 : 1.3;
    const target = Number.isNaN(s.aim) || s.fleeing ? 0
      : Math.max(-reach, Math.min(reach, angleDiff(s.aim, u.root.rotation)));
    u.aimRot += (target - u.aimRot) * Math.min(1, dt * 7);
    if (this.upright) {
      // The sprite doesn't turn, so a lunge moves it along the heading (foreshortened).
      const c = Math.cos(s.facing), sn = Math.sin(s.facing);
      u.body.position.set(bX * c - bY * sn, (bX * sn + bY * c) * 0.55);
      return;
    }
    u.body.position.set(bX, bY);
    u.weapon.position.set(bX + wX, bY);
    u.weapon.rotation = u.aimRot + wRot;
  }

  // --- Particles & stains ----------------------------------------------------------------

  private addParticle(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  private blood(x: number, y: number, angle: number, count: number, power: number): void {
    const colors = this.theme.redBlood;
    for (let i = 0; i < count; i++) {
      const a = angle + (this.rand() - 0.5) * 1.3;
      const sp = (30 + this.rand() * 90) * power;
      this.addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
        life: 0.18 + this.rand() * 0.2, size: 1 + this.rand() * 1.4, grow: -0.5,
        color: colors[Math.floor(this.rand() * colors.length)], alpha: this.theme.bloodAlpha, stain: true,
      });
    }
  }

  private burstDust(x: number, y: number, angle: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = angle + Math.PI + (this.rand() - 0.5) * 2.2;
      const sp = 20 + this.rand() * 50;
      this.addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
        life: 0.5 + this.rand() * 0.4, size: 2 + this.rand() * 2, grow: 4,
        color: this.dust, alpha: 0.4, stain: false,
      });
    }
  }

  /** Dust kicked up wherever lines are locked in melee. */
  private spawnHaze(sim: ChargeSim, dt: number): void {
    for (const b of sim.battalions) {
      if (b.routed || b.engagedTimer <= 0 || this.rand() > dt * 2.2) continue;
      const men = b.grid;
      const s = men[Math.floor(this.rand() * Math.min(men.length, b.cols * 2))];
      if (!s || !s.alive) continue;
      if (this.upright) {
        // The press of the line tramples the turf to earth.
        this.stainBatch.poly(ovalPoints(s.x + (this.rand() - 0.5) * 10, s.y + (this.rand() - 0.5) * 6, 3 + this.rand() * 4, 2 + this.rand() * 2, this.rand() * Math.PI))
          .fill({ color: this.theme.dirt, alpha: 0.07 });
        this.stainDirty = true;
      }
      this.addParticle({
        x: s.x + (this.rand() - 0.5) * 8, y: s.y + (this.rand() - 0.5) * 8,
        vx: 6 + (this.rand() - 0.5) * 6, vy: (this.rand() - 0.5) * 6, age: 0,
        life: 1.6 + this.rand() * 1.2, size: 4 + this.rand() * 4, grow: 7,
        color: this.dust, alpha: 0.13, stain: false,
      });
    }
  }

  private spawnTrail(sim: ChargeSim, dt: number): void {
    if (this.style === 'ink') {
      // Every rider at speed leaves a dry-brush stroke: the page records the charges.
      for (const sq of sim.squadrons) {
        const color = sq.team === 'blue' ? this.theme.blue : this.theme.red;
        for (const r of sq.riders) {
          if (r.speed < 70) continue;
          const back = r.speed * dt * 1.6;
          this.stainBatch.moveTo(r.x - Math.cos(r.facing) * (6 + back), r.y - Math.sin(r.facing) * (6 + back))
            .lineTo(r.x - Math.cos(r.facing) * 6, r.y - Math.sin(r.facing) * 6)
            .stroke({ width: 1.8, color, alpha: 0.07 * Math.min(1, r.speed / C.GALLOP_SPEED), cap: 'round' });
          this.stainDirty = true;
        }
      }
    }
    this.hoofTimer += dt;
    const stamp = this.hoofTimer >= 0.16;
    if (stamp) this.hoofTimer = 0;
    for (const r of sim.riders) {
      if (r.speed < 60) continue;
      const k = Math.min(1, r.speed / C.GALLOP_SPEED);
      if (this.rand() < k * 0.55) {
        const bx = r.x - Math.cos(r.facing) * 7 + (this.rand() - 0.5) * 4;
        const by = r.y - Math.sin(r.facing) * 7 + (this.rand() - 0.5) * 4;
        this.addParticle({
          x: bx, y: by, vx: (this.rand() - 0.5) * 12, vy: (this.rand() - 0.5) * 12, age: 0,
          life: 0.45 + this.rand() * 0.4, size: 1.5 + this.rand() * 1.5, grow: 5,
          color: this.dust, alpha: 0.32 * k, stain: false,
        });
      }
      if (stamp && !this.upright) {
        // Hoof prints baked into the ground: the field remembers your charges.
        // (The upright style stamps them per hoof fall instead; see stampHoofPrints.)
        const side = this.rand() < 0.5 ? 2 : -2;
        const jx = (this.rand() - 0.5) * 3, jy = (this.rand() - 0.5) * 3;
        this.stainBatch.circle(r.x - Math.sin(r.facing) * side + jx, r.y + Math.cos(r.facing) * side + jy, 0.8)
          .fill({ color: this.theme.grass ? this.theme.dirt : this.theme.obstacleBorder, alpha: this.theme.grass ? 0.16 : 0.08 });
        this.stainDirty = true;
      }
    }
    if (this.upright) this.stampHoofPrints(sim);
  }

  /**
   * Every horseman at a canter or faster presses a pair of hoof prints into the turf
   * each time a hoof comes down in his gait cycle, so charges leave tracks that build
   * into churned lanes. Galloping hard also tears up the odd clod of earth.
   */
  private stampHoofPrints(sim: ChargeSim): void {
    const print = mixColor(this.theme.dirt, 0x2a1e10, 0.45);
    for (const s of sim.soldiers) {
      if (!s.alive || s.type !== 'cavalry') continue;
      const u = this.units.get(s.id);
      if (!u || u.speed < 35) continue;
      // Four hoof falls per stride.
      const beat = Math.floor(u.phase / (Math.PI / 2));
      if (beat === u.hoofBeat) continue;
      const first = u.hoofBeat === null;
      u.hoofBeat = beat;
      if (first) continue;
      const k = Math.min(1, u.speed / C.GALLOP_SPEED);
      const c = Math.cos(s.facing), sn = Math.sin(s.facing);
      // Fore and hind feet land in turn; each fall leaves a left-right pair.
      const along = beat % 2 === 0 ? 4.5 : -4.5;
      for (const side of [-1.5, 1.5]) {
        const x = s.x + c * along - sn * side + (this.rand() - 0.5) * 1.2;
        const y = s.y + sn * along + c * side + (this.rand() - 0.5) * 1.2;
        this.stainBatch.poly(ovalPoints(x, y, 1.5, 1.1, s.facing)).fill({ color: print, alpha: 0.2 + 0.18 * k });
        this.stainBatch.poly(ovalPoints(x + c * 0.4, y + sn * 0.4, 0.7, 0.55, s.facing)).fill({ color: print, alpha: 0.15 * k });
      }
      if (k > 0.7 && this.rand() < 0.25) {
        this.stainBatch.poly(ovalPoints(s.x - c * 7, s.y - sn * 7, 2.4 + this.rand() * 1.6, 1.3, s.facing + (this.rand() - 0.5)))
          .fill({ color: this.theme.dirt, alpha: 0.14 });
      }
      this.stainDirty = true;
    }
  }

  private stickArrow(x: number, y: number, angle: number): void {
    const len = 4;
    const tx = x - Math.cos(angle) * len, ty = y - Math.sin(angle) * len;
    this.stainBatch.moveTo(x, y).lineTo(tx, ty).stroke({ width: 0.7, color: this.ink, alpha: 0.35 });
    this.stainBatch.circle(tx, ty, 0.8).fill({ color: this.ink, alpha: 0.25 });
    this.stainDirty = true;
  }

  private dotTextures(): { hard: Texture; soft: Texture } {
    if (!this.dotHard || !this.dotSoft) {
      this.dotHard = this.bake(g => g.circle(0, 0, 8).fill(0xffffff), 1).tex;
      this.dotSoft = this.bake(g => {
        for (let i = 8; i >= 1; i--) g.circle(0, 0, i).fill({ color: 0xffffff, alpha: 0.16 });
      }, 1).tex;
    }
    return { hard: this.dotHard, soft: this.dotSoft };
  }

  /** Particles are pooled sprites (blood and earth crisp, dust and haze soft). */
  private updateParticles(dt: number): void {
    const t = this.theme;
    const stainAlpha = t.bloodAlpha * (1 - t.bloodFade * 0.7);
    const dots = this.dotTextures();
    const decay = Math.exp(-5 * dt);
    let n = 0;
    let live = 0;
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) {
        if (p.stain) {
          this.stainBatch.circle(p.x, p.y, p.size * (0.5 + this.rand() * 0.5))
            .fill({ color: t.redStain, alpha: (0.3 + this.rand() * 0.3) * stainAlpha });
          this.stainDirty = true;
        }
        continue;
      }
      p.vx *= decay;
      p.vy *= decay;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      const size = Math.max(0.3, p.size + p.grow * p.age);
      let spr = this.particlePool[n];
      if (!spr) {
        spr = new Sprite(dots.hard);
        spr.anchor.set(0.5);
        this.particlePool.push(spr);
        this.particleLayer.addChild(spr);
      }
      const soft = p.grow > 0;
      spr.texture = soft ? dots.soft : dots.hard;
      spr.visible = true;
      spr.position.set(p.x, p.y);
      spr.scale.set(size / 8);
      spr.tint = p.color;
      spr.alpha = p.alpha * (1 - k) * (soft ? 1.4 : 1);
      n++;
      this.particles[live++] = p;
    }
    this.particles.length = live;
    for (let i = n; i < this.particlePool.length; i++) this.particlePool[i].visible = false;
  }

  private stainTimer = 0;

  /** Bake pending stains into the ground texture a few times a second (one extra GPU pass each). */
  private flushStains(dt: number): void {
    this.stainTimer += dt;
    if (!this.stainDirty || this.stainTimer < 0.2) return;
    this.stainTimer = 0;
    this.app.renderer.render({ container: this.bakeRoot, target: this.stainRT, clear: false });
    this.stainBatch.clear();
    if (this.bakeRoot.children.length > 1) {
      for (const corpse of this.bakeRoot.removeChildren(1)) corpse.destroy({ children: true });
    }
    this.stainDirty = false;
  }

  // --- Arrows, telegraphs, overlays ----------------------------------------------------------

  private drawArrows(sim: ChargeSim): void {
    const g = this.arrowsG;
    g.clear();
    const t = this.theme;
    for (const a of sim.arrows) {
      if (a.t < 0) continue;
      const p = a.t / a.flight;
      const gx = a.sx + (a.tx - a.sx) * p;
      const gy = a.sy + (a.ty - a.sy) * p;
      const h = 4 * p * (1 - p);
      const lift = h * 26 * a.flight;
      const dx = a.tx - a.sx, dy = a.ty - a.sy;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      // Ground shadow, sharper as the arrow comes down.
      g.circle(gx, gy, 1.2).fill({ color: 0x000000, alpha: 0.08 + 0.12 * (1 - h) });
      // The arrow itself, lifted toward the viewer at the top of its arc.
      const ax = gx, ay = gy - lift;
      const len = 5 * (1 + h * 0.5);
      const color = a.team === 'blue' ? t.blueProjectile : t.redProjectile;
      g.moveTo(ax - nx * len, ay - ny * len).lineTo(ax, ay).stroke({ width: 0.8 + h * 0.4, color, alpha: 0.95 });
    }
  }

  private drawTelegraphs(sim: ChargeSim): void {
    const g = this.telegraph;
    g.clear();
    const warn = this.theme.labelWarn;
    for (const v of sim.volleys) {
      if (!v.atPlayer) continue;
      const p = Math.min(1, v.t / v.flight);
      if (p >= 1) continue;
      g.circle(v.x, v.y, v.radius).fill({ color: warn, alpha: 0.05 + 0.12 * p });
      g.circle(v.x, v.y, v.radius * p).fill({ color: warn, alpha: 0.1 + 0.1 * p });
      const dashes = 18;
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * Math.PI * 2 + v.t * 0.8;
        arcPath(g, v.x, v.y, v.radius, a0, a0 + (Math.PI * 2) / dashes * 0.5)
          .stroke({ width: 1.2, color: warn, alpha: 0.35 + 0.5 * p });
      }
    }
  }

  private drawOverlay(sim: ChargeSim): void {
    const g = this.overlay;
    g.clear();
    const t = this.theme;
    const L = sim.leader;

    // Battalion standards: a waving team flag over every formed battalion, with a
    // slim morale bar under red flags near the action.
    for (const b of sim.battalions) {
      if (b.routed) continue;
      const color = b.team === 'blue' ? t.blue : t.red;
      const dark = b.team === 'blue' ? t.blueDark : t.redDark;
      const px = b.x - Math.cos(b.facing) * b.spacing * 0.6;
      const py = b.y - Math.sin(b.facing) * b.spacing * 0.6;
      const wave = sim.time * 5 + b.id;
      if (this.upright) {
        paintStandard(g, px, py, 24, color, mixColor(color, t.trim, 0.75), wave);
        if (b.team !== 'red' || !L || Math.hypot(b.x - L.x, b.y - L.y) > 200) continue;
        // A slim morale bar at the foot of the staff.
        const w = 16, h = 1.6, x = px - w / 2, y = py + 2.5;
        const m = Math.max(0, Math.min(1, b.morale / 100));
        const mc = m > 0.6 ? t.hpHigh : m > 0.3 ? t.hpMid : t.hpLow;
        g.rect(x - 0.6, y - 0.6, w + 1.2, h + 1.2).fill({ color: 0x1a140a, alpha: 0.45 });
        g.rect(x, y, w * m, h).fill({ color: mc, alpha: 0.8 });
        continue;
      }
      const top = py - 18;
      g.moveTo(px, py).lineTo(px, top).stroke({ width: 1.1, color: t.wood });
      const pts: number[] = [px, top];
      for (let i = 1; i <= 4; i++) pts.push(px + i * 3, top + Math.sin(wave - i * 0.9) * 1.3 * (i / 4));
      for (let i = 4; i >= 1; i--) pts.push(px + i * 3, top + 7 + Math.sin(wave - i * 0.9) * 1.3 * (i / 4));
      pts.push(px, top + 7);
      g.poly(pts).fill(color).stroke({ width: 0.6, color: dark });
      g.moveTo(px + 1.5, top + 3.5).lineTo(px + 10, top + 3.5 + Math.sin(wave - 3) * 1).stroke({ width: 1, color: t.trim, alpha: 0.7 });
      g.circle(px, top - 0.8, 0.9).fill(t.steel);

      if (b.team !== 'red') continue;
      if (!L || Math.hypot(b.x - L.x, b.y - L.y) > 200) continue;
      const w = 22, h = 2.4;
      const x = px - w / 2, y = py + 3;
      const m = Math.max(0, Math.min(1, b.morale / 100));
      const mc = m > 0.6 ? t.hpHigh : m > 0.3 ? t.hpMid : t.hpLow;
      g.roundRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6, 1.5).fill({ color: 0x000000, alpha: 0.35 });
      g.roundRect(x, y, w * m, h, 1.2).fill({ color: mc, alpha: 0.9 });
    }

    this.drawCalls(g, sim);

    // Banners on other squadrons' leaders; allied troops show they can be collected.
    for (const sq of sim.squadrons) {
      const SL = sq.riders[0];
      if (sq === sim.player || !SL) continue;
      const color = sq.team === 'blue' ? t.blue : t.red;
      const bx = SL.x - Math.cos(SL.facing) * 3, by = SL.y - Math.sin(SL.facing) * 3;
      const wave = Math.sin(sim.time * 9 + sq.id) * 1.2;
      if (this.upright) {
        // Standards over riding squadrons: the general's tall and gilt, ringed in gold.
        const general = sq.ai === 'general';
        if (general) {
          const pulse = 0.5 + 0.3 * Math.sin(sim.time * 5);
          g.ellipse(SL.x, SL.y, 12, 7).stroke({ width: 1.2, color: t.hpMid, alpha: pulse });
        }
        paintStandard(g, bx, by, general ? 30 : 22, color, general ? 0xd8b050 : mixColor(color, t.trim, 0.75), sim.time * 9 + sq.id, general ? 1.15 : 0.8, general);
        if (sq.team === 'blue') {
          const c = sim.squadCenter(sq);
          const pulse = 0.35 + 0.2 * Math.sin(sim.time * 4 + sq.id);
          g.ellipse(c.x, c.y, 14 + sq.riders.length * 1.3, (14 + sq.riders.length * 1.3) * 0.6).stroke({ width: 1, color, alpha: pulse });
        }
        continue;
      }
      if (sq.ai === 'general') {
        // The general: a tall gold-edged standard and a pulsing ring — hunt him down.
        const pulse = 0.65 + 0.35 * Math.sin(sim.time * 5);
        g.circle(SL.x, SL.y, 13).stroke({ width: 1.8, color: t.hpMid, alpha: pulse });
        g.moveTo(bx, by).lineTo(bx, by - 22).stroke({ width: 1.3, color: t.wood });
        g.poly([bx, by - 22, bx + 12, by - 20 + wave, bx + 11, by - 14 + wave, bx, by - 13])
          .fill(color).stroke({ width: 1, color: t.hpMid });
        g.circle(bx, by - 23, 1.4).fill(t.hpMid);
        continue;
      }
      g.moveTo(bx, by).lineTo(bx, by - 12).stroke({ width: 1, color: t.obstacleBorder });
      g.poly([bx, by - 12, bx + 7, by - 10 + wave, bx, by - 7]).fill(color);
      if (sq.team === 'blue') {
        const c = sim.squadCenter(sq);
        const pulse = 0.5 + 0.3 * Math.sin(sim.time * 4 + sq.id);
        g.circle(c.x, c.y, 16 + sq.riders.length * 1.5).stroke({ width: 1.2, color, alpha: pulse });
      }
    }
    this.updateJoinTags(sim);

    if (!L) return;
    this.drawExposed(g, sim, L);
    // On your tail: a pulsing red chevron beside your leader, pointing at the danger.
    for (const R of sim.onTail) {
      const a = Math.atan2(R.y - L.y, R.x - L.x);
      const pulse = 0.55 + 0.45 * Math.sin(sim.time * 14);
      const cx = L.x + Math.cos(a) * 24, cy = L.y + Math.sin(a) * 24;
      const px = -Math.sin(a), py = Math.cos(a);
      g.poly([
        cx + Math.cos(a) * 5, cy + Math.sin(a) * 5,
        cx + px * 4.5 - Math.cos(a) * 1.5, cy + py * 4.5 - Math.sin(a) * 1.5,
        cx + Math.cos(a) * 1.5, cy + Math.sin(a) * 1.5,
        cx - px * 4.5 - Math.cos(a) * 1.5, cy - py * 4.5 - Math.sin(a) * 1.5,
      ]).fill({ color: t.labelWarn, alpha: 0.5 + 0.45 * pulse }).stroke({ width: 0.8, color: 0x1a0c08, alpha: 0.6 });
    }
    // Leader marker: a small, faint heading chevron ahead of him.
    const cx = L.x + Math.cos(L.facing) * 17, cy = L.y + Math.sin(L.facing) * 17;
    const px = -Math.sin(L.facing), py = Math.cos(L.facing);
    g.poly([
      cx + Math.cos(L.facing) * 3, cy + Math.sin(L.facing) * 3,
      cx + px * 2.4, cy + py * 2.4,
      cx - px * 2.4, cy - py * 2.4,
    ]).fill({ color: t.trim, alpha: 0.45 });
    // Banner on the leader.
    const bx = L.x - Math.cos(L.facing) * 3, by = L.y - Math.sin(L.facing) * 3;
    if (this.upright) {
      paintStandard(g, bx, by, 26, t.blue, mixColor(t.blue, t.trim, 0.75), sim.time * 10, 0.9);
      return;
    }
    const wave = Math.sin(sim.time * 10) * 1.5;
    g.moveTo(bx, by).lineTo(bx, by - 14).stroke({ width: 1, color: t.obstacleBorder });
    g.poly([bx, by - 14, bx + 9, by - 12 + wave, bx, by - 9]).fill(t.blue);
  }

  /**
   * Calls for help: a pulsing ring round the enemy battalion to break, with an arc
   * showing the time left; off screen, an arrow at the screen's edge points the way.
   */
  private drawCalls(g: Graphics, sim: ChargeSim): void {
    const t = this.theme;
    const sg = this.callG;
    sg.clear();
    const margin = 34;
    for (const c of sim.calls) {
      const b = c.target;
      const left = Math.max(0, (c.expires - sim.time) / (c.expires - c.started));
      const pulse = 0.55 + 0.45 * Math.sin(sim.time * 6 + c.id);
      const urgent = left < 0.3;
      const color = urgent ? t.labelWarn : t.hpMid;
      const rx = (b.cols / 2) * b.spacing + 18, ry = rx * 0.62;
      g.ellipse(b.x, b.y, rx, ry).stroke({ width: 2, color, alpha: 0.35 + 0.45 * pulse });
      // Time left: an arc round the top of the ring that shrinks away.
      const a0 = -Math.PI / 2 - Math.PI * left, a1 = -Math.PI / 2 + Math.PI * left;
      const steps = 24;
      g.moveTo(b.x + Math.cos(a0) * (rx + 5), b.y + Math.sin(a0) * (ry + 5));
      for (let i = 1; i <= steps; i++) {
        const a = a0 + (a1 - a0) * (i / steps);
        g.lineTo(b.x + Math.cos(a) * (rx + 5), b.y + Math.sin(a) * (ry + 5));
      }
      g.stroke({ width: 2.4, color, alpha: 0.9, cap: 'round' });
      if (c.ally) {
        // Our buckling line, faintly marked.
        const ax = (c.ally.cols / 2) * c.ally.spacing + 14;
        g.ellipse(c.ally.x, c.ally.y, ax, ax * 0.62).stroke({ width: 1.2, color: t.blue, alpha: 0.35 * pulse });
      }

      // Off screen: an arrow at the edge, pointing at it.
      const p = this.worldToScreen(b);
      if (p.x > margin && p.x < this.viewW - margin && p.y > margin && p.y < this.viewH - margin) continue;
      const cx = this.viewW / 2, cy = this.viewH / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const k = Math.min((cx - margin) / Math.max(1e-6, Math.abs(dx)), (cy - margin) / Math.max(1e-6, Math.abs(dy)));
      const ex = cx + dx * k, ey = cy + dy * k;
      const a = Math.atan2(dy, dx);
      const s = 1 + 0.15 * pulse;
      const pts = [[13, 0], [-7, -9], [-3, 0], [-7, 9]].map(([u, v]) => [ex + (u * Math.cos(a) - v * Math.sin(a)) * s, ey + (u * Math.sin(a) + v * Math.cos(a)) * s]).flat();
      sg.poly(pts).fill({ color, alpha: 0.85 }).stroke({ width: 1.5, color: 0x1a140a, alpha: 0.6 });
      sg.circle(ex - Math.cos(a) * 16, ey - Math.sin(a) * 16, 5).stroke({ width: 2, color, alpha: 0.8 });
      // The countdown on the dot.
      sg.moveTo(ex - Math.cos(a) * 16, ey - Math.sin(a) * 16 - 5).arc(ex - Math.cos(a) * 16, ey - Math.sin(a) * 16, 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
    }
  }

  /**
   * Open side: only the enemy formation you are riding at lights up the edge you
   * would hit — amber for a flank (x2), red for the rear (x3), nothing head-on.
   */
  private drawExposed(g: Graphics, sim: ChargeSim, L: Soldier): void {
    const t = this.theme;
    // The nearest enemy formation roughly ahead of the leader.
    let best: Battalion | Squadron | null = null;
    let bestD = Infinity;
    const consider = (o: Battalion | Squadron, x: number, y: number, range: number) => {
      const d = Math.hypot(x - L.x, y - L.y);
      if (d > range || d < 1 || d >= bestD) return;
      if (Math.abs(angleDiff(L.facing, Math.atan2(y - L.y, x - L.x))) > EXPOSE_CONE) return;
      best = o; bestD = d;
    };
    for (const b of sim.battalions) if (b.team !== L.team && !b.routed) consider(b, b.x, b.y, EXPOSE_RANGE);
    for (const sq of sim.squadrons) {
      if (sq.team === L.team || !sq.riders[0]) continue;
      const c = sim.squadCenter(sq);
      consider(sq, c.x, c.y, EXPOSE_RANGE_SQUAD);
    }
    const target = best as Battalion | Squadron | null;
    if (!target) return;
    const pulse = 0.75 + 0.25 * Math.sin(sim.time * 6);
    const a = Math.min(1, (1 - bestD / EXPOSE_RANGE) * 2.5) * pulse;

    if ('grid' in target) {
      const b = target;
      const dx = b.x - L.x, dy = b.y - L.y;
      const side = attackSide(Math.atan2(dy, dx), b.facing);
      if (side === 'front') return;
      const rows = Math.ceil(b.grid.length / b.cols);
      const sp = b.spacing * sim.looseness(b);
      const hd = (rows * sp) / 2 + 3, hw = (b.cols * sp) / 2 + 3;
      const fx = Math.cos(b.facing), fy = Math.sin(b.facing); // toward the front rank
      const lx = -fy, ly = fx; // along the ranks
      let cx: number, cy: number, tx: number, ty: number, half: number;
      if (side === 'rear') {
        cx = b.x - fx * hd; cy = b.y - fy * hd; tx = lx; ty = ly; half = hw;
      } else {
        const sgn = -dx * lx - dy * ly >= 0 ? 1 : -1; // which flank faces the leader
        cx = b.x + lx * hw * sgn; cy = b.y + ly * hw * sgn; tx = fx; ty = fy; half = hd;
      }
      const color = side === 'rear' ? t.labelWarn : t.hpMid;
      const x0 = cx - tx * half, y0 = cy - ty * half, x1 = cx + tx * half, y1 = cy + ty * half;
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 7, color, alpha: 0.2 * a, cap: 'round' });
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2.4, color, alpha: 0.9 * a, cap: 'round' });
      return;
    }
    const sq = target;
    const c = sim.squadCenter(sq);
    const dx = c.x - L.x, dy = c.y - L.y;
    const side = attackSide(Math.atan2(dy, dx), sq.riders[0].facing);
    if (side === 'front') return;
    const r = 10 + Math.sqrt(sq.riders.length) * 5;
    const color = side === 'rear' ? t.labelWarn : t.hpMid;
    const ang = Math.atan2(-dy, -dx);
    g.moveTo(c.x + Math.cos(ang - 0.7) * r, c.y + Math.sin(ang - 0.7) * r).arc(c.x, c.y, r, ang - 0.7, ang + 0.7)
      .stroke({ width: 2.4, color, alpha: 0.9 * a, cap: 'round' });
  }

  // --- Camera & popups ---------------------------------------------------------------------

  private updateCamera(sim: ChargeSim, dt: number): void {
    const L = sim.leader;
    const base = this.baseZoom();
    let targetZoom = base;
    if (L) {
      // The leader is always exactly in the centre of the screen: no lag, no lead,
      // no stopping at the field's edge (the forest shows beyond it), no shake.
      this.camX = L.x;
      this.camY = L.y;
      const k = Math.min(1, L.speed / C.GALLOP_SPEED);
      targetZoom = this.holdCamera ? this.zoom : base * (1 - 0.08 * k);
    }
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-2 * dt));
    this.world.scale.set(this.zoom);
    this.world.position.set(this.viewW / 2 - this.camX * this.zoom, this.viewH / 2 - this.camY * this.zoom);
  }


  private readonly joinTags = new Map<number, BitmapText>();
  private showText = true;
  private frameNo = 0;

  /** Turn floating combat text (popups and JOIN tags) on or off. */
  setCombatText(on: boolean): void {
    this.showText = on;
    this.popupLayer.visible = on;
    if (!on) {
      for (const p of this.popups) this.releasePopup(p.text);
      this.popups.length = 0;
    }
  }

  private makeText(size: number): BitmapText {
    ensureCombatFont();
    const text = new BitmapText({ text: '', style: { fontFamily: COMBAT_FONT, fontSize: size } });
    this.popupLayer.addChild(text);
    return text;
  }

  /** "JOIN +n" tags over allied troops so it's obvious you can collect them. */
  private updateJoinTags(sim: ChargeSim): void {
    if (!this.showText) return;
    const stamp = ++this.frameNo;
    const L = sim.leader;
    for (const sq of sim.squadrons) {
      if (sq === sim.player || sq.team !== 'blue' || sq.riders.length === 0 || !L) continue;
      let tag = this.joinTags.get(sq.id);
      if (!tag) {
        tag = this.makeText(12);
        tag.anchor.set(0.5, 1);
        tag.tint = this.theme.grass ? this.theme.trim : this.theme.blue;
        this.joinTags.set(sq.id, tag);
      }
      (tag as BitmapText & { stamp?: number }).stamp = stamp;
      const label = `JOIN +${sq.riders.length}`;
      if (tag.text !== label) tag.text = label;
      const c = sim.squadCenter(sq);
      const p = this.worldToScreen({ x: c.x, y: c.y - 22 - sq.riders.length });
      tag.position.set(p.x, p.y);
      tag.alpha = 0.7 + 0.3 * Math.sin(sim.time * 4);
    }
    for (const [id, tag] of this.joinTags) {
      if ((tag as BitmapText & { stamp?: number }).stamp !== stamp) { tag.destroy(); this.joinTags.delete(id); }
    }
  }

  private popup(x: number, y: number, msg: string, color: number, size: number, life = 0.9): void {
    if (!this.showText) return;
    if (this.popups.length >= MAX_POPUPS) this.releasePopup(this.popups.shift()!.text);
    const text = this.freePopups.pop() ?? this.makeText(size);
    text.anchor.set(0.5);
    text.text = msg;
    text.style.fontSize = size;
    text.tint = color;
    text.visible = true;
    this.popups.push({ text, x, y, age: 0, life });
  }

  private readonly freePopups: BitmapText[] = [];

  private releasePopup(text: BitmapText): void {
    text.visible = false;
    this.freePopups.push(text);
  }

  private updatePopups(dt: number): void {
    this.popups = this.popups.filter(p => {
      p.age += dt;
      if (p.age >= p.life) { this.releasePopup(p.text); return false; }
      const k = p.age / p.life;
      const s = this.worldToScreen({ x: p.x, y: p.y });
      p.text.position.set(s.x, s.y - 18 - k * 30);
      p.text.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      p.text.scale.set(k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, k * 0.2));
      return true;
    });
  }
}
