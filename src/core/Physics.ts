import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS } from '../config/physics';

export { RAPIER };

/**
 * A rigid body whose transform is mirrored onto a Three.js object every frame,
 * interpolated between the last two fixed physics steps for smooth rendering.
 */
export interface SyncedBody {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  prevPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  curPos: THREE.Vector3;
  curQuat: THREE.Quaternion;
  /** Set when the body teleported this step (no interpolation). */
  snap: boolean;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
}

export interface ContactForceInfo {
  h1: number;
  h2: number;
  /** Total contact force magnitude (N). */
  force: number;
}

/**
 * Thin wrapper around the Rapier world: fixed stepping, render sync and
 * convenience queries.
 */
export class Physics {
  world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  private synced: SyncedBody[] = [];
  private syncedIndex = new Map<RAPIER.RigidBody, SyncedBody>();
  /** Called for each contact-force event above the collider's threshold. */
  onContactForce: ((e: ContactForceInfo) => void) | null = null;
  /** Called for each collision start/stop (sensors included). */
  onCollision: ((h1: number, h2: number, started: boolean) => void) | null = null;

  private static tmpPos = new THREE.Vector3();
  private static tmpQuat = new THREE.Quaternion();

  static async init(): Promise<void> {
    await RAPIER.init();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS.fixedDt;
    this.events = new RAPIER.EventQueue(true);
  }

  /** Register a body to be mirrored onto `object` (which should live in world space). */
  sync(body: RAPIER.RigidBody, object: THREE.Object3D): SyncedBody {
    const t = body.translation();
    const r = body.rotation();
    const s: SyncedBody = {
      body,
      object,
      prevPos: new THREE.Vector3(t.x, t.y, t.z),
      prevQuat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      curPos: new THREE.Vector3(t.x, t.y, t.z),
      curQuat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      snap: true,
    };
    object.position.copy(s.curPos);
    object.quaternion.copy(s.curQuat);
    this.synced.push(s);
    this.syncedIndex.set(body, s);
    return s;
  }

  unsync(body: RAPIER.RigidBody) {
    const s = this.syncedIndex.get(body);
    if (!s) return;
    this.syncedIndex.delete(body);
    const i = this.synced.indexOf(s);
    if (i >= 0) {
      this.synced[i] = this.synced[this.synced.length - 1];
      this.synced.pop();
    }
  }

  /** Mark a body as teleported so it doesn't interpolate from its old place. */
  snap(body: RAPIER.RigidBody) {
    const s = this.syncedIndex.get(body);
    if (!s) return;
    const t = body.translation();
    const r = body.rotation();
    s.curPos.set(t.x, t.y, t.z);
    s.curQuat.set(r.x, r.y, r.z, r.w);
    s.prevPos.copy(s.curPos);
    s.prevQuat.copy(s.curQuat);
  }

  removeBody(body: RAPIER.RigidBody) {
    this.unsync(body);
    this.world.removeRigidBody(body);
  }

  step(dt: number) {
    this.world.timestep = dt;
    this.world.step(this.events);
    const cf = this.onContactForce;
    this.events.drainContactForceEvents((e) => {
      if (cf) cf({ h1: e.collider1(), h2: e.collider2(), force: e.totalForceMagnitude() });
    });
    const col = this.onCollision;
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (col) col(h1, h2, started);
    });
    for (const s of this.synced) {
      s.prevPos.copy(s.curPos);
      s.prevQuat.copy(s.curQuat);
      if (s.body.isSleeping()) continue;
      const t = s.body.translation();
      const r = s.body.rotation();
      s.curPos.set(t.x, t.y, t.z);
      s.curQuat.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Write interpolated transforms to the scene objects. */
  interpolate(alpha: number) {
    const p = Physics.tmpPos;
    const q = Physics.tmpQuat;
    for (const s of this.synced) {
      p.copy(s.prevPos).lerp(s.curPos, alpha);
      q.copy(s.prevQuat).slerp(s.curQuat, alpha);
      s.object.position.copy(p);
      s.object.quaternion.copy(q);
    }
  }

  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /**
   * Cast a ray and return the first hit with its normal.
   * `filterGroups` is a packed collision-groups value (see config/physics.ts).
   */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    opts: { groups?: number; exclude?: RAPIER.Collider; excludeBody?: RAPIER.RigidBody; solid?: boolean; sensors?: boolean } = {},
  ): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const flags = opts.sensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDist,
      opts.solid ?? true,
      flags,
      opts.groups,
      opts.exclude,
      opts.excludeBody,
    );
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: d,
      collider: hit.collider,
    };
  }
}
