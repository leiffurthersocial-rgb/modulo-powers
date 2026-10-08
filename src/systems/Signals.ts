import type { GameSystem } from '../core/Game';

/**
 * A tiny signal bus for puzzles: generators, rods, plates, levers and basins
 * *set* named signals; gates and lamps *read* them. Timed signals switch off
 * automatically (e.g. a generator stays powered for 20 s after a strike).
 */
export class Signals implements GameSystem {
  private timers = new Map<string, number>();
  private latched = new Map<string, boolean>();
  /** Called when a signal turns on (for toasts / sounds). */
  onRise: ((name: string) => void) | null = null;

  /** Turn on for `seconds` (Infinity = until cleared). */
  pulse(name: string, seconds: number) {
    const was = this.on(name);
    this.timers.set(name, Math.max(this.timers.get(name) ?? 0, seconds));
    if (!was) this.onRise?.(name);
  }

  set(name: string, on: boolean) {
    const was = this.on(name);
    this.latched.set(name, on);
    if (on && !was) this.onRise?.(name);
  }

  on(name: string): boolean {
    return (this.timers.get(name) ?? 0) > 0 || this.latched.get(name) === true;
  }

  /** Remaining seconds of a timed signal (0 if off / latched only). */
  remaining(name: string): number {
    return this.timers.get(name) ?? 0;
  }

  all(names: string[]): boolean {
    return names.every((n) => this.on(n));
  }

  update(dt: number) {
    for (const [k, v] of this.timers) {
      if (v === Infinity) continue;
      const nv = v - dt;
      if (nv <= 0) this.timers.delete(k);
      else this.timers.set(k, nv);
    }
  }

  reset() {
    this.timers.clear();
    this.latched.clear();
  }
}
