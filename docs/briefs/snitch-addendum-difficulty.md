**Addendum to the snitch-counter session** (`docs/briefs/snitch-prompt.md`).
Fold this into the same PR.

## Why it is in your PR and not its own

You are writing the save file's **first migration** — `SAVE_VERSION` is 1
and `MIGRATIONS` is empty. There is a second save-format question
outstanding, and doing it separately means two version bumps, two chances
to get the chain wrong, and a window in which the build writes a format
nobody will ever read again. One bump, one migration function, both
changes inside it.

The reason it is wanted **before** a TestFlight build and not after: the
plan's rule is that new persisted state arrives as a migration rather than
a wipe, and a format choice stops being free the moment real players hold
save files. Right now nobody does.

## What is actually true today (verified, head `7db094e`)

`settings.difficulty` is a persisted 0..3 integer, defaulted to 3 by
`validSettings` in `engine/save.ts`, read into `GameEngine.difficultyLevel`
at `GameEngine.ts:1164`. Since the arena-level work landed, **the arena's
own level decides the wave mix** — `arenaLevel()` (`GameEngine.ts:7239`)
returns the debug override, else the descriptor's `level`, and only falls
back to the saved index when a descriptor has none.

Three facts about the field as it stands, and together they are the
finding:

1. **No surface can set it.** The main menu's difficulty picker is gone —
   `components/UIOverlay.tsx:1802` carries the comment saying so, and
   `App.tsx:58` hardcodes the constructor argument to 3. `setDifficulty()`
   exists and nothing calls it.
2. **Its fallback is effectively inert.** Every descriptor in
   `engine/maps/MapDescriptors.ts` carries a `level` except the hub — and
   the hub runs no waves (`wavesEnabled: false`), so the fallback is
   computed there and changes nothing observable.
3. **One effect survives**: `enemyScale <= 0` still switches waves off
   (`GameEngine.ts:7291`, the legacy menu "None"), reachable today only by
   hand-editing a save or by passing 0 to the constructor.

So it is a persisted preference that nothing can express, whose fallback
does nothing, keeping one kill-switch alive by side effect.

## The decision to put to the user

**Recommend (b), but ask.**

- **(a) Keep it, document it as legacy.** Zero risk, zero work. The cost
  is a save field no surface can set and whose default silently stands in
  as a level — which is the kind of state that gets rediscovered in a year
  as a bug.
- **(b) Drop it from the save in the migration, and name the two things it
  was doing.** The level-less fallback becomes a stated constant beside
  `levelScales` rather than a preference pretending to be one; the
  waves-off switch becomes an explicit debug flag, which is all it is
  (descriptors already carry `wavesEnabled` as the real mechanism). An old
  save loses a field it could not change, so no player-visible behaviour
  moves.
- **(c) Repurpose it per arena.** Do **not** do this now. If anything
  per-arena is persisted later it belongs beside `arenaWaves`, which
  already keys by arena id, and it is the map-graph work's call — not
  something to anticipate with a field whose meaning is already unclear.

Whichever lands, say in the PR description which and why. If (a), leave a
comment in `engine/save.ts` naming all three facts above, so the next
reader does not have to re-derive them.

## Migration mechanics

Both changes go in **one** `MIGRATIONS[1]` and **one** bump of
`SAVE_VERSION` to 2:

- add the snitch catch count to `character`, defaulted to 0;
- under (b), delete `settings.difficulty` from the document.

Deleting a field is the easier half — `validSettings` already ignores
unknown keys and defaults what is missing, so a version-1 save that still
carries `difficulty` simply loses it. **The trap is the same one the main
brief names**: `GameEngine.snapshotSave()` hardcodes `version: 1`
(`GameEngine.ts:1194`). Fix that line or the migration re-runs on every
load forever.

Keep the migration a pure function over plain JSON, as the file's own
contract requires — no engine imports, no `MODULE_DEFS` lookups.

## Tests

In `tests/sim/persistence.test.ts`, beside the snitch cases:

- a hand-written **version-1 document** carrying `settings.difficulty`
  migrates to 2 and loads without error;
- under (b), the field is gone from what `serializeSave` writes, and a
  save round-trips at version 2;
- a document from a **future** version is still parked under
  `omni.save.unreadable` rather than overwritten — that rule must survive
  the first real bump, and this is the first chance to prove it does.

## Scope

Do not rebalance anything. `DIFFICULTY_SCALES` and
`DIFFICULTY_STAT_SCALES` are still read through `levelScales` by the level
curve — this is about one **saved field**, not about how hard the game is.
If removing the index tempts you to tidy the curve, note it and stop.
