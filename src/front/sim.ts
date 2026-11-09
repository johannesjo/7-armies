import { Team, Vec2 } from '../types';
import { CHARGE as C } from '../charge/config';
import { Battalion, BattalionSpec, ChargeInput, Soldier } from '../charge/sim';
import { CommanderEvent, CommanderOptions, CommanderSim, Hero } from '../commanders/sim';
import { LANES as L, enemyOf } from '../lanes/config';
import { FRONT as F } from './config';

/** What only the front reports. */
type FrontOnlyEvent =
  /** A column of fresh foot sets off for a sector. */
  | { type: 'reinforce'; team: Team; x: number; y: number; sector: number };

export type FrontEvent = FrontOnlyEvent | CommanderEvent;
export type FrontSimOptions = CommanderOptions;

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

/** The two armies, mirrored: a long line of swords and pikes, archers behind, reserves behind them. */
export function createFrontSpecs(): BattalionSpec[] {
  const specs: BattalionSpec[] = [];
  const cx = F.WORLD_W / 2, fy = F.FRONT_Y;
  const at = (i: number, n: number, gap: number) => cx + (i - (n - 1) / 2) * gap;
  for (const team of ['blue', 'red'] as const) {
    const dir = team === 'blue' ? 1 : -1;
    const facing = team === 'blue' ? UP : DOWN;
    for (let i = 0; i < F.LINE_COUNT; i++) {
      specs.push({ team, type: i % 2 === 0 ? 'swordsman' : 'pikeman', role: 'front', x: at(i, F.LINE_COUNT, F.LINE_GAP), y: fy + dir * F.LINE_START, facing, count: F.LINE_MEN, cols: 8 });
    }
    for (let i = 0; i < F.ARCHERS; i++) {
      specs.push({ team, type: 'archer', role: 'archer', x: at(i, F.ARCHERS, 400), y: fy + dir * 170, facing, count: F.ARCHER_MEN, cols: 9 });
    }
    (['pikeman', 'swordsman', 'pikeman'] as const).forEach((type, i) => {
      specs.push({ team, type, role: 'reserve', x: at(i, 3, 400), y: fy + dir * 300, facing, count: F.RESERVE_MEN, cols: 5 });
    });
  }
  return specs;
}

/** Which sector (0 left, 1 centre, 2 right) a point on the field is in. */
export function sectorOf(x: number): number {
  return x < F.SECTOR_X[0] ? 0 : x < F.SECTOR_X[1] ? 1 : 2;
}

/**
 * The front: two commanders over one great battle. The battle's own systems — the
 * line shoving and breaking, reserves plugging holes, routs spreading, an army's heart
 * failing until it collapses — decide the day; the commanders tip it. Columns of fresh
 * foot march in from each army's rear to its weakest sector, and are juicy prey on the
 * march. Break the enemy army to win (and ride down the rout).
 */
export class FrontSim extends CommanderSim<FrontOnlyEvent> {
  columns = 0;
  private nextColumn: number = F.COLUMN_FIRST;
  /** Extra loss an army has taken from its commander falling to the enemy commander. */
  private readonly heroLoss: Record<Team, number> = { blue: 0, red: 0 };
  /** Battalions that came as reinforcement columns (and whether they still march). */
  private readonly columnIds = new Set<number>();

  constructor(opts: FrontSimOptions = {}) {
    super(createFrontSpecs(), { w: F.WORLD_W, h: F.WORLD_H }, opts);
    this.initCommanders();
  }

  // --- The map, for the commanders --------------------------------------------------------

  protected spawnPoint(team: Team): { x: number; y: number; facing: number } {
    const h = F.HOME[team];
    return { x: h.x, y: h.y + (team === 'blue' ? -30 : 30), facing: team === 'blue' ? UP : DOWN };
  }

  protected homePoint(team: Team): Vec2 {
    return F.HOME[team];
  }

  /** A commander's camp is his ground: the rival only rides into it with the odds well in his favour. */
  protected override guardedBy(team: Team, p: Vec2, slack = 0): boolean {
    const h = F.HOME[team];
    return Math.hypot(p.x - h.x, p.y - h.y) < L.HOME_R + 80 + slack;
  }

  /** Commanders tip the battle here rather than win it alone: their blows on foot are scaled down. */
  protected override refreshEff(h: Hero): void {
    super.refreshEff(h);
    h.eff.impact *= F.HERO_IMPACT;
    h.eff.shock *= F.HERO_SHOCK;
  }

  protected override xpScale(): number {
    return F.XP_SCALE;
  }

  protected override arrowScale(): number {
    return F.HERO_ARROWS;
  }

  protected override baseMelee(): number {
    return F.MELEE_MULT;
  }

  /** The battle's camps and their garrisons aren't on this field: commanders heal at home. */
  protected override updateCamp(): void { /* commanders heal at home (CommanderSim) */ }

  protected override preStep(dt: number): void {
    super.preStep(dt);
    this.marchColumns();
  }

  protected override postStep(dt: number): void {
    super.postStep(dt);
    this.prune(dt);
  }

  // --- Sectors ------------------------------------------------------------------------------

  /** Fighting strength of a team's line in a sector: men, weighted by heart. */
  private sectorStrength(team: Team, sector: number): number {
    let s = 0;
    for (const b of this.battalions) {
      if (b.team !== team || b.routed || b.role === 'archer' || sectorOf(b.x) !== sector) continue;
      let men = 0;
      for (const m of b.grid) if (m && m.alive) men++;
      s += men * (0.4 + 0.6 * Math.max(0, b.morale) / 100);
    }
    return s;
  }

  /** Who is winning a sector: +1 all blue, -1 all red, 0 even (or empty). */
  sectorPressure(sector: number): number {
    const b = this.sectorStrength('blue', sector), r = this.sectorStrength('red', sector);
    return b + r > 0 ? (b - r) / (b + r) : 0;
  }

  // --- Reinforcement columns -------------------------------------------------------------

  private marchColumns(): void {
    if (this.time < this.nextColumn || this.outcome !== 'playing') return;
    this.nextColumn += F.COLUMN_INTERVAL;
    const grow = Math.min(F.COLUMN_GROWTH_MAX, Math.floor(this.columns / F.COLUMN_GROWTH_EVERY) * F.COLUMN_GROWTH);
    this.columns++;
    for (const team of ['blue', 'red'] as const) {
      const standing = this.battalions.filter(b => b.team === team && !b.routed).length;
      if (standing >= F.MAX_BATTALIONS) continue;
      // To the weakest sector of our line.
      const sign = team === 'blue' ? 1 : -1;
      let sector = 1, worst = Infinity;
      for (let s = 0; s < 3; s++) {
        const p = this.sectorPressure(s) * sign;
        if (p < worst) { worst = p; sector = s; }
      }
      const x = F.SECTOR_CENTRE[sector];
      const dir = team === 'blue' ? 1 : -1;
      const facing = team === 'blue' ? UP : DOWN;
      const y0 = team === 'blue' ? F.WORLD_H - 40 : 40;
      const stageY = F.FRONT_Y + dir * F.COLUMN_STAGE;
      // A column: swords leading, pikes behind, narrow and deep.
      const swords = this.addBattalion({ team, type: 'swordsman', role: 'reserve', x: x - 30, y: y0, facing, count: F.COLUMN_SWORDS + grow, cols: 5 });
      const pikes = this.addBattalion({ team, type: 'pikeman', role: 'reserve', x: x + 30, y: y0 + dir * 50, facing, count: F.COLUMN_PIKES + grow, cols: 4 });
      swords.home = { x: x - 45, y: stageY };
      pikes.home = { x: x + 45, y: stageY + dir * 30 };
      this.columnIds.add(swords.id);
      this.columnIds.add(pikes.id);
      this.emit({ type: 'reinforce', team, x, y: y0, sector });
    }
  }

  /** A reinforcement column still on its way to the line. */
  marching(b: Battalion): boolean {
    return this.columnIds.has(b.id) && !b.routed && Math.hypot(b.x - b.home.x, b.y - b.home.y) > 40;
  }

  // --- Breaking an army ------------------------------------------------------------------

  override armyMorale(team: Team): number {
    return Math.max(0, Math.min(1, 1 - this.armyLoss[team] / F.ARMY_BREAK));
  }

  /** How tired both armies are (0 until FATIGUE_START), as extra loss. */
  get fatigue(): number {
    return Math.max(0, this.time - F.FATIGUE_START) / F.FATIGUE_SPAN * F.FATIGUE;
  }

  protected override updateArmies(lost: Record<Team, number>, total: Record<Team, number>): void {
    if (this.outcome !== 'playing') return;
    for (const team of ['red', 'blue'] as const) {
      if (this.armyBroken[team] || total[team] === 0) continue;
      const loss = lost[team] / total[team] + this.heroLoss[team] + this.fatigue;
      this.armyLoss[team] = loss;
      const morale = this.armyMorale(team);
      if (!this.armyWavered[team] && morale < C.ARMY_WAVER) {
        this.armyWavered[team] = true;
        this.events.push({ type: 'army-waver', team });
      }
      this.armyDrain[team] = morale < C.ARMY_WAVER ? C.ARMY_DRAIN * (1 - morale / C.ARMY_WAVER) : 0;
      if (loss >= F.ARMY_BREAK) this.breakArmy(team);
    }
  }

  protected override onHeroDown(h: Hero, slain: boolean): void {
    if (!slain) return;
    // Their commander cut down before their eyes: the whole army's heart sinks.
    this.heroLoss[h.team] += F.HERO_SLAIN_LOSS;
    for (const b of this.battalions) {
      if (b.team !== h.team || b.routed) continue;
      b.morale -= F.HERO_SLAIN_MORALE;
      b.sinceShock = 0;
    }
  }

  protected override checkOutcome(): void {
    if (this.outcome !== 'playing') return;
    for (const team of ['red', 'blue'] as const) {
      if (!this.armyBroken[team]) continue;
      this.winner = enemyOf(team);
      this.outcome = this.winner === 'blue' ? 'victory' : 'defeat';
      this.outcomeReason = this.winner === 'blue' ? 'The enemy army breaks and flees!' : 'Our army has lost heart and flees.';
      // The beaten commander quits the field with his army.
      for (const r of this.heroes[team].sq.riders) r.alive = false;
      this.heroes[team].sq.riders = [];
      this.heroes[team].dead = true;
      this.heroes[team].respawnAt = Infinity;
      return;
    }
  }

  /** Emptied battalions are struck off (and forgotten as columns). */
  private prune(dt: number): void {
    if (Math.floor(this.time * 2) === Math.floor((this.time - dt) * 2)) return;
    this.battalions = this.battalions.filter(b => {
      if (!b.routed || b.grid.some(s => s && s.alive)) return true;
      this.columnIds.delete(b.id);
      return false;
    });
    this.pruneShots();
  }

  // --- The rival's work at the front --------------------------------------------------------

  /**
   * Pick the sector that matters most — where our line buckles, where enemy columns can
   * be caught on the march, where their foot is locked in a fight with ours — and work
   * it: catch columns, hit engaged foot in the flank or rear, otherwise wait behind our line.
   */
  protected rivalWork(h: Hero, dt: number): ChargeInput {
    const sq = h.sq, ai = h.ai!;
    const Ld = sq.riders[0];
    ai.taskTimer -= dt;
    if (ai.taskTimer <= 0 || ai.task < 0) {
      ai.task = this.chooseSector(h);
      ai.taskTimer = 12 + this.rand() * 6;
    }
    const sector = ai.task;
    let target = sq.targetBat && !sq.targetBat.routed && sq.phaseTimer > -8 && this.visible(h.team, sq.targetBat.x, sq.targetBat.y) ? sq.targetBat : null;
    if (!target) {
      target = this.preyIn(h, sector);
      if (target !== sq.targetBat) { sq.phase = 'approach'; sq.phaseTimer = 0; }
      sq.targetBat = target;
    }
    if (target) {
      if (Math.hypot(target.x - Ld.x, target.y - Ld.y) > 380 && sq.phase !== 'charge') return this.goTo(h, target, true, 0);
      return this.attackBattalion(h, target);
    }
    const dir = h.team === 'blue' ? 1 : -1;
    return this.goTo(h, { x: F.SECTOR_CENTRE[sector], y: F.FRONT_Y + dir * 230 }, false, 40);
  }

  private chooseSector(h: Hero): number {
    const Ld = h.sq.riders[0];
    const sign = h.team === 'blue' ? 1 : -1;
    const foe = this.heroes[enemyOf(h.team)];
    const Fd = this.seenFoe(h);
    const odds = Fd ? this.strength(h) / Math.max(1, this.strength(foe)) : 1;
    let best = 1, bestScore = -Infinity;
    for (let s = 0; s < 3; s++) {
      // Our line buckling there: go and help.
      let score = -this.sectorPressure(s) * sign * 4 + this.rand() * 0.6 + (s === h.ai!.task ? 1 : 0);
      for (const b of this.battalions) {
        if (b.team === h.team || b.routed || sectorOf(b.x) !== s || !this.visible(h.team, b.x, b.y)) continue;
        if (this.marching(b)) score += 2; // a column to catch on the march
        else if (b.engagedTimer > 0) score += 0.4; // foot locked in a fight: rear charges
      }
      if (Fd && sectorOf(Fd.x) === s) score += odds < 0.9 ? -2 : 1;
      score -= Math.abs(Ld.x - F.SECTOR_CENTRE[s]) / 1000;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  /** The best enemy battalion to hit in a sector: columns on the march, foot busy fighting ours, archers. */
  private preyIn(h: Hero, sector: number): Battalion | null {
    const Ld = h.sq.riders[0];
    let best: Battalion | null = null;
    let bestScore = Infinity;
    for (const b of this.battalions) {
      if (b.team === h.team || b.routed || !this.visible(h.team, b.x, b.y)) continue;
      // Prefer the chosen sector; a neighbour's foot only if much handier.
      const d = Math.hypot(b.x - Ld.x, b.y - Ld.y) + (sectorOf(b.x) === sector ? 0 : 300);
      const facingUs = Math.cos(Math.atan2(Ld.y - b.y, Ld.x - b.x) - b.facing) > 0.5;
      const score = d
        + (b.type === 'pikeman' && facingUs && b.engagedTimer <= 0 ? 300 : 0)
        - (this.marching(b) ? 280 : 0)
        - (b.engagedTimer > 0 ? 200 : 0)
        - (b.type === 'archer' ? 120 : 0);
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  /** For tests and the HUD: the commander's own foot. */
  footOf(team: Team): Soldier[] {
    return this.soldiers.filter(s => !s.rider && s.team === team && !s.fleeing);
  }
}
