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

describe('footmen fight what they face', () => {
  it('a man cannot strike an enemy behind him until he has turned round', () => {
    // A lone red footman facing down (south); a blue one right behind him, facing his back.
    const sim = new ChargeSim([
      block({ count: 1, cols: 1, y: 600 }),
      block({ team: 'blue', count: 1, cols: 1, y: 590, facing: DOWN }),
    ], { seed: 1, squad: null });
    const red = sim.soldiers.find(s => s.team === 'red')!;
    const blue = sim.soldiers.find(s => s.team === 'blue')!;
    red.attackTimer = 0;
    blue.attackTimer = 0;
    run(sim, 0.25);
    expect(blue.lastAttack).toBeGreaterThan(0); // he faces his foe and strikes
    expect(red.lastAttack).toBeLessThan(0); // still turning round
    run(sim, 1.5);
    expect(red.lastAttack).toBeGreaterThan(0); // now he has turned and fights back
  });

  it('a battalion attacked in the rear suffers far more than one attacked in front', () => {
    const fight = (fromBehind: boolean) => {
      const sim = new ChargeSim([
        block({ y: 600 }),
        // Blue arrives either at red's back (above, facing down) or at its front (below, facing up).
        fromBehind ? block({ team: 'blue', y: 566, facing: DOWN }) : block({ team: 'blue', y: 634, facing: UP }),
      ], { seed: 2, squad: null });
      let redDamage = 0;
      for (let t = 0; t < 20; t += 1 / 30) {
        sim.step(1 / 30);
        for (const e of sim.events) {
          if ((e.type === 'hit' || e.type === 'kill') && e.team === 'red') redDamage += e.type === 'hit' ? e.damage : 1;
        }
      }
      // Routed at some point (it may since have rallied).
      const routed = sim.battalions[0].routedAt > -Infinity;
      return { redDamage, morale: sim.battalions[0].morale, routed };
    };
    const rear = fight(true);
    const front = fight(false);
    expect(rear.redDamage).toBeGreaterThan(front.redDamage * 1.5);
    expect(rear.routed || rear.morale < front.morale).toBe(true);
  });
});

describe('a living front', () => {
  it('a free battalion swings into the flank of an enemy busy fighting another of ours', () => {
    const sim = new ChargeSim([
      block({ y: 600 }), // red, fighting blue A below it
      block({ team: 'blue', facing: UP, y: 634 }), // blue A, locked with red
      block({ team: 'blue', facing: UP, x: 900, y: 700 }), // blue B, free, off to the side
      block({ x: 2100, y: 200 }), // a far-off red battalion so the battle isn't over
    ], { seed: 1, squad: null });
    const [red, , freeB] = sim.battalions;
    run(sim, 1.5); // red and blue A engage
    run(sim, 10);
    // B came round to red's side (east of it, level with it), not straight at its front.
    const px = -Math.sin(red.facing), py = Math.cos(red.facing);
    const across = Math.abs((freeB.x - red.x) * px + (freeB.y - red.y) * py);
    const ahead = (freeB.x - red.x) * Math.cos(red.facing) + (freeB.y - red.y) * Math.sin(red.facing);
    expect(across).toBeGreaterThan(Math.abs(ahead));
    expect(Math.hypot(freeB.x - red.x, freeB.y - red.y)).toBeLessThan(160);
  });

  it('a routed battalion with men to spare rallies and comes back as a reserve', () => {
    const sim = new ChargeSim([
      block({ team: 'blue', facing: UP, y: 900 }),
      block({ x: 2100, y: 200 }),
      block({ team: 'blue', facing: UP, x: 300, y: 1000 }),
    ], { seed: 1, squad: null });
    const b = sim.battalions[0];
    b.morale = -1;
    sim.step(1 / 30);
    expect(b.routed).toBe(true);
    let rallied = false;
    for (let t = 0; t < C.RALLY_DELAY + 1; t += 1 / 30) {
      sim.step(1 / 30);
      if (sim.events.some(e => e.type === 'rally')) rallied = true;
    }
    expect(rallied).toBe(true);
    expect(b.routed).toBe(false);
    expect(b.role).toBe('reserve');
    expect(sim.members(b).every(s => !s.fleeing)).toBe(true);
    // Only once: routing again, it doesn't come back.
    b.morale = -1;
    run(sim, C.RALLY_DELAY + 1);
    expect(b.routed).toBe(true);
  });
});

describe('calls for help', () => {
  const setup = () => new ChargeSim([
    block({ y: 600, count: 40 }), // a strong red block
    block({ team: 'blue', facing: UP, y: 634, count: 20 }), // our weaker line, in contact
    block({ x: 2100, y: 200 }),
    block({ team: 'blue', facing: UP, x: 300, y: 1100 }),
  ], { seed: 1, squad: { x: 1200, y: 1300, facing: UP, count: 6 }, muster: false });

  it('a buckling line calls for the squadron; breaking the enemy there answers it', () => {
    const sim = setup();
    const [red, blue] = sim.battalions;
    run(sim, 1);
    blue.morale = 30; // our line is buckling
    let call = null;
    for (let t = 0; t < C.CALL_FIRST + 2 && !call; t += 1 / 30) {
      sim.step(1 / 30);
      call = sim.events.find(e => e.type === 'call') ?? null;
      blue.morale = Math.min(blue.morale, 30);
    }
    expect(call && call.type === 'call' && call.kind).toBe('buckling');
    expect(sim.calls[0].target).toBe(red);
    const score = sim.score;
    red.morale = -1; // the squadron breaks them
    sim.step(1 / 30);
    sim.step(1 / 30);
    expect(sim.calls.length).toBe(0);
    expect(sim.callsAnswered).toBe(1);
    expect(sim.score).toBeGreaterThanOrEqual(score + C.CALL_SCORE);
  });

  it('a call left too long fails', () => {
    const sim = setup();
    const [, blue] = sim.battalions;
    run(sim, 1);
    let failed = false;
    for (let t = 0; t < C.CALL_FIRST + C.CALL_TIME.buckling + 3; t += 1 / 30) {
      blue.morale = Math.min(blue.morale, 30);
      sim.step(1 / 30);
      if (sim.events.some(e => e.type === 'call-failed')) failed = true;
    }
    expect(failed).toBe(true);
  });

  it('an enemy battalion deep in our half is a breakthrough', () => {
    const sim = new ChargeSim([
      block({ y: C.FRONT_Y + 300, x: 400 }), // red, far into our side, nobody fighting it
      block({ team: 'blue', facing: UP, x: 2000, y: 1200 }),
      block({ x: 2100, y: 200 }),
    ], { seed: 1, squad: { x: 1200, y: 1300, facing: UP, count: 6 }, muster: false });
    let kind = '';
    for (let t = 0; t < C.CALL_FIRST + 1 && !kind; t += 1 / 30) {
      sim.step(1 / 30);
      const e = sim.events.find(ev => ev.type === 'call');
      if (e && e.type === 'call') kind = e.kind;
    }
    expect(kind).toBe('breakthrough');
    // Named by where on the field it is, as our army sees it.
    const c = sim.calls[0];
    const expected = c.target.x < C.WORLD_W * 0.38 ? 'left' : c.target.x > C.WORLD_W * 0.62 ? 'right' : 'centre';
    expect(c.side).toBe(expected);
  });
});
