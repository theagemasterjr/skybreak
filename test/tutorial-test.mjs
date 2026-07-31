// Headless check of every tutorial script: feed the exact event sequence a
// player would produce and assert the tracker walks each script to COMPLETE.
// Run: node test/tutorial-test.mjs

import { TUTORIAL_SCRIPTS, ObjectiveTracker } from '../src/tutorials.js';

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL', msg); };

// minimal fake game the trackers read from
function fakeGame() {
  return {
    simTime: 0,
    player: { vel: { lengthSq: () => 0 }, grounded: false, dashLen: 0.28 },
    combat: { state: {} },
  };
}

// drive one script with a scripted event feed; each feed entry is either
// ['cast', {...}] / ['dummyHit', {...}] / etc, or a mutation fn(game)
function run(name, feed) {
  const g = fakeGame();
  const t = new ObjectiveTracker(TUTORIAL_SCRIPTS[name], g, {});
  for (const item of feed) {
    g.simTime += 0.1;
    if (typeof item === 'function') { item(g); t.update(); }
    else t.onEvent(item[0], item[1] || {});
    t.update();
  }
  if (!t.done) fail(`${name}: stuck on step ${t.idx}: "${t.step?.text}"`);
  else console.log(`  ok ${name}`);
}

const D = (n) => ({ dummy: 'dummy' + n, dmg: 20, opts: {} });

run('basics', [
  (g) => { g.player.vel.lengthSq = () => 25; },       // move
  ['jump'], ['doubleJump'],
  ['dash'], ['dash'], ['dash'],                        // airborne (grounded=false)
  ['dummyHit', D(1)],
  ['cast', { slot: 'Q', power: 1 }],
  ...Array(5).fill(['dummyHit', D(1)]),                // 5 x 20 = 100 dmg
]);

run('mage', [
  ['dummyHit', D(1)],
  ['cast', { slot: 'Q', power: 1 }], ['dummyHit', D(1)],
  ['cast', { slot: 'E' }], ['cast', { slot: 'E' }],
  ['cast', { slot: 'R' }], ['dummyHit', D(1)],
  ['cast', { slot: 'F' }], ['dummyHit', D(1)],
  ...Array(8).fill(['dummyHit', D(1)]),                // 160 dmg
]);

run('brawler', [
  ['dummyHit', D(1)], ['dummyHit', D(1)], ['dummyHit', D(1)],
  ['cast', { slot: 'Q' }], ['dummyHit', D(1)],
  ['cast', { slot: 'E' }], ['dummyHit', D(1)],
  ['cast', { slot: 'R' }], ['dummyHit', D(1)], ['dummyHit', D(1)], ['dummyHit', D(1)], ['dummyHit', D(1)],
  ['cast', { slot: 'F' }], ['dummyHit', D(1)], ['dummyHit', D(2)],
]);

run('reaver', [
  ['dummyHit', D(1)],
  ['cast', { slot: 'Q' }], ['dummyHit', D(1)],
  ['cast', { slot: 'E' }], ['dummyHit', D(1)], ['dummyHit', D(2)],
  ['cast', { slot: 'R' }],
  ['cast', { slot: 'F' }], ['dummyHit', D(1)],
]);

run('sorcerer', [
  ['dummyHit', D(1)], ['dummyHit', D(1)], ['dummyHit', D(1)],
  ['cast', { slot: 'Q' }], ['dummyHit', D(1)],
  ['cast', { slot: 'E' }], ['dummyHit', D(1)],
  ['cast', { slot: 'R' }], ['dummyHit', D(1)],
  ['cast', { slot: 'F' }], ['dummyHit', D(1)],
  ...Array(8).fill(['dummyHit', D(1)]),
]);

run('assassin', [
  ['dummyHit', { dummy: 'd1', dmg: 10, opts: { poison: { dps: 3, t: 2 } } }],
  ['cast', { slot: 'Q' }], ['dummyHit', D(1)],
  ['cast', { slot: 'E' }], ['dummyHit', D(1)], ['dummyHit', D(2)],
  ['cast', { slot: 'R' }],
  ['cast', { slot: 'F' }], ['dummyHit', D(1)],
]);

run('gambler', [
  ['dummyHit', D(1)],
  ['cast', { slot: 'Q' }],
  (g) => { g.combat.state.minigunT = 8; },             // jackpot lands
  ...Array(10).fill(['dummyHit', D(1)]),               // 200 dmg
]);

// negative checks: wrong events must NOT advance
{
  const g = fakeGame();
  const t = new ObjectiveTracker(TUTORIAL_SCRIPTS.basics, g, {});
  t.onEvent('jump');                                    // step 0 is a poll (move)
  if (t.idx !== 0) fail('basics: jump advanced the move step');
  g.player.vel.lengthSq = () => 25; t.update();
  t.onEvent('doubleJump');                              // step 1 wants plain jump
  if (t.idx !== 1) fail('basics: doubleJump advanced the jump step');
  console.log('  ok negative checks');
}
{
  // two(): same dummy twice must not complete; window expiry must reset
  const g = fakeGame();
  const t = new ObjectiveTracker(TUTORIAL_SCRIPTS.reaver, g, {});
  t.onEvent('dummyHit', D(1));                          // step 0
  t.onEvent('cast', { slot: 'Q' }); t.onEvent('dummyHit', D(1));   // step 1
  t.onEvent('cast', { slot: 'E' });
  t.onEvent('dummyHit', D(1)); t.onEvent('dummyHit', D(1));        // same dummy!
  if (t.done || t.idx !== 2) fail('reaver: same dummy twice completed the two() step');
  g.simTime += 10;                                      // window long gone
  t.onEvent('dummyHit', D(2));
  if (t.idx !== 2) fail('reaver: stale-window hit advanced the two() step');
  console.log('  ok two() edge cases');
}

console.log(failures ? `\n${failures} FAILURES` : '\nPASS');
process.exit(failures ? 1 : 0);
