import { ZONE_LIST, type ZoneDef } from '../config/map';
import { el } from './dom';

/**
 * T opens this quick-travel list. While open it captures number keys
 * (1–6 = Hub + the five zones); T or Escape closes it.
 */
export class TeleportMenu {
  readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private onPick: (z: ZoneDef) => void,
  ) {
    this.root = el('div', 'overlay hidden');
    this.root.style.background = 'rgba(5,7,12,0.45)';
    const panel = el('div', 'panel interactive', '', this.root);
    el('h2', '', 'Teleport', panel);
    el('div', 'sub', 'Press a number, or <kbd>T</kbd> to close.', panel);
    const list = el('div', 'teleport-list', '', panel);
    for (const z of [...ZONE_LIST].sort((a, b) => a.key - b.key)) {
      const item = el('div', 'teleport-item', `<kbd>${z.key}</kbd><span class="swatch" style="background:${z.color}"></span>${z.name}`, list);
      item.onclick = () => this.pick(z);
    }
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  private pick(z: ZoneDef) {
    this.visible = false;
    this.onPick(z);
  }

  /** Modal key handler; returns true if the key was consumed. */
  handleKey(code: string): boolean {
    if (!this.visible) return false;
    const m = /^Digit([1-9])$/.exec(code);
    if (m) {
      const z = ZONE_LIST.find((zz) => zz.key === Number(m[1]));
      if (z) this.pick(z);
      return true;
    }
    if (code === 'KeyT' || code === 'Escape') {
      this.visible = false;
      return true;
    }
    return false;
  }
}
