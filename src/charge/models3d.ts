import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Team, UnitType } from '../types';

/**
 * Low-poly unit models for the 3D renderer, built from primitives in metres
 * (+X is the facing, +Y up, +Z the unit's right), with slightly heroic proportions
 * (big heads, hands, shields and weapons read better from above).
 *
 * Every vertex carries:
 * - `color`
 * - `aRig = (pivotX, pivotY, phaseOffset, kind)` — how the part moves (see RIG_KIND)
 * - `aRig2 = (kneeX, kneeY, tint, 0)` — knee pivot for lower legs; tint 1 = cloth that
 *   varies a little from soldier to soldier
 * - `aMat = (roughness, metalness)`
 */

/** How a part moves: rotations are about Z, i.e. forward/back in the unit's side view. */
export const RIG_KIND = {
  none: 0,
  /** Swings about its pivot with the gait (upper legs). */
  swing: 1,
  /** Turns with the attack (weapon arm). */
  attack: 2,
  /** Lower leg: folds at the knee, then swings with the upper leg. */
  shin: 3,
  /** Swishes, lifting at speed (horse tail). */
  tail: 4,
  /** Bobs up and down twice a stride (rider in the saddle). */
  bob: 5,
  /** Nods twice a stride (horse neck and head). */
  nod: 6,
} as const;

export const PAL = {
  blue: 0x2758d0, blueDark: 0x15306e, red: 0xc8281c, redDark: 0x6a120c,
  gold: 0xd8b040, white: 0xeee6d2,
  mail: 0x8c9096, steel: 0xc8ccd2, skin: 0xd8a074, leather: 0x6e4626, boot: 0x3a2618,
  gambeson: 0xb8a07a, hose: 0x5a4a3a, tunic: 0x5e6a38, wood: 0x8a6034,
  coats: [0x6e3c1e, 0x2e2420, 0x9a9488, 0x9a5a2a],
};
export const COATS = PAL.coats.length;

type Mat = [number, number];
const CLOTH: Mat = [0.88, 0], MAIL: Mat = [0.5, 0.55], STEEL: Mat = [0.32, 0.85], LEATHER: Mat = [0.7, 0];
const SKIN: Mat = [0.62, 0], WOOD: Mat = [0.78, 0], COAT: Mat = [0.6, 0], GOLD: Mat = [0.35, 0.9];

interface PartOpts {
  kind?: number;
  pivot?: [number, number];
  phase?: number;
  knee?: [number, number];
  tint?: boolean;
  mat?: Mat;
}

function finish(geo: THREE.BufferGeometry, color: number, o: PartOpts = {}): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const col = new Float32Array(n * 3), r = new Float32Array(n * 4), r2 = new Float32Array(n * 4), m = new Float32Array(n * 2);
  const [px, py] = o.pivot ?? [0, 0], [kx, ky] = o.knee ?? [0, 0], mat = o.mat ?? CLOTH;
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    r[i * 4] = px; r[i * 4 + 1] = py; r[i * 4 + 2] = o.phase ?? 0; r[i * 4 + 3] = o.kind ?? 0;
    r2[i * 4] = kx; r2[i * 4 + 1] = ky; r2[i * 4 + 2] = o.tint ? 1 : 0;
    m[i * 2] = mat[0]; m[i * 2 + 1] = mat[1];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRig', new THREE.BufferAttribute(r, 4));
  g.setAttribute('aRig2', new THREE.BufferAttribute(r2, 4));
  g.setAttribute('aMat', new THREE.BufferAttribute(m, 2));
  return g;
}

/** A shape rotated (XYZ) then moved into place. */
function P(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, o: PartOpts = {}) {
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return finish(geo, color, o);
}

type Pt = { x: number; y: number; z: number };
/** A tapered limb from a joint at (x, y, z), swung forward by `a` and out by `b`; its end goes into `out`. */
function limb(len: number, r1: number, r2: number, color: number, x: number, y: number, z: number,
  a = 0, b = 0, out?: Pt, o: PartOpts = {}) {
  const g = new THREE.CylinderGeometry(r2, r1, len, seg(8));
  g.translate(0, -len / 2, 0);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b, 0, a));
  g.applyQuaternion(q);
  g.translate(x, y, z);
  if (out) {
    const e = new THREE.Vector3(0, -len, 0).applyQuaternion(q);
    out.x = x + e.x; out.y = y + e.y; out.z = z + e.z;
  }
  return finish(g, color, o);
}

/** Segment counts scale with the detail level: phones get about half the triangles. */
let detail = 1;
export function setModelDetail(level: 'high' | 'low'): void { detail = level === 'high' ? 1 : 0.55; }
const seg = (n: number) => Math.max(4, Math.round(n * detail));
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, s = 9) => new THREE.CylinderGeometry(rt, rb, h, seg(s));
const sph = (r: number, ws = 10, hs = 7) => new THREE.SphereGeometry(r, seg(ws), Math.max(3, seg(hs)));
const halfSph = (r: number) => new THREE.SphereGeometry(r, seg(10), Math.max(3, seg(5)), 0, Math.PI * 2, 0, Math.PI / 2);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, seg(s));

const teamColor = (t: Team) => (t === 'blue' ? PAL.blue : PAL.red);
const teamDark = (t: Team) => (t === 'blue' ? PAL.blueDark : PAL.redDark);
const teamTrim = (t: Team) => (t === 'blue' ? PAL.white : PAL.gold);

/** Legs with knees (thighs swing at the hip, shins fold at the knee), boots, coat, torso, belt. */
function lowerBody(g: THREE.BufferGeometry[], body: number, top: number, bodyMat: Mat, tintBody: boolean) {
  const hipY = 0.88, kneeY = 0.47;
  for (const [z, phase] of [[-0.1, 0], [0.1, Math.PI]] as const) {
    const thigh: PartOpts = { kind: RIG_KIND.swing, pivot: [0.02, hipY], phase, mat: CLOTH };
    const shin: PartOpts = { kind: RIG_KIND.shin, pivot: [0.02, hipY], knee: [0.02, kneeY], phase, mat: LEATHER };
    g.push(limb(hipY - kneeY, 0.09, 0.075, PAL.hose, 0.02, hipY, z, 0, 0, undefined, thigh));
    g.push(limb(kneeY - 0.08, 0.075, 0.06, PAL.boot, 0.02, kneeY, z, 0, 0, undefined, shin));
    g.push(P(box(0.27, 0.11, 0.13), PAL.boot, 0.06, 0.055, z, 0, 0, 0, shin));
  }
  g.push(P(cyl(0.25, 0.32, 0.44), body, 0, 0.73, 0, 0, 0, 0, { mat: bodyMat, tint: tintBody }));
  g.push(P(cyl(0.22, 0.26, 0.56), top, 0, 1.16, 0, 0, 0, 0, { mat: bodyMat, tint: tintBody }));
  g.push(P(cyl(0.265, 0.265, 0.06), PAL.leather, 0, 0.93, 0, 0, 0, 0, { mat: LEATHER }));
  g.push(P(box(0.07, 0.07, 0.05), PAL.gold, 0.25, 0.93, 0, 0, 0, 0, { mat: GOLD })); // buckle
}

function tabard(g: THREE.BufferGeometry[], team: Team, h = 0.8, y = 1.0) {
  g.push(P(box(0.55, h, 0.35), teamColor(team), 0, y, 0, 0, 0, 0, { tint: true }));
  g.push(P(box(0.565, h * 0.9, 0.075), teamTrim(team), 0, y + 0.02, 0, 0, 0, 0, { tint: true }));
}

function head(g: THREE.BufferGeometry[], y = 1.62) {
  g.push(P(cyl(0.065, 0.075, 0.1), PAL.skin, 0.02, y - 0.13, 0, 0, 0, 0, { mat: SKIN }));
  g.push(P(sph(0.145), PAL.skin, 0.02, y, 0, 0, 0, 0, { mat: SKIN }));
}

/** Shoulders and arms; the right arm (and what it holds) turns with the attack. */
function arms(g: THREE.BufferGeometry[], sleeve: number, sleeveMat: Mat, left: [number, number], right: [number, number]) {
  const hl = { x: 0, y: 0, z: 0 }, hr = { x: 0, y: 0, z: 0 };
  const atk: PartOpts = { kind: RIG_KIND.attack, pivot: [0, 1.4], mat: sleeveMat };
  g.push(P(sph(0.12), sleeve, 0, 1.39, -0.28, 0, 0, 0, { mat: sleeveMat }), P(sph(0.12), sleeve, 0, 1.39, 0.28, 0, 0, 0, { mat: sleeveMat }));
  g.push(limb(0.62, 0.075, 0.06, sleeve, 0, 1.41, -0.3, left[0], left[1], hl, { mat: sleeveMat }));
  g.push(limb(0.62, 0.075, 0.06, sleeve, 0, 1.41, 0.3, right[0], right[1], hr, atk));
  g.push(P(sph(0.078), PAL.skin, hl.x, hl.y, hl.z, 0, 0, 0, { mat: SKIN }), P(sph(0.078), PAL.skin, hr.x, hr.y, hr.z, 0, 0, 0, { ...atk, mat: SKIN }));
  return { hl, hr, atk };
}

function swordsman(team: Team) {
  const g: THREE.BufferGeometry[] = [];
  lowerBody(g, PAL.mail, PAL.mail, MAIL, false);
  tabard(g, team);
  const { hl, hr, atk } = arms(g, PAL.mail, MAIL, [0.55, -0.35], [1.0, 0.25]);
  head(g);
  // Nasal helm.
  g.push(P(cone(0.17, 0.27, 10), PAL.steel, 0.02, 1.77, 0, 0, 0, 0, { mat: STEEL }));
  g.push(P(cyl(0.175, 0.175, 0.07, 10), PAL.steel, 0.02, 1.66, 0, 0, 0, 0, { mat: STEEL }));
  g.push(P(box(0.035, 0.14, 0.035), PAL.steel, 0.17, 1.6, 0, 0, 0, 0, { mat: STEEL }));
  // Round shield: team field, a pale cross, iron rim and boss.
  const sx = hl.x + 0.06, sy = hl.y + 0.06, sz = hl.z - 0.12;
  g.push(P(cyl(0.38, 0.38, 0.05, 14), teamColor(team), sx, sy, sz, Math.PI / 2, 0, 0, { tint: true }));
  g.push(P(cyl(0.395, 0.395, 0.035, 14), 0x3a3a3a, sx, sy, sz + 0.012, Math.PI / 2, 0, 0, { mat: STEEL }));
  g.push(P(box(0.1, 0.66, 0.012), teamTrim(team), sx, sy, sz - 0.03));
  g.push(P(box(0.66, 0.1, 0.012), teamTrim(team), sx, sy, sz - 0.03));
  g.push(P(sph(0.085), PAL.steel, sx, sy, sz - 0.05, 0, 0, 0, { mat: STEEL }));
  // Sword raised in the right hand.
  const up = 1.0;
  g.push(P(box(0.92, 0.07, 0.03), 0xdde2e8, hr.x + Math.cos(up) * 0.48, hr.y + Math.sin(up) * 0.48, hr.z, 0, 0, up, { ...atk, mat: STEEL }));
  g.push(P(box(0.06, 0.06, 0.26), PAL.gold, hr.x, hr.y, hr.z, 0, 0, 0, { ...atk, mat: GOLD }));
  return mergeGeometries(g);
}

function pikeman(team: Team) {
  const g: THREE.BufferGeometry[] = [];
  lowerBody(g, PAL.gambeson, PAL.gambeson, CLOTH, true);
  tabard(g, team, 0.62, 1.1);
  arms(g, PAL.gambeson, CLOTH, [0.75, 0.25], [0.5, -0.1]);
  head(g);
  // Kettle hat.
  g.push(P(halfSph(0.17), PAL.steel, 0.02, 1.68, 0, 0, 0, 0, { mat: STEEL }), P(cyl(0.31, 0.31, 0.03, 14), PAL.steel, 0.02, 1.69, 0, 0, 0, 0, { mat: STEEL }));
  // The pike thrusts with the attack.
  const thrust: PartOpts = { kind: RIG_KIND.attack, pivot: [0.3, 1.25], mat: WOOD };
  const ang = 0.1;
  g.push(P(cyl(0.026, 0.026, 4.6, 6), PAL.wood, 0.95, 1.28, 0.2, 0, 0, Math.PI / 2 - ang, thrust));
  g.push(P(cone(0.06, 0.32, 6), PAL.steel, 0.95 + Math.cos(ang) * 2.45, 1.28 + Math.sin(ang) * 2.45, 0.2, 0, 0, -Math.PI / 2 + ang, { ...thrust, mat: STEEL }));
  return mergeGeometries(g);
}

function archer(team: Team) {
  const g: THREE.BufferGeometry[] = [];
  lowerBody(g, PAL.tunic, PAL.tunic, CLOTH, true);
  g.push(P(box(0.52, 0.22, 0.55), teamColor(team), 0, 1.37, 0, 0, 0, 0, { tint: true })); // cape
  const { hl } = arms(g, PAL.tunic, CLOTH, [1.25, -0.15], [0.7, 0.3]);
  head(g);
  g.push(P(halfSph(0.165), teamDark(team), 0, 1.64, 0, 0, 0, 0, { tint: true }));
  g.push(P(cyl(0.08, 0.08, 0.62), PAL.leather, -0.24, 1.25, 0.1, 0.35, 0, 0, { mat: LEATHER }));
  g.push(P(new THREE.TorusGeometry(0.7, 0.03, 4, seg(12), Math.PI * 0.72), PAL.wood, hl.x + 0.05 - 0.5, hl.y, hl.z, 0, 0, -Math.PI * 0.36, { mat: WOOD }));
  return mergeGeometries(g);
}

function knight(team: Team, coat: number) {
  const C = teamColor(team), trim = teamTrim(team);
  const mane = new THREE.Color(coat).multiplyScalar(0.4).getHex();
  const muzzle = new THREE.Color(coat).multiplyScalar(0.7).getHex();
  const g: THREE.BufferGeometry[] = [];
  const hide: PartOpts = { mat: COAT };
  // Horse: barrel, deep chest and round quarters.
  g.push(P(new THREE.CapsuleGeometry(0.38, 1.0, Math.max(2, seg(4)), seg(10)), coat, -0.02, 1.32, 0, 0, 0, Math.PI / 2, hide));
  g.push(P(sph(0.43), coat, 0.56, 1.36, 0, 0, 0, 0, hide), P(sph(0.44), coat, -0.6, 1.38, 0, 0, 0, 0, hide));
  // Neck, head, muzzle, ears and mane nod together with the stride.
  const nod: PartOpts = { kind: RIG_KIND.nod, pivot: [0.72, 1.55], mat: COAT };
  const nk = { x: 0, y: 0, z: 0 };
  g.push(limb(0.9, 0.28, 0.18, coat, 0.72, 1.52, 0, Math.PI - 0.5, 0, nk, nod));
  g.push(P(box(0.62, 0.27, 0.24), coat, nk.x + 0.2, nk.y - 0.1, 0, 0, 0, -0.85, nod));
  g.push(P(box(0.24, 0.2, 0.2), muzzle, nk.x + 0.42, nk.y - 0.34, 0, 0, 0, -0.85, nod));
  g.push(P(box(0.42, 0.09, 0.25), PAL.steel, nk.x + 0.16, nk.y - 0.0, 0, 0, 0, -0.85, { ...nod, mat: STEEL }));
  g.push(P(cone(0.045, 0.15, 5), coat, nk.x - 0.06, nk.y + 0.16, -0.07, 0, 0, 0, nod), P(cone(0.045, 0.15, 5), coat, nk.x - 0.06, nk.y + 0.16, 0.07, 0, 0, 0, nod));
  g.push(limb(0.8, 0.07, 0.05, mane, 0.68, 1.72, 0, Math.PI - 0.55, 0, undefined, { ...nod, mat: CLOTH }));
  // Tail swishes and lifts at the gallop.
  g.push(limb(0.85, 0.1, 0.05, mane, -0.98, 1.52, 0, -0.5, 0, undefined, { kind: RIG_KIND.tail, pivot: [-0.98, 1.52], mat: CLOTH }));
  // Legs: thigh swings at the hip, cannon folds at the knee; a gallop's footfall order.
  const legs: [number, number, number, number][] = [[0.56, 1.14, -0.18, 0], [0.56, 1.14, 0.18, 0.55], [-0.62, 1.18, -0.18, Math.PI], [-0.62, 1.18, 0.18, Math.PI + 0.55]];
  for (const [lx, ly, lz, phase] of legs) {
    const kneeY = 0.66, k = { x: 0, y: 0, z: 0 };
    const thigh: PartOpts = { kind: RIG_KIND.swing, pivot: [lx, ly], phase, mat: COAT };
    const shin: PartOpts = { kind: RIG_KIND.shin, pivot: [lx, ly], knee: [lx, kneeY], phase, mat: COAT };
    g.push(limb(ly - kneeY, 0.11, 0.075, coat, lx, ly, lz, 0, 0, k, thigh));
    g.push(limb(kneeY - 0.08, 0.062, 0.05, coat, k.x, kneeY, lz, 0, 0, undefined, shin));
    g.push(P(cyl(0.07, 0.08, 0.09, 7), 0x1a1410, k.x, 0.05, lz, 0, 0, 0, { ...shin, mat: WOOD }));
  }
  // Caparison: team cloth with a trimmed hem and a stripe; saddle.
  g.push(P(box(1.24, 0.38, 0.88), C, -0.12, 1.32, 0, 0, 0, 0, { tint: true }));
  g.push(P(box(1.26, 0.07, 0.9), trim, -0.12, 1.12, 0, 0, 0, 0, { tint: true }));
  g.push(P(box(0.13, 0.4, 0.895), trim, 0.1, 1.32, 0, 0, 0, 0, { tint: true }));
  g.push(P(box(0.58, 0.13, 0.64), PAL.leather, -0.1, 1.74, 0, 0, 0, 0, { mat: LEATHER }));
  // Rider, bobbing in the saddle.
  const bob: PartOpts = { kind: RIG_KIND.bob, mat: MAIL };
  g.push(limb(0.62, 0.08, 0.065, PAL.mail, -0.05, 1.74, -0.31, 0.35, 0.15, undefined, bob), limb(0.62, 0.08, 0.065, PAL.mail, -0.05, 1.74, 0.31, 0.35, -0.15, undefined, bob));
  g.push(P(cyl(0.23, 0.27, 0.62), PAL.mail, -0.1, 2.06, 0, 0, 0, 0, bob));
  g.push(P(box(0.52, 0.64, 0.37), C, -0.1, 2.01, 0, 0, 0, 0, { ...bob, mat: CLOTH, tint: true }), P(box(0.535, 0.58, 0.085), trim, -0.1, 2.03, 0, 0, 0, 0, { ...bob, mat: CLOTH, tint: true }));
  const hl = { x: 0, y: 0, z: 0 }, hr = { x: 0, y: 0, z: 0 };
  const lance: PartOpts = { kind: RIG_KIND.attack, pivot: [-0.1, 2.3], mat: MAIL };
  g.push(P(sph(0.12), PAL.mail, -0.1, 2.3, -0.28, 0, 0, 0, bob), P(sph(0.12), PAL.mail, -0.1, 2.3, 0.28, 0, 0, 0, bob));
  g.push(limb(0.56, 0.07, 0.055, PAL.mail, -0.1, 2.32, -0.3, 0.9, -0.2, hl, bob), limb(0.56, 0.07, 0.055, PAL.mail, -0.1, 2.32, 0.3, 1.3, 0.25, hr, lance));
  g.push(P(cyl(0.17, 0.17, 0.33, 10), PAL.steel, -0.08, 2.6, 0, 0, 0, 0, { ...bob, mat: STEEL })); // great helm
  g.push(P(box(0.02, 0.035, 0.22), 0x111111, 0.09, 2.63, 0, 0, 0, 0, bob));
  g.push(P(cone(0.08, 0.3, 6), C, -0.1, 2.9, 0, 0, 0, 0.4, { ...bob, mat: CLOTH }));
  // Kite shield with a chevron; couched lance with a pennant.
  const kx = hl.x + 0.06, ky = hl.y + 0.05, kz = hl.z - 0.09;
  g.push(P(box(0.05, 0.7, 0.48), C, kx, ky, kz, 0, 0, 0.15, { ...bob, mat: CLOTH, tint: true }));
  g.push(P(box(0.055, 0.42, 0.08), trim, kx, ky, kz - 0.1, 0.6, 0, 0.15, { ...bob, mat: CLOTH }));
  g.push(P(box(0.055, 0.42, 0.08), trim, kx, ky, kz + 0.1, -0.6, 0, 0.15, { ...bob, mat: CLOTH }));
  g.push(P(cyl(0.035, 0.035, 4.0, 6), PAL.wood, hr.x + 1.25, hr.y + 0.05, hr.z, 0, 0, Math.PI / 2 - 0.06, { ...lance, mat: WOOD }));
  g.push(P(cone(0.06, 0.3, 6), PAL.steel, hr.x + 3.3, hr.y + 0.17, hr.z, 0, 0, -Math.PI / 2 - 0.06, { ...lance, mat: STEEL }));
  g.push(P(box(0.5, 0.22, 0.012), C, hr.x + 2.65, hr.y + 0.05, hr.z, 0, 0, 0, { ...lance, mat: CLOTH }));
  return mergeGeometries(g);
}

/** Geometry for a unit kind. `variant` picks the horse's coat. */
export function unitGeometry(type: UnitType, team: Team, variant = 0): THREE.BufferGeometry {
  switch (type) {
    case 'cavalry': return knight(team, PAL.coats[variant % COATS]);
    case 'pikeman': return pikeman(team);
    case 'archer': return archer(team);
    default: return swordsman(team);
  }
}

/** A standard: pole, finial and a flag in the team colours. */
export function standardGeometry(team: Team): THREE.BufferGeometry {
  return mergeGeometries([
    P(cyl(0.035, 0.04, 4.2, 5), PAL.wood, 0, 2.1, 0, 0, 0, 0, { mat: WOOD }), P(sph(0.07), PAL.gold, 0, 4.22, 0, 0, 0, 0, { mat: GOLD }),
    P(box(1.2, 0.85, 0.02), teamColor(team), 0.6, 3.7, 0), P(box(0.16, 0.85, 0.025), teamTrim(team), 0.6, 3.7, 0),
  ]);
}

/** A small pennant on a lance-length pole, for cavalry squadrons. */
export function pennantGeometry(team: Team): THREE.BufferGeometry {
  const flag = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 3.35, 0), new THREE.Vector3(-0.9, 3.15, 0), new THREE.Vector3(0, 2.95, 0)]);
  flag.computeVertexNormals();
  return mergeGeometries([
    P(cyl(0.025, 0.03, 3.4, 5), PAL.wood, 0, 1.7, 0, 0, 0, 0, { mat: WOOD }),
    P(flag, teamColor(team)),
  ]);
}

/** Foliage faces get slightly different greens, so canopies read as masses of leaves. */
function speckle(g: THREE.BufferGeometry, seed: number) {
  const c = g.attributes.color;
  for (let f = 0; f < c.count; f += 3) {
    const v = Math.sin(f * 12.9898 + seed * 78.233) * 43758.5453;
    const k = 0.82 + (v - Math.floor(v)) * 0.36;
    for (let i = f; i < f + 3; i++) c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}

export function oakGeometry(v: number): THREE.BufferGeometry {
  const leaves = [0x355a1c, 0x44702a, 0x2c4a16, 0x5a8434];
  const parts = [P(cyl(0.2, 0.32, 2.8, 6), 0x5a3c22, 0, 1.4, 0, 0, 0, 0, { mat: WOOD })];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + v, rr = 1.4;
    parts.push(speckle(P(new THREE.IcosahedronGeometry(1.35, 1), leaves[(k + v) % 4], Math.cos(a) * rr, 3.7 + (k % 2) * 0.6, Math.sin(a) * rr), k + v * 10));
  }
  parts.push(speckle(P(new THREE.IcosahedronGeometry(1.9, 1), leaves[(v + 1) % 4], 0, 4.5, 0), v));
  return mergeGeometries(parts);
}

export function pineGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    P(cyl(0.14, 0.22, 1.6, 5), 0x4a3020, 0, 0.8, 0, 0, 0, 0, { mat: WOOD }),
    speckle(P(cone(1.5, 2.4, 9), 0x2a4a1e, 0, 2.2, 0), 1),
    speckle(P(cone(1.2, 2.0, 9), 0x30561f, 0, 3.4, 0), 2),
    speckle(P(cone(0.85, 1.7, 9), 0x386226, 0, 4.5, 0), 3),
  ]);
}

export function tentGeometry(team: Team): THREE.BufferGeometry {
  return mergeGeometries([
    P(cone(1.6, 2.6, 4), 0xe8dcc0, 0, 1.3, 0, 0, Math.PI / 4, 0),
    P(cyl(0.04, 0.04, 3.6, 4), PAL.wood, 0, 1.8, 0, 0, 0, 0, { mat: WOOD }),
    P(box(0.6, 0.35, 0.02), teamColor(team), 0.3, 3.4, 0),
  ]);
}

/** A farmhouse: whitewashed walls, timber corners, thatched roof, a chimney. */
export function houseGeometry(): THREE.BufferGeometry {
  const roof = new THREE.CylinderGeometry(0.01, 3.2, 2.4, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.25, 1, 0.85);
  return mergeGeometries([
    P(box(5.4, 2.6, 3.8), 0xe8e0cc, 0, 1.3, 0),
    ...[[-2.7, -1.9], [2.7, -1.9], [-2.7, 1.9], [2.7, 1.9]].map(([x, z]) => P(box(0.22, 2.7, 0.22), 0x5a3c22, x, 1.35, z, 0, 0, 0, { mat: WOOD })),
    P(box(0.9, 1.5, 0.08), 0x5a3c22, 1.2, 0.75, 1.92, 0, 0, 0, { mat: WOOD }),
    P(roof, 0xb89a54, 0, 3.8, 0),
    P(box(0.5, 1.4, 0.5), 0x8a8478, -1.6, 4.2, 0.6),
  ]);
}

/** A haystack. */
export function haystackGeometry(): THREE.BufferGeometry {
  return mergeGeometries([P(cyl(0.9, 1.15, 1.2, 10), 0xc8a856, 0, 0.6, 0), P(cone(0.92, 0.9, 10), 0xd4b462, 0, 1.65, 0)]);
}

/** A section of split-rail fence, 4 m long along X. */
export function fenceGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    P(box(0.12, 1.1, 0.12), 0x6a4a2a, -2, 0.55, 0, 0, 0, 0, { mat: WOOD }), P(box(0.12, 1.1, 0.12), 0x6a4a2a, 2, 0.55, 0, 0, 0, 0, { mat: WOOD }),
    P(box(4.1, 0.08, 0.07), 0x7a5a36, 0, 0.75, 0, 0, 0, 0.02, { mat: WOOD }), P(box(4.1, 0.08, 0.07), 0x7a5a36, 0, 0.4, 0, 0, 0, -0.02, { mat: WOOD }),
  ]);
}

/** A low, dark shrub dotted about the open field. */
export function bushGeometry(v: number): THREE.BufferGeometry {
  const greens = [0x2e4a1a, 0x36521e, 0x2a4418, 0x3e5a22];
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + v, r = 0.35 + (k % 2) * 0.12;
    parts.push(speckle(P(new THREE.IcosahedronGeometry(0.42 + (k % 3) * 0.08, 1), greens[(k + v) % 4], Math.cos(a) * r, 0.32, Math.sin(a) * r), k + v * 7));
  }
  parts.push(speckle(P(new THREE.IcosahedronGeometry(0.5, 1), greens[(v + 2) % 4], 0, 0.5, 0), v + 30));
  return mergeGeometries(parts);
}
