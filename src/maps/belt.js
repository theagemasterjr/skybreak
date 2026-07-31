import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shattered Belt: an asteroid field drifting in deep-space dusk. Gravity is
// weak everywhere (gravityMul), and GRAVITON ROCKS — glowing ringed
// asteroids — bend your personal gravity toward them when you're close:
// land on them, sprint around their surface, slingshot away. Gravity snaps
// back to normal the moment you leave a rock's influence.
// ---------------------------------------------------------------------------

export const BELT = {
  id: 'belt',
  name: 'SHATTERED BELT',
  blurb: 'low gravity · graviton rocks',

  env: {
    gravityMul: 0.45,
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

  // graviton rocks — spherical: walk all the way around them. r = surface
  // radius; the field extends r + 10 (see World._buildGravRocks). Their pull
  // ramps up hard inside the field: jumping won't escape, dashing will.
  gravRocks: [
    { x: 22, y: 12, z: 8, r: 5 },
    { x: 4, y: 26, z: -18, r: 6 },
    { x: -30, y: 10, z: -2, r: 4 },
    { x: 52, y: 14, z: -34, r: 5.5 },
    { x: -38, y: 24, z: 40, r: 4.5 },
  ],

  // graviton plates — flat purple slabs with ONE-directional gravity: the
  // field above each face pulls straight down onto it (some are tilted)
  gravPlates: [
    { x: -14, y: 17, z: 16, w: 9, d: 7, yaw: 0.4, tilt: 0.35 },
    { x: 34, y: 21, z: 34, w: 8, d: 8, yaw: 2.1, tilt: -0.3 },
    { x: -10, y: 9, z: -36, w: 10, d: 6, yaw: 5.5, tilt: 0.5 },
    { x: 14, y: 32, z: 30, w: 8, d: 6, yaw: 3.6, tilt: 0.15 },
  ],

  spawns: {
    solo: [0, 3, 8],
    duel: [[44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2]],
    ffa: [[0, 3, 8, 0], [44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2], [-44, 7, -20, -0.5]],
  },
};
