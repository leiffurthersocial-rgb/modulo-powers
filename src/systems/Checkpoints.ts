import * as THREE from 'three';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';

interface Checkpoint {
  pos: THREE.Vector3;
  name: string;
  ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/**
 * Glowing pads; stepping on one makes it the respawn point (Backspace,
 * falling off the map).
 */
export class Checkpoints implements GameSystem {
  private list: Checkpoint[] = [];
  private active: Checkpoint | null = null;
  private geo = new THREE.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2);

  constructor(private game: Game) {}

  add(pos: THREE.Vector3, name: string, color: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
    const ring = new THREE.Mesh(this.geo, mat);
    ring.position.copy(pos).setY(pos.y + 0.06);
    ring.renderOrder = 2;
    this.game.scene.add(ring);
    this.list.push({ pos: pos.clone(), name, ring, mat });
  }

  update() {
    const g = this.game;
    const feet = g.player.feet(TMP);
    for (const c of this.list) {
      const near = Math.hypot(feet.x - c.pos.x, feet.z - c.pos.z) < 1.4 && Math.abs(feet.y - c.pos.y) < 1.5;
      if (near && this.active !== c) {
        this.active = c;
        g.checkpoint.copy(c.pos);
        g.toasts.show(`Checkpoint: ${c.name}`);
        audio.tone({ volume: 0.2, freq: 660, freqEnd: 880, decay: 0.3, type: 'triangle' });
      }
      const on = this.active === c;
      c.mat.opacity = on ? 0.75 + Math.sin(performance.now() * 0.005) * 0.15 : 0.35;
    }
  }
}

const TMP = new THREE.Vector3();
