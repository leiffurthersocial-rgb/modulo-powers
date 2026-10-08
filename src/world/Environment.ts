import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { QualityPreset } from '../config/quality';
import { damp, lerp, mulberry32 } from '../core/math/noise';

/**
 * Sky, sun/moon lighting, fog, image-based lighting and the day/night toggle.
 *
 * The physically-based `Sky` shader is rendered into a cube map only when the
 * time of day changes; that cube is the scene background, and a PMREM of it is
 * the environment map for PBR reflections. This costs nothing per frame.
 */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3.2);
  readonly hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4030, 0.35);
  private skyScene = new THREE.Scene();
  private sky = new Sky();
  private stars: THREE.Points;
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  fog: THREE.Fog;

  /** 0 = day, 1 = night. */
  nightFactor = 0;
  private target = 0;
  private dirty = true;
  private refreshTimer = 0;
  /** Extra light from Storm Call clouds (0..1), darkens the scene. */
  stormFactor = 0;
  private stormTarget = 0;

  private sunDir = new THREE.Vector3();
  private shadowTexel = 0;
  private lightView = new THREE.Matrix4();
  private lightViewInv = new THREE.Matrix4();

  get isNight(): boolean {
    return this.target > 0.5;
  }

  /**
   * 0..1 ambient light level at the player's location from sky light alone.
   * Used by stealth visibility.
   */
  get ambientLight(): number {
    return lerp(1, 0.08, this.nightFactor) * lerp(1, 0.55, this.stormFactor);
  }

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {
    this.sky.scale.setScalar(1000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    this.skyScene.add(this.sky);

    // Star field (only visible at night).
    const rnd = mulberry32(99);
    const starPos = new Float32Array(2400 * 3);
    for (let i = 0; i < 2400; i++) {
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(rnd() * 0.95);
      starPos[i * 3] = Math.sin(ph) * Math.cos(th) * 300;
      starPos[i * 3 + 1] = Math.cos(ph) * 300;
      starPos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 300;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    // Stars live in the main scene (crisp at any resolution) and follow the camera.
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 2000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.fog = new THREE.Fog(0xb8cbe0, 60, 500);
    scene.fog = this.fog;
    scene.background = this.cubeRT.texture;

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    // Layer 1 = "shadow only" objects (e.g. the player's body in first person).
    this.sun.shadow.camera.layers.enable(1);
    scene.add(this.sun, this.sun.target, this.hemi);
    this.applyLighting();
  }

  applyQuality(q: QualityPreset) {
    this.sun.castShadow = q.shadows;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -q.shadowExtent;
    cam.right = cam.top = q.shadowExtent;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.shadowTexel = (q.shadowExtent * 2) / q.shadowMapSize;
    this.viewDistance = q.viewDistance;
    this.fog.far = q.viewDistance;
    this.fog.near = q.viewDistance * 0.3;
  }

  private viewDistance = 500;

  /** Restore fog after an override (e.g. leaving the water). */
  restoreFog() {
    this.fog.far = this.viewDistance;
    this.fog.near = this.viewDistance * 0.3;
    this.applyLighting();
  }

  setNight(night: boolean, instant = false) {
    this.target = night ? 1 : 0;
    if (instant) {
      this.nightFactor = this.target;
      this.dirty = true;
    }
  }

  toggle() {
    this.setNight(!this.isNight);
  }

  setStorm(amount: number) {
    this.stormTarget = amount;
  }

  /** Sun (day) or moon (night) elevation/azimuth → direction towards the light. */
  private computeSunDir() {
    const t = this.nightFactor;
    // Day: sun high in the south-west. Night: sun well below the horizon.
    const elev = THREE.MathUtils.degToRad(lerp(38, -14, t));
    const azim = THREE.MathUtils.degToRad(lerp(215, 240, t));
    this.sunDir.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)).normalize();
  }

  private applyLighting() {
    this.computeSunDir();
    const t = this.nightFactor;
    const s = this.stormFactor;
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sky.material.uniforms.turbidity.value = lerp(5.5, 14, s);
    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(t, 0.5, 1) * (1 - s);

    // Day: warm sun. Night: cool, dim moonlight from a fixed high direction.
    const dayColor = new THREE.Color(1.0, 0.95, 0.86);
    const nightColor = new THREE.Color(0.55, 0.65, 1.0);
    this.sun.color.copy(dayColor).lerp(nightColor, t);
    this.sun.intensity = lerp(3.4, 0.35, t) * lerp(1, 0.25, s);
    this.hemi.color.setRGB(lerp(0.75, 0.25, t), lerp(0.84, 0.3, t), lerp(1, 0.55, t));
    this.hemi.groundColor.setRGB(lerp(0.3, 0.05, t), lerp(0.26, 0.05, t), lerp(0.2, 0.08, t));
    this.hemi.intensity = lerp(0.3, 0.35, t) * lerp(1, 0.7, s);
    this.scene.environmentIntensity = lerp(0.75, 0.18, t) * lerp(1, 0.5, s);
    this.scene.backgroundIntensity = lerp(1, 0.6, s);
    const fogDay = new THREE.Color(0.5, 0.6, 0.74);
    const fogNight = new THREE.Color(0.02, 0.03, 0.06);
    const fogStorm = new THREE.Color(0.25, 0.27, 0.3);
    this.fog.color.copy(fogDay).lerp(fogNight, t).lerp(fogStorm.multiplyScalar(lerp(1, 0.2, t)), s * 0.7);
    this.renderer.toneMappingExposure = lerp(0.5, 0.9, t);
  }

  /** Light direction used for the shadow camera (moon at night is fixed high). */
  private lightDirection(out: THREE.Vector3) {
    if (this.nightFactor > 0.5) return out.set(-0.35, 0.85, 0.4).normalize();
    return out.copy(this.sunDir);
  }

  private refreshSky() {
    this.cubeCam.update(this.renderer, this.skyScene);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.scene.environment = this.envRT.texture;
  }

  /** Keep the star dome centred on the camera. */
  followCamera(cam: THREE.Vector3) {
    this.stars.position.copy(cam);
    this.stars.visible = (this.stars.material as THREE.PointsMaterial).opacity > 0.01;
  }

  update(dt: number, focus: THREE.Vector3) {
    const before = this.nightFactor;
    const beforeStorm = this.stormFactor;
    this.nightFactor += (this.target - this.nightFactor) * damp(1.6, dt);
    if (Math.abs(this.nightFactor - this.target) < 0.002) this.nightFactor = this.target;
    this.stormFactor += (this.stormTarget - this.stormFactor) * damp(1.2, dt);
    if (Math.abs(this.stormFactor - this.stormTarget) < 0.002) this.stormFactor = this.stormTarget;
    const changing = before !== this.nightFactor || beforeStorm !== this.stormFactor;
    if (changing) {
      this.applyLighting();
      this.refreshTimer -= dt;
      if (this.refreshTimer <= 0) {
        this.dirty = true;
        this.refreshTimer = 0.25;
      }
    } else if (this.refreshTimer > -1) {
      // One final refresh once the transition settles.
      this.dirty = true;
      this.refreshTimer = -2;
    }
    if (this.dirty) {
      this.dirty = false;
      this.applyLighting();
      this.refreshSky();
    }
    this.updateShadowCamera(focus);
  }

  /**
   * Tight-fit shadow box centred on the player, snapped to shadow-map texels
   * so shadows don't shimmer as the player moves.
   */
  private updateShadowCamera(focus: THREE.Vector3) {
    const dir = this.lightDirection(TMP_DIR);
    // Light-space basis.
    this.lightView.lookAt(ORIGIN, TMP_V.copy(dir).negate(), UP);
    this.lightViewInv.copy(this.lightView).invert();
    const c = TMP_C.copy(focus).applyMatrix4(this.lightViewInv);
    const texel = this.shadowTexel || 0.05;
    c.x = Math.round(c.x / texel) * texel;
    c.y = Math.round(c.y / texel) * texel;
    c.applyMatrix4(this.lightView);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, 180);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  dispose() {
    this.cubeRT.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}

const TMP_DIR = new THREE.Vector3();
const TMP_V = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
