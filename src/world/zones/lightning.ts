import * as THREE from 'three';
import { POND, ZONES } from '../../config/map';
import type { Game } from '../../core/Game';
import { POND_LEVEL } from '../terrainShape';
import { signBoard, textTexture, type StaticBuilder } from './build';
import { ZoneKit } from './common';

/** Static parts of a raised platform with stairs on one side. */
export function platformWithStairs(sb: StaticBuilder, k: ZoneKit, dx: number, dz: number, size: number, height: number, stairDir: 'n' | 's' | 'e' | 'w', mat: THREE.Material) {
  const base = k.gy(dx, dz);
  sb.box(k.p(dx, dz).setY(base + height / 2 - 0.5), [size, height + 1, size], mat, { uvScale: 2 });
  const steps = Math.ceil(height / 0.38);
  const rise = height / steps;
  for (let i = 0; i < steps; i++) {
    const t = size / 2 + 0.3 + (steps - 1 - i) * 0.55;
    const ox = stairDir === 'e' ? t : stairDir === 'w' ? -t : 0;
    const oz = stairDir === 's' ? t : stairDir === 'n' ? -t : 0;
    const h = (i + 1) * rise;
    const w: [number, number, number] = stairDir === 'e' || stairDir === 'w' ? [0.56, h + 1, 2.4] : [2.4, h + 1, 0.56];
    sb.box(k.p(dx + ox, dz + oz).setY(base + h / 2 - 0.5), w, mat, { uvScale: 2 });
  }
  return base + height;
}

/**
 * Lightning Zone: metal towers with rods, a generator that powers a gate and
 * the zone's lamps, twin lightning rods for a second gate, a metal bridge over
 * a pond (electrify the water!) and a gap to cross with Lightning Step.
 */
export function buildLightningStatic(game: Game, sb: StaticBuilder) {
  const k = new ZoneKit(game, ZONES.lightning);
  const concrete = sb.material('concrete', { color: 0x9a9a9a });
  const plate = sb.material('metal', { color: 0x6d7680, metal: true });

  // Power station: walled yard with a generator-operated gate (gate is an entity).
  const yard = { dx: -10, dz: -28, w: 14, d: 10, h: 3 };
  const y0 = k.gy(yard.dx, yard.dz);
  const wall = (dx: number, dz: number, w: number, d: number) => sb.box(k.p(dx, dz).setY(y0 + yard.h / 2 - 0.3), [w, yard.h + 0.6, d], concrete, { phase: true });
  wall(yard.dx, yard.dz - yard.d / 2, yard.w, 0.5); // north
  wall(yard.dx - yard.w / 2, yard.dz, 0.5, yard.d); // west
  wall(yard.dx + yard.w / 2, yard.dz, 0.5, yard.d); // east
  wall(yard.dx - 4.5, yard.dz + yard.d / 2, 5, 0.5); // south, left of gate
  wall(yard.dx + 4.5, yard.dz + yard.d / 2, 5, 0.5); // south, right of gate
  sb.box(k.p(yard.dx, yard.dz).setY(y0 + yard.h + 0.2), [yard.w + 0.5, 0.3, yard.d + 0.5], plate, { phase: false });

  // Rod bunker: opens when both rods are charged at the same time.
  const bk = { dx: 36, dz: -36 };
  const by = k.gy(bk.dx, bk.dz);
  const bwall = (dx: number, dz: number, w: number, d: number) => sb.box(k.p(bk.dx + dx, bk.dz + dz).setY(by + 1.6), [w, 3.8, d], concrete, { phase: true });
  bwall(0, -4, 8, 0.6);
  bwall(4, 0, 0.6, 8);
  bwall(0, 4, 8, 0.6);
  bwall(-4, -2.75, 0.6, 2.5);
  bwall(-4, 2.75, 0.6, 2.5);
  sb.box(k.p(bk.dx, bk.dz).setY(by + 3.6), [8.6, 0.4, 8.6], plate);

  // Gap for Lightning Step: two raised platforms 9 m apart (edge to edge).
  const top1 = platformWithStairs(sb, k, -42, 0, 7, 4, 'e', plate);
  platformWithStairs(sb, k, -42, -16, 7, 4, 'n', plate);
  void top1;

  // Metal bridge across the pond, with stairs at both ends.
  const deckY = POND_LEVEL + 1.4;
  const pdx = POND.x - k.zone.x;
  const pdz = POND.z - k.zone.z;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const h = deckY - k.gy(pdx + side * (POND.radius + 1.5 + i * 0.6), pdz) - i * 0.35;
      if (h <= 0.1) continue;
      sb.box(k.p(pdx + side * (POND.radius + 1.2 + i * 0.6), pdz).setY(deckY - i * 0.35 - 0.12), [0.6, 0.25, 2.4], plate);
    }
    // Support posts in the water.
    for (const ox of [-6, 0, 6]) sb.box(new THREE.Vector3(POND.x + ox, POND_LEVEL - 1, POND.z + side * 1.1), [0.25, 4.6, 0.25], plate);
  }

  // Signs.
  const tex = textTexture(
    ['Hit the GENERATOR with lightning to open', 'the power station and light the zone.', 'Charge BOTH rods (Storm Call!) for the bunker.', 'Electrify the pond. Lightning Step the gap.'],
    { title: 'LIGHTNING ZONE', accent: '#7fd4ff', w: 1024, h: 360, font: 36 },
  );
  signBoard(game, sb, k.p(7, 40), 0, tex, [4, 1.4]);
  game.checkpoints.add(k.p(0, 44), 'Lightning Zone', 0x7fd4ff);
}

export function spawnLightning(game: Game) {
  const k = new ZoneKit(game, ZONES.lightning);
  // Metal lattice towers topped with rods.
  const tower = (dx: number, dz: number, h: number) => {
    const y = k.gy(dx, dz);
    for (const [ox, oz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      game.entities.spawn({ type: 'beam', x: k.x(dx + ox), y: y + h / 2, z: k.z(dz + oz), w: 0.22, h, d: 0.22 });
    }
    for (let i = 1; i < 4; i++) {
      const yy = y + (h * i) / 4;
      game.entities.spawn({ type: 'beam', x: k.x(dx), y: yy, z: k.z(dz - 1), w: 2.1, h: 0.15, d: 0.15 });
      game.entities.spawn({ type: 'beam', x: k.x(dx), y: yy, z: k.z(dz + 1), w: 2.1, h: 0.15, d: 0.15 });
    }
    game.entities.spawn({ type: 'rod', x: k.x(dx), y: y + h, z: k.z(dz), h: 3 });
  };
  tower(-24, 14, 9);
  tower(-28, -46, 11);
  tower(14, -40, 8);

  // Generator + gate + lamps.
  k.spawn('generator', -4, -12, 0.7, { data: { signal: 'generator', duration: 30 } });
  k.spawn('gate', -10, -23, 0, { w: 4, h: 3.2, data: { signals: ['generator'], message: 'The power station gate opens!' } });
  k.spawn('treasure', -10, -30, 0, { data: { color: 0x7fd4ff, message: 'Power station: treasure found!' } });
  for (const [dx, dz] of [
    [-4, 30],
    [4, 20],
    [-4, 10],
    [4, 0],
    [-16, -16],
    [-4, -34],
  ]) {
    k.spawn('lamp', dx, dz, 0, { data: { signal: 'generator', color: 0xbfe4ff, intensity: 18, range: 16 } });
  }

  // Twin rods + bunker gate.
  k.spawn('rod', 22, -14, 0, { h: 7, data: { signal: 'rodA', duration: 25 } });
  k.spawn('rod', 30, -26, 0, { h: 7, data: { signal: 'rodB', duration: 25 } });
  k.spawn('gate', 32, -36, 0, { w: 3, h: 3.2, ry: Math.PI / 2, data: { signals: ['rodA', 'rodB'], message: 'Both rods charged — the bunker opens!' } });
  k.spawn('treasure', 36, -36, 0, { data: { color: 0x7fd4ff, message: 'Bunker treasure found!' } });

  // Things to electrify around the pond.
  const pdx = POND.x - k.zone.x;
  const pdz = POND.z - k.zone.z;
  k.spawn('dummy', pdx - POND.radius - 3, pdz + 4);
  k.spawn('dummy', pdx + 4, pdz + POND.radius + 3);
  for (let i = 0; i < 4; i++) k.spawn('metalBarrel', pdx - 6 + i * 1.3, pdz - POND.radius - 2.5, 0.46);
  k.spawn('metalCrate', pdx + POND.radius + 3, pdz - 4, 0.46);
  k.spawn('crate', pdx + POND.radius + 3, pdz - 2, 0.5);
  // A metal crate floating in the pond, a dummy standing in the shallows.
  game.entities.spawn({ type: 'crate', x: POND.x + 3, y: POND_LEVEL + 0.2, z: POND.z - 2 });
  game.entities.spawn({ type: 'dummy', x: POND.x - POND.radius * 0.7, y: game.world.heightAt(POND.x - POND.radius * 0.7, POND.z), z: POND.z });
  // Metal bridge deck (conductive beams) over the pond.
  const deckY = POND_LEVEL + 1.4;
  const span = POND.radius * 2 + 2.4;
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const x = POND.x - span / 2 + (i + 0.5) * (span / segs);
    game.entities.spawn({ type: 'beam', x, y: deckY - 0.1, z: POND.z, w: span / segs - 0.04, h: 0.2, d: 2.4 });
  }
  // The gap's far platform holds a reward.
  k.spawn('treasure', -42, -16, 4.0, { data: { color: 0x7fd4ff, message: 'You crossed the gap!' } });
}
