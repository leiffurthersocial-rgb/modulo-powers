import { keyLabel, type Action } from '../config/keybindings';
import type { Power } from '../powers/Power';
import { controlsGrid } from './controlsList';
import { el } from './dom';
import { svgIcon } from './icons';

const SLOT_ACTIONS: Action[] = ['ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'ability6'];

/** H toggles this: full controls plus every power's abilities. Doesn't pause. */
export class HelpOverlay {
  readonly root: HTMLElement;

  constructor(parent: HTMLElement, powers: Power[]) {
    this.root = el('div', 'overlay hidden');
    this.root.style.background = 'rgba(5,7,12,0.55)';
    this.root.style.pointerEvents = 'none';
    const panel = el('div', 'panel interactive', '', this.root);
    el('h2', '', 'Controls', panel);
    el('div', 'sub', 'Press <kbd>H</kbd> to close. The game keeps running.', panel);
    panel.appendChild(controlsGrid());
    const pw = el('div', 'help-powers', '', panel);
    powers.forEach((p, i) => {
      const col = el('div', '', `<h3 style="color:${p.color}">${svgIcon(p.icon, p.color, 18)} ${i + 1}. ${p.name}</h3>`, pw);
      p.abilities.forEach((a, j) => {
        el('div', 'row', `<kbd>${keyLabel(SLOT_ACTIONS[j]).split(' / ')[0]}</kbd> <b>${a.name}</b> — ${a.description}`, col);
      });
    });
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  toggle() {
    this.visible = !this.visible;
  }
}
