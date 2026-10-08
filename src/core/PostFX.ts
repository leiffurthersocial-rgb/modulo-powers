import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  NormalPass,
  RenderPass,
  SSAOEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  BlendFunction,
} from 'postprocessing';
import type { QualityLevel } from '../config/quality';

/**
 * Optional post-processing chain: HDR render → (SSAO on High) → bloom →
 * ACES tone mapping → vignette. When disabled the scene renders straight to
 * the screen with the renderer's built-in ACES tone mapping.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
  enabled = true;
  private level: QualityLevel | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {}

  /** (Re)build the chain for a quality level. */
  configure(level: QualityLevel, enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) return;
    if (this.composer && this.level === level) return;
    this.dispose();
    this.level = level;
    const composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: level === 'high' ? 4 : 0,
    });
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.25,
      intensity: level === 'low' ? 0.6 : 0.85,
      radius: 0.7,
      levels: level === 'high' ? 7 : 5,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
    if (level === 'high') {
      const normalPass = new NormalPass(this.scene, this.camera, { resolutionScale: 0.5 });
      composer.addPass(normalPass);
      const ssao = new SSAOEffect(this.camera, normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY,
        samples: 9,
        rings: 7,
        radius: 0.12,
        intensity: 1.4,
        luminanceInfluence: 0.6,
        worldDistanceThreshold: 60,
        worldDistanceFalloff: 10,
        worldProximityThreshold: 0.6,
        worldProximityFalloff: 0.3,
        resolutionScale: 0.5,
        bias: 0.03,
        fade: 0.02,
      });
      composer.addPass(new EffectPass(this.camera, ssao));
    }
    composer.addPass(new EffectPass(this.camera, this.bloom, tone, vignette));
    this.composer = composer;
    const size = this.renderer.getSize(new THREE.Vector2());
    composer.setSize(size.x, size.y, false);
  }

  setSize(w: number, h: number) {
    this.composer?.setSize(w, h, false);
  }

  render(dt: number) {
    if (this.enabled && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
  }
}
