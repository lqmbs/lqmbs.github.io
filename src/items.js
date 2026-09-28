import * as THREE from 'three';
import { rand, easeOut, pick } from './util.js';
import { RELICS } from './relics.js';

/**
 * Relics. Most change the numbers; the ones marked with a `mech` change *how you play* — they
 * hook into swings, hits, parries, kills and jumps through the player's BuildFX.
 *
 * Pools:
 *  - common: pedestals, chests, the treasure room
 *  - shop:   also sold by the merchant
 *  - devil:  offered after a guardian falls, paid for in maximum vigor
 *  - angel:  offered after a guardian falls, free — but you may take only one
 */
export const ITEMS = [
  // ---- Stat relics ---------------------------------------------------------
  { id: 'whetstone', name: 'Cursed Whetstone', desc: 'Swing speed up', lore: 'It hones the blade and dulls the soul.', color: 0x8fd0ff, shape: 'shard', pools: ['common', 'shop'],
    apply: (s) => { s.attackSpeed *= 1.2; } },
  { id: 'ember', name: 'Vampiric Ember', desc: 'Strikes drain life', lore: 'A coal that still remembers blood.', color: 0xff3322, shape: 'orb', pools: ['common', 'shop'],
    apply: (s) => { s.lifesteal += 3; } },
  { id: 'greatshard', name: 'Ashen Greatblade Shard', desc: 'Damage up', lore: 'Broken from the sword of a king no one mourned.', color: 0xd9d2c0, shape: 'shard', pools: ['common', 'shop'],
    apply: (s) => { s.damageMult *= 1.2; } },
  { id: 'fork', name: 'Tuning Fork of the Deep', desc: 'Wider parry window', lore: 'Struck once, it hums for a thousand years.', color: 0x6ad8ff, shape: 'fork', pools: ['common', 'shop'],
    apply: (s) => { s.parryWindow += 0.05; } },
  { id: 'aegis', name: "Warden's Aegis", desc: 'Blocking costs less', lore: 'Its bearer never fell. Its bearer never left.', color: 0xc0c8d8, shape: 'shield', pools: ['common'],
    apply: (s) => { s.blockReduction = Math.min(0.97, s.blockReduction + 0.1); s.blockStaminaMult *= 0.7; } },
  { id: 'chalice', name: 'Bloodied Chalice', desc: 'Max health up, fully healed', lore: 'Drink, and be less dead.', color: 0xc41e2a, shape: 'chalice', pools: ['common', 'shop'],
    apply: (s, p) => { s.maxHp += 25; p.hp = s.maxHp; } },
  { id: 'lung', name: 'Hollow Lung', desc: 'Stamina recovers faster', lore: 'Breathes for you, whether you like it or not.', color: 0x7fbf6a, shape: 'orb', pools: ['common'],
    apply: (s) => { s.staminaRegen *= 1.35; } },
  { id: 'heart', name: 'Heart of the Unkindled', desc: 'Max stamina up', lore: 'It beats slowly, and it does not tire.', color: 0xff7a3a, shape: 'heart', pools: ['common'],
    apply: (s, p) => { s.maxStamina += 30; p.stamina = s.maxStamina; } },
  { id: 'lantern', name: 'Grave Lantern', desc: 'Your light burns farther', lore: 'Its flame is fed by those you fell.', color: 0xffc46a, shape: 'lantern', pools: ['common'],
    apply: (s) => { s.lightRadius *= 1.28; } },
  { id: 'brand', name: "Executioner's Brand", desc: 'Ripostes strike harder', lore: 'Mark of one who never missed the neck.', color: 0xe0643a, shape: 'ring', pools: ['common', 'shop'],
    apply: (s) => { s.riposteMult *= 1.4; } },
  { id: 'rosary', name: 'Thorned Rosary', desc: 'Parries wound the attacker', lore: 'Every bead a prayer, every prayer a barb.', color: 0x6ad0a0, shape: 'ring', pools: ['common'],
    apply: (s) => { s.parryDamage += 14; } },
  { id: 'shroud', name: 'Moth-Eaten Shroud', desc: 'Move speed up', lore: 'Lighter than the body it once wrapped.', color: 0xb0a890, shape: 'cloak', pools: ['common'],
    apply: (s) => { s.speed *= 1.1; } },
  { id: 'tithe', name: "Sinner's Tithe", desc: 'Damage way up, max health down', lore: 'Paid in flesh, collected in blood.', color: 0x8a1030, shape: 'shard', pools: ['common'],
    apply: (s, p) => { s.damageMult *= 1.45; s.maxHp = Math.max(30, s.maxHp - 20); p.hp = Math.min(p.hp, s.maxHp); } },
  { id: 'tear', name: 'Crimson Tear', desc: 'Restores 50 health', lore: 'Wept by a saint who bled instead.', color: 0xff2040, shape: 'orb', consumable: true, pools: ['common'],
    apply: (s, p) => { p.hp = Math.min(s.maxHp, p.hp + 50); } },

  // ---- Build-changing relics -------------------------------------------------
  { id: 'storm', name: "Stormcaller's Chime", desc: 'Hits may arc lightning to nearby foes', lore: 'It rings before the thunder does.', color: 0x9ad8ff, shape: 'bell', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.chainChance = Math.min(0.8, s.chainChance + 0.3); } },
  { id: 'mirror', name: 'Drowned Mirror', desc: 'Parries burst outward, staggering all nearby', lore: 'What strikes it, strikes back tenfold.', color: 0x7af0d8, shape: 'mirror', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.parryShock += 1; } },
  { id: 'cinder', name: 'Cinder Heart', desc: 'Your strikes set foes ablaze', lore: 'Still warm. Always warm.', color: 0xff7a20, shape: 'heart', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.igniteOnHit += 5; } },
  { id: 'wing', name: "Gargoyle's Wing", desc: 'Jump again in mid-air', lore: 'Stone that forgot it could not fly.', color: 0xc8c0b0, shape: 'wing', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.extraJumps += 1; } },
  { id: 'knives', name: 'Circlet of Hungry Knives', desc: 'Two spectral knives circle you', lore: 'They are never full.', color: 0xb8a0ff, shape: 'ring', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.orbitBlades += 2; } },
  { id: 'bloom', name: 'Corpse Bloom', desc: 'The slain burst, wounding foes nearby', lore: 'Death is only a seed.', color: 0x9ae050, shape: 'bloom', pools: ['common'], mech: true,
    apply: (s) => { s.corpseBurst += 32; } },
  { id: 'siphon', name: 'Soul Siphon', desc: 'Kills restore health and mana', lore: 'A funnel of pale glass, always pointing at the dying.', color: 0x80b0ff, shape: 'funnel', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.killHeal += 4; s.killMana += 15; } },
  { id: 'crescent', name: 'Crescent Sigil', desc: 'At full health, swings loose a crescent of light', lore: 'The moon, pressed into a coin.', color: 0xf0e0a0, shape: 'crescent', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.bladeWave += 0.7; } },
  { id: 'collar', name: "Hound's Collar", desc: 'After a parry, attack 50% faster for 3 s', lore: 'The leash was cut long ago.', color: 0xd09050, shape: 'ring', pools: ['common'], mech: true,
    apply: (s) => { s.parryHaste += 3; } },
  { id: 'purse', name: "Miser's Purse", desc: 'Foes drop twice the coin', lore: 'Heavier every time you look away.', color: 0xf0c040, shape: 'purse', pools: ['shop'], mech: true,
    apply: (s) => { s.coinMult *= 2; } },
  { id: 'ashflask', name: 'Ashen Flask', desc: 'One more Crimson Flask', lore: 'The glass is warm with someone else\'s blood.', color: 0xff5040, shape: 'flask', pools: ['common', 'shop'],
    apply: (s, p) => { p.maxFlasks += 1; p.flasks += 1; } },
  { id: 'crown', name: 'Kindled Crown', desc: 'Your ultimate charges 50% faster', lore: 'It burns the brow of whoever deserves it.', color: 0xffb040, shape: 'crown', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.ultRate *= 1.5; } },
  { id: 'hourglass', name: 'Hourglass of Grave-Sand', desc: 'Class skill recovers 35% faster', lore: 'The sand is fine. It was people once.', color: 0xd8c890, shape: 'hourglass', pools: ['common', 'shop'], mech: true,
    apply: (s) => { s.skillCdMult *= 0.65; } },
  { id: 'knuckle', name: "Saint's Knuckle", desc: 'Parries mend 5 health', lore: 'A relic of a hand that caught a sword.', color: 0xf8f0d8, shape: 'orb', pools: ['common'], mech: true,
    apply: (s) => { s.parryHeal += 5; } },
  { id: 'tooth', name: "Berserker's Tooth", desc: 'Below 35% health, deal 60% more damage', lore: 'Pulled from a jaw that would not stop biting.', color: 0xe0d0b0, shape: 'fang', pools: ['common'], mech: true,
    apply: (s) => { s.frenzy += 0.6; } },

  // ---- Devil deals: power, paid for in flesh ---------------------------------
  { id: 'pact', name: 'Pact of Brimstone', desc: 'Every swing hurls a homing brimstone bolt', lore: 'Sign here. And here. And here.', color: 0xff3010, shape: 'horns', pools: ['devil'], devilCost: 25, mech: true,
    apply: (s) => { s.brimstone += 1; s.damageMult *= 1.1; } },
  { id: 'goathorn', name: 'Horn of the Goat', desc: 'Damage ×1.5 and a second jump', lore: 'It still smells of the altar.', color: 0xa02010, shape: 'horns', pools: ['devil'], devilCost: 30, mech: true,
    apply: (s) => { s.damageMult *= 1.5; s.extraJumps += 1; } },
  { id: 'glassheart', name: 'Heart of Black Glass', desc: 'Damage ×2, but you take 60% more harm', lore: 'Beautiful. Brittle. Yours.', color: 0x40182a, shape: 'heart', pools: ['devil'], devilCost: 15, mech: true,
    apply: (s) => { s.damageMult *= 2; s.damageTaken *= 1.6; } },
  { id: 'crimsoncrown', name: 'The Crimson Crown', desc: 'Kills heal, strikes drain, ultimate charges 40% faster', lore: 'Heavy is the head. Heavier the hands.', color: 0xd01830, shape: 'crown', pools: ['devil'], devilCost: 25, mech: true,
    apply: (s) => { s.killHeal += 6; s.lifesteal += 2; s.ultRate *= 1.4; } },
  { id: 'shades', name: 'Mantle of Hungry Shades', desc: 'Four shadow blades circle you', lore: 'They whisper your name as they cut.', color: 0x6030a0, shape: 'cloak', pools: ['devil'], devilCost: 30, mech: true,
    apply: (s) => { s.orbitBlades += 4; s.devilBlades = true; } },

  // ---- Angel deals: grace, freely given (choose one) -------------------------
  { id: 'halo', name: 'Halo of the Last Saint', desc: 'A halo hovers over you, smiting the nearest foe', lore: 'She is gone. Her light was not told.', color: 0xfff0b0, shape: 'halo', pools: ['angel'], mech: true,
    apply: (s) => { s.halo += 1; } },
  { id: 'feather', name: 'Seraph Feather', desc: 'Mid-air jump, faster feet, and falls cost nothing', lore: 'It never touches the ground.', color: 0xf0f4ff, shape: 'wing', pools: ['angel'], mech: true,
    apply: (s) => { s.extraJumps += 1; s.speed *= 1.1; s.fallImmune = true; } },
  { id: 'mercy', name: 'Aegis of Mercy', desc: 'Once per floor, a killing blow leaves you standing', lore: 'Not yet, child. Not yet.', color: 0xffe080, shape: 'shield', pools: ['angel'], mech: true,
    apply: (s) => { s.deathWard += 1; s.wardMax = (s.wardMax || 0) + 1; } },
  { id: 'sanctified', name: 'Sanctified Edge', desc: 'Ripostes ×1.5; parries mend 8 health', lore: 'Blessed by a hand that never held a blade.', color: 0xffffff, shape: 'shard', pools: ['angel'], mech: true,
    apply: (s) => { s.riposteMult *= 1.5; s.parryHeal += 8; } },
  { id: 'dove', name: 'Dove of Ash', desc: 'Max health +40, fully healed, one more flask', lore: 'It flew out of the fire, and it was not burned.', color: 0xe8e0d0, shape: 'wing', pools: ['angel'],
    apply: (s, p) => { s.maxHp += 40; p.hp = s.maxHp; p.maxFlasks += 1; p.flasks += 1; } },
];

ITEMS.push(...RELICS);

export const itemById = (id) => ITEMS.find((i) => i.id === id);

/** Weighted roll from a pool; duplicates grow less likely, and `exclude` is skipped. */
export function rollItem(player, pool = 'common', exclude = []) {
  const hurt = player.hp < player.stats.maxHp * 0.6;
  const list = ITEMS.filter((i) => i.pools.includes(pool) && (!i.consumable || hurt) && !exclude.includes(i.id));
  const weights = list.map((i) => (i.consumable ? 1.4 : i.mech ? 1.15 : 1) / (1 + 0.8 * (player.itemCounts.get(i.id) || 0)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[0];
}

/** Several distinct items from a pool. */
export function rollItems(player, pool, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(rollItem(player, pool, out.map((o) => o.id)));
  return out;
}

export function itemPrice(item) { return item.mech ? 24 : 16; }

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
    case 'bell':
      add(new THREE.CylinderGeometry(0.07, 0.19, 0.26, 8));
      add(new THREE.TorusGeometry(0.05, 0.02, 4, 8), 0.17);
      break;
    case 'mirror':
      add(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 10)).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.05, 0.18, 0.04), -0.26);
      break;
    case 'wing':
      for (let i = 0; i < 4; i++) {
        const f = add(new THREE.BoxGeometry(0.34 - i * 0.06, 0.05, 0.02), 0.12 - i * 0.07);
        f.position.x = 0.05 + i * 0.02;
        f.rotation.z = 0.35 - i * 0.12;
      }
      break;
    case 'bloom':
      for (let i = 0; i < 5; i++) {
        const p = add(new THREE.ConeGeometry(0.07, 0.24, 4));
        const a = (i / 5) * Math.PI * 2;
        p.position.set(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
        p.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8);
      }
      add(new THREE.IcosahedronGeometry(0.07));
      break;
    case 'funnel': add(new THREE.ConeGeometry(0.18, 0.34, 8, 1, true)).rotation.x = Math.PI; break;
    case 'crescent': add(new THREE.TorusGeometry(0.17, 0.05, 5, 12, Math.PI * 1.3)).rotation.z = -0.4; break;
    case 'purse':
      add(new THREE.DodecahedronGeometry(0.17)).scale.set(1, 0.85, 0.9);
      add(new THREE.CylinderGeometry(0.05, 0.08, 0.08, 6), 0.17);
      break;
    case 'flask':
      add(new THREE.CylinderGeometry(0.1, 0.13, 0.26, 7));
      add(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 6), 0.18);
      break;
    case 'crown': {
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 8, 1, true));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.04, 0.14, 4), 0.11).position.set(Math.cos(a) * 0.16, 0.11, Math.sin(a) * 0.16);
      }
      break;
    }
    case 'hourglass':
      add(new THREE.ConeGeometry(0.13, 0.16, 6), 0.08).rotation.x = Math.PI;
      add(new THREE.ConeGeometry(0.13, 0.16, 6), -0.08);
      add(new THREE.BoxGeometry(0.3, 0.03, 0.3), 0.17);
      add(new THREE.BoxGeometry(0.3, 0.03, 0.3), -0.17);
      break;
    case 'fang': add(new THREE.ConeGeometry(0.08, 0.36, 5)).rotation.x = Math.PI; break;
    case 'horns':
      for (const s of [-1, 1]) {
        const h = add(new THREE.ConeGeometry(0.06, 0.34, 5));
        h.position.x = s * 0.1;
        h.rotation.z = -s * 0.5;
      }
      add(new THREE.DodecahedronGeometry(0.1), -0.12);
      break;
    case 'halo': add(new THREE.TorusGeometry(0.18, 0.03, 5, 20)).rotation.x = Math.PI / 2; break;
    case 'eye':
      add(new THREE.SphereGeometry(0.16, 10, 8)).scale.set(1, 0.7, 0.6);
      add(new THREE.TorusGeometry(0.2, 0.025, 4, 16));
      break;
    case 'feather': add(new THREE.ConeGeometry(0.07, 0.5, 4)).scale.set(1, 1, 0.25); break;
    case 'skull':
      add(new THREE.BoxGeometry(0.26, 0.24, 0.26));
      add(new THREE.BoxGeometry(0.18, 0.09, 0.2), -0.15);
      break;
    case 'star':
      for (let i = 0; i < 3; i++) add(new THREE.OctahedronGeometry(0.2)).rotation.set(i, i * 0.7, 0);
      break;
    case 'tome':
      add(new THREE.BoxGeometry(0.3, 0.38, 0.08));
      add(new THREE.BoxGeometry(0.26, 0.34, 0.1));
      break;
    case 'claw':
      for (let i = 0; i < 3; i++) {
        const c = add(new THREE.ConeGeometry(0.04, 0.34, 4));
        c.position.x = (i - 1) * 0.09;
        c.rotation.z = (i - 1) * 0.25;
      }
      break;
    case 'gem': add(new THREE.OctahedronGeometry(0.18)).scale.set(1, 1.3, 1); break;
    case 'chain':
      for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.06, 0.018, 4, 10), -0.18 + i * 0.12).rotation.y = i * Math.PI / 2;
      break;
    default: add(new THREE.IcosahedronGeometry(0.17)); break;
  }
  return g;
}

/**
 * A relic on a stone pedestal. Plain pedestals are claimed by walking into them; priced ones
 * (devil deals, angel choices) wait for [E].
 *
 * opts.deal:   'devil' | 'angel' | undefined
 * opts.group:  pedestals sharing a group vanish together when one is taken (angel choice)
 */
export class Pedestal {
  constructor(chamber, item, x, y, z, risen = false, opts = {}) {
    this.chamber = chamber;
    this.game = chamber.game;
    this.item = item;
    this.taken = false;
    this.deal = opts.deal ?? null;
    this.group_ = opts.group ?? null;
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
    const top = this.deal === 'devil' ? M.void : this.deal === 'angel' ? M.wax : M.trim;
    part(new THREE.BoxGeometry(1.4, 0.3, 1.4), top, 0.15);
    part(new THREE.CylinderGeometry(0.36, 0.44, 0.8, 8), this.deal === 'angel' ? M.bone : M.stone, 0.7);
    part(new THREE.BoxGeometry(0.95, 0.16, 0.95), top, 1.18);
    this.itemMesh = buildItemMesh(item);
    this.itemMesh.position.y = 1.6;
    this.rig.add(this.itemMesh);
    (chamber.actors || chamber.group).add(this.group);
    this.obstacle = chamber.world.addCircleWorld(x, z, 0.7, y - 1, y + 1.3);
    if (this.deal) {
      this.radius = 2.6;
      chamber.interactables.push(this);
    }
    if (!risen) {
      this.game.particles.burst(new THREE.Vector3(x, y + 0.2, z), 30, () => ({
        vel: new THREE.Vector3(rand(-3, 3), rand(1, 4), rand(-3, 3)), life: rand(0.6, 1.3), size: rand(0.08, 0.2), color: 0x3a3a40, gravity: 9, linger: true, floor: y,
      }));
    }
  }

  get position() { return this.group.position; }
  get lightPosition() { return new THREE.Vector3(this.group.position.x, this.baseY + 2.0, this.group.position.z); }

  get prompt() {
    if (this.deal === 'devil') return `${this.item.name} — pay ${this.item.devilCost} max vigor`;
    return `${this.item.name} — accept the gift`;
  }

  get sub() { return this.item.desc + (this.deal === 'angel' ? ' · the others will fade' : ''); }
  get promptColor() { return this.deal === 'devil' ? '#ff5a3a' : '#fff0c0'; }

  interact() {
    if (this.taken) return;
    const p = this.game.player;
    if (this.deal === 'devil') {
      if (p.stats.maxHp - this.item.devilCost < 20) {
        this.game.audio.play('empty');
        this.game.hud.toast('Not enough flesh', 'Your vigor could not pay this price', 0x8a1010);
        return;
      }
      p.stats.maxHp -= this.item.devilCost;
      p.hp = Math.min(p.hp, p.stats.maxHp);
      p.devilDeals++;
      this.game.hurtFlash = 0.8;
      this.game.audio.play('devil');
    } else this.game.audio.play('angel');
    this.take();
  }

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
        vel: new THREE.Vector3(0, rand(0.5, 1.2), 0), life: rand(0.8, 1.4), size: 0.04,
        color: this.deal === 'devil' ? pick([0xff3010, 0x600000]) : this.item.color,
      });
    }
    if (this.deal) return;
    const player = this.game.player;
    const p = this.group.position;
    if (rise > 0.95 && player.alive
      && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 1.35
      && Math.abs(player.pos.y - p.y) < 1.2) this.take();
  }

  take() {
    this.taken = true;
    this.itemMesh.visible = false;
    this.removeInteractable();
    const pos = this.group.position.clone().setY(this.baseY + 1.6);
    this.game.glow.burst(pos, 40, () => ({
      vel: new THREE.Vector3(rand(-4, 4), rand(-1, 5), rand(-4, 4)), life: rand(0.5, 1.2), size: rand(0.04, 0.1), color: this.item.color, drag: 2,
    }));
    this.game.onItemPickup(this.item);
    if (this.group_) for (const other of this.group_) if (other !== this) other.vanish();
  }

  /** An angel's other gifts fade when one is chosen. */
  vanish() {
    if (this.taken) return;
    this.taken = true;
    this.itemMesh.visible = false;
    this.removeInteractable();
    const pos = this.group.position.clone().setY(this.baseY + 1.6);
    this.game.glow.burst(pos, 24, () => ({
      vel: new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)), life: rand(0.8, 1.6), size: 0.05, color: 0xfff0c0, drag: 1,
    }));
  }

  removeInteractable() {
    const list = this.chamber.interactables;
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
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
