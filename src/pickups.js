import * as THREE from 'three';
import { rand, randInt, chance, pick, TAU, easeOut } from './util.js';
import { rollItem, Pedestal } from './items.js';
import { WeaponDrop } from './loot.js';
import { rollWeapon } from './weapons.js';

// Shared geometry and materials: pickups are spawned by the handful.
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0c040, emissive: 0x6a4a08, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.8, flatShading: true });
  const silver = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, emissive: 0x404858, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.8, flatShading: true });
  const vial = new THREE.MeshStandardMaterial({ color: 0xe0203a, emissive: 0x801020, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true });
  const keyGeo = (() => {
    const parts = [
      new THREE.TorusGeometry(0.1, 0.03, 4, 10).translate(0, 0.2, 0),
      new THREE.BoxGeometry(0.04, 0.34, 0.04).translate(0, -0.02, 0),
      new THREE.BoxGeometry(0.1, 0.04, 0.04).translate(0.05, -0.15, 0),
      new THREE.BoxGeometry(0.07, 0.04, 0.04).translate(0.035, -0.07, 0),
    ];
    return parts;
  })();
  SHARED = {
    gold, silver, vial, keyGeo,
    coin: new THREE.CylinderGeometry(0.13, 0.13, 0.035, 10).rotateX(Math.PI / 2),
    vialBody: new THREE.CylinderGeometry(0.08, 0.1, 0.2, 7),
    vialNeck: new THREE.CylinderGeometry(0.03, 0.035, 0.08, 6).translate(0, 0.14, 0),
  };
  return SHARED;
}

/**
 * A small thing lying on the ground: coins, keys, blood vials. Walked over (with a little
 * magnetism) rather than interacted with.
 */
export class Pickup {
  constructor(game, area, kind, pos, { value = 1, burst = true } = {}) {
    this.game = game;
    this.area = area;
    this.kind = kind;
    this.value = value;
    this.t = 0;
    this.taken = false;
    const S = shared();
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.model = new THREE.Group();
    this.group.add(this.model);
    if (kind === 'coin') {
      const m = new THREE.Mesh(S.coin, S.gold);
      m.scale.setScalar(value >= 5 ? 1.5 : 1);
      this.model.add(m);
    } else if (kind === 'key') {
      for (const g of S.keyGeo) this.model.add(new THREE.Mesh(g, S.silver));
      this.model.scale.setScalar(1.3);
    } else {
      this.model.add(new THREE.Mesh(S.vialBody, S.vial), new THREE.Mesh(S.vialNeck, S.gold));
    }
    (area.actors || area.group).add(this.group);
    area.loot.push(this);
    this.floorY = pos.y;
    this.vel = burst ? new THREE.Vector3(rand(-2.2, 2.2), rand(3.5, 5.5), rand(-2.2, 2.2)) : new THREE.Vector3();
    this.airborne = burst;
    this.spin = rand(0, TAU);
  }

  update(dt) {
    if (this.taken) return;
    this.t += dt;
    const p = this.group.position;
    if (this.airborne) {
      this.vel.y -= 18 * dt;
      const nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt;
      const g = this.area.world.groundAt(nx, nz, p.y + 0.3);
      if (g !== null && Math.abs(g - this.floorY) < 1.5) { p.x = nx; p.z = nz; this.floorY = g; }
      p.y += this.vel.y * dt;
      if (p.y <= this.floorY && this.vel.y < 0) {
        p.y = this.floorY;
        if (this.vel.y < -3) { this.vel.y *= -0.35; this.vel.x *= 0.5; this.vel.z *= 0.5; }
        else this.airborne = false;
      }
    }
    this.spin += dt * 3;
    this.model.rotation.y = this.spin;
    this.model.position.y = 0.3 + (this.airborne ? 0 : Math.sin(this.t * 3 + this.spin) * 0.05);

    const player = this.game.player;
    if (!player.alive || this.t < 0.45) return;
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (Math.abs(player.pos.y - p.y) > 1.6) return;
    if (this.kind === 'vial' && player.hp >= player.stats.maxHp) return;
    if (d < 2.6 && !this.airborne) {
      // A gentle pull towards the knight.
      const k = Math.min(1, dt * (9 - d * 2.5));
      p.x += dx * k;
      p.z += dz * k;
    }
    if (d < 0.75) this.collect();
  }

  collect() {
    this.taken = true;
    this.group.parent?.remove(this.group);
    const i = this.area.loot.indexOf(this);
    if (i >= 0) this.area.loot.splice(i, 1);
    this.game.onPickup(this.kind, this.value, this.group.position);
  }
}

/** Scatter coins totalling `amount` (big coins are worth five). */
export function dropCoins(game, area, pos, amount) {
  let left = Math.round(amount);
  while (left > 0) {
    const v = left >= 5 && chance(0.5) ? 5 : 1;
    new Pickup(game, area, 'coin', pos, { value: v });
    left -= v;
  }
}

// ============================================================================
// Chests
// ============================================================================

const CHEST = {
  wood: { name: 'Weathered Chest', color: 0x5a3a22, band: 0x2a2c32, needsKey: false },
  gold: { name: 'Gilded Reliquary Chest', color: 0x8a6a2a, band: 0xf0c040, needsKey: true },
};

/**
 * A chest: wooden ones open with [E]; gilded ones want a key. Contents are rolled when opened:
 * coins and keys, vials, sometimes a relic or a weapon.
 */
export class Chest {
  constructor(game, area, x, y, z, kind = 'wood', yaw = 0) {
    this.game = game;
    this.area = area;
    this.kind = kind;
    this.def = CHEST[kind];
    this.opened = false;
    this.t = 0;
    this.openT = 0;
    this.radius = 2.5;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    const wood = new THREE.MeshStandardMaterial({ color: this.def.color, roughness: 0.85, flatShading: true });
    const band = kind === 'gold'
      ? new THREE.MeshStandardMaterial({ color: 0xf0c040, emissive: 0x5a3a08, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.8, flatShading: true })
      : game.materials.iron;
    const add = (parent, geo, mat, px, py, pz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    add(this.group, new THREE.BoxGeometry(1.1, 0.55, 0.7), wood, 0, 0.3, 0);
    for (const bx of [-0.42, 0.42]) add(this.group, new THREE.BoxGeometry(0.08, 0.58, 0.74), band, bx, 0.3, 0);
    add(this.group, new THREE.BoxGeometry(1.14, 0.06, 0.74), band, 0, 0.04, 0);
    // The lid hinges along its back edge.
    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.58, -0.35);
    this.group.add(this.lid);
    const lidBody = add(this.lid, new THREE.CylinderGeometry(0.35, 0.35, 1.1, 8, 1, false, 0, Math.PI), wood, 0, 0, 0.35);
    lidBody.rotation.z = Math.PI / 2;
    for (const bx of [-0.42, 0.42]) {
      const b = add(this.lid, new THREE.CylinderGeometry(0.37, 0.37, 0.08, 8, 1, false, 0, Math.PI), band, bx, 0, 0.35);
      b.rotation.z = Math.PI / 2;
    }
    this.lock = add(this.group, new THREE.BoxGeometry(0.16, 0.2, 0.06), band, 0, 0.5, 0.37);
    this.glowMat = new THREE.MeshBasicMaterial({ color: kind === 'gold' ? 0xffd070 : 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.55), this.glowMat);
    this.glowMesh.position.y = 0.58;
    this.group.add(this.glowMesh);
    (area.actors || area.group).add(this.group);
    this.obstacle = area.world.addCircleWorld ? area.world.addCircleWorld(x, z, 0.65, y - 1, y + 0.9) : area.world.addCircle(x, z, 0.65, y - 1, y + 0.9);
    area.interactables.push(this);
    area.loot.push(this);
  }

  get position() { return this.group.position; }
  get prompt() {
    if (this.def.needsKey) return `Unlock ${this.def.name}`;
    return `Open ${this.def.name}`;
  }
  get sub() { return this.def.needsKey ? `Requires a key · you carry ${this.game.player.keys}` : ''; }
  get promptColor() { return this.kind === 'gold' ? '#f0c040' : ''; }

  interact() {
    if (this.opened) return;
    const p = this.game.player;
    if (this.def.needsKey) {
      if (p.keys <= 0) {
        this.game.audio.play('locked');
        this.game.hud.toast('Locked', 'A key would open it', 0x9aa0b0);
        return;
      }
      p.keys--;
      this.game.audio.play('unlock');
    }
    this.opened = true;
    const i = this.area.interactables.indexOf(this);
    if (i >= 0) this.area.interactables.splice(i, 1);
    this.game.audio.play('chest');
    this.spill();
  }

  spill() {
    const game = this.game, area = this.area;
    const p = this.group.position.clone().setY(this.group.position.y + 0.6);
    const depth = game.depth;
    if (this.kind === 'gold') {
      // Gilded chests always hold something that matters.
      if (chance(0.55)) {
        const off = new THREE.Vector3(0, 0, 1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
        area.loot.push(new Pedestal(area, rollItem(game.player), p.x + off.x, this.group.position.y, p.z + off.z));
      } else {
        const off = new THREE.Vector3(0, 0, 1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
        new WeaponDrop(game, area, rollWeapon(depth, 2), this.group.position.clone().add(off));
      }
      dropCoins(game, area, p, randInt(4, 9));
    } else {
      const r = Math.random();
      dropCoins(game, area, p, randInt(2, 6) + depth);
      if (r < 0.35) new Pickup(game, area, 'key', p);
      else if (r < 0.6) new Pickup(game, area, 'vial', p);
      else if (r < 0.72) {
        const off = new THREE.Vector3(0, 0, 1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
        new WeaponDrop(game, area, rollWeapon(depth, 0), this.group.position.clone().add(off));
      }
    }
    game.glow.burst(p, 30, () => ({
      vel: new THREE.Vector3(rand(-1.5, 1.5), rand(2, 5), rand(-1.5, 1.5)), life: rand(0.5, 1.1), size: rand(0.04, 0.08),
      color: pick([0xffd070, 0xffe8a0, 0xffb040]), drag: 2,
    }));
  }

  update(dt) {
    this.t += dt;
    if (this.grow !== undefined && this.grow < 1) {
      // A reward chest pushes up out of the floor.
      this.grow = Math.min(1, this.grow + dt * 1.6);
      this.group.scale.setScalar(Math.max(0.01, easeOut(this.grow)));
      if (Math.random() < dt * 30) {
        const p = this.group.position;
        this.game.particles.emit({
          pos: new THREE.Vector3(p.x + rand(-0.6, 0.6), p.y + 0.1, p.z + rand(-0.6, 0.6)),
          vel: new THREE.Vector3(rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5)), life: rand(0.5, 1), size: rand(0.06, 0.14), color: 0x3a3a40, gravity: 9, linger: true, floor: p.y,
        });
      }
    }
    if (this.opened) {
      this.openT = Math.min(1, this.openT + dt * 2.5);
      this.lid.rotation.x = -easeOut(this.openT) * 1.9;
      this.glowMat.opacity = Math.max(0, 0.9 - this.openT * 0.4) * (0.7 + 0.3 * Math.sin(this.t * 8));
      return;
    }
    if (this.kind === 'gold' && Math.random() < dt * 5) {
      const p = this.group.position;
      this.game.glow.emit({
        pos: new THREE.Vector3(p.x + rand(-0.5, 0.5), p.y + rand(0.3, 0.9), p.z + rand(-0.4, 0.4)),
        vel: new THREE.Vector3(0, rand(0.3, 0.8), 0), life: rand(0.6, 1.2), size: 0.03, color: 0xffd070,
      });
    }
  }
}
