import { describe, expect, it } from 'vitest';
import { ATTACK_FRAMES, CORPSE_FRAME, DEATH_FRAMES, DIRS, DRAWN_DIRS, FLEE_FRAMES, FRAMES, IDLE_FRAME, INFANTRY_LOOKS, WALK_FRAMES, attackFrame, buildFigure, deathFrame, dirAngle, facingFrame, fleeFrame, walkFrame } from './figure-art';
import { RTS_THEME } from '../theme';

describe('upright figure frames', () => {
  it('draws the east half of the compass and mirrors the west half', () => {
    expect(facingFrame(0)).toEqual({ dir: DRAWN_DIRS / 2 | 0, mirror: false });
    expect(facingFrame(-Math.PI / 2)).toEqual({ dir: 0, mirror: false });
    expect(facingFrame(Math.PI / 2).dir).toBe(DRAWN_DIRS - 1);
    const west = facingFrame(Math.PI);
    expect(west.mirror).toBe(true);
    expect(west.dir).toBe(facingFrame(0).dir);
    // North-west mirrors north-east.
    const nw = facingFrame(-Math.PI * 0.75);
    expect(nw).toEqual({ dir: facingFrame(-Math.PI * 0.25).dir, mirror: true });
  });

  it('maps every heading to the nearest drawn facing', () => {
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2 - Math.PI;
      const { dir, mirror } = facingFrame(a);
      const shown = mirror ? Math.PI - dirAngle(dir) : dirAngle(dir);
      const err = Math.abs(Math.atan2(Math.sin(shown - a), Math.cos(shown - a)));
      expect(err).toBeLessThanOrEqual(Math.PI / DIRS + 1e-9);
    }
  });

  it('cycles walk frames with the gait and steps through the attack', () => {
    const walks = new Set<number>();
    for (let i = 0; i < 64; i++) walks.add(walkFrame((i / 64) * Math.PI * 2 * 3 - 5));
    expect([...walks].sort((a, b) => a - b)).toEqual(Array.from({ length: WALK_FRAMES }, (_, i) => 1 + i));
    expect(attackFrame(0)).toBe(1 + WALK_FRAMES);
    expect(attackFrame(0.999)).toBe(WALK_FRAMES + ATTACK_FRAMES);
    expect(attackFrame(5)).toBe(WALK_FRAMES + ATTACK_FRAMES);
    expect(FRAMES).toBe(1 + WALK_FRAMES + ATTACK_FRAMES + FLEE_FRAMES + DEATH_FRAMES);
    expect(fleeFrame(0)).toBe(1 + WALK_FRAMES + ATTACK_FRAMES);
    expect(deathFrame(0)).toBe(FRAMES - DEATH_FRAMES);
    expect(deathFrame(1)).toBe(CORPSE_FRAME);
    expect(IDLE_FRAME).toBe(0);
  });

  it('stands figures on their feet: the art rises above the origin', () => {
    for (const type of ['swordsman', 'pikeman', 'archer', 'cavalry'] as const) {
      for (let v = 0; v < INFANTRY_LOOKS; v++) {
        for (let f = 0; f < FRAMES - DEATH_FRAMES; f++) {
          const fig = buildFigure(type, 'blue', 5, RTS_THEME, v, dirAngle(3), f);
          expect(fig.minY).toBeLessThan(-12); // taller than they are deep
          expect(fig.maxY).toBeGreaterThan(0);
          expect(fig.maxY).toBeLessThan(8);
          expect(Number.isFinite(fig.minX + fig.maxX)).toBe(true);
        }
      }
    }
  });

  it('lays the fallen down: a corpse is far lower than a standing man', () => {
    for (const type of ['swordsman', 'pikeman', 'archer', 'cavalry'] as const) {
      // Seen side-on (facing east), so the body's length lies across the screen.
      const standing = buildFigure(type, 'red', 5, RTS_THEME, 0, dirAngle(4), IDLE_FRAME);
      const fallen = buildFigure(type, 'red', 5, RTS_THEME, 0, dirAngle(4), CORPSE_FRAME);
      expect(-fallen.minY).toBeLessThan(-standing.minY * 0.6);
    }
  });
});
