import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../../config/physics';
import type { Game } from '../../core/Game';
import { texturedMaterial } from '../props/assets';
import type { SurfaceKind } from '../textures';

/**
 * Static level geometry builder. Pieces are collected per material and merged
 * into one mesh each when `flush()` is called, so a whole zone of walls,
 * floors and platforms costs a handful of draw calls. Colliders are created
 * immediately (one static collider per piece).
 */
export class StaticBuilder {
  private pieces = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();

  constructor(private game: Game) {}

  /** Material for static pieces; phaseable walls get their own instance so they can be ghosted. */
  material(kind: SurfaceKind, opts: { color?: number; repeat?: number; phase?: boolean; metal?: boolean } = {}): THREE.MeshStandardMaterial {
    const key = `static-${kind}-${opts.color ?? ''}-${opts.repeat ?? 1}-${opts.phase ? 'p' : 's'}`;
    const m = texturedMaterial(kind, { color: opts.color, repeat: opts.repeat, metalness: opts.metal ? 0.8 : 0, key });
    if (opts.phase) this.game.phaseMaterials.add(m);
    return m;
  }

  /**
   * Add a box. `uvScale` sets texture metres-per-repeat. Collider group:
   * PHASEABLE for walls the Shadow player can walk through, STATIC otherwise.
   */
  box(
    center: THREE.Vector3,
    size: [number, number, number],
    mat: THREE.Material,
    opts: { ry?: number; phase?: boolean; collide?: boolean; uvScale?: number } = {},
  ) {
    const [w, h, d] = size;
    const geo = new THREE.BoxGeometry(w, h, d);
    // World-scaled UVs so textures don't stretch on long walls.
    const s = opts.uvScale ?? 2;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nrm.getX(i));
      const ny = Math.abs(nrm.getY(i));
      const u = uv.getX(i);
      const v = uv.getY(i);
      const [su, sv] = nx > 0.5 ? [d, h] : ny > 0.5 ? [w, d] : [w, h];
      uv.setXY(i, (u * su) / s, (v * sv) / s);
    }
    this.tmpQ.setFromAxisAngle(UP, opts.ry ?? 0);
    this.tmpM.compose(center, this.tmpQ, ONE);
    geo.applyMatrix4(this.tmpM);
    this.push(mat, geo);
    if (opts.collide !== false) this.game.addStaticBox(center, w / 2, h / 2, d / 2, opts.ry ?? 0, opts.phase ? G.PHASEABLE : G.STATIC);
  }

  /** Arbitrary pre-transformed geometry (no collider). */
  geometry(geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.push(mat, geo);
  }

  cylinder(center: THREE.Vector3, r: number, h: number, mat: THREE.Material, opts: { collide?: boolean; segments?: number; phase?: boolean } = {}) {
    const geo = new THREE.CylinderGeometry(r, r, h, opts.segments ?? 16);
    geo.translate(center.x, center.y, center.z);
    this.push(mat, geo);
    if (opts.collide !== false) this.game.addStaticCylinder(center, r, h / 2, opts.phase ? G.PHASEABLE : G.STATIC);
  }

  private push(mat: THREE.Material, geo: THREE.BufferGeometry) {
    // Normalise attributes so everything merges.
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let list = this.pieces.get(mat);
    if (!list) this.pieces.set(mat, (list = []));
    list.push(g);
  }

  /** Merge everything added so far into static meshes. */
  flush(name = 'static') {
    for (const [mat, geos] of this.pieces) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.game.scene.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.pieces.clear();
  }
}

/** A canvas texture with text (signposts, boards). */
export function textTexture(lines: string[], opts: { w?: number; h?: number; bg?: string; fg?: string; font?: number; title?: string; accent?: string } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 512;
  const h = opts.h ?? 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = opts.bg ?? '#3b2a1c';
  ctx.fillRect(0, 0, w, h);
  // Wood grain-ish stripes.
  ctx.globalAlpha = 0.12;
  for (let y = 0; y < h; y += 6) {
    ctx.fillStyle = y % 12 ? '#000' : '#fff';
    ctx.fillRect(0, y, w, 2);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  let y = 18;
  const font = opts.font ?? 34;
  ctx.textBaseline = 'top';
  if (opts.title) {
    ctx.fillStyle = opts.accent ?? '#ffd23f';
    ctx.font = `bold ${Math.round(font * 1.3)}px sans-serif`;
    ctx.fillText(opts.title, 24, y);
    y += font * 1.6;
  }
  ctx.fillStyle = opts.fg ?? '#f3ead8';
  ctx.font = `${font}px sans-serif`;
  for (const line of lines) {
    ctx.fillText(line, 24, y);
    y += font * 1.25;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A free-standing sign board on two posts (static, with collider). */
export function signBoard(game: Game, sb: StaticBuilder, pos: THREE.Vector3, ry: number, tex: THREE.Texture, size: [number, number] = [2.4, 1.2]) {
  const [w, h] = size;
  const wood = sb.material('wood');
  const off = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
  for (const s of [-1, 1]) {
    sb.box(pos.clone().addScaledVector(off, (s * w) / 2.2).setY(pos.y + (h + 1.2) / 2), [0.12, h + 1.2, 0.12], wood, { ry });
  }
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  board.position.copy(pos).setY(pos.y + 1.2 + h / 2);
  board.rotation.y = ry;
  board.castShadow = true;
  game.scene.add(board);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.06), wood);
  back.position.copy(board.position).addScaledVector(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), -0.04);
  back.rotation.y = ry;
  back.castShadow = true;
  game.scene.add(back);
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
