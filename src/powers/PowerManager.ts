import type { Action } from '../config/keybindings';
import type { Game } from '../core/Game';
import type { Power } from './Power';

const ABILITY_ACTIONS: Action[] = ['ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'ability6'];

/**
 * Holds all powers, the current selection, and routes ability input.
 * All powers' abilities keep ticking even when not selected, so lingering
 * effects (walls of fire, storms, ice) finish naturally.
 */
export class PowerManager {
  index = 0;
  onChange: ((p: Power) => void) | null = null;

  constructor(
    private game: Game,
    readonly powers: Power[],
  ) {
    for (const p of powers) p.bind(game);
  }

  get current(): Power {
    return this.powers[this.index];
  }

  select(i: number) {
    if (i < 0 || i >= this.powers.length || i === this.index) return;
    this.current.onUnequip();
    this.index = i;
    this.current.onEquip();
    this.onChange?.(this.current);
  }

  next(dir: 1 | -1) {
    this.select((this.index + dir + this.powers.length) % this.powers.length);
  }

  /** Route ability input; call once per frame before ticking. */
  handleInput(enabled: boolean) {
    const input = this.game.input;
    const p = this.current;
    for (let i = 0; i < ABILITY_ACTIONS.length; i++) {
      const a = p.abilities[i];
      if (!a) continue;
      const act = ABILITY_ACTIONS[i];
      if (enabled && input.wasPressed(act)) a.press();
      if (input.wasReleased(act) || (!input.isDown(act) && a.active && (a.mode === 'hold' || a.mode === 'charge'))) a.release();
    }
  }

  update(dt: number) {
    for (const p of this.powers) {
      for (const a of p.abilities) a.tick(dt);
    }
    if (dt > 0) this.current.update(dt);
  }

  fixedUpdate(dt: number) {
    for (const p of this.powers) for (const a of p.abilities) a.fixedUpdate(dt);
  }

  cancelAll() {
    for (const p of this.powers) for (const a of p.abilities) a.cancel();
  }

  reset() {
    for (const p of this.powers) for (const a of p.abilities) a.reset();
  }
}
