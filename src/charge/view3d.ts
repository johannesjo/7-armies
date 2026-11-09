import * as THREE from 'three';
import type { Application } from 'pixi.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';
import { Theme } from '../theme';
import { Vec2 } from '../types';
import { attackDuration } from '../unit-art';
import { fbm } from '../ground';
import { CHARGE as C } from './config';
import { Battalion, ChargeSim, SimEvent, Soldier, Squadron, angleDiff, attackSide } from './sim';
import { PathPoint } from './path';
import { DirectZones } from './direct';
import {
  COATS, brokenShaftGeometry, bushGeometry, fallenStandardGeometry, fenceGeometry, rockGeometry, stuckArrowGeometry, haystackGeometry, houseGeometry, oakGeometry, pennantGeometry, pineGeometry,
  setModelDetail, standardGeometry, tentGeometry, unitGeometry,
} from './models3d';
import { paintDirtTile, paintMeadowTile, paintScorch } from './ground3d';
import { Quality, resolveQuality } from './quality3d';
import { HorseKit, clipRows, loadHorseKit } from './horse3d';

let horseKit: HorseKit | null = null;
/** Load the 3D assets before a battle (cached for the session). */
export async function preloadView3D(): Promise<void> {
  horseKit = await loadHorseKit();
}

/** What the charge mode needs from a battlefield renderer (2D or 3D). */
export interface ChargeRenderer {
  holdCamera: boolean;
  render(sim: ChargeSim, events: SimEvent[], dt: number): void;
  resize(w: number, h: number): void;
  focus(p: Vec2): void;
  worldToScreen(p: Vec2): Vec2;
  screenToWorld(p: Vec2): Vec2;
  drawRoute(points: PathPoint[], leader: Soldier | null, drawing: boolean): void;
  drawAim(leader: Soldier | null, aim: Vec2 | null, zones: DirectZones): void;
  setCombatText(on: boolean): void;
  readonly viewport: { x: number; y: number; w: number; h: number };
  destroy(): void;
}

/** World units to metres (a footman's radius of 5 is half a metre). */
const S = 0.1;
/** Camera tilt away from straight down (rad): a little of the figures' fronts shows. */
const TILT = 0.42;
const FOV = 30;
const MAX_DEAD = 520;
const MAX_DECALS = 1400;
const FIELD_W = C.WORLD_W * S, FIELD_H = C.WORLD_H * S;
/** The trampled-grass map: one texel per metre over the field. */
const TRAMPLE_W = Math.round(FIELD_W), TRAMPLE_H = Math.round(FIELD_H);
/** Lifts the painted meadow to a sunlit tone under this lighting (linear colour). */
const GROUND_GAIN = new THREE.Color().setRGB(1.45, 1.76, 2.9, THREE.LinearSRGBColorSpace);

/** Gentle, visual-only rolling ground (metres). The simulation stays flat. */
/** The river beyond the left edge of the field (metres). */
const RIVER_X = -12, RIVER_HALF = 4.5, WATER_Y = -0.35;
/** The river's centre line meanders gently. */
const riverX = (z: number) => RIVER_X + 3.2 * Math.sin(z * 0.035) + 1.2 * Math.sin(z * 0.09 + 1.7);
const smooth01 = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function heightAt(x: number, z: number): number {
  let h = 0.75 * Math.sin(x * 0.045 + 0.4) * Math.cos(z * 0.06) + 0.35 * Math.sin(x * 0.11 + 1.3) * Math.sin(z * 0.09 + 0.7);
  // Hills rise beyond the left, right and far edges (the farm side stays flat).
  const out = Math.max(-x, x - FIELD_W, -z, 0);
  if (out > 0) h += smooth01(3, 42, out) * (6 + 3 * Math.sin(x * 0.07) * Math.cos(z * 0.05) + 2 * Math.sin(x * 0.13 + z * 0.11));
  // The river cuts through beyond the left edge.
  const r = 1 - smooth01(RIVER_HALF, RIVER_HALF + 3.5, Math.abs(x - riverX(z)));
  if (r > 0) h = h * (1 - r) - 0.9 * r;
  return h;
}
const HEIGHT_GLSL = /* glsl */`
  float heightAt(vec2 p) { return 0.75 * sin(p.x * 0.045 + 0.4) * cos(p.y * 0.06) + 0.35 * sin(p.x * 0.11 + 1.3) * sin(p.y * 0.09 + 0.7); }
`;
const CLOUD_GLSL = /* glsl */`
  uniform float uTime;
  varying vec2 vCloudXZ;
  float cloudShade(vec2 p) {
    p = p * 0.008 + vec2(uTime * 0.006, uTime * 0.0035);
    float n = sin(p.x * 2.1 + sin(p.y * 1.7)) * 0.5 + sin(p.y * 2.7 + sin(p.x * 1.3 + 1.7)) * 0.5 + sin((p.x + p.y) * 4.3) * 0.25;
    return smoothstep(0.3, 0.95, n);
  }
`;

interface Fx { rig?: boolean; tint?: boolean; matAttr?: boolean; rim?: boolean; clouds?: boolean; wind?: boolean; skin?: boolean; flag?: boolean }

interface Kind {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  cap: number;
  count: number;
  dead: THREE.InstancedMesh;
  /** Every corpse's matrix (ring buffer); only those in view are copied to the mesh. */
  deadMats: Float32Array;
  deadNext: number;
  deadCount: number;
  cavalry: boolean;
  /** Animated horse: per-instance bake rows (rowA, rowB, blend). */
  bakeRows: THREE.InstancedBufferAttribute | null;
}

interface Dying {
  kind: number;
  slot: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; spin: number; roll: number;
  /** How fast the body tips over (rad/s): thrown men spin, men struck down topple. */
  rollRate: number;
  age: number;
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number;
  size: number; grow: number;
  r: number; g: number; b: number; a: number;
  gravity: number;
}

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/**
 * A blow with weight: wind-up, a fast strike, then recovery (rad, + raises the weapon).
 * Pikes and lances mostly thrust, so they barely turn.
 */
function attackAngle(type: string, since: number): number {
  const dur = attackDuration(type as Soldier['type']);
  if (since < 0 || since >= dur) return 0;
  const p = since / dur;
  const k = type === 'swordsman' || type === 'archer' ? 1 : 0.25;
  const a = p < 0.3 ? 0.55 * (p / 0.3)
    : p < 0.5 ? 0.55 - 1.95 * easeOut((p - 0.3) / 0.2)
    : -1.4 * (1 - (p - 0.5) / 0.5);
  return a * k;
}

/** A soft round texture (blob shadows, dust). */
function softDot(inner: string, outer: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

/**
 * Prototype 3D battlefield: real models lit by a low golden sun, a slightly tilted
 * top-down camera that keeps your leader dead centre, animated gaits and blows, bodies
 * flung through the air, trampled grass, dust and arrows. Two quality tiers: Low (phones:
 * low resolution, blob shadows, cheap materials) and High (soft shadows, ambient
 * occlusion, colour grade, cloud shadows, swaying grass). Resolution adapts to hold the
 * frame rate.
 */
export class ChargeView3D implements ChargeRenderer {
  holdCamera = false;
  private readonly quality: Quality;
  private readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private tiltH: ShaderPass | null = null;
  private tiltV: ShaderPass | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 1, 600);
  private readonly sun = new THREE.DirectionalLight(0xffd8a4, 2.85);
  private readonly uTime = { value: 0 };
  private readonly uRim = { value: new THREE.Color(0xfff2d8).multiplyScalar(0.18) };
  private readonly kinds: Kind[] = [];
  private readonly kindIndex = new Map<string, number>();
  private readonly soldierKind = new Map<number, number>();
  private readonly anim = new Map<number, { phase: number; px: number; py: number; clipT: number }>();
  private readonly dying: Dying[] = [];
  private readonly decals: THREE.InstancedMesh;
  private decalNext = 0;
  private decalCount = 0;
  private readonly litter: { arrows: THREE.InstancedMesh; shafts: THREE.InstancedMesh; arrowNext: number; shaftNext: number };
  private readonly fallenStandards: THREE.Mesh[] = [];
  private readonly scorches: THREE.InstancedMesh;
  private scorchNext = 0;
  private scorchCount = 0;
  private readonly arrows: THREE.InstancedMesh;
  private readonly streaks: THREE.InstancedMesh;
  private readonly blobs: THREE.InstancedMesh | null = null;
  private readonly telegraphs: THREE.Mesh[] = [];
  private readonly standards = new Map<number, THREE.Mesh>();
  private readonly pennants = new Map<number, THREE.Mesh>();
  private readonly standardGeo: Record<'blue' | 'red', THREE.BufferGeometry>;
  private readonly pennantGeo: Record<'blue' | 'red', THREE.BufferGeometry>;
  private readonly fallenGeo: Record<'blue' | 'red', THREE.BufferGeometry> = { blue: fallenStandardGeometry('blue'), red: fallenStandardGeometry('red') };
  private readonly plainMat: THREE.Material;
  private readonly flagMat: THREE.Material;
  private readonly leaderRing: THREE.Mesh;
  private readonly generalRing: THREE.Mesh;
  private readonly exposeEdge: THREE.Mesh;
  private readonly exposeArc: THREE.Mesh;
  private readonly aimRing: THREE.Mesh;
  private readonly route: THREE.Line;
  private readonly particles: Particle[] = [];
  private readonly maxParticles: number;
  private readonly points: THREE.Points;
  private readonly trample = new Uint8Array(TRAMPLE_W * TRAMPLE_H);
  private readonly trampleTex: THREE.DataTexture;
  private trampleDirty = false;
  private trampleTimer = 0;
  private readonly fpsEl: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly prevPixiDisplay: string;
  private viewW = 800;
  private viewH = 450;
  private zoom = 2;
  private target = new THREE.Vector3();
  /** What the camera sees, in metres, with a margin (for culling soldiers and corpses). */
  private readonly bounds = { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 };
  private trailTimer = 0;
  private fpsTime = 0;
  private fpsFrames = 0;
  // Adaptive resolution.
  private resScale: number;
  private readonly maxScale: number;
  private readonly minScale = 0.55;
  private frameMs = 16;
  private lastNow = 0;
  private resTimer = 0;
  private readonly autoRes: boolean;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(1, 0, 0);
  private readonly side = new THREE.Vector3(0, 0, 1);
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();

  constructor(private readonly app: Application, theme: Theme, private readonly host: HTMLElement) {
    void theme;
    this.quality = resolveQuality();
    const high = this.quality === 'high';
    setModelDetail(this.quality);
    const dpr = window.devicePixelRatio || 1;
    this.maxScale = high ? Math.min(1.5, dpr) : Math.min(1, dpr);
    this.resScale = this.maxScale;
    this.autoRes = !(import.meta.env.DEV && (window as { chargeFixedRes?: boolean }).chargeFixedRes);
    this.renderer = new THREE.WebGLRenderer({
      antialias: high && dpr < 1.5, powerPreference: 'high-performance',
      preserveDrawingBuffer: import.meta.env.DEV, // lets dev recordings read the canvas
    });
    this.renderer.setPixelRatio(this.resScale);
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping; // colours are graded by hand (High) or as painted (Low)
    const cv = this.renderer.domElement;
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    // Under the HUD; input passes through to the controls on the host. Pixi draws nothing
    // in 3D: its canvas is hidden and its render loop stopped.
    host.appendChild(cv);
    this.prevPixiDisplay = app.canvas.style.display;
    app.canvas.style.display = 'none';
    app.ticker.remove(app.render, app);

    this.vignette = document.createElement('div');
    Object.assign(this.vignette.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none',
      background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(20,14,6,0.32) 100%)',
    });
    host.appendChild(this.vignette);

    this.scene.background = new THREE.Color(0x26341c);
    this.scene.fog = new THREE.Fog(0xb2ae8c, 100, 290);
    // Cool sky fill and a low, golden sun: long shadows, warm light, warm haze far off.
    this.scene.add(new THREE.HemisphereLight(0xd4e0ff, 0x5e5a3c, 1.2));
    this.sun.castShadow = high;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.trampleTex = new THREE.DataTexture(this.trample, TRAMPLE_W, TRAMPLE_H, THREE.RedFormat, THREE.UnsignedByteType);
    this.trampleTex.magFilter = THREE.LinearFilter;
    this.trampleTex.minFilter = THREE.LinearFilter;
    this.trampleTex.needsUpdate = true;

    this.plainMat = this.unitMaterial({ clouds: high });
    this.flagMat = this.unitMaterial({ clouds: high, flag: true });
    this.buildGround();
    this.buildScenery();
    this.buildUnits();
    this.standardGeo = { blue: standardGeometry('blue'), red: standardGeometry('red') };
    this.pennantGeo = { blue: pennantGeometry('blue'), red: pennantGeometry('red') };

    this.decals = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4a0c08, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.scene.add(this.decals);

    const nArrows = high ? 1600 : 600;
    this.litter = {
      arrows: new THREE.InstancedMesh(stuckArrowGeometry(), this.plainMat, nArrows),
      shafts: new THREE.InstancedMesh(brokenShaftGeometry(), this.plainMat, 300),
      arrowNext: 0, shaftNext: 0,
    };
    for (const m of [this.litter.arrows, this.litter.shafts]) { m.count = 0; m.frustumCulled = false; m.castShadow = high; this.scene.add(m); }
    const scorchTex = new THREE.CanvasTexture(paintScorch());
    scorchTex.colorSpace = THREE.SRGBColorSpace;
    this.scorches = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, toneMapped: false }), 600);
    this.scorches.count = 0;
    this.scorches.frustumCulled = false;
    this.scene.add(this.scorches);

    this.arrows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.035, 0.035), new THREE.MeshLambertMaterial({ color: 0xe8e0cc }), 900);
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.02, 0.02).translate(-1.2, 0, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }), 900);
    for (const m of [this.arrows, this.streaks]) { m.count = 0; m.frustumCulled = false; this.scene.add(m); }
    this.arrows.castShadow = high;

    if (!high) {
      // Phones: soft dark patches under every figure instead of a shadow map.
      this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: softDot('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), 1400);
      this.blobs.count = 0;
      this.blobs.frustumCulled = false;
      this.blobs.renderOrder = 1;
      this.scene.add(this.blobs);
    }

    const flat = (geo: THREE.BufferGeometry, color: number, opacity: number) => {
      const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    };
    this.leaderRing = flat(new THREE.RingGeometry(1.0, 1.18, 40), 0x4a8cff, 0.85);
    this.generalRing = flat(new THREE.RingGeometry(1.2, 1.38, 40), 0xe6b03a, 0.85);
    this.exposeEdge = flat(new THREE.PlaneGeometry(1, 0.32), 0xe6b03a, 0.85);
    this.exposeArc = flat(new THREE.RingGeometry(0.92, 1, 24, 1, -0.7, 1.4), 0xe6b03a, 0.85);
    this.aimRing = flat(new THREE.RingGeometry(0.5, 0.65, 28), 0xffffff, 0.75);
    this.route = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.route.frustumCulled = false;
    this.scene.add(this.route);
    for (let i = 0; i < 10; i++) {
      const t = flat(new THREE.CircleGeometry(1, 36), 0xd8402e, 0.15);
      t.visible = false;
      this.telegraphs.push(t);
    }

    this.maxParticles = high ? 1800 : 500;
    this.points = this.buildParticles();
    if (high) this.buildComposer();

    this.fpsEl = document.createElement('div');
    Object.assign(this.fpsEl.style, {
      position: 'absolute', left: '12px', top: 'calc(118px + env(safe-area-inset-top, 0px))',
      font: '11px ui-monospace, monospace', color: '#f4f0e0', background: 'rgba(0,0,0,0.35)', padding: '2px 6px', borderRadius: '4px', pointerEvents: 'none',
    });
    host.appendChild(this.fpsEl);
  }

  destroy(): void {
    this.renderer.domElement.remove();
    this.fpsEl.remove();
    this.vignette.remove();
    this.app.canvas.style.display = this.prevPixiDisplay;
    this.app.ticker.add(this.app.render, this.app, -25); // Pixi's own render loop (UPDATE_PRIORITY.LOW)
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    this.trampleTex.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }

  setCombatText(on: boolean): void { void on; }

  /** Tilt-shift strength scales with the screen (in texels). */
  private updateTilt(): void {
    if (!this.tiltH || !this.tiltV) return;
    this.tiltH.uniforms.h.value = 1.4 / Math.max(1, this.viewW);
    this.tiltV.uniforms.v.value = 1.4 / Math.max(1, this.viewH);
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.updateTilt();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value =
      h * this.resScale / (2 * Math.tan((FOV * Math.PI) / 360));
  }

  focus(p: Vec2): void {
    this.setTarget(p.x * S, p.y * S);
    this.zoom = this.baseZoom();
    this.placeCamera();
  }

  worldToScreen(p: Vec2): Vec2 {
    const x = p.x * S, z = p.y * S;
    const v = this.tmpP.set(x, heightAt(x, z), z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.viewW, y: (1 - v.y) / 2 * this.viewH };
  }

  /** Where a screen point meets the rolling ground (refined against the height field). */
  screenToWorld(p: Vec2): Vec2 {
    this.ndc.set((p.x / this.viewW) * 2 - 1, 1 - (p.y / this.viewH) * 2);
    this.ray.setFromCamera(this.ndc, this.camera);
    let h = this.target.y;
    let hit: THREE.Vector3 | null = null;
    for (let i = 0; i < 3; i++) {
      this.plane.constant = -h;
      hit = this.ray.ray.intersectPlane(this.plane, this.tmpP);
      if (!hit) break;
      h = heightAt(hit.x, hit.z);
    }
    return hit ? { x: hit.x / S, y: hit.z / S } : { x: this.target.x / S, y: this.target.z / S };
  }

  get viewport(): { x: number; y: number; w: number; h: number } {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [this.viewW, 0], [0, this.viewH], [this.viewW, this.viewH]]) {
      const w = this.screenToWorld({ x: sx, y: sy });
      x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x); y1 = Math.max(y1, w.y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  drawRoute(points: PathPoint[], leader: Soldier | null, drawing: boolean): void {
    void drawing;
    const pts: number[] = [];
    const push = (x: number, y: number) => { const mx = x * S, mz = y * S; pts.push(mx, heightAt(mx, mz) + 0.08, mz); };
    if (leader && points.length) push(leader.x, leader.y);
    for (const p of points) push(p.x, p.y);
    this.route.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.route.visible = pts.length >= 6;
  }

  drawAim(leader: Soldier | null, aim: Vec2 | null, zones: DirectZones): void {
    void zones;
    this.aimRing.visible = !!(leader && aim);
    if (aim) this.onGround(this.aimRing, aim.x * S, aim.y * S, 0.06);
  }

  // --- Frame -------------------------------------------------------------------------------

  render(sim: ChargeSim, events: SimEvent[], dt: number): void {
    this.uTime.value += dt;
    this.updateCamera(sim, dt);
    this.updateBounds();
    this.handleEvents(events);
    this.syncUnits(sim, dt);
    this.updateDying(dt);
    this.updateArrows(sim);
    this.updateTelegraphs(sim);
    this.updateStandards(sim);
    this.updateMarkers(sim);
    this.updateTrample(sim, dt);
    this.spawnTrail(sim, dt);
    this.updateParticles(dt);
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.meterFrame(dt);
  }

  /** Frame-rate readout, and adaptive resolution that trades sharpness for smoothness. */
  private meterFrame(dt: number): void {
    const now = performance.now();
    if (this.lastNow) this.frameMs = this.frameMs * 0.9 + Math.min(100, now - this.lastNow) * 0.1;
    this.lastNow = now;
    this.resTimer += dt;
    if (this.autoRes && this.resTimer > 1) {
      this.resTimer = 0;
      let next = this.resScale;
      if (this.frameMs > 21 && next > this.minScale) next = Math.max(this.minScale, next - 0.1);
      else if (this.frameMs < 14 && next < this.maxScale) next = Math.min(this.maxScale, next + 0.05);
      if (next !== this.resScale) {
        this.resScale = next;
        this.renderer.setPixelRatio(next);
        this.composer?.setPixelRatio(next);
        this.resize(this.viewW, this.viewH);
      }
    }
    this.fpsTime += dt;
    this.fpsFrames++;
    if (this.fpsTime < 0.5) return;
    const info = this.renderer.info.render;
    this.fpsEl.textContent = `3D ${this.quality} · ${Math.round(this.fpsFrames / this.fpsTime)} fps · ${Math.round(this.resScale * 100)}% res · ${(info.triangles / 1000).toFixed(0)}k tris`;
    this.fpsTime = 0;
    this.fpsFrames = 0;
  }

  private baseZoom(): number {
    const long = Math.max(this.viewW, this.viewH), short = Math.min(this.viewW, this.viewH);
    let zoom = long / 740;
    if (short < 600) zoom = Math.max(zoom, short / C.PHONE_VIEW_SPAN);
    const devZoom = import.meta.env.DEV ? (window as { chargeZoom?: number }).chargeZoom ?? 1 : 1;
    return Math.max(0.8, Math.min(3, zoom)) * devZoom;
  }

  private setTarget(x: number, z: number): void {
    this.target.set(x, heightAt(x, z), z);
  }

  /** Put the camera above the target so the same width of field shows as in 2D. */
  private placeCamera(): void {
    const visW = (this.viewW / this.zoom) * S;
    const hfov = 2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * this.camera.aspect);
    const dist = (visW / 2) / Math.tan(hfov / 2);
    this.camera.position.set(this.target.x, this.target.y + Math.cos(TILT) * dist, this.target.z + Math.sin(TILT) * dist);
    this.camera.lookAt(this.target);
    // The sun's shadow box follows the action; snapped to shadow texels so edges don't crawl.
    const box = Math.min(90, visW * 0.9);
    const texel = (box * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(this.target.x / texel) * texel, sz = Math.round(this.target.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx - 38, 40, sz + 14);
    const cam = this.sun.shadow.camera;
    if (cam.right !== box) {
      Object.assign(cam, { left: -box, right: box, top: box, bottom: -box, near: 1, far: 170 });
      cam.updateProjectionMatrix();
    }
  }

  private updateCamera(sim: ChargeSim, dt: number): void {
    const L = sim.leader;
    let targetZoom = this.baseZoom();
    if (L) {
      // The leader is always exactly in the centre of the screen.
      this.setTarget(L.x * S, L.y * S);
      const k = Math.min(1, L.speed / C.GALLOP_SPEED);
      targetZoom = this.holdCamera ? this.zoom : targetZoom * (1 - 0.08 * k);
    }
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-2 * dt));
    this.placeCamera();
  }

  private updateBounds(): void {
    const v = this.viewport, m = 6; // margin: men just off screen still cast shadows into it
    this.bounds.x0 = v.x * S - m; this.bounds.x1 = (v.x + v.w) * S + m;
    this.bounds.z0 = v.y * S - m; this.bounds.z1 = (v.y + v.h) * S + m;
  }

  // --- Materials ---------------------------------------------------------------------------

  /**
   * Shader additions shared by units and scenery: the gait/attack rig, per-soldier cloth
   * tint, per-part roughness/metalness, rim light, drifting cloud shadows, wind in leaves.
   */
  private customize<M extends THREE.Material>(mat: M, fx: Fx): M {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.uniforms.uRim = this.uRim;
      let vHead = '', fHead = 'uniform vec3 uRim;\n';
      let begin = 'vec3 transformed = vec3(position);\n';
      if (fx.rig) {
        vHead += 'attribute vec4 aRig;\nattribute vec4 aRig2;\nattribute vec4 aAnim;\n';
        vHead += 'vec2 rot2(vec2 p, vec2 c, float a) { p -= c; float cs = cos(a), sn = sin(a); return vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs) + c; }\n';
        begin += `
          int rk = int(aRig.w + 0.5);
          float ph = aAnim.x + aRig.z;
          if (rk == 1) transformed.xy = rot2(transformed.xy, aRig.xy, sin(ph) * aAnim.y);
          else if (rk == 2) transformed.xy = rot2(transformed.xy, aRig.xy, aAnim.z);
          else if (rk == 3) {
            transformed.xy = rot2(transformed.xy, aRig2.xy, -max(0.0, sin(ph - 1.1)) * aAnim.y * 1.7);
            transformed.xy = rot2(transformed.xy, aRig.xy, sin(ph) * aAnim.y);
          }
          else if (rk == 4) transformed.xy = rot2(transformed.xy, aRig.xy, sin(ph * 2.0) * 0.22 + aAnim.y * 0.6);
          else if (rk == 5) transformed.y += sin(ph * 2.0) * 0.05 * aAnim.y;
          else if (rk == 6) transformed.xy = rot2(transformed.xy, aRig.xy, sin(ph * 2.0) * 0.16 * aAnim.y);
        `;
      }
      if (fx.skin) {
        vHead += `attribute vec4 skinIndex; attribute vec4 skinWeight; attribute vec3 aBake; uniform sampler2D uBake;
          mat4 bakeBone(float j, float row) {
            ivec2 c = ivec2(int(j + 0.5) * 3, int(row + 0.5));
            vec4 a = texelFetch(uBake, c, 0), b = texelFetch(uBake, c + ivec2(1, 0), 0), d = texelFetch(uBake, c + ivec2(2, 0), 0);
            return mat4(a.x, b.x, d.x, 0.0, a.y, b.y, d.y, 0.0, a.z, b.z, d.z, 0.0, a.w, b.w, d.w, 1.0);
          }
          mat4 bakeAt(float row) {
            return skinWeight.x * bakeBone(skinIndex.x, row) + skinWeight.y * bakeBone(skinIndex.y, row)
              + skinWeight.z * bakeBone(skinIndex.z, row) + skinWeight.w * bakeBone(skinIndex.w, row);
          }
          mat4 bakeSkin() { return bakeAt(aBake.x) * (1.0 - aBake.z) + bakeAt(aBake.y) * aBake.z; }
        `;
        begin += 'transformed = (bakeSkin() * vec4(transformed, 1.0)).xyz;\n';
      }
      if (fx.tint) {
        vHead += 'varying float vTint;\nvarying float vTeam;\n';
        fHead += 'varying float vTint;\nvarying float vTeam;\n';
        begin += 'vTint = aRig2.z > 0.5 ? 0.93 + aAnim.w * 0.14 : 1.0;\nvTeam = aRig2.w;\n';
      }
      if (fx.matAttr) {
        vHead += 'attribute vec2 aMat;\nvarying vec2 vMat;\n';
        fHead += 'varying vec2 vMat;\n';
        begin += 'vMat = aMat;\n';
      }
      if (fx.wind) {
        vHead += 'uniform float uTime;\n';
        begin += `
          float wy = max(0.0, transformed.y - 1.6);
          vec4 wb = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            wb = instanceMatrix * wb;
          #endif
          transformed.x += sin(uTime * 1.3 + wb.x * 0.3 + wb.z * 0.2) * wy * 0.03;
          transformed.z += cos(uTime * 1.1 + wb.x * 0.2 + wb.z * 0.35) * wy * 0.025;
        `;
      }
      if (fx.flag) {
        if (!fx.wind) vHead += 'uniform float uTime;\n';
        // Cloth on standards and pennants waves, more toward its free end.
        begin += `
          if (transformed.y > 2.9 && abs(transformed.x) > 0.04) {
            float fx0 = abs(transformed.x);
            float ph = uTime * 6.5 - fx0 * 4.5 + modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.3;
            transformed.z += sin(ph) * 0.11 * fx0 + sin(ph * 1.7 + 1.3) * 0.03 * fx0;
            transformed.y += sin(ph + 1.1) * 0.025 * fx0;
          }
        `;
      }
      if (fx.clouds) {
        if (!fx.wind && !fx.flag) vHead += 'uniform float uTime;\n';
        vHead += 'varying vec2 vCloudXZ;\n';
        fHead += CLOUD_GLSL;
        begin += `
          vec4 cw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
          #endif
          vCloudXZ = (modelMatrix * cw).xz;
        `;
      }
      if (fx.skin) sh.uniforms.uBake = { value: horseKit?.bake ?? null };
      let vs = sh.vertexShader.replace('#include <begin_vertex>', begin);
      if (fx.skin) vs = vs.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = mat3(bakeSkin()) * vec3(normal);');
      sh.vertexShader = vHead + vs;
      let frag = fHead + sh.fragmentShader;
      let after = '';
      if (fx.tint) after += 'diffuseColor.rgb *= vTint;\n';
      if (fx.clouds) after += 'diffuseColor.rgb *= 1.0 - 0.2 * cloudShade(vCloudXZ);\n';
      if (after) frag = frag.replace('#include <color_fragment>', '#include <color_fragment>\n' + after);
      if (fx.matAttr) {
        frag = frag.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMat.x;')
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.y;');
      }
      if (fx.tint) {
        // Team colour glows a little on its own, so it stays vivid in shadow and dust.
        frag = frag.replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * vTeam * 0.32;\n#include <opaque_fragment>');
      }
      if (fx.rim) {
        frag = frag.replace('#include <opaque_fragment>',
          'outgoingLight += uRim * pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);\n#include <opaque_fragment>');
      }
      sh.fragmentShader = frag;
    };
    mat.customProgramCacheKey = () => JSON.stringify(fx);
    return mat;
  }

  /** Lit material for units and props: physically based on High, cheap Lambert on Low. */
  private unitMaterial(fx: Fx, dim = 1): THREE.Material {
    const color = new THREE.Color(dim, dim, dim);
    if (this.quality === 'high') {
      return this.customize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, color }), { ...fx, matAttr: fx.rig });
    }
    color.multiplyScalar(0.88); // no colour grade on Low: keep figures from looking washed out
    return this.customize(new THREE.MeshLambertMaterial({ vertexColors: true, color }), { ...fx, clouds: false });
  }

  // --- Static world ------------------------------------------------------------------------

  private earthAt(x: number, z: number): number {
    const cx = FIELD_W / 2, fy = C.FRONT_Y * S;
    const xf = Math.max(0, 1 - Math.max(0, Math.abs(x - cx) - 40) / 16);
    const front = Math.max(0, 1 - Math.abs(z - fy) / 8) * xf;
    let camp = 0;
    for (const c of C.CAMPS) camp = Math.max(camp, 1 - Math.hypot(x - c.x * S, z - c.y * S) / (C.CAMP_R * S * 1.1));
    return Math.max(front, camp);
  }

  private tile(cv: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }


  private buildGround(): void {
    const W = FIELD_W, H = FIELD_H, pad = 40;
    const geo = new THREE.PlaneGeometry(W + pad * 2, H + pad * 2, Math.round((W + pad * 2) / 2), Math.round((H + pad * 2) / 2));
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, H / 2);
    const n1 = fbm(11, 4), n2 = fbm(23, 3), n3 = fbm(41, 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const tint: number[] = [], dirt: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
      const a = n1(x * 0.03, z * 0.03), b = n2(x * 0.12, z * 0.12), p = n3(x * 0.22, z * 0.22);
      // Broad and patch-sized variation in tone and warmth: the tiling never shows.
      // Big lighter/darker patches, and warmer (yellower) ones here and there.
      const k = (0.86 + a * 0.22) * (0.88 + p * 0.24);
      let r = k * (0.94 + b * 0.14), g = k, bl = k * (0.94 + (1 - b) * 0.08);
      const out = Math.min(1, Math.max(0, Math.max(-x, x - W, -z, z - H)) / 6);
      r *= 1 - out * 0.55; g *= 1 - out * 0.45; bl *= 1 - out * 0.55;
      tint.push(r, g, bl);
      // Worn ground, plus muddy banks along the river.
      const bank = 1 - smooth01(RIVER_HALF + 1, RIVER_HALF + 4.5, Math.abs(x - riverX(z)));
      dirt.push(Math.min(1, Math.max(bank * 0.85, (this.earthAt(x, z) * (0.6 + b * 0.8) - 0.12) * 1.8)));
      uv.setXY(i, x / 8, z / 8);
    }
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
    geo.setAttribute('aDirt', new THREE.Float32BufferAttribute(dirt, 1));
    const meadow = this.tile(paintMeadowTile());
    const earth = this.tile(paintDirtTile());
    // Not tone-mapped: the colours were matched by hand to a sunlit meadow.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: meadow, toneMapped: false, color: GROUND_GAIN });
    const clouds = true; // cheap, and they carry much of the field's depth
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDirt = { value: earth };
      sh.uniforms.uTrample = { value: this.trampleTex };
      sh.uniforms.uWorld = { value: new THREE.Vector2(W, H) };
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = 'attribute float aDirt;\nvarying float vDirt;\nvarying vec2 vWXZ;\n' + (clouds ? 'varying vec2 vCloudXZ;\n' : '') +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDirt = aDirt;\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\n' + (clouds ? 'vCloudXZ = vWXZ;\n' : ''));
      sh.fragmentShader = 'uniform sampler2D uDirt;\nuniform sampler2D uTrample;\nuniform vec2 uWorld;\nvarying float vDirt;\nvarying vec2 vWXZ;\n' + (clouds ? CLOUD_GLSL : '') +
        sh.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            // The meadow mixed with a rotated, rescaled copy of itself: no visible repeat.
            vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.43 + vec2(0.31, 0.17);
            vec4 gC = mix(texture2D(map, vMapUv), texture2D(map, uv2), 0.45);
            vec4 dC = texture2D(uDirt, vMapUv * 1.4);
            // Worn ground, plus the paths trampled during the battle.
            float tr = texture2D(uTrample, vWXZ / uWorld).r;
            float worn = smoothstep(0.0, 1.0, max(vDirt, tr * 0.9));
            diffuseColor *= mix(gC, dC * vec4(0.95, 0.9, 0.85, 1.0), worn);
          #endif
        `) .replace('#include <color_fragment>', '#include <color_fragment>\n' + (clouds ? 'diffuseColor.rgb *= 1.0 - 0.26 * cloudShade(vCloudXZ);\n' : ''));
    };
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = this.quality === 'high';
    this.scene.add(ground);
  }

  private scatter(geo: THREE.BufferGeometry, items: { x: number; z: number; s: number; r: number }[], mat: THREE.Material, shadow = true): void {
    if (!items.length) return;
    // One instanced mesh per 40 m tile, so the renderer skips tiles that are off screen.
    const tiles = new Map<string, typeof items>();
    for (const t of items) {
      const key = `${Math.floor(t.x / 40)}:${Math.floor(t.z / 40)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key)!.push(t);
    }
    for (const list of tiles.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        this.tmpQ.setFromAxisAngle(this.up, t.r);
        mesh.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(t.x, heightAt(t.x, t.z), t.z), this.tmpQ, this.tmpS.setScalar(t.s)));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = shadow && this.quality === 'high';
      mesh.receiveShadow = this.quality === 'high';
      this.scene.add(mesh);
    }
    this.tmpS.setScalar(1);
  }

  private buildScenery(): void {
    const W = FIELD_W, H = FIELD_H;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    type It = { x: number; z: number; s: number; r: number };
    const farm = (x: number, z: number) => z > H && z < H + 26 && x > 20 && x < W - 20;
    // Forest round the field, leaving room for a farm below our camps.
    const river = (x: number, z = 0) => Math.abs(x - riverX(z)) < RIVER_HALF + 3.5;
    const oaks: It[][] = [[], [], [], []], pines: It[] = [], under: It[][] = [[], [], []], rocks: It[][] = [[], [], []];
    for (let i = 0; i < 1100; i++) {
      const sideN = Math.floor(rnd() * 4), along = rnd(), depth = 3 + rnd() * 34;
      const x = sideN % 2 === 0 ? along * (W + 70) - 35 : sideN === 1 ? W + depth : -depth;
      const z = sideN % 2 === 1 ? along * (H + 70) - 35 : sideN === 0 ? -depth : H + depth;
      if (farm(x, z) || river(x, z)) continue;
      const t = { x, z, s: 0.85 + rnd() * 0.55, r: rnd() * 6.28 };
      const p = rnd();
      if (p < 0.5) oaks[Math.floor(rnd() * 3)].push(t); else if (p < 0.66) oaks[3].push(t); else pines.push(t);
    }
    // Undergrowth along the forest edge, and boulders out on the hills.
    for (let i = 0; i < 700; i++) {
      const sideN = Math.floor(rnd() * 4), along = rnd(), depth = 1 + rnd() * 7;
      const x = sideN % 2 === 0 ? along * (W + 20) - 10 : sideN === 1 ? W + depth : -depth;
      const z = sideN % 2 === 1 ? along * (H + 20) - 10 : sideN === 0 ? -depth : H + depth;
      if (farm(x, z) || river(x, z)) continue;
      under[Math.floor(rnd() * 3)].push({ x, z, s: 0.6 + rnd() * 0.8, r: rnd() * 6.28 });
    }
    for (let i = 0; i < 260; i++) {
      const sideN = Math.floor(rnd() * 3), along = rnd(), depth = 6 + rnd() * 34;
      const x = sideN === 0 ? along * (W + 70) - 35 : sideN === 1 ? W + depth : -depth;
      const z = sideN === 0 ? -depth : along * (H + 30) - 15;
      if (river(x, z)) continue;
      const big = rnd() < 0.3;
      rocks[Math.floor(rnd() * 3)].push({ x, z, s: big ? 1.6 + rnd() * 2.2 : 0.5 + rnd() * 0.9, r: rnd() * 6.28 });
    }
    const trees = this.unitMaterial({ wind: true, clouds: this.quality === 'high' });
    oaks.forEach((list, v) => this.scatter(oakGeometry(v), list, trees));
    this.scatter(pineGeometry(), pines, trees);
    under.forEach((list, v) => this.scatter(bushGeometry(v + 3), list, trees));
    const stone = this.unitMaterial({ clouds: this.quality === 'high' });
    rocks.forEach((list, v) => this.scatter(rockGeometry(v), list, stone));
    this.buildRiver();
    // Low dark shrubs dotted about the open field (the fighting rolls over them).
    const bushes: It[][] = [[], [], []];
    for (let i = 0; i < 170; i++) {
      const x = 4 + rnd() * (W - 8), z = 4 + rnd() * (H - 8);
      if (this.earthAt(x, z) > 0.05) continue;
      bushes[Math.floor(rnd() * 3)].push({ x, z, s: 0.45 + rnd() * 0.5, r: rnd() * 6.28 });
    }
    bushes.forEach((list, v) => this.scatter(bushGeometry(v), list, trees));
    // Stones in the open field.
    const stones: It[] = [];
    for (let i = 0; i < 160; i++) stones.push({ x: rnd() * W, z: rnd() * H, s: 0.3 + rnd() * 0.5, r: rnd() * 6.28 });
    this.scatter(new THREE.IcosahedronGeometry(0.5, 0).scale(1.3, 0.6, 1), stones, new THREE.MeshLambertMaterial({ color: 0x8a867a, flatShading: true }));
    // Camps: blue tents round each rally ring, red tents along the far edge.
    const blueTents: It[] = [], redTents: It[] = [];
    for (const c of C.CAMPS) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3, r = (C.CAMP_R + 26) * S;
        blueTents.push({ x: c.x * S + Math.cos(a) * r, z: c.y * S + Math.sin(a) * r, s: 1, r: a });
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(C.CAMP_R * S - 0.25, C.CAMP_R * S, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x4a8cff, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      this.onGround(ring, c.x * S, c.y * S, 0.1);
      this.scene.add(ring);
    }
    for (let i = 0; i < 9; i++) redTents.push({ x: W / 2 + (i - 4) * 7, z: 7 + rnd() * 4, s: 1, r: rnd() * 6.28 });
    this.scatter(tentGeometry('blue'), blueTents, this.plainMat);
    this.scatter(tentGeometry('red'), redTents, this.plainMat);
    // A farm below the field: ploughed and ripening strips, fences, farmhouses, haystacks.
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d')!;
    const strips = [['#7a5a36', '#5c4228'], ['#c4a85c', '#a68c46'], ['#7a8a44', '#627436']];
    const fieldMats = strips.map(([a, b]) => {
      ctx.fillStyle = a; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = b;
      for (let y = 0; y < 64; y += 8) ctx.fillRect(0, y, 64, 3);
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.repeat.set(4, 4);
      const m = new THREE.MeshLambertMaterial({ map: t.clone(), toneMapped: false });
      (m.map as THREE.Texture).needsUpdate = true;
      return m;
    });
    const fences: It[] = [], houses: It[] = [], hay: It[] = [];
    for (let i = 0; i < 6; i++) {
      const fx = 34 + i * 30, fz = H + 6 + (i % 2) * 7, fw = 24, fd = 10;
      const geo = new THREE.PlaneGeometry(fw, fd, 12, 5).rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      for (let k = 0; k < p.count; k++) p.setY(k, heightAt(fx + p.getX(k), fz + p.getZ(k)) + 0.03);
      const field = new THREE.Mesh(geo, fieldMats[i % 3]);
      field.position.set(fx, 0, fz);
      field.receiveShadow = this.quality === 'high';
      this.scene.add(field);
      for (let k = 0; k < 6; k++) fences.push({ x: fx - fw / 2 + 2 + k * 4, z: fz - fd / 2 - 0.6, s: 1, r: 0 });
      if (i % 2 === 0) houses.push({ x: fx + 4, z: fz + fd / 2 + 5, s: 1, r: rnd() * 0.5 - 0.25 });
      for (let k = 0; k < 2; k++) hay.push({ x: fx - 6 + k * 9 + rnd() * 2, z: fz + rnd() * 3, s: 0.8 + rnd() * 0.4, r: rnd() * 6 });
    }
    this.scatter(fenceGeometry(), fences, this.plainMat);
    this.scatter(houseGeometry(), houses, this.plainMat);
    this.scatter(haystackGeometry(), hay, this.plainMat);
  }

  /** The river: a calm, moving surface following the meander, deeper and darker mid-stream. */
  private buildRiver(): void {
    const len = FIELD_H + 90, wide = RIVER_HALF * 2 + 7;
    const geo = new THREE.PlaneGeometry(wide, len, 6, 90).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) + FIELD_H / 2;
      p.setX(i, p.getX(i) + riverX(z));
    }
    const mat = new THREE.MeshPhongMaterial({ color: 0x2c5658, specular: 0x5a6a60, shininess: 45, transparent: true, opacity: 0.92, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vWPos;\n' + sh.fragmentShader
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 q = vWPos.xz;
          float t = uTime;
          vec2 rip = vec2(
            sin(q.y * 1.3 - t * 1.6 + sin(q.x * 1.9)) * 0.5 + sin(q.y * 3.1 + q.x * 1.1 - t * 2.3) * 0.2,
            cos(q.x * 1.7 + t * 0.9 + sin(q.y * 1.5)) * 0.5 + cos(q.y * 2.6 - t * 2.0) * 0.2);
          normal = normalize(normal + (viewMatrix * vec4(rip.x * 0.07, 0.0, rip.y * 0.07, 0.0)).xyz);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float cx = ${RIVER_X.toFixed(1)} + 3.2 * sin(vWPos.z * 0.035) + 1.2 * sin(vWPos.z * 0.09 + 1.7);
          float mid = 1.0 - smoothstep(0.0, ${(RIVER_HALF + 1.5).toFixed(1)}, abs(vWPos.x - cx));
          diffuseColor.rgb = mix(vec3(0.07, 0.11, 0.07), diffuseColor.rgb, mid);`);
    };
    const water = new THREE.Mesh(geo, mat);
    water.position.set(0, WATER_Y, FIELD_H / 2);
    water.renderOrder = 1;
    this.scene.add(water);
  }

  /** Lay a flat marker on the rolling ground. */
  private onGround(m: THREE.Object3D, x: number, z: number, lift: number): void {
    m.position.set(x, heightAt(x, z) + lift, z);
  }

  // --- Units -------------------------------------------------------------------------------

  private kindOf(s: Soldier): number {
    let k = this.soldierKind.get(s.id);
    if (k === undefined) {
      k = this.kindIndex.get(s.type === 'cavalry' ? `cavalry:${s.team}:${s.id % COATS}` : `${s.type}:${s.team}`) ?? -1;
      this.soldierKind.set(s.id, k);
    }
    return k;
  }

  private buildUnits(): void {
    const high = this.quality === 'high';
    const mat = this.unitMaterial({ rig: true, tint: true, rim: true, clouds: high });
    const deadMat = this.unitMaterial({ rig: true, tint: true }, 0.72);
    const depth = high ? this.customize(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { rig: true }) : undefined;
    const skinMat = this.unitMaterial({ rig: true, tint: true, rim: true, clouds: high, skin: true });
    const skinDeadMat = this.unitMaterial({ rig: true, tint: true, skin: true }, 0.72);
    const skinDepth = high ? this.customize(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { rig: true, skin: true }) : undefined;
    const kit = horseKit;
    const add = (key: string, geo: THREE.BufferGeometry, cap: number, cavalry: boolean) => {
      const skinned = cavalry && !!kit;
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      let bakeRows: THREE.InstancedBufferAttribute | null = null;
      if (skinned) {
        bakeRows = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        bakeRows.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aBake', bakeRows);
      }
      const mesh = new THREE.InstancedMesh(geo, skinned ? skinMat : mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = high;
      mesh.receiveShadow = high;
      mesh.frustumCulled = false;
      const dDepth = skinned ? skinDepth : depth;
      if (dDepth) mesh.customDepthMaterial = dDepth;
      const deadGeo = geo.clone();
      const still = new Float32Array(MAX_DEAD * 4);
      for (let i = 0; i < MAX_DEAD; i++) still[i * 4 + 3] = 0.5;
      deadGeo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(still, 4));
      if (skinned) {
        // Fallen horses lie in the last pose of the death clip.
        const last = kit!.clips.Death.start + kit!.clips.Death.frames - 1, rows = new Float32Array(MAX_DEAD * 3);
        for (let i = 0; i < MAX_DEAD; i++) rows.set([last, last, 0], i * 3);
        deadGeo.setAttribute('aBake', new THREE.InstancedBufferAttribute(rows, 3));
      }
      const dead = new THREE.InstancedMesh(deadGeo, skinned ? skinDeadMat : deadMat, MAX_DEAD);
      dead.count = 0;
      dead.receiveShadow = high;
      dead.castShadow = high;
      dead.frustumCulled = false;
      if (dDepth) dead.customDepthMaterial = dDepth;
      this.scene.add(mesh, dead);
      this.kindIndex.set(key, this.kinds.length);
      this.kinds.push({ mesh, anim, cap, count: 0, dead, deadMats: new Float32Array(MAX_DEAD * 16), deadNext: 0, deadCount: 0, cavalry, bakeRows });
    };
    for (const team of ['blue', 'red'] as const) {
      add(`swordsman:${team}`, unitGeometry('swordsman', team), 420, false);
      add(`pikeman:${team}`, unitGeometry('pikeman', team), 320, false);
      add(`archer:${team}`, unitGeometry('archer', team), 220, false);
      for (let v = 0; v < COATS; v++) add(`cavalry:${team}:${v}`, kit ? kit.geometry(team, v) : unitGeometry('cavalry', team, v), 90, true);
    }
  }

  private syncUnits(sim: ChargeSim, dt: number): void {
    for (const k of this.kinds) k.count = 0;
    let blobs = 0;
    const blobMesh = this.blobs, b = this.bounds, t = sim.time;
    for (const s of sim.soldiers) {
      if (!s.alive) continue;
      const ki = this.kindOf(s);
      let st = this.anim.get(s.id);
      if (!st) { st = { phase: hash(s.id, 3) * 6.28, px: s.x, py: s.y, clipT: hash(s.id, 5) * 3 }; this.anim.set(s.id, st); }
      const dist = Math.hypot(s.x - st.px, s.y - st.py);
      st.px = s.x; st.py = s.y;
      const x = s.x * S, z = s.y * S;
      if (ki < 0 || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue; // off screen: not drawn
      const k = this.kinds[ki];
      if (k.count >= k.cap) continue;
      const down = !s.rider && s.down > 0;
      let amp = 0, bob = 0, yawJitter = 0;
      if (s.rider) {
        const kk = Math.min(1, s.speed / C.GALLOP_SPEED);
        st.phase += dt * (4 + 9 * kk);
        amp = s.speed > 15 ? 0.25 + 0.45 * kk : 0;
        bob = horseKit ? 0 : Math.abs(Math.sin(st.phase)) * 0.1 * kk;
      } else {
        const speed = dt > 0 ? dist / dt : 0;
        st.phase += Math.min(dist, 10) * 0.55;
        amp = !down && speed > 4 ? Math.min(0.55, 0.15 + speed / 60) : 0;
        bob = amp * Math.abs(Math.cos(st.phase)) * 0.06;
        // Men standing in the ranks shift their weight now and then.
        if (amp === 0 && !s.fleeing && !down) yawJitter = Math.sin(t * 0.6 + s.id * 1.7) * 0.06;
      }
      const attack = s.fleeing ? 0 : attackAngle(s.type, t - s.lastAttack);
      // Pose: facing; lying on a side when knocked down; leaning into flight or into a blow.
      this.tmpQ.setFromAxisAngle(this.up, -s.facing + yawJitter);
      if (down) this.tmpQ.multiply(this.tmpQ2.setFromAxisAngle(this.fwd, (s.id % 2 ? 1 : -1) * Math.PI / 2));
      else if (s.fleeing) this.tmpQ.multiply(this.tmpQ2.setFromAxisAngle(this.side, -0.25));
      else if (attack < -0.3) this.tmpQ.multiply(this.tmpQ2.setFromAxisAngle(this.side, attack * 0.08));
      const gy = heightAt(x, z);
      this.tmpP.set(x, gy + (down ? 0.25 : bob), z);
      k.mesh.setMatrixAt(k.count, this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS));
      k.anim.setXYZW(k.count, st.phase, amp, attack, hash(s.id, 7));
      if (k.bakeRows && horseKit) {
        // Gallop, walk or stand by speed, with the clip played at a matching rate.
        const c = horseKit.clips, sp = s.speed;
        const clip = sp > 95 ? c.Gallop : sp > 12 ? c.Walk : c.Idle;
        const rate = sp > 95 ? sp / 175 : sp > 12 ? sp / 55 : 1;
        st.clipT += dt * rate;
        const [ra, rb, bl] = clipRows(clip, st.clipT);
        k.bakeRows.setXYZ(k.count, ra, rb, bl);
      }
      k.count++;
      if (blobMesh && blobs < 1400) {
        this.tmpQ.setFromAxisAngle(this.up, -s.facing);
        this.tmpS.set(k.cavalry ? 2.8 : 1.1, 1, k.cavalry ? 1.3 : 1.1);
        blobMesh.setMatrixAt(blobs++, this.tmpM.compose(this.tmpP.set(x + 0.15, gy + 0.03, z + 0.1), this.tmpQ, this.tmpS));
        this.tmpS.set(1, 1, 1);
      }
    }
    for (const k of this.kinds) {
      k.mesh.count = k.count;
      k.mesh.instanceMatrix.needsUpdate = true;
      k.anim.needsUpdate = true;
      if (k.bakeRows) k.bakeRows.needsUpdate = true;
    }
    if (blobMesh) {
      blobMesh.count = blobs;
      blobMesh.instanceMatrix.needsUpdate = true;
    }
  }

  // --- The fallen ---------------------------------------------------------------------------

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'kill':
        case 'rider-down': {
          const ki = this.soldierKind.get(e.id);
          this.anim.delete(e.id);
          this.soldierKind.delete(e.id);
          if (ki === undefined || ki < 0) break;
          const k = this.kinds[ki];
          const slot = k.deadNext;
          k.deadNext = (k.deadNext + 1) % MAX_DEAD;
          k.deadCount = Math.min(MAX_DEAD, k.deadCount + 1);
          for (let i = this.dying.length - 1; i >= 0; i--) if (this.dying[i].kind === ki && this.dying[i].slot === slot) this.dying.splice(i, 1);
          const hard = e.byPlayer;
          const a = e.angle + (Math.random() - 0.5) * 0.9, sp = hard ? 7 + Math.random() * 4 : 0.6;
          const x = e.x * S, z = e.y * S;
          this.dying.push({
            kind: ki, slot, x, y: heightAt(x, z) + 0.1, z,
            vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: hard ? 3.5 + Math.random() * 2.5 : 0.25,
            yaw: -a + (Math.random() - 0.5), spin: (Math.random() - 0.5) * (hard ? 14 : 1), roll: 0, age: 0,
            // Struck down in the press: sag, then keel over.
            rollRate: hard ? 6 : 2.4 + Math.random() * 1.2,
          });
          this.blood(x, z, e.angle, hard ? 9 : 5);
          break;
        }
        case 'impact':
          this.burst(e.x * S, e.y * S, e.angle, e.side === 'rear' ? 9 : e.side === 'flank' ? 6 : 4, e.pike);
          if (Math.random() < 0.45) this.scorch(e.x * S, e.y * S);
          if (e.pike && Math.random() < 0.6) this.dropShaft(e.x * S, e.y * S);
          this.sparks(e.x * S, e.y * S, e.pike ? 8 : 4);
          break;
        case 'arrow-land':
          if (!e.hit) this.stickArrow(e.x * S, e.y * S, e.angle);
          break;
        case 'rout':
          this.dropStandard(e.x * S, e.y * S, e.team);
          break;
        case 'hit':
          if (Math.random() < 0.5) this.blood(e.x * S, e.y * S, e.angle, 2);
          if (Math.random() < 0.3) this.sparks(e.x * S, e.y * S, 3);
          break;
      }
    }
  }

  private updateDying(dt: number): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.age += dt;
      d.vy -= 18 * dt;
      d.x += d.vx * dt; d.z += d.vz * dt; d.y += d.vy * dt;
      d.yaw += d.spin * dt;
      d.roll = Math.min(Math.PI / 2, d.roll + dt * d.rollRate * (0.4 + d.roll));
      const ground = heightAt(d.x, d.z);
      // A toppling man has landed once he's down; a thrown one when he hits the ground.
      const landed = d.y <= ground && d.age > 0.12 && (d.rollRate > 5 || d.roll >= Math.PI / 2 - 0.01);
      if (landed) {
        d.y = ground;
        this.decal(d.x, d.z);
        this.burstDust(d.x, d.z, 3, 1);
      }
      const k = this.kinds[d.kind];
      // Animated horses already lie on their side in the death pose: no extra roll.
      const roll = k.bakeRows ? 0 : d.roll;
      this.tmpQ.setFromAxisAngle(this.up, d.yaw).multiply(this.tmpQ2.setFromAxisAngle(this.fwd, roll * (d.slot % 2 ? 1 : -1)));
      this.tmpP.set(d.x, Math.max(ground, d.y) + 0.24 * (roll / (Math.PI / 2)), d.z);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS).toArray(k.deadMats, d.slot * 16);
      if (landed) this.dying.splice(i, 1);
    }
    const b = this.bounds;
    for (const k of this.kinds) {
      const src = k.deadMats, dst = k.dead.instanceMatrix.array as Float32Array;
      let n = 0;
      for (let i = 0; i < k.deadCount; i++) {
        const x = src[i * 16 + 12], z = src[i * 16 + 14];
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        dst.set(src.subarray(i * 16, i * 16 + 16), n * 16);
        n++;
      }
      k.dead.count = n;
      k.dead.instanceMatrix.needsUpdate = true;
    }
  }

  /** Arrows that miss stay stuck in the ground, leaning back the way they came. */
  private stickArrow(x: number, z: number, angle: number): void {
    const L = this.litter, m = L.arrows, i = L.arrowNext;
    L.arrowNext = (i + 1) % m.instanceMatrix.count;
    m.count = Math.min(m.instanceMatrix.count, m.count + 1);
    this.tmpQ.setFromAxisAngle(this.up, -angle + (Math.random() - 0.5) * 0.3)
      .multiply(this.tmpQ2.setFromAxisAngle(this.side, 0.45 + Math.random() * 0.4));
    m.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(x, heightAt(x, z) - 0.16, z), this.tmpQ, this.tmpS));
    m.instanceMatrix.needsUpdate = true;
  }

  /** A splintered pike or lance left lying where a charge met the pikes. */
  private dropShaft(x: number, z: number): void {
    const L = this.litter, m = L.shafts, i = L.shaftNext;
    L.shaftNext = (i + 1) % m.instanceMatrix.count;
    m.count = Math.min(m.instanceMatrix.count, m.count + 1);
    const px = x + (Math.random() - 0.5) * 1.5, pz = z + (Math.random() - 0.5) * 1.5;
    this.tmpQ.setFromAxisAngle(this.up, Math.random() * 6.28);
    m.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(px, heightAt(px, pz), pz), this.tmpQ, this.tmpS));
    m.instanceMatrix.needsUpdate = true;
  }

  /** A broken battalion drops its standard. */
  private dropStandard(x: number, z: number, team: 'blue' | 'red'): void {
    if (this.fallenStandards.length >= 40) return;
    const m = new THREE.Mesh(this.fallenGeo[team], this.plainMat);
    m.position.set(x, heightAt(x, z), z);
    m.rotation.y = Math.random() * 6.28;
    m.castShadow = this.quality === 'high';
    this.scene.add(m);
    this.fallenStandards.push(m);
  }

  /** A spiky patch of churned earth where a charge struck; they build up over the battle. */
  private scorch(x: number, z: number): void {
    const i = this.scorchNext;
    this.scorchNext = (this.scorchNext + 1) % 600;
    this.scorchCount = Math.min(600, this.scorchCount + 1);
    const s = 1.6 + Math.random() * 1.6;
    this.tmpQ.setFromAxisAngle(this.up, Math.random() * 6.28);
    this.scorches.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(x, heightAt(x, z) + 0.025, z), this.tmpQ, this.tmpS.set(s, 1, s)));
    this.tmpS.set(1, 1, 1);
    this.scorches.count = this.scorchCount;
    this.scorches.instanceMatrix.needsUpdate = true;
  }

  private decal(x: number, z: number): void {
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % MAX_DECALS;
    this.decalCount = Math.min(MAX_DECALS, this.decalCount + 1);
    this.tmpQ.setFromAxisAngle(this.up, Math.random() * 6.28);
    const s = 0.35 + Math.random() * 0.5;
    const dx = x + (Math.random() - 0.5) * 0.4, dz = z + (Math.random() - 0.5) * 0.4;
    this.decals.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(dx, heightAt(dx, dz) + 0.02, dz), this.tmpQ, this.tmpS.set(s * 1.3, 1, s)));
    this.tmpS.set(1, 1, 1);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  // --- Trampled grass ----------------------------------------------------------------------

  /** Riders (and marching blocks, more slowly) wear paths into the meadow that stay all battle. */
  private updateTrample(sim: ChargeSim, dt: number): void {
    const tr = this.trample;
    const stamp = (i: number, j: number, amount: number) => {
      if (i < 0 || j < 0 || i >= TRAMPLE_W || j >= TRAMPLE_H) return;
      const o = j * TRAMPLE_W + i;
      if (tr[o] < 255) { tr[o] = Math.min(255, tr[o] + amount); this.trampleDirty = true; }
    };
    // A hoof-wide stamp: full in the middle, half on the cells around it.
    const mark = (x: number, z: number, amount: number) => {
      const i = Math.floor(x), j = Math.floor(z);
      stamp(i, j, amount);
      const half = Math.ceil(amount / 2);
      stamp(i + 1, j, half); stamp(i - 1, j, half); stamp(i, j + 1, half); stamp(i, j - 1, half);
    };
    const k = Math.min(1, dt * 30);
    for (const sq of sim.squadrons) {
      for (const r of sq.riders) if (r.speed > 60) mark(r.x * S, r.y * S, Math.ceil(8 * k * (r.speed / C.GALLOP_SPEED)));
    }
    for (const b of sim.battalions) {
      if (b.routed || b.engagedTimer > 0) continue;
      // A marching block scuffs the ground under it a little.
      if (hash(b.id, Math.floor(sim.time * 4)) < 0.3) mark(b.x * S + (Math.random() - 0.5) * 6, b.y * S + (Math.random() - 0.5) * 4, 1);
    }
    this.trampleTimer += dt;
    if (this.trampleDirty && this.trampleTimer > 0.3) {
      this.trampleTimer = 0;
      this.trampleDirty = false;
      this.trampleTex.needsUpdate = true;
    }
  }

  // --- Arrows, warnings, standards, markers ---------------------------------------------------

  private updateArrows(sim: ChargeSim): void {
    let n = 0;
    for (const a of sim.arrows) {
      if (a.t < 0 || n >= 900) continue;
      const p = a.t / a.flight;
      const sx = a.sx * S, sz = a.sy * S, tx = a.tx * S, tz = a.ty * S;
      const dx = tx - sx, dz = tz - sz, d = Math.hypot(dx, dz) || 1;
      const peak = 3 + a.flight * 5;
      const x = sx + dx * p, z = sz + dz * p;
      const g0 = heightAt(sx, sz), g1 = heightAt(tx, tz);
      const h = g0 + (g1 - g0) * p + 4 * p * (1 - p) * peak;
      const slope = Math.atan2(4 * (1 - 2 * p) * peak + (g1 - g0), d);
      this.tmpQ.setFromAxisAngle(this.up, -Math.atan2(dz, dx)).multiply(this.tmpQ2.setFromAxisAngle(this.side, slope));
      this.tmpM.compose(this.tmpP.set(x, h + 0.3, z), this.tmpQ, this.tmpS);
      this.arrows.setMatrixAt(n, this.tmpM);
      this.streaks.setMatrixAt(n, this.tmpM);
      n++;
    }
    this.arrows.count = n;
    this.streaks.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.streaks.instanceMatrix.needsUpdate = true;
  }

  private updateTelegraphs(sim: ChargeSim): void {
    let n = 0;
    for (const v of sim.volleys) {
      if (!v.atPlayer || n >= this.telegraphs.length) continue;
      const p = Math.min(1, v.t / v.flight);
      if (p >= 1) continue;
      const t = this.telegraphs[n++];
      t.visible = true;
      this.onGround(t, v.x * S, v.y * S, 0.12);
      t.scale.setScalar(v.radius * S);
      (t.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.22 * p;
    }
    for (; n < this.telegraphs.length; n++) this.telegraphs[n].visible = false;
  }

  private updateStandards(sim: ChargeSim): void {
    for (const m of this.standards.values()) m.visible = false;
    for (const bat of sim.battalions) {
      if (bat.routed) continue;
      let m = this.standards.get(bat.id);
      if (!m) {
        m = new THREE.Mesh(this.standardGeo[bat.team], this.flagMat);
        m.castShadow = this.quality === 'high';
        this.scene.add(m);
        this.standards.set(bat.id, m);
      }
      m.visible = true;
      this.onGround(m, (bat.x - Math.cos(bat.facing) * bat.spacing * 0.6) * S, (bat.y - Math.sin(bat.facing) * bat.spacing * 0.6) * S, 0);
      m.rotation.y = -bat.facing + Math.PI / 2;
    }
    // A pennant over every cavalry squadron's leader.
    for (const m of this.pennants.values()) m.visible = false;
    for (const sq of sim.squadrons) {
      const L = sq.riders[0];
      if (!L) continue;
      let m = this.pennants.get(sq.id);
      if (!m) {
        m = new THREE.Mesh(this.pennantGeo[sq.team], this.flagMat);
        m.castShadow = this.quality === 'high';
        this.scene.add(m);
        this.pennants.set(sq.id, m);
      }
      m.visible = true;
      const x = L.x * S - Math.cos(L.facing) * 0.4, z = L.y * S - Math.sin(L.facing) * 0.4;
      this.onGround(m, x, z, 0);
      m.rotation.y = -L.facing + Math.sin(sim.time * 6 + sq.id) * 0.15;
    }
  }

  private updateMarkers(sim: ChargeSim): void {
    const L = sim.leader;
    this.leaderRing.visible = !!L;
    if (L) this.onGround(this.leaderRing, L.x * S, L.y * S, 0.08);
    const G = sim.general;
    this.generalRing.visible = !!G;
    if (G) this.onGround(this.generalRing, G.x * S, G.y * S, 0.08);
    this.exposeEdge.visible = false;
    this.exposeArc.visible = false;
    if (L) this.drawExposed(sim, L);
  }

  /** Only the enemy formation you're riding at shows the side you'd hit (amber flank, red rear). */
  private drawExposed(sim: ChargeSim, L: Soldier): void {
    let best: Battalion | Squadron | null = null, bestD = Infinity;
    const consider = (o: Battalion | Squadron, x: number, y: number, range: number) => {
      const d = Math.hypot(x - L.x, y - L.y);
      if (d > range || d < 1 || d >= bestD) return;
      if (Math.abs(angleDiff(L.facing, Math.atan2(y - L.y, x - L.x))) > 0.6) return;
      best = o; bestD = d;
    };
    for (const b of sim.battalions) if (b.team !== L.team && !b.routed) consider(b, b.x, b.y, 320);
    for (const sq of sim.squadrons) {
      if (sq.team === L.team || !sq.riders[0]) continue;
      const c = sim.squadCenter(sq);
      consider(sq, c.x, c.y, 240);
    }
    const target = best as Battalion | Squadron | null;
    if (!target) return;
    const opacity = 0.55 + 0.35 * Math.sin(sim.time * 6);
    if ('grid' in target) {
      const b = target;
      const side = attackSide(Math.atan2(b.y - L.y, b.x - L.x), b.facing);
      if (side === 'front') return;
      const rows = Math.ceil(b.grid.length / b.cols), sp = b.spacing * sim.looseness(b);
      const hd = (rows * sp) / 2 + 3, hw = (b.cols * sp) / 2 + 3;
      const fx = Math.cos(b.facing), fy = Math.sin(b.facing), lx = -fy, ly = fx;
      let cx: number, cy: number, len: number, along: number;
      if (side === 'rear') { cx = b.x - fx * hd; cy = b.y - fy * hd; len = hw * 2; along = b.facing + Math.PI / 2; }
      else {
        const sgn = -(b.x - L.x) * lx - (b.y - L.y) * ly >= 0 ? 1 : -1;
        cx = b.x + lx * hw * sgn; cy = b.y + ly * hw * sgn; len = hd * 2; along = b.facing;
      }
      const e = this.exposeEdge;
      e.visible = true;
      this.onGround(e, cx * S, cy * S, 0.12);
      e.rotation.set(0, -along, 0);
      e.scale.set(len * S, 1, 1);
      const m = e.material as THREE.MeshBasicMaterial;
      m.color.setHex(side === 'rear' ? 0xd8402e : 0xe6b03a);
      m.opacity = opacity;
      return;
    }
    const sq = target;
    const c = sim.squadCenter(sq);
    const side = attackSide(Math.atan2(c.y - L.y, c.x - L.x), sq.riders[0].facing);
    if (side === 'front') return;
    const r = (10 + Math.sqrt(sq.riders.length) * 5) * S;
    const a = this.exposeArc;
    a.visible = true;
    this.onGround(a, c.x * S, c.y * S, 0.12);
    a.scale.setScalar(r);
    a.rotation.set(0, -Math.atan2(L.y - c.y, L.x - c.x), 0);
    const m = a.material as THREE.MeshBasicMaterial;
    m.color.setHex(side === 'rear' ? 0xd8402e : 0xe6b03a);
    m.opacity = opacity;
  }

  // --- Post-processing (High) ------------------------------------------------------------------

  private buildComposer(): void {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, this.viewW, this.viewH);
    ao.updateGtaoMaterial({ radius: 0.6, distanceFallOff: 1, thickness: 1 });
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
    // A gentle grade: warmer, a touch richer and more contrasty, a soft highlight
    // shoulder, and a little haze toward the far (top) edge of the view.
    composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          vec3 col = c.rgb * vec3(1.03, 1.0, 0.97);
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, 1.03);
          // Contrast in perceptual space, so dark channels stay rich instead of being crushed.
          vec3 g = pow(max(col, 0.0), vec3(1.0 / 2.2));
          g = (g - 0.5) * 1.05 + 0.5;
          col = pow(max(g, 0.0), vec3(2.2));
          col = col / (1.0 + max(col - 0.85, 0.0) * 0.8);
          col = mix(col, vec3(0.6, 0.67, 0.72), smoothstep(0.6, 1.0, vUv.y) * 0.08);
          gl_FragColor = vec4(max(col, 0.0), c.a);
        }`,
    }));
    // A soft glow on the brightest highlights (sunlit steel, sparks), at half resolution.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(this.viewW / 2, this.viewH / 2), 0.22, 0.45, 0.88));
    // Tilt-shift: sharp across the middle of the view, softly blurred toward the top and
    // bottom edges — the battlefield reads like a diorama.
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    for (const t of [this.tiltH, this.tiltV]) { t.uniforms.r.value = 0.5; composer.addPass(t); }
    composer.addPass(new OutputPass());
    composer.setPixelRatio(this.resScale);
    this.composer = composer;
    this.updateTilt();
  }

  // --- Particles ---------------------------------------------------------------------------

  private buildParticles(): THREE.Points {
    const n = this.maxParticles;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - d * d));
        }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    this.scene.add(pts);
    return pts;
  }

  private add(p: Particle): void {
    if (this.particles.length >= this.maxParticles) this.particles.shift();
    this.particles.push(p);
  }

  private blood(x: number, z: number, angle: number, n: number): void {
    const y0 = heightAt(x, z);
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * 1.4, sp = 1 + Math.random() * 3.5;
      this.add({ x, y: y0 + 0.9 + Math.random() * 0.6, z, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2, vz: Math.sin(a) * sp,
        age: 0, life: 0.5 + Math.random() * 0.3, size: 0.16 + Math.random() * 0.12, grow: 0, r: 0.45, g: 0.07, b: 0.05, a: 0.95, gravity: 14 });
    }
  }

  /** Bright sparks where steel meets steel. */
  private sparks(x: number, z: number, n: number): void {
    const y0 = heightAt(x, z) + 1.1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 2 + Math.random() * 4;
      this.add({ x, y: y0 + (Math.random() - 0.5) * 0.4, z, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * sp,
        age: 0, life: 0.18 + Math.random() * 0.18, size: 0.07 + Math.random() * 0.05, grow: -0.05,
        r: 1.6, g: 1.25, b: 0.6, a: 1, gravity: 9 });
    }
  }

  /** Billowing dust: warm, rising and spreading slowly. */
  private burstDust(x: number, z: number, n: number, scale: number): void {
    const y0 = heightAt(x, z), k = this.quality === 'high' ? 1 : 0.7;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 0.4 + Math.random() * 1.4;
      this.add({ x, y: y0 + 0.3, z, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 0.8, vz: Math.sin(a) * sp,
        age: 0, life: 1.1 + Math.random() * 0.9, size: (1 + Math.random() * 0.9) * scale * k, grow: 3 * scale * k,
        r: 0.72, g: 0.63, b: 0.48, a: 0.34, gravity: -0.15 });
    }
  }

  private burst(x: number, z: number, angle: number, n: number, pike: boolean): void {
    this.burstDust(x, z, Math.ceil(n * 0.7), 1.2);
    const y0 = heightAt(x, z);
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * 1.8, sp = 3 + Math.random() * 5;
      const wood = pike && i % 2 === 0;
      this.add({ x, y: y0 + 0.6, z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp,
        age: 0, life: 0.45 + Math.random() * 0.3, size: 0.1 + Math.random() * 0.08, grow: 0,
        r: wood ? 0.55 : 0.4, g: wood ? 0.4 : 0.3, b: wood ? 0.22 : 0.2, a: 1, gravity: 16 });
    }
  }

  /** Galloping riders kick up dust behind them. */
  private spawnTrail(sim: ChargeSim, dt: number): void {
    this.trailTimer += dt;
    if (this.trailTimer < 0.05) return;
    this.trailTimer = 0;
    const rate = this.quality === 'high' ? 0.55 : 0.25;
    for (const sq of sim.squadrons) {
      for (const r of sq.riders) {
        if (r.speed < 80 || Math.random() > (r.speed / C.GALLOP_SPEED) * rate) continue;
        const x = (r.x - Math.cos(r.facing) * 9) * S, z = (r.y - Math.sin(r.facing) * 9) * S;
        const y0 = heightAt(x, z);
        this.add({ x: x + (Math.random() - 0.5) * 0.6, y: y0 + 0.25, z: z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.6, vy: 0.6, vz: (Math.random() - 0.5) * 0.6,
          age: 0, life: 0.9 + Math.random() * 0.6, size: 0.9 + Math.random() * 0.6, grow: 2.8, r: 0.74, g: 0.65, b: 0.5, a: 0.3, gravity: -0.1 });
      }
    }
  }

  private updateParticles(dt: number): void {
    const geo = this.points.geometry;
    const pos = geo.attributes.position.array as Float32Array;
    const col = geo.attributes.aColor.array as Float32Array;
    const size = geo.attributes.aSize.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 1 - dt * 0.8; p.vz *= 1 - dt * 0.8;
      const ground = heightAt(p.x, p.z) + 0.02;
      if (p.y < ground) { p.y = ground; p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; }
      const k = p.age / p.life;
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
      col[n * 4] = p.r; col[n * 4 + 1] = p.g; col[n * 4 + 2] = p.b; col[n * 4 + 3] = p.a * (1 - k);
      size[n] = p.size + p.grow * k;
      this.particles[n++] = p;
    }
    this.particles.length = n;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }
}
