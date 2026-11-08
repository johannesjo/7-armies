import { Graphics, GraphicsContext } from 'pixi.js';
import { Team, UnitType } from './types';
import { Theme } from './theme';

type Canvas = Graphics | GraphicsContext;

/**
 * Horse coats: [coat, mane/tail]. Deliberately muted browns and greys with no
 * red or blue in them, so only the team colours say which side a rider is on.
 */
const HORSE_COATS: [number, number][] = [
  [0x6b5d50, 0x2f2924], // dark bay
  [0x8a7d6a, 0x403830], // dun
  [0xa29e96, 0x5a5650], // grey
  [0x3e3a37, 0x1a1817], // black
];

/** Number of horse coat variants (pass `variant` 0..n-1 to drawUnitArt). */
export const HORSE_VARIANTS = HORSE_COATS.length;

function shadow(g: Canvas, rx: number, ry: number): void {
  g.ellipse(0, 0, rx, ry).fill({ color: 0x000000, alpha: 0.14 });
}

/**
 * Team-painted helmet seen from above, with a crest line in the team's bright
 * colour that shows where the soldier faces.
 */
function helmet(g: Canvas, x: number, r: number, color: number, dark: number): void {
  g.circle(x, 0, r).fill(dark);
  g.moveTo(x - r * 0.55, 0).lineTo(x + r * 0.9, 0).stroke({ width: Math.max(0.5, r * 0.4), color, alpha: 0.9 });
}

/**
 * Draw a top-down unit body + weapon into the given graphics.
 * Local +X is the facing direction and +Y the unit's right-hand side.
 * Shared by the tactics renderer and the cavalry action mode so both look identical.
 */
export function drawUnitArt(shape: Canvas, weapon: Canvas, type: UnitType, team: Team, r: number, theme: Theme, variant = 0): void {
  const color = team === 'blue' ? theme.blue : theme.red;
  const dark = team === 'blue' ? theme.blueDark : theme.redDark;

  switch (type) {
    case 'cavalry': {
      const [coat, mane] = HORSE_COATS[((variant % HORSE_VARIANTS) + HORSE_VARIANTS) % HORSE_VARIANTS];
      shadow(shape, r * 1.65, r * 0.78);
      // Tail.
      shape.poly([-r * 1.05, -r * 0.12, -r * 1.75, -r * 0.05, -r * 1.75, r * 0.05, -r * 1.05, r * 0.12]).fill(mane);
      // Horse body, neck and head.
      shape.ellipse(-r * 0.12, 0, r * 1.12, r * 0.5).fill(coat).stroke({ width: 0.6, color: mane, alpha: 0.9 });
      shape.ellipse(r * 0.95, 0, r * 0.38, r * 0.24).fill(coat);
      shape.ellipse(r * 1.38, 0, r * 0.3, r * 0.19).fill(coat).stroke({ width: 0.5, color: mane, alpha: 0.8 });
      // Mane along the neck, and ears.
      shape.moveTo(r * 0.55, 0).lineTo(r * 1.15, 0).stroke({ width: Math.max(0.6, r * 0.14), color: mane });
      shape.circle(r * 1.2, -r * 0.12, r * 0.07).fill(mane);
      shape.circle(r * 1.2, r * 0.12, r * 0.07).fill(mane);
      // Team saddle cloth with a trim.
      shape.roundRect(-r * 0.85, -r * 0.56, r * 1.2, r * 1.12, r * 0.26).fill(color).stroke({ width: 0.7, color: dark });
      shape.roundRect(-r * 0.7, -r * 0.42, r * 0.9, r * 0.84, r * 0.18).stroke({ width: 0.5, color: theme.trim, alpha: 0.6 });
      // Rider: shoulders, shield on the left arm, helmet.
      shape.ellipse(-r * 0.15, 0, r * 0.27, r * 0.48).fill(color).stroke({ width: 0.5, color: dark });
      shape.ellipse(-r * 0.05, -r * 0.52, r * 0.3, r * 0.22).fill(color).stroke({ width: 0.6, color: dark });
      helmet(shape, -r * 0.08, r * 0.22, color, dark);
      // Lance couched on the right, with a team pennant below the tip.
      weapon.moveTo(-r * 0.7, r * 0.38).lineTo(r * 2.25, r * 0.38).stroke({ width: Math.max(0.7, r * 0.13), color: theme.wood });
      weapon.poly([r * 2.25, r * 0.28, r * 2.65, r * 0.38, r * 2.25, r * 0.48]).fill(theme.steel);
      weapon.poly([r * 1.75, r * 0.38, r * 2.1, r * 0.38, r * 1.9, r * 0.68]).fill(color);
      break;
    }
    case 'archer': {
      shadow(shape, r * 0.85, r * 1.3);
      // Quiver on the back, fletchings poking out.
      shape.roundRect(-r * 0.95, r * 0.05, r * 0.7, r * 0.42, r * 0.15).fill(theme.leather);
      for (let i = 0; i < 3; i++) {
        const y = r * (0.12 + i * 0.13);
        shape.moveTo(-r * 0.95, y).lineTo(-r * 1.2, y).stroke({ width: 0.6, color: theme.trim });
      }
      // Body with a strap across the chest.
      shape.ellipse(0, 0, r * 0.55, r * 1.05).fill(color).stroke({ width: 0.7, color: dark });
      shape.moveTo(-r * 0.4, r * 0.75).lineTo(r * 0.35, -r * 0.7).stroke({ width: Math.max(0.6, r * 0.15), color: theme.leather });
      // Hood.
      shape.circle(r * 0.05, 0, r * 0.42).fill(dark);
      shape.circle(r * 0.22, 0, r * 0.2).fill({ color: theme.trim, alpha: 0.55 });
      // Bow: a wooden limb and a fine string.
      const bowR = r * 1.6;
      const bowAngle = 0.95;
      weapon.arc(0, 0, bowR, -bowAngle, bowAngle).stroke({ width: Math.max(0.8, r * 0.28), color: theme.wood });
      const sx = Math.cos(bowAngle) * bowR;
      const sy = Math.sin(bowAngle) * bowR;
      weapon.moveTo(sx, -sy).lineTo(sx, sy).stroke({ width: 0.4, color: theme.trim, alpha: 0.85 });
      break;
    }
    case 'pikeman': {
      shadow(shape, r * 0.9, r * 1.35);
      // Padded body.
      shape.ellipse(0, 0, r * 0.65, r * 1.15).fill(color).stroke({ width: 1, color: dark });
      shape.moveTo(-r * 0.35, -r * 0.95).lineTo(-r * 0.35, r * 0.95).stroke({ width: 0.5, color: dark, alpha: 0.6 });
      // Kettle hat: a wide brim around the crown.
      shape.circle(r * 0.05, 0, r * 0.62).fill(dark);
      shape.circle(r * 0.05, 0, r * 0.32).fill(color);
      // Pike held at the right side: long ash shaft and steel head.
      const len = r * 3.4;
      weapon.moveTo(-r * 1.1, r * 0.35).lineTo(len, r * 0.35).stroke({ width: Math.max(0.7, r * 0.18), color: theme.wood });
      weapon.poly([len, r * 0.15, len + r * 0.75, r * 0.35, len, r * 0.55]).fill(theme.steel);
      weapon.moveTo(len - r * 0.1, r * 0.05).lineTo(len - r * 0.1, r * 0.65).stroke({ width: 0.6, color: theme.steelDark });
      break;
    }
    default: {
      // Swordsman.
      shadow(shape, r * 0.95, r * 1.35);
      shape.ellipse(0, 0, r * 0.62, r * 1.08).fill(color).stroke({ width: 0.8, color: dark });
      // Round shield on the left arm with a metal rim and boss.
      shape.circle(r * 0.4, -r * 0.82, r * 0.55).fill(color).stroke({ width: 0.8, color: dark });
      shape.circle(r * 0.4, -r * 0.82, r * 0.17).fill(dark);
      helmet(shape, r * 0.05, r * 0.42, color, dark);
      // Sword in the right hand: blade, crossguard, pommel.
      const y = r * 0.72;
      weapon.moveTo(r * 0.5, y).lineTo(r * 1.75, y).stroke({ width: Math.max(0.7, r * 0.2), color: theme.steel });
      weapon.moveTo(r * 0.5, y - r * 0.32).lineTo(r * 0.5, y + r * 0.32).stroke({ width: Math.max(0.6, r * 0.14), color: theme.steelDark });
      weapon.circle(r * 0.22, y, Math.max(0.5, r * 0.12)).fill(theme.steelDark);
      break;
    }
  }
}

export interface AttackPose {
  /** Weapon rotation offset (rad). */
  wRot: number;
  /** Weapon push along the facing (world units). */
  wX: number;
  /** Body lunge along the facing (world units). */
  bX: number;
}

const REST: AttackPose = { wRot: 0, wX: 0, bX: 0 };

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** How long a blow takes to play out (s). */
export function attackDuration(type: UnitType): number {
  return type === 'pikeman' ? 0.45 : type === 'cavalry' ? 0.3 : 0.38;
}

/**
 * Pose for a blow `since` seconds after it started: swordsmen (and archers in melee)
 * wind up and cut across, pikemen and riders draw back and thrust.
 */
export function attackPose(type: UnitType, r: number, since: number): AttackPose {
  const dur = attackDuration(type);
  if (since < 0 || since >= dur) return REST;
  const p = since / dur;
  if (type === 'pikeman' || type === 'cavalry') {
    const back = type === 'cavalry' ? r * 0.3 : r * 0.6;
    const reach = type === 'cavalry' ? r * 0.7 : r * 1.3;
    const wX = p < 0.3 ? -back * (p / 0.3)
      : p < 0.5 ? -back + (reach + back) * easeOut((p - 0.3) / 0.2)
      : reach * (1 - (p - 0.5) / 0.5);
    return { wRot: 0, wX, bX: Math.sin(p * Math.PI) * r * 0.25 };
  }
  const wRot = p < 0.3 ? -0.9 * (p / 0.3)
    : p < 0.6 ? -0.9 + 1.7 * easeOut((p - 0.3) / 0.3)
    : 0.8 * (1 - (p - 0.6) / 0.4);
  return { wRot, wX: 0, bX: Math.sin(p * Math.PI) * r * 0.35 };
}
