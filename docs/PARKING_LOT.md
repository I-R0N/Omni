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
