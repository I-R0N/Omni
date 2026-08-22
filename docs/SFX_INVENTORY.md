# Omni — SFX Inventory

Every player-audible action in the game, with the parameters needed to
**generate** the sound (externally, at quality) and to **synthesise** a
draft of it (in-engine, procedurally). Written for Phase 3 Pair B
(roadmap step (a), user directive **decision #43**).

This document has two jobs and one rule.

- **Job 1 — the generation brief.** Each row is a self-contained
  commission: what triggers it, how long it lasts, what it should sound
  like, its frequency range and envelope, how it varies, and how loud it
  sits. Hand a section to a sound designer or a generation tool and you
  should get back something usable without asking follow-up questions.
- **Job 2 — the implementation map.** The `id` column is the contract.
  `AudioSystem.play(id, opts)` is the only call site anywhere in the
  engine. Draft sounds are **procedural** (WebAudio oscillators / noise /
  filters / envelopes) — there are no audio asset files, so
  `scripts/inline-build.mjs` and the standalone build are untouched.
- **The rule — ids are stable.** Replacing a draft with a real asset is a
  registry change keyed by the same id, never a change at the trigger
  site. If a row's id changes, every consumer changes with it, so don't.

Status of the sounds themselves: everything shipped in this pass is a
**draft synth**. §9 lists the drafts most worth spending an external
generation budget on.

---

## 1. Reading a row

| Column | Meaning |
|---|---|
| **id** | Registry key. `category.subject.action`, lowercase, dot-separated. Stable forever. |
| **trigger** | Where the engine fires it — file and handler. This is the wiring instruction. |
| **tier** | Mix priority, 1–3. See §2. |
| **dur** | Target length in ms, from attack to inaudible. Loops give their loop period. |
| **character** | Prose for a human or a generation prompt. The commission. |
| **freq / env** | Fundamental or band in Hz, plus envelope as `A→D` (attack→decay) in ms, and the shape. |
| **var** | Variation scheme so repeats don't fatigue. `pitch ±N%` = random detune per instance; `RR n` = round-robin over n takes. |
| **poly / throttle** | Max simultaneous voices for this id, and the burst rule. See §3. |
| **mix** | Relative gain, 0–1, before master volume. Calibrated so a tier-1 sound at 1.0 is the loudest thing in the game. |
| **pos** | `world` = panned and attenuated by distance from the camera. `flat` = UI, centred, no attenuation. |

`L` in the dur column marks a **loop** rather than a one-shot: it starts
on an enter-condition, stops on an exit-condition, and both are named in
the trigger column.

---

## 2. Mix priority tiers

Tiers exist so a mass-death frame doesn't drown the one sound the player
needed to hear. When the voice budget is contended, low tiers are thinned
first (§3).

- **Tier 1 — never masked.** Sounds that carry information the player acts
  on: their own weapon firing, damage taken, their death, a pickup, a
  dock, a portal transit, a wave or boss beat, the snitch catch. These
  are the sounds that would make the game unplayable if lost.
- **Tier 2 — the texture of combat.** Enemy deaths, projectile impacts,
  destruction. Losing an individual one costs nothing; losing all of them
  makes the game feel dead.
- **Tier 3 — material chatter.** Tile dents, shard merges, regen pops,
  drop fusions. Ambient granularity. First to be thinned, and thinned
  aggressively.

**Frequency budget.** Tier 1 mostly lives 200 Hz–4 kHz where it competes
least. Destruction (tier 2) owns the low end below 200 Hz. Material
chatter (tier 3) sits in the low-mids and stays quiet. This is why the
low-end rows below are deliberately short — a long boom eats the mix.

**Material chatter must not live above ~2 kHz.** The first draft put the
glass and metal chips at 2.4 kHz and 1.67 kHz with filter Q up at 6–8,
and playtest was blunt: it whined. Two lessons worth keeping. (1) A
sound that fires in BULK is judged by what a *hundred* of them sound
like, not one — and up there, a hundred is a whine no matter how quiet
each one is. (2) **Q matters as much as frequency**: a high-Q bandpass
on noise rings, and ringing is what the ear reads as whining. Lowering Q
turns the same filter into a knock. Materials still keep their relative
ORDER (glass brightest, metal middle, rock dullest) — the whole set just
moved down.

---

## 3. Concurrency, throttling, and the anti-fatigue rules

A single frame in this engine can kill 40 enemies (snitch board-clear),
shatter 200 shards (a merged rock parent detonating), or land 12 pellets
(charged shotgun). Naïvely one-voice-per-event is 400 voices and a
distorted, useless mess. Three mechanisms, all enforced by
`AudioSystem`, not by call sites:

1. **Per-id polyphony cap.** The `poly` column. Beyond it, the oldest
   voice for that id is stolen (or the new trigger is dropped, whichever
   the row says).
2. **Retrigger window.** Also in the `poly` column as `≥Nms`. Two
   triggers of the same id inside the window collapse into one — the
   second is dropped, but it may **bump the first's gain** (marked
   `+gain`) so ten simultaneous shard breaks read as one bigger break
   rather than ten thin ones. This is the mechanism that makes mass
   deaths sound *heavier* rather than louder.
3. **Global voice ceiling with tier thinning.** A hard cap on live voices
   across all ids; over it, new tier-3 triggers are dropped, then tier-2.
   Tier 1 always plays. Same shape as `enforceCap` for particles.

**Anti-fatigue.** Every repeated sound needs variation or it becomes a
buzz within a minute. Pitch jitter is the cheap default; round-robin over
takes is the good one and applies once real assets land. Rows fired more
than ~4×/second **must** carry variation — those are flagged.

**Positional audio.** `world` sounds pan by the torus-wrapped horizontal
delta from the camera (`wrapDeltaX`) and attenuate by torus-wrapped
distance. Straight `a.x - b.x` gives a hard pan flip at the seam, so
distance and pan both go through the wrap helpers, no exceptions.

**Sustained loops are judged far more harshly than one-shots.** Every
"whine" reported in playtest was a LOOP or a bulk-fired chip, never a
single event. A tone that is pleasant once becomes intolerable held. So
every `L` row here is low — the portal at 55 Hz, the station at ~300 Hz
broadband, the engine at 36 Hz — and a headless smoke renders each loop
through an `OfflineAudioContext` and asserts none of them sits in the
whine band. The snitch is the brightest of them by design and is still
capped well below where the complaints came from.

**Ambient events are NEAR-FIELD; the player's own are not.** A dense shard
field generates constant shard-on-shard collisions, merges and snaps. At
the normal radius (2600) the player hears a running commentary on physics
they are not part of. So the shard-chatter rows carry a much shorter
range (`SHARD_NEAR_RADIUS` / `SHARD_FAR_RADIUS`, 240/850) — audible only
in close proximity.

The exception is what makes this feel right rather than merely quieter:
**a shard destroyed BY the player is played at the normal radius**. The
`killedByPlayer` stamp already exists for scoring and is set by every
player damage path — projectile, crash, lightning chain, cannon splash —
so a shard you shot from range is still your shard and still audible,
while the identical break happening across the map is not. Direct
player↔shard contact is covered separately by `crash.player.shard`
(and by `crash.player.tile` for the static-tile case), both full-range
because the player is a party to them — the near-field rule is about
physics the player is *not* part of.

Any row may override its radii; the caller may override them again. The
precedence is caller → row → global default.

---

## 4. Combat

### 4.1 Player weapons

Fired from `WeaponSystem.firePlayerWeapon` (and `tickPlayerBurst` for
burst sub-shots), reached via `GameEngine.handleShooting`. All are
`world` even though the player is at the camera centre — that keeps one
code path, and the pan lands at zero anyway.

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `weapon.blaster.fire` | `firePlayerWeapon`, `WeaponType.BLASTER` | 1 | 90 | Dry, tight energy pip. Short square-ish body with a click transient. Should not ring — it fires constantly. | 620 Hz down-glide to 300 Hz; 2→80 exp | pitch ±6% **(required — highest fire rate in the game)** | 4, ≥40 ms | 0.45 | world |
| `weapon.burst.fire` | `firePlayerWeapon`, `BURST` (first shot) | 1 | 70 | Snappier and thinner than blaster; the first of three. Mechanical, almost a bolt-click. | 800→480 Hz; 1→60 exp | pitch ±5% | 4, ≥30 ms | 0.40 | world |
| `weapon.burst.sub` | `tickPlayerBurst` | 1 | 60 | Same voice as `burst.fire` one step quieter and a semitone up, so a burst reads as a rising triplet. | 850→500 Hz; 1→50 exp | pitch ±5%, +2% per sub-shot index | 4, ≥25 ms | 0.32 | world |
| `weapon.shotgun.fire` | `firePlayerWeapon`, `SHOTGUN` | 1 | 220 | Wide breathy blast — filtered noise burst over a low thump. Cone-shaped, no pitch centre. | noise 300 Hz–6 kHz band, LP sweep 6 k→900 Hz; 2→180 exp; +90 Hz sine thump 1→70 | pitch ±8%, noise seed varies | 3, ≥120 ms | 0.62 | world |
| `weapon.bouncer.fire` | `firePlayerWeapon`, `BOUNCER` | 1 | 130 | Rubbery, springy launch. A pitched *boing* with an audible up-bend, telegraphing that it will come back. | 220→520 Hz up-glide; 3→110 sine + slight FM | pitch ±7% | 3, ≥90 ms | 0.48 | world |
| `weapon.lightning.fire` | `firePlayerWeapon`, `LIGHTNING` | 1 | 160 | Electric discharge crack — bright noise transient into a short buzzing tail. | noise HP 2 kHz + 60 Hz sawtooth AM ring; 1→140 | pitch ±10%, AM rate varies | 3, ≥100 ms | 0.55 | world |
| `weapon.homing.fire` | `firePlayerWeapon`, `HOMING` | 1 | 260 | Soft launch *whump* with a doppler-ish tail that suggests the missile leaving. Deliberately less aggressive than the others — it does the work for you. | 180 Hz thump 3→90; noise tail LP 1.8 kHz 20→240 | pitch ±5% | 3, ≥140 ms | 0.50 | world |
| `weapon.cannon.fire` | `firePlayerWeapon`, `CANNON` | 1 | 380 | Heavy artillery cough. Real low-end weight, slow decay, a sense of recoil. The biggest player sound. | 55 Hz sine 4→300 + noise body LP 900 Hz 2→200 | pitch ±4% | 2, ≥250 ms | 0.75 | world |
| `weapon.charge.loop` | `updateGameLogic`, on `player.chargeProgress > 0`; stops when it returns to 0 | 1 | **L** | Rising capacitor whine. Pitch tracks `chargeProgress` linearly, so the player hears fullness rather than watching the ring. Quiet — it plays under everything else. | 140 Hz → 900 Hz tracked to progress; sine + saw blend, gain ramps 0→0.3 over the hold | none (it's continuous) | 1 (singleton) | 0.28 | flat |
| `weapon.charge.ready` | same tick, when `chargeProgress` first reaches 1 | 1 | 140 | A clean bell ping confirming the shot is armed. Distinct from the loop it interrupts. | 1320 Hz sine, 1→130 exp | none | 1, ≥400 ms | 0.42 | flat |
| `weapon.charged.release` | `handleShooting(_, true)`, layered **over** the family's `.fire` | 1 | 300 | A low sub-drop and a bright airy sweep layered on top of the normal shot, so any charged weapon reads as the same "supercharged" gesture. | 90→40 Hz sub 2→260; noise sweep 8 k→2 kHz 2→180 | pitch ±4% | 2, ≥200 ms | 0.55 | world |
| `weapon.reject` | `handleShooting` early-return on `systemsDisabled`, or `currentWeapon === undefined` | 2 | 110 | Dead, muted click-thud. The sound of nothing happening. Must not be pleasant. | 160 Hz square, heavily LP'd at 400 Hz; 1→90 | pitch ±3% | 1, ≥250 ms **(hard throttle — the player will mash)** | 0.30 | flat |
| `weapon.cycle` | `WeaponSystem.cycleWeapon` / `selectWeapon` via `GameEngine` | 2 | 80 | Mechanical selector detent. Dry, short, two-tone. | 900 Hz + 1350 Hz clicks 8 ms apart; 1→60 | none | 1, ≥80 ms | 0.35 | flat |

### 4.2 Enemy weapons

Fired from `WeaponSystem.updateEnemyShooting`. Deliberately voiced
*apart* from the player's family: enemy shots are darker and duller, so
the player can tell incoming from outgoing without looking. Fire rates
here are high with a full arena, so caps are tight.

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `enemy.shot.basic` | `updateEnemyShooting`, default archetype weapon | 2 | 100 | Dull thup. Same gesture as the blaster but darker and softer-edged. | 380→220 Hz; 2→85 exp, LP 2 kHz | pitch ±10% **(required)** | 5, ≥50 ms | 0.30 | world |
| `enemy.shot.acid` | same, archetypes whose weapon carries `appliesEffect` (Orbiter / SHOOTER_2) | 2 | 150 | Wet, slightly gurgling launch. Signals "this one debuffs you". | 300→180 Hz + comb-filtered noise; 3→130 | pitch ±10% | 4, ≥60 ms | 0.33 | world |
| `enemy.shot.fan` | Bulwark's 3-shot fan (one trigger for the fan, **not** per pellet) | 2 | 190 | Three overlapping dull thups fused into one gesture. Fires once per volley by design — per-pellet would be three voices for one visual beat. | layered 380/420/460 Hz, 12 ms stagger; 2→160 | pitch ±6% | 3, ≥180 ms | 0.38 | world |
| `enemy.shot.missile` | Turret homing lob; `fireDragonMissile` | 2 | 300 | Slow hissing launch — a lit fuse more than a bang. Long enough to hear it coming. | noise LP 1.2 kHz 20→280 + 120 Hz body 4→120 | pitch ±6% | 3, ≥200 ms | 0.40 | world |
| `enemy.shot.boss` | `updateEnemyShooting` when `entity.isBoss` (weapon override path) | 1 | 340 | The player's own weapon, wrong-sided: same family as `shotgun`/`cannon` but detuned down and given a menacing low-mid growl. | family voice, ×0.72 pitch, +120 Hz saw growl layer | pitch ±5% | 2, ≥220 ms | 0.62 | world |

### 4.3 Impacts

Central hook: **`GameEngine.handleProjectileHit`** already switches on
`target.type` and material variant, so it is the single wiring point for
almost this whole table. Shield rows come from `PhysicsSystem`.

The `crash.*` rows at the foot of the table are BODY collisions rather
than projectile hits, and their per-instance `{ gain, pitch }` is not a
row parameter — it comes from the shared impact-strength model in §4.4,
the same number the camera shake is computed from.

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `impact.hull.enemy` | `handleProjectileHit`, `EntityType.ENEMY` | 2 | 90 | Sharp metallic tick with a tiny spark fizz. Reads as "connected". | 1.6 kHz click + noise HP 3 kHz; 1→75 | pitch ±12% **(required — the most-fired sound in the game)** | 6, ≥30 ms **+gain** | 0.34 | world |
| `impact.hull.player` | `handleProjectileHit`, `EntityType.PLAYER` | 1 | 170 | Duller, closer, more alarming than the enemy version — a body blow on your own hull, with a hint of internal ring. | 240 Hz thud 1→110 + 900 Hz ring 2→150 | pitch ±6% | 3, ≥90 ms | 0.60 | world |
| `impact.tile.glass` | `handleProjectileHit`, `STRUCTURE`, `glass-*` | 3 | 80 | Glassy tink — the brightest of the materials, but a *knock* rather than a ring. | 900 Hz BP Q3 + 1.25 kHz partial; 1→80 | pitch ±14% | 5, ≥25 ms **+gain** | 0.22 | world |
| `impact.tile.rock` | same, `rock-*` | 3 | 90 | Dry stony knock with a dust rasp. | 480 Hz knock + noise LP 2 kHz; 1→80 | pitch ±14% | 5, ≥25 ms **+gain** | 0.24 | world |
| `impact.tile.metal` | same, `metal-*` | 3 | 165 | Low metallic clonk with a short hum. The most tonal of the material hits — but a LOW tone. | 520 Hz BP Q3 + 330 Hz partial; 1→165 | pitch ±10% | 4, ≥30 ms **+gain** | 0.26 | world |
| `impact.tile.plastic` | same, `plastic-*` | 3 | 70 | Muted plasticky tock. Deadened, no ring at all. | 700 Hz square LP 1.4 kHz; 1→55 | pitch ±14% | 5, ≥25 ms **+gain** | 0.20 | world |
| `impact.tile.nebula` | same, `nebula-*` | 3 | 200 | Soft breathy poof, almost pitchless. Gas, not matter. | noise BP 900 Hz Q 1.5; 15→190 | pitch ±16% | 4, ≥40 ms **+gain** | 0.16 | world |
| `impact.shield.absorb` | `PhysicsSystem` projectile path, damage taken into `shield` (any entity) | 1 | 150 | Energy splash — a filtered *whoosh* with a bright rim. Clearly *not* a hull hit; the player must be able to tell shield from health by ear. | noise BP 1.8 kHz sweeping up; 2→130 + 700 Hz sine 1→90 | pitch ±8% | 3, ≥60 ms | 0.48 | world |
| `impact.shield.deflect` | `PhysicsSystem.tryArcShieldIntercept` success | 2 | 180 | Ricochet — a hard ping with an audible pitch *rise* as the bolt leaves. The rise is the information: it bounced, it didn't land. | 900→1600 Hz glide; 1→160 | pitch ±10% | 3, ≥80 ms | 0.42 | world |
| `impact.shield.break` | shield crosses to 0 on any entity carrying `maxShield` | 1 | 420 | Collapsing field — a descending sizzle that dies into silence. Sells the loss. | 2.2 k→200 Hz noise sweep; 2→400 | pitch ±5% | 2, ≥300 ms | 0.55 | world |
| `impact.armor.chip` | `PhysicsSystem` damage path, `armor` trait reduced the hit | 2 | 100 | Thick, dead clunk — an obviously *absorbed* hit. Pairs with the reduced damage number the game already shows. | 300 Hz LP 600 Hz; 1→85 | pitch ±8% | 4, ≥40 ms **+gain** | 0.30 | world |
| `impact.lightning.arc` | `GameEngine.fireLightningChainFromImpact`, per arc segment | 2 | 120 | Crackling zap. Short, bright, electrical. Chains fire several at once — variation matters. | noise HP 3 kHz + 90 Hz AM; 1→100 | pitch ±14% **(required)** | 4, ≥25 ms **+gain** | 0.34 | world |
| `impact.explosion.aoe` | `GameEngine.applyExplosionAoE` / `spawnShockwave` (player-owned) | 2 | 400 | Compact splash blast. Low thump, mid crackle, quick out. Not the boss-death boom — this fires several times a fight. | 70 Hz sine 3→320 + noise LP 2 kHz 2→260 | pitch ±7% | 3, ≥180 ms | 0.58 | world |
| `crash.player.tile` | `PhysicsSystem` static-tile contact past `CRASH_VELOCITY_THRESHOLD` | 1 | 260 | Heavy scraping collision. You flew into a wall. Grinding, not explosive. Loudness scales with **impact strength** (§4.4), which for a static tile is the impact-speed curve it has always had — the wall is the one hit the new model leaves bit-for-bit unchanged. | 130 Hz thud 2→200 + noise LP 900 Hz 5→240 | pitch ±8%, gain from `I` (§4.4), floor 0 | 2, ≥180 ms | 0.55 | world |
| `crash.player.shard` | `PhysicsSystem` player↔MOBILE-shard contact above `SHARD_CONTACT_SPEED` (1.2 — far below the wall-break speed of 4) | 1 | 140 | A loose rock knocking off the hull. Light, hollow and short — a nudge, not a collision. Distinct from `crash.player.tile`: hitting a drifting pebble must not sound like flying into masonry. Pitched by shard MASS (small knocks higher) and gained by **impact strength** (§4.4) rather than raw speed, so one id spans pebble-tap to boulder-slam, a 40 px metal shard outweighs a same-size rock by ear as well as on the camera, and a busy field stays coherent. | 280→170 Hz triangle + LP noise 900→380 Hz; 1→120 | pitch ±12%, plus the §4.4 mass-pitch and strength-gain, floor 0.25 | 3, ≥70 ms **+gain** | 0.34 | world |
| `crash.player.enemy` | `PhysicsSystem` player↔enemy body contact | 1 | 200 | Metallic body slam. Harder-edged than the tile crash, with a hull ring. Gain and pitch come from **impact strength** (§4.4) over the ENEMY's mass, so a gnat glances off the hull and a Bastion stops you dead. | 200 Hz thud + 1.1 kHz ring; 1→180 | pitch ±8%, plus the §4.4 mass-pitch and strength-gain, floor 0.30 | 2, ≥140 ms | 0.52 | world |
| `crash.shard.tile` | `PhysicsSystem` shard↔tile / shard↔shard above the momentum threshold. **NOT CURRENTLY WIRED** — registered and specified, but no call site fires it. Deliberate: shard-on-shard contact is exactly the chatter being suppressed, so adding it would work against the proximity rule above. Wire it only alongside a reason to. | 3 | 110 | Distant knock of debris hitting debris. Quiet — this happens constantly in a shard field. | 350 Hz LP 1.5 kHz; 1→95 | pitch ±16%, plus the §4.4 mass-pitch and strength-gain taken over the SHARD's own step, floor 0.20 | 4, ≥60 ms **+gain** | 0.14 | **near-field** |

### 4.4 Impact strength — one number for the camera and the ear

A body collision produces two pieces of feedback: the camera shakes, and
something is heard. They were computed from two unrelated scales — the
shake from `min(impactSpeed, HEAVY) × CAP_MULTIPLIER`, the `crash.*`
gains from raw `impactSpeed` over hand-picked spans — with no mass in
either, so a 15 px chip and a static wall shook the camera identically
*and* sounded within a hair of each other at the same closing speed.
`COLLISION_CONFIG.SHAKE` fixed the camera by reading the quantity the
impulse solver is about to apply anyway. This section puts the SOUND on
that same quantity, so how hard a hit reads to the eye and to the ear is
one decision rather than two that drift.

**The quantity.** For a collision between `self` — the body whose voice
is playing, which is the player for every `crash.player.*` row — and
`other`:

```
effInv(x) = x.mass === Infinity ? 0 : (1 / x.mass) ^ MASS_BIAS_EXPONENT   // 0.5
dv        = (1 + ELASTICITY) · |v_n| · effInv(self) / (effInv(self) + effInv(other))
I         = clamp(dv / SHAKE.IMPACT_MAX, 0, 1)                           // IMPACT_MAX = 30
```

`dv` is `self`'s own velocity STEP along the collision normal — the
number the solver applies a few lines later, bias exponent included — so
it carries both masses without a second model to keep in sync. `I` is
that step normalised to 0..1, which is literally `shake / 30`: a row's
gain and the camera's lurch become two readings of one dial.

With today's constants (`ELASTICITY 0.5`, `MASS_BIAS_EXPONENT 0.5`,
`PHYSICS_CONSTANTS.PLAYER_MASS 100`) the player-side form collapses to a
single line, which is what the numbers below are computed from:

```
dv = 1.5 · |v_n| · √m / (√m + 10)      m = impactor mass; a static tile is ∞, so √m/(√m+10) → 1
```

**Gain.** `gain = clamp(dv / SPAN, FLOOR, 1)`, where `SPAN` is the row's
own — the `dv` at which it reaches full gain. The row's `mix` still
scales it; this is the per-instance factor the call site passes, as
`{ gain }`.

| row | span | floor |
|---|---|---|
| `crash.player.tile` | 18 | 0 |
| `crash.player.shard` | 6 | 0.25 |
| `crash.player.enemy` | 12 | 0.30 |
| `crash.shard.tile` | 6 | 0.20 |

The TILE span is not a taste knob. A static body takes the whole
velocity step, so `dv = 1.5 |v_n|` and `dv / 18` is *exactly* the
`min(1, impactSpeed / 12)` curve `crash.player.tile` ships today: at the
break threshold (4) both give 0.33, at 12 both give 1.0. Flying into a
wall sounds bit-for-bit the way it always has, and every lighter impactor
gets quieter by the true mass ratio — the same isolating claim
`COLLISION_CONFIG.SHAKE` makes, for the same reason. This is a fix for
light bodies, not a global nerf, and the wall is the sound nobody
complained about.

**The span is PER ROW because the rows do not cover the same range.**
A single global span was tried first and was wrong: the tile crash is
gated at closing speed 4 and reaches `dv` 30, while the shard row is
gated at 1.2 (a loose rock is audible long before it is destructive) and
tops out near `dv` 7. Normalising both by 18 pinned essentially every
shard contact to its floor — a voice with no dynamics at all, which is a
worse outcome than the loudness it was fixing. Each row now uses the
range it can actually reach, so "harder is louder" holds WITHIN a row,
while the absolute ordering BETWEEN rows stays where the `mix` column
puts it.

What the model gives up is discrimination above a row's span: past it the
ear is already at full gain, so the camera can separate a hard crash from
a catastrophic one and the ear cannot. Accepted deliberately — the only
way to recover it on the tile row is to re-tune the wall, which costs the
parity above.

**Pitch.** `pitch = clamp((25 / m) ^ 0.25, 0.70, 1.60)` — from MASS, not
from size.

Gain says how hard, pitch says how big, and because mass is already the
term inside `I` the two cues cannot disagree with each other or with the
camera. Shard mass goes as `size²` for every variant, so *within* one
material this reproduces the `√(38 / size)` law the caller ships today (a
40 px rock lands on 0.97 either way); *across* materials it is strictly
better, because a 40 px metal shard is 1.7× the mass of the same-size
rock and should knock lower as well as louder. `25` is the reference
mass — the mass that plays a take at its native pitch, roughly a 37 px
rock shard. A static tile has no finite mass and takes no mass-pitch:
`crash.player.tile` keeps its fixed voice and its ±8 % jitter.

**Worked numbers.** Closing speed |v_n| = 20 against the stock 100-mass
hull. The `dv` column is `COLLISION_CONFIG.SHAKE`'s own output,
unchanged — that it is also the gain column is the whole point.

| impactor | mass | dv (= shake) | gain (shard span 6) | pitch |
|---|---|---|---|---|
| static tile | ∞ | 30.0 (capped) | 1.00 (tile span 18) | fixed voice, ±8 % |
| 40 px metal shard | 48 | 12.3 | 1.00 | 0.85 |
| 40 px rock shard | 28.8 | 10.5 | 1.00 | 0.97 |
| 25 px rock shard | 11.2 | 7.5 | 1.00 | 1.22 |
| 15 px glass shard | 2.25 | 3.9 | 0.65 | 1.60 (clamped; raw 1.83) |
| 8 px glass chip | 0.64 | 2.2 — under `IMPACT_DV_MIN`, camera silent | 0.37 | 1.60 (clamped; raw 2.50) |

The same rows at the gentler contact speeds the shard voice actually
lives at — `|v_n|` = 4, which is where most hull-brushing happens:

| impactor | dv | gain |
|---|---|---|
| 40 px metal shard | 2.5 | 0.41 |
| 40 px rock shard | 2.1 | 0.35 |
| 25 px rock shard | 1.5 | 0.25 (floor) |
| 8 px glass chip | 0.4 | 0.25 (floor) |

The chip row is the model working, not failing: a body too light to move
the camera is still *heard*, because it did touch the hull — quietly at
brushing speed, and never at the masonry level whatever speed it arrives
at. Below the floor there is deliberately no loudness discrimination
left; pitch carries the difference instead.

The same line for `crash.player.enemy` (span 12) at `|v_n|` = 20, over
the roster's hull masses: gnat (4) → gain 0.42 / pitch 1.58 · Drone
(10) → 0.60 / 1.26 · Tank (18) → 0.74 / 1.09 · Turret (50) → 1.00 /
0.84 · Warden (140) → 1.00 / 0.70 · Bastion (200) → 1.00 / 0.70 ·
Dragon (500) → 1.00 / 0.70. Ramming a gnat and ramming a Bastion are
now different events to the ear, where this row previously passed no
per-instance parameters at all.

**Per-row floors.** The floor is the audibility guarantee for a contact
too light to earn gain on its own; it is the only per-row freedom in the
model.

| id | self | other | floor | gate (unchanged) |
|---|---|---|---|---|
| `crash.player.tile` | player | static tile (∞) | 0 — the gate already puts the quietest hit at 0.33 | `impactSpeed > CRASH_VELOCITY_THRESHOLD` (4) |
| `crash.player.shard` | player | mobile shard | 0.25 | `impactSpeed > SHARD_CONTACT_SPEED` (1.2) |
| `crash.player.enemy` | player | enemy hull | 0.30 — tier 1, must always read | `abs(v_n) > 2.0` |
| `crash.shard.tile` | the SHARD being voiced | tile or other shard | 0.20 | momentum threshold (still unwired) |

**The gate stays a SPEED gate.** Whether a contact is heard at all is a
contact question — `crash.player.shard` firing at 1.2 while the wall
needs 4 is the whole reason the two voices were split, and a `dv` gate
would silence exactly the pebble bumps it exists for. Only the CURVE
above the gate moves to `I`.

**`crash.shard.tile` generalises rather than special-cases.** It has no
player in it, so `self` is the shard whose break is being voiced and
`other` is what it hit; against a static tile `effInv(other) = 0`, the
shard takes the whole step, and the expression is the wall case again
with the shard in the player's seat. Nothing about the model is
player-specific — it is only ever used from the player's seat today.

**Range and attribution are orthogonal to intensity, and stay exactly as
§3 states them.** `I` sets how loud a hit is at the listener; the
near-field radii (`SHARD_NEAR_RADIUS` / `SHARD_FAR_RADIUS`, 240/850) set
how far it carries, and the `killedByPlayer` exception promotes a break
to normal radius. A player-attributed shard break is not made LOUDER by
the stamp — it is made AUDIBLE FURTHER. Do not fold one into the other:
gain answers "how hard was that", radius answers "is that mine".

**Out of scope, stated so it is not inferred.** The `impact.*` rows are
PROJECTILE hits routed through `handleProjectileHit`; their intensity is
DAMAGE, not a collision step, and they keep their flat per-row gains.
`move.dent` fires from `DropSystem.spawnDentShard` for crash-driven and
shot-driven dents alike and cannot tell them apart at the call site, so
it stays flat until it can. Impact-KILLED destruction (`destroy.tile.*` /
`destroy.shard.*` reached via `PhysicsSystem.killStructureByImpact`)
already carries `lastImpactDamage`, a 1..5 grade of how far over the
break threshold the hit was, and that — not `I` — is the quantity a
future intensity pass on those rows should read.

**Wiring status.** The two live call sites still pass the OLD
speed-derived values: `crash.player.tile` passes
`min(1, impactSpeed / (CRASH_VELOCITY_THRESHOLD × 3))` and no pitch,
`crash.player.shard` passes `clamp(impactSpeed / 8, 0.25, 1)` with
`clamp(√(38 / size), 0.7, 1.6)`, and `crash.player.enemy` passes no
options at all. Landing this section needs no signature change anywhere:
`PhysicsSystem.resolveCollision` already computes this exact `dv` in its
shake block (search `Detect High Impact for Shake`), the crash-audio
block is further down the same function with `velAlongNormal`,
`player.mass` and `structure.mass` all in scope, and
`this.sfx?.(id, x, y, { gain, pitch })` already carries both fields. Hoist
the `dv` computation above both blocks and read it from each.


---

## 5. Destruction

The single densest part of the mix, and the one most in need of the
`+gain` collapse rule (§3): a merged rock parent shattering can emit 40
fragment deaths in one step. Every row here collapses.

Wiring point: **`GameEngine.handleEntityDeath`**, which already
dispatches by entity class and shard variant.

### 5.1 Material destruction

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `destroy.tile.glass` | `handleEntityDeath`, `glass-tile` | 2 | 380 | Shatter — a spray of crystalline fragments over a short crack. Still the most sparkle of any material, pitched down out of the fatiguing band. | crack 2 kHz BP 1→45, then noise BP 1.5→2.4 kHz granular tail 10→360 | pitch ±10%, grain seed | 3, ≥90 ms **+gain** | 0.46 | world |
| `destroy.tile.rock` | same, `rock-tile` | 2 | 340 | Dry crumble. Stone cracking then gravel falling. Body, no ring. | 120 Hz crack 2→90 + noise LP 3 kHz decaying 8→320 | pitch ±10% | 3, ≥90 ms **+gain** | 0.44 | world |
| `destroy.tile.metal` | same, `metal-tile` | 2 | 480 | Structural failure — a bending groan into a deep clanging break, with an inharmonic tail that hums on. | 110/166/244 Hz inharmonic cluster 2→480 + LP noise burst 1→140 | pitch ±8% | 3, ≥110 ms **+gain** | 0.50 | world |
| `destroy.tile.plastic` | same, `plastic-tile` | 2 | 260 | Snapping crack — brittle, deadened, no tail. | 600 Hz snap LP 2 kHz; 1→230 | pitch ±12% | 3, ≥80 ms **+gain** | 0.38 | world |
| `destroy.tile.nebula` | same, `nebula-tile` | 3 | 500 | Dissipating gas sigh. Airy, pitchless, slow. Fires very often in nebula fields — keep it near-subliminal. | noise BP 600 Hz sweeping down; 40→480 | pitch ±16% | 3, ≥140 ms **+gain** | 0.16 | world |
| `destroy.shard.glass` | same, `glass-shard` (**near-field** unless `killedByPlayer`) | 3 | 200 | The tile sound, smaller and thinner. A tinkle rather than a shatter. | noise BP 2.1→2.7 kHz + 1.5 kHz partial; 2→200 | pitch ±14% | 4, ≥50 ms **+gain** | 0.22 | world |
| `destroy.shard.rock` | same, `rock-shard` (**near-field** unless `killedByPlayer`) | 3 | 190 | Small stone crack. | as tile ×0.5 dur, +35% pitch | pitch ±14% | 4, ≥50 ms **+gain** | 0.22 | world |
| `destroy.shard.metal` | same, `metal-shard` (**near-field** unless `killedByPlayer`) | 3 | 250 | A small clonk with a brief hum. | noise BP 850→620 Hz Q2.5 + 300 Hz partial; 2→250 | pitch ±12% | 4, ≥50 ms **+gain** | 0.24 | world |
| `destroy.shard.plastic` | same, `plastic-shard` (**near-field** unless `killedByPlayer`) | 3 | 160 | Tiny dead snap. | as tile ×0.55 dur, +40% pitch | pitch ±14% | 4, ≥50 ms **+gain** | 0.18 | world |
| `destroy.shard.nebula` | same, `nebula-shard` (**near-field** unless `killedByPlayer`) | 3 | 280 | Faint puff. | as tile ×0.5 dur | pitch ±18% | 4, ≥70 ms **+gain** | 0.12 | world |

### 5.2 Ship destruction

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `destroy.enemy.small` | `handleEntityDeath`, `SWARM` (and any `diesOnContact` gnat) | 2 | 120 | A pop. Dry, insectile, almost comic. Dozens fire at once against a flock — this row lives or dies on the collapse rule. | 500→200 Hz blip + noise 1→100 | pitch ±18% **(required)** | 4, ≥40 ms **+gain** | 0.26 | world |
| `destroy.enemy.standard` | same, RAMMER_1/2, SHOOTER_1/2/3, BULWARK, TURRET, NEST | 2 | 340 | The workhorse kill. Compact explosion: transient crack, short low body, fizzing debris tail. | 90 Hz sine 2→280 + noise LP 3 kHz 1→300 | pitch ±10% **(required)** | 4, ≥100 ms **+gain** | 0.48 | world |
| `destroy.enemy.heavy` | same, RAMMER_3 (Tank) and anything with `poise` | 2 | 520 | A bigger, slower version with an audible structural collapse after the bang. Reads as "that one was tough". | 60 Hz sine 3→460 + metal groan 240 Hz 40→400 + noise tail | pitch ±8% | 3, ≥180 ms | 0.60 | world |
| `destroy.enemy.kamikaze` | `handleEntityDeath` detonation branch (`detonateOnDeath`) | 1 | 620 | A real bomb. Deep, wide, with a pressure-wave whoosh trailing the crack. This one always cuts through — it is often the reason the player just lost half their hull. | 45 Hz sine 2→560 + noise LP 4 k→300 sweep 1→520 | pitch ±6% | 2, ≥300 ms | 0.82 | world |
| `destroy.enemy.bubble` | `handleEntityDeath`, `BUBBLE` | 2 | 300 | Wet burst. A soft membrane giving way — squelch, not explosion. Nothing else in the game sounds like this. | 220→80 Hz sine glide + comb noise; 3→270 | pitch ±14% | 3, ≥120 ms | 0.40 | world |
| `destroy.rival` | `handleEntityDeath`, `isRival` | 1 | 480 | A player-ship death, heard from outside: the same voice as `destroy.player` but distant and without the sting. | as `destroy.player` ×0.8 gain, no sting layer | pitch ±6% | 2, ≥250 ms | 0.58 | world |
| `destroy.player` | `handleEntityDeath`, `EntityType.PLAYER` | 1 | 1400 | The run-ending sound. Sharp explosion into a long descending hum that fades to nothing, with a short low sting under it. Should feel final and slightly sad, not triumphant. | 70 Hz blast 2→700; 400→60 Hz descending sine 30→1300; sub sting 40 Hz | none (unique event) | 1 (singleton, ducks everything) | 1.00 | flat |

### 5.3 Dragon and boss

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `destroy.dragon.segment` | `GameEngine.dragonSegmentDeath` | 2 | 300 | The material's own break sound with a fleshy underlayer — you broke a piece off something alive. | material `destroy.shard.*` + 140 Hz thud 2→260 | pitch ±10% | 3, ≥100 ms **+gain** | 0.44 | world |
| `destroy.dragon` | `GameEngine.dragonDeath` | 1 | 1600 | A death roar collapsing into a rift implosion. Long, layered, unmistakable — the biggest non-boss payoff in the game. | 90→35 Hz growl 40→900; reverse-swell noise into 1.1 s implosion crack | none | 1 (singleton) | 0.92 | world |
| `boss.phase` | `GameEngine.applyBossPhase`, index > 0 | 1 | 900 | A gear change — plating blowing off, a rising alarm swell, then a harder mechanical lock. Must interrupt the fight's rhythm. | rising 200→800 Hz saw swell 300→600 + 60 Hz impact at 500 ms | none | 1 (singleton) | 0.80 | world |
| `boss.intro` | `WaveSystem.startWave` boss branch, alongside `onBossSpawn` | 1 | 1800 | Arrival. A low descending drone under a rift tear, ending on a single hard hit that lands with the banner. | 130→50 Hz drone 200→1500; noise tear 400→1200; 45 Hz hit at 1500 ms | none | 1 (singleton) | 0.88 | flat |
| `boss.death` | `GameEngine.payBossBounty` | 1 | 2200 | The payoff. Multi-stage: the kill blast, a beat of near-silence, then a rising bright chord as the salvage sprays. Earned, not just loud. | 50 Hz blast 2→800; 600 ms gap; major-triad pad 440/554/659 Hz 200→1200 | none | 1 (singleton, ducks tier 2/3) | 1.00 | flat |

---

## 6. World, movement, and materials

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `move.thrust` | `updateGameLogic`, ALWAYS ON while alive; stops on death / pause / dock | 2 | **L** | Continuous engine rumble that **idles rather than switching on**. Throttle swells an already-running bed — gating the whole loop on `throttle > 0` snapped on and off with the input and read as jarring. Gain *and* cutoff move together (volume alone reads as a fader; timbre too reads as an engine working harder), both heavily smoothed. Must be *bland* — it plays constantly and any character in it becomes torture within five minutes. | noise LP 90 Hz (idle) → 850 Hz (full) + 36 Hz sine bed; gain 0.38→1.0 of mix; both `setTargetAtTime` τ = 0.22 s | none (continuous) | 1 (singleton) | 0.22 | flat |
| `move.dent` | `DropSystem.spawnDentShard` (plastic / metal / rock dent) | 3 | 140 | A single deforming knock. Softer than a break — nothing was destroyed. | 260 Hz LP 900 Hz; 2→120 | pitch ±14% | 4, ≥60 ms **+gain** | 0.20 | world |
| `move.dent.recover` | `ShardSystem` plastic dent snap-back | 3 | 180 | Reverse of the dent — a rubbery *boink* as the shape springs back. | 200→320 Hz up-glide; 3→160 | pitch ±14% | 3, ≥100 ms | 0.16 | world |
| `move.tilesnap` | `ShardSystem` shard→tile snap (`TILE_SNAP` path), **near-field** | 3 | 260 | Crystallisation — fragments locking into a solid. A warm rising swell resolving on a soft thunk. Metal assembles constantly, so this fires in BULK: it must not stack into a whine. | noise BP 380→820 Hz swell 10→200 + 130 Hz thunk at 200 ms | pitch ±10% | 2, ≥200 ms | 0.28 | world |
| `move.merge` | `ShardSystem.composeEntities` (bond forms). **NOT CURRENTLY WIRED** — same reasoning as `crash.shard.tile`. | 3 | 150 | Two things becoming one — a short gluey suck with a soft landing. Very quiet; this fires all the time in a shard field. | 400→180 Hz glide, LP 1.2 kHz; 5→130 | pitch ±16% | 3, ≥120 ms **+gain** | 0.12 | **near-field** |
| `move.regenpop` | `ShardSystem` regen completion (`regenPopTimer` set) | 3 | 200 | A gentle materialising pop — something came back. Friendly, not alarming. | 300→700 Hz up-blip + soft noise; 3→170 | pitch ±12% | 3, ≥120 ms **+gain** | 0.18 | world |

---

## 7. Pickups, stations, portals, waves

### 7.1 Pickups

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `pickup.salvage` | `GameEngine.applyDropEffect`, `dropType === 'salvage'` | 1 | 130 | Bright metallic *ching*. Money. Two quick partials, clean and satisfying, no tail. | 1180 Hz + 1770 Hz; 1→110 | pitch ±5%, **+1 semitone per pickup inside 1.5 s, resetting after** — a run of pickups climbs a scale | 5, ≥50 ms | 0.44 | world |
| `pickup.health` | same, `dropType === 'health'` | 1 | 260 | Warm ascending two-note figure. Restorative, softer than salvage, unmistakably different. | 520→780 Hz sine pair; 5→240 | pitch ±4% | 3, ≥120 ms | 0.48 | world |
| `pickup.merge` | `DropSystem.mergeDrops` fusion | 3 | 90 | A tiny sub-click confirming two drops became one. Nearly inaudible by design. | 800 Hz click LP; 1→70 | pitch ±16% | 2, ≥150 ms | 0.08 | world |

### 7.2 Station and commerce

All `flat` — these fire with the sim frozen and a full-screen UI up.

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `poi.dock` | `GameEngine.dockAtStation` | 1 | 700 | Clamps engaging — a mechanical descending sequence ending in a solid latch. Says *safe now*. | 400→160 Hz stepped glide 3 steps; 60 Hz latch thunk at 550 ms | none | 1 | 0.55 | flat |
| `poi.undock` | `GameEngine.undock` | 1 | 500 | Release and pressurise — the dock sound reversed, ending on a rising hiss. | 160→400 Hz stepped; noise hiss tail 200→480 | none | 1 | 0.50 | flat |
| `poi.purchase` | `GameEngine.purchaseModule` success | 1 | 340 | Transaction confirmed — a bright two-note rise with a coin-ish edge. Should feel good enough to want again. | 660→990 Hz; 2→300 | none | 1, ≥150 ms | 0.50 | flat |
| `poi.sell` | `GameEngine.sellModule` success | 2 | 300 | The purchase figure inverted — descending, slightly duller. You gave something up. | 990→660 Hz; 2→270 | none | 1, ≥150 ms | 0.42 | flat |
| `poi.scrap` | `GameEngine.scrapModule` success | 2 | 380 | Grinding destruction — a short shredder rasp resolving on a small chime for the credits. Audibly worse than selling, matching the 9% rate. | noise BP 1.5 kHz rasp 5→260; 880 Hz chime at 260 ms | none | 1, ≥150 ms | 0.42 | flat |
| `poi.module.install` | `GameEngine.moveModule` success into a ship/weapon hex | 1 | 220 | A firm seat-and-lock. Two-stage: slide, then click. Tactile. | noise slide 8→90; 1.3 kHz click at 100 ms; 1→110 | pitch ±4% | 2, ≥80 ms | 0.44 | flat |
| `poi.module.stow` | `moveModule` success into inventory | 2 | 160 | Softer version of install — a padded set-down, no lock. | LP 700 Hz thunk; 2→140 | pitch ±6% | 2, ≥80 ms | 0.30 | flat |
| `poi.reject` | any commerce/outfit call returning `false` (undocked move, full inventory, gun cap, insufficient credits) | 1 | 200 | A flat descending two-tone buzz. Clearly negative, not harsh. Fires often while the player learns adjacency rules — it must not be irritating. | 330→220 Hz square LP 900 Hz; 1→180 | none | 1, ≥250 ms | 0.38 | flat |
| `poi.repair` | `GameEngine.repairHull` success | 1 | 600 | A working repair: a brief welding/servo texture resolving on the same warm figure as `pickup.health`, so hull restoration has one identity. | noise BP 2 kHz stutter 0→380; 520→780 Hz pair at 380 ms | none | 1 | 0.50 | flat |

### 7.3 Portals

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `portal.idle` | `updateInteractables`, driven by the NEAREST portal at any distance; stops beyond earshot | 2 | **L** | A LOW tonal hum that throbs. Two detuned sines beating slowly, plus a breath of heavily-lowpassed air — motion without brightness. Deliberately TONAL, against the station's broadband bed, so the two POIs are tellable apart by ear. **The first draft layered a 3 kHz Q3 noise shimmer on top and that was the whine players reported** — a ringing noise band held continuously is the most fatiguing thing audio can do. | 55 + 56.5 Hz sines (1.5 Hz beat) + 110 Hz partial; noise LP 220 Hz at low gain with a 0.13 Hz cutoff drift | none | 1 (singleton) | 0.24 | world, 300/1600 |
| `poi.station.idle` | `updateInteractables`, driven by the NEAREST station at any distance; stops beyond earshot | 2 | **L** | LOW WHITE NOISE — a big machine idling. Broadband and pitchless, with a slow cutoff drift so it moves rather than sitting as flat hiss, and a faint mains hum underneath so it reads as machinery rather than weather. The deliberate opposite of the portal's tonal hum. | noise LP 300 Hz (±90 Hz drift at 0.09 Hz) + 48 Hz hum | none | 1 (singleton) | 0.20 | world, 420/2200 |
| `portal.transit` | `GameEngine.transitionToMap` / `openPortal` on an actual travel | 1 | 1100 | Being pulled through: a rising whoosh that snaps into a brief silence, then a soft arrival bloom on the far side. Handles the whole cut — no separate arrival cue needed at the trigger site. | 200→3 kHz noise sweep 0→600; 80 ms gap; 400 Hz pad bloom 100→400 | none | 1 (singleton) | 0.68 | flat |
| `portal.open` | `openPortal` when a roamer arrives/leaves (dragon, rival) | 2 | 800 | A rift tearing open at a distance — the transit sound heard from outside, shorter and darker. | 150→1.2 kHz sweep 10→400 + 70 Hz rumble 20→700 | pitch ±6% | 2, ≥400 ms | 0.44 | world |

### 7.4 Waves

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `wave.start` | `WaveSystem.startWave` announcement push | 1 | 900 | Alert — two hard low hits under a short rising tone. Militaristic, brief, lands with the banner. | 90 Hz hits at 0 and 260 ms; 330→660 Hz tone 260→800 | none | 1 (singleton) | 0.62 | flat |
| `wave.clear` | `GameEngine.playWaveClearCelebration(false)` | 1 | 1300 | Relief and reward — a bright ascending arpeggio over a swelling pad, landing with the shockwave ring. | 523/659/784/1047 Hz arpeggio 120 ms apart; pad 261 Hz 100→1200 | none | 1 (singleton) | 0.72 | flat |
| `wave.clear.snitch` | `playWaveClearCelebration(true)` | 1 | 1400 | The clear figure in gold — same shape, brighter and with a shimmering top, because the snitch ended it. | as `wave.clear` +5 semitones, + 4 kHz shimmer bed | none | 1 (singleton) | 0.72 | flat |
| `wave.grace` | grace countdown entered (`endWave`) | 3 | 500 | A quiet exhale. Marks the breather without demanding attention. | 200 Hz pad, LP 800 Hz; 100→450 | none | 1 | 0.20 | flat |

---

## 8. Roamers, status effects, UI

### 8.1 Roamers

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `snitch.near` | `updateSnitch`, snitch within ~1200 units; stops beyond | 2 | **L** | A delicate, wandering shimmer — still the brightest SUSTAINED sound in the game, because it is a carrot and should glitter, but pitched down out of the fatiguing band. A tone held indefinitely is judged far more harshly than the same tone in a one-shot. | 0.9–1.2 kHz sine, LFO drift 0.25 Hz | continuous drift | 1 (singleton) | 0.16 | world |
| `snitch.dart` | `updateSnitch` burst/panic dart begins | 2 | 240 | A quick whipping *swish* — it just bolted. | noise BP 2 k→5 kHz sweep; 2→220 | pitch ±10% | 2, ≥180 ms | 0.30 | world |
| `snitch.catch` | `GameEngine.catchSnitch` | 1 | 1500 | The best sound in the game. A crystalline capture chime blooming into a bright rising cascade as the board clears and salvage sprays. | 1568 Hz strike 1→200; cascade 784/1047/1319/1568/2093 Hz 80 ms apart; shimmer bed 200→1400 | none | 1 (singleton, ducks tier 2/3) | 0.95 | flat |
| `dragon.arrive` | `GameEngine.spawnDragon` / `openDragonPortal` | 1 | 1600 | A distant, enormous roar through a tearing rift. Should make the player look up. | 60→110 Hz growl with formant sweep 100→1200; rift noise 200→1000 | none | 1 (singleton) | 0.72 | world |
| `dragon.provoked` | dragon `provoked` flips true | 1 | 900 | A shorter, angrier roar. The fight just started. | 90→140 Hz growl, faster formant sweep; 40→800 | none | 1, ≥1000 ms | 0.66 | world |
| `dragon.leave` | `GameEngine.despawnDragon` (exit rift swallow) | 2 | 1200 | The arrival reversed — a receding roar sucked into the rift. | reverse of `dragon.arrive`, −20% gain | none | 1 | 0.50 | world |
| `rival.warp.in` | `GameEngine.spawnRival` | 2 | 700 | A short sharp rift crack with a ship-engine tail spinning up. Compact — several can be alive. | noise crack 1→80; 200→600 Hz engine spin-up 80→650 | pitch ±8% | 2, ≥400 ms | 0.42 | world |
| `rival.warp.out` | rival `ROAM_DURATION` expiry despawn | 2 | 600 | Spin-down and crack, reversed. | reverse of `rival.warp.in` | pitch ±8% | 2, ≥400 ms | 0.38 | world |
| `rival.steal` | `handleEntityDeath` with `killedByRival` (the player was denied) | 2 | 320 | A sour, deflating two-note fall. Small but pointed — the player should feel robbed. | 520→330 Hz detuned pair; 2→290 | pitch ±5% | 2, ≥250 ms | 0.36 | world |
| `bubble.latch` | `updateBubbles` latch formed (`attachedToId` set) | 1 | 400 | A wet suction grab. Uncomfortable. The player must instantly know something is on them. | 300→120 Hz glide + comb noise squelch; 5→370 | pitch ±10% | 2, ≥300 ms | 0.58 | world |
| `bubble.drain` | while a latch is active on the player; stops on `detachLatch` | 1 | **L** | A pulsing wet drain with an EMP crackle riding on it. Loops until shaken off, so keep it rhythmic rather than continuous — a pulse is easier to tolerate and reads as damage ticks. | 90 Hz pulse at 3 Hz + noise HP 4 kHz crackle bursts | none | 1 (singleton) | 0.34 | world |
| `bubble.detach` | `GameEngine.detachLatch` | 2 | 300 | A release pop with a sick wobble — it fell off and it's unwell. | 200→90 Hz down-glide + vibrato; 2→270 | pitch ±10% | 2, ≥200 ms | 0.36 | world |

### 8.2 Status effects

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `status.corrosion.apply` | `GameEngine.applyStatusEffect`, `'corrosion'` (incl. each new stack) | 1 | 380 | Acid bite — a hissing sizzle with a sour descending edge. Pitch rises one step per stack so three stacks are audible as three. | noise BP 2.5 kHz sizzle 2→350; 400→300 Hz sour tone; +80 Hz per stack | +stack pitch step | 2, ≥250 ms | 0.46 | flat |
| `status.disable.apply` | same, `'disable'` (EMP) | 1 | 500 | Systems dropping — a descending power-down whine that ends dead. The player is about to press fire and get nothing; this is the warning. | 900→80 Hz saw glide; 1→460, hard cutoff | none | 1, ≥400 ms | 0.58 | flat |
| `status.disable.loop` | while `systemsDisabled`; stops when it clears | 2 | **L** | A dead-air hum with intermittent failed-relay clicks. Uncomfortable emptiness. | 60 Hz hum + random 1.2 kHz clicks at 1–3 Hz | random click timing | 1 (singleton) | 0.24 | flat |
| `status.expire` | any status effect drops off | 2 | 260 | A clean recovering rise — systems back. | 300→700 Hz sine; 3→230 | none | 1, ≥200 ms | 0.34 | flat |

### 8.3 UI

All `flat`, all short, all quiet. These play over menus where nothing
else is making noise, so they read louder than their gain suggests.

| id | trigger | tier | dur | character | freq / env | var | poly / throttle | mix | pos |
|---|---|---|---|---|---|---|---|---|---|
| `ui.nav` | menu button press / section expand in `UIOverlay` | 2 | 60 | A soft muted tick. Neutral. | 1.1 kHz LP 2 kHz; 1→45 | pitch ±6% | 2, ≥50 ms | 0.24 | flat |
| `ui.confirm` | primary action (start game, resume, difficulty set) | 2 | 180 | A clean rising two-note. Positive, understated. | 660→880 Hz; 2→160 | none | 1, ≥120 ms | 0.34 | flat |
| `ui.back` | pause open / close, panel dismiss | 2 | 160 | The confirm figure descending. | 880→660 Hz; 2→140 | none | 1, ≥120 ms | 0.30 | flat |
| `ui.error` | disabled control pressed in a menu | 2 | 180 | Same voice as `poi.reject` at lower gain, so "no" sounds the same everywhere. | as `poi.reject`, ×0.7 gain | none | 1, ≥250 ms | 0.26 | flat |
| `ui.drag.pick` | module drag begins (hex or inventory tile) | 3 | 70 | A light lift-off tick with a tiny upward blip. | 900→1100 Hz; 1→55 | pitch ±8% | 2, ≥60 ms | 0.20 | flat |
| `ui.drag.drop` | drag released on a valid target (before `poi.module.*` fires) | 3 | 80 | A light set-down tick, the pick reversed. | 1100→900 Hz; 1→65 | pitch ±8% | 2, ≥60 ms | 0.20 | flat |

---

## 9. Where to spend an external generation budget

Ranked. The top of this list is where procedural synthesis is weakest
relative to how much the sound matters.

1. **`destroy.player`** — the run ends on it. Synthesis gives a
   generic boom; this wants composition.
2. **`snitch.catch`** — the game's single best moment, and a cascade
   chime is exactly what additive synthesis does worst.
3. **`boss.death`** and **`boss.intro`** — multi-stage, dynamic, and
   currently the least convincing drafts.
4. **`dragon.arrive` / `dragon.provoked`** — a creature roar has formant
   structure that oscillators cannot fake.
5. **`destroy.tile.glass`** — the most-heard destruction sound and the
   one players judge material feel by. Granular shatter needs real
   recordings.
6. **`weapon.cannon.fire` / `weapon.shotgun.fire`** — heard thousands of
   times per run; the drafts are serviceable but thin, and weapon feel is
   the game's core loop.
7. **`move.thrust`** — a loop that plays for the entire session. The
   quality bar is *tolerability*, and a real recording tolerates far
   better than filtered noise.
8. **`bubble.latch` / `bubble.drain`** — organic wetness is out of reach
   procedurally; the drafts read as electronic rather than alive.

Everything else is fine as a draft, or benefits little from an upgrade
(the UI ticks in particular should stay synthetic and clinical).

---

## 10. Adding a sound

1. Add a row here first, with a real id and real parameters. The
   inventory is the source of truth, not the code.
2. Register the synth function in `engine/systems/AudioSystem.ts` under
   that id.
3. Call `audio.play(id, opts)` at the trigger named in the row. Nothing
   else in the engine imports `AudioSystem` state.
4. If the row is a loop, use `audio.loop(id, on, opts)` — the manager
   owns start/stop idempotently, so the call site can fire it every step
   without checking.
