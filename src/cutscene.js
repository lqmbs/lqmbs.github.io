import * as THREE from 'three';
import { clamp, easeInOut } from './util.js';

const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A short scripted camera sequence: letterboxed shots that glide between framings, timed
 * events, an optional title card, and fades. Any key or click skips to the end.
 *
 * script = {
 *   duration,
 *   shots: [{ t0, t1, from: { pos, look }, to: { pos, look } | 'player' }],
 *   events: [{ t, fn(game) }] | [{ t, run(game, t), until }],
 *   caption: { at, title, sub, theme },
 *   fades: [{ t0, t1, from, to }],
 *   onSkip(), onEnd()
 * }
 */
export class Cutscene {
  constructor(game, script) {
    this.game = game;
    this.s = script;
    this.t = 0;
    this.done = false;
    this.fired = new Set();
    this.bars = document.getElementById('letterbox');
    this.cap = document.getElementById('cine-caption');
    this.bars.classList.add('on');
    game.hud.root.classList.add('cinematic');
    game.player.viewmodel.scene.visible = false;
  }

  /** The knight's eyes, as the camera will be when control returns. */
  playerView() {
    const p = this.game.player;
    const pos = p.eyePosition;
    return { pos, look: pos.clone().add(p.aim) };
  }

  update(dt) {
    if (this.done) return false;
    this.t += dt;
    const game = this.game, s = this.s, t = this.t;
    // Camera.
    const shot = s.shots.find((sh) => t >= sh.t0 && t < sh.t1) ?? s.shots[s.shots.length - 1];
    const to = shot.to === 'player' ? this.playerView() : shot.to;
    const k = easeInOut(clamp((t - shot.t0) / (shot.t1 - shot.t0), 0, 1));
    const pos = shot.from.pos.clone().lerp(to.pos, k);
    const look = shot.from.look.clone().lerp(to.look, k);
    game.camera.position.copy(pos);
    game.camera.quaternion.setFromRotationMatrix(_m.lookAt(pos, look, UP));
    // Events.
    (s.events || []).forEach((e, i) => {
      if (e.run) { if (t >= e.t && t <= (e.until ?? Infinity) + dt) e.run(game, t); return; }
      if (t >= e.t && !this.fired.has(i)) { this.fired.add(i); e.fn(game); }
    });
    // Fades.
    for (const f of s.fades || []) {
      if (t >= f.t0 && t <= f.t1 + dt) game.fade = f.from + (f.to - f.from) * clamp((t - f.t0) / (f.t1 - f.t0), 0, 1);
    }
    // Title card.
    const c = s.caption;
    if (c) {
      const show = t >= c.at && t < c.at + 2.8;
      if (show && !this.cap.classList.contains('on')) {
        this.cap.dataset.theme = c.theme ?? '';
        this.cap.querySelector('.cc-title').textContent = c.title;
        this.cap.querySelector('.cc-sub').textContent = c.sub ?? '';
      }
      this.cap.classList.toggle('on', show);
    }
    if (t >= s.duration) this.finish();
    return !this.done;
  }

  skip() {
    if (this.done || this.t < 0.25) return;
    const s = this.s;
    // Fire anything still pending so the world ends up where the script would leave it.
    (s.events || []).forEach((e, i) => {
      if (e.run) e.run(this.game, e.until ?? s.duration);
      else if (!this.fired.has(i)) { this.fired.add(i); e.fn(this.game); }
    });
    s.onSkip?.();
    this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.bars.classList.remove('on');
    this.cap.classList.remove('on');
    this.game.hud.root.classList.remove('cinematic');
    this.game.player.viewmodel.scene.visible = true;
    const last = this.s.fades?.[this.s.fades.length - 1];
    if (last) this.game.fade = last.to;
    this.s.onEnd?.();
  }
}
