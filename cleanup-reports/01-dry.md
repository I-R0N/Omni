# Agent 1 — Deduplication & DRY

Scope: find duplicated logic / repeated patterns in the engine and
extract *only* where consolidation actually reduces complexity.  The
guiding rule is "three similar lines is better than a premature
abstraction": a helper has to justify itself at every call site.

Tools used: `grep` sweeps over `Math.sqrt`, `Math.max(…Math.min)`,
`while (angleDiff)`, `rawPts.sort` plus `npx jscpd --min-lines 8
--min-tokens 60`.  Baseline `npx tsc --noEmit`: passes.

## Candidates

### 1. Shard polygon construction — APPLIED (high confidence)
Same algorithm ("numPoints equally-spaced vertices, angular jitter of
±(π/numPoints)·K/2, radius baseR·(rMin + rand·rRange), sorted by
angle, mapped to (cos, sin)") appeared at **seven** call sites across
four files:

- `engine/GameEngine.ts:1685` (merged-drop composite asteroid)
- `engine/GameEngine.ts:1776` (asteroid / tile shatter shards)
- `engine/maps/MapClasses.ts:69` (`createAsteroid`)
- `engine/systems/DropSystem.ts:176` (enemy shards)
- `engine/systems/DropSystem.ts:250` (tile shards from break)
- `engine/systems/NebulaSystem.ts:253` (nebula shatter shards)
- `engine/systems/NebulaSystem.ts:515` (nebula merge result polygon)

Fix: extracted `buildShardPolygon(numPoints, baseR, rMin, rRange,
angleJitterK)` into `engine/shardPolygon.ts`.  Each call site drops
from 6–9 lines of boilerplate to a single line; the tunable params
(numPoints, r-range, jitter) stay at the call site so the shape-tuning
intent remains visible.

Out of scope: `DropSystem.generateShardPolygon` (line 374) uses a
slightly different formula with an extra `*2` factor on the jitter —
left alone as the semantics deliberately differ (collectible drops are
jagglier than physical shards).

### 2. Angle wrap `while (a > π) a -= 2π; while (a < -π) a += 2π`
Appears 3× (`engine/systems/AISystem.ts:170`, `AISystem.ts:332`,
`engine/systems/ProjectileSystem.ts:159`).

Decision: **leave alone**.  Each site is 2 lines inline, the idiom is
widely recognised, and a one-liner wrapper would add a file-level
import for marginal clarity gain.  Flagged here for future cleanup if
a fourth site ever appears.

### 3. Rotate-toward-target pattern
`AISystem:169–178`, `AISystem:331–340`, `ProjectileSystem:156–171`
all do "compute angle diff, wrap, step by `turnRate·dt` toward target".

Decision: **leave alone**.  A `rotateToward(current, target,
maxStep)` helper would be legitimately cleaner, but it would hide a
game-feel tunable in three different AI contexts where the surrounding
logic (velocity rotation in ProjectileSystem, speed-mode branch in
dogfighter) is distinct enough that keeping the five-line inline form
is more readable.

### 4. `impactSpeed = iv ? sqrt(iv.x² + iv.y²) : 0`
3× (`GameEngine:1758`, `NebulaSystem:221`, `DropSystem:235`).

Decision: **leave alone**.  Each call site also needs `iv` afterwards
(for `Math.atan2`), so a helper would either return a tuple or require
re-reading the field — not a win.  The 2-line computation is fine as
inline code.

### 5. Vector length `Math.sqrt(x*x + y*y)`
20+ occurrences across engine files.

Decision: **leave alone**.  This is the canonical 2-D magnitude idiom;
wrapping it in a `vectorLength({x,y})` helper would force call sites
to either construct an object or call with two scalars — neither wins
on readability, and the helper wouldn't be inlined by V8 in every
case.  `Math.hypot` is technically available but is slower in hot
paths, so the explicit form is preferred here.

### 6. `0–1 clamp` — `Math.max(0, Math.min(1, v))`
~8 occurrences in `RenderSystem.ts` + one in `NebulaColor.ts`.

Decision: **leave alone**.  Already a local `clamp` const inside
`NebulaColor.rgb01ToHex`; promoting it to a shared file to cover
RenderSystem saves six characters per use at the cost of an import.
Not worth it.

### 7. Hex geometry constants (`w = sqrt(3)·hexSize`, `h = 2·hexSize`,
`hDist`, `vDist`) in `TileGenerator.generateClusteredMesh` /
`generateNebulaClusters` / `createNebulaTileEntity`.

Decision: **leave alone**.  Same file, 3 local uses, already obvious.
Extracting would turn "four lines of arithmetic" into "one helper call
+ a destructure" with no clarity gain.

### 8. Speed cap `if (speed > maxSpeed) v /= speed; v *= maxSpeed`
2 uses in AISystem (lines 163, 293).  Threshold for extraction is 3+;
leave as-is.

## Summary

- Candidates inspected: **8**
- Consolidations applied: **1** (shard-polygon builder, 7 call sites
  → single helper in `engine/shardPolygon.ts`)
- Deferred items: **7** (listed above with rationale)
- Files modified: 4 (`GameEngine.ts`, `MapClasses.ts`, `DropSystem.ts`,
  `NebulaSystem.ts`); each change is small (net line delta negative)
  and stays well under the 20-percent-per-file cap.
- Public APIs unchanged.
- `npx tsc --noEmit`: passes.
