import * as THREE from 'three';
import { G, groups } from '../config/physics';
import { WORLD, ZONES } from '../config/map';
import { audio, type LoopHandle } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import { smoothstep } from '../core/math/noise';
import { RAPIER } from '../core/Physics';
import type { Entity } from '../world/Entity';
import { FX } from './Particles';

const CELL = 2.5;

interface GroundCell {
  x: number;
  y: number;
  z: number;
  fuel: number;
  /** Seconds of burning left (0 = burnt out). */
  burn: number;
}

/**
 * Fire simulation.
 *
 * Entities: burning consumes fuel, chars the surface, keeps the object hot,
 * radiates heat to neighbours (which ignite when they pass their ignition
 * temperature), lights the ground beneath, weakens structures (static
 * "collapsible" pieces turn dynamic and fall) and finally burns out.
 *
 * Ground: a sparse grid of grass cells. Dry grass (Fire zone, hay field) burns
 * hot and spreads quickly; ordinary grass burns briefly and rarely spreads.
 */
export class FireSystem implements GameSystem {
  readonly burning = new Set<Entity>();
  private cells = new Map<number, GroundCell>();
  private burningCells: GroundCell[] = [];
  private tick = 0;
  private roar: LoopHandle | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private near: Entity[] = [];
  /** Max simultaneously burning ground cells (performance cap). */
  maxCells = 260;

  constructor(private game: Game) {
    game.reactions.onIgnite = (e) => this.onIgnite(e);
    game.reactions.onExtinguish = (e) => this.burning.delete(e);
    game.reactions.registerSurfaceEffect('igniteGrass', (c, r, amt) => this.igniteGround(c, r, amt));
    game.reactions.registerSurfaceEffect('extinguishGround', (c, r) => this.extinguishGround(c, r));
  }

  private onIgnite(e: Entity) {
    this.burning.add(e);
    const p = e.center(this.tmp);
    audio.ignite(p, Math.min(1, 0.3 + e.radius * 0.4));
    this.game.particles.emit(FX.fire, p, 12, { spread: Math.PI, speed: [0.5, 2], jitter: e.radius * 0.6 });
  }

  /** How much fuel the grass at (x, z) has (0 = none). */
  grassFuel(x: number, z: number): number {
    const w = this.game.world;
    const y = w.heightAt(x, z);
    if (y < WORLD.waterLevel + 0.4 || y > 18) return 0;
    if (this.game.water.bodyUnder(x, z)) return 0;
    const shape = w.terrain.shape;
    if (shape.pathSurface(x, z) > 0.4) return 0;
    if (Math.hypot(x - ZONES.hub.x, z - ZONES.hub.z) < 23) return 0;
    if (w.terrain.normalAt(x, z, this.tmp2).y < 0.8) return 0;
    const fz = ZONES.fire;
    const dry = 1 - smoothstep(fz.radius * 0.7, fz.radius * 1.15, Math.hypot(x - fz.x, z - fz.z));
    return Math.max(0.16, dry);
  }

  private key(ix: number, iz: number) {
    return ix * 100000 + iz;
  }

  /** Ignite grass in a radius. */
  igniteGround(c: THREE.Vector3, radius: number, amount = 1) {
    const r = Math.max(CELL * 0.5, radius * 0.6);
    // Only ignite when the source is close to the ground.
    const gy = this.game.world.heightAt(c.x, c.z);
    if (c.y - gy > radius + 1.5) return;
    for (let x = c.x - r; x <= c.x + r; x += CELL) {
      for (let z = c.z - r; z <= c.z + r; z += CELL) {
        if ((x - c.x) ** 2 + (z - c.z) ** 2 > r * r) continue;
        if (Math.random() > Math.min(1, amount * 2)) continue;
        this.igniteCell(Math.round(x / CELL), Math.round(z / CELL));
      }
    }
  }

  private igniteCell(ix: number, iz: number): boolean {
    const k = this.key(ix, iz);
    if (this.cells.has(k) || this.burningCells.length >= this.maxCells) return false;
    const x = ix * CELL;
    const z = iz * CELL;
    const fuel = this.grassFuel(x, z);
    if (fuel <= 0) return false;
    const cell: GroundCell = { x, z, y: this.game.world.heightAt(x, z), fuel, burn: 3 + fuel * 9 };
    this.cells.set(k, cell);
    this.burningCells.push(cell);
    return true;
  }

  extinguishGround(c: THREE.Vector3, radius: number) {
    const r2 = (radius + CELL) ** 2;
    let n = 0;
    for (const cell of this.burningCells) {
      if ((cell.x - c.x) ** 2 + (cell.z - c.z) ** 2 < r2 && cell.burn > 0) {
        cell.burn = 0;
        n++;
      }
    }
    if (n > 0) this.game.reactions.steam(c, Math.min(2, n * 0.3));
  }

  fixedUpdate(dt: number) {
    this.tick -= dt;
    const doTick = this.tick <= 0;
    if (doTick) this.tick = 0.25;
    const g = this.game;
    // Burning entities.
    for (const e of this.burning) {
      if (e.dead || !e.burning) {
        this.burning.delete(e);
        continue;
      }
      const size = Math.max(0.25, Math.cbrt(e.volume));
      e.fuel -= (dt * e.mat.burnRate) / size;
      e.char = Math.min(1, e.char + dt * 0.07);
      e.temperature = Math.max(e.temperature, 650);
      e.integrity = Math.max(0, e.integrity - dt * 0.012);
      if (e.isStatic && e.tags.has('collapsible') && e.integrity < 0.55) this.collapse(e);
      if (doTick) {
        const c = e.center(this.tmp);
        // Radiant heat to neighbours.
        const reach = e.radius + 2.2;
        for (const o of g.entities.nearby(c, reach, this.near)) {
          if (o === e || o.burning) continue;
          const d = Math.max(0.3, o.center(this.tmp2).distanceTo(c) - o.radius - e.radius * 0.5);
          g.reactions.apply(o, 'heat', (70 * Math.min(2, size)) / (1 + d * d * 0.5), c);
        }
        // Ignite the grass underneath.
        const gy = g.world.heightAt(c.x, c.z);
        if (c.y - e.radius - gy < 1) this.igniteGround(c, e.radius + 1, 0.3);
      }
      if (e.fuel <= 0) this.burnOut(e);
    }
    // Ground fires.
    if (doTick) {
      for (let i = this.burningCells.length - 1; i >= 0; i--) {
        const cell = this.burningCells[i];
        cell.burn -= 0.25;
        if (cell.burn <= 0) {
          g.decals.add('burnt', this.tmp.set(cell.x, cell.y, cell.z), g.world.terrain.normalAt(cell.x, cell.z, this.tmp2), CELL * 1.6, 120, 0.9);
          this.burningCells[i] = this.burningCells[this.burningCells.length - 1];
          this.burningCells.pop();
          continue;
        }
        // Spread to neighbours.
        const ix = Math.round(cell.x / CELL);
        const iz = Math.round(cell.z / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dz) continue;
            const k = this.key(ix + dx, iz + dz);
            if (this.cells.has(k)) continue;
            const f = this.grassFuel((ix + dx) * CELL, (iz + dz) * CELL);
            if (Math.random() < f * f * 0.4) this.igniteCell(ix + dx, iz + dz);
          }
        }
        // Heat props standing in the fire.
        const p = this.tmp.set(cell.x, cell.y + 0.5, cell.z);
        for (const o of g.entities.nearby(p, CELL, this.near)) g.reactions.apply(o, 'fire', 0.25, p);
      }
    }
  }

  /** A static structural piece weakened by fire breaks loose and falls. */
  collapse(e: Entity) {
    if (!e.body) return;
    e.isStatic = false;
    e.tags.delete('collapsible');
    e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    for (const c of e.colliders) {
      c.setCollisionGroups(groups(G.DYNAMIC));
      c.setDensity(e.mat.density * 0.3);
    }
    this.game.physics.sync(e.body, e.object);
    e.body.applyImpulse({ x: (Math.random() - 0.5) * 50, y: 0, z: (Math.random() - 0.5) * 50 }, true);
    audio.shatter(e.center(this.tmp), 'wood', 0.8);
  }

  private burnOut(e: Entity) {
    e.burning = false;
    e.fuel = 0;
    e.char = 1;
    this.burning.delete(e);
    if (e.onBurnout) {
      e.onBurnout();
      return;
    }
    const c = e.center(this.tmp);
    if (e.volume < 0.8 && !e.isStatic) {
      // Small props are consumed: crumble into embers and ash.
      this.game.particles.emit(FX.ember, c, 25, { spread: Math.PI, speed: [0.5, 3], jitter: e.radius });
      this.game.particles.emit(FX.smoke, c, 6, { spread: 0.5, speed: [0.3, 1], jitter: e.radius * 0.5 });
      const gy = this.game.world.heightAt(c.x, c.z);
      if (c.y - gy < 2) this.game.decals.add('burnt', this.tmp2.set(c.x, gy, c.z), UP, 1 + e.radius * 2, 90);
      this.game.entities.remove(e);
    } else if (e.isStatic && e.tags.has('collapsible')) {
      this.collapse(e);
    }
  }

  update(dt: number) {
    if (dt <= 0) return;
    const g = this.game;
    const cam = g.camera.position;
    let nearest = Infinity;
    const nearestPos = this.tmp2;
    let total = 0;
    for (const e of this.burning) {
      const c = e.center(this.tmp);
      const size = Math.min(3, Math.max(0.3, e.radius));
      const f = Math.min(1, e.fuel * 3 + 0.3);
      const top = TMP_T.copy(c).setY(c.y + size * 0.35);
      g.particles.emit(FX.fire, top, dt * 130 * size * f, { spread: 0.4, speed: [0.5, 1.8], jitter: size * 0.5, sizeMul: 0.8 + size * 0.5 });
      g.particles.emit(FX.flame, top, dt * 25 * size * f, { spread: 0.3, speed: [0.5, 1.5], jitter: size * 0.4, sizeMul: 0.7 + size * 0.3 });
      g.particles.emit(FX.smoke, c, dt * 8 * size, { spread: 0.3, speed: [0.5, 1.2], jitter: size * 0.4, inherit: UP_HALF });
      g.particles.emit(FX.ember, c, dt * 3 * size, { spread: 0.8, speed: [1, 3], jitter: size * 0.5 });
      g.lights.add(TMP_L.copy(c).setY(c.y + size * 0.6), 0xff7a2a, (5 + size * 6) * (0.8 + Math.random() * 0.4), 6 + size * 4);
      const d = c.distanceTo(cam);
      total += size / Math.max(1, d * 0.3);
      if (d < nearest) {
        nearest = d;
        nearestPos.copy(c);
      }
    }
    for (const cell of this.burningCells) {
      const f = Math.min(1, cell.burn / 3) * (0.4 + cell.fuel * 0.6);
      const p = this.tmp.set(cell.x, cell.y + 0.25, cell.z);
      g.particles.emit(FX.fire, p, dt * 30 * f, { spread: 0.4, speed: [0.3, 1.2], jitter: CELL * 0.45, sizeMul: 0.8 + cell.fuel * 0.5 });
      if (Math.random() < dt * 3) g.particles.emit(FX.smoke, p, 1, { spread: 0.3, speed: [0.5, 1], jitter: CELL * 0.4 });
      if (Math.random() < 0.3) g.lights.add(p, 0xff6a20, 6 * f, 8);
      const d = p.distanceTo(cam);
      total += (0.25 * f) / Math.max(1, d * 0.3);
      if (d < nearest) {
        nearest = d;
        nearestPos.copy(p);
      }
    }
    // One positional roar loop at the nearest fire, loudness from all fires around.
    if (total > 0.02) {
      if (!this.roar) this.roar = audio.loop({ freq: 700, filter: 'lowpass', brown: true, ref: 6, volume: 1.4, lfo: { rate: 7, depth: 0.25 } });
      this.roar.setPosition(nearestPos.x, nearestPos.y, nearestPos.z);
      this.roar.setLevel(Math.min(1, total));
      if (Math.random() < dt * 6 * Math.min(1, total)) audio.crackle(nearestPos, 0.15);
    } else if (this.roar) {
      this.roar.stop(0.5);
      this.roar = null;
    }
  }

  /** Is the point inside a ground fire (used for player heat / stealth light)? */
  heatAt(p: THREE.Vector3): number {
    let h = 0;
    for (const c of this.burningCells) {
      const d2 = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (d2 < CELL * CELL * 2) h += c.fuel;
    }
    return h;
  }

  reset() {
    this.burning.clear();
    this.cells.clear();
    this.burningCells.length = 0;
    this.roar?.stop(0.2);
    this.roar = null;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const UP_HALF = new THREE.Vector3(0, 0.5, 0);
const TMP_L = new THREE.Vector3();
const TMP_T = new THREE.Vector3();
