import { Graphics } from 'pixi.js';
import { Team, UnitType } from '../types';
import { Theme } from '../theme';
import { HORSE_VARIANTS } from '../unit-art';

/**
 * Upright figures in a three-quarter view, the way classic painted RTS games show
 * their armies: men stand on the ground and are seen from the side and a little above,
 * horses show four legs in a gallop, and every soldier has a facing, a walk cycle and
 * an attack.
 *
 * Each figure is a small posed model of capsules and flat plates in 3D (forward, right,
 * up), projected and painted back to front. The same model gives every facing and
 * every frame, so the view bakes them all into one sheet per unit design.
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
/** How much the figure's own depth is foreshortened (the camera looks down ~35°). */
const TILT = 0.55;

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

type Prim =
  /** `bias` (in body radii) moves a part toward the viewer in the painting order. */
  | { k: 'cap'; a: V3; b: V3; w: number; color: number; bias: number; gloss: boolean }
  | { k: 'poly'; pts: V3[]; color: number; bias: number };

/** Coats for the horses: [coat, mane]. Browns and greys, no team colour in them. */
const COATS: [number, number][] = [
  [0x7a4422, 0x2a160a], // bay
  [0xa8763c, 0x5a3a18], // chestnut
  [0xcfc7b6, 0x8a8274], // grey
  [0x3a2c24, 0x140c08], // black
];

const OUTLINE = 0x1a120c;
const SKIN = 0xd6a07a;

function mix(a: number, b: number, k: number): number {
  const f = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (f(16) << 16) | (f(8) << 8) | f(0);
}

const lighten = (c: number, k: number) => mix(c, 0xffffff, k);
const darken = (c: number, k: number) => mix(c, 0x000000, k);

/** A posed figure: its parts, painted back to front, in unit-local 3D. */
class Model {
  readonly prims: Prim[] = [];
  cap(a: V3, b: V3, w: number, color: number, bias = 0, gloss = true): void {
    this.prims.push({ k: 'cap', a, b, w, color, bias, gloss });
  }
  ball(c: V3, w: number, color: number, bias = 0): void {
    this.prims.push({ k: 'cap', a: c, b: c, w, color, bias, gloss: true });
  }
  poly(pts: V3[], color: number, bias = 0): void {
    this.prims.push({ k: 'poly', pts, color, bias });
  }
  /** A disc (a shield) centred at c, spanned by unit vectors u and v. */
  disc(c: V3, u: V3, v: V3, ru: number, rv: number, color: number, bias = 0, n = 14): void {
    const pts: V3[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const cu = Math.cos(t) * ru, sv = Math.sin(t) * rv;
      pts.push([c[0] + u[0] * cu + v[0] * sv, c[1] + u[1] * cu + v[1] * sv, c[2] + u[2] * cu + v[2] * sv]);
    }
    this.poly(pts, color, bias);
  }
}

interface Palette {
  team: number;
  teamDark: number;
  steel: number;
  steelDark: number;
  wood: number;
  leather: number;
  trim: number;
}

function palette(team: Team, theme: Theme): Palette {
  return {
    team: team === 'blue' ? theme.blue : theme.red,
    teamDark: team === 'blue' ? theme.blueDark : theme.redDark,
    steel: theme.steel,
    steelDark: theme.steelDark,
    wood: theme.wood,
    leather: theme.leather,
    trim: theme.trim,
  };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Gait and attack state for a frame. */
function poseOf(frame: number): { gait: number; moving: boolean; attack: number } {
  if (frame >= 1 && frame <= WALK_FRAMES) return { gait: ((frame - 1) / WALK_FRAMES) * Math.PI * 2, moving: true, attack: -1 };
  if (frame > WALK_FRAMES) return { gait: 0, moving: false, attack: (frame - 1 - WALK_FRAMES + 0.5) / ATTACK_FRAMES };
  return { gait: 0, moving: false, attack: -1 };
}

/** A foot soldier, feet at the origin. Heights are in units of the body radius r. */
function footman(m: Model, type: UnitType, r: number, p: Palette, frame: number): void {
  const { gait, moving, attack } = poseOf(frame);
  const swing = moving ? Math.sin(gait) : 0;
  const lift = moving ? 0.16 * r : 0;
  const bob = moving ? Math.abs(Math.cos(gait)) * 0.08 * r : 0;
  const hipZ = 1.45 * r + bob, shZ = 2.45 * r + bob, headZ = 2.95 * r + bob;
  const hip = 0.2 * r, sh = 0.4 * r;

  // Clothes by trade: mail for swordsmen, a quilted coat for pikes, leather for archers.
  const sleeve = type === 'swordsman' ? p.steel : type === 'pikeman' ? 0xc8b48a : 0x6a5a3a;
  const hose = type === 'swordsman' ? darken(p.steel, 0.35) : type === 'pikeman' ? 0x5a4a34 : 0x4a5a2a;
  const boot = 0x2e2216;

  // Legs: stride fore and aft, the foot coming forward lifts.
  for (const side of [-1, 1]) {
    const k = side * swing;
    const foot: V3 = [k * 0.42 * r, side * hip, Math.max(0, -side * Math.cos(gait)) * lift + 0.12 * r];
    const knee: V3 = [k * 0.2 * r + (foot[2] > 0.2 * r ? 0.12 * r : 0), side * hip, hipZ * 0.5 + foot[2] * 0.5];
    m.cap([0, side * hip, hipZ], knee, 0.17 * r, hose);
    m.cap(knee, foot, 0.15 * r, hose);
    m.cap(foot, add(foot, [0.18 * r, 0, -0.04 * r]), 0.13 * r, boot, 0.01);
  }

  // Quiver on the back (archers), behind the torso.
  if (type === 'archer') {
    m.cap([-0.4 * r, -0.12 * r, 1.9 * r + bob], [-0.48 * r, 0.12 * r, 2.85 * r + bob], 0.15 * r, p.leather, -0.05);
    m.cap([-0.48 * r, 0.12 * r, 2.85 * r + bob], [-0.5 * r, 0.16 * r, 3.05 * r + bob], 0.07 * r, 0xe8e0c8, -0.05, false);
  }

  // Torso in the team's tabard over mail or cloth, with a belt.
  m.cap([0, 0, hipZ + 0.1 * r], [0, 0, shZ - 0.1 * r], 0.36 * r, p.team);
  m.cap([0, -sh * 0.55, shZ - 0.05 * r], [0, sh * 0.55, shZ - 0.05 * r], 0.2 * r, p.team, 0.001);
  m.poly([[0.3 * r, -0.28 * r, hipZ + 0.02 * r], [0.3 * r, 0.28 * r, hipZ + 0.02 * r], [0.32 * r, 0.28 * r, hipZ - 0.45 * r], [0.32 * r, -0.28 * r, hipZ - 0.45 * r]], p.team, 0.002);
  m.cap([0.02 * r, -0.3 * r, hipZ + 0.12 * r], [0.02 * r, 0.3 * r, hipZ + 0.12 * r], 0.08 * r, p.leather, 0.003, false);
  // A pale cross on the chest marks the side even at a glance.
  m.poly([[0.37 * r, -0.05 * r, shZ - 0.2 * r], [0.37 * r, 0.05 * r, shZ - 0.2 * r], [0.37 * r, 0.05 * r, hipZ + 0.35 * r], [0.37 * r, -0.05 * r, hipZ + 0.35 * r]], lighten(p.team, 0.55), 0.004);

  // Head and helmet.
  m.ball([0.04 * r, 0, headZ], 0.27 * r, SKIN, 0.005);
  if (type === 'swordsman') {
    m.ball([0.0, 0, headZ + 0.07 * r], 0.29 * r, p.steel, 0.006);
    m.cap([0.27 * r, 0, headZ + 0.05 * r], [0.29 * r, 0, headZ - 0.17 * r], 0.04 * r, p.steelDark, 0.007, false);
  } else if (type === 'pikeman') {
    // Kettle hat: a dome with a broad brim.
    m.disc([0, 0, headZ + 0.1 * r], [1, 0, 0], [0, 1, 0], 0.46 * r, 0.46 * r, p.steelDark, 0.006);
    m.ball([0, 0, headZ + 0.14 * r], 0.25 * r, p.steel, 0.007);
  } else {
    // Hood in the team's darker colour.
    m.ball([-0.03 * r, 0, headZ + 0.05 * r], 0.3 * r, darken(p.team, 0.3), 0.006);
    m.ball([0.1 * r, 0, headZ - 0.02 * r], 0.19 * r, SKIN, 0.007);
  }

  const L: V3 = [0, -sh, shZ], R: V3 = [0, sh, shZ];
  const arm = (from: V3, hand: V3, bias = 0.01) => {
    const elbow: V3 = [(from[0] + hand[0]) / 2 - 0.05 * r, (from[1] + hand[1]) / 2 + Math.sign(from[1]) * 0.08 * r, (from[2] + hand[2]) / 2 - 0.12 * r];
    m.cap(from, elbow, 0.13 * r, sleeve, bias);
    m.cap(elbow, hand, 0.12 * r, sleeve, bias);
    m.ball(hand, 0.1 * r, type === 'swordsman' ? p.steelDark : SKIN, bias + 0.001);
  };

  if (type === 'swordsman') {
    // Shield on the left arm, sword in the right hand: raised, then a cut down and across.
    const shieldC: V3 = [0.42 * r, -0.5 * r, 2.0 * r + bob];
    arm(L, [0.38 * r, -0.42 * r, 2.0 * r + bob], -0.002);
    m.disc(shieldC, [0, 0, 1], [0.6, 0.8, 0], 0.62 * r, 0.5 * r, p.team, 0.02);
    m.disc(add(shieldC, [0.03 * r, 0.01 * r, 0]), [0, 0, 1], [0.6, 0.8, 0], 0.18 * r, 0.15 * r, p.trim, 0.021, 10);
    let hand: V3, tip: V3;
    if (attack >= 0) {
      const a = Math.min(1, attack * 1.25);
      const ang = -2.0 + a * 3.0; // from overhead-behind to forward-low
      hand = [0.3 * r + Math.sin(ang) * 0.45 * r, 0.42 * r, shZ + 0.15 * r + Math.cos(ang) * 0.35 * r];
      tip = add(hand, [Math.sin(ang) * 1.35 * r, -0.1 * r, Math.cos(ang) * 1.35 * r]);
    } else {
      hand = [0.3 * r - swing * 0.15 * r, 0.48 * r, 1.75 * r + bob];
      tip = add(hand, [0.95 * r, 0, 0.75 * r]);
    }
    arm(R, hand);
    m.cap(hand, tip, 0.07 * r, lighten(p.steel, 0.25), 0.015, false);
    m.cap(add(hand, [0, -0.15 * r, 0]), add(hand, [0, 0.15 * r, 0]), 0.05 * r, 0xc9a227, 0.016, false);
  } else if (type === 'pikeman') {
    // Pike levelled at the enemy, both hands on the shaft; a thrust drives it on.
    // At rest it stands upright beside him, so a halted block bristles like a hedge.
    const len = 5.2 * r;
    let back: V3, front: V3;
    if (frame === IDLE_FRAME) {
      back = [0.3 * r, 0.42 * r, 0.05 * r];
      front = add(back, [0.12 * r, 0, len]);
      arm(L, [0.22 * r, -0.4 * r, 1.65 * r]);
      arm(R, [0.3 * r, 0.42 * r, 2.2 * r]);
    } else {
      const push = attack >= 0 ? Math.sin(Math.min(1, attack) * Math.PI) * 0.7 * r : 0;
      back = [-1.1 * r + push, 0.3 * r, 2.05 * r + bob];
      front = add(back, [len, 0, 0.1 * r]);
      arm(L, add(back, [1.55 * r, -0.05 * r, 0]));
      arm(R, add(back, [0.55 * r, 0, 0]));
    }
    m.cap(back, front, 0.07 * r, p.wood, 0.02, false);
    const ux = (front[0] - back[0]) / len, uz = (front[2] - back[2]) / len;
    m.poly([add(front, [-uz * 0.1 * r, 0, ux * 0.1 * r]), add(front, [ux * 0.55 * r, 0, uz * 0.55 * r]), add(front, [uz * 0.1 * r, 0, -ux * 0.1 * r])], p.steel, 0.021);
  } else {
    // Bow held out in the left hand; the right hand draws the string to the cheek.
    const draw = attack >= 0 ? Math.min(1, attack * 1.6) * (attack > 0.85 ? 0 : 1) : 0;
    const bowHand: V3 = attack >= 0 ? [0.85 * r, -0.12 * r, 2.4 * r + bob] : [0.35 * r - swing * 0.1 * r, -0.45 * r, 1.85 * r + bob];
    arm(L, bowHand, attack >= 0 ? 0.02 : -0.002);
    const up: V3 = attack >= 0 ? [0, 0, 1] : [0.35, 0, 0.94];
    const limb = 0.95 * r;
    const bend = attack >= 0 ? -0.18 * r - draw * 0.15 * r : -0.15 * r;
    const top = add(bowHand, [up[0] * limb + bend, up[1] * limb, up[2] * limb]);
    const bot = add(bowHand, [-up[0] * limb + bend, -up[1] * limb, -up[2] * limb]);
    const grip = add(bowHand, [0.08 * r, 0, 0]);
    m.cap(top, grip, 0.06 * r, p.wood, 0.025, false);
    m.cap(grip, bot, 0.06 * r, p.wood, 0.025, false);
    const nock: V3 = attack >= 0 ? add(bowHand, [-0.25 * r - draw * 0.6 * r, 0.05 * r, 0.1 * r]) : add(bowHand, [-0.1 * r, 0, 0]);
    m.cap(top, nock, 0.015 * r, 0xe8e0c8, 0.026, false);
    m.cap(nock, bot, 0.015 * r, 0xe8e0c8, 0.026, false);
    if (attack >= 0 && attack <= 0.85) m.cap(nock, add(bowHand, [0.35 * r, 0, 0]), 0.03 * r, 0xd8c8a0, 0.027, false);
    arm(R, attack >= 0 ? add(nock, [0, 0.05 * r, 0]) : [0.25 * r + swing * 0.12 * r, 0.48 * r, 1.75 * r + bob], 0.02);
  }
}

/** A horse and rider, hooves at the origin. */
function horseman(m: Model, r: number, p: Palette, frame: number, variant: number): void {
  const { gait, moving, attack } = poseOf(frame);
  const [coat, mane] = COATS[((variant % HORSE_VARIANTS) + HORSE_VARIANTS) % HORSE_VARIANTS % COATS.length];
  const rise = moving ? Math.sin(gait * 1) * 0.1 * r : 0;
  const pitch = moving ? Math.cos(gait) * 0.08 : 0;
  const bodyZ = 1.65 * r + rise;
  const front = 0.8 * r, rear = -0.85 * r;
  const z = (x: number) => bodyZ + x * pitch;

  // Legs: a gallop's footfalls come round in turn (hind left, hind right, fore left, fore right).
  const legs: [number, number, number][] = [[rear + 0.1 * r, -1, 0], [rear + 0.1 * r, 1, 0.12], [front - 0.1 * r, -1, 0.5], [front - 0.1 * r, 1, 0.62]];
  for (const [x, side, off] of legs) {
    const hindLeg = x < 0;
    const t = gait + off * Math.PI * 2;
    const swingA = moving ? Math.sin(t) * (hindLeg ? 0.55 : 0.7) : (hindLeg ? -0.05 : 0.05);
    const fold = moving ? Math.max(0, Math.cos(t)) * (hindLeg ? 0.9 : -1.2) : 0;
    const hipP: V3 = [x, side * 0.26 * r, z(x) - 0.2 * r];
    const upper = 0.62 * r, lower = 0.75 * r;
    const knee: V3 = add(hipP, [Math.sin(swingA) * upper, 0, -Math.cos(swingA) * upper]);
    const la = swingA + fold;
    const hoof: V3 = add(knee, [Math.sin(la) * lower, 0, -Math.cos(la) * lower]);
    const legCol = side < 0 ? darken(coat, 0.18) : coat;
    m.cap(hipP, knee, 0.17 * r, legCol);
    m.cap(knee, hoof, 0.1 * r, legCol);
    m.ball(hoof, 0.11 * r, darken(mane, 0.2), 0.001);
  }

  // Tail streams out behind at speed.
  const tailEnd: V3 = moving ? [rear - 0.95 * r, 0, z(rear) - 0.05 * r] : [rear - 0.4 * r, 0, z(rear) - 0.85 * r];
  m.cap([rear - 0.05 * r, 0, z(rear) + 0.2 * r], tailEnd, 0.13 * r, mane, -0.01);

  // Body, neck and head.
  m.cap([rear, 0, z(rear)], [front, 0, z(front)], 0.5 * r, coat);
  const neckTop: V3 = [front + 0.55 * r, 0, z(front) + (moving ? 0.6 : 0.8) * r];
  m.cap([front - 0.05 * r, 0, z(front) + 0.05 * r], neckTop, 0.27 * r, coat, 0.02);
  const muzzle: V3 = add(neckTop, [0.5 * r, 0, moving ? -0.3 * r : -0.45 * r]);
  m.cap(neckTop, muzzle, 0.19 * r, coat, 0.03);
  m.ball(add(muzzle, [0.02 * r, 0, -0.02 * r]), 0.13 * r, darken(coat, 0.35), 0.031);
  m.cap(add(neckTop, [-0.05 * r, 0, 0.12 * r]), add(neckTop, [-0.5 * r, 0, -0.3 * r]), 0.09 * r, mane, 0.025, false);
  for (const side of [-1, 1]) m.ball(add(neckTop, [0.02 * r, side * 0.09 * r, 0.2 * r]), 0.06 * r, darken(coat, 0.25), 0.032);

  // Caparison in the team's colour, hanging over the flanks, with a pale hem.
  for (const side of [-1, 1]) {
    const y = side * 0.53 * r;
    const top = z(0) + 0.2 * r, hem = z(0) - 0.55 * r;
    m.poly([[rear - 0.05 * r, y * 0.92, top], [front * 0.75, y, top], [front * 0.85, y, hem], [rear - 0.1 * r, y * 0.92, hem]], side < 0 ? p.teamDark : p.team, 0.15);
    m.poly([[rear - 0.1 * r, y * 0.93, hem + 0.1 * r], [front * 0.85, y * 1.01, hem + 0.1 * r], [front * 0.85, y * 1.01, hem], [rear - 0.1 * r, y * 0.93, hem]], p.trim, 0.151);
  }
  m.cap([-0.45 * r, 0, z(-0.4 * r) + 0.45 * r], [0.25 * r, 0, z(0.3 * r) + 0.45 * r], 0.22 * r, p.leather, 0.05, false);

  // Rider: legs down the horse's sides, leaning into the gallop.
  const seat: V3 = [-0.15 * r, 0, z(0) + 0.6 * r];
  const lean = moving ? 0.35 * r : 0.05 * r;
  const shoulder: V3 = add(seat, [lean, 0, 1.0 * r]);
  for (const side of [-1, 1]) {
    const knee: V3 = [0.2 * r, side * 0.55 * r, z(0) - 0.05 * r];
    m.cap([seat[0], side * 0.2 * r, seat[2]], knee, 0.16 * r, darken(p.steel, 0.25), 0.2);
    m.cap(knee, [0.05 * r, side * 0.58 * r, z(0) - 0.65 * r], 0.13 * r, darken(p.steel, 0.25), 0.2);
  }
  m.cap(add(seat, [0, 0, 0.15 * r]), shoulder, 0.33 * r, p.team, 0.25);
  m.cap(add(shoulder, [0, -0.32 * r, -0.05 * r]), add(shoulder, [0, 0.32 * r, -0.05 * r]), 0.18 * r, p.team, 0.251);
  m.poly([add(shoulder, [0.33 * r, -0.05 * r, -0.15 * r]), add(shoulder, [0.33 * r, 0.05 * r, -0.15 * r]), add(seat, [0.33 * r, 0.05 * r, 0.25 * r]), add(seat, [0.33 * r, -0.05 * r, 0.25 * r])], lighten(p.team, 0.55), 0.252);
  // Great helm with a plume in the team's colour.
  const head: V3 = add(shoulder, [0.08 * r, 0, 0.45 * r]);
  m.cap(add(head, [0, 0, -0.1 * r]), add(head, [0, 0, 0.12 * r]), 0.26 * r, p.steel, 0.253);
  m.cap(add(head, [0.25 * r, -0.15 * r, 0.02 * r]), add(head, [0.25 * r, 0.15 * r, 0.02 * r]), 0.025 * r, OUTLINE, 0.254, false);
  m.cap(add(head, [0, 0, 0.3 * r]), add(head, [-0.45 * r, 0, 0.45 * r]), 0.1 * r, lighten(p.team, 0.2), 0.255);

  // Shield on the left arm.
  const shieldC: V3 = add(shoulder, [0.1 * r, -0.42 * r, -0.45 * r]);
  m.cap(add(shoulder, [0, -0.3 * r, 0]), add(shieldC, [0, 0.1 * r, 0.1 * r]), 0.12 * r, darken(p.steel, 0.2), 0);
  m.disc(shieldC, [0, 0, 1], [0.85, 0.53, 0], 0.55 * r, 0.42 * r, p.team, 0.01);
  m.disc(add(shieldC, [0.02 * r, -0.01 * r, 0]), [0, 0, 1], [0.85, 0.53, 0], 0.15 * r, 0.12 * r, p.trim, 0.011, 10);

  // Lance couched under the right arm; the strike drives it forward.
  const thrust = attack >= 0 ? Math.sin(Math.min(1, attack * 1.2) * Math.PI) * 0.8 * r : 0;
  const hand: V3 = add(shoulder, [0.35 * r + thrust, 0.38 * r, -0.4 * r]);
  m.cap(add(shoulder, [0, 0.3 * r, 0]), hand, 0.13 * r, darken(p.steel, 0.2), 0.02);
  const butt: V3 = add(hand, [-0.9 * r, 0.02 * r, 0.12 * r]);
  const tip: V3 = add(hand, [3.4 * r, 0.05 * r, moving || attack >= 0 ? -0.35 * r : 1.2 * r]);
  m.cap(butt, tip, 0.07 * r, p.wood, 0.01, false);
  const dx = tip[0] - butt[0], dz = tip[2] - butt[2], len = Math.hypot(dx, dz);
  const at = (k: number, up: number): V3 => [butt[0] + dx * k - (dz / len) * up, tip[1], butt[2] + dz * k + (dx / len) * up];
  m.poly([at(0.97, 0.04 * r), at(1.12, 0), at(0.97, -0.04 * r)], p.steel, 0.011);
  m.poly([at(0.78, 0), at(0.92, 0), at(0.8, -0.35 * r)], p.team, 0.012);
}

export interface FigureFrame {
  /** Bounds in local units (origin at the feet). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  draw(g: Graphics, ox: number, oy: number): void;
}

/** Build one frame of a unit design facing `angle`, ready to paint at any offset. */
export function buildFigure(type: UnitType, team: Team, r: number, theme: Theme, variant: number, angle: number, frame: number): FigureFrame {
  const m = new Model();
  const p = palette(team, theme);
  if (type === 'cavalry') horseman(m, r, p, frame, variant);
  else footman(m, type, r, p, frame);

  const cos = Math.cos(angle), sin = Math.sin(angle);
  const project = (v: V3): [number, number, number] => {
    const gx = v[0] * cos - v[1] * sin, gy = v[0] * sin + v[1] * cos;
    return [gx, gy * TILT - v[2], gy];
  };

  interface Shape { depth: number; order: number; pts: [number, number][]; w: number; color: number; cap: boolean; gloss: boolean }
  const shapes: Shape[] = m.prims.map((pr, order) => {
    const pts3 = pr.k === 'cap' ? [pr.a, pr.b] : pr.pts;
    const proj = pts3.map(project);
    const depth = proj.reduce((s, q) => s + q[2], 0) / proj.length;
    return {
      depth: depth + pr.bias * r,
      order,
      pts: proj.map(q => [q[0], q[1]] as [number, number]),
      w: pr.k === 'cap' ? pr.w : 0,
      color: pr.color,
      cap: pr.k === 'cap',
      gloss: pr.k === 'cap' && pr.gloss,
    };
  });
  shapes.sort((a, b) => a.depth - b.depth || a.order - b.order);

  // Ground shadow: a soft ellipse under the figure, stretched along the horse.
  const shadow: [number, number][] = [];
  const sl = type === 'cavalry' ? 1.9 * r : 0.65 * r, sw = type === 'cavalry' ? 0.75 * r : 0.55 * r;
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2;
    const q = project([Math.cos(t) * sl, Math.sin(t) * sw, 0]);
    shadow.push([q[0] + 0.25 * r, q[1] + 0.05 * r]);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number, pad: number) => {
    minX = Math.min(minX, x - pad); maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad); maxY = Math.max(maxY, y + pad);
  };
  const ow = Math.max(0.35, r * 0.07);
  for (const s of shapes) for (const [x, y] of s.pts) grow(x, y, s.w + ow + 0.2);
  for (const [x, y] of shadow) grow(x, y, 0.2);

  const draw = (g: Graphics, ox: number, oy: number) => {
    g.poly(shadow.flatMap(([x, y]) => [x + ox, y + oy])).fill({ color: 0x000000, alpha: 0.3 });
    // Silhouette rim first, so the figure reads against grass at any zoom.
    for (const s of shapes) paint(g, s, ox, oy, OUTLINE, ow);
    for (const s of shapes) {
      // Parts on the far side sit in shade.
      const k = Math.max(0, Math.min(1, 0.5 + s.depth / (r * 1.6)));
      paint(g, s, ox, oy, darken(s.color, 0.22 * (1 - k)), 0);
      if (s.gloss && s.w > 0.12 * r) {
        // Sunlight from the upper left.
        const hx = -s.w * 0.28, hy = -s.w * 0.38;
        const [a, b] = s.pts;
        g.moveTo(a[0] + ox + hx, a[1] + oy + hy).lineTo(b[0] + ox + hx + (a[0] === b[0] && a[1] === b[1] ? 0.01 : 0), b[1] + oy + hy)
          .stroke({ width: s.w * 0.75, color: lighten(s.color, 0.35), alpha: 0.55, cap: 'round' });
      }
    }
  };
  return { minX, minY, maxX, maxY, draw };
}

function paint(g: Graphics, s: { pts: [number, number][]; w: number; cap: boolean }, ox: number, oy: number, color: number, rim: number): void {
  if (s.cap) {
    const [a, b] = s.pts;
    if (Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4) {
      g.circle(a[0] + ox, a[1] + oy, s.w + rim).fill(color);
    } else {
      g.moveTo(a[0] + ox, a[1] + oy).lineTo(b[0] + ox, b[1] + oy).stroke({ width: (s.w + rim) * 2, color, cap: 'round' });
    }
    return;
  }
  const flat = s.pts.flatMap(([x, y]) => [x + ox, y + oy]);
  g.poly(flat).fill(color);
  if (rim > 0) g.poly(flat).stroke({ width: rim * 2, color, join: 'round' });
}
