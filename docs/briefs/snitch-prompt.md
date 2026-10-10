You are a work session on the Omni engine-core phase. Your job is **the
snitch counter**: make it persist, make it visible, and sell a way to
knock it back down.

This is a small, self-contained gameplay change. It is not a session in
`docs/ENGINE_CORE_PLAN.md` §4 — it is one of several parallel items the
user is closing before the app phase (S4) begins.

## Read first, in this order

1. `docs/ENGINE_CORE_PLAN.md` §0 — how the document is used and the
   amendment protocol you follow. Take it from the **integration
   branch**, never from `main`: `main`'s copy is stale at D32 and is
   missing D33–D39.
2. §7 rows **D20** and **D24** — the save file's contents, and the rule
   that new persisted state arrives as a **migration**, never a wipe.
3. `CLAUDE.md` §5's `SNITCH_CONSTANTS` and `MODULE_DEFS` entries, §7 for
   the gates, and §8's **`modulePrice` is the ONE pricing seam** bullet.

## Branch and PR base (plan D37 / §5 — not optional)

```
git fetch origin claude/steam-game-publishing-xhnui2
git checkout -B claude/snitch-count origin/claude/steam-game-publishing-xhnui2
```

```
gh pr create --base claude/steam-game-publishing-xhnui2 --head claude/snitch-count
```

Every PR in this phase bases on `claude/steam-game-publishing-xhnui2`.
Branching from `main` would delete the plan document you were just told to
read. Do **not** push to any other branch, and do **not** open the PR until
the user asks for one.

## The three deliverables

1. **The snitch catch count persists** — it becomes save-file data
   instead of a per-run counter.
2. **A purchase that reduces it**, back to zero or down by a large
   amount. The user's words: *"this should be very expensive and rare."*
3. **The count is visible in the player status menu.**

## Where the counter lives today (verified, head `0da16be`)

```
engine/GameEngine.ts:590    snitchCatchCount: number = 0;
engine/GameEngine.ts:1943     this.snitchCatchCount = 0;      // resetAndLoadSelectedMap
engine/roamers/snitch.ts:110  SNITCH_CONSTANTS.WAVE_SPEED_STEP * (g.snitchCatchCount + 1),
engine/roamers/snitch.ts:235  SNITCH_CONSTANTS.WAVE_SPEED_STEP * (g.snitchCatchCount + 1),
engine/roamers/snitch.ts:247  g.snitchCatchCount++;
```

Five sites, and nothing else reads it. It is **not** on `EngineStats`
today (only `snitchCatchMode` is, for the debug panel).

## Why the three items are one change, not three

Read this before you plan, because it is the whole shape of the work.

The snitch's headline speed is `WAVE_SPEED_STEP × (catchCount + 1)` as a
fraction of player cruise — `0.05×` for the first snitch, `0.10×` after
one catch — capped at `WAVE_SPEED_MAX` (1.2×). Catching ramps it;
**deferring a catch is how the player keeps it slow.**

Persisting the count therefore does something load-bearing: the ramp stops
being a per-run pressure and becomes a **permanent** one carried by the
character. At twenty-three catches the ramp saturates at its 1.2× cap and
the snitch is, for that character, effectively uncatchable forever — with
no way back. That is exactly the pressure item 2 exists to relieve, and it
is why the purchase is not a bolt-on: **item 1 creates a one-way ratchet
and item 2 is the only release valve.** Item 3 is what makes the ratchet
legible before it bites.

So: land all three together. A PR that persists the count without the
purchase ships a permanent debuff with no counterplay.

## Item 1 — persistence

`engine/save.ts` is pure (parse / validate / migrate / serialize, no
storage access) and `SAVE_VERSION` is **1** with `MIGRATIONS` **empty** —
you are writing the first migration this file has ever had. The comment at
`save.ts:122` tells you the shape: *"The first format change adds
`MIGRATIONS[1]` and bumps SAVE_VERSION; the rest of this file does not
move."*

- **Put it in `character`, not `records`.** `records` holds lifetime bests
  that nothing reads back into the sim (`highScore`, `bestWave`, …) and are
  `max()`ed in at write time. The catch count **feeds the ramp** — it is
  live character state, like `credits` and `shipSlotsUnlocked`, and it must
  be *decreasable*, which a `max()`-folded record cannot be.
- Add the field to `CharacterSave`, `emptyCharacter()` (0),
  `validCharacter()` (`int(raw.snitchCatches, 0, 0, 1e6)` — follow the
  neighbouring fields exactly; a bad field costs that field, never the
  save), `GameEngine.applyCharacter()` and `GameEngine.snapshotSave()`.
- `MIGRATIONS[1]` defaults it to 0 and bumps `SAVE_VERSION` to 2.
  Note that `validCharacter` would default it anyway — write the migration
  regardless, because D24's rule is about the chain existing and being
  exercised, and a version bump with a missing step makes every older save
  read as `unreadable`.
- **TRAP, verified: `GameEngine.snapshotSave()` hardcodes `version: 1`**
  (`GameEngine.ts:1194`). Bump `SAVE_VERSION` without fixing that and the
  build writes files claiming version 1 while reading at 2, so every load
  re-runs `MIGRATIONS[1]` forever. Use `SAVE_VERSION` there.

**The semantic change, stated precisely:**

- `resetAndLoadSelectedMap()` (`GameEngine.ts:1943`) must **stop** zeroing
  it. A new run keeps the character (D-S2 rule: `resetAndLoadSelectedMap`
  no longer zeroes credits or the outfit either), and the catch count is
  now character state.
- `resetCharacter()` (`GameEngine.ts:1188`) zeroes it, via
  `emptyCharacter()` — which it gets for free, so **verify** rather than
  add code. That covers the replay entry (a replay must not depend on a
  save) and DBG ▸ Economy ▸ Erase save.
- Leave `snitchCatchCount` as the engine field name and map it across the
  save boundary, or rename both — your call, but do not end with two names
  for one quantity in the same file.

## Item 2 — the purchase

**Put the shape to the user before you build it.** They said "purchase
item"; there are two honest readings and they are not equivalent.

- **A station SERVICE** (the `purchaseSlot` / `repairHull` precedent) —
  a header or shop-tab action that charges credits and mutates the
  counter. Recommended: a module is a **permanent, non-consumable install
  that occupies a hex**, and `MODULE_DEFS` has no concept of a consumable,
  so modelling a one-shot counter reset as a module means inventing one.
- **A `MODULE_DEFS` item** — matches the user's word "item" literally, and
  "rare" has an obvious meaning for an item (`rewardOnly`, i.e. a boss drop
  via `grantBossModule`, never sold). It costs a cargo tile and a hex, and
  you must decide what happens to the module after it is spent.

Say which you recommend and why, and let the user choose. Whichever lands:

- **Price it through `modulePrice`.** That is the one pricing seam
  (`engine/outfitting.ts:302`); `purchaseModule`, `purchaseSlot` and
  `resaleValue` all route through it. A second path is how a discount on
  buying but not sell-back became an infinite money pump above 10%.
- **Gate it on a docked station's SERVICES**, the way every commerce method
  does (`dockedServices()`, reject while undocked). "Rare" for a *service*
  means availability — e.g. TRADE HUB only — since a service has no drop
  table.
- **Decide zero-or-reduce with the user.** "Back to zero or down by a
  large amount" is two mechanics: a full reset is a clean, expensive,
  once-in-a-while purchase; a large decrement is a repeatable money sink
  that can be priced per use. Put the question, do not pick silently.
- Mirror the gate into the UI snapshot so the button **disables and says
  why** rather than being offered and refused — `shipSlotOffer` in
  `engine/outfitting.ts` (`available` / `affordable`) is the pattern, and
  its "+1 Hex Slot" button in `components/UIOverlay.tsx:1516` is the UI
  precedent to copy.
- Play `poi.purchase` on success, as `purchaseSlot` does. Do not invent a
  new sound id — §8's rule is that a sound is one existing inventory id or
  a new row in `docs/SFX_INVENTORY.md` first.

## Item 3 — visibility

The pause menu's **Condition** block (`components/UIOverlay.tsx:1972`) is
for *the readouts that MOVE in flight rather than derive from the outfit* —
hull, shield, weight, location. The catch count fits that description and
nothing in `renderShipStatus()`'s derived-stat set does (every row there
has a module contributor behind it; the catch count has none).

Recommended: a Condition row fed by `EngineStats.playerStats`, which is
built only while a menu is up and already carries exactly that block's
fields (`types.ts:1908`). Add the field there, not to the every-frame
`vitals` payload — the HUD does not need it and the readout row is
width-bound at 390px.

Consider showing the **ramp** beside the raw count, not just the number: a
bare "7" does not tell the player the snitch is now flying at 0.40× cruise,
and the whole point of item 3 is making the ratchet legible. A derived
note in the `T_NOTE` style — the Location row's coordinate suffix is the
precedent — costs one line.

If you decide the docked station should show it too, `renderShipStatus()`
is shared **verbatim** by both surfaces, so a row added there appears in
both; a Condition row appears only in the pause menu. Say which you chose
and why.

## Tests

- `tests/sim/persistence.test.ts` — the save file, relaunch and the wreck,
  over a shared `MemoryStorage`. Add: the count round-trips; a
  **version-1 document** migrates and arrives at 0; a new run keeps it and
  `resetCharacter()` zeroes it; the purchase reduces it and is refused
  undocked / unaffordable.
- The ramp claim is worth one assertion wherever the snitch is already
  covered: catch count N spawns a snitch at the speed the formula predicts,
  and the purchase moves it back. Grep for an existing snitch suite before
  writing a new one.
- **Do not skip, disable or quarantine a test to get green.**

## Gates, per push

`npm run typecheck`, `npm run build`, `npm run test:sim` (you are changing
the save file — this is its suite), `npm test` (smoke), plus the Playwright
suites your change touches. The **full** suite (`npm run test:full`, ~32
minutes) waits for the user's explicit notice that the PR is ready to
merge; you do not decide that moment has arrived. CI runs SMOKE on every PR
push whatever the base.

## Scope discipline

Three deliverables and their tests. Do **not** rebalance
`SNITCH_CONSTANTS`, retune `WAVE_SPEED_MAX`, or touch the catch payout —
persisting the count changes how the existing numbers *feel*, and the
user will want to play it before any of them move. Note anything you think
is now mistuned; do not fix it.

## Protocol

Rewrite only your own section of `docs/ENGINE_CORE_PLAN.md` if the PM has
logged one for this item; otherwise leave the plan document alone and let
the PM record it. A decision that changes what a *later* session should do
— and "the snitch ramp is now permanent" is one — goes in **§8** for the
PM to reconcile. Do not edit §7 or another session's §4 section yourself.

Update `CLAUDE.md` where this change makes it wrong. Three places,
verified:

- **§3**, the `resetAndLoadSelectedMap()` bullet, which lists
  `snitchCatchCount` among "the per-run counters" (line 628 today) — it is
  character state after this.
- **§5**, the `SNITCH_CONSTANTS` entry: the per-catch ramp rule still
  holds, but the count now survives a run, which is the part a reader
  needs.
- **§8**, the save-file bullet's "WHAT PERSISTS" list, plus whatever the
  purchase adds to the commerce / `modulePrice` bullets.
