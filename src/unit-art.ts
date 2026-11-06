import { Graphics, GraphicsContext } from 'pixi.js';
import { Team, UnitType } from './types';
import { Theme } from './theme';

/**
 * Draw a top-down unit body + weapon into the given graphics.
 * Local +X is the facing direction. Shared by the tactics renderer
 * and the cavalry action mode so both look identical.
 */
export function drawUnitArt(shape: Graphics | GraphicsContext, weapon: Graphics | GraphicsContext, type: UnitType, team: Team, r: number, theme: Theme): void {
  const color = team === 'blue' ? theme.blue : theme.red;
  const darkColor = team === 'blue' ? theme.blueDark : theme.redDark;

  switch (type) {
    case 'cavalry': {
      // Ellipse body — elongated along X (facing direction)
      shape.ellipse(0, 0, r * 1.3, r * 0.65);
      shape.fill(color);
      shape.ellipse(0, 0, r * 1.3, r * 0.65);
      shape.setStrokeStyle({ width: 1, color: darkColor });
      shape.stroke();
      // Rider dot at front (+X = facing direction)
      shape.circle(r * 0.6, 0, r * 0.35);
      shape.fill(darkColor);
      // Lance
      weapon.setStrokeStyle({ width: 1, color: theme.barrel, alpha: theme.barrelAlpha });
      weapon.moveTo(0, 0);
      weapon.lineTo(r * 1.8, 0);
      weapon.stroke();
      break;
    }
    case 'archer': {
      // Oval body — wide shoulders, narrow front-to-back
      shape.ellipse(0, 0, r * 0.6, r * 1.2);
      shape.fill(color);
      shape.ellipse(0, 0, r * 0.6, r * 1.2);
      shape.setStrokeStyle({ width: 1, color: darkColor });
      shape.stroke();
      // D-shaped bow: arc limb + straight bowstring
      const bowR = r * 1.8;
      const bowAngle = 0.9; // ~52° half-sweep
      weapon.setStrokeStyle({ width: 1.5, color: theme.barrel, alpha: theme.barrelAlpha });
      weapon.arc(0, 0, bowR, -bowAngle, bowAngle);
      weapon.stroke();
      // Bowstring: straight line connecting arc endpoints
      const sx = Math.cos(bowAngle) * bowR;
      const sy = Math.sin(bowAngle) * bowR;
      weapon.setStrokeStyle({ width: 0.5, color: theme.barrel, alpha: theme.barrelAlpha * 0.7 });
      weapon.moveTo(sx, -sy);
      weapon.lineTo(sx, sy);
      weapon.stroke();
      break;
    }
    case 'pikeman': {
      // Oval body + thicker outline (heavier armor)
      shape.ellipse(0, 0, r * 0.65, r * 1.2);
      shape.fill(color);
      shape.ellipse(0, 0, r * 0.65, r * 1.2);
      shape.setStrokeStyle({ width: 1.5, color: darkColor });
      shape.stroke();
      // Long pike (3× radius) with spearhead
      const pikeLen = r * 3;
      weapon.setStrokeStyle({ width: 1, color: theme.barrel, alpha: theme.barrelAlpha });
      weapon.moveTo(0, 0);
      weapon.lineTo(pikeLen, 0);
      weapon.stroke();
      // Spearhead — small filled triangle at tip
      weapon.moveTo(pikeLen + 2, 0);
      weapon.lineTo(pikeLen - 1, -1.2);
      weapon.lineTo(pikeLen - 1, 1.2);
      weapon.closePath();
      weapon.fill({ color: theme.barrel, alpha: theme.barrelAlpha });
      break;
    }
    default: {
      // Swordsman: oval body + outline + shield
      shape.ellipse(0, 0, r * 0.7, r * 1.15);
      shape.fill(color);
      shape.ellipse(0, 0, r * 0.7, r * 1.15);
      shape.setStrokeStyle({ width: 1, color: darkColor });
      shape.stroke();
      // Shield: filled semicircle on local +X side (perpendicular to facing)
      shape.arc(1.5, 0, 2, -Math.PI / 2, Math.PI / 2);
      shape.fill({ color: darkColor, alpha: 0.8 });
      // Short sword, slightly thicker
      weapon.setStrokeStyle({ width: 1.5, color: theme.barrel, alpha: theme.barrelAlpha });
      weapon.moveTo(0, 0);
      weapon.lineTo(r * 1.5, 0);
      weapon.stroke();
      break;
    }
  }
}
