# Agent 5 — Weak Type Elimination

Branch: `claude/codebase-cleanup-quality-511lW`
Date: 2026-04-16

## Scope

Scanned all `**/*.{ts,tsx}` under the project root (excluding `node_modules/`
and `cleanup-reports/`) for the following weak-type patterns:

- Explicit `any` (annotations, `as any`, `<any>`)
- Implicit `any` via untyped function parameters (verified with
  `tsc --noImplicitAny`)
- Raw `unknown` used without narrowing
- `Object`, `{}`, `Function` annotations
- `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`
- Untyped `catch` clauses

The project is small (one component + a handful of engine systems) and was
already in very good shape — most parameters are typed or inferred from a
well-typed context.

## Findings

### 1. Explicit `any` — APPLIED

| File:line | Before | After | Confidence | Rationale |
|-----------|--------|-------|------------|-----------|
| `engine/GameEngine.ts:707` | `handleAsteroidRespawn(config: any)` | `handleAsteroidRespawn(config: (typeof ASTEROID_GENERATION_CONFIG)[MapType])` | High | Single caller at line 519 passes `ASTEROID_GENERATION_CONFIG[MapType.UNIVERSE]`. The config shape is fully declared in `constants.ts:218` as `{ count, minSize, maxSize, radius, speedMultiplier }`. Indexed-access preserves future shape changes without duplication. |

### 2. Explicit `any` — DEFERRED

None. The GameEngine hit was the only explicit `any` in the codebase.

### 3. Implicit `any` parameters — NONE

Ran `tsc --noEmit --noImplicitAny` and filtered out unavoidable third-party
noise (missing `@types/react` / `@types/react-dom`). Remaining reports were
all React destructured props in `components/UIOverlay.tsx:19-28`, which are
**already** typed via `React.FC<UIOverlayProps>`. They only surface as TS7031
because React's own type declarations are missing, not because the author
omitted an annotation. Installing `@types/react` is out of scope (dependency
change) and the destructured params become typed automatically once it
lands. No code change needed.

All callback parameters in the codebase (`(newStats) =>`, `(clearedIndex) =>`,
etc.) infer their types from well-typed callback signatures; none is
implicit-any at compile time under the current config.

### 4. `unknown` without narrowing — NONE

No occurrences of the `unknown` keyword in the project source.

### 5. `Object` / `{}` / `Function` annotations — NONE

- `Object.values(ASSETS)` at `engine/systems/RenderSystem.ts:114` is a call
  on the global `Object` constructor, not a type annotation.
- `ammo: {}` at `engine/GameEngine.ts:217` is an empty-object *literal*
  initializer (the `ammo` field has a strong type on the `GameEntity`
  interface); it is not a `{}` annotation.
- No `: Function` annotations anywhere.

### 6. `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` — NONE

### 7. `catch` clauses

| Location | Decision | Rationale |
|----------|----------|-----------|
| `engine/GameEngine.ts:380, 403, 404, 424` — `catch (e) { console.error(...) }` | **Leave as-is** | TS 4.4+ infers `unknown` for untyped catch vars and `console.error` accepts `unknown` without narrowing. Adding `: unknown` would be a no-op. Per the task brief: only retype if `e` is both read *and* narrowed. |
| `engine/systems/RenderSystem.ts:1005` — `catch (e) { drawn = false; }` | **Leave as-is** | `e` is not read. |

## Summary

- **Findings total:** 1 explicit `any`, 4 meaningful catch clauses (all
  correct as-is), 0 other weak-type patterns.
- **Applied:** 1 (`config: any` → indexed-access type in GameEngine).
- **Deferred:** 0.
- **Flagged for review:** 0.

## Verification

- `npx tsc --noEmit` — passes (zero errors, zero warnings).
- Public API shapes untouched (`index.tsx`, `App.tsx`, `types.ts`
  unchanged).
- Single file modified: `engine/GameEngine.ts` (1 line, well below the 20%
  file-change cap).
