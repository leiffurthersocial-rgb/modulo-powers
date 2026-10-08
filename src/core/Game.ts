import * as THREE from 'three';
import type { Action } from '../config/keybindings';
import { WORLD } from '../config/map';
import { G, groups } from '../config/physics';
import { CameraRig } from '../player/CameraRig';
import { Avatar } from '../player/Avatar';
import { Hands } from '../player/Hands';
import { PlayerController } from '../player/PlayerController';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';
import { StartOverlay } from '../ui/StartOverlay';
import { Toasts } from '../ui/Toasts';
import { Environment } from '../world/Environment';
import { surfaceTextures } from '../world/textures';
import { World } from '../world/World';
import { audio } from './Audio';
import { Input } from './Input';
import { Loop } from './Loop';
import { Physics, RAPIER } from './Physics';
import { QualityManager } from './Quality';
import { time } from './Time';

/**
 * Top-level orchestrator: owns the renderer, scene, physics world, player and
 * all systems, and routes the fixed / per-frame updates.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly physics: Physics;
  readonly input: Input;
  readonly quality: QualityManager;
  readonly env: Environment;
  readonly world: World;
  readonly player: PlayerController;
  readonly rig: CameraRig;
  readonly hands: Hands;
  readonly avatar: Avatar;
  readonly hud: Hud;
  readonly toasts: Toasts;
  private pauseMenu: PauseMenu;
  private startOverlay: StartOverlay;
  private loop: Loop;
  started = false;
  checkpoint = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
    ui: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.quality = new QualityManager(this.renderer);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, this.quality.preset.viewDistance);
    this.scene.add(this.camera);

    this.physics = new Physics();
    this.input = new Input(canvas);
    this.env = new Environment(this.renderer, this.scene);
    this.world = new World(this.physics, this.scene);
    this.checkpoint.copy(this.world.spawn);

    this.player = new PlayerController(this.physics, this.world.spawn);
    this.rig = new CameraRig(this.camera, this.input, this.physics);
    this.rig.setLook(0, -0.05);
    this.hands = new Hands(this.camera);
    this.avatar = new Avatar();
    this.scene.add(this.avatar.root);
    this.hud = new Hud(ui);
    this.hud.visible = false;
    this.toasts = new Toasts(ui);

    this.spawnTestProps();
    this.wirePlayerEvents();
    this.applyQuality();
    this.quality.onChange = () => this.applyQuality();

    this.pauseMenu = new PauseMenu(
      ui,
      {
        resume: () => this.setPaused(false),
        toggleHeadBob: () => (this.rig.headBob = !this.rig.headBob),
        cycleQuality: () => this.quality.cycle().label,
        togglePostFX: () => (this.quality.postFX = !this.quality.postFX),
        toggleView: () => {
          this.rig.toggleView();
          return this.rig.mode === 'first' ? 'First person' : 'Third person';
        },
      },
      { headBob: this.rig.headBob, quality: this.quality.preset.label, postFX: this.quality.postFX, view: 'First person' },
    );
    this.startOverlay = new StartOverlay(ui, () => this.start());
    this.input.onAction = (a) => this.onAction(a);

    this.loop = new Loop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      update: (dt, realDt, alpha) => this.update(dt, realDt, alpha),
      render: () => this.render(),
    });

    this.onResize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', () => setTimeout(this.onResize, 200));
    window.visualViewport?.addEventListener('resize', this.onResize);
  }

  /** Begin rendering behind the start overlay. */
  run() {
    this.loop.start();
    this.startOverlay.ready();
  }

  private start() {
    if (this.started) return;
    this.started = true;
    audio.unlock();
    this.startOverlay.hide();
    this.hud.visible = true;
    this.input.enabled = true;
    this.canvas.focus();
    const isTouch = navigator.maxTouchPoints > 1;
    // Fullscreen + keyboard lock on desktop (lets us capture Ctrl+W etc. in Chrome).
    if (!isTouch) {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
      try {
        const p = req?.();
        p?.then(() => (navigator as unknown as { keyboard?: { lock?: () => Promise<void> } }).keyboard?.lock?.()).catch(() => {});
      } catch {
        /* not supported */
      }
      this.input.requestPointerLock();
      // Safety net: Ctrl (crouch) + W (forward) closes the tab in some browsers.
      window.addEventListener('beforeunload', (e) => {
        if (this.started) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
    }
    this.toasts.show('Welcome to Modulo: Powers — press H for help');
  }

  private onResize = () => {
    const w = window.visualViewport?.width ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.quality.applyPixelRatio();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private applyQuality() {
    const q = this.quality.preset;
    this.env.applyQuality(q);
    this.camera.far = q.viewDistance;
    this.camera.updateProjectionMatrix();
    this.world.vegetation.setDensity(q.vegetationDensity);
    this.renderer.shadowMap.enabled = q.shadows;
    this.quality.applyPixelRatio();
  }

  setPaused(p: boolean) {
    time.paused = p;
    this.pauseMenu.visible = p;
    this.input.allowPointerLock = !p;
    audio.setPaused(p);
    if (p) {
      this.input.exitPointerLock();
      this.input.releaseAll();
    }
  }

  /** Global (non-ability) actions. */
  private onAction(a: Action) {
    switch (a) {
      case 'pause':
        this.setPaused(!time.paused);
        break;
      case 'toggleView':
        this.rig.toggleView();
        this.pauseMenu.setView(this.rig.mode === 'first' ? 'First person' : 'Third person');
        break;
      case 'mute':
        audio.setMuted(!audio.muted);
        this.toasts.show(audio.muted ? 'Sound muted' : 'Sound on');
        break;
      case 'quality': {
        const q = this.quality.cycle();
        this.pauseMenu.setQuality(q.label);
        this.toasts.show(`Quality: ${q.label}`);
        break;
      }
      case 'dayNight':
        this.env.toggle();
        this.toasts.show(this.env.isNight ? 'Night falls' : 'Daybreak');
        break;
      case 'slowMo':
        time.scale = time.scale < 1 ? 1 : 0.25;
        audio.rate = time.scale < 1 ? 0.6 : 1;
        this.toasts.show(time.scale < 1 ? 'Slow motion 0.25×' : 'Normal speed');
        break;
      case 'respawn':
        this.respawn();
        break;
      case 'jump':
        if (!time.paused) this.player.requestJump();
        break;
    }
  }

  respawn() {
    this.player.teleport(this.checkpoint);
    this.toasts.show('Respawned at checkpoint');
  }

  private wirePlayerEvents() {
    const p = this.player;
    p.onLand = (speed) => {
      this.rig.land(speed);
      audio.land(p.feet(this.tmp), Math.min(1, speed / 15));
    };
    p.onJump = () => audio.jump(p.feet(this.tmp));
    p.onStep = (surface) => audio.footstep(p.feet(this.tmp), surface, this.input.isDown('sprint') ? 1.3 : this.player.crouching ? 0.4 : 1);
    p.surfaceOf = (_collider, pos) => {
      const y = pos.y - p.halfHeight - 0.35;
      if (y < WORLD.waterLevel + 0.15 && this.world.heightAt(pos.x, pos.z) < WORLD.waterLevel) return 'water';
      if (this.world.terrain.shape.pathSurface(pos.x, pos.z) > 0.5) return 'sand';
      return 'grass';
    };
  }

  /** A few physics props near spawn to test the controller (proper zones come later). */
  private spawnTestProps() {
    const wood = surfaceTextures('wood');
    const mat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normal, roughnessMap: wood.rough, roughness: 1 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const base = this.world.spawn;
    for (let i = 0; i < 10; i++) {
      const row = Math.floor(i / 4);
      const x = base.x + 5 + (i % 4) * 1.05 - row * 0.5 + (row === 2 ? 1 : 0);
      const z = base.z - 6;
      const y = this.world.heightAt(x, z) + 0.5 + row * 1.0 + 0.02;
      const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z));
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
          .setDensity(450)
          .setFriction(0.6)
          .setRestitution(0.1)
          .setCollisionGroups(groups(G.DYNAMIC)),
        body,
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.physics.sync(body, mesh);
    }
  }

  private fixedUpdate(dt: number) {
    const inp = this.input;
    const active = this.started && !time.paused;
    this.player.jumpHeld = active && inp.isDown('jump');
    this.player.fixedUpdate(dt, {
      x: active ? inp.axis('left', 'right') : 0,
      z: active ? inp.axis('back', 'forward') : 0,
      sprint: active && inp.isDown('sprint'),
      crouch: active && inp.isDown('crouch'),
      yaw: this.rig.yaw,
    });
    this.physics.step(dt);
    if (this.player.curPos.y < WORLD.killY) this.respawn();
  }

  private update(dt: number, realDt: number, alpha: number) {
    const active = this.started && !time.paused;
    this.rig.updateLook(realDt, active);
    this.player.interpolate(time.paused ? 1 : alpha);
    this.physics.interpolate(time.paused ? 1 : alpha);

    const sprinting = active && this.input.isDown('sprint');
    this.rig.update(dt, realDt, this.player, sprinting);

    // Body: visible in third person, shadow-only in first person.
    const third = this.rig.mode === 'third';
    this.avatar.setMode(third ? 'visible' : 'shadowOnly');
    this.avatar.update(dt, this.player.renderFeet(this.tmp), this.rig.yaw, this.player.speed, this.player.grounded, this.player.crouchT);
    this.hands.visible = !third;
    this.hands.update(dt, this.player.speed, this.player.grounded, this.rig.yaw, this.rig.pitch);

    this.env.update(realDt, this.player.renderPos);
    audio.setListener(this.camera.position, this.rig.right);
    this.hud.setFlash(this.rig.flashLevel);
    this.quality.update(realDt);
    this.hud.tickStats(realDt, () => {
      const info = this.renderer.info.render;
      return `${this.quality.preset.label} · res ${(this.quality.resScale * 100).toFixed(0)}%\n${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
    });
    this.input.endFrame();
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }
}
