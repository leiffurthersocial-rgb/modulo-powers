import * as THREE from 'three';
import { CAMERA, PLAYER } from '../config/balance';
import { G, groups, ALL_GROUPS } from '../config/physics';
import type { Input } from '../core/Input';
import type { Physics } from '../core/Physics';
import { damp, Simplex2 } from '../core/math/noise';
import type { PlayerController } from './PlayerController';

export type ViewMode = 'first' | 'third';

/**
 * Camera rig: yaw/pitch look from arrow keys (with smooth acceleration),
 * mouse/trackpad and touch-drag; first/third person; head bob, FOV kick,
 * landing dip and trauma-based screen shake.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0;
  private yawVel = 0;
  private pitchVel = 0;
  mode: ViewMode = 'first';
  headBob = CAMERA.headBob;

  private bobPhase = 0;
  private bobAmount = 0;
  private landDip = 0;
  private landDipVel = 0;
  private trauma = 0;
  private flash = 0;
  private fovKick = 0;
  /** Extra FOV offset requested by powers (dash, thrust). Decays automatically. */
  private fovPulse = 0;
  private thirdDist = CAMERA.thirdPersonDistance;
  private viewBlend = 0; // 0 first, 1 third
  private shakeNoise = new Simplex2(4242);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private input: Input,
    private physics: Physics,
  ) {}

  toggleView() {
    this.mode = this.mode === 'first' ? 'third' : 'first';
  }

  /** Add screen shake (0..1). Shake strength is trauma². */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Screen flash intensity (0..1), read by the post/HUD layer. */
  addFlash(amount: number) {
    this.flash = Math.min(1, this.flash + amount);
  }

  get flashLevel(): number {
    return this.flash;
  }

  fovPunch(deg: number) {
    this.fovPulse = Math.max(this.fovPulse, deg);
  }

  land(impactSpeed: number) {
    this.landDipVel -= Math.min(impactSpeed, 20) * 0.09;
    if (impactSpeed > 9) this.shake(Math.min(0.5, (impactSpeed - 9) * 0.05));
  }

  setLook(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.yawVel = this.pitchVel = 0;
  }

  /** Look input. Uses real (unscaled) time so turning stays responsive in slow-mo. */
  updateLook(realDt: number, enabled: boolean) {
    const look = this.input.consumeLook();
    if (!enabled) {
      this.yawVel = this.pitchVel = 0;
      return;
    }
    // Keyboard: accelerate towards max turn rate, decelerate faster.
    const kx = this.input.axis('lookLeft', 'lookRight');
    const ky = this.input.axis('lookDown', 'lookUp');
    const ty = -kx * CAMERA.keyYawRate;
    const tp = ky * CAMERA.keyPitchRate;
    const ay = (Math.abs(ty) > Math.abs(this.yawVel) ? CAMERA.keyAccel : CAMERA.keyDecel) * realDt;
    const ap = (Math.abs(tp) > Math.abs(this.pitchVel) ? CAMERA.keyAccel : CAMERA.keyDecel) * realDt;
    this.yawVel += THREE.MathUtils.clamp(ty - this.yawVel, -ay, ay);
    this.pitchVel += THREE.MathUtils.clamp(tp - this.pitchVel, -ap, ap);
    this.yaw += this.yawVel * realDt;
    this.pitch += this.pitchVel * realDt;

    // Mouse / trackpad / touch.
    this.yaw -= look.mx * CAMERA.mouseSensitivity + look.tx * CAMERA.touchSensitivity;
    this.pitch -= look.my * CAMERA.mouseSensitivity + look.ty * CAMERA.touchSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  update(dt: number, realDt: number, player: PlayerController, sprinting: boolean) {
    const cam = this.camera;
    // Eye height relative to the interpolated capsule centre.
    const feetY = player.renderPos.y - player.halfHeight - PLAYER.radius;
    const eyeH = THREE.MathUtils.lerp(PLAYER.eyeHeightStanding, PLAYER.eyeHeightCrouching, player.crouchT);
    // When crouching mid-air the capsule shrinks from the bottom; keep the eye smooth.
    this.eye.set(player.renderPos.x, feetY + eyeH, player.renderPos.z);

    // Landing dip (critically damped spring).
    const k = 120;
    const c = 2 * Math.sqrt(k);
    this.landDipVel += (-k * this.landDip - c * this.landDipVel) * dt;
    this.landDip += this.landDipVel * dt;
    this.eye.y += this.landDip;

    // Head bob.
    const spd = player.grounded ? player.speed : 0;
    this.bobAmount += ((spd > 0.5 ? Math.min(1, spd / PLAYER.sprintSpeed) : 0) - this.bobAmount) * damp(8, dt);
    this.bobPhase += dt * (spd * 1.75 + 0.01);
    if (this.headBob && this.mode === 'first') {
      const a = CAMERA.headBobAmount * this.bobAmount;
      this.eye.y += Math.abs(Math.sin(this.bobPhase)) * a - a * 0.5;
    }

    // Orientation.
    const euler = TMP_EULER.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(euler);
    if (this.headBob && this.mode === 'first') {
      const roll = Math.sin(this.bobPhase) * 0.006 * this.bobAmount;
      cam.quaternion.multiply(TMP_Q.setFromAxisAngle(Z_AXIS, roll));
    }
    this.forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);

    // First / third person blend.
    this.viewBlend += ((this.mode === 'third' ? 1 : 0) - this.viewBlend) * damp(10, realDt);
    if (this.viewBlend > 0.001) {
      const pivot = this.tmp.copy(this.eye).addScaledVector(UP, CAMERA.thirdPersonHeight);
      const back = this.tmp2
        .copy(this.forward)
        .multiplyScalar(-CAMERA.thirdPersonDistance)
        .addScaledVector(this.right, CAMERA.thirdPersonShoulder);
      const len = back.length();
      back.divideScalar(len);
      // Keep the camera out of walls.
      const hit = this.physics.raycast(pivot, back, len + 0.3, {
        groups: groups(G.PLAYER, ALL_GROUPS & ~G.PLAYER & ~G.DEBRIS & ~G.SENSOR & ~G.NPC & ~G.DYNAMIC),
        exclude: player.collider,
      });
      const want = hit ? Math.max(0.3, hit.distance - 0.3) : len;
      this.thirdDist = want < this.thirdDist ? want : this.thirdDist + (want - this.thirdDist) * damp(4, realDt);
      cam.position.copy(this.eye).lerp(pivot.addScaledVector(back, this.thirdDist), this.viewBlend);
    } else {
      cam.position.copy(this.eye);
    }

    // Screen shake (trauma²), decays in real time so slow-mo doesn't prolong it.
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const t = performance.now() * 0.025;
      const n = this.shakeNoise;
      cam.position.x += n.noise(t, 1) * 0.12 * s;
      cam.position.y += n.noise(t, 2) * 0.12 * s;
      TMP_EULER.set(n.noise(t, 3) * 0.05 * s, n.noise(t, 4) * 0.05 * s, n.noise(t, 5) * 0.07 * s, 'YXZ');
      cam.quaternion.multiply(TMP_Q.setFromEuler(TMP_EULER));
      this.trauma = Math.max(0, this.trauma - realDt * 1.4);
    }
    this.flash = Math.max(0, this.flash - realDt * 3.5);

    // FOV kick when sprinting + power pulses.
    const sprintKick = sprinting && player.speed > PLAYER.walkSpeed + 0.5 ? CAMERA.sprintFovKick : 0;
    this.fovKick += (sprintKick - this.fovKick) * damp(5, realDt);
    this.fovPulse = Math.max(0, this.fovPulse - realDt * 25);
    const fov = CAMERA.fov + this.fovKick + this.fovPulse;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Direction the camera is aiming (centre of screen). */
  aimDirection(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.forward);
  }
}

const TMP_EULER = new THREE.Euler();
const TMP_Q = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
