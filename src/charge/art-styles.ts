import { Graphics, GraphicsContext } from 'pixi.js';
import { Team, UnitType } from '../types';
import { ArtStyle, Theme } from '../theme';
import { drawUnitArt, HORSE_VARIANTS } from '../unit-art';
import { fbm } from '../ground';

type Canvas = Graphics | GraphicsContext;

/**
 * Prototype art styles for the cavalry mode (pick one from the Style menu):
 * - classic: flat top-down figures (the fallback look).
 * - ink: ink and watercolour on paper, line boil, brush-stroke trails.
 * - rts: upright three-quarter-view figures in the classic painted-RTS manner. Those are
 *   posed and baked per facing and frame (see figure-art.ts), not drawn here.
 */
export type { ArtStyle };

type FlatStyle = 'ink';

const HORSES: Record<FlatStyle, [number, number][]> = {
  ink: [[0x8a6a4a, 0x3a2a1a], [0xa08868, 0x4a3a2a], [0xb0a898, 0x5a5448], [0x5a4a3a, 0x2a2018]],
};

function horse(style: FlatStyle, variant: number): [number, number] {
  const list = HORSES[style];
  return list[((variant % HORSE_VARIANTS) + HORSE_VARIANTS) % HORSE_VARIANTS % list.length];
}

function darken(c: number, k: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v: number) => Math.round(v * (1 - k));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** Draw a unit in the given style. Local +X is the facing, +Y the unit's right. */
export function drawStyledUnit(style: ArtStyle, shape: Canvas, weapon: Canvas, type: UnitType, team: Team, r: number, theme: Theme, variant = 0, gear: 'lance' | 'bow' = 'lance'): void {
  if (style === 'ink') drawInk(shape, weapon, type, team, r, theme, variant, gear);
  else drawUnitArt(shape, weapon, type, team, r, theme, variant, gear);
}

// --- Ink & watercolour -------------------------------------------------------------------

const INK = 0x2a2018;

/** A loose watercolour wash, slightly off-register, under a confident ink outline. */
function drawInk(shape: Canvas, weapon: Canvas, type: UnitType, team: Team, r: number, theme: Theme, variant: number, gear: 'lance' | 'bow' = 'lance'): void {
  const color = team === 'blue' ? theme.blue : theme.red;
  const wash = { color, alpha: 0.5 };
  const line = { width: Math.max(0.55, r * 0.13), color: INK, alpha: 0.9, cap: 'round' as const, join: 'round' as const };
  const ox = r * 0.18, oy = -r * 0.14; // the wash misses the outline a little
  if (type === 'cavalry') {
    const [coat] = horse('ink', variant);
    shape.ellipse(-r * 0.1 + ox, oy, r * 1.25, r * 0.6).fill({ color: coat, alpha: 0.4 });
    shape.ellipse(-r * 0.25 + ox, oy, r * 0.65, r * 0.62).fill(wash);
    shape.ellipse(-r * 0.12, 0, r * 1.1, r * 0.48).stroke(line);
    shape.moveTo(r * 0.85, -r * 0.18).quadraticCurveTo(r * 1.6, -r * 0.2, r * 1.7, 0).quadraticCurveTo(r * 1.6, r * 0.2, r * 0.85, r * 0.18).stroke(line);
    shape.moveTo(-r * 1.15, 0).lineTo(-r * 1.8, r * 0.12).stroke(line);
    shape.circle(-r * 0.1, 0, r * 0.26).fill({ color: INK, alpha: 0.85 });
    if (gear === 'bow') {
      // A bow drawn in two quick strokes, and the string.
      weapon.moveTo(r * 0.35, -r * 0.95).quadraticCurveTo(r * 1.0, -r * 0.4, r * 0.55, 0).quadraticCurveTo(r * 1.0, r * 0.4, r * 0.35, r * 0.95).stroke(line);
      weapon.moveTo(r * 0.35, -r * 0.95).lineTo(r * 0.2, 0).lineTo(r * 0.35, r * 0.95).stroke({ ...line, width: Math.max(0.3, r * 0.05), alpha: 0.6 });
      return;
    }
    weapon.moveTo(-r * 0.6, r * 0.4).lineTo(r * 2.6, r * 0.36).stroke({ ...line, width: Math.max(0.5, r * 0.1) });
    weapon.poly([r * 1.75, r * 0.37, r * 2.1, r * 0.37, r * 1.9, r * 0.7]).fill({ color, alpha: 0.75 });
    return;
  }
  shape.ellipse(ox, oy, r * 0.85, r * 1.2).fill(wash);
  shape.ellipse(0, 0, r * 0.6, r * 1.02).stroke(line);
  shape.circle(r * 0.05, 0, r * (type === 'pikeman' ? 0.48 : 0.36)).fill({ color: INK, alpha: 0.85 });
  // A short stroke out of the front shows which way he faces.
  shape.moveTo(r * 0.45, 0).lineTo(r * 0.9, 0).stroke(line);
  if (type === 'swordsman') shape.arc(r * 0.4, -r * 0.82, r * 0.5, -Math.PI * 0.9, Math.PI * 0.4).stroke(line);
  if (type === 'pikeman') {
    weapon.moveTo(-r * 1.1, r * 0.35).lineTo(r * 4.1, r * 0.32).stroke({ ...line, width: Math.max(0.5, r * 0.11) });
  } else if (type === 'archer') {
    weapon.arc(0, 0, r * 1.55, -0.95, 0.95).stroke(line);
  } else {
    weapon.moveTo(r * 0.5, r * 0.72).lineTo(r * 1.8, r * 0.7).stroke(line);
    weapon.moveTo(r * 0.5, r * 0.42).lineTo(r * 0.5, r * 1.02).stroke({ ...line, width: Math.max(0.45, r * 0.09) });
  }
}

// --- Ground ----------------------------------------------------------------------------

const tiles = new Map<string, HTMLCanvasElement>();

/** Cold-pressed watercolour paper: warm off-white, soft blotches and fibres. */
export function paintPaperTile(theme: Theme, size = 512): HTMLCanvasElement {
  const key = `paper:${theme.bg}:${size}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const n = fbm(5, 5);
  const [r0, g0, b0] = [(theme.bg >> 16) & 255, (theme.bg >> 8) & 255, theme.bg & 255];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const m = n(Math.cos(u * Math.PI * 2) * 3 + 9, Math.sin(v * Math.PI * 2) * 3 + Math.sin(u * Math.PI * 2) * 3);
      const tooth = (rnd() - 0.5) * 10;
      const k = (m - 0.5) * 26 + tooth;
      const i = (y * size + x) * 4;
      img.data[i] = r0 + k;
      img.data[i + 1] = g0 + k;
      img.data[i + 2] = b0 + k * 1.1;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tiles.set(key, cv);
  return cv;
}
