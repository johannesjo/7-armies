import { CHARGE as C } from './config';
import { BattalionSpec, Wave } from './sim';

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

/**
 * The battle: two long infantry lines locked in combat across the middle of the field,
 * red archers and reserves behind theirs, and open flanks for the squadron to ride around.
 */
export function createBattleSpecs(): BattalionSpec[] {
  const specs: BattalionSpec[] = [];
  const cx = C.WORLD_W / 2;
  const fy = C.FRONT_Y;
  const lineGap = 125;
  const frontCount = 6;

  // Red front line — swords and pikes alternate.
  for (let i = 0; i < frontCount; i++) {
    const x = cx + (i - (frontCount - 1) / 2) * lineGap;
    const type = i % 2 === 0 ? 'swordsman' : 'pikeman';
    specs.push({ team: 'red', type, role: 'front', x, y: fy - 20, facing: DOWN, count: 24, cols: 8 });
  }
  // Blue front line.
  for (let i = 0; i < frontCount; i++) {
    const x = cx + (i - (frontCount - 1) / 2) * lineGap;
    specs.push({ team: 'blue', type: 'swordsman', role: 'front', x, y: fy + 20, facing: UP, count: 24, cols: 8 });
  }

  // Red archers behind their line.
  for (const dx of [-250, 0, 250]) {
    specs.push({ team: 'red', type: 'archer', role: 'archer', x: cx + dx, y: fy - 170, facing: DOWN, count: 20, cols: 10 });
  }
  // Blue archers behind ours.
  for (const dx of [-150, 150]) {
    specs.push({ team: 'blue', type: 'archer', role: 'archer', x: cx + dx, y: fy + 170, facing: UP, count: 18, cols: 9 });
  }

  // Red reserves guarding the rear — they wheel toward the squadron.
  specs.push({ team: 'red', type: 'pikeman', role: 'reserve', x: cx - 470, y: fy - 300, facing: DOWN, count: 20, cols: 5 });
  specs.push({ team: 'red', type: 'pikeman', role: 'reserve', x: cx + 470, y: fy - 300, facing: DOWN, count: 20, cols: 5 });
  specs.push({ team: 'red', type: 'swordsman', role: 'reserve', x: cx, y: fy - 360, facing: DOWN, count: 24, cols: 6 });

  return specs;
}

/**
 * Red reinforcements march in from their camp in columns. Columns on the march
 * show their flanks — catch them before they reach the fight.
 */
export function createWaves(): Wave[] {
  const cx = C.WORLD_W / 2;
  const y = 40;
  const col = (type: BattalionSpec['type'], x: number, count = 20): BattalionSpec =>
    ({ team: 'red', type, role: type === 'archer' ? 'archer' : 'front', x, y, facing: DOWN, count, cols: 4 });
  return [
    { time: 45, specs: [col('swordsman', cx - 600), col('pikeman', cx - 520), col('archer', cx + 560, 16)] },
    { time: 100, specs: [col('swordsman', cx + 520), col('swordsman', cx + 600), col('pikeman', cx - 80), col('pikeman', cx + 80)] },
    { time: 160, specs: [col('swordsman', cx - 640), col('pikeman', cx - 560), col('swordsman', cx + 560), col('pikeman', cx + 640), col('archer', cx, 16)] },
  ];
}
