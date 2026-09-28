import * as THREE from 'three';

const col = (c) => new THREE.Color(c);

/**
 * Painterly sky dome: gradient, drifting fbm clouds and a veiled sun — or, with `moon`, a
 * great hard-edged disc (the devil's blood moon). Follows the camera.
 */
export function createSkyDome({
  sunDir = new THREE.Vector3(-0.5, 0.35, 0.8), bright = 0.72,
  horizon = 0x9ea8a8, zenith = 0x424f57, cloudDark = 0x6b7375, cloudLight = 0xc7ccc7, sunColor = 0xfff2d0,
  moon = 0, moonColor = 0xd8303a,
} = {}) {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: sunDir.clone().normalize() }, bright: { value: bright },
      horizon: { value: col(horizon) }, zenith: { value: col(zenith) },
      cloudDark: { value: col(cloudDark) }, cloudLight: { value: col(cloudLight) },
      sunColor: { value: col(sunColor) }, moon: { value: moon }, moonColor: { value: col(moonColor) },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, horizon, zenith, cloudDark, cloudLight, sunColor, moonColor;
      uniform float bright, moon, time;
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
        vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.7, h));
        vec2 uv = d.xz / (d.y + 0.25) * 1.6 + vec2(time * 0.004, 0.0);
        float n1 = fbm(uv + vec2(3.0, 1.0));
        float n2 = fbm(uv * 2.3 - vec2(1.5, 4.0));
        float clouds = smoothstep(0.35, 0.75, n1 * 0.7 + n2 * 0.4);
        float sun = max(dot(d, sunDir), 0.0);
        if (moon > 0.0) {
          // A hard disc with a soft corona, mottled like old blood; clouds pass in front of it.
          float disc = smoothstep(moon, moon + 0.004, sun);
          float mottle = fbm(d.xy * 40.0) * 0.35 + 0.75;
          c += moonColor * pow(sun, 30.0) * 0.5;
          c = mix(c, moonColor * mottle * 1.4, disc);
        } else {
          c += sunColor * (pow(sun, 8.0) * 0.35 + pow(sun, 64.0) * 0.6) * (1.0 - clouds * 0.6);
        }
        vec3 cloudCol = mix(cloudDark, cloudLight, smoothstep(0.4, 0.9, n2));
        c = mix(c, cloudCol, clouds * smoothstep(-0.05, 0.25, h) * (moon > 0.0 ? 0.75 : 1.0));
        c = mix(c, horizon * 0.9, smoothstep(0.08, -0.1, h));
        gl_FragColor = vec4(c * bright, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}
