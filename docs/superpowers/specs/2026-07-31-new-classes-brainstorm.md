# New class brainstorm — quirk-first kits (2026-07-31)

Brainstorm for future SKYBREAK classes. Ground rules carried over from the existing
six: every ability is hold-to-charge (tap = quick version, hold = hang in the air and
unleash more), kits are `m1 + Q/E/R/F`, and each class is built around ONE loud quirk
the way Mage has the Rift Anchor, Sorcerer has Red/Blue/Purple, and Gambler has the
slot machine. The arena itself — floating islands, dashes, void ring-outs — is the
shared toybox, so the best quirks bend movement, footing, or the void.

Six fleshed-out kits first (roughly in recommended build order), then a sparks pile.

---

## 1. Skyhook Corsair — the grappler

- **Role:** Momentum duelist / void executioner
- **Tagline:** *The sky is my rigging. The void is my blade.*
- **Quirk:** **Chains and momentum.** Every ability is a rope: pull yourself, pull
  them, or bind you together. The Corsair barely deals raw damage — it wins by
  putting people where they don't want to be, and in SKYBREAK "where they don't
  want to be" is usually the void. First class whose kill condition is the map.
- **Stats sketch:** 95 HP, walkSpeed 12, 3 dashes — mobility comes from hooks, not feet.

| Slot | Move | Tap | Charged |
|---|---|---|---|
| m1 | **Chain Cutlass** | Whip-crack slash with more reach than any melee (≈6m line), small pull-in on hit so victims stay in your web. Air-stalls. | — |
| Q | **Grapple Line** | Fire a hook at terrain and slingshot yourself along the rope, keeping all momentum (dash-economy friendly — a free dash that needs aim). Hook an enemy instead: light targets get reeled *to you*, heavies (golems, colossi) reel *you to them*. | Longer rope, faster reel, and you arrive with a bonus cutlass swing. |
| E | **Harpoon** | Skewer projectile that embeds in the first victim. Recast within 3s to **yank** — they get hauled toward you and past you, in whatever direction your crosshair points. Aim at the island edge and the yank *is* the kill. | Harder yank, and the harpoon pierces to embed in up to 3 targets — one recast hauls the whole catch. |
| R | **Anchor Drop** | Chain a heavy anchor to a target: doubled gravity, no double-jump, dashes halved for 4s. Over solid ground it's a slow; over a gap it's a death sentence. | The anchor's chain lashes out and links up to 2 nearby enemies to the same anchor — linked victims share the weight *and* share 30% of damage dealt to any of them. |
| F | **Keelhaul** | Lash yourself to the nearest enemy in your aim and orbit-swing around them at speed, blade out — everyone your arc passes through gets sliced. Release (or timer) hurls you and the anchor-point in opposite directions. | Wider, faster orbit, more revolutions, and the final release throws them with ring-out force. |

PvP note: yank/anchor numbers need a duel-mode tuning pass (same pattern as
Gambler's jackpot durations) — void setups should demand real aim, not be free.

---

## 2. Terrarch — the terraformer

- **Role:** Zone controller / battlefield editor
- **Tagline:** *This island is mine. So is the one you're standing on.*
- **Quirk:** **The ground itself is the kit.** Nobody else can make footing or take
  it away. On maps that are 90% void, creating a bridge — or deleting the floor
  under a fight — warps every other class's plan. Also the first quirk that's
  *cooperatively readable*: your platforms are walkable by everyone, so using them
  well is its own skill.
- **Stats sketch:** 110 HP, walkSpeed 11, 3 dashes — a slow class that never has to
  leave home, because home moves.

| Slot | Move | Tap | Charged |
|---|---|---|---|
| m1 | **Shardspike** | Lobbed stone chunk with a slight arc and satisfying thunk-knockback. Slow-falls you in the air. | — |
| Q | **Pillar** | Raise a stone column from the aimed ground. Under yourself: a launch pad that pops you skyward. Under an enemy: an uppercut from the earth — damage plus a juggle launch. Pillar persists ~6s as cover/high ground. | Taller pillar, harder launch, and it erupts in a shrapnel ring as it rises. |
| E | **Skybridge** | Extrude a ribbon of floating stone from your feet along your aim — a walkable bridge/ramp (~14m) that anyone can use. Expires in ~8s, crumbling from the far end (visible warning). | Longer, wider, lasts longer. The escape tool, the flank route, and the "chase me if you dare" bait, all in one. |
| R | **Fault Line** | Crack a disc of ground at the aimed point (marker telegraphs, ~0.8s). Then for 1.5s that footing turns **intangible** — anyone standing inside falls straight through the island. Turns the safest ground on the map into a trapdoor. | Wider disc, longer intangibility, and victims falling through take a rock-grind DoT on the way down. |
| F | **Bulwark** | Curl a curved stone wall out of the ground in front of you: blocks projectiles and line abilities, breakable (~60 HP). | The wall then detonates outward on recast or expiry — a claymore of shrapnel toward wherever it faces. |

Design note: Fault Line's "solid ground stops being solid" needs a loud, unmistakable
telegraph (cracks + glow + sound), same readability bar as Meteor Call's marker.

---

## 3. Chronoweaver — the rewinder

- **Role:** Tempo mage / un-diver
- **Tagline:** *You already lost this fight. Three seconds ago.*
- **Quirk:** **A ghost of your past self.** The Chronoweaver's HUD shows a faint
  phantom trailing 3 seconds behind — everywhere you were, it will be. Rewind snaps
  you back to it, position AND health. The whole class is about *placing your past
  self well*: bait a full combo, eat it, then un-eat it. Mage's Rift Anchor asks
  "where do I want to return to?"; the Chronoweaver asks it continuously and
  answers it retroactively.
- **Stats sketch:** 75 HP, walkSpeed 12, 3 dashes — fragile on paper, but its HP bar
  lies.

| Slot | Move | Tap | Charged |
|---|---|---|---|
| m1 | **Tick Bolt** | Fast bolt that applies **Tock**: 2 seconds after each hit, the same damage echoes again at 50%. DPS that arrives from the past. Slow-falls in air. | — |
| Q | **Rewind** | Snap back to your 3-seconds-ago ghost — position, velocity, and any health lost in that window restored. Leaves a shimmer at both ends. Doesn't cleanse debuffs (poison remembers). | Reach further back, up to 5 seconds, for the full "that never happened." |
| E | **Stutter Field** | Project a bubble where enemies and *enemy projectiles* move at 40% speed. You and your shots are immune. Walk into a bullet hell and part it like a curtain. | Bigger bubble, longer, and enemies inside also swing/cast slower. |
| R | **Split Echo** | Spawn an afterimage frozen at your current spot for 3s that **replays every attack you make** at its own position and facing at 50% damage — double artillery angles, crossfire from one player. | Echo replays at full damage and mirrors abilities, not just m1. |
| F | **Deadline** | Brand every enemy you can see: for 3s all damage they take is *also* recorded, then the total detonates at once at the deadline (25% bonus) with a freeze pop. Burst windows become bombs. | Longer recording window and a higher detonation bonus — for the true all-in. |

Implementation note: the game already simulates deterministically (`SKYBREAK.step()`),
so a 5-second ring buffer of player position/HP is cheap, and the trailing ghost doubles
as the class's signature visual.

---

## 4. Cantor — the rhythm fighter

- **Role:** Tempo skirmisher / skill-ceiling bait
- **Tagline:** *The sky keeps time. Try to keep up.*
- **Quirk:** **Everything lands harder on the beat.** A metronome pulses on the HUD
  (and faintly in the world — the Cantor's aura throbs, so rivals can read it too).
  Any attack or ability that lands **on-beat** is empowered: bigger, louder, extra
  effect. This is a *skill* quirk, orthogonal to hold-to-charge — charging is about
  patience, the beat is about timing, and the Cantor plays both at once. High
  ceiling, gorgeous to watch, and the audio design writes itself.
- **Stats sketch:** 85 HP, walkSpeed 12.5, 3 dashes. Beat ≈ 100 BPM (0.6s), on-beat
  window ≈ ±90ms.

| Slot | Move | Tap / off-beat | On-beat |
|---|---|---|---|
| m1 | **Staccato** | Quick sonic jab-note projectile, modest damage. | Crits (+60%), and adds a stack of **Resonance** to the victim (max 5, decays). |
| Q | **Sforzando** | Directional sound-lance, small knockback. Charged: wider cone. | Detonates all Resonance stacks on victims for bonus burst — the class's payoff button. |
| E | **Glissando** | A gliding slide-dash along your aim (a fifth pseudo-dash). Charged: longer. | Free — no cooldown consumed. An on-beat Cantor simply *does not stop moving*. |
| R | **Crescendo** | Growing aura: each consecutive on-beat action swells it (+move speed, + m1 damage, wider on-beat window). Any off-beat action drops it a stage. | The combo meter as an ability — greed vs. safety every 0.6 seconds. |
| F | **Encore** | Replay your last ability instantly, free, at its charged value. | If the Encore itself lands on-beat: replay it *twice*. The highlight-reel button. |

Tuning note: the on-beat window should widen slightly under Crescendo and in
singleplayer; duel mode keeps it tight. Netcode already replicates effects, and the
beat can derive from `simTime` so both clients agree on it exactly.

---

## 5. Blood Reaper — the hemomancer

- **Role:** Attrition bruiser / all-in gambler (the *other* kind of gambling)
- **Tagline:** *Health is just ammunition you were born with.*
- **Quirk:** **HP is the resource.** Several abilities cost health instead of only
  cooldown, everything lifesteals, and the kit gets *stronger* the lower you are.
  Every fight is a bet that you can drink faster than you bleed. Pairs deliciously
  with the 10s out-of-combat regen rule in multiplayer — a Reaper at 20% HP is not
  retreating, it's reloading.
- **Stats sketch:** 130 HP (biggest pool in the game — it's a fuel tank), walkSpeed
  11.5, 3 dashes. Health costs can't take you below 1 HP.

| Slot | Move | Tap | Charged |
|---|---|---|---|
| m1 | **Reaping Sweep** | Wide scythe arc, heals 20% of damage dealt. Air-stalls. | — |
| Q | **Blood Lance** *(costs 8 HP)* | Hurl a lance of your own blood — pierces everyone in a line, and each victim pierced heals 6. Hit two and you profit; whiff and you paid for nothing. | Costs 14 HP, bigger lance, heals more per victim — the greedy line-up reward. |
| E | **Transfusion Pact** | Curse a target for 6s: 35% of ALL damage they take (from anyone — you, allies in FFA chaos, other enemies) flows to you as healing. | Pact spreads to enemies near the target on cast. Turns a crowd into a buffet. |
| R | **Crimson Rite** | The charge mechanic IS the cost: holding R visibly **drains your own HP** (up to 30% of max) into the rite. Release to gain +damage, +lifesteal, and crimson m1 projectiles for a duration scaled to what you paid. | — (the hold is the charge) |
| F | **Exsanguinate** | AoE burst around you that scales with your **missing** health — at full HP a shove, below 30% a detonation. Executes: victims under 15% HP are claimed outright, refunding a dash and a chunk of HP. | Wider radius and a fear-flinch (brief scatter) on survivors. |

PvP note: in duels, self-damage from costs should count as "hit" for the regen timer
(no free tanking), and the execute threshold drops to 10%.

---

## 6. Mirror Fencer — the parrying duelist

- **Role:** Counter-puncher / projectile nightmare
- **Tagline:** *Everything you throw at me was always mine.*
- **Quirk:** **Stored violence.** The Fencer wants to be attacked: a crisp parry
  window negates hits, reflects projectiles back along your crosshair at triple
  speed, and — the real quirk — **banks a portion of everything parried into a
  battery** that only Riposte Brand can spend. In a game where four of six classes
  spray projectiles, a class that turns incoming fire into a payload flips every
  matchup's geometry. Weak into patient melee, terrifying into artillery — a true
  meta-bending pick.
- **Stats sketch:** 90 HP, walkSpeed 12.5, 3 dashes, and the narrowest hitbox in the
  game (a fencer's profile).

| Slot | Move | Tap | Charged |
|---|---|---|---|
| m1 | **Rapier Flurry** | Narrow but very fast thrusts — a fencing line, not a cleave. +50% damage to **Off-Guard** victims (anyone recently parried or lunged through). Air-stalls. | — |
| Q | **Parry** | A 0.35s stance: melee hits are negated and the attacker staggered Off-Guard; projectiles are caught and **reflected** at your crosshair at 3× speed with your damage bonus. Every parry banks 40% of negated damage into the **battery** (visible gauge, caps at ~80). Whiffing the stance leaves you wide open — this is a timing bet, not a shield. | Hold to keep the stance up to 1s, but banking rate decays — reads over reflexes. |
| E | **Lunge** | Fencing dash-thrust through the target line; victims passed through are Off-Guard. Cooldown fully refunds on a kill *or* a successful parry — the Fencer's engine loop. | Longer lunge, and it pierces cleanly through Bulwark-class walls and shields. |
| R | **Blade Waltz** | Mark up to 3 enemies near your crosshair, then blink-slash through each in sequence (brief invuln between cuts), ending behind the last one. | Marks 5 and each cut applies Off-Guard — the setup for a battery-fueled finish. |
| F | **Riposte Brand** | Spend the entire battery in one thrust: base damage + 100% of banked damage, huge single-target knockback. At full battery it is the hardest single hit in the game — and you *earned every point of it by standing in the fire.* | Converts the thrust into a short beam — spend the battery on a line instead of a point. |

Matchup note: the Sorcerer's Purple and Mage's Meteor should be parry-*mitigated*,
not fully banked (cap per-instance banking), or the Fencer trivializes ult trades.

---

## Sparks pile (quirks worth a future pass)

- **Tempest Falconer** — pet quirk: a hawk that dives where you mark, fetches
  faraway victims back to you, and can be ridden briefly for a free flight line.
- **Pyroclast** — heat quirk: **no cooldowns at all**; every cast builds heat, and
  overheating self-stuns in a big vent explosion. Spam management as a resource.
- **Colossus Shifter** — stance quirk: swap between a tiny, fast, fragile form and a
  giant, slow, quaking form; each form charges the other's super meter.
- **Sky Calligrapher** — trail quirk: flight that draws persistent glowing ink walls
  in the air (Tron-style); closing a loop detonates everything inside the shape.
- **Warden of Nothing** — void quirk: the only class that can *enter* the void and
  come back — dive off the island on purpose, swim beneath the map, and erupt up
  through any island's floor. The kill zone becomes a flank route.
- **Puppeteer** — control quirk: attach strings to an enemy and briefly *drive their
  movement* (never their attacks) — walk a rusher off a cliff, drag a caster into
  their own bomber.
- **Living Bomb** — martyr quirk: constantly accruing an internal charge that only
  discharges by exploding — either as a devastating self-centered blast on demand
  (heavy self-knockback, no self-damage) or automatically when killed. Dying is a
  move.

## Recommended first build

**Skyhook Corsair.** It's the most SKYBREAK-shaped quirk (momentum + void ring-outs
are already the game's identity), it reuses existing systems (projectiles for hooks,
knockback opts for yanks, the Blue-orb pull code for reels), and it's spectacular in
duels. **Terrarch** second — platform/fault mechanics are a bigger engine lift
(walkable dynamic terrain) but change the game most. **Cantor** is the cheapest to
prototype (one HUD metronome + a damage multiplier) if a quick win is wanted.
