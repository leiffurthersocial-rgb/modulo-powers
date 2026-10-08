import { keyLabel, type Action } from '../config/keybindings';
import type { Energy } from '../powers/Energy';
import type { PowerManager } from '../powers/PowerManager';
import { el } from './dom';
import { svgIcon } from './icons';

const SLOT_ACTIONS: Action[] = ['ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'ability6'];
const POWER_ACTIONS: Action[] = ['power1', 'power2', 'power3', 'power4', 'power5', 'power6', 'power7'];

interface Slot {
  root: HTMLElement;
  name: HTMLElement;
  icon: HTMLElement;
  cd: HTMLElement;
  charge: HTMLElement;
  last: string;
}

/**
 * Bottom-centre power panel: power selector, energy bar and the 4 ability
 * slots with key labels, cooldown sweep, charge bar and energy state.
 * DOM is only touched when a value actually changes.
 */
export class PowerHud {
  readonly root: HTMLElement;
  private chips: HTMLElement[] = [];
  private title: HTMLElement;
  private energyFill: HTMLElement;
  private energyText: HTMLElement;
  private slots: Slot[] = [];
  private chargeRing: HTMLElement;
  private renderedPower = -1;
  private lastEnergy = '';

  constructor(
    parent: HTMLElement,
    private pm: PowerManager,
    private energy: Energy,
  ) {
    this.root = el('div', 'power-hud', '', parent);
    const chipRow = el('div', 'power-chips', '', this.root);
    pm.powers.forEach((p, i) => {
      const c = el('div', 'power-chip', `${svgIcon(p.icon, p.color, 18)}<span>${keyLabel(POWER_ACTIONS[i]) || i + 1}</span>`, chipRow);
      c.style.setProperty('--c', p.color);
      c.title = p.name;
      this.chips.push(c);
    });
    this.title = el('div', 'power-title', '', this.root);
    const bar = el('div', 'energy-bar', '', this.root);
    this.energyFill = el('div', 'energy-fill', '', bar);
    this.energyText = el('div', 'energy-text', '', bar);
    const slotRow = el('div', 'ability-slots', '', this.root);
    for (let i = 0; i < SLOT_ACTIONS.length; i++) {
      const root = el('div', 'ability-slot', '', slotRow);
      const icon = el('div', 'ability-icon', '', root);
      const cd = el('div', 'ability-cd', '', root);
      const charge = el('div', 'ability-charge', '', root);
      el('kbd', 'ability-key', keyLabel(SLOT_ACTIONS[i]).split(' / ')[0], root);
      const name = el('div', 'ability-name', '', root);
      this.slots.push({ root, name, icon, cd, charge, last: '' });
    }
    this.chargeRing = el('div', 'charge-ring', '', parent);
  }

  update() {
    const pm = this.pm;
    const p = pm.current;
    if (this.renderedPower !== pm.index) {
      this.renderedPower = pm.index;
      this.chips.forEach((c, i) => c.classList.toggle('selected', i === pm.index));
      this.title.innerHTML = `${svgIcon(p.icon, p.color, 20)}<span>${p.name}</span>`;
      this.title.style.color = p.color;
      this.root.style.setProperty('--accent-power', p.color);
      p.abilities.forEach((a, i) => {
        const s = this.slots[i];
        s.icon.innerHTML = svgIcon(a.icon, p.color, 26);
        s.name.textContent = a.name;
        s.root.title = a.description;
        s.last = '';
      });
    }
    const e = this.energy;
    const eKey = e.infinite ? 'inf' : e.value.toFixed(0);
    if (eKey !== this.lastEnergy) {
      this.lastEnergy = eKey;
      this.energyFill.style.width = `${e.infinite ? 100 : e.fraction * 100}%`;
      this.energyFill.classList.toggle('infinite', e.infinite);
      this.energyText.textContent = e.infinite ? '∞' : eKey;
    }
    let charging = -1;
    p.abilities.forEach((a, i) => {
      const s = this.slots[i];
      const cdf = a.cooldownFraction;
      const state = `${cdf.toFixed(2)}|${a.active}|${a.affordable}|${p.lastAbility === i}|${a.charge.toFixed(2)}|${a.meter?.toFixed(2)}`;
      if (state === s.last) return;
      s.last = state;
      s.cd.style.background = cdf > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${cdf * 360}deg, transparent 0)` : 'none';
      s.root.classList.toggle('active', a.active);
      s.root.classList.toggle('poor', !a.affordable && !a.active);
      s.root.classList.toggle('last', p.lastAbility === i);
      s.charge.style.width = a.mode === 'charge' && a.active ? `${a.charge * 100}%` : a.meter !== undefined ? `${a.meter * 100}%` : '0';
    });
    p.abilities.forEach((a, i) => {
      if (a.mode === 'charge' && a.active) charging = i;
    });
    if (charging >= 0) {
      const c = p.abilities[charging].charge;
      this.chargeRing.style.opacity = '1';
      this.chargeRing.style.background = `conic-gradient(${p.color} ${c * 360}deg, rgba(255,255,255,0.12) 0)`;
    } else {
      this.chargeRing.style.opacity = '0';
    }
  }
}
