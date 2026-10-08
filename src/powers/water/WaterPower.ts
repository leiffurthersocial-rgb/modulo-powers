import * as THREE from 'three';
import { audio, type LoopHandle } from '../../core/Audio';
import { RAPIER } from '../../core/Physics';
import { FX, type ParticlePreset } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { buildProp, iceMaterial } from '../../world/props/basic';
import { cachedGeometry, mesh } from '../../world/props/assets';
import { waterNormalTexture } from '../../world/textures';
import { Ability } from '../Ability';
import { aim, handPos, pose } from '../common';
import { Power } from '../Power';
import { IceSpears, WaterWhip } from './extra';

const BLUE = 0x3fa9f5;
const ICE_BLUE = 0x9fdcff;

const STREAM: ParticlePreset = {
  blend: 'alpha',
  life: [0.5, 0.8],
  size: [0.09, 0.16],
  sizeEnd: 3.5,
  color0: 0xeef8ff,
  color1: 0x8fc4ea,
  alpha: 0.75,
  fadeIn: 0.03,
  gravity: 3,
  drag: 0.25,
  shape: 1,
};
const MIST: ParticlePreset = {
  blend: 'alpha',
  life: [0.6, 1.2],
  size: [0.3, 0.5],
  sizeEnd: 3,
  color0: 0xf4fbff,
  color1: 0xd8ecf8,
  alpha: 0.22,
  fadeIn: 0.1,
  drag: 2,
  turbulence: 2,
  shape: 1,
};
const FROST_BEAM: ParticlePreset = {
  blend: 'add',
  life: [0.35, 0.6],
  size: [0.08, 0.16],
  sizeEnd: 2.5,
  color0: 0xf0fbff,
  color1: 0x5ab4ff,
  alpha: 0.7,
  fadeIn: 0.05,
  drag: 0.8,
  turbulence: 3,
  shape: 1,
  intensity: 1.3,
};

// -----------------------------------------------------------------------------
// Z — Water Jet (hold)
// -----------------------------------------------------------------------------
class WaterJet extends Ability {
  readonly name = 'Water Jet';
  readonly description = 'Hold for a high-pressure stream that shoves props, puts out fires, soaks things (wet things conduct) and makes mud.';
  icon = ICONS.jet;
  mode = 'hold' as const;
  cost = 11;
  cooldown = 0.2;
  private loop: LoopHandle | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private surfTimer = 0;
  private hitPoint = new THREE.Vector3();
  private hasHit = false;

  protected start() {
    pose(this.game, 'rest', 'cast');
    this.loop = audio.loop({ freq: 2600, filter: 'bandpass', q: 0.6, volume: 0.9 });
    this.loop.setLevel(0.7, 0.05);
    return true;
  }

  protected sustain(dt: number) {
    const g = this.game;
    const from = handPos(g, 'right', this.tmp);
    const dir = g.rig.aimDirection(this.tmp2);
    const to = TMP.copy(from).addScaledVector(dir, 20 * dt);
    g.particles.emit(STREAM, from, dt * 260, { dir, spread: 0.025, speed: [20, 23], to, inherit: g.player.velocity });
    g.particles.emit(MIST, from, dt * 10, { dir, spread: 0.2, speed: [6, 10] });
    if (this.hasHit) {
      g.particles.emit(FX.splash, this.hitPoint, dt * 40, { spread: 1.2, speed: [1.5, 4], sizeMul: 0.8 });
      g.particles.emit(FX.droplet, this.hitPoint, dt * 60, { spread: 1.3, speed: [2, 5] });
    }
    g.hands.glow(BLUE, 0.25);
    g.hands.kick('right', dt * 0.4);
    g.rig.shake(dt * 0.25);
    // Recoil pushes the player back (and up, if aiming down in the air).
    const recoil = TMP2.copy(dir).multiplyScalar(-dt * (g.player.grounded ? 1.5 : 5));
    if (!g.player.grounded && dir.y < -0.5) recoil.y += dt * 8;
    g.player.thrust(recoil.y > 0 ? recoil : recoil.setY(0));
  }

  fixedUpdate(dt: number) {
    if (!this.active) return;
    const g = this.game;
    const hit = aim(g, 24, { water: true });
    this.hasHit = hit.hit;
    this.hitPoint.copy(hit.point);
    if (!hit.hit) return;
    const falloff = 1 - hit.distance / 26;
    const e = hit.entity;
    if (e) {
      // Pressure: a fixed force, so light props fly and heavy ones barely budge.
      if (e.isDynamic) {
        const f = 1500 * falloff * dt;
        e.body!.applyImpulseAtPoint({ x: hit.dir.x * f, y: hit.dir.y * f + f * 0.15, z: hit.dir.z * f }, hit.point, true);
      }
      g.reactions.apply(e, 'water', 2.5 * dt, hit.point);
    }
    this.surfTimer -= dt;
    if (this.surfTimer <= 0) {
      this.surfTimer = 0.15;
      g.reactions.applyArea('water', hit.point, 1.2, 0.3, { surfaces: true });
      if (!hit.water && !e && hit.normal.y > 0.5 && Math.random() < 0.3) g.decals.add('wet', hit.point, hit.normal, 1.2 + Math.random(), 30, 0.7);
    }
  }

  protected end() {
    this.loop?.stop(0.2);
    this.loop = null;
    this.hasHit = false;
    pose(this.game, 'rest', 'rest');
  }
}

// -----------------------------------------------------------------------------
// X — Tidal Wave (tap): a surging wave you can surf
// -----------------------------------------------------------------------------
interface Wave {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  side: THREE.Vector3;
  t: number;
  speed: number;
  dur: number;
  surfing: boolean;
  mesh: THREE.Mesh;
  surfTimer: number;
  loop: LoopHandle | null;
}

class TidalWave extends Ability {
  readonly name = 'Tidal Wave';
  readonly description = 'Summon a surging wave that sweeps props and targets along. You ride it — jump to get off.';
  icon = ICONS.wave;
  cost = 38;
  cooldown = 4.5;
  private waves: Wave[] = [];
  private geo!: THREE.BufferGeometry;
  private mat!: THREE.MeshStandardMaterial;
  private tmp = new THREE.Vector3();
  private near: Entity[] = [];

  protected init() {
    // A curling sheet: bent plane, 1 unit wide/high, scaled per wave.
    const g = new THREE.PlaneGeometry(1, 1, 24, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i) + 0.5; // 0..1
      const curl = Math.pow(y, 2.2) * 0.45; // leans forward at the top
      const thick = Math.sin(y * Math.PI) * 0.12;
      const edge = 1 - Math.pow(Math.abs(x * 2), 4) * 0.5;
      p.setXYZ(i, x, y * edge, curl + thick);
    }
    g.computeVertexNormals();
    // Vertex colours: deep teal body, white foam along the crest.
    const cols: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const foam = Math.min(1, Math.max(0, (y - 0.7) / 0.25));
      cols.push(0.1 + foam * 0.85, 0.42 + foam * 0.53, 0.5 + foam * 0.47);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.geo = g;
    const n = waterNormalTexture(128);
    n.wrapS = n.wrapT = THREE.RepeatWrapping;
    n.repeat.set(3, 2);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: 0.9,
      normalMap: n,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.5,
    });
  }

  protected start() {
    const g = this.game;
    const dir = g.rig.aimDirection(new THREE.Vector3()).setY(0).normalize();
    const origin = g.player.feet(new THREE.Vector3()).addScaledVector(dir, -1.2);
    const m = new THREE.Mesh(this.geo, this.mat);
    m.renderOrder = 6;
    g.scene.add(m);
    const w: Wave = {
      origin,
      dir,
      side: new THREE.Vector3(-dir.z, 0, dir.x),
      t: 0,
      speed: 11,
      dur: 2.8,
      surfing: g.player.grounded || g.player.inWater > 0,
      mesh: m,
      surfTimer: 0,
      loop: audio.loop({ freq: 900, filter: 'lowpass', brown: true, volume: 1.4, lfo: { rate: 2, depth: 0.2 } }),
    };
    w.loop?.setLevel(1, 0.1);
    this.waves.push(w);
    pose(g, 'push', 'push');
    g.hands.kick('both', 0.12);
    g.rig.shake(0.25);
    g.rig.fovPunch(5);
    audio.whoosh(origin, 1, 0.4);
    audio.rumble(origin, 0.5, 0.8);
    setTimeout(() => pose(g, 'rest', 'rest'), 300);
    return true;
  }

  private front(w: Wave, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(w.origin).addScaledVector(w.dir, w.t * w.speed);
  }

  private size(w: Wave) {
    const k = w.t / w.dur;
    const grow = Math.min(1, k * 5);
    const fade = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    return { width: 7 + k * 5, height: 2.6 * grow * fade };
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    for (const w of this.waves) {
      w.t += dt;
      const f = this.front(w, this.tmp);
      const { width, height } = this.size(w);
      const ground = g.world.heightAt(f.x, f.z);
      const body = g.water.bodyUnder(f.x, f.z);
      const base = body ? Math.max(ground, body.level) : ground;
      // Sweep entities in the band just behind the front.
      for (const e of g.entities.nearby(f, width * 0.6 + 2, this.near)) {
        if (!e.body || !e.body.isDynamic()) {
          if (e.burning) g.reactions.apply(e, 'water', 1, f);
          continue;
        }
        const c = e.center(TMP);
        const rel = TMP2.copy(c).sub(w.origin);
        const along = rel.dot(w.dir) - w.t * w.speed;
        const lat = Math.abs(rel.dot(w.side));
        if (along > 0.8 || along < -3 || lat > width / 2 || c.y > base + height + 1) continue;
        const v = e.body.linvel();
        const vAlong = v.x * w.dir.x + v.z * w.dir.z;
        const want = w.speed * 1.05 - vAlong;
        const m = e.body.mass();
        const imp = Math.min(m * want * 0.25, 5000 * dt * 4);
        e.body.applyImpulse({ x: w.dir.x * imp, y: Math.min(m * 2.5, 2500) * dt * 2, z: w.dir.z * imp }, true);
        g.reactions.apply(e, 'water', 0.15, c);
      }
      // Carry the player.
      const pl = g.player;
      if (w.surfing) {
        if (g.input.wasPressed('jump') || height < 0.3) {
          w.surfing = false;
        } else {
          const rel = TMP2.copy(pl.curPos).sub(w.origin);
          const along = rel.dot(w.dir) - w.t * w.speed;
          if (along < -6 || Math.abs(rel.dot(w.side)) > width) w.surfing = false;
          else {
            const targetFeet = base + height * 0.75;
            const feet = pl.curPos.y - pl.halfHeight - 0.35;
            pl.velocity.x = w.dir.x * w.speed + w.side.x * pl.velocity.dot(w.side);
            pl.velocity.z = w.dir.z * w.speed + w.side.z * pl.velocity.dot(w.side);
            pl.velocity.y = Math.max(-2, Math.min(6, (targetFeet - feet) * 6));
            if (pl.velocity.y > 0) pl.thrust(TMP.set(0, 0.01, 0));
          }
        }
      }
      // Douse fires and soak the ground.
      w.surfTimer -= dt;
      if (w.surfTimer <= 0) {
        w.surfTimer = 0.15;
        g.reactions.applySurfaces('water', TMP.copy(f).setY(base + 0.5), width * 0.5, 1);
        g.fire.extinguishGround(f, width * 0.6);
      }
    }
  }

  update(dt: number) {
    if (dt <= 0) return;
    const g = this.game;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      if (w.t >= w.dur) {
        const f = this.front(w, this.tmp);
        g.particles.emit(FX.splash, f, 60, { spread: 1.2, speed: [2, 6], jitter: 3, sizeMul: 1.5 });
        g.particles.emit(MIST, f, 20, { spread: 1, speed: [1, 3], jitter: 3 });
        audio.noiseBurst({ pos: f, volume: 0.8, decay: 1.2, freq: 1200, freqEnd: 300, brown: true });
        w.mesh.removeFromParent();
        w.loop?.stop(0.5);
        this.waves.splice(i, 1);
        continue;
      }
      const f = this.front(w, this.tmp);
      const { width, height } = this.size(w);
      const ground = g.world.heightAt(f.x, f.z);
      const body = g.water.bodyUnder(f.x, f.z);
      const base = body ? Math.max(ground, body.level) : ground;
      w.mesh.position.set(f.x, base - 0.2, f.z);
      w.mesh.rotation.set(0, Math.atan2(w.dir.x, w.dir.z), 0);
      w.mesh.scale.set(width, Math.max(0.01, height + 0.2), Math.max(0.5, height));
      w.loop?.setPosition(f.x, base + 1, f.z);
      // Crest foam and spray along the lip.
      const crest = TMP.copy(f).setY(base + height * 0.95).addScaledVector(w.dir, height * 0.4);
      const a = TMP2.copy(crest).addScaledVector(w.side, -width / 2);
      const b = crest.addScaledVector(w.side, width / 2);
      g.particles.emit(FX.splash, a, dt * 160 * (height / 2.6), { to: b, dir: w.dir, spread: 0.8, speed: [1, 3], sizeMul: 1.1 });
      g.particles.emit(MIST, a, dt * 30, { to: b, spread: 1, speed: [0.5, 2] });
      g.particles.emit(FX.droplet, a, dt * 80, { to: b, dir: w.dir, spread: 0.8, speed: [3, 6] });
    }
  }

  reset() {
    super.reset();
    for (const w of this.waves) {
      w.mesh.removeFromParent();
      w.loop?.stop(0.1);
    }
    this.waves.length = 0;
  }
}

// -----------------------------------------------------------------------------
// C — Freeze (hold): beam that turns water into walkable ice
// -----------------------------------------------------------------------------
class Freeze extends Ability {
  readonly name = 'Freeze';
  readonly description = 'Hold to project a freezing beam. Frozen water becomes walkable (slippery) ice; wet things and targets freeze solid.';
  icon = ICONS.snowflake;
  mode = 'hold' as const;
  cost = 12;
  cooldown = 0.3;
  private loop: LoopHandle | null = null;
  private timer = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private target = new THREE.Vector3();
  private hasTarget = false;

  protected start() {
    pose(this.game, 'cast', 'cast');
    this.loop = audio.loop({ freq: 5200, filter: 'highpass', volume: 0.5, lfo: { rate: 11, depth: 0.2 } });
    this.loop.setLevel(0.6, 0.05);
    return true;
  }

  protected sustain(dt: number) {
    const g = this.game;
    const from = handPos(g, 'right', this.tmp).add(handPos(g, 'left', this.tmp2)).multiplyScalar(0.5);
    const dir = g.rig.aimDirection(TMP);
    g.particles.emit(FROST_BEAM, from, dt * 140, { dir, spread: 0.06, speed: [16, 20], to: TMP2.copy(from).addScaledVector(dir, 18 * dt) });
    g.particles.emit(FX.frost, from, dt * 30, { dir, spread: 0.2, speed: [6, 12] });
    if (this.hasTarget) {
      g.particles.emit(FX.frost, this.target, dt * 50, { spread: Math.PI, speed: [0.5, 2], jitter: 0.5 });
      g.particles.emit(MIST, this.target, dt * 10, { spread: 1, speed: [0.2, 1] });
      g.lights.add(this.target, ICE_BLUE, 5, 6);
    }
    g.hands.glow(ICE_BLUE, 0.6);
    g.lights.add(from, ICE_BLUE, 3, 4);
  }

  fixedUpdate(dt: number) {
    if (!this.active) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const g = this.game;
    const hit = aim(g, 26, { water: true });
    this.hasTarget = hit.hit;
    this.target.copy(hit.point);
    if (!hit.hit) return;
    if (hit.water) {
      this.freezeWaterAt(hit.point);
    } else if (hit.entity) {
      g.reactions.apply(hit.entity, 'cold', 0.5, hit.point);
      if (hit.entity.frozen > 0.5 && Math.random() < 0.3) audio.tone({ pos: hit.point, volume: 0.1, freq: 2500 + Math.random() * 1500, decay: 0.15 });
    } else {
      g.reactions.applyArea('cold', hit.point, 1.5, 0.4);
      g.mud.dry(hit.point, 1.5);
      if (hit.normal.y > 0.4 && Math.random() < 0.35) g.decals.add('frost', hit.point, hit.normal, 1 + Math.random() * 1.2, 40, 0.8);
    }
  }

  /** Create an ice platform on the water surface (if there isn't one already). */
  freezeWaterAt(p: THREE.Vector3) {
    const g = this.game;
    const body = g.water.bodyUnder(p.x, p.z);
    if (!body) return;
    for (const e of g.entities.list) {
      if (e.type === 'icePlatform' && !e.dead && e.center(TMP).setY(p.y).distanceTo(p) < 1.7) {
        e.frozen = 1;
        return;
      }
    }
    g.entities.spawn({ type: 'icePlatform', x: p.x, y: body.level, z: p.z, ry: Math.random() * Math.PI });
    g.particles.emit(FX.frost, p, 30, { spread: 1.2, speed: [1, 3], jitter: 1 });
    g.particles.emit(MIST, p, 8, { spread: 1, speed: [0.5, 1.5], jitter: 1 });
    for (let i = 0; i < 3; i++) audio.tone({ pos: p, volume: 0.12, freq: 1500 + Math.random() * 2500, decay: 0.2, delay: i * 0.04 });
    audio.noiseBurst({ pos: p, volume: 0.3, decay: 0.25, filter: 'highpass', freq: 3500 });
  }

  protected end() {
    this.loop?.stop(0.2);
    this.loop = null;
    this.hasTarget = false;
    pose(this.game, 'rest', 'rest');
  }
}

// -----------------------------------------------------------------------------
// B — Hydro Shield (toggle)
// -----------------------------------------------------------------------------
const SHIELD_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  uniform float uTime;
  void main() {
    vec3 p = position;
    float wob = sin(p.x * 6.0 + uTime * 3.0) * sin(p.y * 5.0 + uTime * 2.3) * sin(p.z * 4.0 + uTime * 2.7);
    p += normal * wob * 0.035;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vP = p;
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  uniform float uTime;
  uniform float uOpacity;
  void main() {
    float f = 1.0 - abs(dot(vN, vV));
    float rim = pow(f, 2.5);
    float ripple = 0.5 + 0.5 * sin(vP.y * 18.0 - uTime * 4.0 + sin(vP.x * 9.0 + uTime));
    vec3 col = mix(vec3(0.15, 0.55, 0.8), vec3(0.85, 0.97, 1.0), rim);
    float a = (0.06 + rim * 0.55 + ripple * 0.04) * uOpacity;
    gl_FragColor = vec4(col * (1.0 + rim), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class HydroShield extends Ability {
  readonly name = 'Hydro Shield';
  readonly description = 'Toggle a water bubble: walk on water, breathe and see underwater, shrug off shocks and blasts, douse fires you touch. Crouch to dive.';
  icon = ICONS.bubble;
  mode = 'toggle' as const;
  cost = 5;
  cooldown = 0.6;
  minEnergy = 10;
  private sphere!: THREE.Mesh;
  private uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 } };
  private level = 0;
  private timer = 0;
  private near: Entity[] = [];
  private tmp = new THREE.Vector3();

  protected init() {
    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.35, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: SHIELD_VERT,
        fragmentShader: SHIELD_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.sphere.renderOrder = 8;
    this.sphere.visible = false;
    this.game.scene.add(this.sphere);
  }

  protected start() {
    const g = this.game;
    g.shielded = true;
    this.sphere.visible = true;
    audio.noiseBurst({ volume: 0.5, attack: 0.05, decay: 0.6, filter: 'bandpass', freq: 500, freqEnd: 1500, q: 1.2 });
    audio.tone({ volume: 0.15, freq: 300, freqEnd: 600, decay: 0.4, type: 'sine' });
    g.particles.emit(FX.splash, g.player.curPos, 30, { spread: Math.PI, speed: [1, 3], jitter: 1 });
    pose(g, 'raise', 'raise');
    setTimeout(() => pose(g, 'rest', 'rest'), 350);
    return true;
  }

  protected end() {
    const g = this.game;
    g.shielded = false;
    g.player.waterFloor = null;
    audio.noiseBurst({ volume: 0.4, decay: 0.4, filter: 'bandpass', freq: 1500, freqEnd: 400 });
    g.particles.emit(FX.splash, g.player.curPos, 40, { spread: Math.PI, speed: [1, 4], jitter: 1 });
  }

  fixedUpdate(dt: number) {
    const g = this.game;
    const pl = g.player;
    if (!this.active) return;
    // Water-walking: stand on the surface unless crouching (dive).
    const body = g.water.bodyUnder(pl.curPos.x, pl.curPos.z);
    if (body && !g.input.isDown('crouch')) {
      const feet = pl.curPos.y - pl.halfHeight - 0.35;
      pl.waterFloor = feet > body.level - 1.0 ? body.level : null;
    } else pl.waterFloor = null;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    // Push props away and douse anything burning nearby.
    for (const e of g.entities.nearby(pl.curPos, 1.8, this.near)) {
      if (e.burning || e.temperature > 150) g.reactions.apply(e, 'water', 0.5, pl.curPos);
      if (e.isDynamic && e.mass < 300) {
        const away = e.center(this.tmp).sub(pl.curPos).normalize().multiplyScalar(e.mass * 0.6);
        e.applyImpulse(away.x, Math.max(0, away.y), away.z);
      }
    }
    g.fire.extinguishGround(pl.curPos, 1.5);
  }

  update(dt: number) {
    const g = this.game;
    this.level += ((this.active ? 1 : 0) - this.level) * Math.min(1, dt * 6);
    this.uniforms.uOpacity.value = this.level;
    if (dt > 0) this.uniforms.uTime.value += dt;
    this.sphere.visible = this.level > 0.02;
    if (!this.sphere.visible) return;
    this.sphere.position.copy(g.player.renderPos).setY(g.player.renderPos.y + 0.1);
    this.sphere.scale.setScalar(0.6 + this.level * 0.4);
    if (this.active && g.waterRenderer.isUnderwater && Math.random() < dt * 10) {
      g.particles.emit(FX.splash, this.tmp.copy(g.player.renderPos).add(TMP.set(Math.random() - 0.5, 0.5, Math.random() - 0.5)), 1, { dir: UP, spread: 0.3, speed: [1, 2], sizeMul: 0.3 });
    }
    if (this.active && Math.random() < dt * 3) {
      g.particles.emit(FX.droplet, this.tmp.copy(g.player.renderPos).add(TMP.set(Math.random() - 0.5, 1, Math.random() - 0.5)), 1, { spread: 0.3, speed: [0, 0.5] });
    }
  }

  reset() {
    super.reset();
    this.game.shielded = false;
    this.game.player.waterFloor = null;
  }
}

/**
 * WATER (key 3): pushing, sweeping, freezing and protection.
 */
export class WaterPower extends Power {
  readonly id = 'water';
  readonly name = 'Water';
  readonly color = '#3fa9f5';
  readonly icon = ICONS.water;
  readonly abilities = [new WaterJet(), new TidalWave(), new Freeze(), new HydroShield(), new IceSpears(), new WaterWhip()];
  private tmp = new THREE.Vector3();

  bind(game: Parameters<Power['bind']>[0]) {
    super.bind(game);
    registerIcePlatform(game);
    // Freezing a water surface (from any source) makes walkable ice.
    game.reactions.registerSurfaceEffect('freezeWater', (c) => (this.abilities[2] as Freeze).freezeWaterAt(c));
  }

  /** Idle: water drips from the fingertips. */
  update(dt: number) {
    const g = this.game;
    if (g.rig.mode !== 'first') return;
    if (Math.random() < dt * 4) {
      g.particles.emit(FX.droplet, handPos(g, Math.random() < 0.5 ? 'left' : 'right', this.tmp), 1, { spread: 0.3, speed: [0, 0.3], sizeMul: 0.6 });
    }
  }
}

/** Ice platforms created by freezing water: static, slippery, meltable, shatterable. */
function registerIcePlatform(game: Parameters<Power['bind']>[0]) {
  game.entities.registerFactory('icePlatform', (s, em) => {
    const geo = cachedGeometry('icePlatform', () => {
      const g = new THREE.CylinderGeometry(1.75, 1.6, 0.36, 7);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const r = 1 + Math.sin(a * 3 + 1) * 0.06 + Math.sin(a * 5) * 0.04;
        p.setX(i, p.getX(i) * r);
        p.setZ(i, p.getZ(i) * r);
      }
      g.computeVertexNormals();
      return g;
    });
    const m = mesh(geo, iceMaterial());
    const e = buildProp(em, { ...s, y: s.y - 0.08 }, 'icePlatform', {
      material: 'ice',
      object: m,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cylinder(0.18, 1.7)],
      radius: 1.7,
      volume: 1.6,
    });
    e.tags.add('platform');
    return e;
  });
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
