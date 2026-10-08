import * as THREE from 'three';
import { ZONES } from '../../config/map';
import { audio } from '../../core/Audio';
import type { Game, GameSystem } from '../../core/Game';
import { RAPIER } from '../../core/Physics';
import type { FighterKind, FighterSystem } from '../../npc/Fighters';
import { FX } from '../../systems/Particles';
import { el } from '../../ui/dom';
import { buildProp } from '../props/basic';
import { cylGeo, mesh, plainMaterial, texturedMaterial } from '../props/assets';
import { signBoard, textTexture, type StaticBuilder } from './build';
import { ringWall } from './fire';

const A = ZONES.arena;
const FLOOR_R = 22;

/** Static colosseum: sand floor, a ring wall with two gates, tiered stands. */
export function buildArenaStatic(game: Game, sb: StaticBuilder) {
  const y = game.world.heightAt(A.x, A.z);
  const c = new THREE.Vector3(A.x, y, A.z);
  const sand = sb.material('concrete', { color: 0xc8b088, repeat: 1 });
  const stone = sb.material('stone', { color: 0xa89a88 });
  const brick = sb.material('bricks', { color: 0xa07060 });
  sb.cylinder(c.clone().setY(y - 0.1), FLOOR_R + 1, 1.0, sand, { segments: 40 });
  // Gates face the hub (east) and the opposite side.
  const sides = 24;
  const toHub = Math.atan2(ZONES.hub.x - A.x, ZONES.hub.z - A.z);
  const gate = Math.round(((toHub + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / sides)) % sides;
  const back = (gate + sides / 2) % sides;
  for (let i = 0; i < sides; i++) {
    if (i === gate || i === back) continue;
    const a = (i / sides) * Math.PI * 2;
    const seg = 2 * (FLOOR_R + 0.5) * Math.tan(Math.PI / sides) + 0.4;
    for (const [r, h, mat] of [
      [FLOOR_R + 0.5, 3.4, brick],
      [FLOOR_R + 2.2, 4.6, stone],
      [FLOOR_R + 3.9, 5.8, stone],
      [FLOOR_R + 5.6, 7.0, stone],
    ] as const) {
      const p = c.clone().add(new THREE.Vector3(Math.sin(a) * (r + 0.5), 0, Math.cos(a) * (r + 0.5)));
      sb.box(p.setY(y - 1 + (h + 1) / 2), [seg * ((r + 0.5) / (FLOOR_R + 1)), h + 1, 1.7], mat, { ry: a, phase: r === FLOOR_R + 0.5 });
    }
  }
  void ringWall;
  const tex = textTexture(['Interact (F) with the rune stone in the centre', 'to start 5 waves. Wave 5 is a boss.', 'Your health bar matters here — J for sandbox.'], {
    title: 'FIGHT ARENA',
    accent: '#ff4a3a',
    w: 1024,
    h: 320,
    font: 40,
  });
  const out = c.clone().add(new THREE.Vector3(Math.sin(toHub) * (FLOOR_R + 9), 0, Math.cos(toHub) * (FLOOR_R + 9)));
  out.y = game.world.heightAt(out.x, out.z);
  signBoard(game, sb, out.clone().add(new THREE.Vector3(Math.cos(toHub) * 4, 0, -Math.sin(toHub) * 4)), toHub, tex, [4, 1.3]);
  game.checkpoints.add(out, 'Fight Arena', 0xff4a3a);
}

export function spawnArena(game: Game) {
  const y = game.world.heightAt(A.x, A.z);
  game.entities.spawn({ type: 'arenaStart', x: A.x, y, z: A.z });
  // Torches around the rim.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = A.x + Math.sin(a) * (FLOOR_R - 1);
    const z = A.z + Math.cos(a) * (FLOOR_R - 1);
    game.entities.spawn({ type: 'brazier', x, y: game.world.heightAt(x, z), z });
  }
  game.entities.spawn({ type: 'dummy', x: A.x + 6, y, z: A.z + 4 });
}

type Wave = FighterKind[];

const WAVES: Wave[] = [
  ['brute', 'brute', 'brute'],
  ['brute', 'brute', 'caster', 'caster'],
  ['brute', 'brute', 'brute', 'caster', 'caster', 'caster'],
  ['brute', 'brute', 'brute', 'brute', 'caster', 'caster', 'caster', 'caster'],
  ['boss', 'caster', 'caster'],
];

/**
 * Arena waves: interact with the rune stone to start; clear 5 waves (the last
 * one has a boss). Dying ends the run.
 */
export class ArenaSystem implements GameSystem {
  private state: 'idle' | 'fighting' | 'between' | 'cleared' = 'idle';
  private wave = 0;
  private alive = 0;
  private timer = 0;
  private banner: HTMLElement;
  private bannerText: HTMLElement;
  private bannerFill: HTMLElement;
  private boss: { hp: number; max: number } | null = null;

  constructor(
    private game: Game,
    private fighters: FighterSystem,
  ) {
    this.banner = el('div', 'boss-bar', '', game.hud.root);
    this.bannerText = el('div', '', '', this.banner);
    const track = el('div', 'track', '', this.banner);
    this.bannerFill = el('div', 'fill', '', track);
    game.entities.registerFactory('arenaStart', (s, em) => {
      const g = new THREE.Group();
      const stone = mesh(cylGeo(0.6, 0.8, 1.6, 8), texturedMaterial('stone', { color: 0x605860, key: 'rune' }));
      stone.position.y = 0.8;
      const rune = mesh(cylGeo(0.62, 0.62, 0.15, 8), plainMaterial('runeGlow', { color: 0x220000, emissive: 0xff2a3a, emissiveIntensity: 2 }), false);
      rune.position.y = 1.2;
      rune.userData.noVisualState = true;
      g.add(stone, rune);
      const e = buildProp(em, s, 'arenaStart', {
        material: 'stone',
        object: g,
        fixed: true,
        colliders: [RAPIER.ColliderDesc.cylinder(0.8, 0.7).setTranslation(0, 0.8, 0)],
        radius: 0.9,
        volume: 2,
      });
      e.interactLabel = 'Start the arena (5 waves)';
      e.interact = () => this.start();
      e.update = () => {
        rune.visible = this.state === 'idle' || this.state === 'cleared';
        e.interactLabel = this.state === 'fighting' || this.state === 'between' ? `Wave ${this.wave + 1} in progress` : 'Start the arena (5 waves)';
      };
      return e;
    });
  }

  start() {
    if (this.state === 'fighting' || this.state === 'between') return;
    this.wave = 0;
    this.state = 'between';
    this.timer = 2.5;
    this.game.toasts.show('THE ARENA AWAKENS', '#ff4a3a', 2000);
    audio.tone({ volume: 0.4, freq: 110, freqEnd: 220, decay: 1.2, type: 'sawtooth' });
    audio.rumble(undefined, 0.8, 1.5);
  }

  private spawnWave() {
    const kinds = WAVES[this.wave];
    this.alive = kinds.length;
    this.boss = null;
    const p = this.game.player.curPos;
    const away = Math.atan2(p.x - A.x, p.z - A.z) + Math.PI;
    kinds.forEach((k, i) => {
      const a = away + (i - (kinds.length - 1) / 2) * 0.55;
      const r = k === 'boss' ? 12 : 16;
      const f = this.fighters.spawn(k, A.x + Math.sin(a) * r, A.z + Math.cos(a) * r);
      if (k === 'boss') this.boss = { hp: f.hp, max: f.def.hp };
      f.onDeath = () => {
        this.alive--;
        if (k === 'boss') this.boss = null;
      };
      if (k === 'boss') {
        const bf = f;
        const watch = () => {
          if (this.boss && !bf.dead) {
            this.boss.hp = bf.hp;
            requestAnimationFrame(watch);
          }
        };
        watch();
      }
    });
    this.state = 'fighting';
    this.game.toasts.show(this.wave === WAVES.length - 1 ? 'FINAL WAVE — THE CHAMPION' : `WAVE ${this.wave + 1}`, '#ff4a3a', 1600);
    audio.tone({ volume: 0.35, freq: 220, freqEnd: 330, decay: 0.4, type: 'square' });
  }

  playerDied() {
    if (this.state !== 'fighting' && this.state !== 'between') return;
    this.fighters.clearAll();
    this.state = 'idle';
    this.game.toasts.show(`Defeated on wave ${this.wave + 1}. Try again!`, '#ff4a3a', 2500);
  }

  update(dt: number) {
    const g = this.game;
    if (this.state === 'between') {
      this.timer -= dt;
      if (this.timer <= 0) this.spawnWave();
    } else if (this.state === 'fighting' && this.alive <= 0) {
      this.wave++;
      if (this.wave >= WAVES.length) {
        this.state = 'cleared';
        g.toasts.show('ARENA CLEARED — CHAMPION!', '#ffd23f', 3500);
        const y = g.world.heightAt(A.x, A.z);
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            const p = new THREE.Vector3(A.x + (Math.random() - 0.5) * 20, y + 12 + Math.random() * 6, A.z + (Math.random() - 0.5) * 20);
            g.particles.emit(FX.spark, p, 80, { spread: Math.PI, speed: [4, 10] });
            g.particles.emit(FX.ember, p, 40, { spread: Math.PI, speed: [2, 6] });
            g.lights.add(p, 0xffd23f, 40, 30);
            audio.explosion(p, 0.4);
          }, i * 350);
        }
        g.entities.spawn({ type: 'treasure', x: A.x + 3, y, z: A.z, data: { color: 0xff4a3a, message: 'Champion\'s treasure!' } });
      } else {
        this.state = 'between';
        this.timer = 3;
        g.toasts.show(`Wave ${this.wave} cleared! Next in 3…`, '#ffd23f', 1500);
        g.health.heal(25);
      }
    }
    // Banner.
    const show = this.state === 'fighting' || this.state === 'between';
    this.banner.style.display = show ? 'block' : 'none';
    if (show) {
      if (this.boss) {
        this.bannerText.textContent = 'The Champion';
        this.bannerFill.style.width = `${Math.max(0, (this.boss.hp / this.boss.max) * 100)}%`;
      } else {
        this.bannerText.textContent = this.state === 'between' ? `Wave ${this.wave + 1} / ${WAVES.length} incoming…` : `Wave ${this.wave + 1} / ${WAVES.length} — ${this.alive} left`;
        this.bannerFill.style.width = `${(this.wave / WAVES.length) * 100}%`;
      }
    }
  }

  reset() {
    this.state = 'idle';
    this.alive = 0;
    this.boss = null;
    this.fighters.clearAll();
  }
}
