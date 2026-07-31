// ---------------------------------------------------------------------------
// Classic map: the original sunset sky-islands ("Sky Sanctum"). Every value
// here is extracted verbatim from the pre-map-system world.js so this map
// stays pixel-identical to the game as it shipped.
// ---------------------------------------------------------------------------

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

  spawns: {
    solo: [0, 4, 8],
    duel: [[0, 4.5, 22, 0], [0, 4.5, -22, Math.PI]],
    ffa: [[0, 4.5, 22, 0], [0, 4.5, -22, Math.PI], [22, 4.5, 0, Math.PI / 2], [-22, 4.5, 0, -Math.PI / 2]],
  },
};
