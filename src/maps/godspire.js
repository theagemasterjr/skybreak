import * as THREE from 'three';
import { Overtime, StrikePool } from '../overtime.js';

// ---------------------------------------------------------------------------
// The Godspire: one colossal ruined marble tower under a bright noon sky.
// No scripted hazard — the map IS the gimmick: a spiral of ledges winding up
// the outside, broken bridges to satellite islands, slowly orbiting rubble
// as moving stepping stones, and a beacon crown at the very top. Fight for
// the high ground; knock the others off it.
// ---------------------------------------------------------------------------

const TOWER_H = 70;
const TOWER_R_BASE = 14;
const TOWER_R_TOP = 9;
const towerR = (y) => TOWER_R_BASE - (TOWER_R_BASE - TOWER_R_TOP) * (y / TOWER_H);

// a walkable marble disc: mesh into root + a platform collider. motion gives
// it life: amp/speed/phase = rise and fall, spin = slow rotation (cosmetic —
// discs are round, so spinning never changes the collision)
function addLedge(world, root, mat, x, z, baseY, R, motion = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.08, 0.7, 12), mat);
  mesh.position.set(x, baseY, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  world.platforms.push({
    x, z, baseY, R,
    amp: motion.amp ?? 0, speed: motion.speed ?? 0, phase: motion.phase ?? 0,
    orbit: motion.orbit, mesh,
  });
}

// ---------------------------------------------------------------------------
// OVERTIME — THE COLLAPSE: the spire sheds its ledges from the crown down —
// each one rumbles, then shatters. The satellites crumble next. When nothing
// is left but the base, the ruin itself bombards the survivors with marble.
// ---------------------------------------------------------------------------
const _o1 = new THREE.Vector3();

class CollapseOvertime extends Overtime {
  begin() {
    const w = this.world;
    // ledges die top-down, funneling the fight downward — but the CROWN at
    // the very top survives: the last high ground is part of the drama
    this.queue = w.platforms
      .filter((p) => p.baseY < TOWER_H)
      .sort((a, b) => b.baseY - a.baseY);
    this.islandQueue = w.islands
      .filter((i) => i.R < 15)
      .sort((a, b) => b.topY - a.topY);
    this.rumbling = [];    // {p | island, t}
    this.sinking = [];     // {island, t, spin}
    this.strikes = new StrikePool(w, this.game);
    this.nextAt = this.t + 2;
    this.nextStrikeAt = null;
    this.bombardAt = null;

    // ---- THE FINALE: the base island drops, then the spire itself sheds
    // its drum sections bottom-to-top, herding whoever's left up to the
    // crown — the last surface standing. Kicks off a beat after bombardment
    // starts (once the ledges/satellites are already gone), and runs its
    // course while the round is still very plausibly live.
    this.baseIsland = w.islands.find((isl) => isl.R >= 15) || w.islands[0];
    this.sections = (w._spireSections || []).slice().sort((a, b) => a.yBottom - b.yBottom);
    this.sectionIdx = 0;
    this.sectionRumble = null;     // {sec, t}
    this.sectionSinking = [];      // {group, t, spin}
    this.finaleAt = null;
    this.finaleStage = 'wait';     // wait -> islandRumble -> islandSink -> spire -> done
    this.islandRumbleT = 0;
    this.islandSinking = null;     // {t, spin}
    this.nextSectionAt = null;
  }

  tick(dt) {
    const w = this.world, g = this.game;

    // schedule the next collapse — TWO ledges at a time, on a quick clock
    // (the whole spire should come down in ~25s, not a minute)
    if (this.t >= this.nextAt && (this.queue.length || this.islandQueue.length)) {
      this.nextAt = this.t + Math.max(1.0, 2.0 - this.t * 0.03);
      for (let n = 0; n < 2; n++) {
        if (this.queue.length) {
          const p = this.queue.shift();
          this.rumbling.push({ p, t: 0.9, home: p.mesh ? p.mesh.position.clone() : null });
          this.log.push([Math.round(w.hazardClock), 'ledge']);
        } else if (this.islandQueue.length) {
          const island = this.islandQueue.shift();
          this.rumbling.push({ island, t: 0.9 });
          this.log.push([Math.round(w.hazardClock), 'island']);
        }
      }
      if (!this.queue.length && !this.islandQueue.length) this.bombardAt = this.t + 3;
      g.audio?.play('windup');
    }

    // rumble, then shatter / crumble
    for (let i = this.rumbling.length - 1; i >= 0; i--) {
      const r = this.rumbling[i];
      r.t -= dt;
      if (r.p && r.p.mesh) {
        r.p.mesh.position.x = r.home.x + (Math.random() - 0.5) * 0.3;
        r.p.mesh.position.z = r.home.z + (Math.random() - 0.5) * 0.3;
      } else if (r.island?.group) {
        r.island.group.position.x = (Math.random() - 0.5) * 0.4;
        r.island.group.position.z = (Math.random() - 0.5) * 0.4;
      }
      if (r.t > 0) continue;
      this.rumbling.splice(i, 1);
      if (r.p) {
        const pos = r.p.mesh ? r.p.mesh.position.clone()
          : _o1.set(r.p.x, r.p.baseY, r.p.z).clone();
        g.effects.impactBurst(pos.clone(), { color: 0xd8cfc0, size: 3.5 });
        g.effects.burst(pos.clone(), { count: 26, color: 0xd8cfc0, color2: 0x8a7f70, speed: 9, size: 0.35, life: 0.6, gravity: 12, additive: false });
        g.audio?.play('explosion');
        w.removePlatform(r.p);
        if (r.p.mesh) r.p.mesh.visible = false;
        g.player.shake(Math.max(0.1, 1 - g.player.position.distanceTo(pos) / 70));
      } else {
        g.effects.impactBurst(_o1.set(r.island.x, r.island.topY, r.island.z).clone(), { color: 0xd8cfc0, size: 5 });
        g.audio?.play('explosion');
        w.removeIsland(r.island);
        this.sinking.push({ island: r.island, t: 0, spin: (w.hazardRng() - 0.5) * 0.7 });
      }
    }

    // crumbled satellites sink
    for (let i = this.sinking.length - 1; i >= 0; i--) {
      const s = this.sinking[i];
      s.t += dt;
      const grp = s.island.group;
      if (grp) {
        grp.position.y -= (3 + s.t * 20) * dt;
        grp.rotation.x += s.spin * dt;
        if (s.t > 3) { grp.visible = false; this.sinking.splice(i, 1); }
      } else this.sinking.splice(i, 1);
    }

    // endgame: marble rubble bombardment on the base island
    if (this.bombardAt !== null && this.t >= this.bombardAt) {
      if (this.nextStrikeAt === null) this.nextStrikeAt = this.t;
      if (this.t >= this.nextStrikeAt) {
        this.nextStrikeAt = this.t + Math.max(1.6, 4 - (this.t - this.bombardAt) * 0.1);
        for (const v of this.strikes._defaultVictims()) {
          if (!v || !v.alive) continue;
          const p = v.position.clone();
          const ground = w.groundHeightBelow(p.x, p.z, p.y + 2, 0, 80);
          p.y = ground ?? 0;
          this.strikes.spawn(p, { dmg: 24, r: 5.5, color: 0xd8cfc0 });
        }
        this.log.push([Math.round(w.hazardClock), 'rubble']);
      }
    }
    this.strikes.update(dt);

    // ---- THE FINALE ----
    // arm once bombardment has started (ledges + satellites already gone);
    // let a couple of rubble volleys land first, then take the ground away
    if (this.finaleAt === null && this.bombardAt !== null) this.finaleAt = this.bombardAt + 8;

    if (this.finaleStage === 'wait' && this.finaleAt !== null && this.t >= this.finaleAt) {
      this.finaleStage = 'islandRumble';
      this.islandRumbleT = 1.4;
      this.bombardAt = null;   // the rubble stops; the ground itself is going
      this.log.push([Math.round(w.hazardClock), 'finale']);
      g.audio?.play('windup');
      g.player.shake(0.3);
    }

    if (this.finaleStage === 'islandRumble') {
      this.islandRumbleT -= dt;
      if (this.baseIsland?.group) {
        this.baseIsland.group.position.x = (Math.random() - 0.5) * 0.5;
        this.baseIsland.group.position.z = (Math.random() - 0.5) * 0.5;
      }
      if (this.islandRumbleT <= 0) {
        this.finaleStage = 'islandSink';
        const pos = _o1.set(this.baseIsland.x, this.baseIsland.topY, this.baseIsland.z).clone();
        g.effects.impactBurst(pos.clone(), { color: 0xd8cfc0, size: 6 });
        g.effects.burst(pos.clone(), { count: 40, color: 0xd8cfc0, color2: 0x8a7f70, speed: 11, size: 0.4, life: 0.7, gravity: 12, additive: false });
        g.audio?.play('explosion');
        g.player.shake(Math.max(0.25, 1 - g.player.position.distanceTo(pos) / 90));
        w.removeIsland(this.baseIsland);
        this.islandSinking = { t: 0, spin: (w.hazardRng() - 0.5) * 0.5 };
        this.log.push([Math.round(w.hazardClock), 'baseIsland']);
        this.nextSectionAt = this.t + 2.5;   // the spire starts shedding shortly after
      }
    }

    if (this.islandSinking) {
      const s = this.islandSinking;
      s.t += dt;
      const grp = this.baseIsland.group;
      if (grp) {
        grp.position.y -= (2.5 + s.t * 16) * dt;
        grp.rotation.x += s.spin * dt;
        if (s.t > 3.2) { grp.visible = false; this.islandSinking = null; }
      } else this.islandSinking = null;
    }

    // the spire sheds its sections lowest-first, on a readable cadence — a
    // brief rumble + red glow telegraph before each one lets go
    if (this.finaleStage === 'islandSink' && this.nextSectionAt !== null
      && this.t >= this.nextSectionAt && !this.sectionRumble && this.sectionIdx < this.sections.length) {
      this.sectionRumble = { sec: this.sections[this.sectionIdx], t: 1.1 };
      this.log.push([Math.round(w.hazardClock), 'section']);
      g.audio?.play('windup');
    }
    if (this.sectionIdx >= this.sections.length && this.finaleStage === 'islandSink' && !this.sectionRumble) {
      this.finaleStage = 'done';
    }

    if (this.sectionRumble) {
      const r = this.sectionRumble;
      r.t -= dt;
      const sec = r.sec;
      sec.group.position.x = (Math.random() - 0.5) * 0.35;
      sec.group.position.z = (Math.random() - 0.5) * 0.35;
      sec.mat.emissiveIntensity = Math.max(0, 1.6 - r.t) * (0.6 + 0.4 * Math.abs(Math.sin(this.t * 16)));
      if (r.t <= 0) {
        const midY = (sec.yBottom + sec.yTop) / 2;
        const pos = _o1.set(0, midY, 0).clone();
        g.effects.impactBurst(pos.clone(), { color: 0xd8cfc0, size: 4.5 });
        g.effects.burst(pos.clone(), { count: 30, color: 0xd8cfc0, color2: 0x8a7f70, speed: 10, size: 0.4, life: 0.7, gravity: 14, additive: false });
        g.audio?.play('explosion');
        g.player.shake(Math.max(0.15, 1 - g.player.position.distanceTo(pos) / 60));
        const ci = w.columns.indexOf(sec.column);
        if (ci >= 0) w.columns.splice(ci, 1);
        sec.group.position.set(0, 0, 0);
        sec.mat.emissiveIntensity = 0;
        this.sectionSinking.push({ group: sec.group, t: 0, spin: (w.hazardRng() - 0.5) * 0.6 });
        this.sectionIdx++;
        this.sectionRumble = null;
        this.nextSectionAt = this.t + 3.2;
      }
    }

    for (let i = this.sectionSinking.length - 1; i >= 0; i--) {
      const s = this.sectionSinking[i];
      s.t += dt;
      const grp = s.group;
      grp.position.y -= (3 + s.t * 18) * dt;
      grp.rotation.z += s.spin * dt;
      if (s.t > 3) { grp.visible = false; this.sectionSinking.splice(i, 1); }
    }
  }
}

export const GODSPIRE = {
  id: 'godspire',
  name: 'THE GODSPIRE',
  blurb: 'own the high ground',

  env: {
    sunDir: [0.2, 0.75, -0.6],
    sunColor: 0xfff4d8,
    sunIntensity: 2.9,
    hemi: [0xbdd4f0, 0x8a9a7a, 1.0],
    fog: { color: '#b8cce0', near: 130, far: 700 },
    sky: {
      zenith: '#2e5da8', mid: '#7aa8d8', horizon: '#e8f0f8', sun: '#fff8e0',
      starHeight: 1.1, starDensity: 0.99999, aurora: 0,
    },
    glow: [
      { scale: 420, opacity: 0.45, color: 0xfff0c8 },
      { scale: 180, opacity: 0.8, color: 0xfffcf0 },
    ],
    clouds: { tintA: 0xffffff, tintB: 0xeef4ff, low: 20, far: 14, high: 9 },
    motes: { color: 0xfff4d0, count: 180 },
    palette: {
      grassA: '#4a8a4f', grassB: '#6aa858', grassWarm: '#9aa84a',
      dirt: '#a08868', rockA: '#b0a494', rockB: '#8a7f70', rockTip: '#6a5f52',
      stone: '#d8cfc0', stoneDark: '#a89a88',
      crystalA: 0xffd76a, crystalB: 0x7be8ff,
    },
  },

  // wide base island + three satellites at bridge heights
  islands: [
    { x: 0, z: 0, topY: 0, R: 22, domeH: 1.2, depth: 30, seed: 301, trees: 5, rocks: 5, crystals: 2 },
    { x: Math.cos(0.3) * 40, z: Math.sin(0.3) * 40, topY: 16, R: 9, domeH: 1.0, depth: 15, seed: 313, trees: 2, rocks: 2, crystals: 1 },
    { x: Math.cos(2.4) * 40, z: Math.sin(2.4) * 40, topY: 28, R: 8, domeH: 1.0, depth: 14, seed: 327, trees: 2, rocks: 2, crystals: 1 },
    { x: Math.cos(4.5) * 40, z: Math.sin(4.5) * 40, topY: 40, R: 9, domeH: 1.0, depth: 15, seed: 339, trees: 2, rocks: 2, crystals: 1 },
  ],

  // orbiting rubble: moving stepping stones circling the spire
  platformSeed: 707,
  platforms: [
    { x: 22, z: 0, baseY: 12, R: 3.2, amp: 0.5, speed: 0.4, phase: 0, orbit: { cx: 0, cz: 0, r: 22, angSpeed: 0.13, phase: 0 } },
    { x: 24, z: 0, baseY: 24, R: 2.8, amp: 0.5, speed: 0.5, phase: 1, orbit: { cx: 0, cz: 0, r: 24, angSpeed: -0.11, phase: 2.1 } },
    { x: 21, z: 0, baseY: 36, R: 3.4, amp: 0.6, speed: 0.4, phase: 2, orbit: { cx: 0, cz: 0, r: 21, angSpeed: 0.15, phase: 4.2 } },
    { x: 23, z: 0, baseY: 48, R: 2.6, amp: 0.5, speed: 0.6, phase: 3, orbit: { cx: 0, cz: 0, r: 23, angSpeed: -0.12, phase: 1.3 } },
    { x: 19, z: 0, baseY: 58, R: 3.0, amp: 0.5, speed: 0.5, phase: 4, orbit: { cx: 0, cz: 0, r: 19, angSpeed: 0.16, phase: 5.5 } },
    { x: 17, z: 0, baseY: 66, R: 2.6, amp: 0.4, speed: 0.5, phase: 5, orbit: { cx: 0, cz: 0, r: 17, angSpeed: -0.14, phase: 3.0 } },
  ],

  build(world, root, rng) {
    // ---- the tower: stacked tapering marble drums, solid to walk against ----
    const marbleA = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.85, flatShading: true });
    const marbleB = new THREE.MeshStandardMaterial({ color: 0xc4b8a6, roughness: 0.9, flatShading: true });
    const SEGS = 5;
    // each drum + its cornice ring lives in its own group, on its OWN cloned
    // material — so the overtime finale can sink one section and pulse its
    // material red as a telegraph without touching the other four (which
    // would happen if they all shared the same marbleA/marbleB instance)
    world._spireSections = [];
    for (let i = 0; i < SEGS; i++) {
      const y0 = (i / SEGS) * TOWER_H;
      const y1 = ((i + 1) / SEGS) * TOWER_H;
      const segMat = (i % 2 ? marbleB : marbleA).clone();
      segMat.emissive = new THREE.Color(0xff5a30);
      segMat.emissiveIntensity = 0;
      const segGroup = new THREE.Group();
      root.add(segGroup);

      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR(y1), towerR(y0) * 1.02, y1 - y0, 14),
        segMat
      );
      drum.position.y = (y0 + y1) / 2;
      drum.castShadow = true;
      drum.receiveShadow = true;
      segGroup.add(drum);
      // ring cornice between drums
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR(y1) + 0.7, towerR(y1) + 0.7, 0.8, 14),
        segMat
      );
      ring.position.y = y1;
      ring.castShadow = true;
      segGroup.add(ring);

      const column = { x: 0, z: 0, r: towerR(y0), yBottom: y0, yTop: y1 };
      world.columns.push(column);
      world._spireSections.push({ group: segGroup, mat: segMat, column, yBottom: y0, yTop: y1 });
    }

    // ---- spiral ledges winding up the outside: alive — rising, falling,
    // and slowly ORBITING the tower, each on its own rhythm ----
    for (let i = 0; i < 14; i++) {
      const y = 4 + i * 4.6;
      const a = 0.5 + i * 0.9;
      const r = towerR(y) + 2.1;
      addLedge(world, root, marbleA, Math.cos(a) * r, Math.sin(a) * r, y, 3.1, {
        amp: 0.9 + (i % 3) * 0.3, speed: 0.3 + (i % 4) * 0.07, phase: i * 1.3,
        orbit: { cx: 0, cz: 0, r, angSpeed: (i % 2 ? 0.09 : -0.07) + (i % 3) * 0.01, phase: a },
      });
    }
    // two dueling balconies circling at mid-height, opposite each other
    // (orbit phase = their spawn angle, so round-start spawns land on them)
    addLedge(world, root, marbleB, 16, 0, 22.5, 3.6, {
      amp: 0.7, speed: 0.35, phase: 0,
      orbit: { cx: 0, cz: 0, r: 16, angSpeed: 0.05, phase: 0 },
    });
    addLedge(world, root, marbleB, -16, 0, 22.5, 3.6, {
      amp: 0.7, speed: 0.35, phase: 0,
      orbit: { cx: 0, cz: 0, r: 16, angSpeed: 0.05, phase: Math.PI },
    });

    // ---- broken bridges toward the satellite islands ----
    const bridges = [
      { a: 0.3, y: 17.5 }, { a: 2.4, y: 29.5 }, { a: 4.5, y: 41.5 },
    ];
    let bIdx = 0;
    for (const b of bridges) {
      const from = towerR(b.y) + 1.5;
      for (let i = 0; i < 4; i++) {
        // skip one span per bridge so it reads "broken" (a real jump)
        if (i === 2) continue;
        const d = from + 4 + i * 7.5;
        // each bridge breathes as one (shared phase), gently
        addLedge(world, root, marbleB, Math.cos(b.a) * d, Math.sin(b.a) * d, b.y - i * 0.5, 2.3, {
          amp: 0.45, speed: 0.3, phase: bIdx * 2.1,   // bob only: bridges must keep pointing at their islands
        });
      }
      bIdx++;
    }

    // ---- the crown: top platform + pulsing beacon (the fixed prize) ----
    addLedge(world, root, marbleA, 0, 0, TOWER_H + 0.5, 6.2);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xffd76a, emissive: 0xffb830, emissiveIntensity: 1.8,
      roughness: 0.25, metalness: 0.2, flatShading: true,
    });
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), beaconMat);
    beacon.position.set(0, TOWER_H + 3.6, 0);
    root.add(beacon);
    const beaconLight = new THREE.PointLight(0xffd76a, 30, 40, 2);
    beaconLight.position.set(0, TOWER_H + 4, 0);
    root.add(beaconLight);
    world.crystals.push(beaconMat);   // rides the crystal pulse
  },

  makeOvertime(world, game) {
    return new CollapseOvertime(world, game);
  },

  spawns: {
    solo: [0, 3, 14],
    duel: [[16, 24, 0, Math.PI / 2], [-16, 24, 0, -Math.PI / 2]],
    ffa: [[0, 3, 14, 0], [16, 24, 0, Math.PI / 2], [-16, 24, 0, -Math.PI / 2], [0, 72.5, 0, Math.PI]],
  },
};
