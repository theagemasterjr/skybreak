// Shattered Belt physics: gravity direction/strength, graviton-rock capture,
// and classic-map parity (vector gravity must be identical to the old
// straight-down pull away from rocks). Run: node test/belt-test.mjs

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
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };

const THREE = await import('three');
const { World } = await import('../src/world.js');
const { Player } = await import('../src/player.js');
const { MAP_DEFS } = await import('../src/maps/index.js');

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL', m); };
const ok = (m) => console.log('  ok', m);

const inputStub = { down: () => false, pressed: () => false, consumeLook: () => [0, 0], altDown: () => false };
const camStub = new THREE.PerspectiveCamera();

const scene = new THREE.Scene();
const belt = new World(scene, MAP_DEFS.belt);
const dir = new THREE.Vector3();

// (a) far from any rock: plain down, belt strength
let mul = belt.gravityAt(new THREE.Vector3(0, 200, 0), dir);
if (dir.distanceTo(new THREE.Vector3(0, -1, 0)) > 1e-6) fail(`far gravity dir ${dir.toArray()}`);
if (Math.abs(mul - 0.45) > 1e-9) fail(`belt gravity mul ${mul}`);

// (b) right beside a rock surface: gravity points at its center
const rk = MAP_DEFS.belt.gravRocks[0];
const probe = new THREE.Vector3(rk.x + rk.r + 0.5, rk.y, rk.z);
belt.gravityAt(probe, dir);
const toCenter = new THREE.Vector3(rk.x, rk.y, rk.z).sub(probe).normalize();
if (dir.angleTo(toCenter) > 0.15) fail(`near-rock gravity off by ${dir.angleTo(toCenter)} rad`);
ok('gravity field (far + near rock)');

// (c) a player dropped near a rock gets captured and stands on its surface
{
  const p = new Player(belt, camStub, inputStub);
  p.position.set(rk.x + rk.r + 3, rk.y + 2, rk.z);
  p.vel.set(0, 0, 0);
  for (let i = 0; i < 600; i++) p.update(1 / 60, i / 60);
  const d = p.position.distanceTo(new THREE.Vector3(rk.x, rk.y, rk.z));
  if (Math.abs(d - rk.r) > 0.3) fail(`player not on rock surface: dist ${d.toFixed(2)} vs r ${rk.r}`);
  if (!p.grounded || !p._onRock) fail(`player not grounded on rock (grounded=${p.grounded}, onRock=${p._onRock})`);
  const radial = p.position.clone().sub(new THREE.Vector3(rk.x, rk.y, rk.z)).normalize();
  if (p.up.angleTo(radial) > 0.25) fail(`up not radial: ${p.up.angleTo(radial)} rad`);
  ok('rock capture: lands, stands, up is radial');
}

// (d) classic parity: vector gravity == old scalar gravity away from rocks
{
  const classic = new World(new THREE.Scene(), MAP_DEFS.classic);
  const p = new Player(classic, camStub, inputStub);
  p.position.set(0, 30, 8);   // free fall over the main island
  p.vel.set(0, 0, 0);
  p.update(1 / 60, 0);
  // one step of plain gravity: vel.y = -30 * dt exactly, no sideways drift
  if (Math.abs(p.vel.y - (-30 / 60)) > 1e-9) fail(`classic gravity step ${p.vel.y} != ${-30 / 60}`);
  if (p.vel.x !== 0 || p.vel.z !== 0) fail('classic gravity gained sideways drift');
  if (p.up.distanceTo(new THREE.Vector3(0, 1, 0)) > 1e-6) fail('classic up drifted');
  ok('classic-map gravity parity');
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
