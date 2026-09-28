import * as THREE from 'three';
import { CONFIG, DIRS, RoomState, FLOOR_THEMES } from './config.js';
import { World } from './physics.js';
import { Builder, samplePoint } from './architecture.js';
import { rand, randInt, pick, chance, shuffle, flicker, composeMatrix, archWallGeometry, worldBoxGeometry, TAU } from './util.js';
import { Pedestal, Descent, rollItem } from './items.js';
import { WeaponDrop } from './loot.js';
import { rollWeapon } from './weapons.js';
import { Skeleton, Warden, pickEnemyType, separateEnemies } from './enemies.js';

const R = CONFIG.gateDistance;

/** Perpendicular ("lateral") axis for a cardinal direction. */
const latOf = (dir) => (DIRS[dir].x !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 });
const along = (dir, a, l = 0) => {
  const d = DIRS[dir], lat = latOf(dir);
  return [d.x * a + lat.x * l, d.z * a + lat.z * l];
};

// ============================================================================
// Gate — an archway in a great wall, closed by a portcullis during combat.
// ============================================================================

class Gate {
  constructor(chamber, dir, y, leadsTo) {
    const M = chamber.game.materials;
    this.dir = dir;
    this.y = y;
    this.plane = R + 2.5;
    this.progress = 1;
    this.target = 1;
    const d = DIRS[dir];
    this.group = new THREE.Group();
    this.group.position.set(d.x * this.plane, y, d.z * this.plane);
    this.group.rotation.y = Math.atan2(-d.x, -d.z);
    this.bars = new THREE.Group();
    const count = 9;
    for (let i = 0; i < count; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.6, 0.1), M.iron);
      bar.position.set(-1.6 + (3.2 * i) / (count - 1), 2.3, 0);
      bar.castShadow = true;
      this.bars.add(bar);
    }
    for (const by of [0.1, 1.6, 3.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 0.14), M.iron);
      rail.position.y = by;
      this.bars.add(rail);
    }
    for (let i = 0; i < count; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 4), M.iron);
      spike.position.set(-1.6 + (3.2 * i) / (count - 1), -0.1, 0);
      spike.rotation.x = Math.PI;
      this.bars.add(spike);
    }
    this.group.add(this.bars);

    const runeColor = leadsTo.type === 'boss' ? 0xff2a14 : leadsTo.type === 'treasure' ? 0xffc050 : null;
    if (runeColor) {
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: runeColor, fog: false }));
      rune.position.set(0, 5.4, 0.9);
      this.group.add(rune);
    }

    const lat = latOf(dir);
    const [cx, cz] = [d.x * this.plane, d.z * this.plane];
    this.blocker = chamber.world.addBox(cx - lat.x * 1.9 - d.x * 0.3, cz - lat.z * 1.9 - d.z * 0.3, cx + lat.x * 1.9 + d.x * 0.3, cz + lat.z * 1.9 + d.z * 0.3, y - 1, y + 5);
    this.setProgress(1);
    chamber.group.add(this.group);
  }

  get isOpen() { return this.progress > 0.9; }
  setOpen(open) { this.target = open ? 1 : 0; }

  setProgress(p) {
    this.progress = p;
    this.bars.position.y = p * 4.5;
    this.blocker.enabled = p < 0.9;
  }

  update(dt) {
    if (this.progress === this.target) return;
    const speed = this.target > this.progress ? 0.8 : 4.5;
    this.setProgress(this.target > this.progress
      ? Math.min(this.target, this.progress + speed * dt)
      : Math.max(this.target, this.progress - speed * dt));
  }
}

// ============================================================================
// Layouts — each builds a distinct walkable "hub" and sets chamber.center.
// ============================================================================

function edgeDist(isl, ux, uz) {
  if (isl.round) return isl.r;
  return Math.min(isl.hw / Math.max(Math.abs(ux), 1e-4), isl.hd / Math.max(Math.abs(uz), 1e-4));
}

/** Bridge or stairs between two islands, edge to edge. */
function linkIslands(b, A, B) {
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

function buildIsland(b, isl, opts = {}) {
  if (isl.round) b.disc(isl.x, isl.z, isl.r, isl.y, opts);
  else b.platform(isl.x, isl.z, isl.hw * 2, isl.hd * 2, isl.y, opts);
}

const COMBAT_LAYOUTS = {
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

const SPECIAL_LAYOUTS = {
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

// ============================================================================
// Chamber
// ============================================================================

export class Chamber {
  constructor(game, floor, gx, gy, type) {
    this.game = game;
    this.floor = floor;
    this.gx = gx;
    this.gy = gy;
    this.type = type;
    this.neighbors = { n: null, s: null, e: null, w: null };
    this.state = type === 'combat' || type === 'boss' ? RoomState.DORMANT : RoomState.CLEARED;
    this.visited = false;
    this.seen = false;
    this.built = false;
    this.gates = {};
    this.enemies = [];
    this.pedestal = null;
    this.descent = null;
    this.stateTime = 0;
    this.center = { x: 0, y: 0, z: 0 };
    this.loot = [];
    this.interactables = [];
  }

  build() {
    if (this.built) return;
    this.built = true;
    const game = this.game;
    this.world = new World();
    this.group = new THREE.Group();
    this.group.visible = false;
    game.scene.add(this.group);
    const b = new Builder(game, this);

    let layout;
    if (this.type === 'start') layout = SPECIAL_LAYOUTS.shrine;
    else if (this.type === 'treasure') layout = SPECIAL_LAYOUTS.reliquary;
    else if (this.type === 'boss') layout = SPECIAL_LAYOUTS.arena;
    else layout = COMBAT_LAYOUTS[this.floor.nextLayout()];
    this.layoutName = layout.name;
    layout(b, this);

    for (const dir of Object.keys(DIRS)) if (this.neighbors[dir]) this.addGateway(b, dir);
    this.decorate(b);
    b.vista();
    b.finish(this.group);

    this.lightSpots = b.lightSpots;
    this.emitters = b.emitters;
    this.buildFlames(b.flames);

    if (this.type === 'treasure') {
      this.pedestal = new Pedestal(this, rollItem(game.player), this.center.x, this.center.y, this.center.z, true);
      new WeaponDrop(game, this, rollWeapon(game.depth, 1), new THREE.Vector3(this.center.x + 2.2, this.center.y, this.center.z + 1.2));
    }
  }

  /** Farthest walkable point along a gate's axis (within reach of the landing). */
  findAnchor(dir) {
    let best = null;
    for (let a = 0; a <= R - 4.2; a += 0.25) {
      const [x, z] = along(dir, a);
      let top = null;
      for (const s of this.world.surfaces) {
        if (s.tag === 'landing') continue;
        const h = this.world.heightOf(s, x, z);
        if (h !== null && (top === null || h > top)) top = h;
      }
      if (top !== null) best = { along: a, y: top };
    }
    return best;
  }

  addGateway(b, dir) {
    let anchor = this.findAnchor(dir);
    if (!anchor) {
      // Nothing on this axis: raise a balcony on it and bridge back to the nearest structure.
      const [bx, bz] = along(dir, 8);
      b.platform(bx, bz, 5, 5, this.center.y);
      const hub = this.world.surfaces.filter((s) => s.tag === 'hub' && s.kind !== 'ring')
        .reduce((a, s) => (Math.hypot(s.cx - bx, s.cz - bz) < Math.hypot(a.cx - bx, a.cz - bz) ? s : a));
      linkIslands(b, { x: bx, z: bz, y: this.center.y, round: false, hw: 2.5, hd: 2.5 },
        { x: hub.cx, z: hub.cz, y: hub.y, round: hub.kind === 'disc', r: hub.r, hw: hub.hw, hd: hub.hd });
      anchor = { along: 10.5, y: this.center.y };
    }
    const landingInner = R - 2.5;
    const gap = landingInner - anchor.along;
    let gateY = anchor.y;
    if (gap > 7 && chance(0.55)) gateY = anchor.y + pick([-2.4, -1.6, 1.6, 2.4]);
    let stairsLen = Math.abs(gateY - anchor.y) * 2.3;
    if (stairsLen > gap - 1.5) { gateY = anchor.y; stairsLen = 0; }

    const d = DIRS[dir];
    const vertical = d.x === 0;
    const [lx, lz] = along(dir, R);
    b.platform(lx, lz, vertical ? 7 : 5, vertical ? 5 : 7, gateY, { tag: 'landing' });

    if (gap > 0.2) {
      const width = rand(3, 4.4);
      const a0 = anchor.along - 0.4, a1 = landingInner + 0.4;
      const seg = (s0, s1, y0, y1) => {
        if (s1 - s0 < 0.4) return;
        const [x0, z0] = along(dir, s0), [x1, z1] = along(dir, s1);
        if (y0 === y1) b.bridge(x0, z0, x1, z1, y0, width);
        else b.stairs(x0, z0, x1, z1, y0, y1, width);
      };
      if (stairsLen > 0 && chance(0.5)) {
        seg(a0, a0 + stairsLen, anchor.y, gateY);
        seg(a0 + stairsLen - 0.2, a1, gateY, gateY);
      } else if (stairsLen > 0) {
        seg(a0, a1 - stairsLen + 0.2, anchor.y, anchor.y);
        seg(a1 - stairsLen, a1, anchor.y, gateY);
      } else {
        seg(a0, a1, gateY, gateY);
        if (gap > 9 && chance(0.4)) {
          const mid = (a0 + a1) / 2;
          const [mx, mz] = along(dir, mid);
          b.platform(mx, mz, vertical ? 6.5 : 4.5, vertical ? 4.5 : 6.5, gateY, { tag: 'balcony' });
          const [sx, sz] = along(dir, mid, (chance(0.5) ? 1 : -1) * 2.4);
          chance(0.5) ? b.crystalCluster(sx, sz, gateY, rand(0.8, 1.3)) : b.lanternPost(sx, sz, gateY);
        }
      }
    }

    this.buildGatehouse(b, dir, gateY);
    const gate = new Gate(this, dir, gateY, this.neighbors[dir]);
    this.gates[dir] = { gate, y: gateY };
  }

  buildGatehouse(b, dir, y) {
    const M = b.M;
    const d = DIRS[dir];
    const plane = R + 2.5;
    const [cx, cz] = along(dir, plane);
    const rot = Math.atan2(-d.x, -d.z);
    const wall = archWallGeometry(16, 12, 1.6, [{ cx: 0, halfW: 1.9, spring: 3.2, peak: 5.0 }]);
    b.add(wall, M.brick, composeMatrix(cx, y, cz, 0, rot));
    b.add(worldBoxGeometry(17, 0.6, 2.2), M.trim, composeMatrix(cx, y + 12, cz, 0, rot));
    b.add(worldBoxGeometry(16, 40, 1.6), M.brick, composeMatrix(cx, y - 20.3, cz, 0, rot));
    for (const side of [-1, 1]) {
      const [tx, tz] = along(dir, plane + 0.6, side * 8.5);
      b.tower(tx, tz, y - 45, y + rand(14, 20), 3, { windowChance: 0.3 });
    }
    // Tunnel beyond the portcullis.
    const tunnelLen = 6;
    const [fx, fz] = along(dir, plane + tunnelLen / 2);
    b.world.addRect(fx, fz, vertical(dir) ? 1.9 : tunnelLen / 2 + 0.3, vertical(dir) ? tunnelLen / 2 + 0.3 : 1.9, y, { parapet: false, tag: 'tunnel', thick: 2 });
    b.add(worldBoxGeometry(vertical(dir) ? 3.8 : tunnelLen, 0.35, vertical(dir) ? tunnelLen : 3.8, 8), M.floor, composeMatrix(fx, y - 0.175, fz));
    const [ex, ez] = along(dir, plane + tunnelLen + 0.5);
    b.add(new THREE.BoxGeometry(vertical(dir) ? 4 : 0.5, 6, vertical(dir) ? 0.5 : 4), M.void, composeMatrix(ex, y + 3, ez), { cast: false, receive: false });
    for (const side of [-1, 1]) {
      const [wx, wz] = along(dir, plane + tunnelLen / 2, side * 2.2);
      b.add(worldBoxGeometry(vertical(dir) ? 0.6 : tunnelLen, 5.2, vertical(dir) ? tunnelLen : 0.6), M.brick, composeMatrix(wx, y + 2.6, wz));
    }
    b.add(worldBoxGeometry(vertical(dir) ? 5 : tunnelLen, 0.6, vertical(dir) ? tunnelLen : 5), M.brick, composeMatrix(fx, y + 5.3, fz));
    // Colliders: wall halves either side of the arch, and the tunnel sides.
    const boxAlong = (a0, a1, l0, l1) => {
      const [x0, z0] = along(dir, a0, l0), [x1, z1] = along(dir, a1, l1);
      b.world.addBox(x0, z0, x1, z1, y - 1, y + 12);
    };
    boxAlong(plane - 0.8, plane + 0.8, -8, -1.9);
    boxAlong(plane - 0.8, plane + 0.8, 1.9, 8);
    boxAlong(plane, plane + tunnelLen + 1, -2.6, -1.9);
    boxAlong(plane, plane + tunnelLen + 1, 1.9, 2.6);
    boxAlong(plane + tunnelLen + 0.2, plane + tunnelLen + 1, -2, 2);
    // Torches either side of the arch, facing the chamber.
    for (const side of [-1, 1]) {
      const [sx, sz] = along(dir, plane - 1.0, side * 3.1);
      b.add(new THREE.BoxGeometry(0.12, 0.5, 0.12), M.iron, composeMatrix(sx, y + 3.2, sz));
      b.add(new THREE.BoxGeometry(0.16, 0.2, 0.16), M.flame, composeMatrix(sx, y + 3.55, sz), { cast: false, receive: false });
      b.emitters.push({ kind: 'fire', pos: new THREE.Vector3(sx, y + 3.6, sz), spread: 0.05, rate: 6 });
    }
    const [gx, gz] = along(dir, plane - 1.4);
    b.lightSpots.push({ kind: 'warm', pos: new THREE.Vector3(gx, y + 3.6, gz), weight: 1.5, gate: true });
  }

  decorate(b) {
    const hubTags = ['hub', 'dais'];
    const place = (fn, count, r = 0.8, rim = true) => {
      for (let i = 0; i < count; i++) {
        const p = rim ? b.rimSpot(hubTags, r) : b.randomSpot(hubTags, r);
        if (p) fn(p);
      }
    };
    const combat = this.type === 'combat';
    place((p) => b.crystalCluster(p.x, p.z, p.y, rand(0.8, 1.9)), combat ? randInt(2, 5) : 2, 1);
    place((p) => b.brazier(p.x, p.z, p.y), combat ? randInt(0, 2) : 1, 0.8);
    place((p) => b.lanternPost(p.x, p.z, p.y), randInt(0, 2), 0.6);
    place((p) => b.statue(p.x, p.z, p.y), chance(0.4) ? 1 : 0, 1);
    place((p) => b.bones(p.x, p.z, p.y), randInt(3, 7), 0.5, false);
    place((p) => b.candles(p.x, p.z, p.y, randInt(3, 6)), randInt(1, 3), 0.5, false);
    place((p) => b.chain(p.x, p.z, p.y + 16, p.y + rand(3, 6)), randInt(0, 4), 0.3, false);
    if (!this.enclosed) b.stalactites(randInt(10, 20), 0, 0, 26, 18, 26, 4, 12);
    if (combat && chance(0.35)) {
      const p = b.randomSpot(hubTags, 1.2);
      if (p) b.lightShaft(p.x, p.z, p.y, rand(1, 1.6));
    }
    // Blood where the last knight fell.
    for (let i = 0; i < randInt(1, 4); i++) {
      const p = b.randomSpot(hubTags, 0.6);
      if (!p) continue;
      const g = new THREE.CircleGeometry(rand(0.4, 1.1), 9).rotateX(-Math.PI / 2);
      b.add(g, b.M.blood, composeMatrix(p.x, p.y + 0.012, p.z, 0, rand(0, TAU), 0, rand(0.7, 1.4), 1, 1), { cast: false, receive: true });
    }
  }

  buildFlames(flames) {
    if (!flames.length) return;
    this.flameMesh = new THREE.InstancedMesh(this.game.flameGeo, this.game.materials.flame, flames.length);
    this.flameData = flames;
    this.flameMesh.frustumCulled = false;
    this.group.add(this.flameMesh);
    this.updateFlames(0);
  }

  updateFlames(t) {
    if (!this.flameMesh) return;
    const m = new THREE.Matrix4();
    this.flameData.forEach((f, i) => {
      m.compose(f.pos, new THREE.Quaternion(), new THREE.Vector3(1, 0.8 + 0.35 * flicker(t * 1.5, f.seed), 1));
      this.flameMesh.setMatrixAt(i, m);
    });
    this.flameMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- State machine -------------------------------------------------------

  enter() {
    this.visited = true;
    this.seen = true;
    for (const n of Object.values(this.neighbors)) if (n) n.seen = true;
    this.group.visible = true;
    if (this.state === RoomState.DORMANT) {
      this.state = RoomState.SEALING;
      this.stateTime = 0;
      this.sealed = false;
    }
  }

  exit() { this.group.visible = false; }

  seal() {
    this.sealed = true;
    for (const g of Object.values(this.gates)) g.gate.setOpen(false);
    this.game.audio.play('slam');
    this.game.shake(0.35);
    this.spawnEnemies();
    if (this.type === 'boss') this.game.hud.banner(this.enemies[0].name, 'warn', 2.6);
  }

  spawnPoint(minDist) {
    const W = this.world;
    const surfaces = W.surfaces.filter((s) => s.tag === 'hub' || s.tag === 'dais');
    const pp = this.game.player.pos;
    for (let i = 0; i < 60; i++) {
      const s = pick(surfaces);
      const p = samplePoint(s, 1.2);
      if (!p) continue;
      const g = W.groundAt(p.x, p.z);
      if (g === null || Math.abs(g - p.y) > 0.05) continue;
      if (Math.hypot(p.x - pp.x, p.z - pp.z) < minDist) continue;
      if (W.circles.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.8)) continue;
      if (this.enemies.some((e) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 1.6)) continue;
      return p;
    }
    return { ...this.center };
  }

  spawnEnemies() {
    const game = this.game;
    const depth = game.depth;
    if (this.type === 'boss') {
      const pp = game.player.pos;
      const bx = -Math.sign(pp.x) * (Math.abs(pp.x) > Math.abs(pp.z) ? 5 : 0);
      const bz = -Math.sign(pp.z) * (Math.abs(pp.z) >= Math.abs(pp.x) ? 5 : 0);
      const boss = new Warden(game, this, bx, 0, bz, FLOOR_THEMES[(depth - 1) % FLOOR_THEMES.length].boss);
      this.enemies.push(boss);
      game.hud.showBoss(boss);
      for (let i = 0; i < Math.min(depth - 1, 3); i++) {
        const p = this.spawnPoint(7);
        this.enemies.push(new Skeleton(game, this, p.x, p.y, p.z));
      }
      return;
    }
    const count = Math.min(7, 2 + depth + randInt(0, 2));
    for (let i = 0; i < count; i++) {
      const p = this.spawnPoint(7.5);
      const Type = pickEnemyType(depth);
      this.enemies.push(new Type(game, this, p.x, p.y, p.z));
    }
  }

  onCleared() {
    const game = this.game;
    this.state = RoomState.CLEARED;
    for (const g of Object.values(this.gates)) g.gate.setOpen(true);
    game.audio.play('open');
    game.slowmo = 0.8;
    for (const [dir, g] of Object.entries(this.gates)) {
      const [x, z] = along(dir, R + 1.5);
      game.glow.burst(new THREE.Vector3(x, g.y + 2, z), 24, () => ({
        vel: new THREE.Vector3(rand(-2, 2), rand(0.5, 3), rand(-2, 2)), life: rand(0.8, 1.6), size: rand(0.05, 0.12), color: 0xffd08a, drag: 1.5,
      }));
    }
    const c = this.center;
    if (this.type === 'boss') {
      game.hud.banner('GUARDIAN FELLED', '', 3.2);
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z + 2.5);
      this.descent = new Descent(this, c.x, c.y, c.z - 4.5);
    } else {
      game.hud.banner('CHAMBER PURGED', '', 2.2);
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z);
    }
  }

  update(dt) {
    this.stateTime += dt;
    for (const g of Object.values(this.gates)) g.gate.update(dt);

    if (this.state === RoomState.SEALING) {
      if (!this.sealed && this.stateTime > 0.6) this.seal();
      if (this.sealed && Object.values(this.gates).every((g) => g.gate.progress === 0)) this.state = RoomState.COMBAT;
    }

    for (const e of this.enemies) e.update(dt);
    separateEnemies(this.enemies);
    this.enemies = this.enemies.filter((e) => !e.removed);
    if (this.state === RoomState.COMBAT && this.enemies.length === 0) this.onCleared();

    this.pedestal?.update(dt);
    this.descent?.update(dt);
    for (const l of this.loot) l.update(dt);

    const t = this.game.time;
    this.updateFlames(t);
    const glow = this.game.glow;
    for (const em of this.emitters) {
      if (em.kind === 'fire' && Math.random() < dt * (em.rate ?? 22)) {
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + rand(-em.spread, em.spread), em.pos.y, em.pos.z + rand(-em.spread, em.spread)),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.2, 2.6), rand(-0.3, 0.3)), life: rand(0.4, 0.9), size: rand(0.05, 0.12), color: pick([0xff8a2a, 0xffb040, 0xff5a1a]),
        });
      } else if (em.kind === 'motes' && Math.random() < dt * 8) {
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + rand(-em.spread, em.spread), em.pos.y + rand(0.5, 6), em.pos.z + rand(-em.spread, em.spread)),
          vel: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.2, 0.05), rand(-0.1, 0.1)), life: rand(2, 4), size: 0.03, color: 0xbfb49a,
        });
      }
    }
  }

  /** Called every frame with the player's position; returns the direction they left by, if any. */
  exitDirection(pos) {
    for (const [dir, g] of Object.entries(this.gates)) {
      const d = DIRS[dir];
      if (g.gate.isOpen && pos.x * d.x + pos.z * d.z > R + 2.5 + 3.2) return dir;
    }
    return null;
  }

  entryPose(dir) {
    const g = this.gates[dir];
    const d = DIRS[dir];
    const [x, z] = along(dir, R - 0.6);
    return { x, y: g ? g.y : 0, z, yaw: Math.atan2(d.x, d.z) };
  }

  dispose() {
    if (!this.group) return;
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry !== this.game.flameGeo && !o.userData.shared) o.geometry.dispose();
    });
  }
}

function vertical(dir) { return DIRS[dir].x === 0; }

// ============================================================================
// Dungeon floor — Isaac-style grid of chambers
// ============================================================================

export class DungeonFloor {
  constructor(game, depth) {
    this.game = game;
    this.depth = depth;
    this.rooms = new Map();
    this.layoutBag = [];
    this.generate();
  }

  /** Deal combat layouts from a shuffled bag so neighbours rarely repeat. */
  nextLayout() {
    if (!this.layoutBag.length) this.layoutBag = shuffle(Object.keys(COMBAT_LAYOUTS));
    return this.layoutBag.pop();
  }

  key(x, y) { return `${x},${y}`; }
  get(x, y) { return this.rooms.get(this.key(x, y)); }

  generate() {
    const target = Math.min(7 + this.depth * 2, 15);
    for (let attempt = 0; attempt < 200; attempt++) {
      const cells = new Map([[this.key(0, 0), [0, 0]]]);
      const queue = [[0, 0]];
      for (let guard = 0; queue.length && cells.size < target && guard < 500; guard++) {
        const [cx, cy] = queue.shift();
        for (const dir of shuffle(Object.keys(DIRS))) {
          const nx = cx + DIRS[dir].dx, ny = cy + DIRS[dir].dy;
          const k = this.key(nx, ny);
          if (cells.has(k) || cells.size >= target || Math.random() < 0.45) continue;
          const touching = Object.values(DIRS).filter((d) => cells.has(this.key(nx + d.dx, ny + d.dy))).length;
          if (touching > 1) continue;
          cells.set(k, [nx, ny]);
          queue.push([nx, ny]);
        }
        if (!queue.length && cells.size < target) queue.push(pick([...cells.values()]));
      }
      if (cells.size < target) continue;

      const neighborCount = ([x, y]) => Object.values(DIRS).filter((d) => cells.has(this.key(x + d.dx, y + d.dy))).length;
      const deadEnds = [...cells.values()].filter((c) => (c[0] || c[1]) && neighborCount(c) === 1);
      if (deadEnds.length < 2) continue;
      const dist = this.distances(cells);
      deadEnds.sort((a, b) => dist.get(this.key(...b)) - dist.get(this.key(...a)));
      const boss = deadEnds[0];
      if (dist.get(this.key(...boss)) < 3) continue;
      const treasure = deadEnds[1 + Math.floor(Math.random() * (deadEnds.length - 1))];

      for (const [x, y] of cells.values()) {
        let type = 'combat';
        if (x === 0 && y === 0) type = 'start';
        else if (x === boss[0] && y === boss[1]) type = 'boss';
        else if (x === treasure[0] && y === treasure[1]) type = 'treasure';
        this.rooms.set(this.key(x, y), new Chamber(this.game, this, x, y, type));
      }
      for (const room of this.rooms.values()) {
        for (const [dir, d] of Object.entries(DIRS)) room.neighbors[dir] = this.get(room.gx + d.dx, room.gy + d.dy) || null;
      }
      this.start = this.get(0, 0);
      return;
    }
    throw new Error('Failed to generate dungeon floor');
  }

  distances(cells) {
    const dist = new Map([[this.key(0, 0), 0]]);
    const q = [[0, 0]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const d of Object.values(DIRS)) {
        const k = this.key(x + d.dx, y + d.dy);
        if (cells.has(k) && !dist.has(k)) {
          dist.set(k, dist.get(this.key(x, y)) + 1);
          q.push([x + d.dx, y + d.dy]);
        }
      }
    }
    return dist;
  }

  dispose() {
    for (const room of this.rooms.values()) room.dispose();
  }
}
