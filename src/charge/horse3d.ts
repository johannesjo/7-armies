import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Team } from '../types';
import horseUrl from './assets/horse.glb?url';
import { COATS, PAL, riderGeometry } from './models3d';

/**
 * The animated horse (Quaternius, CC0 — see assets/CREDITS.md), baked for crowds: every
 * clip is sampled into a float texture of bone matrices (one row per frame, three texels
 * per bone), so hundreds of horses animate in a single instanced draw call each. The
 * vertex shader skins with `aBake = (rowA, rowB, blend)` per instance.
 */

export type HorseClip = 'Gallop' | 'Walk' | 'Idle' | 'Death';
export interface ClipRows { start: number; frames: number; duration: number }

export interface HorseKit {
  /** Bone matrices: width = joints * 3 texels, height = all frames of all clips. */
  bake: THREE.DataTexture;
  clips: Record<HorseClip, ClipRows>;
  /** Horse + rider geometry per team and coat. */
  geometry(team: Team, coat: number): THREE.BufferGeometry;
}

/** Withers at about 1.45 m; the model stands 4.81 units tall and faces +Z. */
const SCALE = 0.48;
const FPS = 30;
const CLIPS: HorseClip[] = ['Gallop', 'Walk', 'Idle', 'Death'];
/** Coats: [main, dark, light, mane] for each of COATS variants. */
const COAT_SHADES: [number, number, number, number][] = [
  [0x6e3c1e, 0x4a2814, 0x8a5430, 0x1e1410], // bay
  [0x2e2420, 0x1c1614, 0x463a32, 0x0e0a08], // black
  [0x9a9488, 0x6e6a60, 0xc0bcb0, 0x4a4640], // grey
  [0x9a5a2a, 0x6e3e1a, 0xbe7c46, 0x3a2414], // chestnut
];

let kit: Promise<HorseKit | null> | null = null;

/** Load and bake once per session; resolves to null if the model can't be loaded. */
export function loadHorseKit(): Promise<HorseKit | null> {
  kit ??= build().catch((e) => { console.warn('3D horse unavailable, using the simple one', e); return null; });
  return kit;
}

async function build(): Promise<HorseKit> {
  const gltf = await new GLTFLoader().loadAsync(horseUrl);
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  if (!meshes.length) throw new Error('no skinned mesh');
  gltf.scene.updateMatrixWorld(true);
  const skeleton = meshes[0].skeleton, bones = skeleton.bones, J = bones.length;
  const bindMatrix = meshes[0].bindMatrix, bindInv = meshes[0].bindMatrixInverse;
  const back = Math.max(0, bones.findIndex((b) => b.name === 'Torso2'));
  // Model space: face +X, metres.
  const T = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE));
  const Tinv = T.clone().invert();

  // Bake every clip.
  const clips = {} as Record<HorseClip, ClipRows>;
  let rows = 0;
  for (const name of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === name);
    if (!clip) throw new Error(`missing clip ${name}`);
    const frames = Math.max(2, Math.min(48, Math.round(clip.duration * FPS)));
    clips[name] = { start: rows, frames, duration: clip.duration };
    rows += frames;
  }
  const data = new Float32Array(J * 3 * 4 * rows);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const M = new THREE.Matrix4();
  for (const name of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === name)!;
    const { start, frames } = clips[name];
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    const loop = name !== 'Death';
    for (let f = 0; f < frames; f++) {
      // Looping clips sample [0, duration); Death ends exactly on its last pose.
      mixer.setTime(loop ? (f / frames) * clip.duration : (f / (frames - 1)) * clip.duration);
      gltf.scene.updateMatrixWorld(true);
      for (let j = 0; j < J; j++) {
        // Same as three's skinning: bindInv * bone * boneInverse * bind, then into model space.
        M.multiplyMatrices(bones[j].matrixWorld, skeleton.boneInverses[j]).premultiply(bindInv).multiply(bindMatrix).premultiply(T);
        const e = M.elements, o = ((start + f) * J * 3 + j * 3) * 4;
        // Three rows of the affine matrix (column-major storage).
        data.set([e[0], e[4], e[8], e[12]], o);
        data.set([e[1], e[5], e[9], e[13]], o + 4);
        data.set([e[2], e[6], e[10], e[14]], o + 8);
      }
    }
    action.stop();
  }
  const bake = new THREE.DataTexture(data, J * 3, rows, THREE.RGBAFormat, THREE.FloatType);
  bake.minFilter = bake.magFilter = THREE.NearestFilter;
  bake.needsUpdate = true;

  // Horse geometry in bind space, one copy per coat.
  const role = (mat: string) => ({ Main: 0, Main_Dark: 1, Main_Light: 2, Hair: 3 } as Record<string, number>)[mat] ?? -1;
  const parts = meshes.map((m) => ({ geo: m.geometry, role: role((m.material as THREE.Material).name), color: (m.material as THREE.MeshStandardMaterial).color.clone() }));
  const horses = Array.from({ length: COATS }, (_, coat) => mergeGeometries(parts.map(({ geo, role: r, color }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position.clone());
    g.setAttribute('normal', geo.attributes.normal.clone());
    g.setAttribute('skinIndex', toFloat(geo.attributes.skinIndex as THREE.BufferAttribute));
    g.setAttribute('skinWeight', geo.attributes.skinWeight.clone());
    if (geo.index) g.setIndex(geo.index.clone());
    const c = r >= 0 ? new THREE.Color(COAT_SHADES[coat % COAT_SHADES.length][r]) : color;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), rig = new Float32Array(n * 4), rig2 = new Float32Array(n * 4), mat = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); mat.set([r === 3 ? 0.85 : 0.62, 0], i * 2); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
    g.setAttribute('aRig2', new THREE.BufferAttribute(rig2, 4));
    g.setAttribute('aMat', new THREE.BufferAttribute(mat, 2));
    return g.index ? g.toNonIndexed() : g;
  })));

  // The rider rides on the back bone: placed in model space at the bind pose, moved into
  // bind space (at the bind pose every skin matrix is the identity, so only T applies).
  const seat = new THREE.Vector3();
  bones[back].getWorldPosition(seat);
  seat.applyMatrix4(T);
  const riders: Record<string, THREE.BufferGeometry> = {};
  const riderFor = (team: Team) => {
    if (riders[team]) return riders[team];
    // The procedural rider sat at y 1.74 (saddle) and x -0.1; the back bone is under the saddle.
    let g = riderGeometry(team, seat.x + 0.1, seat.y + 0.2 - 1.74);
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(Tinv);
    const n = g.attributes.position.count;
    const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = back; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    riders[team] = g;
    return g;
  };
  void PAL;
  return {
    bake, clips,
    geometry: (team, coat) => mergeGeometries([horses[coat % COATS].clone(), riderFor(team).clone()]),
  };
}

function toFloat(a: THREE.BufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * 4);
  for (let i = 0; i < a.count; i++) out.set([a.getX(i), a.getY(i), a.getZ(i), a.getW(i)], i * 4);
  return new THREE.BufferAttribute(out, 4);
}

/** Bake rows for an instance: which two frames to blend, and how much. */
export function clipRows(c: ClipRows, t: number, loop = true): [number, number, number] {
  const p = loop ? ((t / c.duration) % 1 + 1) % 1 : Math.min(1, t / c.duration);
  const f = p * (loop ? c.frames : c.frames - 1);
  const i = Math.floor(f);
  const a = loop ? i % c.frames : Math.min(i, c.frames - 1);
  const b = loop ? (i + 1) % c.frames : Math.min(i + 1, c.frames - 1);
  return [c.start + a, c.start + b, f - i];
}
