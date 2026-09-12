# Audio production pass

The sample-based revision in [CINEMATIC_AUDIO.md](CINEMATIC_AUDIO.md) supersedes
the sound sources, duration targets and music routing described below.
This document preserves the initial architecture audit and event-hook history.

Base: `claude/plan-completion`. This change is confined to sound design,
audio lifecycle, sound-event hooks, audio settings and validation.

## Architecture and audit

`GameEngine` owns a gesture-unlocked `AudioSystem`. `SfxRegistry` owns event
recipes and their tier/gain/polyphony/cooldown settings. Physics, weapons,
drops and shards emit IDs through existing callbacks; roamers, bosses and
explosions call the same manager. No new raw Web Audio calls are introduced
into gameplay or React. The existing inliner embeds WAV data URIs.

The audit covered all 66 WAVs (22 IDs, three takes each), registry one-shots
and seven loops, and audio call sites in GameEngine, PhysicsSystem,
WeaponSystem, DropSystem, ShardSystem, explosions, bosses, roamers and UI.
All original WAVs were mono 44.1 kHz PCM with approximately -6 dBFS peaks.

Concrete defects addressed:

- Asset checks found six harsh impact takes and six overlong heavy takes.
- Sample coverage/status reads changed the round-robin cursor.
- Out-of-earshot events could collapse into a nearby voice before attenuation.
- World one-shots survived pause; loop stop disconnected before its fade.
- Panners remained connected after their input had finished.
- The full voice ceiling dropped critical feedback even with background
  voices available to replace.
- Flat gameplay cues were treated as UI for pause purposes.
- Snitch presence could remain active after the snitch disappeared.
- Wave start/grace, UI navigation/drag and bubble-drain cues had definitions
  but lacked their event hooks; scanning reused generic UI confirmation.

## Sound and mix

Existing healthy WAVs retain their character. `SfxVoicing` adds quiet body,
texture, staggered debris, tactile UI contact and transition detail to the
authored recipes. These are production synthesis, not placeholder assets.
Three variants per unsampled one-shot are rendered with OfflineAudioContext,
trimmed and cached; live synthesis covers startup or unsupported offline
rendering. Seven parameter-driven loops stay live (thrust, charge, portal,
station, snitch, disable and bubble drain). Recipes and variations are local;
there is no runtime sound service or remote dependency.

`AudioMix` centralizes world/feedback/UI/music routing, gains, release,
ducking and variation. Master controls all categories; SFX controls world,
player feedback and UI; Music controls wave/boss musical cues. There was no
background soundtrack to preserve or replace. Settings remain in-memory,
consistent with the existing project.

Random take choice avoids immediate repeats. Existing per-event pitch bounds
are retained, with small gain variation and baked timing/noise differences.
Torus-correct one-shots use squared distance attenuation; presence loops
retain their deliberately different radii and curves. Critical cues briefly
duck world chatter; a soft-knee compressor restrains combined peaks. Existing
per-ID caps, cooldowns, collapse limits and tier ceilings remain in place;
critical events may replace a less important voice at the hard ceiling.

Pause/dock fade gameplay voices while preserving UI/transition cues. Map
changes clear world voices and cooldown state. Restart and mute clear all
voices. Hidden tabs stop world audio and suspend the context; returning to
the tab resumes only a previously unlocked context. Output/panner nodes are
disconnected after their release rather than at the start of the fade.

## Event coverage

| System | Events / sound IDs | Change |
|---|---|---|
| Movement | `move.thrust`, material dent/snap/merge/regen | Preserve responsive low rumble; layer material detail and release loops cleanly |
| Player weapons | Seven weapon families, burst subshots, charged release/readiness, selector/reject | Keep existing takes; non-repeating variation, priority and mix control |
| Scanner ability | `ability.scan` | New rising two-stage sonar cue on successful scan |
| Enemy weapons | Basic, acid, fan, missile, boss | Existing distinct takes; shortened boss tails; background mix |
| Hits and hazards | Hull, shields, armor, lightning, explosions, collisions, corrosion/disable/expiry | Replace harsh hull takes; add body/texture; prioritize damage/disable cues |
| Materials | Five tile/shard families and destruction | Preserve material ordering and near-field chatter; replace harsh glass takes |
| Pickups and stations | Salvage streaks, health, merge, dock/undock, repair, purchase/sell/scrap, module install/stow/reject | Layer tactile contact; SFX bus; station cues survive freeze |
| Bosses and waves | Intro/phase/death, wave start/clear/snitch-clear/grace | Music bus for musical cues; wire initial/subsequent wave starts and final grace beat |
| Portals | Idle/open/transit | Preserve proximity identity; clear outgoing world sound on map load |
| Roamers | Dragon arrivals/provocation/leave/death, rivals, snitch, bubble latch/drain/detach | Layer transitions; stop stale snitch loop; drive player-latched drain loop |
| UI | Navigation, confirmation/back/error, drag pick/drop | Navigation and drag hooks; three accessible volume sliders |

No unused definition is given a fabricated gameplay trigger merely to improve
coverage. Existing callback-driven and dynamic material IDs remain centralized.

## Assets and licensing

- Replaced six `impact-hull-enemy-{a,b,c}` and
  `impact-tile-glass-{a,b,c}` WAVs with seeded renders of repository recipes,
  low-Q lowpass filtering, edge fades and -6 dBFS normalization.
- Shortened six `weapon-cannon-fire-{a,b,c}` and
  `enemy-shot-boss-{a,b,c}` WAVs to 280 ms with 30 ms tail fades.
- Other 54 files unchanged. Existing charged-release filenames (including
  the unusual `-b-wav` / `-c-wav` suffixes) remain valid through prefix discovery.
- `scripts/master-audio.mjs` reproduces the replacements and tail treatment.
- No third-party audio was added. New sound generation lives in repository
  source; inherited recordings retain their existing provenance/licensing.
  This is not a claim to have independently established the origin of old WAVs.

## Verification

- TypeScript check and production Vite build.
- Browser audio tests: all 66 recordings decode, no rejected/unmatched files;
  three cached variants for every unsampled one-shot, finite audible output,
  under 30 MiB of cached one-shot PCM; status queries do not alter variation;
  no immediate repeated take; stereo direction, mix values, pause/mute cleanup;
  400-event collapse, inaudible-event suppression and critical-voice admission.
- Existing asset smoke: **405 checks passed, zero failures**. Its **48 advisory
  warnings** cover short bright transients/deliberate one-shots and low-energy
  tails; these are not missing files or decode failures and remain listening
  considerations.
- Existing tone smoke: **21 checks passed, zero failures**, including material
  fatigue thresholds and portal/station distinction.
- Boot and run-loop smoke: menu/start, docking, commerce/outfitting, portal,
  wave/boss payout and return-home continuity.

In this container Vite's default preview host hits an OS network-interface
restriction. Tests use the same Playwright configuration with only the preview
host set to `127.0.0.1`, after a fresh production build.

Headless Chromium cannot certify subjective AAA quality, speaker/Bluetooth
latency, Safari interruption behavior or listening fatigue on a physical phone.
Playback schedules immediately on the audio clock with `latencyHint:
'interactive'`; hardware listening remains necessary before calling the mix
final. No claim of a physical-device listening session is made.
