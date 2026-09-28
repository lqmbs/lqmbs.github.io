import * as THREE from 'three';
import { rand, TAU } from './util.js';

/**
 * Hazards that outlive the blow that made them: expanding rings you must jump or dodge, pools of
 * fire, and lines marked on the floor before a charge. Bosses and elites share them.
 */

const additive = (color, opacity = 0.8) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
});

/**
 * A wall of force running outwards along the ground — water, fire, bone or light. It is low:
 * jump it or dodge through it. Being caught on the ground is a perilous hit.
 */
export class RingWave {
  constructor(game, owner, center, { speed = 7, maxR = 16, damage = 20, color = 0xffb040, height = 0.6, spikes = false } = {}) {
    this.game = game;
    this.owner = owner;
    this.center = center.clone();
    this.speed = speed;
    this.maxR = maxR;
    this.damage = damage;
    this.r = 0.6;
    this.hit = false;
    this.mat = additive(color, 0.75);
    this.group = new THREE.Group();
    this.group.position.copy(this.center);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, height, 56, 1, true), this.mat);
    wall.position.y = height / 2;
    this.group.add(wall);
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.94, 1.06, 56).rotateX(-Math.PI / 2), this.mat);
    rim.position.y = 0.05;
    this.group.add(rim);
    if (spikes) {
      // Bone spears or crystal shards riding the crest.
      const geo = new THREE.ConeGeometry(0.035, 0.9, 4);
      const spikesMesh = new THREE.InstancedMesh(geo, this.mat, 40);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU;
        m.makeRotationZ(rand(-0.3, 0.3)).setPosition(Math.cos(a), 0.4, Math.sin(a));
        spikesMesh.setMatrixAt(i, m);
      }
      this.group.add(spikesMesh);
      this.spikes = spikesMesh;
    }
    this.group.scale.set(this.r, 1, this.r);
    game.scene.add(this.group);
  }

  update(dt) {
    this.r += this.speed * dt;
    if (this.spikes) this.spikes.scale.set(1 / this.r, 1, 1 / this.r);
    this.group.scale.set(this.r, 1, this.r);
    const k = this.r / this.maxR;
    this.mat.opacity = 0.75 * (k > 0.8 ? (1 - k) / 0.2 : 1);
    const p = this.game.player;
    if (!this.hit && p.alive) {
      const d = Math.hypot(p.pos.x - this.center.x, p.pos.z - this.center.z);
      const low = p.pos.y - this.center.y < 0.4 && p.pos.y - this.center.y > -1.2;
      if (Math.abs(d - this.r) < 0.5 && low) {
        this.hit = true;
        const from = new THREE.Vector3(this.center.x, p.pos.y, this.center.z);
        if (this.owner?.alive !== false) this.owner.attackPlayer({ damage: this.damage, perilous: true, from });
      }
    }
    if (this.r >= this.maxR) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.mat.dispose();
  }
}

/** A pool of fire (or bile, or holy light) that burns whoever stands in it. */
export class FirePool {
  constructor(game, pos, radius = 2, { duration = 6, dps = 9, color = 0xff6a20 } = {}) {
    this.game = game;
    this.pos = pos.clone();
    this.radius = radius;
    this.duration = duration;
    this.dps = dps;
    this.color = color;
    this.t = 0;
    this.mat = additive(color, 0.5);
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 28).rotateX(-Math.PI / 2), this.mat);
    this.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    game.scene.add(this.mesh);
    this.tick = 0;
  }

  update(dt) {
    this.t += dt;
    const fadeIn = Math.min(1, this.t / 0.3), fadeOut = Math.min(1, (this.duration - this.t) / 0.8);
    this.mat.opacity = 0.45 * fadeIn * Math.max(0, fadeOut) * (0.85 + 0.15 * Math.sin(this.t * 13));
    if (Math.random() < dt * this.radius * 14) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * this.radius;
      this.game.glow.emit({
        pos: new THREE.Vector3(this.pos.x + Math.cos(a) * r, this.pos.y + 0.1, this.pos.z + Math.sin(a) * r),
        vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.4), rand(-0.2, 0.2)), life: rand(0.3, 0.7), size: rand(0.05, 0.1), color: this.color,
      });
    }
    const p = this.game.player;
    if (p.alive && p.invuln <= 0 && !p.dodging() && this.t > 0.3 && fadeOut > 0.2) {
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < this.radius && Math.abs(p.pos.y - this.pos.y) < 0.6) {
        p.hurt(this.dps * dt);
        this.tick -= dt;
        if (this.tick <= 0) {
          this.tick = 0.45;
          this.game.hurtFlash = Math.max(this.game.hurtFlash, 0.35);
          this.game.audio.play('sizzle');
        }
      }
    }
    if (this.t >= this.duration) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** A lane marked on the floor before a charge or a thrown chain: get out of it. */
export class LineTelegraph {
  constructor(game, from, yaw, length, width, duration, color = 0xff2a14) {
    this.game = game;
    this.t = 0;
    this.duration = duration;
    this.group = new THREE.Group();
    this.group.position.set(from.x, from.y + 0.05, from.z);
    this.group.rotation.y = yaw;
    this.outlineMat = additive(color, 0.8);
    this.fillMat = additive(color, 0.3);
    const outline = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2).translate(0, 0, length / 2), this.outlineMat);
    outline.scale.set(1, 1, 1);
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.9, length).rotateX(-Math.PI / 2).translate(0, 0, length / 2), this.fillMat);
    this.fill.scale.z = 0.01;
    this.outlineMat.opacity = 0.18;
    this.group.add(outline, this.fill);
    game.scene.add(this.group);
  }

  cancel() { this.t = this.duration; }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.fill.scale.z = Math.max(0.01, k);
    this.fillMat.opacity = 0.25 + 0.2 * Math.sin(this.t * 30) * (1 - k);
    if (this.t >= this.duration) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.outlineMat.dispose();
    this.fillMat.dispose();
  }
}

/** A translucent copy of a model that lingers where it was — an echo, a shade, a ghost. */
export class Ghost {
  constructor(game, source, { color = 0xbfd0ff, life = 1.2, opacity = 0.45 } = {}) {
    this.game = game;
    this.t = 0;
    this.life = life;
    this.opacity = opacity;
    this.mat = additive(color, opacity);
    this.mat.side = THREE.FrontSide;
    this.obj = source.clone(true);
    this.obj.traverse((o) => { if (o.isMesh) { o.material = this.mat; o.castShadow = false; } });
    source.updateWorldMatrix(true, false);
    source.matrixWorld.decompose(this.obj.position, this.obj.quaternion, this.obj.scale);
    game.scene.add(this.obj);
  }

  update(dt) {
    this.t += dt;
    this.mat.opacity = this.opacity * Math.max(0, 1 - this.t / this.life);
    if (this.t >= this.life) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.game.scene.remove(this.obj);
    this.mat.dispose();
  }
}
