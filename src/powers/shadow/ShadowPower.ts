import * as THREE from 'three';
import { audio, type LoopHandle } from '../../core/Audio';
import type { Game } from '../../core/Game';
import { Avatar } from '../../player/Avatar';
import { FX } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { Ability } from '../Ability';
import { aim, handPos, pose } from '../common';
import { Power } from '../Power';
import { Assassinate, CursedStrike } from './extra';

const PURPLE = 0x9b7bff;
const DARK = 0x2a1450;

function smokeBurst(g: Game, p: THREE.Vector3, n = 30) {
  g.particles.emit(FX.shadow, p, n * 0.5, { spread: Math.PI, speed: [0.8, 3], jitter: 0.5, sizeMul: 0.7, lifeMul: 0.7 });
  g.particles.emit(FX.shadowGlow, p, n * 0.6, { spread: Math.PI, speed: [1, 4], jitter: 0.4 });
}

// -----------------------------------------------------------------------------
// Z — Invisibility (toggle)
// -----------------------------------------------------------------------------
class Invisibility extends Ability {
  readonly name = 'Invisibility';
  readonly description = 'Become completely invisible — no body, no shadow. Enemies lose track of you unless you bump into them; big explosions or lightning nearby flicker you back for a moment.';
  icon = ICONS.eye;
  mode = 'toggle' as const;
  cost = 5;
  cooldown = 0.6;
  minEnergy = 10;
  private fade = 0;

  protected start() {
    const g = this.game;
    g.stealth.invisible = true;
    audio.noiseBurst({ volume: 0.3, attack: 0.1, decay: 0.6, filter: 'bandpass', freq: 1800, freqEnd: 300, q: 2 });
    smokeBurst(g, g.player.curPos, 15);
    return true;
  }

  protected end() {
    const g = this.game;
    g.stealth.invisible = false;
    g.playerHidden = false;
    audio.noiseBurst({ volume: 0.3, attack: 0.05, decay: 0.4, filter: 'bandpass', freq: 300, freqEnd: 1800, q: 2 });
    smokeBurst(g, g.player.curPos, 10);
  }

  protected sustain(dt: number) {
    // Darkness makes it cheaper; bright light costs more.
    const g = this.game;
    const extra = (g.stealth.light - 0.5) * this.cost * 0.6;
    if (extra > 0) g.energy.drain(extra * dt);
    else g.energy.refund(-extra * dt);
  }

  update(dt: number) {
    const g = this.game;
    const target = this.active ? 1 : 0;
    this.fade += (target - this.fade) * Math.min(1, dt * 5);
    if (this.fade < 0.002 && !this.active) {
      this.fade = 0;
      return;
    }
    // Fully invisible: no body, no shadow. Hands are a faint ghost outline
    // (so you can still aim), which flickers if a bright flash reveals you.
    const revealed = this.active && g.stealth.reveal > 0;
    const o = 1 - this.fade * (revealed ? 0.6 : 1);
    g.playerHidden = this.active && this.fade > 0.85 && !revealed;
    g.avatar.setOpacity(Math.max(0, o));
    g.hands.setOpacity(Math.max(0.07, o));
    if (this.active && Math.random() < dt * 2) {
      g.particles.emit(FX.shadow, g.player.renderPos, 1, { spread: Math.PI, speed: [0.1, 0.3], jitter: 0.4, sizeMul: 0.25 });
    }
  }

  reset() {
    super.reset();
    this.game.playerHidden = false;
    this.game.stealth.invisible = false;
  }
}

// -----------------------------------------------------------------------------
// X — Shadow Blink (hold to aim, release to teleport)
// -----------------------------------------------------------------------------
class ShadowBlink extends Ability {
  readonly name = 'Shadow Blink';
  readonly description = 'Hold to aim (a ghost shows the destination), release to teleport. Longer range at night or into shadow. Never lands you inside walls.';
  icon = ICONS.blink;
  mode = 'hold' as const;
  cost = 0;
  cooldown = 0.7;
  minEnergy = 16;
  private ghost!: THREE.Group;
  private ghostMat!: THREE.MeshBasicMaterial;
  private dest: THREE.Vector3 | null = null;
  private tmp = new THREE.Vector3();
  private validTimer = 0;
  private hum: LoopHandle | null = null;

  protected init() {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: PURPLE, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 1.1, 4, 10), this.ghostMat);
    body.position.y = 0.9;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 24).rotateX(-Math.PI / 2), this.ghostMat);
    ring.position.y = 0.03;
    this.ghost.add(body, ring);
    this.ghost.visible = false;
    this.game.scene.add(this.ghost);
  }

  /** Current maximum range: night and shadowy targets extend it. */
  range(target?: THREE.Vector3): number {
    const g = this.game;
    let r = THREE.MathUtils.lerp(14, 28, g.env.nightFactor);
    if (target && g.env.nightFactor < 0.5 && g.stealth.shadedAt(target)) r *= 1.5;
    return r;
  }

  protected start() {
    pose(this.game, 'rest', 'cast');
    this.hum = audio.loop({ freq: 220, filter: 'bandpass', q: 4, volume: 0.5, lfo: { rate: 4, depth: 0.3 } });
    this.hum.setLevel(0.4);
    this.validTimer = 0;
    return true;
  }

  /** Work out a safe destination for the current aim. */
  private compute(): THREE.Vector3 | null {
    const g = this.game;
    const maxR = this.range() * 1.5;
    const t = aim(g, maxR);
    let p = t.point.clone();
    if (t.hit && t.normal.y < 0.5) p.addScaledVector(t.normal, 0.6); // backed off a wall
    if (!t.hit) p = t.origin.clone().addScaledVector(t.dir, Math.min(maxR, this.range()));
    // Clamp to the effective range for this target.
    const feet = g.player.feet(this.tmp);
    const r = this.range(p);
    if (p.distanceTo(feet) > r) p = feet.clone().add(p.sub(feet).setLength(r));
    return g.player.findFreeSpot(p, 2.5);
  }

  protected sustain(dt: number) {
    const g = this.game;
    this.validTimer -= dt;
    if (this.validTimer <= 0) {
      this.validTimer = 0.05;
      this.dest = this.compute();
    }
    this.ghost.visible = true;
    if (this.dest) {
      this.ghost.position.lerp(this.dest, this.ghost.position.distanceTo(this.dest) > 3 ? 1 : 0.5);
      this.ghostMat.color.set(PURPLE);
    } else {
      const t = aim(g, this.range());
      this.ghost.position.copy(t.point);
      this.ghostMat.color.set(0xff4060);
    }
    this.ghostMat.opacity = 0.25 + Math.sin(performance.now() * 0.01) * 0.08;
    g.hands.glow(PURPLE, 0.4);
    if (Math.random() < dt * 20) g.particles.emit(FX.shadowGlow, handPos(g, 'right', this.tmp), 1, { spread: Math.PI, speed: [0.2, 0.6] });
    if (this.dest && Math.random() < dt * 15) g.particles.emit(FX.shadow, this.ghost.position, 1, { spread: 0.6, speed: [0.2, 0.8], jitter: 0.3, sizeMul: 0.5 });
  }

  protected end(charge: number) {
    const g = this.game;
    this.ghost.visible = false;
    this.hum?.stop(0.1);
    this.hum = null;
    pose(g, 'rest', 'rest');
    if (charge < 0) return;
    const dest = this.compute();
    if (!dest || !g.energy.spend(16)) {
      audio.uiDeny();
      return;
    }
    const from = g.player.curPos.clone();
    smokeBurst(g, from, 40);
    g.player.teleport(dest);
    smokeBurst(g, g.player.curPos, 40);
    g.lights.add(g.player.curPos, PURPLE, 6, 6);
    g.rig.fovPunch(10);
    g.rig.addFlash(0.05);
    audio.whoosh(from, 0.8, 0.5);
    audio.noiseBurst({ pos: dest, volume: 0.5, attack: 0.08, decay: 0.3, filter: 'bandpass', freq: 200, freqEnd: 1200, q: 3 });
    g.stealth.noise(dest, 4);
  }
}

// -----------------------------------------------------------------------------
// C — Phase (hold): walk through walls
// -----------------------------------------------------------------------------
class Phase extends Ability {
  readonly name = 'Phase';
  readonly description = 'Hold to become intangible and walk through walls, doors and thin barriers (floors stay solid). Release or run dry inside a wall and you are pushed out safely.';
  icon = ICONS.phase;
  mode = 'hold' as const;
  cost = 14;
  cooldown = 0.4;
  minEnergy = 8;
  private saved = new Map<THREE.Material, { t: boolean; o: number; d: boolean }>();
  private loop: LoopHandle | null = null;
  /** Still intangible after release because we're inside a wall. */
  private lingering = false;

  protected start() {
    const g = this.game;
    g.player.phase = true;
    this.ghostWalls(true);
    g.canvas.style.filter = 'saturate(0.35) brightness(0.92) hue-rotate(-12deg)';
    this.loop = audio.loop({ freq: 300, filter: 'bandpass', q: 2, volume: 0.6, lfo: { rate: 0.7, depth: 0.4 } });
    this.loop.setLevel(0.5, 0.2);
    smokeBurst(g, g.player.curPos, 12);
    return true;
  }

  private ghostWalls(on: boolean) {
    for (const m of this.game.phaseMaterials) {
      if (on) {
        if (!this.saved.has(m)) this.saved.set(m, { t: m.transparent, o: m.opacity, d: m.depthWrite });
        m.transparent = true;
        m.opacity = 0.28;
        m.depthWrite = false;
      } else {
        const s = this.saved.get(m);
        if (s) {
          m.transparent = s.t;
          m.opacity = s.o;
          m.depthWrite = s.d;
        }
      }
      m.needsUpdate = true;
    }
    if (!on) this.saved.clear();
  }

  protected sustain(dt: number) {
    const g = this.game;
    g.hands.glow(PURPLE, 0.25);
    g.hands.setOpacity(0.45);
    g.avatar.setOpacity(0.4);
    if (Math.random() < dt * 8) g.particles.emit(FX.shadow, g.player.curPos, 1, { spread: Math.PI, speed: [0.2, 0.6], jitter: 0.5, sizeMul: 0.6 });
  }

  protected end() {
    this.finish();
  }

  /** Leave the phased state — but never inside solid geometry. */
  private finish() {
    const g = this.game;
    const pl = g.player;
    if (pl.overlaps(pl.curPos, pl.halfHeight)) {
      // Inside a wall: find the nearest open space and pop out there.
      const spot = pl.findFreeSpot(pl.feet(new THREE.Vector3()), 10);
      if (spot) {
        smokeBurst(g, pl.curPos, 20);
        pl.teleport(spot, true);
        smokeBurst(g, pl.curPos, 20);
      } else {
        // Nowhere safe yet: stay intangible a moment longer.
        this.lingering = true;
        return;
      }
    }
    this.lingering = false;
    pl.phase = false;
    this.ghostWalls(false);
    g.canvas.style.filter = '';
    g.hands.setOpacity(1);
    g.avatar.setOpacity(1);
    this.loop?.stop(0.3);
    this.loop = null;
  }

  update() {
    if (this.lingering) this.finish();
  }

  reset() {
    super.reset();
    const g = this.game;
    this.lingering = false;
    g.player.phase = false;
    this.ghostWalls(false);
    g.canvas.style.filter = '';
    this.loop?.stop(0.1);
    this.loop = null;
  }
}

// -----------------------------------------------------------------------------
// B — Shadow Clone / Decoy (tap); crouch + B pulls props with shadow tendrils
// -----------------------------------------------------------------------------
interface Clone {
  avatar: Avatar;
  eyes: THREE.Mesh[];
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
  life: number;
  yaw: number;
  target: Entity | null;
  attackCd: number;
  punch: number;
  vy: number;
}

const EYE_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1030).multiplyScalar(4) });
const EYE_GEO = new THREE.SphereGeometry(0.025, 8, 6);

/**
 * B — Shadow Clone: a living shadow warrior rises from a pool of darkness.
 * It hunts the nearest enemy, beats it with cursed-energy punches (and lures
 * guards as a decoy). Crouch + B: shadow tendrils yank small props to you.
 */
class ShadowClone extends Ability {
  readonly name = 'Shadow Clone';
  readonly description = 'Summon a shadow warrior with burning red eyes: it hunts the nearest enemy and pummels it with cursed energy, and distracts guards. Up to 3 at once. Crouch + B: tendrils yank props to you.';
  icon = ICONS.clone;
  cost = 26;
  cooldown = 3;
  private clones: Clone[] = [];
  private near: Entity[] = [];
  private tmp = new THREE.Vector3();

  protected start() {
    const g = this.game;
    if (g.player.crouching) return this.tendrils();
    if (this.clones.length >= 3) this.kill(0);
    const av = new Avatar({ suit: 0x07040d, skin: 0x0d0618, accent: 0x7a2aff });
    av.setOpacity(0.92);
    g.scene.add(av.root);
    // Glowing red eyes on the head.
    const head = av.root.getObjectByName('head') ?? av.root;
    const eyes: THREE.Mesh[] = [];
    for (const x of [-0.045, 0.045]) {
      const eye = new THREE.Mesh(EYE_GEO, EYE_MAT);
      eye.position.set(x, 0.02, 0.11);
      head.add(eye);
      eyes.push(eye);
    }
    const dir = g.rig.aimDirection(new THREE.Vector3()).setY(0).normalize();
    const pos = g.player.feet(new THREE.Vector3()).addScaledVector(dir, 2);
    pos.y = g.world.heightAt(pos.x, pos.z);
    const c: Clone = { avatar: av, eyes, pos, dir, t: 0, life: 14, yaw: g.rig.yaw, target: null, attackCd: 0.6, punch: 0, vy: 0 };
    this.clones.push(c);
    g.stealth.addDecoy(c.pos, c.life);
    // Rise from a pool of shadow.
    g.decals.add('scorch', pos, UP, 2.4, 3, 0.9);
    smokeBurst(g, pos.clone().setY(pos.y + 0.3), 40);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.bolts.spawn(pos.clone().add(TMP.set(Math.cos(a) * 1.4, 0.05, Math.sin(a) * 1.4)), pos.clone().setY(pos.y + 1.6), { color: 0x6a2aff, width: 0.03, jag: 0.25, detail: 5, life: 0.35, intensity: 1.2 });
    }
    audio.noiseBurst({ pos, volume: 0.6, attack: 0.15, decay: 0.7, filter: 'bandpass', freq: 200, freqEnd: 900, q: 3 });
    audio.tone({ pos, volume: 0.25, freq: 70, freqEnd: 140, decay: 0.8, type: 'sawtooth' });
    g.stealth.noise(c.pos, 18);
    pose(g, 'push', 'rest');
    setTimeout(() => pose(g, 'rest', 'rest'), 250);
    return true;
  }

  /** Pull light props in a cone towards the player with dark tendrils. */
  private tendrils(): boolean {
    const g = this.game;
    const origin = g.camera.position;
    const dir = g.rig.aimDirection(this.tmp);
    let n = 0;
    for (const e of g.entities.nearby(origin, 16, this.near)) {
      if (!e.isDynamic || e.mass > 120) continue;
      const to = e.center(TMP).sub(origin);
      const d = to.length();
      if (to.dot(dir) / d < 0.85) continue;
      const pull = to.clone().normalize().multiplyScalar(-Math.min(14, 6 + d * 0.6) * e.mass);
      e.body!.applyImpulse({ x: pull.x, y: e.mass * 4, z: pull.z }, true);
      g.bolts.spawn(handPos(g, 'right', TMP2), e.center(TMP), { color: 0x6a3ad0, width: 0.04, jag: 0.15, detail: 5, life: 0.4, intensity: 0.8, forkChance: 0.05 });
      g.particles.emit(FX.shadow, e.center(TMP), 8, { spread: Math.PI, speed: [0.5, 1.5], sizeMul: 0.6 });
      if (++n >= 6) break;
    }
    if (n === 0) {
      g.energy.refund(this.cost * 0.7);
      this.cooldownLeft = 0;
      audio.uiDeny();
      return false;
    }
    audio.whoosh(origin, 0.7, 0.4);
    pose(g, 'grip', 'grip');
    setTimeout(() => pose(g, 'rest', 'rest'), 300);
    return true;
  }

  private kill(i: number) {
    const c = this.clones[i];
    smokeBurst(this.game, c.pos.clone().setY(c.pos.y + 1), 35);
    c.avatar.root.removeFromParent();
    c.avatar.accent.dispose();
    c.avatar.suit.dispose();
    c.avatar.skin.dispose();
    this.clones.splice(i, 1);
  }

  /** Nearest enemy worth fighting (fighters, guards; dummies if nothing else). */
  private pickTarget(c: Clone): Entity | null {
    let best: Entity | null = null;
    let bd = 22;
    for (const e of this.game.entities.nearby(c.pos, 22, this.near)) {
      if (!e.onDamage || e.dead) continue;
      const d = e.center(TMP).distanceTo(c.pos) + (e.type === 'dummy' ? 12 : 0);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  update(dt: number) {
    if (dt <= 0) return;
    const g = this.game;
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i];
      c.t += dt;
      c.attackCd -= dt;
      if (!c.target || c.target.dead || Math.random() < dt * 0.5) c.target = this.pickTarget(c);
      let speed = 0;
      let yaw = c.yaw;
      if (c.target) {
        const tp = c.target.center(TMP);
        const to = TMP2.copy(tp).sub(c.pos).setY(0);
        const d = to.length();
        yaw = Math.atan2(-to.x, -to.z);
        c.yaw = yaw;
        if (d > 1.5) {
          speed = 6.5;
          c.dir.copy(to).divideScalar(d);
        } else if (c.attackCd <= 0) {
          // Cursed-energy punch.
          c.attackCd = 0.55;
          c.punch = 1;
          const dmg = 18;
          g.reactions.damage(c.target, dmg, 'shadow');
          c.target.applyImpulse(c.dir.x * 250, 120, c.dir.z * 250);
          const hp = tp.clone();
          g.damageNumbers.spawn(hp.setY(hp.y + 0.9), dmg, '#9b7bff');
          g.particles.emit(FX.shadow, tp, 10, { spread: Math.PI, speed: [1, 3], sizeMul: 0.6 });
          g.particles.emit(FX.shadowGlow, tp, 15, { spread: Math.PI, speed: [2, 5] });
          g.bolts.spawn(c.pos.clone().setY(c.pos.y + 1.2), tp, { color: 0x8a2aff, width: 0.03, detail: 4, life: 0.15, intensity: 1.5 });
          g.lights.add(tp, 0x7a2aff, 6, 5);
          audio.noiseBurst({ pos: tp, volume: 0.5, decay: 0.12, freq: 700, freqEnd: 150, brown: true });
        }
      } else if (c.t < 4) {
        speed = 3.2;
        yaw = Math.atan2(-c.dir.x, -c.dir.z);
      } else {
        c.yaw += Math.sin(c.t * 0.9) * dt * 0.8;
        yaw = c.yaw;
      }
      if (speed > 0) {
        const next = TMP.copy(c.pos).addScaledVector(c.dir, speed * dt);
        const gy = g.world.heightAt(next.x, next.z);
        const hit = g.physics.raycast(TMP2.set(next.x, c.pos.y + 1, next.z), c.dir, 0.6, { exclude: g.player.collider });
        if (!hit && Math.abs(gy - c.pos.y) < 1.2) c.pos.set(next.x, gy, next.z);
        else if (!c.target) c.dir.applyAxisAngle(UP, Math.PI * 0.6);
      }
      const decoy = g.stealth.decoys.find((d) => Math.abs(d.life - (c.life - c.t)) < 0.5);
      if (decoy) decoy.pos.copy(c.pos);
      c.punch = Math.max(0, c.punch - dt * 5);
      c.avatar.aimTarget = c.punch > 0.2 ? 1 : 0;
      c.avatar.update(dt, c.pos, yaw, speed, true, 0);
      const fadeOut = c.life - c.t < 1 ? Math.max(0, c.life - c.t) : 1;
      c.avatar.setOpacity(0.92 * fadeOut);
      // Dark aura flowing off the body.
      if (Math.random() < dt * 14) g.particles.emit(FX.shadow, TMP.copy(c.pos).setY(c.pos.y + 0.4 + Math.random() * 1.3), 1, { spread: 0.6, speed: [0.3, 1], jitter: 0.25, sizeMul: 0.5 });
      if (Math.random() < dt * 6) g.particles.emit(FX.shadowGlow, TMP.copy(c.pos).setY(c.pos.y + 1), 1, { spread: Math.PI, speed: [0.2, 0.8], jitter: 0.3 });
      if (c.t >= c.life) this.kill(i);
    }
  }

  reset() {
    super.reset();
    while (this.clones.length) this.kill(0);
  }
}

/**
 * SHADOW (key 5): stealth, teleportation, intangibility and misdirection.
 */
export class ShadowPower extends Power {
  readonly id = 'shadow';
  readonly name = 'Shadow';
  readonly color = '#9b7bff';
  readonly icon = ICONS.shadow;
  readonly abilities = [new Invisibility(), new ShadowBlink(), new Phase(), new ShadowClone(), new CursedStrike(), new Assassinate()];
  private tmp = new THREE.Vector3();

  /** Idle: dark wisps curl off the hands. */
  update(dt: number) {
    const g = this.game;
    if (g.rig.mode !== 'first') return;
    if (Math.random() < dt * 5) {
      g.particles.emit(FX.shadow, handPos(g, Math.random() < 0.5 ? 'left' : 'right', this.tmp), 1, { spread: 0.5, speed: [0.1, 0.3], sizeMul: 0.15, color0: DARK });
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
