// Out-of-combat regen: damage stamps lastDamagedAt; after 10 quiet seconds
// the duel/ffa loops trickle 1 hp/s. Run: node test/regen-test.mjs
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };

const { Player } = await import('../src/player.js');

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL', m); };

let simTime = 0;
const world = { soloSpawn: { x: 0, y: 4, z: 8, clone: () => ({}) } };
const p = new Player(world, {}, {});
p._simTimeRef = () => simTime;

// the exact regen condition duel.update / ffa.update use
const regenTick = (dt) => {
  if (p.alive && simTime - (p.lastDamagedAt ?? -999) >= 10) p.heal(1 * dt);
};

simTime = 5;
p.takeDamage(30);
if (p.health !== 70) fail(`took 30, health ${p.health}`);
if (p.lastDamagedAt !== 5) fail(`lastDamagedAt ${p.lastDamagedAt} != 5`);

// 9s later: still in combat, no regen
simTime = 14; regenTick(1);
if (p.health !== 70) fail(`regen started early: ${p.health}`);

// 10s+ later: 1 hp/s
simTime = 15.5;
for (let i = 0; i < 60; i++) { simTime += 1 / 60; regenTick(1 / 60); }
if (Math.abs(p.health - 71) > 0.05) fail(`after 1s of regen: ${p.health} != ~71`);

// a new hit stops it cold
p.takeDamage(10, null, { pierceInvuln: true });
const hp = p.health;
regenTick(1);
if (p.health !== hp) fail('regen ran right after a hit');

// heal never exceeds max
p.health = p.maxHealth - 0.1;
simTime += 100; regenTick(10);
if (p.health > p.maxHealth) fail(`overhealed to ${p.health}`);

console.log(failures ? `${failures} FAILURES` : 'PASS');
process.exit(failures ? 1 : 0);
