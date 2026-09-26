import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { EffectsManager } from './effects';

describe('hit flash lifecycle', () => {
  it('expires safely after its unit graphic is destroyed', () => {
    const stage = new Container();
    const effects = new EffectsManager(stage);
    const unit = new Container();
    unit.addChild(new Graphics());
    stage.addChild(unit);

    effects.addHitFlash(unit);
    unit.destroy({ children: true });

    expect(() => effects.update(0.1)).not.toThrow();
    effects.destroy();
    stage.destroy({ children: true });
  });
});
