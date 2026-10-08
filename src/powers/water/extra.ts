import * as THREE from 'three';
import { audio } from '../../core/Audio';
import { FX } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import { iceMaterial } from '../../world/props/basic';
import { Ability } from '../Ability';
import { strike } from '../combat';
import { aim, bothHands, handPos, pose } from '../common';

const ICE = 0x9fdcff;

/** V — Ice Spears: a fan of three razor ice spears that pierce, freeze and pin targets. */
export class IceSpears extends Ability {
  readonly name = 'Ice Spears';
  readonly description = 'Hurl a fan of three razor ice spears. Each one hurts, freezes and knocks back what it hits.';
  icon = ICONS.spear;
  cost = 14;
  cooldown = 0.45;
  private geo = new THREE.ConeGeometry(0.09, 1.1, 6).rotateX(-Math.PI / 2);
  private pool: THREE.Mesh[] = [];

  private mesh(): THREE.Mesh {
    const m = this.pool.pop() ?? new THREE.Mesh(this.geo, iceMaterial());
    m.castShadow = true;
    this.game.scene.add(m);
    return m;
  }

  protected start() {
    const g = this.game;
    const target = aim(g, 120, { water: false });
    const from = bothHands(g, new THREE.Vector3());
    const base = target.point.clone().sub(from).normalize();
    const side = new THREE.Vector3().crossVectors(base, UP).normalize();
    for (let i = -1; i <= 1; i++) {
      const dir = base.clone().addScaledVector(side, i * 0.06).normalize();
      const m = this.mesh();
      m.position.copy(from);
      m.lookAt(from.clone().add(dir));
      g.projectiles.fire({
        pos: from.clone().addScaledVector(side, i * 0.15),
        vel: dir.multiplyScalar(48),
        gravity: 2,
        radius: 0.12,
        life: 2.5,
        hitsWater: true,
        onUpdate: (p, dt) => {
          m.position.copy(p.pos);
          m.lookAt(TMP.copy(p.pos).add(p.vel));
          g.particles.emit(FX.frost, p.pos, dt * 40, { spread: Math.PI, speed: [0, 0.5], sizeMul: 0.6 });
        },
        onHit: (p, hit) => {
          m.removeFromParent();
          this.pool.push(m);
          if (!hit) return;
          g.particles.emit(FX.frost, p.pos, 25, { spread: Math.PI, speed: [1, 4] });
          audio.tone({ pos: p.pos, volume: 0.15, freq: 2400 + Math.random() * 800, decay: 0.15 });
          if (hit.water) {
            g.reactions.applySurfaces('cold', p.pos, 1.5, 1);
            return;
          }
          const e = hit.entity;
          if (e) {
            g.reactions.damage(e, 22, 'cold');
            g.reactions.apply(e, 'cold', 0.8, p.pos);
            e.applyImpulse(p.vel.x * 4, 60, p.vel.z * 4);
            if (e.onDamage) {
              g.damageNumbers.spawn(e.center(new THREE.Vector3()).setY(p.pos.y + 0.6), 22, '#9fdcff');
              g.damageNumbers.hit();
            }
          } else if (hit.normal.y > 0.4) g.decals.add('frost', hit.point, hit.normal, 1, 25, 0.8);
        },
      });
    }
    pose(g, 'push', 'push');
    g.hands.kick('both', 0.12);
    g.hands.glow(ICE, 0.7);
    audio.whoosh(from, 0.8, 1.6);
    audio.noiseBurst({ pos: from, volume: 0.3, decay: 0.15, filter: 'highpass', freq: 4000 });
    setTimeout(() => pose(g, 'rest', 'rest'), 200);
    return true;
  }
}

/** G — Water Whip: a long lash that sweeps a wide arc, soaks targets and yanks them towards you. */
export class WaterWhip extends Ability {
  readonly name = 'Water Whip';
  readonly description = 'Crack a long whip of water across a wide arc: hits everything in front of you, soaks them (now they conduct!) and yanks them closer.';
  icon = ICONS.whip;
  cost = 12;
  cooldown = 0.55;
  private flip = 1;

  protected start() {
    const g = this.game;
    this.flip *= -1;
    const res = strike(g, {
      range: 6.5,
      arc: 1.1,
      damage: 24,
      knockback: -7,
      lift: 3,
      element: 'water',
      amount: 1,
      color: 0x3fa9f5,
      fx: FX.splash,
      maxTargets: 6,
      heavy: 0.5,
    });
    // Draw the lash as a sweeping arc of water.
    const origin = handPos(g, 'right', new THREE.Vector3());
    const fwd = g.rig.aimDirection(new THREE.Vector3());
    const right = g.rig.right;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const a = (t - 0.5) * 2.0 * this.flip;
      const r = 1 + t * 5.5;
      const p = origin.clone().addScaledVector(fwd, Math.cos(a) * r).addScaledVector(right, Math.sin(a) * r);
      p.y += Math.sin(t * Math.PI) * 0.6;
      g.particles.emit(FX.splash, p, 4, { spread: Math.PI, speed: [0.5, 2], sizeMul: 0.7 });
      g.particles.emit(FX.droplet, p, 3, { spread: Math.PI, speed: [1, 3] });
    }
    audio.noiseBurst({ pos: origin, volume: 0.6, decay: 0.12, filter: 'highpass', freq: 2500 });
    audio.noiseBurst({ pos: origin, volume: 0.4, decay: 0.35, filter: 'bandpass', freq: 800, freqEnd: 300 });
    pose(g, 'rest', 'push');
    g.hands.punch('right', 0.4);
    setTimeout(() => pose(g, 'rest', 'rest'), 220);
    void res;
    return true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
