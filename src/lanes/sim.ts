import { Team, Vec2 } from '../types';
import { CHARGE as C } from '../charge/config';
import { Battalion, ChargeInput, ChargeSim, NO_INPUT, RiderMods, Soldier, Squadron, angleDiff, rotate } from '../charge/sim';
import { LANES as L, enemyOf, xpToNext } from './config';
import { ABILITIES, AbilityId, CardId, COMMANDERS, CommanderKind, COMMANDER_KINDS, HeroMods, aiPick, drawOffer, modsFromPicks } from './cards';
import { inWoods, lanePath, laneAt, navWaypoint, segmentHitsWoods, structureSpecs } from './map';

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

/** What the AI commander is about. */
type AiMode = 'lane' | 'home';

interface HeroAi {
  mode: AiMode;
  lane: number;
  laneTimer: number;
  /** Seconds before it picks a card it has been offered. */
  cardDelay: number;
  wp: Vec2 | null;
  wpFor: Vec2 | null;
  navTimer: number;
}

export type { AbilityId };

/** A commander: the squadron, its level, its cards, and whether it is in the saddle. */
export interface Hero {
  team: Team;
  kind: CommanderKind;
  sq: Squadron;
  /** Driven by the AI (the rival; both sides in headless test runs). */
  ai: HeroAi | null;
  level: number;
  xp: number;
  picks: CardId[];
  /** Level-ups waiting for a card to be chosen, each a hand of up to three. */
  offers: CardId[][];
  /** The kit from commander type and cards... */
  mods: HeroMods;
  /** ...and with any ability running right now (what the fighting uses). */
  eff: HeroMods;
  /** The ability of this kind of horse. */
  ability: AbilityId;
  /** Sim time the ability is ready again, and until when it is running. */
  readyAt: number;
  activeUntil: number;
  dead: boolean;
  respawnAt: number;
  deaths: number;
  kills: number;
  /** Sim time a rider of this squadron last took a wound (field surgeons wait for a lull). */
  lastHurt: number;
  remountTimer: number;
  homeTimer: number;
  /** Riding through woods right now. */
  inWoods: boolean;
}

export type LaneEvent =
  | { type: 'level'; team: Team; level: number }
  | { type: 'card'; team: Team; card: CardId }
  | { type: 'tower-down'; team: Team; kind: 'tower' | 'keep'; lane: number; x: number; y: number }
  /** A commander's last rider fell; `slain` when the enemy commander was there to claim it. */
  | { type: 'hero-down'; team: Team; x: number; y: number; respawn: number; slain: boolean }
  | { type: 'hero-up'; team: Team; x: number; y: number }
  | { type: 'lane-wave'; index: number }
  /** The siege engines have arrived: walls crumble faster from now on. */
  | { type: 'late-game' }
  | { type: 'under-attack'; team: Team; kind: 'tower' | 'keep'; x: number; y: number }
  /** A commander's riders are hacking at a wall of `team` (alone: with only a quarter of the effect). */
  | { type: 'siege'; team: Team; x: number; y: number; angle: number; alone: boolean }
  | { type: 'ability'; team: Team; ability: AbilityId; x: number; y: number; count: number };

interface LaneInfo {
  lane: number;
  path: Vec2[];
  wp: number;
}

export interface LaneSimOptions {
  seed?: number;
  /** A human commands the blue squadron (false: AI on both sides, for headless runs). */
  human?: boolean;
  /** Blue's kind of horse (default knights) and red's (default: picked at random). */
  commander?: CommanderKind;
  rivalCommander?: CommanderKind;
  /** Fog of war (default on). */
  fog?: boolean;
}

function turnToward(current: number, desired: number, maxStep: number): number {
  const d = angleDiff(desired, current);
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

/**
 * The lanes mode: one commander a side, waves of foot down three wide lanes, towers
 * and a keep at each end. Break their keep to win. Built on the battle's simulation —
 * the same horses, charges, pikes, morale and arrows.
 */
export class LaneSim extends ChargeSim {
  readonly structures: Structure[] = [];
  readonly heroes: Record<Team, Hero>;
  /** The mode's own events from the last step (plus anything done between steps). */
  laneEvents: LaneEvent[] = [];
  /** Events raised between steps (an ability or card picked from the UI), delivered with the next step. */
  private pendingEvents: LaneEvent[] = [];
  private stepping = false;
  waveIndex = 0;
  winner: Team | null = null;
  readonly towersDown: Record<Team, number> = { blue: 0, red: 0 };
  private nextWave: number = L.FIRST_WAVE;
  private readonly laneInfo = new Map<number, LaneInfo>();
  private readonly paths: Record<Team, Vec2[][]>;
  private readonly underAttackAt = new Map<number, number>();
  private readonly siegeFxAt = new Map<number, number>();
  /** Horse archers: when each rider can loose again. */
  private readonly shotReady = new Map<number, number>();
  /** Fog of war: which cells each side can see (1 = seen). */
  readonly fog: boolean;
  readonly fogCols = Math.ceil(L.WORLD_W / L.FOG_CELL);
  readonly fogRows = Math.ceil(L.WORLD_H / L.FOG_CELL);
  readonly vision: Record<Team, Uint8Array>;
  private fogTimer = 0;
  private readonly woodsCell: Uint8Array;

  constructor(opts: LaneSimOptions = {}) {
    super([], { seed: opts.seed, squad: null, muster: false, world: { w: L.WORLD_W, h: L.WORLD_H } });
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
    this.fog = opts.fog ?? true;
    const cells = this.fogCols * this.fogRows;
    this.vision = { blue: new Uint8Array(cells), red: new Uint8Array(cells) };
    this.woodsCell = new Uint8Array(cells);
    for (let j = 0; j < this.fogRows; j++) {
      for (let i = 0; i < this.fogCols; i++) {
        this.woodsCell[j * this.fogCols + i] = inWoods((i + 0.5) * L.FOG_CELL, (j + 0.5) * L.FOG_CELL) ? 1 : 0;
      }
    }
    const human = opts.human ?? true;
    const make = (team: Team, ai: boolean, kind: CommanderKind): Hero => {
      const p = this.spawnPoint(team);
      const mods = modsFromPicks([], kind);
      const sq = this.addSquad({ team, ai: ai ? 'rival' : 'player', x: p.x, y: p.y, facing: p.facing, count: mods.maxRiders, style: kind === 'knights' ? 'heavy' : 'nimble' });
      for (const r of sq.riders) {
        r.hp = r.maxHp = C.RIDER_HP * mods.hp;
        r.mass = C.MASS.cavalry * mods.mass;
      }
      return {
        team, kind, sq, level: 1, xp: 0, picks: [], offers: [], mods, eff: { ...mods },
        ability: COMMANDERS[kind].ability, readyAt: 0, activeUntil: -1,
        ai: ai ? { mode: 'lane', lane: -1, laneTimer: 0, cardDelay: 0, wp: null, wpFor: null, navTimer: 0 } : null,
        dead: false, respawnAt: 0, deaths: 0, kills: 0, lastHurt: -99, remountTimer: 0, homeTimer: 0, inWoods: false,
      };
    };
    const rivalKind = opts.rivalCommander ?? COMMANDER_KINDS[Math.floor(this.rand() * COMMANDER_KINDS.length)];
    this.heroes = { blue: make('blue', !human, opts.commander ?? 'knights'), red: make('red', true, rivalKind) };
    if (human) this.player = this.heroes.blue.sq;
    this.updateVision();
  }

  /** The human's commander (blue). */
  get me(): Hero {
    return this.heroes.blue;
  }

  get rival(): Hero {
    return this.heroes.red;
  }

  private spawnPoint(team: Team): { x: number; y: number; facing: number } {
    const k = L.KEEP[team];
    const dir = team === 'blue' ? 1 : -1;
    return { x: k.x + dir * 90, y: k.y, facing: team === 'blue' ? 0 : Math.PI };
  }

  // --- Hooks into the battle sim ------------------------------------------------------

  protected override isHero(sq: Squadron | null): boolean {
    return !!sq && (sq === this.heroes?.blue.sq || sq === this.heroes?.red.sq);
  }

  override mods(sq: Squadron | null): Readonly<RiderMods> {
    if (sq && this.heroes) {
      if (sq === this.heroes.blue.sq) return this.heroes.blue.eff;
      if (sq === this.heroes.red.sq) return this.heroes.red.eff;
    }
    return super.mods(sq);
  }

  protected override riderBase(sq: Squadron): { hp: number; mass: number } {
    const h = this.heroes ? (sq === this.heroes.blue.sq ? this.heroes.blue : sq === this.heroes.red.sq ? this.heroes.red : null) : null;
    return { hp: C.RIDER_HP * (h?.mods.hp ?? 1), mass: C.MASS.cavalry * (h?.mods.mass ?? 1) };
  }

  protected override meleeMult(s: Soldier): number {
    let k = L.LANE_MELEE_MULT;
    // A commander's war banner puts heart into the foot around him.
    const h = this.heroes[s.team];
    const HL = h.sq.riders[0];
    if (h.mods.banner > 0 && HL && Math.hypot(HL.x - s.x, HL.y - s.y) < 260) k *= 1 + h.mods.banner;
    return k;
  }

  protected override fleeDir(team: Team): Vec2 {
    return team === 'blue' ? { x: -1, y: 0 } : { x: 1, y: 0 };
  }

  // The battle's army-wide systems have no place here.
  protected override updateCalls(): void { /* no calls for help */ }
  protected override updateCamp(): void { /* the keeps heal instead (see updateHeroes) */ }
  protected override updateArmies(): void { /* no army morale: the keeps decide */ }
  protected override tryRally(): boolean { return false; }

  protected override aiInput(sq: Squadron, dt: number): ChargeInput {
    const h = this.heroOf(sq);
    if (h?.ai) return this.rivalInput(h, dt);
    return super.aiInput(sq, dt);
  }

  heroOf(sq: Squadron | null): Hero | null {
    if (!sq) return null;
    if (sq === this.heroes.blue.sq) return this.heroes.blue;
    if (sq === this.heroes.red.sq) return this.heroes.red;
    return null;
  }

  private emit(e: LaneEvent): void {
    (this.stepping ? this.laneEvents : this.pendingEvents).push(e);
  }

  protected override preStep(dt: number): void {
    this.laneEvents.length = 0;
    for (const e of this.pendingEvents) this.laneEvents.push(e);
    this.pendingEvents.length = 0;
    this.stepping = true;
    this.spawnLaneWaves();
    for (const team of ['blue', 'red'] as const) this.refreshEff(this.heroes[team]);
    void dt;
  }

  protected override postStep(dt: number): void {
    this.blockStructures();
    this.slowInWoods();
    this.fireStructures(dt);
    this.siege(dt);
    this.shootFromSaddle();
    this.updateHeroes(dt);
    this.clearField(dt);
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = L.FOG_INTERVAL;
      this.updateVision();
    }
    this.stepping = false;
  }

  // --- Abilities -----------------------------------------------------------------------

  /** The kit the fighting uses: the commander's, plus his ability while it runs. */
  private refreshEff(h: Hero): void {
    const e = h.eff, m = h.mods;
    Object.assign(e, m);
    if (this.time >= h.activeUntil) return;
    if (h.ability === 'thunder') {
      e.speed = m.speed * L.THUNDER_SPEED;
      e.impact = m.impact * L.THUNDER_IMPACT;
      e.shock = m.shock * L.THUNDER_SHOCK;
      e.strike = m.strike * L.THUNDER_STRIKE;
    }
  }

  /** Seconds until the commander's ability can be used again (0 = ready). */
  cooldown(team: Team): number {
    return Math.max(0, this.heroes[team].readyAt - this.time);
  }

  /** Is the commander's ability running right now? */
  abilityActive(team: Team): boolean {
    return this.time < this.heroes[team].activeUntil;
  }

  /** Use the commander's ability; returns whether it went off. */
  useAbility(team: Team): boolean {
    const h = this.heroes[team];
    const HL = h.sq.riders[0];
    if (h.dead || !HL || this.time < h.readyAt || this.outcome !== 'playing') return false;
    const a = ABILITIES[h.ability];
    let count = h.sq.riders.length;
    if (h.ability === 'storm') {
      // Every rider looses a flight at the nearest enemies in range — nothing in range, no storm.
      count = 0;
      for (const r of h.sq.riders) {
        for (let i = 0; i < L.STORM_ARROWS; i++) if (this.shoot(h, r, L.STORM_RANGE, -i * 0.12)) count++;
      }
      if (count === 0) return false;
    }
    h.readyAt = this.time + a.cooldown;
    h.activeUntil = this.time + a.duration;
    this.refreshEff(h);
    this.emit({ type: 'ability', team, ability: h.ability, x: HL.x, y: HL.y, count });
    return true;
  }

  /** Horse archers loose at the nearest enemy in bowshot, galloping or not. */
  private shootFromSaddle(): void {
    for (const team of ['blue', 'red'] as const) {
      const h = this.heroes[team];
      if (h.mods.archery <= 0 || h.dead) continue;
      const interval = 1 / h.mods.archery;
      for (const r of h.sq.riders) {
        if (this.time < (this.shotReady.get(r.id) ?? 0)) continue;
        if (this.shoot(h, r, L.HA_RANGE, 0)) {
          this.shotReady.set(r.id, this.time + interval * (0.8 + this.rand() * 0.4));
          r.lastAttack = this.time;
        } else this.shotReady.set(r.id, this.time + 0.25);
      }
    }
  }

  /** One arrow from rider `r` at the nearest enemy within `range` (leading him); false if none. */
  private shoot(h: Hero, r: Soldier, range: number, delay: number): boolean {
    const near = this.grid.query(r.x, r.y, range, this.near);
    let best: Soldier | null = null;
    let bestD = range;
    for (const o of near) {
      // Only at what our side can see: no shooting blind into the trees (and giving them away).
      if (!o.alive || o.team === h.team || o.fleeing || !this.visible(h.team, o.x, o.y)) continue;
      const d = Math.hypot(o.x - r.x, o.y - r.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) return false;
    const flight = Math.max(0.35, Math.min(0.95, bestD / 320));
    const tx = best.x + best.vx * flight + (this.rand() - 0.5) * 10;
    const ty = best.y + best.vy * flight + (this.rand() - 0.5) * 10;
    this.arrows.push({
      sx: r.x, sy: r.y, tx, ty, t: delay, flight, team: h.team, volley: -1,
      power: L.HA_POWER_FOOT, riderPower: L.HA_POWER_RIDER, byPlayer: h.sq === this.player,
      shock: L.HA_SHOCK * h.mods.volleyShock,
    });
    return true;
  }

  // --- Fog of war ------------------------------------------------------------------------

  /** Can `team` see this point? (Everything is seen when fog is off.) */
  visible(team: Team, x: number, y: number): boolean {
    if (!this.fog) return true;
    const i = Math.floor(x / L.FOG_CELL), j = Math.floor(y / L.FOG_CELL);
    if (i < 0 || j < 0 || i >= this.fogCols || j >= this.fogRows) return false;
    return this.vision[team][j * this.fogCols + i] === 1;
  }

  /** Each side sees round its foot, its commander and its towers — but only a little way into the woods. */
  private updateVision(): void {
    for (const team of ['blue', 'red'] as const) {
      const v = this.vision[team];
      v.fill(0);
      for (const b of this.battalions) if (b.team === team && !b.routed) this.see(v, b.x, b.y, L.SIGHT_FOOT);
      for (const st of this.structures) if (st.team === team && st.alive) this.see(v, st.x, st.y, st.range + L.SIGHT_TOWER);
      const h = this.heroes[team];
      const HL = h.sq.riders[0];
      if (HL) {
        this.see(v, HL.x, HL.y, L.SIGHT_HERO);
        const tail = h.sq.riders[h.sq.riders.length - 1];
        if (tail !== HL) this.see(v, tail.x, tail.y, L.SIGHT_HERO * 0.6);
      }
      // Your own keep's yard is always in view.
      this.see(v, L.KEEP[team].x, L.KEEP[team].y, L.HOME_R + 120);
    }
  }

  private see(v: Uint8Array, x: number, y: number, r: number): void {
    const c = L.FOG_CELL;
    const i0 = Math.max(0, Math.floor((x - r) / c)), i1 = Math.min(this.fogCols - 1, Math.floor((x + r) / c));
    const j0 = Math.max(0, Math.floor((y - r) / c)), j1 = Math.min(this.fogRows - 1, Math.floor((y + r) / c));
    const r2 = r * r, w2 = L.SIGHT_WOODS * L.SIGHT_WOODS;
    for (let j = j0; j <= j1; j++) {
      const dy = (j + 0.5) * c - y;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * c - x;
        const d2 = dx * dx + dy * dy;
        const k = j * this.fogCols + i;
        if (d2 <= (this.woodsCell[k] ? w2 : r2)) v[k] = 1;
      }
    }
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
      h.inWoods = false;
      const cap = C.CANTER_SPEED * L.WOODS_SLOW * h.mods.speed;
      for (const r of h.sq.riders) {
        if (!inWoods(r.x, r.y)) continue;
        if (r === h.sq.riders[0]) h.inWoods = true;
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

  // --- Commanders -----------------------------------------------------------------------

  private updateHeroes(dt: number): void {
    // Wounds, falls and experience from what happened this step.
    for (const e of this.events) {
      if (e.type === 'rider-hit') {
        for (const team of ['blue', 'red'] as const) {
          const h = this.heroes[team];
          if (h.sq.riders.some(r => r.id === e.id) || h.sq.riders.length === 0) h.lastHurt = this.time;
        }
      } else if (e.type === 'kill') {
        this.xpNear(enemyOf(e.team), e.x, e.y, L.XP_FOOT);
      } else if (e.type === 'rider-down') {
        this.xpNear(enemyOf(e.team), e.x, e.y, L.XP_RIDER);
      } else if (e.type === 'rout') {
        this.xpNear(enemyOf(e.team), e.x, e.y, L.XP_ROUT);
      }
    }
    for (const team of ['blue', 'red'] as const) {
      const h = this.heroes[team];
      const sq = h.sq;
      const keep = L.KEEP[team];
      if (!h.dead && sq.riders.length === 0) {
        // The last rider has fallen: the commander is out until he can ride again.
        h.dead = true;
        h.deaths++;
        const wait = Math.min(L.RESPAWN_MAX, L.RESPAWN_BASE + L.RESPAWN_PER_LEVEL * h.level) * h.mods.respawn;
        h.respawnAt = this.time + wait;
        const foe = this.heroes[enemyOf(team)];
        const last = sq.trail[sq.trail.length - 1];
        const x = last?.x ?? keep.x, y = last?.y ?? keep.y;
        // The kill (and its bounty) is the enemy commander's only if he was in the fight.
        const FL = foe.sq.riders[0];
        const slain = !!FL && Math.hypot(FL.x - x, FL.y - y) < L.XP_RANGE;
        if (slain) {
          foe.kills++;
          this.gainXp(foe, L.XP_HERO_KILL);
        }
        this.emit({ type: 'hero-down', team, x, y, respawn: wait, slain });
        if (h.ai) h.ai.mode = 'lane';
      }
      if (h.dead) {
        if (this.time >= h.respawnAt && this.outcome === 'playing') this.respawn(h);
        continue;
      }
      const HL = sq.riders[0];
      const home = Math.hypot(HL.x - keep.x, HL.y - keep.y) < L.HOME_R;
      if (home) {
        for (const r of sq.riders) r.hp = Math.min(r.maxHp, r.hp + L.HOME_HEAL * dt);
        h.homeTimer += dt;
        if (h.homeTimer >= L.HOME_REMOUNT && sq.riders.length < h.mods.maxRiders) {
          h.homeTimer = 0;
          this.remount(h, keep.x, keep.y);
        }
      } else {
        h.homeTimer = 0;
        if (h.mods.regen > 0 && this.time - h.lastHurt > 4) {
          for (const r of sq.riders) r.hp = Math.min(r.maxHp, r.hp + h.mods.regen * dt);
        }
        if (h.mods.remount < Infinity && sq.riders.length < h.mods.maxRiders) {
          h.remountTimer += dt;
          if (h.remountTimer >= h.mods.remount) {
            h.remountTimer = 0;
            const tail = sq.riders[sq.riders.length - 1];
            this.remount(h, tail.x - Math.cos(tail.facing) * 14, tail.y - Math.sin(tail.facing) * 14);
          }
        } else h.remountTimer = 0;
      }
      if (h.ai && h.offers.length > 0) {
        h.ai.cardDelay -= dt;
        if (h.ai.cardDelay <= 0) {
          h.ai.cardDelay = 1.2 + this.rand();
          this.chooseCard(team, aiPick(h.offers[0], this.rand));
        }
      }
    }
  }

  private xpNear(team: Team, x: number, y: number, amount: number): void {
    const h = this.heroes[team];
    const HL = h.sq.riders[0];
    if (!HL || Math.hypot(HL.x - x, HL.y - y) > L.XP_RANGE) return;
    this.gainXp(h, amount);
  }

  private gainXp(h: Hero, amount: number): void {
    h.xp += amount;
    // No cap: levels keep coming (cards run out only once every card is maxed).
    while (h.xp >= xpToNext(h.level)) {
      h.xp -= xpToNext(h.level);
      h.level++;
      const offer = drawOffer(h.picks, this.rand, h.kind);
      if (offer.length > 0) h.offers.push(offer);
      this.emit({ type: 'level', team: h.team, level: h.level });
    }
  }

  /** Take card `index` of the oldest hand on offer. */
  chooseCard(team: Team, index: number): void {
    const h = this.heroes[team];
    const offer = h.offers[0];
    if (!offer || index < 0 || index >= offer.length) return;
    h.offers.shift();
    const id = offer[index];
    const before = h.mods;
    h.picks.push(id);
    h.mods = modsFromPicks(h.picks, h.kind);
    this.refreshEff(h);
    // Hands still waiting were dealt before this pick: deal them afresh, so none offers
    // a card that is now maxed.
    h.offers = h.offers.map(() => drawOffer(h.picks, this.rand, h.kind)).filter(o => o.length > 0);
    // Tougher riders: everyone's wounds scale with the new strength.
    if (h.mods.hp !== before.hp) {
      for (const r of h.sq.riders) {
        const k = r.hp / r.maxHp;
        r.maxHp = C.RIDER_HP * h.mods.hp;
        r.hp = r.maxHp * k;
      }
    }
    // Fresh riders join at once.
    if (!h.dead) {
      const add = h.mods.maxRiders - before.maxRiders;
      for (let i = 0; i < add; i++) {
        const tail = h.sq.riders[h.sq.riders.length - 1];
        this.remount(h, tail.x - Math.cos(tail.facing) * 14, tail.y - Math.sin(tail.facing) * 14);
      }
    }
    this.emit({ type: 'card', team, card: id });
  }

  private remount(h: Hero, x: number, y: number): void {
    const L0 = h.sq.riders[0];
    const r = this.addRider(h.sq, x, y, L0 ? L0.facing : 0);
    r.hp = r.maxHp = C.RIDER_HP * h.mods.hp;
  }

  private respawn(h: Hero): void {
    const sq = h.sq;
    const p = this.spawnPoint(h.team);
    for (let i = 0; i < h.mods.maxRiders; i++) {
      const slot = i === 0 ? { x: 0, y: 0 } : this.slots[Math.min(i - 1, this.slots.length - 1)];
      const o = rotate(slot, p.facing);
      const r = this.addRider(sq, p.x + o.x, p.y + o.y, p.facing);
      r.hp = r.maxHp = C.RIDER_HP * h.mods.hp;
    }
    this.resetTrail(sq, p.x, p.y, p.facing);
    sq.phase = 'approach';
    sq.phaseTimer = 0;
    sq.targetBat = null;
    sq.targetSquad = null;
    sq.shock = 0;
    if (!this.squadrons.includes(sq)) this.squadrons.push(sq);
    h.dead = false;
    h.lastHurt = -99;
    this.emit({ type: 'hero-up', team: h.team, x: p.x, y: p.y });
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
      // Horse archers who have fallen no longer need their reload timers.
      if (this.shotReady.size > 0) {
        const alive = new Set<number>();
        for (const team of ['blue', 'red'] as const) for (const r of this.heroes[team].sq.riders) alive.add(r.id);
        for (const id of this.shotReady.keys()) if (!alive.has(id)) this.shotReady.delete(id);
      }
    }
  }

  // --- The AI commander --------------------------------------------------------------------

  private strength(h: Hero): number {
    let s = 0;
    for (const r of h.sq.riders) s += r.hp;
    return s;
  }

  /**
   * The rival's mind: go home to heal when worn down; fight the enemy commander when the
   * odds and the ground favour it; otherwise work a lane — ride down enemy foot from the
   * flank or rear, help its own waves break towers, and keep clear of enemy towers that
   * have nothing else to shoot at.
   */
  private rivalInput(h: Hero, dt: number): ChargeInput {
    const sq = h.sq, ai = h.ai!;
    const Ld = sq.riders[0];
    sq.phaseTimer -= dt;
    ai.navTimer -= dt;
    const team = h.team, enemy = enemyOf(team);
    const keep = L.KEEP[team];
    const foe = this.heroes[enemy];
    // It knows only what its own side can see.
    const F0 = foe.sq.riders[0];
    const F = F0 && this.visible(team, F0.x, F0.y) ? F0 : null;
    const max = h.mods.maxRiders;
    this.aiAbilities(h, F);
    const n = sq.riders.length;
    const full = max * C.RIDER_HP * h.mods.hp;
    const health = this.strength(h) / full;

    if (ai.mode === 'home') {
      if (n >= max && sq.riders.every(r => r.hp >= r.maxHp * 0.95)) ai.mode = 'lane';
      else return this.goTo(h, keep, Math.hypot(Ld.x - keep.x, Ld.y - keep.y) > 500, 60);
    }
    if (health < 0.35 || n < max * 0.35) {
      ai.mode = 'home';
      return this.goTo(h, keep, true, 60);
    }

    if (F) {
      const d = Math.hypot(F.x - Ld.x, F.y - Ld.y);
      if (d < 560) {
        const odds = this.strength(h) / Math.max(1, this.strength(foe));
        const hisTower = this.coveredBy(enemy, F, 30);
        const myTower = this.coveredBy(team, F);
        const engage = (odds >= 0.85 || (myTower && odds > 0.6)) && !(hisTower && !myTower && odds < 1.6);
        if (engage) {
          sq.targetSquad = foe.sq;
          sq.targetBat = null;
          if (h.kind === 'archers') return this.steer(h, this.kite(Ld, F.x, F.y, 190, h), true);
          return this.steer(h, this.dogfightInput(sq, Ld, F, dt), false);
        }
        if (d < 320 && odds < 0.7) {
          sq.targetSquad = null;
          return this.goTo(h, keep, true, 60);
        }
      }
    }
    sq.targetSquad = null;

    ai.laneTimer -= dt;
    if (ai.laneTimer <= 0 || ai.lane < 0) {
      ai.lane = this.chooseLane(h);
      ai.laneTimer = 18 + this.rand() * 8;
    }
    const lane = ai.lane;

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
      if (h.kind === 'archers') return this.steer(h, this.kite(Ld, target.x, target.y, 170, h), true);
      return this.steer(h, this.chargeBattalionInput(sq, Ld, target), true);
    }

    // Hold behind our foot in the lane, out of reach of their towers.
    return this.goTo(h, this.holdPoint(h, lane), false, 40);
  }

  /**
   * Circle a target at `radius`, the way horse archers fight: close in if too far,
   * draw off if too near, otherwise ride round it.
   */
  private kite(Ld: Soldier, x: number, y: number, radius: number, h: Hero): ChargeInput {
    const dx = Ld.x - x, dy = Ld.y - y;
    const d = Math.hypot(dx, dy) || 1;
    const ox = dx / d, oy = dy / d;
    // Keep circling the way we're already going round.
    const side = (Math.cos(Ld.facing) * -oy + Math.sin(Ld.facing) * ox) >= 0 ? 1 : -1;
    const tx = -oy * side, ty = ox * side;
    const pull = Math.max(-1, Math.min(1, (radius - d) / 80));
    void h;
    return { dirX: tx + ox * pull * 1.4, dirY: ty + oy * pull * 1.4, gallop: d < radius * 0.6 };
  }

  /** The rival uses its ability at the moment it pays: crashing home, turning in a fight, foes in bowshot. */
  private aiAbilities(h: Hero, F: Soldier | null): void {
    const sq = h.sq, Ld = sq.riders[0];
    if (!Ld || this.time < h.readyAt) return;
    const b = sq.targetBat;
    const dF = F ? Math.hypot(F.x - Ld.x, F.y - Ld.y) : Infinity;
    if (h.ability === 'thunder') {
      const intoFoot = b && sq.phase === 'charge' && Math.hypot(b.x - Ld.x, b.y - Ld.y) < 170;
      if (intoFoot || (sq.targetSquad && dF < 220)) this.useAbility(h.team);
    } else {
      // Loose the storm once a good number of enemies are in bowshot.
      let inRange = 0;
      for (const o of this.grid.query(Ld.x, Ld.y, L.STORM_RANGE * 0.8, this.near)) {
        if (o.alive && o.team !== h.team && !o.fleeing && this.visible(h.team, o.x, o.y) && Math.hypot(o.x - Ld.x, o.y - Ld.y) < L.STORM_RANGE * 0.8) inRange++;
      }
      if (inRange >= 10 || (F && dF < L.STORM_RANGE * 0.8)) this.useAbility(h.team);
    }
  }

  /** Ride to `p`, round the woods by the passes. */
  private goTo(h: Hero, p: Vec2, gallop: boolean, stop: number): ChargeInput {
    const Ld = h.sq.riders[0];
    const ai = h.ai!;
    if (ai.navTimer <= 0 || !ai.wpFor || Math.hypot(ai.wpFor.x - p.x, ai.wpFor.y - p.y) > 40) {
      ai.wp = navWaypoint(Ld, p);
      ai.wpFor = { x: p.x, y: p.y };
      ai.navTimer = 0.4;
    }
    const wp = ai.wp ?? p;
    const final = wp === p || (wp.x === p.x && wp.y === p.y);
    const dx = wp.x - Ld.x, dy = wp.y - Ld.y, d = Math.hypot(dx, dy);
    if (final && d < Math.max(14, stop)) return NO_INPUT;
    const mag = final && d < 90 ? 0.6 : 1;
    return this.steer(h, { dirX: (dx / (d || 1)) * mag, dirY: (dy / (d || 1)) * mag, gallop }, true);
  }

  /**
   * Last touches to the rival's steering: swerve round towers in the way, and out of
   * the circle where an enemy volley is about to land.
   */
  private steer(h: Hero, input: ChargeInput, avoidWalls: boolean): ChargeInput {
    const Ld = h.sq.riders[0];
    let { dirX, dirY } = input;
    const mag = Math.hypot(dirX, dirY);
    if (mag < 0.05) return input;
    let ux = dirX / mag, uy = dirY / mag;
    if (avoidWalls) {
      // Left-hand normal of our heading; a tower ahead on one side pushes us to the other.
      const nx = -uy, ny = ux;
      let ax = 0, ay = 0;
      for (const st of this.structures) {
        if (!st.alive) continue;
        const rx = st.x - Ld.x, ry = st.y - Ld.y;
        const along = rx * ux + ry * uy;
        if (along <= 0 || along > 120) continue;
        const across = rx * nx + ry * ny;
        const clear = st.r + 28;
        if (Math.abs(across) > clear) continue;
        const w = (1 - Math.abs(across) / clear) * 1.4;
        const side = across >= 0 ? -1 : 1;
        ax += nx * side * w;
        ay += ny * side * w;
      }
      ux += ax;
      uy += ay;
    }
    for (const v of this.volleys) {
      if (v.team === h.team || v.t >= v.flight) continue;
      const left = v.flight - v.t;
      const px = Ld.x + Ld.vx * left, py = Ld.y + Ld.vy * left;
      const dx = px - v.x, dy = py - v.y, d = Math.hypot(dx, dy);
      if (d > v.radius + 18) continue;
      // Break away from the circle's centre, hard.
      const w = 1.6;
      const ex = d > 1 ? dx / d : -uy, ey = d > 1 ? dy / d : ux;
      ux += ex * w;
      uy += ey * w;
    }
    const l = Math.hypot(ux, uy) || 1;
    return { dirX: (ux / l) * Math.min(1, mag), dirY: (uy / l) * Math.min(1, mag), gallop: input.gallop };
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
      let score = this.rand() * 0.8 + (lane === h.ai!.lane ? 1.2 : 0);
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
