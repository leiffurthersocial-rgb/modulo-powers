import * as THREE from 'three';
import { PLAYER } from '../config/balance';
import { ALL_GROUPS, G, PHYSICS, groups } from '../config/physics';
import { RAPIER, type Physics } from '../core/Physics';

export type GroundSurface = 'grass' | 'stone' | 'wood' | 'metal' | 'water' | 'sand';

export interface MoveInput {
  /** -1..1 strafe (right positive). */
  x: number;
  /** -1..1 forward (forward positive). */
  z: number;
  sprint: boolean;
  crouch: boolean;
  /** Camera yaw in radians. */
  yaw: number;
}

/**
 * Kinematic character controller built on Rapier's KinematicCharacterController:
 * slopes, auto-step (stairs), snap-to-ground, sliding off steep slopes, coyote
 * time and jump buffering. Movement is integrated in the fixed physics step.
 *
 * Powers modify movement through the public multipliers / hooks rather than
 * reaching into internals:
 *  - `addVelocity()` for knockback, rocket jumps, dashes
 *  - `speedMul`, `frictionMul`, `gravityMul` for mud, ice, stone armour, etc.
 *  - `phase` to ignore PHASEABLE world geometry (Shadow: Phase)
 *  - `frozen` to suspend movement (teleport animations, digging)
 */
export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private kcc: RAPIER.KinematicCharacterController;

  /** Capsule centre at the last two fixed steps (for render interpolation). */
  readonly prevPos = new THREE.Vector3();
  readonly curPos = new THREE.Vector3();
  /** Interpolated capsule centre for rendering. */
  readonly renderPos = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  grounded = false;
  wasGrounded = false;
  readonly groundNormal = new THREE.Vector3(0, 1, 0);
  groundCollider: RAPIER.Collider | null = null;
  private airTime = 0;
  private jumpBuffer = 0;
  /** True while a jump is rising (prevents snap-to-ground from eating it). */
  private jumping = false;

  crouching = false;
  /** 0 standing … 1 crouched (smoothed, for camera height). */
  crouchT = 0;
  halfHeight = PLAYER.halfHeight;

  /** Combined movement modifiers (mud, ice, armour...). Recomputed each step. */
  speedMul = 1;
  frictionMul = 1;
  gravityMul = 1;
  private mods = new Map<string, { speed: number; friction: number }>();

  /** Set a named movement modifier (multiplied together with the others). */
  setModifier(key: string, speed: number, friction = 1) {
    this.mods.set(key, { speed, friction });
  }

  clearModifier(key: string) {
    this.mods.delete(key);
  }
  /** Ignore walls tagged PHASEABLE. */
  phase = false;
  /** Freeze all movement (used during teleports / digging). */
  frozen = false;
  /** Disable gravity (e.g. hovering on Fire Thrust). */
  noGravity = false;
  /** Swimming: set by the water system. */
  inWater = 0;
  /** When set, the player can't sink below this height (water-walking). */
  waterFloor: number | null = null;

  /** Events for camera/audio. */
  onLand: ((impactSpeed: number) => void) | null = null;
  onJump: (() => void) | null = null;
  onStep: ((surface: GroundSurface) => void) | null = null;
  /** Lets the world decide what surface a collider is (for footstep sounds). */
  surfaceOf: ((collider: RAPIER.Collider | null, pos: THREE.Vector3) => GroundSurface) | null = null;

  private stepDist = 0;
  private lastFallSpeed = 0;

  constructor(
    private physics: Physics,
    spawn: THREE.Vector3,
  ) {
    const world = physics.world;
    const center = spawn.clone();
    center.y += PLAYER.radius + PLAYER.halfHeight + 0.05;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius)
        .setCollisionGroups(groups(G.PLAYER, ALL_GROUPS & ~G.PLAYER & ~G.DEBRIS))
        .setFriction(0),
      this.body,
    );
    this.kcc = world.createCharacterController(0.03);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(PLAYER.maxSlopeClimbDeg));
    this.kcc.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(PLAYER.minSlopeSlideDeg));
    this.kcc.enableAutostep(PLAYER.stepHeight, PLAYER.stepMinWidth, false);
    this.kcc.enableSnapToGround(PLAYER.snapToGround);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(PLAYER.mass);
    this.kcc.setSlideEnabled(true);
    this.curPos.copy(center);
    this.prevPos.copy(center);
    this.renderPos.copy(center);
  }

  /** World position of the feet (bottom of the capsule). */
  feet(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.curPos).setY(this.curPos.y - this.halfHeight - PLAYER.radius);
  }

  /** Interpolated feet position for rendering. */
  renderFeet(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.renderPos).setY(this.renderPos.y - this.halfHeight - PLAYER.radius);
  }

  get height(): number {
    return 2 * (this.halfHeight + PLAYER.radius);
  }

  requestJump() {
    this.jumpBuffer = PLAYER.jumpBuffer;
  }

  addVelocity(v: THREE.Vector3) {
    this.velocity.add(v);
    if (v.y > 0.5) {
      this.grounded = false;
      this.jumping = true;
    }
  }

  /** Velocity change that can lift off the ground (rocket jumps, thrust, launches). */
  thrust(dv: THREE.Vector3) {
    this.velocity.add(dv);
    if (dv.y > 0) {
      this.jumping = true;
      this.grounded = false;
    }
  }

  /** Instantly move the player (feet position). Clears velocity unless `keepVelocity`. */
  teleport(feet: THREE.Vector3, keepVelocity = false) {
    const c = feet.clone();
    c.y += this.halfHeight + PLAYER.radius + 0.02;
    this.body.setTranslation({ x: c.x, y: c.y, z: c.z }, true);
    this.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
    this.curPos.copy(c);
    this.prevPos.copy(c);
    this.renderPos.copy(c);
    if (!keepVelocity) this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.airTime = 0;
  }

  /** Packed collision groups the controller uses for its sweeps. */
  private moveGroups(): number {
    let filter = ALL_GROUPS & ~G.PLAYER & ~G.SENSOR & ~G.DEBRIS;
    if (this.phase) filter &= ~G.PHASEABLE;
    return groups(G.PLAYER, filter);
  }

  /** True if a capsule of the given half-height at `center` overlaps solid world. */
  overlaps(center: THREE.Vector3, halfHeight: number, ignorePhaseable = false): boolean {
    let filter = ALL_GROUPS & ~G.PLAYER & ~G.SENSOR & ~G.DEBRIS & ~G.NPC;
    if (ignorePhaseable) filter &= ~G.PHASEABLE;
    const shape = new RAPIER.Capsule(halfHeight, PLAYER.radius - 0.02);
    let hit = false;
    this.physics.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        hit = true;
        return false;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(G.PLAYER, filter),
      this.collider,
      this.body,
    );
    return hit;
  }

  private setCrouch(want: boolean) {
    if (want === this.crouching) return;
    const delta = PLAYER.halfHeight - PLAYER.crouchHalfHeight;
    if (want) {
      this.crouching = true;
      this.halfHeight = PLAYER.crouchHalfHeight;
      this.collider.setHalfHeight(this.halfHeight);
      // Keep feet planted: lower the centre (in the air, pull the feet up instead).
      if (this.grounded) this.shiftCenter(-delta);
    } else {
      const standCenter = this.curPos.clone();
      if (this.grounded) standCenter.y += delta;
      if (this.overlaps(standCenter, PLAYER.halfHeight, this.phase)) return; // no headroom
      this.crouching = false;
      this.halfHeight = PLAYER.halfHeight;
      this.collider.setHalfHeight(this.halfHeight);
      if (this.grounded) this.shiftCenter(delta);
    }
  }

  private shiftCenter(dy: number) {
    this.curPos.y += dy;
    this.prevPos.y += dy;
    this.body.setTranslation({ x: this.curPos.x, y: this.curPos.y, z: this.curPos.z }, true);
  }

  fixedUpdate(dt: number, input: MoveInput) {
    this.prevPos.copy(this.curPos);
    this.wasGrounded = this.grounded;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.frozen) {
      this.velocity.set(0, 0, 0);
      this.body.setNextKinematicTranslation({ x: this.curPos.x, y: this.curPos.y, z: this.curPos.z });
      return;
    }

    this.speedMul = 1;
    this.frictionMul = 1;
    for (const m of this.mods.values()) {
      this.speedMul *= m.speed;
      this.frictionMul *= m.friction;
    }
    this.setCrouch(input.crouch);
    this.crouchT += ((this.crouching ? 1 : 0) - this.crouchT) * Math.min(1, dt * 12);

    // Desired horizontal direction in world space.
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    let wx = input.x * cos - input.z * sin;
    let wz = -input.x * sin - input.z * cos;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const swimming = this.inWater > 0.6;
    let speed = this.crouching ? PLAYER.crouchSpeed : input.sprint && input.z > 0 ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (swimming) speed = input.sprint ? 4.2 : 2.8;
    speed *= this.speedMul;

    const v = this.velocity;
    if (this.grounded || swimming) {
      const accel = (swimming ? 10 : PLAYER.groundAccel) * Math.min(1, this.frictionMul);
      const tx = wx * speed;
      const tz = wz * speed;
      let dx = tx - v.x;
      let dz = tz - v.z;
      const dl = Math.hypot(dx, dz);
      const maxStep = (wl > 0.01 ? accel : PLAYER.groundFriction * this.frictionMul * Math.max(2, Math.hypot(v.x, v.z))) * dt;
      if (dl > maxStep) {
        dx *= maxStep / dl;
        dz *= maxStep / dl;
      }
      v.x += dx;
      v.z += dz;
    } else {
      // Air control: can steer, can't exceed max(current, target) speed.
      const before = Math.hypot(v.x, v.z);
      v.x += wx * PLAYER.airAccel * dt;
      v.z += wz * PLAYER.airAccel * dt;
      const after = Math.hypot(v.x, v.z);
      const cap = Math.max(before, speed);
      if (after > cap) {
        v.x *= cap / after;
        v.z *= cap / after;
      }
    }

    const g = PHYSICS.gravity * PLAYER.gravityScale * this.gravityMul;
    if (swimming) {
      // Buoyancy roughly cancels gravity; Space swims up, crouch dives.
      const up = this.jumpHeld ? 3 : input.crouch ? -3 : 0.3;
      v.y += (up - v.y) * Math.min(1, dt * 3);
    } else if (!this.noGravity) {
      v.y += g * dt;
    }
    v.y = Math.max(v.y, -55);

    // Jump (with coyote time and buffering).
    if (this.jumpBuffer > 0 && (this.grounded || this.airTime < PLAYER.coyoteTime) && !this.jumping && !swimming) {
      v.y = Math.sqrt(2 * -g * PLAYER.jumpHeight);
      this.jumpBuffer = 0;
      this.jumping = true;
      this.grounded = false;
      this.airTime = PLAYER.coyoteTime;
      this.onJump?.();
    }

    const desired = { x: v.x * dt, y: v.y * dt, z: v.z * dt };
    if (this.jumping || swimming) this.kcc.disableSnapToGround();
    else this.kcc.enableSnapToGround(PLAYER.snapToGround);
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.moveGroups());
    const mv = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();

    this.groundCollider = null;
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const c = this.kcc.computedCollision(i);
      if (!c) continue;
      if (c.normal1.y > 0.5) {
        this.groundNormal.set(c.normal1.x, c.normal1.y, c.normal1.z);
        this.groundCollider = c.collider ?? null;
      }
    }

    // Velocity correction from what actually happened.
    if (v.y > 0 && mv.y < desired.y * 0.5 && !this.grounded) v.y = 0; // bumped head
    if (dt > 0) {
      const reqH = Math.hypot(desired.x, desired.z);
      const gotH = Math.hypot(mv.x, mv.z);
      if (gotH < reqH * 0.98) {
        v.x = mv.x / dt;
        v.z = mv.z / dt;
      }
    }
    if (this.grounded) {
      if (!this.wasGrounded && this.lastFallSpeed > 1.5) this.onLand?.(this.lastFallSpeed);
      if (v.y < 0) v.y = 0;
      this.airTime = 0;
      this.jumping = false;
    } else {
      this.airTime += dt;
      if (v.y < 0) this.jumping = false;
      this.lastFallSpeed = Math.max(0, -v.y);
    }

    this.curPos.set(this.curPos.x + mv.x, this.curPos.y + mv.y, this.curPos.z + mv.z);
    if (this.waterFloor !== null) {
      const feetY = this.curPos.y - this.halfHeight - PLAYER.radius;
      if (feetY < this.waterFloor && v.y <= 0.5) {
        this.curPos.y += this.waterFloor - feetY;
        if (!this.grounded && this.lastFallSpeed > 1.5) this.onLand?.(this.lastFallSpeed);
        v.y = Math.max(0, v.y);
        this.grounded = true;
        this.airTime = 0;
        this.jumping = false;
      }
    }
    this.body.setNextKinematicTranslation({ x: this.curPos.x, y: this.curPos.y, z: this.curPos.z });

    // Footsteps.
    if (this.grounded) {
      const hs = Math.hypot(mv.x, mv.z);
      this.stepDist += hs;
      const stride = this.crouching ? 0.9 : input.sprint ? 2.4 : 1.7;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const surface = this.surfaceOf ? this.surfaceOf(this.groundCollider, this.curPos) : 'grass';
        this.onStep?.(surface);
      }
    }
  }

  /**
   * Find the nearest position where the player capsule fits, starting at the
   * given feet position: drops onto the ground below (or above, if buried),
   * then spirals outwards. Used by teleports and as the "unstuck" fallback.
   */
  findFreeSpot(feet: THREE.Vector3, maxRadius = 8, snapToGround = true): THREE.Vector3 | null {
    const hh = PLAYER.halfHeight;
    const off = hh + PLAYER.radius + 0.03;
    const filter = groups(G.PLAYER, ALL_GROUPS & ~G.PLAYER & ~G.SENSOR & ~G.DEBRIS & ~G.NPC);
    const down = new THREE.Vector3(0, -1, 0);
    const test = new THREE.Vector3();
    const center = new THREE.Vector3();
    const tryAt = (x: number, y: number, z: number): THREE.Vector3 | null => {
      let fy = y;
      if (snapToGround) {
        // Look for a floor from slightly above the target down a few metres.
        const origin = test.set(x, y + 1.2, z);
        const hit = this.physics.raycast(origin, down, 30, { groups: filter, exclude: this.collider });
        if (!hit || hit.normal.y < 0.4) return null;
        fy = hit.point.y;
      }
      center.set(x, fy + off, z);
      if (this.overlaps(center, hh)) return null;
      return new THREE.Vector3(x, fy, z);
    };
    const direct = tryAt(feet.x, feet.y, feet.z);
    if (direct) return direct;
    for (let r = 0.6; r <= maxRadius; r += 0.6) {
      const steps = Math.max(8, Math.round(r * 6));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        for (const dy of [0, 1.5, 3]) {
          const p = tryAt(feet.x + Math.cos(a) * r, feet.y + dy, feet.z + Math.sin(a) * r);
          if (p) return p;
        }
      }
    }
    return null;
  }

  /** Set each frame by the game from the jump action's held state (for swimming up). */
  jumpHeld = false;

  /** Horizontal speed (m/s). */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  interpolate(alpha: number) {
    this.renderPos.copy(this.prevPos).lerp(this.curPos, alpha);
  }
}
