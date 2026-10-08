import * as THREE from 'three';

interface Segment {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  /** Core half-width (m). */
  w: number;
  /** Brightness 0..1 (branches are dimmer, fading towards their tips). */
  b: number;
}

export interface BoltOptions {
  /** Max sideways displacement as a fraction of each segment's length. */
  jag?: number;
  /** Recursion depth for midpoint displacement (segments = 2^detail). */
  detail?: number;
  /** Probability a segment spawns a branch. */
  forkChance?: number;
  /** Core width (m). */
  width?: number;
  color?: THREE.ColorRepresentation;
  life?: number;
  /** Re-randomise the shape every N seconds (crawling arcs). 0 = static. */
  regen?: number;
  /** Overall brightness multiplier. */
  intensity?: number;
  /** Number of return strokes (flickering re-strikes along the same channel). */
  strokes?: number;
  /** Glow radius as a multiple of the core width. */
  glow?: number;
}

/**
 * One lightning channel: a fractal polyline built by recursive midpoint
 * displacement, with branches that spawn off it, get thinner and fade towards
 * their tips (like real stepped-leader branches).
 */
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
  strokes = 1;
  glow = 7;
  alive = false;
  private strokeTimes: number[] = [0];

  build() {
    this.segs.length = 0;
    this.channel(this.a, this.b, this.detail, this.width, 1, 1, 0);
    // Pick return-stroke times within the life.
    this.strokeTimes = [0];
    for (let i = 1; i < this.strokes; i++) this.strokeTimes.push((i / this.strokes) * this.life * (0.7 + Math.random() * 0.25));
  }

  /** Build a jagged channel from a to b, emitting branches along the way. */
  private channel(a: THREE.Vector3, b: THREE.Vector3, detail: number, w: number, br0: number, br1: number, generation: number) {
    // Midpoint displacement into a point list.
    let pts = [a.clone(), b.clone()];
    const dir = TMP_D.subVectors(b, a);
    const total = dir.length();
    dir.divideScalar(total || 1);
    for (let level = 0; level < detail; level++) {
      const next: THREE.Vector3[] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        const len = p.distanceTo(q);
        const mid = new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5);
        // Random perpendicular offset; displacement shrinks with segment length.
        RND.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        RND.addScaledVector(dir, -RND.dot(dir)).normalize();
        // Coarse levels zig-zag hard; fine levels add only a little roughness.
        const amp = this.jag * (level < detail - 2 ? 1.15 : 0.55);
        mid.addScaledVector(RND, (Math.random() - 0.5) * 2 * len * amp);
        next.push(mid, q);
      }
      pts = next;
    }
    const n = pts.length - 1;
    // forkChance ≈ expected number of branches per 8 segments-worth of channel.
    const pFork = (this.forkChance * 8) / n;
    const dirX = dir.x;
    const dirY = dir.y;
    const dirZ = dir.z;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const br = br0 + (br1 - br0) * t;
      const ww = w * (0.6 + 0.4 * (1 - t * (generation > 0 ? 1 : 0.3)));
      const p = pts[i];
      const q = pts[i + 1];
      this.segs.push({ ax: p.x, ay: p.y, az: p.z, bx: q.x, by: q.y, bz: q.z, w: ww, b: br });
      // Branches: continue roughly in the bolt's direction, deviating sideways.
      if (this.segs.length < 1400 && generation < 2 && i > 1 && i < n - 2 && Math.random() < pFork * (generation ? 0.4 : 1)) {
        const remain = total * (1 - t);
        const blen = remain * (0.25 + Math.random() * 0.35) / (generation + 1);
        if (blen < 0.4) continue;
        RND.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const bdir = TMP_B.set(dirX, dirY, dirZ).multiplyScalar(0.8).addScaledVector(RND, 0.9).normalize();
        const end = new THREE.Vector3().copy(q).addScaledVector(bdir, blen);
        this.channel(q, end, Math.max(2, detail - 2 - generation), ww * 0.45, br * 0.55, 0.02, generation + 1);
      }
    }
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

  /** Brightness over time: sharp return strokes that decay, with flicker. */
  get brightness(): number {
    let b = 0;
    for (const st of this.strokeTimes) {
      const dt = this.age - st;
      if (dt < 0) continue;
      b = Math.max(b, Math.exp(-dt * (this.strokes > 1 ? 22 : 9)));
    }
    const fade = 1 - Math.pow(this.age / this.life, 3);
    const flicker = 0.8 + 0.2 * Math.random();
    return this.intensity * Math.max(b, 0.25) * fade * flicker;
  }
}

const VERT = /* glsl */ `
  attribute vec3 aOther;
  attribute float aSide;
  attribute float aEnd;   // +1 at the segment start, -1 at its end
  attribute vec2 aWidth; // x: core half-width, y: glow half-width (m)
  attribute vec4 aColor;
  uniform float uPx;     // world metres per pixel at distance 1
  varying float vSide;
  varying float vCore;
  varying vec4 vColor;
  void main() {
    vec4 p0 = modelViewMatrix * vec4(position, 1.0);
    vec4 p1 = modelViewMatrix * vec4(aOther, 1.0);
    vec3 dir = normalize(p1.xyz - p0.xyz + vec3(1e-5));
    vec3 toCam = normalize(-p0.xyz);
    vec3 side = normalize(cross(dir, toCam));
    float px = uPx * max(0.05, -p0.z);
    // Keep the core at least ~1.2 px and the glow at least ~7 px wide,
    // so bolts stay crisp up close and visible far away.
    float core = max(aWidth.x, px * 1.2);
    float glow = max(aWidth.y, px * 5.0);
    glow = max(glow, core * 2.5);
    // At the far end "other" points backwards, so flip to keep the same world side.
    p0.xyz += side * aSide * aEnd * glow;
    vSide = aSide;
    vCore = core / glow;
    vColor = aColor;
    gl_Position = projectionMatrix * p0;
  }
`;

const FRAG = /* glsl */ `
  varying float vSide;
  varying float vCore;
  varying vec4 vColor;
  void main() {
    float x = abs(vSide);
    // White-hot core with a sharp edge.
    float core = 1.0 - smoothstep(vCore * 0.55, vCore, x);
    // Soft coloured halo falling off with distance from the channel.
    float halo = exp(-x * x * 9.0) * 0.55 + exp(-x * 2.5) * 0.12;
    vec3 col = vColor.rgb * halo + vec3(1.0, 1.0, 1.0) * core * 3.0 + vColor.rgb * core;
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
  private end: Float32Array;
  private width: Float32Array;
  private color: Float32Array;
  private geo: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, maxSegs = 9000) {
    this.maxSegs = maxSegs;
    const v = maxSegs * 4;
    this.pos = new Float32Array(v * 3);
    this.other = new Float32Array(v * 3);
    this.side = new Float32Array(v);
    this.end = new Float32Array(v);
    this.width = new Float32Array(v * 2);
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
    this.geo.setAttribute('aEnd', dyn(this.end, 1));
    this.geo.setAttribute('aWidth', dyn(this.width, 2));
    this.geo.setAttribute('aColor', dyn(this.color, 4));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uPx: { value: 0.002 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
  }

  /** Call on resize / FOV change: metres per pixel at 1 m distance. */
  setViewport(heightPx: number, fovDeg: number) {
    this.material.uniforms.uPx.value = (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)) / Math.max(1, heightPx);
  }

  spawn(a: THREE.Vector3, b: THREE.Vector3, o: BoltOptions = {}): Bolt {
    const bolt = this.pool.pop() ?? new Bolt();
    bolt.a.copy(a);
    bolt.b.copy(b);
    bolt.age = 0;
    bolt.life = o.life ?? 0.25;
    bolt.regen = o.regen ?? 0;
    // Core width; older call sites pass the old ribbon width, so scale it down.
    bolt.width = (o.width ?? 0.08) * 0.45;
    bolt.jag = o.jag ?? 0.18;
    bolt.detail = o.detail ?? 6;
    bolt.forkChance = o.forkChance ?? 0.12;
    bolt.intensity = o.intensity ?? 1;
    bolt.strokes = o.strokes ?? 1;
    bolt.glow = o.glow ?? 7;
    bolt.color.set(o.color ?? 0x9fc4ff);
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
      const len = b.a.distanceTo(b.b);
      const taper = Math.min(3, len * 0.3);
      for (const s of b.segs) {
        if (n >= this.maxSegs) break;
        // Thin near the origin (usually the player's hands), full width further out.
        const da = Math.sqrt((s.ax - b.a.x) ** 2 + (s.ay - b.a.y) ** 2 + (s.az - b.a.z) ** 2);
        const wScale = taper > 0.01 ? Math.min(1, 0.25 + da / taper) : 1;
        const core = s.w * wScale;
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
          this.side[v] = k % 2 === 0 ? -1 : 1;
          this.end[v] = atA ? 1 : -1;
          this.width[v * 2] = core;
          this.width[v * 2 + 1] = core * b.glow;
          this.color[v * 4] = b.color.r;
          this.color[v * 4 + 1] = b.color.g;
          this.color[v * 4 + 2] = b.color.b;
          this.color[v * 4 + 3] = br * s.b;
        }
        n++;
      }
    }
    for (const name of ['position', 'aOther', 'aSide', 'aEnd', 'aWidth', 'aColor']) {
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

const TMP_D = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const RND = new THREE.Vector3();
