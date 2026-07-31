import * as THREE from 'three';

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
    spin: motion.spin ?? 0, mesh,
  });
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
    for (let i = 0; i < SEGS; i++) {
      const y0 = (i / SEGS) * TOWER_H;
      const y1 = ((i + 1) / SEGS) * TOWER_H;
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR(y1), towerR(y0) * 1.02, y1 - y0, 14),
        i % 2 ? marbleB : marbleA
      );
      drum.position.y = (y0 + y1) / 2;
      drum.castShadow = true;
      drum.receiveShadow = true;
      root.add(drum);
      // ring cornice between drums
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR(y1) + 0.7, towerR(y1) + 0.7, 0.8, 14),
        marbleB
      );
      ring.position.y = y1;
      ring.castShadow = true;
      root.add(ring);
      world.columns.push({ x: 0, z: 0, r: towerR(y0), yBottom: y0, yTop: y1 });
    }

    // ---- spiral ledges winding up the outside: alive — rising, falling,
    // slowly turning, each on its own rhythm ----
    for (let i = 0; i < 14; i++) {
      const y = 4 + i * 4.6;
      const a = 0.5 + i * 0.9;
      const r = towerR(y) + 2.1;
      addLedge(world, root, marbleA, Math.cos(a) * r, Math.sin(a) * r, y, 3.1, {
        amp: 0.9 + (i % 3) * 0.3, speed: 0.3 + (i % 4) * 0.07, phase: i * 1.3,
        spin: i % 2 ? 0.45 : -0.35,
      });
    }
    // two dueling balconies at mid-height, facing each other (phase 0 keeps
    // them at their base height at round start, right under the spawns)
    addLedge(world, root, marbleB, 16, 0, 22.5, 3.6, { amp: 0.7, speed: 0.35, phase: 0, spin: 0.25 });
    addLedge(world, root, marbleB, -16, 0, 22.5, 3.6, { amp: 0.7, speed: 0.35, phase: 0, spin: -0.25 });

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
          amp: 0.45, speed: 0.3, phase: bIdx * 2.1, spin: 0.15,
        });
      }
      bIdx++;
    }

    // ---- the crown: top platform (a slow, majestic turn) + pulsing beacon ----
    addLedge(world, root, marbleA, 0, 0, TOWER_H + 0.5, 6.2, { spin: 0.12 });
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

  spawns: {
    solo: [0, 3, 14],
    duel: [[16, 24, 0, Math.PI / 2], [-16, 24, 0, -Math.PI / 2]],
    ffa: [[0, 3, 14, 0], [16, 24, 0, Math.PI / 2], [-16, 24, 0, -Math.PI / 2], [0, 72.5, 0, Math.PI]],
  },
};
