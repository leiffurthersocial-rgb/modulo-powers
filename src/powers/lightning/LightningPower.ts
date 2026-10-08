import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { audio, type LoopHandle } from '../../core/Audio';
import { FX, type ParticlePreset } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { Ability } from '../Ability';
import { aim, bothHands, handPos, pose } from '../common';
import { explosion } from '../effects';
import { Power } from '../Power';
import { Godspeed, ThunderPalm } from './extra';

const BOLT_BLUE = 0x9fd0ff;
const GLOW = 0x7fd4ff;

const RAIN: ParticlePreset = {
  blend: 'alpha',
  life: [0.7, 1.0],
  size: [0.04, 0.07],
  sizeEnd: 1,
  color0: 0xc8d8e8,
  color1: 0xa8c0d8,
  alpha: 0.55,
  fadeIn: 0.02,
  gravity: 25,
  ground: 'die',
  shape: 2,
};
const CLOUD: ParticlePreset = {
  blend: 'alpha',
  life: [3, 5],
  size: [7, 11],
  sizeEnd: 1.4,
  color0: 0x2a2d33,
  color1: 0x3c4048,
  alpha: 0.55,
  fadeIn: 0.25,
  drag: 0.5,
  turbulence: 0.8,
  shape: 1,
};

/** Strike a point with a full lightning bolt: VFX, light, thunder, reactions. */
export function strike(g: Game, from: THREE.Vector3, to: THREE.Vector3, strength: number, normal?: THREE.Vector3) {
  g.bolts.spawn(from, to, {
    width: 0.06 + strength * 0.1,
    jag: 0.12,
    detail: 7,
    forkChance: 0.18,
    life: 0.22 + strength * 0.15,
    intensity: 1.5 + strength,
    color: BOLT_BLUE,
  });
  // A thinner second channel for a more natural look.
  g.bolts.spawn(from, to, { width: 0.025, jag: 0.16, detail: 6, forkChance: 0.1, life: 0.12, intensity: 1, color: 0xd8ecff });
  g.lights.add(to, GLOW, 80 + strength * 120, 25 + strength * 15);
  g.lights.add(TMP.copy(from).lerp(to, 0.5), GLOW, 40, 30);
  const camD = g.camera.position.distanceTo(to);
  g.rig.addFlash(Math.min(0.6, (0.25 + strength * 0.35) * Math.max(0.3, 1 - camD / 150)));
  g.rig.shake(Math.min(0.5, (0.15 + strength * 0.3) * Math.max(0.2, 1 - camD / 80)));
  audio.thunder(to, 0.6 + strength * 0.5);
  audio.crackle(to, 1);
  g.particles.emit(FX.electric, to, 30 + strength * 30, { spread: Math.PI, speed: [2, 9] });
  g.particles.emit(FX.spark, to, 20 + strength * 20, { spread: Math.PI * 0.6, dir: normal ?? UP, speed: [3, 10] });
  g.particles.emit(FX.smoke, to, 4 + strength * 4, { spread: 0.6, speed: [0.5, 1.5], sizeMul: 0.7 });
  explosion(g, to, {
    radius: 1.6 + strength * 2.4,
    impulse: 60 + strength * 220,
    element: 'lightning',
    amount: 0.8 + strength * 1.2,
    damage: 25 + strength * 70,
    playerPush: 4 + strength * 4,
    decal: 'scorch',
    look: 'electric',
    normal,
    sound: false,
  });
}

// -----------------------------------------------------------------------------
// Z — Bolt Strike (charge)
// -----------------------------------------------------------------------------
class BoltStrike extends Ability {
  readonly name = 'Bolt Strike';
  readonly description = 'Hold to charge, release to call a forked bolt at the crosshair. Ignites wood, shatters brittle things, charges metal, electrifies water.';
  icon = ICONS.bolt;
  mode = 'charge' as const;
  cost = 24;
  cooldown = 0.6;
  chargeTime = 1.3;
  private hum: LoopHandle | null = null;
  private arcTimer = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  protected start() {
    pose(this.game, 'charge', 'charge');
    this.hum = audio.loop({ freq: 180, filter: 'bandpass', q: 3, volume: 0.6, lfo: { rate: 30, depth: 0.3 } });
    this.hum.setLevel(0.3);
    return true;
  }

  protected sustain(dt: number) {
    const g = this.game;
    const c = this.charge;
    handPos(g, 'left', this.a);
    handPos(g, 'right', this.b);
    this.arcTimer -= dt;
    if (this.arcTimer <= 0) {
      this.arcTimer = 0.07 - c * 0.04;
      g.bolts.spawn(this.a, this.b, { width: 0.008 + c * 0.012, jag: 0.3, detail: 4, life: 0.08, intensity: 0.8 + c, forkChance: 0.2 });
      if (Math.random() < 0.4) audio.crackle(this.b, 0.1 + c * 0.2);
    }
    const mid = this.a.lerp(this.b, 0.5);
    g.particles.emit(FX.electric, mid, dt * (20 + c * 60), { spread: Math.PI, speed: [0.3, 1.5], jitter: 0.05 });
    g.hands.glow(GLOW, 0.3 + c * 0.9);
    g.lights.add(mid, GLOW, 3 + c * 8, 4 + c * 2);
    this.hum?.setLevel(0.3 + c * 0.7);
    this.hum?.setRate(0.7 + c * 0.8);
  }

  protected end(charge: number) {
    this.hum?.stop(0.05);
    this.hum = null;
    if (charge < 0) {
      pose(this.game, 'rest', 'rest');
      return;
    }
    const g = this.game;
    pose(g, 'rest', 'cast');
    setTimeout(() => pose(g, 'rest', 'rest'), 200);
    const t = aim(g, 140, { water: true });
    const from = bothHands(g, new THREE.Vector3());
    strike(g, from, t.point, charge, t.normal);
    if (t.water) g.water.electrify(t.water, 3 + charge * 5, t.point);
    g.hands.kick('both', 0.12 + charge * 0.1);
    g.rig.fovPunch(2 + charge * 3);
  }
}

// -----------------------------------------------------------------------------
// X — Chain Lightning (tap)
// -----------------------------------------------------------------------------
interface ChainStep {
  at: number;
  from: THREE.Vector3;
  to: Entity | null;
  point: THREE.Vector3;
}

class ChainLightning extends Ability {
  readonly name = 'Chain Lightning';
  readonly description = 'An arc that leaps between conductive objects, wet things, water and targets (up to 6 jumps), electrifying everything it touches.';
  icon = ICONS.chain;
  cost = 26;
  cooldown = 1.2;
  private queue: ChainStep[] = [];
  private clock = 0;

  /** Is this entity something lightning wants to jump to? */
  private attractive(e: Entity): number {
    if (e.dead) return 0;
    if (e.conductive) return 3;
    if (e.tags.has('organic') || e.tags.has('machine')) return 2;
    if (e.wetness > 0.2) return 2;
    return 0;
  }

  protected start() {
    const g = this.game;
    const t = aim(g, 40, { water: true });
    const hand = handPos(g, 'right', new THREE.Vector3());
    // Pick the first target: what we're aiming at, or the best candidate near the aim line.
    let first: Entity | null = t.entity && this.attractive(t.entity) > 0 ? t.entity : null;
    if (!first) {
      let best = 0;
      for (const e of g.entities.nearby(t.origin, 40, NEAR)) {
        const a = this.attractive(e);
        if (!a) continue;
        const to = e.center(TMP).sub(t.origin);
        const d = to.length();
        const cos = to.dot(t.dir) / d;
        if (cos < 0.93) continue;
        const score = a * cos * cos / (1 + d * 0.05);
        if (score > best) {
          best = score;
          first = e;
        }
      }
    }
    this.clock = 0;
    this.queue.length = 0;
    pose(g, 'rest', 'cast');
    setTimeout(() => pose(g, 'rest', 'rest'), 250);
    g.hands.kick('right', 0.1);
    if (!first) {
      // No target: a short arc to whatever is under the crosshair.
      const end = t.hit && t.distance < 18 ? t.point : t.origin.clone().addScaledVector(t.dir, 12);
      g.electricity.arc(hand, end, 1);
      if (t.water) g.water.electrify(t.water, 3, end);
      if (t.hit) g.reactions.applyArea('lightning', end, 1.2, 0.5);
      return true;
    }
    const visited = new Set<Entity>([first]);
    let prev = hand.clone();
    let cur: Entity | null = first;
    let at = 0;
    for (let jump = 0; jump < 6 && cur; jump++) {
      const p = cur.center(new THREE.Vector3());
      this.queue.push({ at, from: prev, to: cur, point: p });
      prev = p;
      at += 0.07;
      // Next: closest attractive unvisited entity within reach.
      let next: Entity | null = null;
      let best = Infinity;
      for (const e of g.entities.nearby(p, 9, NEAR)) {
        if (visited.has(e)) continue;
        const a = this.attractive(e);
        if (!a) continue;
        const d = e.center(TMP).distanceTo(p) / a;
        if (d < best) {
          best = d;
          next = e;
        }
      }
      if (next) visited.add(next);
      cur = next;
    }
    audio.crackle(hand, 1);
    audio.noiseBurst({ pos: hand, volume: 0.5, decay: 0.15, filter: 'highpass', freq: 1500 });
    return true;
  }

  update(dt: number) {
    if (this.queue.length === 0 || dt <= 0) return;
    this.clock += dt;
    const g = this.game;
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const s = this.queue.shift()!;
      const p = s.to && !s.to.dead ? s.to.center(new THREE.Vector3()) : s.point;
      g.bolts.spawn(s.from, p, { width: 0.05, jag: 0.2, detail: 6, life: 0.3, intensity: 1.6, forkChance: 0.15, regen: 0.05 });
      g.lights.add(p, GLOW, 30, 14);
      g.particles.emit(FX.electric, p, 25, { spread: Math.PI, speed: [1, 6] });
      audio.crackle(p, 0.8);
      if (s.to && !s.to.dead) {
        g.reactions.apply(s.to, 'lightning', 0.7, s.from);
        s.to.charge = Math.min(1, s.to.charge + 0.6);
        if (s.to.isDynamic) {
          const dir = TMP.copy(p).sub(s.from).normalize().multiplyScalar(40);
          s.to.applyImpulse(dir.x, 25, dir.z);
        }
        const body = g.water.bodyAt(p, s.to.radius + 0.3);
        if (body) g.water.electrify(body, 3, p);
      }
    }
  }

  reset() {
    super.reset();
    this.queue.length = 0;
  }
}

// -----------------------------------------------------------------------------
// C — Lightning Step (tap): blink-dash
// -----------------------------------------------------------------------------
interface Afterimage {
  mesh: THREE.Mesh;
  age: number;
}

interface StaticField {
  pos: THREE.Vector3;
  age: number;
}

class LightningStep extends Ability {
  readonly name = 'Lightning Step';
  readonly description = 'A lightning-fast dash (works in mid-air for crossing gaps) that leaves electric afterimages and static that stuns targets.';
  icon = ICONS.dash;
  cost = 16;
  cooldown = 0.8;
  private dashing = 0;
  private dir = new THREE.Vector3();
  private last = new THREE.Vector3();
  private images: Afterimage[] = [];
  private fields: StaticField[] = [];
  private ghostGeo!: THREE.CapsuleGeometry;
  private ghostMat!: THREE.MeshBasicMaterial;
  private fieldTimer = 0;

  protected init() {
    this.ghostGeo = new THREE.CapsuleGeometry(0.33, 1.1, 4, 10);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x6fc4ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  protected start() {
    const g = this.game;
    const inp = g.input;
    // Dash in the movement direction if moving, else where we look.
    const yaw = g.rig.yaw;
    const mx = inp.axis('left', 'right');
    const mz = inp.axis('back', 'forward');
    if (mx || mz) this.dir.set(mx * Math.cos(yaw) - mz * Math.sin(yaw), 0, -mx * Math.sin(yaw) - mz * Math.cos(yaw)).normalize();
    else g.rig.aimDirection(this.dir).setY(0).normalize();
    this.dashing = 0.13;
    this.last.copy(g.player.curPos);
    g.player.noGravity = true;
    g.rig.fovPunch(12);
    g.rig.shake(0.1);
    audio.crackle(g.player.curPos, 1);
    audio.whoosh(g.player.curPos, 1, 2);
    audio.noiseBurst({ volume: 0.4, decay: 0.2, filter: 'bandpass', freq: 3000, freqEnd: 800, q: 2 });
    pose(g, 'down', 'down');
    return true;
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    const pl = g.player;
    if (this.dashing > 0) {
      this.dashing -= dt;
      const speed = 72;
      pl.velocity.set(this.dir.x * speed, 0, this.dir.z * speed);
      pl.thrust(TMP.set(0, 0.001, 0));
      if (this.dashing <= 0) {
        pl.noGravity = false;
        pl.velocity.set(this.dir.x * 9, Math.max(0, pl.velocity.y) + 1.5, this.dir.z * 9);
        pose(g, 'rest', 'rest');
      }
    }
    // Static fields stun anything that walks into them.
    this.fieldTimer -= dt;
    if (this.fieldTimer <= 0 && this.fields.length) {
      this.fieldTimer = 0.25;
      for (const f of this.fields) {
        for (const e of g.entities.nearby(f.pos, 1.3, NEAR)) {
          if (e.tags.has('organic')) {
            g.reactions.apply(e, 'lightning', 0.2, f.pos);
            e.stun = Math.max(e.stun, 2);
          }
        }
      }
    }
  }

  update(dt: number) {
    const g = this.game;
    if (dt <= 0) return;
    if (this.dashing > 0) {
      const p = g.player.renderPos;
      // Arcs + afterimages along the path.
      if (p.distanceTo(this.last) > 1.2) {
        g.bolts.spawn(this.last, p, { width: 0.05, jag: 0.25, detail: 5, life: 0.35, intensity: 1.4, forkChance: 0.25 });
        const m = new THREE.Mesh(this.ghostGeo, this.ghostMat.clone());
        m.position.copy(p);
        m.renderOrder = 9;
        g.scene.add(m);
        this.images.push({ mesh: m, age: 0 });
        this.fields.push({ pos: g.player.feet(new THREE.Vector3()).setY(p.y - 0.6), age: 0 });
        this.last.copy(p);
      }
      g.particles.emit(FX.electric, p, dt * 200, { spread: Math.PI, speed: [1, 4], jitter: 0.4 });
      g.lights.add(p, GLOW, 25, 10);
    }
    for (let i = this.images.length - 1; i >= 0; i--) {
      const im = this.images[i];
      im.age += dt;
      (im.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - im.age / 0.5);
      if (im.age > 0.5) {
        im.mesh.removeFromParent();
        (im.mesh.material as THREE.Material).dispose();
        this.images.splice(i, 1);
      }
    }
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      f.age += dt;
      if (Math.random() < dt * 8) {
        const a = TMP.copy(f.pos).add(TMP2.set(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5));
        g.bolts.spawn(f.pos, a, { width: 0.015, detail: 3, life: 0.08, intensity: 0.8 });
        g.particles.emit(FX.electric, a, 2, { spread: Math.PI, speed: [0.5, 2] });
      }
      if (f.age > 2.5) this.fields.splice(i, 1);
    }
  }

  cancel() {
    super.cancel();
    if (this.dashing > 0) {
      this.dashing = 0;
      this.game.player.noGravity = false;
    }
  }

  reset() {
    super.reset();
    this.cancel();
    for (const im of this.images) im.mesh.removeFromParent();
    this.images.length = 0;
    this.fields.length = 0;
  }
}

// -----------------------------------------------------------------------------
// B — Storm Call (tap)
// -----------------------------------------------------------------------------
class StormCall extends Ability {
  readonly name = 'Storm Call';
  readonly description = 'Summon a localized storm at the aim point: dark clouds, rain, and repeated strikes (drawn to metal, rods and machines).';
  icon = ICONS.storm;
  cost = 55;
  cooldown = 10;
  private storm: { pos: THREE.Vector3; t: number; next: number } | null = null;
  private rain: LoopHandle | null = null;
  private near: Entity[] = [];

  protected start() {
    const g = this.game;
    const t = aim(g, 90, { water: true });
    const pos = t.point.clone();
    if (!t.hit) pos.y = g.world.heightAt(pos.x, pos.z);
    this.storm = { pos, t: 0, next: 1.2 };
    g.env.setStorm(1);
    pose(g, 'raise', 'raise');
    setTimeout(() => pose(g, 'rest', 'rest'), 600);
    audio.rumble(pos, 0.8, 2.5);
    this.rain = audio.loop({ freq: 3000, filter: 'lowpass', volume: 0.9, bus: 'ambient' });
    this.rain.setLevel(0.1, 1);
    return true;
  }

  update(dt: number) {
    const s = this.storm;
    if (!s || dt <= 0) return;
    const g = this.game;
    s.t += dt;
    const dur = 9;
    const k = s.t < 1 ? s.t : s.t > dur - 1.5 ? Math.max(0, (dur - s.t) / 1.5) : 1;
    // Clouds and rain.
    const top = TMP.copy(s.pos).setY(s.pos.y + 26);
    g.particles.emit(CLOUD, top, dt * 6 * k, { spread: 1.4, speed: [0.2, 0.8], jitter: 12 });
    const rainArea = 14;
    for (let i = 0; i < 2; i++) {
      const rp = TMP2.set(s.pos.x + (Math.random() - 0.5) * rainArea * 2, s.pos.y + 16, s.pos.z + (Math.random() - 0.5) * rainArea * 2);
      g.particles.emit(RAIN, rp, dt * 160 * k, { dir: DOWN, spread: 0.05, speed: [12, 16], jitter: rainArea * 0.5 });
    }
    // Rain level by distance to the storm.
    const d = g.camera.position.distanceTo(s.pos);
    this.rain?.setLevel(k * Math.max(0.15, 1 - d / 60));
    // Lightning strikes.
    s.next -= dt;
    if (s.next <= 0 && s.t < dur - 1) {
      s.next = 0.5 + Math.random() * 0.8;
      this.strikeOnce(s.pos);
    }
    if (s.t >= dur) this.stop();
  }

  fixedUpdate() {
    const s = this.storm;
    if (!s) return;
    const g = this.game;
    // Everything under the storm gets soaked and grass fires go out.
    if (Math.random() < 0.1) {
      for (const e of g.entities.nearby(s.pos, 14, this.near)) g.reactions.apply(e, 'water', 0.1, s.pos);
      g.fire.extinguishGround(s.pos, 12);
    }
  }

  private strikeOnce(center: THREE.Vector3) {
    const g = this.game;
    // Prefer tall conductive things / machines / rods inside the storm.
    let target: THREE.Vector3 | null = null;
    let best = 0;
    for (const e of g.entities.nearby(center, 13, this.near)) {
      const score = (e.tags.has('rod') ? 6 : 0) + (e.tags.has('machine') ? 3 : 0) + (e.conductive ? 2 : 0) + (e.tags.has('organic') ? 1 : 0);
      if (score <= 0) continue;
      const r = score * Math.random();
      if (r > best) {
        best = r;
        target = e.center(new THREE.Vector3());
        if (e.tags.has('rod')) target.y += e.radius;
      }
    }
    if (!target || Math.random() < 0.35) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 11;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const body = g.water.bodyUnder(x, z);
      target = new THREE.Vector3(x, body ? body.level : g.world.heightAt(x, z), z);
      if (body) g.water.electrify(body, 4, target);
    }
    const from = target.clone().add(TMP.set((Math.random() - 0.5) * 8, 30, (Math.random() - 0.5) * 8));
    strike(g, from, target, 0.8);
    g.reactions.applySurfaces('lightning', target, 2, 1);
  }

  private stop() {
    this.storm = null;
    this.game.env.setStorm(0);
    this.rain?.stop(1.5);
    this.rain = null;
  }

  reset() {
    super.reset();
    if (this.storm) this.stop();
  }
}

/**
 * LIGHTNING (key 1): precision strikes, chaining through conductors,
 * blink-dashing, and calling down storms. Powers machines and electrifies water.
 */
export class LightningPower extends Power {
  readonly id = 'lightning';
  readonly name = 'Lightning';
  readonly color = '#7fd4ff';
  readonly icon = ICONS.lightning;
  readonly abilities = [new BoltStrike(), new ChainLightning(), new LightningStep(), new StormCall(), new ThunderPalm(), new Godspeed()];
  private t = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  /** Idle: occasional sparks jump between the fingers. */
  update(dt: number) {
    const g = this.game;
    if (g.rig.mode !== 'first') return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.4 + Math.random() * 1.2;
      const side = Math.random() < 0.5 ? 'left' : 'right';
      handPos(g, side, this.a);
      this.b.copy(this.a).add(TMP.set((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.08));
      g.bolts.spawn(this.a, this.b, { width: 0.004, detail: 3, life: 0.06, intensity: 0.7, jag: 0.4 });
      g.lights.add(this.a, GLOW, 0.6, 2);
    }
    g.hands.glow(GLOW, 0.05);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const NEAR: Entity[] = [];
