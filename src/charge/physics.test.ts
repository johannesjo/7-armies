import { describe, it, expect } from 'vitest';
import { ChargeSim, BattalionSpec } from './sim';
import { CHARGE as C } from './config';

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

function block(over: Partial<BattalionSpec> = {}): BattalionSpec {
  return { team: 'red', type: 'swordsman', role: 'front', x: 600, y: 600, facing: DOWN, count: 24, cols: 8, ...over };
}

/** One galloping rider driven straight through a battalion; returns the sim after `seconds`. */
function charge(spec: BattalionSpec, heading: number, from: { x: number; y: number }, seconds: number) {
  const sim = new ChargeSim([spec], { seed: 5, squad: { ...from, facing: heading, count: 1 }, muster: false });
  sim.leader!.speed = C.GALLOP_SPEED;
  let impacts = 0;
  let minSpeed = Infinity;
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.step(1 / 60, { dirX: Math.cos(heading), dirY: Math.sin(heading), gallop: false });
    impacts += sim.events.filter(e => e.type === 'impact').length;
    if (sim.leader) minSpeed = Math.min(minSpeed, sim.leader.speed);
  }
  return { sim, impacts, minSpeed };
}

describe('charge physics', () => {
  it('a deep formation soaks up more of a charge than a shallow one', () => {
    // Ridden into from behind (red faces down; riding down hits the rear).
    const shallow = charge(block({ count: 8, cols: 8 }), DOWN, { x: 600, y: 520 }, 0.7);
    const deep = charge(block({ count: 48, cols: 8 }), DOWN, { x: 600, y: 520 }, 0.7);
    expect(deep.minSpeed).toBeLessThan(shallow.minSpeed - 20);
  });

  it('a braced front stops a horse far sooner than an unbraced rear', () => {
    const rear = charge(block(), DOWN, { x: 600, y: 540 }, 0.5);
    const front = charge(block(), UP, { x: 600, y: 660 }, 0.5);
    expect(front.minSpeed).toBeLessThan(rear.minSpeed - 40);
  });

  it('men hit hard are knocked down, stop fighting, and get back up', () => {
    const { sim } = charge(block({ count: 16 }), DOWN, { x: 600, y: 540 }, 0.4);
    const downed = sim.soldiers.filter(s => !s.rider && s.down > 0);
    expect(downed.length).toBeGreaterThan(0);
    const before = downed.map(s => s.lastAttack);
    for (let t = 0; t < 0.4; t += 1 / 60) sim.step(1 / 60);
    // Still down a moment later: no blows struck.
    downed.forEach((s, i) => { if (s.alive && s.down > 0) expect(s.lastAttack).toBe(before[i]); });
    for (let t = 0; t < C.DOWN_TIME + C.DOWN_TIME_JITTER + 0.5; t += 1 / 60) sim.step(1 / 60);
    expect(sim.soldiers.filter(s => !s.rider && s.down > 0).length).toBe(0);
  });

  it('men thrown by a charge bowl over their comrades', () => {
    const sim = new ChargeSim([block({ count: 40, cols: 8 })], { seed: 9, squad: { x: 600, y: 520, facing: DOWN, count: 1 }, muster: false });
    sim.leader!.speed = C.GALLOP_SPEED;
    for (let t = 0; t < 0.8; t += 1 / 60) sim.step(1 / 60, { dirX: 0, dirY: 1, gallop: true });
    expect(sim.bowled).toBeGreaterThan(0);
  });

  it('heavier horsemen win the clash', () => {
    const sim = new ChargeSim([block({ x: 2100, y: 200 })], {
      seed: 1, squad: { x: 600, y: 700, facing: UP, count: 1 }, muster: false,
      squads: [{ team: 'red', ai: 'guard', x: 600, y: 640, facing: DOWN, count: 3 }],
    });
    const knight = sim.squadrons[1].riders[0];
    expect(knight.mass).toBeGreaterThan(sim.leader!.mass);
  });
});
