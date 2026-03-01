import { describe, it, expect } from 'vitest';
import { scorePosition, generateCandidates } from './ai-scoring';
import { createUnit } from './units';
import { Obstacle, ElevationZone } from './types';

describe('scorePosition', () => {
  const enemies = [
    createUnit('e1', 'swordsman', 'blue', { x: 600, y: 600 }),
  ];
  const obstacles: Obstacle[] = [];
  const elevationZones: ElevationZone[] = [];

  it('archers prefer far positions over close ones', () => {
    const archer = createUnit('a1', 'archer', 'red', { x: 600, y: 100 });

    const farScore = scorePosition({
      candidate: { x: 600, y: 350 },
      unit: archer,
      enemies,
      obstacles,
      elevationZones,
    });

    const closeScore = scorePosition({
      candidate: { x: 600, y: 560 },
      unit: archer,
      enemies,
      obstacles,
      elevationZones,
    });

    expect(farScore).toBeGreaterThan(closeScore);
  });

  it('cavalry prefer close positions', () => {
    const cavalry = createUnit('c1', 'cavalry', 'red', { x: 600, y: 300 });

    const closeScore = scorePosition({
      candidate: { x: 600, y: 560 },
      unit: cavalry,
      enemies,
      obstacles,
      elevationZones,
    });

    const farScore = scorePosition({
      candidate: { x: 600, y: 350 },
      unit: cavalry,
      enemies,
      obstacles,
      elevationZones,
    });

    expect(closeScore).toBeGreaterThan(farScore);
  });

  it('swordsmen value flanking positions', () => {
    const unit = createUnit('sw1', 'swordsman', 'red', { x: 400, y: 400 });
    // Enemy facing right (gunAngle = 0), so approaching from behind (left) is a flank
    const enemy = createUnit('e1', 'swordsman', 'blue', { x: 500, y: 500 });
    enemy.gunAngle = 0;

    const flankScore = scorePosition({
      candidate: { x: 460, y: 500 }, // behind enemy (left of it)
      unit: unit,
      enemies: [enemy],
      obstacles,
      elevationZones,
    });

    const frontalScore = scorePosition({
      candidate: { x: 540, y: 500 }, // in front of enemy (right of it)
      unit: unit,
      enemies: [enemy],
      obstacles,
      elevationZones,
    });

    expect(flankScore).toBeGreaterThan(frontalScore);
  });

  it('unreachable positions score -Infinity', () => {
    const unit = createUnit('sw1', 'swordsman', 'red', { x: 100, y: 100 });
    const score = scorePosition({
      candidate: { x: 2500, y: 2500 },
      unit: unit,
      enemies,
      obstacles,
      elevationZones,
    });

    expect(score).toBe(-Infinity);
  });

  it('elevated positions score higher for archers', () => {
    const archer = createUnit('a1', 'archer', 'red', { x: 600, y: 100 });
    const zone: ElevationZone = { x: 550, y: 280, w: 100, h: 100 };

    const elevatedScore = scorePosition({
      candidate: { x: 600, y: 330 },
      unit: archer,
      enemies,
      obstacles,
      elevationZones: [zone],
    });

    const flatScore = scorePosition({
      candidate: { x: 600, y: 200 },
      unit: archer,
      enemies,
      obstacles,
      elevationZones: [zone],
    });

    expect(elevatedScore).toBeGreaterThan(flatScore);
  });
});

describe('generateCandidates', () => {
  it('excludes positions inside obstacles', () => {
    const unit = createUnit('u1', 'swordsman', 'red', { x: 600, y: 400 });
    const obstacle: Obstacle = { x: 580, y: 380, w: 40, h: 40 };

    const candidates = generateCandidates(unit, [obstacle], []);

    // No candidate should be inside the obstacle
    for (const c of candidates) {
      const cx = Math.max(obstacle.x, Math.min(obstacle.x + obstacle.w, c.x));
      const cy = Math.max(obstacle.y, Math.min(obstacle.y + obstacle.h, c.y));
      const dx = c.x - cx;
      const dy = c.y - cy;
      const padding = unit.radius + 4;
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(padding * padding);
    }
  });

  it('includes elevation zone centers', () => {
    const unit = createUnit('u1', 'swordsman', 'red', { x: 600, y: 400 });
    const zone: ElevationZone = { x: 550, y: 350, w: 100, h: 100 };

    const candidates = generateCandidates(unit, [], [zone]);

    const hasCenter = candidates.some(c =>
      Math.abs(c.x - 600) < 1 && Math.abs(c.y - 400) < 1,
    );
    expect(hasCenter).toBe(true);
  });
});
