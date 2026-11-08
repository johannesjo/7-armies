import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { Theme } from '../theme';
import { ChargeView, FieldLayout, mixColor } from '../charge/view';
import { ChargeSim, SimEvent, Squadron, mulberry32 } from '../charge/sim';
import { Team } from '../types';
import { LANES as L } from './config';
import { WOODS } from './map';
import { LaneEvent, LaneSim, Structure } from './sim';
import { ABILITIES } from './cards';

export const LANE_FIELD: FieldLayout = { w: L.WORLD_W, h: L.WORLD_H, woods: [...WOODS], battle: false, key: 'lanes' };

const STONE = 0xa49c8c;

interface StructGfx {
  root: Container;
  g: Graphics;
  /** What the drawing shows, so it is redrawn only when that changes. */
  state: string;
}

/** The lanes mode's rendering: the battle's renderer, plus roads, towers and keeps. */
export class LaneView extends ChargeView {
  private readonly structs = new Map<number, StructGfx>();
  private readonly laneUi = new Graphics();
  private readonly pointerG = new Graphics();
  /** Fog of war: one pixel per vision cell, stretched (smoothly) over the field. */
  readonly fogCanvas: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImg: ImageData;
  private readonly fogTex: Texture;
  private readonly fogSprite: Sprite;
  private fogTimer = 0;
  private sim: LaneSim | null = null;

  constructor(app: Application, theme: Theme) {
    super(app, theme, LANE_FIELD);
    const cols = Math.ceil(L.WORLD_W / L.FOG_CELL), rows = Math.ceil(L.WORLD_H / L.FOG_CELL);
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
    this.world.addChild(this.laneUi);
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

  private updateFog(sim: LaneSim, dt: number): void {
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
    for (const team of ['blue', 'red'] as const) {
      const k = L.KEEP[team];
      const color = team === 'blue' ? this.theme.blue : this.theme.red;
      g.circle(k.x, k.y, L.HOME_R).fill({ color, alpha: 0.05 });
      const dashes = 48;
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * Math.PI * 2;
        g.moveTo(k.x + Math.cos(a0) * L.HOME_R, k.y + Math.sin(a0) * L.HOME_R)
          .arc(k.x, k.y, L.HOME_R, a0, a0 + (Math.PI * 2) / dashes * 0.5)
          .stroke({ width: 2, color, alpha: 0.4 });
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rand() * 0.3;
        const d = L.HOME_R - 40 + rand() * 20;
        const x = k.x + Math.cos(a) * d, y = k.y + Math.sin(a) * d;
        if (x < 30 || x > this.W - 30) continue;
        this.drawTent(g, x, y, color);
      }
    }
  }

  protected override chief(sq: Squadron): boolean {
    return sq.ai === 'rival' || super.chief(sq);
  }

  override render(sim: ChargeSim, events: SimEvent[], dt: number): void {
    const ls = sim as LaneSim;
    this.sim = ls;
    this.updateFog(ls, dt);
    super.render(sim, events, dt);
    this.syncStructures(ls);
    this.drawLaneUi(ls, dt);
  }

  /** Popups and effects for the mode's own moments. */
  laneEvents(sim: LaneSim, events: readonly LaneEvent[]): void {
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
      } else if (e.type === 'ability') {
        if (e.team !== 'blue' && this.hiddenAt(e.team, e.x, e.y)) continue;
        const color = e.team === 'blue' ? t.blue : t.red;
        const a = ABILITIES[e.ability];
        const mine = e.team === 'blue';
        this.burstDust(e.x, e.y, 0, e.ability === 'storm' ? 3 : 8);
        if (e.ability === 'thunder') this.impacts.push({ x: e.x, y: e.y, angle: 0, age: 0, strength: 2.2, rear: false, pike: false });
        this.popup(e.x, e.y - 26, `${a.title.toUpperCase()}!`, mine ? t.hpMid : t.labelWarn, 20, 1.3);
      } else if (e.type === 'tower-down') {
        this.impacts.push({ x: e.x, y: e.y, angle: 0, age: 0, strength: 3.4, rear: true, pike: false });
        for (let i = 0; i < 4; i++) this.burstDust(e.x + (this.rand() - 0.5) * 30, e.y + (this.rand() - 0.5) * 20, this.rand() * 6.28, 8);
        const ours = e.team === 'blue';
        this.popup(e.x, e.y - 50, e.kind === 'keep' ? (ours ? 'OUR KEEP FALLS' : 'THEIR KEEP FALLS!') : (ours ? 'Tower lost' : 'TOWER DOWN!'), ours ? t.labelWarn : t.elevationBonus, 22, 2.2);
      } else if (e.type === 'level' && e.team === 'blue') {
        const Ld = sim.leader;
        if (Ld) this.popup(Ld.x, Ld.y - 30, `LEVEL ${e.level}!`, t.hpMid, 20, 1.6);
      } else if (e.type === 'hero-down') {
        this.burstDust(e.x, e.y, 0, 10);
        this.popup(e.x, e.y - 24, e.team === 'blue' ? 'Your squadron is lost' : 'Rival commander slain!', e.team === 'blue' ? t.labelWarn : t.elevationBonus, 20, 2);
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

  private drawTower(g: Graphics, st: Structure, hurt: number): void {
    const color = this.teamColor(st);
    const r = st.r;
    const dark = mixColor(STONE, 0x000000, 0.35), lite = mixColor(STONE, 0xffffff, 0.25);
    if (!this.upright) {
      // From above: a round stone tower, crenellated, the team's colours on the roof.
      g.circle(3, 4, r + 3).fill({ color: 0x000000, alpha: 0.28 });
      g.circle(0, 0, r).fill(STONE).stroke({ width: 1.5, color: dark });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.rect(Math.cos(a) * (r - 3) - 2.2, Math.sin(a) * (r - 3) - 2.2, 4.4, 4.4).fill(lite).stroke({ width: 0.6, color: dark });
      }
      g.circle(0, 0, r * 0.55).fill(color).stroke({ width: 1, color: mixColor(color, 0x000000, 0.4) });
      this.cracks(g, hurt, r, 0);
      return;
    }
    const w = r * 0.85, h = 62;
    g.ellipse(r * 0.6, 2, r * 1.5, r * 0.5).fill({ color: 0x000000, alpha: 0.3 });
    g.rect(-w, -h, w * 2, h).fill(STONE);
    g.rect(w * 0.25, -h, w * 0.75, h).fill({ color: 0x000000, alpha: 0.18 });
    g.ellipse(0, 0, w, w * 0.35).fill(STONE);
    // Courses of stone.
    for (let y = -h + 8; y < -2; y += 9) g.moveTo(-w, y).lineTo(w, y).stroke({ width: 0.6, color: dark, alpha: 0.5 });
    // Arrow slits.
    g.rect(-2, -h * 0.62, 2.4, 7).fill(0x1a140c);
    g.rect(-w * 0.6, -h * 0.35, 2.2, 6).fill(0x1a140c);
    // Parapet with merlons.
    g.rect(-w - 3, -h - 5, (w + 3) * 2, 7).fill(lite).stroke({ width: 0.8, color: dark });
    for (let i = 0; i < 5; i++) g.rect(-w - 3 + i * ((w + 3) * 2 - 5) / 4, -h - 11, 5, 6).fill(lite).stroke({ width: 0.6, color: dark });
    // Banner.
    g.moveTo(0, -h - 5).lineTo(0, -h - 34).stroke({ width: 1.4, color: 0x3a2a1a });
    g.poly([0, -h - 34, 16, -h - 30, 13, -h - 26, 16, -h - 22, 0, -h - 22]).fill(color).stroke({ width: 0.7, color: mixColor(color, 0x000000, 0.4) });
    this.cracks(g, hurt, w, -h);
  }

  private drawKeep(g: Graphics, st: Structure, hurt: number): void {
    const color = this.teamColor(st);
    const R = st.r;
    const dark = mixColor(STONE, 0x000000, 0.35), lite = mixColor(STONE, 0xffffff, 0.25);
    if (!this.upright) {
      g.rect(-R + 4, -R + 5, R * 2, R * 2).fill({ color: 0x000000, alpha: 0.28 });
      g.rect(-R, -R, R * 2, R * 2).fill(STONE).stroke({ width: 2, color: dark });
      g.rect(-R * 0.55, -R * 0.55, R * 1.1, R * 1.1).fill(color).stroke({ width: 1.5, color: mixColor(color, 0x000000, 0.4) });
      for (const [cx, cy] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
        g.circle(cx, cy, R * 0.32).fill(lite).stroke({ width: 1.2, color: dark });
      }
      this.cracks(g, hurt, R, 0);
      return;
    }
    const w = R * 1.25, h = 46;
    g.ellipse(R * 0.4, 4, w * 1.35, R * 0.55).fill({ color: 0x000000, alpha: 0.3 });
    // Curtain wall with a gate.
    g.rect(-w, -h, w * 2, h).fill(STONE);
    g.rect(w * 0.3, -h, w * 0.7, h).fill({ color: 0x000000, alpha: 0.15 });
    for (let y = -h + 8; y < -2; y += 9) g.moveTo(-w, y).lineTo(w, y).stroke({ width: 0.6, color: dark, alpha: 0.5 });
    g.moveTo(-10, 0).lineTo(-10, -18).arc(0, -18, 10, Math.PI, 0).lineTo(10, 0).closePath().fill(0x2a1e12);
    for (let i = 0; i < 9; i++) g.rect(-w + i * (w * 2 - 6) / 8, -h - 6, 6, 6).fill(lite).stroke({ width: 0.6, color: dark });
    // Corner towers and the great tower behind.
    const tower = (x: number, th: number, tw: number) => {
      g.rect(x - tw, -th, tw * 2, th).fill(STONE).stroke({ width: 0.8, color: dark });
      g.rect(x + tw * 0.2, -th, tw * 0.8, th).fill({ color: 0x000000, alpha: 0.16 });
      g.rect(x - tw - 2, -th - 5, tw * 2 + 4, 6).fill(lite).stroke({ width: 0.7, color: dark });
      g.rect(x - 1.2, -th * 0.6, 2.4, 6).fill(0x1a140c);
    };
    tower(0, h + 34, 15);
    g.moveTo(0, -h - 39).lineTo(0, -h - 72).stroke({ width: 1.6, color: 0x3a2a1a });
    g.poly([0, -h - 72, 24, -h - 66, 19, -h - 60, 24, -h - 54, 0, -h - 54]).fill(color).stroke({ width: 0.8, color: mixColor(color, 0x000000, 0.4) });
    tower(-w, h + 14, 11);
    tower(w, h + 14, 11);
    this.cracks(g, hurt, w, -h);
  }

  /** Cracks spread as a tower is worn down. */
  private cracks(g: Graphics, hurt: number, w: number, top: number): void {
    if (hurt <= 0) return;
    const r = mulberry32(hurt * 17 + Math.round(w));
    for (let i = 0; i < hurt * 3; i++) {
      let x = (r() - 0.5) * w * 1.4, y = top * (0.2 + r() * 0.7) + (top === 0 ? (r() - 0.5) * w : 0);
      g.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (r() - 0.5) * 7; y += 3 + r() * 4;
        g.lineTo(x, y);
      }
      g.stroke({ width: 1, color: 0x1a140c, alpha: 0.7 });
    }
  }

  private drawRubble(g: Graphics, st: Structure): void {
    const r = mulberry32(st.id);
    const R = st.r * 1.5;
    g.ellipse(0, 0, R * 1.2, R * 0.7).fill({ color: 0x000000, alpha: 0.18 });
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
      const s = 2 + r() * 4;
      g.ellipse(Math.cos(a) * d, Math.sin(a) * d * 0.6, s * 1.3, s).fill(mixColor(STONE, 0x000000, r() * 0.4));
    }
    g.moveTo(-4, -2).lineTo(-4, -16).stroke({ width: 1.2, color: 0x3a2a1a });
    g.poly([-4, -16, 6, -12, -4, -9]).fill({ color: this.teamColor(st), alpha: 0.7 });
  }

  /** Health bars on towers, the reach of enemy towers near you, and where the rival is. */
  private drawLaneUi(sim: LaneSim, dt: number): void {
    const g = this.laneUi;
    g.clear();
    const t = this.theme;
    const Ld = sim.leader;
    const vp = this.viewport;

    // An ability running: a gold halo round the commander's leader.
    for (const team of ['blue', 'red'] as const) {
      const HL = sim.heroes[team].sq.riders[0];
      if (!HL || !sim.abilityActive(team) || this.hiddenAt(team, HL.x, HL.y)) continue;
      g.circle(HL.x, HL.y, 16 + 2 * Math.sin(sim.time * 14)).stroke({ width: 2.5, color: t.hpMid, alpha: 0.7 });
    }
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
      const top = st.kind === 'keep' ? (this.upright ? 140 : st.r + 16) : (this.upright ? 108 : st.r + 12);
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

    // An arrow at the screen's edge toward the rival commander when he is off screen.
    const pg = this.pointerG;
    pg.clear();
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
