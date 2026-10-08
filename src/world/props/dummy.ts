import * as THREE from 'three';
import { G, groups } from '../../config/physics';
import { RAPIER } from '../../core/Physics';
import type { EntityManager } from '../EntityManager';
import { buildProp } from './basic';
import { cylGeo, mesh, plainMaterial, texturedMaterial, cachedGeometry } from './assets';

/**
 * Training dummy: a wooden body on a ball joint over a fixed base, with a
 * restoring torque so it wobbles back upright after being hit. Takes damage,
 * shows stun, and slowly heals.
 */
export function registerDummy(em: EntityManager) {
  em.registerFactory('dummy', (s) => {
    const world = em.physics.world;
    // Fixed base (separate static collider so the dummy can't be knocked away).
    const baseBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(s.x, s.y, s.z));
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.08, 0.35).setTranslation(0, 0.08, 0).setCollisionGroups(groups(G.STATIC)),
      baseBody,
    );
    const baseMesh = mesh(cylGeo(0.35, 0.4, 0.16, 18), texturedMaterial('stone', { key: 'dummyBase' }));
    baseMesh.position.set(s.x, s.y + 0.08, s.z);
    em.scene.add(baseMesh);

    const g = new THREE.Group();
    const sack = texturedMaterial('cloth', { color: 0xb59a6a, key: 'dummySack' });
    const pole = mesh(cylGeo(0.05, 0.05, 1.0, 8), texturedMaterial('wood', { key: 'dummyPole' }));
    pole.position.y = -0.55;
    const torso = mesh(cachedGeometry('dummyTorso', () => new THREE.CapsuleGeometry(0.26, 0.55, 4, 12)), sack);
    torso.position.y = 0.15;
    const head = mesh(cachedGeometry('dummyHead', () => new THREE.SphereGeometry(0.19, 14, 10)), sack);
    head.position.y = 0.78;
    const arms = mesh(cachedGeometry('dummyArms', () => new THREE.CapsuleGeometry(0.07, 0.95, 4, 8).rotateZ(Math.PI / 2)), sack);
    arms.position.y = 0.38;
    const target = mesh(
      cachedGeometry('dummyTarget', () => new THREE.CircleGeometry(0.13, 20)),
      plainMaterial('dummyTarget', { color: 0xc0392b, roughness: 0.8 }),
    );
    target.position.set(0, 0.25, 0.265);
    g.add(pole, torso, head, arms, target);

    const pivotY = s.y + 0.16;
    const centerY = pivotY + 1.05;
    const e = buildProp(em, { ...s, y: centerY }, 'dummy', {
      material: 'dummy',
      object: g,
      colliders: [
        RAPIER.ColliderDesc.capsule(0.3, 0.27).setTranslation(0, 0.15, 0),
        RAPIER.ColliderDesc.ball(0.19).setTranslation(0, 0.78, 0),
      ],
      mass: 30,
      radius: 0.9,
      volume: 0.25,
      angularDamping: 2.5,
      linearDamping: 0.5,
    });
    e.spec = s;
    const body = e.body!;
    const joint = world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: -(centerY - pivotY), z: 0 }),
      baseBody,
      body,
      true,
    );
    void joint;

    const maxHp = 250;
    let hp = maxHp;
    let sinceHit = 99;
    e.tags.add('dummy');
    e.tags.add('target');
    const up = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();
    e.update = (dt) => {
      if (!e.body) return;
      // Restoring torque: rotate the body's up vector back towards world up.
      const r = e.body.rotation();
      tmpQ.set(r.x, r.y, r.z, r.w);
      up.set(0, 1, 0).applyQuaternion(tmpQ);
      const axis = new THREE.Vector3().crossVectors(up, WORLD_UP);
      const k = 900;
      e.body.applyTorqueImpulse({ x: axis.x * k * dt, y: 0, z: axis.z * k * dt }, true);
      sinceHit += dt;
      if (sinceHit > 3 && hp < maxHp) hp = Math.min(maxHp, hp + 60 * dt);
      e.integrity = hp / maxHp;
      if (e.stun > 0) e.stun -= dt;
    };
    e.onDamage = (n: number) => {
      hp = Math.max(0, hp - n);
      sinceHit = 0;
      e.integrity = hp / maxHp;
    };
    e.onRemove = () => {
      baseMesh.removeFromParent();
      if (world.getRigidBody(baseBody.handle)) world.removeRigidBody(baseBody);
    };
    return e;
  });
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
