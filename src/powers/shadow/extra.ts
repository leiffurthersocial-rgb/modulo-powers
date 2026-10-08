import * as THREE from 'three';
import { audio } from '../../core/Audio';
import { time } from '../../core/Time';
import { FX, type ParticlePreset } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import { Ability } from '../Ability';
import { findTarget, strike } from '../combat';
import { handPos, pose } from '../common';
import { MeleeAbility } from '../MeleeAbility';

const CURSED: ParticlePreset = {
  blend: 'alpha',
  life: [0.25, 0.55],
  size: [0.2, 0.4],
  sizeEnd: 0.3,
  color0: 0x5a1aa0,
  color1: 0x12041e,
  alpha: 0.85,
  fadeIn: 0.05,
  buoyancy: 2.5,
  drag: 2,
  turbulence: 6,
  shape: 1,
  intensity: 1.4,
};
const BLACK_FLASH: ParticlePreset = {
  blend: 'add',
  life: [0.08, 0.2],
  size: [0.1, 0.25],
  sizeEnd: 0.3,
  color0: 0xff2030,
  color1: 0x200008,
  alpha: 1,
  fadeIn: 0.02,
  drag: 4,
  shape: 2,
  intensity: 6,
};

/**
 * V — Cursed Strike: punches infused with cursed energy. Sometimes the
 * distortion lines up perfectly: BLACK FLASH — 2.5× damage, black-red
 * lightning, and you enter "the zone" (higher Black Flash chance for a while).
 */
export class CursedStrike extends MeleeAbility {
  readonly name = 'Cursed Strike';
  readonly description = 'Punches infused with cursed energy. Land a BLACK FLASH (crit ×2.5, red-black lightning) and you enter the zone — more Black Flashes for 10 s.';
  icon = ICONS.cursed;
  cost = 7;
  cooldown = 0.22;
  private zone = 0;

  protected hit(step: number) {
    const g = this.game;
    const side = step % 2 ? 'left' : 'right';
    const hand = handPos(g, side, new THREE.Vector3());
    const chance = this.zone > 0 ? 0.32 : 0.12;
    const res = strike(g, {
      range: 2.4,
      damage: step % 4 === 3 ? 36 : 24,
      knockback: step % 4 === 3 ? 10 : 5,
      lift: 2,
      element: 'shadow',
      color: 0x8a3aff,
      fx: CURSED,
      critChance: chance,
      critMul: 2.5,
      heavy: 0.6,
    });
    const dir = g.rig.aimDirection(new THREE.Vector3());
    g.particles.emit(CURSED, hand, 16, { dir, spread: 0.6, speed: [2, 6] });
    g.hands.glow(0x6a2aff, 0.8);
    if (res.crit && res.hits.length) {
      // BLACK FLASH.
      this.zone = 10;
      const c = res.hits[0].center(new THREE.Vector3());
      time.freeze(0.22);
      g.rig.addFlash(0.25);
      g.rig.shake(0.7);
      g.hud.blackFlash();
      for (let i = 0; i < 6; i++) {
        const end = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.3) * 3, (Math.random() - 0.5) * 4));
        g.bolts.spawn(c, end, { color: 0xff1030, width: 0.07, detail: 5, life: 0.35, intensity: 2.5, jag: 0.3 });
        g.bolts.spawn(c, end, { color: 0x100008, width: 0.12, detail: 4, life: 0.3, intensity: 1, jag: 0.3 });
      }
      g.particles.emit(BLACK_FLASH, c, 60, { spread: Math.PI, speed: [3, 12] });
      g.particles.emit(CURSED, c, 40, { spread: Math.PI, speed: [2, 8], sizeMul: 1.5 });
      g.lights.add(c, 0xff2040, 50, 12);
      g.damageNumbers.spawn(c.clone().setY(c.y + 1.4), 0, '#ff3040', true, 'BLACK FLASH!');
      audio.explosion(c, 0.6);
      audio.crackle(c, 1);
    }
  }

  update(dt: number) {
    super.update(dt);
    if (this.zone > 0) {
      this.zone -= dt;
      const g = this.game;
      if (g.rig.mode === 'first' && Math.random() < dt * 20) {
        g.particles.emit(BLACK_FLASH, handPos(g, Math.random() < 0.5 ? 'left' : 'right', TMP), 1, { spread: Math.PI, speed: [0.3, 1] });
      }
    }
    this.meter = this.zone > 0 ? this.zone / 10 : undefined;
  }
}

/** G — Assassinate: vanish, reappear behind a target in sight and strike a killing blow. */
export class Assassinate extends Ability {
  readonly name = 'Assassinate';
  readonly description = 'Vanish into shadow and reappear behind a target you can see (up to 20 m), striking instantly. Devastating on unaware targets.';
  icon = ICONS.dagger;
  cost = 28;
  cooldown = 2.5;

  protected start() {
    const g = this.game;
    const target = findTarget(g, 20, 0.35);
    if (!target) {
      g.toasts.show('No target in sight');
      return false;
    }
    const c = target.center(new THREE.Vector3());
    const facing = target.facing?.() ?? c.clone().sub(g.player.curPos).setY(0).normalize().negate();
    const behind = c.clone().addScaledVector(facing, -1.3);
    behind.y = c.y - 0.5;
    const spot = g.player.findFreeSpot(behind, 2.5) ?? behind;
    const from = g.player.curPos.clone();
    g.particles.emit(FX.shadow, from, 20, { spread: Math.PI, speed: [1, 3], jitter: 0.4 });
    g.player.teleport(spot);
    // Face the target.
    const d = c.clone().sub(g.camera.position);
    g.rig.setLook(Math.atan2(-d.x, -d.z), Math.max(-0.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
    g.particles.emit(FX.shadow, g.player.curPos, 20, { spread: Math.PI, speed: [1, 3], jitter: 0.4 });
    audio.whoosh(from, 0.8, 0.6);
    const res = strike(g, {
      origin: g.player.curPos.clone().setY(g.player.curPos.y + 0.4),
      dir: c.clone().sub(g.player.curPos).normalize(),
      range: 3,
      arc: 0.9,
      damage: 70,
      backstab: 3,
      knockback: 6,
      element: 'shadow',
      color: 0x9b7bff,
      fx: CURSED,
      heavy: 1,
      maxTargets: 1,
    });
    if (res.backstab) {
      g.rig.addFlash(0.15);
      audio.tone({ volume: 0.3, freq: 90, freqEnd: 40, decay: 0.5, type: 'sawtooth' });
    }
    pose(g, 'rest', 'cast');
    g.hands.punch('right', 0.55);
    setTimeout(() => pose(g, 'rest', 'rest'), 250);
    return true;
  }
}

const TMP = new THREE.Vector3();
