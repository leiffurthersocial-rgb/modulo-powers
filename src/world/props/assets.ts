import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { surfaceTextures, type SurfaceKind } from '../textures';

/**
 * Shared GPU resources for props. Everything here is created once and reused,
 * so spawning/despawning props never leaks geometries or materials.
 */
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const geoCache = new Map<string, THREE.BufferGeometry>();

export function texturedMaterial(
  kind: SurfaceKind,
  opts: { color?: THREE.ColorRepresentation; metalness?: number; roughness?: number; repeat?: number; key?: string } = {},
): THREE.MeshStandardMaterial {
  const key = opts.key ?? `${kind}|${opts.color ?? ''}|${opts.metalness ?? ''}|${opts.repeat ?? 1}`;
  let m = matCache.get(key);
  if (m) return m;
  const t = surfaceTextures(kind);
  const map = opts.repeat && opts.repeat !== 1 ? t.map.clone() : t.map;
  const normal = opts.repeat && opts.repeat !== 1 ? t.normal.clone() : t.normal;
  const rough = opts.repeat && opts.repeat !== 1 ? t.rough.clone() : t.rough;
  if (opts.repeat && opts.repeat !== 1) {
    for (const tx of [map, normal, rough]) {
      tx.repeat.set(opts.repeat, opts.repeat);
      tx.needsUpdate = true;
    }
  }
  m = new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    roughnessMap: rough,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
  });
  matCache.set(key, m);
  return m;
}

export function plainMaterial(key: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial(params);
    matCache.set(key, m);
  }
  return m;
}

export function physicalMaterial(key: string, params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  let m = matCache.get(key) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhysicalMaterial(params);
    matCache.set(key, m);
  }
  return m;
}

export function cachedGeometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export function boxGeo(w: number, h: number, d: number, round = 0.04): THREE.BufferGeometry {
  const k = `box|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${round}`;
  return cachedGeometry(k, () => (round > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(round, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d)));
}

export function cylGeo(rt: number, rb: number, h: number, seg = 16): THREE.BufferGeometry {
  return cachedGeometry(`cyl|${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}

export function sphereGeo(r: number, detail = 1): THREE.BufferGeometry {
  return cachedGeometry(`sph|${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}
