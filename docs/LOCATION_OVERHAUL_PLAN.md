# Location / Multiplayer / App Store — Overhaul Plan

High-level orchestration plan for the **next major overhaul** after the
game-feedback overhaul ships. Where `GAME_FEEDBACK_PLAN.md` is content/polish,
this overhaul is a **product pivot**: GPS-seeded procedural maps, a
hub-and-spoke world, a ship-building RPG, persistence + accounts, an App Store
(+ Android) release, and finally co-op multiplayer.

> **Detail lives elsewhere.** The *why/feasibility/architecture* is in
> `docs/LOCATION_MULTIPLAYER_FEASIBILITY.md` (pillars, netcode model, cost,
> risks). **This file is the execution roadmap** — tracks, phases, sequencing,
> and the operational/App-Store framework. Cross-references like "(feas §9)"
> point at that doc.

> **Status: NOT STARTED — gated.** This overhaul begins only **after the
> game-feedback overhaul (`claude/game-feedback-plan-UN3MV`) merges to
> `main`.** It builds directly on feedback Phase 2 task `k` (portal entity +
> `loadMap` lifecycle), so that work should land first.

---

## How this works

Same orchestration model as the feedback plan, with one structural addition:
this overhaul runs **two parallel tracks** —

- **Track E — Engineering** (client + backend code). Phased, mostly
  sequential, mirrors the feedback-plan integration-branch model.
- **Track O — Operations / App Store** (Apple Developer Program, App Store
  Connect, IAP, privacy/compliance, review, store release). Non-code work
  that runs **alongside** engineering and gates the public release, not the
  build.

The two tracks have cross-dependencies (e.g. you cannot TestFlight without the
Developer account; you cannot submit without a privacy policy + live backend).
Those gates are called out per milestone.

### Branch strategy

- New long-lived integration branch off `main` (post-feedback-merge):
  `claude/location-overhaul-<suffix>`. Client task sessions branch off its
  tip and PR back into it, never directly to `main` (same Netlify-deploy
  discipline as the feedback plan).
- **Exception — the backend is a separate deployable.** Unlike the feedback
  plan (one final PR → one Netlify deploy), this overhaul introduces a
  backend service and a native app binary that do **not** ship through the
  Netlify pipeline. Track E's backend/app work has its own deploy targets
  (BaaS project, App Store Connect). The integration branch covers the
  *client/engine* changes; backend + binary are released on their own cadence.
- Because the scope spans months, expect **multiple PRs to `main`** over the
  life of the overhaul (per shippable phase), not a single ship-it PR.

### Phase rules

- Track E phases are mostly sequential — each builds on the prior (seed →
  persistence → world structure → RPG → input → multiplayer).
- E2 (world structure) and E3 (RPG) share the entity/map surface heavily →
  sequential.
- E4 (touch input) and most of Track O can run in parallel with E2/E3.
- E5 (multiplayer) is last and depends on E2's hub/instance split existing.

---

## Track E — Engineering

| Phase | Title | Depends on | Feas ref | Size | Status |
|---|---|---|---|---|---|
| **E0** | Seeded generation + geolocation | feedback → main | feas §4.1, §6 P0 | M | pending |
| **E1** | Backend + accounts + persistence | E0 | feas §4.4, §5, §6 P1 | M-H | pending |
| **E2** | Gameplay reconfig: hub-and-spoke world | E1, feedback `k` | feas §10 | M-H | pending |
| **E3** | Ship-building RPG + salvage economy | E2 | feas §4.5–4.6 + ship turns | M-H | pending |
| **E4** | Mobile / touch input | (parallelizable) | feas §4.2, §6 P4 | M | pending |
| **E5** | Real-time co-op multiplayer | E2, E4 | feas §9 | H | pending |

**E0 — Seeded generation + geolocation.** Replace map-gen `Math.random()`
(~29 sites) with a seeded PRNG threaded through `TileGenerator`/`MapClasses`;
add H3 location→seed; add Geolocation. Deterministic, offline-provable, no
backend. *Foundation for everything — establishes the determinism boundary.*

**E1 — Backend + accounts + persistence.** Stand up the BaaS (Supabase
recommended); anonymous-first auth with Google + **Sign in with Apple** as
link/upgrade (Apple required once Google ships on iOS — see O3). Persist
*deltas* (cell discovery, POI snapshots, profiles), not maps. First net-new
infra + ops.

**E2 — Gameplay reconfiguration (the big one).** Hub-and-spoke world (feas
§10): GPS-anchored **hub maps** (safe, sparse, market + refit + portals),
**travel portals** (H3 neighbours) and **run portals** (instanced gameplay
maps), and the **game-mode** layer (waves/maze/capture/assassinate/explore).
Builds on feedback `k`'s portal + `loadMap` work. The existing maps become
biome templates. This is the largest single-player gameplay change.

**E3 — Ship-building RPG + salvage economy.** Hull + module fitting,
attributes + scaling, mass/equip-load tradeoff, find/build/buy acquisition,
infusions; salvage as the unified currency. Mostly a stat-aggregation layer
(`recomputeShipStats`) + fitting UI over existing fields; new bits are
attributes, scaling, status effects, leveling/fitting UI.

**E4 — Mobile / touch input.** Virtual stick + fire/ability buttons replacing
keyboard/mouse `InputSystem`. Promoted to mid-overhaul because App Store is
the target. Can overlap E2/E3. (Note: feedback Phase 3 `c2` already adds an
on-screen joystick + controller support — **reuse/extend that**, don't
rebuild.)

**E5 — Real-time co-op.** Host-authoritative state-sync over WebRTC (feas
§9). Seed-deterministic maps mean only the dynamic layer + destruction events
sync. Milestones M1 (2-player invite) → M2 (4-player + location matchmaking)
→ M3 (persistence write-back). Dedicated servers / PvP deferred to a later
arc.

---

## Track O — Operations / App Store

Runs alongside Track E. Milestones are gated, not strictly time-ordered.

| ID | Milestone | Gate / depends on | Cost | Status |
|---|---|---|---|---|
| **O1** | Apple Developer Program enrollment | decide entity type first | $99/yr | pending |
| **O2** | Capacitor iOS shell + native plugins | E0 (a runnable web build) | — | pending |
| **O3** | Auth providers wired (Apple + Google) | E1, O1 | $0 | pending |
| **O4** | Privacy, compliance & UGC moderation | E1 (data model known) | legal time | pending |
| **O5** | IAP / monetization (StoreKit) | E3 (what's for sale) | 15–30% rev | pending |
| **O6** | TestFlight beta | O1, O2, runnable game | $0 | pending |
| **O7** | App Review submission + release | O3, O4, O5, O6 | — | pending |
| **O8** | Google Play parallel release | O2 (Capacitor → Android) | $25 once | pending |

**O1 — Apple Developer Program.** $99/yr. **Decision gate:** enroll as an
*individual* (fast, name shows as your legal name) or an *organization*
(needs a D-U-N-S number + legal entity/LLC, shows a company name, better for
liability and IAP banking). Org enrollment takes longer — start early if
chosen.

**O2 — Capacitor iOS shell.** Wrap the existing TS/Canvas2D build in a
Capacitor WKWebView project; add native plugins for Geolocation (CoreLocation),
Push, IAP (StoreKit), Sign in with Apple. **No native rewrite** (feas §
platform turn). One project also yields the Android build (→ O8).

**O3 — Auth providers.** Configure Google OAuth + Sign in with Apple in the
BaaS and the Apple/Google consoles. Apple Guideline 4.8 **requires** Sign in
with Apple once Google login ships on iOS.

**O4 — Privacy, compliance & UGC moderation.** Privacy policy URL (required
for submission), App Privacy "nutrition labels," location purpose strings,
GDPR data-handling for the BaaS (coarsen location to H3 cell; minimize
retention), and a **UGC moderation** story for anything players name/place
(Apple Guideline 1.2). Location + UGC + accounts all draw extra review
scrutiny — budget for it.

**O5 — IAP / monetization.** **Decision gate:** monetization model (cosmetics?
salvage boosts? premium currency?). Whatever sells must use StoreKit IAP
(Apple takes 15–30%). Define products, sandbox-test, wire to the profile.

**O6 — TestFlight.** Beta-distribute to playtesters before submission — the
real-device validation the feedback plan keeps deferring becomes first-class
here.

**O7 — App Review + release.** Metadata, screenshots, age rating, review
notes. Expect iteration on the first submission (location/UGC/IAP scrutiny).

**O8 — Google Play (parallel).** Capacitor's Android output → Play Console
($25 one-time). Lower review friction than Apple; can ship sooner or in
parallel.

---

## Suggested sequencing

```
feedback plan → main   (prerequisite; esp. task k portals)
        │
        ▼
  E0  seeded gen ──► E1 backend ──► E2 hub world ──► E3 ship RPG ──► E5 co-op
        │                                  ▲
        ├── O1 dev account (start early)   │
        ├── O2 Capacitor shell ────────────┤ (E4 touch can fold in c2 here)
        │        │                         │
        │        └── O6 TestFlight ◄────────┘
        ├── O3 auth (needs E1)
        ├── O4 privacy/UGC (needs E1)
        ├── O5 IAP (needs E3)
        └────────────────► O7 submit ──► O8 Play
```

Public soft-launch is feasible after **E2 + O7** (a playable single-player
location game on the store); E3/E5 are post-launch content/feature drops.

---

## Decisions log

_(Seeded from the design session that produced the feasibility doc. Append as
the overhaul progresses.)_

1. **Gated behind the feedback overhaul.** Work starts only after
   `claude/game-feedback-plan-UN3MV` → `main`. Builds on feedback task `k`
   (portals).
2. **Location = seed/identity, not terrain.** H3 cell → PRNG seed; no
   sphere→torus projection. Torus wrap retained (load-bearing). (feas §4.1)
3. **Persist deltas, not maps.** Deterministic gen means clients regenerate
   geometry; storage = discovery + POI snapshots + mutations + profiles.
   (feas §4.4)
4. **Hub-and-spoke world.** Persistent GPS hubs (safe, market, portals) +
   ephemeral per-run gameplay maps with game modes. Built before multiplayer
   because the hub/instance split *is* the netcode boundary. (feas §10)
5. **Platform: Capacitor wrapper, not native rewrite.** One TS codebase →
   iOS + Android. (feas platform turn)
6. **Multiplayer = host-authoritative state-sync over WebRTC**, not lockstep
   (mixed devices/Internet make determinism fragile); deferred to last.
   (feas §9)
7. **Auth: anonymous-first, Apple + Google as upgrade.** Apple required by
   Guideline 4.8 once Google ships on iOS. (feas auth turns)
8. **Reuse feedback `c2` for touch/controller input** rather than rebuilding
   in E4.

---

## Open questions

_(Resolve before the relevant phase starts.)_

- **O1 — entity type:** individual vs organization (LLC + D-U-N-S) Apple
  enrollment? Affects branding, liability, IAP banking, and timeline.
- **O5 — monetization model:** cosmetics only / salvage boosts / premium
  currency / none at launch?
- **E2 — run-portal selection:** fixed curated menu vs rotating roguelite
  "offers"?
- **E2 — hub combat:** strictly zero enemies vs light ambient threat?
- **E3 — economy shape:** single salvage currency vs salvage (currency) +
  materials (crafting) two-tier?
- **E5 — co-op vs PvP:** co-op only (P2P host-authoritative) or eventual PvP
  (forces dedicated servers + heavier anti-cheat)?
- **BaaS choice:** Supabase (Postgres/RLS, recommended) vs Firebase vs
  self-hosted?
