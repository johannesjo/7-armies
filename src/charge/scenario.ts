import { CHARGE as C } from './config';
import { BattalionSpec, SquadSpec } from './sim';

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

/**
 * One giant battle, everyone on the field from the first moment: two long infantry
 * lines locked in combat across the middle, archers behind each, second lines that
 * march up to fill holes, and open flanks for the squadron to ride around.
 * Break the whole red army and the day is won.
 */
export function createBattleSpecs(): BattalionSpec[] {
  const specs: BattalionSpec[] = [];
  const cx = C.WORLD_W / 2;
  const fy = C.FRONT_Y;
  const lineGap = 125;
  const frontCount = 8;
  const at = (i: number, n: number, gap: number) => cx + (i - (n - 1) / 2) * gap;

  // Red front line — swords and pikes alternate.
  for (let i = 0; i < frontCount; i++) {
    const type = i % 2 === 0 ? 'swordsman' : 'pikeman';
    specs.push({ team: 'red', type, role: 'front', x: at(i, frontCount, lineGap), y: fy - 20, facing: DOWN, count: 24, cols: 8 });
  }
  // Blue front line.
  for (let i = 0; i < frontCount; i++) {
    specs.push({ team: 'blue', type: 'swordsman', role: 'front', x: at(i, frontCount, lineGap), y: fy + 20, facing: UP, count: 24, cols: 8 });
  }

  // Archers behind each line.
  for (let i = 0; i < 4; i++) {
    specs.push({ team: 'red', type: 'archer', role: 'archer', x: at(i, 4, 250), y: fy - 170, facing: DOWN, count: 20, cols: 10 });
  }
  for (let i = 0; i < 3; i++) {
    specs.push({ team: 'blue', type: 'archer', role: 'archer', x: at(i, 3, 260), y: fy + 170, facing: UP, count: 18, cols: 9 });
  }

  // Blue second line: pikes on the wings that turn to face enemy horse (lead pursuing
  // knights onto them) and swords in the centre; each moves up when the line breaks.
  specs.push({ team: 'blue', type: 'pikeman', role: 'reserve', x: cx - 380, y: fy + 300, facing: UP, count: 20, cols: 5 });
  specs.push({ team: 'blue', type: 'swordsman', role: 'reserve', x: cx, y: fy + 320, facing: UP, count: 20, cols: 5 });
  specs.push({ team: 'blue', type: 'pikeman', role: 'reserve', x: cx + 380, y: fy + 300, facing: UP, count: 20, cols: 5 });

  // Red second line in deep blocks — catch them from behind before they plug a gap.
  for (let i = 0; i < 4; i++) {
    const type = i % 2 === 0 ? 'pikeman' : 'swordsman';
    specs.push({ team: 'red', type, role: 'reserve', x: at(i, 4, 300), y: fy - 300, facing: DOWN, count: 22, cols: 5 });
  }
  // Red flank guards and a last reserve in the rear — they wheel toward the squadron.
  specs.push({ team: 'red', type: 'pikeman', role: 'reserve', x: cx - 720, y: fy - 250, facing: DOWN, count: 20, cols: 5 });
  specs.push({ team: 'red', type: 'pikeman', role: 'reserve', x: cx + 720, y: fy - 250, facing: DOWN, count: 20, cols: 5 });
  specs.push({ team: 'red', type: 'swordsman', role: 'reserve', x: cx, y: fy - 460, facing: DOWN, count: 24, cols: 6 });

  return specs;
}

/**
 * Cavalry on the field from the start: an allied troop already raiding on the far
 * flank (ride into it to take command), red knights guarding both rear flanks, the
 * red general with his bodyguard far behind their lines — cut him down and the whole
 * army's heart sinks — and a hunting party that waits before riding for your banner.
 */
export function createSquadSpecs(): SquadSpec[] {
  const cx = C.WORLD_W / 2;
  return [
    { team: 'blue', ai: 'raider', x: cx + 860, y: C.FRONT_Y + 360, facing: UP, count: 8 },
    { team: 'red', ai: 'guard', x: cx + 640, y: C.FRONT_Y - 430, facing: DOWN, count: 8 },
    { team: 'red', ai: 'guard', x: cx - 640, y: C.FRONT_Y - 430, facing: DOWN, count: 8 },
    { team: 'red', ai: 'general', x: cx, y: C.FRONT_Y - 650, facing: DOWN, count: 1 },
    // His bodyguard stays close: it rides only at horsemen who come near him.
    { team: 'red', ai: 'guard', x: cx, y: C.FRONT_Y - 620, facing: DOWN, count: 6, guardRadius: 170 },
    { team: 'red', ai: 'hunter', x: cx + 300, y: C.FRONT_Y - 600, facing: DOWN, count: 10, muster: 70 },
  ];
}
