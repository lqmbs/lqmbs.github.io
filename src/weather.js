import * as THREE from 'three';
import { rand, chance } from './util.js';

/**
 * Weather around the knight: rain and lightning over the drowned, ash and embers in the forge,
 * glittering crystal snow in the undercroft, dust motes and shafts of light in the ruins, sea
 * drizzle at the Hold. Everything is one instanced cloud that wraps around the camera, so it
 * costs the same wherever you go.
 */

const KINDS = {
  rain: { count: 1100, size: [0.012, 0.55, 0.012], color: 0x9ab0c0, opacity: 0.32, fall: 17, drift: 1.2, additive: false, box: 22 },
  drizzle: { count: 500, size: [0.01, 0.35, 0.01], color: 0xc8d0d4, opacity: 0.22, fall: 9, drift: 2.2, additive: false, box: 24 },
  ash: { count: 700, size: [0.05, 0.05, 0.05], color: 0x2a2220, opacity: 0.7, fall: 0.7, drift: 0.8, additive: false, box: 20, embers: true },
  crystal: { count: 600, size: [0.035, 0.035, 0.035], color: 0x7ac0ff, opacity: 0.8, fall: 0.5, drift: 0.4, additive: true, box: 20 },
  motes: { count: 450, size: [0.03, 0.03, 0.03], color: 0xfff0c8, opacity: 0.55, fall: -0.05, drift: 0.3, additive: true, box: 18, rays: true },
};

export class Weather {
  constructor(game) {
    this.game = game;
    this.kind = null;
    this.density = 1;
    this.mesh = null;
    this.lightning = 0;
    this.nextStrike = rand(6, 14);
    this.rays = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
  }

  /** Graphics quality: how thick the weather is. */
  setDensity(d) {
    this.density = d;
    if (this.kind) this.set(this.kind, true);
  }

  set(kind, force = false) {
    if (kind === this.kind && !force) return;
    this.clear();
    this.kind = kind;
    const K = KINDS[kind];
    if (!K) return;
    const n = Math.max(40, Math.round(K.count * this.density));
    const mat = new THREE.MeshBasicMaterial({
      color: K.color, transparent: true, opacity: K.opacity, depthWrite: false,
      blending: K.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !K.additive,
    });
    const geo = new THREE.BoxGeometry(...K.size);
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    const c = this.game.camera.position;
    this.drops = [];
    for (let i = 0; i < n; i++) {
      this.drops.push({
        x: c.x + rand(-K.box, K.box), y: c.y + rand(-6, 14), z: c.z + rand(-K.box, K.box),
        v: K.fall * rand(0.8, 1.2), ph: rand(0, 6.28), sp: rand(0.5, 1.5),
      });
    }
    this.game.scene.add(this.mesh);
    if (K.embers) this.emberRate = 14 * this.density;
    else this.emberRate = 0;
    if (K.rays) this.buildRays();
  }

  /** Slanting shafts of light through the ruins' broken roofs. */
  buildRays() {
    const cv = document.createElement('canvas');
    cv.width = 16;
    cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 64);
    const tex = new THREE.CanvasTexture(cv);
    for (let i = 0; i < Math.round(6 * this.density); i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xfff0c8, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(rand(2, 4.5), 26), mat);
      ray.userData = { ang: rand(0, Math.PI * 2), dist: rand(8, 22), ph: rand(0, 6), base: rand(0.05, 0.1) };
      ray.rotation.set(0, 0, 0.45);
      this.game.scene.add(ray);
      this.rays.push(ray);
    }
  }

  clear() {
    if (this.mesh) {
      this.game.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    for (const r of this.rays) {
      this.game.scene.remove(r);
      r.geometry.dispose();
      r.material.dispose();
    }
    this.rays.length = 0;
    this.kind = null;
    this.lightning = 0;
  }

  update(dt) {
    if (!this.mesh) return;
    const K = KINDS[this.kind];
    const c = this.game.camera.position;
    const t = this.game.time;
    const B = K.box;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y -= d.v * dt;
      d.x += Math.sin(t * 0.3 + d.ph) * K.drift * dt + (this.kind === 'rain' ? 1.5 * dt : 0);
      d.z += Math.cos(t * 0.23 + d.ph) * K.drift * dt;
      // Wrap around the camera so the cloud never runs out.
      if (d.x < c.x - B) d.x += 2 * B; else if (d.x > c.x + B) d.x -= 2 * B;
      if (d.z < c.z - B) d.z += 2 * B; else if (d.z > c.z + B) d.z -= 2 * B;
      if (d.y < c.y - 6) d.y += 20; else if (d.y > c.y + 14) d.y -= 20;
      this.p.set(d.x, d.y, d.z);
      const tw = K.additive ? 0.6 + 0.4 * Math.sin(t * 3 * d.sp + d.ph) : 1;
      this.s.set(tw, tw, tw);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    if (this.emberRate && Math.random() < dt * this.emberRate) {
      this.game.glow.emit({
        pos: new THREE.Vector3(c.x + rand(-10, 10), c.y + rand(-3, 1), c.z + rand(-10, 10)),
        vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.6, 1.6), rand(-0.4, 0.4)), life: rand(1.5, 3), size: rand(0.03, 0.05), color: chance(0.5) ? 0xff7a2a : 0xffb050,
      });
    }

    for (const r of this.rays) {
      const u = r.userData;
      r.position.set(c.x + Math.cos(u.ang) * u.dist, c.y + 8, c.z + Math.sin(u.ang) * u.dist);
      r.lookAt(c.x, r.position.y, c.z);
      r.rotateZ(0.45);
      r.material.opacity = u.base * (0.7 + 0.3 * Math.sin(t * 0.4 + u.ph));
    }

    // Lightning over the flood: a white flash across the sky, thunder a moment later.
    if (this.kind === 'rain') {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = rand(9, 22);
        this.lightning = 1;
        this.game.flash = Math.max(this.game.flash, 0.5);
        setTimeout(() => this.game.audio.play('thunder'), rand(400, 1800));
      }
    }
    if (this.lightning > 0) {
      this.lightning = Math.max(0, this.lightning - dt * (this.lightning > 0.6 ? 2 : 4));
      const flick = this.lightning > 0.3 && Math.random() < 0.5 ? 1 : 0.3;
      this.game.lightningBoost = this.lightning * flick;
    } else this.game.lightningBoost = 0;
  }
}
