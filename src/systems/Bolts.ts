import * as THREE from 'three';

interface Segment {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  w: number;
  b: number;
}

export interface BoltOptions {
  /** Max sideways displacement as a fraction of the bolt length. */
  jag?: number;
  /** Recursion depth for midpoint displacement (segments = 2^detail). */
  detail?: number;
  /** Probability a segment spawns a fork. */
  forkChance?: number;
  width?: number;
  color?: THREE.ColorRepresentation;
  life?: number;
  /** Re-randomise the shape every N seconds (crawling arcs). 0 = static. */
  regen?: number;
  /** Overall brightness multiplier. */
  intensity?: number;
}

export class Bolt {
  a = new THREE.Vector3();
  b = new THREE.Vector3();
  segs: Segment[] = [];
  age = 0;
  life = 0.25;
  regen = 0;
  private regenTimer = 0;
  color = new THREE.Color();
  width = 0.08;
  jag = 0.18;
  detail = 6;
  forkChance = 0.12;
  intensity = 1;
  alive = false;

  build() {
    this.segs.length = 0;
    this.subdivide(this.a, this.b, this.detail, this.width, 1, this.jag);
  }

  private push(a: THREE.Vector3, b: THREE.Vector3, w: number, br: number) {
    this.segs.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, w, b: br });
  }

  /** Recursive midpoint displacement with forks. */
  private subdivide(a: THREE.Vector3, b: THREE.Vector3, depth: number, w: number, br: number, jag: number) {
    if (depth <= 0) {
      this.push(a, b, w, br);
      return;
    }
    const len = a.distanceTo(b);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    // Random offset perpendicular to the segment.
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const perp = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(dir).normalize();
    mid.addScaledVector(perp, (Math.random() - 0.5) * 2 * len * jag);
    if (Math.random() < this.forkChance && depth < this.detail && depth > 1 && br > 0.3) {
      const forkEnd = new THREE.Vector3()
        .subVectors(mid, a)
        .applyAxisAngle(perp, (Math.random() - 0.5) * 1.4)
        .multiplyScalar(0.7 + Math.random() * 0.8)
        .add(mid);
      this.subdivide(mid, forkEnd, depth - 1, w * 0.55, br * 0.6, jag);
    }
    this.subdivide(a, mid, depth - 1, w, br, jag);
    this.subdivide(mid, b, depth - 1, w, br, jag);
  }

  update(dt: number) {
    this.age += dt;
    if (this.age >= this.life) {
      this.alive = false;
      return;
    }
    if (this.regen > 0) {
      this.regenTimer -= dt;
      if (this.regenTimer <= 0) {
        this.regenTimer = this.regen;
        this.build();
      }
    }
  }

  /** Current brightness with flicker. */
  get brightness(): number {
    const t = this.age / this.life;
    const flicker = 0.65 + 0.35 * Math.random();
    return this.intensity * (1 - t * t) * flicker;
  }
}

const VERT = /* glsl */ `
  attribute vec3 aOther;
  attribute float aSide;
  attribute float aWidth;
  attribute vec4 aColor;
  varying float vSide;
  varying vec4 vColor;
  void main() {
    vec4 p0 = modelViewMatrix * vec4(position, 1.0);
    vec4 p1 = modelViewMatrix * vec4(aOther, 1.0);
    vec3 dir = normalize(p1.xyz - p0.xyz + vec3(1e-5));
    vec3 toCam = normalize(-p0.xyz);
    vec3 side = normalize(cross(dir, toCam));
    p0.xyz += side * aSide * aWidth;
    vSide = aSide;
    vColor = aColor;
    gl_Position = projectionMatrix * p0;
  }
`;

const FRAG = /* glsl */ `
  varying float vSide;
  varying vec4 vColor;
  void main() {
    float x = abs(vSide);
    float core = smoothstep(0.35, 0.0, x);
    float glow = exp(-x * x * 5.0);
    vec3 col = mix(vColor.rgb * glow, vec3(1.0) * 2.0, core * 0.85);
    gl_FragColor = vec4(col * vColor.a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Renders every active bolt / electric arc as camera-facing ribbons in a single
 * dynamic buffer (one draw call). Bolts are pooled.
 */
export class BoltRenderer {
  private pool: Bolt[] = [];
  readonly active: Bolt[] = [];
  private mesh: THREE.Mesh;
  private maxSegs: number;
  private pos: Float32Array;
  private other: Float32Array;
  private side: Float32Array;
  private width: Float32Array;
  private color: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, maxSegs = 5000) {
    this.maxSegs = maxSegs;
    const v = maxSegs * 4;
    this.pos = new Float32Array(v * 3);
    this.other = new Float32Array(v * 3);
    this.side = new Float32Array(v);
    this.width = new Float32Array(v);
    this.color = new Float32Array(v * 4);
    const idx = new Uint32Array(maxSegs * 6);
    for (let i = 0; i < maxSegs; i++) {
      const o = i * 4;
      idx.set([o, o + 1, o + 2, o + 2, o + 1, o + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    const dyn = (arr: Float32Array, n: number) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aOther', dyn(this.other, 3));
    this.geo.setAttribute('aSide', dyn(this.side, 1));
    this.geo.setAttribute('aWidth', dyn(this.width, 1));
    this.geo.setAttribute('aColor', dyn(this.color, 4));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
  }

  spawn(a: THREE.Vector3, b: THREE.Vector3, o: BoltOptions = {}): Bolt {
    const bolt = this.pool.pop() ?? new Bolt();
    bolt.a.copy(a);
    bolt.b.copy(b);
    bolt.age = 0;
    bolt.life = o.life ?? 0.25;
    bolt.regen = o.regen ?? 0;
    bolt.width = o.width ?? 0.08;
    bolt.jag = o.jag ?? 0.18;
    bolt.detail = o.detail ?? 6;
    bolt.forkChance = o.forkChance ?? 0.12;
    bolt.intensity = o.intensity ?? 1;
    bolt.color.set(o.color ?? 0x9fd0ff);
    bolt.alive = true;
    bolt.build();
    this.active.push(bolt);
    return bolt;
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      if (dt > 0) b.update(dt);
      if (!b.alive) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        this.pool.push(b);
      }
    }
    // Rebuild the vertex buffer.
    let n = 0;
    for (const b of this.active) {
      const br = b.brightness;
      for (const s of b.segs) {
        if (n >= this.maxSegs) break;
        const o = n * 4;
        for (let k = 0; k < 4; k++) {
          const v = o + k;
          const atA = k < 2;
          this.pos[v * 3] = atA ? s.ax : s.bx;
          this.pos[v * 3 + 1] = atA ? s.ay : s.by;
          this.pos[v * 3 + 2] = atA ? s.az : s.bz;
          this.other[v * 3] = atA ? s.bx : s.ax;
          this.other[v * 3 + 1] = atA ? s.by : s.ay;
          this.other[v * 3 + 2] = atA ? s.bz : s.az;
          // Side sign flips for the B end because "other" points backwards there.
          this.side[v] = (k % 2 === 0 ? -1 : 1) * (atA ? 1 : -1);
          this.width[v] = s.w * 3;
          this.color[v * 4] = b.color.r * 2.5;
          this.color[v * 4 + 1] = b.color.g * 2.5;
          this.color[v * 4 + 2] = b.color.b * 2.5;
          this.color[v * 4 + 3] = br * s.b;
        }
        n++;
      }
    }
    for (const name of ['position', 'aOther', 'aSide', 'aWidth', 'aColor']) {
      const attr = this.geo.getAttribute(name) as THREE.BufferAttribute;
      attr.needsUpdate = true;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 4 * attr.itemSize);
    }
    this.geo.setDrawRange(0, n * 6);
  }

  clear() {
    for (const b of this.active) {
      b.alive = false;
      this.pool.push(b);
    }
    this.active.length = 0;
    this.geo.setDrawRange(0, 0);
  }
}
