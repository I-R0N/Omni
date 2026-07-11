# Weapons + Ammo System Plan (completion-roadmap step 0)

Design doc of record for the weapons-ammo design session (completion
roadmap step 0, added 2026-07-08; session held 2026-07-11). Consumed by
the (h) bosses brief and the (k) portals task. Docs-only — no game code
changes in this PR.

> **Headline:** the session converged on a **pivot**, not a tuning pass.
> Ammo is removed as a system. Salvage becomes a physical drop. All
> progression (weapons + stat upgrades) becomes purchased at a station
> POI. Weapons become a 2-slot equip loadout. Wave gameplay moves into
> portal nodes. Details and scope flags below.

---

## Summary for the orchestration session

- **Ammo is deleted as a concept** — no drops, no pool, no per-shot
  costs, no ammo HUD, no dry-fallback logic. Weapon pressure comes from
  cooldown + loadout commitment instead.
- **Salvage becomes a physical collectible drop** (replacing ammo drops
  in every source: enemies, asteroids, dent shards, nebula). The
  `awardScore` 1:1 score→Salvage mirror is removed; score stays the
  performance metric, Salvage becomes collected wealth. Health drops
  remain alongside salvage drops. Rival loot-vacuum now steals money.
- **All progression is purchased.** Wave-completion upgrade cards
  (Augments) are removed, including the 18% free-unlock card lottery.
  Stat upgrades join weapons in the shop, priced on an escalating
  `upgradeCost()` curve. The Magazine augment is deleted (no ammo to
  hold). Overcharge stays a purchasable module; charged shots cost only
  charge time.
- **Weapons are equip items: exactly 2 slots.** New run = Blaster +
  empty slot. Any 2 owned weapons can be equipped — the Blaster is
  fully swappable out once the collection grows. Loadout changes happen
  **at the station only** (free re-arrangement while docked); once you
  fly out you're committed.
- **A station POI at map center** hosts the shop (Drydock UI moves out
  of the pause menu), hull repair, and loadout swaps. This is the
  in-plan placeholder for the future overworld's stations — a POI in
  the existing maps, NOT an overworld.
- **Wave gameplay moves to nodes**: portals (task (k)) lead to
  sub-layer maps where waves run. The base map stays combat-light and
  alive (roamers — snitch / rivals / bubbles — live on BOTH the base
  map and in nodes).
- **Boss-weapon reconciliation: model (d)** — bosses grant salvage
  and/or shop discounts. Weapons stay purely purchased. This is the
  gate answer the (h) brief consumes.
- **Scope flags** the orchestration session must accept/defer are in
  §8.

---

## 1. Current-state audit (as of the session, plan branch tip)

### 1.1 Weapon roster as-built

DPS assumes all projectiles connect. "Ammo/s" was sustained cost at max
fire rate under the (now-removed) shared-pool model.

| Weapon | Drydock cost | Ammo/shot (charged) | Ammo/s | Cadence | Payload | Charge effect |
|---|---|---|---|---|---|---|
| Blaster | free | 0 (0) | 0 | 7/s | 4 dmg | 5× slug (20), pierce 3, free |
| Burst Rifle | 25,000 | 2 (3) | 4.4 | 2.2 bursts/s | 3×5, pierce 2 | 5-shot burst, pierce 3 |
| Shotgun | 32,500 | 4 (6) | 6.2 | 1.5/s | 6×3 cone, pierce 1 | 12 pellets, wider cone |
| Pierce Beam (BOUNCER) | 40,000 | 6 (9) | 15 | 2.5/s | 3-beam fan, 5 dmg, pierce 99, 3 tile-bounces | 8-beam 360° nova |
| Lightning | 45,000 | 8 (12) | 16 | 2/s | 9 direct + branching chain (≤15 targets) | wider tree (≤40 nodes) |
| Seeker Missiles | 50,000 | 10 (15) | 15.4 | 1.5/s | 6 dmg, homing | 4-missile volley, weak tracking |
| Plasma Cannon | 60,000 | 12 (18) | 8.6 | 0.7/s | 18 + 110r AoE (10 + knockback) | 2× radius, 1.5× AoE dmg |

Per-ammo efficiency vs a single target ran Burst 7.5 → Shotgun 4.5 →
Lightning ~3 → Bouncer 2.5 → Cannon ~1.5 → **Seeker 0.6** dmg/ammo.

### 1.2 Ammo economy as-built (the system being removed)

- One shared pool, 200 cap (+40/Magazine level).
- Every drop carried **value 1** (`spawnAmmoDrop` hard-ignores its
  amount parameter; the `AMMO_PER_*` tunables in `DROP_CONFIG` are dead
  knobs). Drops merged value-conservingly, drifted on the flow field.
- Income: enemy kill ≈ 0.8 expected ammo; asteroid 45%; dent shards
  85%; plastic sub-shards 20%. A 10-enemy wave paid ~8 ammo — less
  than one Cannon shot (12). **Terrain mining was the real ammo
  faucet**; combat income alone could not sustain any heavy weapon.
  This was never telegraphed and read as accretion, not intent.
- Firing dry auto-fell back to Blaster; selecting an unaffordable
  weapon was a no-op.

### 1.3 Acquisition as-built

Salvage mirrored score 1:1. Estimated score arc put the first Drydock
purchase (Burst, 25k) around wave 8–11 — while the every-wave card
offer carried an 18% chance of a **free** unlock (`UNLOCK_CARD_CHANCE`),
cumulatively a coin-flip by ~wave 4. In practice the card lottery beat
the shop to the first weapon; Salvage spent the early run buying
nothing. Acquisition was lottery-shaped, not decision-shaped.

### 1.4 Code-vs-docs discrepancies found

1. `upgradeCost()` (CLAUDE.md §5) does not exist — unlock pricing is
   flat `cost` fields on `UNLOCK_DEFS`. (The pivot makes the curve
   function real; see §5.)
2. `ENEMY_AMMO_DROP` / `ASTEROID_AMMO_PROGRESSION` (CLAUDE.md §5) do
   not exist in `constants.ts` — superseded by `DROP_CONFIG` chances +
   the value-1 model.
3. Player-facing naming split: HUD says **"Pierce Beam"**, the Drydock
   sells **"Bouncer / Ricochet beams"** — same weapon, two names.
4. "Enemies fire weapon archetypes" is loose: enemies fire bespoke
   `Partial<WeaponConfig>` overrides on a private `ENEMY_WEAPON`, not
   `WEAPONS` entries. The Turret (homing) is the only real overlap.
5. Trivial: `mergeAmmoDrops` doc-comment says the drop cap is 64; the
   constant is 100.

### 1.5 Problems that motivated the pivot

1. Seeker Missiles strictly bad (worst damage/shot AND second-highest
   cost) — weakest identity.
2. Free charged Blaster (`chargedAmmoCost: 0`) + Overcharge = infinite
   anti-armor slugs, deflating both the ammo economy and the armor
   trait.
3. Lottery-shaped acquisition; no engineered first-purchase moment.
4. The implicit "mine terrain for ammo" model was undocumented and
   accidental-looking.
5. Niche collisions: Burst ≈ "Blaster but better"; Bouncer vs
   Lightning overlap as crowd tools.

---

## 2. The settled design

### 2.1 Ammo: removed entirely

No ammo drops, pool, per-shot costs, HUD readout, select-gating, or
dry-fallback. Weapon pressure = **cooldown + 2-slot loadout
commitment**. Consequences accepted in-session:

- The balance axis moves to cooldown/damage/behavior (§3 tuning).
  Bouncer and Lightning were leaning on ammo cost as their downside
  and need real ones.
- The **Magazine** augment is deleted. **Autoloader** becomes the
  premium weapon stat; its purchase-price curve should be the steepest.
- The 8-cell ammo HUD strip becomes a 2-slot loadout HUD (+ charge
  ring).

### 2.2 Weapons: 2-slot equip loadout

- Exactly **2 equip slots**. New run: slot 1 = Blaster, slot 2 = empty.
- Any 2 **owned** weapons may be equipped; the **Blaster is fully
  swappable** out once you own 2+ others (starter sidearm growing
  obsolete is an intended progression beat).
- Loadout changes are **station-only**: free re-arrangement while
  docked; committed once you undock. This is what makes trait
  counterplay a provisioning decision (strategy guardrail #2: pattern
  recognition — "this node runs armored enemies, bring the Cannon").
- Weapon cycling/HUD collapses from 7 slots to 2.

### 2.3 Economy: salvage drops + purchase-only progression

- **Salvage becomes a physical drop** replacing ammo in every source
  (enemy kills, asteroids, dent shards, nebula rolls). One
  `DROP_TYPES` registry row + effect + render; the existing
  magnet/merge/flow-drift machinery is type-agnostic and reused as-is.
  Kills you don't collect are income lost; rival loot-vacuum steals
  money — real loot denial.
- **Score decouples from Salvage.** The `awardScore` 1:1 mirror is
  removed. Score = performance (kills, combo, snitch, early-clear);
  Salvage = collected wealth.
- **Health drops remain** alongside salvage drops (same sources and
  behavior as today). Shield stays a purchasable module; hull repair
  is also available at the station.
- **Upgrade cards (Augments) are removed** — no more free per-wave
  levels, no free-unlock lottery. Stat upgrades join the shop, priced
  per level on an escalating curve (§5). The `requires`
  card-eligibility machinery dies with the cards (shop ordering
  replaces it).
- **Overcharge** stays a purchasable module. Charged shots cost only
  charge time (1.0s hold) — no resource cost by design.

### 2.4 Station POI + nodes structure

- A **space station POI at the center of each map** hosts: the shop
  (weapons + stat upgrades + modules), hull repair, health/loadout
  services, and loadout swaps. The **Drydock UI moves out of the pause
  menu** to the station. (Future state: stations sit at the center of
  overworld areas — the map-center placement is the in-plan stand-in.)
- **Wave gameplay moves to nodes**: portal entities on the base map
  (task (k), map-descriptor layer) lead to sub-layer maps where waves
  run. The base map becomes a combat-light living space.
- **Roamers live on both layers**: snitch, rivals, and ambient bubbles
  populate the base map AND nodes.

---

## 3. Weapon identity plan (post-ammo job statements + tuning increments)

Small tuning increments only — no redesigns. All numbers indicative,
final values at implementation.

| Weapon | Job statement | Niche/gap fix (increment) |
|---|---|---|
| **Blaster** | Reliable single-target chip; the starter all-rounder you eventually outgrow | None. Charged slug (via Overcharge) stays its anti-armor answer. |
| **Burst Rifle** | Mid-range precision pressure — highest sustained single-target DPS; pierce-2 rewards lining up shots | Lean into range: it keeps speed 20 / lifetime 3.0 vs Blaster's 16 / 1.5. Watch that it doesn't stay "Blaster but better" at close range — if needed, nudge cooldown 0.45 → 0.5. |
| **Shotgun** | Close-range burst commit — front-loaded damage, punishes whiffs via cooldown | Identity already clear. No change beyond global rebalance. |
| **Pierce Beam / Bouncer** | Crowd rake + terrain ricochet control — line damage through packs, bounces work corridors | Was balanced by 15 ammo/s; needs a real downside now: reduce per-beam damage 5 → 4 or cooldown 0.40 → 0.55. **Unify the player-facing name** (pick one of Pierce Beam / Bouncer everywhere). |
| **Lightning** | Cluster deleter — burst AoE that punishes clumping; weak vs a single spread-out target | Cooldown 0.50 → 0.65 to compensate for free ammo; chain falloff already limits single-target value. |
| **Seeker Missiles** | Fire-and-forget utility — guaranteed hits on evasive/fast targets while you fly | With the 0.6-dmg/ammo tax gone it's finally playable; bump damage 6 → 8 so "can't miss" isn't "can't kill". Becomes the designated anti-**evasive** answer (§6). |
| **Plasma Cannon** | Heavy artillery — the armor-breaker and pack-opener; slowest, biggest commitment | Cooldown 1.4s is its brake; fine as-is. Watch Overcharge+Cannon (2× radius) with no resource cost — if oppressive, raise charged cooldown, not a resource. |

---

## 4. Economy plan (pressure curve across a run)

The run arc under the new model:

1. **Early**: Blaster-only, poor. Fight nearby nodes, collect salvage +
   health drops, learn the station loop.
2. **First purchase** (engineered moment): first or second station
   visit — see pricing (§5). Fills slot 2; first real loadout.
3. **Mid**: choose loadouts per node (counterplay provisioning);
   income scales with node difficulty; stat levels start competing
   with the next weapon for salvage.
4. **Late**: full collection; the decision space is entirely "which 2
   for this node" + which stat curve to climb. Bosses (h) pay
   salvage bursts / discounts (§6).

Pressure knobs: drop rates per source (reuse today's ammo-roll chances
as the salvage-roll starting point), drop despawn lifetime (20s —
collect-or-lose), rival vacuum, and prices. Cooldowns are the only
in-combat brake; scarcity now lives at the shop, not in the field.

---

## 5. Acquisition + pricing plan

Absolute numbers are an implementation-time tuning task (income scale
changes when score no longer mirrors into Salvage). Targets in relative
terms:

- **First weapon ≈ 1–2 nodes of typical salvage income** — the
  engineered "first unlock" moment lands on the first or second
  station visit, not wave 8–11.
- Weapon price ladder keeps today's ordering (Burst cheapest → Cannon
  dearest) at whatever absolute scale matches drop income; ~2.5×
  spread first-to-last is about right.
- **Stat upgrades**: per-level escalating `upgradeCost(id, level)`
  (the function CLAUDE.md already names — make it real). Geometric
  ~1.4–1.6× per level; **Autoloader steepest** (it's the premium
  weapon stat post-ammo). Hull/Plating cheapest (defensive comfort).
- **Modules**: Shield mid-priced (it's the health-regen layer in the
  field), Overcharge premium.
- Recommended intended purchase order for a typical run: first weapon
  → Shield → a stat level or two → second weapon → Overcharge → depth.

---

## 6. Boss-weapon reconciliation — **model (d), settled**

**Bosses grant salvage and/or shop discounts. Weapons stay purely
purchased.** (Chosen over (a) grant-module-free, (b)
conquest-gated purchasability, (c) unique boss variants.)

Run-arc consequence: weapon acquisition timing is governed entirely by
the pricing curve (§5); bosses are **income accelerators** — beating a
weapon-boss node funds (or discounts) your next purchase rather than
skipping the shop. The (h) brief consumes this as: bosses are
high-payout node capstones with **no unlock plumbing** (no changes to
`UNLOCK_DEFS`, no grant path, no per-boss weapon flags).

**Enemy-side weapon parity (recommendation, uncontested):** a
weapon-boss should *wield* a themed variant of the literal player
archetype — same projectile look/behavior family from the player's
`WEAPONS` entry, enemy-tuned numbers via the existing
`Partial<WeaponConfig>` override pattern (the Turret already does
exactly this with homing). Readable telegraphs ("that's MY shotgun")
without a parallel weapon table.

---

## 7. Trait-counterplay map (weapon × trait)

Traits: `armor` shipped (Tank; hits below chipThreshold reduced 70%);
evasive / front-shield / regen arrive with (h). Field conditions
(swarm crowds, shielded Bulwark) included so every weapon appears as a
"right answer" at least once — the property that makes owning the
roster matter under 2-slot provisioning.

| Weapon | armor (chip-resist) | evasive (dodges line shots) | front-shield (directional) | regen (burst-check) | crowds / swarm | stationary high-HP (Turret/Nest) |
|---|---|---|---|---|---|---|
| Blaster | ✦ charged slug only | — | — | — | — | ok (free chip) |
| Burst Rifle | — (5 < 6) | — | — | — | — | **✓ best sustained DPS** |
| Shotgun | — (3/pellet) | **✓ cone forgives juking** | — | **✓ front-loaded burst** | ✓ close packs | — |
| Pierce Beam | — (4–5/beam) | — | **✓ ricochets hit the back side** | — | **✓ line rake** | ✓ pierce lines |
| Lightning | ✓ direct 9 ≥ 6 | ✓ chains don't miss | ✓ chains ignore facing | — | **✓ cluster deleter** | — |
| Seeker | ✓ 8 ≥ 6 (post-buff) | **✓ the designated answer** | — | — | — | ✓ fire-and-forget |
| Cannon | **✓ the designated answer** | — | ✓ AoE splashes past | **✓ 28 burst** | ✓ pack-opener | ✓ |

(h) should assign the new traits so the table stays honest: give the
evasive enemy real dodge behavior vs straight projectiles, make the
front-shield entity punish face-tanking (the Bulwark arc-shield already
prototypes this), and tune regen thresholds against Shotgun/Cannon
burst windows.

---

## 8. Implementation increments (single-session tasks)

Ordered; each is small and independently landable. **Bold flags =
scope growth beyond the original feedback plan — orchestration session
must accept/defer explicitly.**

1. **salvage-drops** — add `'salvage'` to `DropType`/`DROP_TYPES` +
   effect + render; swap every ammo-roll site to salvage; remove the
   `awardScore` 1:1 Salvage mirror. Health drops untouched. Small.
2. **ammo-removal + loadout-2** — delete the ammo system (pool, costs,
   HUD strip, gating, dry-fallback, Magazine augment); add the 2-slot
   equip model (`equippedWeapons: [WeaponType, WeaponType?]`); HUD
   becomes 2 slots + charge ring. Interim: loadout swap lives in the
   pause-menu Drydock until the station ships. Medium.
3. **purchase-only-progression** — remove upgrade cards + free-unlock
   lottery; add stat-upgrade purchases with a real `upgradeCost()`
   curve; keep a wave/node-clear salvage bonus as the reward beat.
   Small-medium.
4. **weapon-identity-tuning** — §3 increments + Pierce Beam/Bouncer
   naming unification. Small.
5. **station-poi** — **[scope flag]** station entity at map center,
   dock interaction, shop UI relocation from pause menu, hull repair +
   station-only loadout swap. Medium.
6. **waves-to-nodes** — **[scope flag]** extends (k): portal nodes
   host wave gameplay; base map goes combat-light; roamers maintained
   on both layers. Lands WITH or after (k); the map-descriptor layer
   is unchanged in design. Medium, mostly re-plumbing WaveSystem
   activation.
7. **(h) bosses** — consumes §6/§7: bosses as node capstones paying
   salvage/discounts; weapon-archetype-themed boss weapons; new traits
   wired to the counterplay table. (Already a roadmap item; this doc
   just feeds it.)

Rebalance note for 2: with ammo gone, Bouncer/Lightning cooldown
adjustments (§3) should land in the same PR as ammo removal so the
field never sees free-ammo-at-old-cadence.

---

## 9. Open questions

1. **Absolute prices + drop-income scale** — deferred to
   implementation tuning (income model changes shape when the score
   mirror is removed).
2. **Death penalty for Salvage** — keep it all, lose a fraction, or
   lose uncollected field drops only? Not discussed; affects how
   punishing the purchase economy feels.
3. **Interim base-map state** — until waves-to-nodes lands, do waves
   keep running on the base map as today? (Assumed yes; confirm at
   sequencing time.)
4. **Overcharge+Cannon ceiling** — charged shots now cost only time;
   if 2×-radius free AoE proves oppressive, the lever is charged
   cooldown (never a resource cost). Watch in playtest.
5. **Snitch payout** — snitch currently pays score (1,500) which no
   longer auto-mints Salvage; does it also spray salvage drops? (Leans
   yes — it's the biggest chase reward.)

## 10. Out of scope (discussed and excluded)

- **The overworld itself** — multiple stations, NPC traffic, hub-map
  generation, travel. The station POI + nodes are in-plan stand-ins;
  the map-descriptor layer stays the only overworld extension point
  (strategy guardrail #3).
- **Ammo as a station-purchased provision** — considered as a finite
  "expedition budget" model; dropped in favor of full ammo removal.
- **Boss weapon-unlock models (a)/(b)/(c)** — grant-free,
  conquest-gated purchasability, and unique boss variants all
  considered; (d) chosen.
- **Blaster as a locked always-on sidearm** — considered; rejected in
  favor of a fully swappable 2-slot loadout.
- **Crafting / inventory systems** — forbidden by
  `docs/GAME_STRUCTURE_STRATEGY.md`; nothing here introduces any.
