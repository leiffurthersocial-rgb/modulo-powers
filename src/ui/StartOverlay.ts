import { el } from './dom';

/**
 * "Click / tap to start" screen. The click is the user gesture needed to
 * unlock WebAudio and request fullscreen / pointer lock.
 */
export class StartOverlay {
  readonly root: HTMLElement;
  private btn: HTMLButtonElement;
  private status: HTMLElement;

  constructor(parent: HTMLElement, onStart: () => void) {
    this.root = el('div', 'overlay');
    this.root.innerHTML = `
      <div class="start-card">
        <h1>MODULO<span>:</span> POWERS</h1>
        <div class="tag">A superpower sandbox</div>
        <div class="power-dots">
          <span style="background:#7fd4ff"></span><span style="background:#ff7a2f"></span>
          <span style="background:#3fa9f5"></span><span style="background:#c08a4a"></span>
          <span style="background:#9b7bff"></span>
        </div>
      </div>`;
    const card = this.root.firstElementChild as HTMLElement;
    this.btn = el('button', 'start-btn', 'Loading…', card);
    this.btn.disabled = true;
    this.status = el(
      'div',
      'start-hint',
      'WASD move · Arrow keys look · Space jump · 1–5 powers · Z X C B abilities<br>Press <kbd>H</kbd> any time for the full controls',
      card,
    );
    const go = (e: Event) => {
      e.preventDefault();
      if (this.btn.disabled) return;
      onStart();
    };
    this.root.addEventListener('click', go);
    this.root.addEventListener('touchend', go, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('hidden') || this.btn.disabled) return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      }
    });
    parent.appendChild(this.root);
  }

  ready() {
    this.btn.disabled = false;
    this.btn.textContent = 'Click / Tap to Start';
  }

  error(msg: string) {
    this.btn.textContent = 'Failed to start';
    this.status.textContent = msg;
  }

  hide() {
    this.root.classList.add('hidden');
  }
}
