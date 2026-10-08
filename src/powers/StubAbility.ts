import { Ability, type AbilityMode } from './Ability';

/** Placeholder used until an ability is implemented: poses the hands only. */
export class StubAbility extends Ability {
  constructor(
    readonly name: string,
    readonly description: string,
    icon: string,
    mode: AbilityMode = 'tap',
    cost = 10,
    cooldown = 0.5,
  ) {
    super();
    this.icon = icon;
    this.mode = mode;
    this.cost = cost;
    this.cooldown = cooldown;
  }

  protected start(): boolean {
    this.game.hands.pose('cast', 'cast');
    this.game.hands.kick('both', 0.05);
    this.game.toasts.show(`${this.name} isn't implemented yet`);
    return true;
  }

  protected end(): void {
    this.game.hands.pose('rest', 'rest');
  }

  update(): void {
    if (!this.active && this.cooldownLeft <= 0 && this.game.hands.right.pose === 'cast') this.game.hands.pose('rest', 'rest');
  }
}
