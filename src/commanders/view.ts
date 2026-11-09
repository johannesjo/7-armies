import { Application, Graphics, Sprite, Texture } from 'pixi.js';
import { Theme } from '../theme';
import { ChargeView, FieldLayout } from '../charge/view';
import { ChargeSim, SimEvent, Soldier, Squadron } from '../charge/sim';
import { RiderGear } from '../charge/figure-art';
import { CHARGE as C } from '../charge/config';
import { HORSE_VARIANTS } from '../unit-art';
import { Team } from '../types';
import { LANES as L } from '../lanes/config';
import { ABILITIES } from '../lanes/cards';
import { CommanderEvent, CommanderSim } from './sim';

/**
 * Rendering shared by the commander modes: the battle's renderer plus fog of war,
 * bow-armed horse archers, the rival's gilt standard, ability effects, a halo while an
 * ability runs, and an arrow at the screen's edge toward the rival.
 */
export class CommanderView extends ChargeView {
  /** Fog of war: one pixel per vision cell, stretched (smoothly) over the field. */
  readonly fogCanvas: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImg: ImageData;
  private readonly fogTex: Texture;
  private readonly fogSprite: Sprite;
  private fogTimer = 0;
  private readonly cmdUi = new Graphics();
  private readonly pointerG = new Graphics();
  protected sim: CommanderSim | null = null;
  private bowsBaked = false;

  constructor(app: Application, theme: Theme, field: FieldLayout) {
    super(app, theme, field);
    const cols = Math.ceil(field.w / L.FOG_CELL), rows = Math.ceil(field.h / L.FOG_CELL);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = cols;
    this.fogCanvas.height = rows;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(cols, rows);
    this.fogTex = Texture.from(this.fogCanvas);
    this.fogSprite = new Sprite(this.fogTex);
    this.fogSprite.width = cols * L.FOG_CELL;
    this.fogSprite.height = rows * L.FOG_CELL;
    // Over the ground, under the men: the field dims where you can't see, and enemies there vanish.
    this.world.addChildAt(this.fogSprite, this.world.getChildIndex(this.unitLayer));
    this.world.addChild(this.cmdUi);
    this.root.addChild(this.pointerG);
  }

  override destroy(): void {
    super.destroy();
    this.fogTex.destroy(true);
  }

  /** Enemies outside what your side can see are hidden. */
  protected override hiddenAt(team: Team, x: number, y: number): boolean {
    return team !== 'blue' && !!this.sim && !this.sim.visible('blue', x, y);
  }

  private updateFog(sim: CommanderSim, dt: number): void {
    this.fogTimer -= dt;
    if (this.fogTimer > 0) return;
    this.fogTimer = 0.1;
    this.fogSprite.visible = sim.fog;
    if (!sim.fog) return;
    const v = sim.vision.blue, d = this.fogImg.data;
    const dark = this.theme.grass ? [12, 18, 8] : [40, 34, 26];
    const a = this.theme.grass ? 118 : 70;
    for (let k = 0; k < v.length; k++) {
      const i = k * 4;
      d[i] = dark[0]; d[i + 1] = dark[1]; d[i + 2] = dark[2];
      d[i + 3] = v[k] ? 0 : a;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    this.fogTex.source.update();
  }

  /** Horse archers carry bows, not lances. */
  protected override riderGear(s: Soldier): RiderGear {
    return this.sim && s.squad && this.sim.heroOf(s.squad)?.kind === 'archers' ? 'bow' : 'lance';
  }

  /** Bake the horse archers' figures up front, so the first sight of them doesn't hitch. */
  private bakeBows(sim: CommanderSim): void {
    if (this.bowsBaked) return;
    this.bowsBaked = true;
    for (const team of ['blue', 'red'] as const) {
      if (sim.heroes[team].kind !== 'archers') continue;
      for (let v = 0; v < HORSE_VARIANTS; v++) {
        if (this.upright) this.sheetFor('cavalry', team, C.RIDER_RADIUS, v, 'bow');
        else this.texturesFor('cavalry', team, C.RIDER_RADIUS, v, 'bow');
      }
    }
  }

  protected override chief(sq: Squadron): boolean {
    return sq.ai === 'rival' || super.chief(sq);
  }

  /** A dashed ring on the ground where a commander's riders heal, with tents round it. */
  protected drawHomeRing(g: Graphics, x: number, y: number, team: Team, rand: () => number): void {
    const color = team === 'blue' ? this.theme.blue : this.theme.red;
    g.circle(x, y, L.HOME_R).fill({ color, alpha: 0.05 });
    const dashes = 48;
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * Math.PI * 2;
      g.moveTo(x + Math.cos(a0) * L.HOME_R, y + Math.sin(a0) * L.HOME_R)
        .arc(x, y, L.HOME_R, a0, a0 + (Math.PI * 2) / dashes * 0.5)
        .stroke({ width: 2, color, alpha: 0.4 });
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rand() * 0.3;
      const d = L.HOME_R - 40 + rand() * 20;
      const tx = x + Math.cos(a) * d, ty = y + Math.sin(a) * d;
      if (tx < 30 || tx > this.W - 30 || ty < 30 || ty > this.H - 30) continue;
      this.drawTent(g, tx, ty, color);
    }
  }

  override render(sim: ChargeSim, events: SimEvent[], dt: number): void {
    const cs = sim as CommanderSim;
    this.sim = cs;
    this.bakeBows(cs);
    this.updateFog(cs, dt);
    super.render(sim, events, dt);
    this.drawCommanderUi(cs);
  }

  /** Popups and effects for the commanders' moments (a mode adds its own). */
  commanderEvents(sim: CommanderSim, events: readonly { type: string }[]): void {
    const t = this.theme;
    for (const ev of events) {
      const e = ev as CommanderEvent;
      if (e.type === 'ability') {
        if (e.team !== 'blue' && this.hiddenAt(e.team, e.x, e.y)) continue;
        const a = ABILITIES[e.ability];
        this.burstDust(e.x, e.y, 0, e.ability === 'storm' ? 3 : 8);
        if (e.ability === 'thunder') this.impacts.push({ x: e.x, y: e.y, angle: 0, age: 0, strength: 2.2, rear: false, pike: false });
        this.popup(e.x, e.y - 26, `${a.title.toUpperCase()}!`, e.team === 'blue' ? t.hpMid : t.labelWarn, 20, 1.3);
      } else if (e.type === 'level' && e.team === 'blue') {
        const Ld = sim.leader;
        if (Ld) this.popup(Ld.x, Ld.y - 30, `LEVEL ${e.level}!`, t.hpMid, 20, 1.6);
      } else if (e.type === 'hero-down') {
        this.burstDust(e.x, e.y, 0, 10);
        this.popup(e.x, e.y - 24, e.team === 'blue' ? 'Your squadron is lost' : e.slain ? 'Rival commander slain!' : 'Rival commander fallen', e.team === 'blue' ? t.labelWarn : t.elevationBonus, 20, 2);
      }
    }
  }

  /** A halo while an ability runs, and where the rival is when he's off screen (and seen). */
  private drawCommanderUi(sim: CommanderSim): void {
    const g = this.cmdUi;
    g.clear();
    const t = this.theme;
    for (const team of ['blue', 'red'] as const) {
      const HL = sim.heroes[team].sq.riders[0];
      if (!HL || !sim.abilityActive(team) || this.hiddenAt(team, HL.x, HL.y)) continue;
      g.circle(HL.x, HL.y, 16 + 2 * Math.sin(sim.time * 14)).stroke({ width: 2.5, color: t.hpMid, alpha: 0.7 });
    }
    const pg = this.pointerG;
    pg.clear();
    const Ld = sim.leader;
    const R = sim.rival.sq.riders[0];
    if (!R || !Ld || this.hiddenAt('red', R.x, R.y)) return;
    const p = this.worldToScreen(R);
    const margin = 30;
    if (p.x > margin && p.x < this.viewW - margin && p.y > margin && p.y < this.viewH - margin) return;
    const cx = this.viewW / 2, cy = this.viewH / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const kk = Math.min((cx - margin) / Math.max(1e-6, Math.abs(dx)), (cy - margin) / Math.max(1e-6, Math.abs(dy)));
    const ex = cx + dx * kk, ey = cy + dy * kk;
    const a = Math.atan2(dy, dx);
    const dist = Math.hypot(R.x - Ld.x, R.y - Ld.y);
    const s = dist < 700 ? 1.15 : 0.85;
    const pts = [[13, 0], [-7, -9], [-3, 0], [-7, 9]].map(([u, v]) => [ex + (u * Math.cos(a) - v * Math.sin(a)) * s, ey + (u * Math.sin(a) + v * Math.cos(a)) * s]).flat();
    pg.poly(pts).fill({ color: t.red, alpha: dist < 700 ? 0.9 : 0.55 }).stroke({ width: 1.5, color: 0x1a140a, alpha: 0.6 });
  }
}
