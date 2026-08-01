import * as THREE from 'three';
import { Overtime, StrikePool } from '../overtime.js';

// ---------------------------------------------------------------------------
// Classic map: the original sunset sky-islands ("Sky Sanctum"). Every value
// here is extracted verbatim from the pre-map-system world.js so this map
// stays pixel-identical to the game as it shipped.
//
// OVERTIME — SKYFALL: meteors smash the satellite islands into the void one
// by one; once only the main island stands, the sky starts aiming at YOU —
// red warning rings, then impact blasts, faster and faster.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();

class SkyfallOvertime extends Overtime {
  begin() {
    const w = this.world;
    // the big one (R 30) is spared; the satellites all break loose the
    // moment overtime hits — a staggered half-second cascade so the whole
    // sky visibly comes apart at once (seeded order)
    this.main = w.islands.reduce((a, b) => (b.R > a.R ? b : a));
    const doomed = w.islands.filter((i) => i !== this.main);
    for (let i = doomed.length - 1; i > 0; i--) {
      const j = Math.floor(w.hazardRng() * (i + 1));
      [doomed[i], doomed[j]] = [doomed[j], doomed[i]];
    }
    this.drops = doomed.map((island, i) => ({ island, at: this.t + 0.8 + i * 0.5 }));
    this.sinking = [];    // {island, t, spin}
    this.strikes = new StrikePool(w, this.game);
    this.nextStrikeAt = null;
    this.phase2At = this.t + 0.8 + doomed.length * 0.5 + 4;
  }

  tick(dt) {
    const w = this.world, g = this.game;

    // the cascade: each satellite cracks loose on schedule and falls
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (this.t < d.at) continue;
      this.drops.splice(i, 1);
      const c = _v1.set(d.island.x, d.island.topY + 1, d.island.z).clone();
      g.effects.impactBurst(c.clone(), { color: 0xff8a40, size: 6 });
      g.effects.ring(c.clone(), { color: 0xff7a30, endRadius: d.island.R + 5, life: 0.6, thickness: 0.7 });
      g.effects.burst(c.clone(), { count: 30, color: 0xbfa78a, color2: 0x8a7a63, speed: 10, size: 0.45, life: 0.7, gravity: 8, additive: false });
      g.player.shake(Math.max(0.25, 1 - g.player.position.distanceTo(c) / 100));
      g.audio?.play('explosion');
      w.removeIsland(d.island);
      this.sinking.push({ island: d.island, t: 0, spin: (w.hazardRng() - 0.5) * 0.8 });
      this.log.push([Math.round(w.hazardClock), 'fall']);
    }

    // loosed islands sink into the void
    for (let i = this.sinking.length - 1; i >= 0; i--) {
      const s = this.sinking[i];
      s.t += dt;
      const grp = s.island.group;
      if (grp) {
        grp.position.y -= (3 + s.t * 18) * dt;
        grp.rotation.x += s.spin * dt;
        grp.rotation.z += s.spin * 0.6 * dt;
        if (s.t > 3.2) { grp.visible = false; this.sinking.splice(i, 1); }
      } else this.sinking.splice(i, 1);
    }

    // phase 2: the sky bombards the last island
    if (this.t >= this.phase2At) {
      if (this.nextStrikeAt === null) this.nextStrikeAt = this.t;
      if (this.t >= this.nextStrikeAt) {
        const period = Math.max(1.8, 5 - (this.t - this.phase2At) * 0.08);
        this.nextStrikeAt = this.t + period;
        for (const v of this.strikes._defaultVictims()) {
          if (!v || !v.alive) continue;
          const p = v.position.clone();
          const ground = w.groundHeightBelow(p.x, p.z, p.y + 2, 0, 60);
          p.y = ground ?? this.main.topY;
          this.strikes.spawn(p, { dmg: 26, r: 6 });
        }
        this.log.push([Math.round(w.hazardClock), 'strike']);
      }
    }
    this.strikes.update(dt);
  }
}

export const CLASSIC = {
  id: 'classic',
  name: 'SKY SANCTUM',
  blurb: 'the sunset islands',

  env: {
    sunDir: [0.38, 0.30, -0.87],
    sunColor: 0xffd9a3,
    sunIntensity: 2.6,
    hemi: [0x6a79c9, 0xb06a45, 0.85],
    fog: { color: '#d97e55', near: 110, far: 620 },
    sky: {
      zenith: '#2b3a6e', mid: '#8a4a74', horizon: '#ff9a55', sun: '#fff2c4',
      starHeight: 0.22, starDensity: 0.9965, aurora: 0, auroraColor: 0x44ffcc,
    },
    glow: [
      { scale: 500, opacity: 0.55, color: 0xffb36b },
      { scale: 210, opacity: 0.9, color: 0xfff0c0 },
    ],
    clouds: { tintA: 0xffd9c0, tintB: 0xfff5ec, low: 26, far: 12, high: 7 },
    motes: { color: 0xffcf9a, count: 260 },
    palette: {},   // pure defaults
  },

  islands: [
    { x: 0, z: 0, topY: 0, R: 30, domeH: 1.5, depth: 36, seed: 11, ruins: true, trees: 7, rocks: 9, crystals: 3 },
    { x: 58, z: -26, topY: 7, R: 14, domeH: 1.2, depth: 20, seed: 23, trees: 4, rocks: 4, crystals: 1 },
    { x: -52, z: 22, topY: 11, R: 12, domeH: 1.1, depth: 17, seed: 37, trees: 3, rocks: 3, crystals: 2 },
    { x: 18, z: 58, topY: 16, R: 10, domeH: 1.0, depth: 15, seed: 51, trees: 2, rocks: 3, crystals: 1 },
    { x: -38, z: -52, topY: -6, R: 13, domeH: 1.2, depth: 18, seed: 67, trees: 4, rocks: 4, crystals: 1 },
    { x: 62, z: 38, topY: -2, R: 9, domeH: 0.9, depth: 13, seed: 83, trees: 2, rocks: 2, crystals: 1 },
  ],

  // platforms with no explicit R/amp/speed/phase roll them from the map's
  // platform rng, preserving the exact original random sequence
  platformSeed: 999,
  platforms: [
    { x: 30, z: -14, baseY: 5 }, { x: 44, z: 4, baseY: 3 }, { x: -28, z: 2, baseY: 7 },
    { x: -45, z: -18, baseY: 1 }, { x: -10, z: -38, baseY: -2 }, { x: 12, z: 36, baseY: 9 },
    { x: -22, z: 42, baseY: 13 }, { x: 38, z: 52, baseY: 7 }, { x: 56, z: 8, baseY: 2 },
    { x: -2, z: 55, baseY: 14 }, { x: -48, z: -36, baseY: -3 }, { x: 24, z: -44, baseY: 4 },
  ],

  makeOvertime(world, game) {
    return new SkyfallOvertime(world, game);
  },

  spawns: {
    solo: [0, 4, 8],
    duel: [[0, 4.5, 22, 0], [0, 4.5, -22, Math.PI]],
    ffa: [[0, 4.5, 22, 0], [0, 4.5, -22, Math.PI], [22, 4.5, 0, Math.PI / 2], [-22, 4.5, 0, -Math.PI / 2]],
  },
};
