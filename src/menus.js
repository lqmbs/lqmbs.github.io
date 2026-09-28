import { CLASSES } from './classes.js';
import { WEAPON_TYPES } from './weapons.js';
import { ENEMY_TYPES } from './enemies.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Modal menus opened from the Hold: class selection at the table and the summoning effigy. */
export class Menus {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('menu');
    window.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('hidden')) return;
      if (e.code === 'Escape') this.game.closeMenu();
      const n = Number(e.key);
      if (n >= 1 && n <= this.hotkeys.length) this.hotkeys[n - 1]();
    });
    this.hotkeys = [];
  }

  open(kind) {
    this.root.replaceChildren();
    this.hotkeys = [];
    if (kind === 'class') this.buildClassMenu();
    else this.buildSpawnMenu();
    this.root.classList.remove('hidden');
  }

  close() {
    this.root.classList.add('hidden');
    this.root.replaceChildren();
  }

  frame(title, subtitle) {
    const panel = el('div', 'menu-panel');
    panel.append(el('h2', 'menu-title', title), el('p', 'menu-sub', subtitle));
    this.root.append(panel);
    return panel;
  }

  footer(panel) {
    const leave = el('button', 'menu-leave', 'Leave  [Esc]');
    leave.addEventListener('click', () => this.game.closeMenu());
    panel.append(leave);
  }

  buildClassMenu() {
    const panel = this.frame('The Round Table', 'Rest a while, and choose who will descend.');
    const cards = el('div', 'class-cards');
    const current = this.game.player.classDef.id;
    Object.values(CLASSES).forEach((c, i) => {
      const card = el('button', `class-card${c.id === current ? ' current' : ''}`);
      card.style.setProperty('--accent', c.color);
      card.append(el('div', 'card-key', `${i + 1}`), el('h3', 'card-name', c.name), el('p', 'card-tag', c.tagline));
      const bars = el('div', 'card-bars');
      for (const [label, v] of Object.entries(c.bars)) {
        const row = el('div', 'card-bar');
        row.append(el('span', 'bar-label', label));
        const pips = el('span', 'pips');
        for (let p = 0; p < 5; p++) pips.append(el('i', p < v ? 'on' : ''));
        row.append(pips);
        bars.append(row);
      }
      card.append(bars);
      const kit = el('div', 'card-kit');
      const off = { shield: ' & Kite Shield', lantern: ' & Lantern', parrydagger: ' & Parrying Dagger' }[c.offhand] ?? '';
      kit.append(el('div', 'kit-row', `Armament — ${WEAPON_TYPES[c.weapon].name}${off}`));
      const passive = el('div', 'kit-row');
      passive.append(el('b', '', `${c.passive.name}. `), document.createTextNode(c.passive.desc));
      const skill = el('div', 'kit-row');
      skill.append(el('b', '', `[Q] ${c.skill.name}. `), document.createTextNode(c.skill.desc));
      const ult = el('div', 'kit-row');
      ult.append(el('b', '', `[R] ${c.ultimate.name}. `), document.createTextNode(c.ultimate.desc));
      const bond = el('div', 'kit-row kit-bond');
      bond.append(el('b', '', `Weapon bond — ${c.affinity.name}. `), document.createTextNode(c.affinity.desc));
      kit.append(passive, skill, ult, bond);
      card.append(kit);
      const choose = () => {
        this.game.chooseClass(c.id);
        this.game.closeMenu();
      };
      card.addEventListener('click', choose);
      this.hotkeys.push(choose);
      cards.append(card);
    });
    panel.append(cards);
    this.footer(panel);
  }

  buildSpawnMenu() {
    const panel = this.frame('Summoning Effigy', 'Ring the bell, and something answers.');
    const list = el('div', 'spawn-list');
    Object.entries(ENEMY_TYPES).forEach(([id, t], i) => {
      const row = el('div', 'spawn-row');
      row.append(el('span', 'spawn-key', `${i + 1}`), el('span', 'spawn-name', t.name));
      for (const n of [1, 3]) {
        if (id === 'warden' && n > 1) continue;
        const b = el('button', 'spawn-btn', `×${n}`);
        const spawn = () => {
          for (let k = 0; k < n; k++) this.game.hub.spawnEnemy(id);
          this.game.audio.play('bell');
          this.game.closeMenu();
        };
        b.addEventListener('click', spawn);
        if (n === 1) this.hotkeys.push(spawn);
        row.append(b);
      }
      list.append(row);
    });
    const banish = el('button', 'spawn-banish', 'Banish all summoned');
    banish.addEventListener('click', () => {
      this.game.hub.clearEnemies();
      this.game.closeMenu();
    });
    panel.append(list, banish);
    this.footer(panel);
  }
}
