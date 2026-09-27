# Omni — Parking Lot

Ideas worth revisiting but not blocking current work.
Add entries freely; revisit during planning.

---

## Controller schemes — refinement pass (parked 2026-08-15)

> **Now THREE pad schemes, not two** (2026-08-19): `gamepad-left` joined
> `gamepad` and `gamepad-thrust`, and it is as untuned as the other two.  It
> shares `stickAims` + `fireFace` with `gamepad-thrust`; what separates them is
> that it KEEPS the stick's magnitude as the throttle where trigger-thrust
> discards it.  Both leave the triggers slack (`usesFaceFire()` gates the weapon
> profile off), so the adaptive-trigger questions below apply to plain `gamepad`
> only.  A fourth axis to feel out: is one-thumb flying actually playable, or
> does aim-where-you-fly cost too much when something is behind you?


All three pad schemes are SHIPPED AND UNTUNED. The wire format is settled
(`zones`, confirmed on hardware) and the plumbing is covered by tests, but
every judgement call below was made without a pad in hand and none of it has
been felt. Parked deliberately: these are looking-and-feeling questions, and
guessing at them from here is how G12 shipped three bugs.

### PS5 / full-pad scheme (`gamepad`)

The seven adaptive-trigger profiles in `WEAPON_TRIGGERS` plus the two
state-driven ones (`chargeTrigger`, `THRUST_TRIGGER`) are authored, not
tuned. Open:

- **Is the Blaster's rattle better than a click?** It fires 7x/s, so a click
  is fatigue — but a low-frequency `vibration` may just read as mush. This is
  the single most likely wrong call in the table.
- **Do Burst's three notches read as three?** `texture` quantises to ten
  travel zones; three notches inside one pull may blur into one texture.
- **Is the Cannon's ramp a deep pull or just heavy?** And does Homing's
  shallower ramp feel distinct from it, or are two `slope` guns one gun?
- **Do the state-driven pair land?** Does the charge wall growing under the
  finger read as CHARGING, and does the thrust trigger stiffening near the
  cap read as SPEED? Both are quantised to five steps — possibly too coarse
  to feel as a ramp, possibly too fine to be worth the HID writes.
- **Fire point.** It tracks each profile's break, clamped to 0.25–0.75. Are
  the clamps in the right place, and does a shape with no break (`resistance`,
  `vibration`) firing at its START feel right, or should it also fire deep?

Every number is in `constants.ts`; the shapes are in
`engine/systems/DualSenseHID.ts`. The `simple` encoding stays on the DBG
cycle in case a firmware disagrees.

### Minimal-pad scheme (`gamepad-thrust`)

Built for cheap clip-on Bluetooth pads: EITHER stick steers and aims (larger
deflection wins), EITHER trigger throttles, and the gun is therefore on the
FACE button — if either trigger may be the throttle, neither can be the gun.
Open:

- **Does the premise hold?** Stick-for-heading + trigger-for-throttle versus
  the stick doing both. The whole scheme rests on this and it may simply feel
  worse.
- **Both sticks doing the same job** — forgiving, or sloppy? On a full pad
  the right stick now flies rather than aims, which is a real change in what
  a DualSense feels like under this scheme.
- **Losing R2-as-gun on a full pad.** Plain `gamepad` is the escape hatch,
  but if the trade annoys, the alternative is a third scheme (left trigger
  throttles, right trigger fires) — which is more schemes for one axis of
  difference, and worth resisting unless the feel demands it.
- **Aim-where-you-fly.** Correct for a one-stick pad, but on a two-stick pad
  it discards independent aim entirely. Possibly the scheme should use the
  second stick for aim WHEN it is present — except "present" is not
  detectable (see below), so it would have to be inferred from use.
- **No device detection is possible.** The Gamepad API reports a fixed 17
  buttons under the standard mapping whether or not the hardware has them, so
  "does this pad have an L2" is unanswerable. Anything adaptive here has to
  be inferred from what the player actually moves, which is a design in its
  own right.

### Related, already parked

The one-stick/two-button scheme below (its own entry) is the next step past
`gamepad-thrust` — same motivation, fewer controls still. If the minimal
scheme's premise holds, that entry gets easier; if it does not, both should
be reconsidered together.

---

## Minimal Bluetooth control style — one stick, two buttons (2026-08-15) — PARTLY SUPERSEDED

> **`gamepad-left` (2026-08-19) took most of the premise.**  The hard half of
> this entry — one stick doing heading, aim AND throttle together, with the gun
> moved to a face button — is shipped and testable: the left stick (or the left
> D-pad) writes the movement vector, its DIRECTION also writes the synthetic
> pointer so the ship aims where it flies, its MAGNITUDE stays the throttle, and
> the right stick is ignored rather than left to fight for the reticle.
>
> What survives here is the genuinely two-button case: weapon cycling on a hold
> (the shoot/charge precedent), PAUSE with no Options button (still the one real
> gap), and stick-based MENU NAV, since `menuNav` assumes a D-pad.  The reason
> to keep it parked is unchanged — nobody has one of these pads to test with.


A sixth control scheme for the smallest pads: **one analogue stick and two
buttons**, nothing else. The stick does aiming, flying AND acceleration
together; button A shoots and charges; button B is ACTIONS (dock / enter
portal / cycle weapon).

Why it is worth building: the cheap clip-on Bluetooth gamepads people
actually pair with a phone are frequently this shape, or close to it, and the
existing `gamepad` scheme assumes a full standard layout — two sticks, two
triggers, four face buttons, a D-pad. On a two-button pad most of that is
missing, and the parts that ARE missing are the ones the scheme leans on
hardest (the right stick IS the aim, since G2-a routed the pad through the
synthetic pointer).

What the design has to answer, and none of it is hard so much as it is a set
of decisions:

- **Two buttons for four actions.** Shoot and charge already share one
  control everywhere (`CHARGE_FULL` on a hold). Actions is the crowded one:
  dock / enter portal is already ONE arbitrated trigger (`updateInteractables`
  nearest-wins), which leaves weapon cycling. A hold on button B is the
  obvious answer and matches the shoot/charge precedent.
- **Pause with no Options button.** The one genuinely new gap. Either a
  two-button chord, a long hold on B, or accept that pause is a screen tap on
  a device that has a screen.

Cost is small because the pieces are all built: `CONTROL_SCHEME_RULES` gets a
row, `INPUT_CONSTANTS.GAMEPAD.BUTTONS` gets a remap, and the `pointerAims:
false` path is already exercised by two shipped schemes. The reason it is
parked rather than done is that **nobody has one of these pads to test with**,
and G12 is a standing lesson in what shipping an untestable input path costs.

Related: the gamepad menu navigation (G15) assumes a D-pad. A two-button pad
would need the stick as its nav source — worth doing anyway, since stick nav
is a ~10-line addition to `tickMenuNav` and is what most players will reach
for first.

---

## Bulwark difficulty note (level design)

**Context:** The BULWARK enemy (Stage 0 core roster) is a comparatively HARD
enemy and should be placed deliberately. Its rotating 150° arc shield (54
points, slow regen) tracks the player and DEFLECTS covered shots — so a
player attacking head-on with a chip weapon makes little progress and must
either flank to the open ~210° rear/sides or burn the shield down. Deflected
bolts also ricochet into nearby entities. Implications for future waves:

- Don't stack multiple Bulwarks facing a chokepoint — overlapping arcs can
  wall off an approach entirely for a low-DPS loadout.
- Pairs well as an "anchor" behind squishier shooters (the player must commit
  to a flank, exposing them to the escorts).
- Tune presence by count, not by nerfing the shield — it's a soft counter by
  design (flank / AoE / burst-through all beat it).
- Difficulty knobs live on the `BULWARK` ENEMY_VARIANTS entry: `shield`,
  `shieldRegen`, `shieldArc.deg` (coverage), `shieldArc.slew` (track speed).

---

## Generalize the projectile-deflection function — DONE (5d P2/P3)

`PhysicsSystem.deflectProjectile(proj, nx, ny, opts)` is the one reflection
primitive — the arc-shield intercept, every non-arc shield (at contact) and
the bouncer's tile face all call it — and `DeflectOptions` carries re-own /
speed-scale / spread / keepHoming; the player's shield uses the re-own as a
PARRY.  See CLAUDE.md §8 "EVERY live shield DEFLECTS".  Still unbuilt:
reflective tiles / mirror walls, a boss spin-reflect phase or a timed enemy
parry, and redirecting a NON-homing bolt at the nearest hostile rather than
mirroring it.

---

## Tile-mounted turret emplacements (Turret v2)

**Context:** Mount TURRET enemies (Stage 1) to the EXTERIOR tiles of clusters
on *designed* maps (not wave spawns) to make them terrain-integrated puzzle
emplacements rather than free-standing shooters. A mounted turret sits against
the exposed face of an exterior tile, can only fire OUTWARD (away from its
tile), and is only vulnerable from that same exposed arc — the tile/cluster
armors its back and flanks. Three clean counters:

1. **Flank** into the exposed arc and shoot it normally.
2. **Demolish the mount tile** → the turret loses its protection and dies to a
   single base-blaster shot ("exposed" state). Tiles regen, so this opens a
   timed window, then it re-armors.
3. **Lightning / AoE** hit it from any angle without breaking the tile (they
   bypass the directional gate — consistent with "AoE is the answer").

**Reuses what's already built:**
- **Directional gate, inverted.** `PhysicsSystem.shieldCoversHit` /
  `tryShieldDeflect` (the arc-shield intercept; was `tryArcShieldIntercept`)
  already gate whether a shot connects by bearing. A mounted turret is the
  same sector flipped to a *vulnerable* arc facing the exposed normal: shots
  from OUTSIDE the arc spark off the armored casing (deflect/no-op), shots
  from inside land. Best built on top of `PhysicsSystem.deflectProjectile`
  (shipped, 5d P2/P3).
- **Stationary AI.** Turret is already `maxSpeed:0` with the no-move branch —
  fixed mount position needs no physics changes. Aim is just clamped to the
  outward arc (it already rotates to track; bound the rotation so it holds fire
  when the player is behind the cluster).
- **Lightning/AoE bypass.** AoE already ignores shields; extend the same
  exemption (plus lightning) to the turret's directional gate.

**Genuinely new work:**
- **Tile↔turret link.** Add `mountTileId` (+ outward normal angle) on the
  turret; each step it reads the mount tile's alive state to toggle
  protected/exposed. ANSWERED: regen REUSES the same entity object
  (`ShardSystem.completeRegen`), so the id — and the link — survive.
- **Map placement.** No "place enemy X on tile Y" authoring path exists today
  (maps populate procedurally via `BaseMapLayer.populateTileClusters`). Add a
  pass that finds exterior cluster tiles (≥1 empty hex neighbour), picks an
  exposed face, and spawns a turret there facing the outward normal —
  density/placement as a per-map knob, since these are designed hazards.
- **Exposed-kill state.** A flag that, while the mount tile is gone, drops the
  directional gate AND makes the turret take full damage (≈1-shot feel).
- **Wave accounting.** As map features they must NOT count toward wave
  completion — set `countsTowardWave: false` (shipped in Stage 2b;
  `WaveSystem.countLiveTracked` honours it).

**Gotchas:** torus-correct the mount normal + bearing math (`wrapDeltaX/Y`);
mount on a predictable-regen tile variant (rock/metal) so the exposure window
behaves; a turret whose tile never regens (e.g. nebula-off) stays a one-shot
kill once broken — fine, but intentional. Both prerequisites (the deflection
helper and `countsTowardWave`) have shipped, so this is now mostly
composition.

---

## Trail Gradient Caching

**Context (updated 2026-09):** the PLAYER trail no longer uses a gradient —
it is stamped shapes, or per-segment strokes in PATH mode (`drawPlayerTrail`,
`engine/systems/render/effects.ts`).  The per-frame `ctx.createLinearGradient`
now lives in `drawTrailStrip` (same file): one per visible PROJECTILE trail
(bouncers excepted) and one for the snitch's comet tail.  Trail points move
every frame, so the gradient can't trivially be reused.  Measure a
projectile-heavy scene before doing anything.

**Options to explore:**
- Pre-render the trail to an offscreen canvas at a fixed orientation, then `drawImage` rotated.
- Only recreate the gradient when the trail length or heading changes significantly.
- Replace with a pre-computed alpha ramp applied to a solid-color polyline (saves gradient
  object creation at the cost of a slightly different look).

---

## Swarm gnat + Bubble — feel / tuning pass

**Context:** A fast iteration session reshaped the SWARM gnat default and built
out the BUBBLE into a full ambient third-party creature. The feel is broadly
GOOD as shipped — this is a low-priority "come back and polish the numbers"
item, not a redesign. Everything below is data-driven (constants), so tuning is
edit-and-playtest with no structural work.

**What changed this session (so the tuning has context):**
- **Swarm gnat default** → `weave` (serpentine), still DBG-cyclable (Enemies &
  Bosses ▸ Enemy Tuning ▸ "Gnat move").
- **Bubble** went from a simple wave enemy to **ambient flow-riding fauna**
  (`ambient` + `maintainAmbientBubbles`, never gates a wave) that is a **true
  third party** (`thirdParty`: enemy fire hits it; it retaliates against whoever
  last hit/rammed it). Eating became **pull-in → swallow-on-contact → digest
  over time with the shard visible dissolving inside** the transparent membrane,
  **mass/energy conserved** (`shardRichness`: denser shards = slower digest +
  more growth/heal). Added **sickness** (plastic / green-nebula = toxic, and
  post-latch) → green + sluggish + can't eat. Latch **no longer kills** — it
  EMPs + size-scaled drains, then **knocks free → sick** (timer / any projectile
  hit / player terrain-slam). Movement is **slow when passive, fast only when
  hunting** (aggro-only bursts/lunges). HP **50 base, maxHealth linear with
  size**. Starts **half size, grows slow**. Removed **health bars** (bubble) and
  **off-screen chevrons** (bubble + snitch) — the bubble's chevron was later
  RESTORED (purple, its own `MAX_VISIBLE_BUBBLE` budget, blinking red while it
  hunts the player); the snitch's was not.

**Tuning checklist (current values → things to feel out):**
- **Aggro triggers:** `BUBBLE_CONSTANTS.COLLIDE_AGGRO_SPEED` (3.5 — the
  "more than a light touch" ram threshold; watch for gentle grazes provoking, or
  hard rams not) · `AGGRO_LOSE_RANGE` (950 — leash) · `AGGRO_TIMEOUT_SEC`
  (6 — left alone this long, it calms).
- **Hunt speed / catch-ability:** `AI_CONFIG.BUBBLE.PROVOKED_SPEED_MULT` (2.2) ·
  `BURST_SPEED_MULT` (1.7) / `BURST_ACCEL_MULT` (2.2) / `BURST_INTERVAL` (1.6) /
  `BURST_DURATION` (0.6) / `SEEK_ACCEL_MULT` (1.4). If a fully-grown bubble runs
  the player down too easily, this is the knob.
- **Latch threat:** `LATCH_DURATION` (2.6) · `LATCH_DPS` (6 base, ×size/baseSize)
  · `KNOCK_SPEED` (6 — terrain-slam shake-off; verify it's reachable but not
  trivial) · `EMP_REFRESH` (0.4). NOTE the open question: a max-size bubble's
  size-linear maxHP (~190) + EMP-during-latch means you can't shoot it off, only
  terrain-slam or wait — consider a latch-HP cap or shorter latch if punishing.
- **Eating economy:** `consume.range` (150 sense) / `pull` (14) ·
  `DIGEST_DURATION` (5.5 base, ×richness) · `RICH_MIN/MAX` (0.6/2.0) ·
  `growthPerEat` (3) / `consume.maxSize` (58) · `HEAL_PER_RICH` (6) · base
  `health` (50) + the size-linear maxHP curve (`syncBubbleMaxHealth`).
- **Mouth size / bite:** `consume.swallowMaxFrac` (1) · `consume.bite`
  (damage 3, interval 1.2 s, reach 8, `tiles: true`) — bodies bigger than the
  mouth, and tiles, are chipped through `chipStructureAt` instead.
- **Toxic detection:** `isToxicShard` flags plastic + **green-dominant nebula**
  shards via a hex-channel check — if some green nebulae miss (or non-green trip
  it), switch to a specific nebula-variant/palette test instead.
- **Sickness:** `SICK_DURATION` (2.8) · `SICK_SPEED_MULT` (0.3) · `SICK_COLOR`.
- **Population / passive feel:** `AMBIENT_POPULATION` (5) ·
  `AMBIENT_RESPAWN_INTERVAL` (4) · `multiply.atSize` (50) / `maxPopulation` (14)
  · `DRIFT_SPEED` (2.2) · `SHARD_VISION` (280) · `CALM_VISIBILITY` (0.45).
- **Render polish (optional):** the squash-cling amount + EMP-arc look are
  inline in `drawEnemyShape`'s bubble branch (`render/enemyShapes.ts`); enemy
  latches get the squash but no arcs (arcs are the player-only EMP tell) —
  could add a chew FX for enemy latches.

**All knobs live in:** `AI_CONFIG.BUBBLE` (movement), `BUBBLE_CONSTANTS`
(engagement/sickness/ambient), and the `ENEMY_VARIANTS.BUBBLE` `consume` /
`multiply` blocks — all in `constants.ts`.

---

## Rival ships (Stage 7) — polish + tuning follow-ups

**Context:** Rivals shipped as bespoke engine-managed roamers
(`engine/roamers/rivals.ts`, `RIVAL_CONSTANTS`) — player-like privateers that
warp in on a cadence, hunt the wave enemies (stealing the player's points +
drops), and per disposition (hostile / ally / neutral) fight, ignore, or
retaliate against the player. First pass is intentionally lean; revisit:

- **Terrain navigation.** Rivals steer straight at their target with no
  pathfinding (unlike wave enemies, which ride the baked pursuit flow field
  toward the player). On tile-dense maps they can bump/stall on walls. Options:
  route rival steering through a flow field, add a cheap whisker-avoidance, or
  let them `phasesTerrain` (cheapest, but less "ship-like").
- **Theft legibility.** The point-steal is currently pure denial (the player
  just gains nothing). Add a visible cue — a rival-coloured "+N stolen" popup at
  the kill, a running per-rival `stolen` tally (`RivalInstance.stolen` is
  declared but never incremented — the tally itself is unbuilt) surfaced in
  the HUD, or a brief tether/flash.
- **Enemy↔rival collateral.** Today enemies can't damage rivals (friendly-fire
  filter), so rivals are only threatened by the player. Consider letting some
  enemy fire hit rivals (make them `thirdParty`, or a `hitsRivals` flag) so the
  battlefield is a real three-way.
- **Ally value.** Allies help by thinning enemies but still deny loot/points —
  net they may feel bad. Consider allies occasionally gifting a drop, reviving a
  combo, or drawing aggro without stealing.
- **Cadence / wave integration.** Spawn cadence is SCORE-driven: one random
  rival per `SCORE_INTERVAL` (1000) points earned, capped at `MAX_RIVALS` (6),
  on any map. Tie frequency / disposition mix / count to wave index or
  difficulty; maybe a "rival wave".
- **Combat depth.** All rivals use one blaster. Give dispositions/sprites
  distinct weapons (the sprite already hints an archetype), evasion, or shields.
- **Bounty / risk balance.** `TIER`-scaled bounty + full loot spray on a
  player kill vs. the time cost of chasing one — needs playtest tuning.
- **Damage indication.** Strengthen the feedback when a rival takes damage —
  the current sprite hit-flash + disposition health bar read, but rivals want
  clearer damage numbers and a hit reaction that pops against the busy field
  (e.g. a bigger spark burst or a brief outline — the damage-triggered bar has
  since shipped, 5d U5). Verify world-space damage numbers actually fire for
  rivals (`spawnDamageText` gate) and read at typical zoom.
- **Contrast glow / standout.** Rivals can blend into the enemy field (they use
  retired enemy PNGs). Add a subtle contrast glow / rim-light in the disposition
  colour so they read as distinct player-like ships at a glance — NOT the old
  shield-looking ring (removed per user); think a soft outer glow, engine-trail
  emission (the `trail` field is already on the entity but unused), or a rim
  highlight in `RenderSystem`'s rival sprite branch.

**All knobs live in:** `RIVAL_CONSTANTS` (cadence / stats / weapon / dispositions
/ portal) in `constants.ts`; lifecycle in `engine/roamers/rivals.ts`
(`updateRivals` / `spawnRival` / `fireRivalShot` / `rivalVacuumDrops`).

---

## Entity ↔ portal awareness — real AI, not just a shove (parked 2026-09-01)

Sits with the other entity-AI items below (roster balance, swarm/bubble feel,
rival polish): this is the AI half of the portal work, deliberately deferred
while the physics half ships.

**What exists now.**  `avoidsPortals(e)` in `constants.ts` plus an outward
push in `PhysicsSystem.applyGravity`.  One predicate, defaulting by TYPE
(every `ENEMY`, plus the snitch), so bubbles, dragons, rivals and any future
roamer are covered the day they exist.  The pull is not cancelled — they
drift in from range and are held off at a standoff of roughly 235 units (the
avoid push reaches 240; the old ~215 predates the well's retune to g1500 /
range 525).

**Why that is a stopgap.**  It is a FORCE, not a decision.  Nothing in the
game *knows* a rift is there; it is simply pushed away from one, which means:

- an enemy chasing the player across a rift takes a curved path it never
  chose, and a determined chaser pushes through anyway — correct as physics,
  but it reads as drag rather than as piloting;
- nothing can use the standoff tactically (no baiting the player toward a
  mouth, no refusing to follow through one);
- the four movement machineries — the AISystem strategies, the dragon's
  flow-weave, the rivals' strafe, the bubbles' drift — still have no concept
  of a hazard, so the same problem returns in its own shape for the next
  hazard that is not a portal;
- the standoff radius is one global number rather than something an
  archetype could weigh against what it is doing.

**What a real pass looks like.**  A shared HAZARD AWARENESS input the
strategies can read — "there is a thing at X with radius R you should not
enter" — with each archetype deciding what to do about it, and portals as the
first hazard rather than a special case.  That is the same shape the flow
field already has (a sampled field every mover can consult), so the natural
home is probably a hazard layer beside it rather than a portal-specific API.

**Do this when** a second hazard exists (a boss's zone, a hostile region), or
when a roamer's pathing around rifts starts reading as broken rather than as
cautious.  Not before: one hazard does not justify a hazard system, and the
push already satisfies the requirement it was written for — nothing gets
trapped.

---

## Exotic-enemy roster (Stages 0–7) — balance / tuning pass

**Context:** The exotic enemy roster shipped across Stages 0–7 (PR #67:
Kamikaze, Bulwark, Turret, Swarm+Nest, Bubble, Dragon, Rivals) plus the older
base roster. Each was tuned in isolation during its build; a holistic balance
pass is owed once they all appear together in real timed waves. This is the
BALANCE bucket (feel / numbers) — the perf/optimization pass on the roamers
SHIPPED (decision #33); its leftovers are the next entry.

Known tuning wants (add freely):

- **Bulwark** — the rotating arc shield tracks the player too fast; **slow the
  shield rotation / slew** (`ENEMY_VARIANTS.BULWARK.shieldArc.slew`) so flanking
  is a reliable counter, not a race. (Difficulty note already in this file.)
- **Sniper** — the sniper's weapon feels underpowered for its telegraph/role;
  **make the sniper shot more powerful** (damage and/or projectile speed on the
  Sniper `ENEMY_VARIANTS` weapon).
- **Rivals (Stage 7)** — balance the bounty vs. the time cost of chasing one,
  the loot-steal rate, disposition mix, and ship stats (HP/weapon). See the
  dedicated "Rival ships" entry above for the deeper feature follow-ups
  (terrain nav, theft legibility, enemy↔rival collateral, ally value).
- **Dragon** — roam/leave timing, attack cadence once provoked, segment HP,
  the doubling kill payout curve, and how it enters normal play (today the
  Overworld keeper spawns one — 25 s after arriving on the Overworld, then 90 s
  after the last one is gone, `OVERWORLD_CONSTANTS`; arenas only via DBG).
- **Kamikaze / Turret / Swarm / Nest** — revisit blast radius, missile homing
  strength, gnat bite, and brood cap against the timed-wave budgets.
- **Cross-roster** — now that (f) waves have landed (completion waves,
  clear-the-field), tune per-wave spawn budgets so the exotic types are
  introduced legibly (the scripted teaching waves exist; the mix beyond them
  needs balancing).

All knobs live in `ENEMY_VARIANTS` / `ENEMY_TRAITS` / `AI_CONFIG` /
`BUBBLE_CONSTANTS` / `DRAGON_CONSTANTS` / `RIVAL_CONSTANTS` in `constants.ts`.

---

## Exotic-enemies-optimization — deferred perf ideas

**Context:** The `exotic-enemies-optimization` pass (decision #33, shipped) took a
strict zero-behaviour / zero-visual posture. Two perf ideas were intentionally
left out of that pass because they would need new infra or a visible change; log
here for a future perf beat.

- **`updateConsumers` dynamic-grid query.** The consume-and-grow scan
  (bubble/dragon eating) is `O(calm consumers × all mobile shards)` over the full
  `shardCandidates` list. It is already `PerfController`-gated (`consume`)
  and early-outs for every non-idle consumer, but on a shard-dense field a single
  calm bubble still walks the whole shard list each scan step. A real fix is a
  spatial near-query, but PhysicsSystem only exposes a **static**-grid helper
  (`forEachStaticNear`) today — a `forEachDynamicNear` over the per-frame dynamic
  grid would be needed. More invasive than a zero-behaviour pass warranted.

- **Projectile `enforceCap` per spawn.** The particle-burst hitch was fixed
  in that pass (particle caps are enforced once per frame from the engine
  loop), but the same O(N) per-spawn cap check still runs for PROJECTILES
  (`ProjectileSystem.spawn` → `enforceCap`, `MAX_PROJECTILES`) — left alone
  because projectiles are gameplay entities (cap timing can affect a frame);
  batch it once/frame if a projectile-heavy weapon ever profiles hot.

- **`maintainAmbientBubbles` / nest brood census.** Small `O(enemies)` integer
  counts run every step. Cheap enough that gating them (they only ACT on a timer)
  is low ROI and risks a spawn-timing wobble; left every-step.

Knobs: `PERF_TASKS` (`consume`), `PhysicsSystem` grids, `EXPLOSION_CONSTANTS` /
`PARTICLE_CONSTANTS` / `MAX_PARTICLES` in `constants.ts`.

---

## Edge vs Safari frame pacing on iOS — is any of it ours? (parked 2026-09-09)

**A reported "severe periodic frame drop" turned out to be the BROWSER, not
the game.** The same build on the same device ran silky smooth in Safari and
hitched badly in Edge (user finding, after four Perf REC captures).

What the captures established before that came out, worth keeping because it
is all still true and bounds any future investigation:

| candidate | test | result |
|---|---|---|
| render path | every capture | **1.90–2.73 ms avg**, and only 1–3 ms on the spike frames themselves |
| sim / substeps | Sim rate 120 → 60 Hz | spike period **unchanged** (~1.05 s) |
| cadenced tasks | PerfController tier idle → light | period **unchanged** |
| `EngineStats` payload | HUD rate 60 → 15 Hz | period **unchanged**, p99 51 vs 53 ms |
| static tile stamping | every capture | `0 tiles · 0.00 ms` |
| React hand-off | every capture | 0.00 (correct for a non-profiling build) |

The pauses sat **entirely in `other`** (48–63 ms of a 67 ms frame, with render
2–3 and sim 1–3), i.e. outside every bracket the engine instruments — which is
exactly the shape a browser-level stall has, and why no engine knob could
move it.

TWO observations survive and are the actual open questions:

1. **The rate scaled with activity**: ~1.05 s period while flying, ~2.1 s
   parked, and the pauses were bigger while moving (p99 51–53 vs 31 ms).
   Something the game does feeds it even if the game is not the one stalling.
   A GC in a browser whose collector is tuned differently would do that.
2. **The tint cache tracked movement exactly**: 0 misses parked, 41–62 while
   flying (`peak 3–6 ms`). Each miss allocates a tinted canvas. Cheap on a
   256-entry cache, but it IS movement-scaled heap churn and the one engine
   contribution the captures actually caught.

So the question to answer is narrow: does Edge's collector (or its canvas
compositor) turn our ordinary per-frame churn into visible stalls where
Safari's does not — and if so, is the churn worth reducing anyway for the
worst-case browser? The decisive instrument is a **Safari Web Inspector
timeline attached to the device**, which marks GC events explicitly; the
container harness is NOT adequate (measured ±40% run-to-run on `heapKB/f`,
enough that a 4× reduction in stats-payload allocation came back *higher*).

Do NOT start from the engine again without new evidence. In particular the
5c-gauntlet residual (`applyGravity`, `handleEntityCollisions`,
`PhysicsSystem.update`, `EntityIndex.rebuild`) was NOT shown to be the cause,
and CLAUDE.md §4 records that the intuitive fix there — normalising entity
hidden classes — measured **1.9× slower** on the real population.

---

## Physics / shard broadphase at high entity counts (separate perf pass)

**Partly addressed on the `physics-shard-broadphase` branch (PR #70).** What
landed there, zero-behaviour:
- **Broadphase per-pair math** — `resolveAsteroidPair` (`resolveShardPair`
  since V6) now caches `invMass`/`effInvMass` on a mass-keyed
  self-invalidating field (removes 2 div + 2 pow per pair) and dedups pairs
  on a numeric `_pairSeq` instead of an `a.id > b.id` string compare.
- **Render-bucket pooling** — the per-frame `{entity,rx,ry}` render candidate
  buckets (`_visibleEntities` / nebula tile+shard / trail / particle) were the
  dominant per-frame allocator (~60–90k small objects/sec in a tile-dense scene,
  the driver of periodic GC-pause tail hitches). Now backed by persistent object
  pools; steady-state bucket allocation is zero. Measured: `peak render 17 → 9 ms`
  on the same heavy scene.

**Measurement conclusion (four real-hardware captures, iPhone 440×756 dpr3, diff
3):** steady state is vsync-bound and smooth (median 59, p95 21 ms on the
shard-dense Asteroid Field). The residual ~80 ms worst-frame hitches at moderate
density are **external browser/system stalls** (`3 ms sim + 3 ms render` on the
worst frame — not our compute), uncorrelated with sim load, and not addressable in
our JS. The exotic roamers and render are NOT the hot path; the collision/shard
broadphase is.

**The one remaining IN-OUR-CODE spike — the as-needed lever below.** A 200 s /
**8,081-entity** Tile Heavy capture produced a genuine compute spike: worst frame
133 ms with **`sim 100 ms`** (`peak sim 106`). That is the fundamental **O(k²)
shard-pair cost** of resolving a grid cell packed with fresh shatter debris — a
cannon into a tight tile cluster spawns hundreds of shards into a few cells in one
substep. The per-pair cost, the exclusions (particles / drops / static / shard
outer-loop), the sleep skip, the viewport-cull cadence, and the density-scaled
AUTO throttle are ALL already in — so the only lever left trades a little
shard-field behaviour and is deliberately parked until shards actually get too
heavy in real play.

### As-needed: per-cell shard-pair budget (do this if shards profile hot)

**Trigger:** a real-play scene (not a stress test) where `resolveShardPairs`
dominates a sim spike — i.e. `collisions`/`physics` climb and `peak sim` spikes
right after big shatters, at very high shard density (the 8,081-entity capture is
the reference case).

**Idea:** bound the pairs resolved per grid cell per substep. When a single cell
holds a pathological pile (> K shards), resolve only a rotating subset of its
pairs each substep so every pair is still covered within a few frames — caps the
dense-cell cost from O(k²) to ≈O(k·K). Set K high so it engages ONLY on the
spike-causing clusters and leaves normal density byte-identical.

**Where:** `PhysicsSystem.resolveShardPairs` (the `for i / 3×3 cell / for j` inner
loop). Add the cell-pile threshold + a per-substep rotating offset
(`shardPairCallCount % stride`) so the covered subset advances each call. Keep the
existing `_pairSeq` dedup, sleep skip, and viewport gate.

**Tradeoff / risk:** in the very densest MOMENTARY piles, shards separate a touch
softer for a frame or two before fully covered. Piles are transient (shards
scatter apart), so this should read as imperceptible — but VERIFY against a dense
headless scene (confirm no visible sustained interpenetration) before shipping,
since the shard-field feel is user-protected. Tune K / stride in
`SHARD_PAIR_CONSTANTS`.

**Other candidate levers (heavier, lower priority):** a cheaper dynamic-grid
QUERY (the rebuild went allocation-free in 5c — `CellBuckets`), a
`forEachDynamicNear` helper (also unblocks the parked `updateConsumers`
query), revisiting the shard-merge cull rate under max load.
**Delicate** (merge / regen / neighbour-count all key off exact shard positions),
so any of these warrants its own branch + verification.

Knobs: `PhysicsSystem` (static/dynamic grids, `SPATIAL_GRID_SIZE`), `ShardSystem`,
`SHARD_PAIR_CONSTANTS` / `SHARD_TILE_PAIR_CONSTANTS` / `LOCAL_MERGE_CONSTANTS` /
`PERF_TASKS` in `constants.ts`.

---

## Shard flow field — the PR #56 audit's open follow-ups

Moved here in the 2026-09 docs cleanup, which retired
`docs/FLOW_FIELD_AUDIT.md` (in git history at `ca0ad8e`).  The audit's main
answer still holds — don't consolidate: `FlowField.ts`, the analytical
sampler, and `FlowFieldGrid`'s baked shard field are complementary.  Its
follow-up briefs, as they stand:

- **FF-1a — the blocked-cell fallback is still un-deflected.**  A blocked
  cell bakes to a zero vector, and `FlowFieldGrid.sampleShardFlow` answers a
  zero cell with the bare analytical sampler, so a shard knocked into a tile
  cell gets the undeflected base direction back — which can push it deeper
  into the wall before the next collision impulse.  The brief's fix: return
  the nearest OPEN cell's baked vector instead.  It changes shard feel in
  narrow channels, so it needs an A/B.
- **FF-1b — SHIPPED.**  Wall repulsion is no longer 4-cardinal: a
  `(2R+1)²` kernel with 1/d² weight plus a tangent mix (defaults R = 3,
  tangent 0.5; DBG ▸ World & Maps ▸ Flow Field ▸ "Kernel R" / "Tangent").
- **FF-2 — revisit the obstacle filter if a finite-mass wall ships.**
  `FlowFieldGrid.initObstacles` bakes only `mass === Infinity` tiles, nebula
  excluded, so a wall-like tile given finite mass (to make it shoveable, say)
  would silently drop out of the obstacle bitmap.
- **FF-3 — no timer on the shard-flow bake.**  `flowFieldMs` covers only
  `flushEnemyField`; the map-load bake (`buildShardFlowField`) and the
  per-destruction patch (`onTileDestroyed`) are untimed.  Low priority — the
  work is not hot — but cheap, and it would catch a sampler that grew
  expensive.

---

## Ship-design directions (station/module follow-up, 2026-07-18)

Two competing designs for how PLAYER SHIPS relate to the hex-slot module
system. **Option A is the chosen direction** (user decision during the
station-poi increment); Option B is preserved for reference — it was the
original "ship-part modules" sketch and was explicitly superseded.

### Option A — Ship catalog (CHOSEN)

Ships are discrete purchasable items, each with its OWN SPRITE and a fixed
outfitting envelope. Modules stay pure equipment; the ship is the frame
they plug into.

- Each ship defines: inventory tile count, ship-group installation slot
  count/shape, weapon-group slot count/shape (incl. how many GUN slots —
  the "more weapon slots" major upgrade becomes a ship purchase), base
  stats, and one bespoke sprite. No per-part sprite compositing.
- **Special ships** can grant positional boosts: designated installation
  slots that amplify whatever module sits in them (e.g. "+25% to the
  module in the aft slot") — making slot LAYOUT a purchasable identity.
- Progression: the starter ship is deliberately cramped (small inventory,
  few slots); bigger/specialist hulls are late-game salvage sinks.
- Pairs with the future persistent overworld: the ship you fly is the
  run-to-run persistent artifact; the base station is where the hangar
  lives.
- **Capacity ceilings are ship stats-in-waiting** (2026-07-24 addendum):
  `MAX_INSTALLED_GUNS = 2` and `INVENTORY_CAPACITY = 12` are deliberately
  hard constants today, both marked in code as "future ships vary this."
  Under this catalog they become per-ship envelope fields, and raising
  them is the headline reason to buy a bigger hull.  Until the catalog
  lands, resist standalone "+1 gun slot" purchases — that undercuts the
  ship catalog's value proposition.

### Option B — Modular physical ship (SUPERSEDED)

The ship's LOOK and performance are composed from installed `ship-part`
modules — hull, engine housing, wings, nosecone/armor — each contributing
performance characteristics (health, armor, max speed, acceleration) and
a sprite layer; the rendered ship is the composite of its parts.

- Was the original intent behind the reserved `'ship-part'` module kind.
- Cost: needs per-part sprite art for every combination axis, a sprite
  compositing/anchoring system, and careful hitbox management as parts
  change silhouette.
- Rejected in favor of Option A: one sprite per ship reads better, is far
  cheaper to produce, and positional slot boosts recover most of the
  build-identity upside without compositing.

---

## Station-economy follow-ups (2026-07-24)

Items tabled during the station / module-outfitting / sell-scrap
increments (PR #73).  Enemy-side *feel* numbers stay in the
"Exotic-enemy roster — balance / tuning pass" entry above; these are the
economy and station-life follow-ups.

### NPC station traffic (ambience)

Stations are pure player POIs today — nothing else visits them.  Add
ambient NPC ships that fly to / dock at / depart stations (reusing the
rival sprite pool + the reusable `openPortal` VFX) so stations read as
living infrastructure, not vending machines.  Pure ambience: no commerce
simulation, no interaction beyond maybe collision avoidance.  Cheap
version: 1–2 shuttles per station on a loop between stations, despawning
at range.  Touch points: a lean engine-managed roamer like
`RivalInstance` (AISystem skip-flag pattern), `STATION_VARIANTS`,
`GameEngine.openPortal`.

### Salvage death penalty — INTERIM SHIPPED

> **An interim penalty is LIVE** (user call): raising the death summary charges
> `min(balance, max(DEATH_PENALTY_FRACTION x balance, DEATH_PENALTY_MIN))` of
> UNSPENT credits — 25% or a 12,500 floor, whichever is HIGHER, clamped to what
> the player holds, charged ONCE on the transition into `deathPending`.  It
> taxes hoarding, not investment: money already spent on modules is untouched.
> The run summary reports it as a per-life ledger (earned since the last death,
> lost to the wreck, held after).
>
> That settles "a flat percentage tax" from the options below.  Still open: the
> corpse-run recoverable drop and the uninsured-cargo variant (which pairs
> naturally with the hex cargo model), and the severity number itself — both
> belong to the tuning pass above, since the penalty and the repair cost must
> not invert incentives.


Death currently costs the run, but salvage carries no risk once
collected.  Options to make dying expensive without a full roguelike
reset: drop a fraction of carried credits at the death site (recoverable
corpse-run style), a flat percentage tax, or uninsured-cargo (inventory
tiles at risk, installed modules safe — pairs naturally with the hex
cargo model and would make sell-back-before-danger a real decision).
Needs a user decision on severity; interacts with the repair cost (dying
vs repairing must not invert incentives).  Touch points:
`handleEntityDeath` player branch, `credits`, possibly `DropSystem` for
a recoverable drop.

### Economy & progression tuning pass

Module prices were mapped 1:1 onto the old level-curve totals, but the
surrounding systems all moved — a holistic pass is owed once real
playtime accumulates.  One bucket, tune together:

- **Overworld income pacing** — the wave-free map earns only ambient
  salvage (bubbles / rivals / dragon, no wave sprays); check
  time-to-first-Hull and time-to-Mk-III against intended session length.
- **Per-wave enemy growth vs module power curve** — `ENEMY_SCALING` is
  implemented and tuned gentle; retune the player-vs-enemy power pacing
  now that player power arrives in discrete module purchases, not smooth
  levels.  (Per-enemy feel numbers live in the exotic-roster entry.)
- **Mk trade-in** — duplicates stack and Mk II doesn't obsolete Mk I;
  90% sell-back mostly covers respec, but consider a true trade-in (old
  mark credited against the next mark) if buy-sell-buy feels clunky.
- **Ship weight numbers** — `SHIP_WEIGHT` (BASE_BOOST 1.15,
  DRAG_PER_WEIGHT 0.05; every module weighs now, not just guns) is
  explicitly provisional; verify weaponless flight feels like a real option
  and a full outfit a real cost.
- **Resale fractions** — 90% sell-back makes respeccing nearly free
  (possibly fine — outfitting experimentation is the fun); revisit
  `MODULE_RESALE` (and the 9% scrap floor) once the death penalty /
  income pacing land, since all three shape how precious credits feel.

Knobs: `MODULE_DEFS` costs, `SALVAGE_CONSTANTS`, `MODULE_RESALE`,
`SHIP_WEIGHT`, `ENEMY_SCALING`, `STATION_CONSTANTS.REPAIR_COST_PER_HP`.

### Persistent state (what survives a run) — DEPENDENT on the tuning pass

**Follow-up to, and dependent on, the economy tuning pass above — do not
start this until that pass has landed.**  HOME station is already
described as "the future persistent base" but nothing defines what
persists.  Open questions to settle before building: does the outfitted
ship persist run-to-run (the natural reading of the ship catalog), do
credits / inventory persist or reset, is the Overworld the persistent
hub with wave maps as excursions, and where does state live
(localStorage is the only option — no backend).  Persistence changes the
meaning of every price in the economy, so re-run the tuning numbers with
persistence in view.

---

## Portal persistence — stages that stay cleared, and enemies that creep back (2026-08-07)

> **2026-09-03:** the node identity this entry needs is specified in
> `docs/PORTAL_AND_WORLD_LAYER_PLAN.md` §6, and the persistence decision it
> waits on is that doc's open decision #1.  Tracked as **F1**/**F2** in
> `docs/CONFIG_CHANGES_PHASED_PLAN.md`.
>
> **Descent is switched off** (user call, pending the descent rework): the
> post-boss rift no longer opens (`engine/bosses.ts` keeps
> `openDescentPortal` uncalled), so the SHALLOW version below is not
> reachable in play; `transitionToMap(id, { descend: true })` and
> `stageIndex` are intact.

**Context:** raised in playtest while the stage-descent capstone was being
built.  The session deliberately shipped the SHALLOW version (kill the boss →
a descent rift opens → the next stage is a fresh arena, and wave progress is
still fresh per entry).  The user does not want the deep layering handled in
that session, but wants the direction recorded.

The intent, in the user's framing: gameplay should eventually PERSIST to some
degree.  Two shapes were described — they are not mutually exclusive, and the
second is a superset of the first.

**Shape 1 — cleared stages stay cleared, for a while.**
After beating a stage the player can fly back to the Overworld where their
own station lives, install newly-acquired modules, spend money at other
stations, and then return to *the portal they already used* — and NOT face the
same stage again.  The cleared state persists for some period before the
arena repopulates with waves.  Today the opposite is true: `WaveSystem.init`
zeroes `waveIndex` on every entry and there is no per-map run state, so
re-entering any arena restarts its ladder from wave 1 (CLAUDE.md §6a states
this invariant explicitly).

**Shape 2 — a tree of sub-portals, with pressure that flows upward.**
Each Overworld portal arena contains sub-portal arenas; those may contain
further sub-portals.  An arena is only pacified once every sub-arena beneath
it is cleared, so clearing an Overworld portal means clearing its whole
subtree.  If enemies remain in a deep sub-arena they CREEP upward over time —
into the sub-arena above, and eventually back out into the Overworld portal
arena.  That gives the map a decay pressure: ignore a branch long enough and
it re-contaminates everything above it.

**What this collides with today** (all of it deliberate, all of it would have
to move):
- **No per-map state at all.** `transitionToMap` carries RUN state (credits,
  score, outfit, hull) but every map is rebuilt from scratch; destroyed tiles
  do not persist across re-entry either.
- **`stageIndex` is linear depth**, not a position in a tree.  A tree needs
  node identity (which sub-portal of which arena), not a counter.
- **Descent targets are random arena descriptors** — a placeholder for
  procedural areas.  Persistence needs STABLE node ids so a cleared node can
  be recognised on return.
- **The hub resets depth to 0**, which is exactly the behaviour Shape 1 wants
  to remove.
- This is the plan's deferred **waves-to-nodes** item (decision #37f), moved
  to the Overworld plan, plus the parked **persistent state** entry — which
  was itself gated on the economy tuning pass.

**Sequencing note:** Shape 1 is the smaller, self-contained step (per-node
cleared flag + a repopulation timer + stable node ids).  Shape 2 needs a
graph model, an upward-creep tick, and a way to surface subtree state to the
player — probably on the minimap or a map screen that does not exist yet.
Doing Shape 1 first is what makes Shape 2 tractable.

---

## Area composition — material combinations + a real map graph (2026-08-08)

**Context:** raised during the stage-descent session, as design notes for the
procedural AREAS that will replace today's hand-built test arenas.  The
descent portal picked a RANDOM arena descriptor as an explicit placeholder
(`openDescentPortal`, now in `engine/bosses.ts` and uncalled — descent is
switched off) — this entry is what should eventually sit behind that seam.
Not for that session; recorded for the Overworld / procedural-areas work.

### 1. An area is a COMBINATION of materials

Two independent axes, each drawn from the shard-family vocabulary that
already exists (`ShardVariantId`, `SHARD_VARIANTS`):

- **Tile material** (static hex terrain): rock, glass, nebula, metal, plastic.
- **Asteroid material** (mobile shards): rock, glass, metal, plastic.
  Nebula is deliberately absent here — nebula shards are cloud, not rubble.

An area draws a SET from each axis, not a single value: "rock + glass tiles,
rock asteroids" is one area; "metal + plastic + nebula tiles, metal
asteroids" is another.

### 2. Two independent rarity rules

**(a) Fewer variants are common; more variants are rare.**  A single-material
area is the baseline; each additional material in the combination makes it
rarer.  This is what keeps most areas legible ("this is a glass field") while
making a five-material area a genuine event.

**(b) Within a combination, the materials themselves have a rarity order**,
increasing:

> Rock → Glass → Nebula → Metal → Plastic

Rock is the common substrate; plastic is the rarest.  A plastic-bearing area
should feel like a find.

These compose: a two-material *rock + glass* area is far more likely than a
two-material *metal + plastic* one, and both are more likely than any
three-material set.

### 3. Extensibility is a requirement, not a nicety

More material types are already planned, so the rarity model must be DATA,
not code.  The shape that fits the codebase: a per-material weight table
(alongside or inside `SHARD_VARIANTS`, which is already the per-variant
behaviour table) plus a per-combination-SIZE weight curve.  Adding a material
should mean adding one row and picking where it sits in the rarity order —
never touching the sampler.

Deliberately excluded from the rarity table: `indestructible-tile`, which is
structural furniture rather than an area's material identity.

**Interaction with existing config:** `MAP_POPULATION` is currently a static
`Record<MapType, …>` of per-variant counts.  A generated area needs the same
shape produced at RUNTIME from the drawn combination — so either
MAP_POPULATION grows a "generated" branch, or the generator emits a
population record the existing `BaseMapLayer.populateTileClusters` /
`populateNebulaClusters` path (already `MAP_POPULATION`-driven) consumes
unchanged.  The latter is much less invasive and keeps one populate path.

### 4. A real map GRAPH — nodes and edges

The user wants an actual designed map structure: **nodes** (areas) and
**edges** (portal links) rather than today's flat list of interchangeable
arenas.

The payoff is REGIONAL IDENTITY: clusters of adjacent nodes sharing similar
material combinations, so travel reads as moving through different parts of a
galaxy — a glass-and-nebula region, a metal belt — instead of a shuffle of
unrelated rooms.  Material similarity should therefore be a property of
NEIGHBOURHOODS in the graph, not rolled independently per node; a sensible
model is to seed regions and let per-node draws perturb a regional base
composition.

> **2026-09-03 — superseded in part.**  The world-structure half of this
> entry now lives in `docs/PORTAL_AND_WORLD_LAYER_PLAN.md`, which adds the
> containment hierarchy, the two portal kinds and the maze/labyrinth
> topologies, and which proposes SPLITTING the graph into node identity
> (early, cheap, no generation) and procedural worldgen (Phase G, unchanged).
> The material-composition half below is untouched and still wanted.
> `docs/CONFIG_CHANGES_PHASED_PLAN.md` tracks it as **G1** / **G2**.

**This is the same graph the portal-persistence entry needs** (see "Portal
persistence — stages that stay cleared, and enemies that creep back"): its
Shape 2 (sub-portal arenas, an unfinished branch letting enemies creep
upward) is a tree/graph traversal problem, and its Shape 1 needs stable node
ids so a cleared node is recognised on return.  Building the graph once
serves both — **it should probably be the first piece built**, since
composition-per-node and persistence-per-node both hang off node identity.

**What it collides with today:** `MAP_DESCRIPTORS` is a flat registry of
hand-authored maps with no adjacency; `stageIndex` is a linear depth counter,
not a position in a graph; descent targets are random rather than stable
node ids; and destroyed terrain does not persist across re-entry.

### Open questions (not decided)

- Are the two axes (tile / asteroid material) drawn INDEPENDENTLY, or should
  asteroid material be correlated with tile material?  A rock field with
  plastic asteroids may read as incoherent — or as interesting.
- Does the regional base composition drift with DEPTH as well as position, so
  deeper stages skew toward the rarer end of the order?
- Do flow-field parameters, enemy mixes and ambient fauna cluster by region
  too?  The user's original framing of an AREA included all of these, so the
  material combination is likely one facet of a broader per-node profile.

---

## Automated test suite — the three tiers still parked (2026-08-08)

> Tiers 1 (the Playwright suites in `tests/`) and 2 (`npm run typecheck`)
> SHIPPED in roadmap 5b (decision #46a), and tier 6 (CI gating) is
> `.github/workflows/pr-checks.yml`, the merge gate — see CLAUDE.md §7.
> Still parked, deliberately:

3. **Unit tests for the pure layer.**  Vitest over the genuinely pure,
   dependency-free functions: `engine/toroidal.ts` (wrap math — the single
   most invariant-critical code in the repo and the easiest to break
   silently), the `constants.ts` pure helpers (`isBossWave`, `bossForWave`,
   `buildWaveSpawnList`, `buildBossWaveSpawnList`, `enemyHpMult`,
   `getWaveSpawnBudget`, `moduleFitsSlot`), `modulePrice`
   (`engine/outfitting.ts`), and the module adjacency fixpoint.  No DOM, no
   canvas, fast.
4. **Headless SIM tests without a browser.**  The engine constructs a
   `GameEngine` before `initCanvas`; a large amount of sim logic (waves,
   physics stepping, module effects, death routing) may be drivable in Node
   with a stub context.  Worth a spike — if it works it is far faster than
   Playwright and covers the parts that actually carry the game.
5. **Visual regression.**  Screenshot diffs for the HUD at 390×844 and the
   station/pause panels.  This is where the "AAA test suite" framing points,
   and it is also the flakiest and most maintenance-hungry tier — the Pair A
   session already burned real time on canvas-sampling flakiness (the fix was
   to PAUSE the sim and classify by dominant-hue histogram rather than
   brightest pixel).  Do this LAST, and only for surfaces that are stable.

---

## Rotational mechanics for shards and asteroids (2026-08-21)

**Raised in playtest** ("the nebula shards spin in the opposite direction
than what they should"), and the user has explicit interest in building the
real thing.  The interim fix shipped: the player-wake swirl's spin sign is
now the DBG cycle Materials ▸ Nebula ▸ "Neb spin" — `physical` (wake shear:
starboard pass → clockwise) / `inverted` / `random` (the old id-parity
vortices) — so the handedness can be A/B'd in flight.  That is a SIGN
policy, not physics.

**What the real system is:** angular state as a first-class part of the
impulse solver.

- **Moment of inertia** per entity (from size/mass; a disc approximation is
  fine) beside `mass`, with `Infinity` for statics mirroring the mass axis.
- **Off-centre impacts apply torque**: `resolveCollision` /
  `resolveShardPair` compute the contact point already (MTV); the impulse
  they apply should also change `rotationSpeed` by `r × J / I` on both
  bodies, and the contact-point VELOCITY (linear + ω×r) should feed the
  restitution instead of the centre velocity.
- **Surface drag / wake torque** becomes an emergent case of the same
  machinery instead of the hand-signed swirl kick.
- **Spin → translation coupling** (a spinning shard grinding along a wall
  walks sideways) is optional polish; decide when the base lands.

**Why its own session** (the broadphase entry warns): the per-pair solver is
the hottest code in the engine and "delicate — merge / regen / neighbour-
count all key off exact shard positions".  Adding angular terms changes
resting-contact behaviour (spin jitter is the classic failure), interacts
with the shard SLEEP system (`SHARD_SLEEP_CONSTANTS` gates on spin epsilon
already), and needs the perf harness re-run (`perf/simbench.mjs`) since it
adds work per contact pair.  Sequence: base I + impact torque on the
player/enemy/shard paths → wake swirl re-derived → sleep/merge re-verified →
perf capture.  Knobs should land beside `PHYSICS_CONSTANTS`.

**Touch points:** `PhysicsSystem.resolveCollision` / `resolveShardPair` /
`applyNebulaPlayerPull` (which then loses its hand-signed kick), the shard
sleep gates, `SHARD_VARIANTS` if per-material inertia is wanted.

---

## 5d aesthetic calls (R1–R5) — parked for a future look pass (2026-08-20)

**Parked at the user's direction.**  The 5d gauntlet's ledger raised five
aesthetic judgment calls for review (`docs/GAUNTLET_5D_LOG.md` § For user
review); rather than adjudicate them one by one they are parked here as a
bundle for a dedicated look pass.  Each is a taste call with the reasoning
already written — none blocks anything, and none is a defect.

1. **R1 — Stage-clear CONTINUE: emerald vs amber.**  Moved to the shared
   emerald PRIMARY because amber on that screen is the descent rift's colour
   and an amber button reads as "descend".  Counter-argument: the screen is
   amber-themed throughout and the button tied it together.
   *(2026-09: the descent rift is switched off — no amber rift exists in
   play, so "amber reads as descend" is moot until the descent rework.)*
2. **R2 — Portal arrow green vs minimap blip violet/sky.**  The one contact
   exempt from the G5 colour-faithfulness rule, documented as deliberate.
   Two ways out if wanted: tint the arrow to match the rift, or keep the
   legend green and distinguish outbound/return by SHAPE on the minimap.
3. **R3 — Expanded minimap vs loadout strip overlap.**  The strip's
   clearance assumes the COLLAPSED map width.  Left alone because every fix
   (moving the strip when the map opens) is a bigger aesthetic change than
   the problem — the map auto-collapses after five seconds and the strip
   draws on top.
4. **R4 — Where the player's hull readout lives.**  Top-left, with the
   number changing colour by urgency band (emerald → amber → rose) — the one
   place in the HUD where a colour change IS the information.  Moving it
   (e.g. bottom-left by the minimap) is a one-line change if it reads wrong.
5. **R5 — At 320px the longest station title ellipsizes.**  Every title fits
   exactly at the 390px design target; 320 plus a six-figure balance is 29px
   short and `truncate` degrades gracefully.  The alternatives all trade a
   guarantee for it (wrapping headers can overflow outright on longer future
   names).  *(5d U8 later changed this screen: the title now shares a sticky
   row with UNDOCK at `text-lg`, and the balance sits on its own row —
   re-measure at 320 before deciding.)*

The full argument for each — with measurements and the before/after pairs —
stays in the 5d ledger; this entry exists so the look pass has one place to
start from.

---

## Fully customisable control scheme (rebindable pad / key mapping)

**Parked deliberately** (user call, alongside the `gamepad-left` scheme that
prompted it): the schemes have grown to seven, and each new one is a row in
`CONTROL_SCHEMES` plus a row in `CONTROL_SCHEME_RULES` plus a branch or two in
`InputSystem`. That is cheap for the first few and stops being cheap when the
answer to "can I put fire on the right bumper" is a new scheme.

**What exists already, and is most of the substrate:**

- `INPUT_CONSTANTS.GAMEPAD.BUTTONS` is already a table of *action → button
  indices* (`FIRE`, `FIRE_FACE`, `INTERACT`, `SCAN`, `CYCLE_WEAPON`, `PAUSE`,
  `DPAD`, `THROTTLE`, `DEBUG`, plus the menu-nav `CONFIRM` / `BACK`). A
  rebind is a write to that table, not new plumbing — the poll reads it
  through `padGroupValue` / `padGroupEdge`, which already accept a GROUP of
  indices rather than one button.
- `CONTROL_SCHEME_RULES` is the one table every "what does this scheme do"
  read goes through, so a custom scheme is a rules row with user-supplied
  values rather than a new code path.
- The three input devices already converge on one set of outputs (movement
  vector, synthetic pointer, fire queues), so nothing downstream of
  `InputSystem` would need to know a binding had moved.

**What is genuinely missing:**

1. **Persistence.** The game keeps no state across reloads by design
   (difficulty and control scheme are in-memory preferences). A rebind that
   does not survive a reload is worse than no rebind, so this needs the first
   real answer to "where does user configuration live" — which is a decision
   with scope well beyond controls.
2. **A binding UI**, including the "press the button you want" capture mode,
   conflict detection, and a reset-to-default. On a 390px screen that is a
   screen of its own, not a section of the pause menu.
3. **The axis question.** Buttons rebind cleanly; AXES do not. What the left
   stick MEANS differs per scheme (thrust magnitude under `gamepad`, discarded
   under `gamepad-thrust`, heading+aim+throttle under `gamepad-left`), and
   those are semantics rather than bindings. A custom scheme needs to expose
   that choice as a small set of named behaviours — which is what the scheme
   list already is, so the honest design may be "custom BUTTONS on top of a
   chosen axis model" rather than a blank slate.

**Cheapest path when it comes up:** buttons only, on top of an existing
scheme, with the axis model still chosen from the current list. That covers
the common ask ("move fire off the trigger") without answering (3), and it
needs only (1) and (2).

---

## Depth-scoped darkness belongs to the universe map structure (2026-08-20)

**The mechanism is BUILT, TESTED, and SHIPPED OFF** (`constants.ts`
`depthAmbientEnabled = false`; DBG ▸ Visual / HUD ▸ Lighting ▸ "Depth dark"
turns it on).
A7 of the lighting gauntlet added depth-scoped ambient darkness: each descent
adds the light tier's `ambientPerStage` of fog-dark (capped at
`AMBIENT_DEPTH_CAP` = 4 stages), folded into the fog compositor's dark fill
as `max(fogSetting, depth)` — so it is cut by the player's light, respects
shadows, and darkens the minimap's memory veil through the one mechanism.
`tests/lighting.spec.ts` ("A7: depth darkens the world…") pins the monotone
ladder, the cap, and the toggle restore.

**Why it ships off (user call):** the "depth" it keys on is not yet a real
place.

- **Descent is switched off today** (`engine/bosses.ts`, pending the descent
  rework), so `stageIndex` never leaves 0 in normal play and this mechanism
  has nothing to key on even if enabled.
- **The post-boss rifts have no depth in them.**  A descent rift just
  travels the player from one arena to another — every arena hangs off the
  one Overworld, and the "descent target" is a RANDOM interchangeable
  descriptor.  `stageIndex` is a linear counter that says how many amber
  rifts a run has entered, not where the player IS.
- **No persistence.**  Travel "down" a layer, leave through the arena's
  overworld return portal, then re-enter the same arena: `stageIndex` was
  zeroed at the hub, so the darkness is gone.  A darkness that evaporates on
  a round trip reads as a bug, not as depth.
- In other words the SUB-LAYER PORTAL SYSTEM hasn't been established; the
  portals just bounce between maps on the primary overworld layer.

**Where it should land:** the planned universe-map work — see "Area
composition — material combinations + a real map graph" (its §4, the
node/edge graph) and "Portal persistence — stages that stay cleared".  Once a
node has a stable identity and a real DEPTH coordinate that survives
travelling away and back, the darkness becomes a property of the node
(read `depth` off the node the player is in, instead of off the linear
`stageIndex`) and the default flips on.  That is a one-line source change
(`fogEffectiveDark` in `engine/systems/render/fog.ts` reads
`r.stageDepth`, stamped from the engine each frame — re-point the stamp) —
the compositor, the cap, the tier scaling and the tests all carry over.

**Related knob already noted in the map-graph entry's open questions:**
whether the regional material composition also drifts with depth — if it
does, depth-darkness and depth-composition should read the same coordinate.

---

## The sim wall at ~5k entities — gravity collapse (2026-08-21)

Surfaced by the A9 device captures (`docs/GAUNTLET_LIGHTING_LOG.md`) while
proving the lighting layer innocent — the light/fog columns read ≤ 0.38 ms
in every degraded window, and these two owned the frames instead.  Both are
pre-existing and PROGRESSIVE with entity count, which is why long sessions
on debris-heavy maps degrade: 59 fps at ~2 k entities → ~37 fps at 4–5 k on
a dpr-2 phone.

- **The sim wall at ~5 k entities.**  physics + collisions reach ~55 ms per
  frame at ~5.2 k entities on device (avg physics 2.60 ms, collisions
  1.85 ms over the window; a later capture reached 184 ms peak at ~6 k and
  the substep death spiral).  This is the parked O(k²) shard-pair shape the
  5c harness's `asteroid-6k` scene characterizes; the device numbers say it
  is the binding constraint on real hardware, ahead of anything render-side.

  **Design direction to investigate first (user, 2026-08-21): GRAVITY
  COLLAPSE.**  Rather than only making k cheaper, SHRINK k with a
  mechanic: when free shards in a large space exceed a count/density
  threshold, rapidly collapse the cluster into a knot of TILES — a visible
  gravitational infall (pull-in, then a condensation burst) rather than a
  cleanup.  The pieces mostly exist: the merge broadphase already finds
  dense clusters, `TILE_SNAP` already turns merged shards into hex tiles,
  and `composeEntities`/`mergeCount` conserve mass — this would be a
  faster, threshold-triggered, area-scoped version of the same pipeline
  with a deliberate feel (LOCAL_MERGE_CONSTANTS is the existing
  density-reads-merge-rate seam to build on).  Static tiles leave the
  dynamic broadphase entirely, so every collapse directly buys back the
  O(k²) term while READING as physics instead of as despawning.  Tuning
  questions when picked up: the threshold (count vs local density), the
  collapse speed (fast enough to matter, slow enough to watch), and
  whether deep-space collapses should seed new minable clusters (ties into
  the area-composition entry's regional identity).
- **Tinted-sprite cache thrash — FIXED 2026-08-21**
  (`RenderSystem.quantizeTintHex` buckets the hex key; pinned by the
  lighting suite's tint-bucket test).  The shape to remember: a continuously
  drifting hue (`NebulaSystem.equilibrateColors`) defeats any exact-key cache.

Also noted for the same session: the planned desktop-browser framerate
investigation (user report, 2026-08-16) — the PerfRecorder now carries
light/fog columns and a self-describing `set` line, so a desktop capture
will attribute correctly out of the box.

---

## Portal and world-layering design — moved to its own plan (2026-09-03)

The portal session (PR #92) went deep enough on portals that the design no
longer fits a parking-lot entry.  It lives in
**`docs/PORTAL_AND_WORLD_LAYER_PLAN.md`**: the layer containment hierarchy,
the two portal kinds (hidden wormhole vs. signposted celestial gateway),
discovery-by-physics and its interface to the **A4** scanner, the
maze/labyrinth topologies, and the recommendation to split node identity out
of Phase **G1**.

That doc takes precedence over `docs/CONFIG_CHANGES_PHASED_PLAN.md` **on
portals and overworld layering only** (user directive); the phased plan
remains authoritative on phase order, element IDs and everything else.

---

## Portal effects — follow-ups parked from the wormhole session (2026-09-03)

All small, all deliberately not done while the well was still being tuned.

- **The debris-transit spit still sprays sparks.**  When matter that
  travelled the wormhole re-emerges from the exit rift, each piece pops three
  rift-coloured particles (`updatePortalTransit`).  The user removed the
  equivalent spray from the EJECT path — a rift throwing a boulder back has
  not collided with anything, and debris flying off it says otherwise — and
  this one was left because emerging from a wormhole is a different sentence
  from bouncing off one.  Revisit if it reads as the same mistake.
- **`EJECT.SPEED` is no longer derived from anything.**  It is 20, and it was
  chosen when escape from the mouth was ~14.5 px/step.  The retune took
  escape to ~7.1, so the margin went 1.4× → 2.8× while the throw's absolute
  speed stayed put — deliberately, because that speed is what the eject
  *feels* like.  But it is now a literal beside a well that moved, which is
  exactly the staleness `playerEjectSpeed` was written to end.  If the well
  is retuned again, either solve this one too or re-check the comment.
- **The screen shake on an eject survives.**  The sparks went; the
  size-scaled shake stayed, on the reasoning that it is the WEIGHT of the
  thing going past rather than a claim about what it touched.  Not
  re-examined with the user.
- **Hidden portals may need a stronger well than the tuned one.**  See
  `PORTAL_AND_WORLD_LAYER_PLAN.md` §4: the retune that fixed the dizziness
  also made the discovery cues subtle, and those are the same knob.

---

## `lighting.spec.ts` — the open-space reference is not a stable control (2026-09-03)

**Parked from PR #92, where it was the last red test and the one thing on
that branch left unfixed.**  Five other CI failures in that session were also
measurement rather than behaviour and WERE fixed there; this one was handed
over instead, deliberately.

`occluder collection › the material colour rides the light it passes on`
fails intermittently on CI (green on `bd3b8d1` and `4073fee`, red on
`5367464`, `727ec92`, `d28954a`) while the full suite runs clean locally.

**What the instrumentation established** — the failure now reports its own
geometry, and CI was compared against four local runs:

- Geometry is IDENTICAL on both machines (`390×844`, camera zoom `0.65`) and
  no probe falls off the canvas (asserted, and reads zero).
- **The umbra reads are deterministic** — `[2.8, 4.8, 5.2]` and `[0, 11, 0]`,
  identical to the digit across twelve local runs.  The subject of the
  measurement is not the problem.
- **The unstable term is the OPEN-SPACE reference**, and its instability is
  POSITIONAL IN THE SEQUENCE rather than random: whichever measurement is
  taken second reads ~17 on both machines, the first reads high and variable
  (12.7–26.7 locally), the third reads low and variable.

That was tested directly by inserting a discarded warm-up pass: it made the
first measurement perfectly stable — including the open-space read that had
been swinging by a factor of two — and moved the instability onto the second.
So the open-space gain RISES AND THEN FALLS over the ~2 s the three passes
span.  The warm-up was reverted, because relocating a defect is not fixing it.

**Ruled out:** off-canvas probes; device geometry; fog of war (`FOG_CYCLE`
defaults to `off`); movers repopulating the scene (this test already calls
`quietScene`, which halts the wave ladder and stops the ambient keeper).

**What it needs:** find what varies in the light stack over ~2 s at ~200
units from a stationary player, then give the bound a reference that does not
move — averaging it across the settle window it already runs, or anchoring it
to something time-independent.  Note the reference is currently three SINGLE
pixels read at one instant, which is a thin control for a difference-of-
differences a couple of units wide.

**One deliberate loosening to be aware of** when re-reading this test: the
bound used to compare umbra GREEN against open-space LUMINANCE MEAN.  The
light is blue-green (125, 211, 252), so its green sits 7.7% above its own
mean and the comparison was tighter than the physical claim it is written to
make.  It compares green to green now.  That is weaker by exactly that 7.7%,
and it is the comparison the sentence above it describes.

---

## Grain `sizeSpread` and `bondSpread` — parked at 0 for the four (user call)

Both axes are implemented, tested and wired end to end; all four of the
materials this entry is about — rock, glass, plastic, metal — are authored at
**0**, which is the exact identity in both cases (`siteWeightsFor` returns
null, `bondVariance` returns 1), so those four behave as if neither existed.

**One material does use `sizeSpread`, and it is not one of the four: NEBULA,
at 0.6** (2026-09-07, added with the nebula voronoi work).  It is authored
deliberately rather than inherited: a cloud wants the widest possible mix of
puff sizes in one body, which is precisely what this axis is for, and nebula
is not part of the ordering question below — that is about four materials
whose relative heterogeneity has to be decided together.  `bondSpread` stays
unused everywhere, nebula included (it carries no `bondStrength` at all).

- **`sizeSpread`** varies grain AREA within one body, via a POWER DIAGRAM:
  each site carries an additive weight and the divider between two sites
  slides off the midpoint by `(wi - wj) / 2d`.  Alternating the sign by
  index gives an even mix of coarse and fine.  Measured on a 10-grain
  body: area CV 0.192 → 0.435 → 0.539 and biggest/smallest 1.97 → 4.99 →
  7.68 across spread 0 → 0.6 → 1, with the MEAN grain diameter pinned at
  18 throughout.
- **`bondSpread`** varies boundary STRENGTH, via a seeded per-boundary
  multiplier `1 ± 0.6 × spread` keyed on `(bodySeed, boundaryIndex)`.
  Unbiased, so derived HP is unchanged on average; fixed per body, so a
  stubborn seam stays stubborn.

**Why parked:** metal and plastic carried non-zero values while rock and
glass sat at 0, which put the *machined* materials on the varied end and
the *natural* ones on the uniform end — backwards from the physical
story, and inconsistent as a rule.  Rather than extend half-considered
values to rock and glass, both were zeroed pending a deliberate pass.

**To revisit:** the ordering that would make sense is rock most
heterogeneous → plastic → metal → glass most uniform (a suggestion, not a
measurement: rock ~0.50/0.35, glass ~0.15/0.10).  This is also the axis
most likely to fix "rock and glass look too similar at the same
grainSize", since it is the one built for that distinction.  The piping
is deliberately retained — the tests
(`tests/fracture.spec.ts`, "grain size and bond spread (A2)") still pin
both laws, so the mechanism cannot rot while parked.

---

## Grain clusters: several grains leaving as ONE fragment (A4-B)

**Status:** evaluated, deliberately parked. A4 (damage spread) shipped;
this is its sibling and was split off from it.

### The two readings of "larger groups break free"

When damage spread was proposed, "allowing larger groups of shards to
break free from some hits" turned out to have two separable meanings:

- **(A) More shards per hit.** A hit frees several grains, each leaving
  as its own fragment. This is a DAMAGE-SPEND question and shipped as
  `grain.damageSpread` — see CLAUDE.md §8. Measured: per-hit yields of
  2 and 4 replacing a steady dribble of 1s.
- **(B) One BIGGER shard.** Several grains leave still bonded to each
  other, as a single larger fragment with the union of their outlines.
  That is what this entry is.

(A) shipped because it is contained entirely inside `spendOnBoundaries`.
(B) is a different job and is parked here.

### Why (B) is not a spend-profile change

Under the grain model a cell detaches the moment every boundary still
binding it has broken, and `progressFracture` already harvests every
freed cell in one pass. So no spend profile produces a bigger fragment:
it produces MORE fragments, faster. Making grains leave TOGETHER means
changing what "a piece" is.

The shape of the work:

1. **Connected components on the surviving-cell graph.** After the
   boundary spend, partition the freed cells into groups that are still
   mutually bonded (an unbroken boundary between two freed cells is what
   keeps them together) but collectively unbound from the parent.
2. **Union polygon per component.** The fragment's outline is
   `unionOfCells` over the component — the function already exists and is
   already the parent's remainder path, so this is reuse rather than new
   geometry.
3. **Conservation at the new seam.** `progressFracture` checks that the
   area the body loses equals the area the fragment carries away, to a 2%
   tolerance, and REFUSES the detach when it fails. That check has to
   generalise to a component's total area. This is the risky part: the
   conservation invariant has been broken twice by geometry that looked
   obviously correct (an interior grain leaving punches a hole the
   outline cannot express; a deformed grain reporting its cut-time area
   spawned a 2.06x oversized fragment), which is precisely why it is
   enforced rather than assumed.
4. **Size/mass/HP for a composite fragment.** A component's size is not
   `parentSize × sqrt(cellArea/refArea)` any more; it is the union's own
   extent. `ShardSystem.spawnDetachedCell` takes one cell today.

### Estimate and risk

~1 day, higher risk than A4 — the conservation seam is the part that has
bitten twice. Worth doing only after A4 has been judged in play: a wider
spend may deliver the intended feel on its own, and if it does not, the
tuning done on A4 tells you how big a cluster should be before this is
built.

### Do not do this first

There is a tempting shortcut — detach a fixed-radius blob of cells around
the impact as one piece. It is wrong for the same reason the arc splice
was wrong in the tail: the piece that leaves must be the piece the
BOUNDARIES freed, or the cracks the player was shown stop predicting the
break, which is the whole property the grain model exists to have.

---

## Polygonal face bonding for metal (replaces the triangular lattice)

**Status:** designed with the user, not built. Supersedes the current
`tickMetalAssembly` lattice. User call: give up triangular bonding for
metal entirely.

> See also `docs/MATERIAL_GRAIN_SPEC.md` §3 (PROPOSED unified bonding — the
> same lattice replacement, stated for every material).  The BREAK half has
> already moved: a dying composite fractures its own hull, and
> `decomposeMetalComposite` is only the legacy A/B (CLAUDE.md §8 "THE
> LATTICE IS HOW METAL JOINS").

### Why the lattice has to go

Metal is the one material whose shards RE-BOND after a break, and its
assembly system is a triangular lattice: integer `(ix, iy, up)` slots at
`R = HEX_SIZE/sqrt(3)`, six cells making a hexagon that snaps to terrain.
It was built when a metal shard's spawn polygon genuinely WAS an
equilateral triangle.

A3 gave metal Voronoi fracture and that stopped being true. Measured:
real grains are 10-14 units across, ~9 per tile, against a lattice
triangle of 25.4 — so the lattice is already being stretched, and a
composite grown from grains ends up with a pitch of ~11 rather than 25.
The system is protecting geometry that no longer matches the material.

### The design

Metal joins the DEFAULT merge path the other materials use
(`bondsWith: 'self'` + `defaultOutcome: 'compose'`, area accumulating,
`TILE_SNAP` on diameter + rest speed), with a face-alignment step on top
so it still feels mechanical rather than gloopy.

**The payoff — bonding is the INVERSE of fracture, and reuses it.**
A welded assembly is a body whose `fractureCells` are its member shards
and whose `fractureEdges` are the welds. Everything falls out:

- Derived HP = sum of (weld length x bond strength) — the V15 model,
  unchanged.
- Breaking it apart = the existing grain-boundary damage, unchanged. It
  comes apart along the seams it was built from.
- The cracks it shows are the welds — already how
  `overlayMaterialCracks` works.
- A weld can carry a LOWER strength than virgin grain boundary.
  Physically right, and it gives a reason to prefer an intact plate.

A composite's grain pattern is its assembly history. This deletes a
special case rather than replacing it with another.

### Overlap with more than two shards

The rule: **always bond outline-to-outline, never member-to-member.**
Once A and B weld, the composite has ONE outline (`unionOfCells`, which
already exists and is already the fracture-remainder path). C snaps to a
face of that union, which by definition has no interior — so three-way,
n-way all work the same. Three residual cases need a runtime CHECK
rather than a proof (the conservation-check discipline: geometry that
looks obviously correct has broken this codebase twice):

1. **Snap-into-a-third-party.** The snap transform is rigid and can move
   C into D. SAT-check the post-snap pose against nearby bodies; refuse
   and fall back to the soft pull.
2. **Mismatched face lengths.** A 12-unit face onto an 8-unit face
   leaves an overhang. Visually GOOD — it reads as a real join — it just
   notches the union outline.
3. **Loop closure.** A-B, B-C, then C-A will not line up exactly. Gate on
   a tolerance; fall back to a cohesion bond with no geometric snap.

### Making it "clicky"

Two stages; the first is what sells it.

- **Approach:** alongside the existing pull, drive `rotationSpeed` toward
  the face-alignment error, so shards visibly TURN to present a face.
  Rotation here is purely kinematic (`rotation += rotationSpeed * dt`,
  no torque in the impulse solver), so this is a direct write.
- **Capture:** inside a distance-AND-angle window, ease the rigid
  transform to exact contact over 2-3 frames with a sound and a spark.

### Stretch: magnetic poles

User's idea: alternating poles, only opposite poles attract and bond.
Two things to resolve first.

**Alternating VERTICES does not produce face polarity.** With vertices
+,-,+,-, every edge joins a + to a -, so all faces are identical. FACES
are what needs polarity — and alternating edges only works on EVEN-sided
polygons. Measured on real metal grains, vertex counts were
[6,5,5,5,6,5,5,6,4]: five of nine were PENTAGONS, so odd is the common
case, not an edge case. Three ways out:

- Seeded hash per face. Works on anything, loses the alternation, looks
  the same in play (~half the faces are +).
- Polarity from face ORIENTATION (sign of the normal's angle), so a
  shard has a + side and a - side. Spatially coherent.
- Accept one defect edge on odd polygons — literally a frustrated
  antiferromagnet, which is real physics.

**Two notes.** Repulsion is the cheaper half and delivers most of the
feel: same-pole faces pushing apart is what makes shards dance and
re-orient. And the RENDER TELL is not optional — without a visible
polarity (a two-tone edge stroke would do) the mechanic reads as
"bonding is randomly unreliable". With it, a composite visibly has a
VALENCE: how many + and - faces it still exposes.

### Decisions still open

1. **When does a blob become terrain?** Metal snaps to a tile at 6
   lattice cells today. Free-form bonding removes that trigger; matching
   the other materials means diameter + rest speed (`TILE_SNAP`), which
   is what "area-based like the others" implies — but it changes how
   fast metal terrain regrows.
2. **Can a composite fracture THROUGH a member, or only along welds?**
   Welds-only is simpler and falls out of `fractureCells = members`.
   Through-member needs nested patterns; avoid.

### Effort

| | |
|---|---|
| Face-snap bonding, lattice deleted | 2-3 days |
| Clicky (turn-to-align + capture) | +0.5 day, rides along |
| Poles + render tell | +1 day, separate follow-up |

Recommended order: phase 1 + clicky first, poles afterwards once the base
bonding feels right — poles change how SELECTIVE assembly is, which is
much easier to tune against something that already feels good.

### The honest trade

The lattice guarantees no overlap BY CONSTRUCTION: integer slots cannot
collide. Free-form face bonding replaces that guarantee with a runtime
check. That is a real loss and the most likely source of a subtle bug.
It is worth it because the guarantee currently protects geometry that no
longer matches the material — but it is a guarantee being given up.

### Code the change touches / deletes

Deletes: `formMetalComposite`, `growMetalComposite`,
`mergeMetalComposites`, `nearestMetalHexSlot`, `addCellToComposite`,
`metalRecomputeBounds`, `decomposeMetalComposite`, `metalConvexHull`,
`GameEntity.metalCells` / `metalExcessCells` / `metalLatticeR`,
`METAL_HEX_CELLS`, `METAL_ASSEMBLY`, `TILE_SNAP.METAL_MAX_EXCESS_CELLS`,
and the metal-composite branches in `tileShapes.ts`
(`drawMetalDebugOutline`, the lattice-seam crack path).
Adds: a face-pair search + snap transform in `ShardSystem`, the
outline-to-outline bond rule, and a weld-strength entry in `GrainSpec`.

---

## Fracture: the erosion cascade — SETTLED (2026-09-07) — user call

**Status: DECIDED, and shipped as it stood.  EROSION KEEPS CASCADING AT THE
FIRST BREAK, and that is the wanted behaviour.**  A glue line stops holding a
grain once the grain on its other side has left, so the rim of an existing
hole is permanently cheaper to remove than untouched material, and drilling
one hole beats spraying.  It is both the physically honest answer for brittle
matter and the better aim incentive.  The alternative — requiring a grain to
have lost a minimum number of its OWN original boundaries, so a departed
neighbour grants no discount — was considered and REJECTED.  Do not implement
it, and do not re-open the question below; it is kept for the measurements
around it, which are still the record of what was tried.

Two things it touched remain LIVE and are not settled by this: a WIDE
(hull-sized) track undercutting a group of grains at once is the "Grain
clusters: several grains leaving as ONE fragment (A4-B)" entry, and OLD CRACKS
NEVER FADING is a RENDERING question — the overlay draws every boundary at its
own accumulated fill, so a first-struck face stays visibly cracked forever
while fresh damage elsewhere adds only faint lines — untouched by this
decision.

The three MECHANICAL defects found alongside this were fixed (detach recoil,
centre-of-area re-centring, and the crack gate — see CLAUDE.md §8 "A DETACH IS
A RIGID-BODY EVENT").

### What was measured

A 159.9-unit mobile rock shard, velocity and spin pinned, shot six times
from +x and then eight from -x.

The user reported that damage keeps propagating at the side first struck.
**That did not reproduce as stated.** `lastImpactLocal` flips with the
shot side every hit and the boundaries taking new fill flip with it:
local x -41..-25 during the +x phase, +46..+25.9 during the -x phase.
Chips detach on the struck side in both. (An earlier reading that said
otherwise was a frame error — the impact is in the body's ROTATED frame
while the chip offsets were world-frame, and the body's rotation was ~pi.)

The pattern's impact bias is not the explanation either: cells near the
first contact are only 1.24x smaller than far cells and their boundaries
cost 3.36 against 3.58 — a 7% asymmetry.

### The mechanism that IS real

**THE EROSION CASCADE.** A boundary stops binding once the cell on its
other side has left.  So the moment one chip comes away, its neighbours
need FEWER broken boundaries — and they already carry damage from the
first volley.  The first wound keeps shedding pieces even while the
player is shooting somewhere else.

Related and correct-but-misleading: **old cracks never fade.**  The
overlay draws every boundary at its own fill, so the heavily-cracked
first side stays heavily cracked forever while new far-side damage adds
only a few faint lines.

### The question — ANSWERED

Should a fresh wound on the far side COMPETE with the old one, or should
erosion keep cascading at the first break?  Real materials do both
depending on toughness, so either is defensible.  If competition is
wanted, the lever is the detach rule rather than the damage spend: a cell
could require a minimum number of ITS OWN boundaries broken (rather than
merely all of its still-binding ones) so a freed neighbour does not hand
it a discount.

**The answer is the cascade** (user call, 2026-09-07 — see the status note at
the top).  The competition lever described above is explicitly not wanted and
must not be built.

---

## Penetration bore tracks as a FRACTURE MODEL (2026-09-06) — user call

> **Step 5 of "Unified impact physics" (2026-09-12) answered items 1–3 for
> PROJECTILES.**  `pierce` and the Penetration module are deleted; every
> round is an energy bank and EVERY hit on a grain body walks its chord
> (`borePierceTrack`), so depth is energy ÷ the material's per-grain price
> and the falloff is `1 - bite/energy`.  Still open: a HULL track (a crash
> deposits at one contact), track WIDTH, and item 4.

**The observation.** Option C's penetration bore — a bolt walking its own
chord through a body, spending one charge and one falloff step per GRAIN
(`PhysicsSystem.borePierceTrack`) — produces a fracture pattern the user
judged notably realistic, and did so as a side effect rather than by
design.  The reason is worth stating because it is what any follow-up has
to preserve: damage is deposited at SUCCESSIVE POINTS along a real path,
each weaker than the last, into a model where damage already lands on
GRAIN BOUNDARIES rather than an HP pool.  So the body is eroded along a
line, most heavily at the entry face, tapering with depth — which is what
a projectile actually does to brittle matter.

**Why this is a parking-lot item and not a bug report.**  The voronoi /
grain gauntlet (PR #91, `docs/GAUNTLET_VORONOI_LOG.md`) attempted richer
fracture behaviour and, by the user's assessment, did not land it in a
desirable form; parts were abandoned.  The bore arrived at something
closer by accident, from a different direction — a WEAPON mechanic rather
than a MATERIAL one.  That makes it evidence about which direction the
material work should take, not merely a feature that happens to look good.

### The investigation

Take the bore's deposition profile — successive contact points along a
path, with a decaying per-point spend — and ask whether it generalises
into the fracture model itself, rather than living only in the
penetration path:

1. **Does every impact want a track, not a point?**  Today a non-piercing
   hit stamps ONE contact and spends there (`stampLocalImpact` +
   `applyBoundaryDamage`).  A shot has a direction and a penetration depth
   even when it does not pierce; giving every impact a short decaying
   track may be the whole difference between the current look and the
   realistic one.  If so, the penetration module stops being the source of
   the effect and becomes a multiplier on its DEPTH, which is a cleaner
   story than the two mechanisms living apart.
2. **What is the right depth for a non-piercing shot?**  Presumably a
   function of damage, projectile size and the material's `bondStrength`
   — not of pierce charges, which are a purchased resource and should not
   be what decides whether matter behaves like matter.
3. **Does the falloff RATE belong to the material rather than the
   weapon?**  **PARTLY ANSWERED by step 3**: it belongs to neither as an
   authored number.  The global knob and the unused per-weapon seam are
   both deleted, and the rate is now DERIVED per weapon from its energy
   bank (step 3: `1 - 1/(1 + pierce)`; since step 5, `1 - bite/energy`).
   The material-side question survives in a sharper form — a stuff's
   `bondStrength` already decides how much energy an advancing shot gives
   up per grain, so a material-specific ABSORPTION rate on top of that
   would need to say what it adds.
4. **Interaction with `damageSpread`.**  The bore works as well as it does
   *because* every material ships `damageSpread: 0`, so each stamp spends
   sequentially outward from its own point.  A non-zero spread would
   smear the track into a blur.  Any generalisation has to decide whether
   spread and track-depth are the same knob wearing two names.

### Related entries — read together

This belongs with the other open tile/shard physics items rather than
beside them, and several of them are the same question from other angles:

- **Grain clusters: several grains leaving as ONE fragment (A4-B)** — the
  bore currently frees grains one at a time; a track that undercuts a
  group is exactly the case that entry is about.
- **The erosion cascade** (SETTLED 2026-09-07: it cascades, and that is
  wanted) / **do old cracks compete with new wounds**, which is a RENDERING
  question and still open — a bore
  track IS a concentrated wound, so it sharpens that entry's open
  question rather than sitting apart from it.
- **Polygonal face bonding for metal** — a bore through a bonded composite
  has no defined behaviour yet.
- **Rotational mechanics for shards and asteroids (2026-08-21)** — a track
  is off-centre by construction, so it implies a torque the solver does
  not model.

### What NOT to conclude

The bore looking right is not evidence that the SPEND profile is right in
general — it is evidence about deposition GEOMETRY.  The V15 grain-
boundary model's own measured lessons still hold (spend order is cell by
cell; a flat nearest-edge sort completes almost nothing until the end),
and any generalisation has to re-measure against them rather than assume
the bore's success transfers.

---

## Hex-slot outfitting — the UI needs a pass (2026-09-06) — user call

**Play-test verdict: the MECHANIC is functional, the SCREEN is not.**  A5
shipped purchasable hex slots and the user tested them working end to end —
a locked hex refuses every way in, the shop offers the next one, the price
ladder climbs, a run reset puts the counts back.  What is missing is the
part that tells the player any of that.

Parked deliberately rather than patched now: the user expects this to be
addressed **during the mining implementation**, which is when the outfitting
screen gets its next real look anyway.  Fixing it twice is the waste.

### What is wrong today

A locked hex is drawn INERT — no `data-tile`, so a drag cannot land on it —
which is correct behaviour and almost no communication.  It reads as a hex
that is simply not there, rather than as one that can be bought.  Nothing on
the OUTFIT tab connects the empty space to the "+1 Hex Slot" line in the
SHOP tab, and nothing names the price without switching tabs.

The underlying design is deliberately minimal and should NOT be re-opened to
fix this — a LOCKED hex is an EMPTY hex that cannot be filled, which is why
the feature needed no change to `HEX_ADJACENCY` or `computeActiveSlots`.  The
work is presentational.

### Open questions for that pass

1. **How does a locked hex read?**  A dashed outline plus a padlock and a
   price is the obvious answer; the risk is that seven of them turn the
   flower into a shopping list and bury the modules the player actually has.
2. **Should the flower itself be the buy button?**  Tapping a locked hex
   could offer the purchase in the detail strip — the same strip that already
   describes a module — instead of routing through the SHOP tab.  That keeps
   one gesture (tap a hex, read about it) meaning one thing.
3. **Where does the ship's GROWTH show?**  There is no readout anywhere for
   "5 of 7 ship hexes" — the count exists on `EngineStats.outfitting`
   (`shipUnlocked` / `weaponUnlocked` / `maxSlots`) and nothing renders it.
   The header already carries `◈` balance and `⬢` cargo; a third chip is the
   cheap answer.
4. **Does the shop entry survive?**  If the flower becomes the buy surface,
   the SHOP tab's "+1 Hex Slot" row is a second path to one action.  Two
   paths is not automatically wrong — the shop is where money is spent — but
   they must not disagree about price or availability, and `slotUnlockCost`
   through the `modulePrice` seam is what keeps that true.
5. **`MODULE_SLOT_UNLOCK.START` is the cap TODAY**, so none of this is
   reachable in a shipped run without DBG ▸ Economy ▸ Salvage & Stations ▸
   "Lock slots".  The balance call — what a hull actually starts with —
   belongs to the economy pass, and this UI work should not settle it by
   accident.

### Related

- **Ship classes** — `SHIP_WEIGHT.HULL_BASE` (0 today) and the slot count are
  the same seam from two directions: a heavier hull that starts with more
  hexes is one table row, and this screen is where the difference would have
  to read.
- The two competing ship-design directions (ship catalog CHOSEN vs modular
  physical ship SUPERSEDED) recorded elsewhere in this file bound how much
  of the flower is worth investing in before that is settled.

---

## Unified impact physics — penetration, crashes and fracture are one mechanism wearing three names (2026-09-06) — user call

**The concern, in the user's words:** penetration "should really be an
inherent behavior based on physics and it may not be" — a ship colliding
with tiles ought to behave the way a piercing bolt does; and since "damage
should be based on energy/momentum, as projectiles lose speed due to
penetration hits, they should also naturally be reducing damage."  The
worry is that the penetration system **overlaps strongly with other physics
mechanics**, and that this has to be resolved before new entities,
projectiles, weapons and materials are built on top of it.

That reading is correct, and this entry is the review it asks for.  It is
the general form of the **"Penetration bore tracks as a FRACTURE MODEL"**
entry above — that one asks whether every impact wants a track; this one
asks whether every impact wants the same *arithmetic*.

### 1. The inventory: how a body can be damaged today

Nine paths, and they do NOT share a model:

| # | path | what it spends | where |
|---|---|---|---|
| 1 | projectile hit | authored `WeaponConfig.damage` | `resolveCollision` projectile branch |
| 2 | pierce bore | the same, per grain, × a falloff RATE | `borePierceTrack` |
| 3 | player crash into a tile | ~~`health -= 1`~~ → boundary damage (§8) | `resolveCollision` player branch |
| 4 | asteroid crash into a tile | ~~same~~ → boundary damage, plus a momentum gate | two `killStructureByImpact` sites |
| 5 | tile pressure | a COUNT of sub-threshold impacts, then boundary damage (§8) | `tilePressureCount` |
| 6 | AoE shockwave ring | authored splash damage | `updateExplosionRings` |
| 7 | lightning chain | authored chain damage | `fireLightningChainFromImpact` |
| 8 | bubble bite | boundary damage, on a cadence | `chipStructureAt` |
| 9 | dragon consume | deletes the tile outright | `consumeTile` |

**Paths 1, 2, 6, 7 and 8 spend on GRAIN BOUNDARIES** (V15) — the physically
grounded model, where HP is *derived* from `Σ (boundary length ×
bondStrength)`.  **Paths 3, 4, 5 and 9 did not**: they decremented `health`
directly or deleted the body.  CLAUDE.md stated that split as a deliberate
simplification ("PHYSICAL smashes still take the whole body: they meter
boulders, not weapons"), and it was exactly the asymmetry the user was
pointing at.

**STEP 2 CLOSED MOST OF IT — see §8.**  Paths 3, 4 and 5 now spend on
boundaries too, so eight of the nine share one model and only path 9 (the
dragon's `consumeTile`, which deletes the tile outright) stands outside it —
as a swallow rather than a hit, which is arguably correct.  What remains open
is the OTHER half of the asymmetry (§9): a bolt bores a pane grain by grain,
while a hull at speed still deposits at ONE point and leaves no track.

### 2. The four overlaps

1. **TWO DAMAGE VOCABULARIES.**  "HP damage" (a scalar decrementing a pool)
   and "boundary damage" (energy spent on interfaces, HP derived from what
   is left).  The second is the real model; the first is a legacy the
   collision paths still speak.  Every new material inherits both.

2. **TWO ENERGY MODELS, one real and one authored.**  **RESOLVED — the
   WEAPON half in step 3 (damage is kinetic), the crash half in step 4 (a
   crash spends its kinetic energy, though its GATES stay authored — §9);
   see §8.**
   Collisions already
   compute genuine mechanics — `impactStrength` is
   `(1+e)·|v_n|·effInv_self/(effInv_self+effInv_other)`, a real velocity
   step, and the crash gate is `mass × impactSpeed > SHARD_CRASH_MOMENTUM`.
   Weapons carry an authored `damage` number with no mass, no speed and no
   relation to either.  The same tile therefore answers to two different
   physics depending on what hit it.

3. **THE FALLOFF IS A SECOND KNOB FOR SOMETHING THE FIRST SHOULD ALREADY
   SAY.**  **RESOLVED in step 3 — both knobs are deleted and the decay is
   derived (`1 - bite/energy` since step 5 retired `pierce`); see §8.**
   `PIERCE_FALLOFF_RATE` decays damage per hit, and
   `PIERCE_SPEED_RETAIN` decays SPEED per hit — and ships at `1.0`, a no-op.
   If damage were kinetic (`½mv²`, or `mv`), the falloff would **fall out of
   the speed loss** rather than being authored beside it.  Two knobs
   describing one phenomenon is the clearest single symptom of the overlap,
   and it is why the shipped falloff rate is 0: nobody could say what the
   right number was, because the number should not have existed.

4. **`pierceCount` IS A BUDGET, WHICH IS NOT A PHYSICAL QUANTITY.**
   **RESOLVED in step 5 — `pierce`, `pierceCount` and `MAX_PIERCE` are all
   deleted and a round authors its `mass` directly; see §8.**  Step 3 made
   the budget physical without removing it (`pierce` sized the energy bank at
   `(1 + pierce)` bites); step 5 removed the count.  A shot
   gets N discrete charges regardless of what it hits — a 36px pane and a
   200-unit boulder each cost the same charge (the bore softened this
   *within* a body but not between bodies).  Under an energy model there is
   no count: a shot stops when its energy is spent, so a bolt crosses thin
   glass and buries itself in metal without either being enumerated.

### 3. The unification, and why it is nearer than it looks

The substrate is already right.  **`bondStrength` is damage per PIXEL of
boundary — dimensionally a specific fracture energy** (energy per unit
area), which is precisely the physical constant this wants.  The proposal:

- **One quantity crosses every impact seam: ENERGY.**  A projectile carries
  `½mv²`.  A hull carries `½mv²`.  Breaking a boundary of length `L` costs
  `L × bondStrength`.  Whatever is spent is subtracted from the mover's
  kinetic energy, and the mover slows accordingly.
- **Damage falloff DISAPPEARS as a knob.**  A bolt that has spent energy on
  three grains is slower, so its next bite is smaller, automatically and
  with the right curve.  `PIERCE_FALLOFF_RATE` and `PIERCE_SPEED_RETAIN`
  collapse into one another and then into nothing.
- ~~**The player bores terrain by the same routine.**~~  **DELIVERED in
  SUBSTANCE, not in form (step 4, §8).**  The user's point was that a hull
  should behave like a piercing bolt, and it now does in the way that
  mattered: it spends kinetic energy on grain boundaries and pays for what it
  breaks.  What it does NOT yet do is deposit along a CHORD — that is the
  parked bore-track entry, and it is a geometry question rather than an
  arithmetic one.
  The original framing:  `borePierceTrack`
  already walks a chord in a body's local frame at `grainSize` steps; a hull
  sweeping through a tile is the same walk with a different energy budget
  and a wider track.  A fast heavy ship ploughs a channel and slows; a slow
  one bounces because it cannot pay for the first boundary.  That is the
  user's first point, and it needs no new mechanism — only for path 3 to
  call what path 2 calls.
- **The crash THRESHOLD becomes a consequence.**
  `CRASH_VELOCITY_THRESHOLD` and `SHARD_CRASH_MOMENTUM` stop being
  authored gates and become "did the impactor bring enough energy to break
  the first boundary" — which is automatically material-dependent, so metal
  resists a bump that shatters glass without a per-material threshold table.
- ~~**A Penetration module stops buying charges**~~ — **RESOLVED in step 5,
  and the answer was to DELETE the module (user call).**  It was to start
  buying sectional density instead; what the measurement showed is that
  sectional density is exactly what GUNNERY already buys once `damageFrac`
  scales the mass as well as the bite, so a second module selling the same
  physical property had nothing left of its own to sell.  See §8.

### 4. What must NOT be unified

Named explicitly, because a unification that swallows these will be wrong:

- **ACTORS ARE NOT STRUCTURES.**  The player, enemies, bosses and fauna have
  authored HP pools, shields, armour, front-shields and regen — all of them
  *authored-damage* concepts and all of them load-bearing for the
  counterplay layer (`docs/WEAPONS_AMMO_PLAN.md` §7).  The unification
  belongs to STRUCTURAL bodies; the seam between the two needs exactly one
  documented conversion, and that conversion is where balance lives.
- **`damageSpread: 0` is load-bearing for the bore.**  The track works
  because each stamp spends sequentially outward from its own point.  Any
  energy model has to preserve that, or the track blurs (V15's own measured
  lesson).
- **Presentation must not be re-derived.**  Shake, audio gain and rumble
  already come from `impactStrength`, and CLAUDE.md's rule is that how hard
  a hit reads to the eye and to the ear cannot drift apart.  An energy model
  should FEED that one number, not add a second.

### 5. Cost, and the order to do it in

This is a multi-session change and should not be started inside a feature
PR.  The honest sequencing:

1. ~~**Measure first.**~~  **DONE (2026-09-07)** — `perf/impact-audit.mjs`,
   and §7 below is its result.
2. ~~**Route paths 3, 4 and 5 through `applyBoundaryDamage`**~~ — **SHIPPED
   (2026-09-07)**, see §8 below.
3. ~~**Make projectile damage kinetic**, retire the falloff rate and the
   speed retain~~ — **SHIPPED (2026-09-11)**, see §8 below.  §7's warning
   that "the implied conversion constant is not a constant" turned out to be
   an artefact of `PROJECTILE_CONSTANTS.MASS`, not a property of the roster.
4. ~~**Give hulls a bore track**~~ — **SHIPPED (2026-09-11) as an energy
   spend rather than a track**, see §8 below.  The measurement changed what
   this step had to be: a hull ALREADY passes through terrain, so what was
   missing was not passage but that the speed it lost had nothing to do with
   what it broke.  A per-grain hull track is still open, and is now purely a
   DEPOSITION-GEOMETRY question — see the "Penetration bore tracks as a
   FRACTURE MODEL" entry, which is where it belongs.
5. ~~**Revisit `pierceCount`**~~ — **SHIPPED (2026-09-12)**, see §8 below.
   Removing the budget did change what the Penetration module *is*, and the
   user's call was that it is nothing: penetration is emergent, so the module
   is deleted and Gunnery absorbs it.

### 6. Related entries — this is the hub

- **Penetration bore tracks as a FRACTURE MODEL** — the deposition-geometry
  half of the same question.
- **Grain clusters: several grains leaving as ONE fragment (A4-B)** — what a
  wide (hull-sized) track should free.
- **Fracture: the erosion cascade** — SETTLED 2026-09-07: erosion keeps
  cascading at the first break, and that is the wanted behaviour.  What is
  still live beside it is a RENDERING question (old cracks never fade).
- **Polygonal face bonding for metal** — bonded composites have no defined
  bore behaviour.
- **Rotational mechanics for shards and asteroids** — a track is off-centre
  by construction and therefore implies a torque the solver does not model.
- `docs/MATERIAL_GRAIN_SPEC.md` — the PROPOSED unified bonding system, which
  this entry is the impact-side counterpart to.

### 7. What step 1 MEASURED (2026-09-07)

`perf/impact-audit.mjs` reads all of this out of the REAL engine in a real
browser: derived HP through `applyBoundaryDamage`'s own model build, weapon
numbers off a LIVE spawned projectile, the velocity step from
`PhysicsSystem.impactStrength` itself, and the ram counts through the real
player-crash branch of `resolveCollision`.  Re-run it rather than quoting
these numbers after any grain or weapon change.

**Derived HP per material** (n=60 bodies each, 36.2-unit tiles):

| material | tile derived (mean) | tile band | shard derived | shard band | shard AUTHORED |
|---|---|---|---|---|---|
| rock | 54.3 | ±6.5% | 7.7 | ±27% | 8 |
| glass | 49.7 | ±11% | 15.8 | ±38% | 12 |
| plastic | 391.3 | ±3.3% | 59.0 | ±27% | 24 |
| metal | 469.6 | ±2.1% | 50.3 | ±17% | 16 |

Two things the shipped grain table does not say.  **Shard bands are 3-6×
wider than tile bands** — a fixed damage figure asserted against a shard is
inside that band, which is `tests/README.md` rule 11's flake class.  And
**`ShardSystem.spawnShardHealth`'s authored numbers disagree with the derived
ones by up to 3.7×** (plastic 24 vs 59.0, metal 16 vs 50.3); only rock agrees.
Also worth knowing: **no map populates `rock-tile` except ROCK_FIELD** — rock
in a real arena is mobile shards only.

**The weapon side.**  Every projectile has `mass: 1`; only speed varies.

| weapon | dmg | speed | KE=½mv² | p=mv | KE/dmg | p/dmg |
|---|---|---|---|---|---|---|
| Blaster | 4 | 16 | 128 | 16 | 32.0 | 4.00 |
| Burst Rifle | 5 | 20 | 200 | 20 | 40.0 | 4.00 |
| Shotgun | 3 (×6) | 20 | 200 | 20 | 66.7 | 6.67 |
| Laser | 5 (×3) | 30 | 450 | 30 | **90.0** | 6.00 |
| Lightning | 9 | 26 | 338 | 26 | 37.6 | 2.89 |
| Seeker | 8 | 12 | 72 | 12 | **9.0** | 1.50 |
| Plasma Cannon | 18 | 18 | 162 | 18 | **9.0** | 1.00 |

**The implied constant is not a constant: 9 → 90 KE per point of damage, a
10× spread** (momentum 1.00 → 6.67, 6.7×).  The Seeker and the Cannon sit at
the cheap end by construction — slow shells that hit hard — and the Laser at
the expensive end, so ANY single conversion in step 3 re-prices those against
each other by an order of magnitude.  That is the roster re-balance,
quantified.

**The crash side.**  Player mass 100 (lean outfit), cruise 33.3 u/step; `dv`
is `impactStrength`'s own output.

| path | at | m | v | dv | KE | p |
|---|---|---|---|---|---|---|
| player → static tile | gate (`CRASH_VELOCITY_THRESHOLD` 4) | 100 | 4.00 | 6.00 | 800 | 400 |
| player → static tile | cruise | 100 | 33.26 | 49.89 | 55302 | 3326 |
| shard → static tile | `SHARD_CRASH_MOMENTUM` 200, m=40 | 40 | 5.00 | 7.50 | 500 | 200 |
| shard → static tile | same gate, m=100 | 100 | 2.00 | 3.00 | 200 | 200 |
| shard → static tile | same gate, m=400 | 400 | 0.50 | 0.75 | 50 | 200 |
| tile pressure (×5) | m=40, half gate | 40 | 2.50 | 3.75 | 625 | 500 |

**The two gates disagree about what a gate is.**  The player's is pure SPEED
— mass never enters, so a fully-outfitted ~3× heavier ship crosses it at the
same 4 u/step.  The asteroid's is MOMENTUM, and over the live shard
population on ASTEROID_FIELD (n=1200, mass 7.3..460.8) one momentum gate
spans 43 → 2747 energy, a **63× spread**.  (The constant this entry and CLAUDE.md
used to call `ASTEROID_CRASH_MOMENTUM` is named `SHARD_CRASH_MOMENTUM` in
`constants.ts`; both docs were corrected to the code name in step 3.)

**How far apart the two sides are.**  Weapon side 9..90 KE per derived HP
(10× spread); crash side on a virgin tile 37..459 (12.6× spread).  The two
ranges barely overlap and each is internally spread ~10×.  **So the energy
proposal's SUBSTRATE holds — `bondStrength` really is a specific fracture
energy and the derived HP behaves as one — but NO SINGLE CONSTANT FITS
TODAY'S GAME.**  Step 3 is a deliberate re-pricing, not a refactor.

### 8. What shipped (steps 2–5 and their follow-ups)

Every step in §5 shipped between 2026-09-07 and 09-12, and every play-test
follow-up after it by 09-21.  The RULES they left are current, and live in
CLAUDE.md: §5 (WEAPONS — the energy bank, the base-bank trim, the Cannon's
detonation and derived blast) and §8 (the crash spend, the sweep, the glass
rule, the mass scale, the nebula condensation ledger, the blast-and-cloud
rule).  `perf/impact-audit.mjs` re-measures what they left (its §5 crash
counts, §7 mass scale, §8 penetration and blast).  The per-step ledger that
stood here — steps 2–5 and follow-ups 12–23, with every measurement, bug and
lesson — is in git history at `ca0ad8e` (this file, before the 2026-09 docs
cleanup).

- **Step 2 (09-07)** — crashes spend on grain boundaries
  (`PhysicsSystem.crashBoundaryDamage` / `crashContactOn`), so shooting a
  tile no longer makes it 4-50× harder to ram through.
- **Step 3 (09-11)** — projectile damage is kinetic
  (`IMPACT_ENERGY_PER_DAMAGE`, the one conversion §4 asks for); the two
  falloff knobs are deleted, and `estimateBoundaryHp` closes the spawn-HP
  mismatch.
- **Step 4 (09-11)** — a crash spends its kinetic energy (`crashDamageFor`:
  reduced mass × `CRASH_ENERGY_COUPLING`) and the impactor pays for what it
  broke (`payForCrash`), replacing the flat `CRASH_VELOCITY_RETENTION`.
- **Step 5 (09-12)** — `pierce`, `pierceCount`, `MAX_PIERCE` and the
  Penetration module are deleted; a round authors its `mass` (its energy
  bank), Gunnery scales bite and mass together, and the Plasma Cannon trips
  only on ACTORS, with a fuse fallback (`detonateOn`, `fuseSeconds`).
- **Follow-ups (09-12 → 09-17)** — `sweepRewind`, so a fast ship cannot fly
  through terrain; a ram that holds bounces and is charged nothing; glass
  loses its whole-pane crash rule; mass becomes a stated scale
  (`IMPACT_DENSITY` / `massFor`, `HULL_DENSITY_CYCLE`) and then
  `MASS_SCALE` = 10, un-compensated; the base bank is re-based and trimmed
  (`BASE_BANK_DIVISOR` = `GUNNERY_MK3_TRIPLE_MULT` / `BASE_BANK_TRIM`); the
  blast is the shell's own energy (`blastDamageFor`, `BLAST_ENERGY_COUPLING`
  0.4, ring × √mult), is payload rather than travel energy, and fires when a
  shell stops (`blastPending`, at most once via `detonated`); a condensing
  nebula cloud mostly stays nebula (`NEBULA_TILE_SHARE_CYCLE`, origin-blind)
  under the `NEBULA_MATERIAL` ledger; and a blast breaks cloud up rather than
  deleting it (`breakYieldsNothing`, `blastImpulse`).
- **09-21** — the glass-leap gap is closed (`SWEEP_DEEP_FRAC`, d15a63e): a
  body that arrives DEEP is rewound as well as one that outran its step.

### 9. Still open

1. **A hull deposits at ONE contact, not along a chord.**  `sweepRewind` is
   contact recovery, not continuous collision detection — it puts a body
   back where it met one thing, and neither sweeps a corridor nor deposits
   along the chord it cut — and the bore is a line rather than a track with
   width.  Both are geometry questions: "Penetration bore tracks as a
   FRACTURE MODEL" and "Grain clusters (A4-B)".
2. **The crash GATES are still authored.**  `CRASH_VELOCITY_THRESHOLD` (the
   player's, pure speed) and `SHARD_CRASH_MOMENTUM` (a shard's, pure
   momentum) still decide WHETHER a crash spends at all, so §3's fourth
   bullet — the threshold as a consequence of energy — is not delivered.
3. **Should the hull sit so far above the material band?**
   `IMPACT_DENSITY.HULL` is 2.50 against the materials' 0.10–0.30 — by design
   (a ship is a machine and should plow gravel), but not re-reviewed since
   `MASS_SCALE` made every impact ten times harder.  DBG ▸ Player & Ship ▸
   Impact Model ▸ "Hull density" is the A/B.
4. **Path 9 in §1's table is not the path that runs.**  `consumeTile` is
   unreachable — `updateConsumers` walks `entityIndex.shardCandidates`,
   which holds no static tiles — and the dragon devours terrain through its
   own pass in `engine/roamers/dragons.ts` (`forEachStaticNear` →
   `appendDragonSegment`, the tile becoming a body segment).  Either way it
   stands outside the boundary model, which is arguably correct; what wants
   deciding is the dead `eats: 'tile'` branch.

---

## Portal double-tap re-entry, and the music timings it sits beside (2026-09-22) — user call

**Parked from the PR #94 music-linger fix**, where the second half — the
battle layer standing down on a map change — landed and the first half was
deliberately left alone.  Both are about the same moment (the frame after a
transit) and both are TUNING rather than architecture, which is why they are
one entry.

### 1. A double-tap on a portal flies straight back out

**Reported**: flying into a portal and immediately flying back out of it,
from one double click.

**The mechanism is established, not guessed** — three shipped rules that are
each correct in isolation:

- **The fire queue is never drained during the warp beat.**  `loop()` returns
  above the sim while `portalWarpTimer > 0` (`GameEngine.loop`), so
  `getFireEvents()` — the weapon tick, sim step 7 — does not run for the whole
  `PORTAL_WARP_CYCLE[0]` = **1.4 s**.  `InputSystem.fireEvents` is an unbounded
  array cleared only by that drain (and one-at-a-time by `claimTapNear`), and
  the DOM listeners keep pushing to it throughout.  A human double-tap lands
  its second event ~200 ms in, so it is inside the window by a factor of
  seven.
- **Arrival is inside interaction range, on purpose.**
  `PORTAL_CONSTANTS.ARRIVAL_OFFSET` is **165** against `USE_RANGE` **240**,
  and the constant's own comment says why: *"the rift stays on screen and
  still in USE_RANGE, so turning around is one tap."*  Wanted behaviour —
  an arena you entered by mistake is one tap to leave.
- **`updateInteractables` claims the stale tap on the first post-warp
  substep.**  It runs as sim step 5b, ahead of the weapon tick, and
  `claimTapNear` takes the oldest queued event within `SHIP_SELECT_RADIUS`
  (46) of the hull — which the second tap of a double-click on the ship is by
  construction.

So the bounce is not a race or a mis-tuned radius: it is a **press banked
across a freeze**, spent at the one place in the run where the player is
guaranteed to be standing in a portal's mouth.

**The E key is immune and the pad is not**, which is a useful tell for
anything that fixes this.  `dockKeyHeld` is only updated where E is read —
`updateInteractables`, and the undock check while docked, neither of which
runs during the warp — so a key held (or released and re-pressed) through the
frozen window still reads as held and cannot re-trigger.  The pad's
`padInteractPresses` is a COUNTER, and `pollGamepad` runs at the top of
`loop` above every freeze short-circuit, so a pad double-press banks exactly
like a double-tap.

**Directions, none chosen:**

- **Drain the queue at the transit.**  Clear `fireEvents` (and the pad latch)
  when `transitionToMap` arms the warp — the same argument the INTERACT latch
  already makes for docking: *a press made while the world was frozen must
  not be spent on the world that replaced it.*  Cheapest, and it generalises
  to any future freeze.  The thing to check is whether it also eats a shot
  the player legitimately queued on the far side.
- **A post-arrival interaction cooldown.**  A few hundred ms in which the
  arrival rift refuses `enterPortal`.  Directly expresses "you just came out
  of this", but it is a new piece of state and a new number.
- **Move the arrival out of range.**  Raising `ARRIVAL_OFFSET` past
  `USE_RANGE` kills the turn-around-in-one-tap property the comment defends.
  Recorded to be ruled out, not to be done.

Note the FIRST option makes the warp beat's length irrelevant to the bug,
which matters because that beat is DBG-cyclable from 0 to 10 s — a fix keyed
to its duration would be wrong at both ends of the cycle.

### 2. Music timings, now that the layer stands down correctly

The PR #94 fix (`lastHostileNearAt = -Infinity` in `loadMapFresh`) makes a
map change end the fight, and the user's read is that it "cools down the
music" — i.e. the behaviour is right and the NUMBERS are the open question.
The shipped set, all in one place so a tuning pass has a baseline:

| knob | value | what it decides |
|---|---|---|
| `MUSIC_ENGAGE_SCREENS` | 1.35 | how close a hostile must be to raise the layer |
| `MUSIC_RELEASE_SCREENS` | 2.2 | how far it must be gone before the fade can start |
| `MUSIC_LINGER_SEC` | 6 | quiet sim-seconds before the fade begins |
| `FADE_IN_SEC` | 0.75 | ramp CONSTANT up (≈2.3 s to ~95%) |
| `FADE_OUT_SEC` | 0.8 | ramp CONSTANT down (≈2.4 s to ~95%) — halved since |
| `HANDOVER_SEC` | 0.12 | song → next song at a track's own end |
| `BATTLE_PAUSE_DELAY_MS` | 2400 | when the ducked track actually pauses |
| levels | 0.15 / 0.28 / 0.12 / 0.34 | menu / explore / ducked ambient, battle |

**The questions worth asking with a controller in hand:**

- **Is a fled fight 6 s + ~2.4 s of tail?**  `MUSIC_LINGER_SEC` is graded for
  a LULL inside one arena (the field empties on every wave clear), and the map
  change now bypasses it entirely.  But WITHIN an arena, breaking off a boss
  fight and flying to the far side still costs ~8.4 s before the battle layer
  is gone.  That may be right — a boss you ran from is not a boss you beat —
  or the linger may want to be shorter now that the definitive case is handled
  elsewhere.  **Note the tail half of this has since been halved** (the fade
  went 1.6 → 0.8, user call), so what is left open is the LINGER, not the
  fade.
- **Do engage and release want to be asymmetric by MORE?**  0.85 screens of
  hysteresis stops the gain pumping as the player drifts; whether it stops
  the *layer* pumping across a wave's spawn geometry has not been measured.
- **`BATTLE_PAUSE_DELAY_MS` is derived from `FADE_OUT_SEC`**, so retuning the
  fade silently moves when the resume-on-the-same-bar behaviour arms.  That
  coupling is correct and should stay derived — but it means the fade cannot
  be tuned without re-checking that the pause still lands after it rather
  than racing it.
- **Boss music always restarts a track** (the PR #101 behaviour).  A MAP
  CHANGE now does too (user report: re-entering an arena resumed the previous
  song mid-phrase), so there are two cues rather than one.  What is still
  untested is whether they read as different events: fleeing a boss and
  returning fires BOTH, and should not be indistinguishable from starting a
  second boss.

**What is NOT open**: the map-change stand-down itself, the map-change track
cue, the halved `FADE_OUT_SEC`, and the `setTargetAtTime` ramp shape.  All
settled — see `docs/AUDIO_AUTHORING.md`, *A MAP CHANGE IS NOT A LULL* and
*A MAP CHANGE ALSO STARTS A NEW SONG*.

---

## Audio ideas retired with `docs/AUDIO_PLAN.md` (2026-09 docs cleanup)

Two ideas from that deleted pre-audio plan were never built; the full text is
in git history at `ca0ad8e`.  A music DIRECTOR driven by a table of game
states (hub vs arena, wave vs grace, threat, boss phase, docked, death)
rather than today's one combat-proximity switch, with REGIONAL beds as a
property of the area node (see "Area composition"); and scheduling cues on
the `AudioContext` clock, so a multi-step frame does not machine-gun sounds
that should be simultaneous (`play()` starts every voice at `currentTime`).
