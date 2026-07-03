# Omni — Parking Lot

Ideas worth revisiting but not blocking current work.
Add entries freely; revisit during planning.

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

## Generalize the projectile-deflection function

**Context:** `PhysicsSystem.tryArcShieldIntercept` currently hard-codes the
deflection logic to the Bulwark's directional arc shield: it reflects a
covered projectile's velocity about the radial normal, snaps it to the ring,
drains the shield, and sparks. The *deflection mechanic itself* (reflect a
projectile off a surface, re-own it, FX) is reusable and worth extracting.

**Future use cases:**
- A player-side **deflector / parry** ability or a reflective shield module
  that bounces enemy fire back at its source (re-owning the bolt to PLAYER).
- **Reflective tiles / hazards** (mirror walls) that ricochet any projectile.
- A boss **spin-reflect** phase, or an enemy that parries on a timing window.
- Deflect-with-redirect (home the reflected bolt at the nearest hostile)
  rather than a pure mirror.

**Shape to aim for:** a small helper like
`deflectProjectile(proj, surfaceNormal, opts)` that does the reflect + snap +
rotation + optional re-own / speed-scale / spread, with the caller deciding
when it fires (arc-shield gate, tile SAT normal, parry window, …). The bouncer
weapon's tile-reflection math (`resolveCollision` isBouncer branch) is a
second existing reflection implementation — fold both onto the shared helper.

**Gotchas:** keep it toroidal-safe (snap position relative to the surface
owner, re-wrap after), preserve `hitEntityIds`/`pierce` semantics, and avoid
immediate re-trigger (the arc version gates on `v·n < 0` so an outward bolt
isn't re-deflected).

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
  `tryArcShieldIntercept` (Bulwark arc shield) already gate whether a shot
  connects by bearing. A mounted turret is the same sector flipped to a
  *vulnerable* arc facing the exposed normal: shots from OUTSIDE the arc spark
  off the armored casing (deflect/no-op), shots from inside land. Best built
  on top of the parked "generalize the projectile-deflection function" helper.
- **Stationary AI.** Turret is already `maxSpeed:0` with the no-move branch —
  fixed mount position needs no physics changes. Aim is just clamped to the
  outward arc (it already rotates to track; bound the rotation so it holds fire
  when the player is behind the cluster).
- **Lightning/AoE bypass.** AoE already ignores shields; extend the same
  exemption (plus lightning) to the turret's directional gate.

**Genuinely new work:**
- **Tile↔turret link.** Add `mountTileId` (+ outward normal angle) on the
  turret; each step it reads the mount tile's alive state to toggle
  protected/exposed. VERIFY FIRST: does ShardSystem regen REUSE the same tile
  entity id (link survives) or spawn a fresh one (link breaks → re-acquire by
  position)? Pick the approach after checking.
- **Map placement.** No "place enemy X on tile Y" authoring path exists today
  (maps populate procedurally in `MapClasses.populate`). Add a pass that finds
  exterior cluster tiles (≥1 empty hex neighbour), picks an exposed face, and
  spawns a turret there facing the outward normal — density/placement as a
  per-map knob, since these are designed hazards.
- **Exposed-kill state.** A flag that, while the mount tile is gone, drops the
  directional gate AND makes the turret take full damage (≈1-shot feel).
- **Wave accounting.** As map features they must NOT count toward wave
  completion — depends on the planned **Stage-2b `countsTowardWave`** flag
  (non-wave entities). Slot this after that refactor lands.

**Gotchas:** torus-correct the mount normal + bearing math (`wrapDeltaX/Y`);
mount on a predictable-regen tile variant (rock/metal) so the exposure window
behaves; a turret whose tile never regens (e.g. nebula-off) stays a one-shot
kill once broken — fine, but intentional. Sequence: do the deflection-helper
generalization + Stage-2b accounting first, then this is mostly composition.

---

## Trail Gradient Caching

**Context:** `renderTrails` in `RenderSystem.ts` calls `ctx.createLinearGradient` every frame
for the player engine trail. Trail coordinates change each frame (trail points move with the
ship), so the gradient can't trivially be reused across frames. The payoff is smaller than the
drop-loop and tile-gradient fixes already landed.

**Options to explore:**
- Pre-render the trail to an offscreen canvas at a fixed orientation, then `drawImage` rotated.
- Only recreate the gradient when the trail length or heading changes significantly.
- Replace with a pre-computed alpha ramp applied to a solid-color polyline (saves gradient
  object creation at the cost of a slightly different look).

---

## Exotic Enemy Types + AI Taxonomy / Wave-Accounting Refactors

**Context:** Wishlist of more "alien/foreign" enemies with richer behavior variety:
aggro-on-hit-only soft-body bubbles (wander, eat shards, grow, multiply, stick to
entities and disable weapon/shield only when provoked); a large snake/dragon roamer
that appears/leaves via portal and consumes tiles/shards to grow; small swarm enemies
released by a nest entity; static base-defender homing-missile turrets. Feasibility is
good — the bottleneck is not render/physics but two structural gates plus a few
reusable mechanics.

**Already-built primitives to reuse:**
- **Snitch** (`GameEngine.updateSnitch`/`spawnSnitch`): persistent, engine-managed
  special entity riding the flow field with burst/coast AI, comet tail, and its own
  appear/leave lifecycle — the template for any roamer (esp. the dragon).
- **Status framework** (`StatusEffectKind`/`EffectPayload`/`StatusEffect`): already
  generic; reserved "Disruptor"/EMP kind is the home for weapon/shield disable.
- **Homing projectiles** (`homing`/`homingStrength`/`targetEntityId`): the turret's
  missiles are a weapon config away.
- **Shard merge/grow** (`composeEntities`, `mergeCount`, `densityTier`, TILE_SNAP):
  model for the bubble/dragon eat→grow→multiply loop.
- **Aggro hooks** (`aggroTimer`, aggro-on-nearby-death): partial precedent for
  "provoked on hit."
- **Tile-destroy → FlowFieldGrid incremental patch**: a dragon eating tiles plugs in.
- **PACK_SYNC**: half of "swarm" flocking already exists.

**Per-idea verdict (effort, low→high):**
- *Static homing-missile turret* — easiest, near-buildable today. New work: a no-move
  AI branch (skip movement, keep aim) + a homing weapon config.
- *Swarm + nest spawner* — low risk. New work: static spawner entity; **wave-clear
  accounting** for brood.
- *Snake/dragon portal roamer* — medium-high; great mini-boss (roadmap wave-8 slot).
  New work: segmented body + per-segment collision, portal FX. Reuses Snitch lifecycle.
- *Aggro-on-hit soft-body bubble* — highest (multi-PR). New work: passive/reactive AI,
  consume-grow, multiply (with hard cap), attach-to-target disable, soft-body render.

**Two structural gates to clear FIRST (so each new enemy doesn't fight the architecture):**
1. **AI taxonomy is rigid.** Today `ENEMY_ROLE` ∈ {RAMMING, SHOOTING} → exactly two
   routines (`updateBasicDogfighter`, `updateSkirmisher`) with an idle/chase state
   machine. Refactor toward a **behavior-dispatch table** (per-subtype
   movement/targeting/special function map) before adding wildly different behaviors.
2. **Wave completion accounting.** A wave ends when *budget spawned AND every spawned
   enemy dead*. Self-replicating bubbles, nest brood, and portal roamers all break
   "is the field clear?" Add an explicit rule — a `countsTowardWave` flag, or track
   brood under a parent (kill nest → clear swarm). The Snitch sidesteps this by being a
   non-enemy INTERACTABLE with its own lifecycle (good model for the dragon).

**Three reusable mechanics to build once (not per-enemy):**
1. **Provoked flag** stamped in the PhysicsSystem projectile-damage path (passive-until-hit).
2. **Generalized consume-and-grow** ("A absorbs B → A grows, B deactivates"), as a
   PerfController-gated neighbor pass with a hard entity cap (`enforceCap`-style) to
   stop runaway multiplication.
3. **Attach + disable** — `attachedToId` (snap to target each frame) + a `disable`
   StatusEffectKind. Generalizes to grapples/EMP later.

**Gotchas:** the world is a torus with no edges — "appears/leaves via portal" is a
spawn/despawn-with-VFX event, not off-map traversal. All new neighbor scans must use
`wrapDeltaX/Y` and register a `PERF_TASKS` entry (no private frame counters).

**Suggested sequence:** turret → (AI behavior-dispatch refactor + wave-accounting flag)
→ swarm+nest → provoked/disable mechanics → bubble → dragon mini-boss.

---

## Damage-triggered health / shield bars (remove always-on bars)

**Context:** Every player and enemy currently draws a persistent floating
health bar (and the player a shield bar) every frame via
`RenderSystem.renderHealthBar(entity, rx, ry)`. They're always on, even at full
health and even on trivial one-shot enemies, which clutters the screen and
reads as "tracked HUD" rather than world feedback. The goal: **stop drawing
bars by default** and instead **flash a bar in only when the entity takes
damage**, fading it back out shortly after — so a bar is a hit reaction, not a
permanent label.

The bubble already set the precedent for per-entity suppression
(`renderHealthBar` early-returns on `enemyShape === 'bubble'`, plus gnats are
implicitly fine since they're 1-HP). This generalizes that idea to everyone.

**Already-built hooks to reuse:**
- **`RenderSystem.renderHealthBar`** — single draw site for player + enemy bars;
  gate its body on a visibility timer instead of always drawing.
- **`hitFlash`** (and player **`shieldHitFlash`**) — already stamped on the
  entity at most damage sites and decays each frame. The bar's appear-on-damage
  trigger wants the *same* stamp sites but a *longer* linger than the brief
  whiten flash, so add a dedicated `healthBarTimer` rather than overloading
  `hitFlash` (whose short lifetime drives the scale-punch/whiten).
- **`UI_CONSTANTS.HEALTH_BAR`** — already the home for widths/heights/offsets;
  add `SHOW_DURATION` + `FADE_DURATION` here.
- **Generalized shields** — `shield`/`maxShield` now live on any entity (Bulwark),
  and shield absorption is entity-agnostic (PhysicsSystem + AoE). So the shield
  bar should show for ANY shielded entity on a shield hit, not just the player.
- **Player HUD** — `EngineStats.playerStats` already feeds a persistent
  health/shield readout in `UIOverlay`, so the player's *floating* bar is
  redundant; it can become on-hit juice only, or be dropped entirely for the
  player (HUD is the canonical readout) while enemies keep the transient bar.

**Proposed system:**
1. Add `healthBarTimer?: number` to `GameEntity`. Stamp it to
   `HEALTH_BAR.SHOW_DURATION` at every site that reduces `health` OR `shield`.
2. Centralize the stamp: a one-line `markDamaged(entity)` helper (sets
   `hitFlash` + `healthBarTimer` together) called from the damage paths —
   PhysicsSystem projectile-damage path, the AoE shockwave loop
   (`updateExplosionRings`), ram/crash damage, kamikaze blast, the corrosion /
   bubble-latch drains, lightning. (These sites already set `hitFlash`
   piecemeal; folding both into one helper is the minimal viable
   centralization — a full `applyDamage(entity, amount, opts)` is a bigger
   refactor and optional.)
3. Tick `healthBarTimer` down each frame (a cheap pass, or decay inside
   `renderHealthBar` using `dt`/`performance.now()` like other render timers).
4. `renderHealthBar` draws only while `healthBarTimer > 0`, easing alpha over
   the last `FADE_DURATION`. Draw the shield bar for any `maxShield > 0` entity
   (drop the player-only gate). Keep the bubble / gnat suppression.

**Considerations / edge cases:**
- **Bosses / priority targets**: some enemies *should* keep a persistent bar.
  Add an opt-in `alwaysShowHealthBar?: boolean` (or a per-archetype flag) so the
  dragon / future bosses bypass the timer.
- **Full-health never-hit** entities show nothing (desired) — the bar only ever
  appears post-damage.
- **Regen enemies** (planned trait): a bar refilling after the timer expired is
  invisible; that's fine (the player only needs the readout during/after a
  trade), but if it feels off, re-stamp the timer on regen ticks too.
- **Player floating bar**: decide explicitly — remove it (rely on the HUD) or
  keep it as a brief on-hit flash. The HUD already covers the persistent need.
- **Perf**: this is a net *reduction* in draw calls (most entities draw no bar
  most frames); the only new cost is a per-entity timer decrement.

**Tuning knobs:** `UI_CONSTANTS.HEALTH_BAR.SHOW_DURATION` /
`FADE_DURATION`; the existing width/height/offset entries; the optional
`alwaysShowHealthBar` flag for bosses.

---

## Fine-tune pass: Stage-5 bubble + swarm (this session's enemy work)

**Context:** A fast iteration session reshaped the SWARM gnat default and built
out the BUBBLE into a full ambient third-party creature. The feel is broadly
GOOD as shipped — this is a low-priority "come back and polish the numbers"
item, not a redesign. Everything below is data-driven (constants), so tuning is
edit-and-playtest with no structural work.

**What changed this session (so the tuning has context):**
- **Swarm gnat default** → `weave` (serpentine), still DBG-cyclable (Player ▸
  "Gnat move").
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
  **off-screen chevrons** (bubble + snitch).

**Tuning checklist (current values → things to feel out):**
- **Aggro triggers:** `BUBBLE_CONSTANTS.COLLIDE_AGGRO_SPEED` (3.5 — the
  "more than a light touch" ram threshold; watch for gentle grazes provoking, or
  hard rams not) · `AGGRO_LOSE_RANGE` (950 — leash).
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
- **Toxic detection:** `isToxicShard` flags plastic + **green-dominant nebula**
  shards via a hex-channel check — if some green nebulae miss (or non-green trip
  it), switch to a specific nebula-variant/palette test instead.
- **Sickness:** `SICK_DURATION` (2.8) · `SICK_SPEED_MULT` (0.3) · `SICK_COLOR`.
- **Population / passive feel:** `AMBIENT_POPULATION` (5) ·
  `AMBIENT_RESPAWN_INTERVAL` (4) · `multiply.atSize` (50) / `maxPopulation` (14)
  · `DRIFT_SPEED` (2.2) · `SHARD_VISION` (280) · `CALM_VISIBILITY` (0.45).
- **Render polish (optional):** the squash-cling amount + EMP-arc look are
  inline in `RenderSystem.drawEnemyShape`'s bubble branch; enemy latches get the
  squash but no arcs (arcs are the player-only EMP tell) — could add a chew FX
  for enemy latches.

**All knobs live in:** `AI_CONFIG.BUBBLE` (movement), `BUBBLE_CONSTANTS`
(engagement/sickness/ambient), and the `ENEMY_VARIANTS.BUBBLE` `consume` /
`multiply` blocks — all in `constants.ts`.

---

## Rival ships (Stage 7) — polish + tuning follow-ups

**Context:** Rivals shipped as bespoke engine-managed roamers
(`GameEngine.updateRivals`, `RIVAL_CONSTANTS`) — player-like privateers that
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
  the kill, a running per-rival `stolen` tally (already tracked on
  `RivalInstance`) surfaced in the HUD, or a brief tether/flash.
- **Enemy↔rival collateral.** Today enemies can't damage rivals (friendly-fire
  filter), so rivals are only threatened by the player. Consider letting some
  enemy fire hit rivals (make them `thirdParty`, or a `hitsRivals` flag) so the
  battlefield is a real three-way.
- **Ally value.** Allies help by thinning enemies but still deny loot/points —
  net they may feel bad. Consider allies occasionally gifting a drop, reviving a
  combo, or drawing aggro without stealing.
- **Cadence / wave integration.** Spawn cadence is a flat timer while a wave is
  active (`SPAWN_INTERVAL ± SPAWN_VAR`, capped `MAX_RIVALS`). Tie frequency /
  disposition mix / count to wave index or difficulty; maybe a "rival wave".
- **Combat depth.** All rivals use one blaster. Give dispositions/sprites
  distinct weapons (the sprite already hints an archetype), evasion, or shields.
- **Bounty / risk balance.** `TIER`-scaled bounty + full loot spray on a
  player kill vs. the time cost of chasing one — needs playtest tuning.

**All knobs live in:** `RIVAL_CONSTANTS` (cadence / stats / weapon / dispositions
/ portal) in `constants.ts`; lifecycle in `GameEngine.updateRivals` /
`spawnRival` / `fireRivalShot` / `rivalVacuumDrops`.

---

## Exotic-enemy roster (Stages 0–7) — balance / tuning pass

**Context:** The exotic enemy roster shipped across Stages 0–7 (PR #67:
Kamikaze, Bulwark, Turret, Swarm+Nest, Bubble, Dragon, Rivals) plus the older
base roster. Each was tuned in isolation during its build; a holistic balance
pass is owed once they all appear together in real timed waves. This is the
BALANCE bucket (feel / numbers) — the separate perf/optimization work on the
new engine-managed roamers is tracked in the plan (`exotic-enemies-optimization`).

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
  (terrain nav, theft legibility, enemy↔rival collateral, ally value). Perf is
  tracked separately in the plan.
- **Dragon** — roam/leave timing, attack cadence once provoked, segment HP,
  the doubling kill payout curve, and how/whether it enters normal play (DBG-only
  today).
- **Kamikaze / Turret / Swarm / Nest** — revisit blast radius, missile homing
  strength, gnat bite, and brood cap against the timed-wave budgets.
- **Cross-roster** — once (f) Timed waves lands, tune per-wave spawn budgets so
  the exotic types are introduced legibly (the scripted teaching waves exist;
  the mix beyond them needs balancing).

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
  `entityIndex.asteroids` list. It is already `PerfController`-gated (`consume`)
  and early-outs for every non-idle consumer, but on a shard-dense field a single
  calm bubble still walks the whole shard list each scan step. A real fix is a
  spatial near-query, but PhysicsSystem only exposes a **static**-grid helper
  (`forEachStaticNear`) today — a `forEachDynamicNear` over the per-frame dynamic
  grid would be needed. More invasive than a zero-behaviour pass warranted.

- **Portal / death particle-burst counts. — RESOLVED (exotic-enemies-opt).** The
  spawn-burst hitch was fully addressed: (1) the cosmetic-ring `validHitIds`
  O(all-entities) scan in `spawnShockwave` now skips for damage-0/knockback-0
  rings; (2) `ParticleSystem`'s per-spawn `enforceTypeCap` O(N) rescans were
  batched to once/frame in the engine loop (zero visual change — the cap and the
  dropped-oldest set are identical); (3) burst counts trimmed ~40 % (enemy death
  16–24/9 → 10–13/5, portal 30/16 → 18/10, dragon death 40 → 24; user-approved
  visual reduction). Left here only as a pointer. NOTE: the same per-spawn
  `enforceCap` pattern still exists for **projectiles** (`ProjectileSystem.spawn`
  → `enforceCap`, MAX_PROJECTILES) — untouched because projectiles are gameplay
  entities (cap timing can affect a frame), a candidate for the same once/frame
  batching if a projectile-heavy weapon ever profiles hot.

- **`maintainAmbientBubbles` / nest brood census.** Small `O(enemies)` integer
  counts run every step. Cheap enough that gating them (they only ACT on a timer)
  is low ROI and risks a spawn-timing wobble; left every-step.

Knobs: `PERF_TASKS` (`consume`), `PhysicsSystem` grids, `EXPLOSION_CONSTANTS` /
`PARTICLE_CONSTANTS` / `MAX_PARTICLES` in `constants.ts`.

---

## Physics / shard broadphase at high entity counts (separate perf pass)

**Out of scope for the exotic-enemies-optimization session** (that pass targeted
the roamers + their render, not the collision/shard subsystem) — logged here as
its own future target.

**Observed (real-hardware Perf REC, iPhone 440×756 dpr3, Tile Heavy, diff 3):** a
dense mobile-shard field (player shattered a lot of tiles) reached **~6,000
entities**, pegging PerfController at **max tier the entire window** (load peak
0.96). The cost profile flipped from render-bound to **sim-bound**: `sim 4.74 ms +
collisions 2.56 ms` vs. `render 2.40 ms`. FPS held median 59 / avg 56 on the phone
(≥55: 86 %, p99 44 ms), so it degrades gracefully — but the dynamic-grid collision
pass + `ShardSystem` broadphase are the steady-state hot path at that scale, NOT
the exotic roamers (16 enemies) or render (flat even at max load).

This subsystem already has substantial machinery (shard-pair AUTO throttling,
collision-sleep, viewport-cull cadence, render LOD, dedicated `PERF_TASKS`), which
is why it stays graceful rather than falling over. A further pass would be its own
deep investigation — candidate levers: cheaper dynamic-grid rebuild / query,
broadphase pair reduction at high density, a `forEachDynamicNear` helper (also
unblocks the parked `updateConsumers` query), and revisiting the shard-merge cull
rate under max load. **Delicate** (merge / regen / neighbour-count all key off
exact shard positions), so it warrants its own branch + verification, not a
bolt-on to a roamer PR.

Knobs: `PhysicsSystem` (static/dynamic grids, `SPATIAL_GRID_SIZE`), `ShardSystem`,
`SHARD_PAIR_CONSTANTS` / `SHARD_TILE_PAIR_CONSTANTS` / `LOCAL_MERGE_CONSTANTS` /
`PERF_TASKS` in `constants.ts`.
