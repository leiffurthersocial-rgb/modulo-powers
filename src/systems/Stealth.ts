import * as THREE from 'three';
import { ALL_GROUPS, G, groups } from '../config/physics';
import type { Game, GameSystem } from '../core/Game';
import { el } from '../ui/dom';

export interface Decoy {
  pos: THREE.Vector3;
  /** Seconds left. */
  life: number;
}

/**
 * Player visibility model used by guards and the stealth meter.
 *
 * light   = sky light (day/night, storm) × sun-shadow occlusion
 *         + local light from fires / lightning / glowing hands
 * visibility = light × (invisibility, crouching, movement modifiers)
 *
 * Bright flashes (lightning, explosions) briefly "reveal" an invisible player.
 */
export class StealthSystem implements GameSystem {
  /** 0 (pitch dark) … 1+ (bright). */
  light = 1;
  /** 0 (unseeable) … 1 (fully visible). */
  visibility = 1;
  /** Set by the Invisibility ability. */
  private sources = new Set<string>();
  /** Extra visibility multiplier (Assassin mode, Zetsu...). */
  stealthMul = 1;

  /** Any invisibility source active (Shadow Invisibility, Zetsu, Rhythm Echo). */
  get invisible(): boolean {
    return this.sources.size > 0;
  }

  /** Back-compat: the Shadow power's toggle. */
  set invisible(v: boolean) {
    this.setInvisible('shadow', v);
  }

  setInvisible(key: string, on: boolean) {
    if (on) this.sources.add(key);
    else this.sources.delete(key);
  }
  /** Seconds of forced reveal remaining. */
  reveal = 0;
  /** Is the player standing in shade (sun occluded)? */
  inShade = false;
  readonly decoys: Decoy[] = [];
  /** Recent noises guards can hear: position + loudness (metres of range). */
  readonly noises: { pos: THREE.Vector3; range: number; age: number }[] = [];
  private timer = 0;
  private meter: HTMLElement;
  private fill: HTMLElement;
  private tmp = new THREE.Vector3();
  private sunDir = new THREE.Vector3();

  constructor(private game: Game) {
    this.meter = el('div', 'stealth-meter', '', game.hud.root);
    this.fill = el('div', '', '', this.meter);
  }

  /** Something made a noise (explosions, thunder, breaking things). */
  noise(pos: THREE.Vector3, range: number) {
    if (this.noises.length > 16) this.noises.shift();
    this.noises.push({ pos: pos.clone(), range, age: 0 });
  }

  addDecoy(pos: THREE.Vector3, life: number): Decoy {
    const d = { pos: pos.clone(), life };
    this.decoys.push(d);
    return d;
  }

  /** Is a point shaded from the sun (or anywhere, at night)? */
  shadedAt(p: THREE.Vector3): boolean {
    const g = this.game;
    if (g.env.nightFactor > 0.5) return true;
    g.env.sun.getWorldPosition(this.sunDir).sub(g.env.sun.target.getWorldPosition(this.tmp)).normalize();
    const hit = g.physics.raycast(this.tmp.copy(p).addScaledVector(this.sunDir, 0.3), this.sunDir, 80, {
      groups: groups(G.PLAYER, ALL_GROUPS & ~G.PLAYER & ~G.DEBRIS & ~G.SENSOR & ~G.NPC),
      exclude: g.player.collider,
    });
    return !!hit;
  }

  update(dt: number) {
    const g = this.game;
    if (dt > 0) {
      for (let i = this.decoys.length - 1; i >= 0; i--) {
        this.decoys[i].life -= dt;
        if (this.decoys[i].life <= 0) this.decoys.splice(i, 1);
      }
      for (let i = this.noises.length - 1; i >= 0; i--) {
        this.noises[i].age += dt;
        if (this.noises[i].age > 0.6) this.noises.splice(i, 1);
      }
      this.reveal = Math.max(0, this.reveal - dt);
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.15;
      const head = this.tmp.copy(g.player.curPos);
      head.y += 0.6;
      this.inShade = this.shadedAt(head);
      const sky = g.env.ambientLight;
      const sun = this.inShade ? (g.env.nightFactor > 0.5 ? 1 : 0.35) : 1;
      const local = g.lights.lightAt(head);
      this.light = Math.min(1.5, sky * sun + local);
    }
    let vis = this.light;
    if (g.player.crouching) vis *= 0.65;
    const speed = g.player.speed;
    if (this.invisible) {
      // Invisible: almost nothing unless lit up or moving fast.
      // Truly invisible: only a blinding light or bumping into someone gives you away.
      vis = vis * 0.03 + Math.max(0, this.light - 1.15) * 0.4 + Math.max(0, speed - 10) * 0.02;
    } else {
      vis *= 0.85 + Math.min(0.3, speed * 0.04);
    }
    vis *= this.stealthMul;
    if (this.reveal > 0) vis = Math.max(vis, 0.9);
    this.visibility = Math.min(1, Math.max(0, vis));
    // HUD meter: visible while the Shadow power is equipped or invisible.
    const show = this.invisible || ['shadow', 'nen', 'assassin'].includes(g.powers.current.id);
    this.meter.style.opacity = show ? '1' : '0';
    if (show) {
      this.fill.style.width = `${Math.round(this.visibility * 100)}%`;
      this.fill.style.background = this.visibility > 0.6 ? '#ff6b5a' : this.visibility > 0.3 ? '#ffc94a' : '#9b7bff';
    }
  }

  reset() {
    this.sources.clear();
    this.decoys.length = 0;
    this.noises.length = 0;
    this.reveal = 0;
  }
}
