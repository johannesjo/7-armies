import { describe, it, expect } from 'vitest';
import { ChargeSim, BattalionSpec, SimEvent } from './sim';
import { CHARGE as C } from './config';

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

function block(over: Partial<BattalionSpec> = {}): BattalionSpec {
  return { team: 'red', type: 'swordsman', role: 'front', x: 2100, y: 200, facing: DOWN, count: 24, cols: 8, ...over };
}

const ride = (sim: ChargeSim, heading: number, seconds: number, events: SimEvent[] = []) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.step(1 / 60, { dirX: Math.cos(heading), dirY: Math.sin(heading), gallop: true });
    events.push(...sim.events);
  }
  return events;
};

describe('cavalry against cavalry', () => {
  it('a straight gallop keeps the wedge tight; a sharp turn loosens it', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 300, y: 300, facing: 0, count: 12 }, muster: false });
    ride(sim, 0, 3);
    expect(sim.player!.cohesion).toBeGreaterThan(0.85);
    ride(sim, Math.PI / 2, 0.6);
    expect(sim.player!.cohesion).toBeLessThan(0.7);
  });

  it('a tight wedge counts as heavier in a clash', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 300, y: 300, facing: 0, count: 12 }, muster: false });
    ride(sim, 0, 3);
    const L = sim.leader!;
    const tight = sim.clashWeight(L);
    sim.player!.cohesion = 0;
    expect(tight).toBeGreaterThan(sim.clashWeight(L) * 1.4);
  });

  it('hitting knights from behind breaks their squadron; it scatters, then regroups', () => {
    const sim = new ChargeSim([block()], {
      seed: 2, squad: { x: 470, y: 600, facing: 0, count: 4 }, muster: false,
      // Knights waiting at their post, facing away from us.
      squads: [{ team: 'red', ai: 'hunter', x: 600, y: 600, facing: 0, count: 5, muster: 20 }],
    });
    sim.leader!.speed = C.GALLOP_SPEED;
    const events = ride(sim, 0, 1.2);
    expect(events.some(e => e.type === 'squad-break' && e.byPlayer)).toBe(true);
    const knights = sim.squadrons.find(sq => sq.team === 'red');
    if (knights && knights.riders.length > C.AI_RETREAT_AT) {
      expect(knights.phase).toBe('broken');
      for (let t = 0; t < C.SQUAD_BROKEN_TIME + 0.5; t += 1 / 60) sim.step(1 / 60);
      expect(knights.phase).not.toBe('broken');
    }
  });

  it('knights chasing you onto our pikes are hurt there, and the kill is yours as a lure', () => {
    const sim = new ChargeSim([
      block(),
      // Our pikes, facing the knights' line of approach.
      { team: 'blue', type: 'pikeman', role: 'front', x: 600, y: 600, facing: UP, count: 24, cols: 8 },
    ], {
      seed: 3, squad: { x: 600, y: 760, facing: DOWN, count: 1 }, muster: false,
      squads: [{ team: 'red', ai: 'hunter', x: 600, y: 330, facing: DOWN, count: 4 }],
    });
    for (const k of sim.squadrons[1].riders) k.hp = 6;
    const events: SimEvent[] = [];
    for (let t = 0; t < 6; t += 1 / 60) {
      sim.step(1 / 60); // we sit still behind the pikes and let them come
      events.push(...sim.events);
    }
    expect(events.some(e => e.type === 'impact' && e.pike)).toBe(true);
    expect(sim.lured).toBeGreaterThan(0);
    const lure = events.find(e => e.type === 'rider-down' && e.lured);
    expect(lure && lure.type === 'rider-down' && lure.points).toBeGreaterThan(0);
  });
});

describe('horseman strikes', () => {
  it('a strike from behind is one-sided and decisive', () => {
    const sim = new ChargeSim([block()], {
      seed: 4, squad: { x: 480, y: 600, facing: 0, count: 1 }, muster: false,
      // Knights waiting at their post, facing away from us.
      squads: [{ team: 'red', ai: 'hunter', x: 600, y: 600, facing: 0, count: 3, muster: 20 }],
    });
    sim.leader!.speed = C.GALLOP_SPEED;
    const events = ride(sim, 0, 1);
    const knightsDown = events.filter(e => e.type === 'rider-down' && e.team === 'red').length;
    expect(knightsDown).toBeGreaterThan(0);
    expect(sim.leader!.hp).toBe(C.RIDER_HP); // they never got to strike back
  });

  it('meeting head-on, both sides strike', () => {
    const sim = new ChargeSim([block()], {
      seed: 4, squad: { x: 400, y: 600, facing: 0, count: 1 }, muster: false,
      squads: [{ team: 'red', ai: 'hunter', x: 700, y: 600, facing: Math.PI, count: 3 }],
    });
    sim.leader!.speed = C.GALLOP_SPEED;
    const events = ride(sim, 0, 1.5);
    const hitMine = events.some(e => e.type === 'rider-hit' && e.mine);
    const hitTheirs = events.some(e => (e.type === 'rider-hit' && !e.mine) || (e.type === 'rider-down' && e.team === 'red'));
    expect(hitMine).toBe(true);
    expect(hitTheirs).toBe(true);
  });

  it('a horseman too slow to charge does not strike', () => {
    const sim = new ChargeSim([block()], {
      seed: 4, squad: { x: 560, y: 600, facing: 0, count: 1 }, muster: false,
      squads: [{ team: 'red', ai: 'hunter', x: 600, y: 600, facing: 0, count: 3, muster: 20 }],
    });
    const events: SimEvent[] = [];
    for (let t = 0; t < 1; t += 1 / 60) {
      sim.step(1 / 60, { dirX: 0.3, dirY: 0, gallop: false }); // a slow walk into them
      events.push(...sim.events);
    }
    expect(sim.leader!.speed).toBeLessThan(C.CHARGE_MIN_SPEED);
    expect(events.some(e => e.type === 'impact' && !e.pike)).toBe(false);
  });
});
