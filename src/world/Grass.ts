import * as THREE from 'three';
import { LAKE, WORLD, ZONES } from '../config/map';
import type { Game, GameSystem } from '../core/Game';
import { time } from '../core/Time';
import type { Terrain } from './Terrain';

const RES = 256; // grass-mask texture resolution over the whole map

/**
 * GPU grass field. A fixed set of instanced blade clumps is laid out on a
 * grid that scrolls with the camera (instances wrap around, so the field is
 * effectively infinite). Each clump reads terrain height and a grass mask
 * (density + colour) from textures in the vertex shader, sways in the wind,
 * bends away from the player, and shrinks into the distance.
 */
export class Grass implements GameSystem {
  readonly mesh: THREE.InstancedMesh;
  private uniforms: Record<string, THREE.IUniform>;
  private total: number;

  constructor(
    private game: Game,
    terrain: Terrain,
    count = 22000,
    radius = 55,
  ) {
    this.total = count;
    // ---- Height texture (float) and mask texture (RGB colour, A density).
    const n = terrain.n + 1;
    // Half-float so it can be linearly filtered everywhere (incl. iPad).
    const hData = new Uint16Array(n * n);
    for (let i = 0; i < n * n; i++) hData[i] = THREE.DataUtils.toHalfFloat(terrain.heights[i]);
    const heightTex = new THREE.DataTexture(hData, n, n, THREE.RedFormat, THREE.HalfFloatType);
    heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
    heightTex.needsUpdate = true;
    const mask = new Uint8Array(RES * RES * 4);
    const half = WORLD.size / 2;
    const nrm = new THREE.Vector3();
    const shape = terrain.shape;
    for (let iz = 0; iz < RES; iz++) {
      for (let ix = 0; ix < RES; ix++) {
        const x = -half + ((ix + 0.5) / RES) * WORLD.size;
        const z = -half + ((iz + 0.5) / RES) * WORLD.size;
        const y = terrain.heightAt(x, z);
        terrain.normalAt(x, z, nrm);
        let d = 1;
        if (y < WORLD.waterLevel + 0.7 || y > 22) d = 0;
        if (nrm.y < 0.82) d *= Math.max(0, (nrm.y - 0.72) / 0.1);
        d *= 1 - Math.min(1, shape.pathSurface(x, z) * 1.6);
        if (Math.hypot(x - ZONES.hub.x, z - ZONES.hub.z) < 22) d = 0;
        if (Math.hypot(x - ZONES.arena.x, z - ZONES.arena.z) < 30) d = 0;
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 0.95) d = 0;
        if (shape.riverDistance(x, z).d < 6) d = 0;
        // Patchy density.
        d *= 0.55 + 0.45 * (shape.detail.fbm(x * 0.03, z * 0.03, 2) * 0.5 + 0.5);
        // Colour: dry in the fire zone, darker in the shadow zone, lush near water.
        const fire = 1 - Math.min(1, Math.max(0, (Math.hypot(x - ZONES.fire.x, z - ZONES.fire.z) - ZONES.fire.radius * 0.6) / (ZONES.fire.radius * 0.6)));
        const shadow = 1 - Math.min(1, Math.max(0, (Math.hypot(x - ZONES.shadow.x, z - ZONES.shadow.z) - ZONES.shadow.radius * 0.6) / (ZONES.shadow.radius * 0.6)));
        const v = shape.noise.noise(x * 0.05, z * 0.05) * 0.5 + 0.5;
        let r = 0.2 + v * 0.08;
        let gg = 0.34 + v * 0.1;
        let b = 0.1 + v * 0.04;
        r = r + (0.62 - r) * fire;
        gg = gg + (0.52 - gg) * fire;
        b = b + (0.2 - b) * fire;
        r *= 1 - shadow * 0.45;
        gg *= 1 - shadow * 0.4;
        b *= 1 - shadow * 0.3;
        const i = (iz * RES + ix) * 4;
        mask[i] = r * 255;
        mask[i + 1] = gg * 255;
        mask[i + 2] = b * 255;
        mask[i + 3] = Math.max(0, Math.min(1, d)) * 255;
      }
    }
    const maskTex = new THREE.DataTexture(mask, RES, RES, THREE.RGBAFormat);
    maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter;
    maskTex.needsUpdate = true;

    // ---- Blade clump geometry: 3 crossed, tapered, slightly curved blades.
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * Math.PI + 0.3;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ox = (Math.random() - 0.5) * 0.25;
      const oz = (Math.random() - 0.5) * 0.25;
      const base = pos.length / 3;
      const segs = 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const w = 0.045 * (1 - t * 0.85);
        for (const side of [-1, 1]) {
          pos.push(ox + ca * w * side, t, oz + sa * w * side);
          uv.push(side * 0.5 + 0.5, t);
        }
      }
      for (let s = 0; s < segs; s++) {
        const i0 = base + s * 2;
        idx.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    // Per-instance offset within the grid tile + random params.
    const side = Math.ceil(Math.sqrt(count));
    const cell = (radius * 2) / side;
    const offs = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const gx = i % side;
      const gz = Math.floor(i / side);
      offs[i * 4] = (gx + Math.random()) * cell;
      offs[i * 4 + 1] = (gz + Math.random()) * cell;
      offs[i * 4 + 2] = Math.random(); // rotation / variation
      offs[i * 4 + 3] = 0.55 + Math.random() * 0.7; // height scale
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uTime: { value: 0 },
      uHeight: { value: heightTex },
      uMask: { value: maskTex },
      uCam: { value: new THREE.Vector3() },
      uPlayer: { value: new THREE.Vector3() },
      uTile: { value: radius * 2 },
      uRadius: { value: radius },
      uWorld: { value: WORLD.size },
      uHalf: { value: half },
      uWind: { value: 1 },
      uHS: { value: (n - 1) / n },
      uHO: { value: 0.5 / n },
    };
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aOffset;
          uniform float uTime, uTile, uRadius, uWorld, uHalf, uWind, uHS, uHO;
          uniform vec3 uCam, uPlayer;
          uniform sampler2D uHeight, uMask;
          varying vec3 vGrassCol;
          varying float vTip;`,
        )
        .replace(
          '#include <begin_vertex>',
          `
          // Wrap this instance's grid position around the camera.
          vec2 base = uCam.xz - vec2(uRadius);
          vec2 wp = base + mod(aOffset.xy - base, uTile);
          vec2 tuv = (wp + uHalf) / uWorld;
          vec4 m = texture2D(uMask, tuv);
          float h = texture2D(uHeight, tuv * uHS + uHO).r;
          float dist = length(wp - uCam.xz);
          float fade = 1.0 - smoothstep(uRadius * 0.6, uRadius, dist);
          float density = step(aOffset.z * 0.999, m.a);
          float scale = aOffset.w * fade * density * (0.6 + m.a * 0.6);
          float rot = aOffset.z * 6.2831;
          vec3 p = position;
          p.xz = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * p.xz;
          p.y *= 0.55;
          p *= scale;
          float t = position.y;
          // Wind: big slow gusts + small fast flutter, stronger at the tip.
          float gust = sin(wp.x * 0.05 + uTime * 0.9) * sin(wp.y * 0.04 + uTime * 0.7);
          float flutter = sin(uTime * 4.0 + aOffset.z * 30.0 + wp.x * 0.7);
          vec2 bend = vec2(0.35 + 0.25 * gust, 0.2 * gust) * uWind + vec2(flutter * 0.06);
          // Push away from the player.
          vec2 away = wp - uPlayer.xz;
          float ad = length(away);
          bend += (ad < 1.4 && ad > 0.001) ? normalize(away) * (1.4 - ad) * 0.9 : vec2(0.0);
          p.xz += bend * t * t * scale;
          p.y -= dot(bend, bend) * 0.15 * t * t * scale;
          vec3 transformed = vec3(wp.x + p.x, h + p.y, wp.y + p.z);
          vGrassCol = m.rgb * (0.85 + aOffset.w * 0.2);
          vTip = t;
          `,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;')
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;\nvarying float vTip;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 lin = pow(vGrassCol, vec3(2.2));
          diffuseColor.rgb = lin * mix(0.3, 1.0, vTip);`,
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    game.scene.add(this.mesh);
  }

  /** User toggle (U / pause menu). */
  enabled = true;
  private density = 1;

  setDensity(d: number) {
    this.density = d;
    this.mesh.count = Math.floor(this.total * d);
    this.mesh.visible = this.enabled && d > 0.05;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.setDensity(this.density);
  }

  update(_dt: number, realDt: number) {
    if (!this.mesh.visible) return;
    const g = this.game;
    this.uniforms.uTime.value += time.paused ? 0 : realDt * time.scale;
    (this.uniforms.uCam.value as THREE.Vector3).copy(g.camera.position);
    (this.uniforms.uPlayer.value as THREE.Vector3).copy(g.player.renderPos);
    this.uniforms.uWind.value = 1 + g.env.stormFactor * 1.5;
  }
}
