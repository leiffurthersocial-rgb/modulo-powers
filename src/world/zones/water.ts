import * as THREE from 'three';
import { LAKE, RIVER, WORLD, ZONES } from '../../config/map';
import type { Game, GameSystem } from '../../core/Game';
import { signBoard, textTexture, type StaticBuilder } from './build';
import { texturedMaterial } from '../props/assets';

/** Polar helper around the lake, measured from the direction facing the hub. */
function lakePoint(game: Game, angleOffset: number, dist: number, minHeight?: number): THREE.Vector3 {
  const base = Math.atan2(ZONES.hub.x - LAKE.x, ZONES.hub.z - LAKE.z);
  const a = base + angleOffset;
  let d = dist;
  let x = LAKE.x + Math.sin(a) * d;
  let z = LAKE.z + Math.cos(a) * d;
  if (minHeight !== undefined) {
    while (game.world.heightAt(x, z) < minHeight && d < dist + 30) {
      d += 1;
      x = LAKE.x + Math.sin(a) * d;
      z = LAKE.z + Math.cos(a) * d;
    }
  }
  return new THREE.Vector3(x, game.world.heightAt(x, z), z);
}

/**
 * Water Zone: the big lake with a dock and floating crates, an island you
 * reach by freezing a bridge (or water-walking), three braziers to douse that
 * open a shrine, and a river with a current and a waterwheel.
 */
export function buildWaterStatic(game: Game, sb: StaticBuilder) {
  const wood = sb.material('planks', { color: 0xb09070 });
  const stone = sb.material('stone', { color: 0x9a9a92 });
  const toHub = Math.atan2(ZONES.hub.x - LAKE.x, ZONES.hub.z - LAKE.z);
  const dir = new THREE.Vector3(Math.sin(toHub), 0, Math.cos(toHub));

  // Dock: from the shore out over the water.
  const land = lakePoint(game, 0, 34, 0.6);
  const deckY = WORLD.waterLevel + 0.75;
  const len = 18;
  const mid = land.clone().addScaledVector(dir, -len / 2 + 1);
  sb.box(mid.clone().setY(deckY), [3, 0.25, len], wood, { ry: toHub, uvScale: 1.2 });
  for (let i = 0; i <= 4; i++) {
    for (const side of [-1.3, 1.3]) {
      const p = land.clone().addScaledVector(dir, -i * (len / 4) + 1).add(new THREE.Vector3(Math.cos(toHub) * side, 0, -Math.sin(toHub) * side));
      sb.box(p.setY(deckY - 2.5), [0.25, 5, 0.25], wood, { collide: false });
    }
  }

  // Island in the middle of the lake.
  sb.cylinder(new THREE.Vector3(LAKE.x, -3, LAKE.z), 5, 8, stone, { segments: 14 });

  // Shrine (gate opens when all three braziers are doused).
  const sp = lakePoint(game, 0.75, 48, 1);
  const sy = sp.y;
  const ry = Math.atan2(LAKE.x - sp.x, LAKE.z - sp.z);
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const at = (lx: number, lz: number, up: number) => new THREE.Vector3(sp.x + lx * c + lz * s, sy + up, sp.z - lx * s + lz * c);
  const brick = sb.material('bricks', { color: 0x8a9aa8, phase: true });
  sb.box(at(0, -2.5, 1.5), [5, 3.4, 0.5], brick, { ry, phase: true });
  sb.box(at(-2.5, 0, 1.5), [0.5, 3.4, 5], brick, { ry, phase: true });
  sb.box(at(2.5, 0, 1.5), [0.5, 3.4, 5], brick, { ry, phase: true });
  sb.box(at(-1.75, 2.5, 1.5), [1.5, 3.4, 0.5], brick, { ry, phase: true });
  sb.box(at(1.75, 2.5, 1.5), [1.5, 3.4, 0.5], brick, { ry, phase: true });
  sb.box(at(0, 0, 3.3), [5.6, 0.3, 5.6], stone, { ry });

  // Mill house by the river.
  const rp = RIVER.points[2];
  const mill = new THREE.Vector3(rp[0] - 8, 0, rp[1] + 3);
  mill.y = game.world.heightAt(mill.x, mill.z);
  sb.box(mill.clone().setY(mill.y + 1.8), [5, 4, 5], wood, { phase: true });

  const tex = textTexture(
    ['Freeze the lake to bridge to the island.', 'Douse the three braziers to open the shrine.', 'Tidal Wave to surf; Hydro Shield to walk on water.', 'Water + Earth = mud. Water conducts lightning!'],
    { title: 'WATER ZONE', accent: '#3fa9f5', w: 1024, h: 360, font: 36 },
  );
  const signPos = lakePoint(game, -0.25, 44, 1);
  signBoard(game, sb, signPos, toHub, tex, [4, 1.4]);
  game.checkpoints.add(lakePoint(game, -0.12, 46, 1), 'Water Zone', 0x3fa9f5);
  game.systems.push(new Waterwheel(game));
}

export function spawnWater(game: Game) {
  const toHub = Math.atan2(ZONES.hub.x - LAKE.x, ZONES.hub.z - LAKE.z);
  const dir = new THREE.Vector3(Math.sin(toHub), 0, Math.cos(toHub));
  const land = lakePoint(game, 0, 34, 0.6);
  // Floating crates and barrels around the dock end.
  for (let i = 0; i < 6; i++) {
    const p = land.clone().addScaledVector(dir, -18 - (i % 3) * 2.2).add(new THREE.Vector3(Math.cos(toHub) * (i < 3 ? 3 : -3.5), 0, -Math.sin(toHub) * (i < 3 ? 3 : -3.5)));
    game.entities.spawn({ type: i % 2 ? 'barrel' : 'crate', x: p.x, y: WORLD.waterLevel + 0.4, z: p.z, ry: i });
  }
  // Dummies on the dock (sweep them off with a Tidal Wave).
  const dockEnd = land.clone().addScaledVector(dir, -14);
  game.entities.spawn({ type: 'dummy', x: dockEnd.x, y: WORLD.waterLevel + 0.88, z: dockEnd.z });
  // Island treasure.
  game.entities.spawn({ type: 'treasure', x: LAKE.x, y: 1.0, z: LAKE.z, data: { color: 0x3fa9f5, message: 'You reached the island!' } });
  // Braziers along the shore + shrine gate.
  for (let i = 0; i < 3; i++) {
    const p = lakePoint(game, 0.35 + i * 0.18, 38, 0.8);
    game.entities.spawn({ type: 'brazier', x: p.x, y: p.y, z: p.z, data: { signal: `brazier${i + 1}` } });
  }
  const sp = lakePoint(game, 0.75, 48, 1);
  const ry = Math.atan2(LAKE.x - sp.x, LAKE.z - sp.z);
  const gx = sp.x + 2.5 * Math.sin(ry);
  const gz = sp.z + 2.5 * Math.cos(ry);
  game.entities.spawn({ type: 'gate', x: gx, y: sp.y, z: gz, ry, w: 2, h: 3, data: { signals: ['brazier1', 'brazier2', 'brazier3'], message: 'All braziers doused — the shrine opens!' } });
  game.entities.spawn({ type: 'treasure', x: sp.x, y: sp.y, z: sp.z, data: { color: 0x3fa9f5, message: 'Shrine treasure found!' } });
  // Driftwood in the river (watch the current carry it).
  for (let i = 0; i < 3; i++) {
    const [x, z] = RIVER.points[1 + i];
    game.entities.spawn({ type: 'plank', x: x + 1, y: WORLD.waterLevel + 0.3, z, ry: i, w: 2.4 });
  }
}

/** A waterwheel turned by the river current (stops if you dam the river). */
class Waterwheel implements GameSystem {
  private wheel = new THREE.Group();
  private pos: THREE.Vector3;
  private flow = new THREE.Vector3();

  constructor(private game: Game) {
    const rp = RIVER.points[2];
    const next = RIVER.points[3];
    this.pos = new THREE.Vector3(rp[0] - 4.2, WORLD.waterLevel + 1.2, rp[1] + 1.5);
    const wood = texturedMaterial('planks', { color: 0x9a7a5a, key: 'wheelWood' });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.12, 6, 24), wood);
    this.wheel.add(rim);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 1.2), wood);
      paddle.position.set(Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0);
      paddle.rotation.z = a;
      this.wheel.add(paddle);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.08), wood);
      spoke.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0);
      spoke.rotation.z = a;
      this.wheel.add(spoke);
    }
    this.wheel.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    const holder = new THREE.Group();
    holder.position.copy(this.pos);
    holder.rotation.y = Math.atan2(next[0] - rp[0], next[1] - rp[1]) + Math.PI / 2;
    holder.add(this.wheel);
    game.scene.add(holder);
  }

  update(dt: number) {
    const cur = this.game.water.current(this.pos.x + 3, this.pos.z, this.flow).length();
    this.wheel.rotation.z -= dt * cur * 0.35;
  }
}
