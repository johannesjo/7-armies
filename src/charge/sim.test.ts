import { describe, it, expect } from 'vitest';
import { ChargeSim, attackSide, wedgeSlots, BattalionSpec, SimEvent } from './sim';
import { CHARGE as C } from './config';
import { createBattleSpecs, createWaves } from './scenario';

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

function block(over: Partial<BattalionSpec> = {}): BattalionSpec {
  return { team: 'red', type: 'swordsman', role: 'front', x: 600, y: 600, facing: DOWN, count: 24, cols: 8, ...over };
}

/** One galloping rider aimed straight through a battalion. */
function chargeThrough(heading: number, startX: number, startY: number, spec: BattalionSpec, seconds = 1.2) {
  const sim = new ChargeSim([spec], { seed: 7, squad: { x: startX, y: startY, facing: heading, count: 1 } });
  sim.leader!.speed = C.GALLOP_SPEED;
  const input = { dirX: Math.cos(heading), dirY: Math.sin(heading), gallop: true };
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.step(1 / 60, input);
    events.push(...sim.events);
  }
  return { sim, events };
}

describe('attackSide', () => {
  it('classifies head-on, side and rear attacks', () => {
    expect(attackSide(UP, DOWN)).toBe('front');
    expect(attackSide(0, DOWN)).toBe('flank');
    expect(attackSide(DOWN, DOWN)).toBe('rear');
  });
});

describe('wedgeSlots', () => {
  it('places every follower behind the leader', () => {
    const slots = wedgeSlots(11);
    expect(slots).toHaveLength(11);
    for (const s of slots) expect(s.x).toBeLessThan(0);
  });
});

describe('cavalry charge', () => {
  it('a charge into the rear kills more than one into the front', () => {
    // Red faces down, so riding down from above hits the rear.
    const rear = chargeThrough(DOWN, 600, 480, block());
    const front = chargeThrough(UP, 600, 720, block());
    const rearKills = rear.events.filter(e => e.type === 'kill').length;
    const frontKills = front.events.filter(e => e.type === 'kill').length;
    expect(rearKills).toBeGreaterThan(frontKills);
    expect(rear.events.some(e => e.type === 'impact' && e.side === 'rear')).toBe(true);
  });

  it('flank and rear kills score more points', () => {
    const rear = chargeThrough(DOWN, 600, 480, block());
    const kill = rear.events.find(e => e.type === 'kill' && e.byPlayer);
    expect(kill && kill.type === 'kill' && kill.points).toBeGreaterThanOrEqual(C.KILL_SCORE * C.REAR_MULT);
  });

  it('braced pikes hurt riders that charge them head-on', () => {
    const { events } = chargeThrough(UP, 600, 720, block({ type: 'pikeman' }));
    expect(events.some(e => e.type === 'impact' && e.pike)).toBe(true);
    expect(events.some(e => e.type === 'rider-hit')).toBe(true);
  });

  it('pikes hit from behind cannot brace', () => {
    const { events } = chargeThrough(DOWN, 600, 480, block({ type: 'pikeman' }));
    expect(events.some(e => e.type === 'impact' && e.pike)).toBe(false);
  });

  it('a stalled rider is cut down in the crowd', () => {
    const sim = new ChargeSim([block({ count: 40, cols: 8 })], { seed: 3, squad: { x: 600, y: 600, facing: 0, count: 1 } });
    for (let t = 0; t < 30 && sim.leader; t += 1 / 60) sim.step(1 / 60);
    expect(sim.leader).toBeNull();
    expect(sim.outcome).toBe('defeat');
  });
});

describe('squadron', () => {
  it('the next rider takes command when the leader falls', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 300, y: 300, facing: 0, count: 3 } });
    const [first, second] = sim.riders;
    first.hp = 1;
    // A rider-hit routed through a stray arrow.
    sim.arrows.push({ sx: 0, sy: 0, tx: first.x, ty: first.y, t: 1, flight: 1, team: 'red', volley: 0 });
    sim.step(1 / 60);
    expect(sim.leader).toBe(second);
    expect(sim.events.some(e => e.type === 'rider-down' && e.wasLeader)).toBe(true);
  });

  it('galloping drains stamina and resting restores it', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 300, facing: 0, count: 1 } });
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: true });
    const drained = sim.stamina;
    expect(drained).toBeLessThan(C.STAMINA_MAX);
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60);
    expect(sim.stamina).toBeGreaterThan(drained);
  });

  it('turns more tightly at a canter than at a gallop', () => {
    const turned = (gallop: boolean) => {
      const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 700, facing: 0, count: 1 } });
      sim.leader!.speed = gallop ? C.GALLOP_SPEED : C.CANTER_SPEED * 0.6;
      sim.step(0.2, { dirX: 0, dirY: 1, gallop });
      return sim.leader!.facing;
    };
    expect(turned(false)).toBeGreaterThan(turned(true));
  });

  it('the camp rallies fresh riders', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: C.CAMP_X, y: C.CAMP_Y, facing: 0, count: 4 } });
    for (let t = 0; t < C.RALLY_INTERVAL * 3 + 0.1; t += 1 / 60) sim.step(1 / 60);
    expect(sim.riders.length).toBe(7);
  });
});

describe('archers', () => {
  it('loose volleys at the squadron, leading a moving target', () => {
    const archers = block({ type: 'archer', role: 'archer', x: 600, y: 300, count: 20, cols: 10 });
    archers.facing = DOWN;
    const sim = new ChargeSim([archers], { seed: 2, squad: { x: 400, y: 600, facing: 0, count: 1 } });
    sim.battalions[0].volleyTimer = 0;
    sim.leader!.speed = C.CANTER_SPEED;
    sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: false });
    const volley = sim.events.find(e => e.type === 'volley');
    expect(volley && volley.type === 'volley' && volley.atPlayer).toBe(true);
    // Aim point lies ahead (to the right) of the rider.
    expect(volley && volley.type === 'volley' && volley.x).toBeGreaterThan(sim.leader!.x);
    expect(sim.arrows.length).toBe(20);
  });

  it('arrows only land after their flight time', () => {
    const archers = block({ type: 'archer', role: 'archer', x: 600, y: 300, count: 10, cols: 10 });
    const sim = new ChargeSim([archers], { seed: 2, squad: { x: 600, y: 600, facing: 0, count: 1 } });
    sim.battalions[0].volleyTimer = 0;
    sim.step(1 / 60);
    const flight = sim.arrows[0].flight;
    let landed = 0;
    let t = 1 / 60;
    while (t < flight - 0.05) { sim.step(1 / 60); t += 1 / 60; landed += sim.events.filter(e => e.type === 'arrow-land').length; }
    expect(landed).toBe(0);
    for (let i = 0; i < 30; i++) { sim.step(1 / 60); landed += sim.events.filter(e => e.type === 'arrow-land').length; }
    expect(landed).toBe(10);
  });
});

describe('morale', () => {
  it('a broken battalion routs and panics its neighbours', () => {
    const sim = new ChargeSim([block(), block({ x: 720 })], { seed: 1, squad: null });
    sim.battalions[0].morale = -1;
    sim.step(1 / 60);
    expect(sim.battalions[0].routed).toBe(true);
    expect(sim.battalions[1].morale).toBeLessThanOrEqual(100 - C.ROUT_CASCADE);
    expect(sim.events.some(e => e.type === 'rout')).toBe(true);
  });

  it('routed soldiers flee toward their own side of the field', () => {
    const sim = new ChargeSim([block()], { seed: 1, squad: null });
    const startY = sim.soldiers[0].y;
    sim.battalions[0].morale = -1;
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60);
    expect(sim.soldiers.every(s => s.fleeing)).toBe(true);
    expect(sim.soldiers[0].y).toBeLessThan(startY);
  });

  it('victory once every red battalion has broken', () => {
    const sim = new ChargeSim([block(), block({ team: 'blue', y: 900, facing: UP })], { seed: 1, squad: null });
    sim.battalions[0].morale = -1;
    sim.step(1 / 60);
    expect(sim.outcome).toBe('victory');
  });
});

describe('battle scenario', () => {
  it('the blue line slowly loses without the squadron', () => {
    const sim = new ChargeSim(createBattleSpecs(), { seed: 1, squad: null });
    for (let t = 0; t < 90; t += 1 / 30) sim.step(1 / 30);
    // Still fighting after a minute and a half...
    expect(sim.outcome).toBe('playing');
    expect(sim.blueLineStanding).toBeLessThan(sim.blueLineInitial);
    for (let t = 0; t < 400 && sim.outcome === 'playing'; t += 1 / 30) sim.step(1 / 30);
    // ...but eventually it breaks.
    expect(sim.outcome).toBe('defeat');
  });
});

describe('reinforcements', () => {
  it('waves arrive on schedule and count toward the enemy army', () => {
    const waves = createWaves();
    const sim = new ChargeSim([block()], { seed: 1, squad: null, waves });
    const total = sim.initialRed;
    expect(total).toBe(24 + waves.flatMap(w => w.specs).reduce((n, s) => n + s.count, 0));
    expect(sim.battalions).toHaveLength(1);
    let arrived = false;
    for (let t = 0; t < waves[0].time + 0.1; t += 1 / 30) {
      sim.step(1 / 30);
      if (sim.events.some(e => e.type === 'wave')) arrived = true;
    }
    expect(arrived).toBe(true);
    expect(sim.battalions.length).toBe(1 + waves[0].specs.length);
    expect(sim.initialRed).toBe(total);
  });

  it('no victory while reinforcements are still coming', () => {
    const sim = new ChargeSim([block(), block({ team: 'blue', y: 900, facing: UP })], {
      seed: 1, squad: null, waves: [{ time: 30, specs: [block({ x: 300, y: 40 })] }],
    });
    sim.battalions[0].morale = -1;
    sim.step(1 / 60);
    expect(sim.battalions[0].routed).toBe(true);
    expect(sim.outcome).toBe('playing');
  });
});
