import * as THREE from 'three';
import { DIRS, RoomState } from './config.js';
import { World } from './physics.js';
import { Builder, samplePoint } from './architecture.js';
import { rand, randInt, pick, chance, flicker, composeMatrix, archWallGeometry, worldBoxGeometry, TAU } from './util.js';
import { Pedestal, Descent, rollItem } from './items.js';
import { WeaponDrop } from './loot.js';
import { rollWeapon } from './weapons.js';
import { Chest, Pickup, dropCoins } from './pickups.js';
import { Shop } from './shop.js';
import { DealPortal } from './realm.js';
import { Warden, pickEnemyType, eliteGroup, separateEnemies } from './enemies.js';
import { R, along, latOf, linkIslands, COMBAT_LAYOUTS, SPECIAL_LAYOUTS } from './layouts.js';

/** Distance between neighbouring chamber centres on a floor. */
export const CELL = 70;
/** Where a chamber's gatehouse arch stands, measured from its centre. */
export const GATE_PLANE = R + 2.5;
/** Height between tiers of a floor. */
export const LEVEL_HEIGHT = 6;
/** Chamber archetypes open enough at their heart to sit beneath a span and its lift. */
const UNDER_SPAN = ['nave', 'terraces', 'causeway', 'ring', 'cloister', 'basilica', 'henge', 'ziggurat'];

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
// Locked gate — an iron portcullis with a gilded padlock. One key lifts it.
// ============================================================================

class LockedGate {
  constructor(chamber, dir, y) {
    this.chamber = chamber;
    this.game = chamber.game;
    this.open = false;
    this.t = 0;
    const d = DIRS[dir];
    const lat = latOf(dir);
    const M = this.game.materials;
    this.bars = new THREE.Group();
    const [x, z] = along(dir, GATE_PLANE);
    this.bars.position.set(x, y, z);
    this.bars.rotation.y = Math.atan2(-d.x, -d.z);
    for (let bx = -1.75; bx <= 1.76; bx += 0.35) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 5.4, 0.09), M.iron);
      bar.position.set(bx, 2.7, 0);
      bar.castShadow = true;
      this.bars.add(bar);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 4), M.iron);
      spike.position.set(bx, -0.1, 0);
      spike.rotation.x = Math.PI;
      this.bars.add(spike);
    }
    for (const by of [0.8, 2.4, 4.0]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.12, 0.12), M.iron);
      rail.position.set(0, by, 0);
      this.bars.add(rail);
    }
    this.lock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.18), M.gold);
    this.lock.position.set(0, 1.6, -0.2);
    this.bars.add(this.lock);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 4, 10, Math.PI), M.gold);
    shackle.position.set(0, 1.83, -0.2);
    this.bars.add(shackle);
    chamber.group.add(this.bars);
    this.blocker = chamber.world.addBox(x - lat.x * 2 - d.x * 0.4, z - lat.z * 2 - d.z * 0.4, x + lat.x * 2 + d.x * 0.4, z + lat.z * 2 + d.z * 0.4, y - 1, y + 6);
    const [ix, iz] = along(dir, GATE_PLANE + 1.4);
    this.position = new THREE.Vector3(ix + chamber.ox, y + chamber.elev, iz + chamber.oz);
    this.radius = 2.8;
    chamber.interactables.push(this);
  }

  get prompt() { return 'Unlock the gilded gate'; }
  get sub() { return `Requires a key · you carry ${this.game.player.keys}`; }
  get promptColor() { return '#f0c040'; }

  interact() {
    if (this.open) return;
    const p = this.game.player;
    if (p.keys <= 0) {
      this.game.audio.play('locked');
      this.game.hud.toast('Locked', 'Chests, foes and the merchant all carry keys', 0x9aa0b0);
      return;
    }
    p.keys--;
    this.open = true;
    this.blocker.enabled = false;
    const list = this.chamber.interactables;
    list.splice(list.indexOf(this), 1);
    this.game.audio.play('unlock');
    this.game.audio.play('gate');
    this.game.shake(0.2);
  }

  update(dt) {
    if (!this.open || this.t >= 1) return;
    this.baseY ??= this.bars.position.y;
    this.t = Math.min(1, this.t + dt / 1.6);
    this.bars.position.y = this.baseY + this.t * this.t * 5.2;
    this.lock.visible = this.t < 0.1;
  }
}

// ============================================================================
// Chamber — one cell of a seamless floor.
// ============================================================================

export class Chamber {
  constructor(game, floor, gx, gy, type, { level = 0, span = false } = {}) {
    this.game = game;
    this.floor = floor;
    this.gx = gx;
    this.gy = gy;
    this.ox = gx * CELL;
    this.oz = gy * CELL;
    this.type = type;
    // Floors are tiered: each chamber stands on a level, LEVEL_HEIGHT apart. A span is a high
    // bridge chamber crossing above another chamber in the same cell.
    this.level = level;
    this.elev = level * LEVEL_HEIGHT;
    this.span = span;
    this.reserved = [];
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
    this.locks = [];
    this.stateTime = 0;
    this.center = { x: 0, y: 0, z: 0 };
  }

  get sealing() { return this.type === 'elite' || this.type === 'boss'; }
  worldCenter() { return new THREE.Vector3(this.center.x + this.ox, this.center.y + this.elev, this.center.z + this.oz); }

  build() {
    if (this.built) return;
    this.built = true;
    const game = this.game;
    const biome = this.floor.biome;
    const world = (this.world = new World());
    // The flood lies at one absolute height, whatever tier the chamber stands on.
    if (biome.abyss === 'water') world.addField(() => -0.45 - world.oy, { tag: 'water' });
    this.group = new THREE.Group();
    this.group.position.set(this.ox, this.elev, this.oz);
    this.actors = new THREE.Group();
    this.floor.root.add(this.group, this.actors);
    const b = new Builder(game, this);

    let layout;
    if (this.span) layout = SPECIAL_LAYOUTS.span;
    else if (this.under) layout = COMBAT_LAYOUTS[this.floor.nextLayout(UNDER_SPAN)];
    else if (this.type === 'start') layout = SPECIAL_LAYOUTS.shrine;
    else if (this.type === 'treasure') layout = SPECIAL_LAYOUTS.reliquary;
    else if (this.type === 'shop') layout = SPECIAL_LAYOUTS.bazaar;
    else if (this.type === 'boss' || this.type === 'elite') layout = this.type === 'boss' || chance(0.5) ? SPECIAL_LAYOUTS.arena : COMBAT_LAYOUTS[this.floor.nextLayout()];
    else layout = COMBAT_LAYOUTS[this.floor.nextLayout()];
    this.layoutName = layout.name;
    layout(b, this);

    for (const dir of Object.keys(DIRS)) if (this.neighbors[dir]) this.addGateway(b, dir);
    this.decorate(b);
    b.finish(this.group);
    // Stand-ins that only existed to keep balustrades off the lift gap.
    this.world.surfaces = this.world.surfaces.filter((s) => s.tag !== 'liftstub');
    this.world.setOffset(this.ox, this.oz, this.elev);

    const toWorld = (v) => v.clone().add(new THREE.Vector3(this.ox, this.elev, this.oz));
    this.lightSpots = b.lightSpots.map((s) => ({ ...s, pos: toWorld(s.pos) }));
    this.emitters = b.emitters.map((e) => ({ ...e, pos: toWorld(e.pos) }));
    this.buildFlames(b.flames);
    if (b.grass.length) this.floor.addGrass(b.grass.map((g) => ({ x: g.x + this.ox, y: g.y + this.elev, z: g.z + this.oz })));

    const c = this.worldCenter();
    if (this.type === 'treasure') {
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z, true);
      new WeaponDrop(game, this, rollWeapon(game.depth, 1), new THREE.Vector3(c.x + 2.4, c.y, c.z + 1.2));
      new Chest(game, this, c.x - 2.6, c.y, c.z + 1.4, 'gold', Math.PI * 0.15);
    }
    if (this.type === 'shop') {
      const s = this.shopSpot;
      this.shop = new Shop(game, this, s.x + this.ox, this.center.y + this.elev, s.z + this.oz, s.facing);
    }
    if (this.type === 'start') this.floor.startPose = { x: c.x, y: c.y, z: c.z + 3.4, yaw: 0 };
    // Now and then a chest has been left behind in a fighting chamber.
    if (this.type === 'combat' && !this.span && chance(0.22)) {
      const p = b.rimSpot(['hub'], 1, 1.8);
      if (p) new Chest(game, this, p.x + this.ox, p.y + this.elev, p.z + this.oz, chance(0.3) ? 'gold' : 'wood', Math.atan2(-p.x, -p.z));
    }
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
    // Lean the gate towards the neighbour's tier, so the passage between them climbs gently.
    const toward = Math.sign((this.neighbors[dir]?.elev ?? this.elev) - this.elev);
    if (gap > 7 && (toward !== 0 || chance(0.5))) gateY = anchor.y + (toward || pick([-1, 1])) * 1.6;
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
    if (this.type === 'treasure' && this.game.depth >= 2) this.locks.push(new LockedGate(this, dir, gateY));
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
    const wall = archWallGeometry(16, 12, 1.6, [{ cx: 0, halfW: 1.9, spring: 3.2, peak: 5.0 }], b.style.arch);
    b.add(wall, b.sideMat, composeMatrix(cx, y, cz, 0, rot));
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
    this.dressGatehouse(b, dir, y);
  }

  /**
   * Special chambers announce themselves from outside: the guardian's gate is hung with skulls,
   * crimson banners and blood-red fire; the treasury's is gilded; the merchant's glows violet.
   */
  dressGatehouse(b, dir, y) {
    if (!['boss', 'treasure', 'shop', 'elite'].includes(this.type)) return;
    const M = b.M;
    const d = DIRS[dir];
    const rot = Math.atan2(-d.x, -d.z);
    const face = GATE_PLANE + 0.85;
    const out = (a, l, yy, s = 1) => {
      const [x, z] = along(dir, face + a, l);
      return composeMatrix(x, yy, z, 0, rot, 0, s, s, s);
    };
    const light = (color, l = 0) => {
      const [x, z] = along(dir, face + 1.6, l);
      b.lightSpots.push({ kind: 'warm', color, pos: new THREE.Vector3(x, y + 4.2, z), weight: 3, intensity: 12, distance: 12, gate: true });
    };
    if (this.type === 'boss') {
      for (let i = -3; i <= 3; i++) {
        const m = out(0.05, i * 1.1, y + 6.4 + (i === 0 ? 0.5 : 0), i === 0 ? 1.7 : 1);
        b.add(new THREE.BoxGeometry(0.42, 0.38, 0.42), M.bone, m);
        for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.1, 0.09, 0.05), M.bloodGlow, m.clone().multiply(composeMatrix(s * 0.1, 0.03, 0.22)), { cast: false });
      }
      for (const s of [-1, 1]) {
        const [bx, bz] = along(dir, face + 0.15, s * 3.4);
        b.banner(bx, bz, y + 9.5, rot);
        const m = out(1.2, s * 2.7, y);
        b.add(new THREE.CylinderGeometry(0.45, 0.25, 1.2, 6), M.iron, m.clone().multiply(composeMatrix(0, 0.6, 0)));
        b.add(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 6), M.bloodGlow, m.clone().multiply(composeMatrix(0, 1.22, 0)), { cast: false });
        const [ex, ez] = along(dir, face + 1.2, s * 2.7);
        b.emitters.push({ kind: 'fire', pos: new THREE.Vector3(ex, y + 1.3, ez), spread: 0.25, color: 'blood' });
        b.world.addCircle(ex, ez, 0.5, y - 1, y + 1.4);
        // Horns jutting from the towers.
        b.add(new THREE.ConeGeometry(0.35, 3.2, 5), M.bone, out(0.4, s * 6.5, y + 10.5).multiply(composeMatrix(0, 0, 0, 0, 0, -s * 0.9)));
      }
      light(0xff2010);
    } else if (this.type === 'treasure') {
      b.add(new THREE.OctahedronGeometry(0.7), M.gold, out(0.15, 0, y + 7.2));
      b.add(new THREE.TorusGeometry(1.05, 0.12, 5, 16), M.gold, out(0.12, 0, y + 7.2));
      for (const s of [-1, 1]) {
        const [bx, bz] = along(dir, face + 0.15, s * 3.4);
        b.add(new THREE.BoxGeometry(1.2, 0.08, 0.08), M.iron, composeMatrix(bx, y + 9.5, bz, 0, rot));
        b.add(new THREE.BoxGeometry(1.0, 2.8, 0.04), M.goldCloth, composeMatrix(bx, y + 8.1, bz, 0, rot));
        b.lanternPost(...along(dir, face + 1.5, s * 3.2), y);
      }
      light(0xffc040);
    } else if (this.type === 'shop') {
      const sign = out(0.25, 0, y + 6.6);
      b.add(new THREE.BoxGeometry(2.4, 1.1, 0.12), M.bark, sign);
      b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 10), M.gold, sign.clone().multiply(composeMatrix(-0.55, 0, 0.09, Math.PI / 2)));
      b.add(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10), M.gold, sign.clone().multiply(composeMatrix(0.25, 0.1, 0.09, Math.PI / 2)));
      b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), M.gold, sign.clone().multiply(composeMatrix(0.75, -0.15, 0.09, Math.PI / 2)));
      for (const s of [-1, 1]) {
        const m = out(0.3, s * 2.6, y + 4.2);
        b.add(new THREE.BoxGeometry(0.3, 0.42, 0.3), M.iron, m);
        b.add(new THREE.BoxGeometry(0.22, 0.32, 0.32), M.arcane, m, { cast: false });
      }
      light(0xb070ff);
    } else if (this.type === 'elite') {
      for (const s of [-1, 1]) {
        const [bx, bz] = along(dir, face + 0.15, s * 3.4);
        b.banner(bx, bz, y + 9.5, rot);
      }
      light(0xff8a30);
    }
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
      const x = p.x + this.ox, z = p.z + this.oz, y = p.y + this.elev;
      const g = W.groundAt(x, z, y + 0.1);
      if (g === null || Math.abs(g - y) > 0.05) continue;
      if (Math.hypot(x - pp.x, z - pp.z) < minDist) continue;
      if (W.circles.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.8)) continue;
      if (this.enemies.some((e) => Math.hypot(e.pos.x - x, e.pos.z - z) < 1.6)) continue;
      if (this.reserved.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < r.r)) continue;
      return { x, y, z };
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
      const count = Math.min(this.span ? 4 : 7, 2 + game.depth + randInt(0, 2) - (this.span ? 1 : 0));
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
    // In a stacked cell you can see the other tier too.
    if (this.above) this.above.seen = true;
    if (this.below) this.below.seen = true;
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
      game.tookDamage = false;
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
      dropCoins(game, this, c.clone().setY(c.y + 1), 8 + game.depth * 3);
      this.offerDeal();
    } else if (this.type === 'elite') {
      game.hud.banner('ELITE VANQUISHED', '', 2.6);
      this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z);
      new WeaponDrop(game, this, rollWeapon(game.depth, 2), new THREE.Vector3(c.x + 2, c.y, c.z + 1.5));
      new Pickup(game, this, 'key', c.clone().setY(c.y + 0.5));
      dropCoins(game, this, c.clone().setY(c.y + 0.5), 5 + game.depth * 2);
    } else {
      // Isaac-style room rewards: a relic, a chest, or a scatter of coin, keys and blood.
      game.hud.banner('AREA PURGED', '', 2.2);
      const r = Math.random();
      if (r < 0.4) this.pedestal = new Pedestal(this, rollItem(game.player), c.x, c.y, c.z);
      else if (r < 0.75) {
        const ch = new Chest(game, this, c.x, c.y, c.z, chance(0.3) ? 'gold' : 'wood', rand(0, TAU));
        ch.group.scale.setScalar(0.01);
        ch.grow = 0;
      } else {
        dropCoins(game, this, c.clone().setY(c.y + 0.5), randInt(3, 6) + game.depth);
        if (chance(0.5)) new Pickup(game, this, chance(0.5) ? 'key' : 'vial', c.clone().setY(c.y + 0.5));
      }
      this.maybeHiddenPortal();
    }
  }

  /**
   * A guardian's death may draw something's attention. Untouched victors are likelier to be
   * noticed; anyone who has already signed a pact never sees an angel again.
   */
  offerDeal() {
    const game = this.game;
    const odds = 0.4 + (game.tookDamage ? 0 : 0.35) + (game.depth > 1 ? 0.1 : 0);
    if (!chance(odds)) return;
    const free = ['e', 'w', 'n', 's'].filter((d) => !this.neighbors[d]);
    const dir = free[0] ?? 'e';
    const [x, z] = along(dir, 9.5);
    const d = DIRS[dir];
    this.openPortal(x + this.ox, this.center.y + this.elev, z + this.oz, Math.atan2(-d.x, -d.z));
  }

  /** A rift to the devil's or the angel's realm tears open here. */
  openPortal(x, y, z, facing, hidden = false) {
    const game = this.game;
    const kind = game.player.devilDeals > 0 ? 'devil' : chance(0.42) ? 'angel' : 'devil';
    this.portal = new DealPortal(game, this, kind, x, y, z, facing);
    if (hidden) game.hud.toast('Something stirs', 'A rift has opened somewhere on this floor', kind === 'devil' ? 0xff4030 : 0xfff0c0);
    else game.hud.banner(kind === 'devil' ? 'A DARK RIFT OPENS' : 'A RADIANT RIFT OPENS', kind, 3);
  }

  /** The rare hidden rift: once enough chambers have fallen, it opens in one of them. */
  maybeHiddenPortal() {
    const f = this.floor;
    f.cleared = (f.cleared || 0) + 1;
    if (!f.hiddenPortal || f.hiddenPortalOpened || f.cleared < 3) return;
    f.hiddenPortalOpened = true;
    const c = this.worldCenter();
    let best = null;
    for (let i = 0; i < 20; i++) {
      const p = this.spawnPoint(0);
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d > 5 && (!best || Math.abs(d - 8) < Math.abs(best.d - 8))) best = { ...p, d };
    }
    if (!best) return;
    this.openPortal(best.x, best.y, best.z, Math.atan2(c.x - best.x, c.z - best.z), true);
  }

  /** Called for every chamber near the knight; `current` is true for the one they stand in. */
  update(dt, current) {
    this.stateTime += dt;
    const t = this.game.time;
    for (const f of this.fogWalls) f.update(dt, t);

    const player = this.game.player;
    if (current && !this.announced && ['shop', 'treasure'].includes(this.type)) {
      const c = this.worldCenter();
      if (Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < R - 2) {
        this.announced = true;
        this.game.hud.banner(this.type === 'shop' ? "VAEL'S CURIOS" : 'THE TREASURY', this.type, 2.2);
      }
    }
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
    this.portal?.update(dt);
    this.shop?.tick(dt);
    for (const l of this.locks) l.update(dt);
    for (const l of this.loot) l.update(dt);
    this.updateFlames(t);

    const glow = this.game.glow;
    for (const em of this.emitters) {
      if (em.kind === 'fire' && Math.random() < dt * (em.rate ?? 22)) {
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + rand(-em.spread, em.spread), em.pos.y, em.pos.z + rand(-em.spread, em.spread)),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.2, 2.6), rand(-0.3, 0.3)), life: rand(0.4, 0.9), size: rand(0.05, 0.12),
          color: em.color === 'blood' ? pick([0xff2010, 0xc00808, 0xff5030]) : pick([0xff8a2a, 0xffb040, 0xff5a1a]),
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
