import { ITEMS } from './items.js';
import * as THREE from 'three';
import { CELL } from './chamber.js';
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
    this.ultSlot = $('#ult-slot');
    this.ultFill = $('#ult-slot .ult-fill');
    this.ultName = $('#ult-slot .slot-name');
    this.coinsEl = $('#wallet .coins');
    this.keysEl = $('#wallet .keys');
    this.walletEl = $('#wallet');
    this.hpCost = $('#hp-bar .cost');
    this.hpCostLabel = $('#hp-cost-label');
    this.veilEl = $('#veil');
    this.streakEl = $('#streak');
    this.artsEl = $('#arts');
    this.artSlots = [$('#art-z'), $('#art-x')];
    this.artKey = '';
  }

  /** Flashing preview of the maximum vigor a devil's pact would take. */
  setHpCost(cost) {
    this.hpCostValue = cost;
    const on = cost != null;
    this.hpCost.classList.toggle('hidden', !on);
    this.hpCostLabel.classList.toggle('hidden', !on);
    if (on) this.hpCostLabel.textContent = `−${cost} max vigor`;
  }

  setVeil(on) { this.veilEl.classList.toggle('on', on); }

  streak(n) {
    this.streakEl.classList.toggle('hidden', n <= 0);
    if (n > 0) {
      this.streakEl.querySelector('.sk-count').textContent = `×${n}`;
      this.pulse(this.streakEl, 'bump');
    }
  }

  flashArt(slot) { this.pulse(this.artSlots[slot], 'denied'); }

  flashUlt() { this.pulse(this.ultSlot, 'denied'); }
  ultReady() { this.pulse(this.ultSlot, 'burst'); }
  bumpWallet(kind) { this.pulse(kind === 'key' ? this.keysEl : this.coinsEl, 'bump'); }

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
    this.ultName.textContent = player.classDef.ultimate.name;
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
    foot.textContent = `Vigor ${Math.ceil(player.hp)}/${S.maxHp} · Endurance ${S.maxStamina}${S.maxMana ? ` · Mana ${S.maxMana}` : ''} · Flasks ${player.flasks}/${player.maxFlasks} · Coin ${player.coins} · Keys ${player.keys} · Parry ${Math.round(player.parryWindow * 1000)} ms   —   [1-3] switch · [G] drop · [Tab] close`;
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
    if (this.hpCostValue != null) this.hpCost.style.width = `${clamp(this.hpCostValue / player.stats.maxHp, 0, 1) * 100}%`;
    // Staff Arts (Lantern Mage holding a staff): two element-coloured slots on Z and X.
    const arts = player.arts.arts;
    const key = arts ? arts.map((a) => a.id).join() : '';
    if (key !== this.artKey) {
      this.artKey = key;
      this.artsEl.classList.toggle('hidden', !arts);
      if (arts) {
        const color = { fire: '#ff7a30', frost: '#9ad8ff', storm: '#e0f0ff' }[player.weapon.element];
        arts.forEach((a, i) => {
          this.artSlots[i].querySelector('.slot-name').textContent = a.name;
          this.artSlots[i].style.setProperty('--art', color);
        });
      }
    }
    if (arts) {
      arts.forEach((a, i) => {
        const cd = clamp(player.arts.cd[i] / a.cooldown, 0, 1);
        this.artSlots[i].querySelector('.cd').style.background = cd > 0 ? `conic-gradient(rgba(0,0,0,0.72) ${cd * 360}deg, transparent 0)` : 'transparent';
        this.artSlots[i].classList.toggle('ready', cd === 0 && player.mana >= a.mana);
      });
    }
    if (player.streakTimer > 0) this.streakEl.querySelector('.sk-bar').style.transform = `scaleX(${player.streakTimer / 4})`;
    const u = clamp(player.ultCharge / player.ultMax, 0, 1);
    this.ultFill.style.transform = `scaleY(${u})`;
    this.ultSlot.classList.toggle('ready', u >= 1);
    this.coinsEl.textContent = player.coins;
    this.keysEl.textContent = player.keys;
    this.walletEl.classList.toggle('hidden', this.minimap.classList.contains('hidden') && !player.coins && !player.keys);
    const cdMax = player.classDef.skill.cooldown * player.stats.skillCdMult;
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

  /**
   * The floor map, true to scale: every chamber is a square cell (as they are in the world),
   * passages are drawn between gates, and the knight is an arrow at their real position and
   * heading. Special rooms carry icons.
   */
  drawMinimap(floor, current, player) {
    const ctx = this.mctx;
    const W = this.minimap.width, H = this.minimap.height;
    const cell = 30, room = 20;
    const scale = cell / CELL;
    const px = player ? player.pos.x : current.ox, pz = player ? player.pos.z : current.oz;
    // The map scrolls with the knight.
    const sx = (x) => W / 2 + (x - px) * scale;
    const sy = (z) => H / 2 + (z - pz) * scale;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(4,4,8,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 3;
    // Passages first, under the rooms.
    for (const r of floor.rooms.values()) {
      if (!r.seen) continue;
      for (const dir of ['e', 's']) {
        const n = r.neighbors[dir];
        if (!n || !n.seen) continue;
        ctx.strokeStyle = r.visited || n.visited ? '#6a6f80' : '#2e323c';
        ctx.beginPath();
        ctx.moveTo(sx(r.ox), sy(r.oz));
        ctx.lineTo(sx(n.ox), sy(n.oz));
        ctx.stroke();
      }
    }
    const fills = { boss: '#3a0c0a', treasure: '#3a2c0c', shop: '#2a1a40', elite: '#3a220c' };
    const strokes = { boss: '#c42a1f', treasure: '#e0b050', shop: '#b080ff', elite: '#e08a30' };
    for (const r of floor.rooms.values()) {
      if (!r.seen) continue;
      const x = Math.round(sx(r.ox) - room / 2), y = Math.round(sy(r.oz) - room / 2);
      if (x < -room || y < -room || x > W || y > H) continue;
      const special = fills[r.type];
      ctx.fillStyle = r === current ? '#5a5a52' : special ? special : r.visited ? '#3a3e4a' : '#15171e';
      ctx.fillRect(x, y, room, room);
      ctx.lineWidth = 1;
      ctx.strokeStyle = strokes[r.type] ?? (r.visited ? '#7d8599' : '#3a3f4c');
      ctx.strokeRect(x + 0.5, y + 0.5, room - 1, room - 1);
      if (r.type === 'boss' || r.type === 'elite') ctx.strokeRect(x + 2.5, y + 2.5, room - 5, room - 5);
      this.drawIcon(ctx, r, x + room / 2, y + room / 2);
      if (r.state === 'combat') {
        ctx.fillStyle = '#c42a1f';
        ctx.fillRect(x + room - 5, y + 2, 3, 3);
      }
    }
    if (player) {
      // The knight: an arrow pointing the way they face.
      const a = player.yaw;
      const fx = -Math.sin(a), fz = -Math.cos(a);
      const cx = W / 2, cy = H / 2;
      ctx.fillStyle = '#f0e6c8';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + fx * 6, cy + fz * 6);
      ctx.lineTo(cx - fx * 4 + fz * 3.5, cy - fz * 4 - fx * 3.5);
      ctx.lineTo(cx - fx * 2, cy - fz * 2);
      ctx.lineTo(cx - fx * 4 - fz * 3.5, cy - fz * 4 + fx * 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawIcon(ctx, r, cx, cy) {
    switch (r.type) {
      case 'boss':
        // A skull.
        ctx.fillStyle = '#e0d8c8';
        ctx.fillRect(cx - 4, cy - 4, 8, 6);
        ctx.fillRect(cx - 3, cy + 2, 6, 2);
        ctx.fillStyle = '#3a0c0a';
        ctx.fillRect(cx - 3, cy - 2, 2, 2);
        ctx.fillRect(cx + 1, cy - 2, 2, 2);
        break;
      case 'treasure':
        // A crown.
        ctx.fillStyle = '#f0c040';
        ctx.fillRect(cx - 5, cy, 10, 3);
        ctx.fillRect(cx - 5, cy - 4, 2, 4);
        ctx.fillRect(cx - 1, cy - 5, 2, 5);
        ctx.fillRect(cx + 3, cy - 4, 2, 4);
        break;
      case 'shop':
        // A coin.
        ctx.fillStyle = '#f0c040';
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2a1a40';
        ctx.fillRect(cx - 0.5, cy - 3, 1.5, 6);
        break;
      case 'elite':
        ctx.fillStyle = '#e08a30';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + 4, cy);
        ctx.lineTo(cx, cy + 5);
        ctx.lineTo(cx - 4, cy);
        ctx.fill();
        break;
      case 'start':
        ctx.fillStyle = '#ffb060';
        ctx.fillRect(cx - 1, cy - 1, 3, 3);
        break;
    }
    if (r.portal && !r.portal.used) {
      // A rift: a small ring in its colour.
      ctx.strokeStyle = r.portal.kind === 'devil' ? '#ff3010' : '#fff0c0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + 6, cy - 6, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
