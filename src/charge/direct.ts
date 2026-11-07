import { ChargeInput } from './sim';

/** Pointer closer than this (CSS px) to the leader: let the horses slow to a stop. */
export const DEAD_ZONE_PX = 26;
/** Full canter at this share of the screen's short side from the leader. */
export const CANTER_FULL = 0.2;
/** Gallop beyond this share of the screen's short side from the leader. */
export const GALLOP_AT = 0.33;

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
