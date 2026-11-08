import { Application } from 'pixi.js';
import { Theme } from '../theme';
import { ChargeMode } from '../charge/mode';
import { CHARGE as C } from '../charge/config';
import { ChargeSim, SimEvent } from '../charge/sim';
import { ChargeView } from '../charge/view';
import { LANES as L, xpToNext } from './config';
import { CARDS } from './cards';
import { WOODS } from './map';
import { LaneEvent, LaneSim } from './sim';
import { LaneView } from './view';

export interface LaneResult {
  outcome: 'victory' | 'defeat';
  reason: string;
  time: number;
  level: number;
  rivalLevel: number;
  /** Foot ridden down by your squadron. */
  kills: number;
  /** Times you slew the rival commander, and he you. */
  heroKills: number;
  deaths: number;
  towers: number;
  cards: string[];
}

const END_DELAY = 3;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/**
 * The lanes mode: 1v1 against a rival commander. Shares the cavalry mode's screen,
 * controls and loop; adds the lane HUD, the level-up cards and the minimap of the lanes.
 */
export class LaneMode extends ChargeMode {
  protected override readonly modeName: string = 'lanes';
  private readonly laneEnd: (r: LaneResult) => void;
  private readonly laneQuit: () => void;
  private readonly frameLaneEvents: LaneEvent[] = [];
  private readonly cardsEl = $('ln-cards');
  private readonly cardsTitle = $('ln-cards-title');
  private readonly cardBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#ln-cards .ln-card'));
  private readonly levelEl = $('ln-level');
  private readonly xpEl = $('ln-xp');
  private readonly rivalEl = $('ln-rival');
  private readonly respawnEl = $('ln-respawn');
  /** The hand of cards on show (so the buttons are only rebuilt when it changes). */
  private shownHand = '';

  constructor(cb: { onEnd(result: LaneResult): void; onQuit(): void }) {
    super({ onEnd: () => { /* lanes report through their own result */ }, onQuit: cb.onQuit });
    this.laneEnd = cb.onEnd;
    this.laneQuit = cb.onQuit;
    this.cardBtns.forEach((btn, i) => btn.addEventListener('click', () => this.pick(i)));
    window.addEventListener('keydown', e => {
      if (!this.active || this.paused) return;
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (i >= 0) { this.pick(i); e.preventDefault(); }
    });
  }

  private get lanes(): LaneSim | null {
    return this.sim as LaneSim | null;
  }

  protected override quit(): void {
    this.laneQuit();
  }

  protected override createSim(seed: number): ChargeSim {
    return new LaneSim({ seed });
  }

  protected override createView(app: Application, theme: Theme): ChargeView {
    return new LaneView(app, theme);
  }

  protected override intro(): void {
    this.shownHand = '';
    this.cardsEl.classList.remove('active');
    this.respawnEl.classList.remove('active');
    this.banner('Break their keep!', 2600, true);
  }

  private pick(i: number): void {
    const sim = this.lanes;
    if (!sim || sim.me.offers.length === 0 || this.endTimer >= 0) return;
    if (i >= sim.me.offers[0].length) return;
    sim.chooseCard('blue', i);
    this.updateCards();
  }

  protected override afterStep(sim: ChargeSim): void {
    for (const e of (sim as LaneSim).laneEvents) this.frameLaneEvents.push(e);
  }

  protected override renderFrame(sim: ChargeSim, view: ChargeView, dt: number): void {
    super.renderFrame(sim, view, dt);
    const ls = sim as LaneSim;
    (view as LaneView).laneEvents(ls, this.frameLaneEvents);
    for (const e of this.frameLaneEvents) this.onLaneEvent(ls, e);
    this.frameLaneEvents.length = 0;
  }

  private onLaneEvent(sim: LaneSim, e: LaneEvent): void {
    if (sim.outcome !== 'playing') return;
    switch (e.type) {
      case 'level':
        if (e.team === 'blue') { this.banner(`Level ${e.level} — choose a card`, 1800, true); this.updateCards(); }
        break;
      case 'tower-down':
        if (e.kind === 'tower') this.banner(e.team === 'red' ? 'Enemy tower destroyed!' : 'We lost a tower', 2400, true);
        this.triggerHitStop(0.3, 0.4);
        break;
      case 'hero-down':
        if (e.team === 'red') { this.banner('You slew the rival commander!', 2600, true); this.triggerHitStop(0.5, 0.3); }
        else this.banner('Your squadron has fallen', 2200, true);
        break;
      case 'hero-up':
        if (e.team === 'blue') this.banner('Back in the saddle!', 1500, true);
        break;
      case 'under-attack':
        if (e.team === 'blue') this.banner(e.kind === 'keep' ? 'Our keep is under attack!' : 'A tower is under attack', 2000);
        break;
    }
  }

  protected override handleHudEvents(events: SimEvent[]): void {
    let hurt = false;
    for (const e of events) {
      if (e.type === 'rider-hit' && e.mine) hurt = true;
      if (e.type === 'clash') this.triggerHitStop(e.pike ? 0.12 : 0.16, 0.3);
      if (e.type === 'rider-down' && e.mine && e.wasLeader && this.sim?.leader) this.banner('A new rider takes the banner', 1600);
      if (e.type === 'rout' && e.byPlayer) this.banner('Routed!', 1200);
    }
    if (hurt) {
      this.damageEl.classList.remove('flash');
      void this.damageEl.offsetWidth; // restart the CSS animation
      this.damageEl.classList.add('flash');
    }
  }

  private updateCards(): void {
    const sim = this.lanes;
    if (!sim) return;
    const offers = sim.me.offers;
    const hand = offers.length > 0 ? offers[0].join(',') + `:${offers.length}` : '';
    if (hand === this.shownHand) return;
    this.shownHand = hand;
    this.cardsEl.classList.toggle('active', offers.length > 0);
    if (offers.length === 0) return;
    const more = offers.length - 1;
    this.cardsTitle.textContent = more > 0 ? `Choose a card (+${more} more)` : 'Choose a card';
    this.cardBtns.forEach((btn, i) => {
      const id = offers[0][i];
      btn.hidden = !id;
      if (!id) return;
      const c = CARDS[id];
      const taken = sim.me.picks.filter(p => p === id).length;
      btn.innerHTML = `<span class="ln-key">${i + 1}</span><span class="ln-icon">${c.icon}</span><b>${c.title}</b><span class="ln-text">${c.text}</span>${taken > 0 ? `<span class="ln-taken">×${taken + 1}</span>` : ''}`;
      btn.setAttribute('aria-label', `${c.title}: ${c.text}`);
    });
  }

  protected override updateHud(): void {
    const sim = this.lanes;
    if (!sim) return;
    const me = sim.me, rival = sim.rival;
    this.ridersEl.textContent = `♞ ${sim.riders.length}/${me.mods.maxRiders}`;
    this.ridersEl.classList.toggle('low', !me.dead && sim.riders.length <= Math.max(2, me.mods.maxRiders * 0.3));
    const sp = sim.leader?.speed ?? 0;
    this.speedEl.style.width = `${Math.min(1, sp / (C.GALLOP_SPEED * me.mods.speed)) * 100}%`;
    this.speedEl.classList.toggle('charging', sp > (C.CANTER_SPEED + 8) * me.mods.speed);
    const cohesion = sim.player?.cohesion ?? 0;
    this.formEl.style.width = `${cohesion * 100}%`;
    this.formEl.classList.toggle('loose', cohesion < 0.5);
    this.levelEl.textContent = `Level ${me.level}`;
    this.xpEl.style.width = me.level >= L.MAX_LEVEL ? '100%' : `${(me.xp / xpToNext(me.level)) * 100}%`;
    this.rivalEl.textContent = rival.dead
      ? `Rival: slain (${Math.ceil(rival.respawnAt - sim.time)})`
      : `Rival Lv ${rival.level} · ♞ ${rival.sq.riders.length}`;
    const keepHp = (team: 'blue' | 'red') => {
      const k = sim.structures.find(s => s.kind === 'keep' && s.team === team)!;
      return Math.max(0, k.hp / k.maxHp);
    };
    this.redBar.style.width = `${keepHp('red') * 100}%`;
    this.blueBar.style.width = `${keepHp('blue') * 100}%`;
    const t = Math.floor(sim.time);
    this.timeEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (me.dead && sim.outcome === 'playing') {
      this.respawnEl.textContent = `Back in the saddle in ${Math.max(1, Math.ceil(me.respawnAt - sim.time))}…`;
      this.respawnEl.classList.add('active');
    } else this.respawnEl.classList.remove('active');
    this.updateCards();
  }

  protected override checkEnd(sim: ChargeSim, rawDt: number): void {
    if (sim.outcome === 'playing') return;
    if (this.endTimer < 0) {
      this.endTimer = END_DELAY;
      this.cardsEl.classList.remove('active');
      this.respawnEl.classList.remove('active');
      const won = sim.outcome === 'victory';
      this.banner(won ? 'Victory!' : 'Defeat', END_DELAY * 1000, true, true);
      if (won) this.audio.victory();
    }
    this.endTimer -= rawDt;
    if (this.endTimer <= 0) this.finish();
  }

  protected override finish(): void {
    const sim = this.lanes!;
    const result: LaneResult = {
      outcome: sim.outcome === 'victory' ? 'victory' : 'defeat',
      reason: sim.outcomeReason,
      time: sim.time,
      level: sim.me.level,
      rivalLevel: sim.rival.level,
      kills: sim.kills,
      heroKills: sim.me.kills,
      deaths: sim.me.deaths,
      towers: sim.towersDown.blue,
      cards: sim.me.picks.map(id => CARDS[id].title),
    };
    this.cardsEl.classList.remove('active');
    this.respawnEl.classList.remove('active');
    this.audio.hush();
    this.app?.ticker.remove(this.tick, this);
    this.app?.stop();
    this.controls.detach();
    this.joystick.detach();
    this.laneEnd(result);
  }

  protected override drawMinimap(): void {
    const sim = this.lanes, view = this.view, theme = this.theme;
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
    const sx = cv.width / L.WORLD_W, sy = cv.height / L.WORLD_H;
    ctx.globalAlpha = 1;
    ctx.fillStyle = hex(theme.bg);
    ctx.fillRect(0, 0, cv.width, cv.height);
    // Woods and roads.
    ctx.fillStyle = 'rgba(20, 40, 16, 0.55)';
    for (const r of WOODS) ctx.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
    ctx.strokeStyle = 'rgba(200, 170, 120, 0.35)';
    ctx.lineWidth = 2 * dpr;
    for (const y of L.LANE_Y) {
      ctx.beginPath();
      ctx.moveTo(L.SPAWN_X.blue * sx, y * sy);
      ctx.lineTo(L.SPAWN_X.red * sx, y * sy);
      ctx.stroke();
    }
    // Foot.
    const dot = Math.max(1, 1.4 * dpr);
    for (const team of ['blue', 'red'] as const) {
      ctx.fillStyle = hex(team === 'blue' ? theme.blue : theme.red);
      ctx.globalAlpha = 0.8;
      for (const s of sim.soldiers) {
        if (s.rider || s.team !== team || s.fleeing) continue;
        ctx.fillRect(s.x * sx - dot / 2, s.y * sy - dot / 2, dot, dot);
      }
    }
    // Towers and keeps.
    ctx.globalAlpha = 1;
    for (const st of sim.structures) {
      const size = (st.kind === 'keep' ? 8 : 5) * dpr;
      const color = hex(st.team === 'blue' ? theme.blue : theme.red);
      if (st.alive) {
        ctx.fillStyle = color;
        ctx.fillRect(st.x * sx - size / 2, st.y * sy - size / 2, size, size);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = dpr;
        ctx.strokeRect(st.x * sx - size / 2, st.y * sy - size / 2, size, size);
      } else {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = dpr;
        ctx.strokeRect(st.x * sx - size / 2, st.y * sy - size / 2, size, size);
        ctx.globalAlpha = 1;
      }
    }
    // The rival: a ringed red marker.
    const R = sim.rival.sq.riders[0];
    if (R) {
      ctx.fillStyle = hex(theme.red);
      ctx.beginPath();
      ctx.arc(R.x * sx, R.y * sy, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex(theme.hpMid);
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.arc(R.x * sx, R.y * sy, 5.5 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // You.
    ctx.fillStyle = hex(theme.labelFill);
    for (const r of sim.riders) {
      const sz = (r === sim.leader ? 4 : 2) * dpr;
      ctx.fillRect(r.x * sx - sz / 2, r.y * sy - sz / 2, sz, sz);
    }
    const vp = view.viewport;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = hex(theme.labelFill);
    ctx.lineWidth = dpr;
    ctx.strokeRect(vp.x * sx, vp.y * sy, vp.w * sx, vp.h * sy);
    ctx.globalAlpha = 1;
  }
}
