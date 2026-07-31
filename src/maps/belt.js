import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shattered Belt: an asteroid field drifting in deep-space dusk. Normal
// gravity in the open — but GRAVITON terrain bends it: glowing ringed
// asteroids you can run all the way around, and purple plates whose fields
// pull one way onto their face. Once a field grips you, only a dash frees
// you; gravity snaps back to plain down the moment you leave.
// ---------------------------------------------------------------------------

export const BELT = {
  id: 'belt',
  name: 'SHATTERED BELT',
  blurb: 'graviton rocks · gravity plates',

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

  // graviton plates — crystalline purple slabs with ONE-directional gravity:
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
    // THE CANOPY: a huge jagged shard crowning the whole map, face-down —
    // fly high enough and it catches you, and you walk its underside upside
    // down with the entire belt hanging overhead
    { x: 4, y: 44, z: 4, w: 17, d: 17, yaw: 0.9, tilt: Math.PI - 0.1, sides: 7, squash: 0.55 },
  ],

  spawns: {
    solo: [0, 3, 8],
    duel: [[44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2]],
    ffa: [[0, 3, 8, 0], [44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2], [-44, 7, -20, -0.5]],
  },
};
