import * as THREE from 'three';
import { ZONES } from '../../config/map';
import type { Game } from '../../core/Game';
import { signBoard, textTexture, type StaticBuilder } from './build';
import { ZoneKit } from './common';
import { platformWithStairs } from './lightning';

/** Ring wall (octagon-ish) built from static boxes. */
export function ringWall(sb: StaticBuilder, center: THREE.Vector3, radius: number, height: number, thick: number, mat: THREE.Material, opts: { sides?: number; gapAt?: number; phase?: boolean } = {}) {
  const sides = opts.sides ?? 10;
  const seg = 2 * radius * Math.tan(Math.PI / sides) + thick * 0.6;
  for (let i = 0; i < sides; i++) {
    if (opts.gapAt === i) continue;
    const a = (i / sides) * Math.PI * 2;
    const c = new THREE.Vector3(center.x + Math.sin(a) * (radius + thick / 2), center.y + height / 2, center.z + Math.cos(a) * (radius + thick / 2));
    sb.box(c, [seg, height, thick], mat, { ry: a, phase: opts.phase });
  }
}

/**
 * Fire Zone: a wooden village that burns and collapses, a dry grass field
 * with hay bales, an ice wall to melt, a ruined tower with wooden upper
 * floors, and a deep pit you need Fire Thrust to escape.
 */
export function buildFireStatic(game: Game, sb: StaticBuilder) {
  const k = new ZoneKit(game, ZONES.fire);
  const stone = sb.material('stone', { color: 0xa09080 });
  const brick = sb.material('bricks', { color: 0xb09080, phase: true });

  // Ice-wall hut: stone room whose doorway is sealed by a thick ice block (entity).
  const hut = { dx: 32, dz: 2 };
  const hy = k.gy(hut.dx, hut.dz);
  const hw = (dx: number, dz: number, w: number, d: number) => sb.box(k.p(hut.dx + dx, hut.dz + dz).setY(hy + 1.6), [w, 3.6, d], brick, { phase: true });
  hw(0, -3, 6.4, 0.6);
  hw(0, 3, 6.4, 0.6);
  hw(3, 0, 0.6, 6.4);
  hw(-3, -2, 0.6, 2.4);
  hw(-3, 2, 0.6, 2.4);
  sb.box(k.p(hut.dx, hut.dz).setY(hy + 3.5), [7, 0.4, 7], stone);

  // Ruined tower: stone ring base (wooden upper floors are burnable entities).
  const tw = k.p(-22, -30);
  ringWall(sb, tw, 3, 3.2, 0.7, stone, { sides: 8, gapAt: 2, phase: false });

  // The pit: 7 m deep ring wall with stairs up to the rim from outside.
  const pit = k.p(36, -34);
  ringWall(sb, pit, 6, 7, 1.2, stone, { sides: 12 });
  platformWithStairs(sb, k, 36 - 9, -34, 2.4, 7, 'w', stone);

  const tex = textTexture(
    ['Burn the wooden village — fire spreads and', 'houses collapse. Melt the ice wall (east).', 'Climb the pit rim, drop in, Fire Thrust out.', 'Douse fires with Water. Steam!'],
    { title: 'FIRE ZONE', accent: '#ff7a2f', w: 1024, h: 360, font: 36 },
  );
  const toHub = Math.atan2(ZONES.hub.x - k.zone.x, ZONES.hub.z - k.zone.z);
  signBoard(game, sb, k.p(-42, 22), toHub, tex, [4, 1.4]);
  game.checkpoints.add(k.p(-46, 17), 'Fire Zone', 0xff7a2f);
}

export function spawnFire(game: Game) {
  const k = new ZoneKit(game, ZONES.fire);
  // Wooden houses: four walls (one with a doorway) and a flat roof, all burnable.
  const house = (dx: number, dz: number, ry: number) => {
    const y = k.gy(dx, dz);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const place = (lx: number, lz: number) => ({ x: k.x(dx + lx * c + lz * s), z: k.z(dz - lx * s + lz * c) });
    const H = 2.6;
    const wall = (lx: number, lz: number, w: number, rot: number) => {
      const p = place(lx, lz);
      game.entities.spawn({ type: 'woodPanel', x: p.x, y: y + H / 2, z: p.z, w, h: H, d: 0.16, ry: ry + rot });
    };
    wall(0, -2, 5, 0);
    wall(0, 2, 5, 0);
    wall(2.5, 0, 4, Math.PI / 2);
    wall(-2.5, -1.3, 1.4, Math.PI / 2);
    wall(-2.5, 1.3, 1.4, Math.PI / 2);
    const r = place(0, 0);
    game.entities.spawn({ type: 'woodPanel', x: r.x, y: y + H + 0.1, z: r.z, w: 5.4, h: 0.16, d: 4.4, ry, data: { phase: false } });
    const inside = place(1, 0.6);
    game.entities.spawn({ type: 'crate', x: inside.x, y: y + 0.5, z: inside.z });
    const hay = place(1, -1);
    game.entities.spawn({ type: 'hay', x: hay.x, y: y + 0.31, z: hay.z, ry });
    const door = place(-3.5, 1);
    game.entities.spawn({ type: 'barrel', x: door.x, y: y + 0.46, z: door.z });
  };
  house(-15, 10, 0.2);
  house(-3, -12, -0.3);
  house(12, 12, 0.5);
  house(14, -14, 0.1);

  // Hay field.
  for (let i = 0; i < 12; i++) {
    const dx = -12 + (i % 4) * 5 + Math.sin(i * 7.3) * 1.2;
    const dz = 26 + Math.floor(i / 4) * 4 + Math.cos(i * 3.1);
    k.spawn('hay', dx, dz, 0.31, { ry: i * 0.7 });
    if (i % 3 === 0) k.spawn('hay', dx, dz, 0.92, { ry: i * 0.7 + 0.3 });
  }
  // Fence line (burnable).
  for (let i = 0; i < 6; i++) k.spawn('woodPanel', -20 + i * 3.1, 21, 0.5, { w: 3, h: 1, d: 0.1 });

  // Ice wall sealing the stone hut + the prize inside.
  k.spawn('iceBlock', 29, 2, 1.45, { w: 0.8, h: 2.9, d: 2.6, fixed: true });
  k.spawn('treasure', 33, 2, 0, { data: { color: 0xff7a2f, message: 'You melted your way in!' } });

  // Ruined tower: wooden floor + upper walls on the stone ring.
  const tw = { dx: -22, dz: -30 };
  const ty = k.gy(tw.dx, tw.dz);
  game.entities.spawn({ type: 'woodPanel', x: k.x(tw.dx), y: ty + 3.3, z: k.z(tw.dz), w: 6.6, h: 0.2, d: 6.6, data: { phase: false } });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    game.entities.spawn({ type: 'woodPanel', x: k.x(tw.dx + Math.sin(a) * 2.6), y: ty + 4.7, z: k.z(tw.dz + Math.cos(a) * 2.6), w: 3.4, h: 2.6, d: 0.16, ry: a });
  }
  game.entities.spawn({ type: 'woodPanel', x: k.x(tw.dx), y: ty + 6.1, z: k.z(tw.dz), w: 6, h: 0.18, d: 6, data: { phase: false } });
  k.spawn('crate', tw.dx, tw.dz, 3.95);

  // The pit's prize.
  k.spawn('treasure', 36, -34, 0, { data: { color: 0xff7a2f, message: 'Now Fire Thrust your way out!' } });
  // Barrels and crates around.
  for (let i = 0; i < 5; i++) k.spawn('barrel', 2 + i * 1.1, 2, 0.46);
  k.spawn('metalCrate', 0, 6, 0.46);
  k.spawn('dummy', -8, 4);
  k.spawn('dummy', 6, -4);
}
