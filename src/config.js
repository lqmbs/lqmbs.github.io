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
    jumpVelocity: 5.4,
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

export const FLOOR_THEMES = [
  { name: 'The Sapphire Undercroft', fog: 0x15294c, sky: 0x5a7cc4, crystal: 0x4aa8ff, boss: 'Gaoler of Bones' },
  { name: 'Halls of the Hollowed', fog: 0x1a1c38, sky: 0x6670b4, crystal: 0x7a8cff, boss: 'The Hollow Warden' },
  { name: 'The Weeping Geode', fog: 0x0e2830, sky: 0x4a90a0, crystal: 0x46e0d0, boss: 'Ossified Sentinel' },
  { name: 'Cathedral of Ash', fog: 0x2a1a1e, sky: 0x8a6070, crystal: 0xff8a5a, boss: 'Ashen Castellan' },
  { name: 'The Abyssal Choir', fog: 0x16102e, sky: 0x5a48a8, crystal: 0xa070ff, boss: 'Keeper of the Last Door' },
];

export const DIRS = {
  n: { dx: 0, dy: -1, x: 0, z: -1, opposite: 's' },
  s: { dx: 0, dy: 1, x: 0, z: 1, opposite: 'n' },
  e: { dx: 1, dy: 0, x: 1, z: 0, opposite: 'w' },
  w: { dx: -1, dy: 0, x: -1, z: 0, opposite: 'e' },
};

export const RoomState = Object.freeze({ DORMANT: 'dormant', SEALING: 'sealing', COMBAT: 'combat', CLEARED: 'cleared' });
