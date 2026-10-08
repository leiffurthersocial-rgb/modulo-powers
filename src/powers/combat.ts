import * as THREE from 'three';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import { time } from '../core/Time';
import type { ElementKind, Entity } from '../world/Entity';
import { FX, type ParticlePreset } from '../systems/Particles';

export interface StrikeOpts {
  /** Reach from the player (m). */
  range: number;
  /** Half-angle of the hit cone (radians). */
  arc?: number;
  damage: number;
  /** Knockback speed (m/s) given to what's hit. */
  knockback?: number;
  /** Extra upward speed (launchers / uppercuts). */
  lift?: number;
  element?: ElementKind;
  /** Reaction amount for the element. */
  amount?: number;
  /** VFX / damage-number colour. */
  color?: number;
  /** Particle preset for the impact. */
  fx?: ParticlePreset;
  maxTargets?: number;
  hitstop?: number;
  critChance?: number;
  critMul?: number;
  /** Override origin / direction (default: player chest, camera aim). */
  origin?: THREE.Vector3;
  dir?: THREE.Vector3;
  /** Backstab multiplier against unaware targets seen from behind. */
  backstab?: number;
  /** Called for every target hit. */
  onHit?: (e: Entity, point: THREE.Vector3, crit: boolean) => void;
  /** Sound weight 0..1. */
  heavy?: number;
}

export interface StrikeResult {
  hits: Entity[];
  crit: boolean;
  backstab: boolean;
}

/** Things worth hitting: living targets, dynamic props and breakables. */
export function hittable(e: Entity): boolean {
  if (e.dead) return false;
  return !!e.onDamage || e.isDynamic || e.mat.brittle || e.tags.has('target') || e.tags.has('collapsible');
}

/** Is the attacker behind a target that has a facing direction? */
export function isBehind(e: Entity, attacker: THREE.Vector3): boolean {
  const f = e.facing?.();
  if (!f) return false;
  const to = TMP_A.copy(attacker).sub(e.center(TMP_B)).setY(0).normalize();
  return to.dot(f) < -0.3;
}

/** Find the best target in a cone in front of the camera. */
export function findTarget(g: Game, range: number, cone = 0.5, livingOnly = true): Entity | null {
  const origin = g.player.curPos;
  const dir = g.rig.aimDirection(TMP_D);
  let best: Entity | null = null;
  let bestScore = -Infinity;
  for (const e of g.entities.nearby(origin, range + 1, NEAR)) {
    if (livingOnly ? !e.onDamage : !hittable(e)) continue;
    if (e.dead || e.type === 'treasure') continue;
    const to = e.center(TMP_A).sub(origin);
    const d = to.length();
    if (d > range + e.radius) continue;
    to.divideScalar(d);
    const c = to.dot(dir);
    if (c < Math.cos(cone)) continue;
    const score = c * 2 - d / range;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/**
 * Melee strike in a cone in front of the player: damage, element, knockback,
 * hit-stop, camera shake, sparks, damage numbers and combo counting.
 */
export function strike(g: Game, o: StrikeOpts): StrikeResult {
  const origin = o.origin ?? TMP_O.copy(g.player.curPos).setY(g.player.curPos.y + 0.4);
  const dir = o.dir ?? g.rig.aimDirection(TMP_D);
  const arc = Math.cos(o.arc ?? 0.65);
  const hits: Entity[] = [];
  let crit = false;
  let backstab = false;
  const list = g.entities.nearby(origin, o.range + 1.5, NEAR);
  // Closest first.
  list.sort((a, b) => a.center(TMP_A).distanceToSquared(origin) - b.center(TMP_B).distanceToSquared(origin));
  for (const e of list) {
    if (!hittable(e)) continue;
    const c = e.center(TMP_A);
    const to = TMP_B.copy(c).sub(origin);
    const d = to.length();
    if (d > o.range + e.radius) continue;
    if (d > 0.3 && to.divideScalar(d).dot(dir) < arc) continue;
    hits.push(e);
    if (hits.length >= (o.maxTargets ?? 4)) break;
  }
  for (const e of hits) {
    const c = e.center(new THREE.Vector3());
    let dmg = o.damage * (g.damageBoost ?? 1);
    let isCrit = Math.random() < (o.critChance ?? 0);
    if (o.backstab && isBehind(e, g.player.curPos) && !(e.aware?.() ?? false)) {
      dmg *= o.backstab;
      isCrit = true;
      backstab = true;
    }
    if (isCrit) {
      dmg *= o.critMul ?? 2;
      crit = true;
    }
    g.reactions.damage(e, dmg, o.element ?? 'impact');
    if (o.element) g.reactions.apply(e, o.element, o.amount ?? 0.5, origin);
    // Knockback along the strike direction (+ lift).
    const kb = (o.knockback ?? 4) * (isCrit ? 1.5 : 1);
    const push = TMP_A.copy(c).sub(origin).setY(0).normalize().multiplyScalar(kb);
    push.y = (o.lift ?? 1.5) * (isCrit ? 1.3 : 1);
    if (e.isDynamic) {
      const m = Math.min(e.mass, 400);
      e.applyImpulse(push.x * m, push.y * m, push.z * m);
    } else if (e.onImpulse) {
      e.onImpulse(push.x * 80, push.y * 80, push.z * 80);
    }
    const p = TMP_B.copy(c).lerp(origin, 0.25);
    g.particles.emit(o.fx ?? FX.spark, p, isCrit ? 30 : 14, { spread: 1.2, dir: TMP_D.copy(dir), speed: [3, 8] });
    if (o.color !== undefined) g.lights.add(p, o.color, isCrit ? 20 : 8, 6);
    if (e.onDamage) {
      g.damageNumbers.spawn(c.setY(c.y + 0.8), dmg, isCrit ? '#ffd23f' : o.color !== undefined ? `#${new THREE.Color(o.color).getHexString()}` : '#ffffff', isCrit, backstab ? `BACKSTAB ${Math.round(dmg)}` : undefined);
      g.damageNumbers.hit();
    }
    o.onHit?.(e, p, isCrit);
  }
  const heavy = o.heavy ?? 0.5;
  if (hits.length) {
    time.freeze((o.hitstop ?? 0.045) * (crit ? 2.5 : 1));
    g.rig.shake(0.12 + heavy * 0.25 + (crit ? 0.25 : 0));
    g.rig.fovPunch(crit ? 6 : 2);
    audio.noiseBurst({ pos: origin, volume: 0.5 + heavy * 0.5, decay: 0.12 + heavy * 0.1, freq: 900 - heavy * 400, freqEnd: 120, brown: true });
    audio.tone({ pos: origin, volume: 0.25 + heavy * 0.2, freq: 140 - heavy * 50, freqEnd: 50, decay: 0.15, type: 'sine' });
    if (crit) audio.noiseBurst({ volume: 0.5, decay: 0.3, filter: 'highpass', freq: 2500 });
    g.stealth.noise(origin, 10);
  } else {
    audio.whoosh(origin, 0.3 + heavy * 0.3, 1.3);
  }
  return { hits, crit, backstab };
}

interface Dash {
  dir: THREE.Vector3;
  speed: number;
  left: number;
  target: Entity | null;
  stopDist: number;
  onArrive: (() => void) | null;
}

/**
 * Short scripted dashes (lunges, flash-steps) driven at physics rate. The
 * character controller still handles collisions, so dashes never pass
 * through walls.
 */
export class CombatSystem implements GameSystem {
  private dash: Dash | null = null;

  constructor(private g: Game) {}

  get dashing(): boolean {
    return !!this.dash;
  }

  /** Dash towards a target (stopping in front of it) or along a direction. */
  lunge(dir: THREE.Vector3, speed: number, duration: number, target: Entity | null = null, stopDist = 1.4, onArrive: (() => void) | null = null) {
    this.dash = { dir: dir.clone().normalize(), speed, left: duration, target, stopDist, onArrive };
    this.g.player.noGravity = true;
  }

  fixedUpdate(dt: number) {
    const d = this.dash;
    if (!d) return;
    const pl = this.g.player;
    d.left -= dt;
    if (d.target && !d.target.dead) {
      const to = d.target.center(TMP_A).sub(pl.curPos);
      to.y *= 0.5;
      const dist = to.length();
      if (dist <= d.stopDist + d.target.radius * 0.5) {
        this.finish();
        return;
      }
      d.dir.copy(to).normalize();
    }
    pl.velocity.copy(d.dir).multiplyScalar(d.speed);
    pl.thrust(TMP_B.set(0, 0.001, 0));
    if (d.left <= 0) this.finish();
  }

  private finish() {
    const d = this.dash;
    this.dash = null;
    const pl = this.g.player;
    pl.noGravity = false;
    pl.velocity.multiplyScalar(0.15);
    d?.onArrive?.();
  }

  reset() {
    if (this.dash) {
      this.dash = null;
      this.g.player.noGravity = false;
    }
  }
}

const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_D = new THREE.Vector3();
const TMP_O = new THREE.Vector3();
const NEAR: Entity[] = [];
