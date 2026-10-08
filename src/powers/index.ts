import { ICONS } from '../ui/icons';
import type { Ability } from './Ability';
import { Power } from './Power';
import { StubAbility } from './StubAbility';
import { FirePower } from './fire/FirePower';
import { EarthPower } from './earth/EarthPower';
import { LightningPower } from './lightning/LightningPower';
import { WaterPower } from './water/WaterPower';

class SimplePower extends Power {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly color: string,
    readonly icon: string,
    readonly abilities: Ability[],
  ) {
    super();
  }
}

/**
 * The power list, in number-key order (1–5). Add new powers here.
 */
export function createPowers(): Power[] {
  return [
    new LightningPower(),
    new FirePower(),
    new WaterPower(),
    new EarthPower(),
    new SimplePower('shadow', 'Shadow', '#9b7bff', ICONS.shadow, [
      new StubAbility('Invisibility', 'Fade from sight.', ICONS.eye, 'toggle', 6, 1),
      new StubAbility('Shadow Blink', 'Teleport to the aim point.', ICONS.blink, 'hold', 0, 0.8),
      new StubAbility('Phase', 'Walk through walls.', ICONS.phase, 'hold', 14, 0.5),
      new StubAbility('Shadow Clone', 'Leave a decoy.', ICONS.clone, 'tap', 30, 6),
    ]),
  ];
}
