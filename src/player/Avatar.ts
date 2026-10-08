import * as THREE from 'three';
import { damp } from '../core/math/noise';

/**
 * Low-poly third-person body built from primitives, with a procedural walk
 * cycle. Also used as the shadow caster in first person (so the player still
 * has a shadow), and as the base for the Shadow-clone decoy.
 */
export class Avatar {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head: THREE.Mesh;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreL = new THREE.Group();
  private foreR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private shinL = new THREE.Group();
  private shinR = new THREE.Group();
  readonly palmL = new THREE.Object3D();
  readonly palmR = new THREE.Object3D();
  readonly suit: THREE.MeshStandardMaterial;
  readonly skin: THREE.MeshStandardMaterial;
  readonly accent: THREE.MeshStandardMaterial;
  private phase = 0;
  private walk = 0;
  /** 0..1 how much the right arm is raised to aim. */
  aim = 0;
  aimTarget = 0;
  /** Both arms forward (channelling). */
  channel = 0;
  channelTarget = 0;
  private yaw = 0;
  private allMeshes: THREE.Mesh[] = [];

  constructor(opts: { suit?: number; skin?: number; accent?: number } = {}) {
    this.suit = new THREE.MeshStandardMaterial({ color: opts.suit ?? 0x232a38, roughness: 0.8, metalness: 0.05 });
    this.skin = new THREE.MeshStandardMaterial({ color: opts.skin ?? 0xc89474, roughness: 0.6 });
    this.accent = new THREE.MeshStandardMaterial({ color: opts.accent ?? 0xffffff, emissive: opts.accent ?? 0xffffff, emissiveIntensity: 0.6, roughness: 0.4 });
    const limb = (len: number, r: number, mat: THREE.Material) => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 8);
      g.translate(0, -len / 2 - r * 0.5, 0);
      const m = new THREE.Mesh(g, mat);
      this.allMeshes.push(m);
      return m;
    };
    // Hips at 0.95 m above the feet.
    this.hips.position.y = 0.95;
    this.root.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.16, 4, 8), this.suit);
    pelvis.rotation.z = Math.PI / 2;
    this.allMeshes.push(pelvis);
    this.hips.add(pelvis);
    this.torso.position.y = 0.05;
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.32, 4, 10), this.suit);
    chest.position.y = 0.3;
    chest.scale.set(1.1, 1, 0.75);
    this.allMeshes.push(chest);
    this.torso.add(chest);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.02), this.accent);
    stripe.position.set(0, 0.32, 0.15);
    this.allMeshes.push(stripe);
    this.torso.add(stripe);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), this.skin);
    this.head.position.y = 0.72;
    this.head.name = 'head';
    this.head.scale.set(0.95, 1.1, 1);
    this.allMeshes.push(this.head);
    this.torso.add(this.head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), this.suit);
    hair.position.y = 0.74;
    this.allMeshes.push(hair);
    this.torso.add(hair);

    for (const [arm, fore, palm, x] of [
      [this.armL, this.foreL, this.palmL, -0.26],
      [this.armR, this.foreR, this.palmR, 0.26],
    ] as const) {
      arm.position.set(x, 0.52, 0);
      this.torso.add(arm);
      arm.add(limb(0.24, 0.055, this.suit));
      fore.position.y = -0.34;
      arm.add(fore);
      fore.add(limb(0.22, 0.045, this.suit));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.skin);
      hand.position.y = -0.33;
      this.allMeshes.push(hand);
      fore.add(hand);
      palm.position.y = -0.36;
      fore.add(palm);
    }
    for (const [leg, shin, x] of [
      [this.legL, this.shinL, -0.11],
      [this.legR, this.shinR, 0.11],
    ] as const) {
      leg.position.set(x, -0.05, 0);
      this.hips.add(leg);
      leg.add(limb(0.32, 0.075, this.suit));
      shin.position.y = -0.44;
      leg.add(shin);
      shin.add(limb(0.32, 0.06, this.suit));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), this.suit);
      foot.position.set(0, -0.44, 0.05);
      this.allMeshes.push(foot);
      shin.add(foot);
    }
    for (const m of this.allMeshes) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  }

  setAccent(color: THREE.ColorRepresentation) {
    this.accent.color.set(color);
    this.accent.emissive.set(color);
  }

  /** Visible to camera, or shadow-only (first person). */
  setMode(mode: 'visible' | 'shadowOnly' | 'hidden') {
    this.root.visible = mode !== 'hidden';
    for (const m of this.allMeshes) {
      // A material colorWrite trick would affect shared materials; instead use layers:
      // layer 1 = shadow-only (camera doesn't render it, the light does).
      if (mode === 'shadowOnly') m.layers.set(1);
      else m.layers.set(0);
    }
  }

  /** Set opacity for dissolve effects (invisibility, phase). */
  setOpacity(o: number) {
    for (const mat of [this.suit, this.skin, this.accent]) {
      mat.transparent = o < 0.999;
      mat.opacity = o;
      mat.depthWrite = o > 0.5;
    }
  }

  update(dt: number, feet: THREE.Vector3, yaw: number, speed: number, grounded: boolean, crouch: number) {
    this.root.position.copy(feet);
    let dy = yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * damp(14, dt);
    this.root.rotation.y = this.yaw + Math.PI;

    const targetWalk = grounded ? Math.min(1, speed / 6) : 0.15;
    this.walk += (targetWalk - this.walk) * damp(8, dt);
    this.phase += dt * speed * 1.6;
    const s = Math.sin(this.phase);
    const swing = 0.75 * this.walk;
    this.legL.rotation.x = s * swing;
    this.legR.rotation.x = -s * swing;
    this.shinL.rotation.x = -Math.max(0, -s) * swing * 1.2;
    this.shinR.rotation.x = -Math.max(0, s) * swing * 1.2;
    this.hips.position.y = 0.95 - crouch * 0.38 + Math.abs(Math.cos(this.phase)) * 0.04 * this.walk;
    this.legL.rotation.x -= crouch * 0.9;
    this.legR.rotation.x -= crouch * 0.9;
    this.shinL.rotation.x += crouch * 1.6;
    this.shinR.rotation.x += crouch * 1.6;
    this.torso.rotation.x = crouch * 0.35 + this.walk * 0.06;

    this.aim += (this.aimTarget - this.aim) * damp(12, dt);
    this.channel += (this.channelTarget - this.channel) * damp(10, dt);
    const armSwing = s * 0.6 * this.walk;
    this.armL.rotation.x = THREE.MathUtils.lerp(-armSwing, -1.45, this.channel);
    this.armR.rotation.x = THREE.MathUtils.lerp(armSwing, -1.5, Math.max(this.aim, this.channel));
    this.armL.rotation.z = THREE.MathUtils.lerp(0.08, -0.15, this.channel);
    this.armR.rotation.z = THREE.MathUtils.lerp(-0.08, 0.1, Math.max(this.aim, this.channel));
    this.foreL.rotation.x = -0.25 - this.walk * 0.2;
    this.foreR.rotation.x = THREE.MathUtils.lerp(-0.25 - this.walk * 0.2, -0.05, this.aim);
  }
}
