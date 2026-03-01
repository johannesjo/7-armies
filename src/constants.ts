import { UnitStats, UnitType } from './types';

export let MAP_WIDTH = 1200;
export let MAP_HEIGHT = 800;

export function setMapSize(w: number, h: number): void {
  MAP_WIDTH = w;
  MAP_HEIGHT = h;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  swordsman: { hp: 20,  speed: 80,  damage: 4,  range: 10,  radius: 2.5, fireCooldown: 0.8, projectileSpeed: 300, projectileRadius: 2, turnSpeed: 2.5 },
  archer:    { hp: 10,  speed: 55,  damage: 6,  range: 200, radius: 2,   fireCooldown: 2.5, projectileSpeed: 350, projectileRadius: 2, turnSpeed: 1.5 },
  cavalry:   { hp: 18,  speed: 140, damage: 5,  range: 12,  radius: 3,   fireCooldown: 0.9, projectileSpeed: 300, projectileRadius: 2, turnSpeed: 2.0 },
  pikeman:   { hp: 25,  speed: 50,  damage: 3,  range: 12,  radius: 2.5, fireCooldown: 1.0, projectileSpeed: 300, projectileRadius: 2, turnSpeed: 2.0 },
};

export const ARMY_COMPOSITION: { type: UnitType; count: number }[] = [
  { type: 'archer', count: 2 },
  { type: 'cavalry', count: 1 },
  { type: 'pikeman', count: 2 },
];

export const BATTALION_SIZE = 12;

export const UNIT_ATTACK_COOLDOWN_MS = 1000;

export const ROUND_DURATION_S = 6;
export const PATH_SAMPLE_DISTANCE = 18;
export const UNIT_SELECT_RADIUS = 30;
export const COVER_SCREEN_DURATION_MS = 1500;
export const ELEVATION_RANGE_BONUS = 0.2;
export const FLANK_ANGLE_THRESHOLD = Math.PI / 3; // 60° half-cone = 120° front
export const FLANK_DAMAGE_MULTIPLIER = 1.5;

export const CAVALRY_CHARGE_SPEED_THRESHOLD = 100;
export const CAVALRY_CHARGE_DAMAGE_MULTIPLIER = 2.0;
export const PIKEMAN_VS_CAVALRY_MULTIPLIER = 2.0;

export const ENGAGEMENT_RADIUS = 60;
