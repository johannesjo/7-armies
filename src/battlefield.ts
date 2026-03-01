import { Obstacle, ElevationZone } from './types';
import { MAP_WIDTH, MAP_HEIGHT } from './constants';

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

/** Generate 2-3 symmetrical obstacles (smaller) in the middle zone of the map. */
export function generateObstacles(): Obstacle[] {
  const obstacles: Obstacle[] = [];

  // 40% no obstacles, 35% one pair, 25% one pair + center
  const roll = Math.random();
  const pairCount = roll < 0.4 ? 0 : 1;
  const hasCenter = roll > 0.75;

  for (let i = 0; i < pairCount; i++) {
    const w = randomInRange(30, 60);
    const h = randomInRange(30, 60);
    const x = randomInRange(50, MAP_WIDTH - 50 - w);
    const y = randomInRange(MAP_HEIGHT * 0.25, MAP_HEIGHT * 0.45 - h);

    obstacles.push({ x, y, w, h });
    obstacles.push({ x, y: MAP_HEIGHT - y - h, w, h });
  }

  if (hasCenter) {
    const w = randomInRange(30, 60);
    const h = randomInRange(30, 60);
    const x = randomInRange(50, MAP_WIDTH - 50 - w);
    const y = (MAP_HEIGHT - h) / 2;
    obstacles.push({ x, y, w, h });
  }

  return obstacles;
}

/** Generate 1-2 symmetric pairs of hill zones (2-4 total). */
export function generateElevationZones(): ElevationZone[] {
  const zones: ElevationZone[] = [];
  const pairCount = randomInRange(1, 3); // 1 or 2 pairs

  for (let i = 0; i < pairCount; i++) {
    const w = randomInRange(80, 160);
    const h = randomInRange(60, 120);
    const x = randomInRange(50, MAP_WIDTH - 50 - w);
    const y = randomInRange(MAP_HEIGHT * 0.25, MAP_HEIGHT * 0.45 - h);

    zones.push({ x, y, w, h });
    zones.push({ x, y: MAP_HEIGHT - y - h, w, h });
  }

  return zones;
}
