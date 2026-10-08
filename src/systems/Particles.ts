import * as THREE from 'three';

/**
 * Pooled CPU-simulated / GPU-drawn particle system.
 *
 * All particles live in two big preallocated `THREE.Points` buffers (additive
 * and alpha-blended), so emitting never allocates and every effect in the game
 * costs at most two draw calls. Each particle stores its own colour ramp, size
 * ramp, gravity, drag and buoyancy, so presets are just data.
 */
export interface ParticlePreset {
  blend: 'add' | 'alpha';
  life: [number, number];
  size: [number, number];
  /** Size multiplier at end of life. */
  sizeEnd: number;
  color0: THREE.ColorRepresentation;
  color1: THREE.ColorRepresentation;
  /** Peak alpha. */
  alpha: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
  gravity?: number;
  drag?: number;
  /** Upward acceleration (hot gas). */
  buoyancy?: number;
  /** Random sideways acceleration (turbulence). */
  turbulence?: number;
  /** Kill/bounce on terrain. */
  ground?: 'die' | 'bounce' | 'none';
  /** 0 = round soft blob, 1 = wispy (smoke/fire), 2 = hard spark, 3 = flake. */
  shape?: number;
  /** HDR multiplier on colour for additive glow (bloom). */
  intensity?: number;
}

export interface EmitOptions {
  /** Base velocity direction (normalised internally); default up. */
  dir?: THREE.Vector3;
  speed?: [number, number];
  /** Cone half-angle around dir (radians). Math.PI = full sphere. */
  spread?: number;
  /** Random offset radius around the emit position. */
  jitter?: number;
  /** Extra velocity added to every particle (e.g. emitter motion). */
  inherit?: THREE.Vector3;
  sizeMul?: number;
  lifeMul?: number;
  /** Override colours. */
  color0?: THREE.ColorRepresentation;
  color1?: THREE.ColorRepresentation;
  /** Emit along a segment from pos to `to` instead of a point. */
  to?: THREE.Vector3;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aSeed;
  uniform float uScale;
  varying vec4 vColor;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vColor;
  varying float vSeed;
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float shape = floor(vSeed);
    float seed = fract(vSeed) * 100.0;
    // Random rotation per particle.
    float a = seed * 6.2831;
    p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
    float d = length(p) * 2.0;
    float alpha;
    if (shape < 0.5) {
      alpha = smoothstep(1.0, 0.0, d);
      alpha *= alpha;
    } else if (shape < 1.5) {
      float n = vnoise(p * 4.0 + seed) * 0.6 + vnoise(p * 9.0 - seed) * 0.4;
      alpha = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.7);
    } else if (shape < 2.5) {
      alpha = smoothstep(1.0, 0.0, d);
      alpha = pow(alpha, 3.0) + smoothstep(0.35, 0.0, d);
    } else {
      // Flake / shard: sharp diamond.
      alpha = step(abs(p.x) * 1.6 + abs(p.y), 0.5);
    }
    gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
    if (gl_FragColor.a < 0.003) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

class ParticleLayer {
  readonly points: THREE.Points;
  readonly max: number;
  count = 0;
  // Per-particle simulation data (struct of arrays).
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  age: Float32Array;
  life: Float32Array;
  size0: Float32Array;
  sizeEnd: Float32Array;
  c0: Float32Array;
  c1: Float32Array;
  alpha: Float32Array;
  fadeIn: Float32Array;
  gravity: Float32Array;
  drag: Float32Array;
  buoy: Float32Array;
  turb: Float32Array;
  ground: Uint8Array;
  seed: Float32Array;
  // GPU buffers.
  private posAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private seedAttr: THREE.BufferAttribute;
  readonly material: THREE.ShaderMaterial;

  constructor(max: number, blend: 'add' | 'alpha') {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size0 = f();
    this.sizeEnd = f();
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.alpha = f();
    this.fadeIn = f();
    this.gravity = f();
    this.drag = f();
    this.buoy = f();
    this.turb = f();
    this.ground = new Uint8Array(max);
    this.seed = f();
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.seedAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setAttribute('aSeed', this.seedAttr);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 500 } }]),
      transparent: true,
      depthWrite: false,
      blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = blend === 'add' ? 11 : 10;
  }

  private kill(i: number) {
    const j = --this.count;
    if (i === j) return;
    this.px[i] = this.px[j];
    this.py[i] = this.py[j];
    this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.vz[i] = this.vz[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.size0[i] = this.size0[j];
    this.sizeEnd[i] = this.sizeEnd[j];
    this.c0[i * 3] = this.c0[j * 3];
    this.c0[i * 3 + 1] = this.c0[j * 3 + 1];
    this.c0[i * 3 + 2] = this.c0[j * 3 + 2];
    this.c1[i * 3] = this.c1[j * 3];
    this.c1[i * 3 + 1] = this.c1[j * 3 + 1];
    this.c1[i * 3 + 2] = this.c1[j * 3 + 2];
    this.alpha[i] = this.alpha[j];
    this.fadeIn[i] = this.fadeIn[j];
    this.gravity[i] = this.gravity[j];
    this.drag[i] = this.drag[j];
    this.buoy[i] = this.buoy[j];
    this.turb[i] = this.turb[j];
    this.ground[i] = this.ground[j];
    this.seed[i] = this.seed[j];
  }

  update(dt: number, groundAt: (x: number, z: number) => number) {
    const pos = this.posAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const col = this.colorAttr.array as Float32Array;
    const seeds = this.seedAttr.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const t = this.age[i] / this.life[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      const turb = this.turb[i];
      this.vx[i] = this.vx[i] * dr + (turb ? (Math.random() - 0.5) * turb * dt : 0);
      this.vz[i] = this.vz[i] * dr + (turb ? (Math.random() - 0.5) * turb * dt : 0);
      this.vy[i] = this.vy[i] * dr + (this.buoy[i] - this.gravity[i]) * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const g = this.ground[i];
      if (g) {
        const gy = groundAt(this.px[i], this.pz[i]);
        if (this.py[i] < gy) {
          if (g === 1) {
            this.kill(i);
            continue;
          }
          this.py[i] = gy;
          this.vy[i] = Math.abs(this.vy[i]) * 0.3;
          this.vx[i] *= 0.6;
          this.vz[i] *= 0.6;
        }
      }
      const i3 = i * 3;
      const i4 = i * 4;
      pos[i3] = this.px[i];
      pos[i3 + 1] = this.py[i];
      pos[i3 + 2] = this.pz[i];
      size[i] = this.size0[i] * (1 + (this.sizeEnd[i] - 1) * t);
      col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      const fi = this.fadeIn[i];
      const fade = t < fi ? t / fi : 1 - (t - fi) / (1 - fi);
      col[i4 + 3] = this.alpha[i] * fade;
      seeds[i] = this.seed[i];
      i++;
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.seedAttr.needsUpdate = true;
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, this.count * 3);
    this.sizeAttr.clearUpdateRanges();
    this.sizeAttr.addUpdateRange(0, this.count);
    this.colorAttr.clearUpdateRanges();
    this.colorAttr.addUpdateRange(0, this.count * 4);
    this.seedAttr.clearUpdateRanges();
    this.seedAttr.addUpdateRange(0, this.count);
    this.points.geometry.setDrawRange(0, this.count);
  }

  clear() {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

const TMP_C0 = new THREE.Color();
const TMP_C1 = new THREE.Color();
const TMP_DIR = new THREE.Vector3();
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class ParticleSystem {
  private add: ParticleLayer;
  private alpha: ParticleLayer;
  /** Soft cap from the quality preset × dynamic scale. */
  budget = 4000;
  groundAt: (x: number, z: number) => number = () => -1e9;

  constructor(scene: THREE.Scene, capacity = 9000) {
    this.add = new ParticleLayer(capacity, 'add');
    this.alpha = new ParticleLayer(capacity, 'alpha');
    scene.add(this.alpha.points, this.add.points);
  }

  get count(): number {
    return this.add.count + this.alpha.count;
  }

  /** Called on resize: point size scale = viewport height / (2·tan(fov/2)). */
  setViewport(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.add.material.uniforms.uScale.value = s;
    this.alpha.material.uniforms.uScale.value = s;
  }

  /** Emit `count` particles of a preset at `pos`. Returns how many were emitted. */
  emit(preset: ParticlePreset, pos: THREE.Vector3, count: number, o: EmitOptions = {}): number {
    const layer = preset.blend === 'add' ? this.add : this.alpha;
    const room = Math.min(layer.max - layer.count, Math.floor(this.budget / 2) - layer.count);
    // Probabilistic rounding so fractional per-frame counts work.
    let n = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
    n = Math.min(n, room);
    if (n <= 0) return 0;
    TMP_C0.set(o.color0 ?? preset.color0).multiplyScalar(preset.intensity ?? 1);
    TMP_C1.set(o.color1 ?? preset.color1).multiplyScalar(preset.intensity ?? 1);
    const dir = TMP_DIR.copy(o.dir ?? UP).normalize();
    const spread = o.spread ?? 0.4;
    const [s0, s1] = o.speed ?? [0.5, 1.5];
    const jitter = o.jitter ?? 0;
    const sizeMul = o.sizeMul ?? 1;
    const lifeMul = o.lifeMul ?? 1;
    const shape = preset.shape ?? 0;
    const groundMode = preset.ground === 'die' ? 1 : preset.ground === 'bounce' ? 2 : 0;
    for (let k = 0; k < n; k++) {
      const i = layer.count++;
      let x = pos.x;
      let y = pos.y;
      let z = pos.z;
      if (o.to) {
        const t = Math.random();
        x += (o.to.x - pos.x) * t;
        y += (o.to.y - pos.y) * t;
        z += (o.to.z - pos.z) * t;
      }
      if (jitter > 0) {
        x += (Math.random() - 0.5) * 2 * jitter;
        y += (Math.random() - 0.5) * 2 * jitter;
        z += (Math.random() - 0.5) * 2 * jitter;
      }
      layer.px[i] = x;
      layer.py[i] = y;
      layer.pz[i] = z;
      // Random direction inside a cone around dir.
      const v = randomInCone(dir, spread, TMP_A);
      const sp = s0 + Math.random() * (s1 - s0);
      layer.vx[i] = v.x * sp + (o.inherit?.x ?? 0);
      layer.vy[i] = v.y * sp + (o.inherit?.y ?? 0);
      layer.vz[i] = v.z * sp + (o.inherit?.z ?? 0);
      layer.age[i] = 0;
      layer.life[i] = (preset.life[0] + Math.random() * (preset.life[1] - preset.life[0])) * lifeMul;
      layer.size0[i] = (preset.size[0] + Math.random() * (preset.size[1] - preset.size[0])) * sizeMul;
      layer.sizeEnd[i] = preset.sizeEnd;
      layer.c0[i * 3] = TMP_C0.r;
      layer.c0[i * 3 + 1] = TMP_C0.g;
      layer.c0[i * 3 + 2] = TMP_C0.b;
      layer.c1[i * 3] = TMP_C1.r;
      layer.c1[i * 3 + 1] = TMP_C1.g;
      layer.c1[i * 3 + 2] = TMP_C1.b;
      layer.alpha[i] = preset.alpha;
      layer.fadeIn[i] = preset.fadeIn ?? 0.1;
      layer.gravity[i] = preset.gravity ?? 0;
      layer.drag[i] = preset.drag ?? 0;
      layer.buoy[i] = preset.buoyancy ?? 0;
      layer.turb[i] = preset.turbulence ?? 0;
      layer.ground[i] = groundMode;
      layer.seed[i] = shape + Math.random() * 0.999;
    }
    return n;
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.add.update(dt, this.groundAt);
    this.alpha.update(dt, this.groundAt);
  }

  clear() {
    this.add.clear();
    this.alpha.clear();
  }
}

/** Uniform random direction within `angle` of `axis`. */
export function randomInCone(axis: THREE.Vector3, angle: number, out: THREE.Vector3): THREE.Vector3 {
  const cosA = Math.cos(Math.min(Math.PI, angle));
  const z = cosA + Math.random() * (1 - cosA);
  const phi = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out.set(r * Math.cos(phi), r * Math.sin(phi), z);
  // Rotate (0,0,1) onto axis.
  TMP_B.set(0, 0, 1);
  const q = TMP_Q.setFromUnitVectors(TMP_B, axis);
  return out.applyQuaternion(q);
}
const TMP_Q = new THREE.Quaternion();

/** Shared presets. Powers may define their own as well. */
export const FX = {
  fire: {
    blend: 'alpha',
    life: [0.4, 0.85],
    size: [0.4, 0.8],
    sizeEnd: 0.35,
    color0: 0xffb24a,
    color1: 0xe23400,
    alpha: 0.92,
    fadeIn: 0.12,
    buoyancy: 5,
    drag: 1.8,
    turbulence: 5,
    shape: 1,
    intensity: 1.7,
  },
  flame: {
    blend: 'add',
    life: [0.25, 0.5],
    size: [0.45, 0.9],
    sizeEnd: 1.6,
    color0: 0xffc070,
    color1: 0xff3a00,
    alpha: 0.7,
    fadeIn: 0.05,
    buoyancy: 2,
    drag: 2.2,
    turbulence: 6,
    shape: 1,
    intensity: 1.6,
  },
  smoke: {
    blend: 'alpha',
    life: [1.8, 3.5],
    size: [0.8, 1.4],
    sizeEnd: 3.5,
    color0: 0x2b2826,
    color1: 0x6b6865,
    alpha: 0.45,
    fadeIn: 0.15,
    buoyancy: 1.4,
    drag: 0.6,
    turbulence: 2,
    shape: 1,
  },
  ember: {
    blend: 'add',
    life: [0.8, 2.0],
    size: [0.05, 0.09],
    sizeEnd: 0.5,
    color0: 0xffb347,
    color1: 0xff3000,
    alpha: 1,
    fadeIn: 0.05,
    buoyancy: 1.8,
    drag: 0.4,
    turbulence: 6,
    shape: 2,
    intensity: 3,
  },
  spark: {
    blend: 'add',
    life: [0.2, 0.6],
    size: [0.05, 0.1],
    sizeEnd: 0.4,
    color0: 0xfff2c0,
    color1: 0xff7a10,
    alpha: 1,
    fadeIn: 0.02,
    gravity: 9.8,
    drag: 0.3,
    ground: 'bounce',
    shape: 2,
    intensity: 4,
  },
  electric: {
    blend: 'add',
    life: [0.08, 0.25],
    size: [0.08, 0.18],
    sizeEnd: 0.3,
    color0: 0xe8f6ff,
    color1: 0x3a8cff,
    alpha: 1,
    fadeIn: 0.02,
    drag: 4,
    shape: 2,
    intensity: 5,
  },
  steam: {
    blend: 'alpha',
    life: [1.0, 2.2],
    size: [0.6, 1.0],
    sizeEnd: 3,
    color0: 0xe8eef2,
    color1: 0xc8d0d6,
    alpha: 0.35,
    fadeIn: 0.1,
    buoyancy: 2.2,
    drag: 1,
    turbulence: 3,
    shape: 1,
  },
  droplet: {
    blend: 'alpha',
    life: [0.6, 1.2],
    size: [0.05, 0.12],
    sizeEnd: 0.8,
    color0: 0xd6ecff,
    color1: 0x9cc8ec,
    alpha: 0.85,
    fadeIn: 0.02,
    gravity: 9.8,
    drag: 0.2,
    ground: 'die',
    shape: 0,
  },
  splash: {
    blend: 'alpha',
    life: [0.4, 0.9],
    size: [0.2, 0.45],
    sizeEnd: 2,
    color0: 0xf2faff,
    color1: 0xb8d8f0,
    alpha: 0.6,
    fadeIn: 0.05,
    gravity: 6,
    drag: 1.2,
    shape: 1,
  },
  dust: {
    blend: 'alpha',
    life: [1.2, 2.6],
    size: [0.6, 1.2],
    sizeEnd: 3,
    color0: 0x8a7458,
    color1: 0xa8987e,
    alpha: 0.5,
    fadeIn: 0.1,
    gravity: 0.3,
    drag: 1.5,
    turbulence: 1.5,
    shape: 1,
  },
  debris: {
    blend: 'alpha',
    life: [0.8, 1.6],
    size: [0.08, 0.2],
    sizeEnd: 1,
    color0: 0x6b5d4f,
    color1: 0x5a4d40,
    alpha: 1,
    fadeIn: 0.01,
    gravity: 9.8,
    drag: 0.2,
    ground: 'bounce',
    shape: 3,
  },
  frost: {
    blend: 'add',
    life: [0.5, 1.2],
    size: [0.08, 0.2],
    sizeEnd: 0.4,
    color0: 0xe8f8ff,
    color1: 0x7cc8ff,
    alpha: 0.8,
    fadeIn: 0.05,
    gravity: 0.5,
    drag: 1.5,
    turbulence: 2,
    shape: 3,
    intensity: 1.5,
  },
  shadow: {
    blend: 'alpha',
    life: [0.6, 1.4],
    size: [0.5, 1.0],
    sizeEnd: 2.2,
    color0: 0x0d0618,
    color1: 0x2a1450,
    alpha: 0.7,
    fadeIn: 0.1,
    buoyancy: 0.8,
    drag: 2,
    turbulence: 3,
    shape: 1,
  },
  shadowGlow: {
    blend: 'add',
    life: [0.3, 0.8],
    size: [0.1, 0.25],
    sizeEnd: 0.2,
    color0: 0xb59cff,
    color1: 0x3a1a90,
    alpha: 0.9,
    fadeIn: 0.05,
    drag: 2,
    turbulence: 4,
    shape: 2,
    intensity: 2,
  },
} satisfies Record<string, ParticlePreset>;
