/**
 * Lightweight 2.5D collision for chambers suspended over an abyss.
 *
 * Walkable ground is a set of oriented surfaces (rects, ramps, discs, rings) with a top height.
 * Each surface is treated as a solid column reaching `thick` units downward, so a higher surface
 * blocks you like a wall while a bridge overhead lets you pass underneath. Obstacles (pillars,
 * crystals, balustrades) are vertical circles and axis-aligned boxes with a height range.
 */
export const STEP_HEIGHT = 0.55;

export class World {
  constructor() {
    this.surfaces = [];
    this.circles = [];
    this.boxes = [];
    this.minWalkY = -Infinity;
    // Surfaces and obstacles are stored in chamber-local coordinates; queries arrive in world
    // coordinates and are shifted by this offset (zero while a chamber is being built). The
    // vertical offset lets a chamber be raised onto an upper tier of the floor.
    this.ox = 0;
    this.oz = 0;
    this.oy = 0;
  }

  setOffset(x, z, y = 0) {
    this.ox = x;
    this.oz = z;
    this.oy = y;
  }

  /**
   * Copy another (offset-free) world's contents in, shifted into this world's local space.
   * Returns the copies, so shared moving parts (lifts, shortcut gates) can be driven together.
   */
  absorb(other, { skip = [] } = {}) {
    const dx = -this.ox, dz = -this.oz, dy = -this.oy;
    const out = { surfaces: [], circles: [], boxes: [] };
    for (const s of other.surfaces) {
      if (skip.includes(s.tag)) continue;
      const c = { ...s, cx: s.cx + dx, cz: s.cz + dz, top: s.top + dy, bottom: s.bottom + dy };
      if (s.y !== undefined) c.y = s.y + dy;
      if (s.y0 !== undefined) { c.y0 = s.y0 + dy; c.y1 = s.y1 + dy; }
      this.surfaces.push(c);
      out.surfaces.push(c);
    }
    for (const c of other.circles) {
      const k = { ...c, x: c.x + dx, z: c.z + dz, y0: c.y0 + dy, y1: c.y1 + dy };
      this.circles.push(k);
      out.circles.push(k);
    }
    for (const b of other.boxes) {
      const k = { ...b, x0: b.x0 + dx, x1: b.x1 + dx, z0: b.z0 + dz, z1: b.z1 + dz, y0: b.y0 + dy, y1: b.y1 + dy };
      this.boxes.push(k);
      out.boxes.push(k);
    }
    return out;
  }

  /**
   * The highest obstacle top (parapet, pillar, crate, fence) under a disc of radius `reach` at a
   * world-space point, no higher than `feetY + tolerance` — so you can land on, and walk along,
   * things that are not floor. Gates, lift barriers and fog walls don't count.
   */
  obstacleTopAt(x, z, feetY, reach = 0.25, tolerance = 0.05) {
    const lx = x - this.ox, lz = z - this.oz, limit = feetY - this.oy + tolerance;
    let best = null;
    for (const c of this.circles) {
      if (!c.enabled || c.y1 > limit || (best !== null && c.y1 <= best)) continue;
      const dx = lx - c.x, dz = lz - c.z, rr = c.r + reach;
      if (dx * dx + dz * dz < rr * rr) best = c.y1;
    }
    for (const b of this.boxes) {
      if (!b.enabled || b.y1 > limit || (best !== null && b.y1 <= best) || b.liftBar || b.liftGuard || b.gateId || b.dynamic) continue;
      const cx = Math.max(b.x0, Math.min(lx, b.x1)), cz = Math.max(b.z0, Math.min(lz, b.z1));
      if ((lx - cx) ** 2 + (lz - cz) ** 2 < reach * reach) best = b.y1;
    }
    return best === null ? null : best + this.oy;
  }

  /** Does a world-space point sit inside a solid obstacle or block of ground? */
  hitsObstacle(p, minRadius = 0.3) {
    const x = p.x - this.ox, z = p.z - this.oz, y = p.y - this.oy;
    if (this.localSurfaceBlocks(x, z, y - 0.1, 0.2)) return true;
    return this.circles.some((c) => c.enabled && c.r > minRadius && y > c.y0 && y < c.y1 && Math.hypot(x - c.x, z - c.z) < c.r);
  }

  addSurface(s) {
    s.cos = Math.cos(s.angle || 0);
    s.sin = Math.sin(s.angle || 0);
    this.surfaces.push(s);
    return s;
  }

  addRect(cx, cz, hw, hd, y, { angle = 0, thick = 100, parapet = true, tag = 'hub', style = 'balustrade' } = {}) {
    return this.addSurface({ kind: 'rect', cx, cz, hw, hd, angle, y, top: y, bottom: y - thick, parapet, tag, style });
  }

  /** A ramp rises from y0 at local -hd to y1 at local +hd (local +Z points along `angle`). */
  addRamp(cx, cz, hw, hd, y0, y1, { angle = 0, thick = 100, parapet = true, tag = 'stairs', style = 'balustrade' } = {}) {
    return this.addSurface({ kind: 'ramp', cx, cz, hw, hd, angle, y0, y1, top: Math.max(y0, y1), bottom: Math.min(y0, y1) - thick, parapet, tag, style });
  }

  addDisc(cx, cz, r, y, { thick = 100, parapet = true, tag = 'hub', style = 'balustrade' } = {}) {
    return this.addSurface({ kind: 'disc', cx, cz, r, y, top: y, bottom: y - thick, parapet, tag, style });
  }

  addRing(cx, cz, r0, r1, y, { thick = 100, parapet = true, tag = 'hub', style = 'balustrade' } = {}) {
    return this.addSurface({ kind: 'ring', cx, cz, r0, r1, y, top: y, bottom: y - thick, parapet, tag, style });
  }

  /** Terrain: `fn(x, z)` returns the ground height. Everything below `minWalkY` is water. */
  addField(fn, { tag = 'terrain' } = {}) {
    return this.addSurface({ kind: 'field', fn, top: Infinity, bottom: -Infinity, parapet: false, tag });
  }

  /** Add an obstacle given in world coordinates (for props placed after a chamber is built). */
  addCircleWorld(x, z, r, y0, y1) { return this.addCircle(x - this.ox, z - this.oz, r, y0 - this.oy, y1 - this.oy); }

  addCircle(x, z, r, y0, y1) {
    const c = { x, z, r, y0, y1, enabled: true };
    this.circles.push(c);
    return c;
  }

  addBox(x0, z0, x1, z1, y0, y1) {
    const b = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0, y1, enabled: true };
    this.boxes.push(b);
    return b;
  }

  toLocal(s, x, z) {
    const dx = x - s.cx, dz = z - s.cz;
    return [dx * s.cos - dz * s.sin, dx * s.sin + dz * s.cos];
  }

  /** Height of surface `s` at (x, z), or null when the point is outside it. */
  heightOf(s, x, z) {
    switch (s.kind) {
      case 'rect': {
        const [lx, lz] = this.toLocal(s, x, z);
        return Math.abs(lx) <= s.hw && Math.abs(lz) <= s.hd ? s.y : null;
      }
      case 'ramp': {
        const [lx, lz] = this.toLocal(s, x, z);
        if (Math.abs(lx) > s.hw || Math.abs(lz) > s.hd) return null;
        return s.y0 + (s.y1 - s.y0) * ((lz + s.hd) / (2 * s.hd));
      }
      case 'disc': {
        const dx = x - s.cx, dz = z - s.cz;
        return dx * dx + dz * dz <= s.r * s.r ? s.y : null;
      }
      case 'ring': {
        const d = Math.hypot(x - s.cx, z - s.cz);
        return d >= s.r0 && d <= s.r1 ? s.y : null;
      }
      case 'field':
        return s.fn(x, z);
    }
    return null;
  }

  /** Highest ground under world (x, z) that can be stood on from `feetY` (no taller than a step). */
  groundAt(x, z, feetY = Infinity, step = STEP_HEIGHT) {
    const g = this.localGroundAt(x - this.ox, z - this.oz, feetY - this.oy, step);
    return g === null ? null : g + this.oy;
  }

  localGroundAt(x, z, feetY = Infinity, step = STEP_HEIGHT) {
    let best = null;
    for (const s of this.surfaces) {
      const h = this.heightOf(s, x, z);
      if (h !== null && h <= feetY + step && (best === null || h > best)) best = h;
    }
    return best;
  }

  surfaceBlocks(x, z, feetY, height) {
    return this.localSurfaceBlocks(x - this.ox, z - this.oz, feetY - this.oy, height);
  }

  localSurfaceBlocks(x, z, feetY, height) {
    for (const s of this.surfaces) {
      const h = this.heightOf(s, x, z);
      if (h === null || h <= feetY + STEP_HEIGHT) continue;
      const bottom = s.kind === 'ramp' ? h - (s.top - s.bottom) : s.kind === 'field' ? -Infinity : s.bottom;
      if (bottom < feetY + height) return true;
    }
    return false;
  }

  blockedAt(x, z, r, feetY, height) {
    const k = r * 0.85;
    x -= this.ox;
    z -= this.oz;
    feetY -= this.oy;
    return this.localSurfaceBlocks(x, z, feetY, height)
      || this.localSurfaceBlocks(x + k, z, feetY, height)
      || this.localSurfaceBlocks(x - k, z, feetY, height)
      || this.localSurfaceBlocks(x, z + k, feetY, height)
      || this.localSurfaceBlocks(x, z - k, feetY, height);
  }

  /** Push a vertical cylinder out of every obstacle it overlaps. */
  pushOut(pos, r, feetY, height) {
    pos.x -= this.ox;
    pos.z -= this.oz;
    this.localPushOut(pos, r, feetY - this.oy, height);
    pos.x += this.ox;
    pos.z += this.oz;
  }

  localPushOut(pos, r, feetY, height) {
    const top = feetY + height;
    for (const c of this.circles) {
      if (!c.enabled || c.y1 < feetY + 0.25 || c.y0 > top) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1e-4;
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    }
    for (const b of this.boxes) {
      if (!b.enabled || b.y1 < feetY + 0.25 || b.y0 > top) continue;
      const cx = Math.max(b.x0, Math.min(pos.x, b.x1));
      const cz = Math.max(b.z0, Math.min(pos.z, b.z1));
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-8) {
        // Centre is inside the box: eject through the nearest face.
        const pen = [pos.x - b.x0, b.x1 - pos.x, pos.z - b.z0, b.z1 - pos.z];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) pos.x = b.x0 - r;
        else if (i === 1) pos.x = b.x1 + r;
        else if (i === 2) pos.z = b.z0 - r;
        else pos.z = b.z1 + r;
        continue;
      }
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * r;
      pos.z = cz + (dz / d) * r;
    }
  }

  /** Nudge a cylinder out of the ground it overlaps: the smallest move that frees it. */
  unstick(pos, r, feetY, height) {
    for (let d = 0.05; d <= 1.5; d += 0.05) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = pos.x + Math.cos(a) * d, z = pos.z + Math.sin(a) * d;
        if (!this.blockedAt(x, z, r, feetY, height)) {
          pos.x = x;
          pos.z = z;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Slide a cylinder by (dx, dz). With `allowFall` false the mover refuses to step off an edge
   * (used by enemy AI), otherwise it will happily walk into the abyss.
   */
  move(pos, feetY, dx, dz, r, height, { allowFall = true, maxDrop = 1.2 } = {}) {
    const ok = (x, z) => {
      if (this.blockedAt(x, z, r, feetY, height)) return false;
      if (this.minWalkY > -Infinity) {
        const w = this.groundAt(x, z, feetY);
        if (w === null || w < this.minWalkY) return false;
      }
      if (allowFall) return true;
      const g = this.groundAt(x, z, feetY);
      return g !== null && feetY - g <= maxDrop;
    };
    // Already embedded in a block of ground (fell past a ledge while overlapping its edge, or a
    // platform moved into us)? Every step would be refused, so first slip out to the nearest
    // free spot.
    if (this.blockedAt(pos.x, pos.z, r, feetY, height)) this.unstick(pos, r, feetY, height);
    const nx = pos.x + dx, nz = pos.z + dz;
    if (ok(nx, nz)) { pos.x = nx; pos.z = nz; }
    else if (ok(nx, pos.z)) pos.x = nx;
    else if (ok(pos.x, nz)) pos.z = nz;
    const px = pos.x, pz = pos.z;
    this.pushOut(pos, r, feetY, height);
    // Never let an obstacle shove an edge-cautious mover off a ledge.
    if (!allowFall && !ok(pos.x, pos.z)) { pos.x = px; pos.z = pz; }
  }
}
