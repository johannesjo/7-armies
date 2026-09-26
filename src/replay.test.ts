import { describe, expect, it, vi } from 'vitest';
import { ReplayPlayer } from './replay';
import type { Renderer } from './renderer';
import type { ReplayData, Unit } from './types';

function makeReplay() {
  let tick: ((ticker: { deltaMS: number }) => void) | undefined;
  const rendered: { x: number; dt: number }[] = [];
  const effects = {
    update: vi.fn(),
    addMuzzleFlash: vi.fn(),
  };
  const renderer = {
    clearUnits: vi.fn(),
    renderProjectiles: vi.fn(),
    renderElevationZones: vi.fn(),
    renderObstacles: vi.fn(),
    renderUnits: vi.fn((units: Unit[], dt: number) => {
      rendered.push({ x: units[0].pos.x, dt });
    }),
    ticker: {
      add: vi.fn((fn: typeof tick) => { tick = fn; }),
      remove: vi.fn(),
    },
    effects,
  } as unknown as Renderer;
  const unit = (x: number) => ({
    id: 'one', type: 'archer' as const, team: 'blue' as const,
    x, y: 20, vx: 0, vy: 0, gunAngle: 0,
    hp: 10, maxHp: 10, alive: true, radius: 4,
  });
  const data: ReplayData = {
    frames: [
      { time: 0, units: [unit(0)], projectiles: [] },
      { time: 0.05, units: [unit(5)], projectiles: [] },
      { time: 0.15, units: [unit(15)], projectiles: [] },
    ],
    events: [{ frame: 1, type: 'fire', pos: { x: 5, y: 20 }, angle: 0,
      damage: 10, flanked: false, team: 'blue' }],
    obstacles: [], elevationZones: [],
  };
  const onEvent = vi.fn();
  const player = new ReplayPlayer(renderer, data, onEvent);
  return { player, renderer, rendered, effects, onEvent, tick: (deltaMS: number) => tick?.({ deltaMS }) };
}

describe('replay timing and reset', () => {
  it('uses recorded frame times and reports progress from time zero', () => {
    const { player, rendered, effects, onEvent, tick } = makeReplay();
    player.start();
    expect(rendered.at(-1)).toEqual({ x: 0, dt: 0 });
    expect(onEvent).toHaveBeenLastCalledWith('frame', { time: 0, duration: 0.15 });

    tick(20);
    expect(rendered.at(-1)).toEqual({ x: 0, dt: 0.02 });
    tick(30);
    expect(rendered.at(-1)?.x).toBe(5);
    expect(effects.addMuzzleFlash).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenLastCalledWith('frame', { time: 0.05, duration: 0.15 });

    tick(100);
    expect(rendered.at(-1)?.x).toBe(15);
    expect(onEvent).toHaveBeenLastCalledWith('end', { time: 0.15, duration: 0.15 });
    expect(player.isPaused).toBe(true);
  });

  it('restarts completed playback and scales animation time at 3x', () => {
    const { player, renderer, rendered, effects, onEvent, tick } = makeReplay();
    player.start();
    tick(150);
    player.togglePause();
    expect(player.isPaused).toBe(false);
    expect(rendered.at(-1)).toEqual({ x: 0, dt: 0 });
    expect(onEvent).toHaveBeenLastCalledWith('frame', { time: 0, duration: 0.15 });
    expect(renderer.clearUnits).toHaveBeenCalledTimes(2);

    player.setSpeed(3);
    tick(20);
    expect(rendered.at(-1)?.x).toBe(5);
    expect(rendered.at(-1)?.dt).toBeCloseTo(0.06);
    expect(effects.update).toHaveBeenLastCalledWith(0.06);

    player.stop();
    expect(renderer.clearUnits).toHaveBeenCalledTimes(3);
    expect(renderer.ticker.remove).toHaveBeenCalledTimes(1);
  });
});
