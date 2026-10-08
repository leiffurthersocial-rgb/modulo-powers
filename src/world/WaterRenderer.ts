import * as THREE from 'three';
import { LAKE, POND, RIVER, WORLD } from '../config/map';
import type { Game, GameSystem } from '../core/Game';
import { time } from '../core/Time';
import { POND_LEVEL } from './terrainShape';
import { waterNormalTexture } from './textures';
import type { WaterBody } from './Water';

/**
 * Water surface rendering: animated two-layer ripple normals, fresnel sky
 * reflections (from the PBR environment), depth-tinted colour and opacity,
 * shoreline foam, river flow, electrified glow, plus underwater fog and
 * caustics on the lake bed (patched into the terrain shader).
 */
export class WaterRenderer implements GameSystem {
  readonly group = new THREE.Group();
  private uniforms = {
    uTime: { value: 0 },
    uNormal: { value: null as THREE.Texture | null },
    uElectric: { value: 0 },
    uElectricPond: { value: 0 },
  };
  private terrainUniforms = { uTime: { value: 0 } };
  private underwater = false;
  readonly material: THREE.MeshStandardMaterial;

  constructor(private game: Game) {
    const tex = waterNormalTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.uniforms.uNormal.value = tex;
    this.material = this.makeMaterial();
    const lake = this.buildGrid(LAKE.x, LAKE.z, LAKE.radius * 1.35, 1.5, WORLD.waterLevel, (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 1.35, false);
    const xs = RIVER.points.map((p) => p[0]);
    const zs = RIVER.points.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + RIVER.width + 6;
    const shape = game.world.terrain.shape;
    const river = this.buildGrid(
      cx,
      cz,
      half,
      1.5,
      WORLD.waterLevel,
      (x, z) => shape.riverDistance(x, z).d < RIVER.width * 0.5 + 4 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.radius * 1.25,
      true,
    );
    const pond = this.buildGrid(POND.x, POND.z, POND.radius * 1.1, 0.8, POND_LEVEL, (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.radius * 1.1, false);
    for (const g of [lake, river, pond]) {
      const m = new THREE.Mesh(g, this.material);
      m.receiveShadow = true;
      m.renderOrder = 5;
      this.group.add(m);
    }
    pond.userData.pond = true;
    game.scene.add(this.group);
    this.patchTerrain();
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1b4d5c,
      roughness: 0.04,
      metalness: 0.0,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      envMapIntensity: 1.0,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aDepth;
          attribute vec2 aFlow;
          attribute float aPond;
          varying float vDepth;
          varying vec2 vFlow;
          varying float vPond;
          varying vec3 vWPos;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vDepth = aDepth;
          vFlow = aFlow;
          vPond = aPond;
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform sampler2D uNormal;
          uniform float uElectric;
          uniform float uElectricPond;
          varying float vDepth;
          varying vec2 vFlow;
          varying float vPond;
          varying vec3 vWPos;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vDepth < -0.02) discard;
          float deep = smoothstep(0.0, 4.5, vDepth);
          vec3 shallowCol = vec3(0.10, 0.32, 0.30);
          vec3 deepCol = vec3(0.01, 0.07, 0.11);
          diffuseColor.rgb = mix(shallowCol, deepCol, deep);
          diffuseColor.a = mix(0.45, 0.93, smoothstep(0.0, 2.2, vDepth));
          vec2 fuv = vWPos.xz * 0.35 - vFlow * uTime * 0.35;
          float foamN = texture2D(uNormal, fuv).r;
          float foam = (1.0 - smoothstep(0.0, 0.45, vDepth)) * smoothstep(0.35, 0.65, foamN + 0.25 * sin(uTime * 1.7 + vWPos.x * 0.7));
          foam += length(vFlow) * 0.08 * smoothstep(0.55, 0.75, foamN);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 0.97), clamp(foam, 0.0, 1.0));
          diffuseColor.a = max(diffuseColor.a, clamp(foam, 0.0, 1.0));`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
            vec2 uv1 = vWPos.xz * 0.06 + vec2(uTime * 0.012, uTime * 0.008) - vFlow * uTime * 0.12;
            vec2 uv2 = vWPos.xz * 0.17 - vec2(uTime * 0.02, -uTime * 0.015) - vFlow * uTime * 0.3;
            vec3 n1 = texture2D(uNormal, uv1).xyz * 2.0 - 1.0;
            vec3 n2 = texture2D(uNormal, uv2).xyz * 2.0 - 1.0;
            vec2 nxy = (n1.xy + n2.xy) * 0.32;
            vec3 wn = normalize(vec3(nxy.x, 1.0, nxy.y));
            if (!gl_FrontFacing) wn = -wn;
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float el = mix(uElectric, uElectricPond, vPond);
          if (el > 0.0) {
            float flick = 0.5 + 0.5 * sin(uTime * 53.0 + vWPos.x * 3.0) * sin(uTime * 37.0 + vWPos.z * 2.0);
            totalEmissiveRadiance += vec3(0.25, 0.55, 1.0) * el * flick * 0.9;
          }`,
        );
    };
    return mat;
  }

  /** A grid mesh over a region; only triangles touching water are kept. */
  private buildGrid(cx: number, cz: number, half: number, step: number, level: number, region: (x: number, z: number) => boolean, flow: boolean): THREE.BufferGeometry {
    const n = Math.ceil((half * 2) / step);
    const w = this.game.world;
    const pos: number[] = [];
    const depth: number[] = [];
    const flowA: number[] = [];
    const idx: number[] = [];
    const inside: boolean[] = [];
    const tmp = new THREE.Vector3();
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = cx - half + ix * step;
        const z = cz - half + iz * step;
        pos.push(x, level, z);
        depth.push(level - w.heightAt(x, z));
        if (flow) {
          const cur = this.game.water.current(x, z, tmp);
          flowA.push(cur.x * 0.5, cur.z * 0.5);
        } else flowA.push(0, 0);
        inside.push(region(x, z));
      }
    }
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const a = iz * (n + 1) + ix;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        const anyWet = depth[a] > -0.3 || depth[b] > -0.3 || depth[c] > -0.3 || depth[d] > -0.3;
        if (!anyWet || !(inside[a] || inside[b] || inside[c] || inside[d])) continue;
        idx.push(a, c, d, a, d, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flowA, 2));
    g.setAttribute('aPond', new THREE.Float32BufferAttribute(new Array(depth.length).fill(level === POND_LEVEL ? 1 : 0), 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /** Underwater caustics on the terrain below water surfaces. */
  private patchTerrain() {
    const mat = this.game.world.terrain.material;
    const prev = mat.onBeforeCompile;
    const tu = this.terrainUniforms;
    mat.onBeforeCompile = (shader, r) => {
      prev.call(mat, shader, r);
      Object.assign(shader.uniforms, tu);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWPos;\nuniform float uTime;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float lvl = ${WORLD.waterLevel.toFixed(2)};
            if (length(vTWPos.xz - vec2(${POND.x.toFixed(1)}, ${POND.z.toFixed(1)})) < ${(POND.radius * 1.2).toFixed(1)}) lvl = ${POND_LEVEL.toFixed(2)};
            float d = lvl - vTWPos.y;
            if (d > 0.0) {
              vec2 p = vTWPos.xz * 0.45;
              float t = uTime * 0.8;
              float c = sin(p.x * 1.7 + sin(p.y * 1.3 + t) + t) * sin(p.y * 1.9 + sin(p.x * 1.1 - t * 0.7) - t * 0.6);
              c = pow(abs(c), 6.0) * 1.6;
              diffuseColor.rgb *= mix(vec3(1.0), vec3(0.45, 0.7, 0.75), smoothstep(0.0, 3.0, d));
              totalEmissiveRadiance += vec3(0.35, 0.55, 0.5) * c * exp(-d * 0.35) * 0.25;
            }
          }`,
        );
    };
    mat.needsUpdate = true;
  }

  private bodyLit(b: WaterBody): number {
    return b.electrified > 0 ? Math.min(1, b.electrified / 1.5) : 0;
  }

  update(_dt: number, realDt: number) {
    const g = this.game;
    this.uniforms.uTime.value += time.paused ? 0 : realDt * time.scale;
    this.terrainUniforms.uTime.value = this.uniforms.uTime.value;
    this.uniforms.uElectric.value = Math.max(this.bodyLit(g.water.lake), this.bodyLit(g.water.river));
    this.uniforms.uElectricPond.value = this.bodyLit(g.water.pond);
    // Underwater view: dense blue-green fog (clearer inside a hydro shield).
    const cam = g.camera.position;
    const body = g.water.bodyAt(cam);
    const under = !!body && cam.y < body.level - 0.05;
    if (under) {
      const fog = g.scene.fog as THREE.Fog;
      const clear = g.shielded ? 2.5 : 1;
      fog.color.setRGB(0.03, 0.14, 0.17).multiplyScalar(g.env.ambientLight * 0.8 + 0.2);
      fog.near = 0.5;
      fog.far = 18 * clear;
      this.underwater = true;
    } else if (this.underwater) {
      this.underwater = false;
      g.env.restoreFog();
    }
    g.hud.setUnderwater(under ? 1 : 0);
  }

  get isUnderwater(): boolean {
    return this.underwater;
  }
}
