import { Team, UnitType, Vec2 } from '../types';
import { CHARGE as C, AttackSide } from './config';
import { SpatialGrid } from './spatial';

export interface ChargeInput {
  /** Desired travel direction in world space; magnitude 0..1 (joystick deflection). */
  dirX: number;
  dirY: number;
  /** Spur the horses into a full gallop. */
  gallop: boolean;
}

export const NO_INPUT: ChargeInput = { dirX: 0, dirY: 0, gallop: false };

export type Role = 'front' | 'archer' | 'reserve';

export interface Soldier {
  id: number;
  team: Team;
  type: UnitType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Body mass: a horse and rider outweighs a footman five times over. */
  mass: number;
  /** Seconds left lying on the ground after being knocked down (0 = on his feet). */
  down: number;
  /** Until this sim time, collisions this body causes count as yours (thrown by your charge). */
  thrownByPlayer: number;
  facing: number;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
  fleeing: boolean;
  bat: Battalion | null;
  attackTimer: number;
  /** Player squadron member. */
  rider: boolean;
  /** Scalar ground speed (riders). */
  speed: number;
  /** Lateral drift for fleeing soldiers so routs fan out. */
  fleeDrift: number;
  /** Cavalry squadron this rider belongs to. */
  squad: Squadron | null;
  /** Sim time of the last blow struck (hit or miss), for attack animations. */
  lastAttack: number;
  /** Personal offset from the formation slot, so ranks look like men, not tiles. */
  jx: number;
  jy: number;
  /** Direction to the nearest enemy within reach (NaN if none) — where weapons point. */
  aim: number;
  /** Distance to that enemy. */
  aimDist: number;
  aimTimer: number;
}

/** Who controls a squadron: the player, or one of the AI behaviours. */
export type SquadAI = 'player' | 'raider' | 'guard' | 'hunter' | 'general' | 'garrison';
export type SquadPhase = 'muster' | 'approach' | 'charge' | 'retreat' | 'idle' | 'broken';

export interface Squadron {
  id: number;
  team: Team;
  ai: SquadAI;
  /** Riders in command order; riders[0] leads. */
  riders: Soldier[];
  initial: number;
  galloping: boolean;
  home: Vec2;
  phase: SquadPhase;
  phaseTimer: number;
  targetBat: Battalion | null;
  targetSquad: Squadron | null;
  /** Where a charge through the target exits. */
  chargeExit: Vec2 | null;
  /** Share of followers close to their place in the wedge (1 = tight, 0 = strung out). */
  cohesion: number;
  /** Shock from losing clashes; enough of it breaks an AI squadron. Decays over time. */
  shock: number;
  /** Where a broken squadron flees from. */
  fleeFrom: Vec2 | null;
  /** Guards: how far from their post they ride out at intruders. */
  guardRadius: number;
  /** Guards escorting another squad: their post moves with it. */
  ward: Squadron | null;
  /** The leader's recent path; followers ride along it, offset into their lane. */
  trail: TrailPoint[];
  /** Distance the leader has ridden (the arc position of the newest trail point). */
  trailS: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  /** Direction of travel here. */
  h: number;
  /** Arc length along the path. */
  s: number;
}

/** Riders are kept this far inside the field's edge. */
const EDGE = 12;
/** Within this distance of the edge, steering bends away from it. */
const WALL_SOFT = 70;

/** Trail points are laid every this many world units. */
const TRAIL_STEP = 3;
/** How much path to remember behind the leader. */
const TRAIL_KEEP = 260;

export interface SquadSpec {
  team: Team;
  ai: SquadAI;
  x: number;
  y: number;
  facing: number;
  count: number;
  /** Seconds to wait (mustering) before riding out. */
  muster?: number;
  /** Guards: how far from their post they ride out at intruders (default GUARD_RADIUS). */
  guardRadius?: number;
  /** Guards: escort the first squad with this AI on our side (e.g. the general) instead of a fixed post. */
  ward?: SquadAI;
}

export interface Battalion {
  id: number;
  team: Team;
  type: UnitType;
  role: Role;
  x: number;
  y: number;
  facing: number;
  home: Vec2;
  homeFacing: number;
  cols: number;
  spacing: number;
  /** Formation slots, row-major, row 0 = front rank. */
  grid: (Soldier | null)[];
  initial: number;
  morale: number;
  routed: boolean;
  volleyTimer: number;
  sinceShock: number;
  engagedTimer: number;
  lastPlayerHit: number;
  /** Paces how often wounded men in the front rank swap with fresh men behind. */
  rotateTimer: number;
  /** Sim time this battalion gives up as its army collapses (Infinity = not yet). */
  breakAt: number;
}

export interface Arrow {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  flight: number;
  team: Team;
  volley: number;
}

export interface Volley {
  id: number;
  team: Team;
  x: number;
  y: number;
  radius: number;
  t: number;
  flight: number;
  atPlayer: boolean;
}

export type SimEvent =
  | { type: 'impact'; x: number; y: number; angle: number; side: AttackSide; pike: boolean }
  | { type: 'hit'; x: number; y: number; angle: number; team: Team; damage: number; id: number }
  | { type: 'kill'; x: number; y: number; angle: number; team: Team; id: number; byPlayer: boolean; side: AttackSide; points: number }
  | { type: 'volley'; id: number; team: Team; x: number; y: number; radius: number; flight: number; atPlayer: boolean }
  | { type: 'arrow-land'; x: number; y: number; angle: number; hit: boolean; team: Team }
  | { type: 'rider-hit'; x: number; y: number; id: number; damage: number; mine: boolean }
  | { type: 'rider-down'; x: number; y: number; angle: number; id: number; wasLeader: boolean; team: Team; mine: boolean; byPlayer: boolean; points: number; lured: boolean }
  | { type: 'join'; x: number; y: number; count: number }
  | { type: 'squad-break'; x: number; y: number; team: Team; byPlayer: boolean }
  | { type: 'muster'; x: number; y: number; count: number }
  /** A fresh rider joined a camp's garrison. */
  | { type: 'garrison'; x: number; y: number; id: number }
  /** The squadron rode into a camp: every rider healed to full. */
  | { type: 'pit-stop'; x: number; y: number; healed: number }
  | { type: 'rout'; x: number; y: number; team: Team; byPlayer: boolean; type2: UnitType }
  | { type: 'combo'; count: number }
  | { type: 'wave'; index: number; battalions: number; x: number; y: number }
  /** An army has lost heart (morale under ARMY_WAVER) — or broken and fled outright. */
  | { type: 'army-waver'; team: Team }
  | { type: 'army-break'; team: Team; x: number; y: number }
  /** The red general has been cut down. */
  | { type: 'general-down'; x: number; y: number; byPlayer: boolean; points: number }
  /** Hunting knights leave their muster and ride for the player's banner. */
  | { type: 'hunt'; x: number; y: number; count: number };

export type Outcome = 'playing' | 'victory' | 'defeat';

export interface BattalionSpec {
  team: Team;
  type: UnitType;
  role: Role;
  x: number;
  y: number;
  facing: number;
  count: number;
  cols: number;
}

export interface Wave {
  time: number;
  specs: BattalionSpec[];
  squads?: SquadSpec[];
}

/** Deterministic PRNG so tests and tuning runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(current: number, desired: number, maxStep: number): number {
  const d = angleDiff(desired, current);
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

/**
 * Which side of the victim is hit, judged by the attacker's travel direction
 * against the direction the victim is facing. Riding the same way they face = rear.
 */
export function attackSide(attackHeading: number, victimFacing: number): AttackSide {
  const dot = Math.cos(attackHeading - victimFacing);
  if (dot >= 0.5) return 'rear';
  if (dot <= -0.5) return 'front';
  return 'flank';
}

export function sideMultiplier(side: AttackSide): number {
  return side === 'rear' ? C.REAR_MULT : side === 'flank' ? C.FLANK_MULT : 1;
}

/** Wedge slots behind the leader (local frame: +x forward). */
export function wedgeSlots(n: number): Vec2[] {
  const slots: Vec2[] = [];
  for (let row = 1; slots.length < n; row++) {
    const count = row + 1;
    for (let i = 0; i < count && slots.length < n; i++) {
      slots.push({ x: -row * 13, y: (i - (count - 1) / 2) * 12 });
    }
  }
  return slots;
}

export class ChargeSim {
  soldiers: Soldier[] = [];
  battalions: Battalion[] = [];
  /** All cavalry squadrons on the field, the player's included. */
  squadrons: Squadron[] = [];
  /** The squadron you command (null in headless battle runs). */
  player: Squadron | null = null;
  arrows: Arrow[] = [];
  volleys: Volley[] = [];
  events: SimEvent[] = [];

  time = 0;
  score = 0;
  kills = 0;
  routsByPlayer = 0;
  ridersLost = 0;
  ridersJoined = 0;
  /** Men knocked down by comrades thrown into them (bowling). */
  bowled = 0;
  /** Enemy knights killed by your infantry or archers while they hunted you. */
  lured = 0;
  /** The freshly killed, still flying from the blow that felled them — they bowl over the living. */
  flying: { body: Soldier; t: number }[] = [];
  combo = 0;
  bestCombo = 0;
  outcome: Outcome = 'playing';
  outcomeReason = '';
  inCamp = false;
  private musterCount = 0;

  /** Reinforcement waves not yet on the field. */
  pendingWaves: Wave[] = [];
  /** Share of each army's foot dead or fled (plus the general's fall, for red). */
  readonly armyLoss: Record<Team, number> = { blue: 0, red: 0 };
  /** The army's morale has run out and it is collapsing, battalion by battalion. */
  readonly armyBroken: Record<Team, boolean> = { blue: false, red: false };
  /** Morale each battalion of a wavering army loses per second. */
  private readonly armyDrain: Record<Team, number> = { blue: 0, red: 0 };
  private readonly armyWavered: Record<Team, boolean> = { blue: false, red: false };
  generalFallen = false;
  generalKilledByPlayer = false;
  wavesArrived = 0;
  private comboTimer = 0;
  /** Each camp's garrison troop (null when empty) and the timer to its next fresh rider. */
  private readonly camps: { x: number; y: number; garrison: Squadron | null; timer: number }[] = [];
  private musterTimer: number = C.MUSTER_FIRST;
  private readonly muster: boolean;
  private redSquadsSpawned = 0;
  private nextId = 1;
  private nextVolley = 1;
  private readonly rand: () => number;
  private readonly grid = new SpatialGrid<Soldier>(C.WORLD_W, C.WORLD_H, 24);
  private readonly near: Soldier[] = [];
  private readonly slots = wedgeSlots(C.MAX_SQUAD);

  constructor(specs: BattalionSpec[], opts: {
    seed?: number;
    squad?: { x: number; y: number; facing: number; count?: number } | null;
    waves?: Wave[];
    /** AI cavalry on the field from the start. */
    squads?: SquadSpec[];
    /** Muster fresh allied troops at the camp over time (default: when there is a player). */
    muster?: boolean;
  } = {}) {
    this.rand = mulberry32(opts.seed ?? 1);
    this.muster = opts.muster ?? opts.squad !== null;
    for (const spec of specs) this.addBattalion(spec);
    this.pendingWaves = [...(opts.waves ?? [])].sort((a, b) => a.time - b.time);
    if (opts.squad !== null) {
      const sq = opts.squad ?? { x: C.CAMPS[0].x + 60, y: C.CAMPS[0].y - 80, facing: -Math.PI / 4 };
      this.player = this.addSquad({ team: 'blue', ai: 'player', x: sq.x, y: sq.y, facing: sq.facing, count: sq.count ?? C.SQUAD_SIZE });
    }
    for (const spec of opts.squads ?? []) this.addSquad(spec);
    // Each camp starts with a garrison waiting (only when camps are in play).
    for (const c of C.CAMPS) {
      const camp = { x: c.x, y: c.y, garrison: null as Squadron | null, timer: C.GARRISON_INTERVAL };
      this.camps.push(camp);
      if (this.muster) for (let i = 0; i < C.GARRISON_START; i++) this.growGarrison(camp);
    }
  }

  /** Your squadron's riders in command order. */
  get riders(): Soldier[] {
    return this.player?.riders ?? [];
  }

  get leader(): Soldier | null {
    return this.riders[0] ?? null;
  }

  get galloping(): boolean {
    return this.player?.galloping ?? false;
  }

  /** All red soldiers in the battle, including reinforcements still on the march. */
  get initialRed(): number {
    return this.battalions.filter(b => b.team === 'red').reduce((s, b) => s + b.initial, 0)
      + this.redSquadsSpawned + this.pendingRed;
  }

  private get pendingRed(): number {
    let n = 0;
    for (const w of this.pendingWaves) {
      for (const sp of w.specs) if (sp.team === 'red') n += sp.count;
      for (const sq of w.squads ?? []) if (sq.team === 'red') n += sq.count;
    }
    return n;
  }

  /** An army's heart, 1 = fresh, 0 = it breaks and flees. */
  armyMorale(team: Team): number {
    return clamp01(1 - this.armyLoss[team] / C.ARMY_BREAK[team]);
  }

  /** The red general on the field, or null once he has fallen (or there is none). */
  get general(): Soldier | null {
    for (const sq of this.squadrons) if (sq.ai === 'general' && sq.riders[0]) return sq.riders[0];
    return null;
  }

  /** Red soldiers still standing in formation (not routed), plus those yet to arrive. */
  get redStanding(): number {
    let n = this.pendingRed;
    for (const b of this.battalions) if (b.team === 'red' && !b.routed) n += this.members(b).length;
    for (const sq of this.squadrons) if (sq.team === 'red') n += sq.riders.length;
    return n;
  }

  get blueLineStanding(): number {
    let n = 0;
    for (const b of this.battalions) if (b.team === 'blue' && b.role === 'front' && !b.routed) n += this.members(b).length;
    return n;
  }

  get blueLineInitial(): number {
    return this.battalions.filter(b => b.team === 'blue' && b.role === 'front').reduce((s, b) => s + b.initial, 0);
  }

  members(b: Battalion): Soldier[] {
    const out: Soldier[] = [];
    for (const s of b.grid) if (s && s.alive) out.push(s);
    return out;
  }

  private addBattalion(spec: BattalionSpec): Battalion {
    const spacing = spec.type === 'archer' ? 10 : 11;
    const rows = Math.ceil(spec.count / spec.cols);
    const bat: Battalion = {
      id: this.nextId++,
      team: spec.team,
      type: spec.type,
      role: spec.role,
      x: spec.x,
      y: spec.y,
      facing: spec.facing,
      home: { x: spec.x, y: spec.y },
      homeFacing: spec.facing,
      cols: spec.cols,
      spacing,
      grid: new Array(rows * spec.cols).fill(null),
      initial: spec.count,
      morale: 100,
      routed: false,
      volleyTimer: 1.5 + this.rand() * C.VOLLEY_INTERVAL,
      sinceShock: 99,
      engagedTimer: 0,
      lastPlayerHit: -99,
      rotateTimer: this.rand() * C.ROTATE_INTERVAL,
      breakAt: Infinity,
    };
    for (let i = 0; i < spec.count; i++) {
      const p = this.slotPos(bat, i);
      const s = this.makeSoldier(spec.team, spec.type, p.x, p.y, spec.facing);
      s.bat = bat;
      s.attackTimer = this.rand() * C.MELEE_COOLDOWN_MAX;
      s.jx = (this.rand() - 0.5) * C.RANK_JITTER;
      s.jy = (this.rand() - 0.5) * C.RANK_JITTER;
      s.x += s.jx;
      s.y += s.jy;
      bat.grid[i] = s;
      this.soldiers.push(s);
    }
    this.battalions.push(bat);
    return bat;
  }

  private makeSoldier(team: Team, type: UnitType, x: number, y: number, facing: number): Soldier {
    return {
      id: this.nextId++,
      team, type, x, y,
      vx: 0, vy: 0,
      mass: C.MASS[type],
      down: 0,
      thrownByPlayer: -1,
      facing,
      hp: C.INFANTRY_HP[type],
      maxHp: C.INFANTRY_HP[type],
      radius: C.INFANTRY_RADIUS[type],
      alive: true,
      fleeing: false,
      bat: null,
      attackTimer: 0,
      rider: false,
      speed: 0,
      fleeDrift: 0,
      squad: null,
      lastAttack: -99,
      jx: 0,
      jy: 0,
      aim: NaN,
      aimDist: Infinity,
      aimTimer: 0,
    };
  }

  private addSquad(spec: SquadSpec): Squadron {
    const sq: Squadron = {
      id: this.nextId++,
      team: spec.team,
      ai: spec.ai,
      riders: [],
      initial: spec.count,
      galloping: false,
      home: { x: spec.x, y: spec.y },
      phase: spec.muster ? 'muster' : 'approach',
      phaseTimer: spec.muster ?? 0,
      targetBat: null,
      targetSquad: null,
      chargeExit: null,
      cohesion: 1,
      shock: 0,
      fleeFrom: null,
      guardRadius: spec.guardRadius ?? C.GUARD_RADIUS,
      ward: spec.ward ? this.squadrons.find(o => o.team === spec.team && o.ai === spec.ward) ?? null : null,
      trail: [],
      trailS: 0,
    };
    this.resetTrail(sq, spec.x, spec.y, spec.facing);
    for (let i = 0; i < spec.count; i++) {
      const slot = i === 0 ? { x: 0, y: 0 } : this.slots[Math.min(i - 1, this.slots.length - 1)];
      const p = rotate(slot, spec.facing);
      this.addRider(sq, spec.x + p.x, spec.y + p.y, spec.facing);
    }
    if (spec.ai === 'general') for (const r of sq.riders) r.hp = r.maxHp = C.GENERAL_HP;
    if (spec.team === 'red') this.redSquadsSpawned += spec.count;
    this.squadrons.push(sq);
    return sq;
  }

  private addRider(sq: Squadron, x: number, y: number, facing: number): Soldier {
    const r = this.makeSoldier(sq.team, 'cavalry', x, y, facing);
    r.rider = true;
    r.hp = r.maxHp = sq.team === 'red' ? C.KNIGHT_HP : C.RIDER_HP;
    r.mass = sq.team === 'red' ? C.KNIGHT_MASS : C.MASS.cavalry;
    r.radius = C.RIDER_RADIUS;
    r.squad = sq;
    sq.riders.push(r);
    this.soldiers.push(r);
    return r;
  }

  /** World position of formation slot i (row 0 is the front rank). */
  slotPos(b: Battalion, i: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const rows = Math.ceil(b.grid.length / b.cols);
    const col = i % b.cols;
    const row = Math.floor(i / b.cols);
    const sp = b.spacing * (b.routed ? 1 : this.looseness(b));
    const lx = ((rows - 1) / 2 - row) * sp;
    const ly = (col - (b.cols - 1) / 2) * sp;
    const c = Math.cos(b.facing), sn = Math.sin(b.facing);
    out.x = b.x + lx * c - ly * sn;
    out.y = b.y + lx * sn + ly * c;
    return out;
  }

  /** Scratch vector reused every step (avoids thousands of short-lived objects). */
  private readonly tmp: Vec2 = { x: 0, y: 0 };

  // ---------------------------------------------------------------------------

  step(dt: number, input: ChargeInput = NO_INPUT): void {
    this.events.length = 0;
    if (dt <= 0) return;
    this.time += dt;

    this.spawnWaves();
    this.updateMuster(dt);
    for (const sq of this.squadrons) {
      if (sq.riders.length === 0) continue;
      this.steerSquad(sq, dt, sq === this.player ? input : this.aiInput(sq, dt));
    }
    this.checkJoins();
    this.updateBattalions(dt);
    this.moveInfantry(dt);
    this.rebuildGrid();
    this.updateAim(dt);
    this.riderCombat(dt);
    this.infantryCombat(dt);
    this.collide();
    this.updateFlying(dt);
    this.syncRiderSpeeds();
    this.updateArrows(dt);
    this.updateCamp(dt);
    this.updateMorale(dt);

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;

    // Drop the dead in place rather than allocating a fresh array every step.
    let live = 0;
    for (const s of this.soldiers) if (s.alive) this.soldiers[live++] = s;
    this.soldiers.length = live;
    this.squadrons = this.squadrons.filter(sq => sq === this.player || sq.riders.some(r => r.alive));
    this.checkOutcome();
  }

  private spawnWaves(): void {
    while (this.pendingWaves.length > 0 && this.pendingWaves[0].time <= this.time) {
      const wave = this.pendingWaves.shift()!;
      this.wavesArrived++;
      let x = 0, y = 0;
      for (const spec of wave.specs) {
        const b = this.addBattalion(spec);
        x += b.x; y += b.y;
      }
      for (const spec of wave.squads ?? []) {
        this.addSquad(spec);
        x += spec.x; y += spec.y;
      }
      const count = wave.specs.length + (wave.squads?.length ?? 0);
      const n = Math.max(1, count);
      this.events.push({ type: 'wave', index: this.wavesArrived, battalions: count, x: x / n, y: y / n });
    }
  }

  // --- Squadron ---------------------------------------------------------------

  private steerSquad(sq: Squadron, dt: number, input: ChargeInput): void {
    const L = sq.riders[0];
    if (!L) return;

    let mag = Math.min(1, Math.hypot(input.dirX, input.dirY));
    // Broken knights ride off the field, so they skip the wall-following.
    const leaving = sq.team === 'red' && sq.phase === 'retreat';
    const raw = Math.atan2(input.dirY, input.dirX);
    let desired = mag > 0.2 ? (leaving ? raw : this.awayFromWalls(L, raw)) : L.facing;
    // No stamina: the cost of a gallop is a wider turn (speed versus control).
    const wantsGallop = input.gallop;
    // Spurring with no direction charges straight ahead.
    if (wantsGallop && mag <= 0.2) { mag = 1; desired = L.facing; }

    let targetSpeed = 0;
    if (mag > 0.2) {
      const diff = angleDiff(desired, L.facing);
      L.facing = turnToward(L.facing, desired, this.turnRate(L.speed) * dt);
      targetSpeed = wantsGallop ? C.GALLOP_SPEED : C.CANTER_SPEED * Math.min(1, mag * 1.25);
      // Hauling the horse around sheds speed.
      if (Math.abs(diff) > 1.6) targetSpeed = Math.min(targetSpeed, C.CANTER_SPEED * 0.7);
    }

    if (L.speed < targetSpeed) {
      L.speed = Math.min(targetSpeed, L.speed + (wantsGallop ? C.GALLOP_ACCEL : C.ACCEL) * dt);
    } else {
      L.speed = Math.max(targetSpeed, L.speed - C.COAST_DECEL * dt);
    }

    sq.galloping = wantsGallop && L.speed > C.CANTER_SPEED;

    L.vx = Math.cos(L.facing) * L.speed;
    L.vy = Math.sin(L.facing) * L.speed;
    this.integrateRider(L, dt);

    this.extendTrail(sq);

    // Followers ride like horses too: each follows the leader's path, offset into
    // its lane, with its own heading, a turn rate that tightens only as it slows,
    // and little spare speed to regain its place. On a curve the outer lanes are
    // longer, so riders there fall behind; sharp turns string the squadron out.
    const maxFollow = Math.min(C.GALLOP_SPEED, Math.max(L.speed, C.CANTER_SPEED * 0.6)) * C.FOLLOW_CATCH_UP;
    // Spare speed for stragglers: plenty at a walk, none at full gallop.
    const spareMax = C.FOLLOW_CATCH_UP_SLOW * (1 - Math.min(1, L.speed / C.GALLOP_SPEED));
    let tight = 0;
    for (let i = 1; i < sq.riders.length; i++) {
      const f = sq.riders[i];
      // Steer toward a point a little ahead of the slot (smooth curves), but pace
      // ourselves against the slot itself.
      const aim = this.insideField(this.slotTarget(sq, i, C.FOLLOW_LOOKAHEAD + L.speed * 0.04));
      const slot = this.insideField(this.slotTarget(sq, i));
      const ax = aim.x - f.x, ay = aim.y - f.y;
      const dx = slot.x - f.x, dy = slot.y - f.y;
      const dist = Math.hypot(dx, dy);

      const desired = Math.hypot(ax, ay) > 3 ? Math.atan2(ay, ax) : aim.h;
      const diff = angleDiff(desired, f.facing);
      f.facing = turnToward(f.facing, desired, this.turnRate(f.speed) * C.FOLLOWER_AGILITY * dt);

      // Close the gap along our own heading; ease off if the slot has swung behind us.
      // The further out of place, the more spare speed (when the leader isn't flat out).
      const spare = Math.min(spareMax, dist * C.FOLLOW_GAIN);
      const maxF = Math.max(maxFollow, Math.min(C.GALLOP_SPEED, L.speed + spare));
      const along = dx * Math.cos(f.facing) + dy * Math.sin(f.facing);
      let target = L.speed + clamp(along * C.FOLLOW_GAIN, -L.speed, maxF - L.speed);
      // A rider that needs a sharp turn reins in to turn tighter — so the inside of a
      // wheel slows down while the outside has to ride hard to keep up. A straggler
      // paces that against his catch-up speed, not the leader's walk.
      const pace = Math.max(L.speed, Math.min(maxF, L.speed + spare));
      const sharp = Math.abs(diff);
      if (sharp > 0.35) target = Math.min(target, pace * Math.max(0.45, 1 - (sharp - 0.35) * 0.6));
      if (sharp > 1.8) target = Math.min(target, Math.max(pace * 0.55, C.CANTER_SPEED * 0.45));
      if (dist < 4 && L.speed < 5) target = 0;
      target = clamp(target, 0, maxF);
      if (f.speed < target) f.speed = Math.min(target, f.speed + C.GALLOP_ACCEL * 1.05 * dt);
      else f.speed = Math.max(target, f.speed - C.FOLLOW_BRAKE * dt);

      f.vx = Math.cos(f.facing) * f.speed;
      f.vy = Math.sin(f.facing) * f.speed;
      this.integrateRider(f, dt);
      if (dist < C.COHESION_DIST) tight++;
    }
    sq.cohesion = sq.riders.length > 1 ? tight / (sq.riders.length - 1) : 1;
    sq.shock = Math.max(0, sq.shock - C.SQUAD_SHOCK_DECAY * dt);
  }

  /** Pull a point inside the field, so lanes that run off the edge don't pin riders against it. */
  private insideField<T extends { x: number; y: number }>(p: T): T {
    const m = EDGE + 4;
    p.x = Math.max(m, Math.min(C.WORLD_W - m, p.x));
    p.y = Math.max(m, Math.min(C.WORLD_H - m, p.y));
    return p;
  }

  /** Lay a straight trail behind a (new) leader so the wedge forms up behind it. */
  private resetTrail(sq: Squadron, x: number, y: number, facing: number): void {
    sq.trail.length = 0;
    sq.trailS = 0;
    const cx = Math.cos(facing), cy = Math.sin(facing);
    for (let d = TRAIL_KEEP; d >= 0; d -= TRAIL_STEP * 4) {
      sq.trail.push({ x: x - cx * d, y: y - cy * d, h: facing, s: -d });
    }
  }

  /** Record the leader's path as it rides. */
  private extendTrail(sq: Squadron): void {
    const L = sq.riders[0];
    const last = sq.trail[sq.trail.length - 1];
    const d = Math.hypot(L.x - last.x, L.y - last.y);
    if (d < TRAIL_STEP) return;
    sq.trailS = last.s + d;
    sq.trail.push({ x: L.x, y: L.y, h: Math.atan2(L.y - last.y, L.x - last.x), s: sq.trailS });
    while (sq.trail.length > 2 && sq.trail[1].s < sq.trailS - TRAIL_KEEP) sq.trail.shift();
  }

  /**
   * Where follower `i` belongs: `back` units behind the leader along its path and
   * `side` units across it, plus `ahead` to lead the target a little.
   */
  slotTarget(sq: Squadron, i: number, ahead = 0): { x: number; y: number; h: number } {
    const L = sq.riders[0];
    const slot = this.slots[Math.min(i - 1, this.slots.length - 1)];
    const trail = sq.trail;
    const last = trail[trail.length - 1];
    // Path position: the newest trail point plus however far the leader is past it.
    const pastLast = Math.hypot(L.x - last.x, L.y - last.y);
    const want = last.s + pastLast + slot.x + ahead; // slot.x is negative (behind)
    let x: number, y: number, h: number;
    if (want >= last.s) {
      const k = want - last.s;
      h = pastLast > 0.5 ? Math.atan2(L.y - last.y, L.x - last.x) : L.facing;
      x = last.x + Math.cos(h) * k;
      y = last.y + Math.sin(h) * k;
    } else {
      let j = trail.length - 1;
      while (j > 0 && trail[j - 1].s > want) j--;
      const a = trail[Math.max(0, j - 1)], b = trail[j];
      if (want <= a.s) {
        // Older than we remember: extend straight back.
        h = a.h;
        x = a.x - Math.cos(h) * (a.s - want);
        y = a.y - Math.sin(h) * (a.s - want);
      } else {
        const k = (want - a.s) / Math.max(1e-6, b.s - a.s);
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
        h = b.h;
      }
    }
    // Offset across the path into this rider's lane (+y is the right-hand side).
    return { x: x - Math.sin(h) * slot.y, y: y + Math.cos(h) * slot.y, h };
  }

  /** How sharply a horse can turn (rad/s) at a given speed — wide arcs at a gallop. */
  private turnRate(speed: number): number {
    const k = clamp01((speed - C.CANTER_SPEED * 0.5) / (C.GALLOP_SPEED - C.CANTER_SPEED * 0.5));
    return C.TURN_RATE_SLOW + (C.TURN_RATE_FAST - C.TURN_RATE_SLOW) * k;
  }

  private integrateRider(r: Soldier, dt: number): void {
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    // Hard edge as a backstop only: riders slide along it without losing speed
    // (steering already turns them along the wall before they reach it).
    const m = EDGE;
    if (r.x < m) r.x = m;
    if (r.x > C.WORLD_W - m) r.x = C.WORLD_W - m;
    if (r.y < m) r.y = m;
    if (r.y > C.WORLD_H - m) r.y = C.WORLD_H - m;
  }

  /**
   * Near the field's edge, fade out the part of a heading that points off the field,
   * so horses wheel round to ride along the border instead of ramming it.
   */
  private awayFromWalls(L: Soldier, heading: number): number {
    let dx = Math.cos(heading), dy = Math.sin(heading);
    const soft = WALL_SOFT;
    const fade = (dist: number) => clamp01((dist - EDGE) / soft);
    if (dx < 0) dx *= fade(L.x);
    if (dx > 0) dx *= fade(C.WORLD_W - L.x);
    if (dy < 0) dy *= fade(L.y);
    if (dy > 0) dy *= fade(C.WORLD_H - L.y);
    if (Math.hypot(dx, dy) < 0.15) {
      // Pointing straight off the field: turn along the edge, whichever way we already lean.
      const fx = Math.cos(L.facing), fy = Math.sin(L.facing);
      const nearX = Math.min(L.x, C.WORLD_W - L.x) < Math.min(L.y, C.WORLD_H - L.y);
      if (nearX) { dx = 0; dy = fy >= 0 ? 1 : -1; } else { dx = fx >= 0 ? 1 : -1; dy = 0; }
    }
    return Math.atan2(dy, dx);
  }


  // --- Allied troops & AI squadrons --------------------------------------------------

  /** Fresh allied riders muster at the camp from time to time. */
  private updateMuster(dt: number): void {
    if (!this.muster) return;
    this.musterTimer -= dt;
    if (this.musterTimer > 0) return;
    this.musterTimer = C.MUSTER_INTERVAL;
    const allied = this.squadrons.filter(sq => sq !== this.player && sq.team === 'blue' && sq.ai !== 'garrison' && sq.riders.length > 0).length;
    if (allied >= C.MAX_ALLIED_SQUADS) return;
    const camp = C.CAMPS[this.musterCount++ % C.CAMPS.length];
    const x = camp.x + 55, y = camp.y - 45;
    this.addSquad({ team: 'blue', ai: 'raider', x, y, facing: -Math.PI / 4, count: C.MUSTER_SIZE, muster: C.MUSTER_WAIT });
    this.events.push({ type: 'muster', x, y, count: C.MUSTER_SIZE });
  }

  /** Ride into an allied troop and it falls in behind your banner. */
  private checkJoins(): void {
    const P = this.player;
    const L = P?.riders[0];
    if (!P || !L) return;
    for (const sq of this.squadrons) {
      if (sq === P || sq.team !== P.team || sq.riders.length === 0) continue;
      const room = C.MAX_SQUAD - P.riders.length;
      if (room <= 0) return;
      if (!sq.riders.some(r => Math.hypot(r.x - L.x, r.y - L.y) < C.JOIN_RADIUS)) continue;
      const moving = sq.riders.splice(0, room);
      for (const r of moving) {
        r.squad = P;
        P.riders.push(r);
      }
      this.ridersJoined += moving.length;
      this.events.push({ type: 'join', x: L.x, y: L.y, count: moving.length });
    }
  }

  /** Steering toward a point; slows on the approach and halts on arrival. */
  private rideTo(L: Soldier, p: Vec2, gallop: boolean): ChargeInput {
    const dx = p.x - L.x, dy = p.y - L.y;
    const d = Math.hypot(dx, dy);
    if (d < 14) return NO_INPUT;
    const mag = d < 60 ? 0.6 : 1;
    return { dirX: (dx / d) * mag, dirY: (dy / d) * mag, gallop };
  }

  /**
   * The general keeps to his post behind the red army and rides off from any enemy
   * horseman that comes close — at a canter, so a galloping squadron can run him down.
   */
  private generalInput(sq: Squadron, L: Soldier): ChargeInput {
    if (this.armyBroken.red || this.battalions.every(b => b.team !== 'red' || b.routed)) {
      if (L.y < 20) for (const r of sq.riders) r.alive = false;
      return this.rideTo(L, { x: L.x, y: -100 }, true);
    }
    let tx = 0, ty = 0, n = 0;
    for (const o of this.squadrons) {
      if (o.team === sq.team) continue;
      for (const r of o.riders) {
        const d = Math.hypot(r.x - L.x, r.y - L.y);
        if (d < C.GENERAL_FLEE_RADIUS) { tx += r.x; ty += r.y; n++; }
      }
    }
    if (n === 0) return this.rideTo(L, sq.home, false);
    const dx = L.x - tx / n, dy = L.y - ty / n;
    const d = Math.hypot(dx, dy) || 1;
    const m = 80;
    const fx = Math.max(m, Math.min(C.WORLD_W - m, L.x + (dx / d) * 150));
    const fy = Math.max(m, Math.min(C.FRONT_Y - 220, L.y + (dy / d) * 150));
    return this.rideTo(L, { x: fx, y: fy }, false);
  }

  private pickTarget(sq: Squadron): void {
    const L = sq.riders[0];
    sq.targetBat = null;
    sq.targetSquad = null;
    let nearSquad: Squadron | null = null;
    let nearD = Infinity;
    for (const o of this.squadrons) {
      const OL = o.riders[0];
      if (o.team === sq.team || !OL) continue;
      const d = Math.hypot(OL.x - L.x, OL.y - L.y);
      if (d < nearD) { nearD = d; nearSquad = o; }
    }
    if (sq.ai === 'hunter') {
      const P = this.player;
      sq.targetSquad = P && P.team !== sq.team && P.riders.length > 0 ? P : nearSquad;
      if (sq.targetSquad) return;
    }
    if (sq.ai === 'guard') {
      let intruder: Squadron | null = null;
      let best: number = sq.guardRadius;
      for (const o of this.squadrons) {
        const OL = o.riders[0];
        if (o.team === sq.team || !OL) continue;
        const d = Math.hypot(OL.x - sq.home.x, OL.y - sq.home.y);
        if (d < best) { best = d; intruder = o; }
      }
      sq.targetSquad = intruder;
      return;
    }
    // Raiders: fight off nearby horsemen first, otherwise hunt soft targets.
    if (nearSquad && nearD < C.RAIDER_ENGAGE_SQUAD) { sq.targetSquad = nearSquad; return; }
    let best: Battalion | null = null;
    let bestScore = Infinity;
    for (const b of this.battalions) {
      if (b.team === sq.team || b.routed) continue;
      const d = Math.hypot(b.x - L.x, b.y - L.y);
      const score = d + (b.type === 'pikeman' ? 300 : 0) - (b.type === 'archer' ? 150 : 0) + this.rand() * 80;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    sq.targetBat = best;
  }

  /** Decide what an AI squadron does this step. */
  private aiInput(sq: Squadron, dt: number): ChargeInput {
    const L = sq.riders[0];
    sq.phaseTimer -= dt;
    if (sq.ai === 'general') return this.generalInput(sq, L);
    if (sq.ai === 'garrison') return this.rideTo(L, sq.home, false); // waits in camp for you
    // An escort's post moves with its ward, a little behind him.
    const WL = sq.ward?.riders[0];
    if (WL) {
      sq.home.x = WL.x - Math.cos(WL.facing) * 30;
      sq.home.y = WL.y - Math.sin(WL.facing) * 30;
    } else if (sq.ward) sq.ward = null; // he has fallen: hold where he was

    if (sq.riders.length <= C.AI_RETREAT_AT && sq.phase !== 'retreat' && sq.phase !== 'idle' && sq.phase !== 'muster') {
      sq.phase = 'retreat';
    }
    // Once the red infantry has broken and no help is coming, its knights quit the field too.
    if (sq.team === 'red' && sq.phase !== 'retreat' && (this.armyBroken.red || (this.pendingWaves.length === 0
      && this.battalions.every(b => b.team !== 'red' || b.routed)))) {
      sq.phase = 'retreat';
    }

    switch (sq.phase) {
      case 'muster':
        if (sq.phaseTimer <= 0) {
          sq.phase = 'approach';
          if (sq.ai === 'hunter') this.events.push({ type: 'hunt', x: L.x, y: L.y, count: sq.riders.length });
        }
        return this.rideTo(L, sq.home, false);
      case 'retreat':
        if (sq.team === 'red') {
          // Broken knights ride off the field.
          if (L.y < 20) for (const r of sq.riders) r.alive = false;
          return this.rideTo(L, { x: L.x, y: -100 }, true);
        }
        const camp = this.nearestCamp(L);
        if (Math.hypot(L.x - camp.x, L.y - camp.y) < C.CAMP_R * 0.5) sq.phase = 'idle';
        return this.rideTo(L, camp, false);
      case 'broken': {
        // Scattered: gallop away from whoever broke us, then regroup and come again.
        if (sq.phaseTimer <= 0) { sq.phase = 'approach'; sq.phaseTimer = 0; break; }
        const from = sq.fleeFrom ?? { x: L.x, y: L.y + 1 };
        const dx = L.x - from.x, dy = L.y - from.y;
        const d = Math.hypot(dx, dy) || 1;
        return { dirX: dx / d, dirY: dy / d, gallop: true };
      }
      case 'idle':
        // Wounded allies wait in camp to be collected, or ride out again once healed.
        if (sq.riders.length > C.AI_RETREAT_AT && sq.riders.every(r => r.hp > r.maxHp * 0.9)) sq.phase = 'approach';
        return NO_INPUT;
    }

    const validSquad = sq.targetSquad && sq.targetSquad.riders.length > 0;
    const validBat = sq.targetBat && !sq.targetBat.routed;
    if ((!validSquad && !validBat) || sq.phaseTimer < -6) {
      this.pickTarget(sq);
      sq.phaseTimer = 0;
      if (sq.phase === 'charge') sq.phase = 'approach';
    }

    // Guards return to their post when nothing threatens it.
    if (sq.ai === 'guard') {
      const t = sq.targetSquad?.riders[0];
      if (!t || Math.hypot(L.x - sq.home.x, L.y - sq.home.y) > sq.guardRadius + C.GUARD_LEASH - C.GUARD_RADIUS) {
        sq.targetSquad = null;
        return this.rideTo(L, sq.home, false);
      }
    }

    const T = sq.targetSquad?.riders[0];
    if (T) {
      // Ride at where the enemy horse will be.
      const aim = { x: T.x + T.vx * 0.35, y: T.y + T.vy * 0.35 };
      const d = Math.hypot(aim.x - L.x, aim.y - L.y);
      return { ...this.rideTo(L, aim, d < 340), dirX: (aim.x - L.x) / (d || 1), dirY: (aim.y - L.y) / (d || 1) };
    }

    const b = sq.targetBat;
    if (!b) return this.rideTo(L, sq.home, false);
    const fx = Math.cos(b.facing), fy = Math.sin(b.facing);
    if (sq.phase === 'charge') {
      const exit = sq.chargeExit!;
      if (Math.hypot(exit.x - L.x, exit.y - L.y) < 30 || sq.phaseTimer <= 0) {
        sq.phase = 'approach';
        sq.targetBat = null; // pick again — maybe the same battalion, maybe another
        sq.phaseTimer = 0;
      }
      return this.rideTo(L, exit, true);
    }

    // Approach: pick the nearest exposed side (rear or a flank) and ride round to it,
    // keeping clear of the target's front. If that takes too long, charge from here.
    let best: Vec2 | null = null;
    let bestDir: Vec2 = { x: -fx, y: -fy };
    let bestD = Infinity;
    for (const dir of [{ x: -fx, y: -fy }, { x: -fy, y: fx }, { x: fy, y: -fx }]) {
      const p = { x: b.x + dir.x * 150, y: b.y + dir.y * 150 };
      const d = Math.hypot(p.x - L.x, p.y - L.y);
      if (d < bestD) { bestD = d; best = p; bestDir = dir; }
    }
    const ap = best!;
    if (bestD < 55 || sq.phaseTimer < -5) {
      const fromHere = sq.phaseTimer < -5;
      const ix = fromHere ? b.x - L.x : -bestDir.x;
      const iy = fromHere ? b.y - L.y : -bestDir.y;
      const il = Math.hypot(ix, iy) || 1;
      sq.phase = 'charge';
      sq.phaseTimer = 2.6;
      sq.chargeExit = { x: b.x + (ix / il) * 180, y: b.y + (iy / il) * 180 };
      return this.rideTo(L, sq.chargeExit, true);
    }
    let wp = ap;
    // Detour round the side if the straight line would cross the formation.
    const sx = ap.x - L.x, sy = ap.y - L.y;
    const sl = Math.hypot(sx, sy) || 1;
    const k = clamp(((b.x - L.x) * sx + (b.y - L.y) * sy) / (sl * sl), 0, 1);
    const cx = L.x + sx * k - b.x, cy = L.y + sy * k - b.y;
    if (Math.hypot(cx, cy) < 90 && sl > 70) {
      let nx = (L.x - b.x) / 150 + bestDir.x, ny = (L.y - b.y) / 150 + bestDir.y;
      const nl = Math.hypot(nx, ny);
      if (nl < 0.2) { nx = -bestDir.y; ny = bestDir.x; } else { nx /= nl; ny /= nl; }
      wp = { x: b.x + nx * 170, y: b.y + ny * 170 };
    }
    return this.rideTo(L, wp, false);
  }

  // --- Battalions ---------------------------------------------------------------

  private nearestEnemyBattalion(b: Battalion, maxDist = Infinity): Battalion | null {
    let best: Battalion | null = null;
    let bestD = maxDist * maxDist;
    for (const o of this.battalions) {
      if (o.team === b.team || o.routed) continue;
      const d = (o.x - b.x) ** 2 + (o.y - b.y) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  /** Leader of the nearest enemy squadron within `maxDist` of `p`. */
  private nearestEnemyRider(team: Team, p: Vec2, maxDist: number): Soldier | null {
    let best: Soldier | null = null;
    let bestD = maxDist;
    for (const sq of this.squadrons) {
      const L = sq.riders[0];
      if (sq.team === team || !L) continue;
      const d = Math.hypot(L.x - p.x, L.y - p.y);
      if (d < bestD) { bestD = d; best = L; }
    }
    return best;
  }

  private updateBattalions(dt: number): void {
    for (const b of this.battalions) {
      if (b.routed) continue;
      b.sinceShock += dt;
      b.engagedTimer = Math.max(0, b.engagedTimer - dt);
      const engaged = b.engagedTimer > 0;

      if (b.role === 'archer') {
        this.updateArchers(b, dt);
        continue;
      }

      let role = b.role;
      // Reserves fight like line troops once enemy infantry comes close.
      if (role === 'reserve' && this.nearestEnemyBattalion(b, 260)) role = 'front';

      if (role === 'front') {
        if (engaged) { this.pressLine(b, dt); continue; } // locked in melee: push and shove
        const target = this.nearestEnemyBattalion(b);
        if (!target) continue;
        const dx = target.x - b.x, dy = target.y - b.y;
        const d = Math.hypot(dx, dy);
        b.facing = turnToward(b.facing, Math.atan2(dy, dx), C.BATTALION_TURN_RATE * dt);
        if (d > 1) {
          // Columns march quickly to the fight, then close the last stretch at a steady pace.
          const speed = d > C.MARCH_DISTANCE ? C.MARCH_SPEED : C.ADVANCE_SPEED;
          const step = Math.min(d, speed * dt);
          b.x += (dx / d) * step;
          b.y += (dy / d) * step;
        }
        continue;
      }

      // Reserve: wheel to face the squadron and shuffle toward it within a leash.
      let tx = b.home.x, ty = b.home.y, face = b.homeFacing;
      const L = this.nearestEnemyRider(b.team, b.home, C.RESERVE_AWARE);
      if (L) {
        face = Math.atan2(L.y - b.y, L.x - b.x);
        const hx = L.x - b.home.x, hy = L.y - b.home.y;
        const hd = Math.hypot(hx, hy);
        const k = hd > C.RESERVE_LEASH ? C.RESERVE_LEASH / hd : 1;
        tx = b.home.x + hx * k;
        ty = b.home.y + hy * k;
      }
      if (!engaged) b.facing = turnToward(b.facing, face, C.RESERVE_TURN_RATE * dt);
      const dx = tx - b.x, dy = ty - b.y;
      const d = Math.hypot(dx, dy);
      if (d > 4 && !engaged) {
        const step = Math.min(d, C.RESERVE_SPEED * dt);
        b.x += (dx / d) * step;
        b.y += (dy / d) * step;
      }
    }
  }

  /** Fighting strength for the shoving match: numbers, heart and the kind of men. */
  private lineStrength(b: Battalion): number {
    return this.members(b).length * (0.3 + 0.7 * clamp01(b.morale / 100)) * C.PUSH_WEIGHT[b.type];
  }

  /**
   * Two lines locked in melee push against each other: the side with more men and
   * better heart slowly drives the other back, so the front bends and shifts and a
   * losing battalion gives ground before it breaks.
   */
  private pressLine(b: Battalion, dt: number): void {
    const foe = this.nearestEnemyBattalion(b, C.PUSH_RANGE);
    if (!foe) return;
    const mine = this.lineStrength(b), theirs = this.lineStrength(foe);
    const balance = (mine - theirs) / Math.max(1, mine + theirs);
    const v = C.PUSH_SPEED * Math.max(-1, Math.min(1, balance * 2.2));
    b.x += Math.cos(b.facing) * v * dt;
    b.y += Math.sin(b.facing) * v * dt;
  }

  /** Ranks loosen and grow ragged as a battalion's heart fails. */
  looseness(b: Battalion): number {
    return 1 + C.LOOSEN * (1 - clamp01(b.morale / 100));
  }

  private updateArchers(b: Battalion, dt: number): void {
    // Skirmishers: fall back from enemy foot closing in rather than stand and be cut down.
    if (b.engagedTimer <= 0) {
      let threat: Battalion | null = null;
      let best: number = C.ARCHER_SKIRMISH;
      for (const o of this.battalions) {
        if (o.team === b.team || o.routed || o.role === 'archer') continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < best) { best = d; threat = o; }
      }
      if (threat && Math.hypot(b.x - b.home.x, b.y - b.home.y) < C.ARCHER_FALLBACK) {
        const dx = b.x - threat.x, dy = b.y - threat.y;
        const d = Math.hypot(dx, dy) || 1;
        b.x += (dx / d) * C.ARCHER_RETREAT_SPEED * dt;
        b.y += (dy / d) * C.ARCHER_RETREAT_SPEED * dt;
        b.x = Math.max(60, Math.min(C.WORLD_W - 60, b.x));
        b.y = Math.max(60, Math.min(C.WORLD_H - 60, b.y));
      }
    }
    let aim: Vec2 | null = null;
    let atPlayer = false;
    let spread: number = C.VOLLEY_SPREAD_LINE;

    // Archers can't resist horsemen in range — cavalry draws their fire (yours first).
    let prey: Squadron | null = null;
    let preyD = Infinity;
    for (const sq of this.squadrons) {
      const L = sq.riders[0];
      if (sq.team === b.team || !L) continue;
      const d = Math.hypot(L.x - b.x, L.y - b.y);
      if (d < C.ARCHER_MIN_RANGE || d > C.ARCHER_RANGE) continue;
      const score = sq === this.player ? d - 250 : d;
      if (score < preyD) { preyD = score; prey = sq; }
    }
    if (prey) {
      const L = prey.riders[0];
      const d = Math.hypot(L.x - b.x, L.y - b.y);
      const c = this.squadCenter(prey);
      const flight = clamp(d / C.ARROW_SPEED, C.ARROW_MIN_FLIGHT, C.ARROW_MAX_FLIGHT);
      const lead = 0.55 + this.rand() * 0.45;
      aim = { x: c.x + L.vx * flight * lead, y: c.y + L.vy * flight * lead };
      atPlayer = prey === this.player;
      spread = C.VOLLEY_SPREAD_PLAYER;
    }
    if (!aim) {
      const t = this.nearestEnemyBattalion(b, C.ARCHER_RANGE);
      if (t && t.role !== 'archer') {
        // Aim a little behind the enemy's front rank.
        aim = { x: t.x, y: t.y };
      }
    }

    let faceTo = aim ? Math.atan2(aim.y - b.y, aim.x - b.x) : b.homeFacing;
    if (!aim && b.engagedTimer <= 0) {
      // Nothing in range: march toward the fight until the enemy is within bowshot.
      const t = this.nearestEnemyBattalion(b);
      if (t) {
        const dx = t.x - b.x, dy = t.y - b.y;
        const d = Math.hypot(dx, dy);
        faceTo = Math.atan2(dy, dx);
        if (d > C.ARCHER_RANGE * 0.8) {
          const speed = d > C.MARCH_DISTANCE ? C.MARCH_SPEED : C.ADVANCE_SPEED;
          b.x += (dx / d) * speed * dt;
          b.y += (dy / d) * speed * dt;
        }
      }
    }
    if (b.engagedTimer <= 0) b.facing = turnToward(b.facing, faceTo, 0.8 * dt);

    b.volleyTimer -= dt;
    if (b.volleyTimer > 0 || !aim) return;
    if (b.engagedTimer > 0) { b.volleyTimer = 0.5; return; } // swords drawn — no volley
    b.volleyTimer = (C.VOLLEY_INTERVAL + (this.rand() - 0.5) * 2 * C.VOLLEY_JITTER)
      * (prey ? 1 : C.LINE_VOLLEY_INTERVAL_MULT);

    const archers = this.members(b);
    if (archers.length === 0) return;
    const dist = Math.hypot(aim.x - b.x, aim.y - b.y);
    const flight = clamp(dist / C.ARROW_SPEED, C.ARROW_MIN_FLIGHT, C.ARROW_MAX_FLIGHT);
    const volley: Volley = {
      id: this.nextVolley++, team: b.team, x: aim.x, y: aim.y,
      radius: spread + 10, t: 0, flight, atPlayer,
    };
    this.volleys.push(volley);
    for (const a of archers) {
      const ang = this.rand() * Math.PI * 2;
      const rr = Math.sqrt(this.rand()) * spread;
      this.arrows.push({
        sx: a.x, sy: a.y,
        tx: aim.x + Math.cos(ang) * rr,
        ty: aim.y + Math.sin(ang) * rr,
        t: -this.rand() * 0.12,
        flight,
        team: b.team,
        volley: volley.id,
      });
    }
    this.events.push({ type: 'volley', id: volley.id, team: b.team, x: aim.x, y: aim.y, radius: volley.radius, flight, atPlayer });
  }

  squadCenter(sq: Squadron | null = this.player): Vec2 {
    const riders = sq?.riders ?? [];
    if (riders.length === 0) return { x: 0, y: 0 };
    let x = 0, y = 0;
    for (const r of riders) { x += r.x; y += r.y; }
    return { x: x / riders.length, y: y / riders.length };
  }

  /** Close ranks: survivors step forward into gaps of their file. */
  /** Badly wounded men in the front rank swap places with fresh men behind them. */
  private rotateWounded(b: Battalion): void {
    for (let col = 0; col < b.cols; col++) {
      const front = b.grid[col];
      const behind = b.grid[b.cols + col];
      if (!front || !behind || !front.alive || !behind.alive || front.down > 0) continue;
      if (front.hp < front.maxHp * 0.45 && behind.hp > behind.maxHp * 0.75) {
        b.grid[col] = behind;
        b.grid[b.cols + col] = front;
      }
    }
  }

  private closeRanks(b: Battalion): void {
    const rows = Math.ceil(b.grid.length / b.cols);
    for (let col = 0; col < b.cols; col++) {
      let write = 0;
      for (let row = 0; row < rows; row++) {
        const s = b.grid[row * b.cols + col];
        if (s && s.alive) {
          b.grid[row * b.cols + col] = null;
          b.grid[write * b.cols + col] = s;
          write++;
        } else {
          b.grid[row * b.cols + col] = null;
        }
      }
    }
  }

  private moveInfantry(dt: number): void {
    const slide = Math.exp(-C.GROUND_FRICTION * dt);
    for (const b of this.battalions) {
      if (b.routed) continue;
      this.closeRanks(b);
      b.rotateTimer -= dt;
      if (b.rotateTimer <= 0) {
        b.rotateTimer = C.ROTATE_INTERVAL * (0.6 + this.rand() * 0.8);
        this.rotateWounded(b);
      }
    }

    for (const s of this.soldiers) {
      if (s.rider || !s.alive) continue;
      s.down = Math.max(0, s.down - dt);
      const maxSpeed = C.INFANTRY_SPEED[s.type];
      let dvx = 0, dvy = 0;

      if (s.fleeing) {
        const dir = s.team === 'red' ? -1 : 1;
        dvx = s.fleeDrift * C.FLEE_SPEED;
        dvy = dir * C.FLEE_SPEED;
        if (s.down <= 0) s.facing = turnToward(s.facing, Math.atan2(dvy, dvx), 6 * dt);
      } else if (s.bat) {
        const idx = s.bat.grid.indexOf(s);
        const p = this.slotPos(s.bat, idx, this.tmp);
        const rag = 1 + 2 * (this.looseness(s.bat) - 1);
        dvx = (p.x + s.jx * rag - s.x) * 3;
        dvy = (p.y + s.jy * rag - s.y) * 3;
        const m = Math.hypot(dvx, dvy);
        if (m > maxSpeed) { dvx *= maxSpeed / m; dvy *= maxSpeed / m; }
      }

      // Men on the ground, or sent flying, slide to a stop; otherwise they work
      // their way back (a footman can only push so hard).
      const speed = Math.hypot(s.vx, s.vy);
      if (s.down > 0 || speed > maxSpeed * 1.4) {
        s.vx *= slide;
        s.vy *= slide;
      } else {
        let ax = dvx - s.vx, ay = dvy - s.vy;
        const am = Math.hypot(ax, ay);
        const maxDv = C.INFANTRY_ACCEL * dt;
        if (am > maxDv) { ax *= maxDv / am; ay *= maxDv / am; }
        s.vx += ax;
        s.vy += ay;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      if (s.fleeing && (s.y < -30 || s.y > C.WORLD_H + 30 || s.x < -30 || s.x > C.WORLD_W + 30)) {
        s.alive = false; // escaped the field
      }
    }
  }


  private rebuildGrid(): void {
    this.grid.clear();
    for (const s of this.soldiers) if (s.alive) this.grid.insert(s);
  }

  /** A few times a second, everyone notes the nearest enemy so weapons can point at it. */
  private updateAim(dt: number): void {
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.aimTimer -= dt;
      if (s.aimTimer > 0) continue;
      s.aimTimer = 0.2 + this.rand() * 0.15;
      if (s.fleeing) { s.aim = NaN; s.aimDist = Infinity; continue; }
      const near = this.grid.query(s.x, s.y, C.AIM_RADIUS, this.near);
      let best = C.AIM_RADIUS * C.AIM_RADIUS;
      let aim = NaN;
      for (const o of near) {
        if (!o.alive || o.team === s.team) continue;
        const dx = o.x - s.x, dy = o.y - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; aim = Math.atan2(dy, dx); }
      }
      s.aim = aim;
      s.aimDist = Number.isNaN(aim) ? Infinity : Math.sqrt(best);
    }
  }

  // --- Combat -------------------------------------------------------------------

  private victimFacing(s: Soldier): number {
    return s.fleeing || !s.bat ? s.facing : s.bat.facing;
  }

  private riderCombat(dt: number): void {
    const riders: Soldier[] = [];
    for (const sq of this.squadrons) for (const r of sq.riders) riders.push(r);
    for (const r of riders) {
      if (!r.alive) continue;
      const mine = r.squad === this.player;
      r.attackTimer -= dt;
      const near = this.grid.query(r.x, r.y, r.radius + 8 + C.RIDER_REACH, this.near);
      let meleeTarget: Soldier | null = null;
      let meleeD = Infinity;

      for (const s of near) {
        if (!s.alive || s.team === r.team) continue;
        const d = Math.hypot(s.x - r.x, s.y - r.y);

        // From the saddle you can cut to the front and sides, not behind you.
        if (d < r.radius + s.radius + C.RIDER_REACH && d < meleeD
          && Math.abs(angleDiff(Math.atan2(s.y - r.y, s.x - r.x), r.facing)) < C.SADDLE_ARC) {
          meleeD = d;
          meleeTarget = s;
        }
      }

      // Too slow to trample: fight from the saddle.
      if (r.alive && meleeTarget && r.speed < C.CHARGE_MIN_SPEED && r.attackTimer <= 0) {
        r.attackTimer = C.RIDER_MELEE_COOLDOWN;
        r.lastAttack = this.time;
        const ang = Math.atan2(meleeTarget.y - r.y, meleeTarget.x - r.x);
        const side = attackSide(ang, this.victimFacing(meleeTarget));
        if (meleeTarget.bat && mine) meleeTarget.bat.lastPlayerHit = this.time;
        const aiK = mine || meleeTarget.rider ? 1 : C.AI_INFANTRY_MULT;
        this.damageSoldier(meleeTarget, C.RIDER_MELEE_DAMAGE * sideMultiplier(side) * aiK, ang, mine, side);
      }
    }
  }

  private infantryCombat(dt: number): void {
    for (const s of this.soldiers) {
      if (s.rider || !s.alive || s.fleeing || s.down > 0) continue;

      // Turn — it takes time — toward an enemy close at hand, else back to the
      // battalion's front. Caught from the side or behind, a man must turn first.
      const reach = s.radius + C.MELEE_REACH + 6;
      const threatened = s.aimDist < reach + 8;
      const want = threatened ? s.aim : s.bat ? s.bat.facing : s.facing;
      s.facing = turnToward(s.facing, want, C.INFANTRY_TURN_RATE * dt);

      s.attackTimer -= dt;
      if (s.attackTimer > 0) continue;

      // Only an enemy inside his front arc can be struck.
      const near = this.grid.query(s.x, s.y, reach, this.near);
      let target: Soldier | null = null;
      let best = Infinity;
      let enemyClose = false;
      for (const o of near) {
        if (!o.alive || o.team === s.team) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d >= s.radius + o.radius + C.MELEE_REACH) continue;
        enemyClose = true;
        const off = Math.abs(angleDiff(Math.atan2(o.y - s.y, o.x - s.x), s.facing));
        if (off < C.INFANTRY_ARC && d < best) { best = d; target = o; }
      }
      if (enemyClose && s.bat) s.bat.engagedTimer = 1.2;
      if (!target) { s.attackTimer = 0.25; continue; }

      s.attackTimer = C.MELEE_COOLDOWN_MIN + this.rand() * (C.MELEE_COOLDOWN_MAX - C.MELEE_COOLDOWN_MIN);
      s.lastAttack = this.time;
      const ang = Math.atan2(target.y - s.y, target.x - s.x);

      if (target.rider) {
        const braced = s.type === 'pikeman';
        // A galloping rider is past before a sword can land; pikes still bite.
        if (target.speed >= C.CHARGE_MIN_SPEED && !braced) continue;
        if (this.rand() > C.VS_RIDER_HIT_CHANCE) continue;
        const side = attackSide(ang, target.facing);
        const dmg = C.MELEE_DAMAGE[s.type] * (braced ? C.PIKE_VS_RIDER_MULT : 1) * C.VS_RIDER_DAMAGE_MULT * sideMultiplier(side);
        this.damageRider(target, dmg, ang, false, side);
        continue;
      }

      if (this.rand() > C.MELEE_HIT_CHANCE) continue;
      // Blows to the flank or rear land harder (x2 / x3), and the victim can't answer them.
      const side = attackSide(ang, this.victimFacing(target));
      const dmg = C.MELEE_DAMAGE[s.type] * C.TEAM_MELEE_MULT[s.team] * sideMultiplier(side);
      this.damageSoldier(target, dmg, ang, false, side);
    }
  }


  private damageSoldier(s: Soldier, dmg: number, angle: number, byPlayer: boolean, side: AttackSide): void {
    if (!s.alive) return;
    if (s.rider) { this.damageRider(s, dmg, angle, byPlayer, side); return; }
    s.hp -= dmg;
    if (s.hp > 0) {
      this.events.push({ type: 'hit', x: s.x, y: s.y, angle, team: s.team, damage: dmg, id: s.id });
      return;
    }
    s.alive = false;
    const points = byPlayer ? this.scoreKill(side, 1) : 0;
    // A man killed by a blow that sent him flying keeps flying, into his comrades.
    if (Math.hypot(s.vx, s.vy) > C.THROWN_REL) {
      if (byPlayer) s.thrownByPlayer = Math.max(s.thrownByPlayer, this.time + C.THROWN_CREDIT);
      if (this.flying.length > 60) this.flying.shift();
      this.flying.push({ body: s, t: C.FLYING_TIME });
    }
    const b = s.bat;
    if (b && !b.routed && !s.fleeing) {
      const perDeath = 100 / (b.initial * C.MORALE_LOSS_SHARE);
      b.morale -= perDeath * C.SIDE_MORALE_FACTOR[side];
      b.sinceShock = 0;
    }
    this.events.push({ type: 'kill', x: s.x, y: s.y, angle, team: s.team, id: s.id, byPlayer, side, points });
  }

  /** Score a kill made by your squadron; returns the points awarded. */
  private scoreKill(side: AttackSide, worth: number): number {
    this.kills++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = C.COMBO_WINDOW;
    const comboMult = 1 + Math.min(4, Math.floor(this.combo / 10)) * 0.5;
    const points = Math.round(C.KILL_SCORE * worth * sideMultiplier(side) * comboMult);
    this.score += points;
    if (this.combo % 10 === 0) this.events.push({ type: 'combo', count: this.combo });
    return points;
  }

  private damageRider(r: Soldier, dmg: number, angle: number, byPlayer: boolean, side: AttackSide): void {
    if (!r.alive) return;
    const sq = r.squad!;
    const mine = sq === this.player;
    r.hp -= dmg;
    this.events.push({ type: 'rider-hit', x: r.x, y: r.y, id: r.id, damage: dmg, mine });
    if (r.hp > 0) return;
    r.alive = false;
    const wasLeader = sq.riders[0] === r;
    if (wasLeader && sq.riders.length > 1) {
      // The next rider takes up the banner and keeps the leader's momentum.
      const next = sq.riders[1];
      next.speed = Math.max(next.speed, r.speed * 0.8);
      next.facing = r.facing;
      this.resetTrail(sq, next.x, next.y, next.facing);
    }
    sq.riders = sq.riders.filter(x => x !== r);
    if (mine) this.ridersLost++;
    let points = byPlayer && !mine ? this.scoreKill(side, C.KNIGHT_SCORE_MULT) : 0;
    // A knight felled by our infantry or archers while hunting you: you lured him there.
    const lured = !byPlayer && !mine && r.team === 'red' && !!this.player && sq.targetSquad === this.player;
    if (lured) {
      points = Math.round(C.KILL_SCORE * C.KNIGHT_SCORE_MULT * C.LURE_SCORE_MULT);
      this.score += points;
      this.lured++;
    }
    if (!mine && sq.riders.length > 0) this.shockSquad(sq, C.LOSS_SHOCK, r, byPlayer);
    if (sq.ai === 'general') this.generalDown(r, byPlayer);
    this.events.push({ type: 'rider-down', x: r.x, y: r.y, angle, id: r.id, wasLeader, team: r.team, mine, byPlayer, points, lured });
  }

  /** The general falls: every red battalion is shaken and the whole army's heart sinks. */
  private generalDown(r: Soldier, byPlayer: boolean): void {
    this.generalFallen = true;
    this.generalKilledByPlayer = byPlayer;
    const points = byPlayer ? C.GENERAL_SCORE : 0;
    this.score += points;
    for (const b of this.battalions) {
      if (b.team !== r.team || b.routed) continue;
      b.morale -= C.GENERAL_MORALE_SHOCK;
      b.sinceShock = 0;
    }
    this.events.push({ type: 'general-down', x: r.x, y: r.y, byPlayer, points });
  }

  /**
   * How heavy a body is to whatever is ramming into it. Infantry facing a charge brace
   * behind shield or pike and absorb it like a much heavier mass; hit in the flank or
   * rear, or lying on the ground, they go flying.
   */
  private effectiveMass(victim: Soldier, rammer: Soldier): number {
    if (victim.rider) {
      // Against other horsemen, a tight wedge hits (and holds) as one body.
      const wedge = rammer.rider && victim.squad ? 1 + C.COHESION_WEIGHT * victim.squad.cohesion : 1;
      return victim.mass * this.chargeWeight(victim) * wedge;
    }
    if (victim.down > 0) return C.DOWN_MASS;
    if (!rammer.rider || victim.fleeing) return victim.mass;
    const side = attackSide(Math.atan2(rammer.vy, rammer.vx), this.victimFacing(victim));
    const brace = side === 'front' ? (victim.type === 'pikeman' ? C.BRACE.pike : C.BRACE.front) : C.BRACE[side];
    return victim.mass * brace;
  }

  /**
   * A horse at full gallop hits as if it were heavier (commitment: the weight of horse
   * and lance driving forward), so it loses far less momentum per man and ploughs on.
   * No bonus at a canter or slower — a slow charge bogs down.
   */
  private chargeWeight(r: Soldier): number {
    const k = clamp01((r.speed - C.CANTER_SPEED) / (C.GALLOP_SPEED - C.CANTER_SPEED));
    return 1 + C.CHARGE_WEIGHT_BONUS * k;
  }

  /**
   * Bodies collide: overlapping pairs are pushed apart and trade momentum by their
   * masses. Damage, knockdowns and morale shock all follow from how violently a body's
   * velocity is changed — a charge ploughs through, loses speed with every man it hits,
   * and sends men crashing into their comrades.
   */
  private collide(): void {
    for (const a of this.soldiers) {
      if (!a.alive) continue;
      const near = this.grid.query(a.x, a.y, a.radius + 8, this.near);
      for (let k = 0; k < near.length; k++) {
        const b = near[k];
        if (b.id <= a.id || !b.alive || !a.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const ma = this.effectiveMass(a, b), mb = this.effectiveMass(b, a);
        const ia = 1 / ma, ib = 1 / mb;

        // Push apart, the lighter body giving way.
        const push = (min - d) / (ia + ib);
        a.x -= nx * push * ia; a.y -= ny * push * ia;
        b.x += nx * push * ib; b.y += ny * push * ib;

        // Exchange momentum if they are closing. Horsemen on the same side ride around
        // each other rather than barging, so they only push apart.
        const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vrel >= 0) continue;
        if (a.rider && b.rider && a.team === b.team) continue;
        const j = -(1 + C.RESTITUTION) * vrel / (ia + ib);
        a.vx -= nx * j * ia; a.vy -= ny * j * ia;
        b.vx += nx * j * ib; b.vy += ny * j * ib;
        this.impactDamage(a, b, j * ia, -vrel, Math.atan2(-ny, -nx), j);
        this.impactDamage(b, a, j * ib, -vrel, Math.atan2(ny, nx), j);
      }
    }
  }

  /** Damage and knockdown for `victim`, whose velocity just changed by `dv` in a collision with `other`. */
  private impactDamage(victim: Soldier, other: Soldier, dv: number, closing: number, angle: number, impulse: number): void {
    // Both sides of a collision take their share, even if the other fell in it.
    if (!victim.alive) return;
    const enemies = victim.team !== other.team;

    if (other.rider && !victim.rider && enemies) {
      // Charged by a horseman.
      if (dv < C.IMPACT_DV_MIN) return;
      const mine = other.squad === this.player;
      const heading = Math.atan2(other.vy, other.vx);
      const side = attackSide(heading, this.victimFacing(victim));
      const braced = victim.type === 'pikeman' && side === 'front' && !victim.fleeing && victim.down <= 0;
      if (this.time - other.lastAttack > 0.3) other.lastAttack = this.time;
      const aiK = mine ? 1 : C.AI_INFANTRY_MULT;
      if (victim.bat) {
        victim.bat.morale -= C.IMPACT_SHOCK[side] * aiK;
        victim.bat.sinceShock = 0;
        if (mine) victim.bat.lastPlayerHit = this.time;
      }
      if (mine) victim.thrownByPlayer = this.time + C.THROWN_CREDIT;
      if (dv > C.KNOCK_DV) victim.down = Math.max(victim.down, C.DOWN_TIME + this.rand() * C.DOWN_TIME_JITTER);
      this.events.push({ type: 'impact', x: victim.x, y: victim.y, angle: heading, side, pike: braced });
      // Pike wounds scale with the real blow, not the gallop bonus.
      if (braced) this.damageRider(other, impulse / this.chargeWeight(other) * C.PIKE_RIDER_DAMAGE, heading + Math.PI, false, 'front');
      this.damageSoldier(victim, Math.max(0, dv - C.IMPACT_DV0) * C.IMPACT_DAMAGE_K * aiK, heading, mine, side);
      return;
    }

    if (victim.rider && other.rider) {
      // Horse against horse: only a rider facing his target can strike it. Caught in
      // the flank or rear, a horseman can't strike back — get round them and it's a
      // one-sided fight; meet them head-on and both strike.
      if (!enemies || !this.canStrike(other, victim)) return;
      other.attackTimer = C.STRIKE_COOLDOWN;
      other.lastAttack = this.time;
      const mine = other.squad === this.player;
      const approach = Math.atan2(victim.y - other.y, victim.x - other.x);
      const side = attackSide(approach, victim.facing);
      this.events.push({ type: 'impact', x: victim.x, y: victim.y, angle: approach, side, pike: false });
      // Hit in the flank or rear, a squadron is thrown into disorder.
      if (victim.squad) this.shockSquad(victim.squad, C.CLASH_SHOCK[side], other, mine);
      const speedK = Math.min(1.1, other.speed / C.GALLOP_SPEED);
      const wedge = 1 + C.STRIKE_WEDGE_BONUS * (other.squad?.cohesion ?? 0);
      this.damageRider(victim, C.RIDER_STRIKE * speedK * wedge * sideMultiplier(side), approach, mine, side);
      return;
    }

    if (!victim.rider && !other.rider && closing > C.THROWN_REL) {
      // A man sent flying crashes into another — friend or foe goes down with him.
      const byPlayer = other.thrownByPlayer > this.time || victim.thrownByPlayer > this.time;
      if (byPlayer) victim.thrownByPlayer = Math.max(victim.thrownByPlayer, this.time + C.THROWN_CREDIT * 0.5);
      if (dv > C.SECONDARY_KNOCK_DV) {
        if (victim.down <= 0) this.bowled++;
        victim.down = Math.max(victim.down, C.DOWN_TIME * 0.7 + this.rand() * C.DOWN_TIME_JITTER);
      }
      const dmg = Math.max(0, dv - C.SECONDARY_DV0) * C.SECONDARY_DAMAGE_K;
      if (dmg > 0) this.damageSoldier(victim, dmg, angle, byPlayer && victim.team === 'red', 'flank');
    }
  }

  /** Flying bodies slide on and crash into the living. */
  private updateFlying(dt: number): void {
    const slide = Math.exp(-C.GROUND_FRICTION * dt);
    let live = 0;
    for (const f of this.flying) {
      const b = f.body;
      f.t -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= slide;
      b.vy *= slide;
      if (f.t <= 0 || Math.hypot(b.vx, b.vy) < C.THROWN_REL * 0.6) continue;
      this.flying[live++] = f;
      const near = this.grid.query(b.x, b.y, b.radius + 8, this.near);
      for (let k = 0; k < near.length; k++) {
        const o = near[k];
        if (!o.alive) continue;
        const dx = o.x - b.x, dy = o.y - b.y;
        const min = b.radius + o.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const vrel = (o.vx - b.vx) * nx + (o.vy - b.vy) * ny;
        if (vrel >= 0) continue;
        const io = 1 / (o.down > 0 ? C.DOWN_MASS : o.mass), ib = 1 / b.mass;
        const j = -(1 + C.RESTITUTION) * vrel / (io + ib);
        b.vx -= nx * j * ib; b.vy -= ny * j * ib;
        o.vx += nx * j * io; o.vy += ny * j * io;
        o.x += nx * (min - d) * 0.5; o.y += ny * (min - d) * 0.5;
        if (!o.rider) this.impactDamage(o, b, j * io, -vrel, Math.atan2(ny, nx), j);
      }
    }
    this.flying.length = live;
  }

  /** A rider strikes another if he's charging and has him in front of his lance. */
  private canStrike(attacker: Soldier, target: Soldier): boolean {
    if (attacker.speed < C.CHARGE_MIN_SPEED || attacker.attackTimer > 0) return false;
    const toTarget = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    return Math.abs(angleDiff(toTarget, attacker.facing)) < C.STRIKE_CONE;
  }

  /** How heavy a horseman is in a clash with other horsemen (speed and wedge included). */
  clashWeight(r: Soldier): number {
    return r.mass * this.chargeWeight(r) * (r.squad ? 1 + C.COHESION_WEIGHT * r.squad.cohesion : 1);
  }

  /** Add clash shock to an AI squadron; past the threshold it breaks and scatters. */
  private shockSquad(sq: Squadron, amount: number, from: Soldier, byPlayer: boolean): void {
    if (sq === this.player) return;
    sq.shock += amount;
    if (sq.shock < C.SQUAD_BREAK_SHOCK || sq.phase === 'broken' || sq.phase === 'retreat') return;
    const L = sq.riders[0];
    sq.phase = 'broken';
    sq.phaseTimer = C.SQUAD_BROKEN_TIME;
    sq.fleeFrom = { x: from.x, y: from.y };
    sq.shock = 0;
    sq.targetSquad = null;
    sq.targetBat = null;
    if (L) this.events.push({ type: 'squad-break', x: L.x, y: L.y, team: sq.team, byPlayer });
  }

  /** Riders keep the momentum collisions left them (their steering builds on it next step). */
  private syncRiderSpeeds(): void {
    for (const sq of this.squadrons) {
      for (const r of sq.riders) {
        r.speed = Math.max(0, r.vx * Math.cos(r.facing) + r.vy * Math.sin(r.facing));
      }
    }
  }


  // --- Arrows ---------------------------------------------------------------------

  private updateArrows(dt: number): void {
    const remaining: Arrow[] = [];
    for (const a of this.arrows) {
      a.t += dt;
      if (a.t < a.flight) { remaining.push(a); continue; }
      const near = this.grid.query(a.tx, a.ty, C.ARROW_HIT_RADIUS + 8, this.near);
      let victim: Soldier | null = null;
      let best = Infinity;
      for (const s of near) {
        if (!s.alive || s.team === a.team) continue;
        const d = Math.hypot(s.x - a.tx, s.y - a.ty);
        if (d < C.ARROW_HIT_RADIUS + s.radius && d < best) { best = d; victim = s; }
      }
      const angle = Math.atan2(a.ty - a.sy, a.tx - a.sx);
      if (victim) {
        if (victim.rider) this.damageRider(victim, C.ARROW_DAMAGE_RIDER, angle, false, 'front');
        else this.damageSoldier(victim, C.ARROW_DAMAGE_INFANTRY, angle, false, 'front');
      }
      this.events.push({ type: 'arrow-land', x: a.tx, y: a.ty, angle, hit: !!victim, team: a.team });
    }
    this.arrows = remaining;
    this.volleys = this.volleys.filter(v => (v.t += dt) < v.flight + 0.2);
  }

  // --- Camp, morale, outcome --------------------------------------------------------

  private nearestCamp(p: Vec2): { x: number; y: number } {
    let best = C.CAMPS[0], bestD = Infinity;
    for (const c of C.CAMPS) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** A fresh rider joins the camp's garrison troop (forming one if it is empty). */
  private growGarrison(camp: { x: number; y: number; garrison: Squadron | null }): void {
    const g = camp.garrison;
    let r: Soldier;
    if (!g || g.riders.length === 0 || !this.squadrons.includes(g)) {
      camp.garrison = this.addSquad({ team: 'blue', ai: 'garrison', x: camp.x, y: camp.y, facing: -Math.PI / 2, count: 1 });
      r = camp.garrison.riders[0];
    } else {
      if (g.riders.length >= C.GARRISON_MAX) return;
      r = this.addRider(g, camp.x + (this.rand() - 0.5) * 30, camp.y + 24 + this.rand() * 10, -Math.PI / 2);
    }
    this.events.push({ type: 'garrison', x: r.x, y: r.y, id: r.id });
  }

  /**
   * Camps are pit stops. Garrisons fill up while you are away; ride into one and the
   * whole troop falls in behind you (see checkJoins). Entering a camp heals every
   * rider to full at once — no waiting about.
   */
  private updateCamp(dt: number): void {
    for (const camp of this.camps) {
      if (!this.muster || this.outcome !== 'playing') break;
      const g = camp.garrison;
      if (g && g.riders.length >= C.GARRISON_MAX && this.squadrons.includes(g)) continue;
      camp.timer -= dt;
      if (camp.timer <= 0) {
        camp.timer = C.GARRISON_INTERVAL;
        this.growGarrison(camp);
      }
    }
    // Allied troops resting in a camp tend their wounds too.
    for (const sq of this.squadrons) {
      const AL = sq.riders[0];
      if (sq === this.player || sq.team !== 'blue' || !AL) continue;
      const c = this.nearestCamp(AL);
      if (Math.hypot(AL.x - c.x, AL.y - c.y) < C.CAMP_R) {
        for (const r of sq.riders) r.hp = Math.min(r.maxHp, r.hp + C.CAMP_HEAL * dt);
      }
    }
    const L = this.leader;
    const camp = L ? this.nearestCamp(L) : null;
    // Leaving counts only well clear of the ring, so weaving along its edge can't re-heal.
    const reach = this.inCamp ? C.CAMP_R * 1.3 : C.CAMP_R;
    const inCamp = !!L && !!camp && Math.hypot(L.x - camp.x, L.y - camp.y) < reach;
    if (inCamp && !this.inCamp) {
      let healed = 0;
      for (const r of this.riders) {
        if (r.hp < r.maxHp) { healed++; r.hp = r.maxHp; }
      }
      this.events.push({ type: 'pit-stop', x: L!.x, y: L!.y, healed });
    }
    this.inCamp = inCamp;
  }

  private updateMorale(dt: number): void {
    const lost = { blue: 0, red: 0 }, total = { blue: 0, red: 0 };
    for (const b of this.battalions) {
      total[b.team] += b.initial;
      if (b.routed) { lost[b.team] += b.initial; continue; }
      const alive = this.members(b).length;
      lost[b.team] += b.initial - alive;
      if (alive === 0) { b.routed = true; continue; }
      const drain = this.outcome === 'playing' ? this.armyDrain[b.team] : 0;
      if (drain > 0) b.morale -= drain * dt; // a wavering army: heart drains, nothing recovers
      else if (b.sinceShock > C.MORALE_RECOVERY_DELAY) {
        const cap = C.MORALE_CAP_BASE + (100 - C.MORALE_CAP_BASE) * (alive / b.initial);
        if (b.morale < cap) b.morale = Math.min(cap, b.morale + C.MORALE_RECOVERY * dt);
      }
      if (b.morale <= 0 || alive < b.initial * C.ROUT_STRENGTH || this.time >= b.breakAt) {
        this.rout(b);
        lost[b.team] += alive; // the men still standing now run too
      }
    }
    this.updateArmies(lost, total);
  }

  /**
   * Each army's heart follows how much of it is dead or fled. Low, the army wavers
   * and its battalions slowly lose heart; out, it collapses — the rest break one by
   * one, the shakiest first. One giant battle, and when it's won it's won.
   */
  private updateArmies(lost: Record<Team, number>, total: Record<Team, number>): void {
    if (this.outcome !== 'playing') return;
    for (const team of ['red', 'blue'] as const) {
      if (this.armyBroken[team] || total[team] === 0) continue;
      let loss = lost[team] / total[team];
      if (team === 'red' && this.generalFallen) loss += C.GENERAL_ARMY_SHOCK;
      this.armyLoss[team] = loss;
      // Reinforcements still on the way keep an army in the fight.
      if (team === 'red' && this.pendingWaves.length > 0) continue;
      const morale = this.armyMorale(team);
      if (!this.armyWavered[team] && morale < C.ARMY_WAVER) {
        this.armyWavered[team] = true;
        this.events.push({ type: 'army-waver', team });
      }
      this.armyDrain[team] = morale < C.ARMY_WAVER ? C.ARMY_DRAIN * (1 - morale / C.ARMY_WAVER) : 0;
      if (loss >= C.ARMY_BREAK[team]) this.breakArmy(team);
    }
  }

  /** Morale is gone: the remaining battalions give up one after another, shakiest first. */
  private breakArmy(team: Team): void {
    this.armyBroken[team] = true;
    this.armyLoss[team] = C.ARMY_BREAK[team];
    const standing = this.battalions.filter(b => b.team === team && !b.routed).sort((a, b) => a.morale - b.morale);
    let x = 0, y = 0;
    standing.forEach((b, i) => {
      const k = standing.length > 1 ? i / (standing.length - 1) : 0;
      b.breakAt = this.time + C.ARMY_COLLAPSE_MIN + k * C.ARMY_COLLAPSE_TIME + this.rand() * 0.8;
      x += b.x; y += b.y;
    });
    const n = Math.max(1, standing.length);
    if (standing.length === 0) { x = C.WORLD_W / 2; y = C.FRONT_Y; }
    this.events.push({ type: 'army-break', team, x: x / n, y: y / n });
  }

  private rout(b: Battalion): void {
    b.routed = true;
    b.morale = 0;
    for (const s of this.members(b)) {
      s.fleeing = true;
      s.fleeDrift = (this.rand() - 0.5) * 0.9;
    }
    const byPlayer = this.time - b.lastPlayerHit < C.ROUT_CREDIT_WINDOW;
    if (byPlayer && b.team === 'red') {
      this.routsByPlayer++;
      this.score += C.ROUT_SCORE;
    }
    this.events.push({ type: 'rout', x: b.x, y: b.y, team: b.team, byPlayer, type2: b.type });
    // A broken line is a hole: the nearest reserve marches up to plug it.
    if (b.role === 'front') {
      let plug: Battalion | null = null;
      let best: number = C.PLUG_RANGE;
      for (const o of this.battalions) {
        if (o.team !== b.team || o.routed || o.role !== 'reserve') continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < best) { best = d; plug = o; }
      }
      if (plug) plug.role = 'front';
    }
    // Panic spreads to neighbours.
    for (const o of this.battalions) {
      if (o === b || o.routed || o.team !== b.team) continue;
      if (Math.hypot(o.x - b.x, o.y - b.y) < C.ROUT_CASCADE_RADIUS) {
        o.morale -= C.ROUT_CASCADE;
        o.sinceShock = 0;
      }
    }
  }

  private checkOutcome(): void {
    if (this.outcome !== 'playing') return;
    const redGone = this.battalions.every(b => b.team !== 'red' || b.routed);
    if (this.pendingWaves.length === 0 && redGone
      && (this.armyBroken.red || this.squadrons.every(sq => sq.team !== 'red' || sq.riders.length === 0))) {
      // Every battalion has run (the knights quit the field with them).
      this.outcome = 'victory';
      this.outcomeReason = this.generalFallen ? 'Their general is dead and the enemy army flees!' : 'The enemy army breaks and flees!';
    } else if (this.battalions.every(b => b.team !== 'blue' || b.role !== 'front' || b.routed)) {
      this.outcome = 'defeat';
      this.outcomeReason = this.armyBroken.blue ? 'Our army has lost heart and flees.' : 'Our battle line has collapsed.';
    } else if (this.riders.length === 0 && this.leader === null && this.ridersLost > 0) {
      this.outcome = 'defeat';
      this.outcomeReason = 'Your squadron has fallen.';
    }
  }
}

export function rotate(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
