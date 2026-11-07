import { Vec2 } from '../types';
import { Reins } from './direct';

/** Moves shorter than this (px) between press and release count as a tap. */
const TAP_SLOP = 8;

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const STEER_KEYS = new Set([...FORWARD_KEYS, ...BACK_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS]);
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
 * to that spot); draw fast to gallop. Keyboard: reins relative to the horses —
 * W/↑ ride on, A/D or ←/→ turn, S/↓ rein in.
 * Space, Shift or the right mouse button force a gallop.
 */
export class ChargeControls {
  private keys = new Set<string>();
  private mouseGallop = false;
  private stroke: { id: number; start: Vec2; last: Vec2; lastT: number; moved: boolean } | null = null;
  private attached = false;
  onPause: (() => void) | null = null;
  handler: StrokeHandler | null = null;
  /** Any press on the battlefield (used to unlock audio). */
  onInteract: (() => void) | null = null;

  constructor(private readonly surface: HTMLElement) {}

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
    this.reset();
  }

  /**
   * Keyboard reins (relative to the squadron's heading, like steering a car) — null
   * when no steering key is held — plus any gallop override.
   */
  read(): { reins: Reins | null; gallop: boolean } {
    let forward = false, back = false, turn = 0;
    for (const k of this.keys) {
      if (FORWARD_KEYS.has(k)) forward = true;
      if (BACK_KEYS.has(k)) back = true;
      if (LEFT_KEYS.has(k)) turn -= 1;
      if (RIGHT_KEYS.has(k)) turn += 1;
    }
    let gallop = this.mouseGallop;
    for (const k of this.keys) if (GALLOP_KEYS.has(k)) gallop = true;
    const steering = forward || back || turn !== 0;
    return { reins: steering ? { forward, back, turn } : null, gallop };
  }

  private reset = (): void => {
    this.keys.clear();
    this.mouseGallop = false;
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
    if (STEER_KEYS.has(e.code) || GALLOP_KEYS.has(e.code)) {
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
    this.onInteract?.();
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

  private preventMenu = (e: Event): void => e.preventDefault();
}
