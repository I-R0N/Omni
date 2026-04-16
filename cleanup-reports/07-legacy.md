# Agent 7 — Legacy & Deprecated Code Removal Report

Branch: `claude/codebase-cleanup-quality-511lW`.
Prior: Agent 3 commit `f2082e5` removed dead exports + `CHUNK_SIZE`, `resetIdCounter`, `NEBULA_PALETTE_HUE_*`, `WaveSystem Vector2` re-export.

## Searches run

Via Grep (literal and regex):
- `@deprecated`, `DEPRECATED`, `LEGACY`, `Legacy`, `legacy`
- `TODO`, `FIXME`, `HACK`, `XXX`
- `temporary`, `temp `, `backward.?compat`, `backcompat`, `DO NOT USE`, `do not use`
- `fallback`, `Fallback`
- `ENABLE_|USE_NEW_|USE_OLD_|FEATURE_`
- Commented-out code patterns (`^\s*//\s*(if|for|while|const|let|var|function|return|this\.|ctx\.|\})`)
- Feature-flag-shaped constants (`:\s*(true|false)`) in `constants.ts`
- Always-literal branches: `if (true`, `if (false`
- Multi-line block comments (5+ lines) — confirmed all are JSDoc, not commented code

## Findings

| File:Line | Kind | Confidence | Rationale | Action |
|---|---|---|---|---|
| `constants.ts:176` | Legacy unused constant `PHYSICS_CONSTANTS.RECOIL_FORCE: 0` | **high** | Grep shows zero references outside the definition. Self-labelled "Legacy, unused now that mass is implemented" | **APPLY**: remove field |
| `engine/systems/NebulaSystem.ts:155` | Stale marker comment `// Private method stubs — filled in by subsequent edits.` | **high** | Methods below are fully implemented; comment describes a past work-in-progress state | **APPLY**: delete comment |
| `constants.ts:167` `INPUT_CONSTANTS.ZERO_DELAY_SHOOTING: false` | Feature flag | low (keep) | Documented input-tuning knob. Branch on it in `InputSystem.ts:139` is intentional. Not dead. | Keep |
| `constants.ts:349` `NEBULA_CONSTANTS.TILE_REGEN_ENABLED: false` | Feature flag | low (keep) | Comment explicitly documents the off-state as the current game-design default with tuning rationale; branch at `NebulaSystem.ts:122` is live design intent, not stale dual-path. | Keep |
| `assets.ts:47` `// TODO: Replace PLACEHOLDER entries ...` | TODO | low (keep) | Tracks real asset-swap work, not a "remove this" note | Keep |
| `constants.ts:172,173` `// Fallback default` | Comment tag | low (keep) | Documents a fallback code path that is actively used by per-entity move configs | Keep |
| `constants.ts:176 // Legacy...` | → handled above | | | |
| `engine/maps/TileGenerator.ts:302` `color: composition[0].hex, // legacy single-colour field, kept in sync` | "legacy" field | low (keep) | Field `color` is used in renderer/fallbacks for non-composition paths; widely referenced. Removing would be API refactor. | Keep |
| `engine/systems/PhysicsSystem.ts:238` `// legacy behavior` | prose in comment | low (keep) | Explanatory doc for `timeScale` math, not code | Keep |
| `engine/systems/BackgroundManager.ts:117,177` "legacy random distribution / legacy maps" | Fallback branch | low (keep) | Handles maps that don't set cluster centers; removing would break those call paths. Live dual-path by design. | Keep |
| `engine/systems/RenderSystem.ts:807,833,874,891` "legacy tiles / legacy shards / legacy fallback" | Optional-field fallbacks | low (keep) | Guards against entities missing optional fields (`nebulaFadeDuration`, `polygonPoints`, etc., all declared optional in `types.ts`). Safe defensive code. | Keep |
| `engine/systems/RenderSystem.ts:30-41` `roundRect` polyfill | Compat shim | low (keep) | Intentional polyfill for older canvases per the comment; removing would reduce compat | Keep |
| `engine/systems/WeaponSystem.ts:45` `auto-fallback to blaster` | Feature | low (keep) | Real gameplay behavior, not legacy code | Keep |
| `engine/GameEngine.ts:1124,1135,1853,1869` thin-wrapper comments | Delegation wrappers | low (keep) | Wrappers are live; called from `updateGameLogic` and death/drop paths. Removing would require inlining across many call sites — refactor, out of scope. | Keep |

## Applied changes (this agent)

1. **`constants.ts:176`** — removed the `RECOIL_FORCE: 0` entry (and preceding comma on `PLAYER_MASS`) from `PHYSICS_CONSTANTS`. Zero references found in the whole tree. Self-labelled legacy.
2. **`engine/systems/NebulaSystem.ts:155`** — removed the stale `// Private method stubs — filled in by subsequent edits.` marker comment. The stubs referenced are all implemented immediately below it.

Both changes are deletions only — no API shape change, no type changes, no public re-exports touched. Changes are <1% of each file.

## Deferred / explicitly kept

- All the "Legacy"/"legacy"/"Fallback" occurrences other than `RECOIL_FORCE` — each is either a live alternative code path guarding optional fields, an intentional design knob, or a compat polyfill with a clear purpose in-comment.
- `types.ts` not touched (Agent 2 owns it).
- `ZERO_DELAY_SHOOTING` and `TILE_REGEN_ENABLED` — feature-flag-shaped but documented as game-design toggles. Collapsing them would be a design decision, not a cleanup.
- `WeaponSystem` blaster auto-fallback — gameplay logic.
- Thin-wrapper delegation methods in `GameEngine` — collapsing these into direct calls is a refactor, out of scope.

## Verification

`npx tsc --noEmit` — passes (exit 0) after changes.
