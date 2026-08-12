# Gauntlet — step 5: Pair C (input) + polish batch + CI gate

Ledger for the third completion-roadmap gauntlet (`docs/GAME_FEEDBACK_PLAN.md`
step 5, decisions #43 / #46b / #51). Process is the standard gauntlet
discipline (decision #41c): one milestone per iteration, one commit each,
three gates green before every commit, every judgment call recorded here with
the alternatives it beat.

Branch: `claude/gauntlet-pairc-polish-p824hy`, off `claude/plan-completion`
at `dab0394`. PR targets `claude/plan-completion`.

**Out of scope, deliberately:** audio (the collaborator's SFX session, PR #79,
is rebasing in parallel — this gauntlet does not touch the audio system or its
wiring), UI coherence beyond the listed items (5d owns that), economy and boss
tuning (step 6).

---

## Checklist

| ID | Milestone | Status |
|----|-----------|--------|
| G1 | CI gate — three gates on PRs + the plan branch, cached, verified | **done** |
| G2 | Gamepad support (Pair C c2, first half) | pending |
| G3 | Onscreen joystick (c2, second half) | pending |
| G4 | Menu help panel (c1) | pending |
| G5 | Minimap rework — nebula out, flow streamlines, faithfulness | pending |
| G6 | Portal off-screen indicators (decision #46b) | pending |
| G7 | Polish residuals — palette defaults, MAP_POPULATION authority | pending |
| G8 | OPTIONAL — NPC station shuttles (first to cut) | pending |
| G-final | Validation, docs sync, completion summary | pending |

---

## Iteration log

### G1 — CI gate (2026-08-12)

**Found already shipped.** The milestone brief asks for "one GitHub Actions
workflow" running the three gates; `.github/workflows/pr-checks.yml` already
existed, added at the tail of the 5b harness session (`47b1ab4`, "CI: run the
three validation gates on every PR as the merge gate") and already documented
in CLAUDE.md §7 and `tests/README.md`. Decision #51 (dated 2026-08-11) reads
as if the workflow is still to be written, because it was recorded from the
plan's point of view rather than the branch's. The plan doc is not mine to
edit this session, so the discrepancy is recorded here instead.

So G1 became **completion, not creation** — close the three gaps between what
shipped in 5b and what #51's milestone spec asks for:

1. **Trigger coverage.** `push` guarded only `main`. This gauntlet and the
   SFX session both land on `claude/plan-completion`, and a bad merge into
   that branch was invisible until the next PR opened against it. Added.
2. **Browser caching.** `npx playwright install --with-deps chromium`
   re-downloaded Chromium on every run.
3. **Stale README.** "There is no linter and no CI gating" — half of that
   sentence had been false since 5b.

**Measurements first** (run `31547162287`, the last green run before this
change, 2:23 wall clock):

| step | time |
|---|---|
| Checkout | 3s |
| Setup Node (with `cache: npm`) | 5s |
| `npm ci` | **2s** |
| Typecheck | 4s |
| Build | 2s |
| Install Playwright browser | **26s** |
| Test (38 suites) | 96s |

The run was already at 2:23 against a "well under 10 minutes" target, so
caching here is hygiene, not rescue. The numbers also settle *what* to cache.

**DECISION G1-a — cache the browser, not `node_modules`.**
The brief says "cache node_modules + the browser download keyed on the
lockfile + Playwright version". Implemented as: browser cache keyed on the
resolved `@playwright/test` version, and npm caching left to `setup-node`'s
`cache: npm` (which is already lockfile-keyed, and is why `npm ci` costs 2
seconds).
*Alternative rejected:* an explicit `actions/cache` over `node_modules/` with
`npm ci` skipped on a hit. It would save at most ~2s of a 143s run, and buys
a class of bug the npm cache does not have — a restored `node_modules` that
does not match the lockfile because a postinstall step, a platform-specific
optional dep, or a partial save left it inconsistent. Two seconds is not
worth a cache that can lie about what is installed.

**DECISION G1-b — split `install --with-deps` into two paths.**
A cache hit restores `~/.cache/ms-playwright` but *not* the apt system
libraries Chromium links against, so a naive `if: cache-hit != 'true'` guard
around the whole install step yields a cached browser that cannot launch. On
a hit the workflow runs `npx playwright install-deps chromium` (system
packages only); on a miss, the original `--with-deps` install. The cache key
carries the runner OS as well as the Playwright version, so a runner-image
bump cannot serve a browser build to the wrong libc.
*Alternative rejected:* caching the apt packages too. Fragile, and the deps
step is a few seconds.

**Not touched:** `pr-preview.yml`, `publish-standalone.yml` (brief), and the
`validate` job's structure — step order, the 45-minute timeout, the
failure-only report upload, and the deliberate absence of secrets (which is
what lets the gate run on fork PRs) all stay as 5b shipped them.

Also added the run badge to the README's validation note and corrected the
"no CI gating" sentence; the "no linter" half stands.

**Verification:** the workflow's own change is verified by the run it triggers
on this branch's first push — recorded below once it lands. Local gates green
before the commit (38/38 tests, 2.2m).

---

## Decisions taken

Consolidated as they are made; each one names the alternative it beat.

- **G1-a** — cache the Playwright browser; leave npm to `setup-node`'s
  lockfile-keyed cache. Beat: an explicit `node_modules` cache (≈2s saved,
  and a cache that can disagree with the lockfile).
- **G1-b** — a cache hit installs system deps separately rather than skipping
  the install step wholesale. Beat: a single guarded `--with-deps` step (a
  restored browser with no libraries to launch against).

---

## FOR-USER-REVIEW

Items needing a human — judgment calls, and things only real hardware can
answer. Consolidated in the completion summary at the end.

- **Branch protection is a repo setting, not a file.** The workflow reports;
  it does not refuse a merge. Making `typecheck · build · test` *blocking*
  requires branch protection on `main` (and, while this plan runs, on
  `claude/plan-completion`) listing it as a required status check. CLAUDE.md
  §7 already says this; noting it here because G1 is the milestone that makes
  it actionable, and nothing this session can do will enforce it.
