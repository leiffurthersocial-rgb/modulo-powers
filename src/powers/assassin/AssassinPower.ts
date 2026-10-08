import * as THREE from 'three';
import { audio, type LoopHandle } from '../../core/Audio';
import { Avatar } from '../../player/Avatar';
import { FX, type ParticlePreset } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { Ability } from '../Ability';
import { findTarget, strike } from '../combat';
import { aim, handPos, pose } from '../common';
import { strike as lightningStrike } from '../lightning/LightningPower';
import { MeleeAbility } from '../MeleeAbility';
import { Power } from '../Power';

const STEEL = 0xb8c6ff;
const BLOOD = 0xe0263a;

const SLASH: ParticlePreset = {
  blend: 'add',
  life: [0.08, 0.2],
  size: [0.06, 0.12],
  sizeEnd: 0.2,
  color0: 0xffffff,
  color1: 0xff3040,
  alpha: 1,
  fadeIn: 0.02,
  drag: 3,
  shape: 2,
  intensity: 3,
};

// -----------------------------------------------------------------------------
// Z — Claw Strike: assassin's hand-claw lunges. Devastating from behind.
// -----------------------------------------------------------------------------
class ClawStrike extends MeleeAbility {
  readonly name = 'Claw Strike';
  readonly description = 'Your hand becomes a blade: lightning-fast lunging slashes. From behind an unaware target it is a ×4 assassination.';
  icon = ICONS.claw;
  cost = 7;
  cooldown = 0.2;
  lungeRange = 9;
  lungeSpeed = 40;

  protected hit(step: number) {
    const g = this.game;
    const res = strike(g, {
      range: 2.4,
      damage: step % 3 === 2 ? 38 : 26,
      knockback: 4,
      lift: 1,
      color: BLOOD,
      fx: SLASH,
      critChance: 0.22,
      critMul: 2,
      backstab: 4,
      heavy: 0.4,
      hitstop: 0.035,
    });
    // Three claw streaks across whatever we hit (or the air in front).
    const c = res.hits[0]?.center(new THREE.Vector3()) ?? g.camera.position.clone().addScaledVector(g.rig.aimDirection(TMP), 2);
    const right = g.rig.right;
    const tilt = step % 2 ? 1 : -1;
    for (let i = -1; i <= 1; i++) {
      const a = c.clone().addScaledVector(right, -0.7).add(TMP.set(0, 0.5 * tilt + i * 0.18, 0));
      const b = c.clone().addScaledVector(right, 0.7).add(TMP.set(0, -0.5 * tilt + i * 0.18, 0));
      g.bolts.spawn(a, b, { color: res.hits.length ? BLOOD : STEEL, width: 0.025, jag: 0.03, detail: 2, life: 0.16, intensity: 1.8, forkChance: 0 });
    }
    audio.noiseBurst({ volume: 0.5, decay: 0.09, filter: 'highpass', freq: 4500, freqEnd: 2000 });
    g.hands.glow(BLOOD, 0.4);
  }
}

// -----------------------------------------------------------------------------
// X — Rhythm Echo: walk in a rhythm that leaves afterimages; enemies chase ghosts.
// -----------------------------------------------------------------------------
interface Echo {
  av: Avatar;
  angle: number;
  t: number;
}

class RhythmEcho extends Ability {
  readonly name = 'Rhythm Echo';
  readonly description = 'Move with an assassin\'s rhythm: five afterimages surround you and draw enemy attention while you vanish for 3 s.';
  icon = ICONS.echo;
  cost = 24;
  cooldown = 6;
  private echoes: Echo[] = [];
  private center = new THREE.Vector3();
  private hide = 0;

  protected start() {
    const g = this.game;
    this.clear();
    this.center.copy(g.player.feet(TMP));
    for (let i = 0; i < 5; i++) {
      const av = new Avatar({ suit: 0x2a3550, skin: 0xd8c0b0, accent: STEEL });
      av.setOpacity(0.55);
      g.scene.add(av.root);
      this.echoes.push({ av, angle: (i / 5) * Math.PI * 2, t: 0 });
      g.stealth.addDecoy(this.center.clone(), 4);
    }
    this.hide = 3;
    g.stealth.setInvisible('echo', true);
    g.stealth.noise(this.center, 14);
    audio.whoosh(this.center, 0.7, 1.5);
    for (let i = 0; i < 5; i++) audio.footstep({ x: this.center.x, y: this.center.y, z: this.center.z }, 'stone', 0.5);
    return true;
  }

  update(dt: number) {
    const g = this.game;
    if (this.hide > 0) {
      this.hide -= dt;
      g.avatar.setOpacity(0.08);
      g.hands.setOpacity(0.15);
      if (this.hide <= 0) {
        g.stealth.setInvisible('echo', false);
        g.avatar.setOpacity(1);
        g.hands.setOpacity(1);
      }
    }
    if (dt <= 0) return;
    let i = 0;
    for (const e of this.echoes) {
      e.t += dt;
      e.angle += dt * 2.2;
      const r = 2.5 + Math.sin(e.t * 3 + i) * 0.6;
      const p = TMP.set(this.center.x + Math.cos(e.angle) * r, 0, this.center.z + Math.sin(e.angle) * r);
      p.y = g.world.heightAt(p.x, p.z);
      e.av.update(dt, p, -e.angle, 4, true, 0);
      e.av.setOpacity(Math.max(0, 0.55 * (1 - Math.max(0, e.t - 3.5) / 0.5)));
      const d = g.stealth.decoys[i];
      if (d) d.pos.copy(p);
      i++;
    }
    if (this.echoes.length && this.echoes[0].t > 4) this.clear();
  }

  private clear() {
    for (const e of this.echoes) {
      e.av.root.removeFromParent();
      e.av.suit.dispose();
      e.av.skin.dispose();
      e.av.accent.dispose();
    }
    this.echoes.length = 0;
  }

  reset() {
    super.reset();
    this.clear();
    this.hide = 0;
    this.game.stealth.setInvisible('echo', false);
  }
}

// -----------------------------------------------------------------------------
// C — Flash Step: blur straight through enemies, cutting everything you pass.
// -----------------------------------------------------------------------------
class FlashStep extends Ability {
  readonly name = 'Flash Step';
  readonly description = 'Blur 12 m forward straight through enemies, slashing everything you pass and leaving afterimages.';
  icon = ICONS.flash;
  cost = 14;
  cooldown = 0.8;
  private t = 0;
  private hit = new Set<Entity>();
  private last = new THREE.Vector3();

  protected start() {
    const g = this.game;
    const dir = g.rig.aimDirection(TMP).setY(0).normalize();
    g.player.ghostNPC = true;
    g.combat.lunge(dir, 75, 0.16);
    this.t = 0.18;
    this.hit.clear();
    this.last.copy(g.player.curPos);
    g.rig.fovPunch(14);
    audio.noiseBurst({ volume: 0.6, decay: 0.25, filter: 'bandpass', freq: 3000, freqEnd: 600, q: 2 });
    return true;
  }

  fixedUpdate(dt: number) {
    if (this.t <= 0) return;
    const g = this.game;
    this.t -= dt;
    for (const e of g.entities.nearby(g.player.curPos, 1.8, NEAR)) {
      if (!e.onDamage || this.hit.has(e)) continue;
      this.hit.add(e);
      const c = e.center(new THREE.Vector3());
      const dmg = 32 * g.damageBoost;
      g.reactions.damage(e, dmg, 'impact');
      e.stun = Math.max(e.stun, 1);
      g.damageNumbers.spawn(c.clone().setY(c.y + 0.8), dmg, '#e0263a');
      g.damageNumbers.hit();
      g.particles.emit(SLASH, c, 25, { spread: Math.PI, speed: [2, 6] });
      g.bolts.spawn(c.clone().add(TMP.set(-0.6, 0.6, 0)), c.clone().add(TMP.set(0.6, -0.5, 0)), { color: BLOOD, width: 0.03, jag: 0.02, detail: 2, life: 0.25, intensity: 2 });
    }
    if (this.t <= 0) {
      g.player.ghostNPC = false;
      if (this.hit.size) {
        audio.noiseBurst({ volume: 0.7, decay: 0.15, filter: 'highpass', freq: 3000, delay: 0.05 });
        g.rig.shake(0.25);
      }
    }
  }

  update(dt: number) {
    if (this.t <= 0 || dt <= 0) return;
    const g = this.game;
    const p = g.player.renderPos;
    g.particles.emit(FX.shadowGlow, p, dt * 150, { spread: Math.PI, speed: [0.2, 1], jitter: 0.4, color0: 0xdde6ff, color1: 0x445588 });
    if (p.distanceTo(this.last) > 1.5) {
      g.bolts.spawn(this.last, p, { color: STEEL, width: 0.02, detail: 3, life: 0.2, intensity: 1 });
      this.last.copy(p);
    }
  }
}

// -----------------------------------------------------------------------------
// B — Yo-yo: heavy steel yo-yo that flies out and back, hitting on both passes.
// -----------------------------------------------------------------------------
class Yoyo extends Ability {
  readonly name = 'Yo-yo';
  readonly description = 'Fling a 50 kg steel yo-yo: it smashes through enemies on the way out and again on the way back.';
  icon = ICONS.yoyo;
  cost = 10;
  cooldown = 0.7;
  private mesh!: THREE.Group;
  private line!: THREE.Line;
  private state: 'idle' | 'out' | 'back' = 'idle';
  private pos = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private dist = 0;
  private hitOut = new Set<Entity>();
  private hitBack = new Set<Entity>();
  private spin = 0;
  private whirr: LoopHandle | null = null;

  protected init() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8ccd8, metalness: 0.95, roughness: 0.2 });
    this.mesh = new THREE.Group();
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 20).rotateX(Math.PI / 2), mat);
      d.position.z = s * 0.05;
      d.castShadow = true;
      this.mesh.add(d);
    }
    this.mesh.visible = false;
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.6 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.game.scene.add(this.mesh, this.line);
  }

  protected start() {
    if (this.state !== 'idle') return false;
    const g = this.game;
    this.state = 'out';
    this.dist = 0;
    this.hitOut.clear();
    this.hitBack.clear();
    handPos(g, 'right', this.pos);
    this.dir.copy(aim(g, 30).point).sub(this.pos).normalize();
    this.mesh.visible = this.line.visible = true;
    g.hands.punch('right', 0.5);
    audio.whoosh(this.pos, 0.6, 1.2);
    this.whirr = audio.loop({ freq: 900, filter: 'bandpass', q: 3, volume: 0.6, lfo: { rate: 30, depth: 0.4 } });
    this.whirr.setLevel(0.5);
    return true;
  }

  fixedUpdate(dt: number) {
    if (this.state === 'idle') return;
    const g = this.game;
    const hand = handPos(g, 'right', TMP);
    if (this.state === 'out') {
      const step = 34 * dt;
      const hit = g.physics.raycast(this.pos, this.dir, step + 0.2, { exclude: g.player.collider });
      if (hit && !g.entities.fromCollider(hit.collider)?.onDamage) {
        this.state = 'back';
        audio.impact(this.pos, 0.8, 'metal');
        g.particles.emit(FX.spark, hit.point, 15, { spread: 1, speed: [2, 6] });
        const ent = g.entities.fromCollider(hit.collider);
        if (ent?.isDynamic) ent.applyImpulse(this.dir.x * 300, 120, this.dir.z * 300);
      } else {
        this.pos.addScaledVector(this.dir, step);
        this.dist += step;
        if (this.dist > 18) this.state = 'back';
      }
      this.hitAround(this.hitOut);
    } else {
      const to = TMP2.copy(hand).sub(this.pos);
      const d = to.length();
      if (d < 0.8) {
        this.state = 'idle';
        this.mesh.visible = this.line.visible = false;
        this.whirr?.stop(0.1);
        this.whirr = null;
        audio.impact(hand, 0.3, 'metal');
        return;
      }
      this.pos.addScaledVector(to.divideScalar(d), Math.min(d, 40 * dt));
      this.hitAround(this.hitBack);
    }
  }

  private hitAround(set: Set<Entity>) {
    const g = this.game;
    for (const e of g.entities.nearby(this.pos, 1.1, NEAR)) {
      if (set.has(e) || !(e.onDamage || e.isDynamic)) continue;
      set.add(e);
      const dmg = 26 * g.damageBoost;
      g.reactions.damage(e, dmg, 'impact');
      e.applyImpulse(this.dir.x * (e.isDynamic ? Math.min(e.mass, 200) * 9 : 700), e.isDynamic ? Math.min(e.mass, 200) * 3 : 200, this.dir.z * (e.isDynamic ? Math.min(e.mass, 200) * 9 : 700));
      if (e.onDamage) {
        g.damageNumbers.spawn(e.center(new THREE.Vector3()).setY(this.pos.y + 0.8), dmg, '#b8c6ff');
        g.damageNumbers.hit();
      }
      audio.impact(this.pos, 1, 'metal');
      g.particles.emit(FX.spark, this.pos, 12, { spread: Math.PI, speed: [2, 6] });
      g.rig.shake(0.1);
    }
  }

  update(dt: number) {
    if (this.state === 'idle') return;
    const g = this.game;
    this.spin += dt * 40;
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(TMP.copy(this.pos).add(this.dir));
    this.mesh.rotateZ(this.spin);
    const hand = handPos(g, 'right', TMP);
    const arr = (this.line.geometry.attributes.position as THREE.BufferAttribute);
    arr.setXYZ(0, hand.x, hand.y, hand.z);
    arr.setXYZ(1, this.pos.x, this.pos.y, this.pos.z);
    arr.needsUpdate = true;
    this.whirr?.setPosition(this.pos.x, this.pos.y, this.pos.z);
  }

  reset() {
    super.reset();
    this.state = 'idle';
    this.mesh.visible = this.line.visible = false;
    this.whirr?.stop(0.1);
    this.whirr = null;
  }
}

// -----------------------------------------------------------------------------
// V — Thunderbolt: leap at a target and call lightning down onto it.
// -----------------------------------------------------------------------------
class Thunderbolt extends Ability {
  readonly name = 'Thunderbolt';
  readonly description = 'Leap at a target in a blur and bring a bolt of lightning down on it from the sky — heavy damage and a long stun.';
  icon = ICONS.thunder;
  cost = 26;
  cooldown = 2.5;

  protected start() {
    const g = this.game;
    const target = findTarget(g, 28, 0.4);
    const fire = (p: THREE.Vector3, t: Entity | null) => {
      const from = p.clone().add(TMP.set((Math.random() - 0.5) * 4, 35, (Math.random() - 0.5) * 4));
      lightningStrike(g, from, p, 1, UP);
      if (t && !t.dead) {
        const dmg = 70 * g.damageBoost;
        g.reactions.damage(t, dmg, 'lightning');
        t.stun = Math.max(t.stun, 2.5);
        g.damageNumbers.spawn(p.clone().setY(p.y + 1.2), dmg, '#7fd4ff', true);
        g.damageNumbers.hit();
      }
      pose(g, 'raise', 'raise');
      setTimeout(() => pose(g, 'rest', 'rest'), 300);
    };
    if (target) {
      const c = target.center(new THREE.Vector3());
      const dir = c.clone().sub(g.player.curPos);
      if (dir.length() > 4) g.combat.lunge(dir, 45, 0.5, target, 3.5, () => fire(target.center(new THREE.Vector3()), target));
      else fire(c, target);
    } else {
      const a = aim(g, 60);
      fire(a.point, null);
    }
    return true;
  }
}

// -----------------------------------------------------------------------------
// G — Assassin Mode (toggle): the cold eyes. Faster, silent, nearly unseen, crits.
// -----------------------------------------------------------------------------
class AssassinMode extends Ability {
  readonly name = 'Assassin Mode';
  readonly description = 'Cold assassin\'s focus: 35% faster, silent footsteps, very hard to spot, and +25% damage with more crits.';
  icon = ICONS.mask;
  mode = 'toggle' as const;
  cost = 4;
  cooldown = 0.6;
  minEnergy = 10;

  protected start() {
    const g = this.game;
    g.player.setModifier('assassin', 1.35, 1.2);
    g.silent = true;
    g.stealth.stealthMul *= 0.35;
    g.damageBoost *= 1.25;
    g.hud.setTint('rgba(120,0,20,0.18)');
    audio.tone({ volume: 0.2, freq: 110, freqEnd: 55, decay: 0.8, type: 'sawtooth' });
    return true;
  }

  protected end() {
    const g = this.game;
    g.player.clearModifier('assassin');
    g.silent = false;
    g.stealth.stealthMul /= 0.35;
    g.damageBoost /= 1.25;
    g.hud.setTint('');
  }
}

/**
 * ASSASSIN (key 7): a Zoldyck-style killer — claw strikes, afterimages,
 * flash steps, a steel yo-yo and lightning-fast execution.
 */
export class AssassinPower extends Power {
  readonly id = 'assassin';
  readonly name = 'Assassin';
  readonly color = '#b8c6ff';
  readonly icon = ICONS.assassin;
  readonly abilities = [new ClawStrike(), new RhythmEcho(), new FlashStep(), new Yoyo(), new Thunderbolt(), new AssassinMode()];
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const NEAR: Entity[] = [];
