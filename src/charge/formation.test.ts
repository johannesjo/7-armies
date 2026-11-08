import { describe, it, expect } from 'vitest';
import { ChargeSim, wedgeSlots } from './sim';
import { CHARGE as C } from './config';

const SLOTS = wedgeSlots(C.MAX_SQUAD);

/**
 * For each follower: its lane side (local y), distance from its slot, and how far it
 * lags behind its slot along the path (negative = ahead).
 */
function slotErrors(sim: ChargeSim) {
  const sq = sim.player!;
  return sim.riders.slice(1).map((r, i) => {
    const t = sim.slotTarget(sq, i + 1);
    return {
      side: SLOTS[i].y,
      dist: Math.hypot(t.x - r.x, t.y - r.y),
      lag: (t.x - r.x) * Math.cos(t.h) + (t.y - r.y) * Math.sin(t.h),
    };
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** A galloping squadron heading east, already in formation, with room to manoeuvre. */
function gallopingSquad(count = 12): ChargeSim {
  const sim = new ChargeSim([], { seed: 1, squad: { x: 300, y: 300, facing: 0, count }, muster: false });
  for (let t = 0; t < 3; t += 1 / 60) sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: true });
  return sim;
}

/** Steer toward `heading` for `seconds` at a gallop. */
function ride(sim: ChargeSim, heading: number, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, { dirX: Math.cos(heading), dirY: Math.sin(heading), gallop: true });
}

describe('squadron formation movement', () => {
  it('holds the wedge on a straight gallop', () => {
    const sim = gallopingSquad();
    expect(mean(slotErrors(sim).map(e => e.dist))).toBeLessThan(6);
  });

  it('riders on the outside of a wheel fall behind those on the inside', () => {
    const sim = gallopingSquad();
    // Hard right turn (toward +y): the inside of the wheel is the wedge's right (+y) side.
    ride(sim, Math.PI / 2, 0.6);
    const errs = slotErrors(sim);
    const outside = mean(errs.filter(e => e.side < 0).map(e => e.lag));
    const inside = mean(errs.filter(e => e.side > 0).map(e => e.lag));
    expect(outside - inside).toBeGreaterThan(8);
  });

  it('the further out the lane, the bigger the lag', () => {
    const sim = gallopingSquad(30);
    ride(sim, Math.PI / 2, 0.7);
    const errs = slotErrors(sim).filter(e => e.side < 0);
    const near = mean(errs.filter(e => e.side > -15).map(e => e.lag));
    const far = mean(errs.filter(e => e.side < -30).map(e => e.lag));
    expect(far).toBeGreaterThan(near + 5);
  });

  it('a sharp turn strings the squadron out more than a wide one', () => {
    const sharp = gallopingSquad();
    ride(sharp, Math.PI / 2, 0.6);
    const sharpSpread = mean(slotErrors(sharp).map(e => e.dist));
    const wide = gallopingSquad();
    // The same heading change eased in over a long sweep.
    let wideSpread = 0;
    for (let t = 0; t < 3; t += 1 / 60) {
      const h = Math.min(Math.PI / 2, (t / 2.4) * (Math.PI / 2));
      wide.step(1 / 60, { dirX: Math.cos(h), dirY: Math.sin(h), gallop: true });
      wideSpread = Math.max(wideSpread, mean(slotErrors(wide).map(e => e.dist)));
    }
    expect(sharpSpread).toBeGreaterThan(wideSpread * 1.3);
  });

  it('closes ranks again after the turn', () => {
    const sim = gallopingSquad();
    ride(sim, Math.PI / 2, 0.6);
    const strung = mean(slotErrors(sim).map(e => e.dist));
    ride(sim, Math.PI / 2, 4);
    expect(mean(slotErrors(sim).map(e => e.dist))).toBeLessThan(strung * 0.6);
  });

  it('below a gallop, the wedge closes up quickly after a sharp turn', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 300, y: 300, facing: 0, count: 12 }, muster: false });
    for (let t = 0; t < 3; t += 1 / 60) sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: false }); // canter east
    let back = -1;
    for (let t = 0; t < 4 && back < 0; t += 1 / 60) {
      sim.step(1 / 60, { dirX: 0, dirY: 1, gallop: false }); // hard right
      if (t > 0.5 && mean(slotErrors(sim).map(e => e.dist)) < 4) back = t;
    }
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(1.4);
  });

  it('followers cannot outrun the leader by much', () => {
    const sim = gallopingSquad();
    ride(sim, Math.PI, 1.2); // reverse — everyone wants to catch up
    for (const r of sim.riders) expect(r.speed).toBeLessThanOrEqual(C.GALLOP_SPEED * C.FOLLOW_CATCH_UP + 0.01);
  });

});

describe('full squadron', () => {
  it('completes the wedge: every row behind the leader is full', () => {
    const followers = wedgeSlots(C.MAX_SQUAD - 1);
    const rows = new Map<number, number>();
    for (const s of followers) rows.set(s.x, (rows.get(s.x) ?? 0) + 1);
    const counts = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, n]) => n);
    expect(C.MAX_SQUAD).toBeGreaterThan(30);
    counts.forEach((n, i) => expect(n).toBe(i + 2));
  });
});
