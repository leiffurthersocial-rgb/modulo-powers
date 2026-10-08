import * as THREE from 'three';
import { MATERIALS, type MaterialDef, type MaterialId } from '../config/materials';
import type { RAPIER } from '../core/Physics';

export const AMBIENT_TEMP = 20;

/** A serialisable description of a prop, used to (re)spawn it. */
export interface PropSpec {
  type: string;
  x: number;
  y: number;
  z: number;
  /** Euler rotation (radians). */
  rx?: number;
  ry?: number;
  rz?: number;
  /** Generic size parameters, interpreted by the factory. */
  w?: number;
  h?: number;
  d?: number;
  /** Optional overrides. */
  material?: MaterialId;
  fixed?: boolean;
  /** Free-form extra data (e.g. which gate a lever opens). */
  data?: Record<string, unknown>;
}

/** Element kinds that can be applied to entities. */
export type ElementKind = 'fire' | 'heat' | 'water' | 'cold' | 'lightning' | 'earth' | 'impact' | 'shadow';

/**
 * A simulated object in the world: a physics body + a visual + elemental
 * state (temperature, fuel, wetness, charge, frozen, integrity).
 *
 * The reaction system mutates the state; `EntityVisual` turns it into
 * material changes (char, glow, wet sheen, ice).
 */
export class Entity {
  private static nextId = 1;
  readonly id = Entity.nextId++;
  mat: MaterialDef;
  /** Static tags from the material plus dynamic ones (burning, wet, charged, ...). */
  readonly tags = new Set<string>();
  body: RAPIER.RigidBody | null = null;
  colliders: RAPIER.Collider[] = [];
  object: THREE.Object3D;
  visual: EntityVisual;
  /** Approximate volume (m³) for fuel/buoyancy. */
  volume = 1;
  /** Bounding radius (m) for area queries. */
  radius = 0.5;

  temperature = AMBIENT_TEMP;
  fuel = 1;
  burning = false;
  char = 0;
  wetness = 0;
  charge = 0;
  /** 0..1 how frozen (encased in ice). */
  frozen = 0;
  integrity = 1;
  /** Seconds remaining of "stunned" (dummies / NPCs). */
  stun = 0;
  /** Removed from the world (pending cleanup). */
  dead = false;
  /** Spawned at runtime by a power (always removed on reset). */
  transient = false;
  /** Has no physical body that moves (buildings, terrain features). */
  isStatic = false;
  /** Prop type name. */
  type: string;
  spec: PropSpec | null = null;

  /** Optional per-entity behaviour (machines, dummies, gates...). */
  update?: (dt: number) => void;
  /** Called when an element hits this entity (generators, braziers, plates...). */
  onElement?: (kind: ElementKind, amount: number, from?: THREE.Vector3) => void;
  /** Called when the entity takes damage (dummies, guards, destructibles). */
  onDamage?: (amount: number, kind: ElementKind) => void;
  /** Called by the F key when the player looks at this entity. */
  interact?: () => void;
  interactLabel?: string;
  /** Called when the entity is removed from the world. */
  onRemove?: () => void;
  /** Called when a burning entity runs out of fuel. Default: small props crumble. */
  onBurnout?: () => void;
  /** Called when integrity reaches zero. Default: shatter/collapse via Destruction. */
  onBreak?: () => void;

  constructor(type: string, material: MaterialId | MaterialDef, object: THREE.Object3D) {
    this.type = type;
    this.mat = typeof material === 'string' ? MATERIALS[material] : material;
    for (const t of this.mat.tags) this.tags.add(t);
    if (this.mat.flammable) this.tags.add('flammable');
    if (this.mat.conductive) this.tags.add('conductive');
    if (this.mat.brittle) this.tags.add('brittle');
    this.object = object;
    this.visual = new EntityVisual(object);
    if (this.mat.id === 'ice') {
      this.frozen = 1;
      this.temperature = -5;
    }
  }

  /** World-space centre (body translation, or object position for static entities). */
  center(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.body) {
      const t = this.body.translation();
      return out.set(t.x, t.y, t.z);
    }
    return this.object.getWorldPosition(out);
  }

  get mass(): number {
    return this.body ? this.body.mass() : this.volume * this.mat.density;
  }

  get isDynamic(): boolean {
    return !!this.body && this.body.isDynamic();
  }

  /** Is the entity conductive right now (metal, or soaked)? */
  get conductive(): boolean {
    return this.mat.conductive || this.wetness > 0.35;
  }

  /** Can it currently burn? */
  get flammable(): boolean {
    return this.mat.flammable && this.fuel > 0.02 && this.wetness < 0.4 && this.frozen < 0.3;
  }

  /** Recompute dynamic tags from state (called by the reaction system). */
  refreshTags() {
    this.setTag('burning', this.burning);
    this.setTag('wet', this.wetness > 0.25);
    this.setTag('charged', this.charge > 0.05);
    this.setTag('frozen', this.frozen > 0.5);
    this.setTag('charred', this.char > 0.5);
    this.setTag('hot', this.temperature > 150);
  }

  private setTag(t: string, on: boolean) {
    if (on) this.tags.add(t);
    else this.tags.delete(t);
  }

  applyImpulse(x: number, y: number, z: number) {
    if (this.body && this.body.isDynamic()) this.body.applyImpulse({ x, y, z }, true);
  }
}

/**
 * Turns elemental state into material changes. Materials are cloned lazily
 * the first time an entity's look changes, so untouched props share materials.
 */
export class EntityVisual {
  private meshes: THREE.Mesh[] = [];
  /** The first mesh's original (shared) material, e.g. for debris. */
  baseMaterial: THREE.Material | null = null;
  private own = false;
  private base: { color: THREE.Color; rough: number; emissive: THREE.Color; emissiveIntensity: number }[] = [];
  private mats: THREE.MeshStandardMaterial[] = [];
  private lastKey = '';
  /** Extra emissive set by entity logic (e.g. a powered generator light). */
  readonly extraEmissive = new THREE.Color(0, 0, 0);

  constructor(object: THREE.Object3D) {
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.noVisualState) this.meshes.push(m);
    });
    const first = this.meshes[0];
    if (first) this.baseMaterial = Array.isArray(first.material) ? first.material[0] : first.material;
  }

  private ensureOwn() {
    if (this.own) return;
    this.own = true;
    const cloned = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    for (const mesh of this.meshes) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = list.map((mat) => {
        let c = cloned.get(mat);
        if (!c) {
          c = (mat as THREE.MeshStandardMaterial).clone();
          cloned.set(mat, c);
          this.mats.push(c);
          this.base.push({
            color: c.color.clone(),
            rough: c.roughness,
            emissive: c.emissive.clone(),
            emissiveIntensity: c.emissiveIntensity,
          });
        }
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    }
  }

  /**
   * Apply state. `glow` is metal heat (0..1), `ember` is burning glow,
   * `charge` electric shimmer, `frozen` ice tint.
   */
  apply(e: Entity, time: number) {
    const glow = e.mat.glows ? THREE.MathUtils.clamp((e.temperature - 250) / 650, 0, 1) : 0;
    const ember = e.burning ? 0.6 + 0.4 * Math.sin(time * 9 + e.id) * Math.sin(time * 5.3 + e.id * 2) : 0;
    const charge = e.charge > 0.05 ? e.charge * (0.5 + 0.5 * Math.sin(time * 40 + e.id)) : 0;
    const extra = this.extraEmissive.r + this.extraEmissive.g + this.extraEmissive.b;
    const key = `${e.char.toFixed(2)}|${e.wetness.toFixed(2)}|${e.frozen.toFixed(2)}|${glow.toFixed(2)}|${ember.toFixed(2)}|${charge.toFixed(2)}|${extra.toFixed(3)}`;
    if (key === this.lastKey) return;
    const neutral = e.char < 0.01 && e.wetness < 0.01 && glow === 0 && ember === 0 && charge === 0 && extra === 0 && (e.frozen < 0.01 || e.mat.id === 'ice');
    if (neutral && !this.own) return;
    this.lastKey = key;
    this.ensureOwn();
    for (let i = 0; i < this.mats.length; i++) {
      const m = this.mats[i];
      const b = this.base[i];
      m.color.copy(b.color);
      // Char: towards near-black.
      if (e.char > 0) m.color.lerp(CHAR, e.char * 0.88);
      // Wet: darker and glossier.
      m.color.multiplyScalar(1 - e.wetness * 0.35);
      m.roughness = THREE.MathUtils.lerp(b.rough, 0.15, e.wetness * 0.8);
      // Frozen: icy blue-white, very smooth.
      if (e.frozen > 0 && e.mat.id !== 'ice') {
        m.color.lerp(ICE, e.frozen * 0.7);
        m.roughness = THREE.MathUtils.lerp(m.roughness, 0.08, e.frozen);
      }
      m.emissive.copy(b.emissive).multiplyScalar(b.emissiveIntensity);
      m.emissiveIntensity = 1;
      if (glow > 0) m.emissive.add(TMP.copy(HEAT).lerp(HEAT_WHITE, glow * glow).multiplyScalar(glow * 2.5));
      if (ember > 0) m.emissive.add(TMP.copy(EMBER).multiplyScalar(ember * (0.4 + e.char)));
      if (charge > 0) m.emissive.add(TMP.copy(ELECTRIC).multiplyScalar(charge * 1.5));
      m.emissive.add(this.extraEmissive);
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
  }
}

const CHAR = new THREE.Color(0.02, 0.018, 0.015);
const ICE = new THREE.Color(0.7, 0.85, 1.0);
const HEAT = new THREE.Color(0.8, 0.08, 0.0);
const HEAT_WHITE = new THREE.Color(1.0, 0.75, 0.4);
const EMBER = new THREE.Color(1.0, 0.25, 0.02);
const ELECTRIC = new THREE.Color(0.4, 0.75, 1.0);
const TMP = new THREE.Color();
