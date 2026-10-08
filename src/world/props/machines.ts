import * as THREE from 'three';
import { G, groups } from '../../config/physics';
import { audio, type LoopHandle } from '../../core/Audio';
import type { Game } from '../../core/Game';
import { RAPIER } from '../../core/Physics';
import { FX } from '../../systems/Particles';
import type { PropSpec } from '../Entity';
import { buildProp } from './basic';
import { boxGeo, cylGeo, mesh, plainMaterial, sphereGeo, texturedMaterial } from './assets';

const metal = () => texturedMaterial('metal', { color: 0x9aa4ae, metalness: 0.85, key: 'machineMetal' });
const darkMetal = () => texturedMaterial('metal', { color: 0x4a5058, metalness: 0.8, key: 'darkMetal' });
const sig = (s: PropSpec, k = 'signal') => (s.data?.[k] as string) ?? '';

/**
 * Puzzle machines and interactive structures. They communicate through
 * `game.signals`: generators, rods, plates, levers and basins set signals;
 * gates and lamps read them.
 */
export function registerMachines(game: Game) {
  const em = game.entities;

  // ---------------------------------------------------------------- generator
  em.registerFactory('generator', (s) => {
    const g = new THREE.Group();
    const body = mesh(boxGeo(1.6, 1.4, 1.2, 0.05), darkMetal());
    body.position.y = 0;
    const coil = mesh(cylGeo(0.35, 0.35, 0.9, 16), plainMaterial('coil', { color: 0xb87333, metalness: 0.9, roughness: 0.35 }));
    coil.position.set(0, 1.1, 0);
    const bulb = mesh(sphereGeo(0.22, 2), plainMaterial('genBulb', { color: 0x557788, emissive: 0x000000, roughness: 0.2 }));
    bulb.position.set(0, 1.7, 0);
    bulb.userData.noVisualState = true;
    g.add(body, coil, bulb);
    const e = buildProp(em, s, 'generator', {
      material: 'metal',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cuboid(0.8, 0.7, 0.6), RAPIER.ColliderDesc.cylinder(0.45, 0.35).setTranslation(0, 1.1, 0)],
      radius: 1.2,
      volume: 2,
    });
    e.tags.add('machine');
    const name = sig(s);
    const dur = (s.data?.duration as number) ?? 25;
    const bulbMat = (bulb.material as THREE.MeshStandardMaterial).clone();
    bulb.material = bulbMat;
    let hum: LoopHandle | null = null;
    const top = new THREE.Vector3(s.x, s.y + 1.7, s.z);
    e.onElement = (kind) => {
      if (kind !== 'lightning') return;
      const was = game.signals.on(name);
      game.signals.pulse(name, dur);
      if (!was) {
        audio.tone({ pos: top, volume: 0.5, freq: 60, freqEnd: 120, decay: 1.2, type: 'sawtooth' });
        game.toasts.show('Generator powered!', '#7fd4ff');
      }
    };
    e.interactLabel = 'Generator — needs lightning';
    e.interact = () => game.toasts.show(game.signals.on(name) ? `Powered (${game.signals.remaining(name).toFixed(0)} s)` : 'Hit it with lightning to power it up');
    e.update = () => {
      const on = game.signals.on(name);
      bulbMat.emissive.setHex(on ? 0x66ccff : 0x000000);
      bulbMat.emissiveIntensity = on ? 3 : 0;
      if (on) {
        game.lights.add(top, 0x66ccff, 6, 8);
        if (Math.random() < 0.08) game.bolts.spawn(top, top.clone().add(new THREE.Vector3(Math.random() - 0.5, -0.6, Math.random() - 0.5)), { width: 0.02, detail: 3, life: 0.08 });
        if (!hum) {
          hum = audio.loop({ pos: top, freq: 120, filter: 'bandpass', q: 6, volume: 0.6, ref: 5, lfo: { rate: 50, depth: 0.2 } });
          hum.setLevel(0.6, 0.3);
        }
      } else if (hum) {
        hum.stop(0.6);
        hum = null;
      }
    };
    e.onRemove = () => {
      hum?.stop(0.1);
      bulbMat.dispose();
    };
    return e;
  });

  // ---------------------------------------------------------------- lightning rod
  em.registerFactory('rod', (s) => {
    const h = s.h ?? 7;
    const g = new THREE.Group();
    const pole = mesh(cylGeo(0.07, 0.12, h, 8), metal());
    pole.position.y = h / 2;
    const ball = mesh(sphereGeo(0.22, 2), plainMaterial('rodBall', { color: 0xd8c27a, metalness: 1, roughness: 0.25 }));
    ball.position.y = h + 0.15;
    const base = mesh(cylGeo(0.5, 0.6, 0.3, 12), texturedMaterial('concrete', { key: 'rodBase' }));
    base.position.y = 0.15;
    g.add(pole, ball, base);
    const e = buildProp(em, s, 'rod', {
      material: 'metal',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cylinder(h / 2, 0.15).setTranslation(0, h / 2, 0), RAPIER.ColliderDesc.ball(0.25).setTranslation(0, h + 0.15, 0)],
      radius: 1,
      volume: 0.3,
    });
    e.tags.add('rod');
    e.tags.add('machine');
    const name = sig(s);
    const top = new THREE.Vector3(s.x, s.y + h + 0.15, s.z);
    e.onElement = (kind) => {
      if (kind !== 'lightning') return;
      if (name) game.signals.pulse(name, (s.data?.duration as number) ?? 30);
      game.particles.emit(FX.electric, top, 20, { spread: Math.PI, speed: [1, 5] });
    };
    e.update = () => {
      if (name && game.signals.on(name) && Math.random() < 0.15) {
        game.bolts.spawn(top, top.clone().add(new THREE.Vector3(Math.random() - 0.5, -Math.random() * 2, Math.random() - 0.5)), { width: 0.02, detail: 3, life: 0.1 });
        game.lights.add(top, 0x88ccff, 4, 6);
      }
    };
    e.interactLabel = 'Lightning rod';
    e.interact = () => game.toasts.show(name && game.signals.on(name) ? 'Charged!' : 'Strike it with lightning (or call a storm)');
    return e;
  });

  // ---------------------------------------------------------------- gate
  em.registerFactory('gate', (s) => {
    const w = s.w ?? 4;
    const h = s.h ?? 3.5;
    const d = s.d ?? 0.35;
    const g = new THREE.Group();
    const frame = mesh(boxGeo(w, h, d * 0.5, 0.02), darkMetal());
    g.add(frame);
    for (let i = 0; i < Math.round(w / 0.45); i++) {
      const bar = mesh(cylGeo(0.05, 0.05, h, 6), metal());
      bar.position.set(-w / 2 + 0.25 + i * 0.45, 0, d * 0.4);
      g.add(bar);
    }
    const e = buildProp(em, { ...s, y: s.y + h / 2 }, 'gate', {
      material: 'metal',
      object: g,
      kinematic: true,
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)],
      radius: w / 2,
      volume: w * h * 0.05,
      group: G.PHASEABLE,
    });
    for (const c of e.colliders) c.setCollisionGroups(groups(G.PHASEABLE));
    em.physics.sync(e.body!, e.object);
    e.isStatic = true;
    const need = (s.data?.signals as string[]) ?? [];
    const latch = !!s.data?.latch;
    let open = 0;
    let opened = false;
    let grind: LoopHandle | null = null;
    const base = s.y + h / 2;
    e.update = (dt) => {
      const want = (latch && opened) || (need.length > 0 && game.signals.all(need)) ? 1 : 0;
      if (want && !opened) {
        opened = true;
        game.toasts.show((s.data?.message as string) ?? 'A gate opens!', '#ffd23f');
      }
      if (!latch && !want) opened = false;
      const prev = open;
      open += Math.sign(want - open) * Math.min(Math.abs(want - open), dt / 1.6);
      const moving = Math.abs(open - prev) > 1e-5;
      if (moving && !grind) {
        grind = audio.loop({ pos: new THREE.Vector3(s.x, base, s.z), freq: 220, filter: 'bandpass', q: 2, brown: true, volume: 1, ref: 8, lfo: { rate: 13, depth: 0.3 } });
        grind.setLevel(0.7, 0.1);
      } else if (!moving && grind) {
        grind.stop(0.2);
        grind = null;
        audio.impact(new THREE.Vector3(s.x, base, s.z), 0.8, 'metal');
      }
      e.body?.setNextKinematicTranslation({ x: s.x, y: base + open * (h - 0.25), z: s.z });
    };
    e.interactLabel = need.length ? `Gate (needs: ${need.join(' + ')})` : 'Gate';
    e.interact = () => game.toasts.show(need.map((n) => `${n}: ${game.signals.on(n) ? 'ON' : 'off'}`).join(' · ') || 'Locked');
    e.onRemove = () => grind?.stop(0.1);
    return e;
  });

  // ---------------------------------------------------------------- lamp post
  em.registerFactory('lamp', (s) => {
    const h = s.h ?? 4;
    const g = new THREE.Group();
    const pole = mesh(cylGeo(0.06, 0.09, h, 8), darkMetal());
    pole.position.y = h / 2;
    const bulbMat = plainMaterial('lampBulb', { color: 0xfff2d0, emissive: 0x000000 }).clone();
    const bulb = mesh(sphereGeo(0.2, 2), bulbMat, false);
    bulb.position.y = h + 0.1;
    bulb.userData.noVisualState = true;
    g.add(pole, bulb);
    const e = buildProp(em, s, 'lamp', {
      material: 'metal',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cylinder(h / 2, 0.1).setTranslation(0, h / 2, 0)],
      radius: 0.6,
      volume: 0.1,
    });
    const name = sig(s);
    const color = (s.data?.color as number) ?? 0xffd9a0;
    const top = new THREE.Vector3(s.x, s.y + h, s.z);
    e.update = () => {
      const on = name ? game.signals.on(name) : game.env.nightFactor > 0.5;
      bulbMat.emissive.setHex(on ? color : 0);
      bulbMat.emissiveIntensity = on ? 4 : 0;
      if (on) game.lights.add(top, color, (s.data?.intensity as number) ?? 14, (s.data?.range as number) ?? 14);
    };
    e.onRemove = () => bulbMat.dispose();
    return e;
  });

  // ---------------------------------------------------------------- pressure plate
  em.registerFactory('plate', (s) => {
    const g = new THREE.Group();
    const frame = mesh(boxGeo(2.0, 0.12, 2.0, 0.02), texturedMaterial('stone', { key: 'plateFrame' }));
    const top = mesh(boxGeo(1.6, 0.12, 1.6, 0.03), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 }));
    top.position.y = 0.07;
    top.userData.noVisualState = true;
    g.add(frame, top);
    const e = buildProp(em, s, 'plate', {
      material: 'stone',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cuboid(1.0, 0.1, 1.0)],
      radius: 1.2,
      volume: 0.4,
    });
    const name = sig(s);
    const need = (s.data?.mass as number) ?? 200;
    const topMat = top.material as THREE.MeshStandardMaterial;
    const c = new THREE.Vector3(s.x, s.y + 0.6, s.z);
    let pressed = false;
    let timer = 0;
    e.update = (dt) => {
      timer -= dt;
      if (timer > 0) return;
      timer = 0.15;
      let mass = 0;
      for (const o of game.entities.nearby(c, 1.4, NEAR)) {
        if (!o.isDynamic) continue;
        const p = o.center(TMP);
        if (Math.abs(p.x - s.x) < 1.1 && Math.abs(p.z - s.z) < 1.1 && p.y > s.y && p.y < s.y + 2.5) mass += o.mass;
      }
      const pl = game.player;
      if (Math.abs(pl.curPos.x - s.x) < 1.1 && Math.abs(pl.curPos.z - s.z) < 1.1 && pl.grounded && Math.abs(pl.feet(TMP).y - s.y - 0.13) < 0.4) mass += game.armored ? 400 : 80;
      const now = mass >= need;
      if (now !== pressed) {
        pressed = now;
        audio.impact(c, 0.6, 'stone');
        if (now) audio.tone({ pos: c, volume: 0.2, freq: 440, freqEnd: 660, decay: 0.3, type: 'triangle' });
      }
      game.signals.set(name, now);
      top.position.y = now ? 0.02 : 0.07;
      topMat.emissive.setHex(now ? 0x3a8a3a : 0);
      e.interactLabel = `Pressure plate: ${Math.round(mass)} / ${need} kg`;
    };
    e.interact = () => game.toasts.show(e.interactLabel ?? '');
    e.interactLabel = `Pressure plate: needs ${need} kg`;
    e.onRemove = () => topMat.dispose();
    return e;
  });

  // ---------------------------------------------------------------- lever
  em.registerFactory('lever', (s) => {
    const g = new THREE.Group();
    const base = mesh(boxGeo(0.6, 0.5, 0.4, 0.04), darkMetal());
    base.position.y = 0.25;
    const pivot = new THREE.Group();
    pivot.position.y = 0.5;
    const handle = mesh(cylGeo(0.04, 0.04, 0.9, 8), metal());
    handle.position.y = 0.45;
    const knob = mesh(sphereGeo(0.08, 1), plainMaterial('leverKnob', { color: 0xc0392b, roughness: 0.5 }));
    knob.position.y = 0.9;
    pivot.add(handle, knob);
    g.add(base, pivot);
    const e = buildProp(em, s, 'lever', {
      material: 'metal',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cuboid(0.3, 0.25, 0.2).setTranslation(0, 0.25, 0), RAPIER.ColliderDesc.cuboid(0.15, 0.5, 0.15).setTranslation(0, 0.9, 0)],
      radius: 0.6,
      volume: 0.1,
    });
    const name = sig(s);
    const action = s.data?.action as string | undefined;
    let on = false;
    pivot.rotation.x = -0.6;
    e.interactLabel = (s.data?.label as string) ?? 'Pull lever';
    e.interact = () => {
      on = !on;
      if (action === 'dayNight') game.env.toggle();
      else game.signals.set(name, on);
      audio.impact(e.center(TMP), 0.6, 'metal');
      game.toasts.show(action === 'dayNight' ? (game.env.isNight ? 'Night falls' : 'Daybreak') : on ? 'Lever on' : 'Lever off');
    };
    e.update = () => {
      const target = on ? 0.6 : -0.6;
      pivot.rotation.x += (target - pivot.rotation.x) * 0.2;
    };
    return e;
  });

  // ---------------------------------------------------------------- brazier (permanently burning until doused)
  em.registerFactory('brazier', (s) => {
    const g = new THREE.Group();
    const bowl = mesh(cylGeo(0.55, 0.3, 0.4, 14), darkMetal());
    bowl.position.y = 1.0;
    const stand = mesh(cylGeo(0.07, 0.18, 0.9, 8), darkMetal());
    stand.position.y = 0.45;
    const coals = mesh(cylGeo(0.48, 0.48, 0.05, 12), plainMaterial('coals', { color: 0x221a14, roughness: 1 }));
    coals.position.y = 1.18;
    g.add(bowl, stand, coals);
    const e = buildProp(em, s, 'brazier', {
      material: 'metal',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cylinder(0.6, 0.45).setTranslation(0, 0.6, 0)],
      radius: 0.7,
      volume: 0.3,
    });
    e.tags.add('fireSource');
    e.fireOffset = 1.05;
    const name = sig(s);
    const top = new THREE.Vector3(s.x, s.y + 1.3, s.z);
    const light = () => {
      e.burning = true;
      e.fuel = 1;
      game.fire.burning.add(e);
    };
    if (s.data?.lit !== false) light();
    e.onElement = (kind) => {
      if ((kind === 'fire' || kind === 'lightning') && !e.burning && e.wetness < 0.5) light();
    };
    e.update = () => {
      e.fuel = 1;
      e.wetness = Math.max(0, e.wetness - 0.002);
      if (name) game.signals.set(name, !e.burning);
      if (!e.burning && Math.random() < 0.02) game.particles.emit(FX.smoke, top, 1, { spread: 0.3, speed: [0.3, 0.6], sizeMul: 0.4 });
    };
    e.interactLabel = 'Brazier';
    e.interact = () => game.toasts.show(e.burning ? 'Burning — douse it with water' : 'Doused — fire relights it');
    // Keep the brazier itself intact while burning.
    e.onBurnout = () => light();
    return e;
  });

  // ---------------------------------------------------------------- water basin (fills with water)
  em.registerFactory('basin', (s) => {
    const r = s.w ?? 1.2;
    const g = new THREE.Group();
    const stone = texturedMaterial('stone', { key: 'basinStone' });
    const ring = mesh(cylGeo(r, r * 0.9, 0.9, 20), stone);
    ring.position.y = 0.45;
    const water = mesh(cylGeo(r * 0.85, r * 0.85, 0.02, 20), plainMaterial('basinWater', { color: 0x2a7f9a, roughness: 0.05, transparent: true, opacity: 0.85 }), false);
    water.userData.noVisualState = true;
    g.add(ring, water);
    const e = buildProp(em, s, 'basin', {
      material: 'stone',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cylinder(0.45, r).setTranslation(0, 0.45, 0)],
      radius: r,
      volume: 1,
    });
    const name = sig(s);
    let fill = 0;
    let full = false;
    e.onElement = (kind, amount) => {
      if (kind === 'water') fill = Math.min(1, fill + amount * 0.18);
      if (kind === 'fire' || kind === 'heat') fill = Math.max(0, fill - amount * 0.05);
      if (kind === 'cold' && fill > 0.5) e.frozen = 1;
    };
    e.update = (dt) => {
      if (!full) fill = Math.max(0, fill - dt * 0.004);
      water.visible = fill > 0.02;
      water.position.y = 0.1 + fill * 0.75;
      if (fill >= 1 && !full) {
        full = true;
        game.toasts.show('The basin is full!', '#3fa9f5');
        audio.tone({ volume: 0.3, freq: 520, freqEnd: 780, decay: 0.5, type: 'sine' });
      }
      game.signals.set(name, full);
      e.interactLabel = full ? 'Basin: full' : `Basin: ${Math.round(fill * 100)}% — fill it with water`;
    };
    e.interact = () => game.toasts.show(e.interactLabel ?? '');
    return e;
  });

  // ---------------------------------------------------------------- shooting target
  em.registerFactory('target', (s) => {
    const g = new THREE.Group();
    const pivot = new THREE.Group();
    const face = mesh(
      cylGeo(0.6, 0.6, 0.08, 24).clone().rotateX(Math.PI / 2),
      targetMaterial(),
    );
    face.position.y = 0.6;
    face.userData.ownsGeometry = true;
    pivot.add(face);
    const post = mesh(cylGeo(0.05, 0.05, 1.2, 6), texturedMaterial('wood', { key: 'targetPost' }));
    post.position.y = -0.6;
    g.add(pivot, post);
    pivot.position.y = 1.2;
    const e = buildProp(em, s, 'target', {
      material: 'wood',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cuboid(0.6, 0.6, 0.08).setTranslation(0, 1.8, 0)],
      radius: 0.9,
      volume: 0.1,
    });
    e.tags.add('target');
    let down = 0;
    const dist = (s.data?.distance as number) ?? 0;
    const hit = () => {
      if (down > 0) return;
      down = 5;
      audio.impact(e.center(TMP), 1, 'wood');
      audio.tone({ volume: 0.25, freq: 880, freqEnd: 1320, decay: 0.25, type: 'triangle' });
      game.toasts.show(`Target hit! ${dist} m`, '#ffd23f');
    };
    e.onElement = () => hit();
    e.onHit = () => hit();
    e.onDamage = () => hit();
    e.update = (dt) => {
      if (down > 0) down -= dt;
      const want = down > 0 ? -Math.PI / 2 : 0;
      pivot.rotation.x += (want - pivot.rotation.x) * 0.15;
      e.fuel = 1;
      if (e.burning && down <= 0) hit();
    };
    return e;
  });

  // ---------------------------------------------------------------- wooden wall panel (burnable, collapses)
  em.registerFactory('woodPanel', (s) => {
    const w = s.w ?? 3;
    const h = s.h ?? 2.6;
    const d = s.d ?? 0.15;
    const m = mesh(boxGeo(w, h, d, 0.01), texturedMaterial('planks', { color: 0xc8a882, key: 'panelWood' }));
    const e = buildProp(em, s, 'woodPanel', {
      material: 'dryWood',
      object: m,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)],
      radius: Math.max(w, h) / 2,
      volume: w * h * d * 3,
    });
    if (s.data?.phase !== false) for (const c of e.colliders) c.setCollisionGroups(groups(G.PHASEABLE));
    e.tags.add('collapsible');
    return e;
  });

  // ---------------------------------------------------------------- metal beam (conductive structure)
  em.registerFactory('beam', (s) => {
    const w = s.w ?? 0.3;
    const h = s.h ?? 4;
    const d = s.d ?? 0.3;
    const m = mesh(boxGeo(w, h, d, 0.02), metal());
    const e = buildProp(em, s, 'beam', {
      material: 'metal',
      object: m,
      fixed: !s.data?.dynamic,
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)],
      radius: Math.max(w, h, d) / 2,
      volume: w * h * d * 0.3,
      mass: s.data?.dynamic ? w * h * d * 800 : undefined,
    });
    return e;
  });

  // ---------------------------------------------------------------- treasure / goal
  em.registerFactory('treasure', (s) => {
    const g = new THREE.Group();
    const ped = mesh(cylGeo(0.4, 0.5, 1, 10), texturedMaterial('stone', { key: 'pedestal' }));
    ped.position.y = 0.5;
    const gemMat = plainMaterial('gem', { color: (s.data?.color as number) ?? 0xffd23f, emissive: (s.data?.color as number) ?? 0xffd23f, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.3 });
    const gem = mesh(new THREE.OctahedronGeometry(0.25), gemMat);
    gem.userData.ownsGeometry = true;
    gem.userData.noVisualState = true;
    gem.position.y = 1.4;
    g.add(ped, gem);
    const e = buildProp(em, s, 'treasure', {
      material: 'stone',
      object: g,
      fixed: true,
      colliders: [RAPIER.ColliderDesc.cylinder(0.5, 0.5).setTranslation(0, 0.5, 0)],
      radius: 0.8,
      volume: 0.5,
    });
    const top = new THREE.Vector3(s.x, s.y + 1.4, s.z);
    let found = false;
    e.update = (dt) => {
      gem.rotation.y += dt * 1.5;
      gem.position.y = 1.4 + Math.sin(performance.now() * 0.002) * 0.08;
      if (!found) game.lights.add(top, (s.data?.color as number) ?? 0xffd23f, 3, 5);
    };
    e.interactLabel = 'Take the treasure';
    e.interact = () => {
      if (found) return;
      found = true;
      gem.visible = false;
      game.particles.emit(FX.spark, top, 40, { spread: Math.PI, speed: [1, 4] });
      audio.tone({ volume: 0.3, freq: 660, freqEnd: 990, decay: 0.6, type: 'triangle' });
      audio.tone({ volume: 0.2, freq: 990, freqEnd: 1320, decay: 0.8, type: 'triangle', delay: 0.15 });
      game.toasts.show((s.data?.message as string) ?? 'Treasure found!', '#ffd23f', 2500);
    };
    return e;
  });
}

let targetMat: THREE.MeshStandardMaterial | null = null;
function targetMaterial(): THREE.MeshStandardMaterial {
  return (targetMat ??= new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.8 }));
}

/** Bullseye texture (shared). */
let targetTex: THREE.CanvasTexture | null = null;
function targetTexture(): THREE.CanvasTexture {
  if (targetTex) return targetTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const colors = ['#f4efe6', '#c0392b', '#f4efe6', '#c0392b', '#f4efe6', '#c0392b'];
  colors.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(64, 64, 64 - i * 11, 0, Math.PI * 2);
    ctx.fill();
  });
  targetTex = new THREE.CanvasTexture(c);
  targetTex.colorSpace = THREE.SRGBColorSpace;
  return targetTex;
}

const TMP = new THREE.Vector3();
const NEAR: import('../Entity').Entity[] = [];
