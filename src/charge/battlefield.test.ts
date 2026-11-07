import { describe, it, expect } from 'vitest';
import { ChargeSim, BattalionSpec } from './sim';
import { CHARGE as C } from './config';

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

function block(over: Partial<BattalionSpec> = {}): BattalionSpec {
  return { team: 'red', type: 'swordsman', role: 'front', x: 600, y: 600, facing: DOWN, count: 24, cols: 8, ...over };
}

const run = (sim: ChargeSim, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) sim.step(1 / 30); };

describe('the battle on its own', () => {
  it('the stronger line drives the weaker one back', () => {
    // A deep red block against a thin blue one, already in contact.
    const sim = new ChargeSim([block({ count: 40, y: 590 }), block({ team: 'blue', facing: UP, y: 632, count: 16 })], { seed: 3, squad: null });
    const [red, blue] = sim.battalions;
    const y0 = blue.y;
    run(sim, 8);
    expect(blue.y).toBeGreaterThan(y0 + 10); // blue gave ground (pushed down)
    expect(red.y).toBeGreaterThan(590 + 10); // red followed up
  });

  it('ranks loosen as morale fails', () => {
    const sim = new ChargeSim([block()], { seed: 1, squad: null });
    const b = sim.battalions[0];
    const spread = () => {
      const a = sim.slotPos(b, 0), z = sim.slotPos(b, b.cols - 1);
      return Math.hypot(z.x - a.x, z.y - a.y);
    };
    const firm = spread();
    b.morale = 10;
    expect(spread()).toBeGreaterThan(firm * 1.25);
  });

  it('wounded men rotate out of the front rank', () => {
    const sim = new ChargeSim([block()], { seed: 1, squad: null });
    const b = sim.battalions[0];
    const front = b.grid[0]!;
    front.hp = front.maxHp * 0.2;
    run(sim, C.ROTATE_INTERVAL * 1.6);
    expect(b.grid[0]).not.toBe(front);
    expect(b.grid[b.cols]).toBe(front);
  });

  it('archers fall back from enemy foot closing in', () => {
    const sim = new ChargeSim([
      block({ type: 'archer', role: 'archer', x: 600, y: 400, count: 20, cols: 10 }),
      block({ team: 'blue', facing: UP, x: 600, y: 520, role: 'front' }),
    ], { seed: 1, squad: null });
    const archers = sim.battalions[0];
    run(sim, 1.5);
    expect(archers.y).toBeLessThan(400 - 20); // backed away (upward, away from the blue foot)
  });

  it('a reserve marches up to plug a broken line', () => {
    const sim = new ChargeSim([
      block({ x: 600, y: 600 }),
      block({ x: 600, y: 300, role: 'reserve', count: 20, cols: 5 }),
      block({ team: 'blue', facing: UP, x: 600, y: 900 }),
    ], { seed: 1, squad: null });
    const reserve = sim.battalions[1];
    sim.battalions[0].morale = -1;
    sim.step(1 / 30);
    expect(reserve.role).toBe('front');
    const y0 = reserve.y;
    run(sim, 3);
    expect(reserve.y).toBeGreaterThan(y0 + 30);
  });
});
