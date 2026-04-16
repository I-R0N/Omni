# Agent 2 — Type/Interface Consolidation Report

Date: 2026-04-16
Branch: `claude/codebase-cleanup-quality-511lW`

## Scope

Inventory all `interface` / `type` declarations across `.ts`/`.tsx`, identify
duplicates and candidates for consolidation into the central `types.ts`.

## Methodology

- Read `types.ts` (~390 lines).
- Grep for `^(export )?(interface|type) \w+` across all `.ts`/`.tsx`.
- Grep for each type name to determine cross-file usage.
- Check whether declaration is exported and whether >1 module imports it.

## Full Inventory

### `types.ts` (central domain types — KEEP)

| Name | Kind | Cross-file users |
|---|---|---|
| `MapType` | enum | many |
| `GameState` | enum | many |
| `Vector2` | interface | many |
| `TrailPoint` | interface | 3 |
| `Rect` | interface | **0 (dead)** |
| `EntityType` | enum | many |
| `EnemySubtype` | enum | many |
| `EnemyRole` | enum | many |
| `WeaponType` | enum | many |
| `WeaponConfig` | interface | several |
| `ShardType` | type alias | 3 |
| `NebulaColorStop` | interface | 4 |
| `DropCompositionEntry` | type alias | 2 |
| `GameEntity` | interface | many |
| `CameraState` | interface | 2 |
| `PerfSnapshot` | interface | 3 |
| `EngineStats` | interface | 3 |
| `DamageText` | interface | 3 |
| `WaveAnnouncement` | interface | 4 |
| `PlayerHUDMessage` | interface | 3 |

### Scattered types outside `types.ts`

| Name | Kind | File | Exported? | Cross-file users |
|---|---|---|---|---|
| `AssetManifest` | type alias | `assets.ts` | yes | 0 (used only within `assets.ts`) |
| `UIOverlayProps` | interface | `components/UIOverlay.tsx` | no | 0 (React props) |
| `WaveSpawnContext` | interface | `engine/systems/WaveSystem.ts` | yes | 1 (`GameEngine.ts`) |
| `FlowVector` | interface | `engine/systems/FlowField.ts` | yes | 0 (internal to FlowField) |
| `FlowVector` | interface | `engine/systems/FlowFieldGrid.ts` | yes | 0 (internal to FlowFieldGrid) |
| `Vortex` | interface | `engine/systems/FlowField.ts` | no | 0 (module-local) |
| `StarBand` | interface | `engine/systems/BackgroundManager.ts` | no | 0 (module-local) |
| `NebulaPuff` | interface | `engine/systems/BackgroundManager.ts` | no | 0 (module-local) |
| `ShootingStar` | interface | `engine/systems/BackgroundManager.ts` | no | 0 (module-local) |
| `SlotKind` (local, in function body) | type alias | `engine/systems/DropSystem.ts:137` | no | 0 (function-local) |

## Duplicates & Near-Duplicates

### Exact duplicate (HIGH confidence fix)

`FlowVector` is declared identically in two sibling files:

```
engine/systems/FlowField.ts:32
  export interface FlowVector { x: number; y: number; }
engine/systems/FlowFieldGrid.ts:63
  export interface FlowVector { x: number; y: number }
```

Shape is identical. `FlowFieldGrid.ts` already imports `sampleFlow` from
`FlowField.ts`, so the simplest dedupe is:

- Keep `FlowVector` in `FlowField.ts` (colocated with `sampleFlow` which
  returns it).
- Re-export `FlowVector` from `FlowFieldGrid.ts` so existing module API
  stays compatible for any future importer (no current external users,
  but the symbol was part of both modules' public surface).

We deliberately do **not** move it to `types.ts`: it is internal to the
flow-field subsystem (no module outside those two files imports it), so
keeping it colocated with `sampleFlow` preserves locality-of-reference.

### Near-duplicates

None identified. `Vector2` (types.ts) and `FlowVector`/`StarBand` fields
`x: number, y: number` overlap in shape but are semantically distinct
(unit flow direction vs 2D position). Consolidating would widen meaning.

## Recommendations

| # | Action | Confidence | Status |
|---|---|---|---|
| 1 | Remove duplicate `FlowVector` in `FlowFieldGrid.ts`; import from `FlowField.ts` and re-export | HIGH | **APPLIED** |
| 2 | Remove dead `Rect` from `types.ts` (0 references; Agent 3 deferred) | HIGH | **APPLIED** |
| 3 | Keep `WaveSpawnContext` in `WaveSystem.ts` | HIGH | not applied (already good) |
| 4 | Keep `AssetManifest` in `assets.ts` | HIGH | not applied (already good) |
| 5 | Keep `UIOverlayProps`, `Vortex`, `StarBand`, `NebulaPuff`, `ShootingStar` local | HIGH | not applied (already good) |

### Why `WaveSpawnContext` stays local

It references `PhysicsSystem` (a class imported from a sibling system
module). Moving it into `types.ts` would pull a system-class dependency
into the central types file, which would be a coupling regression — any
future tree-shake or type-only split would need to ignore the class import.
Only one other module (`GameEngine`) consumes it, so keeping it at the
point of definition is fine.

### Why module-local types stay local

- `UIOverlayProps`, `Vortex`, `StarBand`, `NebulaPuff`, `ShootingStar`:
  all unexported, zero cross-module use — they are implementation detail,
  not shared domain types.
- `AssetManifest`: only used within `assets.ts` (the declaration, the
  const, and nothing else imports the type name). Moving it to `types.ts`
  would split the manifest shape from its data.

## Consolidations Applied

1. `types.ts`: removed dead `Rect` interface (lines 29-34).
2. `engine/systems/FlowFieldGrid.ts`: replaced local `FlowVector`
   declaration with `import type { FlowVector } from './FlowField'`
   and re-exported it so the module-level public surface is preserved.

No public type shapes changed. No files edited by more than a handful of
lines (well under the 20% threshold).

## Verification

- `npx tsc --noEmit` — PASS (recorded after edits; see commit).

## Deferred / Flagged for Human Review

None. No near-duplicates to adjudicate.
