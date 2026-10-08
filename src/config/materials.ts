/**
 * Physical + elemental material definitions. Every prop references one of these.
 *
 * Elemental behaviour (what burns, what conducts, what shatters) is data-driven:
 * the reaction system in `systems/Reactions.ts` reads these flags and the
 * interaction table in `config/reactions.ts`.
 */
export type MaterialId =
  | 'wood'
  | 'dryWood'
  | 'hay'
  | 'cloth'
  | 'stone'
  | 'brick'
  | 'metal'
  | 'ice'
  | 'glass'
  | 'dummy'
  | 'flesh'
  | 'dirt'
  | 'rubber';

export interface MaterialDef {
  id: MaterialId;
  /** kg/m³ — drives mass via collider volume. */
  density: number;
  friction: number;
  restitution: number;
  /** Can catch fire. */
  flammable: boolean;
  /** Temperature (°C) at which it ignites. */
  ignitionTemp: number;
  /** Seconds of burning per unit of fuel (per m³ roughly). */
  burnRate: number;
  /** Conducts electricity (metal, water-soaked things). */
  conductive: boolean;
  /** Shatters on high-energy impacts / lightning. */
  brittle: boolean;
  /** Impact energy (J per kg) above which a brittle object breaks. */
  breakEnergy: number;
  /** Heats up and glows (metal). */
  glows: boolean;
  /** How quickly it exchanges heat (0..1). */
  thermalRate: number;
  /** Sound family for impacts. */
  sound: 'wood' | 'stone' | 'metal' | 'ice' | 'generic';
  /** Base tags given to every entity of this material. */
  tags: string[];
}

const base = {
  friction: 0.6,
  restitution: 0.1,
  flammable: false,
  ignitionTemp: 9999,
  burnRate: 0,
  conductive: false,
  brittle: false,
  breakEnergy: 9999,
  glows: false,
  thermalRate: 0.3,
  sound: 'generic' as const,
};

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  wood: { ...base, id: 'wood', density: 550, flammable: true, ignitionTemp: 300, burnRate: 0.05, sound: 'wood', tags: ['wood', 'organic'] },
  dryWood: { ...base, id: 'dryWood', density: 450, flammable: true, ignitionTemp: 220, burnRate: 0.08, sound: 'wood', tags: ['wood', 'organic'] },
  hay: { ...base, id: 'hay', density: 120, friction: 0.8, flammable: true, ignitionTemp: 150, burnRate: 0.22, sound: 'generic', tags: ['organic'] },
  cloth: { ...base, id: 'cloth', density: 200, flammable: true, ignitionTemp: 180, burnRate: 0.3, sound: 'generic', tags: ['organic'] },
  stone: { ...base, id: 'stone', density: 2500, friction: 0.8, restitution: 0.05, brittle: true, breakEnergy: 260, thermalRate: 0.08, sound: 'stone', tags: ['stone'] },
  brick: { ...base, id: 'brick', density: 1900, friction: 0.85, restitution: 0.03, brittle: true, breakEnergy: 140, thermalRate: 0.1, sound: 'stone', tags: ['stone'] },
  metal: { ...base, id: 'metal', density: 7800, friction: 0.45, restitution: 0.2, conductive: true, glows: true, thermalRate: 0.6, sound: 'metal', tags: ['metal'] },
  ice: { ...base, id: 'ice', density: 917, friction: 0.03, restitution: 0.05, brittle: true, breakEnergy: 60, thermalRate: 0.5, sound: 'ice', tags: ['frozen'] },
  glass: { ...base, id: 'glass', density: 2500, friction: 0.4, brittle: true, breakEnergy: 25, sound: 'ice', tags: [] },
  dummy: { ...base, id: 'dummy', density: 400, friction: 0.7, flammable: true, ignitionTemp: 260, burnRate: 0.04, sound: 'wood', tags: ['organic'] },
  flesh: { ...base, id: 'flesh', density: 1000, friction: 0.7, sound: 'generic', tags: ['organic'] },
  dirt: { ...base, id: 'dirt', density: 1600, friction: 0.9, sound: 'stone', tags: [] },
  rubber: { ...base, id: 'rubber', density: 1100, friction: 1.0, restitution: 0.7, sound: 'generic', tags: [] },
};
