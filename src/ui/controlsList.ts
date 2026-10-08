import { ACTION_GROUPS, ACTION_LABELS, keyLabel } from '../config/keybindings';
import { el } from './dom';

/** Builds the grouped controls grid used by the pause menu and help overlay. */
export function controlsGrid(extraLook = true): HTMLElement {
  const grid = el('div', 'controls-grid');
  for (const group of ACTION_GROUPS) {
    const col = el('div', '', `<h3>${group.title}</h3>`, grid);
    for (const a of group.actions) {
      el('div', 'row', `<span>${ACTION_LABELS[a]}</span><kbd>${keyLabel(a)}</kbd>`, col);
    }
    if (group.title === 'Look' && extraLook) {
      el('div', 'row', '<span>Mouse / trackpad</span><kbd>click to capture</kbd>', col);
      el('div', 'row', '<span>Touch</span><kbd>drag screen</kbd>', col);
    }
  }
  return grid;
}
