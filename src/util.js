import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const easeOut = (k) => 1 - (1 - k) * (1 - k);
export const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export const angleDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

/** Heading (rotation.y) of a model whose front faces +Z, looking from `from` towards `to`. */
export const headingTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

export const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const toRoman = (n) => {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
};

/** Smooth pseudo-noise in roughly [-1, 1], used for flame flicker. */
export const flicker = (t, seed = 0) =>
  Math.sin(t * 7.3 + seed) * 0.5 + Math.sin(t * 13.1 + seed * 2.1) * 0.3 + Math.sin(t * 23.7 + seed * 3.7) * 0.2;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function composeMatrix(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** BoxGeometry whose UVs tile in world units instead of stretching 0..1 per face. */
export function worldBoxGeometry(w, h, d, unit = 4) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = faceDims[face];
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * su) / unit, (uv.getY(idx) * sv) / unit);
    }
  }
  return geo;
}

export function scaleUV(geo, su, sv = su) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/**
 * A slab of wall (width x height, centred on x, bottom at y=0) pierced by pointed (gothic)
 * arches. Arches with no `bottom` are doorways notched up from the base; arches with a
 * `bottom` > 0 are windows cut as holes. Extruded along Z and centred on it; UVs are world / 4.
 * Each arch: { cx, halfW, spring, peak, bottom? }.
 */
export function archWallGeometry(width, height, depth, arches) {
  const archPath = (path, a, fromBottom) => {
    const rise = a.peak - a.spring;
    path.lineTo(a.cx - a.halfW, fromBottom);
    path.lineTo(a.cx - a.halfW, a.spring);
    path.bezierCurveTo(a.cx - a.halfW, a.spring + rise * 0.55, a.cx - a.halfW * 0.35, a.peak - rise * 0.08, a.cx, a.peak);
    path.bezierCurveTo(a.cx + a.halfW * 0.35, a.peak - rise * 0.08, a.cx + a.halfW, a.spring + rise * 0.55, a.cx + a.halfW, a.spring);
    path.lineTo(a.cx + a.halfW, fromBottom);
  };
  const doors = arches.filter((a) => !a.bottom).sort((p, q) => p.cx - q.cx);
  const windows = arches.filter((a) => a.bottom > 0);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  for (const a of doors) archPath(shape, a, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.lineTo(-width / 2, 0);
  for (const a of windows) {
    const hole = new THREE.Path();
    hole.moveTo(a.cx + a.halfW, a.bottom);
    archPath(hole, a, a.bottom);
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  geo.translate(0, 0, -depth / 2);
  return scaleUV(geo, 0.25);
}

/**
 * Accumulates static geometry and merges it into one mesh per material. The chambers are made
 * of thousands of stones, pillars and crystals — merging keeps draw calls (and the six-sided
 * lantern shadow pass) cheap.
 */
export class GeoBatch {
  constructor() {
    this.buckets = new Map();
  }

  add(geo, material, matrix, { cast = true, receive = true } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(matrix);
    const key = `${material.uuid}|${cast}|${receive}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { material, cast, receive, geos: [] };
      this.buckets.set(key, bucket);
    }
    bucket.geos.push(g);
  }

  build(parent) {
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}
