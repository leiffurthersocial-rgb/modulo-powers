import * as THREE from 'three';
import { audio } from '../core/Audio';
import type { Game } from '../core/Game';
import type { ElementKind } from '../world/Entity';
import { FX, type ParticlePreset } from '../systems/Particles';

export interface ExplosionOpts {
  radius: number;
  /** Peak impulse (N·s) applied to a body at the centre. */
  impulse: number;
  element: ElementKind;
  /** Reaction amount at the centre. */
  amount: number;
  /** Damage to targets at the centre. */
  damage?: number;
  /** Knockback speed on the player at the centre (m/s). */
  playerPush?: number;
  decal?: 'scorch' | 'crack' | 'frost' | 'wet' | null;
  /** Particle look. */
  look?: 'fire' | 'dust' | 'water' | 'electric' | 'shadow';
  normal?: THREE.Vector3;
  sound?: boolean;
}

/**
 * Generic blast used by fireballs, boulder impacts, earth slams, lightning
 * strikes: elemental reactions + radial impulse + player knockback + camera
 * shake/flash + decal + VFX + sound.
 */
export function explosion(game: Game, pos: THREE.Vector3, o: ExplosionOpts) {
  const g = game;
  const n = o.normal ?? UP;
  const look = o.look ?? 'fire';
  g.reactions.applyArea(o.element, pos, o.radius, o.amount, { impulse: o.impulse });
  if (o.damage) {
    for (const e of g.entities.nearby(pos, o.radius, TMP_LIST)) {
      const d = e.center(TMP).distanceTo(pos);
      g.reactions.damage(e, o.damage * Math.max(0.2, 1 - d / o.radius), o.element);
    }
  }
  // Player knockback (rocket jumps!).
  const pc = g.player.curPos;
  const dp = TMP.copy(pc).sub(pos);
  const dist = dp.length();
  if (o.playerPush && dist < o.radius * 1.2) {
    const k = 1 - dist / (o.radius * 1.2);
    dp.normalize();
    dp.y = Math.max(dp.y, 0.35);
    dp.normalize().multiplyScalar(o.playerPush * k * (g.shielded || g.armored ? 0.4 : 1));
    g.player.thrust(dp);
  }
  // Noise and light give the player away.
  g.stealth.noise(pos, o.radius * 10);
  if (look === 'fire' || look === 'electric') {
    if (dist < o.radius * 5) g.stealth.reveal = Math.max(g.stealth.reveal, 1.2);
  }
  // Camera feedback by distance.
  const camD = g.camera.position.distanceTo(pos);
  g.rig.shake(Math.min(0.8, (o.radius * 0.6) / Math.max(1.5, camD * 0.5)));
  if (camD < o.radius * 6) g.rig.addFlash(Math.min(0.35, o.radius / Math.max(4, camD * 1.5)));
  // Decal on the ground / surface.
  if (o.decal) {
    const gy = g.world.heightAt(pos.x, pos.z);
    if (pos.y - gy < 1.5) g.decals.add(o.decal, TMP2.set(pos.x, gy, pos.z), g.world.terrain.normalAt(pos.x, pos.z), o.radius * 1.4, 60);
    else g.decals.add(o.decal, pos, n, o.radius * 0.9, 60);
  }
  const r = o.radius;
  const P = g.particles;
  const burst = (preset: ParticlePreset, count: number, speed: [number, number], sizeMul = 1) =>
    P.emit(preset, pos, count, { spread: Math.PI, dir: n, speed, jitter: r * 0.15, sizeMul });
  if (look === 'fire') {
    burst(FX.flame, 40 + r * 12, [r * 1.5, r * 3.5], 1 + r * 0.25);
    burst(FX.fire, 30 + r * 10, [r * 0.8, r * 2.2], 1 + r * 0.3);
    burst(FX.smoke, 12 + r * 4, [r * 0.4, r * 1.2], 1 + r * 0.2);
    burst(FX.ember, 30 + r * 10, [2, 4 + r * 2]);
    burst(FX.spark, 25, [4, 10 + r * 2]);
    g.lights.add(pos, 0xff8a3a, 40 + r * 10, r * 6);
  } else if (look === 'dust') {
    burst(FX.dust, 20 + r * 8, [r * 0.5, r * 1.8], 1 + r * 0.2);
    burst(FX.debris, 25 + r * 6, [3, 6 + r]);
  } else if (look === 'water') {
    burst(FX.splash, 40 + r * 10, [2, 5 + r * 2], 1 + r * 0.2);
    burst(FX.droplet, 40, [3, 8]);
  } else if (look === 'electric') {
    burst(FX.electric, 40, [3, 10]);
    burst(FX.spark, 30, [4, 10]);
  } else if (look === 'shadow') {
    burst(FX.shadow, 30, [1, 3], 1.2);
    burst(FX.shadowGlow, 20, [2, 5]);
  }
  if (o.sound !== false) {
    if (look === 'fire') audio.explosion(pos, Math.min(1.5, 0.5 + r * 0.2));
    else if (look === 'dust') audio.rumble(pos, Math.min(1.5, 0.4 + r * 0.2), 0.9);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const TMP_LIST: import('../world/Entity').Entity[] = [];
