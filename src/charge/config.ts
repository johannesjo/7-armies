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
  CANTER_SPEED: 135,
  GALLOP_SPEED: 215,
  ACCEL: 260,
  GALLOP_ACCEL: 320,
  COAST_DECEL: 170,
  /** Turn rate (rad/s) when slow vs. at full gallop — wide arcs at speed. */
  TURN_RATE_SLOW: 5.6,
  TURN_RATE_FAST: 2.9,
  /** Followers close the gap to their slot at this rate (1/s), along their heading. */
  FOLLOW_GAIN: 3,
  /** Followers can ride at most this much faster than the leader to regain their place... */
  FOLLOW_CATCH_UP: 1.06,
  /**
   * ...plus up to this much (world units/s) when the leader rides slowly, fading to
   * nothing at full gallop: stragglers close up fast at a walk, never at the charge.
   */
  FOLLOW_CATCH_UP_SLOW: 95,
  /**
   * Followers steer toward a point this far ahead along their own lane (world units),
   * so they keep to their lane round a wheel instead of cutting the corner.
   */
  FOLLOW_LOOKAHEAD: 10,
  /** Horses rein in much harder than they can speed up. */
  FOLLOW_BRAKE: 420,
  /** Followers turn a little more nimbly than the leader at the same speed. */
  FOLLOWER_AGILITY: 1.15,
  /**
   * Largest squadron you can command (allied troops join up to this). The leader rides
   * at the point and each row behind holds one more, so a full squadron makes a
   * complete wedge: 1 + 2 + ... + 9 = 45 (eight rows behind the leader).
   */
  MAX_SQUAD: 45,
  /** Ride this close to an allied troop to take it under command. */
  JOIN_RADIUS: 34,
  MUSTER_FIRST: 20,
  MUSTER_INTERVAL: 42,
  MUSTER_SIZE: 6,
  /** Mustered troops wait this long at camp for you before riding out alone. */
  MUSTER_WAIT: 16,
  MAX_ALLIED_SQUADS: 2,
  /** AI squadrons break off when down to this many riders. */
  AI_RETREAT_AT: 2,
  /** Raiders turn on enemy horse that comes this close. */
  RAIDER_ENGAGE_SQUAD: 230,
  GUARD_RADIUS: 380,
  GUARD_LEASH: 620,
  KNIGHT_HP: 32,
  /** Knights are worth this many times an infantryman. */
  KNIGHT_SCORE_MULT: 2,
  /** Damage and shock multiplier for AI cavalry against infantry. */
  AI_INFANTRY_MULT: 0.25,


  // --- Charging ---
  /** Above this speed riders trample instead of fencing. */
  CHARGE_MIN_SPEED: 85,
  FLANK_MULT: 2,
  REAR_MULT: 3,
  // --- Physics ---
  /** Body masses; a horse and rider weighs as much as five footmen. */
  MASS: { swordsman: 1, pikeman: 1.15, archer: 0.8, cavalry: 5.5 } as Record<UnitType, number>,
  KNIGHT_MASS: 6.2,
  /** At full gallop a horse hits as if this much heavier (x1 + bonus), ramping up from a canter. */
  CHARGE_WEIGHT_BONUS: 1.2,
  /** Bounciness of collisions (0 = dead stop, 1 = billiard balls). */
  RESTITUTION: 0.15,
  /** Infantry bracing against a charge, as a multiple of their mass, by the side they are hit on. */
  BRACE: { front: 4, pike: 7, flank: 2, rear: 1 },
  /** Effective mass of a man lying on the ground. */
  DOWN_MASS: 0.6,
  /** A charged man's velocity change below this does nothing. */
  IMPACT_DV_MIN: 50,
  /** Damage per unit of velocity change above IMPACT_DV0. */
  IMPACT_DV0: 55,
  IMPACT_DAMAGE_K: 0.11,
  /** Velocity change that knocks a man off his feet, and how long he stays down. */
  KNOCK_DV: 80,
  DOWN_TIME: 1.4,
  DOWN_TIME_JITTER: 1.2,
  /** Rider damage per unit of impulse when riding onto braced pikes. */
  PIKE_RIDER_DAMAGE: 0.05,
  /**
   * The pike hedge: a braced pikeman strikes a horseman charging at his front from
   * this far beyond arm's length (world units), within this half-angle of where he
   * faces (rad), for this much damage at full gallop. Each pike strikes once per
   * PIKE_HEDGE_COOLDOWN (s), and the horse balks: its speed is cut to this share.
   * Ride at a pike block's front and the charge dies on its points.
   */
  PIKE_REACH: 14,
  PIKE_HEDGE_ARC: 0.55,
  PIKE_HEDGE_DAMAGE: 16,
  PIKE_HEDGE_COOLDOWN: 0.9,
  PIKE_BALK: 0.55,
  /** Men colliding faster than this were thrown — the crash hurts. */
  THROWN_REL: 80,
  SECONDARY_DV0: 60,
  /** A comrade crashing into you knocks you over more easily than a blow you braced for. */
  SECONDARY_KNOCK_DV: 50,
  SECONDARY_DAMAGE_K: 0.07,
  /** How long collisions caused by a man you sent flying still count as yours (s). */
  THROWN_CREDIT: 0.9,
  /** How long a felled man's body keeps flying and bowling others over (s). */
  FLYING_TIME: 0.6,
  // --- Cavalry against cavalry ---
  /** A follower within this distance of his place counts toward the wedge's cohesion. */
  COHESION_DIST: 9,
  /** A fully tight wedge hits other horsemen this much heavier (x1 + weight). */
  COHESION_WEIGHT: 0.6,
  /** Clash shock dealt to an AI squadron by the side it was hit on, and per rider it loses. */
  CLASH_SHOCK: { front: 0.25, flank: 1.2, rear: 2.2 },
  LOSS_SHOCK: 0.6,
  /** Shock that breaks an AI squadron, how fast shock fades, and how long it stays scattered. */
  SQUAD_BREAK_SHOCK: 2.5,
  SQUAD_SHOCK_DECAY: 0.5,
  SQUAD_BROKEN_TIME: 3.5,
  /** Points for a knight your own troops kill while he hunts you, relative to killing him yourself. */
  LURE_SCORE_MULT: 0.75,
  /**
   * A charging rider strikes an enemy horseman within this half-angle of where he faces
   * (rad). Damage: RIDER_STRIKE x speed (vs gallop) x wedge bonus x side (front 1,
   * flank 2, rear 3) — at full gallop a rear strike unhorses, head-on takes two.
   */
  STRIKE_CONE: 0.9,
  RIDER_STRIKE: 16,
  STRIKE_WEDGE_BONUS: 0.5,
  STRIKE_COOLDOWN: 0.35,
  /** Warn when an enemy horseman charging at you is behind you within this distance... */
  TAIL_WARN_DIST: 300,
  /** ...at most this often (s). */
  TAIL_WARN_COOLDOWN: 4,
  /** Sword-fighting from the saddle reaches this far round from the front (rad), not behind. */
  SADDLE_ARC: 1.9,
  /** How hard a footman can push to regain his place (world units/s²). */
  INFANTRY_ACCEL: 220,
  /** Sliding friction for thrown and fallen men (1/s). */
  GROUND_FRICTION: 5,
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
  /** A footman strikes only enemies within this half-angle of where he faces (rad)... */
  INFANTRY_ARC: 0.9,
  /** ...and turns no faster than this (rad/s) — about a second for a full about-face. */
  INFANTRY_TURN_RATE: 3,
  /** Infantry swarming a stalled rider land far more often than in the shield-wall grind. */
  VS_RIDER_HIT_CHANCE: 0.5,
  VS_RIDER_DAMAGE_MULT: 1.4,
  /** Team-wide melee multipliers: the blue line is slowly losing without help. */
  TEAM_MELEE_MULT: { blue: 0.78, red: 1 },
  FLEE_SPEED: 46,
  ADVANCE_SPEED: 14,
  /** Soldiers point their weapons at enemies within this distance. */
  AIM_RADIUS: 70,
  /** Each soldier stands up to this far (world units) off his exact slot. */
  RANK_JITTER: 3.4,
  MARCH_SPEED: 30,
  MARCH_DISTANCE: 260,
  BATTALION_TURN_RATE: 0.4,

  // --- The battle on its own ---
  /** Lines in melee shove: the stronger side gains ground at up to this speed. */
  PUSH_SPEED: 7,
  PUSH_RANGE: 150,
  PUSH_WEIGHT: { swordsman: 1, pikeman: 1.15, archer: 0.5, cavalry: 1.5 } as Record<UnitType, number>,
  /** Ranks spread by up to this fraction as morale fails. */
  LOOSEN: 0.35,
  /** How often wounded men rotate out of the front rank (s). */
  ROTATE_INTERVAL: 2.4,
  /** Archers fall back from enemy foot within this distance, up to ARCHER_FALLBACK from their post. */
  ARCHER_SKIRMISH: 140,
  ARCHER_FALLBACK: 260,
  ARCHER_RETREAT_SPEED: 32,
  /** A routed line pulls up the nearest reserve within this distance. */
  PLUG_RANGE: 700,

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

  // --- Army morale ---
  /**
   * An army's morale runs out once this share of its foot is dead or fled. Blue holds
   * out a little longer so the battle lasts a few minutes without you.
   */
  ARMY_BREAK: { blue: 0.8, red: 0.8 },
  /** Below this army morale (0..1) the army wavers: every battalion slowly loses heart... */
  ARMY_WAVER: 0.3,
  /** ...by up to this much morale per second as army morale nears zero, and stops recovering. */
  ARMY_DRAIN: 2.5,
  /** When morale runs out the army collapses: the rest break one by one over this long (s). */
  ARMY_COLLAPSE_TIME: 14,
  ARMY_COLLAPSE_MIN: 1.2,

  // --- The red general ---
  GENERAL_HP: 45,
  GENERAL_SCORE: 1000,
  /** His fall counts toward the red army breaking as if this share of it had fled... */
  GENERAL_ARMY_SHOCK: 0.1,
  /** ...and shakes every red battalion by this much morale. */
  GENERAL_MORALE_SHOCK: 25,
  /** He rides away from enemy horsemen that come this close. */
  GENERAL_FLEE_RADIUS: 240,

  // --- Rally camps, one behind each wing of the blue line ---
  CAMPS: [{ x: 420, y: 1200 }, { x: 1980, y: 1200 }] as readonly { x: number; y: number }[],
  CAMP_R: 95,
  /**
   * Pit stops: each camp's garrison gains a fresh rider this often (s) while you are
   * away, up to GARRISON_MAX. Ride through the camp to take them all at once — your
   * riders are healed to full the moment you enter.
   */
  GARRISON_INTERVAL: 7,
  GARRISON_MAX: 8,
  GARRISON_START: 4,
  CAMP_HEAL: 12,

  // --- Scoring ---
  KILL_SCORE: 10,
  ROUT_SCORE: 250,
  COMBO_WINDOW: 2.2,
  ROUT_CREDIT_WINDOW: 8,
} as const;

export type AttackSide = 'front' | 'flank' | 'rear';
