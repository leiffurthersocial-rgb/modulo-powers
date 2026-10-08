import { ICONS } from '../ui/icons';
import type { Ability } from './Ability';
import { Power } from './Power';
import { StubAbility } from './StubAbility';
import { FirePower } from './fire/FirePower';

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
    new SimplePower('lightning', 'Lightning', '#7fd4ff', ICONS.lightning, [
      new StubAbility('Bolt Strike', 'Hold to charge, release to strike.', ICONS.bolt, 'charge', 22, 0.6),
      new StubAbility('Chain Lightning', 'Arcs between conductive objects.', ICONS.chain, 'tap', 28, 1.5),
      new StubAbility('Lightning Step', 'Blink-dash leaving static.', ICONS.dash, 'tap', 18, 0.9),
      new StubAbility('Storm Call', 'Summon a localized storm.', ICONS.storm, 'tap', 60, 12),
    ]),
    new FirePower(),
    new SimplePower('water', 'Water', '#3fa9f5', ICONS.water, [
      new StubAbility('Water Jet', 'High-pressure stream.', ICONS.jet, 'hold', 12, 0.2),
      new StubAbility('Tidal Wave', 'Forward surge.', ICONS.wave, 'tap', 40, 5),
      new StubAbility('Freeze', 'Turn water to ice.', ICONS.snowflake, 'hold', 14, 0.3),
      new StubAbility('Hydro Shield', 'Water bubble shield.', ICONS.bubble, 'toggle', 6, 1),
    ]),
    new SimplePower('earth', 'Earth', '#c08a4a', ICONS.earth, [
      new StubAbility('Raise Pillar', 'Rock column at the aim point.', ICONS.pillar, 'charge', 18, 0.6),
      new StubAbility('Boulder Throw', 'Pull a boulder, then hurl it.', ICONS.boulder, 'tap', 25, 1),
      new StubAbility('Earthquake', 'Ground slam shockwave.', ICONS.quake, 'charge', 40, 4),
      new StubAbility('Stone Armor / Dig', 'Armour toggle, or dig while crouching.', ICONS.armor, 'toggle', 5, 1),
    ]),
    new SimplePower('shadow', 'Shadow', '#9b7bff', ICONS.shadow, [
      new StubAbility('Invisibility', 'Fade from sight.', ICONS.eye, 'toggle', 6, 1),
      new StubAbility('Shadow Blink', 'Teleport to the aim point.', ICONS.blink, 'hold', 0, 0.8),
      new StubAbility('Phase', 'Walk through walls.', ICONS.phase, 'hold', 14, 0.5),
      new StubAbility('Shadow Clone', 'Leave a decoy.', ICONS.clone, 'tap', 30, 6),
    ]),
  ];
}
