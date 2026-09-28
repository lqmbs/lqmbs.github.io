import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIRS } from './config.js';
import { World } from './physics.js';
import { Builder } from './architecture.js';
import { rand, pick, shuffle, TAU } from './util.js';
import * as Textures from './textures.js';
import { Chamber, CELL, GATE_PLANE } from './chamber.js';
import { COMBAT_LAYOUTS, latOf } from './layouts.js';
import { createSkyDome } from './sky.js';

/**
 * A whole floor: an Isaac-style grid of chambers laid out in one continuous world. Neighbouring
 * gatehouses are joined by real bridges and stairs — the knight walks from chamber to chamber
 * without a cut, and the abyss, vista and weather belong to the floor as a whole.
 */
export class DungeonFloor {
  constructor(game, depth, biome) {
    this.game = game;
    this.depth = depth;
    this.biome = biome;
    this.rooms = new Map();
    this.layoutBag = [];
    this.grassSpots = [];
    this.active = [];
    this.activeEnemies = [];
    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.generate();
  }

  nextLayout() {
    if (!this.layoutBag.length) this.layoutBag = shuffle(Object.keys(COMBAT_LAYOUTS));
    return this.layoutBag.pop();
  }

  key(x, y) { return `${x},${y}`; }
  get(x, y) { return this.rooms.get(this.key(x, y)); }

  roomAt(x, z) { return this.get(Math.round(x / CELL), Math.round(z / CELL)) || null; }

  generate() {
    const target = Math.min(7 + this.depth * 2, 14);
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
      const special = new Set([this.key(...boss), this.key(...treasure), this.key(0, 0)]);
      const elites = shuffle([...cells.values()].filter((c) => !special.has(this.key(...c)) && dist.get(this.key(...c)) >= 2))
        .slice(0, this.depth >= 2 ? 2 : 1).map((c) => this.key(...c));

      for (const [x, y] of cells.values()) {
        const k = this.key(x, y);
        let type = 'combat';
        if (x === 0 && y === 0) type = 'start';
        else if (k === this.key(...boss)) type = 'boss';
        else if (k === this.key(...treasure)) type = 'treasure';
        else if (elites.includes(k)) type = 'elite';
        this.rooms.set(k, new Chamber(this.game, this, x, y, type));
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

  /** Build every chamber, then stitch them together and dress the surrounding void. */
  build() {
    for (const room of this.rooms.values()) room.build();
    for (const room of this.rooms.values()) {
      for (const dir of ['e', 's']) if (room.neighbors[dir]) this.buildPassage(room, room.neighbors[dir], dir);
    }
    this.buildSurroundings();
    this.buildGrass();
    for (const room of this.rooms.values()) room.setVisible(false);
  }

  /** A pseudo-chamber for building floor-level geometry in world coordinates. */
  scratch(world) {
    return { world, neighbors: {}, center: { x: 1e9, y: 0, z: 1e9 }, type: 'passage', floor: this };
  }

  buildPassage(A, B, dir) {
    const d = DIRS[dir];
    const lat = latOf(dir);
    const ya = A.gates[dir].y, yb = B.gates[d.opposite].y;
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
    if (Math.abs(dy) < 0.05) {
      b.bridge(...at(-0.3), ...at(len + 0.3), ya, width);
    } else {
      const sl = Math.min(len - 1, Math.abs(dy) * 2.3);
      const s0 = (len - sl) / 2;
      b.bridge(...at(-0.3), ...at(s0 + 0.2), ya, width);
      b.stairs(...at(s0), ...at(s0 + sl), ya, yb, width);
      b.bridge(...at(s0 + sl - 0.2), ...at(len + 0.3), yb, width);
    }
    const [mx, mz] = at(len / 2);
    b.archway(mx, mz, Math.min(ya, yb), Math.atan2(-lat.z, lat.x), width + 0.6, rand(6, 8));
    b.parapets({ breakChance: 0 });
    b.batch.build(this.root);
    for (const room of [A, B]) room.world.absorb(world, { skip: ['stubEnd', 'water'] });
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
    b.batch.build(this.root);

    const size = radius * 2 + 500;
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

  /** Show and simulate the chamber the knight is in plus its neighbours; hide the rest. */
  update(dt, current) {
    const near = [];
    for (const r of this.rooms.values()) {
      const on = Math.max(Math.abs(r.gx - current.gx), Math.abs(r.gy - current.gy)) <= 1;
      if (on !== r.group.visible) r.setVisible(on);
      if (on) near.push(r);
    }
    this.active = near;
    for (const r of near) r.update(dt, r === current);
    this.activeEnemies = near.flatMap((r) => r.enemies);
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
