import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { World } from './physics.js';
import {
  GeoBatch, composeMatrix, worldBoxGeometry, scaleUV, archWallGeometry,
  rand, randInt, pick, chance, clamp, flicker, TAU,
} from './util.js';
import * as Textures from './textures.js';
import { createSkyDome } from './sky.js';
import { TrainingDummy, ENEMY_TYPES, separateEnemies } from './enemies.js';
import { WeaponDrop } from './loot.js';
import { WEAPON_TYPES, makeWeapon, buildWeaponModel } from './weapons.js';

/**
 * The Roundtable Hold — the hub between expeditions. A ruined cruciform hold on a misty
 * island: the round-table chamber at the crossing, a chapel nave north (the expedition gate),
 * a library west, an armory corridor east out to the sparring grounds, and a roofless ruined
 * courtyard running south to a meadow and a grey beach.
 */

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- Island terrain -----------------------------------------------------------

const ISLAND = [[0, 8, 40, 46], [-42, -20, 27, 15], [36, -7, 22, 24], [8, 52, 34, 24], [0, -38, 17, 18]];
const HILL = { x: 0, z: -46, rx: 16, rz: 13, h: 7.5 };
const ARENA = { x: 40, z: -6, r: 13 };
const FOOTPRINTS = [
  [-9.8, -9.8, 9.8, 9.8],
  [-6.8, -36, 6.8, -6],
  [-31.5, -8.5, -5, 8.5],
  [8, -4, 24.5, 4],
  [-19, 4, 19, 47.5],
  [-9, -38, 9, -33],
  [-33, -10, -29, 10],
];
const PATHS = [
  [[0, 9], [0, 44], [2, 54], [5, 64], [8, 72]],
  [[23.5, 0], [28, -2], [33, -5], [40, -6]],
  [[-4, 44], [-16, 50], [-30, 34], [-38, 14], [-42, -8], [-44, -20]],
  [[-31, 0], [-37, -6], [-42, -14]],
];

const coastNoise = (x, z) => Math.sin(x * 0.21 + z * 0.07) * 0.5 + Math.sin(z * 0.17 - x * 0.05 + 1.7) * 0.35 + Math.sin((x + z) * 0.4) * 0.15;

function islandMask(x, z) {
  let m = -Infinity;
  for (const [cx, cz, rx, rz] of ISLAND) m = Math.max(m, 1 - Math.hypot((x - cx) / rx, (z - cz) / rz));
  return m + coastNoise(x, z) * 0.04;
}

function footprintDist(x, z) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of FOOTPRINTS) {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  best = Math.min(best, Math.max(0, Math.hypot(x - ARENA.x, z - ARENA.z) - ARENA.r - 1));
  return best;
}

function segDist(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

function pathDist(x, z) {
  let d = Infinity;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) d = Math.min(d, segDist(x, z, p[i], p[i + 1]));
  return d;
}

export function terrainHeight(x, z) {
  const m = islandMask(x, z);
  if (m < 0) return Math.max(-7, -2.6 + m * 8);
  const beach = smoothstep(18, 46, z) * smoothstep(-30, -5, x);
  const edge = 0.07 + beach * 0.22;
  let h = -2.6 + 2.6 * smoothstep(0, edge, m);
  const inland = smoothstep(0.1, 0.3, m);
  h += (Math.sin(x * 0.13) + Math.sin(z * 0.11 + 1.3) + Math.sin((x - z) * 0.07)) * 0.22 * inland;
  const hm = 1 - Math.hypot((x - HILL.x) / HILL.rx, (z - HILL.z) / HILL.rz);
  if (hm > 0) h += HILL.h * smoothstep(0, 0.85, hm) + Math.sin(x * 0.7) * Math.sin(z * 0.6) * 0.4 * hm;
  const f = footprintDist(x, z);
  if (f < 4) h += (-0.04 - h) * (1 - smoothstep(0, 4, f));
  return h;
}

// ---- Shared template geometry ------------------------------------------------------

const GEO = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  ico: new THREE.IcosahedronGeometry(1, 1),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  rock: new THREE.DodecahedronGeometry(1, 0),
  sphere: new THREE.SphereGeometry(1, 10, 8),
};

const _m = new THREE.Matrix4();

export class Hub {
  constructor(game) {
    this.game = game;
    this.type = 'hub';
    this.name = 'The Roundtable Hold';
    this.built = false;
    this.enemies = [];
    this.loot = [];
    this.interactables = [];
    this.lightSpots = [];
    this.emitters = [];
    this.flames = [];
    this.pedestal = null;
    this.center = { x: 0, y: 0, z: 0 };
    this.neighbors = {};
    this.gates = {};
    this.spawnPose = { x: 0, y: 0, z: 6.2, yaw: 0 };
    this.time = 0;
  }

  // ---- Area interface --------------------------------------------------------

  entryPose() { return this.spawnPose; }
  exitDirection() { return null; }
  /** The Hold lives in the scene only while the knight is in it; during a run it is detached entirely. */
  enter() {
    this.group.visible = true;
    if (!this.group.parent) this.game.scene.add(this.group);
  }

  exit() {
    this.group.visible = false;
    this.group.parent?.remove(this.group);
  }

  update(dt) {
    this.time += dt;
    for (const e of this.enemies) e.update(dt);
    separateEnemies(this.enemies);
    this.enemies = this.enemies.filter((e) => !e.removed);
    for (const l of this.loot) l.update(dt);
    this.updateFlames(this.time);

    const glow = this.game.glow;
    for (const em of this.emitters) {
      if (em.kind === 'fire' && Math.random() < dt * (em.rate ?? 22)) {
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + rand(-em.spread, em.spread), em.pos.y, em.pos.z + rand(-em.spread, em.spread)),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.2, 2.6), rand(-0.3, 0.3)), life: rand(0.4, 0.9), size: rand(0.05, 0.12), color: pick([0xff8a2a, 0xffb040, 0xff5a1a]),
        });
      } else if (em.kind === 'grace' && Math.random() < dt * 30) {
        const a = rand(0, TAU), r = rand(0, 0.5);
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + Math.cos(a) * r, em.pos.y + rand(0, 0.5), em.pos.z + Math.sin(a) * r),
          vel: new THREE.Vector3(rand(-0.15, 0.15), rand(0.8, 2.2), rand(-0.15, 0.15)), life: rand(1.5, 3), size: rand(0.03, 0.06), color: pick([0xffd070, 0xffe8a0, 0xffb040]),
        });
      } else if (em.kind === 'motes' && Math.random() < dt * 6) {
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + rand(-em.spread, em.spread), em.pos.y + rand(0.5, 5), em.pos.z + rand(-em.spread, em.spread)),
          vel: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.15, 0.05), rand(-0.1, 0.1)), life: rand(2, 4), size: 0.03, color: 0xd8ccb0,
        });
      }
    }
    this.portalUniforms.time.value = this.time;
    this.graceCore.scale.x = this.graceCore.scale.z = 1 + Math.sin(this.time * 3) * 0.12;
    const cam = this.game.camera.position;
    this.sky.position.set(cam.x, 0, cam.z);
    this.water.position.x = cam.x;
    this.water.position.z = cam.z;
    this.waterMat.map.offset.set(cam.x / 900 + this.time * 0.002, -cam.z / 900 + this.time * 0.0015);
  }

  spawnEnemy(typeId) {
    const p = this.game.player.pos;
    let x = ARENA.x, z = ARENA.z;
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), r = rand(2, 8.5);
      x = ARENA.x + Math.cos(a) * r;
      z = ARENA.z + Math.sin(a) * r;
      if (Math.hypot(x - p.x, z - p.z) > 5) break;
    }
    const e = ENEMY_TYPES[typeId].create(this.game, this, x, terrainHeight(x, z), z);
    this.enemies.push(e);
    if (e.isBoss) this.game.hud.showBoss(e);
    return e;
  }

  clearEnemies() {
    for (const e of this.enemies) {
      if (e instanceof TrainingDummy) continue;
      e.dead = true;
      e.removed = true;
      e.group.visible = false;
      this.game.glow.burst(e.pos.clone().setY(e.pos.y + 1), 20, () => ({
        vel: new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2)), life: rand(0.5, 1), size: 0.05, color: 0xffd070, drag: 2,
      }));
    }
    this.game.hud.hideBoss();
  }

  // ---- Build -----------------------------------------------------------------

  build() {
    if (this.built) return;
    this.built = true;
    const game = this.game;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.world = new World();
    this.world.minWalkY = -0.45;
    this.world.addField(terrainHeight);
    this.M = this.makeMaterials();
    this.batch = new GeoBatch();

    this.buildTerrain();
    this.buildSeaAndSky();
    this.buildRoundHall();
    this.buildNave();
    this.buildLibrary();
    this.buildArmory();
    this.buildCourtyard();
    this.buildArena();
    this.buildRuins();
    this.buildNature();
    this.buildDistant();
    this.batch.build(this.group);
    this.buildGrass();
    this.buildFlames();
    for (const x of [-5, 0, 5]) {
      const dx = ARENA.x + x, dz = ARENA.z - 7 - (x === 0 ? 0.6 : 0);
      this.enemies.push(new TrainingDummy(game, this, dx, terrainHeight(dx, dz), dz, 0));
    }
  }

  makeMaterials() {
    const G = this.game.materials;
    const brick = Textures.bricks();
    const flag = Textures.flagstones();
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true, ...o });
    return {
      ...G,
      stone: std({ map: brick, color: 0xb4ac9e, flatShading: false }),
      stoneDark: std({ color: 0x6a655c }),
      trim: std({ color: 0x80796c }),
      floorStone: std({ map: flag, color: 0xb0a898, flatShading: false }),
      wood: std({ map: Textures.planks(), color: 0xb09070, flatShading: false }),
      woodDark: std({ color: 0x3e2c20 }),
      carpet: std({ color: 0x6a1a1c }),
      carpetTrim: std({ color: 0xa08040 }),
      roof: std({ map: Textures.roofTiles(), color: 0x9aa0a8, side: THREE.DoubleSide, flatShading: false }),
      books: std({ map: Textures.books(), color: 0xffffff, flatShading: false }),
      bark: std({ color: 0x4a3e32 }),
      leaf: [std({ color: 0x4e5c30 }), std({ color: 0x5c6636 }), std({ color: 0x3e4a28 })],
      ivy: std({ color: 0x3e5028 }),
      rockHub: std({ map: Textures.rock(), color: 0xa09a8c }),
      gold: std({ color: 0xb89a50, metalness: 0.4, roughness: 0.4 }),
      bannerBlue: std({ color: 0x2a3a5c }),
      bannerRed: std({ color: 0x6a1c20 }),
      canvas: std({ color: 0x8a7a5a, side: THREE.DoubleSide }),
      terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
      grace: new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      graceCore: new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
      windowGlow: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    };
  }

  // ---- Helpers ---------------------------------------------------------------

  add(geo, mat, matrix, opts) { this.batch.add(geo, mat, matrix, opts); }

  box(mat, w, h, d, x, y, z, ry = 0, { unit = 4, cast = true, receive = true, rx = 0, rz = 0 } = {}) {
    const geo = mat.map ? worldBoxGeometry(w, h, d, unit) : new THREE.BoxGeometry(w, h, d);
    this.add(geo, mat, composeMatrix(x, y, z, rx, ry, rz), { cast, receive });
  }

  part(geo, mat, parent, lx, ly, lz, sx, sy, sz, opts, rx = 0, ry = 0, rz = 0) {
    _m.multiplyMatrices(parent, composeMatrix(lx, ly, lz, rx, ry, rz, sx, sy, sz));
    this.add(geo, mat, _m.clone(), opts);
  }

  /** A chain of small circles standing in for any straight solid edge. */
  solidLine(ax, az, bx, bz, r, y0, y1, skip = null) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 0.45));
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * len;
      if (skip && skip(s)) continue;
      this.world.addCircle(ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len, r, y0, y1);
    }
  }

  /**
   * A straight wall from a to b. `arches`: [{ at (m from a), w, spring, peak, bottom? }];
   * arches without a bottom are doorways and leave gaps in the collision.
   */
  wall(ax, az, bx, bz, { h = 8, t = 1, y = 0, arches = [], mat = this.M.stone, collide = true, cap = true, ivy = 0 } = {}) {
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const rot = Math.atan2(-uz, ux);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (arches.length) {
      const geo = archWallGeometry(len, h, t, arches.map((a) => ({ cx: a.at - len / 2, halfW: a.w / 2, spring: a.spring, peak: a.peak, bottom: a.bottom || 0 })));
      this.add(geo, mat, composeMatrix(mx, y, mz, 0, rot));
    } else {
      this.add(worldBoxGeometry(len, h, t), mat, composeMatrix(mx, y + h / 2, mz, 0, rot));
    }
    if (cap) this.add(worldBoxGeometry(len + 0.2, 0.35, t + 0.3), this.M.trim, composeMatrix(mx, y + h + 0.17, mz, 0, rot));
    this.add(worldBoxGeometry(len, 0.5, t + 0.25), this.M.trim, composeMatrix(mx, y + 0.25, mz, 0, rot));
    if (collide) {
      const doors = arches.filter((a) => !a.bottom);
      this.solidLine(ax, az, bx, bz, t / 2 + 0.08, y - 1, y + h, (s) => doors.some((a) => Math.abs(s - a.at) < a.w / 2 - 0.1));
    }
    for (let i = 0; i < ivy; i++) {
      const s = rand(0.5, len - 0.5), hang = rand(1.5, h * 0.7);
      const side = chance(0.5) ? 1 : -1;
      this.add(GEO.cube, this.M.ivy, composeMatrix(ax + ux * s - uz * side * (t / 2 + 0.03), y + h - hang / 2, az + uz * s + ux * side * (t / 2 + 0.03), 0, rot, 0, rand(0.4, 1.2), hang, 0.06), { cast: false });
    }
  }

  /** Gable roof over a rectangle; `along` is the ridge direction angle. */
  roof(cx, cz, w, len, eaveY, rise, along = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - 0.5, -0.3);
    shape.lineTo(w / 2 + 0.5, -0.3);
    shape.lineTo(0, rise);
    shape.lineTo(-w / 2 - 0.5, -0.3);
    const geo = scaleUV(new THREE.ExtrudeGeometry(shape, { depth: len + 1, bevelEnabled: false }), 1);
    geo.translate(0, 0, -(len + 1) / 2);
    this.add(geo, this.M.roof, composeMatrix(cx, eaveY, cz, 0, along));
    this.add(new THREE.BoxGeometry(0.4, 0.4, len + 1.2), this.M.stoneDark, composeMatrix(cx, eaveY + rise, cz, 0, along));
    // Rafters seen from inside.
    for (let s = -len / 2 + 1.5; s < len / 2; s += 3) {
      const ox = Math.sin(along) * s, oz = Math.cos(along) * s;
      this.add(new THREE.BoxGeometry(w, 0.3, 0.3), this.M.woodDark, composeMatrix(cx + ox, eaveY - 0.2, cz + oz, 0, along));
    }
  }

  floor(x0, z0, x1, z1, mat = this.M.floorStone, y = 0) {
    const w = x1 - x0, d = z1 - z0;
    this.add(worldBoxGeometry(w, 0.3, d, 8), mat, composeMatrix((x0 + x1) / 2, y - 0.15, (z0 + z1) / 2), { cast: false });
    this.world.addRect((x0 + x1) / 2, (z0 + z1) / 2, w / 2, d / 2, y, { thick: 1, parapet: false, tag: 'floor' });
  }

  pillar(x, z, h, r = 0.45, y = 0) {
    const M = this.M;
    const base = composeMatrix(x, y, z);
    this.part(GEO.cube, M.trim, base, 0, 0.3, 0, r * 2.8, 0.6, r * 2.8);
    const shaftH = h - 1.3;
    this.add(scaleUV(GEO.cyl8.clone(), 1, shaftH / 4), M.stone, _m.multiplyMatrices(base, composeMatrix(0, 0.6 + shaftH / 2, 0, 0, 0, 0, r * 0.75, shaftH, r * 0.75)).clone());
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      this.part(GEO.cyl8, M.trim, base, Math.cos(a) * r * 0.8, 0.6 + shaftH / 2, Math.sin(a) * r * 0.8, r * 0.32, shaftH, r * 0.32);
    }
    this.part(GEO.cube, M.trim, base, 0, 0.6 + shaftH + 0.35, 0, r * 2.6, 0.7, r * 2.6);
    this.world.addCircle(x, z, r * 1.3, y - 1, y + h);
  }

  arcade(ax, az, bx, bz, bottomY, height, thickness = 0.7) {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az) / len, (bx - ax) / len);
    const geo = archWallGeometry(len, height, thickness, [{ cx: 0, halfW: len / 2 - 0.45, spring: height * 0.35, peak: height * 0.85 }]);
    this.add(geo, this.M.stone, composeMatrix((ax + bx) / 2, bottomY, (az + bz) / 2, 0, rot));
  }

  tower(x, z, w, h, { roof = 'crenel', y = -3 } = {}) {
    const M = this.M;
    const tall = h - y;
    this.add(worldBoxGeometry(w, tall, w), M.stone, composeMatrix(x, y + tall / 2, z));
    this.add(worldBoxGeometry(w + 0.5, 0.5, w + 0.5), M.trim, composeMatrix(x, h - 0.2, z));
    for (let yy = y + 5; yy < h - 2; yy += 5) this.add(worldBoxGeometry(w + 0.3, 0.3, w + 0.3), M.trim, composeMatrix(x, yy, z));
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      for (let yy = h - 3; yy > 3; yy -= rand(4, 6)) {
        if (!chance(0.5)) continue;
        this.add(GEO.cube, chance(0.3) ? M.windowGlow : M.void, composeMatrix(x + Math.sin(a) * (w / 2 + 0.02), yy, z + Math.cos(a) * (w / 2 + 0.02), 0, a, 0, 0.35, 1.0, 0.06), { cast: false });
      }
    }
    if (roof === 'cone') {
      this.add(GEO.cone4, M.roof, composeMatrix(x, h + w * 0.9, z, 0, Math.PI / 4, 0, w * 0.78, w * 1.8, w * 0.78));
    } else {
      const n = Math.max(2, Math.round(w / 1.1));
      for (let i = 0; i < n; i++) {
        const s = -w / 2 + (w / (n - 1)) * i;
        for (const [ox, oz] of [[s, -w / 2], [s, w / 2], [-w / 2, s], [w / 2, s]]) {
          if (i % 2) this.add(GEO.cube, M.stone, composeMatrix(x + ox, h + 0.45, z + oz, 0, 0, 0, 0.55, 0.9, 0.55));
        }
      }
    }
    this.world.addBox(x - w / 2, z - w / 2, x + w / 2, z + w / 2, y - 1, h + 3);
  }

  candelabra(x, z, y = 0, { h = 1.9, arms = 5, light = false, weight = 1.2 } = {}) {
    const M = this.M;
    this.add(new THREE.CylinderGeometry(0.035, 0.05, h, 6), M.gold, composeMatrix(x, y + h / 2, z));
    this.add(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 8), M.gold, composeMatrix(x, y + 0.04, z));
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU;
      const r = i === 0 ? 0 : 0.3;
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      const ch = y + h + (i === 0 ? 0.15 : 0);
      if (r) this.add(new THREE.BoxGeometry(0.3, 0.03, 0.03), M.gold, composeMatrix((x + cx) / 2, ch - 0.1, (z + cz) / 2, 0, -a, 0));
      const cand = rand(0.12, 0.28);
      this.add(new THREE.BoxGeometry(0.05, cand, 0.05), M.wax, composeMatrix(cx, ch + cand / 2, cz), { cast: false });
      this.flames.push({ pos: new THREE.Vector3(cx, ch + cand + 0.05, cz), seed: rand(0, 100) });
    }
    this.world.addCircle(x, z, 0.3, y - 1, y + h);
    if (light) this.lightSpots.push({ pos: new THREE.Vector3(x, y + h + 0.4, z), color: 0xffa050, weight, distance: 12 });
  }

  candles(x, z, y, count) {
    for (let i = 0; i < count; i++) {
      const h = rand(0.1, 0.35);
      const cx = x + rand(-0.3, 0.3), cz = z + rand(-0.25, 0.25);
      this.add(new THREE.BoxGeometry(0.06, h, 0.06), this.M.wax, composeMatrix(cx, y + h / 2, cz), { cast: false });
      this.flames.push({ pos: new THREE.Vector3(cx, y + h + 0.05, cz), seed: rand(0, 100) });
    }
  }

  banner(x, z, y, ry, mat = this.M.bannerBlue, len = 3) {
    this.add(new THREE.BoxGeometry(1.3, 0.08, 0.08), this.M.woodDark, composeMatrix(x, y, z, 0, ry));
    this.add(new THREE.BoxGeometry(1.1, len, 0.04), mat, composeMatrix(x, y - len / 2 - 0.05, z, 0, ry));
    this.add(new THREE.BoxGeometry(0.5, 0.5, 0.045), mat, composeMatrix(x - 0.25 * Math.cos(ry), y - len - 0.2, z + 0.25 * Math.sin(ry), 0, ry, 0.5));
    this.add(new THREE.BoxGeometry(0.5, 0.5, 0.045), mat, composeMatrix(x + 0.25 * Math.cos(ry), y - len - 0.2, z - 0.25 * Math.sin(ry), 0, ry, -0.5));
    this.add(new THREE.BoxGeometry(0.35, 0.35, 0.05), this.M.gold, composeMatrix(x, y - len * 0.4, z, 0, ry, Math.PI / 4), { cast: false });
  }

  rock(x, z, s, y = null) {
    const gy = y ?? terrainHeight(x, z);
    this.add(GEO.rock, this.M.rockHub, composeMatrix(x, gy + s * 0.3, z, rand(0, 3), rand(0, 3), rand(0, 3), s * rand(0.8, 1.4), s * rand(0.6, 1), s * rand(0.8, 1.3)));
    if (s > 0.6) this.world.addCircle(x, z, s * 0.9, gy - 1, gy + s);
  }

  /** Gnarled leafy tree, or a bare dead one. */
  tree(x, z, scale = 1, dead = false, y = null) {
    const M = this.M;
    const gy = y ?? terrainHeight(x, z);
    let px = x, py = gy - 0.3, pz = z;
    let lean = rand(0, TAU), tilt = rand(0.05, 0.25);
    const trunkH = rand(3, 5) * scale;
    const segs = 3;
    let r = 0.32 * scale;
    for (let i = 0; i < segs; i++) {
      const h = trunkH / segs;
      const dx = Math.sin(tilt) * Math.cos(lean) * h, dz = Math.sin(tilt) * Math.sin(lean) * h;
      const len = Math.hypot(dx, h, dz);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(px, py, pz), new THREE.Vector3(px + dx, py + h, pz + dz), new THREE.Vector3(0, 0, 1));
      const geo = new THREE.CylinderGeometry(r, r * 0.8, len, 6).rotateX(Math.PI / 2).translate(0, 0, -len / 2);
      const mat4 = new THREE.Matrix4().makeTranslation(px, py, pz).multiply(m);
      this.add(geo, M.bark, mat4);
      px += dx; py += h; pz += dz;
      r *= 0.78;
      lean += rand(-0.8, 0.8);
      tilt = rand(0.1, 0.35);
    }
    const branches = dead ? randInt(5, 8) : randInt(3, 5);
    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * TAU + rand(-0.4, 0.4);
      const bl = rand(1.2, 2.6) * scale * (dead ? 0.9 : 1);
      const up = rand(0.3, 1.0);
      const ex = px + Math.cos(a) * bl, ey = py + up * bl * 0.8, ez = pz + Math.sin(a) * bl;
      const len = Math.hypot(ex - px, ey - py, ez - pz);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(px, py, pz), new THREE.Vector3(ex, ey, ez), new THREE.Vector3(0, 1, 0));
      const geo = new THREE.CylinderGeometry(r * 0.7, r * 0.35, len, 5).rotateX(Math.PI / 2).translate(0, 0, -len / 2);
      this.add(geo, M.bark, new THREE.Matrix4().makeTranslation(px, py - rand(0, 0.6), pz).multiply(m));
      if (dead) {
        for (let j = 0; j < 2; j++) {
          const tx = ex + rand(-0.8, 0.8) * scale, ty = ey + rand(0.2, 0.9) * scale, tz = ez + rand(-0.8, 0.8) * scale;
          const tl = Math.hypot(tx - ex, ty - ey, tz - ez);
          const tm = new THREE.Matrix4().lookAt(new THREE.Vector3(ex, ey, ez), new THREE.Vector3(tx, ty, tz), new THREE.Vector3(0, 1, 0));
          this.add(new THREE.CylinderGeometry(r * 0.3, 0.02, tl, 4).rotateX(Math.PI / 2).translate(0, 0, -tl / 2), M.bark, new THREE.Matrix4().makeTranslation(ex, ey, ez).multiply(tm));
        }
      } else {
        for (let j = 0; j < randInt(2, 3); j++) {
          const s = rand(1.0, 1.9) * scale;
          this.add(GEO.ico, pick(M.leaf), composeMatrix(ex + rand(-0.6, 0.6) * scale, ey + rand(-0.2, 0.6) * scale, ez + rand(-0.6, 0.6) * scale, rand(0, 3), rand(0, 3), 0, s, s * rand(0.6, 0.85), s));
        }
      }
    }
    if (!dead) {
      const s = rand(1.6, 2.4) * scale;
      this.add(GEO.ico, pick(M.leaf), composeMatrix(px, py + s * 0.4, pz, rand(0, 3), rand(0, 3), 0, s, s * 0.75, s));
    }
    this.world.addCircle(x, z, 0.45 * scale, gy - 1, gy + trunkH);
  }

  // ---- Terrain, sea, sky -------------------------------------------------------

  buildTerrain() {
    const size = 240, segs = 170;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2);
    geo.translate(0, 0, 10);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color(0x56663a), grassB = new THREE.Color(0x6a7040), grassC = new THREE.Color(0x46542e);
    const dirt = new THREE.Color(0x76664a), sand = new THREE.Color(0x9c9072), wetSand = new THREE.Color(0x6a6450);
    const rockC = new THREE.Color(0x6e6a62), arena = new THREE.Color(0x857252);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const slope = Math.hypot(terrainHeight(x + 0.8, z) - h, terrainHeight(x, z + 0.8) - h) / 0.8;
      const n = (Math.sin(x * 0.9) * Math.sin(z * 1.1) + Math.sin(x * 0.23 + z * 0.31)) * 0.5;
      const beach = smoothstep(18, 46, z) * smoothstep(-30, -5, x);
      if (h < -0.95) c.copy(wetSand).multiplyScalar(0.7);
      else if (slope > 0.9) c.copy(rockC).multiplyScalar(0.9 + n * 0.1);
      else if (h < 0.15 && (beach > 0.25 || h < -0.35)) c.copy(h < -0.5 ? wetSand : sand).multiplyScalar(0.95 + n * 0.08);
      else if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r - 0.6) c.copy(arena).multiplyScalar(0.92 + n * 0.08);
      else if (pathDist(x, z) < 1.2 + n * 0.4) c.copy(dirt).multiplyScalar(0.9 + n * 0.1);
      else {
        c.copy(grassA).lerp(n > 0 ? grassB : grassC, Math.abs(n));
        if (h > 2) c.lerp(grassC, 0.4);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.M.terrain);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildSeaAndSky() {
    const waterTex = Textures.mist();
    waterTex.repeat.set(40, 40);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x3e5054, roughness: 0.12, metalness: 0.25, map: waterTex, transparent: true, opacity: 0.94 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), this.waterMat);
    this.water.position.y = -0.9;
    this.water.receiveShadow = true;
    this.group.add(this.water);

    this.sky = createSkyDome({ sunDir: new THREE.Vector3(-0.5, 0.35, 0.8), bright: 0.72 });
    this.group.add(this.sky);
  }

  // ---- The hold --------------------------------------------------------------

  buildRoundHall() {
    const M = this.M;
    const apo = 8.5, Rv = apo / Math.cos(Math.PI / 8);
    this.add(scaleUV(new THREE.CylinderGeometry(Rv + 0.4, Rv + 0.4, 0.3, 8), (Rv * 2) / 8), M.floorStone, composeMatrix(0, -0.15, 0, 0, Math.PI / 8), { cast: false });
    this.world.addDisc(0, 0, Rv + 0.3, 0, { thick: 1, parapet: false, tag: 'floor' });
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const a1 = th - Math.PI / 8, a2 = th + Math.PI / 8;
      const ax = Math.cos(a1) * Rv, az = Math.sin(a1) * Rv, bx = Math.cos(a2) * Rv, bz = Math.sin(a2) * Rv;
      const len = Math.hypot(bx - ax, bz - az);
      const door = k % 2 === 0;
      this.wall(ax, az, bx, bz, {
        h: 11, t: 1.2,
        arches: door ? [{ at: len / 2, w: 3.8, spring: 3.6, peak: 6 }] : [{ at: len / 2, w: 2.2, spring: 6.2, peak: 8.6, bottom: 3.2 }],
      });
      this.box(M.stone, 1.3, 12, 1.3, Math.cos(a1) * (Rv + 0.3), 6, Math.sin(a1) * (Rv + 0.3), -a1);
      if (!door) {
        const cx = Math.cos(th) * (apo - 1.4), cz = Math.sin(th) * (apo - 1.4);
        this.candelabra(cx, cz, 0, { h: 2.1, light: k === 1 || k === 5, weight: 1.4 });
        this.banner(Math.cos(th) * (apo - 0.75), Math.sin(th) * (apo - 0.75), 9.4, -th + Math.PI / 2, k % 4 === 1 ? M.bannerBlue : M.bannerRed, 3.2);
        this.emitters.push({ kind: 'motes', pos: new THREE.Vector3(Math.cos(th) * (apo - 2), 0, Math.sin(th) * (apo - 2)), spread: 1 });
      }
    }
    // Dome with a lantern cupola.
    this.add(GEO.cone8, M.roof, composeMatrix(0, 11 + 4, 0, 0, Math.PI / 8, 0, Rv + 1.2, 8, Rv + 1.2));
    this.add(new THREE.CylinderGeometry(Rv + 0.9, Rv + 0.9, 0.8, 8), M.trim, composeMatrix(0, 11.2, 0, 0, Math.PI / 8));
    this.add(worldBoxGeometry(2.4, 2.4, 2.4), M.stone, composeMatrix(0, 19.5, 0, 0, Math.PI / 4));
    this.add(GEO.cone4, M.roof, composeMatrix(0, 22.2, 0, 0, 0, 0, 2.1, 3, 2.1));

    // The round table, pierced with the swords of those who came before.
    this.add(new THREE.CylinderGeometry(3.3, 3.0, 0.95, 28), M.stoneDark, composeMatrix(0, 0.47, 0));
    this.add(scaleUV(new THREE.CylinderGeometry(3.55, 3.45, 0.18, 28), 0.25), M.floorStone, composeMatrix(0, 1.02, 0));
    this.add(new THREE.CylinderGeometry(1.2, 1.2, 0.02, 20), M.stoneDark, composeMatrix(0, 1.12, 0));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rand(-0.2, 0.2), r = rand(0.7, 2.3);
      const m = composeMatrix(Math.cos(a) * r, 1.1, Math.sin(a) * r, rand(-0.5, 0.5), rand(0, TAU), rand(-0.5, 0.5));
      this.part(GEO.cube, M.iron, m, 0, 0.5, 0, 0.08, 1.2, 0.02);
      this.part(GEO.cube, M.iron, m, 0, 1.0, 0, 0.36, 0.05, 0.06);
      this.part(GEO.cube, M.woodDark, m, 0, 1.2, 0, 0.05, 0.35, 0.05);
    }
    this.world.addCircle(0, 0, 3.6, -1, 1.15);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const r = 4.5, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const m = composeMatrix(x, 0, z, 0, Math.atan2(-x, -z) + Math.PI + rand(-0.3, 0.3), chance(0.25) ? rand(-0.2, 0.2) : 0);
      this.part(GEO.cube, M.woodDark, m, 0, 0.5, 0, 0.7, 0.08, 0.7);
      this.part(GEO.cube, M.woodDark, m, 0, 1.15, -0.32, 0.7, 1.3, 0.08);
      for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) this.part(GEO.cube, M.woodDark, m, lx, 0.25, lz, 0.07, 0.5, 0.07);
      this.part(GEO.cube, M.carpet, m, 0, 0.56, 0, 0.62, 0.04, 0.62);
    }
    // Grace: a column of golden light rising from the table's heart.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.55, 9, 12, 1, true), M.grace);
    beam.position.set(0, 1.1 + 4.5, 0);
    this.group.add(beam);
    this.graceCore = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.12, 6, 8, 1, true), M.graceCore);
    this.graceCore.position.set(0, 1.1 + 3, 0);
    this.group.add(this.graceCore);
    this.lightSpots.push({ pos: new THREE.Vector3(0, 2.4, 0), color: 0xffc050, weight: 10, distance: 16, intensity: 22 });
    this.emitters.push({ kind: 'grace', pos: new THREE.Vector3(0, 1.15, 0) });
    this.interactables.push({
      position: new THREE.Vector3(0, 0, 0), radius: 5.3,
      prompt: 'Rest at the Round Table', sub: 'Choose your class',
      interact: () => this.game.openClassMenu(),
    });
  }

  buildNave() {
    const M = this.M;
    const x0 = -5.6, x1 = 5.6, zs = -6.4, ze = -34;
    this.floor(x0, ze, x1, -8.4);
    const windows = [];
    for (let z = -12; z > ze + 2; z -= 5) windows.push({ at: zs - z, w: 1.8, spring: 7, peak: 9.2, bottom: 3.4 });
    this.wall(x0, zs, x0, ze, { h: 11.5, t: 1.2, arches: windows, ivy: 3 });
    this.wall(x1, zs, x1, ze, { h: 11.5, t: 1.2, arches: windows, ivy: 3 });
    // North wall with the expedition gate.
    this.wall(x0 - 0.6, ze, x1 + 0.6, ze, { h: 11.5, t: 1.4, arches: [{ at: 6.2, w: 4.4, spring: 4.4, peak: 7.2 }] });
    this.box(M.void, 4.6, 7.4, 0.4, 0, 3.7, ze - 1.2, 0, { cast: false });
    this.world.addBox(-2.4, ze - 1.5, 2.4, ze + 0.4, -1, 8);
    this.roof(0, (zs + ze) / 2, x1 - x0 + 1.2, zs - ze + 0.8, 11.8, 4.8, 0);
    for (let z = zs - 4; z > ze; z -= 5) {
      this.box(M.stone, 1.1, 12.5, 1.4, x0 - 1.0, 6.25, z);
      this.box(M.stone, 1.1, 12.5, 1.4, x1 + 1.0, 6.25, z);
    }
    // Arcaded columns, red carpet, pews and candles.
    const pz = [-12, -16.5, -21, -25.5, -30];
    for (const side of [-1, 1]) {
      for (let i = 0; i < pz.length; i++) {
        this.pillar(side * 3.7, pz[i], 9.5, 0.42);
        if (i) this.arcade(side * 3.7, pz[i - 1], side * 3.7, pz[i], 6.8, 3.2);
        if (i % 2 === 0) this.banner(side * 3.2, pz[i], 8.2, Math.PI / 2, i === 2 ? M.bannerRed : M.bannerBlue, 2.8);
      }
    }
    this.box(M.carpet, 2.4, 0.04, 23, 0, 0.02, -21.5, 0, { cast: false });
    for (const side of [-1, 1]) this.box(M.carpetTrim, 0.12, 0.045, 23, side * 1.2, 0.022, -21.5, 0, { cast: false });
    for (let z = -13.5; z > -29; z -= 1.8) {
      for (const side of [-1, 1]) {
        const cx = side * 2.45;
        this.box(M.woodDark, 1.6, 0.1, 0.5, cx, 0.5, z);
        this.box(M.woodDark, 1.6, 0.7, 0.08, cx, 0.85, z + 0.24);
        this.box(M.woodDark, 0.08, 0.5, 0.45, cx - 0.75, 0.25, z);
        this.box(M.woodDark, 0.08, 0.5, 0.45, cx + 0.75, 0.25, z);
        this.world.addBox(cx - 0.8, z - 0.3, cx + 0.8, z + 0.3, -1, 1.2);
      }
    }
    // Altar step before the gate.
    this.box(M.floorStone, 11, 0.35, 3, 0, 0.17, ze + 1.6, 0, { cast: false });
    this.world.addRect(0, ze + 1.6, 5.5, 1.5, 0.35, { thick: 1, parapet: false, tag: 'floor' });
    this.candelabra(-2.4, -10, 0, { h: 1.7 });
    this.candelabra(2.4, -10, 0, { h: 1.7 });
    this.candelabra(-3.2, ze + 2, 0.35, { h: 2.2, light: true, weight: 1.6 });
    this.candelabra(3.2, ze + 2, 0.35, { h: 2.2, light: true, weight: 1.6 });
    for (const x of [-4.6, 4.6]) this.candles(x, ze + 1.4, 0.35, 6);
    // Sunbeams slanting through the west windows.
    for (let z = -12; z > ze + 2; z -= 10) this.emitters.push({ kind: 'motes', pos: new THREE.Vector3(-3, 0, z), spread: 1.5 });

    // The expedition gate: a curtain of drifting pale fog in the arch.
    this.portalUniforms = { time: { value: 0 } };
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 7.2), new THREE.ShaderMaterial({
      uniforms: this.portalUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 p = vUv * vec2(3.0, 5.0);
          float n = noise(p + vec2(time * 0.3, -time * 0.6)) * 0.6 + noise(p * 2.1 - vec2(time * 0.5, time * 0.2)) * 0.4;
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.1, vUv.y);
          vec3 col = mix(vec3(0.55, 0.65, 0.8), vec3(1.0, 0.92, 0.75), n);
          gl_FragColor = vec4(col * (0.35 + n * 0.6) * edge, 1.0);
        }
      `,
    }));
    portal.position.set(0, 3.6, ze - 0.1);
    this.group.add(portal);
    this.interactables.push({
      position: new THREE.Vector3(0, 0, ze + 1.2), radius: 3.4,
      prompt: 'Begin Expedition', sub: 'Descend into the dark',
      interact: () => this.game.beginExpedition(),
    });
  }

  buildLibrary() {
    const M = this.M;
    const x0 = -30, x1 = -6, z0 = -7, z1 = 7;
    this.floor(x0, z0, -8.4, z1, M.wood, 0.02);
    this.wall(x0, z0, -6.2, z0, { h: 8.5, t: 1.1 });
    this.wall(x0, z1, -5.4, z1, { h: 8.5, t: 1.1 });
    this.wall(x0, z0, x0, z1, { h: 8.5, t: 1.1, arches: [3.5, 10.5].map((at) => ({ at, w: 1.8, spring: 5, peak: 7, bottom: 2.4 })) });
    this.roof((x0 - 6) / 2, 0, z1 - z0 + 1.2, -6 - x0, 8.8, 4, Math.PI / 2);
    for (const x of [-12, -18, -24]) {
      this.box(M.stone, 1.4, 9.5, 1, x, 4.75, z0 - 0.9);
      this.box(M.stone, 1.4, 9.5, 1, x, 4.75, z1 + 0.9);
    }
    this.emitters.push({ kind: 'motes', pos: new THREE.Vector3(x0 + 3, 0, 0), spread: 2.5 });
    // Carpet runner and shelves.
    this.box(M.carpet, 19, 0.04, 2.8, -18.5, 0.05, 0, 0, { cast: false });
    this.box(M.carpetTrim, 19, 0.045, 0.12, -18.5, 0.052, 1.35, 0, { cast: false });
    this.box(M.carpetTrim, 19, 0.045, 0.12, -18.5, 0.052, -1.35, 0, { cast: false });
    for (const side of [-1, 1]) {
      const wz = side * (z1 - 0.95);
      this.shelf(-19, wz, 20, 5.4, 0, side);
      for (const x of [-12.5, -17, -21.5, -26]) this.shelf(x, side * 4.3, 3.6, 3.4, Math.PI / 2, 0);
    }
    // Reading desk at the far end, a globe, toppled stacks.
    this.box(M.woodDark, 1.4, 0.1, 2.6, -27.4, 0.95, 0);
    for (const [dx, dz] of [[-0.6, -1.2], [0.6, -1.2], [-0.6, 1.2], [0.6, 1.2]]) this.box(M.woodDark, 0.1, 0.9, 0.1, -27.4 + dx, 0.45, dz);
    this.world.addBox(-28.2, -1.4, -26.6, 1.4, -1, 1.1);
    this.box(M.wax, 0.5, 0.04, 0.7, -27.3, 1.02, 0.3, 0.2, { cast: false });
    this.candles(-27.5, -0.8, 1.0, 3);
    this.add(GEO.sphere, M.gold, composeMatrix(-27.2, 1.55, 3.2, 0, 0, 0, 0.35, 0.35, 0.35));
    this.box(M.woodDark, 0.08, 1.2, 0.08, -27.2, 0.6, 3.2);
    for (let i = 0; i < 14; i++) {
      const x = rand(-28, -10), z = pick([-1, 1]) * rand(1.7, 2.3);
      let y = 0.02;
      for (let j = 0; j < randInt(2, 7); j++) {
        const h = rand(0.05, 0.1);
        this.box(pick([M.carpet, M.bannerBlue, M.woodDark, M.leaf[2], M.carpetTrim]), rand(0.25, 0.4), h, rand(0.35, 0.5), x + rand(-0.04, 0.04), y + h / 2, z, rand(-0.4, 0.4), { cast: false });
        y += h;
      }
    }
    this.candelabra(-12.5, 2.2, 0, { h: 1.8, light: true, weight: 1.3 });
    this.candelabra(-23, -2.2, 0, { h: 1.8, light: true, weight: 1.3 });
    // A ladder resting against the shelves.
    const lm = composeMatrix(-15, 0, -5.5, -0.25, 0, 0);
    this.part(GEO.cube, M.woodDark, lm, -0.3, 2.3, 0, 0.07, 4.6, 0.07);
    this.part(GEO.cube, M.woodDark, lm, 0.3, 2.3, 0, 0.07, 4.6, 0.07);
    for (let y = 0.4; y < 4.4; y += 0.45) this.part(GEO.cube, M.woodDark, lm, 0, y, 0, 0.6, 0.05, 0.05);
  }

  /** Bookshelf: a wooden carcass with book-spine faces on its open side(s). side 0 = both faces. */
  shelf(x, z, len, h, ry, side) {
    const M = this.M;
    const depth = 0.6;
    this.add(worldBoxGeometry(len, h, depth), M.woodDark, composeMatrix(x, h / 2, z, 0, ry));
    const faces = side === 0 ? [1, -1] : [-side];
    for (const f of faces) {
      const ox = Math.sin(ry) * f * (depth / 2 + 0.01), oz = Math.cos(ry) * f * (depth / 2 + 0.01);
      const geo = scaleUV(new THREE.PlaneGeometry(len - 0.2, h - 0.3), (len - 0.2) / 2.2, (h - 0.3) / 2.2);
      this.add(geo, M.books, composeMatrix(x + ox, h / 2, z + oz, 0, ry + (f < 0 ? Math.PI : 0)), { cast: false });
      for (let yy = 0.3; yy < h; yy += 1.1) {
        this.add(new THREE.BoxGeometry(len, 0.06, 0.12), M.woodDark, composeMatrix(x + ox, yy, z + oz, 0, ry));
      }
    }
    this.add(new THREE.BoxGeometry(len + 0.2, 0.2, depth + 0.2), M.woodDark, composeMatrix(x, h + 0.1, z, 0, ry));
    const hl = len / 2, hd = depth / 2 + 0.05;
    const c = Math.cos(ry), s = Math.sin(ry);
    this.solidLine(x - c * hl, z + s * hl, x + c * hl, z - s * hl, hd, -1, h);
  }

  buildArmory() {
    const M = this.M;
    const x0 = 8.4, x1 = 23.5, zw = 3.3;
    this.floor(x0, -zw, x1, zw);
    this.wall(x0, -zw, x1, -zw, { h: 7, t: 1 });
    this.wall(x0, zw, x1, zw, { h: 7, t: 1 });
    this.wall(x1, -zw - 0.5, x1, zw + 0.5, { h: 7, t: 1.2, arches: [{ at: 3.8, w: 3.4, spring: 3.2, peak: 5.2 }] });
    this.roof((x0 + x1) / 2, 0, 2 * zw + 1, x1 - x0, 7.2, 3, Math.PI / 2);
    this.tower(x1 + 0.8, -zw - 1.2, 2.8, 12, { roof: 'cone' });
    this.tower(x1 + 0.8, zw + 1.2, 2.8, 12, { roof: 'cone' });
    // Decorative weapon racks along both walls.
    const types = Object.keys(WEAPON_TYPES);
    const mats = { steel: M.iron, dark: M.stoneDark, leather: M.woodDark, wood: M.woodDark, gold: M.gold };
    for (const side of [-1, 1]) {
      for (let x = 11; x < 21; x += 3.2) {
        const z = side * (zw - 0.6);
        this.box(M.woodDark, 2.4, 0.1, 0.12, x, 1.8, z);
        this.box(M.woodDark, 2.4, 0.1, 0.12, x, 0.3, z);
        this.world.addBox(x - 1.2, z - 0.3, x + 1.2, z + 0.3, -1, 2);
        for (let i = 0; i < 3; i++) {
          const wid = pick(types);
          const g = this.makeWeaponMesh(wid, mats);
          g.position.set(x - 0.8 + i * 0.8, 0.25, z);
          g.rotation.set(0, 0, rand(-0.08, 0.08));
          this.group.add(g);
        }
      }
      this.add(new THREE.BoxGeometry(0.12, 0.5, 0.12), M.iron, composeMatrix(16, 3.4, side * (zw - 0.55)));
      this.add(new THREE.BoxGeometry(0.16, 0.2, 0.16), M.flame, composeMatrix(16, 3.75, side * (zw - 0.55)), { cast: false });
      this.emitters.push({ kind: 'fire', pos: new THREE.Vector3(16, 3.8, side * (zw - 0.55)), spread: 0.05, rate: 6 });
    }
    this.lightSpots.push({ pos: new THREE.Vector3(16, 3.8, 0), color: 0xff8a40, weight: 1.1, distance: 11 });
  }

  makeWeaponMesh(typeId, mats) {
    const g = buildWeaponModel(typeId, mats);
    g.scale.setScalar(typeId === 'daggers' ? 1.4 : 1);
    return g;
  }

  buildCourtyard() {
    const M = this.M;
    const xw = 7.5, zs = 8, ze = 44;
    // Ruined side walls in uneven runs, each pierced by an arched window onto the dark wings.
    for (const side of [-1, 1]) {
      let z = zs;
      while (z < ze - 0.5) {
        const seg = Math.min(5, ze - z);
        const h = rand(5.5, 9.5);
        const arches = seg > 3 && h > 7 ? [{ at: seg / 2, w: 1.8, spring: 4.4, peak: 6.2, bottom: 1.4 }] : [];
        this.wall(side * xw, z, side * xw, z + seg, { h, t: 1.1, arches, cap: h > 8, ivy: randInt(0, 3) });
        if (arches.length) this.box(M.void, 0.3, 4.8, 1.9, side * (xw + 1.2), 3.8, z + seg / 2, 0, { cast: false });
        z += seg;
      }
    }
    // Wings behind: solid masses with roofs and a few warm windows.
    for (const side of [-1, 1]) {
      const cx = side * 13.6;
      this.add(worldBoxGeometry(8.4, 9, ze - zs), M.stone, composeMatrix(cx, 4.5, (zs + ze) / 2));
      this.roof(cx, (zs + ze) / 2, 8.4, ze - zs, 9, 4, 0);
      this.world.addBox(cx - 4.2, zs, cx + 4.2, ze, -1, 12);
      for (let z = zs + 3; z < ze - 2; z += 4.5) {
        const glow = chance(0.4);
        this.box(glow ? M.windowGlow : M.void, 0.06, 1.8, 0.9, side * 17.82, 4.5, z, 0, { cast: false });
        this.box(M.stone, 0.6, 9.5, 0.9, side * 18, 4.75, z + 2.25);
      }
    }
    // The great broken arch at the south end.
    this.wall(-xw - 0.5, ze, xw + 0.5, ze, { h: 10.5, t: 1.6, arches: [{ at: xw + 0.5, w: 6.2, spring: 4.8, peak: 8.2 }], ivy: 4 });
    for (let i = 0; i < 6; i++) this.rock(rand(-6, 6), ze + rand(-2, 2), rand(0.3, 0.7));
    this.tower(-xw - 3, ze + 1.2, 5.5, 17, { roof: 'crenel' });
    this.tower(xw + 3, ze + 1.2, 5.5, 15, { roof: 'crenel' });
    // Broken rafters overhead, fallen stones, column stumps, and trees reclaiming it all.
    for (const z of [14, 27, 36]) this.box(M.woodDark, 15, 0.35, 0.35, 0, 8.6, z, 0, { rz: rand(-0.06, 0.06) });
    this.box(M.woodDark, 7, 0.35, 0.35, -3.5, 4.2, 20, 0, { rz: 0.9 });
    for (const [x, z] of [[-4.5, 12], [4.5, 18], [-4.5, 30], [4.5, 40]]) {
      const h = rand(0.8, 2.4);
      this.add(scaleUV(GEO.cyl8.clone(), 1, h / 4), M.stone, composeMatrix(x, h / 2, z, 0, 0, 0, 0.5, h, 0.5));
      this.world.addCircle(x, z, 0.6, -1, h);
    }
    this.add(GEO.cyl8, M.stone, composeMatrix(2.5, 0.45, 25, 0, 0.5, Math.PI / 2, 0.45, 5, 0.45));
    this.world.addCircle(2.5, 25, 0.9, -1, 0.9);
    this.world.addCircle(4.2, 26, 0.7, -1, 0.9);
    this.world.addCircle(0.8, 24, 0.7, -1, 0.9);
    this.tree(-3.8, 22, 1.1);
    this.tree(4.2, 34, 0.9);
    for (let i = 0; i < 10; i++) this.rock(rand(-6.5, 6.5), rand(10, 43), rand(0.2, 0.55));
    this.emitters.push({ kind: 'motes', pos: new THREE.Vector3(0, 0, 25), spread: 5 });
  }

  buildArena() {
    const M = this.M;
    const { x: ax, z: az, r } = ARENA;
    // Low ring wall of fitted stones, open to the west.
    for (let a = 0; a < TAU; a += 0.09) {
      const ang = a;
      if (Math.abs(ang - Math.PI) < 0.24) continue;
      const x = ax + Math.cos(ang) * r, z = az + Math.sin(ang) * r;
      const h = rand(0.8, 1.25);
      const y = terrainHeight(x, z);
      this.add(GEO.cube, M.stone, composeMatrix(x, y + h / 2 - 0.1, z, rand(-0.05, 0.05), -ang, rand(-0.05, 0.05), 0.8, h, 1.2 * 0.95));
      this.world.addCircle(x, z, 0.62, y - 1, y + h);
    }
    for (const s of [-1, 1]) {
      const a = Math.PI + s * 0.3;
      const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
      this.add(GEO.cube, M.trim, composeMatrix(x, 1.6, z, 0, 0, 0, 0.8, 3.2, 0.8));
      this.banner(x + 0.6, z, 3.1, Math.PI / 2, M.bannerRed, 2);
      this.world.addCircle(x, z, 0.6, -1, 3.2);
    }
    // Tent and campfire along the north rim.
    const tz = az - 10.2;
    const tent = new THREE.Shape();
    tent.moveTo(-2.2, 0);
    tent.lineTo(2.2, 0);
    tent.lineTo(0, 2.7);
    tent.lineTo(-2.2, 0);
    const tg = new THREE.ExtrudeGeometry(tent, { depth: 4.5, bevelEnabled: false });
    tg.translate(0, 0, -2.25);
    this.add(tg, M.canvas, composeMatrix(ax + 5, terrainHeight(ax + 5, tz) - 0.05, tz, 0, Math.PI / 2 + 0.3));
    this.world.addCircle(ax + 5, tz, 2.3, -5, 5);
    this.campfire(ax - 3, az - 9.4);
    // Weapon rack: every weapon type, free to take and try.
    const rx = ax - 9.2;
    const types = Object.keys(WEAPON_TYPES);
    const z0 = az - (types.length - 1) * 0.6;
    const ry = terrainHeight(rx, az);
    this.box(M.woodDark, 0.18, 0.12, types.length * 1.2 + 0.6, rx + 0.35, ry + 1.7, az);
    this.box(M.woodDark, 0.18, 0.12, types.length * 1.2 + 0.6, rx + 0.35, ry + 0.35, az);
    for (const s of [-1, 1]) this.box(M.woodDark, 0.16, 2.2, 0.16, rx + 0.35, ry + 1.1, az + s * (types.length * 0.6 + 0.3));
    this.world.addBox(rx + 0.1, az - types.length * 0.6 - 0.4, rx + 0.6, az + types.length * 0.6 + 0.4, -5, 5);
    types.forEach((t, i) => {
      new WeaponDrop(this.game, this, makeWeapon(t), new THREE.Vector3(rx, ry + 0.25, z0 + i * 1.2), { rack: true, yaw: Math.PI / 2 });
    });
    // Summoning effigy: a hooded stone figure with a bell, to call foes into the ring.
    const ex = ax + 1.5, ez = az + 9.8;
    const ey = terrainHeight(ex, ez);
    const m = composeMatrix(ex, ey, ez, 0, Math.PI);
    this.part(GEO.cube, M.trim, m, 0, 0.35, 0, 1.4, 0.7, 1.4);
    this.part(GEO.cone8, M.stone, m, 0, 1.9, 0, 0.7, 2.4, 0.7);
    this.part(GEO.cone8, M.stone, m, 0, 3.35, 0, 0.36, 0.9, 0.36);
    this.part(GEO.cube, M.void, m, 0, 3.2, 0.24, 0.3, 0.3, 0.06, { cast: false });
    this.part(GEO.cube, M.woodDark, m, 1.2, 1.3, 0, 0.12, 2.6, 0.12);
    this.part(GEO.cube, M.woodDark, m, 0.9, 2.55, 0, 0.8, 0.1, 0.1);
    this.part(GEO.cone8, M.gold, m, 0.75, 2.2, 0, 0.22, 0.4, 0.22);
    this.world.addCircle(ex, ez, 0.9, ey - 1, ey + 3.8);
    this.candles(ex - 0.7, ez - 0.8, ey, 4);
    this.candles(ex + 0.8, ez - 0.6, ey, 3);
    this.interactables.push({
      position: new THREE.Vector3(ex, ey, ez - 0.5), radius: 2.6,
      prompt: 'Summoning Effigy', sub: 'Call foes to the sparring ground',
      interact: () => this.game.openSpawnMenu(),
    });
    this.brazier(ax - 8.5, az - 7);
    this.brazier(ax + 8.5, az + 6.5);
  }

  campfire(x, z) {
    const M = this.M;
    const y = terrainHeight(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      this.add(GEO.rock, M.rockHub, composeMatrix(x + Math.cos(a) * 0.7, y + 0.12, z + Math.sin(a) * 0.7, rand(0, 3), rand(0, 3), 0, 0.22, 0.18, 0.22));
    }
    for (let i = 0; i < 4; i++) this.add(GEO.cube, M.woodDark, composeMatrix(x, y + 0.2, z, 0.5, (i / 4) * Math.PI, 0, 0.12, 0.12, 1.1));
    this.add(new THREE.CylinderGeometry(0.4, 0.45, 0.06, 8), M.flame, composeMatrix(x, y + 0.08, z), { cast: false });
    // Pot on a tripod, like any good camp.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      this.add(GEO.cube, M.woodDark, composeMatrix(x + Math.cos(a) * 0.55, y + 0.8, z + Math.sin(a) * 0.55, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35, 0.06, 1.7, 0.06));
    }
    this.add(new THREE.CylinderGeometry(0.28, 0.2, 0.35, 8), M.iron, composeMatrix(x, y + 0.8, z));
    this.world.addCircle(x, z, 0.8, y - 1, y + 1.2);
    this.emitters.push({ kind: 'fire', pos: new THREE.Vector3(x, y + 0.25, z), spread: 0.3 });
    this.lightSpots.push({ pos: new THREE.Vector3(x, y + 1.2, z), color: 0xff8a30, weight: 1.5, distance: 13 });
  }

  brazier(x, z) {
    const M = this.M;
    const y = terrainHeight(x, z);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      this.add(GEO.cube, M.iron, composeMatrix(x + Math.cos(a) * 0.3, y + 0.5, z + Math.sin(a) * 0.3, 0, 0, Math.cos(a) * 0.2, 0.08, 1.0, 0.08));
    }
    this.add(new THREE.CylinderGeometry(0.55, 0.3, 0.35, 8), M.iron, composeMatrix(x, y + 1.1, z));
    this.add(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 8), M.flame, composeMatrix(x, y + 1.25, z), { cast: false });
    this.world.addCircle(x, z, 0.6, y - 1, y + 1.4);
    this.emitters.push({ kind: 'fire', pos: new THREE.Vector3(x, y + 1.3, z), spread: 0.3 });
    this.lightSpots.push({ pos: new THREE.Vector3(x, y + 1.9, z), color: 0xff7a30, weight: 1.2, distance: 12 });
  }

  // ---- Grounds ---------------------------------------------------------------

  buildRuins() {
    const M = this.M;
    // Corner towers of the hold.
    this.tower(-7.8, -35.6, 3.6, 18);
    this.tower(7.8, -35.6, 3.6, 16, { roof: 'cone' });
    this.tower(-31, -8, 3, 13, { roof: 'cone' });
    this.tower(-31, 8, 3, 12);
    // The overgrown western ruins: broken walls, toppled columns, old graves.
    const cx = -42, cz = -18;
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU), r = rand(3, 13);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.6;
      const len = rand(2.5, 6), ang = rand(0, Math.PI);
      const y = terrainHeight(x, z);
      this.wall(x - Math.cos(ang) * len / 2, z - Math.sin(ang) * len / 2, x + Math.cos(ang) * len / 2, z + Math.sin(ang) * len / 2,
        { h: rand(1, 4.5), t: 0.9, y: y - 0.2, cap: false, ivy: randInt(0, 2), arches: chance(0.3) ? [{ at: len / 2, w: 1.4, spring: 1.4, peak: 2.4, bottom: 0.4 }] : [] });
    }
    for (let i = 0; i < 5; i++) {
      const x = cx + rand(-12, 12), z = cz + rand(-8, 8);
      const y = terrainHeight(x, z);
      if (chance(0.5)) {
        const h = rand(1, 3);
        this.pillar(x, z, h, 0.42, y - 0.1);
      } else {
        this.add(GEO.cyl8, M.stone, composeMatrix(x, y + 0.35, z, 0, rand(0, TAU), Math.PI / 2, 0.42, rand(2.5, 4.5), 0.42));
        this.world.addCircle(x, z, 0.8, y - 1, y + 0.8);
      }
    }
    for (let i = 0; i < 9; i++) {
      const x = cx + 6 + rand(-4, 4), z = cz + 5 + rand(-3, 3);
      const y = terrainHeight(x, z);
      this.add(GEO.cube, M.stone, composeMatrix(x, y + 0.45, z, rand(-0.2, 0.2), rand(-0.3, 0.3), rand(-0.2, 0.2), 0.7, 1.0, 0.18));
    }
    for (let i = 0; i < 7; i++) this.tree(cx + rand(-14, 12), cz + rand(-9, 9), rand(0.8, 1.3), chance(0.25));
    for (let i = 0; i < 12; i++) this.rock(cx + rand(-16, 16), cz + rand(-10, 10), rand(0.3, 1.2));
  }

  buildNature() {
    const trees = [
      [-14, 55], [-6, 60], [16, 52], [22, 58], [-20, 44], [26, 40], [24, 14], [-24, 20], [20, -20], [-20, -22], [-14, -42], [8, -44], [-6, -48], [14, -40], [52, 8], [54, -18], [30, -24],
    ];
    for (const [x, z] of trees) this.tree(x + rand(-2, 2), z + rand(-2, 2), rand(0.8, 1.3));
    for (const [x, z] of [[-2, 72], [18, 70], [30, 62], [-12, 70]]) this.tree(x, z, rand(0.7, 1), true);
    for (let i = 0; i < 40; i++) {
      const x = rand(-60, 60), z = rand(-55, 75);
      const h = terrainHeight(x, z);
      if (h < -0.4 || footprintDist(x, z) < 2) continue;
      this.rock(x, z, rand(0.3, 1.4));
    }
    // Driftwood and a wrecked rowboat on the beach.
    for (let i = 0; i < 6; i++) {
      const x = rand(-8, 32), z = rand(62, 74);
      if (terrainHeight(x, z) < -0.6) continue;
      this.add(GEO.cyl6, this.M.bark, composeMatrix(x, terrainHeight(x, z) + 0.1, z, 0, rand(0, TAU), Math.PI / 2, 0.14, rand(1.5, 3.5), 0.14));
    }
    const bx = 20, bz = 66, by = terrainHeight(bx, bz);
    const hull = composeMatrix(bx, by + 0.1, bz, 0.25, 0.8, 0.35);
    for (const s of [-1, 1]) this.part(GEO.cube, this.M.woodDark, hull, s * 0.6, 0.3, 0, 0.1, 0.5, 3.2);
    this.part(GEO.cube, this.M.woodDark, hull, 0, 0.05, 0, 1.2, 0.1, 3.2);
    for (const z of [-1, 0.3]) this.part(GEO.cube, this.M.woodDark, hull, 0, 0.35, z, 1.2, 0.08, 0.3);
    this.world.addCircle(bx, bz, 1.4, by - 1, by + 1);
  }

  buildDistant() {
    const M = this.M;
    // Sea stacks with bare trees, fading into the mist.
    for (let i = 0; i < 9; i++) {
      const a = rand(0, TAU), r = rand(85, 170);
      const x = Math.cos(a) * r, z = 10 + Math.sin(a) * r;
      const h = rand(6, 22), w = rand(4, 10);
      this.add(GEO.rock, M.rockHub, composeMatrix(x, h / 2 - 3, z, rand(0, 0.3), rand(0, 3), rand(0, 0.3), w, h, w * rand(0.7, 1.2)), { cast: false });
      for (let t = 0; t < randInt(0, 3); t++) this.tree(x + rand(-w / 3, w / 3), z + rand(-w / 3, w / 3), rand(1, 1.6), chance(0.6), h - 3);
    }
    // A drowned keep on a distant isle.
    const kx = -150, kz = 150;
    this.add(GEO.rock, M.rockHub, composeMatrix(kx, 0, kz, 0, 0.4, 0, 34, 10, 22), { cast: false });
    this.add(worldBoxGeometry(18, 22, 12), M.stone, composeMatrix(kx, 15, kz, 0, 0.4), { cast: false });
    for (const [dx, dz, h] of [[-9, -5, 30], [9, -4, 28], [-7, 6, 24], [8, 6, 26]]) {
      this.add(worldBoxGeometry(5, h, 5), M.stone, composeMatrix(kx + dx, h / 2 + 3, kz + dz, 0, 0.4), { cast: false });
    }
    for (let t = 0; t < 5; t++) this.tree(kx + rand(-16, 16), kz + rand(-9, 9), rand(1.4, 2), chance(0.5), 5);
  }

  /** Thousands of grass tufts and wildflowers — instanced, coloured per blade. */
  buildGrass() {
    const blades = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.ConeGeometry(0.05, 0.55, 3).translate(0, 0.27, 0);
      g.rotateZ(rand(-0.35, 0.35));
      g.rotateY((i / 3) * Math.PI);
      g.translate(rand(-0.08, 0.08), 0, rand(-0.08, 0.08));
      blades.push(g);
    }
    const tuft = mergeGeometries(blades);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const count = 7000;
    const grass = new THREE.InstancedMesh(tuft, mat, count);
    const flowers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff }), 900);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    let n = 0, fn = 0;
    for (let tries = 0; tries < count * 4 && n < count; tries++) {
      const x = rand(-65, 62), z = rand(-58, 76);
      const h = terrainHeight(x, z);
      if (h < -0.35) continue;
      const inCourt = Math.abs(x) < 7 && z > 5 && z < 44;
      if (!inCourt && footprintDist(x, z) < 0.5) continue;
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 0.5) continue;
      if (pathDist(x, z) < 1.1) continue;
      const slope = Math.abs(terrainHeight(x + 0.8, z) - h);
      if (slope > 0.6) continue;
      dummy.position.set(x, h - 0.02, z);
      dummy.rotation.set(0, rand(0, TAU), 0);
      const s = rand(0.7, 1.5) * (inCourt ? 1.3 : 1);
      dummy.scale.set(s, s * rand(0.8, 1.4), s);
      dummy.updateMatrix();
      grass.setMatrixAt(n, dummy.matrix);
      c.setHSL(rand(0.19, 0.27), rand(0.28, 0.42), rand(0.2, 0.3));
      grass.setColorAt(n, c);
      n++;
      if (fn < 900 && chance(0.12)) {
        dummy.position.set(x + rand(-0.2, 0.2), h + rand(0.3, 0.5), z + rand(-0.2, 0.2));
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        flowers.setMatrixAt(fn, dummy.matrix);
        flowers.setColorAt(fn, c.setHex(pick([0xd8c040, 0xe8e0c8, 0xc04030, 0xd8c040])));
        fn++;
      }
    }
    grass.count = n;
    flowers.count = fn;
    grass.receiveShadow = true;
    this.group.add(grass, flowers);
  }

  buildFlames() {
    this.flameMesh = new THREE.InstancedMesh(this.game.flameGeo, this.M.flame, this.flames.length);
    this.flameMesh.frustumCulled = false;
    this.group.add(this.flameMesh);
    this.updateFlames(0);
  }

  updateFlames(t) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.flames.forEach((f, i) => {
      s.set(1, 0.8 + 0.35 * flicker(t * 1.5, f.seed), 1);
      m.compose(f.pos, q, s);
      this.flameMesh.setMatrixAt(i, m);
    });
    this.flameMesh.instanceMatrix.needsUpdate = true;
  }
}
