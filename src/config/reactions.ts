import type { ElementKind } from '../world/Entity';

/**
 * THE INTERACTION TABLE.
 *
 * Every time an element touches an entity, the reaction system walks these
 * rules in order. A rule matches when the element is the same, the entity has
 * every tag in `all` and none of the tags in `none`. All matching rules apply
 * (unless one is marked `final`). Effect magnitudes are multiplied by the
 * incoming amount (continuous sources pass amount × dt).
 *
 * Entity tags come from its material (wood, stone, metal, organic, flammable,
 * conductive, brittle, frozen...) plus live state (burning, wet, charged, hot,
 * charred).
 *
 * To add a reaction: add a row. To add a new kind of effect: register it in
 * `systems/Reactions.ts` (`EFFECTS`).
 */
export type EffectName =
  | 'heat' // raise temperature (°C per unit)
  | 'cool' // lower temperature
  | 'ignite' // set on fire if hot enough (value = extra ignition chance)
  | 'extinguish'
  | 'wet' // add wetness
  | 'dry'
  | 'freeze' // add frozen amount (needs to be cold / wet)
  | 'melt' // remove frozen amount
  | 'charge' // add electric charge
  | 'damage' // hit points
  | 'stun' // seconds
  | 'shatter' // integrity damage for brittle things
  | 'steam' // steam puff VFX + hiss
  | 'sparks'; // spark VFX

export interface ReactionRule {
  element: ElementKind;
  all?: string[];
  none?: string[];
  effects: [EffectName, number][];
  final?: boolean;
  note: string;
}

export const REACTIONS: ReactionRule[] = [
  // ---- Fire ---------------------------------------------------------------
  { element: 'fire', all: ['frozen'], effects: [['melt', 0.6], ['steam', 0.6], ['cool', 0]], final: true, note: 'Fire + ice → melts into water (and steam)' },
  { element: 'fire', all: ['wet'], effects: [['dry', 0.5], ['steam', 0.4], ['heat', 60]], final: true, note: 'Fire dries wet things before they can burn' },
  { element: 'fire', all: ['flammable'], effects: [['heat', 420], ['ignite', 0.35]], note: 'Fire + wood/hay/cloth → burning' },
  { element: 'fire', all: ['metal'], effects: [['heat', 260]], note: 'Fire heats metal until it glows' },
  { element: 'fire', all: ['stone'], effects: [['heat', 90]], note: 'Stone warms slowly' },
  { element: 'fire', all: ['organic'], effects: [['damage', 14]], note: 'Fire hurts living / dummy targets' },
  { element: 'fire', all: ['charged'], effects: [['sparks', 0.3]], note: 'Sparks fly from charged objects in fire' },

  // ---- Heat (radiant heat from burning neighbours, hot metal) -------------
  { element: 'heat', all: ['frozen'], effects: [['melt', 0.15]], final: true, note: 'Heat melts ice' },
  { element: 'heat', all: ['wet'], effects: [['dry', 0.25]], final: true, note: 'Heat dries things' },
  { element: 'heat', effects: [['heat', 1]], note: 'Radiant heat raises temperature' },

  // ---- Water --------------------------------------------------------------
  { element: 'water', all: ['burning'], effects: [['extinguish', 1], ['steam', 1.2], ['wet', 0.6], ['cool', 300]], final: true, note: 'Water + fire → extinguish + steam' },
  { element: 'water', all: ['hot'], effects: [['cool', 250], ['steam', 0.7], ['wet', 0.2]], final: true, note: 'Water on hot metal → steam' },
  { element: 'water', all: ['frozen'], effects: [['wet', 0.05]], final: true, note: 'Water just runs off ice' },
  { element: 'water', effects: [['wet', 0.9], ['cool', 30]], note: 'Water soaks things (wet things conduct, resist fire)' },

  // ---- Cold ---------------------------------------------------------------
  { element: 'cold', all: ['burning'], effects: [['extinguish', 1], ['steam', 0.8], ['cool', 300]], final: true, note: 'Frost snuffs fire' },
  { element: 'cold', all: ['hot'], effects: [['cool', 300], ['steam', 0.5]], final: true, note: 'Frost cools hot metal' },
  { element: 'cold', all: ['wet'], effects: [['freeze', 1.2], ['cool', 60]], note: 'Water + freeze → ice' },
  { element: 'cold', all: ['organic'], effects: [['freeze', 0.5], ['stun', 0.6], ['cool', 40]], note: 'Freezing slows living targets' },
  { element: 'cold', effects: [['freeze', 0.35], ['cool', 50]], note: 'Frost builds up on anything' },

  // ---- Lightning ----------------------------------------------------------
  { element: 'lightning', all: ['frozen'], effects: [['shatter', 0.5]], note: 'Lightning cracks ice' },
  { element: 'lightning', all: ['conductive'], effects: [['charge', 1], ['heat', 120], ['sparks', 1]], note: 'Lightning + metal/wet → charged and arcing' },
  { element: 'lightning', all: ['flammable'], none: ['wet', 'conductive'], effects: [['heat', 500], ['ignite', 0.6]], note: 'Lightning + wood → ignites' },
  { element: 'lightning', all: ['brittle'], none: ['metal'], effects: [['shatter', 0.45]], note: 'Lightning shatters brittle objects' },
  { element: 'lightning', all: ['organic'], effects: [['damage', 40], ['stun', 1.6], ['charge', 0.6]], note: 'Lightning shocks and stuns targets' },

  // ---- Earth (impacts, shockwaves) ----------------------------------------
  { element: 'earth', all: ['frozen'], effects: [['shatter', 1.2]], final: true, note: 'Ice + earth impact → shatters' },
  { element: 'earth', all: ['brittle'], effects: [['shatter', 0.35]], note: 'Earth cracks stone and glass' },
  { element: 'earth', all: ['organic'], effects: [['damage', 20], ['stun', 0.8]], note: 'Earth knocks targets about' },
  { element: 'earth', all: ['burning'], effects: [['extinguish', 0.5]], note: 'Dirt smothers fire' },

  // ---- Impact (generic physical hits) -------------------------------------
  { element: 'impact', all: ['brittle'], effects: [['shatter', 1]], note: 'Hard impacts break brittle props' },
  { element: 'impact', all: ['organic'], effects: [['damage', 1]], note: 'Impacts hurt targets' },
];

/**
 * World-surface reactions (things that aren't entities: water bodies,
 * grassland, bare ground). Each effect is implemented by whichever system owns
 * that surface (see `Reactions.registerSurfaceEffect`).
 */
export type SurfaceKind = 'water' | 'grass' | 'ground' | 'ice';

export interface SurfaceRule {
  element: ElementKind;
  surface: SurfaceKind;
  effect: string;
  note: string;
}

export const SURFACE_REACTIONS: SurfaceRule[] = [
  { element: 'lightning', surface: 'water', effect: 'electrifyWater', note: 'Water + lightning → electrified water conducts to everything in it' },
  { element: 'cold', surface: 'water', effect: 'freezeWater', note: 'Freezing a water surface makes walkable ice' },
  { element: 'fire', surface: 'grass', effect: 'igniteGrass', note: 'Fire spreads across dry grass' },
  { element: 'lightning', surface: 'grass', effect: 'igniteGrass', note: 'Lightning sets grass alight' },
  { element: 'water', surface: 'grass', effect: 'extinguishGround', note: 'Water puts out grass fires' },
  { element: 'cold', surface: 'grass', effect: 'extinguishGround', note: 'Frost puts out grass fires' },
  { element: 'water', surface: 'ground', effect: 'mud', note: 'Earth + water → mud (slow, slippery)' },
  { element: 'earth', surface: 'water', effect: 'mud', note: 'Earth into water → mud' },
  { element: 'fire', surface: 'ice', effect: 'meltIce', note: 'Fire melts ice platforms' },
  { element: 'earth', surface: 'ground', effect: 'dryMud', note: 'Raising rock dries mud' },
];
