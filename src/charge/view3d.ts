import * as THREE from 'three';
import type { Application } from 'pixi.js';
import { Theme } from '../theme';
import { Vec2 } from '../types';
import { attackDuration } from '../unit-art';
import { fbm } from '../ground';
import { CHARGE as C } from './config';
import { Battalion, ChargeSim, SimEvent, Soldier, Squadron, angleDiff, attackSide } from './sim';
import { PathPoint } from './path';
import { DirectZones } from './direct';
import { COATS, oakGeometry, pineGeometry, standardGeometry, tentGeometry, unitGeometry } from './models3d';
import { paintDirtTile, paintMeadowTile } from './ground3d';

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
const MAX_PARTICLES = 1800;

const RIG_VERTEX = /* glsl */`
  vec3 transformed = vec3(position);
  if (aRig.w > 0.5) {
    float ang = aRig.w < 1.5 ? sin(aAnim.x + aRig.z) * aAnim.y : -aAnim.z;
    vec2 p = transformed.xy - aRig.xy;
    float c = cos(ang), s = sin(ang);
    transformed.xy = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + aRig.xy;
  }
`;

/** Add the gait/attack rig to a material's vertex shader. */
function rigged<M extends THREE.Material>(mat: M): M {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec4 aRig;\nattribute vec3 aAnim;\n' + sh.vertexShader.replace('#include <begin_vertex>', RIG_VERTEX);
  };
  return mat;
}

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
}

interface Dying {
  kind: number;
  slot: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; spin: number; roll: number;
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

/**
 * Prototype 3D battlefield: real models lit by the sun, a slightly tilted top-down camera
 * that keeps your leader dead centre, animated gaits and blows, bodies flung through
 * the air, dust, arrows in flight. Draws into its own WebGL canvas under the Pixi one.
 */
export class ChargeView3D implements ChargeRenderer {
  holdCamera = false;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 1, 600);
  private readonly sun = new THREE.DirectionalLight(0xfff0d0, 2.3);
  private readonly kinds: Kind[] = [];
  private readonly kindIndex = new Map<string, number>();
  private readonly anim = new Map<number, { phase: number; px: number; py: number }>();
  private readonly lastKind = new Map<number, number>();
  private readonly dying: Dying[] = [];
  private readonly decals: THREE.InstancedMesh;
  private decalNext = 0;
  private decalCount = 0;
  private readonly arrows: THREE.InstancedMesh;
  private readonly telegraphs: THREE.Mesh[] = [];
  private readonly standards = new Map<number, THREE.Mesh>();
  private readonly standardGeo: Record<'blue' | 'red', THREE.BufferGeometry>;
  private readonly plainMat: THREE.MeshLambertMaterial;
  private readonly leaderRing: THREE.Mesh;
  private readonly generalRing: THREE.Mesh;
  private readonly exposeEdge: THREE.Mesh;
  private readonly exposeArc: THREE.Mesh;
  private readonly aimRing: THREE.Mesh;
  private readonly route: THREE.Line;
  private readonly particles: Particle[] = [];
  private readonly points: THREE.Points;
  private readonly fpsEl: HTMLDivElement;
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
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(1, 0, 0);
  private readonly side = new THREE.Vector3(0, 0, 1);
  private readonly ray = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private readonly app: Application, theme: Theme, private readonly host: HTMLElement) {
    void theme;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.renderer = new THREE.WebGLRenderer({
      antialias: dpr < 1.5, powerPreference: 'high-performance',
      preserveDrawingBuffer: import.meta.env.DEV, // lets dev recordings read the canvas
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    const cv = this.renderer.domElement;
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    // Under the HUD; input passes through to the controls on the host. The Pixi canvas
    // draws nothing in 3D, so it is hidden rather than composited.
    host.appendChild(cv);
    this.prevPixiDisplay = app.canvas.style.display;
    app.canvas.style.display = 'none';

    this.scene.background = new THREE.Color(0x24331a);
    this.scene.fog = new THREE.Fog(0x8a9a78, 120, 320);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a5a2a, 1.35));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);

    this.plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.buildGround();
    this.buildScenery();
    this.buildUnits();
    this.standardGeo = { blue: this.unrig(standardGeometry('blue')), red: this.unrig(standardGeometry('red')) };

    this.decals = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4a0c08, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.scene.add(this.decals);

    this.arrows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.03, 0.03), new THREE.MeshLambertMaterial({ color: 0xe8e0cc }), 900);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.arrows.castShadow = true;
    this.scene.add(this.arrows);

    const flat = (geo: THREE.BufferGeometry, color: number, opacity: number) => {
      const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    };
    this.leaderRing = flat(new THREE.RingGeometry(1.0, 1.18, 40), 0x4a8cff, 0.8);
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

    this.points = this.buildParticles();

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
    this.app.canvas.style.display = this.prevPixiDisplay;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    this.renderer.dispose();
  }

  setCombatText(on: boolean): void { void on; }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value =
      h * this.renderer.getPixelRatio() / (2 * Math.tan((FOV * Math.PI) / 360));
  }

  focus(p: Vec2): void {
    this.target.set(p.x * S, 0, p.y * S);
    this.zoom = this.baseZoom();
    this.placeCamera();
  }

  worldToScreen(p: Vec2): Vec2 {
    const v = this.tmpP.set(p.x * S, 0, p.y * S).project(this.camera);
    return { x: (v.x + 1) / 2 * this.viewW, y: (1 - v.y) / 2 * this.viewH };
  }

  screenToWorld(p: Vec2): Vec2 {
    this.ray.setFromCamera(new THREE.Vector2((p.x / this.viewW) * 2 - 1, 1 - (p.y / this.viewH) * 2), this.camera);
    const hit = this.ray.ray.intersectPlane(this.groundPlane, this.tmpP);
    return hit ? { x: hit.x / S, y: hit.z / S } : { x: this.target.x / S, y: this.target.z / S };
  }

  get viewport(): { x: number; y: number; w: number; h: number } {
    const pts = [[0, 0], [this.viewW, 0], [0, this.viewH], [this.viewW, this.viewH]].map(([x, y]) => this.screenToWorld({ x, y }));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  drawRoute(points: PathPoint[], leader: Soldier | null, drawing: boolean): void {
    void drawing;
    const pts: number[] = [];
    if (leader && points.length) pts.push(leader.x * S, 0.05, leader.y * S);
    for (const p of points) pts.push(p.x * S, 0.05, p.y * S);
    this.route.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.route.visible = pts.length >= 6;
  }

  drawAim(leader: Soldier | null, aim: Vec2 | null, zones: DirectZones): void {
    void zones;
    this.aimRing.visible = !!(leader && aim);
    if (aim) this.aimRing.position.set(aim.x * S, 0.04, aim.y * S);
  }

  // --- Frame -------------------------------------------------------------------------------

  render(sim: ChargeSim, events: SimEvent[], dt: number): void {
    this.updateCamera(sim, dt);
    this.updateBounds();
    this.handleEvents(sim, events);
    this.syncUnits(sim, dt);
    this.updateDying(dt);
    this.updateArrows(sim);
    this.updateTelegraphs(sim);
    this.updateStandards(sim);
    this.updateMarkers(sim);
    this.spawnTrail(sim, dt);
    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
    this.meterFps(dt);
  }

  private meterFps(dt: number): void {
    this.fpsTime += dt;
    this.fpsFrames++;
    if (this.fpsTime < 0.5) return;
    const info = this.renderer.info.render;
    this.fpsEl.textContent = `3D ${Math.round(this.fpsFrames / this.fpsTime)} fps · ${(info.triangles / 1000).toFixed(0)}k tris · ${info.calls} calls`;
    this.fpsTime = 0;
    this.fpsFrames = 0;
  }

  private updateBounds(): void {
    const v = this.viewport, m = 6; // margin: men just off screen still cast shadows into it
    this.bounds.x0 = v.x * S - m; this.bounds.x1 = (v.x + v.w) * S + m;
    this.bounds.z0 = v.y * S - m; this.bounds.z1 = (v.y + v.h) * S + m;
  }

  private baseZoom(): number {
    const long = Math.max(this.viewW, this.viewH), short = Math.min(this.viewW, this.viewH);
    let zoom = long / 740;
    if (short < 600) zoom = Math.max(zoom, short / 260);
    const devZoom = import.meta.env.DEV ? (window as { chargeZoom?: number }).chargeZoom ?? 1 : 1;
    return Math.max(0.8, Math.min(3, zoom)) * devZoom;
  }

  /** Put the camera above the target so the same width of field shows as in 2D. */
  private placeCamera(): void {
    const visW = (this.viewW / this.zoom) * S;
    const hfov = 2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * this.camera.aspect);
    const dist = (visW / 2) / Math.tan(hfov / 2);
    this.camera.position.set(this.target.x, Math.cos(TILT) * dist, this.target.z + Math.sin(TILT) * dist);
    this.camera.lookAt(this.target);
    // Sun and its shadow box follow the action; snap to shadow texels so edges don't crawl.
    const box = Math.min(90, visW * 0.85);
    const texel = (box * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(this.target.x / texel) * texel, sz = Math.round(this.target.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx - 30, 55, sz + 12);
    const cam = this.sun.shadow.camera;
    if (cam.right !== box) {
      Object.assign(cam, { left: -box, right: box, top: box, bottom: -box, near: 1, far: 160 });
      cam.updateProjectionMatrix();
    }
  }

  private updateCamera(sim: ChargeSim, dt: number): void {
    const L = sim.leader;
    let targetZoom = this.baseZoom();
    if (L) {
      // The leader is always exactly in the centre of the screen.
      this.target.set(L.x * S, 0, L.y * S);
      const k = Math.min(1, L.speed / C.GALLOP_SPEED);
      targetZoom = this.holdCamera ? this.zoom : targetZoom * (1 - 0.08 * k);
    }
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-2 * dt));
    this.placeCamera();
  }

  // --- Static world ------------------------------------------------------------------------

  private earthAt(x: number, z: number): number {
    const cx = (C.WORLD_W / 2) * S, fy = C.FRONT_Y * S;
    const xf = Math.max(0, 1 - Math.max(0, Math.abs(x - cx) - 40) / 16);
    const front = Math.max(0, 1 - Math.abs(z - fy) / 8) * xf;
    let camp = 0;
    for (const c of C.CAMPS) camp = Math.max(camp, 1 - Math.hypot(x - c.x * S, z - c.y * S) / (C.CAMP_R * S * 1.1));
    return Math.max(front, camp);
  }

  private buildGround(): void {
    const W = C.WORLD_W * S, H = C.WORLD_H * S, pad = 40;
    const geo = new THREE.PlaneGeometry(W + pad * 2, H + pad * 2, Math.round((W + pad * 2) / 2), Math.round((H + pad * 2) / 2));
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, H / 2);
    const n1 = fbm(11, 4), n2 = fbm(23, 3), n3 = fbm(41, 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const tint: number[] = [], dirt: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const a = n1(x * 0.03, z * 0.03), b = n2(x * 0.12, z * 0.12), p = n3(x * 0.22, z * 0.22);
      // Broad and patch-sized (a few metres) variation in tone and warmth: soft lighter
      // and darker patches across the meadow, and the tiling never shows.
      const k = (0.9 + a * 0.14) * (0.9 + p * 0.2);
      let r = k * (0.98 + b * 0.06), g = k, bl = k * (0.96 + (1 - b) * 0.06);
      // Darker forest floor beyond the field.
      const out = Math.min(1, Math.max(0, Math.max(-x, x - W, -z, z - H)) / 6);
      r *= 1 - out * 0.55; g *= 1 - out * 0.45; bl *= 1 - out * 0.55;
      tint.push(r * 1.85, g * 1.74, bl * 2.15); // lifts the painted tile to a sunlit meadow (linear colour)
      // Where the ground is worn, ragged at the edges.
      dirt.push(Math.min(1, Math.max(0, (this.earthAt(x, z) * (0.6 + b * 0.8) - 0.12) * 1.8)));
      uv.setXY(i, x / 13, z / 13);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
    geo.setAttribute('aDirt', new THREE.Float32BufferAttribute(dirt, 1));
    const tile = (cv: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const grass = tile(paintMeadowTile()), earth = tile(paintDirtTile());
    // Not tone-mapped: the tone curve's toe crushed the darker channels into acid green.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grass, toneMapped: false });
    // Blend the meadow and the dirt per vertex.
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDirt = { value: earth };
      sh.vertexShader = 'attribute float aDirt;\nvarying float vDirt;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDirt = aDirt;');
      sh.fragmentShader = 'uniform sampler2D uDirt;\nvarying float vDirt;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          // The meadow mixed with a rotated, rescaled copy of itself: no visible repeat.
          vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.43 + vec2(0.31, 0.17);
          vec4 gC = mix(texture2D(map, vMapUv), texture2D(map, uv2), 0.45);
          vec4 dC = texture2D(uDirt, vMapUv * 1.4);
          diffuseColor *= mix(gC, dC, smoothstep(0.0, 1.0, vDirt));
        #endif`);
    };
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** Drop the rig attributes from scenery built with the unit kit. */
  private unrig(g: THREE.BufferGeometry): THREE.BufferGeometry {
    g.deleteAttribute('aRig');
    return g;
  }

  private scatter(geo: THREE.BufferGeometry, items: { x: number; z: number; s: number; r: number }[], shadow = true, mat: THREE.Material = this.plainMat): void {
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
        mesh.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(t.x, 0, t.z), this.tmpQ, this.tmpS.setScalar(t.s)));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    this.tmpS.setScalar(1);
  }

  private buildScenery(): void {
    const W = C.WORLD_W * S, H = C.WORLD_H * S;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Forest round the field (the battle itself stays in the open).
    const oaks: { x: number; z: number; s: number; r: number }[][] = [[], [], []], pines: { x: number; z: number; s: number; r: number }[] = [];
    for (let i = 0; i < 900; i++) {
      const sideN = Math.floor(rnd() * 4), along = rnd(), depth = 3 + rnd() * 30;
      const x = sideN % 2 === 0 ? along * (W + 60) - 30 : sideN === 1 ? W + depth : -depth;
      const z = sideN % 2 === 1 ? along * (H + 60) - 30 : sideN === 0 ? -depth : H + depth;
      const t = { x, z, s: 0.85 + rnd() * 0.55, r: rnd() * 6.28 };
      if (rnd() < 0.62) oaks[Math.floor(rnd() * 3)].push(t); else pines.push(t);
    }
    oaks.forEach((list, v) => this.scatter(this.unrig(oakGeometry(v)), list));
    this.scatter(this.unrig(pineGeometry()), pines);
    // Stones in the open field (the meadow itself is painted, no tufts).
    const rocks: { x: number; z: number; s: number; r: number }[] = [];
    for (let i = 0; i < 160; i++) rocks.push({ x: rnd() * W, z: rnd() * H, s: 0.3 + rnd() * 0.5, r: rnd() * 6.28 });
    this.scatter(new THREE.IcosahedronGeometry(0.5, 0).scale(1.3, 0.6, 1), rocks, true, new THREE.MeshLambertMaterial({ color: 0x8a867a, flatShading: true }));
    // Camps: blue tents round each rally ring, red tents along the far edge.
    const blueTents: { x: number; z: number; s: number; r: number }[] = [], redTents: { x: number; z: number; s: number; r: number }[] = [];
    for (const c of C.CAMPS) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3, r = (C.CAMP_R + 26) * S;
        blueTents.push({ x: c.x * S + Math.cos(a) * r, z: c.y * S + Math.sin(a) * r, s: 1, r: a });
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(C.CAMP_R * S - 0.25, C.CAMP_R * S, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x4a8cff, transparent: true, opacity: 0.45, depthWrite: false }));
      ring.position.set(c.x * S, 0.03, c.y * S);
      this.scene.add(ring);
    }
    for (let i = 0; i < 9; i++) redTents.push({ x: W / 2 + (i - 4) * 7, z: 7 + rnd() * 4, s: 1, r: rnd() * 6.28 });
    this.scatter(this.unrig(tentGeometry('blue')), blueTents);
    this.scatter(this.unrig(tentGeometry('red')), redTents);
  }

  // --- Units -------------------------------------------------------------------------------

  private kindKey(s: { type: string; team: string; id: number }): string {
    return s.type === 'cavalry' ? `cavalry:${s.team}:${s.id % COATS}` : `${s.type}:${s.team}`;
  }

  private buildUnits(): void {
    const mat = rigged(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 18, specular: 0x2a2a2a }));
    const deadMat = rigged(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 8, specular: 0x111111, color: 0xb8b8b8 }));
    const depth = rigged(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    const add = (key: string, geo: THREE.BufferGeometry, cap: number) => {
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.customDepthMaterial = depth;
      const deadGeo = geo.clone();
      deadGeo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEAD * 3), 3));
      const dead = new THREE.InstancedMesh(deadGeo, deadMat, MAX_DEAD);
      dead.count = 0;
      dead.receiveShadow = true;
      dead.castShadow = true;
      dead.frustumCulled = false;
      dead.customDepthMaterial = depth;
      this.scene.add(mesh, dead);
      this.kindIndex.set(key, this.kinds.length);
      this.kinds.push({ mesh, anim, cap, count: 0, dead, deadMats: new Float32Array(MAX_DEAD * 16), deadNext: 0, deadCount: 0 });
    };
    for (const team of ['blue', 'red'] as const) {
      add(`swordsman:${team}`, unitGeometry('swordsman', team), 420);
      add(`pikeman:${team}`, unitGeometry('pikeman', team), 320);
      add(`archer:${team}`, unitGeometry('archer', team), 220);
      for (let v = 0; v < COATS; v++) add(`cavalry:${team}:${v}`, unitGeometry('cavalry', team, v), 90);
    }
  }

  private syncUnits(sim: ChargeSim, dt: number): void {
    for (const k of this.kinds) k.count = 0;
    for (const s of sim.soldiers) {
      if (!s.alive) continue;
      const bx = s.x * S, bz = s.y * S, b = this.bounds;
      if (bx < b.x0 || bx > b.x1 || bz < b.z0 || bz > b.z1) {
        // Off screen: not drawn, but keep its gait state moving.
        const st = this.anim.get(s.id);
        if (st) { st.px = s.x; st.py = s.y; }
        this.lastKind.set(s.id, this.kindIndex.get(this.kindKey(s)) ?? -1);
        continue;
      }
      const ki = this.kindIndex.get(this.kindKey(s));
      if (ki === undefined) continue;
      const k = this.kinds[ki];
      if (k.count >= k.cap) continue;
      this.lastKind.set(s.id, ki);
      let st = this.anim.get(s.id);
      if (!st) { st = { phase: hash(s.id, 3) * 6.28, px: s.x, py: s.y }; this.anim.set(s.id, st); }
      const dist = Math.hypot(s.x - st.px, s.y - st.py);
      st.px = s.x; st.py = s.y;
      const down = !s.rider && s.down > 0;
      let amp = 0, bob = 0;
      if (s.rider) {
        const kk = Math.min(1, s.speed / C.GALLOP_SPEED);
        st.phase += dt * (4 + 9 * kk);
        amp = s.speed > 15 ? 0.25 + 0.45 * kk : 0;
        bob = Math.abs(Math.sin(st.phase)) * 0.1 * kk;
      } else {
        const speed = dt > 0 ? dist / dt : 0;
        st.phase += Math.min(dist, 10) * 0.55;
        amp = !down && speed > 4 ? Math.min(0.55, 0.15 + speed / 60) : 0;
        bob = amp * Math.abs(Math.cos(st.phase)) * 0.06;
      }
      const since = sim.time - s.lastAttack, dur = attackDuration(s.type);
      const attack = !s.fleeing && since >= 0 && since < dur ? Math.sin((Math.PI * since) / dur) * 1.1 : 0;
      // Pose: facing, then lying on a side when knocked down, or leaning into flight.
      this.tmpQ.setFromAxisAngle(this.up, -s.facing);
      if (down) this.tmpQ.multiply(this.tmpQ2.setFromAxisAngle(this.fwd, (s.id % 2 ? 1 : -1) * Math.PI / 2));
      else if (s.fleeing) this.tmpQ.multiply(this.tmpQ2.setFromAxisAngle(this.side, -0.25));
      this.tmpP.set(s.x * S, down ? 0.25 : bob, s.y * S);
      k.mesh.setMatrixAt(k.count, this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS));
      k.anim.setXYZ(k.count, st.phase, amp, attack);
      k.count++;
    }
    for (const k of this.kinds) {
      k.mesh.count = k.count;
      k.mesh.instanceMatrix.needsUpdate = true;
      k.anim.needsUpdate = true;
    }
  }

  // --- The fallen ---------------------------------------------------------------------------

  private handleEvents(sim: ChargeSim, events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'kill':
        case 'rider-down': {
          const ki = this.lastKind.get(e.id);
          this.anim.delete(e.id);
          this.lastKind.delete(e.id);
          if (ki === undefined || ki < 0) break;
          const k = this.kinds[ki];
          const slot = k.deadNext;
          k.deadNext = (k.deadNext + 1) % MAX_DEAD;
          k.deadCount = Math.min(MAX_DEAD, k.deadCount + 1);
          // Drop any flight still using this slot (the ring wrapped round).
          for (let i = this.dying.length - 1; i >= 0; i--) if (this.dying[i].kind === ki && this.dying[i].slot === slot) this.dying.splice(i, 1);
          const hard = e.byPlayer;
          const a = e.angle + (Math.random() - 0.5) * 0.9, sp = hard ? 7 + Math.random() * 4 : 1.5;
          this.dying.push({
            kind: ki, slot, x: e.x * S, y: 0.1, z: e.y * S,
            vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: hard ? 3.5 + Math.random() * 2.5 : 0.8,
            yaw: -a + (Math.random() - 0.5), spin: (Math.random() - 0.5) * (hard ? 14 : 3), roll: 0, age: 0,
          });
          this.blood(e.x * S, e.y * S, e.angle, hard ? 9 : 5);
          break;
        }
        case 'impact':
          this.burst(e.x * S, e.y * S, e.angle, e.side === 'rear' ? 9 : e.side === 'flank' ? 6 : 4, e.pike);
          break;
        case 'hit':
          if (Math.random() < 0.5) this.blood(e.x * S, e.y * S, e.angle, 2);
          break;
      }
    }
    void sim;
  }

  private updateDying(dt: number): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.age += dt;
      d.vy -= 18 * dt;
      d.x += d.vx * dt; d.z += d.vz * dt; d.y += d.vy * dt;
      d.yaw += d.spin * dt;
      d.roll = Math.min(Math.PI / 2, d.roll + dt * 6);
      const landed = d.y <= 0 && d.age > 0.12;
      if (landed) {
        d.y = 0;
        this.decal(d.x, d.z);
        this.burstDust(d.x, d.z, 3);
      }
      const k = this.kinds[d.kind];
      this.tmpQ.setFromAxisAngle(this.up, d.yaw).multiply(this.tmpQ2.setFromAxisAngle(this.fwd, d.roll * (d.slot % 2 ? 1 : -1)));
      this.tmpP.set(d.x, Math.max(0, d.y) + 0.24 * (d.roll / (Math.PI / 2)), d.z);
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

  private decal(x: number, z: number): void {
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % MAX_DECALS;
    this.decalCount = Math.min(MAX_DECALS, this.decalCount + 1);
    this.tmpQ.setFromAxisAngle(this.up, Math.random() * 6.28);
    const s = 0.35 + Math.random() * 0.5;
    this.decals.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(x + (Math.random() - 0.5) * 0.4, 0.015, z + (Math.random() - 0.5) * 0.4), this.tmpQ, this.tmpS.set(s * 1.3, 1, s)));
    this.tmpS.set(1, 1, 1);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
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
      const h = 4 * p * (1 - p) * peak;
      const slope = Math.atan2(4 * (1 - 2 * p) * peak, d);
      this.tmpQ.setFromAxisAngle(this.up, -Math.atan2(dz, dx)).multiply(this.tmpQ2.setFromAxisAngle(this.side, slope));
      this.arrows.setMatrixAt(n++, this.tmpM.compose(this.tmpP.set(sx + dx * p, h + 0.3, sz + dz * p), this.tmpQ, this.tmpS));
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  private updateTelegraphs(sim: ChargeSim): void {
    let n = 0;
    for (const v of sim.volleys) {
      if (!v.atPlayer || n >= this.telegraphs.length) continue;
      const p = Math.min(1, v.t / v.flight);
      if (p >= 1) continue;
      const t = this.telegraphs[n++];
      t.visible = true;
      t.position.set(v.x * S, 0.05, v.y * S);
      t.scale.setScalar(v.radius * S);
      (t.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.22 * p;
    }
    for (; n < this.telegraphs.length; n++) this.telegraphs[n].visible = false;
  }

  private updateStandards(sim: ChargeSim): void {
    const seen = new Set<number>();
    for (const b of sim.battalions) {
      if (b.routed) continue;
      seen.add(b.id);
      let m = this.standards.get(b.id);
      if (!m) {
        m = new THREE.Mesh(this.standardGeo[b.team], this.plainMat);
        m.castShadow = true;
        this.scene.add(m);
        this.standards.set(b.id, m);
      }
      m.position.set((b.x - Math.cos(b.facing) * b.spacing * 0.6) * S, 0, (b.y - Math.sin(b.facing) * b.spacing * 0.6) * S);
      m.rotation.y = -b.facing + Math.PI / 2;
    }
    for (const [id, m] of this.standards) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.standards.delete(id);
    }
  }

  private updateMarkers(sim: ChargeSim): void {
    const L = sim.leader;
    this.leaderRing.visible = !!L;
    if (L) this.leaderRing.position.set(L.x * S, 0.04, L.y * S);
    const G = sim.general;
    this.generalRing.visible = !!G;
    if (G) this.generalRing.position.set(G.x * S, 0.04, G.y * S);
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
      e.position.set(cx * S, 0.06, cy * S);
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
    a.position.set(c.x * S, 0.06, c.y * S);
    a.scale.setScalar(r);
    a.rotation.set(0, -Math.atan2(L.y - c.y, L.x - c.x), 0);
    const m = a.material as THREE.MeshBasicMaterial;
    m.color.setHex(side === 'rear' ? 0xd8402e : 0xe6b03a);
    m.opacity = opacity;
  }

  // --- Particles ---------------------------------------------------------------------------

  private buildParticles(): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(THREE.DynamicDrawUsage));
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
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  private blood(x: number, z: number, angle: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * 1.4, sp = 1 + Math.random() * 3.5;
      this.add({ x, y: 0.9 + Math.random() * 0.6, z, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2, vz: Math.sin(a) * sp,
        age: 0, life: 0.5 + Math.random() * 0.3, size: 0.16 + Math.random() * 0.12, grow: 0, r: 0.45, g: 0.07, b: 0.05, a: 0.95, gravity: 14 });
    }
  }

  private burstDust(x: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 0.4 + Math.random() * 1.2;
      this.add({ x, y: 0.3, z, vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 0.6, vz: Math.sin(a) * sp,
        age: 0, life: 0.8 + Math.random() * 0.6, size: 0.9 + Math.random() * 0.8, grow: 2.2, r: 0.62, g: 0.55, b: 0.42, a: 0.38, gravity: 0 });
    }
  }

  private burst(x: number, z: number, angle: number, n: number, pike: boolean): void {
    this.burstDust(x, z, Math.ceil(n * 0.6));
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * 1.8, sp = 3 + Math.random() * 5;
      const wood = pike && i % 2 === 0;
      this.add({ x, y: 0.6, z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp,
        age: 0, life: 0.45 + Math.random() * 0.3, size: 0.1 + Math.random() * 0.08, grow: 0,
        r: wood ? 0.55 : 0.4, g: wood ? 0.4 : 0.3, b: wood ? 0.22 : 0.2, a: 1, gravity: 16 });
    }
  }

  /** Galloping riders kick up dust behind them. */
  private spawnTrail(sim: ChargeSim, dt: number): void {
    this.trailTimer += dt;
    if (this.trailTimer < 0.05) return;
    this.trailTimer = 0;
    for (const sq of sim.squadrons) {
      for (const r of sq.riders) {
        if (r.speed < 80 || Math.random() > (r.speed / C.GALLOP_SPEED) * 0.5) continue;
        const x = (r.x - Math.cos(r.facing) * 9) * S, z = (r.y - Math.sin(r.facing) * 9) * S;
        this.add({ x: x + (Math.random() - 0.5) * 0.6, y: 0.25, z: z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.6, vy: 0.5, vz: (Math.random() - 0.5) * 0.6,
          age: 0, life: 0.7 + Math.random() * 0.5, size: 0.8 + Math.random() * 0.6, grow: 2.4, r: 0.66, g: 0.58, b: 0.44, a: 0.3, gravity: 0 });
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
      if (p.y < 0.02) { p.y = 0.02; p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; }
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
