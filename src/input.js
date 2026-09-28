import { CONFIG } from './config.js';

/**
 * Keyboard + pointer-locked mouse. Attack and guard presses are buffered briefly so a press made
 * during an animation lock fires the moment the lock ends.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.lmb = false;
    this.rmb = false;
    this.buffered = { attack: -Infinity, guard: -Infinity, jump: -Infinity, next: -Infinity, prev: -Infinity };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.buffer('jump');
      }
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });
    // Browsers occasionally report a wild pointer-lock delta (on lock, on focus changes, or a
    // known Chromium bug where one event jumps by hundreds of pixels). Such spikes spun the
    // camera; they are dropped when far outside the recent motion.
    this.recentMove = 0;
    this.lockedAt = 0;
    document.addEventListener('pointerlockchange', () => {
      this.lockedAt = performance.now();
      this.recentMove = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = e.movementX, dy = e.movementY;
      const mag = Math.hypot(dx, dy);
      if (performance.now() - this.lockedAt < 120) return;
      if (mag > 180 && mag > this.recentMove * 6 + 60) return;
      this.recentMove = this.recentMove * 0.8 + mag * 0.2;
      this.lookX += dx;
      this.lookY += dy;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.lmb = true; this.buffer('attack'); }
      if (e.button === 2) { this.rmb = true; this.buffer('guard'); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.locked && Math.abs(e.deltaY) > 1) this.buffer(e.deltaY > 0 ? 'next' : 'prev');
    }, { passive: true });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  /** Raw (unaccelerated) motion where supported — it is also free of the OS jump bugs. */
  requestLock() {
    let p;
    try { p = this.canvas.requestPointerLock?.({ unadjustedMovement: true }); } catch { p = null; }
    if (p && p.catch) {
      p.catch(() => {
        const q = this.canvas.requestPointerLock?.();
        if (q && q.catch) q.catch(() => {});
      });
    }
  }

  now() { return performance.now() / 1000; }
  buffer(action) { this.buffered[action] = this.now(); }
  peek(action) { return this.now() - this.buffered[action] <= CONFIG.inputBuffer; }
  consume(action) {
    if (!this.peek(action)) return false;
    this.buffered[action] = -Infinity;
    return true;
  }
  clearBuffers() {
    for (const k in this.buffered) this.buffered[k] = -Infinity;
    this.lookX = this.lookY = 0;
  }

  takeLook() {
    const out = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return out;
  }

  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }

  /** Returns [strafe, forward] in -1..1, normalised. */
  moveAxes() {
    const x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const f = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, f) || 1;
    return [x / len, f / len];
  }
}
