import { describe, it, expect } from 'vitest';
import { ChargeSim, attackSide, wedgeSlots, BattalionSpec, SimEvent } from './sim';
import { CHARGE as C } from './config';
import { createBattleSpecs, createSquadSpecs } from './scenario';

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;

function block(over: Partial<BattalionSpec> = {}): BattalionSpec {
  return { team: 'red', type: 'swordsman', role: 'front', x: 600, y: 600, facing: DOWN, count: 24, cols: 8, ...over };
}

/** One galloping rider aimed straight through a battalion. */
function chargeThrough(heading: number, startX: number, startY: number, spec: BattalionSpec, seconds = 1.2) {
  const sim = new ChargeSim([spec], { seed: 7, squad: { x: startX, y: startY, facing: heading, count: 1 } });
  sim.leader!.speed = C.GALLOP_SPEED;
  const input = { dirX: Math.cos(heading), dirY: Math.sin(heading), gallop: true };
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.step(1 / 60, input);
    events.push(...sim.events);
  }
  return { sim, events };
}

describe('attackSide', () => {
  it('classifies head-on, side and rear attacks', () => {
    expect(attackSide(UP, DOWN)).toBe('front');
    expect(attackSide(0, DOWN)).toBe('flank');
    expect(attackSide(DOWN, DOWN)).toBe('rear');
  });
});

describe('wedgeSlots', () => {
  it('places every follower behind the leader', () => {
    const slots = wedgeSlots(11);
    expect(slots).toHaveLength(11);
    for (const s of slots) expect(s.x).toBeLessThan(0);
  });
});

describe('cavalry charge', () => {
  it('a charge into the rear kills more than one into the front', () => {
    // Red faces down, so riding down from above hits the rear.
    const rear = chargeThrough(DOWN, 600, 480, block());
    const front = chargeThrough(UP, 600, 720, block());
    const rearKills = rear.events.filter(e => e.type === 'kill').length;
    const frontKills = front.events.filter(e => e.type === 'kill').length;
    expect(rearKills).toBeGreaterThan(frontKills);
    expect(rear.events.some(e => e.type === 'impact' && e.side === 'rear')).toBe(true);
  });

  it('flank and rear kills score more points', () => {
    const rear = chargeThrough(DOWN, 600, 480, block());
    const kill = rear.events.find(e => e.type === 'kill' && e.byPlayer);
    expect(kill && kill.type === 'kill' && kill.points).toBeGreaterThanOrEqual(C.KILL_SCORE * C.REAR_MULT);
  });

  it('braced pikes hurt riders that charge them head-on', () => {
    const { events } = chargeThrough(UP, 600, 720, block({ type: 'pikeman' }));
    expect(events.some(e => e.type === 'impact' && e.pike)).toBe(true);
    expect(events.some(e => e.type === 'rider-hit')).toBe(true);
  });

  it('pikes hit from behind cannot brace', () => {
    const { events } = chargeThrough(DOWN, 600, 480, block({ type: 'pikeman' }));
    expect(events.some(e => e.type === 'impact' && e.pike)).toBe(false);
  });

  it('a stalled rider is cut down in the crowd', () => {
    const sim = new ChargeSim([block({ count: 40, cols: 8 })], { seed: 3, squad: { x: 600, y: 600, facing: 0, count: 1 } });
    for (let t = 0; t < 30 && sim.leader; t += 1 / 60) sim.step(1 / 60);
    expect(sim.leader).toBeNull();
    expect(sim.outcome).toBe('defeat');
  });
});

describe('squadron', () => {
  it('the next rider takes command when the leader falls', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 300, y: 300, facing: 0, count: 3 } });
    const [first, second] = sim.riders;
    first.hp = 1;
    // A rider-hit routed through a stray arrow.
    sim.arrows.push({ sx: 0, sy: 0, tx: first.x, ty: first.y, t: 1, flight: 1, team: 'red', volley: 0 });
    sim.step(1 / 60);
    expect(sim.leader).toBe(second);
    expect(sim.events.some(e => e.type === 'rider-down' && e.wasLeader)).toBe(true);
  });

  it('can gallop for as long as you like', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 300, y: 300, facing: 0, count: 1 }, muster: false });
    for (let t = 0; t < 8; t += 1 / 60) sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: true });
    expect(sim.leader!.speed).toBeGreaterThan(C.GALLOP_SPEED * 0.95);
  });

  it('turns more tightly at a canter than at a gallop', () => {
    const turned = (gallop: boolean) => {
      const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 700, facing: 0, count: 1 } });
      sim.leader!.speed = gallop ? C.GALLOP_SPEED : C.CANTER_SPEED * 0.6;
      sim.step(0.2, { dirX: 0, dirY: 1, gallop });
      return sim.leader!.facing;
    };
    expect(turned(false)).toBeGreaterThan(turned(true));
  });

  it('riding into a camp heals every rider at once', () => {
    const camp = C.CAMPS[1];
    const sim = new ChargeSim([], { seed: 1, squad: { x: camp.x - 140, y: camp.y - 60, facing: 0, count: 6 } });
    for (const r of sim.riders) r.hp = 5;
    let pit = false;
    for (let t = 0; t < 1.5 && !sim.inCamp; t += 1 / 60) {
      sim.step(1 / 60, { dirX: 1, dirY: 0.4, gallop: false });
      if (sim.events.some(e => e.type === 'pit-stop')) pit = true;
    }
    expect(pit).toBe(true);
    for (const r of sim.riders) expect(r.hp).toBe(r.maxHp);
  });

  it('camp garrisons fill up while you are away; ride through to take the whole troop', () => {
    const camp = C.CAMPS[1];
    // Distant battalions keep the battle undecided (garrisons stop growing once it's won).
    const sim = new ChargeSim([block({ x: 1200, y: 100 }), block({ team: 'blue', x: 1200, y: 700, facing: UP })], { seed: 1, squad: { x: 300, y: 300, facing: 0, count: 4 } });
    const garrison = () => sim.squadrons.find(sq => sq.ai === 'garrison' && Math.hypot(sq.home.x - camp.x, sq.home.y - camp.y) < 1)!;
    expect(garrison().riders).toHaveLength(C.GARRISON_START);
    for (let t = 0; t < C.GARRISON_INTERVAL * 3 + 0.1; t += 1 / 30) sim.step(1 / 30);
    expect(garrison().riders).toHaveLength(C.GARRISON_START + 3);
    // Gallop straight through the camp without stopping.
    const L = sim.leader!;
    L.x = camp.x - 120; L.y = camp.y;
    for (const r of sim.riders) { r.x = L.x - 10; r.y = L.y; }
    (sim as unknown as { resetTrail: (sq: unknown, x: number, y: number, f: number) => void }).resetTrail(sim.player, L.x, L.y, 0);
    for (let t = 0; t < 1.6; t += 1 / 60) sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: true });
    expect(sim.riders.length).toBe(4 + C.GARRISON_START + 3);
    expect(sim.leader!.x).toBeGreaterThan(camp.x + 60); // never had to stop
  });
});

describe('archers', () => {
  it('loose volleys at the squadron, leading a moving target', () => {
    const archers = block({ type: 'archer', role: 'archer', x: 600, y: 300, count: 20, cols: 10 });
    archers.facing = DOWN;
    const sim = new ChargeSim([archers], { seed: 2, squad: { x: 400, y: 600, facing: 0, count: 1 } });
    sim.battalions[0].volleyTimer = 0;
    sim.leader!.speed = C.CANTER_SPEED;
    sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: false });
    const volley = sim.events.find(e => e.type === 'volley');
    expect(volley && volley.type === 'volley' && volley.atPlayer).toBe(true);
    // Aim point lies ahead (to the right) of the rider.
    expect(volley && volley.type === 'volley' && volley.x).toBeGreaterThan(sim.leader!.x);
    expect(sim.arrows.length).toBe(20);
  });

  it('arrows only land after their flight time', () => {
    const archers = block({ type: 'archer', role: 'archer', x: 600, y: 300, count: 10, cols: 10 });
    const sim = new ChargeSim([archers], { seed: 2, squad: { x: 600, y: 600, facing: 0, count: 1 } });
    sim.battalions[0].volleyTimer = 0;
    sim.step(1 / 60);
    const flight = sim.arrows[0].flight;
    let landed = 0;
    let t = 1 / 60;
    while (t < flight - 0.05) { sim.step(1 / 60); t += 1 / 60; landed += sim.events.filter(e => e.type === 'arrow-land').length; }
    expect(landed).toBe(0);
    for (let i = 0; i < 30; i++) { sim.step(1 / 60); landed += sim.events.filter(e => e.type === 'arrow-land').length; }
    expect(landed).toBe(10);
  });
});

describe('morale', () => {
  it('a broken battalion routs and panics its neighbours', () => {
    const sim = new ChargeSim([block(), block({ x: 720 })], { seed: 1, squad: null });
    sim.battalions[0].morale = -1;
    sim.step(1 / 60);
    expect(sim.battalions[0].routed).toBe(true);
    expect(sim.battalions[1].morale).toBeLessThanOrEqual(100 - C.ROUT_CASCADE);
    expect(sim.events.some(e => e.type === 'rout')).toBe(true);
  });

  it('routed soldiers flee toward their own side of the field', () => {
    const sim = new ChargeSim([block()], { seed: 1, squad: null });
    const startY = sim.soldiers[0].y;
    sim.battalions[0].morale = -1;
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60);
    expect(sim.soldiers.every(s => s.fleeing)).toBe(true);
    expect(sim.soldiers[0].y).toBeLessThan(startY);
  });

  it('victory once every red battalion has broken', () => {
    const sim = new ChargeSim([block(), block({ team: 'blue', y: 900, facing: UP })], { seed: 1, squad: null });
    sim.battalions[0].morale = -1;
    sim.step(1 / 60);
    expect(sim.outcome).toBe('victory');
  });
});

describe('battle scenario', () => {
  it('the blue line slowly loses without the squadron', () => {
    const sim = new ChargeSim(createBattleSpecs(), { seed: 1, squad: null });
    for (let t = 0; t < 90; t += 1 / 30) sim.step(1 / 30);
    // Still fighting after a minute and a half...
    expect(sim.outcome).toBe('playing');
    expect(sim.blueLineStanding).toBeLessThan(sim.blueLineInitial);
    for (let t = 0; t < 400 && sim.outcome === 'playing'; t += 1 / 30) sim.step(1 / 30);
    // ...but eventually it breaks.
    expect(sim.outcome).toBe('defeat');
  }, 30000); // simulates several minutes of battle
});

describe('one giant battle', () => {
  it('the whole army is on the field from the start, hunters waiting to ride', () => {
    const sim = new ChargeSim(createBattleSpecs(), { seed: 1, squads: createSquadSpecs() });
    expect(sim.pendingWaves).toHaveLength(0);
    expect(sim.redStanding).toBe(sim.initialRed);
    const hunters = sim.squadrons.find(sq => sq.ai === 'hunter')!;
    expect(hunters.phase).toBe('muster');
    let hunted = false;
    for (let t = 0; t < 75 && !hunted; t += 1 / 30) {
      sim.step(1 / 30, { dirX: 0, dirY: 0, gallop: false });
      if (sim.events.some(e => e.type === 'hunt')) hunted = true;
    }
    expect(hunted).toBe(true);
  }, 30000);
});

describe('reinforcements', () => {
  it('waves arrive on schedule and count toward the enemy army', () => {
    const waves = [{ time: 10, specs: [block({ x: 300, y: 40 }), block({ x: 600, y: 40 })], squads: [{ team: 'red' as const, ai: 'hunter' as const, x: 400, y: 30, facing: DOWN, count: 5 }] }];
    const sim = new ChargeSim([block()], { seed: 1, squad: null, waves });
    const total = sim.initialRed;
    expect(total).toBe(24 * 3 + 5);
    expect(sim.battalions).toHaveLength(1);
    let arrived = false;
    for (let t = 0; t < waves[0].time + 0.1; t += 1 / 30) {
      sim.step(1 / 30);
      if (sim.events.some(e => e.type === 'wave')) arrived = true;
    }
    expect(arrived).toBe(true);
    expect(sim.battalions.length).toBe(3);
    expect(sim.initialRed).toBe(total);
  });

  it('no victory while reinforcements are still coming', () => {
    const sim = new ChargeSim([block(), block({ team: 'blue', y: 900, facing: UP })], {
      seed: 1, squad: null, waves: [{ time: 30, specs: [block({ x: 300, y: 40 })] }],
    });
    sim.battalions[0].morale = -1;
    sim.step(1 / 60);
    expect(sim.battalions[0].routed).toBe(true);
    expect(sim.outcome).toBe('playing');
  });
});

describe('cavalry squadrons', () => {
  it('riding into an allied troop takes it under command', () => {
    const sim = new ChargeSim([], {
      seed: 1, squad: { x: 500, y: 500, facing: 0, count: 5 }, muster: false,
      squads: [{ team: 'blue', ai: 'raider', x: 560, y: 500, facing: 0, count: 6, muster: 30 }],
    });
    for (let t = 0; t < 1.5 && sim.riders.length < 11; t += 1 / 60) sim.step(1 / 60, { dirX: 1, dirY: 0, gallop: false });
    expect(sim.riders.length).toBe(11);
    expect(sim.ridersJoined).toBe(6);
    expect(sim.squadrons).toHaveLength(1);
  });

  it('never grows beyond the command limit', () => {
    const sim = new ChargeSim([], {
      seed: 1, squad: { x: 500, y: 500, facing: 0, count: C.MAX_SQUAD - 2 }, muster: false,
      squads: [{ team: 'blue', ai: 'raider', x: 520, y: 500, facing: 0, count: 6, muster: 30 }],
    });
    sim.step(1 / 60);
    expect(sim.riders.length).toBe(C.MAX_SQUAD);
    expect(sim.squadrons.find(sq => sq !== sim.player)!.riders).toHaveLength(4);
  });

  it('fresh allied troops muster at the camp', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 1500, y: 300, facing: 0, count: 3 } });
    let mustered = false;
    for (let t = 0; t < C.MUSTER_FIRST + 0.1; t += 1 / 30) {
      sim.step(1 / 30);
      if (sim.events.some(e => e.type === 'muster')) mustered = true;
    }
    expect(mustered).toBe(true);
    const troop = sim.squadrons.find(sq => sq !== sim.player && sq.ai !== 'garrison')!;
    expect(troop.riders).toHaveLength(C.MUSTER_SIZE);
    expect(Math.hypot(troop.riders[0].x - C.CAMPS[0].x, troop.riders[0].y - C.CAMPS[0].y)).toBeLessThan(C.CAMP_R);
  });

  it('allied raiders charge enemy battalions on their own', () => {
    const sim = new ChargeSim([block({ type: 'archer', role: 'archer', count: 20, cols: 10 })], {
      seed: 4, squad: null, muster: false,
      squads: [{ team: 'blue', ai: 'raider', x: 600, y: 1000, facing: UP, count: 8 }],
    });
    let impacts = 0;
    for (let t = 0; t < 20; t += 1 / 30) {
      sim.step(1 / 30);
      impacts += sim.events.filter(e => e.type === 'impact').length;
    }
    expect(impacts).toBeGreaterThan(5);
  });

  it('hunting knights ride for your banner and clash horse against horse', () => {
    const sim = new ChargeSim([block({ x: 2100, y: 200 })], {
      seed: 1, squad: { x: 600, y: 900, facing: UP, count: 6 }, muster: false,
      squads: [{ team: 'red', ai: 'hunter', x: 600, y: 300, facing: DOWN, count: 6 }],
    });
    let riderDowns = 0;
    let closest = Infinity;
    for (let t = 0; t < 8; t += 1 / 60) {
      sim.step(1 / 60, { dirX: 0, dirY: -1, gallop: true });
      riderDowns += sim.events.filter(e => e.type === 'rider-down').length;
      const k = sim.squadrons.find(sq => sq.team === 'red')?.riders[0];
      if (k && sim.leader) closest = Math.min(closest, Math.hypot(k.x - sim.leader.x, k.y - sim.leader.y));
    }
    // They rode right at us and the squadrons met.
    expect(closest).toBeLessThan(30);
    expect(riderDowns).toBeGreaterThan(0);
  });

  it('killing knights scores double', () => {
    const sim = new ChargeSim([block({ x: 2100, y: 200 })], {
      seed: 1, squad: { x: 600, y: 700, facing: UP, count: 1 }, muster: false,
      squads: [{ team: 'red', ai: 'guard', x: 600, y: 600, facing: DOWN, count: 3 }],
    });
    for (const k of sim.squadrons[1].riders) k.hp = 1;
    sim.leader!.speed = C.GALLOP_SPEED;
    let points = 0;
    for (let t = 0; t < 1 && points === 0; t += 1 / 60) {
      sim.step(1 / 60, { dirX: 0, dirY: -1, gallop: true });
      for (const e of sim.events) if (e.type === 'rider-down' && e.byPlayer) points = e.points;
    }
    expect(points).toBeGreaterThanOrEqual(C.KILL_SCORE * C.KNIGHT_SCORE_MULT);
  });

  it('broken knights flee the field and count as beaten', () => {
    const sim = new ChargeSim([block({ team: 'blue', y: 1000, facing: UP })], {
      seed: 1, squad: null, muster: false,
      squads: [{ team: 'red', ai: 'hunter', x: 600, y: 120, facing: DOWN, count: C.AI_RETREAT_AT }],
    });
    expect(sim.outcome).toBe('playing');
    for (let t = 0; t < 10 && sim.outcome === 'playing'; t += 1 / 30) sim.step(1 / 30);
    expect(sim.squadrons.some(sq => sq.team === 'red')).toBe(false);
    expect(sim.outcome).toBe('victory');
  });
});

describe('fighting animation signal', () => {
  it('soldiers in contact keep swinging, hit or miss', () => {
    const sim = new ChargeSim([block({ y: 600 }), block({ team: 'blue', y: 640, facing: UP })], { seed: 2, squad: null });
    for (let t = 0; t < 4; t += 1 / 30) sim.step(1 / 30);
    const swung = sim.soldiers.filter(s => s.lastAttack > 0).length;
    // The front ranks (8 per side) should all be trading blows.
    expect(swung).toBeGreaterThanOrEqual(12);
    // Far more swings than hits — misses are animated too.
    expect(swung).toBeGreaterThan(sim.soldiers.filter(s => s.hp < s.maxHp).length);
  });
});

describe('weapon aim', () => {
  it('soldiers note the direction of the nearest enemy, and ignore distant ones', () => {
    const sim = new ChargeSim([block({ x: 600, y: 600 })], { seed: 1, squad: { x: 600, y: 655, facing: UP, count: 1 }, muster: false });
    sim.step(1 / 60);
    const front = sim.soldiers.filter(s => !s.rider).sort((a, b) => b.y - a.y)[0];
    // The rider is below (south of) the battalion.
    expect(front.aim).toBeGreaterThan(0.5);
    expect(front.aim).toBeLessThan(Math.PI - 0.5);
    const far = new ChargeSim([block({ x: 600, y: 600 })], { seed: 1, squad: { x: 600, y: 1200, facing: UP, count: 1 }, muster: false });
    far.step(1 / 60);
    expect(far.soldiers.filter(s => !s.rider).every(s => Number.isNaN(s.aim))).toBe(true);
  });
});

describe('field edges', () => {
  const ride = (sim: ChargeSim, heading: number, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, { dirX: Math.cos(heading), dirY: Math.sin(heading), gallop: true });
  };

  it('riding into an edge at an angle runs along it at full pace', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 120, facing: UP, count: 12 }, muster: false });
    ride(sim, UP + 0.25, 3);
    expect(sim.leader!.speed).toBeGreaterThan(C.GALLOP_SPEED * 0.9);
    expect(sim.leader!.x).toBeGreaterThan(1500);
  });

  it('riding straight at an edge wheels along it, and turning back leaves it', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 1200, y: 150, facing: UP, count: 12 }, muster: false });
    ride(sim, UP, 2);
    expect(sim.leader!.speed).toBeGreaterThan(C.CANTER_SPEED);
    ride(sim, DOWN, 1.5);
    expect(sim.leader!.y).toBeGreaterThan(150);
  });

  it('a squadron driven into a corner rides out again', () => {
    const sim = new ChargeSim([], { seed: 1, squad: { x: 150, y: 150, facing: -Math.PI * 0.75, count: 12 }, muster: false });
    ride(sim, -Math.PI * 0.75, 2.5); // into the top-left corner
    ride(sim, Math.PI / 4, 2); // back out toward the field
    expect(sim.leader!.x).toBeGreaterThan(200);
    expect(sim.leader!.y).toBeGreaterThan(200);
    // The whole squadron follows, nobody left pinned in the corner.
    for (const r of sim.riders) expect(Math.min(r.x, r.y)).toBeGreaterThan(40);
  });
});

describe('army morale', () => {
  const run = (sim: ChargeSim, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) sim.step(1 / 30); };

  it('a wavering army slowly loses heart instead of recovering', () => {
    const reds = [0, 1, 2, 3, 4, 5].map(i => block({ x: 200 + i * 150 }));
    const sim = new ChargeSim([...reds, block({ team: 'blue', y: 1300, facing: UP })], { seed: 1, squad: null });
    for (const b of sim.battalions.slice(0, 4)) b.morale = -1;
    sim.step(1 / 30);
    sim.step(1 / 30);
    // Two thirds of the army gone: morale low enough to waver.
    expect(sim.armyMorale('red')).toBeLessThan(C.ARMY_WAVER);
    const before = sim.battalions[4].morale;
    run(sim, 3);
    expect(sim.battalions[4].morale).toBeLessThan(before - 2);
    expect(sim.outcome).toBe('playing');
  });

  it('when morale runs out the red army collapses battalion by battalion — then it is won', () => {
    const reds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => block({ x: 150 + i * 100 }));
    const sim = new ChargeSim([...reds, block({ team: 'blue', y: 1300, facing: UP })], { seed: 1, squad: null });
    for (const b of sim.battalions.slice(0, 8)) b.morale = -1; // 80%
    sim.step(1 / 30);
    sim.step(1 / 30);
    expect(sim.armyBroken.red).toBe(true);
    // Not an instant switch: the last battalions are still standing for a few seconds...
    expect(sim.outcome).toBe('playing');
    expect(sim.battalions.filter(b => b.team === 'red' && !b.routed).length).toBe(2);
    run(sim, C.ARMY_COLLAPSE_MIN + 1);
    const mid = sim.battalions.filter(b => b.team === 'red' && !b.routed).length;
    expect(mid).toBe(1);
    // ...then the collapse runs its course and the day is won.
    run(sim, C.ARMY_COLLAPSE_TIME + 1);
    expect(sim.battalions.filter(b => b.team === 'red').every(b => b.routed)).toBe(true);
    expect(sim.outcome).toBe('victory');
  });

  it('our army collapsing is a defeat', () => {
    const blues = [0, 1, 2, 3, 4].map(i => block({ team: 'blue', x: 300 + i * 150, y: 1300, facing: UP }));
    const sim = new ChargeSim([block(), ...blues], { seed: 1, squad: null });
    // Four of five battalions (80%) gone: the last one gives up too.
    for (const b of sim.battalions.filter(b => b.team === 'blue').slice(0, 4)) b.morale = -1;
    let broke = false;
    for (let t = 0; t < C.ARMY_COLLAPSE_TIME + 3 && sim.outcome === 'playing'; t += 1 / 30) {
      sim.step(1 / 30);
      for (const e of sim.events) if (e.type === 'army-break' && e.team === 'blue') broke = true;
    }
    expect(broke).toBe(true);
    expect(sim.outcome).toBe('defeat');
  });
});

describe('the red general', () => {
  const general = (x: number, y: number) => ({ team: 'red' as const, ai: 'general' as const, x, y, facing: DOWN, count: 1 });

  it('cutting him down shakes every red battalion and the army', () => {
    const sim = new ChargeSim([block(), block({ x: 900 }), block({ team: 'blue', y: 900, facing: UP })], {
      seed: 1, squad: null, squads: [general(600, 200)],
    });
    const G = sim.general!;
    expect(G.hp).toBe(C.GENERAL_HP);
    const before = sim.battalions.map(b => b.morale);
    const lossBefore = sim.armyLoss.red;
    (sim as unknown as { damageRider: (r: unknown, d: number, a: number, p: boolean, s: string) => void })
      .damageRider(G, 999, 0, true, 'rear');
    sim.step(1 / 60);
    expect(sim.general).toBeNull();
    expect(sim.generalFallen).toBe(true);
    expect(sim.score).toBeGreaterThanOrEqual(C.GENERAL_SCORE);
    expect(sim.battalions[0].morale).toBeLessThanOrEqual(before[0] - C.GENERAL_MORALE_SHOCK + 1);
    expect(sim.armyLoss.red).toBeCloseTo(lossBefore + C.GENERAL_ARMY_SHOCK, 2);
  });

  it('rides away from enemy horsemen, but a galloping squadron can run him down', () => {
    const sim = new ChargeSim([block({ y: 900 })], {
      seed: 1, squad: { x: 600, y: 500, facing: UP, count: 1 }, muster: false, squads: [general(600, 330)],
    });
    for (let t = 0; t < 1.5; t += 1 / 60) sim.step(1 / 60, { dirX: 0, dirY: 0, gallop: false });
    const G = sim.general!;
    // He has started riding off, away from the squadron.
    expect(G.y).toBeLessThan(330);
    expect(G.speed).toBeGreaterThan(40);
    expect(G.speed).toBeLessThan(C.GALLOP_SPEED * 0.8);
  });

  it('his bodyguard only rides out at horsemen close to him', () => {
    const sim = new ChargeSim([block({ y: 900 })], {
      seed: 1, squad: { x: 600, y: 600, facing: 0, count: 1 }, muster: false,
      squads: [{ team: 'red', ai: 'guard', x: 600, y: 300, facing: DOWN, count: 4, guardRadius: 170 }],
    });
    const guard = sim.squadrons.find(sq => sq.ai === 'guard')!;
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60, { dirX: 0, dirY: 0, gallop: false });
    // 300 away: outside his radius, so the guard stays at its post.
    expect(Math.hypot(guard.riders[0].x - 600, guard.riders[0].y - 300)).toBeLessThan(30);
  });
});

describe('review fixes', () => {
  it('no army keeps losing heart once the battle is decided', () => {
    const blues = [0, 1, 2, 3, 4].map(i => block({ team: 'blue', x: 300 + i * 150, y: 1300, facing: UP }));
    const sim = new ChargeSim([block({ x: 2000, y: 200 }), ...blues], { seed: 1, squad: null });
    // Blue badly hurt (wavering, draining) — then red breaks: victory.
    for (const b of sim.battalions.filter(b => b.team === 'blue').slice(0, 3)) b.morale = -1;
    sim.step(1 / 30); sim.step(1 / 30);
    sim.battalions[0].morale = -1;
    sim.step(1 / 30);
    expect(sim.outcome).toBe('victory');
    const before = sim.battalions.filter(b => b.team === 'blue' && !b.routed).map(b => b.morale);
    for (let t = 0; t < 20; t += 1 / 30) sim.step(1 / 30);
    const after = sim.battalions.filter(b => b.team === 'blue' && !b.routed).map(b => b.morale);
    after.forEach((m, i) => expect(m).toBeGreaterThanOrEqual(before[i]));
  });

  it("the general's bodyguard rides with him", () => {
    const sim = new ChargeSim([block({ y: 900 })], {
      seed: 1, squad: { x: 300, y: 300, facing: 0, count: 1 }, muster: false,
      squads: [
        { team: 'red', ai: 'general', x: 600, y: 300, facing: DOWN, count: 1 },
        { team: 'red', ai: 'guard', ward: 'general', x: 600, y: 330, facing: DOWN, count: 4, guardRadius: 170 },
      ],
    });
    const general = sim.squadrons.find(sq => sq.ai === 'general')!;
    const guard = sim.squadrons.find(sq => sq.ai === 'guard')!;
    // Move the general's post far away: he rides there, and his escort must follow.
    general.home.x = 1300;
    for (let t = 0; t < 8; t += 1 / 60) sim.step(1 / 60, { dirX: 0, dirY: 0, gallop: false });
    const G = sim.general!;
    expect(G.x).toBeGreaterThan(1150);
    expect(Math.hypot(guard.riders[0].x - G.x, guard.riders[0].y - G.y)).toBeLessThan(120);
  });

  it('weaving along a camp ring does not heal again and again', () => {
    const camp = C.CAMPS[1];
    const sim = new ChargeSim([], { seed: 1, squad: { x: camp.x - C.CAMP_R - 20, y: camp.y, facing: 0, count: 3 }, muster: false });
    let pits = 0;
    const L = () => sim.leader!;
    for (let i = 0; i < 4; i++) {
      // In just past the edge, then out just past it again.
      L().x = camp.x - C.CAMP_R + 5; sim.step(1 / 60);
      pits += sim.events.filter(e => e.type === 'pit-stop').length;
      L().x = camp.x - C.CAMP_R - 10; sim.step(1 / 60);
      pits += sim.events.filter(e => e.type === 'pit-stop').length;
    }
    expect(pits).toBe(1);
  });
});
