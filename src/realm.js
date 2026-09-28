import * as THREE from 'three';
import { rand, pick, clamp, damp, dampAngle, easeOut, easeInOut, TAU } from './util.js';
import { ARCH_STYLES } from './config.js';
import { World } from './physics.js';
import { Builder } from './architecture.js';
import { rollItems } from './items.js';
import { hex } from './weapons.js';
import { Shop, Bubble } from './shop.js';
import { createSkyDome } from './sky.js';
import * as Textures from './textures.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Where the realms are raised: far from any floor, out past the fog. */
const ORIGIN = new THREE.Vector3(6000, 0, 0);

// ============================================================================
// Portal — a dark (devil) or radiant (angel) rift you walk into.
// ============================================================================

const portalShader = {
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float time, open, dark;
    uniform vec3 colA, colB;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      float swirl = sin(a * 5.0 + r * 14.0 - time * 4.0) * 0.5 + 0.5;
      float swirl2 = sin(a * 3.0 - r * 9.0 + time * 2.3) * 0.5 + 0.5;
      float core = smoothstep(0.7, 0.0, r);
      vec3 c = mix(colA, colB, (swirl * 0.6 + swirl2 * 0.4) * (dark > 0.5 ? smoothstep(0.2, 0.95, r) : 1.0));
      // The devil's rift falls away into black at its heart; the angel's burns white.
      c = dark > 0.5 ? mix(c, vec3(0.0), core * 0.9) : mix(c, colB * 1.8, core * 0.6);
      float edge = smoothstep(1.0, 0.82, r);
      gl_FragColor = vec4(c * edge * open, edge * open);
    }
  `,
};

export class DealPortal {
  constructor(game, area, kind, x, y, z, facing, { isReturn = false } = {}) {
    this.game = game;
    this.area = area;
    this.kind = kind;
    this.isReturn = isReturn;
    this.used = false;
    this.t = 0;
    this.openK = 0;
    this.facing = facing;
    this.normal = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const devil = kind === 'devil';
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = facing;
    const M = game.materials;
    this.uniforms = {
      time: { value: 0 }, open: { value: 0 }, dark: { value: devil ? 1 : 0 },
      colA: { value: new THREE.Color(devil ? 0x1a0006 : 0xffe8a0) },
      colB: { value: new THREE.Color(devil ? 0xff1a10 : 0xffffff) },
    };
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1.9, 40), new THREE.ShaderMaterial({
      ...portalShader, uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: devil ? THREE.NormalBlending : THREE.AdditiveBlending,
    }));
    this.disc.position.y = 2.3;
    this.disc.scale.y = 1.25;
    this.group.add(this.disc);
    // The frame: black thorns for the devil, a gilded arch for the angel.
    const frameMat = devil ? M.iron : M.gold;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const r = 2.05;
      const m = new THREE.Mesh(devil ? new THREE.ConeGeometry(0.12, rand(0.5, 1.1), 4) : new THREE.BoxGeometry(0.22, 0.34, 0.22), frameMat);
      m.position.set(Math.cos(a) * r, 2.3 + Math.sin(a) * r * 1.25, 0);
      m.rotation.z = a - Math.PI / 2;
      this.group.add(m);
    }
    if (!devil) {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 5, 24), M.gold);
      halo.position.y = 5.3;
      this.group.add(halo);
      this.halo = halo;
    }
    (area.actors || area.group).add(this.group);
    this.color = devil ? [0xff2010, 0x600000, 0x200000] : [0xfff0c0, 0xffffff, 0xffe080];
    area.lightSpots?.push({ kind: 'warm', color: devil ? 0xff2010 : 0xfff0c0, pos: new THREE.Vector3(x, y + 2.3, z).addScaledVector(this.normal, 1), weight: 5, intensity: 10, distance: 10, portal: true });
    game.audio.play(devil ? 'devil' : 'angel');
  }

  get center() { return this.group.position.clone().setY(this.group.position.y + 2.3); }

  update(dt) {
    this.t += dt;
    this.openK = Math.min(1, this.openK + dt * (this.used ? -1.5 : 0.8));
    if (this.used) this.openK = Math.max(0, this.openK - dt * 2);
    this.uniforms.time.value = this.t;
    this.uniforms.open.value = easeOut(Math.max(0, this.openK));
    this.disc.scale.set(Math.max(0.01, this.openK), Math.max(0.01, this.openK) * 1.25, 1);
    if (this.halo) this.halo.rotation.y += dt;
    const game = this.game;
    const c = this.center;
    if (this.openK > 0.2 && Math.random() < dt * 30) {
      // Motes spiral inward.
      const a = rand(0, TAU), r = rand(2.2, 3.4);
      const lat = new THREE.Vector3(this.normal.z, 0, -this.normal.x);
      const p = c.clone().addScaledVector(lat, Math.cos(a) * r).add(_v.set(0, Math.sin(a) * r * 1.2, 0)).addScaledVector(this.normal, rand(-0.5, 0.5));
      game.glow.emit({ pos: p, vel: c.clone().sub(p).multiplyScalar(1.4), life: 0.6, size: rand(0.04, 0.08), color: pick(this.color) });
    }
    if (this.used || this.openK < 0.9 || game.transition || game.cutscene) return;
    const pl = game.player;
    const d = _v.copy(pl.pos).sub(this.group.position);
    const along = d.dot(this.normal);
    const lat = Math.abs(d.x * this.normal.z - d.z * this.normal.x);
    if (pl.alive && Math.abs(along) < 0.8 && lat < 1.5 && Math.abs(pl.pos.y - this.group.position.y) < 1.5) {
      this.used = true;
      game.enterPortal(this);
    }
  }

  dispose() { this.group.parent?.remove(this.group); }
}

// ============================================================================
// Shared puppetry for the realm's traders.
// ============================================================================

function makeArm(parent, mat, clawMat, { x, y, upper = 0.9, fore = 0.85, thick = 0.14, fingers = 3, fingerLen = 0.22 }) {
  const shoulder = new THREE.Group();
  shoulder.position.set(x, y, 0);
  parent.add(shoulder);
  const up = new THREE.Mesh(new THREE.BoxGeometry(thick, upper, thick), mat);
  up.position.y = -upper / 2;
  shoulder.add(up);
  const elbow = new THREE.Group();
  elbow.position.y = -upper;
  shoulder.add(elbow);
  const lo = new THREE.Mesh(new THREE.BoxGeometry(thick * 0.8, fore, thick * 0.8), mat);
  lo.position.y = -fore / 2;
  elbow.add(lo);
  const hand = new THREE.Group();
  hand.position.y = -fore;
  elbow.add(hand);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(thick * 1.1, 0.14, thick * 0.6), mat);
  palm.position.y = -0.06;
  hand.add(palm);
  const digits = [];
  for (let i = 0; i < fingers; i++) {
    const f = new THREE.Group();
    f.position.set((i - (fingers - 1) / 2) * thick * 0.4, -0.13, 0);
    hand.add(f);
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.025, fingerLen, 4), clawMat);
    m.position.y = -fingerLen / 2;
    m.rotation.x = Math.PI;
    f.add(m);
    digits.push(f);
  }
  return { shoulder, elbow, hand, digits, dir: new THREE.Vector3(0, -1, 0.2).normalize(), bend: 0.3, grip: 0.3, x };
}

function poseArm(arm, dir, bend, grip, rate, dt) {
  arm.dir.lerp(dir, 1 - Math.exp(-rate * dt)).normalize();
  _q.setFromUnitVectors(DOWN, arm.dir);
  arm.shoulder.quaternion.slerp(_q, 1 - Math.exp(-rate * dt));
  arm.bend = damp(arm.bend, bend, rate, dt);
  arm.elbow.rotation.x = -arm.bend;
  arm.grip = damp(arm.grip, grip, rate, dt);
  arm.digits.forEach((f, i) => { f.rotation.x = arm.grip * (1 + i * 0.2); });
}

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

/** Base for the realm NPCs: mood, speech, look-at and point-at, as the shop expects. */
class RealmNPC {
  constructor(game, realm, pos, facing, name, theme, lines) {
    this.game = game;
    this.realm = realm;
    this.lines = lines;
    this.bubble = new Bubble(name, theme);
    this.name = name;
    this.mood = 'idle';
    this.moodT = 0;
    this.t = 0;
    this.lookTarget = null;
    this.pointTarget = null;
    this.intro = 1;
    this.facing = facing;
    this.yaw = facing;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.base = pos.clone();
    this.body = new THREE.Group();
    this.group.add(this.body);
    realm.group.add(this.group);
    this.radius = 7;
    realm.interactables.push(this);
    realm.world.addCircle(pos.x, pos.z, 1.2, pos.y - 1, pos.y + 4);
  }

  get position() { return this.group.position; }
  get prompt() { return this.realm.kind === 'devil' ? 'Bargain with Malphas' : 'Kneel before Seraphine'; }
  get sub() { return this.realm.kind === 'devil' ? 'Power, paid for in maximum vigor' : 'One gift, freely given'; }
  get promptColor() { return this.realm.kind === 'devil' ? '#ff5a3a' : '#fff0c0'; }
  interact() { this.game.openShop(this.realm.shop); }

  say(key, text = null) {
    const l = this.lines[key];
    this.bubble.say(text ?? (Array.isArray(l) ? pick(l) : l), this.game);
  }

  setMood(m) { this.mood = m; this.moodT = 0; }
  headWorld() { return this.head.getWorldPosition(new THREE.Vector3()).add(_v.set(0, 0.8, 0)); }

  localDir(world, shoulder) {
    const p = this.torso.worldToLocal(world.clone());
    return p.sub(shoulder.position).normalize();
  }

  /** Head turns towards what matters: a ware, or the customer. */
  track(dt) {
    const look = this.lookTarget ?? this.game.player.eyePosition;
    const lp = this.torso.worldToLocal(look.clone()).sub(this.head.position);
    let hy = clamp(Math.atan2(lp.x, lp.z), -1, 1);
    const hx = clamp(-Math.atan2(lp.y, Math.hypot(lp.x, lp.z)), -0.6, 0.6);
    if (this.mood === 'refuse') hy += Math.sin(this.moodT * 14) * 0.35 * Math.max(0, 1 - this.moodT);
    this.head.rotation.y = dampAngle(this.head.rotation.y, hy, 5, dt);
    this.head.rotation.x = damp(this.head.rotation.x, hx + (this.mood === 'delight' ? -0.45 * Math.max(0, 1 - this.moodT) : 0), 5, dt);
  }

  update(dt, open) {
    this.t += dt;
    this.moodT += dt;
    if (this.mood !== 'idle' && this.mood !== 'point' && this.moodT > 1.6) this.setMood(open && this.pointTarget ? 'point' : 'idle');
    const pl = this.game.player;
    const pd = Math.hypot(pl.pos.x - this.base.x, pl.pos.z - this.base.z);
    if (!this.greeted && this.intro >= 1 && pd < 9) {
      this.greeted = true;
      this.say('greet');
      this.setMood('greet');
    }
    this.animate(dt, open);
    this.bubble.update(dt, this.headWorld(), this.game.camera, pd < 20 || open);
  }
}

// ============================================================================
// Malphas, the Horned Broker — a towering goat-skulled devil who deals in flesh.
// ============================================================================

const BROKER_LINES = {
  greet: ['Ahh. A little flame, come to bargain in the dark.', 'Sit. Stand. Kneel, if you like. It changes nothing.', 'Every hero finds me eventually.'],
  open: ['Look closely. Everything here costs exactly what it is worth.', 'Power, child. Paid for in the only coin that matters.'],
  buy: ['Hhhahaha! It is done.', 'Signed in blood. The best ink.', 'A fine trade. For me.'],
  poor: ['You have not enough flesh left to sell.', 'Too little of you remains. Come back... bigger.'],
  sold: ['That pact is sealed. No refunds.'],
  leave: ['Go. We will meet again. We always do.', 'Walk carefully. You are lighter now.'],
};

export class Broker extends RealmNPC {
  constructor(game, realm, pos, facing) {
    super(game, realm, pos, facing, 'Malphas, the Horned Broker', 'devil', BROKER_LINES);
    this.voice = 'broker';
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true, ...o });
    const skin = mat(0x5a2826, { emissive: 0x1a0404 }), robe = mat(0x1a0c0c), bone = mat(0xe8dcc0, { emissive: 0x2a1a10 }), horn = mat(0x3a2a24, { roughness: 0.4 });
    const eye = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
    const claw = mat(0xe8dcc0);
    const chain = game.materials.iron;
    this.eyeMat = eye;
    const add = (p, geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
    const B = this.body;
    // Robe falling from the waist to the ground, torn at the hem.
    add(B, new THREE.CylinderGeometry(0.7, 1.2, 2.1, 8, 1, true), robe, 0, 1.05, 0).material.side = THREE.DoubleSide;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      add(B, new THREE.BoxGeometry(0.25, rand(0.3, 0.7), 0.03), robe, Math.cos(a) * 1.18, -0.05, Math.sin(a) * 1.18).rotation.y = -a;
    }
    this.torso = new THREE.Group();
    this.torso.position.y = 2.1;
    this.torso.rotation.x = 0.12;
    B.add(this.torso);
    this.chest = add(this.torso, new THREE.BoxGeometry(1.3, 1.1, 0.8), skin, 0, 0.55, 0);
    for (let i = 0; i < 4; i++) add(this.torso, new THREE.BoxGeometry(1.0 - i * 0.12, 0.06, 0.05), bone, 0, 0.3 + i * 0.18, 0.42);
    for (const s of [-1, 1]) {
      add(this.torso, new THREE.BoxGeometry(0.55, 0.3, 0.7), skin, s * 0.8, 1.05, 0);
      for (let i = 0; i < 3; i++) add(this.torso, new THREE.ConeGeometry(0.07, 0.4, 4), bone, s * (0.7 + i * 0.15), 1.35, -0.1).rotation.z = -s * 0.3;
    }
    // A goat's skull, and horns that curl back and out.
    this.head = new THREE.Group();
    this.head.position.set(0, 1.35, 0.1);
    this.torso.add(this.head);
    add(this.head, new THREE.BoxGeometry(0.46, 0.5, 0.5), bone, 0, 0.3, 0);
    add(this.head, new THREE.BoxGeometry(0.3, 0.26, 0.45), bone, 0, 0.18, 0.4);
    this.jaw = add(this.head, new THREE.BoxGeometry(0.26, 0.08, 0.4), bone, 0, 0.02, 0.36);
    for (const s of [-1, 1]) {
      add(this.head, new THREE.BoxGeometry(0.11, 0.07, 0.05), eye, s * 0.12, 0.36, 0.26);
      let p = this.head, px = s * 0.2, py = 0.55;
      for (let i = 0; i < 6; i++) {
        const seg = new THREE.Group();
        seg.position.set(i === 0 ? px : 0, i === 0 ? py : 0.26, 0);
        seg.rotation.set(-0.35, 0, -s * (0.35 + i * 0.12));
        p.add(seg);
        add(seg, new THREE.ConeGeometry(0.12 - i * 0.015, 0.32, 5), horn, 0, 0.14, 0);
        p = seg;
      }
    }
    // Long arms, clawed, wrapped in chain.
    this.armR = makeArm(this.torso, skin, claw, { x: 0.95, y: 1.0, upper: 1.0, fore: 0.95, thick: 0.2, fingers: 4, fingerLen: 0.3 });
    this.armL = makeArm(this.torso, skin, claw, { x: -0.95, y: 1.0, upper: 1.0, fore: 0.95, thick: 0.2, fingers: 4, fingerLen: 0.3 });
    for (const a of [this.armR, this.armL]) for (let i = 0; i < 3; i++) add(a.elbow, new THREE.TorusGeometry(0.14, 0.03, 4, 8), chain, 0, -0.2 - i * 0.12, 0).rotation.x = Math.PI / 2;
    // A tail sweeping behind.
    this.tail = [];
    let tp = B;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.6 : 0, i === 0 ? -0.9 : -0.35);
      tp.add(seg);
      add(seg, new THREE.BoxGeometry(0.16 - i * 0.02, 0.16 - i * 0.02, 0.4), skin, 0, 0, -0.18);
      this.tail.push(seg);
      tp = seg;
    }
    add(tp, new THREE.ConeGeometry(0.12, 0.3, 4), bone, 0, 0, -0.45).rotation.x = -Math.PI / 2;
    this.group.rotation.y = facing;
  }

  animate(dt, open) {
    const t = this.t, m = this.mood, mt = this.moodT;
    // Rising from the pool of fire during the arrival.
    this.body.position.y = -4.2 * (1 - easeOut(this.intro));
    const breathe = Math.sin(t * 1.4) * 0.03;
    this.chest.scale.set(1 + breathe, 1 + breathe * 0.5, 1 + breathe);
    this.torso.rotation.z = Math.sin(t * 0.7) * 0.03 + (m === 'delight' ? Math.sin(mt * 30) * 0.04 * Math.max(0, 1 - mt) : 0);
    this.torso.rotation.x = 0.12 + (m === 'bow' ? Math.sin(Math.min(1, mt / 0.7) * Math.PI) * 0.35 : 0);
    this.tail.forEach((s, i) => { s.rotation.y = Math.sin(t * 1.3 - i * 0.6) * 0.3; s.rotation.x = 0.15 + Math.sin(t * 0.9 - i) * 0.08; });
    this.jaw.position.y = 0.02 - (this.bubble.talking ? Math.abs(Math.sin(t * 16)) * 0.06 : 0) - (m === 'delight' ? 0.08 : 0);
    this.eyeMat.color.setHex(m === 'refuse' ? 0xff6a10 : m === 'delight' ? 0xffc040 : 0xff2a10);
    this.track(dt);
    const [R, L] = [this.armR, this.armL];
    switch (m) {
      case 'greet':
        poseArm(R, V(0.9, 0.35, 0.4), 0.4, 0.1, 8, dt);
        poseArm(L, V(-0.9, 0.35, 0.4), 0.4, 0.1, 8, dt);
        break;
      case 'delight': {
        poseArm(R, V(0.5, -0.4, 0.8), 1.4, 0.8, 10, dt);
        poseArm(L, V(-0.5, -0.4, 0.8), 1.4, 0.8, 10, dt);
        break;
      }
      case 'refuse':
        poseArm(R, V(0.3, 0.2, 1), 1.5 + Math.sin(mt * 16) * 0.3, 0.2, 10, dt);
        poseArm(L, V(-0.3, -0.8, 0.3), 0.8, 0.8, 6, dt);
        break;
      default:
        if (this.pointTarget && open) {
          poseArm(R, this.localDir(this.pointTarget, R.shoulder), 0.15, 0.2, 7, dt);
        } else {
          // Claws steepled before the chest, tapping.
          poseArm(R, V(-0.3, -0.4, 1), 1.9, 0.6 + Math.sin(t * 5) * 0.2, 5, dt);
        }
        poseArm(L, V(0.3, -0.4, 1), 1.9, 0.6 + Math.sin(t * 5 + 1) * 0.2, 5, dt);
    }
    if (Math.random() < dt * 14) {
      const p = this.group.position;
      this.game.glow.emit({
        pos: new THREE.Vector3(p.x + rand(-1.2, 1.2), p.y + rand(0, 1), p.z + rand(-1.2, 1.2)),
        vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.8, 2), rand(-0.2, 0.2)), life: rand(0.6, 1.3), size: rand(0.04, 0.08), color: pick([0xff3010, 0xff7020]),
      });
    }
  }
}

// ============================================================================
// Seraphine of the Last Dawn — a many-winged, faceless saint who gives freely.
// ============================================================================

const SERAPH_LINES = {
  greet: ['Peace, little flame. You have walked far in the dark.', 'Do not be afraid. Not of me.', 'I have watched you. I am glad you came.'],
  open: ['Take one. Only one. The rest belong to others who will need them.', 'Choose with your heart, not your hunger.'],
  buy: ['Go with it, and be kind to yourself.', 'It was always meant for you.', 'May it keep you where I cannot.'],
  poor: ['...'],
  sold: ['That gift has found its keeper.', 'It faded, as the others do.'],
  leave: ['The light will remember you.', 'Go now. Dawn is waiting.'],
};

export class Seraph extends RealmNPC {
  constructor(game, realm, pos, facing) {
    super(game, realm, pos, facing, 'Seraphine of the Last Dawn', 'angel', SERAPH_LINES);
    this.voice = 'seraph';
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, flatShading: true, ...o });
    // Warm parchment and gold rather than pure white, so she reads against a bright sky.
    const robe = mat(0xcab88e), gold = game.materials.gold;
    const skin = mat(0xd8c4a0), feather = mat(0xf0e6d0, { emissive: 0x2a2210 });
    const featherTip = mat(0xa89468);
    const glow = new THREE.MeshBasicMaterial({ color: 0xfff4c0 });
    const add = (p, geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
    const B = this.body;
    add(B, new THREE.ConeGeometry(0.8, 2.4, 9, 1, true), robe, 0, 1.2, 0).material.side = THREE.DoubleSide;
    this.hem = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const piv = new THREE.Group();
      piv.position.set(Math.cos(a) * 0.78, 0.05, Math.sin(a) * 0.78);
      piv.rotation.y = -a;
      add(piv, new THREE.BoxGeometry(0.2, rand(0.5, 1.1), 0.02), robe, 0, -0.35, 0);
      B.add(piv);
      this.hem.push(piv);
    }
    add(B, new THREE.CylinderGeometry(0.82, 0.82, 0.06, 9, 1, true), gold, 0, 0.05, 0);
    this.torso = new THREE.Group();
    this.torso.position.y = 2.3;
    B.add(this.torso);
    add(this.torso, new THREE.CylinderGeometry(0.3, 0.42, 0.8, 8), robe, 0, 0.35, 0);
    add(this.torso, new THREE.CylinderGeometry(0.45, 0.45, 0.06, 8, 1, true), gold, 0, 0.7, 0);
    // A smooth gold mask with one line of light where a face would be.
    this.head = new THREE.Group();
    this.head.position.set(0, 0.95, 0);
    this.torso.add(this.head);
    add(this.head, new THREE.SphereGeometry(0.26, 10, 8), gold, 0, 0.15, 0).scale.set(0.85, 1.1, 0.9);
    this.eyeLine = add(this.head, new THREE.BoxGeometry(0.3, 0.035, 0.05), glow, 0, 0.18, 0.22);
    add(this.head, new THREE.ConeGeometry(0.2, 0.4, 8, 1, true), robe, 0, 0.25, -0.08).rotation.x = -0.3;
    this.halos = [0.42, 0.6].map((r, i) => add(this.torso, new THREE.TorusGeometry(r, 0.025, 4, 32), glow, 0, 1.55 + i * 0.12, -0.15));
    this.armR = makeArm(this.torso, skin, skin, { x: 0.45, y: 0.6, upper: 0.55, fore: 0.5, thick: 0.1, fingers: 3, fingerLen: 0.14 });
    this.armL = makeArm(this.torso, skin, skin, { x: -0.45, y: 0.6, upper: 0.55, fore: 0.5, thick: 0.1, fingers: 3, fingerLen: 0.14 });
    // Three pairs of wings: great, middle and small, each a fan of long feathers.
    this.wings = [];
    for (let pair = 0; pair < 3; pair++) {
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(s * 0.2, 0.75 - pair * 0.3, -0.25);
        this.torso.add(w);
        const len = [2.2, 1.6, 1.1][pair];
        // Feathers fan out from the wing root: each on its own pivot, from raised to drooping.
        for (let f = 0; f < 7; f++) {
          const fl = len * (1 - f * 0.08);
          const piv = new THREE.Group();
          piv.rotation.z = s * (0.9 - f * 0.28) * (pair === 1 ? 0.7 : 1);
          piv.position.z = -f * 0.012;
          w.add(piv);
          add(piv, new THREE.BoxGeometry(fl, 0.13, 0.03), f % 2 ? featherTip : feather, s * fl / 2, 0, 0);
          add(piv, new THREE.BoxGeometry(0.25, 0.14, 0.04), gold, s * (fl - 0.12), 0, 0);
        }
        this.wings.push({ g: w, side: s, pair });
      }
    }
    this.group.rotation.y = facing;
  }

  animate(dt, open) {
    const t = this.t, m = this.mood, mt = this.moodT;
    // Descending from the light during the arrival, then hovering.
    this.body.position.y = 0.7 + Math.sin(t * 1.3) * 0.12 + 14 * (1 - easeOut(this.intro));
    this.hem.forEach((h, i) => { h.rotation.x = Math.sin(t * 2 + i) * 0.12; });
    const beat = m === 'delight' ? Math.sin(mt * 12) * 0.5 : Math.sin(t * 1.4) * 0.18;
    for (const w of this.wings) {
      w.g.rotation.y = w.side * (-0.35 + w.pair * 0.12 + beat * (1 - w.pair * 0.25));
      w.g.rotation.z = w.side * (0.1 + Math.sin(t * 1.4 + w.pair) * 0.05);
    }
    this.halos[0].rotation.z += dt * 0.6;
    this.halos[1].rotation.z -= dt * 0.4;
    this.eyeLine.scale.x = this.bubble.talking ? 1 + Math.abs(Math.sin(t * 14)) * 0.4 : 1;
    this.torso.rotation.x = m === 'bow' ? Math.sin(Math.min(1, mt / 0.8) * Math.PI) * 0.4 : Math.sin(t * 0.8) * 0.04;
    this.track(dt);
    const [R, L] = [this.armR, this.armL];
    switch (m) {
      case 'greet':
        poseArm(R, V(0.7, 0.2, 0.7), 0.2, 0, 6, dt);
        poseArm(L, V(-0.7, 0.2, 0.7), 0.2, 0, 6, dt);
        break;
      case 'delight':
        poseArm(R, V(0.4, 1, 0.3), 0.2, 0, 8, dt);
        poseArm(L, V(-0.4, 1, 0.3), 0.2, 0, 8, dt);
        break;
      default:
        if (this.pointTarget && open) poseArm(R, this.localDir(this.pointTarget, R.shoulder), 0.1, 0, 6, dt);
        else poseArm(R, V(0.2, -0.5, 0.8), 1.4, 0.4, 4, dt);
        poseArm(L, V(-0.2, -0.5, 0.8), 1.4, 0.4, 4, dt);
    }
    if (Math.random() < dt * 10) {
      const p = this.group.position;
      this.game.glow.emit({
        pos: new THREE.Vector3(p.x + rand(-2, 2), p.y + this.body.position.y + rand(1, 3.5), p.z + rand(-1, 1)),
        vel: new THREE.Vector3(rand(-0.2, 0.2), rand(-0.6, -0.2), rand(-0.2, 0.2)), life: rand(1.5, 3), size: rand(0.04, 0.07), color: pick([0xfff4d0, 0xffffff]),
      });
    }
  }
}

// ============================================================================
// The realm — a place apart, reached only through a portal.
// ============================================================================

export class DealRealm {
  constructor(game, kind) {
    this.game = game;
    this.kind = kind;
    this.type = 'realm';
    this.name = kind === 'devil' ? 'The Pit of Pacts' : 'The Last Dawn';
    this.enemies = [];
    this.loot = [];
    this.interactables = [];
    this.lightSpots = [];
    this.emitters = [];
    this.neighbors = {};
    this.pedestal = null;
    this.t = 0;
    this.world = new World();
    this.group = new THREE.Group();
    this.actors = this.group;
    game.scene.add(this.group);
    const O = ORIGIN;
    this.center = { x: O.x, y: 0, z: O.z };
    this.floor = { biome: { id: 'crystal' }, style: kind === 'devil' ? ARCH_STYLES.gothic : ARCH_STYLES.imperial };
    this.build();
    this.spawnPose = { x: O.x, y: 0, z: O.z + 7, yaw: 0 };
  }

  build() {
    const game = this.game, O = ORIGIN, devil = this.kind === 'devil';
    const b = new Builder(game, this);
    // The dais: a broad disc, stairs down to a lower ring, the trader's apse at the back.
    b.disc(O.x, O.z, 12, 0, { segments: 28, depth: devil ? 60 : 18 });
    b.platform(O.x, O.z - 12.5, 9, 6, 0.9, { tag: 'hub', depth: devil ? 60 : 16 });
    b.stairs(O.x, O.z - 8.6, O.x, O.z - 9.9, 0, 0.9, 5, { support: false });
    const M = b.M;
    if (devil) {
      // Black spires out of the lava sea, like the fortress under the blood moon.
      for (let i = 0; i < 26; i++) {
        const a = rand(0, TAU), r = rand(24, 75);
        b.tower(O.x + Math.cos(a) * r, O.z + Math.sin(a) * r, -40, rand(-4, 38), rand(2.5, 7), { windowChance: 0.12, roof: 'spire' });
      }
      for (let i = 0; i < 14; i++) {
        const a = rand(0, TAU), r = rand(16, 40);
        b.stalagmite(O.x + Math.cos(a) * r, O.z + Math.sin(a) * r, -9, rand(6, 16));
      }
      // Lava falls pouring off the far cliffs.
      for (let i = 0; i < 6; i++) {
        const a = rand(0, TAU), r = rand(30, 60);
        b.add(new THREE.BoxGeometry(rand(1, 3), 50, 0.6), game.materials.lava, composeLocal(O.x + Math.cos(a) * r, -12, O.z + Math.sin(a) * r, rand(0, TAU)), { cast: false, receive: false });
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        const x = O.x + Math.cos(a) * 10.4, z = O.z + Math.sin(a) * 10.4;
        if ((Math.abs(x - O.x) < 2.5 && z > O.z) || (Math.abs(x - O.x) < 5 && z < O.z - 6)) continue;
        i % 2 ? b.brazier(x, z, 0) : b.pillar(x, z, 0, rand(7, 11));
        b.chain(x, z, 20, rand(6, 12));
      }
      for (let i = 0; i < 18; i++) b.lavaCrack(O.x + rand(-9, 9), O.z + rand(-9, 9), 0);
      // A pool of fire where the Broker rises.
      b.add(new THREE.CylinderGeometry(1.9, 1.9, 0.05, 16), game.materials.bloodGlow, composeLocal(O.x, 0.92, O.z - 12.5, 0), { cast: false, receive: false });
      b.emitters.push({ kind: 'fire', pos: new THREE.Vector3(O.x, 1, O.z - 12.5), spread: 1.6, color: 'blood', rate: 30 });
      b.lightSpots.push({ kind: 'warm', color: 0xff2010, pos: new THREE.Vector3(O.x, 3.5, O.z - 11.5), weight: 8, intensity: 18, distance: 16 });
      b.lightSpots.push({ kind: 'warm', color: 0xff4020, pos: new THREE.Vector3(O.x, 3, O.z + 4), weight: 5, intensity: 8, distance: 14 });
      const tex = Textures.lava();
      tex.repeat.set(40, 40);
      this.surface = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }));
      this.surface.position.set(O.x, -10, O.z);
      this.group.add(this.surface);
      this.sky = createSkyDome({
        sunDir: new THREE.Vector3(-0.35, 0.3, -1), bright: 1,
        horizon: 0x3a1418, zenith: 0x120608, cloudDark: 0x1a0a0c, cloudLight: 0x4a2226, moon: 0.985, moonColor: 0xe0303a,
      });
    } else {
      // White colonnades above a sea of cloud, gold light pouring through.
      let prev = null, first = null;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const x = O.x + Math.cos(a) * 10.6, z = O.z + Math.sin(a) * 10.6;
        // Leave the way home and the view of the Seraph open.
        if ((Math.abs(x - O.x) < 2.6 && z > O.z) || (Math.abs(x - O.x) < 5 && z < O.z - 6)) { prev = null; continue; }
        b.pillar(x, z, 0, 9, { r: 0.5 });
        if (prev) b.arcade(prev[0], prev[1], x, z, 5.4, 3.6, 0.6);
        prev = [x, z];
        first ||= [x, z];
      }
      for (let i = 0; i < 16; i++) {
        const a = rand(0, TAU), r = rand(28, 80);
        const x = O.x + Math.cos(a) * r, z = O.z + Math.sin(a) * r;
        const y = rand(-14, 8);
        b.disc(x, z, rand(3, 7), y, { depth: rand(6, 14), parapet: false, tag: 'far' });
        if (Math.random() < 0.6) b.tree(x, z, y, rand(1, 1.6), false);
        if (Math.random() < 0.4) b.tower(x + 2, z, y - 8, y + rand(6, 16), rand(2.5, 4), { windowChance: 0.2, roof: 'dome' });
      }
      for (let i = 0; i < 5; i++) b.lightShaft(O.x + rand(-9, 9), O.z + rand(-9, 9), 0, rand(1, 1.8));
      b.add(new THREE.CylinderGeometry(1.4, 1.6, 0.6, 12), M.trim, composeLocal(O.x, 1.2, O.z - 12.5, 0));
      b.add(new THREE.CylinderGeometry(1.2, 1.2, 0.05, 12), game.materials.crystal, composeLocal(O.x, 1.52, O.z - 12.5, 0), { cast: false });
      b.lightSpots.push({ kind: 'warm', color: 0xfff0c0, pos: new THREE.Vector3(O.x, 5, O.z - 11), weight: 8, intensity: 16, distance: 18 });
      b.lightSpots.push({ kind: 'warm', color: 0xffe0a0, pos: new THREE.Vector3(O.x, 4, O.z + 4), weight: 5, intensity: 8, distance: 14 });
      this.sky = createSkyDome({
        sunDir: new THREE.Vector3(0.1, 0.45, -1), bright: 0.95,
        horizon: 0xe4c8a0, zenith: 0x6a8ab8, cloudDark: 0xd8c8b0, cloudLight: 0xfff6e8, sunColor: 0xfff0c0,
      });
    }
    this.group.add(this.sky);
    b.finish(this.group);
    this.emitters = b.emitters;
    this.lightSpots.push(...b.lightSpots);
    this.flames = b.flames;

    // The trader, their wares, and the way home.
    const npcPos = new THREE.Vector3(O.x, 0.9, O.z - 12.2);
    const NPC = devil ? Broker : Seraph;
    const items = rollItems(game.player, this.kind, this.kind === 'devil' ? 4 : 3);
    const specs = items.map((item) => ({
      kind: 'item', item, name: item.name, desc: item.desc, lore: item.lore, color: hex(item.color),
      price: devil ? item.devilCost : 0,
    }));
    this.shop = new Shop(game, this, npcPos.x, 0, npcPos.z, 0, {
      mode: devil ? 'vigor' : 'gift',
      title: devil ? 'A Pact in Blood' : 'Gifts of the Last Dawn',
      subtitle: devil ? 'Malphas trades in flesh, not coin' : 'Seraphine offers grace — take only one',
      theme: devil ? 'devil' : 'angel',
      stand: devil ? 'obsidian' : 'marble',
      ringColor: devil ? 0xff3020 : 0xfff0c0,
      npc: (shop) => (this.npc = new NPC(game, this, npcPos, 0)),
      specs, radius: 5.4, spread: 1.1,
      cam: { dist: 11.5, side: 2.4, height: 3.2, lookFwd: 3.6, lookSide: 3.4, lookHeight: 2.2 },
    });
    this.exitPortal = new DealPortal(game, this, this.kind, O.x, 0, O.z + 10.2, Math.PI, { isReturn: true });
    this.exitPortal.openK = 1;
  }

  update(dt) {
    this.t += dt;
    const cam = this.game.camera.position;
    this.sky.position.set(cam.x, 0, cam.z);
    this.sky.material.uniforms.time.value = this.t;
    if (this.surface) this.surface.material.map.offset.x = (this.surface.material.map.offset.x + dt * 0.004) % 1;
    this.shop.tick(dt);
    this.exitPortal.update(dt);
    for (const l of this.loot) l.update(dt);
    const glow = this.game.glow;
    for (const em of this.emitters) {
      if (em.kind === 'fire' && Math.random() < dt * (em.rate ?? 22)) {
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + rand(-em.spread, em.spread), em.pos.y, em.pos.z + rand(-em.spread, em.spread)),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.2, 2.6), rand(-0.3, 0.3)), life: rand(0.4, 0.9), size: rand(0.05, 0.12),
          color: em.color === 'blood' ? pick([0xff2010, 0xc00808, 0xff5030]) : pick([0xff8a2a, 0xffb040, 0xff5a1a]),
        });
      } else if (em.kind === 'motes' && Math.random() < dt * 8) {
        glow.emit({
          pos: new THREE.Vector3(em.pos.x + rand(-em.spread, em.spread), em.pos.y + rand(0.5, 6), em.pos.z + rand(-em.spread, em.spread)),
          vel: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.2, 0.05), rand(-0.1, 0.1)), life: rand(2, 4), size: 0.03, color: 0xfff0c0,
        });
      }
    }
    // Drifting ash (devil) or feathers of light (angel) all around.
    if (Math.random() < dt * 25) {
      const p = this.game.player.pos;
      const devil = this.kind === 'devil';
      glow.emit({
        pos: new THREE.Vector3(p.x + rand(-12, 12), p.y + rand(2, 9), p.z + rand(-12, 12)),
        vel: new THREE.Vector3(rand(-0.3, 0.3), devil ? rand(0.2, 0.8) : rand(-0.5, -0.1), rand(-0.3, 0.3)), life: rand(2, 4), size: rand(0.03, 0.06),
        color: devil ? pick([0xff3010, 0x401010]) : pick([0xfff4d0, 0xffffff]),
      });
    }
  }


  /** The arrival: an establishing sweep, the trader's entrance, then back to the knight's eyes. */
  arrivalScript() {
    const O = ORIGIN, devil = this.kind === 'devil';
    const npc = this.npc;
    npc.intro = 0;
    const V3 = (x, y, z) => new THREE.Vector3(O.x + x, y, O.z + z);
    return {
      duration: 6.2,
      caption: { at: 2.4, title: npc.name.toUpperCase(), sub: devil ? 'A pact is offered' : 'Grace is offered', theme: this.kind },
      shots: devil ? [
        { t0: 0, t1: 2.2, from: { pos: V3(-22, 16, 24), look: V3(0, 2, -6) }, to: { pos: V3(-12, 9, 14), look: V3(0, 2, -10) } },
        { t0: 2.2, t1: 4.6, from: { pos: V3(3.2, 2.4, -5.6), look: V3(0, 4.4, -12.2) }, to: { pos: V3(1.6, 3.4, -6.8), look: V3(0, 5.0, -12.2) } },
        { t0: 4.6, t1: 6.2, from: { pos: V3(1.6, 3.4, -6.8), look: V3(0, 5.0, -12.2) }, to: 'player' },
      ] : [
        { t0: 0, t1: 2.2, from: { pos: V3(0, 26, 20), look: V3(0, 0, -4) }, to: { pos: V3(10, 12, 12), look: V3(0, 3, -10) } },
        { t0: 2.2, t1: 4.6, from: { pos: V3(-2.8, 2.0, -6.8), look: V3(0, 4.4, -12.2) }, to: { pos: V3(-1.2, 2.6, -8.2), look: V3(0, 4.2, -12.2) } },
        { t0: 4.6, t1: 6.2, from: { pos: V3(-1.2, 2.6, -8.2), look: V3(0, 4.2, -12.2) }, to: 'player' },
      ],
      events: [
        { t: 0.8, fn: (game) => { game.audio.play(devil ? 'devil' : 'angel'); } },
        { t: 1.4, run: (game, t) => { npc.intro = clamp((t - 1.4) / 2.2, 0, 1); }, until: 3.6 },
        {
          t: 1.5, fn: (game) => {
            game.shake(devil ? 0.6 : 0.2);
            const c = V3(0, 1, -12.2);
            game.glow.burst(c, 90, () => ({
              vel: new THREE.Vector3(rand(-4, 4), rand(2, devil ? 9 : 3), rand(-4, 4)), life: rand(0.6, 1.6), size: rand(0.05, 0.14),
              color: devil ? pick([0xff2010, 0xff6020, 0x600000]) : pick([0xfff4d0, 0xffffff, 0xffe080]), drag: 1.5,
            }));
          },
        },
        { t: 3.6, fn: (game) => { npc.intro = 1; npc.greeted = true; npc.say('greet'); npc.setMood('greet'); game.audio.play(npc.voice); game.flash = devil ? 0.2 : 0.5; } },
      ],
      onSkip: () => { npc.intro = 1; npc.greeted = true; },
    };
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh && o.geometry !== this.game.flameGeo) o.geometry.dispose(); });
    document.getElementById('npc-bubble').classList.add('hidden');
  }
}

function composeLocal(x, y, z, ry) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
}
