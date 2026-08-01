// BotBrain checks: the bot pilot, headless. A real World (classic), a fake
// player parked at a duel spawn, a fake avatar body. Asserts the brain stays
// on the map, moves, shoots at the player, and flees a storm.
// Run: node test/botbrain-test.mjs

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
const { MAP_DEFS } = await import('../src/maps/index.js');
const { BotBrain, BOT_DIFFICULTY } = await import('../src/botBrain.js');
const { CLASS_LIST } = await import('../src/classes.js');

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL', msg); };
const ok = (msg) => console.log('  ok', msg);

function makeRig(classId, botSpawn) {
  const scene = new THREE.Scene();
  const world = new World(scene, MAP_DEFS.classic);
  const sp = MAP_DEFS.classic.spawns.duel[0];
  const aims = [];
  const game = {
    state: 'playing', mode: 'botduel', simTime: 0, enemies: [],
    world,
    player: {
      alive: true, health: 100, maxHealth: 100, rootTimer: 0,
      position: new THREE.Vector3(sp[0], sp[1], sp[2]), vel: new THREE.Vector3(),
      takeDamage(d) { this.health -= d; return true; },
      applyKnockback() {}, shake() {},
    },
    combat: null, input: null,
    playerInSmoke: () => false,
    effects: { glow() {}, ring() {}, beam() {}, burst() {}, impactBurst() {} },
    hud: { announce() {}, flash() {} },
    audio: { play() {} },
    projectiles: {
      list: [],
      spawn(o) {
        this.list.push(o);
        // capture whether the shot points at the player at fire time
        const to = game.player.position.clone().setY(game.player.position.y + 1.1).sub(o.pos).normalize();
        aims.push(o.vel.clone().normalize().dot(to));
      },
    },
    hitstop() {},
  };
  world._game = game;
  world.resetHazards(7);
  const avatar = {
    classId, type: 'duelist', alive: true, radius: 0.55, height: 1.9,
    position: new THREE.Vector3(botSpawn[0], botSpawn[1], botSpawn[2]),
    net: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: false, dashing: false, charging: false, age: 0 },
    hasSnapshot: false,
    center(t) { return t.copy(this.position).setY(this.position.y + 0.95); },
    playAttack() {},
  };
  const owner = { botHp: 100, botMaxHp: 100, _botSlowT: 0, _botFrozenT: 0, phase: 'fighting' };
  return { world, game, avatar, owner, aims };
}

// ---- flight + combat: every class fights and stays out of the void ----
for (const classId of CLASS_LIST) {
  const { world, game, avatar, owner, aims } = makeRig(classId, MAP_DEFS.classic.spawns.duel[1]);
  const brain = new BotBrain(game, owner, avatar, 'duelist');
  const spawn = avatar.position.clone();
  let minY = Infinity, moved = 0, airborneFrames = 0, dashed = false;
  for (let i = 0; i < 60 * 30; i++) {
    game.simTime += 1 / 60;
    world.advanceClocks(1 / 60, 'playing');
    brain.update(1 / 60);
    minY = Math.min(minY, avatar.position.y);
    moved = Math.max(moved, avatar.position.distanceTo(spawn));
    if (i > 120 && !brain.grounded) airborneFrames++;
    if (brain.dashT > 0) dashed = true;
  }
  const jumped = airborneFrames > 60;
  const dealtRanged = game.projectiles.list.length > 5;
  const dealtMelee = game.player.health < 100;
  if (minY < -40) fail(`${classId}: bot fell toward the void (minY=${minY.toFixed(1)})`);
  if (moved < 10) fail(`${classId}: bot barely moved (${moved.toFixed(1)}u)`);
  if (!jumped) fail(`${classId}: bot never got airborne`);
  if (!dealtRanged && !dealtMelee) fail(`${classId}: bot never attacked`);
  if (dealtRanged) {
    const good = aims.filter((a) => a > 0.7).length;
    if (good < aims.length * 0.5) fail(`${classId}: shots not aimed at player (${good}/${aims.length} on target)`);
  }
  if (!failures) ok(`${classId}: flies, fights (${game.projectiles.list.length} shots, player hp ${game.player.health.toFixed(0)}, dashed=${dashed})`);
}

// ---- difficulty tiers exist and scale ----
if (!(BOT_DIFFICULTY.rookie.reaction > BOT_DIFFICULTY.nightmare.reaction)) fail('difficulty: reaction does not scale');
if (!(BOT_DIFFICULTY.rookie.aimErr > BOT_DIFFICULTY.nightmare.aimErr)) fail('difficulty: aim error does not scale');
ok('difficulty tiers scale');

// ---- storm avoidance: bot outside a fake storm runs for the eye ----
{
  const { world, game, avatar, owner } = makeRig('mage', [58, 9, -26]);
  world.overtime = { started: true, R: 30, strikes: { list: [] }, update() {} };
  const brain = new BotBrain(game, owner, avatar, 'duelist');
  // park the player in the eye so engage + safety agree
  game.player.position.set(0, 4, 0);
  for (let i = 0; i < 60 * 15; i++) {
    game.simTime += 1 / 60;
    brain.update(1 / 60);
  }
  const r = Math.hypot(avatar.position.x, avatar.position.z);
  if (r > 45) fail(`storm: bot stayed in the storm (r=${r.toFixed(1)})`);
  else ok(`storm avoidance: bot ran inward to r=${r.toFixed(1)}`);
}

// ---- fling survival: heavy knockbacks must not ring the bot out ----
{
  const { world, game, avatar, owner } = makeRig('brawler', MAP_DEFS.classic.spawns.duel[1]);
  const brain = new BotBrain(game, owner, avatar, 'duelist');
  const rng = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  let minY = Infinity, flings = 0;
  for (let i = 0; i < 60 * 45; i++) {
    game.simTime += 1 / 60;
    world.advanceClocks(1 / 60, 'playing');
    // every ~4s: a player-ability-scale launch in a random direction
    if (i % 240 === 120) {
      const a = rng() * Math.PI * 2;
      brain.vel.add(new THREE.Vector3(Math.cos(a) * 26, 12 + rng() * 8, Math.sin(a) * 26));
      brain.grounded = false;
      flings++;
    }
    brain.update(1 / 60);
    minY = Math.min(minY, avatar.position.y);
  }
  const groundUnder = world.groundHeightBelow(avatar.position.x, avatar.position.z, avatar.position.y + 2, 0, 400);
  if (minY < -70) fail(`fling: bot sank to y=${minY.toFixed(1)} — void recovery too weak`);
  else if (groundUnder === null && avatar.position.y < 0) fail('fling: bot ended over the void, still falling');
  else ok(`fling survival: ${flings} launches, minY=${minY.toFixed(1)}, back over land`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
