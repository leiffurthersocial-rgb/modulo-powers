import * as THREE from 'three';
import { audio } from '../../core/Audio';
import { FX } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { texturedMaterial } from '../../world/props/assets';
import { rockGeometry } from '../../world/props/basic';
import { Ability } from '../Ability';
import { strike } from '../combat';
import { handPos } from '../common';
import { MeleeAbility } from '../MeleeAbility';

const EARTH = 0xc08a4a;

/** V — Rock Fist: a giant stone gauntlet forms around your fist and smashes forward. */
export class RockFist extends MeleeAbility {
  readonly name = 'Rock Fist';
  readonly description = 'A boulder-sized stone fist forms over your hand and smashes forward: huge knockback, breaks walls and ice.';
  icon = ICONS.rockfist;
  cost = 14;
  cooldown = 0.65;
  lungeRange = 5;
  private fist: THREE.Mesh | null = null;
  private fistT = 0;

  protected init() {
    this.fist = new THREE.Mesh(rockGeometry(0.55, 3), texturedMaterial('stone', { color: 0xa0846a, key: 'rockFist' }));
    this.fist.castShadow = true;
    this.fist.visible = false;
    this.game.scene.add(this.fist);
  }

  protected hit(step: number) {
    const g = this.game;
    const dir = g.rig.aimDirection(new THREE.Vector3());
    const res = strike(g, {
      range: 3.4,
      arc: 0.7,
      damage: 42,
      knockback: 14,
      lift: 4,
      element: 'earth',
      amount: 1,
      color: EARTH,
      fx: FX.debris,
      heavy: 1,
      critChance: 0.15,
      maxTargets: 3,
    });
    for (const e of res.hits) if (e.mat.brittle || e.frozen > 0.5) g.reactions.damage(e, 400, 'earth');
    this.fistT = 0.35;
    const p = handPos(g, step % 2 ? 'left' : 'right', new THREE.Vector3()).addScaledVector(dir, 0.8);
    g.particles.emit(FX.dust, p, 12, { dir, spread: 0.7, speed: [2, 6] });
    g.particles.emit(FX.debris, p, 15, { dir, spread: 0.8, speed: [3, 8] });
    audio.impact(p, 1, 'stone');
    audio.rumble(p, 0.4, 0.4);
  }

  update(dt: number) {
    super.update(dt);
    const f = this.fist!;
    if (this.fistT > 0) {
      this.fistT -= dt;
      const g = this.game;
      const dir = g.rig.aimDirection(TMP);
      const k = 1 - Math.max(0, this.fistT) / 0.35;
      f.visible = true;
      f.position.copy(g.camera.position).addScaledVector(dir, 0.9 + Math.sin(k * Math.PI) * 1.6).addScaledVector(g.rig.right, 0.25);
      f.position.y -= 0.25;
      f.scale.setScalar(0.6 + Math.sin(k * Math.PI) * 0.6);
      f.rotation.set(k * 2, k * 3, 0);
    } else f.visible = false;
  }
}

interface Spike {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  t: number;
  hit: boolean;
}

/** G — Stone Spikes: a line of stone spikes erupts from the ground towards the aim, launching enemies. */
export class StoneSpikes extends Ability {
  readonly name = 'Stone Spikes';
  readonly description = 'Stamp the ground: a line of stone spikes rips up towards where you aim, impaling and launching everything in its path.';
  icon = ICONS.spikes;
  cost = 26;
  cooldown = 2.5;
  private spikes: Spike[] = [];
  private queue: { at: number; pos: THREE.Vector3 }[] = [];
  private clock = 0;
  private geo = new THREE.ConeGeometry(0.55, 2.4, 7);
  private mat = texturedMaterial('stone', { color: 0x9a8070, key: 'spike' });
  private near: Entity[] = [];

  protected start() {
    const g = this.game;
    const dir = g.rig.aimDirection(new THREE.Vector3()).setY(0).normalize();
    const start = g.player.feet(new THREE.Vector3());
    this.clock = 0;
    for (let i = 1; i <= 10; i++) {
      const p = start.clone().addScaledVector(dir, 1.2 + i * 1.5);
      p.x += (Math.random() - 0.5) * 0.5;
      p.z += (Math.random() - 0.5) * 0.5;
      p.y = g.world.heightAt(p.x, p.z);
      // Rise from props/platforms too.
      const hit = g.physics.raycast(TMP.set(p.x, p.y + 3, p.z), DOWN, 6, { exclude: g.player.collider });
      if (hit) p.y = hit.point.y;
      this.queue.push({ at: i * 0.05, pos: p });
    }
    g.hands.kick('both', 0.1);
    g.rig.shake(0.2);
    audio.rumble(start, 0.8, 1.2);
    return true;
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    this.clock += dt;
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const q = this.queue.shift()!;
      const m = new THREE.Mesh(this.geo, this.mat);
      m.castShadow = true;
      m.position.copy(q.pos);
      m.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6, (Math.random() - 0.5) * 0.4);
      g.scene.add(m);
      this.spikes.push({ mesh: m, base: q.pos, t: 0, hit: false });
      g.particles.emit(FX.debris, q.pos, 10, { spread: 0.8, speed: [3, 7] });
      g.particles.emit(FX.dust, q.pos, 4, { spread: 1, speed: [1, 3] });
      g.decals.add('crack', q.pos, UP, 1.8, 20);
      audio.impact(q.pos, 0.8, 'stone');
    }
    for (const s of this.spikes) {
      if (s.hit || s.t > 0.25) continue;
      s.hit = true;
      for (const e of g.entities.nearby(s.base, 1.4, this.near)) {
        g.reactions.damage(e, 34, 'earth');
        g.reactions.apply(e, 'earth', 0.6, s.base);
        e.applyImpulse(0, e.isDynamic ? Math.min(e.mass, 300) * 11 : 900, 0);
        if (e.onDamage) {
          g.damageNumbers.spawn(e.center(new THREE.Vector3()).setY(s.base.y + 2), 34, '#c08a4a');
          g.damageNumbers.hit();
        }
      }
    }
  }

  update(dt: number) {
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t += dt;
      const rise = Math.min(1, s.t / 0.12);
      const sink = s.t > 2.2 ? Math.min(1, (s.t - 2.2) / 0.6) : 0;
      s.mesh.position.y = s.base.y - 1.3 + rise * 2.2 - sink * 2.4;
      if (sink >= 1) {
        s.mesh.removeFromParent();
        this.spikes.splice(i, 1);
      }
    }
  }

  reset() {
    super.reset();
    for (const s of this.spikes) s.mesh.removeFromParent();
    this.spikes.length = 0;
    this.queue.length = 0;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const TMP = new THREE.Vector3();
