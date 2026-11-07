import { describe, it, expect } from 'vitest';
import { directInput, directZones } from './direct';
import { ChargeSim } from './sim';
import { CHARGE as C } from './config';

const zones = directZones(1280, 720); // canter ~86px, gallop 144px

function speedAfter(dx: number, dy: number, seconds = 2): number {
  const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 700, facing: 0, count: 1 }, muster: false });
  for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, directInput(dx, dy, zones));
  return sim.leader!.speed;
}

describe('directInput', () => {
  it('rests when the pointer is on the squadron', () => {
    expect(directInput(8, 5, zones)).toEqual({ dirX: 0, dirY: 0, gallop: false });
  });

  it('points toward the pointer', () => {
    const inp = directInput(0, -200, zones);
    expect(inp.dirX).toBeCloseTo(0);
    expect(inp.dirY).toBeLessThan(0);
  });

  it('rides faster the further away the pointer is', () => {
    const walk = speedAfter(28, 0);
    const canter = speedAfter(110, 0);
    const gallop = speedAfter(200, 0);
    expect(walk).toBeLessThan(canter);
    expect(canter).toBeLessThanOrEqual(C.CANTER_SPEED + 1);
    expect(gallop).toBeGreaterThan(C.CANTER_SPEED + 30);
    expect(directInput(200, 0, zones).gallop).toBe(true);
    expect(directInput(110, 0, zones).gallop).toBe(false);
  });

  it('turns the squadron to follow the pointer', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 700, facing: 0, count: 1 }, muster: false });
    for (let t = 0; t < 1.5; t += 1 / 60) sim.step(1 / 60, directInput(0, 200, zones));
    expect(sim.leader!.facing).toBeCloseTo(Math.PI / 2, 1);
  });

  it('scales the zones with the screen', () => {
    const phone = directZones(844, 390);
    expect(phone.gallop).toBeLessThan(zones.gallop);
    expect(phone.dead).toBe(zones.dead);
  });
});
