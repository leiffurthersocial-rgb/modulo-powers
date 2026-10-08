import * as THREE from 'three';
import { FX, type ParticlePreset } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import { audio, type LoopHandle } from '../../core/Audio';
import { Ability } from '../Ability';
import { aim, bothHands, handPos, pose, type Projectile } from '../common';
import { explosion } from '../effects';
import { Power } from '../Power';
import { BlazingFist, MeteorDive } from './extra';

const ORANGE = 0xff7a2f;

/** Flamethrower stream: starts narrow and fast, billows out as it slows. */
const JET: ParticlePreset = {
  blend: 'alpha',
  life: [0.45, 0.7],
  size: [0.1, 0.2],
  sizeEnd: 9,
  color0: 0xffe2a8,
  color1: 0xc42400,
  alpha: 0.85,
  fadeIn: 0.04,
  drag: 1.1,
  buoyancy: 3.5,
  turbulence: 7,
  shape: 1,
  intensity: 1.5,
};
const JET_CORE: ParticlePreset = {
  blend: 'add',
  life: [0.12, 0.25],
  size: [0.06, 0.12],
  sizeEnd: 4,
  color0: 0xfff1c8,
  color1: 0xff7a20,
  alpha: 0.5,
  fadeIn: 0.05,
  drag: 0.6,
  shape: 1,
  intensity: 1.1,
};
/** Tall licking flames for walls. */
const WALL_FIRE: ParticlePreset = {
  blend: 'alpha',
  life: [0.6, 1.2],
  size: [0.5, 0.9],
  sizeEnd: 0.3,
  color0: 0xffb44a,
  color1: 0xd83000,
  alpha: 0.9,
  fadeIn: 0.1,
  buoyancy: 6,
  drag: 1.6,
  turbulence: 4,
  shape: 1,
  intensity: 1.7,
};

// -----------------------------------------------------------------------------
// Z — Fireball (charge)
// -----------------------------------------------------------------------------
class Fireball extends Ability {
  readonly name = 'Fireball';
  readonly description = 'Hold to charge, release to hurl an arcing fireball that explodes, ignites and knocks things flying.';
  icon = ICONS.fireball;
  mode = 'charge' as const;
  cost = 22;
  cooldown = 0.45;
  chargeTime = 1.4;
  private hum: LoopHandle | null = null;
  private tmp = new THREE.Vector3();

  protected start() {
    pose(this.game, 'charge', 'charge');
    this.hum = audio.loop({ freq: 500, filter: 'lowpass', brown: true, volume: 0.8, lfo: { rate: 9, depth: 0.3 } });
    this.hum.setLevel(0.3);
    return true;
  }

  protected sustain() {
    const g = this.game;
    const c = this.charge;
    const p = bothHands(g, this.tmp);
    g.hands.glow(ORANGE, 0.3 + c * 0.9);
    g.particles.emit(FX.flame, p, 1 + c * 3, { spread: Math.PI, speed: [0.2, 0.6], jitter: 0.04 + c * 0.08, sizeMul: 0.25 + c * 0.35 });
    if (Math.random() < 0.3) g.particles.emit(FX.ember, p, 1, { spread: Math.PI, speed: [0.5, 1.5] });
    g.lights.add(p, ORANGE, 2 + c * 6, 4 + c * 3);
    this.hum?.setLevel(0.3 + c * 0.7);
    this.hum?.setRate(0.8 + c * 0.6);
  }

  protected end(charge: number) {
    this.hum?.stop(0.1);
    this.hum = null;
    pose(this.game, 'rest', 'rest');
    if (charge < 0) return;
    const g = this.game;
    const target = aim(g, 200, { water: true });
    const from = bothHands(g, new THREE.Vector3()).addScaledVector(target.dir, 0.3);
    const speed = 20 + charge * 24;
    // Aim so the arc passes near the crosshair point: slight upward compensation.
    const dir = target.point.clone().sub(from).normalize();
    const dist = target.point.distanceTo(from);
    const gravity = 7;
    const tFlight = dist / speed;
    const vel = dir.multiplyScalar(speed);
    vel.y += 0.5 * gravity * tFlight;
    const radius = 0.18 + charge * 0.22;
    const power = charge;
    g.projectiles.fire({
      pos: from,
      vel,
      gravity,
      radius,
      life: 6,
      onUpdate: (p: Projectile, dt: number) => {
        const s = 1 + power;
        g.particles.emit(FX.flame, p.pos, dt * 120 * s, { spread: Math.PI, speed: [0.2, 1], jitter: radius * 0.6, sizeMul: 0.6 + power * 0.6 });
        g.particles.emit(FX.fire, p.pos, dt * 60 * s, { spread: Math.PI, speed: [0.1, 0.6], jitter: radius, sizeMul: 0.5 + power * 0.5 });
        g.particles.emit(FX.smoke, p.pos, dt * 15, { spread: 0.5, speed: [0.2, 0.6], sizeMul: 0.5 });
        g.particles.emit(FX.ember, p.pos, dt * 25, { spread: Math.PI, speed: [0.5, 2] });
        g.lights.add(p.pos, ORANGE, 10 + power * 15, 8 + power * 6);
      },
      onHit: (p, hit) => {
        if (hit?.water) {
          g.particles.emit(FX.steam, p.pos, 25, { spread: 0.8, speed: [1, 4], jitter: 0.5, sizeMul: 1.5 });
          g.particles.emit(FX.splash, p.pos, 20, { spread: 0.6, speed: [2, 5] });
          audio.hiss(p.pos, 1);
          return;
        }
        // Back the blast off the surface a little.
        const at = p.pos.clone().addScaledVector(hit?.normal ?? UP, 0.3);
        explosion(g, at, {
          radius: 2.6 + power * 3.2,
          impulse: 220 + power * 600,
          element: 'fire',
          amount: 1.6 + power * 2.5,
          damage: 40 + power * 80,
          playerPush: 9 + power * 10,
          decal: 'scorch',
          normal: hit?.normal,
        });
      },
    });
    g.hands.kick('both', 0.08 + charge * 0.08);
    g.rig.shake(0.05 + charge * 0.12);
    g.rig.fovPunch(1 + charge * 3);
    audio.whoosh(from, 0.6 + charge * 0.6, 0.6);
    audio.ignite(from, 0.4);
  }
}

// -----------------------------------------------------------------------------
// X — Flamethrower (hold) with its own fuel tank
// -----------------------------------------------------------------------------
class Flamethrower extends Ability {
  readonly name = 'Flamethrower';
  readonly description = 'Hold for a continuous cone of fire with real heat. Uses a fuel tank that refills when idle.';
  icon = ICONS.flamethrower;
  mode = 'hold' as const;
  cost = 8;
  cooldown = 0.25;
  minEnergy = 4;
  fuel = 1;
  private roar: LoopHandle | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private heatTimer = 0;

  get affordable(): boolean {
    return super.affordable && this.fuel > 0.08;
  }

  protected start() {
    if (this.fuel < 0.08) return false;
    pose(this.game, 'push', 'cast');
    this.roar = audio.loop({ freq: 900, filter: 'lowpass', brown: false, volume: 1, lfo: { rate: 13, depth: 0.15 } });
    this.roar.setLevel(0.8, 0.05);
    audio.ignite(this.game.player.curPos, 0.5);
    return true;
  }

  protected sustain(dt: number) {
    const g = this.game;
    this.fuel = Math.max(0, this.fuel - dt * 0.2);
    if (this.fuel <= 0) {
      this.active = false;
      this.end();
      this.cooldownLeft = 1;
      return;
    }
    const nozzle = handPos(g, 'right', this.tmp);
    const dir = g.rig.aimDirection(this.tmp2);
    const inherit = g.player.velocity;
    // Emit along the distance the stream travels this frame, so it stays a
    // continuous jet at any frame rate.
    const to = TMP2.copy(nozzle).addScaledVector(dir, 16 * dt);
    g.particles.emit(JET, nozzle, dt * 220, { dir, spread: 0.07, speed: [15, 19], inherit, to });
    g.particles.emit(JET_CORE, nozzle, dt * 90, { dir, spread: 0.05, speed: [14, 18], inherit, to });
    g.particles.emit(FX.smoke, nozzle.clone().addScaledVector(dir, 5), dt * 12, { dir, spread: 0.3, speed: [2, 4], jitter: 0.8 });
    if (Math.random() < dt * 20) g.particles.emit(FX.ember, nozzle, 2, { dir, spread: 0.3, speed: [6, 12] });
    g.hands.glow(ORANGE, 0.9);
    g.lights.add(nozzle, ORANGE, 8 + Math.random() * 4, 7);
    g.lights.add(TMP.copy(nozzle).addScaledVector(dir, 4.5), 0xff6a20, 14 + Math.random() * 6, 9);
    g.rig.shake(dt * 0.6);
    g.hands.kick('right', dt * 0.3);
    this.roar?.setRate(0.9 + Math.random() * 0.2);
  }

  fixedUpdate(dt: number) {
    if (!this.active) return;
    this.heatTimer -= dt;
    if (this.heatTimer > 0) return;
    this.heatTimer = 0.1;
    const g = this.game;
    const origin = g.camera.position;
    const dir = g.rig.aimDirection(this.tmp2);
    const range = 9;
    // Heat everything inside the cone.
    for (const e of g.entities.nearby(origin, range + 1, NEAR)) {
      const to = e.center(this.tmp).sub(origin);
      const d = to.length();
      if (d > range + e.radius) continue;
      const cos = to.dot(dir) / Math.max(0.001, d);
      if (cos < Math.cos(0.32) && d > e.radius + 0.5) continue;
      g.reactions.apply(e, 'fire', 0.35 * (1 - d / (range + 2)), origin);
    }
    // Surfaces along the stream (grass, water steam, ice).
    const hit = aim(g, range, { water: true });
    if (hit.hit) {
      g.reactions.applySurfaces('fire', hit.point, 1.5, 0.4);
      if (hit.water) g.reactions.steam(hit.point, 0.5);
      else if (Math.random() < 0.3) g.decals.add('scorch', hit.point, hit.normal, 0.8 + Math.random() * 0.6, 30, 0.6);
    }
  }

  protected end() {
    this.roar?.stop(0.25);
    this.roar = null;
    pose(this.game, 'rest', 'rest');
  }

  update(dt: number) {
    if (!this.active) this.fuel = Math.min(1, this.fuel + dt * 0.14);
    // Show the tank in the slot's meter.
    this.meter = this.fuel;
  }
}

// -----------------------------------------------------------------------------
// C — Flame Wall / Fire Ring (tap; crouch for a ring around you)
// -----------------------------------------------------------------------------
interface FlameSeg {
  pos: THREE.Vector3;
  age: number;
  life: number;
}

class FlameWall extends Ability {
  readonly name = 'Flame Wall';
  readonly description = 'Raise a wall of fire where you aim (crouch for a ring around you). It blocks, burns and slowly dies down.';
  icon = ICONS.wall;
  cost = 30;
  cooldown = 3;
  private segs: FlameSeg[] = [];
  private tmp = new THREE.Vector3();
  private loop: LoopHandle | null = null;
  private heatTimer = 0;

  protected start() {
    const g = this.game;
    const ring = g.player.crouching;
    const points: THREE.Vector3[] = [];
    if (ring) {
      const c = g.player.feet(new THREE.Vector3());
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        points.push(new THREE.Vector3(c.x + Math.cos(a) * 4.5, 0, c.z + Math.sin(a) * 4.5));
      }
    } else {
      const t = aim(g, 22);
      if (!t.hit || t.normal.y < 0.5) {
        // Fall back to the ground at max range.
        t.point.copy(g.camera.position).addScaledVector(t.dir, 12);
      }
      const fwd = new THREE.Vector3(t.dir.x, 0, t.dir.z).normalize();
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
      for (let i = 0; i < 14; i++) {
        const o = (i / 13 - 0.5) * 9;
        points.push(t.point.clone().addScaledVector(side, o));
      }
    }
    for (const p of points) {
      p.y = g.world.heightAt(p.x, p.z);
      // Stand on props/structures if there are any.
      const hit = g.physics.raycast(TMP.set(p.x, p.y + 4, p.z), DOWN, 6, { exclude: g.player.collider });
      if (hit) p.y = hit.point.y;
      this.segs.push({ pos: p, age: 0, life: 8 + Math.random() * 2 });
      g.particles.emit(FX.flame, p, 6, { spread: 0.4, speed: [3, 6], sizeMul: 1.2 });
      g.reactions.applySurfaces('fire', p, 1.5, 1);
    }
    pose(g, 'down', 'down');
    g.hands.kick('both', 0.1);
    g.rig.shake(0.15);
    audio.ignite(points[Math.floor(points.length / 2)], 1);
    audio.whoosh(points[0], 0.8, 0.5);
    setTimeout(() => pose(g, 'rest', 'rest'), 250);
    return true;
  }

  fixedUpdate(dt: number) {
    if (this.segs.length === 0) return;
    this.heatTimer -= dt;
    if (this.heatTimer > 0) return;
    this.heatTimer = 0.2;
    const g = this.game;
    for (const s of this.segs) {
      const k = this.intensity(s);
      if (k <= 0.05) continue;
      const p = this.tmp.copy(s.pos).setY(s.pos.y + 1);
      for (const e of g.entities.nearby(p, 1.6, NEAR)) g.reactions.apply(e, 'fire', 0.5 * k, p);
    }
  }

  private intensity(s: FlameSeg): number {
    const t = s.age / s.life;
    return t < 0.08 ? t / 0.08 : t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4) : 1;
  }

  update(dt: number) {
    if (dt <= 0) return;
    const g = this.game;
    let total = 0;
    let nearest: THREE.Vector3 | null = null;
    let nd = Infinity;
    for (let i = this.segs.length - 1; i >= 0; i--) {
      const s = this.segs[i];
      s.age += dt;
      if (s.age >= s.life) {
        g.decals.add('burnt', s.pos, UP, 1.4, 60);
        this.segs.splice(i, 1);
        continue;
      }
      const k = this.intensity(s);
      g.particles.emit(WALL_FIRE, s.pos, dt * 80 * k, { spread: 0.2, speed: [1.5, 3.5], jitter: 0.4, sizeMul: 0.8 + k * 0.5 });
      g.particles.emit(FX.flame, s.pos, dt * 12 * k, { spread: 0.2, speed: [2, 4], jitter: 0.3 });
      g.particles.emit(FX.smoke, TMP.copy(s.pos).setY(s.pos.y + 2.5), dt * 4 * k, { spread: 0.3, speed: [0.5, 1.5], jitter: 0.4 });
      if (i % 3 === 0) g.lights.add(TMP.copy(s.pos).setY(s.pos.y + 1.2), 0xff6a20, 12 * k, 9);
      total += k;
      const d = s.pos.distanceTo(g.camera.position);
      if (d < nd) {
        nd = d;
        nearest = s.pos;
      }
    }
    if (total > 0 && nearest) {
      if (!this.loop) this.loop = audio.loop({ freq: 600, filter: 'lowpass', brown: true, volume: 1.2, lfo: { rate: 6, depth: 0.25 } });
      this.loop.setPosition(nearest.x, nearest.y + 1, nearest.z);
      this.loop.setLevel(Math.min(1, total / 6));
    } else if (this.loop) {
      this.loop.stop(0.6);
      this.loop = null;
    }
  }

  /** NPCs avoid walking through active flames. */
  isBlocked(p: THREE.Vector3): boolean {
    return this.segs.some((s) => this.intensity(s) > 0.2 && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1.2);
  }

  reset() {
    super.reset();
    this.segs.length = 0;
    this.loop?.stop(0.1);
    this.loop = null;
  }
}

// -----------------------------------------------------------------------------
// B — Fire Thrust (hold): rocket jump, hover, glide, double jump
// -----------------------------------------------------------------------------
class FireThrust extends Ability {
  readonly name = 'Fire Thrust';
  readonly description = 'Blast flames down to launch yourself, then hold to hover, climb or extend a glide. Tap in mid-air for a double jump.';
  icon = ICONS.thrust;
  mode = 'hold' as const;
  cost = 20;
  cooldown = 0.15;
  minEnergy = 8;
  private roar: LoopHandle | null = null;
  private tmp = new THREE.Vector3();
  private airBursts = 0;

  protected start() {
    const g = this.game;
    const pl = g.player;
    if (!pl.grounded && this.airBursts >= 2) return false;
    if (!g.energy.spend(6)) return false;
    // Initial kick: strong off the ground, a double-jump burst in the air.
    const up = pl.grounded ? 8.5 : 6.5;
    const v = pl.velocity;
    if (v.y < 0) v.y = 0;
    const fwd = g.rig.aimDirection(this.tmp).setY(0).normalize();
    pl.thrust(new THREE.Vector3(fwd.x * 1.5, up, fwd.z * 1.5));
    if (!pl.grounded) this.airBursts++;
    this.burst(30);
    g.rig.shake(0.2);
    g.rig.fovPunch(6);
    audio.explosion(pl.feet(this.tmp), 0.45);
    pose(g, 'down', 'down');
    this.roar = audio.loop({ freq: 500, filter: 'lowpass', brown: true, volume: 1.3, lfo: { rate: 18, depth: 0.2 } });
    this.roar.setLevel(0.9, 0.03);
    // Scorch / ignite what's below.
    const feet = pl.feet(this.tmp);
    const gy = g.world.heightAt(feet.x, feet.z);
    if (feet.y - gy < 1.5) {
      g.decals.add('scorch', TMP.set(feet.x, gy, feet.z), g.world.terrain.normalAt(feet.x, feet.z), 2.2, 40);
      g.reactions.applyArea('fire', TMP, 2, 0.8, { impulse: 80 });
    }
    return true;
  }

  private burst(n: number) {
    const g = this.game;
    const feet = g.player.feet(this.tmp);
    g.particles.emit(FX.flame, feet, n, { dir: DOWN, spread: 0.5, speed: [6, 12], sizeMul: 1.2, inherit: g.player.velocity });
    g.particles.emit(FX.fire, feet, n * 0.6, { dir: DOWN, spread: 0.6, speed: [4, 8], inherit: g.player.velocity });
    g.particles.emit(FX.smoke, feet, n * 0.3, { dir: DOWN, spread: 0.8, speed: [2, 4] });
  }

  protected sustain(dt: number) {
    const g = this.game;
    const pl = g.player;
    // Sustained thrust: slightly more than gravity, capped climb rate.
    const v = pl.velocity;
    const accel = v.y < 0 ? 32 : 19;
    if (v.y < 7) pl.thrust(TMP.set(0, accel * dt, 0));
    // Steering in the look direction.
    const fwd = g.rig.aimDirection(this.tmp).setY(0).normalize();
    const hs = Math.hypot(v.x, v.z);
    if (hs < 9) v.addScaledVector(fwd, 6 * dt);
    this.burst(dt * 90);
    const feet = pl.feet(this.tmp);
    g.lights.add(feet, ORANGE, 14, 9);
    g.hands.glow(ORANGE, 1);
    g.rig.shake(dt * 0.8);
    // Heat what's below.
    const gy = g.world.heightAt(feet.x, feet.z);
    if (feet.y - gy < 3 && Math.random() < dt * 4) g.reactions.applyArea('fire', TMP.set(feet.x, gy + 0.5, feet.z), 2, 0.4);
  }

  protected end() {
    this.roar?.stop(0.3);
    this.roar = null;
    pose(this.game, 'rest', 'rest');
  }

  update() {
    if (this.game.player.grounded) this.airBursts = 0;
  }
}

/**
 * FIRE (key 2): offensive, area denial and fire-propelled traversal.
 */
export class FirePower extends Power {
  readonly id = 'fire';
  readonly name = 'Fire';
  readonly color = '#ff7a2f';
  readonly icon = ICONS.fire;
  readonly abilities = [new Fireball(), new Flamethrower(), new FlameWall(), new FireThrust(), new BlazingFist(), new MeteorDive()];
  private tmp = new THREE.Vector3();

  /** Idle: tiny flames dance on the fingertips. */
  update(dt: number) {
    const g = this.game;
    if (g.rig.mode !== 'first') return;
    if (Math.random() < dt * 8) {
      const p = handPos(g, Math.random() < 0.5 ? 'left' : 'right', this.tmp);
      g.particles.emit(FX.flame, p, 1, { spread: 0.4, speed: [0.2, 0.5], sizeMul: 0.12, lifeMul: 0.6 });
    }
    g.hands.glow(ORANGE, 0.08);
  }

  /** Is a point blocked by an active flame wall? (Used by NPC pathing.) */
  blocked(p: THREE.Vector3): boolean {
    return (this.abilities[2] as FlameWall).isBlocked(p);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const NEAR: import('../../world/Entity').Entity[] = [];
