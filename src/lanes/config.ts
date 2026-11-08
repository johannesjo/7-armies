import { Team } from '../types';

/**
 * Tunables for the lanes mode: two keeps, three wide lanes between them, waves of foot
 * marching down each lane, towers guarding them, and a mounted commander on each side.
 * Blue holds the west (left) end of the field, red the east.
 */
export const LANES = {
  WORLD_W: 3000,
  WORLD_H: 2400,

  // --- The map ---
  /** Centre line of each lane (top, middle, bottom). */
  LANE_Y: [380, 1200, 2020] as readonly number[],
  /**
   * Half a lane's width. Far wider than a footpath: a squadron at the gallop turns in
   * arcs ~150 across and needs room to wheel round a battalion's flank.
   */
  LANE_HALF: 260,
  /** Woods fill the space between the lanes from one base to the other... */
  WOODS_X0: 600,
  WOODS_X1: 2400,
  /** ...broken by passes where horsemen can cross between lanes. */
  PASSES_X: [1100, 1900] as readonly number[],
  PASS_HALF: 110,
  /** Horses picking their way through the trees go no faster than this share of a canter. */
  WOODS_SLOW: 0.45,

  KEEP: { blue: { x: 270, y: 1200 }, red: { x: 2730, y: 1200 } } as Record<Team, { x: number; y: number }>,
  KEEP_R: 54,
  KEEP_HP: 1000,
  KEEP_RANGE: 430,
  KEEP_VOLLEY: 1.9,
  KEEP_ARROWS: 16,
  KEEP_POWER: 1.2,
  /** Ride home: inside this ring round your keep riders heal, and fresh ones fall in. */
  HOME_R: 230,
  HOME_HEAL: 25,
  HOME_REMOUNT: 0.45,

  /** Towers per lane and side, innermost first; each sits a little off the road. */
  TOWER_X: { blue: [780, 1170], red: [2220, 1830] } as Record<Team, readonly number[]>,
  TOWER_OFFSET: [150, -150, -150] as readonly number[],
  TOWER_R: 24,
  TOWER_HP: [600, 450] as readonly number[],
  TOWER_RANGE: 340,
  TOWER_VOLLEY: 2.4,
  TOWER_ARROWS: 10,
  /** Arrow damage multipliers: against horsemen (dodge the circle!) and against foot. */
  TOWER_POWER_RIDER: 1,
  TOWER_POWER_FOOT: 2.5,
  /**
   * Walls barely notice a commander alone: with none of his foot within this radius of
   * a tower, his riders do only this share of their damage to it. Push with your waves.
   */
  BACKDOOR_RADIUS: 380,
  BACKDOOR_MULT: 0.25,
  /** Damage per second to a tower from each footman, and each rider, hacking at it. */
  SIEGE_DPS_MAN: 1.6,
  SIEGE_DPS_RIDER: 4,
  /** Riders this close to a wall (and slower than a charge) are hacking at it. */
  SIEGE_REACH_RIDER: 46,

  // --- Waves ---
  SPAWN_X: { blue: 540, red: 2460 } as Record<Team, number>,
  FIRST_WAVE: 1,
  WAVE_INTERVAL: 25,
  WAVE_SWORDS: 20,
  WAVE_PIKES: 16,
  /** Every this many waves each battalion grows by WAVE_GROWTH men, up to WAVE_GROWTH_MAX. */
  WAVE_GROWTH_EVERY: 3,
  WAVE_GROWTH: 3,
  WAVE_GROWTH_MAX: 24,
  LANE_MARCH: 32,
  /** A lane battalion turns on enemy foot this close, in its lane. */
  AGGRO: 270,
  /** ...and on an enemy tower or keep this close. */
  SIEGE_AGGRO: 300,
  /** Lane fights resolve far faster than the battle's long shield-wall grind. */
  LANE_MELEE_MULT: 6,
  /** Lane battalions run once they're down to this share of their men (remnants don't linger). */
  LANE_ROUT_SHARE: 0.4,
  /** Routed men who make it this far home (or run this long) leave the field. */
  FLEE_TIME: 14,

  // --- Commanders ---
  HERO_START: 10,
  HERO_MAX: 45,
  RESPAWN_BASE: 5,
  RESPAWN_PER_LEVEL: 1.2,
  /** However high a commander's level, he is back in the saddle within this long (s). */
  RESPAWN_MAX: 28,

  // --- Abilities ---
  /** Charge!: the horn sounds — faster, harder-hitting and more terrifying for a few seconds. */
  CHARGE_TIME: 5,
  CHARGE_COOLDOWN: 26,
  CHARGE_SPEED: 1.2,
  CHARGE_IMPACT: 1.5,
  CHARGE_SHOCK: 1.6,
  /** Rally: our foot near the commander take heart (full morale) and fight harder for a while. */
  RALLY_RADIUS: 320,
  RALLY_TIME: 9,
  RALLY_COOLDOWN: 40,
  RALLY_MELEE: 1.6,

  // --- Horse archers ---
  HA_RANGE: 230,
  /** Arrow damage multipliers against foot and against horsemen. */
  HA_POWER_FOOT: 4,
  HA_POWER_RIDER: 0.6,

  // --- Fog of war ---
  /** Vision is worked out on a grid of this cell size, this often (s). */
  FOG_CELL: 40,
  FOG_INTERVAL: 0.2,
  SIGHT_FOOT: 300,
  SIGHT_HERO: 400,
  /** Beyond the range of their walls, towers and keeps see this much further. */
  SIGHT_TOWER: 60,
  /** Into the woods you see only this far: ambushes wait in the trees. */
  SIGHT_WOODS: 150,

  // --- Experience ---
  /** Enemies who fall within this distance of your squadron give you experience. */
  XP_RANGE: 480,
  XP_FOOT: 0.5,
  XP_RIDER: 5,
  XP_ROUT: 4,
  XP_HERO_KILL: 40,
  XP_TOWER: 45,
} as const;

/** Experience needed to go from `level` to the next. */
export function xpToNext(level: number): number {
  return 25 + 10 * (level - 1);
}

export function enemyOf(team: Team): Team {
  return team === 'blue' ? 'red' : 'blue';
}
