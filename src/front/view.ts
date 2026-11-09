import { Application, Graphics } from 'pixi.js';
import { Theme } from '../theme';
import { FieldLayout, mixColor } from '../charge/view';
import { CommanderView } from '../commanders/view';
import { FRONT as F } from './config';
import { FrontEvent, FrontSim } from './sim';

export const FRONT_FIELD: FieldLayout = { w: F.WORLD_W, h: F.WORLD_H, woods: [], battle: false, key: 'front' };

/** The front's rendering: the commanders' renderer on the battle's field, with each commander's camp. */
export class FrontView extends CommanderView {
  constructor(app: Application, theme: Theme) {
    super(app, theme, FRONT_FIELD);
  }

  /** Bare earth: the churned ground where the lines meet, and the commanders' yards. */
  protected override earthAt(x: number, y: number): number {
    const cx = F.WORLD_W / 2;
    const xFade = Math.max(0, 1 - Math.max(0, Math.abs(x - cx) - 650) / 200);
    let e = Math.max(0, 1 - Math.abs(y - F.FRONT_Y) / 110) * xFade;
    for (const team of ['blue', 'red'] as const) {
      const h = F.HOME[team];
      const d = Math.hypot(x - h.x, y - h.y);
      if (d < 200) e = Math.max(e, 1 - Math.max(0, d - 110) / 90);
    }
    return e;
  }

  /** Each commander's camp behind his army, with the ring where his riders heal. */
  protected override drawCamps(g: Graphics, rand: () => number): void {
    if (!this.theme.grass) {
      const mud = mixColor(this.theme.bg, this.theme.obstacleBorder, 0.16);
      for (let i = 0; i < 40; i++) {
        g.ellipse(F.WORLD_W / 2 + (rand() - 0.5) * 1300, F.FRONT_Y + (rand() - 0.5) * 90, 40 + rand() * 70, 14 + rand() * 20).fill({ color: mud, alpha: 0.18 });
      }
    }
    for (const team of ['blue', 'red'] as const) this.drawHomeRing(g, F.HOME[team].x, F.HOME[team].y, team, rand);
  }

  /** Popups and effects for the front's own moments. */
  frontEvents(sim: FrontSim, events: readonly FrontEvent[]): void {
    this.commanderEvents(sim, events);
    const t = this.theme;
    for (const e of events) {
      if (e.type !== 'reinforce') continue;
      if (e.team === 'red' && this.hiddenAt('red', e.x, e.y)) continue;
      this.popup(e.x, e.y + (e.team === 'blue' ? -30 : 30), 'Reinforcements!', e.team === 'blue' ? t.blue : t.red, 16, 1.8);
    }
  }
}
