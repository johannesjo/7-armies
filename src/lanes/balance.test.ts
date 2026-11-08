import { describe, it } from 'vitest';
import { LaneSim } from './sim';

/**
 * Whole matches for tuning: LANES_BALANCE=1 npx vitest run src/lanes/balance.test.ts
 * (slow, so skipped otherwise). Logs tower falls, commander deaths and levels.
 */
describe.skipIf(!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LANES_BALANCE)('lanes balance', () => {
  function run(label: string, sim: LaneSim, maxT: number) {
    const log: string[] = [];
    while (sim.outcome === 'playing' && sim.time < maxT) {
      sim.step(1 / 60);
      for (const e of sim.laneEvents) {
        if (e.type === 'tower-down' || e.type === 'hero-down') log.push(`${sim.time.toFixed(0)}s ${e.type} ${e.team}`);
        if (e.type === 'level' && e.level % 3 === 0) log.push(`${sim.time.toFixed(0)}s ${e.team} L${e.level}`);
      }
    }
    console.log(`== ${label}: ${sim.outcome} winner=${sim.winner} t=${sim.time.toFixed(0)}\n${log.join('\n')}`);
  }
  it('rival against a commander who stays home', () => run('vs passive', new LaneSim({ seed: 7 }), 25 * 60), 900000);
  it('AI against AI', () => run('AI vs AI', new LaneSim({ seed: 3, human: false }), 25 * 60), 900000);
});
