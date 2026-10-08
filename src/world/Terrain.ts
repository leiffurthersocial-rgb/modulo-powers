import * as THREE from 'three';
import { LAKE, POND, WORLD, ZONES } from '../config/map';
import { G, groups } from '../config/physics';
import { RAPIER, type Physics } from '../core/Physics';
import { clamp, lerp, smoothstep } from '../core/math/noise';
import { TerrainShape, POND_LEVEL } from './terrainShape';
import { makeNoiseTexture } from './textures';

const CHUNK = 40; // cells per chunk side

/**
 * Heightmap terrain. One Rapier heightfield collider covers the whole map; the
 * visual mesh is split into chunks so the GPU can frustum-cull them (including
 * in the shadow pass).
 */
export class Terrain {
  readonly shape = new TerrainShape();
  readonly n = WORLD.segments;
  readonly size = WORLD.size;
  readonly cell = WORLD.size / WORLD.segments;
  /** Row-major heights: index = iz * (n+1) + ix. */
  readonly heights: Float32Array;
  readonly group = new THREE.Group();
  collider!: RAPIER.Collider;
  material!: THREE.MeshStandardMaterial;

  constructor() {
    const n = this.n;
    const s = n + 1;
    this.heights = new Float32Array(s * s);
    const half = this.size / 2;
    for (let iz = 0; iz <= n; iz++) {
      const z = -half + iz * this.cell;
      for (let ix = 0; ix <= n; ix++) {
        const x = -half + ix * this.cell;
        this.heights[iz * s + ix] = this.shape.height(x, z);
      }
    }
  }

  /** Grid height at integer cell coords (clamped). */
  private h(ix: number, iz: number): number {
    const s = this.n + 1;
    ix = ix < 0 ? 0 : ix > this.n ? this.n : ix;
    iz = iz < 0 ? 0 : iz > this.n ? this.n : iz;
    return this.heights[iz * s + ix];
  }

  /** Terrain surface height at world (x, z), matching the physics triangles closely. */
  heightAt(x: number, z: number): number {
    const half = this.size / 2;
    const fx = (x + half) / this.cell;
    const fz = (z + half) / this.cell;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h00 = this.h(ix, iz);
    const h10 = this.h(ix + 1, iz);
    const h01 = this.h(ix, iz + 1);
    const h11 = this.h(ix + 1, iz + 1);
    // Same triangle split as the mesh below (diagonal from (0,0) to (1,1)).
    if (tx >= tz) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
    return h00 + (h11 - h01) * tx + (h01 - h00) * tz;
  }

  /** Surface normal from central differences. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  buildCollider(physics: Physics) {
    const n = this.n;
    const s = n + 1;
    // Rapier wants a column-major matrix: rows along Z, columns along X.
    const cm = new Float32Array(s * s);
    for (let ix = 0; ix <= n; ix++) for (let iz = 0; iz <= n; iz++) cm[iz + ix * s] = this.heights[iz * s + ix];
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.heightfield(n, n, cm, { x: this.size, y: 1, z: this.size })
      .setFriction(0.9)
      .setCollisionGroups(groups(G.TERRAIN));
    this.collider = physics.world.createCollider(desc, body);

    // Natural-feeling map bounds: invisible walls far up the mountain slopes.
    const half = this.size / 2;
    const wall = (x: number, z: number, hx: number, hz: number) =>
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 200, hz).setTranslation(x, 100, z).setCollisionGroups(groups(G.STATIC)),
        body,
      );
    wall(0, -half + 8, half, 2);
    wall(0, half - 8, half, 2);
    wall(-half + 8, 0, 2, half);
    wall(half - 8, 0, 2, half);
  }

  buildMesh(): THREE.Group {
    const n = this.n;
    const half = this.size / 2;
    const tex = makeNoiseTexture(256, 4, 0x5eed);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: tex,
      roughness: 0.95,
      metalness: 0,
    });
    // Sample the detail texture at two scales to hide tiling.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 texA = texture2D( map, vMapUv );
          vec4 texB = texture2D( map, vMapUv * 0.173 + 0.31 );
          diffuseColor.rgb *= mix(texA.rgb, texB.rgb, 0.45) * 1.25;
        #endif`,
      );
    };
    this.material = mat;

    const chunks = Math.ceil(n / CHUNK);
    const nrm = new THREE.Vector3();
    const col = new THREE.Color();
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) {
        const x0 = cx * CHUNK;
        const z0 = cz * CHUNK;
        const x1 = Math.min(n, x0 + CHUNK);
        const z1 = Math.min(n, z0 + CHUNK);
        const w = x1 - x0 + 1;
        const d = z1 - z0 + 1;
        const pos = new Float32Array(w * d * 3);
        const nor = new Float32Array(w * d * 3);
        const clr = new Float32Array(w * d * 3);
        const uv = new Float32Array(w * d * 2);
        let k = 0;
        for (let iz = z0; iz <= z1; iz++) {
          for (let ix = x0; ix <= x1; ix++) {
            const x = -half + ix * this.cell;
            const z = -half + iz * this.cell;
            const y = this.h(ix, iz);
            pos[k * 3] = x;
            pos[k * 3 + 1] = y;
            pos[k * 3 + 2] = z;
            const e = this.cell;
            nrm.set(this.h(ix - 1, iz) - this.h(ix + 1, iz), 2 * e, this.h(ix, iz - 1) - this.h(ix, iz + 1)).normalize();
            nor[k * 3] = nrm.x;
            nor[k * 3 + 1] = nrm.y;
            nor[k * 3 + 2] = nrm.z;
            this.colorAt(x, z, y, nrm.y, col);
            clr[k * 3] = col.r;
            clr[k * 3 + 1] = col.g;
            clr[k * 3 + 2] = col.b;
            uv[k * 2] = x / 5;
            uv[k * 2 + 1] = z / 5;
            k++;
          }
        }
        const idx: number[] = [];
        for (let iz = 0; iz < d - 1; iz++) {
          for (let ix = 0; ix < w - 1; ix++) {
            const a = iz * w + ix;
            const b = a + 1;
            const c = a + w;
            const e2 = c + 1;
            // Diagonal a→e2, matching heightAt().
            idx.push(a, c, e2, a, e2, b);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        // Only chunks near the playable area cast shadows (mountains are far away).
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
      }
    }
    this.group.name = 'terrain';
    return this.group;
  }

  /** Biome colouring (linear-space colours). */
  private colorAt(x: number, z: number, y: number, ny: number, out: THREE.Color): THREE.Color {
    const sh = this.shape;
    const n1 = sh.detail.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
    const n2 = sh.noise.noise(x * 0.11, z * 0.11) * 0.5 + 0.5;

    // Grass base: blend of lush and dry greens.
    out.setRGB(lerp(0.075, 0.13, n1), lerp(0.16, 0.2, n1), lerp(0.035, 0.055, n1));

    // Zone tints.
    const tint = (zoneX: number, zoneZ: number, radius: number, r: number, g: number, b: number, amt = 1) => {
      const w = (1 - smoothstep(radius * 0.6, radius * 1.2, Math.hypot(x - zoneX, z - zoneZ))) * amt;
      if (w > 0) out.lerp(TMP.setRGB(r, g, b), w);
    };
    tint(ZONES.fire.x, ZONES.fire.z, ZONES.fire.radius, 0.3, 0.25, 0.08, 0.85); // dry grass
    tint(ZONES.shadow.x, ZONES.shadow.z, ZONES.shadow.radius, 0.05, 0.08, 0.04, 0.8);
    tint(ZONES.earth.x, ZONES.earth.z, ZONES.earth.radius, 0.22, 0.13, 0.07, 0.75);
    tint(ZONES.lightning.x, ZONES.lightning.z, ZONES.lightning.radius, 0.08, 0.13, 0.08, 0.6);
    tint(ZONES.water.x, ZONES.water.z, ZONES.water.radius, 0.05, 0.17, 0.04, 0.5);
    tint(ZONES.hub.x, ZONES.hub.z, ZONES.hub.radius, 0.16, 0.17, 0.1, 0.5);

    // Small patchy variation.
    out.multiplyScalar(lerp(0.85, 1.12, n2));

    // Dirt paths.
    const p = sh.pathSurface(x, z);
    if (p > 0) out.lerp(TMP.setRGB(0.2, 0.14, 0.08), p * 0.9);

    // Rock on steep slopes and in the canyon walls.
    const steep = smoothstep(0.82, 0.62, ny);
    if (steep > 0) {
      const earthy = 1 - smoothstep(40, 90, Math.hypot(x - ZONES.earth.x, z - ZONES.earth.z));
      TMP.setRGB(lerp(0.17, 0.26, earthy), lerp(0.16, 0.15, earthy), lerp(0.15, 0.1, earthy)).multiplyScalar(lerp(0.8, 1.1, n2));
      out.lerp(TMP, steep);
    }

    // Shorelines (lake, river, pond): sand above water, mud below.
    const nearLake = Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 1.4 || sh.riverDistance(x, z).d < 12;
    if (nearLake) {
      const sand = 1 - smoothstep(WORLD.waterLevel + 0.6, WORLD.waterLevel + 1.6, y);
      if (sand > 0) out.lerp(TMP.setRGB(0.42, 0.35, 0.22), sand);
      const under = 1 - smoothstep(WORLD.waterLevel - 2.5, WORLD.waterLevel - 0.2, y);
      if (under > 0) out.lerp(TMP.setRGB(0.16, 0.13, 0.09), under);
    }
    if (Math.hypot(x - POND.x, z - POND.z) < POND.radius * 1.3) {
      const mud = 1 - smoothstep(POND_LEVEL - 0.4, POND_LEVEL + 0.5, y);
      if (mud > 0) out.lerp(TMP.setRGB(0.15, 0.12, 0.08), mud);
    }

    // Mountains: rock, then snow on peaks.
    const rock = smoothstep(18, 32, y);
    if (rock > 0) out.lerp(TMP.setRGB(0.2, 0.19, 0.18).multiplyScalar(lerp(0.8, 1.15, n1)), rock);
    const snow = smoothstep(70, 82, y + n2 * 8) * smoothstep(0.55, 0.8, ny);
    if (snow > 0) out.lerp(TMP.setRGB(0.85, 0.88, 0.92), snow);

    out.r = clamp(out.r, 0, 1);
    return out;
  }
}

const TMP = new THREE.Color();
