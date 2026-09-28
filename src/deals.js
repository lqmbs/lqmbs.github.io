import * as THREE from 'three';
import { rand, pick, easeOut, TAU } from './util.js';
import { Pedestal, rollItems } from './items.js';

/**
 * After a guardian falls, something may answer: a horned idol offering power for flesh, or a
 * winged saint offering one gift freely. The altar rises out of the arena floor with its wares.
 */
export class DealAltar {
  constructor(chamber, kind, x, y, z, facing) {
    this.chamber = chamber;
    this.game = chamber.game;
    this.kind = kind;
    this.t = 0;
    this.base = new THREE.Vector3(x, y, z);
    this.group = new THREE.Group();
    this.group.position.set(x, y - 4, z);
    this.group.rotation.y = facing;
    (chamber.actors || chamber.group).add(this.group);
    kind === 'devil' ? this.buildDevil() : this.buildAngel();
    chamber.world.addCircleWorld(x, z, 1.3, y - 1, y + 5);

    // Two offerings flank the idol, set forward towards the arena.
    const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const lat = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const items = rollItems(this.game.player, kind, 2);
    const group = [];
    this.pedestals = items.map((item, i) => {
      const p = this.base.clone().addScaledVector(fwd, 2.4).addScaledVector(lat, (i ? 1 : -1) * 2.1);
      const ped = new Pedestal(chamber, item, p.x, y, p.z, false, { deal: kind, group: kind === 'angel' ? group : null });
      group.push(ped);
      chamber.loot.push(ped);
      return ped;
    });
    const light = kind === 'devil' ? 0xff2a10 : 0xffe8a0;
    chamber.lightSpots.push({ kind: 'warm', color: light, pos: this.base.clone().add(new THREE.Vector3(0, 3, 0)), weight: 6, intensity: 16, distance: 14 });
    this.game.audio.play(kind === 'devil' ? 'devil' : 'angel');
    this.game.hud.banner(kind === 'devil' ? 'A DARK PACT IS OFFERED' : 'AN ANGEL DESCENDS', kind === 'devil' ? 'devil' : 'angel', 3.4);
    this.game.shake(0.5);
  }

  buildDevil() {
    const M = this.game.materials;
    const black = new THREE.MeshStandardMaterial({ color: 0x141014, roughness: 0.55, metalness: 0.3, flatShading: true });
    const fire = new THREE.MeshBasicMaterial({ color: 0xff3010 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(1.5, 1.8, 0.6, 6), M.trim, 0, 0.3, 0);
    add(new THREE.CylinderGeometry(1.2, 1.4, 0.4, 6), black, 0, 0.8, 0);
    // Seated horned idol, hunched, with a goat's skull.
    add(new THREE.CylinderGeometry(0.55, 0.9, 1.8, 7), black, 0, 1.9, -0.1);
    add(new THREE.BoxGeometry(1.5, 0.5, 0.8), black, 0, 2.8, -0.1);
    add(new THREE.BoxGeometry(0.4, 0.55, 0.5), black, 0, 3.25, 0.05);
    add(new THREE.BoxGeometry(0.3, 0.3, 0.45), M.bone, 0, 3.15, 0.3);
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(0.12, 1.1, 5), black, s * 0.35, 3.8, 0, 0, 0, -s * 0.6);
      add(new THREE.ConeGeometry(0.07, 0.6, 5), black, s * 0.78, 4.25, 0, 0, 0, -s * 1.3);
      add(new THREE.BoxGeometry(0.08, 0.05, 0.02), fire, s * 0.1, 3.3, 0.31);
      // Arms resting on the knees, claws hanging.
      add(new THREE.BoxGeometry(0.28, 1.1, 0.28), black, s * 0.85, 2.3, 0.35, 0.9, 0, s * 0.2);
      add(new THREE.ConeGeometry(0.06, 0.35, 4), black, s * 0.9, 1.85, 0.8, Math.PI, 0, 0);
      // Braziers either side.
      add(new THREE.CylinderGeometry(0.35, 0.2, 0.9, 6), black, s * 1.9, 0.45, 0.6);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 6), fire, s * 1.9, 0.92, 0.6);
    }
    this.emitters = [new THREE.Vector3(-1.9, 1, 0.6), new THREE.Vector3(1.9, 1, 0.6)];
    this.color = [0xff3010, 0xff6020, 0x600000];
  }

  buildAngel() {
    const M = this.game.materials;
    const white = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.6, flatShading: true });
    const gold = new THREE.MeshBasicMaterial({ color: 0xffe080 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(1.5, 1.7, 0.5, 12), M.trim, 0, 0.25, 0);
    add(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 12), white, 0, 0.65, 0);
    // A robed saint, hands open, wings raised.
    add(new THREE.ConeGeometry(0.75, 2.6, 8), white, 0, 2.1, 0);
    add(new THREE.SphereGeometry(0.28, 8, 6), white, 0, 3.55, 0.05);
    this.halo = add(new THREE.TorusGeometry(0.4, 0.04, 5, 24), gold, 0, 3.85, -0.15, -0.3);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.2, 0.9, 0.2), white, s * 0.55, 2.7, 0.3, -0.9, 0, s * 0.4);
      for (let i = 0; i < 5; i++) {
        add(new THREE.BoxGeometry(1.8 - i * 0.25, 0.14, 0.06), white, s * (0.8 + i * 0.1), 3.4 - i * 0.28, -0.35, 0, 0, s * (0.55 - i * 0.12));
      }
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 20;
    this.group.add(beam);
    this.emitters = [new THREE.Vector3(0, 4, 0)];
    this.color = [0xfff0c0, 0xffe080, 0xffffff];
  }

  update(dt) {
    this.t += dt;
    const k = easeOut(Math.min(1, this.t / 2.2));
    this.group.position.y = this.base.y - 4 * (1 - k);
    const game = this.game;
    if (k < 1 && Math.random() < dt * 40) {
      const a = rand(0, TAU);
      game.particles.emit({
        pos: new THREE.Vector3(this.base.x + Math.cos(a) * 1.8, this.base.y + 0.1, this.base.z + Math.sin(a) * 1.8),
        vel: new THREE.Vector3(rand(-2, 2), rand(2, 4), rand(-2, 2)), life: rand(0.6, 1.2), size: rand(0.08, 0.18), color: 0x2a2a30, gravity: 10, linger: true, floor: this.base.y,
      });
    }
    if (this.halo) this.halo.rotation.z += dt * 0.6;
    for (const e of this.emitters) {
      if (Math.random() < dt * (this.kind === 'devil' ? 30 : 12)) {
        const p = this.group.localToWorld(e.clone());
        game.glow.emit({
          pos: p.add(new THREE.Vector3(rand(-0.2, 0.2), 0, rand(-0.2, 0.2))),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1, 2.5), rand(-0.3, 0.3)), life: rand(0.4, 1), size: rand(0.04, 0.1), color: pick(this.color),
        });
      }
    }
  }
}
