import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Tempest Crown: a ring of rain-dark islands circling the eye of a storm.
// Signature verbs: WIND RIVERS — glowing currents that sling riders across
// the map — and telegraphed LIGHTNING STRIKES on random islands.
// Hazards are deterministic off the world's seeded hazardRng + hazardClock,
// so every multiplayer client sees the same storm.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _seg = new THREE.Vector3();

// wind rivers: polyline corridors (radius r); riding one flings you along it
const WINDS = [
  { pts: [[40, 8, 0], [12, 10, 2], [-12, 12, -2], [-40, 11, 0]], r: 3.5, speed: 46 },
  { pts: [[20, 14, 36], [4, 15, 10], [-6, 16, -12], [-20, 17, -36]], r: 3.5, speed: 46 },
  { pts: [[-20, 20, 36], [-2, 16, 8], [10, 12, -10], [20, 9, -36]], r: 3.5, speed: 46 },
];

const STRIKE_RADIUS = 6;
const STRIKE_DAMAGE = 45;
const TELEGRAPH_T = 2;

class TempestHazards {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.log = [];   // [clock, islandIdx] per telegraph — determinism checks read this

    // precompute wind polylines + cumulative lengths
    this.winds = WINDS.map((w) => {
      const pts = w.pts.map((p) => new THREE.Vector3(...p));
      const lens = [0];
      for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
      return { pts, lens, total: lens[lens.length - 1], r: w.r, speed: w.speed };
    });

    // wind streak particles (visual): advected along each river
    this.streaks = [];
    for (const w of this.winds) {
      const N = 70;
      const pos = new Float32Array(N * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0x9fd8ff, size: 0.65, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const points = new THREE.Points(geo, mat);
      world.hazardFx.add(points);
      const parts = Array.from({ length: N }, () => ({
        d: Math.random() * w.total,
        ox: (Math.random() - 0.5) * w.r * 1.4,
        oy: (Math.random() - 0.5) * w.r * 1.4,
      }));
      this.streaks.push({ w, points, parts });
    }
    // faint ribbon tubes so the corridors read even without particles
    for (const w of this.winds) {
      const curve = new THREE.CatmullRomCurve3(w.pts);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, w.r * 0.75, 7, false),
        new THREE.MeshBasicMaterial({
          color: 0x6aa8e8, transparent: true, opacity: 0.07,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      world.hazardFx.add(tube);
    }

    // lightning state
    this.nextStrikeAt = 10 + world.hazardRng() * 8;   // first bolt comes sooner
    this.telegraph = null;                            // { until, island, pulseT }
    // telegraph disc (repositioned per strike)
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(STRIKE_RADIUS, 26),
      new THREE.MeshBasicMaterial({
        color: 0xfff0a8, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
    );
    this.disc.rotation.x = -Math.PI / 2;
    world.hazardFx.add(this.disc);

    this.flickerT = 0;
    this.nextFlickerAt = 3 + world.hazardRng() * 6;
  }

  // wind velocity at a position (or null): nearest polyline segment within r
  windAt(pos, out) {
    for (const w of this.winds) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i], b = w.pts[i + 1];
        _seg.copy(b).sub(a);
        const len2 = _seg.lengthSq();
        const t = Math.max(0, Math.min(1, _v1.copy(pos).sub(a).dot(_seg) / len2));
        _v2.copy(a).addScaledVector(_seg, t);
        if (pos.distanceToSquared(_v2) < w.r * w.r) {
          out.copy(_seg).normalize().multiplyScalar(w.speed);
          return true;
        }
      }
    }
    return false;
  }

  pointAlong(w, d, out) {
    for (let i = 1; i < w.lens.length; i++) {
      if (d <= w.lens[i] || i === w.lens.length - 1) {
        const t = (d - w.lens[i - 1]) / (w.lens[i] - w.lens[i - 1] || 1);
        return out.copy(w.pts[i - 1]).lerp(w.pts[i], t);
      }
    }
    return out.copy(w.pts[0]);
  }

  update(dt) {
    const world = this.world, g = this.game;
    const clock = world.hazardClock;

    // ---- wind: push the player, raise their speed cap, soften gravity ----
    const p = g.player;
    if (p.alive && this.windAt(p.position, _v1)) {
      p.vel.addScaledVector(_v1, dt * 2.6);
      p.windBoostT = 0.25;
      p.slowFall(0.2);
      if (Math.random() < dt * 20) {
        g.effects.glow(p.position.clone().add(_v2.set(0, 1, 0)), { color: 0x9fd8ff, size: 0.7, life: 0.15 });
      }
    }

    // wind streak particles drift downstream
    for (const s of this.streaks) {
      const posAttr = s.points.geometry.attributes.position;
      for (let i = 0; i < s.parts.length; i++) {
        const part = s.parts[i];
        part.d += s.w.speed * 0.55 * dt;
        if (part.d > s.w.total) part.d -= s.w.total;
        this.pointAlong(s.w, part.d, _v1);
        posAttr.setXYZ(i, _v1.x + part.ox, _v1.y + part.oy, _v1.z + part.ox * 0.5);
      }
      posAttr.needsUpdate = true;
    }

    // ---- sky-wide flicker ----
    if (this.flickerT > 0) {
      this.flickerT -= dt;
      world.sun.intensity = world.sunBaseIntensity * (this.flickerT > 0 ? 1.9 : 1);
    }
    if (clock >= this.nextFlickerAt) {
      this.nextFlickerAt = clock + 5 + world.hazardRng() * 6;
      this.flickerT = 0.12;
    }

    // ---- lightning: telegraph, then strike ----
    if (!this.telegraph && clock >= this.nextStrikeAt) {
      const idx = Math.floor(world.hazardRng() * world.islands.length);
      const isl = world.islands[idx];
      this.telegraph = { until: clock + TELEGRAPH_T, island: isl, pulseT: 0 };
      this.log.push([Math.round(clock * 100) / 100, idx]);
      this.disc.position.set(isl.x, isl.topY + (isl.domeH || 0) + 0.4, isl.z);
      g.audio?.play('chargeStart');
    }
    if (this.telegraph) {
      const T = this.telegraph;
      const left = T.until - clock;
      this.disc.material.opacity = 0.16 + 0.14 * Math.sin(clock * 18);
      T.pulseT -= dt;
      if (T.pulseT <= 0) {
        T.pulseT = 0.4;
        g.effects.ring(this.disc.position.clone(), {
          color: 0xfff0a8, startRadius: STRIKE_RADIUS, endRadius: 1, life: 0.35, opacity: 0.5, thickness: 0.3,
        });
      }
      if (left <= 0) {
        this.telegraph = null;
        this.disc.material.opacity = 0;
        this.nextStrikeAt = clock + 14 + world.hazardRng() * 8;
        this._strike(T.island);
      }
    }
  }

  _strike(isl) {
    const g = this.game;
    const c = new THREE.Vector3(isl.x, isl.topY + (isl.domeH || 0), isl.z);
    const top = c.clone(); top.y += 60;
    g.effects.beam(top, c, { color: 0xfff6d0, radius: 0.5, life: 0.22 });
    g.effects.beam(top, c, { color: 0xaaccff, radius: 1.1, life: 0.14 });
    g.effects.impactBurst(c, { color: 0xfff0a8, size: 6 });
    g.effects.ring(c, { color: 0xcfe0ff, endRadius: STRIKE_RADIUS + 2, life: 0.5, thickness: 0.5 });
    g.hud?.flash('rgba(240, 244, 255, 0.35)', 0.2);
    g.audio?.play('explosion');
    g.hitstop(0.05);
    this.flickerT = 0.14;

    // damage: local player + PvE enemies (never remote avatars — their owners
    // take the same deterministic strike on their own screens)
    const p = g.player;
    if (p.alive && p.position.distanceTo(c) < STRIKE_RADIUS + 1) {
      p.takeDamage(STRIKE_DAMAGE, c, {});
      p.applyKnockback(_v1.set(0, 14, 0));
    }
    for (const e of g.enemies) {
      if (!e.alive || e.type === 'duelist') continue;
      _v1.copy(e.position).setY(e.position.y + (e.height || 1) * 0.5);
      if (_v1.distanceTo(c) < STRIKE_RADIUS + e.radius) {
        e.takeDamage(STRIKE_DAMAGE, { knockback: _v2.set(0, 12, 0), source: 'hazard' });
      }
    }
  }
}

export const TEMPEST = {
  id: 'tempest',
  name: 'TEMPEST CROWN',
  blurb: 'ride the wind, dodge the bolt',

  env: {
    sunDir: [0.3, 0.42, -0.85],
    sunColor: 0x9fb4ff,
    sunIntensity: 1.7,
    hemi: [0x4a5a8a, 0x2e3448, 0.7],
    fog: { color: '#4a5578', near: 90, far: 520 },
    sky: {
      zenith: '#1a2340', mid: '#3a4468', horizon: '#7a86b8', sun: '#cfd8ff',
      starHeight: 0.3, starDensity: 0.9985, aurora: 0,
    },
    glow: [
      { scale: 380, opacity: 0.35, color: 0x8fa4e8 },
      { scale: 160, opacity: 0.6, color: 0xcfd8ff },
    ],
    clouds: { tintA: 0x6a7490, tintB: 0x9aa4c0, low: 30, far: 14, high: 8 },
    motes: { color: 0xaac4ff, count: 200 },
    palette: {
      grassA: '#3a6a5c', grassB: '#4c8a6a', grassWarm: '#5a7a8a',
      dirt: '#4a4a5a', rockA: '#4e5568', rockB: '#333a4c', rockTip: '#20242f',
      stone: '#6a7288', stoneDark: '#4a5062',
      leafA: '#2e5a50', leafB: '#3f7a68', leafWarmA: '#4a6a8a', leafWarmB: '#5c80a0',
      crystalA: 0x66e8ff, crystalB: 0x7f9fff,
    },
  },

  // six islands crowning the storm's eye
  islands: [
    { x: 48, z: 0, topY: 2, R: 13, domeH: 1.3, depth: 22, seed: 101, trees: 3, rocks: 4, crystals: 2 },
    { x: 24, z: 41.6, topY: 8, R: 10, domeH: 1.1, depth: 17, seed: 113, trees: 2, rocks: 3, crystals: 1 },
    { x: -24, z: 41.6, topY: 14, R: 12, domeH: 1.2, depth: 19, seed: 127, trees: 3, rocks: 3, crystals: 2 },
    { x: -48, z: 0, topY: 5, R: 9, domeH: 1.0, depth: 15, seed: 139, trees: 2, rocks: 2, crystals: 1 },
    { x: -24, z: -41.6, topY: 11, R: 11, domeH: 1.2, depth: 18, seed: 151, trees: 3, rocks: 3, crystals: 1 },
    { x: 24, z: -41.6, topY: 3, R: 10, domeH: 1.0, depth: 16, seed: 163, trees: 2, rocks: 3, crystals: 2 },
  ],

  // risky low platforms in the eye itself
  platformSeed: 555,
  platforms: [
    { x: 0, z: 7, baseY: -2 },
    { x: 5, z: -8, baseY: 1 },
    { x: -9, z: -2, baseY: 4 },
  ],

  makeHazards(world, game) {
    return new TempestHazards(world, game);
  },

  spawns: {
    solo: [44, 6, 0],
    duel: [[44, 6, 0, Math.PI / 2], [-44, 9, 0, -Math.PI / 2]],
    ffa: [[44, 6, 0, Math.PI / 2], [-44, 9, 0, -Math.PI / 2], [22, 12, 38, 0.53], [-22, 15, -38, 0.53 + Math.PI]],
  },
};
