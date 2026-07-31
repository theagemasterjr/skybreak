# Bot Duel + Overtime — Design Spec

Date: 2026-07-31
Status: Approved by user (design presented and green-lit in session)

Two features for SKYBREAK:

1. **Duel a Bot** — a singleplayer 1v1 against an AI duelist with real movement, aim, and full class kits.
2. **Overtime** — a 2:00 per-round timer in duel and FFA; when it expires, a per-map escalating event forces the fight to end.

---

## Part 1 — Duel a Bot

### User decisions

- **Difficulty tiers:** three, named **Rookie / Duelist / Nightmare**, picked from the menu.
- **Kit:** the bot plays any class with the full kit (basic, Q/E/R/F abilities, charging, ults). Gambler included.
- **Class pick:** bot's class defaults to **Random**; the user can lock a specific class on the select screen.
- **Presentation:** real-duel illusion — identical flow to an online duel (class select, map roll, countdown, best-of-3, round banners, score). Bot gets a duelist-style callsign (e.g. VEX-2, NULLBLADE, KIRA-9) with a small ✦AI marker on the nameplate.
- **Personality:** light — idle hops/strafes during countdown, a small spin after winning a round, a beat of hesitation after big trades. No chat/taunt text.

### Architecture (chosen approach)

Reuse the existing rival body and combat plumbing; add a local brain. No fake second Player.

- `DuelOpponent` (src/duelOpponent.js) already implements the full enemy interface (position/vel/takeDamage/update/anim rig) and is pushed into `game.enemies`, so all player abilities/projectiles hit it unchanged.
- The `owner` contract DuelOpponent needs is just `canDealDamage()` + `sendHitFor(...)` — a new local **`BotDuel`** controller (src/botDuel.js) implements it in place of `Duel`.
- `BotDuel` mirrors `Duel`'s round machine (countdown → fighting → roundover → matchover, `ROUNDS_TO_WIN = 2`, spawn tables, `hud.setDuelInfo`), but with no networking: it constructs a `DuelOpponent` avatar and a **`BotBrain`** that writes `avatar.position/vel/yaw/net.*` each frame instead of applying net snapshots.
- Bot attacks deal damage via the same shooter-authoritative path (`canDealDamage()` + direct `player.takeDamage`-equivalent through `sendHitFor`) and spawn projectiles with `owner:'enemy'`.
- Movement/aim helpers adapted from src/enemies.js (`moveToward`, `faceToward`, `canSeePlayer`) plus player-style verbs: double jump, 3-charge dash, air stall, glide, wind riding.
- Menu hook: SINGLEPLAYER opens a submenu — **WAVE RUN** (current behavior) / **DUEL A BOT** (difficulty pick → class select with bot slot) — in src/menus.js. `game.mode` stays `'duel'`-like for HUD purposes; a flag distinguishes bot duels.

### BotBrain design

Perception → intention → actuation, ticked every frame with per-difficulty reaction latency.

**Perception:** player position/velocity/HP, line of sight, incoming projectiles aimed at the bot, player charge-up state, own HP, nearest safe ground, active overtime hazards (storm radius, meteor warning zones, Maw pull, lava height, crumbling ledges).

**Intentions (state machine):**
- **Engage** — default; orbit-strafe the player at the class's preferred range, mostly airborne (island/platform hopping, air stall between bursts), poke with basic + poke-tagged abilities.
- **Burst** — commit with combo (gap-closer + burst abilities + charged shots) when the player is vulnerable (recovering, rooted, mid-charge, low dashes).
- **Evade** — dash/jump sidesteps in response to player charged shots and incoming projectiles; Nightmare occasionally dodges predictively (before the shot fires).
- **Reposition** — grab height or a better platform when current spot is exposed, off-map, or hazard-threatened.
- **Finish** — sustained aggression when the player is low.

**Aim model:** target tracking with reaction delay + smoothed angular error; projectile lead at higher difficulties. Never pixel-perfect.

**Ability playbook:** each class's 4 abilities + basic tagged as poke / burst / gap-close / escape / ult with use-conditions (range windows, cooldown awareness, HP thresholds, save-ult-for-opening). Chargeable casts charge when safe.

**Difficulty scaling (Rookie → Duelist → Nightmare):** reaction time (≈0.45s → 0.28s → 0.15s), aim error (large → moderate → small), dodge probability (low → medium → high + predictive), ability/charge decision quality, target-lead quality.

**Survival:** steers back to islands when knocked out, avoids the void, respects overtime events (flees storm, avoids meteor warning circles and lava, fights Maw pull, relocates off crumbling ledges).

---

## Part 2 — Overtime

### User decisions

- **Scope:** duel **and** FFA, **all maps except training**. Applies to bot duels too.
- **Timer:** 2:00 per round, visible on the HUD near the score; pulses red in the final 10 seconds. Fresh 2:00 (and fresh map) each round of a best-of-3 / each FFA round.
- **At zero:** "OVERTIME" banner flash + screen flash + rumble + audio sting, then the map's event begins.
- **Endgame:** events **escalate until someone dies** — no draws, no out-waiting.

### Architecture (chosen approach)

- New optional map hook **`makeOvertime(world, game)`** returning `{ update(dt) }`, built alongside `makeHazards` in `world.resetHazards`, ticked next to `hazards.update(dt)` in `World.update`.
- Timer derives from **`world.hazardClock`** (unscaled, seed-synced, reset per round via `resetHazards(seed + n)`), so both online peers hit overtime on the same frame with **zero new network traffic**. All event randomness uses the seeded `world.hazardRng` for determinism (matching the existing tempest/voidgarden hazard pattern and the world-test determinism check).
- HUD: `hud.announce('OVERTIME')` + `hud.flash(...)`; countdown rendered in the existing duel info area (`#wave-remaining` real estate). FFA gets the same countdown.
- Island destruction: removing collision = splice from `world.islands`; visuals need a mesh reference stored on each island record (small addition to `_buildIslands`) so islands can sink/launch/vanish. Platforms are already fully dynamic (orbit/baseY re-read every frame).

### The six events

- **Classic — Skyfall.** Every 5s a meteor streaks in (brief targeting glow) and smashes a side island, which breaks loose and sinks into the void — gone for the round. When only the main island remains, meteors target it: red warning circles on the ground, then impact blasts (damage + knockback craters), with accelerating frequency. Escalation: fall rate keeps increasing.
- **Tempest — The Storm.** A visible storm wall closes toward the eye over ~60s (Fortnite-style shrinking circle). Inside the wall: repeated lightning strikes (damage + fling) and violent gusts that toss players. Escalation: the circle keeps tightening past the eye and strike rate rises until only a sliver of calm remains.
- **Ember — The Eruption.** The volcano erupts: lava bombs arc down leaving burning ground patches; a molten sea rises from below, swallowing the lowest islands one by one and forcing the fight upward. Escalation: sea keeps rising, bomb rate increases.
- **Godspire — The Collapse.** The spire crumbles top-down: chunks shear off and orbiting ledges shatter one by one every few seconds with rumbles; the viable zone sinks with the destruction. When only the base remains, the black hole rages — stronger pull and launches — to force the finish.
- **Void Garden — The Maw Awakens.** The Maw swells (growing pull radius), devours the orbiting platforms one by one (spiral-in + crunch), then drifts toward the garden, gnawing island edges while dragging players in. Escalation: unbounded growth.
- **Belt — Canopy's Call.** Plates rumble/glow and launch upward **two at a time**, vanishing into the Canopy with a boom; the Canopy shakes harder with each dock; remaining islands crumble and launch too. When the last plates go, **gravity flips for all players** — everyone falls *up* and lands on the Canopy's colossal **underside**, fighting upside-down with the open sky as the new death-void (void checks invert). Escalation: the underside sheds cracked sections, shrinking the fightable ceiling.
- **Training:** no overtime, ever.

### Sync + determinism rules

- Event visuals/physics driven by `hazardClock` + `hazardRng` only — no wall-clock, no `Math.random`.
- Damage from events applies locally to the local player (same model as existing hazards / the Maw); each peer takes its own event damage and reports its own death through the existing duel/FFA death flow. No new message types required.
- Bot duels: the same event code runs; BotBrain reads event state for avoidance, and event damage to the bot applies through its takeDamage.

---

## Testing

- Headless Node tests (pattern of test/world-test.mjs): for each map, build world, fast-forward past 2:00 via the deterministic stepper, assert the overtime object activates, islands/platforms are removed as scheduled, and two same-seed runs produce identical event logs (determinism).
- Belt-specific: assert gravity flip state engages and void plane inverts.
- Bot: headless bot-vs-static sanity (brain ticks, stays on map, lands hits over time) and a scripted round that runs to matchover without errors.
- Manual browser pass on singleplayer bot duel for feel/difficulty.
