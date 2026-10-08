import { el } from './dom';

/**
 * Heads-up display root. Power/ability widgets are added in their own modules;
 * this holds the crosshair, the help hint, perf stats and the screen flash.
 */
export class Hud {
  readonly root: HTMLElement;
  private stats: HTMLElement;
  private flash: HTMLElement;
  private underwater: HTMLElement;
  private underwaterLevel = -1;
  private statsTimer = 0;
  private frames = 0;
  showStats = true;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden-until-start', '', parent);
    this.root.style.position = 'absolute';
    this.root.style.inset = '0';
    this.flash = el('div', 'flash', '', this.root);
    this.underwater = el('div', 'underwater', '', this.root);
    el('div', 'crosshair', '<div class="dot"></div>', this.root);
    el('div', 'hint', 'Press <kbd>H</kbd> for help', this.root);
    this.stats = el('div', 'stats', '', this.root);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  setFlash(level: number, color = '#ffffff') {
    this.flash.style.opacity = String(Math.min(0.85, level));
    this.flash.style.background = color;
  }

  setUnderwater(level: number) {
    if (level === this.underwaterLevel) return;
    this.underwaterLevel = level;
    this.underwater.style.opacity = String(level);
  }

  /** Update the FPS readout about twice a second. */
  tickStats(realDt: number, info: () => string) {
    this.frames++;
    this.statsTimer += realDt;
    if (this.statsTimer >= 0.5) {
      const fps = this.frames / this.statsTimer;
      this.stats.textContent = this.showStats ? `${fps.toFixed(0)} fps\n${info()}` : '';
      this.frames = 0;
      this.statsTimer = 0;
    }
  }
}
