import * as THREE from 'three';
import type { MaterialId } from '../../config/materials';
import { G, groups } from '../../config/physics';
import { RAPIER } from '../../core/Physics';
import { Entity, type PropSpec } from '../Entity';
import type { EntityManager } from '../EntityManager';
import { boxGeo, cylGeo, mesh, plainMaterial, texturedMaterial, physicalMaterial, cachedGeometry } from './assets';

export interface BuildOpts {
  material: MaterialId;
  object: THREE.Object3D;
  colliders: RAPIER.ColliderDesc[];
  /** Total mass in kg (overrides density); hollow props like crates use this. */
  mass?: number;
  fixed?: boolean;
  kinematic?: boolean;
  radius: number;
  volume: number;
  /** Collision group membership (defaults to DYNAMIC or STATIC). */
  group?: number;
  linearDamping?: number;
  angularDamping?: number;
  ccd?: boolean;
}

/**
 * Shared body/collider creation for all props. Applies material friction /
 * restitution and enables contact-force events (impact sounds + breakage).
 */
export function buildProp(em: EntityManager, spec: PropSpec, type: string, o: BuildOpts): Entity {
  const e = new Entity(type, spec.material ?? o.material, o.object);
  const world = em.physics.world;
  const fixed = o.fixed ?? spec.fixed ?? false;
  const desc = fixed
    ? RAPIER.RigidBodyDesc.fixed()
    : o.kinematic
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.dynamic();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(spec.rx ?? 0, spec.ry ?? 0, spec.rz ?? 0));
  desc.setTranslation(spec.x, spec.y, spec.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  if (o.linearDamping !== undefined) desc.setLinearDamping(o.linearDamping);
  if (o.angularDamping !== undefined) desc.setAngularDamping(o.angularDamping);
  if (o.ccd) desc.setCcdEnabled(true);
  // Pre-built stacks and walls start asleep so they stay put until disturbed.
  if (spec.data?.sleep) desc.setSleeping(true);
  const body = world.createRigidBody(desc);
  e.body = body;
  const group = o.group ?? (fixed ? G.STATIC : G.DYNAMIC);
  const totalVol = o.volume;
  for (const cd of o.colliders) {
    cd.setFriction(e.mat.friction).setRestitution(e.mat.restitution).setCollisionGroups(groups(group));
    if (!fixed) {
      if (o.mass !== undefined) cd.setMass(o.mass / o.colliders.length);
      else cd.setDensity(e.mat.density);
      cd.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      cd.setContactForceEventThreshold(Math.max(80, (o.mass ?? totalVol * e.mat.density) * 25));
    }
    e.colliders.push(world.createCollider(cd, body));
  }
  e.radius = o.radius;
  e.volume = o.volume;
  e.isStatic = fixed;
  o.object.position.set(spec.x, spec.y, spec.z);
  o.object.quaternion.copy(q);
  em.add(e);
  return e;
}

// -----------------------------------------------------------------------------
// Basic props
// -----------------------------------------------------------------------------

export function registerBasicProps(em: EntityManager) {
  em.registerFactory('crate', (s) => {
    const w = s.w ?? 1;
    const m = mesh(boxGeo(w, w, w, 0.03), texturedMaterial('planks'));
    return buildProp(em, s, 'crate', {
      material: 'wood',
      object: m,
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, w / 2, w / 2)],
      mass: 30 * w * w * w,
      radius: w * 0.7,
      volume: w * w * w * 0.25,
    });
  });

  em.registerFactory('metalCrate', (s) => {
    const w = s.w ?? 0.9;
    const m = mesh(boxGeo(w, w, w, 0.02), texturedMaterial('metal', { color: 0x8d98a3, metalness: 0.85, key: 'metalCrate' }));
    return buildProp(em, s, 'metalCrate', {
      material: 'metal',
      object: m,
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, w / 2, w / 2)],
      mass: 90 * w * w * w,
      radius: w * 0.7,
      volume: w * w * w,
    });
  });

  em.registerFactory('barrel', (s) => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.3, 0.3, 0.9, 16), texturedMaterial('wood', { key: 'barrelWood' })));
    const ringMat = plainMaterial('barrelRing', { color: 0x3a3a3a, metalness: 0.8, roughness: 0.5 });
    for (const y of [-0.3, 0.3]) {
      const ring = mesh(cylGeo(0.31, 0.31, 0.05, 16), ringMat);
      ring.position.y = y;
      g.add(ring);
    }
    return buildProp(em, s, 'barrel', {
      material: 'wood',
      object: g,
      colliders: [RAPIER.ColliderDesc.cylinder(0.45, 0.3)],
      mass: 28,
      radius: 0.5,
      volume: 0.12,
    });
  });

  em.registerFactory('metalBarrel', (s) => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.3, 0.3, 0.9, 18), texturedMaterial('metal', { color: 0xb33a2a, metalness: 0.7, key: 'redBarrel' })));
    const ringMat = plainMaterial('steelRing', { color: 0x777777, metalness: 0.9, roughness: 0.35 });
    for (const y of [-0.42, 0, 0.42]) {
      const ring = mesh(cylGeo(0.31, 0.31, 0.04, 18), ringMat);
      ring.position.y = y;
      g.add(ring);
    }
    return buildProp(em, s, 'metalBarrel', {
      material: 'metal',
      object: g,
      colliders: [RAPIER.ColliderDesc.cylinder(0.45, 0.3)],
      mass: 40,
      radius: 0.5,
      volume: 0.25,
    });
  });

  em.registerFactory('hay', (s) => {
    const m = mesh(boxGeo(1.2, 0.6, 0.7, 0.12), texturedMaterial('hay'));
    return buildProp(em, s, 'hay', {
      material: 'hay',
      object: m,
      colliders: [RAPIER.ColliderDesc.cuboid(0.6, 0.3, 0.35)],
      mass: 25,
      radius: 0.7,
      volume: 0.5,
    });
  });

  em.registerFactory('plank', (s) => {
    const len = s.w ?? 2.4;
    const m = mesh(boxGeo(len, 0.06, 0.25, 0.01), texturedMaterial('wood'));
    return buildProp(em, s, 'plank', {
      material: 'wood',
      object: m,
      colliders: [RAPIER.ColliderDesc.cuboid(len / 2, 0.03, 0.125)],
      mass: 8 * len,
      radius: len / 2,
      volume: len * 0.015,
    });
  });

  em.registerFactory('block', (s) => {
    const w = s.w ?? 0.8;
    const h = s.h ?? w;
    const d = s.d ?? w;
    const material = s.material ?? 'stone';
    const kind = material === 'brick' ? 'bricks' : 'stone';
    const m = mesh(boxGeo(w, h, d, 0.03), texturedMaterial(kind, { color: kind === 'bricks' ? 0xb8735a : 0xa89e92, key: `block-${kind}` }));
    return buildProp(em, s, 'block', {
      material,
      object: m,
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)],
      radius: Math.max(w, h, d) * 0.7,
      volume: w * h * d,
    });
  });

  em.registerFactory('boulder', (s) => {
    const r = s.w ?? 0.8;
    const geo = cachedGeometry(`boulder|${r}`, () => rockGeometry(r, 7));
    const m = mesh(geo, texturedMaterial('stone', { color: 0xa09890, key: 'boulder' }));
    return buildProp(em, s, 'boulder', {
      material: 'stone',
      object: m,
      colliders: [RAPIER.ColliderDesc.ball(r * 0.92)],
      radius: r,
      volume: (4 / 3) * Math.PI * r * r * r,
      angularDamping: 0.4,
    });
  });

  em.registerFactory('iceBlock', (s) => {
    const w = s.w ?? 1;
    const h = s.h ?? w;
    const d = s.d ?? w;
    const m = mesh(boxGeo(w, h, d, 0.06), iceMaterial());
    return buildProp(em, s, 'iceBlock', {
      material: 'ice',
      object: m,
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)],
      radius: Math.max(w, h, d) * 0.7,
      volume: w * h * d,
    });
  });

  em.registerFactory('ball', (s) => {
    const r = s.w ?? 0.35;
    const m = mesh(
      cachedGeometry(`ball|${r}`, () => new THREE.SphereGeometry(r, 20, 14)),
      plainMaterial('rubberBall', { color: 0xd8452f, roughness: 0.5 }),
    );
    return buildProp(em, s, 'ball', {
      material: 'rubber',
      object: m,
      colliders: [RAPIER.ColliderDesc.ball(r)],
      radius: r,
      volume: (4 / 3) * Math.PI * r ** 3,
      mass: 2,
      angularDamping: 0.2,
    });
  });
}

export function iceMaterial(): THREE.MeshPhysicalMaterial {
  return physicalMaterial('ice', {
    color: 0xcfe9ff,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.55,
    thickness: 0.6,
    ior: 1.31,
    transparent: true,
    opacity: 0.92,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
}

/** Lumpy rock geometry (deterministic per seed). */
export function rockGeometry(r: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 - seed) * 0.12 + Math.sin(v.y * 4.3 + seed * 2) * 0.08;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y * 0.85, v.z);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + pos.getY(i) * 0.5, pos.getZ(i) + pos.getY(i) * 0.5);
  return g;
}
