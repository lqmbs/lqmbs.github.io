import * as THREE from 'three';
import { rand, randInt, pick } from './util.js';

/** Small, chunky, nearest-filtered procedural textures — no image assets needed. */
function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function finish(c, { srgb = true, nearest = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = nearest ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, size, count, alpha) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand(0.02, alpha)})`;
    ctx.fillRect(randInt(0, size), randInt(0, size), randInt(1, 2), randInt(1, 2));
  }
}

export function flagstones() {
  const size = 128;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, size, size);
  const palette = ['#4b4f58', '#42454d', '#555862', '#3e4149', '#4a4c52'];
  const rows = 4, rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -rh * 0.5 : 0;
    while (x < size) {
      const w = rh * rand(0.8, 1.4);
      ctx.fillStyle = pick(palette);
      ctx.fillRect(Math.round(x) + 1, r * rh + 1, Math.round(w) - 2, rh - 2);
      if (x + w > size) ctx.fillRect(Math.round(x - size) + 1, r * rh + 1, Math.round(w) - 2, rh - 2);
      // Worn highlight on the top edge of each stone.
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(Math.round(x) + 1, r * rh + 1, Math.round(w) - 2, 2);
      x += w;
    }
  }
  speckle(ctx, size, 2400, 0.16);
  ctx.strokeStyle = 'rgba(8,8,12,0.6)';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    let px = rand(0, size), py = rand(0, size);
    ctx.moveTo(px, py);
    for (let s = 0; s < 4; s++) {
      px += rand(-10, 10); py += rand(-10, 10);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Moss creeping in the joints.
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(40,70,60,${rand(0.1, 0.3)})`;
    ctx.fillRect(randInt(0, size), randInt(0, rows) * rh - 1, randInt(1, 4), 2);
  }
  return finish(c);
}

export function bricks() {
  const size = 64;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, size, size);
  const palette = ['#565a64', '#4b4f58', '#5e616b', '#44474f', '#51545c'];
  const bh = 8, bw = 16;
  for (let r = 0; r < size / bh; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let x = -bw; x < size + bw; x += bw) {
      ctx.fillStyle = pick(palette);
      ctx.fillRect(x + off + 1, r * bh + 1, bw - 1, bh - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + off + 1, r * bh + 1, bw - 1, 1);
    }
  }
  speckle(ctx, size, 700, 0.18);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(10,20,24,0.3)';
    ctx.fillRect(randInt(0, size), 0, 1, randInt(10, size));
  }
  return finish(c);
}

export function rock() {
  const size = 64;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#2a2d34';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = pick(['#33363e', '#24272d', '#3a3d45', '#202328']);
    ctx.fillRect(randInt(0, size), randInt(0, size), randInt(3, 12), randInt(2, 6));
  }
  speckle(ctx, size, 900, 0.2);
  return finish(c);
}

/** Soft, noisy white blob used for drifting mist layers. */
export function mist() {
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const x = rand(0, size), y = rand(0, size), r = rand(20, 70);
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(255,255,255,${rand(0.05, 0.14)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  return finish(c, { srgb: false, nearest: false });
}

/** Diamond glyph shown over a staggered enemy — the riposte opening. */
export function riposteGlyph() {
  const size = 32;
  const [c, ctx] = canvas(size);
  ctx.translate(16, 16);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(255,60,40,0.25)';
  ctx.fillRect(-11, -11, 22, 22);
  ctx.fillStyle = '#ff3a24';
  ctx.fillRect(-6, -6, 12, 12);
  ctx.fillStyle = '#ffd0a0';
  ctx.fillRect(-2, -2, 4, 4);
  return finish(c, { srgb: true, nearest: true });
}
