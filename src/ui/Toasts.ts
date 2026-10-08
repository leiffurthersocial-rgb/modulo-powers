import { el } from './dom';

/** Short centred notifications ("Map reset", "Night", ...). */
export class Toasts {
  private root: HTMLElement;
  constructor(parent: HTMLElement) {
    this.root = el('div', 'toasts', '', parent);
  }

  show(text: string, color?: string, ms = 1600) {
    const t = el('div', 'toast', '', this.root);
    t.textContent = text;
    if (color) t.style.borderColor = color;
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 450);
    }, ms);
  }
}
