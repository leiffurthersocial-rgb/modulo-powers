import * as THREE from 'three';

interface LightRequest {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  intensity: number;
  range: number;
  score: number;
}

/**
 * Dynamic point lights for fire, lightning, fireballs, etc.
 *
 * Effects *request* a light every frame (`add`); at the end of the frame the
 * pool assigns its fixed number of real PointLights to the most important
 * requests (bright and close to the camera). The number of lights never
 * changes during play, so Three never has to recompile shaders mid-game.
 */
export class LightPool {
  private lights: THREE.PointLight[] = [];
  private requests: LightRequest[] = [];
  private used = 0;
  private group = new THREE.Group();
  private cam = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    count: number,
  ) {
    scene.add(this.group);
    this.setCount(count);
  }

  /** Rebuild the pool (one-time shader recompile, used on quality change). */
  setCount(n: number) {
    for (const l of this.lights) {
      this.group.remove(l);
      l.dispose();
    }
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
  }

  /** Request a light for this frame. */
  add(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, range: number) {
    if (intensity <= 0.01) return;
    let r = this.requests[this.used];
    if (!r) {
      r = { x: 0, y: 0, z: 0, color: new THREE.Color(), intensity: 0, range: 0, score: 0 };
      this.requests.push(r);
    }
    this.used++;
    r.x = pos.x;
    r.y = pos.y;
    r.z = pos.z;
    r.color.set(color);
    r.intensity = intensity;
    r.range = range;
  }

  /** Assign real lights to the top requests. Call once per frame after effects update. */
  flush(camera: THREE.Camera) {
    camera.getWorldPosition(this.cam);
    const reqs = this.requests;
    const n = this.used;
    for (let i = 0; i < n; i++) {
      const r = reqs[i];
      const d2 = (r.x - this.cam.x) ** 2 + (r.y - this.cam.y) ** 2 + (r.z - this.cam.z) ** 2;
      r.score = (r.intensity * r.range * r.range) / (d2 + r.range * r.range);
    }
    // Partial selection sort is fine: n is small.
    const active = reqs.slice(0, n).sort((a, b) => b.score - a.score);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const r = active[i];
      if (r) {
        l.position.set(r.x, r.y, r.z);
        l.color.copy(r.color);
        l.intensity = r.intensity;
        l.distance = r.range;
      } else {
        l.intensity = 0;
      }
    }
    this.used = 0;
  }

  /** Sum of light reaching a point from active requests last frame (stealth). */
  lightAt(p: THREE.Vector3): number {
    let total = 0;
    for (const l of this.lights) {
      if (l.intensity <= 0) continue;
      const d = l.position.distanceTo(p);
      if (d < l.distance) total += (l.intensity / 30) * (1 - d / l.distance) ** 2;
    }
    return total;
  }
}
