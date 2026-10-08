import { EarthPower } from './earth/EarthPower';
import { FirePower } from './fire/FirePower';
import { LightningPower } from './lightning/LightningPower';
import type { Power } from './Power';
import { ShadowPower } from './shadow/ShadowPower';
import { WaterPower } from './water/WaterPower';

/**
 * The power list, in number-key order (1–5). To add a power, create a class
 * extending `Power` (see Power.ts) and append it here.
 */
export function createPowers(): Power[] {
  return [new LightningPower(), new FirePower(), new WaterPower(), new EarthPower(), new ShadowPower()];
}
