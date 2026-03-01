import { Graphics, Container, Rectangle, Text } from 'pixi.js';
import { Unit, Battalion, Team, Vec2, ElevationZone } from './types';
import { PATH_SAMPLE_DISTANCE, UNIT_SELECT_RADIUS, MAP_WIDTH, MAP_HEIGHT, ELEVATION_RANGE_BONUS, ROUND_DURATION_S } from './constants';
import { getElevationLevel } from './units';
import { findBattalionForUnit, updateBattalionCenter } from './battalion';
import { Theme, NIGHT_THEME } from './theme';

/** Sample a polyline from raw pointer positions, keeping points >= minDist apart. */
export function samplePath(raw: Vec2[], minDist: number): Vec2[] {
  if (raw.length === 0) return [];
  const result: Vec2[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = result[result.length - 1];
    const dx = raw[i].x - last.x;
    const dy = raw[i].y - last.y;
    if (dx * dx + dy * dy >= minDist * minDist) {
      result.push(raw[i]);
    }
  }
  // Always include the actual endpoint (release position)
  if (raw.length > 1) {
    const end = raw[raw.length - 1];
    const last = result[result.length - 1];
    if (end.x !== last.x || end.y !== last.y) {
      result.push(end);
    }
  }
  return result;
}

function distancePt(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Sum of all segment lengths in a polyline. */
function polylineLength(pts: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += distancePt(pts[i - 1], pts[i]);
  }
  return len;
}

/** Return position and angle at a given distance along a polyline. */
function pointAtDistance(pts: Vec2[], dist: number): { pos: Vec2; angle: number } {
  let remaining = dist;
  for (let i = 1; i < pts.length; i++) {
    const segLen = distancePt(pts[i - 1], pts[i]);
    if (remaining <= segLen && segLen > 0) {
      const t = remaining / segLen;
      return {
        pos: {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
        },
        angle: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x),
      };
    }
    remaining -= segLen;
  }
  // Past the end — return last point
  const last = pts[pts.length - 1];
  const prev = pts.length >= 2 ? pts[pts.length - 2] : pts[0];
  return {
    pos: { x: last.x, y: last.y },
    angle: Math.atan2(last.y - prev.y, last.x - prev.x),
  };
}

export class PathDrawer {
  private stage: Container;
  private units: Unit[] = [];
  private battalions: Battalion[] = [];
  private elevationZones: ElevationZone[] = [];
  private team: Team | null = null;
  private gfx: Graphics;
  private hoverGfx: Graphics;
  private selectedBattalion: Battalion | null = null;
  private hoveredBattalion: Battalion | null = null;
  private hoveredEnemyBattalion: Battalion | null = null;
  private rawPoints: Vec2[] = [];
  private enabled = false;
  private canvas: HTMLCanvasElement | null = null;
  theme: Theme = NIGHT_THEME;
  private labelContainer: Container;
  private labelPool: Text[] = [];
  private labelIndex = 0;
  private hoverLabel: Text;
  private onZoneHighlight: ((pos: Vec2 | null) => void) | null = null;

  constructor(stage: Container, canvas?: HTMLCanvasElement, onZoneHighlight?: (pos: Vec2 | null) => void) {
    this.stage = stage;
    this.onZoneHighlight = onZoneHighlight ?? null;
    this.gfx = new Graphics();
    this.hoverGfx = new Graphics();
    this.labelContainer = new Container();
    this.hoverLabel = new Text({
      text: '',
      style: { fontSize: 11, fontFamily: 'monospace', fill: this.theme.hoverLabelFill },
    });
    this.hoverLabel.anchor.set(0.5, 1);
    this.hoverLabel.visible = false;
    this.stage.addChild(this.gfx);
    this.stage.addChild(this.hoverGfx);
    this.stage.addChild(this.labelContainer);
    this.stage.addChild(this.hoverLabel);

    // Suppress context menu on canvas
    if (canvas) {
      this.canvas = canvas;
      this.canvas.addEventListener('contextmenu', this.onContextMenu);
    }

    // Make stage interactive for canvas-wide pointer events
    this.stage.eventMode = 'static';
    this.stage.hitArea = new Rectangle(0, 0, MAP_WIDTH, MAP_HEIGHT);

    this.stage.on('pointerdown', this.onPointerDown);
    this.stage.on('pointermove', this.onPointerMove);
    this.stage.on('pointerup', this.onPointerUp);
    this.stage.on('pointerupoutside', this.onPointerUp);
    this.stage.on('rightdown', this.onRightDown);
  }

  private acquireLabel(): Text {
    if (this.labelIndex < this.labelPool.length) {
      const label = this.labelPool[this.labelIndex];
      label.visible = true;
      this.labelIndex++;
      return label;
    }
    const label = new Text({
      text: '',
      style: { fontSize: 11, fontFamily: 'monospace', fill: this.theme.labelFill },
    });
    label.anchor.set(0.5, 1);
    this.labelContainer.addChild(label);
    this.labelPool.push(label);
    this.labelIndex++;
    return label;
  }

  enable(team: Team, units: Unit[], battalions: Battalion[], elevationZones: ElevationZone[] = []): void {
    this.team = team;
    this.units = units;
    this.battalions = battalions;
    this.elevationZones = elevationZones;
    this.enabled = true;
    this.selectedBattalion = null;
    this.hoveredBattalion = null;
    this.hoveredEnemyBattalion = null;
    this.rawPoints = [];
    this.renderPaths();
  }

  disable(): void {
    this.enabled = false;
    this.team = null;
    this.selectedBattalion = null;
    this.hoveredBattalion = null;
    this.hoveredEnemyBattalion = null;
    this.rawPoints = [];
    this.hoverGfx.clear();
    for (const label of this.labelPool) label.visible = false;
    this.onZoneHighlight?.(null);
  }

  renderPaths(): void {
    this.gfx.clear();
    this.labelIndex = 0;

    for (const bat of this.battalions) {
      if (bat.waypoints.length === 0) continue;
      const batAlive = this.units.filter(u => bat.unitIds.includes(u.id) && u.alive);
      if (batAlive.length === 0) continue;

      const center = updateBattalionCenter(bat, this.units);
      const speed = batAlive[0].speed;
      const color = bat.team === 'blue' ? this.theme.bluePath : this.theme.redPath;
      const alpha = bat.team === this.team ? 0.8 : 0.3;

      this.gfx.setStrokeStyle({ width: 2, color, alpha });
      this.gfx.moveTo(center.x, center.y);
      for (const wp of bat.waypoints) {
        this.gfx.lineTo(wp.x, wp.y);
      }
      this.gfx.stroke();

      // Draw small circle at end of path
      const last = bat.waypoints[bat.waypoints.length - 1];
      this.gfx.circle(last.x, last.y, 4);
      this.gfx.fill({ color, alpha });

      // Formation circle preview at endpoint (sized to actual formation)
      const formRadius = bat.formationOffsets.reduce((max, o) => {
        const d = Math.sqrt(o.x * o.x + o.y * o.y);
        return d > max ? d : max;
      }, 0) + 4;
      this.gfx.circle(last.x, last.y, formRadius);
      this.gfx.setStrokeStyle({ width: 1, color, alpha: alpha * 0.3 });
      this.gfx.stroke();

      // Tick marks at 1-second intervals + time label
      const fullPath: Vec2[] = [center, ...bat.waypoints];
      const pathLen = polylineLength(fullPath);
      const travelTime = pathLen / speed;
      const tickAlpha = alpha * 0.5;
      const tickDist = speed; // 1 second of travel
      for (let d = tickDist; d < pathLen; d += tickDist) {
        const { pos: tp, angle: ta } = pointAtDistance(fullPath, d);
        const nx = Math.cos(ta + Math.PI / 2) * 4;
        const ny = Math.sin(ta + Math.PI / 2) * 4;
        this.gfx.setStrokeStyle({ width: 1, color, alpha: tickAlpha });
        this.gfx.moveTo(tp.x - nx, tp.y - ny);
        this.gfx.lineTo(tp.x + nx, tp.y + ny);
        this.gfx.stroke();
      }

      const overLimit = travelTime > ROUND_DURATION_S;
      const timeLabel = this.acquireLabel();
      timeLabel.text = overLimit ? `${travelTime.toFixed(1)}s!` : `${travelTime.toFixed(1)}s`;
      timeLabel.style.fill = overLimit ? this.theme.labelWarn : this.theme.labelFill;
      timeLabel.position.set(last.x, last.y - 12);
      timeLabel.alpha = alpha;
    }

    // Draw in-progress raw line (thicker + brighter than finalized paths)
    if (this.selectedBattalion && this.rawPoints.length > 1) {
      const color = this.team === 'blue' ? this.theme.bluePathBright : this.theme.redPathBright;
      const batAlive = this.units.filter(u => this.selectedBattalion!.unitIds.includes(u.id) && u.alive);
      const speed = batAlive[0]?.speed ?? 80;

      this.gfx.setStrokeStyle({ width: 4, color, alpha: 1.0 });
      this.gfx.moveTo(this.rawPoints[0].x, this.rawPoints[0].y);
      for (let i = 1; i < this.rawPoints.length; i++) {
        this.gfx.lineTo(this.rawPoints[i].x, this.rawPoints[i].y);
      }
      this.gfx.stroke();

      // Tick marks + live time label for in-progress path
      const rawLen = polylineLength(this.rawPoints);
      const rawTime = rawLen / speed;
      const tickDist = speed;
      for (let d = tickDist; d < rawLen; d += tickDist) {
        const { pos: tp, angle: ta } = pointAtDistance(this.rawPoints, d);
        const nx = Math.cos(ta + Math.PI / 2) * 5;
        const ny = Math.sin(ta + Math.PI / 2) * 5;
        this.gfx.setStrokeStyle({ width: 1.5, color, alpha: 0.8 });
        this.gfx.moveTo(tp.x - nx, tp.y - ny);
        this.gfx.lineTo(tp.x + nx, tp.y + ny);
        this.gfx.stroke();
      }

      const endpoint = this.rawPoints[this.rawPoints.length - 1];
      this.onZoneHighlight?.(endpoint);
      const rawOverLimit = rawTime > ROUND_DURATION_S;
      const liveLabel = this.acquireLabel();
      liveLabel.text = rawOverLimit ? `${rawTime.toFixed(1)}s!` : `${rawTime.toFixed(1)}s`;
      liveLabel.style.fill = rawOverLimit ? this.theme.labelWarn : this.theme.labelFill;
      liveLabel.position.set(endpoint.x, endpoint.y - 12);
      liveLabel.alpha = 1.0;

      // Formation circle preview at endpoint (sized to actual formation)
      const drawFormRadius = this.selectedBattalion!.formationOffsets.reduce((max, o) => {
        const d = Math.sqrt(o.x * o.x + o.y * o.y);
        return d > max ? d : max;
      }, 0) + 4;
      this.gfx.circle(endpoint.x, endpoint.y, drawFormRadius);
      this.gfx.setStrokeStyle({ width: 1.5, color, alpha: 0.4 });
      this.gfx.stroke();
    } else {
      this.onZoneHighlight?.(null);
    }

    // Hide unused pool labels
    for (let i = this.labelIndex; i < this.labelPool.length; i++) {
      this.labelPool[i].visible = false;
    }

    this.renderHoverLayer();
  }

  private renderHoverLayer(): void {
    this.hoverGfx.clear();
    this.hoverLabel.visible = false;
    if (!this.enabled || !this.team) return;

    const teamColor = this.team === 'blue' ? this.theme.bluePath : this.theme.redPath;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);

    // Draw indicators for each own-team battalion
    for (const bat of this.battalions) {
      if (bat.team !== this.team) continue;
      if (bat === this.selectedBattalion) continue;

      const alive = this.units.filter(u => bat.unitIds.includes(u.id) && u.alive);
      if (alive.length === 0) continue;

      const center = updateBattalionCenter(bat, this.units);

      if (bat.waypoints.length > 0) {
        // Battalions WITH paths: ring at center
        this.hoverGfx.circle(center.x, center.y, 20);
        this.hoverGfx.setStrokeStyle({ width: 1.5, color: teamColor, alpha: 0.4 });
        this.hoverGfx.stroke();
      } else {
        // Battalions WITHOUT paths: pulsing ring
        const pulseRadius = 20 + pulse * 6;
        this.hoverGfx.circle(center.x, center.y, pulseRadius);
        this.hoverGfx.setStrokeStyle({ width: 2, color: teamColor, alpha: 0.3 + pulse * 0.4 });
        this.hoverGfx.stroke();
      }
    }

    // Selection highlight: ring around all members of selected battalion
    if (this.selectedBattalion) {
      const alive = this.units.filter(u => this.selectedBattalion!.unitIds.includes(u.id) && u.alive);
      for (const u of alive) {
        this.hoverGfx.circle(u.pos.x, u.pos.y, u.radius + 3);
        this.hoverGfx.setStrokeStyle({ width: 1.5, color: teamColor, alpha: 0.6 });
        this.hoverGfx.stroke();
      }
      return; // Don't show hover when drawing
    }

    // Hover highlight on nearest own-team battalion
    if (this.hoveredBattalion) {
      const alive = this.units.filter(u => this.hoveredBattalion!.unitIds.includes(u.id) && u.alive);
      for (const u of alive) {
        this.hoverGfx.circle(u.pos.x, u.pos.y, u.radius + 2);
        this.hoverGfx.setStrokeStyle({ width: 1, color: teamColor, alpha: 0.4 });
        this.hoverGfx.stroke();
      }

      const center = updateBattalionCenter(this.hoveredBattalion, this.units);

      // Highlight path + time label on hover
      if (this.hoveredBattalion.waypoints.length > 0) {
        const brightColor = this.team === 'blue' ? this.theme.bluePathBright : this.theme.redPathBright;
        this.hoverGfx.setStrokeStyle({ width: 3, color: brightColor, alpha: 1.0 });
        this.hoverGfx.moveTo(center.x, center.y);
        for (const wp of this.hoveredBattalion.waypoints) {
          this.hoverGfx.lineTo(wp.x, wp.y);
        }
        this.hoverGfx.stroke();

        const last = this.hoveredBattalion.waypoints[this.hoveredBattalion.waypoints.length - 1];
        this.hoverGfx.circle(last.x, last.y, 5);
        this.hoverGfx.fill({ color: brightColor, alpha: 1.0 });

        const speed = alive[0]?.speed ?? 80;
        const fullPath: Vec2[] = [center, ...this.hoveredBattalion.waypoints];
        const pathLen = polylineLength(fullPath);
        const travelTime = pathLen / speed;
        const overLimit = travelTime > ROUND_DURATION_S;
        this.hoverLabel.text = overLimit ? `${travelTime.toFixed(1)}s!` : `${travelTime.toFixed(1)}s`;
        this.hoverLabel.style.fill = overLimit ? this.theme.labelWarn : this.theme.hoverLabelFill;
        this.hoverLabel.position.set(last.x, last.y - 12);
        this.hoverLabel.visible = true;
      }

      // Range circle at path endpoint for archer battalions
      if (this.hoveredBattalion.type === 'archer') {
        const hoverPos = this.hoveredBattalion.waypoints.length > 0
          ? this.hoveredBattalion.waypoints[this.hoveredBattalion.waypoints.length - 1]
          : center;
        this.drawRangeCircle(alive[0], hoverPos, teamColor);
      }
    }

    // Enemy battalion preview
    if (this.hoveredEnemyBattalion && !this.selectedBattalion) {
      const bat = this.hoveredEnemyBattalion;
      const alive = this.units.filter(u => bat.unitIds.includes(u.id) && u.alive);
      if (alive.length > 0) {
        const enemyColor = bat.team === 'red' ? this.theme.redPath : this.theme.bluePath;
        const center = updateBattalionCenter(bat, this.units);

        for (const u of alive) {
          this.hoverGfx.circle(u.pos.x, u.pos.y, u.radius + 2);
          this.hoverGfx.setStrokeStyle({ width: 1, color: enemyColor, alpha: 0.3 });
          this.hoverGfx.stroke();
        }

        if (bat.waypoints.length > 0) {
          this.hoverGfx.setStrokeStyle({ width: 2, color: enemyColor, alpha: 0.5 });
          this.hoverGfx.moveTo(center.x, center.y);
          for (const wp of bat.waypoints) {
            this.hoverGfx.lineTo(wp.x, wp.y);
          }
          this.hoverGfx.stroke();
        }
      }
    }
  }

  /** Call each frame to animate pulsing indicators during planning. */
  updateHover(): void {
    if (this.enabled) this.renderHoverLayer();
  }

  private drawRangeCircle(unit: Unit, pos: Vec2, color: number): void {
    const level = getElevationLevel(pos, this.elevationZones);
    const elevated = level > 0;
    const range = unit.range * (1 + ELEVATION_RANGE_BONUS * level);
    const ringColor = elevated ? this.theme.elevationBonus : color;

    if (elevated) {
      for (const z of this.elevationZones) {
        if (pos.x >= z.x && pos.x <= z.x + z.w && pos.y >= z.y && pos.y <= z.y + z.h) {
          this.hoverGfx.roundRect(z.x, z.y, z.w, z.h, 6);
          this.hoverGfx.setStrokeStyle({ width: 1.5, color: this.theme.elevationBonus, alpha: 0.4 });
          this.hoverGfx.stroke();
        }
      }
    }

    this.hoverGfx.circle(pos.x, pos.y, range + unit.radius);
    this.hoverGfx.setStrokeStyle({ width: 1, color: ringColor, alpha: 0.2 });
    this.hoverGfx.stroke();
    this.hoverGfx.circle(pos.x, pos.y, range + unit.radius);
    this.hoverGfx.fill({ color: ringColor, alpha: 0.03 });
  }

  clearGraphics(): void {
    this.gfx.clear();
    this.hoverGfx.clear();
    for (const label of this.labelPool) label.visible = false;
  }

  destroy(): void {
    this.stage.off('pointerdown', this.onPointerDown);
    this.stage.off('pointermove', this.onPointerMove);
    this.stage.off('pointerup', this.onPointerUp);
    this.stage.off('pointerupoutside', this.onPointerUp);
    this.stage.off('rightdown', this.onRightDown);
    if (this.canvas) {
      this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    }
    this.stage.removeChild(this.gfx);
    this.stage.removeChild(this.hoverGfx);
    this.stage.removeChild(this.labelContainer);
    this.stage.removeChild(this.hoverLabel);
    this.gfx.destroy();
    this.hoverGfx.destroy();
    this.labelContainer.destroy();
    this.hoverLabel.destroy();
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private findNearestOwnUnit(px: number, py: number): Unit | null {
    if (!this.team) return null;
    let closest: Unit | null = null;
    let closestDist = UNIT_SELECT_RADIUS;

    for (const unit of this.units) {
      if (!unit.alive || unit.team !== this.team) continue;
      const dist = distancePt(unit.pos, { x: px, y: py });
      if (dist < closestDist) {
        closest = unit;
        closestDist = dist;
      }
    }
    return closest;
  }

  private findNearestEnemyUnit(px: number, py: number): Unit | null {
    if (!this.team) return null;
    let closest: Unit | null = null;
    let closestDist = UNIT_SELECT_RADIUS;

    for (const unit of this.units) {
      if (!unit.alive || unit.team === this.team) continue;
      const dist = distancePt(unit.pos, { x: px, y: py });
      if (dist < closestDist) {
        closest = unit;
        closestDist = dist;
      }
    }
    return closest;
  }

  private onPointerDown = (e: { global: { x: number; y: number }; button?: number }): void => {
    if (!this.enabled || !this.team) return;
    // Ignore right clicks for path drawing
    if (e.button === 2) return;

    // Find nearest own unit → look up parent battalion
    const closest = this.findNearestOwnUnit(e.global.x, e.global.y);
    if (closest) {
      const bat = findBattalionForUnit(closest.id, this.battalions);
      if (bat) {
        this.hoveredEnemyBattalion = null;
        this.selectedBattalion = bat;
        bat.waypoints = [];
        bat.moveTarget = null;
        const center = updateBattalionCenter(bat, this.units);
        this.rawPoints = [{ x: center.x, y: center.y }];
        this.renderPaths();
        return;
      }
    }

    // Tap on enemy → show their battalion
    const enemy = this.findNearestEnemyUnit(e.global.x, e.global.y);
    if (enemy) {
      this.hoveredEnemyBattalion = findBattalionForUnit(enemy.id, this.battalions);
    } else {
      this.hoveredEnemyBattalion = null;
    }
    this.renderHoverLayer();
  };

  private onPointerMove = (e: { global: { x: number; y: number } }): void => {
    if (!this.enabled) return;

    // Update hover state
    if (!this.selectedBattalion) {
      const prev = this.hoveredBattalion;
      const nearUnit = this.findNearestOwnUnit(e.global.x, e.global.y);
      this.hoveredBattalion = nearUnit ? findBattalionForUnit(nearUnit.id, this.battalions) : null;

      const prevEnemy = this.hoveredEnemyBattalion;
      if (!this.hoveredBattalion) {
        const enemyUnit = this.findNearestEnemyUnit(e.global.x, e.global.y);
        this.hoveredEnemyBattalion = enemyUnit ? findBattalionForUnit(enemyUnit.id, this.battalions) : null;
      } else {
        this.hoveredEnemyBattalion = null;
      }
      if (this.hoveredBattalion !== prev || this.hoveredEnemyBattalion !== prevEnemy) this.renderHoverLayer();
    }

    // Drawing mode
    if (this.selectedBattalion) {
      this.rawPoints.push({ x: e.global.x, y: e.global.y });
      this.renderPaths();
    }
  };

  private onPointerUp = (): void => {
    if (!this.enabled || !this.selectedBattalion) return;

    const waypoints = samplePath(this.rawPoints, PATH_SAMPLE_DISTANCE);
    // Skip the first point (battalion center position)
    this.selectedBattalion.waypoints = waypoints.slice(1);

    this.selectedBattalion = null;
    this.rawPoints = [];
    this.renderPaths();
  };

  private onRightDown = (e: { global: { x: number; y: number } }): void => {
    if (!this.enabled || !this.team) return;

    const unit = this.findNearestOwnUnit(e.global.x, e.global.y);
    if (unit) {
      const bat = findBattalionForUnit(unit.id, this.battalions);
      if (bat) {
        bat.waypoints = [];
        bat.moveTarget = null;
        this.renderPaths();
      }
    }
  };
}
