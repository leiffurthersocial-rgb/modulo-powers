import * as THREE from 'three';
import { ALL_GROUPS, G, groups } from '../config/physics';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import { RAPIER } from '../core/Physics';
import type { Entity } from '../world/Entity';
import { iceMaterial } from '../world/props/basic';
import { FX } from './Particles';

interface Debris {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  age: number;
  life: number;
  scale: number;
}

/**
 * Breaking things: brittle props shatter into short-lived physical debris on
 * hard impacts, lightning, earth slams or freezing+shattering. Debris meshes
 * are pooled; debris bodies don't collide with each other or the player.
 */
export class DestructionSystem implements GameSystem {
  private debris: Debris[] = [];
  private meshPool: THREE.Mesh[] = [];
  private geos: THREE.BufferGeometry[];
  private tmp = new THREE.Vector3();
  maxDebris = 140;

  constructor(private game: Game) {
    game.reactions.onBreak = (e) => this.shatter(e);
    // A few irregular chunk shapes shared by all debris.
    this.geos = [0, 1, 2].map((s) => {
      const g = new THREE.DodecahedronGeometry(0.5, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, p.getX(i) * (0.7 + ((i * 7 + s * 3) % 5) * 0.12), p.getY(i) * (0.6 + ((i * 3 + s) % 4) * 0.15), p.getZ(i));
      }
      g.computeVertexNormals();
      return g;
    });
  }

  /** Handle a contact-force event on an entity (called from Game). */
  onImpact(e: Entity, force: number) {
    if (e.dead || (!e.mat.brittle && e.frozen < 0.5)) return;
    const accel = force / Math.max(1, e.mass);
    const threshold = (e.frozen > 0.5 && !e.mat.brittle ? 60 : e.mat.breakEnergy) * 6;
    if (accel < threshold) return;
    e.integrity -= (accel / threshold - 0.6) * 0.6;
    if (e.integrity <= 0) this.shatter(e);
  }

  /** Break an entity into debris. */
  shatter(e: Entity, from?: THREE.Vector3) {
    if (e.dead) return;
    const g = this.game;
    const c = e.center(new THREE.Vector3());
    const vel = e.body ? e.body.linvel() : { x: 0, y: 0, z: 0 };
    const mat = e.frozen > 0.5 && e.mat.id !== 'ice' ? iceMaterial() : (e.visual.baseMaterial ?? iceMaterial());
    const vol = Math.max(0.05, e.volume);
    const pieces = Math.min(14, Math.max(5, Math.round(vol * 14 + e.radius * 6)));
    const size = Math.max(0.12, Math.min(0.7, Math.cbrt(vol / pieces) * 1.25 + e.radius * 0.12));
    for (let i = 0; i < pieces; i++) {
      const off = this.tmp.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(e.radius * 1.2);
      const dir = off.clone().normalize();
      if (from) dir.add(this.tmp.copy(c).sub(from).normalize().multiplyScalar(0.8)).normalize();
      const speed = 2 + Math.random() * 4;
      this.spawnDebris(
        mat,
        c.clone().add(off),
        size * (0.6 + Math.random() * 0.6),
        new THREE.Vector3(vel.x + dir.x * speed, vel.y + Math.abs(dir.y) * speed + 1, vel.z + dir.z * speed),
        e.mat.density,
      );
    }
    const preset = e.mat.sound === 'stone' ? FX.dust : FX.debris;
    g.particles.emit(preset, c, 10 + pieces, { spread: Math.PI, speed: [1, 4], jitter: e.radius * 0.6 });
    if (e.mat.id === 'ice' || e.frozen > 0.5) g.particles.emit(FX.frost, c, 30, { spread: Math.PI, speed: [1, 5], jitter: e.radius });
    if (e.burning) g.particles.emit(FX.ember, c, 30, { spread: Math.PI, speed: [1, 5], jitter: e.radius });
    audio.shatter(c, e.frozen > 0.5 ? 'ice' : e.mat.sound, Math.min(1.2, 0.5 + e.radius));
    g.rig.shake(Math.min(0.25, 2 / Math.max(2, c.distanceTo(g.camera.position))));
    g.entities.remove(e);
  }

  spawnDebris(mat: THREE.Material, pos: THREE.Vector3, size: number, vel: THREE.Vector3, density: number) {
    if (this.debris.length >= this.maxDebris) this.removeDebris(0);
    const world = this.game.physics.world;
    const mesh = this.meshPool.pop() ?? new THREE.Mesh(this.geos[0]);
    mesh.geometry = this.geos[Math.floor(Math.random() * this.geos.length)];
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(size);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 })
        .setLinearDamping(0.1)
        .setAngularDamping(0.3),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(size * 0.42)
        .setDensity(Math.min(density, 2500))
        .setFriction(0.8)
        .setRestitution(0.15)
        .setCollisionGroups(groups(G.DEBRIS, ALL_GROUPS & ~G.DEBRIS & ~G.PLAYER & ~G.NPC)),
      body,
    );
    this.game.scene.add(mesh);
    this.game.physics.sync(body, mesh);
    this.debris.push({ mesh, body, age: 0, life: 7 + Math.random() * 5, scale: size });
  }

  private removeDebris(i: number) {
    const d = this.debris[i];
    this.game.physics.removeBody(d.body);
    d.mesh.removeFromParent();
    this.meshPool.push(d.mesh);
    this.debris.splice(i, 1);
  }

  update(dt: number) {
    if (dt <= 0) return;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      const left = d.life - d.age;
      if (left < 1) d.mesh.scale.setScalar(d.scale * Math.max(0.01, left));
      if (left <= 0) this.removeDebris(i);
    }
  }

  get debrisCount(): number {
    return this.debris.length;
  }

  reset() {
    while (this.debris.length) this.removeDebris(this.debris.length - 1);
  }
}
