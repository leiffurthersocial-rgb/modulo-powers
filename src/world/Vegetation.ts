import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CANYON, LAKE, WORLD, ZONE_LIST, EXTRAS } from '../config/map';
import { G, groups } from '../config/physics';
import { RAPIER, type Physics } from '../core/Physics';
import { distToSegment, mulberry32 } from '../core/math/noise';
import type { Terrain } from './Terrain';
import { surfaceTextures } from './textures';

interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  r: number;
}

/**
 * Scattered trees and rocks (instanced). All instances get static colliders;
 * the quality preset only controls how many are *drawn* (instances are in
 * random order, so a prefix is an even subsample).
 */
export class Vegetation {
  readonly group = new THREE.Group();
  private meshes: { mesh: THREE.InstancedMesh; total: number }[] = [];
  /** Tree trunk positions, for fire-spread & lightning targeting later. */
  readonly trees: Placement[] = [];

  constructor(
    private terrain: Terrain,
    private physics: Physics,
  ) {}

  private canPlace(x: number, z: number, minClear: number): boolean {
    const t = this.terrain;
    const y = t.heightAt(x, z);
    if (y < WORLD.waterLevel + 1.2 || y > 42) return false;
    const n = t.normalAt(x, z, TMP_N);
    if (n.y < 0.86) return false;
    if (t.shape.pathMask(x, z).w > 0.25) return false;
    for (const zone of ZONE_LIST) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      if (d < zone.radius * minClear) return false;
    }
    for (const e of Object.values(EXTRAS)) if (Math.hypot(x - e.x, z - e.z) < 26) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 4) return false;
    if (t.shape.riverDistance(x, z).d < 9) return false;
    if (distToSegment(x, z, CANYON.ax, CANYON.az, CANYON.bx, CANYON.bz).d < CANYON.width) return false;
    return true;
  }

  build(): THREE.Group {
    const rnd = mulberry32(31337);
    const half = WORLD.size / 2 - 20;
    const pines: Placement[] = [];
    const oaks: Placement[] = [];
    const rocks: Placement[] = [];
    // Jittered grid with clustered density from noise (forests and clearings).
    const step = 9;
    for (let gz = -half; gz < half; gz += step) {
      for (let gx = -half; gx < half; gx += step) {
        const x = gx + rnd() * step;
        const z = gz + rnd() * step;
        const forest = this.terrain.shape.noise.fbm(x * 0.008 + 50, z * 0.008 - 20, 2) * 0.5 + 0.5;
        const roll = rnd();
        if (roll < forest * 0.55 - 0.08) {
          if (!this.canPlace(x, z, 0.95)) continue;
          const p = { x, y: this.terrain.heightAt(x, z), z, s: 0.75 + rnd() * 0.6, r: rnd() * Math.PI * 2 };
          (Math.hypot(x, z) > 200 || rnd() < 0.45 ? pines : oaks).push(p);
        } else if (roll > 0.955) {
          if (!this.canPlace(x, z, 0.6)) continue;
          rocks.push({ x, y: this.terrain.heightAt(x, z), z, s: 0.5 + rnd() * rnd() * 2.2, r: rnd() * Math.PI * 2 });
        }
      }
    }
    this.trees.push(...pines, ...oaks);

    const bark = surfaceTextures('bark');
    const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, roughness: 0.95, color: 0xffffff });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x1f3a1c, roughness: 0.9, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a5e22, roughness: 0.85, flatShading: true });
    const stone = surfaceTextures('stone');
    const rockMat = new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, roughness: 0.9, color: 0x9a948c });

    this.addInstanced(this.pineGeometry(), [barkMat, pineMat], pines, true);
    this.addInstanced(this.oakGeometry(rnd), [barkMat, leafMat], oaks, true);
    this.addInstanced(this.rockGeometry(rnd), rockMat, rocks, false);

    // Colliders.
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const t of this.trees) {
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cylinder(2.5 * t.s, 0.22 * t.s)
          .setTranslation(t.x, t.y + 2.4 * t.s, t.z)
          .setCollisionGroups(groups(G.STATIC)),
        body,
      );
    }
    for (const r of rocks) {
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.ball(0.85 * r.s).setTranslation(r.x, r.y + 0.15 * r.s, r.z).setCollisionGroups(groups(G.STATIC)).setFriction(0.9),
        body,
      );
    }
    return this.group;
  }

  private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], list: Placement[], tree: boolean) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    list.forEach((it, i) => {
      q.setFromAxisAngle(UP, it.r);
      if (!tree) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(it.r * 0.7, 0, it.r * 0.3)));
      s.set(it.s, it.s * (tree ? 1 : 0.7), it.s);
      p.set(it.x, it.y - (tree ? 0.1 : 0.2 * it.s), it.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = list.length;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.meshes.push({ mesh, total: list.length });
    this.group.add(mesh);
  }

  setDensity(d: number) {
    for (const { mesh, total } of this.meshes) mesh.count = Math.floor(total * d);
  }

  private pineGeometry(): THREE.BufferGeometry {
    const trunk = new THREE.CylinderGeometry(0.14, 0.24, 5, 7);
    trunk.translate(0, 2.5, 0);
    const parts = [trunk];
    const foliage: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const c = new THREE.ConeGeometry(1.9 - i * 0.38, 2.6, 8);
      c.translate(0, 2.6 + i * 1.35, 0);
      foliage.push(c);
    }
    return this.withGroups(parts, foliage);
  }

  private oakGeometry(rnd: () => number): THREE.BufferGeometry {
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 7);
    trunk.translate(0, 2, 0);
    const foliage: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.IcosahedronGeometry(1.3 + rnd() * 0.6, 1);
      b.translate((rnd() - 0.5) * 2, 4.3 + rnd() * 1.4, (rnd() - 0.5) * 2);
      foliage.push(b);
    }
    return this.withGroups([trunk], foliage);
  }

  /** Merge into one geometry with group 0 = bark, group 1 = leaves. */
  private withGroups(a: THREE.BufferGeometry[], b: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const norm = (g: THREE.BufferGeometry) => {
      const ng = g.index ? g.toNonIndexed() : g;
      ng.deleteAttribute('uv');
      ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
      return ng;
    };
    const ga = mergeGeometries(a.map(norm))!;
    const gb = mergeGeometries(b.map(norm))!;
    // Bark UVs: cylindrical.
    const pos = ga.attributes.position;
    const uv = ga.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, Math.atan2(pos.getZ(i), pos.getX(i)) / Math.PI, pos.getY(i) * 0.5);
    const merged = mergeGeometries([ga, gb], true)!;
    merged.computeVertexNormals();
    return merged;
  }

  private rockGeometry(rnd: () => number): THREE.BufferGeometry {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    const seed = rnd() * 100;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = this.terrain.shape.detail.noise(v.x * 1.7 + seed, v.z * 1.7 + v.y * 1.3) * 0.22;
      v.multiplyScalar(1 + n);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    // Planar UVs for the stone texture.
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + pos.getY(i) * 0.5, pos.getZ(i) + pos.getY(i) * 0.5);
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP_N = new THREE.Vector3();
