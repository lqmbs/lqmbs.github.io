import * as THREE from 'three';
import { rand } from './util.js';

/**
 * Blood on the stones. Every wound leaves a splat on the ground beneath it; a kill leaves a pool.
 * Stains are pooled quads laid flat on whatever surface is under them, and they fade slowly,
 * so a hard-fought chamber stays marked by the fight long after it is won.
 */

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  blob(32, 32, 13);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, d = rand(8, 26);
    blob(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, rand(1.5, 6) * (1 - d / 40));
  }
  // A streak or two, flung outwards.
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    for (let k = 0; k < 8; k++) blob(32 + Math.cos(a) * (12 + k * 2.4), 32 + Math.sin(a) * (12 + k * 2.4), 3.2 - k * 0.35);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

const FADE_AFTER = 45;
const FADE_TIME = 15;

export class Gore {
  constructor(game, size = 140) {
    this.game = game;
    this.textures = [splatTexture(), splatTexture(), splatTexture()];
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.pool = [];
    this.next = 0;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.setSize(size);
  }

  /** Grow or shrink the pool (graphics quality). */
  setSize(size) {
    while (this.pool.length > size) {
      const s = this.pool.pop();
      this.group.remove(s.mesh);
      s.mesh.material.dispose();
    }
    while (this.pool.length < size) {
      const mat = new THREE.MeshLambertMaterial({
        map: this.textures[this.pool.length % 3], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.pool.push({ mesh, age: 0, alpha: 0 });
    }
    this.next %= Math.max(1, this.pool.length);
  }

  /** Leave a stain on the ground near `pos` (world space) in the current chamber. */
  splat(pos, size = 1, color = 0x4a0508, world = this.game.room?.world) {
    if (!world || !this.pool.length) return;
    const g = world.groundAt(pos.x, pos.z, pos.y + 0.5);
    if (g === null || pos.y - g > 4) return;
    const s = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    s.age = 0;
    s.alpha = rand(0.75, 0.95);
    const m = s.mesh;
    m.visible = true;
    m.position.set(pos.x, g + 0.02, pos.z);
    m.rotation.y = rand(0, Math.PI * 2);
    const k = size * rand(0.8, 1.25);
    m.scale.set(k, 1, k * rand(0.8, 1.2));
    m.material.color.setHex(color);
    m.material.opacity = s.alpha;
  }

  /** A spray of small drops along a direction, and one bigger stain under the wound. */
  spray(pos, dir, amount = 1, color, world) {
    this.splat(pos, 0.55 + amount * 0.35, color, world);
    const n = Math.round(1 + amount * 2);
    for (let i = 0; i < n; i++) {
      const d = rand(0.5, 1.6 + amount);
      this.splat({ x: pos.x + dir.x * d + rand(-0.4, 0.4), y: pos.y, z: pos.z + dir.z * d + rand(-0.4, 0.4) }, rand(0.2, 0.45), color, world);
    }
  }

  clear() {
    for (const s of this.pool) s.mesh.visible = false;
  }

  update(dt) {
    for (const s of this.pool) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      if (s.age > FADE_AFTER) {
        const k = 1 - (s.age - FADE_AFTER) / FADE_TIME;
        if (k <= 0) { s.mesh.visible = false; continue; }
        s.mesh.material.opacity = s.alpha * k;
      }
    }
  }
}
