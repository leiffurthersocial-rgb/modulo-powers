import * as THREE from 'three';
import { audio, type LoopHandle } from '../../core/Audio';
import type { Game } from '../../core/Game';
import { FX, type ParticlePreset } from '../../systems/Particles';
import { ICONS } from '../../ui/icons';
import type { Entity } from '../../world/Entity';
import { Ability } from '../Ability';
import { findTarget, strike } from '../combat';
import { bothHands, handPos, pose } from '../common';
import { Power } from '../Power';

const GOLD = 0xffc93a;

const AURA: ParticlePreset = {
  blend: 'add',
  life: [0.4, 0.9],
  size: [0.12, 0.3],
  sizeEnd: 0.2,
  color0: 0xfff0a0,
  color1: 0xff9a10,
  alpha: 0.7,
  fadeIn: 0.1,
  buoyancy: 2.5,
  drag: 1.5,
  turbulence: 3,
  shape: 1,
  intensity: 1.6,
};

/** A burst of raw aura: knockback, damage, golden flash. */
function auraBurst(g: Game, pos: THREE.Vector3, radius: number, damage: number, impulse: number) {
  g.reactions.applyArea('impact', pos, radius, 1, { impulse, surfaces: false });
  for (const e of g.entities.nearby(pos, radius, NEAR)) {
    if (!e.onDamage) continue;
    const d = e.center(TMP).distanceTo(pos);
    const dmg = damage * Math.max(0.3, 1 - d / radius) * g.damageBoost;
    g.reactions.damage(e, dmg, 'impact');
    g.damageNumbers.spawn(TMP.setY(TMP.y + 1), dmg, '#ffc93a');
    g.damageNumbers.hit();
  }
  g.particles.emit(AURA, pos, 40 + radius * 10, { spread: Math.PI, speed: [radius, radius * 3], sizeMul: 1.5 });
  g.particles.emit(FX.dust, pos, 10, { spread: Math.PI, speed: [1, 4] });
  g.lights.add(pos, GOLD, 30 + radius * 6, radius * 4);
  g.rig.shake(Math.min(0.6, radius * 0.08));
  audio.explosion(pos, Math.min(1.2, 0.3 + radius * 0.1));
}

// -----------------------------------------------------------------------------
// Z — Jajanken: ROCK (charge) — an enhancer's all-in punch.
// -----------------------------------------------------------------------------
class JajankenRock extends Ability {
  readonly name = 'Jajanken: Rock';
  readonly description = '"First comes rock…" — hold to pour all your aura into one fist (Ko), release to lunge and punch with devastating force.';
  icon = ICONS.rock;
  mode = 'charge' as const;
  cost = 26;
  cooldown = 0.8;
  chargeTime = 1.6;
  private hum: LoopHandle | null = null;
  private said = 0;

  protected start() {
    const g = this.game;
    pose(g, 'rest', 'grip');
    this.hum = audio.loop({ freq: 160, filter: 'lowpass', brown: true, volume: 1, lfo: { rate: 6, depth: 0.3 } });
    this.hum.setLevel(0.3);
    this.said = 0;
    g.toasts.show('First comes rock…', '#ffc93a', 900);
    return true;
  }

  protected sustain(dt: number) {
    const g = this.game;
    const c = this.charge;
    const fist = handPos(g, 'right', TMP);
    g.particles.emit(AURA, fist, dt * (30 + c * 90), { spread: Math.PI, speed: [0.2, 0.9], jitter: 0.05 + c * 0.06, sizeMul: 0.2 + c * 0.3 });
    g.hands.glow(GOLD, 0.4 + c);
    g.lights.add(fist, GOLD, 4 + c * 14, 5 + c * 3);
    g.rig.shake(dt * c * 0.8);
    this.hum?.setLevel(0.3 + c * 0.7);
    if (c >= 1 && this.said < 1) {
      this.said = 1;
      g.toasts.show('JAN… KEN…', '#ffc93a', 700);
    }
  }

  protected end(charge: number) {
    const g = this.game;
    this.hum?.stop(0.1);
    this.hum = null;
    if (charge < 0) {
      pose(g, 'rest', 'rest');
      return;
    }
    const punch = () => {
      pose(g, 'rest', 'cast');
      g.hands.punch('right', 0.6);
      const res = strike(g, {
        range: 3,
        arc: 0.6,
        damage: 40 + charge * 150,
        knockback: 8 + charge * 22,
        lift: 3 + charge * 6,
        color: GOLD,
        fx: AURA,
        heavy: 1,
        hitstop: 0.05 + charge * 0.08,
        maxTargets: 3,
      });
      const at = res.hits[0]?.center(new THREE.Vector3()) ?? handPos(g, 'right', new THREE.Vector3()).addScaledVector(g.rig.aimDirection(TMP), 1.5);
      if (charge > 0.6) auraBurst(g, at, 2 + charge * 3, 20 * charge, 300 * charge);
      if (charge >= 1) g.toasts.show('ROCK!!', '#ffc93a', 800);
      setTimeout(() => pose(g, 'rest', 'rest'), 300);
    };
    const t = findTarget(g, 9, 0.45);
    if (t && t.center(TMP).distanceTo(g.player.curPos) > 2.6) g.combat.lunge(TMP.clone().sub(g.player.curPos), 34, 0.35, t, 1.8, punch);
    else punch();
  }
}

// -----------------------------------------------------------------------------
// X — Jajanken: PAPER (charge) — an emitted ball of aura.
// -----------------------------------------------------------------------------
class JajankenPaper extends Ability {
  readonly name = 'Jajanken: Paper';
  readonly description = 'Hold to compress aura between your palms, release to fire it as a blazing sphere that explodes on impact.';
  icon = ICONS.paper;
  mode = 'charge' as const;
  cost = 22;
  cooldown = 0.6;
  chargeTime = 1.2;
  private geo = new THREE.SphereGeometry(1, 20, 14);
  private mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(GOLD).multiplyScalar(2.5), transparent: true, opacity: 0.9 });

  protected start() {
    pose(this.game, 'charge', 'charge');
    return true;
  }

  protected sustain(dt: number) {
    const g = this.game;
    const p = bothHands(g, TMP);
    g.particles.emit(AURA, p, dt * (25 + this.charge * 60), { spread: Math.PI, speed: [0.2, 0.8], jitter: 0.05 + this.charge * 0.1, sizeMul: 0.3 + this.charge * 0.3 });
    g.hands.glow(GOLD, 0.5 + this.charge);
    g.lights.add(p, GOLD, 4 + this.charge * 10, 5);
  }

  protected end(charge: number) {
    const g = this.game;
    pose(g, 'push', 'push');
    setTimeout(() => pose(g, 'rest', 'rest'), 250);
    if (charge < 0) return;
    const from = bothHands(g, new THREE.Vector3());
    const dir = g.rig.aimDirection(new THREE.Vector3());
    const r = 0.25 + charge * 0.45;
    const m = new THREE.Mesh(this.geo, this.mat);
    m.scale.setScalar(r);
    g.scene.add(m);
    g.projectiles.fire({
      pos: from.clone().addScaledVector(dir, 0.5),
      vel: dir.multiplyScalar(32),
      gravity: 0,
      radius: r,
      life: 3,
      hitsWater: false,
      onUpdate: (p, dt) => {
        m.position.copy(p.pos);
        g.particles.emit(AURA, p.pos, dt * 120, { spread: Math.PI, speed: [0.3, 1.2], jitter: r * 0.8 });
        g.lights.add(p.pos, GOLD, 10 + charge * 15, 8);
      },
      onHit: (p) => {
        m.removeFromParent();
        auraBurst(g, p.pos, 2.5 + charge * 3.5, 30 + charge * 70, 250 + charge * 600);
      },
    });
    g.hands.kick('both', 0.15);
    g.rig.shake(0.1 + charge * 0.15);
    audio.whoosh(from, 0.8, 0.8);
  }
}

// -----------------------------------------------------------------------------
// C — Jajanken: SCISSORS — an aura blade (transmutation).
// -----------------------------------------------------------------------------
class JajankenScissors extends Ability {
  readonly name = 'Jajanken: Scissors';
  readonly description = 'Shape your aura into a blade from two fingers and slash in a wide arc — long reach, cuts through stone and ice.';
  icon = ICONS.scissors;
  cost = 14;
  cooldown = 0.5;
  private flip = 1;

  protected start() {
    const g = this.game;
    this.flip *= -1;
    const res = strike(g, {
      range: 4.2,
      arc: 1.0,
      damage: 46,
      knockback: 6,
      lift: 2,
      color: GOLD,
      fx: AURA,
      heavy: 0.7,
      critChance: 0.15,
      maxTargets: 5,
    });
    for (const e of res.hits) if (e.mat.brittle || e.frozen > 0.5) g.reactions.damage(e, 300, 'impact');
    // Glowing slash arc.
    const o = handPos(g, 'right', new THREE.Vector3());
    const fwd = g.rig.aimDirection(new THREE.Vector3());
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12 - 0.5) * 2.2 * this.flip;
      const p = o.clone().addScaledVector(fwd, Math.cos(a) * 3.2).addScaledVector(g.rig.right, Math.sin(a) * 3.2);
      p.y += (i / 12 - 0.5) * 0.8 * this.flip;
      g.particles.emit(AURA, p, 6, { spread: 0.3, speed: [0.2, 0.8], sizeMul: 0.9 });
      if (i > 0) g.bolts.spawn(o.clone().addScaledVector(fwd, Math.cos(a - 0.18 * this.flip) * 3.2).addScaledVector(g.rig.right, Math.sin(a - 0.18 * this.flip) * 3.2), p, { color: GOLD, width: 0.03, jag: 0.02, detail: 1, life: 0.18, intensity: 1.6 });
    }
    audio.noiseBurst({ volume: 0.6, decay: 0.18, filter: 'highpass', freq: 3500, freqEnd: 1500 });
    pose(g, 'rest', 'cast');
    g.hands.punch('right', 0.4);
    setTimeout(() => pose(g, 'rest', 'rest'), 220);
    return true;
  }
}

// -----------------------------------------------------------------------------
// B — Ren (toggle): flare your aura — stronger hits, take less damage.
// -----------------------------------------------------------------------------
class Ren extends Ability {
  readonly name = 'Ren';
  readonly description = 'Flare your aura: a burst that blasts things away, then +50% damage and −45% damage taken while it lasts.';
  icon = ICONS.aura;
  mode = 'toggle' as const;
  cost = 6;
  cooldown = 1;
  minEnergy = 15;

  protected start() {
    const g = this.game;
    if (g.zetsu) return false;
    g.damageBoost *= 1.5;
    g.health.setReduction('ren', 0.55);
    auraBurst(g, g.player.curPos.clone(), 4.5, 10, 350);
    g.rig.fovPunch(6);
    return true;
  }

  protected end() {
    const g = this.game;
    g.damageBoost /= 1.5;
    g.health.clearReduction('ren');
  }

  protected sustain(dt: number) {
    const g = this.game;
    const p = g.player.renderPos;
    g.particles.emit(AURA, g.player.feet(TMP), dt * 60, { spread: 0.4, speed: [1, 2.5], jitter: 0.5 });
    g.particles.emit(AURA, p, dt * 20, { spread: Math.PI, speed: [0.3, 1], jitter: 0.5 });
    g.hands.glow(GOLD, 0.35);
    g.lights.add(p, GOLD, 4, 5);
  }
}

// -----------------------------------------------------------------------------
// V — En (toggle): extend your aura to sense everything around you.
// -----------------------------------------------------------------------------
class En extends Ability {
  readonly name = 'En';
  readonly description = 'Extend your aura into a 30 m dome: every living thing and treasure inside is outlined through walls.';
  icon = ICONS.en;
  mode = 'toggle' as const;
  cost = 4;
  cooldown = 0.8;
  minEnergy = 10;
  private dome!: THREE.Mesh;
  private markers: THREE.Sprite[] = [];
  private markerMat!: THREE.SpriteMaterial;
  private treasureMat!: THREE.SpriteMaterial;
  private grow = 0;

  protected init() {
    this.dome = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 3),
      new THREE.MeshBasicMaterial({ color: GOLD, wireframe: true, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.dome.visible = false;
    this.game.scene.add(this.dome);
    const tex = (color: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      const grd = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
      grd.addColorStop(0, color);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    };
    this.markerMat = new THREE.SpriteMaterial({ map: tex('rgba(255,80,60,1)'), depthTest: false, transparent: true, blending: THREE.AdditiveBlending });
    this.treasureMat = new THREE.SpriteMaterial({ map: tex('rgba(255,210,60,1)'), depthTest: false, transparent: true, blending: THREE.AdditiveBlending });
  }

  protected start() {
    if (this.game.zetsu) return false;
    this.grow = 0;
    this.dome.visible = true;
    audio.tone({ volume: 0.2, freq: 220, freqEnd: 440, decay: 0.8, type: 'sine' });
    return true;
  }

  protected end() {
    this.dome.visible = false;
    for (const m of this.markers) m.visible = false;
  }

  protected sustain(dt: number) {
    const g = this.game;
    this.grow = Math.min(1, this.grow + dt * 1.5);
    const R = 30 * this.grow;
    this.dome.position.copy(g.player.renderPos);
    this.dome.scale.setScalar(Math.max(0.1, R));
    this.dome.rotation.y += dt * 0.2;
    let n = 0;
    for (const e of g.entities.nearby(g.player.curPos, R, NEAR)) {
      const living = !!e.onDamage && e.type !== 'dummy';
      if (!living && e.type !== 'treasure' && e.type !== 'dummy') continue;
      let m = this.markers[n];
      if (!m) {
        m = new THREE.Sprite(this.markerMat);
        m.renderOrder = 30;
        g.scene.add(m);
        this.markers.push(m);
      }
      m.material = e.type === 'treasure' ? this.treasureMat : this.markerMat;
      m.visible = true;
      e.center(m.position);
      m.position.y += e.type === 'treasure' ? 1.4 : 0.3;
      m.scale.setScalar(e.type === 'treasure' ? 1.2 : 2.2);
      n++;
    }
    for (let i = n; i < this.markers.length; i++) this.markers[i].visible = false;
  }
}

// -----------------------------------------------------------------------------
// G — Zetsu (toggle): suppress all aura.
// -----------------------------------------------------------------------------
class Zetsu extends Ability {
  readonly name = 'Zetsu';
  readonly description = 'Suppress your aura completely: almost undetectable and you recover health and energy fast — but you can\'t use other abilities and you take 50% more damage.';
  icon = ICONS.zetsu;
  mode = 'toggle' as const;
  cost = 0;
  cooldown = 0.5;
  minEnergy = 0;
  allowInZetsu = true;

  protected start() {
    const g = this.game;
    // Ren and En collapse when you hide your aura.
    for (const a of this.power.abilities) if (a !== this && a.active) a.press();
    g.zetsu = true;
    g.stealth.setInvisible('zetsu', true);
    g.stealth.stealthMul *= 0.3;
    g.health.setReduction('zetsu', 1.5);
    audio.tone({ volume: 0.15, freq: 300, freqEnd: 120, decay: 0.6 });
    g.canvas.style.filter = 'saturate(0.55) brightness(0.9)';
    return true;
  }

  protected end() {
    const g = this.game;
    g.zetsu = false;
    g.stealth.setInvisible('zetsu', false);
    g.stealth.stealthMul /= 0.3;
    g.health.clearReduction('zetsu');
    g.canvas.style.filter = '';
  }

  protected sustain(dt: number) {
    const g = this.game;
    g.health.heal(dt * 10);
    g.energy.refund(dt * 12);
  }
}

/**
 * NEN (key 6): Hunter-style aura techniques — Jajanken (rock / paper /
 * scissors), Ren, En and Zetsu.
 */
export class NenPower extends Power {
  readonly id = 'nen';
  readonly name = 'Nen';
  readonly color = '#ffc93a';
  readonly icon = ICONS.nen;
  readonly abilities = [new JajankenRock(), new JajankenPaper(), new JajankenScissors(), new Ren(), new En(), new Zetsu()];
  private tmp = new THREE.Vector3();

  /** Idle: a faint aura shimmer around the hands (none while in Zetsu). */
  update(dt: number) {
    const g = this.game;
    if (g.rig.mode !== 'first' || g.zetsu) return;
    if (Math.random() < dt * 6) g.particles.emit(AURA, handPos(g, Math.random() < 0.5 ? 'left' : 'right', this.tmp), 1, { spread: 0.6, speed: [0.1, 0.4], sizeMul: 0.4 });
  }
}

const TMP = new THREE.Vector3();
const NEAR: Entity[] = [];
