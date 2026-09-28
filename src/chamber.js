import * as THREE from 'three';
import { DIRS, RoomState } from './config.js';
import { World } from './physics.js';
import { Builder, samplePoint } from './architecture.js';
import { rand, randInt, pick, chance, flicker, composeMatrix, archWallGeometry, worldBoxGeometry, TAU } from './util.js';
import { Pedestal, Descent, rollItem } from './items.js';
import { WeaponDrop } from './loot.js';
import { rollWeapon } from './weapons.js';
import { Warden, pickEnemyType, eliteGroup, separateEnemies } from './enemies.js';
import { R, along, latOf, linkIslands, COMBAT_LAYOUTS, SPECIAL_LAYOUTS } from './layouts.js';

/** Distance between neighbouring chamber centres on a floor. */
export const CELL = 70;
/** Where a chamber's gatehouse arch stands, measured from its centre. */
export const GATE_PLANE = R + 2.5;

// ============================================================================
// Fog wall — a curtain of pale mist sealing an elite or guardian arena.
// ============================================================================

const fogShader = {
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float time, level;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      vec2 p = vUv * vec2(3.0, 4.0);
      float n = noise(p + vec2(time * 0.25, time * 0.4)) * 0.6 + noise(p * 2.3 - vec2(time * 0.4, -time * 0.15)) * 0.4;
      float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(1.0, 0.8, vUv.y);
      float a = (0.25 + n * 0.55) * edge * level;
      gl_FragColor = vec4(mix(vec3(0.75, 0.78, 0.85), vec3(1.0, 0.95, 0.85), n) * a, a);
    }
  `,
};

class FogWall {
  constructor(chamber, dir, y) {
    const d = DIRS[dir];
    this.level = 0;
    this.target = 0;
    this.uniforms = { time: { value: 0 }, level: { value: 0 } };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 5.2), new THREE.ShaderMaterial({
      ...fogShader, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const [x, z] = along(dir, GATE_PLANE);
    this.mesh.position.set(x, y + 2.6, z);
    this.mesh.rotation.y = Math.atan2(-d.x, -d.z);
    this.mesh.visible = false;
    chamber.group.add(this.mesh);
    const lat = latOf(dir);
    this.blocker = chamber.world.addBox(x - lat.x * 2 - d.x * 0.4, z - lat.z * 2 - d.z * 0.4, x + lat.x * 2 + d.x * 0.4, z + lat.z * 2 + d.z * 0.4, y - 1, y + 6);
    this.blocker.enabled = false;
  }

  raise() { this.target = 1; this.blocker.enabled = true; }
  lower() { this.target = 0; this.blocker.enabled = false; }

  update(dt, t) {
    this.level += (this.target - this.level) * (1 - Math.exp(-3 * dt));
    this.uniforms.level.value = this.level;
    this.uniforms.time.value = t;
    this.mesh.visible = this.level > 0.01;
  }
}

// ============================================================================
// Chamber — one cell of a seamless floor.
// ============================================================================

export class Chamber {
  constructor(game, floor, gx, gy, type) {
    this.game = game;
    this.floor = floor;
    this.gx = gx;
    this.gy = gy;
    this.ox = gx * CELL;
    this.oz = gy * CELL;
    this.type = type;
    this.neighbors = { n: null, s: null, e: null, w: null };
    this.state = ['combat', 'elite', 'boss'].includes(type) ? RoomState.DORMANT : RoomState.CLEARED;
    this.visited = false;
    this.seen = false;
    this.built = false;
    this.gates = {};
    this.fogWalls = [];
    this.enemies = [];
    this.pending = [];
    this.loot = [];
    this.interactables = [];
    this.pedestal = null;
    this.descent = null;
    this.stateTime = 0;
    this.center = { x: 0, y: 0, z: 0 };
  }

  get sealing() { return this.type === 'elite' || this.type === 'boss'; }
  worldCenter() { return new THREE.Vector3(this.center.x + this.ox, this.center.y, this.center.z + this.oz); }

  build() {
    if (this.built) return;
    this.built = true;
    const game = this.game;
    const biome = this.floor.biome;
    this.world = new World();
    if (biome.abyss === 'water') this.world.addField(() => -0.45, { tag: 'water' });
    this.group = new THREE.Group();
    this.group.position.set(this.ox, 0, this.oz);
    this.actors = new THREE.Group();
    this.floor.root.add(this.group, this.actors);
    const b = new Builder(game, this);

    let layout;
    if (this.type === 'start') layout = SPECIAL_LAYOUTS.shrine;
    else if (this.type === 'treasure') layout = SPECIAL_LAYOUTS.reliquary;
    else if (this.type === 'boss' || this.type === 'elite') layout = this.type === 'boss' || chance(0.5) ? SPECIAL_LAYOUTS.arena : COMBAT_LAYOUTS[this.floor.nextLayout()];
    else layout = COMBAT_LAYOUTS[this.floor.nextLayout()];
    this.layoutName = layout.name;
    layout(b, this);

    for (const dir of Object.keys(DIRS)) if (this.neighbors[dir]) this.addGateway(b, dir);
    this.decorate(b);
    b.finish(this.group);
    this.world.setOffset(this.ox, this.oz);

    const toWorld = (v) => v.clone().add(new THREE.Vector3(this.ox, 0, this.oz));
    this.lightSpots = b.lightSpots.map((s) => ({ ...s, pos: toWorld(s.pos) }));
    this.emitters = b.emitters.map((e) => ({ ...e, pos: toWorld(e.pos) }));
    this.buildFlames(b.flames);
    if (b.grass.length) this.floor.addGrass(b.grass.map((g) => ({ x: g.x + this.ox, y: g.y, z: g.z + this.oz })));

    const c = this.worldCenter();
    if (this.type === 'treasure') {
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z, true);
      new WeaponDrop(game, this, rollWeapon(game.depth, 1), new THREE.Vector3(c.x + 2.2, c.y, c.z + 1.2));
    }
    if (this.type === 'start') this.floor.startPose = { x: c.x, y: c.y, z: c.z + 3.4, yaw: 0 };
    this.placeEnemies();
  }

  /** Farthest walkable point along a gate's axis (within reach of the landing). */
  findAnchor(dir) {
    let best = null;
    for (let a = 0; a <= R - 4.2; a += 0.25) {
      const [x, z] = along(dir, a);
      let top = null;
      for (const s of this.world.surfaces) {
        if (s.tag === 'landing' || s.tag === 'water') continue;
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
    if (gap > 7 && chance(0.5)) gateY = anchor.y + pick([-1.6, 1.6]);
    gateY = Math.max(-2.4, Math.min(3.2, gateY));
    let stairsLen = Math.abs(gateY - anchor.y) * 2.3;
    if (stairsLen > gap - 1.5) { gateY = anchor.y; stairsLen = 0; }

    const vertical = DIRS[dir].x === 0;
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
        if (gap > 9 && chance(0.45)) {
          const mid = (a0 + a1) / 2;
          const [mx, mz] = along(dir, mid);
          b.platform(mx, mz, vertical ? 6.5 : 4.5, vertical ? 4.5 : 6.5, gateY, { tag: 'balcony' });
          const [sx, sz] = along(dir, mid, (chance(0.5) ? 1 : -1) * 2.4);
          chance(0.5) ? b.crystalCluster(sx, sz, gateY, rand(0.8, 1.3)) : b.lanternPost(sx, sz, gateY);
        } else if (gap > 6 && chance(0.4)) {
          const lat = latOf(dir);
          const [ax, az] = along(dir, (a0 + a1) / 2);
          b.archway(ax, az, gateY, Math.atan2(-lat.z, lat.x), width + 0.4, rand(5, 7));
        }
      }
    }

    this.buildGatehouse(b, dir, gateY);
    // A stub of walkway through the arch so the landing's balustrade leaves the way open; the
    // floor lays the real passage onto it.
    const [sx, sz] = along(dir, GATE_PLANE + 1);
    b.world.addRect(sx, sz, vertical ? 1.9 : 1.6, vertical ? 1.6 : 1.9, gateY, { parapet: false, tag: 'stub', thick: 1.4 });
    this.gates[dir] = { y: gateY };
    if (this.sealing) this.fogWalls.push(new FogWall(this, dir, gateY));
  }

  buildGatehouse(b, dir, y) {
    const M = b.M;
    const d = DIRS[dir];
    const [cx, cz] = along(dir, GATE_PLANE);
    const rot = Math.atan2(-d.x, -d.z);
    const wall = archWallGeometry(16, 12, 1.6, [{ cx: 0, halfW: 1.9, spring: 3.2, peak: 5.0 }]);
    b.add(wall, M.brick, composeMatrix(cx, y, cz, 0, rot));
    b.add(worldBoxGeometry(17, 0.6, 2.2), M.trim, composeMatrix(cx, y + 12, cz, 0, rot));
    b.add(worldBoxGeometry(16, 40, 1.6), M.brick, composeMatrix(cx, y - 20.3, cz, 0, rot));
    for (const side of [-1, 1]) {
      const [tx, tz] = along(dir, GATE_PLANE + 0.6, side * 8.5);
      b.tower(tx, tz, y - 45, y + rand(14, 20), 3, { windowChance: 0.3 });
    }
    const boxAlong = (a0, a1, l0, l1) => {
      const [x0, z0] = along(dir, a0, l0), [x1, z1] = along(dir, a1, l1);
      b.world.addBox(x0, z0, x1, z1, y - 1, y + 12);
    };
    boxAlong(GATE_PLANE - 0.8, GATE_PLANE + 0.8, -8, -1.9);
    boxAlong(GATE_PLANE - 0.8, GATE_PLANE + 0.8, 1.9, 8);
    for (const side of [-1, 1]) {
      for (const face of [-1, 1]) {
        const [sx, sz] = along(dir, GATE_PLANE + face * 1.0, side * 3.1);
        b.add(new THREE.BoxGeometry(0.12, 0.5, 0.12), M.iron, composeMatrix(sx, y + 3.2, sz));
        b.add(new THREE.BoxGeometry(0.16, 0.2, 0.16), M.flame, composeMatrix(sx, y + 3.55, sz), { cast: false, receive: false });
        b.emitters.push({ kind: 'fire', pos: new THREE.Vector3(sx, y + 3.6, sz), spread: 0.05, rate: 6 });
      }
    }
    const [gx, gz] = along(dir, GATE_PLANE - 1.4);
    b.lightSpots.push({ kind: 'warm', pos: new THREE.Vector3(gx, y + 3.6, gz), weight: 1.2, gate: true });
    if (this.floor.biome.id === 'sunken') b.vines(cx, cz, y + 11, y + 5);
  }

  decorate(b) {
    const biome = this.floor.biome.id;
    const hubTags = ['hub', 'dais'];
    const place = (fn, count, r = 0.8, rim = true) => {
      for (let i = 0; i < count; i++) {
        const p = rim ? b.rimSpot(hubTags, r) : b.randomSpot(hubTags, r);
        if (p) fn(p);
      }
    };
    const combat = this.type === 'combat' || this.type === 'elite';
    place((p) => b.crystalCluster(p.x, p.z, p.y, rand(0.8, 1.9)), combat ? randInt(2, 5) : 2, 1);
    place((p) => b.brazier(p.x, p.z, p.y), (combat ? randInt(0, 2) : 1) + (biome === 'ember' ? 2 : 0), 0.8);
    place((p) => b.lanternPost(p.x, p.z, p.y), randInt(0, 2), 0.6);
    place((p) => b.statue(p.x, p.z, p.y), chance(0.45) ? 1 : 0, 1);
    place((p) => b.bones(p.x, p.z, p.y), randInt(3, 7), 0.5, false);
    place((p) => b.candles(p.x, p.z, p.y, randInt(3, 6)), randInt(1, 3), 0.5, false);
    place((p) => b.rubble(p.x, p.z, p.y, rand(0.6, 1.4)), randInt(2, 5), 0.4, false);
    if (biome !== 'sunlit') place((p) => b.chain(p.x, p.z, p.y + 16, p.y + rand(3, 6)), randInt(0, 4), 0.3, false);
    if (!this.enclosed && biome !== 'sunlit') b.stalactites(randInt(10, 20), 0, 0, 26, 18, 26, 4, 12);
    switch (biome) {
      case 'sunken':
        place((p) => b.roots(p.x, p.z, p.y), randInt(4, 8), 0.5);
        place((p) => b.moss(p.x, p.z, p.y, rand(0.6, 1.6)), randInt(6, 12), 0.3, false);
        place((p) => b.vines(p.x, p.z, p.y + 14, p.y + rand(2.5, 5)), randInt(3, 7), 0.3, false);
        place((p) => b.tree(p.x, p.z, p.y, rand(0.8, 1.2), chance(0.6)), randInt(0, 2), 1.2);
        break;
      case 'ember':
        place((p) => b.lavaCrack(p.x, p.z, p.y), randInt(4, 9), 0.3, false);
        place((p) => b.spikes(p.x, p.z, p.y), randInt(1, 3), 0.8);
        break;
      case 'sunlit':
        place((p) => b.tree(p.x, p.z, p.y, rand(0.8, 1.3), chance(0.15)), randInt(1, 3), 1.2);
        place((p) => b.moss(p.x, p.z, p.y, rand(0.8, 1.8)), randInt(6, 12), 0.3, false);
        for (let i = 0; i < 40; i++) {
          const p = b.randomSpot(hubTags, 0.2, 0.6);
          if (p) b.grass.push(p);
        }
        break;
    }
    if (combat && chance(biome === 'sunken' ? 0.7 : 0.35)) {
      const p = b.randomSpot(hubTags, 1.2);
      if (p) b.lightShaft(p.x, p.z, p.y, rand(1, 1.6));
    }
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
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.flameData.forEach((f, i) => {
      m.compose(f.pos, q, s.set(1, 0.8 + 0.35 * flicker(t * 1.5, f.seed), 1));
      this.flameMesh.setMatrixAt(i, m);
    });
    this.flameMesh.instanceMatrix.needsUpdate = true;
  }

  setVisible(v) {
    this.group.visible = v;
    this.actors.visible = v;
  }

  // ---- Encounters ----------------------------------------------------------

  /** A random spawn point on the chamber's hub, in world space. */
  spawnPoint(minDist) {
    const W = this.world;
    const surfaces = W.surfaces.filter((s) => s.tag === 'hub' || s.tag === 'dais');
    const pp = this.game.player.pos;
    for (let i = 0; i < 60; i++) {
      const s = pick(surfaces);
      const p = samplePoint(s, 1.2);
      if (!p) continue;
      const x = p.x + this.ox, z = p.z + this.oz;
      const g = W.groundAt(x, z);
      if (g === null || Math.abs(g - p.y) > 0.05) continue;
      if (Math.hypot(x - pp.x, z - pp.z) < minDist) continue;
      if (W.circles.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.8)) continue;
      if (this.enemies.some((e) => Math.hypot(e.pos.x - x, e.pos.z - z) < 1.6)) continue;
      return { x, y: p.y, z };
    }
    return this.worldCenter();
  }

  /**
   * Populate at build time. Some foes wait in plain sight — slumped, kneeling, dormant — and
   * wake when the knight arrives; the rest claw their way out of the floor on arrival.
   */
  placeEnemies() {
    const game = this.game;
    const biome = this.floor.biome;
    if (this.type === 'combat') {
      const count = Math.min(7, 2 + game.depth + randInt(0, 2));
      for (let i = 0; i < count; i++) {
        const Type = pickEnemyType(game.depth, biome);
        const p = this.spawnPoint(0);
        if (chance(0.6)) {
          const e = new Type(game, this, p.x, p.y, p.z);
          e.makeDormant();
          this.enemies.push(e);
        } else this.pending.push({ Type, p });
      }
    } else if (this.type === 'elite') {
      for (const { Type, elite } of eliteGroup(biome, game.depth)) {
        const p = this.spawnPoint(0);
        const e = new Type(game, this, p.x, p.y, p.z);
        if (elite) e.makeElite();
        e.makeDormant();
        this.enemies.push(e);
      }
    }
  }

  onPlayerEnter() {
    this.visited = true;
    this.seen = true;
    for (const n of Object.values(this.neighbors)) if (n) n.seen = true;
  }

  wake() {
    const game = this.game;
    this.stateTime = 0;
    this.state = RoomState.COMBAT;
    if (this.sealing) {
      for (const f of this.fogWalls) f.raise();
      game.audio.play('fogwall');
      game.shake(0.3);
    }
    if (this.type === 'boss') {
      const c = this.worldCenter();
      const pp = game.player.pos;
      const dx = pp.x - c.x, dz = pp.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      const boss = new Warden(game, this, c.x - (dx / d) * 5, c.y, c.z - (dz / d) * 5, this.floor.biome.boss);
      this.enemies.push(boss);
      game.hud.showBoss(boss);
      game.hud.banner(boss.name, 'warn', 2.6);
      for (let i = 0; i < Math.min(game.depth - 1, 2); i++) {
        const p = this.spawnPoint(7);
        this.pending.push({ Type: pickEnemyType(game.depth, this.floor.biome), p });
      }
    } else if (this.type === 'elite') {
      const champ = this.enemies.find((e) => e.elite);
      if (champ) game.hud.showBoss(champ);
      game.hud.banner(champ?.name ?? 'ELITE', 'warn', 2.2);
    }
    this.enemies.forEach((e, i) => e.wake?.(i * rand(0.05, 0.25)));
    this.spawnDelay = 0.3;
    game.audio.play('awaken');
  }

  onCleared() {
    const game = this.game;
    this.state = RoomState.CLEARED;
    for (const f of this.fogWalls) f.lower();
    game.audio.play('open');
    game.slowmo = 0.8;
    const c = this.worldCenter();
    if (this.type === 'boss') {
      game.hud.banner('GUARDIAN FELLED', '', 3.2);
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z + 2.5);
      this.descent = new Descent(this, c.x, c.y, c.z - 4.5);
    } else if (this.type === 'elite') {
      game.hud.banner('ELITE VANQUISHED', '', 2.6);
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z);
      new WeaponDrop(game, this, rollWeapon(game.depth, 2), new THREE.Vector3(c.x + 2, c.y, c.z + 1.5));
    } else {
      game.hud.banner('AREA PURGED', '', 2.2);
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z);
    }
  }

  /** Called for every chamber near the knight; `current` is true for the one they stand in. */
  update(dt, current) {
    this.stateTime += dt;
    const t = this.game.time;
    for (const f of this.fogWalls) f.update(dt, t);

    const player = this.game.player;
    if (this.state === RoomState.DORMANT && current && player.alive) {
      const c = this.worldCenter();
      if (Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < R + 0.5) this.wake();
    }
    if (this.state === RoomState.COMBAT && this.pending.length) {
      this.spawnDelay -= dt;
      if (this.spawnDelay <= 0) {
        const { Type, p } = this.pending.shift();
        this.enemies.push(new Type(this.game, this, p.x, p.y, p.z));
        this.spawnDelay = rand(0.15, 0.5);
      }
    }

    for (const e of this.enemies) e.update(dt);
    separateEnemies(this.enemies);
    this.enemies = this.enemies.filter((e) => !e.removed);
    if (this.state === RoomState.COMBAT && !this.enemies.length && !this.pending.length) this.onCleared();

    this.pedestal?.update(dt);
    this.descent?.update(dt);
    for (const l of this.loot) l.update(dt);
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

  dispose() {
    if (!this.group) return;
    for (const g of [this.group, this.actors]) {
      g.parent?.remove(g);
      g.traverse((o) => {
        if (o.isMesh && o.geometry !== this.game.flameGeo) o.geometry.dispose();
      });
    }
  }
}
