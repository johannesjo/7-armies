import { Application, Ticker } from 'pixi.js';
import { Theme } from '../theme';
import { CHARGE as C } from './config';
import { ChargeSim, SimEvent, NO_INPUT, ChargeInput } from './sim';
import { createBattleSpecs, createWaves, createSquadSpecs } from './scenario';
import { ChargeView, mixColor } from './view';
import { ChargeControls, Joystick, StrokeHandler } from './input';
import { RiderPath, StrokePace } from './path';
import { ChargeAudio } from './audio';
import { directInput, directZones, reinsInput, joystickInput } from './direct';
import { Vec2 } from '../types';

export interface ChargeResult {
  outcome: 'victory' | 'defeat';
  reason: string;
  score: number;
  kills: number;
  routs: number;
  ridersLost: number;
  bestCombo: number;
  joined: number;
  time: number;
  best: number;
  newBest: boolean;
}

const BEST_KEY = 'charge.best';
const SCHEME_KEY = 'charge.controls';
const TEXT_KEY = 'charge.combatText';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}

function writeFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ }
}

/** 'direct': hold a finger / the mouse where to ride. 'route': draw the path to ride. */
export type ControlScheme = 'joystick' | 'direct' | 'route';

const SCHEME_ORDER: ControlScheme[] = ['joystick', 'direct', 'route'];
const SCHEME_LABEL: Record<ControlScheme, string> = {
  joystick: 'joystick',
  direct: 'point & ride',
  route: 'draw route',
};

/** Saved choice, else the joystick on touch screens (a thumb would hide the horses) and point & ride elsewhere. */
function readScheme(): ControlScheme {
  let stored: string | null = null;
  try { stored = localStorage.getItem(SCHEME_KEY); } catch { /* storage unavailable */ }
  if (stored === 'joystick' || stored === 'direct' || stored === 'route') return stored;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return touch ? 'joystick' : 'direct';
}

function readBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}

function writeBest(score: number): void {
  try { localStorage.setItem(BEST_KEY, String(score)); } catch { /* storage unavailable */ }
}

const STEP = 1 / 60;
/** Longest real-time gap one frame catches up on (e.g. after a tab switch). */
const MAX_FRAME_DT = 0.25;
const MAX_STEPS_PER_FRAME = Math.ceil(MAX_FRAME_DT / STEP) + 1;
const END_DELAY = 2.2;
/** Drawing faster than this share of the screen's long side per second means gallop. */
const GALLOP_STROKE_SPEED = 0.6;
/** Strokes starting this close (px) to the end of the current route extend it. */
const EXTEND_RADIUS = 36;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Owns the cavalry action mode: its own Pixi app, the simulation loop, HUD and controls. */
export class ChargeMode {
  private app: Application | null = null;
  private appReady: Promise<void> | null = null;
  private view: ChargeView | null = null;
  private sim: ChargeSim | null = null;
  private controls: ChargeControls;
  private paused = false;
  private endTimer = -1;
  private hudTimer = 0;
  private frameEvents: SimEvent[] = [];
  private theme: Theme | null = null;
  private lastRiders = -1;
  private readonly path = new RiderPath();
  private scheme: ControlScheme = readScheme();
  /** Pointer position (surface px) while held down in point-and-ride mode. */
  private aim: Vec2 | null = null;
  private readonly controlsBtn = $('ch-controls-btn');
  private readonly joystick = new Joystick($('ch-joy-zone'), $('ch-joy'), $('ch-joy-knob'));
  private readonly textBtn = $('ch-text-btn');
  /** Floating combat text, combo counter and banners — off by default for a cleaner screen. */
  private combatText = readFlag(TEXT_KEY, false);
  private readonly pace = new StrokePace(800);
  private movedOnce = false;
  private bannerTimeout: ReturnType<typeof setTimeout> | null = null;
  private hintTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly onResize = () => this.resize();

  private readonly screen = $('charge-screen');
  private readonly host = $('charge-canvas');
  private readonly ridersEl = $('ch-riders');
  private readonly speedEl = $('ch-speed');
  private readonly scoreEl = $('ch-score');
  private readonly comboEl = $('ch-combo');
  private readonly redBar = $('ch-red');
  private readonly blueBar = $('ch-blue');
  private readonly timeEl = $('ch-time');
  private readonly bannerEl = $('ch-banner');
  private readonly hintEl = $('ch-hint');
  private readonly pauseEl = $('ch-pause');
  private readonly damageEl = $('ch-damage');
  private readonly minimap = $('ch-minimap') as HTMLCanvasElement;
  private readonly muteBtn = $('ch-mute-btn');
  private readonly audio = new ChargeAudio();

  constructor(private readonly cb: { onEnd(result: ChargeResult): void; onQuit(): void }) {
    this.controls = new ChargeControls(this.host);
    this.controls.onInteract = () => this.audio.start();
    this.muteBtn.addEventListener('click', () => {
      this.audio.muted = !this.audio.muted;
      this.audio.start();
      this.updateMuteBtn();
    });
    this.updateMuteBtn();
    this.controlsBtn.addEventListener('click', () => {
      this.scheme = SCHEME_ORDER[(SCHEME_ORDER.indexOf(this.scheme) + 1) % SCHEME_ORDER.length];
      try { localStorage.setItem(SCHEME_KEY, this.scheme); } catch { /* storage unavailable */ }
      this.path.clear();
      this.aim = null;
      this.applyScheme();
    });
    this.applyScheme();
    this.textBtn.addEventListener('click', () => {
      this.combatText = !this.combatText;
      writeFlag(TEXT_KEY, this.combatText);
      this.view?.setCombatText(this.combatText);
      this.updateTextBtn();
    });
    this.updateTextBtn();
    this.controls.onPause = () => this.togglePause();
    this.controls.handler = this.strokes;
    $('ch-pause-btn').addEventListener('click', () => this.togglePause());
    $('ch-resume-btn').addEventListener('click', () => this.togglePause(false));
    $('ch-quit-btn').addEventListener('click', () => this.cb.onQuit());
  }

  get active(): boolean {
    return this.sim !== null;
  }

  private async ensureApp(): Promise<void> {
    if (this.appReady) return this.appReady;
    const app = new Application();
    this.appReady = app.init({
      resizeTo: this.host,
      // Above 2x density the extra pixels cost far more GPU time than they show;
      // dense screens don't need edge smoothing either.
      antialias: (window.devicePixelRatio || 1) < 1.5,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      autoStart: false,
    }).then(() => {
      // Pixi caps each tick at 100 ms by default; let slow frames report their real length.
      app.ticker.minFPS = 1 / MAX_FRAME_DT;
      this.host.appendChild(app.canvas);
      app.canvas.style.touchAction = 'none';
      this.app = app;
    });
    return this.appReady;
  }

  async start(theme: Theme): Promise<void> {
    this.screen.classList.add('active');
    await this.ensureApp();
    const app = this.app!;
    this.teardownRun();

    this.theme = theme;
    this.sim = new ChargeSim(createBattleSpecs(), {
      seed: (Math.random() * 1e9) | 0,
      waves: createWaves(),
      squads: createSquadSpecs(),
    });
    this.audio.start();
    this.view = new ChargeView(app, theme);
    this.view.setCombatText(this.combatText);
    app.resize();
    this.resize();
    this.view.focus(this.sim.leader!);

    this.endTimer = -1;
    this.paused = false;
    this.lastRiders = -1;
    this.movedOnce = false;
    this.path.clear();
    this.aim = null;
    this.pauseEl.classList.remove('active');
    this.applyHudTheme(theme);

    this.controls.attach();
    this.joystick.attach();
    window.addEventListener('resize', this.onResize);
    app.ticker.add(this.tick, this);
    app.start();

    this.hintEl.classList.add('active');
    if (this.hintTimeout) clearTimeout(this.hintTimeout);
    this.hintTimeout = setTimeout(() => this.hintEl.classList.remove('active'), 9000);
    this.banner('Break the enemy army!', 2600);
    this.updateHud();
  }

  /** Stop the current run and hide the screen. */
  stop(): void {
    this.teardownRun();
    this.screen.classList.remove('active');
  }

  private teardownRun(): void {
    if (this.app) {
      this.app.ticker.remove(this.tick, this);
      this.app.stop();
    }
    this.controls.detach();
    this.joystick.detach();
    this.audio.hush();
    window.removeEventListener('resize', this.onResize);
    this.view?.destroy();
    this.view = null;
    this.sim = null;
    this.frameEvents = [];
    this.hintEl.classList.remove('active');
    this.bannerEl.classList.remove('active');
    if (this.hintTimeout) clearTimeout(this.hintTimeout);
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
  }

  togglePause(force?: boolean): void {
    if (!this.sim || this.endTimer >= 0) return;
    this.paused = force ?? !this.paused;
    this.pauseEl.classList.toggle('active', this.paused);
    if (this.paused) this.audio.hush();
    if (this.paused) ($('ch-resume-btn') as HTMLButtonElement).focus();
  }

  /** Route drawing: mouse, pen or finger strokes become the squadron's path. */
  private readonly strokes: StrokeHandler = {
    strokeStart: (p: Vec2) => {
      const view = this.view;
      if (!view || !this.sim || this.paused || this.endTimer >= 0) return;
      if (this.scheme === 'joystick') return; // steering is on the stick
      if (this.scheme === 'direct') {
        this.aim = p;
        this.noteMoved();
        return;
      }
      const end = this.path.end;
      let extend = false;
      if (end) {
        const s = view.worldToScreen(end);
        extend = Math.hypot(s.x - p.x, s.y - p.y) < EXTEND_RADIUS;
      }
      this.pace.reset(GALLOP_STROKE_SPEED * Math.max(this.host.clientWidth, this.host.clientHeight));
      this.path.begin(view.screenToWorld(p), extend, extend && !!end?.gallop);
      this.noteMoved();
    },
    strokeMove: (p: Vec2, dist: number, dt: number) => {
      const view = this.view;
      if (!view || this.paused || this.endTimer >= 0) return;
      if (this.scheme === 'joystick') return;
      if (this.scheme === 'direct') {
        this.aim = p;
        return;
      }
      const gallop = this.pace.sample(dist, dt);
      this.path.add(view.screenToWorld(p), gallop);
    },
    strokeEnd: () => {
      this.aim = null;
    },
  };

  private noteMoved(): void {
    if (this.movedOnce) return;
    this.movedOnce = true;
    if (this.hintTimeout) clearTimeout(this.hintTimeout);
    this.hintTimeout = setTimeout(() => this.hintEl.classList.remove('active'), 3500);
  }

  /** Input for one simulation step: keyboard overrides the drawn route. */
  private stepInput(sim: ChargeSim): ChargeInput {
    if (this.endTimer >= 0) return NO_INPUT;
    const keys = this.controls.read();
    const L = sim.leader;
    // Keyboard reins steer relative to the horses and override the pointer.
    if (keys.reins && L) {
      this.path.clear();
      this.noteMoved();
      return reinsInput(keys.reins, L.facing, keys.gallop);
    }
    const kb: ChargeInput = { dirX: 0, dirY: 0, gallop: keys.gallop };
    if (this.scheme === 'joystick') {
      const o = this.joystick.offset;
      if (!o || !L) return kb;
      this.noteMoved();
      const input = joystickInput(o.dx, o.dy, this.joystick.radius);
      if (kb.gallop && (input.dirX !== 0 || input.dirY !== 0)) input.gallop = true;
      return input;
    }
    if (this.scheme === 'direct') {
      if (!this.aim || !L || !this.view) return kb;
      const s = this.view.worldToScreen(L);
      const input = directInput(this.aim.x - s.x, this.aim.y - s.y, this.zones());
      if (kb.gallop && (input.dirX !== 0 || input.dirY !== 0)) input.gallop = true;
      return input;
    }
    if (this.path.active && L) {
      const input = this.path.steer(L);
      if (kb.gallop && this.path.active) input.gallop = true;
      return input;
    }
    if (kb.gallop) this.noteMoved();
    return kb;
  }

  /** Speed zones for point-and-ride, cached (reading layout sizes every step is costly). */
  private cachedZones: ReturnType<typeof directZones> | null = null;

  private zones() {
    return this.cachedZones ??= directZones(this.host.clientWidth, this.host.clientHeight);
  }

  private updateTextBtn(): void {
    this.textBtn.textContent = `Combat text: ${this.combatText ? 'on' : 'off'}`;
    this.textBtn.setAttribute('aria-pressed', String(this.combatText));
  }

  private applyScheme(): void {
    this.screen.dataset.controls = this.scheme;
    this.controlsBtn.textContent = `Controls: ${SCHEME_LABEL[this.scheme]}`;
    const next = SCHEME_ORDER[(SCHEME_ORDER.indexOf(this.scheme) + 1) % SCHEME_ORDER.length];
    this.controlsBtn.title = `Switch to ${SCHEME_LABEL[next]}`;
  }

  private updateMuteBtn(): void {
    const m = this.audio.muted;
    this.muteBtn.textContent = m ? '🔇' : '🔊';
    this.muteBtn.title = m ? 'Unmute sound' : 'Mute sound';
    this.muteBtn.setAttribute('aria-label', this.muteBtn.title);
  }

  private resize(): void {
    this.cachedZones = null;
    if (!this.app || !this.view) return;
    this.view.resize(this.host.clientWidth, this.host.clientHeight);
  }

  private tick(ticker: Ticker): void {
    const sim = this.sim, view = this.view;
    if (!sim || !view) return;
    // Game time always follows real time: a slow frame is caught up with extra
    // simulation steps rather than slowing the battle down.
    const rawDt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_DT);
    if (this.paused) return;

    const drawing = this.controls.drawing && this.endTimer < 0;
    const dt = rawDt;

    // Advance by exactly the real time since the last frame, in slices of at most
    // 1/60 s. A fixed step would run 0 or 2 steps on some frames (constantly on
    // 90/120 Hz screens), which reads as stutter even at a high frame rate.
    this.frameEvents.length = 0;
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.max(1, Math.ceil(dt / STEP - 1e-6)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      sim.step(h, this.stepInput(sim));
      for (const e of sim.events) this.frameEvents.push(e);
    }
    if (this.scheme === 'joystick') {
      view.holdCamera = false;
      view.drawRoute([], null, false);
      view.drawAim(null, null, this.zones());
    } else if (this.scheme === 'direct') {
      view.holdCamera = false;
      view.drawRoute([], null, false);
      view.drawAim(sim.leader, this.aim ? view.screenToWorld(this.aim) : null, this.zones());
    } else {
      view.holdCamera = drawing;
      view.drawAim(null, null, this.zones());
      view.drawRoute(this.path.points, sim.leader, drawing);
    }
    view.render(sim, this.frameEvents, dt);
    this.screen.classList.toggle('drawing', drawing && this.scheme === 'route');
    this.handleHudEvents(this.frameEvents);
    const L = sim.leader;
    if (this.endTimer < 0) this.audio.update(rawDt, L ? Math.min(1, L.speed / C.GALLOP_SPEED) : 0, sim.riders.length, this.frameEvents);
    else this.audio.hush();

    this.hudTimer -= rawDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.updateHud();
      this.drawMinimap();
    }

    if (sim.outcome !== 'playing') {
      if (this.endTimer < 0) {
        this.endTimer = END_DELAY;
        this.banner(sim.outcome === 'victory' ? 'Victory!' : 'Defeat', END_DELAY * 1000, true);
      }
      this.endTimer -= rawDt;
      if (this.endTimer <= 0) this.finish();
    }
  }

  private finish(): void {
    const sim = this.sim!;
    const score = sim.score + (sim.outcome === 'victory' ? 500 + sim.riders.length * 50 : 0);
    const prevBest = readBest();
    const newBest = score > prevBest;
    if (newBest) writeBest(score);
    const result: ChargeResult = {
      outcome: sim.outcome === 'victory' ? 'victory' : 'defeat',
      reason: sim.outcomeReason,
      score,
      kills: sim.kills,
      routs: sim.routsByPlayer,
      ridersLost: sim.ridersLost,
      bestCombo: sim.bestCombo,
      joined: sim.ridersJoined,
      time: sim.time,
      best: Math.max(prevBest, score),
      newBest,
    };
    this.audio.hush();
    this.app?.ticker.remove(this.tick, this);
    this.app?.stop();
    this.controls.detach();
    this.joystick.detach();
    this.cb.onEnd(result);
  }

  // --- HUD -------------------------------------------------------------------------

  private applyHudTheme(theme: Theme): void {
    this.screen.style.setProperty('--ch-blue', hex(theme.blue));
    this.screen.style.setProperty('--ch-blue-light', hex(mixColor(theme.blue, 0xffffff, 0.45)));
    this.screen.style.setProperty('--ch-red', hex(theme.red));
    this.screen.style.setProperty('--ch-warn', hex(theme.labelWarn));
    this.screen.style.setProperty('--ch-good', hex(theme.elevationBonus));
    this.screen.style.setProperty('--ch-gallop', hex(theme.hpMid));
    this.screen.style.setProperty('--ch-bg', hex(mixColor(theme.bg, theme.labelFill, 0.18)));
  }

  /** Centre-screen message; skipped when combat text is off unless `force` (victory/defeat). */
  private banner(text: string, ms: number, force = false): void {
    if (!this.combatText && !force) return;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('active');
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => this.bannerEl.classList.remove('active'), ms);
  }

  private handleHudEvents(events: SimEvent[]): void {
    let hurt = false;
    for (const e of events) {
      if (e.type === 'rider-hit' && e.mine) hurt = true;
      if (e.type === 'rout' && e.team === 'blue') this.banner('Our line is breaking — hurry!', 2200);
      if (e.type === 'rout' && e.team === 'red' && this.sim && this.sim.outcome === 'playing') {
        const left = this.sim.battalions.filter(b => b.team === 'red' && !b.routed).length;
        const coming = this.sim.pendingWaves.length;
        if (left > 0) {
          const more = coming > 0 ? ` · ${coming} wave${coming === 1 ? '' : 's'} to come` : '';
          this.banner(`${left} enemy battalion${left === 1 ? '' : 's'} left${more}`, 1600);
        }
      }
      if (e.type === 'rider-down' && e.mine && e.wasLeader && this.sim?.leader) this.banner('A new rider takes the banner', 1600);
      if (e.type === 'wave') this.banner(e.index >= 2 ? 'Enemy knights ride for your banner!' : 'Enemy reinforcements!', 2400);
      if (e.type === 'muster') this.banner('Fresh riders at camp — ride in to take command', 2600);
      if (e.type === 'join') this.banner(`+${e.count} riders join your squadron`, 1600);
    }
    if (hurt) {
      this.damageEl.classList.remove('flash');
      void this.damageEl.offsetWidth; // restart the CSS animation
      this.damageEl.classList.add('flash');
    }
  }

  private updateHud(): void {
    const sim = this.sim;
    if (!sim) return;
    if (sim.riders.length !== this.lastRiders) {
      this.lastRiders = sim.riders.length;
      this.ridersEl.textContent = `♞ ${sim.riders.length}`;
      this.ridersEl.classList.toggle('low', sim.riders.length <= 3);
    }
    // Speed gauge: gold once fast enough that the charge bonus kicks in.
    const sp = sim.leader?.speed ?? 0;
    this.speedEl.style.width = `${Math.min(1, sp / C.GALLOP_SPEED) * 100}%`;
    this.speedEl.classList.toggle('charging', sp > C.CANTER_SPEED + 8);
    this.scoreEl.textContent = sim.score.toLocaleString();
    this.comboEl.textContent = this.combatText && sim.combo >= 3 ? `${sim.combo}× trample` : '';
    const red = sim.redStanding / sim.initialRed;
    const blue = sim.blueLineStanding / sim.blueLineInitial;
    this.redBar.style.width = `${red * 100}%`;
    this.blueBar.style.width = `${blue * 100}%`;
    const t = Math.floor(sim.time);
    this.timeEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  private drawMinimap(): void {
    const sim = this.sim, view = this.view, theme = this.theme;
    if (!sim || !view || !theme) return;
    const cv = this.minimap;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth, cssH = cv.clientHeight;
    if (cssW === 0) return;
    if (cv.width !== Math.round(cssW * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const sx = cv.width / C.WORLD_W, sy = cv.height / C.WORLD_H;
    ctx.fillStyle = hex(theme.bg);
    ctx.fillRect(0, 0, cv.width, cv.height);

    ctx.strokeStyle = hex(theme.blue);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(C.CAMP_X * sx, C.CAMP_Y * sy, C.CAMP_R * sx, 0, Math.PI * 2);
    ctx.stroke();

    const dot = Math.max(1, 1.5 * dpr);
    // One pass per team and state, so the fill style changes only four times.
    for (const team of ['blue', 'red'] as const) {
      for (const fleeing of [false, true]) {
        ctx.globalAlpha = fleeing ? 0.3 : 0.85;
        ctx.fillStyle = hex(team === 'blue' ? theme.blue : theme.red);
        for (const s of sim.soldiers) {
          if (s.rider || s.team !== team || s.fleeing !== fleeing) continue;
          ctx.fillRect(s.x * sx - dot / 2, s.y * sy - dot / 2, dot, dot);
        }
      }
    }

    // Incoming volleys.
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = hex(theme.labelWarn);
    for (const v of sim.volleys) {
      if (!v.atPlayer) continue;
      ctx.beginPath();
      ctx.arc(v.x * sx, v.y * sy, Math.max(2 * dpr, v.radius * sx), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Other cavalry: allied troops (collectable) and enemy knights.
    for (const sq of sim.squadrons) {
      if (sq === sim.player) continue;
      ctx.globalAlpha = 1;
      ctx.fillStyle = hex(sq.team === 'blue' ? theme.blue : theme.red);
      for (const r of sq.riders) ctx.fillRect(r.x * sx - 1.5 * dpr, r.y * sy - 1.5 * dpr, 3 * dpr, 3 * dpr);
      const c = sim.squadCenter(sq);
      if (sq.team === 'blue' && sq.riders.length > 0) {
        ctx.strokeStyle = hex(theme.blue);
        ctx.beginPath();
        ctx.arc(c.x * sx, c.y * sy, 5 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = hex(theme.labelFill);
    for (const r of sim.riders) {
      const big = r === sim.leader;
      const sz = (big ? 4 : 2.2) * dpr;
      ctx.fillRect(r.x * sx - sz / 2, r.y * sy - sz / 2, sz, sz);
    }

    const vp = view.viewport;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = hex(theme.labelFill);
    ctx.strokeRect(vp.x * sx, vp.y * sy, vp.w * sx, vp.h * sy);
    ctx.globalAlpha = 1;
  }
}
