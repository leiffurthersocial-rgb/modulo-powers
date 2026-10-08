/**
 * All key bindings live here so they are easy to rebind.
 *
 * Each binding is a `KeyboardEvent.code` string (layout-independent), optionally
 * prefixed with `Shift+`. Mouse buttons are written as `Mouse0` (left),
 * `Mouse1` (middle) and `Mouse2` (right).
 *
 * The bindings avoid Cmd, function keys and the numpad, since iPad hardware
 * keyboards often don't have them (and Cmd shortcuts can't be overridden in Safari).
 *
 * When a key event matches a binding that has a modifier (e.g. `Shift+KeyR`), it
 * takes priority over the same key without a modifier (`KeyR`).
 */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'lookLeft'
  | 'lookRight'
  | 'lookUp'
  | 'lookDown'
  | 'interact'
  | 'toggleView'
  | 'power1'
  | 'power2'
  | 'power3'
  | 'power4'
  | 'power5'
  | 'power6'
  | 'power7'
  | 'prevPower'
  | 'nextPower'
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'ability4'
  | 'ability5'
  | 'ability6'
  | 'pause'
  | 'reset'
  | 'fullReset'
  | 'teleport'
  | 'dayNight'
  | 'help'
  | 'mute'
  | 'infiniteEnergy'
  | 'slowMo'
  | 'quality'
  | 'respawn';

export const KEYBINDINGS: Record<Action, string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  interact: ['KeyF'],
  toggleView: ['KeyO'],
  power1: ['Digit1'],
  power2: ['Digit2'],
  power3: ['Digit3'],
  power4: ['Digit4'],
  power5: ['Digit5'],
  power6: ['Digit6'],
  power7: ['Digit7'],
  prevPower: ['KeyQ'],
  nextPower: ['KeyE'],
  ability1: ['KeyZ', 'Mouse0'],
  ability2: ['KeyX', 'Mouse2'],
  ability3: ['KeyC'],
  ability4: ['KeyB'],
  ability5: ['KeyV', 'Mouse1'],
  ability6: ['KeyG'],
  pause: ['KeyP'],
  reset: ['KeyR'],
  fullReset: ['Shift+KeyR'],
  teleport: ['KeyT'],
  dayNight: ['KeyN'],
  help: ['KeyH'],
  mute: ['KeyM'],
  infiniteEnergy: ['KeyJ'],
  slowMo: ['KeyK'],
  quality: ['KeyL'],
  respawn: ['Backspace'],
};

/** Human-readable descriptions, used by the help overlay and pause menu. */
export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  sprint: 'Sprint',
  crouch: 'Crouch',
  lookLeft: 'Look left',
  lookRight: 'Look right',
  lookUp: 'Look up',
  lookDown: 'Look down',
  interact: 'Interact',
  toggleView: 'First / third person',
  power1: 'Lightning',
  power2: 'Fire',
  power3: 'Water',
  power4: 'Earth',
  power5: 'Shadow',
  power6: 'Nen',
  power7: 'Assassin',
  prevPower: 'Previous power',
  nextPower: 'Next power',
  ability1: 'Ability 1',
  ability2: 'Ability 2',
  ability3: 'Ability 3',
  ability4: 'Ability 4',
  ability5: 'Ability 5',
  ability6: 'Ability 6',
  pause: 'Pause / resume',
  reset: 'Reset map',
  fullReset: 'Full reset (map + player)',
  teleport: 'Teleport menu',
  dayNight: 'Day / night',
  help: 'Help overlay',
  mute: 'Mute / unmute',
  infiniteEnergy: 'Sandbox mode (no damage, ∞ energy)',
  slowMo: 'Slow motion',
  quality: 'Cycle quality',
  respawn: 'Respawn at checkpoint',
};

/** Groups for the help overlay. */
export const ACTION_GROUPS: { title: string; actions: Action[] }[] = [
  {
    title: 'Movement',
    actions: ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch', 'interact', 'toggleView'],
  },
  { title: 'Look', actions: ['lookLeft', 'lookRight', 'lookUp', 'lookDown'] },
  {
    title: 'Powers',
    actions: [
      'power1',
      'power2',
      'power3',
      'power4',
      'power5',
      'power6',
      'power7',
      'prevPower',
      'nextPower',
      'ability1',
      'ability2',
      'ability3',
      'ability4',
      'ability5',
      'ability6',
    ],
  },
  {
    title: 'Game',
    actions: [
      'pause',
      'reset',
      'fullReset',
      'teleport',
      'dayNight',
      'help',
      'mute',
      'infiniteEnergy',
      'slowMo',
      'quality',
      'respawn',
    ],
  },
];

const PRETTY: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Backspace: 'Backspace',
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
};

/** Turn a binding code into a short label, e.g. `KeyZ` → `Z`, `Shift+KeyR` → `Shift+R`. */
export function prettyKey(code: string): string {
  return code
    .split('+')
    .map((part) => PRETTY[part] ?? part.replace(/^Key/, '').replace(/^Digit/, ''))
    .join('+');
}

/** All distinct labels for an action, e.g. `Z / LMB`. */
export function keyLabel(action: Action): string {
  const seen = new Set<string>();
  for (const code of KEYBINDINGS[action]) seen.add(prettyKey(code));
  return [...seen].join(' / ');
}
