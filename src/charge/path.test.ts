import { describe, it, expect } from 'vitest';
import { RiderPath, StrokePace } from './path';
import { ChargeSim } from './sim';
import { CHARGE as C } from './config';

function rideAlong(path: RiderPath, seconds: number, start = { x: 400, y: 800, facing: 0 }) {
  const sim = new ChargeSim([], { seed: 1, squad: { ...start, count: 1 } });
  let maxSpeed = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const L = sim.leader!;
    sim.step(1 / 60, path.steer(L));
    maxSpeed = Math.max(maxSpeed, sim.leader!.speed);
  }
  return { sim, leader: sim.leader!, maxSpeed };
}

function draw(path: RiderPath, pts: [number, number][], gallop = false): void {
  path.begin({ x: pts[0][0], y: pts[0][1] }, false, gallop);
  for (const [x, y] of pts.slice(1)) path.add({ x, y }, gallop);
}

describe('RiderPath', () => {
  it('rides an L-shaped route and pulls up at its end', () => {
    const path = new RiderPath();
    const pts: [number, number][] = [];
    for (let x = 420; x <= 800; x += 5) pts.push([x, 800]);
    for (let y = 795; y >= 500; y -= 5) pts.push([800, y]);
    draw(path, pts);
    const { leader } = rideAlong(path, 9);
    expect(path.active).toBe(false);
    expect(Math.hypot(leader.x - 800, leader.y - 500)).toBeLessThan(45);
    expect(leader.speed).toBeLessThan(15);
  });

  it('gallops along stretches drawn quickly and canters along slow ones', () => {
    const line = (): [number, number][] => Array.from({ length: 120 }, (_, i) => [420 + i * 8, 800]);
    const slow = new RiderPath();
    draw(slow, line(), false);
    const fast = new RiderPath();
    draw(fast, line(), true);
    const s = rideAlong(slow, 3.5);
    const f = rideAlong(fast, 3.5);
    expect(s.maxSpeed).toBeLessThanOrEqual(C.CANTER_SPEED + 1);
    expect(f.maxSpeed).toBeGreaterThan(C.CANTER_SPEED + 30);
    expect(f.leader.x).toBeGreaterThan(s.leader.x);
  });

  it('a stroke started away from the route replaces it; one at its end extends it', () => {
    const path = new RiderPath();
    draw(path, [[500, 500], [600, 500]]);
    path.begin({ x: 600, y: 500 }, true, false);
    path.add({ x: 600, y: 600 }, false);
    expect(path.points.map(p => [p.x, p.y])).toEqual([[500, 500], [600, 500], [600, 600]]);
    path.begin({ x: 100, y: 100 }, false, false);
    expect(path.points).toHaveLength(1);
  });

  it('thins out densely drawn points', () => {
    const path = new RiderPath();
    path.begin({ x: 0, y: 0 }, false, false);
    for (let i = 1; i <= 100; i++) path.add({ x: i, y: 0 }, false);
    expect(path.points.length).toBeLessThanOrEqual(11);
  });

  it('a single tapped point rides straight there', () => {
    const path = new RiderPath();
    path.begin({ x: 700, y: 800 }, false, false);
    const { leader } = rideAlong(path, 5);
    expect(Math.hypot(leader.x - 700, leader.y - 800)).toBeLessThan(40);
  });
});

describe('StrokePace', () => {
  it('switches to gallop on fast strokes with hysteresis', () => {
    const pace = new StrokePace(800);
    expect(pace.sample(5, 0.016)).toBe(false); // ~300 px/s
    for (let i = 0; i < 6; i++) pace.sample(20, 0.016); // ~1250 px/s
    expect(pace.gallop).toBe(true);
    pace.sample(11, 0.016); // ~690 px/s — still above the release threshold
    expect(pace.gallop).toBe(true);
    for (let i = 0; i < 6; i++) pace.sample(4, 0.016);
    expect(pace.gallop).toBe(false);
  });
});
