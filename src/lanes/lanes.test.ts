import { describe, expect, it } from 'vitest';
import { LaneSim } from './sim';
import { LANES as L, xpToNext } from './config';
import { CARDS, CARD_IDS, baseMods, drawOffer, modsFromPicks } from './cards';
import { WOODS, inWoods, laneAt, navWaypoint, segmentHitsWoods } from './map';
import { mulberry32, NO_INPUT } from '../charge/sim';

/** Take a commander off the field for good (so tests see only what they set up). */
function bench(sim: LaneSim, team: 'blue' | 'red'): void {
  const h = sim.heroes[team];
  for (const r of h.sq.riders) r.alive = false;
  h.sq.riders = [];
  h.dead = true;
  h.respawnAt = Infinity;
}

function teleport(sim: LaneSim, team: 'blue' | 'red', x: number, y: number): void {
  // A small fixed scatter (tests stay deterministic).
  sim.heroes[team].sq.riders.forEach((r, i) => {
    r.x = x + ((i * 7) % 5 - 2) * 5; r.y = y + ((i * 3) % 5 - 2) * 5; r.vx = r.vy = r.speed = 0;
  });
}

describe('lanes map', () => {
  it('keeps the lanes clear of woods and the woods between them', () => {
    for (const y of L.LANE_Y) {
      for (let x = 0; x <= L.WORLD_W; x += 50) {
        expect(inWoods(x, y)).toBe(false);
        expect(inWoods(x, y + L.LANE_HALF - 5)).toBe(false);
      }
    }
    expect(WOODS.length).toBe(6);
    expect(inWoods(800, (L.LANE_Y[0] + L.LANE_Y[1]) / 2)).toBe(true);
    expect(inWoods(L.PASSES_X[0], (L.LANE_Y[0] + L.LANE_Y[1]) / 2)).toBe(false);
  });

  it('routes riders between lanes by a pass instead of through the trees', () => {
    const from = { x: 800, y: L.LANE_Y[0] }, to = { x: 800, y: L.LANE_Y[1] };
    expect(segmentHitsWoods(from.x, from.y, to.x, to.y)).toBe(true);
    const wp = navWaypoint(from, to);
    expect(wp).not.toEqual(to);
    expect(segmentHitsWoods(from.x, from.y, wp.x, wp.y, 14)).toBe(false);
    expect(segmentHitsWoods(wp.x, wp.y, to.x, to.y, 14)).toBe(false);
    // Along a lane the way is open.
    expect(navWaypoint({ x: 800, y: L.LANE_Y[2] }, { x: 2300, y: L.LANE_Y[2] })).toEqual({ x: 2300, y: L.LANE_Y[2] });
  });

  it('knows which lane a height belongs to', () => {
    expect(L.LANE_Y.map(y => laneAt(y))).toEqual([0, 1, 2]);
  });
});

describe('lanes cards', () => {
  it('offers three different cards and never one already maxed', () => {
    const rand = mulberry32(3);
    const picks = Array(CARDS.barding.max).fill('barding');
    for (let i = 0; i < 200; i++) {
      const offer = drawOffer(picks, rand);
      expect(offer.length).toBe(3);
      expect(new Set(offer).size).toBe(3);
      expect(offer).not.toContain('barding');
    }
  });

  it('builds a commander kit from the picks', () => {
    const m = modsFromPicks(['riders', 'riders', 'barding', 'remounts', 'remounts'], 'archers');
    expect(m.maxRiders).toBe(baseMods('archers').maxRiders + 6);
    expect(m.hp).toBeCloseTo(baseMods('archers').hp + 0.2);
    expect(m.remount).toBeCloseTo(14 * 0.7);
    for (const id of CARD_IDS) expect(CARDS[id].title.length).toBeGreaterThan(0);
  });

  it('each kind of horse is dealt its own cards', () => {
    const rand = mulberry32(9);
    const seen = { knights: new Set<string>(), archers: new Set<string>() };
    for (let i = 0; i < 300; i++) {
      for (const id of drawOffer([], rand, 'knights')) seen.knights.add(id);
      for (const id of drawOffer([], rand, 'archers')) seen.archers.add(id);
    }
    expect(seen.knights.has('lances')).toBe(true);
    expect(seen.knights.has('bows')).toBe(false);
    expect(seen.archers.has('bows')).toBe(true);
    expect(seen.archers.has('lances')).toBe(false);
    expect(seen.archers.has('joust')).toBe(false);
    expect(modsFromPicks(['bows'], 'archers').archery).toBeCloseTo(baseMods('archers').archery * 1.25);
  });
});

describe('lanes sim', () => {
  it('sends a wave down every lane for both sides', () => {
    const sim = new LaneSim({ seed: 1 });
    sim.step(1 / 60);
    for (let i = 0; i < 70; i++) sim.step(1 / 60);
    expect(sim.battalions.length).toBe(12);
    const blue = sim.battalions.filter(b => b.team === 'blue');
    const x0 = blue.map(b => b.x);
    for (let i = 0; i < 300; i++) sim.step(1 / 60, NO_INPUT);
    blue.forEach((b, i) => expect(b.x).toBeGreaterThan(x0[i] + 100));
  });

  it('towers fall in order, the keep last', () => {
    const sim = new LaneSim({ seed: 1 });
    const red = sim.structures.filter(s => s.team === 'red');
    const outer = red.find(s => s.lane === 1 && s.tier === 2)!;
    const inner = red.find(s => s.lane === 1 && s.tier === 1)!;
    const keep = red.find(s => s.kind === 'keep')!;
    expect(sim.vulnerable(outer)).toBe(true);
    expect(sim.vulnerable(inner)).toBe(false);
    expect(sim.vulnerable(keep)).toBe(false);
    outer.alive = false;
    expect(sim.vulnerable(inner)).toBe(true);
    expect(sim.vulnerable(keep)).toBe(false);
    inner.alive = false;
    expect(sim.vulnerable(keep)).toBe(true);
  });

  it('a tower shoots a commander who rides in alone, and its walls barely notice him', () => {
    const sim = new LaneSim({ seed: 2 });
    bench(sim, 'red');
    const tower = sim.structures.find(s => s.team === 'red' && s.lane === 1 && s.tier === 2)!;
    teleport(sim, 'blue', tower.x - tower.r - 20, tower.y);
    const hp0 = sim.riders.reduce((s, r) => s + r.hp, 0);
    for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60, NO_INPUT);
    const hp1 = sim.riders.reduce((s, r) => s + r.hp, 0);
    expect(hp1).toBeLessThan(hp0);
    // Alone at the walls: only the backdoor share of the damage.
    const lost = tower.maxHp - tower.hp;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(L.HERO_START * L.SIEGE_DPS_RIDER * 6 * 0.5);
  });

  it('a fallen commander rides again from his keep', () => {
    const sim = new LaneSim({ seed: 3 });
    for (const r of sim.riders) sim['damageRider'](r, 999, 0, false, 'front');
    sim.step(1 / 60);
    expect(sim.me.dead).toBe(true);
    expect(sim.laneEvents.some(e => e.type === 'hero-down' && e.team === 'blue')).toBe(true);
    const wait = sim.me.respawnAt - sim.time;
    expect(wait).toBeGreaterThan(L.RESPAWN_BASE);
    for (let i = 0; i < Math.ceil(wait * 60) + 2; i++) sim.step(1 / 60);
    expect(sim.me.dead).toBe(false);
    expect(sim.riders.length).toBe(sim.me.mods.maxRiders);
    expect(Math.hypot(sim.leader!.x - L.KEEP.blue.x, sim.leader!.y - L.KEEP.blue.y)).toBeLessThan(L.HOME_R);
  });

  it('levels up with three cards on offer; a chosen card takes effect', () => {
    const sim = new LaneSim({ seed: 4 });
    bench(sim, 'red');
    sim['gainXp'](sim.me, xpToNext(1));
    expect(sim.me.level).toBe(2);
    expect(sim.me.offers.length).toBe(1);
    const offer = sim.me.offers[0];
    expect(offer.length).toBe(3);
    // Make it Fresh Riders and take it.
    offer[0] = 'riders';
    sim.chooseCard('blue', 0);
    expect(sim.me.offers.length).toBe(0);
    expect(sim.me.mods.maxRiders).toBe(baseMods('knights').maxRiders + 3);
    expect(sim.riders.length).toBe(baseMods('knights').maxRiders + 3);
  });

  it('riders at home heal and the squadron fills back up', () => {
    const sim = new LaneSim({ seed: 5 });
    bench(sim, 'red');
    for (const r of sim.riders) r.hp = 5;
    const full = sim.me.mods.maxRiders;
    for (const r of sim.riders.slice(-4)) sim['damageRider'](r, 999, 0, false, 'front');
    expect(sim.riders.length).toBe(full - 4);
    for (let i = 0; i < 60 * 4; i++) sim.step(1 / 60, NO_INPUT);
    expect(sim.riders.length).toBe(full);
    expect(sim.riders.every(r => r.hp > 20)).toBe(true);
  });

  it('breaking their keep wins', () => {
    const sim = new LaneSim({ seed: 6 });
    const keep = sim.structures.find(s => s.kind === 'keep' && s.team === 'red')!;
    keep.alive = false;
    sim.step(1 / 60);
    expect(sim.outcome).toBe('victory');
    expect(sim.winner).toBe('blue');
  });

  it('the rival goes to work: it rides out, farms and levels', () => {
    const sim = new LaneSim({ seed: 7 });
    const k = L.KEEP.red;
    let farthest = 0;
    for (let i = 0; i < 60 * 120; i++) {
      sim.step(1 / 60, NO_INPUT);
      const R = sim.rival.sq.riders[0];
      if (R) farthest = Math.max(farthest, Math.hypot(R.x - k.x, R.y - k.y));
    }
    expect(farthest).toBeGreaterThan(1000);
    expect(sim.rival.level).toBeGreaterThanOrEqual(2);
    expect(sim.rival.picks.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});

describe('lanes commanders, abilities and fog', () => {
  it('each kind of horse plays differently', () => {
    const k = baseMods('knights'), a = baseMods('archers');
    // Knights: few, tough, heavy, crushing; archers: many, fast, fragile, shooting.
    expect(k.hp).toBeGreaterThan(a.hp * 1.8);
    expect(k.impact).toBeGreaterThan(a.impact * 3);
    expect(k.siege).toBeGreaterThan(a.siege * 2);
    expect(a.speed).toBeGreaterThan(k.speed);
    expect(a.maxRiders).toBeGreaterThan(k.maxRiders);
    expect(a.archery).toBeGreaterThan(0);
    expect(k.archery).toBe(0);
    const sim = new LaneSim({ seed: 1, commander: 'archers', rivalCommander: 'knights' });
    expect(sim.riders.length).toBe(a.maxRiders);
    expect(sim.rival.sq.riders.length).toBe(k.maxRiders);
    expect(sim.rival.sq.riders[0].maxHp).toBeCloseTo(30 * k.hp);
  });

  it('Thunder Charge boosts knights for a few seconds, then cools down', () => {
    const sim = new LaneSim({ seed: 2, commander: 'knights' });
    const base = sim.mods(sim.player);
    const speed = base.speed, impact = base.impact;
    expect(sim.useAbility('blue')).toBe(true);
    expect(sim.mods(sim.player).speed).toBeCloseTo(speed * L.THUNDER_SPEED);
    expect(sim.mods(sim.player).impact).toBeCloseTo(impact * L.THUNDER_IMPACT);
    expect(sim.useAbility('blue')).toBe(false);
    sim.step(1 / 60, NO_INPUT);
    expect(sim.laneEvents.some(e => e.type === 'ability' && e.ability === 'thunder')).toBe(true);
    for (let i = 0; i < 60 * (L.THUNDER_TIME + 0.2); i++) sim.step(1 / 60, NO_INPUT);
    expect(sim.mods(sim.player).speed).toBeCloseTo(speed);
    expect(sim.cooldown('blue')).toBeGreaterThan(0);
  });

  it('Arrow Storm needs foes in bowshot, then every rider looses at once', () => {
    const sim = new LaneSim({ seed: 3, commander: 'archers' });
    bench(sim, 'red');
    expect(sim.useAbility('blue')).toBe(false); // nobody in range at the keep
    for (let i = 0; i < 70; i++) sim.step(1 / 60, NO_INPUT);
    const foe = sim.battalions.find(x => x.team === 'red')!;
    // Ride up and let the vision catch up (it is worked out five times a second).
    for (let i = 0; i < 20; i++) { teleport(sim, 'blue', foe.x - 200, foe.y); sim.step(1 / 60, NO_INPUT); }
    sim.arrows.length = 0;
    const before = sim.arrows.filter(a => a.team === 'blue').length;
    expect(sim.useAbility('blue')).toBe(true);
    const after = sim.arrows.filter(a => a.team === 'blue').length;
    expect(after - before).toBe(sim.riders.length * L.STORM_ARROWS);
  });

  it('a card picked between steps is reported with the next step', () => {
    const sim = new LaneSim({ seed: 3 });
    sim['gainXp'](sim.me, xpToNext(1));
    sim.chooseCard('blue', 0);
    sim.step(1 / 60, NO_INPUT);
    expect(sim.laneEvents.some(e => e.type === 'card' && e.team === 'blue')).toBe(true);
  });

  it('queued level-ups never let a card pass its maximum', () => {
    const sim = new LaneSim({ seed: 1 });
    bench(sim, 'red');
    let xp = 0;
    for (let l = 1; l < 40; l++) xp += xpToNext(l);
    sim['gainXp'](sim.me, xp);
    expect(sim.me.offers.length).toBeGreaterThan(10);
    // Greedy: always take Kite Shields when offered, else the first card.
    while (sim.me.offers.length > 0) {
      const hand = sim.me.offers[0];
      const i = hand.indexOf('shields');
      sim.chooseCard('blue', i >= 0 ? i : 0);
    }
    for (const id of CARD_IDS) expect(sim.me.picks.filter(p => p === id).length).toBeLessThanOrEqual(CARDS[id].max);
  });

  it('levels never stop at a cap', () => {
    const sim = new LaneSim({ seed: 2 });
    let xp = 0;
    for (let l = 1; l < 30; l++) xp += xpToNext(l);
    sim['gainXp'](sim.me, xp);
    expect(sim.me.level).toBe(30);
  });

  it('horse archers shoot from the saddle', () => {
    const sim = new LaneSim({ seed: 4, commander: 'archers' });
    bench(sim, 'red');
    for (let i = 0; i < 70; i++) sim.step(1 / 60, NO_INPUT);
    const foe = sim.battalions.find(x => x.team === 'red')!;
    teleport(sim, 'blue', foe.x - 150, foe.y);
    let shots = 0;
    for (let i = 0; i < 120; i++) {
      sim.step(1 / 60, NO_INPUT);
      shots = Math.max(shots, sim.arrows.filter(a => a.team === 'blue' && a.volley === -1).length);
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('knights break foot by charging it; horse archers by shooting it', () => {
    /** Ride from behind a red battalion straight through it at the gallop; morale and men it cost. */
    const rearCharge = (kind: 'knights' | 'archers') => {
      const sim = new LaneSim({ seed: 8, commander: kind, fog: false });
      bench(sim, 'red');
      for (let i = 0; i < 70; i++) sim.step(1 / 60, NO_INPUT);
      const b = sim.battalions.find(x => x.team === 'red' && Math.abs(x.y - L.LANE_Y[1]) < 50 && x.type === 'swordsman')!;
      const fx = Math.cos(b.facing), fy = Math.sin(b.facing);
      teleport(sim, 'blue', b.x - fx * 260, b.y - fy * 260);
      for (const r of sim.riders) { r.facing = b.facing; r.speed = 200; r.vx = fx * 200; r.vy = fy * 200; }
      sim['resetTrail'](sim.player!, sim.leader!.x, sim.leader!.y, b.facing);
      const men0 = sim.members(b).length;
      let low = 100;
      for (let i = 0; i < 60 * 2.5; i++) {
        sim.step(1 / 60, { dirX: fx, dirY: fy, gallop: true });
        if (!b.routed) low = Math.min(low, b.morale); else low = 0;
      }
      return { moraleLost: 100 - low, menLost: men0 - sim.members(b).length };
    };
    const k = rearCharge('knights'), a = rearCharge('archers');
    expect(k.moraleLost).toBeGreaterThan(a.moraleLost * 2);
    // ...but archers wear foot down from a distance, without touching them.
    const sim = new LaneSim({ seed: 8, commander: 'archers', fog: false });
    bench(sim, 'red');
    for (let i = 0; i < 70; i++) sim.step(1 / 60, NO_INPUT);
    const b = sim.battalions.find(x => x.team === 'red' && Math.abs(x.y - L.LANE_Y[1]) < 50 && x.type === 'swordsman')!;
    let low = 100;
    for (let i = 0; i < 60 * 8; i++) {
      teleport(sim, 'blue', b.x - 200, b.y - 120);
      sim.step(1 / 60, NO_INPUT);
      low = b.routed ? 0 : Math.min(low, b.morale);
    }
    expect(100 - low).toBeGreaterThan(30);
  });

  it('nobody shoots blind into the fog: a commander hidden in the woods is left alone', () => {
    const sim = new LaneSim({ seed: 9, commander: 'archers', rivalCommander: 'knights' });
    const wood = WOODS[1];
    const hide = { x: wood.x + wood.w / 2, y: wood.y + wood.h / 2 };
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      // Rival parked in the heart of the wood; our archers just outside it, in bowshot.
      sim.rival.sq.riders.forEach((r, k) => { r.x = hide.x + (k % 3) * 8; r.y = hide.y + Math.floor(k / 3) * 8; r.vx = r.vy = r.speed = 0; });
      teleport(sim, 'blue', hide.x, wood.y + wood.h + 60);
      sim.step(1 / 60, NO_INPUT);
      for (const e of sim.events) if (e.type === 'rider-hit' && !e.mine) hits++;
    }
    expect(sim.visible('blue', hide.x, hide.y)).toBe(false);
    expect(hits).toBe(0);
  });

  it('a commander lost far from the enemy commander is no kill of his', () => {
    const sim = new LaneSim({ seed: 10 });
    // The rival is at his keep; our squadron dies by the far side of the field.
    for (const r of sim.riders) sim['damageRider'](r, 999, 0, false, 'front');
    sim.step(1 / 60, NO_INPUT);
    const down = sim.laneEvents.find(e => e.type === 'hero-down' && e.team === 'blue');
    expect(down && down.type === 'hero-down' && down.slain).toBe(false);
    expect(sim.rival.kills).toBe(0);
    expect(sim.rival.level).toBe(1);
  });

  it('Fresh Riders stops turning up once the wedge is full', () => {
    const rand = mulberry32(4);
    const picks = Array(11).fill('riders'); // archers: 12 + 33 = 45, the cap
    expect(modsFromPicks(picks, 'archers').maxRiders).toBe(L.HERO_MAX);
    for (let i = 0; i < 200; i++) expect(drawOffer(picks, rand, 'archers')).not.toContain('riders');
  });

  it('fog: you see round your own troops, not the far side of the field', () => {
    const sim = new LaneSim({ seed: 5 });
    sim.step(1 / 60);
    expect(sim.visible('blue', L.KEEP.blue.x, L.KEEP.blue.y)).toBe(true);
    expect(sim.visible('blue', L.KEEP.red.x - 300, L.KEEP.red.y)).toBe(false);
    expect(sim.visible('red', L.KEEP.red.x - 300, L.KEEP.red.y)).toBe(true);
    // The heart of a wood is hidden even right next to it.
    const wood = WOODS[1];
    expect(sim.visible('blue', wood.x + wood.w / 2, wood.y + wood.h / 2)).toBe(false);
    const off = new LaneSim({ seed: 5, fog: false });
    expect(off.visible('blue', L.KEEP.red.x, L.KEEP.red.y)).toBe(true);
  });

  it('riders hacking at a wall alone are told so', () => {
    const sim = new LaneSim({ seed: 6 });
    bench(sim, 'red');
    const tower = sim.structures.find(s => s.team === 'red' && s.lane === 1 && s.tier === 2)!;
    teleport(sim, 'blue', tower.x - tower.r - 15, tower.y);
    let alone = false;
    for (let i = 0; i < 60; i++) {
      sim.step(1 / 60, NO_INPUT);
      if (sim.laneEvents.some(e => e.type === 'siege' && e.team === 'red' && e.alone)) alone = true;
    }
    expect(alone).toBe(true);
  });
});
