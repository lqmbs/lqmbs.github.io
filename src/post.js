import * as THREE from 'three';
import { CONFIG } from './config.js';

/**
 * Renders the world, then the first-person viewmodel on top (depth cleared so the sword never
 * clips into walls), into a low-resolution HDR target. A full-screen pass then upscales it with
 * nearest sampling and adds a cheap bloom, split-tone grade, ordered dithering, posterisation,
 * grain and a vignette — the hazy, crunchy look of a low-res painterly render.
 */
export class RetroPass {
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
      flash: { value: 0 },
      fade: { value: 1 },
      impact: { value: 0 },
      focus: { value: 0 },
      levels: { value: CONFIG.ditherLevels },
      shadowTint: { value: new THREE.Color(0x1a2a50) },
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
        uniform float time, hurt, flash, fade, levels, impact, focus;
        uniform vec3 shadowTint;
        varying vec2 vUv;

        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

        vec3 aces(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        void main() {
          vec2 pix = floor(vUv * resolution);
          vec2 uv = (pix + 0.5) / resolution;
          vec3 col = texture2D(tDiffuse, uv).rgb;
          // Impact: the frame tears into red and blue fringes, pulling from the centre.
          if (impact > 0.001) {
            vec2 off = (uv - 0.5) * impact * 0.028;
            col.r = texture2D(tDiffuse, uv - off).r;
            col.b = texture2D(tDiffuse, uv + off).b;
          }

          // Golden-angle bloom: only very bright pixels (crystals, flames, lantern) bleed.
          vec3 bloom = vec3(0.0);
          for (int i = 0; i < 16; i++) {
            float fi = float(i);
            float a = fi * 2.39996;
            float r = sqrt(fi + 0.5) * 2.2;
            vec3 s = texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r / resolution).rgb;
            bloom += max(s - 0.9, 0.0);
          }
          col += bloom / 16.0 * 1.0;

          col = aces(col * 1.35);
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          // Split tone: cold shadows, warm highlights, a little haze lifting the blacks.
          col = mix(col, col * vec3(1.08, 0.98, 0.86), smoothstep(0.25, 0.8, lum));
          col += shadowTint * 0.05 * (1.0 - smoothstep(0.0, 0.35, lum));
          col = mix(vec3(lum), col, 0.9 - focus * 0.55);
          col = mix(col, col * vec3(0.8, 0.92, 1.15), focus * 0.6);
          col = pow(col, vec3(1.0 / 2.2));

          float grain = fract(sin(dot(pix + floor(time * 24.0) * 7.13, vec2(12.9898, 78.233))) * 43758.5453);
          col += (grain - 0.5) * 0.03;
          col += (bayer4(pix) - 0.5) / levels;
          col = floor(col * levels + 0.5) / levels;

          vec2 d = vUv - 0.5;
          float vig = smoothstep(0.9, 0.3, length(d * vec2(1.0, 0.8)));
          col *= mix(0.35 - focus * 0.2, 1.0, vig);
          col = mix(col, vec3(0.5, 0.0, 0.0), hurt * (1.0 - vig * 0.7) * 0.75);
          col += vec3(1.0, 0.85, 0.6) * flash * 0.35;

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

  render(scene, camera, overlayScene, overlayCamera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.autoClear = true;
    r.render(scene, camera);
    if (overlayScene) {
      r.autoClear = false;
      r.clearDepth();
      r.render(overlayScene, overlayCamera);
      r.autoClear = true;
    }
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
