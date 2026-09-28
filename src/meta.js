import { rollItem } from './items.js';

/**
 * What survives between expeditions. Every run, won or lost, leaves ashes; at the Ashen Shrine
 * in the Hold they buy lasting boons. Oaths sworn at the shrine make the next descent harder and
 * its ashes richer. Persisted in localStorage, and every access is guarded like the settings.
 */

const KEY = 'ashen-descent.profile';

/** Lasting boons: each level applies to every fresh loadout (some only on an expedition). */
export const UPGRADES = [
  { id: 'vigor', name: 'Tempered Vigor', desc: '+10 maximum health', cost: [30, 60, 110], apply: (p, n) => { p.stats.maxHp += 10 * n; } },
  { id: 'lungs', name: 'Iron Lungs', desc: '+10 maximum stamina', cost: [30, 70], apply: (p, n) => { p.stats.maxStamina += 10 * n; } },
  { id: 'flask', name: 'Deeper Flask', desc: '+1 Crimson Flask', cost: [50, 130], apply: (p, n) => { p.maxFlasks += n; } },
  { id: 'guard', name: 'Quickened Guard', desc: 'Parry window +15 ms', cost: [45, 100], apply: (p, n) => { p.stats.parryWindow += 0.015 * n; } },
  { id: 'purse', name: "Pilgrim's Purse", desc: 'Begin each expedition with 15 coin', cost: [25, 60], run: true, apply: (p, n) => { p.coins += 15 * n; } },
  { id: 'keyring', name: "Gaoler's Keyring", desc: 'Begin each expedition with an iron key', cost: [40], run: true, apply: (p, n) => { p.keys += n; } },
  { id: 'boon', name: 'Ashen Boon', desc: 'Begin each expedition with a random relic', cost: [160], run: true, apply: (p, n, game) => { for (let i = 0; i < n; i++) game.onItemPickup(rollItem(p)); } },
];

/** Oaths: sworn before a descent, kept for all of it. Harder runs, more ashes. */
export const OATHS = [
  { id: 'frailty', name: 'Oath of Frailty', desc: 'Your maximum health is cut by 30%', bonus: 0.4 },
  { id: 'wrath', name: 'Oath of Wrath', desc: 'Foes strike 25% harder', bonus: 0.35 },
  { id: 'hunt', name: 'Oath of the Hunt', desc: 'Foes move 20% faster', bonus: 0.3 },
  { id: 'thirst', name: 'Oath of Thirst', desc: 'Your flasks no longer refill between floors', bonus: 0.3 },
];

const DEFAULTS = { ashes: 0, upgrades: {}, oaths: [], runs: 0, wins: 0, bestDepth: 0, felled: 0 };

export class Profile {
  constructor() {
    this.data = structuredClone(DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) this.data[k] = saved[k];
      if (!Array.isArray(this.data.oaths)) this.data.oaths = [];
    } catch { /* defaults */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  get ashes() { return this.data.ashes; }
  level(id) { return this.data.upgrades[id] || 0; }

  /** The price of the next level, or null at the top. */
  nextCost(u) { return u.cost[this.level(u.id)] ?? null; }

  buy(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const cost = u && this.nextCost(u);
    if (cost === null || cost === undefined || this.data.ashes < cost) return false;
    this.data.ashes -= cost;
    this.data.upgrades[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  sworn(id) { return this.data.oaths.includes(id); }

  toggleOath(id) {
    const o = this.data.oaths;
    const i = o.indexOf(id);
    if (i >= 0) o.splice(i, 1);
    else o.push(id);
    this.save();
  }

  get multiplier() {
    return 1 + OATHS.filter((o) => this.sworn(o.id)).reduce((a, o) => a + o.bonus, 0);
  }

  /** Apply boons to a fresh loadout; on an expedition, also the run-only ones. */
  applyUpgrades(player, game, expedition) {
    for (const u of UPGRADES) {
      const n = this.level(u.id);
      if (!n || (u.run && !expedition)) continue;
      u.apply(player, n, game);
    }
    player.hp = player.stats.maxHp;
    player.stamina = player.stats.maxStamina;
    player.flasks = player.maxFlasks;
  }

  /** The end of an expedition: count the ashes it leaves. */
  settle(run, won) {
    const base = run.floors * 12 + run.bosses * 30 + run.elites * 8 + run.kills + (won ? 60 : 0);
    const earned = Math.round(base * run.multiplier);
    const d = this.data;
    d.ashes += earned;
    d.runs++;
    if (won) d.wins++;
    d.bestDepth = Math.max(d.bestDepth, run.depth);
    d.felled += run.bosses;
    this.save();
    return earned;
  }
}
