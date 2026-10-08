import * as THREE from 'three';
import { mulberry32 } from '../core/math/noise';

/**
 * Procedural textures generated on a canvas at load time, so the repo needs no
 * image assets. All of them tile seamlessly (periodic value noise).
 */

/** Periodic value-noise fbm in [0,1] over a size×size grid. */
export function tileableNoise(size: number, octaves: number, seed: number, baseCells = 8): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const a = lattice[y0 * cells + x0];
        const b = lattice[y0 * cells + x1];
        const c = lattice[y1 * cells + x0];
        const d = lattice[y1 * cells + x1];
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function canvasTexture(size: number, fill: (img: ImageData) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  fill(img);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Mid-grey detail texture for terrain (multiplied with vertex colours). */
export function makeNoiseTexture(size: number, octaves: number, seed: number): THREE.CanvasTexture {
  const n = tileableNoise(size, octaves, seed, 8);
  const fine = tileableNoise(size, 2, seed + 1, 64);
  return canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      const v = 0.62 + n[i] * 0.25 + (fine[i] - 0.5) * 0.25;
      const c = Math.max(0, Math.min(255, v * 255));
      img.data[i * 4] = c;
      img.data[i * 4 + 1] = c * 0.98;
      img.data[i * 4 + 2] = c * 0.95;
      img.data[i * 4 + 3] = 255;
    }
  });
}

export type SurfaceKind = 'wood' | 'planks' | 'stone' | 'bricks' | 'metal' | 'concrete' | 'bark' | 'cloth' | 'hay';

const cache = new Map<string, { map: THREE.Texture; rough: THREE.Texture; normal: THREE.Texture }>();

/**
 * Albedo + roughness + normal maps for common prop materials. Cached so every
 * crate shares the same GPU textures.
 */
export function surfaceTextures(kind: SurfaceKind, size = 256) {
  const hit = cache.get(kind);
  if (hit) return hit;
  const seed = [...kind].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const n = tileableNoise(size, 5, seed, 4);
  const f = tileableNoise(size, 3, seed + 3, 32);
  const height = new Float32Array(size * size);
  const albedo = new Float32Array(size * size * 3);
  const rough = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const v = y / size;
      let r = 0.5,
        g = 0.5,
        b = 0.5,
        h = n[i],
        ro = 0.8;
      switch (kind) {
        case 'wood':
        case 'planks': {
          const plank = kind === 'planks' ? Math.floor(v * 4) : 0;
          const grain = Math.sin((u * 40 + n[i] * 6 + plank * 13.1) * Math.PI) * 0.5 + 0.5;
          const seam = kind === 'planks' ? Math.min(1, Math.abs(((v * 4) % 1) - 0.5) * 40 - 18) : 1;
          const s = (0.75 + grain * 0.2 + f[i] * 0.15) * Math.max(0.35, Math.min(1, seam));
          r = 0.42 * s;
          g = 0.27 * s;
          b = 0.14 * s;
          h = grain * 0.3 + (seam < 1 ? 0 : 0.6);
          ro = 0.72 + grain * 0.15;
          break;
        }
        case 'bark': {
          const ridges = Math.abs(Math.sin((u * 14 + n[i] * 3) * Math.PI));
          const s = 0.55 + ridges * 0.35 + f[i] * 0.15;
          r = 0.24 * s;
          g = 0.17 * s;
          b = 0.11 * s;
          h = ridges;
          ro = 0.95;
          break;
        }
        case 'stone': {
          const s = 0.6 + n[i] * 0.35 + (f[i] - 0.5) * 0.2;
          r = 0.46 * s;
          g = 0.45 * s;
          b = 0.43 * s;
          h = n[i] * 0.7 + f[i] * 0.3;
          ro = 0.85 + (f[i] - 0.5) * 0.15;
          break;
        }
        case 'bricks': {
          const row = Math.floor(v * 8);
          const bu = (u * 4 + (row % 2) * 0.5) % 1;
          const bv = (v * 8) % 1;
          const mortar = bu < 0.04 || bv < 0.08;
          const s = mortar ? 0.75 : 0.6 + n[i] * 0.3 + f[i] * 0.1;
          r = mortar ? 0.5 : 0.5 * s;
          g = mortar ? 0.48 : 0.47 * s;
          b = mortar ? 0.44 : 0.44 * s;
          h = mortar ? 0 : 0.8 + f[i] * 0.2;
          ro = 0.9;
          break;
        }
        case 'metal': {
          const brushed = tileNoiseLine(f, size, x, y);
          const s = 0.7 + brushed * 0.2 + n[i] * 0.1;
          r = g = b = 0.62 * s;
          h = brushed * 0.2;
          ro = 0.35 + n[i] * 0.25;
          break;
        }
        case 'concrete': {
          const s = 0.75 + n[i] * 0.2 + (f[i] - 0.5) * 0.15;
          r = 0.52 * s;
          g = 0.51 * s;
          b = 0.49 * s;
          h = f[i];
          ro = 0.92;
          break;
        }
        case 'cloth': {
          const weave = (Math.sin(u * size * 0.8) * Math.sin(v * size * 0.8)) * 0.5 + 0.5;
          const s = 0.75 + weave * 0.15 + n[i] * 0.1;
          r = g = b = s;
          h = weave;
          ro = 0.95;
          break;
        }
        case 'hay': {
          const strands = Math.abs(Math.sin((u * 60 + n[i] * 20) * Math.PI));
          const s = 0.6 + strands * 0.35 + f[i] * 0.1;
          r = 0.62 * s;
          g = 0.5 * s;
          b = 0.22 * s;
          h = strands;
          ro = 0.95;
          break;
        }
      }
      albedo[i * 3] = r;
      albedo[i * 3 + 1] = g;
      albedo[i * 3 + 2] = b;
      height[i] = h;
      rough[i] = ro;
    }
  }
  const map = canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      img.data[i * 4] = Math.min(255, Math.sqrt(albedo[i * 3]) * 255); // store ~sRGB
      img.data[i * 4 + 1] = Math.min(255, Math.sqrt(albedo[i * 3 + 1]) * 255);
      img.data[i * 4 + 2] = Math.min(255, Math.sqrt(albedo[i * 3 + 2]) * 255);
      img.data[i * 4 + 3] = 255;
    }
  });
  map.colorSpace = THREE.SRGBColorSpace;
  const roughTex = canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      const c = Math.min(255, rough[i] * 255);
      img.data[i * 4] = c;
      img.data[i * 4 + 1] = c; // roughness is read from G
      img.data[i * 4 + 2] = c;
      img.data[i * 4 + 3] = 255;
    }
  });
  const normal = canvasTexture(size, (img) => {
    const strength = 2.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = height[y * size + ((x - 1 + size) % size)];
        const r = height[y * size + ((x + 1) % size)];
        const d = height[((y - 1 + size) % size) * size + x];
        const u = height[((y + 1) % size) * size + x];
        const nx = (l - r) * strength;
        const ny = (d - u) * strength;
        const len = Math.hypot(nx, ny, 1);
        const i = (y * size + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
  });
  const entry = { map, rough: roughTex, normal };
  cache.set(kind, entry);
  return entry;
}

function tileNoiseLine(f: Float32Array, size: number, x: number, y: number): number {
  // Horizontal streaks: average a few samples along x.
  let s = 0;
  for (let k = -3; k <= 3; k++) s += f[y * size + ((x + k * 9 + size * 4) % size)];
  return s / 7;
}

/** Tileable ripple normal map for water surfaces. */
export function waterNormalTexture(size = 256): THREE.CanvasTexture {
  const h1 = tileableNoise(size, 4, 911, 8);
  const h2 = tileableNoise(size, 3, 912, 24);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = h1[i] * 0.7 + h2[i] * 0.3;
  return canvasTexture(size, (img) => {
    const strength = 6;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = height[y * size + ((x - 1 + size) % size)];
        const r = height[y * size + ((x + 1) % size)];
        const d = height[((y - 1 + size) % size) * size + x];
        const u = height[((y + 1) % size) * size + x];
        const nx = (l - r) * strength;
        const ny = (d - u) * strength;
        const len = Math.hypot(nx, ny, 1);
        const i = (y * size + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
  });
}
