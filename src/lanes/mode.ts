import { Application } from 'pixi.js';
import { RTS_THEME, Theme } from '../theme';
import { ChargeMode } from '../charge/mode';
import { CHARGE as C } from '../charge/config';
import { ChargeSim, SimEvent } from '../charge/sim';
import type { ChargeRenderer } from '../charge/view3d';
import { LANES as L, xpToNext } from './config';
import { ABILITIES, CARDS, COMMANDERS, CommanderKind } from './cards';
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
  /** Your horse and the rival's. */
  commander: string;
  rivalCommander: string;
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
  /** Your commander's one ability. */
  private readonly abilityBtn = $('ln-ability') as HTMLButtonElement;
  /** The kind of horse you lead next match (set from the menu). */
  commander: CommanderKind = 'knights';
  /** Sim time each teaching hint last showed (so they don't nag). */
  private readonly hintAt: Record<string, number> = {};
  private hackedOnce = false;
  /** The hand of cards on show (so the buttons are only rebuilt when it changes). */
  private shownHand = '';

  constructor(cb: { onEnd(result: LaneResult): void; onQuit(): void }) {
    super({ onEnd: () => { /* lanes report through their own result */ }, onQuit: cb.onQuit });
    this.laneEnd = cb.onEnd;
    this.laneQuit = cb.onQuit;
    this.cardBtns.forEach((btn, i) => btn.addEventListener('click', () => this.pick(i)));
    // pointerdown, not click: a thumb on the stick shouldn't have to let go first.
    this.abilityBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.ability(); });
    // Enter / Space and assistive tech send a click with no pointer behind it.
    this.abilityBtn.addEventListener('click', e => { if (e.detail === 0) this.ability(); });
    window.addEventListener('keydown', e => {
      if (!this.active || this.paused) return;
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (i >= 0) { this.pick(i); e.preventDefault(); }
      if (e.code === 'KeyQ' || e.code === 'KeyE') { this.ability(); e.preventDefault(); }
    });
  }

  private ability(): void {
    const sim = this.lanes;
    if (!sim || this.endTimer >= 0 || this.paused) return;
    if (!sim.useAbility('blue')) {
      const btn = this.abilityBtn;
      btn.classList.remove('denied');
      void btn.offsetWidth;
      btn.classList.add('denied');
      // Arrow Storm needs someone in bowshot.
      if (sim.me.ability === 'storm' && sim.cooldown('blue') <= 0 && !sim.me.dead) this.teach('storm', 'No enemy in bowshot — ride closer', 4);
    }
    this.updateAbilities();
  }

  /** Dress the button for this commander's ability. */
  private setupAbility(): void {
    const a = ABILITIES[COMMANDERS[this.commander].ability];
    this.abilityBtn.querySelector('.ln-ab-icon')!.textContent = a.icon;
    this.abilityBtn.querySelector('.ln-ab-name')!.textContent = a.title;
    this.abilityBtn.title = `${a.title} (Q) — ${a.text}`;
    this.abilityBtn.setAttribute('aria-label', `${a.title}: ${a.text}`);
  }

  private updateAbilities(): void {
    const sim = this.lanes;
    if (!sim) return;
    const a = ABILITIES[sim.me.ability];
    const btn = this.abilityBtn;
    const cd = sim.me.dead ? a.cooldown : sim.cooldown('blue');
    btn.style.setProperty('--cd', String(cd / a.cooldown));
    btn.classList.toggle('ready', cd <= 0 && !sim.me.dead);
    btn.classList.toggle('on', sim.abilityActive('blue'));
    const t = btn.querySelector('.ln-cd');
    if (t) t.textContent = cd > 0 && !sim.me.dead ? String(Math.ceil(cd)) : '';
  }

  /** A short teaching banner, at most once every `gap` seconds of play. */
  private teach(key: string, text: string, gap: number): void {
    const sim = this.lanes;
    if (!sim) return;
    if (sim.time - (this.hintAt[key] ?? -1e9) < gap) return;
    this.hintAt[key] = sim.time;
    this.banner(text, 2400, true);
  }

  private get lanes(): LaneSim | null {
    return this.sim as LaneSim | null;
  }

  protected override quit(): void {
    this.laneQuit();
  }

  protected override createSim(seed: number): ChargeSim {
    for (const k of Object.keys(this.hintAt)) delete this.hintAt[k];
    this.hackedOnce = false;
    return new LaneSim({ seed, commander: this.commander });
  }

  protected override async createView(app: Application, theme: Theme): Promise<ChargeRenderer> {
    // The 3D renderer only knows the battle's field so far: lanes use the Classic RTS look.
    return new LaneView(app, theme.artStyle === '3d' ? RTS_THEME : theme);
  }

  protected override intro(): void {
    this.shownHand = '';
    this.setupAbility();
    const a = ABILITIES[COMMANDERS[this.commander].ability];
    setTimeout(() => { if (this.lanes && this.lanes.time < 20) this.teach('ability', `${a.icon} ${a.title} (Q / button): ${a.text}`, 999); }, 3200);
    this.updateAbilities();
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

  protected override renderFrame(sim: ChargeSim, view: ChargeRenderer, dt: number): void {
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
      case 'late-game':
        this.banner('Siege engines arrive — the walls crumble faster', 3000, true);
        break;
      case 'hero-up':
        if (e.team === 'blue') this.banner('Back in the saddle!', 1500, true);
        break;
      case 'under-attack':
        if (e.team === 'blue') this.banner(e.kind === 'keep' ? 'Our keep is under attack!' : 'A tower is under attack', 2000, true);
        break;
      case 'siege':
        // Your riders at their walls (only commanders' riders raise these).
        if (e.team !== 'red') break;
        if (e.alone) this.teach('alone', 'Alone the walls shrug you off (¼ damage) — bring your foot', 7);
        else if (!this.hackedOnce) this.banner('Hacking at the walls!', 1600, true);
        this.hackedOnce = true;
        break;
      case 'ability':
        if (e.team === 'blue') this.banner(`${ABILITIES[e.ability].icon} ${ABILITIES[e.ability].title}!`, 1300, true);
        else if (sim.visible('blue', e.x, e.y)) this.banner(`Rival: ${ABILITIES[e.ability].title}!`, 1600, true);
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
    this.xpEl.style.width = `${Math.min(1, me.xp / xpToNext(me.level)) * 100}%`;
    const rk = COMMANDERS[rival.kind];
    this.rivalEl.textContent = rival.dead
      ? `${rk.icon} Rival slain (${Math.ceil(rival.respawnAt - sim.time)})`
      : `${rk.icon} Rival ${rk.title} Lv ${rival.level} · ♞ ${rival.sq.riders.length}`;
    this.updateAbilities();
    this.wallHints(sim);
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

  /** Riding at their walls: say why nothing happens, when nothing happens. */
  private wallHints(sim: LaneSim): void {
    const Ld = sim.leader;
    if (!Ld) return;
    for (const st of sim.structures) {
      if (!st.alive || st.team !== 'red' || Math.hypot(Ld.x - st.x, Ld.y - st.y) > st.r + 70) continue;
      if (!sim.vulnerable(st)) this.teach('shielded', st.kind === 'keep' ? 'The keep is shielded until an inner tower falls' : 'Shielded — break the outer tower in this lane first', 9);
      else if (Ld.speed >= C.CHARGE_MIN_SPEED) this.teach('rein', 'Rein in at the walls to hack at them', 9);
    }
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
      commander: COMMANDERS[sim.me.kind].title,
      rivalCommander: COMMANDERS[sim.rival.kind].title,
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
        if (team === 'red' && !sim.visible('blue', s.x, s.y)) continue;
        ctx.fillRect(s.x * sx - dot / 2, s.y * sy - dot / 2, dot, dot);
      }
    }
    // What you can't see is in shadow.
    if (sim.fog) {
      ctx.globalAlpha = 0.8;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage((view as LaneView).fogCanvas, 0, 0, cv.width, cv.height);
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
    // The rival: a ringed red marker (when you can see him).
    const R = sim.rival.sq.riders[0];
    if (R && sim.visible('blue', R.x, R.y)) {
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
