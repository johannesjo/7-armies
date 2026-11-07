import { describe, it, expect } from 'vitest';
import { directInput, directZones, reinsInput, joystickInput } from './direct';
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

describe('reinsInput (keyboard)', () => {
  const ride = (reins: { forward: boolean; back: boolean; turn: number }, gallop: boolean, seconds: number, facing = 0) => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 700, facing, count: 1 }, muster: false });
    for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, reinsInput(reins, sim.leader!.facing, gallop));
    return sim.leader!;
  };

  it('forward rides on in the direction the horses face, whatever that is', () => {
    const north = ride({ forward: true, back: false, turn: 0 }, false, 1.5, -Math.PI / 2);
    expect(north.y).toBeLessThan(700 - 100);
    expect(Math.abs(north.x - 1200)).toBeLessThan(2);
  });

  it('left and right turn relative to the current heading', () => {
    const right = ride({ forward: true, back: false, turn: 1 }, false, 0.3);
    const left = ride({ forward: true, back: false, turn: -1 }, false, 0.3);
    expect(right.facing).toBeGreaterThan(0.3);
    expect(left.facing).toBeLessThan(-0.3);
  });

  it('turns wider at a gallop than at a canter', () => {
    const turnAfter = (gallop: boolean) => {
      const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 700, facing: 0, count: 1 }, muster: false });
      for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60, reinsInput({ forward: true, back: false, turn: 0 }, 0, gallop));
      const start = sim.leader!.facing;
      for (let t = 0; t < 0.4; t += 1 / 60) sim.step(1 / 60, reinsInput({ forward: true, back: false, turn: 1 }, sim.leader!.facing, gallop));
      return sim.leader!.facing - start;
    };
    expect(turnAfter(false)).toBeGreaterThan(turnAfter(true));
  });

  it('back reins in, and letting go coasts to a halt', () => {
    expect(reinsInput({ forward: false, back: true, turn: 0 }, 0, true)).toEqual({ dirX: 0, dirY: 0, gallop: false });
    expect(reinsInput({ forward: false, back: false, turn: 0 }, 0, false)).toEqual({ dirX: 0, dirY: 0, gallop: false });
  });

  it('gallops when spurred while riding forward', () => {
    const l = ride({ forward: true, back: false, turn: 0 }, true, 2);
    expect(l.speed).toBeGreaterThan(C.CANTER_SPEED + 30);
  });
});

describe('joystickInput', () => {
  const R = 60;
  const speedAfter = (dx: number, dy: number) => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 700, facing: 0, count: 1 }, muster: false });
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60, joystickInput(dx, dy, R));
    return sim.leader!;
  };

  it('rests in the dead zone', () => {
    expect(joystickInput(4, 3, R)).toEqual({ dirX: 0, dirY: 0, gallop: false });
  });

  it('rides in the stick direction, faster the further it is pushed', () => {
    const walk = speedAfter(15, 0);
    const canter = speedAfter(40, 0);
    const gallop = speedAfter(60, 0);
    expect(walk.speed).toBeLessThan(canter.speed);
    expect(canter.speed).toBeLessThanOrEqual(C.CANTER_SPEED + 1);
    expect(gallop.speed).toBeGreaterThan(C.CANTER_SPEED + 30);
    expect(joystickInput(60, 0, R).gallop).toBe(true);
    expect(joystickInput(40, 0, R).gallop).toBe(false);
  });

  it('steers toward the stick direction', () => {
    const l = speedAfter(0, -50); // up
    expect(l.facing).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('clamps beyond the rim', () => {
    const inp = joystickInput(300, 0, R);
    expect(Math.hypot(inp.dirX, inp.dirY)).toBeCloseTo(1);
  });
});
