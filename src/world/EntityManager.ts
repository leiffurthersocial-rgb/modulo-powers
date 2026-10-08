import * as THREE from 'three';
import { G, groups, ALL_GROUPS } from '../config/physics';
import { RAPIER, type Physics } from '../core/Physics';
import { time } from '../core/Time';
import { Entity, type PropSpec } from './Entity';

export type PropFactory = (spec: PropSpec, em: EntityManager) => Entity | Entity[];

/**
 * Registry of every simulated entity.
 *
 * Reset works by *re-spawning from data*: while the map is being built every
 * spawned prop's `PropSpec` is recorded. `reset()` removes all entities and
 * spawns the recorded specs again, which restores burnt, broken, frozen or
 * moved objects exactly, with no per-prop undo logic.
 */
export class EntityManager {
  readonly list: Entity[] = [];
  private byCollider = new Map<number, Entity>();
  private factories = new Map<string, PropFactory>();
  private initialSpecs: PropSpec[] = [];
  /** While true, spawned specs are recorded as part of the initial map. */
  recording = false;
  /** Hooks run after a reset (systems clear their own state via Game). */
  readonly onSpawn: ((e: Entity) => void)[] = [];

  constructor(
    readonly physics: Physics,
    readonly scene: THREE.Scene,
  ) {}

  registerFactory(type: string, f: PropFactory) {
    this.factories.set(type, f);
  }

  /** Spawn a prop from a spec using its registered factory. */
  spawn(spec: PropSpec): Entity[] {
    const f = this.factories.get(spec.type);
    if (!f) throw new Error(`No prop factory for "${spec.type}"`);
    if (this.recording) this.initialSpecs.push(spec);
    const out = f(spec, this);
    const arr = Array.isArray(out) ? out : [out];
    for (const e of arr) {
      e.spec = spec;
      e.transient = !this.recording;
    }
    return arr;
  }

  /** Register an already-built entity. Adds its object to the scene and indexes its colliders. */
  add(e: Entity): Entity {
    this.list.push(e);
    if (!e.object.parent) this.scene.add(e.object);
    for (const c of e.colliders) this.byCollider.set(c.handle, e);
    if (e.body) {
      if (e.body.isDynamic()) this.physics.sync(e.body, e.object);
    }
    for (const cb of this.onSpawn) cb(e);
    return e;
  }

  /** Index an extra collider created after `add` (e.g. compound pieces). */
  indexCollider(c: RAPIER.Collider, e: Entity) {
    e.colliders.push(c);
    this.byCollider.set(c.handle, e);
  }

  remove(e: Entity) {
    if (e.dead) return;
    e.dead = true;
    e.onRemove?.();
    for (const c of e.colliders) this.byCollider.delete(c.handle);
    if (e.body) {
      this.physics.removeBody(e.body);
    } else {
      for (const c of e.colliders) if (this.physics.world.getCollider(c.handle)) this.physics.world.removeCollider(c, false);
    }
    e.body = null;
    e.colliders = [];
    e.object.removeFromParent();
    e.visual.dispose();
    e.object.traverse((o) => {
      // Geometries are shared through caches unless flagged as owned.
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.ownsGeometry) m.geometry.dispose();
    });
    const i = this.list.indexOf(e);
    if (i >= 0) {
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
    }
  }

  fromCollider(c: RAPIER.Collider | null | undefined): Entity | null {
    if (!c) return null;
    return this.byCollider.get(c.handle) ?? null;
  }

  fromHandle(h: number): Entity | null {
    return this.byCollider.get(h) ?? null;
  }

  /** All entities with a collider overlapping a sphere. */
  querySphere(center: THREE.Vector3, radius: number, out: Entity[] = [], filter = ALL_GROUPS & ~G.PLAYER): Entity[] {
    out.length = 0;
    const seen = new Set<number>();
    const ball = new RAPIER.Ball(radius);
    this.physics.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      ball,
      (c) => {
        const e = this.byCollider.get(c.handle);
        if (e && !e.dead && !seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
        return true;
      },
      undefined,
      groups(ALL_GROUPS, filter),
    );
    return out;
  }

  /** Brute-force distance query (doesn't need colliders), fine for a few hundred entities. */
  nearby(center: THREE.Vector3, radius: number, out: Entity[] = []): Entity[] {
    out.length = 0;
    for (const e of this.list) {
      if (e.dead) continue;
      e.center(TMP);
      const r = radius + e.radius;
      if (TMP.distanceToSquared(center) <= r * r) out.push(e);
    }
    return out;
  }

  /** Per-entity behaviour, in the fixed physics step. */
  fixedUpdate(dt: number) {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.update && !e.dead) e.update(dt);
    }
  }

  /** Turn elemental state into visuals, once per rendered frame. */
  updateVisuals() {
    for (let i = 0; i < this.list.length; i++) this.list[i].visual.apply(this.list[i], time.elapsed);
  }

  /** Remove everything and respawn the recorded initial map. */
  reset() {
    for (const e of [...this.list]) this.remove(e);
    this.byCollider.clear();
    const specs = this.initialSpecs;
    this.initialSpecs = [];
    this.recording = true;
    for (const s of specs) this.spawn(s);
    this.recording = false;
  }

  get count(): number {
    return this.list.length;
  }
}

const TMP = new THREE.Vector3();
