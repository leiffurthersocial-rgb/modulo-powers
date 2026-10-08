import * as THREE from 'three';
import { LAKE, RIVER, WORLD, ZONES } from '../config/map';
import { audio, type LoopHandle } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';

/**
 * Procedural ambient soundscape: wind (stronger up high), birds by day,
 * crickets at night, a river you can hear when near it, lake lapping, an
 * electric hum in the Lightning zone, crackling in the Fire zone and a low
 * drone around the Shadow compound. Loops are created lazily after the audio
 * context is unlocked.
 */
export class Ambience implements GameSystem {
  private wind: LoopHandle | null = null;
  private river: LoopHandle | null = null;
  private lake: LoopHandle | null = null;
  private hum: LoopHandle | null = null;
  private drone: LoopHandle | null = null;
  private timer = 0;
  private tmp = new THREE.Vector3();

  constructor(private game: Game) {}

  private ensure() {
    if (this.wind || !audio.ctx) return;
    this.wind = audio.loop({ freq: 500, filter: 'lowpass', brown: true, volume: 0.5, bus: 'ambient', lfo: { rate: 0.13, depth: 0.25 } });
    this.river = audio.loop({ freq: 1400, filter: 'bandpass', q: 0.5, volume: 0.9, ref: 10, bus: 'ambient' });
    this.lake = audio.loop({ freq: 380, filter: 'lowpass', brown: true, volume: 0.6, ref: 12, bus: 'ambient', lfo: { rate: 0.3, depth: 0.4 } });
    this.hum = audio.loop({ freq: 120, filter: 'bandpass', q: 8, volume: 0.35, ref: 25, bus: 'ambient', lfo: { rate: 0.5, depth: 0.2 } });
    this.drone = audio.loop({ freq: 90, filter: 'lowpass', brown: true, volume: 0.5, ref: 30, bus: 'ambient', lfo: { rate: 0.08, depth: 0.4 } });
  }

  private zoneWeight(id: keyof typeof ZONES, p: THREE.Vector3): number {
    const z = ZONES[id];
    const d = Math.hypot(p.x - z.x, p.z - z.z);
    return Math.max(0, Math.min(1, 1 - (d - z.radius * 0.6) / (z.radius * 0.6)));
  }

  update(dt: number, realDt: number) {
    if (!this.game.started) return;
    this.ensure();
    if (!this.wind) return;
    const g = this.game;
    const p = g.camera.position;
    const night = g.env.nightFactor;
    // Wind: louder on high ground and in storms.
    this.wind.setLevel(0.12 + Math.min(0.5, Math.max(0, p.y - 10) / 60) + g.env.stormFactor * 0.35, 0.5);
    // River: positioned at the nearest point on the river.
    const r = g.world.terrain.shape.riverDistance(p.x, p.z);
    const a = RIVER.points[r.seg];
    const b = RIVER.points[r.seg + 1];
    this.tmp.set(a[0] + (b[0] - a[0]) * r.t, WORLD.waterLevel, a[1] + (b[1] - a[1]) * r.t);
    this.river!.setPosition(this.tmp.x, this.tmp.y, this.tmp.z);
    this.river!.setLevel(r.d < 80 ? 0.8 : 0, 0.5);
    // Lake: from the nearest shore point.
    const toLake = this.tmp.set(p.x - LAKE.x, 0, p.z - LAKE.z);
    const ld = toLake.length();
    toLake.multiplyScalar(Math.min(1, (LAKE.radius * 0.85) / Math.max(1, ld)));
    this.lake!.setPosition(LAKE.x + toLake.x, WORLD.waterLevel, LAKE.z + toLake.z);
    this.lake!.setLevel(ld < LAKE.radius + 60 ? 0.7 : 0, 0.5);
    // Zone beds.
    const lz = ZONES.lightning;
    this.hum!.setPosition(lz.x, lz.height + 2, lz.z);
    this.hum!.setLevel(this.zoneWeight('lightning', p) * 0.8 + (g.signals.on('generator') ? 0.3 : 0), 0.4);
    const sz = ZONES.shadow;
    this.drone!.setPosition(sz.x, sz.height + 2, sz.z);
    this.drone!.setLevel(this.zoneWeight('shadow', p) * (0.4 + night * 0.6), 0.6);
    // One-shots.
    if (dt <= 0) return;
    this.timer -= realDt;
    if (this.timer > 0) return;
    this.timer = 0.25 + Math.random() * 0.5;
    const fire = this.zoneWeight('fire', p);
    if (fire > 0.2 && Math.random() < fire * 0.4) {
      audio.noiseBurst({ volume: 0.06 * fire, decay: 0.03, filter: 'highpass', freq: 3000, delay: Math.random() * 0.2 });
    }
    const outdoors = p.y < 25;
    if (night < 0.5 && outdoors && g.env.stormFactor < 0.3 && Math.random() < 0.18) this.bird();
    if (night > 0.5 && outdoors && Math.random() < 0.6) this.cricket();
  }

  private bird() {
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    const pan = { x: this.game.camera.position.x + (Math.random() - 0.5) * 40, y: this.game.camera.position.y + 6, z: this.game.camera.position.z + (Math.random() - 0.5) * 40 };
    for (let i = 0; i < n; i++) {
      audio.tone({ pos: pan, ref: 15, volume: 0.05, freq: base * (1 + Math.random() * 0.2), freqEnd: base * (0.7 + Math.random() * 0.6), attack: 0.01, decay: 0.07 + Math.random() * 0.05, delay: i * 0.12 });
    }
  }

  private cricket() {
    const c = this.game.camera.position;
    const pos = { x: c.x + (Math.random() - 0.5) * 20, y: c.y, z: c.z + (Math.random() - 0.5) * 20 };
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) audio.tone({ pos, ref: 8, volume: 0.035, freq: f, attack: 0.005, decay: 0.03, delay: i * 0.06, type: 'triangle' });
  }
}
