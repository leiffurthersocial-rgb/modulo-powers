/**
 * Map layout. The terrain generator, zone builders and the teleport menu all
 * read from here, so moving a zone only needs a change in this file.
 *
 * Coordinates: +X east, +Z south, -Z north. Units are metres.
 */
export const WORLD = {
  /** Terrain side length. */
  size: 720,
  /** Terrain grid resolution (cells per side) for the physics heightfield and mesh. */
  segments: 288,
  /** Edge mountains start rising at this radius from the centre. */
  mountainStart: 255,
  /** Below this height the player is respawned (kill floor). */
  killY: -40,
  /** Global sea / lake level. */
  waterLevel: 0,
};

export type ZoneId = 'hub' | 'lightning' | 'fire' | 'water' | 'earth' | 'shadow' | 'arena';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** Teleport menu key (1–6). */
  key: number;
  x: number;
  z: number;
  /** Radius of the flattened zone area. */
  radius: number;
  /** Ground height inside the zone. */
  height: number;
  color: string;
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  hub: { id: 'hub', name: 'Hub', key: 1, x: 0, z: 0, radius: 34, height: 3, color: '#e8e2d0' },
  lightning: {
    id: 'lightning',
    name: 'Lightning Zone',
    key: 2,
    x: 0,
    z: -175,
    radius: 62,
    height: 4,
    color: '#7fd4ff',
  },
  fire: { id: 'fire', name: 'Fire Zone', key: 3, x: 168, z: -62, radius: 62, height: 3.5, color: '#ff7a2f' },
  water: { id: 'water', name: 'Water Zone', key: 4, x: 112, z: 150, radius: 70, height: 2, color: '#3fa9f5' },
  earth: { id: 'earth', name: 'Earth Zone', key: 5, x: -112, z: 150, radius: 66, height: 7, color: '#c08a4a' },
  shadow: { id: 'shadow', name: 'Shadow Zone', key: 6, x: -168, z: -62, radius: 62, height: 3.5, color: '#9b7bff' },
  arena: { id: 'arena', name: 'Fight Arena', key: 7, x: -78, z: 30, radius: 34, height: 3.5, color: '#ff4a3a' },
};

export const ZONE_LIST: ZoneDef[] = Object.values(ZONES);

/** The water zone's lake: a basin whose surface sits at WORLD.waterLevel. */
export const LAKE = { x: 128, z: 168, radius: 44, depth: 7 };

/**
 * The river: a channel at lake level, flowing from the mountains into the lake.
 * Points are ordered downstream (the current flows from first to last).
 */
export const RIVER = {
  points: [
    [40, 290],
    [52, 248],
    [72, 214],
    [96, 190],
    [112, 178],
  ] as [number, number][],
  width: 7,
  depth: 3.2,
  current: 3.5,
};

/** The Earth zone canyon: a deep trench crossing the zone. */
export const CANYON = { ax: -150, az: 112, bx: -78, bz: 186, width: 15, depth: 20 };

/** The Lightning zone pond (its own water body, above sea level). */
export const POND = { x: 34, z: -168, radius: 13, depth: 2.4 };

/** Shared challenge areas placed between the zones. */
export const EXTRAS = {
  shootingRange: { x: 72, z: -112 },
  stressTest: { x: -66, z: -104 },
  parkour: { x: -10, z: 92 },
  combo: { x: 150, z: 46 },
};

/** Paths from the hub to each zone (rendered as dirt and gently flattened). */
export const PATH_WIDTH = 4.5;
