import * as THREE from 'three';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  pixelSize: 3,
  ditherLevels: 22,
  room: { width: 26, depth: 16, wallHeight: 5, southWallHeight: 1.2, doorWidth: 3.2, wallThickness: 1.2, inset: 0.35 },
  fogDensity: 0.042,
  player: {
    maxHp: 100,
    maxStamina: 100,
    staminaRegen: 64,
    staminaDelay: 0.42,
    speed: 7.2,
    radius: 0.55,
    hurtIframes: 0.65,
    torch: { color: 0xff9448, intensity: 48, distance: 22, decay: 1.25 },
    attack: { cost: 16, damage: 14, reach: 2.7, arc: Math.PI * 0.8, windup: 0.075, active: 0.11, recovery: 0.21, lunge: 7 },
    dodge: { cost: 24, speed: 19, duration: 0.3, iframes: 0.24, recovery: 0.09 },
  },
  camera: { offset: new THREE.Vector3(0, 15.5, 8.5), fov: 50, stiffness: 11, aimLead: 0.16, maxLead: 2.6 },
  inputBuffer: 0.3,
};

const FLOOR_THEMES = [
  { name: 'The Sunken Ossuary', fog: 0x060508, boss: 'Gaoler of Bones' },
  { name: 'Halls of the Hollowed', fog: 0x0a0506, boss: 'The Hollow Warden' },
  { name: 'The Weeping Catacomb', fog: 0x05070a, boss: 'Ossified Sentinel' },
  { name: 'Cathedral of Ash', fog: 0x0a0806, boss: 'Ashen Castellan' },
  { name: 'The Abyssal Crypt', fog: 0x040404, boss: 'Keeper of the Last Door' },
];

const DIRS = {
  n: { dx: 0, dy: -1, opposite: 's' },
  s: { dx: 0, dy: 1, opposite: 'n' },
  e: { dx: 1, dy: 0, opposite: 'w' },
  w: { dx: -1, dy: 0, opposite: 'e' },
};

const RoomState = Object.freeze({ DORMANT: 'dormant', SEALING: 'sealing', COMBAT: 'combat', CLEARED: 'cleared' });

// ============================================================================
// Utilities
// ============================================================================

const TAU = Math.PI * 2;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const easeOut = (k) => 1 - (1 - k) * (1 - k);
const angleDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const toRoman = (n) => {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
};

/** Smooth pseudo-noise from a few incommensurate sines; used for flicker. */
const flicker = (t, seed = 0) =>
  (Math.sin(t * 7.3 + seed) * 0.5 + Math.sin(t * 13.1 + seed * 2.1) * 0.3 + Math.sin(t * 23.7 + seed * 3.7) * 0.2);

/** BoxGeometry UVs are 0..1 per face; rescale them so textures tile in world units. */
function worldBoxGeometry(w, h, d, unit = 4) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = faceDims[face];
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su / unit, uv.getY(idx) * sv / unit);
    }
  }
  return geo;
}

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, opts) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat, opts);
  m.position.set(x, y, z);
  return m;
}

// ============================================================================
// Procedural textures (chunky, low-res, nearest-filtered)
// ============================================================================

const TextureFactory = {
  canvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d')];
  },

  finish(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },

  speckle(ctx, size, count, alpha) {
    for (let i = 0; i < count; i++) {
      const v = Math.random() < 0.5 ? 0 : 255;
      ctx.fillStyle = `rgba(${v},${v},${v},${rand(0.02, alpha)})`;
      ctx.fillRect(randInt(0, size), randInt(0, size), randInt(1, 2), randInt(1, 2));
    }
  },

  flagstones() {
    const size = 128;
    const [c, ctx] = this.canvas(size);
    ctx.fillStyle = '#1a1816';
    ctx.fillRect(0, 0, size, size);
    const palette = ['#4a4540', '#403b36', '#524c45', '#46413b', '#3b3733'];
    const rows = 4;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -rh * 0.5 : 0;
      while (x < size) {
        const w = rh * rand(0.8, 1.4);
        ctx.fillStyle = pick(palette);
        ctx.fillRect(Math.round(x) + 1, r * rh + 1, Math.round(w) - 2, rh - 2);
        // Wrap stones that cross the right edge so the texture tiles seamlessly.
        if (x + w > size) ctx.fillRect(Math.round(x - size) + 1, r * rh + 1, Math.round(w) - 2, rh - 2);
        x += w;
      }
    }
    this.speckle(ctx, size, 2200, 0.16);
    ctx.strokeStyle = 'rgba(10,8,8,0.6)';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      let px = rand(0, size), py = rand(0, size);
      ctx.moveTo(px, py);
      for (let s = 0; s < 4; s++) {
        px += rand(-10, 10); py += rand(-10, 10);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    return this.finish(c);
  },

  bricks() {
    const size = 64;
    const [c, ctx] = this.canvas(size);
    ctx.fillStyle = '#141211';
    ctx.fillRect(0, 0, size, size);
    const palette = ['#56504a', '#4b4640', '#5e5750', '#433f3a'];
    const bh = 8, bw = 16;
    for (let r = 0; r < size / bh; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let x = -bw; x < size + bw; x += bw) {
        ctx.fillStyle = pick(palette);
        ctx.fillRect(x + off + 1, r * bh + 1, bw - 1, bh - 1);
      }
    }
    this.speckle(ctx, size, 700, 0.18);
    // Damp streaks running down the masonry.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(10,14,10,0.25)';
      ctx.fillRect(randInt(0, size), 0, 1, randInt(10, size));
    }
    return this.finish(c);
  },
};

// ============================================================================
// Audio — everything is synthesised with WebAudio, no assets required.
// ============================================================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.nextAmbient = 4;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
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
    filter.frequency.value = 170;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0.07;
    filter.connect(gain);
    gain.connect(this.master);
    gain.connect(this.reverb);
    for (const [f, type] of [[55, 'sawtooth'], [55.6, 'sawtooth'], [36.7, 'sine'], [82.4, 'triangle']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(filter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
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

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'swing':
        this.noise({ dur: 0.14, f: 2600, f2: 600, q: 1.4, gain: 0.35 });
        break;
      case 'hit':
        this.tone({ dur: 0.16, f: 150, f2: 45, gain: 0.7 });
        this.noise({ dur: 0.08, type: 'lowpass', f: 1800, gain: 0.45 });
        this.noise({ t: 0.01, dur: 0.05, type: 'highpass', f: 3000, gain: 0.12 });
        break;
      case 'dodge':
        this.noise({ dur: 0.26, f: 900, f2: 250, q: 0.8, gain: 0.3, attack: 0.03 });
        break;
      case 'hurt':
        this.tone({ dur: 0.3, type: 'sawtooth', f: 120, f2: 55, gain: 0.25 });
        this.noise({ dur: 0.18, type: 'lowpass', f: 900, gain: 0.5 });
        break;
      case 'slam':
        this.tone({ dur: 0.7, f: 70, f2: 28, gain: 0.9 });
        this.noise({ dur: 0.5, type: 'lowpass', f: 420, f2: 90, gain: 0.8 });
        this.noise({ t: 0.02, dur: 0.12, type: 'bandpass', f: 1800, gain: 0.2 });
        break;
      case 'open':
        this.noise({ dur: 1.3, type: 'lowpass', f: 300, f2: 120, gain: 0.45, attack: 0.1 });
        [523.3, 659.3, 784, 1046.5].forEach((f, i) =>
          this.tone({ t: 0.25 + i * 0.09, dur: 2.2, type: 'triangle', f, gain: 0.07 }));
        break;
      case 'pickup':
        [392, 587.3, 784, 1174.7, 1568].forEach((f, i) =>
          this.tone({ t: i * 0.07, dur: 2.4, type: 'sine', f, gain: 0.12 }));
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
      case 'rattle':
        for (let i = 0; i < 3; i++) this.noise({ t: i * 0.05, dur: 0.03, f: rand(2000, 3500), q: 4, gain: 0.1 });
        break;
      case 'boss-slam':
        this.tone({ dur: 1.0, f: 55, f2: 22, gain: 1 });
        this.noise({ dur: 0.8, type: 'lowpass', f: 600, f2: 60, gain: 1 });
        break;
      case 'empty':
        this.tone({ dur: 0.06, type: 'square', f: 180, gain: 0.05 });
        break;
      case 'death':
        this.tone({ dur: 2.6, f: 110, f2: 30, gain: 0.5, attack: 0.05 });
        this.tone({ dur: 2.6, type: 'sawtooth', f: 55, f2: 27, gain: 0.12, attack: 0.3 });
        break;
      case 'descend':
        this.noise({ dur: 1.4, type: 'lowpass', f: 1200, f2: 80, gain: 0.5, attack: 0.3 });
        this.tone({ dur: 1.8, f: 196, f2: 49, gain: 0.3, attack: 0.2 });
        break;
      case 'drip':
        this.tone({ dur: 0.12, f: rand(1400, 2200), f2: rand(600, 900), gain: 0.05, dest: this.reverb });
        break;
      case 'distant':
        this.noise({ dur: 2.2, type: 'lowpass', f: 180, gain: 0.25, attack: 0.6, dest: this.reverb });
        break;
    }
  }

  /** Occasional drips and far-off rumbles so silence never feels empty. */
  update(dt) {
    if (!this.ctx) return;
    this.nextAmbient -= dt;
    if (this.nextAmbient <= 0) {
      this.play(Math.random() < 0.75 ? 'drip' : 'distant');
      this.nextAmbient = rand(3, 11);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
  }
}

// ============================================================================
// Input with action buffering (a press is remembered briefly so it fires the
// moment the current animation lock ends — this is what makes it feel tight).
// ============================================================================

class Input {
  constructor() {
    this.keys = new Set();
    this.mouseNdc = new THREE.Vector2();
    this.buffered = { attack: -Infinity, dodge: -Infinity };
    this.pressed = new Set();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.buffer('dodge');
      }
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      this.mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.target.tagName === 'CANVAS') this.buffer('attack');
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
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
  }
  /** One-shot key presses (Esc, R, M) collected since the last frame. */
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }

  moveVector(out) {
    const x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const z = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    out.set(x, 0, z);
    if (x || z) out.normalize();
    return out;
  }
}

// ============================================================================
// Post-processing: render to a low-res target, then upscale with nearest
// sampling, ordered (Bayer) dithering, colour quantisation, grain & vignette.
// ============================================================================

class RetroPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      resolution: { value: new THREE.Vector2(1, 1) },
      time: { value: 0 },
      hurt: { value: 0 },
      fade: { value: 1 },
      levels: { value: CONFIG.ditherLevels },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float time;
        uniform float hurt;
        uniform float fade;
        uniform float levels;
        varying vec2 vUv;

        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

        vec3 aces(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        void main() {
          vec2 pix = floor(vUv * resolution);
          vec3 col = texture2D(tDiffuse, (pix + 0.5) / resolution).rgb;

          col = aces(col * 1.45);
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(lum), col, 0.78);           // drain the colour
          col *= vec3(1.06, 0.97, 0.88);             // sickly warm grade
          col = pow(col, vec3(1.0 / 2.2));           // linear -> sRGB

          float grain = fract(sin(dot(pix + floor(time * 24.0) * 7.13, vec2(12.9898, 78.233))) * 43758.5453);
          col += (grain - 0.5) * 0.03;

          col += (bayer4(pix) - 0.5) / levels;       // ordered dither
          col = floor(col * levels + 0.5) / levels;  // posterise

          vec2 d = vUv - 0.5;
          float vig = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.85)));
          col *= mix(0.25, 1.0, vig);
          col = mix(col, vec3(0.45, 0.0, 0.0), hurt * (1.0 - vig * 0.7) * 0.75);

          gl_FragColor = vec4(col * fade, 1.0);
        }
      `,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }

  setSize(w, h) {
    const px = CONFIG.pixelSize;
    const rw = Math.max(1, Math.floor(w / px));
    const rh = Math.max(1, Math.floor(h / px));
    this.target.setSize(rw, rh);
    this.uniforms.resolution.value.set(rw, rh);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}

// ============================================================================
// Particles — one InstancedMesh of cubes per blend mode.
// ============================================================================

class ParticleSystem {
  constructor(scene, max, additive = false) {
    this.max = max;
    this.additive = additive;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.items = [];
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
  }

  emit({ pos, vel, life = 1, size = 0.1, color = 0xffffff, gravity = 0, drag = 0, bounce = 0.3, linger = false, spin = 1 }) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      p: pos.clone(),
      v: vel ? vel.clone() : new THREE.Vector3(),
      life, maxLife: life, size, gravity, drag, bounce, linger,
      color: new THREE.Color(color),
      spin: rand(-8, 8) * spin,
      rx: rand(0, TAU), ry: rand(0, TAU),
    });
  }

  burst(pos, count, opts) {
    for (let i = 0; i < count; i++) {
      const o = typeof opts === 'function' ? opts(i) : opts;
      this.emit({ ...o, pos });
    }
  }

  clear() { this.items.length = 0; this.mesh.count = 0; }

  update(dt) {
    const items = this.items;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {
        items[i] = items[items.length - 1];
        items.pop();
        continue;
      }
      p.v.y -= p.gravity * dt;
      if (p.drag) p.v.multiplyScalar(Math.exp(-p.drag * dt));
      p.p.addScaledVector(p.v, dt);
      if (p.gravity > 0 && p.p.y < p.size * 0.5) {
        p.p.y = p.size * 0.5;
        p.v.y = Math.abs(p.v.y) * p.bounce;
        p.v.x *= 0.6; p.v.z *= 0.6;
        p.spin *= 0.5;
      }
      p.rx += p.spin * dt;
      p.ry += p.spin * 0.7 * dt;

      const k = p.life / p.maxLife;
      const s = p.linger ? p.size * Math.min(1, k / 0.25) : p.size * (0.3 + 0.7 * k);
      this.dummy.position.copy(p.p);
      this.dummy.rotation.set(p.rx, p.ry, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.tmpColor.copy(p.color);
      if (this.additive) this.tmpColor.multiplyScalar(Math.min(1, k * 1.5));
      this.mesh.setColorAt(n, this.tmpColor);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ============================================================================
// Transient effects (slash arcs, ground telegraphs). Each returns false when done.
// ============================================================================

class SlashArc {
  constructor(game, owner, yaw, reach, arc, side, duration) {
    this.game = game;
    this.owner = owner;
    this.t = 0;
    this.duration = duration;
    this.fadeTime = 0.12;
    this.uniforms = {
      head: { value: -1 },
      halfArc: { value: arc / 2 },
      side: { value: side },
      opacity: { value: 1 },
      inner: { value: 0.6 },
      outer: { value: reach },
      color: { value: new THREE.Color(0xffd9a0) },
    };
    const geo = new THREE.RingGeometry(0.6, reach, 28, 1, -Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float head, halfArc, side, opacity, inner, outer;
        uniform vec3 color;
        varying vec3 vPos;
        void main() {
          float a = atan(vPos.x, vPos.z) / halfArc * side;
          float behind = head - a;
          if (behind < 0.0) discard;
          float r = clamp((length(vPos.xz) - inner) / (outer - inner), 0.0, 1.0);
          float trail = exp(-behind * 2.2);
          float edge = smoothstep(0.2, 0.95, r) * (1.0 - smoothstep(0.97, 1.0, r));
          float alpha = trail * edge * opacity;
          gl_FragColor = vec4(color * alpha * 2.2, alpha);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(owner.pos.x, 1.05, owner.pos.z);
    this.mesh.rotation.y = yaw;
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    const k = this.t / this.duration;
    if (k < 1) this.mesh.position.set(this.owner.pos.x, 1.05, this.owner.pos.z);
    this.uniforms.head.value = -1 + Math.min(k, 1) * 2.4;
    if (this.t > this.duration) this.uniforms.opacity.value = Math.max(0, 1 - (this.t - this.duration) / this.fadeTime);
    if (this.t > this.duration + this.fadeTime) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** A red floor marking that fills up before a heavy attack lands. */
class GroundTelegraph {
  constructor(game, x, z, radius, duration, { arc = TAU, yaw = 0 } = {}) {
    this.game = game;
    this.t = 0;
    this.duration = duration;
    const start = arc >= TAU ? 0 : -Math.PI / 2 - arc / 2;
    const matOutline = new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
    const matFill = matOutline.clone();
    matFill.opacity = 0.35;
    this.group = new THREE.Group();
    this.group.position.set(x, 0.04, z);
    this.group.rotation.y = yaw;
    const outline = new THREE.Mesh(new THREE.RingGeometry(radius - 0.12, radius, 40, 1, start, arc).rotateX(-Math.PI / 2), matOutline);
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40, start, arc).rotateX(-Math.PI / 2), matFill);
    this.fill.scale.setScalar(0.01);
    this.group.add(outline, this.fill);
    game.scene.add(this.group);
    this.materials = [matOutline, matFill];
  }

  cancel() { this.t = this.duration; }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.fill.scale.setScalar(Math.max(0.01, k));
    this.materials[0].opacity = 0.5 + 0.5 * Math.sin(this.t * 30) * (1 - k) + k * 0.5;
    if (this.t >= this.duration) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

// ============================================================================
// Items / relics
// ============================================================================

const ITEMS = [
  { id: 'whetstone', name: 'Cursed Whetstone', desc: 'Attack speed up', lore: 'It hones the blade and dulls the soul.', color: 0x8fd0ff, shape: 'shard',
    apply: (s) => { s.attackSpeed *= 1.22; } },
  { id: 'ember', name: 'Vampiric Ember', desc: 'Strikes drain life', lore: 'A coal that still remembers blood.', color: 0xff3322, shape: 'orb',
    apply: (s) => { s.lifesteal += 3; } },
  { id: 'greatshard', name: 'Ashen Greatblade Shard', desc: 'Damage up', lore: 'Broken from the sword of a king no one mourned.', color: 0xd9d2c0, shape: 'shard',
    apply: (s) => { s.damage += 6; } },
  { id: 'mantle', name: "Wraith's Mantle", desc: 'Longer i-frames, cheaper rolls', lore: 'Death slides past what it cannot hold.', color: 0x9b7bff, shape: 'cloak',
    apply: (s) => { s.iframeBonus += 0.07; s.dodgeCost *= 0.75; } },
  { id: 'chalice', name: 'Bloodied Chalice', desc: 'Max health up, fully healed', lore: 'Drink, and be less dead.', color: 0xc41e2a, shape: 'chalice',
    apply: (s, p) => { s.maxHp += 25; p.hp = s.maxHp; } },
  { id: 'lung', name: 'Hollow Lung', desc: 'Stamina recovers faster', lore: 'Breathes for you, whether you like it or not.', color: 0x7fbf6a, shape: 'orb',
    apply: (s) => { s.staminaRegen *= 1.35; } },
  { id: 'heart', name: 'Heart of the Unkindled', desc: 'Max stamina up', lore: 'It beats slowly, and it does not tire.', color: 0xff7a3a, shape: 'heart',
    apply: (s, p) => { s.maxStamina += 30; p.stamina = s.maxStamina; } },
  { id: 'lantern', name: 'Grave Lantern', desc: 'Your light burns farther', lore: 'Its flame is fed by those you fell.', color: 0xffc46a, shape: 'lantern',
    apply: (s) => { s.lightRadius *= 1.28; } },
  { id: 'brand', name: "Executioner's Brand", desc: 'Longer reach', lore: 'Mark of one who never missed the neck.', color: 0xe0643a, shape: 'ring',
    apply: (s) => { s.reach *= 1.18; } },
  { id: 'rosary', name: 'Thorned Rosary', desc: 'Those who strike you bleed', lore: 'Every bead a prayer, every prayer a barb.', color: 0x6ad0a0, shape: 'ring',
    apply: (s) => { s.thorns += 16; } },
  { id: 'shroud', name: 'Moth-Eaten Shroud', desc: 'Move speed up', lore: 'Lighter than the body it once wrapped.', color: 0xb0a890, shape: 'cloak',
    apply: (s) => { s.speed *= 1.1; } },
  { id: 'tithe', name: "Sinner's Tithe", desc: 'Damage way up, max health down', lore: 'Paid in flesh, collected in blood.', color: 0x8a1030, shape: 'shard',
    apply: (s, p) => { s.damage *= 1.45; s.maxHp = Math.max(30, s.maxHp - 20); p.hp = Math.min(p.hp, s.maxHp); } },
  { id: 'tear', name: 'Crimson Tear', desc: 'Restores 50 health', lore: 'Wept by a saint who bled instead.', color: 0xff2040, shape: 'orb', consumable: true,
    apply: (s, p) => { p.hp = Math.min(s.maxHp, p.hp + 50); } },
];

function rollItem(player) {
  const hurt = player.hp < player.stats.maxHp * 0.6;
  const pool = ITEMS.filter((i) => !i.consumable || hurt);
  const weights = pool.map((i) => (i.consumable ? 1.4 : 1) / (1 + 0.6 * (player.itemCounts.get(i.id) || 0)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

function buildItemMesh(item) {
  const mat = new THREE.MeshStandardMaterial({ color: item.color, emissive: item.color, emissiveIntensity: 1.6, roughness: 0.4, flatShading: true });
  const g = new THREE.Group();
  const add = (geo, y = 0, s = 1) => {
    const m = mesh(geo, mat, { cast: false, receive: false });
    m.position.y = y;
    m.scale.setScalar(s);
    g.add(m);
    return m;
  };
  switch (item.shape) {
    case 'shard': add(new THREE.OctahedronGeometry(0.28)).scale.set(0.6, 1.5, 0.6); break;
    case 'orb': add(new THREE.IcosahedronGeometry(0.26)); break;
    case 'ring': add(new THREE.TorusGeometry(0.24, 0.07, 6, 12)); break;
    case 'heart': add(new THREE.DodecahedronGeometry(0.26)).scale.set(1, 1.15, 0.8); break;
    case 'chalice':
      add(new THREE.CylinderGeometry(0.22, 0.08, 0.28, 8), 0.12);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), -0.12);
      add(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 8), -0.24);
      break;
    case 'lantern':
      add(new THREE.BoxGeometry(0.26, 0.34, 0.26));
      add(new THREE.ConeGeometry(0.2, 0.14, 4), 0.24);
      break;
    case 'cloak': add(new THREE.ConeGeometry(0.26, 0.6, 5)); break;
  }
  return g;
}

// ============================================================================
// Pedestal & descent
// ============================================================================

class Pedestal {
  constructor(room, item, x, z, risen = false) {
    this.room = room;
    this.game = room.game;
    this.item = item;
    this.taken = false;
    this.t = risen ? 10 : 0;
    this.radius = 0.8;
    const M = this.game.materials;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.rig.add(box(1.5, 0.3, 1.5, M.trim, 0, 0.15, 0));
    const column = mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.0, 8), M.stone);
    column.position.y = 0.8;
    this.rig.add(column);
    this.rig.add(box(1.1, 0.18, 1.1, M.trim, 0, 1.39, 0));
    this.itemMesh = buildItemMesh(item);
    this.itemMesh.position.y = 2.0;
    this.rig.add(this.itemMesh);
    room.group.add(this.group);
    room.obstacles.push(this.obstacle = { x, z, r: this.radius });
    if (!risen) this.game.particles.burst(new THREE.Vector3(x, 0.2, z), 30, () => ({
      vel: new THREE.Vector3(rand(-3, 3), rand(1, 4), rand(-3, 3)), life: rand(0.6, 1.3), size: rand(0.08, 0.2), color: 0x3a3530, gravity: 9, linger: true,
    }));
  }

  get lightPosition() { return new THREE.Vector3(this.group.position.x, 2.4, this.group.position.z); }

  update(dt) {
    this.t += dt;
    const rise = easeOut(Math.min(1, this.t / 1.3));
    this.rig.position.y = -1.9 * (1 - rise);
    if (!this.taken) {
      this.itemMesh.rotation.y += dt * 1.5;
      this.itemMesh.position.y = 2.0 + Math.sin(this.t * 2.2) * 0.12;
      if (Math.random() < dt * 14) {
        const p = this.group.position;
        this.game.glow.emit({
          pos: new THREE.Vector3(p.x + rand(-0.3, 0.3), 1.6 + this.rig.position.y, p.z + rand(-0.3, 0.3)),
          vel: new THREE.Vector3(0, rand(0.6, 1.4), 0), life: rand(0.8, 1.4), size: 0.06, color: this.item.color,
        });
      }
      const player = this.game.player;
      if (rise > 0.95 && player.alive && player.pos.distanceTo(this.group.position) < this.radius + player.radius + 0.25) this.take();
    }
  }

  take() {
    this.taken = true;
    this.itemMesh.visible = false;
    const pos = this.group.position.clone().setY(2);
    this.game.glow.burst(pos, 40, () => ({
      vel: new THREE.Vector3(rand(-4, 4), rand(-1, 5), rand(-4, 4)), life: rand(0.5, 1.2), size: rand(0.05, 0.14), color: this.item.color, drag: 2,
    }));
    this.game.onItemPickup(this.item);
  }
}

class Descent {
  constructor(room, x, z) {
    this.room = room;
    this.game = room.game;
    this.t = 0;
    this.used = false;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    const M = this.game.materials;
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), M.void);
    pit.position.y = 0.02;
    this.group.add(pit);
    for (const [bx, bz, w, d] of [[0, -1.45, 3.2, 0.3], [0, 1.45, 3.2, 0.3], [-1.45, 0, 0.3, 2.6], [1.45, 0, 0.3, 2.6]]) {
      this.group.add(box(w, 0.25, d, M.trim, bx, 0.12, bz));
    }
    this.shaftMat = new THREE.MeshBasicMaterial({ color: 0x8aa0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 12, 8, 1, true), this.shaftMat);
    shaft.position.y = 6;
    this.group.add(shaft);
    this.runeMat = new THREE.MeshBasicMaterial({ color: 0x6a90ff, transparent: true, opacity: 0 });
    const rune = new THREE.Mesh(new THREE.RingGeometry(1.65, 1.8, 24).rotateX(-Math.PI / 2), this.runeMat);
    rune.position.y = 0.03;
    this.group.add(rune);
    room.group.add(this.group);
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / 1.5);
    this.shaftMat.opacity = 0.06 * k + Math.sin(this.t * 2) * 0.015 * k;
    this.runeMat.opacity = k * (0.7 + 0.3 * Math.sin(this.t * 3));
    const player = this.game.player;
    if (k >= 1 && !this.used && player.alive && player.state !== 'dodge') {
      const p = this.group.position;
      if (Math.abs(player.pos.x - p.x) < 1.2 && Math.abs(player.pos.z - p.z) < 1.2) {
        this.used = true;
        this.game.descend();
      }
    }
  }
}

// ============================================================================
// Player — the knight
// ============================================================================

const _move = new THREE.Vector3();
const _v = new THREE.Vector3();

class Player {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this.dodgeDir = new THREE.Vector3();
    this.radius = CONFIG.player.radius;
    this.hitSet = new Set();
    this.buildMesh();

    const T = CONFIG.player.torch;
    this.torch = new THREE.PointLight(T.color, T.intensity, T.distance, T.decay);
    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(512, 512);
    this.torch.shadow.bias = -0.004;
    this.torch.shadow.camera.near = 0.2;
    this.torch.shadow.camera.far = 30;
    this.torch.position.set(0.55, 1.6, 0.3);
    this.group.add(this.torch);

    // Faint, shadowless key light so the knight never dissolves into a silhouette.
    this.fill = new THREE.PointLight(0xffc89a, 9, 5, 2);
    this.fill.position.set(0, 3.4, 1.2);
    this.group.add(this.fill);

    this.reset();
  }

  buildMesh() {
    const armor = new THREE.MeshStandardMaterial({ color: 0x4d505a, roughness: 0.5, metalness: 0.1, flatShading: true });
    const darkArmor = new THREE.MeshStandardMaterial({ color: 0x2b2c31, roughness: 0.6, metalness: 0.1, flatShading: true });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3d0f12, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.9, flatShading: true });
    const steel = new THREE.MeshStandardMaterial({ color: 0xa9adb5, roughness: 0.3, metalness: 0.6, flatShading: true });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const opts = { cast: false, receive: true };
    const b = (w, h, d, m, x, y, z) => box(w, h, d, m, x, y, z, opts);

    // `body` pivots around the waist so the dodge roll tumbles naturally.
    this.body = new THREE.Group();
    this.body.position.y = 0.9;
    this.group.add(this.body);
    const O = -0.9;

    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.17, 0.85 + O, 0);
      leg.add(b(0.25, 0.62, 0.28, darkArmor, 0, -0.3, 0));
      leg.add(b(0.28, 0.24, 0.36, darkArmor, 0, -0.73, 0.04));
      this.body.add(leg);
      this.legs.push(leg);
    }
    this.body.add(b(0.8, 0.14, 0.5, leather, 0, 0.92 + O, 0));
    this.body.add(b(0.62, 0.3, 0.4, darkArmor, 0, 1.0 + O, 0));
    this.torso = b(0.76, 0.62, 0.46, armor, 0, 1.36 + O, 0);
    this.body.add(this.torso);
    for (const side of [-1, 1]) {
      const p = b(0.36, 0.22, 0.52, armor, side * 0.5, 1.64 + O, 0);
      p.rotation.z = side * -0.25;
      this.body.add(p);
    }
    // Helm with a thin glowing visor slit and a crest.
    this.body.add(b(0.46, 0.5, 0.48, armor, 0, 1.96 + O, 0));
    this.body.add(b(0.36, 0.045, 0.02, glow, 0, 1.99 + O, 0.245));
    this.body.add(b(0.07, 0.18, 0.5, cloth, 0, 2.28 + O, -0.02));

    this.cape = new THREE.Group();
    this.cape.position.set(0, 1.62 + O, -0.25);
    const capeMesh = b(0.74, 1.15, 0.04, cloth, 0, -0.57, 0);
    this.cape.add(capeMesh);
    this.body.add(this.cape);

    // Waist lantern on the left hip — the source of the torch light.
    this.lantern = new THREE.Group();
    this.lantern.position.set(0.47, 0.9 + O, 0.14);
    this.lantern.add(b(0.18, 0.24, 0.18, darkArmor, 0, 0, 0));
    this.lanternCore = b(0.12, 0.16, 0.19, glow, 0, 0, 0);
    this.lantern.add(this.lanternCore);
    this.body.add(this.lantern);

    // Left arm hangs; right arm + sword pivot at the shoulder and point along +Z.
    this.armL = new THREE.Group();
    this.armL.position.set(0.48, 1.55 + O, 0);
    this.armL.add(b(0.2, 0.62, 0.22, armor, 0, -0.3, 0));
    this.body.add(this.armL);

    this.swordArm = new THREE.Group();
    this.swordArm.rotation.order = 'YXZ';
    this.swordArm.position.set(-0.48, 1.55 + O, 0);
    this.swordArm.add(b(0.2, 0.2, 0.62, armor, 0, 0, 0.3));
    this.swordArm.add(b(0.08, 0.08, 0.2, leather, 0, 0, 0.66));
    this.swordArm.add(b(0.4, 0.07, 0.08, darkArmor, 0, 0, 0.78));
    this.swordArm.add(b(0.1, 0.035, 1.3, steel, 0, 0, 1.45));
    this.body.add(this.swordArm);
  }

  reset() {
    const P = CONFIG.player;
    this.stats = {
      maxHp: P.maxHp,
      maxStamina: P.maxStamina,
      staminaRegen: P.staminaRegen,
      speed: P.speed,
      damage: P.attack.damage,
      attackSpeed: 1,
      reach: 1,
      lifesteal: 0,
      thorns: 0,
      iframeBonus: 0,
      dodgeCost: P.dodge.cost,
      attackCost: P.attack.cost,
      lightRadius: 1,
    };
    this.hp = this.stats.maxHp;
    this.stamina = this.stats.maxStamina;
    this.staminaDelay = 0;
    this.invuln = 0;
    this.itemCounts = new Map();
    this.state = 'idle';
    this.stateTime = 0;
    this.comboSide = -1;
    this.walkPhase = 0;
    this.yaw = Math.PI;
    this.vel.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0.9;
    this.body.visible = true;
  }

  get alive() { return this.state !== 'dead'; }
  get forward() { return _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  isInvulnerable() {
    return this.invuln > 0 || this.state === 'dead'
      || (this.state === 'dodge' && this.stateTime < CONFIG.player.dodge.iframes + this.stats.iframeBonus);
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  spendStamina(cost) {
    if (this.stamina <= 0) {
      this.game.hud.flashStamina();
      this.game.audio.play('empty');
      return false;
    }
    this.stamina = Math.max(0, this.stamina - cost);
    this.staminaDelay = CONFIG.player.staminaDelay;
    return true;
  }

  tryAttack() {
    if (!this.spendStamina(this.stats.attackCost)) return false;
    const aim = this.game.aimPoint;
    if (Math.hypot(aim.x - this.pos.x, aim.z - this.pos.z) > 0.3) this.yaw = yawTo(this.pos, aim);
    this.comboSide *= -1;
    this.hitSet.clear();
    this.slashSpawned = false;
    this.setState('attack');
    return true;
  }

  tryDodge(move) {
    if (!this.spendStamina(this.stats.dodgeCost)) return false;
    if (move.lengthSq() > 0) this.dodgeDir.copy(move);
    else this.dodgeDir.copy(this.forward);
    this.yaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    this.setState('dodge');
    this.game.audio.play('dodge');
    this.game.particles.burst(this.pos.clone().setY(0.1), 8, () => ({
      vel: new THREE.Vector3(rand(-2, 2), rand(0.5, 2), rand(-2, 2)), life: rand(0.3, 0.6), size: rand(0.08, 0.16), color: 0x2e2a26, drag: 3,
    }));
    return true;
  }

  update(dt) {
    const P = CONFIG.player;
    const S = this.stats;
    const input = this.game.input;
    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);

    const busy = this.state === 'attack' || this.state === 'dodge';
    if (!busy && this.staminaDelay <= 0 && this.alive) {
      this.stamina = Math.min(S.maxStamina, this.stamina + S.staminaRegen * dt);
    }

    input.moveVector(_move);
    const moving = _move.lengthSq() > 0;

    switch (this.state) {
      case 'idle': {
        if (input.consume('dodge') && this.tryDodge(_move)) break;
        if (input.consume('attack') && this.tryAttack()) break;
        this.vel.x = damp(this.vel.x, _move.x * S.speed, 22, dt);
        this.vel.z = damp(this.vel.z, _move.z * S.speed, 22, dt);
        if (moving) this.yaw = dampAngle(this.yaw, Math.atan2(_move.x, _move.z), 20, dt);
        break;
      }
      case 'attack': this.updateAttack(dt); break;
      case 'dodge': this.updateDodge(dt); break;
      case 'hurt':
        this.vel.x = damp(this.vel.x, 0, 9, dt);
        this.vel.z = damp(this.vel.z, 0, 9, dt);
        if (this.stateTime > 0.22) this.setState('idle');
        break;
      case 'dead':
        this.vel.multiplyScalar(Math.exp(-6 * dt));
        break;
    }

    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = 0;
    this.game.room.resolveCollision(this.pos, this.radius, true);
    this.group.rotation.y = this.yaw;
    this.animate(dt);
  }

  attackTimings() {
    const A = CONFIG.player.attack;
    const s = this.stats.attackSpeed;
    return { windup: A.windup / s, active: A.active / s, recovery: A.recovery / s };
  }

  updateAttack(dt) {
    const A = CONFIG.player.attack;
    const { windup, active, recovery } = this.attackTimings();
    const t = this.stateTime;
    const fwd = this.forward;

    if (t < windup) {
      this.vel.x = damp(this.vel.x, fwd.x * 1.5, 25, dt);
      this.vel.z = damp(this.vel.z, fwd.z * 1.5, 25, dt);
    } else if (t < windup + active) {
      if (!this.slashSpawned) {
        this.slashSpawned = true;
        this.game.audio.play('swing');
        this.game.addEffect(new SlashArc(this.game, this, this.yaw, A.reach * this.stats.reach, A.arc, this.comboSide, active));
      }
      this.vel.set(fwd.x * A.lunge, 0, fwd.z * A.lunge);
      this.checkHits();
    } else if (t < windup + active + recovery) {
      this.vel.x = damp(this.vel.x, 0, 16, dt);
      this.vel.z = damp(this.vel.z, 0, 16, dt);
      // Late in the recovery you may roll out, or chain the next swing.
      const rk = (t - windup - active) / recovery;
      if (rk > 0.45 && this.game.input.consume('dodge')) {
        this.tryDodge(this.game.input.moveVector(_move));
        return;
      }
      if (rk > 0.55 && this.game.input.consume('attack')) {
        this.tryAttack();
        return;
      }
    } else {
      this.setState('idle');
    }
  }

  updateDodge(dt) {
    const D = CONFIG.player.dodge;
    const t = this.stateTime;
    if (t < D.duration) {
      const k = t / D.duration;
      const spd = D.speed * (1 - k * k * 0.7);
      this.vel.set(this.dodgeDir.x * spd, 0, this.dodgeDir.z * spd);
    } else if (t < D.duration + D.recovery) {
      this.vel.x = damp(this.vel.x, 0, 20, dt);
      this.vel.z = damp(this.vel.z, 0, 20, dt);
      if (this.game.input.consume('attack')) this.tryAttack();
    } else {
      this.setState('idle');
    }
  }

  checkHits() {
    const A = CONFIG.player.attack;
    const reach = A.reach * this.stats.reach;
    for (const e of this.game.room.enemies) {
      if (!e.active || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > reach) continue;
      const off = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz)));
      if (d > e.radius + 0.6 && off > A.arc / 2 + 0.15) continue;
      this.hitSet.add(e);
      const dmg = this.stats.damage * rand(0.9, 1.1);
      const dir = new THREE.Vector3(dx / (d || 1), 0, dz / (d || 1));
      e.takeDamage(dmg, dir, 7);
      this.game.onEnemyHit(e, dmg, dir);
    }
  }

  onHurt(fromPos) {
    const dir = _v.copy(this.pos).sub(fromPos).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    this.vel.set(dir.x * 9, 0, dir.z * 9);
    this.invuln = CONFIG.player.hurtIframes;
    this.setState('hurt');
  }

  die() {
    this.setState('dead');
    this.hp = 0;
  }

  animate(dt) {
    const S = this.stats;
    const t = this.game.time;
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / S.speed);
    const walking = this.state === 'idle' || this.state === 'hurt';

    this.walkPhase += dt * 12 * speedN;
    const swing = walking ? Math.sin(this.walkPhase) * 0.75 * speedN : 0;
    this.legs[0].rotation.x = damp(this.legs[0].rotation.x, swing, 25, dt);
    this.legs[1].rotation.x = damp(this.legs[1].rotation.x, -swing, 25, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, walking ? -swing * 0.6 : -0.4, 20, dt);

    // Body: tumble during dodge, lean into runs, collapse on death.
    if (this.state === 'dodge') {
      const k = Math.min(1, this.stateTime / CONFIG.player.dodge.duration);
      this.body.rotation.x = easeOut(k) * TAU;
      this.body.position.y = 0.9 - Math.sin(k * Math.PI) * 0.45;
    } else if (this.state === 'dead') {
      this.body.rotation.x = damp(this.body.rotation.x, -Math.PI / 2, 6, dt);
      this.body.position.y = damp(this.body.position.y, 0.3, 6, dt);
    } else {
      this.body.rotation.x = this.state === 'attack' ? 0.15 : speedN * 0.12;
      this.body.position.y = 0.9 + Math.abs(Math.sin(this.walkPhase)) * 0.05 * speedN;
    }

    // Sword arm choreography.
    const arm = this.swordArm;
    if (this.state === 'attack') {
      const { windup, active } = this.attackTimings();
      const side = this.comboSide;
      const t0 = this.stateTime;
      if (t0 < windup) {
        const k = t0 / windup;
        arm.rotation.y = side * -1.2 - side * 0.7 * k;
        arm.rotation.x = -0.2;
      } else if (t0 < windup + active) {
        const k = easeOut((t0 - windup) / active);
        arm.rotation.y = side * (-1.9 + 3.5 * k);
        arm.rotation.x = 0.22;
      } else {
        arm.rotation.y = damp(arm.rotation.y, side * 1.6, 10, dt);
        arm.rotation.x = damp(arm.rotation.x, 0.4, 10, dt);
      }
      this.legs[0].rotation.x = damp(this.legs[0].rotation.x, -0.45, 30, dt);
      this.legs[1].rotation.x = damp(this.legs[1].rotation.x, 0.35, 30, dt);
    } else {
      arm.rotation.y = damp(arm.rotation.y, -0.15, 12, dt);
      arm.rotation.x = damp(arm.rotation.x, 0.95 + swing * 0.15, 12, dt);
    }

    this.cape.rotation.x = 0.1 + speedN * 0.55 + Math.sin(t * 5) * 0.04;

    // Blink while recovering from a hit.
    this.body.visible = !(this.invuln > 0 && this.state !== 'dead' && Math.floor(this.invuln * 18) % 2 === 0);

    const T = CONFIG.player.torch;
    const f = 0.86 + 0.14 * flicker(t, 1.3);
    this.torch.intensity = T.intensity * f * (this.state === 'dead' ? 0.35 : 1);
    this.torch.distance = T.distance * S.lightRadius;
    this.torch.position.x = 0.55 + flicker(t * 0.7, 4) * 0.03;
    this.lanternCore.scale.setScalar(0.85 + 0.15 * f);
  }
}

// ============================================================================
// Enemies
// ============================================================================

function buildSkeletonRig(mats, { scale = 1, weapon = 'blade' } = {}) {
  const { bone, iron, eye } = mats;
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const parts = { root };
  const b = (w, h, d, m, x, y, z) => box(w, h, d, m, x, y, z, { cast: true, receive: false });

  parts.legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.15, 0.82, 0);
    leg.add(b(0.11, 0.8, 0.11, bone, 0, -0.4, 0));
    leg.add(b(0.14, 0.06, 0.24, bone, 0, -0.79, 0.05));
    root.add(leg);
    parts.legs.push(leg);
  }
  root.add(b(0.42, 0.12, 0.2, bone, 0, 0.84, 0));
  root.add(b(0.08, 0.5, 0.08, bone, 0, 1.1, -0.04));
  for (let i = 0; i < 3; i++) root.add(b(0.46 - i * 0.04, 0.06, 0.28, bone, 0, 1.18 + i * 0.12, 0));
  root.add(b(0.62, 0.08, 0.12, bone, 0, 1.49, 0));

  const head = new THREE.Group();
  head.position.set(0, 1.72, 0.02);
  head.add(b(0.34, 0.3, 0.36, bone, 0, 0, 0));
  head.add(b(0.26, 0.1, 0.28, bone, 0, -0.19, 0.02));
  for (const side of [-1, 1]) {
    head.add(b(0.1, 0.08, 0.02, mats.socket, side * 0.08, 0.01, 0.18));
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), eye);
    e.position.set(side * 0.08, 0.01, 0.192);
    head.add(e);
  }
  root.add(head);
  parts.head = head;

  parts.arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.32, 1.46, 0);
    arm.add(b(0.09, 0.72, 0.09, bone, 0, -0.36, 0));
    root.add(arm);
    parts.arms.push(arm);
  }
  // Right arm (-X) carries the weapon.
  const weaponArm = parts.arms[0];
  if (weapon === 'blade') {
    weaponArm.add(b(0.05, 0.04, 0.85, iron, 0, -0.7, 0.38));
    weaponArm.add(b(0.22, 0.05, 0.05, iron, 0, -0.7, 0.0));
  } else if (weapon === 'cleaver') {
    weaponArm.add(b(0.1, 0.1, 0.5, iron, 0, -0.7, 0.2));
    weaponArm.add(b(0.08, 0.5, 1.3, iron, 0, -0.62, 1.05));
  }
  return parts;
}

class Enemy {
  constructor(game, room, x, z, { hp, radius, mass = 1, name = 'Enemy' }) {
    this.game = game;
    this.room = room;
    this.name = name;
    const scale = game.difficulty;
    this.maxHp = this.hp = hp * scale.hp;
    this.damageMult = scale.damage;
    this.speedMult = scale.speed;
    this.radius = radius;
    this.mass = mass;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.pos = this.group.position;
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.vel = new THREE.Vector3();
    this.yaw = yawTo(this.pos, game.player.pos);
    this.state = 'spawning';
    this.stateTime = 0;
    this.spawnDuration = rand(0.7, 1.1);
    this.flash = 0;
    this.flashMaterials = [];
    this.dead = false;
    this.removed = false;
    this.chunkColor = 0xcfc6ad;
    room.group.add(this.group);
  }

  mat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...opts });
    m.userData.baseEmissive = m.emissive.clone();
    this.flashMaterials.push(m);
    return m;
  }

  get alive() { return !this.dead; }
  get active() { return !this.dead && this.state !== 'spawning'; }
  get player() { return this.game.player; }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  distToPlayer() { return Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z); }
  yawToPlayer() { return yawTo(this.pos, this.player.pos); }
  forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  steer(dirX, dirZ, speed, dt, rate = 8) {
    this.vel.x = damp(this.vel.x, dirX * speed, rate, dt);
    this.vel.z = damp(this.vel.z, dirZ * speed, rate, dt);
  }

  brake(dt, rate = 8) { this.steer(0, 0, 0, dt, rate); }

  chase(dt, speed) {
    const p = this.player.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.steer(dx / d, dz / d, speed, dt);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
  }

  /** Melee check against the player in a cone in front of the enemy. */
  strike(range, arc, damage) {
    const p = this.player;
    const d = this.distToPlayer();
    if (d - p.radius > range) return false;
    if (Math.abs(angleDiff(this.yaw, this.yawToPlayer())) > arc / 2 && d > this.radius + p.radius + 0.2) return false;
    return this.game.damagePlayer(damage * this.damageMult, this.pos, this);
  }

  takeDamage(amount, dir, knock) {
    if (this.dead) return;
    this.hp -= amount;
    this.flash = 0.09;
    this.vel.addScaledVector(dir, knock / this.mass);
    if (this.hp <= 0) this.die();
    else this.onHit();
  }

  onHit() {}

  die() {
    this.dead = true;
    this.group.visible = false;
    const c = this.pos.clone().setY(1);
    this.game.particles.burst(c, 22, () => ({
      pos: c,
      vel: new THREE.Vector3(rand(-5, 5), rand(1, 7), rand(-5, 5)),
      life: rand(1.5, 3), size: rand(0.08, 0.22), color: this.chunkColor, gravity: 18, bounce: 0.35, linger: true,
    }));
    this.game.glow.burst(c, 14, () => ({
      vel: new THREE.Vector3(rand(-3, 3), rand(0, 3), rand(-3, 3)), life: rand(0.3, 0.7), size: 0.06, color: 0xff6a30, drag: 3,
    }));
    this.game.audio.play('shatter');
    this.game.onEnemyKilled(this);
    this.removed = true;
  }

  update(dt) {
    if (this.dead) return;
    this.stateTime += dt;
    if (this.state === 'spawning') {
      const k = Math.min(1, this.stateTime / this.spawnDuration);
      this.rig.position.y = -2.4 * (1 - easeOut(k));
      this.rig.rotation.z = Math.sin(k * 20) * 0.1 * (1 - k);
      this.group.rotation.y = this.yaw = this.yawToPlayer();
      if (Math.random() < dt * 30) {
        this.game.particles.emit({
          pos: new THREE.Vector3(this.pos.x + rand(-0.5, 0.5), 0.1, this.pos.z + rand(-0.5, 0.5)),
          vel: new THREE.Vector3(rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5)), life: rand(0.5, 1), size: rand(0.06, 0.14), color: 0x2f2a25, gravity: 8, linger: true,
        });
      }
      if (k >= 1) {
        this.rig.rotation.z = 0;
        this.setState('chase');
      }
      return;
    }

    if (this.player.alive) this.think(dt);
    else this.brake(dt, 4);

    this.pos.addScaledVector(this.vel, dt);
    this.room.resolveCollision(this.pos, this.radius, false);
    // Enemies never stand inside the knight.
    const p = this.player.pos;
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    const d = Math.hypot(dx, dz), min = this.radius + this.player.radius;
    if (d < min && d > 1e-4) {
      this.pos.x = p.x + (dx / d) * min;
      this.pos.z = p.z + (dz / d) * min;
    }
    this.group.rotation.y = this.yaw;

    this.flash = Math.max(0, this.flash - dt);
    for (const m of this.flashMaterials) {
      if (this.flash > 0) m.emissive.setRGB(1, 0.9, 0.8);
      else m.emissive.copy(m.userData.baseEmissive);
    }
    this.animate(dt);
  }

  think() {}
  animate() {}
}

class Skeleton extends Enemy {
  constructor(game, room, x, z) {
    super(game, room, x, z, { hp: 32, radius: 0.5, mass: 1, name: 'Skeleton' });
    const eyeColor = 0xff2a10;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor, fog: false });
    this.parts = buildSkeletonRig({
      bone: this.mat(0xc9bfa6),
      iron: this.mat(0x3a302a, { metalness: 0.4, roughness: 0.7 }),
      socket: new THREE.MeshBasicMaterial({ color: 0x050303 }),
      eye: this.eyeMat,
    });
    this.rig.add(this.parts.root);
    this.speed = 3.7 * this.speedMult * rand(0.9, 1.1);
    this.cooldown = rand(0.3, 1);
    this.walk = rand(0, TAU);
  }

  onHit() {
    // Skeletons have no poise: every hit staggers and interrupts a windup.
    this.setState('stagger');
    this.game.audio.play('rattle');
  }

  think(dt) {
    this.cooldown -= dt;
    const d = this.distToPlayer();
    switch (this.state) {
      case 'chase':
        this.chase(dt, this.speed);
        if (d < 2.3 && this.cooldown <= 0) this.setState('windup');
        break;
      case 'windup':
        this.brake(dt, 10);
        this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 5, dt);
        if (this.stateTime > 0.5) {
          this.setState('attack');
          this.hasHit = false;
          this.game.audio.play('swing');
        }
        break;
      case 'attack': {
        const f = this.forward();
        this.vel.set(f.x * 8.5, 0, f.z * 8.5);
        if (!this.hasHit && this.stateTime > 0.06) this.hasHit = this.strike(1.7, 1.6, 14);
        if (this.stateTime > 0.22) this.setState('recover');
        break;
      }
      case 'recover':
        this.brake(dt, 10);
        if (this.stateTime > 0.65) {
          this.cooldown = rand(0.4, 1.2);
          this.setState('chase');
        }
        break;
      case 'stagger':
        this.brake(dt, 6);
        if (this.stateTime > 0.3) this.setState('chase');
        break;
    }
  }

  animate(dt) {
    const P = this.parts;
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4);
    this.walk += dt * 11 * speedN;
    const s = Math.sin(this.walk) * 0.7 * speedN;
    P.legs[0].rotation.x = s;
    P.legs[1].rotation.x = -s;
    const weaponArm = P.arms[0];
    let target = -0.3 - s * 0.4;
    let rootLean = 0.1 * speedN;
    if (this.state === 'windup') { target = -2.7; rootLean = -0.25; }
    else if (this.state === 'attack') { target = -0.8; rootLean = 0.35; }
    else if (this.state === 'recover') { target = -0.7; rootLean = 0.25; }
    else if (this.state === 'stagger') { rootLean = -0.35; }
    weaponArm.rotation.x = damp(weaponArm.rotation.x, target, this.state === 'attack' ? 40 : 14, dt);
    P.arms[1].rotation.x = damp(P.arms[1].rotation.x, s * 0.5 - 0.2, 14, dt);
    P.root.rotation.x = damp(P.root.rotation.x, rootLean, 14, dt);
    P.head.rotation.z = Math.sin(this.game.time * 3 + this.walk) * 0.08;
    const glowing = this.state === 'windup';
    this.eyeMat.color.setHex(glowing ? 0xffe0a0 : 0xff2a10);
  }
}

class Shade extends Enemy {
  constructor(game, room, x, z) {
    super(game, room, x, z, { hp: 20, radius: 0.5, mass: 0.7, name: 'Shade' });
    this.chunkColor = 0x151020;
    const robe = this.mat(0x0c0a10, { emissive: 0x160a22, transparent: true, opacity: 0.92 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8a8ff, fog: false });
    this.body = new THREE.Group();
    this.body.position.y = 0.35;
    const cloak = mesh(new THREE.ConeGeometry(0.62, 1.5, 7, 1, true), robe, { cast: true, receive: false });
    cloak.position.y = 0.75;
    this.body.add(cloak);
    const hood = mesh(new THREE.ConeGeometry(0.3, 0.55, 6), robe, { cast: true, receive: false });
    hood.position.set(0, 1.55, -0.02);
    this.body.add(hood);
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.02), this.eyeMat);
      e.position.set(side * 0.08, 1.42, 0.2);
      this.body.add(e);
    }
    this.shards = [];
    for (let i = 0; i < 3; i++) {
      const s = mesh(new THREE.TetrahedronGeometry(0.14), robe, { cast: false, receive: false });
      this.body.add(s);
      this.shards.push(s);
    }
    this.rig.add(this.body);
    this.speed = 5.2 * this.speedMult;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.nextDash = rand(1.2, 2.4);
    this.dashDir = new THREE.Vector3();
  }

  onHit() {
    if (this.state === 'telegraph') this.setState('chase');
  }

  think(dt) {
    const d = this.distToPlayer();
    const p = this.player.pos;
    switch (this.state) {
      case 'chase': {
        // Circle at a distance, then commit to a straight-line lunge.
        this.nextDash -= dt;
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
        const inv = 1 / (d || 1);
        const radial = clamp((d - 4.5) * 0.8, -1, 1);
        const tx = dx * inv * radial + -dz * inv * this.orbitDir * 0.9;
        const tz = dz * inv * radial + dx * inv * this.orbitDir * 0.9;
        const len = Math.hypot(tx, tz) || 1;
        this.steer(tx / len, tz / len, this.speed, dt, 5);
        this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 8, dt);
        if (this.nextDash <= 0 && d < 9) {
          this.setState('telegraph');
          this.game.audio.play('shriek');
        }
        break;
      }
      case 'telegraph':
        this.brake(dt, 8);
        this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 12, dt);
        if (this.stateTime > 0.55) {
          this.dashDir.copy(this.forward());
          this.hasHit = false;
          this.setState('dash');
        }
        break;
      case 'dash':
        this.vel.set(this.dashDir.x * 16, 0, this.dashDir.z * 16);
        if (!this.hasHit && d < this.radius + this.player.radius + 0.35) {
          this.hasHit = this.game.damagePlayer(12 * this.damageMult, this.pos, this);
        }
        if (this.stateTime > 0.4) this.setState('recover');
        break;
      case 'recover':
        this.brake(dt, 4);
        if (this.stateTime > 0.7) {
          this.nextDash = rand(1.4, 2.8);
          this.orbitDir *= Math.random() < 0.4 ? -1 : 1;
          this.setState('chase');
        }
        break;
    }
  }

  animate(dt) {
    const t = this.game.time;
    const shiver = this.state === 'telegraph' ? Math.sin(t * 90) * 0.06 : 0;
    this.body.position.y = 0.35 + Math.sin(t * 2.5 + this.orbitDir) * 0.12;
    this.body.position.x = shiver;
    this.body.rotation.x = this.state === 'dash' ? 0.6 : 0.15;
    this.shards.forEach((s, i) => {
      const a = t * 2.4 + (i * TAU) / 3;
      s.position.set(Math.cos(a) * 0.75, 0.9 + Math.sin(a * 1.3) * 0.25, Math.sin(a) * 0.75);
      s.rotation.set(a, a * 0.7, 0);
    });
    this.eyeMat.color.setHex(this.state === 'telegraph' ? 0xffffff : 0xc8a8ff);
    if (Math.random() < dt * (this.state === 'dash' ? 60 : 12)) {
      this.game.particles.emit({
        pos: new THREE.Vector3(this.pos.x + rand(-0.4, 0.4), rand(0.3, 1.2), this.pos.z + rand(-0.4, 0.4)),
        vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.4, 1.1), rand(-0.3, 0.3)), life: rand(0.5, 1), size: rand(0.08, 0.18), color: 0x0e0a14,
      });
    }
  }
}

/** Floor guardian: heavy, telegraphed attacks and poise that must be broken. */
class Warden extends Enemy {
  constructor(game, room, x, z, name) {
    super(game, room, x, z, { hp: 260, radius: 1.0, mass: 5, name });
    this.chunkColor = 0x9a927e;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, fog: false });
    const iron = this.mat(0x26262b, { metalness: 0.5, roughness: 0.6 });
    this.parts = buildSkeletonRig({
      bone: this.mat(0xb3aa92),
      iron,
      socket: new THREE.MeshBasicMaterial({ color: 0x050303 }),
      eye: this.eyeMat,
    }, { scale: 1.65, weapon: 'cleaver' });
    const r = this.parts.root;
    r.add(box(0.7, 0.55, 0.45, iron, 0, 1.28, 0));
    for (const side of [-1, 1]) {
      const pauldron = box(0.34, 0.2, 0.44, iron, side * 0.38, 1.54, 0);
      pauldron.rotation.z = side * -0.3;
      r.add(pauldron);
      const horn = mesh(new THREE.ConeGeometry(0.06, 0.4, 5), this.mat(0x2a2218));
      horn.position.set(side * 0.2, 0.22, 0);
      horn.rotation.z = side * -0.5;
      this.parts.head.add(horn);
    }
    this.rig.add(r);
    this.speed = 2.5 * this.speedMult;
    this.poiseMax = 75;
    this.poise = this.poiseMax;
    this.cooldown = 1;
    this.walk = 0;
    this.attackTarget = new THREE.Vector3();
  }

  onHit() {
    this.poise -= this.game.player.stats.damage;
    if (this.poise <= 0) {
      this.poise = this.poiseMax;
      if (this.telegraph) this.telegraph.cancel();
      this.setState('stagger');
      this.game.audio.play('rattle');
      this.game.cameraRig.shake(0.3);
    }
  }

  think(dt) {
    this.cooldown -= dt;
    const d = this.distToPlayer();
    switch (this.state) {
      case 'chase':
        this.chase(dt, this.speed);
        if (this.cooldown <= 0) {
          if (d < 3.6) this.beginAttack(Math.random() < 0.6 ? 'sweep' : 'slam');
          else if (d < 7.5 && Math.random() < 0.5) this.beginAttack('slam');
        }
        break;
      case 'windup':
        this.brake(dt, 10);
        if (this.attack === 'sweep') {
          this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 2.5, dt);
          if (this.telegraph) this.telegraph.group.rotation.y = this.yaw;
        }
        if (this.stateTime >= this.windupTime) this.releaseAttack();
        break;
      case 'recover':
        this.brake(dt, 6);
        if (this.stateTime > 0.9) {
          this.cooldown = rand(0.6, 1.4);
          this.setState('chase');
        }
        break;
      case 'stagger':
        this.brake(dt, 5);
        if (this.stateTime > 1.1) this.setState('chase');
        break;
    }
  }

  beginAttack(kind) {
    this.attack = kind;
    this.setState('windup');
    if (kind === 'slam') {
      this.windupTime = 0.95;
      const p = this.player.pos;
      this.attackTarget.set(p.x + this.player.vel.x * 0.25, 0, p.z + this.player.vel.z * 0.25);
      this.yaw = yawTo(this.pos, this.attackTarget);
      this.telegraph = new GroundTelegraph(this.game, this.attackTarget.x, this.attackTarget.z, 2.8, this.windupTime);
    } else {
      this.windupTime = 0.65;
      this.yaw = this.yawToPlayer();
      this.telegraph = new GroundTelegraph(this.game, this.pos.x, this.pos.z, 4, this.windupTime, { arc: Math.PI * 1.3, yaw: this.yaw });
    }
    this.game.addEffect(this.telegraph);
  }

  releaseAttack() {
    const g = this.game;
    if (this.attack === 'slam') {
      const p = this.player.pos;
      if (Math.hypot(p.x - this.attackTarget.x, p.z - this.attackTarget.z) < 2.8 + this.player.radius * 0.5) {
        g.damagePlayer(26 * this.damageMult, this.attackTarget, this);
      }
      g.audio.play('boss-slam');
      g.cameraRig.shake(0.7);
      g.particles.burst(this.attackTarget.clone().setY(0.1), 40, (i) => {
        const a = (i / 40) * TAU;
        return { vel: new THREE.Vector3(Math.cos(a) * rand(3, 7), rand(1, 4), Math.sin(a) * rand(3, 7)), life: rand(0.6, 1.4), size: rand(0.1, 0.25), color: 0x2f2a25, gravity: 12, linger: true };
      });
    } else {
      this.strike(4 + this.player.radius, Math.PI * 1.3, 18);
      g.audio.play('swing');
      g.cameraRig.shake(0.35);
    }
    this.telegraph = null;
    this.setState('recover');
  }

  die() {
    super.die();
    this.game.hud.hideBoss();
    this.game.cameraRig.shake(1);
  }

  animate(dt) {
    const P = this.parts;
    const speedN = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 2.5);
    this.walk += dt * 6 * speedN;
    const s = Math.sin(this.walk) * 0.5 * speedN;
    P.legs[0].rotation.x = s;
    P.legs[1].rotation.x = -s;
    let armX = -0.4, armY = 0, lean = 0.1;
    if (this.state === 'windup') {
      const k = Math.min(1, this.stateTime / this.windupTime);
      if (this.attack === 'slam') { armX = -3.0 * k; lean = -0.3 * k; }
      else { armX = -1.4; armY = -1.6 * k; lean = -0.1; }
    } else if (this.state === 'recover') {
      if (this.attack === 'slam') { armX = -1.2; lean = 0.45; }
      else { armX = -1.4; armY = 1.6; lean = 0.1; }
    } else if (this.state === 'stagger') {
      armX = 0.3; lean = -0.4;
    }
    const arm = P.arms[0];
    arm.rotation.order = 'YXZ';
    arm.rotation.x = damp(arm.rotation.x, armX, this.state === 'recover' ? 30 : 10, dt);
    arm.rotation.y = damp(arm.rotation.y, armY, this.state === 'recover' ? 30 : 10, dt);
    P.arms[1].rotation.x = damp(P.arms[1].rotation.x, -s * 0.4, 10, dt);
    P.root.rotation.x = damp(P.root.rotation.x, lean, 10, dt);
    const hot = this.state === 'windup';
    this.eyeMat.color.setHex(hot ? 0xffe6b0 : 0xff7a1a);
  }
}

// ============================================================================
// Rooms
// ============================================================================

const PILLAR_LAYOUTS = [
  [],
  [[-6.5, -3.5], [6.5, -3.5], [-6.5, 3.5], [6.5, 3.5]],
  [[-9, -4], [-4.5, -4], [4.5, -4], [9, -4], [-9, 4], [-4.5, 4], [4.5, 4], [9, 4]],
  [[-4.5, -2.8], [4.5, -2.8], [-4.5, 2.8], [4.5, 2.8], [-9.5, 0], [9.5, 0]],
  [[-8, -3], [8, 3], [-3.5, 4], [3.5, -4]],
  [[-6, 0], [6, 0]],
];

class Door {
  constructor(room, dir, leadsTo) {
    const R = CONFIG.room;
    const M = room.game.materials;
    this.dir = dir;
    this.progress = 1;
    this.target = 1;
    this.height = dir === 's' ? R.southWallHeight : R.wallHeight * 0.74;
    this.group = new THREE.Group();
    const off = 0.05;
    const place = {
      n: [0, -R.depth / 2 - off, 0],
      s: [0, R.depth / 2 + off, Math.PI],
      e: [R.width / 2 + off, 0, -Math.PI / 2],
      w: [-R.width / 2 - off, 0, Math.PI / 2],
    }[dir];
    this.group.position.set(place[0], 0, place[1]);
    this.group.rotation.y = place[2];

    const h = this.height;
    const postH = dir === 's' ? h + 0.3 : h + 0.5;
    for (const side of [-1, 1]) this.group.add(box(0.55, postH, 1.5, M.trim, side * (R.doorWidth / 2 + 0.27), postH / 2, 0.2));
    if (dir !== 's') {
      this.group.add(box(R.doorWidth + 1.1, 0.6, 1.5, M.trim, 0, h + 0.3, 0.2));
      // Rune above the arch hints at what lies beyond.
      const runeColor = leadsTo.type === 'boss' ? 0xff2a14 : leadsTo.type === 'treasure' ? 0xffc050 : null;
      if (runeColor) {
        const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: runeColor, fog: false }));
        rune.position.set(0, h + 0.3, 0.98);
        this.group.add(rune);
      }
    }

    this.bars = new THREE.Group();
    const barCount = 8;
    for (let i = 0; i < barCount; i++) {
      const x = -R.doorWidth / 2 + 0.2 + (i * (R.doorWidth - 0.4)) / (barCount - 1);
      this.bars.add(box(0.1, h, 0.1, M.iron, x, h / 2, 0));
    }
    for (const y of [h * 0.3, h * 0.75]) this.bars.add(box(R.doorWidth, 0.1, 0.12, M.iron, 0, y, 0));
    this.group.add(this.bars);
    this.setProgress(1);
    room.group.add(this.group);
  }

  get isOpen() { return this.progress > 0.9; }

  setOpen(open) { this.target = open ? 1 : 0; }

  setProgress(p) {
    this.progress = p;
    this.bars.position.y = -p * (this.height + 0.15);
    this.bars.visible = p < 0.999;
  }

  update(dt) {
    if (this.progress === this.target) return;
    const speed = this.target > this.progress ? 0.9 : 5;
    const p = this.target > this.progress
      ? Math.min(this.target, this.progress + speed * dt)
      : Math.max(this.target, this.progress - speed * dt);
    this.setProgress(p);
  }
}

class Room {
  constructor(game, floor, gx, gy, type) {
    this.game = game;
    this.floor = floor;
    this.gx = gx;
    this.gy = gy;
    this.type = type;
    this.neighbors = { n: null, s: null, e: null, w: null };
    this.state = type === 'combat' || type === 'boss' ? RoomState.DORMANT : RoomState.CLEARED;
    this.visited = false;
    this.seen = false;
    this.built = false;
    this.doors = {};
    this.obstacles = [];
    this.enemies = [];
    this.braziers = [];
    this.pedestal = null;
    this.descent = null;
    this.stateTime = 0;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const game = this.game;
    const M = game.materials;
    const R = CONFIG.room;
    const W = R.width, D = R.depth, H = R.wallHeight, T = R.wallThickness, DW = R.doorWidth;
    const g = (this.group = new THREE.Group());
    g.visible = false;
    game.scene.add(g);

    const floorGeo = scaleUV(new THREE.PlaneGeometry(W + 2 * T, D + 2 * T), (W + 2 * T) / 8, (D + 2 * T) / 8).rotateX(-Math.PI / 2);
    g.add(mesh(floorGeo, M.floor, { cast: false, receive: true }));

    // Walls, leaving gaps for doors. The south wall is kept low so it never hides the knight.
    const addWall = (x, y, z, w, h, d) => {
      const m = mesh(worldBoxGeometry(w, h, d), M.wall);
      m.position.set(x, y, z);
      g.add(m);
    };
    const doorH = H * 0.74;
    const horizontal = (dir, z, h) => {
      const full = W + 2 * T;
      if (this.neighbors[dir]) {
        const seg = (full - DW) / 2;
        addWall(-(DW / 2 + seg / 2), h / 2, z, seg, h, T);
        addWall(DW / 2 + seg / 2, h / 2, z, seg, h, T);
        if (dir !== 's') addWall(0, (doorH + h) / 2, z, DW, h - doorH, T);
      } else addWall(0, h / 2, z, full, h, T);
    };
    const vertical = (dir, x) => {
      if (this.neighbors[dir]) {
        const seg = (D - DW) / 2;
        addWall(x, H / 2, -(DW / 2 + seg / 2), T, H, seg);
        addWall(x, H / 2, DW / 2 + seg / 2, T, H, seg);
        addWall(x, (doorH + H) / 2, 0, T, H - doorH, DW);
      } else addWall(x, H / 2, 0, T, H, D);
    };
    horizontal('n', -D / 2 - T / 2, H);
    horizontal('s', D / 2 + T / 2, R.southWallHeight);
    vertical('e', W / 2 + T / 2);
    vertical('w', -W / 2 - T / 2);

    // Gothic buttresses and pointed niches along the back wall.
    for (let x = -W / 2 + 2.2; x <= W / 2 - 2; x += 4.4) {
      if (this.neighbors.n && Math.abs(x) < DW) continue;
      g.add(box(0.7, H + 0.4, R.inset + 0.2, M.trim, x, (H + 0.4) / 2, -D / 2 + R.inset / 2 - 0.1));
    }
    for (let x = -W / 2 + 4.4; x < W / 2 - 3; x += 4.4) {
      if (this.neighbors.n && Math.abs(x) < DW + 1) continue;
      g.add(box(1.1, 2.0, 0.08, M.void, x, 2.1, -D / 2 + 0.04, { cast: false, receive: false }));
      const arch = box(0.78, 0.78, 0.08, M.void, x, 3.1, -D / 2 + 0.04, { cast: false, receive: false });
      arch.rotation.z = Math.PI / 4;
      g.add(arch);
      g.add(box(1.3, 0.1, 0.45, M.trim, x, 1.1, -D / 2 + 0.22));
      if (Math.random() < 0.5) this.addCandles(g, x, 1.15, -D / 2 + 0.25, 2);
      else if (Math.random() < 0.5) this.addSkull(g, x, 1.15, -D / 2 + 0.3);
    }
    for (const x of [-W / 2, W / 2]) {
      for (let z = -D / 2 + 2.6; z <= D / 2 - 2; z += 4.4) {
        if (this.neighbors[x < 0 ? 'w' : 'e'] && Math.abs(z) < DW) continue;
        g.add(box(R.inset + 0.2, H + 0.4, 0.7, M.trim, x + Math.sign(-x) * (R.inset / 2 - 0.1), (H + 0.4) / 2, z));
      }
    }

    // Doors and the dark passage floor beyond each one.
    for (const dir of Object.keys(DIRS)) {
      const n = this.neighbors[dir];
      if (!n) continue;
      this.doors[dir] = new Door(this, dir, n);
      const sideways = dir === 'e' || dir === 'w';
      const pw = sideways ? 5 : DW, pd = sideways ? DW : 5;
      const px = dir === 'e' ? W / 2 + T + 2.5 : dir === 'w' ? -W / 2 - T - 2.5 : 0;
      const pz = dir === 's' ? D / 2 + T + 2.5 : dir === 'n' ? -D / 2 - T - 2.5 : 0;
      const pass = mesh(scaleUV(new THREE.PlaneGeometry(pw, pd), pw / 8, pd / 8).rotateX(-Math.PI / 2), M.floor, { cast: false, receive: true });
      pass.position.set(px, 0, pz);
      g.add(pass);
    }

    if (this.type !== 'start') this.addPillars(g);
    this.addDecor(g);

    const brazierCount = this.type === 'boss' ? 2 : this.type === 'start' ? 2 : randInt(0, 2);
    const corners = shuffle([[-W / 2 + 1.6, -D / 2 + 1.6], [W / 2 - 1.6, -D / 2 + 1.6], [-W / 2 + 1.6, D / 2 - 1.6], [W / 2 - 1.6, D / 2 - 1.6]]);
    if (this.type === 'boss' || this.type === 'start') corners.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < brazierCount; i++) this.addBrazier(g, ...corners[i]);

    if (this.type === 'treasure') this.pedestal = new Pedestal(this, rollItem(game.player), 0, 0, true);
    if (this.type === 'start') this.addStartSigil(g);
  }

  addPillars(g) {
    const M = this.game.materials;
    const H = CONFIG.room.wallHeight;
    const layout = this.type === 'boss' ? PILLAR_LAYOUTS[1] : pick(PILLAR_LAYOUTS);
    const mirror = Math.random() < 0.5 ? -1 : 1;
    for (const [lx, lz] of layout) {
      const x = lx * mirror, z = lz;
      const broken = Math.random() < 0.2;
      const shaftH = broken ? rand(1.2, 2.4) : H - 1.4;
      g.add(box(1.5, 0.5, 1.5, M.trim, x, 0.25, z));
      const shaft = mesh(scaleUV(new THREE.CylinderGeometry(0.52, 0.58, shaftH, 8), 3.4 / 4, shaftH / 4), M.pillar);
      shaft.position.set(x, 0.5 + shaftH / 2, z);
      g.add(shaft);
      if (broken) {
        for (let i = 0; i < 4; i++) {
          const rubble = box(rand(0.3, 0.6), rand(0.2, 0.4), rand(0.3, 0.6), M.pillar, x + rand(-1.4, 1.4), 0.15, z + rand(-1.4, 1.4));
          rubble.rotation.set(rand(0, 1), rand(0, 3), rand(0, 1));
          g.add(rubble);
        }
      } else {
        g.add(box(1.25, 0.35, 1.25, M.trim, x, 0.5 + shaftH + 0.17, z));
      }
      this.obstacles.push({ x, z, r: 0.8 });
    }
  }

  addDecor(g) {
    const M = this.game.materials;
    const R = CONFIG.room;
    const freeSpot = (margin = 1.5) => {
      for (let i = 0; i < 20; i++) {
        const x = rand(-R.width / 2 + 1, R.width / 2 - 1);
        const z = rand(-R.depth / 2 + 1, R.depth / 2 - 1);
        if (Math.hypot(x, z) < 2.5) continue;
        if (this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + margin)) continue;
        return [x, z];
      }
      return null;
    };
    for (let i = 0; i < randInt(2, 5); i++) {
      const s = freeSpot(0.5);
      if (!s) continue;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(rand(0.5, 1.3), 9).rotateX(-Math.PI / 2), M.blood);
      pool.position.set(s[0], 0.012, s[1]);
      pool.scale.x = rand(0.7, 1.4);
      pool.receiveShadow = true;
      g.add(pool);
    }
    for (let i = 0; i < randInt(3, 7); i++) {
      const s = freeSpot(0.5);
      if (!s) continue;
      for (let j = 0; j < randInt(2, 5); j++) {
        const bone = box(rand(0.35, 0.6), 0.07, 0.08, M.bone, s[0] + rand(-0.5, 0.5), 0.04, s[1] + rand(-0.5, 0.5), { cast: false, receive: true });
        bone.rotation.y = rand(0, TAU);
        g.add(bone);
      }
      if (Math.random() < 0.5) this.addSkull(g, s[0], 0.13, s[1]);
    }
    for (let i = 0; i < randInt(1, 3); i++) {
      const s = freeSpot(0.8);
      if (s) this.addCandles(g, s[0], 0, s[1], randInt(3, 6));
    }
  }

  addSkull(g, x, y, z) {
    const M = this.game.materials;
    const skull = new THREE.Group();
    skull.add(box(0.26, 0.22, 0.28, M.bone, 0, 0, 0));
    for (const side of [-1, 1]) skull.add(box(0.07, 0.06, 0.02, M.void, side * 0.06, 0.01, 0.14, { cast: false, receive: false }));
    skull.position.set(x, y, z);
    skull.rotation.y = rand(-0.6, 0.6);
    g.add(skull);
  }

  addCandles(g, x, y, z, count) {
    const M = this.game.materials;
    for (let i = 0; i < count; i++) {
      const h = rand(0.15, 0.45);
      const cx = x + rand(-0.35, 0.35), cz = z + rand(-0.25, 0.25);
      g.add(box(0.08, h, 0.08, M.wax, cx, y + h / 2, cz, { cast: false, receive: true }));
      const flame = new THREE.Mesh(this.game.flameGeo, M.flame);
      flame.position.set(cx, y + h + 0.06, cz);
      flame.userData.seed = rand(0, 100);
      g.add(flame);
      (this.flames ||= []).push(flame);
    }
  }

  addBrazier(g, x, z) {
    const M = this.game.materials;
    const b = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const leg = box(0.08, 1.0, 0.08, M.iron, Math.cos(a) * 0.35, 0.5, Math.sin(a) * 0.35);
      leg.rotation.z = Math.cos(a) * 0.15;
      b.add(leg);
    }
    const bowl = mesh(new THREE.CylinderGeometry(0.6, 0.35, 0.35, 8), M.iron);
    bowl.position.y = 1.1;
    b.add(bowl);
    const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 8), M.flame);
    coals.position.y = 1.26;
    b.add(coals);
    b.position.set(x, 0, z);
    g.add(b);
    this.obstacles.push({ x, z, r: 0.7 });
    this.braziers.push(new THREE.Vector3(x, 1.9, z));
  }

  addStartSigil(g) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x5a3a1a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.25, 32).rotateX(-Math.PI / 2), mat);
    ring.position.y = 0.02;
    g.add(ring);
    const tri = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.32, 3).rotateX(-Math.PI / 2), mat);
    tri.position.y = 0.02;
    g.add(tri);
  }

  // ---- State machine -------------------------------------------------------

  enter() {
    this.visited = true;
    this.seen = true;
    for (const n of Object.values(this.neighbors)) if (n) n.seen = true;
    this.group.visible = true;
    if (this.state === RoomState.DORMANT) {
      this.state = RoomState.SEALING;
      this.stateTime = 0;
      this.sealed = false;
    }
  }

  exit() {
    this.group.visible = false;
  }

  seal() {
    this.sealed = true;
    for (const d of Object.values(this.doors)) d.setOpen(false);
    this.game.audio.play('slam');
    this.game.cameraRig.shake(0.35);
    this.spawnEnemies();
    if (this.type === 'boss') this.game.hud.banner(this.enemies[0].name, 'warn', 2.4);
  }

  spawnEnemies() {
    const game = this.game;
    const depth = game.depth;
    const R = CONFIG.room;
    const spot = (minDist) => {
      for (let i = 0; i < 40; i++) {
        const x = rand(-R.width / 2 + 2, R.width / 2 - 2);
        const z = rand(-R.depth / 2 + 2, R.depth / 2 - 2);
        if (Math.hypot(x - game.player.pos.x, z - game.player.pos.z) < minDist) continue;
        if (this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.2)) continue;
        if (this.enemies.some((e) => e.pos.distanceTo(new THREE.Vector3(x, 0, z)) < 1.6)) continue;
        return [x, z];
      }
      return [0, 0];
    };
    if (this.type === 'boss') {
      const [x, z] = [0, game.player.pos.z > 0 ? -3 : 3];
      const boss = new Warden(game, this, x, z, FLOOR_THEMES[(depth - 1) % FLOOR_THEMES.length].boss);
      this.enemies.push(boss);
      game.hud.showBoss(boss);
      for (let i = 0; i < Math.min(depth, 4); i++) this.enemies.push(new Skeleton(game, this, ...spot(6)));
      return;
    }
    const count = Math.min(8, 2 + depth + randInt(0, 2));
    const shadeChance = Math.min(0.5, 0.22 + depth * 0.07);
    for (let i = 0; i < count; i++) {
      const Kind = Math.random() < shadeChance ? Shade : Skeleton;
      this.enemies.push(new Kind(game, this, ...spot(6.5)));
    }
  }

  onCleared() {
    const game = this.game;
    this.state = RoomState.CLEARED;
    for (const d of Object.values(this.doors)) d.setOpen(true);
    game.audio.play('open');
    game.slowmo = 0.7;
    game.cameraRig.shake(0.2);
    const R = CONFIG.room;
    for (const dir of Object.keys(this.doors)) {
      const p = new THREE.Vector3(
        dir === 'e' ? R.width / 2 : dir === 'w' ? -R.width / 2 : 0, 1.2,
        dir === 's' ? R.depth / 2 : dir === 'n' ? -R.depth / 2 : 0);
      game.glow.burst(p, 24, () => ({
        vel: new THREE.Vector3(rand(-2, 2), rand(0.5, 3), rand(-2, 2)), life: rand(0.8, 1.6), size: rand(0.05, 0.12), color: 0xffd08a, drag: 1.5,
      }));
    }
    if (this.type === 'boss') {
      game.hud.banner('GUARDIAN FELLED', '', 3.2);
      this.pedestal = new Pedestal(this, rollItem(game.player), 0, 1.5);
      this.descent = new Descent(this, 0, -4.2);
    } else {
      game.hud.banner('CHAMBER PURGED', '', 2.2);
      this.pedestal = new Pedestal(this, rollItem(game.player), 0, 0);
    }
  }

  update(dt) {
    this.stateTime += dt;
    for (const d of Object.values(this.doors)) d.update(dt);

    if (this.state === RoomState.SEALING) {
      if (!this.sealed && this.stateTime > 0.3) this.seal();
      if (this.sealed && Object.values(this.doors).every((d) => d.progress === 0)) this.state = RoomState.COMBAT;
    }

    for (const e of this.enemies) e.update(dt);
    this.separateEnemies();
    this.enemies = this.enemies.filter((e) => !e.removed);

    if (this.state === RoomState.COMBAT && this.enemies.length === 0) this.onCleared();

    this.pedestal?.update(dt);
    this.descent?.update(dt);

    const t = this.game.time;
    if (this.flames) for (const f of this.flames) f.scale.set(1, 0.8 + 0.35 * flicker(t * 1.5, f.userData.seed), 1);
    for (const b of this.braziers) {
      if (Math.random() < dt * 22) {
        this.game.glow.emit({
          pos: new THREE.Vector3(b.x + rand(-0.3, 0.3), 1.35, b.z + rand(-0.3, 0.3)),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.2, 2.6), rand(-0.3, 0.3)), life: rand(0.4, 0.9), size: rand(0.06, 0.14), color: pick([0xff8a2a, 0xffb040, 0xff5a1a]),
        });
      }
    }
  }

  separateEnemies() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.active) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.active) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) / d;
        const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
        a.pos.x -= dx * push * wa; a.pos.z -= dz * push * wa;
        b.pos.x += dx * push * wb; b.pos.z += dz * push * wb;
      }
    }
  }

  /** Clamp a circle to the chamber, letting the player through open doorways. */
  resolveCollision(pos, r, isPlayer) {
    const R = CONFIG.room;
    const hw = R.width / 2 - R.inset - r;
    const hd = R.depth / 2 - R.inset - r;
    const lane = R.doorWidth / 2 - r;
    const canPass = (dir) => isPlayer && this.doors[dir]?.isOpen;

    if (Math.abs(pos.x) <= lane && (pos.z < -hd ? canPass('n') : pos.z > hd ? canPass('s') : false)) {
      pos.x = clamp(pos.x, -lane, lane);
    } else if (Math.abs(pos.z) <= lane && (pos.x < -hw ? canPass('w') : pos.x > hw ? canPass('e') : false)) {
      pos.z = clamp(pos.z, -lane, lane);
    } else {
      pos.x = clamp(pos.x, -hw, hw);
      pos.z = clamp(pos.z, -hd, hd);
    }

    for (const o of this.obstacles) {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.hypot(dx, dz), min = o.r + r;
      if (d < min && d > 1e-4) {
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
      }
    }
  }
}

// ============================================================================
// Dungeon floor — Isaac-style grid layout
// ============================================================================

class DungeonFloor {
  constructor(game, depth) {
    this.game = game;
    this.depth = depth;
    this.rooms = new Map();
    this.generate();
  }

  key(x, y) { return `${x},${y}`; }
  get(x, y) { return this.rooms.get(this.key(x, y)); }

  generate() {
    const target = Math.min(7 + this.depth * 2, 15);
    for (let attempt = 0; attempt < 200; attempt++) {
      const cells = new Map([[this.key(0, 0), [0, 0]]]);
      const queue = [[0, 0]];
      for (let guard = 0; queue.length && cells.size < target && guard < 500; guard++) {
        const [cx, cy] = queue.shift();
        for (const dir of shuffle(Object.keys(DIRS))) {
          const nx = cx + DIRS[dir].dx, ny = cy + DIRS[dir].dy;
          const k = this.key(nx, ny);
          if (cells.has(k) || cells.size >= target || Math.random() < 0.45) continue;
          // Reject cells that would touch more than one existing room — keeps the map branchy.
          const touching = Object.values(DIRS).filter((d) => cells.has(this.key(nx + d.dx, ny + d.dy))).length;
          if (touching > 1) continue;
          cells.set(k, [nx, ny]);
          queue.push([nx, ny]);
        }
        if (!queue.length && cells.size < target) queue.push(pick([...cells.values()]));
      }
      if (cells.size < target) continue;

      const neighborCount = ([x, y]) => Object.values(DIRS).filter((d) => cells.has(this.key(x + d.dx, y + d.dy))).length;
      const deadEnds = [...cells.values()].filter((c) => (c[0] || c[1]) && neighborCount(c) === 1);
      if (deadEnds.length < 2) continue;

      const dist = this.distances(cells);
      deadEnds.sort((a, b) => dist.get(this.key(...b)) - dist.get(this.key(...a)));
      const boss = deadEnds[0];
      if (dist.get(this.key(...boss)) < 3) continue;
      const treasure = deadEnds[1 + Math.floor(Math.random() * (deadEnds.length - 1))];

      for (const [x, y] of cells.values()) {
        let type = 'combat';
        if (x === 0 && y === 0) type = 'start';
        else if (x === boss[0] && y === boss[1]) type = 'boss';
        else if (x === treasure[0] && y === treasure[1]) type = 'treasure';
        this.rooms.set(this.key(x, y), new Room(this.game, this, x, y, type));
      }
      for (const room of this.rooms.values()) {
        for (const [dir, d] of Object.entries(DIRS)) room.neighbors[dir] = this.get(room.gx + d.dx, room.gy + d.dy) || null;
      }
      this.start = this.get(0, 0);
      return;
    }
    throw new Error('Failed to generate dungeon floor');
  }

  distances(cells) {
    const dist = new Map([[this.key(0, 0), 0]]);
    const q = [[0, 0]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const d of Object.values(DIRS)) {
        const k = this.key(x + d.dx, y + d.dy);
        if (cells.has(k) && !dist.has(k)) {
          dist.set(k, dist.get(this.key(x, y)) + 1);
          q.push([x + d.dx, y + d.dy]);
        }
      }
    }
    return dist;
  }

  dispose() {
    for (const room of this.rooms.values()) {
      if (!room.group) continue;
      this.game.scene.remove(room.group);
      room.group.traverse((o) => {
        if (o.isMesh && o.geometry !== this.game.flameGeo) o.geometry.dispose();
      });
    }
  }
}

// ============================================================================
// HUD
// ============================================================================

class HUD {
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
    this.bossFill = $('#boss .fill');
    this.bossTrail = $('#boss .trail');
    this.bannerEl = $('#banner');
    this.bannerText = $('#banner .banner-text');
    this.itemBanner = $('#item-banner');
    this.minimap = $('#minimap');
    this.mctx = this.minimap.getContext('2d');
    this.trail = 1;
    this.trailDelay = 0;
    this.lastHp = 1;
    this.boss = null;
    this.bossTrailValue = 1;
    this.bannerTimer = 0;
    this.itemTimer = 0;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setFloor(depth, name) {
    this.floorNum.textContent = toRoman(depth);
    this.floorName.textContent = name;
  }

  flashStamina() {
    this.stBar.classList.remove('drained');
    void this.stBar.offsetWidth;
    this.stBar.classList.add('drained');
  }

  banner(text, cls = '', duration = 2) {
    this.bannerText.textContent = text;
    this.bannerEl.className = `show ${cls}`;
    this.bannerTimer = duration;
  }

  showItem(item) {
    const hex = `#${item.color.toString(16).padStart(6, '0')}`;
    this.itemBanner.querySelector('.item-name').textContent = item.name;
    this.itemBanner.querySelector('.item-name').style.color = hex;
    this.itemBanner.querySelector('.item-desc').textContent = item.desc;
    this.itemBanner.querySelector('.item-lore').textContent = item.lore;
    this.itemBanner.classList.add('show');
    this.itemTimer = 3.2;
  }

  renderRelics(player) {
    this.relics.innerHTML = '';
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

    if (this.boss) {
      const b = clamp(this.boss.hp / this.boss.maxHp, 0, 1);
      this.bossTrailValue = damp(this.bossTrailValue, b, 3, dt);
      this.bossFill.style.transform = `scaleX(${b})`;
      this.bossTrail.style.transform = `scaleX(${Math.max(b, this.bossTrailValue)})`;
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
    if (this.itemTimer > 0) {
      this.itemTimer -= dt;
      if (this.itemTimer <= 0) this.itemBanner.classList.remove('show');
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
      ctx.fillStyle = room === current ? '#d8cfb8' : room.visited ? '#5d564d' : '#221f1c';
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = room.visited ? '#8a8272' : '#4a443c';
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      const icon = room.type === 'boss' ? '#c42a1f' : room.type === 'treasure' ? '#c9a45c' : null;
      if (icon) {
        ctx.fillStyle = icon;
        ctx.fillRect(x + cw / 2 - 3, y + ch / 2 - 3, 6, 6);
      }
    }
  }
}

// ============================================================================
// Camera rig — tight, slightly leading follow cam with trauma-based shake.
// ============================================================================

class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.focus = new THREE.Vector3();
    this.trauma = 0;
    this.t = 0;
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  snap(target) {
    this.focus.copy(target);
    this.apply();
  }

  update(dt, player, aim) {
    const C = CONFIG.camera;
    this.t += dt;
    const lead = _v.set(aim.x - player.pos.x, 0, aim.z - player.pos.z).multiplyScalar(C.aimLead);
    if (lead.length() > C.maxLead) lead.setLength(C.maxLead);
    const tx = player.pos.x + lead.x, tz = player.pos.z + lead.z;
    this.focus.x = damp(this.focus.x, tx, C.stiffness, dt);
    this.focus.z = damp(this.focus.z, tz, C.stiffness, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.apply();
  }

  apply() {
    const C = CONFIG.camera;
    const s = this.trauma * this.trauma * 0.6;
    const t = this.t * 40;
    this.camera.position.set(
      this.focus.x + C.offset.x + Math.sin(t * 1.1) * s,
      this.focus.y + C.offset.y + Math.sin(t * 1.7 + 2) * s * 0.5,
      this.focus.z + C.offset.z + Math.sin(t * 1.3 + 4) * s);
    this.camera.lookAt(this.focus.x, 0.8, this.focus.z);
  }
}

// ============================================================================
// Game — owns the loop and the high-level state machine.
// ============================================================================

class Game {
  constructor() {
    this.state = 'title';
    this.time = 0;
    this.depth = 1;
    this.hitstop = 0;
    this.slowmo = 0;
    this.hurtFlash = 0;
    this.fade = 1;
    this.transition = null;
    this.effects = [];
    this.aimPoint = new THREE.Vector3();

    this.initRenderer();
    this.initMaterials();
    this.audio = new AudioEngine();
    this.input = new Input();
    this.hud = new HUD();
    this.cameraRig = new CameraRig(this.camera);
    this.particles = new ParticleSystem(this.scene, 500, false);
    this.glow = new ParticleSystem(this.scene, 500, true);

    // A fixed set of lights (so shaders never recompile when rooms change).
    this.scene.add(new THREE.AmbientLight(0x6a6080, 0.32));
    this.scene.add(new THREE.HemisphereLight(0x3a3450, 0x0a0806, 0.25));
    this.pedestalLight = new THREE.PointLight(0xffffff, 0, 9, 1.6);
    this.brazierLights = [0, 1].map(() => new THREE.PointLight(0xff6a20, 0, 13, 1.5));
    this.scene.add(this.pedestalLight, ...this.brazierLights);

    this.player = new Player(this);
    this.scene.add(this.player.group);

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.bindUI();
    this.newFloor();
    this.hud.hide();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('game-root').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060508);
    this.scene.fog = new THREE.FogExp2(0x060508, CONFIG.fogDensity);

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 120);
    this.post = new RetroPass(this.renderer);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  initMaterials() {
    const floorTex = TextureFactory.flagstones();
    const brickTex = TextureFactory.bricks();
    this.materials = {
      floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, color: 0xa39a90 }),
      wall: new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95, color: 0x8a847c }),
      pillar: new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9, color: 0x9a948a, flatShading: true }),
      stone: new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.9, flatShading: true }),
      trim: new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, flatShading: true }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.55, metalness: 0.5, flatShading: true }),
      bone: new THREE.MeshStandardMaterial({ color: 0xbdb49c, roughness: 0.9, flatShading: true }),
      wax: new THREE.MeshStandardMaterial({ color: 0xcfc4a4, roughness: 0.7 }),
      blood: new THREE.MeshStandardMaterial({ color: 0x2c0404, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 }),
      void: new THREE.MeshBasicMaterial({ color: 0x000000 }),
      flame: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
    };
    this.flameGeo = new THREE.BoxGeometry(0.06, 0.12, 0.06);
  }

  get difficulty() {
    const d = this.depth - 1;
    return { hp: 1 + 0.28 * d, damage: 1 + 0.15 * d, speed: 1 + 0.05 * d };
  }

  bindUI() {
    this.titleScreen = document.getElementById('title-screen');
    this.deathScreen = document.getElementById('death-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    document.getElementById('start-btn').addEventListener('click', () => this.start());
    this.deathScreen.addEventListener('click', () => this.restart());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  // ---- Flow --------------------------------------------------------------

  start() {
    this.audio.init();
    this.titleScreen.classList.add('hidden');
    this.hud.show();
    this.state = 'playing';
    this.input.clearBuffers();
    this.hud.banner(FLOOR_THEMES[0].name, 'floor', 2.6);
  }

  restart() {
    if (this.state !== 'dead') return;
    this.deathScreen.classList.add('hidden');
    this.runTransition(() => {
      this.depth = 1;
      this.player.reset();
      this.hud.renderRelics(this.player);
      this.hud.hideBoss();
      this.newFloor();
      this.state = 'playing';
      this.hud.banner(this.theme.name, 'floor', 2.6);
    });
  }

  get theme() { return FLOOR_THEMES[(this.depth - 1) % FLOOR_THEMES.length]; }

  newFloor() {
    this.floor?.dispose();
    this.floor = new DungeonFloor(this, this.depth);
    const theme = this.theme;
    this.scene.fog.color.setHex(theme.fog);
    this.scene.background.setHex(theme.fog);
    const name = this.depth > FLOOR_THEMES.length ? `${theme.name} ${toRoman(this.depth)}` : theme.name;
    this.hud.setFloor(this.depth, name);
    this.room = null;
    this.enterRoom(this.floor.start, null);
  }

  descend() {
    this.audio.play('descend');
    this.runTransition(() => {
      this.depth++;
      this.hud.hideBoss();
      this.newFloor();
      this.hud.banner(this.hud.floorName.textContent, 'floor', 2.6);
    }, 0.8);
  }

  enterRoom(room, entrySide) {
    this.room?.exit();
    this.particles.clear();
    this.glow.clear();
    for (const e of this.effects) e.dispose();
    this.effects.length = 0;
    this.room = room;
    room.build();

    const R = CONFIG.room;
    const p = this.player;
    const spawn = {
      n: [0, -R.depth / 2 + 1.6, 0],
      s: [0, R.depth / 2 - 1.6, Math.PI],
      e: [R.width / 2 - 1.6, 0, -Math.PI / 2],
      w: [-R.width / 2 + 1.6, 0, Math.PI / 2],
    }[entrySide] || [0, 2.5, Math.PI];
    p.pos.set(spawn[0], 0, spawn[1]);
    p.yaw = spawn[2];
    p.vel.set(0, 0, 0);
    if (p.alive) p.setState('idle');

    room.enter();
    this.brazierLights.forEach((l, i) => {
      const b = room.braziers[i];
      l.intensity = 0;
      if (b) l.position.copy(b);
    });
    this.cameraRig.snap(p.pos);
    this.hud.drawMinimap(this.floor, room);
  }

  runTransition(midpoint, outTime = 0.18) {
    this.transition = { t: 0, phase: 'out', outTime, inTime: 0.3, midpoint };
  }

  updateTransition(dt) {
    const tr = this.transition;
    tr.t += dt;
    if (tr.phase === 'out') {
      this.fade = 1 - Math.min(1, tr.t / tr.outTime);
      if (tr.t >= tr.outTime) {
        tr.midpoint();
        tr.phase = 'in';
        tr.t = 0;
      }
    } else {
      this.fade = Math.min(1, tr.t / tr.inTime);
      if (tr.t >= tr.inTime) this.transition = null;
    }
  }

  checkRoomExit() {
    const R = CONFIG.room;
    const p = this.player.pos;
    let dir = null;
    if (p.z < -R.depth / 2 - 0.9) dir = 'n';
    else if (p.z > R.depth / 2 + 0.9) dir = 's';
    else if (p.x > R.width / 2 + 0.9) dir = 'e';
    else if (p.x < -R.width / 2 - 0.9) dir = 'w';
    if (!dir || !this.room.neighbors[dir]) return;
    const next = this.room.neighbors[dir];
    this.runTransition(() => this.enterRoom(next, DIRS[dir].opposite));
  }

  // ---- Combat hooks --------------------------------------------------------

  addEffect(e) { this.effects.push(e); }

  onEnemyHit(enemy, dmg, dir) {
    const S = this.player.stats;
    this.hitstop = Math.max(this.hitstop, 0.055);
    this.cameraRig.shake(0.18);
    this.audio.play('hit');
    if (S.lifesteal > 0) this.player.hp = Math.min(S.maxHp, this.player.hp + S.lifesteal);
    const c = enemy.pos.clone().setY(1.1);
    this.glow.burst(c, 10, () => ({
      vel: new THREE.Vector3(dir.x * rand(3, 8) + rand(-2, 2), rand(0, 4), dir.z * rand(3, 8) + rand(-2, 2)),
      life: rand(0.15, 0.35), size: rand(0.04, 0.09), color: 0xffd8a0, drag: 4,
    }));
    this.particles.burst(c, 5, () => ({
      vel: new THREE.Vector3(dir.x * rand(2, 5), rand(1, 4), dir.z * rand(2, 5)), life: rand(0.8, 1.6), size: rand(0.05, 0.12), color: enemy.chunkColor, gravity: 16, linger: true,
    }));
  }

  onEnemyKilled() {
    this.hitstop = Math.max(this.hitstop, 0.08);
    this.cameraRig.shake(0.25);
    if (this.player.stats.lifesteal > 0) this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + this.player.stats.lifesteal);
  }

  damagePlayer(amount, fromPos, attacker) {
    const p = this.player;
    if (!p.alive || p.isInvulnerable() || this.transition) return false;
    p.hp -= amount;
    this.hurtFlash = 1;
    this.hitstop = Math.max(this.hitstop, 0.09);
    this.cameraRig.shake(0.5);
    this.audio.play('hurt');
    const c = p.pos.clone().setY(1.2);
    this.particles.burst(c, 14, () => ({
      vel: new THREE.Vector3(rand(-3, 3), rand(1, 5), rand(-3, 3)), life: rand(0.8, 1.6), size: rand(0.05, 0.12), color: 0x6a0808, gravity: 16, linger: true,
    }));
    if (p.stats.thorns > 0 && attacker?.alive) {
      attacker.takeDamage(p.stats.thorns, _v.copy(attacker.pos).sub(p.pos).setY(0).normalize().clone(), 4);
    }
    if (p.hp <= 0) this.onPlayerDeath();
    else p.onHurt(fromPos);
    return true;
  }

  onPlayerDeath() {
    this.player.die();
    this.state = 'dead';
    this.pauseScreen.classList.add('hidden');
    this.audio.play('death');
    this.slowmo = 1.2;
    this.hud.hideBoss();
    setTimeout(() => {
      if (this.state === 'dead') this.deathScreen.classList.remove('hidden');
    }, 1300);
  }

  onItemPickup(item) {
    const p = this.player;
    item.apply(p.stats, p);
    p.itemCounts.set(item.id, (p.itemCounts.get(item.id) || 0) + 1);
    p.hp = Math.min(p.hp, p.stats.maxHp);
    this.audio.play('pickup');
    this.hud.showItem(item);
    this.hud.renderRelics(p);
    this.glow.burst(p.pos.clone().setY(1), 30, () => ({
      vel: new THREE.Vector3(rand(-2, 2), rand(2, 6), rand(-2, 2)), life: rand(0.6, 1.2), size: rand(0.04, 0.1), color: item.color, drag: 2,
    }));
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.renderPauseStats();
      this.pauseScreen.classList.remove('hidden');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.pauseScreen.classList.add('hidden');
      this.clock.getDelta();
    }
  }

  renderPauseStats() {
    const S = this.player.stats;
    const rows = [
      ['Vigor', `${Math.ceil(this.player.hp)} / ${S.maxHp}`],
      ['Endurance', `${S.maxStamina}`],
      ['Strength', S.damage.toFixed(1)],
      ['Swing speed', `${Math.round(S.attackSpeed * 100)}%`],
      ['Reach', `${Math.round(S.reach * 100)}%`],
      ['Life drain', `${S.lifesteal}`],
      ['Thorns', `${S.thorns}`],
      ['Floor', toRoman(this.depth)],
    ];
    document.getElementById('pause-stats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  }

  // ---- Frame ---------------------------------------------------------------

  updateAim() {
    this.raycaster.setFromCamera(this.input.mouseNdc, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint);
  }

  frame() {
    const realDt = Math.min(0.05, this.clock.getDelta());
    const input = this.input;
    if (input.wasPressed('Escape')) this.togglePause();
    if (input.wasPressed('KeyM')) this.audio.toggleMute();
    if (input.wasPressed('KeyR')) this.restart();
    input.endFrame();

    if (this.state === 'paused') {
      this.post.render(this.scene, this.camera);
      return;
    }

    let dt = realDt;
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      dt = 0;
    } else if (this.slowmo > 0) {
      this.slowmo -= realDt;
      dt *= 0.35;
    }
    this.time += dt;

    this.updateAim();
    if (this.transition) this.updateTransition(realDt);

    if (this.state === 'title') {
      this.player.animate(realDt);
    } else if (!this.transition || this.transition.phase === 'in') {
      this.player.update(dt);
      this.room.update(dt);
      if (!this.transition && this.player.alive) this.checkRoomExit();
    } else {
      this.player.animate(dt);
    }

    this.effects = this.effects.filter((e) => e.update(dt));
    this.particles.update(dt);
    this.glow.update(dt);
    this.updateAmbience(dt);
    this.audio.update(realDt);
    if (this.state !== 'title') this.hud.update(realDt, this.player);
    this.cameraRig.update(realDt, this.player, this.state === 'title' ? this.player.pos : this.aimPoint);

    this.hurtFlash = Math.max(0, this.hurtFlash - realDt * 2.5);
    const u = this.post.uniforms;
    u.time.value = this.time;
    u.hurt.value = Math.max(this.hurtFlash, this.player.alive ? clamp(1 - this.player.hp / this.player.stats.maxHp - 0.6, 0, 0.4) : 0.5);
    u.fade.value = this.fade;
    this.post.render(this.scene, this.camera);
  }

  updateAmbience(dt) {
    const t = this.time;
    const p = this.player;
    // Embers drifting up from the lantern.
    if (Math.random() < dt * 9) {
      const lp = p.torch.getWorldPosition(_v);
      this.glow.emit({
        pos: lp.clone().add(new THREE.Vector3(rand(-0.1, 0.1), -0.3, rand(-0.1, 0.1))),
        vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.6, 1.4), rand(-0.3, 0.3)), life: rand(0.6, 1.2), size: rand(0.03, 0.06), color: 0xff8a30,
      });
    }
    // Dust motes hanging in the torchlight.
    if (Math.random() < dt * 6) {
      this.glow.emit({
        pos: new THREE.Vector3(p.pos.x + rand(-6, 6), rand(0.5, 3.5), p.pos.z + rand(-5, 5)),
        vel: new THREE.Vector3(rand(-0.15, 0.15), rand(-0.1, 0.1), rand(-0.15, 0.15)), life: rand(2, 4), size: 0.035, color: 0x6a5a48,
      });
    }

    this.brazierLights.forEach((l, i) => {
      if (this.room.braziers[i]) l.intensity = 14 * (0.8 + 0.2 * flicker(t, i * 5));
    });
    const ped = this.room.pedestal;
    if (ped && !ped.taken) {
      this.pedestalLight.position.copy(ped.lightPosition);
      this.pedestalLight.color.setHex(ped.item.color);
      this.pedestalLight.intensity = damp(this.pedestalLight.intensity, 6 * (0.85 + 0.15 * Math.sin(t * 3)), 3, dt);
    } else {
      this.pedestalLight.intensity = damp(this.pedestalLight.intensity, 0, 4, dt);
    }
  }
}

window.game = new Game();
