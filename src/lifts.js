import * as THREE from 'three';
import { rand, clamp, easeInOut } from './util.js';

let nextId = 1;

/**
 * A lift: an iron cage platform riding a shaft between two heights. Step on and it carries
 * you to the other end; stand at an empty landing and it comes to you. Its walkable surface is
 * shared by every chamber world that absorbed it, so all copies are moved together.
 */
export class Lift {
  constructor(game, parent, x, z, lowY, highY, { startHigh = true, angle = 0, w = 3.4, d = 3.4 } = {}) {
    this.game = game;
    this.id = `lift${nextId++}`;
    this.x = x;
    this.z = z;
    this.lowY = lowY;
    this.highY = highY;
    this.y = startHigh ? highY : lowY;
    this.target = this.y;
    this.from = this.y;
    this.t = 1;
    this.wait = 0;
    this.angle = angle;
    this.w = w;
    this.d = d;
    this.copies = [];
    this.moving = false;
    const M = game.materials;

    this.group = new THREE.Group();
    parent.add(this.group);
    // The shaft: four iron posts from the bottom landing to above the top, with cross-braces.
    const frame = new THREE.Group();
    frame.position.set(x, 0, z);
    frame.rotation.y = angle;
    this.group.add(frame);
    const top = highY + 4.5, h = top - lowY;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), M.iron);
      post.position.set(sx * (w / 2 + 0.2), lowY + h / 2, sz * (d / 2 + 0.2));
      post.castShadow = true;
      frame.add(post);
    }
    for (let y = lowY + 3; y < top; y += 4) {
      for (const [ax, az, len, rot] of [[0, d / 2 + 0.2, w + 0.4, 0], [0, -d / 2 - 0.2, w + 0.4, 0]]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), M.iron);
        brace.position.set(ax, y, az);
        brace.rotation.y = rot;
        frame.add(brace);
      }
    }
    // Landing gates: an iron fence round the shaft at each end. It sinks into the floor once the
    // car has arrived there, and rises again as soon as the car leaves.
    this.fences = {};
    this.fenceOpen = { high: startHigh ? 1 : 0, low: startHigh ? 0 : 1 };
    for (const level of ['high', 'low']) {
      const fence = new THREE.Group();
      fence.position.y = level === 'high' ? highY : lowY;
      frame.add(fence);
      for (const [sx, sz, len, rot] of [[0, 1, w, 0], [0, -1, w, 0], [1, 0, d, Math.PI / 2], [-1, 0, d, Math.PI / 2]]) {
        const panel = new THREE.Group();
        panel.position.set(sx * (w / 2 + 0.05), 0, sz * (d / 2 + 0.05));
        panel.rotation.y = rot;
        fence.add(panel);
        for (const y of [0.15, 1.2]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), M.iron);
          rail.position.y = y;
          panel.add(rail);
        }
        for (let bx = -len / 2 + 0.2; bx <= len / 2 - 0.19; bx += 0.3) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.05), M.iron);
          bar.position.set(bx, 0.65, 0);
          panel.add(bar);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), M.iron);
          tip.position.set(bx, 1.37, 0);
          panel.add(tip);
        }
      }
      this.fences[level] = fence;
    }

    // The headframe: a wheel and a beam across the top.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.35, 0.35), M.iron);
    beam.position.set(0, top, 0);
    frame.add(beam);
    this.wheel = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.08, 5, 14), M.iron);
    this.wheel.position.set(0, top - 0.2, 0);
    frame.add(this.wheel);

    // The platform itself, with a railing on two sides and a lantern.
    this.car = new THREE.Group();
    this.car.position.set(x, this.y, z);
    this.car.rotation.y = angle;
    this.group.add(this.car);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), M.trim);
    deck.position.y = -0.125;
    deck.receiveShadow = deck.castShadow = true;
    this.car.add(deck);
    for (let i = -2; i <= 2; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.04, 0.12), M.iron);
      slat.position.set(0, 0.01, i * d * 0.2);
      this.car.add(slat);
    }
    this.chain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), M.iron);
    this.group.add(this.chain);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.2), M.flame);
    lamp.position.set(w / 2 - 0.2, 1.3, d / 2 - 0.2);
    this.car.add(lamp);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), M.iron);
    pole.position.set(w / 2 - 0.2, 0.6, d / 2 - 0.2);
    this.car.add(pole);
  }

  /** Register the lift's surface in a scratch world (before it is absorbed into chambers). */
  addTo(world) {
    const s = world.addRect(this.x, this.z, this.w / 2, this.d / 2, this.y, { angle: this.angle, thick: 0.5, parapet: false, tag: 'lift' });
    s.liftId = this.id;
    // The pit floor at the bottom, so you can wait there for the car.
    world.addRect(this.x, this.z, this.w / 2, this.d / 2, this.lowY, { angle: this.angle, thick: 1.4, parapet: false, tag: 'liftbase' });
    // Barriers across each landing, closed unless the car rests there — no stepping into the shaft.
    const x0 = this.x - this.w / 2, x1 = this.x + this.w / 2, z0 = this.z - this.d / 2, z1 = this.z + this.d / 2;
    world.addBox(x0, z0, x1, z1, this.highY - 1, this.highY + 2.5).liftBar = `${this.id}:high`;
    world.addBox(x0, z0, x1, z1, this.lowY + 0.3, this.lowY + 2.5).liftBar = `${this.id}:low`;
    return s;
  }

  /** After absorption: find this lift's surface and barriers in each world that took a copy. */
  bind(worlds) {
    this.bars = { high: [], low: [] };
    for (const w of worlds) {
      for (const s of w.surfaces) if (s.liftId === this.id) this.copies.push({ w, s });
      for (const b of w.boxes) {
        if (b.liftBar === `${this.id}:high`) this.bars.high.push(b);
        if (b.liftBar === `${this.id}:low`) this.bars.low.push(b);
      }
    }
    this.addGuards(worlds);
  }

  /**
   * Walls round the car so a rider can only step off where there is ground to step onto: a side
   * is walled at a landing unless some floor meets it at that height, and every side is walled
   * between the landings.
   */
  addGuards(worlds) {
    const hw = this.w / 2, hd = this.d / 2, T = 0.3;
    const sides = [
      { n: [1, 0], box: [hw, -hd, hw + T, hd], along: [0, 1], half: hd },
      { n: [-1, 0], box: [-hw - T, -hd, -hw, hd], along: [0, 1], half: hd },
      { n: [0, 1], box: [-hw, hd, hw, hd + T], along: [1, 0], half: hw },
      { n: [0, -1], box: [-hw, -hd - T, hw, -hd], along: [1, 0], half: hw },
    ];
    const ground = (side, y) => {
      for (const t of [-0.6, 0, 0.6]) {
        const x = this.x + side.n[0] * (side.half === hd ? hw : hd) + side.n[0] * 0.8 + side.along[0] * t * side.half;
        const z = this.z + side.n[1] * (side.half === hd ? hw : hd) + side.n[1] * 0.8 + side.along[1] * t * side.half;
        for (const w of worlds) {
          const g = w.groundAt(x, z, y + 0.5);
          if (g !== null && Math.abs(g - y) < 0.5) return true;
        }
      }
      return false;
    };
    const walls = [];
    for (const side of sides) {
      for (const y of [this.lowY, this.highY]) {
        if (!ground(side, y)) walls.push([side.box, y - 0.4, y + 2.5]);
      }
      // Between the landings (clear of a rider standing at either end).
      if (this.highY - this.lowY > 4.8) walls.push([side.box, this.lowY + 2.1, this.highY - 2.1]);
    }
    for (const w of worlds) {
      for (const [[x0, z0, x1, z1], y0, y1] of walls) {
        w.addBox(this.x + x0 - w.ox, this.z + z0 - w.oz, this.x + x1 - w.ox, this.z + z1 - w.oz, y0 - w.oy, y1 - w.oy).liftGuard = this.id;
      }
    }
  }

  onDeck(p) {
    const dx = p.pos.x - this.x, dz = p.pos.z - this.z;
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
    return Math.abs(lx) < this.w / 2 + 0.2 && Math.abs(lz) < this.d / 2 + 0.2;
  }

  go(to) {
    if (this.moving || Math.abs(to - this.y) < 0.01) return;
    this.from = this.y;
    this.target = to;
    this.t = 0;
    this.moving = true;
    this.game.audio.play('lift');
  }

  update(dt) {
    const p = this.game.player;
    const near = Math.hypot(p.pos.x - this.x, p.pos.z - this.z);
    if (!this.moving) {
      const riding = this.onDeck(p) && Math.abs(p.pos.y - this.y) < 0.4 && p.grounded;
      if (riding) {
        this.wait += dt;
        if (this.wait > 0.55) this.go(Math.abs(this.y - this.highY) < 0.1 ? this.lowY : this.highY);
      } else this.wait = 0;
      // Waiting at the far landing: call the car.
      if (!riding && near < 5.5 && p.grounded) {
        const other = Math.abs(this.y - this.highY) < 0.1 ? this.lowY : this.highY;
        if (Math.abs(p.pos.y - other) < 1.2 && Math.abs(p.pos.y - this.y) > 1.2) this.go(other);
      }
    } else {
      const dist = Math.abs(this.target - this.from);
      this.t = Math.min(1, this.t + (dt * 5.5) / Math.max(1, dist));
      this.y = this.from + (this.target - this.from) * easeInOut(this.t);
      if (this.t >= 1) {
        this.moving = false;
        // Linger at the landing long enough for the gate to open and the rider to step off.
        this.wait = -1.8;
        this.game.audio.play('lift-stop');
      }
    }
    for (const { w, s } of this.copies) {
      s.y = s.top = this.y - w.oy;
      s.bottom = s.y - 0.5;
    }
    // Landing gates. A landing opens once the car has come to rest there, and closes the moment
    // it leaves. The rider is never fenced in: while you stand on the car, neither gate blocks you
    // (otherwise the arriving landing's gate would shove you off the deck on the way in).
    const riding = this.onDeck(p) && Math.abs(p.pos.y - this.y) < 0.6;
    const atHigh = !this.moving && Math.abs(this.y - this.highY) < 0.05;
    const atLow = !this.moving && Math.abs(this.y - this.lowY) < 0.05;
    if (this.bars) {
      for (const b of this.bars.high) b.enabled = !atHigh && !riding;
      for (const b of this.bars.low) b.enabled = !atLow && !riding;
    }
    for (const [level, open] of [['high', atHigh], ['low', atLow]]) {
      const was = this.fenceOpen[level];
      this.fenceOpen[level] = Math.max(0, Math.min(1, was + (open ? dt * 2.5 : -dt * 4)));
      if (was < 0.5 && this.fenceOpen[level] >= 0.5 && Math.hypot(p.pos.x - this.x, p.pos.z - this.z) < 20) this.game.audio.play('gate');
      const f = this.fences[level];
      f.position.y = (level === 'high' ? this.highY : this.lowY) - easeInOut(this.fenceOpen[level]) * 1.45;
      f.visible = this.fenceOpen[level] < 0.999;
    }
    this.car.position.y = this.y;
    this.wheel.rotation.z = this.y * 0.8;
    const top = this.highY + 4.3;
    this.chain.scale.y = Math.max(0.1, top - this.y - 1.5);
    this.chain.position.set(this.x, (top + this.y + 1.5) / 2, this.z);
  }
}

/**
 * A shortcut: a portcullis in a passage, with a lever on one side only. From the far side it
 * is a dead end ("opens from the other side"); pull the lever and the way is open for good.
 */
export class ShortcutGate {
  constructor(game, parent, x, y, z, rot, lever) {
    this.game = game;
    this.id = `gate${nextId++}`;
    this.open = false;
    this.t = 0;
    this.x = x;
    this.y = y;
    this.z = z;
    this.rot = rot;
    const M = game.materials;
    this.bars = new THREE.Group();
    this.bars.position.set(x, y, z);
    this.bars.rotation.y = rot;
    parent.add(this.bars);
    for (let bx = -1.9; bx <= 1.91; bx += 0.32) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.4, 0.08), M.iron);
      bar.position.set(bx, 2.2, 0);
      this.bars.add(bar);
    }
    for (const by of [0.6, 2.2, 3.8]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 0.1), M.iron);
      rail.position.set(0, by, 0);
      this.bars.add(rail);
    }
    // Stone jambs and a lintel carry it.
    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.2, 0.8), M.trim);
      const off = new THREE.Vector3(s * 2.3, 2.6, 0).applyEuler(new THREE.Euler(0, rot, 0));
      jamb.position.set(x + off.x, y + off.y, z + off.z);
      jamb.rotation.y = rot;
      jamb.castShadow = true;
      parent.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.6, 0.8), M.trim);
    lintel.position.set(x, y + 5.2, z);
    lintel.rotation.y = rot;
    parent.add(lintel);
    // The lever, on the side the shortcut is opened from.
    this.lever = lever;
    const lv = new THREE.Group();
    lv.position.copy(lever.pos);
    parent.add(lv);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), M.trim);
    base.position.y = 0.45;
    lv.add(base);
    this.handle = new THREE.Group();
    this.handle.position.y = 0.9;
    lv.add(this.handle);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), M.iron);
    arm.position.y = 0.45;
    this.handle.add(arm);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), M.gold);
    knob.position.y = 0.9;
    this.handle.add(knob);
    this.handle.rotation.x = 0.6;
    this.copies = [];
    this.position = lever.pos.clone();
    this.radius = 2.4;
    this.far = { position: lever.farPos.clone(), radius: 3, prompt: 'Opens from the other side', sub: 'A shortcut, barred on this side', interact: () => game.audio.play('locked'), promptColor: '#8a8272' };
  }

  get prompt() { return 'Pull the lever'; }
  get sub() { return 'Opens a shortcut'; }
  get promptColor() { return '#c9a45c'; }

  addTo(world) {
    const ca = Math.cos(this.rot), sa = Math.sin(this.rot);
    const hw = 2.2, hd = 0.35;
    // The bars as an axis-aligned box (passages run along an axis).
    const ex = Math.abs(ca) * hw + Math.abs(sa) * hd, ez = Math.abs(sa) * hw + Math.abs(ca) * hd;
    const b = world.addBox(this.x - ex, this.z - ez, this.x + ex, this.z + ez, this.y - 1, this.y + 5);
    b.gateId = this.id;
  }

  bind(worlds) {
    for (const w of worlds) for (const b of w.boxes) if (b.gateId === this.id) this.copies.push(b);
  }

  interact() {
    if (this.open) return;
    this.open = true;
    for (const b of this.copies) b.enabled = false;
    // Nothing left to pull, and nothing barred any more: drop both prompts.
    for (const [list, item] of this.lists || []) {
      const i = list.indexOf(item);
      if (i >= 0) list.splice(i, 1);
    }
    this.game.audio.play('gate');
    this.game.audio.play('unlock');
    this.game.hud.toast('Shortcut opened', 'The way back is short now', 0xc9a45c);
    this.game.shake(0.2);
  }

  update(dt) {
    this.handle.rotation.x += ((this.open ? -0.6 : 0.6) - this.handle.rotation.x) * Math.min(1, dt * 6);
    if (!this.open || this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / 1.4);
    this.bars.position.y = this.y + this.t * this.t * 4.6;
  }
}
