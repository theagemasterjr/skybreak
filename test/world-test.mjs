// Headless world/map checks: every map def builds, disposes cleanly, has
// ground under every spawn point, and (once hazards exist) runs the same
// seeded hazard schedule twice. Run: node test/world-test.mjs
//
// world.js touches `document` only for procedural canvas textures, so a tiny
// 2d-context stub is enough to build full worlds under Node.

const ctx2dStub = {
  fillStyle: '', font: '', textAlign: '',
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
  quadraticCurveTo() {}, closePath() {}, fill() {}, arc() {}, stroke() {},
  fillText() {},
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2dStub }),
};

const THREE = await import('three');
const { World } = await import('../src/world.js');
const { MAPS, MAP_DEFS } = await import('../src/maps/index.js');

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL', msg); };
const ok = (msg) => console.log('  ok', msg);

for (const id of MAPS) {
  const def = MAP_DEFS[id];
  const scene = new THREE.Scene();
  const before = scene.children.length;

  let world;
  try {
    world = new World(scene, def);
    world.dispose();
    world = new World(scene, def);       // double build/dispose: leak check
  } catch (e) {
    fail(`${id}: build threw: ${e.stack}`);
    continue;
  }

  // spawns must have ground beneath them
  const sp = world.soloSpawn;
  if (world.groundHeightBelow(sp.x, sp.z, sp.y + 1, 0, 3) === null) {
    fail(`${id}: solo spawn floats`);
  }
  for (const set of [def.spawns.duel, def.spawns.ffa]) {
    for (const s of set) {
      if (world.groundHeightBelow(s[0], s[2], s[1] + 1, 0, 3.5) === null) {
        fail(`${id}: spawn [${s}] has no ground`);
      }
    }
  }

  // sim update must not throw
  const fakeGame = { state: 'playing' };
  world._game = fakeGame;
  world.resetHazards(7);
  for (let i = 0; i < 600; i++) world.update(1 / 60, i / 60);

  // hazard determinism: identical seed -> identical first events
  if (def.makeHazards) {
    const runs = [];
    for (let r = 0; r < 2; r++) {
      world._game = fakeGame;
      world.resetHazards(7);
      world.hazards.log = [];
      for (let i = 0; i < 60 * 45; i++) world.update(1 / 60, i / 60);
      runs.push(JSON.stringify(world.hazards.log.slice(0, 4)));
    }
    if (runs[0] !== runs[1]) fail(`${id}: hazards not deterministic\n  a=${runs[0]}\n  b=${runs[1]}`);
    else ok(`${id} hazards deterministic ${runs[0]}`);
  }

  world.dispose();
  if (scene.children.length !== before) {
    fail(`${id}: leaked ${scene.children.length - before} scene nodes after dispose`);
  }
  ok(id);
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
