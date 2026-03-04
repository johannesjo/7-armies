import { Application, Graphics, Container, Text } from 'pixi.js';
import { Unit, Obstacle, Projectile, ElevationZone, Vec2 } from './types';
import { MAP_WIDTH, MAP_HEIGHT } from './constants';
import { createEffectsManager, EffectsManager } from './effects';
import { mergeObstacles } from './obstacle-merge';
import { Theme, NIGHT_THEME } from './theme';

export class Renderer {
  private app: Application;
  private unitGraphics: Map<string, Container> = new Map();
  private dyingUnits: Map<string, { container: Container; age: number; vel: { x: number; y: number } }> = new Map();
  private elevationGraphics: Container | null = null;
  private obstacleGraphics: Container | null = null;
  private bgGraphics: Graphics | null = null;
  private projectileGraphics: Graphics | null = null;
  private _effects: EffectsManager | null = null;
  private zoneLabels: { rect: Obstacle; label: Text; hovered: boolean; dragActive: boolean }[] = [];
  private theme: Theme = NIGHT_THEME;
  private noiseSprite: Container | null = null;
  private lastElevationZones: ElevationZone[] = [];
  private lastObstacles: Obstacle[] = [];
  constructor() {
    this.app = new Application();
  }

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      backgroundColor: this.theme.bg,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    container.appendChild(this.app.canvas);
    this.drawBackground();
    this._effects = createEffectsManager(this.app.stage);
    this.resize(container.clientWidth, container.clientHeight);
  }

  resize(containerW: number, containerH: number): void {
    const scale = Math.min(containerW / MAP_WIDTH, containerH / MAP_HEIGHT);
    this.app.renderer.resize(MAP_WIDTH * scale, MAP_HEIGHT * scale);
    this.app.stage.scale.set(scale);
  }

  private drawBackground(): void {
    if (this.bgGraphics) {
      this.app.stage.removeChild(this.bgGraphics);
      this.bgGraphics.destroy();
    }
    this.bgGraphics = new Graphics();
    this.app.stage.addChildAt(this.bgGraphics, 0);

    if (this.noiseSprite) {
      this.app.stage.removeChild(this.noiseSprite);
      this.noiseSprite.destroy();
      this.noiseSprite = null;
    }
  }

  renderElevationZones(zones: ElevationZone[]): void {
    this.lastElevationZones = zones;
    this.zoneLabels = [];
    if (this.elevationGraphics) {
      this.app.stage.removeChild(this.elevationGraphics);
      this.elevationGraphics.destroy({ children: true });
    }
    const container = new Container();
    const gfx = new Graphics();

    const eA = this.theme.elevationAlpha;
    for (const z of zones) {
      gfx.roundRect(z.x, z.y, z.w, z.h, 6);
      gfx.fill({ color: this.theme.elevationOuter, alpha: 0.5 * eA });

      const m = 8;
      gfx.roundRect(z.x + m, z.y + m, z.w - m * 2, z.h - m * 2, 4);
      gfx.fill({ color: this.theme.elevationMid, alpha: 0.35 * eA });

      const m2 = 16;
      gfx.roundRect(z.x + m2, z.y + m2, z.w - m2 * 2, z.h - m2 * 2, 2);
      gfx.fill({ color: this.theme.elevationInner, alpha: 0.25 * eA });

      const hitArea = new Graphics();
      hitArea.roundRect(z.x, z.y, z.w, z.h, 6);
      hitArea.fill({ color: 0x000000, alpha: 0.001 });
      hitArea.eventMode = 'static';
      hitArea.cursor = 'default';

      const label = new Text({
        text: '+20% Range',
        style: {
          fontSize: 14,
          fontFamily: 'monospace',
          fill: this.theme.elevationLabel,
          fontWeight: 'bold',
        },
      });
      label.alpha = 0;
      label.anchor.set(0.5, 0.5);
      label.x = z.x + z.w / 2;
      label.y = z.y + z.h / 2;

      const entry = { rect: z, label, hovered: false, dragActive: false };
      this.zoneLabels.push(entry);

      hitArea.on('pointerenter', () => { entry.hovered = true; label.alpha = 0.7; });
      hitArea.on('pointerleave', () => { entry.hovered = false; label.alpha = entry.dragActive ? 0.7 : 0; });

      container.addChild(label);
      container.addChild(hitArea);
    }

    container.addChild(gfx);
    container.setChildIndex(gfx, 0);

    this.elevationGraphics = container;
    this.app.stage.addChildAt(this.elevationGraphics, 2);
  }

  renderObstacles(obstacles: Obstacle[]): void {
    this.lastObstacles = obstacles;
    if (this.obstacleGraphics) {
      this.app.stage.removeChild(this.obstacleGraphics);
      this.obstacleGraphics.destroy({ children: true });
    }
    const wrapper = new Container();
    this.obstacleGraphics = wrapper;

    if (this.theme.sketchyObstacles) {
      this.renderSketchyObstacles(wrapper, obstacles);
    } else {
      this.renderCleanObstacles(wrapper, obstacles);
    }

    this.app.stage.addChildAt(this.obstacleGraphics, 3);
  }

  /** Draw a rectilinear polygon with rounded corners using arcTo. */
  private drawRoundedPolygon(g: Graphics, points: Vec2[], radius: number): void {
    const n = points.length;
    if (n < 3) return;

    const last = points[n - 1];
    const first = points[0];
    const mx = (last.x + first.x) / 2;
    const my = (last.y + first.y) / 2;
    g.moveTo(mx, my);

    for (let i = 0; i < n; i++) {
      const curr = points[i];
      const next = points[(i + 1) % n];
      g.arcTo(curr.x, curr.y, next.x, next.y, radius);
    }
    g.closePath();
  }

  private renderCleanObstacles(wrapper: Container, obstacles: Obstacle[]): void {
    const polygons = mergeObstacles(obstacles);

    const borders = new Graphics();
    for (const poly of polygons) {
      this.drawRoundedPolygon(borders, poly, 4);
      borders.setStrokeStyle({ width: 2, color: this.theme.obstacleBorder });
      borders.stroke();
    }
    wrapper.addChild(borders);

    const fills = new Graphics();
    for (const poly of polygons) {
      this.drawRoundedPolygon(fills, poly, 4);
      fills.fill({ color: this.theme.obstacleFill });
    }
    wrapper.addChild(fills);
  }

  private renderSketchyObstacles(wrapper: Container, obstacles: Obstacle[]): void {
    const polygons = mergeObstacles(obstacles);

    // Seeded random based on first vertex for stable wobble
    const seededRandom = (x: number, y: number, i: number) => {
      const seed = (x * 7919 + y * 104729 + i * 31) | 0;
      return ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1;
    };

    // Fill using rounded polygon path
    const fills = new Graphics();
    for (const poly of polygons) {
      this.drawRoundedPolygon(fills, poly, 4);
      fills.fill({ color: this.theme.obstacleFill });
    }
    wrapper.addChild(fills);

    // Two wobbly outline passes per polygon
    const outlines = new Graphics();
    for (const poly of polygons) {
      const seed0 = poly[0];
      for (let pass = 0; pass < 2; pass++) {
        outlines.setStrokeStyle({ width: 1.5, color: this.theme.obstacleBorder, alpha: 0.8 });

        for (let i = 0; i < poly.length; i++) {
          const pt = poly[i];
          const jitter = (seededRandom(seed0.x, seed0.y, pass * poly.length + i) - 0.5) * 1;
          const wx = pt.x + jitter;
          const wy = pt.y + jitter;

          if (i === 0) outlines.moveTo(wx, wy);
          else outlines.lineTo(wx, wy);
        }

        // Close back to first vertex with jitter
        const j0 = (seededRandom(seed0.x, seed0.y, pass * poly.length) - 0.5) * 1;
        outlines.lineTo(poly[0].x + j0, poly[0].y + j0);
        outlines.stroke();
      }
    }
    wrapper.addChild(outlines);
  }

  /** Show zone labels for zones containing pos; hide the rest (unless hovered). */
  highlightZonesAt(pos: Vec2 | null): void {
    for (const zl of this.zoneLabels) {
      const inside = pos !== null &&
        pos.x >= zl.rect.x && pos.x <= zl.rect.x + zl.rect.w &&
        pos.y >= zl.rect.y && pos.y <= zl.rect.y + zl.rect.h;
      zl.dragActive = inside;
      zl.label.alpha = (zl.hovered || zl.dragActive) ? 0.7 : 0;
    }
  }

  renderUnits(units: Unit[], dt = 0, deadVelocities?: Map<string, Vec2>): void {
    const activeIds = new Set<string>();

    for (const unit of units) {
      if (!unit.alive) {
        const existing = this.unitGraphics.get(unit.id);
        if (existing) {
          // Move to dying pool with fly-away velocity
          this.unitGraphics.delete(unit.id);
          const vel = deadVelocities?.get(unit.id) ?? { x: 0, y: 0 };
          this.dyingUnits.set(unit.id, { container: existing, age: 0, vel });
        }
        continue;
      }

      activeIds.add(unit.id);
      let container = this.unitGraphics.get(unit.id);

      if (!container) {
        container = this.createUnitGraphic(unit);
        this.unitGraphics.set(unit.id, container);
        this.app.stage.addChild(container);
      }

      container.x = unit.pos.x;
      container.y = unit.pos.y;

      // Rotate gun barrel / weapon indicator
      (container.getChildAt(1) as Graphics).rotation = unit.gunAngle;
      // Rotate body with the facing direction
      (container.getChildAt(0) as Graphics).rotation = unit.gunAngle;

      // HP feedback via alpha + scale (no per-unit health bars at this scale)
      const hpRatio = unit.hp / unit.maxHp;
      container.alpha = 0.4 + 0.6 * hpRatio;
      const hpScale = 0.7 + 0.3 * hpRatio;

      // Idle breathing pulse when stationary
      const speed = Math.sqrt(unit.vel.x * unit.vel.x + unit.vel.y * unit.vel.y);
      if (speed < 1) {
        const breath = hpScale + 0.015 * Math.sin(Date.now() / 400 + unit.pos.x);
        (container.getChildAt(0) as Graphics).scale.set(breath);
      } else {
        (container.getChildAt(0) as Graphics).scale.set(hpScale);
      }
    }

    // Update dying units — fade out over 0.5s with fly-away + spin
    const DEATH_DURATION = 0.5;
    for (const [id, dying] of this.dyingUnits) {
      dying.age += dt;
      const t = Math.min(dying.age / DEATH_DURATION, 1);
      // Move by velocity (decelerating)
      const decel = 1 - t * 0.8; // slows to 20% speed at end
      dying.container.x += dying.vel.x * dt * decel;
      dying.container.y += dying.vel.y * dt * decel;
      // Spin based on velocity magnitude
      const speed = Math.sqrt(dying.vel.x * dying.vel.x + dying.vel.y * dying.vel.y);
      if (speed > 10) {
        dying.container.rotation += (speed / 40) * dt;
      }
      dying.container.alpha = 1 - t;
      dying.container.scale.set(1 - 0.5 * t);
      if (t >= 1) {
        this.app.stage.removeChild(dying.container);
        this.dyingUnits.delete(id);
      }
    }

    // Remove graphics for units no longer present
    for (const [id, container] of this.unitGraphics) {
      if (!activeIds.has(id)) {
        this.app.stage.removeChild(container);
        this.unitGraphics.delete(id);
      }
    }
  }

  private createUnitGraphic(unit: Unit): Container {
    const container = new Container();
    const shape = new Graphics();
    const color = unit.team === 'blue' ? this.theme.blue : this.theme.red;
    const darkColor = unit.team === 'blue' ? this.theme.blueDark : this.theme.redDark;
    const r = unit.radius;

    const weapon = new Graphics();

    switch (unit.type) {
      case 'cavalry': {
        // Ellipse body — elongated along X (facing direction)
        shape.ellipse(0, 0, r * 1.3, r * 0.65);
        shape.fill(color);
        shape.ellipse(0, 0, r * 1.3, r * 0.65);
        shape.setStrokeStyle({ width: 1, color: darkColor });
        shape.stroke();
        // Rider dot at front (+X = facing direction)
        shape.circle(r * 0.6, 0, r * 0.35);
        shape.fill(darkColor);
        // Lance
        weapon.setStrokeStyle({ width: 1, color: this.theme.barrel, alpha: this.theme.barrelAlpha });
        weapon.moveTo(0, 0);
        weapon.lineTo(r * 1.8, 0);
        weapon.stroke();
        break;
      }
      case 'archer': {
        // Oval body — wide shoulders, narrow front-to-back
        shape.ellipse(0, 0, r * 0.6, r * 1.2);
        shape.fill(color);
        shape.ellipse(0, 0, r * 0.6, r * 1.2);
        shape.setStrokeStyle({ width: 1, color: darkColor });
        shape.stroke();
        // D-shaped bow: arc limb + straight bowstring
        const bowR = r * 1.8;
        const bowAngle = 0.9; // ~52° half-sweep
        weapon.setStrokeStyle({ width: 1.5, color: this.theme.barrel, alpha: this.theme.barrelAlpha });
        weapon.arc(0, 0, bowR, -bowAngle, bowAngle);
        weapon.stroke();
        // Bowstring: straight line connecting arc endpoints
        const sx = Math.cos(bowAngle) * bowR;
        const sy = Math.sin(bowAngle) * bowR;
        weapon.setStrokeStyle({ width: 0.5, color: this.theme.barrel, alpha: this.theme.barrelAlpha * 0.7 });
        weapon.moveTo(sx, -sy);
        weapon.lineTo(sx, sy);
        weapon.stroke();
        break;
      }
      case 'pikeman': {
        // Oval body + thicker outline (heavier armor)
        shape.ellipse(0, 0, r * 0.65, r * 1.2);
        shape.fill(color);
        shape.ellipse(0, 0, r * 0.65, r * 1.2);
        shape.setStrokeStyle({ width: 1.5, color: darkColor });
        shape.stroke();
        // Long pike (3× radius) with spearhead
        const pikeLen = r * 3;
        weapon.setStrokeStyle({ width: 1, color: this.theme.barrel, alpha: this.theme.barrelAlpha });
        weapon.moveTo(0, 0);
        weapon.lineTo(pikeLen, 0);
        weapon.stroke();
        // Spearhead — small filled triangle at tip
        weapon.moveTo(pikeLen + 2, 0);
        weapon.lineTo(pikeLen - 1, -1.2);
        weapon.lineTo(pikeLen - 1, 1.2);
        weapon.closePath();
        weapon.fill({ color: this.theme.barrel, alpha: this.theme.barrelAlpha });
        break;
      }
      default: {
        // Swordsman: oval body + outline + shield
        shape.ellipse(0, 0, r * 0.7, r * 1.15);
        shape.fill(color);
        shape.ellipse(0, 0, r * 0.7, r * 1.15);
        shape.setStrokeStyle({ width: 1, color: darkColor });
        shape.stroke();
        // Shield: filled semicircle on local +X side (perpendicular to facing)
        shape.arc(1.5, 0, 2, -Math.PI / 2, Math.PI / 2);
        shape.fill({ color: darkColor, alpha: 0.8 });
        // Short sword, slightly thicker
        weapon.setStrokeStyle({ width: 1.5, color: this.theme.barrel, alpha: this.theme.barrelAlpha });
        weapon.moveTo(0, 0);
        weapon.lineTo(r * 1.5, 0);
        weapon.stroke();
        break;
      }
    }

    container.addChild(shape);
    container.addChild(weapon);

    // Empty placeholder for HP bar (index 2, not used for per-unit rendering)
    const hpPlaceholder = new Graphics();
    container.addChild(hpPlaceholder);

    return container;
  }

  renderProjectiles(projectiles: Projectile[]): void {
    if (this.projectileGraphics) {
      this.app.stage.removeChild(this.projectileGraphics);
    }
    this.projectileGraphics = new Graphics();
    const g = this.projectileGraphics;

    for (const p of projectiles) {
      const color = p.team === 'blue' ? this.theme.blueProjectile : this.theme.redProjectile;

      // Compute arc height for arcing arrows
      const arcProgress = (p.arc && p.totalFlightDist && p.totalFlightDist > 0)
        ? Math.min(p.distanceTraveled / p.totalFlightDist, 1)
        : 1;
      const arcHeight = p.arc ? 4 * arcProgress * (1 - arcProgress) : 0; // 0→1→0 parabola
      const arcScale = 1 + arcHeight * 0.5; // up to 1.5× at apex

      // Draw shadow dot on ground when arrow is high in arc
      if (arcHeight > 0.1) {
        g.circle(p.pos.x, p.pos.y, 1.5);
        g.fill({ color: 0x000000, alpha: 0.15 * arcHeight });
      }

      // Draw trail — thin, fading
      if (p.trail && p.trail.length > 1) {
        for (let i = 1; i < p.trail.length; i++) {
          const alpha = (i / p.trail.length) * 0.3;
          g.setStrokeStyle({ width: 1, color, alpha });
          g.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
          g.lineTo(p.trail[i].x, p.trail[i].y);
          g.stroke();
        }
      }

      const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
      if (speed > 0) {
        // Direction unit vector (tip → tail)
        const nx = p.vel.x / speed;
        const ny = p.vel.y / speed;
        // Perpendicular
        const px = -ny;
        const py = nx;

        // Scale arrow size by arc height
        const shaftLen = 10 * arcScale;
        const headBase = 3 * arcScale;
        const headWidth = 1 * arcScale;

        // Tip at current position, tail behind (scaled)
        const tipX = p.pos.x;
        const tipY = p.pos.y;
        const tailX = tipX - nx * shaftLen;
        const tailY = tipY - ny * shaftLen;

        // Shaft — thin line
        g.setStrokeStyle({ width: 1 * arcScale, color, alpha: 1 });
        g.moveTo(tailX, tailY);
        g.lineTo(tipX, tipY);
        g.stroke();

        // Arrowhead — filled triangle
        g.moveTo(tipX, tipY);
        g.lineTo(tipX - nx * headBase + px * headWidth, tipY - ny * headBase + py * headWidth);
        g.lineTo(tipX - nx * headBase - px * headWidth, tipY - ny * headBase - py * headWidth);
        g.closePath();
        g.fill(color);

        // Fletching — two short angled lines at tail
        const fLen = 2 * arcScale;
        const fAngle = 0.5; // ~30°
        const fCos = Math.cos(fAngle);
        const fSin = Math.sin(fAngle);
        g.setStrokeStyle({ width: 0.5, color, alpha: 0.5 });
        // Left fletching
        g.moveTo(tailX, tailY);
        g.lineTo(
          tailX + (-nx * fCos + px * fSin) * fLen,
          tailY + (-ny * fCos + py * fSin) * fLen,
        );
        g.stroke();
        // Right fletching
        g.moveTo(tailX, tailY);
        g.lineTo(
          tailX + (-nx * fCos - px * fSin) * fLen,
          tailY + (-ny * fCos - py * fSin) * fLen,
        );
        g.stroke();
      } else {
        g.circle(p.pos.x, p.pos.y, p.radius);
        g.fill(color);
      }
    }

    this.app.stage.addChild(g);
  }

  getUnitContainer(id: string): Container | undefined {
    return this.unitGraphics.get(id);
  }

  get currentTheme(): Theme {
    return this.theme;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.app.renderer.background.color = theme.bg;
    this.drawBackground();
    // Re-render terrain with new colors
    if (this.lastElevationZones.length > 0) this.renderElevationZones(this.lastElevationZones);
    if (this.lastObstacles.length > 0) this.renderObstacles(this.lastObstacles);
    // Rebuild unit graphics with new colors
    for (const [, container] of this.unitGraphics) {
      this.app.stage.removeChild(container);
    }
    this.unitGraphics.clear();
    // Update effects theme
    this._effects?.setTheme(theme);
  }

  get effects(): EffectsManager | null {
    return this._effects;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get stage() {
    return this.app.stage;
  }

  get ticker() {
    return this.app.ticker;
  }

  destroy(): void {
    this.unitGraphics.clear();
    this.app.destroy(true);
  }
}
