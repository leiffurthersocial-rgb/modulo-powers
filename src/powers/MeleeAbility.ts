import * as THREE from 'three';
import { Ability } from './Ability';
import { findTarget } from './combat';
import { pose } from './common';

/**
 * Base for close-combat abilities: tracks a combo counter, alternates fists,
 * and auto-lunges at a target in front of you (so fights feel snappy and
 * superhuman). Subclasses implement `hit(step)`.
 */
export abstract class MeleeAbility extends Ability {
  mode = 'tap' as const;
  /** Auto-lunge range (0 = no lunge). */
  lungeRange = 6;
  lungeSpeed = 28;
  /** Combo window (s). */
  comboWindow = 0.9;
  protected step = 0;
  private comboTimer = 0;
  private restTimer = 0;

  /** Perform the actual strike for combo step `step` (0, 1, 2, ...). */
  protected abstract hit(step: number): void;

  protected start(): boolean {
    const g = this.game;
    this.step = this.comboTimer > 0 ? this.step + 1 : 0;
    this.comboTimer = this.comboWindow;
    const side = this.step % 2 ? 'left' : 'right';
    pose(g, side === 'left' ? 'cast' : 'rest', side === 'right' ? 'cast' : 'rest');
    g.hands.punch(side, 0.45);
    this.restTimer = 0.25;
    const target = this.lungeRange > 0 ? findTarget(g, this.lungeRange, 0.45) : null;
    const step = this.step;
    if (target && target.center(TMP).distanceTo(g.player.curPos) > 2.4 && !g.combat.dashing) {
      const dir = TMP.copy(target.center(TMP)).sub(g.player.curPos);
      g.combat.lunge(dir, this.lungeSpeed, 0.35, target, 1.7, () => this.hit(step));
    } else {
      this.hit(step);
    }
    return true;
  }

  update(dt: number) {
    if (this.comboTimer > 0) this.comboTimer -= dt;
    if (this.restTimer > 0) {
      this.restTimer -= dt;
      if (this.restTimer <= 0) pose(this.game, 'rest', 'rest');
    }
  }
}

const TMP = new THREE.Vector3();
