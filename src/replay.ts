import { Renderer } from './renderer';
import { ReplayData, ReplayEvent, Unit, Projectile, Team, Vec2 } from './types';
import { FLANK_DAMAGE_MULTIPLIER } from './constants';

export type ReplayEventCallback = (event: 'frame' | 'end', data?: { time: number; duration: number }) => void;

export class ReplayPlayer {
  private renderer: Renderer;
  private data: ReplayData;
  private onEvent: ReplayEventCallback;
  private frameIndex = 0;
  private playhead = 0;
  private speed = 1;
  private paused = false;
  private running = false;
  private ended = false;
  private tickBound: (ticker: { deltaMS: number }) => void;

  constructor(renderer: Renderer, data: ReplayData, onEvent: ReplayEventCallback) {
    this.renderer = renderer;
    this.data = data;
    this.onEvent = onEvent;
    this.tickBound = this.tick.bind(this);
  }

  start(): void {
    this.renderer.clearUnits();
    this.renderer.renderProjectiles([]);
    this.renderer.renderElevationZones(this.data.elevationZones);
    this.renderer.renderObstacles(this.data.obstacles);
    this.frameIndex = 0;
    this.playhead = 0;
    this.paused = false;
    this.running = true;
    this.ended = false;
    this.renderFrame(0, 0);
    this.reportProgress();
    this.renderer.ticker.add(this.tickBound);
  }

  private tick(ticker: { deltaMS: number }): void {
    if (!this.running || this.paused) return;

    const dt = (ticker.deltaMS / 1000) * this.speed;
    const duration = this.data.frames.at(-1)?.time ?? 0;
    this.playhead = Math.min(this.playhead + dt, duration);

    while (this.frameIndex < this.data.frames.length - 1
      && this.data.frames[this.frameIndex + 1].time <= this.playhead) {
      this.frameIndex++;
      this.triggerEvents(this.frameIndex);
    }

    this.renderFrame(this.frameIndex, dt);
    this.reportProgress();

    // Update effects
    this.renderer.effects?.update(dt);

    if (this.playhead >= duration) {
      this.onEvent('end', { time: duration, duration });
      this.paused = true;
      this.ended = true;
    }
  }

  private reportProgress(): void {
    this.onEvent('frame', {
      time: this.playhead,
      duration: this.data.frames.at(-1)?.time ?? 0,
    });
  }

  private renderFrame(index: number, dt: number): void {
    const frame = this.data.frames[index];
    if (!frame) return;

    // Convert snapshots to Unit objects for the renderer
    const units: Unit[] = frame.units.map(s => ({
      id: s.id,
      type: s.type,
      team: s.team,
      pos: { x: s.x, y: s.y },
      vel: { x: s.vx, y: s.vy },
      gunAngle: s.gunAngle,
      hp: s.hp,
      maxHp: s.maxHp,
      alive: s.alive,
      radius: s.radius,
      speed: 0,
      damage: 0,
      range: 0,
      moveTarget: null,
      waypoints: [],
      attackTargetId: null,
      fireCooldown: 0,
      fireTimer: 0,
      projectileSpeed: 0,
      projectileRadius: 0,
      turnSpeed: 0,
    }));

    const projectiles: Projectile[] = frame.projectiles.map(s => ({
      pos: { x: s.x, y: s.y },
      vel: { x: s.vx, y: s.vy },
      target: { x: 0, y: 0 },
      damage: s.damage,
      radius: s.radius,
      team: s.team,
      maxRange: s.maxRange,
      distanceTraveled: s.distanceTraveled,
      trail: s.trail,
      arc: s.arc,
      launchPos: s.launchX != null && s.launchY != null ? { x: s.launchX, y: s.launchY } : undefined,
      totalFlightDist: s.totalFlightDist,
    }));

    this.renderer.renderUnits(units, dt);
    this.renderer.renderProjectiles(projectiles);
  }

  private triggerEvents(frameIndex: number): void {
    const fx = this.renderer.effects;
    if (!fx) return;

    for (const event of this.data.events) {
      if (event.frame !== frameIndex) continue;

      if (event.type === 'fire') {
        fx.addMuzzleFlash(event.pos, event.angle, 6);
      } else if (event.type === 'hit') {
        const victimTeam: Team = event.team === 'blue' ? 'red' : 'blue';
        const effectDamage = event.flanked ? event.damage * FLANK_DAMAGE_MULTIPLIER : event.damage;
        fx.addBloodSpray(event.pos, event.angle, victimTeam, effectDamage);
      } else if (event.type === 'kill') {
        const victimTeam: Team = event.team === 'blue' ? 'red' : 'blue';
        const effectDamage = event.flanked ? event.damage * FLANK_DAMAGE_MULTIPLIER : event.damage;
        fx.addBloodSpray(event.pos, event.angle, victimTeam, effectDamage);
        fx.addBloodBurst(event.pos, event.angle, victimTeam, effectDamage);
      }
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (this.ended) {
      this.restart();
      return;
    }
    this.paused = false;
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setSpeed(n: number): void {
    this.speed = n;
  }

  restart(): void {
    this.frameIndex = 0;
    this.playhead = 0;
    this.paused = false;
    this.ended = false;
    this.renderer.clearUnits();
    this.renderer.renderProjectiles([]);
    this.renderFrame(0, 0);
    this.reportProgress();
  }

  stop(): void {
    this.running = false;
    this.renderer.ticker.remove(this.tickBound);
    this.renderer.clearUnits();
    this.renderer.renderProjectiles([]);
  }
}
