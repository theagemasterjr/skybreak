# Gambler class — design spec (approved 2026-07-30)

Sixth playable class for SKYBREAK. High-variance luck class: one ability that spins a
3-reel slot machine; outcomes range from self-debuffs to overpowered jackpots.

## Kit

- **Weapon/model**: holds a large die. Ranged class.
- **m1**: thrown dice projectiles, mage-style ranged attack (slow-fall in air).
- **Q — Spin** (~4s cooldown): pulls the lever on the slot machine. E/R/F: empty.
- **Slot machine UI**: 3 reels in a corner of the HUD. Every spin animates the reels and
  always lands a meaningful result:
  - 60% — **good pair** (2 matching good icons): small positive effect
  - 20% — **bad pair** (2 matching bad icons): small debuff
  - 20% — **jackpot** (3 matching): powerful positive effect. Never negative — a bad
    icon triple FLIPS into an absurdly good effect.
- All effects fire **instantly** on landing (nothing arms your next attack).
- **PvP tuning**: jackpot durations/strength toned down in duel/FFA modes.
- Outcome category is picked by the odds above, then an icon is picked within the
  category — icon count never dilutes luck.

## Icons

### Good (pair / JACKPOT)

| Icon | Pair | Jackpot |
|---|---|---|
| 🍒 Cherry | Heal a chunk of HP | **FULL HOUSE** — full heal + golden overshield (temp HP) that shatters visibly |
| 🪙 Coin | Fan of 5 ricocheting coin projectiles | **MAKE IT RAIN** — coin storm cloud rains damage over a huge area for seconds |
| ⚡ Lightning | Mega-dash: instant launch ~3× normal dash distance, lightning-crack trail | **HOT STREAK** — big speed, infinite dashes, burning gold damage trail (~8s) |
| 👑 Crown | Dice m1s grow bigger + pierce briefly | **HIGH ROLLER** — grow giant, quaking footsteps, boulder-sized dice m1s |
| 🔔 Bell | Throw the bell; it hangs in the air pulsing like a pulsar — repeated AoE explosions for a few seconds | **JACKPOT BELL** — screen flashes JACKPOT; every enemy on screen stunned + damaging gold shower |
| 🔫 Gun | Revolver replaces m1 for a few seconds: faster, harder-hitting shots | **MINIGUN** — ~8s of full minigun m1, spam freely |

### Bad (pair debuff / flipped JACKPOT)

| Icon | Pair (debuff) | Flipped jackpot |
|---|---|---|
| 💀 Skull | Machine bites you: chunk of self-damage | **DEATH ITSELF** — Reaper form ~8s: shadow visual, homing skull m1s, enemies dying nearby burst into more skulls |
| 🐍 Snake | Heavier gravity + slower movement briefly | **KING COBRA** — giant golden serpent hunts enemies across the arena |
| 💣 Bomb | Lit bomb sticks to YOU, 2s fuse — outrun the blast | **THE NUKE** — you throw it: huge arc, mushroom cloud, biggest single hit in the class |
| 🪞 Mirror | Next spin guaranteed to be a debuff | **MIRROR FORTUNE** — cleanse all debuffs; for 10s any bad pair flips to its good version |

### Rare jackpot (never a pair; small slice of jackpot rolls)

| Icon | Jackpot |
|---|---|
| 🟣 Purple Orb | **CURSED JACKPOT** — ~10s: spam Sorcerer-style Purple Nukes with zero windup at very low cooldown, twice the size, slightly slower flight |

## Implementation notes

- Class added to `CLASSES`/`CLASS_LIST` in src/classes.js following existing patterns.
- Reuses: projectile system, effects/fxNet replication, `takeDamage` opts, existing
  Purple Nuke visuals from Sorcerer.
- Slot UI: HUD element with 3 reels; rolls animate on every Q press.
- Mirror's "guaranteed debuff" and Mirror Fortune's "flip bads" are modifiers on the
  next roll's category selection.
- Deterministic-friendly: roll logic testable headlessly via `SKYBREAK.step()`.
