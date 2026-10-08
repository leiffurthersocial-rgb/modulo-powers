import * as THREE from 'three';
import { ZONES } from '../../config/map';
import type { Game } from '../../core/Game';
import { signBoard, textTexture, type StaticBuilder } from './build';
import { ZoneKit } from './common';

/** Compound layout (relative to the zone centre). */
const C = { dx: -2, dz: 0, hw: 22, hd: 17, wallH: 4.5 };
const BARRACKS = { x0: -18, x1: -7, z0: -13, z1: -5, h: 3.6 };
const VAULT = { x0: 9, x1: 16, z0: -14, z1: -8, h: 3.4 };
const TOWER = { x0: -4, x1: 6, z0: 5, z1: 13, h: 7.5 };
const CORRIDOR = { x0: -21.4, x1: -18.6, z0: -1, z1: 14, h: 3 };

/**
 * Shadow Zone: a walled guard compound. Locked barracks and a vault (Phase
 * through the walls), a tall building with a prize on the roof (Shadow Blink
 * up), a dark roofed corridor, yard lamps that light up at night, patrolling
 * guards, and a lever outside to flip day/night.
 */
export function buildShadowStatic(game: Game, sb: StaticBuilder) {
  const k = new ZoneKit(game, ZONES.shadow);
  const wall = sb.material('bricks', { color: 0x7a7480, phase: true });
  const roof = sb.material('concrete', { color: 0x5a5660 });
  const floorY = k.gy(C.dx, C.dz);
  const rel = (x: number, z: number) => k.p(C.dx + x, C.dz + z).setY(floorY);
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, mat: THREE.Material, phase: boolean) => {
    const c = rel((x0 + x1) / 2, (z0 + z1) / 2);
    c.y = floorY + (y0 + y1) / 2;
    sb.box(c, [x1 - x0, y1 - y0, z1 - z0], mat, { phase, uvScale: 2 });
  };
  const t = 0.6;
  // Outer walls (gate gap on the east side, facing the hub). Extend below ground for slopes.
  box(-C.hw, C.hw, -C.hd - t, -C.hd, -1, C.wallH, wall, true);
  box(-C.hw, C.hw, C.hd, C.hd + t, -1, C.wallH, wall, true);
  box(-C.hw - t, -C.hw, -C.hd - t, C.hd + t, -1, C.wallH, wall, true);
  box(C.hw, C.hw + t, -C.hd - t, -2.2, -1, C.wallH, wall, true);
  box(C.hw, C.hw + t, 2.2, C.hd + t, -1, C.wallH, wall, true);
  // Sealed rooms: four walls + roof each (no doors: Phase in).
  const room = (r: { x0: number; x1: number; z0: number; z1: number; h: number }, th: number, door?: 'south') => {
    box(r.x0, r.x1, r.z0, r.z0 + th, -0.5, r.h, wall, true);
    if (door === 'south') {
      const mid = (r.x0 + r.x1) / 2;
      box(r.x0, mid - 1.1, r.z1 - th, r.z1, -0.5, r.h, wall, true);
      box(mid + 1.1, r.x1, r.z1 - th, r.z1, -0.5, r.h, wall, true);
      box(mid - 1.1, mid + 1.1, r.z1 - th, r.z1, 2.4, r.h, wall, true);
    } else {
      box(r.x0, r.x1, r.z1 - th, r.z1, -0.5, r.h, wall, true);
    }
    box(r.x0, r.x0 + th, r.z0, r.z1, -0.5, r.h, wall, true);
    box(r.x1 - th, r.x1, r.z0, r.z1, -0.5, r.h, wall, true);
    box(r.x0 - 0.2, r.x1 + 0.2, r.z0 - 0.2, r.z1 + 0.2, r.h, r.h + 0.35, roof, false);
  };
  room(BARRACKS, 0.5);
  room(VAULT, 1.0);
  room(TOWER, 0.5, 'south');
  // An inner floor in the tower so the roof is reachable only by blinking.
  box(TOWER.x0 + 0.5, TOWER.x1 - 0.5, TOWER.z0 + 0.5, TOWER.z1 - 0.5, 3.6, 3.85, roof, false);
  // Dark corridor along the west wall: roofed, open at both ends.
  box(CORRIDOR.x1, CORRIDOR.x1 + 0.4, CORRIDOR.z0, CORRIDOR.z1, -0.5, CORRIDOR.h, wall, true);
  box(CORRIDOR.x0 - 0.2, CORRIDOR.x1 + 0.5, CORRIDOR.z0, CORRIDOR.z1, CORRIDOR.h, CORRIDOR.h + 0.3, roof, false);
  // Crates as cover in the yard are entities (see spawn).

  const tex = textTexture(
    ['Sneak in. Guards see less in the dark —', 'press N (or the lever) for night.', 'Phase into the barracks & vault, Blink onto', 'the tower roof, use Clones as decoys.'],
    { title: 'SHADOW ZONE', accent: '#9b7bff', w: 1024, h: 360, font: 36 },
  );
  const toHub = Math.atan2(ZONES.hub.x - k.zone.x, ZONES.hub.z - k.zone.z);
  signBoard(game, sb, k.p(C.dx + C.hw + 7, C.dz + 6), toHub, tex, [4, 1.4]);
  game.checkpoints.add(k.p(C.dx + C.hw + 6, C.dz), 'Shadow Zone (gate)', 0x9b7bff);
}

export function spawnShadow(game: Game) {
  const k = new ZoneKit(game, ZONES.shadow);
  const floorY = k.gy(C.dx, C.dz);
  const at = (x: number, z: number) => ({ x: k.x(C.dx + x), z: k.z(C.dz + z) });
  const spawn = (type: string, x: number, z: number, up: number, extra: Record<string, unknown> = {}) => {
    const p = at(x, z);
    return game.entities.spawn({ type, x: p.x, y: floorY + up, z: p.z, ...extra });
  };
  const catchPos = at(C.hw + 6, 0);
  const catchSpawn: [number, number, number] = [catchPos.x, game.world.heightAt(catchPos.x, catchPos.z) + 0.2, catchPos.z];
  const wp = (pts: [number, number][]) => pts.map(([x, z]) => {
    const p = at(x, z);
    return [p.x, p.z];
  });
  // Guards and their patrol loops.
  const guard = (x: number, z: number, pts: [number, number][]) => spawn('guard', x, z, 0.1, { data: { waypoints: wp(pts), catch: catchSpawn } });
  guard(15, 0, [
    [17, 0],
    [17, 12],
    [8, 14],
    [8, 2],
  ]);
  guard(-4, -2, [
    [-4, -2],
    [6, -3],
    [6, -15],
    [-4, -15],
  ]);
  guard(-12, 2, [
    [-16, 2],
    [-16, 15],
    [-8, 15],
    [-8, 2],
  ]);
  guard(19, -10, [
    [19, -14],
    [19, -4],
  ]);
  // Gate sentry, just inside the entrance.
  guard(18, 3, [
    [19.5, 2.8],
    [19.5, -2.8],
  ]);

  // Treasures: in the barracks, in the vault, on the tower roof.
  spawn('treasure', (BARRACKS.x0 + BARRACKS.x1) / 2, (BARRACKS.z0 + BARRACKS.z1) / 2, 0, { data: { color: 0x9b7bff, message: 'You phased into the barracks!' } });
  spawn('treasure', (VAULT.x0 + VAULT.x1) / 2, (VAULT.z0 + VAULT.z1) / 2, 0, { data: { color: 0x9b7bff, message: 'Vault cracked — no door needed.' } });
  spawn('treasure', (TOWER.x0 + TOWER.x1) / 2, (TOWER.z0 + TOWER.z1) / 2, TOWER.h + 0.35, { data: { color: 0x9b7bff, message: 'Rooftop reached!' } });
  // Cover: crates and barrels in the yard.
  for (const [x, z] of [
    [10, 3],
    [11, 4],
    [-2, 0],
    [2, -6],
    [-10, 9],
    [14, 10],
  ] as const) {
    spawn('crate', x, z, 0.5);
  }
  for (const [x, z] of [
    [12, -3],
    [-14, -2],
  ] as const) spawn('barrel', x, z, 0.46);
  // Yard lamps (on at night) — light reveals you.
  for (const [x, z] of [
    [0, -8],
    [12, 6],
    [-10, -2],
    [18, -12],
  ] as const) spawn('lamp', x, z, 0, { h: 3.6, data: { intensity: 16, range: 13 } });
  // Day/night lever by the entrance (outside).
  const lv = at(C.hw + 3, 4);
  game.entities.spawn({ type: 'lever', x: lv.x, y: game.world.heightAt(lv.x, lv.z), z: lv.z, ry: -Math.PI / 2, data: { action: 'dayNight', label: 'Toggle day / night' } });
}

export const SHADOW_COMPOUND = C;
