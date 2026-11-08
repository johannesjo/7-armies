import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Team, UnitType } from '../types';

/**
 * Low-poly unit models for the 3D renderer, built from primitives in metres
 * (+X is the facing, +Y up, +Z the unit's right). Every vertex carries a colour and
 * a rig: `aRig = (pivotX, pivotY, phaseOffset, kind)` where kind 1 swings the part
 * about its pivot with the gait (legs) and kind 2 swings it with the attack (weapon arm).
 */

export const PAL = {
  blue: 0x2758d0, blueDark: 0x15306e, red: 0xc8281c, redDark: 0x6a120c,
  gold: 0xd8b040, white: 0xeee6d2,
  mail: 0x8c9096, steel: 0xc4c8cc, skin: 0xd8a074, leather: 0x6e4626, boot: 0x3a2618,
  gambeson: 0xb8a07a, hose: 0x5a4a3a, tunic: 0x5e6a38, wood: 0x8a6034,
  coats: [0x6e3c1e, 0x2e2420, 0x9a9488, 0x9a5a2a],
};
export const COATS = PAL.coats.length;

type Rig = [number, number, number, number];
const NO_RIG: Rig = [0, 0, 0, 0];

function finish(geo: THREE.BufferGeometry, color: number, rig: Rig): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const col = new Float32Array(n * 3), r = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    r[i * 4] = rig[0]; r[i * 4 + 1] = rig[1]; r[i * 4 + 2] = rig[2]; r[i * 4 + 3] = rig[3];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRig', new THREE.BufferAttribute(r, 4));
  return g;
}

/** A shape rotated (XYZ) then moved into place. */
function P(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, rig: Rig = NO_RIG) {
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return finish(geo, color, rig);
}

/** A limb hanging from a joint at (x, y, z), swung forward by `a` and out by `b`; writes its end into `out`. */
function limb(len: number, r1: number, r2: number, color: number, x: number, y: number, z: number,
  a = 0, b = 0, out?: { x: number; y: number; z: number }, rig: Rig = NO_RIG) {
  const g = new THREE.CylinderGeometry(r2, r1, len, 6);
  g.translate(0, -len / 2, 0);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b, 0, a));
  g.applyQuaternion(q);
  g.translate(x, y, z);
  if (out) {
    const e = new THREE.Vector3(0, -len, 0).applyQuaternion(q);
    out.x = x + e.x; out.y = y + e.y; out.z = z + e.z;
  }
  return finish(g, color, rig);
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r: number) => new THREE.SphereGeometry(r, 7, 5);
const halfSph = (r: number) => new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
const cone = (r: number, h: number, s = 7) => new THREE.ConeGeometry(r, h, s);

const teamColor = (t: Team) => (t === 'blue' ? PAL.blue : PAL.red);
const teamDark = (t: Team) => (t === 'blue' ? PAL.blueDark : PAL.redDark);
const teamTrim = (t: Team) => (t === 'blue' ? PAL.white : PAL.gold);

/** Legs that swing with the gait (pivot at the hips), boots, coat skirt, torso and belt. */
function lowerBody(g: THREE.BufferGeometry[], body: number, top: number) {
  const hipY = 0.86;
  for (const [z, phase] of [[-0.1, 0], [0.1, Math.PI]] as const) {
    const rig: Rig = [0.02, hipY, phase, 1];
    const f = { x: 0, y: 0, z: 0 };
    g.push(limb(0.82, 0.075, 0.06, PAL.hose, 0.02, hipY, z, 0, 0, f, rig));
    g.push(P(box(0.24, 0.1, 0.12), PAL.boot, f.x + 0.04, 0.05, f.z, 0, 0, 0, rig));
  }
  g.push(P(cyl(0.24, 0.31, 0.42), body, 0, 0.72, 0));
  g.push(P(cyl(0.21, 0.25, 0.55), top, 0, 1.15, 0));
  g.push(P(cyl(0.255, 0.255, 0.06), PAL.leather, 0, 0.92, 0));
}

function tabard(g: THREE.BufferGeometry[], team: Team, h = 0.8, y = 1.0) {
  g.push(P(box(0.53, h, 0.34), teamColor(team), 0, y, 0));
  g.push(P(box(0.545, h * 0.9, 0.07), teamTrim(team), 0, y + 0.02, 0));
}

function head(g: THREE.BufferGeometry[]) {
  g.push(P(cyl(0.06, 0.07, 0.1), PAL.skin, 0.02, 1.49, 0));
  g.push(P(sph(0.12), PAL.skin, 0.02, 1.6, 0));
}

/** Shoulders and arms; the right arm (and whatever it holds) is rigged to swing with the attack. */
function arms(g: THREE.BufferGeometry[], sleeve: number, left: [number, number], right: [number, number]) {
  const hl = { x: 0, y: 0, z: 0 }, hr = { x: 0, y: 0, z: 0 };
  const armRig: Rig = [0, 1.4, 0, 2];
  g.push(P(sph(0.11), sleeve, 0, 1.38, -0.27), P(sph(0.11), sleeve, 0, 1.38, 0.27));
  g.push(limb(0.62, 0.07, 0.055, sleeve, 0, 1.4, -0.29, left[0], left[1], hl));
  g.push(limb(0.62, 0.07, 0.055, sleeve, 0, 1.4, 0.29, right[0], right[1], hr, armRig));
  g.push(P(sph(0.06), PAL.skin, hl.x, hl.y, hl.z), P(sph(0.06), PAL.skin, hr.x, hr.y, hr.z, 0, 0, 0, armRig));
  return { hl, hr, armRig };
}

function swordsman(team: Team) {
  const g: THREE.BufferGeometry[] = [];
  lowerBody(g, PAL.mail, PAL.mail);
  tabard(g, team);
  const { hl, hr, armRig } = arms(g, PAL.mail, [0.55, -0.35], [1.0, 0.25]);
  head(g);
  g.push(P(cone(0.15, 0.24), PAL.steel, 0.02, 1.74, 0), P(cyl(0.155, 0.155, 0.06), PAL.steel, 0.02, 1.64, 0));
  g.push(P(cyl(0.33, 0.33, 0.05, 10), teamColor(team), hl.x + 0.05, hl.y + 0.05, hl.z - 0.1, Math.PI / 2, 0, 0));
  g.push(P(box(0.12, 0.62, 0.01), teamTrim(team), hl.x + 0.05, hl.y + 0.05, hl.z - 0.13, 0, 0, 0.7));
  g.push(P(sph(0.07), PAL.steel, hl.x + 0.05, hl.y + 0.05, hl.z - 0.15));
  const up = 1.0;
  g.push(P(box(0.82, 0.06, 0.025), 0xdde2e8, hr.x + Math.cos(up) * 0.42, hr.y + Math.sin(up) * 0.42, hr.z, 0, 0, up, armRig));
  g.push(P(box(0.05, 0.05, 0.22), PAL.gold, hr.x, hr.y, hr.z, 0, 0, 0, armRig));
  return mergeGeometries(g);
}

function pikeman(team: Team) {
  const g: THREE.BufferGeometry[] = [];
  lowerBody(g, PAL.gambeson, PAL.gambeson);
  tabard(g, team, 0.62, 1.1);
  arms(g, PAL.gambeson, [0.75, 0.25], [0.5, -0.1]);
  head(g);
  g.push(P(halfSph(0.15), PAL.steel, 0.02, 1.66, 0), P(cyl(0.27, 0.27, 0.025, 10), PAL.steel, 0.02, 1.67, 0));
  // The pike thrusts with the attack (pivot near the hands).
  const thrust: Rig = [0.3, 1.25, 0, 2];
  const ang = 0.1;
  g.push(P(cyl(0.022, 0.022, 4.4, 5), PAL.wood, 0.9, 1.28, 0.2, 0, 0, Math.PI / 2 - ang, thrust));
  g.push(P(cone(0.05, 0.28, 5), PAL.steel, 0.9 + Math.cos(ang) * 2.34, 1.28 + Math.sin(ang) * 2.34, 0.2, 0, 0, -Math.PI / 2 + ang, thrust));
  return mergeGeometries(g);
}

function archer(team: Team) {
  const g: THREE.BufferGeometry[] = [];
  lowerBody(g, PAL.tunic, PAL.tunic);
  g.push(P(box(0.5, 0.2, 0.52), teamColor(team), 0, 1.36, 0));
  const { hl } = arms(g, PAL.tunic, [1.25, -0.15], [0.7, 0.3]);
  head(g);
  g.push(P(halfSph(0.145), teamDark(team), 0, 1.62, 0));
  g.push(P(cyl(0.07, 0.07, 0.6), PAL.leather, -0.22, 1.25, 0.1, 0.35, 0, 0));
  g.push(P(new THREE.TorusGeometry(0.62, 0.025, 3, 10, Math.PI * 0.72), PAL.wood, hl.x + 0.05 - 0.45, hl.y, hl.z, 0, 0, -Math.PI * 0.36));
  return mergeGeometries(g);
}

function knight(team: Team, coat: number) {
  const C = teamColor(team), trim = teamTrim(team);
  const mane = new THREE.Color(coat).multiplyScalar(0.4).getHex();
  const g: THREE.BufferGeometry[] = [];
  g.push(P(new THREE.CapsuleGeometry(0.36, 0.95, 3, 8), coat, 0, 1.32, 0, 0, 0, Math.PI / 2));
  g.push(P(sph(0.4), coat, 0.55, 1.34, 0), P(sph(0.41), coat, -0.58, 1.38, 0));
  const nk = { x: 0, y: 0, z: 0 };
  g.push(limb(0.85, 0.26, 0.17, coat, 0.72, 1.5, 0, Math.PI - 0.45, 0, nk));
  g.push(P(box(0.66, 0.26, 0.23), coat, nk.x + 0.22, nk.y - 0.12, 0, 0, 0, -0.75));
  g.push(P(box(0.4, 0.09, 0.24), PAL.steel, nk.x + 0.18, nk.y - 0.02, 0, 0, 0, -0.75));
  g.push(limb(0.75, 0.06, 0.04, mane, 0.7, 1.68, 0, Math.PI - 0.5));
  g.push(limb(0.8, 0.09, 0.04, mane, -0.95, 1.5, 0, -0.55));
  // Four legs, each swinging about its hip with a gallop's footfall order.
  const legs: [number, number, number][] = [[0.55, -0.17, 0], [0.55, 0.17, 0.6], [-0.6, -0.17, Math.PI], [-0.6, 0.17, Math.PI + 0.6]];
  for (const [lx, lz, phase] of legs) {
    const rig: Rig = [lx, 1.12, phase, 1];
    const k = { x: 0, y: 0, z: 0 }, h = { x: 0, y: 0, z: 0 };
    g.push(limb(0.5, 0.09, 0.07, coat, lx, 1.12, lz, 0, 0, k, rig));
    g.push(limb(0.5, 0.06, 0.05, coat, k.x, k.y, k.z, lx > 0 ? -0.15 : 0.2, 0, h, rig));
    g.push(P(cyl(0.065, 0.075, 0.08, 6), 0x1a1410, h.x, h.y + 0.02, h.z, 0, 0, 0, rig));
  }
  g.push(P(box(1.2, 0.36, 0.84), C, -0.12, 1.3, 0));
  g.push(P(box(1.22, 0.06, 0.86), trim, -0.12, 1.12, 0));
  g.push(P(box(0.12, 0.38, 0.855), trim, 0.1, 1.3, 0));
  g.push(P(box(0.55, 0.12, 0.62), PAL.leather, -0.1, 1.72, 0));
  // Rider.
  g.push(limb(0.6, 0.075, 0.06, PAL.mail, -0.05, 1.72, -0.3, 0.35, 0.15), limb(0.6, 0.075, 0.06, PAL.mail, -0.05, 1.72, 0.3, 0.35, -0.15));
  g.push(P(cyl(0.22, 0.26, 0.6), PAL.mail, -0.1, 2.05, 0));
  g.push(P(box(0.5, 0.62, 0.36), C, -0.1, 2.0, 0), P(box(0.515, 0.56, 0.08), trim, -0.1, 2.02, 0));
  const hl = { x: 0, y: 0, z: 0 }, hr = { x: 0, y: 0, z: 0 };
  const lance: Rig = [-0.1, 2.3, 0, 2];
  g.push(P(sph(0.11), PAL.mail, -0.1, 2.28, -0.27), P(sph(0.11), PAL.mail, -0.1, 2.28, 0.27));
  g.push(limb(0.55, 0.065, 0.05, PAL.mail, -0.1, 2.3, -0.29, 0.9, -0.2, hl), limb(0.55, 0.065, 0.05, PAL.mail, -0.1, 2.3, 0.29, 1.3, 0.25, hr, lance));
  g.push(P(cyl(0.15, 0.15, 0.3, 8), PAL.steel, -0.08, 2.55, 0));
  g.push(P(box(0.02, 0.03, 0.2), 0x111111, 0.07, 2.58, 0));
  g.push(P(cone(0.07, 0.26, 6), C, -0.1, 2.83, 0, 0, 0, 0.4));
  g.push(P(box(0.05, 0.62, 0.42), C, hl.x + 0.06, hl.y + 0.05, hl.z - 0.08, 0, 0, 0.15));
  g.push(P(box(0.055, 0.6, 0.08), trim, hl.x + 0.06, hl.y + 0.05, hl.z - 0.08, 0, 0, 0.15));
  g.push(P(cyl(0.03, 0.03, 3.8, 5), PAL.wood, hr.x + 1.2, hr.y + 0.05, hr.z, 0, 0, Math.PI / 2 - 0.06, lance));
  g.push(P(cone(0.05, 0.26, 5), PAL.steel, hr.x + 3.15, hr.y + 0.17, hr.z, 0, 0, -Math.PI / 2 - 0.06, lance));
  g.push(P(box(0.45, 0.2, 0.01), C, hr.x + 2.55, hr.y + 0.05, hr.z, 0, 0, 0, lance));
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
    P(cyl(0.035, 0.04, 4.2, 5), PAL.wood, 0, 2.1, 0), P(sph(0.06), PAL.gold, 0, 4.22, 0),
    P(box(1.2, 0.85, 0.02), teamColor(team), 0.6, 3.7, 0), P(box(0.16, 0.85, 0.025), teamTrim(team), 0.6, 3.7, 0),
  ]);
}

/** Foliage faces get slightly different greens, so canopies read as masses of leaves. */
function speckle(g: THREE.BufferGeometry, seed: number) {
  const c = g.attributes.color;
  for (let f = 0; f < c.count; f += 3) {
    const k = 1 + (Math.sin(f * 12.9898 + seed * 78.233) * 43758.5453 % 1) * 0.35;
    for (let v = f; v < f + 3; v++) c.setXYZ(v, c.getX(v) * k, c.getY(v) * k, c.getZ(v) * k);
  }
  return g;
}

export function oakGeometry(v: number): THREE.BufferGeometry {
  const leaves = [0x355a1c, 0x44702a, 0x2c4a16, 0x5a8434];
  const parts = [P(cyl(0.2, 0.32, 2.8, 6), 0x5a3c22, 0, 1.4, 0)];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + v, rr = 1.4;
    parts.push(speckle(P(new THREE.IcosahedronGeometry(1.35, 1), leaves[(k + v) % 4], Math.cos(a) * rr, 3.7 + (k % 2) * 0.6, Math.sin(a) * rr), k + v * 10));
  }
  parts.push(speckle(P(new THREE.IcosahedronGeometry(1.9, 1), leaves[(v + 1) % 4], 0, 4.5, 0), v));
  return mergeGeometries(parts);
}

export function pineGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    P(cyl(0.14, 0.22, 1.6, 5), 0x4a3020, 0, 0.8, 0),
    speckle(P(cone(1.5, 2.4, 9), 0x2a4a1e, 0, 2.2, 0), 1),
    speckle(P(cone(1.2, 2.0, 9), 0x30561f, 0, 3.4, 0), 2),
    speckle(P(cone(0.85, 1.7, 9), 0x386226, 0, 4.5, 0), 3),
  ]);
}

export function tentGeometry(team: Team): THREE.BufferGeometry {
  return mergeGeometries([
    P(cone(1.6, 2.6, 4), 0xe8dcc0, 0, 1.3, 0, 0, Math.PI / 4, 0),
    P(cyl(0.04, 0.04, 3.6, 4), PAL.wood, 0, 1.8, 0),
    P(box(0.6, 0.35, 0.02), teamColor(team), 0.3, 3.4, 0),
  ]);
}

/** A tuft of three grass blades as flat triangles (cheap enough to scatter by the thousand). */
export function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2, lx = Math.cos(a) * 0.06, lz = Math.sin(a) * 0.06;
    const tx = Math.cos(a) * 0.14, tz = Math.sin(a) * 0.14;
    pos.push(lx - lz * 0.4, 0, lz + lx * 0.4, lx + lz * 0.4, 0, lz - lx * 0.4, tx, 0.36 + i * 0.05, tz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1; // lit like the ground
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}
