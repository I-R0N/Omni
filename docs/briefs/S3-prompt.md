You are work session **S3 — "The numbers"** on the Omni engine-core phase.

## Read first, in this order

1. `docs/ENGINE_CORE_PLAN.md` §0 (how the document is used, and the
   amendment protocol you follow).
2. §4's **S3** section — your brief. Four of its open decisions are
   already settled; see below.
3. §7 rows **D30** and **D32** — D30 placed `dmath` in your session, D32
   settled the four calls that shape this prompt.
4. `CLAUDE.md` §7 for the gates.

## Branch

```
git fetch origin claude/steam-game-publishing-xhnui2
git checkout -B claude/s3-numbers origin/claude/steam-game-publishing-xhnui2
```

Branch from the integration branch, **never from `main`** — the plan doc
lives only on the integration branch, so branching from `main` would delete
the document you were just told to read.

## What is already decided (D32) — do not re-ask these

- **Format: TOML.** The decider was comments: this repo's tables carry the
  reasoning behind each number, and that commentary is a large part of their
  value.
- **First tables: `MAP_POPULATION` (126 lines) + `ENEMY_VARIANTS` (317) +
  `BOSS_DEFS` (117).** Deliberately held for a later pass:
  `SHARD_VARIANTS` (961 lines, the `grainSpecFor` seam and per-material DBG
  overrides), `WEAPONS` (30 lines because it is *computed* from
  `DELIVERY_BASE` + `COMBOS` — not data), `MODULE_DEFS`
  (`BASE_BANK_DIVISOR` pins to it).
- **Order: tables first, `dmath` second.**
- **Knob triage: only the knobs the extracted tables own.**

## PR 1 — the invisible PR: extract three tables to TOML

**Invariant: not one tuned number changes.** Extraction is a move, not an
edit. If you find a number you think is wrong, leave it and note it for the
gameplay PR.

**The load-bearing technical constraint.** `vite.config.ts` already resolves
two build-time virtual manifests (`virtual:nebula-manifest`,
`virtual:sfx-manifest`). Follow that precedent: parse the TOML **at build
time** into a typed module. Three consequences, and the second is the one
that gets forgotten:

1. The TOML parser is a **devDependency** and ships zero runtime bytes. The
   repo has 2 runtime deps and 7 dev deps — keep that discipline in mind
   when you choose one.
2. **`scripts/sim-test.mjs` hardcodes the two existing virtual ids**
   (`/^virtual:(nebula|sfx)-manifest$/`). `npm run test:sim` fails the
   moment a table becomes virtual unless you extend that shim. Check this
   before you believe a green local run.
3. `scripts/inline-build.mjs`'s single-file standalone **cannot fetch
   anything**, and works for free under this design because the data is
   already inside the module. Do not introduce a runtime fetch of a data
   file — it would break the standalone silently.

**Acceptance, as tests to write:** for each extracted table, assert the
**derived values** are equivalent to before, not the literals. `maps.spec.ts`
pins the resulting populations today — it must stay green **unchanged**.

**Knob triage, scoped and honestly small.** These three tables own
essentially one cycle (`ENEMY_SCALE_CYCLE`) plus the non-cycle
`SWARM_MOVE_MODES` ("Gnat move"). Make those calls with the user and move
on. Do **not** expand into the other 57 — they belong to the tables held
back, and the project's 59-cycle legibility problem stays open on purpose.

## PR 2 — the gameplay PR: `dmath`

Only after PR 1 has landed. The brief states four things; they are not
discoveries to make:

- It is a **behaviour change**, so it belongs here and not in the invisible
  PR. It moves every number in the last place.
- It **invalidates every existing hash once.** Say so in the PR description
  and re-baseline `tests/replay.spec.ts` **in the same commit** rather than
  leaving a red suite between two.
- **Take a `perf/` number before and after** and put it in the PR. `pow`
  sits in the collision resolver. A sim that is correct and slower is a
  trade the user gets to see.
- It does **not** block the mobile release. What it blocks is cross-device
  replay and §1/D0b's port-verification premise.

**One consequence of the tables-first order, so it is not discovered as a
red suite:** `dmath` shifts PR 1's derived-value assertions in the last
place. Write those assertions with **tolerances**, not equality, in PR 1 —
or budget the re-baseline here.

Tightening S2's parity assertion in `tests/headless.spec.ts` (Node and
Chromium currently agree on streams and the player but not the world) is a
**consequence of this landing**, not separate work.

## Decisions to put to the user, inside the session

- **D-S3-d** — does the player get more than the 4-level difficulty index?
- **D-S3-e** — balance targets as actual numbers: how long should wave 5
  take, what is a healthy run length? **Ask this at the moment you build the
  balance harness, not up front.** Without stated targets the harness has
  nothing to measure against and the balance work degenerates into taste.

## Gates, per push

typecheck + build + `npm test` (smoke) + the suites your change touches.
`npm run test:sim` too — you are touching its virtual-manifest shim. The
**full** suite waits for the user's explicit notice that a PR is ready to
merge; you do not decide that moment has arrived.

## Scope discipline

`constants.ts` is **11,359 lines** and exports ~307 functions; much of what
looks like data is load-bearing derivation. Land the three tables, make the
two knob calls, stop. This session is expected to **recur rather than
complete** — if you reach the end of PR 1 with room left, `dmath` is next,
not a fourth table.

## Protocol

Rewrite only §4's **S3** section. A decision that changes what a *later*
session should do goes in §8 for the PM session to reconcile — do not edit
another session's §4 section or the §7 log yourself.
