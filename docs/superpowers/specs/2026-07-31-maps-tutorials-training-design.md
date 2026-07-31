# SKYBREAK — Multiplayer Maps, Class Tutorials & Training Grounds

Date: 2026-07-31 · Status: approved by user (design conversation)

## Goal

Add a real map system with four new handcrafted maps (all playable in solo waves,
duel, and FFA), a clean Training Grounds map, guided objective-based tutorials for
every class plus a Basics tutorial, and out-of-combat regeneration in multiplayer.
A fifth "asteroid / gravity-bending" map is deliberately deferred to its own future
spec (it touches core physics and camera).

## User decisions (locked)

- Maps to build now: **Tempest Crown, Ember Reach, The Godspire, Voidgarden** (all 4).
- **Asteroid map** (low gravity + gravity-bending rocks): saved for last, separate spec.
- Multiplayer map choice: **random every match** (duel: one roll covers all 3 rounds;
  FFA: rolled each round — a round is effectively a match there). No vote/host-pick UI.
- New maps are also playable in **solo wave survival** — class-select gains a map row
  (Classic / 4 new / Random). Classic stays the default.
- Tutorials are **guided objectives** (checklist steps verified by real gameplay
  events), not timed tip cards. The current timer tutorial is retired.
- Multiplayer regen: **untouched for 10 s → regenerate 1 HP/s** until next hit
  (duel + FFA only, not solo).

## 1. Map system architecture

### Map registry (`src/maps.js`)

One module exporting `MAPS` (ordered) + `getMap(id)`. A map def is data + a few
builder hooks:

```
{
  id, name, blurb,
  env: { palette overrides, sunDir, sunColor/intensity, hemi colors, fog color/near/far,
         sky uniforms (zenith/mid/horizon/sun), cloud tint/count, motes color, stars },
  islands: [ { x, z, topY, R, domeH, depth, seed, trees, rocks, crystals, flat?, bare?, ruins? } ],
  platforms: [ { x, z, baseY, R, amp, speed, phase, orbit? } ],
  build?(world, scene)   // map-unique geometry: Godspire tower, training baseplate grid…
  hazards?: { type-specific config; see per-map sections }
  spawns: { duel: [2], ffa: [4], solo: {pos} }
}
```

### World refactor (`src/world.js`)

- `World` keeps its public collision API unchanged (`islands`, `platforms`, `columns`,
  `groundHeightBelow`, `groundCandidates`, `islandHeightAt`, …) so player, enemies,
  waves, and abilities work on every map untouched.
- Constructor becomes `new World(scene, mapDef)`. Every mesh/light the world creates
  goes under a single `this.root` THREE.Group → `world.dispose()` removes the root and
  disposes geometries/materials/textures. Lighting, sky shader, fog, clouds, motes all
  read from `mapDef.env` (current hardcoded values move into the Classic def).
- `SUN_DIR` becomes per-instance `world.sunDir` (only world.js uses the export today,
  so this is a rename, not a breaking change).
- `game.loadMap(mapId)`: dispose current world → build new → re-point
  `game.world`, `game.player.world`, `game.projectiles.world`. Menus keep orbiting
  whatever world is loaded (menu backdrop = Classic on boot).

### Moving platforms (needed by Godspire + Voidgarden)

Platforms gain optional `orbit: { cx, cz, r, angSpeed, phase }` → their x/z become
functions of time (`platformPosAt(p, time)`), alongside the existing vertical bob.
Ground collision already passes `time` everywhere, so height queries slot in.
New: horizontal carry — a grounded player (and enemies) standing on an orbiting
platform inherits its frame-to-frame XZ delta, so the ground doesn't slide out from
under you.

### Hazards

- `world.update(dt, time)` gains a third arg: the game (for player, enemies, effects,
  audio, hud). Hazard logic lives in small per-map hazard classes inside `maps.js`
  (or `src/hazards.js` if it grows), driven by a dedicated `world.hazardClock` that
  resets at round/run start.
- **Determinism for multiplayer:** hazard schedules and target picks derive from
  `hazardClock` + a seeded RNG (`mulberry32(seed)`). The host rolls `{ map, seed }`
  and includes them in the existing `'start'` message (duel + FFA). All clients see
  identical geysers/lightning. Hazard damage is applied locally to yourself
  (matches the existing self-authoritative damage model). Solo rolls its own seed.

### Netcode changes (`duel.js`, `ffa.js`)

- `'start'` message gains `map` + `hazardSeed`; the receiver calls
  `game.loadMap(map)` before spawn placement. Duel rolls once at match start and
  reuses for rounds 2–3; FFA rolls per round.
- Per-map spawn tables replace the hardcoded `SPAWNS` constants (map def supplies
  `spawns.duel` / `spawns.ffa`).
- `player.respawn()` takes its default position from the map's `spawns.solo`.

## 2. The four new maps

All must keep the game's stylized painterly look (vertex-colored flat shading,
procedural canvas textures, instancing/merged geometry — same perf budget as Classic).

### Tempest Crown — storm ring

- Layout: 6–7 dark islands in a wide ring around an open storm eye; a couple of
  low central platforms for risky center play.
- Mood: slate-blue/violet palette, dark churning clouds, occasional sky-wide
  lightning flicker (brief directional-light intensity pops), rain-slick sheen
  (slightly lower roughness), teal crystals.
- **Wind rivers** (signature): 3–4 visible curved wind corridors between islands,
  defined as polyline tubes (radius ~3.5). Inside one, the player gets strong
  acceleration along the tube direction (past normal speed caps) — dashing in feels
  like a slingshot. Visual: instanced streak particles flowing along the tube +
  faint additive ribbon. Enemies/projectiles unaffected (player-mobility tool).
- **Lightning strikes**: every 14–22 s (seeded), pick a random island; a glowing
  ring + crackle telegraphs for 2 s, then a bolt strikes: 45 damage + big knockup
  to anything in radius ~6, white flash, thunder audio. Works on enemies too.

### Ember Reach — volcanic caldera

- Layout: 5–6 obsidian islands at varied heights over a glowing caldera floor
  (a huge emissive lava disc far below, replacing the void); drifting ash-grey
  clouds; magma-vein emissive cracks on island rock; ember motes rising.
- Mood: charcoal rock, magma orange fog/horizon, deep red zenith.
- **Fire geysers** (signature): 5 vents on fixed spots. Cycle (seeded phase):
  idle → 1.5 s warn (steam jet, rumble, glow) → 2 s eruption column (radius 2,
  height ~18). Eruption start launches anything in the column upward
  (`vel.y ≈ +32` — a free super-jump); remaining in the column burns 10 dps
  (players and enemies). Column rendered as additive fire column + sparks.

### The Godspire — vertical tower

- Layout: one colossal ruined marble tower (radius ~14, height ~70) rising from a
  small base island; spiral of walkable ledges winding up the outside; 3 broken
  bridge arms to satellite mini-islands; rubble chunks slowly orbiting the spire
  (orbit platforms — usable as moving stepping stones); crown platform with a
  glowing beacon at the top.
- Built via the map's `build()` hook: tower body from stacked cylinder segments
  (collision: `columns` entries), ledges/bridges/crown as static platform discs.
- Mood: bright noon sky, golden marble + ivy green, thin sunny fog. No scripted
  hazard — verticality and ring-outs are the gimmick.
- Spawns place duelists on opposite mid-height ledges; FFA spawns at four heights.

### Voidgarden — orbiting night garden

- Layout: central garden island + 5 orbiting platform-islands circling it at
  different radii/speeds/heights (slow — full lap ≈ 40–60 s), plus a few static
  outer islands. The battlefield genuinely rearranges over a match.
- Mood: deep-indigo night sky with dense stars + aurora band (sky shader gains an
  optional aurora term), cool moonlight sun, bioluminescent decorations: glowing
  flower sprites, cyan/magenta crystals, luminous grass tint, void mist below.
- No damage hazard — moving ground is the gimmick (and pairs with horizontal carry).

## 3. Training Grounds map

- A clean flat floating baseplate: one large `flat: true` island (R ≈ 26, zero dome,
  zero noise) with a light stone-tile grid look (canvas grid texture or per-face
  checker vertex colors), low walls at the rim quadrant markers, 2 raised platforms
  and 3 floating rings (visual markers) for jump/dash practice. Bright, soft,
  shadowless-feeling lighting; calm pale-blue sky. No hazards, no waves.
- `TrainingDummy` moves out of `tutorial.js` into `src/dummy.js` (unchanged
  behavior) so tutorials, and potentially future modes, share it.
- Dummy layout (spawned by the tutorial/practice mode, not baked into the map):
  a firing line of 3 close dummies, 2 far dummies for ranged/charge practice,
  1 dummy on a raised platform for aerial practice.
- Selectable like any map in solo… but with waves? No: picking Training Grounds
  from the solo map row starts **free practice** (dummies, no waves, no death) —
  it reuses the tutorial mode's plumbing without objectives.

## 4. Guided tutorials (`src/tutorials.js` + rework of `tutorial.js`)

- **Entry**: the menu's Tutorial button opens a picker: BASICS + one card per class
  (6 classes). Picking one loads Training Grounds, sets that class, and starts its
  script. ESC / EXIT returns to the picker/menu as today.
- **Engine**: a tutorial is an ordered list of steps
  `{ text, count?, check(event) }`. Steps complete via a tiny event stream tapped
  from existing hooks (wrapped, not replaced):
  - `player.onJump(isDouble)`, `player.onDash`, `player.onLand`
  - `game.onPlayerCast(slot, power)` — already exists for multiplayer; carries
    ability slot + charge power (perfect for "fully charge X": power ≥ 0.99)
  - dummy damage (via `takeDamage` opts: source ability tag where available,
    else any-hit)
  - misc polls (e.g. "stand on the raised platform") checked per frame.
- **UI**: objective card (evolves the current tutorial card): current step text +
  live counter ("Dash in mid-air — 2/3"), completed steps collapse into a ✓ line,
  step completion = gold flash + chime, finishing = "TUTORIAL COMPLETE" banner +
  burst. Steps never time out; free practice continues after the script ends.
- **Content** (5–7 steps each; final scripts tuned during implementation):
  - **Basics**: move → jump → double jump → air dash ×3 → attack a dummy →
    hold-charge an ability → break 100 HP on one dummy (combo).
  - **Per class**: one step per signature mechanic, e.g. Mage (charged Firebolt,
    ability rotation), Brawler (Haymaker knockback, Hundred Fists root),
    Reaver (Thunderclap 2-dummy stun, Cyclone launch, Slipstream drag),
    Sorcerer (each orb color's verb), Assassin (poison stack, Shadowstep
    dash-slice-return, full-charge Eviscerate), Gambler (spin, act on a good
    pair, survive a bad pair, land a jackpot payoff).
- The old timer-based `STEPS` flow is deleted.

## 5. Multiplayer out-of-combat regen

- `player.takeDamage` stamps `player.lastDamagedAt = game.simTime` (any source,
  including hazards).
- In `duel.update` / `ffa.update`, while the local player is alive and
  `simTime - lastDamagedAt ≥ 10`: `player.heal(1 * dt)` (1 HP/s, capped at max).
  Opponents see it through the normal HP replication.
- Solo and tutorial modes: no change (tutorial already has its own fast heal).

## 6. Asteroid map — Shattered Belt (built LAST, after everything else ships)

User confirmed in scope, ordered last. Low gravity everywhere (≈45% normal);
"graviton rocks" — special glowing asteroids that bend your personal gravity
toward them within a radius (walk on asteroid surfaces, slingshot fights),
smoothly reverting to normal down-gravity when you leave. Requires vector
gravity in the player controller (gravity direction blends toward the nearest
graviton rock's center), camera up-vector blending, and grounded checks against
the rock surface. Enemies and projectiles keep normal gravity (player-only
mechanic). Deep-space dusk palette, drifting rock field, faint nebula. Detailed
physics design happens when its build phase starts, informed by playtests of the
first four maps.

## Testing

- Headless `step()` checks: every map builds without errors and disposes cleanly
  (load each map twice in sequence); spawn points have ground beneath them;
  geyser/lightning schedules are identical for two sims given the same seed;
  regen: damage → wait 10 s sim time → HP climbs at 1/s.
- Tutorial engine: unit-test step checks by feeding synthetic events.
- Duel harness (`test/duel-harness.html` + local PeerJS broker): both clients load
  the same rolled map/seed; FFA harness likewise.
- Manual playtest pass per map (user) — hazard timing/feel tuning expected.

## Build order

1. World refactor: map registry, `dispose()`/`loadMap`, env-driven sky/lighting,
   Classic parity (visually identical to today).
2. Moving-platform orbits + horizontal carry.
3. Training Grounds map + dummy module extraction + free-practice entry.
4. Tutorial engine + Basics + 6 class tutorials.
5. The four maps, one at a time (Godspire and Voidgarden after step 2).
6. Menus (solo map row, tutorial picker) + multiplayer random map sync.
7. Regen + full test pass.
8. Shattered Belt (asteroid map): vector gravity + graviton rocks — last.
