import * as THREE from 'three';
import { rand, easeOut } from './util.js';

export const ITEMS = [
  { id: 'whetstone', name: 'Cursed Whetstone', desc: 'Swing speed up', lore: 'It hones the blade and dulls the soul.', color: 0x8fd0ff, shape: 'shard',
    apply: (s) => { s.attackSpeed *= 1.2; } },
  { id: 'ember', name: 'Vampiric Ember', desc: 'Strikes drain life', lore: 'A coal that still remembers blood.', color: 0xff3322, shape: 'orb',
    apply: (s) => { s.lifesteal += 3; } },
  { id: 'greatshard', name: 'Ashen Greatblade Shard', desc: 'Damage up', lore: 'Broken from the sword of a king no one mourned.', color: 0xd9d2c0, shape: 'shard',
    apply: (s) => { s.damageMult *= 1.2; } },
  { id: 'fork', name: 'Tuning Fork of the Deep', desc: 'Wider parry window', lore: 'Struck once, it hums for a thousand years.', color: 0x6ad8ff, shape: 'fork',
    apply: (s) => { s.parryWindow += 0.05; } },
  { id: 'aegis', name: "Warden's Aegis", desc: 'Blocking costs less', lore: 'Its bearer never fell. Its bearer never left.', color: 0xc0c8d8, shape: 'shield',
    apply: (s) => { s.blockReduction = Math.min(0.97, s.blockReduction + 0.1); s.blockStaminaMult *= 0.7; } },
  { id: 'chalice', name: 'Bloodied Chalice', desc: 'Max health up, fully healed', lore: 'Drink, and be less dead.', color: 0xc41e2a, shape: 'chalice',
    apply: (s, p) => { s.maxHp += 25; p.hp = s.maxHp; } },
  { id: 'lung', name: 'Hollow Lung', desc: 'Stamina recovers faster', lore: 'Breathes for you, whether you like it or not.', color: 0x7fbf6a, shape: 'orb',
    apply: (s) => { s.staminaRegen *= 1.35; } },
  { id: 'heart', name: 'Heart of the Unkindled', desc: 'Max stamina up', lore: 'It beats slowly, and it does not tire.', color: 0xff7a3a, shape: 'heart',
    apply: (s, p) => { s.maxStamina += 30; p.stamina = s.maxStamina; } },
  { id: 'lantern', name: 'Grave Lantern', desc: 'Your light burns farther', lore: 'Its flame is fed by those you fell.', color: 0xffc46a, shape: 'lantern',
    apply: (s) => { s.lightRadius *= 1.28; } },
  { id: 'brand', name: "Executioner's Brand", desc: 'Ripostes strike harder', lore: 'Mark of one who never missed the neck.', color: 0xe0643a, shape: 'ring',
    apply: (s) => { s.riposteMult *= 1.4; } },
  { id: 'rosary', name: 'Thorned Rosary', desc: 'Parries wound the attacker', lore: 'Every bead a prayer, every prayer a barb.', color: 0x6ad0a0, shape: 'ring',
    apply: (s) => { s.parryDamage += 14; } },
  { id: 'shroud', name: 'Moth-Eaten Shroud', desc: 'Move speed up', lore: 'Lighter than the body it once wrapped.', color: 0xb0a890, shape: 'cloak',
    apply: (s) => { s.speed *= 1.1; } },
  { id: 'tithe', name: "Sinner's Tithe", desc: 'Damage way up, max health down', lore: 'Paid in flesh, collected in blood.', color: 0x8a1030, shape: 'shard',
    apply: (s, p) => { s.damageMult *= 1.45; s.maxHp = Math.max(30, s.maxHp - 20); p.hp = Math.min(p.hp, s.maxHp); } },
  { id: 'tear', name: 'Crimson Tear', desc: 'Restores 50 health', lore: 'Wept by a saint who bled instead.', color: 0xff2040, shape: 'orb', consumable: true,
    apply: (s, p) => { p.hp = Math.min(s.maxHp, p.hp + 50); } },
];

export function rollItem(player) {
  const hurt = player.hp < player.stats.maxHp * 0.6;
  const pool = ITEMS.filter((i) => !i.consumable || hurt);
  const weights = pool.map((i) => (i.consumable ? 1.4 : 1) / (1 + 0.6 * (player.itemCounts.get(i.id) || 0)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

export function buildItemMesh(item) {
  const mat = new THREE.MeshStandardMaterial({ color: item.color, emissive: item.color, emissiveIntensity: 2.2, roughness: 0.4, flatShading: true });
  const g = new THREE.Group();
  const add = (geo, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    g.add(m);
    return m;
  };
  switch (item.shape) {
    case 'shard': add(new THREE.OctahedronGeometry(0.2)).scale.set(0.6, 1.6, 0.6); break;
    case 'orb': add(new THREE.IcosahedronGeometry(0.18)); break;
    case 'ring': add(new THREE.TorusGeometry(0.17, 0.05, 6, 12)); break;
    case 'heart': add(new THREE.DodecahedronGeometry(0.18)).scale.set(1, 1.15, 0.8); break;
    case 'fork':
      add(new THREE.BoxGeometry(0.04, 0.22, 0.04), -0.12);
      add(new THREE.BoxGeometry(0.2, 0.04, 0.04), 0.0);
      add(new THREE.BoxGeometry(0.04, 0.26, 0.04), 0.14).position.x = -0.08;
      add(new THREE.BoxGeometry(0.04, 0.26, 0.04), 0.14).position.x = 0.08;
      break;
    case 'shield': add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 6)).rotation.x = Math.PI / 2; break;
    case 'chalice':
      add(new THREE.CylinderGeometry(0.16, 0.06, 0.2, 8), 0.08);
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), -0.09);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 8), -0.17);
      break;
    case 'lantern':
      add(new THREE.BoxGeometry(0.18, 0.24, 0.18));
      add(new THREE.ConeGeometry(0.14, 0.1, 4), 0.17);
      break;
    case 'cloak': add(new THREE.ConeGeometry(0.18, 0.42, 5)); break;
  }
  return g;
}

export class Pedestal {
  constructor(chamber, item, x, y, z, risen = false) {
    this.chamber = chamber;
    this.game = chamber.game;
    this.item = item;
    this.taken = false;
    this.t = risen ? 10 : 0;
    this.baseY = y;
    const M = this.game.materials;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    const part = (geo, mat, py) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = py;
      m.castShadow = m.receiveShadow = true;
      this.rig.add(m);
    };
    part(new THREE.BoxGeometry(1.4, 0.3, 1.4), M.trim, 0.15);
    part(new THREE.CylinderGeometry(0.36, 0.44, 0.8, 8), M.stone, 0.7);
    part(new THREE.BoxGeometry(0.95, 0.16, 0.95), M.trim, 1.18);
    this.itemMesh = buildItemMesh(item);
    this.itemMesh.position.y = 1.6;
    this.rig.add(this.itemMesh);
    (chamber.actors || chamber.group).add(this.group);
    this.obstacle = chamber.world.addCircleWorld(x, z, 0.7, y - 1, y + 1.3);
    if (!risen) {
      this.game.particles.burst(new THREE.Vector3(x, y + 0.2, z), 30, () => ({
        vel: new THREE.Vector3(rand(-3, 3), rand(1, 4), rand(-3, 3)), life: rand(0.6, 1.3), size: rand(0.08, 0.2), color: 0x3a3a40, gravity: 9, linger: true, floor: y,
      }));
    }
  }

  get lightPosition() { return new THREE.Vector3(this.group.position.x, this.baseY + 2.0, this.group.position.z); }

  update(dt) {
    this.t += dt;
    const rise = easeOut(Math.min(1, this.t / 1.3));
    this.rig.position.y = -1.6 * (1 - rise);
    if (this.taken) return;
    this.itemMesh.rotation.y += dt * 1.5;
    this.itemMesh.position.y = 1.6 + Math.sin(this.t * 2.2) * 0.08;
    if (Math.random() < dt * 14) {
      const p = this.group.position;
      this.game.glow.emit({
        pos: new THREE.Vector3(p.x + rand(-0.25, 0.25), p.y + 1.3 + this.rig.position.y, p.z + rand(-0.25, 0.25)),
        vel: new THREE.Vector3(0, rand(0.5, 1.2), 0), life: rand(0.8, 1.4), size: 0.04, color: this.item.color,
      });
    }
    const player = this.game.player;
    const p = this.group.position;
    if (rise > 0.95 && player.alive
      && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 1.35
      && Math.abs(player.pos.y - p.y) < 1.2) this.take();
  }

  take() {
    this.taken = true;
    this.itemMesh.visible = false;
    const pos = this.group.position.clone().setY(this.baseY + 1.6);
    this.game.glow.burst(pos, 40, () => ({
      vel: new THREE.Vector3(rand(-4, 4), rand(-1, 5), rand(-4, 4)), life: rand(0.5, 1.2), size: rand(0.04, 0.1), color: this.item.color, drag: 2,
    }));
    this.game.onItemPickup(this.item);
  }
}

/** The well down to the next floor — a column of pale light over a rune circle. */
export class Descent {
  constructor(chamber, x, y, z) {
    this.chamber = chamber;
    this.game = chamber.game;
    this.t = 0;
    this.used = false;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    const M = this.game.materials;
    const pit = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20).rotateX(-Math.PI / 2), M.void);
    pit.position.y = 0.02;
    this.group.add(pit);
    this.shaftMat = new THREE.MeshBasicMaterial({ color: 0x9ab8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 30, 12, 1, true), this.shaftMat);
    shaft.position.y = 15;
    this.group.add(shaft);
    this.runeMat = new THREE.MeshBasicMaterial({ color: 0x8ab0ff, transparent: true, opacity: 0 });
    const rune = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.6, 32).rotateX(-Math.PI / 2), this.runeMat);
    rune.position.y = 0.03;
    this.group.add(rune);
    (chamber.actors || chamber.group).add(this.group);
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / 1.5);
    this.shaftMat.opacity = k * (0.1 + Math.sin(this.t * 2) * 0.02);
    this.runeMat.opacity = k * (0.7 + 0.3 * Math.sin(this.t * 3));
    if (Math.random() < dt * 20 * k) {
      const p = this.group.position;
      const a = rand(0, Math.PI * 2);
      this.game.glow.emit({
        pos: new THREE.Vector3(p.x + Math.cos(a) * rand(0, 1.2), p.y + 0.1, p.z + Math.sin(a) * rand(0, 1.2)),
        vel: new THREE.Vector3(0, rand(1.5, 3.5), 0), life: rand(1, 2), size: 0.05, color: 0x9ab8ff,
      });
    }
    const player = this.game.player;
    const p = this.group.position;
    if (k >= 1 && !this.used && player.alive && player.grounded
      && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 1.1 && Math.abs(player.pos.y - p.y) < 0.6) {
      this.used = true;
      this.game.descend();
    }
  }
}
