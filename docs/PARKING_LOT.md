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
