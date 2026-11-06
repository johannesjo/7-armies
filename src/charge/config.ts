import { UnitType } from '../types';

/** Tunables for the cavalry action mode. World units match the tactics map scale. */
export const CHARGE = {
  WORLD_W: 2400,
  WORLD_H: 1500,
  FRONT_Y: 760,

  // --- Player squadron ---
  SQUAD_SIZE: 12,
  RIDER_RADIUS: 5.5,
  RIDER_HP: 30,
  CANTER_SPEED: 125,
  GALLOP_SPEED: 210,
  ACCEL: 160,
  GALLOP_ACCEL: 240,
  COAST_DECEL: 110,
  /** Turn rate (rad/s) when slow vs. at full gallop — wide arcs at speed. */
  TURN_RATE_SLOW: 4.4,
  TURN_RATE_FAST: 2.1,
  FOLLOW_GAIN: 3.2,
  FOLLOW_ACCEL: 520,
  FOLLOWER_TURN_RATE: 9,

  STAMINA_MAX: 100,
  STAMINA_DRAIN: 14,
  STAMINA_REGEN: 13,
  STAMINA_MIN_TO_GALLOP: 12,

  // --- Charging ---
  /** Above this speed riders trample instead of fencing. */
  CHARGE_MIN_SPEED: 85,
  IMPACT_DAMAGE: 9,
  FLANK_MULT: 2,
  REAR_MULT: 3,
  IMPACT_SLOWDOWN: 0.95,
  PIKE_FRONT_SLOWDOWN: 0.62,
  PIKE_FRONT_DAMAGE: 7,
  TRAMPLE_IMMUNITY: 0.4,
  KNOCKBACK_SIDE: 110,
  KNOCKBACK_FORWARD: 45,
  RIDER_MELEE_DAMAGE: 4,
  RIDER_MELEE_COOLDOWN: 0.7,
  RIDER_REACH: 6,

  // --- Infantry ---
  INFANTRY_SPEED: { swordsman: 42, pikeman: 36, archer: 46, cavalry: 120 } as Record<UnitType, number>,
  INFANTRY_HP: { swordsman: 12, pikeman: 12, archer: 7, cavalry: 30 } as Record<UnitType, number>,
  INFANTRY_RADIUS: { swordsman: 5, pikeman: 4.5, archer: 4, cavalry: 5.5 } as Record<UnitType, number>,
  MELEE_DAMAGE: { swordsman: 2.2, pikeman: 1.8, archer: 1, cavalry: 4 } as Record<UnitType, number>,
  /** Pikes facing a rider deal extra damage. */
  PIKE_VS_RIDER_MULT: 2,
  MELEE_COOLDOWN_MIN: 1.1,
  MELEE_COOLDOWN_MAX: 2.0,
  MELEE_HIT_CHANCE: 0.1,
  MELEE_REACH: 5,
  /** Infantry swarming a stalled rider land far more often than in the shield-wall grind. */
  VS_RIDER_HIT_CHANCE: 0.5,
  VS_RIDER_DAMAGE_MULT: 1.4,
  /** Team-wide melee multipliers: the blue line is slowly losing without help. */
  TEAM_MELEE_MULT: { blue: 0.85, red: 1 },
  FLEE_SPEED: 58,
  ADVANCE_SPEED: 14,
  MARCH_SPEED: 30,
  MARCH_DISTANCE: 260,
  BATTALION_TURN_RATE: 0.4,

  // --- Archers ---
  ARCHER_RANGE: 480,
  ARCHER_MIN_RANGE: 95,
  ARROW_SPEED: 260,
  ARROW_MIN_FLIGHT: 1.0,
  ARROW_MAX_FLIGHT: 2.1,
  VOLLEY_INTERVAL: 5.2,
  VOLLEY_JITTER: 1.4,
  VOLLEY_SPREAD_PLAYER: 34,
  VOLLEY_SPREAD_LINE: 48,
  ARROW_HIT_RADIUS: 5,
  ARROW_DAMAGE_RIDER: 9,
  ARROW_DAMAGE_INFANTRY: 1.2,
  /** Volleys at the enemy line come slower than volleys at the squadron. */
  LINE_VOLLEY_INTERVAL_MULT: 1.8,

  // --- Reserves that hunt the squadron ---
  RESERVE_AWARE: 420,
  RESERVE_LEASH: 280,
  RESERVE_SPEED: 26,
  RESERVE_TURN_RATE: 0.55,

  // --- Morale ---
  /** A battalion routs after losing roughly this share of its men to frontal attrition. */
  MORALE_LOSS_SHARE: 0.75,
  SIDE_MORALE_FACTOR: { front: 1, flank: 1.25, rear: 1.5 },
  IMPACT_SHOCK: { front: 0.2, flank: 0.8, rear: 1.5 },
  MORALE_RECOVERY: 3,
  /** Recovered morale is capped by losses: cap = BASE + (1 - BASE) * share alive. */
  MORALE_CAP_BASE: 40,
  MORALE_RECOVERY_DELAY: 4,
  ROUT_STRENGTH: 0.2,
  ROUT_CASCADE_RADIUS: 220,
  ROUT_CASCADE: 10,

  // --- Rally camp (bottom-left, behind the blue line) ---
  CAMP_X: 330,
  CAMP_Y: 1270,
  CAMP_R: 95,
  RALLY_INTERVAL: 2.2,
  CAMP_HEAL: 12,
  CAMP_STAMINA_MULT: 3,

  // --- Scoring ---
  KILL_SCORE: 10,
  ROUT_SCORE: 250,
  COMBO_WINDOW: 2.2,
  ROUT_CREDIT_WINDOW: 8,
} as const;

export type AttackSide = 'front' | 'flank' | 'rear';
