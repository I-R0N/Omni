# Omni — Parking Lot

Ideas worth revisiting but not blocking current work.
Add entries freely; revisit during planning.

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

## Drop Collection Feedback

**Context:** When the player collects a fuel or gold drop, the resource updates silently.
The `spawnDamageText` system already exists and renders floating world-space text.

**Proposal:** On collect, call `spawnDamageText` with a short label:
- Fuel: `+FUEL` in cyan (`#00e5ff`) at the collection point
- Gold: `+XX` in gold (`#ffd700`) where XX is the rounded drop value
- Weapon: already visually obvious from the on-screen powerup prompt

---

## Drop Count Cap

**Context:** Mass asteroid-field destruction can spawn large numbers of drops in a single frame.
`activeDrops` has no upper bound. In extreme cases (chain reaction across a dense field) this
could cause a transient spike.

**Proposal:** In `spawnDrop` / `spawnRandomPowerupDrop`, skip spawning if
`this.activeDrops.length >= MAX_ACTIVE_DROPS` (suggested: 80–120). Oldest drops are naturally
expired by `PhysicsSystem` lifetime management, so the list self-drains without extra cleanup.
