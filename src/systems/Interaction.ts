import * as THREE from 'three';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import { el } from '../ui/dom';
import { AIM_GROUPS } from '../powers/common';
import type { Entity } from '../world/Entity';

/**
 * F to interact: looks for an entity with an `interact` handler under the
 * crosshair within reach and shows a prompt.
 */
export class InteractionSystem implements GameSystem {
  private prompt: HTMLElement;
  private target: Entity | null = null;
  private timer = 0;
  private dir = new THREE.Vector3();

  constructor(private game: Game) {
    this.prompt = el('div', 'interact-prompt', '', game.hud.root);
  }

  update(_dt: number, realDt: number) {
    const g = this.game;
    this.timer -= realDt;
    if (this.timer <= 0) {
      this.timer = 0.1;
      const origin = g.camera.position;
      g.rig.aimDirection(this.dir);
      const reach = g.rig.mode === 'third' ? 3.5 + origin.distanceTo(g.player.curPos) : 3.5;
      const hit = g.physics.raycast(origin, this.dir, reach, { groups: AIM_GROUPS, exclude: g.player.collider });
      const e = hit ? g.entities.fromCollider(hit.collider) : null;
      this.target = e && e.interact ? e : null;
      if (this.target) {
        this.prompt.innerHTML = `<kbd>F</kbd> ${this.target.interactLabel ?? 'Interact'}`;
        this.prompt.style.opacity = '1';
      } else this.prompt.style.opacity = '0';
    }
    if (this.target && g.input.wasPressed('interact') && !this.target.dead) {
      this.target.interact?.();
      audio.uiClick(true);
      this.timer = 0;
    }
  }
}
