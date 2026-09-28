import * as THREE from 'three';
import { rand, chance, damp, angleDiff, headingTo, TAU } from './util.js';
import { Enemy, GroundTelegraph, Bolt, box, buildSkeletonRig, Skeleton, Shade } from './enemies.js';
import { RingWave, FirePool, LineTelegraph, Ghost } from './hazards.js';

/**
 * The guardians. Every biome has its own, with its own body and its own way of killing you, and
 * each has two phases: at half health it roars, the arena turns against you, and it learns new
 * tricks.
 *
 * Attacks are scripted as timed steps (`act`): pose, telegraph, strike, follow-up. Bosses are
 * never interrupted by a parry, but parries fill their posture; a broken boss can be executed.
 */
export class Boss extends Enemy {
  constructor(game, chamber, x, y, z, cfg) {
    super(game, chamber, x, y, z, { interruptOnParry: false, blockChance: 0, ...cfg });
    this.isBoss = true;
    this.phase = 1;
    this.baseName = cfg.name;
    this.phaseName = cfg.phaseName || `${cfg.name}, Unbound`;
    this.speed = (cfg.speed ?? 2.4) * this.speedMult;
    this.keepDist = cfg.keepDist ?? 3;
    this.auraColor = cfg.auraColor ?? 0xff5a20;
    this.cooldown = 1.6;
    this.scheduled = [];
    this.telegraphs = [];
    this.moveCd = {};
    this.lastMove = null;
    this.pose = 'idle';
    this.poseT = 0;
    this.track = 0;
    this.recoverTime = 0.9;
    this.walk = 0;
    this.moves = [];
  }

  /** Phase two is quicker in everything. */
  get tempo() { return this.phase === 2 ? 0.8 : 1; }

  later(t, fn) { this.scheduled.push({ t, fn }); }
  setPose(p) { this.pose = p; this.poseT = 0; }

  /** Warn of the next blow: a gleam for a parryable one, a red glow for one you must avoid. */
  tell(duration, perilous = false) {
    this.glint = perilous ? duration : 0.22;
    this.perilous = perilous;
    this.game.onEnemyTelegraph(this, perilous);
  }

  /** Run a timed sequence of steps; afterwards recover for a moment. */
  act(steps, recover = 0.9) {
    this.setState('act');
    this.steps = steps.sort((a, b) => a.at - b.at);
    this.stepI = 0;
    this.recoverTime = recover;
    this.track = 4;
    this.sliding = false;
  }

  runAct() {
    while (this.stepI < this.steps.length && this.stateTime >= this.steps[this.stepI].at) {
      this.steps[this.stepI++].fn();
      if (this.state !== 'act' || this.dead) return;
    }
    if (this.stepI >= this.steps.length) {
      this.perilous = false;
      this.setState('recover');
    }
  }

  // ---- Shared attacks ------------------------------------------------------------

  swing({ damage, range, arc, perilous = false, lunge = 0 }) {
    this.game.audio.play(perilous || damage > 20 ? 'swing-heavy' : 'swing');
    if (lunge) {
      const f = this.forward();
      this.vel.set(f.x * lunge, 0, f.z * lunge);
    }
    return this.attackPlayer({ damage, range, arc, perilous });
  }

  /** A blow that lands on a spot, not a person: everything within `radius` of `point`. */
  slamAt(point, radius, damage, { perilous = true, dust = 0x2f3038, sound = 'boss-slam' } = {}) {
    const g = this.game;
    const p = this.player.pos;
    if (Math.hypot(p.x - point.x, p.z - point.z) < radius + 0.2 && Math.abs(p.y - point.y) < 1.4) {
      this.attackPlayer({ damage, perilous, from: point });
    }
    g.audio.play(sound);
    g.shake(Math.min(0.8, 0.3 + radius * 0.1));
    g.particles.burst(new THREE.Vector3(point.x, point.y + 0.1, point.z), Math.round(10 + radius * 8), (i, n) => {
      const a = rand(0, TAU);
      return { vel: new THREE.Vector3(Math.cos(a) * rand(2, 3 + radius * 1.5), rand(1, 4), Math.sin(a) * rand(2, 3 + radius * 1.5)), life: rand(0.5, 1.2), size: rand(0.08, 0.2), color: dust, gravity: 12, linger: true, floor: point.y };
    });
  }

  markCircle(point, radius, duration, color = 0xff2a14) {
    const t = new GroundTelegraph(this.game, point.x, point.y, point.z, radius, duration, { color });
    this.game.addEffect(t);
    this.telegraphs.push(t);
    return t;
  }

  markArc(radius, arc, duration, color = 0xffb040) {
    const t = new GroundTelegraph(this.game, this.pos.x, this.pos.y, this.pos.z, radius, duration, { arc, yaw: this.yaw, color });
    this.game.addEffect(t);
    this.telegraphs.push(t);
    return t;
  }

  markLine(length, width, duration, color = 0xff2a14) {
    const t = new LineTelegraph(this.game, this.pos, this.yaw, length, width, duration, color);
    this.game.addEffect(t);
    this.telegraphs.push(t);
    return t;
  }

  wave(opts) {
    this.game.addEffect(new RingWave(this.game, this, this.pos, opts));
    this.game.audio.play('tidewave');
  }

  pool(point, radius, opts) {
    this.game.addEffect(new FirePool(this.game, point, radius, opts));
  }

  ground(x, z) {
    return this.chamber.world.groundAt(x, z, this.pos.y + 2) ?? this.pos.y;
  }

  /** Where the knight will be in a moment, on the ground. */
  leadPoint(lead = 0.3, spread = 0) {
    const p = this.player;
    const x = p.pos.x + p.vel.x * lead + rand(-spread, spread), z = p.pos.z + p.vel.z * lead + rand(-spread, spread);
    return new THREE.Vector3(x, this.ground(x, z), z);
  }

  summon(Type, n) {
    for (let i = 0; i < n; i++) {
      const sp = this.chamber.spawnPoint(5);
      const e = new Type(this.game, this.chamber, sp.x, sp.y, sp.z);
      this.chamber.enemies.push(e);
    }
    this.game.audio.play('awaken');
  }

  /** In the player's reach from `from` facing `yaw`? */
  reaches(from, yaw, range, arc) {
    const p = this.player.pos;
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    if (d - this.player.radius > range || Math.abs(p.y - from.y) > 2) return false;
    return Math.abs(angleDiff(yaw, Math.atan2(p.x - from.x, p.z - from.z))) <= arc / 2 || d < 1.2;
  }

  cancelTelegraphs() {
    for (const t of this.telegraphs) t.cancel?.();
    this.telegraphs.length = 0;
  }

  // ---- Frame -------------------------------------------------------------------------

  think(dt) {
    this.cooldown -= dt;
    this.poseT += dt;
    this.telegraphs = this.telegraphs.filter((t) => t.t < t.duration);
    switch (this.state) {
      case 'chase': {
        const d = this.distToPlayer();
        this.approach(dt, d);
        if (this.cooldown <= 0) this.chooseMove(d);
        break;
      }
      case 'act':
        if (this.track > 0) this.facePlayer(dt, this.track);
        if (!this.sliding) this.brake(dt, 7);
        this.runAct();
        break;
      case 'recover':
        this.brake(dt, 6);
        if (this.stateTime > this.recoverTime * this.tempo) {
          this.cooldown = rand(0.2, 0.8) * this.tempo;
          this.setPose('idle');
          this.setState('chase');
        }
        break;
      case 'transition':
        this.brake(dt, 10);
        this.facePlayer(dt, 3);
        if (!this.roared && this.stateTime > 0.8) {
          this.roared = true;
          this.game.bossRoar(this);
          this.onPhase2();
        }
        if (this.stateTime > 2.1) {
          this.setPose('idle');
          this.recoverTime = 0.2;
          this.setState('recover');
        }
        break;
    }
  }

  approach(dt, d) {
    if (d > this.keepDist) this.chase(dt, this.speed * (this.phase === 2 ? 1.2 : 1), this.keepDist);
    else {
      this.strafe(dt, this.speed * 0.5, this.orbit || (this.orbit = chance(0.5) ? 1 : -1));
      if (chance(dt * 0.3)) this.orbit *= -1;
    }
  }

  chooseMove(d) {
    const now = this.game.time;
    const options = this.moves.filter((m) => (m.phase ?? 1) <= this.phase && d >= (m.min ?? 0) && d <= (m.max ?? 99) && !(this.moveCd[m.id] > now));
    if (!options.length) { this.cooldown = 0.2; return; }
    const weight = (m) => m.w * (m.id === this.lastMove ? 0.3 : 1);
    let r = Math.random() * options.reduce((a, m) => a + weight(m), 0);
    let move = options[0];
    for (const m of options) { r -= weight(m); if (r <= 0) { move = m; break; } }
    this.moveCd[move.id] = now + (move.cd ?? 0) * this.tempo;
    this.lastMove = move.id;
    this[move.id]();
  }

  update(dt) {
    if (!this.dead) {
      for (let i = this.scheduled.length - 1; i >= 0; i--) {
        const s = this.scheduled[i];
        s.t -= dt;
        if (s.t <= 0) {
          this.scheduled.splice(i, 1);
          s.fn();
        }
      }
      if (this.phase === 2 && Math.random() < dt * 24) {
        this.game.glow.emit({
          pos: new THREE.Vector3(this.pos.x + rand(-1, 1) * this.radius, this.pos.y + rand(0.2, this.height), this.pos.z + rand(-1, 1) * this.radius),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.8, 2), rand(-0.3, 0.3)), life: rand(0.4, 0.9), size: rand(0.05, 0.1), color: this.auraColor,
        });
      }
    }
    super.update(dt);
  }

  receiveHit(damage, dir, player, opts) {
    if (this.state === 'transition') return 'miss';
    return super.receiveHit(damage, dir, player, opts);
  }

  takeRawDamage(amount, dir, knock) {
    if (this.state === 'transition') return;
    super.takeRawDamage(amount, dir, knock * 0.4);
    if (!this.dead && this.phase === 1 && this.hp < this.maxHp * 0.5) this.beginTransition();
  }

  beginTransition() {
    this.phase = 2;
    this.cancelTelegraphs();
    this.posture = 0;
    this.name = this.phaseName;
    this.setPose('roar');
    this.setState('transition');
    this.game.onBossPhase(this);
  }

  afterExecution() {
    if (this.state === 'transition') return;
    super.afterExecution();
  }

  onParried() {
    super.onParried();
    if (this.state === 'broken') this.cancelTelegraphs();
  }

  die(fell) {
    this.cancelTelegraphs();
    this.scheduled.length = 0;
    super.die(fell);
    this.game.hud.hideBoss();
    this.game.onBossKilled(this);
  }

  onPhase2() {}

  /** Smoothly steer a joint towards a target rotation. */
  static aim(obj, x, y, z, rate, dt) {
    obj.rotation.x = damp(obj.rotation.x, x, rate, dt);
    obj.rotation.y = damp(obj.rotation.y, y, rate, dt);
    obj.rotation.z = damp(obj.rotation.z, z, rate, dt);
  }
}

// ============================================================================
// The Gaoler of Bones — the Sapphire Undercroft
// A hulking skeleton jailer: cleaver combos, a chain that drags you in, and in its second phase
// fields of bone spears that erupt beneath you and run outwards in rings.
// ============================================================================

export class Gaoler extends Boss {
  constructor(game, chamber, x, y, z, name) {
    super(game, chamber, x, y, z, {
      name, phaseName: `${name}, Unchained`, hp: 360, radius: 1.25, height: 3.2, mass: 6, chunkColor: 0x9a927e, bloodColor: 0x2a2620,
      postureMax: 140, parryPosture: 30, brokenTime: 2.6, speed: 2.4, keepDist: 3.2, auraColor: game.theme.crystal,
    });
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
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.05, rand(0.25, 0.45), 6), crystalMat);
        c.position.set(side * rand(0.3, 0.5), 1.68, rand(-0.15, 0.15));
        c.rotation.z = side * -rand(0.2, 0.7);
        r.add(c);
      }
    }
    // Keys and chains hang from the belt; one long chain wraps the off arm.
    for (let i = 0; i < 7; i++) r.add(box(0.05, 0.1, 0.03, iron, -0.22 + i * 0.07, 0.72 - (i % 2) * 0.06, 0.18));
    const offArm = this.parts.arms[1];
    for (let i = 0; i < 9; i++) offArm.add(box(0.07, 0.05, 0.07, iron, 0, -0.08 - i * 0.075, 0.07 * ((i % 2) - 0.5)));
    offArm.add(box(0.14, 0.2, 0.06, iron, 0, -0.82, 0));
    const horn = this.mat(0x2a2218);
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 5), horn);
      h.position.set(side * 0.2, 0.22, 0);
      h.rotation.z = side * -0.5;
      this.parts.head.add(h);
    }
    this.rig.add(r);
    this.moves = [
      { id: 'combo', w: 3, max: 4.2 },
      { id: 'sweep', w: 2, max: 4.2, cd: 3 },
      { id: 'slam', w: 1.5, max: 9, cd: 3 },
      { id: 'chain', w: 2, min: 4.5, max: 13, cd: 6 },
      { id: 'spears', w: 2, min: 3, max: 16, cd: 7, phase: 2 },
      { id: 'boneField', w: 1.8, max: 10, cd: 9, phase: 2 },
    ];
  }

  combo() {
    const T = this.tempo, n = this.phase === 2 ? 4 : 3;
    const steps = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const w = (i === 0 ? 0.75 : 0.42) * T;
      const side = i % 2 ? 'L' : 'R';
      steps.push({ at: t, fn: () => { this.setPose(`wind${side}`); this.track = 5; this.tell(w); } });
      t += w;
      steps.push({ at: t, fn: () => { this.setPose(`cut${side}`); this.track = 0; this.sliding = true; this.swing({ damage: 18, range: 3.6, arc: 1.7, lunge: 4 }); } });
      t += 0.14;
      steps.push({ at: t, fn: () => { this.sliding = false; } });
    }
    this.act(steps, 1.0);
  }

  sweep() {
    const w = 0.75 * this.tempo;
    this.act([
      { at: 0, fn: () => { this.setPose('sweepWind'); this.track = 0; this.yaw = this.headingToPlayer(); this.tell(w); this.markArc(4.2, Math.PI * 1.3, w); } },
      { at: w, fn: () => { this.setPose('sweep'); this.swing({ damage: 22, range: 4.3, arc: Math.PI * 1.3 }); } },
    ], 1.0);
  }

  slam() {
    const w = 1.05 * this.tempo;
    const target = this.leadPoint(0.3);
    this.yaw = headingTo(this.pos, target);
    this.act([
      { at: 0, fn: () => { this.setPose('raise'); this.track = 0; this.tell(w, true); this.markCircle(target, 2.8, w); } },
      { at: w, fn: () => { this.setPose('slam'); this.slamAt(target, 2.8, 30); } },
    ], 1.1);
  }

  /** The chain: flung down a lane. Parry it, or be dragged in for a hammer blow. */
  chain() {
    const w = 0.85 * this.tempo;
    let yaw;
    this.act([
      { at: 0, fn: () => { this.setPose('throwWind'); this.track = 6; this.tell(w); } },
      { at: w * 0.7, fn: () => { this.track = 0; yaw = this.yaw; this.markLine(13, 1.4, w * 0.3 + 0.05, 0xffb040); } },
      { at: w, fn: () => {
        this.setPose('throw');
        this.game.audio.play('chain');
        this.game.addEffect(new ChainLash(this.game, this, yaw, 13));
        const p = this.player.pos;
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
        const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const across = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw));
        if (along > 0 && along < 13.5 && across < 0.9 && Math.abs(p.y - this.pos.y) < 2) {
          const result = this.attackPlayer({ damage: 10, from: this.pos });
          if (result === 'hit' || result === 'guardbreak') {
            // Hooked: hauled across the floor into the jailer's reach.
            const d = Math.hypot(dx, dz) || 1;
            this.player.knock.set((-dx / d) * Math.min(26, d * 2.6), 0, (-dz / d) * Math.min(26, d * 2.6));
            this.later(0.45 * this.tempo, () => this.hookedSlam());
          }
        }
      } },
    ], 0.9);
  }

  hookedSlam() {
    if (this.state !== 'recover' && this.state !== 'act') return;
    const target = this.pos.clone().addScaledVector(this.forward(), 2.2);
    target.y = this.ground(target.x, target.z);
    this.act([
      { at: 0, fn: () => { this.setPose('raise'); this.tell(0.5, true); this.markCircle(target, 2.2, 0.5); } },
      { at: 0.5, fn: () => { this.setPose('slam'); this.slamAt(target, 2.2, 26); } },
    ], 1.2);
  }

  /** Bone spears erupt under the knight, one after another. */
  spears() {
    const steps = [{ at: 0, fn: () => { this.setPose('roar'); this.track = 3; this.game.audio.play('rattle'); } }];
    for (let i = 0; i < 4; i++) {
      steps.push({ at: 0.3 + i * 0.45 * this.tempo, fn: () => {
        const at = this.leadPoint(0.5, 0.6);
        this.markCircle(at, 1.6, 0.8, 0xe8dcc0);
        this.later(0.8, () => this.spearBurst(at));
      } });
    }
    this.act(steps, 1.2);
  }

  spearBurst(at) {
    this.slamAt(at, 1.6, 16, { dust: 0xd8cfb8, sound: 'shatter' });
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU), r = rand(0, 1.2);
      this.game.addEffect(new Spike(this.game, new THREE.Vector3(at.x + Math.cos(a) * r, at.y, at.z + Math.sin(a) * r), 0xd8cfb8, rand(0.9, 1.8)));
    }
  }

  /** Rings of bone spears run out across the floor: jump them. */
  boneField() {
    const w = 0.9 * this.tempo;
    this.act([
      { at: 0, fn: () => { this.setPose('raise'); this.track = 0; this.tell(w, true); } },
      { at: w, fn: () => { this.setPose('slam'); this.slamAt(this.pos.clone().addScaledVector(this.forward(), 1.8), 1.5, 20); this.wave({ speed: 7.5, maxR: 17, damage: 20, color: 0xe8dcc0, height: 0.5, spikes: true }); } },
      { at: w + 0.9, fn: () => this.wave({ speed: 7.5, maxR: 17, damage: 20, color: 0xe8dcc0, height: 0.5, spikes: true }) },
    ], 1.1);
  }

  onPhase2() {
    this.summon(Skeleton, 2);
    this.eyeMat.color.setHex(this.game.theme.crystal);
  }

  animate(dt) {
    const P = this.parts;
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 2.5);
    this.walk += dt * 6 * speedN;
    const s = Math.sin(this.walk) * 0.5 * speedN;
    P.legs[0].rotation.x = s;
    P.legs[1].rotation.x = -s;
    let a = [-0.4, 0, 0], off = [-s * 0.4, 0, 0], lean = 0.1, rate = 10;
    switch (this.pose) {
      case 'windR': a = [-2.4, -0.8, 0]; lean = -0.15; rate = 8; break;
      case 'windL': a = [-2.4, 0.8, 0]; lean = -0.15; rate = 8; break;
      case 'cutR': a = [-0.9, 0.8, 0]; lean = 0.3; rate = 30; break;
      case 'cutL': a = [-0.9, -0.8, 0]; lean = 0.3; rate = 30; break;
      case 'sweepWind': a = [-1.4, -1.6, 0]; lean = -0.1; rate = 6; break;
      case 'sweep': a = [-1.4, 1.6, 0]; lean = 0.1; rate = 30; break;
      case 'raise': a = [-3.0, 0, 0]; lean = -0.3; rate = 6; break;
      case 'slam': a = [-1.2, 0, 0]; lean = 0.45; rate = 30; break;
      case 'throwWind': a = [-0.4, 0, 0]; off = [-2.6, 0.4, 0]; lean = -0.2; rate = 8; break;
      case 'throw': a = [-0.4, 0, 0]; off = [-1.5, 0, 0]; lean = 0.25; rate = 30; break;
      case 'roar': a = [-2.6, -0.4, 0]; off = [-2.6, 0.4, 0]; lean = -0.4; rate = 6; break;
    }
    if (this.state === 'stagger' || this.state === 'broken') { a = [0.3, 0, 0]; lean = -0.45; rate = 10; }
    Boss.aim(P.arms[0], a[0], a[1], a[2], rate, dt);
    Boss.aim(P.arms[1], off[0], off[1], off[2], rate, dt);
    P.root.rotation.x = damp(P.root.rotation.x, lean, 10, dt);
    this.eyeMat.color.setHex(this.state === 'act' && this.glint > 0 ? 0xffe6b0 : this.phase === 2 ? this.game.theme.crystal : 0xff7a1a);
  }
}

// ============================================================================
// The Sunken Abbess — the Drowned Cathedral
// A drowned prioress drifting on the flood with a bell-staff: fans of water bolts to parry back,
// a bell that tolls the ground around her, tides you must jump, and in her second phase she
// slips through the water to strike from beside you.
// ============================================================================

export class Abbess extends Boss {
  constructor(game, chamber, x, y, z, name) {
    super(game, chamber, x, y, z, {
      name, phaseName: `${name}, Risen Tide`, hp: 300, radius: 0.95, height: 3.5, mass: 4, chunkColor: 0x3a4a44, bloodColor: 0x1e2e1a,
      postureMax: 120, parryPosture: 34, brokenTime: 2.4, speed: 2.8, keepDist: 6.5, auraColor: 0x7af0b8,
    });
    const robe = this.mat(0x1a2622);
    const wet = this.mat(0x2c3a34, { roughness: 0.4 });
    const bone = this.mat(0x9aa890);
    const gold = this.weaponMat(0x8a7a4a);
    this.water = 0x7af0b8;
    const body = (this.body = new THREE.Group());
    // Robe: layered cones trailing into the water, ragged at the hem.
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.4, 9, 1, true), robe);
    skirt.material.side = THREE.DoubleSide;
    skirt.position.y = 1.3;
    body.add(skirt);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const rag = box(0.28, rand(0.3, 0.6), 0.04, robe, Math.sin(a) * 0.9, 0.15, Math.cos(a) * 0.9);
      rag.rotation.y = a;
      body.add(rag);
    }
    body.add(box(0.8, 0.9, 0.5, wet, 0, 2.55, 0));
    body.add(box(0.95, 0.12, 0.55, gold, 0, 2.95, 0));
    // A tall veiled coif, a gaunt face beneath, eyes of drowned light.
    const head = (this.head = new THREE.Group());
    head.position.set(0, 3.2, 0.05);
    head.add(box(0.36, 0.44, 0.38, bone, 0, 0, 0));
    const coif = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 6), wet);
    coif.position.y = 0.3;
    head.add(coif);
    const veil = box(0.6, 0.9, 0.05, robe, 0, -0.15, -0.25);
    head.add(veil);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: this.water, fog: false });
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), this.eyeMat);
      e.position.set(side * 0.09, 0.03, 0.2);
      head.add(e);
    }
    body.add(head);
    // Arms and the bell-staff.
    this.arm = new THREE.Group();
    this.arm.position.set(-0.52, 2.85, 0);
    this.arm.add(box(0.16, 0.9, 0.16, wet, 0, -0.45, 0));
    const staff = new THREE.Group();
    staff.position.set(0, -0.85, 0.1);
    staff.add(box(0.07, 3.4, 0.07, this.weaponMat(0x2a2218), 0, 0.6, 0));
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.34, 0.5, 8, 1, true), gold);
    bell.material.side = THREE.DoubleSide;
    bell.position.y = 2.2;
    staff.add(bell);
    this.lampMat = new THREE.MeshBasicMaterial({ color: this.water, fog: false });
    const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), this.lampMat);
    lamp.position.y = 2.05;
    staff.add(lamp);
    this.tip = lamp;
    this.arm.add(staff);
    body.add(this.arm);
    this.offArm = new THREE.Group();
    this.offArm.position.set(0.52, 2.85, 0);
    this.offArm.add(box(0.16, 0.9, 0.16, wet, 0, -0.45, 0));
    this.offArm.add(box(0.12, 0.22, 0.12, bone, 0, -0.95, 0));
    body.add(this.offArm);
    this.rig.add(body);
    this.moves = [
      { id: 'volley', w: 3, min: 3, max: 18, cd: 2 },
      { id: 'toll', w: 2.5, max: 5.2, cd: 3 },
      { id: 'tide', w: 2, max: 14, cd: 6 },
      { id: 'strike', w: 2, max: 4, cd: 2 },
      { id: 'blink', w: 2, min: 4, max: 20, cd: 5, phase: 2 },
    ];
  }

  volley() {
    const w = 0.8 * this.tempo;
    const n = this.phase === 2 ? 5 : 3;
    const steps = [{ at: 0, fn: () => { this.setPose('cast'); this.track = 8; this.tell(w); this.game.audio.play('cast'); } }];
    for (let i = 0; i < n; i++) {
      steps.push({ at: w + i * 0.14, fn: () => {
        const from = this.tip.getWorldPosition(new THREE.Vector3());
        const target = this.player.eyePosition;
        target.y -= 0.35;
        const dir = target.sub(from).normalize();
        const spread = (i - (n - 1) / 2) * 0.16;
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
        this.game.addBolt(new Bolt(this.game, from, dir, this, this.water, { damage: 13 * this.damageMult, speed: 13 }));
        this.game.audio.play('bolt');
      } });
    }
    this.act(steps, 0.8);
  }

  toll() {
    const w = 1.1 * this.tempo;
    const at = this.pos.clone();
    this.act([
      { at: 0, fn: () => { this.setPose('raise'); this.track = 0; this.tell(w, true); this.markCircle(at, 4.6, w, 0x7af0b8); } },
      { at: w, fn: () => {
        this.setPose('toll');
        this.slamAt(at, 4.6, 26, { dust: 0x3a5a50, sound: 'toll' });
        this.game.glow.burst(at.clone().setY(at.y + 0.3), 40, () => ({ vel: new THREE.Vector3(rand(-6, 6), rand(1, 4), rand(-6, 6)), life: rand(0.4, 0.9), size: 0.08, color: this.water, drag: 2 }));
      } },
    ], 1.0);
  }

  tide() {
    const w = 0.9 * this.tempo;
    const steps = [
      { at: 0, fn: () => { this.setPose('raise'); this.track = 0; this.tell(w, true); } },
      { at: w, fn: () => { this.setPose('toll'); this.game.audio.play('toll'); this.wave({ speed: 7, maxR: 18, damage: 20, color: this.water, height: 0.55 }); } },
    ];
    if (this.phase === 2) steps.push({ at: w + 0.85, fn: () => this.wave({ speed: 7, maxR: 18, damage: 20, color: this.water, height: 0.55 }) });
    this.act(steps, 1.0);
  }

  strike() {
    const w = 0.6 * this.tempo;
    this.act([
      { at: 0, fn: () => { this.setPose('swingWind'); this.track = 7; this.tell(w); } },
      { at: w, fn: () => { this.setPose('swing'); this.track = 0; this.sliding = true; this.swing({ damage: 18, range: 3.4, arc: 1.8, lunge: 3 }); } },
      { at: w + 0.2, fn: () => { this.sliding = false; } },
    ], 0.8);
  }

  /** Through the water: gone in a spray, and up again beside you with the staff already swinging. */
  blink() {
    this.act([
      { at: 0, fn: () => { this.setPose('raise'); this.track = 0; this.splash(); } },
      { at: 0.35, fn: () => {
        this.game.addEffect(new Ghost(this.game, this.rig, { color: this.water, life: 0.8 }));
        const p = this.player;
        const a = p.yaw + (chance(0.5) ? 1 : -1) * rand(1.3, 2.2);
        for (const r of [2.6, 2.2, 3.2]) {
          const x = p.pos.x - Math.sin(a) * r, z = p.pos.z - Math.cos(a) * r;
          const g = this.chamber.world.groundAt(x, z, p.pos.y + 1);
          if (g !== null && Math.abs(g - p.pos.y) < 1) { this.pos.set(x, g, z); break; }
        }
        this.yaw = headingTo(this.pos, p.pos);
        this.splash();
        this.game.audio.play('vanish');
      } },
      { at: 0.4, fn: () => { this.setPose('swingWind'); this.track = 9; this.tell(0.5 * this.tempo); } },
      { at: 0.4 + 0.5 * this.tempo, fn: () => { this.setPose('swing'); this.track = 0; this.swing({ damage: 20, range: 3.4, arc: 2 }); } },
    ], 0.9);
  }

  splash() {
    this.game.glow.burst(this.pos.clone().setY(this.pos.y + 0.4), 30, () => ({ vel: new THREE.Vector3(rand(-3, 3), rand(2, 6), rand(-3, 3)), life: rand(0.4, 0.8), size: 0.07, color: this.water, drag: 2 }));
  }

  onPhase2() {
    this.summon(Skeleton, 2);
    this.keepDist = 5;
  }

  animate(dt) {
    const t = this.game.time;
    this.body.position.y = 0.25 + Math.sin(t * 1.6) * 0.12;
    let a = [0.2, 0, 0.15], o = [0.2, 0, -0.15], lean = 0, rate = 8;
    switch (this.pose) {
      case 'cast': a = [-1.5, 0, 0.1]; o = [-1.2, 0, -0.2]; rate = 10; break;
      case 'raise': a = [-2.9, 0, 0.1]; o = [-2.2, 0, -0.3]; lean = -0.15; rate = 5; break;
      case 'toll': a = [-0.9, 0, 0]; lean = 0.2; rate = 30; break;
      case 'swingWind': a = [-2.2, -0.9, 0]; lean = -0.1; rate = 9; break;
      case 'swing': a = [-1.0, 1.0, 0]; lean = 0.25; rate = 30; break;
      case 'roar': a = [-2.8, 0, 0.4]; o = [-2.8, 0, -0.4]; lean = -0.35; rate = 5; break;
    }
    if (this.state === 'stagger' || this.state === 'broken') { a = [0.4, 0, 0.3]; lean = -0.4; }
    Boss.aim(this.arm, a[0], a[1], a[2], rate, dt);
    Boss.aim(this.offArm, o[0], o[1], o[2], rate, dt);
    this.body.rotation.x = damp(this.body.rotation.x, lean, 8, dt);
    this.lampMat.color.setHex(this.glint > 0 ? 0xffffff : this.water);
    if (Math.random() < dt * 20) {
      this.game.glow.emit({ pos: new THREE.Vector3(this.pos.x + rand(-0.8, 0.8), this.pos.y + 0.1, this.pos.z + rand(-0.8, 0.8)), vel: new THREE.Vector3(0, rand(0.2, 0.6), 0), life: rand(0.5, 1), size: 0.04, color: this.water });
    }
  }
}

// ============================================================================
// The Kiln Tyrant — the Ember Fortress
// A walking furnace with a forge-hammer: slams that leave the floor burning, a charge down a
// marked lane, and once its belly cracks open, a rain of molten stone.
// ============================================================================

export class Tyrant extends Boss {
  constructor(game, chamber, x, y, z, name) {
    super(game, chamber, x, y, z, {
      name, phaseName: `${name}, Molten Heart`, hp: 420, radius: 1.45, height: 3.9, mass: 8, chunkColor: 0x2a2220, bloodColor: 0x3a1004,
      postureMax: 160, parryPosture: 28, brokenTime: 2.6, speed: 2.2, keepDist: 3.4, auraColor: 0xff6a20,
    });
    const iron = this.mat(0x2a2624, { metalness: 0.5, roughness: 0.6 });
    const stone = this.mat(0x4a3e38);
    this.fireMat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 1.6, flatShading: true });
    const r = (this.root = new THREE.Group());
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.55, 1.1, 0);
      leg.add(box(0.6, 1.1, 0.7, stone, 0, -0.55, 0));
      leg.add(box(0.75, 0.25, 0.9, iron, 0, -1.0, 0.08));
      r.add(leg);
      this.legs.push(leg);
    }
    r.add(box(1.9, 1.5, 1.3, iron, 0, 2.05, 0));
    r.add(box(1.5, 0.4, 1.15, stone, 0, 1.2, 0));
    // The furnace mouth in its belly: grate bars over fire.
    r.add(box(0.9, 0.7, 0.05, this.fireMat, 0, 1.95, 0.66));
    for (let i = 0; i < 5; i++) r.add(box(0.07, 0.8, 0.08, iron, -0.36 + i * 0.18, 1.95, 0.7));
    for (const side of [-1, 1]) {
      const sh = box(0.8, 0.5, 1.0, iron, side * 1.15, 2.7, 0);
      sh.rotation.z = side * -0.25;
      r.add(sh);
      const chimney = box(0.25, 0.9, 0.25, iron, side * 0.55, 3.2, -0.35);
      r.add(chimney);
    }
    const head = box(0.6, 0.45, 0.6, iron, 0, 3.05, 0.25);
    r.add(head);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffa020, fog: false });
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.02), this.eyeMat);
    slit.position.set(0, 3.08, 0.56);
    r.add(slit);
    this.arm = new THREE.Group();
    this.arm.rotation.order = 'YXZ';
    this.arm.position.set(-1.2, 2.6, 0);
    this.arm.add(box(0.5, 1.2, 0.5, stone, 0, -0.6, 0));
    const hammer = this.weaponMat(0x3a3430);
    this.arm.add(box(0.14, 2.4, 0.14, this.mat(0x1a1410), 0, -1.3, 0.8).rotateX(Math.PI / 2));
    this.arm.add(box(0.9, 0.9, 1.3, hammer, 0, -1.25, 2.1));
    this.arm.add(box(0.95, 0.2, 0.2, this.fireMat, 0, -1.25, 2.8));
    r.add(this.arm);
    this.offArm = new THREE.Group();
    this.offArm.position.set(1.2, 2.6, 0);
    this.offArm.add(box(0.5, 1.2, 0.5, stone, 0, -0.6, 0));
    this.offArm.add(box(0.6, 0.5, 0.6, iron, 0, -1.35, 0));
    r.add(this.offArm);
    this.rig.add(r);
    this.moves = [
      { id: 'combo', w: 3, max: 4.6 },
      { id: 'slam', w: 2, max: 5.5, cd: 3 },
      { id: 'rush', w: 2, min: 5, max: 17, cd: 5 },
      { id: 'stomp', w: 1.5, max: 8, cd: 5 },
      { id: 'meteors', w: 2.5, min: 2, max: 20, cd: 8, phase: 2 },
    ];
  }

  hammerPoint(dist = 2.6) {
    const p = this.pos.clone().addScaledVector(this.forward(), dist);
    p.y = this.ground(p.x, p.z);
    return p;
  }

  combo() {
    const T = this.tempo;
    const steps = [];
    let t = 0;
    const n = this.phase === 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const w = (i === 0 ? 0.9 : 0.6) * T;
      const side = i % 2 ? 'L' : 'R';
      steps.push({ at: t, fn: () => { this.setPose(`wind${side}`); this.track = 4; this.tell(w); } });
      t += w;
      steps.push({ at: t, fn: () => { this.setPose(`cut${side}`); this.track = 0; this.sliding = true; this.swing({ damage: 22, range: 4.2, arc: 1.8, lunge: 3.5 }); } });
      t += 0.18;
      steps.push({ at: t, fn: () => { this.sliding = false; } });
    }
    this.act(steps, 1.1);
  }

  slam() {
    const w = 1.1 * this.tempo;
    let at;
    this.act([
      { at: 0, fn: () => { this.setPose('raise'); this.track = 5; this.tell(w, true); } },
      { at: w * 0.55, fn: () => { this.track = 0; at = this.hammerPoint(); this.markCircle(at, 3.2, w * 0.45); } },
      { at: w, fn: () => {
        this.setPose('slam');
        this.slamAt(at, 3.2, 30, { dust: 0x3a2a20 });
        this.pool(at, 2.4, { duration: 6, dps: 10 });
        this.game.glow.burst(at.clone().setY(at.y + 0.3), 30, () => ({ vel: new THREE.Vector3(rand(-5, 5), rand(2, 6), rand(-5, 5)), life: rand(0.4, 0.9), size: 0.08, color: 0xff7a2a, drag: 2 }));
      } },
    ], 1.3);
  }

  /** Down a marked lane at full tilt: get out of the way. */
  rush() {
    const w = 0.95 * this.tempo;
    let len = 0;
    this.act([
      { at: 0, fn: () => { this.setPose('charge'); this.track = 6; this.tell(w, true); } },
      { at: w * 0.5, fn: () => { this.track = 0; len = Math.min(17, this.distToPlayer() + 4); this.markLine(len, 2.8, w * 0.5); } },
      { at: w, fn: () => { this.charging = len / 17; this.chargeHit = false; this.sliding = true; this.game.audio.play('rush'); } },
      { at: w + 1.05, fn: () => { this.charging = 0; this.sliding = false; this.setPose('idle'); } },
    ], 1.2);
  }

  stomp() {
    const w = 0.8 * this.tempo;
    this.act([
      { at: 0, fn: () => { this.setPose('stompWind'); this.track = 0; this.tell(w, true); } },
      { at: w, fn: () => { this.setPose('stomp'); this.game.shake(0.5); this.game.audio.play('boss-slam'); this.wave({ speed: 8, maxR: 17, damage: 18, color: 0xff6a20, height: 0.5 }); } },
    ], 0.9);
  }

  /** Molten stone falls where you stand, and where you run to. */
  meteors() {
    const steps = [{ at: 0, fn: () => { this.setPose('roar'); this.track = 0; this.game.audio.play('roar'); } }];
    for (let i = 0; i < 5; i++) {
      steps.push({ at: 0.4 + i * 0.4 * this.tempo, fn: () => {
        const at = this.leadPoint(0.6, 1.5);
        this.markCircle(at, 1.9, 1.1, 0xff8a30);
        this.game.addEffect(new Meteor(this.game, at, 1.1));
        this.later(1.1, () => {
          this.slamAt(at, 1.9, 18, { dust: 0x3a2a20 });
          this.pool(at, 1.6, { duration: 4, dps: 8 });
        });
      } });
    }
    this.act(steps, 1.0);
  }

  onPhase2() {
    this.fireMat.emissiveIntensity = 3;
    this.eyeMat.color.setHex(0xffe0a0);
  }

  think(dt) {
    if (this.charging && this.state === 'act') {
      const f = this.forward();
      const sp = 17;
      this.vel.set(f.x * sp, 0, f.z * sp);
      if (Math.random() < dt * 40) {
        this.game.particles.emit({ pos: new THREE.Vector3(this.pos.x + rand(-1, 1), this.pos.y + 0.1, this.pos.z + rand(-1, 1)), vel: new THREE.Vector3(rand(-1, 1), rand(1, 2.5), rand(-1, 1)), life: rand(0.5, 1), size: rand(0.1, 0.2), color: 0x3a2a20, gravity: 8, floor: this.pos.y, linger: true });
      }
      if (this.phase === 2 && Math.random() < dt * 5) this.pool(this.pos.clone(), 1.3, { duration: 3, dps: 8 });
      if (!this.chargeHit && this.distToPlayer() < this.radius + 1.1 && Math.abs(this.player.pos.y - this.pos.y) < 1.6) {
        this.chargeHit = true;
        this.attackPlayer({ damage: 28, perilous: true, from: this.pos });
        const pf = this.player;
        pf.knock.set(f.x * 14, 0, f.z * 14);
      }
    }
    super.think(dt);
  }

  animate(dt) {
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 2.5);
    this.walk += dt * 4.5 * Math.min(1.5, speedN);
    const s = Math.sin(this.walk) * 0.4 * Math.min(1, speedN);
    this.legs[0].rotation.x = s;
    this.legs[1].rotation.x = -s;
    let a = [-0.2, 0, 0], o = [-s * 0.3, 0, 0], lean = 0.05, rate = 8;
    switch (this.pose) {
      case 'windR': a = [-2.4, -0.9, 0]; lean = -0.12; rate = 6; break;
      case 'windL': a = [-2.4, 0.9, 0]; lean = -0.12; rate = 6; break;
      case 'cutR': a = [-0.6, 0.9, 0]; lean = 0.3; rate = 26; break;
      case 'cutL': a = [-0.6, -0.9, 0]; lean = 0.3; rate = 26; break;
      case 'raise': a = [-3.1, 0, 0]; o = [-2.4, 0, 0]; lean = -0.3; rate = 5; break;
      case 'slam': a = [-0.9, 0, 0]; o = [-0.8, 0, 0]; lean = 0.5; rate = 28; break;
      case 'charge': a = [-0.6, 0, 0.3]; o = [-0.6, 0, -0.3]; lean = 0.5; rate = 8; break;
      case 'stompWind': lean = -0.25; rate = 6; this.legs[1].rotation.x = -1.0; break;
      case 'stomp': lean = 0.2; rate = 20; this.legs[1].rotation.x = 0.2; break;
      case 'roar': a = [-2.6, 0, 0.5]; o = [-2.6, 0, -0.5]; lean = -0.4; rate = 5; break;
    }
    if (this.state === 'stagger' || this.state === 'broken') { a = [0.2, 0, 0]; lean = -0.35; }
    Boss.aim(this.arm, a[0], a[1], a[2], rate, dt);
    Boss.aim(this.offArm, o[0], o[1], o[2], rate, dt);
    this.root.rotation.x = damp(this.root.rotation.x, lean, 8, dt);
    this.fireMat.emissiveIntensity = (this.phase === 2 ? 3 : 1.6) * (0.85 + 0.15 * Math.sin(this.game.time * 9));
    if (Math.random() < dt * (this.phase === 2 ? 30 : 8)) {
      this.game.glow.emit({ pos: new THREE.Vector3(this.pos.x + rand(-0.3, 0.3), this.pos.y + 3.8, this.pos.z + rand(-0.4, 0)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1.5, 3), rand(-0.2, 0.2)), life: rand(0.6, 1.2), size: rand(0.05, 0.1), color: 0xff7a2a });
    }
  }
}

// ============================================================================
// The Last Seneschal — the Sunlit Ruins
// The final steward of a fallen court, quick and exact with a glaive: long flurries to parry,
// leaps across the arena, a spinning sweep — and in the second phase, a shining echo of himself
// that repeats every flurry a heartbeat later.
// ============================================================================

export class Seneschal extends Boss {
  constructor(game, chamber, x, y, z, name) {
    super(game, chamber, x, y, z, {
      name, phaseName: `${name}, the Sun's Echo`, hp: 290, radius: 0.9, height: 3.1, mass: 3.5, chunkColor: 0xc8b890, bloodColor: 0x5a0a08,
      postureMax: 115, parryPosture: 24, brokenTime: 2.3, speed: 3.8, keepDist: 3, auraColor: 0xf0d890,
    });
    const plate = this.mat(0xb8a878, { metalness: 0.6, roughness: 0.4 });
    const dark = this.mat(0x2a2620);
    const cloth = this.mat(0x6a1a18);
    const r = (this.root = new THREE.Group());
    r.scale.setScalar(1.25);
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.16, 1.0, 0);
      leg.add(box(0.16, 1.0, 0.18, plate, 0, -0.5, 0));
      leg.add(box(0.18, 0.08, 0.3, dark, 0, -0.98, 0.05));
      r.add(leg);
      this.legs.push(leg);
    }
    r.add(box(0.5, 0.7, 0.3, plate, 0, 1.4, 0));
    r.add(box(0.42, 0.3, 0.26, dark, 0, 1.0, 0));
    // A long tabard and cape.
    r.add(box(0.36, 0.9, 0.04, cloth, 0, 0.75, 0.17));
    this.cape = box(0.6, 1.5, 0.04, cloth, 0, 1.0, -0.2);
    r.add(this.cape);
    for (const side of [-1, 1]) {
      const p = box(0.26, 0.14, 0.34, plate, side * 0.32, 1.76, 0);
      p.rotation.z = side * -0.35;
      r.add(p);
    }
    // A tall crested helm with a sunburst visor.
    const helm = new THREE.Group();
    helm.position.set(0, 2.0, 0.02);
    helm.add(box(0.28, 0.36, 0.3, plate, 0, 0, 0));
    helm.add(box(0.04, 0.4, 0.34, this.mat(0xf0d890), 0, 0.3, 0));
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.02), this.eyeMat);
    visor.position.set(0, 0.02, 0.16);
    helm.add(visor);
    r.add(helm);
    this.arm = new THREE.Group();
    this.arm.rotation.order = 'YXZ';
    this.arm.position.set(-0.36, 1.66, 0);
    this.arm.add(box(0.12, 0.6, 0.12, plate, 0, -0.3, 0));
    const glaive = this.weaponMat(0xd8d0b8);
    const shaft = box(0.05, 0.05, 2.8, dark, 0, -0.6, 0.7);
    this.arm.add(shaft);
    this.arm.add(box(0.05, 0.22, 0.75, glaive, 0, -0.52, 2.35));
    this.arm.add(box(0.05, 0.1, 0.25, glaive, 0, -0.35, 2.55));
    r.add(this.arm);
    this.offArm = new THREE.Group();
    this.offArm.position.set(0.36, 1.66, 0);
    this.offArm.add(box(0.12, 0.6, 0.12, plate, 0, -0.3, 0));
    r.add(this.offArm);
    this.rig.add(r);
    this.vy = 0;
    this.moves = [
      { id: 'flurry', w: 3, max: 5 },
      { id: 'spin', w: 1.5, max: 4, cd: 4 },
      { id: 'thrust', w: 1.5, min: 3, max: 8, cd: 3 },
      { id: 'leap', w: 2, min: 5, max: 16, cd: 5 },
      { id: 'sunring', w: 1.5, max: 12, cd: 7, phase: 2 },
    ];
  }

  flurry() {
    const T = this.tempo;
    const n = this.phase === 2 ? 5 : 4;
    const times = [0.6, 0.32, 0.32, 0.5, 0.3];
    const steps = [];
    const echo = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const w = times[i] * T;
      const side = i % 2 ? 'L' : 'R';
      steps.push({ at: t, fn: () => { this.setPose(`wind${side}`); this.track = 7; this.tell(w); } });
      t += w;
      steps.push({ at: t, fn: () => {
        this.setPose(`cut${side}`);
        this.track = 0;
        this.sliding = true;
        this.swing({ damage: 14, range: 3.4, arc: 1.7, lunge: 5 });
        if (this.phase === 2) echo.push({ pos: this.pos.clone(), yaw: this.yaw, t: this.stateTime });
      } });
      t += 0.12;
      steps.push({ at: t, fn: () => { this.sliding = false; } });
    }
    if (this.phase === 2) steps.push({ at: t, fn: () => this.echo(echo) });
    this.act(steps, 1.0);
  }

  /** The Sun's Echo: a shining double repeats the flurry from where he stood. */
  echo(strikes) {
    if (!strikes.length) return;
    const ghost = new Ghost(this.game, this.rig, { color: 0xf0d890, life: 0.9 + (strikes.at(-1).t - strikes[0].t) + 0.6, opacity: 0.5 });
    this.game.addEffect(ghost);
    this.game.audio.play('echo');
    const t0 = strikes[0].t;
    for (const s of strikes) {
      const delay = 0.7 + (s.t - t0);
      this.later(delay - 0.25, () => {
        ghost.obj.position.copy(s.pos);
        ghost.obj.rotation.y = s.yaw;
        this.glint = 0.22;
        this.game.onEnemyTelegraph(this, false);
      });
      this.later(delay, () => {
        this.game.audio.play('swing');
        if (this.reaches(s.pos, s.yaw, 3.4, 1.8)) this.attackPlayer({ damage: 12, from: s.pos });
      });
    }
  }

  spin() {
    const w = 0.75 * this.tempo;
    this.act([
      { at: 0, fn: () => { this.setPose('spinWind'); this.track = 3; this.tell(w); this.markCircle(this.pos, 3.9, w, 0xffe0a0); } },
      { at: w, fn: () => { this.setPose('spin'); this.spinT = 0.35; this.game.audio.play('swing-heavy'); this.attackPlayer({ damage: 20, range: 3.9, arc: TAU }); } },
    ], 0.9);
  }

  thrust() {
    const w = 0.9 * this.tempo;
    this.act([
      { at: 0, fn: () => { this.setPose('thrustWind'); this.track = 8; this.tell(w, true); } },
      { at: w * 0.8, fn: () => { this.track = 0; } },
      { at: w, fn: () => { this.setPose('thrust'); this.sliding = true; this.swing({ damage: 26, range: 3.6, arc: 0.8, perilous: true, lunge: 14 }); } },
      { at: w + 0.25, fn: () => { this.sliding = false; } },
    ], 1.0);
  }

  /** A great leap to where you stand, glaive-first. */
  leap() {
    const w = 0.4 * this.tempo;
    let target;
    this.act([
      { at: 0, fn: () => { this.setPose('crouch'); this.track = 8; } },
      { at: w, fn: () => {
        target = this.leadPoint(0.5);
        this.yaw = headingTo(this.pos, target);
        this.track = 0;
        this.tell(0.9, true);
        this.markCircle(target, 2.5, 0.9);
        this.leapFrom = this.pos.clone();
        this.leapTo = target;
        this.leapT = 0;
        this.setPose('leap');
        this.game.audio.play('dodge');
      } },
      { at: w + 0.9, fn: () => {
        this.leapTo = null;
        this.pos.copy(target);
        this.setPose('slam');
        this.slamAt(target, 2.5, 26, { dust: 0xd8cfb8 });
        this.game.glow.burst(target.clone().setY(target.y + 0.2), 30, () => ({ vel: new THREE.Vector3(rand(-5, 5), rand(1, 5), rand(-5, 5)), life: rand(0.3, 0.8), size: 0.07, color: 0xf0d890, drag: 2 }));
        if (this.phase === 2) this.wave({ speed: 8, maxR: 14, damage: 16, color: 0xf0d890, height: 0.5 });
      } },
    ], 1.1);
  }

  sunring() {
    const w = 0.85 * this.tempo;
    this.act([
      { at: 0, fn: () => { this.setPose('raise'); this.track = 0; this.tell(w, true); } },
      { at: w, fn: () => { this.setPose('slam'); this.game.flash = Math.max(this.game.flash, 0.3); this.wave({ speed: 6.5, maxR: 18, damage: 18, color: 0xf0d890, height: 0.55 }); } },
      { at: w + 0.7, fn: () => this.wave({ speed: 9, maxR: 18, damage: 18, color: 0xfff0c0, height: 0.55 }) },
    ], 1.0);
  }

  onPhase2() {
    this.eyeMat.color.setHex(0xffffff);
    this.summon(Shade, 1);
  }

  think(dt) {
    if (this.leapTo && this.state === 'act') {
      this.leapT += dt / 0.9;
      const k = Math.min(1, this.leapT);
      this.pos.x = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * k;
      this.pos.z = this.leapFrom.z + (this.leapTo.z - this.leapFrom.z) * k;
      this.pos.y = this.leapFrom.y + (this.leapTo.y - this.leapFrom.y) * k;
      this.vy = 0;
      this.rig.position.y = Math.sin(k * Math.PI) * 5;
      this.vel.set(0, 0, 0);
    } else if (this.rig.position.y !== 0 && this.state !== 'spawning' && !this.asleep) this.rig.position.y = 0;
    super.think(dt);
  }

  receiveHit(damage, dir, player, opts) {
    if (this.leapTo) return 'miss';
    return super.receiveHit(damage, dir, player, opts);
  }

  animate(dt) {
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 3.5);
    this.walk += dt * 7 * speedN;
    const s = Math.sin(this.walk) * 0.55 * speedN;
    this.legs[0].rotation.x = s;
    this.legs[1].rotation.x = -s;
    let a = [-0.6, 0.2, 0], o = [-s * 0.4, 0, 0], lean = 0.08, rate = 10;
    switch (this.pose) {
      case 'windR': a = [-2.2, -1.0, 0]; lean = -0.1; rate = 12; break;
      case 'windL': a = [-2.2, 1.0, 0]; lean = -0.1; rate = 12; break;
      case 'cutR': a = [-1.0, 1.0, 0]; lean = 0.3; rate = 34; break;
      case 'cutL': a = [-1.0, -1.0, 0]; lean = 0.3; rate = 34; break;
      case 'spinWind': a = [-1.4, -1.8, 0]; lean = -0.1; rate = 8; break;
      case 'spin': a = [-1.4, 1.8, 0]; rate = 30; break;
      case 'thrustWind': a = [-1.5, 0, 0]; o = [-1.2, 0, 0]; lean = -0.2; rate = 8; break;
      case 'thrust': a = [-1.6, 0, 0]; lean = 0.4; rate = 34; break;
      case 'crouch': lean = 0.4; rate = 12; break;
      case 'leap': a = [-3.0, 0, 0]; o = [-2.5, 0, 0]; lean = -0.2; rate = 10; break;
      case 'raise': a = [-3.0, 0, 0]; lean = -0.3; rate = 6; break;
      case 'slam': a = [-1.0, 0, 0]; lean = 0.5; rate = 30; break;
      case 'roar': a = [-2.8, 0.3, 0]; o = [-2.6, 0, 0]; lean = -0.35; rate = 6; break;
    }
    if (this.state === 'stagger' || this.state === 'broken') { a = [0.3, 0, 0]; lean = -0.4; }
    Boss.aim(this.arm, a[0], a[1], a[2], rate, dt);
    Boss.aim(this.offArm, o[0], o[1], o[2], rate, dt);
    this.root.rotation.x = damp(this.root.rotation.x, lean, 10, dt);
    if (this.spinT > 0) {
      this.spinT -= dt;
      this.root.rotation.y = (1 - this.spinT / 0.35) * TAU;
    } else this.root.rotation.y = 0;
    this.cape.rotation.x = damp(this.cape.rotation.x, -0.2 - speedN * 0.5, 4, dt);
  }
}

// ============================================================================
// Effects used by the guardians
// ============================================================================

/** The Gaoler's chain, flung out along its lane and hauled back. */
class ChainLash {
  constructor(game, owner, yaw, length) {
    this.game = game;
    this.owner = owner;
    this.t = 0;
    this.length = length;
    this.mat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, metalness: 0.6, roughness: 0.5 });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1).translate(0, 0, 0.5), this.mat);
    this.mesh.rotation.y = yaw;
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    const k = this.t < 0.12 ? this.t / 0.12 : Math.max(0, 1 - (this.t - 0.25) / 0.3);
    const o = this.owner.pos;
    this.mesh.position.set(o.x, o.y + 1.4, o.z);
    this.mesh.scale.z = Math.max(0.01, this.length * k);
    if (this.t > 0.6) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** A spear of bone (or crystal) that bursts from the floor and sinks again. */
class Spike {
  constructor(game, pos, color, height) {
    this.game = game;
    this.t = 0;
    this.height = height;
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
    this.mesh = new THREE.Mesh(new THREE.ConeGeometry(0.14, height, 5).translate(0, height / 2, 0), this.mat);
    this.mesh.position.copy(pos);
    this.mesh.rotation.set(rand(-0.3, 0.3), rand(0, TAU), rand(-0.3, 0.3));
    this.mesh.scale.y = 0.01;
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    const k = this.t < 0.08 ? this.t / 0.08 : this.t < 1.2 ? 1 : Math.max(0, 1 - (this.t - 1.2) / 0.4);
    this.mesh.scale.y = Math.max(0.01, k);
    if (this.t > 1.6) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Molten stone falling from the dark overhead onto its marked spot. */
class Meteor {
  constructor(game, target, fall) {
    this.game = game;
    this.t = 0;
    this.fall = fall;
    this.target = target.clone();
    this.from = target.clone().add(new THREE.Vector3(rand(-3, 3), 22, rand(-3, 3)));
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), this.mat);
    this.mesh.position.copy(this.from);
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.fall);
    this.mesh.position.lerpVectors(this.from, this.target, k * k);
    this.mesh.rotation.x += dt * 8;
    if (Math.random() < dt * 60) {
      this.game.glow.emit({ pos: this.mesh.position.clone(), vel: new THREE.Vector3(rand(-0.5, 0.5), rand(0, 1), rand(-0.5, 0.5)), life: rand(0.3, 0.6), size: rand(0.08, 0.14), color: chance(0.5) ? 0xff7a2a : 0xffd080 });
    }
    if (k >= 1) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Which guardian waits at the end of each biome. */
export const BOSSES = { crystal: Gaoler, sunken: Abbess, ember: Tyrant, sunlit: Seneschal };
