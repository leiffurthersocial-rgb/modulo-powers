import * as THREE from 'three';
import { ZONES } from '../../config/map';
import type { Game } from '../../core/Game';
import { mesh, texturedMaterial, cylGeo } from '../props/assets';

/**
 * Hub: stone plaza at spawn with training dummies and a few physics props.
 * Static decoration is built once; props go through `entities.spawn` so the
 * reset system can restore them.
 */
export function buildHubStatic(game: Game) {
  const hub = ZONES.hub;
  const y = game.world.heightAt(hub.x, hub.z);
  const plaza = mesh(cylGeo(20, 20.5, 0.4, 48), texturedMaterial('concrete', { repeat: 14, color: 0x8f8a82, key: 'plaza' }), false);
  plaza.position.set(hub.x, y - 0.17, hub.z);
  plaza.receiveShadow = true;
  game.scene.add(plaza);
  const ring = mesh(cylGeo(4, 4.2, 0.5, 32), texturedMaterial('stone', { key: 'plazaRing' }));
  ring.position.set(hub.x, y - 0.1, hub.z);
  game.scene.add(ring);
  game.addStaticCylinder(new THREE.Vector3(hub.x, y - 0.17, hub.z), 20, 0.2);
  game.addStaticCylinder(new THREE.Vector3(hub.x, y - 0.1, hub.z), 4, 0.25);
}

export function spawnHubProps(game: Game) {
  const hub = ZONES.hub;
  const em = game.entities;
  const gy = (x: number, z: number) => Math.max(game.world.heightAt(x, z), hub.height + 0.03);
  // Training dummies in an arc north of spawn.
  for (let i = 0; i < 3; i++) {
    const x = hub.x - 6 + i * 6;
    const z = hub.z - 12;
    em.spawn({ type: 'dummy', x, y: gy(x, z), z });
  }
  // Crate pyramid.
  const cx = hub.x + 10;
  const cz = hub.z - 3;
  let n = 0;
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const x = cx + (i - (3 - row) / 2) * 1.02;
      em.spawn({ type: 'crate', x, y: gy(cx, cz) + 0.5 + row * 1.001, z: cz, ry: (n++ % 3) * 0.01 });
    }
  }
  // Barrels and a few other props.
  em.spawn({ type: 'barrel', x: hub.x - 10, y: gy(hub.x - 10, hub.z - 2) + 0.46, z: hub.z - 2 });
  em.spawn({ type: 'metalBarrel', x: hub.x - 11, y: gy(hub.x - 11, hub.z - 3) + 0.46, z: hub.z - 3 });
  em.spawn({ type: 'metalBarrel', x: hub.x - 10.2, y: gy(hub.x - 10, hub.z - 3.8) + 0.46, z: hub.z - 3.8 });
  em.spawn({ type: 'hay', x: hub.x - 9, y: gy(hub.x - 9, hub.z + 4) + 0.31, z: hub.z + 4 });
  em.spawn({ type: 'hay', x: hub.x - 9, y: gy(hub.x - 9, hub.z + 4) + 0.92, z: hub.z + 4, ry: 0.2 });
  em.spawn({ type: 'metalCrate', x: hub.x + 12, y: gy(hub.x + 12, hub.z + 5) + 0.46, z: hub.z + 5 });
  em.spawn({ type: 'block', x: hub.x + 9, y: gy(hub.x + 9, hub.z + 7) + 0.41, z: hub.z + 7 });
  em.spawn({ type: 'boulder', x: hub.x + 14, y: gy(hub.x + 14, hub.z - 10) + 0.8, z: hub.z - 10, w: 0.9 });
  em.spawn({ type: 'ball', x: hub.x + 3, y: gy(hub.x + 3, hub.z + 3) + 0.4, z: hub.z + 3 });
  em.spawn({ type: 'iceBlock', x: hub.x - 4, y: gy(hub.x - 4, hub.z + 12) + 0.51, z: hub.z + 12 });
}
