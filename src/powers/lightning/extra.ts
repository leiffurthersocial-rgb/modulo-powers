import * as THREE from 'three';
import { audio, type LoopHandle } from '../../core/Audio';
import { FX } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { Ability } from '../Ability';
import { strike as meleeStrike } from '../combat';
import { handPos } from '../common';
import { MeleeAbility } from '../MeleeAbility';

const GLOW = 0x7fd4ff;

/** V — Thunder Palm: lunge + electrified palm strike that stuns and arcs to nearby foes. */
export class ThunderPalm extends MeleeAbility {
  readonly name = 'Thunder Palm';
  readonly description = 'Dash in and slam an electrified palm: heavy stun, and the shock jumps to up to 3 nearby enemies.';
  icon = ICONS.palm;
  cost = 12;
  cooldown = 0.4;

  protected hit(step: number) {
    const g = this.game;
    const hand = handPos(g, step % 2 ? 'left' : 'right', new THREE.Vector3());
    const res = meleeStrike(g, {
      range: 2.4,
      damage: step >= 2 ? 48 : 30,
      knockback: step >= 2 ? 11 : 6,
      lift: step >= 2 ? 5 : 2,
      element: 'lightning',
      amount: 0.6,
      color: GLOW,
      fx: FX.electric,
      heavy: 0.6,
      critChance: 0.12,
    });
    g.particles.emit(FX.electric, hand, 25, { spread: Math.PI, speed: [2, 7] });
    g.lights.add(hand, GLOW, 18, 8);
    audio.crackle(hand, 1);
    for (const e of res.hits) {
      e.stun = Math.max(e.stun, 1.4);
      const c = e.center(new THREE.Vector3());
      g.bolts.spawn(hand, c, { width: 0.05, detail: 5, life: 0.18, intensity: 2 });
      // Chain to nearby living things.
      let n = 0;
      for (const o of g.entities.nearby(c, 7, NEAR)) {
        if (o === e || !o.onDamage || res.hits.includes(o) || n >= 3) continue;
        n++;
        g.electricity.arc(c, o.center(new THREE.Vector3()), 0.9);
        g.reactions.damage(o, 14, 'lightning');
        o.stun = Math.max(o.stun, 0.8);
      }
    }
  }
}

/** G — Godspeed (toggle): Killua-style lightning body. Super speed, triple jump, reflex zaps. */
export class Godspeed extends Ability {
  readonly name = 'Godspeed';
  readonly description = 'Wrap your body in lightning: ~2× speed, triple jump, stronger hits, and reflex bolts that zap enemies who get close.';
  icon = ICONS.speed;
  mode = 'toggle' as const;
  cost = 6;
  cooldown = 0.8;
  minEnergy = 15;
  private loop: LoopHandle | null = null;
  private zap = 0;
  private arc = 0;
  private tmp = new THREE.Vector3();

  protected start() {
    const g = this.game;
    g.player.setModifier('godspeed', 1.95, 1.4);
    g.player.maxAirJumps = 2;
    g.damageBoost *= 1.3;
    g.rig.fovPunch(10);
    audio.crackle(g.player.curPos, 1);
    audio.noiseBurst({ volume: 0.6, decay: 0.5, filter: 'bandpass', freq: 300, freqEnd: 3000, q: 2 });
    this.loop = audio.loop({ freq: 3200, filter: 'bandpass', q: 1.5, volume: 0.35, lfo: { rate: 23, depth: 0.4 } });
    this.loop.setLevel(0.5);
    g.particles.emit(FX.electric, g.player.curPos, 50, { spread: Math.PI, speed: [2, 8], jitter: 0.5 });
    return true;
  }

  protected end() {
    const g = this.game;
    g.player.clearModifier('godspeed');
    g.player.maxAirJumps = 1;
    g.damageBoost /= 1.3;
    this.loop?.stop(0.2);
    this.loop = null;
  }

  protected sustain(dt: number) {
    const g = this.game;
    const p = g.player.renderPos;
    g.hands.glow(GLOW, 0.5);
    g.lights.add(p, GLOW, 5, 6);
    g.particles.emit(FX.electric, p, dt * 40, { spread: Math.PI, speed: [0.5, 2], jitter: 0.6 });
    this.arc -= dt;
    if (this.arc <= 0) {
      this.arc = 0.06 + Math.random() * 0.08;
      const a = this.tmp.copy(p).add(R.set(Math.random() - 0.5, Math.random() * 1.6 - 0.8, Math.random() - 0.5));
      const b = new THREE.Vector3().copy(p).add(R.set(Math.random() - 0.5, Math.random() * 1.6 - 0.8, Math.random() - 0.5));
      g.bolts.spawn(a, b, { width: 0.012, detail: 4, life: 0.07, intensity: 1.5, jag: 0.35 });
    }
    // Speed trail.
    if (g.player.speed > 6) g.particles.emit(FX.electric, g.player.feet(this.tmp), dt * 60, { spread: 0.6, speed: [0.2, 1], jitter: 0.3 });
    // Reflex: zap the closest enemy that gets near.
    this.zap -= dt;
    if (this.zap <= 0) {
      this.zap = 0.55;
      let best: Entity | null = null;
      let bd = 7;
      for (const e of g.entities.nearby(p, 7, NEAR)) {
        if (!e.onDamage || e.type === 'dummy' || e.dead) continue;
        const d = e.center(this.tmp).distanceTo(p);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best) {
        const c = best.center(new THREE.Vector3());
        g.bolts.spawn(p, c, { width: 0.05, detail: 6, life: 0.2, intensity: 2 });
        g.reactions.damage(best, 12, 'lightning');
        best.stun = Math.max(best.stun, 0.6);
        g.damageNumbers.spawn(c.setY(c.y + 0.8), 12, '#7fd4ff');
        audio.crackle(c, 0.7);
      }
    }
  }
}

const R = new THREE.Vector3();
const NEAR: Entity[] = [];
