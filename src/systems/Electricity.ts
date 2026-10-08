import * as THREE from 'three';
import { audio } from '../core/Audio';
import type { Game, GameSystem } from '../core/Game';
import type { Entity } from '../world/Entity';
import { FX } from './Particles';

/**
 * Electricity propagation: charged conductive entities crackle, arc to nearby
 * conductors (sharing their charge), zap organic targets and the player, and
 * electrify any water body they're in.
 */
export class ElectricitySystem implements GameSystem {
  private timer = 0;
  private near: Entity[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private zapCooldown = 0;

  constructor(private game: Game) {}

  /** Draw an arc between two points with a flash of light and a crackle. */
  arc(a: THREE.Vector3, b: THREE.Vector3, strength = 1, color: THREE.ColorRepresentation = 0x9fd0ff) {
    const g = this.game;
    g.bolts.spawn(a, b, { width: 0.04 + strength * 0.04, jag: 0.22, detail: 5, life: 0.12 + strength * 0.1, intensity: 0.6 + strength, color, forkChance: 0.15 });
    g.particles.emit(FX.electric, b, 4 + strength * 6, { spread: Math.PI, speed: [1, 4] });
    g.lights.add(this.tmp.copy(a).lerp(b, 0.5), color, 10 * strength, 10);
    audio.crackle(b, 0.25 + strength * 0.4);
  }

  fixedUpdate(dt: number) {
    this.zapCooldown -= dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.12;
    const g = this.game;
    for (const e of g.entities.list) {
      if (e.dead || e.charge < 0.2) continue;
      const c = e.center(this.tmp2).clone();
      // Surface crackle.
      if (Math.random() < e.charge * 0.6) {
        const a = TMP_A.copy(c).add(RND.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(e.radius * 1.6));
        const b = TMP_B.copy(c).add(RND.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(e.radius * 1.6));
        g.bolts.spawn(a, b, { width: 0.02, detail: 3, life: 0.08, intensity: e.charge });
        g.particles.emit(FX.electric, a, 2, { spread: Math.PI, speed: [0.5, 2] });
        g.lights.add(c, 0x8fc8ff, 3 * e.charge, 5);
        if (Math.random() < 0.3) audio.crackle(c, 0.15 * e.charge);
      }
      if (!e.conductive || e.charge < 0.35) continue;
      // Arc to neighbours.
      for (const o of g.entities.nearby(c, e.radius + 3.2, this.near)) {
        if (o === e || o.dead) continue;
        const oc = o.center(TMP_C);
        const conductive = o.conductive;
        const organic = o.tags.has('organic');
        if (!conductive && !organic) continue;
        if (conductive && o.charge > e.charge - 0.15) continue;
        if (Math.random() > 0.5) continue;
        this.arc(c, oc, e.charge * 0.6);
        if (conductive) {
          const share = (e.charge - o.charge) * 0.45;
          o.charge = Math.min(1, o.charge + share);
          e.charge -= share * 0.3;
        }
        if (organic) {
          g.reactions.apply(o, 'lightning', 0.25 * e.charge, c);
          e.charge *= 0.85;
        }
      }
      // Electrify water the object is sitting in.
      const body = g.water.bodyAt(c, e.radius);
      if (body && e.charge > 0.5) g.water.electrify(body, 1.5, c);
      // Zap the player if they get close.
      const pc = g.player.curPos;
      if (this.zapCooldown <= 0 && pc.distanceTo(c) < e.radius + 1.3 && e.charge > 0.4) {
        this.zapCooldown = 0.7;
        this.arc(c, TMP_C.copy(pc), e.charge * 0.7);
        g.shockPlayer(0.3 * e.charge, c);
        e.charge *= 0.7;
      }
    }
  }
}

const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const RND = new THREE.Vector3();
