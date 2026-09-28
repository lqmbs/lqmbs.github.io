import * as THREE from 'three';
import { rand, pick, chance, TAU } from './util.js';
import { Pillar, Tornado, Singularity, Beam, DemonArm, Familiar, Nova, additive } from './vfx.js';
import { applyBleed, applyChill, applyOil, applyCurse, applyShock, freeze, statusOf } from './status.js';

/**
 * The relics that change how you play. None of them are plain numbers: each one listens for
 * something (a swing, a hit, a parry, a kill, a jump, a landing, a dodge, a charged blow, a plunge,
 * an execution, a flask, a wound, a status bursting) and answers with something you can see.
 *
 * Every relic carries tags. Three relics sharing a tag *resonate* (see RESONANCES) — the build
 * becomes more than the sum of its parts. Statuses (status.js) are the other glue: bleed feeds
 * hemorrhage relics, chill feeds shatter relics, oil feeds fire relics, curse feeds everything.
 *
 * Hook signature: (fx, n, ctx, mem) — fx is the knight's BuildFX, n how many copies are owned,
 * ctx the event, mem a scratch object private to the relic.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const chest = (e) => e.pos.clone().setY(e.pos.y + e.height * 0.6);

/** A lightning bolt from the sky onto a foe. */
function smite(fx, e, dmg, { color = 0xd8f0ff, core = 0xffffff, radius = 1.2, sound = 'thunderclap' } = {}) {
  const g = fx.game;
  g.addEffect(new Pillar(g, e.pos, { color, core, radius: 0.5, life: 0.35 }));
  g.audio.play(sound);
  g.shake(0.2);
  fx.aoe(e.pos, radius, dmg, { knock: 2 });
}

/** A crescent of force loosed along the knight's aim. */
function crescent(fx, dmg, color = 0xfff0c0, size = 1.1) {
  const p = fx.player;
  fx.bolt(fx.muzzle, p.aim, color, { damage: dmg, speed: 19, pierce: true, shape: 'crescent', size, life: 0.9 });
}

/** A ring of homing projectiles bursting from a point. */
function spray(fx, from, n, color, dmg, opts = {}) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.2, 0.2);
    fx.bolt(from, V(Math.cos(a), rand(0.1, 0.4), Math.sin(a)).normalize(), color, { damage: dmg, speed: opts.speed ?? 11, homing: opts.homing ?? 5, size: opts.size ?? 0.8, life: 2.2, onHit: opts.onHit });
  }
}

// ---- Familiars ------------------------------------------------------------------

function wispFamiliar(fx, i) {
  return new Familiar(fx.game, {
    slot: i, of: 3, height: 2.2,
    build: (g) => {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: 0xffb040, fog: false })));
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), additive(0xff6a20, 0.35)));
    },
    act: (f) => {
      if (Math.random() < 0.3) fx.game.glow.emit({ pos: f.pos.clone(), vel: V(rand(-0.3, 0.3), rand(0.4, 1), rand(-0.3, 0.3)), life: 0.5, size: 0.05, color: 0xff7a2a });
      if (f.timer > 0) return;
      const e = f.nearest(12);
      f.timer = e ? 1.4 : 0.4;
      if (!e) return;
      fx.bolt(f.pos.clone(), chest(e).sub(f.pos).normalize(), 0xff7a2a, { damage: 9, speed: 14, homing: 5, burn: 4, size: 0.9, onHit: (t) => t.ignite(3, 5) });
      fx.game.audio.play('cast-player');
    },
  });
}

function ravenFamiliar(fx, i) {
  return new Familiar(fx.game, {
    slot: i, of: 3, height: 2.5, dist: 1.6,
    build: (g) => {
      const black = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.6, flatShading: true });
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 4), black);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.16), black);
        w.position.x = s * 0.22;
        w.userData.wing = s;
        g.add(w);
      }
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff2010 }));
      eye.position.set(0, 0.04, 0.16);
      g.add(eye);
    },
    act: (f, dt) => {
      for (const c of f.group.children) if (c.userData.wing) c.rotation.z = Math.sin(f.t * 16) * 0.6 * c.userData.wing;
      const m = fx.mem.raven || (fx.mem.raven = {});
      // Dive on whatever the knight last struck.
      if (f.dive) {
        f.dive.t += dt;
        const e = f.dive.e;
        const k = f.dive.t / 0.35;
        f.group.position.lerp(chest(e), Math.min(1, dt * 12));
        if (k >= 1 || !e.active) {
          if (e.active) {
            fx.hurt(e, 7, { knock: 0.5 });
            applyBleed(fx.game, e, 2);
            fx.game.audio.play('caw');
          }
          f.dive = null;
          f.timer = 1.2;
        }
        return;
      }
      if (f.timer <= 0 && m.mark?.active && m.mark.pos.distanceTo(f.pos) < 16) f.dive = { e: m.mark, t: 0 };
    },
  });
}

function orbFamiliar(fx, i) {
  return new Familiar(fx.game, {
    slot: i, of: 3, height: 1.9,
    build: (g) => {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshBasicMaterial({ color: 0xc8e8ff, fog: false })));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.015, 4, 20), additive(0x9ad8ff, 0.8));
      ring.userData.spin = true;
      g.add(ring);
    },
    act: (f, dt) => {
      for (const c of f.group.children) if (c.userData.spin) { c.rotation.x += dt * 4; c.rotation.y += dt * 3; }
      if (f.timer > 0) return;
      const e = f.nearest(10);
      f.timer = e ? 1.1 : 0.4;
      if (!e) return;
      fx.game.addEffect(new fx.Lightning(fx.game, f.pos.clone(), chest(e)));
      fx.hurt(e, 8, { knock: 0.5 });
      if (e.alive) applyShock(fx.game, e, 3);
      fx.game.audio.play('zap');
    },
  });
}

function angelFamiliar(fx, i) {
  return new Familiar(fx.game, {
    slot: i, of: 3, height: 2.6, dist: 1.4,
    build: (g) => {
      const white = new THREE.MeshBasicMaterial({ color: 0xfff8e8, fog: false });
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 6), white);
      g.add(robe);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), white);
      head.position.y = 0.27;
      g.add(head);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 4, 16), new THREE.MeshBasicMaterial({ color: 0xffe080, fog: false }));
      halo.position.y = 0.4;
      halo.rotation.x = Math.PI / 2;
      g.add(halo);
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), additive(0xfff0c0, 0.7));
        w.position.set(s * 0.2, 0.1, -0.05);
        w.rotation.z = s * 1.1;
        w.userData.wing = s;
        g.add(w);
      }
    },
    act: (f, dt) => {
      for (const c of f.group.children) if (c.userData.wing) c.rotation.z = c.userData.wing * (1.1 + Math.sin(f.t * 5) * 0.3);
      const p = fx.player;
      // Mends the wounded knight, gently.
      if (p.hp < p.stats.maxHp * 0.5 && p.alive) p.hp = Math.min(p.stats.maxHp, p.hp + dt * 1.2);
      if (f.timer > 0) return;
      const e = f.nearest(12);
      f.timer = e ? 2.2 : 0.5;
      if (!e) return;
      fx.game.addEffect(new Pillar(fx.game, e.pos, { color: 0xfff0b0, radius: 0.45, life: 0.4 }));
      fx.hurt(e, 14, { knock: 1 });
      fx.game.audio.play('halo');
    },
  });
}

// ---- Whirlwind -------------------------------------------------------------------

/** The Whirling Chain: spin, cutting everything near, and keep spinning while blows keep landing. */
class Whirl {
  constructor(fx, base) {
    this.fx = fx;
    this.t = 0;
    this.left = 1.1;
    this.tick = 0;
    this.base = base;
    this.mat = additive(0xd8e0ff, 0.5);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 4, 40, TAU * 0.7), this.mat);
    this.ring.rotation.x = Math.PI / 2;
    fx.game.scene.add(this.ring);
    fx.player.setState('whirl');
    fx.game.audio.play('whirl');
  }

  update(dt) {
    const fx = this.fx, p = fx.player, g = fx.game;
    this.t += dt;
    this.left -= dt;
    this.ring.position.set(p.pos.x, p.pos.y + 1, p.pos.z);
    this.ring.rotation.z += dt * 18;
    this.mat.opacity = 0.35 + 0.15 * Math.sin(this.t * 30);
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.18;
      const hit = fx.nearby(p.pos, 2.6);
      for (const e of hit) {
        fx.hurt(e, this.base * 0.45, { knock: 3.5, result: 'hit' });
        fx.fire('whirlHit', { e });
      }
      if (hit.length) this.left = Math.min(this.left + 0.22, 1.2); // it keeps going as long as it bites
      g.audio.play('swing');
      g.sparks(p.pos.clone().setY(p.pos.y + 1).add(V(rand(-2, 2), 0, rand(-2, 2))), 4, 0xd8e0ff, 3);
    }
    if (this.left <= 0 || this.t > 6 || p.state !== 'whirl') {
      if (p.state === 'whirl') p.setState('idle');
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.fx.game.scene.remove(this.ring);
    this.ring.geometry.dispose();
    this.mat.dispose();
  }
}

/** A patch of fire left in the knight's wake: it burns foes, never the knight. */
class EmberPatch {
  constructor(fx, pos, burn) {
    this.fx = fx;
    this.pos = pos.clone();
    this.burn = burn;
    this.t = 0;
    this.tick = 0;
    this.mat = additive(0xff6a20, 0.45);
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(0.8, 12).rotateX(-Math.PI / 2), this.mat);
    this.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    fx.game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    this.mat.opacity = 0.45 * Math.max(0, 1 - this.t / 2.5);
    if (Math.random() < dt * 14) this.fx.game.glow.emit({ pos: this.pos.clone().add(V(rand(-0.5, 0.5), 0.1, rand(-0.5, 0.5))), vel: V(0, rand(1, 2), 0), life: 0.5, size: 0.06, color: pick([0xff6a20, 0xffb040]) });
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.4;
      for (const e of this.fx.nearby(this.pos, 0.9, { maxDy: 1.5 })) e.ignite(3, this.burn);
    }
    if (this.t > 2.5) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.fx.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** A lingering decoy of the knight that draws blows, then bursts. */
class Decoy {
  constructor(fx, pos) {
    this.fx = fx;
    this.t = 0;
    this.pos = pos.clone();
    this.mat = additive(0x8a60ff, 0.4);
    this.group = new THREE.Group();
    for (const [w, h, y] of [[0.5, 0.75, 1.15], [0.26, 0.28, 1.68], [0.4, 0.8, 0.4]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), this.mat);
      m.position.y = y;
      this.group.add(m);
    }
    this.group.position.copy(pos);
    fx.game.scene.add(this.group);
  }

  update(dt) {
    this.t += dt;
    this.mat.opacity = 0.4 * (0.7 + 0.3 * Math.sin(this.t * 12));
    if (this.t < 1.6) return true;
    const fx = this.fx, g = fx.game;
    g.addEffect(new Nova(g, this.pos, { radius: 3.2, color: 0x8a60ff }));
    g.audio.play('void');
    fx.aoe(this.pos, 3.2, 26, { knock: 5, each: (e) => applyCurse(g, e) });
    this.dispose();
    return false;
  }

  dispose() {
    this.fx.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.mat.dispose();
  }
}

/** Soul wisps orbiting the knight, waiting to be flung. */
function soulWisps(fx, mem) {
  mem.wisps = mem.wisps || [];
  return mem.wisps;
}

// =====================================================================================
// The relics
// =====================================================================================

export const RELICS = [
  // ---- Blood -------------------------------------------------------------------------
  { id: 'thorn', name: 'Serrated Thorn', desc: 'Hits make foes bleed. Five wounds burst in a hemorrhage', lore: 'It was grown, not forged.', color: 0xc41e2a, shape: 'fang', pools: ['common', 'shop'], tags: ['blood'], mech: true,
    hooks: { hit: (fx, n, { e }) => { if (e.alive) applyBleed(fx.game, e, n); } } },
  { id: 'bloodmoon', name: 'Blood Moon Pendant', desc: 'Hemorrhages heal you and hurl blood-crescents at nearby foes', lore: 'The moon drinks too.', color: 0xa01020, shape: 'crescent', pools: ['common'], tags: ['blood'], mech: true,
    hooks: { hemorrhage: (fx, n, { e }) => {
      fx.heal(4 * n);
      const t = fx.nearest(e.pos, 9, e);
      if (t) fx.bolt(chest(e), chest(t).sub(chest(e)).normalize(), 0xd01830, { damage: 16 * n, speed: 16, pierce: true, shape: 'crescent', size: 0.8, onHit: (o) => applyBleed(fx.game, o, 2) });
    } } },
  { id: 'spores', name: 'Grave Spores', desc: 'Kills spread three bleeding wounds to everything nearby', lore: 'The dead are generous.', color: 0x9a3040, shape: 'bloom', pools: ['common'], tags: ['blood'], mech: true,
    hooks: { kill: (fx, n, { e }) => {
      const g = fx.game;
      g.glow.burst(chest(e), 24, () => ({ vel: V(rand(-4, 4), rand(0, 3), rand(-4, 4)), life: rand(0.5, 1), size: 0.07, color: pick([0x9a3040, 0xd04050]), drag: 2 }));
      for (const o of fx.nearby(e.pos, 4.5)) applyBleed(g, o, 2 + n);
    } } },
  { id: 'martyr', name: "Martyr's Wound", desc: 'When struck, a nova of blood-blades tears outward', lore: 'Every drop you lose, they lose ten.', color: 0x8a0818, shape: 'heart', pools: ['common', 'shop'], tags: ['blood'], mech: true,
    hooks: { hurt: (fx, n) => {
      const p = fx.player;
      fx.game.addEffect(new Nova(fx.game, p.pos, { radius: 4, color: 0xc41e2a }));
      spray(fx, p.eyePosition, 6 + 2 * n, 0xd01830, 10 * n, { homing: 2, speed: 13, onHit: (e) => applyBleed(fx.game, e, 1) });
      fx.game.audio.play('hemorrhage');
    } } },
  { id: 'thornmail', name: 'Thorn Mail', desc: 'Those who strike you bleed and take back a third of the blow', lore: 'Hug me, then.', color: 0x5a3030, shape: 'shield', pools: ['common'], tags: ['blood'], mech: true,
    hooks: { hurt: (fx, n, { attacker, damage }) => {
      if (!attacker?.active) return;
      fx.hurt(attacker, (damage || 10) * 0.33 * n, { knock: 2 });
      applyBleed(fx.game, attacker, 2);
    } } },

  // ---- Frost -------------------------------------------------------------------------
  { id: 'locket', name: 'Frostbitten Locket', desc: 'Hits chill. Three chills freeze a foe solid', lore: 'The portrait inside is of someone who never thawed.', color: 0x8ac8ff, shape: 'ring', pools: ['common', 'shop'], tags: ['frost'], mech: true,
    hooks: { hit: (fx, n, { e }) => { if (e.alive) applyChill(fx.game, e, n); } } },
  { id: 'icheart', name: 'Crystalline Heart', desc: 'Frozen foes shatter into a storm of ice shards', lore: 'Cold enough to cut.', color: 0xc8e8ff, shape: 'gem', pools: ['common'], tags: ['frost'], mech: true,
    hooks: { shatter: (fx, n, { e }) => {
      fx.game.audio.play('shatter');
      spray(fx, chest(e), 7 + n * 3, 0xc8e8ff, 11 * n, { homing: 3, speed: 15, onHit: (o) => applyChill(fx.game, o, 1) });
    } } },
  { id: 'rimeaegis', name: 'Rime Aegis', desc: 'Blocking chills the attacker; parries freeze it outright', lore: 'Frost remembers every touch.', color: 0x6aa8e0, shape: 'shield', pools: ['common'], tags: ['frost'], mech: true,
    hooks: {
      parry: (fx, n, { attacker }) => { if (attacker?.active && !attacker.isBoss) freeze(fx.game, attacker, 1.2 + 0.4 * n); else if (attacker?.active) applyChill(fx.game, attacker, 2); },
      block: (fx, n, { attacker }) => { if (attacker?.active) applyChill(fx.game, attacker, 1); },
    } },
  { id: 'wintertrail', name: 'Winter Trail', desc: 'Dodges and slides leave frost that chills whatever it touches', lore: 'Footprints in the air.', color: 0xa0d8ff, shape: 'feather', pools: ['common'], tags: ['frost', 'air'], mech: true,
    hooks: { dodge: (fx) => {
      const g = fx.game, p = fx.player;
      g.addEffect(new Nova(g, p.pos, { radius: 3, color: 0x8ac8ff, height: 0.4 }));
      for (const e of fx.nearby(p.pos, 3)) applyChill(g, e, 2);
    } } },

  // ---- Fire --------------------------------------------------------------------------
  { id: 'tarcenser', name: 'Tar Censer', desc: 'Hits douse foes in oil. Any flame makes them explode', lore: 'Its smoke is sweeter than it should be.', color: 0x3a2a1a, shape: 'lantern', pools: ['common', 'shop'], tags: ['fire'], mech: true,
    hooks: { hit: (fx, n, { e }) => { if (e.alive && !statusOf(e).oil) applyOil(fx.game, e); } } },
  { id: 'pyrecrown', name: 'Pyre Crown', desc: 'Burning foes explode when they die', lore: 'Every coronation ends in fire.', color: 0xff5a10, shape: 'crown', pools: ['common'], tags: ['fire'], mech: true,
    hooks: { kill: (fx, n, { e }) => {
      if (!(e.burnTime > 0)) return;
      const g = fx.game;
      g.addEffect(new Nova(g, e.pos, { radius: 3.5, color: 0xff6a20 }));
      g.glow.burst(chest(e), 40, () => ({ vel: V(rand(-6, 6), rand(1, 6), rand(-6, 6)), life: rand(0.3, 0.8), size: rand(0.07, 0.14), color: pick([0xff6a20, 0xffb040]), drag: 2 }));
      g.audio.play('detonate');
      fx.aoe(e.pos, 3.5, 18 * n, { knock: 4, each: (o) => o.ignite(3, 6) });
    } } },
  { id: 'emberwake', name: 'Ember Wake', desc: 'Dodges, slides and dashes leave a trail of fire', lore: 'Run, and the world burns behind you.', color: 0xff8a30, shape: 'feather', pools: ['common', 'shop'], tags: ['fire', 'air'], mech: true,
    hooks: {
      update: (fx, n, { dt }, mem) => {
        const p = fx.player;
        const moving = p.state === 'dodge' || p.state === 'slide' || p.airDashing;
        mem.t = (mem.t || 0) - dt;
        if (!moving || mem.t > 0) return;
        mem.t = 0.08;
        fx.game.addEffect(new EmberPatch(fx, p.pos, 5 * n));
      },
    } },
  { id: 'sunshard', name: 'Sun Shard', desc: 'A captive sun orbits you, setting everything it touches ablaze', lore: 'Small, but it remembers being huge.', color: 0xffd060, shape: 'star', pools: ['common', 'shop'], tags: ['fire', 'holy'], mech: true,
    hooks: { update: (fx, n, { dt }, mem) => {
      const g = fx.game, p = fx.player;
      if (!mem.suns) mem.suns = [];
      while (mem.suns.length < Math.min(3, n)) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshBasicMaterial({ color: 0xfff0a0, fog: false }));
        m.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), additive(0xffa030, 0.4)));
        g.scene.add(m);
        mem.suns.push({ m, hits: new Map() });
      }
      mem.a = (mem.a || 0) + dt * 2.4;
      mem.suns.forEach((s, i) => {
        const a = mem.a + (i / mem.suns.length) * TAU;
        s.m.position.set(p.pos.x + Math.cos(a) * 2.3, p.pos.y + 1.3, p.pos.z + Math.sin(a) * 2.3);
        s.m.visible = g.state !== 'title';
        if (Math.random() < dt * 20) g.glow.emit({ pos: s.m.position.clone(), vel: V(0, rand(0.5, 1.5), 0), life: 0.4, size: 0.06, color: 0xffb040 });
        for (const e of fx.nearby(s.m.position, 0.7, { maxDy: 2 })) {
          if (g.time - (s.hits.get(e) ?? -9) < 0.6) continue;
          s.hits.set(e, g.time);
          fx.hurt(e, 7, { from: s.m.position, knock: 2 });
          if (e.alive) e.ignite(3, 7);
        }
      });
    },
    } , onReset: (mem, g) => { for (const s of mem.suns || []) g.scene.remove(s.m); } },
  { id: 'wisp', name: 'Wisp of the Grave Lantern', desc: 'A fire-wisp follows you and flings fireballs', lore: "It was someone's last light.", color: 0xffa040, shape: 'orb', pools: ['common', 'shop'], tags: ['fire'], mech: true, familiar: wispFamiliar },
  { id: 'comet', name: 'Comet Greaves', desc: 'Landing from a height makes a burning crater. Falls cost nothing', lore: 'The sky kept throwing her back.', color: 0xff7040, shape: 'fang', pools: ['common'], tags: ['fire', 'air'], mech: true,
    apply: (s) => { s.fallImmune = true; },
    hooks: { land: (fx, n, { height }) => {
      if (height < 2.2) return;
      const g = fx.game, p = fx.player;
      const r = Math.min(6, 2 + height * 0.35);
      g.addEffect(new Nova(g, p.pos, { radius: r, color: 0xff6a20, height: 1.5 }));
      g.glow.burst(p.pos.clone().setY(p.pos.y + 0.3), 50, () => ({ vel: V(rand(-8, 8), rand(1, 6), rand(-8, 8)), life: rand(0.3, 0.8), size: rand(0.07, 0.15), color: pick([0xff6a20, 0xffb040]), drag: 2 }));
      g.shake(0.5);
      g.audio.play('plunge');
      fx.aoe(p.pos, r, (12 + height * 2) * n, { knock: 6, each: (e) => e.ignite(3, 8) });
    } } },

  // ---- Lightning ---------------------------------------------------------------------
  { id: 'thunderbrand', name: 'Thunder Brand', desc: 'Every fourth hit calls lightning down on your target', lore: 'The sky keeps count.', color: 0xc8e8ff, shape: 'bell', pools: ['common', 'shop'], tags: ['storm'], mech: true,
    hooks: { hit: (fx, n, { e }, mem) => {
      mem.c = (mem.c || 0) + 1;
      if (mem.c % 4) return;
      smite(fx, e, 22 * n);
      if (e.alive) applyShock(fx.game, e, 3);
    } } },
  { id: 'tempest', name: 'Tempest Pommel', desc: 'Charged blows loose a ring of chain lightning', lore: 'Grip it and your hair stands up.', color: 0xa8d8ff, shape: 'ring', pools: ['common'], tags: ['storm'], mech: true,
    hooks: { charged: (fx, n) => {
      const g = fx.game, p = fx.player;
      g.addEffect(new Nova(g, p.pos, { radius: 5, color: 0xc8e8ff }));
      for (const e of fx.nearby(p.pos, 5.5)) {
        g.addEffect(new fx.Lightning(g, p.eyePosition, chest(e)));
        fx.hurt(e, 14 * n, { knock: 3 });
        if (e.alive) applyShock(g, e, 3);
      }
      g.audio.play('zap');
    } } },
  { id: 'stormglass', name: 'Stormglass Orb', desc: 'A crackling orb follows you, zapping foes and charging them with shock', lore: 'A storm in a bottle, and the bottle is angry.', color: 0xd8f0ff, shape: 'orb', pools: ['common', 'shop'], tags: ['storm'], mech: true, familiar: orbFamiliar },
  { id: 'stormrider', name: 'Stormrider Greaves', desc: 'Sprinting builds a charge; your next hit discharges it as a thunderbolt', lore: 'Run long enough and the sky notices.', color: 0x9ac8ff, shape: 'feather', pools: ['common'], tags: ['storm', 'air'], mech: true,
    hooks: {
      update: (fx, n, { dt }, mem) => {
        const p = fx.player;
        if (p.sprinting) mem.charge = Math.min(1.5, (mem.charge || 0) + dt);
        if (mem.charge >= 1.5 && Math.random() < dt * 20) fx.game.glow.emit({ pos: p.pos.clone().setY(p.pos.y + rand(0, 1.5)).add(V(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))), vel: V(rand(-2, 2), rand(-1, 2), rand(-2, 2)), life: 0.15, size: 0.05, color: 0xd8f0ff });
      },
      hit: (fx, n, { e }, mem) => {
        if (!(mem.charge >= 1.5)) return;
        mem.charge = 0;
        smite(fx, e, 40 * n, { radius: 2.5 });
        fx.game.flash = Math.max(fx.game.flash, 0.4);
      },
    } },
  { id: 'lodestone', name: 'Lodestone Fragment', desc: 'Shocked foes are dragged towards each other when they discharge', lore: 'Everything wants to be close to it.', color: 0x8090c0, shape: 'shard', pools: ['common'], tags: ['storm'], mech: true,
    hooks: { discharge: (fx, n, { e }) => {
      for (const o of fx.nearby(e.pos, 6)) {
        if (o === e) continue;
        const d = e.pos.clone().sub(o.pos).setY(0);
        o.vel.addScaledVector(d.normalize(), 9 / Math.max(1, o.mass));
        o.knockTimer = 0.3;
      }
    } } },

  // ---- Shadow ------------------------------------------------------------------------
  { id: 'hexfrail', name: 'Hex of Frailty', desc: 'The first blow on each foe curses it: +30% damage taken', lore: 'Written in a hand that trembled with glee.', color: 0xb040ff, shape: 'tome', pools: ['common', 'shop'], tags: ['shadow'], mech: true,
    hooks: { hit: (fx, n, { e }) => { if (e.alive && !(statusOf(e).curse > 0)) applyCurse(fx.game, e, 6 + 3 * n); } } },
  { id: 'echoblade', name: 'Echo Blade', desc: 'A ghostly echo repeats every swing a moment later', lore: 'The blade remembers where it has been.', color: 0x9a80ff, shape: 'shard', pools: ['common', 'shop'], tags: ['shadow', 'blade'], mech: true,
    hooks: { swing: (fx, n) => {
      const p = fx.player, g = fx.game;
      const pos = p.pos.clone(), yaw = p.yaw, w = p.weapon;
      if (w.kind === 'cast' || w.kind === 'bow') return;
      setTimeout(() => {
        if (!p.alive) return;
        const reach = w.reach * p.stats.reach;
        const from = pos.clone().setY(pos.y + 1.2);
        g.addEffect(new Nova(g, pos, { radius: reach * 0.9, color: 0x9a80ff, height: 0.3, life: 0.25 }));
        for (const e of fx.nearby(pos, reach)) {
          const a = Math.atan2(-(e.pos.x - pos.x), -(e.pos.z - pos.z));
          const d = Math.abs(((a - yaw + Math.PI * 3) % TAU) - Math.PI);
          if (d > w.arc / 2 + 0.3) continue;
          fx.hurt(e, w.damage * 0.4 * n, { from, knock: 1.5 });
        }
        g.audio.play('echo');
      }, 280);
    } } },
  { id: 'phantomstep', name: 'Phantom Step', desc: 'Dodging leaves a shadow of you that bursts a moment later, cursing all nearby', lore: 'You were never there.', color: 0x8a60ff, shape: 'cloak', pools: ['common'], tags: ['shadow', 'air'], mech: true,
    hooks: { dodge: (fx, n, ctx, mem) => {
      const g = fx.game;
      if (g.time - (mem.last ?? -9) < 2.5 / n) return;
      mem.last = g.time;
      g.addEffect(new Decoy(fx, fx.player.pos));
    } } },
  { id: 'soullantern', name: 'Soul Lantern', desc: 'Kills leave soul-wisps circling you; dodges and charged blows fling them', lore: 'A lamp that burns what remains.', color: 0x80c0ff, shape: 'lantern', pools: ['common', 'shop'], tags: ['shadow'], mech: true,
    hooks: {
      kill: (fx, n, ctx, mem) => {
        const wisps = soulWisps(fx, mem);
        if (wisps.length >= 4 + 2 * n) return;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xa0d0ff, fog: false }));
        fx.game.scene.add(m);
        wisps.push(m);
      },
      update: (fx, n, { dt }, mem) => {
        const wisps = soulWisps(fx, mem), p = fx.player;
        mem.a = (mem.a || 0) + dt * 3;
        wisps.forEach((m, i) => {
          const a = mem.a + (i / wisps.length) * TAU;
          m.position.set(p.pos.x + Math.cos(a) * 1.2, p.pos.y + 1.4 + Math.sin(a * 2) * 0.2, p.pos.z + Math.sin(a) * 1.2);
          if (Math.random() < dt * 10) fx.game.glow.emit({ pos: m.position.clone(), vel: V(0, 0.3, 0), life: 0.4, size: 0.04, color: 0xa0d0ff });
        });
      },
      dodge: (fx, n, ctx, mem) => fling(fx, mem),
      charged: (fx, n, ctx, mem) => fling(fx, mem),
    }, onReset: (mem, g) => { for (const m of mem.wisps || []) g.scene.remove(m); } },
  { id: 'voidseed', name: 'Seed of the Void', desc: 'Every 10 s, your next charged blow opens a singularity that crushes all it swallows', lore: 'Plant it somewhere you never want to see again.', color: 0x5a20a0, shape: 'eye', pools: ['common', 'shop'], tags: ['shadow'], mech: true,
    hooks: { charged: (fx, n, ctx, mem) => {
      const g = fx.game;
      if (g.time - (mem.last ?? -99) < 10 / n) return;
      mem.last = g.time;
      const at = fx.player.pos.clone().addScaledVector(fx.player.forward, 3.5).setY(fx.player.pos.y + 1.2);
      g.addEffect(new Singularity(g, at, {
        radius: 6, life: 2,
        onPull: (e, dt) => { if (Math.random() < dt * 3) fx.hurt(e, 3, { from: at, knock: 0 }); },
        onCollapse: (c) => { g.audio.play('boss-slam'); fx.aoe(c, 3.5, 40, { knock: 8, each: (e) => applyCurse(g, e) }); },
      }));
    } } },

  // ---- Blade -------------------------------------------------------------------------
  { id: 'whirlchain', name: 'Whirling Chain', desc: 'Fully charged blows become a whirlwind that keeps spinning as long as it keeps hitting', lore: 'Once it starts, it does not want to stop.', color: 0xd8e0ff, shape: 'chain', pools: ['common', 'shop'], tags: ['blade'], mech: true,
    hooks: { charged: (fx, n, { full }) => {
      if (!full || fx.player.weapon.kind === 'cast' || fx.player.weapon.kind === 'bow') return;
      fx.game.addEffect(new Whirl(fx, fx.player.weapon.damage * (1 + 0.3 * (n - 1))));
    } } },
  { id: 'mirroredge', name: 'Mirror Edge', desc: 'Every swing also cuts behind you', lore: 'For the ones who like to sneak.', color: 0xe0e8f0, shape: 'mirror', pools: ['common'], tags: ['blade'], mech: true,
    hooks: { swing: (fx, n) => {
      const p = fx.player, w = p.weapon;
      if (w.kind === 'cast' || w.kind === 'bow') return;
      const back = p.forward.clone().negate();
      for (const e of fx.nearby(p.pos, w.reach * p.stats.reach)) {
        const d = e.pos.clone().sub(p.pos).setY(0).normalize();
        if (d.dot(back) > 0.3) fx.hurt(e, w.damage * 0.6 * n, { knock: 2, result: 'hit' });
      }
    } } },
  { id: 'giantknuckle', name: "Giant's Knuckle", desc: 'Combo finishers crack the ground in a quake', lore: 'The rest of the giant is still looking for it.', color: 0x8a8070, shape: 'claw', pools: ['common', 'shop'], tags: ['blade'], mech: true,
    hooks: { finisher: (fx, n) => {
      const g = fx.game, p = fx.player;
      const at = p.pos.clone().addScaledVector(p.forward, 1.8);
      g.addEffect(new Nova(g, at, { radius: 3.5 + n, color: 0xd8c8a0, height: 0.6 }));
      g.particles.burst(at.clone().setY(at.y + 0.1), 25, () => ({ vel: V(rand(-5, 5), rand(1, 4), rand(-5, 5)), life: rand(0.5, 1), size: rand(0.08, 0.16), color: 0x5a5448, gravity: 12, floor: at.y, linger: true }));
      g.shake(0.4);
      g.audio.play('boss-slam');
      fx.aoe(at, 3.5 + n, 16 * n, { knock: 4, each: (e) => { if (!e.addPosture(25)) e.stun(0.5); } });
    } } },
  { id: 'crescentmoon', name: 'Waning Moon', desc: 'Combo finishers loose a great crescent of light', lore: 'Each night a little less of it. Each night a little sharper.', color: 0xf0e0a0, shape: 'crescent', pools: ['common'], tags: ['blade', 'holy'], mech: true,
    hooks: { finisher: (fx, n) => crescent(fx, fx.player.weapon.damage * (0.8 + 0.4 * n), 0xfff0c0, 1.6) } },
  { id: 'ravenfam', name: 'Clockwork Raven', desc: 'A raven dives on whatever you strike, opening bleeding wounds', lore: 'Wound once a century. It has not run down yet.', color: 0x30303a, shape: 'wing', pools: ['common', 'shop'], tags: ['blade', 'blood'], mech: true, familiar: ravenFamiliar,
    hooks: { hit: (fx, n, { e }) => { (fx.mem.raven || (fx.mem.raven = {})).mark = e; } } },

  // ---- Air ---------------------------------------------------------------------------
  { id: 'skyrend', name: 'Skyrend Talon', desc: 'Plunging attacks unleash a tornado', lore: 'Taken from a bird that hunted mountains.', color: 0xd8e8f0, shape: 'claw', pools: ['common', 'shop'], tags: ['air'], mech: true,
    hooks: { plunge: (fx, n) => {
      const g = fx.game;
      g.addEffect(new Tornado(g, fx.player.pos, { radius: 3.2, life: 2.5 + n, onTick: (e) => fx.hurt(e, 5 * n, { knock: 0 }) }));
      g.audio.play('whirl');
    } } },
  { id: 'windsash', name: "Wind-Dancer's Sash", desc: 'Dodge in mid-air to dash; the dash cuts what it passes', lore: 'It never lets the wind go.', color: 0xe0f0ff, shape: 'feather', pools: ['common', 'shop'], tags: ['air'], mech: true,
    apply: (s) => { s.airDash = (s.airDash || 0) + 1; } },
  { id: 'featherfall', name: 'Plume of Featherfall', desc: 'Hold jump in the air to glide; attacks while gliding rain feathers', lore: 'It weighs less than a wish.', color: 0xfff8e8, shape: 'feather', pools: ['common'], tags: ['air', 'holy'], mech: true,
    apply: (s) => { s.glide = true; },
    hooks: { swing: (fx, n) => {
      const p = fx.player;
      if (p.grounded) return;
      for (let i = 0; i < 3 + n; i++) {
        const d = p.aim.clone().add(V(rand(-0.25, 0.25), rand(-0.4, -0.1), rand(-0.25, 0.25))).normalize();
        fx.bolt(fx.muzzle, d, 0xfff8e8, { damage: 7, speed: 20, size: 0.6, life: 1.2 });
      }
    } } },
  { id: 'gale', name: 'Gale Knot', desc: 'Jumping sends a gust that throws nearby foes back', lore: 'Untie it at your peril.', color: 0xc8f0e0, shape: 'ring', pools: ['common'], tags: ['air'], mech: true,
    hooks: { jump: (fx, n) => {
      const g = fx.game, p = fx.player;
      g.addEffect(new Nova(g, p.pos, { radius: 3.5, color: 0xc8f0e0, height: 0.3, life: 0.3 }));
      for (const e of fx.nearby(p.pos, 3.5)) {
        const d = e.pos.clone().sub(p.pos).setY(0).normalize();
        e.vel.addScaledVector(d, (7 + 3 * n) / Math.max(1, e.mass));
        e.knockTimer = 0.3;
        if (!e.isBoss) e.stun(0.3);
      }
    } } },

  // ---- Holy --------------------------------------------------------------------------
  { id: 'judgement', name: 'Bell of Judgement', desc: 'Parries call a pillar of holy light down on the attacker', lore: 'It tolls for someone. Never for you.', color: 0xfff0b0, shape: 'bell', pools: ['common', 'shop'], tags: ['holy'], mech: true,
    hooks: { parry: (fx, n, { attacker }) => {
      if (!attacker?.active) return;
      const g = fx.game;
      g.addEffect(new Pillar(g, attacker.pos, { color: 0xfff0b0, radius: 1.1, life: 0.6 }));
      g.audio.play('toll');
      fx.aoe(attacker.pos, 1.8, 24 * n, { knock: 3, each: (e) => e.addPosture(20) });
    } } },
  { id: 'veil', name: 'Reflecting Veil', desc: 'Parries and perfect dodges fire homing spirit bolts', lore: 'What you turn aside, it sends back with interest.', color: 0xe0e8ff, shape: 'cloak', pools: ['common'], tags: ['holy'], mech: true,
    hooks: {
      parry: (fx, n) => spray(fx, fx.player.eyePosition, 2 + n, 0xe0e8ff, 12, { homing: 7, speed: 14 }),
      perfectDodge: (fx, n) => spray(fx, fx.player.eyePosition, 3 + n, 0xe0e8ff, 12, { homing: 7, speed: 14 }),
    } },
  { id: 'seraphspear', name: "Seraph's Spear", desc: 'Every 5 s a spear of light falls on the strongest foe nearby', lore: 'Thrown from so high it took years to land.', color: 0xfff8d0, shape: 'shard', pools: ['common'], tags: ['holy'], mech: true,
    hooks: { update: (fx, n, { dt }, mem) => {
      mem.t = (mem.t ?? 3) - dt;
      if (mem.t > 0) return;
      const list = fx.nearby(fx.player.pos, 14);
      mem.t = list.length ? 5 / n : 1;
      if (!list.length) return;
      const e = list.reduce((a, b) => (b.hp > a.hp ? b : a));
      const g = fx.game;
      g.addEffect(new Pillar(g, e.pos, { color: 0xfff8d0, radius: 0.4, life: 0.5, height: 30 }));
      g.audio.play('halo');
      fx.hurt(e, 28, { knock: 2 });
      if (e.alive) e.addPosture(15);
    } } },
  { id: 'guardian', name: 'Guardian Cherub', desc: 'A small angel follows you, mending you when you are low and smiting foes', lore: 'Assigned to you. It has complained ever since.', color: 0xfff8e8, shape: 'halo', pools: ['angel'], tags: ['holy'], mech: true, familiar: angelFamiliar },

  // ---- Flask, execution, ultimate, misc ------------------------------------------------
  { id: 'alchemist', name: "Alchemist's Cork", desc: 'Drinking a flask erupts in a healing ring that burns foes', lore: 'Pop it and stand back.', color: 0xff5040, shape: 'flask', pools: ['common', 'shop'], tags: ['fire', 'holy'], mech: true,
    hooks: { flask: (fx, n) => {
      const g = fx.game, p = fx.player;
      g.addEffect(new Nova(g, p.pos, { radius: 5, color: 0xff4a3a, height: 1.4 }));
      g.audio.play('detonate');
      fx.aoe(p.pos, 5, 20 * n, { knock: 6, each: (e) => e.ignite(4, 7) });
    } } },
  { id: 'headsman', name: "Headsman's Hood", desc: 'Executions send a shockwave that breaks the posture of every foe nearby', lore: 'Nobody remembers the face under it. That was the point.', color: 0x3a2020, shape: 'cloak', pools: ['common', 'shop'], tags: ['blade', 'shadow'], mech: true,
    hooks: { execute: (fx, n) => {
      const g = fx.game, p = fx.player;
      g.addEffect(new Nova(g, p.pos, { radius: 7, color: 0xc41e2a, height: 2 }));
      for (const e of fx.nearby(p.pos, 7)) {
        if (e === p.exTarget) continue;
        e.addPosture(35 * n);
        if (!e.isBoss && e.state !== 'broken') e.stun(0.8);
      }
    } } },
  { id: 'overcharge', name: 'Overcharged Sigil', desc: 'Using your ultimate calls a lightning storm around you', lore: 'Too much power. Just enough.', color: 0xc0e0ff, shape: 'star', pools: ['common'], tags: ['storm'], mech: true,
    hooks: { ult: (fx, n) => {
      const g = fx.game;
      for (let i = 0; i < 6 + 3 * n; i++) {
        setTimeout(() => {
          const e = pick(fx.nearby(fx.player.pos, 14));
          if (e) smite(fx, e, 18);
        }, 150 + i * 180);
      }
      g.audio.play('thunder');
    } } },
  { id: 'counterweight', name: 'Counterweight', desc: 'After a parry, your next attack lands as a riposte on anything', lore: 'Balance, then punishment.', color: 0xb0a080, shape: 'hourglass', pools: ['common', 'shop'], tags: ['blade'], mech: true,
    hooks: {
      parry: (fx, n, ctx, mem) => { mem.ready = fx.game.time; },
      hit: (fx, n, { e, dmg, result }, mem) => {
        if (mem.ready === undefined || fx.game.time - mem.ready > 2.5 || result === 'riposte') return;
        mem.ready = undefined;
        fx.hurt(e, dmg * (fx.stats.riposteMult - 1), { knock: 5, result: 'riposte' });
      },
    } },

  // ---- Devil: power at a price, and very loud about it ------------------------------------
  { id: 'abyssmaw', name: 'Abyssal Maw', desc: 'Charged blows fire a devouring void beam', lore: 'It opens its mouth and the dark comes out.', color: 0x6a20c0, shape: 'eye', pools: ['devil'], devilCost: 25, tags: ['shadow'], mech: true,
    hooks: { charged: (fx, n, { k }) => {
      const g = fx.game, p = fx.player;
      g.addEffect(new Beam(g, fx.muzzle, p.aim, { length: 22, width: 0.45 + 0.2 * k, color: 0x9a40ff, onHit: (e) => { fx.hurt(e, (30 + 30 * k) * n, { knock: 4 }); applyCurse(g, e); } }));
      g.audio.play('beam');
      g.impact = Math.max(g.impact, 0.6);
      g.shake(0.4);
    } } },
  { id: 'hellhalo', name: 'Hellfire Halo', desc: 'A ring of hellfire circles you, burning everything near. You take 10% more harm', lore: 'Wear it, and you are never cold again.', color: 0xff3010, shape: 'halo', pools: ['devil'], devilCost: 20, tags: ['fire'], mech: true,
    apply: (s) => { s.damageTaken *= 1.1; },
    hooks: { update: (fx, n, { dt }, mem) => {
      const g = fx.game, p = fx.player;
      if (!mem.ring) {
        mem.ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.1, 4, 40), additive(0xff3010, 0.6));
        mem.ring.rotation.x = Math.PI / 2;
        g.scene.add(mem.ring);
      }
      mem.ring.position.set(p.pos.x, p.pos.y + 0.3, p.pos.z);
      mem.ring.rotation.z += dt * 2;
      mem.ring.visible = g.state !== 'title';
      if (Math.random() < dt * 40) {
        const a = rand(0, TAU);
        g.glow.emit({ pos: V(p.pos.x + Math.cos(a) * 2.8, p.pos.y + 0.3, p.pos.z + Math.sin(a) * 2.8), vel: V(0, rand(1, 2.5), 0), life: rand(0.3, 0.6), size: rand(0.05, 0.1), color: pick([0xff3010, 0xff7a2a]) });
      }
      mem.t = (mem.t || 0) - dt;
      if (mem.t > 0) return;
      mem.t = 0.5;
      for (const e of fx.nearby(p.pos, 3.2)) { fx.hurt(e, 5 * n, { knock: 0.5 }); e.ignite(2, 6); }
    } }, onReset: (mem, g) => { if (mem.ring) g.scene.remove(mem.ring); } },
  { id: 'wrathfallen', name: 'Wrath of the Fallen', desc: 'Hits may summon a demonic hand from below that crushes your foe', lore: 'Something down there still holds a grudge.', color: 0x8a1010, shape: 'claw', pools: ['devil'], devilCost: 25, tags: ['shadow', 'fire'], mech: true,
    hooks: { hit: (fx, n, { e }, mem) => {
      const g = fx.game;
      if (!e.alive || g.time - (mem.last ?? -9) < 1.2 || !chance(0.15 * n)) return;
      mem.last = g.time;
      const at = e.pos.clone();
      g.addEffect(new DemonArm(g, at, { onGrab: (c) => { fx.aoe(c, 1.8, 45, { knock: 2, each: (o) => { o.ignite(3, 8); if (!o.isBoss) o.stun(0.8); } }); } }));
    } } },
  { id: 'legion', name: 'Contract of Legion', desc: 'The slain have a chance to rise as shadows that fight for you', lore: 'Your army grows the more you work.', color: 0x40205a, shape: 'skull', pools: ['devil'], devilCost: 30, tags: ['shadow'], mech: true,
    hooks: { kill: (fx, n, { e }) => { if (chance(0.25 * n)) fx.player.summoner.raise(e.pos.clone(), e.height); } } },
  { id: 'bloodrage', name: 'Sigil of Blood-Rage', desc: 'Flasks no longer just heal: they send you into an 8 s frenzy (attack speed ×1.6, strikes drain life)', lore: 'Drink deep. Deeper.', color: 0xd01020, shape: 'flask', pools: ['devil'], devilCost: 15, tags: ['blood'], mech: true,
    hooks: {
      flask: (fx, n, ctx, mem) => { mem.until = fx.game.time + 8 * n; fx.game.audio.play('roar'); fx.game.hud.callout('Blood-Rage', 'blood'); },
      update: (fx, n, { dt }, mem) => {
        const on = mem.until > fx.game.time;
        fx.rage = on;
        if (on && Math.random() < dt * 25) {
          const p = fx.player;
          fx.game.glow.emit({ pos: p.pos.clone().add(V(rand(-0.6, 0.6), rand(0, 1.8), rand(-0.6, 0.6))), vel: V(0, rand(0.5, 1.5), 0), life: 0.5, size: 0.06, color: 0xd01020 });
        }
      },
      hit: (fx, n, ctx, mem) => { if (mem.until > fx.game.time) fx.heal(2); },
    } },
  { id: 'eclipse', name: 'Eclipse Heart', desc: 'Every 20 s a black sun rises over the room, cursing and scorching every foe', lore: 'It beats once a day, and the day goes dark.', color: 0x201028, shape: 'heart', pools: ['devil'], devilCost: 30, tags: ['shadow', 'fire'], mech: true,
    hooks: { update: (fx, n, { dt }, mem) => {
      mem.t = (mem.t ?? 8) - dt;
      if (mem.t > 0) return;
      const list = fx.nearby(fx.player.pos, 18);
      mem.t = list.length ? 20 / n : 2;
      if (!list.length) return;
      const g = fx.game;
      g.flash = Math.max(g.flash, 0.6);
      g.impact = 1;
      g.audio.play('void');
      g.addEffect(new Singularity(g, fx.player.pos.clone().setY(fx.player.pos.y + 7), { radius: 0, life: 1.2, onCollapse: () => {
        for (const e of fx.nearby(fx.player.pos, 18)) {
          g.addEffect(new Pillar(g, e.pos, { color: 0x6a20a0, core: 0xff3010, radius: 0.6, life: 0.5 }));
          fx.hurt(e, 30, { knock: 2 });
          if (e.alive) { applyCurse(g, e, 10); e.ignite(4, 8); }
        }
      } }));
    } } },

  // ---- Angel: grace, and a lot of light ------------------------------------------------------
  { id: 'choirwings', name: 'Wings of the Choir', desc: 'Glide by holding jump; a second jump; feathers rain from every airborne swing', lore: 'You hear singing whenever you leave the ground.', color: 0xffffff, shape: 'wing', pools: ['angel'], tags: ['holy', 'air'], mech: true,
    apply: (s) => { s.glide = true; s.extraJumps += 1; },
    hooks: { swing: (fx, n) => {
      const p = fx.player;
      if (p.grounded) return;
      for (let i = 0; i < 5; i++) {
        const d = p.aim.clone().add(V(rand(-0.3, 0.3), rand(-0.5, -0.1), rand(-0.3, 0.3))).normalize();
        fx.bolt(fx.muzzle, d, 0xfff8e8, { damage: 9, speed: 22, size: 0.7, homing: 2, life: 1.4 });
      }
    } } },
  { id: 'holymantle', name: 'Holy Mantle', desc: 'A shield of light turns aside the first blow in every room', lore: 'Warm, like a hand on your shoulder.', color: 0xfff0c0, shape: 'shield', pools: ['angel'], tags: ['holy'], mech: true,
    onAcquire: (fx) => { fx.mantle = true; },
    hooks: { roomEnter: (fx) => { fx.mantle = true; } } },
  { id: 'sunfallrelic', name: 'Fallen Star', desc: 'Every tenth kill calls a falling star onto the thickest crowd', lore: 'It wished for you, too.', color: 0xffe080, shape: 'star', pools: ['angel'], tags: ['holy', 'fire'], mech: true,
    hooks: { kill: (fx, n, ctx, mem) => {
      mem.c = (mem.c || 0) + 1;
      if (mem.c % Math.max(4, 10 - 2 * (n - 1))) return;
      const list = fx.nearby(fx.player.pos, 16);
      if (!list.length) return;
      let best = list[0], bestN = 0;
      for (const e of list) { const k = list.filter((o) => o.pos.distanceTo(e.pos) < 4).length; if (k > bestN) { bestN = k; best = e; } }
      fx.game.sunfall(fx.player, best.pos.clone());
    } } },
  { id: 'rebirth', name: 'Phoenix Plume', desc: 'Once per floor, rise from death in an explosion of holy fire', lore: 'Every ending is a door, if you burn bright enough.', color: 0xffa040, shape: 'feather', pools: ['angel'], tags: ['holy', 'fire'], mech: true,
    apply: (s) => { s.deathWard += 1; s.wardMax = (s.wardMax || 0) + 1; s.phoenix = true; } },
];

/** Soul Lantern: fling every circling wisp at the nearest foes. */
function fling(fx, mem) {
  const wisps = mem.wisps || [];
  if (!wisps.length) return;
  for (const m of wisps) {
    const e = fx.nearest(m.position, 16);
    const dir = e ? chest(e).sub(m.position).normalize() : fx.player.aim;
    fx.bolt(m.position.clone(), dir, 0xa0d0ff, { damage: 16, speed: 18, homing: 8, size: 0.8 });
    fx.game.scene.remove(m);
    m.geometry.dispose();
  }
  wisps.length = 0;
  fx.game.audio.play('halo');
}

// =====================================================================================
// Resonances: three relics of a kind
// =====================================================================================

export const RESONANCES = {
  pyrelord: { tag: 'fire', name: 'Pyre Lord', desc: 'Everything you ignite burns twice as hot and douses its neighbours in oil', color: 0xff6a20,
    hooks: { hit: (fx, n, { e }) => { if (e.alive && e.burnTime > 0) { e.burnDps *= 1.02; for (const o of fx.nearby(e.pos, 2.5)) if (o !== e) applyOil(fx.game, o); } } } },
  stormborn: { tag: 'storm', name: 'Stormborn', desc: 'Lightning answers your every third blow, and shock never fades', color: 0xd8f0ff,
    hooks: { hit: (fx, n, { e }, mem) => { mem.c = (mem.c || 0) + 1; if (mem.c % 3 === 0) smite(fx, e, 16); } } },
  hemomancer: { tag: 'blood', name: 'Hemomancer', desc: 'Hemorrhages leap to the next foe; every burst heals you', color: 0xc41e2a,
    hooks: { hemorrhage: (fx, n, { e }) => { fx.heal(3); const t = fx.nearest(e.pos, 7, e); if (t) applyBleed(fx.game, t, 3); } } },
  winterheart: { tag: 'frost', name: 'Winterheart', desc: 'A blizzard follows you, chilling all nearby foes', color: 0xa8d8ff,
    hooks: { update: (fx, n, { dt }, mem) => {
      const p = fx.player, g = fx.game;
      if (Math.random() < dt * 30) g.glow.emit({ pos: p.pos.clone().add(V(rand(-4, 4), rand(0.5, 3), rand(-4, 4))), vel: V(rand(-1, 1), -0.5, rand(-1, 1)), life: 1, size: 0.04, color: 0xe0f0ff });
      mem.t = (mem.t || 0) - dt;
      if (mem.t > 0) return;
      mem.t = 1.2;
      for (const e of fx.nearby(p.pos, 4.5)) applyChill(g, e, 1);
    } } },
  umbral: { tag: 'shadow', name: 'Umbral Legion', desc: 'Your kills leave shadows of themselves that fight on for a while', color: 0x8a60ff,
    hooks: { kill: (fx, n, { e }) => { if (chance(0.35)) fx.player.summoner.raise(e.pos.clone(), e.height); } } },
  seraphic: { tag: 'holy', name: 'Seraphic', desc: 'A halo of wings: glide, and every parry calls a pillar of light', color: 0xfff0b0,
    onAcquire: (fx) => { fx.stats.glide = true; },
    hooks: { parry: (fx, n, { attacker }) => { if (attacker?.active) { fx.game.addEffect(new Pillar(fx.game, attacker.pos, { radius: 1, life: 0.5 })); fx.hurt(attacker, 20); } } } },
  skyborne: { tag: 'air', name: 'Skyborne', desc: 'Air-dash, glide, and time slows while you aim in the air', color: 0xe0f0ff,
    onAcquire: (fx) => { fx.stats.airDash = Math.max(1, fx.stats.airDash || 0); fx.stats.glide = true; fx.stats.airFocus = true; } },
  bladestorm: { tag: 'blade', name: 'Bladestorm', desc: 'Six spectral knives circle you, and they cut twice as often', color: 0xd8e0ff,
    onAcquire: (fx) => { fx.stats.orbitBlades += 6; fx.stats.bladeRate = 2; fx.sync(); } },
};

/** Covenants: what devils and angels give to those who keep coming back. */
export const COVENANTS = {
  leviathan: { name: 'Covenant of the Abyss', desc: 'Three devil deals sealed: +35% damage, and your swings trail hellfire', color: 0xff3010,
    test: (p) => p.devilDeals >= 3,
    onAcquire: (fx) => { fx.stats.damageMult *= 1.35; },
    hooks: { swing: (fx) => {
      const p = fx.player;
      if (p.weapon.kind === 'cast' || p.weapon.kind === 'bow') return;
      fx.bolt(fx.muzzle, p.aim, 0xff3010, { damage: 8 + p.weapon.damage * 0.3, speed: 15, homing: 3, burn: 5, size: 1 });
    } } },
  ascension: { name: 'Seraphic Ascension', desc: 'Two angel gifts received: wings, a free mid-air jump, and a guardian cherub', color: 0xfff0c0,
    test: (p) => p.angelDeals >= 2,
    onAcquire: (fx) => {
      fx.stats.glide = true;
      fx.stats.extraJumps += 1;
      fx.acquire(RELICS.find((r) => r.id === 'guardian'));
    } },
};
