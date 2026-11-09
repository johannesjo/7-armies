import { Team, Vec2 } from '../types';
import { LANES as L } from './config';

export interface Rect { x: number; y: number; w: number; h: number }

/** The two bands of woods between the lanes, each cut by the passes. */
function buildWoods(): Rect[] {
  const out: Rect[] = [];
  for (let k = 0; k < L.LANE_Y.length - 1; k++) {
    const y0 = L.LANE_Y[k] + L.LANE_HALF, y1 = L.LANE_Y[k + 1] - L.LANE_HALF;
    const cuts = [L.WOODS_X0, ...L.PASSES_X.flatMap(x => [x - L.PASS_HALF, x + L.PASS_HALF]), L.WOODS_X1];
    for (let i = 0; i < cuts.length; i += 2) out.push({ x: cuts[i], y: y0, w: cuts[i + 1] - cuts[i], h: y1 - y0 });
  }
  return out;
}

export const WOODS: readonly Rect[] = buildWoods();

/** Middle of each woods band (y), where the passes cross it. */
const BAND_Y: number[] = L.LANE_Y.slice(0, -1).map((y, k) => (y + L.LANE_Y[k + 1]) / 2);

export function inWoods(x: number, y: number): boolean {
  for (const r of WOODS) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  return false;
}

/** Which lane a height on the field belongs to (the nearest lane centre). */
export function laneAt(y: number): number {
  let best = 0;
  for (let i = 1; i < L.LANE_Y.length; i++) if (Math.abs(y - L.LANE_Y[i]) < Math.abs(y - L.LANE_Y[best])) best = i;
  return best;
}

/** Whether the straight ride from a to b crosses any woods (shrunk by `margin`). */
export function segmentHitsWoods(ax: number, ay: number, bx: number, by: number, margin = 0): boolean {
  const dx = bx - ax, dy = by - ay;
  for (const r of WOODS) {
    const x0 = r.x + margin, x1 = r.x + r.w - margin, y0 = r.y + margin, y1 = r.y + r.h - margin;
    if (x1 <= x0 || y1 <= y0) continue;
    // Liang-Barsky clipping of the segment against the rectangle.
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    let hit = true;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) { hit = false; break; }
        continue;
      }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
    }
    if (hit && t1 > t0) return true;
  }
  return false;
}

/** Points where riders can get past each woods band: the passes and the open bases. */
const CROSSINGS: Vec2[] = BAND_Y.flatMap(y => [L.WOODS_X0 - 60, ...L.PASSES_X, L.WOODS_X1 + 60].map(x => ({ x, y })));

/**
 * Where to ride next to reach `to` without plunging into the woods: straight there if
 * the way is open, else to the first crossing on the shortest route (passes and bases).
 */
export function navWaypoint(from: Vec2, to: Vec2): Vec2 {
  const M = 14;
  if (!segmentHitsWoods(from.x, from.y, to.x, to.y, M)) return to;
  const nodes: Vec2[] = [from, to, ...CROSSINGS];
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const a = nodes[u], b = nodes[v];
      if (segmentHitsWoods(a.x, a.y, b.x, b.y, M)) continue;
      const d = dist[u] + Math.hypot(b.x - a.x, b.y - a.y);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  if (prev[1] < 0) return to; // no route found: ride straight (the woods only slow you)
  let v = 1;
  while (prev[v] !== 0 && prev[v] >= 0) v = prev[v];
  return nodes[v];
}

export interface StructureSpec {
  team: Team;
  kind: 'tower' | 'keep';
  /** Lane index (-1 for the keep). */
  lane: number;
  /** 0 = keep, 1 = inner tower, 2 = outer tower. */
  tier: number;
  x: number;
  y: number;
}

export function structureSpecs(): StructureSpec[] {
  const out: StructureSpec[] = [];
  for (const team of ['blue', 'red'] as const) {
    out.push({ team, kind: 'keep', lane: -1, tier: 0, x: L.KEEP[team].x, y: L.KEEP[team].y });
    L.LANE_Y.forEach((y, lane) => {
      L.TOWER_X[team].forEach((x, i) => {
        out.push({ team, kind: 'tower', lane, tier: i + 1, x, y: y + L.TOWER_OFFSET[lane] });
      });
    });
  }
  return out;
}

/** A lane's road for one team's foot: from their spawn down the lane, then to the enemy keep. */
export function lanePath(team: Team, lane: number): Vec2[] {
  const enemy: Team = team === 'blue' ? 'red' : 'blue';
  const y = L.LANE_Y[lane];
  return [
    { x: L.SPAWN_X[team], y },
    { x: L.SPAWN_X[enemy], y },
    { x: L.KEEP[enemy].x, y: L.KEEP[enemy].y },
  ];
}
