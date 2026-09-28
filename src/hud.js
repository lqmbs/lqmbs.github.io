import { ITEMS } from './items.js';
import { clamp, damp, toRoman } from './util.js';

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
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setFloor(depth, name) {
    this.floorNum.textContent = toRoman(depth);
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

  update(dt, player) {
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
