import * as THREE from 'three';
import { damp } from '../core/math/noise';

export type HandPose = 'rest' | 'cast' | 'charge' | 'raise' | 'down' | 'push' | 'grip' | 'hidden';
export type Side = 'left' | 'right';

interface PoseDef {
  pos: [number, number, number];
  rot: [number, number, number];
}

/** Right-hand poses (left hand mirrors X / Y-rotation / Z-rotation). Camera space. */
const POSES: Record<HandPose, PoseDef> = {
  rest: { pos: [0.27, -0.33, -0.46], rot: [0.15, 0.1, 0.25] },
  cast: { pos: [0.17, -0.17, -0.62], rot: [1.35, 0.05, -0.1] },
  charge: { pos: [0.09, -0.24, -0.47], rot: [0.9, 0.9, -0.2] },
  raise: { pos: [0.26, 0.02, -0.5], rot: [1.9, 0.1, 0.1] },
  down: { pos: [0.3, -0.42, -0.42], rot: [-0.3, 0, 0.1] },
  push: { pos: [0.24, -0.16, -0.6], rot: [1.45, 0.15, 0.25] },
  grip: { pos: [0.2, -0.12, -0.55], rot: [1.1, 0.4, 0.4] },
  hidden: { pos: [0.3, -0.9, -0.3], rot: [0, 0, 0] },
};

/**
 * One first-person hand: forearm, palm, fingers, a palm anchor for VFX and an
 * emissive glow that abilities can tint.
 */
class Hand {
  readonly root = new THREE.Group();
  /** VFX anchor at the palm centre (local -Z points out of the palm). */
  readonly palm = new THREE.Object3D();
  pose: HandPose = 'rest';
  private targetPos = new THREE.Vector3();
  private targetQuat = new THREE.Quaternion();
  private recoil = 0;
  private fingers: THREE.Mesh[] = [];
  private curl = 0.3;
  curlTarget = 0.3;

  constructor(
    readonly side: Side,
    skin: THREE.Material,
    sleeve: THREE.Material,
  ) {
    const m = side === 'left' ? -1 : 1;
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 10), sleeve);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.set(0, 0, 0.2);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.03, 0.095), skin);
    palm.position.set(0, 0, -0.02);
    this.root.add(forearm, palm);
    const fingerGeo = new THREE.CapsuleGeometry(0.0105, 0.05, 3, 6);
    fingerGeo.rotateX(Math.PI / 2);
    fingerGeo.translate(0, 0, -0.03);
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Mesh(fingerGeo, skin);
      pivot.position.set((-0.03 + i * 0.02) * m, 0, -0.065);
      pivot.scale.setScalar(i === 3 ? 0.8 : 1);
      this.fingers.push(pivot);
      this.root.add(pivot);
    }
    const thumb = new THREE.Mesh(fingerGeo, skin);
    thumb.position.set(-0.045 * m, -0.005, -0.02);
    thumb.rotation.y = 0.8 * m;
    this.root.add(thumb);
    this.palm.position.set(0, -0.03, -0.06);
    this.palm.rotation.x = -Math.PI / 2;
    this.root.add(this.palm);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = false;
        (o as THREE.Mesh).frustumCulled = false;
      }
    });
    this.setPose('rest', true);
  }

  setPose(p: HandPose, instant = false) {
    this.pose = p;
    const def = POSES[p];
    const m = this.side === 'left' ? -1 : 1;
    this.targetPos.set(def.pos[0] * m, def.pos[1], def.pos[2]);
    this.targetQuat.setFromEuler(new THREE.Euler(def.rot[0], def.rot[1] * m, def.rot[2] * m, 'XYZ'));
    this.curlTarget = p === 'grip' || p === 'charge' ? 0.9 : p === 'rest' ? 0.35 : 0.05;
    if (instant) {
      this.root.position.copy(this.targetPos);
      this.root.quaternion.copy(this.targetQuat);
    }
  }

  kick(amount: number) {
    this.recoil = Math.min(0.25, this.recoil + amount);
  }

  update(dt: number, bob: THREE.Vector2, sway: THREE.Vector2) {
    const k = damp(14, dt);
    this.root.position.lerp(this.targetPos, k);
    this.root.quaternion.slerp(this.targetQuat, k);
    this.recoil += (0 - this.recoil) * damp(9, dt);
    this.root.position.z += this.recoil;
    this.root.position.y -= this.recoil * 0.3;
    this.root.position.x += bob.x + sway.x;
    this.root.position.y += bob.y + sway.y;
    this.curl += (this.curlTarget - this.curl) * damp(12, dt);
    for (const f of this.fingers) f.rotation.x = -this.curl * 1.4;
  }
}

/**
 * First-person hands parented to the camera. Abilities drive them with
 * `pose()`, `kick()` (recoil) and `glow()` (emissive tint + palm light).
 */
export class Hands {
  readonly group = new THREE.Group();
  readonly left: Hand;
  readonly right: Hand;
  private skin: THREE.MeshStandardMaterial;
  private sleeve: THREE.MeshStandardMaterial;
  private glowColor = new THREE.Color();
  private glowLevel = 0;
  private glowTarget = 0;
  private bob = new THREE.Vector2();
  private sway = new THREE.Vector2();
  private bobPhase = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  /** Point light in the right palm, lit by ability glows. */
  readonly light = new THREE.PointLight(0xffffff, 0, 4, 2);

  constructor(camera: THREE.Camera) {
    this.skin = new THREE.MeshStandardMaterial({ color: 0xc89474, roughness: 0.6, metalness: 0 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: 0x1d2330, roughness: 0.85, metalness: 0.05 });
    this.left = new Hand('left', this.skin, this.sleeve);
    this.right = new Hand('right', this.skin, this.sleeve);
    this.group.add(this.left.root, this.right.root);
    this.right.palm.add(this.light);
    this.light.position.set(0, 0, -0.05);
    camera.add(this.group);
  }

  hand(side: Side): Hand {
    return side === 'left' ? this.left : this.right;
  }

  pose(left: HandPose | null, right: HandPose | null) {
    if (left) this.left.setPose(left);
    if (right) this.right.setPose(right);
  }

  kick(side: Side | 'both', amount: number) {
    if (side !== 'right') this.left.kick(amount);
    if (side !== 'left') this.right.kick(amount);
  }

  /** Emissive glow on the hands; call every frame while active (it decays). */
  glow(color: THREE.ColorRepresentation, level: number) {
    this.glowColor.set(color);
    this.glowTarget = Math.max(this.glowTarget, level);
  }

  /** Accent colour for the sleeves (current power). */
  setAccent(color: THREE.ColorRepresentation) {
    this.sleeve.emissive.set(color);
    this.sleeve.emissiveIntensity = 0.08;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  update(dt: number, speed: number, grounded: boolean, yaw: number, pitch: number) {
    // Walk bob.
    const moving = grounded ? Math.min(1, speed / 8) : 0;
    this.bobPhase += dt * (speed * 1.75);
    this.bob.set(Math.cos(this.bobPhase * 0.5) * 0.012 * moving, -Math.abs(Math.sin(this.bobPhase)) * 0.014 * moving);
    // Sway lags behind camera rotation.
    let dy = yaw - this.lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.sway.x += (THREE.MathUtils.clamp(dy * 0.4, -0.05, 0.05) - this.sway.x) * damp(10, dt);
    this.sway.y += (THREE.MathUtils.clamp(-dp * 0.4, -0.05, 0.05) - this.sway.y) * damp(10, dt);
    this.left.update(dt, this.bob, this.sway);
    this.right.update(dt, this.bob, this.sway);

    this.glowLevel += (this.glowTarget - this.glowLevel) * damp(12, dt);
    this.glowTarget = 0;
    this.skin.emissive.copy(this.glowColor);
    this.skin.emissiveIntensity = this.glowLevel * 1.5;
    this.light.color.copy(this.glowColor);
    this.light.intensity = this.glowLevel * 6;
  }

  /** World position of a palm (for spawning VFX). */
  palmWorld(side: Side, out = new THREE.Vector3()): THREE.Vector3 {
    return this.hand(side).palm.getWorldPosition(out);
  }
}
