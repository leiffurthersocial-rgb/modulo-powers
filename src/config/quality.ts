/**
 * Quality presets. `L` cycles through them; the automatic scaler adjusts the
 * render resolution (and particle budget) within the active preset.
 */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  label: string;
  /** Upper bound for devicePixelRatio. */
  maxPixelRatio: number;
  /** Lower bound for the dynamic resolution scale (multiplies pixel ratio). */
  minResolutionScale: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-size of the tight-fit sun shadow box, in metres. */
  shadowExtent: number;
  /** Maximum simultaneously alive particles. */
  particleBudget: number;
  /** Camera far plane / fog distance in metres. */
  viewDistance: number;
  /** 0..1 multiplier on decorative instances (grass, trees, rocks). */
  vegetationDensity: number;
  /** Post-processing (bloom etc.). */
  postFX: boolean;
  /** Max dynamic point lights from fire/lightning. */
  maxDynamicLights: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    maxPixelRatio: 1,
    minResolutionScale: 0.5,
    shadows: true,
    shadowMapSize: 1024,
    shadowExtent: 35,
    particleBudget: 1500,
    viewDistance: 420,
    vegetationDensity: 0.35,
    postFX: false,
    maxDynamicLights: 2,
  },
  medium: {
    label: 'Medium',
    maxPixelRatio: 1.5,
    minResolutionScale: 0.6,
    shadows: true,
    shadowMapSize: 2048,
    shadowExtent: 45,
    particleBudget: 4000,
    viewDistance: 520,
    vegetationDensity: 0.7,
    postFX: true,
    maxDynamicLights: 4,
  },
  high: {
    label: 'High',
    maxPixelRatio: 2,
    minResolutionScale: 0.7,
    shadows: true,
    shadowMapSize: 4096,
    shadowExtent: 60,
    particleBudget: 9000,
    viewDistance: 800,
    vegetationDensity: 1,
    postFX: true,
    maxDynamicLights: 8,
  },
};

export const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high'];

/** Rough guess at a sensible default: touch devices (iPad) start on Medium. */
export function defaultQuality(): QualityLevel {
  const touch = navigator.maxTouchPoints > 1;
  return touch ? 'medium' : 'high';
}
