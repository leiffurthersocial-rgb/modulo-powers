# Modulo: Powers

A browser-based 3D superpower sandbox. Walk around a large test map and try out
Lightning, Fire, Water, Earth and Shadow powers, each with 4 abilities. Everything
in the world is physically simulated and reacts to the elements.

Built with **TypeScript + Vite + Three.js + Rapier**. No backend and no external
assets: terrain, textures and sounds are all procedurally generated.

## Run it

```bash
npm install
npm run dev       # local dev server (http://localhost:5173)
npm run build     # type-check + static build into dist/
npm run preview   # serve the production build
```

The build output (`dist/`) is a static site. Vercel deploys it with zero
configuration (framework preset: Vite).

## Controls (keyboard-first, works on iPad with a hardware keyboard)

| Key | Action |
| --- | --- |
| W A S D | Move |
| Space | Jump |
| Shift | Sprint |
| Ctrl | Crouch |
| Arrow keys | Look (mouse / trackpad / touch-drag also work) |
| F | Interact |
| V | First / third person |
| 1–5 | Lightning, Fire, Water, Earth, Shadow |
| Q / E | Previous / next power |
| Z X C B | Abilities 1–4 (left mouse = Z, right mouse = X) |
| P | Pause / resume (shows the controls) |
| R / Shift+R | Reset map / full reset |
| T | Teleport menu |
| N | Day / night |
| H | Help overlay |
| M | Mute |
| G | Infinite energy |
| K | Slow motion |
| L | Cycle quality (Low / Medium / High) |
| Backspace | Respawn at checkpoint |

All bindings live in [`src/config/keybindings.ts`](src/config/keybindings.ts).

Notes:

- Mouse look uses pointer lock when it's available (click the game to capture the
  mouse). Without pointer lock you can drag to look, or just use the arrow keys.
- On desktop Chrome, the game asks for fullscreen and the Keyboard Lock API so
  that shortcuts like Ctrl+W can't close the tab while you crouch and walk. If
  that isn't available, the browser asks for confirmation before leaving.

## Project layout

```
src/
  core/     game loop (fixed-step physics + interpolated rendering), input, audio, physics, quality
  player/   character controller, camera rig, first-person hands, avatar
  powers/   Power / Ability base classes and one folder per power
  world/    terrain, sky & day/night, vegetation, water, zones, props, reset system
  systems/  element reactions, fire & electricity propagation, particles, decals, NPC AI, stealth
  ui/       HUD, pause menu, help, teleport menu, toasts
  config/   key bindings, balance numbers, quality presets, map layout
```
