# Omni — Audio Plan

Direction, cue inventory and architecture notes for Phase 3 Pair B (a) "SFX
system".  **Nothing here is implemented.**  The game currently has ZERO
audio: no `AudioContext`, no audio assets in `public/assets/`, no audio
system, no trigger hooks.

> **Relationship to `docs/SFX_INVENTORY.md`.**  This file was written in the
> Pair A session, independently and before plan decision #43 made
> `SFX_INVENTORY.md` the Pair B deliverable.  The two overlap: §4 below and
> that inventory cover the same cues, and **SFX_INVENTORY is the one that
> ships** — it carries the per-effect generation parameters (trigger,
> character, duration, envelope, variation, throttle, mix, positional) that
> #43 asks for, which §4 does not.  Read this file for what it adds on top:
> §2's hard constraints (the standalone-build fork, the TORUS vs
> `PannerNode`, polyphony, iOS unlock, the fixed-timestep/audio-clock split),
> §3's bus + music-director architecture, §5's music beds, and §6's open
> decisions.  §2a and §2b in particular are correctness requirements, not
> preferences.

---

## 1. Direction (user, 2026-08-08)

- **Sampled**, not synthesised.
- **Adaptive background music** that responds to environment, enemies, bosses
  and menus.
- **Spatial / positional** sound.
- Quality target: **AAA**.

That is a materially bigger scope than "add some SFX", and it lands on three
existing systems (the torus, the perf controller, the standalone build) in
ways worth deciding before any asset is authored.

---

## 2. Hard constraints this collides with

### 2a. The single-file standalone build

`scripts/inline-build.mjs` inlines every referenced asset as a base64 data
URI.  The current output is **5.6 MB** with images only, and base64 inflates
by ~33%.  A sampled AAA soundscape — ~90 cues with variation layers, plus
music stems — is realistically **30–150 MB** of source audio.  Inlined, that
is a single HTML file no browser should be asked to parse, and the
`publish-standalone` workflow ships exactly that file.

**This is a real fork, not a detail.**  Options:

1. **Audio stays external** (fetched from `public/assets/audio/`), and the
   standalone build ships SILENT or with a tiny "essential cues only"
   subset.  Keeps the portable build portable; means the standalone is no
   longer a faithful copy of the game.
2. **Two builds diverge**: web/deployed gets full audio, standalone stays
   images-only.  Same as (1) but stated as policy rather than a caveat.
3. **Drop or de-scope the standalone build.**  It exists for portability
   (open one file on a phone); AAA audio and that goal are close to mutually
   exclusive.

No option is free.  (1) or (2) is the obvious default, but it should be an
explicit decision because the standalone build has its own release workflow.

### 2b. The world is a TORUS

Web Audio's `PannerNode` assumes Euclidean space.  Feeding it raw world
coordinates is **wrong at the seam**: a source at x=50 with the listener at
x=MAP_WIDTH-50 is 100 units away, not a map-width away, and would pan to the
wrong side and attenuate to silence.

Every spatial position must be the **wrapped delta** relative to the
listener (`wrapDeltaX` / `wrapDeltaY` from `engine/toroidal.ts`), then handed
to the panner as a listener-relative offset with the listener parked at the
origin.  This is the same invariant CLAUDE.md §8 states for every distance
check; audio is not an exception.

### 2c. Polyphony — this game emits a LOT of events

A single frame can shatter a dozen shards, pop a swarm of gnats, and land
twenty projectile hits.  One `AudioBufferSourceNode` per event is thousands
of voices and a stalled main thread.

Needs, in the same spirit as `PerfController`:
- A **voice pool** with a hard cap and FIFO/priority eviction (the
  `enforceCap` pattern already exists for particles and projectiles).
- **Distance culling** — beyond an audible radius, don't allocate a voice at
  all.
- **Same-step coalescing** — N identical cues in one sim step become one
  voice with a level bump, not N voices.  Shard shatters and gnat pops are
  the obvious cases.
- **Per-cue cooldowns** so a rapid-fire weapon doesn't retrigger a full
  sample 20×/second.

### 2d. Mobile / iOS

The game is played on an iPhone.  `AudioContext` starts suspended and needs a
**user gesture** to resume — the main-menu START tap is the natural unlock
point.  Memory and decode cost on mobile Safari also argue for streaming
music rather than fully decoding every stem up front.

### 2e. Fixed timestep vs the audio clock

The sim is fixed-timestep with an accumulator; a single rAF frame can run
several sim steps.  Cues should be **triggered** from the sim but
**scheduled** on the `AudioContext` clock, so a multi-step frame doesn't
machine-gun sounds that should be simultaneous.

---

## 3. Architecture sketch

A new `engine/systems/AudioSystem.ts`, owned by `GameEngine` like every other
system.

**Not via `EngineStats`.** That channel is per-frame React data (CLAUDE.md
§8: "pipe everything through EngineStats") — correct for UI, wrong for audio,
which is engine-side and needs sub-frame timing.  Cues fire directly from the
paths that already exist: `handleEntityDeath`, the PhysicsSystem damage
callbacks, `WeaponSystem`, `ShardSystem`, `transitionToMap`, `dockAtStation`.
UI cues (menu taps, panel opens) are the exception and can come from React.

**Bus structure** (so one volume slider per group, and ducking is possible):

```
master ─┬─ music      (stems, streamed)
        ├─ sfx        (spatialised, voice-pooled)
        ├─ ui         (non-spatial, always centred)
        └─ ambience   (looping beds, spatial or centred)
```

Ducking music/ambience under a boss death or a stage-clear sting is standard
AAA practice and falls out of this shape.

**Music director** — vertical layering (stems mixed in/out) plus horizontal
re-sequencing (transition at musical boundaries, not instantly).  The state
that drives it already exists:

| Driver | Source today |
|---|---|
| Menu / paused / playing | `gameState` |
| Hub vs arena | `MAP_DESCRIPTORS.kind`, `wavesEnabled` |
| Wave active vs grace | `waveStatus`, `waveGraceTimer` |
| Threat level | live enemy count / `enemiesRemaining` |
| Boss fight + phase | `EngineStats.boss` (`phase`, `healthFrac`) |
| Stage cleared | `stageClearPending` |
| Death | `deathPending` |
| Docked | `dockedAtStation` |
| Region identity | the per-area material composition in PARKING_LOT |

The last row is the interesting one: the parked "area composition + map graph"
design gives regions a material identity, and **regional music beds are the
natural audio expression of that** — a glass region and a metal belt should
not sound alike.  Worth building the music director so a bed is a property of
the area node, not of the MapType.

---

## 4. Cue inventory

~90 distinct cues.  Many share a base sample with pitch/filter variation —
the material families and enemy tiers especially.  `[var]` marks cues that
want 3–5 round-robin variants to avoid machine-gun repetition.

### Player weapons
| Cue | Notes |
|---|---|
| Blaster fire `[var]` | highest-frequency cue in the game; needs cooldown + variants |
| Burst fire | 3-shot pattern, one cue not three |
| Shotgun fire `[var]` | |
| Laser fire | piercing/ricochet character |
| Lightning fire | |
| Homing fire | |
| Cannon fire | heaviest report |
| Charge loop | rising, loops while held |
| Charged release | per-weapon tail, or one shared "overcharge" |
| Dry / no gun mounted | weaponless flight is legal |

### Player ship
Thrust loop (speed-modulated) · shield absorb `[var]` · shield break · shield
recharged · hull hit `[var]` · terrain crash `[var]` · death explosion ·
respawn · weapon-slot cycle.

### Status effects
Corrosion apply · corrosion tick (loop) · EMP/disable apply · systems restored.

### Projectiles & impacts
Bolt→hull `[var]` · bolt→shield · laser ricochet `[var]` · lightning
arc/chain · cannon splash · homing lock-on · arc-shield deflect · projectile
expire (quiet, likely cullable).

### Materials — per variant: impact `[var]`, shatter `[var]`, regen pop
Glass · plastic · metal · rock · nebula · indestructible (a dead clang that
says *don't bother*).  Plus shard→tile snap, metal composite assembly, and
merge.

### Enemies
Generic spawn warp-in · generic death `[var]` · Shooter fire (tiers 1–3) ·
Bulwark 3-shot fan · Turret missile lob · rammer charge · Kamikaze arm +
detonate · Swarm gnat pop `[var]` · Nest brood birth · Bubble latch / EMP
crackle / split / pop · Dragon roar / eat / segment sever / portal · Rival
warp-in / warp-out / loot steal.

### Bosses
Entrance rift · phase transition (×3) · shield break · death · stage-clear
sting.

### Economy / pickups
Salvage pickup `[var]` · health pickup · drop merge · purchase · sell · scrap
· hull repair · insufficient funds.

### World / navigation
Portal idle hum (spatial loop) · portal transit · descent-rift open · station
dock · undock · snitch dart · snitch catch.

### Waves / UI
Wave start · wave cleared · grace countdown · milestone · combo tier-up ·
combo break · menu tap · panel open/close · drag pickup / drop · death-screen
sting.

---

## 5. Music beds

Minimum viable set, given the states above:

1. **Main menu**
2. **Hub / Overworld** — calm, no threat
3. **Docked at a station** — interior, filtered
4. **Arena exploration** — between waves
5. **Arena combat** — layered by threat level (2–3 intensity stems)
6. **Boss fight** — with a per-phase stem so a phase change is audible
7. **Stage cleared** — resolution sting into a calm bed
8. **Death** — one-shot sting into silence or menu

Regional variants of (4)/(5) are where the "different parts of the galaxy"
feel comes from — see the area-composition entry in PARKING_LOT.

> **Where the beds come from** is assessed separately in
> `docs/MUSIC_GENERATION_FEASIBILITY.md` — generating them with an
> open-weights music model (MiniMax-Music3), what such a model can and
> cannot give the vertical-layering design above, and the offline pipeline
> that closes the gap.  Short version: the generator is an authoring-time
> asset source, the music director in §3 is unaffected, and the per-bed
> `{bpm, loopStart, layers[]}` sidecar described there is the interface
> between them.  **§9 of that doc covers the §4 cues** — a song model is
> the wrong tool for them (32 kHz caps the transients that carry a
> shatter, and there is no audio-conditioned variation for the `[var]`
> round-robins); a purpose-built SFX model is right, and most `[var]`
> variation should be per-voice pitch/gain/filter jitter rather than extra
> files.

---

## 6. Open decisions

1. **The standalone-build fork** (§2a) — the one that should be settled
   first, since it decides the asset budget everything else is authored to.
2. **Asset pipeline**: format (Opus/AAC/WebM), sample rate, mono for spatial
   cues vs stereo for music, and whether stems stream or preload.
3. **Voice budget** on a mid-range phone — dictates how aggressive the
   culling and coalescing have to be.
4. **HRTF vs equal-power panning.**  HRTF is the AAA answer but costs CPU per
   voice; for a top-down 2D game equal-power stereo + distance attenuation
   may be indistinguishable and much cheaper.
5. **Does the listener sit at the ship or at the camera?**  They diverge
   during screen shake and at high zoom.  Camera is usually the right answer
   for a top-down game.
6. **Where audio settings live** — master/music/sfx/ui sliders and a mute
   need a home in the pause menu.
