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

// (a) far from any rock: plain down, plain strength (belt is normal gravity)
let mul = belt.gravityAt(new THREE.Vector3(0, 200, 0), dir);
if (dir.distanceTo(new THREE.Vector3(0, -1, 0)) > 1e-6) fail(`far gravity dir ${dir.toArray()}`);
if (Math.abs(mul - 1) > 1e-9) fail(`belt gravity mul ${mul}`);

// (a2) at a rock's surface the pull ramps up hard (jump-proof strength)
{
  const rk0 = MAP_DEFS.belt.gravRocks[0];
  const m = belt.gravityAt(new THREE.Vector3(rk0.x + rk0.r + 0.2, rk0.y, rk0.z), dir);
  if (m < 8) fail(`near-surface pull too weak: ${m}`);
}

// (a3) plate fields: one-directional gravity onto the face
{
  const pl = belt.gravPlates[0];
  const probe = pl.center.clone().addScaledVector(pl.normal, 5);
  belt.gravityAt(probe, dir);
  if (dir.angleTo(pl.normal.clone().negate()) > 0.01) fail(`plate gravity not anti-normal: ${dir.toArray()}`);
  // below/behind the plate: field does not reach
  const behind = pl.center.clone().addScaledVector(pl.normal, -3);
  belt.gravityAt(behind, dir);
  if (dir.angleTo(pl.normal.clone().negate()) < 0.01) fail('plate field leaks behind the face');
}

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

// (c2) jumping off a rock cannot escape its field — you fall back
{
  const p = new Player(belt, camStub, inputStub);
  const center = new THREE.Vector3(rk.x, rk.y, rk.z);
  p.position.set(rk.x + rk.r + 0.01, rk.y, rk.z);
  p.vel.set(0, 0, 0);
  for (let i = 0; i < 120; i++) p.update(1 / 60, i / 60);   // settle onto the surface
  if (!p._onRock) fail('escape test: never settled on the rock');
  // simulate a full jump straight off the surface
  p.vel.copy(p.up).multiplyScalar(13);
  p.grounded = false;
  let maxD = 0;
  for (let i = 0; i < 400; i++) {
    p.update(1 / 60, 2 + i / 60);
    maxD = Math.max(maxD, p.position.distanceTo(center));
  }
  const influence = rk.r + 10;
  if (maxD > influence) fail(`jump escaped the field: reached ${maxD.toFixed(1)} vs influence ${influence}`);
  if (!p._onRock) fail('jump test: did not fall back onto the rock');
  ok('rock fields are jump-proof (dash-only escape)');
}

// (c3) a player above a plate lands on its face, up aligned to the normal
{
  const pl = belt.gravPlates[0];
  const p = new Player(belt, camStub, inputStub);
  p.position.copy(pl.center).addScaledVector(pl.normal, 6);
  p.vel.set(0, 0, 0);
  for (let i = 0; i < 400; i++) p.update(1 / 60, i / 60);
  if (!p.grounded || !p._onRock) fail(`plate landing failed (grounded=${p.grounded})`);
  const h = p.position.clone().sub(pl.center).dot(pl.normal);
  if (Math.abs(h - 0.37) > 0.1) fail(`plate landing height ${h.toFixed(2)} != ~0.37`);
  if (p.up.angleTo(pl.normal) > 0.25) fail(`plate up not aligned: ${p.up.angleTo(pl.normal)} rad`);
  ok('plate capture: lands on the face, up follows the normal');
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
