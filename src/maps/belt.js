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
    sunColor: 0xbfd0ff,
    sunIntensity: 1.3,
    hemi: [0x2a3050, 0x1a1428, 0.65],
    fog: { color: '#14182a', near: 100, far: 600 },
    sky: {
      zenith: '#05060e', mid: '#10142a', horizon: '#2a1e3e', sun: '#dfe8ff',
      starHeight: 0.0, starDensity: 0.99, aurora: 0.25, auroraColor: 0x8844aa,
    },
    glow: [
      { scale: 240, opacity: 0.5, color: 0xbfd0ff },
      { scale: 110, opacity: 0.85, color: 0xf0f4ff },
    ],
    clouds: { tintA: 0x201a34, tintB: 0x342a4e, low: 8, far: 6, high: 3 },
    motes: { color: 0x9fb4e8, count: 240 },
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

  // graviton rocks — the map's whole reason to exist. r = surface radius;
  // influence extends r + 10 by default (see World._buildGravRocks)
  gravRocks: [
    { x: 22, y: 12, z: 8, r: 5 },
    { x: -14, y: 18, z: 16, r: 4.5 },
    { x: 4, y: 26, z: -18, r: 6 },
    { x: -30, y: 10, z: -2, r: 4 },
    { x: 34, y: 22, z: 34, r: 5 },
    { x: -38, y: 24, z: 40, r: 4.5 },
    { x: 52, y: 14, z: -34, r: 5.5 },
    { x: -12, y: 8, z: -34, r: 4 },
    { x: 14, y: 34, z: 30, r: 4.5 },
  ],

  spawns: {
    solo: [0, 3, 8],
    duel: [[44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2]],
    ffa: [[0, 3, 8, 0], [44, 11, 18, Math.PI / 2], [-38, 17, 28, -Math.PI / 2], [-44, 7, -20, -0.5]],
  },
};
