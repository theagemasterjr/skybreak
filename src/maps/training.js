import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Training Grounds: a calm flat baseplate for tutorials and free practice.
// One flat checker-tiled island, two raised practice platforms, and floating
// golden rings as jump/dash targets. No hazards, no waves.
// ---------------------------------------------------------------------------

// dummy layout (x, z), resolved against the ground at spawn time:
// a firing line of 3, two far targets, one on the raised platform
export const DUMMY_SPOTS = [
  [6, -4], [9, 0], [6, 4],
  [20, -6], [20, 6],
  [12, -10],
];

export const TRAINING = {
  id: 'training',
  name: 'TRAINING GROUNDS',
  blurb: 'a quiet place to practice',

  env: {
    sunDir: [0.35, 0.55, -0.75],
    sunColor: 0xfff2d8,
    sunIntensity: 2.2,
    hemi: [0x9fb4d8, 0xb8a890, 0.95],
    fog: { color: '#c8d4e8', near: 140, far: 700 },
    sky: {
      zenith: '#6d88c8', mid: '#a8b6d8', horizon: '#f2e6c8', sun: '#fff8e8',
      starHeight: 1.1, starDensity: 0.99999, aurora: 0,
    },
    glow: [
      { scale: 320, opacity: 0.4, color: 0xfff0d0 },
      { scale: 150, opacity: 0.7, color: 0xfffaf0 },
    ],
    clouds: { tintA: 0xffffff, tintB: 0xf0f4ff, low: 10, far: 6, high: 4 },
    motes: { color: 0xf0f4ff, count: 120 },
    palette: {
      stone: '#d8d2c4', stoneDark: '#b8b0a0',
    },
  },

  islands: [
    { x: 0, z: 0, topY: 0, R: 26, domeH: 0, depth: 20, seed: 5, flat: true, trees: 0, rocks: 0, crystals: 0 },
  ],

  platformSeed: 321,
  platforms: [
    { x: 12, z: -10, baseY: 4.5, R: 3.5, amp: 0, speed: 0, phase: 0 },
    { x: -12, z: -10, baseY: 7, R: 3.5, amp: 0, speed: 0, phase: 0 },
  ],

  // floating golden rings: jump/dash practice targets (visual only)
  build(world, root) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd76a, emissive: 0xcc9a30, emissiveIntensity: 1.2,
      roughness: 0.4, metalness: 0.3, flatShading: true,
    });
    const spots = [
      [-8, 7, 8, 0.4], [0, 10, 2, 0.0], [8, 13, -4, -0.4],
    ];
    for (const [x, y, z, tilt] of spots) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.16, 8, 20), mat);
      ring.position.set(x, y, z);
      ring.rotation.set(Math.PI / 2 + tilt, 0, 0);
      ring.castShadow = true;
      root.add(ring);
    }
  },

  spawns: {
    solo: [0, 2, 14],
    duel: [[0, 2, 14, 0], [0, 2, -14, Math.PI]],
    ffa: [[0, 2, 14, 0], [0, 2, -14, Math.PI], [14, 2, 0, Math.PI / 2], [-14, 2, 0, -Math.PI / 2]],
  },
};
