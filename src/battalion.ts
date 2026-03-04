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
    spacing = 10;
  } else if (type === 'cavalry') {
    cols = 4;
    spacing = 13;
  } else {
    // swordsman, pikeman — standard ranks
    cols = 4;
    spacing = 12;
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
  const size = BATTALION_SIZE[type];
  const offsets = generateFormationOffsets(size, type);
  const units: Unit[] = [];
  const unitIds: string[] = [];

  for (let i = 0; i < size; i++) {
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
  const groupWidth = MAP_WIDTH * 0.5;
  const startX = (MAP_WIDTH - groupWidth) / 2;
  const spacing = groupWidth / (totalBattalions + 1);

  const battalions: Battalion[] = [];
  const allUnits: Unit[] = [];
  let index = 0;

  for (const { type, count } of ARMY_COMPOSITION) {
    for (let i = 0; i < count; i++) {
      const x = startX + spacing * (index + 1);
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
 *  don't stall the whole battalion. Keeps the final target so units
 *  reach their formation positions. */
export function advanceBattalionWaypoint(battalion: Battalion, units: Unit[]): void {
  const alive = units.filter(u => battalion.unitIds.includes(u.id) && u.alive);
  if (alive.length === 0) return;

  if (!battalion.moveTarget) {
    battalion.moveTarget = battalion.waypoints.length > 0
      ? battalion.waypoints.shift()!
      : null;
    return;
  }

  // No more waypoints — keep final target so units finish moving to formation
  if (battalion.waypoints.length === 0) return;

  // Count how many units are near the current intermediate waypoint
  const threshold = 25;
  let nearCount = 0;
  for (const u of alive) {
    const dx = battalion.moveTarget.x - u.pos.x;
    const dy = battalion.moveTarget.y - u.pos.y;
    if (dx * dx + dy * dy < threshold * threshold) nearCount++;
  }

  // Advance when 60% of alive units have arrived (stragglers don't stall)
  if (nearCount >= alive.length * 0.6) {
    battalion.moveTarget = battalion.waypoints.shift()!;
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
  const defaultFacing = battalion.team === 'blue' ? -Math.PI / 2 : Math.PI / 2;
  let facingAngle: number;
  if (battalion.moveTarget) {
    const dx = battalion.moveTarget.x - cx;
    const dy = battalion.moveTarget.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Only use move direction if far enough away to be meaningful
    if (dist > 5) {
      facingAngle = Math.atan2(dy, dx);
      battalion.lastFacingAngle = facingAngle;
    } else {
      facingAngle = battalion.lastFacingAngle ?? defaultFacing;
    }
  } else {
    facingAngle = battalion.lastFacingAngle ?? defaultFacing;
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
    // Cavalry engages only after finishing their path
    const canEngage = unit.type !== 'archer' &&
      (unit.type !== 'cavalry' || (!battalion.moveTarget && battalion.waypoints.length === 0));
    let nearest: Unit | null = null;
    let nearestDist = Infinity;
    if (canEngage) {
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

    // Lower threshold to engage archers — melee units don't chase them as far
    const engageThreshold = nearest?.type === 'archer' ? engageR2 * 0.25 : engageR2;
    const unitEngaged = nearest !== null && nearestDist < engageThreshold;
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
      // Idle — handled below after the loop
      unit.moveTarget = null;
      unit.waypoints = [];
    }
  }

  // Clear regroup center when battalion gets new orders
  if (battalion.moveTarget) {
    battalion.regroupCenter = undefined;
  }

  // Idle regroup: compute compact formation for survivors only
  const idleUnits = alive.filter(u => u.moveTarget === null && u.waypoints.length === 0);
  if (idleUnits.length > 0 && !battalion.moveTarget) {
    if (!battalion.regroupCenter) {
      battalion.regroupCenter = { x: cx, y: cy };
    }
    const rc = battalion.regroupCenter;
    // Compact grid for just the survivors
    const compactOffsets = generateFormationOffsets(idleUnits.length, battalion.type);
    for (let i = 0; i < idleUnits.length; i++) {
      const raw = compactOffsets[i];
      const ox = raw.x * cosR - raw.y * sinR;
      const oy = raw.x * sinR + raw.y * cosR;
      const fx = rc.x + ox;
      const fy = rc.y + oy;
      const dx = fx - idleUnits[i].pos.x;
      const dy = fy - idleUnits[i].pos.y;
      if (dx * dx + dy * dy > 25) {
        idleUnits[i].moveTarget = { x: fx, y: fy };
      }
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
