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
  /**
   * Painted grass clumps: a fan of blades, dark at the root and sunlit at the tip, over a
   * soft shadow to the lower right — the look of a hand-painted meadow seen from above.
   */
  clumps?: { count: number; r0: number; r1: number; roots: string[]; tips: string[]; shadow: string }[];
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
  for (const layer of p.clumps ?? []) {
    ctx.lineCap = 'round';
    for (let i = 0; i < layer.count; i++, k++) {
      const x = hashI(k, 1, seed) * size, y = hashI(k, 2, seed) * size;
      const r = layer.r0 + hashI(k, 3, seed) * (layer.r1 - layer.r0);
      const blades = 6 + Math.floor(hashI(k, 4, seed) * 6);
      const root = layer.roots[Math.floor(hashI(k, 5, seed) * layer.roots.length)];
      const tip = layer.tips[Math.floor(hashI(k, 6, seed) * layer.tips.length)];
      wrapped(size, x, y, r * 2, (px, py) => {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = layer.shadow;
        ctx.beginPath(); ctx.ellipse(px + r * 0.35, py + r * 0.25, r * 0.95, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        for (let b = 0; b < blades; b++) {
          const a = -Math.PI / 2 + (hashI(k * 13 + b, 7, seed) - 0.5) * 1.7;
          const l = r * (0.6 + hashI(k * 13 + b, 8, seed) * 0.6);
          const bx = px + (hashI(k * 13 + b, 9, seed) - 0.5) * r * 0.8, by = py + r * 0.3;
          const mx = bx + Math.cos(a) * l * 0.5, my = by + Math.sin(a) * l * 0.5;
          ctx.lineWidth = Math.max(1, r * 0.22);
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = root;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(mx, my); ctx.stroke();
          ctx.lineWidth = Math.max(0.8, r * 0.16);
          ctx.strokeStyle = tip;
          ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(bx + Math.cos(a) * l, by + Math.sin(a) * l); ctx.stroke();
        }
      });
    }
  }
  ctx.globalAlpha = 1;
  return cv;
}

let grassCanvas: HTMLCanvasElement | null = null;
let dirtCanvas: HTMLCanvasElement | null = null;

/**
 * Lush painted meadow: rich greens from deep shade to sunlit yellow-green, broad soft
 * patches, and thousands of painted grass clumps with dark roots and bright tips.
 */
export function paintMeadowTile(size = 1024): HTMLCanvasElement {
  if (grassCanvas) return grassCanvas;
  const deep = hex(0x3a5c24), mid = hex(0x537a2e), warm = hex(0x6e9436), sun = hex(0x96ae4e);
  const broad = tileFbm(3, 3, 11), dapple = tileFbm(9, 3, 23), grain = tileFbm(40, 2, 37);
  grassCanvas = paint(size, 5, {
    base: (u, v) => {
      const b = broad(u, v), d = dapple(u, v), g = grain(u, v);
      let c = mix(deep, mid, clamp01((b - 0.2) * 1.8));
      c = mix(c, warm, clamp01((d - 0.48) * 2.2));
      c = mix(c, sun, clamp01((d - 0.72) * 2.6) * 0.45);
      const k = 0.92 + g * 0.16;
      return [c[0] * k, c[1] * k, c[2] * k];
    },
    dabs: [
      { colors: ['#3c5e26', '#466a2a', '#50762e', '#5c8232', '#6a8e38', '#789a3e', '#32521e'], count: 22000, r0: 2.5, r1: 6, a0: 0.3, a1: 0.65 },
      { colors: ['#203a14', '#264218', '#1c3412'], count: 6000, r0: 1.8, r1: 3.6, a0: 0.4, a1: 0.75 },
    ],
    clumps: [
      // Shadowed tufts first, then sunlit ones on top, then a few bright yellow-green crowns.
      { count: 2600, r0: 6, r1: 11, roots: ['#223e16', '#28461a', '#1e3814'], tips: ['#4e7a2a', '#58842e', '#608c32'], shadow: '#162a0e' },
      { count: 3400, r0: 5, r1: 10, roots: ['#2e501a', '#36581e', '#2c4c1a'], tips: ['#7ea43e', '#8aae44', '#94b44c', '#a0bc54'], shadow: '#1a3010' },
      { count: 900, r0: 4, r1: 8, roots: ['#3e6422', '#466e26'], tips: ['#b4c862', '#c0d06a', '#c8ce72'], shadow: '#1e3612' },
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
