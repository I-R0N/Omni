# Balance baseline — what the game does today

_Generated 2026-10-08T17:18:03.614Z by `node scripts/balance.mjs` — 1 seed(s) per cell, 900s sim cap, difficulty 3 (the shipped default and today's highest)._

This is the **measurement** the user asked for in D-S3-e before any target is set. It changes no number.

## How to read it

- **The bot is a yardstick, not a player.** It aims perfectly at the nearest hostile, kites at a fixed range, never dodges and never charges a shot. A human dodges better and aims worse; what carries over is the *difference between configurations*, not the absolute seconds.
- **Two loadouts.** `lean` is the free start (Base Hull + Projector). `mk3` is the debug "Outfit all": every Mk III module, a Shield, Mk V scanner, and a Projector+Thermal / Beam+Electric pair — the strongest thing a player can wear today.
- **Time is simulated seconds** at the fixed 120 Hz step; `mm:ss` where long.
- **1 salvage unit = 1,000 credits.** Module prices below are shown in units.

## 1. A portal run: how long, and how it ends

One arena ladder = waves 1–5 plus the boss wave (wave 6). "Run length" is sim time from arrival to the boss dying, the player dying, or the cap.

| Arena | Loadout | Rivals | Ended by (of N) | Run length (median) | Waves cleared (median) |
|---|---|---|---|---|---|
| POCKET | lean | on | death 1 (of 1) | 3:30 | 4 |
| POCKET | lean | off | death 1 (of 1) | 3:57 | 4 |
| POCKET | mk3 | on | death 1 (of 1) | 5:22 | 6 |
| POCKET | mk3 | off | death 1 (of 1) | 3:49 | 5 |
| UNIVERSE | lean | on | death 1 (of 1) | 3:27 | 3 |
| UNIVERSE | lean | off | timeout 1 (of 1) | 15:00 | 1 |
| UNIVERSE | mk3 | on | boss-dead 1 (of 1) | 4:32 | 6 |
| UNIVERSE | mk3 | off | boss-dead 1 (of 1) | 4:20 | 6 |
| RING | lean | on | death 1 (of 1) | 1:56 | 2 |
| RING | lean | off | death 1 (of 1) | 6:53 | 5 |
| RING | mk3 | on | death 1 (of 1) | 1:52 | 2 |
| RING | mk3 | off | boss-dead 1 (of 1) | 4:06 | 6 |
| SEVEN_RINGS | lean | on | death 1 (of 1) | 1:57 | 2 |
| SEVEN_RINGS | lean | off | death 1 (of 1) | 3:42 | 4 |
| SEVEN_RINGS | mk3 | on | death 1 (of 1) | 1:14 | 2 |
| SEVEN_RINGS | mk3 | off | death 1 (of 1) | 2:09 | 2 |

**Hub → rift** (bot flies the shortest wrapped line, knowing where the rift is): universe 25.6 s · ring 15.3 s · seven_rings 7.3 s · pocket 22.3 s. A player has to *find* the rift, so this is a floor.

## 2. Wave by wave (rivals on, as shipped)

Median across arenas and seeds. `window` is the spawn-stream window the design allows; `clear` is when the field was actually empty.

### lean

| Wave | window s | points (L3 target) | seen spawned | clear time s | salvage units | hull lost | rivals alive (max) |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 6 | 5 | 30.2 | 5.5 | 13 | 1 |
| 2 | 35 | 8 | 6 | 36.5 | 7.5 | 30 | 2 |
| 3 | 40 | 12 | 9 | 68.7 (2/4 cleared) | 9.5 | 89 | 4 |
| 4 | 45 | 16 | 4 | 46.1 (1/2 cleared) | 1.0 | 40 | 4 |
| 5 | 50 | 21 | 1 | — (0/1 cleared) | 9.0 | 19 | 4 |
| 6 | 55 | null | — | — | — | — | — |

### mk3

| Wave | window s | points (L3 target) | seen spawned | clear time s | salvage units | hull lost | rivals alive (max) |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 6 | 5 | 30.1 | 6.0 | 5 | 1 |
| 2 | 35 | 8 | 6 | 34.3 | 13.0 | 23 | 2 |
| 3 | 40 | 12 | 7 | 49.2 (2/4 cleared) | 5.0 | 25 | 3 |
| 4 | 45 | 16 | 5 | 45.2 | 9.0 | 1 | 5 |
| 5 | 50 | 21 | 11 | 57.4 | 17.0 | 27 | 6 |
| 6 | 55 | null | 5 | 31.9 | 56.0 | 201 | 6 |

## 3. How much of the pressure is the rivals

Same maps and seeds with and without rival warp-ins (`nextRivalScore = ∞`). Rivals warp in every 1,000 score; 34 % hostile, 30 % ally, 36 % neutral.

| Loadout | Rivals | rivals seen | first rival at (s) | hits taken: enemies / rivals | kills stolen | salvage units / cleared wave | hull lost | run length |
|---|---|---|---|---|---|---|---|---|
| lean | on | 4 | 39 | 11 / 1 | 3 | 5.0 | 149 | 2:42 |
| lean | off | 0 | — | 9 / 0 | 0 | 12.5 | 224 | 5:25 |
| mk3 | on | 5 | 38 | 2 / 0 | 2 | 9.5 | 236 | 3:12 |
| mk3 | off | 0 | — | 3 / 0 | 0 | 9.0 | 270 | 3:57 |

Across every rivals-on run: **39 rivals** warped in (10 hostile); the player took **6** rival hits against **48** from wave enemies, and rivals stole **29** kills (206.0 paid to the player).

## 4. Weapon vs enemy: seconds to kill one

One enemy pinned 250 units ahead, shooter stationary, firing on cooldown, perfect aim. `base` = the gun (+ its energy modifier) alone. `gunned` = the same with 3× Gunnery Mk III beside it. Beams are pulled, not held, so they read slightly pessimistic. **Wave-1 HP**; wave scaling is +6 %/wave (cap ×2.5).

### base

| weapon | RAMMER 1 | TURRET | RAMMER 2 | SWARM | RAMMER 3 | NEST | SHOOTER 1 | DRAGON | SHOOTER 2 | BOSS WARDEN | SHOOTER 3 | BOSS SCATTER | KAMIKAZE | BOSS SIEGE | BULWARK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| _HP_ | 1 | 9 | 2 | 1 | 6 | 16 | 1 | 570 | 2 | 137 | 3 | 120 | 2 | 171 | 5 |
| projectile | 0.2s · 2 | 0.8s · 5 | 0.2s · 2 | 0.2s · 2 | 1.4s · 8 | 1.1s · 7 | 0.2s · 2 | no kill | 0.2s · 2 | no kill | 0.4s · 3 | 21.4s · 101 | 0.2s · 2 | no kill | 3.8s · 21 |
| projectile+kinetic | 0.2s · 1 | 0.4s · 2 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.6s · 3 | 0.2s · 1 | 20.5s · 92 | 0.2s · 1 | 12.8s · 57 | 0.2s · 1 | 7.5s · 34 | 0.2s · 1 | no kill | 2.0s · 9 |
| projectile+electric | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.8s · 2 | 0.1s · 1 | 25.0s · 39 | 0.1s · 1 | 13.9s · 22 | 0.1s · 1 | 10.0s · 16 | 0.1s · 1 | 12.5s · 20 | 4.1s · 7 |
| projectile+thermal | 0.2s · 1 | 0.8s · 4 | 0.4s · 2 | 0.2s · 1 | 1.0s · 5 | 1.2s · 5 | 0.2s · 1 | no kill | 0.4s · 2 | 12.8s · 53 | 0.5s · 2 | 10.8s · 45 | 0.4s · 2 | no kill | 1.2s · 5 |
| beam | 0.1s · 1 | 0.7s · 2 | 0.1s · 1 | 0.1s · 1 | 0.6s · 2 | 1.5s · 4 | 0.1s · 1 | no kill | 0.1s · 1 | no kill | 0.2s · 1 | no kill | 0.1s · 1 | 17.6s · 40 | 0.6s · 2 |
| beam+kinetic | 0.2s · 1 | 1.3s · 2 | 0.2s · 1 | 0.2s · 1 | 1.2s · 2 | 3.2s · 4 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.3s · 1 | no kill | 0.2s · 1 | no kill | 1.2s · 2 |
| beam+electric | 0.1s · 1 | 0.2s · 1 | 0.1s · 1 | 0.1s · 1 | 0.2s · 1 | 0.4s · 1 | 0.1s · 1 | 18.1s · 23 | 0.1s · 1 | 5.3s · 7 | 0.1s · 1 | 18.2s · 23 | 0.1s · 1 | 6.1s · 8 | 0.1s · 1 |
| beam+thermal | 0.2s · 1 | 1.0s · 2 | 0.4s · 1 | 0.2s · 1 | 0.8s · 2 | 1.4s · 3 | 0.2s · 1 | no kill | 0.4s · 1 | 9.6s · 18 | 0.5s · 1 | 8.9s · 17 | 0.4s · 1 | 14.6s · 27 | 0.7s · 2 |
| spread | 0.2s · 1 | no kill | 0.8s · 2 | 0.2s · 1 | no kill | no kill | 0.2s · 1 | no kill | 0.8s · 2 | no kill | 1.5s · 3 | no kill | 0.8s · 2 | no kill | no kill |
| spread+kinetic | 0.2s · 1 | 1.6s · 3 | 0.2s · 1 | 0.2s · 1 | 4.9s · 8 | 1.6s · 3 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | no kill |
| spread+electric | no kill | no kill | 9.4s · 18 | 8.8s · 17 | no kill | no kill | 22.7s · 42 | no kill | no kill | no kill | no kill | no kill | 6.1s · 12 | 29.7s · 55 | 28.3s · 46 |
| spread+thermal | 25.4s · 161 | no kill | no kill | no kill | no kill | no kill | 26.0s · 164 | no kill | 26.4s · 168 | no kill | no kill | no kill | no kill | 18.6s · 118 | no kill |
| homing | 0.3s · 2 | 0.6s · 3 | 0.3s · 2 | 0.3s · 2 | 1.5s · 6 | 1.2s · 5 | 0.3s · 2 | no kill | 0.3s · 2 | no kill | 0.3s · 2 | 21.2s · 71 | 0.3s · 2 | no kill | 3.7s · 13 |
| homing+kinetic | 0.3s · 1 | 0.9s · 2 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 1.6s · 3 | 0.3s · 1 | no kill | 0.3s · 1 | no kill | 0.3s · 1 | 27.4s · 43 | 0.3s · 1 | no kill | 4.9s · 8 |
| homing+electric | 0.3s · 1 | 2.1s · 4 | 0.3s · 1 | 0.3s · 1 | 4.0s · 7 | 3.3s · 6 | 0.3s · 1 | no kill | 0.3s · 1 | 18.2s · 31 | 0.9s · 2 | no kill | 0.3s · 1 | 16.3s · 28 | 8.4s · 15 |
| homing+thermal | 0.3s · 1 | 1.5s · 3 | 0.4s · 1 | 0.3s · 1 | 2.0s · 4 | 2.4s · 5 | 0.3s · 1 | no kill | 0.4s · 1 | 17.4s · 30 | 0.9s · 2 | 15.7s · 27 | 0.4s · 1 | no kill | 2.2s · 4 |
| cannon | 0.2s · 1 | 4.6s · 4 | 0.2s · 1 | 0.2s · 1 | 8.7s · 7 | 4.8s · 4 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 1.6s · 2 | no kill | 0.2s · 1 | no kill | no kill |
| cannon+kinetic | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 3.8s · 3 |
| cannon+electric | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 |
| cannon+thermal | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 1.6s · 2 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | no kill |

### gunned (3× Gunnery Mk III)

| weapon | RAMMER 1 | TURRET | RAMMER 2 | SWARM | RAMMER 3 | NEST | SHOOTER 1 | DRAGON | SHOOTER 2 | BOSS WARDEN | SHOOTER 3 | BOSS SCATTER | KAMIKAZE | BOSS SIEGE | BULWARK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| _HP_ | 1 | 9 | 2 | 1 | 6 | 16 | 1 | 570 | 2 | 137 | 3 | 120 | 2 | 171 | 5 |
| projectile | 0.2s · 2 | 0.4s · 3 | 0.2s · 2 | 0.2s · 2 | 0.2s · 2 | 0.6s · 4 | 0.2s · 2 | no kill | 0.2s · 2 | 10.9s · 60 | 0.2s · 2 | 6.6s · 37 | 0.2s · 2 | no kill | 1.9s · 11 |
| projectile+kinetic | 0.2s · 1 | 0.1s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.4s · 2 | 0.2s · 1 | 9.6s · 43 | 0.2s · 1 | 3.6s · 17 | 0.2s · 1 | 3.2s · 15 | 0.2s · 1 | 9.5s · 43 | 1.1s · 5 |
| projectile+electric | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 9.4s · 15 | 0.1s · 1 | 7.4s · 12 | 0.1s · 1 | 4.9s · 8 | 0.1s · 1 | 7.0s · 11 | 2.1s · 4 |
| projectile+thermal | 0.2s · 1 | 0.5s · 2 | 0.2s · 1 | 0.2s · 1 | 0.7s · 3 | 0.7s · 3 | 0.2s · 1 | 18.2s · 76 | 0.2s · 1 | 8.5s · 36 | 0.2s · 1 | 7.7s · 32 | 0.2s · 1 | 11.7s · 49 | 1.0s · 5 |
| beam | 0.1s · 1 | 0.3s · 1 | 0.1s · 1 | 0.1s · 1 | 0.2s · 1 | 0.7s · 2 | 0.1s · 1 | no kill | 0.1s · 1 | 6.0s · 14 | 0.1s · 1 | 5.3s · 12 | 0.1s · 1 | 7.0s · 16 | 0.2s · 1 |
| beam+kinetic | 0.1s · 1 | 0.3s · 1 | 0.2s · 1 | 0.1s · 1 | 0.3s · 1 | 1.3s · 2 | 0.1s · 1 | no kill | 0.2s · 1 | 15.3s · 16 | 0.2s · 1 | 23.4s · 24 | 0.2s · 1 | 29.1s · 29 | 0.2s · 1 |
| beam+electric | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.2s · 1 | 0.1s · 1 | 9.2s · 12 | 0.1s · 1 | 2.6s · 4 | 0.1s · 1 | 2.0s · 3 | 0.1s · 1 | 3.3s · 5 | 0.1s · 1 |
| beam+thermal | 0.1s · 1 | 0.6s · 2 | 0.2s · 1 | 0.1s · 1 | 0.4s · 1 | 0.8s · 2 | 0.1s · 1 | 27.7s · 45 | 0.2s · 1 | 6.0s · 11 | 0.3s · 1 | 5.4s · 10 | 0.2s · 1 | 8.5s · 16 | 0.4s · 1 |
| spread | 0.2s · 1 | 2.1s · 4 | 0.2s · 1 | 0.2s · 1 | no kill | 1.4s · 3 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.8s · 2 | no kill | 0.2s · 1 | no kill | 5.3s · 9 |
| spread+kinetic | 0.2s · 1 | 0.9s · 2 | 0.2s · 1 | 0.2s · 1 | 1.6s · 3 | 0.9s · 2 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 2.3s · 4 |
| spread+electric | 19.3s · 36 | 22.8s · 42 | 9.4s · 18 | 8.8s · 17 | no kill | 15.4s · 29 | 25.3s · 44 | no kill | 19.8s · 37 | no kill | no kill | no kill | 6.1s · 12 | 12.8s · 24 | 13.2s · 25 |
| spread+thermal | 24.9s · 157 | no kill | 26.3s · 166 | no kill | no kill | no kill | 27.5s · 174 | no kill | 25.6s · 162 | no kill | no kill | no kill | no kill | 13.2s · 84 | 29.9s · 189 |
| homing | 0.3s · 2 | 0.3s · 2 | 0.3s · 2 | 0.3s · 2 | 0.3s · 2 | 0.6s · 3 | 0.3s · 2 | 22.1s · 72 | 0.3s · 2 | 6.7s · 23 | 0.3s · 2 | 5.5s · 19 | 0.3s · 2 | 19.6s · 66 | 1.8s · 7 |
| homing+kinetic | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 27.5s · 42 | 0.3s · 1 | 9.1s · 14 | 0.3s · 1 | 6.2s · 10 | 0.3s · 1 | no kill | 2.3s · 4 |
| homing+electric | 0.3s · 1 | 0.9s · 2 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 1.5s · 3 | 0.3s · 1 | 14.0s · 24 | 0.3s · 1 | 13.2s · 22 | 0.3s · 1 | 8.8s · 15 | 0.3s · 1 | 7.5s · 13 | 5.8s · 10 |
| homing+thermal | 0.3s · 1 | 0.9s · 2 | 0.3s · 1 | 0.3s · 1 | 1.4s · 3 | 1.5s · 3 | 0.3s · 1 | no kill | 0.3s · 1 | 13.7s · 23 | 0.3s · 1 | 10.2s · 18 | 0.3s · 1 | 22.2s · 38 | 1.8s · 4 |
| cannon | 0.2s · 1 | 1.6s · 2 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 3.1s · 3 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 6.2s · 5 |
| cannon+kinetic | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | 20.8s · 13 | 0.2s · 1 | 5.5s · 4 | 0.2s · 1 | no kill | 2.0s · 2 |
| cannon+electric | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | 25.4s · 19 | 0.2s · 1 | 6.1s · 5 | 0.2s · 1 | no kill | 0.2s · 1 |
| cannon+thermal | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 3.1s · 3 |

Cell = seconds · shots fired until dead. **Read the `spread+electric` and `spread+thermal` rows with suspicion**: a 1-HP target taking 40–180 shots means those pellets (which curl and weave, or need a chain/heat to land) mostly miss a *pinned stationary* target at 250 units — either a real weakness of those two guns or an artifact of the duel setup; this baseline does not decide which. `no kill` = still alive after 30 s.

## 5. Income against prices

- **lean**: median **5.0 units per cleared wave**, **44.0 units per run** (runs ended as above).
- **mk3**: median **9.5 units per cleared wave**, **72.5 units per run** (runs ended as above).
- Spec: 0.55 + 0.25 salvage rolls per enemy kill, +3 units per wave clear, +8 per snitch catch. Rivals vacuum drops within 150 units.

**The `mk3` loadout the bot wears costs 433 units** in the shops (every Mk III, Shield, Beam, Thermal, Electric, Overcharge; the Mk V scanner it also wears is a reward-only find and is not counted) — about 87 cleared waves, or 9.8 lean runs, of income. A death strips what was *installed* (cargo survives), so that figure is also what a bare death risks if nothing is in the hold.

| Module | Mk | Price (units) | Cleared waves of lean income (5.0 u/wave) |
|---|---|---|---|
| Hull Mk I | 1 | 4 | 0.8 |
| Hull Mk II | 2 | 8 | 1.6 |
| Hull Mk III | 3 | 24 | 4.8 |
| Shield | 1 | 30 | 6.0 |
| Light | 1 | 9 | 1.8 |
| Scanner Mk I | 1 | 7 | 1.4 |
| Scanner Mk II | 2 | 14 | 2.8 |
| Scanner Mk III | 3 | 42 | 8.4 |
| Scanner Mk IV _(reward only)_ | 4 | 168 | 33.6 |
| Scanner Mk V _(reward only)_ | 5 | 840 | 168.0 |
| Plating Mk I | 1 | 4 | 0.8 |
| Plating Mk II | 2 | 8 | 1.6 |
| Plating Mk III | 3 | 24 | 4.8 |
| Capacitor Mk I | 1 | 5 | 1.0 |
| Capacitor Mk II | 2 | 10 | 2.0 |
| Capacitor Mk III | 3 | 30 | 6.0 |
| Engine Mk I | 1 | 6 | 1.2 |
| Engine Mk II | 2 | 12 | 2.4 |
| Engine Mk III | 3 | 36 | 7.2 |
| Thrusters Mk I | 1 | 6 | 1.2 |
| Thrusters Mk II | 2 | 12 | 2.4 |
| Thrusters Mk III | 3 | 36 | 7.2 |
| Scatter | 1 | 25 | 5.0 |
| Seeker | 1 | 32.5 | 6.5 |
| Beam | 1 | 40 | 8.0 |
| Cannon | 1 | 45 | 9.0 |
| Kinetic | 1 | 20 | 4.0 |
| Electric | 1 | 30 | 6.0 |
| Thermal | 1 | 30 | 6.0 |
| Gunnery Mk I | 1 | 8 | 1.6 |
| Gunnery Mk II | 2 | 16 | 3.2 |
| Gunnery Mk III | 3 | 48 | 9.6 |
| Autoloader Mk I | 1 | 10 | 2.0 |
| Autoloader Mk II | 2 | 20 | 4.0 |
| Autoloader Mk III | 3 | 60 | 12.0 |
| Overcharge | 1 | 45 | 9.0 |

## 6. The tables the numbers come from

| Wave | window s | points (level 3) | enemy HP × (wave) | enemy damage × (wave) |
|---|---|---|---|---|
| 1 | 30 | 6 | 1.00 | 1.00 |
| 2 | 35 | 8 | 1.06 | 1.04 |
| 3 | 40 | 12 | 1.12 | 1.08 |
| 4 | 45 | 16 | 1.18 | 1.12 |
| 5 | 50 | 21 | 1.24 | 1.16 |
| 6 | 55 | null | 1.30 | 1.20 |

Difficulty today (index → spawn budget ×, enemy health / speed / damage ×): **0**: 0× · 1/1/1 · **1**: 0.35× · 0.7/0.8/0.7 · **2**: 0.65× · 0.85/0.9/0.85 · **3**: 1× · 1/1/1

## 9. The level-driven enemy mixes (D-S3-h)

Enemy ratings (points each): SWARM 0.3 · RAMMER_1 1 · SHOOTER_1 1 · KAMIKAZE 1.5 · RAMMER_2 2 · SHOOTER_2 2 · SHOOTER_3 3 · TURRET 3 · RAMMER_3 4 · NEST 5 · BULWARK 8. A wave is a point budget; the level sets the roster ceiling (hardest rating allowed) and 2–4 types are drawn with the points split evenly. Samples are three seeded draws (a wave never repeats its predecessor's types). HP/damage × is the level scale (levels 1–3 are the old Low/Med/High rows).

| Level | HP/dmg × | spawn × | Wave | points | ceiling | three sample mixes |
|---|---|---|---|---|---|---|
| 1 | 1 | 1 | 1 | 6 | 1.42 | 3xRAMMER_1 3xSHOOTER_1 · 10xSWARM 3xRAMMER_1 · 3xSHOOTER_1 3xRAMMER_1 |
|  |  |  | 2 | 8 | 2.26 | 3xKAMIKAZE 2xRAMMER_2 · 2xRAMMER_2 4xSHOOTER_1 · 12xSWARM 2xSHOOTER_2 |
|  |  |  | 3 | 11 | 3.1 | 12xSWARM 1xTURRET 1xSHOOTER_3 · 2xSHOOTER_2 1xSHOOTER_3 1xTURRET · 4xSHOOTER_1 2xRAMMER_2 1xTURRET |
|  |  |  | 4 | 15 | 3.94 | 5xSHOOTER_1 3xSHOOTER_2 2xRAMMER_2 · 3xRAMMER_2 5xRAMMER_1 5xSHOOTER_1 · 3xSHOOTER_2 12xSWARM 2xSHOOTER_3 |
|  |  |  | 5 | 20 | 4.78 | 2xSHOOTER_3 2xTURRET 3xKAMIKAZE 1xRAMMER_3 · 12xSWARM 2xSHOOTER_3 2xTURRET 1xRAMMER_3 · 5xSHOOTER_1 5xRAMMER_1 3xKAMIKAZE 2xTURRET |
| 2 | 1.14 | 1.03 | 1 | 6.2 | 1.48 | 10xSWARM 3xRAMMER_1 · 3xRAMMER_1 3xSHOOTER_1 · 3xSHOOTER_1 3xRAMMER_1 |
|  |  |  | 2 | 8.2 | 2.44 | 2xSHOOTER_2 2xRAMMER_2 · 2xSHOOTER_2 3xKAMIKAZE · 2xRAMMER_2 2xSHOOTER_2 |
|  |  |  | 3 | 11.3 | 3.4 | 12xSWARM 4xSHOOTER_1 1xTURRET · 4xRAMMER_1 2xRAMMER_2 1xTURRET · 12xSWARM 1xSHOOTER_3 4xRAMMER_1 |
|  |  |  | 4 | 15.5 | 4.36 | 3xRAMMER_2 5xRAMMER_1 1xRAMMER_3 · 2xSHOOTER_3 3xSHOOTER_2 1xRAMMER_3 · 5xSHOOTER_1 3xKAMIKAZE 2xTURRET |
|  |  |  | 5 | 20.6 | 5.32 | 3xKAMIKAZE 2xTURRET 2xSHOOTER_3 3xSHOOTER_2 · 2xTURRET 5xSHOOTER_1 3xKAMIKAZE 5xRAMMER_1 · 3xSHOOTER_2 5xRAMMER_1 1xRAMMER_3 1xNEST |
| 3 | 1.3 | 1.06 | 1 | 6.4 | 1.54 | 3xRAMMER_1 3xSHOOTER_1 · 3xSHOOTER_1 3xRAMMER_1 · 3xRAMMER_1 2xKAMIKAZE |
|  |  |  | 2 | 8.5 | 2.62 | 2xRAMMER_2 2xSHOOTER_2 · 3xKAMIKAZE 2xSHOOTER_2 · 12xSWARM 2xRAMMER_2 |
|  |  |  | 3 | 11.7 | 3.7 | 1xSHOOTER_3 4xSHOOTER_1 1xTURRET · 4xSHOOTER_1 2xRAMMER_2 1xSHOOTER_3 · 4xRAMMER_1 4xSHOOTER_1 1xSHOOTER_3 |
|  |  |  | 4 | 15.9 | 4.78 | 3xRAMMER_2 5xRAMMER_1 1xRAMMER_3 · 1xRAMMER_3 2xTURRET 5xRAMMER_1 · 4xKAMIKAZE 2xTURRET 1xRAMMER_3 |
|  |  |  | 5 | 21.2 | 5.86 | 12xSWARM 1xSHOOTER_3 2xTURRET 6xSHOOTER_1 · 2xSHOOTER_3 4xKAMIKAZE 3xSHOOTER_2 1xNEST · 5xSHOOTER_1 5xRAMMER_1 3xSHOOTER_2 2xSHOOTER_3 |
| 4 | 1.48 | 1.09 | 1 | 6.6 | 1.6 | 2xKAMIKAZE 4xRAMMER_1 · 3xSHOOTER_1 2xKAMIKAZE · 4xRAMMER_1 3xSHOOTER_1 |
|  |  |  | 2 | 8.7 | 2.8 | 2xSHOOTER_2 4xSHOOTER_1 · 2xRAMMER_2 4xRAMMER_1 · 12xSWARM 2xSHOOTER_2 |
|  |  |  | 3 | 12 | 4 | 4xRAMMER_1 1xTURRET 1xRAMMER_3 · 12xSWARM 3xKAMIKAZE 1xRAMMER_3 · 4xSHOOTER_1 1xRAMMER_3 1xSHOOTER_3 |
|  |  |  | 4 | 16.4 | 5.2 | 5xSHOOTER_1 1xNEST 3xSHOOTER_2 · 5xRAMMER_1 5xSHOOTER_1 2xTURRET · 12xSWARM 2xTURRET 3xRAMMER_2 |
|  |  |  | 5 | 21.9 | 6.4 | 12xSWARM 1xRAMMER_3 2xTURRET 3xRAMMER_2 · 2xSHOOTER_3 1xRAMMER_3 3xSHOOTER_2 4xKAMIKAZE · 5xRAMMER_1 4xKAMIKAZE 2xSHOOTER_3 1xNEST |
| 6 | 1.93 | 1.16 | 1 | 7 | 1.72 | 2xKAMIKAZE 3xRAMMER_1 · 12xSWARM 3xRAMMER_1 · 2xKAMIKAZE 3xRAMMER_1 |
|  |  |  | 2 | 9.3 | 3.16 | 12xSWARM 2xTURRET · 5xSHOOTER_1 2xTURRET · 12xSWARM 2xRAMMER_2 |
|  |  |  | 3 | 12.8 | 4.6 | 2xSHOOTER_2 2xRAMMER_2 1xRAMMER_3 · 4xRAMMER_1 1xRAMMER_3 1xSHOOTER_3 · 4xSHOOTER_1 1xSHOOTER_3 3xKAMIKAZE |
|  |  |  | 4 | 17.4 | 6.04 | 6xRAMMER_1 6xSHOOTER_1 1xNEST · 1xNEST 3xSHOOTER_2 6xSHOOTER_1 · 1xRAMMER_3 3xSHOOTER_2 1xNEST |
|  |  |  | 5 | 23.2 | 7.48 | 2xTURRET 12xSWARM 2xSHOOTER_3 4xKAMIKAZE · 4xKAMIKAZE 6xRAMMER_1 1xRAMMER_3 2xSHOOTER_3 · 6xRAMMER_1 4xKAMIKAZE 2xTURRET 2xSHOOTER_3 |
| 8 | 2.5 | 1.23 | 1 | 7.4 | 1.84 | 12xSWARM 4xRAMMER_1 · 4xSHOOTER_1 2xKAMIKAZE · 2xKAMIKAZE 4xSHOOTER_1 |
|  |  |  | 2 | 9.8 | 3.52 | 2xTURRET 2xSHOOTER_2 · 2xSHOOTER_3 2xRAMMER_2 · 2xTURRET 1xSHOOTER_3 |
|  |  |  | 3 | 13.5 | 5.2 | 2xSHOOTER_3 3xKAMIKAZE 1xRAMMER_3 · 3xKAMIKAZE 1xRAMMER_3 1xNEST · 1xNEST 1xRAMMER_3 2xSHOOTER_2 |
|  |  |  | 4 | 18.4 | 6.88 | 3xSHOOTER_2 12xSWARM 2xTURRET · 3xSHOOTER_2 6xRAMMER_1 2xSHOOTER_3 · 4xKAMIKAZE 12xSWARM 2xSHOOTER_3 |
|  |  |  | 5 | 24.6 | 8.56 | 2xRAMMER_3 6xRAMMER_1 6xSHOOTER_1 1xBULWARK · 12xSWARM 3xRAMMER_2 2xTURRET 1xNEST · 3xSHOOTER_2 2xTURRET 5xSHOOTER_1 1xBULWARK |
| 10 | 3.25 | 1.3 | 1 | 7.8 | 1.96 | 4xRAMMER_1 3xKAMIKAZE · 4xRAMMER_1 4xSHOOTER_1 · 12xSWARM 4xRAMMER_1 |
|  |  |  | 2 | 10.4 | 3.88 | 2xSHOOTER_3 5xSHOOTER_1 · 2xRAMMER_2 2xTURRET · 2xSHOOTER_3 2xRAMMER_2 |
|  |  |  | 3 | 14.4 | 5.8 | 5xRAMMER_1 2xSHOOTER_2 1xRAMMER_3 · 12xSWARM 1xRAMMER_3 5xRAMMER_1 · 1xRAMMER_3 12xSWARM 5xSHOOTER_1 |
|  |  |  | 4 | 19.6 | 7.72 | 4xRAMMER_2 12xSWARM 3xSHOOTER_3 · 7xSHOOTER_1 2xSHOOTER_3 2xTURRET · 3xRAMMER_2 2xSHOOTER_3 1xNEST |
|  |  |  | 5 | 26.1 | 9.64 | 7xSHOOTER_1 7xRAMMER_1 2xRAMMER_3 1xNEST · 3xSHOOTER_2 3xRAMMER_2 1xBULWARK 2xRAMMER_3 · 12xSWARM 5xKAMIKAZE 3xTURRET 2xRAMMER_3 |
| 15 | 6.26 | 1.5 | 1 | 9 | 2.26 | 2xRAMMER_2 2xSHOOTER_2 · 2xSHOOTER_2 5xSHOOTER_1 · 12xSWARM 2xRAMMER_2 |
|  |  |  | 2 | 12 | 4.78 | 2xRAMMER_3 2xSHOOTER_3 · 2xRAMMER_3 2xTURRET · 2xSHOOTER_3 6xSHOOTER_1 |
|  |  |  | 3 | 16.5 | 7.3 | 4xKAMIKAZE 12xSWARM 1xNEST · 6xSHOOTER_1 2xSHOOTER_3 1xNEST · 3xSHOOTER_2 3xRAMMER_2 1xNEST |
|  |  |  | 4 | 22.5 | 9.82 | 8xRAMMER_1 8xSHOOTER_1 2xRAMMER_3 · 12xSWARM 2xRAMMER_3 1xBULWARK · 2xTURRET 1xBULWARK 2xRAMMER_3 |
|  |  |  | 5 | 30 | 12.34 | 3xTURRET 12xSWARM 1xBULWARK 4xSHOOTER_2 · 1xNEST 4xRAMMER_2 4xSHOOTER_2 3xTURRET · 6xKAMIKAZE 12xSWARM 5xSHOOTER_2 3xSHOOTER_3 |
| 20 | 12.06 | 1.5 | 1 | 9 | 2.56 | 2xRAMMER_2 2xSHOOTER_2 · 3xKAMIKAZE 2xSHOOTER_2 · 12xSWARM 2xSHOOTER_2 |
|  |  |  | 2 | 12 | 5.68 | 12xSWARM 2xTURRET · 6xSHOOTER_1 2xSHOOTER_3 · 6xSHOOTER_1 2xTURRET |
|  |  |  | 3 | 16.5 | 8.8 | 1xBULWARK 1xNEST 1xSHOOTER_3 · 2xTURRET 3xRAMMER_2 1xNEST · 1xBULWARK 1xNEST 1xRAMMER_3 |
|  |  |  | 4 | 22.5 | 11.92 | 8xRAMMER_1 2xTURRET 2xRAMMER_3 · 2xRAMMER_3 1xBULWARK 3xSHOOTER_2 · 8xRAMMER_1 2xSHOOTER_3 4xSHOOTER_2 |
|  |  |  | 5 | 30 | 15.04 | 4xSHOOTER_2 12xSWARM 4xRAMMER_2 1xBULWARK · 8xRAMMER_1 4xRAMMER_2 8xSHOOTER_1 2xSHOOTER_3 · 4xRAMMER_2 12xSWARM 2xNEST 2xRAMMER_3 |

