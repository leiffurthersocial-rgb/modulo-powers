import * as THREE from 'three';
import type { ZoneDef } from '../../config/map';
import type { Game } from '../../core/Game';
import type { PropSpec } from '../Entity';

/** Helpers shared by zone builders. */
export class ZoneKit {
  constructor(
    readonly game: Game,
    readonly zone: ZoneDef,
  ) {}

  /** Absolute XZ from zone-relative offsets. */
  x(dx: number) {
    return this.zone.x + dx;
  }
  z(dz: number) {
    return this.zone.z + dz;
  }

  /** Ground height at a zone-relative position. */
  gy(dx: number, dz: number): number {
    return this.game.world.heightAt(this.zone.x + dx, this.zone.z + dz);
  }

  /** World point at a zone-relative position, `up` metres above the ground. */
  p(dx: number, dz: number, up = 0): THREE.Vector3 {
    return new THREE.Vector3(this.x(dx), this.gy(dx, dz) + up, this.z(dz));
  }

  /** Spawn a prop at a zone-relative position, on the ground (+ `up`). */
  spawn(type: string, dx: number, dz: number, up = 0, extra: Partial<PropSpec> = {}) {
    return this.game.entities.spawn({ type, x: this.x(dx), y: this.gy(dx, dz) + up, z: this.z(dz), ...extra });
  }
}
