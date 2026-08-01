// Overtime checks: for every map that defines makeOvertime, fast-forward a
// duel-mode world past the 2:00 mark and assert the event fired, reshaped the
// arena as designed, and runs the same seeded schedule twice.
// Run: node test/overtime-test.mjs

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

// park the fake player on each map's first duel spawn so events can reach it
function makeFakeGame(def) {
  const sp = def.spawns.duel[0];
  return {
    state: 'playing', mode: 'duel', simTime: 0, enemies: [],
    player: {
      alive: true, health: 100, maxHealth: 100,
      position: new THREE.Vector3(sp[0], sp[1], sp[2]), vel: new THREE.Vector3(),
      windBoostT: 0, invulnTimer: 0, dashTimer: 0, lastDamagedAt: -999,
      slowFall() {}, applyKnockback() {}, root() {}, shake() {}, heal() {},
      takeDamage(d) { this.health -= d; return true; },
      onDeath: null,
    },
    effects: { glow() {}, ring() {}, beam() {}, burst() {}, impactBurst() {} },
    hud: { announces: [], announce(t) { this.announces.push(t); }, flash() {} },
    audio: { play() {} },
    projectiles: { list: [], spawn(o) { this.list.push(o); } },
    hitstop() {},
  };
}

const step = (world, game, n) => {
  for (let i = 0; i < n; i++) {
    world.advanceClocks(1 / 60, 'playing');
    game.simTime += 1 / 60;
    world.update(1 / 60, game.simTime);
  }
};

// per-map assertions, run after stepping well past OT (filled in per event task)
const CHECKS = {
  classic(world, game) {
    if (world.islands.length !== 1) fail(`classic: expected 1 island left, got ${world.islands.length}`);
    else if (world.islands[0].R < 25) fail('classic: wrong island survived');
    else ok('classic: side islands gone, main island stands');
  },
  tempest(world, game) {
    const R = world.overtime.R;
    if (!(R <= 7.01)) fail(`tempest: storm wall did not close (R=${R})`);
    else ok(`tempest: storm closed to R=${R.toFixed(1)}`);
    if (game.player.health >= 100) fail('tempest: player outside the wall took no lightning');
    else ok('tempest: lightning hurt the straggler');
  },
  ember(world, game) {
    if (!(world.overtime.lavaY > 5)) fail(`ember: lava did not rise (y=${world.overtime.lavaY})`);
    else ok(`ember: lava at y=${world.overtime.lavaY.toFixed(1)}`);
    if (game.player.health >= 100) fail('ember: player never burned');
    else ok('ember: the sea found the player');
  },
  godspire(world, game) {
    // the crown (baseY 70.5) survives by design; everything else shatters
    if (world.platforms.length !== 1 || world.platforms[0].baseY < 70) {
      fail(`godspire: expected only the crown to survive, got ${world.platforms.length} ledges`);
    } else ok('godspire: every ledge but the crown shattered');
    if (world.islands.length !== 1) fail(`godspire: expected only the base island, got ${world.islands.length}`);
    else ok('godspire: satellites crumbled');
  },
  voidgarden(world, game) {
    const orbiting = world.platforms.filter((p) => p.orbit).length;
    if (orbiting !== 0) fail(`voidgarden: ${orbiting} orbiting gardens survived the Maw`);
    else ok('voidgarden: all five gardens devoured');
    if (!(world.hazards.pullR > 25)) fail(`voidgarden: Maw did not grow (pullR=${world.hazards.pullR})`);
    else ok(`voidgarden: Maw pullR=${world.hazards.pullR.toFixed(1)}`);
  },
  belt(world, game) {
    if (!world.gravityFlipped) fail('belt: gravity never flipped');
    else ok('belt: gravity flipped');
    if (world.skyKillY === null) fail('belt: skyKillY not set');
    if (world.gravPlates.length !== 1 || !world.gravPlates[0].canopy) {
      fail(`belt: expected only the Canopy plate, got ${world.gravPlates.length}`);
    } else ok('belt: only the Canopy remains');
    if (world.islands.length !== 0) fail(`belt: ${world.islands.length} islands survived`);
  },
};

const STEPS = { classic: 60 * 165, tempest: 60 * 200, ember: 60 * 220, godspire: 60 * 230, voidgarden: 60 * 200, belt: 60 * 230 };

for (const id of MAPS) {
  const def = MAP_DEFS[id];
  if (!def.makeOvertime) { console.log(`  -- ${id}: no overtime (expected only for training)`); continue; }

  const logs = [];
  for (let run = 0; run < 2; run++) {
    const scene = new THREE.Scene();
    const world = new World(scene, def);
    const game = makeFakeGame(def);
    world._game = game;
    world.resetHazards(7);

    // before OT: nothing fires, timer counts
    step(world, game, 60 * 30);
    if (world.overtime.started) fail(`${id}: overtime started early`);
    if (Math.abs(world.overtime.remaining - (124 - 30)) > 1) fail(`${id}: remaining wrong (${world.overtime.remaining})`);

    step(world, game, STEPS[id] - 60 * 30);
    if (!world.overtime.started) { fail(`${id}: overtime never started`); world.dispose(); break; }
    if (!game.hud.announces.includes('OVERTIME')) fail(`${id}: no OVERTIME announce`);
    if (run === 0) CHECKS[id]?.(world, game);
    logs.push(JSON.stringify(world.overtime.log));
    world.dispose();
  }
  if (logs.length === 2 && logs[0] !== logs[1]) {
    fail(`${id}: overtime not deterministic\n  a=${logs[0]}\n  b=${logs[1]}`);
  } else if (logs.length === 2) {
    ok(`${id} deterministic (${JSON.parse(logs[0]).length} logged events)`);
  }
  ok(id);
}

// solo mode never gets overtime
{
  const scene = new THREE.Scene();
  const def = MAP_DEFS.classic;
  if (def.makeOvertime) {
    const world = new World(scene, def);
    const game = makeFakeGame(def);
    game.mode = 'solo';
    world._game = game;
    world.resetHazards(7);
    step(world, game, 60 * 140);
    if (world.overtime?.started) fail('solo: overtime fired in solo mode');
    else ok('solo mode exempt');
    world.dispose();
  }
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
