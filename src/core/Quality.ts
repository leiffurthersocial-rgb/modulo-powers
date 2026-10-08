import * as THREE from 'three';
import { QUALITY_ORDER, QUALITY_PRESETS, defaultQuality, type QualityLevel, type QualityPreset } from '../config/quality';

/**
 * Owns the active quality preset and the automatic dynamic-resolution scaler.
 *
 * The scaler watches a smoothed frame time; if we're consistently slower than
 * the target it lowers the render resolution (and particle budget) in small
 * steps, and raises it again when there's headroom.
 */
export class QualityManager {
  level: QualityLevel;
  /** Dynamic resolution multiplier (minResolutionScale … 1). */
  resScale = 1;
  /** 0..1 multiplier the particle system applies to its budget. */
  particleScale = 1;
  postFX: boolean;
  onChange: ((q: QualityPreset) => void) | null = null;
  private avgFrame = 1 / 60;
  private settle = 0;
  private targetFrame = 1 / 58;

  constructor(private renderer: THREE.WebGLRenderer) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('modulo.quality');
    } catch {
      /* storage unavailable */
    }
    this.level = saved && saved in QUALITY_PRESETS ? (saved as QualityLevel) : defaultQuality();
    this.postFX = this.preset.postFX;
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.level];
  }

  cycle(): QualityPreset {
    const i = QUALITY_ORDER.indexOf(this.level);
    this.set(QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length]);
    return this.preset;
  }

  set(level: QualityLevel) {
    this.level = level;
    this.postFX = this.preset.postFX;
    this.resScale = 1;
    this.particleScale = 1;
    this.settle = 1.5;
    try {
      localStorage.setItem('modulo.quality', level);
    } catch {
      /* ignore */
    }
    this.applyPixelRatio();
    this.onChange?.(this.preset);
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio) * this.resScale;
  }

  applyPixelRatio() {
    this.renderer.setPixelRatio(this.pixelRatio);
  }

  /** Call once per frame with the real frame delta. */
  update(realDt: number) {
    if (realDt <= 0 || realDt > 0.25) return;
    this.avgFrame += (realDt - this.avgFrame) * 0.05;
    this.settle -= realDt;
    if (this.settle > 0) return;
    const p = this.preset;
    if (this.avgFrame > this.targetFrame * 1.12 && this.resScale > p.minResolutionScale) {
      this.resScale = Math.max(p.minResolutionScale, this.resScale - 0.08);
      this.particleScale = Math.max(0.4, this.particleScale - 0.1);
      this.applyPixelRatio();
      this.settle = 1.0;
    } else if (this.avgFrame < this.targetFrame * 0.85 && this.resScale < 1) {
      this.resScale = Math.min(1, this.resScale + 0.05);
      this.particleScale = Math.min(1, this.particleScale + 0.05);
      this.applyPixelRatio();
      this.settle = 2.0;
    }
  }
}
