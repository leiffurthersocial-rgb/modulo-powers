import * as THREE from 'three';
import { el } from './dom';

interface Num {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
  active: boolean;
}

/**
 * Floating damage numbers projected from world space, plus a combo counter.
 * DOM nodes are pooled.
 */
export class DamageNumbers {
  private pool: Num[] = [];
  private root: HTMLElement;
  private combo: HTMLElement;
  private comboCount = 0;
  private comboTimer = 0;
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.root = el('div', '', '', parent);
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    for (let i = 0; i < 24; i++) {
      const n = el('div', 'dmg-num', '', this.root);
      n.style.cssText = 'position:absolute;left:0;top:0;font-weight:800;text-shadow:0 2px 4px #000,0 0 2px #000;white-space:nowrap;will-change:transform;display:none';
      this.pool.push({ el: n, pos: new THREE.Vector3(), age: 0, life: 0.9, active: false });
    }
    this.combo = el('div', 'combo', '', parent);
  }

  spawn(pos: THREE.Vector3, amount: number, color = '#ffffff', crit = false, label?: string) {
    const n = this.pool.find((p) => !p.active) ?? this.pool[0];
    n.active = true;
    n.age = 0;
    n.life = crit ? 1.3 : 0.9;
    n.pos.copy(pos).add(this.v.set((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6));
    n.el.textContent = label ?? String(Math.round(amount));
    n.el.style.color = color;
    n.el.style.fontSize = `${crit ? 30 : 16 + Math.min(10, amount / 8)}px`;
    n.el.style.display = 'block';
  }

  /** Count a landed hit towards the combo. */
  hit() {
    this.comboCount++;
    this.comboTimer = 2.2;
    if (this.comboCount >= 2) {
      this.combo.innerHTML = `${this.comboCount}× <small>COMBO</small>`;
      this.combo.style.opacity = '1';
    }
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.combo.style.opacity = '0';
      }
    }
    for (const n of this.pool) {
      if (!n.active) continue;
      n.age += dt;
      if (n.age >= n.life) {
        n.active = false;
        n.el.style.display = 'none';
        continue;
      }
      n.pos.y += dt * 1.2;
      this.v.copy(n.pos).project(camera);
      if (this.v.z > 1) {
        n.el.style.display = 'none';
        continue;
      }
      n.el.style.display = 'block';
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const t = n.age / n.life;
      const s = t < 0.15 ? 0.6 + t * 4 : 1;
      n.el.style.opacity = String(1 - Math.max(0, t - 0.6) / 0.4);
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
    }
  }
}
