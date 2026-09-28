import * as THREE from 'three';
import { CONFIG, BIOMES } from './src/config.js';
import { rand, clamp, damp, flicker, toRoman, chance, angleDiff, shuffle, pick } from './src/util.js';
import { AudioEngine } from './src/audio.js';
import { Input } from './src/input.js';
import { RetroPass } from './src/post.js';
import { ParticleSystem } from './src/particles.js';
import * as Textures from './src/textures.js';
import { Player, yawOf } from './src/player.js';
import { DungeonFloor } from './src/floor.js';
import { Hub } from './src/hub.js';
import { HUD } from './src/hud.js';
import { Menus } from './src/menus.js';
import { Bolt } from './src/enemies.js';
import { WeaponDrop } from './src/loot.js';
import { rollWeapon } from './src/weapons.js';
import { CLASSES } from './src/classes.js';

const EXPEDITION_FLOORS = 3;

/**
 * Ashen Descent — owns the loop, the hub/expedition flow, interaction, and the combat feedback
 * (hitstop, slow-motion, shake, sparks, sound) that ties the systems together.
 */
class Game {
  constructor() {
    this.state = 'title';
    this.mode = 'hub';
    this.time = 0;
    this.depth = 1;
    this.hitstop = 0;
    this.slowmo = 0;
    this.hurtFlash = 0;
    this.flash = 0;
    this.fade = 1;
    this.trauma = 0;
    this.lanternScale = 1;
    this.menuOpen = false;
    this.shakeOffset = new THREE.Vector3();
    this.transition = null;
    this.effects = [];
    this.bolts = [];
    this.focus = null;

    this.initRenderer();
    this.initMaterials();
    this.audio = new AudioEngine();
    this.input = new Input(this.renderer.domElement);
    this.hud = new HUD();
    this.menus = new Menus(this);
    this.particles = new ParticleSystem(this.scene, 700, false);
    this.glow = new ParticleSystem(this.scene, 900, true);
    this.initLights();
    this.initMist();

    this.player = new Player(this);
    this.player.viewmodel.setAspect(this.camera.aspect);
    this.hub = new Hub(this);

    this.bindUI();
    this.enterHub(false);
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
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.05, 900);
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
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3e32, roughness: 1, flatShading: true }),
      leaf: [0x4e5c30, 0x5c6636, 0x3e4a28].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true })),
      moss: new THREE.MeshStandardMaterial({ color: 0x3a4a28, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide }),
      lava: new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
    };
    this.flameGeo = new THREE.BoxGeometry(0.05, 0.11, 0.05);
    this.riposteTexture = Textures.riposteGlyph();
  }

  /**
   * A fixed pool of lights (so shaders rarely recompile), re-aimed at each area's props.
   * The sun is only lit on the surface.
   */
  initLights() {
    this.hemi = new THREE.HemisphereLight(0x4a6ab0, 0x0a0a12, 0.95);
    this.ambient = new THREE.AmbientLight(0x223055, 0.35);
    this.scene.add(this.hemi, this.ambient);
    this.poolLights = Array.from({ length: 9 }, () => new THREE.PointLight(0xffffff, 0, 14, 1.5));
    this.pedestalLight = new THREE.PointLight(0xffffff, 0, 8, 1.6);
    this.scene.add(...this.poolLights, this.pedestalLight);
    this.sun = new THREE.DirectionalLight(0xe6e2d4, 0);
    this.sun.position.set(-75, 95, 55);
    this.sun.target.position.set(0, 0, 8);
    const sc = this.sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 320;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
  }

  /** Slow-drifting mist layers — the abyss breathing below, or sea fog on the surface. */
  initMist() {
    const tex = Textures.mist();
    this.mist = [0, 1, 2].map((i) => {
      const t = tex.clone();
      t.repeat.set(3, 3);
      const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55 - i * 0.1, depthWrite: false, color: 0x5a7ab0 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), mat);
      m.renderOrder = -1;
      m.userData.speed = [(i + 1) * 0.004, (i % 2 ? -1 : 1) * 0.003];
      this.scene.add(m);
      return m;
    });
  }

  /** Surface (the Hold, overcast daylight) or depths (per-floor abyss theme). */
  setEnvironment(env) {
    const u = this.post.uniforms;
    if (env === 'hub') {
      this.scene.fog.color.setHex(0x6f787a);
      this.scene.fog.density = 0.0115;
      this.scene.background.setHex(0x737c7e);
      this.hemi.color.setHex(0xaab6ba);
      this.hemi.groundColor.setHex(0x3a3a2c);
      this.hemi.intensity = 0.55;
      this.ambient.color.setHex(0x708090);
      this.ambient.intensity = 0.12;
      this.sun.intensity = 1.7;
      this.sun.castShadow = true;
      this.lanternScale = 0.7;
      this.fallY = -16;
      [-0.65, 1.2, 3.4].forEach((y, i) => {
        const m = this.mist[i];
        m.position.y = y;
        m.material.color.setHex(0xd4dad8);
        m.material.opacity = [0.35, 0.22, 0.12][i];
      });
      this.player.viewmodel.hemi.color.setHex(0xb8c2c4);
      this.player.viewmodel.hemi.intensity = 1.6;
      u.shadowTint.value.setHex(0x506068);
      this.audio.setMode('hub');
    } else {
      const t = this.theme;
      const M = this.materials;
      const sunlit = t.lighting === 'sun';
      this.scene.fog.color.setHex(t.fog);
      this.scene.fog.density = t.fogDensity;
      this.scene.background.setHex(t.fog);
      this.hemi.color.setHex(t.sky);
      this.hemi.groundColor.setHex(sunlit ? 0x4a4838 : 0x0a0a12);
      this.hemi.intensity = sunlit ? 0.7 : 0.95;
      this.ambient.color.setHex(sunlit ? 0x8090a0 : 0x223055);
      this.ambient.intensity = sunlit ? 0.18 : 0.35;
      this.sun.intensity = sunlit ? 2.0 : 0;
      this.sun.castShadow = sunlit;
      this.lanternScale = sunlit ? 0.6 : 1;
      M.floor.color.setHex(t.stone.floor);
      M.brick.color.setHex(t.stone.brick);
      M.trim.color.setHex(t.stone.trim);
      M.rock.color.setHex(t.stone.rock);
      M.crystal.color.setHex(t.crystal);
      M.crystal.emissive.setHex(t.crystal);
      M.crystal.emissiveIntensity = t.id === 'sunken' ? 1.4 : 1.05;
      M.windowCold.color.setHex(t.crystal);
      M.windowWarm.color.setHex(t.id === 'ember' ? 0xff5a20 : 0xffa050);
      const heights = t.abyss === 'water' ? [-0.2, 1.4, 4] : t.abyss === 'lava' ? [-6, -9, -11] : t.abyss === 'clouds' ? [-4, -8, -14] : [-5, -11, -19];
      const alphas = t.abyss === 'water' ? [0.3, 0.16, 0.08] : t.abyss === 'clouds' ? [0.75, 0.65, 0.55] : [0.55, 0.45, 0.35];
      heights.forEach((y, i) => {
        const m = this.mist[i];
        m.position.y = y;
        m.material.color.setHex(t.mist);
        m.material.opacity = alphas[i];
      });
      this.fallY = t.abyss === 'lava' ? -10 : -16;
      this.player.viewmodel.hemi.color.setHex(t.sky);
      this.player.viewmodel.hemi.intensity = 1.3;
      u.shadowTint.value.setHex(t.sky);
      this.audio.setMode('depths');
    }
  }

  get difficulty() {
    const d = this.depth - 1;
    return { hp: 1 + 0.28 * d, damage: 1 + 0.15 * d, speed: 1 + 0.05 * d };
  }

  get theme() { return this.biome ?? BIOMES.crystal; }

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
    this.audio.setMode(this.mode === 'hub' ? 'hub' : 'depths');
    this.input.requestLock();
    this.titleScreen.classList.add('hidden');
    this.hud.show();
    this.state = 'playing';
    this.input.clearBuffers();
    this.hud.banner(this.hub.name, 'floor', 2.8);
    this.hud.renderLoadout(this.player);
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

  /** Death screen dismissed: back to the Hold. */
  restart() {
    if (this.state !== 'dead' || this.mode !== 'run') return;
    this.deathScreen.classList.add('hidden');
    this.input.requestLock();
    this.runTransition(() => {
      this.enterHub(true);
      this.state = 'playing';
      this.hud.banner(this.hub.name, 'floor', 2.8);
    }, 0.4);
  }

  /** Arrive (or return) at the Roundtable Hold with a fresh loadout for the chosen class. */
  enterHub(resetLoadout = true) {
    this.mode = 'hub';
    this.depth = 1;
    this.floor?.dispose();
    this.floor = null;
    this.biome = null;
    if (resetLoadout) this.player.resetLoadout();
    this.hub.build();
    this.setEnvironment('hub');
    this.hud.setFloor(null, this.hub.name);
    this.hud.setMinimapVisible(false);
    this.hud.hideBoss();
    this.enterArea(this.hub, this.hub.spawnPose);
    this.hud.renderRelics(this.player);
    this.hud.renderLoadout(this.player);
  }

  beginExpedition() {
    this.audio.play('descend');
    this.runTransition(() => {
      this.mode = 'run';
      this.depth = 1;
      this.runBiomes = shuffle(Object.keys(BIOMES)).slice(0, EXPEDITION_FLOORS);
      this.hub.clearEnemies();
      this.hub.exit();
      this.player.resetLoadout();
      this.hud.renderRelics(this.player);
      this.hud.renderLoadout(this.player);
      this.hud.setMinimapVisible(true);
      this.newFloor();
      this.hud.banner(this.hud.floorName.textContent, 'floor', 2.8);
    }, 0.9);
  }

  /** Raise the next floor: pick its biome, build every chamber and stitch them together. */
  newFloor() {
    this.hub.exit();
    this.floor?.dispose();
    this.room = null;
    this.biome = BIOMES[this.runBiomes?.[this.depth - 1] ?? pick(Object.keys(BIOMES))];
    this.floor = new DungeonFloor(this, this.depth, this.biome);
    this.setEnvironment('depths');
    this.floor.build();
    const name = `${this.biome.name}`;
    this.hud.setFloor(this.depth, name);
    this.player.flasks = this.player.maxFlasks;
    this.particles.clear();
    this.glow.clear();
    for (const e of this.effects) e.dispose();
    for (const b of this.bolts) b.dispose();
    this.effects.length = 0;
    this.bolts.length = 0;
    this.room = this.floor.start;
    this.placePlayer(this.floor.startPose);
    this.switchRoom(this.floor.start);
    this.floor.update(0, this.room);
    this.lightTimer = 0;
  }

  /** The knight has walked into another chamber of the floor. */
  switchRoom(room) {
    this.room = room;
    room.onPlayerEnter();
    this.hud.drawMinimap(this.floor, room);
  }

  nearbyEnemies() { return this.mode === 'run' && this.floor ? this.floor.activeEnemies : this.room.enemies; }

  nearbyInteractables() {
    if (this.mode !== 'run' || !this.floor) return this.room.interactables || [];
    return this.floor.active.flatMap((r) => r.interactables);
  }

  descend() {
    this.audio.play('descend');
    if (this.depth >= EXPEDITION_FLOORS) {
      this.runTransition(() => {
        this.enterHub(true);
        this.hud.banner('EXPEDITION COMPLETE', '', 4);
      }, 1.2);
      return;
    }
    this.runTransition(() => {
      this.depth++;
      this.hud.hideBoss();
      this.newFloor();
      this.hud.banner(this.hud.floorName.textContent, 'floor', 2.8);
    }, 0.9);
  }

  /** Shared entry for any area (hub or chamber): swap scenes, place the knight, aim the lights. */
  enterArea(area, pose) {
    this.room?.exit?.();
    this.particles.clear();
    this.glow.clear();
    for (const e of this.effects) e.dispose();
    for (const b of this.bolts) b.dispose();
    this.effects.length = 0;
    this.bolts.length = 0;
    this.room = area;
    area.build();
    this.entry = { room: area, pose };
    this.placePlayer(pose);
    area.enter();
    this.assignLights(area);
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

  assignLights(area) {
    const c = area.center;
    const score = (s) => s.weight - 0.03 * Math.hypot(s.pos.x - c.x, s.pos.z - c.z);
    const crystalColor = this.theme.crystal;
    const spots = [...area.lightSpots].sort((a, b) => score(b) - score(a) - (b.gate ? 1 : 0) + (a.gate ? 1 : 0));
    this.poolLights.forEach((l, i) => {
      const s = spots[i];
      if (!s) {
        l.userData.base = 0;
        l.intensity = 0;
        return;
      }
      l.position.copy(s.pos);
      l.color.setHex(s.color ?? (s.kind === 'crystal' ? crystalColor : 0xff7a30));
      l.distance = s.distance ?? (s.kind === 'crystal' ? 15 : 13);
      l.userData.base = s.intensity ?? (s.kind === 'crystal' ? 10 + s.weight * 6 : 7 + s.weight * 4);
      l.userData.flicker = s.kind !== 'crystal';
      l.userData.spot = s;
    });
  }

  /** On a seamless floor, aim the light pool at the props nearest the knight. */
  assignNearestLights() {
    const p = this.player.pos;
    const spots = this.floor.active.flatMap((r) => r.lightSpots);
    const score = (s) => Math.hypot(s.pos.x - p.x, s.pos.z - p.z) - s.weight * 3 + (s.gate ? 4 : 0);
    spots.sort((a, b) => score(a) - score(b));
    const crystalColor = this.theme.crystal;
    this.poolLights.forEach((l, i) => {
      const s = spots[i];
      if (!s) { l.userData.base = 0; return; }
      if (l.userData.spot === s) return;
      l.userData.spot = s;
      l.position.copy(s.pos);
      l.color.setHex(s.color ?? (s.kind === 'crystal' ? crystalColor : 0xff7a30));
      l.distance = s.distance ?? (s.kind === 'crystal' ? 15 : 13);
      l.userData.base = s.intensity ?? (s.kind === 'crystal' ? 10 + s.weight * 6 : 7 + s.weight * 4);
      l.userData.flicker = s.kind !== 'crystal';
      l.intensity = 0;
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

  onPlayerFell() {
    if (this.transition) return;
    this.audio.play('fall');
    this.runTransition(() => {
      const p = this.player;
      p.hp -= p.stats.maxHp * (this.theme.abyss === 'lava' ? 0.35 : 0.2);
      this.hurtFlash = 1;
      const safe = p.lastSafe ?? this.entry?.pose;
      this.placePlayer({ x: safe.x, y: safe.y, z: safe.z, yaw: p.yaw });
      if (p.hp <= 0) p.die();
    }, 0.6);
  }

  // ---- Interaction, menus, inventory ---------------------------------------

  /** The interactable the knight is looking at and close enough to use. */
  findFocus() {
    const p = this.player;
    let best = null, bestScore = Infinity;
    for (const it of this.nearbyInteractables()) {
      const pos = it.position;
      const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
      if (d > it.radius || Math.abs(pos.y - p.pos.y) > 2.2) continue;
      const off = Math.abs(angleDiff(p.yaw, yawOf(pos.x - p.pos.x, pos.z - p.pos.z)));
      if (d > 1.2 && off > 0.9) continue;
      const score = d + off * 2;
      if (score < bestScore) { best = it; bestScore = score; }
    }
    return best;
  }

  openMenu(kind) {
    this.menuOpen = true;
    this.state = 'menu';
    this.hud.setPrompt(null);
    document.exitPointerLock?.();
    this.menus.open(kind);
  }

  closeMenu() {
    this.menus.close();
    this.menuOpen = false;
    this.state = 'playing';
    this.input.clearBuffers();
    this.input.requestLock();
    this.clock.getDelta();
  }

  openClassMenu() { this.openMenu('class'); }
  openSpawnMenu() { this.openMenu('spawn'); }

  chooseClass(id) {
    this.player.setClass(id);
    this.hud.renderRelics(this.player);
    this.hud.renderLoadout(this.player);
    this.audio.play('pickup');
    this.hud.banner(CLASSES[id].name.toUpperCase(), 'floor', 2);
    this.flash = 0.4;
  }

  dropActiveWeapon() {
    const w = this.player.dropWeapon();
    if (!w) {
      this.audio.play('empty');
      return;
    }
    const p = this.player;
    const pos = p.pos.clone().addScaledVector(p.forward, 1.3);
    const g = this.room.world.groundAt(pos.x, pos.z, p.pos.y + 0.5);
    pos.y = g ?? p.pos.y;
    new WeaponDrop(this, this.room, w, pos);
    this.audio.play('swap');
    this.hud.renderLoadout(p);
  }

  onWeaponTaken(w) {
    this.audio.play('pickup-weapon');
    this.hud.toast(w.displayName, w.affix ? w.affix.desc : w.kind === 'cast' ? `${w.manaCost} mana per cast` : '', w.rarity.color);
    this.hud.renderLoadout(this.player);
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

  guardPoint() {
    const p = this.player;
    return p.eyePosition.addScaledVector(p.forward, 0.9).add(new THREE.Vector3(0, -0.25, 0));
  }

  castBolt(player, w) {
    const aim = player.aim;
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const from = player.eyePosition.addScaledVector(aim, 0.7).addScaledVector(right, 0.2).add(new THREE.Vector3(0, -0.15, 0));
    this.addBolt(new Bolt(this, from, aim, player, w.bolt.color, { damage: w.damage, speed: w.bolt.speed, burn: w.bolt.burn || w.burn, pierce: w.bolt.pierce, size: w.typeId === 'staff' ? 1.4 : 0.9 }));
    this.audio.play('cast-player');
    this.glow.burst(from, 8, () => ({ vel: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)), life: 0.25, size: 0.04, color: w.bolt.color, drag: 3 }));
  }

  /** Lantern Mage: blind, stagger and ignite everything nearby. */
  flare(player) {
    this.audio.play('flare');
    this.flash = 1;
    this.shake(0.3);
    const c = player.eyePosition;
    this.glow.burst(c, 60, () => ({
      vel: new THREE.Vector3(rand(-9, 9), rand(-3, 6), rand(-9, 9)), life: rand(0.3, 0.8), size: rand(0.05, 0.12), color: pick3(), drag: 2.5,
    }));
    for (const e of this.nearbyEnemies()) {
      if (!e.active || e.pos.distanceTo(player.pos) > 9) continue;
      e.stun(1.8);
      e.ignite(4, 6);
      e.flash = 0.2;
    }
  }

  onFlaskDrunk() {
    this.audio.play('heal');
    this.flash = 0.25;
    this.glow.burst(this.player.pos.clone().setY(this.player.pos.y + 0.8), 24, () => ({
      vel: new THREE.Vector3(rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5)), life: rand(0.6, 1.2), size: 0.05, color: 0xff4a3a, drag: 2,
    }));
  }

  onEnemyTelegraph(enemy, perilous) {
    if (perilous) {
      this.audio.play('perilous');
      this.hud.perilous();
    } else if (enemy.distToPlayer() < 14) this.audio.play('glint');
  }

  onEnemyHit(enemy, result, dir, dmg = 0) {
    const p = this.player;
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
        this.hud.damageNumber(c, 0, 'blocked');
        return;
      case 'riposte':
        this.audio.play('riposte');
        this.sparks(c, 30, 0xff5030, 7);
        this.hitstop = Math.max(this.hitstop, 0.14);
        this.shake(0.45);
        this.flash = 0.5;
        break;
      case 'bash':
        this.audio.play('hit');
        this.sparks(c, 14, 0xffc080, 5);
        this.hitstop = Math.max(this.hitstop, 0.09);
        this.shake(0.3);
        break;
      case 'spell':
        this.audio.play('hit');
        this.hitstop = Math.max(this.hitstop, 0.03);
        break;
      default:
        this.audio.play('hit');
        this.sparks(c, 10);
        this.hitstop = Math.max(this.hitstop, p.weapon.kind === 'heavy' ? 0.09 : 0.055);
        this.shake(p.weapon.kind === 'heavy' ? 0.3 : 0.15);
    }
    if (dmg > 0) this.hud.damageNumber(c, dmg, result === 'riposte' ? 'crit' : 'normal');
    const leech = p.stats.lifesteal + (result === 'spell' ? 0 : p.weapon.lifesteal || 0);
    if (leech > 0) p.hp = Math.min(p.stats.maxHp, p.hp + leech);
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
        this.audio.play(this.player.offhand === 'shield' ? 'shield-block' : 'block');
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
    if (this.mode !== 'run' || fell) return;
    // Loot: bosses always drop something good; heavier foes are likelier to.
    const odds = enemy.isBoss ? 1 : enemy.mass >= 3 ? 0.45 : 0.12;
    if (chance(odds)) {
      const pos = enemy.pos.clone();
      new WeaponDrop(this, this.room, rollWeapon(this.depth, enemy.isBoss ? 2 : 0), pos);
    }
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.audio.play('death');
    this.slowmo = 1.4;
    this.hud.hideBoss();
    if (this.mode === 'hub') {
      // Death in the sparring ground is only a lesson.
      setTimeout(() => {
        this.runTransition(() => {
          this.hub.clearEnemies();
          this.player.revive();
          this.placePlayer(this.hub.spawnPose);
          this.state = 'playing';
        }, 0.6);
      }, 1400);
      return;
    }
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
    const p = this.player;
    const S = p.stats;
    const rows = [
      ['Class', p.classDef.name],
      ['Vigor', `${Math.ceil(p.hp)} / ${S.maxHp}`],
      ['Endurance', `${S.maxStamina}`],
      ...(S.maxMana ? [['Mana', `${Math.floor(p.mana)} / ${S.maxMana}`]] : []),
      ['Weapon', p.weapon.displayName],
      ['Damage', `×${S.damageMult.toFixed(2)}`],
      ['Parry window', `${Math.round(p.parryWindow * 1000)} ms`],
      ['Riposte', `×${S.riposteMult.toFixed(1)}`],
      ['Location', this.mode === 'hub' ? this.hub.name : `Floor ${toRoman(this.depth)}`],
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

    if (this.state === 'paused' || this.state === 'menu') {
      input.endFrame();
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
      if (this.mode === 'run' && this.floor) {
        const r = this.floor.roomAt(this.player.pos.x, this.player.pos.z);
        if (r && r !== this.room) this.switchRoom(r);
        this.floor.update(dt, this.room);
        this.lightTimer -= realDt;
        if (this.lightTimer <= 0) {
          this.lightTimer = 0.35;
          this.assignNearestLights();
        }
      } else this.room.update(dt);
      this.updateInteraction();
    } else {
      this.player.updateCamera(dt, 0);
    }

    this.effects = this.effects.filter((e) => e.update(dt));
    this.bolts = this.bolts.filter((b) => b.update(dt));
    this.particles.update(dt);
    this.glow.update(dt);
    this.updateAmbience(dt, realDt);
    this.audio.update(realDt);
    if (this.state !== 'title') this.hud.update(realDt, this.player, this.camera);
    input.endFrame();
    this.render();
  }

  updateInteraction() {
    const p = this.player;
    const input = this.input;
    if (!p.alive || this.transition) {
      this.hud.setPrompt(null);
      return;
    }
    this.focus = this.findFocus();
    this.hud.setPrompt(this.focus);
    if (input.wasPressed('KeyE') && this.focus && ['idle', 'guard', 'swap'].includes(p.state)) this.focus.interact();
    if (input.wasPressed('KeyG') && ['idle', 'guard'].includes(p.state)) this.dropActiveWeapon();
    if (input.wasPressed('Tab')) this.hud.toggleInventory(p);
    this.hud.renderLoadoutIfChanged(p);
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
        vel: new THREE.Vector3(rand(-0.15, 0.15), rand(-0.05, 0.12), rand(-0.15, 0.15)), life: rand(2, 4), size: 0.03,
        color: this.mode === 'hub' ? 0x9a9480 : 0x6a7090,
      });
    }
    this.poolLights.forEach((l, i) => {
      const base = l.userData.base || 0;
      const target = base * (l.userData.flicker ? 0.8 + 0.2 * flicker(t, i * 5) : 0.85 + 0.15 * Math.sin(t * 1.3 + i * 2));
      l.intensity = damp(l.intensity, target, 6, realDt);
    });
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
    if (this.sun.castShadow) {
      // Keep the sun's shadow frustum centred near the knight.
      const cx = Math.round(p.pos.x / 8) * 8, cz = Math.round(p.pos.z / 8) * 8;
      this.sun.target.position.set(cx, 0, cz);
      this.sun.position.set(cx - 75, 95, cz + 55);
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

function pick3() {
  const r = Math.random();
  return r < 0.4 ? 0xffe0a0 : r < 0.8 ? 0xff9a40 : 0xffffff;
}

window.game = new Game();
