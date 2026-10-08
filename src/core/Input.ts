import { KEYBINDINGS, type Action } from '../config/keybindings';

interface Binding {
  action: Action;
  shift: boolean;
}

/** Keys we always swallow so Safari / Chrome don't scroll or navigate. */
const ALWAYS_PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace']);

/**
 * Keyboard-first input manager.
 *
 * - Keys are mapped to actions via `config/keybindings.ts`.
 * - `isDown` is the held state; `wasPressed` / `wasReleased` are edge events
 *   that stay true until `endFrame()` (called once per rendered frame).
 * - Look input from mouse (pointer lock or drag), trackpad and touch-drag is
 *   accumulated in pixels and consumed by the camera rig.
 * - A `modal` handler (e.g. the teleport menu) gets first pick of key presses.
 */
export class Input {
  private bindings = new Map<string, Binding[]>();
  /** For each held action, which physical sources hold it. */
  private sources = new Map<Action, Set<string>>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();

  lookDX = 0;
  lookDY = 0;
  /** Accumulated touch-drag deltas (px), separate so they can use a different sensitivity. */
  touchDX = 0;
  touchDY = 0;

  pointerLocked = false;
  private lockTime = 0;
  private lockFailed = false;
  private dragPointer = -1;
  private dragX = 0;
  private dragY = 0;
  private touchId = -1;
  private touchX = 0;
  private touchY = 0;

  /** False until the start overlay is dismissed. */
  enabled = false;
  /** Gets first look at key presses; return true to consume the key. */
  modal: ((code: string) => boolean) | null = null;
  /** Fired on any action press (after modal handling), for global toggles. */
  onAction: ((action: Action) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    for (const [action, codes] of Object.entries(KEYBINDINGS) as [Action, string[]][]) {
      for (const code of codes) {
        const parts = code.split('+');
        const key = parts[parts.length - 1];
        const shift = parts.includes('Shift');
        if (!this.bindings.has(key)) this.bindings.set(key, []);
        this.bindings.get(key)!.push({ action, shift });
      }
    }
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: false });
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.lockTime = performance.now();
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
      this.pointerLocked = false;
    });
  }

  isDown(a: Action): boolean {
    const s = this.sources.get(a);
    return !!s && s.size > 0;
  }
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  wasReleased(a: Action): boolean {
    return this.released.has(a);
  }
  /** -1..1 axis from two actions. */
  axis(neg: Action, pos: Action): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  /** Clear edge events; call once at the end of each rendered frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  consumeLook(): { mx: number; my: number; tx: number; ty: number } {
    const r = { mx: this.lookDX, my: this.lookDY, tx: this.touchDX, ty: this.touchDY };
    this.lookDX = this.lookDY = this.touchDX = this.touchDY = 0;
    return r;
  }

  releaseAll = () => {
    for (const [a, s] of this.sources) {
      if (s.size > 0) this.released.add(a);
      s.clear();
    }
    this.dragPointer = -1;
    this.touchId = -1;
  };

  private hold(a: Action, source: string) {
    let s = this.sources.get(a);
    if (!s) this.sources.set(a, (s = new Set()));
    const was = s.size > 0;
    s.add(source);
    if (!was) {
      this.pressed.add(a);
      this.onAction?.(a);
    }
  }

  private unhold(source: string) {
    for (const [a, s] of this.sources) {
      if (s.delete(source) && s.size === 0) this.released.add(a);
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey) return; // never fight Cmd shortcuts
    const list = this.bindings.get(e.code);
    if (list || ALWAYS_PREVENT.has(e.code)) e.preventDefault();
    if (!this.enabled || e.repeat) return;
    if (this.modal && this.modal(e.code)) return;
    if (!list) return;
    const withShift = list.filter((b) => b.shift);
    const chosen = e.shiftKey && withShift.length > 0 ? withShift : list.filter((b) => !b.shift);
    for (const b of chosen) this.hold(b.action, e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.bindings.has(e.code) || ALWAYS_PREVENT.has(e.code)) e.preventDefault();
    this.unhold(e.code);
  };

  /** Ask for pointer lock where supported. Returns false if unavailable. */
  requestPointerLock(): boolean {
    if (this.lockFailed || !this.canvas.requestPointerLock) return false;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') {
        r.catch(() => {
          this.lockFailed = true;
        });
      }
      return true;
    } catch {
      this.lockFailed = true;
      return false;
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled || e.pointerType === 'touch') return;
    e.preventDefault();
    if (e.pointerType === 'mouse' && !this.pointerLocked && !this.lockFailed && this.allowPointerLock) {
      // The first click only captures the mouse; it doesn't fire an ability.
      if (this.requestPointerLock()) return;
    }
    if (!this.pointerLocked) {
      this.dragPointer = e.pointerId;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
    }
    if (this.modal) return;
    const code = `Mouse${e.button}`;
    const list = this.bindings.get(code);
    if (list) for (const b of list) this.hold(b.action, code);
  };

  /** Disabled while menus are open so clicks don't grab the mouse. */
  allowPointerLock = true;

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerId === this.dragPointer) this.dragPointer = -1;
    this.unhold(`Mouse${e.button}`);
    if (e.buttons === 0) {
      this.unhold('Mouse0');
      this.unhold('Mouse1');
      this.unhold('Mouse2');
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.enabled || e.pointerType === 'touch') return;
    if (this.pointerLocked) {
      // Browsers can emit a huge bogus delta right after the lock engages.
      if (performance.now() - this.lockTime < 120) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    } else if (e.pointerId === this.dragPointer) {
      this.lookDX += e.clientX - this.dragX;
      this.lookDY += e.clientY - this.dragY;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
    }
  };

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    if (this.touchId === -1 && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      this.touchId = t.identifier;
      this.touchX = t.clientX;
      this.touchY = t.clientY;
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== this.touchId) continue;
      this.touchDX += t.clientX - this.touchX;
      this.touchDY += t.clientY - this.touchY;
      this.touchX = t.clientX;
      this.touchY = t.clientY;
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.touchId) this.touchId = -1;
    }
  };
}
