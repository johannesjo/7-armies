import { Application } from 'pixi.js';
import { Theme } from '../theme';
import { CHARGE as C } from '../charge/config';
import { SimEvent } from '../charge/sim';
import type { ChargeRenderer } from '../charge/view3d';
import { CommanderMode, CommanderResult, hex } from '../commanders/mode';
import { CommanderSim } from '../commanders/sim';
import { CommanderView } from '../commanders/view';
import { FRONT as F } from './config';
import { FrontEvent, FrontSim } from './sim';
import { FrontView } from './view';

const SIDES = ['left', 'centre', 'right'];

/**
 * The front: 1v1 commanders over one great battle. Break their army's morale (and
 * ride down the rout). The HUD shows both armies' morale and who is winning each
 * sector of the line.
 */
export class FrontMode extends CommanderMode {
  protected override readonly modeName: string = 'front';
  protected override readonly pursuit: boolean = true;
  private readonly sectorEls = Array.from(document.querySelectorAll<HTMLElement>('#fr-sectors .fr-sec > div'));

  protected newSim(seed: number): CommanderSim {
    return new FrontSim({ seed, commander: this.commander });
  }

  protected override async createView(app: Application, theme: Theme): Promise<ChargeRenderer> {
    return new FrontView(app, theme);
  }

  protected introBanner(): string {
    return 'Break their army!';
  }

  protected override viewEvents(view: CommanderView, sim: CommanderSim, events: readonly { type: string }[]): void {
    (view as FrontView).frontEvents(sim as FrontSim, events as FrontEvent[]);
  }

  protected override modeEvent(sim: CommanderSim, ev: { type: string }): void {
    const e = ev as FrontEvent;
    if (e.type !== 'reinforce') return;
    if (e.team === 'blue') this.banner(`Reinforcements march to our ${SIDES[e.sector]}`, 1800);
    else if (sim.visible('blue', e.x, e.y)) this.teach('column', 'An enemy column on the march — catch it in the flank!', 25);
  }

  /** The battle's calls for help and army-wide moments, on top of the commanders' own. */
  protected override handleHudEvents(events: SimEvent[]): void {
    super.handleHudEvents(events);
    const sim = this.cmd;
    if (!sim || sim.outcome !== 'playing') return;
    for (const e of events) {
      if (e.type === 'call') {
        const where = e.side === 'centre' ? 'centre' : `${e.side} flank`;
        this.banner(e.kind === 'buckling' ? `Our ${where} is buckling!` : `Enemy breaking through — ${e.side}!`, 2600, true);
      }
      if (e.type === 'call-done') this.banner(e.kind === 'buckling' ? `The ${e.side} holds!` : 'Breakthrough stopped!', 1800);
      if (e.type === 'army-waver') this.banner(e.team === 'red' ? 'The enemy wavers — keep pressing!' : 'Our army wavers — hold the line!', 2600, true);
      if (e.type === 'army-break') this.banner(e.team === 'red' ? 'The enemy army is breaking!' : 'Our army is breaking!', 3000, true);
    }
  }

  protected hudExtra(cs: CommanderSim): void {
    const sim = cs as FrontSim;
    const red = sim.armyMorale('red'), blue = sim.armyMorale('blue');
    this.redBar.style.width = `${red * 100}%`;
    this.blueBar.style.width = `${blue * 100}%`;
    this.redBar.classList.toggle('wavering', red < C.ARMY_WAVER);
    this.blueBar.classList.toggle('wavering', blue < C.ARMY_WAVER);
    // Each sector of the line: the blue share of the fighting strength there.
    this.sectorEls.forEach((el, s) => { el.style.width = `${(sim.sectorPressure(s) + 1) * 50}%`; });
  }

  protected resultExtra(cs: CommanderSim): Partial<CommanderResult> & { mode: 'front' } {
    return { mode: 'front', routs: cs.routsByPlayer };
  }

  protected override minimapGround(ctx: CanvasRenderingContext2D, sx: number, sy: number, dpr: number): void {
    // The sectors of the front.
    ctx.strokeStyle = 'rgba(200, 170, 120, 0.3)';
    ctx.lineWidth = dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    for (const x of F.SECTOR_X) {
      ctx.beginPath();
      ctx.moveTo(x * sx, (F.FRONT_Y - 300) * sy);
      ctx.lineTo(x * sx, (F.FRONT_Y + 300) * sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  protected override minimapMarks(ctx: CanvasRenderingContext2D, sx: number, sy: number, dpr: number): void {
    const theme = this.theme!;
    for (const team of ['blue', 'red'] as const) {
      const h = F.HOME[team];
      ctx.strokeStyle = hex(team === 'blue' ? theme.blue : theme.red);
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.arc(h.x * sx, h.y * sy, 6 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
