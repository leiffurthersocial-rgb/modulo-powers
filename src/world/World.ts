import * as THREE from 'three';
import { ZONES } from '../config/map';
import type { Physics } from '../core/Physics';
import { Terrain } from './Terrain';
import { Vegetation } from './Vegetation';

/**
 * Builds and owns the static world: terrain, vegetation and water surfaces.
 * Zone content (props, structures, puzzles) is added by the zone builders.
 */
export class World {
  readonly terrain = new Terrain();
  readonly vegetation: Vegetation;
  readonly group = new THREE.Group();
  readonly spawn: THREE.Vector3;

  constructor(
    private physics: Physics,
    scene: THREE.Scene,
  ) {
    this.terrain.buildCollider(physics);
    this.group.add(this.terrain.buildMesh());
    this.vegetation = new Vegetation(this.terrain, physics);
    this.group.add(this.vegetation.build());
    scene.add(this.group);
    const hub = ZONES.hub;
    this.spawn = new THREE.Vector3(hub.x, this.terrain.heightAt(hub.x, hub.z + 8), hub.z + 8);
  }

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** Physics accessor for builders. */
  get physicsWorld() {
    return this.physics;
  }
}
