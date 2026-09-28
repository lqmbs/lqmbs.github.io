import * as THREE from 'three';
import { rand, pick } from './util.js';
import { IceBlock, Nova, additive } from './vfx.js';

/**
 * Status effects on enemies — the glue between relics. Each one is simple alone and does something
 * extra when another relic touches it:
 *
 *  bleed  stacks; five stacks burst in a hemorrhage
 *  chill  slows; three stacks freeze solid (a frozen foe takes more, and shatters)
 *  oil    drips; any flame makes it explode
 *  curse  marked; takes 30% more of everything
 *  shock  charged; the next wound arcs lightning to its neighbours
 *
 * Relics that care about these listen for 'hemorrhage', 'freeze', 'shatter', 'detonate' and
 * 'discharge' through the player's BuildFX.
 */

const HEMORRHAGE_STACKS = 5;
const FREEZE_STACKS = 3;

export function statusOf(e) {
  return e.status || (e.status = { bleed: 0, bleedT: 0, chill: 0, chillT: 0, oil: 0, curse: 0, shock: 0 });
}

const fx = (game) => game.player.fx;

export function applyBleed(game, e, n = 1) {
  if (!e.active) return;
  const s = statusOf(e);
  s.bleed += n;
  s.bleedT = 5;
  if (s.bleed >= HEMORRHAGE_STACKS) hemorrhage(game, e);
}

/** Five wounds at once: the blood comes out all together. */
export function hemorrhage(game, e) {
  const s = statusOf(e);
  s.bleed = 0;
  const dmg = (e.isBoss ? 0.035 : 0.12) * e.maxHp + 22 * game.player.stats.damageMult;
  const c = e.pos.clone().setY(e.pos.y + e.height * 0.6);
  game.audio.play('hemorrhage');
  game.gore?.spray(e.pos, new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(), 2, e.bloodColor, e.chamber.world);
  game.particles.burst(c, 30, () => ({ vel: new THREE.Vector3(rand(-2, 2), rand(3, 8), rand(-2, 2)), life: rand(0.6, 1.2), size: rand(0.05, 0.11), color: e.bloodColor, gravity: 16, floor: e.pos.y }));
  game.addEffect(new Nova(game, e.pos, { radius: 2.2, color: 0xc41e2a, life: 0.35, height: 2.2 }));
  e.takeRawDamage(dmg, new THREE.Vector3(), 0);
  game.onEnemyHit(e, e.alive ? 'spell' : 'kill', new THREE.Vector3(0, 0, 1), dmg, { proc: true });
  fx(game).fire('hemorrhage', { e, dmg });
}

export function applyChill(game, e, n = 1) {
  if (!e.active || e.frozen > 0) return;
  const s = statusOf(e);
  s.chill += n;
  s.chillT = 4;
  if (s.chill >= FREEZE_STACKS) freeze(game, e, e.isBoss ? 0.9 : 1.8);
}

export function freeze(game, e, duration) {
  const s = statusOf(e);
  s.chill = 0;
  e.frozen = duration;
  game.addEffect(new IceBlock(game, e));
  game.audio.play('freeze');
  fx(game).fire('freeze', { e });
}

export function applyOil(game, e) {
  if (!e.active) return;
  statusOf(e).oil = 6;
}

export function applyCurse(game, e, duration = 8) {
  if (!e.active) return;
  const s = statusOf(e);
  if (!s.curse) game.audio.play('curse');
  s.curse = Math.max(s.curse, duration);
  if (!e.curseMark) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 4, 6), additive(0xb040ff, 0.9));
    m.rotation.x = Math.PI / 2;
    e.curseMark = m;
    e.group.add(m);
  }
}

export function applyShock(game, e, duration = 4) {
  if (!e.active) return;
  statusOf(e).shock = Math.max(statusOf(e).shock, duration);
}

/** Damage taken is scaled by curses and by being frozen solid. */
export function statusDamageMult(e) {
  const s = e.status;
  let m = 1;
  if (s?.curse > 0) m *= 1.3;
  if (e.frozen > 0) m *= 1.4;
  return m;
}

export function slowFactor(e) {
  const s = e.status;
  return s?.chill ? Math.max(0.45, 1 - 0.2 * s.chill) : 1;
}

/** Fire met oil: the foe goes up like a torch and takes its neighbours with it. */
export function onIgnite(game, e) {
  const s = e.status;
  if (!s?.oil) return;
  s.oil = 0;
  const c = e.pos.clone().setY(e.pos.y + 0.8);
  game.audio.play('detonate');
  game.shake(0.35);
  game.addEffect(new Nova(game, e.pos, { radius: 4, color: 0xff6a20, life: 0.4, height: 1.8 }));
  game.glow.burst(c, 50, () => ({ vel: new THREE.Vector3(rand(-7, 7), rand(1, 7), rand(-7, 7)), life: rand(0.3, 0.8), size: rand(0.08, 0.16), color: pick([0xff6a20, 0xffb040, 0xffe080]), drag: 2 }));
  const P = game.player.stats;
  for (const o of game.nearbyEnemies()) {
    if (!o.active || o.pos.distanceTo(e.pos) > 4) continue;
    const dir = o.pos.clone().sub(e.pos).setY(0).normalize();
    const dmg = 30 * P.damageMult;
    o.takeRawDamage(dmg, dir, 5);
    if (o.alive) o.ignite(3, 6);
    game.onEnemyHit(o, o.alive ? 'spell' : 'kill', dir, dmg, { proc: true });
  }
  fx(game).fire('detonate', { e });
}

/** After damage lands: frozen foes shatter, shocked foes discharge. */
export function onDamaged(game, e, amount) {
  const s = e.status;
  if (e.frozen > 0 && amount > 8) {
    e.frozen = 0;
    fx(game).fire('shatter', { e });
  }
  if (s?.shock > 0 && amount > 3) {
    s.shock = 0;
    fx(game).chain(e, 10 + amount * 0.4, 3);
    fx(game).fire('discharge', { e });
  }
}

/** Once a frame per enemy: bleeding, thawing, dripping, and the marks that show it. */
export function updateStatus(game, e, dt) {
  const s = e.status;
  if (!s) return;
  const c = e.pos;
  if (s.bleed > 0) {
    s.bleedT -= dt;
    e.takeRawDamage(s.bleed * 1.5 * dt, new THREE.Vector3(), 0);
    e.flash = 0;
    if (Math.random() < dt * 6 * s.bleed) {
      game.particles.emit({ pos: new THREE.Vector3(c.x + rand(-0.3, 0.3), c.y + rand(0.5, e.height), c.z + rand(-0.3, 0.3)), vel: new THREE.Vector3(0, -1, 0), life: 0.6, size: 0.04, color: e.bloodColor, gravity: 12, floor: c.y });
    }
    if (s.bleedT <= 0) s.bleed = 0;
  }
  if (s.chill > 0) {
    s.chillT -= dt;
    if (Math.random() < dt * 10) game.glow.emit({ pos: new THREE.Vector3(c.x + rand(-0.5, 0.5), c.y + rand(0.2, e.height), c.z + rand(-0.5, 0.5)), vel: new THREE.Vector3(0, -0.4, 0), life: 0.6, size: 0.04, color: 0xa8d8ff });
    if (s.chillT <= 0) s.chill = 0;
  }
  if (s.oil > 0) {
    s.oil -= dt;
    if (Math.random() < dt * 8) game.particles.emit({ pos: new THREE.Vector3(c.x + rand(-0.3, 0.3), c.y + rand(0.4, e.height), c.z + rand(-0.3, 0.3)), vel: new THREE.Vector3(0, -0.5, 0), life: 0.8, size: 0.05, color: 0x100c08, gravity: 10, floor: c.y });
  }
  if (s.shock > 0) {
    s.shock -= dt;
    if (Math.random() < dt * 12) game.glow.emit({ pos: new THREE.Vector3(c.x + rand(-0.5, 0.5), c.y + rand(0.2, e.height), c.z + rand(-0.5, 0.5)), vel: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)), life: 0.12, size: 0.05, color: 0xd8f0ff });
  }
  if (s.curse > 0) {
    s.curse -= dt;
    if (e.curseMark) {
      e.curseMark.position.y = e.height + 0.45;
      e.curseMark.rotation.z += dt * 3;
    }
    if (s.curse <= 0 && e.curseMark) {
      e.group.remove(e.curseMark);
      e.curseMark.geometry.dispose();
      e.curseMark.material.dispose();
      e.curseMark = null;
    }
  }
}

