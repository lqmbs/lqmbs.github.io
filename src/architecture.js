import * as THREE from 'three';
import { ARCH_STYLES } from './config.js';
import {
  GeoBatch, composeMatrix, worldBoxGeometry, scaleUV, archWallGeometry,
  rand, randInt, pick, chance, TAU,
} from './util.js';

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();

// Shared template geometries (cloned into the batch, never rendered directly).
const GEO = {
  shaftOct: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  cone7: new THREE.ConeGeometry(1, 1, 7),
  rock: new THREE.DodecahedronGeometry(1, 0),
  ico: new THREE.IcosahedronGeometry(1, 1),
  cube: new THREE.BoxGeometry(1, 1, 1),
  drum: new THREE.CylinderGeometry(1, 1, 1, 12),
  dome: new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2),
};

/**
 * Builds a chamber's static architecture into a GeoBatch while registering walkable surfaces,
 * obstacles, light positions and particle emitters with the chamber.
 */
export class Builder {
  constructor(game, chamber) {
    this.game = game;
    this.ch = chamber;
    this.world = chamber.world;
    this.M = game.materials;
    this.batch = new GeoBatch();
    this.lightSpots = [];
    this.flames = [];
    this.emitters = [];
    this.spots = [];
    this.shafts = [];
    this.grass = [];
    this.biome = chamber.floor?.biome ?? { id: 'crystal' };
    this.style = chamber.floor?.style ?? ARCH_STYLES.gothic;
  }

  /** The material a platform's flanks are built from in this floor's style. */
  get sideMat() { return this.style.side === 'rock' ? this.M.rock : this.M.brick; }

  add(geo, mat, matrix, opts) { this.batch.add(geo, mat, matrix, opts); }

  box(mat, w, h, d, x, y, z, { rx = 0, ry = 0, rz = 0, unit = 4, cast = true, receive = true } = {}) {
    const geo = mat.map ? worldBoxGeometry(w, h, d, unit) : new THREE.BoxGeometry(w, h, d);
    this.add(geo, mat, composeMatrix(x, y, z, rx, ry, rz), { cast, receive });
  }

  /** Template geometry transformed by a parent matrix and then a local scale/offset. */
  part(geo, mat, parent, lx, ly, lz, sx, sy, sz, opts, lrx = 0, lry = 0, lrz = 0) {
    _t.copy(composeMatrix(lx, ly, lz, lrx, lry, lrz, sx, sy, sz));
    _m.multiplyMatrices(parent, _t);
    this.add(geo, mat, _m.clone(), opts);
  }

  // ---- Placement helpers -------------------------------------------------

  /** True when (x, z) is clear of the reserved paths towards each gate and of other props. */
  isFree(x, z, r = 0.6) {
    const n = this.ch.neighbors;
    const lane = 2.3 + r;
    const c = this.ch.center;
    if (Math.hypot(x - c.x, z - c.z) < 3.2 + r) return false;
    if (n.n && z < 0 && Math.abs(x) < lane) return false;
    if (n.s && z > 0 && Math.abs(x) < lane) return false;
    if (n.e && x > 0 && Math.abs(z) < lane) return false;
    if (n.w && x < 0 && Math.abs(z) < lane) return false;
    return !this.spots.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + r + 0.3);
  }

  reserve(x, z, r) { this.spots.push({ x, z, r }); }

  /** A random point on a walkable surface with the given tag, clear of props. */
  randomSpot(tags = ['hub'], r = 0.6, margin = 1) {
    const surfaces = this.world.surfaces.filter((s) => tags.includes(s.tag));
    if (!surfaces.length) return null;
    for (let i = 0; i < 40; i++) {
      const s = pick(surfaces);
      const p = samplePoint(s, margin);
      if (!p) continue;
      const g = this.world.groundAt(p.x, p.z);
      if (g === null || Math.abs(g - p.y) > 0.05) continue;
      if (this.isFree(p.x, p.z, r)) return p;
    }
    return null;
  }

  /** A spot hugging the rim of a surface — where pillars and crystals look best. */
  rimSpot(tags = ['hub'], r = 0.8, inset = 1.4) {
    const surfaces = this.world.surfaces.filter((s) => tags.includes(s.tag) && s.kind !== 'ramp');
    for (let i = 0; i < 40; i++) {
      const s = pick(surfaces);
      if (!s) return null;
      const p = rimPoint(s, inset);
      if (!p) continue;
      const g = this.world.groundAt(p.x, p.z);
      if (g === null || Math.abs(g - p.y) > 0.05) continue;
      if (this.isFree(p.x, p.z, r)) return p;
    }
    return null;
  }

  // ---- Structural pieces ---------------------------------------------------

  /** A rectangular platform: a stone tower whose top is the floor, sinking into the abyss. */
  platform(cx, cz, w, d, y, { angle = 0, depth = 45, parapet = true, tag = 'hub', style = 'balustrade', corbels = true } = {}) {
    const M = this.M;
    this.add(worldBoxGeometry(w, depth, d), this.sideMat, composeMatrix(cx, y - 0.35 - depth / 2, cz, 0, angle));
    this.add(worldBoxGeometry(w, 0.35, d, 8), M.floor, composeMatrix(cx, y - 0.175, cz, 0, angle));
    this.add(worldBoxGeometry(w + 0.35, 0.35, d + 0.35), M.trim, composeMatrix(cx, y - 0.55, cz, 0, angle));
    if (corbels && depth > 6) this.flankDetail(cx, cz, y, (hw) => worldBoxGeometry(w + hw, 0.3, d + hw), angle, w, d);
    return this.world.addRect(cx, cz, w / 2, d / 2, y, { angle, thick: depth, parapet, tag, style });
  }

  /** Mouldings down a platform's flank, in the floor's style. */
  flankDetail(cx, cz, y, ringGeo, angle = 0, w = 0, d = 0, r = 0) {
    const M = this.M;
    switch (this.style.id) {
      case 'imperial':
        // A dentilled cornice and a deep string course.
        this.add(ringGeo(0.5), M.trim, composeMatrix(cx, y - 1.0, cz, 0, angle));
        this.add(ringGeo(0.25), M.stone, composeMatrix(cx, y - 1.35, cz, 0, angle, 0, 1, 1.6, 1));
        this.add(ringGeo(0.6), M.trim, composeMatrix(cx, y - 6, cz, 0, angle, 0, 1, 2, 1));
        break;
      case 'cyclopean': {
        // Unmortared boulders bulging out of the flanks.
        const n = randInt(3, 6);
        for (let i = 0; i < n; i++) {
          const a = rand(0, TAU);
          const ex = r ? Math.cos(a) * r : rand(-w / 2, w / 2), ez = r ? Math.sin(a) * r : (chance(0.5) ? 1 : -1) * d / 2;
          const [lx, lz] = r ? [ex, ez] : chance(0.5) ? [ex, ez] : [(chance(0.5) ? 1 : -1) * w / 2, rand(-d / 2, d / 2)];
          const ca = Math.cos(angle), sa = Math.sin(angle);
          const sc = rand(0.9, 1.8);
          this.add(GEO.rock, M.rock, composeMatrix(cx + lx * ca + lz * sa, y - rand(1.2, 5), cz - lx * sa + lz * ca, rand(0, 3), rand(0, 3), 0, sc, sc * rand(0.8, 1.4), sc), { cast: false });
        }
        this.add(ringGeo(0.4), M.rock, composeMatrix(cx, y - 1.1, cz, 0, angle, 0, 1, 2.2, 1));
        break;
      }
      default:
        this.add(ringGeo(0.2), M.trim, composeMatrix(cx, y - 3.2, cz, 0, angle));
        this.add(ringGeo(0.5), M.trim, composeMatrix(cx, y - 9, cz, 0, angle, 0, 1, 2, 1));
    }
  }

  disc(cx, cz, r, y, { depth = 45, parapet = true, tag = 'hub', style = 'balustrade', segments = 20 } = {}) {
    const M = this.M;
    const circ = TAU * r;
    const col = scaleUV(new THREE.CylinderGeometry(r, r * 0.92, depth, segments, 1, true), circ / 4, depth / 4);
    this.add(col, this.sideMat, composeMatrix(cx, y - 0.35 - depth / 2, cz));
    const cap = scaleUV(new THREE.CylinderGeometry(r, r, 0.35, segments), (r * 2) / 8);
    this.add(cap, M.floor, composeMatrix(cx, y - 0.175, cz));
    this.add(new THREE.CylinderGeometry(r + 0.18, r + 0.18, 0.35, segments), M.trim, composeMatrix(cx, y - 0.55, cz));
    if (depth > 6) this.flankDetail(cx, cz, y, (g) => new THREE.CylinderGeometry(r + g, r + g, 0.3, segments), 0, 0, 0, r);
    return this.world.addDisc(cx, cz, r, y, { thick: depth, parapet, tag, style });
  }

  ring(cx, cz, r0, r1, y, { depth = 14, parapet = true, tag = 'hub', style = 'balustrade' } = {}) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, r1, 0, TAU, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r0, 0, TAU, true);
    shape.holes.push(hole);
    const top = scaleUV(new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, curveSegments: 28 }), 1 / 8);
    top.rotateX(-Math.PI / 2);
    this.add(top, this.M.floor, composeMatrix(cx, y - 0.35, cz));
    const col = scaleUV(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 28 }), 1 / 4);
    col.rotateX(-Math.PI / 2);
    this.add(col, this.M.brick, composeMatrix(cx, y - 0.35 - depth, cz));
    return this.world.addRing(cx, cz, r0, r1, y, { thick: depth, parapet, tag, style });
  }

  /** Straight bridge at any angle, carried on pointed arches over the void. */
  bridge(ax, az, bx, bz, y, width, { arches = true, tag = 'bridge', parapet = true } = {}) {
    const M = this.M;
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bx - ax, bz - az);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    this.add(worldBoxGeometry(width, 0.35, len, 8), M.floor, composeMatrix(cx, y - 0.175, cz, 0, ang));
    this.add(worldBoxGeometry(width + 0.3, 0.9, len), this.sideMat, composeMatrix(cx, y - 0.8, cz, 0, ang));
    this.add(worldBoxGeometry(width + 0.45, 0.25, len), M.trim, composeMatrix(cx, y - 0.4, cz, 0, ang));
    if (arches && len > 5) {
      const spans = Math.max(1, Math.round(len / 7));
      const spanLen = len / spans;
      const archH = rand(4, 7);
      const arcs = [];
      for (let i = 0; i < spans; i++) {
        const c = -len / 2 + spanLen * (i + 0.5);
        arcs.push({ cx: c, halfW: spanLen / 2 - 0.7, spring: archH * 0.45, peak: archH * 0.92 });
      }
      const wall = archWallGeometry(len, archH, width * 0.8, arcs, this.style.arch);
      // archWallGeometry runs along local X; rotate so it follows the bridge.
      this.add(wall, this.sideMat, composeMatrix(cx, y - 1.2 - archH, cz, 0, ang + Math.PI / 2));
      for (let i = 0; i <= spans; i++) {
        const t = -len / 2 + spanLen * i;
        const px = cx + Math.sin(ang) * t, pz = cz + Math.cos(ang) * t;
        if (i > 0 && i < spans) this.add(worldBoxGeometry(width * 0.9, 40, 1.3), this.sideMat, composeMatrix(px, y - 1.2 - archH - 20, pz, 0, ang));
      }
    }
    return this.world.addRect(cx, cz, width / 2, len / 2, y, { angle: ang, thick: 1.4, parapet, tag });
  }

  /** Stairs from (ax, az, y0) to (bx, bz, y1); collision is a smooth ramp. */
  stairs(ax, az, bx, bz, y0, y1, width, { support = true } = {}) {
    const M = this.M;
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bx - ax, bz - az);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const steps = Math.max(2, Math.ceil(Math.abs(y1 - y0) / 0.22));
    const low = Math.min(y0, y1);
    for (let i = 0; i < steps; i++) {
      const k = (i + 0.5) / steps;
      const t = -len / 2 + len * k;
      const top = y0 + (y1 - y0) * ((i + (y1 > y0 ? 1 : 0)) / steps);
      const h = top - low + 0.6;
      this.add(worldBoxGeometry(width, h, len / steps + 0.02, 4), M.floor,
        composeMatrix(cx + Math.sin(ang) * t, top - h / 2, cz + Math.cos(ang) * t, 0, ang));
    }
    for (const side of [-1, 1]) {
      const ox = Math.cos(ang) * side * (width / 2 + 0.15), oz = -Math.sin(ang) * side * (width / 2 + 0.15);
      const slope = Math.atan2(y1 - y0, len);
      this.add(worldBoxGeometry(0.3, 0.5, Math.hypot(len, y1 - y0)), M.trim,
        composeMatrix(cx + ox, (y0 + y1) / 2 - 0.1, cz + oz, -slope, ang));
    }
    if (support) this.add(worldBoxGeometry(width, 30, len), this.sideMat, composeMatrix(cx, low - 0.6 - 15, cz, 0, ang));
    const hd = len / 2;
    return this.world.addRamp(cx, cz, width / 2, hd, y0, y1, { angle: ang, thick: support ? 30 : 1 });
  }

  // ---- Gothic details ------------------------------------------------------

  pillar(x, z, y, h, { style = pick(['octagon', 'cluster', 'octagon']), r = 0.5, collide = true } = {}) {
    if (this.style.pillar === 'drum') return this.drumColumn(x, z, y, h, r, collide);
    if (this.style.pillar === 'monolith') return this.monolith(x, z, y, h, r, collide);
    const M = this.M;
    const base = composeMatrix(x, y, z);
    this.part(GEO.cube, M.trim, base, 0, 0.3, 0, r * 2.8, 0.6, r * 2.8);
    this.part(GEO.cube, M.trim, base, 0, 0.75, 0, r * 2.3, 0.3, r * 2.3);
    const shaftH = h - 1.4;
    if (style === 'cluster') {
      this.add(scaleUV(GEO.shaftOct.clone(), 1, shaftH / 4), M.brick, _m.multiplyMatrices(base, composeMatrix(0, 0.9 + shaftH / 2, 0, 0, 0, 0, r * 0.75, shaftH, r * 0.75)).clone());
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        this.part(GEO.shaftOct, M.stone, base, Math.cos(a) * r * 0.8, 0.9 + shaftH / 2, Math.sin(a) * r * 0.8, r * 0.35, shaftH, r * 0.35);
      }
    } else {
      this.add(scaleUV(GEO.shaftOct.clone(), 3.2 * r / 1.6, shaftH / 4), M.brick, _m.multiplyMatrices(base, composeMatrix(0, 0.9 + shaftH / 2, 0, 0, 0, 0, r, shaftH, r)).clone());
    }
    this.part(GEO.cube, M.trim, base, 0, 0.9 + shaftH + 0.25, 0, r * 2.4, 0.5, r * 2.4);
    if (collide) this.world.addCircle(x, z, r * 1.35, y - 1, y + h);
    this.reserve(x, z, r * 1.5);
  }

  /** Imperial column: plinth, a fluted round drum shaft, and a cushion capital with an abacus. */
  drumColumn(x, z, y, h, r, collide) {
    const M = this.M;
    const base = composeMatrix(x, y, z);
    this.part(GEO.cube, M.trim, base, 0, 0.3, 0, r * 3, 0.6, r * 3);
    this.part(GEO.drum, M.stone, base, 0, 0.75, 0, r * 1.25, 0.3, r * 1.25);
    const shaftH = h - 2;
    this.add(scaleUV(GEO.drum.clone(), 2, shaftH / 4), M.brick, _m.multiplyMatrices(base, composeMatrix(0, 0.9 + shaftH / 2, 0, 0, 0, 0, r * 0.95, shaftH, r * 0.95)).clone());
    for (let k = 1; k < 4; k++) this.part(GEO.drum, M.trim, base, 0, 0.9 + (shaftH * k) / 4, 0, r * 1.0, 0.08, r * 1.0);
    this.part(GEO.drum, M.stone, base, 0, 0.9 + shaftH + 0.2, 0, r * 1.35, 0.4, r * 1.35);
    this.part(GEO.cube, M.trim, base, 0, 0.9 + shaftH + 0.6, 0, r * 3, 0.4, r * 3);
    if (collide) this.world.addCircle(x, z, r * 1.35, y - 1, y + h);
    this.reserve(x, z, r * 1.5);
  }

  /** Titan-hewn monolith: rough slabs stacked askew, crowned with a capstone. */
  monolith(x, z, y, h, r, collide) {
    const M = this.M;
    let yy = y;
    const n = Math.max(2, Math.round(h / 3.4));
    const seg = h / n;
    for (let i = 0; i < n; i++) {
      const w = r * rand(2.2, 2.9) * (1 - i * 0.06);
      this.add(worldBoxGeometry(w, seg * 0.96, w * rand(0.8, 1.05)), M.rock,
        composeMatrix(x + rand(-0.08, 0.08), yy + seg / 2, z + rand(-0.08, 0.08), rand(-0.03, 0.03), rand(0, TAU), rand(-0.03, 0.03)));
      yy += seg;
    }
    this.add(worldBoxGeometry(r * 3.6, 0.8, r * 3.2), M.trim, composeMatrix(x, yy + 0.4, z, 0, rand(0, TAU)));
    if (collide) this.world.addCircle(x, z, r * 1.45, y - 1, y + h);
    this.reserve(x, z, r * 1.7);
  }

  /** An arch spanning between two points in the floor's style, its bottom at `bottomY`. */
  arcade(ax, az, bx, bz, bottomY, height, thickness = 0.7) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1.5) return;
    const ang = Math.atan2(bx - ax, bz - az);
    const geo = archWallGeometry(len, height, thickness, [{ cx: 0, halfW: len / 2 - 0.45, spring: height * 0.35, peak: height * 0.82 }], this.style.arch);
    this.add(geo, this.M.brick, composeMatrix((ax + bx) / 2, bottomY, (az + bz) / 2, 0, ang + Math.PI / 2));
  }

  /** The biome's signature growth: crystals, glowing fungus, or wild overgrowth. */
  crystalCluster(x, z, y, scale = 1, opts = {}) {
    switch (this.biome.id) {
      case 'sunken': return this.fungus(x, z, y, scale, opts);
      case 'sunlit': return y < -3 ? this.rockSpire(x, z, y, scale) : this.overgrowth(x, z, y, scale, opts);
      default: return this.crystals(x, z, y, scale, opts);
    }
  }

  crystals(x, z, y, scale = 1, { light = true, collide = true, tilt = 0.5, count = randInt(3, 7) } = {}) {
    const M = this.M;
    for (let i = 0; i < count; i++) {
      const len = scale * rand(0.6, 1.6) * (i === 0 ? 1.35 : 1);
      const r = scale * rand(0.1, 0.2) * (i === 0 ? 1.3 : 1);
      const ox = i === 0 ? 0 : rand(-0.6, 0.6) * scale, oz = i === 0 ? 0 : rand(-0.6, 0.6) * scale;
      const tx = i === 0 ? rand(-0.15, 0.15) : rand(-tilt, tilt), tz = i === 0 ? rand(-0.15, 0.15) : rand(-tilt, tilt);
      const m = composeMatrix(x + ox, y - 0.1, z + oz, tx, rand(0, TAU), tz);
      this.part(GEO.cyl6, M.crystal, m, 0, len * 0.35, 0, r, len * 0.7, r, { cast: false, receive: false });
      this.part(GEO.cone6, M.crystal, m, 0, len * 0.7 + len * 0.13, 0, r, len * 0.26, r, { cast: false, receive: false });
    }
    // Rubble at the base.
    for (let i = 0; i < Math.round(scale * 3); i++) {
      const s = rand(0.12, 0.3) * scale;
      this.add(GEO.rock, M.rock, composeMatrix(x + rand(-0.8, 0.8) * scale, y + s * 0.4, z + rand(-0.8, 0.8) * scale, rand(0, 3), rand(0, 3), 0, s, s * 0.7, s));
    }
    if (collide) this.world.addCircle(x, z, 0.45 * scale + 0.2, y - 1, y + 2.5 * scale);
    this.reserve(x, z, 0.6 * scale + 0.2);
    if (light) this.lightSpots.push({ kind: 'crystal', pos: new THREE.Vector3(x, y + 1.2 * scale, z), weight: scale });
  }

  tower(x, z, baseY, topY, w, { windows = true, roof = null, cast = false, windowChance = 0.5 } = {}) {
    const M = this.M;
    const h = topY - baseY;
    const opts = { cast, receive: true };
    roof ??= { spire: pick(['spire', 'spire', 'crown']), dome: pick(['dome', 'dome', 'crown']), ziggurat: pick(['ziggurat', 'ziggurat', 'crown']) }[this.style.roof];
    this.add(worldBoxGeometry(w, h, w), this.sideMat, composeMatrix(x, baseY + h / 2, z), opts);
    for (let y = baseY + 6; y < topY - 1; y += rand(5, 9)) this.add(worldBoxGeometry(w + 0.4, 0.4, w + 0.4), M.trim, composeMatrix(x, y, z), opts);
    for (const [bx, bz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      this.add(worldBoxGeometry(0.5, h * 0.9, 0.5), M.trim, composeMatrix(x + bx * w * 0.5, baseY + h * 0.45, z + bz * w * 0.5), opts);
    }
    if (windows) {
      for (let y = topY - 3; y > Math.max(baseY, topY - 40); y -= rand(2.5, 5)) {
        for (let f = 0; f < 4; f++) {
          if (!chance(windowChance)) continue;
          const a = (f * Math.PI) / 2;
          const nx = Math.sin(a), nz = Math.cos(a);
          const wm = chance(0.65) ? M.windowWarm : M.windowCold;
          this.add(GEO.cube, wm, composeMatrix(x + nx * (w / 2 + 0.02), y, z + nz * (w / 2 + 0.02), 0, a, 0, w * 0.18, 1.1, 0.06), { cast: false, receive: false });
        }
      }
    }
    if (roof === 'dome') {
      this.add(worldBoxGeometry(w + 0.5, 0.5, w + 0.5), M.trim, composeMatrix(x, topY + 0.25, z), opts);
      this.add(GEO.drum, M.brick, composeMatrix(x, topY + 0.9, z, 0, 0, 0, w * 0.45, 0.9, w * 0.45), opts);
      this.add(GEO.dome, M.trim, composeMatrix(x, topY + 1.35, z, 0, 0, 0, w * 0.47, w * 0.42, w * 0.47), opts);
      this.add(GEO.cone6, M.trim, composeMatrix(x, topY + 1.35 + w * 0.42 + 0.3, z, 0, 0, 0, 0.18, 0.6, 0.18), opts);
    } else if (roof === 'ziggurat') {
      let yy = topY, ww = w;
      for (let i = 0; i < 3; i++) {
        ww *= 0.72;
        this.add(worldBoxGeometry(ww, 0.9, ww), i % 2 ? M.trim : M.rock, composeMatrix(x, yy + 0.45, z), opts);
        yy += 0.9;
      }
    } else if (roof === 'spire') {
      const rh = w * rand(1.4, 2.6);
      this.add(GEO.cone4, M.trim, composeMatrix(x, topY + rh / 2, z, 0, Math.PI / 4, 0, w * 0.75, rh, w * 0.75), opts);
      for (const [bx, bz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        this.add(GEO.cone4, M.trim, composeMatrix(x + bx * w * 0.5, topY + 0.8, z + bz * w * 0.5, 0, Math.PI / 4, 0, 0.35, 1.6, 0.35), opts);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        this.add(worldBoxGeometry(w * 0.3, 0.8, 0.4), M.trim, composeMatrix(x + Math.sin(a) * w * 0.4, topY + 0.4, z + Math.cos(a) * w * 0.4, 0, a), opts);
      }
    }
  }

  statue(x, z, y, ry = rand(0, TAU)) {
    const M = this.M;
    const m = composeMatrix(x, y, z, 0, ry);
    this.part(GEO.cube, M.trim, m, 0, 0.35, 0, 1.3, 0.7, 1.3);
    this.part(GEO.cone7, M.stone, m, 0, 1.75, 0, 0.62, 2.1, 0.62);
    this.part(GEO.cube, M.stone, m, 0, 2.55, 0, 0.9, 0.35, 0.55);
    this.part(GEO.cone6, M.stone, m, 0, 3.05, 0.02, 0.3, 0.75, 0.3);
    this.part(GEO.cube, M.void, m, 0, 2.95, 0.2, 0.26, 0.28, 0.06, { cast: false, receive: false });
    // Greatsword planted before the figure, hands folded over the pommel.
    this.part(GEO.cube, M.stone, m, 0, 1.6, 0.55, 0.12, 2.1, 0.05);
    this.part(GEO.cube, M.stone, m, 0, 2.3, 0.55, 0.6, 0.1, 0.1);
    this.part(GEO.cube, M.stone, m, 0, 2.45, 0.5, 0.35, 0.22, 0.2);
    this.world.addCircle(x, z, 0.8, y - 1, y + 3.4);
    this.reserve(x, z, 1);
  }

  brazier(x, z, y) {
    const M = this.M;
    const m = composeMatrix(x, y, z);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      this.part(GEO.cube, M.iron, m, Math.cos(a) * 0.3, 0.5, Math.sin(a) * 0.3, 0.08, 1.0, 0.08, undefined, 0, 0, Math.cos(a) * 0.2);
    }
    this.add(new THREE.CylinderGeometry(0.55, 0.3, 0.35, 8), M.iron, composeMatrix(x, y + 1.1, z));
    this.add(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 8), M.flame, composeMatrix(x, y + 1.25, z), { cast: false, receive: false });
    this.world.addCircle(x, z, 0.6, y - 1, y + 1.4);
    this.reserve(x, z, 0.8);
    this.lightSpots.push({ kind: 'warm', pos: new THREE.Vector3(x, y + 1.9, z), weight: 2 });
    this.emitters.push({ kind: 'fire', pos: new THREE.Vector3(x, y + 1.3, z), spread: 0.3 });
  }

  lanternPost(x, z, y) {
    const M = this.M;
    this.add(new THREE.BoxGeometry(0.14, 2.6, 0.14), M.iron, composeMatrix(x, y + 1.3, z));
    this.add(new THREE.BoxGeometry(0.7, 0.08, 0.08), M.iron, composeMatrix(x + 0.3, y + 2.55, z));
    this.add(new THREE.BoxGeometry(0.26, 0.36, 0.26), M.iron, composeMatrix(x + 0.6, y + 2.2, z));
    this.add(new THREE.BoxGeometry(0.18, 0.26, 0.28), M.flame, composeMatrix(x + 0.6, y + 2.2, z), { cast: false, receive: false });
    this.world.addCircle(x, z, 0.25, y - 1, y + 2.7);
    this.reserve(x, z, 0.5);
    this.lightSpots.push({ kind: 'warm', pos: new THREE.Vector3(x + 0.6, y + 2.1, z), weight: 1 });
  }

  candles(x, z, y, count) {
    const M = this.M;
    for (let i = 0; i < count; i++) {
      const h = rand(0.15, 0.5);
      const cx = x + rand(-0.4, 0.4), cz = z + rand(-0.4, 0.4);
      this.add(new THREE.BoxGeometry(0.08, h, 0.08), M.wax, composeMatrix(cx, y + h / 2, cz), { cast: false, receive: true });
      this.flames.push({ pos: new THREE.Vector3(cx, y + h + 0.06, cz), seed: rand(0, 100) });
    }
  }

  bones(x, z, y) {
    const M = this.M;
    for (let j = 0; j < randInt(3, 6); j++) {
      this.add(new THREE.BoxGeometry(rand(0.35, 0.6), 0.07, 0.08), M.bone,
        composeMatrix(x + rand(-0.6, 0.6), y + 0.04, z + rand(-0.6, 0.6), 0, rand(0, TAU)), { cast: false, receive: true });
    }
    if (chance(0.6)) {
      const m = composeMatrix(x, y + 0.12, z, 0, rand(0, TAU));
      this.part(GEO.cube, M.bone, m, 0, 0, 0, 0.26, 0.22, 0.28, { cast: false, receive: true });
      this.part(GEO.cube, M.void, m, -0.06, 0.01, 0.141, 0.07, 0.06, 0.01, { cast: false, receive: false });
      this.part(GEO.cube, M.void, m, 0.06, 0.01, 0.141, 0.07, 0.06, 0.01, { cast: false, receive: false });
    }
  }

  chain(x, z, yTop, yBottom) {
    const M = this.M;
    let i = 0;
    for (let y = yTop; y > yBottom; y -= 0.22, i++) {
      this.add(new THREE.BoxGeometry(0.05, 0.26, i % 2 ? 0.14 : 0.05), M.iron, composeMatrix(x, y, z, 0, 0, 0), { cast: false, receive: true });
    }
  }

  banner(x, z, y, ry) {
    const M = this.M;
    this.add(new THREE.BoxGeometry(1.2, 0.08, 0.08), M.iron, composeMatrix(x, y, z, 0, ry));
    this.add(new THREE.BoxGeometry(1.0, 2.6, 0.04), M.cloth, composeMatrix(x, y - 1.35, z, 0, ry), { cast: true, receive: true });
    // Tattered tail.
    this.add(new THREE.BoxGeometry(0.45, 0.6, 0.04), M.cloth, composeMatrix(x - 0.2, y - 2.9, z, 0, ry, 0.1), { cast: true, receive: true });
  }

  stalactites(count, cx, cz, radius, yMin, yMax, lenMin, lenMax, mat = this.M.rock) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * radius;
      const len = rand(lenMin, lenMax), w = len * rand(0.12, 0.25);
      this.add(GEO.cone7, mat, composeMatrix(cx + Math.cos(a) * r, rand(yMin, yMax) - len / 2, cz + Math.sin(a) * r, Math.PI, rand(0, TAU), 0, w, len, w), { cast: false, receive: true });
    }
  }

  stalagmite(x, z, y, h) {
    const w = h * rand(0.18, 0.28);
    this.add(GEO.cone7, this.M.rock, composeMatrix(x, y + h / 2 - 0.1, z, rand(-0.1, 0.1), rand(0, TAU), rand(-0.1, 0.1), w, h, w));
    this.world.addCircle(x, z, w * 0.8, y - 1, y + h);
    this.reserve(x, z, w);
  }

  // ---- The endless cathedral-cavern beyond the chamber -----------------------

  fungus(x, z, y, scale = 1, { light = true, collide = true } = {}) {
    const M = this.M;
    for (let i = 0; i < randInt(3, 7); i++) {
      const h = scale * rand(0.3, 1.6) * (i === 0 ? 1.4 : 1);
      const cx = x + (i ? rand(-0.7, 0.7) * scale : 0), cz = z + (i ? rand(-0.7, 0.7) * scale : 0);
      const lean = rand(-0.25, 0.25);
      this.add(GEO.cyl6, M.bone, composeMatrix(cx, y + h / 2, cz, lean, 0, lean, 0.06 * scale + 0.04, h, 0.06 * scale + 0.04), { cast: false });
      const cap = scale * rand(0.22, 0.55) * (i === 0 ? 1.5 : 1);
      this.add(GEO.cone7, M.crystal, composeMatrix(cx + lean * h * 0.5, y + h, cz + lean * h * 0.5, Math.PI, 0, 0, cap, cap * 0.45, cap), { cast: false, receive: false });
    }
    for (let i = 0; i < 3; i++) this.moss(x + rand(-1, 1) * scale, z + rand(-1, 1) * scale, y, rand(0.5, 1.1) * scale);
    if (collide) this.world.addCircle(x, z, 0.35 * scale + 0.2, y - 1, y + 2 * scale);
    this.reserve(x, z, 0.6 * scale + 0.2);
    if (light) this.lightSpots.push({ kind: 'crystal', pos: new THREE.Vector3(x, y + 1.3 * scale, z), weight: scale * 0.8 });
  }

  overgrowth(x, z, y, scale = 1, { collide = true } = {}) {
    const M = this.M;
    if (scale > 1.3 && chance(0.6)) this.tree(x, z, y, scale * 0.8, chance(0.15));
    else {
      for (let i = 0; i < randInt(2, 4); i++) {
        const s = scale * rand(0.5, 1.0);
        this.add(GEO.ico, pick(M.leaf), composeMatrix(x + rand(-0.6, 0.6) * scale, y + s * 0.45, z + rand(-0.6, 0.6) * scale, rand(0, 3), rand(0, 3), 0, s, s * 0.7, s));
      }
      if (collide) this.world.addCircle(x, z, 0.5 * scale + 0.2, y - 1, y + 1.5 * scale);
    }
    for (let i = 0; i < 6; i++) this.grass.push({ x: x + rand(-1.8, 1.8) * scale, y, z: z + rand(-1.8, 1.8) * scale });
    this.reserve(x, z, 0.7 * scale + 0.2);
  }

  rockSpire(x, z, y, scale) {
    const h = scale * rand(4, 9);
    this.add(GEO.rock, this.M.rock, composeMatrix(x, y + h / 2, z, rand(0, 0.3), rand(0, 3), rand(0, 0.3), scale * 1.5, h, scale * 1.3), { cast: false });
  }

  moss(x, z, y, r) {
    const g = new THREE.CircleGeometry(r, 7).rotateX(-Math.PI / 2);
    this.add(g, this.M.moss, composeMatrix(x, y + 0.015, z, 0, rand(0, TAU), 0, rand(0.7, 1.3), 1, 1), { cast: false, receive: true });
  }

  /** Tree with a bent trunk, forking branches and leafy clumps (or bare twigs). */
  tree(x, z, y, scale = 1, dead = false) {
    const M = this.M;
    const link = (ax, ay, az, bx, by, bz, r0, r1, mat) => {
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), new THREE.Vector3(0, 1, 0.001));
      const geo = new THREE.CylinderGeometry(r0, r1, len, 5).rotateX(Math.PI / 2).translate(0, 0, -len / 2);
      this.add(geo, mat, new THREE.Matrix4().makeTranslation(ax, ay, az).multiply(m));
    };
    let px = x, py = y - 0.2, pz = z, r = 0.3 * scale;
    let lean = rand(0, TAU);
    for (let i = 0; i < 3; i++) {
      const h = rand(1, 1.6) * scale, t = rand(0.1, 0.35);
      const nx = px + Math.cos(lean) * Math.sin(t) * h, nz = pz + Math.sin(lean) * Math.sin(t) * h, ny = py + h;
      link(px, py, pz, nx, ny, nz, r, r * 0.78, M.bark);
      px = nx; py = ny; pz = nz; r *= 0.78;
      lean += rand(-0.9, 0.9);
    }
    for (let i = 0; i < randInt(3, 6); i++) {
      const a = rand(0, TAU), bl = rand(1.2, 2.4) * scale;
      const ex = px + Math.cos(a) * bl, ey = py + rand(0.2, 1) * bl * 0.8, ez = pz + Math.sin(a) * bl;
      link(px, py - rand(0, 0.5), pz, ex, ey, ez, r * 0.7, r * 0.3, M.bark);
      if (dead) link(ex, ey, ez, ex + rand(-0.8, 0.8), ey + rand(0.3, 0.9), ez + rand(-0.8, 0.8), r * 0.3, 0.02, M.bark);
      else for (let j = 0; j < 2; j++) {
        const sz = rand(0.9, 1.7) * scale;
        this.add(GEO.ico, pick(M.leaf), composeMatrix(ex + rand(-0.5, 0.5), ey + rand(-0.2, 0.5), ez + rand(-0.5, 0.5), rand(0, 3), rand(0, 3), 0, sz, sz * 0.72, sz));
      }
    }
    this.world.addCircle(x, z, 0.4 * scale, y - 1, y + 4 * scale);
    this.reserve(x, z, 0.6 * scale);
  }

  /** Thick roots crawling over a platform's rim. */
  roots(x, z, y) {
    const a0 = rand(0, TAU);
    for (let i = 0; i < randInt(2, 4); i++) {
      const a = a0 + rand(-0.7, 0.7), len = rand(1.5, 3.5), r = rand(0.08, 0.2);
      const m = composeMatrix(x + Math.cos(a) * len * 0.4, y + r * 0.5, z + Math.sin(a) * len * 0.4, 0, -a, Math.PI / 2 + rand(-0.15, 0.15), r, len, r);
      this.add(GEO.cyl6, this.M.bark, m, { cast: true });
    }
  }

  vines(x, z, yTop, yBottom) {
    for (let i = 0; i < randInt(2, 4); i++) {
      const len = rand(0.5, 1) * (yTop - yBottom);
      this.add(GEO.cube, this.M.moss, composeMatrix(x + rand(-0.4, 0.4), yTop - len / 2, z + rand(-0.4, 0.4), 0, rand(0, 3), 0, 0.05, len, 0.2), { cast: false });
    }
  }

  /** Glowing fissure across a floor. */
  lavaCrack(x, z, y) {
    let a = rand(0, TAU), px = x, pz = z;
    for (let i = 0; i < randInt(3, 6); i++) {
      const len = rand(0.6, 1.4);
      const nx = px + Math.cos(a) * len, nz = pz + Math.sin(a) * len;
      this.add(GEO.cube, this.M.lava, composeMatrix((px + nx) / 2, y + 0.01, (pz + nz) / 2, 0, -a, 0, len + 0.05, 0.03, rand(0.06, 0.14)), { cast: false, receive: false });
      px = nx; pz = nz;
      a += rand(-0.8, 0.8);
    }
  }

  spikes(x, z, y) {
    for (let i = 0; i < randInt(3, 6); i++) {
      const h = rand(0.5, 1.4);
      this.add(GEO.cone4, this.M.iron, composeMatrix(x + rand(-0.5, 0.5), y + h / 2, z + rand(-0.5, 0.5), rand(-0.3, 0.3), rand(0, 3), rand(-0.3, 0.3), 0.08, h, 0.08));
    }
    this.world.addCircle(x, z, 0.7, y - 1, y + 1.2);
    this.reserve(x, z, 0.9);
  }

  rubble(x, z, y, r = 1) {
    for (let i = 0; i < randInt(3, 7); i++) {
      const s = rand(0.12, 0.35) * r;
      this.add(GEO.rock, this.M.rock, composeMatrix(x + rand(-r, r), y + s * 0.4, z + rand(-r, r), rand(0, 3), rand(0, 3), 0, s * rand(1, 1.6), s * 0.7, s));
    }
  }

  /** Freestanding gothic arch framing a walkway. */
  archway(x, z, y, ang, w = 4, h = 5.5) {
    const geo = archWallGeometry(w + 1.4, h, 0.8, [{ cx: 0, halfW: w / 2, spring: h * 0.5, peak: h * 0.88 }], this.style.arch);
    this.add(geo, this.sideMat, composeMatrix(x, y, z, 0, ang));
    for (const s of [-1, 1]) this.world.addCircle(x + Math.cos(ang) * s * (w / 2 + 0.35), z - Math.sin(ang) * s * (w / 2 + 0.35), 0.45, y - 1, y + h);
  }

  // ---- The endless cathedral-cavern beyond the floor -------------------------

  /** Background scenery for a whole floor, ringing its bounds; style depends on the biome. */
  vista(cx, cz, inner, outer) {
    const id = this.biome.id;
    const M = this.M;
    const ring = (count, fn) => {
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU), r = rand(inner, outer);
        fn(cx + Math.cos(a) * r, cz + Math.sin(a) * r, i);
      }
    };
    if (id === 'crystal' || id === 'ember') {
      ring(randInt(40, 60), (x, z) => this.tower(x, z, -80, rand(-12, 30), rand(3, 9), { windowChance: 0.35 }));
      ring(randInt(14, 22), (x, z) => this.crystals(x, z, rand(-35, -2), rand(2.5, 7), { light: false, collide: false, count: randInt(4, 8) }));
      if (id === 'ember') {
        ring(randInt(8, 14), (x, z) => this.add(GEO.cube, M.lava, composeMatrix(x, -30, z, 0, rand(0, 3), 0, rand(1.5, 4), 60, rand(0.4, 1.2)), { cast: false, receive: false }));
        ring(randInt(10, 16), (x, z) => this.chain(x, z, 30, rand(0, 15)));
      }
    } else if (id === 'sunken') {
      ring(randInt(30, 45), (x, z) => {
        const top = rand(-4, 18);
        this.tower(x, z, -20, top, rand(3, 7), { windowChance: 0.15, roof: chance(0.6) ? 'spire' : 'crown' });
        if (chance(0.3)) this.tree(x + rand(-3, 3), z + rand(-3, 3), -0.6, rand(1.2, 2), true);
      });
      ring(randInt(8, 12), (x, z) => {
        const len = rand(12, 26), h = rand(8, 14), ang = rand(0, TAU);
        const spans = Math.max(2, Math.round(len / 7));
        const arcs = [];
        for (let s = 0; s < spans; s++) arcs.push({ cx: -len / 2 + (len / spans) * (s + 0.5), halfW: len / spans / 2 - 0.7, spring: h * 0.45, peak: h * 0.9 });
        this.add(archWallGeometry(len, h, 1.6, arcs), M.brick, composeMatrix(x, -2, z, 0, ang), { cast: false });
      });
      ring(randInt(20, 30), (x, z) => this.tree(x, z, -0.6, rand(0.8, 1.6), chance(0.7)));
    } else {
      ring(randInt(26, 40), (x, z) => {
        const h = rand(10, 40), w = rand(6, 16);
        this.add(GEO.rock, M.rock, composeMatrix(x, -30 + h / 2, z, rand(0, 0.2), rand(0, 3), rand(0, 0.2), w, h + 30, w * rand(0.7, 1.2)), { cast: false });
        if (chance(0.6)) this.add(GEO.ico, pick(M.leaf), composeMatrix(x, h - 30 + (h + 30) / 2 - 1, z, 0, rand(0, 3), 0, w * 0.8, 2, w * 0.7), { cast: false });
        if (chance(0.35)) this.tower(x, z, h - 12, h + rand(4, 14), rand(3, 5), { windowChance: 0.1, roof: 'crown' });
      });
    }
    if (id !== 'sunlit') this.stalactites(randInt(60, 90), cx, cz, outer, 26, 40, 6, 20);
  }

  // ---- Balustrades grown along every open edge -------------------------------

  parapets({ breakChance = 0.05 } = {}) {
    for (const s of this.world.surfaces) {
      if (!s.parapet) continue;
      for (const edge of edgesOf(s)) this.edgeParapet(s, edge, breakChance);
    }
  }

  edgeParapet(s, edge, breakChance) {
    const W = this.world;
    const closed = edge.map((p) => {
      const tx = p.x + p.nx * 0.45, tz = p.z + p.nz * 0.45;
      for (const t of W.surfaces) {
        if (t === s) continue;
        const h = W.heightOf(t, tx, tz);
        if (h !== null && Math.abs(h - p.y) < 0.75) return false;
      }
      return true;
    });
    let i = 0;
    while (i < edge.length) {
      if (!closed[i]) { i++; continue; }
      let j = i;
      while (j + 1 < edge.length && closed[j + 1]) j++;
      const run = edge.slice(i, j + 1);
      if (run.length > 10 && chance(breakChance)) {
        const cut = randInt(3, run.length - 5);
        this.parapetRun(s, run.slice(0, cut));
        this.parapetRun(s, run.slice(cut + 3));
      } else this.parapetRun(s, run);
      i = j + 1;
    }
  }

  parapetRun(s, run) {
    if (run.length < 2) return;
    const M = this.M;
    const style = s.style === 'rock' ? 'rock' : this.style.parapet;
    const inset = 0.18;
    const pts = run.map((p) => ({ x: p.x - p.nx * inset, z: p.z - p.nz * inset, y: p.y }));
    for (const p of pts) this.world.addCircle(p.x, p.z, 0.24, p.y - 0.6, p.y + 1.25);

    if (style === 'menhir') {
      // Standing stones, leaning like old teeth, with a kerb of rubble between.
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        if (k % 3 === 0) {
          const h = rand(0.9, 1.8);
          this.add(worldBoxGeometry(rand(0.35, 0.55), h, rand(0.3, 0.45)), M.rock,
            composeMatrix(p.x, p.y + h / 2 - 0.1, p.z, rand(-0.12, 0.12), rand(0, TAU), rand(-0.12, 0.12)));
        } else if (chance(0.6)) {
          const sc = rand(0.18, 0.32);
          this.add(GEO.rock, M.rock, composeMatrix(p.x, p.y + sc * 0.4, p.z, rand(0, 3), rand(0, 3), 0, sc, sc * 0.8, sc));
        }
      }
      return;
    }

    if (style === 'rock') {
      for (let k = 0; k < pts.length; k += 2) {
        const p = pts[k], sc = rand(0.35, 0.7);
        this.add(GEO.rock, M.rock, composeMatrix(p.x, p.y + sc * 0.5, p.z, rand(0, 3), rand(0, 3), 0, sc, sc * rand(0.8, 1.6), sc));
      }
      return;
    }
    // Straight chords of ~3 samples approximate curves.
    const step = s.kind === 'disc' || s.kind === 'ring' ? 3 : pts.length - 1;
    for (let a = 0; a < pts.length - 1; a += step) {
      const b = Math.min(pts.length - 1, a + step);
      const p = pts[a], q = pts[b];
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 0.05) continue;
      const ang = Math.atan2(q.x - p.x, q.z - p.z);
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, my = (p.y + q.y) / 2;
      const pitch = -Math.atan2(q.y - p.y, len);
      if (style === 'crenel') {
        // A solid breastwork topped with merlons.
        this.add(worldBoxGeometry(0.5, 0.75, len + 0.3), M.brick, composeMatrix(mx, my + 0.37, mz, pitch, ang));
        this.add(worldBoxGeometry(0.62, 0.12, len + 0.35), M.trim, composeMatrix(mx, my + 0.8, mz, pitch, ang));
        const merlons = Math.max(1, Math.round(len / 1.1));
        for (let k = 0; k < merlons; k++) {
          const t = (k + 0.5) / merlons;
          this.add(GEO.cube, M.brick, composeMatrix(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t + 1.1, p.z + (q.z - p.z) * t, 0, ang, 0, 0.5, 0.5, 0.55));
        }
        continue;
      }
      this.add(worldBoxGeometry(0.42, 0.25, len + 0.3), M.trim, composeMatrix(mx, my + 0.12, mz, pitch, ang));
      this.add(worldBoxGeometry(0.36, 0.14, len + 0.3), M.trim, composeMatrix(mx, my + 0.95, mz, pitch, ang));
      const posts = Math.max(1, Math.round(len / 0.45));
      for (let k = 0; k <= posts; k++) {
        const t = k / posts;
        const heavy = k === 0 || k === posts;
        const w = heavy ? 0.3 : 0.12;
        this.add(GEO.cube, M.stone, composeMatrix(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t + 0.55, p.z + (q.z - p.z) * t, 0, ang, 0, w, 0.7, w));
      }
    }
  }

  /** A pale column of light falling from some unseen crack far above, with drifting motes. */
  lightShaft(x, z, y, r) {
    this.shafts.push({ x, z, y, r });
    this.emitters.push({ kind: 'motes', pos: new THREE.Vector3(x, y, z), spread: r });
  }

  finish(group) {
    this.parapets({ breakChance: this.ch.type === 'combat' ? 0.06 : 0 });
    this.batch.build(group);
    for (const s of this.shafts) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.6, s.r * 1.6, 26, 12, 1, true), this.M.shaft);
      shaft.position.set(s.x, s.y + 13, s.z);
      group.add(shaft);
    }
  }
}

// ---- Surface sampling -------------------------------------------------------

function localToWorld(s, lx, lz) {
  return [s.cx + lx * s.cos + lz * s.sin, s.cz - lx * s.sin + lz * s.cos];
}

function surfaceY(s, lz) {
  if (s.kind === 'ramp') return s.y0 + (s.y1 - s.y0) * ((lz + s.hd) / (2 * s.hd));
  return s.y;
}

/** Edge polylines of a surface: arrays of { x, z, y, nx, nz } spaced ~0.5 apart. */
export function edgesOf(s) {
  const out = [];
  if (s.kind === 'rect' || s.kind === 'ramp') {
    const c = [[-s.hw, -s.hd], [s.hw, -s.hd], [s.hw, s.hd], [-s.hw, s.hd]];
    const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let e = 0; e < 4; e++) {
      if (s.kind === 'ramp' && e % 2 === 0) continue;
      const [ax, az] = c[e], [bx, bz] = c[(e + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(len / 0.5));
      const [lnx, lnz] = normals[e];
      const nx = lnx * s.cos + lnz * s.sin, nz = -lnx * s.sin + lnz * s.cos;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
        const [x, z] = localToWorld(s, lx, lz);
        pts.push({ x, z, y: surfaceY(s, lz), nx, nz });
      }
      out.push(pts);
    }
  } else {
    const circles = s.kind === 'disc' ? [[s.r, 1]] : [[s.r1, 1], [s.r0, -1]];
    for (const [r, sign] of circles) {
      const n = Math.max(12, Math.ceil((TAU * r) / 0.5));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        pts.push({ x: s.cx + ca * r, z: s.cz + sa * r, y: s.y, nx: ca * sign, nz: sa * sign });
      }
      out.push(pts);
    }
  }
  return out;
}

export function samplePoint(s, margin = 1) {
  switch (s.kind) {
    case 'rect': case 'ramp': {
      if (s.hw <= margin || s.hd <= margin) return null;
      const lx = rand(-s.hw + margin, s.hw - margin), lz = rand(-s.hd + margin, s.hd - margin);
      const [x, z] = localToWorld(s, lx, lz);
      return { x, z, y: surfaceY(s, lz) };
    }
    case 'disc': {
      if (s.r <= margin) return null;
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * (s.r - margin);
      return { x: s.cx + Math.cos(a) * r, z: s.cz + Math.sin(a) * r, y: s.y };
    }
    case 'ring': {
      const a = rand(0, TAU), r = rand(s.r0 + margin, s.r1 - margin);
      if (s.r1 - s.r0 <= margin * 2) return null;
      return { x: s.cx + Math.cos(a) * r, z: s.cz + Math.sin(a) * r, y: s.y };
    }
  }
  return null;
}

function rimPoint(s, inset) {
  switch (s.kind) {
    case 'rect': {
      const side = randInt(0, 3);
      const along = side % 2 === 0 ? rand(-s.hw + inset, s.hw - inset) : rand(-s.hd + inset, s.hd - inset);
      const lx = side === 1 ? s.hw - inset : side === 3 ? -s.hw + inset : along;
      const lz = side === 0 ? -s.hd + inset : side === 2 ? s.hd - inset : along;
      const [x, z] = localToWorld(s, lx, lz);
      return { x, z, y: s.y };
    }
    case 'disc': {
      const a = rand(0, TAU), r = s.r - inset;
      return r > 0 ? { x: s.cx + Math.cos(a) * r, z: s.cz + Math.sin(a) * r, y: s.y } : null;
    }
    case 'ring': {
      const a = rand(0, TAU), r = chance(0.5) ? s.r1 - inset : s.r0 + inset;
      return { x: s.cx + Math.cos(a) * r, z: s.cz + Math.sin(a) * r, y: s.y };
    }
  }
  return null;
}
