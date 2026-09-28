import { rand, randInt } from './util.js';

const randInt3 = () => randInt(1, 3);

/** Every sound is synthesised with WebAudio — no audio assets. */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.nextAmbient = 4;
    this.mode = 'depths';
  }

  /** 'hub' (wind, surf, gulls, a whisper of drone) or 'depths' (the full cavern drone). */
  setMode(mode) {
    this.mode = mode;
    if (this.droneGain) this.droneGain.gain.setTargetAtTime(mode === 'hub' ? 0.012 : 0.065, this.ctx.currentTime, 1.5);
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    // A long, dark cavern reverb.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(4.5, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);

    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.reverb);

    const len = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startDrone();
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  startDrone() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    filter.Q.value = 3;
    const gain = (this.droneGain = ctx.createGain());
    gain.gain.value = this.mode === 'hub' ? 0.012 : 0.065;
    filter.connect(gain);
    gain.connect(this.master);
    gain.connect(this.reverb);
    for (const [f, type] of [[49, 'sawtooth'], [49.4, 'sawtooth'], [32.7, 'sine'], [73.4, 'triangle']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(filter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
  }

  envelope(g, t0, attack, dur, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
  }

  noise({ t = 0, dur = 0.2, type = 'bandpass', f = 1000, f2 = null, q = 1, gain = 0.3, attack = 0.004, dest = this.bus }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f, t0);
    if (f2) filter.frequency.exponentialRampToValueAtTime(f2, t0 + attack + dur);
    const g = ctx.createGain();
    this.envelope(g, t0, attack, dur, gain);
    src.connect(filter).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + attack + dur + 0.05);
  }

  tone({ t = 0, dur = 0.3, type = 'sine', f = 440, f2 = null, gain = 0.2, attack = 0.005, dest = this.bus }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + attack + dur);
    const g = ctx.createGain();
    this.envelope(g, t0, attack, dur, gain);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + attack + dur + 0.05);
  }

  /** Inharmonic partials = struck metal. */
  metal(base, dur, gain, t = 0) {
    for (const [ratio, g] of [[1, 1], [1.53, 0.6], [2.21, 0.45], [3.14, 0.3], [4.37, 0.2]]) {
      this.tone({ t, dur: dur * (1.1 - ratio * 0.12), type: 'sine', f: base * ratio, gain: gain * g, attack: 0.002 });
    }
  }

  play(name, arg = 0) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'charge':
        this.noise({ dur: 0.75, type: 'bandpass', f: 300, f2: 1400, q: 3, gain: 0.12, attack: 0.3 });
        this.tone({ dur: 0.75, type: 'sawtooth', f: 55, f2: 82, gain: 0.06, attack: 0.3 });
        break;
      case 'charge-full':
        this.metal(1480, 0.7, 0.07);
        this.tone({ dur: 0.4, type: 'triangle', f: 880, f2: 1320, gain: 0.05, attack: 0.01 });
        break;
      case 'execute-draw':
        this.noise({ dur: 0.3, f: 900, f2: 3200, q: 2, gain: 0.18, attack: 0.05 });
        this.tone({ dur: 0.9, type: 'sawtooth', f: 41, gain: 0.15, attack: 0.05 });
        break;
      case 'execute':
        // Steel through meat: a wet thump, a crunch, a long low ring.
        this.tone({ dur: 0.6, f: 90, f2: 30, gain: 1.0 });
        this.noise({ dur: 0.18, type: 'lowpass', f: 900, f2: 200, gain: 0.9 });
        for (let i = 0; i < 4; i++) this.noise({ t: 0.02 + i * 0.025, dur: 0.04, type: 'bandpass', f: rand(600, 1400), q: 4, gain: 0.35 });
        this.metal(310, 1.6, 0.08, 0.03);
        this.tone({ t: 0.05, dur: 1.4, type: 'sine', f: 58, gain: 0.35, attack: 0.02 });
        break;
      case 'execute-rip':
        this.noise({ dur: 0.35, type: 'bandpass', f: 500, f2: 1800, q: 2.5, gain: 0.5 });
        this.noise({ t: 0.05, dur: 0.3, type: 'lowpass', f: 700, f2: 150, gain: 0.5 });
        break;
      case 'perfect-dodge':
        this.tone({ dur: 0.9, type: 'sine', f: 1760, f2: 440, gain: 0.08, attack: 0.01 });
        this.noise({ dur: 0.5, type: 'highpass', f: 3000, f2: 800, gain: 0.15 });
        this.tone({ dur: 1.2, type: 'sine', f: 110, f2: 55, gain: 0.3 });
        break;
      case 'parry-chain': {
        // Each deflection in a chain rings a step higher.
        const f = 523.3 * Math.pow(2, Math.min(arg, 7) * 2 / 12);
        this.tone({ dur: 1.4, type: 'sine', f, gain: 0.08 });
        this.tone({ dur: 1.2, type: 'triangle', f: f * 1.5, gain: 0.04 });
        break;
      }
      case 'slide':
        this.noise({ dur: 0.7, type: 'lowpass', f: 1400, f2: 300, gain: 0.35, attack: 0.02 });
        this.noise({ dur: 0.5, type: 'bandpass', f: 3000, q: 1.5, gain: 0.06 });
        break;
      case 'mantle':
        this.noise({ dur: 0.12, type: 'lowpass', f: 700, gain: 0.4 });
        this.noise({ t: 0.08, dur: 0.25, type: 'bandpass', f: 1200, f2: 600, q: 1.5, gain: 0.15 });
        break;
      case 'plunge':
        this.tone({ dur: 0.9, f: 60, f2: 24, gain: 1.0 });
        this.noise({ dur: 0.7, type: 'lowpass', f: 500, f2: 60, gain: 0.9 });
        this.metal(200, 1.0, 0.1, 0.01);
        for (let i = 0; i < 6; i++) this.noise({ t: 0.05 + i * 0.05, dur: 0.06, type: 'bandpass', f: rand(300, 900), q: 3, gain: 0.2 });
        break;
      case 'swing':
        this.noise({ dur: 0.16, f: 2400, f2: 500, q: 1.4, gain: 0.32 });
        break;
      case 'hit':
        this.tone({ dur: 0.16, f: 150, f2: 45, gain: 0.7 });
        this.noise({ dur: 0.08, type: 'lowpass', f: 1800, gain: 0.45 });
        this.noise({ t: 0.01, dur: 0.05, type: 'highpass', f: 3000, gain: 0.12 });
        break;
      case 'parry':
        this.metal(rand(1150, 1300), 1.4, 0.2);
        this.noise({ dur: 0.06, type: 'highpass', f: 2500, gain: 0.6 });
        this.tone({ dur: 0.25, f: 220, f2: 90, gain: 0.35 });
        break;
      case 'block':
        this.metal(rand(420, 500), 0.4, 0.12);
        this.noise({ dur: 0.1, type: 'lowpass', f: 1200, gain: 0.5 });
        break;
      case 'enemy-block':
        this.metal(rand(700, 800), 0.5, 0.12);
        this.noise({ dur: 0.05, type: 'highpass', f: 2000, gain: 0.3 });
        break;
      case 'guard-break':
        this.metal(300, 0.8, 0.2);
        this.noise({ dur: 0.4, type: 'lowpass', f: 700, f2: 100, gain: 0.7 });
        break;
      case 'riposte':
        this.tone({ dur: 0.5, f: 110, f2: 35, gain: 0.9 });
        this.noise({ dur: 0.25, type: 'lowpass', f: 2500, f2: 200, gain: 0.7 });
        this.metal(900, 0.6, 0.08, 0.02);
        break;
      case 'glint':
        this.tone({ dur: 0.35, type: 'sine', f: 2600, f2: 3400, gain: 0.05, attack: 0.02 });
        this.tone({ dur: 0.25, type: 'triangle', f: 5200, gain: 0.02, attack: 0.01 });
        break;
      case 'perilous':
        this.tone({ dur: 0.6, type: 'sawtooth', f: 98, gain: 0.25, attack: 0.01 });
        this.tone({ dur: 0.6, type: 'sawtooth', f: 103.8, gain: 0.25, attack: 0.01 });
        this.metal(180, 1.2, 0.15);
        break;
      case 'hurt':
        this.tone({ dur: 0.3, type: 'sawtooth', f: 120, f2: 55, gain: 0.25 });
        this.noise({ dur: 0.18, type: 'lowpass', f: 900, gain: 0.5 });
        break;
      case 'slam':
        this.tone({ dur: 0.7, f: 70, f2: 28, gain: 0.9 });
        this.noise({ dur: 0.5, type: 'lowpass', f: 420, f2: 90, gain: 0.8 });
        this.metal(140, 0.9, 0.12, 0.01);
        break;
      case 'open':
        this.noise({ dur: 1.4, type: 'lowpass', f: 300, f2: 120, gain: 0.45, attack: 0.1 });
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone({ t: 0.25 + i * 0.09, dur: 2.2, type: 'triangle', f, gain: 0.07 }));
        break;
      case 'pickup':
        [392, 587.3, 784, 1174.7, 1568].forEach((f, i) => this.tone({ t: i * 0.07, dur: 2.4, type: 'sine', f, gain: 0.12 }));
        this.tone({ dur: 2.5, type: 'triangle', f: 98, gain: 0.2 });
        break;
      case 'shatter':
        for (let i = 0; i < 5; i++) this.noise({ t: i * 0.035 + rand(0, 0.02), dur: 0.05, type: 'highpass', f: rand(1800, 4200), gain: 0.2 });
        this.tone({ dur: 0.25, f: 220, f2: 70, gain: 0.25 });
        break;
      case 'shriek':
        this.tone({ dur: 0.45, type: 'sawtooth', f: 520, f2: 1400, gain: 0.05, attack: 0.08 });
        this.noise({ dur: 0.4, f: 1600, f2: 3500, q: 6, gain: 0.08, attack: 0.1 });
        break;
      case 'cast':
        this.tone({ dur: 0.6, type: 'triangle', f: 660, f2: 1320, gain: 0.06, attack: 0.3 });
        break;
      case 'bolt':
        this.metal(1800, 0.5, 0.05);
        this.noise({ dur: 0.2, f: 3000, f2: 800, q: 3, gain: 0.12 });
        break;
      case 'boss-slam':
        this.tone({ dur: 1.0, f: 55, f2: 22, gain: 1 });
        this.noise({ dur: 0.8, type: 'lowpass', f: 600, f2: 60, gain: 1 });
        break;
      case 'step':
        this.noise({ dur: 0.05, type: 'lowpass', f: rand(260, 380), gain: 0.12 });
        break;
      case 'land':
        this.noise({ dur: 0.12, type: 'lowpass', f: 300, gain: 0.35 });
        break;
      case 'empty':
        this.tone({ dur: 0.06, type: 'square', f: 180, gain: 0.05 });
        break;
      case 'death':
        this.tone({ dur: 2.6, f: 110, f2: 30, gain: 0.5, attack: 0.05 });
        this.tone({ dur: 2.6, type: 'sawtooth', f: 55, f2: 27, gain: 0.12, attack: 0.3 });
        break;
      case 'fall':
        this.noise({ dur: 1.2, f: 900, f2: 120, q: 0.7, gain: 0.35, attack: 0.1 });
        break;
      case 'descend':
        this.noise({ dur: 1.4, type: 'lowpass', f: 1200, f2: 80, gain: 0.5, attack: 0.3 });
        this.tone({ dur: 1.8, f: 196, f2: 49, gain: 0.3, attack: 0.2 });
        break;
      case 'drip':
        this.tone({ dur: 0.12, f: rand(1400, 2200), f2: rand(600, 900), gain: 0.05, dest: this.reverb });
        break;
      case 'chime':
        this.tone({ dur: 3, f: rand(1600, 2600), gain: 0.02, attack: 0.02, dest: this.reverb });
        break;
      case 'swap':
        this.noise({ dur: 0.12, f: 1800, f2: 900, q: 2, gain: 0.12 });
        this.metal(1400, 0.2, 0.03);
        break;
      case 'dodge':
        this.noise({ dur: 0.22, f: 900, f2: 250, q: 0.8, gain: 0.3, attack: 0.03 });
        break;
      case 'bash':
        this.tone({ dur: 0.25, f: 110, f2: 50, gain: 0.8 });
        this.noise({ dur: 0.15, type: 'lowpass', f: 900, gain: 0.6 });
        break;
      case 'shield-block':
        this.tone({ dur: 0.2, f: 180, f2: 90, gain: 0.5 });
        this.noise({ dur: 0.12, type: 'lowpass', f: 700, gain: 0.5 });
        break;
      case 'swing-heavy':
        this.noise({ dur: 0.3, f: 1200, f2: 250, q: 1.2, gain: 0.45 });
        break;
      case 'drink':
        for (let i = 0; i < 3; i++) this.tone({ t: i * 0.12, dur: 0.08, f: rand(300, 420), f2: rand(200, 260), gain: 0.12 });
        break;
      case 'heal':
        [523.3, 659.3, 784].forEach((f, i) => this.tone({ t: i * 0.05, dur: 1.2, type: 'sine', f, gain: 0.07 }));
        break;
      case 'flare':
        this.noise({ dur: 0.6, type: 'lowpass', f: 3000, f2: 300, gain: 0.7 });
        this.tone({ dur: 0.8, type: 'sawtooth', f: 90, f2: 40, gain: 0.25 });
        this.metal(900, 1, 0.06, 0.05);
        break;
      case 'cast-player':
        this.tone({ dur: 0.18, type: 'triangle', f: 700, f2: 1400, gain: 0.1 });
        this.noise({ dur: 0.15, f: 2500, f2: 900, q: 2, gain: 0.15 });
        break;
      case 'pickup-weapon':
        this.metal(900, 0.5, 0.06);
        this.noise({ dur: 0.1, f: 2000, q: 1.5, gain: 0.12 });
        break;
      case 'bell':
        this.metal(310, 3, 0.25);
        break;
      case 'wave':
        this.noise({ dur: 3.2, type: 'lowpass', f: 700, f2: 200, gain: 0.18, attack: 1.4 });
        break;
      case 'wind':
        this.noise({ dur: 4, f: 500, f2: 900, q: 3, gain: 0.06, attack: 2 });
        break;
      case 'gull':
        for (let i = 0; i < randInt3(); i++) this.tone({ t: i * 0.35, dur: 0.25, type: 'triangle', f: rand(1100, 1300), f2: rand(700, 850), gain: 0.025, attack: 0.03, dest: this.reverb });
        break;
      case 'growl':
        this.tone({ dur: 0.5, type: 'sawtooth', f: 80, f2: 60, gain: 0.12, attack: 0.05 });
        this.noise({ dur: 0.5, type: 'lowpass', f: 300, gain: 0.25, attack: 0.05 });
        break;
      case 'groan':
        this.tone({ dur: 1.1, type: 'sawtooth', f: 70, f2: 45, gain: 0.14, attack: 0.2 });
        this.noise({ dur: 0.9, f: 260, q: 4, gain: 0.12, attack: 0.3 });
        break;
      case 'screech':
        this.tone({ dur: 0.4, type: 'sawtooth', f: 900, f2: 1700, gain: 0.05, attack: 0.03 });
        this.noise({ dur: 0.35, f: 2600, q: 5, gain: 0.08 });
        break;
      case 'fogwall':
        this.noise({ dur: 1.5, f: 700, f2: 2400, q: 1, gain: 0.25, attack: 0.3 });
        this.metal(220, 2.5, 0.12);
        break;
      case 'awaken':
        this.tone({ dur: 1.4, type: 'sawtooth', f: 55, gain: 0.12, attack: 0.3 });
        this.tone({ dur: 1.4, type: 'sawtooth', f: 58.3, gain: 0.12, attack: 0.3 });
        break;
      case 'splash':
        this.noise({ dur: 0.18, f: 900, q: 0.8, gain: 0.08 });
        break;
      case 'distant':
        this.noise({ dur: 2.2, type: 'lowpass', f: 180, gain: 0.25, attack: 0.6, dest: this.reverb });
        break;
      case 'coin':
        this.tone({ dur: 0.08, type: 'square', f: 1560 * rand(0.97, 1.03), gain: 0.035 });
        this.tone({ t: 0.05, dur: 0.18, type: 'square', f: 2090 * rand(0.97, 1.03), gain: 0.03 });
        break;
      case 'key':
        this.metal(1400, 0.4, 0.05);
        this.metal(1900, 0.3, 0.035, 0.08);
        break;
      case 'locked':
        this.noise({ dur: 0.08, f: 900, q: 4, gain: 0.12 });
        this.noise({ t: 0.1, dur: 0.08, f: 700, q: 4, gain: 0.1 });
        break;
      case 'unlock':
        this.metal(900, 0.3, 0.07);
        this.noise({ t: 0.05, dur: 0.1, f: 2400, q: 2, gain: 0.08 });
        break;
      case 'gate':
        this.noise({ dur: 1.4, type: 'lowpass', f: 400, gain: 0.2, attack: 0.1 });
        for (let i = 0; i < 6; i++) this.noise({ t: i * 0.2, dur: 0.05, f: 1800, q: 6, gain: 0.05 });
        break;
      case 'chest':
        this.noise({ dur: 0.35, type: 'lowpass', f: 500, gain: 0.18 });
        this.tone({ t: 0.25, dur: 0.6, type: 'triangle', f: 660, gain: 0.05 });
        this.tone({ t: 0.35, dur: 0.6, type: 'triangle', f: 990, gain: 0.04 });
        break;
      case 'zap':
        this.noise({ dur: 0.18, type: 'highpass', f: 2500, gain: 0.12 });
        this.tone({ dur: 0.15, type: 'sawtooth', f: 180, f2: 60, gain: 0.06 });
        break;
      case 'shock':
        this.noise({ dur: 0.4, type: 'bandpass', f: 1200, f2: 300, q: 1, gain: 0.2 });
        this.metal(620, 0.8, 0.06);
        break;
      case 'bloom':
        this.noise({ dur: 0.3, type: 'lowpass', f: 700, f2: 150, gain: 0.2 });
        break;
      case 'devil':
        this.tone({ dur: 2.2, type: 'sawtooth', f: 43.6, gain: 0.14, attack: 0.3 });
        this.tone({ dur: 2.2, type: 'sawtooth', f: 46.2, gain: 0.12, attack: 0.3 });
        this.noise({ dur: 1.4, type: 'lowpass', f: 220, gain: 0.25, attack: 0.2, dest: this.reverb });
        break;
      case 'angel':
        for (const [f, t] of [[523, 0], [659, 0.08], [784, 0.16], [1046, 0.24]]) this.tone({ t, dur: 1.8, type: 'sine', f, gain: 0.045, attack: 0.15, dest: this.reverb });
        break;
      case 'halo':
        this.tone({ dur: 0.25, type: 'sine', f: 1318, f2: 1760, gain: 0.03 });
        break;
      case 'ult':
        this.tone({ dur: 0.9, type: 'sawtooth', f: 110, f2: 220, gain: 0.08, attack: 0.05 });
        this.metal(440, 1.4, 0.07);
        this.noise({ dur: 0.6, type: 'bandpass', f: 400, f2: 3000, q: 1, gain: 0.12 });
        break;
      case 'ult-ready':
        this.tone({ dur: 0.5, type: 'sine', f: 880, gain: 0.05 });
        this.tone({ t: 0.1, dur: 0.7, type: 'sine', f: 1320, gain: 0.045 });
        break;
      case 'sunfall':
        this.noise({ dur: 1.0, type: 'bandpass', f: 300, f2: 2400, q: 0.8, gain: 0.18, attack: 0.5 });
        break;
      case 'merchant':
        // A wheezy, delighted chuckle.
        for (let i = 0; i < 4; i++) this.tone({ t: i * 0.09, dur: 0.07, type: 'triangle', f: 330 - i * 20, f2: 260 - i * 20, gain: 0.05 });
        break;
      case 'blip':
        this.tone({ dur: 0.03, type: 'square', f: rand(360, 480), gain: 0.012 });
        break;
      case 'tick':
        this.tone({ dur: 0.04, type: 'triangle', f: 900, gain: 0.03 });
        break;
      case 'buy':
        for (let i = 0; i < 5; i++) this.tone({ t: i * 0.05, dur: 0.1, type: 'square', f: 1400 + i * 180, gain: 0.025 });
        this.metal(1200, 0.6, 0.04, 0.2);
        break;
      case 'lift':
        // Chains paying out and a grinding winch.
        this.noise({ dur: 0.9, type: 'bandpass', f: 180, q: 3, gain: 0.18, attack: 0.1 });
        for (let i = 0; i < 6; i++) this.noise({ t: i * 0.12, dur: 0.04, f: 2200, q: 8, gain: 0.05 });
        this.metal(300, 0.6, 0.05);
        break;
      case 'lift-stop':
        this.noise({ dur: 0.25, type: 'lowpass', f: 250, gain: 0.25 });
        this.metal(220, 0.5, 0.06);
        break;
      case 'portal':
        this.noise({ dur: 1.4, type: 'bandpass', f: 200, f2: 2600, q: 1.2, gain: 0.22, attack: 0.4 });
        this.tone({ dur: 1.4, type: 'sine', f: 90, f2: 30, gain: 0.15, attack: 0.2 });
        break;
      case 'broker':
        // A deep, amused growl.
        this.tone({ dur: 0.9, type: 'sawtooth', f: 62, f2: 48, gain: 0.12, attack: 0.05 });
        this.noise({ dur: 0.7, type: 'lowpass', f: 300, gain: 0.12 });
        for (let i = 0; i < 3; i++) this.tone({ t: 0.3 + i * 0.14, dur: 0.1, type: 'sawtooth', f: 90 - i * 8, gain: 0.07 });
        break;
      case 'seraph':
        for (const [f, t] of [[784, 0], [988, 0.1], [1175, 0.2]]) this.tone({ t, dur: 1.4, type: 'sine', f, gain: 0.03, attack: 0.2, dest: this.reverb });
        break;
      case 'streak':
        this.tone({ dur: 0.12, type: 'triangle', f: 660, f2: 990, gain: 0.05 });
        break;
      case 'restage':
        for (let i = 0; i < 3; i++) this.tone({ t: i * 0.06, dur: 0.3, type: 'triangle', f: 440 * (1 + i * 0.5), gain: 0.04 });
        this.noise({ dur: 0.5, type: 'bandpass', f: 3000, f2: 800, q: 2, gain: 0.08 });
        break;
      case 'summon':
        this.tone({ dur: 1.2, type: 'sine', f: 220, f2: 330, gain: 0.06, attack: 0.3, dest: this.reverb });
        this.tone({ dur: 1.2, type: 'sine', f: 277, f2: 415, gain: 0.05, attack: 0.3, dest: this.reverb });
        this.noise({ dur: 0.8, type: 'highpass', f: 2000, gain: 0.04, attack: 0.2 });
        break;
      case 'vanish':
        this.noise({ dur: 0.8, type: 'bandpass', f: 2400, f2: 300, q: 1.5, gain: 0.14 });
        break;
      case 'reveal':
        this.noise({ dur: 0.4, type: 'bandpass', f: 300, f2: 2000, q: 1.5, gain: 0.1 });
        break;
    }
  }

  /** Drips, crystal chimes and far-off rumbles so the silence never feels empty. */
  update(dt) {
    if (!this.ctx) return;
    this.nextAmbient -= dt;
    if (this.nextAmbient <= 0) {
      const r = Math.random();
      if (this.mode === 'hub') {
        this.play(r < 0.55 ? 'wave' : r < 0.85 ? 'wind' : 'gull');
        this.nextAmbient = rand(1.5, 4.5);
      } else {
        this.play(r < 0.5 ? 'drip' : r < 0.8 ? 'chime' : 'distant');
        this.nextAmbient = rand(2.5, 9);
      }
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
  }
}
