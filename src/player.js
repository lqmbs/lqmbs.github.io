import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, lerp, rand, easeOut, angleDiff, flicker } from './util.js';
import { CLASSES, hasAffinity } from './classes.js';
import { makeWeapon, buildWeaponModel, buildShieldModel, weaponMaterials } from './weapons.js';
import { BuildFX, Shockwave } from './builds.js';
import { GroundTelegraph } from './enemies.js';
import { StaffArts, Restage, Summoner } from './abilities.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Our yaw convention: the camera looks along (-sin yaw, 0, -cos yaw). */
export const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

export const WEAPON_SLOTS = 3;
const FLASK_HEAL = 0.4;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.skillDir = new THREE.Vector3();
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
    this.fx = new BuildFX(game, this);
    this.arts = new StaffArts(game, this);
    this.restage = new Restage(game, this);
    this.summoner = new Summoner(game, this);
    this.prevLook = [0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.setClass('knight');
  }

  // ---- Loadout ---------------------------------------------------------------

  setClass(id) {
    this.classDef = CLASSES[id];
    this.resetLoadout();
  }

  /** Fresh start for the current class: base stats, starting weapon, no relics. */
  resetLoadout() {
    const P = CONFIG.player;
    const C = this.classDef.stats;
    this.stats = {
      maxHp: C.maxHp,
      maxStamina: C.maxStamina,
      staminaRegen: C.staminaRegen,
      speed: C.speed,
      maxMana: C.maxMana,
      manaRegen: C.manaRegen,
      parryWindow: C.parryWindow,
      blockReduction: C.blockReduction,
      blockStaminaMult: C.blockStaminaMult,
      riposteMult: P.riposteMult * (1 + (C.riposteBonus || 0)),
      damageMult: 1,
      attackSpeed: 1,
      reach: 1,
      lifesteal: 0,
      lightRadius: C.lightRadius,
      parryDamage: 0,
      // Build-changing relics (see BuildFX).
      chainChance: 0, parryShock: 0, igniteOnHit: 0, extraJumps: 0, orbitBlades: 0, corpseBurst: 0,
      killHeal: 0, killMana: 0, bladeWave: 0, parryHaste: 0, coinMult: 1, ultRate: 1, skillCdMult: 1,
      parryHeal: 0, frenzy: 0, brimstone: 0, halo: 0, deathWard: 0, damageTaken: 1, fallImmune: false,
    };
    this.hp = this.stats.maxHp;
    this.stamina = this.stats.maxStamina;
    this.mana = this.stats.maxMana;
    this.maxFlasks = 3;
    this.flasks = this.maxFlasks;
    this.weapons = [makeWeapon(this.classDef.weapon), null, null];
    this.activeSlot = 0;
    this.itemCounts = new Map();
    this.coins = 0;
    this.keys = 0;
    this.devilDeals = 0;
    this.ultCharge = 0;
    this.jumpsUsed = 0;
    this.skillCd = 0;
    this.staminaDelay = 0;
    this.manaDelay = 0;
    this.invuln = 0;
    this.state = 'idle';
    this.stateTime = 0;
    this.comboSide = -1;
    this.lastGuardPress = -10;
    this.lastParry = -10;
    this.parryEligible = false;
    this.grounded = true;
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.bobPhase = 0;
    this.stepDist = 0;
    this.sprinting = false;
    this.deathK = 0;
    this.streak = 0;
    this.streakTimer = 0;
    this.hidden = false;
    this.hideTimer = 0;
    this.arts.cd = [0, 0];
    this.restage.log.length = 0;
    this.restage.queue.length = 0;
    this.summoner.clear();
    this.viewmodel.equip();
    this.fx.reset();
  }

  /** Is the class-weapon bond active for the weapon in hand? */
  get bonded() { return hasAffinity(this); }

  /** Duelist's Bloodrush: kills in quick succession with twin daggers stack speed. */
  onKill(e) {
    if (this.classDef.id === 'duelist' && this.bonded) {
      this.streak = Math.min(5, (this.streakTimer > 0 ? this.streak : 0) + 1);
      this.streakTimer = 4;
      this.game.hud.streak(this.streak);
      this.game.audio.play('streak');
    }
    this.summoner.onKill(e);
  }

  get streakMult() { return this.streakTimer > 0 ? 1 + this.streak * 0.08 : 1; }

  reset() { this.resetLoadout(); }

  get weapon() { return this.weapons[this.activeSlot]; }
  get offhand() {
    if (this.weapon.dual) return 'dagger';
    if (this.classDef.offhand === 'parrydagger') return 'dagger';
    return this.classDef.offhand === 'dagger' ? 'lantern' : this.classDef.offhand;
  }

  /** Put a weapon in a free slot, or swap it with the one in hand. Returns the displaced weapon. */
  takeWeapon(w) {
    const free = this.weapons.indexOf(null);
    let displaced = null;
    if (free >= 0) {
      this.weapons[free] = w;
      this.activeSlot = free;
    } else {
      displaced = this.weapons[this.activeSlot];
      this.weapons[this.activeSlot] = w;
    }
    this.setState('swap');
    this.viewmodel.equip();
    return displaced;
  }

  /** Remove the weapon in hand (never the last one). */
  dropWeapon() {
    if (this.weapons.filter(Boolean).length <= 1) return null;
    const w = this.weapons[this.activeSlot];
    this.weapons[this.activeSlot] = null;
    this.activeSlot = this.weapons.findIndex(Boolean);
    this.setState('swap');
    this.viewmodel.equip();
    return w;
  }

  switchTo(slot) {
    if (slot === this.activeSlot || !this.weapons[slot]) return;
    this.activeSlot = slot;
    this.setState('swap');
    this.viewmodel.equip();
    this.game.audio.play('swap');
  }

  cycleWeapon(dir) {
    for (let i = 1; i < WEAPON_SLOTS; i++) {
      const s = (this.activeSlot + dir * i + WEAPON_SLOTS) % WEAPON_SLOTS;
      if (this.weapons[s]) return this.switchTo(s);
    }
  }

  get alive() { return this.state !== 'dead'; }
  get forward() { return _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  get eyePosition() { return new THREE.Vector3(this.pos.x, this.pos.y + CONFIG.player.eyeHeight, this.pos.z); }

  /** Exact look direction including pitch. */
  get aim() {
    return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

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
    this.parryEligible = now - this.lastGuardPress > CONFIG.player.guard.spamLockout || now - this.lastParry < 0.7;
    this.lastGuardPress = now;
    this.game.input.consume('guard');
    this.setState('guard');
  }

  get parryWindow() { return this.stats.parryWindow + (this.weapon.parryBonus || 0); }

  inParryWindow() {
    return this.state === 'guard' && this.parryEligible && this.stateTime <= this.parryWindow;
  }

  dodging() { return this.state === 'skill' && this.skillId === 'sidestep' && this.stateTime < 0.24; }

  facing(pos, maxAngle = 1.3) {
    const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
    return Math.abs(angleDiff(this.yaw, yawOf(dx, dz))) < maxAngle;
  }

  /**
   * Resolve an incoming blow. Returns 'miss' | 'parried' | 'blocked' | 'guardbreak' | 'hit'.
   * `perilous` attacks ignore guard entirely — you must step out of the way.
   */
  receiveAttack(attacker, { damage, perilous = false, from }) {
    if (!this.alive || this.invuln > 0 || this.game.transition || this.dodging() || this.game.state === 'shop') return 'miss';
    const src = from || attacker.pos;
    if (!perilous && this.state === 'guard' && this.facing(src)) {
      if (this.inParryWindow()) {
        this.lastParry = this.game.time;
        this.parryEligible = true;
        this.stateTime = 0;
        this.stamina = Math.min(this.stats.maxStamina, this.stamina + 6);
        this.viewmodel.kick(1);
        this.fx.onParry(attacker);
        return 'parried';
      }
      this.stamina -= damage * this.stats.blockStaminaMult;
      this.staminaDelay = CONFIG.player.staminaDelay;
      this.pushFrom(src, 3);
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.hurt(damage * 0.5);
        if (!this.alive) return 'guardbreak';
        this.setState('guardbreak');
        this.viewmodel.kick(0.6);
        return 'guardbreak';
      }
      this.hurt(damage * (1 - this.stats.blockReduction));
      this.viewmodel.kick(0.4);
      return 'blocked';
    }
    if (this.hyperarmor()) {
      // Vigil Knight with a longsword: the blow lands, but the cut goes on.
      this.hurt(damage * 0.7);
      this.invuln = 0.25;
      this.game.sparks(this.eyePosition.addScaledVector(this.forward, 0.5), 14, 0xffe0a0, 3);
      this.game.audio.play('shield-block');
      this.viewmodel.kick(0.2);
      return 'hit';
    }
    this.hurt(damage);
    this.invuln = CONFIG.player.hurtIframes;
    this.pushFrom(src, 6);
    if (this.alive) this.setState('hurt');
    return 'hit';
  }

  /** Unbroken Stance: longsword swings (windup and cut) can't be interrupted. */
  hyperarmor() {
    if (this.classDef.id !== 'knight' || !this.bonded || this.state !== 'attack') return false;
    const { windup, active } = this.attackTimings();
    return this.stateTime < windup + active + 0.05;
  }

  /** Lose health (after relic multipliers); an Aegis of Mercy may refuse a killing blow. */
  hurt(amount) {
    this.hp -= amount * this.fx.damageTakenMult();
    this.game.tookDamage = true;
    if (this.hp <= 0 && !this.fx.tryWard()) this.die();
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

  revive() {
    this.hp = this.stats.maxHp;
    this.stamina = this.stats.maxStamina;
    this.mana = this.stats.maxMana;
    this.flasks = this.maxFlasks;
    this.deathK = 0;
    this.setState('idle');
  }

  // ---- Attack --------------------------------------------------------------

  attackTimings() {
    const w = this.weapon;
    const s = w.speed * this.stats.attackSpeed * this.fx.attackSpeedBonus() * (1 + (this.streakMult - 1) * 0.75);
    return { windup: w.windup / s, active: w.active / s, recovery: w.recovery / s };
  }

  tryAttack() {
    if (!this.spendStamina(this.weapon.cost)) return false;
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
    const w = this.weapon;
    if (t < windup) return;
    if (t < windup + active) {
      if (!this.slashed) {
        this.slashed = true;
        if (w.kind === 'cast') {
          if (this.mana >= w.manaCost) {
            this.mana -= w.manaCost;
            this.manaDelay = 0.8;
            this.game.castBolt(this, w);
            this.fizzle = false;
          } else {
            this.fizzle = true;
            this.game.audio.play('empty');
            this.game.hud.flashMana();
          }
        } else {
          this.game.audio.play(w.kind === 'heavy' ? 'swing-heavy' : 'swing');
          this.viewmodel.slash(this.comboSide, active);
          this.fx.onSwing();
          this.knock.addScaledVector(this.forward, w.kind === 'thrust' ? 4 : w.kind === 'heavy' ? 3 : 2.5);
        }
      }
      if (w.kind !== 'cast') this.checkHits();
      else if (this.fizzle) this.checkHits({ damage: 5, reach: 1.8, arc: 1.4, posture: 2 });
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

  checkHits(override = null) {
    const w = override || this.weapon;
    const reach = w.reach * this.stats.reach;
    for (const e of this.game.nearbyEnemies()) {
      if (!e.active || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dy = e.pos.y - this.pos.y;
      if (Math.abs(dy) > 2.2) continue;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > reach) continue;
      if (d > e.radius + 0.5 && Math.abs(angleDiff(this.yaw, yawOf(dx, dz))) > w.arc / 2) continue;
      this.hitSet.add(e);
      const dir = new THREE.Vector3(dx / (d || 1), 0, dz / (d || 1));
      let dmg = w.damage * this.stats.damageMult * this.fx.damageBonus() * rand(0.9, 1.1);
      // Veiled Grace: the Duchess strikes harder from the shadows or at the unaware.
      if (this.classDef.id === 'duchess' && (this.hidden || e.asleep)) dmg *= 1.4;
      const result = e.receiveHit(dmg, dir, this, { posture: w.posture, burn: w.burn || 0, veiled: this.hidden });
      this.game.onEnemyHit(e, result, dir, dmg);
      if (result === 'blocked') {
        this.stamina = Math.max(0, this.stamina - 8);
        this.setState('recoil');
        this.viewmodel.kick(0.8);
        return;
      }
    }
  }

  // ---- Skills & consumables -------------------------------------------------

  trySkill() {
    const sk = this.classDef.skill;
    if (this.skillCd > 0 || !['idle', 'guard', 'hurt', 'recoil'].includes(this.state)) {
      if (this.skillCd > 0) this.game.hud.flashSkill();
      return;
    }
    if (sk.stamina && !this.spendStamina(sk.stamina)) return;
    this.skillId = sk.id;
    this.skillCd = sk.cooldown * this.stats.skillCdMult;
    this.skillFired = false;
    this.hitSet.clear();
    if (sk.id === 'sidestep') {
      const [sx, f] = this.game.input.moveAxes();
      const fw = this.forward;
      _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.skillDir.set(fw.x * f + _right.x * sx, 0, fw.z * f + _right.z * sx);
      if (this.skillDir.lengthSq() < 0.01) this.skillDir.copy(fw).negate();
      this.skillDir.normalize();
      this.game.audio.play('dodge');
    }
    this.setState('skill');
  }

  updateSkill() {
    const t = this.stateTime;
    switch (this.skillId) {
      case 'bash': {
        if (t > 0.1 && t < 0.3) {
          this.knock.copy(this.forward).multiplyScalar(9);
          if (!this.skillFired) {
            this.skillFired = true;
            this.game.audio.play('bash');
          }
          for (const e of this.game.nearbyEnemies()) {
            if (!e.active || this.hitSet.has(e)) continue;
            const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
            const d = Math.hypot(dx, dz);
            if (d - e.radius > 1.6 || Math.abs(angleDiff(this.yaw, yawOf(dx, dz))) > 0.9 || Math.abs(e.pos.y - this.pos.y) > 2) continue;
            this.hitSet.add(e);
            const dir = new THREE.Vector3(dx / (d || 1), 0, dz / (d || 1));
            e.receiveBash(dir);
            this.game.onEnemyHit(e, e.alive ? 'bash' : 'kill', dir, 8);
          }
        }
        if (t > 0.55) this.setState('idle');
        break;
      }
      case 'sidestep':
        if (t < 0.22) this.knock.copy(this.skillDir).multiplyScalar(13 * (1 - t / 0.3));
        if (t > 0.34) this.setState('idle');
        break;
      case 'flare':
        if (t > 0.15 && !this.skillFired) {
          this.skillFired = true;
          this.game.flare(this);
        }
        if (t > 0.5) this.setState('idle');
        break;
      case 'restage':
        if (t > 0.12 && !this.skillFired) {
          this.skillFired = true;
          const n = this.restage.trigger();
          if (!n) {
            // Nothing to replay: the curtain rises on an empty stage. Refund most of the wait.
            this.skillCd *= 0.25;
            this.game.hud.toast('Restage', 'No wounds to replay', 0xc89ae0);
          }
        }
        if (t > 0.4) this.setState('idle');
        break;
      case 'summon':
        if (t > 0.2 && !this.skillFired) {
          this.skillFired = true;
          this.summoner.callNext();
        }
        if (t > 0.5) this.setState('idle');
        break;
    }
  }

  tryFlask() {
    if (this.flasks <= 0 || !['idle', 'guard'].includes(this.state)) {
      if (this.flasks <= 0) this.game.audio.play('empty');
      return;
    }
    this.flasks--;
    this.healed = false;
    this.setState('drink');
    this.game.audio.play('drink');
  }

  // ---- Ladders ---------------------------------------------------------------

  climb(ladder) {
    if (!this.alive || this.state === 'climb') return;
    this.ladder = ladder;
    this.climbFrom = this.pos.clone();
    this.climbDur = (ladder.top.y - ladder.base.y) / 3 + 0.2;
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.setState('climb');
    this.game.hud.setPrompt(null);
  }

  /** Step to the foot, climb hand over hand, then step off onto the ledge. */
  updateClimb(dt) {
    const L = this.ladder, t = this.stateTime;
    const foot = L.base.clone().addScaledVector(L.dir, 0.05);
    const yaw = Math.atan2(-L.dir.x, -L.dir.z);
    this.yaw += angleDiff(this.yaw, yaw) * Math.min(1, dt * 8);
    if (t < 0.2) {
      this.pos.lerpVectors(this.climbFrom, foot, t / 0.2);
    } else if (t < 0.2 + this.climbDur) {
      const k = (t - 0.2) / this.climbDur;
      this.pos.set(foot.x, L.base.y + (L.top.y - L.base.y) * k, foot.z);
      this.bobPhase += dt * 9;
      this.stepDist += dt * 3;
      if (this.stepDist > 0.9) { this.stepDist = 0; this.game.audio.play('step'); }
    } else if (t < 0.5 + this.climbDur) {
      const k = (t - 0.2 - this.climbDur) / 0.3;
      this.pos.set(foot.x + (L.top.x - foot.x) * k, L.top.y, foot.z + (L.top.z - foot.z) * k);
    } else {
      this.pos.copy(L.top);
      this.lastSafe = { x: L.top.x, y: L.top.y, z: L.top.z };
      this.grounded = true;
      this.vel.set(0, 0, 0);
      this.setState('idle');
    }
  }

  // ---- Ultimate ------------------------------------------------------------

  get ultMax() { return this.classDef.ultimate.charge; }
  get ultReady() { return this.ultCharge >= this.ultMax; }

  addUltCharge(n) {
    if (this.state === 'ult' || !this.alive) return;
    const was = this.ultReady;
    this.ultCharge = Math.min(this.ultMax, this.ultCharge + n * this.stats.ultRate);
    if (!was && this.ultReady) {
      this.game.audio.play('ult-ready');
      this.game.hud.ultReady();
    }
  }

  tryUltimate() {
    if (!this.ultReady || !['idle', 'guard', 'hurt', 'recoil', 'attack'].includes(this.state)) {
      if (!this.ultReady) this.game.hud.flashUlt();
      return;
    }
    const u = this.classDef.ultimate;
    this.ultId = u.id;
    this.ultCharge = 0;
    this.ultFired = false;
    this.ultStep = 0;
    this.hitSet.clear();
    this.setState('ult');
    this.game.hud.banner(u.name.toUpperCase(), 'ult', 1.6);
    this.game.audio.play('ult');
    if (u.id === 'oath') {
      this.invuln = 1;
      this.vel.y = 7.5;
      this.grounded = false;
    } else if (u.id === 'cuts') {
      this.cutTargets = this.game.nearbyEnemies()
        .filter((e) => e.active && e.pos.distanceTo(this.pos) < 16 && Math.abs(e.pos.y - this.pos.y) < 4)
        .sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))
        .slice(0, 7);
      this.game.slowmo = Math.max(this.game.slowmo, 1.2);
      this.invuln = 2;
    } else if (u.id === 'sunfall') {
      this.sunTarget = this.aimGroundPoint(24);
      this.game.addEffect(new GroundTelegraph(this.game, this.sunTarget.x, this.sunTarget.y, this.sunTarget.z, 6.5, 1.05, { color: 0xffb040 }));
    } else if (u.id === 'finale') {
      this.invuln = 0.6;
    }
  }

  /** The Duchess slips behind the veil: unseen, and her strikes land like ripostes. */
  vanish(duration) {
    this.hidden = true;
    this.hideTimer = duration;
    this.game.hud.setVeil(true);
    this.game.audio.play('vanish');
    this.game.glow.burst(this.pos.clone().setY(this.pos.y + 1), 50, () => ({
      vel: new THREE.Vector3(rand(-3, 3), rand(0, 3), rand(-3, 3)), life: rand(0.5, 1.2), size: rand(0.05, 0.1), color: 0xc89ae0, drag: 2,
    }));
  }

  reveal() {
    if (!this.hidden) return;
    this.hidden = false;
    this.hideTimer = 0;
    this.game.hud.setVeil(false);
    this.game.audio.play('reveal');
  }

  /** Where the look ray first meets the ground (or a point ahead at foot level). */
  aimGroundPoint(maxDist) {
    const aim = this.aim;
    const eye = this.eyePosition;
    const world = this.game.room.world;
    const p = new THREE.Vector3();
    for (let d = 1; d <= maxDist; d += 0.35) {
      p.copy(eye).addScaledVector(aim, d);
      const g = world.groundAt(p.x, p.z, p.y + 0.3);
      if (g !== null && p.y <= g + 0.05) return new THREE.Vector3(p.x, g, p.z);
    }
    const f = this.forward;
    const x = this.pos.x + f.x * 9, z = this.pos.z + f.z * 9;
    const g = world.groundAt(x, z, this.pos.y + 1);
    return new THREE.Vector3(x, g ?? this.pos.y, z);
  }

  updateUlt(dt) {
    const t = this.stateTime;
    const game = this.game;
    switch (this.ultId) {
      case 'oath': {
        // Rise, hang, then drive the sword down.
        if (t > 0.28 && !this.ultFired) this.vel.y = Math.min(this.vel.y, -16);
        if (!this.ultFired && t > 0.3 && this.grounded) {
          this.ultFired = true;
          const S = this.stats;
          game.addEffect(new Shockwave(game, this.pos, 9, 0xffe0a0, 0.6));
          game.addEffect(new Shockwave(game, this.pos, 5, 0xffffff, 0.35));
          game.audio.play('boss-slam');
          game.shake(0.9);
          game.flash = 0.9;
          game.hitstop = Math.max(game.hitstop, 0.12);
          game.glow.burst(this.pos.clone().setY(this.pos.y + 0.3), 70, () => ({
            vel: new THREE.Vector3(rand(-10, 10), rand(1, 6), rand(-10, 10)), life: rand(0.4, 0.9), size: rand(0.05, 0.12), color: 0xffe0a0, drag: 3,
          }));
          for (const e of game.nearbyEnemies()) {
            if (!e.active) continue;
            const d = e.pos.distanceTo(this.pos);
            if (d > 9 || Math.abs(e.pos.y - this.pos.y) > 3) continue;
            const dir = e.pos.clone().sub(this.pos).setY(0).normalize();
            const dmg = (60 - d * 3) * S.damageMult;
            e.takeRawDamage(dmg, dir, 10 / Math.max(1, e.mass * 0.6));
            if (e.alive && !e.addPosture(90)) e.stun(1.6);
            game.onEnemyHit(e, e.alive ? 'bash' : 'kill', dir, dmg, { proc: true });
          }
          this.fx.aegisTimer = 8;
        }
        if (this.ultFired && t > 0.3 && this.stateTime > 0.75) this.setState('idle');
        if (t > 2.5) this.setState('idle');
        break;
      }
      case 'finale':
        if (!this.ultFired && t > 0.2) {
          this.ultFired = true;
          this.vanish(7);
        }
        if (t > 0.45) this.setState('idle');
        break;
      case 'march':
        if (!this.ultFired && t > 0.3) {
          this.ultFired = true;
          this.summoner.march();
        }
        if (t > 0.7) this.setState('idle');
        break;
      case 'cuts': {
        const every = 0.13;
        const i = Math.floor(t / every);
        if (i > this.ultStep - 1 && this.ultStep < this.cutTargets.length) {
          const e = this.cutTargets[this.ultStep++];
          if (e.active) this.blinkStrike(e);
        }
        if (this.ultStep >= this.cutTargets.length && t > this.cutTargets.length * every + 0.25) {
          this.invuln = 0.3;
          this.setState('idle');
        }
        break;
      }
      case 'sunfall': {
        if (!this.ultFired && t > 0.2) {
          this.ultFired = true;
          game.sunfall(this, this.sunTarget);
          this.fx.surgeTimer = 6;
        }
        if (t > 0.6) this.setState('idle');
        break;
      }
    }
  }

  /** Thousand Cuts: appear beside a foe and cut it as if it were staggered. */
  blinkStrike(e) {
    const game = this.game;
    const world = game.room.world;
    const from = this.pos.clone();
    const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const off = e.radius + 1.0;
    for (const rot of [0, 0.8, -0.8, 1.6, -1.6, Math.PI]) {
      const a = Math.atan2(dz, dx) + rot;
      const x = e.pos.x + Math.cos(a) * off, z = e.pos.z + Math.sin(a) * off;
      const g = world.groundAt(x, z, e.pos.y + 0.6);
      if (g !== null && Math.abs(g - e.pos.y) < 1.2) {
        this.pos.set(x, g, z);
        break;
      }
    }
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.yaw = yawOf(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
    this.pitch *= 0.5;
    const trail = from.clone().setY(from.y + 1);
    const to = this.pos.clone().setY(this.pos.y + 1);
    for (let k = 0; k <= 10; k++) {
      game.glow.emit({ pos: trail.clone().lerp(to, k / 10), vel: new THREE.Vector3(0, rand(0, 0.5), 0), life: rand(0.2, 0.5), size: 0.06, color: 0xffe0b0 });
    }
    const dir = new THREE.Vector3(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z).normalize();
    const dmg = Math.max(18, this.weapon.damage) * this.stats.damageMult * this.stats.riposteMult;
    e.takeRawDamage(dmg, dir, 3);
    if (e.alive) e.stun(0.8);
    this.comboSide *= -1;
    this.viewmodel.slash(this.comboSide, 0.1);
    this.viewmodel.kick(0.5);
    game.audio.play('riposte');
    game.onEnemyHit(e, e.alive ? 'riposte' : 'kill', dir, dmg, { proc: true });
  }

  // ---- Frame ---------------------------------------------------------------

  update(dt) {
    const P = CONFIG.player;
    const S = this.stats;
    const input = this.game.input;
    const world = this.game.room.world;

    let [lx, ly] = input.takeLook();
    const set = this.game.settings;
    if (set.get('smoothing')) {
      // Average with the previous frame: evens out uneven mouse polling without real lag.
      const [px, py] = this.prevLook;
      this.prevLook = [lx, ly];
      lx = (lx + px) * 0.5;
      ly = (ly + py) * 0.5;
    }
    if (set.get('invertY')) ly = -ly;
    const sens = P.mouseSensitivity * set.get('sensitivity');
    if (this.alive && !this.game.shop?.open) {
      this.yaw -= lx * sens;
      this.pitch = clamp(this.pitch - ly * sens, -1.45, 1.45);
      this.viewmodel.addSway(lx, ly);
    }

    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    this.manaDelay = Math.max(0, this.manaDelay - dt);
    this.skillCd = Math.max(0, this.skillCd - dt);
    if (this.manaDelay <= 0 && this.alive) this.mana = Math.min(S.maxMana, this.mana + S.manaRegen * dt);
    this.arts.update(dt);
    this.restage.update(dt);
    this.summoner.update(dt);
    if (this.streakTimer > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) { this.streak = 0; this.game.hud.streak(0); }
    }
    if (this.hidden) {
      this.hideTimer -= dt;
      if (this.hideTimer <= 0 || !this.alive) this.reveal();
    }

    if (this.alive && this.game.menuOpen === false) {
      if (input.wasPressed('KeyQ')) this.trySkill();
      if (input.wasPressed('KeyR')) this.tryUltimate();
      if (input.wasPressed('KeyF')) this.tryFlask();
      if (input.wasPressed('KeyZ')) this.arts.tryUse(0);
      if (input.wasPressed('KeyX')) this.arts.tryUse(1);
      if (['idle', 'guard'].includes(this.state)) {
        for (let i = 0; i < WEAPON_SLOTS; i++) if (input.wasPressed(`Digit${i + 1}`)) this.switchTo(i);
        if (input.consume('next')) this.cycleWeapon(1);
        if (input.consume('prev')) this.cycleWeapon(-1);
      }
    }

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
      case 'skill':
        this.updateSkill();
        break;
      case 'ult':
        this.updateUlt(dt);
        break;
      case 'art':
        this.arts.updateCast(dt);
        break;
      case 'drink':
        if (!this.healed && this.stateTime > 0.4) {
          this.healed = true;
          this.hp = Math.min(S.maxHp, this.hp + S.maxHp * FLASK_HEAL);
          this.game.onFlaskDrunk();
        }
        if (this.stateTime > 0.75) this.setState('idle');
        break;
      case 'swap':
        if (this.stateTime > 0.28) this.setState('idle');
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

    // On a ladder, the climb carries you; no walking, no gravity.
    if (this.state === 'climb') {
      this.updateClimb(dt);
      this.updateCamera(dt, 0);
      return;
    }

    // Movement.
    const [strafe, fwdAxis] = this.alive ? input.moveAxes() : [0, 0];
    const moving = strafe !== 0 || fwdAxis !== 0;
    const mult = { idle: 1, guard: 0.5, attack: 0.3, recoil: 0.3, guardbreak: 0.15, hurt: 0.4, dead: 0, skill: 0.4, drink: 0.35, swap: 0.8, ult: this.ultId === 'oath' ? 0.5 : this.ultId === 'finale' || this.ultId === 'march' ? 0.6 : 0, art: this.artId === 'breath' ? 0.45 : 0.3 }[this.state] ?? 1;
    this.sprinting = this.state === 'idle' && fwdAxis > 0 && input.down('ShiftLeft', 'ShiftRight') && this.stamina > 0 && this.grounded;
    const wading = this.grounded && this.pos.y < -0.3 && this.game.mode === 'run';
    const speed = (this.sprinting ? S.speed * (P.sprintSpeed / P.speed) : S.speed) * mult * (wading ? 0.62 : 1) * this.streakMult;
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

    if (this.grounded) this.jumpsUsed = 0;
    if (this.grounded && input.consume('jump') && (this.state === 'idle' || this.state === 'guard') && this.spendStamina(P.jumpCost)) {
      this.vel.y = P.jumpVelocity;
      this.grounded = false;
    } else if (!this.grounded && this.jumpsUsed < S.extraJumps && (this.state === 'idle' || this.state === 'guard')
      && this.vel.y < 3.5 && input.consume('jump') && this.spendStamina(P.jumpCost)) {
      // A relic's second wind: a burst of feathers and ash, and up again.
      this.jumpsUsed++;
      this.vel.y = P.jumpVelocity * 0.95;
      this.game.audio.play('dodge');
      this.game.glow.burst(this.pos.clone(), 16, () => ({
        vel: new THREE.Vector3(rand(-2, 2), rand(-2, 0), rand(-2, 2)), life: rand(0.3, 0.7), size: 0.05, color: 0xe8e0d0, drag: 3,
      }));
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
      this.pos.y = ground;
      this.vel.y = 0;
    } else {
      this.pos.y = newY;
      this.grounded = false;
    }
    if (this.pos.y < (this.game.fallY ?? -16) && this.alive) this.game.onPlayerFell();
    // Remember solid footing well away from any edge, to climb back to after a fall.
    this.safeTimer = (this.safeTimer || 0) - dt;
    if (this.grounded && this.alive && this.safeTimer <= 0) {
      this.safeTimer = 0.4;
      const w = world, y = this.pos.y;
      const solid = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([ox, oz]) => {
        const g = w.groundAt(this.pos.x + ox, this.pos.z + oz, y);
        return g !== null && Math.abs(g - y) < 0.6;
      });
      if (solid) this.lastSafe = { x: this.pos.x, y, z: this.pos.z };
    }

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && moving && hs > 0.5) {
      this.stepDist += hs * dt;
      this.bobPhase += hs * dt * 1.9;
      if (this.stepDist > (this.sprinting ? 2.4 : 1.9)) {
        this.stepDist = 0;
        this.game.audio.play(wading ? 'splash' : 'step');
      }
    }

    this.fx.update(dt);
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
    const dip = this.dodging() ? Math.sin((this.stateTime / 0.24) * Math.PI) * 0.35 : 0;
    cam.position.set(this.pos.x, this.pos.y + lerp(P.eyeHeight, 0.35, k) + bob - dip + sh.y * 0.1, this.pos.z);
    const lean = this.dodging() ? -this.skillDir.dot(_right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))) * 0.12 : 0;
    this.roll = damp(this.roll || 0, -strafe * 0.025 + lean, 8, dt);
    cam.rotation.set(this.pitch + sh.x * 0.04 + k * 0.4, this.yaw + sh.y * 0.04, this.roll + sh.z * 0.03 + k * 1.1, 'YXZ');

    const L = P.lantern;
    const t = this.game.time;
    const fl = 0.85 + 0.15 * flicker(t, 1.3);
    const flare = this.state === 'skill' && this.skillId === 'flare' ? 1 + Math.max(0, 1 - Math.abs(this.stateTime - 0.18) * 5) * 6 : 1;
    this.lantern.intensity = L.intensity * this.game.lanternScale * fl * flare * (this.alive ? 1 : 0.35);
    this.lantern.distance = L.distance * this.stats.lightRadius * (flare > 1 ? 1.6 : 1);
    this.viewmodel.update(dt, fl);
  }
}

// ============================================================================
// First-person viewmodel — rendered in its own scene over the world.
// ============================================================================

const P3 = (p, r) => ({ p, r });

// Idle poses keep the blade low, tipped away from the eye and leaning outward, so the centre of
// the screen stays clear; guard and attack poses bring it across the view on purpose.
const MAIN_POSES = {
  slash: { idle: P3([0.5, -0.56, -0.72], [-0.95, 0, -0.1]), guard: P3([0.1, -0.26, -0.6], [-0.12, 0.2, 1.38]) },
  heavy: { idle: P3([0.54, -0.62, -0.72], [-0.88, 0, 0]), guard: P3([0.12, -0.3, -0.62], [-0.1, 0.2, 1.4]) },
  thrust: { idle: P3([0.44, -0.52, -0.64], [-1.32, 0, 0.02]), guard: P3([0.12, -0.3, -0.6], [-0.3, 0.2, 1.3]) },
  cast: { idle: P3([0.42, -0.48, -0.62], [-1.0, 0, 0.02]), guard: P3([0.1, -0.28, -0.55], [-0.3, 0.2, 1.2]) },
};
const COMMON_POSES = {
  recoil: P3([0.62, -0.5, -0.55], [0.5, 0, -0.9]),
  guardbreak: P3([0.55, -0.85, -0.5], [0.9, 0, -1.1]),
  hurt: P3([0.5, -0.5, -0.66], [-0.1, 0, 0.6]),
  dead: P3([0.4, -1.4, -0.6], [1.2, 0, 0.5]),
  swap: P3([0.45, -0.95, -0.6], [0.6, 0, 0.3]),
  drink: P3([0.5, -0.7, -0.6], [0.2, 0, 0.4]),
};
const MODEL_SCALE = { longsword: 0.6, daggers: 0.8, greatsword: 0.52, spear: 0.55, mace: 0.7, wand: 0.9, staff: 0.55, emberstaff: 0.58, stormstaff: 0.55, rapier: 0.66, scythe: 0.5 };

const OFF_POSES = {
  lantern: { idle: P3([-0.46, -0.4, -0.76], [0, 0.3, 0]), guard: P3([-0.5, -0.5, -0.7], [0, 0.3, 0]) },
  shield: { idle: P3([-0.6, -0.6, -0.72], [0.25, 0.8, 0.15]), guard: P3([-0.12, -0.26, -0.55], [0, 0.08, 0]) },
  dagger: { idle: P3([-0.48, -0.54, -0.72], [-0.78, 0, 0.06]), guard: P3([-0.06, -0.29, -0.6], [-0.12, -0.2, -1.38]) },
};

/** A hand whose pose is smoothed towards a target. */
class Hand {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.model = new THREE.Group();
    this.root.add(this.model);
    scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.rot = new THREE.Vector3();
  }

  snapTo(pose) {
    this.pos.set(...pose.p);
    this.rot.set(...pose.r);
  }

  track(pose, rate, dt) {
    const [px, py, pz] = pose.p, [rx, ry, rz] = pose.r;
    this.pos.set(damp(this.pos.x, px, rate, dt), damp(this.pos.y, py, rate, dt), damp(this.pos.z, pz, rate, dt));
    this.rot.set(damp(this.rot.x, rx, rate, dt), damp(this.rot.y, ry, rate, dt), damp(this.rot.z, rz, rate, dt));
  }

  apply(ox, oy, oz, krx = 0, krz = 0) {
    this.root.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z + oz);
    this.root.rotation.set(this.rot.x + krx, this.rot.y, this.rot.z + krz);
  }

  setModel(obj) {
    this.model.clear();
    if (obj) this.model.add(obj);
  }
}

const mirror = (pose) => P3([-pose.p[0], pose.p[1], pose.p[2]], [pose.r[0], -pose.r[1], -pose.r[2]]);

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
    this.M = weaponMaterials();

    this.main = new Hand(this.scene);
    this.off = new Hand(this.scene);

    this.lanternModel = this.buildLantern();
    this.shieldModel = buildShieldModel(this.M);
    this.shieldModel.scale.setScalar(0.62);
    this.offDagger = buildWeaponModel('daggers', this.M);
    this.offDagger.scale.setScalar(MODEL_SCALE.daggers);
    this.flaskModel = this.buildFlask();

    this.buildTrail();
    this.sway = new THREE.Vector2();
    this.kickAmount = 0;
    this.lanternSwing = 0;
    this.equippedUid = null;
  }

  buildLantern() {
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    const frame = this.M.dark;
    add(new THREE.BoxGeometry(0.2, 0.03, 0.2), frame, 0, 0.14, 0);
    add(new THREE.BoxGeometry(0.2, 0.03, 0.2), frame, 0, -0.14, 0);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(new THREE.BoxGeometry(0.025, 0.28, 0.025), frame, x * 0.09, 0, z * 0.09);
    this.flame = add(new THREE.BoxGeometry(0.1, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0xffb060 }), 0, 0, 0);
    add(new THREE.BoxGeometry(0.16, 0.24, 0.16),
      new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, 0);
    add(new THREE.ConeGeometry(0.13, 0.1, 4), frame, 0, 0.2, 0).rotation.y = Math.PI / 4;
    add(new THREE.BoxGeometry(0.02, 0.16, 0.02), frame, 0, 0.3, 0);
    add(new THREE.BoxGeometry(0.08, 0.08, 0.26), frame, 0, 0.38, 0.16);
    g.scale.setScalar(0.75);
    return g;
  }

  buildFlask() {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.2, 7), new THREE.MeshBasicMaterial({ color: 0xc41e2a }));
    g.add(glass);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 6), this.M.gold);
    neck.position.y = 0.14;
    g.add(neck);
    return g;
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

  /** Rebuild the hand models for the player's current weapon and off-hand. */
  equip() {
    const pl = this.player;
    const w = pl.weapon;
    const model = buildWeaponModel(w.typeId, this.M, w.bolt?.color);
    model.scale.setScalar(MODEL_SCALE[w.typeId] ?? 0.6);
    this.main.setModel(model);
    this.tip = null;
    model.traverse((o) => { if (o.userData.tip) this.tip = o; });
    const off = pl.offhand;
    this.off.setModel(off === 'shield' ? this.shieldModel : off === 'dagger' ? this.offDagger : this.lanternModel);
    if (this.equippedUid === null) {
      this.main.snapTo(MAIN_POSES[w.kind].idle);
      this.off.snapTo(OFF_POSES[off].idle);
    }
    this.equippedUid = w.uid;
    this.trailUniforms.color.value.setHex(w.rarity.id === 'common' ? 0xffe0b0 : w.rarity.color);
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
    const kind = this.player.weapon.kind;
    if (kind === 'thrust' || kind === 'cast') return;
    this.trailT = 0;
    this.trailDur = duration;
    this.trailUniforms.side.value = side;
    this.trail.rotation.z = side * 0.28;
  }

  attackPoses(kind, side) {
    switch (kind) {
      case 'thrust':
        return { wind: P3([0.36, -0.36, -0.4], [-1.5, 0, 0.1]), end: P3([0.12, -0.3, -1.15], [-1.55, 0, 0.05]) };
      case 'cast':
        return { wind: P3([0.34, -0.16, -0.5], [-0.2, 0, 0.1]), end: P3([0.22, -0.3, -0.84], [-1.45, 0, 0.05]) };
      case 'heavy':
        return side > 0
          ? { wind: P3([0.7, 0.05, -0.55], [-0.1, 0, -1.2]), end: P3([-0.6, -0.5, -0.7], [-1.05, 0, 1.9]) }
          : { wind: P3([-0.4, 0.05, -0.55], [-0.1, 0, 1.3]), end: P3([0.66, -0.5, -0.7], [-1.05, 0, -1.8]) };
      default:
        return side > 0
          ? { wind: P3([0.68, -0.12, -0.6], [-0.25, 0, -1.3]), end: P3([-0.55, -0.38, -0.7], [-0.95, 0, 1.7]) }
          : { wind: P3([-0.35, -0.12, -0.6], [-0.25, 0, 1.35]), end: P3([0.62, -0.38, -0.7], [-0.95, 0, -1.6]) };
    }
  }

  update(dt, flameFlicker) {
    const pl = this.player;
    const w = pl.weapon;
    const state = pl.state;
    const off = pl.offhand;
    const kindPoses = MAIN_POSES[w.kind];
    let mainTarget = COMMON_POSES[state] || (state === 'guard' ? kindPoses.guard : kindPoses.idle);
    let offTarget = OFF_POSES[off][state === 'guard' ? 'guard' : 'idle'];
    let mainRate = 14, offRate = 14;

    // With a shield the shield does the guarding; the weapon stays back.
    if (off === 'shield' && state === 'guard') mainTarget = kindPoses.idle;
    if (state === 'dead' || state === 'guardbreak') offTarget = P3([-0.5, -1.2, -0.6], [0.6, 0, 0]);

    if (state === 'attack') {
      const { windup, active } = pl.attackTimings();
      const t = pl.stateTime;
      const offSwings = w.dual && pl.comboSide < 0;
      let { wind, end } = this.attackPoses(w.kind, offSwings ? 1 : pl.comboSide);
      if (offSwings) { wind = mirror(wind); end = mirror(end); }
      let target;
      let snap = false;
      if (t < windup) target = wind;
      else if (t < windup + active) {
        const k = easeOut((t - windup) / active);
        target = P3(wind.p.map((v, i) => lerp(v, end.p[i], k)), wind.r.map((v, i) => lerp(v, end.r[i], k)));
        snap = true;
      } else target = end;
      if (offSwings) { offTarget = target; offRate = snap ? 60 : 30; }
      else { mainTarget = target; mainRate = snap ? 60 : 30; }
    } else if (state === 'guard') {
      mainRate = offRate = 26;
    } else if (state === 'skill') {
      const t = pl.stateTime;
      if (pl.skillId === 'bash') {
        offTarget = t < 0.1 ? P3([-0.2, -0.3, -0.4], [0, 0.1, 0]) : P3([-0.08, -0.25, -0.85], [0, 0, 0]);
        offRate = 30;
      } else if (pl.skillId === 'flare') {
        offTarget = P3([-0.05, -0.12, -0.6], [0, 0, 0]);
        offRate = 24;
      } else {
        mainTarget = P3([0.5, -0.6, -0.6], [-0.2, 0, 0.6]);
        offTarget = P3([-0.5, -0.6, -0.6], [0, 0.3, 0]);
      }
    } else if (state === 'drink') {
      offTarget = P3([-0.1, -0.2, -0.35], [0.9, 0, 0.5]);
      offRate = 18;
    } else if (state === 'climb') {
      // Hand over hand: the weapon and the off-hand reach up in turn, rung by rung.
      const s = Math.sin(pl.bobPhase * 1.2);
      mainTarget = P3([0.34, -0.35 + Math.max(0, s) * 0.3, -0.55], [0.3, 0, 0.2]);
      offTarget = P3([-0.34, -0.35 + Math.max(0, -s) * 0.3, -0.55], [0.3, 0, -0.2]);
      mainRate = offRate = 12;
    } else if (state === 'art') {
      // The staff thrust forward, tip towards the target, trembling with the spell.
      const t = pl.stateTime;
      mainTarget = P3([0.24, -0.26 + Math.sin(t * 40) * 0.006, -0.72], [-1.35, 0, 0.05]);
      offTarget = P3([-0.3, -0.3, -0.7], [0, 0.3, 0]);
      mainRate = 22;
    } else if (state === 'ult') {
      const t = pl.stateTime;
      if (pl.ultId === 'oath') {
        mainTarget = pl.ultFired ? P3([0.05, -0.5, -0.85], [-1.7, 0, 0]) : P3([0.15, 0.12, -0.5], [0.55, 0, 0.15]);
        mainRate = pl.ultFired ? 50 : 16;
      } else if (pl.ultId === 'sunfall') {
        offTarget = P3([-0.38, -0.2 + Math.sin(t * 30) * 0.01, -0.8], [0, 0, 0]);
        offRate = 20;
      }
    }

    this.main.track(mainTarget, mainRate, dt);
    this.off.track(offTarget, offRate, dt);
    const holdingFlask = this.off.model.children[0] === this.flaskModel;
    if (state === 'drink' && !holdingFlask) this.off.setModel(this.flaskModel);
    else if (state !== 'drink' && holdingFlask) this.equip();

    this.sway.multiplyScalar(Math.exp(-8 * dt));
    this.kickAmount = Math.max(0, this.kickAmount - dt * 5);
    const hs = Math.min(1, Math.hypot(pl.vel.x, pl.vel.z) / pl.stats.speed);
    const bobX = Math.sin(pl.bobPhase) * 0.02 * hs;
    const bobY = -Math.abs(Math.cos(pl.bobPhase)) * 0.025 * hs;
    const breathe = Math.sin(this.game.time * 1.6) * 0.006;
    const kick = this.kickAmount * this.kickAmount;

    const guardHand = off === 'shield' || off === 'dagger' ? this.off : this.main;
    const k = guardHand === this.main ? kick : 0;
    this.main.apply(this.sway.x + bobX + k * 0.05, this.sway.y + bobY + breathe + k * 0.09, k * 0.06, -k * 0.25, k * 0.35);
    const ko = guardHand === this.off ? kick : 0;
    this.lanternSwing = damp(this.lanternSwing, this.sway.x * 6 + bobX * 8, 4, dt);
    this.off.apply(this.sway.x * 0.8 - bobX * 0.6 - ko * 0.04, this.sway.y * 0.8 + bobY * 0.8 + ko * 0.08, ko * 0.08, -ko * 0.2,
      off === 'lantern' && state !== 'drink' ? this.lanternSwing * 0.8 : 0);

    const flare = state === 'skill' && pl.skillId === 'flare' ? 1 + Math.max(0, 1 - Math.abs(pl.stateTime - 0.18) * 5) * 4 : 1;
    this.flame.scale.setScalar((0.8 + 0.25 * flameFlicker) * flare);
    if (off === 'lantern') {
      this.light.intensity = 3.2 * flameFlicker * flare;
      this.light.position.copy(this.off.root.position);
    } else {
      // Lantern hangs at the belt: light the hands from below and behind, gently.
      this.light.intensity = 1.2 * flameFlicker * flare;
      this.light.position.set(-0.3, -0.9, 0.1);
    }
    if (this.tip) this.tip.scale.setScalar(state === 'attack' && pl.stateTime < pl.attackTimings().windup ? 1.8 : 1);

    this.trailT += dt;
    if (this.trailDur) {
      const tk = this.trailT / this.trailDur;
      this.trailUniforms.head.value = Math.min(1.25, tk * 1.25);
      this.trailUniforms.opacity.value = tk < 1 ? 1 : Math.max(0, 1 - (this.trailT - this.trailDur) / 0.12);
    }
  }
}
