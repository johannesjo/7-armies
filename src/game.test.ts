import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { createArmyBattalions } from './battalion';
import { GameEngine } from './game';
import type { Renderer } from './renderer';
import { NIGHT_THEME } from './theme';
import type { Battalion, Unit } from './types';

function makeEngine() {
  const stage = new Container();
  const renderer = {
    stage,
    canvas: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    currentTheme: NIGHT_THEME,
    ticker: { add: vi.fn(), remove: vi.fn() },
    effects: null,
    clearUnits: vi.fn(),
    renderElevationZones: vi.fn(),
    renderObstacles: vi.fn(),
    renderUnits: vi.fn(),
    renderProjectiles: vi.fn(),
    highlightZonesAt: vi.fn(),
    getUnitContainer: vi.fn(),
  } as unknown as Renderer;
  const onEvent = vi.fn();
  const engine = new GameEngine(renderer, onEvent);
  return { engine, renderer, onEvent, stage };
}

type GameInternals = {
  units: Unit[];
  battalions: Battalion[];
  obstacles: [];
  elevationZones: [];
  roundTimer: number;
  elapsedTime: number;
  _phase: 'playing';
  recordFrame: () => void;
  tick: (ticker: { deltaMS: number }) => void;
  generateAiPaths: () => void;
};

describe('game replay recording and lifecycle', () => {
  it('starts at time zero, records simulated time, and keeps playing after the replay cap', () => {
    const { engine, onEvent } = makeEngine();
    engine.startBattle();
    expect(engine.getReplayData()?.frames[0].time).toBe(0);

    const state = engine as unknown as GameInternals;
    const blue = engine.getUnits().find(u => u.team === 'blue')!;
    const red = engine.getUnits().find(u => u.team === 'red')!;
    state.units = [blue, red];
    state.battalions = [];
    state._phase = 'playing';
    state.roundTimer = 3;
    engine.setSpeed(3);
    state.tick({ deltaMS: 50 });
    expect(engine.getReplayData()?.frames[1].time).toBeCloseTo(0.15);

    for (let i = 2; i < 1800; i++) state.recordFrame();
    expect(engine.getReplayData()).toBeNull();

    const elapsed = state.elapsedTime;
    state.tick({ deltaMS: 16 });
    expect(state.elapsedTime).toBeGreaterThan(elapsed);
    expect(onEvent).toHaveBeenCalledWith('update', expect.anything());
    expect(engine.getReplayData()).toBeNull();
    engine.stop();
  });

  it('cancels the delayed cover transition when stopped', () => {
    vi.useFakeTimers();
    try {
      const { engine } = makeEngine();
      engine.startBattle();
      engine.confirmPlan();
      expect(engine.phase).toBe('cover');
      engine.stop();
      vi.advanceTimersByTime(1500);
      expect(engine.phase).toBe('cover');
    } finally {
      vi.useRealTimers();
    }
  });

  it('generates candidate routes around each red battalion center', () => {
    const { engine } = makeEngine();
    const red = createArmyBattalions('red');
    const bats = red.battalions.slice(0, 2);
    for (const unit of red.units) {
      if (bats[0].unitIds.includes(unit.id)) unit.pos = { x: 100, y: 200 };
      if (bats[1].unitIds.includes(unit.id)) unit.pos = { x: 900, y: 200 };
    }
    const state = engine as unknown as GameInternals;
    state.units = red.units;
    state.battalions = bats;
    state.obstacles = [];
    state.elevationZones = [];
    state.generateAiPaths();

    expect(bats[0].waypoints[0].x).toBeLessThan(400);
    expect(bats[1].waypoints[0].x).toBeGreaterThan(600);
    expect(bats[1].waypoints[0].x).toBeLessThan(900);
  });
});
