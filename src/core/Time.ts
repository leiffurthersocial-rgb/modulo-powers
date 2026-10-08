/**
 * Global game clock. `scale` slows the simulation (slow-mo); `paused` freezes
 * physics, particles and abilities while rendering and UI keep running.
 */
export class Time {
  paused = false;
  /** Simulation speed multiplier (1 = real time, 0.25 = slow motion). */
  scale = 1;
  /** Real seconds of hit-stop remaining (impact freeze frames). */
  hitstop = 0;

  /** Briefly freeze the action on a big hit. */
  freeze(seconds: number) {
    this.hitstop = Math.max(this.hitstop, seconds);
  }
  /** Seconds of simulated (scaled, unpaused) time since start. */
  elapsed = 0;
  /** Real seconds since start, unaffected by pause/slow-mo (for UI animation). */
  realElapsed = 0;
  /** Scaled delta of the current render frame (0 when paused). */
  delta = 0;
  /** Unscaled delta of the current render frame. */
  realDelta = 0;
  /** Number of fixed steps taken so far. */
  frame = 0;
}

export const time = new Time();
