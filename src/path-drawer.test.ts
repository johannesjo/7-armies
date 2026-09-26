import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { createBattalion } from './battalion';
import { PathDrawer } from './path-drawer';

const drawers: PathDrawer[] = [];
afterEach(() => {
  for (const drawer of drawers.splice(0)) drawer.destroy();
});

function setup() {
  const blue = createBattalion('blue', 'swordsman', 'blue', { x: 200, y: 400 });
  const red = createBattalion('red', 'swordsman', 'red', { x: 800, y: 150 });
  blue.battalion.waypoints = [{ x: 200, y: 300 }];
  red.battalion.waypoints = [{ x: 800, y: 250 }];
  const stage = new Container();
  const canvas = new EventTarget() as HTMLCanvasElement;
  const drawer = new PathDrawer(stage, canvas);
  drawers.push(drawer);
  drawer.enable('blue', [...blue.units, ...red.units], [blue.battalion, red.battalion]);
  return { stage, canvas, drawer, blue: blue.battalion, red: red.battalion };
}

function pointer(stage: Container, event: string, x: number, y: number, pointerId = 1) {
  stage.emit(event, { global: { x, y }, pointerId, button: 0 });
}

function cancel(canvas: HTMLCanvasElement, pointerId: number) {
  canvas.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId }));
}

describe('PathDrawer input', () => {
  it('keeps a route after a tap or canceled drag, but replaces it after a real drag', () => {
    const { stage, canvas, blue } = setup();
    pointer(stage, 'pointerdown', 194, 394);
    pointer(stage, 'pointerup', 194, 394);
    expect(blue.waypoints).toEqual([{ x: 200, y: 300 }]);

    pointer(stage, 'pointerdown', 194, 394);
    pointer(stage, 'pointermove', 250, 350);
    cancel(canvas, 1);
    expect(blue.waypoints).toEqual([{ x: 200, y: 300 }]);

    pointer(stage, 'pointerdown', 194, 394, 3);
    pointer(stage, 'pointermove', 250, 350, 3);
    pointer(stage, 'pointerup', 260, 340, 3);
    expect(blue.waypoints.at(-1)).toEqual({ x: 260, y: 340 });
  });

  it('ignores other touches while a route is being drawn', () => {
    const { stage, canvas, blue } = setup();
    pointer(stage, 'pointerdown', 194, 394, 1);
    pointer(stage, 'pointermove', 800, 150, 2);
    pointer(stage, 'pointerup', 800, 150, 2);
    cancel(canvas, 2);
    expect(blue.waypoints).toEqual([{ x: 200, y: 300 }]);
    pointer(stage, 'pointermove', 230, 370, 1);
    pointer(stage, 'pointerup', 240, 360, 1);
    expect(blue.waypoints.at(-1)).toEqual({ x: 240, y: 360 });
    expect(blue.waypoints.every(p => p.x < 300)).toBe(true);
  });

  it('releases a canceled touch in Pixi touch-event fallback mode', () => {
    const { stage, canvas, blue } = setup();
    pointer(stage, 'pointerdown', 194, 394, 0);
    canvas.dispatchEvent(Object.assign(new Event('touchcancel'), {
      changedTouches: [{ identifier: 0 }],
    }));
    pointer(stage, 'pointerdown', 194, 394, 4);
    pointer(stage, 'pointerup', 250, 350, 4);
    expect(blue.waypoints.at(-1)).toEqual({ x: 250, y: 350 });
  });

  it('shows own route but hides the opponent route and hover path', () => {
    const { stage, drawer, red } = setup();
    const pathLine = vi.spyOn(drawer['gfx'], 'lineTo');
    drawer.renderPaths();
    expect(pathLine).toHaveBeenCalledWith(200, 300);
    expect(pathLine).not.toHaveBeenCalledWith(red.waypoints[0].x, red.waypoints[0].y);

    const hoverLine = vi.spyOn(drawer['hoverGfx'], 'lineTo');
    const hoverCircle = vi.spyOn(drawer['hoverGfx'], 'circle');
    pointer(stage, 'pointermove', 794, 144);
    expect(hoverLine).not.toHaveBeenCalled();
    expect(hoverCircle).toHaveBeenCalledWith(782, 132, 7);
  });

  it('still clears a route with right click', () => {
    const { stage, blue } = setup();
    pointer(stage, 'rightdown', 194, 394);
    expect(blue.waypoints).toEqual([]);
  });
});
