# Maps, Tutorials & Training Grounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A map system with 5 new maps (Tempest Crown, Ember Reach, Godspire, Voidgarden, Shattered Belt last), a Training Grounds map, guided per-class tutorials, and out-of-combat regen in multiplayer.

**Architecture:** `World` becomes data-driven from a map-def registry (`src/maps/`), owns all its meshes under one disposable root group, and gains deterministic seeded hazards + orbiting platforms. Duel/FFA sync `{map, seed}` in their existing `'start'` messages. Tutorials become an event-driven objective engine on a new flat Training Grounds map.

**Tech Stack:** three.js 0.185 (vendored), vanilla JS ES modules, PeerJS (vendored), no build step. Test via `window.SKYBREAK.step(dt, n)` harness pages in `test/`.

## Global Constraints

- No real `setTimeout` in game logic/tests — background tabs throttle timers; use sim-time countdowns (memory: step() harness).
- Painterly look everywhere: vertex-colored flat shading, procedural canvas textures, merged geometry / instancing (match world.js patterns).
- Shadow camera covers ±95 and menu camera orbits at radius 58 looking at (0,3,0) — keep all maps' playable mass within ~±90 of origin with fightable ground near origin.
- Collision API is sacred: `world.islands`, `world.platforms`, `world.columns`, `groundHeightBelow(x,z,refY,time,tol)`, `World.islandHeightAt/islandBottomAt/edgeRadius` keep signatures. All player/enemy/ability code depends on them.
- Damage stays self-authoritative in multiplayer; hazards damage only the local player + local PvE enemies, never remote avatars.
- Determinism: hazard schedules derive ONLY from `world.hazardClock` + `mulberry32(seed)` — never `Math.random()`, never wall-clock.
- User is non-technical; they playtest personally. After each map lands, it must be reachable from the UI for playtesting.
- Commit style: short imperative subject lines like existing history ("gambler", "Add mouse sensitivity setting").

---

### Task 1: Map registry + World takes a map def (Classic parity)

**Files:**
- Create: `src/maps/index.js`, `src/maps/classic.js`
- Modify: `src/world.js`, `src/game.js`, `src/player.js` (respawn/void-reset spawn point)
- Test: `test/maps-harness.html`

**Interfaces:**
- Produces: `MAPS` (array of ids), `getMap(id)`, `randomMapId(rng)` from `src/maps/index.js`.
- Map def shape (consumed by World):
  ```js
  {
    id: 'classic', name: 'SKY SANCTUM', blurb: 'the sunset islands',
    env: {
      sunDir: [0.38, 0.30, -0.87], sunColor: 0xffd9a3, sunIntensity: 2.6,
      hemi: [0x6a79c9, 0xb06a45, 0.85],
      fog: { color: '#d97e55', near: 110, far: 620 },
      sky: { zenith: '#2b3a6e', mid: '#8a4a74', horizon: '#ff9a55', sun: '#fff2c4',
             starHeight: 0.22, starDensity: 0.9965, aurora: 0 },
      glow: [ { scale: 500, opacity: 0.55, color: 0xffb36b }, { scale: 210, opacity: 0.9, color: 0xfff0c0 } ],
      clouds: { tintA: 0xffd9c0, tintB: 0xfff5ec, low: 26, far: 12, high: 7 },
      motes: { color: 0xffcf9a, count: 260 },
      palette: { /* PALETTE overrides; classic = current values */ },
    },
    islands: [ { x,z,topY,R,domeH,depth,seed, trees,rocks,crystals, ruins?, flat?, bare? } ],
    platforms: [ { x,z,baseY,R, amp,speed,phase, orbit? } ],
    build(world, scene, rng) {},          // optional map-unique geometry
    makeHazards(world, game) {},          // optional, Task 4+; returns {update(dt)}
    spawns: { solo: [0,4,8], duel: [[0,4.5,22,0],[0,4.5,-22,Math.PI]],
              ffa: [[0,4.5,22,0],[0,4.5,-22,Math.PI],[22,4.5,0,Math.PI/2],[-22,4.5,0,-Math.PI/2]] },
  }
  ```
  (duel/ffa spawn entries are `[x, y, z, yaw]`.)
- `new World(scene, mapDef)`; `world.dispose()`; `world.mapDef`; `world.soloSpawn` (Vector3); `world.hazardClock` (number, reset by `resetHazards(seed)`).
- `game.loadMap(mapId, seed = 1)` → disposes + rebuilds world, re-points `game.player.world` and `game.projectiles.world`, returns the world.

**Steps:**

- [ ] **Step 1: Extract Classic into `src/maps/classic.js` + write `src/maps/index.js`**
  - Move the 6-island `defs` table, platform `spots` table, PALETTE values, fog/sun/sky constants out of `world.js` verbatim into the classic def. `index.js`:
  ```js
  import { CLASSIC } from './classic.js';
  export const MAP_DEFS = { classic: CLASSIC };
  export const MAPS = ['classic'];
  export function getMap(id) { return MAP_DEFS[id] || CLASSIC; }
  export function randomMapId(rand = Math.random) { return MAPS[Math.floor(rand() * MAPS.length)]; }
  ```
  (`randomMapId` gets the multiplayer pool later; menu/solo picker adds 'training' separately.)

- [ ] **Step 2: Refactor `world.js`**
  - Constructor `(scene, mapDef)`: store `this.mapDef`, build `this.root = new THREE.Group()`, add root to scene, and change every `this.scene.add(x)` in build helpers to `this.root.add(x)`.
  - `PALETTE` becomes `this.palette = { ...DEFAULT_PALETTE, ...mapDef.env.palette }` (THREE.Color-ify strings once). Pass palette through to the geometry helpers (they currently close over module-level PALETTE — thread it as a parameter).
  - Lights/sky/fog/clouds/motes read `mapDef.env` (per-instance `this.sunDir`; keep exporting `SUN_DIR` as the classic default for safety).
  - Sky shader: add uniforms `starHeight`, `starDensity`, `auroraStrength`, `auroraColor` (aurora term added in Task 8; wire uniforms now, strength 0 = today's look).
  - `_buildIslands()` iterates `mapDef.islands`; `_buildPlatforms()` iterates `mapDef.platforms`; call `mapDef.build?.(this, this.root, mulberry32(50))` at the end of the constructor.
  - `dispose()`: `scene.remove(root)`; traverse root disposing geometry/material/material.map; also remove `this.scene.fog`? No — leave fog, next World overwrites it.
  - `resetHazards(seed)`: `this.hazardClock = 0; this.hazardRng = mulberry32(seed); this.hazards = this.mapDef.makeHazards?.(this, this._game) || null;` — game reference set by loadMap. `update(dt, time, game)` adds `this.hazardClock += dt; this.hazards?.update(dt);`.
  - `this.soloSpawn = new THREE.Vector3(...mapDef.spawns.solo)`.

- [ ] **Step 3: `game.loadMap` + spawn-point plumbing**
  ```js
  loadMap(mapId, seed = 1) {
    if (this.world) this.world.dispose();
    this.world = new World(this.scene, getMap(mapId));
    this.world._game = this;
    this.world.resetHazards(seed);
    this.player.world = this.world;
    this.projectiles.world = this.world;
    return this.world;
  }
  ```
  - Constructor: replace `this.world = new World(this.scene)` with `this.world = null; this.loadMap('classic');` (order: player/projectiles are built after world today — construct world first, then player/projectiles, then call `loadMap` only from mode starts).
  - `player.respawn()` and the void-reset at y<-110 use `this.world.soloSpawn` instead of hardcoded (0,4,8)/(0,6,8).
  - `startRun/startTutorial/startDuel/startFfa` call `this.loadMap(...)` (classic for now) BEFORE `player.respawn()`. `toMenu()` reloads classic if the current map isn't classic (menu backdrop).
  - `tutorial.js` `spot()` keeps working (it reads `g.world.islands[0]`) — leave as is until Task 4 rewrite.

- [ ] **Step 4: Write `test/maps-harness.html`**
  - Copy the iframe-less pattern: import `main.js`-style boot directly (single client, no PeerJS). Expose `window.SKYBREAK` already exists in main.js — confirm and add `game` handle if missing. Harness script:
  ```js
  const g = window.SKYBREAK.game;
  const results = [];
  for (const id of [...MAPS, 'training']) {   // training joins in Task 3
    const before = g.scene.children.length;
    g.loadMap(id, 42); g.loadMap(id, 42);      // double-load: dispose leak check
    const after = g.scene.children.length;
    const sp = g.world.soloSpawn;
    const ground = g.world.groundHeightBelow(sp.x, sp.z, sp.y + 1, 0, 2);
    for (const s of [...g.world.mapDef.spawns.duel, ...g.world.mapDef.spawns.ffa]) {
      const gr = g.world.groundHeightBelow(s[0], s[2], s[1] + 1, 0, 2.5);
      if (gr === null) results.push(`FAIL ${id}: spawn ${s} has no ground`);
    }
    if (ground === null) results.push(`FAIL ${id}: solo spawn floats`);
    if (after !== before) results.push(`FAIL ${id}: leaked ${after - before} scene nodes`);
    window.SKYBREAK.step(0.016, 120);          // 2s sim: no throws
  }
  document.title = results.length ? 'FAIL' : 'PASS';
  document.body.textContent = results.join('\n') || 'PASS';
  ```
- [ ] **Step 5: Verify** — `node server.js`, open `http://localhost:8123/test/maps-harness.html`, expect PASS; then load the game root, start a solo run, confirm the classic map is pixel-identical (sunset, ruins, bobbing platforms) and a full wave plays.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "Map registry: world built from map defs, classic extracted"`

---

### Task 2: Orbiting platforms + horizontal carry

**Files:**
- Modify: `src/world.js`, `src/player.js`
- Test: extend `test/maps-harness.html`

**Interfaces:**
- Platform def gains `orbit: { cx, cz, r, angSpeed, phase }` (radians/s). Produces `world.platformPosAt(p, time, out)` → `{x,z}` written into `out` (THREE.Vector2-like `{x,z}` plain object) and `world.platformCarry(x, z, feetY, time, dt, outV3)` → true if a platform under the point moved, with its frame delta in `outV3`.

**Steps:**

- [ ] **Step 1: Time-dependent platform position**
  ```js
  platformPosAt(p, time, out = {}) {
    if (p.orbit) {
      const a = p.orbit.phase + time * p.orbit.angSpeed;
      out.x = p.orbit.cx + Math.cos(a) * p.orbit.r;
      out.z = p.orbit.cz + Math.sin(a) * p.orbit.r;
    } else { out.x = p.x; out.z = p.z; }
    return out;
  }
  ```
  - `platformHeightAt(p, x, z, time)` uses `platformPosAt` instead of `p.x/p.z`. Mesh update in `world.update` sets `mesh.position.x/z` too.
- [ ] **Step 2: Carry** — in `Player.update`, after the ground-snap block, if `this.grounded`:
  ```js
  // moving platforms carry you: apply the ground's frame delta
  if (this.world.platformCarry(this.position.x, this.position.z, this.position.y, time, dt, _v2)) {
    this.position.add(_v2);
  }
  ```
  `platformCarry` finds the highest platform whose disc contains (x,z) with `|platformTopY - feetY| < 0.5`, computes pos(time) − pos(time−dt) (x, z, and bob y=0 — vertical already handled by ground snap), writes to out.
- [ ] **Step 3: Harness check** — add to maps-harness: register a temp orbiting platform on classic, step 1000 frames with a simulated grounded probe: assert `groundHeightBelow` tracks it around the circle (query at the orbit position for several times). Expect PASS.
- [ ] **Step 4: Commit** — `"Orbiting platforms with player carry"`

---

### Task 3: Training Grounds map + dummy extraction + free practice

**Files:**
- Create: `src/maps/training.js`, `src/dummy.js`
- Modify: `src/world.js` (flat islands), `src/tutorial.js` (import dummy), `src/maps/index.js`
- Test: `test/maps-harness.html` (already loops training)

**Interfaces:**
- `flat: true` island: `islandHeightAt` returns exactly `topY` inside the edge (no dome/noise), `edgeRadius` returns exactly `R` (no wobble) — gate both on `island.flat`.
- `src/dummy.js` exports `TrainingDummy` (moved verbatim from tutorial.js, plus constructor opt `{ maxHp = 100 }`).
- `TRAINING` def: one flat island R=26 at origin topY=0; `bare` grid look: in `buildIslandGeometry`, when `island.flat`, color top faces in a light-stone checker by `(floor(cx/4)+floor(cz/4))%2` between `palette.stone` and `palette.stoneDark`; 2 raised static platforms (R=3.5 at (±12, 4.5/7, -10)); 3 floating torus "rings" (visual only, `build()` hook: `THREE.TorusGeometry(1.6, 0.18)` emissive gold at (~(-8,7,8),(0,10,2),(8,13,-4)) tilted); env: pale morning sky (zenith #6d88c8, mid #a8b6d8, horizon #f2e6c8), soft white sun 2.2, gentle fog, few clouds, no stars.
- Dummy layout helper exported from training.js: `DUMMY_SPOTS = [ [6,0,-4],[9,0,0],[6,0,4], [20,0,-6],[20,0,6], [12,4.5,-10] ]` (last one on the raised platform; y is ground-relative feet, resolve via `groundHeightBelow` at spawn time).

**Steps:**

- [ ] **Step 1: flat-island support in world.js** (guard in `edgeRadius`/`islandHeightAt`/`buildIslandGeometry` top color), write training.js def, register `'training'` in MAP_DEFS but NOT in the multiplayer `MAPS` pool: `export const MP_MAPS = ['classic']` (new maps join in Tasks 5-8) and keep `MAPS` = all ids for harness/menus.
- [ ] **Step 2: Extract `TrainingDummy` → `src/dummy.js`**; tutorial.js imports it. No behavior change.
- [ ] **Step 3: Free practice entry** — `game.startTutorial(classId = 'mage', scriptId = 'basics', mapId = 'training')` signature (menus wire in Task 9; keep the old no-arg call working with these defaults). It calls `this.loadMap(mapId)` and passes scriptId to `tutorial.start(scriptId)` (tutorial engine still the old one — it ignores scriptId until Task 4; dummies now spawn at `DUMMY_SPOTS` resolved against the loaded world instead of islands[0] angles).
- [ ] **Step 4: Verify** — harness PASS (training included); manually: TUTORIAL button now lands on the flat grid plate with dummies, mage combat works, dummies regen.
- [ ] **Step 5: Commit** — `"Training grounds map + dummy module"`

---

### Task 4: Guided tutorial engine + Basics + 6 class scripts

**Files:**
- Create: `src/tutorials.js` (scripts data)
- Rewrite: `src/tutorial.js` (engine + objective UI; keep file name)
- Modify: `src/game.js` (event taps), `src/dummy.js` (hit events), `src/playerCombat.js` (charge-release event already exists via onPlayerCast — no change)
- Test: `test/tutorial-harness.html`

**Interfaces:**
- Event stream: `game.emitTut(type, data)` — no-op unless `game.state === 'tutorial'`. Emitted from:
  - game.js constructor hooks: inside existing `player.onJump` → `this.emitTut(isDouble ? 'doubleJump' : 'jump')`; `player.onDash` → `'dash'`; `player.onLand` → `'land'`.
  - `onPlayerCast` already routes duel/ffa; append `this.emitTut('cast', { slot, power })`.
  - `dummy.takeDamage(dmg, opts)` → `game.emitTut('dummyHit', { dummy: this, dmg, opts })` (opts carries knockback/freeze/poison/slow so scripts can detect e.g. poison application).
- Script schema in tutorials.js:
  ```js
  export const TUTORIAL_SCRIPTS = {
    basics: { title: 'BASICS', classId: 'mage', steps: [
      { text: 'Move with WASD', poll: (g) => g.player.vel.lengthSq() > 4 },
      { text: 'Jump with SPACE', on: 'jump' },
      { text: 'Double jump — SPACE again in mid-air', on: 'doubleJump' },
      { text: 'Air dash 3 times — SHIFT in mid-air', on: 'dash', count: 3, when: (g) => !g.player.grounded },
      { text: 'Hit a dummy with your attack (LMB)', on: 'dummyHit' },
      { text: 'Hold Q to FULLY charge, then release on a dummy', on: 'cast', when: (g, d) => d.slot === 'Q' && d.power >= 0.99 },
      { text: 'Deal 100 total damage to dummies', on: 'dummyHit', sum: (d) => d.dmg, target: 100 },
    ]},
    // mage, brawler, reaver, sorcerer, assassin, gambler: same shapes
  };
  ```
  Step fields: `on` (event type) + optional `when(g, data)` filter + optional `count` (n events) or `sum(data)/target` (accumulate), or `poll(g)` checked per frame. One of on/poll required.
- Engine (`tutorial.js`): `start(scriptId)`, `onEvent(type, data)`, `update(dt)`, `exit()`. Spawns dummies from `DUMMY_SPOTS`. UI: card shows ✓-list of done steps (collapsed to last 3), current step text + `2/3` progress, gold flash + `audio.play('chargeFull')` per completion, `hud.announce('TUTORIAL COMPLETE','')` + `audio.play('waveClear')` + burst at player on finish; free practice continues. `scriptId === 'free'` → no steps, just the dummies and an EXIT button.

**Steps:**

- [ ] **Step 1: Write `test/tutorial-harness.html` (failing first)** — boots game, calls `game.startTutorial('mage', 'basics')`, then drives synthetic events: `g.emitTut('jump')` etc. + sets `g.player.vel` for the poll step, and asserts `g.tutorial.stepIdx` advances through all steps to the COMPLETE state. Expect FAIL (engine not built).
- [ ] **Step 2: Build the engine + emitTut taps + basics script.** Run harness → PASS.
- [ ] **Step 3: Write the 6 class scripts.** Before writing each, READ the class def in `classes.js` (mage 163-, brawler 319-, reaver 530-, sorcerer 706-, assassin 970-) and `gambler.js` for exact slots/mechanics; every "do X ability" step checks `on:'cast'` with the right slot (+ `power>=0.99` where the script says fully charge), every "hit N dummies at once" uses `on:'dummyHit'` with a per-cast set keyed by `g.simTime` window (helper `multiHit(n, windowS)` in tutorials.js producing a `when` closure). Guideline content (adjust to real ability names found in the code):
  - mage: charged Firebolt · each ability Q/E/R/F once · 60 dmg in one charged cast.
  - brawler: melee combo 3 hits · Haymaker knockback a dummy · Hundred Fists (root) full duration on a dummy · Shockwave through 2 dummies.
  - reaver: Skypiercer m1 · Thunderclap hitting 2 dummies at once · Cyclone launch · Slipstream then hit the dragged dummy.
  - sorcerer: cast each orb color's verb once (read Blue/Purple tweaks) · full-charge finisher.
  - assassin: apply poison · Shadowstep through a dummy · Void Slash 2 dummies · FULL-charge Eviscerate (execute refuses below 0.99 — step uses `on:'cast'` slot+power).
  - gambler: spin once · act on any payoff · land a jackpot (check gambler state field for jackpot flag read from `g.combat.state` in a poll — read gambler.js `rollSpin` for the flag name).
- [ ] **Step 4: Extend tutorial-harness** to run every script with scripted synthetic events (each script lists its own event feed in the harness). PASS.
- [ ] **Step 5: Manual pass** — play the Basics + one class tutorial end-to-end.
- [ ] **Step 6: Commit** — `"Guided objective tutorials for basics + all six classes"`

---

### Task 5: Tempest Crown (wind rivers + lightning)

**Files:**
- Create: `src/maps/tempest.js`
- Modify: `src/maps/index.js` (register + add to MP_MAPS), `src/world.js` (nothing expected — hazards use the Task 1 hooks)
- Test: extend `test/maps-harness.html` determinism check

**Interfaces:**
- Hazard object: `makeHazards(world, game)` returns `{ update(dt), windAt(pos, outV3) }`.
- Wind river def inside map: `winds: [ { pts: [[x,y,z],...], r: 3.5, speed: 46 } ]` — polyline; `windAt` finds the nearest segment within r and returns the segment direction × speed.

**Steps:**

- [ ] **Step 1: Map def** — ring of 6 islands (R 9-13, topY 2-14) at radius ~48 around an empty eye, 2 low central platforms (baseY -2, R 4); env: zenith #1a2340, mid #3a4468, horizon #7a86b8, fog #4a5578 (near 90 far 520), sun 0x9fb4ff intensity 1.7, dense dark clouds (tint 0x6a7490/0x9aa4c0), motes 0xaBc4ff, crystals teal. Sky-wide flicker: hazard update occasionally (seeded, ~every 6-10s) pops `world.sun.intensity` ×1.8 for 0.12s.
- [ ] **Step 2: Wind rivers** — 3 rivers connecting far islands through the eye (pts curved via 4-5 waypoints each). Player force in hazard update:
  ```js
  if (hz.windAt(g.player.position, _w)) {
    g.player.vel.addScaledVector(_w, dt * 2.4);            // strong push along the river
    const cap = _w.length() * 1.15;                        // allow beyond walk-speed cap
    // exempt from the walk-speed clamp by riding via vel.y? No — simplest:
    g.player.slowFall(0.2);                                // no fall-out mid-river
  }
  ```
  The walk-speed clamp caps horizontal speed at walkSpeed; wind must beat it: while in wind set `g.player.windBoostT = 0.25` and in player.js the clamp uses `maxH = this.walkSpeed * (this.speedMul||1) + (this.windBoostT>0 ? 40 : 0)`; decrement windBoostT with the other timers. (Small player.js touch — add to Files.)
  Visual: per-river `THREE.Points` streaks advected along segments (recycled positions, additive, 0x9fd8ff).
- [ ] **Step 3: Lightning** — schedule: `nextAt = clock + 14 + rng()*8`; pick island via `rng()`; telegraph: gold-white expanding `effects.ring` per 0.4s + emissive disc mesh 2s; strike: `effects.beam` from y+60, `impactBurst`, flash, `audio.play('explosion')`, radius 6: local player `takeDamage(45, null, {})` + knockup `applyKnockback(new THREE.Vector3(0,14,0))`; PvE enemies `takeDamage(45, {knockback})`; never DuelOpponent avatars (skip `e.netId !== undefined`).
- [ ] **Step 4: Determinism check in maps-harness** — two fresh loads with seed 7: record first 3 lightning (time, islandIndex) pairs by exposing `world.hazards.log` (array, test-only push). Assert equal. PASS.
- [ ] **Step 5: Playtest hook** — temporarily set solo map default to tempest? NO — Task 9 adds the picker; for now add `?map=tempest` URL param read in `startRun` (`new URLSearchParams(location.search).get('map')`), kept permanently as a dev shortcut.
- [ ] **Step 6: Commit** — `"Tempest Crown map: wind rivers + seeded lightning"`

---

### Task 6: Ember Reach (geysers + caldera)

**Files:**
- Create: `src/maps/ember.js`
- Modify: `src/maps/index.js`
- Test: maps-harness determinism block reused (geyser log)

**Steps:**

- [ ] **Step 1: Map def** — 6 obsidian islands (palette: grass→ash #4a4340/#5a4f45, dirt #3a3230, rock #2e2a28/#181514, warm #7a3520), heights topY -4..18; env: zenith #3a1a20, mid #7a2e22, horizon #ff7a30, fog #8a3a22, sun 0xff9a55 ×2.2, clouds ash-grey, motes = rising embers (0xff9a44, drift up faster: motes update already rises — bump via env.motes.riseMul), crystals → magma-orange. `build()`: giant lava disc `CircleGeometry(300)` emissive 0xff5a20 at y=-80 with slow emissive pulse (register material in `world.crystals` so it pulses), + emissive crack lines: thin box strips on island tops (merged, emissive 0xff6a2a).
- [ ] **Step 2: Geysers** — 5 vents `[x,z]` on the larger islands; def `{ cycle: 9, warn: 1.5, blast: 2, phase: rng()*9 }` each. Vent mesh: dark rock ring + inner emissive disc. State from `(clock + phase) % cycle`: warn window → steam glows + rumble shake if player within 6; blast window → fire column (cylinder mesh, additive, emissive, scale-y pop) and on the FIRST frame of blast anything (player / PvE enemies) inside r=2 of the vent with feet within column height gets `vel.y = max(vel.y, 32)` (player: `applyKnockback(0, 32-vel.y, 0)`; enemy: `takeDamage(0,{knockback})` skip — set `e.vel.y` directly if it has one, else knockback opt) + lingering: while blasting, 10 dps to player (`takeDamage(10*dt … )` accumulate to whole points: apply 5 per 0.5s tick) and PvE enemies.
- [ ] **Step 3: Harness determinism** (geyser phases are pure functions of clock — assert two loads' vent phases equal) + spawn checks auto-cover. PASS.
- [ ] **Step 4: Playtest** via `?map=ember`.
- [ ] **Step 5: Commit** — `"Ember Reach map: caldera + launching fire geysers"`

---

### Task 7: The Godspire (vertical tower)

**Files:**
- Create: `src/maps/godspire.js`
- Modify: `src/maps/index.js`

**Steps:**

- [ ] **Step 1: Base island + env** — one big base island (R 22, topY 0, ruins-less) + 3 satellite islands (R 8-10, topY 18/30/42, at radius ~40, angles 0.3/2.4/4.5); env: bright noon (zenith #2e5da8, mid #7aa8d8, horizon #e8f0f8, fog #b8cce0 near 130 far 700, sun 0xfff4d8 ×2.9 from steeper sunDir [0.2,0.75,-0.6]), palette marble (stone #d8cfc0, stoneDark #a89a88, grass ivy #4a8a4f).
- [ ] **Step 2: Tower via `build()`** — stacked cylinders at origin: radius 14→9 over segments y 0..70 (5 segments, slight taper, painterly-painted, flat-shaded); each segment adds a `world.columns` entry `{x:0,z:0,r:<segR>,yBottom,yTop}` (column collision already pushes players out horizontally). Spiral ledges: 14 static platforms winding up (`angle = i*0.9`, `y = 4 + i*4.6`, placed at radius segR+2.2, R 3.2, amp 0) — these are `world.platforms` entries pushed by build(). 3 broken bridges: rows of 4 overlapping static platform discs (R 2.2, spacing 3.5) from ledge heights 18/30/42 toward each satellite island. Crown: platform R 6 at y 72 + emissive gold beacon (octahedron + PointLight, registered in `world.crystals` to pulse).
- [ ] **Step 3: Orbiting rubble** — 6 platforms `orbit: {cx:0, cz:0, r: 20..26, angSpeed: ±0.10..0.16}` at y 12/24/36/48/58/66, R 2.6-3.4 (bare rock look, Task 2 machinery does the rest).
- [ ] **Step 4: Spawns** — duel: two opposite mid ledges `[16,23,0,π/2]/[-16,23,0,-π/2]` (resolve exact ledge tops in code with groundHeightBelow at build time — adjust numbers to land ON ledges); ffa: base, ledge 20, ledge 40, crown. Solo `[0,2,14]`. Harness PASS validates them.
- [ ] **Step 5: Playtest** `?map=godspire`; check waves (spawns cling to nearest island incl. base — acceptable) and that the menu orbit camera at r58 frames the tower.
- [ ] **Step 6: Commit** — `"Godspire map: vertical tower with spiral ledges + orbiting rubble"`

---

### Task 8: Voidgarden (night sky + orbiting gardens)

**Files:**
- Create: `src/maps/voidgarden.js`
- Modify: `src/maps/index.js`, `src/world.js` (aurora shader term)

**Steps:**

- [ ] **Step 1: Aurora in the sky shader** — add to fragment (gated on `auroraStrength > 0.0`): two sine-band ribbons around the zenith:
  ```glsl
  float band = sin(dir.x * 3.1 + dir.y * 6.0) * sin(dir.z * 2.3 + dir.y * 4.0);
  float aur = smoothstep(0.15, 0.75, dir.y) * pow(max(band, 0.0), 2.0) * auroraStrength;
  col += auroraColor * aur;
  ```
  Classic keeps `auroraStrength: 0` — verify classic renders identically.
- [ ] **Step 2: Map def** — central garden island (R 16, topY 0) + 5 orbiting platform-islands (`orbit` r 26-40, angSpeed 0.08-0.15 mixed signs, baseY 2..16, R 5-7, amp 0.5) + 3 static outer islands (R 8, radius ~55); env: zenith #0a0e2a, mid #1c1440, horizon #38285a, fog #221a3e (near 80 far 520), moon-sun 0xaFc8ff ×1.1, starDensity 0.993 + starHeight 0.05 (stars everywhere), aurora 0.5 color 0x44ffcc, sparse dark clouds, motes 0x88ffd8; palette: night grass #2a5a55/#3a7a68, warm #6a4a9a.
- [ ] **Step 3: Bioluminescent decorations** — flowers: instanced cross-plane tufts reuse (`makeGrassTufts` pattern) with a new canvas flower texture (petal blob, cyan/magenta), plus every island gets 2-3 crystal clusters (already pulse+glow). Void mist: 8 large soft dark sprites at y ≈ -35 drifting slowly (cloud machinery with negative y band — reuse addCloud with custom band).
- [ ] **Step 4: Playtest + harness PASS** (`?map=voidgarden`). Confirm orbiting islands carry you (stand and drift).
- [ ] **Step 5: Commit** — `"Voidgarden map: aurora night sky + orbiting garden islands"`

---

### Task 9: Menus (solo map row, tutorial picker) + multiplayer random map sync

**Files:**
- Modify: `src/menus.js`, `src/ui.css`, `src/game.js`, `src/duel.js`, `src/ffa.js`, `src/maps/index.js` (`MP_MAPS = ['classic','tempest','ember','godspire','voidgarden']`)
- Test: `test/duel-harness.html`, `test/ffa-harness.html` (assert both clients land on the same rolled map)

**Steps:**

- [ ] **Step 1: Solo map row** — in `_buildSelect()`, above the class grid: `MAP: [CLASSIC][TEMPEST][EMBER][GODSPIRE][VOIDGARDEN][RANDOM][TRAINING]` chip row (buttons, gold active state in ui.css `.map-chip`). Stores `menus.soloMap = 'classic'|'random'|id|'training'`. `_pickClass` (solo path): `training` → `g.startTutorial(id, 'free', 'training')`; else resolve `'random'` via `randomMapId()` and call `g.startRun(classId, mapId)`. `startRun(classId, mapId = 'classic')` → `this.loadMap(this._resolveMapParam(mapId))` (URL `?map=` param wins for dev).
- [ ] **Step 2: Tutorial picker** — TUTORIAL button now shows a small screen (`menu-tut`): BASICS + 6 class buttons (accent colors from CLASSES) + BACK → each calls `g.startTutorial(script.classId, scriptId, 'training')`. Register screen in `this.screens`, Esc returns to main (add to `_onKey`).
- [ ] **Step 3: Duel map sync** — host `_maybeStart()`: `this.mapId = MP_MAPS[Math.floor(Math.random()*MP_MAPS.length)]; this.seed = (Math.random()*1e9)|0; this.net.send({t:'start', map: this.mapId, seed: this.seed})`. Guest `'start'` handler stores `m.map/m.seed` before `_beginMatch()`. `_beginMatch` → `g.startDuel(this.myClass, this.mapId, this.seed)`; `game.startDuel` passes them to `loadMap`. `_startRound` reads spawns from `g.world.mapDef.spawns.duel` (host = entry 0, guest = entry 1) instead of the SPAWNS const (delete it). Rounds 2-3: same world, just `world.resetHazards(seed + round)` in `_startRound`. Rematch → new roll (host rolls again in `_maybeStart`, which re-runs). HUD: `g.hud.announce('ROUND '+n, '')` becomes two-line with map name on round 1: `g.hud.announce(g.world.mapDef.name, 'sub')` right before.
- [ ] **Step 4: FFA map sync** — `startRound()` (host): roll map+seed, include in `{t:'start', round, spawns, map, seed}`; spawn table built from `getMap(map).spawns.ffa` (`spawns[p.id] = ffa[i % 4]`, still `[x,y,z,yaw]` arrays — update `_beginRound`'s readers `sp.pos[0]…` → `sp[0]…`). `_beginRound(round, spawns, map, seed)` calls `g.startFfa(myClass, map, seed)` → loadMap inside. Mid-round joiners stay in lobby (unchanged). Announce map name at round start.
- [ ] **Step 5: Regression harnesses** — run duel-harness + ffa-harness against local broker (`npx peerjs --port 9788`); add an assert: after round start both iframes report `game.world.mapDef.id` equal (poll via harness JS). Both PASS.
- [ ] **Step 6: Manual pass** — solo picker starts each map; training chip drops into free practice; tutorial picker works.
- [ ] **Step 7: Commit** — `"Solo map picker, tutorial picker, random synced maps in duel/ffa"`

---

### Task 10: Out-of-combat regen (multiplayer)

**Files:**
- Modify: `src/player.js`, `src/duel.js`, `src/ffa.js`
- Test: `test/duel-harness.html` quick assert

**Steps:**

- [ ] **Step 1: Stamp damage time** — `player.takeDamage`: after the alive/invuln early-out passes (i.e., damage actually applied OR absorbed by shield), set `this.lastDamagedAt = this._simTimeRef?.() ?? 0`. Simplest wiring: game.js after constructing player sets `this.player._simTimeRef = () => this.simTime`. ALSO stamp in the two direct-poison paths (`duel.update` and `ffa.update` decrement `health` directly) and in player's own poison tick: set `lastDamagedAt` whenever poison ticks.
- [ ] **Step 2: Regen** — in `duel.update` (phase 'fighting') and `ffa.update` (phase 'fighting'), after the poison block:
  ```js
  // out of combat 10s -> 1 hp/s trickle
  if (g.player.alive && g.simTime - (g.player.lastDamagedAt ?? -999) >= 10) {
    g.player.heal(1 * dt);
  }
  ```
  `respawn()` resets `lastDamagedAt = -999` (add to the reset list).
- [ ] **Step 3: Verify** — duel-harness: script one client to damage the other once, then `step()` 12 sim-seconds and assert hp rose ~2 (10s wait + 2s regen). PASS.
- [ ] **Step 4: Commit** — `"Multiplayer out-of-combat regen: 10s untouched, 1 hp/s"`

---

### Task 11: Shattered Belt (asteroid map — LAST)

**Files:**
- Create: `src/maps/belt.js`
- Modify: `src/player.js` (vector gravity + camera up-blend), `src/world.js` (sphere colliders), `src/maps/index.js` (add to MP_MAPS + MAPS)
- Test: maps-harness (spawns/leaks) + `test/belt-harness.html` (gravity math)

**Interfaces:**
- Map def gains `env.gravityMul` (0.45 here, default 1) and `gravRocks: [ { x, y, z, r, influence } ]` (r = surface radius 4-7, influence = r + 10).
- `world.gravityAt(pos, outDir)` → writes the local gravity direction (unit vector) and returns a strength multiplier; default maps: `outDir.set(0,-1,0)`, returns `env.gravityMul ?? 1`.
- Player gains `this.up = new THREE.Vector3(0,1,0)` (smoothed), `this.gravDir = new THREE.Vector3(0,-1,0)`.

**Steps:**

- [ ] **Step 1: `belt-harness.html` first (failing)** — asserts: (a) `world.gravityAt` far from rocks → (0,-1,0); (b) within influence → unit vector toward rock center; (c) player stepped 300 frames near a rock ends standing on its surface with `grounded === true` and `up` ≈ radial.
- [ ] **Step 2: gravityAt** — nearest rock whose `distance(pos, center) < influence`: `outDir = (center - pos).normalize()`, strength = `env.gravityMul`. Blend zone: within influence, lerp factor `1 - (d - r) / (influence - r)` clamped 0..1 mixes rock-dir into world-down (normalize after) so entry/exit is smooth.
- [ ] **Step 3: Player vector gravity** — in `update`, replace the `this.vel.y -= g * dt` line with:
  ```js
  const gs = this.world.gravityAt ? this.world.gravityAt(this.position, _grav) : (_grav.set(0,-1,0), 1);
  this.vel.addScaledVector(_grav, gBase * gs * dt);   // gBase = the existing stall/slowFall-scaled GRAVITY
  ```
  where `_grav` is a module-scope temp; on normal maps this is numerically identical to today (dir (0,-1,0), gs 1). Damped `this.up` chases `-_grav` (`this.up.lerp(_v2.copy(_grav).negate(), 1 - Math.exp(-6*dt)).normalize()`).
- [ ] **Step 4: Rock surface landing** — after the column-collision block: for each gravRock (world exposes `this.gravRocks` built from the def, also drawn as painterly dodecahedron meshes with emissive vein rings): if `d = pos.distanceTo(center) < r + 0.05` → push out to `r`, kill inward radial velocity, and if radial speed was downward-ish set `grounded = true, jumpsLeft = 2` (grounded-on-rock state: skip the flat ground snap while `d < r + 0.6` — track `this._onRock` flag so ordinary ground logic doesn't fight it). Jump while on a rock: existing jump code sets `vel.y = 13` — generalize: when `this._onRock`, jumps add `13 * up` instead (`vel.addScaledVector(this.up, 13)` after zeroing inward component).
- [ ] **Step 5: Camera up-blend** — `_updateCamera`: build orientation as quaternion: `qUp` aligning (0,1,0)→`this.up`, times yaw/pitch quaternion (`new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, tilt, 'YXZ'))`), applied as `camera.quaternion.copy(qUp).multiply(qYawPitch)` (keep the shake terms inside the euler). On normal maps `up=(0,1,0)` → qUp identity → identical behavior. Add the roll-shake/tilt as today.
- [ ] **Step 6: Map def** — env: deep-space (zenith #05060e, mid #10142a, horizon #2a1e3e, starDensity 0.990/height 0.0, faint magenta nebula via aurora term 0.25 color 0x8844aa, fog #14182a near 100 far 600, cold sun ×1.3, gravityMul 0.45); layout: 7 conventional islands (bare rocky, R 7-12, varied topY -8..24, radius ≤ 60 — these host waves/spawns) + 9 graviton rocks (r 4-6) floating between them at y 6..30 with emissive cyan vein rings; a few orbit platforms. Spawns on the islands.
- [ ] **Step 7: Multiplayer/regression sweep** — belt joins MP_MAPS; run maps-harness (all 8 map defs), tutorial-harness, belt-harness, duel-harness, ffa-harness → all PASS; solo classic feel-check (gravity refactor must not change classic: verify jump apex height by stepping a scripted jump in maps-harness — assert apex within 0.05 of pre-refactor value 2.8… measure BEFORE refactor in Step 1 and hardcode).
- [ ] **Step 8: Playtest** `?map=belt`, tune influence radii / gravityMul by feel with the user.
- [ ] **Step 9: Commit** — `"Shattered Belt map: low gravity + graviton rocks"`

---

### Task 12: Docs, progress, final review

- [ ] Update `HOW TO PLAY.md` (maps section, tutorials, regen note) and `.harness/progress.md` (one milestone line).
- [ ] Run every harness page once more; play one solo run (classic), one tutorial, and load each map via the picker.
- [ ] Spawn ONE fresh-context reviewer subagent on the full diff (correctness/requirement gaps only).
- [ ] Commit — `"Docs + polish for maps/tutorials release"`.

## Self-review notes (done at planning time)

- Spec coverage: map system→T1, orbits→T2, training→T3, tutorials→T4, 4 maps→T5-8, menus+random sync→T9, regen→T10, asteroid→T11, testing→per-task+T12. Solo picker incl. training free-practice→T9. Deviation from spec: enemy horizontal carry on moving platforms skipped (enemy AI re-steers every frame; vertical follow already works) — noted deliberately.
- Type consistency: spawns are `[x,y,z,yaw]` arrays everywhere (duel entries too — duel.js converts to Vector3 at use); `loadMap(mapId, seed)`; `startRun(classId, mapId)`, `startDuel(classId, mapId, seed)`, `startFfa(classId, mapId, seed)`, `startTutorial(classId, scriptId, mapId)`.
- Risk log: walk-speed clamp vs wind (handled via windBoostT), duel round hazard reseed (seed+round), classic parity after vector-gravity refactor (guarded by apex assertion), sky shader uniform additions must default to today's output (aurora 0).
