import { ChargeInput } from './sim';

/** Pointer closer than this (CSS px) to the leader: let the horses slow to a stop. */
export const DEAD_ZONE_PX = 20;
/** Full canter at this share of the screen's short side from the leader. */
export const CANTER_FULL = 0.12;
/** Gallop beyond this share of the screen's short side from the leader. */
export const GALLOP_AT = 0.2;

export interface DirectZones {
  dead: number;
  canter: number;
  gallop: number;
}

/** Speed zones around the leader in CSS px for a view of the given size. */
export function directZones(viewW: number, viewH: number): DirectZones {
  const minDim = Math.max(1, Math.min(viewW, viewH));
  return { dead: DEAD_ZONE_PX, canter: minDim * CANTER_FULL, gallop: minDim * GALLOP_AT };
}

/**
 * Point-and-ride steering: ride toward the pointer; the further it is from the
 * leader, the faster — walk close in, canter further out, gallop far out.
 * `dx`/`dy` are the pointer's offset from the leader on screen (CSS px).
 */
export function directInput(dx: number, dy: number, zones: DirectZones): ChargeInput {
  const d = Math.hypot(dx, dy);
  if (d < zones.dead) return { dirX: 0, dirY: 0, gallop: false };
  // The sim reads deflection 0.2..0.8 as walk-to-canter; never drop below a steering walk.
  const mag = Math.max(0.3, Math.min(1, d / zones.canter));
  return { dirX: (dx / d) * mag, dirY: (dy / d) * mag, gallop: d >= zones.gallop };
}

/** Keyboard reins, relative to the squadron's heading (like steering a car). */
export interface Reins {
  forward: boolean;
  back: boolean;
  /** -1 = left, +1 = right, 0 = straight. */
  turn: number;
}

/** Aim this far off the current heading so the horses turn at their full rate. */
const REIN_TURN = 1.2;

/**
 * Steering from the reins: forward rides on (canter, or gallop when spurred),
 * left/right turn relative to where the horses face, back reins in. Turning
 * without riding forward wheels round at a walk.
 */
export function reinsInput(reins: Reins, facing: number, gallop: boolean): ChargeInput {
  const turn = Math.sign(reins.turn);
  let mag: number;
  if (reins.back) mag = turn !== 0 ? 0.25 : 0;
  else if (reins.forward) mag = 1;
  else mag = turn !== 0 ? 0.45 : 0;
  if (mag === 0) return { dirX: 0, dirY: 0, gallop: false };
  const h = facing + turn * REIN_TURN;
  return { dirX: Math.cos(h) * mag, dirY: Math.sin(h) * mag, gallop: gallop && !reins.back };
}
