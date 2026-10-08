import { CANYON, LAKE, PATH_WIDTH, POND, RIVER, WORLD, ZONES, ZONE_LIST } from '../config/map';
import { Simplex2, distToSegment, lerp, smoothstep, clamp } from '../core/math/noise';

/**
 * Pure (Three/Rapier-free) description of the terrain shape. The analytic
 * height is evaluated once per grid vertex; everything else (props, spawn
 * points) should sample the grid via `Terrain.heightAt` so it matches the
 * physics heightfield exactly.
 */
export class TerrainShape {
  readonly noise = new Simplex2(20240917);
  readonly detail = new Simplex2(7);

  /** Raw height before carving water/canyon features. */
  private baseHeight(x: number, z: number): number {
    const n = this.noise;
    let h = 3 + n.fbm(x * 0.0042, z * 0.0042, 4) * 7 + n.fbm(x * 0.03, z * 0.03, 2) * 0.6;
    const r = Math.hypot(x, z);
    const m = smoothstep(WORLD.mountainStart, WORLD.mountainStart + 75, r);
    if (m > 0) {
      const ridge = n.ridged(x * 0.007 + 31, z * 0.007 - 17, 5);
      h += m * (30 + ridge * 70) + m * m * 25;
    }
    return h;
  }

  /** Mask in [0,1]: 1 on the centre-line of a hub→zone path. */
  pathMask(x: number, z: number): { w: number; target: number } {
    let best = 0;
    let target = 0;
    const hub = ZONES.hub;
    for (const zone of ZONE_LIST) {
      if (zone.id === 'hub') continue;
      // A gentle S-curve so paths don't look ruler-straight.
      const mx = (hub.x + zone.x) / 2 + (zone.z - hub.z) * 0.08;
      const mz = (hub.z + zone.z) / 2 - (zone.x - hub.x) * 0.08;
      for (const [ax, az, bx, bz, h0, h1] of [
        [hub.x, hub.z, mx, mz, hub.height, (hub.height + zone.height) / 2],
        [mx, mz, zone.x, zone.z, (hub.height + zone.height) / 2, zone.height],
      ]) {
        const { d, t } = distToSegment(x, z, ax, az, bx, bz);
        const w = 1 - smoothstep(PATH_WIDTH * 0.5, PATH_WIDTH * 0.5 + 7, d);
        if (w > best) {
          best = w;
          target = lerp(h0, h1, t);
        }
      }
    }
    return { w: best, target };
  }

  /** Narrow mask for the visible dirt on a path (sharper than the flattening mask). */
  pathSurface(x: number, z: number): number {
    const { w } = this.pathMask(x, z);
    return smoothstep(0.72, 0.95, w);
  }

  /** Signed distance-ish value to the lake shoreline (negative inside). */
  private lakeProfile(x: number, z: number): number {
    const dx = x - LAKE.x;
    const dz = z - LAKE.z;
    const ang = Math.atan2(dz, dx);
    const wobble = 1 + 0.13 * this.detail.noise(Math.cos(ang) * 1.3 + 5, Math.sin(ang) * 1.3 + 5);
    const d = Math.hypot(dx, dz) / (LAKE.radius * wobble);
    return d;
  }

  riverDistance(x: number, z: number): { d: number; seg: number; t: number } {
    let best = Infinity;
    let seg = 0;
    let bt = 0;
    const pts = RIVER.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const { d, t } = distToSegment(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < best) {
        best = d;
        seg = i;
        bt = t;
      }
    }
    return { d: best, seg, t: bt };
  }

  height(x: number, z: number): number {
    let h = this.baseHeight(x, z);

    // Paths: pull terrain part-way towards a smooth ramp between endpoints.
    const p = this.pathMask(x, z);
    if (p.w > 0) h = lerp(h, lerp(h, p.target, 0.75), p.w);

    // Zones: flatten to their base height with a tiny bit of texture.
    for (const zone of ZONE_LIST) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      const w = 1 - smoothstep(zone.radius * 0.72, zone.radius * 1.08, d);
      if (w > 0) {
        const texture = zone.id === 'hub' ? 0 : this.detail.fbm(x * 0.05, z * 0.05, 2) * 0.25;
        h = lerp(h, zone.height + texture, w);
      }
    }

    // Lake basin.
    const lk = this.lakeProfile(x, z);
    if (lk < 1) {
      const bowl = smoothstep(1, 0.3, lk);
      h = lerp(h, WORLD.waterLevel - LAKE.depth, bowl);
    }

    // River channel at lake level, with banks rising to meet the terrain.
    const rv = this.riverDistance(x, z);
    const halfW = RIVER.width * 0.5;
    if (rv.d < halfW + 40) {
      const across = clamp(rv.d / halfW, 0, 1);
      const bed = WORLD.waterLevel - RIVER.depth * (1 - across * across * 0.7);
      const bank = WORLD.waterLevel + 0.25 + (rv.d - halfW) * 0.9;
      const target = rv.d <= halfW ? bed : Math.max(bed, bank);
      h = Math.min(h, target);
    }

    // Earth zone canyon: steep walls, flat floor, climbable ramp at the far end.
    {
      const { d, t } = distToSegment(x, z, CANYON.ax, CANYON.az, CANYON.bx, CANYON.bz);
      const halfC = CANYON.width * 0.5;
      if (d < halfC + 12) {
        const top = ZONES.earth.height;
        let floor = top - CANYON.depth + this.detail.fbm(x * 0.08, z * 0.08, 2) * 0.4;
        floor = lerp(floor, top - 0.3, smoothstep(0.62, 1.0, t));
        const wallNoise = this.detail.noise(x * 0.12, z * 0.12) * 1.2;
        const target = floor + Math.max(0, d - halfC + wallNoise) * 3.6;
        h = Math.min(h, target);
      }
    }

    // Lightning zone pond.
    {
      const d = Math.hypot(x - POND.x, z - POND.z) / POND.radius;
      if (d < 1) h = lerp(h, POND_LEVEL - POND.depth, smoothstep(1, 0.35, d));
    }

    return h;
  }
}

/** Water surface height of the lightning-zone pond. */
export const POND_LEVEL = ZONES.lightning.height - 0.55;
