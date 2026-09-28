import * as THREE from 'three';
import { rand, chance, clamp, damp, dampAngle, angleDiff, headingTo, easeOut, TAU } from './util.js';

const _v = new THREE.Vector3();

// ============================================================================
// Shared bits
// ============================================================================

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Floor marking that fills up before a heavy blow lands. */
export class GroundTelegraph {
  constructor(game, x, y, z, radius, duration, { arc = TAU, yaw = 0, color = 0xff2a14 } = {}) {
    this.game = game;
    this.t = 0;
    this.duration = duration;
    const start = arc >= TAU ? 0 : -Math.PI / 2 - arc / 2;
    const matOutline = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8, fog: false });
    const matFill = matOutline.clone();
    matFill.opacity = 0.3;
    this.group = new THREE.Group();
    this.group.position.set(x, y + 0.04, z);
    this.group.rotation.y = yaw;
    const outline = new THREE.Mesh(new THREE.RingGeometry(radius - 0.12, radius, 40, 1, start, arc).rotateX(-Math.PI / 2), matOutline);
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40, start, arc).rotateX(-Math.PI / 2), matFill);
    this.fill.scale.setScalar(0.01);
    this.group.add(outline, this.fill);
    game.scene.add(this.group);
    this.materials = [matOutline, matFill];
  }

  cancel() { this.t = this.duration; }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.fill.scale.setScalar(Math.max(0.01, k));
    this.materials[0].opacity = 0.5 + 0.5 * Math.sin(this.t * 30) * (1 - k) + k * 0.5;
    if (this.t >= this.duration) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

/** A crystal bolt. Parry it and it flies back at whoever cast it. */
export class Bolt {
  constructor(game, pos, dir, owner, color) {
    this.game = game;
    this.owner = owner;
    this.color = color;
    this.vel = dir.clone().multiplyScalar(12);
    this.life = 4;
    this.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color, fog: false }));
    this.mesh.scale.set(0.7, 0.7, 1.8);
    this.mesh.position.copy(pos);
    this.mesh.lookAt(pos.clone().add(dir));
    game.scene.add(this.mesh);
  }

  get pos() { return this.mesh.position; }

  update(dt) {
    this.life -= dt;
    const p = this.mesh.position;
    p.addScaledVector(this.vel, dt);
    this.mesh.rotation.z += dt * 12;
    if (Math.random() < dt * 60) {
      this.game.glow.emit({ pos: p, vel: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)), life: rand(0.2, 0.4), size: 0.06, color: this.color });
    }
    const world = this.game.room.world;
    if (this.life <= 0 || world.surfaceBlocks(p.x, p.z, p.y - 0.1, 0.2) || world.circles.some((c) => c.enabled && c.r > 0.3 && p.y > c.y0 && p.y < c.y1 && Math.hypot(p.x - c.x, p.z - c.z) < c.r)) {
      return this.dispose(true);
    }
    const player = this.game.player;
    if (this.owner !== player) {
      const eye = player.eyePosition;
      eye.y -= 0.35;
      if (p.distanceTo(eye) < 0.65) {
        const result = player.receiveAttack(this.owner, { damage: 14 * this.owner.damageMult, from: p });
        this.game.onBoltResolved(this, result);
        if (result === 'parried' && this.owner.alive) {
          const target = this.owner.pos.clone();
          target.y += this.owner.height * 0.6;
          this.vel = target.sub(p).normalize().multiplyScalar(20);
          this.mesh.lookAt(p.clone().add(this.vel));
          this.owner = player;
          return true;
        }
        return this.dispose(result !== 'miss');
      }
    } else {
      for (const e of this.game.room.enemies) {
        if (!e.active) continue;
        if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < e.radius + 0.35 && p.y > e.pos.y - 0.2 && p.y < e.pos.y + e.height + 0.2) {
          e.takeRawDamage(45, this.vel.clone().setY(0).normalize(), 5);
          this.game.onEnemyHit(e, e.alive ? 'hit' : 'kill', this.vel.clone().setY(0).normalize());
          return this.dispose(true);
        }
      }
    }
    return true;
  }

  dispose(burst = false) {
    if (burst) {
      this.game.glow.burst(this.mesh.position, 12, () => ({
        vel: new THREE.Vector3(rand(-3, 3), rand(-2, 3), rand(-3, 3)), life: rand(0.2, 0.5), size: 0.05, color: this.color, drag: 3,
      }));
    }
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    return false;
  }
}

// ============================================================================
// Base enemy
// ============================================================================

export class Enemy {
  constructor(game, chamber, x, y, z, cfg) {
    this.game = game;
    this.chamber = chamber;
    this.name = cfg.name;
    const scale = game.difficulty;
    this.maxHp = this.hp = cfg.hp * scale.hp;
    this.damageMult = scale.damage;
    this.speedMult = scale.speed;
    this.radius = cfg.radius;
    this.height = cfg.height ?? 1.9;
    this.mass = cfg.mass ?? 1;
    this.postureMax = cfg.postureMax ?? 50;
    this.parryPosture = cfg.parryPosture ?? 50;
    this.interruptOnParry = cfg.interruptOnParry ?? true;
    this.blockChance = cfg.blockChance ?? 0;
    this.brokenTime = cfg.brokenTime ?? 2;
    this.posture = 0;
    this.postureCooldown = 0;
    this.chunkColor = cfg.chunkColor ?? 0xcfc6ad;

    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.pos = this.group.position;
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.knockTimer = 0;
    this.yaw = headingTo(this.pos, game.player.pos);
    this.state = 'spawning';
    this.stateTime = 0;
    this.spawnDuration = rand(0.8, 1.2);
    this.flash = 0;
    this.glint = 0;
    this.flashMaterials = [];
    this.weaponMaterials = [];
    this.perilous = false;
    this.dead = false;
    this.removed = false;
    this.barTimer = 0;
    this.buildOverlay();
    chamber.group.add(this.group);
  }

  buildOverlay() {
    const g = this.game;
    this.barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x100808, fog: false, depthWrite: false }));
    this.barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xa81c14, fog: false, depthWrite: false }));
    this.barBg.scale.set(0.9, 0.06, 1);
    this.barFill.scale.set(0.86, 0.035, 1);
    this.barBg.renderOrder = this.barFill.renderOrder = 5;
    this.glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: g.riposteTexture, fog: false, depthTest: false, transparent: true }));
    this.glyph.scale.setScalar(0.3);
    this.glyph.renderOrder = 6;
    for (const s of [this.barBg, this.barFill, this.glyph]) {
      s.visible = false;
      this.group.add(s);
    }
  }

  mat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...opts });
    m.userData.baseEmissive = m.emissive.clone();
    this.flashMaterials.push(m);
    return m;
  }

  weaponMat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4, flatShading: true, ...opts });
    this.weaponMaterials.push(m);
    return m;
  }

  get alive() { return !this.dead; }
  get active() { return !this.dead && this.state !== 'spawning'; }
  get player() { return this.game.player; }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
    if (s !== 'windup') this.perilous = false;
  }

  distToPlayer() { return Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z); }
  headingToPlayer() { return headingTo(this.pos, this.player.pos); }
  forward() { return _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  facePlayer(dt, rate) { this.yaw = dampAngle(this.yaw, this.headingToPlayer(), rate, dt); }

  steer(dirX, dirZ, speed, dt, rate = 8) {
    this.vel.x = damp(this.vel.x, dirX * speed, rate, dt);
    this.vel.z = damp(this.vel.z, dirZ * speed, rate, dt);
  }

  brake(dt, rate = 8) { this.steer(0, 0, 0, dt, rate); }

  chase(dt, speed, stopAt = 0) {
    const p = this.player.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const s = d > stopAt ? speed : 0;
    this.steer(dx / d, dz / d, s, dt);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 9, dt);
  }

  strafe(dt, speed, dir) {
    const p = this.player.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.steer((-dz / d) * dir, (dx / d) * dir, speed, dt, 5);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 9, dt);
  }

  /** Telegraph the next blow: a gleam on the weapon for parryable strikes, a red glow for perilous ones. */
  beginWindup(duration, { perilous = false } = {}) {
    this.setState('windup');
    this.windupTime = duration;
    this.perilous = perilous;
    this.glint = perilous ? duration : 0.22;
    this.game.onEnemyTelegraph(this, perilous);
  }

  /** Swing at the player. Returns the outcome from Player.receiveAttack (or 'miss'). */
  attackPlayer({ damage, range, arc, perilous = false, from = null }) {
    const p = this.player;
    if (!from) {
      const d = this.distToPlayer();
      if (d - p.radius > range || Math.abs(p.pos.y - this.pos.y) > 2) return 'miss';
      if (Math.abs(angleDiff(this.yaw, this.headingToPlayer())) > arc / 2 && d > this.radius + p.radius + 0.3) return 'miss';
    }
    const result = p.receiveAttack(this, { damage: damage * this.damageMult, perilous, from: from || this.pos });
    this.game.onEnemyAttackResolved(this, result);
    if (result === 'parried') this.onParried();
    return result;
  }

  canBlock() {
    return this.blockChance > 0 && (this.state === 'chase' || this.state === 'strafe' || this.state === 'recover')
      && Math.abs(angleDiff(this.yaw, this.headingToPlayer())) < 1.1;
  }

  addPosture(amount) {
    this.posture += amount;
    this.postureCooldown = 1.5;
    if (this.posture >= this.postureMax) {
      this.posture = 0;
      this.setState('broken');
      this.game.onPostureBroken(this);
      return true;
    }
    return false;
  }

  onParried() {
    const dmg = this.player.stats.parryDamage;
    if (dmg > 0) this.takeRawDamage(dmg, this.forward().clone().negate(), 0);
    if (this.dead) return;
    if (this.addPosture(this.parryPosture)) return;
    if (this.interruptOnParry) this.setState('stagger');
  }

  /** The knight's blade lands. Returns 'blocked' | 'hit' | 'riposte' | 'kill' | 'miss'. */
  receiveHit(damage, dir, player) {
    if (!this.active) return 'miss';
    if (this.canBlock() && chance(this.blockChance)) {
      this.setState('block');
      this.addPosture(10);
      return 'blocked';
    }
    let mult = 1;
    let result = 'hit';
    if (this.state === 'broken') { mult = player.stats.riposteMult * 1.8; result = 'riposte'; }
    else if (this.state === 'stagger') { mult = player.stats.riposteMult; result = 'riposte'; }
    this.takeRawDamage(damage * mult, dir, result === 'riposte' ? 7 : 2.5);
    if (this.dead) return 'kill';
    if (result === 'riposte') this.setState('recover');
    else {
      this.addPosture(6);
      if (this.state !== 'broken') this.onFlinch();
    }
    return result;
  }

  takeRawDamage(amount, dir, knock) {
    if (this.dead) return;
    this.hp -= amount;
    this.flash = 0.09;
    this.barTimer = 4;
    this.vel.addScaledVector(dir, knock / this.mass);
    if (knock > 0) this.knockTimer = 0.3;
    if (this.hp <= 0) this.die();
  }

  onFlinch() {}

  die(fell = false) {
    if (this.dead) return;
    this.dead = true;
    this.group.visible = false;
    if (!fell) {
      const c = this.pos.clone();
      c.y += this.height * 0.55;
      const floor = this.pos.y;
      this.game.particles.burst(c, 24, () => ({
        vel: new THREE.Vector3(rand(-4, 4), rand(1, 6), rand(-4, 4)),
        life: rand(1.5, 3), size: rand(0.08, 0.2), color: this.chunkColor, gravity: 18, bounce: 0.35, linger: true, floor,
      }));
      this.game.glow.burst(c, 16, () => ({
        vel: new THREE.Vector3(rand(-3, 3), rand(0, 3), rand(-3, 3)), life: rand(0.3, 0.8), size: 0.05, color: this.game.theme.crystal, drag: 3,
      }));
      this.game.audio.play('shatter');
    }
    this.game.onEnemyKilled(this, fell);
    this.removed = true;
  }

  // ---- Frame ---------------------------------------------------------------

  update(dt) {
    if (this.dead) return;
    this.stateTime += dt;
    this.knockTimer = Math.max(0, this.knockTimer - dt);
    this.postureCooldown -= dt;
    if (this.postureCooldown <= 0) this.posture = Math.max(0, this.posture - dt * 10);

    if (this.state === 'spawning') {
      const k = Math.min(1, this.stateTime / this.spawnDuration);
      this.rig.position.y = -2.4 * (1 - easeOut(k));
      this.rig.rotation.z = Math.sin(k * 20) * 0.1 * (1 - k);
      this.yaw = this.headingToPlayer();
      this.group.rotation.y = this.yaw;
      if (Math.random() < dt * 30) {
        this.game.particles.emit({
          pos: new THREE.Vector3(this.pos.x + rand(-0.5, 0.5), this.pos.y + 0.1, this.pos.z + rand(-0.5, 0.5)),
          vel: new THREE.Vector3(rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5)), life: rand(0.5, 1), size: rand(0.06, 0.14), color: 0x2a2c34, gravity: 8, linger: true, floor: this.pos.y,
        });
      }
      if (k >= 1) {
        this.rig.rotation.z = 0;
        this.rig.position.y = 0;
        this.setState('chase');
      }
      this.updateOverlay(dt);
      return;
    }

    if (!this.updateCommonStates(dt)) {
      if (this.player.alive) this.think(dt);
      else this.brake(dt, 4);
    }

    // Physics: edge-cautious unless knocked back, in which case the abyss may claim them.
    const world = this.chamber.world;
    world.move(this.pos, this.pos.y, this.vel.x * dt, this.vel.z * dt, this.radius, this.height, { allowFall: this.knockTimer > 0 });
    const p = this.player.pos;
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    const d = Math.hypot(dx, dz), min = this.radius + this.player.radius;
    if (d < min && d > 1e-4 && Math.abs(this.pos.y - p.y) < 1.5) {
      this.pos.x = p.x + (dx / d) * min;
      this.pos.z = p.z + (dz / d) * min;
    }
    this.vy -= 17 * dt;
    const ground = world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const ny = this.pos.y + this.vy * dt;
    if (ground !== null && ny <= ground) { this.pos.y = ground; this.vy = 0; }
    else if (ground !== null && this.pos.y - ground < 0.6 && this.vy <= 0) { this.pos.y = ground; this.vy = 0; }
    else this.pos.y = ny;
    if (this.pos.y < -14) {
      this.game.audio.play('fall');
      this.die(true);
      return;
    }

    this.group.rotation.y = this.yaw;
    this.flash = Math.max(0, this.flash - dt);
    for (const m of this.flashMaterials) {
      if (this.flash > 0) m.emissive.setRGB(1, 0.9, 0.8);
      else m.emissive.copy(m.userData.baseEmissive);
    }
    this.glint = Math.max(0, this.glint - dt);
    for (const m of this.weaponMaterials) {
      if (this.perilous && this.state === 'windup') m.emissive.setRGB(2.5, 0.15, 0.05);
      else if (this.glint > 0) m.emissive.setRGB(3 * this.glint / 0.22, 2.6 * this.glint / 0.22, 2 * this.glint / 0.22);
      else m.emissive.setRGB(0, 0, 0);
    }
    this.animate(dt);
    this.updateOverlay(dt);
  }

  /** States every enemy shares: blocking, staggered, posture-broken, flinching. */
  updateCommonStates(dt) {
    switch (this.state) {
      case 'block':
        this.brake(dt, 10);
        if (this.stateTime > 0.45) this.setState('chase');
        return true;
      case 'stagger':
        this.brake(dt, 6);
        if (this.stateTime > 1.0) this.setState('chase');
        return true;
      case 'broken':
        this.brake(dt, 5);
        if (this.stateTime > this.brokenTime) this.setState('chase');
        return true;
      case 'flinch':
        this.brake(dt, 6);
        if (this.stateTime > 0.22) this.setState('chase');
        return true;
    }
    return false;
  }

  updateOverlay(dt) {
    this.barTimer -= dt;
    const showBar = this.barTimer > 0 && !this.isBoss;
    const top = this.height + 0.35;
    this.barBg.visible = this.barFill.visible = showBar;
    if (showBar) {
      const k = clamp(this.hp / this.maxHp, 0.01, 1);
      this.barBg.position.set(0, top, 0);
      this.barFill.position.set(0, top, 0);
      this.barFill.scale.x = 0.86 * k;
      this.barFill.center.set(0.5 / k, 0.5);
    }
    const open = this.state === 'stagger' || this.state === 'broken';
    this.glyph.visible = open;
    if (open) {
      this.glyph.position.set(0, this.height * 0.62, 0);
      this.glyph.scale.setScalar(this.state === 'broken' ? 0.42 + Math.sin(this.game.time * 10) * 0.05 : 0.26);
    }
  }

  think() {}
  animate() {}
}

// ============================================================================
// Hollow — sword skeleton
// ============================================================================

function buildSkeletonRig(mats, { scale = 1, weapon = 'blade' } = {}) {
  const { bone, weaponMat, eye, socket } = mats;
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const parts = { root };
  parts.legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.15, 0.82, 0);
    leg.add(box(0.11, 0.8, 0.11, bone, 0, -0.4, 0));
    leg.add(box(0.14, 0.06, 0.24, bone, 0, -0.79, 0.05));
    root.add(leg);
    parts.legs.push(leg);
  }
  root.add(box(0.42, 0.12, 0.2, bone, 0, 0.84, 0));
  root.add(box(0.08, 0.5, 0.08, bone, 0, 1.1, -0.04));
  for (let i = 0; i < 3; i++) root.add(box(0.46 - i * 0.04, 0.06, 0.28, bone, 0, 1.18 + i * 0.12, 0));
  root.add(box(0.62, 0.08, 0.12, bone, 0, 1.49, 0));
  const head = new THREE.Group();
  head.position.set(0, 1.72, 0.02);
  head.add(box(0.34, 0.3, 0.36, bone, 0, 0, 0));
  head.add(box(0.26, 0.1, 0.28, bone, 0, -0.19, 0.02));
  for (const side of [-1, 1]) {
    head.add(box(0.1, 0.08, 0.02, socket, side * 0.08, 0.01, 0.18));
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), eye);
    e.position.set(side * 0.08, 0.01, 0.192);
    head.add(e);
  }
  root.add(head);
  parts.head = head;
  parts.arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.32, 1.46, 0);
    arm.rotation.order = 'YXZ';
    arm.add(box(0.09, 0.72, 0.09, bone, 0, -0.36, 0));
    root.add(arm);
    parts.arms.push(arm);
  }
  const weaponArm = parts.arms[0];
  if (weapon === 'blade') {
    weaponArm.add(box(0.06, 0.05, 1.0, weaponMat, 0, -0.7, 0.45));
    weaponArm.add(box(0.24, 0.05, 0.05, weaponMat, 0, -0.7, -0.02));
  } else if (weapon === 'cleaver') {
    weaponArm.add(box(0.1, 0.1, 0.5, weaponMat, 0, -0.7, 0.2));
    weaponArm.add(box(0.08, 0.55, 1.4, weaponMat, 0, -0.6, 1.1));
  }
  return parts;
}

export class Skeleton extends Enemy {
  constructor(game, chamber, x, y, z) {
    super(game, chamber, x, y, z, { name: 'Hollow', hp: 42, radius: 0.45, height: 1.9, blockChance: 0.25, postureMax: 60, parryPosture: 35 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a10, fog: false });
    this.parts = buildSkeletonRig({
      bone: this.mat(0xc9bfa6),
      weaponMat: this.weaponMat(0x5a5048),
      socket: new THREE.MeshBasicMaterial({ color: 0x050303 }),
      eye: this.eyeMat,
    });
    this.rig.add(this.parts.root);
    this.speed = 3.4 * this.speedMult * rand(0.9, 1.1);
    this.cooldown = rand(0.5, 1.4);
    this.walk = rand(0, TAU);
    this.strafeDir = chance(0.5) ? 1 : -1;
    this.comboLeft = 0;
  }

  onFlinch() {
    if (this.state === 'windup' && chance(0.5)) return; // sometimes they power through
    this.setState('flinch');
  }

  think(dt) {
    this.cooldown -= dt;
    const d = this.distToPlayer();
    switch (this.state) {
      case 'chase':
        if (d < 3.5 && this.cooldown > 0) {
          this.strafe(dt, 1.4, this.strafeDir);
          if (chance(dt * 0.6)) this.strafeDir *= -1;
        } else this.chase(dt, this.speed, 1.6);
        if (d < 2.5 && this.cooldown <= 0) {
          this.comboLeft = this.game.depth >= 2 && chance(0.45) ? 1 : 0;
          this.beginWindup(0.62);
        }
        break;
      case 'windup':
        this.brake(dt, 10);
        this.facePlayer(dt, 6);
        if (this.stateTime >= this.windupTime) {
          this.setState('strike');
          this.struck = false;
          this.game.audio.play('swing');
        }
        break;
      case 'strike': {
        const f = this.forward();
        this.vel.set(f.x * 5, 0, f.z * 5);
        if (!this.struck && this.stateTime > 0.06) {
          this.struck = true;
          this.attackPlayer({ damage: 15, range: 2.2, arc: 1.5 });
          if (this.state !== 'strike') break; // parried
        }
        if (this.stateTime > 0.2) {
          if (this.comboLeft-- > 0) this.beginWindup(0.38);
          else this.setState('recover');
        }
        break;
      }
      case 'recover':
        this.brake(dt, 10);
        if (this.stateTime > 0.7) {
          this.cooldown = rand(0.6, 1.6);
          this.setState('chase');
        }
        break;
    }
  }

  animate(dt) {
    const P = this.parts;
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 3.5);
    this.walk += dt * 10 * speedN;
    const s = Math.sin(this.walk) * 0.7 * speedN;
    P.legs[0].rotation.x = s;
    P.legs[1].rotation.x = -s;
    let armX = -0.35 - s * 0.3, armZ = 0, lean = 0.08 * speedN;
    switch (this.state) {
      case 'windup': armX = -2.8; armZ = 0.3; lean = -0.2; break;
      case 'strike': armX = -0.7; lean = 0.35; break;
      case 'recover': armX = -0.6; lean = 0.2; break;
      case 'block': armX = -1.5; armZ = 1.2; lean = -0.1; break;
      case 'stagger': case 'broken': armX = 0.4; lean = -0.4; break;
      case 'flinch': lean = -0.25; break;
    }
    const arm = P.arms[0];
    const r = this.state === 'strike' ? 40 : 14;
    arm.rotation.x = damp(arm.rotation.x, armX, r, dt);
    arm.rotation.z = damp(arm.rotation.z, armZ, r, dt);
    P.arms[1].rotation.x = damp(P.arms[1].rotation.x, s * 0.5 - 0.2, 14, dt);
    P.root.rotation.x = damp(P.root.rotation.x, lean, 14, dt);
    P.head.rotation.z = Math.sin(this.game.time * 3 + this.walk) * 0.08;
    this.eyeMat.color.setHex(this.state === 'windup' ? 0xffe0a0 : 0xff2a10);
  }
}

// ============================================================================
// Shade — circles you, then lunges
// ============================================================================

export class Shade extends Enemy {
  constructor(game, chamber, x, y, z) {
    super(game, chamber, x, y, z, { name: 'Shade', hp: 24, radius: 0.45, height: 2.0, mass: 0.7, chunkColor: 0x151020, postureMax: 30, parryPosture: 40 });
    const robe = this.mat(0x0c0a14, { emissive: 0x140a26 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8a8ff, fog: false });
    this.body = new THREE.Group();
    this.body.position.y = 0.35;
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.5, 7, 1, true), robe);
    cloak.position.y = 0.75;
    cloak.castShadow = true;
    this.body.add(cloak);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 6), robe);
    hood.position.set(0, 1.55, -0.02);
    hood.castShadow = true;
    this.body.add(hood);
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.02), this.eyeMat);
      e.position.set(side * 0.08, 1.42, 0.2);
      this.body.add(e);
    }
    const claw = this.weaponMat(0x1a1424);
    for (const side of [-1, 1]) {
      const c = box(0.05, 0.05, 0.6, claw, side * 0.35, 1.0, 0.35);
      c.rotation.x = -0.4;
      this.body.add(c);
    }
    this.shards = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.14), robe);
      this.body.add(s);
      this.shards.push(s);
    }
    this.rig.add(this.body);
    this.speed = 4.6 * this.speedMult;
    this.orbitDir = chance(0.5) ? 1 : -1;
    this.nextDash = rand(1.6, 3);
    this.dashDir = new THREE.Vector3();
  }

  onFlinch() {
    if (this.state === 'windup') this.setState('chase');
  }

  think(dt) {
    const d = this.distToPlayer();
    const p = this.player.pos;
    switch (this.state) {
      case 'chase': {
        this.nextDash -= dt;
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
        const inv = 1 / (d || 1);
        const radial = clamp((d - 4.5) * 0.8, -1, 1);
        const tx = dx * inv * radial - dz * inv * this.orbitDir * 0.9;
        const tz = dz * inv * radial + dx * inv * this.orbitDir * 0.9;
        const len = Math.hypot(tx, tz) || 1;
        this.steer(tx / len, tz / len, this.speed, dt, 5);
        this.facePlayer(dt, 8);
        if (this.nextDash <= 0 && d < 9) {
          this.beginWindup(0.6);
          this.game.audio.play('shriek');
        }
        break;
      }
      case 'windup':
        this.brake(dt, 8);
        this.facePlayer(dt, 12);
        if (this.stateTime >= this.windupTime) {
          this.dashDir.copy(this.forward());
          this.struck = false;
          this.setState('dash');
        }
        break;
      case 'dash':
        this.vel.set(this.dashDir.x * 14, 0, this.dashDir.z * 14);
        if (!this.struck && d < this.radius + this.player.radius + 0.6) {
          this.struck = true;
          this.attackPlayer({ damage: 12, range: 1.4, arc: TAU });
          if (this.state !== 'dash') break;
        }
        if (this.stateTime > 0.45) this.setState('recover');
        break;
      case 'recover':
        this.brake(dt, 4);
        if (this.stateTime > 0.8) {
          this.nextDash = rand(1.6, 3.2);
          if (chance(0.4)) this.orbitDir *= -1;
          this.setState('chase');
        }
        break;
    }
  }

  animate(dt) {
    const t = this.game.time;
    const shiver = this.state === 'windup' ? Math.sin(t * 90) * 0.06 : 0;
    this.body.position.y = 0.35 + Math.sin(t * 2.5 + this.orbitDir) * 0.12;
    this.body.position.x = shiver;
    this.body.rotation.x = this.state === 'dash' ? 0.6 : this.state === 'stagger' || this.state === 'broken' ? -0.4 : 0.15;
    this.shards.forEach((s, i) => {
      const a = t * 2.4 + (i * TAU) / 3;
      s.position.set(Math.cos(a) * 0.75, 0.9 + Math.sin(a * 1.3) * 0.25, Math.sin(a) * 0.75);
      s.rotation.set(a, a * 0.7, 0);
    });
    this.eyeMat.color.setHex(this.state === 'windup' ? 0xffffff : 0xc8a8ff);
    if (Math.random() < dt * (this.state === 'dash' ? 60 : 12)) {
      this.game.particles.emit({
        pos: new THREE.Vector3(this.pos.x + rand(-0.4, 0.4), this.pos.y + rand(0.3, 1.4), this.pos.z + rand(-0.4, 0.4)),
        vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.4, 1.1), rand(-0.3, 0.3)), life: rand(0.5, 1), size: rand(0.08, 0.18), color: 0x0e0a14,
      });
    }
  }
}

// ============================================================================
// Lumen Acolyte — keeps its distance and hurls crystal bolts
// ============================================================================

export class Acolyte extends Enemy {
  constructor(game, chamber, x, y, z) {
    super(game, chamber, x, y, z, { name: 'Lumen Acolyte', hp: 26, radius: 0.45, height: 2.0, chunkColor: 0x3a4460, postureMax: 30, parryPosture: 30 });
    const color = game.theme.crystal;
    const robe = this.mat(0x1c2230);
    const trim = this.mat(0x3a3020);
    const body = new THREE.Group();
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 7), robe);
    cloak.position.y = 0.8;
    cloak.castShadow = true;
    body.add(cloak);
    body.add(box(0.7, 0.1, 0.4, trim, 0, 1.3, 0));
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 6), robe);
    hood.position.y = 1.85;
    hood.castShadow = true;
    body.add(hood);
    body.add(box(0.2, 0.18, 0.05, new THREE.MeshBasicMaterial({ color: 0x020204 }), 0, 1.72, 0.2));
    this.eyeMat = new THREE.MeshBasicMaterial({ color, fog: false });
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), this.eyeMat);
      e.position.set(side * 0.05, 1.74, 0.23);
      body.add(e);
    }
    this.staff = new THREE.Group();
    this.staff.position.set(-0.42, 1.0, 0.15);
    this.staff.add(box(0.06, 2.0, 0.06, this.mat(0x2a1e14), 0, 0.2, 0));
    this.crystalMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, flatShading: true });
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), this.crystalMat);
    tip.scale.y = 1.8;
    tip.position.y = 1.35;
    this.staff.add(tip);
    this.tip = tip;
    body.add(this.staff);
    this.rig.add(body);
    this.body = body;
    this.speed = 3 * this.speedMult;
    this.castTimer = rand(1.2, 2.5);
    this.strafeDir = chance(0.5) ? 1 : -1;
  }

  onFlinch() { this.setState('flinch'); }

  think(dt) {
    const d = this.distToPlayer();
    switch (this.state) {
      case 'chase':
        this.castTimer -= dt;
        if (d < 5.5) {
          const p = this.player.pos;
          const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
          this.steer(dx / (d || 1), dz / (d || 1), this.speed, dt, 6);
          this.facePlayer(dt, 8);
        } else if (d > 11) this.chase(dt, this.speed);
        else {
          this.strafe(dt, 1.8, this.strafeDir);
          if (chance(dt * 0.5)) this.strafeDir *= -1;
        }
        if (this.castTimer <= 0 && d < 16) {
          this.beginWindup(0.85);
          this.game.audio.play('cast');
        }
        break;
      case 'windup':
        this.brake(dt, 8);
        this.facePlayer(dt, 10);
        if (this.stateTime >= this.windupTime) {
          const from = this.tip.getWorldPosition(new THREE.Vector3());
          const target = this.player.eyePosition;
          target.y -= 0.35;
          target.addScaledVector(this.player.vel.clone().setY(0), 0.25);
          this.game.addBolt(new Bolt(this.game, from, target.sub(from).normalize(), this, this.game.theme.crystal));
          this.game.audio.play('bolt');
          this.setState('recover');
        }
        break;
      case 'recover':
        this.brake(dt, 6);
        if (this.stateTime > 0.6) {
          this.castTimer = rand(1.8, 3.2);
          this.setState('chase');
        }
        break;
    }
  }

  animate(dt) {
    const t = this.game.time;
    this.body.position.y = Math.sin(t * 2 + this.strafeDir) * 0.05;
    const casting = this.state === 'windup';
    this.staff.rotation.x = damp(this.staff.rotation.x, casting ? -0.9 : 0, 10, dt);
    this.crystalMat.emissiveIntensity = casting ? 2 + this.stateTime * 6 : 1.2;
    this.body.rotation.x = this.state === 'stagger' || this.state === 'broken' ? -0.35 : 0;
    if (casting && Math.random() < dt * 40) {
      this.game.glow.emit({
        pos: this.tip.getWorldPosition(new THREE.Vector3()),
        vel: new THREE.Vector3(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)), life: 0.3, size: 0.05, color: this.game.theme.crystal,
      });
    }
  }
}

// ============================================================================
// Crystal Brute — heavy knight with a perilous thrust
// ============================================================================

export class Brute extends Enemy {
  constructor(game, chamber, x, y, z) {
    super(game, chamber, x, y, z, {
      name: 'Geode Knight', hp: 110, radius: 0.7, height: 2.5, mass: 3, chunkColor: 0x4a4e5a,
      postureMax: 100, parryPosture: 34, interruptOnParry: false, blockChance: 0.3, brokenTime: 2.4,
    });
    const armor = this.mat(0x3a3e4a, { metalness: 0.3, roughness: 0.6 });
    const dark = this.mat(0x1c1e24);
    const crystalMat = new THREE.MeshStandardMaterial({ color: game.theme.crystal, emissive: game.theme.crystal, emissiveIntensity: 1.3, flatShading: true });
    const r = new THREE.Group();
    r.scale.setScalar(1.35);
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.22, 0.85, 0);
      leg.add(box(0.28, 0.85, 0.32, dark, 0, -0.42, 0));
      r.add(leg);
      this.legs.push(leg);
    }
    r.add(box(0.85, 0.75, 0.5, armor, 0, 1.3, 0));
    r.add(box(0.6, 0.25, 0.45, dark, 0, 0.88, 0));
    for (const side of [-1, 1]) {
      const p = box(0.4, 0.3, 0.6, armor, side * 0.55, 1.62, 0);
      p.rotation.z = side * -0.3;
      r.add(p);
    }
    r.add(box(0.44, 0.46, 0.46, armor, 0, 1.95, 0.02));
    this.eyeMat = new THREE.MeshBasicMaterial({ color: game.theme.crystal, fog: false });
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.02), this.eyeMat);
    slit.position.set(0, 1.97, 0.26);
    r.add(slit);
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.08, rand(0.4, 0.8), 6), crystalMat);
      c.position.set(rand(-0.35, 0.35), rand(1.4, 1.9), -0.28);
      c.rotation.set(-0.6 + rand(-0.4, 0.4), 0, rand(-0.6, 0.6));
      r.add(c);
    }
    this.arm = new THREE.Group();
    this.arm.rotation.order = 'YXZ';
    this.arm.position.set(-0.55, 1.55, 0);
    this.arm.add(box(0.2, 0.7, 0.2, armor, 0, -0.35, 0));
    const blade = this.weaponMat(0x6a6e78);
    this.arm.add(box(0.12, 0.12, 0.3, dark, 0, -0.72, 0.1));
    this.arm.add(box(0.14, 0.05, 1.8, blade, 0, -0.72, 1.1));
    r.add(this.arm);
    this.rig.add(r);
    this.root = r;
    this.speed = 2.5 * this.speedMult;
    this.cooldown = 1.2;
    this.walk = 0;
  }

  think(dt) {
    this.cooldown -= dt;
    const d = this.distToPlayer();
    switch (this.state) {
      case 'chase':
        this.chase(dt, this.speed, 2.2);
        if (this.cooldown <= 0 && d < 3.4) {
          this.attack = chance(0.4) ? 'thrust' : 'overhead';
          this.beginWindup(this.attack === 'thrust' ? 0.8 : 0.9, { perilous: this.attack === 'thrust' });
        }
        break;
      case 'windup':
        this.brake(dt, 10);
        this.facePlayer(dt, this.attack === 'thrust' ? 5 : 3.5);
        if (this.stateTime >= this.windupTime) {
          this.setState('strike');
          this.struck = false;
          this.game.audio.play('swing');
        }
        break;
      case 'strike': {
        const f = this.forward();
        const lunge = this.attack === 'thrust' ? 8 : 2;
        this.vel.set(f.x * lunge, 0, f.z * lunge);
        if (!this.struck && this.stateTime > 0.08) {
          this.struck = true;
          if (this.attack === 'thrust') this.attackPlayer({ damage: 30, range: 3.4, arc: 0.9, perilous: true });
          else this.attackPlayer({ damage: 24, range: 3.0, arc: 1.4 });
          if (this.state === 'broken') break;
        }
        if (this.stateTime > 0.3) this.setState('recover');
        break;
      }
      case 'recover':
        this.brake(dt, 8);
        if (this.stateTime > 0.95) {
          this.cooldown = rand(0.8, 1.8);
          this.setState('chase');
        }
        break;
    }
  }

  animate(dt) {
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 2.5);
    this.walk += dt * 6 * speedN;
    const s = Math.sin(this.walk) * 0.5 * speedN;
    this.legs[0].rotation.x = s;
    this.legs[1].rotation.x = -s;
    let ax = -0.4, az = 0, lean = 0.05;
    if (this.state === 'windup') {
      if (this.attack === 'thrust') { ax = -1.5; az = 0; lean = -0.15; }
      else { ax = -3.0; lean = -0.25; }
    } else if (this.state === 'strike') {
      if (this.attack === 'thrust') { ax = -1.6; lean = 0.35; }
      else { ax = -0.8; lean = 0.4; }
    } else if (this.state === 'block') { ax = -1.4; az = 1.3; }
    else if (this.state === 'broken' || this.state === 'stagger') { ax = 0.3; lean = -0.35; }
    const r = this.state === 'strike' ? 35 : 10;
    this.arm.rotation.x = damp(this.arm.rotation.x, ax, r, dt);
    this.arm.rotation.z = damp(this.arm.rotation.z, az, r, dt);
    this.root.rotation.x = damp(this.root.rotation.x, lean, 10, dt);
  }
}

// ============================================================================
// Warden — floor guardian
// ============================================================================

export class Warden extends Enemy {
  constructor(game, chamber, x, y, z, name) {
    super(game, chamber, x, y, z, {
      name, hp: 320, radius: 1.25, height: 3.2, mass: 6, chunkColor: 0x9a927e,
      postureMax: 130, parryPosture: 30, interruptOnParry: false, blockChance: 0.18, brokenTime: 2.6,
    });
    this.isBoss = true;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, fog: false });
    const iron = this.mat(0x26262b, { metalness: 0.5, roughness: 0.6 });
    this.parts = buildSkeletonRig({
      bone: this.mat(0xb3aa92),
      weaponMat: this.weaponMat(0x3a3a42),
      socket: new THREE.MeshBasicMaterial({ color: 0x050303 }),
      eye: this.eyeMat,
    }, { scale: 1.75, weapon: 'cleaver' });
    const r = this.parts.root;
    r.add(box(0.7, 0.55, 0.45, iron, 0, 1.28, 0));
    const crystalMat = new THREE.MeshStandardMaterial({ color: game.theme.crystal, emissive: game.theme.crystal, emissiveIntensity: 1.3, flatShading: true });
    for (const side of [-1, 1]) {
      const pauldron = box(0.34, 0.2, 0.44, iron, side * 0.38, 1.54, 0);
      pauldron.rotation.z = side * -0.3;
      r.add(pauldron);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 5), this.mat(0x2a2218));
      horn.position.set(side * 0.2, 0.22, 0);
      horn.rotation.z = side * -0.5;
      this.parts.head.add(horn);
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.05, rand(0.25, 0.45), 6), crystalMat);
        c.position.set(side * rand(0.3, 0.5), 1.68, rand(-0.15, 0.15));
        c.rotation.z = side * -rand(0.2, 0.7);
        r.add(c);
      }
    }
    this.rig.add(r);
    this.speed = 2.4 * this.speedMult;
    this.cooldown = 1.2;
    this.walk = 0;
    this.target = new THREE.Vector3();
  }

  think(dt) {
    this.cooldown -= dt;
    const d = this.distToPlayer();
    switch (this.state) {
      case 'chase':
        this.chase(dt, this.speed, 3.2);
        if (this.cooldown <= 0) {
          const r = Math.random();
          if (d < 3.8) {
            if (r < 0.45) this.startCombo();
            else if (r < 0.75) this.startSweep();
            else this.startSlam();
          } else if (d < 8 && r < 0.4) this.startSlam();
        }
        break;
      case 'windup':
        this.brake(dt, 10);
        if (this.attack !== 'slam') this.facePlayer(dt, this.attack === 'sweep' ? 2.5 : 4);
        if (this.telegraph && this.attack === 'sweep') this.telegraph.group.rotation.y = this.yaw;
        if (this.stateTime >= this.windupTime) this.release();
        break;
      case 'strike':
        if (this.stateTime > 0.25) this.afterStrike();
        break;
      case 'recover':
        this.brake(dt, 6);
        if (this.stateTime > 1.0) {
          this.cooldown = rand(0.5, 1.3);
          this.setState('chase');
        }
        break;
    }
  }

  startCombo() {
    this.attack = 'combo';
    this.comboTimes = [0.75, 0.4, 0.5];
    this.comboIndex = 0;
    this.beginWindup(this.comboTimes[0]);
  }

  startSweep() {
    this.attack = 'sweep';
    this.beginWindup(0.7);
    this.telegraph = new GroundTelegraph(this.game, this.pos.x, this.pos.y, this.pos.z, 4, 0.7, { arc: Math.PI * 1.3, yaw: this.yaw, color: 0xffb040 });
    this.game.addEffect(this.telegraph);
  }

  startSlam() {
    this.attack = 'slam';
    const p = this.player;
    this.target.set(p.pos.x + p.vel.x * 0.3, p.pos.y, p.pos.z + p.vel.z * 0.3);
    this.yaw = headingTo(this.pos, this.target);
    this.beginWindup(1.05, { perilous: true });
    this.telegraph = new GroundTelegraph(this.game, this.target.x, this.target.y, this.target.z, 2.8, 1.05);
    this.game.addEffect(this.telegraph);
  }

  release() {
    const g = this.game;
    this.setState('strike');
    if (this.attack === 'slam') {
      const p = this.player.pos;
      if (Math.hypot(p.x - this.target.x, p.z - this.target.z) < 2.8 + 0.2 && Math.abs(p.y - this.target.y) < 1.2) {
        this.attackPlayer({ damage: 30, perilous: true, from: this.target });
      }
      g.audio.play('boss-slam');
      g.shake(0.8);
      g.particles.burst(this.target.clone().setY(this.target.y + 0.1), 40, (i) => {
        const a = (i / 40) * TAU;
        return { vel: new THREE.Vector3(Math.cos(a) * rand(3, 7), rand(1, 4), Math.sin(a) * rand(3, 7)), life: rand(0.6, 1.4), size: rand(0.1, 0.25), color: 0x2f3038, gravity: 12, linger: true, floor: this.target.y };
      });
    } else if (this.attack === 'sweep') {
      g.audio.play('swing');
      this.attackPlayer({ damage: 22, range: 4.2, arc: Math.PI * 1.3 });
    } else {
      g.audio.play('swing');
      const f = this.forward();
      this.vel.set(f.x * 4, 0, f.z * 4);
      this.attackPlayer({ damage: 18, range: 3.4, arc: 1.6 });
    }
    this.telegraph = null;
  }

  afterStrike() {
    if (this.attack === 'combo' && ++this.comboIndex < this.comboTimes.length) {
      this.beginWindup(this.comboTimes[this.comboIndex]);
      return;
    }
    this.setState('recover');
  }

  onParried() {
    super.onParried();
    if (this.state === 'broken' && this.telegraph) {
      this.telegraph.cancel();
      this.telegraph = null;
    }
  }

  die(fell) {
    super.die(fell);
    this.game.hud.hideBoss();
    this.game.shake(1);
  }

  animate(dt) {
    const P = this.parts;
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 2.5);
    this.walk += dt * 6 * speedN;
    const s = Math.sin(this.walk) * 0.5 * speedN;
    P.legs[0].rotation.x = s;
    P.legs[1].rotation.x = -s;
    let armX = -0.4, armY = 0, lean = 0.1;
    const side = this.attack === 'combo' ? (this.comboIndex % 2 ? -1 : 1) : 1;
    if (this.state === 'windup') {
      const k = Math.min(1, this.stateTime / this.windupTime);
      if (this.attack === 'slam') { armX = -3.0 * k; lean = -0.3 * k; }
      else if (this.attack === 'sweep') { armX = -1.4; armY = -1.6 * k; lean = -0.1; }
      else { armX = -2.4; armY = -0.8 * side; lean = -0.15; }
    } else if (this.state === 'strike' || this.state === 'recover') {
      if (this.attack === 'slam') { armX = -1.2; lean = 0.45; }
      else if (this.attack === 'sweep') { armX = -1.4; armY = 1.6; lean = 0.1; }
      else { armX = -0.9; armY = 0.8 * side; lean = 0.3; }
    } else if (this.state === 'stagger' || this.state === 'broken') {
      armX = 0.3; lean = -0.45;
    } else if (this.state === 'block') {
      armX = -1.5; armY = 0.9;
    }
    const arm = P.arms[0];
    const r = this.state === 'strike' ? 30 : 10;
    arm.rotation.x = damp(arm.rotation.x, armX, r, dt);
    arm.rotation.y = damp(arm.rotation.y, armY, r, dt);
    P.arms[1].rotation.x = damp(P.arms[1].rotation.x, -s * 0.4, 10, dt);
    P.root.rotation.x = damp(P.root.rotation.x, lean, 10, dt);
    this.eyeMat.color.setHex(this.state === 'windup' ? 0xffe6b0 : 0xff7a1a);
  }
}

export function pickEnemyType(depth) {
  const table = [
    [Skeleton, 5],
    [Shade, depth >= 1 ? 2 + depth * 0.5 : 0],
    [Acolyte, 1.2 + depth * 0.5],
    [Brute, depth >= 2 ? depth * 0.8 : 0.35],
  ];
  let r = Math.random() * table.reduce((a, [, w]) => a + w, 0);
  for (const [Type, w] of table) {
    r -= w;
    if (r <= 0) return Type;
  }
  return Skeleton;
}

