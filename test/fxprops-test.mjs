// Ability-level check: the real class code emits prop lifecycle events through
// a recording effects wrapper (what rivals need to see orbs/anchors).
import * as THREE from 'three';
import { CLASSES } from '../src/classes.js';
import { recordingEffects } from '../src/fxNet.js';

function stubEffects() {
  return {
    burst() {}, glow() { return {}; }, beam() {}, ring() {}, marker() {},
    impactBurst() {}, dashStreaks() {},
  };
}

function stubCtx(buf) {
  const player = {
    position: new THREE.Vector3(0, 5, 0), vel: new THREE.Vector3(),
    eyePosition: new THREE.Vector3(0, 6.5, 0), alive: true,
    grounded: true, invulnTimer: 0, dashTimer: 0, stallTimer: 0,
    damageTakenMult: 1,
    root() {}, shake() {}, forwardDir() { return new THREE.Vector3(0, 0, -1); },
  };
  return {
    player,
    chargePower: 0,
    effects: recordingEffects(stubEffects(), buf),
    projectiles: { spawn() {} },
    viewmodel: { trigger() {} },
    audio: { play() {} },
    game: {
      simTime: 0,
      scene: { added: [], add(m) { this.added.push(m); }, remove(m) { const i = this.added.indexOf(m); if (i >= 0) this.added.splice(i, 1); } },
      combat: { cooldowns: {}, lockT: 0 },
      hud: { flash() {} },
      hitstop() {},
    },
    aimDir: () => new THREE.Vector3(0, 0, -1),
    muzzle: () => new THREE.Vector3(0, 6.3, -0.5),
    sphereHit: () => [],
    rayHits: () => [],
    meleeHit: () => [],
    coneHit: () => [],
    aimGroundPoint: () => new THREE.Vector3(5, 0, 5),
    dealDamage() {}, stallIfAirborne() {}, slowFallIfAirborne() {},
    shake() {}, delay() {},
  };
}

const props = (buf) => buf.filter((e) => e.f === 'prop').map((e) => e.k);

// ---- sorcerer Blue: spawn event + end event when it expires ----
{
  const buf = [];
  const ctx = stubCtx(buf);
  const state = {};
  const blue = CLASSES.sorcerer.abilities.find((a) => a.slot === 'E');
  blue.execute(ctx, state);
  console.assert(state.blue, 'blue state created');
  console.assert(props(buf).includes('blue'), `blue prop event emitted, got ${JSON.stringify(props(buf))}`);
  const ev = buf.find((e) => e.f === 'prop' && e.k === 'blue');
  console.assert(ev.d.t > 3 && ev.d.r >= 8 && ev.d.v.length === 3, 'blue event carries t/r/vel');
  // expire it
  state.blue.t = 0.01;
  CLASSES.sorcerer.update(stubCtx(buf), 0.1, state);
  console.assert(props(buf).includes('blueEnd'), 'blueEnd emitted on expiry');
  console.assert(state.blue === null, 'blue state cleared');
}

// ---- sorcerer Purple Nuke: start + end on fire, end on death-fizzle ----
{
  const buf = [];
  const ctx = stubCtx(buf);
  const state = {};
  const nuke = CLASSES.sorcerer.abilities.find((a) => a.slot === 'R');
  nuke.execute(ctx, state);
  console.assert(props(buf).includes('nuke'), 'nuke prop event emitted');
  state.nuke.t = 0.01;
  CLASSES.sorcerer.update(stubCtx(buf), 0.1, state);   // fires
  console.assert(props(buf).includes('nukeEnd'), 'nukeEnd emitted on fire');
  console.assert(state.nuke === null, 'nuke state cleared after firing');

  const buf2 = [];
  const ctx2 = stubCtx(buf2);
  const state2 = {};
  nuke.execute(ctx2, state2);
  ctx2.player.alive = false;
  const ctxDead = stubCtx(buf2); ctxDead.player.alive = false;
  CLASSES.sorcerer.update(ctxDead, 0.1, state2);       // fizzles
  console.assert(props(buf2).includes('nukeEnd'), 'nukeEnd emitted on death fizzle');
}

// ---- mage Rift Anchor: plant + end on recall ----
{
  const buf = [];
  const ctx = stubCtx(buf);
  const state = {};
  const anchor = CLASSES.mage.abilities.find((a) => a.slot === 'E');
  anchor.execute(ctx, state);   // plant
  console.assert(props(buf).includes('anchor'), 'anchor prop event emitted');
  anchor.execute(ctx, state);   // recall
  console.assert(props(buf).includes('anchorEnd'), 'anchorEnd emitted on recall');
  console.assert(state.anchor === null, 'anchor state cleared');
}

// ---- solo mode safety: plain Effects has no .prop, abilities must not crash ----
{
  const ctx = stubCtx([]);
  ctx.effects = stubEffects();   // no prop() — like solo play
  const state = {};
  CLASSES.sorcerer.abilities.find((a) => a.slot === 'E').execute(ctx, state);
  state.blue.t = 0.01;
  const ctx2 = stubCtx([]); ctx2.effects = stubEffects();
  CLASSES.sorcerer.update(ctx2, 0.1, state);
  console.assert(state.blue === null, 'solo: blue expires cleanly without prop hook');
}

console.log('ALL FX PROP CHECKS PASSED');
