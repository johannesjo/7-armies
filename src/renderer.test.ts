import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { Renderer } from './renderer';
import { Projectile } from './types';

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
