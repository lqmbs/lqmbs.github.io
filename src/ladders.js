import * as THREE from 'three';
import { STEP_HEIGHT } from './physics.js';

/**
 * Ladders out of the places you can fall into but not climb out of.
 *
 * Each chamber's walkable ground is sampled on a 1 m grid (every surface at every point, plus the
 * flood where it lies open). From the gate landings we work backwards: a sample is *safe* if
 * you can walk from it to a landing — stepping up no more than a stair's height, dropping any
 * distance. Anything walkable that is not safe is a pit. Each pit gets a ladder where it meets
 * the safe ground most gently (a big pit gets several, spread out).
 */

const STEP = 1;
const CLIMB = STEP_HEIGHT + 0.05;
const IGNORE = new Set(['lift', 'liftbase', 'far', 'stubEnd']);

export function findLadders(room, extent = 34) {
  const W = room.world;
  const n = Math.round((extent * 2) / STEP) + 1;
  const at = (i) => -extent + i * STEP;
  const water = W.surfaces.find((s) => s.tag === 'water');
  const solid = W.surfaces.filter((s) => s.kind !== 'field' && !IGNORE.has(s.tag));

  // Obstacles, bucketed by 2 m cells so edge tests stay cheap.
  const buckets = new Map();
  const bkey = (x, z) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
  for (const c of W.circles) {
    if (!c.enabled || c.r < 0.12) continue;
    for (let bx = Math.floor((c.x - c.r) / 2); bx <= Math.floor((c.x + c.r) / 2); bx++) {
      for (let bz = Math.floor((c.z - c.r) / 2); bz <= Math.floor((c.z + c.r) / 2); bz++) {
        const k = `${bx},${bz}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(c);
      }
    }
  }
  // Gates that open (fog, locks, shortcuts, lift landings) don't count as walls here.
  const staticBoxes = W.boxes.filter((b) => b.enabled && !b.liftBar && !b.gateId && !b.dynamic);
  const blocked = (x, z, y) => {
    const list = buckets.get(bkey(x, z)) || [];
    for (const c of list) if (y + 0.2 < c.y1 && y + 1.6 > c.y0 && Math.hypot(x - c.x, z - c.z) < c.r + 0.3) return true;
    for (const b of staticBoxes) if (x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3 && y + 0.2 < b.y1 && y + 1.6 > b.y0) return true;
    return false;
  };

  // Nodes: every standable height at every grid point (with headroom under anything above).
  const nodes = [];
  const grid = new Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = at(i), z = at(j);
      const hs = [];
      for (const s of solid) {
        const h = W.heightOf(s, x, z);
        if (h !== null) hs.push({ h, s });
      }
      if (water) {
        const hw = W.heightOf(water, x, z);
        if (!hs.some((o) => o.h >= hw - 0.05 && o.h < hw + 0.6)) hs.push({ h: hw, s: water });
      }
      const here = [];
      for (const o of hs) {
        // A surface is standable only with ~1.9 m clear above it (no other surface's column there).
        if (hs.some((q) => q !== o && q.s !== water && q.h > o.h + 0.05 && q.h - (q.s.top - q.s.bottom) < o.h + 1.9 && q.h > o.h + STEP_HEIGHT)) continue;
        if (here.some((q) => Math.abs(q.h - o.h) < 0.2)) continue;
        if (blocked(x, z, o.h)) continue;
        const node = { i, j, x, z, h: o.h, tag: o.s.tag, safe: false, comp: -1 };
        here.push(node);
        nodes.push(node);
      }
      grid[i * n + j] = here;
    }
  }
  const neighbours = (a) => {
    const out = [];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = a.i + di, j = a.j + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      for (const b of grid[i * n + j]) out.push(b);
    }
    return out;
  };
  // You can move a -> b if the rise is small (dropping down is always possible).
  const canMove = (a, b) => b.h - a.h <= CLIMB && !blocked((a.x + b.x) / 2, (a.z + b.z) / 2, Math.max(a.h, b.h));

  // Work backwards from the landings: who can get to them?
  const queue = nodes.filter((a) => a.tag === 'landing' || a.tag === 'stub');
  if (!queue.length) return [];
  for (const a of queue) a.safe = true;
  while (queue.length) {
    const b = queue.pop();
    for (const a of neighbours(b)) {
      if (a.safe || !canMove(a, b)) continue;
      a.safe = true;
      queue.push(a);
    }
  }

  // Group the rest into pits.
  const pits = [];
  for (const a of nodes) {
    if (a.safe || a.comp >= 0) continue;
    const comp = [];
    const stack = [a];
    a.comp = pits.length;
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      for (const d of neighbours(c)) {
        if (d.safe || d.comp >= 0 || Math.abs(d.h - c.h) > CLIMB) continue;
        d.comp = a.comp;
        stack.push(d);
      }
    }
    pits.push(comp);
  }

  // A ladder where each pit meets safe ground above it, as gently as possible.
  const ladders = [];
  for (const pit of pits) {
    if (pit.length < 3) continue;
    const candidates = [];
    for (const a of pit) {
      for (const b of neighbours(a)) {
        if (!b.safe || b.h - a.h <= CLIMB || b.h - a.h > 40) continue;
        candidates.push({ a, b, rise: b.h - a.h });
      }
    }
    candidates.sort((p, q) => p.rise - q.rise);
    const want = pit.length > 400 ? 4 : pit.length > 120 ? 3 : pit.length > 40 ? 2 : 1;
    const chosen = [];
    for (const c of candidates) {
      if (chosen.length >= want) break;
      if (chosen.some((o) => Math.hypot(o.a.x - c.a.x, o.a.z - c.a.z) < 12)) continue;
      chosen.push(c);
    }
    for (const c of chosen) ladders.push({ base: { x: c.a.x, y: c.a.h, z: c.a.z }, top: { x: c.b.x, y: c.b.h, z: c.b.z } });
  }
  return ladders;
}

/**
 * A ladder: timber rails and rungs against a wall. Walk into it (or press E) and you climb,
 * stepping off onto the ledge above.
 */
export class Ladder {
  constructor(game, parent, base, top) {
    this.game = game;
    this.base = new THREE.Vector3(base.x, base.y, base.z);
    this.top = new THREE.Vector3(top.x, top.y, top.z);
    const dx = top.x - base.x, dz = top.z - base.z;
    const d = Math.hypot(dx, dz) || 1;
    this.dir = new THREE.Vector3(dx / d, 0, dz / d);
    // Lean the ladder against the face of the ledge.
    const foot = this.base.clone().addScaledVector(this.dir, 0.25);
    const h = top.y - base.y + 1.1;
    const M = game.materials;
    this.group = new THREE.Group();
    this.group.position.copy(foot);
    this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
    parent.add(this.group);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.09), M.bark);
      rail.position.set(s * 0.32, h / 2, 0.12);
      rail.castShadow = true;
      this.group.add(rail);
    }
    for (let y = 0.3; y < h - 0.1; y += 0.34) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.07), M.bark);
      rung.position.set(0, y, 0.12);
      this.group.add(rung);
    }
    this.position = this.base;
    this.radius = 1.6;
  }

  get prompt() { return 'Climb the ladder'; }
  get sub() { return ''; }

  interact() { this.game.player.climb(this); }

  /** Walking into the foot of the ladder starts the climb. */
  touching(p) {
    const dx = p.pos.x - this.base.x, dz = p.pos.z - this.base.z;
    return Math.hypot(dx, dz) < 0.9 && Math.abs(p.pos.y - this.base.y) < 0.8;
  }
}
