import * as THREE from 'three';
import type { Game, GameSystem } from '../core/Game';
import { FX } from './Particles';

interface MudPatch {
  x: number;
  z: number;
  r: number;
  life: number;
}

/**
 * Mud patches: created where water meets earth (water on bare ground, earth
 * thrown into water). Mud slows the player and makes footing slippery; it dries
 * out over time (or instantly when rock is raised through it).
 */
export class MudSystem implements GameSystem {
  private patches: MudPatch[] = [];
  private tmp = new THREE.Vector3();

  constructor(private game: Game) {
    game.reactions.registerSurfaceEffect('mud', (c, r, amt) => this.add(c, Math.max(1.2, r), amt));
    game.reactions.registerSurfaceEffect('dryMud', (c, r) => this.dry(c, r));
  }

  add(c: THREE.Vector3, r: number, amount = 1) {
    const g = this.game;
    // Merge with an existing nearby patch.
    for (const p of this.patches) {
      if (Math.hypot(p.x - c.x, p.z - c.z) < p.r) {
        p.life = Math.min(90, p.life + 20 * amount);
        p.r = Math.min(5, p.r + 0.05 * amount);
        return;
      }
    }
    if (this.patches.length > 40) this.patches.shift();
    const life = 60;
    this.patches.push({ x: c.x, z: c.z, r: Math.min(4, r), life });
    const y = g.world.heightAt(c.x, c.z);
    g.decals.add('mud', this.tmp.set(c.x, y, c.z), g.world.terrain.normalAt(c.x, c.z), Math.min(8, r * 2.2), life, 0.95);
  }

  dry(c: THREE.Vector3, r: number) {
    this.patches = this.patches.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) > p.r + r);
  }

  /** 0..1 how muddy the ground is at a point. */
  at(x: number, z: number): number {
    let m = 0;
    for (const p of this.patches) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < p.r) m = Math.max(m, Math.min(1, p.life / 10));
    }
    return m;
  }

  fixedUpdate(dt: number) {
    for (const p of this.patches) p.life -= dt;
    this.patches = this.patches.filter((p) => p.life > 0);
    const pl = this.game.player;
    const m = pl.grounded ? this.at(pl.curPos.x, pl.curPos.z) : 0;
    if (m > 0) pl.setModifier('mud', 1 - m * 0.5, 1 - m * 0.6);
    else pl.clearModifier('mud');
    if (m > 0 && pl.speed > 1 && Math.random() < dt * 4) {
      this.game.particles.emit(FX.debris, pl.feet(this.tmp), 2, { spread: 1, speed: [1, 2], color0: 0x3a2a1a, color1: 0x3a2a1a });
    }
  }

  reset() {
    this.patches = [];
  }
}
