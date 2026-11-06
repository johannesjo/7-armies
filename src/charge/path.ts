import { Vec2 } from '../types';
import { ChargeInput } from './sim';

export interface PathPoint {
  x: number;
  y: number;
  /** Ride this stretch (the segment ending at this point) at a gallop. */
  gallop: boolean;
}

/** Minimum spacing between stored path points (world units). */
const SAMPLE = 10;
/** A point counts as reached inside this radius. */
const ARRIVE = 16;
/** Distance ahead along the path the leader steers toward. */
const LOOKAHEAD_BASE = 26;
const LOOKAHEAD_PER_SPEED = 0.12;
/** Ease off near the end of the route so the squadron pulls up instead of circling. */
const SLOWDOWN_DIST = 70;

/**
 * A route drawn by the player. The squadron leader follows it with pure-pursuit
 * steering; each stretch remembers whether it was drawn as a canter or a gallop.
 */
export class RiderPath {
  points: PathPoint[] = [];

  get active(): boolean {
    return this.points.length > 0;
  }

  clear(): void {
    this.points.length = 0;
  }

  /** Last point of the route, if any. */
  get end(): PathPoint | null {
    return this.points.at(-1) ?? null;
  }

  /**
   * Start a new stroke at `start`. Strokes that begin at the end of the current
   * route extend it; otherwise the route is replaced and the squadron rides
   * straight from where it is to the start of the new stroke.
   */
  begin(start: Vec2, extend: boolean, gallop: boolean): void {
    if (!extend) this.points.length = 0;
    this.add(start, gallop, true);
  }

  /** Append a drawn point (skips points closer than the sample spacing). */
  add(p: Vec2, gallop: boolean, force = false): void {
    const last = this.end;
    if (last) {
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < SAMPLE && !force) {
        // Keep the strongest pace drawn across a short stretch.
        if (gallop) last.gallop = true;
        return;
      }
      if (d < 1) return;
    }
    this.points.push({ x: p.x, y: p.y, gallop });
  }

  /** Length of the remaining route measured from `from`. */
  remaining(from: Vec2): number {
    let len = 0;
    let px = from.x, py = from.y;
    for (const p of this.points) {
      len += Math.hypot(p.x - px, p.y - py);
      px = p.x; py = p.y;
    }
    return len;
  }

  /** Drop points the leader has reached or already ridden past. */
  private consume(leader: Vec2): void {
    while (this.points.length > 0) {
      const p0 = this.points[0];
      const d = Math.hypot(p0.x - leader.x, p0.y - leader.y);
      if (d < ARRIVE) { this.points.shift(); continue; }
      const p1 = this.points[1];
      if (p1) {
        // Past p0 if the leader is further along the p0→p1 segment than p0 itself.
        const sx = p1.x - p0.x, sy = p1.y - p0.y;
        const along = (leader.x - p0.x) * sx + (leader.y - p0.y) * sy;
        if (along > 0 && d < ARRIVE * 4) { this.points.shift(); continue; }
      }
      break;
    }
  }

  /** Point `dist` ahead of the leader along the route. */
  private lookahead(leader: Vec2, dist: number): Vec2 {
    let px = leader.x, py = leader.y;
    let left = dist;
    for (const p of this.points) {
      const seg = Math.hypot(p.x - px, p.y - py);
      if (seg >= left) {
        const k = left / seg;
        return { x: px + (p.x - px) * k, y: py + (p.y - py) * k };
      }
      left -= seg;
      px = p.x; py = p.y;
    }
    return { x: px, y: py };
  }

  /**
   * Steering input that rides the leader along the route, consuming it as it goes.
   * Returns a halt input once the route is finished.
   */
  steer(leader: { x: number; y: number; speed: number }): ChargeInput {
    this.consume(leader);
    if (this.points.length === 0) return { dirX: 0, dirY: 0, gallop: false };
    const target = this.lookahead(leader, LOOKAHEAD_BASE + leader.speed * LOOKAHEAD_PER_SPEED);
    const dx = target.x - leader.x, dy = target.y - leader.y;
    const d = Math.hypot(dx, dy) || 1;
    const rem = this.remaining(leader);
    // Full pace until the last stretch; ease to a canter and stop at the end.
    const mag = rem > SLOWDOWN_DIST ? 1 : Math.max(0.55, rem / SLOWDOWN_DIST);
    return { dirX: (dx / d) * mag, dirY: (dy / d) * mag, gallop: this.points[0].gallop && rem > SLOWDOWN_DIST * 0.5 };
  }
}

/**
 * Classifies a stroke's drawing speed as canter or gallop, with hysteresis so the
 * pace doesn't flicker at the threshold. Speeds are in screen px/s.
 */
export class StrokePace {
  private ema = 0;
  gallop = false;

  constructor(private threshold: number) {}

  reset(threshold: number): void {
    this.threshold = threshold;
    this.ema = 0;
    this.gallop = false;
  }

  /** Feed one pointer sample; returns whether this stretch is a gallop. */
  sample(distPx: number, dtSec: number): boolean {
    if (dtSec <= 0) return this.gallop;
    const inst = distPx / dtSec;
    this.ema = this.ema === 0 ? inst : this.ema * 0.5 + inst * 0.5;
    if (this.gallop) this.gallop = this.ema > this.threshold * 0.7;
    else this.gallop = this.ema > this.threshold;
    return this.gallop;
  }
}
