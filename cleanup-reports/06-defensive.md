# Agent 6 — Defensive Programming Removal

Branch: `claude/codebase-cleanup-quality-511lW`
Date: 2026-04-16
Scope: Spurious try/catch, silent fallbacks, redundant null checks.

## Methodology

Grepped the codebase for `try {`, `catch (`, `?? `, `||` fallbacks (`|| 0`, `|| []`,
`|| {}`), and `if (!…) return` patterns. Classified each hit against the keep/remove
rubric in the agent instructions and cross-checked typings in `types.ts`.

The codebase is small (one top-level `App.tsx` + `engine/` + `components/`) and the
render / physics code is the only substantial surface, so coverage is complete.

---

## Findings

### A. try/catch — defensive swallow pattern (REMOVE)

| # | File:Line | Snippet | Classification | Confidence | Action |
|---|---|---|---|---|---|
| A1 | `engine/GameEngine.ts:381` | `try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }` | Spurious — `console.error` + swallow around an internal method that throwing from would indicate a real bug we want loud | High | REMOVE |
| A2 | `engine/GameEngine.ts:404` | `try { this.updatePhysics(FIXED_DT); } catch (e) { console.error('[PhysicsSystem] update error:', e); }` | Same pattern — hides sim bugs | High | REMOVE |
| A3 | `engine/GameEngine.ts:405` | `try { this.updateGameLogic(FIXED_DT); } catch (e) { console.error('[GameLogic] update error:', e); }` | Same pattern | High | REMOVE |
| A4 | `engine/GameEngine.ts:425` | `try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }` | Duplicate of A1 on the playing-path | High | REMOVE |

These wrap pure internal engine calls. The catch just logs and continues — there is
no legitimate throwable inside the sub-tree that isn't a programming bug that should
surface loudly. Canvas / Image / localStorage trust boundaries all happen deeper in
RenderSystem and are wrapped there individually where appropriate.

### B. try/catch — genuine trust boundary (KEEP)

| # | File:Line | Purpose | Decision |
|---|---|---|---|
| B1 | `engine/systems/NebulaSystem.ts:148` | `try … finally` to reset `currentFrameEntities = null` — this is a cleanup finalizer, not a catch | KEEP |
| B2 | `engine/systems/RenderSystem.ts:211` | `tctx.getImageData` — canvas-taint DOM trust boundary | KEEP |
| B3 | `engine/systems/RenderSystem.ts:964` | `ctx.drawImage(img,…)` — image load / draw can throw for a broken image; falls back to shape rendering | KEEP |

### C. Null fallbacks on optional fields (KEEP — typed optional)

All `?? 0`, `?? 1`, `?? 'asteroid'`, `?? NEBULA_CONSTANTS.*` fallbacks in
`engine/GameEngine.ts`, `PhysicsSystem.ts`, `AISystem.ts`, `NebulaSystem.ts`,
`RenderSystem.ts`, `WeaponSystem.ts`, `DropSystem.ts`, `ProjectileSystem.ts`,
`TrailSystem.ts`, `ParticleSystem.ts` operate on fields that are genuinely optional
in `GameEntity` (`shield?`, `aiTimer?`, `dropValue?`, `mass?` on projectile
configs, `pierceCount?`, etc.). Removing these would introduce real `undefined`
propagation. KEEP all.

Likewise `DIFFICULTY_SCALES[clamped] ?? 1` and
`DIFFICULTY_STAT_SCALES[difficultyLevel] ?? DIFFICULTY_STAT_SCALES[3]` fall back
on an indexed-access that TS does not prove exhaustive. KEEP.

### D. `|| 0` / `|| []` / `|| {}` fallbacks

| # | File:Line | Classification | Decision |
|---|---|---|---|
| D1 | `engine/GameEngine.ts:269,363` | `this.currentMap?.entities.length \|\| 0` — `currentMap` is `… \| null`, optional chain gives `number \| undefined`, fallback required | KEEP |
| D2 | `engine/GameEngine.ts:270,271,364,365` | `currentMap?.name \|\| ''` — same | KEEP |
| D3 | `engine/GameEngine.ts:710` | `currentMap?.entities.filter(...) \|\| []` — same | KEEP |
| D4 | `engine/GameEngine.ts:956` | `this.player.trail = this.player.trail \|\| []` — `trail?: TrailPoint[]` is optional | KEEP |
| D5 | `engine/systems/WeaponSystem.ts:97,102` | `burstTimer`, `burstDelay` are both typed optional | KEEP |
| D6 | `engine/systems/RenderSystem.ts:364,365` | `ctx.canvas.width \|\| 0` — `width` is `number`, not undefined. However it also guards against a 0 dimension via `width === 0` check below, not via the fallback. The `\|\| 0` is redundant but removing changes nothing in behavior (number → same number). Low-value removal. | KEEP (not worth risk) |
| D7 | `engine/systems/RenderSystem.ts:653,670` | `p.lifetime \|\| 0`, `p.maxLifetime \|\| 1` — lifetime/maxLifetime are optional on GameEntity | KEEP |
| D8 | `engine/systems/AISystem.ts:200` | `this.reactionTimers.get(enemy.id) \|\| 0` — `Map.get` returns `T \| undefined` | KEEP |

### E. `if (!x) return` guards

All sampled guards are against typed-nullable references:
- `this.currentMap` is `BaseMapLayer | null` — every `if (!this.currentMap) return` is legit.
- `this.waveContext()` returns `WaveSpawnContext | null`.
- `canvasRef.current` is `HTMLCanvasElement | null` (React).
- `canvas.getContext('2d')` returns `CanvasRenderingContext2D | null` — DOM spec.
- `img.complete`, `img.naturalWidth` — DOM.
- `!entity.active`, `!enemy.aiState` — legitimate domain predicates.

No spurious `if (!x) return` found.

### F. `console.error` + swallow

Only inside A1–A4 (captured above). The `console.warn` in
`RenderSystem.getImage.onerror` is a genuine asset-load boundary report, not a
swallow. KEEP.

---

## Applied Removals

High-confidence removals: A1, A2, A3, A4 — the four `try { … } catch (e) { console.error(…) }` wrappers in `engine/GameEngine.ts`.

Fallback removals: none applied. Every `??` / `||` fallback examined either
genuinely guards a typed-optional field or the source is typed nullable. Removing
any would either introduce `undefined` in downstream arithmetic or a TS error.

## Verification

`npx tsc --noEmit` — must still pass.
