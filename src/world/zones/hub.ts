import * as THREE from 'three';
import { ZONES, ZONE_LIST } from '../../config/map';
import type { Game } from '../../core/Game';
import { cylGeo, mesh, texturedMaterial } from '../props/assets';
import { signBoard, textTexture, type StaticBuilder } from './build';

/**
 * Hub: stone plaza at spawn with a signpost per zone, the power hint board,
 * a respawn checkpoint and some training dummies / physics props.
 */
export function buildHubStatic(game: Game, sb: StaticBuilder) {
  const hub = ZONES.hub;
  const y = game.world.heightAt(hub.x, hub.z);
  const plaza = mesh(cylGeo(20, 20.5, 0.4, 48), texturedMaterial('concrete', { repeat: 14, color: 0x8f8a82, key: 'plaza' }), false);
  plaza.position.set(hub.x, y - 0.17, hub.z);
  game.scene.add(plaza);
  const ring = mesh(cylGeo(4, 4.2, 0.5, 32), texturedMaterial('stone', { key: 'plazaRing' }));
  ring.position.set(hub.x, y - 0.1, hub.z);
  game.scene.add(ring);
  game.addStaticCylinder(new THREE.Vector3(hub.x, y - 0.17, hub.z), 20, 0.2);
  game.addStaticCylinder(new THREE.Vector3(hub.x, y - 0.1, hub.z), 4, 0.25);

  // Signposts around the plaza pointing at each zone.
  for (const z of ZONE_LIST) {
    if (z.id === 'hub') continue;
    const ang = Math.atan2(z.x - hub.x, z.z - hub.z);
    const pos = new THREE.Vector3(hub.x + Math.sin(ang) * 17, y, hub.z + Math.cos(ang) * 17);
    const tex = textTexture([`→ ${Math.round(Math.hypot(z.x - hub.x, z.z - hub.z))} m`, `Teleport: T then ${z.key}`], {
      title: z.name,
      accent: z.color,
      w: 512,
      h: 256,
    });
    // Face the board back towards the plaza centre.
    signBoard(game, sb, pos, ang + Math.PI, tex, [2.6, 1.3]);
  }

  // Power hint board.
  const board = textTexture(
    [
      '1  Lightning — strike, chain, dash, storm',
      '2  Fire — fireball, flamethrower, wall, thrust',
      '3  Water — jet, wave, freeze, shield',
      '4  Earth — pillar, boulder, quake, armour',
      '5  Shadow — invisible, blink, phase, clone',
      'Q / E cycle powers · Z X C B use abilities',
      'H help · P pause · R reset · T teleport · N night',
    ],
    { title: 'MODULO: POWERS', w: 1024, h: 512, font: 40 },
  );
  signBoard(game, sb, new THREE.Vector3(hub.x - 9, y, hub.z + 13), Math.PI * 0.85, board, [4.2, 2.1]);

  // Respawn checkpoint marker at spawn.
  game.checkpoints.add(game.world.spawn.clone(), 'Hub', 0xe8e2d0);
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
      em.spawn({ type: 'crate', x, y: gy(cx, cz) + 0.5 + row * 1.001, z: cz, ry: (n++ % 3) * 0.01, data: { sleep: true } });
    }
  }
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
