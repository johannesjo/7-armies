import { RTS_THEME, Theme } from '../theme';
import { ChargeMode } from '../charge/mode';
import { CHARGE as C } from '../charge/config';
import { ChargeSim, SimEvent } from '../charge/sim';
import type { ChargeRenderer } from '../charge/view3d';
import { xpToNext } from '../lanes/config';
import { ABILITIES, CARDS, COMMANDERS, CommanderKind } from '../lanes/cards';
import { CommanderEvent, CommanderSim } from './sim';
import { CommanderView } from './view';

export interface CommanderResult {
  mode: 'lanes' | 'front';
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
  /** Lanes: enemy towers destroyed. */
  towers?: number;
  /** Front: enemy battalions your squadron routed. */
  routs?: number;
  cards: string[];
  /** Your horse and the rival's. */
  commander: string;
  rivalCommander: string;
}

const END_DELAY = 3;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/**
 * The commander modes (lanes, the front): 1v1 against a rival commander. Shares the
 * cavalry mode's screen, controls and loop; adds the commander HUD, the level-up cards,
 * the ability button and teaching hints. A map mode adds its own HUD and minimap.
 */
export abstract class CommanderMode extends ChargeMode {
  private readonly cmdEnd: (r: CommanderResult) => void;
  private readonly cmdQuit: () => void;
  private readonly frameModeEvents: { type: string }[] = [];
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
  /** Hints scheduled at the start of a run (cleared when the run ends). */
  private introTimers: ReturnType<typeof setTimeout>[] = [];
  /** The hand of cards on show (so the buttons are only rebuilt when it changes). */
  private shownHand = '';

  constructor(cb: { onEnd(result: CommanderResult): void; onQuit(): void }) {
    super({ onEnd: () => { /* commander modes report through their own result */ }, onQuit: cb.onQuit });
    this.cmdEnd = cb.onEnd;
    this.cmdQuit = cb.onQuit;
    this.cardBtns.forEach((btn, i) => btn.addEventListener('click', () => this.pick(i)));
    // pointerdown, not click: a thumb on the stick shouldn't have to let go first.
    this.abilityBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.ability(); });
    // Enter / Space and assistive tech send a click with no pointer behind it.
    this.abilityBtn.addEventListener('click', e => { if (e.detail === 0) this.ability(); });
    window.addEventListener('keydown', e => {
      if (!this.active || this.paused || e.repeat || this.cmd?.outcome !== 'playing') return;
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (i >= 0) { this.pick(i); e.preventDefault(); }
      if (e.code === 'KeyQ' || e.code === 'KeyE') { this.ability(); e.preventDefault(); }
    });
  }

  private ability(): void {
    const sim = this.cmd;
    if (!this.active || !sim || this.endTimer >= 0 || this.paused || sim.outcome !== 'playing') return;
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
    this.abilityBtn.querySelector('.ln-ab-name')!.textContent = a.short;
    this.abilityBtn.title = `${a.title} (Q) — ${a.text}`;
    this.abilityBtn.setAttribute('aria-label', `${a.title}: ${a.text}`);
  }

  private updateAbilities(): void {
    const sim = this.cmd;
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
  protected teach(key: string, text: string, gap: number): void {
    const sim = this.cmd;
    if (!sim) return;
    if (sim.time - (this.hintAt[key] ?? -1e9) < gap) return;
    this.hintAt[key] = sim.time;
    this.banner(text, 2400, true);
  }

  protected get cmd(): CommanderSim | null {
    return this.sim as CommanderSim | null;
  }

  protected override teardownRun(): void {
    for (const t of this.introTimers) clearTimeout(t);
    this.introTimers.length = 0;
    super.teardownRun();
  }

  protected override quit(): void {
    this.cmdQuit();
  }

  /** The map mode's simulation for a new run. */
  protected abstract newSim(seed: number): CommanderSim;
  /** The banner a run opens with. */
  protected abstract introBanner(): string;
  /** The map mode's own events (towers, reinforcements...) for banners. */
  protected modeEvent(_sim: CommanderSim, _e: { type: string }): void { /* none by default */ }
  /** The map mode's part of the HUD (keep or morale bars, hints). */
  protected abstract hudExtra(sim: CommanderSim): void;
  /** The map mode's part of the result. */
  protected abstract resultExtra(sim: CommanderSim): Partial<CommanderResult> & { mode: CommanderResult['mode'] };
  /** End with the battle's pursuit (the front) rather than a short pause (lanes). */
  protected readonly pursuit: boolean = false;

  protected override createSim(seed: number): ChargeSim {
    for (const k of Object.keys(this.hintAt)) delete this.hintAt[k];
    return this.newSim(seed);
  }

  /** The 3D renderer doesn't draw the commanders' fog and camps yet: these modes use the Classic RTS look (field and HUD alike). */
  protected override resolveTheme(theme: Theme): Theme {
    if (theme.artStyle !== '3d') return theme;
    document.body.classList.add('style-rts');
    return RTS_THEME;
  }

  protected override intro(): void {
    this.shownHand = '';
    this.setupAbility();
    const a = ABILITIES[COMMANDERS[this.commander].ability];
    this.introTimers.push(setTimeout(() => { if (this.cmd && this.cmd.time < 20) this.teach('ability', `${a.icon} Q: ${a.title}`, 999); }, 3200));
    // Horse archers win by circling at bowshot, not by charging: say so once foot is near.
    if (this.commander === 'archers') {
      this.introTimers.push(setTimeout(() => { if (this.cmd && this.cmd.time < 60) this.teach('kite', '🏹 Circle their foot at bowshot — your arrows break it. Don\'t charge.', 999); }, 6500));
    }
    this.updateAbilities();
    this.cardsEl.classList.remove('active');
    this.respawnEl.classList.remove('active');
    this.banner(this.introBanner(), 2600, true);
  }

  private pick(i: number): void {
    const sim = this.cmd;
    if (!sim || sim.me.offers.length === 0 || this.endTimer >= 0) return;
    if (i >= sim.me.offers[0].length) return;
    sim.chooseCard('blue', i);
    this.updateCards();
  }

  protected override afterStep(sim: ChargeSim): void {
    for (const e of (sim as CommanderSim).modeEvents) this.frameModeEvents.push(e);
  }

  /** Effects for the frame's mode events in the view (a map mode adds its own). */
  protected viewEvents(view: CommanderView, sim: CommanderSim, events: readonly { type: string }[]): void {
    view.commanderEvents(sim, events);
  }

  protected override renderFrame(sim: ChargeSim, view: ChargeRenderer, dt: number): void {
    super.renderFrame(sim, view, dt);
    const cs = sim as CommanderSim;
    this.viewEvents(view as CommanderView, cs, this.frameModeEvents);
    for (const e of this.frameModeEvents) this.onEvent(cs, e);
    this.frameModeEvents.length = 0;
  }

  private onEvent(sim: CommanderSim, ev: { type: string }): void {
    if (sim.outcome !== 'playing') return;
    this.modeEvent(sim, ev);
    const e = ev as CommanderEvent;
    switch (e.type) {
      case 'level':
        if (e.team === 'blue') { this.banner(`Level ${e.level} — choose a card`, 1800, true); this.updateCards(); }
        break;
      case 'hero-down':
        if (e.team === 'red') {
          this.banner(e.slain ? 'You slew the rival commander!' : 'The rival commander has fallen', 2600, true);
          if (e.slain) this.triggerHitStop(0.5, 0.3);
        } else this.banner('Your squadron has fallen', 2200, true);
        break;
      case 'hero-up':
        if (e.team === 'blue') this.banner('Back in the saddle!', 1500, true);
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
    const sim = this.cmd;
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
    const sim = this.cmd;
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
    this.rivalEl.title = `Rival ${rk.title}`;
    this.rivalEl.textContent = !rival.dead
      ? `${rk.icon} Rival Lv ${rival.level} · ♞ ${rival.sq.riders.length}`
      : Number.isFinite(rival.respawnAt) ? `${rk.icon} Rival slain (${Math.ceil(rival.respawnAt - sim.time)})` : `${rk.icon} Rival fled`;
    this.updateAbilities();
    this.hudExtra(sim);
    const t = Math.floor(sim.time);
    this.timeEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (me.dead && sim.outcome === 'playing') {
      this.respawnEl.textContent = `Back in the saddle in ${Math.max(1, Math.ceil(me.respawnAt - sim.time))}…`;
      this.respawnEl.classList.add('active');
    } else this.respawnEl.classList.remove('active');
    this.updateCards();
  }

  protected override checkEnd(sim: ChargeSim, rawDt: number): void {
    if (this.pursuit) {
      if (sim.outcome !== 'playing') { this.cardsEl.classList.remove('active'); this.respawnEl.classList.remove('active'); }
      super.checkEnd(sim, rawDt);
      return;
    }
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
    const sim = this.cmd!;
    this.endBtn.classList.remove('active');
    const result: CommanderResult = {
      ...this.resultExtra(sim),
      outcome: sim.outcome === 'victory' ? 'victory' : 'defeat',
      reason: sim.outcomeReason,
      time: sim.time,
      level: sim.me.level,
      rivalLevel: sim.rival.level,
      kills: sim.kills,
      heroKills: sim.me.kills,
      deaths: sim.me.deaths,
      cards: sim.me.picks.map(id => CARDS[id].title),
      commander: COMMANDERS[sim.me.kind].title,
      rivalCommander: COMMANDERS[sim.rival.kind].title,
    };
    this.cardsEl.classList.remove('active');
    this.respawnEl.classList.remove('active');
    for (const t of this.introTimers) clearTimeout(t);
    this.introTimers.length = 0;
    this.audio.hush();
    this.app?.ticker.remove(this.tick, this);
    this.app?.stop();
    this.controls.detach();
    this.joystick.detach();
    this.cmdEnd(result);
  }

  /** Map features under the troops on the minimap (woods, roads, the front). */
  protected minimapGround(_ctx: CanvasRenderingContext2D, _sx: number, _sy: number, _dpr: number, _sim: CommanderSim): void { /* none */ }
  /** Map features over the fog on the minimap (towers, camps). */
  protected minimapMarks(_ctx: CanvasRenderingContext2D, _sx: number, _sy: number, _dpr: number, _sim: CommanderSim): void { /* none */ }

  protected override drawMinimap(): void {
    const sim = this.cmd, view = this.view, theme = this.theme;
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
    const sx = cv.width / sim.W, sy = cv.height / sim.H;
    ctx.globalAlpha = 1;
    ctx.fillStyle = hex(theme.bg);
    ctx.fillRect(0, 0, cv.width, cv.height);
    this.minimapGround(ctx, sx, sy, dpr, sim);
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
      ctx.drawImage((view as CommanderView).fogCanvas, 0, 0, cv.width, cv.height);
    }
    ctx.globalAlpha = 1;
    this.minimapMarks(ctx, sx, sy, dpr, sim);
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
