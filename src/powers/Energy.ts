import { PLAYER } from '../config/balance';

/** Shared energy pool with regen delay and a sandbox "infinite" toggle. */
export class Energy {
  max = PLAYER.maxEnergy;
  value = PLAYER.maxEnergy;
  infinite = false;
  private sinceSpend = 99;

  spend(n: number): boolean {
    if (this.infinite) return true;
    if (this.value < n) return false;
    this.value -= n;
    this.sinceSpend = 0;
    return true;
  }

  /** Continuous drain; returns false when empty. */
  drain(n: number): boolean {
    if (this.infinite) return true;
    this.sinceSpend = 0;
    if (this.value <= 0) return false;
    this.value = Math.max(0, this.value - n);
    return this.value > 0;
  }

  refund(n: number) {
    this.value = Math.min(this.max, this.value + n);
  }

  refill() {
    this.value = this.max;
  }

  update(dt: number) {
    this.sinceSpend += dt;
    if (this.sinceSpend > PLAYER.energyRegenDelay) this.value = Math.min(this.max, this.value + PLAYER.energyRegen * dt);
  }

  get fraction(): number {
    return this.value / this.max;
  }
}
