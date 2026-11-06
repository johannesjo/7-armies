import { Application, Ticker } from 'pixi.js';
import { Theme } from '../theme';
import { CHARGE as C } from './config';
import { ChargeSim, SimEvent, NO_INPUT } from './sim';
import { createBattleSpecs, createWaves } from './scenario';
import { ChargeView, mixColor } from './view';
import { ChargeControls } from './input';

export interface ChargeResult {
  outcome: 'victory' | 'defeat';
  reason: string;
  score: number;
  kills: number;
  routs: number;
  ridersLost: number;
  bestCombo: number;
  time: number;
}

const STEP = 1 / 60;
const END_DELAY = 2.2;

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
  private acc = 0;
  private paused = false;
  private endTimer = -1;
  private hudTimer = 0;
  private frameEvents: SimEvent[] = [];
  private theme: Theme | null = null;
  private lastRiders = -1;
  private movedOnce = false;
  private bannerTimeout: ReturnType<typeof setTimeout> | null = null;
  private hintTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly onResize = () => this.resize();

  private readonly screen = $('charge-screen');
  private readonly host = $('charge-canvas');
  private readonly ridersEl = $('ch-riders');
  private readonly staminaEl = $('ch-stamina');
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
  private readonly gallopBtn = $('ch-gallop-btn');

  constructor(private readonly cb: { onEnd(result: ChargeResult): void; onQuit(): void }) {
    this.controls = new ChargeControls(this.host, $('ch-stick'), $('ch-knob'), this.gallopBtn);
    this.controls.onPause = () => this.togglePause();
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
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      autoStart: false,
    }).then(() => {
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
    this.sim = new ChargeSim(createBattleSpecs(), { seed: (Math.random() * 1e9) | 0, waves: createWaves() });
    this.view = new ChargeView(app, theme);
    app.resize();
    this.resize();
    this.view.focus(this.sim.leader!);

    this.acc = 0;
    this.endTimer = -1;
    this.paused = false;
    this.lastRiders = -1;
    this.movedOnce = false;
    this.pauseEl.classList.remove('active');
    this.applyHudTheme(theme);

    this.controls.attach();
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
    if (this.paused) ($('ch-resume-btn') as HTMLButtonElement).focus();
  }

  private resize(): void {
    if (!this.app || !this.view) return;
    this.view.resize(this.host.clientWidth, this.host.clientHeight);
  }

  private tick(ticker: Ticker): void {
    const sim = this.sim, view = this.view;
    if (!sim || !view) return;
    const rawDt = Math.min(ticker.deltaMS / 1000, 0.1);
    if (this.paused) return;

    // Slow motion while the battle's outcome sinks in.
    const dt = this.endTimer >= 0 ? rawDt * 0.35 : rawDt;
    const leaderScreen = sim.leader ? view.worldToScreen(sim.leader) : null;
    const input = this.endTimer >= 0 ? NO_INPUT : this.controls.read(leaderScreen);
    if (!this.movedOnce && (input.gallop || Math.hypot(input.dirX, input.dirY) > 0.2)) {
      this.movedOnce = true;
      if (this.hintTimeout) clearTimeout(this.hintTimeout);
      this.hintTimeout = setTimeout(() => this.hintEl.classList.remove('active'), 3500);
    }

    this.acc += dt;
    this.frameEvents.length = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      sim.step(STEP, input);
      for (const e of sim.events) this.frameEvents.push(e);
    }
    view.render(sim, this.frameEvents, dt);
    this.handleHudEvents(this.frameEvents);

    this.hudTimer -= rawDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.updateHud();
      this.drawMinimap();
    }

    if (sim.outcome !== 'playing') {
      if (this.endTimer < 0) {
        this.endTimer = END_DELAY;
        this.banner(sim.outcome === 'victory' ? 'Victory!' : 'Defeat', END_DELAY * 1000);
      }
      this.endTimer -= rawDt;
      if (this.endTimer <= 0) this.finish();
    }
  }

  private finish(): void {
    const sim = this.sim!;
    const result: ChargeResult = {
      outcome: sim.outcome === 'victory' ? 'victory' : 'defeat',
      reason: sim.outcomeReason,
      score: sim.score + (sim.outcome === 'victory' ? 500 + sim.riders.length * 50 : 0),
      kills: sim.kills,
      routs: sim.routsByPlayer,
      ridersLost: sim.ridersLost,
      bestCombo: sim.bestCombo,
      time: sim.time,
    };
    this.app?.ticker.remove(this.tick, this);
    this.app?.stop();
    this.controls.detach();
    this.cb.onEnd(result);
  }

  // --- HUD -------------------------------------------------------------------------

  private applyHudTheme(theme: Theme): void {
    this.screen.style.setProperty('--ch-blue', hex(theme.blue));
    this.screen.style.setProperty('--ch-red', hex(theme.red));
    this.screen.style.setProperty('--ch-warn', hex(theme.labelWarn));
    this.screen.style.setProperty('--ch-good', hex(theme.elevationBonus));
    this.screen.style.setProperty('--ch-bg', hex(mixColor(theme.bg, theme.labelFill, 0.18)));
  }

  private banner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('active');
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => this.bannerEl.classList.remove('active'), ms);
  }

  private handleHudEvents(events: SimEvent[]): void {
    let hurt = false;
    for (const e of events) {
      if (e.type === 'rider-hit') hurt = true;
      if (e.type === 'rout' && e.team === 'blue') this.banner('Our line is breaking — hurry!', 2200);
      if (e.type === 'rout' && e.team === 'red' && this.sim && this.sim.outcome === 'playing') {
        const left = this.sim.battalions.filter(b => b.team === 'red' && !b.routed).length;
        const coming = this.sim.pendingWaves.length;
        if (left > 0) {
          const more = coming > 0 ? ` · ${coming} wave${coming === 1 ? '' : 's'} to come` : '';
          this.banner(`${left} enemy battalion${left === 1 ? '' : 's'} left${more}`, 1600);
        }
      }
      if (e.type === 'rider-down' && e.wasLeader && this.sim?.leader) this.banner('A new rider takes the banner', 1600);
      if (e.type === 'wave') this.banner('Enemy reinforcements!', 2200);
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
      this.ridersEl.textContent = `♞ ${sim.riders.length}/${C.SQUAD_SIZE}`;
      this.ridersEl.classList.toggle('low', sim.riders.length <= 3);
    }
    this.staminaEl.style.width = `${(sim.stamina / C.STAMINA_MAX) * 100}%`;
    this.staminaEl.classList.toggle('low', sim.stamina < C.STAMINA_MIN_TO_GALLOP);
    this.scoreEl.textContent = sim.score.toLocaleString();
    this.comboEl.textContent = sim.combo >= 3 ? `${sim.combo}× trample` : '';
    const red = sim.redStanding / sim.initialRed;
    const blue = sim.blueLineStanding / sim.blueLineInitial;
    this.redBar.style.width = `${red * 100}%`;
    this.blueBar.style.width = `${blue * 100}%`;
    const t = Math.floor(sim.time);
    this.timeEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.gallopBtn.classList.toggle('tired', sim.stamina < C.STAMINA_MIN_TO_GALLOP && !sim.galloping);
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
    for (const s of sim.soldiers) {
      if (s.rider) continue;
      ctx.globalAlpha = s.fleeing ? 0.3 : 0.85;
      ctx.fillStyle = s.team === 'blue' ? hex(theme.blue) : hex(theme.red);
      ctx.fillRect(s.x * sx - dot / 2, s.y * sy - dot / 2, dot, dot);
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
