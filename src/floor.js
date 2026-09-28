import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIRS, ARCH_STYLES } from './config.js';
import { World } from './physics.js';
import { Builder } from './architecture.js';
import { rand, pick, shuffle, chance, TAU, composeMatrix } from './util.js';
import * as Textures from './textures.js';
import { Chamber, CELL, GATE_PLANE, LEVEL_HEIGHT } from './chamber.js';
import { COMBAT_LAYOUTS, latOf } from './layouts.js';
import { createSkyDome } from './sky.js';
import { Lift, ShortcutGate } from './lifts.js';
import { findLadders, Ladder } from './ladders.js';

const key = (x, y) => `${x},${y}`;
const DIR_OF = { '1,0': 'e', '-1,0': 'w', '0,1': 's', '0,-1': 'n' };

/**
 * A whole floor: one continuous, tiered world of chambers.
 *
 *  - Chambers sit on a grid of cells, but the paths between them form loops, not a tree, so
 *    there is always another way round and never a long walk back.
 *  - Chambers stand on different tiers (LEVEL_HEIGHT apart): passages climb by stairs between
 *    neighbouring tiers, and by lifts where the drop is too great.
 *  - Some cells are stacked: a high span bridges across above a lower chamber, with a lift
 *    between them.
 *  - Some loop passages are shortcuts: a portcullis with a lever on one side only.
 *  - Far beyond the guardian's arena rises the floor's citadel, a landmark seen from anywhere.
 */
export class DungeonFloor {
  constructor(game, depth, biome, style = ARCH_STYLES.gothic) {
    this.game = game;
    this.depth = depth;
    this.biome = biome;
    this.style = style;
    this.rooms = new Map();
    this.spans = new Map();
    this.edges = [];
    this.lifts = [];
    this.gates = [];
    this.layoutBag = [];
    this.grassSpots = [];
    this.active = [];
    this.activeEnemies = [];
    // Now and then a rift to a deal realm lies hidden on the floor, opening once enough falls.
    this.hiddenPortal = Math.random() < 0.35;
    this.cleared = 0;
    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.generate();
  }

  /** Chamber archetypes are dealt from the floor style's own deck, so no two floors look alike. */
  nextLayout(allowed = null) {
    const ok = (k) => COMBAT_LAYOUTS[k] && (!allowed || allowed.includes(k));
    let i = this.layoutBag.findIndex(ok);
    if (i < 0) {
      this.layoutBag = shuffle(this.style.layouts.filter((k) => COMBAT_LAYOUTS[k]));
      i = this.layoutBag.findIndex(ok);
    }
    if (i < 0) return pick((allowed || Object.keys(COMBAT_LAYOUTS)).filter((k) => COMBAT_LAYOUTS[k]));
    return this.layoutBag.splice(i, 1)[0];
  }

  get(x, y) { return this.rooms.get(key(x, y)); }
  getSpan(x, y) { return this.spans.get(key(x, y)); }
  get allRooms() { return [...this.rooms.values(), ...this.spans.values()]; }

  /** The chamber at a point — in a stacked cell, whichever tier the knight is nearer. */
  roomAt(x, z, y = 0) {
    const gx = Math.round(x / CELL), gy = Math.round(z / CELL);
    const g = this.get(gx, gy), s = this.getSpan(gx, gy);
    if (!s || !g) return s || g || null;
    return y > (s.elev + g.elev) / 2 + 2 ? s : g;
  }

  // ---- Generation ------------------------------------------------------------

  generate() {
    const target = Math.min(9 + this.depth * 2, 15);
    for (let attempt = 0; attempt < 300; attempt++) {
      // 1. A compact blob of cells, inside a bounding box (the start sits off-centre in it), so
      //    neighbours touch on many sides and the paths can close into loops.
      const cells = new Map([[key(0, 0), [0, 0]]]);
      const [bw, bh] = pick([[5, 4], [4, 5], [5, 5], [6, 3], [3, 6]]);
      const x0 = -Math.floor(Math.random() * bw), y0 = -Math.floor(Math.random() * bh);
      for (let guard = 0; cells.size < target && guard < 2000; guard++) {
        const [cx, cy] = pick([...cells.values()]);
        const d = pick(Object.values(DIRS));
        const nx = cx + d.dx, ny = cy + d.dy;
        if (nx < x0 || nx >= x0 + bw || ny < y0 || ny >= y0 + bh || cells.has(key(nx, ny))) continue;
        // Compact enough to close loops, loose enough to keep some long arms.
        const touching = Object.values(DIRS).filter((q) => cells.has(key(nx + q.dx, ny + q.dy))).length;
        if (touching >= 3 && chance(0.5)) continue;
        cells.set(key(nx, ny), [nx, ny]);
      }
      if (cells.size < target) continue;
      const adj = (k) => {
        const [x, y] = cells.get(k);
        return Object.values(DIRS).map((d) => key(x + d.dx, y + d.dy)).filter((n) => cells.has(n));
      };
      // 2. A random spanning tree — the bones of the floor.
      const tree = new Set();
      const seen = new Set([key(0, 0)]);
      const stack = [key(0, 0)];
      while (stack.length) {
        const k = stack[stack.length - 1];
        const next = shuffle(adj(k).filter((n) => !seen.has(n)));
        if (!next.length) { stack.pop(); continue; }
        const n = next[0];
        seen.add(n);
        tree.add(edgeKey(k, n));
        stack.push(n);
      }
      const treeDeg = (k) => adj(k).filter((n) => tree.has(edgeKey(k, n))).length;
      const treeDist = bfs(cells, (k) => adj(k).filter((n) => tree.has(edgeKey(k, n))));
      const leaves = [...cells.keys()].filter((k) => k !== key(0, 0) && treeDeg(k) === 1)
        .sort((a, b) => treeDist.get(b) - treeDist.get(a));
      if (leaves.length < 2 || treeDist.get(leaves[0]) < 3) continue;
      // Dead ends are cut off from loops, so prefer tucked-away leaves (fewest neighbours).
      const tucked = (k) => adj(k).length;
      const far = leaves.filter((k) => treeDist.get(k) >= 3).sort((a, b) => tucked(a) - tucked(b) || treeDist.get(b) - treeDist.get(a));
      const boss = far[0];
      const rest = leaves.filter((k) => k !== boss).sort((a, b) => tucked(a) - tucked(b));
      const treasure = rest[0];
      const spare = rest.slice(1);
      const shop = spare.length ? spare[0] : pick([...cells.keys()].filter((k) => k !== key(0, 0) && k !== boss && k !== treasure));
      // Only the guardian keeps a single door; the treasury and the merchant may be looped past.
      const deadEnds = new Set([boss]);

      // 3. Spans: a high bridge-hall across a cell whose chamber leaves that axis free.
      const spanCells = [];
      const maxSpans = this.depth >= 2 ? 2 : 1;
      for (const k of shuffle([...cells.keys()])) {
        if (spanCells.length >= maxSpans) break;
        if (k === key(0, 0) || deadEnds.has(k) || k === shop || k === treasure) continue;
        const [x, y] = cells.get(k);
        for (const axis of shuffle(['x', 'z'])) {
          const [a, b] = axis === 'x' ? [key(x - 1, y), key(x + 1, y)] : [key(x, y - 1), key(x, y + 1)];
          if (!cells.has(a) || !cells.has(b) || deadEnds.has(a) || deadEnds.has(b)) continue;
          if (tree.has(edgeKey(k, a)) || tree.has(edgeKey(k, b))) continue;
          if (spanCells.some((s) => [s.k, s.a, s.b].some((c) => [k, a, b].includes(c)))) continue;
          spanCells.push({ k, axis, a, b });
          break;
        }
      }
      // Every floor should have a stacked cell if its shape allows one; reshuffle until it does.
      if (!spanCells.length && attempt < 200) continue;
      const spanBlocked = new Set(spanCells.flatMap((s) => [edgeKey(s.k, s.a), edgeKey(s.k, s.b)]));

      // 4. Loops: extra passages between neighbours, so there is always another way round.
      const edges = new Set(tree);
      const extra = [];
      for (const k of cells.keys()) {
        for (const n of adj(k)) {
          const e = edgeKey(k, n);
          if (edges.has(e) || spanBlocked.has(e) || deadEnds.has(k) || deadEnds.has(n)) continue;
          if (chance(0.8)) { edges.add(e); extra.push(e); }
        }
      }

      // 5. Tiers: each chamber climbs or falls a level from the one it was reached from.
      const level = new Map([[key(0, 0), 0]]);
      const q = [key(0, 0)];
      while (q.length) {
        const k = q.shift();
        for (const n of adj(k)) {
          if (!edges.has(edgeKey(k, n)) || level.has(n)) continue;
          level.set(n, Math.max(0, Math.min(2, level.get(k) + pick([-1, 0, 1, 1]))));
          q.push(n);
        }
      }
      // The guardian waits above everything it guards.
      const bossNb = adj(boss).find((n) => edges.has(edgeKey(boss, n)));
      level.set(boss, Math.min(3, level.get(bossNb) + 1));

      // 6. Shortcuts: some loop passages are barred, openable only from the far side.
      const dist = bfs(cells, (k) => adj(k).filter((n) => edges.has(edgeKey(k, n))));
      const shortcuts = new Map();
      for (const e of extra) {
        if (!chance(0.45)) continue;
        const [p, r] = e.split('|');
        // The lever sits on the side farther from the start: you open it on your way back.
        shortcuts.set(e, dist.get(p) >= dist.get(r) ? p : r);
      }
      const elites = shuffle([...cells.keys()].filter((k) => !deadEnds.has(k) && k !== key(0, 0) && k !== shop && k !== treasure && dist.get(k) >= 2))
        .slice(0, this.depth >= 2 ? 2 : 1);

      // 7. Raise the chambers.
      for (const [k, [x, y]] of cells) {
        let type = 'combat';
        if (k === key(0, 0)) type = 'start';
        else if (k === boss) type = 'boss';
        else if (k === treasure) type = 'treasure';
        else if (k === shop) type = 'shop';
        else if (elites.includes(k)) type = 'elite';
        this.rooms.set(k, new Chamber(this.game, this, x, y, type, { level: level.get(k) }));
      }
      for (const s of spanCells) {
        const [x, y] = cells.get(s.k);
        const lower = this.rooms.get(s.k);
        const span = new Chamber(this.game, this, x, y, 'combat', { level: lower.level + 4, span: true });
        span.spanAxis = s.axis;
        span.below = lower;
        lower.under = true;
        lower.above = span;
        this.spans.set(s.k, span);
      }
      const link = (A, B, dir, opts = {}) => {
        A.neighbors[dir] = B;
        B.neighbors[DIRS[dir].opposite] = A;
        this.edges.push({ a: A, b: B, dir, ...opts });
      };
      for (const e of edges) {
        const [p, r] = e.split('|');
        const A = this.rooms.get(p), B = this.rooms.get(r);
        const dir = DIR_OF[`${B.gx - A.gx},${B.gy - A.gy}`];
        const lever = shortcuts.get(e);
        link(A, B, dir, lever ? { shortcut: true, leverRoom: this.rooms.get(lever) } : {});
      }
      for (const s of spanCells) {
        const span = this.spans.get(s.k);
        for (const nk of [s.a, s.b]) {
          const N = this.rooms.get(nk);
          link(span, N, DIR_OF[`${N.gx - span.gx},${N.gy - span.gy}`]);
        }
      }
      this.start = this.get(0, 0);
      return;
    }
    throw new Error('Failed to generate dungeon floor');
  }

  // ---- Building --------------------------------------------------------------

  /** Build every chamber, then stitch them together and dress the surrounding void. */
  build() {
    for (const room of this.rooms.values()) room.build();
    // Spans after the chambers beneath them, so their lift can find the floor below.
    for (const span of this.spans.values()) {
      span.liftSpot = this.findLiftSpot(span);
      span.liftAt = span.liftSpot?.u ?? null;
      span.build();
    }
    for (const e of this.edges) this.buildPassage(e);
    for (const span of this.spans.values()) if (span.liftSpot) this.buildSpanLift(span);
    this.placeLadders();
    this.buildSurroundings();
    this.buildGrass();
    for (const room of this.allRooms) room.setVisible(false);
  }

  /** Ladders out of every pit a fall can leave you in (see ladders.js). */
  placeLadders() {
    this.ladders = [];
    for (const room of this.allRooms) {
      room.ladders = [];
      for (const l of findLadders(room)) {
        const w = (p) => ({ x: p.x + room.ox, y: p.y + room.elev, z: p.z + room.oz });
        const ladder = new Ladder(this.game, this.root, w(l.base), w(l.top));
        room.ladders.push(ladder);
        room.interactables.push(ladder);
        this.ladders.push(ladder);
      }
    }
  }

  /** A spot on the span's axis with open floor beneath it, in the chamber below. */
  findLiftSpot(span) {
    const lower = span.below;
    const W = lower.world;
    for (const u of [4.5, -4.5, 6, -6, 7.5, -7.5, 9, -9, 10.5, -10.5, 12, -12, 13.5, -13.5]) {
      const [x, z] = span.spanAxis === 'x' ? [u, 0] : [0, u];
      let ok = true;
      let g = null;
      for (const [ox, oz] of [[0, 0], [1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]]) {
        const h = W.localGroundAt(x + ox, z + oz, Infinity);
        const water = W.surfaces.find((s) => s.tag === 'water');
        if (h === null || (water && h <= W.heightOf(water, x, z) + 0.01)) { ok = false; break; }
        if (g !== null && Math.abs(h - g) > 0.3) { ok = false; break; }
        g = h;
      }
      if (!ok) continue;
      // Pillars and statues in the way (balustrade posts don't count: the floor check covers edges).
      if (W.circles.some((c) => c.r > 0.3 && Math.hypot(c.x - x, c.z - z) < c.r + 1.9 && c.y1 > g + 0.2)) continue;
      if (W.boxes.some((b) => x + 2 > b.x0 && x - 2 < b.x1 && z + 2 > b.z0 && z - 2 < b.z1)) continue;
      return { u, x, z, lowY: g + lower.elev };
    }
    return null;
  }

  /** The lift between a span and the chamber beneath it. */
  buildSpanLift(span) {
    const s = span.liftSpot, lower = span.below;
    const x = span.ox + s.x, z = span.oz + s.z;
    const lift = new Lift(this.game, this.root, x, z, s.lowY, span.elev, { startHigh: false });
    const scratch = new World();
    lift.addTo(scratch);
    span.world.absorb(scratch);
    lower.world.absorb(scratch);
    lift.bind([span.world, lower.world]);
    lower.reserved.push({ x: s.x, z: s.z, r: 2.6 });
    this.lifts.push(lift);
    span.lift = lift;
  }

  /** A pseudo-chamber for building floor-level geometry in world coordinates. */
  scratch(world) {
    return { world, neighbors: {}, center: { x: 1e9, y: 0, z: 1e9 }, type: 'passage', floor: this };
  }

  /** The way between two neighbouring gatehouses: stairs, or a lift where the drop is too great. */
  buildPassage(edge) {
    const { a: A, b: B, dir } = edge;
    const d = DIRS[dir];
    const lat = latOf(dir);
    const ya = A.gates[dir].y + A.elev, yb = B.gates[d.opposite].y + B.elev;
    const ax = A.ox + d.x * GATE_PLANE, az = A.oz + d.z * GATE_PLANE;
    const bx = B.ox - d.x * GATE_PLANE, bz = B.oz - d.z * GATE_PLANE;
    const world = new World();
    if (this.biome.abyss === 'water') world.addField(() => -0.45, { tag: 'water' });
    const b = new Builder(this.game, this.scratch(world));
    // Stand-ins for the landings so the passage's own balustrade leaves its ends open.
    const vertical = d.x === 0;
    for (const [px, pz, py, s] of [[ax, az, ya, -1], [bx, bz, yb, 1]]) {
      world.addRect(px + d.x * s * 2, pz + d.z * s * 2, vertical ? 3.5 : 2.2, vertical ? 2.2 : 3.5, py, { parapet: false, tag: 'stubEnd' });
    }
    const len = Math.hypot(bx - ax, bz - az);
    const width = rand(3.2, 3.9);
    const dy = yb - ya;
    const at = (t) => [ax + d.x * t, az + d.z * t];
    let lift = null;
    if (Math.abs(dy) < 0.05) {
      b.bridge(...at(-0.3), ...at(len + 0.3), ya, width);
    } else if (Math.abs(dy) * 2.1 <= len - 1) {
      const sl = Math.min(len - 1, Math.abs(dy) * 2.1);
      const s0 = (len - sl) / 2;
      b.bridge(...at(-0.3), ...at(s0 + 0.2), ya, width);
      b.stairs(...at(s0), ...at(s0 + sl), ya, yb, width);
      b.bridge(...at(s0 + sl - 0.2), ...at(len + 0.3), yb, width);
    } else {
      // Too steep for stairs: a high walk to a lift that drops to the lower gate.
      const highA = ya > yb;
      const tl = highA ? len - 3.2 : 3.2;
      const [lx, lz] = at(tl);
      lift = new Lift(this.game, this.root, lx, lz, Math.min(ya, yb), Math.max(ya, yb), { startHigh: chance(0.5) });
      lift.addTo(world);
      if (highA) {
        b.bridge(...at(-0.3), ...at(tl - 1.6), ya, width);
        b.bridge(...at(tl + 1.6), ...at(len + 0.3), yb, width, { arches: false });
      } else {
        b.bridge(...at(-0.3), ...at(tl - 1.6), ya, width, { arches: false });
        b.bridge(...at(tl + 1.6), ...at(len + 0.3), yb, width);
      }
      this.lifts.push(lift);
      edge.lift = lift;
    }
    let gate = null;
    if (edge.shortcut && !lift) {
      // A barred portcullis mid-passage; the lever stands on the far side.
      const [mx, mz] = at(len / 2);
      const my = (ya + yb) / 2;
      const leverA = edge.leverRoom === A;
      const [lvx, lvz] = at(len / 2 + (leverA ? -1.6 : 1.6));
      const [fx, fz] = at(len / 2 + (leverA ? 1.6 : -1.6));
      const lx = lvx + lat.x * (width / 2 - 0.5), lz = lvz + lat.z * (width / 2 - 0.5);
      const ly = world.groundAt(lx, lz, my + 2) ?? my;
      const fy = world.groundAt(fx, fz, my + 2) ?? my;
      gate = new ShortcutGate(this.game, this.root, mx, my, mz, Math.atan2(-lat.z, lat.x), {
        pos: new THREE.Vector3(lx, ly, lz), farPos: new THREE.Vector3(fx, fy, fz),
      });
      gate.addTo(world);
      (leverA ? A : B).interactables.push(gate);
      (leverA ? B : A).interactables.push(gate.far);
      gate.lists = [[(leverA ? A : B).interactables, gate], [(leverA ? B : A).interactables, gate.far]];
      this.gates.push(gate);
      edge.gate = gate;
    } else if (!lift) {
      const [mx, mz] = at(len / 2);
      b.archway(mx, mz, Math.min(ya, yb), Math.atan2(-lat.z, lat.x), width + 0.6, rand(6, 8));
    }
    b.parapets({ breakChance: 0 });
    b.batch.build(this.root);
    for (const room of [A, B]) room.world.absorb(world, { skip: ['stubEnd', 'water'] });
    lift?.bind([A.world, B.world]);
    gate?.bind([A.world, B.world]);
  }

  bounds() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of this.rooms.values()) {
      x0 = Math.min(x0, r.ox); x1 = Math.max(x1, r.ox);
      z0 = Math.min(z0, r.oz); z1 = Math.max(z1, r.oz);
    }
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, radius: Math.hypot(x1 - x0, z1 - z0) / 2 + CELL / 2 };
  }

  buildSurroundings() {
    const { cx, cz, radius } = this.bounds();
    this.center = { cx, cz, radius };
    const b = new Builder(this.game, this.scratch(new World()));
    b.vista(cx, cz, radius + 12, radius + 90);
    this.buildCitadel(b, cx, cz, radius);
    b.batch.build(this.root);

    const size = radius * 2 + 700;
    switch (this.biome.abyss) {
      case 'water': {
        const tex = Textures.mist();
        tex.repeat.set(60, 60);
        this.surface = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x2a3e3a, roughness: 0.12, metalness: 0.3, map: tex, transparent: true, opacity: 0.93 }));
        this.surface.position.set(cx, -0.45, cz);
        this.surface.receiveShadow = true;
        this.root.add(this.surface);
        break;
      }
      case 'lava': {
        const tex = Textures.lava();
        tex.repeat.set(size / 24, size / 24);
        this.surface = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }));
        this.surface.position.set(cx, -12, cz);
        this.root.add(this.surface);
        break;
      }
      case 'clouds':
        this.sky = createSkyDome({ sunDir: new THREE.Vector3(0.5, 0.55, -0.4), bright: 1.0 });
        this.root.add(this.sky);
        break;
    }
  }

  /**
   * The citadel: a colossal keep beyond the guardian's arena, lit windows and all, so wherever
   * you stand on the floor you can see where you are going.
   */
  buildCitadel(b, cx, cz, radius) {
    const boss = [...this.rooms.values()].find((r) => r.type === 'boss');
    let vx = boss.ox - cx, vz = boss.oz - cz;
    const vl = Math.hypot(vx, vz) || 1;
    vx /= vl; vz /= vl;
    if (vl < 1) { vx = 0; vz = -1; }
    const x = boss.ox + vx * 72, z = boss.oz + vz * 72;
    this.citadel = { x, z };
    // A beacon burns at its crown, bright enough to pierce any fog: follow it to the guardian.
    const beaconColor = { crystal: 0x6ab8ff, sunken: 0x7af0b8, ember: 0xff5a20, sunlit: 0xfff0c0 }[this.biome.id] ?? 0xffe0a0;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 4, 220, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: beaconColor, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    beam.position.set(x, 95 + 110, z);
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(3.5, 0), new THREE.MeshBasicMaterial({ color: beaconColor, fog: false }));
    crown.position.set(x, 100, z);
    crown.scale.y = 1.8;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8),
      new THREE.MeshBasicMaterial({ color: beaconColor, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.copy(crown.position);
    this.root.add(beam, crown, halo);
    this.beacon = { crown, halo };
    const M = b.M;
    const base = -40;
    // The crag it stands on.
    for (let i = 0; i < 7; i++) {
      const s = rand(18, 34);
      b.add(new THREE.DodecahedronGeometry(1, 0), M.rock, composeMatrix(x + rand(-20, 20), base + rand(0, 25), z + rand(-20, 20), rand(0, 3), rand(0, 3), 0, s, s * rand(1.2, 2), s), { cast: false });
    }
    // The great keep and its crown of spires.
    b.tower(x, z, base, 95, 18, { windowChance: 0.45, roof: 'spire', cast: false });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rand(-0.2, 0.2), r = rand(20, 34);
      const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
      b.tower(tx, tz, base + rand(0, 20), rand(40, 80), rand(5, 9), { windowChance: 0.4, cast: false });
      if (i % 2 === 0) {
        const bx = (x + tx) / 2, bz = (z + tz) / 2;
        const len = Math.hypot(tx - x, tz - z);
        b.add(new THREE.BoxGeometry(3, 2, len), M.brick, composeMatrix(bx, rand(35, 60), bz, 0, Math.atan2(tx - x, tz - z)), { cast: false });
      }
    }
    // Falls pouring from the crag: lava, water or light, by biome.
    const fallMat = this.biome.abyss === 'lava' ? this.game.materials.lava : this.biome.abyss === 'water' ? this.game.materials.shaft : null;
    if (fallMat) {
      for (let i = 0; i < 3; i++) {
        const a = rand(0, TAU);
        b.add(new THREE.BoxGeometry(rand(2, 4), 70, 0.5), fallMat, composeMatrix(x + Math.cos(a) * 26, base + 5, z + Math.sin(a) * 26, 0, a), { cast: false, receive: false });
      }
    }
  }

  addGrass(spots) { this.grassSpots.push(...spots); }

  buildGrass() {
    if (!this.grassSpots.length) return;
    const blades = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.ConeGeometry(0.05, 0.55, 3).translate(0, 0.27, 0);
      g.rotateZ(rand(-0.35, 0.35));
      g.rotateY((i / 3) * Math.PI);
      g.translate(rand(-0.08, 0.08), 0, rand(-0.08, 0.08));
      blades.push(g);
    }
    const n = this.grassSpots.length * 4;
    const grass = new THREE.InstancedMesh(mergeGeometries(blades), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), n);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    let k = 0;
    for (const s of this.grassSpots) {
      for (let j = 0; j < 4; j++) {
        dummy.position.set(s.x + rand(-0.7, 0.7), s.y - 0.02, s.z + rand(-0.7, 0.7));
        dummy.rotation.set(0, rand(0, TAU), 0);
        const sc = rand(0.7, 1.4);
        dummy.scale.set(sc, sc * rand(0.8, 1.4), sc);
        dummy.updateMatrix();
        grass.setMatrixAt(k, dummy.matrix);
        grass.setColorAt(k, c.setHSL(rand(0.19, 0.27), rand(0.28, 0.42), rand(0.22, 0.32)));
        k++;
      }
    }
    grass.receiveShadow = true;
    this.root.add(grass);
  }

  // ---- Frame -------------------------------------------------------------------

  /** Show and simulate the chambers around the knight (both tiers of a stacked cell); hide the rest. */
  update(dt, current) {
    const near = [];
    for (const r of this.allRooms) {
      const on = Math.max(Math.abs(r.gx - current.gx), Math.abs(r.gy - current.gy)) <= 1;
      if (on !== r.group.visible) r.setVisible(on);
      if (on) near.push(r);
    }
    this.active = near;
    for (const r of near) r.update(dt, r === current);
    this.activeEnemies = near.flatMap((r) => r.enemies);
    for (const l of this.lifts) l.update(dt);
    for (const g of this.gates) g.update(dt);
    if (this.beacon) {
      const t = this.game.time;
      this.beacon.crown.rotation.y += dt * 0.6;
      this.beacon.halo.scale.setScalar(1 + Math.sin(t * 1.7) * 0.12);
    }
    const cam = this.game.camera.position;
    if (this.sky) this.sky.position.set(cam.x, 0, cam.z);
    if (this.surface?.material.map) {
      const m = this.surface.material.map;
      m.offset.x = (m.offset.x + dt * (this.biome.abyss === 'lava' ? 0.006 : 0.002)) % 1;
      m.offset.y = (m.offset.y + dt * 0.003) % 1;
    }
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry !== this.game.flameGeo) o.geometry.dispose();
    });
  }
}

function edgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

function bfs(cells, neighbours) {
  const start = key(0, 0);
  const dist = new Map([[start, 0]]);
  const q = [start];
  while (q.length) {
    const k = q.shift();
    for (const n of neighbours(k)) {
      if (!dist.has(n)) { dist.set(n, dist.get(k) + 1); q.push(n); }
    }
  }
  for (const k of cells.keys()) if (!dist.has(k)) dist.set(k, 99);
  return dist;
}
