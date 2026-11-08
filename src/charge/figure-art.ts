import { Graphics } from 'pixi.js';
import { Team, UnitType } from '../types';
import { Theme } from '../theme';
import { HORSE_VARIANTS } from '../unit-art';

/**
 * Upright figures in the manner of classic pre-rendered RTS sprites: a steep camera
 * looking down on small, naturally coloured soldiers lit by the sun, with the team
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
/** Frame layout: one standing pose, a walk (or gallop) cycle, then an attack. */
export const IDLE_FRAME = 0;
export const WALK_FRAMES = 8;
export const ATTACK_FRAMES = 4;
export const FRAMES = 1 + WALK_FRAMES + ATTACK_FRAMES;

/** Camera elevation: steep, looking down on the troops at about 50°. */
const ELEV = (50 * Math.PI) / 180;
const GROUND = Math.sin(ELEV); // how much ground depth survives the projection
const HEIGHT = Math.cos(ELEV) * 1.15; // how tall upright things look (a touch exaggerated)
/** Sun from high above and slightly left and behind the camera's view (world x, y-south, up). */
const SUN: V3 = norm([-0.35, 0.25, 0.9]);
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

/** Frame index for a gait phase (radians, advancing with distance) or the attack. */
export function walkFrame(phase: number): number {
  const t = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  return 1 + Math.min(WALK_FRAMES - 1, Math.floor(t * WALK_FRAMES));
}

export function attackFrame(progress: number): number {
  return 1 + WALK_FRAMES + Math.max(0, Math.min(ATTACK_FRAMES - 1, Math.floor(progress * ATTACK_FRAMES)));
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
  readonly prims: Prim[] = [];
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
      const cu = Math.cos(t) * ru, sv = Math.sin(t) * rv;
      pts.push([c[0] + u[0] * cu + v[0] * sv, c[1] + u[1] * cu + v[1] * sv, c[2] + u[2] * cu + v[2] * sv]);
    }
    this.poly(pts, color, bias, finish);
  }
}

/** Natural materials; only `team` and `teamDark` say whose man he is. */
interface Palette {
  team: number;
  teamDark: number;
  steel: number;
  mail: number;
  wood: number;
  leather: number;
  linen: number;
  skin: number;
  boot: number;
}

function palette(team: Team, theme: Theme): Palette {
  return {
    team: team === 'blue' ? theme.blue : theme.red,
    teamDark: team === 'blue' ? theme.blueDark : theme.redDark,
    steel: theme.steel,
    mail: mix(theme.steel, theme.steelDark, 0.45),
    wood: theme.wood,
    leather: theme.leather,
    linen: 0xa08a64,
    skin: 0xc8906a,
    boot: 0x3a2a1c,
  };
}

/** Horse coats: [coat, mane, legs]. */
const COATS: [number, number, number][] = [
  [0xd8d2c6, 0xb0a898, 0xb8b0a2], // grey
  [0x7a4324, 0x24140a, 0x2a1a10], // bay, black points
  [0x9c5c2c, 0x6a3a18, 0x8a5026], // chestnut
  [0xb8996a, 0x3a2c1c, 0x4a3a28], // dun
];

/** Gait and attack state for a frame. */
function poseOf(frame: number): { gait: number; moving: boolean; attack: number } {
  if (frame >= 1 && frame <= WALK_FRAMES) return { gait: ((frame - 1) / WALK_FRAMES) * Math.PI * 2, moving: true, attack: -1 };
  if (frame > WALK_FRAMES) return { gait: 0, moving: false, attack: (frame - 1 - WALK_FRAMES + 0.5) / ATTACK_FRAMES };
  return { gait: 0, moving: false, attack: -1 };
}

/** A foot soldier, feet at the origin, about 3.4 body radii tall. */
function footman(m: Model, type: UnitType, r: number, p: Palette, frame: number): void {
  const { gait, moving, attack } = poseOf(frame);
  const swing = moving ? Math.sin(gait) : 0;
  const lift = moving ? 0.18 * r : 0;
  const bob = moving ? Math.abs(Math.cos(gait)) * 0.07 * r : 0;
  const hipZ = 1.6 * r + bob, shZ = 2.75 * r + bob, headZ = 3.12 * r + bob;
  const hip = 0.17 * r, sh = 0.36 * r;

  // Clothes by trade: mail for swordsmen, a quilted coat for pikes, linen and leather for archers.
  const sleeve = type === 'swordsman' ? p.mail : type === 'pikeman' ? p.linen : 0x8a7650;
  const hose = type === 'swordsman' ? p.mail : type === 'pikeman' ? 0x6a5a42 : 0x5a5236;
  const sleeveFinish: Finish = type === 'swordsman' ? 'metal' : 'matte';

  // Legs: stride fore and aft, the foot coming forward lifts.
  for (const side of [-1, 1]) {
    const k = side * swing;
    const foot: V3 = [k * 0.45 * r, side * hip, Math.max(0, -side * Math.cos(gait)) * lift + 0.1 * r];
    const knee: V3 = [k * 0.22 * r + (foot[2] > 0.2 * r ? 0.14 * r : 0.04 * r), side * hip, hipZ * 0.5 + foot[2] * 0.5];
    m.cap([0, side * hip, hipZ], knee, 0.14 * r, hose, 0, sleeveFinish);
    m.cap(knee, foot, 0.12 * r, hose, 0, sleeveFinish);
    m.cap(foot, add(foot, [0.2 * r, 0, -0.03 * r]), 0.1 * r, p.boot, 0.01);
  }

  // Quiver on the back (archers).
  if (type === 'archer') {
    m.cap([-0.32 * r, -0.1 * r, 2.0 * r + bob], [-0.4 * r, 0.12 * r, 3.0 * r + bob], 0.13 * r, p.leather, -0.05);
    for (const o of [-0.05, 0.05]) m.cap([-0.4 * r, (0.12 + o) * r, 3.0 * r + bob], [-0.42 * r, (0.14 + o) * r, 3.25 * r + bob], 0.04 * r, 0xe8e0d0, -0.05);
  }

  // Body: the trade's coat underneath, the team's surcoat over it, belted.
  m.cap([0.01 * r, 0, hipZ - 0.05 * r], [0, 0, shZ - 0.12 * r], 0.31 * r, p.team);
  // Skirt of the surcoat over the thighs.
  for (const s of [-1, 1]) {
    m.poly([[0.31 * r, 0, hipZ], [0.31 * r, s * 0.3 * r, hipZ], [0.34 * r, s * 0.3 * r, hipZ - 0.5 * r], [0.34 * r, 0, hipZ - 0.55 * r]], p.team, 0.002);
    m.poly([[-0.31 * r, 0, hipZ], [-0.31 * r, s * 0.3 * r, hipZ], [-0.34 * r, s * 0.3 * r, hipZ - 0.5 * r], [-0.34 * r, 0, hipZ - 0.55 * r]], p.teamDark, -0.002);
  }
  m.cap([0, -sh * 0.62, shZ - 0.06 * r], [0, sh * 0.62, shZ - 0.06 * r], 0.16 * r, type === 'swordsman' ? p.mail : sleeve, 0.003, sleeveFinish);
  m.cap([0.03 * r, -0.29 * r, hipZ + 0.1 * r], [0.03 * r, 0.29 * r, hipZ + 0.1 * r], 0.06 * r, p.leather, 0.004);

  // Head and headgear.
  m.ball([0.04 * r, 0, headZ], 0.2 * r, p.skin, 0.005);
  if (type === 'swordsman') {
    m.ball([0.0, 0, headZ + 0.06 * r], 0.22 * r, p.steel, 0.006, 'metal');
    m.cap([0.21 * r, 0, headZ + 0.05 * r], [0.23 * r, 0, headZ - 0.13 * r], 0.035 * r, p.steel, 0.007, 'metal');
    m.cap([-0.05 * r, 0, headZ - 0.05 * r], [-0.05 * r, 0, headZ - 0.25 * r], 0.17 * r, p.mail, 0.0045, 'metal');
  } else if (type === 'pikeman') {
    // Kettle hat: a dome over a broad brim.
    m.disc([0, 0, headZ + 0.1 * r], [1, 0, 0], [0, 1, 0], 0.38 * r, 0.38 * r, p.steel, 0.006, 'metal');
    m.ball([0, 0, headZ + 0.13 * r], 0.2 * r, p.steel, 0.007, 'metal');
  } else {
    // Leather hood and cowl.
    m.ball([-0.03 * r, 0, headZ + 0.05 * r], 0.23 * r, 0x6a5232, 0.006);
    m.ball([0.11 * r, 0, headZ - 0.02 * r], 0.14 * r, p.skin, 0.007);
    m.cap([-0.05 * r, -0.25 * r, headZ - 0.25 * r], [-0.05 * r, 0.25 * r, headZ - 0.25 * r], 0.12 * r, 0x6a5232, 0.0065);
  }

  const L: V3 = [0, -sh, shZ - 0.05 * r], R: V3 = [0, sh, shZ - 0.05 * r];
  const arm = (from: V3, hand: V3, bias = 0.01) => {
    const elbow: V3 = [(from[0] + hand[0]) / 2 - 0.05 * r, (from[1] + hand[1]) / 2 + Math.sign(from[1]) * 0.07 * r, (from[2] + hand[2]) / 2 - 0.1 * r];
    m.cap(from, elbow, 0.11 * r, sleeve, bias, sleeveFinish);
    m.cap(elbow, hand, 0.1 * r, sleeve, bias, sleeveFinish);
    m.ball(hand, 0.08 * r, type === 'swordsman' ? p.leather : p.skin, bias + 0.001);
  };

  if (type === 'swordsman') {
    // Kite shield on the left arm, sword in the right: raised, then a cut down and across.
    // Carried well forward, so the painted face shows from most sides.
    const shieldC: V3 = [0.5 * r, -0.32 * r, 2.15 * r + bob];
    arm(L, [0.42 * r, -0.3 * r, 2.2 * r + bob], 0.05);
    const sU: V3 = [0, 0, 1], sV: V3 = norm([0.55, 0.83, 0]);
    const kite = (scale: number, color: number, bias: number) => {
      const pt = (u: number, v: number): V3 => add(shieldC, [sU[0] * u + sV[0] * v, sU[1] * u + sV[1] * v, sU[2] * u + sV[2] * v]);
      m.poly([pt(0.55 * r * scale, -0.32 * r * scale), pt(0.6 * r * scale, 0), pt(0.55 * r * scale, 0.32 * r * scale), pt(0, 0.34 * r * scale), pt(-0.75 * r * scale, 0), pt(0, -0.34 * r * scale)], color, bias);
    };
    kite(1.08, 0x4a3420, 0.12);
    kite(1, p.team, 0.121);
    m.disc(add(shieldC, [0.02 * r, 0.01 * r, 0.12 * r]), sU, sV, 0.09 * r, 0.09 * r, p.steel, 0.122, 'metal', 10);
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
    m.cap(add(hand, [0, -0.13 * r, 0]), add(hand, [0, 0.13 * r, 0]), 0.04 * r, 0xa88a3a, 0.016, 'metal');
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
    m.cap(back, front, 0.055 * r, p.wood, 0.02);
    const ux = (front[0] - back[0]) / len, uz = (front[2] - back[2]) / len;
    m.poly([add(front, [-uz * 0.08 * r, 0, ux * 0.08 * r]), add(front, [ux * 0.5 * r, 0, uz * 0.5 * r]), add(front, [uz * 0.08 * r, 0, -ux * 0.08 * r])], p.steel, 0.021, 'metal');
  } else {
    // Longbow held out in the left hand; the right hand draws the string to the cheek.
    const draw = attack >= 0 ? Math.min(1, attack * 1.6) * (attack > 0.85 ? 0 : 1) : 0;
    const bowHand: V3 = attack >= 0 ? [0.8 * r, -0.12 * r, 2.65 * r + bob] : [0.32 * r - swing * 0.1 * r, -0.4 * r, 2.0 * r + bob];
    arm(L, bowHand, attack >= 0 ? 0.02 : -0.002);
    const up: V3 = attack >= 0 ? [0, 0, 1] : [0.35, 0, 0.94];
    const limb = 1.05 * r;
    const bend = attack >= 0 ? -0.16 * r - draw * 0.15 * r : -0.14 * r;
    const top = add(bowHand, [up[0] * limb + bend, up[1] * limb, up[2] * limb]);
    const bot = add(bowHand, [-up[0] * limb + bend, -up[1] * limb, -up[2] * limb]);
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

/** A knight on a barded horse, hooves at the origin. */
function horseman(m: Model, r: number, p: Palette, frame: number, variant: number): void {
  const { gait, moving, attack } = poseOf(frame);
  const [coat, mane, points] = COATS[((variant % HORSE_VARIANTS) + HORSE_VARIANTS) % HORSE_VARIANTS % COATS.length];
  const rise = moving ? Math.sin(gait) * 0.1 * r : 0;
  const pitch = moving ? Math.cos(gait) * 0.07 : 0;
  const bodyZ = 1.75 * r + rise;
  const front = 0.75 * r, rear = -0.8 * r;
  const z = (x: number) => bodyZ + x * pitch;

  // Legs: a gallop's footfalls come round in turn (hind left, hind right, fore left, fore right).
  const legs: [number, number, number][] = [[rear + 0.12 * r, -1, 0], [rear + 0.12 * r, 1, 0.12], [front - 0.08 * r, -1, 0.5], [front - 0.08 * r, 1, 0.62]];
  for (const [x, side, off] of legs) {
    const hindLeg = x < 0;
    const t = gait + off * Math.PI * 2;
    const swingA = moving ? Math.sin(t) * (hindLeg ? 0.55 : 0.7) : (hindLeg ? -0.05 : 0.05);
    const fold = moving ? Math.max(0, Math.cos(t)) * (hindLeg ? 0.9 : -1.2) : 0;
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

  // Barding: a cloth in the team's colour over the back and flanks, with a pale hem.
  const top = z(0) + 0.42 * r, hem = z(0) - 0.5 * r;
  m.poly([[rear - 0.05 * r, -0.35 * r, top], [front * 0.75, -0.35 * r, top], [front * 0.75, 0.35 * r, top], [rear - 0.05 * r, 0.35 * r, top]], p.team, 0.12);
  for (const side of [-1, 1]) {
    const y = side * 0.53 * r;
    m.poly([[rear - 0.05 * r, side * 0.35 * r, top], [front * 0.75, side * 0.35 * r, top], [front * 0.85, y, hem], [rear - 0.12 * r, y, hem]], p.team, 0.15);
    m.poly([[rear - 0.12 * r, y * 1.01, hem + 0.09 * r], [front * 0.85, y * 1.01, hem + 0.09 * r], [front * 0.85, y * 1.01, hem], [rear - 0.12 * r, y * 1.01, hem]], 0xd8ccaa, 0.151);
  }
  m.cap([-0.4 * r, 0, top + 0.06 * r], [0.25 * r, 0, top + 0.06 * r], 0.16 * r, p.leather, 0.16);

  // Rider in mail and a team surcoat, legs down the horse's sides, leaning into the gallop.
  const seat: V3 = [-0.15 * r, 0, top + 0.2 * r];
  const lean = moving ? 0.3 * r : 0.05 * r;
  const shoulder: V3 = add(seat, [lean, 0, 1.0 * r]);
  for (const side of [-1, 1]) {
    const knee: V3 = [0.22 * r, side * 0.56 * r, z(0) + 0.05 * r];
    m.cap([seat[0], side * 0.18 * r, seat[2]], knee, 0.13 * r, p.mail, 0.2, 'metal');
    m.cap(knee, [0.08 * r, side * 0.6 * r, z(0) - 0.55 * r], 0.11 * r, p.mail, 0.2, 'metal');
  }
  m.cap(add(seat, [0, 0, 0.15 * r]), shoulder, 0.28 * r, p.team, 0.25);
  m.cap(add(shoulder, [0, -0.3 * r, -0.05 * r]), add(shoulder, [0, 0.3 * r, -0.05 * r]), 0.15 * r, p.mail, 0.251, 'metal');
  // Great helm with a short plume in the team's colour.
  const head: V3 = add(shoulder, [0.06 * r, 0, 0.38 * r]);
  m.cap(add(head, [0, 0, -0.08 * r]), add(head, [0, 0, 0.1 * r]), 0.21 * r, p.steel, 0.253, 'metal');
  m.cap(add(head, [0.2 * r, -0.12 * r, 0.02 * r]), add(head, [0.2 * r, 0.12 * r, 0.02 * r]), 0.02 * r, 0x1a1a1a, 0.254);
  m.cap(add(head, [0, 0, 0.26 * r]), add(head, [-0.35 * r, 0, 0.38 * r]), 0.08 * r, p.team, 0.255);

  // Heater shield on the left arm.
  const shieldC: V3 = add(shoulder, [0.12 * r, -0.4 * r, -0.45 * r]);
  m.cap(add(shoulder, [0, -0.3 * r, 0]), add(shieldC, [0, 0.1 * r, 0.1 * r]), 0.1 * r, p.mail, 0, 'metal');
  const sU: V3 = [0, 0, 1], sV: V3 = norm([0.85, 0.53, 0]);
  const heater = (scale: number, color: number, bias: number) => {
    const pt = (u: number, v: number): V3 => add(shieldC, [sU[0] * u + sV[0] * v, sU[1] * u + sV[1] * v, sU[2] * u + sV[2] * v]);
    const s = r * scale;
    m.poly([pt(0.4 * s, -0.36 * s), pt(0.4 * s, 0.36 * s), pt(0.0, 0.36 * s), pt(-0.55 * s, 0), pt(0.0, -0.36 * s)], color, bias);
  };
  heater(1.1, 0x4a3420, 0.01);
  heater(1, p.team, 0.011);
  heater(0.45, mix(p.team, 0xe8dcc0, 0.75), 0.012);

  // Lance couched under the right arm; the strike drives it forward.
  const thrust = attack >= 0 ? Math.sin(Math.min(1, attack * 1.2) * Math.PI) * 0.8 * r : 0;
  const hand: V3 = add(shoulder, [0.32 * r + thrust, 0.36 * r, -0.4 * r]);
  m.cap(add(shoulder, [0, 0.3 * r, 0]), hand, 0.1 * r, p.mail, 0.02, 'metal');
  const butt: V3 = add(hand, [-0.9 * r, 0.02 * r, 0.12 * r]);
  const tip: V3 = add(hand, [3.4 * r, 0.05 * r, moving || attack >= 0 ? -0.35 * r : 1.2 * r]);
  m.cap(butt, tip, 0.055 * r, p.wood, 0.01);
  const dx = tip[0] - butt[0], dz = tip[2] - butt[2], len = Math.hypot(dx, dz);
  const at = (k: number, up: number): V3 => [butt[0] + dx * k - (dz / len) * up, tip[1], butt[2] + dz * k + (dx / len) * up];
  m.poly([at(0.97, 0.035 * r), at(1.1, 0), at(0.97, -0.035 * r)], p.steel, 0.011, 'metal');
  m.poly([at(0.8, 0), at(0.92, 0), at(0.82, -0.3 * r)], p.team, 0.012);
}

export interface FigureFrame {
  /** Bounds in local units (origin at the feet). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  draw(g: Graphics, ox: number, oy: number): void;
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

/** Build one frame of a unit design facing `angle`, ready to paint at any offset. */
export function buildFigure(type: UnitType, team: Team, r: number, theme: Theme, variant: number, angle: number, frame: number): FigureFrame {
  const m = new Model();
  const p = palette(team, theme);
  if (type === 'cavalry') horseman(m, r, p, frame, variant);
  else footman(m, type, r, p, frame);

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

  // Soft ground shadow under the figure, stretched along the horse.
  const sl = type === 'cavalry' ? 1.7 * r : 0.6 * r, sw = type === 'cavalry' ? 0.7 * r : 0.5 * r;
  const shadowAt = (k: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * Math.PI * 2;
      out.push(screen(world([Math.cos(t) * sl * k, Math.sin(t) * sw * k, 0])));
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

  const draw = (g: Graphics, ox: number, oy: number) => {
    for (const sh of shadows) g.poly(sh.flatMap(([x, y]) => [x + ox, y + oy])).fill({ color: 0x14180a, alpha: 0.2 });
    // A thin dark edge, as anti-aliased renders have, so the figure holds against the grass.
    for (const s of shapes) paintFlat(g, s, ox, oy, 0x1c1a14, rim);
    for (const s of shapes) {
      // Near the ground the light is softer (ambient occlusion).
      const ao = 0.82 + 0.18 * Math.min(1, s.z / (2.2 * r));
      if (s.cap) paintRound(g, s, ox, oy, ao);
      else paintFlat(g, s, ox, oy, shade(s.color, (0.55 + 0.6 * s.lit) * ao + (s.finish === 'metal' ? 0.1 * s.lit : 0)), 0);
    }
  };
  return { minX, minY, maxX, maxY, draw };
}

/** A rounded part: shadowed body, lit middle, a soft (or sharp, for metal) highlight. */
function paintRound(g: Graphics, s: Shape, ox: number, oy: number, ao: number): void {
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

function paintCap(g: Graphics, pts: [number, number][], ox: number, oy: number, w: number, color: number): void {
  const [a, b] = pts;
  if (Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4) {
    g.circle(a[0] + ox, a[1] + oy, w).fill(color);
  } else {
    g.moveTo(a[0] + ox, a[1] + oy).lineTo(b[0] + ox, b[1] + oy).stroke({ width: w * 2, color, cap: 'round' });
  }
}

function paintFlat(g: Graphics, s: Shape, ox: number, oy: number, color: number, rim: number): void {
  if (s.cap) {
    paintCap(g, s.pts, ox, oy, s.w + rim, color);
    return;
  }
  const flat = s.pts.flatMap(([x, y]) => [x + ox, y + oy]);
  g.poly(flat).fill(color);
  if (rim > 0) g.poly(flat).stroke({ width: rim * 2, color, join: 'round' });
}
