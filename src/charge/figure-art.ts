import { Team, UnitType } from '../types';
import { Theme } from '../theme';
import { HORSE_VARIANTS } from '../unit-art';

/**
 * Upright figures in the manner of classic pre-rendered RTS sprites: a steep camera
 * looking down on small, naturally coloured soldiers lit by a high sun, with the team
 * colour on their cloth and shields only.
 *
 * Each figure is a small posed model of limbs (capsules) and flat plates in 3D
 * (forward, right, up). It is projected, sorted back to front and painted with soft
 * volume shading, so one model gives every facing and every frame; the view bakes
 * them all into one sheet per unit design.
 */

/** Facings around the compass (0 = east, clockwise because screen y points down). */
export const DIRS = 16;
/** Facings actually drawn: east through north to south; the west half is mirrored. */
export const DRAWN_DIRS = DIRS / 2 + 1;

/** Frame layout: standing, a walk (gallop) cycle, an attack, running away, and falling dead. */
export const IDLE_FRAME = 0;
export const WALK_FRAMES = 8;
export const ATTACK_FRAMES = 4;
export const FLEE_FRAMES = 4;
/** Falling frames; the last one is the body lying still. */
export const DEATH_FRAMES = 4;
const WALK0 = 1;
const ATTACK0 = WALK0 + WALK_FRAMES;
const FLEE0 = ATTACK0 + ATTACK_FRAMES;
const DEATH0 = FLEE0 + FLEE_FRAMES;
export const FRAMES = DEATH0 + DEATH_FRAMES;
/** The fallen, lying still (also used for a man knocked off his feet). */
export const CORPSE_FRAME = FRAMES - 1;

/** Different looks per infantry type (helmets, shields, clothes); horses vary by coat. */
export const INFANTRY_LOOKS = 2;

/** Camera elevation: steep, looking down on the troops at about 50°. */
const ELEV = (50 * Math.PI) / 180;
const GROUND = Math.sin(ELEV); // how much ground depth survives the projection
const HEIGHT = Math.cos(ELEV) * 1.15; // how tall upright things look (a touch exaggerated)
/**
 * The sun stands high and straight behind the camera's shoulder, left-right symmetric,
 * so a mirrored (west-facing) figure is lit exactly like its east-facing original.
 */
const SUN: V3 = norm([0, 0.32, 0.95]);
/** Toward the camera, for painting order and back-face flipping. */
const VIEW: V3 = [0, Math.cos(ELEV), Math.sin(ELEV)];

/** Which drawn facing shows a heading, and whether to mirror it. */
export function facingFrame(facing: number): { dir: number; mirror: boolean } {
  let a = Math.atan2(Math.sin(facing), Math.cos(facing));
  const mirror = Math.cos(a) < -1e-6;
  if (mirror) a = Math.atan2(Math.sin(a), -Math.cos(a));
  const step = (Math.PI * 2) / DIRS;
  return { dir: Math.max(0, Math.min(DRAWN_DIRS - 1, Math.round((a + Math.PI / 2) / step))), mirror };
}

/** The heading a drawn facing stands for. */
export function dirAngle(dir: number): number {
  return -Math.PI / 2 + dir * ((Math.PI * 2) / DIRS);
}

const cycle = (phase: number, n: number) => {
  const t = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  return Math.min(n - 1, Math.floor(t * n));
};
const step = (progress: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(progress * n)));

/** Frame index for a gait phase (radians, advancing with distance). */
export function walkFrame(phase: number): number {
  return WALK0 + cycle(phase, WALK_FRAMES);
}

/** Frame index for running away, by gait phase. */
export function fleeFrame(phase: number): number {
  return FLEE0 + cycle(phase, FLEE_FRAMES);
}

/** Frame index through a blow (0..1). */
export function attackFrame(progress: number): number {
  return ATTACK0 + step(progress, ATTACK_FRAMES);
}

/** Frame index through a fall (0..1); 1 is lying still. */
export function deathFrame(progress: number): number {
  return DEATH0 + step(progress, DEATH_FRAMES);
}

type V3 = [number, number, number];

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Surface finish: metal catches a sharp highlight, cloth and hide only a soft one. */
type Finish = 'matte' | 'metal';

/** `bias` (in body radii) moves a part toward the viewer in the painting order. */
type Prim =
  | { k: 'cap'; a: V3; b: V3; w: number; color: number; bias: number; finish: Finish }
  | { k: 'poly'; pts: V3[]; color: number; bias: number; finish: Finish };

function mix(a: number, b: number, k: number): number {
  const f = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (f(16) << 16) | (f(8) << 8) | f(0);
}

const lighten = (c: number, k: number) => mix(c, 0xfff6e0, k); // warm sunlight
const darken = (c: number, k: number) => mix(c, 0x10141c, k); // cool shade

/** Scale a colour's brightness (above 1 blends toward sunlight). */
function shade(c: number, k: number): number {
  return k >= 1 ? lighten(c, Math.min(1, k - 1)) : darken(c, 1 - k);
}

/** A posed figure: its parts, in unit-local 3D. */
class Model {
  prims: Prim[] = [];
  /**
   * Long weapons (levelled pike, couched lance) can be left out of the frame and
   * drawn by the view as their own sprite, turned to the exact heading every frame:
   * baked into 16 facings they visibly snap. When detached, their shaft is kept here.
   */
  detach = false;
  weapon: WeaponSegment | null = null;
  cap(a: V3, b: V3, w: number, color: number, bias = 0, finish: Finish = 'matte'): void {
    this.prims.push({ k: 'cap', a, b, w, color, bias, finish });
  }
  ball(c: V3, w: number, color: number, bias = 0, finish: Finish = 'matte'): void {
    this.prims.push({ k: 'cap', a: c, b: c, w, color, bias, finish });
  }
  poly(pts: V3[], color: number, bias = 0, finish: Finish = 'matte'): void {
    this.prims.push({ k: 'poly', pts, color, bias, finish });
  }
  /** A disc (a shield) centred at c, spanned by unit vectors u and v. */
  disc(c: V3, u: V3, v: V3, ru: number, rv: number, color: number, bias = 0, finish: Finish = 'matte', n = 16): void {
    const pts: V3[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push(onPlane(c, u, v, Math.cos(t) * ru, Math.sin(t) * rv));
    }
    this.poly(pts, color, bias, finish);
  }
  /** Move every part (for a whole-body fall). */
  transform(f: (v: V3) => V3): void {
    this.prims = this.prims.map(p => p.k === 'cap' ? { ...p, a: f(p.a), b: f(p.b) } : { ...p, pts: p.pts.map(f) });
  }
}

/** A point on the plane through c spanned by u and v. */
function onPlane(c: V3, u: V3, v: V3, a: number, b: number): V3 {
  return [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b];
}

/** Natural materials; only `team`, `teamDark` and `teamTrim` say whose man he is. */
interface Palette {
  team: number;
  teamDark: number;
  teamTrim: number;
  steel: number;
  mail: number;
  wood: number;
  leather: number;
  linen: number;
  skin: number;
  boot: number;
  gold: number;
}

function palette(team: Team, theme: Theme): Palette {
  const t = team === 'blue' ? theme.blue : theme.red;
  return {
    team: t,
    teamDark: team === 'blue' ? theme.blueDark : theme.redDark,
    teamTrim: mix(t, 0xeadfc0, 0.72),
    steel: theme.steel,
    mail: mix(theme.steel, theme.steelDark, 0.45),
    wood: theme.wood,
    leather: theme.leather,
    linen: 0xa08a64,
    skin: 0xc8906a,
    boot: 0x3a2a1c,
    gold: 0xc09a40,
  };
}

/** Horse coats: [coat, mane, legs]. */
const COATS: [number, number, number][] = [
  [0xd8d2c6, 0xb0a898, 0xb8b0a2], // grey
  [0x7a4324, 0x24140a, 0x2a1a10], // bay, black points
  [0x9c5c2c, 0x6a3a18, 0x8a5026], // chestnut
  [0xb8996a, 0x3a2c1c, 0x4a3a28], // dun
];

type PoseKind = 'idle' | 'walk' | 'attack' | 'flee' | 'die';

/** What a frame shows: its kind, the gait phase, and progress through a blow or a fall. */
function poseOf(frame: number): { kind: PoseKind; gait: number; t: number } {
  if (frame >= DEATH0) return { kind: 'die', gait: 0, t: (frame - DEATH0) / (DEATH_FRAMES - 1) };
  if (frame >= FLEE0) return { kind: 'flee', gait: ((frame - FLEE0) / FLEE_FRAMES) * Math.PI * 2, t: 0 };
  if (frame >= ATTACK0) return { kind: 'attack', gait: 0, t: (frame - ATTACK0 + 0.5) / ATTACK_FRAMES };
  if (frame >= WALK0) return { kind: 'walk', gait: ((frame - WALK0) / WALK_FRAMES) * Math.PI * 2, t: 0 };
  return { kind: 'idle', gait: 0, t: 0 };
}

/** A foot soldier, feet at the origin, about 3.4 body radii tall. */
function footman(m: Model, type: UnitType, r: number, p: Palette, frame: number, look: number): void {
  const { kind, gait, t } = poseOf(frame);
  const moving = kind === 'walk' || kind === 'flee';
  const running = kind === 'flee';
  const attack = kind === 'attack' ? t : -1;
  const armed = kind !== 'flee' && kind !== 'die';
  const swing = moving ? Math.sin(gait) * (running ? 1.35 : 1) : 0;
  const lift = moving ? (running ? 0.28 : 0.18) * r : 0;
  const bob = moving ? Math.abs(Math.cos(gait)) * (running ? 0.12 : 0.07) * r : 0;
  // Running men lean into it.
  const lean = running ? 0.25 * r : 0;
  const hipZ = 1.6 * r + bob, shZ = 2.75 * r + bob, headZ = 3.12 * r + bob;
  const hip = 0.17 * r, sh = 0.36 * r;

  // Clothes by trade and look: mail for swordsmen, a quilted or leather coat for pikes,
  // linen and leather for archers.
  const sleeve = type === 'swordsman' ? p.mail
    : type === 'pikeman' ? (look === 0 ? p.linen : 0x7a5a3a)
    : (look === 0 ? 0x8a7650 : 0x6a7048);
  const hose = type === 'swordsman' ? p.mail : type === 'pikeman' ? 0x6a5a42 : (look === 0 ? 0x5a5236 : 0x5e4a32);
  const sleeveFinish: Finish = type === 'swordsman' ? 'metal' : 'matte';
  const hair = look === 0 ? 0x4a3020 : 0x8a6a3a;

  // Legs: stride fore and aft, the foot coming forward lifts.
  for (const side of [-1, 1]) {
    const k = side * swing;
    const foot: V3 = [k * 0.45 * r, side * hip, Math.max(0, -side * Math.cos(gait)) * lift + 0.1 * r];
    const knee: V3 = [k * 0.22 * r + (foot[2] > 0.2 * r ? 0.14 * r : 0.04 * r) + lean * 0.3, side * hip, hipZ * 0.5 + foot[2] * 0.5];
    m.cap([lean * 0.4, side * hip, hipZ], knee, 0.14 * r, hose, 0, sleeveFinish);
    m.cap(knee, foot, 0.12 * r, hose, 0, sleeveFinish);
    m.cap(foot, add(foot, [0.2 * r, 0, -0.03 * r]), 0.1 * r, p.boot, 0.01);
  }

  // Upper body, leaning forward when running.
  const up = (v: V3): V3 => [v[0] + lean * ((v[2] - hipZ) / (shZ - hipZ)), v[1], v[2]];

  // Quiver on the back (archers).
  if (type === 'archer') {
    m.cap(up([-0.32 * r, -0.1 * r, 2.0 * r + bob]), up([-0.4 * r, 0.12 * r, 3.0 * r + bob]), 0.13 * r, p.leather, -0.05);
    for (const o of [-0.05, 0.05]) m.cap(up([-0.4 * r, (0.12 + o) * r, 3.0 * r + bob]), up([-0.42 * r, (0.14 + o) * r, 3.25 * r + bob]), 0.04 * r, 0xe8e0d0, -0.05);
  }

  // Body: the team's surcoat, belted, with a pale hem and folds down the front.
  m.cap([0.01 * r, 0, hipZ - 0.05 * r], up([0, 0, shZ - 0.12 * r]), 0.31 * r, p.team);
  for (const s of [-1, 1]) {
    m.poly([[0.31 * r, 0, hipZ], [0.31 * r, s * 0.3 * r, hipZ], [0.34 * r, s * 0.3 * r, hipZ - 0.5 * r], [0.34 * r, 0, hipZ - 0.55 * r]], p.team, 0.002);
    m.poly([[-0.31 * r, 0, hipZ], [-0.31 * r, s * 0.3 * r, hipZ], [-0.34 * r, s * 0.3 * r, hipZ - 0.5 * r], [-0.34 * r, 0, hipZ - 0.55 * r]], p.teamDark, -0.002);
    // Hem trim along the bottom of the skirt.
    m.poly([[0.345 * r, 0, hipZ - 0.47 * r], [0.345 * r, s * 0.3 * r, hipZ - 0.43 * r], [0.35 * r, s * 0.3 * r, hipZ - 0.5 * r], [0.35 * r, 0, hipZ - 0.55 * r]], p.teamTrim, 0.0025);
    // A fold either side of the chest.
    const fy = s * 0.13 * r;
    m.poly([up([0.32 * r, fy - 0.02 * r, shZ - 0.3 * r]), up([0.32 * r, fy + 0.02 * r, shZ - 0.3 * r]), [0.34 * r, fy + 0.035 * r, hipZ - 0.4 * r], [0.34 * r, fy - 0.035 * r, hipZ - 0.4 * r]], p.teamDark, 0.003);
  }
  // Collar trim, belt and buckle.
  m.cap(up([0.02 * r, -0.17 * r, shZ - 0.03 * r]), up([0.02 * r, 0.17 * r, shZ - 0.03 * r]), 0.07 * r, p.teamTrim, 0.0035);
  m.cap([0.03 * r, -0.29 * r, hipZ + 0.1 * r], [0.03 * r, 0.29 * r, hipZ + 0.1 * r], 0.06 * r, p.leather, 0.004);
  m.ball([0.32 * r, 0, hipZ + 0.1 * r], 0.055 * r, p.gold, 0.0045, 'metal');
  // Shoulders (a mail cape for swordsmen).
  m.cap(up([0, -sh * 0.62, shZ - 0.06 * r]), up([0, sh * 0.62, shZ - 0.06 * r]), 0.16 * r, type === 'swordsman' ? p.mail : sleeve, 0.005, sleeveFinish);

  // Head and headgear by look.
  const head = up([0.04 * r, 0, headZ]);
  m.ball(head, 0.2 * r, p.skin, 0.006);
  const beard = (type === 'pikeman' && look === 1) || (type === 'swordsman' && look === 1) || (type === 'archer' && look === 0);
  if (beard) m.ball(add(head, [0.13 * r, 0, -0.12 * r]), 0.11 * r, hair, 0.0065);
  if (type === 'swordsman') {
    if (look === 0) {
      // Conical helm with a nasal over a mail coif.
      m.cap(add(head, [-0.09 * r, 0, -0.05 * r]), add(head, [-0.09 * r, 0, -0.25 * r]), 0.17 * r, p.mail, 0.0055, 'metal');
      m.ball(add(head, [-0.04 * r, 0, 0.06 * r]), 0.22 * r, p.steel, 0.007, 'metal');
      m.cap(add(head, [-0.04 * r, 0, 0.15 * r]), add(head, [-0.04 * r, 0, 0.3 * r]), 0.08 * r, p.steel, 0.0072, 'metal');
      m.cap(add(head, [0.17 * r, 0, 0.05 * r]), add(head, [0.19 * r, 0, -0.13 * r]), 0.035 * r, p.steel, 0.0075, 'metal');
    } else {
      // Brimmed iron hat.
      m.disc(add(head, [-0.04 * r, 0, 0.12 * r]), [1, 0, 0], [0, 1, 0], 0.32 * r, 0.32 * r, p.steel, 0.007, 'metal');
      m.ball(add(head, [-0.04 * r, 0, 0.14 * r]), 0.19 * r, p.steel, 0.0075, 'metal');
    }
  } else if (type === 'pikeman') {
    if (look === 0) {
      // Kettle hat: a dome over a broad brim.
      m.disc(add(head, [-0.04 * r, 0, 0.1 * r]), [1, 0, 0], [0, 1, 0], 0.38 * r, 0.38 * r, p.steel, 0.007, 'metal');
      m.ball(add(head, [-0.04 * r, 0, 0.13 * r]), 0.2 * r, p.steel, 0.0075, 'metal');
    } else {
      // Padded arming cap.
      m.ball(add(head, [-0.06 * r, 0, 0.06 * r]), 0.21 * r, 0x8a7448, 0.007);
    }
  } else if (look === 0) {
    // Leather hood and cowl.
    m.ball(add(head, [-0.07 * r, 0, 0.05 * r]), 0.23 * r, 0x6a5232, 0.007);
    m.ball(add(head, [0.07 * r, 0, -0.02 * r]), 0.14 * r, p.skin, 0.0075);
    m.cap(add(head, [-0.09 * r, -0.25 * r, -0.25 * r]), add(head, [-0.09 * r, 0.25 * r, -0.25 * r]), 0.12 * r, 0x6a5232, 0.0068);
  } else {
    // Bareheaded, with a headband in the team's colour.
    m.ball(add(head, [-0.06 * r, 0, 0.05 * r]), 0.2 * r, hair, 0.007);
    m.cap(add(head, [0.02 * r, -0.19 * r, 0.06 * r]), add(head, [0.02 * r, 0.19 * r, 0.06 * r]), 0.04 * r, p.team, 0.0075);
  }

  const L = up([0, -sh, shZ - 0.05 * r]), R = up([0, sh, shZ - 0.05 * r]);
  const arm = (from: V3, hand: V3, bias = 0.01) => {
    const elbow: V3 = [(from[0] + hand[0]) / 2 - 0.05 * r, (from[1] + hand[1]) / 2 + Math.sign(from[1]) * 0.07 * r, (from[2] + hand[2]) / 2 - 0.1 * r];
    m.cap(from, elbow, 0.11 * r, sleeve, bias, sleeveFinish);
    m.cap(elbow, hand, 0.1 * r, sleeve, bias, sleeveFinish);
    m.ball(hand, 0.08 * r, type === 'swordsman' ? p.leather : p.skin, bias + 0.001);
  };

  if (!armed) {
    // Weapon gone: arms pump as he runs (or fly up as he falls).
    if (kind === 'die') {
      arm(L, [-0.1 * r, -0.62 * r, shZ + 0.55 * r]);
      arm(R, [-0.05 * r, 0.62 * r, shZ + 0.5 * r]);
    } else {
      arm(L, up([0.3 * r * swing, -0.42 * r, 2.15 * r + bob]), 0.01);
      arm(R, up([-0.3 * r * swing, 0.42 * r, 2.15 * r + bob]), 0.01);
    }
    return;
  }

  if (type === 'swordsman') {
    // Shield on the left arm, carried well forward so its painted face shows from most
    // sides; sword in the right hand: raised, then a cut down and across.
    const shieldC: V3 = [0.5 * r, -0.32 * r, 2.15 * r + bob];
    arm(L, [0.42 * r, -0.3 * r, 2.2 * r + bob], 0.05);
    const sU: V3 = [0, 0, 1], sV: V3 = norm([0.55, 0.83, 0]);
    if (look === 0) {
      const kite = (scale: number, color: number, bias: number) => {
        const s = r * scale;
        m.poly([[0.55, -0.32], [0.6, 0], [0.55, 0.32], [0, 0.34], [-0.75, 0], [0, -0.34]].map(([u, v]) => onPlane(shieldC, sU, sV, u * s, v * s)), color, bias);
      };
      kite(1.08, 0x4a3420, 0.12);
      kite(1, p.team, 0.121);
      // A pale stripe down the middle.
      m.poly([[0.58, -0.06], [0.58, 0.06], [-0.6, 0.04], [-0.6, -0.04]].map(([u, v]) => onPlane(shieldC, sU, sV, u * r, v * r)), p.teamTrim, 0.1215);
      m.disc(onPlane(shieldC, sU, sV, 0.12 * r, 0), sU, sV, 0.09 * r, 0.09 * r, p.steel, 0.122, 'metal', 10);
    } else {
      // Round shield, quartered by a pale cross, iron rim and boss.
      m.disc(shieldC, sU, sV, 0.47 * r, 0.47 * r, 0x5a5a5e, 0.12, 'metal');
      m.disc(shieldC, sU, sV, 0.42 * r, 0.42 * r, p.team, 0.121);
      m.poly([[0.42, -0.05], [0.42, 0.05], [-0.42, 0.05], [-0.42, -0.05]].map(([u, v]) => onPlane(shieldC, sU, sV, u * r, v * r)), p.teamTrim, 0.1212);
      m.poly([[-0.05, -0.42], [0.05, -0.42], [0.05, 0.42], [-0.05, 0.42]].map(([u, v]) => onPlane(shieldC, sU, sV, u * r, v * r)), p.teamTrim, 0.1214);
      m.disc(shieldC, sU, sV, 0.1 * r, 0.1 * r, p.steel, 0.122, 'metal', 10);
    }
    let hand: V3, tip: V3;
    if (attack >= 0) {
      const a = Math.min(1, attack * 1.25);
      const ang = -2.0 + a * 3.0; // from overhead-behind to forward-low
      hand = [0.28 * r + Math.sin(ang) * 0.42 * r, 0.4 * r, shZ + 0.1 * r + Math.cos(ang) * 0.32 * r];
      tip = add(hand, [Math.sin(ang) * 1.25 * r, -0.1 * r, Math.cos(ang) * 1.25 * r]);
    } else {
      hand = [0.28 * r - swing * 0.15 * r, 0.44 * r, 1.95 * r + bob];
      tip = add(hand, [0.85 * r, 0, 0.75 * r]);
    }
    arm(R, hand);
    m.cap(hand, tip, 0.05 * r, lighten(p.steel, 0.2), 0.015, 'metal');
    m.cap(add(hand, [0, -0.13 * r, 0]), add(hand, [0, 0.13 * r, 0]), 0.04 * r, p.gold, 0.016, 'metal');
  } else if (type === 'pikeman') {
    // Pike levelled at the enemy, both hands on the shaft; a thrust drives it on.
    // At rest it stands upright beside him, so a halted block bristles like a hedge.
    const len = 5.4 * r;
    let back: V3, front: V3;
    if (frame === IDLE_FRAME) {
      back = [0.3 * r, 0.4 * r, 0.05 * r];
      front = add(back, [0.1 * r, 0, len]);
      arm(L, [0.2 * r, -0.36 * r, 1.85 * r]);
      arm(R, [0.3 * r, 0.4 * r, 2.4 * r]);
    } else {
      const push = attack >= 0 ? Math.sin(Math.min(1, attack) * Math.PI) * 0.7 * r : 0;
      back = [-1.1 * r + push, 0.28 * r, 2.25 * r + bob];
      front = add(back, [len, 0, 0.1 * r]);
      arm(L, add(back, [1.55 * r, -0.05 * r, 0]));
      arm(R, add(back, [0.55 * r, 0, 0]));
    }
    if (m.detach && frame !== IDLE_FRAME) {
      m.weapon = { butt: back, tip: front };
      return;
    }
    m.cap(back, front, 0.055 * r, p.wood, 0.02);
    const ux = (front[0] - back[0]) / len, uz = (front[2] - back[2]) / len;
    m.poly([add(front, [-uz * 0.08 * r, 0, ux * 0.08 * r]), add(front, [ux * 0.5 * r, 0, uz * 0.5 * r]), add(front, [uz * 0.08 * r, 0, -ux * 0.08 * r])], p.steel, 0.021, 'metal');
  } else {
    // Longbow held out in the left hand; the right hand draws the string to the cheek.
    const draw = attack >= 0 ? Math.min(1, attack * 1.6) * (attack > 0.85 ? 0 : 1) : 0;
    const bowHand: V3 = attack >= 0 ? [0.8 * r, -0.12 * r, 2.65 * r + bob] : [0.32 * r - swing * 0.1 * r, -0.4 * r, 2.0 * r + bob];
    arm(L, bowHand, attack >= 0 ? 0.02 : -0.002);
    const upv: V3 = attack >= 0 ? [0, 0, 1] : [0.35, 0, 0.94];
    const limb = 1.05 * r;
    const bend = attack >= 0 ? -0.16 * r - draw * 0.15 * r : -0.14 * r;
    const top = add(bowHand, [upv[0] * limb + bend, upv[1] * limb, upv[2] * limb]);
    const bot = add(bowHand, [-upv[0] * limb + bend, -upv[1] * limb, -upv[2] * limb]);
    const grip = add(bowHand, [0.07 * r, 0, 0]);
    m.cap(top, grip, 0.045 * r, p.wood, 0.025);
    m.cap(grip, bot, 0.045 * r, p.wood, 0.025);
    const nock: V3 = attack >= 0 ? add(bowHand, [-0.25 * r - draw * 0.6 * r, 0.05 * r, 0.1 * r]) : add(bowHand, [-0.1 * r, 0, 0]);
    m.cap(top, nock, 0.012 * r, 0xe8e0c8, 0.026);
    m.cap(nock, bot, 0.012 * r, 0xe8e0c8, 0.026);
    if (attack >= 0 && attack <= 0.85) m.cap(nock, add(bowHand, [0.35 * r, 0, 0]), 0.025 * r, 0xd8c8a0, 0.027);
    arm(R, attack >= 0 ? add(nock, [0, 0.05 * r, 0]) : [0.24 * r + swing * 0.12 * r, 0.44 * r, 1.95 * r + bob], 0.02);
  }
}

/** What a horseman carries: a couched lance (knights) or a bow (horse archers). */
export type RiderGear = 'lance' | 'bow';

/** The weapon a fallen man dropped, lying on the ground beside him. */
function droppedWeapon(m: Model, type: UnitType, r: number, p: Palette, gear: RiderGear = 'lance'): void {
  if (type === 'cavalry' && gear === 'bow') {
    m.cap([0.6 * r, 1.0 * r, 0.05 * r], [1.3 * r, 1.5 * r, 0.05 * r], 0.045 * r, p.wood);
    m.cap([1.3 * r, 1.5 * r, 0.05 * r], [2.1 * r, 1.35 * r, 0.05 * r], 0.045 * r, p.wood);
    return;
  }
  if (type === 'swordsman') {
    m.cap([0.6 * r, 0.7 * r, 0.05 * r], [1.6 * r, 0.95 * r, 0.05 * r], 0.05 * r, lighten(p.steel, 0.2), 0, 'metal');
    m.cap([0.6 * r, 0.55 * r, 0.05 * r], [0.65 * r, 0.85 * r, 0.05 * r], 0.04 * r, p.gold, 0.001, 'metal');
  } else if (type === 'pikeman') {
    m.cap([1.2 * r, 0.9 * r, 0.05 * r], [-3.8 * r, 1.3 * r, 0.05 * r], 0.055 * r, p.wood);
    m.poly([[1.2 * r, 0.82 * r, 0.05 * r], [1.7 * r, 0.86 * r, 0.05 * r], [1.2 * r, 0.98 * r, 0.05 * r]], p.steel, 0.001, 'metal');
  } else if (type === 'archer') {
    m.cap([0.5 * r, 0.75 * r, 0.05 * r], [1.2 * r, 1.3 * r, 0.05 * r], 0.045 * r, p.wood);
    m.cap([1.2 * r, 1.3 * r, 0.05 * r], [2.0 * r, 1.2 * r, 0.05 * r], 0.045 * r, p.wood);
  } else {
    m.cap([1.0 * r, 1.2 * r, 0.05 * r], [-2.6 * r, 1.6 * r, 0.05 * r], 0.055 * r, p.wood);
  }
}

/** A knight on a barded horse (or a horse archer), hooves at the origin. */
function horseman(m: Model, r: number, p: Palette, frame: number, variant: number, gear: RiderGear = 'lance'): void {
  const bow = gear === 'bow';
  const { kind, gait, t } = poseOf(frame);
  const moving = kind === 'walk' || kind === 'flee';
  const attack = kind === 'attack' ? t : -1;
  const armed = kind !== 'flee' && kind !== 'die';
  const [coat, mane, points] = COATS[((variant % HORSE_VARIANTS) + HORSE_VARIANTS) % HORSE_VARIANTS % COATS.length];
  const crest = variant % 2 === 1;
  const rise = moving ? Math.sin(gait) * 0.1 * r : 0;
  const pitch = moving ? Math.cos(gait) * 0.07 : 0;
  const bodyZ = 1.75 * r + rise;
  const front = 0.75 * r, rear = -0.8 * r;
  const z = (x: number) => bodyZ + x * pitch;

  // Legs: a gallop's footfalls come round in turn (hind left, hind right, fore left, fore right).
  // A falling horse's legs buckle.
  const legs: [number, number, number][] = [[rear + 0.12 * r, -1, 0], [rear + 0.12 * r, 1, 0.12], [front - 0.08 * r, -1, 0.5], [front - 0.08 * r, 1, 0.62]];
  for (const [x, side, off] of legs) {
    const hindLeg = x < 0;
    const ph = gait + off * Math.PI * 2;
    const swingA = moving ? Math.sin(ph) * (hindLeg ? 0.55 : 0.7) : kind === 'die' ? (hindLeg ? -0.5 : 0.6) * side : (hindLeg ? -0.05 : 0.05);
    const fold = moving ? Math.max(0, Math.cos(ph)) * (hindLeg ? 0.9 : -1.2) : kind === 'die' ? (hindLeg ? 0.8 : -0.9) : 0;
    const hipP: V3 = [x, side * 0.25 * r, z(x) - 0.25 * r];
    const upper = 0.68 * r, lower = 0.8 * r;
    const knee: V3 = add(hipP, [Math.sin(swingA) * upper, 0, -Math.cos(swingA) * upper]);
    const la = swingA + fold;
    const hoof: V3 = add(knee, [Math.sin(la) * lower, 0, -Math.cos(la) * lower]);
    m.cap(hipP, knee, (hindLeg ? 0.2 : 0.16) * r, coat);
    m.cap(knee, hoof, 0.085 * r, points);
    m.ball(hoof, 0.1 * r, 0x2a2018, 0.001);
  }

  // Tail streams out behind at speed.
  const tailEnd: V3 = moving ? [rear - 0.95 * r, 0, z(rear) - 0.1 * r] : [rear - 0.35 * r, 0, z(rear) - 0.95 * r];
  m.cap([rear - 0.15 * r, 0, z(rear) + 0.15 * r], tailEnd, 0.12 * r, mane, -0.01);

  // Barrel, hindquarters and chest, then neck and head.
  m.cap([rear, 0, z(rear)], [front, 0, z(front)], 0.5 * r, coat);
  m.ball([rear + 0.1 * r, 0, z(rear) + 0.05 * r], 0.5 * r, coat, 0.001);
  const neckTop: V3 = [front + 0.55 * r, 0, z(front) + (moving ? 0.65 : 0.85) * r];
  m.cap([front - 0.05 * r, 0, z(front) + 0.05 * r], neckTop, 0.26 * r, coat, 0.02);
  const muzzle: V3 = add(neckTop, [0.48 * r, 0, moving ? -0.3 * r : -0.45 * r]);
  m.cap(neckTop, muzzle, 0.17 * r, coat, 0.03);
  m.ball(add(muzzle, [0.02 * r, 0, -0.02 * r]), 0.12 * r, darken(coat, 0.3), 0.031);
  m.cap(add(neckTop, [-0.05 * r, 0, 0.14 * r]), add(neckTop, [-0.55 * r, 0, -0.3 * r]), 0.08 * r, mane, 0.025);
  for (const side of [-1, 1]) m.ball(add(neckTop, [0.02 * r, side * 0.08 * r, 0.2 * r]), 0.05 * r, darken(coat, 0.2), 0.032);
  // Bridle and reins.
  m.cap(add(neckTop, [0.1 * r, 0, 0.05 * r]), add(muzzle, [-0.05 * r, 0, 0.02 * r]), 0.03 * r, 0x2a1a10, 0.033);

  // Barding: a cloth in the team's colour over the back and flanks, with folds and a pale hem.
  const top = z(0) + 0.42 * r, hem = z(0) - 0.5 * r;
  m.poly([[rear - 0.05 * r, -0.35 * r, top], [front * 0.75, -0.35 * r, top], [front * 0.75, 0.35 * r, top], [rear - 0.05 * r, 0.35 * r, top]], p.team, 0.12);
  for (const side of [-1, 1]) {
    const y = side * 0.53 * r;
    m.poly([[rear - 0.05 * r, side * 0.35 * r, top], [front * 0.75, side * 0.35 * r, top], [front * 0.85, y, hem], [rear - 0.12 * r, y, hem]], p.team, 0.15);
    for (const fx of [-0.45, 0.05, 0.45]) {
      m.poly([[fx * r - 0.03 * r, side * 0.36 * r, top - 0.05 * r], [fx * r + 0.03 * r, side * 0.36 * r, top - 0.05 * r], [fx * r + 0.07 * r, y * 1.005, hem + 0.1 * r], [fx * r - 0.07 * r, y * 1.005, hem + 0.1 * r]], p.teamDark, 0.1505);
    }
    m.poly([[rear - 0.12 * r, y * 1.01, hem + 0.09 * r], [front * 0.85, y * 1.01, hem + 0.09 * r], [front * 0.85, y * 1.01, hem], [rear - 0.12 * r, y * 1.01, hem]], p.teamTrim, 0.151);
  }
  m.cap([-0.4 * r, 0, top + 0.06 * r], [0.25 * r, 0, top + 0.06 * r], 0.16 * r, p.leather, 0.16);

  // Rider in mail and a team surcoat, legs down the horse's sides, leaning into the gallop.
  const seat: V3 = [-0.15 * r, 0, top + 0.2 * r];
  const lean = kind === 'flee' ? 0.45 * r : moving ? 0.3 * r : 0.05 * r;
  const shoulder: V3 = add(seat, [lean, 0, 1.0 * r]);
  for (const side of [-1, 1]) {
    const knee: V3 = [0.22 * r, side * 0.56 * r, z(0) + 0.05 * r];
    m.cap([seat[0], side * 0.18 * r, seat[2]], knee, 0.13 * r, p.mail, 0.2, 'metal');
    m.cap(knee, [0.08 * r, side * 0.6 * r, z(0) - 0.55 * r], 0.11 * r, p.mail, 0.2, 'metal');
  }
  m.cap(add(seat, [0, 0, 0.15 * r]), shoulder, 0.28 * r, p.team, 0.25);
  m.cap(add(seat, [0.02 * r, -0.26 * r, 0.22 * r]), add(seat, [0.02 * r, 0.26 * r, 0.22 * r]), 0.06 * r, p.leather, 0.2505);
  m.cap(add(shoulder, [0, -0.3 * r, -0.05 * r]), add(shoulder, [0, 0.3 * r, -0.05 * r]), 0.15 * r, p.mail, 0.251, 'metal');
  const head: V3 = add(shoulder, [0.06 * r, 0, 0.38 * r]);
  if (bow) {
    // Horse archer: a light pointed helmet with a team scarf, no shield, a quiver at the hip.
    m.cap(add(head, [0, 0, -0.06 * r]), add(head, [0, 0, 0.06 * r]), 0.17 * r, p.steel, 0.253, 'metal');
    m.cap(add(head, [0, 0, 0.12 * r]), add(head, [-0.02 * r, 0, 0.34 * r]), 0.06 * r, p.steel, 0.2535, 'metal');
    m.cap(add(head, [-0.05 * r, -0.17 * r, -0.12 * r]), add(head, [-0.05 * r, 0.17 * r, -0.12 * r]), 0.06 * r, p.team, 0.254);
    const qTop: V3 = add(seat, [-0.35 * r, 0.32 * r, 0.55 * r]), qBot: V3 = add(seat, [-0.1 * r, 0.36 * r, -0.15 * r]);
    m.cap(qBot, qTop, 0.11 * r, p.leather, 0.24);
    for (const k of [-1, 0, 1]) m.cap(qTop, add(qTop, [-0.12 * r, k * 0.06 * r, 0.22 * r]), 0.03 * r, 0xe8e0c8, 0.241);
    if (!armed) {
      m.cap(add(shoulder, [0, 0.3 * r, 0]), kind === 'die' ? add(shoulder, [0, 0.6 * r, 0.5 * r]) : add(shoulder, [0.32 * r, 0.36 * r, -0.4 * r]), 0.1 * r, p.mail, 0.02, 'metal');
      return;
    }
    // Recurve bow held out on the left; the string drawn back to the cheek as he looses.
    const draw = attack >= 0 ? Math.sin(Math.min(1, attack * 1.4) * Math.PI) : 0;
    const grip: V3 = add(shoulder, [0.5 * r, -0.5 * r, -0.05 * r]);
    const tipUp: V3 = add(grip, [-0.12 * r, 0, 0.78 * r]), tipDn: V3 = add(grip, [-0.12 * r, 0, -0.62 * r]);
    const midUp: V3 = add(grip, [0.1 * r, 0, 0.42 * r]), midDn: V3 = add(grip, [0.1 * r, 0, -0.34 * r]);
    const wood = darken(p.wood, 0.15);
    m.cap(grip, midUp, 0.05 * r, wood, 0.03);
    m.cap(midUp, tipUp, 0.04 * r, wood, 0.031);
    m.cap(grip, midDn, 0.05 * r, wood, 0.03);
    m.cap(midDn, tipDn, 0.04 * r, wood, 0.031);
    const nock: V3 = add(grip, [-(0.18 + 0.55 * draw) * r, 0.1 * r * draw, 0.05 * r]);
    m.cap(tipUp, nock, 0.012 * r, 0xf0ead8, 0.032);
    m.cap(nock, tipDn, 0.012 * r, 0xf0ead8, 0.032);
    m.cap(add(shoulder, [0, -0.3 * r, 0]), grip, 0.1 * r, p.mail, 0.02, 'metal');
    m.cap(add(shoulder, [0, 0.3 * r, 0]), nock, 0.1 * r, p.mail, 0.021, 'metal');
    if (draw > 0.2) m.cap(nock, add(grip, [0.35 * r, 0, 0.05 * r]), 0.02 * r, 0xe8e0c8, 0.033);
    return;
  }
  // Great helm with a plume (or a crest) in the team's colour.
  m.cap(add(head, [0, 0, -0.08 * r]), add(head, [0, 0, 0.1 * r]), 0.21 * r, p.steel, 0.253, 'metal');
  m.cap(add(head, [0.2 * r, -0.12 * r, 0.02 * r]), add(head, [0.2 * r, 0.12 * r, 0.02 * r]), 0.02 * r, 0x1a1a1a, 0.254);
  if (crest) m.cap(add(head, [0.12 * r, 0, 0.3 * r]), add(head, [-0.2 * r, 0, 0.3 * r]), 0.07 * r, p.gold, 0.255, 'metal');
  else m.cap(add(head, [0, 0, 0.26 * r]), add(head, [-0.35 * r, 0, 0.38 * r]), 0.08 * r, p.team, 0.255);

  // Heater shield on the left arm.
  const shieldC: V3 = add(shoulder, [0.12 * r, -0.4 * r, -0.45 * r]);
  m.cap(add(shoulder, [0, -0.3 * r, 0]), add(shieldC, [0, 0.1 * r, 0.1 * r]), 0.1 * r, p.mail, 0, 'metal');
  const sU: V3 = [0, 0, 1], sV: V3 = norm([0.85, 0.53, 0]);
  const heater = (scale: number, color: number, bias: number) => {
    const s = r * scale;
    m.poly([[0.4, -0.36], [0.4, 0.36], [0, 0.36], [-0.55, 0], [0, -0.36]].map(([u, v]) => onPlane(shieldC, sU, sV, u * s, v * s)), color, bias);
  };
  heater(1.1, 0x4a3420, 0.01);
  heater(1, p.team, 0.011);
  // A pale chevron on the shield.
  m.poly([[-0.25, 0], [0.12, -0.3], [0.2, -0.22], [-0.17, 0.08]].map(([u, v]) => onPlane(shieldC, sU, sV, u * r, v * r)), p.teamTrim, 0.012);
  m.poly([[-0.25, 0], [0.12, 0.3], [0.2, 0.22], [-0.17, -0.08]].map(([u, v]) => onPlane(shieldC, sU, sV, u * r, v * r)), p.teamTrim, 0.0121);

  const hand: V3 = add(shoulder, [0.32 * r, 0.36 * r, -0.4 * r]);
  if (!armed) {
    // Lance thrown away: the rein hand forward, the other up.
    m.cap(add(shoulder, [0, 0.3 * r, 0]), kind === 'die' ? add(shoulder, [0, 0.6 * r, 0.5 * r]) : hand, 0.1 * r, p.mail, 0.02, 'metal');
    return;
  }
  // Lance couched under the right arm; the strike drives it forward.
  const thrust = attack >= 0 ? Math.sin(Math.min(1, attack * 1.2) * Math.PI) * 0.8 * r : 0;
  const lanceHand = add(hand, [thrust, 0, 0]);
  m.cap(add(shoulder, [0, 0.3 * r, 0]), lanceHand, 0.1 * r, p.mail, 0.02, 'metal');
  const butt: V3 = add(lanceHand, [-0.9 * r, 0.02 * r, 0.12 * r]);
  const tip: V3 = add(lanceHand, [3.4 * r, 0.05 * r, moving || attack >= 0 ? -0.35 * r : 1.2 * r]);
  if (m.detach) {
    m.weapon = { butt, tip };
    return;
  }
  m.cap(butt, tip, 0.055 * r, p.wood, 0.01);
  const dx = tip[0] - butt[0], dz = tip[2] - butt[2], len = Math.hypot(dx, dz);
  const at = (k: number, upAmt: number): V3 => [butt[0] + dx * k - (dz / len) * upAmt, tip[1], butt[2] + dz * k + (dx / len) * upAmt];
  m.poly([at(0.97, 0.035 * r), at(1.1, 0), at(0.97, -0.035 * r)], p.steel, 0.011, 'metal');
  m.poly([at(0.8, 0), at(0.92, 0), at(0.82, -0.3 * r)], p.team, 0.012);
}

/** A tiny drawing surface: what a figure needs to be painted (Canvas 2D in the game). */
export interface Painter {
  circle(x: number, y: number, r: number, color: number, alpha?: number): void;
  /** A stroke with round ends. */
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha?: number): void;
  /** A filled polygon, optionally grown by a rim of the same colour. */
  poly(pts: number[], color: number, alpha?: number, rim?: number): void;
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Paint figures onto a 2D canvas (fast: no tessellation, rasterised natively). */
export function canvasPainter(ctx: CanvasRenderingContext2D): Painter {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return {
    circle(x, y, r, color, alpha = 1) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = css(color);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    },
    line(x0, y0, x1, y1, width, color, alpha = 1) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = css(color);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    },
    poly(pts, color, alpha = 1, rim = 0) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = css(color);
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fill();
      if (rim > 0) {
        ctx.strokeStyle = css(color);
        ctx.lineWidth = rim * 2;
        ctx.stroke();
      }
    },
  };
}

/** A long weapon's shaft in unit-local 3D (forward, right, up), butt to tip. */
export interface WeaponSegment {
  butt: V3;
  tip: V3;
}

export interface FigureFrame {
  /** Bounds in local units (origin at the feet). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** The detached long weapon for this frame, if any (see buildFigure's `detachWeapon`). */
  weapon: WeaponSegment | null;
  draw(p: Painter, ox: number, oy: number): void;
}

/**
 * Where a unit-local point lands on screen for a figure facing `angle`, relative to
 * its feet. `mirror` matches a mirrored (west-facing) sprite, whose handedness flips.
 */
export function projectLocal(v: readonly number[], angle: number, mirror = false): { x: number; y: number; depth: number } {
  const f = v[0], s = mirror ? -v[1] : v[1], z = v[2];
  const c = Math.cos(angle), sn = Math.sin(angle);
  const wx = f * c - s * sn, wy = f * sn + s * c;
  return { x: wx, y: wy * GROUND - z * HEIGHT, depth: wy };
}

/**
 * Paint a long weapon lying along +x from its butt at (ox, oy) for `len` units, in
 * the figures' shading: a lance with its steel head and team pennant (hanging toward
 * +y), or a pike with its long blade.
 */
export function paintLongWeapon(g: Painter, kind: 'lance' | 'pike', team: Team, r: number, theme: Theme, len: number, ox: number, oy: number): void {
  const p = palette(team, theme);
  const w = 0.055 * r;
  const rim = Math.max(0.18, r * 0.035);
  const x1 = ox + len;
  g.line(ox, oy, x1, oy, (w + rim) * 2, 0x1c1a14);
  if (kind === 'lance') {
    const head = [x1 - 0.03 * len, oy - 0.035 * r, x1 + 0.1 * len, oy, x1 - 0.03 * len, oy + 0.035 * r];
    const pen = [ox + 0.8 * len, oy, ox + 0.92 * len, oy, ox + 0.82 * len, oy + 0.3 * r];
    g.poly(head, 0x1c1a14, 1, rim);
    g.poly(pen, 0x1c1a14, 1, rim);
    g.line(ox, oy, x1, oy, w * 2, shade(p.wood, 0.75));
    g.line(ox, oy - w * 0.3, x1, oy - w * 0.3, w * 0.9, shade(p.wood, 1.1));
    g.poly(head, shade(p.steel, 1.1));
    g.poly(pen, p.team);
    g.poly([ox + 0.8 * len, oy, ox + 0.92 * len, oy, ox + 0.86 * len, oy + 0.1 * r], shade(p.team, 1.15));
    return;
  }
  const blade = [x1, oy - 0.08 * r, x1 + 0.5 * r, oy, x1, oy + 0.08 * r];
  g.poly(blade, 0x1c1a14, 1, rim);
  g.line(ox, oy, x1, oy, w * 2, shade(p.wood, 0.75));
  g.line(ox, oy - w * 0.3, x1, oy - w * 0.3, w * 0.9, shade(p.wood, 1.1));
  g.poly(blade, shade(p.steel, 1.1));
  g.poly([x1, oy - 0.08 * r, x1 + 0.5 * r, oy, x1, oy], shade(p.steel, 1.4));
}

interface Shape {
  depth: number;
  order: number;
  pts: [number, number][];
  w: number;
  color: number;
  cap: boolean;
  finish: Finish;
  /** Flat parts: how squarely they face the sun (0..1). */
  lit: number;
  /** Height of the part above the ground, for ambient occlusion near the feet. */
  z: number;
}

/** Screen direction the sun comes from (for highlights on rounded parts). */
const SUN_SCREEN = (() => {
  const x = SUN[0], y = SUN[1] * GROUND - SUN[2] * HEIGHT, l = Math.hypot(x, y);
  return [x / l, y / l] as const;
})();

/**
 * Build one frame of a unit design facing `angle`, ready to paint at any offset.
 * `variant` picks the horse coat for cavalry and the look for infantry. With
 * `detachWeapon`, a levelled pike or couched lance is left out and returned as
 * `weapon` for the caller to draw at the exact heading.
 */
export function buildFigure(type: UnitType, team: Team, r: number, theme: Theme, variant: number, angle: number, frame: number, detachWeapon = false, gear: RiderGear = 'lance'): FigureFrame {
  const m = new Model();
  m.detach = detachWeapon;
  const p = palette(team, theme);
  const { kind, t } = poseOf(frame);
  if (type === 'cavalry') horseman(m, r, p, frame, variant, gear);
  else footman(m, type, r, p, frame, ((variant % INFANTRY_LOOKS) + INFANTRY_LOOKS) % INFANTRY_LOOKS);
  if (kind === 'die') {
    // Struck down: footmen topple backwards, a horse rolls onto its side.
    const a = [0.45, 0.95, 1.35, 1.55][Math.round(t * (DEATH_FRAMES - 1))];
    const c = Math.cos(a), s = Math.sin(a);
    if (type === 'cavalry') m.transform(([f, y, h]) => [f, y * c + h * s, -y * s + h * c + 0.55 * r * s]);
    else m.transform(([f, y, h]) => [f * c - h * s, y, f * s + h * c + 0.3 * r * s]);
    if (t >= 1) droppedWeapon(m, type, r, p, gear);
  }

  const cos = Math.cos(angle), sin = Math.sin(angle);
  const world = (v: V3): V3 => [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos, v[2]];
  const screen = (w: V3): [number, number] => [w[0], w[1] * GROUND - w[2] * HEIGHT];
  const depthOf = (w: V3) => w[0] * VIEW[0] + w[1] * VIEW[1] + w[2] * VIEW[2];

  const shapes: Shape[] = m.prims.map((pr, order) => {
    const pts3 = (pr.k === 'cap' ? [pr.a, pr.b] : pr.pts).map(world);
    let lit = 1;
    if (pr.k === 'poly' && pts3.length >= 3) {
      // Lambert shading for flat parts, with the face turned toward the camera.
      const [a, b, c] = [pts3[0], pts3[Math.floor(pts3.length / 3)], pts3[Math.floor((pts3.length * 2) / 3)]];
      const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
      if (n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2] < 0) n = [-n[0], -n[1], -n[2]];
      lit = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
    }
    const depth = pts3.reduce((s, q) => s + depthOf(q), 0) / pts3.length;
    return {
      depth: depth + pr.bias * r,
      order,
      pts: pts3.map(screen),
      w: pr.k === 'cap' ? pr.w : 0,
      color: pr.color,
      cap: pr.k === 'cap',
      finish: pr.finish,
      lit,
      z: pts3.reduce((s, q) => s + q[2], 0) / pts3.length,
    };
  });
  shapes.sort((a, b) => a.depth - b.depth || a.order - b.order);

  // Soft ground shadow under the figure, stretched along the horse (or the fallen body).
  const lying = kind === 'die' ? t : 0;
  const sl = type === 'cavalry' ? 1.7 * r : (0.6 + 1.2 * lying) * r, sw = type === 'cavalry' ? (0.7 + 0.6 * lying) * r : 0.5 * r;
  const sx = type === 'cavalry' ? 0 : -lying * 1.4 * r;
  const shadowAt = (k: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      out.push(screen(world([sx + Math.cos(a) * sl * k, Math.sin(a) * sw * k, 0])));
    }
    return out;
  };
  const shadows = [shadowAt(1.25), shadowAt(1), shadowAt(0.7)];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number, pad: number) => {
    minX = Math.min(minX, x - pad); maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad); maxY = Math.max(maxY, y + pad);
  };
  const rim = Math.max(0.18, r * 0.035);
  for (const s of shapes) for (const [x, y] of s.pts) grow(x, y, s.w + rim + 0.2);
  for (const [x, y] of shadows[0]) grow(x, y, 0.2);

  const draw = (g: Painter, ox: number, oy: number) => {
    for (const sh of shadows) g.poly(sh.flatMap(([x, y]) => [x + ox, y + oy]), 0x14180a, 0.2);
    // A thin dark edge, as anti-aliased renders have, so the figure holds against the grass.
    for (const s of shapes) paintFlat(g, s, ox, oy, 0x1c1a14, rim);
    for (const s of shapes) {
      // Near the ground the light is softer (ambient occlusion).
      const ao = 0.82 + 0.18 * Math.min(1, s.z / (2.2 * r));
      if (s.cap) paintRound(g, s, ox, oy, ao);
      else paintFlat(g, s, ox, oy, shade(s.color, (0.55 + 0.6 * s.lit) * ao + (s.finish === 'metal' ? 0.1 * s.lit : 0)), 0);
    }
  };
  return { minX, minY, maxX, maxY, weapon: m.weapon, draw };
}

/** A rounded part: shadowed body, lit middle, a soft (or sharp, for metal) highlight. */
function paintRound(g: Painter, s: Shape, ox: number, oy: number, ao: number): void {
  const metal = s.finish === 'metal';
  const [lx, ly] = SUN_SCREEN;
  const layers: [number, number, number][] = metal
    ? [[1, 0, 0.5], [0.72, 0.24, 0.9], [0.4, 0.48, 1.2], [0.16, 0.66, 1.65]]
    : [[1, 0, 0.6], [0.76, 0.2, 0.92], [0.44, 0.42, 1.12]];
  for (const [wk, off, k] of layers) {
    const w = s.w * wk, dx = lx * s.w * off, dy = ly * s.w * off;
    paintCap(g, s.pts, ox + dx, oy + dy, w, shade(s.color, k * ao));
  }
}

function paintCap(g: Painter, pts: [number, number][], ox: number, oy: number, w: number, color: number): void {
  const [a, b] = pts;
  if (Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4) g.circle(a[0] + ox, a[1] + oy, w, color);
  else g.line(a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy, w * 2, color);
}

function paintFlat(g: Painter, s: Shape, ox: number, oy: number, color: number, rim: number): void {
  if (s.cap) {
    paintCap(g, s.pts, ox, oy, s.w + rim, color);
    return;
  }
  g.poly(s.pts.flatMap(([x, y]) => [x + ox, y + oy]), color, 1, rim);
}
