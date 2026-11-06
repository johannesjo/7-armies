import { Team, UnitType, Vec2 } from '../types';
import { CHARGE as C, AttackSide } from './config';
import { SpatialGrid } from './spatial';

export interface ChargeInput {
  /** Desired travel direction in world space; magnitude 0..1 (joystick deflection). */
  dirX: number;
  dirY: number;
  /** Spur the horses into a full gallop (drains stamina). */
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
  kbx: number;
  kby: number;
  facing: number;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
  fleeing: boolean;
  bat: Battalion | null;
  attackTimer: number;
  trampleImmune: number;
  /** Player squadron member. */
  rider: boolean;
  /** Scalar ground speed (riders). */
  speed: number;
  /** Lateral drift for fleeing soldiers so routs fan out. */
  fleeDrift: number;
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
  | { type: 'rider-hit'; x: number; y: number; id: number; damage: number }
  | { type: 'rider-down'; x: number; y: number; angle: number; id: number; wasLeader: boolean }
  | { type: 'rally'; x: number; y: number; id: number }
  | { type: 'rout'; x: number; y: number; team: Team; byPlayer: boolean; type2: UnitType }
  | { type: 'combo'; count: number }
  | { type: 'wave'; index: number; battalions: number; x: number; y: number };

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
  /** Player squadron in command order; riders[0] is the leader you control. */
  riders: Soldier[] = [];
  arrows: Arrow[] = [];
  volleys: Volley[] = [];
  events: SimEvent[] = [];

  time = 0;
  stamina: number = C.STAMINA_MAX;
  galloping = false;
  score = 0;
  kills = 0;
  routsByPlayer = 0;
  ridersLost = 0;
  combo = 0;
  bestCombo = 0;
  outcome: Outcome = 'playing';
  outcomeReason = '';
  inCamp = false;

  /** Reinforcement waves not yet on the field. */
  pendingWaves: Wave[] = [];
  wavesArrived = 0;
  private comboTimer = 0;
  private rallyTimer = 0;
  private nextId = 1;
  private nextVolley = 1;
  private readonly rand: () => number;
  private readonly grid = new SpatialGrid<Soldier>(C.WORLD_W, C.WORLD_H, 24);
  private readonly near: Soldier[] = [];
  private readonly slots = wedgeSlots(C.SQUAD_SIZE * 2);

  constructor(specs: BattalionSpec[], opts: {
    seed?: number;
    squad?: { x: number; y: number; facing: number; count?: number } | null;
    waves?: Wave[];
  } = {}) {
    this.rand = mulberry32(opts.seed ?? 1);
    for (const spec of specs) this.addBattalion(spec);
    this.pendingWaves = [...(opts.waves ?? [])].sort((a, b) => a.time - b.time);
    if (opts.squad !== null) {
      const sq = opts.squad ?? { x: C.CAMP_X + 60, y: C.CAMP_Y - 80, facing: -Math.PI / 4 };
      const count = sq.count ?? C.SQUAD_SIZE;
      for (let i = 0; i < count; i++) {
        const slot = i === 0 ? { x: 0, y: 0 } : this.slots[i - 1];
        const p = rotate(slot, sq.facing);
        this.addRider(sq.x + p.x, sq.y + p.y, sq.facing);
      }
    }
  }

  get leader(): Soldier | null {
    return this.riders[0] ?? null;
  }

  /** All red soldiers in the battle, including reinforcements still on the march. */
  get initialRed(): number {
    return this.battalions.filter(b => b.team === 'red').reduce((s, b) => s + b.initial, 0) + this.pendingRed;
  }

  private get pendingRed(): number {
    let n = 0;
    for (const w of this.pendingWaves) for (const sp of w.specs) if (sp.team === 'red') n += sp.count;
    return n;
  }

  /** Red soldiers still standing in formation (not routed), plus those yet to arrive. */
  get redStanding(): number {
    let n = this.pendingRed;
    for (const b of this.battalions) if (b.team === 'red' && !b.routed) n += this.members(b).length;
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
    };
    for (let i = 0; i < spec.count; i++) {
      const p = this.slotPos(bat, i);
      const s = this.makeSoldier(spec.team, spec.type, p.x, p.y, spec.facing);
      s.bat = bat;
      s.attackTimer = this.rand() * C.MELEE_COOLDOWN_MAX;
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
      vx: 0, vy: 0, kbx: 0, kby: 0,
      facing,
      hp: C.INFANTRY_HP[type],
      maxHp: C.INFANTRY_HP[type],
      radius: C.INFANTRY_RADIUS[type],
      alive: true,
      fleeing: false,
      bat: null,
      attackTimer: 0,
      trampleImmune: 0,
      rider: false,
      speed: 0,
      fleeDrift: 0,
    };
  }

  private addRider(x: number, y: number, facing: number): Soldier {
    const r = this.makeSoldier('blue', 'cavalry', x, y, facing);
    r.rider = true;
    r.hp = r.maxHp = C.RIDER_HP;
    r.radius = C.RIDER_RADIUS;
    this.riders.push(r);
    this.soldiers.push(r);
    return r;
  }

  /** World position of formation slot i (row 0 is the front rank). */
  slotPos(b: Battalion, i: number): Vec2 {
    const rows = Math.ceil(b.grid.length / b.cols);
    const col = i % b.cols;
    const row = Math.floor(i / b.cols);
    const local = {
      x: ((rows - 1) / 2 - row) * b.spacing,
      y: (col - (b.cols - 1) / 2) * b.spacing,
    };
    const p = rotate(local, b.facing);
    return { x: b.x + p.x, y: b.y + p.y };
  }

  // ---------------------------------------------------------------------------

  step(dt: number, input: ChargeInput = NO_INPUT): void {
    this.events.length = 0;
    if (dt <= 0) return;
    this.time += dt;

    this.spawnWaves();
    this.steerSquad(dt, input);
    this.updateBattalions(dt);
    this.moveInfantry(dt);
    this.rebuildGrid();
    this.riderCombat(dt);
    this.infantryCombat(dt);
    this.separate();
    this.updateArrows(dt);
    this.updateCamp(dt);
    this.updateMorale(dt);

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;

    this.soldiers = this.soldiers.filter(s => s.alive);
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
      const n = Math.max(1, wave.specs.length);
      this.events.push({ type: 'wave', index: this.wavesArrived, battalions: wave.specs.length, x: x / n, y: y / n });
    }
  }

  // --- Squadron ---------------------------------------------------------------

  private steerSquad(dt: number, input: ChargeInput): void {
    const L = this.leader;
    if (!L) return;

    let mag = Math.min(1, Math.hypot(input.dirX, input.dirY));
    let desired = mag > 0.2 ? Math.atan2(input.dirY, input.dirX) : L.facing;
    const wantsGallop = input.gallop && this.stamina > (this.galloping ? 0.5 : C.STAMINA_MIN_TO_GALLOP);
    // Spurring with no direction charges straight ahead.
    if (wantsGallop && mag <= 0.2) { mag = 1; desired = L.facing; }

    let targetSpeed = 0;
    if (mag > 0.2) {
      const speedT = clamp01((L.speed - C.CANTER_SPEED * 0.5) / (C.GALLOP_SPEED - C.CANTER_SPEED * 0.5));
      const turnRate = C.TURN_RATE_SLOW + (C.TURN_RATE_FAST - C.TURN_RATE_SLOW) * speedT;
      const diff = angleDiff(desired, L.facing);
      L.facing = turnToward(L.facing, desired, turnRate * dt);
      targetSpeed = wantsGallop ? C.GALLOP_SPEED : C.CANTER_SPEED * Math.min(1, mag * 1.25);
      // Hauling the horse around sheds speed.
      if (Math.abs(diff) > 1.6) targetSpeed = Math.min(targetSpeed, C.CANTER_SPEED * 0.7);
    }

    if (L.speed < targetSpeed) {
      L.speed = Math.min(targetSpeed, L.speed + (wantsGallop ? C.GALLOP_ACCEL : C.ACCEL) * dt);
    } else {
      L.speed = Math.max(targetSpeed, L.speed - C.COAST_DECEL * dt);
    }

    this.galloping = wantsGallop && L.speed > C.CANTER_SPEED;
    if (this.galloping) this.stamina = Math.max(0, this.stamina - C.STAMINA_DRAIN * dt);
    else this.stamina = Math.min(C.STAMINA_MAX, this.stamina + C.STAMINA_REGEN * (this.inCamp ? C.CAMP_STAMINA_MULT : 1) * dt);

    L.vx = Math.cos(L.facing) * L.speed;
    L.vy = Math.sin(L.facing) * L.speed;
    this.integrateRider(L, dt);

    const maxFollow = C.GALLOP_SPEED * 1.2;
    for (let i = 1; i < this.riders.length; i++) {
      const f = this.riders[i];
      const slot = rotate(this.slots[i - 1], L.facing);
      const dx = L.x + slot.x - f.x;
      const dy = L.y + slot.y - f.y;
      let dvx = L.vx + dx * C.FOLLOW_GAIN - f.vx;
      let dvy = L.vy + dy * C.FOLLOW_GAIN - f.vy;
      const dm = Math.hypot(dvx, dvy);
      const maxDv = C.FOLLOW_ACCEL * dt;
      if (dm > maxDv) { dvx *= maxDv / dm; dvy *= maxDv / dm; }
      f.vx += dvx;
      f.vy += dvy;
      let sp = Math.hypot(f.vx, f.vy);
      if (sp > maxFollow) { f.vx *= maxFollow / sp; f.vy *= maxFollow / sp; sp = maxFollow; }
      f.speed = sp;
      if (sp > 8) f.facing = turnToward(f.facing, Math.atan2(f.vy, f.vx), C.FOLLOWER_TURN_RATE * dt);
      else f.facing = turnToward(f.facing, L.facing, 3 * dt);
      this.integrateRider(f, dt);
    }
  }

  private integrateRider(r: Soldier, dt: number): void {
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    const m = 12;
    if (r.x < m) { r.x = m; if (r === this.leader) r.speed *= 0.9; }
    if (r.x > C.WORLD_W - m) { r.x = C.WORLD_W - m; if (r === this.leader) r.speed *= 0.9; }
    if (r.y < m) { r.y = m; if (r === this.leader) r.speed *= 0.9; }
    if (r.y > C.WORLD_H - m) { r.y = C.WORLD_H - m; if (r === this.leader) r.speed *= 0.9; }
    r.trampleImmune = Math.max(0, r.trampleImmune - dt);
  }

  /** Scale a rider's momentum after an impact. */
  private slowRider(r: Soldier, factor: number): void {
    r.speed *= factor;
    r.vx *= factor;
    r.vy *= factor;
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

  private updateBattalions(dt: number): void {
    const L = this.leader;
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
        if (engaged) continue; // locked in melee — can't wheel or advance
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
      if (L && Math.hypot(L.x - b.home.x, L.y - b.home.y) < C.RESERVE_AWARE) {
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

  private updateArchers(b: Battalion, dt: number): void {
    const L = this.leader;
    let aim: Vec2 | null = null;
    let atPlayer = false;
    let spread: number = C.VOLLEY_SPREAD_LINE;

    // Red archers can't resist a squadron of horse in range — it draws their fire.
    if (b.team === 'red' && L) {
      const d = Math.hypot(L.x - b.x, L.y - b.y);
      if (d >= C.ARCHER_MIN_RANGE && d <= C.ARCHER_RANGE) {
        const c = this.squadCenter();
        const flight = clamp(d / C.ARROW_SPEED, C.ARROW_MIN_FLIGHT, C.ARROW_MAX_FLIGHT);
        const lead = 0.55 + this.rand() * 0.45;
        aim = { x: c.x + L.vx * flight * lead, y: c.y + L.vy * flight * lead };
        atPlayer = true;
        spread = C.VOLLEY_SPREAD_PLAYER;
      }
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
      * (atPlayer ? 1 : C.LINE_VOLLEY_INTERVAL_MULT);

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

  squadCenter(): Vec2 {
    if (this.riders.length === 0) return { x: 0, y: 0 };
    let x = 0, y = 0;
    for (const r of this.riders) { x += r.x; y += r.y; }
    return { x: x / this.riders.length, y: y / this.riders.length };
  }

  /** Close ranks: survivors step forward into gaps of their file. */
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
    const kbDecay = Math.exp(-7 * dt);
    for (const b of this.battalions) if (!b.routed) this.closeRanks(b);

    for (const s of this.soldiers) {
      if (s.rider || !s.alive) continue;
      s.trampleImmune = Math.max(0, s.trampleImmune - dt);
      const maxSpeed = C.INFANTRY_SPEED[s.type];
      let dvx = 0, dvy = 0;

      if (s.fleeing) {
        const dir = s.team === 'red' ? -1 : 1;
        dvx = s.fleeDrift * C.FLEE_SPEED;
        dvy = dir * C.FLEE_SPEED;
        s.facing = turnToward(s.facing, Math.atan2(dvy, dvx), 6 * dt);
      } else if (s.bat) {
        const idx = s.bat.grid.indexOf(s);
        const p = this.slotPos(s.bat, idx);
        dvx = (p.x - s.x) * 3;
        dvy = (p.y - s.y) * 3;
        const m = Math.hypot(dvx, dvy);
        if (m > maxSpeed) { dvx *= maxSpeed / m; dvy *= maxSpeed / m; }
      }

      s.vx = dvx;
      s.vy = dvy;
      s.x += (dvx + s.kbx) * dt;
      s.y += (dvy + s.kby) * dt;
      s.kbx *= kbDecay;
      s.kby *= kbDecay;

      if (s.fleeing && (s.y < -30 || s.y > C.WORLD_H + 30 || s.x < -30 || s.x > C.WORLD_W + 30)) {
        s.alive = false; // escaped the field
      }
    }
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const s of this.soldiers) if (s.alive) this.grid.insert(s);
  }

  // --- Combat -------------------------------------------------------------------

  private victimFacing(s: Soldier): number {
    return s.fleeing || !s.bat ? s.facing : s.bat.facing;
  }

  private riderCombat(dt: number): void {
    const riders = this.riders.slice();
    for (const r of riders) {
      if (!r.alive) continue;
      r.attackTimer -= dt;
      const heading = r.speed > 5 ? Math.atan2(r.vy, r.vx) : r.facing;
      const near = this.grid.query(r.x, r.y, r.radius + 8 + C.RIDER_REACH, this.near);
      let meleeTarget: Soldier | null = null;
      let meleeD = Infinity;

      for (const s of near) {
        if (!s.alive || s.team === r.team) continue;
        const dx = s.x - r.x, dy = s.y - r.y;
        const d = Math.hypot(dx, dy);
        const contact = r.radius + s.radius + 2;

        if (r.speed >= C.CHARGE_MIN_SPEED && d < contact) {
          if (s.trampleImmune > 0) continue;
          s.trampleImmune = C.TRAMPLE_IMMUNITY;
          const side = attackSide(heading, this.victimFacing(s));
          const braced = s.type === 'pikeman' && side === 'front' && !s.fleeing;
          const speedK = clamp(r.speed / C.GALLOP_SPEED, 0.5, 1.15);
          let dmg = C.IMPACT_DAMAGE * speedK * sideMultiplier(side);
          if (braced) {
            dmg *= 0.5;
            this.slowRider(r, C.PIKE_FRONT_SLOWDOWN);
            this.damageRider(r, C.PIKE_FRONT_DAMAGE, heading + Math.PI);
          } else {
            this.slowRider(r, C.IMPACT_SLOWDOWN);
          }
          // Shove the victim aside — the charge splits the formation.
          const nx = Math.cos(heading), ny = Math.sin(heading);
          const cross = nx * dy - ny * dx;
          const sign = cross >= 0 ? 1 : -1;
          s.kbx += -ny * sign * C.KNOCKBACK_SIDE + nx * C.KNOCKBACK_FORWARD;
          s.kby += nx * sign * C.KNOCKBACK_SIDE + ny * C.KNOCKBACK_FORWARD;

          if (s.bat) {
            s.bat.morale -= C.IMPACT_SHOCK[side];
            s.bat.sinceShock = 0;
            s.bat.lastPlayerHit = this.time;
          }
          this.events.push({ type: 'impact', x: s.x, y: s.y, angle: heading, side, pike: braced });
          this.damageSoldier(s, dmg, heading, true, side);
          if (!r.alive) break;
          continue;
        }

        if (d < r.radius + s.radius + C.RIDER_REACH && d < meleeD) {
          meleeD = d;
          meleeTarget = s;
        }
      }

      // Too slow to trample: fight from the saddle.
      if (r.alive && meleeTarget && r.speed < C.CHARGE_MIN_SPEED && r.attackTimer <= 0) {
        r.attackTimer = C.RIDER_MELEE_COOLDOWN;
        const ang = Math.atan2(meleeTarget.y - r.y, meleeTarget.x - r.x);
        const side = attackSide(ang, this.victimFacing(meleeTarget));
        if (meleeTarget.bat) meleeTarget.bat.lastPlayerHit = this.time;
        this.damageSoldier(meleeTarget, C.RIDER_MELEE_DAMAGE * sideMultiplier(side), ang, true, side);
      }
    }
  }

  private infantryCombat(dt: number): void {
    for (const s of this.soldiers) {
      if (s.rider || !s.alive || s.fleeing) continue;
      s.attackTimer -= dt;
      if (s.attackTimer > 0) continue;

      const reach = s.radius + C.MELEE_REACH + 6;
      const near = this.grid.query(s.x, s.y, reach, this.near);
      let target: Soldier | null = null;
      let best = Infinity;
      for (const o of near) {
        if (!o.alive || o.team === s.team) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < s.radius + o.radius + C.MELEE_REACH && d < best) { best = d; target = o; }
      }
      if (!target) { s.attackTimer = 0.25; continue; }

      if (s.bat) s.bat.engagedTimer = 1.2;
      s.attackTimer = C.MELEE_COOLDOWN_MIN + this.rand() * (C.MELEE_COOLDOWN_MAX - C.MELEE_COOLDOWN_MIN);
      const ang = Math.atan2(target.y - s.y, target.x - s.x);
      s.facing = ang;

      if (target.rider) {
        const braced = s.type === 'pikeman';
        // A galloping rider is past before a sword can land; pikes still bite.
        if (target.speed >= C.CHARGE_MIN_SPEED && !braced) continue;
        if (this.rand() > C.VS_RIDER_HIT_CHANCE) continue;
        const dmg = C.MELEE_DAMAGE[s.type] * (braced ? C.PIKE_VS_RIDER_MULT : 1) * C.VS_RIDER_DAMAGE_MULT;
        this.damageRider(target, dmg, ang);
        continue;
      }

      if (this.rand() > C.MELEE_HIT_CHANCE) continue;
      const side = attackSide(ang, this.victimFacing(target));
      const dmg = C.MELEE_DAMAGE[s.type] * C.TEAM_MELEE_MULT[s.team] * (side === 'front' ? 1 : 1.5);
      this.damageSoldier(target, dmg, ang, false, side);
    }
  }

  private damageSoldier(s: Soldier, dmg: number, angle: number, byPlayer: boolean, side: AttackSide): void {
    if (!s.alive) return;
    if (s.rider) { this.damageRider(s, dmg, angle); return; }
    s.hp -= dmg;
    if (s.hp > 0) {
      this.events.push({ type: 'hit', x: s.x, y: s.y, angle, team: s.team, damage: dmg, id: s.id });
      return;
    }
    s.alive = false;
    let points = 0;
    if (byPlayer) {
      this.kills++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.comboTimer = C.COMBO_WINDOW;
      const comboMult = 1 + Math.min(4, Math.floor(this.combo / 10)) * 0.5;
      points = Math.round(C.KILL_SCORE * sideMultiplier(side) * comboMult);
      this.score += points;
      if (this.combo % 10 === 0) this.events.push({ type: 'combo', count: this.combo });
    }
    const b = s.bat;
    if (b && !b.routed && !s.fleeing) {
      const perDeath = 100 / (b.initial * C.MORALE_LOSS_SHARE);
      b.morale -= perDeath * (byPlayer ? C.SIDE_MORALE_FACTOR[side] : 1);
      b.sinceShock = 0;
    }
    this.events.push({ type: 'kill', x: s.x, y: s.y, angle, team: s.team, id: s.id, byPlayer, side, points });
  }

  private damageRider(r: Soldier, dmg: number, angle: number): void {
    if (!r.alive) return;
    r.hp -= dmg;
    this.events.push({ type: 'rider-hit', x: r.x, y: r.y, id: r.id, damage: dmg });
    if (r.hp > 0) return;
    r.alive = false;
    const wasLeader = r === this.leader;
    if (wasLeader && this.riders.length > 1) {
      // The next rider takes up the banner and keeps the leader's momentum.
      const next = this.riders[1];
      next.speed = Math.max(next.speed, r.speed * 0.8);
      next.facing = r.facing;
    }
    this.riders = this.riders.filter(x => x !== r);
    this.ridersLost++;
    this.events.push({ type: 'rider-down', x: r.x, y: r.y, angle, id: r.id, wasLeader });
  }

  /** Soft collision: infantry push apart; riders shove infantry but are not stopped by them. */
  private separate(): void {
    for (const a of this.soldiers) {
      if (!a.alive) continue;
      const near = this.grid.query(a.x, a.y, a.radius + 8, this.near);
      for (const b of near) {
        if (b.id <= a.id || !b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d);
        const nx = dx / d, ny = dy / d;
        let wa = 0.5, wb = 0.5;
        if (a.rider && !b.rider) { wa = 0.1; wb = 0.9; }
        else if (b.rider && !a.rider) { wa = 0.9; wb = 0.1; }
        a.x -= nx * push * wa; a.y -= ny * push * wa;
        b.x += nx * push * wb; b.y += ny * push * wb;
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
        if (victim.rider) this.damageRider(victim, C.ARROW_DAMAGE_RIDER, angle);
        else this.damageSoldier(victim, C.ARROW_DAMAGE_INFANTRY, angle, false, 'front');
      }
      this.events.push({ type: 'arrow-land', x: a.tx, y: a.ty, angle, hit: !!victim, team: a.team });
    }
    this.arrows = remaining;
    this.volleys = this.volleys.filter(v => (v.t += dt) < v.flight + 0.2);
  }

  // --- Camp, morale, outcome --------------------------------------------------------

  private updateCamp(dt: number): void {
    const L = this.leader;
    this.inCamp = !!L && Math.hypot(L.x - C.CAMP_X, L.y - C.CAMP_Y) < C.CAMP_R;
    if (!this.inCamp || !L) { this.rallyTimer = 0; return; }
    for (const r of this.riders) r.hp = Math.min(r.maxHp, r.hp + C.CAMP_HEAL * dt);
    if (this.riders.length >= C.SQUAD_SIZE) { this.rallyTimer = 0; return; }
    this.rallyTimer += dt;
    if (this.rallyTimer >= C.RALLY_INTERVAL) {
      this.rallyTimer = 0;
      const r = this.addRider(C.CAMP_X + (this.rand() - 0.5) * 30, C.CAMP_Y + 30, L.facing);
      r.speed = L.speed;
      this.events.push({ type: 'rally', x: r.x, y: r.y, id: r.id });
    }
  }

  private updateMorale(dt: number): void {
    for (const b of this.battalions) {
      if (b.routed) continue;
      const alive = this.members(b).length;
      if (alive === 0) { b.routed = true; continue; }
      if (b.sinceShock > C.MORALE_RECOVERY_DELAY) {
        const cap = C.MORALE_CAP_BASE + (100 - C.MORALE_CAP_BASE) * (alive / b.initial);
        if (b.morale < cap) b.morale = Math.min(cap, b.morale + C.MORALE_RECOVERY * dt);
      }
      if (b.morale <= 0 || alive < b.initial * C.ROUT_STRENGTH) this.rout(b);
    }
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
    if (this.pendingWaves.length === 0 && this.battalions.every(b => b.team !== 'red' || b.routed)) {
      this.outcome = 'victory';
      this.outcomeReason = 'The enemy army has broken!';
    } else if (this.battalions.every(b => b.team !== 'blue' || b.role !== 'front' || b.routed)) {
      this.outcome = 'defeat';
      this.outcomeReason = 'Our battle line has collapsed.';
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
