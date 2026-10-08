import type { Game } from '../core/Game';
import type { Ability } from './Ability';

/**
 * Base class for a power (an element with 4 abilities).
 *
 * HOW TO ADD A POWER
 * 1. Create `src/powers/<name>/<Name>Power.ts` extending `Power`, with an id,
 *    display name, colour, HUD icon and exactly 4 abilities (Z, X, C, B).
 * 2. Add it to the list in `src/powers/index.ts`. The number keys follow that order.
 * 3. Optionally add a binding in `config/keybindings.ts` (power6...) and reactions
 *    for its element in `config/reactions.ts`.
 */
export abstract class Power {
  abstract readonly id: string;
  abstract readonly name: string;
  /** CSS / Three colour for HUD, hands and avatar accent. */
  abstract readonly color: string;
  /** SVG path data (24×24) for the HUD icon. */
  abstract readonly icon: string;
  abstract readonly abilities: Ability[];
  /** Index of the ability used most recently (highlighted in the HUD). */
  lastAbility = 0;
  protected game!: Game;

  bind(game: Game) {
    this.game = game;
    for (const a of this.abilities) a.bind(game, this);
  }

  /** Called when this power becomes the selected one. */
  onEquip(): void {}

  /** Called when switching away. Cancels channelled abilities by default. */
  onUnequip(): void {
    for (const a of this.abilities) if (a.mode !== 'toggle') a.cancel();
  }

  /** Per-frame update while equipped (in addition to ability ticks). */
  update(_dt: number): void {}
}
