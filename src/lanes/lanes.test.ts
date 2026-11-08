import { describe, expect, it } from 'vitest';
import { LaneSim } from './sim';
import { LANES as L, xpToNext } from './config';
import { CARDS, CARD_IDS, drawOffer, modsFromPicks } from './cards';
import { WOODS, inWoods, laneAt, navWaypoint, segmentHitsWoods } from './map';
import { mulberry32, NO_INPUT } from '../charge/sim';

/** Take a commander off the field for good (so tests see only what they set up). */
function bench(sim: LaneSim, team: 'blue' | 'red'): void {
  const h = sim.heroes[team];
  for (const r of h.sq.riders) r.alive = false;
  h.sq.riders = [];
  h.dead = true;
  h.respawnAt = Infinity;
}

function teleport(sim: LaneSim, team: 'blue' | 'red', x: number, y: number): void {
  for (const r of sim.heroes[team].sq.riders) { r.x = x + (Math.random() - 0.5) * 20; r.y = y + (Math.random() - 0.5) * 20; r.vx = r.vy = r.speed = 0; }
}

describe('lanes map', () => {
  it('keeps the lanes clear of woods and the woods between them', () => {
    for (const y of L.LANE_Y) {
      for (let x = 0; x <= L.WORLD_W; x += 50) {
        expect(inWoods(x, y)).toBe(false);
        expect(inWoods(x, y + L.LANE_HALF - 5)).toBe(false);
      }
    }
    expect(WOODS.length).toBe(6);
    expect(inWoods(1000, (L.LANE_Y[0] + L.LANE_Y[1]) / 2)).toBe(true);
    expect(inWoods(L.PASSES_X[0], (L.LANE_Y[0] + L.LANE_Y[1]) / 2)).toBe(false);
  });

  it('routes riders between lanes by a pass instead of through the trees', () => {
    const from = { x: 1000, y: L.LANE_Y[0] }, to = { x: 1000, y: L.LANE_Y[1] };
    expect(segmentHitsWoods(from.x, from.y, to.x, to.y)).toBe(true);
    const wp = navWaypoint(from, to);
    expect(wp).not.toEqual(to);
    expect(segmentHitsWoods(from.x, from.y, wp.x, wp.y, 14)).toBe(false);
    expect(segmentHitsWoods(wp.x, wp.y, to.x, to.y, 14)).toBe(false);
    // Along a lane the way is open.
    expect(navWaypoint({ x: 800, y: L.LANE_Y[2] }, { x: 2800, y: L.LANE_Y[2] })).toEqual({ x: 2800, y: L.LANE_Y[2] });
  });

  it('knows which lane a height belongs to', () => {
    expect(L.LANE_Y.map(y => laneAt(y))).toEqual([0, 1, 2]);
  });
});

describe('lanes cards', () => {
  it('offers three different cards and never one already maxed', () => {
    const rand = mulberry32(3);
    const picks = Array(CARDS.barding.max).fill('barding');
    for (let i = 0; i < 200; i++) {
      const offer = drawOffer(picks, rand);
      expect(offer.length).toBe(3);
      expect(new Set(offer).size).toBe(3);
      expect(offer).not.toContain('barding');
    }
  });

  it('builds a commander kit from the picks', () => {
    const m = modsFromPicks(['riders', 'riders', 'barding', 'remounts', 'remounts']);
    expect(m.maxRiders).toBe(L.HERO_START + 6);
    expect(m.hp).toBeCloseTo(1.2);
    expect(m.remount).toBeCloseTo(14 * 0.7);
    for (const id of CARD_IDS) expect(CARDS[id].title.length).toBeGreaterThan(0);
  });
});

describe('lanes sim', () => {
  it('sends a wave down every lane for both sides', () => {
    const sim = new LaneSim({ seed: 1 });
    sim.step(1 / 60);
    for (let i = 0; i < 70; i++) sim.step(1 / 60);
    expect(sim.battalions.length).toBe(12);
    const blue = sim.battalions.filter(b => b.team === 'blue');
    const x0 = blue.map(b => b.x);
    for (let i = 0; i < 300; i++) sim.step(1 / 60, NO_INPUT);
    blue.forEach((b, i) => expect(b.x).toBeGreaterThan(x0[i] + 100));
  });

  it('towers fall in order, the keep last', () => {
    const sim = new LaneSim({ seed: 1 });
    const red = sim.structures.filter(s => s.team === 'red');
    const outer = red.find(s => s.lane === 1 && s.tier === 2)!;
    const inner = red.find(s => s.lane === 1 && s.tier === 1)!;
    const keep = red.find(s => s.kind === 'keep')!;
    expect(sim.vulnerable(outer)).toBe(true);
    expect(sim.vulnerable(inner)).toBe(false);
    expect(sim.vulnerable(keep)).toBe(false);
    outer.alive = false;
    expect(sim.vulnerable(inner)).toBe(true);
    expect(sim.vulnerable(keep)).toBe(false);
    inner.alive = false;
    expect(sim.vulnerable(keep)).toBe(true);
  });

  it('a tower shoots a commander who rides in alone, and its walls barely notice him', () => {
    const sim = new LaneSim({ seed: 2 });
    bench(sim, 'red');
    const tower = sim.structures.find(s => s.team === 'red' && s.lane === 1 && s.tier === 2)!;
    teleport(sim, 'blue', tower.x - tower.r - 20, tower.y);
    const hp0 = sim.riders.reduce((s, r) => s + r.hp, 0);
    for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60, NO_INPUT);
    const hp1 = sim.riders.reduce((s, r) => s + r.hp, 0) + (L.HERO_START - sim.riders.length) * 30;
    expect(hp1).toBeLessThan(hp0);
    // Alone at the walls: only the backdoor share of the damage.
    const lost = tower.maxHp - tower.hp;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(L.HERO_START * L.SIEGE_DPS_RIDER * 6 * 0.5);
  });

  it('a fallen commander rides again from his keep', () => {
    const sim = new LaneSim({ seed: 3 });
    for (const r of sim.riders) sim['damageRider'](r, 999, 0, false, 'front');
    sim.step(1 / 60);
    expect(sim.me.dead).toBe(true);
    expect(sim.laneEvents.some(e => e.type === 'hero-down' && e.team === 'blue')).toBe(true);
    expect(sim.rival.level).toBeGreaterThanOrEqual(2); // the kill is worth a level
    const wait = sim.me.respawnAt - sim.time;
    expect(wait).toBeGreaterThan(L.RESPAWN_BASE);
    for (let i = 0; i < Math.ceil(wait * 60) + 2; i++) sim.step(1 / 60);
    expect(sim.me.dead).toBe(false);
    expect(sim.riders.length).toBe(sim.me.mods.maxRiders);
    expect(Math.hypot(sim.leader!.x - L.KEEP.blue.x, sim.leader!.y - L.KEEP.blue.y)).toBeLessThan(L.HOME_R);
  });

  it('levels up with three cards on offer; a chosen card takes effect', () => {
    const sim = new LaneSim({ seed: 4 });
    bench(sim, 'red');
    sim['gainXp'](sim.me, xpToNext(1));
    expect(sim.me.level).toBe(2);
    expect(sim.me.offers.length).toBe(1);
    const offer = sim.me.offers[0];
    expect(offer.length).toBe(3);
    // Make it Fresh Riders and take it.
    offer[0] = 'riders';
    sim.chooseCard('blue', 0);
    expect(sim.me.offers.length).toBe(0);
    expect(sim.me.mods.maxRiders).toBe(L.HERO_START + 3);
    expect(sim.riders.length).toBe(L.HERO_START + 3);
  });

  it('riders at home heal and the squadron fills back up', () => {
    const sim = new LaneSim({ seed: 5 });
    bench(sim, 'red');
    for (const r of sim.riders) r.hp = 5;
    for (const r of sim.riders.slice(-4)) sim['damageRider'](r, 999, 0, false, 'front');
    expect(sim.riders.length).toBe(L.HERO_START - 4);
    for (let i = 0; i < 60 * 4; i++) sim.step(1 / 60, NO_INPUT);
    expect(sim.riders.length).toBe(L.HERO_START);
    expect(sim.riders.every(r => r.hp > 20)).toBe(true);
  });

  it('breaking their keep wins', () => {
    const sim = new LaneSim({ seed: 6 });
    const keep = sim.structures.find(s => s.kind === 'keep' && s.team === 'red')!;
    keep.alive = false;
    sim.step(1 / 60);
    expect(sim.outcome).toBe('victory');
    expect(sim.winner).toBe('blue');
  });

  it('the rival goes to work: it rides out, farms and levels', () => {
    const sim = new LaneSim({ seed: 7 });
    const k = L.KEEP.red;
    let farthest = 0;
    for (let i = 0; i < 60 * 90; i++) {
      sim.step(1 / 60, NO_INPUT);
      const R = sim.rival.sq.riders[0];
      if (R) farthest = Math.max(farthest, Math.hypot(R.x - k.x, R.y - k.y));
    }
    expect(farthest).toBeGreaterThan(1000);
    expect(sim.rival.level).toBeGreaterThanOrEqual(2);
    expect(sim.rival.picks.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
