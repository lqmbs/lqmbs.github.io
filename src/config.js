export const CONFIG = {
  pixelSize: 3,
  ditherLevels: 20,
  fogDensity: 0.019,
  gateDistance: 24,
  inputBuffer: 0.25,
  camera: { fov: 72 },
  player: {
    maxHp: 100,
    maxStamina: 100,
    staminaRegen: 55,
    staminaDelay: 0.5,
    speed: 5.2,
    sprintSpeed: 8.2,
    sprintCost: 16,
    radius: 0.4,
    height: 1.8,
    eyeHeight: 1.62,
    jumpVelocity: 6.6, // apex ~1.28 m: clears a parapet rail
    jumpCost: 8,
    gravity: 17,
    hurtIframes: 0.45,
    mouseSensitivity: 0.0022,
    attack: { cost: 14, damage: 18, reach: 2.8, arc: 1.9, windup: 0.11, active: 0.12, recovery: 0.3 },
    guard: {
      parryWindow: 0.18,
      spamLockout: 0.4,
      blockReduction: 0.8,
      blockStaminaMult: 1.1,
      guardBreakStun: 0.9,
    },
    riposteMult: 2.6,
    lantern: { color: 0xffa24a, intensity: 9, distance: 15, decay: 1.5 },
  },
};

/**
 * Biomes. Each expedition floor draws one: palette, fog, what fills the abyss, how it's lit,
 * the local breed of dead, and whose arena waits at the end.
 */
export const BIOMES = {
  crystal: {
    id: 'crystal', name: 'The Sapphire Undercroft', abyss: 'void', lighting: 'dark', fogDensity: 0.019,
    fog: 0x15294c, sky: 0x5a7cc4, crystal: 0x4aa8ff, mist: 0x5a7ab0,
    stone: { floor: 0xa4a8b4, brick: 0x8e94a6, trim: 0x3e4250, rock: 0x8a8e9a },
    bone: 0xc9bfa6, eyes: 0xff2a10, prefix: '', signature: 'knight', elite: 'knight', boss: 'Gaoler of Bones',
  },
  sunken: {
    id: 'sunken', name: 'The Drowned Cathedral', abyss: 'water', lighting: 'dark', fogDensity: 0.024,
    fog: 0x1a2e2c, sky: 0x6a9a8c, crystal: 0x7af0b8, mist: 0x6a9a8c,
    stone: { floor: 0x8e9e92, brick: 0x7c8e84, trim: 0x34423c, rock: 0x6e7c72 },
    bone: 0x8e9c84, eyes: 0x9affc8, prefix: 'Drowned', signature: 'drowned', elite: 'drowned', boss: 'The Sunken Abbess',
  },
  ember: {
    id: 'ember', name: 'The Ember Fortress', abyss: 'lava', lighting: 'dark', fogDensity: 0.02,
    fog: 0x2a120c, sky: 0xa8522a, crystal: 0xff7a2a, mist: 0x8a3a1a,
    stone: { floor: 0x86766e, brick: 0x76625c, trim: 0x2c2220, rock: 0x5e4c46 },
    bone: 0x4a3a30, eyes: 0xffa020, prefix: 'Charred', signature: 'hound', elite: 'hound', boss: 'The Kiln Tyrant',
  },
  sunlit: {
    id: 'sunlit', name: 'The Sunlit Ruins', abyss: 'clouds', lighting: 'sun', fogDensity: 0.011,
    fog: 0x9aa8a8, sky: 0xc0ccc8, crystal: 0xf0d890, mist: 0xe8ecea,
    stone: { floor: 0xc6bca6, brick: 0xb8ae98, trim: 0x807866, rock: 0xa89e8a },
    bone: 0xece4d0, eyes: 0xff4a20, prefix: 'Bleached', signature: 'gargoyle', elite: 'gargoyle', boss: 'The Last Seneschal',
  },
};

/**
 * Architecture. Every floor of an expedition is raised in a different style, so the shapes of
 * the place change as well as its palette: arches, columns, balustrades, roofs, and which
 * chamber archetypes appear.
 */
export const ARCH_STYLES = {
  gothic: {
    id: 'gothic', name: 'Gothic', arch: 'pointed', pillar: 'gothic', parapet: 'balustrade', roof: 'spire', side: 'brick',
    tint: 0xffffff, layouts: ['nave', 'ring', 'terraces', 'causeway', 'grotto', 'spires'],
  },
  imperial: {
    id: 'imperial', name: 'Old Imperial', arch: 'round', pillar: 'drum', parapet: 'crenel', roof: 'dome', side: 'brick',
    tint: 0xfff0dc, layouts: ['cloister', 'basilica', 'terraces', 'causeway', 'ring', 'nave'],
  },
  cyclopean: {
    id: 'cyclopean', name: 'Titan-Hewn', arch: 'corbel', pillar: 'monolith', parapet: 'menhir', roof: 'ziggurat', side: 'rock',
    tint: 0xe4e6ea, layouts: ['henge', 'ziggurat', 'grotto', 'causeway', 'spires', 'terraces'],
  },
};

export const DIRS = {
  n: { dx: 0, dy: -1, x: 0, z: -1, opposite: 's' },
  s: { dx: 0, dy: 1, x: 0, z: 1, opposite: 'n' },
  e: { dx: 1, dy: 0, x: 1, z: 0, opposite: 'w' },
  w: { dx: -1, dy: 0, x: -1, z: 0, opposite: 'e' },
};

export const RoomState = Object.freeze({ DORMANT: 'dormant', SEALING: 'sealing', COMBAT: 'combat', CLEARED: 'cleared' });
