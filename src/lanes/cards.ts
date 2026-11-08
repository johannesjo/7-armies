import { RiderMods } from '../charge/sim';
import { LANES as L } from './config';

/** A commander's whole kit: the squadron's multipliers plus what only commanders have. */
export interface HeroMods extends RiderMods {
  /** Riders the squadron musters to. */
  maxRiders: number;
  /** Rider hit points multiplier. */
  hp: number;
  /** Damage to towers and keeps. */
  siege: number;
  /** Hit points each rider regains per second once out of the fight. */
  regen: number;
  /** A fresh rider joins out in the field this often (s); Infinity = only at the keep. */
  remount: number;
  /** Our foot near the squadron fight this much harder (0 = no banner). */
  banner: number;
  /** Respawn time multiplier. */
  respawn: number;
}

export function baseMods(): HeroMods {
  return {
    speed: 1, turn: 1, impact: 1, shock: 1, strike: 1, arrows: 1,
    maxRiders: L.HERO_START, hp: 1, siege: 1, regen: 0, remount: Infinity, banner: 0, respawn: 1,
  };
}

export type CardId =
  | 'riders' | 'barding' | 'lances' | 'joust' | 'steeds' | 'drill' | 'terror'
  | 'hooks' | 'surgeon' | 'remounts' | 'banner' | 'shields' | 'muster';

export interface Card {
  id: CardId;
  title: string;
  text: string;
  icon: string;
  /** How often it turns up (relative). */
  weight: number;
  /** Most times it can be taken. */
  max: number;
  apply(m: HeroMods): void;
}

export const CARDS: Record<CardId, Card> = {
  riders: {
    id: 'riders', title: 'Fresh Riders', text: '+3 riders in your squadron', icon: '♞',
    weight: 3, max: 12, apply: m => { m.maxRiders = Math.min(L.HERO_MAX, m.maxRiders + 3); },
  },
  barding: {
    id: 'barding', title: 'Heavy Barding', text: 'Riders have +20% hit points', icon: '🛡',
    weight: 2, max: 4, apply: m => { m.hp += 0.2; },
  },
  lances: {
    id: 'lances', title: 'Couched Lances', text: '+25% trample damage against foot', icon: '➶',
    weight: 2, max: 4, apply: m => { m.impact += 0.25; },
  },
  joust: {
    id: 'joust', title: 'Jousting Lances', text: '+25% lance damage against horsemen', icon: '⚔',
    weight: 1.6, max: 4, apply: m => { m.strike += 0.25; },
  },
  steeds: {
    id: 'steeds', title: 'Swift Steeds', text: 'Your horses ride 6% faster', icon: '🐎',
    weight: 1.2, max: 3, apply: m => { m.speed += 0.06; },
  },
  drill: {
    id: 'drill', title: 'Cavalry Drill', text: 'The squadron wheels 12% tighter', icon: '↻',
    weight: 0.9, max: 3, apply: m => { m.turn += 0.12; },
  },
  terror: {
    id: 'terror', title: 'Terror', text: 'Your charges shake morale 40% harder', icon: '☠',
    weight: 1.3, max: 3, apply: m => { m.shock += 0.4; },
  },
  hooks: {
    id: 'hooks', title: 'Siege Hooks', text: '+60% damage to towers and keeps', icon: '🏰',
    weight: 1.1, max: 3, apply: m => { m.siege += 0.6; },
  },
  surgeon: {
    id: 'surgeon', title: 'Field Surgeon', text: 'Riders heal 1.5 hp/s out of the fight', icon: '✚',
    weight: 1, max: 3, apply: m => { m.regen += 1.5; },
  },
  remounts: {
    id: 'remounts', title: 'Remounts', text: 'Lost riders are replaced in the field', icon: '⟳',
    weight: 1.1, max: 3, apply: m => { m.remount = m.remount === Infinity ? 14 : m.remount * 0.7; },
  },
  banner: {
    id: 'banner', title: 'War Banner', text: 'Our foot near you fight 40% harder', icon: '⚑',
    weight: 0.9, max: 3, apply: m => { m.banner += 0.4; },
  },
  shields: {
    id: 'shields', title: 'Kite Shields', text: '-25% damage from arrows', icon: '⛉',
    weight: 1, max: 2, apply: m => { m.arrows *= 0.75; },
  },
  muster: {
    id: 'muster', title: 'Quick Muster', text: 'Back in the saddle 30% sooner', icon: '⌛',
    weight: 0.7, max: 2, apply: m => { m.respawn *= 0.7; },
  },
};

export const CARD_IDS = Object.keys(CARDS) as CardId[];

/** A commander's kit from the cards picked so far. */
export function modsFromPicks(picks: readonly CardId[]): HeroMods {
  const m = baseMods();
  for (const id of picks) CARDS[id].apply(m);
  return m;
}

/** Three different cards (fewer if the pool runs dry), weighted, none already maxed. */
export function drawOffer(picks: readonly CardId[], rand: () => number, size = 3): CardId[] {
  const taken = (id: CardId) => picks.filter(p => p === id).length;
  const pool = CARD_IDS.filter(id => taken(id) < CARDS[id].max);
  const out: CardId[] = [];
  while (out.length < size && pool.length > 0) {
    const total = pool.reduce((s, id) => s + CARDS[id].weight, 0);
    let r = rand() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= CARDS[pool[i]].weight;
      if (r <= 0) break;
    }
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/** How much the AI commander likes each card (it still varies its picks). */
const AI_TASTE: Record<CardId, number> = {
  riders: 3, barding: 2, lances: 2, joust: 1.6, steeds: 1.2, drill: 0.8, terror: 1.3,
  hooks: 1.1, surgeon: 1, remounts: 1.3, banner: 0.8, shields: 1.2, muster: 0.6,
};

export function aiPick(offer: readonly CardId[], rand: () => number): number {
  let best = 0, bestScore = -1;
  offer.forEach((id, i) => {
    const s = AI_TASTE[id] * (0.6 + rand() * 0.8);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return best;
}
