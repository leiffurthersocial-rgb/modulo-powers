import * as THREE from 'three';
import { ALL_GROUPS, G, groups } from '../config/physics';
import type { Game, GameSystem } from '../core/Game';
import type { RAPIER } from '../core/Physics';
import type { Entity } from '../world/Entity';
import type { WaterBody } from '../world/Water';

export interface AimResult {
  /** Did the ray hit anything within range? */
  hit: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  entity: Entity | null;
  collider: RAPIER.Collider | null;
  /** Water body if the ray hit a water surface first. */
  water: WaterBody | null;
  dir: THREE.Vector3;
  origin: THREE.Vector3;
}

/** Collision filter for aiming: everything except the player and debris. */
export const AIM_GROUPS = groups(G.PLAYER, ALL_GROUPS & ~G.PLAYER & ~G.DEBRIS & ~G.SENSOR);

/**
 * Cast the crosshair ray from the camera. If it misses, `point` is at max range.
 * With `water: true`, water surfaces count as hits.
 */
export function aim(game: Game, maxDist: number, opts: { water?: boolean; groups?: number } = {}): AimResult {
  const origin = game.camera.position.clone();
  const dir = game.rig.aimDirection(new THREE.Vector3());
  // In third person, start the ray past the player so it can't hit them.
  if (game.rig.mode === 'third') origin.addScaledVector(dir, Math.max(0, origin.distanceTo(game.player.curPos) - 0.3));
  const h = game.physics.raycast(origin, dir, maxDist, { groups: opts.groups ?? AIM_GROUPS, exclude: game.player.collider });
  const res: AimResult = {
    hit: !!h,
    point: h ? h.point : origin.clone().addScaledVector(dir, maxDist),
    normal: h ? h.normal : new THREE.Vector3(0, 1, 0),
    distance: h ? h.distance : maxDist,
    entity: h ? game.entities.fromCollider(h.collider) : null,
    collider: h ? h.collider : null,
    water: null,
    dir,
    origin,
  };
  if (opts.water && dir.y < -0.01) {
    for (const b of game.water.bodies) {
      const t = (b.level - origin.y) / dir.y;
      if (t <= 0 || t >= res.distance) continue;
      const p = origin.clone().addScaledVector(dir, t);
      if (!b.containsXZ(p.x, p.z)) continue;
      res.hit = true;
      res.point = p;
      res.normal = new THREE.Vector3(0, 1, 0);
      res.distance = t;
      res.entity = null;
      res.collider = null;
      res.water = b;
    }
  }
  return res;
}

/** World position of a hand (first-person hands, or the avatar's in third person). */
export function handPos(game: Game, side: 'left' | 'right', out = new THREE.Vector3()): THREE.Vector3 {
  if (game.rig.mode === 'third') return (side === 'left' ? game.avatar.palmL : game.avatar.palmR).getWorldPosition(out);
  return game.hands.palmWorld(side, out);
}

/** Midpoint between both hands. */
export function bothHands(game: Game, out = new THREE.Vector3()): THREE.Vector3 {
  handPos(game, 'left', out);
  return out.add(handPos(game, 'right', TMP)).multiplyScalar(0.5);
}

/** Set hand + avatar poses together. */
export function pose(game: Game, left: Parameters<Game['hands']['pose']>[0], right: Parameters<Game['hands']['pose']>[1]) {
  game.hands.pose(left, right);
  const casting = (p: string | null) => p !== null && p !== 'rest' && p !== 'down' && p !== 'hidden';
  game.avatar.aimTarget = casting(right) ? 1 : 0;
  game.avatar.channelTarget = casting(left) && casting(right) ? 1 : 0;
}

// -----------------------------------------------------------------------------
// Projectiles
// -----------------------------------------------------------------------------

export interface ProjectileHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  entity: Entity | null;
  water: WaterBody | null;
}

export interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  radius: number;
  life: number;
  age: number;
  alive: boolean;
  /** Called every frame for VFX. */
  onUpdate?: (p: Projectile, dt: number) => void;
  /** Called once on impact (or with null on timeout). */
  onHit: (p: Projectile, hit: ProjectileHit | null) => void;
  /** Also stop at water surfaces. */
  hitsWater?: boolean;
}

/**
 * Lightweight swept projectiles (not rigid bodies): each fixed step the
 * segment from the old to the new position is ray-cast, so fast projectiles
 * never tunnel through thin walls.
 */
export class ProjectileSystem implements GameSystem {
  readonly list: Projectile[] = [];
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private game: Game) {}

  fire(p: Omit<Projectile, 'age' | 'alive'>): Projectile {
    const proj: Projectile = { ...p, age: 0, alive: true };
    this.list.push(proj);
    return proj;
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p.alive) {
        this.list.splice(i, 1);
        continue;
      }
      p.age += dt;
      p.vel.y -= p.gravity * dt;
      const step = this.tmp.copy(p.vel).multiplyScalar(dt);
      const len = step.length();
      this.dir.copy(step).divideScalar(Math.max(1e-6, len));
      const hit = g.physics.raycast(p.pos, this.dir, len + p.radius, { groups: AIM_GROUPS, exclude: g.player.collider });
      let result: ProjectileHit | null = null;
      if (hit) {
        result = { point: hit.point, normal: hit.normal, entity: g.entities.fromCollider(hit.collider), water: null };
      }
      if (p.hitsWater !== false) {
        const next = this.tmp.copy(p.pos).add(step);
        for (const b of g.water.bodies) {
          if (p.pos.y >= b.level && next.y < b.level && b.containsXZ(next.x, next.z)) {
            const t = (p.pos.y - b.level) / Math.max(1e-6, p.pos.y - next.y);
            const wp = p.pos.clone().lerp(next, t);
            if (!result || wp.distanceTo(p.pos) < result.point.distanceTo(p.pos)) result = { point: wp, normal: new THREE.Vector3(0, 1, 0), entity: null, water: b };
          }
        }
      }
      if (result) {
        p.alive = false;
        p.pos.copy(result.point);
        p.onHit(p, result);
        continue;
      }
      p.pos.addScaledVector(this.dir, len);
      if (p.age >= p.life) {
        p.alive = false;
        p.onHit(p, null);
      }
    }
  }

  update(dt: number) {
    if (dt <= 0) return;
    for (const p of this.list) if (p.alive) p.onUpdate?.(p, dt);
  }

  reset() {
    this.list.length = 0;
  }
}

const TMP = new THREE.Vector3();
