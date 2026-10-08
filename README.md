# Modulo: Powers

A browser-based 3D superpower sandbox. Walk around a large test map and try out
**Lightning, Fire, Water, Earth and Shadow**, each with 4 abilities. Every prop
is a physical rigid body, and the world reacts to the elements: wood burns and
collapses, water puts out fire and conducts electricity, ice melts, metal glows,
and stone shatters.

It's built with **TypeScript + Vite + Three.js + Rapier**. There's no backend and
no external assets: terrain, textures, sky and every sound are generated
procedurally at load time.

## Run it

```bash
npm install
npm run dev       # dev server on http://localhost:5173 (also on your LAN, for iPad testing)
npm run build     # type-check + static build into dist/
npm run preview   # serve the production build
```

`dist/` is a static site. Vercel deploys it with zero configuration (Vite preset).

## Controls (keyboard-first; works on iPad with a hardware keyboard)

| Key | Action |
| --- | --- |
| W A S D | Move |
| Space | Jump (swim up in water) |
| Shift | Sprint |
| Ctrl | Crouch (dive in water) |
| Arrow keys | Look (smooth acceleration). Mouse, trackpad and touch-drag also work |
| F | Interact (levers, generators, gates, treasures…) |
| V | First / third person |
| 1 – 5 | Lightning · Fire · Water · Earth · Shadow |
| Q / E | Previous / next power |
| Z X C B | Abilities 1–4 (left mouse = Z, right mouse = X) |
| P | Pause / resume (shows controls and settings) |
| R | Reset the map (props, fires, ice, puzzles; you stay put) |
| Shift+R | Full reset (map + back to spawn, energy refilled) |
| T, then 1–6 | Teleport: Hub, Lightning, Fire, Water, Earth, Shadow |
| N | Day / night |
| H | Help overlay (all controls and every ability) |
| M | Mute |
| G | Infinite energy (sandbox) |
| K | Slow motion (0.25×) |
| L | Cycle quality: Low / Medium / High |
| Backspace | Respawn at the last checkpoint |

All bindings live in [`src/config/keybindings.ts`](src/config/keybindings.ts). The
default bindings avoid Cmd, function keys and the numpad.

### Powers

| | Z | X | C | B |
| --- | --- | --- | --- | --- |
| **1 Lightning** | Bolt Strike (hold to charge) | Chain Lightning | Lightning Step (dash, works mid-air) | Storm Call |
| **2 Fire** | Fireball (hold to charge) | Flamethrower (fuel tank) | Flame Wall (crouch: ring) | Fire Thrust (rocket jump / hover) |
| **3 Water** | Water Jet | Tidal Wave (you surf it) | Freeze (water → walkable ice) | Hydro Shield (walk on water) |
| **4 Earth** | Raise Pillar (charge = launcher) | Boulder Pull & Throw | Earthquake (ground pound in air) | Stone Armor · crouch+B: Dig |
| **5 Shadow** | Invisibility | Shadow Blink (hold to aim) | Phase through walls | Shadow Clone · crouch+B: tendrils |

Abilities share one energy bar, and each has its own cost and cooldown. The HUD
shows cooldown sweeps, charge, the flamethrower's fuel, and which ability you
used last.

### Element reactions

The reactions are data-driven. See [`src/config/reactions.ts`](src/config/reactions.ts):

- Fire + wood / hay / cloth / dry grass → burning, spreading, charring, collapse
- Water + fire → extinguish and steam · Water + hot metal → steam
- Water + lightning → the whole water body is electrified, and everything in it is shocked
- Lightning + metal → charged and arcing to neighbours · Lightning + wood → ignites
- Fire + ice → melts · Freeze + water → ice · Earth/impacts + ice → shatter
- Earth + water → mud (slows you, slippery) · rocks in the river dam the current
- Light (fire, lightning, day, lamps, guards' torches) reveals invisible players

## The map

A valley ringed by mountains. The **Hub** (spawn) has signposts, a hint board,
training dummies and props. From there:

- **Lightning:** lattice towers with rods. Strike the generator to open the power station and light the lamps. Charge both rods at once (Storm Call) to open the bunker. There's also a metal bridge over a pond you can electrify, and a gap to cross with Lightning Step.
- **Fire:** a wooden village that burns and collapses, a dry grass field with hay bales, a hut sealed by an ice wall, a ruined tower, and a pit you can only leave with Fire Thrust.
- **Water:** a swimmable lake with buoyancy, a dock, floating crates, an island (reach it with ice bridges or by water-walking), three braziers to douse to open a shrine, and a river with a current and a waterwheel.
- **Earth:** a canyon you cross by raising pillars from its floor, destructible brick walls, unstable stacks, boulders, a mud pit, and two 400 kg pressure plates (use boulders, or stand on one in Stone Armor).
- **Shadow:** a walled compound with 5 patrolling guards. Each guard has a vision cone, hearing, and a suspicion state (patrol → suspicious → alert → searching). The barracks and vault have no doors (Phase in), there's a rooftop prize (Blink up), a dark corridor, lamps, and a day/night lever.
- **Shared areas:** a shooting range (10–70 m), a physics stress-test heap, a parkour course, and a combo vault that needs generator power *and* a basin filled with water.

## Performance

- The fixed 60 Hz physics step uses interpolated rendering, so the game stays smooth at any frame rate.
- Quality presets (Low / Medium / High) control resolution cap, shadow map size, particle budget, view distance, vegetation, dynamic lights and post-FX.
- An automatic scaler lowers render resolution and the particle budget when frames run long. Touch devices start on Medium.
- Static level geometry is merged per material, and far entities are distance-culled.
- Particles (2 draw calls), lightning bolts (1), decals and dynamic lights are pooled, so repeated power use doesn't allocate.
- Post-FX (bloom, ACES tone mapping, vignette, plus SSAO and MSAA on High) is optional and can be toggled in the pause menu.

## Project layout

```
src/
  core/     game loop, input, audio engine, physics wrapper, quality scaler, post-FX, Game (orchestrator)
  player/   character controller, camera rig, first-person hands, avatar
  powers/   Ability / Power base classes, energy, power manager, one folder per power
  world/    terrain, sky & day/night, vegetation, water, entities & props, zone builders
  systems/  reactions, fire, electricity, destruction, mud, particles, decals, lights, stealth, signals, ambience
  npc/      guard AI
  ui/       HUD, pause menu, help, teleport menu, toasts
  config/   key bindings, balance, quality presets, map layout, materials, reaction table
```

### Adding things

- **New ability:** subclass `Ability` (`src/powers/Ability.ts`, which documents the hooks: `start`, `sustain`, `end`, `update`, `fixedUpdate`, `cancel`) and choose a mode: `tap`, `charge`, `hold` or `toggle`. The base class handles energy, cooldowns and charging.
- **New power:** subclass `Power` (`src/powers/Power.ts`) with 4 abilities and add it to `src/powers/index.ts`.
- **New reaction:** add a row to `REACTIONS` or `SURFACE_REACTIONS` in `src/config/reactions.ts`.
- **New prop:** register a factory with `entities.registerFactory(type, …)` (see `src/world/props/`). Spawning it from a zone builder makes it part of the map that **R** restores.

## Notes

- Reset works by re-spawning every prop from its recorded spec, so burnt, broken, frozen or moved things all come back exactly.
- On desktop, the game requests fullscreen and Keyboard Lock so that Ctrl (crouch) + W can't close the tab. If that's unavailable, the browser asks for confirmation before leaving.
- Pointer lock is used when available (click to capture the mouse). Otherwise drag to look, or use the arrow keys.
- Licenses: everything (code, textures, sounds) is original and generated at runtime. There are no third-party assets.
