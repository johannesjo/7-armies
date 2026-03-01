import { describe, it, expect } from 'vitest';
import { createBattalion, createArmyBattalions, generateFormationOffsets, advanceBattalionWaypoint, assignUnitTargets, updateBattalionCenter, getBattalionAlive, findBattalionForUnit } from './battalion';
import { createUnit } from './units';
import { BATTALION_SIZE } from './constants';

describe('generateFormationOffsets', () => {
  it('generates the correct number of offsets', () => {
    const offsets = generateFormationOffsets(20, 'swordsman');
    expect(offsets).toHaveLength(20);
  });

  it('offsets form a regular grid centered at origin', () => {
    const offsets = generateFormationOffsets(20, 'swordsman');
    // 5 cols × 4 rows at spacing 10
    // Average position should be near (0,0)
    const avgX = offsets.reduce((s, o) => s + o.x, 0) / offsets.length;
    const avgY = offsets.reduce((s, o) => s + o.y, 0) / offsets.length;
    expect(Math.abs(avgX)).toBeLessThan(1);
    expect(Math.abs(avgY)).toBeLessThan(1);
  });

  it('archer formation is wider than deep', () => {
    const offsets = generateFormationOffsets(20, 'archer');
    const xs = offsets.map(o => o.x);
    const ys = offsets.map(o => o.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeGreaterThan(depth);
  });

  it('cavalry formation is deeper than wide', () => {
    const offsets = generateFormationOffsets(20, 'cavalry');
    const xs = offsets.map(o => o.x);
    const ys = offsets.map(o => o.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    expect(depth).toBeGreaterThan(width);
  });
});

describe('createBattalion', () => {
  it('creates a battalion with correct number of units', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    expect(battalion.unitIds).toHaveLength(BATTALION_SIZE);
    expect(units).toHaveLength(BATTALION_SIZE);
    expect(battalion.type).toBe('swordsman');
    expect(battalion.team).toBe('blue');
  });

  it('units are positioned near the center', () => {
    const { units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    for (const u of units) {
      expect(Math.abs(u.pos.x - 400)).toBeLessThan(25);
      expect(Math.abs(u.pos.y - 600)).toBeLessThan(25);
    }
  });

  it('units have battalionId set', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    for (const u of units) {
      expect(u.battalionId).toBe('bat1');
    }
  });

  it('battalion starts with no waypoints', () => {
    const { battalion } = createBattalion('bat1', 'archer', 'red', { x: 600, y: 100 });
    expect(battalion.waypoints).toEqual([]);
    expect(battalion.moveTarget).toBeNull();
    expect(battalion.engaged).toBe(false);
  });
});

describe('createArmyBattalions', () => {
  it('creates correct number of battalions and units per team', () => {
    const { battalions, units } = createArmyBattalions('blue');
    expect(battalions).toHaveLength(5);
    expect(units).toHaveLength(5 * BATTALION_SIZE); // 5 × 12 = 60
  });

  it('blue battalions spawn on bottom side', () => {
    const { units } = createArmyBattalions('blue');
    for (const u of units) {
      expect(u.pos.y).toBeGreaterThan(400);
      expect(u.team).toBe('blue');
    }
  });

  it('red battalions spawn on top side', () => {
    const { units } = createArmyBattalions('red');
    for (const u of units) {
      expect(u.pos.y).toBeLessThan(200);
      expect(u.team).toBe('red');
    }
  });
});

describe('advanceBattalionWaypoint', () => {
  it('pops first waypoint into moveTarget when no current target', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    battalion.waypoints = [{ x: 400, y: 400 }, { x: 400, y: 200 }];
    advanceBattalionWaypoint(battalion, units);
    expect(battalion.moveTarget).toEqual({ x: 400, y: 400 });
    expect(battalion.waypoints).toHaveLength(1);
  });

  it('advances to next waypoint when center reaches current target', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 400 });
    battalion.moveTarget = { x: 400, y: 400 }; // center is already at target
    battalion.waypoints = [{ x: 400, y: 200 }];
    advanceBattalionWaypoint(battalion, units);
    expect(battalion.moveTarget).toEqual({ x: 400, y: 200 });
    expect(battalion.waypoints).toHaveLength(0);
  });
});

describe('assignUnitTargets', () => {
  it('assigns formation positions when not engaged', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    battalion.moveTarget = { x: 400, y: 400 };

    const farEnemies = [createUnit('e1', 'swordsman', 'red', { x: 400, y: 100 })];
    assignUnitTargets(battalion, units, [...units, ...farEnemies]);

    expect(battalion.engaged).toBe(false);
    for (const u of units) {
      expect(u.moveTarget).not.toBeNull();
      // Should be near the battalion target
      expect(Math.abs(u.moveTarget!.x - 400)).toBeLessThan(25);
      expect(Math.abs(u.moveTarget!.y - 400)).toBeLessThan(25);
    }
  });

  it('only individually nearby melee units chase enemies', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    battalion.moveTarget = { x: 400, y: 500 };

    // Move one unit far away from the group, near a distant enemy
    const scoutUnit = units[0];
    scoutUnit.pos = { x: 100, y: 100 };
    const enemy = createUnit('e1', 'swordsman', 'red', { x: 120, y: 100 });
    assignUnitTargets(battalion, units, [...units, enemy]);

    expect(battalion.engaged).toBe(true);
    // The scout unit should chase the enemy
    expect(scoutUnit.moveTarget!.x).toBeCloseTo(enemy.pos.x, 0);
    expect(scoutUnit.moveTarget!.y).toBeCloseTo(enemy.pos.y, 0);

    // Remaining units (still at battalion center ~400,600) should stay in formation
    const formationUnits = units.filter(u => u !== scoutUnit);
    for (const u of formationUnits) {
      expect(u.moveTarget).not.toBeNull();
      // Formation targets cluster around battalion.moveTarget (400,500)
      expect(Math.abs(u.moveTarget!.x - 400)).toBeLessThan(25);
      expect(Math.abs(u.moveTarget!.y - 500)).toBeLessThan(25);
    }
  });

  it('idle units hold position (no moveTarget) when battalion has no orders', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    // No moveTarget, no enemies
    assignUnitTargets(battalion, units, units);

    expect(battalion.engaged).toBe(false);
    // Idle units should have null moveTarget so they hold position
    for (const u of units) {
      expect(u.moveTarget).toBeNull();
    }
  });

  it('archers stay in formation even when enemy is nearby', () => {
    const { battalion, units } = createBattalion('bat1', 'archer', 'blue', { x: 400, y: 400 });
    battalion.moveTarget = { x: 400, y: 300 };

    // Place enemy right next to an archer
    const enemy = createUnit('e1', 'swordsman', 'red', { x: units[0].pos.x + 5, y: units[0].pos.y });
    assignUnitTargets(battalion, units, [...units, enemy]);

    // Archers should still target formation positions, not the enemy
    for (const u of units) {
      expect(u.moveTarget).not.toBeNull();
      expect(Math.abs(u.moveTarget!.x - 400)).toBeLessThan(25);
      expect(Math.abs(u.moveTarget!.y - 300)).toBeLessThan(25);
    }
  });
});

describe('updateBattalionCenter', () => {
  it('returns average position of alive units', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    const center = updateBattalionCenter(battalion, units);
    expect(Math.abs(center.x - 400)).toBeLessThan(25);
    expect(Math.abs(center.y - 600)).toBeLessThan(25);
  });

  it('excludes dead units from center calculation', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    // Kill all but first unit, set it to a known position
    for (let i = 1; i < units.length; i++) {
      units[i].alive = false;
    }
    units[0].pos = { x: 200, y: 300 };
    const center = updateBattalionCenter(battalion, units);
    expect(center.x).toBeCloseTo(200);
    expect(center.y).toBeCloseTo(300);
  });
});

describe('getBattalionAlive', () => {
  it('counts alive units in battalion', () => {
    const { battalion, units } = createBattalion('bat1', 'swordsman', 'blue', { x: 400, y: 600 });
    expect(getBattalionAlive(battalion, units)).toBe(BATTALION_SIZE);
    units[0].alive = false;
    units[1].alive = false;
    expect(getBattalionAlive(battalion, units)).toBe(BATTALION_SIZE - 2);
  });
});

describe('findBattalionForUnit', () => {
  it('finds the correct battalion for a unit', () => {
    const { battalions, units } = createArmyBattalions('blue');
    const unit = units[0];
    const found = findBattalionForUnit(unit.id, battalions);
    expect(found).not.toBeNull();
    expect(found!.unitIds).toContain(unit.id);
  });

  it('returns null for unknown unit id', () => {
    const { battalions } = createArmyBattalions('blue');
    const found = findBattalionForUnit('nonexistent', battalions);
    expect(found).toBeNull();
  });
});
