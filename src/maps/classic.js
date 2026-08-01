import * as THREE from 'three';
import { Overtime, StrikePool } from '../overtime.js';

// ---------------------------------------------------------------------------
// Classic map: the original sunset sky-islands ("Sky Sanctum"). Every value
// here is extracted verbatim from the pre-map-system world.js so this map
// stays pixel-identical to the game as it shipped.
//
// OVERTIME — SKYFALL: meteors smash the satellite islands into the void one
// by one; once only the main island stands, the sky starts aiming at YOU —
// red warning rings, then impact blasts, faster and faster. Once the
// satellites are gone, a second kind of meteor starts landing on the main
// island itself: four telegraphed hits, each carving a ring of ground off
// the rim (world.reshapeIsland regenerates the terrain mesh + collision
// smaller, and drops any trees/rocks now hanging past the new edge), until
// only the ruin's own footprint is left standing.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();

class SkyfallOvertime extends Overtime {
  begin() {
    const w = this.world;
    // the big one (R 30) is spared; satellites die in seeded-shuffle order
    this.main = w.islands.reduce((a, b) => (b.R > a.R ? b : a));
    this.queue = w.islands.filter((i) => i !== this.main);
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(w.hazardRng() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.marks = [];      // {island, t, ring, pillar} — doom telegraphs
    this.meteors = [];    // {mesh, shell, from, to, t, dur, island}
    this.sinking = [];    // {island, t, spin}
    this.strikes = new StrikePool(w, this.game);
    this.nextMeteorAt = this.t + 2.5;
    this.nextStrikeAt = null;
    this.phase2At = this.queue.length ? null : this.t + 3;

    // main-island siege: once the satellites are gone, 4 telegraphed hits
    // carve the main island down, ring by ring, to the ruin's footprint
    this.mainStageR = [24, 19, 16, 13];  // successive radii after each hit
    this.mainHitIdx = 0;
    this.mainAssaultAt = this.phase2At;  // mirrors phase2At — set for real below
    this.nextMainHitAt = null;
    this.mainMark = null;                // {t, ring, pillar, target}
    this.mainMeteor = null;              // {mesh, shell, from, to, t, dur, stageR}
    this.mainDebris = [];                // {mesh, vy, spin} — dropped decorations

    // the little stepping-stone platforms can't take the strain: they all
    // shake loose immediately, a rapid-fire cascade right at the bell
    // (seeded order; the dais discs on the main island have no mesh and stay)
    const stones = w.platforms.filter((p) => p.mesh);
    for (let i = stones.length - 1; i > 0; i--) {
      const j = Math.floor(w.hazardRng() * (i + 1));
      [stones[i], stones[j]] = [stones[j], stones[i]];
    }
    this.stoneDrops = stones.map((p, i) => ({ p, at: this.t + 0.6 + i * 0.3 }));
    this.fallingStones = [];   // {mesh, vy, spin}
  }

  // step 1 of an island's doom: a pulsing red mark + light pillar, so
  // everyone sees WHERE before anything falls
  _markIsland(island) {
    const w = this.world;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(island.R * 0.55, island.R * 0.8, 36),
      new THREE.MeshBasicMaterial({
        color: 0xff3b30, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(island.x, island.topY + island.domeH + 0.6, island.z);
    w.hazardFx.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(island.R * 0.35, island.R * 0.55, 120, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff5a40, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    pillar.position.set(island.x, island.topY + 60, island.z);
    w.hazardFx.add(pillar);
    this.marks.push({ island, t: 1.6, ring, pillar });
    this.game.audio?.play('windup');
  }

  // main-island siege, step 1: a tighter telegraph centered on the rim
  // chunk about to be blasted away (not the whole island — just a bite)
  _markMainChunk(target) {
    const w = this.world;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.5, 9, 28),
      new THREE.MeshBasicMaterial({
        color: 0xff3b30, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(target);
    w.hazardFx.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 5, 120, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff5a40, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    pillar.position.set(target.x, this.main.topY + 60, target.z);
    w.hazardFx.add(pillar);
    this.mainMark = { t: 1.6, ring, pillar, target: target.clone() };
    this.game.audio?.play('windup');
  }

  // main-island siege, step 2: the fireball, aimed at the rim instead of
  // the island's heart
  _launchMainMeteor(target, stageR) {
    const w = this.world;
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe0b0, fog: false })
    );
    group.add(core);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff6a20, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    group.add(shell);
    // NO PointLight here either — same shader-recompile-freeze reason as
    // the satellite meteors above.
    const from = target.clone().add(_v1.set(
      (w.hazardRng() - 0.5) * 80, 140, (w.hazardRng() - 0.5) * 80
    ));
    group.position.copy(from);
    w.hazardFx.add(group);
    this.mainMeteor = { mesh: group, shell, from, to: target.clone(), t: 0, dur: 1.8, stageR };
    this.game.audio?.play('explosion');
  }

  // step 2: the fireball — big, slow enough to watch, trailing fire
  _launchMeteor(island) {
    const w = this.world;
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe0b0, fog: false })
    );
    group.add(core);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff6a20, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    group.add(shell);
    // NO PointLight here: adding/removing dynamic lights mid-fight forces
    // three.js to recompile every material in the scene — a hard freeze per
    // meteor. The additive shell + trail glows carry the fire look instead.
    const to = new THREE.Vector3(island.x, island.topY + 1, island.z);
    const from = to.clone().add(_v1.set(
      (w.hazardRng() - 0.5) * 80, 140, (w.hazardRng() - 0.5) * 80
    ));
    group.position.copy(from);
    w.hazardFx.add(group);
    this.meteors.push({ mesh: group, shell, from, to, t: 0, dur: 1.8, island });
    this.game.audio?.play('explosion');
  }

  tick(dt) {
    const w = this.world, g = this.game;

    // stepping stones shake loose and drop away
    for (let i = this.stoneDrops.length - 1; i >= 0; i--) {
      const d = this.stoneDrops[i];
      if (this.t < d.at) continue;
      this.stoneDrops.splice(i, 1);
      const pos = d.p.mesh.position.clone();
      g.effects.burst(pos.clone(), { count: 10, color: 0xbfa78a, color2: 0x8a7a63, speed: 5, size: 0.3, life: 0.5, gravity: 6, additive: false });
      g.audio?.play('land');
      w.removePlatform(d.p);
      this.fallingStones.push({ mesh: d.p.mesh, vy: 1, spin: (w.hazardRng() - 0.5) * 1.6 });
      this.log.push([Math.round(w.hazardClock), 'stone']);
    }
    for (let i = this.fallingStones.length - 1; i >= 0; i--) {
      const f = this.fallingStones[i];
      f.vy += 24 * dt;
      f.mesh.position.y -= f.vy * dt;
      f.mesh.rotation.x += f.spin * dt;
      f.mesh.rotation.z += f.spin * 0.7 * dt;
      if (f.mesh.position.y < -120) { f.mesh.visible = false; this.fallingStones.splice(i, 1); }
    }

    // schedule the next satellite's doom (mark first, meteor follows)
    if (this.queue.length && this.t >= this.nextMeteorAt) {
      const island = this.queue.shift();
      this.nextMeteorAt = this.t + 5;
      this._markIsland(island);
      this.log.push([Math.round(w.hazardClock), 'meteor']);
      if (!this.queue.length) {
        this.phase2At = this.t + 8;
        this.mainAssaultAt = this.phase2At;
      }
    }

    // doom marks pulse, then summon the meteor
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mk = this.marks[i];
      mk.t -= dt;
      mk.ring.material.opacity = 0.3 + 0.35 * Math.abs(Math.sin(mk.t * 10));
      mk.ring.rotation.z += dt * 1.5;
      mk.pillar.material.opacity = 0.06 + 0.06 * Math.abs(Math.sin(mk.t * 10));
      if (mk.t <= 0) {
        w.hazardFx.remove(mk.ring); w.hazardFx.remove(mk.pillar);
        mk.ring.geometry.dispose(); mk.ring.material.dispose();
        mk.pillar.geometry.dispose(); mk.pillar.material.dispose();
        this.marks.splice(i, 1);
        this._launchMeteor(mk.island);
      }
    }

    // meteors fall — big, burning, impossible to miss
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      m.mesh.position.lerpVectors(m.from, m.to, k * k);   // accelerating fall
      m.shell.scale.setScalar(1 + Math.sin(m.t * 30) * 0.12);
      // fire trail: embers + smoke puffs streaming off the rock
      if (Math.random() < dt * 80) {
        g.effects.glow(m.mesh.position.clone(), { color: 0xffa050, size: 2.6, life: 0.4, grow: 1.4 });
      }
      if (Math.random() < dt * 30) {
        g.effects.burst(m.mesh.position.clone(), {
          count: 4, color: 0xff8a30, color2: 0x553322, speed: 5, size: 0.4, life: 0.5, gravity: -2,
        });
      }
      if (k >= 1) {
        g.effects.impactBurst(m.to.clone(), { color: 0xff8a40, size: 9 });
        g.effects.burst(m.to.clone(), { count: 70, color: 0xff9a40, color2: 0x442211, speed: 18, size: 0.5, life: 0.8 });
        g.effects.ring(m.to.clone(), { color: 0xff7a30, endRadius: m.island.R + 8, life: 0.6, thickness: 0.8 });
        g.hud?.flash('rgba(255, 110, 40, 0.18)', 0.35);
        g.player.shake(Math.max(0.35, 1 - g.player.position.distanceTo(m.to) / 110));
        g.audio?.play('explosion');
        w.removeIsland(m.island);
        this.sinking.push({ island: m.island, t: 0, spin: (w.hazardRng() - 0.5) * 0.8 });
        w.hazardFx.remove(m.mesh);
        m.mesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this.meteors.splice(i, 1);
      }
    }

    // struck islands break loose and sink into the void
    for (let i = this.sinking.length - 1; i >= 0; i--) {
      const s = this.sinking[i];
      s.t += dt;
      const grp = s.island.group;
      if (grp) {
        grp.position.y -= (4 + s.t * 22) * dt;
        grp.rotation.x += s.spin * dt;
        grp.rotation.z += s.spin * 0.6 * dt;
        if (s.t > 2.8) { grp.visible = false; this.sinking.splice(i, 1); }
      } else this.sinking.splice(i, 1);
    }

    // phase 2: the sky bombards the last island — pressure, not damage: a
    // telegraphed shove that pushes you around (and can push you off the
    // shrinking island into the void), never a health hit. dmg: 0 keeps the
    // existing knockback (applyKnockback is called separately in StrikePool
    // regardless of dmg) while stripping the chip damage entirely.
    if (this.phase2At !== null && this.t >= this.phase2At) {
      if (this.nextStrikeAt === null) this.nextStrikeAt = this.t;
      if (this.t >= this.nextStrikeAt) {
        const period = Math.max(1.8, 5 - (this.t - this.phase2At) * 0.08);
        this.nextStrikeAt = this.t + period;
        for (const v of this.strikes._defaultVictims()) {
          if (!v || !v.alive) continue;
          const p = v.position.clone();
          const ground = w.groundHeightBelow(p.x, p.z, p.y + 2, 0, 60);
          p.y = ground ?? this.main.topY;
          this.strikes.spawn(p, { dmg: 0, r: 6 });
        }
        this.log.push([Math.round(w.hazardClock), 'strike']);
      }
    }
    this.strikes.update(dt);

    // phase 3: the main-island siege — schedule the next of 4 chunk-hits
    if (this.mainAssaultAt !== null && this.mainHitIdx < this.mainStageR.length) {
      if (this.nextMainHitAt === null) this.nextMainHitAt = this.mainAssaultAt;
      if (!this.mainMark && !this.mainMeteor && this.t >= this.nextMainHitAt) {
        const stageR = this.mainStageR[this.mainHitIdx];
        const angle = w.hazardRng() * Math.PI * 2;
        const midR = (this.main.R + stageR) / 2;
        const target = new THREE.Vector3(
          this.main.x + Math.cos(angle) * midR,
          this.main.topY + this.main.domeH + 0.6,
          this.main.z + Math.sin(angle) * midR
        );
        this._markMainChunk(target);
        this.mainMark.stageR = stageR;
        this.log.push([Math.round(w.hazardClock), 'mainmark']);
      }
    }

    // main-chunk telegraph pulses, then summons the meteor
    if (this.mainMark) {
      const mk = this.mainMark;
      mk.t -= dt;
      mk.ring.material.opacity = 0.3 + 0.35 * Math.abs(Math.sin(mk.t * 10));
      mk.ring.rotation.z += dt * 1.5;
      mk.pillar.material.opacity = 0.06 + 0.06 * Math.abs(Math.sin(mk.t * 10));
      if (mk.t <= 0) {
        w.hazardFx.remove(mk.ring); w.hazardFx.remove(mk.pillar);
        mk.ring.geometry.dispose(); mk.ring.material.dispose();
        mk.pillar.geometry.dispose(); mk.pillar.material.dispose();
        this._launchMainMeteor(mk.target, mk.stageR);
        this.mainMark = null;
      }
    }

    // the main-island meteor falls, then carves the chunk off on impact
    if (this.mainMeteor) {
      const m = this.mainMeteor;
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      m.mesh.position.lerpVectors(m.from, m.to, k * k);
      m.shell.scale.setScalar(1 + Math.sin(m.t * 30) * 0.12);
      // cosmetic trail cadence: Math.random, NOT hazardRng — per-frame draws
      // from the seeded stream would desync it across framerates/clients
      if (Math.random() < dt * 80) {
        g.effects.glow(m.mesh.position.clone(), { color: 0xffa050, size: 2.6, life: 0.4, grow: 1.4 });
      }
      if (Math.random() < dt * 30) {
        g.effects.burst(m.mesh.position.clone(), {
          count: 4, color: 0xff8a30, color2: 0x553322, speed: 5, size: 0.4, life: 0.5, gravity: -2,
        });
      }
      if (k >= 1) {
        g.effects.impactBurst(m.to.clone(), { color: 0xff8a40, size: 9 });
        g.effects.burst(m.to.clone(), { count: 70, color: 0xff9a40, color2: 0x442211, speed: 18, size: 0.5, life: 0.8 });
        g.effects.ring(m.to.clone(), { color: 0xff7a30, endRadius: 14, life: 0.6, thickness: 0.8 });
        g.hud?.flash('rgba(255, 110, 40, 0.18)', 0.35);
        g.player.shake(Math.max(0.35, 1 - g.player.position.distanceTo(m.to) / 110));
        g.audio?.play('explosion');
        // no takeDamage here by design: the threat is the shrinking ground
        // and the void, not the meteor itself — never touches duelist bots
        const dropped = w.reshapeIsland(this.main, m.stageR);
        for (const child of dropped) {
          this.mainDebris.push({ mesh: child, vy: 1 + w.hazardRng() * 2, spin: (w.hazardRng() - 0.5) * 1.6 });
        }
        this.log.push([Math.round(w.hazardClock), 'mainhit', Math.round(m.stageR)]);
        w.hazardFx.remove(m.mesh);
        m.mesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this.mainMeteor = null;
        this.mainHitIdx++;
        this.nextMainHitAt = this.mainHitIdx < this.mainStageR.length ? this.t + 6.5 : null;
      }
    }

    // debris shaken loose by the shrinking main island tumbles into the void
    for (let i = this.mainDebris.length - 1; i >= 0; i--) {
      const f = this.mainDebris[i];
      f.vy += 24 * dt;
      f.mesh.position.y -= f.vy * dt;
      f.mesh.rotation.x += f.spin * dt;
      f.mesh.rotation.z += f.spin * 0.7 * dt;
      if (f.mesh.position.y < -120) { f.mesh.visible = false; this.mainDebris.splice(i, 1); }
    }
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
