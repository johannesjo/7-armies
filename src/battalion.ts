import { Battalion, Unit, Team, UnitType, Vec2 } from './types';
import { ARMY_COMPOSITION, BATTALION_SIZE, MAP_WIDTH, MAP_HEIGHT, ENGAGEMENT_RADIUS } from './constants';
import { createUnit } from './units';

/** Generate regular grid formation offsets for a battalion.
 *  Swordsman/Pikeman: wide ranks (5 cols × 4 rows) — shield wall
 *  Archer: wide shallow (7 cols × 3 rows) — firing line
 *  Cavalry: narrow deep (4 cols × 5 rows) — wedge column */
export function generateFormationOffsets(count: number, type: UnitType = 'swordsman'): Vec2[] {
  let cols: number;
  let spacing: number;

  if (type === 'archer') {
    cols = 6;
    spacing = 7;
  } else if (type === 'cavalry') {
    cols = 4;
    spacing = 9;
  } else {
    // swordsman, pikeman — standard ranks
    cols = 4;
    spacing = 8;
  }

  const rows = Math.ceil(count / cols);
  const offsets: Vec2[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Center the grid around (0,0)
    const x = (col - (cols - 1) / 2) * spacing;
    const y = (row - (rows - 1) / 2) * spacing;
    offsets.push({ x, y });
  }

  return offsets;
}

/** Create a single battalion with its units. */
export function createBattalion(
  id: string,
  type: UnitType,
  team: Team,
  centerPos: Vec2,
): { battalion: Battalion; units: Unit[] } {
  const offsets = generateFormationOffsets(BATTALION_SIZE, type);
  const units: Unit[] = [];
  const unitIds: string[] = [];

  for (let i = 0; i < BATTALION_SIZE; i++) {
    const unitId = `${id}_u${i}`;
    const pos = {
      x: Math.max(4, Math.min(MAP_WIDTH - 4, centerPos.x + offsets[i].x)),
      y: Math.max(4, Math.min(MAP_HEIGHT - 4, centerPos.y + offsets[i].y)),
    };
    const unit = createUnit(unitId, type, team, pos);
    unit.battalionId = id;
    units.push(unit);
    unitIds.push(unitId);
  }

  return {
    battalion: {
      id,
      type,
      team,
      unitIds,
      waypoints: [],
      moveTarget: null,
      formationOffsets: offsets,
      engaged: false,
    },
    units,
  };
}

/** Create all 7 battalions + 140 units for a team. */
export function createArmyBattalions(team: Team): { battalions: Battalion[]; units: Unit[] } {
  const isBlue = team === 'blue';
  const baseY = isBlue ? MAP_HEIGHT * 0.92 : MAP_HEIGHT * 0.08;
  const totalBattalions = ARMY_COMPOSITION.reduce((sum, c) => sum + c.count, 0);
  const spacing = MAP_WIDTH / (totalBattalions + 1);

  const battalions: Battalion[] = [];
  const allUnits: Unit[] = [];
  let index = 0;

  for (const { type, count } of ARMY_COMPOSITION) {
    for (let i = 0; i < count; i++) {
      const x = spacing * (index + 1);
      const batId = `${team}_bat_${type}_${i}`;
      const { battalion, units } = createBattalion(batId, type, team, { x, y: baseY });
      battalions.push(battalion);
      allUnits.push(...units);
      index++;
    }
  }

  return { battalions, units: allUnits };
}

/** Pop the next waypoint when most units have reached the current target.
 *  Uses majority vote (60%) instead of center average so stragglers
 *  don't stall the whole battalion. */
export function advanceBattalionWaypoint(battalion: Battalion, units: Unit[]): void {
  const alive = units.filter(u => battalion.unitIds.includes(u.id) && u.alive);
  if (alive.length === 0) return;

  if (!battalion.moveTarget) {
    battalion.moveTarget = battalion.waypoints.length > 0
      ? battalion.waypoints.shift()!
      : null;
    return;
  }

  // Count how many units are near the current target
  const threshold = 40;
  let nearCount = 0;
  for (const u of alive) {
    const dx = battalion.moveTarget.x - u.pos.x;
    const dy = battalion.moveTarget.y - u.pos.y;
    if (dx * dx + dy * dy < threshold * threshold) nearCount++;
  }

  // Advance when 60% of alive units have arrived (stragglers don't stall)
  if (nearCount >= alive.length * 0.6) {
    battalion.moveTarget = battalion.waypoints.length > 0
      ? battalion.waypoints.shift()!
      : null;
  }
}

/** Assign per-unit movement targets based on battalion state.
 *  Units move in formation unless individually engaged in melee. */
export function assignUnitTargets(battalion: Battalion, units: Unit[], allUnits: Unit[]): void {
  const alive = units.filter(u => battalion.unitIds.includes(u.id) && u.alive);
  if (alive.length === 0) return;

  const enemies = allUnits.filter(u => u.alive && u.team !== battalion.team);
  const engageR2 = ENGAGEMENT_RADIUS * ENGAGEMENT_RADIUS;

  // Compute current center for regrouping when idle
  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.pos.x; cy += u.pos.y; }
  cx /= alive.length;
  cy /= alive.length;

  // Orient formation toward movement direction (not nearest enemy)
  let facingAngle: number;
  if (battalion.moveTarget) {
    const dx = battalion.moveTarget.x - cx;
    const dy = battalion.moveTarget.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Only use move direction if far enough away to be meaningful
    if (dist > 5) {
      facingAngle = Math.atan2(dy, dx);
    } else {
      facingAngle = battalion.team === 'blue' ? -Math.PI / 2 : Math.PI / 2;
    }
  } else {
    // Idle — default team direction
    facingAngle = battalion.team === 'blue' ? -Math.PI / 2 : Math.PI / 2;
  }
  const rotation = facingAngle + Math.PI / 2;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  // Track whether any member is engaged (for the battalion flag)
  let anyEngaged = false;

  for (let i = 0; i < alive.length; i++) {
    const unit = alive[i];
    const offsetIndex = battalion.unitIds.indexOf(unit.id);
    const raw = battalion.formationOffsets[offsetIndex] ?? { x: 0, y: 0 };
    // Rotate offset to face the enemy
    const ox = raw.x * cosR - raw.y * sinR;
    const oy = raw.x * sinR + raw.y * cosR;

    // Per-unit engagement: is there an enemy within melee range of THIS unit?
    // Cavalry never chases individually — they follow battalion orders only
    let nearest: Unit | null = null;
    let nearestDist = Infinity;
    if (unit.type !== 'archer' && unit.type !== 'cavalry') {
      for (const enemy of enemies) {
        const dx = enemy.pos.x - unit.pos.x;
        const dy = enemy.pos.y - unit.pos.y;
        const d = dx * dx + dy * dy;
        if (d < nearestDist) {
          nearestDist = d;
          nearest = enemy;
        }
      }
    }

    const unitEngaged = nearest !== null && nearestDist < engageR2;
    if (unitEngaged) anyEngaged = true;

    if (unitEngaged && nearest) {
      // This melee unit has an enemy in range — chase it
      unit.moveTarget = { x: nearest.pos.x, y: nearest.pos.y };
      unit.waypoints = [];
    } else if (battalion.moveTarget) {
      // Stay in formation, rotated toward enemy
      unit.moveTarget = {
        x: battalion.moveTarget.x + ox,
        y: battalion.moveTarget.y + oy,
      };
      // Cavalry needs to know about remaining waypoints to maintain momentum
      if (unit.type === 'cavalry') {
        unit.waypoints = battalion.waypoints.map(wp => ({ x: wp.x + ox, y: wp.y + oy }));
      }
    } else {
      // Idle — hold position, don't chase shifting center
      unit.moveTarget = null;
      unit.waypoints = [];
    }
  }

  battalion.engaged = anyEngaged;
}

/** Update battalion center (average position of alive units). */
export function updateBattalionCenter(battalion: Battalion, units: Unit[]): Vec2 {
  const alive = units.filter(u => battalion.unitIds.includes(u.id) && u.alive);
  if (alive.length === 0) return { x: 0, y: 0 };

  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.pos.x; cy += u.pos.y; }
  return { x: cx / alive.length, y: cy / alive.length };
}

/** Get alive unit count for a battalion. */
export function getBattalionAlive(battalion: Battalion, units: Unit[]): number {
  return units.filter(u => battalion.unitIds.includes(u.id) && u.alive).length;
}

/** Find which battalion a unit belongs to. */
export function findBattalionForUnit(unitId: string, battalions: Battalion[]): Battalion | null {
  return battalions.find(b => b.unitIds.includes(unitId)) ?? null;
}
