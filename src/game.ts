import { Unit, Battalion, Obstacle, Team, BattleResult, Projectile, TurnPhase, ElevationZone, ReplayFrame, ReplayEvent, ReplayData } from './types';
import { ROUND_DURATION_S, COVER_SCREEN_DURATION_MS, MAP_WIDTH, MAP_HEIGHT, BATTALION_SIZE, ARMY_COMPOSITION } from './constants';
import { moveUnit, separateUnits, findTarget, isInRange, hasLineOfSight, tryFireProjectile, updateProjectiles, advanceWaypoint, updateGunAngle, detourWaypoints, segmentHitsRect, meleeAoeAttack } from './units';
import { generateObstacles, generateElevationZones } from './battlefield';
import { PathDrawer } from './path-drawer';
import { Renderer } from './renderer';
import { scorePosition, generateCandidates } from './ai-scoring';
import { createArmyBattalions, advanceBattalionWaypoint, assignUnitTargets, updateBattalionCenter } from './battalion';

export type GameEventCallback = (
  event: 'update' | 'end' | 'phase-change',
  data?: BattleResult | { phase: TurnPhase; timeLeft?: number; round?: number },
) => void;

export class GameEngine {
  private units: Unit[] = [];
  private battalions: Battalion[] = [];
  private obstacles: Obstacle[] = [];
  private elevationZones: ElevationZone[] = [];
  private projectiles: Projectile[] = [];
  private renderer: Renderer;
  private running = false;
  private speedMultiplier = 1;
  private elapsedTime = 0;
  private roundTimer = 0;
  private onEvent: GameEventCallback;
  private pathDrawer: PathDrawer | null = null;
  private _phase: TurnPhase = 'blue-planning';
  private roundNumber = 1;
  private aiMode = false;
  private idleTime = 0;
  private endingBattle = false;
  private endDelayTimer = 0;
  private pendingWinner: Team | null = null;
  private replayFrames: ReplayFrame[] = [];
  private replayEvents: ReplayEvent[] = [];

  constructor(renderer: Renderer, onEvent: GameEventCallback, opts?: {
    aiMode?: boolean;
  }) {
    this.renderer = renderer;
    this.onEvent = onEvent;
    this.aiMode = opts?.aiMode ?? false;
  }

  get phase(): TurnPhase {
    return this._phase;
  }

  startBattle(): void {
    this.obstacles = generateObstacles();
    this.elevationZones = generateElevationZones();

    // Create battalions + units for both teams
    const blue = createArmyBattalions('blue');
    const red = createArmyBattalions('red');
    this.battalions = [...blue.battalions, ...red.battalions];
    this.units = [...blue.units, ...red.units];

    this.projectiles = [];
    this.elapsedTime = 0;
    this.roundTimer = 0;
    this.running = true;

    this.pathDrawer = new PathDrawer(this.renderer.stage, this.renderer.canvas, (pos) => this.renderer.highlightZonesAt(pos));
    this.pathDrawer.theme = this.renderer.currentTheme;

    // Render initial state — hills under obstacles
    this.renderer.renderElevationZones(this.elevationZones);
    this.renderer.renderObstacles(this.obstacles);
    this.renderer.renderUnits(this.units);

    // Start ticker for rendering during planning
    this.renderer.ticker.add(this.tick, this);

    this.setPhase('blue-planning');
  }

  private coverTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Called by the UI "Done" button to end the current planning phase. */
  confirmPlan(): void {
    if (this._phase === 'blue-planning') {
      this.setPhase('cover');
      // In AI mode, setPhase('cover') already transitions to playing
      if (!this.aiMode) {
        this.coverTimeout = setTimeout(() => {
          this.skipCover();
        }, COVER_SCREEN_DURATION_MS);
      }
    } else if (this._phase === 'red-planning') {
      this.setPhase('playing');
    }
  }

  /** Skip the cover screen early (e.g. on tap). */
  skipCover(): void {
    if (this._phase !== 'cover') return;
    if (this.coverTimeout) {
      clearTimeout(this.coverTimeout);
      this.coverTimeout = null;
    }
    this.setPhase('red-planning');
  }

  private setPhase(phase: TurnPhase): void {
    this._phase = phase;

    if (phase === 'blue-planning') {
      this.clearBattalionPaths('blue');
      this.pathDrawer?.enable('blue', this.units, this.battalions, this.elevationZones);
    } else if (phase === 'cover') {
      this.pathDrawer?.disable();
      if (this.aiMode) {
        // Skip cover screen, generate AI paths, go straight to playing
        this.generateAiPaths();
        this.onEvent('phase-change', { phase, round: this.roundNumber });
        this.setPhase('playing');
        return;
      }
    } else if (phase === 'red-planning') {
      this.clearBattalionPaths('red');
      this.pathDrawer?.enable('red', this.units, this.battalions, this.elevationZones);
    } else if (phase === 'playing') {
      this.pathDrawer?.disable();
      this.pathDrawer?.clearGraphics();
      this.roundTimer = ROUND_DURATION_S;
      this.idleTime = 0;
      this.renderer.effects?.addRoundStartFlash(MAP_WIDTH, MAP_HEIGHT);
    }

    this.onEvent('phase-change', { phase, round: this.roundNumber });
  }

  /** Clear all battalion waypoints for a team. */
  private clearBattalionPaths(team: Team): void {
    for (const bat of this.battalions) {
      if (bat.team === team) {
        bat.waypoints = [];
        bat.moveTarget = null;
      }
    }
    // Also clear individual unit targets
    for (const unit of this.units) {
      if (unit.team === team && unit.alive) {
        unit.waypoints = [];
        unit.moveTarget = null;
      }
    }
  }

  /** Generate AI paths for red battalions using position-scoring system. */
  private generateAiPaths(): void {
    const allBlockers = this.obstacles;
    const redBattalions = this.battalions.filter(b => b.team === 'red');
    const enemies = this.units.filter(u => u.alive && u.team === 'blue');

    // Generate candidates once using a representative unit
    const repUnit = this.units.find(u => u.alive && u.team === 'red');
    const candidates = generateCandidates(
      repUnit ?? { pos: { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 }, speed: 100, radius: 10 } as Unit,
      this.obstacles,
      this.elevationZones,
    );

    for (const bat of redBattalions) {
      const center = updateBattalionCenter(bat, this.units);
      const batUnit = {
        pos: center,
        speed: this.units.find(u => u.id === bat.unitIds[0])?.speed ?? 80,
        radius: 4,
        type: bat.type,
      } as Unit;

      const padding = batUnit.radius + 8;

      // Score each candidate
      const scored: { pos: typeof center; score: number }[] = [];
      for (const candidate of candidates) {
        const s = scorePosition({
          candidate,
          unit: batUnit,
          enemies,
          obstacles: this.obstacles,
          elevationZones: this.elevationZones,
        });
        scored.push({ pos: candidate, score: s });
      }
      scored.sort((a, b) => b.score - a.score);

      // Pick the best reachable candidate
      let bestWaypoints: typeof bat.waypoints = [];
      for (const { pos: candidate, score } of scored) {
        if (score === -Infinity) break;
        const detours = detourWaypoints(center, candidate, allBlockers, padding);
        const chain = [...detours, candidate];

        let pathClear = true;
        let prev = center;
        for (const wp of chain) {
          if (allBlockers.some(o => segmentHitsRect(prev, wp, o, padding))) {
            pathClear = false;
            break;
          }
          prev = wp;
        }

        if (pathClear) {
          bestWaypoints = chain;
          break;
        }
      }

      bat.waypoints = bestWaypoints.length > 0 ? bestWaypoints : [center];
    }
  }

  private tick = (ticker: { deltaMS: number }): void => {
    if (!this.running) return;

    const rawDt = ticker.deltaMS / 1000;
    const dt = this._phase === 'playing' ? rawDt * this.speedMultiplier : rawDt;

    // Always render units (even during planning, need dt for death fade)
    this.renderer.renderUnits(this.units, dt);

    // Animate pulsing indicators during planning
    this.pathDrawer?.updateHover();

    if (this._phase !== 'playing') return;

    // During end delay, only animate effects and dying units (no combat/movement)
    if (this.endingBattle) {
      this.endDelayTimer -= dt;
      this.renderer.effects?.update(dt);
      if (this.endDelayTimer <= 0) {
        this.endBattle(this.pendingWinner!);
      }
      return;
    }

    this.elapsedTime += dt;
    this.roundTimer -= dt;

    // Battalion layer: advance waypoints and assign unit targets
    for (const bat of this.battalions) {
      advanceBattalionWaypoint(bat, this.units);
      assignUnitTargets(bat, this.units, this.units);
    }

    // Archers pause to fire: halt only when cooldown is nearly ready, then resume
    for (const unit of this.units) {
      if (!unit.alive || unit.type !== 'archer') continue;
      if (unit.fireTimer > 0.3) continue; // still reloading, keep moving
      const target = findTarget(unit, this.units, null, this.obstacles);
      if (target && isInRange(unit, target, this.elevationZones)
        && hasLineOfSight(unit.pos, target.pos, this.obstacles, unit.projectileRadius)) {
        unit.moveTarget = null;
      }
    }

    // Move individual units
    for (const unit of this.units) {
      if (!unit.alive) continue;
      moveUnit(unit, dt, this.obstacles, this.units);
    }
    separateUnits(this.units, this.obstacles);

    // Combat — auto-target nearest enemy
    for (const unit of this.units) {
      if (!unit.alive) continue;

      const target = findTarget(unit, this.units, null, this.obstacles);

      // Melee units (swordsman, cavalry, pikeman) use AoE attack
      if (unit.type !== 'archer') {
        // Cavalry heading is set by moveUnit — never override it here
        if (unit.type !== 'cavalry') {
          // Only face enemy when in melee range; otherwise face movement direction
          const inMeleeRange = target && (() => {
            const dx = target.pos.x - unit.pos.x;
            const dy = target.pos.y - unit.pos.y;
            return Math.sqrt(dx * dx + dy * dy) <= unit.range + target.radius + unit.radius;
          })();
          if (inMeleeRange && target) {
            const desired = Math.atan2(target.pos.y - unit.pos.y, target.pos.x - unit.pos.x);
            updateGunAngle(unit, desired, dt);
          } else {
            const speed = Math.sqrt(unit.vel.x * unit.vel.x + unit.vel.y * unit.vel.y);
            if (speed > 1) {
              updateGunAngle(unit, Math.atan2(unit.vel.y, unit.vel.x), dt);
            }
          }
        }
        const aoeHits = meleeAoeAttack(unit, this.units, dt);
        for (const hit of aoeHits) {
          this.replayEvents.push({
            frame: this.replayFrames.length,
            type: hit.killed ? 'kill' : 'hit',
            pos: hit.pos,
            angle: unit.gunAngle,
            damage: hit.damage,
            flanked: false,
            team: hit.team,
            targetId: hit.targetId,
          });

          const mfx = this.renderer.effects;
          const victimTeam: Team = hit.team === 'blue' ? 'red' : 'blue';
          mfx?.addBloodSpray(hit.pos, unit.gunAngle, victimTeam, hit.damage);
          if (hit.killed) {
            mfx?.addBloodBurst(hit.pos, unit.gunAngle, victimTeam, hit.damage);
          }
        }
        continue;
      }

      // Archer fires projectiles
      const canShoot = target
        && isInRange(unit, target, this.elevationZones)
        && hasLineOfSight(unit.pos, target.pos, this.obstacles, unit.projectileRadius);
      if (canShoot) {
        const desired = Math.atan2(target.pos.y - unit.pos.y, target.pos.x - unit.pos.x);
        updateGunAngle(unit, desired, dt);
        const projectiles = tryFireProjectile(unit, target, dt, this.elevationZones);
        if (projectiles.length > 0) {
          this.projectiles.push(...projectiles);
          this.renderer.effects?.addMuzzleFlash(unit.pos, unit.gunAngle, unit.radius);
          this.replayEvents.push({
            frame: this.replayFrames.length,
            type: 'fire',
            pos: { x: unit.pos.x, y: unit.pos.y },
            angle: unit.gunAngle,
            damage: projectiles[0].damage,
            flanked: false,
            team: unit.team,
          });
        }
      } else {
        unit.fireTimer = Math.max(0, unit.fireTimer - dt);
        // Face movement direction, not enemy
        const speed = Math.sqrt(unit.vel.x * unit.vel.x + unit.vel.y * unit.vel.y);
        if (speed > 1) {
          updateGunAngle(unit, Math.atan2(unit.vel.y, unit.vel.x), dt);
        }
      }
    }

    // Volley sync: archers in the same battalion fire in clusters.
    // If any archer just fired (timer near fireCooldown), nudge others to fire soon.
    for (const bat of this.battalions) {
      if (bat.type !== 'archer') continue;
      const archers = this.units.filter(u => u.alive && bat.unitIds.includes(u.id));
      const justFired = archers.some(u => u.fireTimer > u.fireCooldown - dt * 2);
      if (justFired) {
        for (const u of archers) {
          if (u.fireTimer > 0 && u.fireTimer < u.fireCooldown * 0.5) {
            u.fireTimer = Math.min(u.fireTimer, 0.05);
          }
        }
      }
    }

    const { alive: aliveProjectiles, hits } = updateProjectiles(this.projectiles, this.units, dt, this.obstacles);
    this.projectiles = aliveProjectiles;

    // Trigger effects for hits + record replay events
    const fx = this.renderer.effects;
    for (const hit of hits) {
      const unitGfx = this.renderer.getUnitContainer(hit.targetId);
      if (unitGfx) fx?.addHitFlash(unitGfx);

      this.replayEvents.push({
        frame: this.replayFrames.length,
        type: hit.killed ? 'kill' : 'hit',
        pos: { ...hit.pos },
        angle: hit.angle,
        damage: hit.damage,
        flanked: hit.flanked,
        team: hit.team,
        targetId: hit.targetId,
      });

      const victimTeam: Team = hit.team === 'blue' ? 'red' : 'blue';
      const effectDamage = hit.flanked ? hit.damage * 1.5 : hit.damage;
      fx?.addBloodSpray(hit.pos, hit.angle, victimTeam, effectDamage);
      if (hit.killed) {
        fx?.addBloodBurst(hit.pos, hit.angle, victimTeam, effectDamage);
      }
    }

    // Update battalion centers
    for (const bat of this.battalions) {
      updateBattalionCenter(bat, this.units);
    }

    // Record replay frame after all state updates
    this.recordFrame();

    this.renderer.renderProjectiles(this.projectiles);

    // Update effects
    this.renderer.effects?.update(dt);

    // HUD update with time left
    this.onEvent('update', { phase: 'playing', timeLeft: Math.max(0, this.roundTimer) });

    // Win condition — elimination
    const blueAlive = this.units.filter(u => u.alive && u.team === 'blue').length;
    const redAlive = this.units.filter(u => u.alive && u.team === 'red').length;

    if (blueAlive === 0 || redAlive === 0) {
      this.endingBattle = true;
      this.endDelayTimer = 0.6;
      this.pendingWinner = blueAlive === 0 ? 'red' : 'blue';
      this.projectiles = [];
      this.renderer.renderProjectiles([]);
      return;
    }

    // Check if action is complete — no movement, no combat, no projectiles
    const idle = this.projectiles.length === 0 && this.units.every(u => {
      if (!u.alive) return true;
      // Use actual velocity — moveTarget can be stuck on obstacles
      const speed = u.vel.x * u.vel.x + u.vel.y * u.vel.y;
      if (speed > 1 || u.waypoints.length > 0) return false;
      const target = findTarget(u, this.units, null, this.obstacles);
      return !target || !isInRange(u, target, this.elevationZones);
    });

    // Also check if any battalion still has waypoints
    const battalionsMoving = this.battalions.some(b =>
      b.moveTarget !== null || b.waypoints.length > 0,
    );

    // Require sustained idle for 0.5s to avoid transient false positives
    this.idleTime = (idle && !battalionsMoving) ? this.idleTime + dt : 0;

    // Round over → back to planning
    if (this.roundTimer <= 0 || this.idleTime >= 0.5) {
      this.projectiles = [];
      this.renderer.renderProjectiles([]);
      this.roundNumber++;
      this.setPhase('blue-planning');
    }
  };

  private recordFrame(): void {
    const frame: ReplayFrame = {
      units: this.units.map(u => ({
        id: u.id,
        type: u.type,
        team: u.team,
        x: u.pos.x,
        y: u.pos.y,
        vx: u.vel.x,
        vy: u.vel.y,
        gunAngle: u.gunAngle,
        hp: u.hp,
        maxHp: u.maxHp,
        alive: u.alive,
        radius: u.radius,
      })),
      projectiles: this.projectiles.map(p => ({
        x: p.pos.x,
        y: p.pos.y,
        vx: p.vel.x,
        vy: p.vel.y,
        damage: p.damage,
        radius: p.radius,
        team: p.team,
        maxRange: p.maxRange,
        distanceTraveled: p.distanceTraveled,
        trail: p.trail ? p.trail.map(t => ({ ...t })) : undefined,
        arc: p.arc,
        launchX: p.launchPos?.x,
        launchY: p.launchPos?.y,
        totalFlightDist: p.totalFlightDist,
      })),
    };

    this.replayFrames.push(frame);
  }

  getReplayData(): ReplayData | null {
    if (this.replayFrames.length === 0) return null;
    return {
      frames: this.replayFrames,
      events: this.replayEvents,
      obstacles: this.obstacles,
      elevationZones: this.elevationZones,
    };
  }

  private endBattle(winner: Team): void {
    this.running = false;
    this.renderer.ticker.remove(this.tick, this);
    this.projectiles = [];
    this.renderer.renderProjectiles([]);
    this.pathDrawer?.disable();
    this.pathDrawer?.clearGraphics();
    this.renderer.effects?.clear();

    const blueAlive = this.units.filter(u => u.alive && u.team === 'blue').length;
    const redAlive = this.units.filter(u => u.alive && u.team === 'red').length;
    const totalPerSide = ARMY_COMPOSITION.reduce((s, c) => s + c.count, 0) * BATTALION_SIZE;

    this.onEvent('end', {
      winner,
      blueAlive,
      redAlive,
      blueKilled: totalPerSide - redAlive,
      redKilled: totalPerSide - blueAlive,
      duration: this.elapsedTime,
    });
  }

  setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  getAliveCount(): { blue: number; red: number } {
    return {
      blue: this.units.filter(u => u.alive && u.team === 'blue').length,
      red: this.units.filter(u => u.alive && u.team === 'red').length,
    };
  }

  getTotalPerSide(): number {
    return ARMY_COMPOSITION.reduce((s, c) => s + c.count, 0) * BATTALION_SIZE;
  }

  getUnits(): Unit[] {
    return this.units;
  }

  getBattalions(): Battalion[] {
    return this.battalions;
  }

  getMapData(): { obstacles: Obstacle[]; elevationZones: ElevationZone[] } {
    return { obstacles: this.obstacles, elevationZones: this.elevationZones };
  }

  stop(): void {
    this.running = false;
    this.renderer.ticker.remove(this.tick, this);
    this.pathDrawer?.destroy();
    this.pathDrawer = null;
    this.renderer.effects?.clear();
  }
}
