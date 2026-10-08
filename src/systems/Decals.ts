import * as THREE from 'three';
import { mulberry32 } from '../core/math/noise';

export type DecalType = 'scorch' | 'crack' | 'wet' | 'frost' | 'mud' | 'burnt';

interface DecalSlot {
  age: number;
  life: number;
  alpha: number;
}

/** Procedural decal textures (alpha in the texture's alpha channel). */
function decalTexture(type: DecalType): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(type.length * 977 + 3);
  const mid = size / 2;
  ctx.clearRect(0, 0, size, size);
  if (type === 'crack') {
    ctx.strokeStyle = 'rgba(20,16,12,0.95)';
    ctx.lineCap = 'round';
    const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let cx = x;
      let cy = y;
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        ang += (rnd() - 0.5) * 0.8;
        cx += Math.cos(ang) * (len / steps);
        cy += Math.sin(ang) * (len / steps);
        ctx.lineTo(cx, cy);
        if (depth > 0 && rnd() < 0.3) branch(cx, cy, ang + (rnd() - 0.5) * 1.6, len * 0.5, w * 0.6, depth - 1);
      }
      ctx.stroke();
    };
    for (let i = 0; i < 7; i++) branch(mid, mid, (i / 7) * Math.PI * 2 + rnd() * 0.5, mid * (0.6 + rnd() * 0.35), 3, 2);
  } else {
    const colors: Record<Exclude<DecalType, 'crack'>, [number, number, number, number]> = {
      scorch: [12, 9, 7, 0.92],
      burnt: [18, 14, 10, 0.85],
      wet: [10, 18, 28, 0.45],
      frost: [225, 240, 255, 0.85],
      mud: [52, 38, 24, 0.85],
    };
    const [r, g, b, a] = colors[type];
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - mid) / mid;
        const dy = (y - mid) / mid;
        const ang = Math.atan2(dy, dx);
        const wob = 1 + 0.18 * Math.sin(ang * 5 + 1.3) + 0.1 * Math.sin(ang * 11 + 0.4);
        const d = Math.sqrt(dx * dx + dy * dy) / (0.85 * wob);
        let alpha = Math.max(0, 1 - d);
        alpha = Math.pow(alpha, type === 'frost' ? 0.6 : 0.8);
        const noise = rnd();
        alpha *= 0.75 + noise * 0.25;
        if (type === 'frost') alpha *= 0.5 + 0.5 * (Math.sin(x * 0.9) * Math.sin(y * 0.9) > 0.2 ? 1 : 0.5);
        const i = (y * size + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = Math.min(255, alpha * a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class DecalLayer {
  readonly mesh: THREE.InstancedMesh;
  private slots: DecalSlot[] = [];
  private next = 0;
  private opacity: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(type: DecalType, readonly capacity: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOpacity', this.opacity);
    const mat = new THREE.MeshStandardMaterial({
      map: decalTexture(type),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: type === 'wet' || type === 'frost' ? 0.1 : 0.95,
      metalness: 0,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aOpacity;\nvarying float vOpacity;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOpacity = aOpacity;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vOpacity;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vOpacity;');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
  }

  add(pos: THREE.Vector3, normal: THREE.Vector3, size: number, life: number, alpha: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.slots[i] = { age: 0, life, alpha };
    this.q.setFromUnitVectors(UP, normal);
    this.q.multiply(TMP_Q.setFromAxisAngle(UP, Math.random() * Math.PI * 2));
    this.s.set(size, 1, size);
    this.m.compose(TMP_P.copy(pos).addScaledVector(normal, 0.02), this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.setX(i, alpha);
    this.opacity.needsUpdate = true;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
  }

  update(dt: number) {
    let changed = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.slots[i];
      if (!s || s.life <= 0) continue;
      s.age += dt;
      const fade = s.life - s.age < 3 ? Math.max(0, (s.life - s.age) / 3) : 1;
      const a = s.alpha * fade * Math.min(1, s.age * 6 + 0.3);
      if (Math.abs(this.opacity.getX(i) - a) > 0.004) {
        this.opacity.setX(i, a);
        changed = true;
      }
      if (s.age >= s.life) s.life = 0;
    }
    if (changed) this.opacity.needsUpdate = true;
  }

  clear() {
    this.slots = [];
    this.next = 0;
    this.mesh.count = 0;
  }
}

/**
 * Surface decals (scorch marks, cracks, wet patches, frost, mud).
 * One InstancedMesh per type with a ring buffer, so spawning is free and old
 * decals are recycled.
 */
export class Decals {
  private layers = new Map<DecalType, DecalLayer>();

  constructor(scene: THREE.Scene) {
    const types: [DecalType, number][] = [
      ['scorch', 96],
      ['burnt', 64],
      ['crack', 48],
      ['wet', 64],
      ['frost', 48],
      ['mud', 48],
    ];
    for (const [t, cap] of types) {
      const l = new DecalLayer(t, cap);
      this.layers.set(t, l);
      scene.add(l.mesh);
    }
  }

  add(type: DecalType, pos: THREE.Vector3, normal: THREE.Vector3, size: number, life = 40, alpha = 1) {
    this.layers.get(type)!.add(pos, normal, size, life, alpha);
  }

  update(dt: number) {
    if (dt <= 0) return;
    for (const l of this.layers.values()) l.update(dt);
  }

  reset() {
    for (const l of this.layers.values()) l.clear();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP_Q = new THREE.Quaternion();
const TMP_P = new THREE.Vector3();
