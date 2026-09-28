/**
 * Playable classes. Each defines base stats, a starting weapon, an off-hand, a passive, an
 * active skill (Q) on a cooldown, and an ultimate (R) charged by fighting well: damage dealt,
 * parries and kills all feed it.
 *
 * `affinity` is each class's special bond with certain weapons: holding one of `weapons`
 * switches on an extra behaviour that no other class gets from the same weapon.
 */
export const CLASSES = {
  knight: {
    id: 'knight',
    name: 'Vigil Knight',
    tagline: 'Sworn to a hold that no longer stands.',
    weapon: 'longsword',
    offhand: 'shield',
    color: '#9ab4e0',
    stats: { maxHp: 125, maxStamina: 100, staminaRegen: 55, speed: 5.0, maxMana: 0, manaRegen: 0, parryWindow: 0.23, blockReduction: 0.95, blockStaminaMult: 0.8, lightRadius: 1 },
    passive: { name: 'Bulwark', desc: 'Wider parry window. The shield blocks almost all damage.' },
    skill: { id: 'bash', name: 'Shield Bash', desc: 'Lunge behind the shield. Staggers foes and hurls them back — even off ledges.', cooldown: 6 },
    ultimate: { id: 'oath', name: 'Oath of the Vigil', desc: 'Leap and drive the sword down: a shockwave breaks every guard nearby, then an aegis of light halves all harm for 8 s.', charge: 100 },
    affinity: { weapons: ['longsword'], name: 'Unbroken Stance', desc: 'Longswords: swings carry hyperarmor. Blows land for less and never interrupt the cut.' },
    bars: { vigor: 5, endurance: 3, arcane: 0, speed: 2 },
  },
  duelist: {
    id: 'duelist',
    name: 'Duelist',
    tagline: 'Two blades, one breath, no second chances.',
    weapon: 'daggers',
    offhand: 'dagger',
    color: '#e0b27a',
    stats: { maxHp: 85, maxStamina: 125, staminaRegen: 68, speed: 5.8, maxMana: 0, manaRegen: 0, parryWindow: 0.18, blockReduction: 0.7, blockStaminaMult: 1.2, lightRadius: 1, riposteBonus: 0.4 },
    passive: { name: 'Coup de Grâce', desc: 'Ripostes deal 40% more damage. Fastest on foot.' },
    skill: { id: 'sidestep', name: 'Sidestep', desc: 'A darting step in any direction, untouchable for a heartbeat.', cooldown: 1.6, stamina: 12 },
    ultimate: { id: 'cuts', name: 'Thousand Cuts', desc: 'Time bends. Blink between up to seven foes, cutting each as if it were staggered.', charge: 90 },
    affinity: { weapons: ['daggers'], name: 'Bloodrush', desc: 'Twin daggers: kills in quick succession stack speed, up to five times — faster feet, faster blades.' },
    bars: { vigor: 2, endurance: 5, arcane: 0, speed: 5 },
  },
  mage: {
    id: 'mage',
    name: 'Lantern Mage',
    tagline: 'Keeper of the last flame that remembers the sun.',
    weapon: 'wand',
    offhand: 'lantern',
    color: '#ff9a50',
    stats: { maxHp: 75, maxStamina: 90, staminaRegen: 50, speed: 5.1, maxMana: 100, manaRegen: 7, parryWindow: 0.16, blockReduction: 0.5, blockStaminaMult: 1.3, lightRadius: 1.35 },
    passive: { name: 'Kindled', desc: 'Casts spells from a mana well. The lantern burns brighter.' },
    skill: { id: 'flare', name: 'Lantern Flare', desc: 'The lantern erupts: nearby foes are blinded, staggered and set alight.', cooldown: 11 },
    ultimate: { id: 'sunfall', name: 'Sunfall', desc: 'Call down a captive sun where you look. It crashes, burns everything, and leaves your mana boundless for 6 s.', charge: 110 },
    affinity: { weapons: ['staff', 'emberstaff', 'stormstaff'], name: 'Staff Arts', desc: 'Any staff unlocks two arts of its element on [Z] and [X]: fire, frost or storm.' },
    bars: { vigor: 1, endurance: 2, arcane: 5, speed: 3 },
  },
  duchess: {
    id: 'duchess',
    name: 'Duchess',
    tagline: 'She remembers every wound — and gives each one back.',
    weapon: 'rapier',
    offhand: 'parrydagger',
    color: '#c89ae0',
    stats: { maxHp: 90, maxStamina: 110, staminaRegen: 62, speed: 5.6, maxMana: 40, manaRegen: 4, parryWindow: 0.2, blockReduction: 0.72, blockStaminaMult: 1.1, lightRadius: 1 },
    passive: { name: 'Veiled Grace', desc: 'Sneak attacks and strikes from the shadows deal 40% more.' },
    skill: { id: 'restage', name: 'Restage', desc: 'Replay every blow you dealt in the last few seconds: each wound opens again on its victim.', cooldown: 8 },
    ultimate: { id: 'finale', name: 'Finale', desc: 'Vanish. Foes lose track of you for 7 s, and every strike from the veil lands like a riposte.', charge: 95 },
    affinity: { weapons: ['rapier', 'spear', 'daggers'], name: 'Encore', desc: 'Thrusting blades and daggers: Restage replays at 150% and marks its victims to bleed.' },
    bars: { vigor: 2, endurance: 4, arcane: 2, speed: 4 },
  },
  revenant: {
    id: 'revenant',
    name: 'Revenant',
    tagline: 'Her family never left. They only needed calling.',
    weapon: 'scythe',
    offhand: 'lantern',
    color: '#7ae0c8',
    stats: { maxHp: 80, maxStamina: 95, staminaRegen: 52, speed: 5.1, maxMana: 60, manaRegen: 5, parryWindow: 0.17, blockReduction: 0.6, blockStaminaMult: 1.25, lightRadius: 1.1 },
    passive: { name: 'Grave Tether', desc: 'Your phantoms mend you a little whenever they strike.' },
    skill: { id: 'summon', name: 'Call the Family', desc: 'Summon the next of your phantom family: Ser Aldric the shield, Wynne the witch, Grimtooth the hound.', cooldown: 9 },
    ultimate: { id: 'march', name: 'Immortal March', desc: 'The whole family answers at once, empowered — and every foe slain nearby in the last 20 s rises to fight for you.', charge: 110 },
    affinity: { weapons: ['scythe'], name: 'Harvest', desc: 'Scythes: kills may raise the fallen as spectral thralls, and feed your phantoms longer life.' },
    bars: { vigor: 2, endurance: 2, arcane: 4, speed: 3 },
  },
};

/** True when the player's class has a special bond with the weapon in hand. */
export function hasAffinity(player, weapon = player.weapon) {
  return !!weapon && player.classDef.affinity.weapons.includes(weapon.typeId);
}
