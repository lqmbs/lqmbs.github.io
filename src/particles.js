import * as THREE from 'three';
import { rand, TAU } from './util.js';

/** Pooled cube particles in a single InstancedMesh (one per blend mode). */
export class ParticleSystem {
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

  emit({ pos, vel, life = 1, size = 0.1, color = 0xffffff, gravity = 0, drag = 0, bounce = 0.3, linger = false, spin = 1, floor = null }) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      p: pos.clone(),
      v: vel ? vel.clone() : new THREE.Vector3(),
      life, maxLife: life, size, gravity, drag, bounce, linger,
      floor,
      color: new THREE.Color(color),
      spin: rand(-8, 8) * spin,
      rx: rand(0, TAU), ry: rand(0, TAU),
    });
  }

  burst(pos, count, opts) {
    for (let i = 0; i < count; i++) {
      const o = typeof opts === 'function' ? opts(i) : opts;
      this.emit({ ...o, pos: o.pos ?? pos });
    }
  }

  clear() {
    this.items.length = 0;
    this.mesh.count = 0;
  }

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
      if (p.floor !== null && p.p.y < p.floor + p.size * 0.5) {
        p.p.y = p.floor + p.size * 0.5;
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
