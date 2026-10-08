import * as THREE from 'three';
import { ALL_GROUPS, G, PHYSICS, groups } from '../config/physics';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import { RAPIER } from '../core/Physics';
import { Avatar } from '../player/Avatar';
import { explosion } from '../powers/effects';
import { FX, type ParticlePreset } from '../systems/Particles';
import { Entity, type PropSpec } from '../world/Entity';

export type FighterKind = 'brute' | 'caster' | 'boss';

interface KindDef {
  hp: number;
  speed: number;
  scale: number;
  suit: number;
  accent: number;
  damage: number;
  reach: number;
}

const KINDS: Record<FighterKind, KindDef> = {
  brute: { hp: 130, speed: 4.6, scale: 1.05, suit: 0x4a2a20, accent: 0xff6a2a, damage: 11, reach: 1.9 },
  caster: { hp: 85, speed: 3.6, scale: 0.95, suit: 0x20284a, accent: 0x5ab4ff, damage: 10, reach: 16 },
  boss: { hp: 1100, speed: 4.2, scale: 1.7, suit: 0x200a12, accent: 0xff2040, damage: 22, reach: 3.0 },
};

const ORB: ParticlePreset = {
  blend: 'add',
  life: [0.2, 0.4],
  size: [0.15, 0.3],
  sizeEnd: 0.2,
  color0: 0xc0e0ff,
  color1: 0x3060ff,
  alpha: 0.9,
  fadeIn: 0.05,
  drag: 3,
  shape: 1,
  intensity: 2.5,
};

interface Orb {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  color: number;
}

const HALF = 0.55;
const RADIUS = 0.33;

/**
 * A hostile fighter (arena enemy). Uses its own character controller, chases
 * the player (or Shadow decoys), attacks in melee or at range, gets knocked
 * back / launched / stunned by powers, and has a health bar overhead.
 */
export class Fighter {
  readonly entity: Entity;
  readonly avatar: Avatar;
  readonly def: KindDef;
  readonly pos = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private renderPos = new THREE.Vector3();
  private kcc: RAPIER.KinematicCharacterController;
  yaw = 0;
  private renderYaw = 0;
  private vy = 0;
  private kb = new THREE.Vector3();
  hp: number;
  dead = false;
  private deadT = 0;
  private attackCd = 1;
  private windup = 0;
  private special = 4;
  private charging = 0;
  private chargeDir = new THREE.Vector3();
  private hpBg: THREE.Sprite;
  private hpFill: THREE.Sprite;
  private hitFlash = 0;
  private grounded = false;
  private speedNow = 0;
  private tmp = new THREE.Vector3();
  private facingV = new THREE.Vector3();
  private strafe = Math.random() < 0.5 ? -1 : 1;
  onDeath: (() => void) | null = null;

  constructor(
    private sys: FighterSystem,
    readonly kind: FighterKind,
    spec: PropSpec,
  ) {
    const g = sys.game;
    this.def = KINDS[kind];
    this.hp = this.def.hp;
    const world = g.physics.world;
    const s = this.def.scale;
    this.pos.set(spec.x, spec.y, spec.z);
    this.prev.copy(this.pos);
    this.renderPos.copy(this.pos);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spec.x, spec.y + (HALF + RADIUS) * s, spec.z));
    const col = world.createCollider(RAPIER.ColliderDesc.capsule(HALF * s, RADIUS * s).setCollisionGroups(groups(G.NPC, ALL_GROUPS & ~G.SENSOR & ~G.DEBRIS)), body);
    this.kcc = world.createCharacterController(0.03);
    this.kcc.enableAutostep(0.4, 0.2, false);
    this.kcc.enableSnapToGround(0.4);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(kind === 'boss' ? 400 : 90);
    this.avatar = new Avatar({ suit: this.def.suit, skin: 0x9a7a6a, accent: this.def.accent });
    this.avatar.root.scale.setScalar(s);
    const root = new THREE.Group();
    root.add(this.avatar.root);
    this.entity = new Entity('fighter', 'flesh', root);
    this.entity.body = body;
    this.entity.colliders = [col];
    this.entity.radius = 0.6 * s;
    this.entity.volume = 0.08 * s * s * s;
    this.entity.tags.add('enemy');
    this.entity.spec = spec;
    this.entity.onDamage = (n) => this.damage(n);
    this.entity.onImpulse = (x, y, z) => {
      const m = kind === 'boss' ? 6 : 1;
      this.kb.x += x / (80 * m);
      this.kb.z += z / (80 * m);
      this.vy = Math.max(this.vy, y / (80 * m));
      if (this.vy > 2) this.grounded = false;
    };
    this.entity.facing = () => this.facingV.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.entity.aware = () => true;
    this.entity.update = (dt) => this.fixedUpdate(dt);
    // Health bar.
    this.hpBg = new THREE.Sprite(sys.barBg);
    this.hpFill = new THREE.Sprite(kind === 'boss' ? sys.barBoss : sys.barFill);
    for (const sp of [this.hpBg, this.hpFill]) {
      sp.center.set(0, 0.5);
      sp.renderOrder = 25;
      root.add(sp);
    }
  }

  private damage(n: number) {
    if (this.dead) return;
    this.hp -= n;
    this.hitFlash = 1;
    if (this.hp <= 0) this.die();
  }

  private die() {
    this.dead = true;
    this.deadT = 0;
    const g = this.sys.game;
    audio.noiseBurst({ pos: this.pos, volume: 0.6, decay: 0.4, freq: 600, freqEnd: 100, brown: true });
    g.particles.emit(FX.shadow, this.pos.clone().setY(this.pos.y + 1), 20, { spread: Math.PI, speed: [1, 3], jitter: 0.5 });
    if (this.kind === 'boss') {
      g.rig.shake(0.6);
      explosion(g, this.pos.clone().setY(this.pos.y + 1), { radius: 6, impulse: 500, element: 'impact', amount: 0.5, look: 'electric', sound: true });
    }
    this.onDeath?.();
  }

  /** What to attack: the player, or a Shadow decoy if it's closer / the player is invisible. */
  private target(): THREE.Vector3 | null {
    const g = this.sys.game;
    const pl = g.player.curPos;
    const dPl = pl.distanceTo(this.pos);
    const playerVisible = !g.digging && (!g.stealth.invisible || dPl < 2.2 || g.stealth.reveal > 0) && !g.health.dead;
    let best: THREE.Vector3 | null = playerVisible ? pl : null;
    let bd = playerVisible ? dPl : Infinity;
    for (const d of g.stealth.decoys) {
      const dd = d.pos.distanceTo(this.pos) * 0.8;
      if (dd < bd) {
        bd = dd;
        best = d.pos;
      }
    }
    return best;
  }

  private fixedUpdate(dt: number) {
    const g = this.sys.game;
    this.prev.copy(this.pos);
    const e = this.entity;
    if (this.dead) {
      this.deadT += dt;
      this.move(dt, 0, 0);
      if (this.deadT > 2.2) g.entities.remove(e);
      return;
    }
    this.attackCd -= dt;
    this.special -= dt;
    const stunned = e.stun > 0 || e.frozen > 0.5;
    if (e.stun > 0) e.stun -= dt;
    if (e.burning && Math.random() < dt * 2) this.damage(4);
    const target = stunned ? null : this.target();
    let mx = 0;
    let mz = 0;
    if (target) {
      const to = this.tmp.copy(target).sub(this.pos).setY(0);
      const d = to.length();
      const want = Math.atan2(-to.x, -to.z);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += THREE.MathUtils.clamp(dy, -dt * 7, dt * 7);
      to.divideScalar(Math.max(d, 0.001));
      const atPlayer = target === g.player.curPos;
      if (this.charging > 0) {
        // Boss charge.
        this.charging -= dt;
        mx = this.chargeDir.x * 15;
        mz = this.chargeDir.z * 15;
        if (atPlayer && d < 2.5 && this.attackCd <= 0) {
          this.attackCd = 1;
          g.damagePlayer(28, this.pos, 14);
        }
      } else if (this.kind === 'caster') {
        // Keep distance and strafe; throw orbs.
        const ideal = 11;
        const sp = this.def.speed;
        const radial = d > ideal + 2 ? 1 : d < ideal - 3 ? -1 : 0;
        mx = (to.x * radial + -to.z * this.strafe * 0.7) * sp;
        mz = (to.z * radial + to.x * this.strafe * 0.7) * sp;
        if (Math.random() < dt * 0.3) this.strafe *= -1;
        if (this.attackCd <= 0 && d < 24) {
          this.attackCd = 1.8 + Math.random();
          this.sys.throwOrb(this.pos.clone().setY(this.pos.y + 1.4 * this.def.scale), target.clone().setY(target.y + (atPlayer ? 0.3 : 1)), this.def.damage, 0x5ab4ff);
        }
      } else {
        if (this.windup > 0) {
          this.windup -= dt;
          if (this.windup <= 0) this.melee(target, atPlayer);
        } else if (d > this.def.reach * 0.8) {
          mx = to.x * this.def.speed;
          mz = to.z * this.def.speed;
        } else if (this.attackCd <= 0) {
          this.windup = this.kind === 'boss' ? 0.45 : 0.28;
          this.attackCd = this.kind === 'boss' ? 1.3 : 0.95;
          this.avatar.aimTarget = 1;
        }
        // Boss specials.
        if (this.kind === 'boss' && this.special <= 0 && d < 30) {
          this.special = 4 + Math.random() * 2;
          const r = Math.random();
          if (r < 0.35) this.slam();
          else if (r < 0.7) {
            this.charging = 0.8;
            this.chargeDir.copy(to);
            audio.tone({ pos: this.pos, volume: 0.5, freq: 80, freqEnd: 160, decay: 0.6, type: 'sawtooth', ref: 20 });
            g.toasts.show('The boss charges!', '#ff4a3a', 900);
          } else {
            for (let i = -2; i <= 2; i++) {
              const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(i * 2.5);
              this.sys.throwOrb(this.pos.clone().setY(this.pos.y + 2.4), target.clone().add(side).setY(target.y + 0.4), 14, 0xff3040);
            }
          }
        }
      }
    }
    this.move(dt, mx, mz);
  }

  private melee(target: THREE.Vector3, atPlayer: boolean) {
    const g = this.sys.game;
    this.avatar.aimTarget = 0;
    audio.whoosh(this.pos, 0.6, 0.9);
    if (target.distanceTo(this.pos) > this.def.reach + 0.6) return;
    if (atPlayer) {
      g.damagePlayer(this.def.damage, this.pos, this.kind === 'boss' ? 10 : 5);
      g.particles.emit(FX.spark, target, 10, { spread: Math.PI, speed: [2, 5] });
    } else {
      g.particles.emit(FX.shadow, target, 10, { spread: Math.PI, speed: [1, 3] });
    }
  }

  private slam() {
    const g = this.sys.game;
    g.toasts.show('Ground slam!', '#ff4a3a', 800);
    this.vy = 7;
    this.grounded = false;
    setTimeout(() => {
      if (this.dead) return;
      explosion(g, this.pos.clone(), { radius: 7, impulse: 600, element: 'earth', amount: 1, damage: 26, playerPush: 12, decal: 'crack', look: 'dust', owner: 'enemy' });
    }, 650);
  }

  private move(dt: number, mx: number, mz: number) {
    const col = this.entity.colliders[0];
    if (this.grounded && this.vy <= 0) this.vy = -1;
    else this.vy += PHYSICS.gravity * 1.4 * dt;
    const dx = (mx + this.kb.x) * dt;
    const dz = (mz + this.kb.z) * dt;
    this.kb.multiplyScalar(Math.max(0, 1 - dt * (this.grounded ? 6 : 1.2)));
    this.kcc.computeColliderMovement(col, { x: dx, y: this.vy * dt, z: dz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.NPC, ALL_GROUPS & ~G.SENSOR & ~G.DEBRIS & ~G.PLAYER));
    const mv = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    this.speedNow = Math.hypot(mv.x, mv.z) / Math.max(dt, 1e-4);
    if (this.pos.y < -30) this.damage(9999);
    const s = this.def.scale;
    this.entity.body!.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + (HALF + RADIUS) * s, z: this.pos.z });
  }

  render(dt: number, alpha: number) {
    this.renderPos.copy(this.prev).lerp(this.pos, alpha);
    let dy = this.yaw - this.renderYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.renderYaw += dy * Math.min(1, dt * 14);
    this.entity.object.position.copy(this.renderPos);
    const stunned = this.entity.stun > 0;
    this.avatar.update(dt, ORIGIN, this.renderYaw, this.dead || stunned ? 0 : this.speedNow, this.grounded, this.windup > 0 ? 0.3 : 0);
    if (this.dead) {
      const k = Math.min(1, this.deadT / 0.4);
      this.avatar.root.rotation.x = -k * Math.PI / 2;
      this.avatar.root.position.y = k * 0.3;
      this.avatar.setOpacity(Math.max(0, 1 - Math.max(0, this.deadT - 1.2)));
    }
    // Hit flash.
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.avatar.suit.emissive.setRGB(this.hitFlash, this.hitFlash * 0.3, this.hitFlash * 0.3);
    // Health bar.
    const f = Math.max(0, this.hp / this.def.hp);
    const top = 2.15 * this.def.scale;
    const w = this.kind === 'boss' ? 2.2 : 1.1;
    this.hpBg.position.set(-w / 2, top, 0);
    this.hpBg.scale.set(w, 0.12, 1);
    this.hpFill.position.set(-w / 2, top, 0.01);
    this.hpFill.scale.set(Math.max(0.001, w * f), 0.12, 1);
    this.hpBg.visible = this.hpFill.visible = !this.dead && f < 1;
    if (stunned && Math.random() < dt * 6) this.sys.game.particles.emit(FX.electric, this.renderPos.clone().setY(this.renderPos.y + 1.8 * this.def.scale), 1, { spread: Math.PI, speed: [0.3, 1] });
  }

  dispose() {
    this.avatar.suit.dispose();
    this.avatar.skin.dispose();
    this.avatar.accent.dispose();
  }
}

function solid(color: string): THREE.SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);
  return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true, transparent: true });
}

/** Owns fighters and their energy orbs. */
export class FighterSystem implements GameSystem {
  readonly fighters = new Set<Fighter>();
  private orbs: Orb[] = [];
  private alpha = 1;
  readonly barBg = solid('rgba(10,10,14,0.75)');
  readonly barFill = solid('#ff4a3a');
  readonly barBoss = solid('#ff2a60');
  private tmp = new THREE.Vector3();

  constructor(readonly game: Game) {}

  spawn(kind: FighterKind, x: number, z: number): Fighter {
    const g = this.game;
    // Stand on whatever is there (arena floor, terrain), never inside it.
    const top = g.physics.raycast(new THREE.Vector3(x, g.world.heightAt(x, z) + 6, z), new THREE.Vector3(0, -1, 0), 12, { groups: groups(G.NPC, G.TERRAIN | G.STATIC) });
    const spec: PropSpec = { type: 'fighter', x, y: (top ? top.point.y : g.world.heightAt(x, z)) + 0.08, z };
    const f = new Fighter(this, kind, spec);
    f.entity.transient = true;
    this.fighters.add(f);
    f.entity.onRemove = () => {
      this.fighters.delete(f);
      f.dispose();
    };
    g.entities.add(f.entity);
    g.particles.emit(FX.shadowGlow, new THREE.Vector3(x, spec.y + 1, z), 40, { spread: Math.PI, speed: [1, 4], jitter: 0.6 });
    g.particles.emit(FX.smoke, new THREE.Vector3(x, spec.y + 0.5, z), 10, { spread: 1, speed: [0.5, 2], jitter: 0.6 });
    g.lights.add(new THREE.Vector3(x, spec.y + 1, z), 0xff4060, 20, 8);
    audio.tone({ pos: new THREE.Vector3(x, spec.y, z), volume: 0.3, freq: 160, freqEnd: 60, decay: 0.6, type: 'sawtooth', ref: 15 });
    return f;
  }

  throwOrb(from: THREE.Vector3, to: THREE.Vector3, damage: number, color: number) {
    const vel = to.clone().sub(from).normalize().multiplyScalar(19);
    this.orbs.push({ pos: from.clone(), vel, life: 3, damage, color });
    audio.whoosh(from, 0.4, 1.6);
  }

  setAlpha(a: number) {
    this.alpha = a;
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dt;
      const step = this.tmp.copy(o.vel).multiplyScalar(dt);
      const len = step.length();
      const hit = g.physics.raycast(o.pos, step.divideScalar(len), len, { groups: groups(G.NPC, G.TERRAIN | G.STATIC | G.PHASEABLE | G.DYNAMIC) });
      o.pos.addScaledVector(o.vel, dt);
      const pl = g.player.curPos;
      const dPl = o.pos.distanceTo(pl);
      // The Hydro Shield (and Stone Armor) blocks projectiles.
      if (g.shielded && dPl < 1.6) {
        g.particles.emit(FX.splash, o.pos, 20, { spread: Math.PI, speed: [1, 4] });
        audio.noiseBurst({ pos: o.pos, volume: 0.4, decay: 0.2, filter: 'bandpass', freq: 1200 });
        this.orbs.splice(i, 1);
        continue;
      }
      if (dPl < 0.8 && !g.digging) {
        g.damagePlayer(o.damage, o.pos, 4);
        g.particles.emit(ORB, o.pos, 20, { spread: Math.PI, speed: [2, 6], color0: o.color });
        this.orbs.splice(i, 1);
        continue;
      }
      if (hit || o.life <= 0) {
        g.particles.emit(ORB, o.pos, 15, { spread: Math.PI, speed: [1, 4], color0: o.color });
        this.orbs.splice(i, 1);
      }
    }
  }

  update(dt: number) {
    const g = this.game;
    for (const f of this.fighters) f.render(dt, this.alpha);
    for (const o of this.orbs) {
      g.particles.emit(ORB, o.pos, dt * 80, { spread: Math.PI, speed: [0.1, 0.5], jitter: 0.12, color0: 0xffffff, color1: o.color });
      g.lights.add(o.pos, o.color, 8, 6);
    }
  }

  clearAll() {
    for (const f of [...this.fighters]) this.game.entities.remove(f.entity);
    this.orbs.length = 0;
  }

  reset() {
    this.orbs.length = 0;
  }
}

const ORIGIN = new THREE.Vector3();
