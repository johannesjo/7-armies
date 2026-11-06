import { Vec2 } from '../types';
import { ChargeInput } from './sim';

/** Moves shorter than this (px) between press and release count as a tap. */
const TAP_SLOP = 8;

const KEY_DIRS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const GALLOP_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight']);

/** Receives route strokes drawn with mouse, pen or finger (surface-local CSS px). */
export interface StrokeHandler {
  strokeStart(p: Vec2): void;
  /** `dist`/`dt` are the screen distance and real time since the previous sample. */
  strokeMove(p: Vec2, dist: number, dt: number): void;
  strokeEnd(tap: boolean): void;
}

/**
 * Mouse / touch: press and drag to draw the squadron's route (a tap rides straight
 * to that spot). Keyboard: WASD/arrows steer directly. Space, Shift, the right mouse
 * button or the on-screen Gallop button force a gallop.
 */
export class ChargeControls {
  private keys = new Set<string>();
  private mouseGallop = false;
  private gallopTouch = false;
  private stroke: { id: number; start: Vec2; last: Vec2; lastT: number; moved: boolean } | null = null;
  private attached = false;
  onPause: (() => void) | null = null;
  handler: StrokeHandler | null = null;

  constructor(
    private readonly surface: HTMLElement,
    private readonly gallopBtn: HTMLElement,
  ) {}

  /** A route is being drawn right now. */
  get drawing(): boolean {
    return this.stroke !== null;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
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
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.surface.removeEventListener('contextmenu', this.preventMenu);
    this.gallopBtn.removeEventListener('pointerdown', this.onGallopDown);
    this.gallopBtn.removeEventListener('pointerup', this.onGallopUp);
    this.gallopBtn.removeEventListener('pointercancel', this.onGallopUp);
    this.gallopBtn.removeEventListener('pointerleave', this.onGallopUp);
    this.gallopBtn.removeEventListener('contextmenu', this.preventMenu);
    this.reset();
  }

  /** Direct keyboard steering plus any gallop override. dir is zero when no key is held. */
  read(): ChargeInput {
    let dx = 0, dy = 0;
    for (const k of this.keys) {
      const d = KEY_DIRS[k];
      if (d) { dx += d[0]; dy += d[1]; }
    }
    const mag = Math.hypot(dx, dy);
    if (mag > 0) { dx /= mag; dy /= mag; }
    let gallop = this.gallopTouch || this.mouseGallop;
    for (const k of this.keys) if (GALLOP_KEYS.has(k)) gallop = true;
    return { dirX: dx, dirY: dy, gallop };
  }

  private reset = (): void => {
    this.keys.clear();
    this.mouseGallop = false;
    this.gallopTouch = false;
    this.gallopBtn.classList.remove('pressed');
    if (this.stroke) {
      this.stroke = null;
      this.handler?.strokeEnd(false);
    }
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
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.button === 2) {
      this.mouseGallop = true;
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.stroke) return; // one route at a time
    const p = this.local(e);
    this.stroke = { id: e.pointerId, start: p, last: p, lastT: e.timeStamp, moved: false };
    this.handler?.strokeStart(p);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const s = this.stroke;
    if (!s || e.pointerId !== s.id) return;
    // Use every coalesced sample so fast flicks keep their shape and speed.
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of samples.length > 0 ? samples : [e]) {
      const p = this.local(ev);
      const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
      if (dist < 1) continue;
      const dt = Math.max(0.001, (ev.timeStamp - s.lastT) / 1000);
      if (Math.hypot(p.x - s.start.x, p.y - s.start.y) > TAP_SLOP) s.moved = true;
      s.last = p;
      s.lastT = ev.timeStamp;
      this.handler?.strokeMove(p, dist, dt);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button === 2) {
      this.mouseGallop = false;
      return;
    }
    const s = this.stroke;
    if (!s || e.pointerId !== s.id) return;
    this.stroke = null;
    this.handler?.strokeEnd(!s.moved);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.stroke && e.pointerId === this.stroke.id) {
      this.stroke = null;
      this.handler?.strokeEnd(false);
    }
  };

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
