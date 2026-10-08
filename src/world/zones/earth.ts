import { CANYON, ZONES } from '../../config/map';
import type { Game } from '../../core/Game';
import { signBoard, textTexture, type StaticBuilder } from './build';
import { ZoneKit } from './common';

/**
 * Earth Zone: cliffs and a deep canyon to cross with raised pillars,
 * destructible brick walls, unstable block stacks, boulders, a mud pit and
 * two pressure plates (400 kg each) that open a vault.
 */
export function buildEarthStatic(game: Game, sb: StaticBuilder) {
  const k = new ZoneKit(game, ZONES.earth);
  const stone = sb.material('stone', { color: 0x9a8070 });
  const brick = sb.material('bricks', { color: 0xa08470, phase: true });
  // Vault behind the plate-operated gate.
  const v = { dx: -2, dz: -34 };
  const vy = k.gy(v.dx, v.dz);
  const vw = (dx: number, dz: number, w: number, d: number) => sb.box(k.p(v.dx + dx, v.dz + dz).setY(vy + 1.7), [w, 3.8, d], brick, { phase: true });
  vw(0, -3.5, 7.4, 0.7);
  vw(-3.5, 0, 0.7, 7.4);
  vw(3.5, 0, 0.7, 7.4);
  vw(-2.4, 3.5, 2.6, 0.7);
  vw(2.4, 3.5, 2.6, 0.7);
  sb.box(k.p(v.dx, v.dz).setY(vy + 3.8), [8, 0.4, 8], stone);

  const tex = textTexture(
    ['Raise pillars from the canyon floor to cross it.', 'Smash walls with boulders, quake the stacks.', 'Two plates need 400 kg each: boulders, or', 'stand on one in Stone Armor.'],
    { title: 'EARTH ZONE', accent: '#c08a4a', w: 1024, h: 360, font: 36 },
  );
  const toHub = Math.atan2(ZONES.hub.x - k.zone.x, ZONES.hub.z - k.zone.z);
  signBoard(game, sb, k.p(30, -36), toHub, tex, [4, 1.4]);
  game.checkpoints.add(k.p(34, -40), 'Earth Zone', 0xc08a4a);
  // Mark the far side of the canyon.
  game.checkpoints.add(k.p(-30, 26), 'Far side of the canyon', 0xc08a4a);
  void CANYON;
}

export function spawnEarth(game: Game) {
  const k = new ZoneKit(game, ZONES.earth);
  // Destructible brick walls (pre-built, asleep until hit).
  const wall = (dx: number, dz: number, ry: number) => {
    const y = k.gy(dx, dz);
    const bw = 1.2;
    const bh = 0.6;
    const cols = 5;
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = 0; c < cols - (r % 2 ? 1 : 0); c++) {
        const lx = -((cols - 1) * bw) / 2 + c * bw + off;
        game.entities.spawn({
          type: 'block',
          x: k.x(dx) + Math.cos(ry) * lx,
          y: y + bh / 2 + r * (bh + 0.002),
          z: k.z(dz) - Math.sin(ry) * lx,
          ry,
          w: bw - 0.01,
          h: bh,
          d: 0.5,
          material: 'brick',
          data: { sleep: true },
        });
      }
    }
  };
  wall(16, -14, 0.6);
  wall(30, 8, -0.4);
  // Unstable stacks of stone blocks.
  for (const [dx, dz, n] of [
    [26, -4, 6],
    [34, 0, 5],
    [32, 12, 7],
  ] as const) {
    for (let i = 0; i < n; i++) k.spawn('block', dx + Math.sin(i * 2.1) * 0.06, dz, 0.4 + i * 0.801, { w: 0.8, ry: i * 0.3, data: { sleep: true } });
  }
  // Boulders.
  for (const [dx, dz, r] of [
    [8, -20, 0.9],
    [14, -26, 0.8],
    [20, -8, 1.1],
    [38, -18, 0.8],
    [14, -6, 0.7],
    [-14, -34, 0.9],
  ] as const) {
    k.spawn('boulder', dx, dz, r, { w: r });
  }
  // Pressure plates + vault gate.
  k.spawn('plate', 10, -26, 0, { data: { signal: 'plateA', mass: 400 } });
  k.spawn('plate', 16, -31, 0, { data: { signal: 'plateB', mass: 400 } });
  k.spawn('gate', -2, -30.5, 0, { w: 2.2, h: 3, data: { signals: ['plateA', 'plateB'], message: 'Both plates pressed — the vault opens!' } });
  k.spawn('treasure', -2, -34, 0, { data: { color: 0xc08a4a, message: 'Earth vault treasure!' } });
  // Mud pit.
  game.entities.spawn({ type: 'mudPit', x: k.x(36), y: k.gy(36, -28), z: k.z(-28), w: 4 });
  // Across the canyon.
  k.spawn('treasure', -30, 30, 0, { data: { color: 0xc08a4a, message: 'You crossed the canyon!' } });
  k.spawn('dummy', -24, 24);
}
