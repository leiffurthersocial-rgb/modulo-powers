import { el } from './dom';

/**
 * Heads-up display root. Power/ability widgets are added in their own modules;
 * this holds the crosshair, the help hint, perf stats and the screen flash.
 */
export class Hud {
  readonly root: HTMLElement;
  private stats: HTMLElement;
  private flash: HTMLElement;
  private hpWrap: HTMLElement;
  private hpFill: HTMLElement;
  private hpLag: HTMLElement;
  private hpText: HTMLElement;
  private hurtEl: HTMLElement;
  private hurtLevel = 0;
  private lastHp = -1;
  private lag = 1;
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
    this.hurtEl = el('div', 'hurt-vignette', '', this.root);
    this.hpWrap = el('div', 'hp-bar', '', this.root);
    el('div', 'hp-label', '❤', this.hpWrap);
    const track = el('div', 'hp-track', '', this.hpWrap);
    this.hpLag = el('div', 'hp-lag', '', track);
    this.hpFill = el('div', 'hp-fill', '', track);
    this.hpText = el('div', 'hp-text', '100', track);
    this.underwater = el('div', 'underwater', '', this.root);
    el('div', 'crosshair', '<div class="dot"></div>', this.root);
    el('div', 'hint', 'Press <kbd>H</kbd> for help', this.root);
    this.stats = el('div', 'stats', '', this.root);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  setHealthVisible(v: boolean) {
    this.hpWrap.style.display = v ? '' : 'none';
  }

  /** Health fraction 0..1 (with a trailing "damage" bar). */
  setHealth(f: number) {
    this.lag += (f - this.lag) * (f < this.lag ? 0.04 : 1);
    this.hurtLevel = Math.max(0, this.hurtLevel - 0.02);
    this.hurtEl.style.opacity = String(Math.max(this.hurtLevel, f < 0.3 ? (0.3 - f) * 1.6 * (0.7 + 0.3 * Math.sin(performance.now() * 0.008)) : 0));
    const key = Math.round(f * 100);
    if (key === this.lastHp && Math.abs(this.lag - f) < 0.002) return;
    this.lastHp = key;
    this.hpFill.style.width = `${f * 100}%`;
    this.hpLag.style.width = `${this.lag * 100}%`;
    this.hpFill.style.background = f > 0.5 ? 'linear-gradient(90deg,#3fd46a,#8af07a)' : f > 0.25 ? 'linear-gradient(90deg,#e8b62a,#ffd25a)' : 'linear-gradient(90deg,#d8342a,#ff6a5a)';
    this.hpText.textContent = String(key);
  }

  /** Brief red-black screen flash for a Black Flash crit. */
  blackFlash() {
    this.flash.style.background = 'radial-gradient(ellipse at center, rgba(255,20,40,0.7), rgba(0,0,0,0.9))';
    this.flash.style.opacity = '0.8';
    this.blackFlashT = performance.now();
  }
  private blackFlashT = 0;

  private tintEl: HTMLElement | null = null;
  /** Coloured edge tint (Assassin mode). Empty string clears it. */
  setTint(color: string) {
    if (!this.tintEl) {
      this.tintEl = el('div', 'underwater', '', this.root);
    }
    this.tintEl.style.background = color ? `radial-gradient(ellipse at center, transparent 50%, ${color})` : 'none';
    this.tintEl.style.opacity = color ? '1' : '0';
  }

  /** Red damage vignette pulse. */
  hurt(amount: number) {
    this.hurtLevel = Math.min(1, this.hurtLevel + amount);
  }

  setFlash(level: number, color = '#ffffff') {
    if (performance.now() - this.blackFlashT < 140) return;
    this.flash.style.opacity = String(Math.min(0.85, level));
    this.flash.style.background = color;
  }

  private digEl: HTMLElement | null = null;
  setDig(on: boolean) {
    if (!this.digEl) {
      this.digEl = el('div', 'underwater', '', this.root);
      this.digEl.style.background = 'radial-gradient(ellipse at center, rgba(60,40,20,0.1), rgba(30,18,8,0.85))';
    }
    this.digEl.style.opacity = on ? '1' : '0';
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
