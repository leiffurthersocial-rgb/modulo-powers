import type { Game } from '../core/Game';
import type { Power } from './Power';

/**
 * How an ability responds to its key:
 * - `tap`:    fires once on press. `cost` is per use.
 * - `charge`: press starts charging, release fires with charge 0..1.
 *             `cost` is the full-charge cost (scaled 40–100% by charge).
 * - `hold`:   active while held. `cost` is per second.
 * - `toggle`: press toggles on/off. `cost` is per second while on.
 */
export type AbilityMode = 'tap' | 'charge' | 'hold' | 'toggle';

/**
 * Base class for every ability.
 *
 * HOW TO ADD AN ABILITY
 * 1. Subclass `Ability`, set `name`, `description`, `icon`, `mode`, `cost`, `cooldown`.
 * 2. Implement the hooks you need:
 *    - `start()`      activation (tap fire / begin charge / begin hold / toggle on).
 *                     Return false to abort (e.g. no valid target) – energy is refunded.
 *    - `sustain(dt)`  every frame while active (charging, holding, toggled on).
 *    - `end(charge)`  release of a charge/hold ability, or toggle off.
 *    - `update(dt)`   every frame, always – animate lingering effects here.
 *    - `fixedUpdate(dt)` physics-rate logic (forces on bodies).
 *    - `cancel()`     forced stop (power switched, map reset). Clean up channels.
 * 3. Add it to its Power's `abilities` array (exactly 4 per power).
 *
 * The base class handles cooldowns, energy, charge timing and input edges, so
 * the subclass only implements the effect.
 */
export abstract class Ability {
  abstract readonly name: string;
  abstract readonly description: string;
  /** SVG path data (24×24 viewBox) for the HUD icon. */
  icon = 'M12 3 L21 12 L12 21 L3 12 Z';
  mode: AbilityMode = 'tap';
  cost = 10;
  cooldown = 0.5;
  /** Seconds to reach full charge (charge mode). */
  chargeTime = 1.2;
  /** Minimum energy needed to begin a hold/toggle/charge. */
  minEnergy = 5;

  cooldownLeft = 0;
  active = false;
  charge = 0;
  /** Seconds the ability has been active this activation. */
  activeTime = 0;

  protected game!: Game;
  protected power!: Power;

  bind(game: Game, power: Power) {
    this.game = game;
    this.power = power;
    this.init();
  }

  /** One-time setup after binding (create meshes, pools...). */
  protected init(): void {}

  protected start(): boolean {
    return true;
  }
  protected sustain(_dt: number): void {}
  protected end(_charge: number): void {}
  update(_dt: number): void {}
  fixedUpdate(_dt: number): void {}
  /** Reset lingering state (map reset). Default cancels. */
  reset(): void {
    this.cancel();
    this.cooldownLeft = 0;
  }

  /** Forced stop: power switched, paused out, reset. */
  cancel(): void {
    if (this.active) {
      this.active = false;
      this.charge = 0;
      this.end(-1);
    }
  }

  get ready(): boolean {
    return this.cooldownLeft <= 0;
  }

  get cooldownFraction(): number {
    return this.cooldown > 0 ? Math.max(0, this.cooldownLeft / this.cooldown) : 0;
  }

  /** Can the player afford to start this ability right now? */
  get affordable(): boolean {
    const e = this.game.energy;
    if (e.infinite) return true;
    return this.mode === 'tap' ? e.value >= this.cost : e.value >= this.minEnergy;
  }

  // ---------------------------------------------------------------------------
  // Input plumbing (called by PowerManager).
  // ---------------------------------------------------------------------------

  press() {
    const energy = this.game.energy;
    if (this.mode === 'toggle' && this.active) {
      this.active = false;
      this.end(1);
      this.cooldownLeft = this.cooldown;
      return;
    }
    if (!this.ready || this.active) return;
    if (!this.affordable) {
      this.game.denied(this);
      return;
    }
    if (this.mode === 'tap') {
      energy.spend(this.cost);
      if (this.start()) {
        this.cooldownLeft = this.cooldown;
        this.power.lastAbility = this.power.abilities.indexOf(this);
      } else energy.refund(this.cost);
      return;
    }
    if (this.start()) {
      this.active = true;
      this.charge = 0;
      this.activeTime = 0;
      this.power.lastAbility = this.power.abilities.indexOf(this);
    }
  }

  release() {
    if (!this.active) return;
    if (this.mode === 'charge') {
      const c = this.charge;
      const cost = this.cost * (0.4 + 0.6 * c);
      this.game.energy.spend(Math.min(cost, this.game.energy.infinite ? cost : this.game.energy.value));
      this.active = false;
      this.charge = 0;
      this.end(c);
      this.cooldownLeft = this.cooldown;
    } else if (this.mode === 'hold') {
      this.active = false;
      this.end(1);
      this.cooldownLeft = this.cooldown;
    }
  }

  /** Per-frame tick (dt is scaled game time; 0 when paused). */
  tick(dt: number) {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    if (this.active && dt > 0) {
      this.activeTime += dt;
      if (this.mode === 'charge') {
        this.charge = Math.min(1, this.charge + dt / this.chargeTime);
        this.sustain(dt);
      } else {
        // hold / toggle drain energy continuously.
        if (!this.game.energy.drain(this.cost * dt)) {
          this.active = false;
          this.end(0);
          this.cooldownLeft = this.cooldown;
          this.game.denied(this);
        } else {
          this.sustain(dt);
        }
      }
    }
    this.update(dt);
  }
}
