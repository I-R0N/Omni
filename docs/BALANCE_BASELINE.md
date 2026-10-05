# Balance baseline — what the game does today

_Generated 2026-10-05T01:37:47.613Z by `node scripts/balance.mjs` — 3 seed(s) per cell, 900s sim cap, difficulty 3 (the shipped default and today's highest)._

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
| POCKET | lean | on | death 3 (of 3) | 2:25 | 3 |
| POCKET | lean | off | death 3 (of 3) | 4:12 | 4 |
| POCKET | mk3 | on | boss-dead 2, death 1 (of 3) | 4:10 | 6 |
| POCKET | mk3 | off | death 1, boss-dead 2 (of 3) | 4:06 | 6 |
| UNIVERSE | lean | on | death 3 (of 3) | 6:13 | 5 |
| UNIVERSE | lean | off | death 3 (of 3) | 7:04 | 4 |
| UNIVERSE | mk3 | on | boss-dead 2, death 1 (of 3) | 4:07 | 6 |
| UNIVERSE | mk3 | off | boss-dead 2, death 1 (of 3) | 4:15 | 6 |
| RING | lean | on | death 3 (of 3) | 4:25 | 4 |
| RING | lean | off | death 3 (of 3) | 5:12 | 4 |
| RING | mk3 | on | boss-dead 2, death 1 (of 3) | 4:22 | 6 |
| RING | mk3 | off | boss-dead 3 (of 3) | 4:08 | 6 |
| SEVEN_RINGS | lean | on | death 3 (of 3) | 2:52 | 2 |
| SEVEN_RINGS | lean | off | death 3 (of 3) | 5:27 | 4 |
| SEVEN_RINGS | mk3 | on | death 3 (of 3) | 2:53 | 2 |
| SEVEN_RINGS | mk3 | off | death 3 (of 3) | 2:57 | 3 |

**Hub → rift** (bot flies the shortest wrapped line, knowing where the rift is): universe 11.7 s · ring 7.0 s · seven_rings 15.2 s · pocket 7.9 s. A player has to *find* the rift, so this is a floor.

## 2. Wave by wave (rivals on, as shipped)

Median across arenas and seeds. `window` is the spawn-stream window the design allows; `clear` is when the field was actually empty.

### lean

| Wave | window s | enemies (budget) | seen spawned | clear time s | salvage units | hull lost | rivals alive (max) |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 6 | 6 | 37.2 | 12.5 | 25 | 1 |
| 2 | 35 | 7 | 7 | 42.9 | 15.0 | 36 | 2 |
| 3 | 40 | 8 | 8 | 47.5 (9/12 cleared) | 13.5 | 30 | 3 |
| 4 | 45 | 9 | 9 | 48.0 (7/9 cleared) | 12.0 | 24 | 5 |
| 5 | 50 | 11 | 11 | 73.1 (3/7 cleared) | 12.0 | 90 | 5 |
| 6 | 55 | 12 | 1 | — (0/3 cleared) | 2.0 | 38 | 5 |

### mk3

| Wave | window s | enemies (budget) | seen spawned | clear time s | salvage units | hull lost | rivals alive (max) |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 6 | 6 | 32.5 | 9.0 | 5 | 0 |
| 2 | 35 | 7 | 7 | 37.6 | 16.0 | 10 | 2 |
| 3 | 40 | 8 | 8 | 44.8 (9/11 cleared) | 15.0 | 57 | 4 |
| 4 | 45 | 9 | 9 | 45.1 | 9.0 | 3 | 6 |
| 5 | 50 | 11 | 11 | 53.4 (8/9 cleared) | 10.0 | 20 | 6 |
| 6 | 55 | 12 | 3 | 14.0 (6/8 cleared) | 3.0 | 35 | 6 |

## 3. How much of the pressure is the rivals

Same maps and seeds with and without rival warp-ins (`nextRivalScore = ∞`). Rivals warp in every 1,000 score; 34 % hostile, 30 % ally, 36 % neutral.

| Loadout | Rivals | rivals seen | first rival at (s) | hits taken: enemies / rivals | kills stolen | salvage units / cleared wave | hull lost | run length |
|---|---|---|---|---|---|---|---|---|
| lean | on | 6 | 51 | 13 / 1 | 6 | 13.0 | 207 | 4:13 |
| lean | off | 0 | — | 30 / 0 | 0 | 15.0 | 276 | 5:25 |
| mk3 | on | 6 | 42 | 2 / 0 | 3 | 10.5 | 207 | 4:08 |
| mk3 | off | 0 | — | 1 / 0 | 0 | 13.5 | 179 | 4:07 |

Across every rivals-on run: **135 rivals** warped in (52 hostile); the player took **49** rival hits against **210** from wave enemies, and rivals stole **137** kills (755.0 paid to the player).

## 4. Weapon vs enemy: seconds to kill one

One enemy pinned 250 units ahead, shooter stationary, firing on cooldown, perfect aim. `base` = the gun (+ its energy modifier) alone. `gunned` = the same with 3× Gunnery Mk III beside it. Beams are pulled, not held, so they read slightly pessimistic. **Wave-1 HP**; wave scaling is +6 %/wave (cap ×2.5).

### base

| weapon | RAMMER 1 | TURRET | RAMMER 2 | SWARM | RAMMER 3 | NEST | SHOOTER 1 | DRAGON | SHOOTER 2 | BOSS WARDEN | SHOOTER 3 | BOSS SCATTER | KAMIKAZE | BOSS SIEGE | BULWARK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| _HP_ | 1 | 8 | 2 | 1 | 5 | 14 | 1 | 500 | 2 | 120 | 3 | 105 | 2 | 150 | 4 |
| projectile | 0.2s · 2 | 0.6s · 4 | 0.2s · 2 | 0.3s · 2 | 1.2s · 7 | 1.0s · 6 | 0.2s · 2 | no kill | 0.2s · 2 | 23.2s · 127 | 0.4s · 3 | no kill | 0.3s · 2 | no kill | 3.9s · 21 |
| projectile+kinetic | 0.2s · 1 | 0.4s · 2 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.6s · 3 | 0.2s · 1 | no kill | 0.2s · 1 | 11.2s · 50 | 0.2s · 1 | 7.2s · 32 | 0.2s · 1 | no kill | 2.0s · 9 |
| projectile+electric | 0.2s · 1 | 0.1s · 1 | 0.2s · 1 | 0.2s · 1 | 0.1s · 1 | 0.8s · 2 | 0.2s · 1 | 16.2s · 25 | 0.2s · 1 | 7.4s · 12 | 0.2s · 1 | 5.4s · 9 | 0.2s · 1 | 6.8s · 11 | 4.1s · 7 |
| projectile+thermal | 0.2s · 1 | 0.7s · 3 | 0.4s · 2 | 0.3s · 2 | 1.0s · 5 | 1.2s · 5 | 0.2s · 1 | no kill | 0.4s · 2 | 12.4s · 52 | 0.5s · 3 | 9.6s · 40 | 0.4s · 2 | no kill | 1.2s · 5 |
| beam | 0.1s · 1 | 0.7s · 2 | 0.1s · 1 | 0.1s · 1 | 0.6s · 2 | 1.1s · 3 | 0.1s · 1 | no kill | 0.1s · 1 | no kill | 0.2s · 1 | no kill | 0.1s · 1 | 15.8s · 36 | 0.3s · 1 |
| beam+kinetic | 0.2s · 1 | 1.3s · 2 | 0.2s · 1 | 0.2s · 1 | 1.2s · 2 | 3.2s · 4 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.3s · 1 | 26.6s · 27 | 0.2s · 1 | no kill | 0.3s · 1 |
| beam+electric | 0.1s · 1 | 0.2s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.3s · 1 | 0.1s · 1 | 12.4s · 16 | 0.1s · 1 | 3.5s · 5 | 0.1s · 1 | 3.4s · 5 | 0.1s · 1 | 4.1s · 6 | 0.1s · 1 |
| beam+thermal | 0.2s · 1 | 0.9s · 2 | 0.4s · 1 | 0.2s · 1 | 0.7s · 2 | 1.4s · 3 | 0.2s · 1 | no kill | 0.4s · 1 | 10.8s · 20 | 0.5s · 1 | 7.6s · 14 | 0.4s · 1 | 13.0s · 24 | 0.6s · 2 |
| spread | 0.3s · 1 | 5.5s · 10 | 0.9s · 2 | 0.3s · 1 | no kill | 4.0s · 7 | 0.3s · 1 | no kill | 0.9s · 2 | no kill | 1.5s · 3 | no kill | 0.9s · 2 | no kill | no kill |
| spread+kinetic | 0.2s · 1 | 1.6s · 3 | 0.2s · 1 | 0.2s · 1 | 4.2s · 7 | 1.6s · 3 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 4.2s · 7 |
| spread+electric | 25.1s · 45 | no kill | 10.5s · 20 | 11.0s · 21 | no kill | no kill | no kill | no kill | 29.7s · 54 | no kill | no kill | no kill | 9.4s · 18 | 22.1s · 41 | no kill |
| spread+thermal | 25.4s · 161 | no kill | 28.1s · 178 | no kill | 26.6s · 168 | no kill | 28.7s · 182 | no kill | no kill | no kill | no kill | no kill | no kill | 17.9s · 114 | 24.5s · 155 |
| homing | 0.3s · 2 | 0.7s · 3 | 0.3s · 2 | 0.3s · 2 | 1.3s · 5 | 0.9s · 4 | 0.3s · 2 | no kill | 0.3s · 2 | 19.9s · 67 | 0.3s · 2 | 16.5s · 55 | 0.3s · 2 | no kill | 3.7s · 13 |
| homing+kinetic | 0.3s · 1 | 1.0s · 2 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 1.0s · 2 | 0.3s · 1 | no kill | 0.3s · 1 | no kill | 0.3s · 1 | 14.8s · 23 | 0.3s · 1 | no kill | 4.9s · 8 |
| homing+electric | 0.3s · 1 | 1.6s · 3 | 0.3s · 1 | 0.3s · 1 | 3.4s · 6 | 2.2s · 4 | 0.3s · 1 | no kill | 0.3s · 1 | 14.1s · 24 | 0.9s · 2 | 9.5s · 16 | 0.3s · 1 | 10.1s · 17 | 11.8s · 20 |
| homing+thermal | 0.3s · 1 | 1.6s · 3 | 0.4s · 1 | 0.3s · 1 | 1.6s · 3 | 2.1s · 4 | 0.3s · 1 | no kill | 0.4s · 1 | 15.6s · 27 | 0.9s · 2 | 13.4s · 23 | 0.4s · 1 | no kill | 2.0s · 4 |
| cannon | 0.2s · 1 | 3.1s · 3 | 0.2s · 1 | 0.2s · 1 | 7.3s · 6 | 5.9s · 5 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 1.6s · 2 | no kill | 0.2s · 1 | no kill | 9.0s · 7 |
| cannon+kinetic | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 3.7s · 3 |
| cannon+electric | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | 11.5s · 9 | 0.2s · 1 | 8.0s · 6 | 0.2s · 1 | no kill | 0.2s · 1 |
| cannon+thermal | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 1.6s · 2 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 5.9s · 5 |

### gunned (3× Gunnery Mk III)

| weapon | RAMMER 1 | TURRET | RAMMER 2 | SWARM | RAMMER 3 | NEST | SHOOTER 1 | DRAGON | SHOOTER 2 | BOSS WARDEN | SHOOTER 3 | BOSS SCATTER | KAMIKAZE | BOSS SIEGE | BULWARK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| _HP_ | 1 | 8 | 2 | 1 | 5 | 14 | 1 | 500 | 2 | 120 | 3 | 105 | 2 | 150 | 4 |
| projectile | 0.2s · 2 | 0.4s · 3 | 0.2s · 2 | 0.3s · 2 | 0.2s · 2 | 0.6s · 4 | 0.2s · 2 | 19.5s · 90 | 0.2s · 2 | 10.3s · 57 | 0.3s · 2 | 6.1s · 34 | 0.3s · 2 | no kill | 1.9s · 11 |
| projectile+kinetic | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 8.4s · 38 | 0.2s · 1 | 3.4s · 15 | 0.2s · 1 | 2.9s · 14 | 0.2s · 1 | 2.3s · 11 | 0.8s · 4 |
| projectile+electric | 0.2s · 1 | 0.1s · 1 | 0.2s · 1 | 0.2s · 1 | 0.1s · 1 | 0.1s · 1 | 0.2s · 1 | 19.4s · 26 | 0.2s · 1 | 3.5s · 6 | 0.2s · 1 | 4.7s · 8 | 0.2s · 1 | 3.3s · 6 | 2.1s · 4 |
| projectile+thermal | 0.2s · 1 | 0.5s · 2 | 0.2s · 1 | 0.3s · 2 | 0.7s · 4 | 0.7s · 3 | 0.2s · 1 | 16.2s · 67 | 0.2s · 1 | 7.8s · 33 | 0.3s · 2 | 7.2s · 30 | 0.3s · 2 | 7.9s · 33 | 1.0s · 5 |
| beam | 0.1s · 1 | 0.3s · 1 | 0.1s · 1 | 0.1s · 1 | 0.2s · 1 | 0.6s · 2 | 0.1s · 1 | 21.8s · 49 | 0.1s · 1 | no kill | 0.1s · 1 | 4.6s · 11 | 0.1s · 1 | 6.2s · 14 | 0.1s · 1 |
| beam+kinetic | 0.2s · 1 | 0.3s · 1 | 0.2s · 1 | 0.2s · 1 | 0.3s · 1 | 1.2s · 2 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | 10.5s · 11 | 0.2s · 1 | 24.4s · 25 | 0.2s · 1 |
| beam+electric | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.1s · 1 | 0.2s · 1 | 0.1s · 1 | 6.6s · 9 | 0.1s · 1 | 1.8s · 3 | 0.1s · 1 | 1.7s · 3 | 0.1s · 1 | 2.0s · 3 | 0.1s · 1 |
| beam+thermal | 0.1s · 1 | 0.6s · 2 | 0.2s · 1 | 0.1s · 1 | 0.4s · 1 | 0.8s · 2 | 0.1s · 1 | 25.6s · 42 | 0.2s · 1 | 5.6s · 11 | 0.3s · 1 | 5.0s · 10 | 0.2s · 1 | 7.5s · 14 | 0.3s · 1 |
| spread | 0.3s · 1 | 2.1s · 4 | 0.3s · 1 | 0.3s · 1 | 4.6s · 8 | 1.5s · 3 | 0.3s · 1 | no kill | 0.3s · 1 | no kill | 0.9s · 2 | no kill | 0.3s · 1 | no kill | 5.3s · 9 |
| spread+kinetic | 0.2s · 1 | 0.9s · 2 | 0.2s · 1 | 0.2s · 1 | 1.6s · 3 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | 4.0s · 7 | 2.3s · 4 |
| spread+electric | 20.9s · 39 | no kill | 25.3s · 47 | 11.0s · 21 | no kill | no kill | no kill | no kill | no kill | no kill | no kill | no kill | 9.4s · 18 | 7.2s · 14 | no kill |
| spread+thermal | 24.9s · 158 | no kill | 25.1s · 159 | no kill | no kill | no kill | 27.3s · 173 | no kill | 25.9s · 164 | no kill | no kill | no kill | no kill | 11.0s · 70 | no kill |
| homing | 0.3s · 2 | 0.3s · 2 | 0.3s · 2 | 0.3s · 2 | 0.3s · 2 | 0.6s · 3 | 0.3s · 2 | 17.9s · 60 | 0.3s · 2 | 6.2s · 21 | 0.3s · 2 | 5.2s · 18 | 0.3s · 2 | 7.4s · 25 | 1.9s · 7 |
| homing+kinetic | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 25.3s · 39 | 0.3s · 1 | 8.6s · 14 | 0.3s · 1 | 5.5s · 9 | 0.3s · 1 | no kill | 2.3s · 4 |
| homing+electric | 0.3s · 1 | 0.9s · 2 | 0.3s · 1 | 0.3s · 1 | 0.3s · 1 | 1.5s · 3 | 0.3s · 1 | 12.0s · 20 | 0.3s · 1 | 5.5s · 10 | 0.3s · 1 | 4.7s · 8 | 0.3s · 1 | 4.8s · 9 | 5.3s · 9 |
| homing+thermal | 0.3s · 1 | 0.9s · 2 | 0.3s · 1 | 0.3s · 1 | 1.2s · 3 | 1.5s · 3 | 0.3s · 1 | no kill | 0.3s · 1 | 12.4s · 21 | 0.3s · 1 | 9.0s · 16 | 0.3s · 1 | 20.9s · 35 | 1.6s · 3 |
| cannon | 0.2s · 1 | 1.6s · 2 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 3.1s · 3 | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 0.2s · 1 | no kill | 10.6s · 8 |
| cannon+kinetic | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 17.7s · 11 | 0.2s · 1 | 7.2s · 5 | 0.2s · 1 | no kill | 0.2s · 1 | 8.6s · 6 | 2.0s · 2 |
| cannon+electric | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | 5.9s · 5 | 0.2s · 1 | 4.5s · 4 | 0.2s · 1 | 4.3s · 4 | 0.2s · 1 |
| cannon+thermal | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | 0.2s · 1 | no kill | 0.2s · 1 | 10.1s · 8 | 0.2s · 1 | 7.4s · 6 | 0.2s · 1 | no kill | 1.6s · 2 |

Cell = seconds · shots fired until dead. **Read the `spread+electric` and `spread+thermal` rows with suspicion**: a 1-HP target taking 40–180 shots means those pellets (which curl and weave, or need a chain/heat to land) mostly miss a *pinned stationary* target at 250 units — either a real weakness of those two guns or an artifact of the duel setup; this baseline does not decide which. `no kill` = still alive after 30 s.

## 5. Income against prices

- **lean**: median **13.0 units per cleared wave**, **84.5 units per run** (runs ended as above).
- **mk3**: median **10.5 units per cleared wave**, **81.5 units per run** (runs ended as above).
- Spec: 0.55 + 0.25 salvage rolls per enemy kill, +3 units per wave clear, +8 per snitch catch. Rivals vacuum drops within 150 units.

**The `mk3` loadout the bot wears costs 469 units** in the shops (every Mk III, Shield, Mk V scanner, Beam, Thermal, Electric, Overcharge) — about 36 cleared waves, or 5.5 lean runs, of income. A death strips what was *installed* (cargo survives), so that figure is also what a bare death risks if nothing is in the hold.

| Module | Mk | Price (units) | Cleared waves of lean income (13.0 u/wave) |
|---|---|---|---|
| Hull Mk I | 1 | 4 | 0.3 |
| Hull Mk II | 2 | 10 | 0.8 |
| Hull Mk III | 3 | 18 | 1.4 |
| Shield | 1 | 30 | 2.3 |
| Light | 1 | 9 | 0.7 |
| Scanner Mk I | 1 | 7 | 0.5 |
| Scanner Mk II | 2 | 17.5 | 1.3 |
| Scanner Mk III | 3 | 32 | 2.5 |
| Scanner Mk IV | 4 | 55 | 4.2 |
| Scanner Mk V | 5 | 90 | 6.9 |
| Plating Mk I | 1 | 4 | 0.3 |
| Plating Mk II | 2 | 10 | 0.8 |
| Plating Mk III | 3 | 18 | 1.4 |
| Capacitor Mk I | 1 | 5 | 0.4 |
| Capacitor Mk II | 2 | 12.5 | 1.0 |
| Capacitor Mk III | 3 | 23 | 1.8 |
| Engine Mk I | 1 | 6 | 0.5 |
| Engine Mk II | 2 | 15 | 1.2 |
| Engine Mk III | 3 | 27.5 | 2.1 |
| Thrusters Mk I | 1 | 6 | 0.5 |
| Thrusters Mk II | 2 | 15 | 1.2 |
| Thrusters Mk III | 3 | 27.5 | 2.1 |
| Scatter | 1 | 25 | 1.9 |
| Seeker | 1 | 32.5 | 2.5 |
| Beam | 1 | 40 | 3.1 |
| Cannon | 1 | 45 | 3.5 |
| Kinetic | 1 | 20 | 1.5 |
| Electric | 1 | 30 | 2.3 |
| Thermal | 1 | 30 | 2.3 |
| Gunnery Mk I | 1 | 8 | 0.6 |
| Gunnery Mk II | 2 | 20 | 1.5 |
| Gunnery Mk III | 3 | 38 | 2.9 |
| Autoloader Mk I | 1 | 10 | 0.8 |
| Autoloader Mk II | 2 | 26 | 2.0 |
| Autoloader Mk III | 3 | 51.5 | 4.0 |
| Overcharge | 1 | 45 | 3.5 |

## 6. The tables the numbers come from

| Wave | window s | budget | enemy HP × | enemy damage × |
|---|---|---|---|---|
| 1 | 30 | 6 | 1.00 | 1.00 |
| 2 | 35 | 7 | 1.06 | 1.04 |
| 3 | 40 | 8 | 1.12 | 1.08 |
| 4 | 45 | 9 | 1.18 | 1.12 |
| 5 | 50 | 11 | 1.24 | 1.16 |
| 6 | 55 | 12 | 1.30 | 1.20 |

Difficulty today (index → spawn budget ×, enemy health / speed / damage ×): **0**: 0× · 1/1/1 · **1**: 0.35× · 0.7/0.8/0.7 · **2**: 0.65× · 0.85/0.9/0.85 · **3**: 1× · 1/1/1

