import * as THREE from 'three';
import { LAKE, POND, RIVER, WORLD, ZONES } from '../config/map';
import type { Physics } from '../core/Physics';
import { Terrain } from './Terrain';
import { Vegetation } from './Vegetation';
import { POND_LEVEL } from './terrainShape';

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
    this.buildWaterPlaceholders();
    scene.add(this.group);
    const hub = ZONES.hub;
    this.spawn = new THREE.Vector3(hub.x, this.terrain.heightAt(hub.x, hub.z + 8), hub.z + 8);
  }

  /** Simple water surfaces (replaced by the water shader in the Water milestone). */
  private buildWaterPlaceholders() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d4f6b,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.82,
    });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE.radius * 1.25, 64), mat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(LAKE.x, WORLD.waterLevel, LAKE.z);
    this.group.add(lake);
    // River: a ribbon along the polyline.
    const pts = RIVER.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(RIVER.width + 3, len + RIVER.width), mat);
      seg.rotation.order = 'YXZ';
      seg.rotation.y = Math.atan2(bx - ax, bz - az);
      seg.rotation.x = -Math.PI / 2;
      seg.position.set((ax + bx) / 2, WORLD.waterLevel - 0.01 * i, (az + bz) / 2);
      this.group.add(seg);
    }
    const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.radius * 0.95, 48), mat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(POND.x, POND_LEVEL, POND.z);
    this.group.add(pond);
  }

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** Physics accessor for builders. */
  get physicsWorld() {
    return this.physics;
  }
}
