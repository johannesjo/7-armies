import { describe, it, expect } from 'vitest';
import { ChargeSim, BattalionSpec, SimEvent, chooseMove, dogfightGeometry } from './sim';
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
      // Heavy knights take a head-on charge rather than slipping aside.
      squads: [{ team: 'red', ai: 'hunter', x: 700, y: 600, facing: Math.PI, count: 3, style: 'heavy' }],
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

describe('cavalry dogfights', () => {
  const at = (x: number, y: number, facing: number) => ({ x, y, facing });

  it('reads the geometry: on his tail, head-on, and which side of his line', () => {
    // We're behind him, both riding east.
    const tail = dogfightGeometry(at(0, 0, 0), at(100, 0, 0));
    expect(tail.hisOff).toBeCloseTo(Math.PI);
    expect(tail.myOff).toBeCloseTo(0);
    // Head-on.
    const head = dogfightGeometry(at(0, 0, 0), at(100, 0, Math.PI));
    expect(head.hisOff).toBeCloseTo(0);
    // He rides east; we're south of him (screen y down) = on his right.
    expect(dogfightGeometry(at(100, 50, 0), at(100, 0, 0)).side).toBe(1);
    expect(dogfightGeometry(at(100, -50, 0), at(100, 0, 0)).side).toBe(-1);
  });

  it('chooses: pursue on his tail, joust or slip past head-on, evade when he rides at our side', () => {
    const tail = dogfightGeometry(at(0, 0, 0), at(100, 0, 0));
    expect(chooseMove(tail, 'nimble').move).toBe('pursue');
    expect(chooseMove(tail, 'heavy').move).toBe('pursue');
    const head = dogfightGeometry(at(0, 0, 0), at(200, 0, Math.PI));
    expect(chooseMove(head, 'heavy').move).toBe('joust');
    // Light horse slip past only with the numbers; otherwise they get out of the way.
    expect(chooseMove(head, 'nimble', 1.5).move).toBe('slash');
    expect(chooseMove(head, 'nimble', 1).move).toBe('bait');
    // Nobody meets a charge that will roll over them.
    expect(chooseMove(head, 'heavy', 0.5).move).toBe('bait');
    // Almost on us: break hard.
    expect(chooseMove(dogfightGeometry(at(0, 0, 0), at(90, 0, Math.PI)), 'nimble', 1).move).toBe('evade');
    // He rides at us while we face away across his path.
    const beam = dogfightGeometry(at(0, 0, UP), at(200, 0, Math.PI));
    expect(chooseMove(beam, 'nimble').move).toBe('bait');
    // Nobody has the advantage yet: work round behind him.
    const level = dogfightGeometry(at(0, 0, UP), at(0, 200, 0));
    expect(chooseMove(level, 'nimble').move).toBe('lag');
  });

  it('light horse work round onto the tail of a squadron riding a steady circle', () => {
    const sim = new ChargeSim([block()], {
      seed: 5, squad: { x: 900, y: 700, facing: 0, count: 6 }, muster: false,
      squads: [{ team: 'red', ai: 'hunter', x: 900, y: 300, facing: DOWN, count: 6, style: 'nimble' }],
    });
    const red = sim.squadrons.find(sq => sq.team === 'red')!;
    let onTail = 0;
    for (let t = 0; t < 12; t += 1 / 60) {
      // We canter round a wide circle, never turning to fight.
      const L = sim.leader;
      if (!L) break;
      const h = L.facing + 0.6;
      sim.step(1 / 60, { dirX: Math.cos(h), dirY: Math.sin(h), gallop: false });
      const R = red.riders[0];
      if (R && sim.leader) {
        const g = dogfightGeometry(R, sim.leader);
        if (g.hisOff > 2.1 && g.d < 200) onTail++;
      }
    }
    // A good share of the fight spent sitting behind us.
    expect(onTail / 60).toBeGreaterThan(1.5);
  });

  it('light horse slip aside from a head-on charge instead of meeting it', () => {
    const run = (style: 'heavy' | 'nimble') => {
      const sim = new ChargeSim([block()], {
        seed: 4, squad: { x: 400, y: 600, facing: 0, count: 1 }, muster: false,
        squads: [{ team: 'red', ai: 'hunter', x: 760, y: 600, facing: Math.PI, count: 3, style }],
      });
      sim.leader!.speed = C.GALLOP_SPEED;
      let closest = Infinity;
      for (let t = 0; t < 1.6; t += 1 / 60) {
        sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: true });
        const R = sim.squadrons[1].riders[0], L = sim.leader;
        // How far off our line he is as he goes by.
        if (R && L && Math.abs(R.x - L.x) < 30) closest = Math.min(closest, Math.abs(R.y - L.y));
      }
      return closest;
    };
    // Knights ride straight down our line; light horse pass well off it.
    expect(run('heavy')).toBeLessThan(12);
    const nimble = run('nimble');
    expect(nimble).toBeGreaterThan(15);
    expect(nimble).toBeLessThan(150); // ...but they did ride past us

  });
});
