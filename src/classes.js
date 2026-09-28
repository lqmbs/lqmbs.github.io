/**
 * Playable classes. Each defines base stats, a starting weapon, an off-hand, a passive, an
 * active skill (Q) on a cooldown, and an ultimate (R) charged by fighting well: damage dealt,
 * parries and kills all feed it.
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
    bars: { vigor: 1, endurance: 2, arcane: 5, speed: 3 },
  },
};
