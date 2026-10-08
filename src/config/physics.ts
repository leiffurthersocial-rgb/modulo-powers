/**
 * Rapier collision groups. A collider's `collisionGroups` value packs
 * membership (high 16 bits) and filter (low 16 bits); two colliders interact
 * only if each one's membership overlaps the other's filter.
 */
export const G = {
  TERRAIN: 1 << 0,
  /** Static world geometry the player can phase through (walls, doors). */
  PHASEABLE: 1 << 1,
  /** Static world geometry that is never phaseable (floors, bedrock). */
  STATIC: 1 << 2,
  PLAYER: 1 << 3,
  DYNAMIC: 1 << 4,
  NPC: 1 << 5,
  /** Sensors such as water volumes and triggers. */
  SENSOR: 1 << 6,
  /** Projectiles / debris that shouldn't collide with each other. */
  DEBRIS: 1 << 7,
} as const;

export const ALL_GROUPS = 0xffff;

export function groups(membership: number, filter: number = ALL_GROUPS): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const PHYSICS = {
  gravity: -9.81,
  /** Fixed physics timestep (seconds). */
  fixedDt: 1 / 60,
  /** Max physics sub-steps per rendered frame (prevents a spiral of death). */
  maxSubSteps: 5,
};
