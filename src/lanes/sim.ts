import { Team, Vec2 } from '../types';
import { CHARGE as C } from '../charge/config';
import { Battalion, ChargeInput, Soldier, Squadron, angleDiff } from '../charge/sim';
import { CommanderEvent, CommanderOptions, CommanderSim, Hero, Obstacle } from '../commanders/sim';
import { LANES as L, enemyOf } from './config';
import { inWoods, lanePath, laneAt, navWaypoint, segmentHitsWoods, structureSpecs } from './map';

export type { AbilityId, Hero } from '../commanders/sim';

export interface Structure {
  id: number;
  team: Team;
  kind: 'tower' | 'keep';
  /** Lane index (-1 for the keep). */
  lane: number;
  /** 0 = keep, 1 = inner tower, 2 = outer tower. */
  tier: number;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  range: number;
  volleyTimer: number;
  /** Sim time it last took damage. */
  lastHit: number;
}

/** What only the lanes report. */
type LaneOnlyEvent =
  | { type: 'tower-down'; team: Team; kind: 'tower' | 'keep'; lane: number; x: number; y: number }
  | { type: 'lane-wave'; index: number }
  /** The siege engines have arrived: walls crumble faster from now on. */
  | { type: 'late-game' }
  | { type: 'under-attack'; team: Team; kind: 'tower' | 'keep'; x: number; y: number }
  /** A commander's riders are hacking at a wall of `team` (alone: with only a quarter of the effect). */
  | { type: 'siege'; team: Team; x: number; y: number; angle: number; alone: boolean };

export type LaneEvent = LaneOnlyEvent | CommanderEvent;

interface LaneInfo {
  lane: number;
  path: Vec2[];
  wp: number;
}

export type LaneSimOptions = CommanderOptions;

function turnToward(current: number, desired: number, maxStep: number): number {
  const d = angleDiff(desired, current);
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

/**
 * The lanes mode: one commander a side, waves of foot down three wide lanes, towers
 * and a keep at each end. Break their keep to win. The commanders (levels, cards,
 * abilities, fog, the rival's mind) come from CommanderSim; this adds the lanes.
 */
export class LaneSim extends CommanderSim<LaneOnlyEvent> {
  readonly structures: Structure[] = [];
  waveIndex = 0;
  readonly towersDown: Record<Team, number> = { blue: 0, red: 0 };
  private nextWave: number = L.FIRST_WAVE;
  private readonly laneInfo = new Map<number, LaneInfo>();
  private readonly paths: Record<Team, Vec2[][]>;
  private readonly underAttackAt = new Map<number, number>();
  private readonly siegeFxAt = new Map<number, number>();

  constructor(opts: LaneSimOptions = {}) {
    super([], { w: L.WORLD_W, h: L.WORLD_H }, opts);
    this.paths = {
      blue: L.LANE_Y.map((_, i) => lanePath('blue', i)),
      red: L.LANE_Y.map((_, i) => lanePath('red', i)),
    };
    let id = 1_000_000;
    for (const s of structureSpecs()) {
      const keep = s.kind === 'keep';
      const hp = keep ? L.KEEP_HP : L.TOWER_HP[s.tier - 1];
      this.structures.push({
        id: id++, team: s.team, kind: s.kind, lane: s.lane, tier: s.tier, x: s.x, y: s.y,
        r: keep ? L.KEEP_R : L.TOWER_R, hp, maxHp: hp, alive: true,
        range: keep ? L.KEEP_RANGE : L.TOWER_RANGE, volleyTimer: 1 + this.rand() * 2, lastHit: -99,
      });
    }
    this.initCommanders();
  }

  /** Back-compatible name for the mode's events. */
  get laneEvents(): LaneEvent[] {
    return this.modeEvents;
  }

  // --- The map, for the commanders --------------------------------------------------------

  protected spawnPoint(team: Team): { x: number; y: number; facing: number } {
    const k = L.KEEP[team];
    const dir = team === 'blue' ? 1 : -1;
    return { x: k.x + dir * 90, y: k.y, facing: team === 'blue' ? 0 : Math.PI };
  }

  protected homePoint(team: Team): Vec2 {
    return L.KEEP[team];
  }

  protected override inWoodsAt(x: number, y: number): boolean {
    return inWoods(x, y);
  }

  protected override visionExtra(team: Team, see: (x: number, y: number, r: number) => void): void {
    for (const st of this.structures) if (st.team === team && st.alive) see(st.x, st.y, st.range + L.SIGHT_TOWER);
  }

  protected override guardedBy(team: Team, p: Vec2, slack = 0): boolean {
    return this.coveredBy(team, p, slack) !== null;
  }

  protected override navTo(from: Vec2, to: Vec2): Vec2 {
    return navWaypoint(from, to);
  }

  protected override obstacles(): readonly Obstacle[] {
    return this.structures;
  }

  /** Lane fights resolve far faster than the battle's long shield-wall grind. */
  protected override baseMelee(): number {
    return L.LANE_MELEE_MULT;
  }

  protected override fleeDir(team: Team): Vec2 {
    return team === 'blue' ? { x: -1, y: 0 } : { x: 1, y: 0 };
  }

  // The battle's army-wide systems have no place here.
  protected override updateCalls(): void { /* no calls for help */ }
  protected override updateCamp(): void { /* the keeps heal instead */ }
  protected override updateArmies(): void { /* no army morale: the keeps decide */ }
  protected override tryRally(): boolean { return false; }

  protected override preStep(dt: number): void {
    super.preStep(dt);
    this.spawnLaneWaves();
  }

  protected override postStep(dt: number): void {
    this.blockStructures();
    this.slowInWoods();
    this.fireStructures(dt);
    this.siege(dt);
    super.postStep(dt);
    this.clearField(dt);
  }

  protected override checkOutcome(): void {
    if (this.outcome !== 'playing') return;
    for (const team of ['blue', 'red'] as const) {
      const keep = this.structures.find(s => s.kind === 'keep' && s.team === team)!;
      if (keep.alive) continue;
      this.winner = enemyOf(team);
      this.outcome = this.winner === 'blue' ? 'victory' : 'defeat';
      this.outcomeReason = this.winner === 'blue' ? 'Their keep has fallen!' : 'Our keep has fallen.';
      return;
    }
  }

  // --- Waves ---------------------------------------------------------------------------

  private spawnLaneWaves(): void {
    if (this.time < this.nextWave || this.outcome !== 'playing') return;
    this.nextWave += L.WAVE_INTERVAL;
    const grow = Math.min(L.WAVE_GROWTH_MAX, Math.floor(this.waveIndex / L.WAVE_GROWTH_EVERY) * L.WAVE_GROWTH);
    this.waveIndex++;
    for (const team of ['blue', 'red'] as const) {
      const dir = team === 'blue' ? 1 : -1;
      const facing = team === 'blue' ? 0 : Math.PI;
      L.LANE_Y.forEach((y, lane) => {
        const x = L.SPAWN_X[team];
        const swords = this.addBattalion({ team, type: 'swordsman', role: 'lane', x: x + dir * 40, y, facing, count: L.WAVE_SWORDS + grow, cols: 10 });
        const pikes = this.addBattalion({ team, type: 'pikeman', role: 'lane', x: x - dir * 30, y, facing, count: L.WAVE_PIKES + grow, cols: 8 });
        for (const b of [swords, pikes]) this.laneInfo.set(b.id, { lane, path: this.paths[team][lane], wp: 1 });
      });
    }
    this.emit({ type: 'lane-wave', index: this.waveIndex });
  }

  /** Lane foot: march down the road, fight enemy foot in the lane, besiege towers. */
  protected override customBattalion(b: Battalion, dt: number): boolean {
    if (b.role !== 'lane') return false;
    const info = this.laneInfo.get(b.id);
    if (!info) return true;
    let alive = 0;
    for (const s of b.grid) if (s && s.alive) alive++;
    if (alive < b.initial * L.LANE_ROUT_SHARE) { this.rout(b); return true; }
    if (b.engagedTimer > 0) {
      // Locked in melee: shove against the foe in front (against horsemen, stand and fight).
      if (this.nearestEnemyBattalion(b, C.PUSH_RANGE)) this.pressLine(b, dt);
      return true;
    }
    const foe = this.laneFoe(b, L.AGGRO);
    if (foe) {
      // The enemy is busy with another of ours: wheel into its flank instead of piling in.
      const busy = foe.engagedTimer > 0 && this.battalions.some(m => m !== b && m.team === b.team && !m.routed
        && Math.hypot(m.x - foe.x, m.y - foe.y) < C.PUSH_RANGE);
      if (busy) {
        const px = -Math.sin(foe.facing), py = Math.cos(foe.facing);
        const half = (foe.cols / 2) * foe.spacing + b.spacing * 2;
        const side = (b.x - foe.x) * px + (b.y - foe.y) * py >= 0 ? 1 : -1;
        this.marchTo(b, foe.x + px * side * half, foe.y + py * side * half, L.LANE_MARCH, dt, foe);
      } else {
        this.marchTo(b, foe.x, foe.y, L.LANE_MARCH, dt, foe);
      }
      return true;
    }
    const st = this.siegeTargetFor(b);
    if (st) {
      const dx = st.x - b.x, dy = st.y - b.y, d = Math.hypot(dx, dy) || 1;
      const rows = Math.ceil(b.grid.length / b.cols);
      const stand = st.r + (rows * b.spacing) / 2 + 6;
      if (d > stand + 2) this.marchTo(b, st.x - (dx / d) * stand, st.y - (dy / d) * stand, L.LANE_MARCH, dt, st);
      else b.facing = turnToward(b.facing, Math.atan2(dy, dx), C.BATTALION_TURN_RATE * 2 * dt);
      return true;
    }
    // On down the road.
    let wp = info.path[Math.min(info.wp, info.path.length - 1)];
    if (Math.hypot(wp.x - b.x, wp.y - b.y) < 30 && info.wp < info.path.length - 1) {
      info.wp++;
      wp = info.path[info.wp];
    }
    this.marchTo(b, wp.x, wp.y, L.LANE_MARCH, dt, null);
    return true;
  }

  private marchTo(b: Battalion, x: number, y: number, speed: number, dt: number, face: { x: number; y: number } | null): void {
    const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
    const f = face ?? { x, y };
    const fd = Math.hypot(f.x - b.x, f.y - b.y);
    if (fd > 2) b.facing = turnToward(b.facing, Math.atan2(f.y - b.y, f.x - b.x), C.BATTALION_TURN_RATE * 1.6 * dt);
    if (d < 1) return;
    const step = Math.min(d, speed * dt);
    b.x += (dx / d) * step;
    b.y += (dy / d) * step;
  }

  /** Whether two points are in the same stretch of open ground (a lane, or a base). */
  private sameGround(ax: number, ay: number, bx: number, by: number): boolean {
    const inBase = (x: number) => x < L.WOODS_X0 || x > L.WOODS_X1;
    if (inBase(ax) && inBase(bx)) return true;
    return laneAt(ay) === laneAt(by);
  }

  private laneFoe(b: Battalion, range: number): Battalion | null {
    let best: Battalion | null = null;
    let bestD = range;
    for (const o of this.battalions) {
      if (o.team === b.team || o.routed) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d < bestD && this.sameGround(b.x, b.y, o.x, o.y)) { bestD = d; best = o; }
    }
    return best;
  }

  /** Vulnerable enemy tower or keep a lane battalion should besiege, if any is near. */
  private siegeTargetFor(b: Battalion): Structure | null {
    let best: Structure | null = null;
    let bestD: number = L.SIEGE_AGGRO;
    for (const st of this.structures) {
      if (!st.alive || st.team === b.team || !this.vulnerable(st)) continue;
      const d = Math.hypot(st.x - b.x, st.y - b.y);
      if (d < bestD && this.sameGround(b.x, b.y, st.x, st.y)) { bestD = d; best = st; }
    }
    return best;
  }

  // --- Towers and keeps -----------------------------------------------------------------

  /** Towers fall in order: outer, then inner; the keep only once an inner tower is down. */
  vulnerable(st: Structure): boolean {
    if (!st.alive) return false;
    if (st.kind === 'keep') return this.structures.some(o => o.team === st.team && o.tier === 1 && !o.alive);
    if (st.tier === 2) return true;
    return this.structures.some(o => o.team === st.team && o.lane === st.lane && o.tier === 2 && !o.alive);
  }

  /** Stone doesn't give way: men and horses are pushed out of towers and slide round them. */
  private blockStructures(): void {
    for (const st of this.structures) {
      if (!st.alive) continue;
      const near = this.grid.query(st.x, st.y, st.r + 14, this.near);
      for (const s of near) {
        if (!s.alive) continue;
        const dx = s.x - st.x, dy = s.y - st.y;
        const min = st.r + s.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1;
        const nx = d2 > 1e-6 ? dx / d : 1, ny = d2 > 1e-6 ? dy / d : 0;
        s.x = st.x + nx * min;
        s.y = st.y + ny * min;
        const vn = s.vx * nx + s.vy * ny;
        if (vn < 0) { s.vx -= vn * nx; s.vy -= vn * ny; }
        if (s.rider) s.speed = Math.max(0, s.vx * Math.cos(s.facing) + s.vy * Math.sin(s.facing));
      }
    }
  }

  /** Horses pick their way through the trees. */
  private slowInWoods(): void {
    for (const team of ['blue', 'red'] as const) {
      const h = this.heroes[team];
      const cap = C.CANTER_SPEED * L.WOODS_SLOW * h.mods.speed;
      for (const r of h.sq.riders) {
        if (!inWoods(r.x, r.y)) continue;
        const sp = Math.hypot(r.vx, r.vy);
        if (sp <= cap) continue;
        const k = cap / sp;
        r.vx *= k; r.vy *= k;
        r.speed = Math.min(r.speed, cap);
      }
    }
  }

  /** Is this point covered by one of `team`'s towers or its keep? */
  coveredBy(team: Team, p: Vec2, slack = 0): Structure | null {
    for (const st of this.structures) {
      if (st.alive && st.team === team && Math.hypot(st.x - p.x, st.y - p.y) < st.range + slack) return st;
    }
    return null;
  }

  /** Does the tower have enemy foot in range to shoot at (so it leaves horsemen alone)? */
  private towerBusy(st: Structure): boolean {
    for (const b of this.battalions) {
      if (b.team !== st.team && !b.routed && Math.hypot(b.x - st.x, b.y - st.y) < st.range) return true;
    }
    return false;
  }

  /**
   * Towers loose volleys: at enemy foot in range first; at the enemy commander if no
   * foot are near — or at once if he attacks our commander under the walls.
   */
  private fireStructures(dt: number): void {
    for (const st of this.structures) {
      if (!st.alive) continue;
      st.volleyTimer -= dt;
      if (st.volleyTimer > 0) continue;
      const enemy = enemyOf(st.team);
      const eh = this.heroes[enemy];
      const EL = eh.sq.riders[0];
      const ours = this.heroes[st.team].sq.riders[0];
      const heroIn = !!EL && Math.hypot(EL.x - st.x, EL.y - st.y) < st.range && this.visible(st.team, EL.x, EL.y);
      let squad: Squadron | null = null;
      let bat: Battalion | null = null;
      if (heroIn && ours && Math.hypot(EL.x - ours.x, EL.y - ours.y) < 220) squad = eh.sq;
      if (!squad) {
        let bestD: number = st.range;
        for (const b of this.battalions) {
          if (b.team === st.team || b.routed) continue;
          const d = Math.hypot(b.x - st.x, b.y - st.y);
          if (d < bestD) { bestD = d; bat = b; }
        }
      }
      if (!bat && heroIn) squad = eh.sq;
      if (!squad && !bat) { st.volleyTimer = 0.3; continue; }
      const keep = st.kind === 'keep';
      st.volleyTimer = (keep ? L.KEEP_VOLLEY : L.TOWER_VOLLEY) * (0.9 + this.rand() * 0.2);
      let aim: Vec2;
      let spread: number;
      if (squad) {
        const c = this.squadCenter(squad);
        const d = Math.hypot(c.x - st.x, c.y - st.y);
        const flight = Math.max(C.ARROW_MIN_FLIGHT, Math.min(C.ARROW_MAX_FLIGHT, d / C.ARROW_SPEED));
        const lead = 0.55 + this.rand() * 0.45;
        aim = { x: c.x + EL!.vx * flight * lead, y: c.y + EL!.vy * flight * lead };
        spread = C.VOLLEY_SPREAD_PLAYER;
      } else {
        aim = { x: bat!.x, y: bat!.y };
        spread = 40;
      }
      const count = keep ? L.KEEP_ARROWS : L.TOWER_ARROWS;
      const power = squad ? (keep ? L.KEEP_POWER : L.TOWER_POWER_RIDER) : L.TOWER_POWER_FOOT;
      // A volley at foot still only hits horsemen in the circle at the horsemen's rate.
      const riderPower = squad ? power : L.TOWER_POWER_RIDER;
      this.loose(st, aim, spread, count, power, riderPower, squad !== null && squad === this.player);
    }
  }

  private loose(st: Structure, aim: Vec2, spread: number, count: number, power: number, riderPower: number, atPlayer: boolean): void {
    const dist = Math.hypot(aim.x - st.x, aim.y - st.y);
    const flight = Math.max(C.ARROW_MIN_FLIGHT, Math.min(C.ARROW_MAX_FLIGHT, dist / C.ARROW_SPEED));
    const id = this.nextVolley++;
    this.volleys.push({ id, team: st.team, x: aim.x, y: aim.y, radius: spread + 10, t: 0, flight, atPlayer });
    for (let i = 0; i < count; i++) {
      const ang = this.rand() * Math.PI * 2;
      const rr = Math.sqrt(this.rand()) * spread;
      const sa = this.rand() * Math.PI * 2;
      this.arrows.push({
        sx: st.x + Math.cos(sa) * st.r * 0.5, sy: st.y + Math.sin(sa) * st.r * 0.5,
        tx: aim.x + Math.cos(ang) * rr, ty: aim.y + Math.sin(ang) * rr,
        t: -this.rand() * 0.12, flight, team: st.team, volley: id, power, riderPower,
      });
    }
    this.events.push({ type: 'volley', id, team: st.team, x: aim.x, y: aim.y, radius: spread + 10, flight, atPlayer });
  }

  /** Siege damage multiplier: 1 until the engines arrive, then rising steadily. */
  get siegeLate(): number {
    return 1 + Math.max(0, this.time - L.SIEGE_LATE_START) / L.SIEGE_LATE_DOUBLE;
  }

  /** Foot and horsemen at the walls wear a tower down; at zero it falls. */
  private siege(dt: number): void {
    if (this.time >= L.SIEGE_LATE_START && this.time - dt < L.SIEGE_LATE_START) this.emit({ type: 'late-game' });
    const late = this.siegeLate;
    for (const st of this.structures) {
      if (!st.alive || !this.vulnerable(st)) continue;
      const enemy = enemyOf(st.team);
      let dmg = 0;
      let escorted = false;
      for (const b of this.battalions) {
        if (b.team !== enemy || b.routed) continue;
        const bd = Math.hypot(b.x - st.x, b.y - st.y);
        if (bd < L.BACKDOOR_RADIUS) escorted = true;
        if (bd > st.r + 90) continue;
        for (const s of b.grid) {
          if (!s || !s.alive || s.fleeing || s.down > 0) continue;
          if (Math.hypot(s.x - st.x, s.y - st.y) > st.r + s.radius + C.MELEE_REACH + 3) continue;
          dmg += L.SIEGE_DPS_MAN * dt;
          if (this.rand() < dt / 1.3) s.lastAttack = this.time;
        }
      }
      const h = this.heroes[enemy];
      let hacking = 0;
      let hx = 0, hy = 0;
      for (const r of h.sq.riders) {
        if (r.speed >= C.CHARGE_MIN_SPEED) continue;
        if (Math.hypot(r.x - st.x, r.y - st.y) > st.r + L.SIEGE_REACH_RIDER) continue;
        hacking++;
        hx += r.x; hy += r.y;
        if (this.rand() < dt / 0.8) r.lastAttack = this.time;
      }
      dmg += hacking * L.SIEGE_DPS_RIDER * dt * h.mods.siege * (escorted ? 1 : L.BACKDOOR_MULT);
      if (hacking > 0 && this.time - (this.siegeFxAt.get(st.id) ?? -99) > 0.3) {
        // Chips fly from the wall facing the riders.
        this.siegeFxAt.set(st.id, this.time);
        const a = Math.atan2(hy / hacking - st.y, hx / hacking - st.x);
        this.emit({ type: 'siege', team: st.team, x: st.x + Math.cos(a) * st.r, y: st.y + Math.sin(a) * st.r, angle: a, alone: !escorted });
      }
      if (dmg <= 0) continue;
      st.hp -= dmg * late;
      st.lastHit = this.time;
      const last = this.underAttackAt.get(st.id) ?? -99;
      if (this.time - last > 15) {
        this.underAttackAt.set(st.id, this.time);
        this.emit({ type: 'under-attack', team: st.team, kind: st.kind, x: st.x, y: st.y });
      }
      if (st.hp <= 0) this.destroy(st);
    }
  }

  private destroy(st: Structure): void {
    st.hp = 0;
    st.alive = false;
    const enemy = enemyOf(st.team);
    if (st.kind === 'tower') this.towersDown[enemy]++;
    this.gainXp(this.heroes[enemy], L.XP_TOWER);
    this.emit({ type: 'tower-down', team: st.team, kind: st.kind, lane: st.lane, x: st.x, y: st.y });
  }

  /** Routed men who have run home leave the field; emptied battalions are struck off. */
  private clearField(dt: number): void {
    for (const s of this.soldiers) {
      if (!s.alive || !s.fleeing || !s.bat) continue;
      const home = s.team === 'blue' ? s.x < L.WOODS_X0 - 40 : s.x > L.WOODS_X1 + 40;
      if (home || this.time - s.bat.routedAt > L.FLEE_TIME) s.alive = false;
    }
    if (this.battalions.length > 0 && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) {
      this.battalions = this.battalions.filter(b => {
        if (!b.routed || b.grid.some(s => s && s.alive)) return true;
        this.laneInfo.delete(b.id);
        return false;
      });
      this.pruneShots();
    }
  }

  // --- The rival's work in the lanes --------------------------------------------------------

  /**
   * Work a lane: help our foot break a tower when they're at its walls, ride down enemy
   * foot from the flank or rear, keep clear of enemy towers that have nothing else to
   * shoot at, and hold behind our foremost battalion.
   */
  protected rivalWork(h: Hero, dt: number): ChargeInput {
    const sq = h.sq, ai = h.ai!;
    const Ld = sq.riders[0];
    ai.taskTimer -= dt;
    if (ai.taskTimer <= 0 || ai.task < 0) {
      ai.task = this.chooseLane(h);
      ai.taskTimer = 18 + this.rand() * 8;
    }
    const lane = ai.task;

    // Our foot are at their walls and no enemy foot stand there: help break the tower.
    const st = this.siegeFor(h, lane);
    if (st && !this.battalions.some(b => b.team !== h.team && !b.routed && Math.hypot(b.x - st.x, b.y - st.y) < 260)) {
      sq.targetBat = null;
      const dx = Ld.x - st.x, dy = Ld.y - st.y, d = Math.hypot(dx, dy) || 1;
      const spot = { x: st.x + (dx / d) * (st.r + 14), y: st.y + (dy / d) * (st.r + 14) };
      if (d > 220) return this.goTo(h, spot, true, 0);
      return this.steer(h, this.rideTo(Ld, spot, false), true);
    }

    // Ride down enemy foot in the lane.
    let target = sq.targetBat && !sq.targetBat.routed && sq.phaseTimer > -8 && this.safeTarget(h, sq.targetBat) ? sq.targetBat : null;
    if (!target) {
      target = this.farmTarget(h, lane);
      if (target !== sq.targetBat) { sq.phase = 'approach'; sq.phaseTimer = 0; }
      sq.targetBat = target;
    }
    if (target) {
      const far = Math.hypot(target.x - Ld.x, target.y - Ld.y) > 380 || segmentHitsWoods(Ld.x, Ld.y, target.x, target.y, 14);
      if (far && sq.phase !== 'charge') {
        return this.goTo(h, target, true, 0);
      }
      // Horse archers circle at bowshot; the rest ride round to an open side and charge.
      return this.attackBattalion(h, target);
    }

    // Hold behind our foot in the lane, out of reach of their towers.
    return this.goTo(h, this.holdPoint(h, lane), false, 40);
  }

  /** A battalion is fair game unless an enemy tower with nothing else to shoot covers it. */
  private safeTarget(h: Hero, b: Battalion): boolean {
    const st = this.coveredBy(enemyOf(h.team), b, 40);
    return !st || this.towerBusy(st);
  }

  private farmTarget(h: Hero, lane: number): Battalion | null {
    const Ld = h.sq.riders[0];
    const y = L.LANE_Y[lane];
    let best: Battalion | null = null;
    let bestScore = Infinity;
    for (const b of this.battalions) {
      if (b.team === h.team || b.routed || !this.visible(h.team, b.x, b.y)) continue;
      const inLane = Math.abs(b.y - y) < L.LANE_HALF + 60 || (b.x < L.WOODS_X0 || b.x > L.WOODS_X1);
      if (!inLane || !this.safeTarget(h, b)) continue;
      const d = Math.hypot(b.x - Ld.x, b.y - Ld.y);
      // Pikes facing us are bad going; foot locked in a fight with ours are a gift.
      const facingUs = Math.cos(Math.atan2(Ld.y - b.y, Ld.x - b.x) - b.facing) > 0.5;
      const score = d + (b.type === 'pikeman' && facingUs ? 260 : 0) - (b.engagedTimer > 0 ? 160 : 0);
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  private siegeFor(h: Hero, lane: number): Structure | null {
    for (const st of this.structures) {
      if (st.team === h.team || !this.vulnerable(st) || (st.lane !== lane && st.kind !== 'keep')) continue;
      // Only with our foot at the walls (alone, the walls shrug it off and shoot back).
      if (this.towerBusy(st)) return st;
    }
    return null;
  }

  /** Where to wait in a lane: a little behind our foremost battalion, outside enemy tower range. */
  private holdPoint(h: Hero, lane: number): Vec2 {
    const dir = h.team === 'blue' ? 1 : -1;
    const y = L.LANE_Y[lane];
    let front = L.SPAWN_X[h.team] + dir * 200;
    for (const b of this.battalions) {
      if (b.team !== h.team || b.routed || Math.abs(b.y - y) > L.LANE_HALF) continue;
      if ((b.x - front) * dir > 0) front = b.x;
    }
    let x = front - dir * 110;
    // Not inside an idle enemy tower's reach.
    for (const st of this.structures) {
      if (!st.alive || st.team === h.team || Math.abs(st.y - y) > L.LANE_HALF + 200) continue;
      const edge = st.x - dir * (st.range + 40);
      if ((x - edge) * dir > 0 && !this.towerBusy(st)) x = edge;
    }
    return { x, y: y + (h.team === 'blue' ? -60 : 60) };
  }

  private chooseLane(h: Hero): number {
    const Ld = h.sq.riders[0];
    const enemy = enemyOf(h.team);
    const foe = this.heroes[enemy];
    const F0 = foe.sq.riders[0];
    const F = F0 && this.visible(h.team, F0.x, F0.y) ? F0 : null;
    // Unseen, his strength is a guess: assume an even match.
    const odds = F ? this.strength(h) / Math.max(1, this.strength(foe)) : 1;
    let best = 1, bestScore = -Infinity;
    L.LANE_Y.forEach((y, lane) => {
      // Riding between lanes costs time: stay put unless another lane matters more.
      let score = this.rand() * 0.8 + (lane === h.ai!.task ? 1.2 : 0);
      for (const b of this.battalions) {
        if (b.routed || Math.abs(b.y - y) > L.LANE_HALF || !this.visible(h.team, b.x, b.y)) continue;
        if (b.team === enemy) {
          score += 0.5;
          // Threatening our towers or keep: defend.
          if (this.coveredBy(h.team, b, 250)) score += 3;
        } else if (this.coveredBy(enemy, b, 150)) score += 1.5; // our foot at their walls
      }
      if (F && Math.abs(F.y - y) < L.LANE_HALF + 100) score += odds < 0.9 ? -2 : 0.8;
      score -= Math.abs(Ld.y - y) / 900;
      if (score > bestScore) { bestScore = score; best = lane; }
    });
    return best;
  }
}
