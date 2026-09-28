import * as THREE from 'three';
import { rand, pick, TAU } from './util.js';

/**
 * Showpiece effects for relics and statuses: pillars of light and lightning, tornadoes,
 * singularities, beams, blocks of ice, hands from below, and familiars that follow the knight.
 * Every effect is self-contained: `update(dt)` returns false when it is done, `dispose()` cleans up.
 */

export const additive = (color, opacity = 1, side = THREE.DoubleSide) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side, fog: false,
});

/** A column falling from the sky: holy light, lightning, hellfire. */
export class Pillar {
  constructor(game, pos, { color = 0xfff0b0, radius = 0.9, height = 24, life = 0.6, core = 0xffffff } = {}) {
    this.game = game;
    this.t = 0;
    this.life = life;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.outer = additive(color, 0.6);
    this.inner = additive(core, 0.9);
    const o = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.2, height, 16, 1, true), this.outer);
    o.position.y = height / 2;
    const i = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.35, radius * 0.45, height, 10, 1, true), this.inner);
    i.position.y = height / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.8, radius * 2.2, 32).rotateX(-Math.PI / 2), this.outer);
    ring.position.y = 0.06;
    this.group.add(o, i, ring);
    this.ring = ring;
    game.scene.add(this.group);
    game.glow.burst(pos.clone().setY(pos.y + 0.3), 30, () => ({
      vel: new THREE.Vector3(rand(-4, 4), rand(1, 7), rand(-4, 4)), life: rand(0.3, 0.8), size: rand(0.05, 0.12), color: pick([color, core]), drag: 2.5,
    }));
  }

  update(dt) {
    this.t += dt;
    const k = this.t / this.life;
    this.group.scale.set(1 - k * 0.7, 1, 1 - k * 0.7);
    this.ring.scale.setScalar(1 + k * 2);
    this.outer.opacity = 0.6 * (1 - k);
    this.inner.opacity = 0.9 * (1 - k);
    if (k >= 1) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.outer.dispose();
    this.inner.dispose();
  }
}

/** A whirling column of wind that drags foes into its eye and cuts them. */
export class Tornado {
  constructor(game, pos, { radius = 3, life = 3, dps = 18, color = 0xd8e8f0, owner = null, onTick = null } = {}) {
    this.game = game;
    this.pos = pos.clone();
    this.radius = radius;
    this.life = life;
    this.dps = dps;
    this.onTick = onTick;
    this.t = 0;
    this.tick = 0;
    this.mat = additive(color, 0.25);
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.5 + i * 0.35, 0.05, 4, 20, TAU * 0.8).rotateX(Math.PI / 2), this.mat);
      r.position.y = 0.3 + i * 0.7;
      this.group.add(r);
      this.rings.push(r);
    }
    game.scene.add(this.group);
  }

  update(dt) {
    this.t += dt;
    const fade = Math.min(1, this.t / 0.2) * Math.min(1, (this.life - this.t) / 0.4);
    this.mat.opacity = 0.3 * Math.max(0, fade);
    this.rings.forEach((r, i) => { r.rotation.y += dt * (8 + i * 2); });
    if (Math.random() < dt * 60) {
      const a = rand(0, TAU), h = rand(0, 4), rr = 0.4 + h * 0.4;
      this.game.particles.emit({
        pos: new THREE.Vector3(this.pos.x + Math.cos(a) * rr, this.pos.y + h, this.pos.z + Math.sin(a) * rr),
        vel: new THREE.Vector3(-Math.sin(a) * 6, rand(1, 3), Math.cos(a) * 6), life: rand(0.3, 0.6), size: rand(0.04, 0.08), color: 0x8a8478, gravity: 0,
      });
    }
    this.tick -= dt;
    for (const e of this.game.nearbyEnemies()) {
      if (!e.active) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > this.radius + e.radius || Math.abs(e.pos.y - this.pos.y) > 3) continue;
      // Drawn in, spiralling.
      const pull = (e.isBoss ? 2 : 9) / Math.max(1, e.mass);
      e.vel.x += ((dx / (d || 1)) * pull + (-dz / (d || 1)) * pull * 0.6) * dt * 6;
      e.vel.z += ((dz / (d || 1)) * pull + (dx / (d || 1)) * pull * 0.6) * dt * 6;
      e.knockTimer = 0.2;
      if (this.tick <= 0) this.onTick?.(e, this.dps * 0.25);
    }
    if (this.tick <= 0) this.tick = 0.25;
    if (this.t >= this.life) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.mat.dispose();
  }
}

/** A seed of the void that swallows light and drags everything to its heart, then collapses. */
export class Singularity {
  constructor(game, pos, { radius = 5, life = 2.2, onCollapse = null, onPull = null } = {}) {
    this.game = game;
    this.pos = pos.clone();
    this.radius = radius;
    this.life = life;
    this.onCollapse = onCollapse;
    this.onPull = onPull;
    this.t = 0;
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    this.haloMat = additive(0x9a40ff, 0.5);
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 6, 32), this.haloMat);
    this.disc = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.5, 40), additive(0x5a20a0, 0.3));
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.group.add(this.core, this.halo, this.disc);
    game.scene.add(this.group);
    game.audio.play('void');
  }

  update(dt) {
    this.t += dt;
    const g = this.game;
    this.halo.rotation.x += dt * 3;
    this.halo.rotation.y += dt * 5;
    this.disc.lookAt(g.camera.position);
    const pulse = 1 + Math.sin(this.t * 20) * 0.08;
    this.core.scale.setScalar(pulse * Math.min(1, this.t * 3));
    if (Math.random() < dt * 80) {
      const a = rand(0, TAU), b = rand(-1, 1), r = rand(2, this.radius);
      const from = new THREE.Vector3(this.pos.x + Math.cos(a) * r, this.pos.y + b * r * 0.5, this.pos.z + Math.sin(a) * r);
      g.glow.emit({ pos: from, vel: this.pos.clone().sub(from).multiplyScalar(2.5), life: 0.4, size: rand(0.04, 0.08), color: pick([0x9a40ff, 0x5a20a0, 0xffffff]) });
    }
    for (const e of g.nearbyEnemies()) {
      if (!e.active) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > this.radius || Math.abs(e.pos.y - this.pos.y) > 4) continue;
      const pull = (e.isBoss ? 3 : 14) / Math.max(1, e.mass * 0.7);
      e.vel.x += (dx / (d || 1)) * pull * dt * 5;
      e.vel.z += (dz / (d || 1)) * pull * dt * 5;
      e.knockTimer = 0.2;
      this.onPull?.(e, dt);
    }
    if (this.t >= this.life) {
      this.onCollapse?.(this.pos);
      g.flash = Math.max(g.flash, 0.4);
      g.impact = Math.max(g.impact ?? 0, 0.8);
      g.glow.burst(this.pos, 60, () => ({ vel: new THREE.Vector3(rand(-9, 9), rand(-4, 9), rand(-9, 9)), life: rand(0.3, 0.8), size: rand(0.06, 0.14), color: pick([0x9a40ff, 0xffffff, 0x5a20a0]), drag: 2 }));
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}

/** A straight beam from `from` along `dir`, scorching everything it crosses. */
export class Beam {
  constructor(game, from, dir, { length = 18, width = 0.5, life = 0.5, color = 0x9a40ff, core = 0xffffff, onHit = null } = {}) {
    this.game = game;
    this.t = 0;
    this.life = life;
    this.outer = additive(color, 0.7);
    this.inner = additive(core, 1);
    this.group = new THREE.Group();
    const o = new THREE.Mesh(new THREE.CylinderGeometry(width, width, length, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, length / 2), this.outer);
    const i = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.35, width * 0.35, length, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, length / 2), this.inner);
    this.group.add(o, i);
    this.group.position.copy(from);
    this.group.lookAt(from.clone().add(dir));
    game.scene.add(this.group);
    // Everything along the line, once.
    if (onHit) {
      for (const e of game.nearbyEnemies()) {
        if (!e.active) continue;
        const rel = new THREE.Vector3(e.pos.x - from.x, e.pos.y + e.height * 0.5 - from.y, e.pos.z - from.z);
        const along = rel.dot(dir);
        if (along < 0 || along > length) continue;
        const perp = rel.clone().addScaledVector(dir, -along).length();
        if (perp < e.radius + width + 0.3) onHit(e);
      }
    }
    for (let k = 0; k < 20; k++) {
      const p = from.clone().addScaledVector(dir, rand(0, length));
      game.glow.emit({ pos: p, vel: new THREE.Vector3(rand(-1.5, 1.5), rand(-1.5, 1.5), rand(-1.5, 1.5)), life: rand(0.2, 0.5), size: 0.06, color });
    }
  }

  update(dt) {
    this.t += dt;
    const k = this.t / this.life;
    this.group.scale.set(1 - k, 1 - k, 1);
    this.outer.opacity = 0.7 * (1 - k);
    this.inner.opacity = 1 - k;
    if (k >= 1) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.outer.dispose();
    this.inner.dispose();
  }
}

/** A great clawed hand bursting from the floor, closing, and sinking back. */
export class DemonArm {
  constructor(game, pos, { color = 0x2a0a0a, glow = 0xff3010, onGrab = null } = {}) {
    this.game = game;
    this.t = 0;
    this.onGrab = onGrab;
    this.grabbed = false;
    this.pos = pos.clone();
    const skin = new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: 0.4, roughness: 0.8, flatShading: true });
    this.skin = skin;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 2.2, 7), skin);
    fore.position.y = 1.1;
    this.group.add(fore);
    this.hand = new THREE.Group();
    this.hand.position.y = 2.3;
    this.hand.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), skin));
    this.fingers = [];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group();
      f.position.set(-0.26 + i * 0.17, 0.15, 0.15);
      const seg = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.7, 5), skin);
      seg.position.y = 0.35;
      f.add(seg);
      this.hand.add(f);
      this.fingers.push(f);
    }
    this.group.add(this.hand);
    this.group.scale.set(1, 0.01, 1);
    game.scene.add(this.group);
    game.particles.burst(pos.clone().setY(pos.y + 0.1), 30, () => ({ vel: new THREE.Vector3(rand(-4, 4), rand(2, 6), rand(-4, 4)), life: rand(0.5, 1), size: rand(0.08, 0.18), color: 0x2a1a14, gravity: 12, floor: pos.y, linger: true }));
    game.glow.burst(pos.clone().setY(pos.y + 0.2), 30, () => ({ vel: new THREE.Vector3(rand(-3, 3), rand(1, 4), rand(-3, 3)), life: rand(0.4, 0.9), size: 0.08, color: glow, drag: 2 }));
    game.audio.play('demon-arm');
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const rise = t < 0.18 ? t / 0.18 : t < 0.9 ? 1 : Math.max(0.01, 1 - (t - 0.9) / 0.35);
    this.group.scale.set(1, rise, 1);
    const close = t < 0.25 ? 0 : Math.min(1, (t - 0.25) / 0.12);
    for (const f of this.fingers) f.rotation.x = close * 1.9;
    if (!this.grabbed && t > 0.3) {
      this.grabbed = true;
      this.onGrab?.(this.pos);
      this.game.shake(0.4);
    }
    if (t > 1.25) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.skin.dispose();
  }
}

/** A translucent block of ice around a frozen foe; it cracks away when the frost breaks. */
export class IceBlock {
  constructor(game, enemy) {
    this.game = game;
    this.e = enemy;
    this.mat = new THREE.MeshStandardMaterial({ color: 0xa8d8ff, emissive: 0x3070c0, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, roughness: 0.1, flatShading: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this.mat);
    this.mesh.scale.set(enemy.radius * 1.7, enemy.height * 0.62, enemy.radius * 1.7);
    this.mesh.position.set(0, enemy.height * 0.5, 0);
    this.mesh.rotation.y = rand(0, TAU);
    enemy.group.add(this.mesh);
  }

  update() {
    if (this.e.dead || !(this.e.frozen > 0)) {
      this.shatter();
      return false;
    }
    return true;
  }

  shatter() {
    const g = this.game, e = this.e;
    const c = e.pos.clone().setY(e.pos.y + e.height * 0.5);
    g.particles.burst(c, 22, () => ({ vel: new THREE.Vector3(rand(-4, 4), rand(1, 5), rand(-4, 4)), life: rand(0.5, 1.1), size: rand(0.06, 0.14), color: pick([0xc8e8ff, 0x8ac0ff, 0xffffff]), gravity: 14, floor: e.pos.y, bounce: 0.3 }));
    g.audio.play('shatter');
    this.dispose();
  }

  dispose() {
    this.e.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * Something that floats beside the knight — a wisp, a raven, an orb, an angel — and acts on its
 * own schedule. `act(fam, dt)` is called every frame; the familiar bobs along behind the player.
 */
export class Familiar {
  constructor(game, { build, slot = 0, of = 1, act = null, height = 2.1, dist = 1.3 } = {}) {
    this.game = game;
    this.group = new THREE.Group();
    build(this.group);
    this.slot = slot;
    this.of = of;
    this.act = act;
    this.height = height;
    this.dist = dist;
    this.timer = rand(0.3, 1);
    this.t = rand(0, 10);
    this.group.position.copy(game.player.pos);
    game.scene.add(this.group);
  }

  get pos() { return this.group.position; }

  update(dt) {
    if (this.dead) { this.dispose(); return false; }
    const p = this.game.player;
    this.t += dt;
    // Behind the shoulder: (sin yaw, cos yaw) points backwards from where the knight looks.
    const a = p.yaw + (this.of > 1 ? (this.slot / (this.of - 1) - 0.5) * 2.4 : 0.8);
    const tx = p.pos.x + Math.sin(a) * this.dist, tz = p.pos.z + Math.cos(a) * this.dist;
    const ty = p.pos.y + this.height + Math.sin(this.t * 2.2 + this.slot) * 0.15;
    const k = Math.min(1, dt * 6);
    this.group.position.x += (tx - this.group.position.x) * k;
    this.group.position.y += (ty - this.group.position.y) * k;
    this.group.position.z += (tz - this.group.position.z) * k;
    this.group.rotation.y = p.yaw;
    this.timer -= dt;
    this.act?.(this, dt);
    return true;
  }

  nearest(range = 13) {
    let best = null, bd = range;
    for (const e of this.game.nearbyEnemies()) {
      if (!e.active) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material && !o.material.userData.shared) o.material.dispose(); });
  }
}

/** A ring of force expanding along the ground (a tinted, one-shot shockwave with a vertical wall). */
export class Nova {
  constructor(game, pos, { radius = 5, color = 0xff3010, life = 0.45, height = 1.2 } = {}) {
    this.game = game;
    this.t = 0;
    this.life = life;
    this.radius = radius;
    this.mat = additive(color, 0.6);
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, height, 40, 1, true), this.mat);
    this.mesh.position.copy(pos).add(new THREE.Vector3(0, height / 2, 0));
    this.floorRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), this.mat);
    this.floorRing.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
    game.scene.add(this.mesh, this.floorRing);
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.life);
    const r = 0.3 + this.radius * (1 - (1 - k) ** 2);
    this.mesh.scale.set(r, 1 - k * 0.8, r);
    this.floorRing.scale.setScalar(r);
    this.mat.opacity = 0.6 * (1 - k);
    if (k >= 1) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.mesh, this.floorRing);
    this.mesh.geometry.dispose();
    this.floorRing.geometry.dispose();
    this.mat.dispose();
  }
}
