import * as THREE from 'three';
import type { Action } from '../config/keybindings';
import { WORLD, ZONES, type ZoneDef } from '../config/map';
import { G, groups } from '../config/physics';
import { CameraRig } from '../player/CameraRig';
import { Avatar } from '../player/Avatar';
import { Hands } from '../player/Hands';
import { PlayerController } from '../player/PlayerController';
import type { Ability } from '../powers/Ability';
import { Energy } from '../powers/Energy';
import { createPowers } from '../powers';
import { PowerManager } from '../powers/PowerManager';
import { HelpOverlay } from '../ui/HelpOverlay';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';
import { PowerHud } from '../ui/PowerHud';
import { StartOverlay } from '../ui/StartOverlay';
import { TeleportMenu } from '../ui/TeleportMenu';
import { Toasts } from '../ui/Toasts';
import { EntityManager } from '../world/EntityManager';
import { Environment } from '../world/Environment';
import { registerBasicProps } from '../world/props/basic';
import { registerDummy } from '../world/props/dummy';
import { registerMachines } from '../world/props/machines';
import { Signals } from '../systems/Signals';
import { InteractionSystem } from '../systems/Interaction';
import { GuardSystem } from '../npc/Guards';
import { Checkpoints } from '../systems/Checkpoints';
import { World } from '../world/World';
import { WaterSystem } from '../world/Water';
import { WaterRenderer } from '../world/WaterRenderer';
import { BoltRenderer } from '../systems/Bolts';
import { Decals } from '../systems/Decals';
import { DestructionSystem } from '../systems/Destruction';
import { ElectricitySystem } from '../systems/Electricity';
import { FireSystem } from '../systems/Fire';
import { LightPool } from '../systems/Lights';
import { MudSystem } from '../systems/Mud';
import { FX, ParticleSystem } from '../systems/Particles';
import { Reactions } from '../systems/Reactions';
import { StealthSystem } from '../systems/Stealth';
import type { SurfaceKind } from '../config/reactions';
import { ProjectileSystem } from '../powers/common';
import { StaticBuilder } from '../world/zones/build';
import { buildEarthStatic, spawnEarth } from '../world/zones/earth';
import { buildExtrasStatic, spawnExtras } from '../world/zones/extras';
import { buildFireStatic, spawnFire } from '../world/zones/fire';
import { buildHubStatic, spawnHubProps } from '../world/zones/hub';
import { buildLightningStatic, spawnLightning } from '../world/zones/lightning';
import { buildShadowStatic, spawnShadow } from '../world/zones/shadow';
import { buildWaterStatic, spawnWater } from '../world/zones/water';
import { audio } from './Audio';
import { Input } from './Input';
import { Loop } from './Loop';
import { Physics, RAPIER } from './Physics';
import { QualityManager } from './Quality';
import { time } from './Time';

/**
 * A game-wide system with optional hooks. Systems are updated in the order
 * they're registered and reset by R / Shift+R.
 */
export interface GameSystem {
  fixedUpdate?(dt: number): void;
  update?(dt: number, realDt: number): void;
  reset?(): void;
}

/**
 * Top-level orchestrator and service locator: owns the renderer, scene,
 * physics world, player, powers and all systems, and routes the fixed /
 * per-frame updates. Abilities receive the Game and use its public fields.
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
  readonly entities: EntityManager;
  readonly player: PlayerController;
  readonly rig: CameraRig;
  readonly hands: Hands;
  readonly avatar: Avatar;
  readonly energy = new Energy();
  readonly powers: PowerManager;
  readonly hud: Hud;
  readonly toasts: Toasts;
  readonly systems: GameSystem[] = [];
  readonly particles: ParticleSystem;
  readonly lights: LightPool;
  readonly decals: Decals;
  readonly bolts: BoltRenderer;
  readonly reactions: Reactions;
  readonly water: WaterSystem;
  readonly fire: FireSystem;
  readonly electricity: ElectricitySystem;
  readonly destruction: DestructionSystem;
  readonly mud: MudSystem;
  readonly projectiles: ProjectileSystem;
  readonly waterRenderer: WaterRenderer;
  /** True while the Hydro Shield is up (set by the Water power). */
  shielded = false;
  readonly stealth: StealthSystem;
  readonly signals = new Signals();
  interaction!: InteractionSystem;
  guards!: GuardSystem;
  checkpoints!: Checkpoints;
  /** Materials of walls the player can phase through (ghosted while phasing). */
  readonly phaseMaterials = new Set<THREE.Material>();
  /** Stone Armor active (Earth power). */
  armored = false;
  /** Player is tunnelling underground (Earth: Dig). */
  digging = false;
  private powerHud: PowerHud;
  private help: HelpOverlay;
  private teleportMenu: TeleportMenu;
  private pauseMenu: PauseMenu;
  private startOverlay: StartOverlay;
  private loop: Loop;
  private staticBody: RAPIER.RigidBody;
  started = false;
  checkpoint = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private lastDenied = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
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
    this.staticBody = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.input = new Input(canvas);
    this.env = new Environment(this.renderer, this.scene);
    this.world = new World(this.physics, this.scene);
    this.entities = new EntityManager(this.physics, this.scene);
    registerBasicProps(this.entities);
    registerDummy(this.entities);
    this.checkpoint.copy(this.world.spawn);

    // Effects + simulation systems.
    this.particles = new ParticleSystem(this.scene);
    this.particles.groundAt = (x, z) => this.world.heightAt(x, z);
    this.lights = new LightPool(this.scene, this.quality.preset.maxDynamicLights);
    this.decals = new Decals(this.scene);
    this.bolts = new BoltRenderer(this.scene);
    this.reactions = new Reactions(this);
    this.water = new WaterSystem(this);
    this.fire = new FireSystem(this);
    this.electricity = new ElectricitySystem(this);
    this.destruction = new DestructionSystem(this);
    this.mud = new MudSystem(this);
    this.projectiles = new ProjectileSystem(this);
    this.waterRenderer = new WaterRenderer(this);
    this.reactions.surfacesAt = (p, r) => this.surfacesAt(p, r);
    this.reactions.registerSurfaceEffect('electrifyWater', (c) => {
      const b = this.water.bodyAt(c, 2) ?? this.water.bodyUnder(c.x, c.z);
      if (b) this.water.electrify(b, 6, c);
    });
    this.systems.push(this.reactions, this.water, this.fire, this.electricity, this.destruction, this.mud, this.projectiles, this.waterRenderer);

    this.player = new PlayerController(this.physics, this.world.spawn);
    this.rig = new CameraRig(this.camera, this.input, this.physics);
    this.rig.setLook(0, -0.05);
    this.hands = new Hands(this.camera);
    this.avatar = new Avatar();
    this.scene.add(this.avatar.root);

    this.hud = new Hud(ui);
    this.toasts = new Toasts(ui);
    this.stealth = new StealthSystem(this);
    this.interaction = new InteractionSystem(this);
    this.systems.push(this.stealth, this.signals, this.interaction);
    registerMachines(this);
    this.guards = new GuardSystem(this);
    this.checkpoints = new Checkpoints(this);
    this.systems.push(this.guards, this.checkpoints);
    this.powers = new PowerManager(this, createPowers());
    this.powers.onChange = (p) => this.onPowerChanged(p.color);
    this.powerHud = new PowerHud(this.hud.root, this.powers, this.energy);
    this.help = new HelpOverlay(ui, this.powers.powers);
    this.teleportMenu = new TeleportMenu(ui, (z) => this.teleportTo(z));
    this.input.modal = (code) => this.teleportMenu.handleKey(code);
    this.hud.visible = false;
    this.onPowerChanged(this.powers.current.color);

    this.buildMap();
    this.wirePlayerEvents();
    this.wirePhysicsEvents();
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
          return this.viewLabel;
        },
      },
      { headBob: this.rig.headBob, quality: this.quality.preset.label, postFX: this.quality.postFX, view: this.viewLabel },
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

  private get viewLabel(): string {
    return this.rig.mode === 'first' ? 'First person' : 'Third person';
  }

  /** Begin rendering behind the start overlay. */
  run() {
    this.loop.start();
    this.startOverlay.ready();
  }

  /**
   * Build the test map. Static geometry is merged per material; every prop
   * spawned while `recording` is part of the initial map that R restores.
   */
  private buildMap() {
    const sb = new StaticBuilder(this);
    buildHubStatic(this, sb);
    buildLightningStatic(this, sb);
    buildFireStatic(this, sb);
    buildWaterStatic(this, sb);
    buildEarthStatic(this, sb);
    buildShadowStatic(this, sb);
    buildExtrasStatic(this, sb);
    sb.flush('level');
    this.entities.recording = true;
    spawnHubProps(this);
    spawnLightning(this);
    spawnFire(this);
    spawnWater(this);
    spawnEarth(this);
    spawnShadow(this);
    spawnExtras(this);
    this.entities.recording = false;
  }

  /** Static (never-changing) cylinder collider, e.g. plazas and platforms. */
  addStaticCylinder(center: THREE.Vector3, radius: number, halfHeight: number, group = G.STATIC) {
    return this.physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(center.x, center.y, center.z).setCollisionGroups(groups(group)),
      this.staticBody,
    );
  }

  /** Static box collider (optionally rotated about Y). */
  addStaticBox(center: THREE.Vector3, hx: number, hy: number, hz: number, ry = 0, group = G.STATIC) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, ry);
    return this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(groups(group)),
      this.staticBody,
    );
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
    this.lights?.setCount(q.maxDynamicLights);
  }

  private onPowerChanged(color: string) {
    this.hands.setAccent(color);
    this.avatar.setAccent(color);
    document.documentElement.style.setProperty('--accent', color);
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

  /** Feedback when an ability can't be used (no energy). Throttled. */
  denied(_a: Ability) {
    const now = performance.now();
    if (now - this.lastDenied < 400) return;
    this.lastDenied = now;
    audio.uiDeny();
  }

  /** Global (non-ability) actions. */
  private onAction(a: Action) {
    const paused = time.paused;
    switch (a) {
      case 'pause':
        this.setPaused(!paused);
        return;
      case 'help':
        this.help.toggle();
        return;
      case 'mute':
        audio.setMuted(!audio.muted);
        this.toasts.show(audio.muted ? 'Sound muted' : 'Sound on');
        return;
      case 'quality': {
        const q = this.quality.cycle();
        this.pauseMenu.setQuality(q.label);
        this.toasts.show(`Quality: ${q.label}`);
        return;
      }
    }
    if (paused) return;
    switch (a) {
      case 'toggleView':
        this.rig.toggleView();
        this.pauseMenu.setView(this.viewLabel);
        break;
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
        this.player.requestJump();
        break;
      case 'power1':
      case 'power2':
      case 'power3':
      case 'power4':
      case 'power5':
        this.powers.select(Number(a.slice(5)) - 1);
        audio.uiClick(true);
        break;
      case 'prevPower':
        this.powers.next(-1);
        audio.uiClick();
        break;
      case 'nextPower':
        this.powers.next(1);
        audio.uiClick();
        break;
      case 'infiniteEnergy':
        this.energy.infinite = !this.energy.infinite;
        this.toasts.show(this.energy.infinite ? 'Infinite energy ON' : 'Infinite energy OFF');
        break;
      case 'reset':
        this.resetMap();
        break;
      case 'fullReset':
        this.fullReset();
        break;
      case 'teleport':
        this.teleportMenu.visible = true;
        break;
    }
  }

  /** R: restore every prop, fire, ice, decal and machine. The player stays put. */
  resetMap(silent = false) {
    this.powers.reset();
    // Systems first (they clear fires, mud, decals...), then respawn the map,
    // whose props may re-register state with those systems.
    for (const s of this.systems) s.reset?.();
    this.particles.clear();
    this.bolts.clear();
    this.decals.reset();
    this.entities.reset();
    this.env.setStorm(0);
    if (!silent) this.toasts.show('Map reset');
  }

  /** Shift+R: map reset + player back to spawn with full energy. */
  fullReset() {
    this.resetMap(true);
    this.checkpoint.copy(this.world.spawn);
    this.player.teleport(this.world.spawn);
    this.rig.setLook(0, -0.05);
    this.energy.refill();
    time.scale = 1;
    audio.rate = 1;
    this.toasts.show('Full reset');
  }

  respawn() {
    const spot = this.player.findFreeSpot(this.checkpoint) ?? this.world.spawn;
    this.player.teleport(spot);
    this.toasts.show('Respawned at checkpoint');
  }

  teleportTo(zone: ZoneDef) {
    // Arrive just outside the zone centre, facing into it.
    const ang = Math.atan2(zone.x - ZONES.hub.x, zone.z - ZONES.hub.z);
    const back = zone.id === 'hub' ? 8 : zone.radius * 0.55;
    const x = zone.x - Math.sin(ang) * back;
    const z = zone.z - Math.cos(ang) * back;
    const target = new THREE.Vector3(x, this.world.heightAt(x, z) + 1, z);
    const spot = this.player.findFreeSpot(target, 12) ?? target;
    this.player.teleport(spot);
    this.rig.setLook(zone.id === 'hub' ? 0 : ang + Math.PI, -0.08);
    this.checkpoint.copy(spot);
    audio.noiseBurst({ volume: 0.3, decay: 0.4, filter: 'bandpass', freq: 400, freqEnd: 2400, q: 2 });
    this.toasts.show(`Teleported: ${zone.name}`, zone.color);
  }

  /** Which world surfaces are at a point (for surface reactions). */
  surfacesAt(p: THREE.Vector3, radius: number): SurfaceKind[] {
    const out: SurfaceKind[] = [];
    const body = this.water.bodyUnder(p.x, p.z);
    if (body && p.y < body.level + radius + 1) out.push('water');
    const gy = this.world.heightAt(p.x, p.z);
    if (!body && p.y - gy < radius + 1.2) {
      out.push('ground');
      if (this.fire.grassFuel(p.x, p.z) > 0) out.push('grass');
    }
    return out;
  }

  /** Electric shock on the player: flash, shake, a jolt, no lasting harm. */
  shockPlayer(amount: number, from?: THREE.Vector3) {
    if (this.shielded) {
      audio.crackle(this.player.curPos, 0.3);
      return;
    }
    this.rig.shake(0.25 + amount * 0.5);
    this.rig.addFlash(0.25 + amount * 0.4);
    audio.crackle(this.player.curPos, 0.8);
    const push = this.tmp.set(0, 2 + amount * 3, 0);
    if (from) push.add(this.tmp2.copy(this.player.curPos).sub(from).setY(0).normalize().multiplyScalar(3 * amount));
    this.player.addVelocity(push);
    this.particles.emit(FX.electric, this.player.curPos, 20, { spread: Math.PI, speed: [1, 4], jitter: 0.5 });
    this.energy.drain(8 * amount);
  }

  /** Slippery ice underfoot, heat from nearby fire. */
  private updateGroundEffects() {
    const ground = this.entities.fromCollider(this.player.groundCollider);
    if (this.player.grounded && ground && (ground.frozen > 0.5 || ground.mat.id === 'ice')) this.player.setModifier('ice', 1.05, 0.06);
    else this.player.clearModifier('ice');
  }

  private wirePlayerEvents() {
    const p = this.player;
    p.onLand = (speed) => {
      this.rig.land(speed);
      audio.land(p.feet(this.tmp), Math.min(1, speed / 15));
    };
    p.onJump = () => audio.jump(p.feet(this.tmp));
    p.onStep = (surface) => {
      const heavy = this.armored ? 2.2 : 1;
      audio.footstep(p.feet(this.tmp), this.armored ? 'stone' : surface, heavy * (this.input.isDown('sprint') ? 1.3 : this.player.crouching ? 0.4 : 1));
      if (this.armored) {
        audio.rumble(p.feet(this.tmp), 0.15, 0.25);
        this.rig.shake(0.04);
      }
    };
    p.surfaceOf = (collider, pos) => {
      const e = this.entities.fromCollider(collider);
      if (e) {
        const s = e.mat.sound;
        return s === 'metal' ? 'metal' : s === 'wood' ? 'wood' : s === 'stone' || s === 'ice' ? 'stone' : 'grass';
      }
      const y = pos.y - p.halfHeight - 0.35;
      if (y < WORLD.waterLevel + 0.15 && this.world.heightAt(pos.x, pos.z) < WORLD.waterLevel) return 'water';
      if (this.world.terrain.shape.pathSurface(pos.x, pos.z) > 0.5) return 'sand';
      if (Math.hypot(pos.x - ZONES.hub.x, pos.z - ZONES.hub.z) < 20) return 'stone';
      return 'grass';
    };
  }

  private wirePhysicsEvents() {
    // Impact sounds from contact forces (threshold set per prop in buildProp).
    let budget = 0;
    let lastFrame = -1;
    this.physics.onContactForce = ({ h1, h2, force }) => {
      if (time.frame !== lastFrame) {
        lastFrame = time.frame;
        budget = 4;
      }
      if (budget <= 0) return;
      const e1 = this.entities.fromHandle(h1);
      const e2 = this.entities.fromHandle(h2);
      const e = e1?.body?.isDynamic() ? e1 : e2 ?? e1;
      if (!e || !e.body) return;
      budget--;
      const energy = Math.min(1, force / (e.mass * 160));
      audio.impact(e.center(this.tmp), energy, e.frozen > 0.5 ? 'ice' : e.mat.sound);
      if (e1) this.destruction.onImpact(e1, force);
      if (e2) this.destruction.onImpact(e2, force);
      if (force > 1500) {
        e1?.onHit?.(force);
        e2?.onHit?.(force);
      }
    };
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
    this.powers.fixedUpdate(dt);
    this.entities.fixedUpdate(dt);
    for (const s of this.systems) s.fixedUpdate?.(dt);
    this.physics.step(dt);
    if (this.player.curPos.y < WORLD.killY) this.respawn();
  }

  private update(dt: number, realDt: number, alpha: number) {
    const active = this.started && !time.paused;
    this.rig.updateLook(realDt, active && !this.teleportMenu.visible);
    this.player.interpolate(time.paused ? 1 : alpha);
    this.physics.interpolate(time.paused ? 1 : alpha);
    this.guards.setAlpha(time.paused ? 1 : alpha);

    this.powers.handleInput(active && !this.teleportMenu.visible);
    this.powers.update(dt);
    if (dt > 0) this.energy.update(dt);
    for (const s of this.systems) s.update?.(dt, realDt);
    this.entities.updateVisuals();
    this.particles.budget = this.quality.preset.particleBudget * this.quality.particleScale;
    this.particles.setViewport(this.canvas.height, this.camera.fov);
    this.particles.update(dt);
    this.bolts.update(dt);
    this.decals.update(dt);
    this.updateGroundEffects();

    const sprinting = active && this.input.isDown('sprint');
    this.rig.update(dt, realDt, this.player, sprinting);

    // Body: visible in third person, shadow-only in first person.
    const third = this.rig.mode === 'third';
    this.avatar.setMode(this.digging ? 'hidden' : third ? 'visible' : 'shadowOnly');
    this.avatar.update(dt, this.player.renderFeet(this.tmp), this.rig.yaw, this.player.speed, this.player.grounded, this.player.crouchT);
    this.hands.visible = !third && !this.digging;
    this.hud.setDig(this.digging);
    this.hands.update(dt, this.player.speed, this.player.grounded, this.rig.yaw, this.rig.pitch);

    this.env.update(realDt, this.player.renderPos);
    audio.setListener(this.camera.position, this.rig.right);
    this.hud.setFlash(this.rig.flashLevel);
    this.powerHud.update();
    this.quality.update(realDt);
    this.hud.tickStats(realDt, () => {
      const info = this.renderer.info.render;
      return `${this.quality.preset.label} · res ${(this.quality.resScale * 100).toFixed(0)}%\n${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · ${this.entities.count} ents`;
    });
    this.input.endFrame();
  }

  private render() {
    this.lights.flush(this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
