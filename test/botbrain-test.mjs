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

function makeRig(classId, botSpawn, mapId = 'classic') {
  const scene = new THREE.Scene();
  const world = new World(scene, MAP_DEFS[mapId]);
  const sp = MAP_DEFS[mapId].spawns.duel[0];
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

// ---- nightmare under fire: an aggressive player (constant shots + heavy
// knockback every 3s) must not ring the bot out, park it in permanent void
// recovery, or reduce it to m1 spam — it keeps fighting with its whole kit ----
for (const [mapId, classId, minDmg] of [['tempest', 'brawler', 150], ['godspire', 'mage', 300]]) {
  const { world, game, avatar, owner } = makeRig(classId, MAP_DEFS[mapId].spawns.duel[1], mapId);
  const brain = new BotBrain(game, owner, avatar, 'nightmare');
  let dmg = 0, ults = 0;
  game.player.takeDamage = (d) => { dmg += d; return true; };
  game.projectiles.spawn = (o) => { game.projectiles.list.push(o); dmg += o.damage * 0.5; };
  const ult = brain.kit.ult;
  if (ult) { const orig = ult.use; ult.use = (b) => { ults++; orig(b); }; }
  const rng = (() => { let s = 1337; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  let big = world.islands[0];
  for (const isl of world.islands) if (isl.R > big.R) big = isl;
  let minY = Infinity, offMap = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 60; i++) {
    game.simTime += dt;
    world.advanceClocks(dt, 'playing');
    const p = game.player, t = game.simTime;
    const orb = Math.min(big.R * 0.55, 14);
    p.position.set(big.x + Math.cos(t * 0.5) * orb, p.position.y, big.z + Math.sin(t * 0.5) * orb);
    const pg = world.groundHeightBelow(p.position.x, p.position.z, big.topY + big.domeH + 30, world.clock, 60);
    p.position.y = (pg !== null ? pg : big.topY) + (Math.sin(t * 1.7) > 0.6 ? 2.5 : 0);
    if (i % 20 === 0) {
      const from = p.position.clone().setY(p.position.y + 1.2);
      const dir = avatar.position.clone().setY(avatar.position.y + 1).sub(from).normalize();
      game.projectiles.list.push({ owner: 'player', dead: false, pos: from, vel: dir.multiplyScalar(40), life: 2 });
    }
    for (let j = game.projectiles.list.length - 1; j >= 0; j--) {
      const pr = game.projectiles.list[j];
      if (pr.owner !== 'player') continue;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.life -= dt;
      if (pr.life <= 0) game.projectiles.list.splice(j, 1);
    }
    if (i % 180 === 90 && avatar.position.distanceTo(p.position) < 30) {
      const kb = avatar.position.clone().sub(p.position).setY(0).normalize().multiplyScalar(14 + rng() * 12);
      kb.y = 8 + rng() * 8;
      brain.vel.add(kb);
      brain.grounded = false;
    }
    brain.update(dt);
    minY = Math.min(minY, avatar.position.y);
    if (world.groundHeightBelow(avatar.position.x, avatar.position.z, avatar.position.y + 2, world.clock, 400) === null) offMap += dt;
  }
  if (minY < -90) fail(`nightmare ${classId}/${mapId}: rung out under pressure (minY=${minY.toFixed(0)})`);
  if (offMap > 20) fail(`nightmare ${classId}/${mapId}: lived over the void (${offMap.toFixed(1)}s off map)`);
  if (dmg < minDmg) fail(`nightmare ${classId}/${mapId}: too passive (${dmg.toFixed(0)} dmg in 60s, want ${minDmg}+)`);
  if (!ults) fail(`nightmare ${classId}/${mapId}: never used its ult`);
  if (!failures) ok(`nightmare ${classId}/${mapId} under fire: ${dmg.toFixed(0)} dmg, ${ults} ults, offMap=${offMap.toFixed(1)}s, minY=${minY.toFixed(0)}`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
