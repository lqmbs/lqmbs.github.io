import * as THREE from 'three';
import { rand, pick, clamp, damp, dampAngle, TAU } from './util.js';
import { Bolt, GroundTelegraph } from './enemies.js';
import { Lightning, Shockwave } from './builds.js';
import { hasAffinity } from './classes.js';

const _v = new THREE.Vector3();

/** Deal ability damage to a foe and report it through the usual feedback channel. */
function strike(game, e, dmg, dir, { knock = 2, stun = 0, burn = 0, posture = 0, result = 'spell' } = {}) {
  if (!e.active) return;
  e.takeRawDamage(dmg, dir, knock);
  if (e.alive) {
    if (burn) e.ignite(4, burn);
    if (posture) e.addPosture(posture);
    if (stun) e.stun(stun);
  }
  game.onEnemyHit(e, e.alive ? result : 'kill', dir, dmg, { proc: true });
}

const dirFrom = (from, to) => _v.set(to.x - from.x, 0, to.z - from.z).normalize().clone();

// ============================================================================
// Staff Arts — the Lantern Mage's bond with staves. Each element grants two arts.
// ============================================================================

export const STAFF_ARTS = {
  fire: [
    { id: 'pyre', name: 'Pillar of Pyre', mana: 28, cooldown: 5, cast: 0.35, desc: 'A column of fire erupts where you look.' },
    { id: 'breath', name: "Dragon's Breath", mana: 30, cooldown: 7, cast: 1.2, desc: 'Channel a cone of flame.' },
  ],
  frost: [
    { id: 'nova', name: 'Frost Nova', mana: 32, cooldown: 8, cast: 0.3, desc: 'Freeze everything around you solid.' },
    { id: 'lance', name: 'Glacial Lance', mana: 24, cooldown: 4, cast: 0.3, desc: 'A great piercing lance that freezes what it passes through.' },
  ],
  storm: [
    { id: 'chain', name: 'Chain Lightning', mana: 24, cooldown: 4, cast: 0.25, desc: 'Lightning leaps from foe to foe.' },
    { id: 'step', name: 'Thunderstep', mana: 20, cooldown: 5, cast: 0.25, desc: 'Blink forward as a bolt, shocking all in your path.' },
  ],
};

export class StaffArts {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.cd = [0, 0];
  }

  /** The two arts on offer right now (or null when the bond isn't active). */
  get arts() {
    const p = this.player;
    if (p.classDef.id !== 'mage' || !hasAffinity(p) || !p.weapon.element) return null;
    return STAFF_ARTS[p.weapon.element];
  }

  tryUse(slot) {
    const p = this.player, arts = this.arts;
    if (!arts || !['idle', 'guard', 'hurt', 'recoil'].includes(p.state)) return;
    const art = arts[slot];
    if (this.cd[slot] > 0) { this.game.hud.flashArt(slot); return; }
    if (p.mana < art.mana && this.player.fx.surgeTimer <= 0) { this.game.audio.play('empty'); this.game.hud.flashMana(); return; }
    p.mana -= art.mana;
    p.manaDelay = 1;
    this.cd[slot] = art.cooldown;
    this.art = art;
    this.fired = false;
    this.tick = 0;
    this.target = art.id === 'pyre' ? p.aimGroundPoint(20) : null;
    if (this.target) this.game.addEffect(new GroundTelegraph(this.game, this.target.x, this.target.y, this.target.z, 2.8, art.cast + 0.15, { color: 0xff7a20 }));
    p.artId = art.id;
    p.setState('art');
    this.game.audio.play('cast-player');
  }

  update(dt) {
    this.cd = this.cd.map((c) => Math.max(0, c - dt));
  }

  /** Runs while the player is in the 'art' state. */
  updateCast(dt) {
    const p = this.player, game = this.game, art = this.art;
    const t = p.stateTime;
    const color = { fire: 0xff6a20, frost: 0x9ad8ff, storm: 0xd8f0ff }[p.weapon.element] ?? 0xffffff;
    if (art.id === 'breath') {
      // Channelled: flame pours from the staff tip in a cone.
      this.tick -= dt;
      const from = p.eyePosition.addScaledVector(p.aim, 0.8).add(_v.set(0, -0.25, 0));
      for (let i = 0; i < 4; i++) {
        const d = p.aim.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(-0.12, 0.12), rand(-0.25, 0.25))).normalize();
        game.glow.emit({ pos: from, vel: d.multiplyScalar(rand(9, 13)), life: rand(0.3, 0.5), size: rand(0.08, 0.18), color: pick([0xff6a20, 0xffb040, 0xff3010]), drag: 1.5 });
      }
      if (this.tick <= 0) {
        this.tick = 0.12;
        for (const e of game.nearbyEnemies()) {
          if (!e.active) continue;
          const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 6 || Math.abs(e.pos.y - p.pos.y) > 2.5) continue;
          const fw = p.forward;
          if ((dx * fw.x + dz * fw.z) / (d || 1) < 0.72) continue;
          strike(game, e, 6.5 * p.stats.damageMult, dirFrom(p.pos, e.pos), { knock: 0.6, burn: 6 });
        }
      }
      if (t > art.cast) p.setState('idle');
      return;
    }
    if (t < art.cast) {
      if (Math.random() < dt * 40) {
        const tip = p.eyePosition.addScaledVector(p.aim, 0.7);
        game.glow.emit({ pos: tip, vel: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)), life: 0.3, size: 0.05, color });
      }
      return;
    }
    if (!this.fired) {
      this.fired = true;
      this[art.id]?.(color);
    }
    if (t > art.cast + 0.2) p.setState('idle');
  }

  pyre() {
    const p = this.player, game = this.game, c = this.target;
    game.audio.play('flare');
    game.shake(0.35);
    game.addEffect(new Pillar(game, c, 0xff6a20));
    game.addEffect(new Shockwave(game, c, 3, 0xffa040, 0.35));
    for (const e of game.nearbyEnemies()) {
      if (!e.active || Math.hypot(e.pos.x - c.x, e.pos.z - c.z) > 2.9 || Math.abs(e.pos.y - c.y) > 3) continue;
      strike(game, e, 46 * p.stats.damageMult, dirFrom(c, e.pos), { knock: 6, burn: 8, posture: 25 });
    }
  }

  nova() {
    const p = this.player, game = this.game;
    game.audio.play('shock');
    game.flash = 0.5;
    game.addEffect(new Shockwave(game, p.pos, 6.5, 0x9ad8ff, 0.5));
    game.glow.burst(p.pos.clone().setY(p.pos.y + 0.5), 60, () => ({
      vel: new THREE.Vector3(rand(-8, 8), rand(0, 3), rand(-8, 8)), life: rand(0.4, 0.9), size: rand(0.05, 0.12), color: pick([0x9ad8ff, 0xffffff, 0x6ab8ff]), drag: 3,
    }));
    for (const e of game.nearbyEnemies()) {
      if (!e.active || e.pos.distanceTo(p.pos) > 6.5) continue;
      strike(game, e, 18 * p.stats.damageMult, dirFrom(p.pos, e.pos), { knock: 1, stun: 2.6, posture: 20 });
      if (e.alive) freeze(game, e, 2.6);
    }
  }

  lance(color) {
    const p = this.player, game = this.game;
    const from = p.eyePosition.addScaledVector(p.aim, 0.8).add(_v.set(0, -0.2, 0));
    game.addBolt(new Bolt(game, from, p.aim, p, color, {
      damage: 52, speed: 34, pierce: true, size: 2.6, spell: false,
      onHit: (e) => { e.stun(1.5); freeze(game, e, 1.5); },
    }));
    game.audio.play('cast-player');
  }

  chain() {
    const p = this.player, game = this.game;
    let best = null, bd = Infinity;
    const fw = p.forward;
    for (const e of game.nearbyEnemies()) {
      if (!e.active) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 17 || (dx * fw.x + dz * fw.z) / (d || 1) < 0.5) continue;
      if (d < bd) { bd = d; best = e; }
    }
    const tip = p.eyePosition.addScaledVector(p.aim, 0.8).add(_v.set(0, -0.2, 0));
    if (!best) {
      game.addEffect(new Lightning(game, tip, tip.clone().addScaledVector(p.aim, 9)));
      game.audio.play('zap');
      return;
    }
    const hit = new Set();
    let from = tip, dmg = 34 * p.stats.damageMult, cur = best;
    for (let i = 0; i < 6 && cur; i++) {
      hit.add(cur);
      const to = cur.pos.clone().setY(cur.pos.y + cur.height * 0.6);
      game.addEffect(new Lightning(game, from, to));
      game.sparks(to, 10, 0xd8f0ff, 4);
      strike(game, cur, dmg, dirFrom(from, to), { knock: 1.5, stun: 0.45, posture: 10 });
      from = to;
      dmg *= 0.78;
      let next = null, nd = 8;
      for (const e of game.nearbyEnemies()) {
        if (!e.active || hit.has(e)) continue;
        const d = e.pos.distanceTo(cur.pos);
        if (d < nd) { nd = d; next = e; }
      }
      cur = next;
    }
    game.audio.play('zap');
    game.flash = 0.25;
  }

  step() {
    const p = this.player, game = this.game;
    const world = game.room.world;
    const fw = p.forward;
    const start = p.pos.clone();
    let last = start.clone();
    for (let d = 0.5; d <= 8; d += 0.5) {
      const x = start.x + fw.x * d, z = start.z + fw.z * d;
      const g = world.groundAt(x, z, p.pos.y + 0.6);
      if (g === null || Math.abs(g - p.pos.y) > 0.7 || world.hitsObstacle(new THREE.Vector3(x, g + 1, z), 0.3)) break;
      last.set(x, g, z);
    }
    p.pos.copy(last);
    p.vel.set(0, 0, 0);
    game.addEffect(new Lightning(game, start.clone().setY(start.y + 1), last.clone().setY(last.y + 1)));
    game.addEffect(new Lightning(game, start.clone().setY(start.y + 0.4), last.clone().setY(last.y + 1.5)));
    game.audio.play('zap');
    game.shake(0.25);
    p.invuln = Math.max(p.invuln, 0.35);
    for (const e of game.nearbyEnemies()) {
      if (!e.active) continue;
      // Distance from the foe to the line we crossed.
      const ab = last.clone().sub(start), ap = e.pos.clone().sub(start);
      const k = clamp(ap.dot(ab) / Math.max(0.01, ab.lengthSq()), 0, 1);
      const closest = start.clone().addScaledVector(ab, k);
      if (Math.hypot(e.pos.x - closest.x, e.pos.z - closest.z) > e.radius + 1.6) continue;
      strike(game, e, 30 * p.stats.damageMult, dirFrom(closest, e.pos), { knock: 4, stun: 0.8, posture: 15 });
    }
  }
}

/** Icy shards clinging to a frozen foe for a moment. */
function freeze(game, e, t) {
  for (let i = 0; i < 14; i++) {
    game.glow.emit({
      pos: new THREE.Vector3(e.pos.x + rand(-0.5, 0.5), e.pos.y + rand(0, e.height), e.pos.z + rand(-0.5, 0.5)),
      vel: new THREE.Vector3(0, rand(-0.1, 0.1), 0), life: rand(t * 0.5, t), size: rand(0.06, 0.12), color: pick([0x9ad8ff, 0xd8f4ff]),
    });
  }
}

/** A roaring column of fire that fades. */
class Pillar {
  constructor(game, pos, color) {
    this.game = game;
    this.t = 0;
    this.pos = pos.clone();
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.6, 9, 14, 1, true), this.mat);
    this.mesh.position.copy(pos).add(new THREE.Vector3(0, 4.5, 0));
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    const k = this.t / 0.9;
    this.mesh.scale.set(1 - k * 0.5, 0.3 + Math.min(1, k * 4) * 0.7, 1 - k * 0.5);
    this.mat.opacity = Math.max(0, 0.8 * (1 - k));
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU), r = rand(0, 2);
      this.game.glow.emit({
        pos: new THREE.Vector3(this.pos.x + Math.cos(a) * r, this.pos.y + rand(0, 2), this.pos.z + Math.sin(a) * r),
        vel: new THREE.Vector3(0, rand(4, 10), 0), life: rand(0.3, 0.7), size: rand(0.08, 0.18), color: pick([0xff6a20, 0xffb040, 0xff3010]),
      });
    }
    if (k >= 1) {
      this.game.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mat.dispose();
      return false;
    }
    return true;
  }

  dispose() { this.game.scene.remove(this.mesh); }
}

// ============================================================================
// Restage — the Duchess replays every recent wound on its victim.
// ============================================================================

export class Restage {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.log = [];
    this.queue = [];
  }

  /** Remember a blow the Duchess dealt. */
  record(e, dmg) {
    const t = this.game.time;
    this.log.push({ e, dmg, t });
    this.log = this.log.filter((h) => t - h.t < 4.5).slice(-24);
  }

  /** Replay the last few seconds of wounds, in order, compressed into a flurry. */
  trigger() {
    const game = this.game, p = this.player;
    const t = game.time;
    const recent = this.log.filter((h) => t - h.t < 4.5 && h.e.alive);
    this.log.length = 0;
    const encore = hasAffinity(p);
    const mult = encore ? 1.5 : 1;
    recent.forEach((h, i) => this.queue.push({ e: h.e, dmg: h.dmg * mult, at: t + 0.12 + i * 0.07, bleed: encore }));
    game.audio.play('restage');
    // Each marked victim flares violet, as if the curtain rose on it.
    for (const e of new Set(recent.map((h) => h.e))) {
      game.glow.burst(e.pos.clone().setY(e.pos.y + e.height * 0.6), 18, () => ({
        vel: new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2)), life: rand(0.4, 0.8), size: 0.05, color: pick([0xc89ae0, 0xffffff]), drag: 2,
      }));
    }
    return recent.length;
  }

  update() {
    const game = this.game, t = game.time;
    while (this.queue.length && this.queue[0].at <= t) {
      const h = this.queue.shift();
      const e = h.e;
      if (!e.active) continue;
      const c = e.pos.clone().setY(e.pos.y + e.height * 0.6);
      const dir = dirFrom(this.player.pos, e.pos);
      // A phantom slash: a violet streak across the victim.
      const a = rand(0, TAU);
      const off = new THREE.Vector3(Math.cos(a) * 0.7, rand(-0.4, 0.4), Math.sin(a) * 0.7);
      game.addEffect(new Lightning(game, c.clone().add(off), c.clone().sub(off), 0xd8a0ff));
      game.sparks(c, 12, 0xd8a0ff, 4);
      strike(game, e, h.dmg, dir, { knock: 1.5, posture: 4, result: 'riposte' });
      if (h.bleed && e.alive) e.ignite(3, 4);
      game.audio.play('hit');
    }
  }
}

// ============================================================================
// The Revenant's phantom family, and the thralls she raises from the fallen.
// ============================================================================

const PHANTOMS = {
  aldric: { name: 'Ser Aldric', life: 22, speed: 4.6, reach: 1.9, damage: 15, rate: 1.15, posture: 14, color: 0x7ae0c8 },
  wynne: { name: 'Wynne', life: 20, speed: 4.2, reach: 9, damage: 11, rate: 1.3, posture: 5, color: 0xa8b0ff, ranged: true },
  grimtooth: { name: 'Grimtooth', life: 18, speed: 7.8, reach: 1.5, damage: 8, rate: 0.55, posture: 5, color: 0x8ae0a0, beast: true },
  thrall: { name: 'Thrall', life: 12, speed: 4.2, reach: 1.7, damage: 10, rate: 1.0, posture: 6, color: 0x5ad0d0 },
};
export const FAMILY = ['aldric', 'wynne', 'grimtooth'];

export class Phantom {
  constructor(game, kind, pos, { empowered = false, scale = 1 } = {}) {
    this.game = game;
    this.kind = kind;
    this.def = PHANTOMS[kind];
    this.empowered = empowered;
    this.life = this.def.life * (empowered ? 1.5 : 1);
    this.maxLife = this.life;
    this.t = 0;
    this.cd = rand(0.2, 0.6);
    this.special = 5;
    this.swing = 0;
    this.yaw = 0;
    this.pos = pos.clone();
    this.dead = false;
    const c = this.def.color;
    this.mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: empowered ? 1.4 : 0.9, transparent: true, opacity: 0, roughness: 0.6, flatShading: true, depthWrite: false });
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.build();
    this.rig.scale.setScalar(scale * (empowered ? 1.15 : 1));
    game.scene.add(this.group);
    game.glow.burst(pos.clone().setY(pos.y + 1), 30, () => ({
      vel: new THREE.Vector3(rand(-2, 2), rand(1, 4), rand(-2, 2)), life: rand(0.5, 1), size: 0.06, color: c, drag: 2,
    }));
  }

  box(w, h, d, x, y, z, parent = this.rig) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  build() {
    const k = this.kind;
    if (k === 'grimtooth') {
      this.box(0.5, 0.45, 1.2, 0, 0.75, 0);
      this.head = this.box(0.36, 0.34, 0.5, 0, 0.95, 0.75);
      this.box(0.1, 0.18, 0.1, -0.12, 1.15, 0.7);
      this.box(0.1, 0.18, 0.1, 0.12, 1.15, 0.7);
      this.legs = [[-0.2, 0.4], [0.2, 0.4], [-0.2, -0.4], [0.2, -0.4]].map(([x, z]) => this.box(0.12, 0.55, 0.12, x, 0.28, z));
      this.box(0.08, 0.08, 0.6, 0, 0.9, -0.8).rotation.x = -0.5;
      return;
    }
    // Humanoid: robe or armour, head, two arms (the right one swings).
    const robe = new THREE.Mesh(new THREE.ConeGeometry(k === 'wynne' ? 0.55 : 0.45, 1.3, 7), this.mat);
    robe.position.y = 0.65;
    this.rig.add(robe);
    this.box(k === 'aldric' ? 0.7 : 0.5, 0.55, 0.36, 0, 1.4, 0);
    this.head = this.box(0.3, 0.32, 0.3, 0, 1.85, 0);
    if (k === 'wynne') {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 6), this.mat);
      hat.position.y = 2.25;
      hat.rotation.z = 0.2;
      this.rig.add(hat);
    }
    if (k === 'aldric') {
      this.box(0.36, 0.06, 0.36, 0, 2.02, 0);
      this.box(0.08, 0.7, 0.55, -0.45, 1.25, 0.2);
    }
    this.arm = new THREE.Group();
    this.arm.position.set(0.36, 1.6, 0);
    this.rig.add(this.arm);
    this.box(0.12, 0.6, 0.12, 0, -0.3, 0, this.arm);
    if (k === 'aldric' || k === 'thrall') this.box(0.06, 1.0, 0.03, 0, -0.8, 0.2, this.arm).rotation.x = 1.2;
    if (k === 'wynne') this.orb = this.box(0.14, 0.14, 0.14, 0, -0.65, 0.1, this.arm);
  }

  /** Nearest living foe to fight, within a leash of the Revenant. */
  pickTarget() {
    const p = this.game.player.pos;
    let best = null, bd = Infinity;
    for (const e of this.game.nearbyEnemies()) {
      if (!e.active || e.pos.distanceTo(p) > 16) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  moveTowards(x, z, speed, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const step = Math.min(d, speed * dt);
    const nx = this.pos.x + (dx / d) * step, nz = this.pos.z + (dz / d) * step;
    const g = this.game.room.world.groundAt(nx, nz, this.pos.y + 0.8);
    if (g !== null && Math.abs(g - this.pos.y) < 1.2) {
      this.pos.set(nx, g, nz);
    } else if (g === null) {
      // Phantoms drift across small gaps rather than falling.
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
  }

  update(dt) {
    const game = this.game, player = game.player;
    this.t += dt;
    this.life -= dt;
    const fadeIn = Math.min(1, this.t / 0.5), fadeOut = Math.min(1, this.life / 0.8);
    this.mat.opacity = 0.72 * fadeIn * fadeOut;
    if (this.life <= 0) { this.dispose(); return false; }
    // Too far behind? Step through the veil to the Revenant's side.
    if (this.pos.distanceTo(player.pos) > 22) {
      const a = rand(0, TAU);
      this.pos.set(player.pos.x + Math.cos(a) * 2, player.pos.y, player.pos.z + Math.sin(a) * 2);
    }
    const def = this.def;
    const mult = (this.empowered ? 1.6 : 1) * player.stats.damageMult;
    const target = this.pickTarget();
    this.cd -= dt;
    this.special -= dt;
    if (target) {
      const d = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
      const want = def.ranged ? 6 : def.reach + target.radius - 0.2;
      if (d > want) this.moveTowards(target.pos.x, target.pos.z, def.speed, dt);
      else if (def.ranged && d < 4) this.moveTowards(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, def.speed * 0.6, dt);
      this.yaw = dampAngle(this.yaw, Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z), 10, dt);
      if (this.cd <= 0 && d <= (def.ranged ? def.reach : def.reach + target.radius + 0.3)) {
        this.cd = def.rate;
        this.swing = 1;
        const dir = dirFrom(this.pos, target.pos);
        if (def.ranged) {
          const from = this.pos.clone().setY(this.pos.y + 1.4);
          const aim = target.pos.clone().setY(target.pos.y + target.height * 0.6).sub(from).normalize();
          game.addBolt(new Bolt(game, from, aim, player, def.color, { damage: def.damage * (this.empowered ? 1.6 : 1), speed: 16, homing: 5, size: 0.9, spell: false }));
        } else {
          strike(game, target, def.damage * mult, dir, { knock: def.beast ? 1 : 2.5, posture: def.posture });
          game.sparks(target.pos.clone().setY(target.pos.y + 1), 8, def.color, 3);
        }
        if (player.classDef.id === 'revenant') player.hp = Math.min(player.stats.maxHp, player.hp + 1);
      }
      // Ser Aldric's shield slam staggers everything around him.
      if (this.kind === 'aldric' && this.special <= 0 && d < 3) {
        this.special = 6;
        game.addEffect(new Shockwave(game, this.pos, 3.2, def.color, 0.4));
        game.audio.play('bash');
        for (const e of game.nearbyEnemies()) {
          if (e.active && e.pos.distanceTo(this.pos) < 3.2) strike(game, e, 10 * mult, dirFrom(this.pos, e.pos), { knock: 5, stun: 1.2, posture: 20 });
        }
      }
    } else {
      // Heel: keep a loose ring around the Revenant.
      const slot = FAMILY.indexOf(this.kind);
      const a = player.yaw + Math.PI + (slot >= 0 ? (slot - 1) * 0.9 : this.t % TAU);
      const fx = player.pos.x + Math.sin(a) * 2.6, fz = player.pos.z + Math.cos(a) * 2.6;
      if (Math.hypot(fx - this.pos.x, fz - this.pos.z) > 0.6) this.moveTowards(fx, fz, def.speed * 0.9, dt);
    }

    // Animate.
    this.swing = Math.max(0, this.swing - dt * 4);
    this.group.position.set(this.pos.x, this.pos.y + (def.beast ? 0 : 0.15 + Math.sin(this.t * 2.4) * 0.08), this.pos.z);
    this.group.rotation.y = this.yaw;
    if (this.arm) this.arm.rotation.x = -this.swing * 2.2 + Math.sin(this.t * 2) * 0.1;
    if (this.legs) this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.t * 14 + i * Math.PI) * 0.5; });
    if (this.head && def.beast) this.head.position.z = 0.75 + this.swing * 0.25;
    if (Math.random() < dt * 8) {
      game.glow.emit({
        pos: new THREE.Vector3(this.pos.x + rand(-0.3, 0.3), this.pos.y + rand(0.2, 1.8), this.pos.z + rand(-0.3, 0.3)),
        vel: new THREE.Vector3(0, rand(0.3, 0.8), 0), life: rand(0.5, 1), size: 0.035, color: def.color,
      });
    }
    return true;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.mat.dispose();
    this.game.glow.burst(this.pos.clone().setY(this.pos.y + 1), 16, () => ({
      vel: new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)), life: rand(0.5, 1), size: 0.05, color: this.def.color, drag: 2,
    }));
  }
}

/** The Revenant's summoning: the rotating family, the Immortal March, and raised thralls. */
export class Summoner {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.phantoms = [];
    this.next = 0;
  }

  spawnPos(offset = 2.2) {
    const p = this.player;
    const a = p.yaw + Math.PI + rand(-1, 1);
    const x = p.pos.x + Math.sin(a) * offset, z = p.pos.z + Math.cos(a) * offset;
    const g = this.game.room.world.groundAt(x, z, p.pos.y + 1);
    return g !== null && Math.abs(g - p.pos.y) < 1.5 ? new THREE.Vector3(x, g, z) : p.pos.clone();
  }

  /** Q: the next of the family steps out of the dark. Only one of each may walk at once. */
  callNext() {
    const kind = FAMILY[this.next];
    this.next = (this.next + 1) % FAMILY.length;
    this.phantoms.filter((ph) => ph.kind === kind).forEach((ph) => ph.dispose());
    this.phantoms = this.phantoms.filter((ph) => !ph.dead);
    this.phantoms.push(new Phantom(this.game, kind, this.spawnPos()));
    this.game.hud.toast(PHANTOMS[kind].name, 'answers the call', PHANTOMS[kind].color);
    this.game.audio.play('summon');
  }

  /** R: the whole family, empowered, and every foe that died nearby rises. */
  march() {
    const game = this.game, p = this.player;
    for (const ph of this.phantoms) if (ph.kind !== 'thrall') ph.dispose();
    this.phantoms = this.phantoms.filter((ph) => !ph.dead);
    FAMILY.forEach((k, i) => {
      const a = p.yaw + Math.PI + (i - 1) * 0.9;
      const pos = p.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2.4, 0, Math.cos(a) * 2.4));
      const g = game.room.world.groundAt(pos.x, pos.z, p.pos.y + 1);
      if (g !== null) pos.y = g; else pos.copy(p.pos);
      this.phantoms.push(new Phantom(game, k, pos, { empowered: true }));
    });
    const t = game.time;
    const fallen = (game.recentDeaths || []).filter((d) => t - d.t < 20 && d.pos.distanceTo(p.pos) < 22).slice(-8);
    for (const d of fallen) this.raise(d.pos, d.height);
    game.recentDeaths = (game.recentDeaths || []).filter((d) => !fallen.includes(d));
    game.addEffect(new Shockwave(game, p.pos, 8, 0x7ae0c8, 0.8));
    game.audio.play('summon');
    game.flash = 0.4;
  }

  raise(pos, height = 1.9) {
    if (this.phantoms.filter((ph) => ph.kind === 'thrall').length >= 8) return;
    this.phantoms.push(new Phantom(this.game, 'thrall', pos, { scale: clamp(height / 1.9, 0.7, 1.6) }));
  }

  /** Harvest: scythe kills may raise the fallen, and lengthen the family's stay. */
  onKill(e) {
    const p = this.player;
    if (p.classDef.id !== 'revenant' || !hasAffinity(p)) return;
    for (const ph of this.phantoms) ph.life = Math.min(ph.maxLife + 6, ph.life + 2);
    if (Math.random() < 0.35) {
      this.raise(e.pos.clone(), e.height);
      this.game.audio.play('summon');
    }
  }

  clear() {
    for (const ph of this.phantoms) ph.dispose();
    this.phantoms.length = 0;
  }

  update(dt) {
    this.phantoms = this.phantoms.filter((ph) => ph.update(dt));
  }
}
