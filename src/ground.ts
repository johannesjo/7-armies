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

function hexRgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a.toFixed(3)})`;
}

function shade(c: number, k: number): number {
  const r = Math.min(255, Math.max(0, ((c >> 16) & 255) * k));
  const g = Math.min(255, Math.max(0, ((c >> 8) & 255) * k));
  const b = Math.min(255, Math.max(0, (c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/**
 * A seamless tile of close-up grass seen from above: a mottled base, clumps of
 * blades in several shades, and a scattering of dry straw. Drawn once and tiled.
 */
export function paintGrassTile(theme: Theme, size = 512, seed = 3): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const mid = shade(theme.grassDark, 1.12);
  ctx.fillStyle = hexRgba(mid, 1);
  ctx.fillRect(0, 0, size, size);

  // Fine mottling (tileable: noise sampled on a torus via wrapped lattice).
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const cell = 8;
  const n = size / cell;
  const lattice = Array.from({ length: n * n }, () => rand());
  const at = (ix: number, iy: number) => lattice[((iy % n + n) % n) * n + ((ix % n + n) % n)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / cell, fy = y / cell;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy)
        + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
      const k = 0.82 + v * 0.3 + (rand() - 0.5) * 0.08;
      const i = (y * size + x) * 4;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Draw a stroke, repeated across the edges so the tile wraps seamlessly.
  const stroke = (x0: number, y0: number, x1: number, y1: number) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const minX = Math.min(x0, x1) + ox, maxX = Math.max(x0, x1) + ox;
        const minY = Math.min(y0, y1) + oy, maxY = Math.max(y0, y1) + oy;
        if (maxX < -2 || minX > size + 2 || maxY < -2 || minY > size + 2) continue;
        ctx.beginPath();
        ctx.moveTo(x0 + ox, y0 + oy);
        ctx.lineTo(x1 + ox, y1 + oy);
        ctx.stroke();
      }
    }
  };

  const palette = [
    shade(theme.grassDark, 0.72),
    shade(theme.grassDark, 0.9),
    theme.grassLight,
    shade(theme.grassLight, 1.12),
  ];
  ctx.lineCap = 'round';
  // Clumps of blades fanning out from a root.
  for (let c = 0; c < 1700; c++) {
    const cx = rand() * size, cy = rand() * size;
    const base = rand() * Math.PI * 2;
    const blades = 4 + Math.floor(rand() * 6);
    const color = palette[Math.floor(rand() * palette.length)];
    for (let b = 0; b < blades; b++) {
      // Blades sprout from slightly different points and lean every which way.
      const ang = base + (rand() - 0.5) * 2.6;
      const len = 2 + rand() * 4.5;
      const ox = cx + (rand() - 0.5) * 2.5, oy = cy + (rand() - 0.5) * 2.5;
      ctx.strokeStyle = hexRgba(shade(color, 0.85 + rand() * 0.3), 0.45 + rand() * 0.45);
      ctx.lineWidth = 0.55 + rand() * 0.6;
      stroke(ox, oy, ox + Math.cos(ang) * len, oy + Math.sin(ang) * len);
    }
  }
  // Loose single blades for fine texture.
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size, y = rand() * size;
    const ang = rand() * Math.PI * 2;
    const len = 1 + rand() * 2.2;
    const color = palette[Math.floor(rand() * palette.length)];
    ctx.strokeStyle = hexRgba(color, 0.35 + rand() * 0.4);
    ctx.lineWidth = 0.6 + rand() * 0.5;
    stroke(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  }
  // Dry straw.
  for (let i = 0; i < 260; i++) {
    const x = rand() * size, y = rand() * size;
    const ang = rand() * Math.PI * 2;
    const len = 3 + rand() * 5;
    ctx.strokeStyle = hexRgba(theme.grassDry, 0.35 + rand() * 0.35);
    ctx.lineWidth = 0.7;
    stroke(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  }
  return canvas;
}

/**
 * Broad colour patches (light, dark and dry grass) and trampled earth painted into
 * a single transparent overlay for the tiled grass — one layer instead of two.
 */
export function paintGroundOverlay(width: number, height: number, theme: Theme, earth: ((x: number, y: number) => number) | null, scale = 4, seed = 11): HTMLCanvasElement {
  const w = Math.max(1, Math.ceil(width / scale));
  const h = Math.max(1, Math.ceil(height / scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const patches = fbm(seed, 4);
  const dryness = fbm(seed + 31, 3);
  const edge = fbm(seed + 2, 4);
  const grain = fbm(seed + 9, 3);
  const dark = rgb(theme.grassDark);
  const light = rgb(theme.grassLight);
  const dry = rgb(theme.grassDry);
  const dirt = rgb(theme.dirt);
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = px * scale, y = py * scale;
      const p = patches(x / 260, y / 260);
      let c = lerpColor(dark, light, Math.min(1, Math.max(0, p * 1.3 - 0.15)));
      const dr = smoothstep(0.58, 0.8, dryness(x / 420, y / 420)) * 0.6;
      c = lerpColor(c, dry, dr);
      let a = 0.42 + Math.abs(p - 0.5) * 0.3 + dr * 0.3;
      if (earth) {
        const e = earth(x, y);
        if (e > 0) {
          const ea = smoothstep(0.25, 0.75, e * (0.55 + edge(x / 60, y / 60) * 0.9));
          if (ea > 0.01) {
            const k = 0.78 + grain(x / 14, y / 14) * 0.42 + (Math.random() - 0.5) * 0.1;
            const soil = [dirt[0] * k, dirt[1] * k, dirt[2] * k * 0.95];
            c = lerpColor(c, soil, ea);
            a = a + (0.94 - a) * ea;
          }
        }
      }
      const i = (py * w + px) * 4;
      data[i] = Math.min(255, c[0]);
      data[i + 1] = Math.min(255, c[1]);
      data[i + 2] = Math.min(255, c[2]);
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
