import * as THREE from 'three';
import { pick, chance } from './util.js';

/**
 * Weapon types. Timings are in seconds at speed 1; `kind` picks the viewmodel choreography:
 *  slash  — horizontal cuts alternating side to side
 *  heavy  — slow, wide, committal cleaves
 *  thrust — straight lunging stabs
 *  cast   — fires a bolt from the tip, spending mana
 */
export const WEAPON_TYPES = {
  longsword: { name: 'Longsword', kind: 'slash', damage: 18, speed: 1, reach: 2.8, arc: 1.9, cost: 14, posture: 8, windup: 0.11, active: 0.12, recovery: 0.3 },
  daggers: { name: 'Twin Daggers', kind: 'slash', dual: true, damage: 10, speed: 1, reach: 2.2, arc: 1.7, cost: 8, posture: 4, windup: 0.06, active: 0.08, recovery: 0.17 },
  greatsword: { name: 'Greatsword', kind: 'heavy', damage: 36, speed: 1, reach: 3.3, arc: 2.3, cost: 26, posture: 22, windup: 0.34, active: 0.16, recovery: 0.5 },
  spear: { name: 'Winged Spear', kind: 'thrust', damage: 17, speed: 1, reach: 3.9, arc: 0.7, cost: 13, posture: 7, windup: 0.12, active: 0.11, recovery: 0.3 },
  mace: { name: 'Morning Star', kind: 'slash', damage: 22, speed: 1, reach: 2.5, arc: 1.7, cost: 17, posture: 16, windup: 0.16, active: 0.12, recovery: 0.36 },
  wand: { name: 'Ember Wand', kind: 'cast', damage: 20, speed: 1, reach: 1.8, arc: 1.4, cost: 4, manaCost: 12, posture: 3, windup: 0.16, active: 0.06, recovery: 0.26, bolt: { color: 0xff7a30, speed: 24, burn: 3 } },
  staff: { name: 'Sapphire Staff', kind: 'cast', staff: true, element: 'frost', damage: 34, speed: 1, reach: 2.2, arc: 1.4, cost: 6, manaCost: 22, posture: 10, windup: 0.32, active: 0.08, recovery: 0.36, bolt: { color: 0x6ab8ff, speed: 30, pierce: true } },
  emberstaff: { name: 'Pyre Staff', kind: 'cast', staff: true, element: 'fire', damage: 28, speed: 1, reach: 2.2, arc: 1.4, cost: 6, manaCost: 18, posture: 8, windup: 0.26, active: 0.08, recovery: 0.32, bolt: { color: 0xff6a20, speed: 26, burn: 6 } },
  stormstaff: { name: 'Tempest Staff', kind: 'cast', staff: true, element: 'storm', damage: 24, speed: 1, reach: 2.2, arc: 1.4, cost: 6, manaCost: 16, posture: 12, windup: 0.2, active: 0.06, recovery: 0.28, bolt: { color: 0xc8e8ff, speed: 40 } },
  rapier: { name: 'Duchess Rapier', kind: 'thrust', damage: 14, speed: 1, reach: 3.1, arc: 0.8, cost: 9, posture: 5, windup: 0.07, active: 0.09, recovery: 0.2 },
  scythe: { name: 'Grave Scythe', kind: 'heavy', damage: 27, speed: 1, reach: 3.4, arc: 2.6, cost: 19, posture: 12, windup: 0.22, active: 0.15, recovery: 0.38 },
};

/** Elements of the mage's staves: each unlocks two Staff Arts for a Lantern Mage. */
export const ELEMENTS = {
  fire: { name: 'Fire', color: 0xff6a20 },
  frost: { name: 'Frost', color: 0x7ac8ff },
  storm: { name: 'Storm', color: 0xd8f0ff },
};

export const RARITIES = [
  { id: 'common', name: '', mult: 1, color: 0xc8c4b8, weight: 60 },
  { id: 'fine', name: 'Fine', mult: 1.12, color: 0x5aa0ff, weight: 28 },
  { id: 'rare', name: 'Rare', mult: 1.25, color: 0xb070ff, weight: 10 },
  { id: 'legendary', name: 'Legendary', mult: 1.42, color: 0xffc040, weight: 2 },
];

export const AFFIXES = [
  { id: 'keen', name: 'Keen', desc: 'Swings 15% faster', apply: (w) => { w.speed *= 1.15; } },
  { id: 'crushing', name: 'Crushing', desc: 'Posture damage +60%', apply: (w) => { w.posture *= 1.6; } },
  { id: 'leeching', name: 'of Leeching', suffix: true, desc: 'Hits restore 2 health', apply: (w) => { w.lifesteal = 2; } },
  { id: 'embers', name: 'of Embers', suffix: true, desc: 'Hits set foes alight', apply: (w) => { w.burn = Math.max(w.burn, 5); } },
  { id: 'tuned', name: 'Tuned', desc: 'Parry window +50 ms', apply: (w) => { w.parryBonus = 0.05; } },
  { id: 'long', name: 'Long', desc: 'Reach +15%', apply: (w) => { w.reach *= 1.15; } },
];

let uid = 0;

export function makeWeapon(typeId, { rarity = 'common', affix = null } = {}) {
  const base = WEAPON_TYPES[typeId];
  const r = RARITIES.find((x) => x.id === rarity);
  const w = { ...base, typeId, rarity: r, affix, uid: ++uid, lifesteal: 0, burn: base.bolt?.burn || 0, parryBonus: 0 };
  if (base.bolt) w.bolt = { ...base.bolt };
  w.damage *= r.mult;
  if (affix) affix.apply(w);
  w.displayName = [r.name, affix && !affix.suffix ? affix.name : null, base.name, affix && affix.suffix ? affix.name : null]
    .filter(Boolean).join(' ');
  return w;
}

/** A random weapon for loot; deeper floors skew towards better rarities. */
export function rollWeapon(depth = 1, minRarity = 0) {
  const typeId = pick(Object.keys(WEAPON_TYPES));
  const weights = RARITIES.map((r, i) => (i < minRarity ? 0 : r.weight * (i === 0 ? 1 : 1 + (depth - 1) * 0.5 * i)));
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  let idx = 0;
  for (; idx < weights.length; idx++) {
    x -= weights[idx];
    if (x <= 0) break;
  }
  idx = Math.min(idx, RARITIES.length - 1);
  const affixChance = [0.1, 0.35, 0.75, 1][idx];
  return makeWeapon(typeId, { rarity: RARITIES[idx].id, affix: chance(affixChance) ? pick(AFFIXES) : null });
}

export const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// ============================================================================
// Models — grip at the origin, the business end along +Y.
// ============================================================================

export function weaponMaterials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0xc4c8d2, roughness: 0.3, metalness: 0.25, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x4a4d58, roughness: 0.55, metalness: 0.2, flatShading: true }),
    leather: new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.9, flatShading: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9, flatShading: true }),
    gold: new THREE.MeshStandardMaterial({ color: 0xb08a40, roughness: 0.4, metalness: 0.4, flatShading: true }),
  };
}

function part(g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  g.add(m);
  return m;
}

const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export function buildWeaponModel(typeId, M, glowColor = null) {
  const g = new THREE.Group();
  switch (typeId) {
    case 'longsword':
      part(g, B(0.05, 0.22, 0.05), M.leather, 0, 0.1, 0);
      part(g, B(0.07, 0.07, 0.07), M.dark, 0, -0.03, 0);
      part(g, B(0.34, 0.045, 0.06), M.dark, 0, 0.23, 0);
      part(g, B(0.065, 1.05, 0.016), M.steel, 0, 0.78, 0);
      part(g, B(0.018, 0.9, 0.02), M.dark, 0, 0.72, 0);
      part(g, new THREE.ConeGeometry(0.033, 0.12, 4), M.steel, 0, 1.36, 0, 0, Math.PI / 4);
      break;
    case 'daggers':
      part(g, B(0.045, 0.16, 0.045), M.leather, 0, 0.07, 0);
      part(g, B(0.2, 0.035, 0.05), M.gold, 0, 0.16, 0);
      part(g, B(0.05, 0.42, 0.014), M.steel, 0, 0.38, 0);
      part(g, new THREE.ConeGeometry(0.026, 0.1, 4), M.steel, 0, 0.64, 0, 0, Math.PI / 4);
      break;
    case 'greatsword':
      part(g, B(0.06, 0.42, 0.06), M.leather, 0, 0.15, 0);
      part(g, B(0.1, 0.1, 0.1), M.dark, 0, -0.08, 0);
      part(g, B(0.5, 0.07, 0.09), M.dark, 0, 0.4, 0);
      part(g, B(0.13, 1.55, 0.025), M.steel, 0, 1.2, 0);
      part(g, B(0.03, 1.3, 0.03), M.dark, 0, 1.1, 0);
      part(g, new THREE.ConeGeometry(0.066, 0.18, 4), M.steel, 0, 2.06, 0, 0, Math.PI / 4);
      break;
    case 'spear':
      part(g, new THREE.CylinderGeometry(0.025, 0.025, 2.1, 6), M.wood, 0, 0.55, 0);
      part(g, B(0.2, 0.03, 0.03), M.dark, 0, 1.55, 0);
      part(g, new THREE.ConeGeometry(0.05, 0.42, 4), M.steel, 0, 1.8, 0, 0, Math.PI / 4);
      part(g, B(0.06, 0.08, 0.06), M.dark, 0, -0.5, 0);
      break;
    case 'mace':
      part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), M.wood, 0, 0.3, 0);
      part(g, new THREE.IcosahedronGeometry(0.13, 0), M.dark, 0, 0.78, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(g, new THREE.ConeGeometry(0.03, 0.12, 4), M.steel, Math.cos(a) * 0.13, 0.78, Math.sin(a) * 0.13, 0, 0, a - Math.PI / 2);
      }
      part(g, new THREE.ConeGeometry(0.03, 0.12, 4), M.steel, 0, 0.94, 0);
      break;
    case 'wand': {
      part(g, new THREE.CylinderGeometry(0.018, 0.028, 0.62, 6), M.wood, 0, 0.26, 0, 0.05, 0, 0.04);
      part(g, B(0.05, 0.06, 0.05), M.gold, 0, 0.02, 0);
      const tip = part(g, new THREE.OctahedronGeometry(0.04), new THREE.MeshBasicMaterial({ color: glowColor ?? 0xff7a30 }), 0.012, 0.59, 0);
      tip.userData.tip = true;
      break;
    }
    case 'emberstaff': {
      part(g, new THREE.CylinderGeometry(0.03, 0.036, 1.8, 6), M.dark, 0, 0.42, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        part(g, new THREE.ConeGeometry(0.03, 0.3, 4), M.gold, Math.cos(a) * 0.08, 1.4, Math.sin(a) * 0.08, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
      const tip = part(g, new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color: glowColor ?? 0xff6a20 }), 0, 1.45, 0);
      tip.userData.tip = true;
      break;
    }
    case 'stormstaff': {
      part(g, new THREE.CylinderGeometry(0.026, 0.032, 1.9, 6), M.wood, 0, 0.45, 0);
      for (let i = 0; i < 3; i++) part(g, B(0.2 - i * 0.05, 0.02, 0.02), M.steel, 0.02, 1.25 + i * 0.1, 0, 0, 0, 0.5 - i * 0.3);
      part(g, new THREE.TorusGeometry(0.1, 0.015, 4, 10), M.steel, 0, 1.55, 0);
      const tip = part(g, new THREE.OctahedronGeometry(0.06), new THREE.MeshBasicMaterial({ color: glowColor ?? 0xd8f0ff }), 0, 1.55, 0);
      tip.userData.tip = true;
      break;
    }
    case 'rapier':
      part(g, B(0.04, 0.16, 0.04), M.leather, 0, 0.07, 0);
      part(g, new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI), M.gold, 0, 0.1, 0.02, 0, Math.PI / 2, 0);
      part(g, B(0.22, 0.025, 0.03), M.gold, 0, 0.17, 0);
      part(g, B(0.022, 1.1, 0.012), M.steel, 0, 0.74, 0);
      part(g, new THREE.ConeGeometry(0.012, 0.08, 4), M.steel, 0, 1.33, 0);
      break;
    case 'scythe':
      part(g, new THREE.CylinderGeometry(0.028, 0.03, 1.9, 6), M.wood, 0, 0.45, 0, 0, 0, 0.04);
      part(g, B(0.06, 0.06, 0.06), M.dark, 0, 1.38, 0);
      part(g, new THREE.TorusGeometry(0.4, 0.035, 3, 12, Math.PI * 0.65), M.steel, -0.35, 1.2, 0, 0, 0, 0.6);
      part(g, new THREE.ConeGeometry(0.025, 0.14, 4), M.steel, -0.72, 0.98, 0, 0, 0, 2.4);
      break;
    case 'staff': {
      part(g, new THREE.CylinderGeometry(0.028, 0.034, 1.9, 6), M.wood, 0, 0.45, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        part(g, B(0.025, 0.28, 0.025), M.gold, Math.cos(a) * 0.07, 1.42, Math.sin(a) * 0.07, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      }
      const tip = part(g, new THREE.OctahedronGeometry(0.08), new THREE.MeshBasicMaterial({ color: glowColor ?? 0x6ab8ff }), 0, 1.52, 0);
      tip.scale.y = 1.7;
      tip.userData.tip = true;
      break;
    }
  }
  return g;
}

/** Kite shield for the left hand. Face towards -Z (away from the viewer). */
export function buildShieldModel(M) {
  const g = new THREE.Group();
  const face = new THREE.MeshStandardMaterial({ color: 0x2c3a5a, roughness: 0.7, flatShading: true });
  const shape = new THREE.Shape();
  shape.moveTo(-0.22, 0.28);
  shape.lineTo(0.22, 0.28);
  shape.lineTo(0.22, -0.05);
  shape.quadraticCurveTo(0.2, -0.3, 0, -0.42);
  shape.quadraticCurveTo(-0.2, -0.3, -0.22, -0.05);
  shape.lineTo(-0.22, 0.28);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.015, bevelSegments: 1 }), M.dark);
  body.position.z = -0.02;
  g.add(body);
  const inner = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false }), face);
  inner.scale.set(0.82, 0.82, 1);
  inner.position.set(0, -0.01, -0.035);
  g.add(inner);
  const boss = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), M.gold);
  boss.position.set(0, 0.02, -0.06);
  g.add(boss);
  const cross = new THREE.Mesh(B(0.04, 0.4, 0.01), M.gold);
  cross.position.set(0, 0, -0.05);
  g.add(cross);
  const bar = new THREE.Mesh(B(0.28, 0.04, 0.01), M.gold);
  bar.position.set(0, 0.1, -0.05);
  g.add(bar);
  return g;
}
