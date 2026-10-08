import * as THREE from 'three';
import { ALL_GROUPS, G, PHYSICS, groups } from '../config/physics';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import { RAPIER } from '../core/Physics';
import { Avatar } from '../player/Avatar';
import { FX } from '../systems/Particles';
import { Entity, type PropSpec } from '../world/Entity';

export type GuardState = 'patrol' | 'suspicious' | 'alert' | 'searching' | 'stunned' | 'down';

const HALF = 0.55;
const RADIUS = 0.33;
const FOV = THREE.MathUtils.degToRad(58); // half-angle
const SIGHT = 24;

function iconTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, 32, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let ICONS: Record<string, THREE.SpriteMaterial> | null = null;
function icons() {
  if (!ICONS) {
    ICONS = {
      suspicious: new THREE.SpriteMaterial({ map: iconTexture('?', '#ffd23f'), depthTest: false }),
      alert: new THREE.SpriteMaterial({ map: iconTexture('!', '#ff4a3a'), depthTest: false }),
      searching: new THREE.SpriteMaterial({ map: iconTexture('?', '#ff9a3a'), depthTest: false }),
      stunned: new THREE.SpriteMaterial({ map: iconTexture('✦', '#7fd4ff'), depthTest: false }),
      down: new THREE.SpriteMaterial({ map: iconTexture('z', '#c0c0ff'), depthTest: false }),
    };
  }
  return ICONS;
}

/**
 * A patrolling guard: kinematic character with its own Rapier character
 * controller, a vision cone that depends on the player's visibility
 * (light, invisibility, crouching), hearing, and a suspicion meter driving
 * idle → suspicious → alert → searching. Guards chase Shadow decoys, can be
 * stunned / frozen / knocked out by powers, and "catch" the player (sending
 * them back to the compound gate) — non-lethal.
 */
export class Guard {
  readonly entity: Entity;
  readonly avatar = new Avatar({ suit: 0x3a2a2a, skin: 0xb88a6a, accent: 0xd43a2a });
  private kcc: RAPIER.KinematicCharacterController;
  readonly pos = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private renderPos = new THREE.Vector3();
  yaw = 0;
  private renderYaw = 0;
  private vy = 0;
  state: GuardState = 'patrol';
  suspicion = 0;
  private wp = 0;
  private wait = 0;
  private lastKnown = new THREE.Vector3();
  private chasing: 'player' | 'decoy' = 'player';
  private lostTimer = 0;
  private searchTimer = 0;
  private searchPoint = new THREE.Vector3();
  private hp = 100;
  private downTimer = 0;
  private senseTimer = 0;
  private speed = 0;
  private icon: THREE.Sprite;
  private cone: THREE.Mesh;
  private coneMat: THREE.MeshBasicMaterial;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private lastShout = 0;
  private attackCd = 0;
  /** Knockback velocity from hits. */
  private kb = new THREE.Vector3();
  private facingV = new THREE.Vector3();

  constructor(
    private game: Game,
    private spec: PropSpec,
    private waypoints: THREE.Vector3[],
    _catchSpawn: THREE.Vector3,
  ) {
    const world = game.physics.world;
    this.pos.set(spec.x, spec.y, spec.z);
    this.prev.copy(this.pos);
    this.renderPos.copy(this.pos);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spec.x, spec.y + HALF + RADIUS, spec.z));
    const col = world.createCollider(
      RAPIER.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(groups(G.NPC, ALL_GROUPS & ~G.SENSOR & ~G.DEBRIS)),
      body,
    );
    this.kcc = world.createCharacterController(0.03);
    this.kcc.enableAutostep(0.4, 0.2, false);
    this.kcc.enableSnapToGround(0.4);
    this.kcc.setMaxSlopeClimbAngle(0.8);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(80);
    const root = new THREE.Group();
    root.add(this.avatar.root);
    this.entity = new Entity('guard', 'flesh', root);
    this.entity.body = body;
    this.entity.colliders = [col];
    this.entity.radius = 0.6;
    this.entity.volume = 0.08;
    this.entity.tags.add('guard');
    this.entity.spec = spec;
    this.entity.onDamage = (n, kind) => this.damage(n, kind);
    this.entity.facing = () => this.facingV.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.entity.aware = () => this.state === 'alert';
    this.entity.onImpulse = (x, y, z) => {
      this.kb.x += x / 80;
      this.kb.z += z / 80;
      this.vy = Math.max(this.vy, y / 80);
      if (Math.hypot(x, z) / 80 > 6) this.entity.stun = Math.max(this.entity.stun, 0.8);
    };
    this.entity.update = (dt) => this.fixedUpdate(dt);

    this.icon = new THREE.Sprite(icons().suspicious);
    this.icon.scale.setScalar(0.9);
    this.icon.visible = false;
    this.icon.renderOrder = 20;
    root.add(this.icon);
    // Vision cone on the ground.
    const geo = new THREE.CircleGeometry(1, 20, Math.PI / 2 - FOV, FOV * 2);
    geo.rotateX(-Math.PI / 2);
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false });
    this.cone = new THREE.Mesh(geo, this.coneMat);
    this.cone.renderOrder = 3;
    root.add(this.cone);
    this.yaw = (spec.ry ?? 0) + Math.PI;
  }

  get eye(): THREE.Vector3 {
    return this.tmp2.copy(this.pos).setY(this.pos.y + 1.6);
  }

  private damage(n: number, kind: string) {
    if (this.state === 'down') return;
    this.hp -= n;
    if (this.hp <= 0) {
      this.state = 'down';
      this.downTimer = 12;
      audio.noiseBurst({ pos: this.pos, volume: 0.5, decay: 0.3, freq: 500, freqEnd: 150, brown: true });
      return;
    }
    // Getting hurt makes a guard suspicious of the player.
    if (kind !== 'shadow') {
      this.suspicion = Math.max(this.suspicion, 0.7);
      this.lastKnown.copy(this.game.player.curPos);
    }
  }

  /** Can the guard see a point (line of sight, within FOV and range)? */
  private canSee(p: THREE.Vector3, range: number, wide = false): boolean {
    const eye = this.eye;
    const to = this.tmp.copy(p).sub(eye);
    const d = to.length();
    if (d > range) return false;
    const fwd = TMP_F.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const flat = Math.hypot(to.x, to.z);
    const cos = flat > 0.01 ? (to.x * fwd.x + to.z * fwd.z) / flat : 1;
    if (cos < Math.cos(wide ? FOV * 1.6 : FOV) && d > 2.2) return false;
    to.divideScalar(d);
    const hit = this.game.physics.raycast(eye, to, d - 0.4, {
      groups: groups(G.NPC, G.TERRAIN | G.STATIC | G.PHASEABLE),
      exclude: this.entity.colliders[0],
    });
    return !hit;
  }

  private sense(dt: number) {
    const g = this.game;
    const st = g.stealth;
    let seen = false;
    // The player.
    if (!g.digging) {
      let vis = st.visibility;
      // At night guards carry torches: anyone in the beam is lit.
      const night = g.env.nightFactor > 0.5;
      const head = TMP_H.copy(g.player.curPos).setY(g.player.curPos.y + 0.5);
      if (night && !st.invisible && head.distanceTo(this.pos) < 14) vis = Math.max(vis, 0.6);
      const range = SIGHT * (0.15 + 0.85 * vis);
      if (vis > 0.03 && this.canSee(head, range)) {
        const d = head.distanceTo(this.eye);
        const rate = 2.6 * Math.min(1, vis * 1.5) * (1.2 - d / range);
        this.suspicion += Math.max(0.05, rate) * dt;
        this.lastKnown.copy(g.player.curPos);
        this.chasing = 'player';
        seen = true;
      }
    }
    // Shadow decoys look like the player and are easy to spot.
    for (const dc of st.decoys) {
      const p = TMP_H.copy(dc.pos).setY(dc.pos.y + 1);
      if (this.canSee(p, SIGHT * 0.9, true)) {
        if (!seen || this.chasing === 'decoy') {
          this.suspicion += 2.2 * dt;
          this.lastKnown.copy(dc.pos);
          this.chasing = 'decoy';
          seen = true;
        }
      }
    }
    // Hearing.
    for (const n of st.noises) {
      if (n.age > 0.2) continue;
      if (n.pos.distanceTo(this.pos) < n.range) {
        if (this.state === 'patrol' || this.state === 'searching') {
          this.suspicion = Math.max(this.suspicion, 0.45);
          this.lastKnown.copy(n.pos);
        }
      }
    }
    if (seen) this.lostTimer = 0;
    else {
      this.lostTimer += dt;
      if (this.state !== 'alert') this.suspicion = Math.max(0, this.suspicion - dt * 0.12);
    }
    this.suspicion = Math.min(1.2, this.suspicion);
    return seen;
  }

  private fixedUpdate(dt: number) {
    const g = this.game;
    const e = this.entity;
    this.prev.copy(this.pos);
    // Status effects.
    if (this.state === 'down') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) {
        this.state = 'searching';
        this.searchTimer = 6;
        this.hp = 100;
      }
      this.move(dt, 0);
      return;
    }
    if (e.stun > 0 || e.frozen > 0.5) {
      e.stun -= dt;
      this.state = 'stunned';
      this.move(dt, 0);
      return;
    }
    if (this.state === 'stunned') {
      this.state = 'searching';
      this.searchTimer = 5;
      this.suspicion = Math.max(this.suspicion, 0.6);
    }
    this.hp = Math.min(100, this.hp + dt * 3);

    this.senseTimer -= dt;
    let seen = this.lostTimer < 0.15;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.1;
      seen = this.sense(0.1);
    }

    // State machine.
    switch (this.state) {
      case 'patrol':
        if (this.suspicion > 0.3) this.state = 'suspicious';
        break;
      case 'suspicious':
        if (this.suspicion >= 1) {
          this.state = 'alert';
          this.shout();
        } else if (this.suspicion < 0.08) this.state = 'patrol';
        break;
      case 'alert':
        if (!seen && this.lostTimer > 2.5) {
          this.state = 'searching';
          this.searchTimer = 9;
          this.searchPoint.copy(this.lastKnown);
        }
        break;
      case 'searching':
        this.searchTimer -= dt;
        if (this.suspicion >= 1) {
          this.state = 'alert';
          this.shout();
        } else if (this.searchTimer <= 0) {
          this.state = 'patrol';
          this.suspicion = 0.1;
        }
        break;
    }

    // Movement per state.
    let target: THREE.Vector3 | null = null;
    let speed = 0;
    if (this.state === 'patrol') {
      const wp = this.waypoints[this.wp];
      if (this.wait > 0) {
        this.wait -= dt;
        this.yaw += Math.sin(this.wait * 1.3) * dt * 0.8;
      } else if (wp) {
        if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) {
          this.wp = (this.wp + 1) % this.waypoints.length;
          this.wait = 1.5 + Math.random() * 2;
        } else {
          target = wp;
          speed = 1.6;
        }
      }
    } else if (this.state === 'suspicious') {
      target = this.lastKnown;
      speed = this.suspicion > 0.6 ? 1.6 : 0.8;
    } else if (this.state === 'alert') {
      target = this.chasing === 'player' && seen ? g.player.curPos : this.lastKnown;
      speed = 4.3;
      // Caught the player?
      this.attackCd -= dt;
      if (this.chasing === 'player' && this.pos.distanceTo(g.player.feet(this.tmp)) < 1.7 && this.attackCd <= 0) {
        this.attackCd = 1.1;
        this.avatar.aimTarget = 1;
        audio.whoosh(this.pos, 0.5, 1.2);
        g.damagePlayer(9, this.pos, 4);
      }
      if (this.chasing === 'decoy' && this.pos.distanceTo(this.lastKnown) < 1.4) {
        // Reached the decoy — it's not real.
        this.state = 'searching';
        this.searchTimer = 6;
        this.suspicion = 0.5;
      }
    } else if (this.state === 'searching') {
      if (this.pos.distanceTo(this.searchPoint) < 1) {
        this.searchPoint.copy(this.lastKnown).add(this.tmp.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10));
      }
      target = this.searchPoint;
      speed = 1.8;
    }
    if (target) {
      const want = Math.atan2(-(target.x - this.pos.x), -(target.z - this.pos.z));
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += THREE.MathUtils.clamp(dy, -dt * 5, dt * 5);
      if (Math.abs(dy) > 1.2) speed *= 0.2;
    }
    this.move(dt, speed);
  }

  private move(dt: number, speed: number) {
    const fx = -Math.sin(this.yaw) * speed * dt + this.kb.x * dt;
    const fz = -Math.cos(this.yaw) * speed * dt + this.kb.z * dt;
    this.kb.multiplyScalar(Math.max(0, 1 - dt * 5));
    this.vy = this.kcc.computedGrounded() ? -1 : this.vy + PHYSICS.gravity * dt;
    const col = this.entity.colliders[0];
    this.kcc.computeColliderMovement(col, { x: fx, y: this.vy * dt, z: fz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.NPC, ALL_GROUPS & ~G.SENSOR & ~G.DEBRIS & ~G.PLAYER));
    const mv = this.kcc.computedMovement();
    const gotH = Math.hypot(mv.x, mv.z);
    // Stuck on a wall while patrolling: skip to the next waypoint.
    if (speed > 1 && gotH < speed * dt * 0.2 && this.state === 'patrol') this.wp = (this.wp + 1) % Math.max(1, this.waypoints.length);
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    this.speed = gotH / Math.max(dt, 1e-4);
    if (this.pos.y < -30) this.pos.set(this.spec.x, this.spec.y + 1, this.spec.z);
    this.entity.body!.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + HALF + RADIUS, z: this.pos.z });
  }

  private shout() {
    const now = performance.now();
    if (now - this.lastShout < 3000) return;
    this.lastShout = now;
    audio.tone({ pos: this.pos, volume: 0.5, freq: 330, freqEnd: 440, decay: 0.25, type: 'square', ref: 15 });
    audio.tone({ pos: this.pos, volume: 0.5, freq: 440, freqEnd: 330, decay: 0.3, type: 'square', ref: 15, delay: 0.22 });
    if (this.chasing === 'player') this.game.toasts.show('Spotted!', '#ff4a3a');
    // Alert nearby guards.
    this.game.stealth.noise(this.pos, 20);
  }

  calm() {
    if (this.state === 'down' || this.state === 'stunned') return;
    this.state = 'patrol';
    this.suspicion = 0;
  }

  /** Per-frame visuals. */
  render(dt: number, alpha: number) {
    this.renderPos.copy(this.prev).lerp(this.pos, alpha);
    let dy = this.yaw - this.renderYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.renderYaw += dy * Math.min(1, dt * 12);
    const av = this.avatar;
    const down = this.state === 'down';
    av.update(dt, ORIGIN, this.renderYaw, down || this.state === 'stunned' ? 0 : this.speed, true, this.state === 'suspicious' ? 0.2 : 0);
    av.aimTarget = this.state === 'alert' ? 1 : 0;
    this.entity.object.position.copy(this.renderPos);
    av.root.rotation.x = down ? -Math.PI / 2 : 0;
    av.root.position.set(0, down ? 0.3 : 0, 0);
    // Icon.
    const icon = this.state === 'patrol' ? null : this.state;
    this.icon.visible = !!icon && this.state !== 'patrol';
    if (icon) this.icon.material = icons()[icon];
    this.icon.position.set(0, 2.3 + Math.sin(performance.now() * 0.006) * 0.05, 0);
    // Vision cone.
    const g = this.game;
    this.cone.visible = !down && this.state !== 'stunned';
    this.cone.position.set(0, 0.06, 0);
    this.cone.rotation.y = this.renderYaw + Math.PI;
    const reach = SIGHT * (0.15 + 0.85 * Math.max(0.3, g.stealth.visibility));
    this.cone.scale.setScalar(Math.min(SIGHT, reach) * 0.5);
    const s = Math.min(1, this.suspicion);
    this.coneMat.color.setRGB(1, 1 - s * 0.6, 1 - s);
    this.coneMat.opacity = 0.06 + s * 0.12;
    // Torch at night.
    if (g.env.nightFactor > 0.5 && !down) {
      const p = this.tmp.copy(this.renderPos).add(TMP_F.set(-Math.sin(this.renderYaw) * 1.5, 1.6, -Math.cos(this.renderYaw) * 1.5));
      g.lights.add(p, 0xffd9a0, 6, 12);
    }
    if (this.state === 'stunned' && Math.random() < dt * 8) g.particles.emit(FX.electric, this.tmp.copy(this.renderPos).setY(this.renderPos.y + 1.2), 2, { spread: Math.PI, speed: [0.5, 2], jitter: 0.4 });
  }

  dispose() {
    this.coneMat.dispose();
    this.avatar.suit.dispose();
    this.avatar.skin.dispose();
    this.avatar.accent.dispose();
  }
}

/** Owns all guards: registers the factory, renders them, calms them on catch. */
export class GuardSystem implements GameSystem {
  readonly guards = new Set<Guard>();
  private alpha = 1;

  constructor(game: Game) {
    game.entities.registerFactory('guard', (s, em) => {
      const wps = ((s.data?.waypoints as [number, number][]) ?? []).map(([x, z]) => new THREE.Vector3(x, game.world.heightAt(x, z), z));
      const cs = (s.data?.catch as [number, number, number]) ?? [s.x, s.y, s.z];
      const guard = new Guard(game, s, wps, new THREE.Vector3(cs[0], cs[1], cs[2]));
      this.guards.add(guard);
      guard.entity.onRemove = () => {
        this.guards.delete(guard);
        guard.dispose();
      };
      em.add(guard.entity);
      return guard.entity;
    });
  }

  calmAll() {
    for (const g of this.guards) g.calm();
  }

  /** Highest suspicion among guards (HUD / music). */
  get maxSuspicion(): number {
    let m = 0;
    for (const g of this.guards) m = Math.max(m, g.state === 'alert' ? 1 : g.suspicion);
    return m;
  }

  setAlpha(a: number) {
    this.alpha = a;
  }

  update(dt: number) {
    for (const g of this.guards) g.render(dt, this.alpha);
  }
}

const TMP_F = new THREE.Vector3();
const TMP_H = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
