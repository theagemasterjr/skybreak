// Headless world/map checks: every map def builds, disposes cleanly, has
// ground under every spawn point, and (once hazards exist) runs the same
// seeded hazard schedule twice. Run: node test/world-test.mjs
//
// world.js touches `document` only for procedural canvas textures, so a tiny
// 2d-context stub is enough to build full worlds under Node.

const ctx2dStub = {
  fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
  quadraticCurveTo() {}, closePath() {}, fill() {}, arc() {}, ellipse() {},
  stroke() {}, fillText() {},
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

  // sim update must not throw (hazards touch the player/effects/audio)
  const fakeGame = {
    state: 'playing', simTime: 0, enemies: [],
    player: {
      alive: true, position: new THREE.Vector3(0, 200, 0), vel: new THREE.Vector3(),
      windBoostT: 0, slowFall() {}, takeDamage() {}, applyKnockback() {},
    },
    effects: { glow() {}, ring() {}, beam() {}, burst() {}, impactBurst() {} },
    hud: { flash() {} },
    audio: { play() {} },
    hitstop() {},
  };
  world._game = fakeGame;
  world.resetHazards(7);
  for (let i = 0; i < 600; i++) world.update(1 / 60, i / 60);

  // hazard determinism: identical seed -> identical first events
  if (def.makeHazards) {
    const runs = [];
    for (let r = 0; r < 2; r++) {
      world._game = fakeGame;
      world.resetHazards(7);
      world.hazards.log ??= [];   // hazard classes seed this in their constructors
      for (let i = 0; i < 60 * 45; i++) world.update(1 / 60, i / 60);
      runs.push(JSON.stringify(world.hazards.log.slice(0, 6)));
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

// ---- orbiting platform mechanics (map-independent) ----
{
  const scene = new THREE.Scene();
  const world = new World(scene, MAP_DEFS.classic);
  const p = {
    x: 0, z: 0, baseY: 10, R: 3, amp: 0, speed: 0, phase: 0, mesh: null,
    orbit: { cx: 0, cz: 0, r: 80, angSpeed: 0.5, phase: 0 },
  };
  world.platforms.push(p);
  // at t=0 the platform sits at (20, 0); ground should exist there
  const y0 = world.groundHeightBelow(80, 0, 12, 0, 1);
  if (y0 === null) fail('orbit: no ground at t=0 position');
  // at t=PI (half a lap at 0.5 rad/s -> quarter... a=0.5*t) pick t where a=PI: t=2PI
  const t2 = Math.PI * 2; // a = PI -> platform at (-20, 0)
  if (world.groundHeightBelow(-80, 0, 12, t2, 1) === null) fail('orbit: no ground at half-lap position');
  if (world.groundHeightBelow(80, 0, 12, t2, 1) !== null) fail('orbit: stale ground at old position');
  // carry delta ~= r * angSpeed * dt tangentially
  const out = new THREE.Vector3();
  const carried = world.platformCarry(80, 0, y0, 0.016 + 0, 0.016, out);
  if (!carried) fail('orbit: carry not detected');
  const expected = 80 * 0.5 * 0.016;
  if (Math.abs(out.length() - expected) > expected * 0.2) {
    fail(`orbit: carry delta ${out.length().toFixed(4)} != ~${expected.toFixed(4)}`);
  }
  world.dispose();
  ok('orbiting platforms + carry');
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
