import { Application, Ticker } from 'pixi.js';
import { Theme } from '../theme';
import { CHARGE as C } from './config';
import { ChargeSim, SimEvent, NO_INPUT, ChargeInput } from './sim';
import { createBattleSpecs, createSquadSpecs } from './scenario';
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
  /** Fleeing enemies ridden down after the victory. */
  pursuit: number;
  /** You cut down the red general yourself. */
  general: boolean;
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
/** The pursuit after victory ends on its own after this long (s). */
const PURSUIT_MAX = 60;
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
  protected app: Application | null = null;
  protected appReady: Promise<void> | null = null;
  protected view: ChargeView | null = null;
  protected sim: ChargeSim | null = null;
  protected controls: ChargeControls;
  protected paused = false;
  protected endTimer = -1;
  /** Seconds since victory — the pursuit, when you ride down the fleeing army (-1 = not won yet). */
  protected pursuitTimer = -1;
  /** Your kill count and riders at the moment of victory. */
  protected pursuitKills = -1;
  protected victoryRiders = 0;
  protected readonly endBtn = $('ch-end-btn');
  protected hudTimer = 0;
  protected frameEvents: SimEvent[] = [];
  protected theme: Theme | null = null;
  protected lastRiders = -1;
  protected readonly path = new RiderPath();
  protected scheme: ControlScheme = readScheme();
  /** Pointer position (surface px) while held down in point-and-ride mode. */
  protected aim: Vec2 | null = null;
  protected readonly controlsBtn = $('ch-controls-btn');
  protected readonly joystick = new Joystick($('ch-joy-zone'), $('ch-joy'), $('ch-joy-knob'));
  protected readonly textBtn = $('ch-text-btn');
  /** Floating combat text, combo counter and banners — off by default for a cleaner screen. */
  protected combatText = readFlag(TEXT_KEY, false);
  protected readonly pace = new StrokePace(800);
  protected movedOnce = false;
  /** How long you've been steering the squadron without a break (s); the help text goes at 0.5 s. */
  protected steeringFor = 0;
  protected bannerTimeout: ReturnType<typeof setTimeout> | null = null;
  protected hintTimeout: ReturnType<typeof setTimeout> | null = null;
  protected readonly onResize = () => this.resize();

  protected readonly screen = $('charge-screen');
  protected readonly host = $('charge-canvas');
  protected readonly ridersEl = $('ch-riders');
  protected readonly speedEl = $('ch-speed');
  protected readonly formEl = $('ch-form');
  protected readonly scoreEl = $('ch-score');
  protected readonly comboEl = $('ch-combo');
  protected readonly redBar = $('ch-red');
  protected readonly blueBar = $('ch-blue');
  protected readonly timeEl = $('ch-time');
  protected readonly bannerEl = $('ch-banner');
  protected readonly hintEl = $('ch-hint');
  protected readonly pauseEl = $('ch-pause');
  protected readonly damageEl = $('ch-damage');
  protected readonly minimap = $('ch-minimap') as HTMLCanvasElement;
  protected readonly muteBtn = $('ch-mute-btn');
  protected readonly audio = new ChargeAudio();

  /** Sound is on or off for every mode alike. */
  protected static muted = false;

  constructor(private readonly cb: { onEnd(result: ChargeResult): void; onQuit(): void }) {
    this.controls = new ChargeControls(this.host);
    this.controls.onInteract = () => this.audio.start();
    // Each mode shares the screen's buttons: only the one running answers them.
    this.muteBtn.addEventListener('click', () => {
      if (!this.active) return;
      ChargeMode.muted = this.audio.muted = !this.audio.muted;
      this.audio.start();
      this.updateMuteBtn();
    });
    this.updateMuteBtn();
    this.controlsBtn.addEventListener('click', () => {
      if (!this.active) return;
      this.scheme = SCHEME_ORDER[(SCHEME_ORDER.indexOf(this.scheme) + 1) % SCHEME_ORDER.length];
      try { localStorage.setItem(SCHEME_KEY, this.scheme); } catch { /* storage unavailable */ }
      this.path.clear();
      this.aim = null;
      this.applyScheme();
    });
    this.applyScheme();
    this.textBtn.addEventListener('click', () => {
      if (!this.active) return;
      this.combatText = !this.combatText;
      writeFlag(TEXT_KEY, this.combatText);
      this.view?.setCombatText(this.combatText);
      this.updateTextBtn();
    });
    this.updateTextBtn();
    this.controls.onPause = () => this.togglePause();
    this.controls.handler = this.strokes;
    $('ch-pause-btn').addEventListener('click', () => this.togglePause());
    this.endBtn.addEventListener('click', () => { if (this.pursuitTimer >= 0) this.finish(); });
    $('ch-resume-btn').addEventListener('click', () => this.togglePause(false));
    $('ch-quit-btn').addEventListener('click', () => { if (this.active) this.quit(); });
  }

  get active(): boolean {
    return this.sim !== null;
  }

  protected quit(): void {
    this.cb.onQuit();
  }

  /** Which mode the shared screen is showing (styles pick the right HUD). */
  protected readonly modeName: string = 'battle';

  protected createSim(seed: number): ChargeSim {
    return new ChargeSim(createBattleSpecs(), { seed, squads: createSquadSpecs() });
  }

  protected createView(app: Application, theme: Theme): ChargeView {
    return new ChargeView(app, theme);
  }

  /** Called once a run is set up (banners, help). */
  protected intro(): void {
    this.banner('Break the enemy army!', 2600);
  }

  protected async ensureApp(): Promise<void> {
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
    // Each mode has its own canvas on the shared screen: show only the running one.
    app.canvas.style.display = '';

    this.theme = theme;
    this.screen.dataset.mode = this.modeName;
    // Settings may have been changed while another mode was running.
    this.scheme = readScheme();
    this.applyScheme();
    this.combatText = readFlag(TEXT_KEY, false);
    this.updateTextBtn();
    this.audio.muted = ChargeMode.muted;
    this.updateMuteBtn();
    // Dev builds can pin the seed (window.chargeSeed) so recordings replay the same battle.
    this.sim = this.createSim(import.meta.env.DEV && typeof (window as { chargeSeed?: number }).chargeSeed === 'number'
      ? (window as { chargeSeed?: number }).chargeSeed! : (Math.random() * 1e9) | 0);
    // Dev builds expose the sim for scripted screenshots and debugging.
    if (import.meta.env.DEV) Object.assign(window, { chargeSim: this.sim, chargeMode: this });
    this.audio.start();
    this.view = this.createView(app, theme);
    this.view.setCombatText(this.combatText);
    app.resize();
    this.resize();
    this.view.focus(this.sim.leader!);

    this.endTimer = -1;
    this.pursuitTimer = -1;
    this.pursuitKills = -1;
    this.endBtn.classList.remove('active');
    this.paused = false;
    this.lastRiders = -1;
    this.movedOnce = false;
    this.steeringFor = 0;
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
    this.intro();
    this.updateHud();
  }

  /** Stop the current run and hide the screen. */
  stop(): void {
    this.teardownRun();
    if (this.app) this.app.canvas.style.display = 'none';
    this.screen.classList.remove('active');
  }

  protected teardownRun(): void {
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
  protected readonly strokes: StrokeHandler = {
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

  protected noteMoved(): void {
    if (this.movedOnce) return;
    this.movedOnce = true;
    if (this.hintTimeout) clearTimeout(this.hintTimeout);
    this.hintTimeout = setTimeout(() => this.hintEl.classList.remove('active'), 3500);
  }

  /** Input for one simulation step: keyboard overrides the drawn route. */
  /** Dev builds: scripted input for recordings (overrides the player's controls). */
  devInput: ChargeInput | null = null;

  /**
   * Dev builds: stop the real-time loop and advance exactly `dt` per call, rendering
   * each frame — for deterministic recordings regardless of how slow the machine is.
   */
  devFrame(dt: number): void {
    const app = this.app;
    if (!app) return;
    app.ticker.stop();
    this.tick({ deltaMS: dt * 1000 } as Ticker);
    app.renderer.render(app.stage);
  }

  protected stepInput(sim: ChargeSim): ChargeInput {
    if (this.endTimer >= 0) return NO_INPUT;
    if (this.devInput) return this.devInput;
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
  protected cachedZones: ReturnType<typeof directZones> | null = null;

  protected zones() {
    return this.cachedZones ??= directZones(this.host.clientWidth, this.host.clientHeight);
  }

  protected updateTextBtn(): void {
    this.textBtn.textContent = `Combat text: ${this.combatText ? 'on' : 'off'}`;
    this.textBtn.setAttribute('aria-pressed', String(this.combatText));
  }

  protected applyScheme(): void {
    this.screen.dataset.controls = this.scheme;
    this.controlsBtn.textContent = `Controls: ${SCHEME_LABEL[this.scheme]}`;
    const next = SCHEME_ORDER[(SCHEME_ORDER.indexOf(this.scheme) + 1) % SCHEME_ORDER.length];
    this.controlsBtn.title = `Switch to ${SCHEME_LABEL[next]}`;
  }

  protected updateMuteBtn(): void {
    const m = this.audio.muted;
    this.muteBtn.textContent = m ? '🔇' : '🔊';
    this.muteBtn.title = m ? 'Unmute sound' : 'Mute sound';
    this.muteBtn.setAttribute('aria-label', this.muteBtn.title);
  }

  protected resize(): void {
    this.cachedZones = null;
    if (!this.app || !this.view) return;
    this.view.resize(this.host.clientWidth, this.host.clientHeight);
  }

  /** Real seconds of hit-stop left, and how slow the battle runs during it. */
  protected hitStop = 0;
  protected hitStopSlow = 1;

  /**
   * The big moments land with weight: time briefly slows (hit-stop) when your charge
   * crashes home, longer when you break a squadron or cut down the general. Eases back
   * to full speed rather than snapping.
   */
  protected hitStopScale(rawDt: number): number {
    if (this.hitStop <= 0) return 1;
    this.hitStop -= rawDt;
    const k = Math.min(1, Math.max(0, this.hitStop / 0.08));
    return 1 - (1 - this.hitStopSlow) * k;
  }

  protected triggerHitStop(seconds: number, slow: number): void {
    if (seconds > this.hitStop) { this.hitStop = seconds; this.hitStopSlow = slow; }
  }

  protected tick(ticker: Ticker): void {
    const sim = this.sim, view = this.view;
    if (!sim || !view) return;
    // Game time always follows real time: a slow frame is caught up with extra
    // simulation steps rather than slowing the battle down.
    const rawDt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_DT);
    if (this.paused) return;

    const drawing = this.controls.drawing && this.endTimer < 0;
    const dt = rawDt * this.hitStopScale(rawDt);

    // Advance by exactly the real time since the last frame, in slices of at most
    // 1/60 s. A fixed step would run 0 or 2 steps on some frames (constantly on
    // 90/120 Hz screens), which reads as stutter even at a high frame rate.
    this.frameEvents.length = 0;
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.max(1, Math.ceil(dt / STEP - 1e-6)));
    const h = dt / steps;
    let steering = false;
    for (let i = 0; i < steps; i++) {
      const input = this.stepInput(sim);
      if (Math.hypot(input.dirX, input.dirY) > 0.2) steering = true;
      sim.step(h, input);
      for (const e of sim.events) this.frameEvents.push(e);
      this.afterStep(sim);
    }
    // Riding for real (steering, and the horses moving) for half a second: the help
    // text has done its job and gets out of the way.
    const L0 = sim.leader;
    this.steeringFor = steering && L0 && L0.speed > 20 ? this.steeringFor + rawDt : 0;
    if (this.steeringFor >= 0.5 && this.hintEl.classList.contains('active')) {
      if (this.hintTimeout) clearTimeout(this.hintTimeout);
      this.hintEl.classList.remove('active');
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
    this.renderFrame(sim, view, dt);
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

    this.checkEnd(sim, rawDt);
  }

  /** Draw the frame (the lanes mode adds its own events). */
  protected renderFrame(sim: ChargeSim, view: ChargeView, dt: number): void {
    view.render(sim, this.frameEvents, dt);
  }

  /** Called after every simulation step of a frame, for modes that collect more events. */
  protected afterStep(_sim: ChargeSim): void { /* nothing more in the battle */ }

  /** Victory leads into the pursuit; defeat ends the run after a moment. */
  protected checkEnd(sim: ChargeSim, rawDt: number): void {
    if (sim.outcome === 'victory') {
      // The pursuit: no cut to the results — ride down the fleeing army for as long as
      // you like, until it has left the field or you end the battle.
      if (this.pursuitTimer < 0) {
        this.pursuitTimer = 0;
        this.pursuitKills = sim.kills;
        this.victoryRiders = sim.riders.length;
        this.banner('Victory!', 3200, true, true);
        this.audio.victory();
        this.endBtn.classList.add('active');
        setTimeout(() => {
          if (this.sim === sim && this.pursuitTimer >= 0 && !this.paused) this.banner('The enemy flees — ride them down!', 2800, true);
        }, 3400);
      }
      this.pursuitTimer += rawDt;
      const fleeing = sim.soldiers.some(s => s.team === 'red' && s.alive);
      // Ends on its own once the field is clear — or if your squadron fell in the chase.
      const noSquad = sim.riders.length === 0 && this.pursuitTimer > 3;
      if (this.pursuitTimer > PURSUIT_MAX || (!fleeing && this.pursuitTimer > 6) || noSquad) this.finish();
    } else if (sim.outcome !== 'playing') {
      if (this.endTimer < 0) {
        this.endTimer = END_DELAY;
        this.banner('Defeat', END_DELAY * 1000, true, true);
      }
      this.endTimer -= rawDt;
      if (this.endTimer <= 0) this.finish();
    }
  }

  protected finish(): void {
    const sim = this.sim!;
    this.endBtn.classList.remove('active');
    this.pursuitTimer = -1;
    // The victory bonus counts the riders who won the battle, not those picked up in the pursuit.
    const score = sim.score + (sim.outcome === 'victory' ? 500 + this.victoryRiders * 50 : 0);
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
      pursuit: this.pursuitKills >= 0 ? sim.kills - this.pursuitKills : 0,
      general: sim.generalKilledByPlayer,
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

  protected applyHudTheme(theme: Theme): void {
    this.screen.style.setProperty('--ch-blue', hex(theme.blue));
    this.screen.style.setProperty('--ch-blue-light', hex(mixColor(theme.blue, 0xffffff, 0.45)));
    this.screen.style.setProperty('--ch-red', hex(theme.red));
    this.screen.style.setProperty('--ch-red-light', hex(mixColor(theme.red, 0xffffff, 0.45)));
    this.screen.style.setProperty('--ch-warn', hex(theme.labelWarn));
    this.screen.style.setProperty('--ch-good', hex(theme.elevationBonus));
    this.screen.style.setProperty('--ch-gallop', hex(theme.hpMid));
    this.screen.style.setProperty('--ch-bg', hex(mixColor(theme.bg, theme.labelFill, 0.18)));
  }

  /** Centre-screen message; skipped when combat text is off unless `force` (victory/defeat). */
  /**
   * Show a banner. Most sit near the top, out of the way of the riding (just below
   * the help text while that's still up); `center` puts the big endings mid-screen.
   */
  protected banner(text: string, ms: number, force = false, center = false): void {
    if (!this.combatText && !force) return;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.toggle('center', center);
    this.bannerEl.style.top = '';
    if (!center && this.hintEl.classList.contains('active')) {
      const below = this.hintEl.getBoundingClientRect().bottom - this.screen.getBoundingClientRect().top + 10;
      this.bannerEl.style.top = `${Math.round(below)}px`;
    }
    this.bannerEl.classList.add('active');
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => this.bannerEl.classList.remove('active'), ms);
  }

  protected handleHudEvents(events: SimEvent[]): void {
    let hurt = false;
    for (const e of events) {
      if (e.type === 'rider-hit' && e.mine) hurt = true;
      if (e.type === 'rout' && e.team === 'blue' && !this.sim?.armyBroken.blue && this.sim?.outcome === 'playing') this.banner('Our line is breaking — hurry!', 2200, true);
      if (e.type === 'rout' && e.team === 'red' && this.sim && this.sim.outcome === 'playing') {
        if (!this.sim.armyBroken.red) this.banner(`Enemy morale ${Math.round(this.sim.armyMorale('red') * 100)}%`, 1600);
      }
      if (e.type === 'rider-down' && e.mine && e.wasLeader && this.sim?.leader) this.banner('A new rider takes the banner', 1600);
      if (e.type === 'army-break') {
        this.banner(e.team === 'red' ? 'The enemy army is breaking!' : 'Our army is breaking!', 3200, true);
      }
      if (e.type === 'army-waver') {
        this.banner(e.team === 'red' ? 'The enemy wavers — keep pressing!' : 'Our army wavers — hurry!', 2800, true);
      }
      if (e.type === 'general-down') {
        this.banner(e.byPlayer ? 'You cut down the enemy general!' : 'The enemy general has fallen!', 2800, true);
        if (e.byPlayer) this.triggerHitStop(0.6, 0.25);
      }
      if (e.type === 'clash') this.triggerHitStop(e.pike ? 0.12 : 0.16, 0.3);
      if (e.type === 'call') {
        // Short, so it fits a phone: where, and what's wrong.
        const where = e.side === 'centre' ? 'centre' : `${e.side} flank`;
        this.banner(e.kind === 'buckling' ? `Our ${where} is buckling!` : `Enemy breaking through — ${e.side}!`, 3000, true);
      }
      if (e.type === 'call-done') {
        this.banner(e.kind === 'buckling' ? `The ${e.side} holds! +${e.points}` : `Breakthrough stopped! +${e.points}`, 2000);
      }
      if (e.type === 'call-failed') {
        this.banner(e.kind === 'buckling' ? `Too late — the ${e.side} gives way` : 'Too late — they broke through', 2000);
      }
      if (e.type === 'tip') this.banner('Tip: ride down their archers', 2400);
      if (e.type === 'squad-break' && e.byPlayer) this.triggerHitStop(0.35, 0.35);
      if (e.type === 'hunt') this.banner('Enemy knights ride for your banner!', 2400, true);
      if (e.type === 'muster') this.banner('Fresh riders at camp — ride in!', 2600);
      if (e.type === 'join') this.banner(`+${e.count} riders join your squadron`, 1600);
    }
    if (hurt) {
      this.damageEl.classList.remove('flash');
      void this.damageEl.offsetWidth; // restart the CSS animation
      this.damageEl.classList.add('flash');
    }
  }

  protected updateHud(): void {
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
    // Formation gauge: how tight the wedge is (it hits other horsemen as one body).
    const cohesion = sim.player?.cohesion ?? 0;
    this.formEl.style.width = `${cohesion * 100}%`;
    this.formEl.classList.toggle('loose', cohesion < 0.5);
    this.scoreEl.textContent = sim.score.toLocaleString();
    this.comboEl.textContent = this.combatText && sim.combo >= 3 ? `${sim.combo}× trample` : '';
    // Army morale: each side breaks and flees, all at once, when its bar runs out.
    const red = sim.armyMorale('red');
    const blue = sim.armyMorale('blue');
    this.redBar.style.width = `${red * 100}%`;
    this.blueBar.style.width = `${blue * 100}%`;
    this.redBar.classList.toggle('wavering', red < C.ARMY_WAVER);
    this.blueBar.classList.toggle('wavering', blue < C.ARMY_WAVER);
    const t = Math.floor(sim.time);
    this.timeEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  protected drawMinimap(): void {
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
    for (const c of C.CAMPS) {
      ctx.beginPath();
      ctx.arc(c.x * sx, c.y * sy, C.CAMP_R * sx, 0, Math.PI * 2);
      ctx.stroke();
    }

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

    // Calls for help: blinking rings on the battalions to break.
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    ctx.lineWidth = 1.6 * dpr;
    for (const c of sim.calls) {
      ctx.globalAlpha = 0.4 + 0.6 * blink;
      ctx.strokeStyle = hex(theme.hpMid);
      ctx.beginPath();
      ctx.arc(c.target.x * sx, c.target.y * sy, 6 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = dpr;

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

    // The red general: a ringed marker to hunt down.
    const G = sim.general;
    if (G) {
      const pulse = 0.6 + 0.4 * Math.sin(sim.time * 5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hex(theme.hpMid);
      ctx.beginPath();
      ctx.arc(G.x * sx, G.y * sy, 2.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = hex(theme.hpMid);
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.arc(G.x * sx, G.y * sy, 6 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
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
