# Bot Duel + Overtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a singleplayer "Duel a Bot" mode (3 difficulties, full class kits, real-duel flow) and a 2:00 per-round Overtime system with a unique escalating event on each of the 6 competitive maps.

**Architecture:** The bot reuses `DuelOpponent` (the existing rival body already compatible with all combat code) driven by a new local `BotBrain`; a new `BotDuel` controller mirrors `Duel`'s round machine minus networking and satisfies `DuelOpponent`'s owner contract (`canDealDamage()` + `sendHitFor(...)`). Overtime is a new optional map hook `makeOvertime(world, game)` built in `world.resetHazards`, driven by the seed-synced `world.hazardClock` so online peers stay in sync with zero new network traffic; all event damage uses the local-damage model (like the Maw / geysers).

**Tech Stack:** Three.js ESM, no framework, no test runner (plain `node test/*.mjs`).

## Global Constraints

- No `Math.random()` for anything that must match across online clients — use `world.hazardRng` (seeded) and `world.hazardClock`. Local-only juice (particle jitter, bot aim error) may use `Math.random()`.
- Overtime applies in modes `duel`, `ffa`, `botduel` only — never `solo`/`tutorial`, never on the training map (training simply defines no `makeOvertime`).
- OT fires at `hazardClock >= OT_AT` where `OT_AT = 124` (≈3.6s countdown + 120s fighting).
- Events escalate until someone dies; no draw path.
- Each overtime class keeps a `log` array (`[clockRounded, label]`) for determinism tests, mirroring `TempestHazards.log`.
- Audio: only existing sound ids (`explosion`, `windup`, `waveClear`, `playerDeath`, `chargeStart`, `runStart`, `enemyShot`, `swipe`, `doubleJump`, `dash`, `land`, `playerHurt`, `chargeFull`).
- All hazard/overtime meshes go in `world.hazardFx` (auto-disposed on re-seed) except things that must survive a round (none do — maps rebuild between rounds when mutated, see Task 1).
- Commit after every task with a short message; run `node test/world-test.mjs` plus the new tests before every commit.

---

### Task 1: World foundations (island removal, overtime hook, gravity flip, rebuild-on-mutation)

**Files:**
- Modify: `src/world.js`
- Modify: `src/game.js` (loadMap fast-path condition)
- Modify: `src/duel.js` (`_startRound` uses loadMap; sky-kill check)
- Modify: `src/ffa.js` (sky-kill check)
- Test: `test/world-test.mjs` (must keep passing unchanged)

**Interfaces (produces):**
- `world.overtime` — object with `update(dt)`, or null. Built in `resetHazards` from `mapDef.makeOvertime(world, game)`.
- `island.group` — THREE.Group holding the island mesh + its trees/rocks/crystals/grass, positioned at origin (children in world space). Animate `group.position/rotation` to sink/launch an island.
- `world.removeIsland(island)` — splices from `world.islands` (collision gone) and drops that island's `columns` entries. Visuals untouched (caller animates then hides `island.group`).
- `world.removePlatform(p)` — splices from `world.platforms`. Caller animates/hides `p.mesh`.
- `pl.slab` on every gravPlate — the slab mesh; `pl.canopy` true on Belt's Canopy (new `canopy: true` field in belt.js def, Task 8).
- `world.gravityFlipped` (bool) — flips the default gravity direction in `gravityAt` to `(0.03, 1, 0).normalize()` (slightly off-axis to avoid the degenerate `setFromUnitVectors` case in player camera/controls when up becomes exactly (0,-1,0)).
- `world.skyKillY` (number|null) — when set, duel/ffa/botduel treat `player.position.y > skyKillY` as a void death.
- `world._otMutated` — set true by any overtime that removes islands/platforms/plates; `Game.loadMap` same-map fast path is skipped when true, forcing a clean rebuild next round.

- [ ] **Step 1: island groups.** In `world.js:_buildIslands`, wrap each island's mesh + decorations in a group:

```js
for (const d of this.mapDef.islands) {
  const island = { x: d.x, z: d.z, topY: d.topY, R: d.R, domeH: d.domeH,
    edgeSeed: d.seed, depth: d.depth, flat: !!d.flat };
  const grp = new THREE.Group();
  this.root.add(grp);
  island.group = grp;
  this.islands.push(island);
  const geo = buildIslandGeometry(island, d.depth, d.seed, { bare: !!d.bare }, this.palette);
  const mesh = new THREE.Mesh(geo, islandMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  grp.add(mesh);
  const rng = mulberry32(d.seed * 977 + 5);
  this._decorate(island, d, rng, grp);
}
```

`_decorate(island, d, rng, grp)` gains the `grp` param; every `this.root.add(...)` inside it becomes `grp.add(...)` (trees, rocks, crystal groups, grass tufts). Ruins (`_buildRuins`) stay on `this.root` (the ruins island is never removed by any event). When `_decorate` pushes solid-rock columns (belt), tag them: `this.columns.push({ ..., island })`.

- [ ] **Step 2: removal APIs + flags.** Add to `World`:

```js
removeIsland(island) {
  const i = this.islands.indexOf(island);
  if (i >= 0) this.islands.splice(i, 1);
  this.columns = this.columns.filter((c) => c.island !== island);
  this._otMutated = true;
}
removePlatform(p) {
  const i = this.platforms.indexOf(p);
  if (i >= 0) this.platforms.splice(i, 1);
  this._otMutated = true;
}
removeGravPlate(pl) {
  const i = this.gravPlates.indexOf(pl);
  if (i >= 0) this.gravPlates.splice(i, 1);
  this._otMutated = true;
}
```

In the constructor add `this._otMutated = false; this.gravityFlipped = false; this.skyKillY = null; this.overtime = null;`. In `_buildGravPlates`, store `pl.slab = slab` and `pl.canopy = !!def.canopy` (plate record is pushed before the slab exists — push first, then `this.gravPlates[this.gravPlates.length - 1].slab = slab`, same pattern the field-particle code already uses).

- [ ] **Step 3: gravity flip.** In `gravityAt`, replace the initial `out.set(0, -1, 0)` with:

```js
if (this.gravityFlipped) out.set(0.03, 1, 0).normalize();
else out.set(0, -1, 0);
```

(Plates and rocks still override inside their fields — that's what lets the Canopy catch flipped players.)

- [ ] **Step 4: overtime wiring.** In `resetHazards` (after the hazards line):

```js
this.gravityFlipped = false;
this.skyKillY = null;
this.overtime = this.mapDef.makeOvertime
  ? this.mapDef.makeOvertime(this, this._game)
  : null;
```

In `advanceClocks`: `if ((this.hazards || this.overtime) && state === 'playing') this.hazardClock += rawDt;`
In `update` (next to the hazards tick): `if (this.overtime && this._game?.state === 'playing') this.overtime.update(dt);`

- [ ] **Step 5: rebuild-on-mutation.** `game.js:loadMap` fast-path condition becomes `if (this.world && this.world.mapDef.id === getMap(mapId).id && !this.world._otMutated)`. In `duel.js:_startRound`, replace

```js
g.world.clock = 0;
g.world.resetHazards((this.seed || 1) + n);
```

with `g.loadMap(this.mapId, (this.seed || 1) + n);` (fast path does exactly the old two lines; mutated worlds rebuild clean). FFA already calls `startFfa → loadMap` every round.

- [ ] **Step 6: sky-kill checks.** In `duel.js` fighting block, extend the void check:

```js
const sky = g.world.skyKillY;
if (g.player.alive && (g.player.position.y < -95 || (sky !== null && g.player.position.y > sky))) {
  g.player.alive = false;
  this.localDied();
}
```

Same edit in `ffa.js` (`update`, fighting phase, the `y < -95` check).

- [ ] **Step 7: run `node test/world-test.mjs`** — expect PASS (groups don't change collision or dispose behavior).
- [ ] **Step 8: Commit** `feat: world overtime hooks — island groups/removal, gravity flip, rebuild-on-mutation`

---

### Task 2: Overtime director + strike helper + HUD countdown

**Files:**
- Create: `src/overtime.js`
- Modify: `src/hud.js`, `src/ui.css`
- Test: `test/overtime-test.mjs` (scaffold)

**Interfaces (produces):**
- `class Overtime { constructor(world, game); update(dt); get enabled; get remaining; get t; started; log; }` — subclasses implement `begin()` (once, at OT) and `tick(dt)` (each frame after).
- `class StrikePool { constructor(world, game); spawn(target, opts); update(dt); }` — telegraphed ground strikes: warning ring at `target` (Vector3) for `opts.warnT` (default 1.3), then a blast that damages/knocks any `victims` entry within `opts.r`. `victims` defaults to `[game.player]` plus, in botduel, the bot avatar (`game.enemies` entries of type `'duelist'` get `takeDamage` with `source:'hazard'` — DuelOpponent.takeDamage routes through the owner, and BotDuel applies it).
- `OT_AT = 124` exported.
- HUD: `#ot-timer` element top-center under the wave banner; `.urgent` pulses red.

- [ ] **Step 1: write `src/overtime.js`:**

```js
import * as THREE from 'three';

export const OT_AT = 124;   // ~3.6s pre-round countdown + 2:00 of fighting
const _v = new THREE.Vector3();

export class Overtime {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.started = false;
    this.log = [];
  }
  get enabled() {
    const m = this.game?.mode;
    return m === 'duel' || m === 'ffa' || m === 'botduel';
  }
  get remaining() {
    return this.enabled && !this.started
      ? Math.max(0, OT_AT - this.world.hazardClock) : 0;
  }
  get t() { return this.started ? this.world.hazardClock - OT_AT : 0; }
  update(dt) {
    if (!this.enabled) return;
    if (!this.started) {
      if (this.world.hazardClock >= OT_AT) {
        this.started = true;
        const g = this.game;
        g.hud?.announce('OVERTIME', '');
        g.hud?.flash('rgba(255, 64, 40, 0.22)', 0.6);
        g.player?.shake(0.7);
        g.audio?.play('explosion');
        this.log.push([Math.round(this.world.hazardClock * 100) / 100, 'OT']);
        this.begin();
      }
      return;
    }
    this.tick(dt);
  }
  begin() {}
  tick(dt) {}
}

// telegraphed blast: warning ring -> column flash -> damage + knockback.
// Local-damage model: each client runs its own strikes on its own targets.
export class StrikePool {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.list = [];
  }
  // target: Vector3 (copied). opts: {r=6, warnT=1.3, dmg=26, kb=16, color=0xff5a30, victims}
  spawn(target, opts = {}) {
    const o = { r: 6, warnT: 1.3, dmg: 26, kb: 16, color: 0xff5a30, ...opts };
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(o.r * 0.82, o.r, 28),
      new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(target).y += 0.25;
    this.world.hazardFx.add(ring);
    this.list.push({ pos: target.clone(), t: o.warnT, o, ring });
  }
  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t -= dt;
      s.ring.material.opacity = 0.3 + 0.4 * Math.abs(Math.sin(s.t * 14));
      s.ring.scale.setScalar(1 + (1 - Math.max(0, s.t) / s.o.warnT) * 0.12);
      if (s.t > 0) continue;
      // blast
      this.world.hazardFx.remove(s.ring);
      s.ring.geometry.dispose(); s.ring.material.dispose();
      this.list.splice(i, 1);
      g.effects.impactBurst(_v.copy(s.pos).setY(s.pos.y + 1), { color: s.o.color, size: 3.4 });
      g.effects.ring(s.pos.clone(), { color: s.o.color, endRadius: s.o.r + 2, life: 0.4, thickness: 0.5 });
      g.audio?.play('explosion');
      const victims = s.o.victims || this._defaultVictims();
      for (const v of victims) {
        if (!v || !v.alive) continue;
        const d = _v.copy(v.position).distanceTo(s.pos);
        if (d > s.o.r + 1.5) continue;
        const kb = _v.copy(v.position).sub(s.pos).setY(0);
        if (kb.lengthSq() < 0.01) kb.set(1, 0, 0);
        kb.normalize().multiplyScalar(s.o.kb).setY(s.o.kb * 0.7);
        if (v === g.player) {
          v.takeDamage(s.o.dmg, s.pos, {});
          v.applyKnockback(kb);
          g.player.shake(0.5);
        } else {
          v.takeDamage(s.o.dmg, { knockback: kb, source: 'hazard' });
        }
      }
    }
  }
  _defaultVictims() {
    const out = [this.game.player];
    if (this.game.mode === 'botduel') {
      for (const e of this.game.enemies) if (e.type === 'duelist') out.push(e);
    }
    return out;
  }
}
```

- [ ] **Step 2: HUD countdown.** In `hud.js` template, after the `#wave-banner` line add `<div id="ot-timer"></div>`; cache `this.otTimer = this.el.querySelector('#ot-timer')`. At the end of `update()` (before void warning is fine) add:

```js
const ot = this.game.world?.overtime;
if (ot && ot.enabled && this.game.state === 'playing') {
  if (!ot.started) {
    const r = ot.remaining;
    const m = Math.floor(r / 60), s = Math.floor(r % 60);
    this.otTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.otTimer.classList.add('active');
    this.otTimer.classList.toggle('urgent', r <= 10);
  } else {
    this.otTimer.textContent = 'OVERTIME';
    this.otTimer.className = 'active urgent';
  }
} else {
  this.otTimer.classList.remove('active', 'urgent');
}
```

In `ui.css` (near `#wave-banner` rules):

```css
#ot-timer { position: absolute; top: 58px; left: 50%; transform: translateX(-50%);
  font: 700 15px/1 var(--font-head, sans-serif); letter-spacing: 0.14em;
  color: #cfd8e8; opacity: 0; transition: opacity 0.3s; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
#ot-timer.active { opacity: 0.9; }
#ot-timer.urgent { color: #ff5040; animation: ot-pulse 0.5s infinite alternate; }
@keyframes ot-pulse { from { transform: translateX(-50%) scale(1); } to { transform: translateX(-50%) scale(1.14); } }
```

(Check `ui.css` for the actual heading font variable and `#wave-banner` top offset; position just below it.)

- [ ] **Step 3: test scaffold `test/overtime-test.mjs`** — copy world-test's document stub + fakeGame, but `mode: 'duel'` and a `hud` capturing announces:

```js
// fakeGame additions over world-test's:
//   mode: 'duel', hud: { announces: [], announce(t){ this.announces.push(t); }, flash(){} },
//   player gains: position/vel Vector3s, alive: true, health: 100, maxHealth: 100,
//   shake(){}, takeDamage(d){ this.health -= d; }, applyKnockback(){}, root(){},
//   slowFall(){}, heal(){}, windBoostT: 0, invulnTimer: 0, dashTimer: 0
const step = (world, n) => { for (let i = 0; i < n; i++) { world.advanceClocks(1/60, 'playing'); world.update(1/60, i/60); } };
// per map with makeOvertime: build, resetHazards(7), step(60*125), assert world.overtime.started
// then map-specific asserts (added by Tasks 3-8), then determinism: two runs, compare
// JSON.stringify(world.overtime.log) — logs must only contain seeded-schedule entries.
```

Run `node test/overtime-test.mjs` — passes trivially (no maps define makeOvertime yet).

- [ ] **Step 4: Commit** `feat: overtime director, strike pool, HUD countdown`

---

### Task 3: Classic — SKYFALL

**Files:** Modify `src/maps/classic.js`; extend `test/overtime-test.mjs`.

**Behavior:** At OT, every 5s a meteor streaks down (0.9s flight, glowing sphere + trail) onto the next side island (order = seeded shuffle of islands[1..5]). Impact: blast FX, `world.removeIsland`, island group tumbles/sinks over 2.6s then hides. When only the main island remains: `StrikePool` strikes on live targets, period 5s ramping to 1.8s (`period = Math.max(1.8, 5 - phase2T * 0.08)`), damage 26, r 6.

- [ ] **Step 1:** classic.js becomes a module with imports (`three`, `Overtime, StrikePool` from `../overtime.js`). Add `makeOvertime(world, game) { return new SkyfallOvertime(world, game); }` to the def and implement:

```js
class SkyfallOvertime extends Overtime {
  begin() {
    const w = this.world;
    // seeded island order (main island = the R>=25 one, always spared)
    this.main = w.islands.reduce((a, b) => (b.R > a.R ? b : a));
    this.queue = w.islands.filter((i) => i !== this.main);
    for (let i = this.queue.length - 1; i > 0; i--) {          // seeded shuffle
      const j = Math.floor(w.hazardRng() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.meteors = [];    // {mesh, from, to, t, dur, island}
    this.sinking = [];    // {island, t, spin}
    this.strikes = new StrikePool(w, this.game);
    this.nextMeteorAt = this.t + 2.5;
    this.nextStrikeAt = null;
    this.phase2At = null;
  }
  _launchMeteor(island) { /* sphere mesh (r 2.2, 0xff7a30 basic + glow light) in hazardFx,
    from = island center + (seeded offset x/z ±30, y +90), to = island top center, dur 0.9 */ }
  tick(dt) {
    const w = this.world, g = this.game;
    // schedule
    if (this.queue.length && this.t >= this.nextMeteorAt) {
      const island = this.queue.shift();
      this.nextMeteorAt = this.t + 5;
      this._launchMeteor(island);
      this.log.push([Math.round(w.hazardClock), `meteor`]);
      if (!this.queue.length) this.phase2At = this.t + 5;
    }
    // meteors fly
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      m.mesh.position.lerpVectors(m.from, m.to, k * k);   // accelerating fall
      if (Math.random() < dt * 40) g.effects.glow(m.mesh.position.clone(), { color: 0xffa050, size: 1.4, life: 0.25 });
      if (k >= 1) { // impact
        g.effects.impactBurst(m.to.clone(), { color: 0xff8a40, size: 6 });
        g.effects.burst(m.to.clone(), { count: 40, color: 0xff9a40, color2: 0x442211, speed: 14, size: 0.4, life: 0.6 });
        g.player.shake(Math.max(0.2, 1 - g.player.position.distanceTo(m.to) / 90));
        g.audio?.play('explosion');
        w.removeIsland(m.island);
        this.sinking.push({ island: m.island, t: 0, spin: (w.hazardRng() - 0.5) * 0.8 });
        m.mesh.geometry.dispose(); m.mesh.material.dispose(); w.hazardFx.remove(m.mesh);
        this.meteors.splice(i, 1);
      }
    }
    // islands sink into the void
    for (let i = this.sinking.length - 1; i >= 0; i--) {
      const s = this.sinking[i];
      s.t += dt;
      const grp = s.island.group;
      grp.position.y -= (4 + s.t * 22) * dt;
      grp.rotation.x += s.spin * dt; grp.rotation.z += s.spin * 0.6 * dt;
      if (s.t > 2.8) { grp.visible = false; this.sinking.splice(i, 1); }
    }
    // phase 2: bombard the last island
    if (this.phase2At !== null && this.t >= this.phase2At) {
      if (this.nextStrikeAt === null) this.nextStrikeAt = this.t;
      if (this.t >= this.nextStrikeAt) {
        const period = Math.max(1.8, 5 - (this.t - this.phase2At) * 0.08);
        this.nextStrikeAt = this.t + period;
        for (const v of this.strikes._defaultVictims()) {
          if (!v.alive) continue;
          const p = v.position.clone();
          const ground = w.groundHeightBelow(p.x, p.z, p.y + 2, 0, 60);
          p.y = ground ?? this.main.topY;
          this.strikes.spawn(p, { dmg: 26, r: 6 });
        }
        this.log.push([Math.round(w.hazardClock), 'strike']);
      }
    }
    this.strikes.update(dt);
  }
}
```

(Fill `_launchMeteor` fully in implementation — mesh + from/to as commented; `to` = `new THREE.Vector3(island.x, island.topY + 1, island.z)`, `from` = to + seeded offset `((rng()-0.5)*60, 90, (rng()-0.5)*60)`.)

- [ ] **Step 2: test.** In overtime-test, classic asserts after `step(60*160)`: `world.overtime.started === true`, `world.islands.length === 1`, remaining island has `R >= 25`. Determinism: two runs, identical `log`. Run it — expect PASS. Run `node test/world-test.mjs` too (classic now has makeOvertime but solo fakeGame mode is undefined → overtime disabled; world-test unaffected... **note:** world-test's fakeGame has no `mode`, so `enabled` is false and overtime never fires there — intended).
- [ ] **Step 3: Commit** `feat(overtime): Classic — Skyfall`

---

### Task 4: Tempest — THE STORM

**Files:** Modify `src/maps/tempest.js`; extend test.

**Behavior:** Visible storm wall (open cylinder, radius 90→7 over 60s, then →3 over the next 40s) centered on the eye. Outside the wall: buffeting gusts (`player.vel` jitter ±10, `windBoostT` so the cap doesn't fight it) and lightning: per-victim bolt on a period 2.4s→0.9s (`Math.max(0.9, 2.4 - this.t * 0.02)`), 0.55s warning glow above the victim, then `effects.beam` from sky to victim, 11 damage, random horizontal fling 15 + up 9. Inside the wall: calm. Log entries on each period rollover.

- [ ] **Step 1:** implement `StormOvertime extends Overtime` in tempest.js; `makeOvertime` added to def. Wall mesh: `CylinderGeometry(1, 1, 140, 48, 1, true)`, `MeshBasicMaterial({ color: 0x6a7ac0, transparent: true, opacity: 0.16, blending: AdditiveBlending, side: DoubleSide, depthWrite: false })`, scaled to current R each frame; second inner cylinder opacity 0.08 at R*0.96 for depth. Radius: `R = t < 60 ? 90 - (83/60)*t : Math.max(3, 7 - (t-60)*0.1)`. Victim loop identical shape to Skyfall's (`player` + botduel duelists): track per-victim `nextBoltAt` in a Map keyed by victim; warning = glow sprite at `victim.position + (0,9,0)`; bolt: `g.effects.beam(top, victimPos, { color: 0xcfe0ff, radius: 0.3, life: 0.18 })` + flash + damage/fling as Behavior says (player via `takeDamage`+`applyKnockback`, duelist via `takeDamage({knockback, source:'hazard'})`).
- [ ] **Step 2: test.** After `step(60*200)`: started, wall radius ≤ 7 (expose `this.R`), player (parked at (44, 6, 0) — outside the eye) `health < 100`. Determinism on log. Run tests.
- [ ] **Step 3: Commit** `feat(overtime): Tempest — The Storm`

---

### Task 5: Ember — THE ERUPTION

**Files:** Modify `src/maps/ember.js`; extend test.

**Behavior:** A molten sea (bright disc, r 340, in hazardFx) rises from y=-92 at `1.1 + t*0.02` u/s (reaches y≈0 around 65s in, y≈20 around 90s). Contact (feet below lavaY+0.4): 22 dps ticked continuously + every 0.7s an upward shove (`vel.y = max(vel.y, 18)`) + orange flash — you can escape, you cannot stay. Lava bombs: every 3.2s→1.4s, seeded target = random live island top ± seeded scatter 8, plus (local) each victim's position every other volley; bomb = tracked {pos, vel} arcing from the Heart vent (0, 30, 0) under gravity 22, drawn as glowing sphere; on reaching ground height → blast (StrikePool-style immediate, no warning — the arc IS the telegraph): dmg 20, r 5, kb 14. Burning patches: on each bomb impact push `{pos, r: 3.4, until: t+6}`; victims standing within r and within 1.5 of ground take 8 dps; faint ember glow FX.

- [ ] **Step 1:** implement `EruptionOvertime extends Overtime` (lava plane mesh `CircleGeometry(340, 48)` basic 0xff5a20 `fog:false` rotated flat + a 0xffa040 core at r 120, both `position.y = this.lavaY` each frame; bombs list; patches list; expose `this.lavaY`). Bomb launch velocity: solve simple ballistic — pick flight time `T = 1.6`, `vel = (target - from)/T; vel.y += 0.5 * 22 * T`. Log bomb schedule.
- [ ] **Step 2: test.** Park fake player at (44, 3, 0). After `step(60*220)`: started; `lavaY > 5`; player health < 100 (lava reached spawn island top ~0-3). Determinism. Run tests.
- [ ] **Step 3: Commit** `feat(overtime): Ember — The Eruption`

---

### Task 6: Godspire — THE COLLAPSE

**Files:** Modify `src/maps/godspire.js`; extend test.

**Behavior:** Ledges shatter top-down: sort `world.platforms` by `baseY` desc; every 3s (→1.6s: `Math.max(1.6, 3 - t*0.02)`) the next one rumbles 1.1s (mesh jitter + glow) then shatters (burst FX, `removePlatform`, `mesh.visible = false`). After all platforms: the three satellite islands (topY 16/28/40 — every island except the R22 base) go the same way, meteor-less (rumble then crumble+sink, reuse Skyfall's sinking animation shape). Endgame: rubble bombardment — StrikePool strikes on victims, period 4s→1.6s, dmg 24, r 5.5, color 0xd8cfc0 (marble), plus falling-rubble FX from the spire top.

- [ ] **Step 1:** implement `CollapseOvertime extends Overtime` in godspire.js (queue = platforms sorted desc by baseY at begin(); note the crown ledge at baseY 70.5 goes first, funneling the fight DOWN). Satellites: `w.islands.filter(i => i.R < 15)` sorted by topY desc. Log every shatter.
- [ ] **Step 2: test.** After `step(60*220)`: started; `world.platforms.length === 0`; `world.islands.length === 1`. Determinism. Run tests.
- [ ] **Step 3: Commit** `feat(overtime): Godspire — The Collapse`

---

### Task 7: Void Garden — THE MAW AWAKENS

**Files:** Modify `src/maps/voidgarden.js` (MawHazard refactor + overtime); extend test.

**Behavior:** The Maw grows: `pullR` +0.45/s (11 → ~40 by 65s), visuals scale with it (`swirl` respawn radius reads pullR already; scale core/shell/disks by `pullR/11 * 0.35 + 0.65`). It devours the five orbiting gardens: each platform's `orbit.r` shrinks 2.6/s once OT starts; when `orbit.r < 5` → crunch (burst + impactBurst at platform pos, `removePlatform`, hide mesh, log). While held by the Maw during OT: 16 dps (direct `health -=`, stamp `lastDamagedAt`, respect `alive`) so it can finish a fight. After all five are eaten: THE HUNT — `center` glides toward the nearest living victim at `1.8 + (t-hunt0)*0.02` u/s (max 4.5); grace after hurl drops from 4s to 2s.

- [ ] **Step 1: refactor MawHazard** so all its meshes live in one `this.g = new THREE.Group()` positioned at `this.center` (children at origin-relative positions); `update` sets `this.g.position.copy(this.center)` each frame; swirl positions become center-relative (drop `this.center.x +` from the setXYZ call). Keep behavior byte-identical otherwise (world-test hazard determinism must still pass — MawHazard has no log, fine).
- [ ] **Step 2:** implement `MawOvertime extends Overtime` in voidgarden.js. It reaches the live hazard via `this.world.hazards` (the MawHazard) and mutates `pullR`, `center`, `grace`, plus a new `maw.holdDps` field the MawHazard applies when set (add 3 lines to MawHazard.update's holding branch: `if (this.holdDps) { p.health -= this.holdDps * dt; p.lastDamagedAt = g.simTime; if (p.health <= 0) { p.health = 0; p.alive = false; p.onDeath?.(); } }`). Bot victim: in botduel the Maw only rides the player today — that stays (bot handles the Maw by avoidance, Task 11); the HUNT targets nearest of player/bot positions regardless.
- [ ] **Step 3: test.** After `step(60*200)`: started; zero orbiting platforms remain (`world.platforms.filter(p=>p.orbit).length === 0`); `world.hazards.pullR > 25`. Determinism (log = crunch order/times). Run tests (incl. world-test — Maw refactor must not break its sim-update pass).
- [ ] **Step 4: Commit** `feat(overtime): Void Garden — The Maw Awakens (+ MawHazard group refactor)`

---

### Task 8: Belt — CANOPY'S CALL (gravity flip finale)

**Files:** Modify `src/maps/belt.js` (add `canopy: true` to the Canopy plate def + overtime); extend test.

**Behavior:** Three acts.
1. **Ascension** (0–~40s): every 4.5s, TWO gravity plates (seeded shuffle of the 9 non-canopy plates) rumble 1.4s (slab emissiveIntensity pulse + jitter) then launch: `removeGravPlate` at launch (field + landing gone immediately), slab flies up accelerating (`vy += 30*dt`, spin), hidden above y 150. The Canopy visibly shakes (slab position jitter, amplitude ramps with plates gone). The 3 orbiting platforms and all 7 islands interleave into the same queue (islands: rumble then LAUNCH upward — Skyfall's sinking code with negative gravity — then `removeIsland`).
2. **THE FLIP** (once the queue empties): announce `'THE SKY INVERTS'` ('sub'), big flash, `world.gravityFlipped = true`, `world.skyKillY = 150`, `player.vel.y += 6` (a little push to sell it), shake. Players fall up; the Canopy's own gravity field (already face-down) catches anyone over its footprint; everyone else exits through the sky → sky-kill (Task 1's duel/ffa checks).
3. **Static discharge** (escalation): on the Canopy face, StrikePool strikes on victims (positions projected onto the face), period 3.5s→1.5s, dmg 18, kb 12, color 0x55e8ff. Rings must be oriented to the plate face: pass `opts.normal` through StrikePool — add an optional `normal` opt that orients the warning ring (`ring.lookAt(pos + normal)`) and directs blast knockback tangentially to the face (kb along `(victim - pos)` projected onto the face plane, plus `normal * kb * 0.4`).

- [ ] **Step 1:** add `canopy: true` to the Canopy entry in `gravPlates` (belt.js:80) — Task 1 already carries it onto the runtime plate.
- [ ] **Step 2:** extend StrikePool with the `normal` option (small, backwards-compatible: default `(0,1,0)` keeps old behavior).
- [ ] **Step 3:** implement `CanopyOvertime extends Overtime` in belt.js per the three acts. Keep refs: `this.canopy = w.gravPlates.find(p => p.canopy)`. Launching slab animation list mirrors Skyfall's `sinking` list (direction up). Log every launch pair + the flip.
- [ ] **Step 4: physics sanity for the flip.** Manual check via harness later, but codify what must hold: with `gravityFlipped`, `player.update`'s gravity uses `world.gravityAt` (already does); grounding on the Canopy works through the existing plate-landing sweep; double-jump/dash operate in the local frame (already `up`-relative). The fake-player node test can't verify feel — assert state only.
- [ ] **Step 5: test.** After `step(60*220)`: started; `world.gravityFlipped === true`; `world.skyKillY === 150`; `world.gravPlates.length === 1` and `world.gravPlates[0].canopy`; `world.islands.length === 0`. Determinism. Run all tests.
- [ ] **Step 6: Commit** `feat(overtime): Belt — Canopy's Call with gravity-flip finale`

---

### Task 9: BotDuel controller + menu flow (bot exists, stands there, rounds resolve)

**Files:**
- Create: `src/botDuel.js`
- Modify: `src/game.js`, `src/menus.js`, `src/hud.js`, `src/duelOpponent.js` (one guard), `src/ui.css` (chip row reuse — likely zero new css)

**Interfaces (produces):**
- `class BotDuel { constructor(game); start(playerClass, botClass /*id or 'random'*/, difficulty /*'rookie'|'duelist'|'nightmare'*/, mapId /*id or 'random'*/); update(dt); leave(); requestRematch(); canDealDamage(); sendHitFor(avatar, dmg, kb, freeze, poison, slow); phase; botName; }`
- `game.botDuel` instance; `game.mode === 'botduel'` while active; `game.activeDuel` getter → botDuel when mode is botduel else duel.
- Bot vitals owned by BotDuel: `this.botHp`, applied to `avatar.hp/maxHp` every frame.
- `BOT_NAMES` exported from botDuel.js.

- [ ] **Step 1: `src/botDuel.js`.** Mirror Duel's round machine, no net:

```js
import * as THREE from 'three';
import { DuelOpponent } from './duelOpponent.js';
import { CLASSES, CLASS_LIST } from './classes.js';
import { randomMapId } from './maps/index.js';

export const BOT_NAMES = ['VEX-2', 'NULLBLADE', 'KIRA-9', 'SABLE', 'ORIN-7', 'HALCYON', 'DUSKWING', 'MARROW'];
const ROUNDS_TO_WIN = 2;
const _v1 = new THREE.Vector3();

export class BotDuel {
  constructor(game) {
    this.game = game;
    this.phase = 'idle';   // idle | countdown | fighting | roundover | matchover
    this.avatar = null;
    this.brain = null;     // attached in Task 10; null-safe until then
    this.round = 0;
    this.score = { me: 0, opp: 0 };
  }
  get active() { return this.phase !== 'idle'; }
  canDealDamage() { return this.phase === 'fighting'; }

  start(playerClass, botClass, difficulty, mapId) {
    const g = this.game;
    this.playerClass = playerClass;
    this.botClass = botClass === 'random'
      ? CLASS_LIST[(Math.random() * CLASS_LIST.length) | 0] : botClass;
    this.difficulty = difficulty;
    this.botName = BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0];
    this.mapId = (!mapId || mapId === 'random') ? randomMapId() : mapId;
    this.seed = (Math.random() * 1e9) | 0;
    this.score = { me: 0, opp: 0 };
    g.startDuel(playerClass, this.mapId, this.seed);   // sets state/hud/map
    g.mode = 'botduel';                                // then claim the mode
    this.avatar = new DuelOpponent(g, this, this.botClass, { name: this.botName });
    g.enemies.push(this.avatar);
    this.botMaxHp = CLASSES[this.botClass].stats.maxHealth;
    // Task 10 attaches: this.brain = new BotBrain(g, this, this.avatar, difficulty)
    this._startRound(1);
    g.hud.announce(`VS ${this.botName} ✦`, 'sub');
  }

  _startRound(n) {
    const g = this.game;
    this.round = n;
    this.phase = 'countdown';
    this._cdT = 3.6; this._cdLast = 99;
    this.botHp = this.botMaxHp;
    this._botPoison = null; this._botSlowT = 0; this._botFrozenT = 0;
    g.projectiles.clear();
    g.resetCombatState();
    g.loadMap(this.mapId, (this.seed || 1) + n);
    const table = g.world.mapDef.spawns.duel;
    g.player.respawn();
    g.player.position.set(table[0][0], table[0][1], table[0][2]);
    g.player.yaw = table[0][3]; g.player.pitch = 0; g.player.freeze = true;
    this.avatar.respawn(_v1.set(table[1][0], table[1][1], table[1][2]), table[1][3]);
    this.avatar.maxHp = this.botMaxHp; this.avatar.hp = this.botHp;
    this.brain?.reset(table[1]);
    g.hud.setDuelInfo(this.round, this.score.me, this.score.opp, this.botName);
    g.hud.announce(n === 1 ? g.world.mapDef.name : `ROUND ${n}`, '');
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    if (this.phase === 'countdown') {
      this._cdT -= dt;
      const sec = Math.ceil(this._cdT);
      if (sec !== this._cdLast && sec >= 1 && sec <= 3) {
        this._cdLast = sec; g.hud.announce(String(sec), 'sub'); g.audio?.play('chargeStart');
      }
      this.brain?.updateIdle(dt);   // countdown hops (Task 11)
      if (this._cdT <= 0) {
        this.phase = 'fighting'; g.player.freeze = false;
        g.hud.announce('FIGHT!', ''); g.audio?.play('runStart');
      }
      return;
    }
    if (this.phase === 'fighting') {
      // bot status effects (mirrors what Duel applies to the remote player)
      if (this._botFrozenT > 0) this._botFrozenT -= dt;
      if (this._botSlowT > 0) this._botSlowT -= dt;
      if (this._botPoison && this.avatar.alive) {
        this._botPoison.t -= dt;
        this._applyBotDamage(this._botPoison.dps * dt, null);
        if (this._botPoison.t <= 0) this._botPoison = null;
      }
      // out-of-combat trickle for both sides
      if (g.player.alive && g.simTime - (g.player.lastDamagedAt ?? -999) >= 10) g.player.heal(1 * dt);
      if (this.avatar.alive && g.simTime - (this._botLastHit ?? -999) >= 10) {
        this.botHp = Math.min(this.botMaxHp, this.botHp + 1 * dt);
      }
      this.brain?.update(dt);
      this.avatar.hp = this.botHp; this.avatar.maxHp = this.botMaxHp;
      // deaths
      const sky = g.world.skyKillY;
      if (g.player.alive && (g.player.position.y < -95 || (sky !== null && g.player.position.y > sky))) {
        g.player.alive = false; this.localDied();
      }
      if (this.avatar.alive && (this.avatar.position.y < -95 || (sky !== null && this.avatar.position.y > sky))) {
        this._botDied();
      }
      return;
    }
    if (this.phase === 'roundover') {
      this._overT -= dt;
      if (this._overT <= 0) {
        if (this.score.me >= ROUNDS_TO_WIN || this.score.opp >= ROUNDS_TO_WIN) {
          this._matchOver(this.score.me > this.score.opp);
        } else this._startRound(this.round + 1);
      }
    }
  }

  // player hit the bot (DuelOpponent.takeDamage forwards here)
  sendHitFor(avatar, dmg, knockback, freeze, poison, slow) {
    this._applyBotDamage(dmg, knockback);
    if (freeze > 0) this._botFrozenT = Math.max(this._botFrozenT, freeze);
    if (slow > 0) this._botSlowT = Math.max(this._botSlowT, slow);
    if (poison) this._botPoison = {
      t: Math.max(this._botPoison?.t || 0, poison.t),
      dps: Math.max(this._botPoison?.dps || 0, poison.dps),
    };
  }
  _applyBotDamage(dmg, knockback) {
    if (this.phase !== 'fighting' || !this.avatar.alive) return;
    this.botHp -= dmg;
    this._botLastHit = this.game.simTime;
    if (knockback && this.brain) this.brain.vel.add(knockback);
    if (this.botHp <= 0) { this.botHp = 0; this._botDied(); }
  }

  localDied() {
    if (this.phase !== 'fighting') return;
    this.phase = 'roundover'; this._overT = 2.6;
    this.score.opp++;
    this.game.hud.announce('ROUND LOST', 'sub');
    this.game.audio?.play('playerDeath');
    this.game.hud.setDuelInfo(this.round, this.score.me, this.score.opp, this.botName);
    this.brain?.onRoundWon();
  }
  _botDied() {
    if (this.phase !== 'fighting') return;
    this.avatar.die();
    this.phase = 'roundover'; this._overT = 2.6;
    this.score.me++;
    this.game.hud.announce('ROUND WON', '');
    this.game.hud.flash('rgba(120, 220, 140, 0.14)', 0.4);
    this.game.audio?.play('waveClear');
    this.game.hud.setDuelInfo(this.round, this.score.me, this.score.opp, this.botName);
  }
  _matchOver(won) {
    const g = this.game;
    this.phase = 'matchover';
    g.player.freeze = true;
    document.exitPointerLock?.();
    g.state = 'select';
    g.hud.hide();
    g.menus.showDuelEnd(won, this.score.me, this.score.opp,
      won ? `${this.botName} POWERS DOWN` : `${this.botName} TAKES THE SKY`, true);
  }
  requestRematch() {
    if (this.phase !== 'matchover') return;
    this._dispose();
    const keep = { p: this.playerClass, b: this.botClass, d: this.difficulty };
    this.phase = 'idle';
    this.start(keep.p, keep.b, keep.d, 'random');
  }
  leave() {
    this._dispose();
    this.phase = 'idle';
    this.game.mode = 'solo';
    this.game.toMenu();
  }
  _dispose() {
    if (!this.avatar) return;
    const idx = this.game.enemies.indexOf(this.avatar);
    if (idx >= 0) this.game.enemies.splice(idx, 1);
    this.avatar.dispose(); this.avatar = null; this.brain = null;
  }
}
```

- [ ] **Step 2: game.js wiring.** `import { BotDuel } from './botDuel.js'`; `this.botDuel = new BotDuel(this)` after `this.duel`; add `get activeDuel() { return this.mode === 'botduel' ? this.botDuel : this.duel; }`; in `tick`: `if (this.mode === 'botduel') this.botDuel.update(dt);` next to the duel line; `_onPlayerDeath`: botduel branch → `this.audio?.play('playerDeath'); this.botDuel.localDied(); return;`; pointer-lock handler: botduel → `this.pause()` (singleplayer CAN pause — bot freezes with the sim). `pause()`/`resume()` gate on `state === 'playing'` already — but `pause()` sets `menus.show('pause')` whose ABANDON RUN calls `toMenu()`; that must end the bot duel cleanly → in `toMenu()` add first line: `if (this.mode === 'botduel') { this.botDuel._dispose(); this.botDuel.phase = 'idle'; }`.
- [ ] **Step 3: hud.js.** `setDuelInfo(round, myScore, oppScore, oppName)` — last line becomes `` this.waveRemaining.textContent = `YOU ${myScore} · ${oppScore} ${oppName || 'RIVAL'}` ``. Both mode checks `g.mode !== 'duel'` become `g.mode !== 'duel' && g.mode !== 'botduel'` (wave-banner overwrite + run-kills).
- [ ] **Step 4: menus.js.** New screens + routing:
  - `_buildSp()` — `#menu-sp`: title SINGLEPLAYER, buttons `WAVE RUN`, `DUEL A BOT <span class="btn-tag">VS AI</span>`, `BACK`. WAVE RUN → `this._botMode = false; this.game.showSelect();` DUEL A BOT → `this.show('botdiff')`. BACK → main.
  - `_buildBotDiff()` — `#menu-botdiff`: three buttons ROOKIE / DUELIST / NIGHTMARE (+ one-line blurbs), BACK. Pick → `this._botDifficulty = id; this._botMode = true; this._botClass = 'random'; this.game.showSelect();`
  - Main menu SINGLEPLAYER button now shows `'sp'` instead of `showSelect()`.
  - Select screen: add a bot row after `#map-row`: `<div id="bot-row"><span class="map-row-label">RIVAL</span>` + chips (`random` + each class name, `data-bot` attr) + `</div>`; chip click sets `this._botClass` and toggles `.on`. In `show('select')`, `#bot-row` display = `this._botMode ? '' : 'none'`; when botMode also set `#duel-select-note` to `DUEL A BOT — ${this._botDifficulty.toUpperCase()}` and leave `#map-row` visible (soloMap doubles as the bot-duel battleground pick; `training` chip must not be honored → in `_pickClass` botMode branch, map = `(this.soloMap === 'training' || this.soloMap === 'random') ? 'random' : this.soloMap`).
  - `_pickClass`: FIRST branch: `if (this._botMode) { const map = ...; this._botMode = false; this.game.botDuel.start(id, this._botClass, this._botDifficulty, map); return; }`
  - Duel-end buttons: `game.duel.requestRematch()` → `game.activeDuel.requestRematch()`, `game.duel.leave()` → `game.activeDuel.leave()`.
  - Register both new screens in `this.screens` and add Escape handling (`sp`/`botdiff` → back).
- [ ] **Step 5: duelOpponent.js guard.** In `update()`, the position block requires `hasSnapshot`; the brain (Task 10) drives `avatar.net.*` + `hasSnapshot = true`, so no change needed there — but `takeDamage` calls `this.owner.canDealDamage()` (BotDuel has it) and `owner.sendHitFor` (has it). Only real change: DuelOpponent's HP mirror is snapshot-corrected in online play; in botduel BotDuel writes `avatar.hp` each frame — already in Step 1. **No duelOpponent.js edit needed; verify and move on.**
- [ ] **Step 6: manual smoke via browser** (`/run` flow — serve the folder, open the game): SINGLEPLAYER → DUEL A BOT → ROOKIE → pick class → countdown runs, a red rival stands at the far spawn, you can kill it (it never moves yet), ROUND WON → round 2 → match end screen → REMATCH works, MAIN MENU works, Esc pauses.
- [ ] **Step 7: run all node tests** (world, overtime).
- [ ] **Step 8: Commit** `feat: bot duel mode — controller, menus, round machine (brainless bot)`

---

### Task 10: BotBrain — movement, aim, basic combat, difficulties

**Files:**
- Create: `src/botBrain.js`
- Modify: `src/botDuel.js` (attach brain in `start`)
- Test: `test/botbrain-test.mjs`

**Interfaces (produces):**
- `class BotBrain { constructor(game, owner, avatar, difficulty); reset(spawn); update(dt); updateIdle(dt); onRoundWon(); vel; }` — writes `avatar.position/net.*/hasSnapshot` every frame; attacks via `game.projectiles.spawn({owner:'enemy',...})` and direct `player.takeDamage`.
- `BOT_DIFFICULTY = { rookie: { reaction: 0.45, aimErr: 0.14, dodge: 0.25, lead: 0.3, cdMul: 1.35, predictive: false }, duelist: { reaction: 0.28, aimErr: 0.08, dodge: 0.55, lead: 0.7, cdMul: 1.0, predictive: false }, nightmare: { reaction: 0.15, aimErr: 0.035, dodge: 0.85, lead: 1.0, cdMul: 0.85, predictive: true } }` (aimErr in radians).

**Core structure (write in full):**

```js
export class BotBrain {
  constructor(game, owner, avatar, difficulty) {
    this.g = game; this.owner = owner; this.avatar = avatar;
    this.diff = BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY.duelist;
    this.kit = BOT_KITS[avatar.classId] || BOT_KITS.mage;    // Task 11 fills all six
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.jumpsLeft = 2;
    this.dashCharges = 3; this.dashRecharge = 0; this.dashT = 0; this.dashDir = new THREE.Vector3();
    this.intent = 'engage';
    this.intentT = 0;
    this.reactT = 0;            // knowledge of the player is this old
    this.knownPos = new THREE.Vector3(); this.knownVel = new THREE.Vector3();
    this.aimErr = new THREE.Vector3();
    this.cds = { basic: 0, gap: 0, burst: 0, escape: 0, ult: 0 };
    this.hesitateT = 0;
    this.strafeSign = 1;
    this.thinkT = 0;
  }
  reset(spawn) { /* zero everything, position set by BotDuel via avatar.respawn */ }

  update(dt) {
    const g = this.g, p = g.player, a = this.avatar;
    if (!a.alive) return;
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);
    // ---- perception with reaction delay ----
    this.reactT -= dt;
    if (this.reactT <= 0) {
      this.reactT = this.diff.reaction * (0.7 + Math.random() * 0.6);
      this.knownPos.copy(p.position); this.knownVel.copy(p.vel);
      // fresh smoothed aim error, shrinking with difficulty
      this.aimErr.set((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5))
        .multiplyScalar(this.diff.aimErr * 20);
      this._maybeDodge();          // reacts to charging player / incoming projectiles
    }
    // ---- think: pick intent every 0.4-0.8s ----
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.4 + Math.random() * 0.4; this._think(); }
    // ---- move + fight per intent ----
    this._move(dt);
    if (this.hesitateT > 0) this.hesitateT -= dt;
    else this._fight(dt);
    this._physics(dt);
    this._writeAvatar(dt);
  }

  _think() {
    const a = this.avatar, hp = this.owner.botHp / this.owner.botMaxHp;
    const pHp = this.g.player.health / this.g.player.maxHealth;
    const d = a.position.distanceTo(this.knownPos);
    const danger = this._hazardDanger(a.position);   // Task 11 expands; 0 for now
    if (danger > 0.5) this.intent = 'reposition';
    else if (pHp < 0.25 && hp > 0.3) this.intent = 'finish';
    else if (hp < 0.28 && pHp > 0.4) this.intent = 'evade';
    else if (d > this.kit.range * 2.2) this.intent = 'reposition';
    else if (this.cds.burst <= 0 && d < this.kit.range * 1.2 && Math.random() < 0.5) this.intent = 'burst';
    else this.intent = 'engage';
    if (Math.random() < 0.3) this.strafeSign *= -1;
  }

  _move(dt) {
    // desired velocity toward a goal point; aerial bias: prefer being ~2-6u
    // above the player, orbit-strafing at kit.range
    const a = this.avatar, w = this.g.world;
    const toP = _v1.copy(this.knownPos).sub(a.position);
    const flat = _v2.copy(toP).setY(0);
    const d = flat.length() || 0.001;
    let wish = _v3.set(0, 0, 0);
    const side = _vs.crossVectors(flat, _up).normalize().multiplyScalar(this.strafeSign);
    if (this.intent === 'engage' || this.intent === 'burst' || this.intent === 'finish') {
      const want = this.intent === 'finish' ? this.kit.range * 0.5 : this.kit.range;
      wish.addScaledVector(flat.normalize(), (d - want) * 0.25)     // range keeping
          .addScaledVector(side, 6);                                // orbit strafe
    } else if (this.intent === 'evade') {
      wish.addScaledVector(flat.normalize(), -8).addScaledVector(side, 5);
    } else { // reposition: head to safest ground near the player
      const goal = this._safeGoal();
      wish.copy(goal).sub(a.position).setY(0);
      if (wish.length() > 1) wish.normalize().multiplyScalar(9);
    }
    // steer horizontal velocity toward wish (accel ~ grounded player's)
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, 3.2 * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, 3.2 * dt);
    // vertical: jump / double-jump / dash decisions
    this._verticality(dt, toP);
  }

  _verticality(dt, toP) {
    // jump when grounded and (player is higher, or ledge ahead, or periodically to stay airborne)
    // double-jump mid-air when falling past the player's height with none left -> dash up
    // full implementation: grounded && (toP.y > 2 || Math.random() < dt * 0.7) -> _jump(13)
    // !grounded && this.vel-along-gravity < -4 && toP.y > 1 && jumpsLeft > 0 -> _jump(12)
    // falling toward void (groundHeightBelow null && y < -20) -> recovery: dash toward nearest island + jump
  }

  _maybeDodge() {
    if (Math.random() > this.diff.dodge) return;
    const p = this.g.player, a = this.avatar;
    let threat = p.alive && this.g.combat?.charging;   // player winding up
    for (const pr of this.g.projectiles.list) {        // projectile inbound
      if (pr.owner !== 'player') continue;
      _v1.copy(a.position).setY(a.position.y + 1).sub(pr.pos);
      const t = _v1.dot(pr.vel) / (pr.vel.lengthSq() || 1);
      if (t > 0 && t < 0.6 && _v1.addScaledVector(pr.vel, -t).length() < 3) threat = true;
    }
    if (this.diff.predictive && this.g.input?.attackDown?.()) threat = threat || Math.random() < 0.4;
    if (threat && this.dashCharges > 0 && this.dashT <= 0) this._dash(this._sideDir());
  }

  _fight(dt) {
    const d = this.avatar.position.distanceTo(this.knownPos);
    if (this.cds.basic <= 0 && d < this.kit.basic.range && this._hasLos()) {
      this.cds.basic = this.kit.basic.cd * this.diff.cdMul * (0.8 + Math.random() * 0.4);
      this.kit.basic.fire(this);
      this.avatar.playAttack();
    }
    // gap / burst / escape / ult verbs: Task 11
  }

  _aimAt(target, projSpeed) {
    // predicted aim + smoothed error; returns normalized dir from muzzle
    const from = this.avatar.center(_v1).clone(); from.y += 0.3;
    const to = _v2.copy(target);
    if (projSpeed) {
      const eta = from.distanceTo(to) / projSpeed;
      to.addScaledVector(this.knownVel, eta * this.diff.lead);
    }
    return to.add(this.aimErr).sub(from).normalize();
  }

  _physics(dt) {
    // player-like: gravity via world.gravityAt (belt flip works free), dash override,
    // integrate, ground land via groundHeightBelow (restores jumps/dashes),
    // island solid-volume pushout NOT needed (bot avoids islands' interiors well
    // enough; acceptable), platform carry skipped.
    // dash recharge: +1 per 1/(grounded?2.1:0.6) s like the player.
    // speed cap: CLASSES[classId].stats.walkSpeed * 1.15, soft clamp like player's.
    // slow: this.owner._botSlowT > 0 -> cap *= 0.55. frozen: _botFrozenT > 0 -> no accel, no attacks.
  }

  _writeAvatar(dt) {
    const a = this.avatar;
    a.position.addScaledVector(this.vel, 0);   // position integrated in _physics directly
    a.net.pos.copy(a.position); a.net.vel.copy(this.vel);
    a.net.yaw = Math.atan2(-(this.knownPos.x - a.position.x), -(this.knownPos.z - a.position.z));
    a.net.pitch = Math.atan2(this.knownPos.y - a.position.y,
      Math.hypot(this.knownPos.x - a.position.x, this.knownPos.z - a.position.z) || 1) * -1;
    a.net.grounded = this.grounded;
    a.net.dashing = this.dashT > 0;
    a.net.charging = this._chargingT > 0;
    a.net.age = 0; a.hasSnapshot = true;
  }
  updateIdle(dt) { /* countdown hops: small jumps + strafes in place (Task 11 personality) */ }
  onRoundWon() { /* victory spin flag consumed by updateIdle (Task 11) */ }
}
```

- [ ] **Step 1:** write `src/botBrain.js` with the structure above **fully implemented** (every `/* ... */` expanded — `_verticality`, `_physics` with real gravity/ground code modeled on `Enemy.update`'s non-flying branch plus jump/dash verbs `_jump(speed)` (sets vel along `-gravityDir`), `_dash(dir)` (0.28s, dashSpeed from class stats), `_hasLos()` (true unless `game.playerInSmoke()` and far, same rule as enemies), `_safeGoal()` (nearest island top within 40u of the player, via `world.islands` centers), `_sideDir()` (horizontal perpendicular to player direction, random sign), `_hazardDanger()` returning 0 (stub until Task 11)). Basic-attack-only `BOT_KITS` for now: every class gets `{ range: 26, basic: { range: 30, cd: 0.5, fire(brain) { /* enemy-owned bolt at player, dmg 9, speed 34, class color */ } } }` using `game.projectiles.spawn({ owner: 'enemy', damage: dmg, ... })` with dir from `brain._aimAt(playerCenter, 34)`.
- [ ] **Step 2:** attach in `BotDuel.start`: `this.brain = new BotBrain(g, this, this.avatar, difficulty);`.
- [ ] **Step 3: `test/botbrain-test.mjs`.** Document stub + real `World` (classic) + fake game (world-test's shape + `projectiles: { list: [], spawn(o){ this.list.push(o); } }`, `combat: null`, `input: null`, real-ish player object at (0, 4.5, 22) with `alive: true, health: 100, vel: Vector3`). Fake owner `{ botHp: 100, botMaxHp: 100, _botSlowT: 0, _botFrozenT: 0 }`. Fake avatar `{ classId: 'mage', alive: true, position: new Vector3(0, 4.5, -22), net: {pos: v3, vel: v3}, center(t){...}, playAttack(){}, hasSnapshot: false }`. Tick brain 60*30 frames. Assert: bot never below y -40 (didn't fall off), moved > 15u from spawn (it fights), `projectiles.list.length > 10` (it shoots), at least one spawn's dir roughly toward the player (dot > 0.7 with the true direction at fire time — capture inside spawn stub). Run it.
- [ ] **Step 4: manual browser pass** — Duelist difficulty on Classic: bot orbits in the air, shoots, dodges your charged shots sometimes, recovers from knockback, can win rounds.
- [ ] **Step 5: Commit** `feat: bot brain — aerial movement, reaction-delayed aim, difficulties`

---

### Task 11: Bot class kits, personality, overtime awareness

**Files:** Modify `src/botBrain.js`; extend `test/botbrain-test.mjs`.

- [ ] **Step 1: verbs + kits.** Implement five generic verbs as brain methods, then a full `BOT_KITS` with per-class parameters so each class fights distinctly. Damage numbers deliberately ~15% under player-side equivalents (bots shouldn't out-damage humans at equal skill):

```js
// verbs (each sets avatar.playAttack() + FX + audio):
_vVolley({n, dmg, speed, spread, color, interval})   // n bolts over n*interval s (queued via this._queue)
_vLunge({dmg, kb, range})    // dash at player; on arrival within range: player.takeDamage + knockback (melee gap-closer)
_vSlam({dmg, r, kb})         // AoE around bot: ring FX + damage if player within r (burst / brawler ult)
_vBlinkAway()                // escape: dash burst away from player + up
_vBigShot({dmg, speed, size, aoe, color, chargeT})   // telegraphed: net.charging for chargeT, then heavy projectile

const BOT_KITS = {
  mage:     { range: 24, basic: bolt(9, 34, 0.5, 0xbb88ff),
              gap: null, burst: { cd: 7,  use: b => b._vVolley({n:3, dmg:8, speed:38, spread:0.05, color:0xbb88ff, interval:0.12}) },
              escape: { cd: 9, hpBelow: 0.35, use: b => b._vBlinkAway() },
              ult: { cd: 22, use: b => b._vBigShot({dmg:30, speed:26, size:1.2, aoe:5, color:0xe8ccff, chargeT:1.0}) } },
  brawler:  { range: 4,  basic: melee(11, 3.2, 0.7),
              gap: { cd: 5, minD: 8, maxD: 26, use: b => b._vLunge({dmg:14, kb:12, range:3.5}) },
              burst: { cd: 9, use: b => b._vSlam({dmg:18, r:5, kb:16}) },
              escape: { cd: 10, hpBelow: 0.3, use: b => b._vBlinkAway() },
              ult: { cd: 24, use: b => b._vSlam({dmg:30, r:8, kb:22}) } },
  reaver:   { range: 6,  basic: melee(12, 3.6, 0.8), gap: lunge-ish, burst: volley of 2 heavy, ... },
  sorcerer: { range: 26, basic: bolt(8, 30, 0.55, 0x66aaff), burst: _vBigShot blue orb, ult: _vBigShot purple (dmg 34, aoe 6) },
  assassin: { range: 14, basic: bolt(7, 42, 0.4, 0x9a5fff, poison {dps:3,t:2}), gap: lunge, escape at 0.4 hp, ult: volley 5 },
  gambler:  { range: 20, basic: bolt(8, 33, 0.5, 0xffd76a), burst: seeded-random one of {volley, slam, bigshot} ("the bot gambles"), ult: _vVolley({n:6,...}) },
};
```

`bolt(dmg, speed, cd, color, poison?)` and `melee(dmg, range, cd)` are tiny factory helpers returning `{range, cd, fire}` — melee `fire` does the distance check + `player.takeDamage(dmg, botPos)` + knockback like `Enemy.meleeStrike`. `_fight` gains: gap when `d` in `[minD, maxD]`; burst per intent; escape when `hp < hpBelow`; ult only when player is vulnerable (`player rooted || player.health < 40 || just-landed`) and off cooldown. All verb cds scale by `diff.cdMul`.

- [ ] **Step 2: personality.** `updateIdle`: during countdown, hop every ~1.2s + small strafes. `onRoundWon` sets `this._spinT = 1.2`; while `_spinT > 0` (in roundover, BotDuel calls `brain.updateIdle` there too — add that call in BotDuel's roundover branch) the avatar's `net.yaw` spins 360°. Hesitation: after any burst/ult verb, `this.hesitateT = 0.5 + Math.random() * 0.5` (already gated in `update`).
- [ ] **Step 3: overtime awareness — `_hazardDanger(pos)` + `_safeGoal()` upgrades:**

```js
_hazardDanger(pos) {
  const w = this.g.world, ot = w.overtime;
  let danger = 0;
  const h = w.hazards;
  if (h && h.pullR !== undefined) {                       // the Maw
    const d = pos.distanceTo(h.center);
    if (d < h.pullR + 4) danger = Math.max(danger, 1 - d / (h.pullR + 4));
  }
  if (ot?.started) {
    if (ot.R !== undefined) {                             // storm: outside the wall is death
      const d = Math.hypot(pos.x, pos.z);
      if (d > ot.R - 3) danger = Math.max(danger, 0.8);
    }
    if (ot.lavaY !== undefined && pos.y < ot.lavaY + 6) danger = Math.max(danger, 0.9);
    if (ot.strikes) for (const s of ot.strikes.list) {    // telegraphed strikes
      if (pos.distanceTo(s.pos) < s.o.r + 2) danger = Math.max(danger, 0.85);
    }
  }
  return danger;
}
```

`_safeGoal()` when overtime is up: storm → a point at radius `ot.R * 0.5` toward the eye; lava → highest island top; maw → away from center; strikes → perpendicular step off the nearest ring; flip (`w.gravityFlipped`) → the canopy footprint center `(4, 50, 4)`.

- [ ] **Step 4: test extensions.** botbrain-test: (a) kit coverage — for each of the 6 classes, run 20s vs the fake player, assert projectiles or melee damage registered (player.health dropped or spawns fired); (b) storm avoidance — fake overtime `{ started: true, R: 30, strikes: {list: []} }` on the world object, park bot at radius 60, run 15s, assert `Math.hypot(bot.x, bot.z) < 45` (it ran inward). Run all tests.
- [ ] **Step 5: manual browser pass** — one full match per difficulty; Nightmare should feel scary, Rookie beatable; bot on Tempest post-OT runs for the eye.
- [ ] **Step 6: Commit** `feat: bot class kits, personality, overtime survival instincts`

---

### Task 12: Final integration — spec sync, progress notes, full verification

**Files:** Modify `docs/superpowers/specs/2026-07-31-bot-duel-and-overtime-design.md`, `.harness/progress.md`; no code except review fixes.

- [ ] **Step 1:** update the spec's two drifted points: Godspire endgame = marble-rubble bombardment (no black hole on that map); Void Garden endgame = the Maw hunts (moves toward players) instead of eating island terrain.
- [ ] **Step 2:** run every node test (`world`, `overtime`, `botbrain`, plus existing `belt/fxnet/fxprops/gambler/regen/tutorial` tests) — all PASS.
- [ ] **Step 3:** browser passes: (a) solo wave run unaffected (no timer shown); (b) online duel harness (`test/duel-harness.html` + local peerjs broker) — fast-forward both clients with `SKYBREAK.step(1/60, 60*130)` and verify both hit OVERTIME on the same frame and island removal matches (classic); (c) bot duel full match on Belt reaching the gravity flip.
- [ ] **Step 4:** spawn one fresh-context reviewer subagent on the full diff (correctness + requirement gaps only).
- [ ] **Step 5:** append one line to `.harness/progress.md`; final commit `feat: bot duels + overtime — final polish and spec sync`.

---

## Self-review notes (checked)

- **Spec coverage:** bot (tiers ✓ task 10, kits ✓ 11, random-or-pick ✓ 9, illusion+name ✓ 9, personality ✓ 11, survival ✓ 11); overtime (timer+HUD ✓ 2, all 6 maps ✓ 3–8, escalation ✓ each, no-training ✓ by omission, bot duels included ✓ mode gate).
- **Known deliberate deviations from spec:** Godspire endgame and Void Garden endgame (Task 12 syncs the spec; user informed).
- **Type consistency:** `makeOvertime(world, game)` everywhere; `removeIsland/removePlatform/removeGravPlate` names consistent; `setDuelInfo` 4th arg optional everywhere; `activeDuel` getter used by menus only.
- **Placeholder scan:** structural `/* ... */` comments in Tasks 10–11 are implementation directives with explicit expansion instructions in the step text, not TBDs.
