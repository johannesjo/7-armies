import { describe, expect, it } from 'vitest';
import { ATTACK_FRAMES, DIRS, DRAWN_DIRS, FRAMES, IDLE_FRAME, WALK_FRAMES, attackFrame, buildFigure, dirAngle, facingFrame, walkFrame } from './figure-art';
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
    expect(attackFrame(0.999)).toBe(FRAMES - 1);
    expect(attackFrame(5)).toBe(FRAMES - 1);
    expect(FRAMES).toBe(1 + WALK_FRAMES + ATTACK_FRAMES);
    expect(IDLE_FRAME).toBe(0);
  });

  it('stands figures on their feet: the art rises above the origin', () => {
    for (const type of ['swordsman', 'pikeman', 'archer', 'cavalry'] as const) {
      for (let f = 0; f < FRAMES; f++) {
        const fig = buildFigure(type, 'blue', 5, RTS_THEME, 1, dirAngle(3), f);
        expect(fig.minY).toBeLessThan(-12); // taller than they are deep
        expect(fig.maxY).toBeGreaterThan(0);
        expect(fig.maxY).toBeLessThan(8);
        expect(Number.isFinite(fig.minX + fig.maxX)).toBe(true);
      }
    }
  });
});
