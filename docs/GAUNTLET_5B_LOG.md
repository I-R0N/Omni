# Gauntlet 5b — test-harness bootstrap

Session ledger for roadmap item **5b** (decision #46a): promote the
session-scratchpad Playwright smokes into a repo `tests/` directory and add
a `typecheck` script. **Tiers 1–2 only** of the parking lot's "Automated
test suite" entry — tiers 3–6 (unit tests, Node sim tests, visual
regression, CI gating) stay parked.

Branch `claude/gauntlet-5b-harness-7i6xf0` off `claude/plan-completion`.
PR targets `claude/plan-completion`.

**The suites in this session are RE-DERIVED, not moved.** The Pair A
gauntlet's 436 assertions and the boss gauntlet's 147 lived in session
scratchpads and are gone. What survives is the two logs' *descriptions* of
what those suites covered, which is what this session builds against. The
goal is a durable CORE net over load-bearing behaviour, not a
reconstruction of every assertion — see the coverage-gap list in the
completion summary for what was deliberately left out.

---

## Milestone checklist

- [x] **H1 — scaffolding + typecheck.** `@playwright/test` pinned,
      `playwright.config.ts` with a build-then-preview `webServer`, a
      `tests/` directory with a boot smoke, `npm run typecheck` exiting 0,
      CLAUDE.md §7 + README updated in the same commit.
- [ ] **H2 — core suites, re-derived.** Loop / economy / stat-attribution
      refold / boss traits / death + stage screens.
- [ ] **H3 — stabilize + document.** 3× consecutive clean runs,
      `tests/README.md`, CLAUDE.md consistency pass, completion summary.

---

## FOR-USER-REVIEW

*(Consolidated at the end of the session. Items appear here as they are
found.)*

1. **Four more pre-existing type errors than the brief anticipated** — see
   iteration 1. Two were live bugs in stale code paths, not just type
   noise. Called out because they mean `vite build` being green has been
   saying less than it appeared to.

---

## Iteration log

### Iteration 1 — H1: scaffolding + typecheck

**Shipped**

- `@playwright/test@1.56.1` (pinned) as a dev dependency. Browsers install
  via `npx playwright install chromium` — documented in the README rather
  than wired into `postinstall`, so `npm install` stays fast for anyone who
  only wants to run the game.
- `playwright.config.ts` — one `phone-390` project at 390×844 (the size
  every layout assertion the prior gauntlets wrote was authored against),
  `workers: 1`, no retries, and a `webServer` that runs
  `npm run build && npm run preview`. Building every run is deliberate: the
  Pair A log records a **stale-`dist` false pass**, where a suite quietly
  tested week-old code. `reuseExistingServer: false` for the same reason.
- `tests/helpers.ts` — the shared harness. Thin wrappers over
  `window.__omniEngine` / `window.__omniStats`, plus the three anti-flake
  habits both prior logs paid for: poll instead of sleep (`waitForStats` /
  `waitForEngine`), sample peaks instead of instants (`samplePeak`), and
  read the sim rather than the pixels wherever the sim exposes the same
  fact.
- `tests/boot.spec.ts` — 2 tests. The harness's own canary: build served,
  bundle parsed, React mounted, engine constructed, loop running, both
  debug handles live, console clean; and START reaching a live run on the
  hub with waves off.
- `npm run typecheck` (`tsc --noEmit`) and `npm test` (`playwright test`)
  scripts; Playwright output directories gitignored.
- CLAUDE.md §7 rewritten (the stance change) and the README's validation
  note replaced, both in this commit.

**The type errors were not the two the brief predicted — there were six.**
Two were the known pair; four had accumulated since, unseen, because
`vite build` does not type-check (esbuild strips types without checking
them). Every fix is minimal and behaviour-neutral:

| site | error | fix |
|---|---|---|
| `constants.ts` `metal-shard` | `defaultOutcome` missing | added `'compose'` + a comment that it is unreachable while `bondsWith: 'none'` |
| `ShardSystem.types.ts` | `requireSizeDeltaFraction` read but never declared | declared it optional, documented as an inert lever no variant sets today |
| `GameEngine.skipWave` | `playerStats` missing `shipWeight` / `position` | added both, matching the real snapshot |
| `GameEngine.lastStageClear` | declared with the dead discount shape | retyped to the current `salvageCredits` + reward-module shape |
| `GameEngine.statBreakdown` | `base` template missing `display` | typed as `Omit<Contrib, 'display'>` — every use spreads it and supplies its own |

Two of those six are **stale code**, not type noise: `lastStageClear` was
still declared in terms of the boss shop discount that was replaced by the
module drop, and `skipWave` hand-rolls an `EngineStats` literal that drifted
from the real one. Both would have shipped a wrong payload to the UI.

**Decisions taken**

- **D1 — the boot smoke identifies the engine by CAPABILITY, not by class
  name.** The first draft asserted `e.constructor.name === 'GameEngine'` and
  failed against `'_t'`: `vite build` minifies. Asserting on a minified name
  tests the bundler, not the game. *Alternative rejected:* disabling
  minification for the test build — that would mean the suites stop testing
  the artifact that actually deploys, which is the one thing a
  build-then-preview harness exists to guarantee.
- **D2 — `requireSizeDeltaFraction` is declared, not deleted.** The reader
  in `ShardSystem` is live but no variant sets the field, so the gate is
  inert. *Alternative rejected:* deleting the reader. It is cheaper at
  runtime, but it silently removes a designed merge lever, and the comment
  next to it names the variant it was built for. Declaring the field is the
  honest read — the type drifted, the code didn't.
- **D3 — build on every test run, no `dist` reuse.** Costs ~10s per run.
  Bought outright by the prior session's stale-`dist` false pass.
- **D4 — one worker, no retries.** Retries hide flakes, and H3's bar is
  three consecutive clean runs, so a retry would defeat the milestone.
  Software canvas rendering under worker contention is where the prior
  sessions' flakes lived.

**Validation**: `npm run typecheck` exits 0 (from 6 errors). `npm run
build` green. `npm test` — 2/2 passed, console clean.
