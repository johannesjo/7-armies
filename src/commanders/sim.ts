import { Team, Vec2 } from '../types';
import { CHARGE as C } from '../charge/config';
import { BattalionSpec, ChargeInput, ChargeSim, NO_INPUT, RiderMods, Soldier, Squadron, Wave, rotate } from '../charge/sim';
import { LANES as L, enemyOf, xpToNext } from '../lanes/config';
import { ABILITIES, AbilityId, CardId, COMMANDERS, CommanderKind, COMMANDER_KINDS, HeroMods, aiPick, drawOffer, modsFromPicks } from '../lanes/cards';

export type { AbilityId };

/** What the AI commander is about: its map's own work, or riding home to heal. */
type AiMode = 'work' | 'home';

export interface HeroAi {
  mode: AiMode;
  /** The map's choice of where to work (a lane, a sector...), and when to choose again. */
  task: number;
  taskTimer: number;
  /** Seconds before it picks a card it has been offered. */
  cardDelay: number;
  wp: Vec2 | null;
  wpFor: Vec2 | null;
  navTimer: number;
}

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
}

/** What every commander mode reports beyond the battle's own events. */
export type CommanderEvent =
  | { type: 'level'; team: Team; level: number }
  | { type: 'card'; team: Team; card: CardId }
  /** A commander's last rider fell; `slain` when the enemy commander was there to claim it. */
  | { type: 'hero-down'; team: Team; x: number; y: number; respawn: number; slain: boolean }
  | { type: 'hero-up'; team: Team; x: number; y: number }
  | { type: 'ability'; team: Team; ability: AbilityId; x: number; y: number; count: number };

export interface CommanderOptions {
  seed?: number;
  /** A human commands the blue squadron (false: AI on both sides, for headless runs). */
  human?: boolean;
  /** Blue's kind of horse (default knights) and red's (default: picked at random). */
  commander?: CommanderKind;
  rivalCommander?: CommanderKind;
  /** Fog of war (default on). */
  fog?: boolean;
}

/** An obstacle the rival steers round (a tower, say). */
export interface Obstacle { x: number; y: number; r: number; alive: boolean }

/**
 * One commander a side on top of the battle simulation: their squadrons, levels and
 * cards, the one ability of their kind of horse, horse archers' shooting, healing and
 * remounts at home, respawning, fog of war, and the rival's AI. A map mode (lanes, the
 * front) supplies where home is, what blocks sight and the way, and what the rival
 * does when it is neither healing nor fighting the other commander.
 *
 * Subclasses call `initCommanders()` at the end of their constructor.
 */
export abstract class CommanderSim<E extends { type: string } = { type: string }> extends ChargeSim {
  heroes!: Record<Team, Hero>;
  /** The mode's own events from the last step (plus anything done between steps). */
  modeEvents: (E | CommanderEvent)[] = [];
  /** Events raised between steps (an ability or card picked from the UI), delivered with the next step. */
  private pendingEvents: (E | CommanderEvent)[] = [];
  private stepping = false;
  winner: Team | null = null;
  /** Horse archers: when each rider can loose again. */
  protected readonly shotReady = new Map<number, number>();
  /** Fog of war: which cells each side can see (1 = seen). */
  readonly fog: boolean;
  readonly fogCols: number;
  readonly fogRows: number;
  readonly vision: Record<Team, Uint8Array>;
  private fogTimer = 0;
  private woodsCell: Uint8Array | null = null;
  private readonly cmdOpts: CommanderOptions;

  constructor(specs: BattalionSpec[], world: { w: number; h: number }, opts: CommanderOptions, extra: { waves?: Wave[] } = {}) {
    super(specs, { seed: opts.seed, squad: null, muster: false, world, waves: extra.waves });
    this.cmdOpts = opts;
    this.fog = opts.fog ?? true;
    this.fogCols = Math.ceil(world.w / L.FOG_CELL);
    this.fogRows = Math.ceil(world.h / L.FOG_CELL);
    const cells = this.fogCols * this.fogRows;
    this.vision = { blue: new Uint8Array(cells), red: new Uint8Array(cells) };
  }

  /** Raise both commanders (and work out the first vision). Call at the end of the subclass constructor. */
  protected initCommanders(): void {
    const cells = this.fogCols * this.fogRows;
    this.woodsCell = new Uint8Array(cells);
    for (let j = 0; j < this.fogRows; j++) {
      for (let i = 0; i < this.fogCols; i++) {
        this.woodsCell[j * this.fogCols + i] = this.inWoodsAt((i + 0.5) * L.FOG_CELL, (j + 0.5) * L.FOG_CELL) ? 1 : 0;
      }
    }
    const opts = this.cmdOpts;
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
        ai: ai ? { mode: 'work', task: -1, taskTimer: 0, cardDelay: 0, wp: null, wpFor: null, navTimer: 0 } : null,
        dead: false, respawnAt: 0, deaths: 0, kills: 0, lastHurt: -99, remountTimer: 0, homeTimer: 0,
      };
    };
    const rivalKind = opts.rivalCommander ?? COMMANDER_KINDS[Math.floor(this.rand() * COMMANDER_KINDS.length)];
    this.heroes = { blue: make('blue', !human, opts.commander ?? 'knights'), red: make('red', true, rivalKind) };
    if (human) this.player = this.heroes.blue.sq;
    this.updateVision();
  }

  // --- What a map mode supplies ----------------------------------------------------------

  /** Where a commander (re)enters the field, and which way he faces. */
  protected abstract spawnPoint(team: Team): { x: number; y: number; facing: number };
  /** The ring where his riders heal and fresh ones fall in. */
  protected abstract homePoint(team: Team): Vec2;
  /** What the rival does when it is neither healing nor fighting the enemy commander. */
  protected abstract rivalWork(h: Hero, dt: number): ChargeInput;
  /** Woods: sight reaches only a little way into them. */
  protected inWoodsAt(_x: number, _y: number): boolean { return false; }
  /** Things beyond the troops that let a side see (towers, camps). */
  protected visionExtra(_team: Team, _see: (x: number, y: number, r: number) => void): void { /* nothing more */ }
  /** Is this point covered by `team`'s defences (towers)? The rival won't fight under enemy ones. */
  protected guardedBy(_team: Team, _p: Vec2, _slack = 0): boolean { return false; }
  /** Next point on the way from `from` to `to` (round woods, say). */
  protected navTo(_from: Vec2, to: Vec2): Vec2 { return to; }
  /** Obstacles the rival swerves round. */
  protected obstacles(): readonly Obstacle[] { return []; }
  /** How hard foot hits foot before banners (the battle's pace, or faster). */
  protected baseMelee(s: Soldier): number { return super.meleeMult(s); }

  /** The human's commander (blue). */
  get me(): Hero {
    return this.heroes.blue;
  }

  get rival(): Hero {
    return this.heroes.red;
  }

  heroOf(sq: Squadron | null): Hero | null {
    if (!sq || !this.heroes) return null;
    if (sq === this.heroes.blue.sq) return this.heroes.blue;
    if (sq === this.heroes.red.sq) return this.heroes.red;
    return null;
  }

  // --- Hooks into the battle sim ------------------------------------------------------

  protected override isHero(sq: Squadron | null): boolean {
    return !!sq && (sq === this.heroes?.blue.sq || sq === this.heroes?.red.sq);
  }

  override mods(sq: Squadron | null): Readonly<RiderMods> {
    const h = this.heroOf(sq);
    return h ? h.eff : super.mods(sq);
  }

  protected override riderBase(sq: Squadron): { hp: number; mass: number } {
    const h = this.heroOf(sq);
    return { hp: C.RIDER_HP * (h?.mods.hp ?? 1), mass: C.MASS.cavalry * (h?.mods.mass ?? 1) };
  }

  protected override meleeMult(s: Soldier): number {
    let k = this.baseMelee(s);
    // A commander's war banner puts heart into the foot around him.
    const h = this.heroes?.[s.team];
    const HL = h?.sq.riders[0];
    if (h && h.mods.banner > 0 && HL && Math.hypot(HL.x - s.x, HL.y - s.y) < 260) k *= 1 + h.mods.banner;
    return k;
  }

  protected override aiInput(sq: Squadron, dt: number): ChargeInput {
    const h = this.heroOf(sq);
    if (h?.ai) return this.rivalInput(h, dt);
    return super.aiInput(sq, dt);
  }

  protected emit(e: E | CommanderEvent): void {
    (this.stepping ? this.modeEvents : this.pendingEvents).push(e);
  }

  protected override preStep(_dt: number): void {
    this.modeEvents.length = 0;
    for (const e of this.pendingEvents) this.modeEvents.push(e);
    this.pendingEvents.length = 0;
    this.stepping = true;
    for (const team of ['blue', 'red'] as const) this.refreshEff(this.heroes[team]);
  }

  protected override postStep(dt: number): void {
    this.shootFromSaddle();
    this.updateHeroes(dt);
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = L.FOG_INTERVAL;
      this.updateVision();
    }
    this.stepping = false;
  }

  // --- Abilities -----------------------------------------------------------------------

  /** The kit the fighting uses: the commander's, plus his ability while it runs. */
  protected refreshEff(h: Hero): void {
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

  /** Fallen horse archers no longer need their reload timers. */
  protected pruneShots(): void {
    if (this.shotReady.size === 0) return;
    const alive = new Set<number>();
    for (const team of ['blue', 'red'] as const) for (const r of this.heroes[team].sq.riders) alive.add(r.id);
    for (const id of this.shotReady.keys()) if (!alive.has(id)) this.shotReady.delete(id);
  }

  // --- Fog of war ------------------------------------------------------------------------

  /** Can `team` see this point? (Everything is seen when fog is off.) */
  visible(team: Team, x: number, y: number): boolean {
    if (!this.fog) return true;
    const i = Math.floor(x / L.FOG_CELL), j = Math.floor(y / L.FOG_CELL);
    if (i < 0 || j < 0 || i >= this.fogCols || j >= this.fogRows) return false;
    return this.vision[team][j * this.fogCols + i] === 1;
  }

  /** Each side sees round its foot, its commander and whatever the map adds — but only a little way into woods. */
  private updateVision(): void {
    for (const team of ['blue', 'red'] as const) {
      const v = this.vision[team];
      v.fill(0);
      const see = (x: number, y: number, r: number) => this.see(v, x, y, r);
      for (const b of this.battalions) if (b.team === team && !b.routed) see(b.x, b.y, L.SIGHT_FOOT);
      const h = this.heroes[team];
      const HL = h.sq.riders[0];
      if (HL) {
        see(HL.x, HL.y, L.SIGHT_HERO);
        const tail = h.sq.riders[h.sq.riders.length - 1];
        if (tail !== HL) see(tail.x, tail.y, L.SIGHT_HERO * 0.6);
      }
      // Your own home is always in view.
      const home = this.homePoint(team);
      see(home.x, home.y, L.HOME_R + 120);
      this.visionExtra(team, see);
    }
  }

  private see(v: Uint8Array, x: number, y: number, r: number): void {
    const c = L.FOG_CELL;
    const i0 = Math.max(0, Math.floor((x - r) / c)), i1 = Math.min(this.fogCols - 1, Math.floor((x + r) / c));
    const j0 = Math.max(0, Math.floor((y - r) / c)), j1 = Math.min(this.fogRows - 1, Math.floor((y + r) / c));
    const r2 = r * r, w2 = L.SIGHT_WOODS * L.SIGHT_WOODS;
    const woods = this.woodsCell;
    for (let j = j0; j <= j1; j++) {
      const dy = (j + 0.5) * c - y;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * c - x;
        const d2 = dx * dx + dy * dy;
        const k = j * this.fogCols + i;
        if (d2 <= (woods && woods[k] ? w2 : r2)) v[k] = 1;
      }
    }
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
      const home = this.homePoint(team);
      if (!h.dead && sq.riders.length === 0) {
        // The last rider has fallen: the commander is out until he can ride again.
        h.dead = true;
        h.deaths++;
        const wait = Math.min(L.RESPAWN_MAX, L.RESPAWN_BASE + L.RESPAWN_PER_LEVEL * h.level) * h.mods.respawn;
        h.respawnAt = this.time + wait;
        const foe = this.heroes[enemyOf(team)];
        const last = sq.trail[sq.trail.length - 1];
        const x = last?.x ?? home.x, y = last?.y ?? home.y;
        // The kill (and its bounty) is the enemy commander's only if he was in the fight.
        const FL = foe.sq.riders[0];
        const slain = !!FL && Math.hypot(FL.x - x, FL.y - y) < L.XP_RANGE;
        if (slain) {
          foe.kills++;
          this.gainXp(foe, L.XP_HERO_KILL);
        }
        this.emit({ type: 'hero-down', team, x, y, respawn: wait, slain });
        this.onHeroDown(h, slain);
        if (h.ai) h.ai.mode = 'work';
      }
      if (h.dead) {
        if (this.time >= h.respawnAt && this.outcome === 'playing') this.respawn(h);
        continue;
      }
      const HL = sq.riders[0];
      const atHome = Math.hypot(HL.x - home.x, HL.y - home.y) < L.HOME_R;
      if (atHome) {
        for (const r of sq.riders) r.hp = Math.min(r.maxHp, r.hp + L.HOME_HEAL * dt);
        h.homeTimer += dt;
        if (h.homeTimer >= L.HOME_REMOUNT && sq.riders.length < h.mods.maxRiders) {
          h.homeTimer = 0;
          this.remount(h, home.x, home.y);
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

  /** A map mode's reaction to a commander falling (the front: his army loses heart). */
  protected onHeroDown(_h: Hero, _slain: boolean): void { /* nothing by default */ }

  private xpNear(team: Team, x: number, y: number, amount: number): void {
    const h = this.heroes[team];
    const HL = h.sq.riders[0];
    if (!HL || Math.hypot(HL.x - x, HL.y - y) > L.XP_RANGE) return;
    this.gainXp(h, amount);
  }

  protected gainXp(h: Hero, amount: number): void {
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

  // --- The AI commander --------------------------------------------------------------------

  protected strength(h: Hero): number {
    let s = 0;
    for (const r of h.sq.riders) s += r.hp;
    return s;
  }

  /** The enemy commander's leader, if `h`'s side can see him. */
  protected seenFoe(h: Hero): Soldier | null {
    const F0 = this.heroes[enemyOf(h.team)].sq.riders[0];
    return F0 && this.visible(h.team, F0.x, F0.y) ? F0 : null;
  }

  /**
   * The rival's mind: go home to heal when worn down; fight the enemy commander when the
   * odds and the ground favour it; otherwise do the map's work (`rivalWork`).
   */
  private rivalInput(h: Hero, dt: number): ChargeInput {
    const sq = h.sq, ai = h.ai!;
    const Ld = sq.riders[0];
    sq.phaseTimer -= dt;
    ai.navTimer -= dt;
    const team = h.team, enemy = enemyOf(team);
    const home = this.homePoint(team);
    const foe = this.heroes[enemy];
    // It knows only what its own side can see.
    const F = this.seenFoe(h);
    const max = h.mods.maxRiders;
    this.aiAbilities(h, F);
    const n = sq.riders.length;
    const full = max * C.RIDER_HP * h.mods.hp;
    const health = this.strength(h) / full;

    if (ai.mode === 'home') {
      if (n >= max && sq.riders.every(r => r.hp >= r.maxHp * 0.95)) ai.mode = 'work';
      else return this.goTo(h, home, Math.hypot(Ld.x - home.x, Ld.y - home.y) > 500, 60);
    }
    if (health < 0.35 || n < max * 0.35) {
      ai.mode = 'home';
      return this.goTo(h, home, true, 60);
    }

    if (F) {
      const d = Math.hypot(F.x - Ld.x, F.y - Ld.y);
      if (d < 560) {
        const odds = this.strength(h) / Math.max(1, this.strength(foe));
        const hisGround = this.guardedBy(enemy, F, 30);
        const myGround = this.guardedBy(team, F);
        const engage = (odds >= 0.85 || (myGround && odds > 0.6)) && !(hisGround && !myGround && odds < 1.6);
        if (engage) {
          sq.targetSquad = foe.sq;
          sq.targetBat = null;
          if (h.kind === 'archers') return this.steer(h, this.kite(Ld, F.x, F.y, 190), true);
          return this.steer(h, this.dogfightInput(sq, Ld, F, dt), false);
        }
        if (d < 320 && odds < 0.7) {
          sq.targetSquad = null;
          return this.goTo(h, home, true, 60);
        }
      }
    }
    sq.targetSquad = null;
    return this.rivalWork(h, dt);
  }

  /**
   * Circle a target at `radius`, the way horse archers fight: close in if too far,
   * draw off if too near, otherwise ride round it.
   */
  protected kite(Ld: Soldier, x: number, y: number, radius: number): ChargeInput {
    const dx = Ld.x - x, dy = Ld.y - y;
    const d = Math.hypot(dx, dy) || 1;
    const ox = dx / d, oy = dy / d;
    // Keep circling the way we're already going round.
    const side = (Math.cos(Ld.facing) * -oy + Math.sin(Ld.facing) * ox) >= 0 ? 1 : -1;
    const tx = -oy * side, ty = ox * side;
    const pull = Math.max(-1, Math.min(1, (radius - d) / 80));
    return { dirX: tx + ox * pull * 1.4, dirY: ty + oy * pull * 1.4, gallop: d < radius * 0.6 };
  }

  /** The rival uses its ability at the moment it pays: crashing home, or foes in bowshot. */
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

  /** Ride to `p` (by the map's way round obstacles). */
  protected goTo(h: Hero, p: Vec2, gallop: boolean, stop: number): ChargeInput {
    const Ld = h.sq.riders[0];
    const ai = h.ai!;
    if (ai.navTimer <= 0 || !ai.wpFor || Math.hypot(ai.wpFor.x - p.x, ai.wpFor.y - p.y) > 40) {
      ai.wp = this.navTo(Ld, p);
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

  /** Ride at a battalion the way this kind of horse fights: archers circle at bowshot, knights charge an open side. */
  protected attackBattalion(h: Hero, b: import('../charge/sim').Battalion): ChargeInput {
    const Ld = h.sq.riders[0];
    if (h.kind === 'archers') return this.steer(h, this.kite(Ld, b.x, b.y, 170), true);
    return this.steer(h, this.chargeBattalionInput(h.sq, Ld, b), true);
  }

  /**
   * Last touches to the rival's steering: swerve round obstacles in the way, and out of
   * the circle where an enemy volley is about to land.
   */
  protected steer(h: Hero, input: ChargeInput, avoidWalls: boolean): ChargeInput {
    const Ld = h.sq.riders[0];
    const { dirX, dirY } = input;
    const mag = Math.hypot(dirX, dirY);
    if (mag < 0.05) return input;
    let ux = dirX / mag, uy = dirY / mag;
    if (avoidWalls) {
      // Left-hand normal of our heading; an obstacle ahead on one side pushes us to the other.
      const nx = -uy, ny = ux;
      let ax = 0, ay = 0;
      for (const st of this.obstacles()) {
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
}
