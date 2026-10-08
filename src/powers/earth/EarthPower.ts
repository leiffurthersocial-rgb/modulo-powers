import * as THREE from 'three';
import { audio, type LoopHandle } from '../../core/Audio';
import { G, groups } from '../../config/physics';
import { RAPIER } from '../../core/Physics';
import { FX } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { buildProp } from '../../world/props/basic';
import { cachedGeometry, mesh, texturedMaterial } from '../../world/props/assets';
import { Ability } from '../Ability';
import { aim, bothHands, handPos, pose } from '../common';
import { explosion } from '../effects';
import { Power } from '../Power';
import { RockFist, StoneSpikes } from './extra';
import type { Game } from '../../core/Game';

const EARTH = 0xc08a4a;
const PILLAR_RADIUS = 0.95;

// -----------------------------------------------------------------------------
// Pillars (shared by Raise Pillar; an entity with a kinematic rising body)
// -----------------------------------------------------------------------------
function registerPillar(game: Game) {
  game.entities.registerFactory('pillar', (s, em) => {
    const h = s.h ?? 4;
    const riseTime = (s.data?.riseTime as number) ?? 0.5;
    const geo = cachedGeometry('pillar', () => {
      const g = new THREE.CylinderGeometry(PILLAR_RADIUS * 0.92, PILLAR_RADIUS, 1, 6, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const n = 1 + Math.sin(a * 3 + y * 5) * 0.04 + Math.sin(y * 13 + a) * 0.03;
        p.setX(i, p.getX(i) * n);
        p.setZ(i, p.getZ(i) * n);
        if (y > 0.49) p.setY(i, y + Math.sin(a * 2) * 0.03);
      }
      g.computeVertexNormals();
      return g;
    });
    const m = mesh(geo, texturedMaterial('stone', { color: 0xa0846a, key: 'pillarStone' }));
    m.scale.set(1, h, 1);
    const group = new THREE.Group();
    group.add(m);
    const ground = s.y;
    const startY = ground - h / 2 - 0.15;
    const endY = ground + h / 2;
    const e = buildProp(em, { ...s, y: startY }, 'pillar', {
      material: 'stone',
      object: group,
      kinematic: true,
      colliders: [RAPIER.ColliderDesc.cylinder(h / 2, PILLAR_RADIUS * 0.95)],
      radius: Math.max(PILLAR_RADIUS, h / 2),
      volume: Math.PI * PILLAR_RADIUS * PILLAR_RADIUS * h,
      group: G.STATIC,
    });
    for (const c of e.colliders) c.setCollisionGroups(groups(G.STATIC));
    e.tags.add('pillar');
    e.isStatic = true;
    let t = 0;
    let life = 0;
    let sinking = false;
    let prevTop = startY + h / 2;
    const tmp = new THREE.Vector3();
    em.physics.sync(e.body!, e.object);
    e.update = (dt) => {
      const g = game;
      const body = e.body;
      if (!body) return;
      life += dt;
      let y: number;
      if (sinking) {
        t -= dt / 1.2;
        y = startY + (endY - startY) * Math.max(0, t);
        if (t <= 0) {
          em.remove(e);
          return;
        }
      } else if (t < 1) {
        t = Math.min(1, t + dt / riseTime);
        // Ease out, except for fast "launcher" pillars which stop dead.
        const k = riseTime < 0.25 ? t : 1 - (1 - t) * (1 - t);
        y = startY + (endY - startY) * k;
        if (Math.random() < 0.6) {
          g.particles.emit(FX.dust, tmp.set(s.x, ground, s.z), 2, { spread: 1.3, speed: [1, 3], jitter: 0.8 });
          g.particles.emit(FX.debris, tmp, 1, { spread: 0.8, speed: [2, 5], jitter: 0.6 });
        }
      } else {
        y = endY;
        if (life > 28) sinking = true;
      }
      body.setNextKinematicTranslation({ x: s.x, y, z: s.z });
      const top = y + h / 2;
      const rise = (top - prevTop) / Math.max(dt, 1e-4);
      // Carry the player standing on (or inside) the column.
      const pl = g.player;
      const feet = pl.curPos.y - pl.halfHeight - 0.35;
      const dx = pl.curPos.x - s.x;
      const dz = pl.curPos.z - s.z;
      const inside = dx * dx + dz * dz < (PILLAR_RADIUS + 0.3) ** 2;
      if (inside && feet < top + 0.1 && feet > prevTop - 1.2 && rise > 0) {
        pl.moveCenter(pl.curPos.x, top + pl.halfHeight + 0.35 + 0.02, pl.curPos.z);
        if (t >= 1 && riseTime < 0.25) {
          pl.thrust(tmp.set(0, Math.min(16, rise * 0.9), 0));
        } else if (pl.velocity.y < rise) pl.velocity.y = 0;
      }
      // Fast pillars fling props resting on them.
      if (t >= 1 && rise > 6) {
        for (const o of g.entities.nearby(tmp.set(s.x, top + 0.5, s.z), PILLAR_RADIUS + 0.6, NEAR)) {
          if (o.isDynamic) o.applyImpulse(0, o.mass * Math.min(14, rise * 0.8), 0);
        }
      }
      prevTop = top;
    };
    return e;
  });
}

class RaisePillar extends Ability {
  readonly name = 'Raise Pillar';
  readonly description = 'Hold to charge, release to raise a rock column at the aim point: a stepping stone, a lift, or (fully charged) a launcher.';
  icon = ICONS.pillar;
  mode = 'charge' as const;
  cost = 18;
  cooldown = 0.5;
  chargeTime = 1.0;
  private marker!: THREE.Mesh;
  private pillars: Entity[] = [];

  protected init() {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(PILLAR_RADIUS * 0.8, PILLAR_RADIUS, 6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: EARTH, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.marker.visible = false;
    this.game.scene.add(this.marker);
  }

  private target() {
    const t = aim(this.game, 34, { water: true });
    return t.hit && (t.normal.y > 0.45 || t.water) ? t : null;
  }

  protected start() {
    pose(this.game, 'down', 'down');
    return true;
  }

  protected sustain() {
    const g = this.game;
    const t = this.target();
    this.marker.visible = !!t;
    if (t) {
      this.marker.position.copy(t.point).addScaledVector(t.normal, 0.05);
      this.marker.scale.setScalar(1 + this.charge * 0.3);
      if (Math.random() < 0.3) g.particles.emit(FX.dust, t.point, 1, { spread: 1, speed: [0.3, 1], sizeMul: 0.5 });
    }
    g.hands.glow(EARTH, 0.2 + this.charge * 0.4);
  }

  protected end(charge: number) {
    this.marker.visible = false;
    pose(this.game, 'raise', 'raise');
    const g = this.game;
    setTimeout(() => pose(g, 'rest', 'rest'), 300);
    if (charge < 0) return;
    const t = this.target();
    if (!t) {
      g.energy.refund(this.cost * 0.5);
      return;
    }
    const groundY = t.water ? g.world.heightAt(t.point.x, t.point.z) : t.point.y;
    // Raising rock from far below (e.g. a canyon floor) makes a taller column
    // so you can build a way across.
    const below = Math.max(0, g.player.feet(TMP).y - groundY);
    const height = Math.min(16, 2 + charge * 5 + below * 0.85);
    const riseTime = charge > 0.85 ? 0.16 : 0.55 - charge * 0.2 + below * 0.03;
    const [e] = g.entities.spawn({ type: 'pillar', x: t.point.x, y: groundY, z: t.point.z, h: t.water ? height + (t.point.y - groundY) : height, ry: Math.random() * Math.PI, data: { riseTime } });
    this.pillars.push(e);
    while (this.pillars.length > 12) {
      const old = this.pillars.shift()!;
      if (!old.dead) g.destruction.shatter(old);
    }
    audio.rumble(t.point, 0.6 + charge * 0.6, 0.6 + charge * 0.4);
    audio.impact(t.point, 0.8, 'stone');
    g.rig.shake(0.15 + charge * 0.2);
    g.decals.add('crack', t.point, t.normal, 2.5 + charge, 40);
    g.reactions.applyArea('earth', t.point, 2, 0.6, { impulse: 50 });
    if (t.water) g.particles.emit(FX.splash, t.point, 30, { spread: 1, speed: [2, 5] });
  }

  reset() {
    super.reset();
    this.pillars.length = 0;
    this.marker.visible = false;
  }
}

// -----------------------------------------------------------------------------
// X — Boulder Pull & Throw
// -----------------------------------------------------------------------------
class BoulderThrow extends Ability {
  readonly name = 'Boulder Throw';
  readonly description = 'Rip a boulder out of the ground (or grab a prop) and hold it with telekinesis; press again to hurl it. Heavy things fly slower; boulders shatter on hard impacts.';
  icon = ICONS.boulder;
  cost = 20;
  cooldown = 0.6;
  held: Entity | null = null;
  private thrown: { e: Entity; speed: number; age: number }[] = [];
  private loop: LoopHandle | null = null;
  private tmp = new THREE.Vector3();
  private hold = new THREE.Vector3();

  protected start() {
    const g = this.game;
    if (this.held) {
      this.throwHeld();
      return true;
    }
    const t = aim(g, 28, { water: true });
    if (!t.hit) return false;
    let e: Entity | null = null;
    if (t.entity && t.entity.isDynamic && t.entity.mass < 6000 && t.entity.type !== 'dummy') {
      e = t.entity; // telekinesis on an existing prop
    } else if (t.normal.y > 0.4 || t.water) {
      // Rip a boulder out of the ground, leaving a hole.
      const p = t.water ? new THREE.Vector3(t.point.x, g.world.heightAt(t.point.x, t.point.z), t.point.z) : t.point;
      const r = 0.65 + Math.random() * 0.2;
      [e] = g.entities.spawn({ type: 'boulder', x: p.x, y: p.y - 0.2, z: p.z, w: r });
      g.decals.add('crack', p, t.normal, 3, 60);
      g.decals.add('mud', p, t.normal, 1.8, 60, 0.9);
      g.particles.emit(FX.dust, p, 25, { spread: 1, speed: [1, 4], jitter: 0.6 });
      g.particles.emit(FX.debris, p, 30, { spread: 0.9, speed: [3, 7], jitter: 0.5 });
      audio.rumble(p, 0.7, 0.8);
      g.rig.shake(0.15);
      if (t.water) g.reactions.applySurfaces('earth', t.point, 2, 1);
    }
    if (!e || !e.body) return false;
    this.held = e;
    e.body.setGravityScale(0, true);
    e.body.setLinearDamping(4);
    e.body.setAngularDamping(3);
    pose(g, 'grip', 'grip');
    this.loop = audio.loop({ freq: 140, filter: 'lowpass', brown: true, volume: 1, lfo: { rate: 3, depth: 0.3 } });
    this.loop.setLevel(0.5);
    // Grabbing is cheap, throwing costs the rest.
    this.cooldownLeft = 0;
    return true;
  }

  private throwHeld() {
    const g = this.game;
    const e = this.held;
    this.held = null;
    this.loop?.stop(0.2);
    this.loop = null;
    if (!e || e.dead || !e.body) return;
    e.body.setGravityScale(1, true);
    e.body.setLinearDamping(0.05);
    e.body.setAngularDamping(0.3);
    const t = aim(g, 200);
    const from = e.center(this.tmp);
    const dir = t.point.clone().sub(from).normalize();
    // Real mass: the same throw force makes heavy things slower.
    const speed = THREE.MathUtils.clamp(48000 / Math.max(50, e.mass), 14, 34);
    e.body.setLinvel({ x: dir.x * speed, y: dir.y * speed + 2, z: dir.z * speed }, true);
    e.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
    this.thrown.push({ e, speed, age: 0 });
    pose(g, 'push', 'push');
    setTimeout(() => pose(g, 'rest', 'rest'), 300);
    g.hands.kick('both', 0.15);
    g.rig.shake(0.15);
    g.rig.fovPunch(4);
    audio.whoosh(from, 1, 0.5);
    // Reaction: the throw pushes the player back a little.
    g.player.thrust(TMP.copy(dir).multiplyScalar(-Math.min(3, e.mass / 600)).setY(0));
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    const e = this.held;
    if (e) {
      if (e.dead || !e.body) {
        this.drop();
      } else {
        // Hover point in front of the camera.
        const dir = g.rig.aimDirection(TMP);
        this.hold.copy(g.camera.position).addScaledVector(dir, 2.6 + e.radius).addScaledVector(g.rig.right, 0.4);
        this.hold.y += 0.2 + Math.sin(performance.now() * 0.004) * 0.08;
        const c = e.center(this.tmp);
        const v = this.hold.sub(c).multiplyScalar(10);
        if (v.length() > 25) v.setLength(25);
        e.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
        if (!g.energy.drain(4 * dt)) this.drop();
      }
    }
    // Thrown boulders shatter on hard impacts.
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const th = this.thrown[i];
      th.age += dt;
      if (th.e.dead || !th.e.body || th.age > 6) {
        this.thrown.splice(i, 1);
        continue;
      }
      const v = th.e.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (th.age > 0.05 && th.speed > 10 && sp < th.speed * 0.45) {
        this.thrown.splice(i, 1);
        const c = th.e.center(new THREE.Vector3());
        explosion(g, c, { radius: 2.5 + th.e.radius, impulse: th.e.mass * 0.25, element: 'earth', amount: 1.2, damage: 60, playerPush: 6, decal: 'crack', look: 'dust' });
        if (th.e.type === 'boulder' || th.e.mat.brittle) g.destruction.shatter(th.e, c);
        else audio.impact(c, 1, th.e.mat.sound);
        if (g.water.bodyAt(c, 1)) g.reactions.applySurfaces('earth', c, 2, 1);
      } else {
        th.speed = Math.max(th.speed * 0.98, sp);
        // Trailing dust.
        if (Math.random() < 0.5) g.particles.emit(FX.dust, th.e.center(this.tmp), 1, { spread: Math.PI, speed: [0, 0.5], sizeMul: 0.5 });
      }
    }
  }

  update(dt: number) {
    const e = this.held;
    if (!e || e.dead || dt <= 0) return;
    const g = this.game;
    const c = e.center(this.tmp);
    if (Math.random() < dt * 20) g.particles.emit(FX.debris, c, 1, { spread: Math.PI, speed: [0.2, 1], jitter: e.radius });
    if (Math.random() < dt * 6) g.particles.emit(FX.dust, c, 1, { spread: Math.PI, speed: [0.1, 0.4], jitter: e.radius, sizeMul: 0.5 });
    g.hands.glow(EARTH, 0.4);
    const mid = bothHands(g, TMP);
    if (Math.random() < dt * 10) g.particles.emit(FX.dust, mid, 1, { dir: TMP2.copy(c).sub(mid).normalize(), spread: 0.2, speed: [3, 5], sizeMul: 0.2 });
    this.loop?.setPosition(c.x, c.y, c.z);
  }

  drop() {
    const e = this.held;
    this.held = null;
    this.loop?.stop(0.2);
    this.loop = null;
    pose(this.game, 'rest', 'rest');
    if (e && !e.dead && e.body) {
      e.body.setGravityScale(1, true);
      e.body.setLinearDamping(0.05);
      e.body.setAngularDamping(0.3);
    }
  }

  cancel() {
    super.cancel();
    if (this.held) this.drop();
  }

  reset() {
    super.reset();
    this.held = null;
    this.thrown.length = 0;
    this.loop?.stop(0.1);
    this.loop = null;
  }
}

// -----------------------------------------------------------------------------
// C — Earthquake / Shockwave (charge; in the air it becomes a ground pound)
// -----------------------------------------------------------------------------
interface Shockwave {
  center: THREE.Vector3;
  r: number;
  maxR: number;
  power: number;
  hit: Set<Entity>;
  lastDecal: number;
}

class Earthquake extends Ability {
  readonly name = 'Earthquake';
  readonly description = 'Hold to charge, release to slam the ground: a radial shockwave cracks the earth, launches light objects and topples stacks. In mid-air it becomes a ground pound.';
  icon = ICONS.quake;
  mode = 'charge' as const;
  cost = 38;
  cooldown = 3;
  chargeTime = 1.2;
  private waves: Shockwave[] = [];
  private pound = -1;

  protected start() {
    pose(this.game, 'raise', 'raise');
    return true;
  }

  protected sustain(dt: number) {
    const g = this.game;
    g.hands.glow(EARTH, 0.2 + this.charge * 0.5);
    g.rig.shake(dt * this.charge * 0.5);
    if (Math.random() < dt * 10 * this.charge) {
      const f = g.player.feet(TMP);
      g.particles.emit(FX.dust, f, 1, { spread: 1.4, speed: [0.5, 1.5], jitter: 1.5, sizeMul: 0.6 });
    }
  }

  protected end(charge: number) {
    const g = this.game;
    if (charge < 0) {
      pose(g, 'rest', 'rest');
      return;
    }
    pose(g, 'down', 'down');
    setTimeout(() => pose(g, 'rest', 'rest'), 400);
    if (!g.player.grounded && g.player.inWater < 0.3) {
      // Ground pound: slam down first, quake on landing.
      g.player.velocity.set(g.player.velocity.x * 0.3, -28, g.player.velocity.z * 0.3);
      this.pound = charge;
      audio.whoosh(g.player.curPos, 1, 0.4);
      return;
    }
    this.quake(charge);
  }

  private quake(charge: number) {
    const g = this.game;
    const c = g.player.feet(new THREE.Vector3());
    const power = 0.4 + charge * 0.6;
    this.waves.push({ center: c, r: 0, maxR: 7 + charge * 11, power, hit: new Set(), lastDecal: 0 });
    g.rig.shake(0.5 + charge * 0.4);
    g.rig.fovPunch(4);
    audio.rumble(c, 1.2 + charge * 0.6, 1.6 + charge);
    audio.impact(c, 1, 'stone');
    g.decals.add('crack', c, UP, 3 + charge * 3, 50);
    g.particles.emit(FX.dust, c, 30, { spread: 1.5, speed: [2, 6], jitter: 1, sizeMul: 1.3 });
    g.particles.emit(FX.debris, c, 30, { spread: 1.2, speed: [3, 8], jitter: 1 });
    g.mud.dry(c, 3);
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    if (this.pound >= 0 && g.player.grounded) {
      const p = this.pound;
      this.pound = -1;
      this.quake(Math.min(1, p + 0.3));
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const prevR = w.r;
      w.r += 18 * dt;
      const k = 1 - w.r / w.maxR;
      for (const e of g.entities.nearby(w.center, w.r + 1, NEAR)) {
        if (w.hit.has(e)) continue;
        const ec = e.center(TMP);
        const d = Math.hypot(ec.x - w.center.x, ec.z - w.center.z);
        if (d > w.r || d < prevR - 2) continue;
        if (ec.y - w.center.y > 4) continue;
        w.hit.add(e);
        g.reactions.apply(e, 'earth', 0.8 * w.power * (0.4 + k), w.center);
        if (e.isDynamic) {
          const dir = TMP2.set(ec.x - w.center.x, 0, ec.z - w.center.z).normalize();
          const m = e.mass;
          // Light things launch, heavy things lurch.
          const dv = Math.min(9, 2600 / Math.max(10, m)) * w.power * (0.35 + k);
          e.body!.applyImpulse({ x: dir.x * m * dv * 0.6, y: m * dv, z: dir.z * m * dv * 0.6 }, true);
          e.body!.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 2, y: 0, z: (Math.random() - 0.5) * m * 2 }, true);
        }
      }
      if (w.r >= w.maxR) this.waves.splice(i, 1);
    }
  }

  update(dt: number) {
    if (dt <= 0) return;
    const g = this.game;
    for (const w of this.waves) {
      // Dust ring at the wavefront.
      const n = Math.ceil(w.r * 0.8);
      for (let j = 0; j < n; j++) {
        if (Math.random() > dt * 10) continue;
        const a = Math.random() * Math.PI * 2;
        const x = w.center.x + Math.cos(a) * w.r;
        const z = w.center.z + Math.sin(a) * w.r;
        const p = TMP.set(x, g.world.heightAt(x, z), z);
        g.particles.emit(FX.dust, p, 1, { spread: 0.8, speed: [1, 3], sizeMul: 0.9 });
        g.particles.emit(FX.debris, p, 1, { spread: 0.6, speed: [2, 5] });
      }
      if (w.r - w.lastDecal > 3) {
        w.lastDecal = w.r;
        for (let j = 0; j < 4; j++) {
          const a = Math.random() * Math.PI * 2;
          const x = w.center.x + Math.cos(a) * w.r;
          const z = w.center.z + Math.sin(a) * w.r;
          g.decals.add('crack', TMP.set(x, g.world.heightAt(x, z), z), g.world.terrain.normalAt(x, z), 2 + Math.random() * 1.5, 30);
        }
      }
    }
  }

  reset() {
    super.reset();
    this.waves.length = 0;
    this.pound = -1;
  }
}

// -----------------------------------------------------------------------------
// B — Stone Armor (toggle) / Dig (crouch + B)
// -----------------------------------------------------------------------------
class StoneArmor extends Ability {
  readonly name = 'Stone Armor / Dig';
  readonly description = 'Toggle stone armour: heavy, tough, shrug off knockback and push props aside. Crouch + B to dig underground, travel, and burst out (B or Space).';
  icon = ICONS.armor;
  mode = 'toggle' as const;
  cost = 4;
  cooldown = 0.8;
  minEnergy = 8;
  private digging = 0;
  private digPos = new THREE.Vector3();
  private rumble: LoopHandle | null = null;
  private stoneHands: THREE.MeshStandardMaterial | null = null;
  private savedSkin: THREE.Material | null = null;

  press() {
    // Crouch + B while not armoured starts a dig instead of toggling armour.
    if (this.digging > 0) {
      this.burst();
      return;
    }
    if (!this.active && this.game.input.isDown('crouch') && this.game.player.grounded) {
      if (!this.ready) return;
      if (!this.game.energy.spend(15)) {
        this.game.denied(this);
        return;
      }
      this.dig();
      return;
    }
    super.press();
  }

  protected start() {
    const g = this.game;
    g.player.setModifier('armor', 0.82, 1);
    g.player.setCharacterMass(400);
    g.armored = true;
    this.setLook(true);
    audio.rumble(g.player.curPos, 0.5, 0.5);
    audio.impact(g.player.curPos, 1, 'stone');
    g.particles.emit(FX.debris, g.player.curPos, 30, { spread: Math.PI, speed: [1, 3], jitter: 0.5 });
    g.rig.shake(0.1);
    return true;
  }

  protected end() {
    const g = this.game;
    g.player.clearModifier('armor');
    g.player.setCharacterMass();
    g.armored = false;
    this.setLook(false);
    g.particles.emit(FX.dust, g.player.curPos, 15, { spread: Math.PI, speed: [1, 2], jitter: 0.5 });
    audio.shatter(g.player.curPos, 'stone', 0.4);
  }

  private setLook(on: boolean) {
    const g = this.game;
    if (!this.stoneHands) this.stoneHands = texturedMaterial('stone', { color: 0xb08a68, key: 'armorStone' });
    const skinMeshes: THREE.Mesh[] = [];
    g.hands.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) skinMeshes.push(m);
    });
    for (const m of skinMeshes) {
      if (on) {
        if (!m.userData.origMat) m.userData.origMat = m.material;
        m.material = this.stoneHands;
      } else if (m.userData.origMat) m.material = m.userData.origMat;
    }
    g.avatar.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (on) {
        if (!m.userData.origMat) m.userData.origMat = m.material;
        m.material = this.stoneHands!;
      } else if (m.userData.origMat) m.material = m.userData.origMat;
    });
    void this.savedSkin;
  }

  private dig() {
    const g = this.game;
    this.digging = 4.5;
    this.cooldownLeft = this.cooldown;
    const pl = g.player;
    pl.frozen = true;
    this.digPos.copy(pl.curPos);
    g.digging = true;
    this.rumble = audio.loop({ freq: 160, filter: 'lowpass', brown: true, volume: 1.3, lfo: { rate: 5, depth: 0.3 } });
    this.rumble.setLevel(0.8, 0.2);
    audio.rumble(pl.curPos, 0.8, 0.8);
    const f = pl.feet(TMP);
    g.particles.emit(FX.dust, f, 30, { spread: 1.4, speed: [1, 4], jitter: 0.6 });
    g.particles.emit(FX.debris, f, 30, { spread: 1, speed: [2, 6], jitter: 0.5 });
    g.decals.add('crack', f, UP, 2.5, 40);
    pose(g, 'down', 'down');
  }

  private burst() {
    const g = this.game;
    const pl = g.player;
    this.digging = 0;
    g.digging = false;
    this.rumble?.stop(0.3);
    this.rumble = null;
    const x = pl.curPos.x;
    const z = pl.curPos.z;
    const ground = new THREE.Vector3(x, g.world.heightAt(x, z) + 0.2, z);
    const spot = pl.findFreeSpot(ground, 10) ?? ground;
    pl.frozen = false;
    pl.teleport(spot);
    pl.thrust(TMP.set(0, 9, 0));
    explosion(g, spot, { radius: 3.5, impulse: 400, element: 'earth', amount: 1, damage: 30, decal: 'crack', look: 'dust' });
    g.rig.shake(0.4);
    pose(g, 'raise', 'raise');
    setTimeout(() => pose(g, 'rest', 'rest'), 400);
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    if (this.digging <= 0) return;
    this.digging -= dt;
    const pl = g.player;
    // Travel underground in the movement / look direction.
    const inp = g.input;
    const yaw = g.rig.yaw;
    const mx = inp.axis('left', 'right');
    const mz = inp.axis('back', 'forward');
    const dir = TMP.set(mx * Math.cos(yaw) - mz * Math.sin(yaw), 0, -mx * Math.sin(yaw) - mz * Math.cos(yaw));
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(9 * dt);
    const nx = pl.curPos.x + dir.x;
    const nz = pl.curPos.z + dir.z;
    const ground = g.world.heightAt(nx, nz);
    // Eye just below the surface (camera height comes from the capsule).
    pl.moveCenter(nx, ground - 0.6, nz);
    if (this.digging <= 0 || inp.wasPressed('jump') || !g.energy.drain(4 * dt)) this.burst();
  }

  update(dt: number) {
    const g = this.game;
    if (this.digging > 0 && dt > 0) {
      const x = g.player.renderPos.x;
      const z = g.player.renderPos.z;
      const p = TMP.set(x, g.world.heightAt(x, z), z);
      g.particles.emit(FX.dust, p, dt * 25, { spread: 1.2, speed: [0.5, 2], jitter: 0.6 });
      g.particles.emit(FX.debris, p, dt * 30, { spread: 0.8, speed: [1, 3], jitter: 0.5 });
      this.rumble?.setPosition(p.x, p.y, p.z);
      g.rig.shake(dt * 0.6);
    }
    if (this.active) {
      if (g.player.grounded && g.player.speed > 2 && Math.random() < dt * 3) {
        g.particles.emit(FX.dust, g.player.feet(TMP), 2, { spread: 1, speed: [0.5, 1.5], sizeMul: 0.5 });
      }
      this.meter = g.energy.fraction;
    } else this.meter = undefined;
  }

  get isDigging(): boolean {
    return this.digging > 0;
  }

  cancel() {
    // Armour persists across power switches (it's a toggle), digging does not.
    if (this.digging > 0) this.burst();
  }

  reset() {
    if (this.digging > 0) this.burst();
    if (this.active) {
      this.active = false;
      this.end();
    }
    this.cooldownLeft = 0;
  }
}

/**
 * EARTH (key 4): shaping the terrain, heavy physics and toughness.
 */
export class EarthPower extends Power {
  readonly id = 'earth';
  readonly name = 'Earth';
  readonly color = '#c08a4a';
  readonly icon = ICONS.earth;
  readonly abilities = [new RaisePillar(), new BoulderThrow(), new Earthquake(), new StoneArmor(), new RockFist(), new StoneSpikes()];
  private tmp = new THREE.Vector3();

  bind(game: Game) {
    super.bind(game);
    registerPillar(game);
  }

  onUnequip() {
    super.onUnequip();
    (this.abilities[1] as BoulderThrow).drop();
  }

  /** Idle: grit trickles from the fingers. */
  update(dt: number) {
    const g = this.game;
    if (g.rig.mode !== 'first') return;
    if (Math.random() < dt * 3) {
      g.particles.emit(FX.debris, handPos(g, Math.random() < 0.5 ? 'left' : 'right', this.tmp), 1, { spread: 0.4, speed: [0, 0.3], sizeMul: 0.3 });
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const NEAR: Entity[] = [];
