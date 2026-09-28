import * as THREE from 'three';
import { CONFIG, DIRS } from './config.js';
import { rand, randInt, pick, chance, composeMatrix, worldBoxGeometry, TAU } from './util.js';

/**
 * Chamber layouts. Each builds a distinct walkable "hub" around the chamber's local origin and
 * sets `chamber.center` (where rewards appear). Gateways onto the hub are added afterwards.
 */

export const R = CONFIG.gateDistance;

/** Perpendicular ("lateral") axis for a cardinal direction. */
export const latOf = (dir) => (DIRS[dir].x !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 });
export const along = (dir, a, l = 0) => {
  const d = DIRS[dir], lat = latOf(dir);
  return [d.x * a + lat.x * l, d.z * a + lat.z * l];
};

export function edgeDist(isl, ux, uz) {
  if (isl.round) return isl.r;
  return Math.min(isl.hw / Math.max(Math.abs(ux), 1e-4), isl.hd / Math.max(Math.abs(uz), 1e-4));
}

/** Bridge or stairs between two islands, edge to edge. */
export function linkIslands(b, A, B) {
  const dx = B.x - A.x, dz = B.z - A.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const a = edgeDist(A, ux, uz) - 0.4, e = edgeDist(B, -ux, -uz) - 0.4;
  const sx = A.x + ux * a, sz = A.z + uz * a;
  const ex = B.x - ux * e, ez = B.z - uz * e;
  const width = rand(2.6, 3.6);
  if (Math.abs(A.y - B.y) < 0.05) b.bridge(sx, sz, ex, ez, A.y, width);
  else b.stairs(sx, sz, ex, ez, A.y, B.y, width);
}

export function buildIsland(b, isl, opts = {}) {
  if (isl.round) b.disc(isl.x, isl.z, isl.r, isl.y, opts);
  else b.platform(isl.x, isl.z, isl.hw * 2, isl.hd * 2, isl.y, opts);
}

export const COMBAT_LAYOUTS = {
  /** Cathedral nave: a long hall of arcaded columns with a raised altar dais. */
  nave(b, ch) {
    const alongX = chance(0.5);
    const L = rand(11, 16), H = rand(5.5, 7.5);
    const map = (u, v) => (alongX ? [u, v] : [v, u]);
    const dims = (du, dv) => (alongX ? [du, dv] : [dv, du]);
    ch.center = { x: 0, y: 0, z: 0 };
    b.platform(0, 0, ...dims(2 * L, 2 * H), 0);
    const end = chance(0.5) ? 1 : -1;
    const daisD = rand(4, 6), daisY = 1.2;
    b.platform(...map(end * (L - daisD / 2), 0), ...dims(daisD, 2 * H - 2.5), daisY, { depth: 1.6, tag: 'dais', corbels: false });
    b.stairs(...map(end * (L - daisD - 2.7), 0), ...map(end * (L - daisD + 0.25), 0), 0, daisY, 3.4, { support: false });
    for (const side of [-1, 1]) {
      const [sx, sz] = map(end * (L - daisD * 0.5), side * (H - 3));
      if (b.isFree(sx, sz, 1)) b.statue(sx, sz, daisY, Math.atan2(-sx, -sz));
      const [cx, cz] = map(end * (L - 1.2), side * 1.8);
      b.candles(cx, cz, daisY, randInt(4, 7));
    }
    const pillarH = rand(11, 15);
    for (const side of [-1, 1]) {
      let prev = null;
      for (let u = -L + 2; u <= L - 2 + 1e-3; u += 4) {
        const [x, z] = map(u, side * (H - 1.1));
        if (!b.isFree(x, z, 0.8)) { prev = null; continue; }
        const onDais = end * u > L - daisD;
        const y = onDais ? daisY : 0;
        b.pillar(x, z, y, pillarH - y, { style: 'cluster' });
        if (prev) b.arcade(prev[0], prev[1], x, z, pillarH - 5, 5);
        prev = [x, z];
        if (chance(0.3)) b.banner(x - (alongX ? 0 : side * 0.6), z - (alongX ? side * 0.6 : 0), pillarH - 6, alongX ? 0 : Math.PI / 2);
      }
    }
    b.stalactites(randInt(8, 16), 0, 0, 16, pillarH + 6, pillarH + 12, 3, 8);
  },

  /** Sunken ring: a circular walkway around a chasm, spokes to a central island. */
  ring(b, ch) {
    const r1 = rand(11.5, 14.5), r0 = r1 - rand(3.6, 5);
    const islandR = rand(4, 5.2), islandY = pick([0, -1.4, 1.4, 0]);
    ch.center = { x: 0, y: islandY, z: 0 };
    b.ring(0, 0, r0, r1, 0);
    b.disc(0, 0, islandR, islandY, { segments: 16 });
    const spokes = randInt(2, 4), base = rand(0, TAU);
    for (let i = 0; i < spokes; i++) {
      const a = base + (i * TAU) / spokes;
      const c = Math.cos(a), s = Math.sin(a);
      const ix = c * (islandR - 0.4), iz = s * (islandR - 0.4), ox = c * (r0 + 0.4), oz = s * (r0 + 0.4);
      if (islandY === 0) b.bridge(ix, iz, ox, oz, 0, rand(2.6, 3.4));
      else b.stairs(ox, oz, ix, iz, 0, islandY, 3);
    }
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU), r = rand(islandR + 1.5, r0 - 1);
      b.crystalCluster(Math.cos(a) * r, Math.sin(a) * r, rand(-18, -8), rand(1.5, 3.2), { light: false, collide: false });
    }
    for (let i = 0; i < 3; i++) {
      const a = base + (i + 0.5) * (TAU / spokes);
      const x = Math.cos(a) * (islandR - 0.9), z = Math.sin(a) * (islandR - 0.9);
      b.crystalCluster(x, z, islandY, rand(0.8, 1.3));
    }
    const pr = (r0 + r1) / 2;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.2;
      const x = Math.cos(a) * pr, z = Math.sin(a) * pr;
      if (b.isFree(x, z, 0.9) && chance(0.7)) b.pillar(x, z, 0, rand(8, 13));
    }
  },

  /** Terraces: stacked tiers climbing towards one side, joined by stairs. */
  terraces(b, ch) {
    const alongX = chance(0.5);
    const map = (u, v) => (alongX ? [u, v] : [v, u]);
    const dims = (du, dv) => (alongX ? [du, dv] : [dv, du]);
    const three = chance(0.6);
    const ranges = three ? [[-12.5, -4], [-4, 4], [4, 12.5]] : [[-12.5, -2.5], [-2.5, 12.5]];
    const asc = chance(0.5) ? 1 : -1;
    const rise = rand(1.8, 2.4);
    const tiers = ranges.map(([u0, u1], k) => {
      const order = asc > 0 ? k : ranges.length - 1 - k;
      return { u0, u1, y: order * rise, hw: rand(7.5, 11.5) };
    });
    for (const t of tiers) b.platform(...map((t.u0 + t.u1) / 2, 0), ...dims(t.u1 - t.u0, t.hw * 2), t.y);
    for (let k = 0; k < tiers.length - 1; k++) {
      const A = tiers[k], B = tiers[k + 1];
      const lower = A.y < B.y ? A : B, upper = A.y < B.y ? B : A;
      const boundary = A.u1;
      const dirToUpper = upper === B ? 1 : -1;
      const len = (upper.y - lower.y) * 2.2;
      const maxV = Math.min(lower.hw, upper.hw) - 2.5;
      for (let s = 0; s < randInt(1, 2); s++) {
        const v = rand(-maxV, maxV);
        b.stairs(...map(boundary - dirToUpper * (len + 0.2), v), ...map(boundary + dirToUpper * 0.3, v), lower.y, upper.y, 3);
      }
    }
    const mid = tiers.find((t) => t.u0 <= 0 && t.u1 >= 0);
    ch.center = { x: 0, y: mid.y, z: 0 };
    const top = tiers.reduce((a, t) => (t.y > a.y ? t : a));
    for (const side of [-1, 1]) {
      const [x, z] = map((top.u0 + top.u1) / 2, side * (top.hw - 2));
      if (b.isFree(x, z, 1)) b.statue(x, z, top.y, Math.atan2(-x, -z));
    }
    for (const t of tiers) {
      for (let i = 0; i < 3; i++) {
        const [x, z] = map(rand(t.u0 + 1.5, t.u1 - 1.5), (chance(0.5) ? 1 : -1) * (t.hw - 1.4));
        if (b.isFree(x, z, 0.9)) b.pillar(x, z, t.y, rand(7, 12));
      }
    }
  },

  /** Shattered causeway: tower-top islands at different heights linked by bridges and stairs. */
  causeway(b, ch) {
    const make = (x, z, y, big = false) => {
      const round = chance(0.5);
      const s = big ? 1.35 : 1;
      return round ? { x, z, y, round, r: rand(3, 4.2) * s } : { x, z, y, round, hw: rand(2.5, 3.8) * s, hd: rand(2.5, 3.8) * s };
    };
    const center = make(0, 0, 0, true);
    const islands = [center];
    for (const dir of Object.keys(DIRS)) {
      const [x, z] = along(dir, rand(9.5, 13));
      islands.push(make(x, z, pick([0, 0, 1.6, -1.6, 2.4])));
    }
    for (let i = 0; i < randInt(1, 3); i++) {
      const a = Math.PI / 4 + randInt(0, 3) * (Math.PI / 2) + rand(-0.3, 0.3);
      const r = rand(9, 13);
      islands.push(make(Math.cos(a) * r, Math.sin(a) * r, pick([0, 1.6, -1.6])));
    }
    // Prim-style tree so everything is reachable; fix heights the stairs couldn't climb.
    const linked = [center];
    const links = [];
    for (const isl of islands.slice(1)) {
      const near = linked.reduce((a, c) => (Math.hypot(c.x - isl.x, c.z - isl.z) < Math.hypot(a.x - isl.x, a.z - isl.z) ? c : a));
      const gap = Math.hypot(near.x - isl.x, near.z - isl.z) - 8;
      if (Math.abs(isl.y - near.y) * 2.3 > gap) isl.y = near.y;
      linked.push(isl);
      links.push([near, isl]);
    }
    for (const isl of islands) buildIsland(b, isl);
    for (const [A, B] of links) linkIslands(b, A, B);
    ch.center = { x: 0, y: 0, z: 0 };
    for (const isl of islands.slice(1)) {
      if (chance(0.6)) {
        const a = rand(0, TAU), rr = (isl.round ? isl.r : Math.min(isl.hw, isl.hd)) - 1.1;
        const x = isl.x + Math.cos(a) * rr, z = isl.z + Math.sin(a) * rr;
        if (b.isFree(x, z, 0.9)) b.crystalCluster(x, z, isl.y, rand(0.9, 1.7));
      }
    }
  },

  /** Crystal grotto: organic overlapping shelves beneath a stalactite-hung vault. */
  grotto(b, ch) {
    ch.center = { x: 0, y: 0, z: 0 };
    ch.enclosed = true;
    const discs = [{ x: 0, z: 0, r: rand(5.5, 7), y: 0 }];
    for (const dir of Object.keys(DIRS)) {
      const [x1, z1] = along(dir, rand(6, 8), rand(-1, 1));
      discs.push({ x: x1, z: z1, r: rand(3.6, 5), y: 0 });
      if (chance(0.6)) {
        const [x2, z2] = along(dir, rand(10.5, 12.5), rand(-1.2, 1.2));
        discs.push({ x: x2, z: z2, r: rand(2.8, 3.8), y: 0 });
      }
    }
    for (let i = 0; i < randInt(4, 7); i++) {
      const a = rand(0, TAU), r = rand(5, 10.5);
      discs.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: rand(2.6, 4.6), y: chance(0.3) ? 0.35 : 0 });
    }
    for (const d of discs) b.disc(d.x, d.z, d.r, d.y, { style: 'rock', segments: 14 });
    b.add(new THREE.CylinderGeometry(32, 32, 4, 20), b.M.rock, composeMatrix(0, 14, 0), { cast: false, receive: true });
    b.stalactites(randInt(40, 60), 0, 0, 22, 12.5, 12.5, 3, 8);
    for (let i = 0; i < randInt(6, 10); i++) {
      const p = b.rimSpot(['hub'], 1, 1.2);
      if (p) b.crystalCluster(p.x, p.z, p.y, rand(1, 2.3));
    }
    for (let i = 0; i < randInt(3, 6); i++) {
      const p = b.rimSpot(['hub'], 0.8, 1);
      if (p) b.stalagmite(p.x, p.z, p.y, rand(1.5, 3.5));
    }
  },

  /** Spires: the crowns of three drowned towers, bridged high over the dark. */
  spires(b, ch) {
    const y23 = pick([0, 1.6, -1.6]);
    const T = [
      { x: rand(-1.5, 1.5), z: -rand(7.5, 9), y: 0, round: true, r: rand(4.8, 6) },
      { x: -rand(7.5, 9.5), z: rand(4, 6.5), y: y23, round: true, r: rand(4.2, 5.5) },
      { x: rand(7.5, 9.5), z: rand(4, 6.5), y: y23, round: true, r: rand(4.2, 5.5) },
    ];
    if (chance(0.5)) for (const t of T) t.z = -t.z;
    for (const t of T) {
      b.disc(t.x, t.z, t.r, t.y, { segments: 12 });
      b.tower(t.x, t.z, t.y - 45, t.y - 1.2, t.r * 1.5, { windows: true, roof: 'none', cast: false, windowChance: 0.25 });
    }
    linkIslands(b, T[0], T[1]);
    linkIslands(b, T[0], T[2]);
    linkIslands(b, T[1], T[2]);
    ch.center = { x: T[0].x, y: 0, z: T[0].z };
    for (const t of T) {
      const a = rand(0, TAU);
      const x = t.x + Math.cos(a) * (t.r - 1.2), z = t.z + Math.sin(a) * (t.r - 1.2);
      if (b.isFree(x, z, 0.9)) (chance(0.5) ? b.crystalCluster(x, z, t.y, rand(1, 1.8)) : b.statue(x, z, t.y, Math.atan2(t.x - x, t.z - z)));
    }
  },
};

// ---- Old Imperial --------------------------------------------------------------

Object.assign(COMBAT_LAYOUTS, {
  /** Cloister: a square of arcaded walks around a sunken garden with a fountain. */
  cloister(b, ch) {
    const S = rand(11.5, 13), W = rand(4.2, 5), gy = -rand(1.2, 1.8);
    ch.center = { x: 0, y: gy, z: 0 };
    const inner = S - W;
    b.platform(0, -S + W / 2, 2 * S, W, 0);
    b.platform(0, S - W / 2, 2 * S, W, 0);
    b.platform(-S + W / 2, 0, W, 2 * inner, 0);
    b.platform(S - W / 2, 0, W, 2 * inner, 0);
    b.platform(0, 0, 2 * inner + 0.4, 2 * inner + 0.4, gy, { tag: 'hub', parapet: false, depth: 30 });
    // Two flights down into the garden, on opposite walks.
    const axis = chance(0.5);
    for (const side of [-1, 1]) {
      const [ax, az] = axis ? [side * (inner + 0.2), rand(-2, 2)] : [rand(-2, 2), side * (inner + 0.2)];
      const len = Math.abs(gy) * 2.3;
      const [bx, bz] = axis ? [ax - side * len, az] : [ax, az - side * len];
      b.stairs(ax, az, bx, bz, 0, gy, 3, { support: false });
      b.reserve(ax, az, 1.8);
    }
    // Fountain.
    b.add(new THREE.CylinderGeometry(1.7, 1.9, 0.6, 12), b.M.trim, composeMatrix(0, gy + 0.3, 0));
    b.add(new THREE.CylinderGeometry(1.45, 1.45, 0.05, 12), b.game.materials.crystal, composeMatrix(0, gy + 0.56, 0), { cast: false });
    b.add(new THREE.CylinderGeometry(0.25, 0.35, 1.8, 8), b.M.stone, composeMatrix(0, gy + 1.2, 0));
    b.add(new THREE.CylinderGeometry(0.8, 0.3, 0.3, 10), b.M.trim, composeMatrix(0, gy + 2.1, 0));
    b.world.addCircle(0, 0, 1.9, gy - 1, gy + 2.3);
    b.lightSpots.push({ kind: 'crystal', pos: new THREE.Vector3(0, gy + 1.2, 0), weight: 2 });
    // Arcades along the inner edge of each walk.
    const colH = rand(6, 7.5);
    for (const [ax, az, bx, bz] of [[-inner, -inner, inner, -inner], [inner, -inner, inner, inner], [inner, inner, -inner, inner], [-inner, inner, -inner, -inner]]) {
      const n = 4;
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
        if (!b.isFree(x, z, 0.5) && !(Math.abs(x) === inner && Math.abs(z) === inner)) { prev = null; continue; }
        b.pillar(x, z, 0, colH, { r: 0.42 });
        if (prev) b.arcade(prev[0], prev[1], x, z, colH - 3.4, 3.4, 0.6);
        prev = [x, z];
      }
    }
    for (let i = 0; i < randInt(2, 4); i++) {
      const a = rand(0, TAU), r = rand(3, inner - 1.5);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (b.isFree(x, z, 1.2)) b.tree(x, z, gy, rand(0.7, 1), chance(0.5));
    }
  },

  /** Basilica: a colonnaded hall with galleried arcades and a raised apse. */
  basilica(b, ch) {
    const alongX = chance(0.5);
    const L = rand(12, 14), H = rand(6, 7);
    const map = (u, v) => (alongX ? [u, v] : [v, u]);
    const dims = (du, dv) => (alongX ? [du, dv] : [dv, du]);
    const end = chance(0.5) ? 1 : -1;
    ch.center = { x: 0, y: 0, z: 0 };
    b.platform(0, 0, ...dims(2 * L, 2 * H), 0);
    const apseY = 1.0;
    const [ax, az] = map(end * (L + 2.5), 0);
    b.disc(ax, az, H - 0.6, apseY, { segments: 16, tag: 'dais' });
    b.stairs(...map(end * (L - 2.6), 0), ...map(end * (L + 0.2), 0), 0, apseY, 3.6, { support: false });
    b.statue(...map(end * (L + 5), 0), apseY, alongX ? (end > 0 ? -Math.PI / 2 : Math.PI / 2) : (end > 0 ? Math.PI : 0));
    b.candles(...map(end * (L + 3), 1.5), apseY, 6);
    b.candles(...map(end * (L + 3), -1.5), apseY, 6);
    const colH = rand(8, 10);
    for (const side of [-1, 1]) {
      let prev = null;
      for (let u = -L + 1.5; u <= L - 1.5 + 1e-3; u += 3.4) {
        const [x, z] = map(u, side * (H - 1));
        if (!b.isFree(x, z, 0.6)) { prev = null; continue; }
        b.pillar(x, z, 0, colH, { r: 0.45 });
        if (prev) {
          b.arcade(prev[0], prev[1], x, z, colH - 3.5, 3.5, 0.7);
          b.arcade(prev[0], prev[1], x, z, colH + 0.4, 3, 0.5);
        }
        prev = [x, z];
      }
    }
  },

  // ---- Titan-hewn -----------------------------------------------------------------

  /** Henge: rings of trilithons around a sacrificial altar stone. */
  henge(b, ch) {
    const r0 = rand(12.5, 14);
    ch.center = { x: 0, y: 0.45, z: 0 };
    b.disc(0, 0, r0, 0, { segments: 22 });
    b.disc(0, 0, 3.4, 0.45, { segments: 10, parapet: false, depth: 2, tag: 'dais' });
    const M = b.M;
    b.add(worldBoxGeometry(2.4, 0.8, 1.2), M.rock, composeMatrix(0, 0.85, -1.2, 0, rand(-0.2, 0.2)));
    b.world.addBox(-1.2, -1.8, 1.2, -0.6, 0, 1.3);
    b.reserve(0, -1.2, 1.4);
    b.lightSpots.push({ kind: 'crystal', pos: new THREE.Vector3(0, 1.8, -1.2), weight: 2 });
    const trilithon = (a, r, h) => {
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const tx = -Math.sin(a) * 1.3, tz = Math.cos(a) * 1.3;
      if (!b.isFree(cx + tx, cz + tz, 0.8) || !b.isFree(cx - tx, cz - tz, 0.8)) return;
      b.pillar(cx + tx, cz + tz, 0, h, { r: 0.42 });
      b.pillar(cx - tx, cz - tz, 0, h, { r: 0.42 });
      b.add(worldBoxGeometry(3.9, 0.9, 1.1), M.rock, composeMatrix(cx, h + 0.95, cz, 0, -a + Math.PI / 2, rand(-0.04, 0.04)));
    };
    const n = randInt(7, 9), base = rand(0, TAU);
    for (let i = 0; i < n; i++) trilithon(base + (i / n) * TAU, r0 - 2.2, rand(4.2, 5.2));
    for (let i = 0; i < 5; i++) trilithon(base + 0.3 + (i / 5) * TAU * 0.8, 6.8, rand(5.8, 6.8));
    for (let i = 0; i < randInt(3, 6); i++) {
      const p = b.randomSpot(['hub'], 1, 1.5);
      if (p) b.add(worldBoxGeometry(rand(2.5, 3.8), 0.9, 1), M.rock, composeMatrix(p.x, p.y + 0.3, p.z, rand(-0.1, 0.1), rand(0, TAU), 1.4 + rand(-0.1, 0.1)));
    }
  },

  /** Ziggurat: a stepped temple mount climbed by broad stairs, the prize at its crown. */
  ziggurat(b, ch) {
    const t0 = rand(12, 13), rise = rand(1.5, 1.8);
    const tiers = [t0, t0 * 0.62, t0 * 0.27];
    tiers.forEach((hs, i) => b.platform(0, 0, hs * 2, hs * 2, i * rise, { depth: i ? rise + 0.4 : 45, tag: 'hub', corbels: i === 0 }));
    ch.center = { x: 0, y: rise * 2, z: 0 };
    const axis = chance(0.5);
    const len = rise * 1.9;
    for (let i = 0; i < 2; i++) {
      for (const side of [-1, 1]) {
        const inner = tiers[i + 1] - 0.3, outer = tiers[i + 1] + len;
        const lat = rand(-1, 1);
        const [ax, az] = axis ? [side * outer, lat] : [lat, side * outer];
        const [bx, bz] = axis ? [side * inner, lat] : [lat, side * inner];
        b.stairs(ax, az, bx, bz, i * rise, (i + 1) * rise, 3.4, { support: false });
      }
    }
    // Obelisks at the corners of the lower terrace, braziers on the middle one.
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * (t0 - 1.6), z = sz * (t0 - 1.6);
      if (b.isFree(x, z, 1)) {
        b.add(GEO_OBELISK, b.M.rock, composeMatrix(x, 0, z, 0, Math.PI / 4, 0, 0.8, rand(6, 9), 0.8));
        b.world.addCircle(x, z, 0.8, -1, 9);
        b.reserve(x, z, 1);
      }
      const bx = sx * (tiers[1] - 1.2), bz = sz * (tiers[1] - 1.2);
      if (chance(0.7) && b.isFree(bx, bz, 0.6)) b.brazier(bx, bz, rise);
    }
  },
});

const GEO_OBELISK = new THREE.CylinderGeometry(0.25, 0.7, 1, 4).translate(0, 0.5, 0);

export const SPECIAL_LAYOUTS = {
  /** The merchant's bazaar: rugs, a patched canopy, crates of curios and hanging lamps. */
  bazaar(b, ch) {
    ch.center = { x: 0, y: 0, z: 0 };
    ch.enclosed = false;
    b.disc(0, 0, 9, 0, { segments: 20 });
    const entry = Object.keys(DIRS).find((d) => ch.neighbors[d]) ?? 's';
    const back = DIRS[entry].opposite;
    const [mx, mz] = along(back, 3.4);
    const d = DIRS[entry];
    ch.shopSpot = { x: mx, z: mz, facing: Math.atan2(d.x, d.z) };
    b.reserve(mx, mz, 1.6);
    const M = b.M;
    const rugs = [b.game.materials.cloth, b.game.materials.goldCloth, b.game.materials.arcaneCloth];
    for (let i = 0; i < 4; i++) {
      const [rx, rz] = along(back, rand(-2, 3.5), rand(-3.5, 3.5));
      b.add(new THREE.BoxGeometry(rand(1.8, 3), 0.03, rand(1.2, 2)), pick(rugs), composeMatrix(rx, 0.015 + i * 0.004, rz, 0, rand(0, TAU)), { cast: false });
    }
    // Canopy on four crooked poles over the merchant.
    const lat = latOf(back);
    const poles = [];
    for (const [a, l] of [[0.9, -3.7], [0.9, 3.7], [5.6, -2.8], [5.6, 2.8]]) {
      const [px, pz] = along(back, a, l);
      b.add(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 5), M.bark || b.game.materials.bark, composeMatrix(px, 2.3, pz, rand(-0.05, 0.05), 0, rand(-0.05, 0.05)));
      b.world.addCircle(px, pz, 0.2, -1, 4.6);
      poles.push([px, pz]);
    }
    const [cx, cz] = along(back, 3.3);
    b.add(new THREE.ConeGeometry(3.9, 1.6, 4, 1, true), b.game.materials.arcaneCloth, composeMatrix(cx, 5.6, cz, 0, Math.PI / 4 + Math.atan2(lat.x, lat.z), 0, 1, 1, 0.75), { cast: true });
    for (const [px, pz] of poles) {
      b.add(new THREE.BoxGeometry(0.06, 1.1, 0.06), M.iron, composeMatrix(px, 3.9, pz));
      b.add(new THREE.BoxGeometry(0.22, 0.3, 0.22), b.game.materials.arcane, composeMatrix(px, 3.3, pz), { cast: false, receive: false });
      b.lightSpots.push({ kind: 'warm', color: 0xc090ff, pos: new THREE.Vector3(px, 3.3, pz), weight: 1.5, intensity: 5, distance: 8 });
    }
    // Crates, barrels, piles of junk and candles around the rim.
    for (let i = 0; i < 9; i++) {
      const p = b.rimSpot(['hub'], 0.8, 1.2);
      if (!p) continue;
      if (chance(0.5)) {
        const s = rand(0.6, 1);
        b.add(new THREE.BoxGeometry(s, s, s), b.game.materials.bark, composeMatrix(p.x, p.y + s / 2, p.z, 0, rand(0, TAU)));
        if (chance(0.5)) b.add(new THREE.BoxGeometry(s * 0.7, s * 0.7, s * 0.7), b.game.materials.bark, composeMatrix(p.x, p.y + s * 1.35, p.z, 0, rand(0, TAU)));
        b.world.addCircle(p.x, p.z, s * 0.7, p.y - 1, p.y + s * 2);
      } else {
        b.add(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 8), b.game.materials.bark, composeMatrix(p.x, p.y + 0.45, p.z));
        b.add(new THREE.CylinderGeometry(0.37, 0.37, 0.06, 8), M.iron, composeMatrix(p.x, p.y + 0.7, p.z));
        b.world.addCircle(p.x, p.z, 0.45, p.y - 1, p.y + 1);
      }
      b.reserve(p.x, p.z, 0.9);
    }
    for (let i = 0; i < 4; i++) {
      const p = b.randomSpot(['hub'], 0.5);
      if (p) b.candles(p.x, p.z, p.y, randInt(3, 6));
    }
    b.lightShaft(mx, mz, 0, 1.2);
  },

  /** Starting shrine: a round sanctum with a sword planted in embers. */
  shrine(b, ch) {
    ch.center = { x: 0, y: 0, z: 0 };
    b.disc(0, 0, 8, 0, { segments: 24 });
    const coals = 7;
    for (let i = 0; i < coals; i++) {
      const a = (i / coals) * TAU;
      b.add(new THREE.DodecahedronGeometry(0.25, 0), b.M.rock, composeMatrix(Math.cos(a) * 0.5, 0.12, Math.sin(a) * 0.5, rand(0, 3), rand(0, 3), 0));
    }
    b.add(new THREE.CylinderGeometry(0.45, 0.55, 0.12, 8), b.M.flame, composeMatrix(0, 0.06, 0), { cast: false, receive: false });
    b.add(new THREE.BoxGeometry(0.08, 1.3, 0.02), b.M.iron, composeMatrix(0, 0.75, 0, 0, 0, 0.12));
    b.add(new THREE.BoxGeometry(0.34, 0.05, 0.06), b.M.iron, composeMatrix(0.13, 1.3, 0, 0, 0, 0.12));
    b.world.addCircle(0, 0, 0.7, -1, 1.5);
    b.lightSpots.push({ kind: 'warm', pos: new THREE.Vector3(0, 1.2, 0), weight: 3 });
    b.emitters.push({ kind: 'fire', pos: new THREE.Vector3(0, 0.2, 0), spread: 0.35 });
    let prev = null, first = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const x = Math.cos(a) * 6.2, z = Math.sin(a) * 6.2;
      b.pillar(x, z, 0, 12, { style: 'cluster' });
      if (prev) b.arcade(prev[0], prev[1], x, z, 7, 5);
      prev = [x, z];
      first ||= [x, z];
    }
    b.arcade(prev[0], prev[1], first[0], first[1], 7, 5);
    b.stalactites(12, 0, 0, 10, 20, 24, 3, 8);
    b.lightShaft(0, 0, 0, 1.4);
  },

  /** Reliquary: a hushed octagon where a relic already waits. */
  reliquary(b, ch) {
    ch.center = { x: 0, y: 0, z: 0 };
    b.disc(0, 0, 7, 0, { segments: 8 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const x = Math.cos(a) * 5, z = Math.sin(a) * 5;
      if (!b.isFree(x, z, 1)) continue;
      if (i % 2) b.statue(x, z, 0, Math.atan2(-x, -z));
      else b.crystalCluster(x, z, 0, rand(1.1, 1.8));
    }
    b.lightShaft(0, 0, 0, 1.2);
  },

  /** Guardian's arena: a vast drum ringed with titanic columns. */
  arena(b, ch) {
    ch.center = { x: 0, y: 0, z: 0 };
    b.disc(0, 0, 14, 0, { segments: 28 });
    let prev = null;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      const x = Math.cos(a) * 12.4, z = Math.sin(a) * 12.4;
      if (!b.isFree(x, z, 1)) { prev = null; continue; }
      b.pillar(x, z, 0, 18, { style: 'cluster', r: 0.7 });
      if (prev) b.arcade(prev[0], prev[1], x, z, 12, 6, 1);
      prev = [x, z];
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const x = Math.cos(a) * 18, z = Math.sin(a) * 18;
      b.add(worldBoxGeometry(3, 50, 3), b.M.brick, composeMatrix(x, -25 - 2, z), { cast: false });
      b.crystalCluster(x, z, -2, rand(2.6, 3.4), { collide: false });
    }
    b.stalactites(20, 0, 0, 20, 24, 30, 5, 12);
  },
};

