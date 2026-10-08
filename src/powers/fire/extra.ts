import * as THREE from 'three';
import { audio } from '../../core/Audio';
import { FX } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import { Ability } from '../Ability';
import { strike } from '../combat';
import { aim, handPos, pose } from '../common';
import { explosion } from '../effects';
import { MeleeAbility } from '../MeleeAbility';

const ORANGE = 0xff7a2f;

/** V — Blazing Fist: flaming punch combo; every third hit is an explosive uppercut. */
export class BlazingFist extends MeleeAbility {
  readonly name = 'Blazing Fist';
  readonly description = 'Flaming punch combo. Every third hit is an explosive uppercut that launches enemies.';
  icon = ICONS.fist;
  cost = 6;
  cooldown = 0.2;

  protected hit(step: number) {
    const g = this.game;
    const finisher = step % 3 === 2;
    const side = step % 2 ? 'left' : 'right';
    const hand = handPos(g, side, new THREE.Vector3());
    const res = strike(g, {
      range: finisher ? 2.8 : 2.3,
      damage: finisher ? 45 : 20,
      knockback: finisher ? 4 : 5,
      lift: finisher ? 11 : 1.5,
      element: 'fire',
      amount: 0.7,
      color: ORANGE,
      fx: FX.flame,
      heavy: finisher ? 1 : 0.45,
      critChance: 0.1,
    });
    const dir = g.rig.aimDirection(new THREE.Vector3());
    g.particles.emit(FX.flame, hand, 18, { dir, spread: 0.4, speed: [4, 9], sizeMul: 0.8 });
    g.particles.emit(FX.ember, hand, 10, { dir, spread: 0.6, speed: [3, 7] });
    g.lights.add(hand, ORANGE, 10, 6);
    g.hands.glow(ORANGE, 0.9);
    if (finisher) {
      const at = res.hits[0]?.center(new THREE.Vector3()) ?? hand.clone().addScaledVector(dir, 1.6);
      explosion(g, at, { radius: 2.6, impulse: 250, element: 'fire', amount: 1.2, damage: 15, decal: 'scorch' });
      g.hands.punch(side, 0.6);
    } else {
      audio.ignite(hand, 0.3);
    }
  }
}

/** G — Meteor Dive: leap high, then crash down on the aim point in an explosion of fire. */
export class MeteorDive extends Ability {
  readonly name = 'Meteor Dive';
  readonly description = 'Leap into the air, then crash down where you aim like a meteor — a big fiery shockwave. Use it in mid-air to dive straight away.';
  icon = ICONS.meteor;
  cost = 28;
  cooldown = 3.5;
  private phase: 'none' | 'rise' | 'dive' = 'none';
  private t = 0;
  private target = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  protected start() {
    const g = this.game;
    const pl = g.player;
    if (pl.grounded) {
      const fwd = g.rig.aimDirection(this.tmp).setY(0).normalize();
      pl.thrust(new THREE.Vector3(fwd.x * 6, 15, fwd.z * 6));
      this.phase = 'rise';
      audio.explosion(pl.feet(this.tmp), 0.4);
      g.particles.emit(FX.flame, pl.feet(this.tmp), 30, { dir: DOWN, spread: 0.8, speed: [4, 9] });
    } else {
      this.beginDive();
    }
    this.t = 0;
    pose(g, 'raise', 'raise');
    return true;
  }

  private beginDive() {
    const g = this.game;
    this.phase = 'dive';
    this.t = 0;
    const a = aim(g, 60);
    this.target.copy(a.point);
    if (!a.hit) this.target.y = g.world.heightAt(this.target.x, this.target.z);
    pose(g, 'down', 'down');
    g.rig.fovPunch(12);
    audio.whoosh(g.player.curPos, 1, 0.5);
  }

  fixedUpdate(dt: number) {
    if (this.phase === 'none') return;
    const g = this.game;
    const pl = g.player;
    this.t += dt;
    if (this.phase === 'rise') {
      if (pl.velocity.y < 2 || this.t > 0.7) this.beginDive();
      return;
    }
    const to = this.tmp.copy(this.target).sub(pl.feet(new THREE.Vector3()));
    const dir = to.normalize();
    if (dir.y > -0.3) dir.y = -0.6;
    dir.normalize();
    pl.velocity.copy(dir).multiplyScalar(38);
    if (pl.grounded || this.t > 2) this.impact();
  }

  private impact() {
    const g = this.game;
    this.phase = 'none';
    const f = g.player.feet(new THREE.Vector3());
    explosion(g, f, { radius: 7, impulse: 900, element: 'fire', amount: 2.5, damage: 70, decal: 'scorch' });
    // A ring of fire around the crater.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = f.clone().add(new THREE.Vector3(Math.cos(a) * 4, 0.3, Math.sin(a) * 4));
      g.particles.emit(FX.flame, p, 8, { spread: 0.4, speed: [2, 6], sizeMul: 1.3 });
      g.reactions.applySurfaces('fire', p, 1.5, 1);
    }
    g.rig.shake(0.8);
    pose(g, 'rest', 'rest');
  }

  update(dt: number) {
    if (this.phase === 'dive' && dt > 0) {
      const g = this.game;
      const p = g.player.renderPos;
      g.particles.emit(FX.flame, p, dt * 200, { spread: Math.PI, speed: [0.5, 2], jitter: 0.5, sizeMul: 1.4 });
      g.particles.emit(FX.smoke, p, dt * 30, { spread: 1, speed: [0.5, 1.5], jitter: 0.5 });
      g.lights.add(p, ORANGE, 25, 12);
      g.hands.glow(ORANGE, 1);
    }
  }

  reset() {
    super.reset();
    this.phase = 'none';
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
