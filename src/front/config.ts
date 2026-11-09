import { CHARGE as C } from '../charge/config';

/**
 * Tunables for the front: two commanders over one great battle on the cavalry
 * battle's field (blue holds the south, red the north).
 */
export const FRONT = {
  WORLD_W: C.WORLD_W,
  WORLD_H: C.WORLD_H,
  FRONT_Y: C.FRONT_Y,

  // --- The armies (the same on both sides) ---
  LINE_COUNT: 9,
  LINE_GAP: 150,
  LINE_MEN: 24,
  /** The lines start this far either side of the front (they close in the first seconds). */
  LINE_START: 70,
  ARCHERS: 3,
  ARCHER_MEN: 18,
  RESERVE_MEN: 20,
  /**
   * Commanders' trample and morale shock against foot, as a share of their full force:
   * at full force one squadron routs an army alone within a minute. Here they tip the
   * battle; the lines decide it.
   */
  HERO_IMPACT: 0.25,
  HERO_SHOCK: 0.25,
  /** ...and horse archers' arrows against foot (damage and morale shock). */
  HERO_ARROWS: 0.3,
  /** Experience from foes falling near you, as a share of the lanes' (far more fall here). */
  XP_SCALE: 0.3,
  /** Foot grind a little slower than the battle's (and the same on both sides): matches of ~6-13 min. */
  MELEE_MULT: 0.7,

  /** The line is read in three sectors, split at these x (left | centre | right). */
  SECTOR_X: [1000, 1400] as readonly number[],
  SECTOR_CENTRE: [700, 1200, 1700] as readonly number[],

  // --- Reinforcement columns ---
  /** Every this often (s) each army marches a column in from its rear edge, to its weakest sector. */
  COLUMN_FIRST: 30,
  COLUMN_INTERVAL: 30,
  COLUMN_SWORDS: 20,
  COLUMN_PIKES: 16,
  /** Columns grow by this many men every COLUMN_GROWTH_EVERY columns (up to COLUMN_GROWTH_MAX). */
  COLUMN_GROWTH: 2,
  COLUMN_GROWTH_EVERY: 3,
  COLUMN_GROWTH_MAX: 8,
  /** Where a column halts, behind its own line (distance from the front). */
  COLUMN_STAGE: 260,
  /** No more columns while an army has this many battalions standing. */
  MAX_BATTALIONS: 26,

  // --- Breaking an army ---
  /** An army breaks once this share of all the foot it has fielded is dead or fled. */
  ARMY_BREAK: 0.8,
  /** A commander slain by the enemy commander counts as this share lost — and shakes every battalion. */
  HERO_SLAIN_LOSS: 0.04,
  HERO_SLAIN_MORALE: 12,
  /** From this time (s) both armies tire: their loss creeps up by FATIGUE every FATIGUE_SPAN s, so even battles end. */
  FATIGUE_START: 540,
  FATIGUE_SPAN: 300,
  FATIGUE: 0.12,

  // --- Commanders' homes: behind the middle of each army ---
  HOME: { blue: { x: 1200, y: C.WORLD_H - 120 }, red: { x: 1200, y: 120 } },
} as const;
