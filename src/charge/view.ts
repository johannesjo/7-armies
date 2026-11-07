import { Application, Container, Graphics, GraphicsContext, RenderTexture, Sprite, Text } from 'pixi.js';
import { Team, UnitType, Vec2 } from '../types';
import { Theme } from '../theme';
import { drawUnitArt } from '../unit-art';
import { CHARGE as C } from './config';
import { ChargeSim, SimEvent, Soldier, mulberry32 } from './sim';
import { PathPoint } from './path';
import { DirectZones } from './direct';

interface UnitGfx {
  root: Container;
  body: Graphics;
  weapon: Graphics;
  pulse: number;
  fleeing: boolean;
}

interface Dying {
  root: Container;
  vx: number;
  vy: number;
  spin: number;
  age: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  grow: number;
  color: number;
  alpha: number;
  stain: boolean;
}

interface Popup {
  text: Text;
  x: number;
  y: number;
  age: number;
  life: number;
}

const MAX_PARTICLES = 900;
const MAX_POPUPS = 14;

/** Linear blend between two 0xRRGGBB colors. */
export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Arc as its own sub-path — Pixi otherwise joins it to the previous path's last point. */
function arcPath(g: Graphics, x: number, y: number, r: number, a0: number, a1: number): Graphics {
  return g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1);
}

/** Pixi rendering for the cavalry action mode: follow camera, ground, units, arrows, effects. */
export class ChargeView {
  readonly root = new Container();
  private readonly world = new Container();
  private readonly ground = new Graphics();
  private readonly stainRT: RenderTexture;
  private readonly stainSprite: Sprite;
  private readonly stainBatch = new Graphics();
  private stainDirty = false;
  private readonly telegraph = new Graphics();
  private readonly route = new Graphics();
  private readonly aimG = new Graphics();
  /** A route is being drawn: follow more gently and keep the zoom steady. */
  holdCamera = false;
  private readonly unitLayer = new Container();
  private readonly fx = new Graphics();
  private readonly arrowsG = new Graphics();
  private readonly overlay = new Graphics();
  private readonly popupLayer = new Container();

  private readonly units = new Map<number, UnitGfx>();
  private dying: Dying[] = [];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private readonly contexts = new Map<string, { body: GraphicsContext; weapon: GraphicsContext }>();
  private readonly ink: number;
  private readonly dust: number;

  private camX: number = C.CAMP_X;
  private camY: number = C.CAMP_Y - 200;
  private zoom = 2;
  private shake = 0;
  private viewW = 800;
  private viewH = 450;
  private sidePopupCooldown = 0;
  private hoofTimer = 0;
  private readonly rand = mulberry32(99);

  constructor(private readonly app: Application, private readonly theme: Theme) {
    this.ink = theme.labelFill;
    this.dust = mixColor(theme.bg, theme.obstacleBorder, 0.35);
    app.renderer.background.color = mixColor(theme.bg, this.ink, 0.18);

    this.stainRT = RenderTexture.create({ width: C.WORLD_W, height: C.WORLD_H, resolution: 1 });
    this.stainSprite = new Sprite(this.stainRT);

    this.drawGround();
    this.world.addChild(this.ground, this.stainSprite, this.route, this.aimG, this.telegraph, this.unitLayer, this.fx, this.arrowsG, this.overlay);
    this.root.addChild(this.world, this.popupLayer);
    app.stage.addChild(this.root);
    // Start from a blank stain layer (render textures may hold stale GPU memory).
    app.renderer.render({ container: new Container(), target: this.stainRT, clear: true, clearColor: [0, 0, 0, 0] });
  }

  destroy(): void {
    this.app.stage.removeChild(this.root);
    this.root.destroy({ children: true });
    this.stainBatch.destroy();
    this.stainRT.destroy(true);
    for (const c of this.contexts.values()) { c.body.destroy(); c.weapon.destroy(); }
    this.contexts.clear();
    this.units.clear();
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  private baseZoom(): number {
    return Math.max(0.8, Math.min(3, Math.max(this.viewW, this.viewH) / 820));
  }

  /** Snap the camera to the squadron (on start). */
  focus(p: Vec2): void {
    this.camX = p.x;
    this.camY = p.y;
    this.zoom = this.baseZoom();
  }

  worldToScreen(p: Vec2): Vec2 {
    return {
      x: this.world.x + p.x * this.zoom,
      y: this.world.y + p.y * this.zoom,
    };
  }

  screenToWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.world.x) / this.zoom,
      y: (p.y - this.world.y) / this.zoom,
    };
  }

  /**
   * Draw the squadron's planned route from the leader: canter stretches as a dashed
   * line, gallop stretches as a bold line with chevrons, and a marker at the end.
   */
  drawRoute(points: PathPoint[], leader: Soldier | null, drawing: boolean): void {
    const g = this.route;
    g.clear();
    if (points.length === 0) return;
    const t = this.theme;
    const canterColor = t.blue;
    const gallopColor = t.hpMid;
    const boost = drawing ? 1 : 0.8;

    let px = leader ? leader.x : points[0].x;
    let py = leader ? leader.y : points[0].y;
    let dashPhase = 0;
    let chevronPhase = 10;
    const DASH = 6, GAP = 5, CHEV = 20;

    for (const p of points) {
      const dx = p.x - px, dy = p.y - py;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const nx = dx / len, ny = dy / len;
      if (p.gallop) {
        g.moveTo(px, py).lineTo(p.x, p.y).stroke({ width: 3, color: gallopColor, alpha: 0.7 * boost, cap: 'round' });
        // Chevrons point the way at full tilt.
        let d = CHEV - chevronPhase;
        while (d < len) {
          const cx = px + nx * d, cy = py + ny * d;
          g.moveTo(cx - nx * 4 - ny * 4, cy - ny * 4 + nx * 4).lineTo(cx, cy).lineTo(cx - nx * 4 + ny * 4, cy - ny * 4 - nx * 4)
            .stroke({ width: 1.6, color: t.bg, alpha: 0.9 });
          d += CHEV;
        }
        chevronPhase = (chevronPhase + len) % CHEV;
        dashPhase = 0;
      } else {
        // Dashes carry their phase across segments so the pattern stays even.
        let d = 0;
        while (d < len) {
          const cycle = (dashPhase + d) % (DASH + GAP);
          if (cycle < DASH) {
            const run = Math.min(DASH - cycle, len - d);
            g.moveTo(px + nx * d, py + ny * d).lineTo(px + nx * (d + run), py + ny * (d + run));
            d += run;
          } else {
            d += DASH + GAP - cycle;
          }
        }
        g.stroke({ width: 1.6, color: canterColor, alpha: 0.75 * boost });
        dashPhase = (dashPhase + len) % (DASH + GAP);
      }
      px = p.x; py = p.y;
    }

    const end = points[points.length - 1];
    const endColor = end.gallop ? gallopColor : canterColor;
    g.circle(end.x, end.y, 6).stroke({ width: 1.5, color: endColor, alpha: 0.85 * boost });
    g.circle(end.x, end.y, 2).fill({ color: endColor, alpha: 0.85 * boost });
  }

  /**
   * Point-and-ride feedback while the pointer is held: rings around the leader
   * where canter and gallop begin, and a line to the pointer coloured by pace.
   */
  drawAim(leader: Soldier | null, aim: Vec2 | null, zones: DirectZones): void {
    const g = this.aimG;
    g.clear();
    if (!leader || !aim) return;
    const t = this.theme;
    const z = this.zoom;
    const canterR = zones.canter / z, gallopR = zones.gallop / z;
    const dx = aim.x - leader.x, dy = aim.y - leader.y;
    const d = Math.hypot(dx, dy);
    const galloping = d * z >= zones.gallop;
    const color = galloping ? t.hpMid : t.blue;

    g.circle(leader.x, leader.y, canterR).stroke({ width: 1, color: t.blue, alpha: 0.22 });
    g.circle(leader.x, leader.y, gallopR).stroke({ width: galloping ? 2 : 1, color: t.hpMid, alpha: galloping ? 0.55 : 0.3 });
    if (d * z < zones.dead) {
      g.circle(aim.x, aim.y, 4).stroke({ width: 1.5, color: t.blue, alpha: 0.6 });
      return;
    }
    const nx = dx / d, ny = dy / d;
    const start = 13;
    g.moveTo(leader.x + nx * start, leader.y + ny * start).lineTo(aim.x, aim.y)
      .stroke({ width: galloping ? 2.5 : 1.5, color, alpha: 0.6, cap: 'round' });
    g.circle(aim.x, aim.y, galloping ? 7 : 5).stroke({ width: 1.8, color, alpha: 0.85 });
    g.circle(aim.x, aim.y, 1.8).fill({ color, alpha: 0.85 });
  }

  /** Visible world rectangle (for the minimap). */
  get viewport(): { x: number; y: number; w: number; h: number } {
    return {
      x: -this.world.x / this.zoom,
      y: -this.world.y / this.zoom,
      w: this.viewW / this.zoom,
      h: this.viewH / this.zoom,
    };
  }

  // --- Static ground -------------------------------------------------------------

  private drawGround(): void {
    const g = this.ground;
    const t = this.theme;
    const rand = mulberry32(1234);
    g.rect(0, 0, C.WORLD_W, C.WORLD_H).fill(t.bg);

    // Churned earth where the lines meet.
    const mud = mixColor(t.bg, t.obstacleBorder, 0.16);
    for (let i = 0; i < 40; i++) {
      const x = C.WORLD_W / 2 + (rand() - 0.5) * 900;
      const y = C.FRONT_Y + (rand() - 0.5) * 70;
      g.ellipse(x, y, 40 + rand() * 70, 14 + rand() * 20).fill({ color: mud, alpha: 0.18 });
    }

    // Grass tufts and stones give the eye something to track at speed.
    const tuft = mixColor(t.bg, t.obstacleBorder, 0.3);
    g.setStrokeStyle({ width: 1, color: tuft, alpha: 0.55 });
    for (let i = 0; i < 2200; i++) {
      const x = rand() * C.WORLD_W;
      const y = rand() * C.WORLD_H;
      const s = 2 + rand() * 2.5;
      g.moveTo(x - s, y - s * 0.2).lineTo(x - s * 0.2, y + s * 0.5).lineTo(x + s * 0.4, y - s * 0.6);
    }
    g.stroke();
    for (let i = 0; i < 260; i++) {
      g.circle(rand() * C.WORLD_W, rand() * C.WORLD_H, 0.8 + rand() * 1.8)
        .fill({ color: t.obstacleBorder, alpha: 0.18 + rand() * 0.15 });
    }

    // Field edge.
    g.rect(0, 0, C.WORLD_W, C.WORLD_H).stroke({ width: 4, color: t.obstacleBorder, alpha: 0.5 });

    // Blue rally camp.
    const blue = t.blue;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      this.drawTent(g, C.CAMP_X + Math.cos(a) * (C.CAMP_R + 26), C.CAMP_Y + Math.sin(a) * (C.CAMP_R + 26), blue);
    }
    g.circle(C.CAMP_X, C.CAMP_Y, C.CAMP_R).fill({ color: blue, alpha: 0.07 });
    const dashes = 28;
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / dashes * 0.55;
      arcPath(g, C.CAMP_X, C.CAMP_Y, C.CAMP_R, a0, a1).stroke({ width: 2, color: blue, alpha: 0.5 });
    }
    this.drawBanner(g, C.CAMP_X, C.CAMP_Y, blue);

    // Red camp along the far edge (scenery).
    for (let i = 0; i < 9; i++) {
      this.drawTent(g, C.WORLD_W / 2 + (i - 4) * 70 + (rand() - 0.5) * 20, 70 + rand() * 40, t.red);
    }
    this.drawBanner(g, C.WORLD_W / 2, 150, t.red);

    const label = new Text({
      text: 'RALLY',
      style: { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: 12, fontWeight: '800', fill: blue, letterSpacing: 3 },
      resolution: 4,
    });
    label.anchor.set(0.5);
    label.alpha = 0.6;
    label.position.set(C.CAMP_X, C.CAMP_Y + C.CAMP_R - 16);
    this.world.addChild(label);
  }

  private drawTent(g: Graphics, x: number, y: number, color: number): void {
    g.poly([x - 11, y + 8, x, y - 9, x + 11, y + 8]).fill({ color: mixColor(this.theme.bg, color, 0.25) })
      .stroke({ width: 1.2, color, alpha: 0.6 });
    g.moveTo(x, y - 9).lineTo(x, y + 8).stroke({ width: 0.8, color, alpha: 0.5 });
  }

  private drawBanner(g: Graphics, x: number, y: number, color: number): void {
    g.moveTo(x, y + 10).lineTo(x, y - 24).stroke({ width: 1.5, color: this.theme.obstacleBorder });
    g.poly([x, y - 24, x + 16, y - 19, x, y - 14]).fill(color);
  }

  // --- Units -----------------------------------------------------------------------

  private context(type: UnitType, team: Team, r: number): { body: GraphicsContext; weapon: GraphicsContext } {
    const key = `${type}:${team}:${r}`;
    let ctx = this.contexts.get(key);
    if (!ctx) {
      ctx = { body: new GraphicsContext(), weapon: new GraphicsContext() };
      drawUnitArt(ctx.body, ctx.weapon, type, team, r, this.theme);
      this.contexts.set(key, ctx);
    }
    return ctx;
  }

  private gfxFor(s: Soldier): UnitGfx {
    let u = this.units.get(s.id);
    if (u) return u;
    const ctx = this.context(s.type, s.team, s.radius);
    const root = new Container();
    const body = new Graphics(ctx.body);
    const weapon = new Graphics(ctx.weapon);
    root.addChild(body, weapon);
    this.unitLayer.addChild(root);
    u = { root, body, weapon, pulse: 0, fleeing: false };
    this.units.set(s.id, u);
    return u;
  }

  private killUnit(id: number, angle: number, speed: number): void {
    const u = this.units.get(id);
    if (!u) return;
    this.units.delete(id);
    this.dying.push({
      root: u.root,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: (this.rand() - 0.5) * 10,
      age: 0,
    });
  }

  // --- Frame ---------------------------------------------------------------------------

  render(sim: ChargeSim, events: SimEvent[], dt: number): void {
    this.handleEvents(sim, events, dt);
    this.syncUnits(sim, dt);
    this.spawnTrail(sim, dt);
    this.updateParticles(dt);
    this.drawArrows(sim);
    this.drawTelegraphs(sim);
    this.drawOverlay(sim);
    this.updateCamera(sim, dt);
    this.updatePopups(dt);
    this.flushStains(dt);
  }

  private handleEvents(sim: ChargeSim, events: SimEvent[], dt: number): void {
    const t = this.theme;
    this.sidePopupCooldown -= dt;
    for (const e of events) {
      switch (e.type) {
        case 'impact': {
          this.shake = Math.min(7, this.shake + (e.side === 'rear' ? 1.6 : e.side === 'flank' ? 1.1 : 0.6));
          this.burstDust(e.x, e.y, e.angle, 3);
          if (e.pike) this.popup(e.x, e.y, 'PIKES!', t.labelWarn, 13);
          else if (e.side !== 'front' && this.sidePopupCooldown <= 0) {
            this.sidePopupCooldown = 0.5;
            this.popup(e.x, e.y, e.side === 'rear' ? 'REAR ×3' : 'FLANK ×2', e.side === 'rear' ? t.labelWarn : t.elevationBonus, e.side === 'rear' ? 17 : 15);
          }
          break;
        }
        case 'hit':
          if (this.rand() < 0.5) this.blood(e.x, e.y, e.angle, 2, 0.8);
          this.pulse(e.id);
          break;
        case 'kill':
          this.killUnit(e.id, e.angle, e.byPlayer ? 170 : 90);
          this.blood(e.x, e.y, e.angle, e.byPlayer ? 7 : 4, 1.2);
          this.stainBatch.circle(e.x, e.y, 2 + this.rand() * 2).fill({ color: t.redStain, alpha: 0.35 * t.bloodAlpha });
          this.stainDirty = true;
          break;
        case 'volley':
          break;
        case 'arrow-land':
          if (!e.hit) this.stickArrow(e.x, e.y, e.angle);
          else this.blood(e.x, e.y, e.angle, 2, 0.8);
          break;
        case 'rider-hit':
          this.pulse(e.id);
          if (e.mine) this.shake = Math.min(7, this.shake + 0.8);
          break;
        case 'rider-down':
          this.killUnit(e.id, e.angle, 130);
          this.blood(e.x, e.y, e.angle, e.mine ? 8 : 5, 1.4);
          this.burstDust(e.x, e.y, e.angle, e.mine ? 8 : 4);
          if (e.mine) {
            this.popup(e.x, e.y, e.wasLeader ? 'Leader down!' : 'Rider down', t.labelWarn, 13);
            this.shake = Math.min(8, this.shake + 3);
          } else if (e.byPlayer) {
            this.popup(e.x, e.y, `Knight down +${e.points}`, t.elevationBonus, 14);
          }
          break;
        case 'join':
          this.popup(e.x, e.y - 16, `+${e.count} riders!`, t.blue, 20, 1.4);
          break;
        case 'muster':
          this.popup(e.x, e.y - 20, 'Fresh riders!', t.blue, 16, 1.6);
          break;
        case 'rally':
          this.popup(e.x, e.y - 10, '+1 rider', t.blue, 13);
          break;
        case 'rout':
          if (e.team === 'red') {
            this.popup(e.x, e.y, e.byPlayer ? `ROUTED! +${C.ROUT_SCORE}` : 'ROUTED!', t.red, 22, 1.8);
          } else {
            this.popup(e.x, e.y, 'Our men flee!', t.blue, 16, 1.6);
          }
          break;
        case 'wave':
          this.popup(e.x, e.y + 40, 'Reinforcements!', t.red, 18, 2);
          break;
        case 'combo': {
          const L = sim.leader;
          if (L) this.popup(L.x, L.y - 22, `${e.count} COMBO!`, t.elevationBonus, 18, 1.2);
          break;
        }
      }
    }
  }

  private pulse(id: number): void {
    const u = this.units.get(id);
    if (u) u.pulse = 0.12;
  }

  private syncUnits(sim: ChargeSim, dt: number): void {
    const seen = new Set<number>();
    for (const s of sim.soldiers) {
      if (!s.alive) continue;
      seen.add(s.id);
      const u = this.gfxFor(s);
      u.root.position.set(s.x, s.y);
      u.root.rotation = s.facing;
      if (s.fleeing !== u.fleeing) {
        u.fleeing = s.fleeing;
        u.weapon.visible = !s.fleeing; // weapons thrown down
      }
      const hpK = s.hp / s.maxHp;
      u.root.alpha = (s.fleeing ? 0.6 : 0.55) + 0.45 * hpK;
      let scale = 1;
      if (u.pulse > 0) {
        u.pulse -= dt;
        scale = 1.25;
      }
      if (s.rider && s.speed > C.CHARGE_MIN_SPEED) {
        // Galloping bob.
        scale *= 1 + 0.06 * Math.sin(sim.time * 18 + s.id);
      }
      u.root.scale.set(scale);
    }
    for (const [id, u] of this.units) {
      if (!seen.has(id)) {
        u.root.destroy({ children: true });
        this.units.delete(id);
      }
    }

    const DUR = 0.6;
    this.dying = this.dying.filter(d => {
      d.age += dt;
      const k = d.age / DUR;
      if (k >= 1) { d.root.destroy({ children: true }); return false; }
      const decel = 1 - k * 0.85;
      d.root.x += d.vx * dt * decel;
      d.root.y += d.vy * dt * decel;
      d.root.rotation += d.spin * dt * (1 - k);
      d.root.alpha = 1 - k;
      d.root.scale.set(1 - 0.4 * k);
      return true;
    });
  }

  // --- Particles & stains ----------------------------------------------------------------

  private addParticle(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  private blood(x: number, y: number, angle: number, count: number, power: number): void {
    const colors = this.theme.redBlood;
    for (let i = 0; i < count; i++) {
      const a = angle + (this.rand() - 0.5) * 1.3;
      const sp = (30 + this.rand() * 90) * power;
      this.addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
        life: 0.18 + this.rand() * 0.2, size: 1 + this.rand() * 1.4, grow: -0.5,
        color: colors[Math.floor(this.rand() * colors.length)], alpha: this.theme.bloodAlpha, stain: true,
      });
    }
  }

  private burstDust(x: number, y: number, angle: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = angle + Math.PI + (this.rand() - 0.5) * 2.2;
      const sp = 20 + this.rand() * 50;
      this.addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
        life: 0.5 + this.rand() * 0.4, size: 2 + this.rand() * 2, grow: 4,
        color: this.dust, alpha: 0.4, stain: false,
      });
    }
  }

  private spawnTrail(sim: ChargeSim, dt: number): void {
    this.hoofTimer += dt;
    const stamp = this.hoofTimer >= 0.16;
    if (stamp) this.hoofTimer = 0;
    for (const r of sim.riders) {
      if (r.speed < 60) continue;
      const k = Math.min(1, r.speed / C.GALLOP_SPEED);
      if (this.rand() < k * 0.55) {
        const bx = r.x - Math.cos(r.facing) * 7 + (this.rand() - 0.5) * 4;
        const by = r.y - Math.sin(r.facing) * 7 + (this.rand() - 0.5) * 4;
        this.addParticle({
          x: bx, y: by, vx: (this.rand() - 0.5) * 12, vy: (this.rand() - 0.5) * 12, age: 0,
          life: 0.45 + this.rand() * 0.4, size: 1.5 + this.rand() * 1.5, grow: 5,
          color: this.dust, alpha: 0.32 * k, stain: false,
        });
      }
      if (stamp) {
        // Hoof prints baked into the ground: the field remembers your charges.
        const side = this.rand() < 0.5 ? 2 : -2;
        const jx = (this.rand() - 0.5) * 3, jy = (this.rand() - 0.5) * 3;
        this.stainBatch.circle(r.x - Math.sin(r.facing) * side + jx, r.y + Math.cos(r.facing) * side + jy, 0.8)
          .fill({ color: this.theme.obstacleBorder, alpha: 0.08 });
        this.stainDirty = true;
      }
    }
  }

  private stickArrow(x: number, y: number, angle: number): void {
    const len = 4;
    const tx = x - Math.cos(angle) * len, ty = y - Math.sin(angle) * len;
    this.stainBatch.moveTo(x, y).lineTo(tx, ty).stroke({ width: 0.7, color: this.ink, alpha: 0.35 });
    this.stainBatch.circle(tx, ty, 0.8).fill({ color: this.ink, alpha: 0.25 });
    this.stainDirty = true;
  }

  private updateParticles(dt: number): void {
    const g = this.fx;
    g.clear();
    const t = this.theme;
    const stainAlpha = t.bloodAlpha * (1 - t.bloodFade * 0.7);
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) {
        if (p.stain) {
          this.stainBatch.circle(p.x, p.y, p.size * (0.5 + this.rand() * 0.5))
            .fill({ color: t.redStain, alpha: (0.3 + this.rand() * 0.3) * stainAlpha });
          this.stainDirty = true;
        }
        continue;
      }
      const decay = Math.exp(-5 * dt);
      p.vx *= decay;
      p.vy *= decay;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      const size = Math.max(0.3, p.size + p.grow * p.age);
      g.circle(p.x, p.y, size).fill({ color: p.color, alpha: p.alpha * (1 - k) });
      keep.push(p);
    }
    this.particles = keep;
  }

  private stainTimer = 0;

  /** Bake pending stains into the ground texture a few times a second (one extra GPU pass each). */
  private flushStains(dt: number): void {
    this.stainTimer += dt;
    if (!this.stainDirty || this.stainTimer < 0.2) return;
    this.stainTimer = 0;
    this.app.renderer.render({ container: this.stainBatch, target: this.stainRT, clear: false });
    this.stainBatch.clear();
    this.stainDirty = false;
  }

  // --- Arrows, telegraphs, overlays ----------------------------------------------------------

  private drawArrows(sim: ChargeSim): void {
    const g = this.arrowsG;
    g.clear();
    const t = this.theme;
    for (const a of sim.arrows) {
      if (a.t < 0) continue;
      const p = a.t / a.flight;
      const gx = a.sx + (a.tx - a.sx) * p;
      const gy = a.sy + (a.ty - a.sy) * p;
      const h = 4 * p * (1 - p);
      const lift = h * 26 * a.flight;
      const dx = a.tx - a.sx, dy = a.ty - a.sy;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      // Ground shadow, sharper as the arrow comes down.
      g.circle(gx, gy, 1.2).fill({ color: 0x000000, alpha: 0.08 + 0.12 * (1 - h) });
      // The arrow itself, lifted toward the viewer at the top of its arc.
      const ax = gx, ay = gy - lift;
      const len = 5 * (1 + h * 0.5);
      const color = a.team === 'blue' ? t.blueProjectile : t.redProjectile;
      g.moveTo(ax - nx * len, ay - ny * len).lineTo(ax, ay).stroke({ width: 0.8 + h * 0.4, color, alpha: 0.95 });
    }
  }

  private drawTelegraphs(sim: ChargeSim): void {
    const g = this.telegraph;
    g.clear();
    const warn = this.theme.labelWarn;
    for (const v of sim.volleys) {
      if (!v.atPlayer) continue;
      const p = Math.min(1, v.t / v.flight);
      if (p >= 1) continue;
      g.circle(v.x, v.y, v.radius).fill({ color: warn, alpha: 0.05 + 0.12 * p });
      g.circle(v.x, v.y, v.radius * p).fill({ color: warn, alpha: 0.1 + 0.1 * p });
      const dashes = 18;
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * Math.PI * 2 + v.t * 0.8;
        arcPath(g, v.x, v.y, v.radius, a0, a0 + (Math.PI * 2) / dashes * 0.5)
          .stroke({ width: 1.2, color: warn, alpha: 0.35 + 0.5 * p });
      }
    }
  }

  private drawOverlay(sim: ChargeSim): void {
    const g = this.overlay;
    g.clear();
    const t = this.theme;
    const L = sim.leader;

    // Morale bars over enemy battalions near the action.
    for (const b of sim.battalions) {
      if (b.routed || b.team !== 'red') continue;
      if (L && Math.hypot(b.x - L.x, b.y - L.y) > 520 && b.morale > 60) continue;
      const rows = Math.ceil(b.grid.length / b.cols);
      const ext = Math.max(b.cols, rows) * b.spacing * 0.5;
      const w = 34, h = 3.5;
      const x = b.x - w / 2, y = b.y - ext - 12;
      const m = Math.max(0, Math.min(1, b.morale / 100));
      const color = m > 0.6 ? t.hpHigh : m > 0.3 ? t.hpMid : t.hpLow;
      g.roundRect(x - 1, y - 1, w + 2, h + 2, 2).fill({ color: t.hpBg, alpha: 0.55 });
      g.roundRect(x, y, w * m, h, 1.5).fill({ color, alpha: 0.95 });
    }

    // Banners on other squadrons' leaders; allied troops show they can be collected.
    for (const sq of sim.squadrons) {
      const SL = sq.riders[0];
      if (sq === sim.player || !SL) continue;
      const color = sq.team === 'blue' ? t.blue : t.red;
      const bx = SL.x - Math.cos(SL.facing) * 3, by = SL.y - Math.sin(SL.facing) * 3;
      const wave = Math.sin(sim.time * 9 + sq.id) * 1.2;
      g.moveTo(bx, by).lineTo(bx, by - 12).stroke({ width: 1, color: t.obstacleBorder });
      g.poly([bx, by - 12, bx + 7, by - 10 + wave, bx, by - 7]).fill(color);
      if (sq.team === 'blue') {
        const c = sim.squadCenter(sq);
        const pulse = 0.5 + 0.3 * Math.sin(sim.time * 4 + sq.id);
        g.circle(c.x, c.y, 16 + sq.riders.length * 1.5).stroke({ width: 1.2, color, alpha: pulse });
      }
    }
    this.updateJoinTags(sim);

    if (!L) return;
    // Leader marker: ring + heading chevron.
    g.circle(L.x, L.y, 11).stroke({ width: 1.4, color: t.blue, alpha: 0.75 });
    const cx = L.x + Math.cos(L.facing) * 19, cy = L.y + Math.sin(L.facing) * 19;
    const px = -Math.sin(L.facing), py = Math.cos(L.facing);
    g.poly([
      cx + Math.cos(L.facing) * 4, cy + Math.sin(L.facing) * 4,
      cx + px * 3.5, cy + py * 3.5,
      cx - px * 3.5, cy - py * 3.5,
    ]).fill({ color: t.blue, alpha: 0.8 });
    // Banner on the leader.
    const bx = L.x - Math.cos(L.facing) * 3, by = L.y - Math.sin(L.facing) * 3;
    const wave = Math.sin(sim.time * 10) * 1.5;
    g.moveTo(bx, by).lineTo(bx, by - 14).stroke({ width: 1, color: t.obstacleBorder });
    g.poly([bx, by - 14, bx + 9, by - 12 + wave, bx, by - 9]).fill(t.blue);
  }

  // --- Camera & popups ---------------------------------------------------------------------

  private updateCamera(sim: ChargeSim, dt: number): void {
    const L = sim.leader;
    const base = this.baseZoom();
    let targetZoom = base;
    if (L) {
      // Keep the whole squadron centred, nudged a little toward where it is heading,
      // so there is room on every side to draw the next route.
      const c = sim.squadCenter();
      const k = Math.min(1, L.speed / C.GALLOP_SPEED);
      const look = this.holdCamera ? 0.12 : 0.25;
      const tx = c.x + L.vx * look;
      const ty = c.y + L.vy * look;
      // Follow a little more gently while a route is being drawn so strokes don't swim.
      const f = 1 - Math.exp(-(this.holdCamera ? 3.5 : 6) * dt);
      this.camX += (tx - this.camX) * f;
      this.camY += (ty - this.camY) * f;
      targetZoom = this.holdCamera ? this.zoom : base * (1 - 0.08 * k);
    }
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-2 * dt));

    const halfW = this.viewW / this.zoom / 2;
    const halfH = this.viewH / this.zoom / 2;
    const m = 60;
    const cx = halfW * 2 > C.WORLD_W + m * 2 ? C.WORLD_W / 2 : Math.max(halfW - m, Math.min(C.WORLD_W + m - halfW, this.camX));
    const cy = halfH * 2 > C.WORLD_H + m * 2 ? C.WORLD_H / 2 : Math.max(halfH - m, Math.min(C.WORLD_H + m - halfH, this.camY));

    this.shake *= Math.exp(-9 * dt);
    const sx = (this.rand() - 0.5) * 2 * this.shake;
    const sy = (this.rand() - 0.5) * 2 * this.shake;
    this.world.scale.set(this.zoom);
    this.world.position.set(this.viewW / 2 - cx * this.zoom + sx, this.viewH / 2 - cy * this.zoom + sy);
  }

  private readonly joinTags = new Map<number, Text>();

  /** "JOIN +n" tags over allied troops so it's obvious you can collect them. */
  private updateJoinTags(sim: ChargeSim): void {
    const seen = new Set<number>();
    const L = sim.leader;
    for (const sq of sim.squadrons) {
      if (sq === sim.player || sq.team !== 'blue' || sq.riders.length === 0 || !L) continue;
      seen.add(sq.id);
      let tag = this.joinTags.get(sq.id);
      if (!tag) {
        tag = new Text({
          text: '',
          style: {
            fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: 12, fontWeight: '800',
            fill: this.theme.blue, stroke: { color: this.theme.bg, width: 3 }, letterSpacing: 1,
          },
        });
        tag.anchor.set(0.5, 1);
        this.popupLayer.addChild(tag);
        this.joinTags.set(sq.id, tag);
      }
      const label = `JOIN +${sq.riders.length}`;
      if (tag.text !== label) tag.text = label;
      const c = sim.squadCenter(sq);
      const p = this.worldToScreen({ x: c.x, y: c.y - 22 - sq.riders.length });
      tag.position.set(p.x, p.y);
      tag.alpha = 0.7 + 0.3 * Math.sin(sim.time * 4);
    }
    for (const [id, tag] of this.joinTags) {
      if (!seen.has(id)) { tag.destroy(); this.joinTags.delete(id); }
    }
  }

  private popup(x: number, y: number, msg: string, color: number, size: number, life = 0.9): void {
    if (this.popups.length >= MAX_POPUPS) this.releasePopup(this.popups.shift()!.text);
    // Reuse text objects: creating a fresh one per popup allocates a canvas and texture.
    let text = this.freePopups.pop();
    if (!text) {
      text = new Text({
        text: msg,
        style: {
          fontFamily: 'Segoe UI, system-ui, sans-serif',
          fontSize: size,
          fontWeight: '800',
          fill: color,
          stroke: { color: this.theme.bg, width: 3 },
          letterSpacing: 1,
        },
      });
      text.anchor.set(0.5);
      this.popupLayer.addChild(text);
    } else {
      text.text = msg;
      text.style.fontSize = size;
      text.style.fill = color;
      text.visible = true;
    }
    this.popups.push({ text, x, y, age: 0, life });
  }

  private readonly freePopups: Text[] = [];

  private releasePopup(text: Text): void {
    text.visible = false;
    this.freePopups.push(text);
  }

  private updatePopups(dt: number): void {
    this.popups = this.popups.filter(p => {
      p.age += dt;
      if (p.age >= p.life) { this.releasePopup(p.text); return false; }
      const k = p.age / p.life;
      const s = this.worldToScreen({ x: p.x, y: p.y });
      p.text.position.set(s.x, s.y - 18 - k * 30);
      p.text.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      p.text.scale.set(k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, k * 0.2));
      return true;
    });
  }
}
