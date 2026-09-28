import { ITEMS } from './items.js';
import * as THREE from 'three';
import { clamp, damp, toRoman } from './util.js';
import { hex } from './weapons.js';

const _p = new THREE.Vector3();

export class HUD {
  constructor() {
    const $ = (s) => document.querySelector(s);
    this.root = $('#hud');
    this.hpBar = $('#hp-bar');
    this.hpFill = $('#hp-bar .fill');
    this.hpTrail = $('#hp-bar .trail');
    this.stBar = $('#st-bar');
    this.stFill = $('#st-bar .fill');
    this.floorNum = $('#floor-num');
    this.floorName = $('#floor-name');
    this.relics = $('#relics');
    this.bossEl = $('#boss');
    this.bossName = $('#boss .boss-name');
    this.bossFill = $('#boss .boss-bar .fill');
    this.bossTrail = $('#boss .boss-bar .trail');
    this.postureFill = $('#boss .posture-fill');
    this.bannerEl = $('#banner');
    this.bannerText = $('#banner .banner-text');
    this.itemBanner = $('#item-banner');
    this.crosshair = $('#crosshair');
    this.perilousEl = $('#perilous');
    this.minimap = $('#minimap');
    this.mctx = this.minimap.getContext('2d');
    this.trail = 1;
    this.trailDelay = 0;
    this.lastHp = 1;
    this.boss = null;
    this.bossTrailValue = 1;
    this.bannerTimer = 0;
    this.itemTimer = 0;
    this.perilousTimer = 0;
    this.mpBar = $('#mp-bar');
    this.mpFill = $('#mp-bar .fill');
    this.skillSlot = $('#skill-slot');
    this.skillCd = $('#skill-slot .cd');
    this.skillName = $('#skill-slot .slot-name');
    this.flaskSlot = $('#flask-slot');
    this.flaskCount = $('#flask-slot .count');
    this.weaponsEl = $('#weapons');
    this.promptEl = $('#prompt');
    this.toastEl = $('#toast');
    this.dmgLayer = $('#dmg-layer');
    this.inventoryEl = $('#inventory');
    this.numbers = [];
    this.toastTimer = 0;
    this.loadoutKey = '';
  }

  setMinimapVisible(v) { this.minimap.classList.toggle('hidden', !v); }
  flashMana() { this.pulse(this.mpBar, 'drained'); }
  flashSkill() { this.pulse(this.skillSlot, 'denied'); }

  /** Weapon slots, skill and mana bar — rebuilt when the loadout changes. */
  renderLoadout(player) {
    this.loadoutKey = this.keyOf(player);
    this.weaponsEl.replaceChildren();
    player.weapons.forEach((w, i) => {
      const slot = document.createElement('div');
      slot.className = `wslot${i === player.activeSlot ? ' active' : ''}${w ? '' : ' empty'}`;
      const key = document.createElement('span');
      key.className = 'wkey';
      key.textContent = i + 1;
      const name = document.createElement('span');
      name.className = 'wname';
      name.textContent = w ? w.displayName : '—';
      if (w) name.style.color = hex(w.rarity.color);
      slot.append(key, name);
      this.weaponsEl.appendChild(slot);
    });
    this.skillName.textContent = player.classDef.skill.name;
    this.mpBar.classList.toggle('hidden', !player.stats.maxMana);
    if (!this.inventoryEl.classList.contains('hidden')) this.renderInventory(player);
  }

  keyOf(p) { return `${p.classDef.id}|${p.activeSlot}|${p.weapons.map((w) => w?.uid ?? 0).join(',')}|${p.itemCounts.size}`; }
  renderLoadoutIfChanged(p) { if (this.keyOf(p) !== this.loadoutKey) this.renderLoadout(p); }

  setPrompt(it) {
    if (!it) {
      this.promptEl.classList.add('hidden');
      this.promptTarget = null;
      return;
    }
    if (this.promptTarget !== it || this.promptText !== it.prompt) {
      this.promptTarget = it;
      this.promptText = it.prompt;
      this.promptEl.querySelector('.ptext').textContent = it.prompt;
      this.promptEl.querySelector('.ptext').style.color = it.promptColor || '';
      this.promptEl.querySelector('.psub').textContent = it.sub || '';
    }
    this.promptEl.classList.remove('hidden');
  }

  toast(title, sub, color) {
    this.toastEl.querySelector('.ttitle').textContent = title;
    this.toastEl.querySelector('.ttitle').style.color = hex(color);
    this.toastEl.querySelector('.tsub').textContent = sub;
    this.pulse(this.toastEl, 'show');
    this.toastTimer = 2.4;
  }

  damageNumber(pos, amount, kind) {
    const div = document.createElement('div');
    div.className = `dmg ${kind}`;
    div.textContent = kind === 'blocked' ? 'Blocked' : Math.round(amount);
    this.dmgLayer.appendChild(div);
    this.numbers.push({ div, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), t: 0 });
    if (this.numbers.length > 24) this.numbers.shift().div.remove();
  }

  toggleInventory(player) {
    const open = this.inventoryEl.classList.toggle('hidden');
    if (!open) this.renderInventory(player);
  }

  renderInventory(player) {
    const S = player.stats;
    const inv = this.inventoryEl;
    inv.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = player.classDef.name;
    inv.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'inv-grid';
    player.weapons.forEach((w, i) => {
      const card = document.createElement('div');
      card.className = `inv-weapon${i === player.activeSlot ? ' active' : ''}`;
      if (!w) {
        card.classList.add('empty');
        card.textContent = `${i + 1} · empty`;
      } else {
        const title = document.createElement('div');
        title.className = 'inv-name';
        title.textContent = `${i + 1} · ${w.displayName}`;
        title.style.color = hex(w.rarity.color);
        const stats = document.createElement('div');
        stats.className = 'inv-stats';
        const rows = [['Damage', Math.round(w.damage)], ['Speed', `${Math.round(w.speed * 100)}%`], ['Reach', `${w.reach.toFixed(1)} m`], ['Posture', Math.round(w.posture)], ['Stamina', w.cost]];
        if (w.manaCost) rows.push(['Mana', w.manaCost]);
        for (const [k, v] of rows) {
          const a = document.createElement('span');
          a.textContent = k;
          const b = document.createElement('b');
          b.textContent = v;
          stats.append(a, b);
        }
        card.append(title, stats);
        if (w.affix) {
          const af = document.createElement('div');
          af.className = 'inv-affix';
          af.textContent = w.affix.desc;
          card.append(af);
        }
      }
      grid.appendChild(card);
    });
    inv.appendChild(grid);
    const foot = document.createElement('div');
    foot.className = 'inv-foot';
    foot.textContent = `Vigor ${Math.ceil(player.hp)}/${S.maxHp} · Endurance ${S.maxStamina}${S.maxMana ? ` · Mana ${S.maxMana}` : ''} · Flasks ${player.flasks}/${player.maxFlasks} · Parry ${Math.round(player.parryWindow * 1000)} ms   —   [1-3] switch · [G] drop · [Tab] close`;
    inv.appendChild(foot);
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setFloor(depth, name) {
    this.floorNum.textContent = depth ? toRoman(depth) : '⚜';
    this.floorName.textContent = name;
  }

  pulse(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  flashStamina() { this.pulse(this.stBar, 'drained'); }
  parryFlash() { this.pulse(this.crosshair, 'parried'); }

  perilous() {
    this.perilousTimer = 0.9;
    this.pulse(this.perilousEl, 'show');
  }

  banner(text, cls = '', duration = 2) {
    this.bannerText.textContent = text;
    this.bannerEl.className = `show ${cls}`;
    this.bannerTimer = duration;
  }

  showItem(item) {
    const hex = `#${item.color.toString(16).padStart(6, '0')}`;
    const name = this.itemBanner.querySelector('.item-name');
    name.textContent = item.name;
    name.style.color = hex;
    this.itemBanner.querySelector('.item-desc').textContent = item.desc;
    this.itemBanner.querySelector('.item-lore').textContent = item.lore;
    this.itemBanner.classList.add('show');
    this.itemTimer = 3.4;
  }

  renderRelics(player) {
    this.relics.replaceChildren();
    for (const [id, count] of player.itemCounts) {
      const item = ITEMS.find((i) => i.id === id);
      if (item.consumable) continue;
      const row = document.createElement('div');
      row.className = 'relic';
      const name = document.createElement('span');
      name.textContent = item.name;
      row.appendChild(name);
      if (count > 1) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = `×${count}`;
        row.appendChild(c);
      }
      const gem = document.createElement('span');
      gem.className = 'gem';
      gem.style.color = `#${item.color.toString(16).padStart(6, '0')}`;
      row.appendChild(gem);
      this.relics.appendChild(row);
    }
  }

  showBoss(enemy) {
    this.boss = enemy;
    this.bossTrailValue = 1;
    this.bossName.textContent = enemy.name;
    this.bossEl.classList.remove('hidden');
  }

  hideBoss() {
    this.boss = null;
    this.bossEl.classList.add('hidden');
  }

  update(dt, player, camera) {
    if (player.stats.maxMana) this.mpFill.style.transform = `scaleX(${clamp(player.mana / player.stats.maxMana, 0, 1)})`;
    const cdMax = player.classDef.skill.cooldown;
    const cd = clamp(player.skillCd / cdMax, 0, 1);
    this.skillCd.style.background = cd > 0 ? `conic-gradient(rgba(0,0,0,0.72) ${cd * 360}deg, transparent 0)` : 'transparent';
    this.skillSlot.classList.toggle('ready', cd === 0);
    this.flaskCount.textContent = player.flasks;
    this.flaskSlot.classList.toggle('empty', player.flasks === 0);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      _p.copy(n.pos);
      _p.y += n.t * 0.9;
      _p.project(camera);
      if (n.t > 0.9 || _p.z > 1) {
        n.div.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      n.div.style.transform = `translate(${(_p.x * 0.5 + 0.5) * w}px, ${(-_p.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      n.div.style.opacity = String(1 - Math.max(0, n.t - 0.5) / 0.4);
    }
    const S = player.stats;
    this.hpBar.style.width = `${S.maxHp * 2.6}px`;
    this.stBar.style.width = `${S.maxStamina * 2.2}px`;
    const hp = clamp(player.hp / S.maxHp, 0, 1);
    if (hp < this.lastHp) this.trailDelay = 0.6;
    this.lastHp = hp;
    this.trailDelay -= dt;
    if (this.trailDelay <= 0) this.trail = damp(this.trail, hp, 5, dt);
    if (this.trail < hp) this.trail = hp;
    this.hpFill.style.transform = `scaleX(${hp})`;
    this.hpTrail.style.transform = `scaleX(${this.trail})`;
    this.stFill.style.transform = `scaleX(${clamp(player.stamina / S.maxStamina, 0, 1)})`;
    this.crosshair.classList.toggle('guard', player.state === 'guard');

    if (this.boss) {
      const b = clamp(this.boss.hp / this.boss.maxHp, 0, 1);
      this.bossTrailValue = damp(this.bossTrailValue, b, 3, dt);
      this.bossFill.style.transform = `scaleX(${b})`;
      this.bossTrail.style.transform = `scaleX(${Math.max(b, this.bossTrailValue)})`;
      const posture = this.boss.state === 'broken' ? 1 : clamp(this.boss.posture / this.boss.postureMax, 0, 1);
      this.postureFill.style.transform = `scaleX(${posture})`;
      this.postureFill.classList.toggle('broken', this.boss.state === 'broken');
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
    if (this.itemTimer > 0) {
      this.itemTimer -= dt;
      if (this.itemTimer <= 0) this.itemBanner.classList.remove('show');
    }
    if (this.perilousTimer > 0) {
      this.perilousTimer -= dt;
      if (this.perilousTimer <= 0) this.perilousEl.classList.remove('show');
    }
  }

  drawMinimap(floor, current) {
    const ctx = this.mctx;
    const W = this.minimap.width, H = this.minimap.height;
    const cw = 22, ch = 14, gap = 4;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    for (const room of floor.rooms.values()) {
      if (!room.seen) continue;
      const x = Math.round(W / 2 + (room.gx - current.gx) * (cw + gap) - cw / 2);
      const y = Math.round(H / 2 + (room.gy - current.gy) * (ch + gap) - ch / 2);
      if (x < -cw || y < -ch || x > W || y > H) continue;
      ctx.fillStyle = room === current ? '#d8cfb8' : room.visited ? '#4f5566' : '#1c1f28';
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = room.visited ? '#7d8599' : '#3a3f4c';
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      const icon = room.type === 'boss' ? '#c42a1f' : room.type === 'treasure' ? '#c9a45c' : null;
      if (icon) {
        ctx.fillStyle = icon;
        ctx.fillRect(x + cw / 2 - 3, y + ch / 2 - 3, 6, 6);
      }
    }
  }
}
