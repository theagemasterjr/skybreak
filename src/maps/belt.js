import * as THREE from 'three';
import { Overtime, StrikePool } from '../overtime.js';

// ---------------------------------------------------------------------------
// Shattered Belt: an asteroid field drifting in deep-space dusk. Normal
// gravity in the open â€” but GRAVITON terrain bends it: glowing ringed
// asteroids you can run all the way around, and purple plates whose fields
// pull one way onto their face. Once a field grips you, only a dash frees
// you; gravity snaps back to plain down the moment you leave.
//
// OVERTIME â€” CANOPY'S CALL: the belt tears itself apart. Every plate,
// platform and island rumbles then launches skyward one pair at a time,
// until only the colossal face-down Canopy remains â€” then the sky itself
// inverts. Gravity flips, everyone falls UP, and only the Canopy's own
// downward-pulling field catches you. From then on the Canopy's underside
// crackles with static discharge, faster and faster.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class CanopyOvertime extends Overtime {
  begin() {
    const w = this.world;
    this.canopy = w.gravPlates.find((p) => p.canopy);
    this.canopyHome = this.canopy.slab.position.clone();

    // ACT 1 queue: the 9 non-canopy plates, the 3 orbiting platforms and the
    // 7 islands, all interleaved by one seeded shuffle over the combined list
    const plates = w.gravPlates.filter((p) => !p.canopy).map((ref) => ({ type: 'plate', ref }));
    const platforms = w.platforms.map((ref) => ({ type: 'platform', ref }));
    const islands = w.islands.map((ref) => ({ type: 'island', ref }));
    const entries = [...plates, ...platforms, ...islands];
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(w.hazardRng() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    this.queue = entries;
    this.totalQueue = entries.length;

    // static-position visuals (plate slabs, island groups) need an explicit
    // home cached up front â€” platform meshes get a fresh "home" every frame
    // from world.update's own bob/orbit formula, so they need none.
    this._homes = new Map();
    for (const e of entries) {
      if (e.type === 'plate') this._homes.set(e.ref, e.ref.slab.position.clone());
      else if (e.type === 'island') this._homes.set(e.ref, e.ref.group.position.clone());
    }

    this.rumbling = [];    // {entry, t}
    this.launching = [];   // {entry, vy, spinX, spinZ}
    this.nextPullAt = this.t + 2.4;

    this.pool = new StrikePool(w, this.game);
    this.flipped = false;
    this.flipT = null;
    this.nextStrikeAt = null;
  }

  _meshOf(entry) {
    if (entry.type === 'plate') return entry.ref.slab;
    if (entry.type === 'island') return entry.ref.group;
    return entry.ref.mesh;
  }

  _entryPos(entry) {
    if (entry.type === 'island') return _v1.set(entry.ref.x, entry.ref.topY, entry.ref.z);
    return _v1.copy(this._meshOf(entry).position);
  }

  _rumbleFx(entry, rt) {
    const amp = 0.14;
    const mesh = this._meshOf(entry);
    if (entry.type === 'plate') {
      const home = this._homes.get(entry.ref);
      mesh.position.set(
        home.x + (Math.random() - 0.5) * 2 * amp,
        home.y + (Math.random() - 0.5) * 2 * amp,
        home.z + (Math.random() - 0.5) * 2 * amp
      );
      mesh.material.emissiveIntensity = 0.6 + Math.abs(Math.sin(rt * 18)) * 1.6;
    } else if (entry.type === 'island') {
      const home = this._homes.get(entry.ref);
      mesh.position.x = home.x + (Math.random() - 0.5) * 2 * amp;
      mesh.position.z = home.z + (Math.random() - 0.5) * 2 * amp;
    } else {
      // platform: world.update already wrote its bob/orbit "home" this frame
      mesh.position.x += (Math.random() - 0.5) * 2 * amp;
      mesh.position.y += (Math.random() - 0.5) * 2 * amp;
      mesh.position.z += (Math.random() - 0.5) * 2 * amp;
    }
  }

  _launch(entry) {
    const w = this.world, g = this.game;
    g.effects.impactBurst(this._entryPos(entry).clone(), { color: 0x8a4aff, size: 3.4 });
    g.audio?.play('explosion');
    const mesh = this._meshOf(entry);
    if (entry.type === 'plate') {
      w.removeGravPlate(entry.ref);
      mesh.position.copy(this._homes.get(entry.ref));
    } else if (entry.type === 'island') {
      w.removeIsland(entry.ref);
      mesh.position.copy(this._homes.get(entry.ref));
    } else {
      w.removePlatform(entry.ref);
    }
    const spinX = (w.hazardRng() - 0.5) * 1.2;
    const spinZ = (w.hazardRng() - 0.5) * 1.2;
    this.launching.push({ entry, vy: 6, spinX, spinZ });
  }

  _flip() {
    const w = this.world, g = this.game;
    this.flipped = true;
    this.flipT = this.t;
    this.canopy.slab.position.copy(this.canopyHome);   // stop the shake
    g.hud?.announce('THE SKY INVERTS', 'sub');
    g.hud?.flash('rgba(160, 120, 255, 0.3)', 0.7);
    w.gravityFlipped = true;
    w.skyKillY = 150;
    g.player.vel.y += 6;
    g.player.shake?.(0.8);
    g.audio?.play('explosion');
    this.log.push([Math.round(w.hazardClock), 'flip']);
  }

  // project a point onto the Canopy's face plane, clamped to its footprint
  _projectToFace(pos) {
    const c = this.canopy;
    _v2.copy(pos).sub(c.center);
    const c1 = THREE.MathUtils.clamp(_v2.dot(c.t1), -c.w / 2, c.w / 2);
    const c2 = THREE.MathUtils.clamp(_v2.dot(c.t2), -c.d / 2, c.d / 2);
    return c.center.clone().addScaledVector(c.t1, c1).addScaledVector(c.t2, c2);
  }

  tick(dt) {
    const w = this.world, g = this.game;

    if (!this.flipped) {
      // ACT 1 â€” ASCENSION: pull two entries every 4.5s
      if (this.queue.length && this.t >= this.nextPullAt) {
        const n = Math.min(3, this.queue.length);
        for (let i = 0; i < n; i++) this.rumbling.push({ entry: this.queue.shift(), t: 0 });
        this.nextPullAt = this.t + 2.4;
        this.log.push([Math.round(w.hazardClock), 'launch']);
      }
      // rumble, then launch
      for (let i = this.rumbling.length - 1; i >= 0; i--) {
        const r = this.rumbling[i];
        r.t += dt;
        this._rumbleFx(r.entry, r.t);
        if (r.t >= 1.0) { this._launch(r.entry); this.rumbling.splice(i, 1); }
      }
      // the Canopy shakes harder as the queue empties
      const progress = 1 - this.queue.length / this.totalQueue;
      const amp = 0.05 + 0.35 * progress;
      this.canopy.slab.position.set(
        this.canopyHome.x + (Math.random() - 0.5) * 2 * amp,
        this.canopyHome.y + (Math.random() - 0.5) * 2 * amp,
        this.canopyHome.z + (Math.random() - 0.5) * 2 * amp
      );
    }

    // launched visuals fly up, accelerating, until they clear the sky
    for (let i = this.launching.length - 1; i >= 0; i--) {
      const l = this.launching[i];
      l.vy += 30 * dt;
      const mesh = this._meshOf(l.entry);
      mesh.position.y += l.vy * dt;
      mesh.rotation.x += l.spinX * dt;
      mesh.rotation.z += l.spinZ * dt;
      if (mesh.position.y > 150) { mesh.visible = false; this.launching.splice(i, 1); }
    }

    // ACT 2 â€” THE FLIP: once, after the queue is drained and airborne
    if (!this.flipped && this.queue.length === 0 && this.rumbling.length === 0 && this.launching.length === 0) {
      this._flip();
    }

    // ACT 3 â€” STATIC DISCHARGE: strikes on the Canopy's face, ramping up
    if (this.flipped) {
      if (this.nextStrikeAt === null) this.nextStrikeAt = this.t;
      if (this.t >= this.nextStrikeAt) {
        const period = Math.max(1.5, 3.5 - (this.t - this.flipT) * 0.05);
        this.nextStrikeAt = this.t + period;
        for (const v of this.pool._defaultVictims()) {
          if (!v || !v.alive) continue;
          const p = this._projectToFace(v.position);
          this.pool.spawn(p, { r: 5, dmg: 18, kb: 12, color: 0x55e8ff, warnT: 1.2, normal: this.canopy.normal });
        }
        this.log.push([Math.round(w.hazardClock), 'strike']);
      }
    }
    this.pool.update(dt);
  }
}

export const BELT = {
  id: 'belt',
  name: 'SHATTERED BELT',
  blurb: 'graviton rocks Â· gravity plates',

  env: {
    gravityMul: 1,
    sunDir: [0.55, 0.3, -0.78],
    sunColor: 0xd0dcff,
    sunIntensity: 2.0,
    hemi: [0x46527e, 0x2c2648, 0.95],
    fog: { color: '#20264a', near: 100, far: 620 },
    sky: {
      zenith: '#0d1226', mid: '#1c2244', horizon: '#40305e', sun: '#eef2ff',
      starHeight: 0.0, starDensity: 0.99, aurora: 0.25, auroraColor: 0x8844aa,
    },
    glow: [
      { scale: 280, opacity: 0.55, color: 0xcfdcff },
      { scale: 130, opacity: 0.9, color: 0xf6f8ff },
    ],
    clouds: { tintA: 0x2c2646, tintB: 0x463a62, low: 8, far: 6, high: 3 },
    motes: { color: 0xb8c8f0, count: 280 },
    palette: {
      grassA: '#3a3e52', grassB: '#4a4f68', grassWarm: '#5a4a7a',
      dirt: '#2e2a3e', rockA: '#4a4658', rockB: '#302c3e', rockTip: '#1e1a2a',
      stone: '#5e5a72', stoneDark: '#423e54',
      leafA: '#3a4a6a', leafB: '#4a5e82', leafWarmA: '#5a3a7a', leafWarmB: '#7a50a0',
      crystalA: 0x55e8ff, crystalB: 0xa060ff,
    },
  },

  // conventional islands host spawns and enemy waves (bare, rocky)
  islands: [
    { x: 0, z: 0, topY: 0, R: 13, domeH: 1.0, depth: 18, seed: 501, bare: true, trees: 0, rocks: 5, crystals: 2 },
    { x: 46, z: 18, topY: 8, R: 9, domeH: 0.9, depth: 14, seed: 513, bare: true, trees: 0, rocks: 3, crystals: 1 },
    { x: -40, z: 30, topY: 14, R: 8, domeH: 0.9, depth: 13, seed: 527, bare: true, trees: 0, rocks: 3, crystals: 1 },
    { x: -46, z: -22, topY: 4, R: 10, domeH: 1.0, depth: 15, seed: 539, bare: true, trees: 0, rocks: 4, crystals: 2 },
    { x: 12, z: -48, topY: 18, R: 8, domeH: 0.9, depth: 13, seed: 551, bare: true, trees: 0, rocks: 3, crystals: 1 },
    { x: 30, z: 52, topY: -6, R: 9, domeH: 0.9, depth: 14, seed: 563, bare: true, trees: 0, rocks: 3, crystals: 1 },
    { x: 58, z: -24, topY: -2, R: 8, domeH: 0.9, depth: 13, seed: 575, bare: true, trees: 0, rocks: 2, crystals: 1 },
  ],

  platformSeed: 909,
  platforms: [
    { x: 20, z: 34, baseY: 10, R: 3, amp: 1.2, speed: 0.3, phase: 0, orbit: { cx: 0, cz: 0, r: 39, angSpeed: 0.06, phase: 1.04 } },
    { x: -18, z: -40, baseY: 8, R: 3.2, amp: 1.0, speed: 0.35, phase: 2, orbit: { cx: 0, cz: 0, r: 44, angSpeed: -0.05, phase: 4.29 } },
    { x: 44, z: -6, baseY: 16, R: 2.8, amp: 1.2, speed: 0.3, phase: 4, orbit: { cx: 0, cz: 0, r: 44, angSpeed: 0.055, phase: -0.14 } },
  ],

  // decorative boulders on the islands are solid here (they read as terrain)
  solidRocks: true,

  // graviton plates â€” crystalline purple slabs with ONE-directional gravity:
  // the field over each face pulls straight onto it. Spread across the whole
  // belt in varying sizes and wild angles: ramps, a sideways wall you stand
  // on like a floor, and a near-upside-down ceiling you walk under flipped.
  gravPlates: [
    { x: -16, y: 17, z: 18, w: 9, d: 9, yaw: 0.4, tilt: 0.35 },
    { x: 38, y: 22, z: 38, w: 12, d: 12, yaw: 2.1, tilt: -0.3 },   // the grand plaza
    { x: -12, y: 9, z: -40, w: 10, d: 10, yaw: 5.5, tilt: 0.5 },
    { x: 16, y: 33, z: 30, w: 7, d: 7, yaw: 3.6, tilt: -0.75 },
    { x: -34, y: 13, z: -4, w: 8, d: 8, yaw: 0.8, tilt: 1.45 },    // the WALL: face points sideways
    { x: 54, y: 17, z: -36, w: 11, d: 11, yaw: 1.2, tilt: 3.0 },   // the CEILING: near upside-down
    { x: -42, y: 26, z: 44, w: 9, d: 9, yaw: 4.2, tilt: 0.9 },     // steep ramp
    { x: 24, y: 14, z: 6, w: 6, d: 6, yaw: 2.8, tilt: 0.2 },       // little hop-stone
    { x: 2, y: 28, z: -18, w: 13, d: 13, yaw: 1.7, tilt: -0.5 },   // the big tilted crown
    // THE CANOPY: a colossal jagged shard crowning the whole map â€” bigger
    // than the main island â€” hanging high, face-down. Fly up under it and it
    // catches you; you walk its underside with the entire belt overhead.
    { x: 4, y: 62, z: 4, w: 32, d: 32, yaw: 0.9, tilt: Math.PI - 0.1, sides: 7, squash: 0.55, canopy: true },
  ],

  makeOvertime(world, game) {
    return new CanopyOvertime(world, game);
  },

  spawns: {
    solo: [0, 3, 8],
    duel: [[44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2]],
    ffa: [[0, 3, 8, 0], [44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2], [-44, 7, -20, -0.5]],
  },
};
