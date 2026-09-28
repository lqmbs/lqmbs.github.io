import * as THREE from 'three';

/** Overcast painterly sky dome: gradient, drifting fbm clouds and a veiled sun. Follows the camera. */
export function createSkyDome({ sunDir = new THREE.Vector3(-0.5, 0.35, 0.8), bright = 0.72 } = {}) {
  const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { sunDir: { value: sunDir.clone().normalize() }, bright: { value: bright } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        uniform float bright;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 horizon = vec3(0.62, 0.66, 0.66);
          vec3 zenith = vec3(0.26, 0.31, 0.34);
          vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.7, h));
          vec2 uv = d.xz / (d.y + 0.25) * 1.6;
          float c = fbm(uv + vec2(3.0, 1.0));
          float c2 = fbm(uv * 2.3 - vec2(1.5, 4.0));
          float clouds = smoothstep(0.35, 0.75, c * 0.7 + c2 * 0.4);
          vec3 cloudCol = mix(vec3(0.42, 0.45, 0.46), vec3(0.78, 0.8, 0.78), smoothstep(0.4, 0.9, c2));
          col = mix(col, cloudCol, clouds * smoothstep(-0.05, 0.25, h));
          float sun = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.95, 0.82) * (pow(sun, 8.0) * 0.35 + pow(sun, 64.0) * 0.6) * (1.0 - clouds * 0.6);
          col = mix(col, horizon * 0.9, smoothstep(0.08, -0.1, h));
          gl_FragColor = vec4(col * bright, 1.0);
        }
      `,
    });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}
