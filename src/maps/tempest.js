import * as THREE from 'three';
import { Overtime } from '../overtime.js';

// ---------------------------------------------------------------------------
// Tempest Crown: a ring of rain-dark islands circling the eye of a storm.
// Signature verb: WIND RIVERS — quiet, glowing currents that sling riders
// along their path. They run every which way: a vertical updraft in the eye,
// a sideways arc hugging the ring, a diagonal climb — not everything leads
// to the center.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _seg = new THREE.Vector3();

// wind rivers: polyline corridors (radius r); riding one flings you along it
const WINDS = [
  // updraft: a wind elevator rising through the storm's eye
  { pts: [[2, -4, 4], [0, 8, 2], [-2, 20, 0], [0, 32, -2]], r: 4, speed: 40 },
  // eastern arc: a sideways current sweeping island-to-island along the ring
  { pts: [[26, 10, 38], [44, 9, 22], [52, 7, -2], [44, 6, -24], [26, 8, -40]], r: 3.5, speed: 46 },
  // western climb: a diagonal river that gains height as it crosses
  { pts: [[-42, 8, -6], [-20, 14, -16], [4, 20, -26], [24, 27, -38]], r: 3.5, speed: 44 },
];

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

    // wind streak particles (visual): sparse, dim — a suggestion, not a show
    this.streaks = [];
    for (const w of this.winds) {
      const N = 24;
      const pos = new Float32Array(N * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0x9fd8ff, size: 0.4, transparent: true, opacity: 0.32,
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
    // whisper-faint ribbons so the corridors are discoverable up close
    for (const w of this.winds) {
      const curve = new THREE.CatmullRomCurve3(w.pts.map((p) => p.clone()));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, w.r * 0.7, 7, false),
        new THREE.MeshBasicMaterial({
          color: 0x6aa8e8, transparent: true, opacity: 0.025,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      world.hazardFx.add(tube);
    }

    // ambient storm flicker (no strikes — just the sky grumbling)
    this.flickerT = 0;
    this.nextFlickerAt = 3 + world.hazardRng() * 6;
  }

  // the nearest river point within reach, or null:
  // { closest, tangent, speed } — everything needed to ride the current
  grabAt(pos) {
    let best = null, bestD2 = Infinity;
    for (const w of this.winds) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i], b = w.pts[i + 1];
        _seg.copy(b).sub(a);
        const t = Math.max(0, Math.min(1, _v1.copy(pos).sub(a).dot(_seg) / _seg.lengthSq()));
        _v2.copy(a).addScaledVector(_seg, t);
        const d2 = pos.distanceToSquared(_v2);
        if (d2 < w.r * w.r && d2 < bestD2) {
          bestD2 = d2;
          best = { closest: _v2.clone(), tangent: _seg.clone().normalize(), speed: w.speed };
        }
      }
    }
    return best;
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

    // ---- wind: the current GRABS you and carries you along its path ----
    // Velocity is steered smoothly toward "flow along the river + drift back
    // to its axis", so you follow the curve instead of getting chucked in a
    // straight line. A dash overrides your velocity entirely (dash code owns
    // it every frame), so dashing is always your way out — but end a dash
    // inside the current and it takes hold again.
    const p = g.player;
    const grab = (p.alive && p.dashTimer <= 0) ? this.grabAt(p.position) : null;
    if (grab) {
      _v1.copy(grab.tangent).multiplyScalar(grab.speed)
        .addScaledVector(_v2.copy(grab.closest).sub(p.position), 2.2);
      p.vel.lerp(_v1, 1 - Math.exp(-5 * dt));
      p.windBoostT = 0.25;
      p.slowFall(0.2);
      if (Math.random() < dt * 6) {
        g.effects.glow(p.position.clone().add(_v2.set(0, 1, 0)), { color: 0x9fd8ff, size: 0.5, life: 0.12 });
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

    // ---- sky-wide flicker: the storm grumbles, but never strikes ----
    if (this.flickerT > 0) {
      this.flickerT -= dt;
      world.sun.intensity = world.sunBaseIntensity * (this.flickerT > 0 ? 1.9 : 1);
    }
    if (clock >= this.nextFlickerAt) {
      this.nextFlickerAt = clock + 5 + world.hazardRng() * 6;
      this.flickerT = 0.12;
    }
  }
}

// ---------------------------------------------------------------------------
// OVERTIME — THE STORM: a visible wall of storm closes on the eye. Caught
// outside it, you're battered by gusts and struck by lightning on a rhythm
// that only gets faster. The calm shrinks until there's almost nowhere left.
// ---------------------------------------------------------------------------
class StormOvertime extends Overtime {
  begin() {
    const w = this.world;
    this.R = 90;
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x6a7ac0, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 140, 48, 1, true), wallMat);
    this.wall.position.y = 20;
    w.hazardFx.add(this.wall);
    this.wallInner = new THREE.Mesh(this.wall.geometry, wallMat.clone());
    this.wallInner.material.opacity = 0.08;
    this.wallInner.position.y = 20;
    w.hazardFx.add(this.wallInner);
    this.bolts = new Map();      // victim -> {nextAt, warnT}
    this.log.push([Math.round(w.hazardClock), 'storm']);
  }

  _victims() {
    const out = [this.game.player];
    if (this.game.mode === 'botduel') {
      for (const e of this.game.enemies) if (e.type === 'duelist') out.push(e);
    }
    return out;
  }

  tick(dt) {
    const w = this.world, g = this.game;
    // wall closes: 90 -> 7 over 60s, then grinds on toward 3
    this.R = this.t < 60
      ? 90 - (83 / 60) * this.t
      : Math.max(3, 7 - (this.t - 60) * 0.1);
    this.wall.scale.set(this.R, 1, this.R);
    this.wallInner.scale.set(this.R * 0.96, 1, this.R * 0.96);
    this.wall.rotation.y += dt * 0.15;

    const period = Math.max(0.9, 2.4 - this.t * 0.02);
    for (const v of this._victims()) {
      if (!v || !v.alive) continue;
      const inside = Math.hypot(v.position.x, v.position.z) < this.R;
      let st = this.bolts.get(v);
      if (!st) {
        st = { nextAt: this.t + 1.2, warnT: -1, gustDir: new THREE.Vector3(1, 0, 0), gustVy: 0, gustNextAt: 0 };
        this.bolts.set(v, st);
      }
      if (inside) { st.warnT = -1; st.nextAt = Math.max(st.nextAt, this.t + 0.8); continue; }

      // chaotic wind drag: caught in the storm, you get pulled around in a
      // direction that wanders every 1-2s (a "gust"), not shoved in one line.
      // Gusts only push LOCAL actors (local-model forces, like all hazard
      // shoves here) — draw count varies per client, which is fine since no
      // shared state depends on this rng stream after the storm schedule.
      if (this.t >= st.gustNextAt) {
        const ang = w.hazardRng() * Math.PI * 2;
        st.gustDir.set(Math.cos(ang), 0, Math.sin(ang));
        st.gustVy = (w.hazardRng() - 0.5) * 2;               // -1..1, mostly mild vertical shove
        st.gustNextAt = this.t + 1 + w.hazardRng() * 1.2;     // resample every 1-2.2s
      }

      // gust buffeting: shoved around while in the storm (player locally;
      // the bot via its brainVel so it fights the same wind the player does)
      const isPlayer = v === g.player;
      const GUST_A = 28, GUST_AY = 10;
      const gv = isPlayer ? v.vel : v.brainVel;
      if (gv) {
        gv.x += st.gustDir.x * GUST_A * dt;
        gv.z += st.gustDir.z * GUST_A * dt;
        gv.y += st.gustVy * GUST_AY * dt;
      }
      if (isPlayer) v.windBoostT = 0.2;
      if (Math.random() < dt * 3) {
        g.effects.glow(_v1.copy(v.position).add(_v2.set(st.gustDir.x, 0.6, st.gustDir.z)).clone(), {
          color: 0x9fd8ff, size: 0.4, life: 0.18,
        });
      }

      if (st.warnT >= 0) {
        st.warnT -= dt;
        if (Math.random() < dt * 20) {
          g.effects.glow(_v1.copy(v.position).add(_v2.set(0, 8, 0)).clone(), { color: 0xcfe0ff, size: 1.6, life: 0.15 });
        }
        if (st.warnT <= 0) {
          // STRIKE
          const hit = _v1.copy(v.position); hit.y += 1;
          const top = hit.clone(); top.y += 60;
          g.effects.beam(top, hit.clone(), { color: 0xcfe0ff, radius: 0.3, life: 0.18 });
          g.effects.impactBurst(hit.clone(), { color: 0xcfe0ff, size: 3 });
          g.audio?.play('explosion');
          const fling = _v2.set((Math.random() - 0.5), 0, (Math.random() - 0.5));
          if (fling.lengthSq() < 0.01) fling.set(1, 0, 0);
          fling.normalize().multiplyScalar(15).setY(9);
          if (isPlayer) {
            g.hud?.flash('rgba(190, 210, 255, 0.25)', 0.25);
            v.takeDamage(11, hit, {});
            v.applyKnockback(fling.clone());
            v.shake?.(0.5);
          } else {
            v.takeDamage(11, { knockback: fling.clone(), source: 'hazard' });
          }
          st.nextAt = this.t + period;
        }
      } else if (this.t >= st.nextAt) {
        st.warnT = 0.55;
        g.audio?.play('windup');
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

  makeOvertime(world, game) {
    return new StormOvertime(world, game);
  },

  spawns: {
    solo: [44, 6, 0],
    duel: [[44, 6, 0, Math.PI / 2], [-44, 9, 0, -Math.PI / 2]],
    ffa: [[44, 6, 0, Math.PI / 2], [-44, 9, 0, -Math.PI / 2], [22, 12, 38, 0.53], [-22, 15, -38, 0.53 + Math.PI]],
  },
};
