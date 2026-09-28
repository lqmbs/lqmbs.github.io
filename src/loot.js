import * as THREE from 'three';
import { buildWeaponModel, weaponMaterials, makeWeapon, hex } from './weapons.js';
import { rand } from './util.js';

let sharedMaterials = null;
const materials = () => (sharedMaterials ||= weaponMaterials());

/**
 * A weapon lying in the world — dropped by the player, looted from a foe, or hung on the
 * training ground's rack. Walk up and press E to take it; your hand's weapon is swapped out.
 */
export class WeaponDrop {
  constructor(game, area, weapon, pos, { rack = false, yaw = 0 } = {}) {
    this.game = game;
    this.area = area;
    this.rack = rack;
    this.radius = rack ? 1.1 : 1.6;
    this.t = rand(0, 10);
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    this.holder = new THREE.Group();
    this.group.add(this.holder);
    this.beamMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22 });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.07, 3, 6, 1, true), this.beamMat);
    this.beam.position.y = 1.5;
    this.beam.visible = !rack;
    this.group.add(this.beam);
    this.setWeapon(weapon);
    area.group.add(this.group);
    area.loot.push(this);
    area.interactables.push(this);
  }

  get position() { return this.group.position; }
  get prompt() { return `Take ${this.weapon.displayName}`; }
  get promptColor() { return hex(this.weapon.rarity.color); }

  setWeapon(w) {
    this.weapon = w;
    this.holder.clear();
    const model = buildWeaponModel(w.typeId, materials(), w.bolt?.color);
    model.scale.setScalar(w.typeId === 'daggers' ? 1.6 : 1.1);
    if (!this.rack) {
      model.rotation.z = Math.PI / 2;
      model.position.set(0.5, 0, 0);
    }
    this.holder.add(model);
    this.beamMat.color.setHex(w.rarity.color);
    this.beamMat.opacity = w.rarity.id === 'common' ? 0.05 : 0.13;
  }

  interact() {
    const player = this.game.player;
    const displaced = player.takeWeapon(this.weapon);
    this.game.onWeaponTaken(this.weapon);
    if (this.rack) {
      // The rack is bottomless: hang a fresh copy back up.
      this.setWeapon(makeWeapon(this.weapon.typeId));
    } else if (displaced) {
      this.setWeapon(displaced);
    } else {
      this.remove();
    }
  }

  remove() {
    this.area.group.remove(this.group);
    this.area.loot.splice(this.area.loot.indexOf(this), 1);
    this.area.interactables.splice(this.area.interactables.indexOf(this), 1);
  }

  update(dt) {
    this.t += dt;
    if (this.rack) return;
    this.holder.position.y = 0.35 + Math.sin(this.t * 2) * 0.06;
    this.holder.rotation.y += dt * 0.8;
    if (this.weapon.rarity.id !== 'common' && Math.random() < dt * 6) {
      const p = this.group.position;
      this.game.glow.emit({
        pos: new THREE.Vector3(p.x + rand(-0.3, 0.3), p.y + 0.2, p.z + rand(-0.3, 0.3)),
        vel: new THREE.Vector3(0, rand(0.6, 1.4), 0), life: rand(0.6, 1.2), size: 0.035, color: this.weapon.rarity.color,
      });
    }
  }
}
