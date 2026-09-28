import * as THREE from 'three';
import { rand, pick, clamp, damp, dampAngle, easeInOut, easeOut, TAU } from './util.js';
import { buildItemMesh, rollItems, itemPrice } from './items.js';
import { buildWeaponModel, weaponMaterials, rollWeapon, hex } from './weapons.js';
import { WeaponDrop } from './loot.js';

const MERCHANT_NAME = 'Vael the Many-Handed';
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

const LINES = {
  greet: ['Ahh... a customer. Come closer, little candle.', 'The dark sends me so few buyers. Welcome, welcome!', 'Coins? I smell coins. Step into my light.', 'Four hands, and all of them eager. Come, come!'],
  open: ['Browse, browse. Everything here was stolen fairly.', 'Look with your eyes, pay with your purse.', 'Each curio chose you. Mostly.'],
  buy: ['Hehehe! A pleasure, a pleasure!', 'Sold! It likes you already.', 'Your coin sings in my palm!', 'Wise, wise. Or foolish. Both pay the same.'],
  poor: ['Tsk. Your purse is lighter than your soul.', 'No coin, no curio. Those are the rules. My rules.', 'I accept coin. Not promises. Not tears.'],
  sold: ['That one is gone. Gone gone gone.', 'Sold already. You were there. You saw.'],
  leave: ['Come back alive. Dead customers rarely pay.', 'The candle gutters... until next time.', 'Go on, go on. The dark is hungry tonight.'],
  idle: ['Hmm-hmm-hmm...', 'One... two... three orbs. Never four. Never again.', 'Do you hear them whispering? No? Good.'],
  key: 'Keys open doors. Doors open... opportunities.',
  vial: 'Blood, bottled fresh. Mostly fresh.',
  flask: 'I shall top up your flask. Crimson, of course.',
  weapon: 'A fine edge. Its last owner will not miss it. Much.',
};

// ============================================================================
// Speech bubble — floats above the merchant's head, in the world or in the shop.
// ============================================================================

export class Bubble {
  constructor(name = MERCHANT_NAME, theme = 'merchant') {
    this.el = document.getElementById('npc-bubble');
    this.textEl = this.el.querySelector('.npc-text');
    this.name = name;
    this.theme = theme;
    this.full = '';
    this.shown = 0;
    this.timer = 0;
  }

  say(text, game) {
    // One bubble element is shared by every speaker; claim it.
    this.el.querySelector('.npc-name').textContent = this.name;
    this.el.dataset.theme = this.theme;
    this.full = text;
    this.shown = 0;
    this.timer = 2.2 + text.length * 0.045;
    this.textEl.textContent = '';
    this.game = game;
  }

  get talking() { return this.timer > 0 && this.shown < this.full.length; }

  update(dt, anchor, camera, visible) {
    if (this.timer > 0) this.timer -= dt;
    const prev = Math.floor(this.shown);
    this.shown = Math.min(this.full.length, this.shown + dt * 42);
    const now = Math.floor(this.shown);
    if (now !== prev) {
      this.textEl.textContent = this.full.slice(0, now);
      if (now % 2 === 0 && this.full[now - 1] !== ' ') this.game?.audio.play('blip');
    }
    _v.copy(anchor).project(camera);
    const on = visible && this.timer > 0 && _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
    this.el.classList.toggle('hidden', !on);
    if (!on) return;
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth, y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    this.el.style.opacity = String(clamp(this.timer / 0.4, 0, 1));
  }
}

// ============================================================================
// The merchant — floating, hooded, masked, four-armed, forever juggling.
// ============================================================================

export class Merchant {
  constructor(game, chamber, x, y, z, facing) {
    this.game = game;
    this.chamber = chamber;
    this.t = rand(0, 10);
    this.facing = facing;
    this.yaw = facing;
    this.mood = 'idle';
    this.moodT = 0;
    this.lookTarget = null;
    this.pointTarget = null;
    this.blinkT = rand(2, 4);
    this.thirdEyeT = rand(6, 12);
    this.idleLineT = rand(8, 14);
    this.greeted = false;
    this.bubble = new Bubble();
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.build();
    (chamber.actors || chamber.group).add(this.group);
    chamber.world.addCircleWorld(x, z, 0.9, y - 1, y + 3);
    this.radius = 3.2;
    chamber.interactables.push(this);
  }

  get position() { return this.group.position; }
  get prompt() { return `Trade with ${MERCHANT_NAME}`; }
  get sub() { return 'Curios, keys, and questionable blood'; }
  get promptColor() { return '#c8a0ff'; }
  interact() { this.game.openShop(this.chamber.shop); }

  build() {
    const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...o });
    const glow = (color) => new THREE.MeshBasicMaterial({ color, fog: false });
    const M = {
      robe: mat(0x2a1e4a), robeDark: mat(0x180f2c), mantle: mat(0x6a1a2e),
      gold: mat(0xe0b050, { emissive: 0x5a3a08, emissiveIntensity: 1.1, metalness: 0.7, roughness: 0.35 }),
      mask: mat(0xece4d4, { roughness: 0.4 }), skin: mat(0xa8a0bc), void: glow(0x000000),
      eye: glow(0x8af4ff), third: glow(0xff60d0), orb: [glow(0xffc060), glow(0x80e0ff), glow(0xff70c0)],
      rune: new THREE.MeshBasicMaterial({ color: 0xd8b0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      flame: glow(0xffb050), wax: mat(0xd8ccb0),
    };
    this.M = M;
    const add = (parent, geo, m, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Shadow puddle and summoning glyph beneath him.
    const glyph = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.25, 6).rotateX(-Math.PI / 2), M.rune);
    glyph.position.y = 0.03;
    this.group.add(glyph);
    this.glyph = glyph;
    const glyph2 = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.76, 3).rotateX(-Math.PI / 2), M.rune);
    glyph2.position.y = 0.035;
    this.group.add(glyph2);
    this.glyph2 = glyph2;

    this.body = new THREE.Group();
    this.group.add(this.body);
    const B = this.body;
    // Robe: flared skirts over nothing at all.
    add(B, new THREE.CylinderGeometry(0.5, 0.82, 1.15, 9, 1, true), M.robe, 0, 0.6, 0).material.side = THREE.DoubleSide;
    add(B, new THREE.CylinderGeometry(0.84, 0.84, 0.07, 9, 1, true), M.gold, 0, 0.09, 0);
    add(B, new THREE.CylinderGeometry(0.52, 0.52, 0.06, 9, 1, true), M.gold, 0, 1.12, 0);
    this.tatters = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const piv = new THREE.Group();
      piv.position.set(Math.cos(a) * 0.8, 0.06, Math.sin(a) * 0.8);
      piv.rotation.y = -a;
      add(piv, new THREE.BoxGeometry(0.16, rand(0.35, 0.7), 0.02), M.robeDark, 0, -0.2, 0);
      B.add(piv);
      this.tatters.push(piv);
    }
    // Torso and mantle, hunched forward.
    this.torso = new THREE.Group();
    this.torso.position.y = 1.15;
    this.torso.rotation.x = 0.18;
    B.add(this.torso);
    add(this.torso, new THREE.CylinderGeometry(0.34, 0.5, 0.75, 8), M.robe, 0, 0.35, 0);
    add(this.torso, new THREE.CylinderGeometry(0.22, 0.72, 0.36, 8), M.mantle, 0, 0.72, 0);
    add(this.torso, new THREE.CylinderGeometry(0.73, 0.73, 0.05, 8, 1, true), M.gold, 0, 0.55, 0);
    add(this.torso, new THREE.BoxGeometry(0.1, 0.5, 0.04), M.gold, 0, 0.35, 0.44);
    // A pendant: a tiny caged star.
    this.pendant = add(this.torso, new THREE.OctahedronGeometry(0.06), M.orb[0], 0, 0.1, 0.5);

    // Head: a deep hood with a long, drooping tip, and a porcelain mask floating in the dark.
    this.head = new THREE.Group();
    this.head.position.set(0, 0.92, 0.08);
    this.torso.add(this.head);
    const H = this.head;
    add(H, new THREE.ConeGeometry(0.42, 0.9, 8, 1, true), M.robe, 0, 0.3, -0.04).material.side = THREE.DoubleSide;
    add(H, new THREE.SphereGeometry(0.3, 8, 6), M.void, 0, 0.12, 0.02).scale.set(1, 1, 0.7);
    this.hoodTip = [];
    let parent = H;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.72 : 0.26, i === 0 ? -0.04 : 0);
      parent.add(seg);
      add(seg, new THREE.ConeGeometry(0.12 - i * 0.035, 0.3, 6), M.robe, 0, 0.13, 0);
      this.hoodTip.push(seg);
      parent = seg;
    }
    add(parent, new THREE.SphereGeometry(0.045, 6, 4), M.gold, 0, 0.3, 0);
    this.mask = new THREE.Group();
    this.mask.position.set(0, 0.1, 0.2);
    H.add(this.mask);
    add(this.mask, new THREE.BoxGeometry(0.3, 0.3, 0.05), M.mask, 0, 0.04, 0);
    add(this.mask, new THREE.BoxGeometry(0.02, 0.2, 0.01), M.gold, 0, 0.06, 0.03);
    this.eyes = [-1, 1].map((s) => add(this.mask, new THREE.BoxGeometry(0.08, 0.028, 0.02), M.eye, s * 0.075, 0.08, 0.03));
    this.third = add(this.mask, new THREE.OctahedronGeometry(0.035), M.third, 0, 0.17, 0.03);
    this.third.scale.set(1, 0.1, 1);
    this.jaw = add(this.mask, new THREE.BoxGeometry(0.24, 0.08, 0.045), M.mask, 0, -0.14, 0);

    // Four arms — two at the shoulder, two lower down — each a sleeve, a bony forearm, a hand.
    this.arms = [];
    const mkArm = (side, y, x, upper) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * x, y, 0);
      this.torso.add(shoulder);
      add(shoulder, new THREE.CylinderGeometry(0.1, 0.17, 0.5, 6, 1, true), upper ? M.mantle : M.robe, 0, -0.25, 0).material.side = THREE.DoubleSide;
      const elbow = new THREE.Group();
      elbow.position.y = -0.48;
      shoulder.add(elbow);
      add(elbow, new THREE.BoxGeometry(0.07, 0.42, 0.07), M.skin, 0, -0.2, 0);
      add(elbow, new THREE.CylinderGeometry(0.075, 0.075, 0.04, 6), M.gold, 0, -0.02, 0);
      const hand = new THREE.Group();
      hand.position.y = -0.42;
      elbow.add(hand);
      add(hand, new THREE.BoxGeometry(0.12, 0.11, 0.04), M.skin, 0, -0.05, 0);
      const fingers = [];
      for (let f = 0; f < 3; f++) {
        const fg = new THREE.Group();
        fg.position.set((f - 1) * 0.04, -0.1, 0);
        hand.add(fg);
        add(fg, new THREE.BoxGeometry(0.022, 0.14, 0.022), M.skin, 0, -0.06, 0);
        fingers.push(fg);
      }
      const thumb = new THREE.Group();
      thumb.position.set(-side * 0.06, -0.04, 0.02);
      thumb.rotation.z = -side * 0.7;
      hand.add(thumb);
      add(thumb, new THREE.BoxGeometry(0.022, 0.09, 0.022), M.skin, 0, -0.04, 0);
      const arm = { side, upper, shoulder, elbow, hand, fingers, dir: new THREE.Vector3(side * 0.3, -1, 0.2).normalize(), bend: 0.3, grip: 0.2 };
      this.arms.push(arm);
      return arm;
    };
    this.armUR = mkArm(1, 0.62, 0.62, true);
    this.armUL = mkArm(-1, 0.62, 0.62, true);
    this.armLR = mkArm(1, 0.3, 0.48, false);
    this.armLL = mkArm(-1, 0.3, 0.48, false);

    // A crooked staff crowned by a caged lantern-star, held in the upper left hand.
    const staff = new THREE.Group();
    staff.position.set(0, -0.08, 0.02);
    this.armUL.hand.add(staff);
    add(staff, new THREE.CylinderGeometry(0.025, 0.03, 1.9, 5), mat(0x3a2a1a), 0, 0.35, 0);
    add(staff, new THREE.TorusGeometry(0.12, 0.018, 4, 10), M.gold, 0, 1.36, 0);
    this.staffStar = add(staff, new THREE.OctahedronGeometry(0.08), M.orb[1], 0, 1.36, 0);
    this.staff = staff;

    // Juggled orbs, orbiting rune rings, floating candles.
    this.orbs = M.orb.map((m) => add(this.group, new THREE.IcosahedronGeometry(0.075, 0), m));
    this.runes = [1.15, 1.4].map((r, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 3, 40), M.rune);
      ring.position.y = 1.5;
      ring.rotation.x = Math.PI / 2 + (i ? 0.35 : -0.25);
      this.group.add(ring);
      return ring;
    });
    this.candles = [];
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Group();
      add(c, new THREE.CylinderGeometry(0.035, 0.035, rand(0.12, 0.25), 6), M.wax, 0, 0, 0);
      add(c, new THREE.BoxGeometry(0.04, 0.07, 0.04), M.flame, 0, 0.16, 0);
      this.group.add(c);
      this.candles.push({ g: c, a: (i / 5) * TAU, h: rand(2.1, 2.8), r: rand(1.5, 1.9) });
    }
  }

  // ---- Behaviour ------------------------------------------------------------

  say(key, text = null) {
    this.bubble.say(text ?? (Array.isArray(LINES[key]) ? pick(LINES[key]) : LINES[key]), this.game);
  }

  setMood(m) {
    this.mood = m;
    this.moodT = 0;
  }

  headWorld() { return this.head.getWorldPosition(new THREE.Vector3()).add(_v.set(0, 0.62, 0)); }

  /** Arm aim: turn the shoulder so the arm points along `dir` (body space), bend the elbow. */
  poseArm(arm, dir, bend, grip, rate, dt) {
    arm.dir.lerp(dir, 1 - Math.exp(-rate * dt)).normalize();
    _q.setFromUnitVectors(DOWN, arm.dir);
    arm.shoulder.quaternion.slerp(_q, 1 - Math.exp(-rate * dt));
    arm.bend = damp(arm.bend, bend, rate, dt);
    arm.elbow.rotation.x = -arm.bend;
    arm.grip = damp(arm.grip, grip, rate, dt);
    arm.fingers.forEach((f, i) => { f.rotation.x = arm.grip * (1 + i * 0.15); });
  }

  /** A world point expressed as a direction in torso space, from a given shoulder. */
  localDir(world, shoulder) {
    const p = this.torso.worldToLocal(world.clone());
    return p.sub(shoulder.position).normalize();
  }

  update(dt, shopOpen) {
    this.t += dt;
    this.moodT += dt;
    const t = this.t, game = this.game, player = game.player;
    const p = this.group.position;
    const pd = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
    if (!shopOpen && pd < 10 && !this.greeted && Math.abs(player.pos.y - p.y) < 3) {
      this.greeted = true;
      this.say('greet');
      this.setMood('greet');
      game.audio.play('merchant');
    }
    if (pd > 18) this.greeted = false;
    this.idleLineT -= dt;
    if (!shopOpen && pd < 9 && this.idleLineT <= 0) {
      this.idleLineT = rand(10, 18);
      this.say('idle');
    }
    if (this.mood !== 'idle' && this.mood !== 'point' && this.moodT > (this.mood === 'delight' ? 1.4 : 1.6)) this.setMood(shopOpen && this.pointTarget ? 'point' : 'idle');

    // Float, sway, and turn to face the customer when near.
    const talking = this.bubble.talking;
    const B = this.body;
    const hop = this.mood === 'delight' ? Math.abs(Math.sin(this.moodT * 9)) * 0.25 * (1 - this.moodT / 1.4) : 0;
    B.position.y = 0.45 + Math.sin(t * 1.7) * 0.1 + hop;
    B.rotation.z = Math.sin(t * 0.9) * 0.05;
    const toPlayer = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
    const wantYaw = shopOpen ? this.facing : pd < 12 ? toPlayer : this.facing;
    this.yaw = dampAngle(this.yaw, wantYaw, 2.5, dt);
    let spin = 0;
    if (this.mood === 'delight') spin = easeInOut(Math.min(1, this.moodT / 0.9)) * TAU;
    B.rotation.y = this.yaw + spin;
    this.torso.rotation.x = 0.18 + (this.mood === 'bow' ? Math.sin(Math.min(1, this.moodT / 0.6) * Math.PI) * 0.5 : 0) + Math.sin(t * 1.3) * 0.03;

    // Head tracks what matters: the pointed-at ware, or the customer's eyes.
    const look = this.lookTarget ?? player.eyePosition;
    const lp = this.torso.worldToLocal(look.clone()).sub(this.head.position);
    let hy = clamp(Math.atan2(lp.x, lp.z), -1.1, 1.1);
    let hx = clamp(-Math.atan2(lp.y, Math.hypot(lp.x, lp.z)), -0.6, 0.5);
    if (this.mood === 'refuse') hy += Math.sin(this.moodT * 16) * 0.35 * Math.max(0, 1 - this.moodT);
    if (this.mood === 'delight') hx -= 0.3;
    this.head.rotation.y = dampAngle(this.head.rotation.y, hy, 6, dt);
    this.head.rotation.x = damp(this.head.rotation.x, hx + Math.sin(t * 2.1) * 0.04, 6, dt);
    this.head.rotation.z = Math.sin(t * 1.1) * 0.08 + (talking ? Math.sin(t * 7) * 0.05 : 0);
    this.hoodTip.forEach((s, i) => {
      s.rotation.x = -0.35 - i * 0.25 + Math.sin(t * 1.6 - i * 0.7) * 0.12;
      s.rotation.z = Math.sin(t * 1.2 - i) * 0.15;
    });
    this.jaw.position.y = -0.14 - (talking ? Math.abs(Math.sin(t * 22)) * 0.035 : 0);

    // Blinks, and a third eye that sometimes opens to see what you are really worth.
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12;
    if (this.blinkT < 0) this.blinkT = rand(2, 5);
    for (const e of this.eyes) e.scale.y = blink ? 0.15 : this.mood === 'delight' ? 0.5 : 1;
    this.thirdEyeT -= dt;
    const openThird = this.thirdEyeT < 1.6 || this.mood === 'delight' || shopOpen;
    if (this.thirdEyeT < 0) this.thirdEyeT = rand(7, 14);
    this.third.scale.y = damp(this.third.scale.y, openThird ? 1.3 : 0.1, 8, dt);
    this.M.eye.color.setHex(this.mood === 'refuse' ? 0xff6040 : 0x8af4ff);

    this.animateArms(dt, talking);

    // Orbs, runes, candles, glyphs.
    const ringSpin = this.mood === 'delight' ? 6 : 1;
    this.runes[0].rotation.z += dt * 0.6 * ringSpin;
    this.runes[1].rotation.z -= dt * 0.45 * ringSpin;
    this.runes.forEach((r, i) => { r.position.y = B.position.y + 1.05 + Math.sin(t * 1.3 + i) * 0.08; });
    this.glyph.rotation.y += dt * 0.3;
    this.glyph2.rotation.y -= dt * 0.5;
    this.candles.forEach((c, i) => {
      c.a += dt * 0.35;
      c.g.position.set(Math.cos(c.a) * c.r, c.h + Math.sin(t * 1.5 + i) * 0.12, Math.sin(c.a) * c.r);
    });
    this.staffStar.rotation.y += dt * 2;
    this.pendant.rotation.y += dt * 3;
    if (Math.random() < dt * 5) {
      const a = rand(0, TAU);
      game.glow.emit({
        pos: new THREE.Vector3(p.x + Math.cos(a) * 1.2, p.y + rand(0.2, 2.4), p.z + Math.sin(a) * 1.2),
        vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.1, 0.4), rand(-0.2, 0.2)), life: rand(1, 2), size: 0.03, color: pick([0xd8b0ff, 0x8af4ff, 0xffc060]),
      });
    }
    this.bubble.update(dt, this.headWorld(), game.camera, pd < 16 || shopOpen);
  }

  animateArms(dt, talking) {
    const t = this.t, m = this.mood, mt = this.moodT;
    const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
    const [UR, UL, LR, LL] = [this.armUR, this.armUL, this.armLR, this.armLL];
    // Lower hands juggle three orbs in a lazy cascade (unless busy celebrating).
    const juggling = m !== 'delight' && m !== 'refuse';
    const jy = 0.95;
    if (juggling) {
      this.orbs.forEach((o, i) => {
        const ph = t * 2.6 + (i * TAU) / 3;
        const x = Math.cos(ph) * 0.32;
        const y = jy + 0.28 + Math.abs(Math.sin(ph)) * 0.5;
        o.position.copy(this.torso.localToWorld(_v.set(x, y - 1.15 + 0.35, 0.52))).sub(this.group.position);
        o.rotation.y += dt * 4;
      });
      const bounce = Math.sin(t * 5.2) * 0.12;
      this.poseArm(LR, V(0.25, -0.35 + bounce, 1), 1.1, 0.5, 10, dt);
      this.poseArm(LL, V(-0.25, -0.35 - bounce, 1), 1.1, 0.5, 10, dt);
    } else {
      // Orbs fly up and circle his head.
      this.orbs.forEach((o, i) => {
        const a = t * 5 + (i * TAU) / 3;
        o.position.set(Math.cos(a) * 0.6, this.body.position.y + 2.3 + Math.sin(t * 3 + i) * 0.1, Math.sin(a) * 0.6);
      });
    }

    switch (m) {
      case 'greet': {
        this.poseArm(UR, V(0.6, 0.9 + Math.sin(mt * 14) * 0.25, 0.3), 0.5 + Math.sin(mt * 14) * 0.4, 0, 12, dt);
        this.poseArm(UL, V(-0.35, -0.7, 0.4), 0.4, 0.8, 6, dt);
        break;
      }
      case 'delight': {
        const w = Math.sin(mt * 12);
        this.poseArm(UR, V(0.7, 1, 0.1), 0.3 + w * 0.3, 0, 14, dt);
        this.poseArm(UL, V(-0.7, 1, 0.1), 0.3 - w * 0.3, 0.8, 14, dt);
        this.poseArm(LR, V(1, 0.3, 0.3), 0.2, 0, 14, dt);
        this.poseArm(LL, V(-1, 0.3, 0.3), 0.2, 0, 14, dt);
        break;
      }
      case 'refuse': {
        // Arms folded, one finger wagging.
        this.poseArm(UR, V(-0.6, -0.2, 0.8), 1.6, 0.9, 12, dt);
        this.poseArm(UL, V(0.5, -0.1, 0.9), 1.3 + Math.sin(mt * 18) * 0.25, 0.1, 12, dt);
        this.poseArm(LR, V(0.9, -0.6, -0.2), 1.4, 0.8, 10, dt);
        this.poseArm(LL, V(-0.9, -0.6, -0.2), 1.4, 0.8, 10, dt);
        break;
      }
      case 'bow': {
        this.poseArm(UR, V(0.9, -0.2, 0.5), 0.3, 0, 8, dt);
        this.poseArm(UL, V(-0.2, -0.9, 0.5), 0.9, 0.8, 8, dt);
        break;
      }
      case 'point':
      case 'idle':
      default: {
        if (this.pointTarget) {
          const d = this.localDir(this.pointTarget, UR.shoulder);
          this.poseArm(UR, d, 0.12, 0.1, 9, dt);
          UR.fingers[1].rotation.x = 0;
          UR.fingers[0].rotation.x = UR.fingers[2].rotation.x = 1.4;
        } else {
          // Talking hands: flourish with each phrase; otherwise a slow, greedy rub.
          const g = talking ? Math.sin(t * 6) : Math.sin(t * 1.3);
          this.poseArm(UR, V(0.35 + g * 0.2, talking ? 0.1 : -0.6, 0.8), talking ? 0.8 + g * 0.4 : 1.2, talking ? 0.2 : 0.6, 6, dt);
        }
        this.poseArm(UL, V(-0.32, -0.75 + Math.sin(t * 0.8) * 0.05, 0.35), 0.45, 0.85, 5, dt);
      }
    }
  }
}

// ============================================================================
// Wares on display — real objects on velvet stands, with price tags in the world.
// ============================================================================

function priceTexture(text, color, mode = 'coin') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,6,14,0.78)';
  g.fillRect(8, 8, 112, 32);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(9, 9, 110, 30);
  // The currency glyph: a coin, a drop of blood, or a star of grace.
  g.fillStyle = mode === 'vigor' ? '#e02030' : mode === 'gift' ? '#fff0c0' : '#f0c040';
  g.beginPath();
  if (mode === 'vigor') {
    g.moveTo(32, 13); g.quadraticCurveTo(42, 26, 32, 34); g.quadraticCurveTo(22, 26, 32, 13);
  } else if (mode === 'gift') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, r = i % 2 ? 4 : 10;
      g.lineTo(32 + Math.cos(a) * r, 24 + Math.sin(a) * r);
    }
  } else g.arc(32, 24, 8, 0, TAU);
  g.fill();
  g.fillStyle = '#f0e6d0';
  g.font = 'bold 22px Georgia, serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, 48, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

const WEAPON_PRICES = { common: 12, fine: 20, rare: 32, legendary: 48 };

class Ware {
  constructor(shop, spec, pos) {
    this.shop = shop;
    this.spec = spec;
    this.sold = false;
    this.pos = pos.clone();
    this.lift = 0;
    this.t = rand(0, 10);
    const game = shop.game;
    const M = game.materials;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    const add = (geo, mat, y) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    const stand = shop.stand;
    add(new THREE.CylinderGeometry(0.34, 0.42, 0.9, 6), stand === 'obsidian' ? M.iron : stand === 'marble' ? M.wax : M.trim, 0.45);
    add(new THREE.BoxGeometry(0.62, 0.08, 0.62), stand === 'marble' ? M.gold : stand === 'obsidian' ? M.bloodGlow : M.cloth, 0.93).rotation.y = Math.PI / 4;
    this.ringMat = new THREE.MeshBasicMaterial({ color: shop.ringColor, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.55, 24).rotateX(-Math.PI / 2), this.ringMat);
    ring.position.y = 0.02;
    this.group.add(ring);
    this.model = new THREE.Group();
    this.model.position.y = 1.35;
    this.group.add(this.model);
    this.model.add(this.buildModel());
    const label = shop.mode === 'vigor' ? `-${spec.price}` : shop.mode === 'gift' ? 'gift' : String(spec.price);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: priceTexture(label, spec.color, shop.mode), fog: false, depthTest: true, transparent: true }));
    this.tag.scale.set(0.62, 0.23, 1);
    this.tag.position.y = 2.0;
    this.group.add(this.tag);
    shop.chamber.actors.add(this.group);
    shop.chamber.world.addCircleWorld(pos.x, pos.z, 0.45, pos.y - 1, pos.y + 1);
  }

  buildModel() {
    const s = this.spec;
    if (s.kind === 'item') return buildItemMesh(s.item);
    if (s.kind === 'weapon') {
      const m = buildWeaponModel(s.weapon.typeId, weaponMaterials(), s.weapon.bolt?.color);
      m.scale.setScalar(0.85);
      m.position.y = -0.2;
      m.rotation.z = 0.35;
      return m;
    }
    const g = new THREE.Group();
    if (s.kind === 'key') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, emissive: 0x405060, emissiveIntensity: 1.5, metalness: 0.8, roughness: 0.3, flatShading: true });
      const parts = [[new THREE.TorusGeometry(0.12, 0.035, 4, 10), 0, 0.2], [new THREE.BoxGeometry(0.05, 0.4, 0.05), 0, -0.05], [new THREE.BoxGeometry(0.12, 0.05, 0.05), 0.06, -0.2]];
      for (const [geo, x, y] of parts) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, 0);
        g.add(m);
      }
    } else {
      const glass = new THREE.MeshStandardMaterial({ color: 0xe0203a, emissive: 0x901020, emissiveIntensity: 1.8, roughness: 0.2, flatShading: true });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(s.kind === 'flask' ? 0.13 : 0.09, 0.14, s.kind === 'flask' ? 0.3 : 0.22, 7), glass);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 6), new THREE.MeshStandardMaterial({ color: 0xe0b050, metalness: 0.7, roughness: 0.3 }));
      neck.position.y = 0.2;
      g.add(body, neck);
    }
    return g;
  }

  get anchor() { return this.group.position.clone().setY(this.group.position.y + 1.35 + this.lift); }

  update(dt, selected) {
    this.t += dt;
    this.lift = damp(this.lift, selected && !this.sold ? 0.3 : 0, 8, dt);
    this.model.position.y = 1.35 + this.lift + Math.sin(this.t * 2) * 0.05;
    this.model.rotation.y += dt * (selected ? 2.5 : 0.8);
    this.ringMat.opacity = this.sold ? 0.04 : selected ? 0.55 + 0.25 * Math.sin(this.t * 6) : 0.18;
    this.tag.visible = !this.sold;
    this.tag.material.opacity = selected ? 1 : 0.8;
    if (selected && !this.sold && Math.random() < dt * 18) {
      const p = this.anchor;
      this.shop.game.glow.emit({
        pos: new THREE.Vector3(p.x + rand(-0.2, 0.2), p.y - 0.2, p.z + rand(-0.2, 0.2)),
        vel: new THREE.Vector3(0, rand(0.4, 1), 0), life: rand(0.5, 1), size: 0.03, color: this.spec.color,
      });
    }
  }

  markSold() {
    this.sold = true;
    this.model.visible = false;
  }

  /** An angel's unchosen gift dissolves into motes. */
  fade() {
    this.markSold();
    this.faded = true;
    const p = this.anchor;
    this.shop.game.glow.burst(p, 26, () => ({
      vel: new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)), life: rand(0.8, 1.6), size: 0.05, color: 0xfff0c0, drag: 1,
    }));
  }
}

// ============================================================================
// The shop itself: stock, the trading camera, and the HTML layer that ties UI, world and NPC.
// ============================================================================

/**
 * A trading view. The merchant's shop uses it with coin; the devil's and angel's realms reuse it
 * with other currencies:
 *   mode 'coin'  — prices in coin
 *   mode 'vigor' — prices in maximum health (the HP bar previews the loss)
 *   mode 'gift'  — free, but choosing one makes the rest fade
 */
export class Shop {
  constructor(game, chamber, x, y, z, facing, opts = {}) {
    this.game = game;
    this.chamber = chamber;
    this.open = false;
    this.base = new THREE.Vector3(x, y, z);
    this.facing = facing;
    this.fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    this.lat = new THREE.Vector3(this.fwd.z, 0, -this.fwd.x);
    this.mode = opts.mode ?? 'coin';
    this.title = opts.title ?? "Vael's Curios";
    this.subtitle = opts.subtitle ?? 'A wandering merchant of the deep';
    this.theme = opts.theme ?? 'merchant';
    this.stand = opts.stand ?? 'velvet';
    this.ringColor = opts.ringColor ?? 0xd8b0ff;
    this.cam = { dist: 6.2, side: 1.6, height: 2.3, lookFwd: 1.8, lookSide: 2.4, lookHeight: 1.3, ...(opts.cam || {}) };
    this.merchant = opts.npc ? opts.npc(this) : new Merchant(game, chamber, x, y, z, facing);
    this.sel = 0;
    this.camK = 0;
    if (opts.specs) this.placeWares(opts.specs, opts.radius ?? 3.1, opts.spread ?? 1.9);
    else this.stockWares();
    this.bindUI();
  }

  stockWares() {
    const game = this.game, p = game.player;
    const specs = [];
    for (const item of rollItems(p, 'shop', 2)) specs.push({ kind: 'item', item, name: item.name, desc: item.desc, lore: item.lore, price: itemPrice(item), color: hex(item.color) });
    const w = rollWeapon(game.depth, 1);
    specs.push({ kind: 'weapon', weapon: w, name: w.displayName, desc: w.affix ? w.affix.desc : `${Math.round(w.damage)} damage`, lore: LINES.weapon, price: WEAPON_PRICES[w.rarity.id], color: hex(w.rarity.color) });
    specs.push({ kind: 'key', name: 'Iron Key', desc: 'Opens one gilded chest or locked gate', lore: LINES.key, price: 6, color: '#d0d8e8' });
    specs.push(Math.random() < 0.5
      ? { kind: 'flask', name: 'Crimson Refill', desc: 'Refills one Crimson Flask', lore: LINES.flask, price: 7, color: '#e0203a' }
      : { kind: 'vial', name: 'Blood Vial', desc: 'Restores 35 health at once', lore: LINES.vial, price: 4, color: '#e0203a' });
    this.placeWares(specs, 3.1, 1.9);
  }

  /** Stands in an arc in front of the trader. */
  placeWares(specs, r, spread) {
    const n = specs.length;
    this.wares = specs.map((s, i) => {
      const a = n > 1 ? ((i - (n - 1) / 2) / (n - 1)) * spread : 0;
      const pos = this.base.clone()
        .addScaledVector(this.fwd, Math.cos(a) * r)
        .addScaledVector(this.lat, Math.sin(a) * r);
      pos.y = this.base.y;
      return new Ware(this, s, pos);
    });
  }

  bindUI() {
    if (Shop.ui) return;
    const root = document.getElementById('shop');
    Shop.ui = {
      root,
      list: root.querySelector('.shop-list'),
      wallet: root.querySelector('.shop-wallet'),
      detail: root.querySelector('.shop-detail'),
      tags: root.querySelector('.shop-tags'),
      bracket: root.querySelector('.shop-bracket'),
      leave: root.querySelector('.shop-leave'),
      title: root.querySelector('header h2'),
      sub: root.querySelector('.shop-sub'),
    };
    const ui = Shop.ui;
    ui.leave.addEventListener('click', () => this.game.shop?.close());
    window.addEventListener('keydown', (e) => {
      const shop = this.game.shop;
      if (!shop || !shop.open || shop.closing) return;
      if (['KeyA', 'ArrowLeft', 'ArrowUp', 'KeyW'].includes(e.code)) shop.select(shop.sel - 1);
      else if (['KeyD', 'ArrowRight', 'ArrowDown', 'KeyS'].includes(e.code)) shop.select(shop.sel + 1);
      else if (['KeyE', 'Enter', 'Space'].includes(e.code)) shop.buy();
      else if (['Escape', 'KeyQ', 'Backspace', 'Tab'].includes(e.code)) shop.close();
      e.preventDefault();
    });
    const canvas = this.game.renderer.domElement;
    const ray = new THREE.Raycaster();
    const pick = (e) => {
      const shop = this.game.shop;
      if (!shop || !shop.open) return -1;
      const m = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      ray.setFromCamera(m, this.game.camera);
      let best = -1, bd = 0.55;
      shop.wares.forEach((w, i) => {
        const d = ray.ray.distanceToPoint(w.anchor.clone().setY(w.anchor.y - 0.3));
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    canvas.addEventListener('mousemove', (e) => {
      const i = pick(e);
      const shop = this.game.shop;
      if (i >= 0 && i !== shop.sel) shop.select(i);
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
    });
    canvas.addEventListener('click', (e) => {
      const i = pick(e);
      if (i >= 0) {
        this.game.shop.select(i);
        this.game.shop.buy();
      }
    });
  }

  // ---- Opening and closing ----------------------------------------------------

  openShop() {
    const game = this.game;
    this.open = true;
    this.closing = false;
    this.camK = 0;
    this.camFrom = { pos: game.camera.position.clone(), quat: game.camera.quaternion.clone() };
    // Frame the merchant and his wares on the left; the ledger fills the right of the screen.
    // (`lat` is the camera's right-hand side, so aiming to the right pushes him left.)
    const M = this.base, C = this.cam;
    this.camPos = M.clone().addScaledVector(this.fwd, C.dist).addScaledVector(this.lat, C.side).add(_v.set(0, C.height, 0));
    const lookAt = M.clone().addScaledVector(this.fwd, C.lookFwd).addScaledVector(this.lat, C.lookSide).add(_v.set(0, C.lookHeight, 0));
    this.camLook = lookAt;
    this.camQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(this.camPos, lookAt, new THREE.Vector3(0, 1, 0)));
    const first = this.wares.findIndex((w) => !w.sold);
    this.select(first >= 0 ? first : 0, true);
    this.merchant.say('open');
    this.merchant.setMood('greet');
    game.audio.play(this.merchant.voice ?? 'merchant');
    const ui = Shop.ui;
    ui.root.dataset.theme = this.theme;
    ui.title.textContent = this.title;
    ui.sub.textContent = this.subtitle;
    ui.root.classList.remove('hidden');
    game.hud.root.classList.add('shopping');
    game.hud.root.classList.toggle('show-vitals', this.mode === 'vigor');
    this.buildTags();
    this.render();
  }

  close() {
    if (!this.open || this.closing) return;
    this.closing = true;
    this.merchant.say('leave');
    this.merchant.setMood('bow');
    this.merchant.pointTarget = null;
    this.merchant.lookTarget = null;
    Shop.ui.root.classList.add('hidden');
    this.game.hud.root.classList.remove('shopping', 'show-vitals');
    this.game.hud.setHpCost(null);
    this.game.renderer.domElement.style.cursor = '';
  }

  select(i, quiet = false) {
    const n = this.wares.length;
    this.sel = ((i % n) + n) % n;
    const w = this.wares[this.sel];
    this.merchant.pointTarget = w.anchor;
    this.merchant.lookTarget = w.anchor;
    // A pact's price flashes on the health bar before it is paid.
    if (this.mode === 'vigor') this.game.hud.setHpCost(w.sold ? null : w.spec.price);
    if (!quiet) {
      this.game.audio.play('tick');
      if (!w.sold) this.merchant.say(null, w.spec.kind === 'item' ? `${w.spec.name}... ${w.spec.lore}` : w.spec.lore);
      this.merchant.setMood('point');
    }
    this.render();
  }

  /** Can the customer pay for this? */
  affordable(spec) {
    const p = this.game.player;
    if (this.mode === 'vigor') return p.stats.maxHp - spec.price >= 20;
    if (this.mode === 'gift') return true;
    return p.coins >= spec.price;
  }

  buy() {
    const w = this.wares[this.sel];
    const game = this.game, p = game.player;
    if (w.sold) {
      this.merchant.say('sold');
      game.audio.play('empty');
      return;
    }
    if (!this.affordable(w.spec)) {
      this.merchant.say('poor');
      this.merchant.setMood('refuse');
      game.audio.play('locked');
      Shop.ui.wallet.classList.remove('denied');
      void Shop.ui.wallet.offsetWidth;
      Shop.ui.wallet.classList.add('denied');
      return;
    }
    const s = w.spec;
    if (this.mode === 'vigor') {
      p.stats.maxHp -= s.price;
      p.hp = Math.min(p.hp, p.stats.maxHp);
      p.devilDeals++;
      game.hurtFlash = 0.9;
      game.shake(0.3);
      game.audio.play('devil');
      game.hud.setHpCost(null);
    } else if (this.mode === 'gift') {
      game.audio.play('angel');
      // Grace given once: the other gifts fade away.
      for (const other of this.wares) if (other !== w && !other.sold) other.fade();
    } else p.coins -= s.price;
    switch (s.kind) {
      case 'item': game.onItemPickup(s.item); break;
      case 'weapon': {
        const displaced = p.takeWeapon(s.weapon);
        game.onWeaponTaken(s.weapon);
        if (displaced) new WeaponDrop(game, this.chamber, displaced, w.group.position.clone().addScaledVector(this.fwd, 1.1));
        break;
      }
      case 'key': p.keys++; game.hud.toast('Iron Key', 'Opens a gilded chest or a locked gate', 0xd0d8e8); break;
      case 'vial': p.hp = Math.min(p.stats.maxHp, p.hp + 35); game.onFlaskDrunk(); break;
      case 'flask': p.flasks = Math.min(p.maxFlasks, p.flasks + 1); game.hud.toast('Crimson Refill', 'One flask refilled', 0xe0203a); break;
    }
    w.markSold();
    this.merchant.say('buy');
    this.merchant.setMood('delight');
    if (this.mode === 'coin') game.audio.play('buy');
    // Payment streams from the customer to the trader: coin, blood, or light.
    const from = w.anchor;
    const to = this.merchant.headWorld().add(_v.set(0, -0.8, 0));
    const pay = this.mode === 'vigor' ? [0xe02030, 0x800010] : this.mode === 'gift' ? [0xfff0c0, 0xffffff] : [0xf0c040, 0xffe080];
    for (let k = 0; k < 24; k++) {
      const q = from.clone().lerp(to, k / 24);
      game.glow.emit({ pos: q, vel: new THREE.Vector3(rand(-0.5, 0.5), rand(0.5, 2), rand(-0.5, 0.5)), life: rand(0.4, 0.9), size: rand(0.04, 0.07), color: pick(pay) });
    }
    game.glow.burst(from, 30, () => ({
      vel: new THREE.Vector3(rand(-2, 2), rand(1, 4), rand(-2, 2)), life: rand(0.5, 1), size: rand(0.04, 0.08), color: this.wares[this.sel].spec.kind === 'item' ? s.item.color : 0xf0c040, drag: 2,
    }));
    this.render();
    this.buildTags();
  }

  // ---- HTML layer ----------------------------------------------------------------

  render() {
    const ui = Shop.ui, p = this.game.player;
    ui.wallet.innerHTML = '';
    if (this.mode === 'vigor') {
      const v = document.createElement('span');
      v.className = 'wallet-vigor';
      v.textContent = `${Math.ceil(p.hp)} / ${p.stats.maxHp} vigor`;
      ui.wallet.append(v);
    } else if (this.mode === 'gift') {
      const g = document.createElement('span');
      g.className = 'wallet-grace';
      g.textContent = this.wares.some((w) => w.sold) ? 'Grace received' : 'Choose one gift';
      ui.wallet.append(g);
    } else {
      const coin = document.createElement('span');
      coin.className = 'wallet-coins';
      coin.textContent = p.coins;
      const key = document.createElement('span');
      key.className = 'wallet-keys';
      key.textContent = p.keys;
      ui.wallet.append(coin, key);
    }
    ui.list.replaceChildren();
    const soldWord = this.mode === 'vigor' ? 'Sealed' : this.mode === 'gift' ? (/* chosen or faded */ '') : 'Sold';
    this.wares.forEach((w, i) => {
      const li = document.createElement('li');
      li.className = `shop-row${i === this.sel ? ' sel' : ''}${w.sold ? ' sold' : ''}${!w.sold && !this.affordable(w.spec) ? ' poor' : ''}`;
      const name = document.createElement('span');
      name.className = 'row-name';
      name.textContent = w.spec.name;
      name.style.color = w.sold ? '' : w.spec.color;
      const price = document.createElement('span');
      price.className = `row-price ${this.mode}`;
      price.textContent = w.sold ? (soldWord || (w.faded ? 'Faded' : 'Chosen')) : this.mode === 'vigor' ? `−${w.spec.price} max` : this.mode === 'gift' ? 'Gift' : w.spec.price;
      li.append(name, price);
      li.addEventListener('mouseenter', () => { if (this.sel !== i) this.select(i); });
      li.addEventListener('click', () => { this.select(i, true); this.buy(); });
      ui.list.append(li);
    });
    const w = this.wares[this.sel];
    ui.detail.replaceChildren();
    const h = document.createElement('div');
    h.className = 'detail-name';
    h.textContent = w.spec.name;
    h.style.color = w.spec.color;
    const d = document.createElement('div');
    d.className = 'detail-desc';
    d.textContent = w.sold ? (w.faded ? 'It faded when you chose another.' : 'Already taken.') : w.spec.desc;
    ui.detail.append(h, d);
    if (w.spec.kind === 'item' && w.spec.item.mech) {
      const tag = document.createElement('div');
      tag.className = 'detail-mech';
      tag.textContent = 'Changes how you fight';
      ui.detail.append(tag);
    }
  }

  buildTags() {
    const ui = Shop.ui;
    ui.tags.replaceChildren();
    this.tagEls = this.wares.map((w) => {
      const el = document.createElement('div');
      el.className = `shop-tag${w.sold ? ' sold' : ''}`;
      el.textContent = w.sold ? 'sold' : w.spec.name;
      ui.tags.append(el);
      return el;
    });
  }

  /** Called every frame while the trading view is up (or easing in/out of it). */
  update(dt) {
    const game = this.game;
    const cam = game.camera;
    if (this.closing) {
      this.camK = Math.max(0, this.camK - dt * 2.2);
      if (this.camK <= 0) {
        this.open = false;
        game.closeShop();
        return;
      }
    } else this.camK = Math.min(1, this.camK + dt * 1.8);
    const k = easeInOut(this.camK);
    // Blend from the knight's eyes to the framed shot; the selection pulls the gaze slightly.
    const pl = game.player;
    pl.updateCamera(0, 0);
    const eyePos = cam.position.clone(), eyeQuat = cam.quaternion.clone();
    const sel = this.wares[this.sel];
    const lookAt = this.camLook.clone().lerp(sel.anchor, 0.18);
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(this.camPos, lookAt, new THREE.Vector3(0, 1, 0)));
    this.camQuat.slerp(quat, 1 - Math.exp(-4 * dt));
    cam.position.lerpVectors(eyePos, this.camPos, k);
    cam.quaternion.slerpQuaternions(eyeQuat, this.camQuat, k);
    cam.position.y += Math.sin(game.time * 0.8) * 0.02 * k;

    this.wares.forEach((w, i) => w.update(dt, this.open && !this.closing && i === this.sel));
    if (this.closing || !this.tagEls) return;
    // World-anchored UI: name tags under each ware, brackets around the chosen one.
    const W = window.innerWidth, H = window.innerHeight;
    this.wares.forEach((w, i) => {
      _v.copy(w.group.position).setY(w.group.position.y + 0.2).project(cam);
      const el = this.tagEls[i];
      el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * W}px, ${(-_v.y * 0.5 + 0.5) * H}px) translate(-50%, 0)`;
      el.classList.toggle('sel', i === this.sel);
    });
    const a = sel.anchor;
    const top = a.clone().setY(a.y + 0.45).project(cam), bot = a.clone().setY(a.y - 0.45).project(cam);
    _v.copy(a).project(cam);
    const size = Math.max(40, Math.abs(top.y - bot.y) * 0.5 * H);
    const pulse = 1 + Math.sin(game.time * 6) * 0.05;
    Shop.ui.bracket.style.width = Shop.ui.bracket.style.height = `${size * pulse}px`;
    Shop.ui.bracket.style.transform = `translate(${(_v.x * 0.5 + 0.5) * W}px, ${(-_v.y * 0.5 + 0.5) * H}px) translate(-50%, -50%)`;
    Shop.ui.bracket.classList.toggle('sold', sel.sold);
  }

  /** The world ticks the merchant and wares even when nobody is trading. */
  tick(dt) {
    this.merchant.update(dt, this.open);
    if (!this.open) for (const w of this.wares) w.update(dt, false);
  }
}
