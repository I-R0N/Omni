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


Both pad schemes are SHIPPED AND UNTUNED. The wire format is settled
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

The one-stick/two-button scheme above (its own entry) is the next step past
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

- **One stick doing three jobs.** Direction and throttle already come from
  one deflection under `gamepad`, so that half is solved. Aim is the problem:
  the ship would have to AIM WHERE IT FLIES, exactly as the joystick touch
  schemes already do (`pointerAims: false`, the stick writes the synthetic
  pointer). So the mechanism exists — this scheme reuses the joystick
  schemes' rule with a pad as the source.
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

## Exotic Enemy Types + AI Taxonomy / Wave-Accounting Refactors — DONE

> **RESOLVED (Stages 0–7, PR #67).**  Everything here shipped, in the exact
> sequence this entry proposed.  Both structural gates: the AI
> behavior-dispatch table (`ENEMY_BEHAVIOR` -> `moveStrategies`) replaced the
> two-routine `ENEMY_ROLE` branch, and wave accounting gained
> `countsTowardWave`.  All three reusable mechanics: provoked-on-hit,
> generalized consume-and-grow (`updateConsumers`, `consume` PERF_TASKS
> entry), attach + `'disable'`.  All four enemies: turret -> swarm+nest ->
> bubble -> dragon.  What is still open is BALANCE, which has its own entry
> ("Exotic-enemy roster (Stages 0-7)") — kept below for the design
> rationale only.


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

## Damage-triggered health / shield bars (remove always-on bars) — DONE

> **SHIPPED (gauntlet 5d, U5) — with ONE prescription REVERSED.**  The system
> landed as designed: `healthBarTimer` + `markDamaged`/`markShieldDamaged`
> stamped at every damage path, `renderHealthBar` gated on the timer with a
> fade, the shield strip generalized to any shielded entity,
> `alwaysShowHealthBar` for priority targets (the dragon takes it; capstone
> bosses deliberately do not), and DBG ▸ Visual ▸ "HP bars" as the A/B.
>
> **Reversed by user call (U6): the player KEEPS a floating bar.**  This entry
> argued the player's world-space bar was redundant with the HUD readout and
> should be dropped.  In play it is not — the bar is where the eye already is,
> the chip is where the exact figure is, and they wear the same three urgency
> bands so they cannot read as two opinions.  `renderPlayerVitalsBar` draws it
> permanently (never damage-triggered: your own condition is the one thing you
> must not have to provoke into view), with the shield strip appearing only
> once `maxShield > 0`.  See CLAUDE.md §8.
>
> One gap this entry did not anticipate, caught by U5's own suite: a hit fully
> absorbed by a SHIELD armed no bar, so the strip could only appear once the
> shield had already failed — backwards for a readout whose job is to be
> watched draining.  Hence `markShieldDamaged` as a separate stamp.


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
- **Player floating bar → screen HUD (user direction):** REMOVE the player's
  floating health bar (drawn under the ship) and move it to the **screen HUD**,
  and show a **numeric readout** alongside the bar (e.g. `87/100`). The engine
  already feeds `EngineStats.playerStats` (health / maxHealth / shield) to
  `UIOverlay`, so the persistent player readout lives there — add the bar + the
  `health/maxHealth` number to the HUD and drop the world-space player bar in
  `renderHealthBar`. Do the same for shield (`shield/maxShield`) if shown.
  Enemies keep the transient world-space bar. (Consider still flashing a brief
  on-hit bar/flash under the player for hit juice — optional.)
- **Perf**: this is a net *reduction* in draw calls (most entities draw no bar
  most frames); the only new cost is a per-entity timer decrement.

**Tuning knobs:** `UI_CONSTANTS.HEALTH_BAR.SHOW_DURATION` /
`FADE_DURATION`; the existing width/height/offset entries; the optional
`alwaysShowHealthBar` flag for bosses.

---

## Weapon ammo model + menu clarity + purchase-UI parity — SUPERSEDED

> **SUPERSEDED (2026-07-24, station/module increments):** item 1 shipped as
> the weapons-ammo pivot (ammo deleted entirely — pivot 1b); items 2–3 were
> replaced wholesale by the hex-slot module UI (guns are module items in the
> shared hex flowers/inventory/shop renderers, so locked-vs-unlocked and
> purchase-UI parity no longer exist as separate surfaces).  Kept for
> reference only.

**Context / request:** Three related weapon-UX asks.

1. **Simplify the ammo model.** Weapons today carry per-weapon ammo costs
   (`WEAPONS[w].ammoCost` / `chargedAmmoCost`) drawn from the shared ammo pool
   (the d1 consolidation). Reconfigure to ONE of:
   - **Unlimited ammo** — drop ammo entirely (or keep it purely cosmetic), so
     weapon choice is about function, not resource management; OR
   - **Uniform ammo cost** — every weapon costs the SAME per shot, so switching
     weapons never changes how fast you burn the pool.
   Pick per user direction (an `AskUserQuestion` when the task starts). Touches
   `WEAPONS` cost fields, `WeaponSystem` fire/charge deduction, the ammo HUD, and
   `DropSystem` ammo drops (if ammo is removed, the whole ammo-drop economy —
   `AMMO_*`, drop merge, magnet — goes cosmetic or gets pulled; flag that scope).

2. **Weapon menu: clearer locked vs. unlocked.** The weapon select/cycle should
   visibly distinguish **unlocked** weapons from **locked** ones (the run starts
   Blaster-only; the rest are Drydock unlocks — `unlockedWeapons` /
   `ownedWeapons`). Show locked entries greyed/with a lock badge rather than
   hidden, so the player sees what's available to buy. `UIOverlay` weapon menu +
   `EngineStats.unlocks` / `.shop`.

3. **Tie weapon-menu and pause-menu purchase graphics together.** The weapon
   menu and the pause-menu **Drydock** (where weapons/shield/overcharge are
   bought via `purchaseUnlock`) currently render differently. Unify them so a
   weapon reads the SAME (icon, name, locked/owned state, cost) in both places —
   ideally one shared weapon-card component/render used by both surfaces.

**Touch points:** `constants.ts` `WEAPONS` / `WEAPON_LIST` / `UNLOCK_DEFS` /
`AMMO_CONSTANTS`; `engine/systems/WeaponSystem.ts` + `DropSystem.ts`;
`components/UIOverlay.tsx` (weapon menu + Drydock/Unlocks panels);
`GameEngine.purchaseUnlock` + the `EngineStats.shop` / `.unlocks` payloads.
Note: #1 is a gameplay-economy change (playtest it); #2/#3 are UI-only.

---

## Swarm gnat + Bubble — feel / tuning pass

> **Heading restored 2026-08-19.**  This entry had lost its `##` heading and
> was rendering INSIDE the superseded ammo entry above — a live tuning
> checklist filed under a SUPERSEDED banner.  Nothing about it is superseded.

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

## Swarm gnats — collide with asteroids + tiles — DONE

**RESOLVED (physics-shard-broadphase branch):** the `diesOnContact` collision
early-out in `PhysicsSystem.checkAndResolveCollision` was removed, so gnats now
take STANDARD enemy collisions — they bounce off tiles / asteroids and each other
instead of phasing through. The gnat still POPS only on player contact (the
resolveCollision ENEMY-vs-PLAYER branch is gated on the target being the player),
so hitting a tile bounces rather than kills it; enemy fire still can't hit them
(friendly-fire filter). Measured cost of the feared dense-flock case was small
(0.68 ms collisions with 60 gnats in a tile field) — the boids separation keeps a
flock spaced, so few pairs actually overlap past the circle broadphase, and the
predicted O(k²) blow-up didn't materialise. Verified: a gnat spawned on a tile is
pushed off + survives; a gnat on the player pops + deals damage; 0 errors. The
mitigations below (structure-only / PerfController gate / repel-steer) are left as
notes in case a future denser brood needs them.

**Original context / request:** SWARM gnats used to **phase through all terrain** — the
Stage-4 perf simplification skips collision for every pair except the player +
player projectiles (`PhysicsSystem.checkAndResolveCollision` `diesOnContact`
early-out), so a big flock stays cheap. **Request: make gnats collide with
asteroids and tiles** (mobile shards + static tiles) so they can't fly through
the environment and read as physical.

**Tradeoff to weigh (this is why it was skipped):** re-enabling gnat↔structure
SAT is exactly the per-pair cost the early-out removed, and gnats spawn in dense
flocks (Nest brood, Dragon spit). Naïvely turning it on scales badly. Options:
- Collide with STRUCTURE only (keep gnat↔gnat and gnat↔enemy skipped) — the
  cheapest way to get "bounces off terrain" without full participation.
- Gate by flock size / on-screen only via `PerfController` so a huge off-screen
  cloud doesn't pay for it.
- A lightweight repel/steer-around instead of hard SAT impulse (cheaper, and
  avoids gnats piling against a wall).

**Touch points:** the `diesOnContact` early-out in
`PhysicsSystem.checkAndResolveCollision`; the flat-fill gnat render path in
`RenderSystem.drawEnemyShape`; `AISystem.updateSwarm` (may want terrain-aware
steer). Measure a worst-case flock before/after.

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
- **Damage indication.** Strengthen the feedback when a rival takes damage —
  the current sprite hit-flash + disposition health bar read, but rivals want
  clearer damage numbers and a hit reaction that pops against the busy field
  (e.g. a bigger spark burst, a brief outline, or the damage-triggered-bar
  system once that lands). Verify world-space damage numbers actually fire for
  rivals (`spawnDamageText` gate) and read at typical zoom.
- **Contrast glow / standout.** Rivals can blend into the enemy field (they use
  retired enemy PNGs). Add a subtle contrast glow / rim-light in the disposition
  colour so they read as distinct player-like ships at a glance — NOT the old
  shield-looking ring (removed per user); think a soft outer glow, engine-trail
  emission (the `trail` field is already on the entity but unused), or a rim
  highlight in `RenderSystem`'s rival sprite branch.

**All knobs live in:** `RIVAL_CONSTANTS` (cadence / stats / weapon / dispositions
/ portal) in `constants.ts`; lifecycle in `GameEngine.updateRivals` /
`spawnRival` / `fireRivalShot` / `rivalVacuumDrops`.

---

## Entity ↔ portal awareness — real AI, not just a shove (parked 2026-09-01)

Sits with the other entity-AI items below (roster balance, swarm/bubble feel,
rival polish): this is the AI half of the portal work, deliberately deferred
while the physics half ships.

**What exists now.**  `avoidsPortals(e)` in `constants.ts` plus an outward
push in `PhysicsSystem.applyGravity`.  One predicate, defaulting by TYPE
(every `ENEMY`, plus the snitch), so bubbles, dragons, rivals and any future
roamer are covered the day they exist.  The pull is not cancelled — they
drift in from range and are held off at a standoff of roughly 215 units.

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

**Partly addressed on the `physics-shard-broadphase` branch (PR #70).** What
landed there, zero-behaviour:
- **Broadphase per-pair math** — `resolveAsteroidPair` now caches
  `invMass`/`effInvMass` on a mass-keyed self-invalidating field (removes 2 div +
  2 pow per pair) and dedups pairs on a numeric `_pairSeq` instead of an `a.id >
  b.id` string compare.
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
loop, ~L1672). Add the cell-pile threshold + a per-substep rotating offset
(`shardPairCallCount % stride`) so the covered subset advances each call. Keep the
existing `_pairSeq` dedup, sleep skip, and viewport gate.

**Tradeoff / risk:** in the very densest MOMENTARY piles, shards separate a touch
softer for a frame or two before fully covered. Piles are transient (shards
scatter apart), so this should read as imperceptible — but VERIFY against a dense
headless scene (confirm no visible sustained interpenetration) before shipping,
since the shard-field feel is user-protected. Tune K / stride in
`SHARD_PAIR_CONSTANTS`.

**Other candidate levers (heavier, lower priority):** cheaper dynamic-grid rebuild
/ query, a `forEachDynamicNear` helper (also unblocks the parked
`updateConsumers` query), revisiting the shard-merge cull rate under max load.
**Delicate** (merge / regen / neighbour-count all key off exact shard positions),
so any of these warrants its own branch + verification.

Knobs: `PhysicsSystem` (static/dynamic grids, `SPATIAL_GRID_SIZE`), `ShardSystem`,
`SHARD_PAIR_CONSTANTS` / `SHARD_TILE_PAIR_CONSTANTS` / `LOCAL_MERGE_CONSTANTS` /
`PERF_TASKS` in `constants.ts`.

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
- **Weapon weight numbers** — `WEAPON_WEIGHT` (BASE_BOOST 1.10, DRAG
  0.10) is explicitly provisional; verify weaponless flight feels like a
  real option and heavy arsenals a real cost.
- **Resale fractions** — 90% sell-back makes respeccing nearly free
  (possibly fine — outfitting experimentation is the fun); revisit
  `MODULE_RESALE` (and the 9% scrap floor) once the death penalty /
  income pacing land, since all three shape how precious credits feel.

Knobs: `MODULE_DEFS` costs, `SALVAGE_CONSTANTS`, `MODULE_RESALE`,
`WEAPON_WEIGHT`, `ENEMY_SCALING`, `STATION_CONSTANTS.REPAIR_COST_PER_HP`.

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

### Pause-menu stat legibility — per-module effect attribution — DONE

> **SHIPPED (Phase 3 Pair A).**  Both candidate shapes landed, not one:
> `EngineStats.outfitting.statLines` carries the full derived-stat set with
> PER-MODULE attribution, built by `GameEngine.statBreakdown()` from the same
> slot walk `applyModuleEffects` folds — so the UI renders and never
> recomputes, and the panel cannot disagree with the sim.  Rows expand to
> their contributors; tapping a hex highlights every stat it feeds.  Shared
> verbatim by the pause menu and the docked station via `renderShipStatus()`.


(Note: ship modules already function with the free Base Hull — it is the
family-`hull` adjacency root on the center hex, touching all six ring
slots — so there is no first-purchase gate to soften.)  What's wanted: a
clear display of player / ship / weapon stats in the pause menu with an
intuitive understanding of what each installed module contributes.
Candidate shape: expand the Ship Status panel to the full derived-stat
set (hull, shield, regen, damage, fire rate, speed, acceleration
including weapon-weight drag), each stat expandable to its contributing
modules; and/or tapping a hex highlights the stats it feeds, with the
module's exact effect shown in the detail strip.  Touch points:
`applyModuleEffects` already sums ACTIVE effects — expose a per-module
breakdown on `EngineStats.outfitting`; `UIOverlay` pause Ship Status +
`renderModuleDetail`.

---

## Portal off-screen indicators behave unlike every other indicator (2026-08-05) — RESOLVED

> **RESOLVED (step 5, G6 — decision #46b): option 2, plus a third change.**
> The arrow is now suppressed once the rift is on screen (the world-space tag
> takes over), and it no longer prints a DISTANCE readout — both halves of the
> old redundancy are gone, and there are now NO exemptions from the
> offscreen-only rule.  The RANGE GATE was deliberately KEPT: a portal is a
> fixed landmark, so the two rules together bracket the case the arrow is
> actually good for — close enough to matter, not yet visible.  Long-range
> discovery moved to the minimap, where `PORTAL_BLIP` draws the rift as an
> ANOMALY (spinning colour-filled diamond + radar ping) that clamps to the
> border instead of being culled.
>
> The one divergence this entry named that SURVIVES is R2 in the 5d ledger: a
> portal's ARROW is the legend's green while its BLIP carries the rift's own
> violet/sky, so an outbound and a return rift are tellable apart on the map.
> Documented as a deliberate exemption in CLAUDE.md §8.


**Context:** raised in playtest during the Phase 3 Pair A session, after the
off-screen indicators were reworked (edge-anchored, size-coded, typed by
colour).  The portal arrow now reads as an exception to the rules every other
contact follows, and the exceptions compound at close range.

Where a portal diverges today (all in `RenderSystem.renderIndicators` +
`PORTAL_CONSTANTS`):

- **Range-gated, not always-on.** Enemies are indicated at any distance and
  fade toward an alpha floor; a portal shows NO arrow at all until the player
  is inside `PORTAL_CONSTANTS.INDICATOR_RANGE`, then appears abruptly at full
  strength.  Every other type fades in; this one pops.
- **Exempt from offscreen-only suppression.** Every other contact's arrow
  disappears once you can see the thing.  The portal's persists — so at close
  range you get the rift ON SCREEN plus an edge arrow pointing at it.
- **Carries the most text of any type.** Destination name AND a distance
  readout, while ordinary enemies now print no number at all (their size
  carries distance).  Stack that on the rift's own world-space tag and the
  same destination is named two or three times at once.

Net effect: approaching a portal, the arrow is redundant with the thing it
points at; far from one, there is no arrow to find it by (the minimap anomaly
blip is doing that job).  Neither end matches how the player has learned to
read the other five contact types.

**Candidate directions** (none chosen — this is a design call):

1. **Make it obey the normal rules** — drop the suppression exemption and the
   range gate, let it fade with distance like everything else, and lean on the
   minimap blip for long-range discovery.  Cheapest; costs the guaranteed
   labelled cue on approach.
2. **Keep the exemption, drop the redundancy** — suppress the arrow once the
   rift is on screen (the world-space tag takes over), keep it while the
   portal is off screen and in range.  Preserves the navigation cue and kills
   the double-labelling.
3. **Promote portals to a separate NAVIGATION layer** rather than a contact
   type — a distinct treatment (waypoint-style) that isn't competing with the
   threat arrows at all, which is arguably what a fixed landmark wants.

**Touch points:** `RenderSystem.renderIndicators` (the `isPortal` exemptions
and the label block), `UI_CONSTANTS.INDICATORS`, `PORTAL_CONSTANTS`
`INDICATOR_RANGE`, and `MINIMAP_CONSTANTS.PORTAL_BLIP` (which currently
carries long-range discovery and would carry more under option 1).

---

## Portal persistence — stages that stay cleared, and enemies that creep back (2026-08-07)

> **2026-09-03:** the node identity this entry needs is specified in
> `docs/PORTAL_AND_WORLD_LAYER_PLAN.md` §6, and the persistence decision it
> waits on is that doc's open decision #1.  Tracked as **F1**/**F2** in
> `docs/CONFIG_CHANGES_PHASED_PLAN.md`.

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
descent portal currently picks a RANDOM arena descriptor as an explicit
placeholder (`GameEngine.openDescentPortal`) — this entry is what should
eventually sit behind that seam.  Not for that session; recorded for the
Overworld / procedural-areas work.

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
population record the existing `MapClasses.populate()` path consumes
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

## Automated test suite — investigate a real harness (2026-08-08) — PARTLY ADOPTED

> **STANCE DECIDED; TIERS 1, 2 and 6 SHIPPED (roadmap 5b, decision #46a).**
> The "explicitly NOT decided" question at the bottom of this entry is
> answered: the project adopted a harness when it went public and gained a
> collaborator with no session history.  What exists now — `tests/` as repo
> artifacts driving the real engine in a real browser (tier 1), `npm run
> typecheck` (tier 2), and `.github/workflows/pr-checks.yml` running
> typecheck -> build -> Playwright on every PR as the merge gate (tier 6).
>
> **Still parked, deliberately:** tier 3 (Vitest over the pure layer), tier 4
> (headless Node sim tests) and tier 5 (visual regression — still the
> flakiest and most maintenance-hungry, still last).  Read the tier list below
> as three remaining items, not six.


**Raised as a merge risk during the Phase 3 Pair A gauntlet.**  The project
has, by design, no test runner and no lint step (CLAUDE.md §7: "Don't invent
one unless the user asks").  Validation today is `npm run build` — which only
type-checks — plus whatever headless Playwright smokes the session author
happens to write.  Those smokes have proven genuinely valuable (the Pair A
session ran 436 assertions across 7 suites and they caught real regressions:
a wreck-state leak on restart, indicator budgets culling the nearest contacts,
a stale-`dist` false pass), but they are **session-scoped scratchpad files**,
not repo artifacts.  They evaporate with the session.  The next session
re-derives them from scratch, and nothing prevents a later change from
silently breaking behaviour an earlier session proved.

That is the actual risk: **there is no regression net that outlives a
session.**  Every guarantee this repo has is re-established by hand, per
session, by whoever remembers to.

**What to investigate** (roughly in order of value-per-effort):

1. **Promote the smokes into the repo.**  The cheapest large win.  They
   already drive the real engine in a real browser through
   `window.__omniEngine` / `window.__omniStats` (CLAUDE.md §8), so there is
   nothing to port — it is `npm i -D @playwright/test`, a `tests/` directory,
   a `test` script, and a decision about where the preview server comes from.
   The debug handles exist precisely for this and cost nothing per frame.
2. **A type-check script.**  `tsc --noEmit` as its own npm script, so a type
   error surfaces without a full Vite build.  Minutes of work.
3. **Unit tests for the pure layer.**  Vitest over the genuinely pure,
   dependency-free functions: `engine/toroidal.ts` (wrap math — the single
   most invariant-critical code in the repo and the easiest to break
   silently), the `constants.ts` pure helpers (`isBossWave`, `bossForWave`,
   `buildWaveSpawnList`, `buildBossWaveSpawnList`, `enemyHpMult`,
   `getWaveSpawnBudget`, `modulePrice`, `moduleFitsSlot`), and the module
   adjacency fixpoint.  No DOM, no canvas, fast.
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
6. **CI gating.**  Today's two workflows (`pr-preview`, `publish-standalone`)
   gate nothing.  Once (1)–(3) exist, run them on PR.

**Explicitly NOT decided:** whether the project wants this at all.  The
no-test-runner stance is deliberate and has kept the repo light.  The
counter-argument is that the codebase is now ~15k lines with a god-class
orchestrator, three exotic engine-managed roamers, a boss phase machine and a
module system, and the cost of a silent regression has grown a lot since that
stance was set.  **Decide the stance first, then pick tiers** — a half-adopted
harness that nobody runs is worse than none.

---

## Viewport coverage — test more than 390×844 (2026-08-08) — DONE

> **SHIPPED (gauntlet 5d, U4).**  `tests/viewports.spec.ts` — 44 tests over
> exactly the six viewports tabled below (320×568 / 390×844 / 430×932 /
> 768×1024 / 1024×768 / 1440×900), plus the mid-session resize this entry
> called "cheaper than it sounds": portrait -> landscape -> desktop -> 320 ->
> back, watching a planted probe keep drifting at every stop.  The
> scroll-width and 40px tap-target checks generalized directly, as predicted.
> Canvas-pixel assertions stayed pinned to one viewport; visual regression
> stays parked (tier 5 below).
>
> `window.__omniHud` was added for it, exposing the pure canvas-HUD layout
> functions (`fitFontPx`, `computeMinimapRect`, `computeLoadoutHUDLayout`,
> `computeIndicatorRect`) on the `__omniHid` rationale — they are pure, and
> they are wrong in a way nothing reports.  Its stated dependency (the
> test-harness entry) cleared first, as sequenced.


**Raised as a merge risk during the Phase 3 Pair A gauntlet.**  Every UI
assertion written in that session ran at a single viewport: **390×844**, the
iPhone the game is actually played on.  That is the right primary target, and
it is the *hard* one (it is where the death screen, the stage-clear screen,
the boss HUD bar, the hex flowers and the wave banner all had to be made to
fit).  But it is one point in a space, and several of this session's changes
are **size-dependent by construction**:

- `RenderSystem.fitFontPx` scales banner text off canvas width — its
  behaviour at 1920px (never shrinks) and at 320px (shrinks hard, possibly to
  the readability floor) is untested.
- Off-screen indicators anchor to an INSET VIEWPORT RECT
  (`UI_CONSTANTS.INDICATORS.EDGE_INSET`) and ramp size by distance; the inset
  is a fixed px value, so it is proportionally huge on a small screen and
  negligible on a large one.
- The boss HUD bar was explicitly "sized so all of it survives a 390px-wide
  screen" — meaning it was tuned to a floor, not designed responsively.
- The station and pause panels are honeycomb hex grids with drag-and-drop;
  hex layout is computed, and both the drag ghost and the drop targets are
  position-sensitive.
- The minimap is a fixed `MINIMAP_CONSTANTS.SIZE` square with a fixed margin,
  and the wave banner is positioned relative to it.

**Viewports worth covering:**

| Viewport | Why |
|---|---|
| 320×568 (iPhone SE, 1st gen) | the narrowest phone still in use — the real floor |
| 390×844 (iPhone 12–15) | today's only target; keep it |
| 430×932 (Pro Max) | the large-phone case |
| 768×1024 (iPad portrait) | tablet portrait — tall, but wide enough to change layout |
| 1024×768 (iPad landscape) | the first genuinely LANDSCAPE case |
| 1440×900 / 1920×1080 (desktop) | where the game is developed and where nothing shrinks |

**Also worth testing, and cheaper than it sounds:** a **mid-session resize**.
Rotating a phone or resizing a desktop window is a real user action, and
nothing in the current suites ever changes the viewport after load.  Caches
keyed on canvas size (the nebula render fast-path, gradient caches, the
minimap) are exactly the sort of thing that survives a resize incorrectly.

**Cheapest path:** the existing smokes already take a viewport in
`browser.newContext({ viewport })`; parameterising the DOM-layout assertions
over a viewport list is a loop, not a rewrite.  The scroll-width check
(`document.documentElement.scrollWidth <= width`) and the ≥40px tap-target
check generalise directly.  The canvas-pixel assertions do not, and should
stay pinned to one viewport.

**Depends on** the test-suite entry above: this is only worth building on top
of a harness that outlives a session.

---

## Rotational mechanics for shards and asteroids (2026-08-21)

**Raised in playtest** ("the nebula shards spin in the opposite direction
than what they should"), and the user has explicit interest in building the
real thing.  The interim fix shipped: the player-wake swirl's spin sign is
now the DBG cycle Visual ▸ "Neb spin" — `physical` (wake shear: starboard
pass → clockwise) / `inverted` / `random` (the old id-parity vortices) — so
the handedness can be A/B'd in flight.  That is a SIGN policy, not physics.

**What the real system is:** angular state as a first-class part of the
impulse solver.

- **Moment of inertia** per entity (from size/mass; a disc approximation is
  fine) beside `mass`, with `Infinity` for statics mirroring the mass axis.
- **Off-centre impacts apply torque**: `resolveCollision` /
  `resolveAsteroidPair` compute the contact point already (MTV); the impulse
  they apply should also change `rotationSpeed` by `r × J / I` on both
  bodies, and the contact-point VELOCITY (linear + ω×r) should feed the
  restitution instead of the centre velocity.
- **Surface drag / wake torque** becomes an emergent case of the same
  machinery instead of the hand-signed swirl kick.
- **Spin → translation coupling** (a spinning shard grinding along a wall
  walks sideways) is optional polish; decide when the base lands.

**Why its own session** (CLAUDE.md §8 already warns): the per-pair solver is
the hottest code in the engine and "delicate — merge / regen / neighbour-
count all key off exact shard positions".  Adding angular terms changes
resting-contact behaviour (spin jitter is the classic failure), interacts
with the shard SLEEP system (`SHARD_SLEEP_CONSTANTS` gates on spin epsilon
already), and needs the perf harness re-run (`perf/simbench.mjs`) since it
adds work per contact pair.  Sequence: base I + impact torque on the
player/enemy/shard paths → wake swirl re-derived → sleep/merge re-verified →
perf capture.  Knobs should land beside `PHYSICS_CONSTANTS`.

**Touch points:** `PhysicsSystem.resolveCollision` / `resolveAsteroidPair` /
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
   names).

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
  indices* (`FIRE`, `FIRE_FACE`, `INTERACT`, `CYCLE_WEAPON`, `PAUSE`, `DPAD`,
  `THROTTLE`, plus the menu-nav group). A rebind is a write to that table, not
  new plumbing — the poll reads it through `padGroupValue` / `padGroupEdge`,
  which already accept a GROUP of indices rather than one button.
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
`depthAmbientEnabled = false`; DBG ▸ Debug Menu ▸ "Depth dark" turns it on).
A7 of the lighting gauntlet added depth-scoped ambient darkness: each descent
adds the light tier's `ambientPerStage` of fog-dark (capped at
`AMBIENT_DEPTH_CAP` = 4 stages), folded into the fog compositor's dark fill
as `max(fogSetting, depth)` — so it is cut by the player's light, respects
shadows, and darkens the minimap's memory veil through the one mechanism.
`tests/lighting.spec.ts` ("A7: depth darkens the world…") pins the monotone
ladder, the cap, and the toggle restore.

**Why it ships off (user call):** the "depth" it keys on is not yet a real
place.

- **Today's post-boss rifts have no depth in them.**  A descent rift just
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
composition — material combinations + a real map graph" (its Shape 4, the
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

## Two device-quantified perf items for the next perf session (2026-08-21)

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
- **Tinted-sprite cache thrash — FIXED (same day): the cache now
  quantises its hex key to 17-step buckets** (`RenderSystem.
  quantizeTintHex`, applied at both key seams; pinned by the
  lighting-suite tint-bucket test).  Kept here for the record of the
  mechanism, since equilibrating hues defeating an exact-key cache is a
  shape that could recur elsewhere:  Not population per se: `ENEMY_NEBULA_BURST` sprays
  cosmetic nebula dust tinted to each dead enemy's colour, and
  `NebulaSystem.equilibrateColors` drifts every shard hue toward its
  neighbours continuously — so every hue step mints a NEW `(sprite, hex)`
  key against the 256-entry `getTintedSprite` cache, each miss building a
  128² canvas.  The key stream never repeats by construction; the cache
  cannot converge.  Measured: 374 new tints in ONE frame, 41 450 misses in
  36 s, 12 ms peak, during a heavy late-run fight on a map with NO nebula
  terrain.  Candidate fixes, cheapest first: QUANTISE the hex in the cache
  key so equilibration steps land on reusable buckets (visual granularity
  cost is a few colour steps); skip equilibration for single-hex dust;
  cap the dust population.  Quantising the key is likely a one-line fix
  with a measurable win — verify with the PerfRecorder tint line.

Also noted for the same session: the planned desktop-browser framerate
investigation (user report, 2026-08-16) — the PerfRecorder now carries
light/fog columns and a self-describing `set` line, so a desktop capture
will attribute correctly out of the box.

---

## Six recorded takes are longer than their polyphony allows (2026-08-26)

Found by `scripts/smoke/assets.mjs` once the recorded library grew from 3
files to 66. Not a code problem — a re-export, whenever the sounds get
another pass.

| id | takes | length | budget |
|---|---|---|---|
| `weapon.cannon.fire` | a, b, c | 380 ms | ≤ 300 ms |
| `enemy.shot.boss` | a, b, c | 340 ms | ≤ 300 ms |

**Why the length matters, and why it is not just "a bit long".** Each id has
a polyphony cap — how many copies may sound at once — and a take that outlives
the gap between triggers starves its own cap: the fourth shot steals the voice
of the first, so a sustained burst audibly cuts itself off mid-tail. The
guideline is the cap times the fire interval, and 300 ms is where these two
sit. The cannon is the more likely to be noticed, because it is a weapon the
player fires deliberately and listens to.

Two ways out, and the choice is aesthetic rather than technical:

- **Shorten the takes** to ~280 ms, keeping the transient and trimming the
  tail. Cheapest, and the tail is the part least likely to be missed on a
  weapon that is about impact.
- **Raise the polyphony** for these two ids so the overlap is legal. Costs
  voices from a budget that already thins tier 3 first under load, so it
  trades against material chatter in exactly the frames where a cannon is
  most likely to be firing.

Deliberately NOT auto-fixed: these are authored assets, and trimming someone's
recording to satisfy a linter is the wrong default.

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

## Grain `sizeSpread` and `bondSpread` — parked at 0 (user call)

Both axes are implemented, tested and wired end to end; every material is
authored at **0**, which is the exact identity in both cases
(`siteWeightsFor` returns null, `bondVariance` returns 1), so the game
today behaves as if neither existed.

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

## Fracture physics: detach impulse, centroid drift, erosion cascade

**Status:** investigated with measurements, not fixed. User report:
"damage continues to propagate at the initiating side" and "shards are
ejected at the initiating side and the parent is pushed toward where the
projectile came from."

### What was measured

A 159.9-unit mobile rock shard, velocity and spin pinned to zero, shot
head-on six times from +x and then eight times from -x.

**The damage spend FOLLOWS the new side — symptom 1 did not reproduce as
stated.** `lastImpactLocal` flips with the shot side every hit, and the
boundaries taking new fill flip with it: local x -41..-25 during the +x
phase, +46..+25.9 during the -x phase. Chips detach on the struck side
in both phases (an earlier reading that said otherwise was a frame
error: the impact is in the body's ROTATED frame and the chip offsets
were world-frame, and the body's rotation was ~pi).

**The pattern's impact bias is NOT the explanation either.** Cells near
the first contact are only 1.24x smaller than far cells and their
boundaries cost 3.36 vs 3.58 — a 7% asymmetry, far too small to read as
"damage stays on one side".

### What IS wrong, and what it explains

1. **THE EROSION CASCADE.** A boundary stops binding once the cell on its
   other side has left. So the moment one chip comes away, its
   neighbours need FEWER broken boundaries to come away too — and they
   already carry damage from the first volley. The result is that the
   first wound keeps shedding pieces even while the player is shooting
   somewhere else. This is a real mechanism and the best explanation of
   the report. It is arguably a design flaw rather than a bug: erosion
   cascades at the oldest wound regardless of where damage is now
   landing. Whether that is desirable is a design call.

2. **OLD CRACKS NEVER FADE.** The overlay draws EVERY boundary at its own
   fill fraction, so the heavily-cracked first side stays heavily cracked
   forever while new far-side damage adds only a few faint lines. Correct
   behaviour that reads as "the damage is still over there".

3. **NO MOMENTUM CONSERVATION ON DETACH.** `spawnDetachedCell` gives the
   chip a velocity (parent velocity + radial + a share of the impact) out
   of nothing, and `progressFracture` then scales the parent's MASS down
   (`target.mass *= remainderArea / polyArea`) while leaving its VELOCITY
   alone. So the parent's momentum silently drops and the chip's is
   created. Measured: a chip left at vx +0.54 with no recoil on the
   parent. The fix is the standard one — give the parent the equal and
   opposite impulse, `parent.v -= chip.v_rel * (chipMass / parentMass)`.

4. **CENTROID DRIFT WITH NO POSITION CORRECTION.** `progressFracture`
   sets `target.polygonPoints = remainder` and never touches
   `target.position`, so the body's centre of area walks away from its
   origin as it erodes. Measured on the test shard: local centroid x
   went 1.38 -> 2.71 -> -4.08 over two detaches. Two consequences, and
   the second is very likely what the user is seeing as odd push:
   - Physics (collision impulse, flow, magnetisation) acts at `position`,
     which is no longer the centre of mass.
   - The body ROTATES ABOUT THE WRONG POINT. A spinning eroded shard
     orbits its old origin instead of spinning in place, which reads as
     the body being shoved around. On a 160-unit shard a 7-unit offset is
     clearly visible.
   The fix is to re-centre on detach: shift `polygonPoints` by the new
   centroid and add the same offset (rotated into world) to `position`,
   so the body does not visually jump. NOTE this is exactly what the
   "size and position untouched" dent contract forbids for STATIC tiles
   (the static grid would need rebuilding) — so the correction must apply
   to MOBILE bodies only.

5. **Minor, found on the way:** `overlayMaterialCracks` early-returns on
   `count = floor((maxHp - hp) / cfg.freq) <= 0`, a LEGACY HP-pacing gate,
   before the grain path that ignores `count` entirely and draws each
   boundary at its own fill. So a grain body carrying real boundary damage
   draws NO cracks until it has lost `cfg.freq` HP. Small, self-contained.

### Suggested order

(4) then (3) — both are contained in `progressFracture` /
`spawnDetachedCell` and both are ordinary rigid-body bookkeeping. (5) is
a two-line gate fix. (1) is a DESIGN question to answer before touching:
should a fresh wound on the far side compete with the old one, or should
erosion keep cascading at the first break?
