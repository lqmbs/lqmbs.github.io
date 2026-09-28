import * as THREE from 'three';
import { rand, pick, TAU } from './util.js';
import { Bolt } from './enemies.js';

const _v = new THREE.Vector3();

/** A jagged bolt of lightning between two points that fades out quickly. */
export class Lightning {
  constructor(game, a, b, color = 0xbfe4ff) {
    this.game = game;
    this.t = 0;
    const pts = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const p = a.clone().lerp(b, k);
      if (i > 0 && i < n) p.add(new THREE.Vector3(rand(-0.35, 0.35), rand(-0.35, 0.35), rand(-0.35, 0.35)));
      pts.push(p);
    }
    this.mat = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, fog: false });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.mat);
    game.scene.add(this.line);
  }

  update(dt) {
    this.t += dt;
    this.mat.opacity = Math.max(0, 1 - this.t / 0.22) * (Math.random() < 0.3 ? 0.4 : 1);
    if (this.t > 0.22) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.line);
    this.line.geometry.dispose();
    this.mat.dispose();
  }
}

/** An expanding ring on the ground — shockwaves, parry bursts, the Oath's slam. */
export class Shockwave {
  constructor(game, pos, radius, color = 0xfff0c0, duration = 0.45) {
    this.game = game;
    this.t = 0;
    this.duration = duration;
    this.radius = radius;
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), this.mat);
    this.mesh.position.copy(pos).add(new THREE.Vector3(0, 0.08, 0));
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.mesh.scale.setScalar(0.3 + this.radius * (1 - (1 - k) * (1 - k)));
    this.mat.opacity = 1 - k;
    if (k >= 1) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * Everything relics do beyond changing numbers: lightning chains, burning blades, parry
 * shockwaves, orbiting knives, the saint's halo, corpse blooms, brimstone and crescents.
 * Owned by the player; the game calls the hooks.
 */
export class BuildFX {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.blades = [];
    this.bladeHits = new Map();
    this.haloMesh = null;
    this.haloTimer = 0;
    this.hasteTimer = 0;
    this.aegisTimer = 0;
    this.surgeTimer = 0;
    this.spin = 0;
    this.bladeMat = new THREE.MeshBasicMaterial({ color: 0xb8a0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.aegisMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.aegisMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 16, 1, true), this.aegisMat);
    this.aegisMesh.visible = false;
    this.root.add(this.aegisMesh);
  }

  reset() {
    this.hasteTimer = this.aegisTimer = this.surgeTimer = 0;
    this.sync();
  }

  get stats() { return this.player.stats; }

  /** Rebuild the visible parts (knives, halo) after the relic set changes. */
  sync() {
    const S = this.stats;
    const want = S.orbitBlades || 0;
    while (this.blades.length < want) {
      const g = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.62, 4), this.bladeMat);
      blade.rotation.z = Math.PI / 2;
      g.add(blade);
      this.root.add(g);
      this.blades.push(g);
    }
    while (this.blades.length > want) this.root.remove(this.blades.pop());
    this.bladeMat.color.setHex(S.devilBlades ? 0x7a30d0 : 0xb8a0ff);
    if (S.halo > 0 && !this.haloMesh) {
      this.haloMesh = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 5, 24).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false }));
      this.root.add(this.haloMesh);
    } else if (!S.halo && this.haloMesh) {
      this.root.remove(this.haloMesh);
      this.haloMesh = null;
    }
  }

  /** Extra outgoing damage from situational relics. */
  damageBonus() {
    const p = this.player;
    return p.hp < p.stats.maxHp * 0.35 ? 1 + (p.stats.frenzy || 0) : 1;
  }

  attackSpeedBonus() { return this.hasteTimer > 0 ? 1.5 : 1; }
  damageTakenMult() { return (this.stats.damageTaken || 1) * (this.aegisTimer > 0 ? 0.5 : 1); }

  // ---- Hooks ------------------------------------------------------------------

  /** A melee swing leaves the hand (whether or not it connects). */
  onSwing() {
    const p = this.player, S = this.stats, game = this.game;
    const w = p.weapon;
    if (S.bladeWave > 0 && p.hp >= S.maxHp - 0.5) {
      const from = p.eyePosition.addScaledVector(p.aim, 0.6).add(_v.set(0, -0.25, 0));
      game.addBolt(new Bolt(game, from, p.aim, p, 0xfff0c0, {
        damage: w.damage * S.bladeWave, speed: 18, pierce: true, shape: 'crescent', size: 1.1, life: 0.9, spell: false,
      }));
    }
    if (S.brimstone > 0) {
      const from = p.eyePosition.addScaledVector(p.aim, 0.5).add(_v.set(rand(-0.3, 0.3), 0.2, 0));
      game.addBolt(new Bolt(game, from, p.aim, p, 0xff3a10, {
        damage: 10 + w.damage * 0.35 * S.brimstone, speed: 13, homing: 4, burn: 4, size: 1.1, spell: false,
      }));
    }
  }

  /** The player's attack (melee or spell) connected. */
  onHit(e, dmg, result) {
    const S = this.stats, game = this.game;
    if (S.igniteOnHit > 0 && e.alive) e.ignite(3, S.igniteOnHit);
    if (S.chainChance > 0 && Math.random() < S.chainChance) this.chain(e, dmg * 0.55, 2);
    if (result === 'riposte' && S.parryHeal > 0) this.heal(S.parryHeal * 0.5);
    game.player.addUltCharge(dmg * 0.3);
  }

  chain(from, dmg, jumps) {
    const game = this.game;
    const hit = new Set([from]);
    let src = from;
    for (let j = 0; j < jumps; j++) {
      let best = null, bd = 7;
      for (const e of game.nearbyEnemies()) {
        if (!e.active || hit.has(e)) continue;
        const d = e.pos.distanceTo(src.pos);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      hit.add(best);
      const a = src.pos.clone().setY(src.pos.y + (src.height || 1.8) * 0.6);
      const b = best.pos.clone().setY(best.pos.y + best.height * 0.6);
      game.addEffect(new Lightning(game, a, b));
      game.sparks(b, 10, 0xbfe4ff, 4);
      const dir = b.clone().sub(a).setY(0).normalize();
      best.takeRawDamage(dmg, dir, 1.5);
      if (best.alive) best.stun(0.25);
      game.onEnemyHit(best, best.alive ? 'spell' : 'kill', dir, dmg, { proc: true });
      src = best;
    }
    if (hit.size > 1) game.audio.play('zap');
  }

  onParry(attacker) {
    const S = this.stats, game = this.game, p = this.player;
    if (S.parryHeal > 0) this.heal(S.parryHeal);
    if (S.parryHaste > 0) this.hasteTimer = S.parryHaste;
    p.addUltCharge(10);
    if (S.parryShock > 0) {
      const r = 4 + S.parryShock;
      game.addEffect(new Shockwave(game, p.pos, r, 0x7af0d8));
      game.audio.play('shock');
      for (const e of game.nearbyEnemies()) {
        if (!e.active || e === attacker) continue;
        const d = e.pos.distanceTo(p.pos);
        if (d > r) continue;
        const dir = e.pos.clone().sub(p.pos).setY(0).normalize();
        e.takeRawDamage(8 * S.parryShock, dir, 6);
        if (e.alive) e.stun(1.2);
      }
    }
  }

  onKill(e) {
    const S = this.stats, game = this.game, p = this.player;
    p.addUltCharge(6);
    if (S.killHeal > 0) this.heal(S.killHeal);
    if (S.killMana > 0 && S.maxMana) p.mana = Math.min(S.maxMana, p.mana + S.killMana);
    if (S.corpseBurst > 0) {
      const c = e.pos.clone();
      game.addEffect(new Shockwave(game, c, 3.5, 0x9ae050, 0.35));
      game.glow.burst(c.clone().setY(c.y + 1), 26, () => ({
        vel: new THREE.Vector3(rand(-5, 5), rand(0, 5), rand(-5, 5)), life: rand(0.3, 0.7), size: rand(0.05, 0.1), color: pick([0x9ae050, 0x6ab030, 0xd0ff80]), drag: 3,
      }));
      game.audio.play('bloom');
      for (const o of game.nearbyEnemies()) {
        if (!o.active || o === e || o.pos.distanceTo(c) > 3.5) continue;
        const dir = o.pos.clone().sub(c).setY(0).normalize();
        o.takeRawDamage(S.corpseBurst, dir, 4);
        game.onEnemyHit(o, o.alive ? 'spell' : 'kill', dir, S.corpseBurst, { proc: true });
      }
    }
  }

  /** A killing blow landed: an Aegis of Mercy may refuse it. */
  tryWard() {
    const S = this.stats;
    if (!(S.deathWard > 0)) return false;
    S.deathWard--;
    const p = this.player;
    p.hp = p.stats.maxHp * 0.5;
    this.game.flash = 1;
    this.game.audio.play('angel');
    this.game.hud.banner('NOT YET', 'floor', 2);
    this.game.addEffect(new Shockwave(this.game, p.pos, 6, 0xffe080, 0.7));
    return true;
  }

  heal(n) {
    const p = this.player;
    p.hp = Math.min(p.stats.maxHp, p.hp + n);
  }

  // ---- Frame -----------------------------------------------------------------

  update(dt) {
    const p = this.player, S = this.stats, game = this.game;
    this.hasteTimer = Math.max(0, this.hasteTimer - dt);
    this.aegisTimer = Math.max(0, this.aegisTimer - dt);
    this.surgeTimer = Math.max(0, this.surgeTimer - dt);
    if (this.surgeTimer > 0 && S.maxMana) p.mana = S.maxMana;
    this.spin += dt * 3.2;
    const t = game.time;
    this.root.visible = game.state !== 'title';

    // Orbiting knives.
    const n = this.blades.length;
    for (let i = 0; i < n; i++) {
      const a = this.spin + (i / n) * TAU;
      const r = 1.6;
      const g = this.blades[i];
      g.position.set(p.pos.x + Math.cos(a) * r, p.pos.y + 1.0 + Math.sin(t * 3 + i) * 0.15, p.pos.z + Math.sin(a) * r);
      g.rotation.y = -a;
      for (const e of game.nearbyEnemies()) {
        if (!e.active) continue;
        if (Math.hypot(e.pos.x - g.position.x, e.pos.z - g.position.z) > e.radius + 0.35) continue;
        if (Math.abs(e.pos.y + e.height * 0.5 - g.position.y) > e.height) continue;
        const last = this.bladeHits.get(e) ?? -10;
        if (t - last < 0.45) continue;
        this.bladeHits.set(e, t);
        const dir = e.pos.clone().sub(p.pos).setY(0).normalize();
        const dmg = 6 * p.stats.damageMult;
        e.takeRawDamage(dmg, dir, 1);
        game.sparks(g.position, 6, this.bladeMat.color.getHex(), 3);
        game.onEnemyHit(e, e.alive ? 'spell' : 'kill', dir, dmg, { proc: true });
      }
    }

    // The saint's halo smites the nearest foe.
    if (this.haloMesh) {
      this.haloMesh.position.set(p.pos.x, p.pos.y + 2.15 + Math.sin(t * 2) * 0.05, p.pos.z);
      this.haloMesh.rotation.y += dt;
      this.haloTimer -= dt;
      if (this.haloTimer <= 0) {
        let best = null, bd = 13;
        for (const e of game.nearbyEnemies()) {
          if (!e.active) continue;
          const d = e.pos.distanceTo(p.pos);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          this.haloTimer = 1.1 / S.halo;
          const from = this.haloMesh.position.clone();
          const dir = best.pos.clone().setY(best.pos.y + best.height * 0.6).sub(from).normalize();
          game.addBolt(new Bolt(game, from, dir, p, 0xfff0b0, { damage: 12, speed: 16, homing: 6, size: 0.9, spell: false }));
          game.audio.play('halo');
        } else this.haloTimer = 0.3;
      }
    }

    // The Oath's aegis: a pale column around the knight.
    this.aegisMesh.visible = this.aegisTimer > 0;
    if (this.aegisMesh.visible) {
      this.aegisMesh.position.set(p.pos.x, p.pos.y + 1.1, p.pos.z);
      this.aegisMat.opacity = Math.min(1, this.aegisTimer) * (0.08 + 0.04 * Math.sin(t * 6));
      if (Math.random() < dt * 20) {
        const a = rand(0, TAU);
        game.glow.emit({
          pos: new THREE.Vector3(p.pos.x + Math.cos(a) * 1.1, p.pos.y + rand(0, 0.4), p.pos.z + Math.sin(a) * 1.1),
          vel: new THREE.Vector3(0, rand(1, 2.2), 0), life: rand(0.5, 1), size: 0.04, color: 0xffe0a0,
        });
      }
    }
  }
}

/** Sunfall: a captive sun drops from the dark onto a marked circle, then bursts. */
export class Sunfall {
  constructor(game, target, player) {
    this.game = game;
    this.player = player;
    this.target = target.clone();
    this.t = 0;
    this.fall = 0.95;
    this.done = false;
    this.group = new THREE.Group();
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false }));
    this.halo = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1),
      new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.group.add(this.core, this.halo);
    this.from = this.target.clone().add(new THREE.Vector3(rand(-3, 3), 18, rand(-3, 3)));
    this.group.position.copy(this.from);
    game.scene.add(this.group);
  }

  update(dt) {
    this.t += dt;
    const game = this.game;
    if (!this.done) {
      const k = Math.min(1, this.t / this.fall);
      this.group.position.lerpVectors(this.from, this.target, k * k);
      this.group.rotation.y += dt * 4;
      this.halo.scale.setScalar(1 + Math.sin(this.t * 30) * 0.08);
      for (let i = 0; i < 3; i++) {
        game.glow.emit({
          pos: this.group.position.clone().add(new THREE.Vector3(rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7))),
          vel: new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)), life: rand(0.3, 0.7), size: rand(0.08, 0.16), color: pick([0xffe080, 0xff9030, 0xffffff]),
        });
      }
      if (k >= 1) this.impact();
      return true;
    }
    // Afterglow: a dying ring of flame.
    const k = (this.t - this.fall) / 2.5;
    this.halo.material.opacity = Math.max(0, 0.5 * (1 - k * 3));
    this.halo.scale.setScalar(1 + k * 8);
    this.core.scale.setScalar(Math.max(0.01, 1 - k * 5));
    if (Math.random() < dt * 60 * (1 - k)) {
      const a = rand(0, TAU), r = rand(0, 6.5);
      game.glow.emit({
        pos: new THREE.Vector3(this.target.x + Math.cos(a) * r, this.target.y + 0.1, this.target.z + Math.sin(a) * r),
        vel: new THREE.Vector3(0, rand(1, 3), 0), life: rand(0.4, 0.9), size: rand(0.05, 0.1), color: pick([0xff7a20, 0xffb040, 0xff4a10]),
      });
    }
    if (k >= 1) { this.dispose(); return false; }
    return true;
  }

  impact() {
    this.done = true;
    const game = this.game, S = this.player.stats, c = this.target;
    game.flash = 1;
    game.shake(1);
    game.hitstop = Math.max(game.hitstop, 0.1);
    game.audio.play('boss-slam');
    game.audio.play('flare');
    game.addEffect(new Shockwave(game, c, 8, 0xffc060, 0.6));
    game.addEffect(new Shockwave(game, c, 5, 0xffffff, 0.35));
    game.glow.burst(c.clone().setY(c.y + 0.5), 120, () => ({
      vel: new THREE.Vector3(rand(-12, 12), rand(1, 10), rand(-12, 12)), life: rand(0.4, 1.2), size: rand(0.06, 0.16), color: pick([0xfff0b0, 0xffa030, 0xff6010]), drag: 2.5,
    }));
    for (const e of game.nearbyEnemies()) {
      if (!e.active) continue;
      const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
      if (d > 6.5 || Math.abs(e.pos.y - c.y) > 4) continue;
      const dir = e.pos.clone().sub(c).setY(0).normalize();
      const dmg = (100 - d * 9) * S.damageMult;
      e.takeRawDamage(dmg, dir, 8 / Math.max(1, e.mass * 0.5));
      if (e.alive) {
        e.ignite(5, 10);
        if (!e.addPosture(60)) e.stun(2);
      }
      game.onEnemyHit(e, e.alive ? 'spell' : 'kill', dir, dmg, { proc: true });
    }
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.core.geometry.dispose();
    this.halo.geometry.dispose();
  }
}
