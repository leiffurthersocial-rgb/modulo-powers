import { PHYSICS } from '../config/physics';
import { time } from './Time';

export interface LoopCallbacks {
  /** Fixed-rate simulation step (physics, gameplay). dt is constant. */
  fixedUpdate(dt: number): void;
  /**
   * Per-frame update. `dt` is the scaled frame delta (0 when paused),
   * `alpha` is the interpolation factor between the last two fixed steps.
   */
  update(dt: number, realDt: number, alpha: number): void;
  render(): void;
}

/**
 * Fixed-timestep game loop with interpolated rendering
 * ("Fix Your Timestep!" pattern).
 */
export class Loop {
  private accumulator = 0;
  private last = 0;
  private running = false;
  private rafId = 0;

  constructor(private cb: LoopCallbacks) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      // Clamp huge gaps (tab switch, breakpoint) so we don't fast-forward.
      const realDt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.frame(realDt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame(realDt: number) {
    const fixed = PHYSICS.fixedDt;
    time.realDelta = realDt;
    time.realElapsed += realDt;
    let hs = 1;
    if (time.hitstop > 0) {
      time.hitstop -= realDt;
      hs = 0.06;
    }
    const dt = time.paused ? 0 : realDt * time.scale * hs;
    time.delta = dt;
    if (!time.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= fixed && steps < PHYSICS.maxSubSteps) {
        this.cb.fixedUpdate(fixed);
        time.elapsed += fixed;
        time.frame++;
        this.accumulator -= fixed;
        steps++;
      }
      if (steps === PHYSICS.maxSubSteps) this.accumulator = Math.min(this.accumulator, fixed);
    }
    this.cb.update(dt, realDt, this.accumulator / fixed);
    this.cb.render();
  }
}
