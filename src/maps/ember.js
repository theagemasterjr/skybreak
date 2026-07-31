import * as THREE from 'three';
import { Overtime } from '../overtime.js';

// ---------------------------------------------------------------------------
// Ember Reach: obsidian islands hanging over a glowing caldera. Signature
// verb: FIRE GEYSERS on a visible rhythm — pure movement, no damage: catch
// an eruption and it launches you sky-high. The tall blast columns catch
// anyone passing through, and the caldera's heart hosts one giant geyser.
// Phase is a pure function of the hazard clock, so all multiplayer clients
// stay in lockstep.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// vents: resolved onto their island tops at build time
// r = column radius, h = column height (tall!), vy = launch speed
const VENTS = [
  { x: 0, z: 0, r: 4.5, h: 60, vy: 56 },      // THE HEART: the caldera's giant geyser
  { x: 42, z: -8, r: 2.2, h: 36, vy: 34 },
  { x: 50, z: 4, r: 2.2, h: 36, vy: 34 },
  { x: -30, z: 34, r: 2.2, h: 36, vy: 34 },
  { x: -42, z: -20, r: 2.2, h: 36, vy: 34 },
  { x: 8, z: -48, r: 2.2, h: 36, vy: 34 },
];

const CYCLE = 9;        // seconds per full geyser cycle
const WARN_T = 1.5;     // steam warning before the blast
const BLAST_T = 3.2;    // eruption duration — long enough to ride deliberately

class EmberHazards {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.log = [];

    this.vents = VENTS.map((def, i) => {
      const { x, z, r, h, vy } = def;
      const y = world.groundHeightBelow(x, z, 60, 0, 65) ?? 0;
      // fixed per-vent phase offsets (seeded once) stagger the rhythm
      const phase = world.hazardRng() * CYCLE;
      this.log.push([i, Math.round(phase * 100) / 100]);

      // vent dressing: dark rock ring + inner glow disc
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.8, 0.3 + r * 0.08, 7, 14),
        new THREE.MeshStandardMaterial({ color: 0x241f1c, roughness: 1, flatShading: true })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, y + 0.15, z);
      world.hazardFx.add(ring);
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(r * 0.7, 16),
        new THREE.MeshBasicMaterial({
          color: 0xff6a20, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, y + 0.12, z);
      world.hazardFx.add(glow);

      // eruption column (shown during blasts)
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.5, r * 0.9, h, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xff8a30, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      col.position.set(x, y + h / 2, z);
      world.hazardFx.add(col);

      return { x, y, z, r, h, vy, phase, glow, col, launched: new Set() };
    });
  }

  // cycle position for a vent: [0, CYCLE) — blast starts at 0, warn precedes it
  _phase(vent) {
    const t = (this.world.hazardClock + vent.phase) % CYCLE;
    return t;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    for (const v of this.vents) {
      const t = this._phase(v);
      const warning = t >= CYCLE - WARN_T;             // about to blow
      const blasting = t < BLAST_T;

      // visuals
      v.glow.material.opacity = warning ? 0.5 + 0.4 * Math.sin(this.world.hazardClock * 24) : 0.35;
      v.col.material.opacity = blasting ? 0.45 * (1 - t / BLAST_T) + 0.15 : 0;
      if (warning && Math.random() < dt * 14) {
        g.effects.glow(_v1.set(v.x + (Math.random() - 0.5), v.y + 1 + Math.random() * 2, v.z + (Math.random() - 0.5)), {
          color: 0xffaa66, size: 0.8, life: 0.4, grow: 1.2, additive: false,
        });
      }
      if (blasting && Math.random() < dt * 30) {
        g.effects.burst(_v1.set(v.x, v.y + Math.random() * v.h * 0.7, v.z), {
          count: 3, color: 0xff9a40, color2: 0xffd090, speed: 4, size: 0.35, life: 0.3, gravity: -6,
        });
      }

      // eruption start: clear the launched set, thump
      if (t < dt && !v.justBlew) {
        v.justBlew = true;
        v.launched.clear();
        g.effects.impactBurst(_v1.set(v.x, v.y + 1, v.z), { color: 0xff9a40, size: 3 + v.r });
        g.effects.ring(_v1.set(v.x, v.y + 0.4, v.z), { color: 0xff8a30, endRadius: v.r + 2.5, life: 0.4, thickness: 0.4 });
        if (p.position.distanceTo(_v1.set(v.x, v.y, v.z)) < 50) g.audio?.play('explosion');
      } else if (t >= dt) {
        v.justBlew = false;
      }

      if (!blasting) continue;

      // who's in the (tall) column? no damage — geysers only launch
      const inCol = (pos, radius = 0) =>
        pos.y > v.y - 1 && pos.y < v.y + v.h &&
        Math.hypot(pos.x - v.x, pos.z - v.z) < v.r + radius;

      if (p.alive && inCol(p.position, 0.4) && !v.launched.has('me')) {
        v.launched.add('me');
        p.applyKnockback(_v2.set(0, Math.max(0, v.vy - p.vel.y), 0));
        g.effects.ring(p.position.clone(), { color: 0xffb060, endRadius: 3, life: 0.35, axis: 'x', thickness: 0.3 });
        g.audio?.play('doubleJump');
      }
      for (const e of g.enemies) {
        if (!e.alive || e.type === 'duelist' || v.launched.has(e)) continue;
        if (inCol(e.position, e.radius)) {
          v.launched.add(e);
          e.takeDamage(1, { knockback: _v2.set(0, v.vy * 0.6, 0).clone(), source: 'hazard' });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// OVERTIME — THE ERUPTION: the caldera blows. A molten sea rises from below
// and swallows the low ground; lava bombs arc out of the Heart and leave
// burning patches. Nowhere stays safe for long — climb, keep climbing.
// ---------------------------------------------------------------------------
class EruptionOvertime extends Overtime {
  begin() {
    const w = this.world;
    this.lavaY = -92;
    this.sea = new THREE.Mesh(
      new THREE.CircleGeometry(340, 48),
      new THREE.MeshBasicMaterial({ color: 0xff5a20, fog: false })
    );
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = this.lavaY;
    w.hazardFx.add(this.sea);
    this.seaCore = new THREE.Mesh(
      new THREE.CircleGeometry(120, 32),
      new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false })
    );
    this.seaCore.rotation.x = -Math.PI / 2;
    this.seaCore.position.y = this.lavaY + 0.4;
    w.hazardFx.add(this.seaCore);

    this.bombs = [];     // {pos, vel, mesh}
    this.patches = [];   // {pos, r, until}
    this.burnTick = new Map();   // victim -> next shove time
    this.nextBombAt = this.t + 2;
    this.log.push([Math.round(w.hazardClock), 'erupt']);
  }

  _victims() {
    const out = [this.game.player];
    if (this.game.mode === 'botduel') {
      for (const e of this.game.enemies) if (e.type === 'duelist') out.push(e);
    }
    return out;
  }

  _launchBomb(target) {
    const w = this.world, g = this.game;
    const from = new THREE.Vector3(0, 30, 0);
    const T = 1.6;
    const vel = target.clone().sub(from).multiplyScalar(1 / T);
    vel.y += 0.5 * 22 * T;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff7a30, fog: false })
    );
    mesh.position.copy(from);
    w.hazardFx.add(mesh);
    this.bombs.push({ pos: from.clone(), vel, mesh });
    g.audio?.play('windup');
  }

  tick(dt) {
    const w = this.world, g = this.game;
    // the sea rises, ever faster
    this.lavaY += (1.1 + this.t * 0.02) * dt;
    this.sea.position.y = this.lavaY;
    this.seaCore.position.y = this.lavaY + 0.4;

    // seeded bomb schedule: target a random island top with seeded scatter
    if (this.t >= this.nextBombAt) {
      this.nextBombAt = this.t + Math.max(1.4, 3.2 - this.t * 0.03);
      const isl = w.islands.length
        ? w.islands[Math.floor(w.hazardRng() * w.islands.length)]
        : null;
      if (isl) {
        const target = new THREE.Vector3(
          isl.x + (w.hazardRng() - 0.5) * 16,
          isl.topY + 0.5,
          isl.z + (w.hazardRng() - 0.5) * 16
        );
        this._launchBomb(target);
        this.log.push([Math.round(w.hazardClock), 'bomb']);
      }
      // every other volley also hunts the (local) fighters
      this._huntNext = !this._huntNext;
      if (this._huntNext) {
        for (const v of this._victims()) {
          if (v?.alive) this._launchBomb(v.position.clone());
        }
      }
    }

    // bombs fly, land, blast, leave burning patches
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.vel.y -= 22 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      if (Math.random() < dt * 30) {
        g.effects.glow(b.pos.clone(), { color: 0xffa050, size: 0.9, life: 0.2 });
      }
      const ground = w.groundHeightBelow(b.pos.x, b.pos.z, b.pos.y + 1, 0, 2);
      const landed = (ground !== null && b.pos.y <= ground + 0.5) || b.pos.y < this.lavaY || b.pos.y < -100;
      if (!landed) continue;
      const at = b.pos.clone();
      g.effects.impactBurst(at.clone(), { color: 0xff8a40, size: 4 });
      g.effects.ring(at.clone(), { color: 0xff8a30, endRadius: 6, life: 0.4, thickness: 0.4 });
      g.audio?.play('explosion');
      for (const v of this._victims()) {
        if (!v || !v.alive) continue;
        if (v.position.distanceTo(at) > 5.5) continue;
        const kb = v.position.clone().sub(at).setY(0);
        if (kb.lengthSq() < 0.01) kb.set(1, 0, 0);
        kb.normalize().multiplyScalar(14).setY(10);
        if (v === g.player) {
          v.takeDamage(20, at, {});
          v.applyKnockback(kb);
          g.hud?.flash('rgba(255, 120, 40, 0.22)', 0.3);
        } else {
          v.takeDamage(20, { knockback: kb, source: 'hazard' });
        }
      }
      if (ground !== null) this.patches.push({ pos: at, r: 3.4, until: this.t + 6 });
      w.hazardFx.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      this.bombs.splice(i, 1);
    }

    // burning ground + the molten sea
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      if (this.t > p.until) { this.patches.splice(i, 1); continue; }
      if (Math.random() < dt * 10) {
        g.effects.glow(p.pos.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * p.r * 1.6, 0.4, (Math.random() - 0.5) * p.r * 1.6
        )), { color: 0xff8a30, size: 0.8, life: 0.3, grow: 1.2 });
      }
    }
    for (const v of this._victims()) {
      if (!v || !v.alive) continue;
      const isPlayer = v === this.game.player;
      // lava contact: heavy burn + an upward shove you can ride out
      if (v.position.y < this.lavaY + 0.4) {
        if (isPlayer) {
          v.health -= 22 * dt;
          v.lastDamagedAt = g.simTime;
          if (v.health <= 0) { v.health = 0; v.alive = false; v.onDeath?.(); }
          const next = this.burnTick.get(v) ?? 0;
          if (this.t >= next) {
            this.burnTick.set(v, this.t + 0.7);
            v.vel.y = Math.max(v.vel.y, 18);
            g.hud?.flash('rgba(255, 90, 30, 0.3)', 0.3);
            v.shake?.(0.4);
            g.audio?.play('playerHurt');
          }
        } else {
          v.takeDamage(22 * dt, { source: 'hazard' });
        }
      } else {
        // burning patches: standing in the fire
        for (const p of this.patches) {
          if (Math.abs(v.position.y - p.pos.y) < 2 &&
              Math.hypot(v.position.x - p.pos.x, v.position.z - p.pos.z) < p.r) {
            if (isPlayer) {
              v.health -= 8 * dt;
              v.lastDamagedAt = g.simTime;
              if (v.health <= 0) { v.health = 0; v.alive = false; v.onDeath?.(); }
            } else {
              v.takeDamage(8 * dt, { source: 'hazard' });
            }
            break;
          }
        }
      }
    }
  }
}

export const EMBER = {
  id: 'ember',
  name: 'EMBER REACH',
  blurb: 'ride the geysers, mind the burn',

  env: {
    sunDir: [0.45, 0.25, -0.86],
    sunColor: 0xff9a55,
    sunIntensity: 2.2,
    hemi: [0x8a4535, 0x38201a, 0.8],
    fog: { color: '#8a3a22', near: 95, far: 540 },
    sky: {
      zenith: '#3a1a20', mid: '#7a2e22', horizon: '#ff7a30', sun: '#ffd9a8',
      starHeight: 0.4, starDensity: 0.999, aurora: 0,
    },
    glow: [
      { scale: 460, opacity: 0.5, color: 0xff7a30 },
      { scale: 190, opacity: 0.85, color: 0xffd9a8 },
    ],
    clouds: { tintA: 0x5a4a44, tintB: 0x8a7468, low: 22, far: 12, high: 5 },
    motes: { color: 0xff9a44, count: 300 },
    palette: {
      grassA: '#4a4340', grassB: '#5a4f45', grassWarm: '#7a3520',
      dirt: '#3a3230', rockA: '#2e2a28', rockB: '#181514', rockTip: '#0e0c0b',
      stone: '#4a423c', stoneDark: '#332c28',
      leafA: '#5a3a28', leafB: '#7a4a2a', leafWarmA: '#8a4520', leafWarmB: '#a85a28',
      crystalA: 0xff7a30, crystalB: 0xffb055,
    },
  },

  islands: [
    // the heart: a low central island under the giant geyser
    { x: 0, z: 0, topY: -2, R: 10, domeH: 0.8, depth: 16, seed: 275, trees: 0, rocks: 3, crystals: 2 },
    { x: 46, z: -2, topY: 0, R: 14, domeH: 1.2, depth: 24, seed: 201, trees: 2, rocks: 5, crystals: 2 },
    { x: 14, z: 30, topY: 9, R: 9, domeH: 1.0, depth: 15, seed: 213, trees: 1, rocks: 3, crystals: 1 },
    { x: -30, z: 36, topY: 14, R: 11, domeH: 1.1, depth: 18, seed: 227, trees: 2, rocks: 4, crystals: 2 },
    { x: -44, z: -16, topY: 4, R: 12, domeH: 1.2, depth: 20, seed: 239, trees: 1, rocks: 4, crystals: 1 },
    { x: -8, z: -20, topY: 18, R: 8, domeH: 0.9, depth: 13, seed: 251, trees: 1, rocks: 2, crystals: 1 },
    { x: 8, z: -50, topY: -4, R: 11, domeH: 1.1, depth: 18, seed: 263, trees: 2, rocks: 4, crystals: 2 },
  ],

  platformSeed: 606,
  platforms: [
    { x: 26, z: 16, baseY: 5 }, { x: -12, z: 10, baseY: 8 },
    { x: -30, z: -34, baseY: 2 }, { x: 30, z: -28, baseY: 7 },
  ],

  // the caldera: a vast glowing lava disc far below + magma-vein cracks
  build(world, root, rng) {
    const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5a20, fog: false });
    const lava = new THREE.Mesh(new THREE.CircleGeometry(320, 40), lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = -96;   // just below the multiplayer void-death line
    root.add(lava);
    // hot inner pool
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(120, 28),
      new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false })
    );
    core.rotation.x = -Math.PI / 2;
    core.position.y = -95.5;
    root.add(core);
    // rising heat shimmer handled by motes; add ember pillars of light
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xff6a20, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.7;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(6, 9, 90, 8, 1, true), pillarMat);
      pillar.position.set(Math.cos(a) * 150, -40, Math.sin(a) * 150);
      root.add(pillar);
    }
  },

  makeHazards(world, game) {
    return new EmberHazards(world, game);
  },

  makeOvertime(world, game) {
    return new EruptionOvertime(world, game);
  },

  spawns: {
    solo: [44, 3, 0],
    duel: [[44, 3, 0, Math.PI / 2], [-42, 7, -14, -Math.PI / 2]],
    ffa: [[44, 3, 0, Math.PI / 2], [-42, 7, -14, -Math.PI / 2], [-28, 17, 34, 2.4], [8, -1, -48, -0.16]],
  },
};
