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
    this.buffered = { attack: -Infinity, guard: -Infinity, jump: -Infinity };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.buffer('jump');
      }
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
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
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  requestLock() {
    const p = this.canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
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
