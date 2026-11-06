import { Vec2 } from '../types';
import { ChargeInput } from './sim';

const STICK_RADIUS = 56;
const MOUSE_DEADZONE = 22;

const KEY_DIRS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const GALLOP_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight']);

/**
 * Turns keyboard (WASD/arrows + Space), mouse (hold left to ride toward the cursor,
 * right button to gallop) and touch (virtual stick + gallop button) into a ChargeInput.
 */
export class ChargeControls {
  private keys = new Set<string>();
  private mouse = { steering: false, gallop: false, x: 0, y: 0 };
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private gallopTouch = false;
  private attached = false;
  onPause: (() => void) | null = null;

  constructor(
    private readonly surface: HTMLElement,
    private readonly stickEl: HTMLElement,
    private readonly knobEl: HTMLElement,
    private readonly gallopBtn: HTMLElement,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.surface.addEventListener('contextmenu', this.preventMenu);
    this.gallopBtn.addEventListener('pointerdown', this.onGallopDown);
    this.gallopBtn.addEventListener('pointerup', this.onGallopUp);
    this.gallopBtn.addEventListener('pointercancel', this.onGallopUp);
    this.gallopBtn.addEventListener('pointerleave', this.onGallopUp);
    this.gallopBtn.addEventListener('contextmenu', this.preventMenu);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.reset);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.surface.removeEventListener('contextmenu', this.preventMenu);
    this.gallopBtn.removeEventListener('pointerdown', this.onGallopDown);
    this.gallopBtn.removeEventListener('pointerup', this.onGallopUp);
    this.gallopBtn.removeEventListener('pointercancel', this.onGallopUp);
    this.gallopBtn.removeEventListener('pointerleave', this.onGallopUp);
    this.gallopBtn.removeEventListener('contextmenu', this.preventMenu);
    this.reset();
  }

  /** @param leaderScreen leader position in surface-local CSS pixels (for mouse steering). */
  read(leaderScreen: Vec2 | null): ChargeInput {
    let dx = 0, dy = 0;
    for (const k of this.keys) {
      const d = KEY_DIRS[k];
      if (d) { dx += d[0]; dy += d[1]; }
    }
    let mag = Math.hypot(dx, dy);
    if (mag > 0) { dx /= mag; dy /= mag; }

    if (mag === 0 && this.stick) {
      dx = (this.stick.x - this.stick.ox) / STICK_RADIUS;
      dy = (this.stick.y - this.stick.oy) / STICK_RADIUS;
      mag = Math.hypot(dx, dy);
      if (mag > 1) { dx /= mag; dy /= mag; }
    }

    if (mag === 0 && this.mouse.steering && leaderScreen) {
      const mx = this.mouse.x - leaderScreen.x;
      const my = this.mouse.y - leaderScreen.y;
      const m = Math.hypot(mx, my);
      if (m > MOUSE_DEADZONE) { dx = mx / m; dy = my / m; }
    }

    let gallop = this.gallopTouch || this.mouse.gallop;
    for (const k of this.keys) if (GALLOP_KEYS.has(k)) gallop = true;
    return { dirX: dx, dirY: dy, gallop };
  }

  private reset = (): void => {
    this.keys.clear();
    this.mouse.steering = false;
    this.mouse.gallop = false;
    this.gallopTouch = false;
    this.gallopBtn.classList.remove('pressed');
    this.endStick();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!e.repeat) this.onPause?.();
      e.preventDefault();
      return;
    }
    if (KEY_DIRS[e.code] || GALLOP_KEYS.has(e.code)) {
      this.keys.add(e.code);
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private local(e: PointerEvent): Vec2 {
    const r = this.surface.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    const p = this.local(e);
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouse.steering = true;
      if (e.button === 2) this.mouse.gallop = true;
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      e.preventDefault();
      return;
    }
    if (this.stick) return;
    this.stick = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
    this.stickEl.style.left = `${p.x}px`;
    this.stickEl.style.top = `${p.y}px`;
    this.stickEl.classList.add('active');
    this.knobEl.style.transform = 'translate(-50%, -50%)';
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    if (e.pointerType === 'mouse') {
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      return;
    }
    if (!this.stick || e.pointerId !== this.stick.id) return;
    this.stick.x = p.x;
    this.stick.y = p.y;
    let kx = p.x - this.stick.ox, ky = p.y - this.stick.oy;
    const m = Math.hypot(kx, ky);
    if (m > STICK_RADIUS) { kx *= STICK_RADIUS / m; ky *= STICK_RADIUS / m; }
    this.knobEl.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouse.steering = false;
      if (e.button === 2) this.mouse.gallop = false;
      return;
    }
    if (this.stick && e.pointerId === this.stick.id) this.endStick();
  };

  private endStick(): void {
    this.stick = null;
    this.stickEl.classList.remove('active');
  }

  private onGallopDown = (e: PointerEvent): void => {
    this.gallopTouch = true;
    this.gallopBtn.classList.add('pressed');
    e.preventDefault();
    e.stopPropagation();
  };

  private onGallopUp = (): void => {
    this.gallopTouch = false;
    this.gallopBtn.classList.remove('pressed');
  };

  private preventMenu = (e: Event): void => e.preventDefault();
}
