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

const tileCache = new Map<string, HTMLCanvasElement>();

/**
 * A seamless tile of close-up turf seen from above: mottled ground, clumps of blades
 * in varied greens that cast soft shadows (light from the top left), clover and weeds,
 * specks of bare soil and dry straw. Generated once per theme and cached.
 */
export function paintGrassTile(theme: Theme, size = 768, seed = 3): HTMLCanvasElement {
  const key = `${theme.grassDark}:${theme.grassLight}:${size}:${seed}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
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

  // Ground under the grass: dark, mottled at two scales (tileable lattice noise).
  const groundCol = shade(theme.grassDark, 0.78);
  ctx.fillStyle = hexRgba(groundCol, 1);
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const lattice = (cell: number) => {
    const n = Math.round(size / cell);
    const values = Array.from({ length: n * n }, () => rand());
    return (x: number, y: number) => {
      const fx = (x / size) * n, fy = (y / size) * n;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => values[((j % n + n) % n) * n + ((i % n + n) % n)];
      return at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy)
        + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
    };
  };
  const coarse = lattice(48), fine = lattice(8);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = 0.78 + coarse(x, y) * 0.28 + fine(x, y) * 0.18 + (rand() - 0.5) * 0.1;
      const i = (y * size + x) * 4;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Draw a stroke, repeated across the edges so the tile wraps seamlessly.
  const wrap = (fn: (ox: number, oy: number) => void, x: number, y: number, r: number) => {
    for (const ox of [-size, 0, size]) {
      if (x + ox < -r || x + ox > size + r) continue;
      for (const oy of [-size, 0, size]) {
        if (y + oy < -r || y + oy > size + r) continue;
        fn(ox, oy);
      }
    }
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => wrap((ox, oy) => {
    ctx.beginPath();
    ctx.moveTo(x0 + ox, y0 + oy);
    ctx.lineTo(x1 + ox, y1 + oy);
    ctx.stroke();
  }, x0, y0, 12);
  const dot = (x: number, y: number, r: number) => wrap((ox, oy) => {
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }, x, y, r + 2);

  // Greens from yellowish to cool, so the turf isn't one flat hue.
  const greens = [
    shade(theme.grassDark, 0.85),
    theme.grassDark,
    shade(theme.grassLight, 0.92),
    theme.grassLight,
    shade(theme.grassLight, 1.14),
    lerpHex(theme.grassLight, theme.grassDry, 0.35),
    lerpHex(theme.grassDark, 0x2e5a3a, 0.35),
  ];
  ctx.lineCap = 'round';

  // Specks of bare soil showing through.
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = hexRgba(shade(theme.dirt, 0.8 + rand() * 0.4), 0.35 + rand() * 0.3);
    dot(rand() * size, rand() * size, 0.6 + rand() * 1.2);
  }

  // Clover and weeds: little rosettes of round leaves.
  for (let c = 0; c < 70; c++) {
    const cx = rand() * size, cy = rand() * size;
    const n = 6 + Math.floor(rand() * 12);
    const leaf = lerpHex(theme.grassDark, 0x3f6e3a, 0.5 + rand() * 0.3);
    for (let k = 0; k < n; k++) {
      const x = cx + (rand() - 0.5) * 16, y = cy + (rand() - 0.5) * 16;
      for (let l = 0; l < 3; l++) {
        const ang = l * 2.1 + rand();
        ctx.fillStyle = hexRgba(0x000000, 0.18);
        dot(x + Math.cos(ang) * 1.3 + 0.7, y + Math.sin(ang) * 1.3 + 0.8, 1.1);
        ctx.fillStyle = hexRgba(shade(leaf, 0.9 + rand() * 0.3), 0.9);
        dot(x + Math.cos(ang) * 1.3, y + Math.sin(ang) * 1.3, 1.1);
      }
    }
  }

  // Clumps of blades fanning out from a root, each casting a soft shadow.
  const blade = (x: number, y: number, ang: number, len: number, color: number, alpha: number, width: number) => {
    const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
    ctx.strokeStyle = hexRgba(0x000000, 0.22 * alpha);
    ctx.lineWidth = width + 0.4;
    line(x + 0.6, y + 0.8, x1 + 0.9, y1 + 1.1);
    ctx.strokeStyle = hexRgba(color, alpha);
    ctx.lineWidth = width;
    line(x, y, x1, y1);
    // Sunlit tip.
    ctx.strokeStyle = hexRgba(shade(color, 1.25), alpha * 0.5);
    ctx.lineWidth = width * 0.6;
    line(x + (x1 - x) * 0.55, y + (y1 - y) * 0.55, x1, y1);
  };
  const clumps = Math.round(3600 * (size / 768) ** 2);
  for (let c = 0; c < clumps; c++) {
    const cx = rand() * size, cy = rand() * size;
    const base = rand() * Math.PI * 2;
    const blades = 4 + Math.floor(rand() * 7);
    const color = greens[Math.floor(rand() * greens.length)];
    for (let b = 0; b < blades; b++) {
      const ox = cx + (rand() - 0.5) * 2.5, oy = cy + (rand() - 0.5) * 2.5;
      blade(ox, oy, base + (rand() - 0.5) * 2.6, 2 + rand() * 4.5, shade(color, 0.88 + rand() * 0.26), 0.55 + rand() * 0.4, 0.55 + rand() * 0.6);
    }
  }
  // Fine loose blades fill the gaps.
  for (let i = 0; i < Math.round(12000 * (size / 768) ** 2); i++) {
    const color = greens[Math.floor(rand() * greens.length)];
    ctx.strokeStyle = hexRgba(color, 0.35 + rand() * 0.4);
    ctx.lineWidth = 0.5 + rand() * 0.45;
    const x = rand() * size, y = rand() * size, ang = rand() * Math.PI * 2, len = 1 + rand() * 2;
    line(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  }
  // Dry straw.
  for (let i = 0; i < 420; i++) {
    ctx.strokeStyle = hexRgba(shade(theme.grassDry, 0.9 + rand() * 0.3), 0.35 + rand() * 0.35);
    ctx.lineWidth = 0.6;
    const x = rand() * size, y = rand() * size, ang = rand() * Math.PI * 2, len = 3 + rand() * 5;
    line(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  }
  tileCache.set(key, canvas);
  return canvas;
}

function lerpHex(a: number, b: number, t: number): number {
  const ca = rgb(a), cb = rgb(b);
  const c = lerpColor(ca, cb, t);
  return (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
}

/**
 * Broad colour patches (light, dark and dry grass) and trampled earth painted into
 * a single transparent overlay for the tiled grass — one layer instead of two.
 */
const overlayCache = new Map<string, HTMLCanvasElement>();

export function paintGroundOverlay(width: number, height: number, theme: Theme, earth: ((x: number, y: number) => number) | null, scale = 4, seed = 11, cacheKey = ''): HTMLCanvasElement {
  // Painting is per-pixel noise and costs real time; the same field is reused across battles.
  const key = cacheKey && `${cacheKey}:${theme.grassDark}:${theme.dirt}:${width}x${height}:${scale}:${seed}`;
  const cached = key ? overlayCache.get(key) : undefined;
  if (cached) return cached;
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
  if (key) overlayCache.set(key, canvas);
  return canvas;
}
