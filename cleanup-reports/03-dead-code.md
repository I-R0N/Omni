# Agent 3 — Dead Code Elimination Report

## Tool versions

- knip@5 (via `npx --yes knip@5 --no-progress`)
- ts-prune (via `npx --yes ts-prune`)
- TypeScript: 5.8 (project)
- Node/npm: host default

## Raw tool output

### knip

```
Unused exports (8)
WAVE_CONFIG                    constants.ts:678:14
WAVE_DEFINITIONS               constants.ts:844:14
HEX_WIDTH                      engine/maps/TileGenerator.ts:12:14
HEX_HEIGHT                     engine/maps/TileGenerator.ts:13:14
HEX_V_SPACING                  engine/maps/TileGenerator.ts:14:14
randomPaletteHueDeg  function  engine/NebulaColor.ts:225:17
FF_COLS                        engine/systems/FlowFieldGrid.ts:39:14
FF_ROWS                        engine/systems/FlowFieldGrid.ts:40:14
Unused exported types (5)
AssetManifest  type       assets.ts:2:13
FlowVector     interface  engine/systems/FlowField.ts:32:18
FlowVector     interface  engine/systems/FlowFieldGrid.ts:63:18
Vector2        type       engine/systems/WaveSystem.ts:221:15
Rect           interface  types.ts:29:18
Duplicate exports (1)
FF_COLS|FF_ROWS  engine/systems/FlowFieldGrid.ts
```

### ts-prune

```
assets.ts:2 - AssetManifest (used in module)
constants.ts:678 - WAVE_CONFIG (used in module)
constants.ts:844 - WAVE_DEFINITIONS (used in module)
types.ts:29 - Rect
vite.config.ts:6 - default
engine/NebulaColor.ts:225 - randomPaletteHueDeg (used in module)
engine/maps/TileGenerator.ts:12 - HEX_WIDTH (used in module)
engine/maps/TileGenerator.ts:13 - HEX_HEIGHT (used in module)
engine/maps/TileGenerator.ts:14 - HEX_V_SPACING (used in module)
engine/systems/FlowField.ts:32 - FlowVector (used in module)
engine/systems/FlowFieldGrid.ts:39 - FF_COLS (used in module)
engine/systems/FlowFieldGrid.ts:40 - FF_ROWS (used in module)
engine/systems/FlowFieldGrid.ts:63 - FlowVector (used in module)
engine/systems/WaveSystem.ts:221 - Vector2 (used in module)
```

Note: `vite.config.ts:6 - default` is the Vite-injected entry (framework convention) — not dead.

## Previously-staged dead code (in working tree from prior pass)

Three items were already removed (uncommitted) before Agent 3 started. They are kept and committed by Agent 3 because they are all truly unreferenced and I verified each:

| File | Symbol | Verification | Confidence |
|---|---|---|---|
| `constants.ts:6` | `CHUNK_SIZE` | `grep -r CHUNK_SIZE` returns zero refs outside this line | high |
| `engine/NebulaColor.ts:126-129` | `NEBULA_PALETTE_HUE_MIN/MAX/RANGE` | zero refs anywhere | high |
| `engine/systems/IdAllocator.ts:33-40` | `resetIdCounter` | zero refs anywhere | high |

## Findings (knip + ts-prune)

Each flagged item was verified by grepping the whole codebase. In this project knip's "unused exports" means the symbol is not imported elsewhere; most of these are used inside their own module (intra-module usage doesn't require `export`, so only the `export` keyword is redundant — not the whole symbol). Per task constraints ("only delete, do not rewrite/refactor"), those are flagged for review, not deleted.

| File:Line | Symbol | Kind | Observed usages | Action | Confidence |
|---|---|---|---|---|---|
| `constants.ts:678` | `WAVE_CONFIG` | const | Used in-module by `generateWaveDef` | Flag — remove `export`? refactor | high that the symbol is needed, medium that the `export` is redundant (data table convention; may be used by future authoring/tooling) |
| `constants.ts:844` | `WAVE_DEFINITIONS` | const | Used in-module by `generateWaveDef` | Flag — same as above | medium |
| `engine/maps/TileGenerator.ts:12-14` | `HEX_WIDTH`, `HEX_HEIGHT`, `HEX_V_SPACING` | const | Used in-module (lines 26–37) | Flag — `export` is redundant | medium |
| `engine/NebulaColor.ts:225` | `randomPaletteHueDeg` | function | Used in-module by `randomNebulaComposition` | Flag — `export` is redundant | medium |
| `engine/systems/FlowFieldGrid.ts:39-40` | `FF_COLS`, `FF_ROWS` | const | Used heavily in-module | Flag — `export` is redundant | medium |
| `engine/systems/FlowField.ts:32` | `FlowVector` | interface | Used as return type of `sampleFlow` in-module | Flag — `export` is redundant | medium |
| `engine/systems/FlowFieldGrid.ts:63` | `FlowVector` | interface | Public return type of `sampleAsteroidFlow`/`sampleEnemyFlow`/`sampleWallRepulsion`; external callers use structural typing | Flag — export kept is harmless; removing would require audit | low |
| `assets.ts:2` | `AssetManifest` | type | Used in-module as annotation for `ASSETS` | Flag — `export` is redundant | medium |
| `engine/systems/WaveSystem.ts:221` | `Vector2` re-export | type re-export | `grep -r` shows NO importer of `Vector2` from `WaveSystem` (all callers import directly from `types.ts`) | **DELETE** | high |
| `types.ts:29` | `Rect` | interface | Zero references in the entire tree | **Flag for Agent 2** — task forbids heavy edits to `types.ts` | high (dead), high (out of scope) |

## Applied changes

Single deletion:

- `engine/systems/WaveSystem.ts` — removed the trailing 3-line block (comment + `export type { Vector2 };`). No importer of `Vector2` from `WaveSystem` exists; the comment describes the purpose of that re-export, so it is removed together. The module's primary `Vector2` import on line 1 is untouched.

Previously-staged deletions preserved:

- `constants.ts` — `CHUNK_SIZE` constant removed (no refs).
- `engine/NebulaColor.ts` — legacy `NEBULA_PALETTE_HUE_MIN/MAX/RANGE` constants + stale comment block removed (no refs).
- `engine/systems/IdAllocator.ts` — `resetIdCounter` function removed (no refs).

## Deferred items (require human / Agent 2 review)

- `types.ts:29 Rect` — genuinely unreferenced; defer to Agent 2 who owns `types.ts`.
- All "unused export" items in the findings table — symbols are alive (used in-module); removing just the `export` keyword would be a refactor rather than a deletion, which Agent 3's charter forbids. Each is a one-token change and is safe if a later agent wants to tighten visibility.
- `docs/POLISH_ARCHITECTURE.md` mentions `FlowFieldGrid.onTileDestroyed` — method exists, not relevant.
- Vite `default` export in `vite.config.ts` — required by Vite convention.

## Verification

`npx tsc --noEmit` — passes (no output, exit 0) after applied changes.
