/**
 * Player options, persisted in localStorage. Every access is guarded: storage can be missing or
 * blocked (private windows, file://), and the game must still run on the defaults.
 */
const KEY = 'ashen-descent.settings';
const DEFAULTS = { sensitivity: 1, invertY: false, fov: 72, smoothing: true };

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) this.values[k] = saved[k];
    } catch { /* defaults */ }
    this.listeners = [];
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    this.values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(k, v);
  }

  onChange(fn) { this.listeners.push(fn); }

  /**
   * Build the options block (sensitivity, invert, field of view, smoothing) into a container.
   * Clicks inside never bubble up to the overlay behind it, which resumes the game on click.
   */
  mount(container) {
    container.replaceChildren();
    container.classList.add('settings');
    for (const ev of ['click', 'mousedown', 'pointerdown']) container.addEventListener(ev, (e) => e.stopPropagation());
    const row = (label, input, readout) => {
      const r = document.createElement('label');
      r.className = 'set-row';
      const l = document.createElement('span');
      l.className = 'set-label';
      l.textContent = label;
      r.append(l, input);
      if (readout) r.append(readout);
      container.append(r);
    };
    const slider = (k, min, max, step, fmt) => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = this.values[k];
      const out = document.createElement('span');
      out.className = 'set-value';
      out.textContent = fmt(this.values[k]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = fmt(v);
        this.set(k, v);
      });
      return [input, out];
    };
    const toggle = (k) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this.values[k];
      input.addEventListener('change', () => this.set(k, input.checked));
      return input;
    };
    row('Camera sensitivity', ...slider('sensitivity', 0.1, 3, 0.05, (v) => `${v.toFixed(2)}×`));
    row('Field of view', ...slider('fov', 60, 100, 1, (v) => `${v}°`));
    row('Invert look', toggle('invertY'));
    row('Mouse smoothing', toggle('smoothing'));
  }
}
