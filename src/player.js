import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, lerp, rand, easeOut, angleDiff, flicker } from './util.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Our yaw convention: the camera looks along (-sin yaw, 0, -cos yaw). */
export const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.radius = CONFIG.player.radius;
    this.height = CONFIG.player.height;
    this.hitSet = new Set();

    const L = CONFIG.player.lantern;
    this.lantern = new THREE.PointLight(L.color, L.intensity, L.distance, L.decay);
    this.lantern.castShadow = true;
    this.lantern.shadow.mapSize.set(512, 512);
    this.lantern.shadow.bias = -0.003;
    this.lantern.shadow.camera.near = 0.15;
    this.lantern.shadow.camera.far = 30;
    this.lantern.position.set(-0.42, -0.32, -0.5);
    game.camera.add(this.lantern);

    this.viewmodel = new Viewmodel(game, this);
    this.reset();
  }

  reset() {
    const P = CONFIG.player;
    this.stats = {
      maxHp: P.maxHp,
      maxStamina: P.maxStamina,
      staminaRegen: P.staminaRegen,
      speed: P.speed,
      damage: P.attack.damage,
      attackSpeed: 1,
      reach: 1,
      lifesteal: 0,
      lightRadius: 1,
      parryWindow: P.guard.parryWindow,
      blockReduction: P.guard.blockReduction,
      blockStaminaMult: P.guard.blockStaminaMult,
      riposteMult: P.riposteMult,
      parryDamage: 0,
    };
    this.hp = this.stats.maxHp;
    this.stamina = this.stats.maxStamina;
    this.staminaDelay = 0;
    this.invuln = 0;
    this.itemCounts = new Map();
    this.state = 'idle';
    this.stateTime = 0;
    this.comboSide = -1;
    this.lastGuardPress = -10;
    this.lastParry = -10;
    this.parryEligible = false;
    this.grounded = true;
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.bobPhase = 0;
    this.stepDist = 0;
    this.sprinting = false;
    this.deathK = 0;
  }

  get alive() { return this.state !== 'dead'; }
  get forward() { return _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  get eyePosition() { return new THREE.Vector3(this.pos.x, this.pos.y + CONFIG.player.eyeHeight, this.pos.z); }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  spendStamina(cost) {
    if (this.stamina <= 0) {
      this.game.hud.flashStamina();
      this.game.audio.play('empty');
      return false;
    }
    this.stamina = Math.max(0, this.stamina - cost);
    this.staminaDelay = CONFIG.player.staminaDelay;
    return true;
  }

  // ---- Guard / parry -------------------------------------------------------

  enterGuard() {
    const now = this.game.time;
    // Mashing the guard button forfeits the parry window — unless you're mid-deflection chain.
    this.parryEligible = now - this.lastGuardPress > CONFIG.player.guard.spamLockout || now - this.lastParry < 0.7;
    this.lastGuardPress = now;
    this.game.input.consume('guard');
    this.setState('guard');
  }

  inParryWindow() {
    return this.state === 'guard' && this.parryEligible && this.stateTime <= this.stats.parryWindow;
  }

  facing(pos, maxAngle = 1.3) {
    const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
    return Math.abs(angleDiff(this.yaw, yawOf(dx, dz))) < maxAngle;
  }

  /**
   * Resolve an incoming blow. Returns 'miss' | 'parried' | 'blocked' | 'guardbreak' | 'hit'.
   * `perilous` attacks ignore guard entirely — you must step out of the way.
   */
  receiveAttack(attacker, { damage, perilous = false, from }) {
    if (!this.alive || this.invuln > 0 || this.game.transition) return 'miss';
    const src = from || attacker.pos;
    if (!perilous && this.state === 'guard' && this.facing(src)) {
      if (this.inParryWindow()) {
        this.lastParry = this.game.time;
        this.parryEligible = true;
        this.stateTime = 0;
        this.stamina = Math.min(this.stats.maxStamina, this.stamina + 6);
        this.viewmodel.kick(1);
        return 'parried';
      }
      this.stamina -= damage * this.stats.blockStaminaMult;
      this.staminaDelay = CONFIG.player.staminaDelay;
      this.pushFrom(src, 3);
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.hp -= damage * 0.5;
        this.setState('guardbreak');
        this.viewmodel.kick(0.6);
        if (this.hp <= 0) this.die();
        return 'guardbreak';
      }
      this.hp -= damage * (1 - this.stats.blockReduction);
      this.viewmodel.kick(0.4);
      if (this.hp <= 0) this.die();
      return 'blocked';
    }
    this.hp -= damage;
    this.invuln = CONFIG.player.hurtIframes;
    this.pushFrom(src, 6);
    if (this.hp <= 0) this.die();
    else this.setState('hurt');
    return 'hit';
  }

  pushFrom(src, strength) {
    const dx = this.pos.x - src.x, dz = this.pos.z - src.z;
    const d = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / d) * strength, 0, (dz / d) * strength);
  }

  die() {
    this.hp = 0;
    this.setState('dead');
    this.game.onPlayerDeath();
  }

  // ---- Attack --------------------------------------------------------------

  attackTimings() {
    const A = CONFIG.player.attack;
    const s = this.stats.attackSpeed;
    return { windup: A.windup / s, active: A.active / s, recovery: A.recovery / s };
  }

  tryAttack() {
    if (!this.spendStamina(CONFIG.player.attack.cost)) return false;
    this.comboSide *= -1;
    this.hitSet.clear();
    this.slashed = false;
    this.setState('attack');
    return true;
  }

  updateAttack() {
    const { windup, active, recovery } = this.attackTimings();
    const t = this.stateTime;
    const input = this.game.input;
    if (t < windup) return;
    if (t < windup + active) {
      if (!this.slashed) {
        this.slashed = true;
        this.game.audio.play('swing');
        this.viewmodel.slash(this.comboSide, active);
        this.knock.addScaledVector(this.forward, 2.5);
      }
      this.checkHits();
      return;
    }
    if (t < windup + active + recovery) {
      const rk = (t - windup - active) / recovery;
      if (rk > 0.3 && input.rmb && input.peek('guard')) return this.enterGuard();
      if (rk > 0.5 && input.consume('attack')) this.tryAttack();
      return;
    }
    if (input.rmb) this.enterGuard();
    else this.setState('idle');
  }

  checkHits() {
    const A = CONFIG.player.attack;
    const reach = A.reach * this.stats.reach;
    for (const e of this.game.room.enemies) {
      if (!e.active || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dy = e.pos.y - this.pos.y;
      if (Math.abs(dy) > 2.2) continue;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > reach) continue;
      if (d > e.radius + 0.5 && Math.abs(angleDiff(this.yaw, yawOf(dx, dz))) > A.arc / 2) continue;
      this.hitSet.add(e);
      const dir = new THREE.Vector3(dx / (d || 1), 0, dz / (d || 1));
      const result = e.receiveHit(this.stats.damage * rand(0.9, 1.1), dir, this);
      this.game.onEnemyHit(e, result, dir);
      if (result === 'blocked') {
        this.stamina = Math.max(0, this.stamina - 8);
        this.setState('recoil');
        this.viewmodel.kick(0.8);
        return;
      }
    }
  }

  // ---- Frame ---------------------------------------------------------------

  update(dt) {
    const P = CONFIG.player;
    const S = this.stats;
    const input = this.game.input;
    const world = this.game.room.world;

    const [lx, ly] = input.takeLook();
    if (this.alive) {
      this.yaw -= lx * P.mouseSensitivity;
      this.pitch = clamp(this.pitch - ly * P.mouseSensitivity, -1.45, 1.45);
      this.viewmodel.addSway(lx, ly);
    }

    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);

    switch (this.state) {
      case 'idle':
        if (input.consume('attack')) this.tryAttack();
        else if (input.rmb) this.enterGuard();
        break;
      case 'guard':
        if (!input.rmb) this.setState('idle');
        else if (input.consume('attack')) this.tryAttack();
        break;
      case 'attack':
        this.updateAttack();
        break;
      case 'recoil':
        if (this.stateTime > 0.4) this.setState('idle');
        break;
      case 'guardbreak':
        if (this.stateTime > P.guard.guardBreakStun) this.setState('idle');
        break;
      case 'hurt':
        if (this.stateTime > 0.12 && input.rmb) this.enterGuard();
        else if (this.stateTime > 0.28) this.setState('idle');
        break;
    }

    // Movement.
    const [strafe, fwdAxis] = this.alive ? input.moveAxes() : [0, 0];
    const moving = strafe !== 0 || fwdAxis !== 0;
    const mult = { idle: 1, guard: 0.5, attack: 0.3, recoil: 0.3, guardbreak: 0.15, hurt: 0.4, dead: 0 }[this.state];
    this.sprinting = this.state === 'idle' && fwdAxis > 0 && input.down('ShiftLeft', 'ShiftRight') && this.stamina > 0 && this.grounded;
    let speed = (this.sprinting ? P.sprintSpeed : S.speed) * mult;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - P.sprintCost * dt);
      this.staminaDelay = 0.3;
    } else if (this.state !== 'attack' && this.staminaDelay <= 0 && this.alive) {
      this.stamina = Math.min(S.maxStamina, this.stamina + S.staminaRegen * (this.state === 'guard' ? 0.45 : 1) * dt);
    }

    const f = this.forward;
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wx = (f.x * fwdAxis + _right.x * strafe) * speed;
    const wz = (f.z * fwdAxis + _right.z * strafe) * speed;
    const accel = this.grounded ? 14 : 2.5;
    this.vel.x = damp(this.vel.x, wx, accel, dt);
    this.vel.z = damp(this.vel.z, wz, accel, dt);
    this.knock.multiplyScalar(Math.exp(-9 * dt));

    if (this.grounded && input.consume('jump') && (this.state === 'idle' || this.state === 'guard') && this.spendStamina(P.jumpCost)) {
      this.vel.y = P.jumpVelocity;
      this.grounded = false;
    }

    const dx = (this.vel.x + this.knock.x) * dt, dz = (this.vel.z + this.knock.z) * dt;
    world.move(this.pos, this.pos.y, dx, dz, this.radius, this.height, { allowFall: true });

    this.vel.y -= P.gravity * dt;
    const newY = this.pos.y + this.vel.y * dt;
    const ground = world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const wasGrounded = this.grounded;
    if (ground !== null && this.vel.y <= 0 && newY <= ground) {
      if (!wasGrounded && this.vel.y < -7) {
        this.game.audio.play('land');
        this.game.shake(Math.min(0.5, -this.vel.y * 0.03));
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (wasGrounded && ground !== null && this.vel.y <= 0 && this.pos.y - ground < 0.6) {
      this.pos.y = ground;  // stick to stairs going down
      this.vel.y = 0;
    } else {
      this.pos.y = newY;
      this.grounded = false;
    }
    if (this.pos.y < -16 && this.alive) this.game.onPlayerFell();

    // Footsteps.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && moving && hs > 0.5) {
      this.stepDist += hs * dt;
      this.bobPhase += hs * dt * 1.9;
      if (this.stepDist > (this.sprinting ? 2.4 : 1.9)) {
        this.stepDist = 0;
        this.game.audio.play('step');
      }
    }

    this.updateCamera(dt, strafe);
  }

  updateCamera(dt, strafe) {
    const P = CONFIG.player;
    const cam = this.game.camera;
    const hs = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / this.stats.speed);
    const bob = this.grounded ? Math.sin(this.bobPhase * 2) * 0.045 * hs : 0;
    const sh = this.game.shakeOffset;
    if (this.state === 'dead') this.deathK = Math.min(1, this.deathK + dt * 1.2);
    const k = easeOut(this.deathK);
    cam.position.set(this.pos.x, this.pos.y + lerp(P.eyeHeight, 0.35, k) + bob + sh.y * 0.1, this.pos.z);
    this.roll = damp(this.roll || 0, -strafe * 0.025, 6, dt);
    cam.rotation.set(this.pitch + sh.x * 0.04 + k * 0.4, this.yaw + sh.y * 0.04, this.roll + sh.z * 0.03 + k * 1.1, 'YXZ');

    const L = P.lantern;
    const t = this.game.time;
    const fl = 0.85 + 0.15 * flicker(t, 1.3);
    this.lantern.intensity = L.intensity * fl * (this.alive ? 1 : 0.35);
    this.lantern.distance = L.distance * this.stats.lightRadius;
    this.viewmodel.update(dt, fl);
  }
}

// ============================================================================
// First-person viewmodel — rendered in its own scene over the world.
// ============================================================================

const POSES = {
  idle: { p: [0.4, -0.42, -0.72], r: [-0.4, 0, 0.32] },
  guard: { p: [0.1, -0.26, -0.6], r: [-0.12, 0.2, 1.38] },
  recoil: { p: [0.62, -0.5, -0.55], r: [0.5, 0, -0.9] },
  guardbreak: { p: [0.55, -0.85, -0.5], r: [0.9, 0, -1.1] },
  hurt: { p: [0.5, -0.5, -0.66], r: [-0.1, 0, 0.6] },
  dead: { p: [0.4, -1.4, -0.6], r: [1.2, 0, 0.5] },
};

class Viewmodel {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0x4a6ab0, 0x0a0a10, 1.3);
    this.scene.add(this.hemi);
    this.light = new THREE.PointLight(0xffa24a, 3.2, 3, 2);
    this.light.position.set(-0.4, -0.3, -0.55);
    this.scene.add(this.light);

    const steel = new THREE.MeshStandardMaterial({ color: 0xc4c8d2, roughness: 0.3, metalness: 0.25, flatShading: true });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x4a4d58, roughness: 0.55, metalness: 0.2, flatShading: true });
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.9, flatShading: true });
    this.bladeMat = steel;

    // Sword: grip at the origin, blade along +Y.
    this.sword = new THREE.Group();
    const add = (g, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    add(this.sword, new THREE.BoxGeometry(0.13, 0.16, 0.15), darkSteel, 0, -0.02, 0.02);
    add(this.sword, new THREE.BoxGeometry(0.05, 0.22, 0.05), leather, 0, 0.1, 0);
    add(this.sword, new THREE.BoxGeometry(0.07, 0.07, 0.07), darkSteel, 0, -0.03, 0);
    add(this.sword, new THREE.BoxGeometry(0.34, 0.045, 0.06), darkSteel, 0, 0.23, 0);
    add(this.sword, new THREE.BoxGeometry(0.065, 1.05, 0.016), steel, 0, 0.78, 0);
    add(this.sword, new THREE.BoxGeometry(0.018, 0.9, 0.02), darkSteel, 0, 0.72, 0);
    add(this.sword, new THREE.ConeGeometry(0.033, 0.12, 4), steel, 0, 1.36, 0).rotation.y = Math.PI / 4;
    // Gauntleted forearm trailing back towards the camera.
    add(this.sword, new THREE.BoxGeometry(0.15, 0.14, 0.42), darkSteel, 0.02, -0.04, 0.26);
    this.sword.scale.setScalar(0.6);
    this.swordRoot = new THREE.Group();
    this.swordRoot.rotation.order = 'YXZ';
    this.swordRoot.add(this.sword);
    this.scene.add(this.swordRoot);

    // Lantern in the left hand.
    this.lanternRoot = new THREE.Group();
    const frame = darkSteel;
    add(this.lanternRoot, new THREE.BoxGeometry(0.2, 0.03, 0.2), frame, 0, 0.14, 0);
    add(this.lanternRoot, new THREE.BoxGeometry(0.2, 0.03, 0.2), frame, 0, -0.14, 0);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(this.lanternRoot, new THREE.BoxGeometry(0.025, 0.28, 0.025), frame, x * 0.09, 0, z * 0.09);
    this.flame = add(this.lanternRoot, new THREE.BoxGeometry(0.1, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0xffb060 }), 0, 0, 0);
    this.glass = add(this.lanternRoot, new THREE.BoxGeometry(0.16, 0.24, 0.16),
      new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, 0);
    add(this.lanternRoot, new THREE.ConeGeometry(0.13, 0.1, 4), frame, 0, 0.2, 0).rotation.y = Math.PI / 4;
    add(this.lanternRoot, new THREE.BoxGeometry(0.02, 0.16, 0.02), frame, 0, 0.3, 0);
    add(this.lanternRoot, new THREE.BoxGeometry(0.08, 0.08, 0.26), darkSteel, 0, 0.38, 0.16);
    this.lanternRoot.scale.setScalar(0.75);
    this.scene.add(this.lanternRoot);

    this.buildTrail();

    this.pos = new THREE.Vector3(...POSES.idle.p);
    this.rot = new THREE.Vector3(...POSES.idle.r);
    this.sway = new THREE.Vector2();
    this.kickAmount = 0;
    this.lanternSwing = 0;
  }

  buildTrail() {
    this.trailUniforms = { head: { value: 0 }, side: { value: 1 }, opacity: { value: 0 }, color: { value: new THREE.Color(0xffe0b0) } };
    const geo = new THREE.RingGeometry(0.62, 1.25, 32, 1, -0.3, Math.PI + 0.6);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.trailUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float head, side, opacity;
        uniform vec3 color;
        varying vec2 vPos;
        void main() {
          float u = atan(vPos.y, vPos.x);
          if (u < -1.6) u += 6.2831853;
          float a = (u + 0.3) / (3.14159265 + 0.6);
          if (side < 0.0) a = 1.0 - a;
          float behind = head - a;
          if (behind < 0.0) discard;
          float r = clamp((length(vPos) - 0.62) / 0.63, 0.0, 1.0);
          float alpha = exp(-behind * 3.0) * smoothstep(0.1, 0.9, r) * (1.0 - smoothstep(0.92, 1.0, r)) * opacity;
          gl_FragColor = vec4(color * alpha * 1.8, alpha);
        }
      `,
    });
    this.trail = new THREE.Mesh(geo, mat);
    this.trail.position.set(0.05, -0.15, -1.25);
    this.trail.scale.set(1.1, 0.42, 1);
    this.trail.renderOrder = 10;
    this.scene.add(this.trail);
    this.trailT = 10;
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  addSway(dx, dy) {
    this.sway.x = clamp(this.sway.x - dx * 0.0005, -0.08, 0.08);
    this.sway.y = clamp(this.sway.y + dy * 0.0005, -0.08, 0.08);
  }

  kick(amount) { this.kickAmount = Math.max(this.kickAmount, amount); }

  slash(side, duration) {
    this.trailT = 0;
    this.trailDur = duration;
    this.trailUniforms.side.value = side;
    this.trail.rotation.z = side * 0.28;
  }

  update(dt, flameFlicker) {
    const pl = this.player;
    const state = pl.state;
    let target = POSES[state] || POSES.idle;
    let snap = false;

    if (state === 'attack') {
      const { windup, active } = pl.attackTimings();
      const s = pl.comboSide;
      const t = pl.stateTime;
      const wind = { p: [s > 0 ? 0.68 : -0.35, -0.12, -0.6], r: [-0.25, 0, s > 0 ? -1.3 : 1.35] };
      const end = { p: [s > 0 ? -0.55 : 0.62, -0.38, -0.7], r: [-0.95, 0, s > 0 ? 1.7 : -1.6] };
      if (t < windup) {
        target = wind;
      } else if (t < windup + active) {
        const k = easeOut((t - windup) / active);
        target = {
          p: wind.p.map((v, i) => lerp(v, end.p[i], k)),
          r: wind.r.map((v, i) => lerp(v, end.r[i], k)),
        };
        snap = true;
      } else {
        target = end;
      }
    }

    const rate = snap ? 60 : state === 'attack' ? 30 : state === 'guard' ? 26 : 14;
    this.pos.x = damp(this.pos.x, target.p[0], rate, dt);
    this.pos.y = damp(this.pos.y, target.p[1], rate, dt);
    this.pos.z = damp(this.pos.z, target.p[2], rate, dt);
    this.rot.x = damp(this.rot.x, target.r[0], rate, dt);
    this.rot.y = damp(this.rot.y, target.r[1], rate, dt);
    this.rot.z = damp(this.rot.z, target.r[2], rate, dt);

    this.sway.multiplyScalar(Math.exp(-8 * dt));
    this.kickAmount = Math.max(0, this.kickAmount - dt * 5);
    const hs = Math.min(1, Math.hypot(pl.vel.x, pl.vel.z) / pl.stats.speed);
    const bobX = Math.sin(pl.bobPhase) * 0.02 * hs;
    const bobY = -Math.abs(Math.cos(pl.bobPhase)) * 0.025 * hs;
    const breathe = Math.sin(this.game.time * 1.6) * 0.006;
    const kick = this.kickAmount * this.kickAmount;

    this.swordRoot.position.set(this.pos.x + this.sway.x + bobX + kick * 0.05, this.pos.y + this.sway.y + bobY + breathe + kick * 0.09, this.pos.z + kick * 0.06);
    this.swordRoot.rotation.set(this.rot.x - kick * 0.25, this.rot.y, this.rot.z + kick * 0.35);

    const lg = state === 'guard' ? 1 : 0;
    this.lanternSwing = damp(this.lanternSwing, this.sway.x * 6 + bobX * 8, 4, dt);
    this.lanternRoot.position.set(
      -0.4 + this.sway.x * 0.8 - bobX * 0.6,
      -0.38 - lg * 0.12 + this.sway.y * 0.8 + bobY * 0.8 - (state === 'dead' ? 1 : 0),
      -0.72 + lg * 0.05);
    this.lanternRoot.rotation.set(0, 0.3, this.lanternSwing * 0.8);
    this.flame.scale.setScalar(0.8 + 0.25 * flameFlicker);
    this.light.intensity = 3.2 * flameFlicker;
    this.light.position.copy(this.lanternRoot.position);

    this.trailT += dt;
    if (this.trailDur) {
      const k = this.trailT / this.trailDur;
      this.trailUniforms.head.value = Math.min(1.25, k * 1.25);
      this.trailUniforms.opacity.value = k < 1 ? 1 : Math.max(0, 1 - (this.trailT - this.trailDur) / 0.12);
    }
  }
}
