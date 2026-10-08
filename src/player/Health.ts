/**
 * Player health. The player is immune to their own powers; health only goes
 * down from enemies (arena fighters, guards) and very big falls. Sandbox mode
 * (J) makes the player invulnerable and hides the health bar.
 */
export class Health {
  max = 100;
  value = 100;
  /** Sandbox: no damage at all. */
  godMode = false;
  /** Multiplier on incoming damage (Stone Armor, Ren, Hydro Shield...). */
  private reductions = new Map<string, number>();
  private sinceHit = 99;
  /** Brief invulnerability after respawning. */
  invuln = 0;
  dead = false;

  setReduction(key: string, mul: number) {
    this.reductions.set(key, mul);
  }

  clearReduction(key: string) {
    this.reductions.delete(key);
  }

  get multiplier(): number {
    let m = 1;
    for (const v of this.reductions.values()) m *= v;
    return m;
  }

  /** Apply damage; returns the amount actually taken. */
  damage(amount: number): number {
    if (this.godMode || this.dead || this.invuln > 0 || amount <= 0) return 0;
    const taken = amount * this.multiplier;
    this.value = Math.max(0, this.value - taken);
    this.sinceHit = 0;
    if (this.value <= 0) this.dead = true;
    return taken;
  }

  heal(n: number) {
    this.value = Math.min(this.max, this.value + n);
  }

  refill() {
    this.value = this.max;
    this.dead = false;
    this.sinceHit = 99;
  }

  update(dt: number) {
    this.sinceHit += dt;
    if (this.invuln > 0) this.invuln -= dt;
    // Regenerate after a few seconds without being hit.
    if (!this.dead && this.sinceHit > 4) this.heal(dt * (this.sinceHit > 8 ? 14 : 6));
  }

  get fraction(): number {
    return this.value / this.max;
  }
}
