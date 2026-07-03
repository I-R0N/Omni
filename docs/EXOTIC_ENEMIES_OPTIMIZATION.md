# Exotic-enemies optimization pass

A performance pass over the heavy interactive entity types (the engine-managed /
third-party roamers — Rivals, Dragons, Bubbles — and the exotic roster) and the
per-step / per-frame systems that drive them. Goal: hold frame rate when many are
alive and on screen at once, scaling from a tablet field-of-view up to a large
desktop FOV (a wider viewport reveals more of the torus, so more heavy entities
are drawn per frame).

**Posture: zero functionality / behaviour / visual change** — same gameplay
results, identical visuals, only cheaper (the PR #58 / #63 posture). Every change
below is either load-gated with a `minInterval: 1` (so it is byte-identical to the
old every-step behaviour at low load and only stretches under real pressure) or a
render cache that is provably equivalent to the per-frame rebuild it replaces. No
approval-gated items were required — nothing was removed, capped, or down-cadenced
in a player-perceptible way.

---

## Method & measurement

There is no automated FPS harness in this repo, and the last-mile gate is
`npm run build` (vite type-checks via esbuild). Verification was done three ways:

1. **Static complexity / allocation analysis** of every per-step and per-frame
   cost the heavy entities incur (the roamer `update*` loops and their render
   paths). Each optimization below lists the before/after cost.
2. **A headless Chromium smoke run** (Playwright over the built `dist/`) that
   starts a Universe game, spawns **10 DBG dragons (every material) + 6 rivals**
   alongside the auto-seeded ambient bubble population (~2 700–2 850 live
   entities), teleports the roamers on-screen in provoked + hit-flash states, and
   renders ~3.5 s of simulation at **both a tablet (1024×768) and a desktop
   (2560×1440) viewport**. Result: **0 console/page errors at both FOVs**, all
   dragon heads (faceted skull + plasma maw + reactor core), rival sprites, dragon
   bodies, and bubble membranes rendering correctly through the new cached paths.
   (The scaffolding — a temporary `window.__engine` handle and the test script —
   was reverted before commit.)
3. **Manual playtest checklist** (below) to capture live DBG perf-panel numbers
   on real hardware across the worst-case scenes.

### Worst-case scenes (for the manual numbers table)

| Scene | Contents | FOV |
|-------|----------|-----|
| A — roamer swarm (desktop) | 6 rivals + ~8 DBG dragons + full ambient bubbles + a dense wave | 2560×1440 |
| B — roamer swarm (tablet) | same as A | ~1024×768 |
| C — dragon stack | 10 DBG dragons (mixed materials), bodies on-screen | 2560×1440 |
| D — baseline | a normal wave, no DBG roamers | both |

Record from the DBG panel: render-time ms, collision ms, PerfController tier +
load, and per-section timers. Fill the table on real hardware:

| Scene | render ms (before → after) | sim ms (before → after) | tier |
|-------|---------|---------|------|
| A | _ → _ | _ → _ | _ |
| B | _ → _ | _ → _ | _ |
| C | _ → _ | _ → _ | _ |
| D | _ → _ | _ → _ | _ |

---

## Optimizations shipped

### 1. Rival targeting + loot-vacuum → PerfController cadence (`rivalScan`)

`GameEngine.updateRivals` ran two full-list walks **per rival, every sim step**:

- **Targeting** — a nearest-wave-enemy scan over the whole `entityIndex.enemies`
  list: `O(rivals × live enemies)`. In a dense wave (wave enemies + swarm brood +
  dragon-spat gnats push `enemies` to ~100–150), 6 rivals = up to ~900 toroidal
  distance ops **per step**, ×2–3 substeps/frame.
- **Loot vacuum** (`rivalVacuumDrops`) — a scan over every active drop:
  `O(rivals × active drops)`, up to `6 × MAX_ACTIVE_DROPS` per step.

**Change:** a new `PERF_TASKS.rivalScan` (`minInterval: 1, maxInterval: 4`) gates
both the target **re-acquire** and the loot vacuum. The chosen target is **cached
on the `RivalInstance`** (`inst.target`); steering, firing, the strafe-distance
gate, and the whole lifecycle still run **every step** against the cached target,
recomputing only the **O(1)** distance to it. The cache is dropped the instant the
target goes inactive/exploding, and re-acquired on the next scan step.

- **Cost:** at low load `minInterval: 1` → **identical to the old every-step
  behaviour**. Under real pressure the interval stretches to 4, cutting the two
  `O(rivals × N)` walks by ~75% while movement/aim stay smooth.
- **Behaviour:** only *which* enemy a rival re-picks, and *when* a nearby drop is
  snatched, defer by ≤3 steps (~50 ms) under load — imperceptible, and exactly the
  "targeting re-acquire / loot-vacuum scan" cadence the task blesses. Rivals still
  hunt, strafe, fire `hitsEnemies`/`sparesPlayer` bolts, steal kills + loot, and
  warp out identically.

### 2. `updateAttachments` — kill the full-master-list `entityById` scan

The bubble latch (attach primitive 3c) resolved its target each frame via
`entityById(id)`, a linear walk over **the entire `currentMap.entities` array**
(up to ~2 700 entities on a full map) per latched entity. Replaced with
`resolveAggroTarget` — the player special-case + a walk of the small
`entityIndex.enemies` slice (the only attach targets today). Same result, O(all
entities) → O(active enemies). The now-dead `entityById` was removed.

### 3. Dragon-head render — cache the per-frame gradients

`RenderSystem.drawEnemyShape`'s geometric dragon head (Stage 6) rebuilt **three**
`createRadialGradient`s with **seven** `addColorStop` CSS-string parses **per
dragon, every frame** — the biggest being the full faceted-skull body gradient.
With a stack of dragons on a wide desktop FOV this is pure per-frame churn.

**Change:** the skull body gradient and the plasma-maw gradient are now **cached on
the entity** (`dragonSkullGrad` / `dragonMawGrad`), rebuilt only when the
size / colour / hit-flash / provoked **key** changes (mirroring the existing
`enemyBodyGrad` cache). The per-frame energy `pulse` is applied via **`globalAlpha`
at paint time** instead of being baked into the maw's colour stops — provably
equivalent, because the maw fades to `alpha = 0` at the rim, so scaling a unit
`1→0` gradient by `k` reproduces the old `(0.45 + 0.3·pulse) → 0` stops exactly.

- **Cost:** 3 gradient builds + 7 stop-parses per dragon/frame → **1** (only the
  reactor-core bloom, whose radius genuinely pulses, is still per-frame). ~67%
  fewer gradient allocations for every on-screen dragon; the win scales with
  visible-dragon count, i.e. **grows with FOV**.
- **Visual:** unchanged (confirmed in the smoke render — skull, maw, and
  provoked-red core all correct).

### 4. Bubble-membrane render — cache the fill gradient

The reactive-bubble membrane (Stage 5) rebuilt its soap-film radial fill gradient
every frame. Now cached on the entity (`bubbleFillGrad`), keyed on membrane radius
+ base colour + visibility — all of which change only on a hit-flash/feed pulse or
a state transition (calm ↔ provoked ↔ sick), not per frame. An idle drifting
bubble reuses the same gradient object every frame. The key is compared by
component (no per-frame key-string allocation — hot-path allocation discipline).

---

## Deferred (see `docs/PARKING_LOT.md`)

- **`updateConsumers` spatial query.** The consume-and-grow scan is
  `O(calm consumers × all mobile shards)` over the full `entityIndex.asteroids`
  list. It is already `PerfController`-gated (`consume`) and early-outs for every
  non-idle bubble, but on a shard-dense field a calm bubble still walks the whole
  shard list. Replacing it with a dynamic-grid near-query would need a new
  `forEachDynamicNear` helper (PhysicsSystem only exposes a **static**-grid query
  today) — more invasive than this zero-behaviour pass warranted. Deferred.
- **Portal / death particle-burst counts** (`openPortal` ≈ 46 particles + 3
  shockwaves; dragon death 40; sever/segment puffs). These are one-shot on
  spawn/death events, not per-frame, and cutting them is a **visual** change —
  left intact per the zero-visual-change posture. Logged as a knob to revisit only
  if a profile shows portal spam dominating.
- **`maintainAmbientBubbles` / nest brood census.** Small `O(enemies)` integer
  counts every step; cheap enough that gating them is low ROI and risks a spawn-
  timing wobble. Left as-is.

---

## Parity checklist (manual playtest)

Run each on real hardware; all must behave exactly as before this pass.

**Rivals** (DBG ▸ Rivals: hostile / ally / neutral / random)
- [ ] Hostile hunts player + enemies; ally hunts enemies only; neutral ignores
      the player until attacked, then flips to hunt it.
- [ ] Rival bolts damage wave enemies (`hitsEnemies`) and pass through the player
      unless hostile/aimed (`sparesPlayer`); never hit another rival.
- [ ] Killing a wave enemy with a rival shot denies the player the points/combo
      (`killedByRival`); rival vacuums nearby drops (heals + denies).
- [ ] Rival warps in on the score cadence + via DBG; warps out via portal after
      the roam window; player can down it for the tier bounty + loot spray.
- [ ] Spawn 6 rivals into a dense wave — target re-acquire + strafe still look
      instant; no visible "sticky target" lag.

**Dragons** (DBG ▸ Dragon: glass / rock / plastic / metal / mixed; stack several)
- [ ] Head renders faceted skull + plasma maw + reactor core; portal-violet at
      rest, hot-red when provoked; pulse animates; hit-flash whitens.
- [ ] Body is a Snake of eaten tiles; eats tiles in its path; severing a segment
      drops it + everything aft as drifting shards; body immune to crash, breaks
      only when shot.
- [ ] Neutral until attacked; once provoked spits gnats + lobs homing missiles.
- [ ] Leaves head-first through the exit portal after the roam window; kill payout
      doubles per dragon (3000 · 2^n).
- [ ] Stack 8–10 dragons on-screen at desktop FOV — render-time stays flat vs. the
      same count pre-pass (gradient cache win).

**Bubbles** (ambient; DBG ▸ enemy-test BUBBLE, Corrode/Disable)
- [ ] Calm bubbles drift faint on the flow field, chase + digest shards (heal +
      grow), split at size; plastic/green-nebula shards sicken them.
- [ ] Provoked (shoot/ram one) → homes, latches, drains + EMPs the player, knocks
      free on a projectile hit / terrain slam → goes sick.
- [ ] Membrane wobble, feed bulge, digest ghost, squash-cling all render as before.

**General**
- [ ] `npm run build` clean; `node scripts/inline-build.mjs` regenerates the
      standalone; DBG perf panel numbers at/below baseline across scenes A–D.
