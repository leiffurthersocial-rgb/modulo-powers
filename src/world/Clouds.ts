import * as THREE from 'three';
import type { Game, GameSystem } from '../core/Game';
import { time } from '../core/Time';

/**
 * A procedural cloud layer: a huge plane high above the map with scrolling
 * fbm clouds, lit by the sun / moon colour, thicker and darker in storms.
 */
export class Clouds implements GameSystem {
  private mesh: THREE.Mesh;
  private uniforms = {
    uTime: { value: 0 },
    uCover: { value: 0.45 },
    uSun: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.55, 0.6, 0.7) },
    uOpacity: { value: 1 },
    uFar: { value: 500 },
    uCam: { value: new THREE.Vector3() },
  };

  constructor(private game: Game) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uCover, uOpacity, uFar;
        uniform vec3 uCam;
        uniform vec3 uSun, uShade;
        varying vec2 vUv;
        varying vec3 vW;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
          return s;
        }
        void main() {
          vec2 p = vW.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = fbm(p);
          float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, n);
          // Fake self-shadowing: denser cores are darker.
          float core = smoothstep(1.0 - uCover + 0.1, 1.0, n);
          vec3 col = mix(uSun, uShade, core * 0.8);
          // Fade out before the camera's far plane so the layer never shows a hard edge.
          float edge = 1.0 - smoothstep(uFar * 0.55, uFar * 0.92, length(vW - uCam));
          float a = d * edge * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(col, a * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(Math.PI / 2), mat);
    this.mesh.position.y = 160;
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
  }

  get enabled(): boolean {
    return this.mesh.visible;
  }

  setEnabled(on: boolean) {
    this.mesh.visible = on;
  }

  update(_dt: number, realDt: number) {
    if (!this.mesh.visible) return;
    const g = this.game;
    const env = g.env;
    this.uniforms.uTime.value += time.paused ? 0 : realDt * (1 + env.stormFactor * 3);
    const night = env.nightFactor;
    const storm = env.stormFactor;
    this.uniforms.uCover.value = 0.42 + storm * 0.45;
    const day = new THREE.Color(1.6, 1.55, 1.45);
    const nightC = new THREE.Color(0.06, 0.07, 0.1);
    this.uniforms.uSun.value.copy(day).lerp(nightC, night).multiplyScalar(1 - storm * 0.55);
    this.uniforms.uShade.value.setRGB(0.55, 0.6, 0.7).lerp(new THREE.Color(0.03, 0.035, 0.05), night).multiplyScalar(1 - storm * 0.5);
    this.uniforms.uFar.value = g.camera.far;
    this.uniforms.uCam.value.copy(g.camera.position);
    this.mesh.position.x = g.camera.position.x;
    this.mesh.position.z = g.camera.position.z;
  }
}
