import { describe, expect, it } from 'vitest';
import { FrontSim, createFrontSpecs, sectorOf } from './sim';
import { FRONT as F } from './config';

/** Take a commander off the field for good (so tests see only what they set up). */
function bench(sim: FrontSim, team: 'blue' | 'red'): void {
  const h = sim.heroes[team];
  for (const r of h.sq.riders) r.alive = false;
  h.sq.riders = [];
  h.dead = true;
  h.respawnAt = Infinity;
}

function run(sim: FrontSim, seconds: number): void {
  const end = sim.time + seconds;
  while (sim.time < end && sim.outcome === 'playing') sim.step(1 / 60);
}

describe('front setup', () => {
  it('fields two mirrored armies along one line', () => {
    const specs = createFrontSpecs();
    const blue = specs.filter(s => s.team === 'blue'), red = specs.filter(s => s.team === 'red');
    expect(blue.length).toBe(red.length);
    expect(blue.length).toBe(F.LINE_COUNT + F.ARCHERS + 3);
    blue.forEach((b, i) => {
      const r = red[i];
      expect(r.type).toBe(b.type);
      expect(r.x).toBe(b.x);
      expect(r.count).toBe(b.count);
      expect(b.y - F.FRONT_Y).toBeCloseTo(F.FRONT_Y - r.y);
      expect(b.y).toBeGreaterThan(F.FRONT_Y);
    });
  });

  it('reads the line in three sectors', () => {
    expect(F.SECTOR_CENTRE.map(sectorOf)).toEqual([0, 1, 2]);
    expect(sectorOf(0)).toBe(0);
    expect(sectorOf(F.WORLD_W)).toBe(2);
  });

  it('starts even in every sector, both commanders at home', () => {
    const sim = new FrontSim({ seed: 1 });
    for (let s = 0; s < 3; s++) expect(sim.sectorPressure(s)).toBeCloseTo(0);
    expect(sim.armyMorale('blue')).toBe(1);
    expect(sim.armyMorale('red')).toBe(1);
    for (const team of ['blue', 'red'] as const) {
      const r = sim.heroes[team].sq.riders[0];
      expect(Math.hypot(r.x - F.HOME[team].x, r.y - F.HOME[team].y)).toBeLessThan(120);
    }
  });
});

describe('front sim', () => {
  it('marches a column of fresh foot in from each rear edge to a sector', () => {
    const sim = new FrontSim({ seed: 2, human: false });
    const before = sim.battalions.length;
    const reinforced: { team: string; sector: number; y: number }[] = [];
    while (sim.time < F.COLUMN_FIRST + 0.5) {
      sim.step(1 / 60);
      for (const e of sim.modeEvents) if (e.type === 'reinforce') reinforced.push(e);
    }
    expect(reinforced.map(e => e.team).sort()).toEqual(['blue', 'red']);
    for (const e of reinforced) {
      expect([0, 1, 2]).toContain(e.sector);
      expect(e.team === 'blue' ? e.y > F.WORLD_H - 100 : e.y < 100).toBe(true);
    }
    const columns = sim.battalions.slice(before).filter(b => !b.routed);
    expect(columns.length).toBeGreaterThanOrEqual(2);
    expect(columns.some(b => sim.marching(b))).toBe(true);
  });

  it('an army that loses heart breaks, and the other side wins', () => {
    const sim = new FrontSim({ seed: 3 });
    // Strike most of the red foot dead.
    const red = sim.footOf('red');
    red.slice(0, Math.ceil(red.length * F.ARMY_BREAK) + 5).forEach(m => { m.alive = false; });
    run(sim, 3);
    expect(sim.outcome).toBe('victory');
    expect(sim.winner).toBe('blue');
    expect(sim.heroes.red.dead).toBe(true);
  });

  it('a commander slain by the enemy commander shakes his whole army', () => {
    const sim = new FrontSim({ seed: 4 });
    sim.step(1 / 60);
    const lossBefore = sim.armyLoss.red;
    const morale = sim.battalions.filter(b => b.team === 'red').map(b => b.morale);
    const h = sim.heroes.red, foe = sim.heroes.blue;
    // Bring the enemy commander to the red squadron, then strike it down.
    const last = h.sq.trail[h.sq.trail.length - 1] ?? h.sq.riders[0];
    for (const r of foe.sq.riders) { r.x = last.x; r.y = last.y + 40; }
    for (const r of h.sq.riders) r.alive = false;
    h.sq.riders = [];
    run(sim, 0.5);
    expect(h.dead).toBe(true);
    expect(sim.armyLoss.red).toBeGreaterThan(lossBefore + F.HERO_SLAIN_LOSS * 0.9);
    const after = sim.battalions.filter(b => b.team === 'red').map(b => b.morale);
    expect(after.reduce((a, b) => a + b, 0)).toBeLessThan(morale.reduce((a, b) => a + b, 0));
  });

  it('tires both armies late on, so even battles end', () => {
    const sim = new FrontSim({ seed: 5 });
    expect(sim.fatigue).toBe(0);
    sim.time = F.FATIGUE_START + F.FATIGUE_SPAN;
    expect(sim.fatigue).toBeCloseTo(F.FATIGUE);
  });

  it('foot alone holds even for minutes: the commanders decide it', () => {
    const sim = new FrontSim({ seed: 6, human: false });
    bench(sim, 'blue');
    bench(sim, 'red');
    run(sim, 120);
    expect(sim.outcome).toBe('playing');
    expect(sim.armyMorale('blue')).toBeGreaterThan(0.3);
    expect(sim.armyMorale('red')).toBeGreaterThan(0.3);
  }, 60000);

  it('is deterministic for a seed', () => {
    const a = new FrontSim({ seed: 9, human: false }), b = new FrontSim({ seed: 9, human: false });
    run(a, 40);
    run(b, 40);
    const snap = (s: FrontSim) => s.battalions.map(x => `${x.x.toFixed(2)},${x.y.toFixed(2)},${x.morale.toFixed(2)}`).join('|') + s.heroes.red.xp;
    expect(snap(a)).toBe(snap(b));
  }, 60000);

  it('the rival rides out to the battle and gains experience', () => {
    const sim = new FrontSim({ seed: 7 });
    bench(sim, 'blue');
    run(sim, 90);
    const h = sim.heroes.red;
    expect(h.level > 1 || h.xp > 0).toBe(true);
  }, 60000);
});
