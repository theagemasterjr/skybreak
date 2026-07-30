// Headless Gambler checks: roll odds, mirror mechanics, and a smoke pass of
// every pair/jackpot effect + the class update loop with each power active.
import * as THREE from 'three';
import { CLASSES } from '../src/classes.js';
import {
  rollSpin, applyResult, GOOD_ICONS, BAD_ICONS, JACKPOT_ICONS, SLOT_ICONS, RESULT_LABELS,
} from '../src/gambler.js';

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { failures++; console.error('FAIL:', msg); }
};

// ---- 1. distribution: 60% good pair / 20% bad pair / 20% jackpot ----
{
  const N = 40000;
  let goodPair = 0, badPair = 0, jackpot = 0, purple = 0;
  for (let i = 0; i < N; i++) {
    const res = rollSpin({});
    check(res.label, 'every roll has a label');
    if (res.kind === 'jackpot') {
      check(res.good, 'jackpots are never bad');
      check(res.icon === 'purple' || JACKPOT_ICONS.includes(res.icon),
        `jackpot icon from the trimmed pool (got ${res.icon})`);
      check(res.reels[0] === res.icon && res.reels[1] === res.icon && res.reels[2] === res.icon,
        'jackpot reels show a triple');
      jackpot++;
      if (res.icon === 'purple') purple++;
    } else {
      check(res.reels[0] === res.icon && res.reels[1] === res.icon && res.reels[2] !== res.icon,
        'pair reels show two + a loser');
      check(res.icon !== 'purple', 'purple never lands as a pair');
      if (res.good) { goodPair++; check(GOOD_ICONS.includes(res.icon), 'good pair icon from the good set'); }
      else { badPair++; check(BAD_ICONS.includes(res.icon), 'bad pair icon from the bad set'); }
    }
  }
  const pct = (n) => n / N;
  check(Math.abs(pct(goodPair) - 0.6) < 0.02, `good pair ~60% (got ${(pct(goodPair) * 100).toFixed(1)}%)`);
  check(Math.abs(pct(badPair) - 0.2) < 0.02, `bad pair ~20% (got ${(pct(badPair) * 100).toFixed(1)}%)`);
  check(Math.abs(pct(jackpot) - 0.2) < 0.02, `jackpot ~20% (got ${(pct(jackpot) * 100).toFixed(1)}%)`);
  check(Math.abs(purple / jackpot - 0.2) < 0.03, `purple has an equal jackpot share (got ${purple}/${jackpot})`);
}

// ---- 2. mirror curse: forced bad pair next spin, then the flag clears ----
{
  for (let i = 0; i < 200; i++) {
    const state = { slotForceBad: true };
    const res = rollSpin(state);
    check(res.kind === 'pair' && !res.good, 'cursed spin is always a bad pair');
    check(state.slotForceBad === false, 'curse clears after one spin');
  }
}

// ---- 3. every icon has art + labels ----
{
  for (const icon of [...GOOD_ICONS, ...BAD_ICONS, 'purple']) {
    check(SLOT_ICONS[icon]?.glyph, `${icon} has a glyph`);
    if (icon !== 'purple') check(RESULT_LABELS.pair[icon], `${icon} has a pair label`);
  }
  for (const icon of [...JACKPOT_ICONS, 'purple']) {
    check(RESULT_LABELS.jackpot[icon], `${icon} has a jackpot label`);
  }
}

// ---- 5. smoke test: every effect + the update loop, solo and pvp ----
function stubCtx(mode = 'solo') {
  const enemies = [];
  const player = {
    position: new THREE.Vector3(0, 5, 0), vel: new THREE.Vector3(),
    eyePosition: new THREE.Vector3(0, 6.6, 0), alive: true, grounded: true,
    invulnTimer: 0, stallTimer: 0, dashTimer: 0, rootTimer: 0,
    health: 60, maxHealth: 85, shield: 0, walkSpeed: 11.5, gravityScale: 1,
    maxDashes: 3, dashCharges: 1, damageReduction: 0, damageTakenMult: 1,
    poisonT: 2, poisonDps: 3,
    heal(a) { this.health = Math.min(this.maxHealth, this.health + a); },
    grantShield(a, t) { this.shield = a; this.shieldT = t; },
    takeDamage(a) { this.health -= a; if (this.health <= 0) { this.health = 0; this.alive = false; } return true; },
    applyKnockback(v) { this.vel.add(v); },
    root() {}, shake() {}, airStall() {}, slowFall() {},
    forwardDir() { return new THREE.Vector3(0, 0, -1); },
  };
  const scene = {
    added: [],
    add(m) { this.added.push(m); },
    remove(m) { const i = this.added.indexOf(m); if (i >= 0) this.added.splice(i, 1); },
  };
  const delays = [];
  const spawned = [];
  return {
    player, delays, spawned,
    chargePower: 0,
    effects: { burst() {}, glow() {}, beam() {}, ring() {}, sphere() {}, marker() {}, impactBurst() {}, dashStreaks() {} },
    projectiles: { spawn(o) { spawned.push(o); } },
    viewmodel: { trigger() {} },
    audio: { play() {} },
    game: {
      mode, simTime: 1, scene,
      combat: { cooldowns: {}, lockT: 0 },
      hud: { flash() {}, announce() {}, spinSlots() {} },
      hitstop() {},
    },
    enemies: () => enemies,
    aimDir: () => new THREE.Vector3(0, 0, -1),
    muzzle: () => new THREE.Vector3(0, 6.3, -0.5),
    sphereHit: () => [],
    rayHits: () => [],
    meleeHit: () => [],
    coneHit: () => [],
    aimGroundPoint: () => new THREE.Vector3(5, 0, 5),
    dealDamage() {}, stallIfAirborne() {}, slowFallIfAirborne() {},
    shake() {}, delay(t, fn) { delays.push({ t, fn }); },
  };
}

const gambler = CLASSES.gambler;
check(gambler && gambler.slotMachine, 'gambler registered with slot machine flag');
check(gambler.abilities.length === 1 && gambler.abilities[0].slot === 'Q', 'gambler has only Q');

for (const mode of ['solo', 'duel']) {
  for (const kind of ['pair', 'jackpot']) {
    const icons = kind === 'pair' ? [...GOOD_ICONS, ...BAD_ICONS] : [...JACKPOT_ICONS, 'purple'];
    for (const icon of icons) {
      const ctx = stubCtx(mode);
      const state = {};
      try {
        applyResult(ctx, state, { kind, icon, good: kind === 'jackpot' || GOOD_ICONS.includes(icon), reels: [icon, icon, icon], label: 'X' });
        // run the update loop for 12 sim-seconds so every timer expires and
        // every spawned object (bell, bomb, cobra, rain) lives and dies
        for (let i = 0; i < 240; i++) gambler.update(ctx, 0.05, state);
      } catch (err) {
        failures++;
        console.error(`FAIL: ${mode}/${kind}/${icon} threw:`, err.message);
        continue;
      }
      check(!(state.bells && state.bells.length) && !state.bombObj && !state.cobra,
        `${mode}/${kind}/${icon}: spawned objects expired`);
      check(ctx.game.scene.added.length === 0, `${mode}/${kind}/${icon}: no meshes leaked in the scene`);
      check(ctx.player.health > 0 || icon !== 'skull', `${mode}/${kind}/${icon}: skull bite never kills`);
    }
  }
}

// ---- 6. the m1 swaps modes and returns the right cooldowns ----
{
  const ctx = stubCtx('solo');
  const state = {};
  check(gambler.basic.execute(ctx, state) === undefined, 'default dice use the listed cooldown');
  check(ctx.spawned.length === 1, 'dice m1 fires one projectile');
  state.minigunT = 5;
  check(Math.abs(gambler.basic.execute(ctx, state) - 0.055) < 1e-9, 'minigun m1 is spammable');
  state.minigunT = 0; state.gunT = 5;
  check(gambler.basic.execute(ctx, state) === 0.17, 'revolver m1 cooldown');
  state.gunT = 0; state.purpleT = 5;
  check(gambler.basic.execute(ctx, state) === 0.85, 'purple m1 cooldown (solo)');
  const nuke = ctx.spawned[ctx.spawned.length - 1];
  check(nuke.size === 5.2 && nuke.damage === 95, 'purple nuke is double-size sorcerer output');
  state.reaperT = 5; state.purpleT = 0;
  check(gambler.basic.execute(ctx, state) === 0.3, 'reaper skull m1 cooldown');
}

// ---- 7. Q spin: rolls, defers the payoff to the reel landing ----
{
  const ctx = stubCtx('solo');
  const state = {};
  const cd = gambler.abilities[0].execute(ctx, state);
  check(cd === 4, 'spin cooldown is 4s');
  check(ctx.delays.length === 1 && Math.abs(ctx.delays[0].t - 0.85) < 1e-9, 'payoff lands with the last reel');
  ctx.delays[0].fn();   // must not throw whatever was rolled
}

if (failures === 0) console.log('ALL GAMBLER CHECKS PASSED');
else { console.error(`${failures} CHECK(S) FAILED`); process.exit(1); }
