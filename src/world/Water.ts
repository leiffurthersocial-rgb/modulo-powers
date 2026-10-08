import * as THREE from 'three';
import { LAKE, POND, RIVER, WORLD } from '../config/map';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import { FX } from '../systems/Particles';
import type { Entity } from './Entity';
import { POND_LEVEL } from './terrainShape';

export class WaterBody {
  /** Seconds of remaining electrification. */
  electrified = 0;
  readonly origin = new THREE.Vector3();

  constructor(
    readonly name: string,
    readonly level: number,
    private region: (x: number, z: number) => boolean,
    private game: Game,
  ) {}

  /** Is (x, z) over this body's water (terrain below the surface)? */
  containsXZ(x: number, z: number): boolean {
    return this.region(x, z) && this.game.world.heightAt(x, z) < this.level - 0.05;
  }

  /** Is the point under (or within `margin` above) the surface? */
  contains(p: THREE.Vector3, margin = 0): boolean {
    return p.y < this.level + margin && this.containsXZ(p.x, p.z);
  }

  depthAt(x: number, z: number): number {
    return this.level - this.game.world.heightAt(x, z);
  }
}

/**
 * All water bodies (lake, river, pond): buoyancy and drag on props, river
 * current, swimming, and electrified water (lightning conducts to everything
 * in the same body).
 */
export class WaterSystem implements GameSystem {
  readonly bodies: WaterBody[] = [];
  readonly lake: WaterBody;
  readonly river: WaterBody;
  readonly pond: WaterBody;
  private zapTimer = 0;
  private tmp = new THREE.Vector3();
  private shockCooldown = 0;

  constructor(private game: Game) {
    const shape = game.world.terrain.shape;
    this.lake = new WaterBody('lake', WORLD.waterLevel, (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 1.3, game);
    this.river = new WaterBody('river', WORLD.waterLevel, (x, z) => shape.riverDistance(x, z).d < RIVER.width * 0.5 + 2 && Math.hypot(x - LAKE.x, z - LAKE.z) >= LAKE.radius * 1.3, game);
    this.pond = new WaterBody('pond', POND_LEVEL, (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.radius, game);
    this.bodies.push(this.lake, this.river, this.pond);
  }

  /** Water body containing this point (or null). */
  bodyAt(p: THREE.Vector3, margin = 0): WaterBody | null {
    for (const b of this.bodies) if (b.contains(p, margin)) return b;
    return null;
  }

  /** Water body under this XZ position regardless of height. */
  bodyUnder(x: number, z: number): WaterBody | null {
    for (const b of this.bodies) if (b.containsXZ(x, z)) return b;
    return null;
  }

  /** The lake and river are connected, so electrifying one electrifies both. */
  private linked(b: WaterBody): WaterBody[] {
    return b === this.pond ? [b] : [this.lake, this.river];
  }

  electrify(body: WaterBody, seconds: number, origin: THREE.Vector3) {
    for (const b of this.linked(body)) {
      b.electrified = Math.max(b.electrified, seconds);
      b.origin.copy(origin);
    }
    audio.crackle(origin, 1);
  }

  /** River flow direction at a point (unit vector, zero outside the river). */
  current(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    const shape = this.game.world.terrain.shape;
    const r = shape.riverDistance(x, z);
    if (r.d > RIVER.width * 0.5 + 1) return out;
    const a = RIVER.points[r.seg];
    const b = RIVER.points[r.seg + 1];
    out.set(b[0] - a[0], 0, b[1] - a[1]).normalize();
    return out.multiplyScalar(RIVER.current);
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    // Buoyancy + drag for dynamic props.
    for (const e of g.entities.list) {
      if (!e.body || !e.body.isDynamic() || e.dead) continue;
      const c = e.center(this.tmp);
      const body = this.bodyAt(c, e.radius);
      if (!body) continue;
      this.applyWaterForces(e, body, c, dt);
    }
    // Player swimming.
    const feet = g.player.feet(this.tmp);
    const pb = this.bodyAt(feet, 0);
    if (pb) {
      const depth = pb.level - feet.y;
      g.player.inWater = Math.max(0, Math.min(1, depth / 1.3));
      if (pb === this.river && g.player.inWater > 0.3) {
        const cur = this.current(feet.x, feet.z, TMP_CUR);
        g.player.velocity.addScaledVector(cur, dt * 1.2);
      }
    } else {
      g.player.inWater = 0;
    }
  }

  private applyWaterForces(e: Entity, body: WaterBody, c: THREE.Vector3, dt: number) {
    const rb = e.body!;
    const r = Math.max(0.15, e.radius * 0.75);
    const submerged = Math.max(0, Math.min(1, (body.level - (c.y - r)) / (2 * r)));
    if (submerged <= 0) return;
    let displaced = 0;
    for (const col of e.colliders) displaced += col.volume();
    if (e.frozen > 0.5) displaced *= 1.1;
    const buoy = 1000 * 9.81 * displaced * submerged;
    // Cap so very light props don't rocket out of the water.
    const maxUp = rb.mass() * 9.81 * 2.2;
    rb.applyImpulse({ x: 0, y: Math.min(buoy, maxUp) * dt, z: 0 }, true);
    // Drag (linear + angular).
    const v = rb.linvel();
    const k = Math.min(0.9, 2.5 * submerged * dt * (1 + 4 / Math.max(1, rb.mass() / 10)));
    rb.setLinvel({ x: v.x * (1 - k), y: v.y * (1 - k * 1.5), z: v.z * (1 - k) }, true);
    const w = rb.angvel();
    rb.setAngvel({ x: w.x * (1 - k), y: w.y * (1 - k), z: w.z * (1 - k) }, true);
    // River current.
    if (body === this.river) {
      const cur = this.current(c.x, c.z, TMP_CUR);
      rb.applyImpulse({ x: cur.x * rb.mass() * dt * 0.8, y: 0, z: cur.z * rb.mass() * dt * 0.8 }, true);
    }
    // Things in water get wet (and stop burning).
    if (submerged > 0.3) {
      if (e.burning) this.game.reactions.apply(e, 'water', 1);
      e.wetness = 1;
    }
  }

  update(dt: number) {
    if (dt <= 0) return;
    const g = this.game;
    this.shockCooldown -= dt;
    this.zapTimer -= dt;
    const tick = this.zapTimer <= 0;
    if (tick) this.zapTimer = 0.2;
    for (const b of this.bodies) {
      if (b.electrified <= 0) continue;
      b.electrified -= dt;
      if (!tick) continue;
      const strength = Math.min(1, b.electrified / 2);
      // Surface crackle around the strike point.
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 14;
        const x = b.origin.x + Math.cos(ang) * rad;
        const z = b.origin.z + Math.sin(ang) * rad;
        if (!b.containsXZ(x, z)) continue;
        const p = this.tmp.set(x, b.level + 0.05, z);
        const q = TMP_Q.set(x + (Math.random() - 0.5) * 3, b.level + 0.05, z + (Math.random() - 0.5) * 3);
        g.bolts.spawn(p, q, { width: 0.03, jag: 0.35, detail: 4, life: 0.12, intensity: strength, forkChance: 0.2 });
        g.particles.emit(FX.electric, p, 4, { spread: Math.PI / 2, speed: [1, 3] });
        g.lights.add(p, 0x8fc8ff, 6 * strength, 8);
      }
      if (Math.random() < 0.5) audio.crackle(b.origin, 0.4 * strength);
      // Everything standing in the water takes the charge.
      for (const e of g.entities.list) {
        if (e.dead) continue;
        const c = e.center(this.tmp);
        if (!b.contains(c, e.radius + 0.3)) continue;
        g.reactions.apply(e, 'lightning', 0.25 * strength, c);
        g.particles.emit(FX.electric, c, 5, { spread: Math.PI, speed: [1, 4], jitter: e.radius });
        if (Math.random() < 0.4) g.bolts.spawn(c, TMP_Q.set(c.x, b.level, c.z).add(RAND.set(Math.random() - 0.5, 0, Math.random() - 0.5)), { width: 0.03, detail: 3, life: 0.1 });
      }
      // The player too, if they're in it.
      const feet = g.player.feet(this.tmp);
      if (b.contains(feet, 0.15) && this.shockCooldown <= 0) {
        this.shockCooldown = 0.8;
        g.shockPlayer(0.5 * strength);
      }
    }
  }

  reset() {
    for (const b of this.bodies) b.electrified = 0;
  }
}

const TMP_CUR = new THREE.Vector3();
const TMP_Q = new THREE.Vector3();
const RAND = new THREE.Vector3();
