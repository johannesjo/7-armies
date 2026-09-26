import { describe, expect, it, vi } from 'vitest';
import { Graphics } from 'pixi.js';
import { Renderer } from './renderer';
import { Projectile, Unit } from './types';

describe('projectile rendering', () => {
  it('keeps graphics bounded across frames and clears expired projectiles', () => {
    const renderer = new Renderer();
    const projectile: Projectile = {
      pos: { x: 100, y: 100 },
      vel: { x: 0, y: 0 },
      target: { x: 200, y: 100 },
      damage: 10,
      radius: 3,
      team: 'blue',
      maxRange: 200,
      distanceTraveled: 0,
    };

    renderer.renderProjectiles([projectile]);
    const graphics = renderer.stage.getChildAt(0) as Graphics;
    expect(graphics.context.instructions).toHaveLength(1);
    expect(graphics.context.instructions[0]).toMatchObject({ data: { style: { color: 0x88ccff } } });

    projectile.team = 'red';
    renderer.renderProjectiles([projectile]);
    expect(graphics.context.instructions[0]).toMatchObject({ data: { style: { color: 0xff8888 } } });

    for (let frame = 0; frame < 120; frame++) {
      projectile.pos.x++;
      renderer.renderProjectiles([projectile]);
      expect(renderer.stage.children).toEqual([graphics]);
      expect(graphics.context.instructions).toHaveLength(1);
    }
    expect(graphics.getLocalBounds().minX).toBe(217);

    renderer.renderProjectiles([]);
    expect(graphics.context.instructions).toHaveLength(0);
    renderer.stage.destroy({ children: true });
  });
});

describe('unit rendering lifecycle', () => {
  it('destroys live and dying graphics when resetting a replay', () => {
    const renderer = new Renderer();
    const unit: Unit = {
      id: 'archer-1', type: 'archer', team: 'blue', pos: { x: 100, y: 100 },
      vel: { x: 0, y: 0 }, gunAngle: 0, hp: 10, maxHp: 10, alive: true,
      radius: 4, speed: 65, damage: 10, range: 200, moveTarget: null,
      waypoints: [], attackTargetId: null, fireCooldown: 3.5, fireTimer: 0,
      projectileSpeed: 200, projectileRadius: 3, turnSpeed: 1.5,
    };
    renderer.renderUnits([unit]);
    const dying = renderer.getUnitContainer(unit.id)!;
    const destroyDying = vi.spyOn(dying, 'destroy');

    renderer.renderUnits([{ ...unit, alive: false }], 0.01);
    renderer.renderUnits([unit], 0);
    const active = renderer.getUnitContainer(unit.id)!;
    const destroyActive = vi.spyOn(active, 'destroy');
    expect(renderer.stage.children).toContain(dying);
    expect(renderer.stage.children).toContain(active);

    renderer.clearUnits();
    expect(renderer.stage.children).toHaveLength(0);
    expect(destroyDying).toHaveBeenCalledTimes(1);
    expect(destroyActive).toHaveBeenCalledTimes(1);
    expect(renderer.getUnitContainer(unit.id)).toBeUndefined();
  });
});
