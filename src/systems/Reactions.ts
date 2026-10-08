import * as THREE from 'three';
import { REACTIONS, SURFACE_REACTIONS, type EffectName, type SurfaceKind } from '../config/reactions';
import { audio } from '../core/Audio';
import type { Game } from '../core/Game';
import { AMBIENT_TEMP, type ElementKind, type Entity } from '../world/Entity';
import { FX } from './Particles';

type EffectFn = (sys: Reactions, e: Entity, value: number, from?: THREE.Vector3) => void;
type SurfaceFn = (center: THREE.Vector3, radius: number, amount: number) => void;

/**
 * Effect implementations referenced by name from `config/reactions.ts`.
 * `value` is the rule's magnitude × the incoming amount.
 */
const EFFECTS: Record<EffectName, EffectFn> = {
  heat: (_s, e, v) => {
    e.temperature += v * (0.3 + e.mat.thermalRate);
  },
  cool: (_s, e, v) => {
    e.temperature = Math.max(-30, e.temperature - v * (0.3 + e.mat.thermalRate));
  },
  ignite: (s, e, v) => {
    if (e.burning || !e.flammable) return;
    if (e.temperature >= e.mat.ignitionTemp || Math.random() < v) s.ignite(e);
  },
  extinguish: (s, e, v) => {
    if (e.burning && Math.random() < Math.min(1, v * 4)) s.extinguish(e);
  },
  wet: (_s, e, v) => {
    if (e.frozen > 0.5) return;
    e.wetness = Math.min(1, e.wetness + v);
  },
  dry: (_s, e, v) => {
    e.wetness = Math.max(0, e.wetness - v);
  },
  freeze: (_s, e, v) => {
    if (e.burning) return;
    // Freezing needs moisture to make real ice; dry things only frost over.
    const cap = e.wetness > 0.2 || e.mat.id === 'ice' ? 1 : 0.45;
    e.frozen = Math.min(cap, e.frozen + v * (0.4 + e.wetness));
    if (e.frozen > 0.5) e.wetness = Math.max(0, e.wetness - v);
    e.temperature = Math.min(e.temperature, 0);
  },
  melt: (_s, e, v) => {
    if (e.frozen <= 0) return;
    e.frozen = Math.max(0, e.frozen - v);
    if (e.mat.id !== 'ice') e.wetness = Math.min(1, e.wetness + v * 0.5);
  },
  charge: (_s, e, v) => {
    e.charge = Math.min(1, e.charge + v);
  },
  damage: (s, e, v) => s.damage(e, v),
  stun: (_s, e, v) => {
    e.stun = Math.max(e.stun, v);
  },
  shatter: (s, e, v) => {
    if (!e.mat.brittle && e.mat.id !== 'ice' && e.frozen < 0.5) return;
    e.integrity -= v / Math.max(0.6, Math.cbrt(e.volume) * 1.6);
    if (e.integrity <= 0) s.breakEntity(e);
  },
  steam: (s, e, v) => s.steam(e.center(TMP), Math.min(2, v) * (0.6 + e.radius)),
  sparks: (s, e, v) => {
    s.game.particles.emit(FX.spark, e.center(TMP), 6 * Math.min(2, v), { spread: Math.PI, speed: [2, 6], jitter: e.radius * 0.5 });
  },
};

/**
 * Element & material reaction system.
 *
 * - `apply(entity, element, amount)` runs the interaction table on one entity.
 * - `applyArea(element, centre, radius, amount)` hits every entity in range
 *   (with distance falloff) *and* the world surfaces there (water, grass, ground).
 * - `fixedUpdate` simulates temperature, drying, melting, charge decay and
 *   spontaneous ignition for every entity.
 */
export class Reactions {
  private surfaceFx = new Map<string, SurfaceFn>();
  /** Detects which world surfaces are present at a point. */
  surfacesAt: (p: THREE.Vector3, radius: number) => SurfaceKind[] = () => [];
  /** Fire system hooks (set by Fire). */
  onIgnite: ((e: Entity) => void) | null = null;
  onExtinguish: ((e: Entity) => void) | null = null;
  /** Destruction hook (set by Destruction). */
  onBreak: ((e: Entity) => void) | null = null;
  private tmpList: Entity[] = [];
  private steamBudget = 0;

  constructor(readonly game: Game) {}

  registerSurfaceEffect(name: string, fn: SurfaceFn) {
    this.surfaceFx.set(name, fn);
  }

  /** Run the interaction table for one entity. */
  apply(e: Entity, element: ElementKind, amount: number, from?: THREE.Vector3) {
    if (e.dead || amount <= 0) return;
    e.refreshTags();
    for (const rule of REACTIONS) {
      if (rule.element !== element) continue;
      if (rule.all && !rule.all.every((t) => e.tags.has(t))) continue;
      if (rule.none && rule.none.some((t) => e.tags.has(t))) continue;
      for (const [fx, mag] of rule.effects) EFFECTS[fx](this, e, mag * amount, from);
      if (rule.final) break;
    }
    e.onElement?.(element, amount, from);
    e.refreshTags();
  }

  /**
   * Apply an element in a sphere. Entities get `amount` scaled by a linear
   * falloff; surfaces get the full amount.
   */
  applyArea(
    element: ElementKind,
    center: THREE.Vector3,
    radius: number,
    amount: number,
    opts: { falloff?: boolean; surfaces?: boolean; exclude?: Entity; impulse?: number } = {},
  ): Entity[] {
    const list = this.game.entities.nearby(center, radius, this.tmpList);
    for (const e of list) {
      if (e === opts.exclude) continue;
      const d = e.center(TMP).distanceTo(center);
      const k = opts.falloff === false ? 1 : Math.max(0.15, 1 - Math.max(0, d - e.radius) / radius);
      this.apply(e, element, amount * k, center);
      if (opts.impulse && e.isDynamic) {
        const dir = TMP2.copy(TMP).sub(center);
        dir.y += 0.4;
        dir.normalize().multiplyScalar(opts.impulse * k * Math.min(1, e.mass / 40 + 0.3));
        e.applyImpulse(dir.x, dir.y, dir.z);
      }
    }
    if (opts.surfaces !== false) this.applySurfaces(element, center, radius, amount);
    return list;
  }

  /** Run surface rules for the surfaces present at a point. */
  applySurfaces(element: ElementKind, center: THREE.Vector3, radius: number, amount: number) {
    const surfaces = this.surfacesAt(center, radius);
    for (const rule of SURFACE_REACTIONS) {
      if (rule.element !== element || !surfaces.includes(rule.surface)) continue;
      this.surfaceFx.get(rule.effect)?.(center, radius, amount);
    }
  }

  damage(e: Entity, amount: number, kind: ElementKind = 'impact') {
    if (e.dead || amount <= 0) return;
    if (e.onDamage) {
      e.onDamage(amount, kind);
      return;
    }
    if (e.mat.brittle || e.isStatic) {
      e.integrity -= amount / (Math.max(0.3, e.volume) * 600);
      if (e.integrity <= 0 && e.mat.brittle) this.breakEntity(e);
    }
  }

  ignite(e: Entity) {
    if (e.burning || e.dead) return;
    e.burning = true;
    e.temperature = Math.max(e.temperature, e.mat.ignitionTemp + 50);
    this.onIgnite?.(e);
  }

  extinguish(e: Entity) {
    if (!e.burning) return;
    e.burning = false;
    e.temperature = Math.min(e.temperature, 90);
    this.onExtinguish?.(e);
  }

  breakEntity(e: Entity) {
    if (e.dead) return;
    if (e.onBreak) e.onBreak();
    else this.onBreak?.(e);
  }

  /** Steam puff + hiss, rate limited. */
  steam(pos: THREE.Vector3, amount: number) {
    if (this.steamBudget <= 0) return;
    this.steamBudget--;
    this.game.particles.emit(FX.steam, pos, 3 + amount * 6, { spread: 0.6, speed: [0.5, 2], jitter: 0.4 });
    audio.hiss(pos, Math.min(1, 0.3 + amount * 0.3));
  }

  fixedUpdate(dt: number) {
    this.steamBudget = 3;
    const list = this.game.entities.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      // Temperature relaxes to ambient (burning things are held hot by Fire).
      if (!e.burning) {
        const target = e.frozen > 0.05 ? Math.min(AMBIENT_TEMP, 0) : AMBIENT_TEMP;
        e.temperature += (target - e.temperature) * Math.min(1, e.mat.thermalRate * 0.25 * dt);
      }
      // Spontaneous ignition from accumulated heat.
      if (!e.burning && e.flammable && e.temperature >= e.mat.ignitionTemp) this.ignite(e);
      // Ice melts when warm; things thaw at ambient slowly.
      if (e.frozen > 0) {
        const warm = Math.max(0, e.temperature - 2);
        const rate = e.mat.id === 'ice' ? 0.001 + warm * 0.0015 : 0.025 + warm * 0.002;
        e.frozen = Math.max(0, e.frozen - rate * dt);
        if (e.mat.id === 'ice') {
          // Melting ice visibly shrinks (the collider stays; it's removed when gone).
          e.object.scale.setScalar(0.35 + 0.65 * Math.sqrt(e.frozen));
          if (e.frozen <= 0) this.meltAway(e);
        }
      }
      // Drying.
      if (e.wetness > 0) e.wetness = Math.max(0, e.wetness - dt * 0.015 * (1 + Math.max(0, e.temperature - AMBIENT_TEMP) / 40));
      // Charge leaks away (metal holds it longer).
      if (e.charge > 0) e.charge = Math.max(0, e.charge - dt * (e.mat.conductive ? 0.12 : 0.6));
      e.refreshTags();
    }
  }

  /** Pure-ice entities that melt completely leave water behind. */
  private meltAway(e: Entity) {
    const p = e.center(TMP);
    this.game.decals.add('wet', TMP2.set(p.x, this.game.world.heightAt(p.x, p.z), p.z), UP, 1.5 + e.radius * 2, 25, 0.8);
    this.game.particles.emit(FX.droplet, p, 10, { spread: Math.PI, speed: [0.5, 2], jitter: e.radius });
    this.game.entities.remove(e);
  }
}

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
