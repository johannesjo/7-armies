import { Theme } from './theme';

/** Hash-based 2D value noise in [0, 1]. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number): number => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal (fBm) noise in [0, 1]. */
export function fbm(seed: number, octaves = 4): (x: number, y: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => valueNoise(seed + i * 101));
  return (x, y) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (const n of layers) {
      sum += n(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

function lerpColor(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgb(c: number): number[] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export interface GrassOptions {
  /** World units per texture pixel (the texture is drawn scaled up, smoothly filtered). */
  scale?: number;
  seed?: number;
  /** 0..1 amount of bare, trampled earth at a world position (front lines, camps). */
  earth?: (x: number, y: number) => number;
}

/**
 * Paint a natural-looking grass field into a canvas: broad light/dark patches,
 * drier straw-coloured areas, fine mottling and trampled earth where `earth` says.
 */
export function paintGrass(width: number, height: number, theme: Theme, opts: GrassOptions = {}): HTMLCanvasElement {
  const scale = opts.scale ?? 4;
  const w = Math.max(1, Math.ceil(width / scale));
  const h = Math.max(1, Math.ceil(height / scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const seed = opts.seed ?? 7;
  const patches = fbm(seed, 4);
  const fine = fbm(seed + 17, 3);
  const dryness = fbm(seed + 31, 3);
  const dark = rgb(theme.grassDark);
  const light = rgb(theme.grassLight);
  const dry = rgb(theme.grassDry);
  const earth = rgb(theme.dirt);
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = px * scale, y = py * scale;
      const p = patches(x / 260, y / 260);
      const f = fine(x / 38, y / 38);
      let c = lerpColor(dark, light, Math.min(1, Math.max(0, p * 1.25 - 0.15 + (f - 0.5) * 0.35)));
      c = lerpColor(c, dry, smoothstep(0.58, 0.8, dryness(x / 420, y / 420)) * 0.55);
      if (opts.earth) {
        const e = opts.earth(x, y);
        if (e > 0) c = lerpColor(c, earth, smoothstep(0.15, 0.85, e * (0.65 + f * 0.7)));
      }
      const speck = 1 + (Math.random() - 0.5) * 0.08;
      const i = (py * w + px) * 4;
      data[i] = Math.min(255, c[0] * speck);
      data[i + 1] = Math.min(255, c[1] * speck);
      data[i + 2] = Math.min(255, c[2] * speck);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
