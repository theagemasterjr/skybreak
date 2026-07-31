// Shattered Belt physics: plate gravity fields (one-directional), landing,
// solid undersides, jump-proof fields, and classic-map parity (vector
// gravity must be identical to the old straight-down pull elsewhere).
// Run: node test/belt-test.mjs

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

// (a) in the open: plain down, plain strength (belt is normal gravity)
let mul = belt.gravityAt(new THREE.Vector3(0, 200, 0), dir);
if (dir.distanceTo(new THREE.Vector3(0, -1, 0)) > 1e-6) fail(`far gravity dir ${dir.toArray()}`);
if (Math.abs(mul - 1) > 1e-9) fail(`belt gravity mul ${mul}`);

// (b) plate fields: one-directional, normal strength, no reach behind
{
  const pl = belt.gravPlates[0];
  const probe = pl.center.clone().addScaledVector(pl.normal, 5);
  const m = belt.gravityAt(probe, dir);
  if (dir.angleTo(pl.normal.clone().negate()) > 0.01) fail(`plate gravity not anti-normal: ${dir.toArray()}`);
  if (Math.abs(m - 1) > 1e-9) fail(`plate pull should be 1x: ${m}`);
  const behind = pl.center.clone().addScaledVector(pl.normal, -3);
  belt.gravityAt(behind, dir);
  if (dir.angleTo(pl.normal.clone().negate()) < 0.01) fail('plate field leaks behind the face');
  ok('plate gravity field');
}

// (c) a player above a plate lands on its face, up aligned to the normal
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

  // (c2) jumping off the face cannot escape the field — you arc back down
  p.vel.copy(p.up).multiplyScalar(13);
  p.grounded = false;
  let maxH = 0;
  for (let i = 0; i < 400; i++) {
    p.update(1 / 60, 7 + i / 60);
    maxH = Math.max(maxH, p.position.clone().sub(pl.center).dot(pl.normal));
  }
  if (maxH > pl.fieldH) fail(`jump left the plate field: ${maxH.toFixed(1)} vs ${pl.fieldH}`);
  if (!p._onRock) fail('jump test: did not come back to the plate');
  ok('plate fields are jump-proof (dash-only escape)');
}

// (d) the plate's underside is solid: no phasing through from behind
{
  const pl = belt.gravPlates[0];
  const p = new Player(belt, camStub, inputStub);
  p.position.copy(pl.center).addScaledVector(pl.normal, -4);
  for (let i = 0; i < 240; i++) {
    // keep shoving the player at the back of the plate
    p.vel.copy(pl.normal).multiplyScalar(18);
    p.update(1 / 60, i / 60);
  }
  const h = p.position.clone().sub(pl.center).dot(pl.normal);
  if (h > -0.2) fail(`phased through the plate underside: h=${h.toFixed(2)}`);
  ok('plate underside is solid');
}

// (e) classic parity: vector gravity == old scalar gravity away from plates
{
  const classic = new World(new THREE.Scene(), MAP_DEFS.classic);
  const p = new Player(classic, camStub, inputStub);
  p.position.set(0, 30, 8);   // free fall over the main island
  p.vel.set(0, 0, 0);
  p.update(1 / 60, 0);
  if (Math.abs(p.vel.y - (-30 / 60)) > 1e-9) fail(`classic gravity step ${p.vel.y} != ${-30 / 60}`);
  if (p.vel.x !== 0 || p.vel.z !== 0) fail('classic gravity gained sideways drift');
  if (p.up.distanceTo(new THREE.Vector3(0, 1, 0)) > 1e-6) fail('classic up drifted');
  ok('classic-map gravity parity');
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
