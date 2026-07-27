<!--
The standalone iPhone/desktop preview link is posted automatically as a
comment by the "PR preview" workflow once the build finishes. You do not
need to paste it here.
-->

## What changed

<!-- One or two sentences. What does this PR do, in gameplay or system terms? -->

## Why

<!-- The motivation: bug, feel problem, perf issue, planned increment. Link the
     doc or issue if there is one. -->

## How to verify in the preview

<!-- Concrete steps the reviewer can follow in the githack preview build.
     Name the map, the DBG toggle, the enemy spawn button — whatever gets the
     reviewer to the change in under 30 seconds. -->

1.
2.

## Checklist

- [ ] `npm run build` passes locally
- [ ] Verified in the standalone preview build (not just `npm run dev`)
- [ ] Torus math goes through `wrapDeltaX` / `wrapDeltaY` — no naive `a.x - b.x`
- [ ] No per-frame `{x, y}` allocation added to physics / render / AI hot paths
- [ ] Any new periodic pass is registered in `PERF_TASKS` and gated on
      `perfController.shouldRun(id)` — not a private frame counter
- [ ] `CLAUDE.md` updated if this PR hits any trigger in its §10
      (new subsystem, changed invariant, new build step, new
      `dropType` / `aiState` / `EntityType` / `WeaponType` / `MapType`)

## Risk / blast radius

<!-- What could this break that is not obvious from the diff? Say "low, isolated
     to X" if that is genuinely the case. -->

## Notes for the reviewer

<!-- Anything you want a second opinion on, or deliberately left out of scope. -->
