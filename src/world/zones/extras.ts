import * as THREE from 'three';
import { EXTRAS } from '../../config/map';
import type { Game } from '../../core/Game';
import { signBoard, textTexture, type StaticBuilder } from './build';

const gy = (g: Game, x: number, z: number) => g.world.heightAt(x, z);

/** Direction of the shooting range (away from the hub, between Lightning and Fire). */
const RANGE_DIR = new THREE.Vector3(0.45, 0, -0.89).normalize();

/**
 * Shared challenge areas: a shooting range, a physics stress-test heap, a
 * parkour course and a combo challenge needing two powers.
 */
export function buildExtrasStatic(game: Game, sb: StaticBuilder) {
  const stone = sb.material('stone', { color: 0x9a948c });
  const wood = sb.material('planks', { color: 0xb09070 });
  const concrete = sb.material('concrete', { color: 0x9a9a9a });

  // ---- Shooting range: firing line + berm at the far end.
  const r = EXTRAS.shootingRange;
  const side = new THREE.Vector3(-RANGE_DIR.z, 0, RANGE_DIR.x);
  const ry = Math.atan2(RANGE_DIR.x, RANGE_DIR.z);
  const line = new THREE.Vector3(r.x, gy(game, r.x, r.z), r.z);
  sb.box(line.clone().setY(line.y + 0.5), [8, 1, 0.4], wood, { ry: ry + Math.PI / 2 });
  const far = line.clone().addScaledVector(RANGE_DIR, 78);
  far.y = gy(game, far.x, far.z);
  sb.box(far.clone().setY(far.y + 2.5), [20, 6, 2], stone, { ry: ry + Math.PI / 2 });
  void side;
  signBoard(
    game,
    sb,
    line.clone().addScaledVector(RANGE_DIR, -3).addScaledVector(side, 5),
    ry + Math.PI,
    textTexture(['Targets at 10, 20, 35, 50 and 70 m.', 'Bolts, fireballs, boulders, water jets...'], { title: 'SHOOTING RANGE', w: 1024, h: 256, font: 38 }),
    [4, 1],
  );

  // ---- Stress test: a walled pit full of props.
  const st = EXTRAS.stressTest;
  const sy = gy(game, st.x, st.z);
  for (const [dx, dz, w, d] of [
    [0, -8, 16, 0.5],
    [0, 8, 16, 0.5],
    [-8, 0, 0.5, 16],
    [8, 0, 0.5, 16],
  ] as const) {
    sb.box(new THREE.Vector3(st.x + dx, sy + 0.5, st.z + dz), [w, 1.6, d], concrete);
  }
  signBoard(game, sb, new THREE.Vector3(st.x + 10, sy, st.z + 9), Math.PI * 0.75, textTexture(['A heap of crates and barrels.', 'Quake it, blast it, wave it.'], { title: 'STRESS TEST', w: 1024, h: 256, font: 38 }), [3.6, 0.9]);

  // ---- Parkour course: platforms of rising height with gaps, ending on a high pillar.
  const pk = EXTRAS.parkour;
  const py = gy(game, pk.x, pk.z);
  const course: [number, number, number, number][] = [
    // dx, dz, top height, size
    [0, 0, 0.8, 3],
    [0, 4.5, 1.6, 2.5],
    [3.5, 8, 2.4, 2],
    [7.5, 9, 3.2, 1.6],
    [11, 12, 3.6, 1.2],
    [11, 16.5, 4.4, 2],
    [7, 20, 5.2, 1.4],
    [3, 22, 6.0, 1.4],
    [-1.5, 24, 6.8, 1.6],
    [-6, 24, 7.6, 2.5],
  ];
  for (const [dx, dz, h, s] of course) {
    const base = gy(game, pk.x + dx, pk.z + dz);
    const hh = py + h - base + 0.5;
    sb.box(new THREE.Vector3(pk.x + dx, base + hh / 2 - 0.5, pk.z + dz), [s, hh, s], stone);
  }
  // Balance beam to the final tower.
  const last = course[course.length - 1];
  sb.box(new THREE.Vector3(pk.x - 12, py + 7.45, pk.z + 24), [8, 0.3, 0.35], wood);
  const tb = gy(game, pk.x - 18, pk.z + 24);
  sb.box(new THREE.Vector3(pk.x - 18, (tb + py + 7.6) / 2 - 0.25, pk.z + 24), [3, py + 7.6 - tb + 0.5, 3], stone);
  void last;
  game.checkpoints.add(new THREE.Vector3(pk.x, py + 0.8, pk.z), 'Parkour start', 0xffd23f);
  game.checkpoints.add(new THREE.Vector3(pk.x + 11, py + 4.4, pk.z + 16.5), 'Parkour midway', 0xffd23f);
  signBoard(game, sb, new THREE.Vector3(pk.x + 4, py, pk.z - 4), Math.PI, textTexture(['Jump, sprint-jump and use your powers:', 'Fire Thrust, Lightning Step, Pillars, Blink.'], { title: 'PARKOUR', w: 1024, h: 256, font: 38 }), [3.6, 0.9]);

  // ---- Combo challenge: a vault that needs power AND water.
  const cb = EXTRAS.combo;
  const cy = gy(game, cb.x, cb.z);
  const brick = sb.material('bricks', { color: 0x8a8a96, phase: true });
  const w = (dx: number, dz: number, ww: number, dd: number) => sb.box(new THREE.Vector3(cb.x + dx, cy + 1.8, cb.z + dz), [ww, 4.4, dd], brick, { phase: true });
  w(0, -4, 8.6, 0.6);
  w(-4, 0, 0.6, 8.6);
  w(4, 0, 0.6, 8.6);
  w(-2.7, 4, 3.2, 0.6);
  w(2.7, 4, 3.2, 0.6);
  sb.box(new THREE.Vector3(cb.x, cy + 4.1, cb.z), [9, 0.4, 9], concrete);
  signBoard(
    game,
    sb,
    new THREE.Vector3(cb.x + 6, cy, cb.z + 9),
    Math.PI * 0.2,
    textTexture(['This vault needs BOTH:', '• the generator powered (Lightning)', '• the basin filled (Water Jet)'], { title: 'COMBO CHALLENGE', w: 1024, h: 320, font: 40 }),
    [3.6, 1.1],
  );
}

export function spawnExtras(game: Game) {
  const em = game.entities;
  // Shooting range targets.
  const r = EXTRAS.shootingRange;
  const side = new THREE.Vector3(-RANGE_DIR.z, 0, RANGE_DIR.x);
  const ry = Math.atan2(RANGE_DIR.x, RANGE_DIR.z);
  [10, 20, 35, 50, 70].forEach((d, i) => {
    const p = new THREE.Vector3(r.x, 0, r.z).addScaledVector(RANGE_DIR, d).addScaledVector(side, (i % 2 ? 1 : -1) * (1 + i));
    em.spawn({ type: 'target', x: p.x, y: gy(game, p.x, p.z), z: p.z, ry: ry + Math.PI, data: { distance: d } });
  });
  // Stress-test heap.
  const st = EXTRAS.stressTest;
  const sy = gy(game, st.x, st.z);
  let n = 0;
  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < 5 - layer; i++) {
      for (let j = 0; j < 4 - layer; j++) {
        const x = st.x - 3 + i * 1.05 + layer * 0.5;
        const z = st.z - 2 + j * 1.05 + layer * 0.5;
        const type = n % 7 === 3 ? 'metalCrate' : 'crate';
        em.spawn({ type, x, y: sy + 0.5 + layer * 1.0, z, data: { sleep: true } });
        n++;
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    em.spawn({ type: i % 3 === 0 ? 'metalBarrel' : 'barrel', x: st.x + 4.5 + Math.cos(a) * 1.5, y: sy + 0.46, z: st.z + 3 + Math.sin(a) * 1.5, data: { sleep: true } });
  }
  for (let i = 0; i < 6; i++) em.spawn({ type: 'ball', x: st.x - 5 + i * 0.8, y: sy + 0.4, z: st.z + 5 });
  em.spawn({ type: 'hay', x: st.x + 5, y: sy + 0.31, z: st.z - 5 });

  // Parkour reward.
  const pk = EXTRAS.parkour;
  const py = gy(game, pk.x, pk.z);
  em.spawn({ type: 'treasure', x: pk.x - 18, y: py + 7.6, z: pk.z + 24, data: { message: 'Parkour complete!' } });

  // Combo challenge.
  const cb = EXTRAS.combo;
  const cy = gy(game, cb.x, cb.z);
  em.spawn({ type: 'generator', x: cb.x - 7, y: gy(game, cb.x - 7, cb.z + 7) + 0.7, z: cb.z + 7, data: { signal: 'comboPower', duration: 40 } });
  em.spawn({ type: 'basin', x: cb.x + 7, y: gy(game, cb.x + 7, cb.z + 7), z: cb.z + 7, data: { signal: 'comboWater' } });
  em.spawn({ type: 'gate', x: cb.x, y: cy, z: cb.z + 4, w: 2.2, h: 3, data: { signals: ['comboPower', 'comboWater'], message: 'Combo complete — the vault opens!' } });
  em.spawn({ type: 'treasure', x: cb.x, y: cy, z: cb.z, data: { color: 0xffffff, message: 'Combo challenge treasure!' } });
}
