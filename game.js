import * as THREE from 'three';
import { CONFIG, FLOOR_THEMES } from './src/config.js';
import { rand, clamp, damp, flicker, toRoman } from './src/util.js';
import { AudioEngine } from './src/audio.js';
import { Input } from './src/input.js';
import { RetroPass } from './src/post.js';
import { ParticleSystem } from './src/particles.js';
import * as Textures from './src/textures.js';
import { Player } from './src/player.js';
import { DungeonFloor } from './src/chamber.js';
import { HUD } from './src/hud.js';

/**
 * Ashen Descent — owns the loop, the run/floor/chamber flow and the combat feedback
 * (hitstop, slow-motion, shake, sparks, sound) that ties the systems together.
 */
class Game {
  constructor() {
    this.state = 'title';
    this.time = 0;
    this.depth = 1;
    this.hitstop = 0;
    this.slowmo = 0;
    this.hurtFlash = 0;
    this.flash = 0;
    this.fade = 1;
    this.trauma = 0;
    this.shakeOffset = new THREE.Vector3();
    this.transition = null;
    this.effects = [];
    this.bolts = [];

    this.initRenderer();
    this.initMaterials();
    this.audio = new AudioEngine();
    this.input = new Input(this.renderer.domElement);
    this.hud = new HUD();
    this.particles = new ParticleSystem(this.scene, 600, false);
    this.glow = new ParticleSystem(this.scene, 700, true);
    this.initLights();
    this.initMist();

    this.player = new Player(this);
    this.player.viewmodel.setAspect(this.camera.aspect);

    this.bindUI();
    this.newFloor();
    this.hud.hide();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- Setup ---------------------------------------------------------------

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('game-root').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1426);
    this.scene.fog = new THREE.FogExp2(0x0a1426, CONFIG.fogDensity);
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.05, 260);
    this.scene.add(this.camera);
    this.post = new RetroPass(this.renderer);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  initMaterials() {
    const floorTex = Textures.flagstones();
    const brickTex = Textures.bricks();
    const rockTex = Textures.rock();
    this.materials = {
      floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, color: 0xa4a8b4 }),
      brick: new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95, color: 0x8e94a6 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x3e4250, roughness: 0.95, flatShading: true }),
      stone: new THREE.MeshStandardMaterial({ color: 0x6e7282, roughness: 0.9, flatShading: true }),
      rock: new THREE.MeshStandardMaterial({ map: rockTex, color: 0x8a8e9a, roughness: 1, flatShading: true }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.55, metalness: 0.5, flatShading: true }),
      bone: new THREE.MeshStandardMaterial({ color: 0xbdb49c, roughness: 0.9, flatShading: true }),
      wax: new THREE.MeshStandardMaterial({ color: 0xcfc4a4, roughness: 0.7 }),
      blood: new THREE.MeshStandardMaterial({ color: 0x2c0404, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 }),
      cloth: new THREE.MeshStandardMaterial({ color: 0x3a1620, roughness: 1, flatShading: true }),
      void: new THREE.MeshBasicMaterial({ color: 0x000000 }),
      flame: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
      crystal: new THREE.MeshStandardMaterial({ color: 0x4aa8ff, emissive: 0x4aa8ff, emissiveIntensity: 1.05, roughness: 0.2, flatShading: true }),
      windowWarm: new THREE.MeshBasicMaterial({ color: 0xffa050 }),
      windowCold: new THREE.MeshBasicMaterial({ color: 0x4aa8ff }),
      shaft: new THREE.MeshBasicMaterial({ color: 0xffe8c8, transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.flameGeo = new THREE.BoxGeometry(0.05, 0.11, 0.05);
    this.riposteTexture = Textures.riposteGlyph();
  }

  /** A fixed pool of lights (so shaders never recompile), re-aimed at each chamber's props. */
  initLights() {
    this.hemi = new THREE.HemisphereLight(0x4a6ab0, 0x0a0a12, 0.95);
    this.ambient = new THREE.AmbientLight(0x223055, 0.35);
    this.scene.add(this.hemi, this.ambient);
    this.crystalLights = Array.from({ length: 5 }, () => new THREE.PointLight(0x4aa8ff, 0, 15, 1.5));
    this.warmLights = Array.from({ length: 4 }, () => new THREE.PointLight(0xff7a30, 0, 13, 1.5));
    this.pedestalLight = new THREE.PointLight(0xffffff, 0, 8, 1.6);
    this.scene.add(...this.crystalLights, ...this.warmLights, this.pedestalLight);
  }

  /** Slow-drifting mist layers far below — the abyss breathing. */
  initMist() {
    const tex = Textures.mist();
    this.mist = [-5, -11, -19].map((y, i) => {
      const t = tex.clone();
      t.repeat.set(3, 3);
      const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55 - i * 0.1, depthWrite: false, color: 0x5a7ab0 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), mat);
      m.position.y = y;
      m.renderOrder = -1;
      m.userData.speed = [(i + 1) * 0.004, (i % 2 ? -1 : 1) * 0.003];
      this.scene.add(m);
      return m;
    });
  }

  applyTheme() {
    const t = this.theme;
    this.scene.fog.color.setHex(t.fog);
    this.scene.background.setHex(t.fog);
    this.hemi.color.setHex(t.sky);
    this.materials.crystal.color.setHex(t.crystal);
    this.materials.crystal.emissive.setHex(t.crystal);
    this.materials.windowCold.color.setHex(t.crystal);
    for (const l of this.crystalLights) l.color.setHex(t.crystal);
    for (const m of this.mist) m.material.color.setHex(t.sky).multiplyScalar(0.9);
    this.player.viewmodel.hemi.color.setHex(t.sky);
    this.post.uniforms.shadowTint.value.setHex(t.sky);
  }

  get difficulty() {
    const d = this.depth - 1;
    return { hp: 1 + 0.28 * d, damage: 1 + 0.15 * d, speed: 1 + 0.05 * d };
  }

  get theme() { return FLOOR_THEMES[(this.depth - 1) % FLOOR_THEMES.length]; }

  bindUI() {
    this.titleScreen = document.getElementById('title-screen');
    this.deathScreen = document.getElementById('death-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    document.getElementById('start-btn').addEventListener('click', () => this.start());
    this.deathScreen.addEventListener('click', () => this.restart());
    this.pauseScreen.addEventListener('click', () => this.input.requestLock());
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) {
        if (this.state === 'paused') this.resume();
      } else if (this.state === 'playing') this.pause();
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.player?.viewmodel.setAspect(w / h);
    this.post.setSize(w, h);
  }

  // ---- Flow ----------------------------------------------------------------

  start() {
    this.audio.init();
    this.input.requestLock();
    this.titleScreen.classList.add('hidden');
    this.hud.show();
    this.state = 'playing';
    this.input.clearBuffers();
    this.hud.banner(this.theme.name, 'floor', 2.8);
  }

  pause() {
    this.state = 'paused';
    this.renderPauseStats();
    this.pauseScreen.classList.remove('hidden');
  }

  resume() {
    this.state = 'playing';
    this.pauseScreen.classList.add('hidden');
    this.input.clearBuffers();
    this.clock.getDelta();
  }

  restart() {
    if (this.state !== 'dead') return;
    this.deathScreen.classList.add('hidden');
    this.input.requestLock();
    this.runTransition(() => {
      this.depth = 1;
      this.player.reset();
      this.hud.renderRelics(this.player);
      this.hud.hideBoss();
      this.newFloor();
      this.state = 'playing';
      this.hud.banner(this.theme.name, 'floor', 2.8);
    });
  }

  newFloor() {
    this.floor?.dispose();
    this.floor = new DungeonFloor(this, this.depth);
    this.applyTheme();
    const name = this.depth > FLOOR_THEMES.length ? `${this.theme.name} ${toRoman(this.depth)}` : this.theme.name;
    this.hud.setFloor(this.depth, name);
    this.room = null;
    this.enterRoom(this.floor.start, null);
  }

  descend() {
    this.audio.play('descend');
    this.runTransition(() => {
      this.depth++;
      this.hud.hideBoss();
      this.newFloor();
      this.hud.banner(this.hud.floorName.textContent, 'floor', 2.8);
    }, 0.9);
  }

  enterRoom(room, entryDir) {
    this.room?.exit();
    this.particles.clear();
    this.glow.clear();
    for (const e of this.effects) e.dispose();
    for (const b of this.bolts) b.dispose();
    this.effects.length = 0;
    this.bolts.length = 0;
    this.room = room;
    room.build();

    const pose = entryDir ? room.entryPose(entryDir) : { x: 0, y: 0, z: 3.4, yaw: 0 };
    this.entry = { room, dir: entryDir, pose };
    this.placePlayer(pose);
    room.enter();
    this.assignLights(room);
    this.hud.drawMinimap(this.floor, room);
  }

  placePlayer(pose) {
    const p = this.player;
    p.pos.set(pose.x, pose.y, pose.z);
    p.yaw = pose.yaw;
    p.pitch = 0;
    p.vel.set(0, 0, 0);
    p.knock.set(0, 0, 0);
    p.grounded = true;
    if (p.alive) p.setState('idle');
    p.updateCamera(0, 0);
  }

  assignLights(room) {
    const c = room.center;
    const score = (s) => s.weight - 0.03 * Math.hypot(s.pos.x - c.x, s.pos.z - c.z);
    const crystals = room.lightSpots.filter((s) => s.kind === 'crystal').sort((a, b) => score(b) - score(a));
    const warm = room.lightSpots.filter((s) => s.kind === 'warm' && !s.gate).sort((a, b) => score(b) - score(a))
      .concat(room.lightSpots.filter((s) => s.gate));
    this.crystalLights.forEach((l, i) => {
      const s = crystals[i];
      l.userData.base = s ? 10 + s.weight * 6 : 0;
      if (s) l.position.copy(s.pos);
    });
    this.warmLights.forEach((l, i) => {
      const s = warm[i];
      l.userData.base = s ? 7 + s.weight * 4 : 0;
      if (s) l.position.copy(s.pos);
    });
  }

  runTransition(midpoint, outTime = 0.22) {
    this.transition = { t: 0, phase: 'out', outTime, inTime: 0.35, midpoint };
  }

  updateTransition(dt) {
    const tr = this.transition;
    tr.t += dt;
    if (tr.phase === 'out') {
      this.fade = 1 - Math.min(1, tr.t / tr.outTime);
      if (tr.t >= tr.outTime) {
        tr.midpoint();
        tr.phase = 'in';
        tr.t = 0;
      }
    } else {
      this.fade = Math.min(1, tr.t / tr.inTime);
      if (tr.t >= tr.inTime) this.transition = null;
    }
  }

  checkRoomExit() {
    const dir = this.room.exitDirection(this.player.pos);
    if (!dir) return;
    const next = this.room.neighbors[dir];
    const back = { n: 's', s: 'n', e: 'w', w: 'e' }[dir];
    this.runTransition(() => this.enterRoom(next, back));
  }

  onPlayerFell() {
    if (this.transition) return;
    this.audio.play('fall');
    this.runTransition(() => {
      const p = this.player;
      p.hp -= p.stats.maxHp * 0.2;
      this.hurtFlash = 1;
      this.placePlayer(this.entry.pose);
      if (p.hp <= 0) p.die();
    }, 0.6);
  }

  // ---- Combat feedback -----------------------------------------------------

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  addEffect(e) { this.effects.push(e); }
  addBolt(b) { this.bolts.push(b); }

  sparks(pos, count, color = 0xffd8a0, speed = 5) {
    this.glow.burst(pos, count, () => ({
      vel: new THREE.Vector3(rand(-speed, speed), rand(-1, speed), rand(-speed, speed)),
      life: rand(0.15, 0.4), size: rand(0.03, 0.07), color, drag: 4,
    }));
  }

  /** A point just in front of the knight's guard, where deflections spark. */
  guardPoint() {
    const p = this.player;
    return p.eyePosition.addScaledVector(p.forward, 0.9).add(new THREE.Vector3(0, -0.25, 0));
  }

  onEnemyTelegraph(enemy, perilous) {
    if (perilous) {
      this.audio.play('perilous');
      this.hud.perilous();
    } else if (enemy.distToPlayer() < 14) this.audio.play('glint');
  }

  onEnemyHit(enemy, result, dir) {
    const S = this.player.stats;
    const c = enemy.pos.clone();
    c.y += enemy.height * 0.6;
    switch (result) {
      case 'miss':
        return;
      case 'blocked':
        this.audio.play('enemy-block');
        this.sparks(c, 16);
        this.hitstop = Math.max(this.hitstop, 0.07);
        this.shake(0.2);
        return;
      case 'riposte':
        this.audio.play('riposte');
        this.sparks(c, 30, 0xff5030, 7);
        this.hitstop = Math.max(this.hitstop, 0.14);
        this.shake(0.45);
        this.flash = 0.5;
        break;
      default:
        this.audio.play('hit');
        this.sparks(c, 10);
        this.hitstop = Math.max(this.hitstop, 0.055);
        this.shake(0.15);
    }
    if (S.lifesteal > 0) this.player.hp = Math.min(S.maxHp, this.player.hp + S.lifesteal);
    this.particles.burst(c, 6, () => ({
      vel: new THREE.Vector3(dir.x * rand(2, 5), rand(1, 4), dir.z * rand(2, 5)), life: rand(0.8, 1.6), size: rand(0.05, 0.12), color: enemy.chunkColor, gravity: 16, linger: true, floor: enemy.pos.y,
    }));
  }

  onEnemyAttackResolved(enemy, result) { this.guardFeedback(result); }
  onBoltResolved(bolt, result) { this.guardFeedback(result); }

  guardFeedback(result) {
    const gp = this.guardPoint();
    switch (result) {
      case 'parried':
        this.audio.play('parry');
        this.sparks(gp, 28, 0xfff0c0, 6);
        this.hitstop = Math.max(this.hitstop, 0.1);
        this.shake(0.25);
        this.flash = 0.7;
        this.hud.parryFlash();
        break;
      case 'blocked':
        this.audio.play('block');
        this.sparks(gp, 10, 0xffb060, 3);
        this.shake(0.2);
        break;
      case 'guardbreak':
        this.audio.play('guard-break');
        this.sparks(gp, 16, 0xff8040, 4);
        this.shake(0.55);
        this.hurtFlash = 0.6;
        this.hud.flashStamina();
        break;
      case 'hit':
        this.audio.play('hurt');
        this.hurtFlash = 1;
        this.shake(0.5);
        this.hitstop = Math.max(this.hitstop, 0.08);
        this.particles.burst(this.player.eyePosition.addScaledVector(this.player.forward, 0.6), 10, () => ({
          vel: new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2)), life: rand(0.6, 1.2), size: rand(0.04, 0.09), color: 0x6a0808, gravity: 14, floor: this.player.pos.y,
        }));
        break;
    }
  }

  onPostureBroken(enemy) {
    this.audio.play('guard-break');
    const c = enemy.pos.clone();
    c.y += enemy.height * 0.6;
    this.sparks(c, 40, 0xff3a20, 6);
    this.slowmo = Math.max(this.slowmo, 0.4);
  }

  onEnemyKilled(enemy, fell) {
    if (!fell) this.hitstop = Math.max(this.hitstop, 0.08);
    this.shake(0.2);
    const S = this.player.stats;
    if (S.lifesteal > 0) this.player.hp = Math.min(S.maxHp, this.player.hp + S.lifesteal * 2);
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.audio.play('death');
    this.slowmo = 1.4;
    this.hud.hideBoss();
    setTimeout(() => {
      if (this.state !== 'dead') return;
      this.deathScreen.classList.remove('hidden');
      document.exitPointerLock?.();
    }, 1600);
  }

  onItemPickup(item) {
    const p = this.player;
    item.apply(p.stats, p);
    p.itemCounts.set(item.id, (p.itemCounts.get(item.id) || 0) + 1);
    p.hp = Math.min(p.hp, p.stats.maxHp);
    this.audio.play('pickup');
    this.hud.showItem(item);
    this.hud.renderRelics(p);
    this.flash = 0.4;
  }

  renderPauseStats() {
    const S = this.player.stats;
    const rows = [
      ['Vigor', `${Math.ceil(this.player.hp)} / ${S.maxHp}`],
      ['Endurance', `${S.maxStamina}`],
      ['Strength', S.damage.toFixed(1)],
      ['Swing speed', `${Math.round(S.attackSpeed * 100)}%`],
      ['Parry window', `${Math.round(S.parryWindow * 1000)} ms`],
      ['Riposte', `×${S.riposteMult.toFixed(1)}`],
      ['Life drain', `${S.lifesteal}`],
      ['Floor', toRoman(this.depth)],
    ];
    const grid = document.getElementById('pause-stats');
    grid.replaceChildren();
    for (const [k, v] of rows) {
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('b');
      b.textContent = v;
      grid.append(a, b);
    }
  }

  // ---- Frame ---------------------------------------------------------------

  frame() {
    const realDt = Math.min(0.05, this.clock.getDelta());
    const input = this.input;
    if (input.wasPressed('KeyM')) this.audio.toggleMute();
    if (input.wasPressed('KeyR')) this.restart();
    input.endFrame();

    if (this.state === 'paused') {
      this.render();
      return;
    }

    let dt = realDt;
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      dt = 0;
    } else if (this.slowmo > 0) {
      this.slowmo -= realDt;
      dt *= 0.35;
    }
    this.time += dt;
    if (this.transition) this.updateTransition(realDt);

    if (this.state === 'title') {
      this.player.yaw += realDt * 0.04;
      this.player.updateCamera(realDt, 0);
      this.room.update(realDt);
    } else if (!this.transition || this.transition.phase === 'in') {
      this.player.update(dt);
      this.room.update(dt);
      if (!this.transition && this.player.alive) this.checkRoomExit();
    } else {
      this.player.updateCamera(dt, 0);
    }

    this.effects = this.effects.filter((e) => e.update(dt));
    this.bolts = this.bolts.filter((b) => b.update(dt));
    this.particles.update(dt);
    this.glow.update(dt);
    this.updateAmbience(dt, realDt);
    this.audio.update(realDt);
    if (this.state !== 'title') this.hud.update(realDt, this.player);
    this.render();
  }

  updateAmbience(dt, realDt) {
    const t = this.time;
    const p = this.player;
    this.trauma = Math.max(0, this.trauma - realDt * 1.6);
    const s = this.trauma * this.trauma;
    const tt = (performance.now() / 1000) * 40;
    this.shakeOffset.set(Math.sin(tt * 1.1) * s, Math.sin(tt * 1.7 + 2) * s, Math.sin(tt * 1.3 + 4) * s);

    if (Math.random() < dt * 10) {
      this.glow.emit({
        pos: new THREE.Vector3(p.pos.x + rand(-7, 7), p.pos.y + rand(0.3, 4), p.pos.z + rand(-7, 7)),
        vel: new THREE.Vector3(rand(-0.15, 0.15), rand(-0.05, 0.12), rand(-0.15, 0.15)), life: rand(2, 4), size: 0.03, color: 0x6a7090,
      });
    }
    this.crystalLights.forEach((l, i) => { l.intensity = (l.userData.base || 0) * (0.85 + 0.15 * Math.sin(t * 1.3 + i * 2)); });
    this.warmLights.forEach((l, i) => { l.intensity = (l.userData.base || 0) * (0.8 + 0.2 * flicker(t, i * 5)); });
    const ped = this.room.pedestal;
    if (ped && !ped.taken) {
      this.pedestalLight.position.copy(ped.lightPosition);
      this.pedestalLight.color.setHex(ped.item.color);
      this.pedestalLight.intensity = damp(this.pedestalLight.intensity, 6 * (0.85 + 0.15 * Math.sin(t * 3)), 3, dt);
    } else {
      this.pedestalLight.intensity = damp(this.pedestalLight.intensity, 0, 4, dt);
    }
    for (const m of this.mist) {
      m.position.x = this.camera.position.x;
      m.position.z = this.camera.position.z;
      const [sx, sz] = m.userData.speed;
      m.material.map.offset.x = this.camera.position.x / 100 + t * sx;
      m.material.map.offset.y = -this.camera.position.z / 100 + t * sz;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - realDt * 2.5);
    this.flash = Math.max(0, this.flash - realDt * 3);
  }

  render() {
    const u = this.post.uniforms;
    const p = this.player;
    u.time.value = this.time;
    u.hurt.value = Math.max(this.hurtFlash, p.alive ? clamp(1 - p.hp / p.stats.maxHp - 0.6, 0, 0.4) : 0.5);
    u.flash.value = this.flash;
    u.fade.value = this.fade;
    this.post.render(this.scene, this.camera, p.viewmodel.scene, p.viewmodel.camera);
  }
}

window.game = new Game();
