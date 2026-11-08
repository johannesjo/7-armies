/**
 * Painted, seamlessly tiling ground textures for the 3D battlefield: a dense, warm
 * meadow (fine grain, soft dapples, small dabs and specks, no strokes) and a worn dirt.
 * Generated once per session.
 */

type RGB = [number, number, number];

const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

function hashI(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise that repeats every `period` lattice cells, so the tile has no seams. */
function tileNoise(period: number, seed: number) {
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = u * period, y = v * period;
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const w = (n: number) => ((n % period) + period) % period;
    const a = hashI(w(ix), w(iy), seed), b = hashI(w(ix + 1), w(iy), seed);
    const c = hashI(w(ix), w(iy + 1), seed), d = hashI(w(ix + 1), w(iy + 1), seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function tileFbm(base: number, octaves: number, seed: number) {
  const layers = Array.from({ length: octaves }, (_, i) => tileNoise(base << i, seed + i * 31));
  return (u: number, v: number) => {
    let s = 0, a = 0.5, n = 0;
    for (const l of layers) { s += l(u, v) * a; n += a; a *= 0.5; }
    return s / n;
  };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Draw with wrap-around so marks crossing an edge continue on the opposite side. */
function wrapped(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const ox of [0, -size, size]) for (const oy of [0, -size, size]) {
    const px = x + ox, py = y + oy;
    if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
    draw(px, py);
  }
}

interface Painter {
  base: (u: number, v: number) => RGB;
  dabs: { colors: string[]; count: number; r0: number; r1: number; a0: number; a1: number }[];
  /** Short brush strokes: length, width, mostly at `angle` (rad) give or take `spread`. */
  strokes?: { colors: string[]; count: number; l0: number; l1: number; w0: number; w1: number; a0: number; a1: number; angle: number; spread: number }[];
}

function paint(size: number, seed: number, p: Painter): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = p.base(x / size, y / size);
      const j = (hashI(x, y, seed) - 0.5) * 6; // per-pixel grain
      const o = (y * size + x) * 4;
      img.data[o] = c[0] + j; img.data[o + 1] = c[1] + j; img.data[o + 2] = c[2] + j * 0.6; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  let k = 0;
  for (const layer of p.dabs) {
    for (let i = 0; i < layer.count; i++, k++) {
      const x = hashI(k, 1, seed) * size, y = hashI(k, 2, seed) * size;
      const r = layer.r0 + hashI(k, 3, seed) * (layer.r1 - layer.r0);
      ctx.globalAlpha = layer.a0 + hashI(k, 4, seed) * (layer.a1 - layer.a0);
      ctx.fillStyle = layer.colors[Math.floor(hashI(k, 5, seed) * layer.colors.length)];
      const rot = hashI(k, 6, seed) * Math.PI, squash = 0.6 + hashI(k, 7, seed) * 0.4;
      wrapped(size, x, y, r, (px, py) => { ctx.beginPath(); ctx.ellipse(px, py, r, r * squash, rot, 0, Math.PI * 2); ctx.fill(); });
    }
  }
  for (const layer of p.strokes ?? []) {
    for (let i = 0; i < layer.count; i++, k++) {
      const x = hashI(k, 1, seed) * size, y = hashI(k, 2, seed) * size;
      const l = layer.l0 + hashI(k, 3, seed) * (layer.l1 - layer.l0);
      const a = layer.angle + (hashI(k, 6, seed) - 0.5) * 2 * layer.spread;
      ctx.globalAlpha = layer.a0 + hashI(k, 4, seed) * (layer.a1 - layer.a0);
      ctx.strokeStyle = layer.colors[Math.floor(hashI(k, 5, seed) * layer.colors.length)];
      ctx.lineWidth = layer.w0 + hashI(k, 7, seed) * (layer.w1 - layer.w0);
      ctx.lineCap = 'round';
      const dx = Math.cos(a) * l / 2, dy = Math.sin(a) * l / 2;
      wrapped(size, x, y, l, (px, py) => { ctx.beginPath(); ctx.moveTo(px - dx, py - dy); ctx.lineTo(px + dx, py + dy); ctx.stroke(); });
    }
  }
  ctx.globalAlpha = 1;
  return cv;
}

let grassCanvas: HTMLCanvasElement | null = null;
let dirtCanvas: HTMLCanvasElement | null = null;

/** Lush meadow: warm yellow-olive greens, soft dapples, fine dabs and dark specks. */
export function paintMeadowTile(size = 1024): HTMLCanvasElement {
  if (grassCanvas) return grassCanvas;
  const deep = hex(0x56703a), mid = hex(0x7a9248), warm = hex(0x94a454), sun = hex(0xb4b86c);
  const broad = tileFbm(3, 3, 11), dapple = tileFbm(10, 3, 23), grain = tileFbm(40, 2, 37);
  grassCanvas = paint(size, 5, {
    base: (u, v) => {
      const b = broad(u, v), d = dapple(u, v), g = grain(u, v);
      let c = mix(deep, mid, clamp01((b - 0.2) * 1.8));
      c = mix(c, warm, clamp01((d - 0.5) * 2.2));
      c = mix(c, sun, clamp01((d - 0.75) * 2.5) * 0.35);
      const k = 0.93 + g * 0.14; // fine mottling
      return [c[0] * k, c[1] * k, c[2] * k];
    },
    dabs: [
      // Dense dabs of every green, large enough to survive at gameplay zoom, then dark
      // specks and a few sunlit flecks: a meadow mottled at every scale.
      { colors: ['#52682f', '#5c7436', '#687e3c', '#768c44', '#84984c', '#94a656', '#a2ae5e', '#486028'], count: 30000, r0: 2.5, r1: 6, a0: 0.35, a1: 0.75 },
      { colors: ['#304420', '#384c24', '#2c401c'], count: 13000, r0: 1.8, r1: 4, a0: 0.45, a1: 0.85 },
      { colors: ['#c4c682', '#ced08c', '#d8d896'], count: 4200, r0: 1.5, r1: 3.4, a0: 0.55, a1: 0.95 },
    ],
    strokes: [
      // Short dark blades leaning one way, and a few lit ones: a brushy meadow.
      { colors: ['#344a1e', '#3c5424', '#2e4220'], count: 6000, l0: 5, l1: 12, w0: 1.4, w1: 2.6, a0: 0.4, a1: 0.75, angle: -1.1, spread: 0.5 },
      { colors: ['#b8bc72', '#c4c67c'], count: 2200, l0: 4, l1: 9, w0: 1.2, w1: 2, a0: 0.4, a1: 0.8, angle: -1.1, spread: 0.5 },
    ],
  });
  return grassCanvas;
}

/** Trampled earth: warm browns, darker clods, pale pebbles. */
export function paintDirtTile(size = 512): HTMLCanvasElement {
  if (dirtCanvas) return dirtCanvas;
  const dark = hex(0x80603c), mid = hex(0x9c7c52), light = hex(0xb4966c);
  const broad = tileFbm(3, 3, 51), blot = tileFbm(14, 3, 63);
  dirtCanvas = paint(size, 9, {
    base: (u, v) => {
      const b = broad(u, v), d = blot(u, v);
      let c = mix(dark, mid, clamp01((b - 0.2) * 1.8));
      c = mix(c, light, clamp01((d - 0.55) * 2.2));
      return c;
    },
    dabs: [
      { colors: ['#5a4028', '#6e5234', '#7e603e', '#94744c'], count: 9000, r0: 1, r1: 3.5, a0: 0.3, a1: 0.6 },
      { colors: ['#4a3420', '#3e2c1a'], count: 1800, r0: 1, r1: 2.6, a0: 0.35, a1: 0.65 },
      { colors: ['#b8ac94', '#c8bca4', '#a89c84'], count: 1400, r0: 0.7, r1: 1.6, a0: 0.6, a1: 0.95 },
      { colors: ['#6a8430', '#7a9036'], count: 500, r0: 1, r1: 2.4, a0: 0.3, a1: 0.6 },
    ],
  });
  return dirtCanvas;
}
