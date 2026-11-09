import { Application, Container, Graphics } from 'pixi.js';
import { Theme } from '../theme';
import { FieldLayout, mixColor } from '../charge/view';
import { ChargeSim, SimEvent } from '../charge/sim';
import { CommanderView } from '../commanders/view';
import { LANES as L } from './config';
import { WOODS } from './map';
import { LaneEvent, LaneSim, Structure } from './sim';
import { CastleLook, keepTop, keepUpright, rubble, towerTop, towerUpright } from './castle-art';

export const LANE_FIELD: FieldLayout = { w: L.WORLD_W, h: L.WORLD_H, woods: [...WOODS], battle: false, key: 'lanes' };

const STONE = 0xa49c8c;

interface StructGfx {
  root: Container;
  g: Graphics;
  /** What the drawing shows, so it is redrawn only when that changes. */
  state: string;
}

/** The lanes mode's rendering: the commanders' renderer, plus roads, towers and keeps. */
export class LaneView extends CommanderView {
  private readonly structs = new Map<number, StructGfx>();
  private readonly laneUi = new Graphics();

  constructor(app: Application, theme: Theme) {
    super(app, theme, LANE_FIELD);
    this.world.addChild(this.laneUi);
  }

  /** Bare earth: the road down each lane, the yards round the keeps and the tower footings. */
  protected override earthAt(x: number, y: number): number {
    let e = 0;
    const x0 = L.SPAWN_X.blue - 80, x1 = L.SPAWN_X.red + 80;
    if (x > x0 && x < x1) {
      for (const ly of L.LANE_Y) {
        const d = Math.abs(y - ly);
        if (d < 80) e = Math.max(e, 1 - Math.max(0, d - 34) / 46);
      }
    }
    for (const team of ['blue', 'red'] as const) {
      const k = L.KEEP[team];
      const d = Math.hypot(x - k.x, y - k.y);
      if (d < 200) e = Math.max(e, 1 - Math.max(0, d - 120) / 80);
      // Roads from the keep out to each lane.
      for (const ly of L.LANE_Y) {
        const ex = L.SPAWN_X[team];
        const t = Math.max(0, Math.min(1, ((x - k.x) * (ex - k.x) + (y - k.y) * (ly - k.y)) / ((ex - k.x) ** 2 + (ly - k.y) ** 2)));
        const px = k.x + (ex - k.x) * t, py = k.y + (ly - k.y) * t;
        const dd = Math.hypot(x - px, y - py);
        if (dd < 70) e = Math.max(e, (1 - Math.max(0, dd - 28) / 42) * 0.85);
      }
      for (let lane = 0; lane < L.LANE_Y.length; lane++) {
        for (const tx of L.TOWER_X[team]) {
          const d2 = Math.hypot(x - tx, y - (L.LANE_Y[lane] + L.TOWER_OFFSET[lane]));
          if (d2 < 60) e = Math.max(e, (1 - Math.max(0, d2 - 34) / 26) * 0.8);
        }
      }
    }
    return e;
  }

  /** The keeps' yards: tents round each, and the ring where your riders heal. */
  protected override drawCamps(g: Graphics, rand: () => number): void {
    if (!this.theme.grass) {
      // Flat styles: the roads as faint worn bands (grass styles paint them as earth).
      const mud = mixColor(this.theme.bg, this.theme.obstacleBorder, 0.14);
      for (const ly of L.LANE_Y) g.rect(L.SPAWN_X.blue - 60, ly - 40, L.SPAWN_X.red - L.SPAWN_X.blue + 120, 80).fill({ color: mud, alpha: 0.5 });
      for (const team of ['blue', 'red'] as const) {
        const k = L.KEEP[team];
        g.circle(k.x, k.y, 170).fill({ color: mud, alpha: 0.5 });
        for (const ly of L.LANE_Y) g.moveTo(k.x, k.y).lineTo(L.SPAWN_X[team], ly).stroke({ width: 60, color: mud, alpha: 0.5, cap: 'round' });
      }
    }
    for (const team of ['blue', 'red'] as const) this.drawHomeRing(g, L.KEEP[team].x, L.KEEP[team].y, team, rand);
  }

  override render(sim: ChargeSim, events: SimEvent[], dt: number): void {
    super.render(sim, events, dt);
    const ls = sim as LaneSim;
    this.syncStructures(ls);
    this.drawLaneUi(ls);
  }

  /** Popups and effects for the mode's own moments. */
  laneEvents(sim: LaneSim, events: readonly LaneEvent[]): void {
    this.commanderEvents(sim, events);
    const t = this.theme;
    for (const e of events) {
      if (e.type === 'siege') {
        // Chips of stone fly from the wall, and dust.
        if (this.hiddenAt(e.team === 'blue' ? 'red' : 'blue', e.x, e.y)) continue;
        for (let i = 0; i < 4; i++) {
          const a = e.angle + (this.rand() - 0.5) * 1.8, sp = 40 + this.rand() * 70;
          this.addParticle({
            x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 0.35 + this.rand() * 0.3,
            size: 0.8 + this.rand() * 0.9, grow: -0.6, color: mixColor(STONE, 0xffffff, this.rand() * 0.3), alpha: 0.95, stain: false,
          });
        }
        this.burstDust(e.x, e.y, e.angle, 1);
      } else if (e.type === 'tower-down') {
        this.impacts.push({ x: e.x, y: e.y, angle: 0, age: 0, strength: 3.4, rear: true, pike: false });
        for (let i = 0; i < 4; i++) this.burstDust(e.x + (this.rand() - 0.5) * 30, e.y + (this.rand() - 0.5) * 20, this.rand() * 6.28, 8);
        const ours = e.team === 'blue';
        this.popup(e.x, e.y - 50, e.kind === 'keep' ? (ours ? 'OUR KEEP FALLS' : 'THEIR KEEP FALLS!') : (ours ? 'Tower lost' : 'TOWER DOWN!'), ours ? t.labelWarn : t.elevationBonus, 22, 2.2);
      }
    }
  }

  // --- Towers and keeps -------------------------------------------------------------------

  private syncStructures(sim: LaneSim): void {
    for (const st of sim.structures) {
      let s = this.structs.get(st.id);
      if (!s) {
        const root = new Container();
        const g = new Graphics();
        root.addChild(g);
        root.position.set(st.x, st.y);
        root.zIndex = st.y;
        // Under the men (drawn first) when seen from above; sorted with them when upright.
        this.unitLayer.addChildAt(root, 0);
        s = { root, g, state: '' };
        this.structs.set(st.id, s);
      }
      const hurt = st.alive ? Math.min(3, Math.floor((1 - st.hp / st.maxHp) * 4)) : 4;
      const state = `${st.alive}:${hurt}`;
      if (state !== s.state) {
        s.state = state;
        s.g.clear();
        if (!st.alive) this.drawRubble(s.g, st);
        else if (st.kind === 'keep') this.drawKeep(s.g, st, hurt);
        else this.drawTower(s.g, st, hurt);
      }
    }
  }

  private teamColor(st: Structure): number {
    return st.team === 'blue' ? this.theme.blue : this.theme.red;
  }

  /** How a structure is painted: its team's colours, ink or paint, and a seed for the stonework. */
  private look(st: Structure): CastleLook {
    const t = this.theme;
    return { team: this.teamColor(st), teamDark: st.team === 'blue' ? t.blueDark : t.redDark, trim: t.trim, ink: this.style === 'ink', seed: st.id };
  }

  private drawTower(g: Graphics, st: Structure, hurt: number): void {
    if (this.upright) towerUpright(g, this.look(st), st.r, hurt);
    else towerTop(g, this.look(st), st.r, hurt);
  }

  private drawKeep(g: Graphics, st: Structure, hurt: number): void {
    if (this.upright) keepUpright(g, this.look(st), st.r, hurt);
    else keepTop(g, this.look(st), st.r, hurt, st.team === 'blue' ? 1 : -1);
  }

  private drawRubble(g: Graphics, st: Structure): void {
    rubble(g, this.look(st), st.kind === 'keep' ? st.r * 0.8 : st.r, this.upright);
  }

  /** Health bars on towers, and the reach of enemy towers near you. */
  private drawLaneUi(sim: LaneSim): void {
    const g = this.laneUi;
    g.clear();
    const t = this.theme;
    const Ld = sim.leader;
    const vp = this.viewport;
    for (const st of sim.structures) {
      if (!st.alive) continue;
      const near = st.x > vp.x - 200 && st.x < vp.x + vp.w + 200 && st.y > vp.y - 200 && st.y < vp.y + vp.h + 200;
      if (!near) continue;
      // Reach of an enemy tower you're close to: ride inside only when it has foot to shoot.
      if (Ld && st.team !== 'blue') {
        const d = Math.hypot(Ld.x - st.x, Ld.y - st.y);
        if (d < st.range + 220) {
          const inside = d < st.range;
          const a = inside ? 0.55 : 0.3 * (1 - (d - st.range) / 220);
          const dashes = 64;
          for (let i = 0; i < dashes; i++) {
            const a0 = (i / dashes) * Math.PI * 2 + sim.time * 0.2;
            g.moveTo(st.x + Math.cos(a0) * st.range, st.y + Math.sin(a0) * st.range)
              .arc(st.x, st.y, st.range, a0, a0 + (Math.PI * 2) / dashes * 0.5);
          }
          g.stroke({ width: 2, color: t.labelWarn, alpha: a });
        }
      }
      const vuln = sim.vulnerable(st);
      const w = st.kind === 'keep' ? 64 : 40, h = 4;
      const top = st.kind === 'keep' ? (this.upright ? 172 : st.r + 16) : (this.upright ? 140 : st.r + 12);
      const x = st.x - w / 2, y = st.y - top;
      const k = Math.max(0, st.hp / st.maxHp);
      const color = st.team === 'blue' ? t.blue : t.red;
      g.roundRect(x - 1, y - 1, w + 2, h + 2, 2).fill({ color: 0x000000, alpha: 0.5 });
      g.roundRect(x, y, w * k, h, 1.5).fill({ color, alpha: vuln ? 0.95 : 0.45 });
      // Flashes white while it's being worn down.
      if (sim.time - st.lastHit < 0.12) g.roundRect(x, y, w * k, h, 1.5).fill({ color: 0xffffff, alpha: 0.7 });
      if (!vuln) {
        // Shielded: can't be harmed until the towers before it fall.
        const sx = st.x + w / 2 + 7, sy = y + 2;
        g.poly([sx - 4, sy - 4, sx + 4, sy - 4, sx + 4, sy + 1, sx, sy + 5, sx - 4, sy + 1]).fill({ color: t.trim, alpha: 0.8 }).stroke({ width: 0.8, color: 0x000000, alpha: 0.5 });
      }
    }
  }
}
