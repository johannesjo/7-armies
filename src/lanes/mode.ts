import { Application } from 'pixi.js';
import { Theme } from '../theme';
import { CHARGE as C } from '../charge/config';
import type { ChargeRenderer } from '../charge/view3d';
import { CommanderMode, CommanderResult, hex } from '../commanders/mode';
import { CommanderSim } from '../commanders/sim';
import { CommanderView } from '../commanders/view';
import { LANES as L } from './config';
import { WOODS } from './map';
import { LaneEvent, LaneSim } from './sim';
import { LaneView } from './view';

export type LaneResult = CommanderResult;

/** The lanes mode: break their keep at the end of three lanes. */
export class LaneMode extends CommanderMode {
  protected override readonly modeName: string = 'lanes';
  private hackedOnce = false;

  protected newSim(seed: number): CommanderSim {
    this.hackedOnce = false;
    return new LaneSim({ seed, commander: this.commander });
  }

  protected override async createView(app: Application, theme: Theme): Promise<ChargeRenderer> {
    return new LaneView(app, theme);
  }

  protected introBanner(): string {
    return 'Break their keep!';
  }

  protected override viewEvents(view: CommanderView, sim: CommanderSim, events: readonly { type: string }[]): void {
    (view as LaneView).laneEvents(sim as LaneSim, events as LaneEvent[]);
  }

  protected override modeEvent(_sim: CommanderSim, ev: { type: string }): void {
    const e = ev as LaneEvent;
    switch (e.type) {
      case 'tower-down':
        if (e.kind === 'tower') this.banner(e.team === 'red' ? 'Enemy tower destroyed!' : 'We lost a tower', 2400, true);
        this.triggerHitStop(0.3, 0.4);
        break;
      case 'late-game':
        this.banner('Siege engines arrive — the walls crumble faster', 3000, true);
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
    }
  }

  protected hudExtra(cs: CommanderSim): void {
    const sim = cs as LaneSim;
    const keepHp = (team: 'blue' | 'red') => {
      const k = sim.structures.find(s => s.kind === 'keep' && s.team === team)!;
      return Math.max(0, k.hp / k.maxHp);
    };
    this.redBar.style.width = `${keepHp('red') * 100}%`;
    this.blueBar.style.width = `${keepHp('blue') * 100}%`;
    this.wallHints(sim);
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

  protected resultExtra(cs: CommanderSim): Partial<CommanderResult> & { mode: 'lanes' } {
    return { mode: 'lanes', towers: (cs as LaneSim).towersDown.blue };
  }

  protected override minimapGround(ctx: CanvasRenderingContext2D, sx: number, sy: number, dpr: number): void {
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
  }

  protected override minimapMarks(ctx: CanvasRenderingContext2D, sx: number, sy: number, dpr: number, cs: CommanderSim): void {
    const theme = this.theme!;
    for (const st of (cs as LaneSim).structures) {
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
  }
}
