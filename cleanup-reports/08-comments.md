# Agent 8 — Comment & Slop Cleanup

Scope: prune AI-generated filler, in-motion "Phase N" refactor refs, stub/placeholder
comments, and redundant section headers.  Keep WHY / rationale / workaround notes.

## Findings & actions

Each entry lists file:line, kind, confidence, action.  Line numbers are pre-edit.

### HIGH-confidence removals (applied)

| file:line | kind | action |
| --- | --- | --- |
| `engine/GameEngine.ts:48-52` | in-motion ("Phase 1") | drop Phase marker, keep WHY |
| `engine/GameEngine.ts:77-79` | in-motion ("old GameEngine.waveX field ergonomics") | reword to call-site compat note |
| `engine/GameEngine.ts:99-100` | in-motion ("forwarded from WaveSystem so existing call sites keep working") | trim to one-line purpose |
| `engine/GameEngine.ts:387-395` | in-motion ("Fixed-timestep accumulator (Phase 1)") | drop Phase marker |
| `engine/GameEngine.ts:439-442` | in-motion ("Phase 4: rebuild type-filtered…") | drop Phase marker |
| `engine/GameEngine.ts:1125` | redundant ("Thin wrapper kept for call-site compatibility") | delete |
| `engine/GameEngine.ts:1302-1303` | in-motion ("during the Phase 2 split") | drop Phase marker |
| `engine/GameEngine.ts:1335-1337` | in-motion ("Phase 4: walk the pre-filtered…") | drop Phase marker |
| `engine/GameEngine.ts:1483` | in-motion ("Phase 4: asteroids come straight from…") | drop Phase marker |
| `engine/GameEngine.ts:1837` | redundant ("Thin wrappers kept for internal call-site compatibility") | delete |
| `engine/GameEngine.ts:1851-1854` | redundant ("Drop / shard thin wrappers… these wrappers preserve the existing call sites") | trim |
| `engine/GameEngine.ts:862` | redundant ("Debug visualization assignment") | delete |
| `engine/GameEngine.ts:868-870` | slop (restates code) | delete |
| `engine/GameEngine.ts:255` | redundant section header `--- STATE MANAGEMENT ---` | delete |
| `engine/GameEngine.ts:1821` | redundant section header `--- WAVE SYSTEM ---` | delete |
| `engine/GameEngine.ts:462-463` | slop ("Prioritize larger shakes") | kept — reads like WHY-ish but above is obvious. Defer (ambiguous) |
| `engine/systems/PhysicsSystem.ts:286-292` | in-motion ("Phase 2: consumes EntityIndex.asteroids…") | drop Phase/rollout story, keep filter note |
| `engine/systems/PhysicsSystem.ts:327-330` | in-motion ("Phase 2: use the attractors cache…") | drop Phase marker |
| `engine/systems/PhysicsSystem.ts:127-137` | slop (OPTIMIZATION banner + restated reasoning) | trim OPTIMIZATION banner; retain nebula-invariant warning |
| `engine/systems/PhysicsSystem.ts:336` | redundant ("Optimization: Skip particles and structures") | delete banner |
| `engine/systems/PhysicsSystem.ts:1053` | redundant section header (`// --- OPTIMIZED SAT HELPERS ---`) | delete |
| `engine/systems/ProjectileSystem.ts:16-18` | in-motion ("Extracted from GameEngine in Phase 2") | drop Phase note |
| `engine/systems/ProjectileSystem.ts:127-131` | in-motion ("Phase 4: the caller supplies…") | drop Phase marker |
| `engine/systems/ProjectileSystem.ts:182-186` | in-motion ("Phase 4: works off EntityIndex candidate lists") | drop Phase marker |
| `engine/systems/WeaponSystem.ts:16-19` | in-motion ("Extracted from GameEngine in Phase 2") | drop Phase note |
| `engine/systems/WeaponSystem.ts:113` | in-motion ("Phase 4: `enemies` is the pre-filtered…") | drop Phase marker |
| `engine/systems/ParticleSystem.ts:8` | in-motion ("Extracted from GameEngine in Phase 2 of the engine upgrade") | drop |
| `engine/systems/TrailSystem.ts:6` | in-motion ("Extracted from GameEngine in Phase 2") | drop |
| `engine/systems/WaveSystem.ts:17-23` | in-motion ("Extracted from GameEngine in Phase 3 of the engine upgrade…") | drop Phase refs |
| `engine/systems/DropSystem.ts:16-24` | in-motion ("Extracted from GameEngine in Phase 3") | drop Phase refs |
| `engine/systems/DropSystem.ts:29,40,76,118,291,350` | redundant section banners (`// --- Wave-scaled ammo dispensing ---`) | delete |
| `engine/systems/NebulaSystem.ts:33-36` | in-motion ("Extracted from GameEngine as part of the Phase-2/3 style system split introduced by the engine-upgrade PR") | drop Phase/PR refs |
| `engine/systems/EntityIndex.ts:6-11` | in-motion ("Phase 4 of the engine upgrade") | drop Phase ref, keep rationale |
| `engine/systems/IdAllocator.ts:4` | in-motion ("Phase 5 of the engine upgrade") | drop Phase ref |
| `engine/systems/RenderSystem.ts:67` | redundant ("Optimization: Reusable buffer for sorting indicators to prevent array allocation") | trim to purpose |
| `engine/systems/RenderSystem.ts:556` | slop (`--- OPTIMIZATION: Polygon Strip ---`) | trim banner |
| `engine/systems/RenderSystem.ts:1598` | stale ("REMOVED INTEGER OPTIMIZATION") | delete entirely |
| `engine/systems/RenderSystem.ts:274` | slop ("Helper to load/get images") | delete (signature is self-describing) |
| `engine/systems/RenderSystem.ts:13-14` | slop (restates that hex→rgb is a converter) | trim to cache-reason only |
| `engine/systems/AISystem.ts:199,218,246,298,318` | redundant section banners | delete each |
| `engine/systems/InputSystem.ts:56` | slop ("Helper to detect if we should ignore input…") | leave; it warns about non-canvas UI targets (keeps) — Defer |
| `constants.ts:22,655` | redundant section banners (`// --- SYSTEM CONFIGURATIONS ---` / `// --- ASSETS ---`) | delete |
| `constants.ts:179-184` | in-motion ("Engine upgrade Phase 1: the simulation…") | drop Phase ref, keep jitter rationale |
| `assets.ts:47` | in-motion/TODO ("TODO: Replace PLACEHOLDER entries with real asset locations (CDN/object storage).") | keep (real outstanding work, actionable) — Defer |
| `types.ts:199` | in-motion ("gold kept for drop-system compat until PR 2") | drop the "until PR 2" part |

### Deferred (ambiguous or genuine content)

- `engine/systems/PhysicsSystem.ts:38-40` — JSDoc-ish rationale with specific line-number references to other files. These will go stale, but they document non-obvious buffer sizing; keeping.
- `assets.ts:47` — the TODO names an actionable follow-up (CDN/object storage migration), not an in-flight refactor. Kept.
- `engine/GameEngine.ts:462-463` "Prioritize larger shakes" — one-liner states intent over a single if; ambiguous value. Kept.
- `engine/systems/InputSystem.ts:56` "Helper to detect…" — label is slop but the block below actually codifies non-obvious UI-click gating; kept as-is rather than risk over-pruning.
- `engine/GameEngine.ts:1598` (`REMOVED INTEGER OPTIMIZATION` in RenderSystem) — delete confirmed.

### Not changed

- Render math rationale comments (`GameEngine.ts:1430-1437`, `NebulaSystem.ts:180-198`, etc.) — they document invariants and tuning tradeoffs.
- Constants-file tuning knob rationale — all preserved per instructions.
- JSDoc on exported APIs — untouched.
- License / header comments — none present.

## Typecheck

`npx tsc --noEmit` → pass (see commit step).

## Volume check

Files touched are below the 20% modification ceiling; edits are comment-only
and do not alter runtime behaviour.
