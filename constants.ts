

import { WeaponConfig, WeaponType, MapType, EnemySubtype, EnemyRole, EntityType, EffectPayload, EnemyShape, DropType, GameEntity, ConsumeConfig, SpawnerConfig, PoiseConfig, ControlScheme } from './types';
import {
  ShardVariantId,
  ShardVariantDef,
  PerMapVariantSpawn,
} from './engine/systems/ShardSystem.types';
import { ASSETS } from './assets';
// The trigger-effect vocabulary is the HID protocol's own — wire values, not
// game config — so it lives with the transport.  Safe direction: DualSenseHID
// imports nothing, so this cannot cycle.
import { TriggerProfile } from './engine/systems/DualSenseHID';

export const CHUNK_SIZE = 16; // 16x16 tiles
export const SPATIAL_GRID_SIZE = 120; // Physics optimization bucket size

export const COLORS = {
  UNIVERSE_BG: '#020617', // Slate 950
  SOLAR_BG: '#0f172a',    // Slate 900
  LOCAL_BG: '#1e293b',    // Slate 800
  SUB_BG: '#0f172a',      // Darker for interiors
  PLAYER: '#38bdf8',      // Sky 400
  ENEMY: '#f87171',       // Red 400
  STAR: '#fbbf24',        // Amber 400
  PLANET: '#4ade80',      // Green 400
  ASTEROID: '#94a3b8',    // Slate 400
  STRUCTURE: '#6366f1',   // Indigo 500
  STRUCTURE_BORDER: '#818cf8', // Indigo 400 (legacy, glass-only)
  // Plastic — amber-shade family.  Per-instance random shade
  // picked from PLASTIC_AMBER_SHADES below at spawn time
  // (TileGenerator.buildStructureTile + DropSystem.spawnDentShard
  // override entity.color with a fresh randomPlasticShade()) so
  // every plastic-tile and every plastic-shard reads as its own
  // amber tone within a coherent palette.  This base constant
  // is the fallback used only if a future spawn site forgets to
  // pick — set to a mid-range amber so it'd still look correct.
  STRUCTURE_PLASTIC: '#b45309',           // Amber 700 — fallback shade
  // Metal — cool steel-blue with a brighter edge, so silhouettes pop
  // against the indigo glass tiles.
  STRUCTURE_METAL: '#5b8499',             // blue-cyan gunmetal body (slate shifted toward blue/cyan)
  STRUCTURE_INDESTRUCTIBLE: '#475569',    // Slate 600 — dull steel
};

// ── Rock palettes (material-palette-residual, decision #30) ─────────
// Rock was ONE flat slate (`COLORS.ASTEROID`), so a rock field read as grey
// gravel — the most common material in the game and the least characterful.
// Decision #30 asked for a "rock red+blue palette": per-instance shades
// spanning a warm oxidised red and a cold mineral blue, so a rock cluster
// has internal variation and different regions can eventually be built from
// different families ("maps become known for characteristics").
//
// Same mechanism as the plastic palettes and for the same reason: the shade
// is picked ONCE at spawn (`randomRockShade`) and stored on the entity, so
// it survives the tile→shard→tile cycle and costs nothing per frame.  The
// density-tint system multiplies this base, so every shade darkens toward
// the shared ROCK_AGGREGATION_TINT_FLOOR exactly as the old flat colour did.
export const ROCK_SLATE_SHADES = [
  '#94a3b8', '#8b98ac', '#a1adc0', '#7f8b9e', '#9aa7ba',
] as const;
// Oxidised — iron reds and rust browns, desaturated enough to sit against a
// near-black starfield without reading as lava.
export const ROCK_RUST_SHADES = [
  '#a1746a', '#8f6259', '#b08277', '#7d564f', '#96695f',
] as const;
// Mineral — cold blues with a slate backbone.
export const ROCK_MINERAL_SHADES = [
  '#7c93b8', '#6b83a8', '#8ba2c4', '#5f7699', '#7488ab',
] as const;
// Mixed — the shipped default: mostly slate with rust and mineral running
// through it, so a field reads as ROCK with variation rather than as three
// different materials.  The pure families stay selectable for regional
// identity work and for judging them side by side.
export const ROCK_MIXED_SHADES = [
  ...ROCK_SLATE_SHADES, ...ROCK_SLATE_SHADES,
  ...ROCK_RUST_SHADES, ...ROCK_MINERAL_SHADES,
] as const;

export const ROCK_PALETTES: ReadonlyArray<{ name: string; shades: readonly string[] }> = [
  { name: 'mixed',   shades: ROCK_MIXED_SHADES   },
  { name: 'slate',   shades: ROCK_SLATE_SHADES   },
  { name: 'rust',    shades: ROCK_RUST_SHADES    },
  { name: 'mineral', shades: ROCK_MINERAL_SHADES },
] as const;

let activeRockPaletteIndex = 0; // 'mixed'
export function getActiveRockPaletteName(): string {
  return ROCK_PALETTES[activeRockPaletteIndex].name;
}
export function cycleRockPalette(): number {
  activeRockPaletteIndex = (activeRockPaletteIndex + 1) % ROCK_PALETTES.length;
  return activeRockPaletteIndex;
}
/** One shade from the active rock palette.  Called at every rock-tile and
 *  free rock-shard spawn site; shards otherwise inherit their parent's. */
export function randomRockShade(): string {
  const shades = ROCK_PALETTES[activeRockPaletteIndex].shades;
  return shades[(Math.random() * shades.length) | 0];
}

// ── Plastic palettes ───────────────────────────────────────────────
// Per-instance random shade picked by randomPlasticShade() at every
// plastic-tile / plastic-shard spawn site so cluster colour reads as
// "different shades" rather than one flat tone.  The active palette
// is switched at runtime via cyclePlasticPalette() (wired through
// the DBG panel) — useful for trying different material reads
// (warm amber polymer vs. dark void vs. moss vs. obsidian) without
// rebuilding.

/** Amber polymer — warm earth tones, the v3 default. */
export const PLASTIC_AMBER_SHADES: ReadonlyArray<string> = [
  '#f59e0b',  // Amber 500
  '#d97706',  // Amber 600
  '#b45309',  // Amber 700
  '#92400e',  // Amber 800
  '#78350f',  // Amber 900
  '#a16207',  // Yellow 700
  '#854d0e',  // Yellow 800
] as const;

/** Pure black + near-blacks — void / tar / ink read. */
export const PLASTIC_BLACK_SHADES: ReadonlyArray<string> = [
  '#000000',
  '#0a0a0a',
  '#171717',  // Neutral 900
  '#262626',  // Neutral 800
] as const;

/** Dark green — moss / forest read. */
export const PLASTIC_DARK_GREEN_SHADES: ReadonlyArray<string> = [
  '#14532d',  // Green 900
  '#166534',  // Green 800
  '#15803d',  // Green 700
  '#064e3b',  // Emerald 900
  '#065f46',  // Emerald 800
] as const;

/** Dark purple — obsidian / amethyst read. */
export const PLASTIC_DARK_PURPLE_SHADES: ReadonlyArray<string> = [
  '#3b0764',  // Purple 950
  '#4c1d95',  // Violet 900
  '#581c87',  // Purple 900
  '#6b21a8',  // Purple 800
  '#2e1065',  // Violet 950
] as const;

/** Dark gray — gunmetal / charcoal read. */
export const PLASTIC_DARK_GRAY_SHADES: ReadonlyArray<string> = [
  '#111827',  // Gray 900
  '#1f2937',  // Gray 800
  '#374151',  // Gray 700
  '#0f172a',  // Slate 900
  '#1e293b',  // Slate 800
] as const;

/** Deep blue — deep-ocean / midnight read. */
export const PLASTIC_DEEP_BLUE_SHADES: ReadonlyArray<string> = [
  '#172554',  // Blue 950
  '#1e3a8a',  // Blue 900
  '#1e40af',  // Blue 800
  '#0c4a6e',  // Sky 900
  '#075985',  // Sky 800
] as const;

/** Dark blue — darker than the `blue` palette; navy / indigo
 *  midnight tones with no Sky brights mixed in. */
export const PLASTIC_DARK_BLUE_SHADES: ReadonlyArray<string> = [
  '#020617',  // Slate 950
  '#1e1b4b',  // Indigo 950
  '#0c1e3a',  // custom dark navy
  '#1a1d4a',  // custom dark indigo
  '#0a1535',  // custom very dark navy
] as const;

/** Plain white shades — porcelain / paper read. */
export const PLASTIC_WHITE_SHADES: ReadonlyArray<string> = [
  '#ffffff',
  '#fafafa',  // Neutral 50
  '#f5f5f5',  // Neutral 100
  '#e5e5e5',  // Neutral 200
] as const;

/** Yellow / gold / amber shades — the constant base shade used by the
 *  PAuto neighbour-brightness automata via getPlasticShardBaseShade().
 *  Per-instance plastic-shard colour is now drawn from the cyclable
 *  PLASTIC_PALETTES list via randomPlasticShardShade() (independent
 *  index from the tile palette). */
export const PLASTIC_YELLOW_SHADES: ReadonlyArray<string> = [
  '#fde047',  // Yellow 300
  '#facc15',  // Yellow 400
  '#eab308',  // Yellow 500
  '#fbbf24',  // Amber 400 (golden)
  '#f59e0b',  // Amber 500 (amber-gold)
] as const;

/** Bright green / emerald shades — the default plastic-TILE palette. */
export const PLASTIC_LIGHT_GREEN_SHADES: ReadonlyArray<string> = [
  '#86efac',  // Green 300
  '#4ade80',  // Green 400
  '#22c55e',  // Green 500
  '#34d399',  // Emerald 400
  '#10b981',  // Emerald 500
] as const;

interface PlasticPalette {
  readonly name: string;
  readonly shades: ReadonlyArray<string>;
}

/** Cycle order for cyclePlasticPalette().  First entry is the
 *  startup default.  outline / solidEdge fields were dropped with
 *  the soft-disc render in plastic-revert; the black/white palettes
 *  remain available as solid-fill options. */
export const PLASTIC_PALETTES: ReadonlyArray<PlasticPalette> = [
  { name: 'litegreen',   shades: PLASTIC_LIGHT_GREEN_SHADES },
  { name: 'amber',       shades: PLASTIC_AMBER_SHADES       },
  { name: 'black',       shades: ['#000000']                },
  { name: 'green',       shades: PLASTIC_DARK_GREEN_SHADES  },
  { name: 'purple',      shades: PLASTIC_DARK_PURPLE_SHADES },
  { name: 'gray',        shades: PLASTIC_DARK_GRAY_SHADES   },
  { name: 'blue',        shades: PLASTIC_DEEP_BLUE_SHADES   },
  // Darker blue family — Slate 950 / Indigo 950 / custom navies.
  // Distinct from `blue` (which includes brighter Sky 800/900).
  { name: 'darkblue',    shades: PLASTIC_DARK_BLUE_SHADES   },
  { name: 'white',       shades: PLASTIC_WHITE_SHADES       },
] as const;

let activePlasticPaletteIndex = 0; // litegreen
// Independent palette index for plastic-SHARDS — cycles through the
// same PLASTIC_PALETTES list as tiles via a separate DBG button
// (cyclePlasticShardPalette).  Lets shards read in a different family
// from the tiles they spawn from.
let activePlasticShardPaletteIndex = 0; // litegreen

/** Index of the active palette in PLASTIC_PALETTES.  Exposed for
 *  the DBG panel via EngineStats. */
export function getActivePlasticPaletteIndex(): number {
  return activePlasticPaletteIndex;
}

/** Name of the active palette (for DBG button label). */
export function getActivePlasticPaletteName(): string {
  return PLASTIC_PALETTES[activePlasticPaletteIndex].name;
}

/** Advance the active palette by one slot, wrapping at the end.
 *  Returns the new index.  Re-colouring existing entities is the
 *  caller's responsibility (see GameEngine.cyclePlasticPalette). */
export function cyclePlasticPalette(): number {
  activePlasticPaletteIndex = (activePlasticPaletteIndex + 1) % PLASTIC_PALETTES.length;
  return activePlasticPaletteIndex;
}

/** Name of the active plastic-SHARD palette (for DBG button label). */
export function getActivePlasticShardPaletteName(): string {
  return PLASTIC_PALETTES[activePlasticShardPaletteIndex].name;
}

/** Advance the plastic-SHARD palette by one slot.  Cycles through
 *  the same PLASTIC_PALETTES list as tiles but tracked separately.
 *  Re-colouring existing shards is the caller's responsibility
 *  (see GameEngine.cyclePlasticShardPalette). */
export function cyclePlasticShardPalette(): number {
  activePlasticShardPaletteIndex = (activePlasticShardPaletteIndex + 1) % PLASTIC_PALETTES.length;
  return activePlasticShardPaletteIndex;
}

// ── Material proximity-glow brightness cycles (DBG-only) ────────────
// Multipliers applied to the final globalAlpha of the material-tile
// proximity bloom (RenderSystem).  Independent cycles for plastic and
// metal so the two materials' glows can be tuned separately.  At 1×
// the glow renders at its SHARD_VARIANTS-defined peakAlpha (today
// plastic 0.33, metal 0.75); higher steps multiply that alpha and the
// canvas clamps to 1.0, which broadens the visible-glow range so the
// halo lights up from farther away and reads brighter near contact.
export const MATERIAL_GLOW_BRIGHTNESS_CYCLE: ReadonlyArray<number> = [
  1, 2, 3, 4, 5,
] as const;

let activePlasticGlowBrightnessIndex = 0; // 1×
let activeMetalGlowBrightnessIndex   = 0; // 1×

export function getActivePlasticGlowBrightness(): number {
  return MATERIAL_GLOW_BRIGHTNESS_CYCLE[activePlasticGlowBrightnessIndex];
}
export function getActivePlasticGlowBrightnessName(): string {
  return `${getActivePlasticGlowBrightness()}x`;
}
export function cyclePlasticGlowBrightness(): number {
  activePlasticGlowBrightnessIndex =
    (activePlasticGlowBrightnessIndex + 1) % MATERIAL_GLOW_BRIGHTNESS_CYCLE.length;
  return activePlasticGlowBrightnessIndex;
}


// ── Glass-tile glow colour cycle (DBG-only) ─────────────────────────
// The default is the cool cyan baked into SHARD_VARIANTS['glass-tile']
// .glow.color (#a5f3fc); the cycle adds warm + diverse families so we
// can A/B the look.  The glass GLOW itself is gone — the unified light
// layer replaced it — so nothing reads this table for a tile's colour any
// more; it survives for the `nebulaPalette` companion below.
//
// Each entry ALSO bundles a `nebulaPalette` — when the DBG 'Neb follows
// glow' toggle is on, getActiveNebulaPalette() returns this companion
// preset so the nebula cloud tracks the glow family (e.g. yellow glow ↔
// yellow nebula).  Off restores the independent NEBULA_PALETTES cycle.
export interface GlassGlowColor {
  name: string;
  hex: string;
  // Companion nebula HSL preset used while 'Neb follows glow' is ON.
  // Same shape as NebulaPalette below; duplicated to keep the two
  // cycles' configs co-located + co-edited.
  nebulaPalette: { hueMin: number; hueRange: number; saturation: number; lightness: number; };
}
export const GLASS_GLOW_COLORS: ReadonlyArray<GlassGlowColor> = [
  { name: 'cyan',    hex: '#a5f3fc', nebulaPalette: { hueMin: 175, hueRange: 50, saturation: 100, lightness: 62 } }, // default
  { name: 'yellow',  hex: '#fde047', nebulaPalette: { hueMin: 48,  hueRange: 14, saturation: 100, lightness: 60 } },
  { name: 'amber',   hex: '#fbbf24', nebulaPalette: { hueMin: 38,  hueRange: 18, saturation: 100, lightness: 55 } },
  { name: 'gold',    hex: '#eab308', nebulaPalette: { hueMin: 42,  hueRange: 18, saturation: 100, lightness: 50 } },
  { name: 'magenta', hex: '#e879f9', nebulaPalette: { hueMin: 295, hueRange: 25, saturation: 95,  lightness: 65 } },
  { name: 'rose',    hex: '#fb7185', nebulaPalette: { hueMin: 345, hueRange: 25, saturation: 95,  lightness: 65 } },
  { name: 'lime',    hex: '#a3e635', nebulaPalette: { hueMin: 75,  hueRange: 25, saturation: 90,  lightness: 60 } },
  { name: 'emerald', hex: '#34d399', nebulaPalette: { hueMin: 150, hueRange: 25, saturation: 80,  lightness: 55 } },
  { name: 'sky',     hex: '#7dd3fc', nebulaPalette: { hueMin: 198, hueRange: 22, saturation: 95,  lightness: 70 } },
  { name: 'violet',  hex: '#a78bfa', nebulaPalette: { hueMin: 260, hueRange: 25, saturation: 90,  lightness: 70 } },
  { name: 'white',   hex: '#f8fafc', nebulaPalette: { hueMin: 0,   hueRange: 360, saturation: 0,  lightness: 90 } },
] as const;



// ── Metal-tile glow colour cycle (DBG-only) ─────────────────────────
// REMOVED with the metal-tile contact glow it tuned (the unified light
// layer replaced that glow).  The note below is kept because the default it
// argues about is still baked into SHARD_VARIANTS.
//
// DEFAULT CHANGED index 4 'magenta' → 0 'cyan' (material-palette-residual,
// decision #30 → gauntlet step 5 G7).  Magenta was never chosen: it was the
// nearest match to a legacy fuchsia baked into SHARD_VARIANTS, and it left
// the game's coldest material — now an explicitly blue steel that brightens
// toward METAL_BRIGHT_TARGET — wearing a hot pink halo whenever the player
// got close.  Cyan is the same cold family as the body, and it is NOT the
// glass glow's 'sky' (index 8), so the two tile glows still read apart:
// glass glows a soft sky, metal an icy cyan.


// ── Nebula palette cycle (DBG-only) ─────────────────────────────────
// Independent cycle into the same GLASS_GLOW_COLORS list, governing
// glass-tile shatter / merge dust ONLY (randomGlassNebulaComposition).
// Default 'sky' matches the Glass-glow default so glow + glass-side
// dust read as a coherent family out of the box.
//
// Explicitly NOT affected by this cycle (all stay on the legacy
// cyan→red palette):
//   - main background nebula tiles + shards (randomNebulaComposition)
//   - BG nebula puffs (BackgroundManager via randomPaletteHueDeg)
//   - NebulaSystem colour equilibration (paletteHueToHex drift)
//
// And rock-side dust (randomRockNebulaComposition) is fixed at white —
// see NebulaColor.ts for both restore paths if either invariant is
// wanted as a cyclable knob later.
export interface NebulaPalette {
  name: string;
  hueMin: number;     // degrees, start of the arc
  hueRange: number;   // degrees, arc width (wraps past 360)
  saturation: number; // 0..100
  lightness: number;  // 0..100
}

let activeNebulaPaletteIndex = 8; // default 'sky' — glass dust + main nebulae

export function getActiveNebulaPalette(): NebulaPalette {
  const g = GLASS_GLOW_COLORS[activeNebulaPaletteIndex];
  return { name: g.name, ...g.nebulaPalette };
}
export function getActiveNebulaPaletteName(): string {
  return GLASS_GLOW_COLORS[activeNebulaPaletteIndex].name;
}
export function cycleNebulaPalette(): number {
  activeNebulaPaletteIndex = (activeNebulaPaletteIndex + 1) % GLASS_GLOW_COLORS.length;
  return activeNebulaPaletteIndex;
}

/** Pick a random shade from the ACTIVE plastic palette.  Called at
 *  every plastic-tile / plastic-shard spawn site so cluster colour
 *  reads as "different shades" within the chosen family. */
export function randomPlasticShade(): string {
  const palette = PLASTIC_PALETTES[activePlasticPaletteIndex].shades;
  return palette[Math.floor(Math.random() * palette.length)];
}

/** Pick a random shade from the ACTIVE plastic-SHARD palette.  Cycles
 *  through the same PLASTIC_PALETTES list as tiles but via its own
 *  independent index — DBG `Shard pal` button can rotate shard colour
 *  family without touching tiles, and vice-versa. */
export function randomPlasticShardShade(): string {
  const palette = PLASTIC_PALETTES[activePlasticShardPaletteIndex].shades;
  return palette[Math.floor(Math.random() * palette.length)];
}

/** Constant base colour for the plastic-shard neighbour-brightness
 *  automata (PAuto, off by default).  When PAuto is on every shard reads
 *  as this single yellow (only brightness encodes density); the 50/50
 *  yellow/cyan mix above only applies on the per-instance PAuto-off path. */
export function getPlasticShardBaseShade(): string {
  return PLASTIC_YELLOW_SHADES[2];
}

// ── Plastic-shard neighbour-brightness automata (PAuto) ────────────
// When enabled, plastic-shards drop their per-instance random shade
// and all render in the active palette's constant base shade, with
// brightness scaled by how many other plastic-shards are in contact —
// mirroring the nebula-tile interior-darken rule.  More contacts =
// darker, so cluster interiors recede and edges/lone shards pop.
// ShardSystem computes the per-shard contact count off the merge
// broadphase grid; RenderSystem applies the brightness factor.
export const PLASTIC_SHARD_AUTOMATA = {
  /** Multiplier on the summed collision radii (aR + bR) below which a
   *  pair counts as "in contact".  >1 so near-touching shards count. */
  CONTACT_BUFFER: 1.4,
  /** Contact count at which the brightness factor saturates. */
  MAX_NEIGHBORS: 6,
  /** Brightness multiplier at MAX_NEIGHBORS when DARKENING interiors
   *  (the default direction) — <1 so dense clusters recede. */
  MIN_BRIGHTNESS: 0.5,
  /** Brightness multiplier at MAX_NEIGHBORS when BRIGHTENING interiors
   *  — >1 so dense clusters glow.  Selected by the PADIR toggle. */
  MAX_BRIGHTNESS: 1.6,
} as const;

// ── Plastic-shard flow-field affinity ──────────────────────────────
// Multiplier on the asteroid flow-field correction blend rate
// (FLOW_CORRECTION in GameEngine.applyFlow) applied only when the
// entity being corrected is a plastic-shard.  Default 5× — at the
// baseline 0.08 correction × max urgency 9 × FIXED_DT 1/120, this
// raises the per-substep velocity-toward-target blend from ~0.6 %
// to ~3 %, so plastic shards snap onto flow lanes within a fraction
// of a second instead of drifting for several.  Reads like the wind
// catches them.  Rock / glass / metal / nebula stay on the baseline.
export const PLASTIC_SHARD_FLOW_MULT = 5;

// ── Flow-field per-entity variability ──────────────────────────────
// Inverse-mass scaling applied to BOTH the correction blend rate
// (how fast an entity locks onto the flow direction) AND the
// terminal flow speed (the steady-state drift velocity an entity
// settles at).  Lighter entities snap into flow lanes faster AND
// reach a higher cruise speed; heavier entities drift sluggishly
// behind at a lower steady-state.  Replaces the lockstep behaviour
// where every shard in the same flow cell converged identically.
//
// Formula:  massScale = sqrt(MASS_REF / max(mass, MASS_REF × MIN_MASS_FRACTION))
//           alpha       *= massScale × (plasticBoost if plastic)
//           targetSpeed *= massScale
//
// Plastic's 5× boost is applied BEFORE the mass scale (so heavy
// plastic blobs are diluted just like heavy rock — the plastic
// character shows mainly when the blob is light).  Drops use the
// same math at their fixed mass = 5, so all drops cruise
// slightly faster than baseline shards but consistently within
// their own family.
export const FLOW_VARIABILITY = {
  /** Reference mass — entities at this mass get massScale = 1.0
   *  (baseline flow response).  Picked at the median spawn mass of
   *  base shards (~7 for rock at 20 px) so a fresh chip is neutral
   *  and merged / condensed shards skew below it. */
  MASS_REF: 7,
  /** Floor on the mass divisor.  Clamps the effective minimum at
   *  MASS_REF × MIN_MASS_FRACTION so ultralight outliers don't
   *  produce runaway massScale values. */
  MIN_MASS_FRACTION: 0.05,
} as const;

// ── Plastic-shard cross-material transmute on contact ──────────────
// When a plastic-shard collides with a strictly larger shard whose
// material is NOT plastic and NOT nebula, the plastic-shard adopts
// the partner's material — same size, same polygon shape, new
// variant + colour + mass.  Reads as plastic absorbing the surface
// character of whatever it touches.  Indestructible has no
// corresponding shard variant and is therefore excluded.  See
// PhysicsSystem.tryPlasticTransmuteOnContact.
export const PLASTIC_TRANSMUTE_EXCLUDE: ReadonlyArray<string> = [
  'plastic-tile', 'plastic-shard',
  'nebula-tile',  'nebula-shard',
  'indestructible-tile',
] as const;

// ── Shard → tile snap thresholds (plastic / glass / metal) ─────────
// Unified snap criteria for the three materials that condense into
// static tiles from mobile shards.  Rock is excluded — rocks grow
// through ROCK_CONDENSE tiers without a tile-snap path; nebula has
// its own probabilistic adapter.  Each path:
//   1. Polls AFTER every successful compose (post-merge, end of
//      composeEntities, NOT per-tick).
//   2. Requires the survivor's effective area / cell count to reach
//      the 2× tile-area threshold.
//   3. Requires per-substep speed² below REST_SPEED_SQ so a fast-
//      flying merged shard doesn't abruptly halt mid-flight.
//   4. On snap: spawns a static tile via buildTileAtNearestFreeHex
//      AND releases ~1 tile's worth of debris as overflow (the half
//      of the absorbed mass that didn't fit into the tile).
export const TILE_SNAP = {
  /** Diameter multiplier vs sqrt(HEX_AREA) (= GLASS_TIER_DIAMETER).
   *  At 2× the merged area is 4× a single tile's area, so the snap
   *  converts ~25 % into the tile and the remaining 75 % is released
   *  as debris.  Applied to plastic + glass survivors after compose. */
  DIAMETER_MULT: 2.0,
  /** Per-substep speed-squared threshold (px²/step²) below which a
   *  candidate may snap.  1.0 = 1 px/substep at FIXED_DT 1/120 =
   *  120 px/s drift; a shard moving slower than this counts as
   *  "settled enough."  Applied to plastic + glass + metal. */
  REST_SPEED_SQ: 1.0,
  /** Debris count + per-shard diameter spawned as overflow on snap.
   *  Each material spawns its own variant (plastic → plastic-shard,
   *  glass → glass-shard, metal → 6 equilateral triangles per the
   *  existing decomposeMetalComposite path). */
  DEBRIS_COUNT: 4,
  DEBRIS_DIAMETER: 50,
  /** Max excess a floating composite can soak before it stops absorbing.
   *  At METAL_MAX_DENSITY_TIER = 6 a tile holds 36 shards (6 lattice + 30
   *  excess), so cap excess at 30.  A composite snaps on REST SPEED at
   *  whatever tier it has reached; this only bounds the top tier. */
  METAL_MAX_EXCESS_CELLS: 30,
} as const;

// ── Plastic dent recovery (per-dent snap-back) ─────────────────────
// Every dent on a plastic-tile / plastic-shard pushes one entry
// onto entity.plasticDentHistory holding the polygon delta that
// dent applied (post - pre, including the preserve-bounding-radius
// rescale).  Each entry counts down DELAY_SECONDS, and on expiry
// the recovery pass subtracts its delta from polygonPoints — one
// hit's worth of deformation snaps back instantly.  Three hits in
// quick succession = three snap-backs spaced DELAY_SECONDS apart;
// no smooth lerp, no per-entity lull.  Reads as plastic "memory"
// expiring per impact rather than the whole polygon relaxing
// together.  See ShardSystem.tickPlasticDentRecovery.
export const PLASTIC_DENT_RECOVERY = {
  /** Seconds between the dent landing and that single dent snapping
   *  back instantly.  Each dent timer is independent. */
  DELAY_SECONDS: 1.5,
} as const;

// PADIR toggle — direction of the PAuto automata.  false (default) =
// darken dense interiors (mirrors nebula); true = brighten them.
let activePlasticAutomataBrighten = true; // brighten dense interiors

/** True when the PAuto automata brightens dense interiors instead of
 *  darkening them.  Read by RenderSystem's plasticAutomataHex. */
export function isPlasticAutomataBrighten(): boolean {
  return activePlasticAutomataBrighten;
}

/** Flip the PAuto automata between darken and brighten.  Returns the
 *  new state (true = brighten). */
export function togglePlasticAutomataBrighten(): boolean {
  activePlasticAutomataBrighten = !activePlasticAutomataBrighten;
  return activePlasticAutomataBrighten;
}

// ── Nebula-shard velocity-stretch stiffness cycle ──────────────────
// K multiplier on speed for the velocity-aligned stretch (see
// NEBULA_CONSTANTS.VEL_STRETCH_* above + RenderSystem nebula-shard
// render branch).  Cycled via the DBG NStr button — four active
// stops between K = 0.05 and K = 0.10 (plus an off step at K = 0
// that short-circuits the entire stretch block).  Default index 2
// (K = 0.07) sits in the middle of the range.

interface NebulaStretchStep {
  readonly name: string;
  readonly k: number;
}

export const VEL_STRETCH_K_CYCLE: ReadonlyArray<NebulaStretchStep> = [
  { name: 'off',   k: 0     },
  { name: '0.05',  k: 0.05  },
  { name: '0.07',  k: 0.07  },
  { name: '0.085', k: 0.085 },
  { name: '0.10',  k: 0.10  },
] as const;

let activeNebulaStretchKIndex = 3; // 0.085

/** Active stretch multiplier K (in speed → stretch).  Read by
 *  RenderSystem nebula-shard render each frame. */
export function getActiveNebulaStretchK(): number {
  return VEL_STRETCH_K_CYCLE[activeNebulaStretchKIndex].k;
}

/** Active stretch step name for the DBG button label. */
export function getActiveNebulaStretchName(): string {
  return VEL_STRETCH_K_CYCLE[activeNebulaStretchKIndex].name;
}

/** Advance the active stretch slot by one, wrapping at the end.
 *  Returns the new index. */
export function cycleNebulaStretch(): number {
  activeNebulaStretchKIndex = (activeNebulaStretchKIndex + 1) % VEL_STRETCH_K_CYCLE.length;
  return activeNebulaStretchKIndex;
}

// --- SYSTEM CONFIGURATIONS ---

export const CAMERA_CONSTANTS = {
  DEFAULT_ZOOM: 0.65,
  TRANSITION_DURATION: 0.8,
  TRANSITION_ZOOM_IN_FACTOR: 14, // Zoom multiplier when entering map
  TRANSITION_ZOOM_OUT_FACTOR: 0.95, // Zoom factor when leaving
  SHAKE_DECAY: 0.3, // Duration of shake falloff
  CULL_MARGIN: 150 // Pixels outside screen to still render
};

export const SPRITE_CONSTANTS = {
  // Adjust this to align the player ship art with the facing direction.
  PLAYER_ROTATION_OFFSET: Math.PI*(3/4), // Radians
  // Enemies render as native polygons whose nose points along +x (= the
  // entity's facing angle), so no art-alignment offset is needed.  (The old
  // 3π/4 value was for the retired up-left sprite art and skewed every
  // polygon off its heading — most visibly on the triangle / arrow.)
  ENEMY_ROTATION_OFFSET: 0,
  // Rival ships (Stage 7) render from the RETIRED enemy PNGs, which (like the
  // player art) point up-left — so they need the same 3π/4 alignment offset as
  // the player, NOT the procedural-enemy 0.
  RIVAL_ROTATION_OFFSET: Math.PI*(3/4),
  PLAYER_BASE_SIZE: 20 // Default visual/physics size for player (x/y)
};

export const AI_CONFIG = {
  // Reaction time simulation
  REACTION_TIME_BASE: 0.2,
  REACTION_TIME_VAR: 0.3,

  // State switching timers (used by SHOOTING enemies and default)
  IDLE_TIME_BASE: 1.0,
  IDLE_TIME_VAR: 1.5,
  CHASE_TIME_BASE: 2.0,
  CHASE_TIME_VAR: 2.0,

  // Flight Physics
  ROTATION_THRESHOLD: 20, // Speed at which enemy rotates to face velocity instead of target

  // Rammer-specific overrides: short idle pause, long aggressive charge bursts
  RAMMER: {
    IDLE_TIME_BASE: 0.4,
    IDLE_TIME_VAR: 0.3,
    CHASE_TIME_BASE: 4.0,
    CHASE_TIME_VAR: 1.5,
    ROTATION_THRESHOLD: Infinity, // Always steer toward the player, even at speed
    // Retreat arc: when transitioning chase→idle within this distance, apply a
    // lateral impulse so the rammer circles away instead of stopping dead.
    RETREAT_TRIGGER_DIST: 280,
    RETREAT_IMPULSE: 0.6,        // perpendicular kick as fraction of maxSpeed
  },

  // Pack behavior — rammers within PACK_SYNC_RANGE of a chasing rammer get
  // their idle timer capped to PACK_SYNC_WINDOW, forcing a near-simultaneous charge.
  PACK_SYNC_RANGE: 450,
  PACK_SYNC_WINDOW: 0.2,

  // Skirmisher specific behavior
  SKIRMISHER: {
    PREFERRED_DIST: 300,
    DEADZONE: 50,
    STRAFE_MODIFIER: 0.75,
    LEAD_FACTOR: 0.8,      // fraction of perfect aim-lead (0 = no lead, 1 = perfect)
    PROJECTILE_SPEED: 5.0, // must match ENEMY_WEAPON.speed
  },

  // Orbiter (SHOOTER_2) idle locomotion: instead of the generic
  // seek/flee/strafe kite, it holds a fixed radius and circles the player —
  // a TRUE orbit so the archetype reads its name.  Radial term softly pulls
  // it back to RADIUS; tangential term drives the circle (handedness is a
  // stable per-entity orbitSpin so a pack doesn't all sweep the same way).
  // Rotation still faces the player (set by the shared aim block), so the
  // orbit never desyncs facing from aim.
  ORBITER: {
    RADIUS: 270,           // held orbit distance (units)
    RADIAL_DEADZONE: 70,   // error band over which the radial pull saturates
    RADIAL_GAIN: 1.0,      // radial-correction accel as a fraction of accel
    TANGENTIAL: 1.0,       // tangential-drive accel as a fraction of accel
  },

  // Swarm (Stage 4) movement.  Base flock: seek the player + separation from
  // nearby swarm units (so they spread into a darting cloud, not a stack) + a
  // little jitter.  Separation + jitter apply in EVERY mode; the per-mode
  // blocks below set the base seek/steer.  Mode is the DBG `cycleSwarmMove`.
  SWARM: {
    SEPARATION_RANGE: 46,
    SEPARATION_STRENGTH: 1.4,
    JITTER_ACCEL: 10,
    // Orbiting vortex: hold a radius and swirl, periodically darting inward to
    // bite then peeling back out.
    VORTEX: {
      RADIUS: 150,          // held swirl radius (units)
      DEADZONE: 80,         // radial-error band over which the pull saturates
      RADIAL_GAIN: 1.1,     // radial-correction accel (× accel)
      TANGENTIAL: 1.25,     // swirl drive (× accel)
      DART_RADIUS_FRAC: 0.0,  // dart drives all the way into the player (to bite)
      DART_INTERVAL: 2.4,   // seconds between darts (+ up to VAR)
      DART_VAR: 1.6,
      DART_DURATION: 0.5,   // seconds the inward dart lasts
    },
    // Sine-weave: approach on a serpentine weave around the bee-line to the
    // player so they juke and are hard to pin.
    WEAVE: {
      FREQ: 7,              // weave angular frequency (rad/s)
      AMP: 1.1,             // perpendicular weave amplitude (fraction of seek)
      CLOSE_DAMP: 220,      // weave amplitude fades to 0 within this distance
    },
    // Burst-dash: coast slowly, then fire a quick telegraphed lunge at the
    // player, with dodge windows between darts.
    BURST: {
      COAST_INTERVAL: 1.6,  // seconds of coast between dashes (+ up to VAR)
      COAST_VAR: 1.0,
      DASH_DURATION: 0.45,  // seconds a dash lasts
      DASH_ACCEL_MULT: 3.0, // accel toward player during a dash (× accel)
      DASH_SPEED_MULT: 1.8, // speed cap during a dash (× maxSpeed)
      COAST_SPEED_MULT: 0.35, // speed cap while coasting
      COAST_DAMP: 0.92,     // per-step velocity damping while coasting
      TELEGRAPH: 0.18,      // pre-dash wind-up flash (seconds)
    },
  },

  // Bubble (Stage 5) movement.  Ambient fauna with three regimes:
  //  - DRIFT (passive, no shard in sight): ride the asteroid flow field — steer
  //    the velocity toward the local current at DRIFT_SPEED, so a field of them
  //    streams along the same lanes as the asteroids.
  //  - CHASE (passive, a shard within SHARD_VISION): peel OFF the flow and seek
  //    the nearest eatable shard at CHASE_SPEED_MULT× maxSpeed, then eat it on
  //    contact (the consume pass) and resume drifting.
  //  - SEEK (provoked / shot): floaty pursuit of the player up to maxSpeed.
  BUBBLE: {
    DRIFT_SPEED: 2.2,         // cruise speed while riding the flow (units/step cap)
    DRIFT_CORRECTION: 1.4,    // lerp rate of velocity toward the flow target (×dt)
    SHARD_VISION: 280,        // range at which a passive bubble spots + chases a shard
    CHASE_SPEED_MULT: 1.0,    // speed cap while chasing a shard (× maxSpeed)
    SEEK_ACCEL_MULT: 1.4,     // accel toward target when provoked (× accel)
    PROVOKED_SPEED_MULT: 2.2, // sustained speed cap when provoked (× maxSpeed) —
                              // high enough to RUN DOWN a fleeing enemy/player
    // Burst/coast — ONLY while provoked (aggro): a hunting bubble coasts fast
    // and periodically LUNGES even faster to close the gap.  Passive bubbles
    // (drift / shard-chase) never burst, so they stay slow and easy to ignore
    // until shot.
    BURST_INTERVAL: 1.6,      // seconds of fast coast between lunges (+ up to VAR)
    BURST_VAR: 1.2,
    BURST_DURATION: 0.6,      // seconds a lunge lasts
    BURST_SPEED_MULT: 1.7,    // speed-cap multiplier during a lunge
    BURST_ACCEL_MULT: 2.2,    // accel multiplier during a lunge
  },

  // Drone (RAMMER_1) idle locomotion: a constant low-amplitude random
  // velocity jitter so the frantic peashooter buzzes/shimmies instead of
  // flying a clean line.  Applied as an accel (×dt) so it's framerate-stable;
  // small enough not to derail the dive.
  DRONE_JITTER_ACCEL: 16,

  // Aggro awareness: enemies within AGGRO_RANGE of a killed enemy get a
  // temporary speed boost and shortened idle for AGGRO_DURATION seconds.
  AGGRO_RANGE: 500,
  AGGRO_DURATION: 4.0,
  AGGRO_SPEED_MULT: 1.35,
  AGGRO_IDLE_MULT: 0.35, // idle time multiplier while aggroed (shorter pauses)

  // Distance beyond which enemies always seek the player, overriding idle state.
  // Prevents waves from stalling when the player moves away from the spawn location.
  LONG_RANGE_SEEK_DIST: 700,

  // Stuck detection: if an enemy travels less than STUCK_DIST_THRESHOLD units
  // over STUCK_CHECK_INTERVAL seconds while chasing, it gets a random nudge.
  STUCK_CHECK_INTERVAL: 1.5,
  STUCK_DIST_THRESHOLD: 50,
};

export const COLLISION_CONFIG = {
  // Physics Resolution
  ELASTICITY: 0.5, // Bounciness (0 to 1)
  CORRECTION_PERCENT: 0.2, // How much overlap to fix per frame
  SLOP: 0.01, // Penetration allowance to prevent jitter
  // Mass-ratio compression for the impulse's velocity split.  The
  // velocity-resolution step at every impulse site uses
  // invMass^MASS_BIAS_EXPONENT instead of the raw inverse mass, so a
  // light fast entity visibly shoves a heavy slow one (p = mv reads
  // mass-dominant at true physics: a 16× heavier target picks up
  // only ~9 % of the closing speed; at 0.5 it picks up ~30 %).
  // 1.0 = exact physics; 0 = mass-agnostic equal split.  Equal-mass
  // pairs and infinite-mass (static) entities are unaffected at any
  // exponent.  Positional correction keeps the TRUE inverse-mass
  // split — overlap separation should stay mass-faithful so heavy
  // bodies aren't teleported by light debris.
  MASS_BIAS_EXPONENT: 0.5,

  // Damage Values
  DAMAGE: {
    ASTEROID_CRUSH: 999, // Instant kill
    PLAYER_RAM_ENEMY: 15,
    STRUCTURE_IMPACT: 10,
    MINOR_IMPACT: 1
  },
  // Environmental damage (tiles & asteroids) — speed-gated so being
  // stuck between objects doesn't drain health.
  ENV_DAMAGE: {
    SPEED_THRESHOLD: 1.5,  // Minimum impact speed to take any damage
    MULTIPLIER: 0.15,      // damage = impactSpeed × multiplier (fractional HP)
  },

  // Screen Shake Intensity
  SHAKE: {
    MICRO: 1, // Projectile hit
    MEDIUM: 10, // Enemy collision
    HEAVY: 20, // High speed crash
    CAP_MULTIPLIER: 1.5, // Multiplier for velocity-based shake

    /* ── BODY IMPACTS: shake follows the player's own velocity STEP ──────
     *
     * The player-collision shake used to be `min(impactSpeed, HEAVY) *
     * CAP_MULTIPLIER` — SPEED ALONE, with no mass anywhere in it.  Every
     * other part of the collision code weighs mass: the crash gate is
     * `mass * impactSpeed > ASTEROID_CRASH_MOMENTUM`, and the impulse solver
     * splits by (bias-compressed) inverse mass.  Shake was the exception, so
     * a 15px chip and a static wall shook the camera identically at the same
     * closing speed, and the chip pinned the cap (user report: "very small
     * shards moving at high enough speeds ... feels overpowered").
     *
     * The honest quantity is the one the solver is about to apply anyway:
     * how much the PLAYER'S OWN velocity changes along the normal.
     *
     *     dv = (1 + ELASTICITY) * |v_n| * effInv_player
     *                                   / (effInv_player + effInv_other)
     *
     * It is the sim's own velocity step, so it agrees with the physics by
     * construction — bias exponent included — and it carries both masses
     * without a second model to keep in sync.  Three consequences fall out
     * rather than being written:
     *
     *   · A static tile has effInv = 0, so dv = (1+e)|v_n|: a wall is the
     *     hardest possible hit, and with SCALE 1.0 / MAX 30 the wall curve
     *     is IDENTICAL to the old one.  Nothing about crashing changed.
     *   · A light body attenuates by the true mass ratio.  At |v_n| = 20:
     *     wall 30 (was 30), 40px metal shard 12.3, 40px rock 10.5, 15px
     *     glass chip 3.9, 8px chip 2.3 — under DV_MIN, so it is silent.
     *   · A HEAVIER SHIP shrugs off hits, because player mass scales with
     *     ship weight (SHIP_WEIGHT).  Free, and it ties the camera to the
     *     outfitting system.
     *
     * DV_MIN is the old `impactSpeed > 2.0` threshold expressed in the new
     * units: for a wall dv = 1.5 * v_n, so 3.0 is exactly v_n > 2. */
    IMPACT_DV_MIN: 3.0,    // below this the hit is not felt at all
    IMPACT_DV_SCALE: 1.0,  // shake per unit of player velocity change
    IMPACT_MAX: 30,        // = the old min(speed, HEAVY) * CAP_MULTIPLIER cap

    /* ── DIRECTION ──────────────────────────────────────────────────────
     * A directional shake is a decaying OSCILLATION along the impact axis,
     * not white noise: the camera lurches the way the ship was actually
     * shoved and rings back.  `DIR_JITTER` keeps a little isotropic noise on
     * top so it does not read as a mechanical slide, and `DIR_FREQ_HZ` is
     * the ring rate over the SHAKE_DECAY window (~3 cycles at 0.3 s).
     * Shakes with no meaningful direction — explosions, warp-ins, wave
     * banners — pass none and keep the old isotropic jitter. */
    DIR_FREQ_HZ: 11,
    DIR_JITTER: 0.35,
  }
};

export const UI_CONSTANTS = {
  // Beat between the WRECK finishing and the run-summary screen appearing
  // (seconds).  The same reward-moment pacing as the boss capstone's
  // BOSS_CONSTANTS.STAGE_CLEAR_DELAY_SEC, applied to the player's own death:
  // let the kill land — explosion, debris, the field still fighting — before
  // a menu takes the screen.  Unlike every other full-screen overlay, the sim
  // does NOT freeze through this beat OR through the screen that follows it,
  // so the map behind stays alive; the overlay then FADES in rather than
  // snapping.  Sits on top of EXPLOSION_CONSTANTS.DURATION, not inside it.
  DEATH_SCREEN_DELAY_SEC: 1.6,
  HEALTH_BAR: {
    PLAYER_WIDTH: 44, PLAYER_HEIGHT: 5,
    ENEMY_WIDTH: 22, ENEMY_HEIGHT: 3,
    OFFSET_MODIFIER: 0.85, // Multiplier of entity size
    OFFSET_BASE: 10, // Pixel padding
    /** DAMAGE-TRIGGERED VISIBILITY (gauntlet 5d, U5 — parking-lot item).
     *
     *  A bar is a HIT REACTION, not a permanent label.  Every enemy used to
     *  carry one every frame, at full health and on one-shot trash alike,
     *  which read as "tracked HUD" for entities the player has no reason to
     *  track.  Now a bar appears when the entity takes damage and fades out
     *  again, so the bars on screen are exactly the fights in progress.
     *
     *  SHOW_DURATION is long enough to read a bar after a hit lands and
     *  still be there for the follow-up shot; FADE_DURATION is the tail of
     *  it, so the bar dissolves rather than blinking out. */
    SHOW_DURATION: 2.2,
    FADE_DURATION: 0.7,
  },
  // Off-screen indicators.  Arrows ride the SCREEN EDGE (an inset viewport
  // rect) rather than a fixed centre ring, and their SIZE carries distance:
  // a closing threat grows, a far straggler shrinks to a small tick.  That
  // is what lets the whole layer be smaller than the old fixed-size ring
  // while reading MORE clearly — proximity is in the glyph, not in a number.
  //
  // Colour is BY TYPE, never the entity's own colour (user call): one look
  // tells you what a contact IS.  A rival or a bubble that is hunting the
  // PLAYER blinks red on top of its type colour — those two are the only
  // contacts whose hostility is conditional, so the blink is exactly the
  // "it's coming for you" signal.
  INDICATORS: {
    EDGE_INSET: 26,          // px in from the viewport edge the arrows ride
    /** HUD SAFE BANDS (user call).  The arrows ride an inset viewport rect,
     *  and that rect used to be SYMMETRIC — so an arrow at a near-vertical
     *  bearing parked itself exactly under the top chip stack or behind the
     *  loadout strip / minimap, which is where a contact directly ahead or
     *  directly behind the ship always is.  The one bearing you most need
     *  the arrow for was the one it hid on.
     *
     *  These reserve the two bands the HUD actually occupies, so the rect is
     *  asymmetric: the top edge drops below the readout chips, the bottom
     *  edge lifts above the loadout strip.  They are DELIBERATELY constants
     *  rather than a measurement of the live DOM — the alternative is the
     *  canvas layer reading React's layout every frame, and the bands only
     *  change when the HUD is redesigned. */
    /*  MEASURED, not guessed: at the 390x844 design target the top stack
     *  (vitals chip on the left; score / salvage / wave chips on the right)
     *  bottoms out at y=118 with the HUD's 8px padding, and the bottom
     *  furniture (minimap at 75px, loadout slots at 48px, both on an 8px
     *  baseline) tops out at y=H-83.  These are those numbers less the
     *  EDGE_INSET the rect already carries. */
    /*  Each band is the measured widget height PLUS ~SIZE_NEAR, because an
     *  arrow is CENTRED on the rect edge: a rect that merely reaches the
     *  bottom of the chips leaves the top half of every arrow tangent to
     *  them. */
    TOP_INSET: 40,           // px reserved for the top readout row
    BOSS_BAR_INSET: 62,      // ...plus this while a capstone bar is up
    BOTTOM_INSET: 74,        // px reserved for the loadout strip + minimap
    /*  Below this width the readout row can no longer fit on one line and
     *  WRAPS, so the band it occupies grows with it (measured: 50px -> 84px
     *  at 320).  A width threshold rather than a DOM measurement, for the
     *  same reason the rest of this block is one. */
    NARROW_WIDTH: 372,
    WRAP_INSET: 36,
    /** Never let the two bands close up on a short window — a landscape
     *  phone is ~390px tall and would otherwise be left with no rect at
     *  all.  Below this the bands give way and the arrows ride a thin
     *  centre band instead of vanishing. */
    MIN_BAND: 90,
    TEXT_THRESHOLD_POI: 160000,
    MAX_VISIBLE: 5, // Max arrows for POIs
    // Enemy chevrons are range-unlimited (maps are big and live wave
    // enemies are capped at TIMED_WAVE_CONFIG.MAX_CONCURRENT_ENEMIES),
    // so every live enemy is always findable.  The cap here only guards
    // pathological counts; alpha fades with distance to a floor so far
    // chevrons read as "out there" without shouting.  The budget keeps the
    // NEAREST contacts (renderIndicators selects nearest-first).
    MAX_VISIBLE_ENEMY: 12,
    // Ambient bubbles get their own small budget: they are fauna, not wave
    // threats, so a bloom of them must never crowd out the enemy arrows.
    MAX_VISIBLE_BUBBLE: 4,
    ENEMY_FADE_START: 800,   // world units — full opacity inside this
    ENEMY_FADE_END: 4000,    // world units — alpha floor from here out
    ENEMY_MIN_ALPHA: 0.35,
    // Proximity size ramp — the arrow's half-length in px, interpolated on
    // distance.  NEAR is deliberately close to the old fixed size and FAR is
    // roughly half of it, so a screen full of distant contacts costs far less
    // real estate than before while a closing one is MORE prominent.
    SIZE_NEAR: 11,           // px at/inside NEAR_DIST
    SIZE_FAR: 5,             // px at/beyond FAR_DIST
    NEAR_DIST: 350,          // world units
    FAR_DIST: 3500,          // world units
    BOSS_SCALE: 1.7,         // boss arrows stay oversized (never lose the boss)
    AGGRO_BLINK_HZ: 2.5,     // red-blink rate for a rival/bubble hunting you
    // Type → colour.  Bosses share the enemy red; their SIZE and self-label
    // are what set them apart, so the palette stays a clean type legend.
    COLORS: {
      ENEMY:   '#ef4444',    // red-500
      STATION: '#6366f1',    // indigo-500
      PORTAL:  '#22c55e',    // green-500
      RIVAL:   '#eab308',    // yellow-500
      BUBBLE:  '#a855f7',    // purple-500
      AGGRO:   '#ef4444',    // blink colour for a provoked rival / bubble
      OTHER:   '#94a3b8',    // slate-400 — any POI without a type of its own
    },
  },

  /**
   * The CANVAS HUD's own vocabulary (gauntlet 5d, U3 — audit findings
   * E3/E4).
   *
   * The DOM overlay names its type scale and its greys in
   * `components/UIOverlay.tsx`; the canvas layer had neither, so its sizes
   * were picked independently per draw site (8 / 9 / 11 / 14 px) and its
   * greys were hardcoded hex at the point of use (`#475569`, `#64748b`,
   * `#cbd5e1`, `#e2e8f0`, `#22d3ee`, `#fde047`, `#fca5a5`).  These are the
   * same slate family the DOM uses, stated once.
   *
   * NOTE ON THE COLOUR LEGEND: `INDICATORS.COLORS` above is THE type-colour
   * palette — what a contact IS, wherever it is drawn (edge arrow, minimap
   * blip).  This block is the CHROME palette — text, rules and affordances,
   * which carry no type meaning.  The two never overlap, and nothing in the
   * canvas layer should introduce a third.
   */
  HUD: {
    /** Type scale, mirroring the DOM's four named steps.  Canvas HUD text is
     *  monospace by house style — that is a world-vs-chrome distinction and
     *  is deliberate — but the SIZES are now the same set. */
    TEXT: {
      MICRO: 9,   // indicator labels, slot numbers, the empty-slot tag
      BODY:  11,  // player messages, the interaction prompt
      ROW:   12,  // loadout weapon names at full slot width
      LOUD:  14,  // floating damage / points text
    },
    /** Chrome greys, brightest to dimmest.  `TEXT` is body copy on glass,
     *  `MUTED` is a secondary readout, `DIM` is a disabled or empty state,
     *  `RULE` is a hairline or dashed outline. */
    TEXT_COLOR:  '#e2e8f0',   // slate-200
    MUTED_COLOR: '#cbd5e1',   // slate-300
    DIM_COLOR:   '#64748b',   // slate-500
    RULE_COLOR:  '#475569',   // slate-600
    /** Fill behind an inactive HUD widget (the resting loadout slot) — the
     *  same slate-800 the DOM's panels use. */
    PANEL_FILL:  '#1e293b',   // slate-800
    /** The outline every string on the canvas wears so it survives arbitrary
     *  bright terrain underneath.  One width, one alpha. */
    OUTLINE: 'rgba(0,0,0,0.85)',
    OUTLINE_WIDTH: 3,
    /** ACCENTS.  Cyan is the HUD's "supporting information" colour (banner
     *  subtext); the charge pair is the ship's charge ring read back on the
     *  fire button, so the two must stay identical. */
    ACCENT_COLOR: '#22d3ee',   // cyan-400
    CHARGE_FULL:  '#fde047',   // yellow-300 — charge complete
    CHARGE_PART:  '#fca5a5',   // red-300 — charge winding up
  },
};

// 2-slot loadout HUD (pivot 1b — replaced the 8-cell ammo strip).  Two wide
// slots showing the equipped weapons; the active slot is highlighted.  The
// charge ring stays on the player ship (chargeProgress), not here.
export const LOADOUT_HUD_CONSTANTS = {
  SLOT_W_MAX:    120,
  SLOT_W_MIN:    64,
  SLOT_H:        48,
  SLOT_GAP:      8,
  SLOT_RADIUS:   5,
  // Hugs the bottom edge (user call: "collapse the hud elements more to the
  // top and bottom of the screen").  This is also the minimap's bottom
  // offset — computeMinimapRect reads it — so the two bottom widgets sit on
  // one baseline by construction rather than by two matching numbers.
  BOTTOM_MARGIN: 8,
};

export const MINIMAP_CONSTANTS = {
  SIZE: 75,            // Smaller Default
  EXPANDED_SIZE: 280,  // Larger when touched
  MARGIN: 10,          // Distance from screen edge (hugs the corner — user call)
  ZOOM_RANGE: 1000,    // World units radius shown in small (zoomed-in) minimap
  RANGE: 8000,         // World units radius shown in expanded (overview) map
  // More transparent than a DOM panel on purpose (user call): the map sits
  // ON the world and the world should read through it.  The blips and the
  // static terrain layer draw at full strength on top, so legibility comes
  // from the marks rather than from hiding what is behind them.
  BG_COLOR: 'rgba(15, 23, 42, 0.55)',
  BORDER_COLOR: 'rgba(56, 189, 248, 0.30)',
  PLAYER_DOT_COLOR: '#ffffff',
  VIEWPORT_COLOR: 'rgba(56, 189, 248, 0.25)',
  VIEWPORT_BORDER_COLOR: 'rgba(56, 189, 248, 0.8)',
  // Boosted enemy blips: bigger pulsing dots, and enemies beyond the
  // minimap range clamp to the border (slightly dimmer) instead of
  // disappearing, so a distant straggler still registers at a glance.
  ENEMY_BLIP: {
    RADIUS: 3,
    EDGE_INSET: 4,        // px inside the minimap border for clamped blips
    PULSE_HZ: 1.5,        // pulse cycles per second
    PULSE_MIN_ALPHA: 0.55,
    CLAMPED_ALPHA_MULT: 0.75,
  },
  // Portal blips read as ANOMALIES, not dots.  A portal's chevron is
  // range-gated (PORTAL_CONSTANTS.INDICATOR_RANGE), so the minimap is now
  // the primary way to FIND one — which means a portal must (a) never be
  // culled for being out of range, and (b) be instantly distinguishable
  // from the station / POI dots it sits among.  So: a rotated-square
  // contact with a radar ping expanding out of it, clamped to the border
  // like an enemy blip when it is off-range rather than disappearing.
  // Boss blips ((h) capstones).  A boss is THE priority contact on a wave
  // map, so it reads as a ringed target rather than another enemy dot —
  // same clamp-instead-of-cull rule as an enemy blip, but bigger, with a
  // slow targeting ring so it is findable at a glance on a 75px minimap.
  BOSS_BLIP: {
    RADIUS: 4.5,
    RING_RADIUS: 8,
    RING_WIDTH: 1.2,
    RING_ALPHA: 0.75,
    PULSE_HZ: 1.0,        // slower than the enemy pulse — a heartbeat, not an alarm
    PULSE_MIN_ALPHA: 0.7,
    EDGE_INSET: 6,
    CLAMPED_ALPHA_MULT: 0.85,
  },
  PORTAL_BLIP: {
    RADIUS: 4.5,          // half-diagonal of the diamond contact
    CORE_RADIUS: 1.1,     // bright centre pip — kept small so the coloured
                          // fill still reads (the fill is what distinguishes
                          // an outbound rift from a return one)
    OUTLINE_ALPHA: 0.5,   // white edge: enough to crisp the shape against the
                          // dark map, not enough to wash the fill out
    OUTLINE_WIDTH: 0.9,
    EDGE_INSET: 5,        // px inside the minimap border when clamped
    PULSE_HZ: 0.8,        // slow sweep — reads as a beacon, not an alarm
    RING_MIN: 4,          // ping ring start radius (px)
    RING_MAX: 11,         // ping ring end radius (px)
    RING_ALPHA: 0.55,     // ring alpha at the start of a ping (fades to 0)
    CLAMPED_ALPHA_MULT: 0.8,
    SPIN_HZ: 0.15,        // slow rotation of the diamond
  },
  // Stations are the only BUILT contact on the map — fixed, safe, and not
  // alive.  A square says all of that before the colour does, and it is the
  // only rectilinear mark among dots and diamonds.
  STATION_BLIP: {
    HALF: 3,
    OUTLINE_ALPHA: 0.55,
    OUTLINE_WIDTH: 0.9,
  },
  // ── Material flow layer (decision #43, G5) ────────────────────────────
  // Short streamlines traced through the asteroid flow field, replacing the
  // per-shard dot spray.  A dot per shard answers "where is every rock",
  // which at a few thousand shards is a grey wash; the field answers "which
  // way is the material going", which is the only thing the map can usefully
  // say about material it cannot draw individually.
  //
  // Seeds sit on a WORLD-space lattice whose spacing scales with the shown
  // range, so the same count is drawn zoomed in and zoomed out (49 lines), and
  // they are world-ANCHORED: the pattern slides under the moving window rather
  // than being painted onto the glass.
  FLOW: {
    /** Lattice seeds each side of centre → (2n+1)² lines in view. */
    SEEDS_PER_HALF: 4,
    /** Integration steps per streamline (segments = STEPS). */
    STEPS: 6,
    /** Step length as a fraction of the lattice spacing.  The product
     *  (STEPS × STEP_FRAC ≈ 0.84 of one cell) is the number that matters: a
     *  line must be SHORTER than the gap between seeds, or the strokes run
     *  into each other and the layer reads as long chords crossing the map
     *  rather than as a field of local currents.  The first version used
     *  2.2 cells and looked exactly that wrong when the map was expanded. */
    STEP_FRAC: 0.14,
    COLOR: '#64748b',
    ALPHA: 0.34,
    WIDTH: 1,
    /** A brighter pulse travels each line downstream — the part that says
     *  which WAY, and the reason this beats a static hatch. */
    PULSE_ALPHA: 0.85,
    PULSE_WIDTH: 1.8,
    PULSE_HZ: 0.28,
    /** Lines shorter than this (px, end to end) are dropped: in a dead-calm
     *  cell the streamline collapses to a smudge that reads as noise. */
    MIN_PX: 3,
  },
};

export const INPUT_CONSTANTS = {
  // Tap/click radius (CSS px) around the player's SHIP that counts as
  // "selecting" it to use an in-range station or portal.  Generous enough for
  // a thumb on glass, and only ever consulted while something IS in range —
  // outside that, a tap on the ship is just a shot.
  SHIP_SELECT_RADIUS: 46,
  // Charge-to-fire model (post-d2): tap (release before CHARGE_FULL) =
  // normal shot via fireEvents; hold for the full CHARGE_FULL duration
  // and release = charged shot via chargeReleaseEvents.  The ring HUD
  // fills 0 → 1 over the same window so the player only sees a charged
  // shot land when the ring is visibly complete.  Same TAP_DISTANCE_LIMIT
  // applies to the tap path — dragging the cursor cancels a tap.
  CHARGE_FULL: 1.0,        // seconds: hold time required for a charged shot AND for the ring to read "full"
  TAP_DISTANCE_LIMIT: 20,  // px: max finger travel for a tap to register
  THROTTLE_DISTANCE: 150,  // px from screen center that maps to full throttle (1.0)

  // ── Gamepad rumble ─────────────────────────────────────────────────────
  // Force feedback rides the SCREEN SHAKE.  Every impact in the game already
  // funnels through `GameEngine.handleScreenShake(amount)` — crashes,
  // explosions, cannon recoil, boss deaths — with magnitudes long since tuned
  // against each other.  Rumble is the haptic twin of that shake, so it hangs
  // off the same call rather than growing a second list of "things that should
  // buzz" to keep in sync with the first.
  //
  // `dual-rumble` is the only effect the Gamepad API exposes: two magnitudes,
  // a strong low-frequency motor and a weak high-frequency one.  The
  // DualSense's real party tricks — adaptive trigger resistance, the
  // voice-coil haptics, the light bar — need raw HID reports (WebHID), which
  // is a desktop-Chromium-only path and deliberately not what this drives.
  RUMBLE: {
    /** Shake amounts below this do not buzz.  Set to MICRO (1) — the
     *  smallest thing the game emits — on user direction: shard pings,
     *  blaster shots and tier-1 kills should all TICK.  The first version
     *  cut them off at 4 on the theory that a pad rattling on every plink is
     *  a pad you switch off; the answer turned out to be a magnitude FLOOR
     *  and a weak-motor bias instead, so the small stuff is felt as a tick
     *  rather than skipped or thumped. */
    MIN_SHAKE: 1,
    /** Shake amount that maps to full strength.  HEAVY (20) is a high-speed
     *  crash, and should be the loudest thing the hand feels. */
    FULL_SHAKE: 20,
    /** Overall magnitude at MIN_SHAKE.  A FLOOR, not zero: the curve used to
     *  start at 0, which meant the smallest qualifying event played a
     *  correctly-timed effect at zero strength — silence, dressed up as a
     *  feature.  Anything worth playing is worth feeling. */
    MIN_MAGNITUDE: 0.14,
    /** Effect length in ms at MIN_SHAKE and at FULL_SHAKE.  Short at the
     *  bottom: a tick, not a buzz. */
    MIN_MS: 45,
    MAX_MS: 260,
    /** The two motors are different instruments — strong is a low-frequency
     *  THUMP, weak a high-frequency BUZZ — so the balance crossfades with
     *  magnitude instead of being fixed.  A blaster shot is nearly all buzz
     *  (STRONG_AT_MIN of the heavy motor); a crash is nearly all thump, with
     *  WEAK_AT_MAX of high-frequency edge left on top so it still has a
     *  transient. */
    STRONG_AT_MIN: 0.25,
    WEAK_AT_MAX: 0.55,
    /** Trigger-motor force, as a multiplier on the effect's overall
     *  magnitude.  A trigger has a far shorter throw than a handle motor, so
     *  the same number reads weaker there.  Clamped to 1 at the top. */
    TRIGGER_FORCE_MULT: 1.6,
    /** Haptic-only tick for a weapon whose recoil deliberately shakes NO
     *  camera — the plain Blaster.  Screen shake on every shot of the
     *  fastest gun in the game would be unplayable; a tick in the hand is
     *  exactly what the shake funnel cannot express. */
    WEAPON_TICK: 2,
    /** Floor on the gap between effects (ms).  playEffect restarts the motors,
     *  so firing one per frame produces a flat drone instead of hits; a new
     *  effect interrupts early ONLY if it is meaningfully stronger. */
    MIN_INTERVAL_MS: 70,
    /** How much stronger a new event must be to interrupt one already
     *  playing (0.15 = 15 percentage points of magnitude). */
    INTERRUPT_DELTA: 0.15,
  },

  // ── Fire button (joystick scheme) ──────────────────────────────────────
  // The joystick scheme's shooting control.  Tap-to-shoot is the STANDARD
  // touch scheme's gesture; a scheme whose left thumb is pinned to a stick
  // needs a thing to press with the right one, and a tap that both aims and
  // fires cannot coexist with a thumb that is dragging to aim.
  //
  // Parked above the loadout strip on the right, mirroring the joystick's
  // side.  Its own rect is excluded from the aim gesture, so pressing it
  // never yanks the aim to the corner.
  FIRE_BUTTON: {
    RADIUS: 38,
    /** px in from the button's OWN edge to its centre — the right edge in the
     *  left-handed layout, the left edge in the mirrored one. */
    MARGIN_X: 58,
    /** px from the bottom edge to the button's CENTRE.  Clears the loadout
     *  strip (SLOT_H + BOTTOM_MARGIN = 62) with a comfortable gap. */
    MARGIN_Y: 110,
    /** ...but on the LEFT the minimap is already there (MARGIN 20 + SIZE 75
     *  up from the bottom), so the mirrored layout sits the button higher
     *  rather than on top of it. */
    MARGIN_Y_MIRRORED: 150,
    IDLE_ALPHA: 0.20,
    PRESSED_ALPHA: 0.42,
    COLOR: '#f87171',
  },

  // ── Onscreen joystick (Pair C, c2 second half) ─────────────────────────
  // A FLOATING left-thumb stick: it has no fixed home, it appears wherever
  // the thumb lands inside the zone below.  Floating rather than parked
  // because the bottom-left corner is already the minimap's, and a fixed
  // stick would either fight it or sit somewhere a thumb cannot reach.
  //
  // The zone is what keeps the stick from stealing the gestures that were
  // already there: it excludes the top strip (HUD chips), the bottom strip
  // (minimap + loadout slots, both tap targets), the RIGHT half entirely
  // (aim and fire), and a disc around the ship (the dock / portal tap).
  JOYSTICK: {
    /** Left fraction of the viewport in which a touch can become the stick. */
    ZONE_W_FRAC: 0.45,
    /** Top of the zone, as a fraction of height — above it are the HUD chips. */
    ZONE_TOP_FRAC: 0.30,
    /** Bottom of the zone, px up from the bottom edge.  Covers the collapsed
     *  minimap (MARGIN + SIZE) and the loadout strip; the EXPANDED minimap is
     *  handled dynamically instead, since its rect changes at runtime. */
    ZONE_BOTTOM_PX: 100,
    /** Deflection (px) from the touch origin that means full throttle. */
    RADIUS: 56,
    /** Below this the stick reads as centred — kills thumb tremor without
     *  eating a real nudge. */
    DEAD_PX: 6,
    KNOB_RADIUS: 22,
    RING_ALPHA: 0.22,
    KNOB_ALPHA: 0.40,
    /** Seconds the widget takes to fade after the thumb lifts.  It exists
     *  only while a touch session is live — there is no ghost stick sitting
     *  under a mouse or a pad. */
    FADE_SEC: 0.22,
    COLOR: '#7dd3fc',
  },

  // ── Gamepad (Pair C, c2) ───────────────────────────────────────────────
  // The pad is a THIRD input device beside keyboard/mouse and touch, not a
  // replacement for either: it feeds the SAME movement vector, the same
  // synthetic pointer the mouse writes, and the same fire/charge queues, so
  // nothing downstream of InputSystem knows a pad exists.
  //
  // BUTTON INDICES are the W3C "standard gamepad" mapping, which is what a
  // DualSense reports over both USB and Bluetooth (and what an Xbox pad
  // reports too — the labels below are the PS5 names for the same indices).
  // Every action lists ALL the buttons bound to it: a face button and a
  // shoulder/trigger where the choice is a matter of taste, so neither
  // convention is wrong on this pad.
  GAMEPAD: {
    /** Radial stick deadzone, applied to the MAGNITUDE and then rescaled so
     *  the live range is still a full 0→1 (a raw clamp would make the first
     *  usable deflection jump to 0.18). Sticks rest noisily; drift under this
     *  is not input. Provisional — feel number, wants a real pad. */
    STICK_DEADZONE: 0.18,
    /** Analogue triggers report 0→1 on their button `value`; over this counts
     *  as pressed. High enough that a resting finger is not a shot. */
    TRIGGER_THRESHOLD: 0.35,
    /** Band the trigger's FIRE POINT is clamped into.  The fire point tracks
     *  the adaptive-trigger profile's break — that is what makes the clutch
     *  giving way and the gun going off the same event — but the SAME number
     *  has to feel right on a pad with no WebHID and therefore no physical
     *  cue, so no profile may push the shot into the last sliver of travel
     *  (unreachable-feeling) or the first (fires as the trigger leaves rest,
     *  which is the bug this band exists to prevent recurring). */
    FIRE_POINT_MIN: 0.25,
    FIRE_POINT_MAX: 0.75,
    /** Distance (CSS px) from screen centre at which the pad parks its
     *  synthetic pointer. Matches THROTTLE_DISTANCE so the aim reticle sits
     *  where a mouse at full throttle would, and — load-bearing — is well
     *  outside SHIP_SELECT_RADIUS, so a pad shot can never be mistaken for a
     *  tap on the ship and swallowed by `claimTapNear`. */
    AIM_RADIUS: 150,
    /** Seconds the connect/disconnect HUD hint stays up. */
    HINT_LIFETIME: 3.0,
    AXES: { LX: 0, LY: 1, RX: 2, RY: 3 },
    BUTTONS: {
      FIRE:         [7, 0],   // R2, Cross — tap = shot, hold ≥ CHARGE_FULL = charged
      /** FIRE under the trigger-thrust scheme.  R2 drops out because BOTH
       *  triggers are the throttle there — a minimal pad may only have one,
       *  and which one it is cannot be detected, so neither can be the gun.
       *  The face button covers it, which is what a one-stick pad has. */
      FIRE_FACE:    [0],
      INTERACT:     [2],      // Square — dock / enter portal / undock (the `selected` flag)
      CYCLE_WEAPON: [5, 3],   // R1, Triangle
      PAUSE:        [9],      // Options
      DPAD:         [12, 13, 14, 15], // up, down, left, right — digital thrust
      /** THROTTLE under `gamepad-thrust`: EITHER trigger, whichever is
       *  pulled further.  A pad with only a left trigger and a pad with only
       *  a right one both work, and there is no device sniffing involved —
       *  the trigger that is not there simply reads zero forever. */
      THROTTLE:     [6, 7],   // L2, R2
      // MENU navigation.  These reuse buttons that are already bound in
      // flight, which is safe because they are only ever SPENT while a
      // full-screen overlay is up and the world is frozen: Cross cannot fire
      // (the FIRE queue is gated on the world) and the D-pad cannot thrust.
      CONFIRM:      [0],      // Cross — activate the focused control
      BACK:         [1],      // Circle — dismiss / resume / undock
    },
    /** Menu D-pad auto-repeat: the first step is immediate, then a held
     *  direction waits DELAY before repeating every INTERVAL.  Without the
     *  delay a single press walks several items; without the repeat, a long
     *  list is a lot of presses. */
    MENU_REPEAT_DELAY_MS: 420,
    MENU_REPEAT_INTERVAL_MS: 110,
    /** Below this the throttle reads as released, so a trigger that rests a
     *  hair off zero does not creep the ship forward. */
    THROTTLE_DEADZONE: 0.06,
  },
};

export const PHYSICS_CONSTANTS = {
  FRICTION: 0.999, // Fallback default
  ACCELERATION: 0.02, // Fallback default (Reduced from 0.04)
  MAX_SPEED: 15,
  PLAYER_MASS: 100, // Heavier player = less recoil
  RECOIL_FORCE: 0 // Legacy, unused now that mass is implemented
};

// ─── Fixed-timestep simulation ───────────────────────────────────────────────
// Engine upgrade Phase 1: the simulation (physics/AI/game logic) now runs at a
// fixed timestep independent of frame rate so gameplay is deterministic across
// devices.  We use 1/120 s instead of the spec's example 1/60 s so that on a
// 60 Hz display every frame reliably runs exactly 2 sim steps and on a 120 Hz
// display every frame runs exactly 1 — the divisibility avoids the 1-vs-2
// alternation that caused visual jitter in the prior 1/60 accumulator attempt.
export const SIMULATION_CONSTANTS = {
  FIXED_DT: 1 / 120,       // Deterministic simulation timestep (seconds)
  MAX_SUBSTEPS: 5,         // Spiral-of-death clamp: max sim steps per rendered frame
  MAX_FRAME_TIME: 0.25,    // Safety clamp on raw frame delta before accumulating (s)
  /** Frame-delta snapping tolerance, as a FRACTION of one sim step.
   *
   *  This is what makes a 60 Hz sim rate viable at all.  The comment above
   *  records why 1/60 was rejected the first time: on a 60 Hz display the
   *  accumulator drifts a hair either side of exactly one step, so frames
   *  alternate 1-step / 2-step and the world visibly judders.  Snapping the
   *  frame delta to the nearest whole number of steps when it lands within
   *  this tolerance removes the alternation at its source — a standard
   *  fixed-timestep technique, and cheaper than the divisibility trick it
   *  replaces.  At the 120 Hz default it is a no-op in practice (a 60 Hz
   *  frame is already almost exactly 2 steps), so it cannot regress the
   *  shipping path.  0.25 = snap when within a quarter-step. */
  VSYNC_SNAP_FRACTION: 0.25,
};

// ─── DBG: simulation rate (gauntlet 5c follow-up) ────────────────────────────
//
// The sim rate is the single largest lever on sim cost that exists: at 120 Hz
// a 60 fps frame pays for TWO full sim steps, so every millisecond of sim work
// is doubled by this one number.  60 Hz is the industry-mainstream rate (Unity
// ships 50, Box2D recommends 60); 120 is on the high end, reserved for
// sub-frame precision.
//
// It is exposed as a DBG cycle rather than simply lowered because dropping it
// is a TRADE, not a free win: collision resolution is iterative, so half the
// steps means half the passes untangling a dense shard pile, and the shard
// fields will settle differently.  That is a FEEL judgement and belongs to the
// player, not to a perf measurement.
//
// 120 is index 0 and stays the default, so the shipping path is unchanged.

/** Max static-tile cache stamps allowed in ONE render frame.
 *
 *  The static-tile layer stamps tiles into a map-sized offscreen canvas
 *  lazily, and the loop had no budget: whenever a lot of tiles became
 *  cacheable at once — the hex sprite finishing loading after map build, or
 *  a wave of tile regen — every one of them stamped in a single frame.  A
 *  device capture (Ring World, 2026-08-09) caught it twice: `render 45.00`
 *  at 12.6s with 1357 entities, and `render 40.00` at 29.9s, against a
 *  1.41ms average.  Those were the only frames all session where OUR render
 *  was the spike.
 *
 *  Capping is visually identical rather than a trade: a tile that does not
 *  get its stamp this frame simply renders through the normal per-entity
 *  path, which is exactly what it does today until it is stamped.  Only the
 *  cache WARM-UP spreads out — at 24/frame a full map catches up in well
 *  under a second. */
export const STATIC_TILE_STAMPS_PER_FRAME = 24;

// ─── DBG: substep cap (frame-pacing) ─────────────────────────────────────────
//
// MAX_SUBSTEPS is the spiral-of-death clamp, but set too HIGH it feeds the
// spiral instead of stopping it.  A device capture (Seven Rings, 3359
// entities, 2026-08-09) showed every worst frame pegged at steps = 5 with
// sim = 36-44ms of a 56-60ms frame: the frame ran long, the accumulator
// pulled in more substeps, those substeps made the frame longer still.
// Positive feedback.
//
// A 60fps display with a 120Hz sim only NEEDS 2 substeps per frame; 5 allows
// 2.5x real-time catch-up, and that headroom is what let one slow frame
// snowball.  Capping lower converts a judder into a brief, smooth
// slow-motion — and the engine ALREADY discards the excess time at the clamp
// (`simAccumulator %= FIXED_DT`), so that cost is being paid either way; the
// cap only decides at what point it is paid.
//
// Values are the cap at the 120Hz baseline; getMaxSubsteps() rescales them
// for the active sim rate.  5 is index 0 and stays the default.
export const SUBSTEP_CAP_CYCLE: ReadonlyArray<number> = [5, 3, 2] as const;
let activeSubstepCapIndex = 0;
export function getActiveSubstepCap(): number { return SUBSTEP_CAP_CYCLE[activeSubstepCapIndex]; }
export function getActiveSubstepCapName(): string { return `${SUBSTEP_CAP_CYCLE[activeSubstepCapIndex]}`; }
export function cycleSubstepCap(): number {
  activeSubstepCapIndex = (activeSubstepCapIndex + 1) % SUBSTEP_CAP_CYCLE.length;
  return SUBSTEP_CAP_CYCLE[activeSubstepCapIndex];
}

// ─── DBG: render scale (device-pixel-ratio cap) ──────────────────────────────
//
// The canvas backing store is sized by devicePixelRatio, and on an iPhone that
// is 3 — so a 440x756 viewport rasterises ~3.0 MILLION pixels every frame, with
// a lot of `globalCompositeOperation = 'lighter'` and radial gradients on top.
//
// That fill-rate cost is invisible to every timer in this engine: `renderMs`
// measures the time our JS spends ISSUING canvas calls, while the actual
// rasterisation and compositing happen in the browser compositor after the rAF
// callback returns.  Device captures (2026-08-09) showed frames of 35-38ms
// carrying 0-1ms render and 0-2ms sim — one of them with the engine doing
// literally nothing — so the whole cost is outside our JS, and fill rate is the
// leading candidate.
//
// Capping the ratio at 2 cuts the pixel count by ~2.3x (3.0M -> 1.3M).  It is a
// SHARPNESS trade, which is why it is a toggle and not an edit: 3 is index 0
// and stays the default until someone chooses otherwise.
// 2 IS THE DEFAULT (user call, 2026-08-09, on the evidence below).  Measured
// on Ring World against an otherwise identical 3x run: worst frame 81ms ->
// 27ms, p99 36 -> 23ms, 1%-low 28 -> 43fps, min 12 -> 37fps, and the
// unattributed `other` term — the one that had resisted every other fix this
// session — fell from 47-78ms to 20-25ms.  That is the single largest
// smoothness result of the gauntlet, and it confirms `other` was compositing.
// 3x remains one tap away in the cycle.
export const RENDER_SCALE_CYCLE: ReadonlyArray<number> = [2, 3, 1.5] as const;
let activeRenderScaleIndex = 0;
export function getActiveRenderScaleCap(): number { return RENDER_SCALE_CYCLE[activeRenderScaleIndex]; }
export function getActiveRenderScaleName(): string {
  const cap = RENDER_SCALE_CYCLE[activeRenderScaleIndex];
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return dpr <= cap ? `${cap}x (native)` : `${cap}x`;
}
/** The device pixel ratio ACTUALLY in use, after the cap.  Every site that
 *  converts between canvas pixels and CSS pixels must read this, not
 *  `window.devicePixelRatio` — mixing the two makes the renderer compute a
 *  logical viewport that does not match the canvas it is drawing into. */
export function effectiveDpr(): number {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cap = RENDER_SCALE_CYCLE[activeRenderScaleIndex];
  return dpr < cap ? dpr : cap;
}
export function cycleRenderScale(): number {
  activeRenderScaleIndex = (activeRenderScaleIndex + 1) % RENDER_SCALE_CYCLE.length;
  return RENDER_SCALE_CYCLE[activeRenderScaleIndex];
}

// ─── DBG: unified tile lighting ──────────────────────────────────────────────
//
// The mode toggle for the lighting gauntlet (docs/GAUNTLET_LIGHTING_LOG.md).
//
// Index 0 is `'legacy'`, and it is named for what it IS rather than "off":
// Omni is not a game without lighting.  It ships THREE hand-rolled lighting
// approximations that have drifted apart — the player-distance proximity
// bloom on rock / plastic / indestructible tiles, the repel-impulse glow on
// glass and metal, and the glass edge tint on its own hardcoded 120 range.
// `'legacy'` is those three, unchanged, and it is the default: the unified
// system has to earn its place against them, not be assumed to replace them.
//
//   legacy  — the three shipped models, untouched.  lightingMs reads 0.
//   debug   — the light layer is built and blitted, but paints a flat grey.
//             Proves the canvas, its sizing, the blit and the
//             imageSmoothingEnabled restore, with no lighting maths in the
//             way of reading the cost.
//   unified — the real shadow-cast lighting.
export const LIGHTING_CYCLE = ['legacy', 'debug', 'unified'] as const;
export type LightingMode = typeof LIGHTING_CYCLE[number];
/** SHIPPED DEFAULT: `unified` (user call, after device confirmation).
 *
 *  `legacy` was the default while the layer was being built, because a stage
 *  that cannot be switched back off is not a stage.  That property has not
 *  gone anywhere — `legacy` still allocates no canvas, draws nothing and
 *  leaves `lightingMs` at 0, and `tests/lighting.spec.ts` pins exactly that.
 *  It is simply no longer the thing you get without asking. */
let activeLightingIndex = LIGHTING_CYCLE.indexOf('unified');
export function getActiveLightingMode(): LightingMode { return LIGHTING_CYCLE[activeLightingIndex]; }
export function cycleLightingMode(): LightingMode {
  activeLightingIndex = (activeLightingIndex + 1) % LIGHTING_CYCLE.length;
  return LIGHTING_CYCLE[activeLightingIndex];
}
/** Jump straight to a mode.  Exists for the harness and the tests, which
 *  need to A/B two specific modes rather than walk the cycle. */
export function setActiveLightingMode(m: LightingMode): void {
  const i = LIGHTING_CYCLE.indexOf(m);
  if (i >= 0) activeLightingIndex = i;
}

/** DBG: do MOBILE SHARDS cast shadows, as well as static tiles?
 *
 *  Its own switch rather than part of LIGHTING_CYCLE, because the question
 *  it answers is independent of "is the unified model better than the three
 *  legacy ones" and wants to be A/B'd on its own.  Only has any effect while
 *  the mode is 'unified'.
 *
 *  ON by default: shards are the same shard family as tiles and roughly the
 *  same size (measured radii 43.6 median against a tile's 22), so excluding
 *  them makes debris read as transparent to a light that the rock it broke
 *  off is not.  The reason to turn it off is cost, and the reason to keep
 *  the switch is that cost is exactly what it is for. */
let shardShadowsEnabled = true;
export function getShardShadowsEnabled(): boolean { return shardShadowsEnabled; }
export function toggleShardShadows(): boolean {
  shardShadowsEnabled = !shardShadowsEnabled;
  return shardShadowsEnabled;
}

/** DBG: REFRACTION through translucent bodies — a prototype, OFF by default.
 *
 *  The shipped translucency (`SHARD_VARIANTS[v].transmit`) sends light
 *  STRAIGHT THROUGH glass at reduced brightness.  That is the right
 *  first-order model for a parallel-faced pane — a slab offsets a ray
 *  laterally but does not deviate it, and a regular hexagon has three pairs
 *  of parallel faces — but it says nothing about a wedge-shaped shard, which
 *  is a prism.
 *
 *  ON, the transmitted light is instead BENT: each exit face refracts by
 *  Snell's law and emits an additive cone in the deviated direction, and the
 *  straight-through path is withheld in full so the energy is MOVED rather
 *  than added.  That makes the toggle a real A/B — off is a dim shadow, on
 *  is a dark shadow with a bright band beside it — instead of stacking one
 *  effect on the other and reading as "glass got brighter".
 *
 *  SHIPPED ON (user call, after device testing).  It was off while the open
 *  question — is a caustic legible at all on a light layer rendered at a
 *  third of screen resolution — was still open; the device answered yes at
 *  the brightnesses the cycle now reaches, so the prototype is the default
 *  and the toggle is what turns it off. */
/** DBG: do METAL and GLASS RE-EMIT the light that falls on them?  SHIPPED ON
 *  (user call, after device testing), and the sibling of the refraction
 *  toggle.
 *
 *  ON, every lit body whose variant carries `emits` becomes a SECOND light
 *  at its own position — dimmer by that fraction, uniform in every
 *  direction, and falling off the same way the player's does.  It replaces
 *  the legacy repel-impulse glow those two materials used to carry, which
 *  lit up on CONTACT rather than on light, so a metal plate across the room
 *  stayed dead no matter how brightly it was lit.
 *
 *  What it deliberately does NOT do is cast shadows of its own.  A second
 *  light needs a second occluder collection, and the occluder pool is
 *  shared and consumed per light (see `collectOccluders`) — so shadowing N
 *  emitters costs N full collections, on a budget that is already the
 *  tightest thing in this system.  The emitters are dim and small; the
 *  place that shows is a halo bleeding slightly through a wall. */
let emissiveEnabled = true;
export function getEmissiveEnabled(): boolean { return emissiveEnabled; }
export function toggleEmissive(): boolean {
  emissiveEnabled = !emissiveEnabled;
  return emissiveEnabled;
}

/** DBG: how much of the light it receives a body re-emits, as a fraction —
 *  the emissive sibling of "Refr bright".
 *
 *  It SCALES the variant's own `emits` against the 1/2 baseline those
 *  variants are authored at, so the default is exactly what the table says
 *  and a future variant that emits less than metal still emits less than
 *  metal.  Clamped at 1 in the geometry: a body cannot radiate more light
 *  than fell on it, which is the one physical claim this whole feature
 *  rests on. */
export const EMIT_BRIGHTNESS_CYCLE: ReadonlyArray<{ name: string; frac: number }> = [
  { name: '1/2',  frac: 0.5   },
  { name: '2/3',  frac: 0.667 },
  { name: '3/4',  frac: 0.75  },
  { name: '1/1',  frac: 1     },
  { name: '1/3',  frac: 0.333 },
  { name: '1/4',  frac: 0.25  },
  { name: '1/6',  frac: 0.167 },
  { name: '1/10', frac: 0.1   },
] as const;
/** The fraction `SHARD_VARIANTS[*].emits` is authored against, so the cycle's
 *  default is a no-op rather than a re-tuning. */
export const EMIT_BASELINE = 0.5;
let activeEmitBrightnessIndex = 0;
export function getEmitBrightness(): number {
  return EMIT_BRIGHTNESS_CYCLE[activeEmitBrightnessIndex].frac;
}
export function getEmitBrightnessName(): string {
  return EMIT_BRIGHTNESS_CYCLE[activeEmitBrightnessIndex].name;
}
export function cycleEmitBrightness(): string {
  activeEmitBrightnessIndex =
    (activeEmitBrightnessIndex + 1) % EMIT_BRIGHTNESS_CYCLE.length;
  return EMIT_BRIGHTNESS_CYCLE[activeEmitBrightnessIndex].name;
}

/** DBG: may the SECONDARY lights cast shadows of their own?  Off by default,
 *  and off for a reason that is about cost rather than correctness.
 *
 *  Each emitter that shadows needs its OWN occluder collection — the pool is
 *  shared and consumed per light — and its own compositing pass, which
 *  cannot simply be drawn onto the accumulated layer: `destination-out`
 *  would erase the light already there, not just the emitter's share.  So
 *  the shadowing path composites each emitter into a scratch canvas and
 *  blits the result, which is the honest way to do it and several times the
 *  cost of the flat halo.
 *
 *  A true TERTIARY bounce — emitters lighting other emitters — is NOT what
 *  this does, and is a different problem: it needs the emitters resolved in
 *  dependency order and re-lit, where this pass reads every emitter's
 *  brightness from the player's falloff alone. */
let emitShadowsEnabled = false;
export function getEmitShadowsEnabled(): boolean { return emitShadowsEnabled; }
export function toggleEmitShadows(): boolean {
  emitShadowsEnabled = !emitShadowsEnabled;
  return emitShadowsEnabled;
}

/** DBG: HOW MUCH shadowing the secondary lights get, when they get any.
 *
 *  A COST LADDER for the toggle above, in the same shape as `LIGHTING_TIERS`
 *  is for the primary light and for the same reason: the cost of a shadowing
 *  emitter is almost entirely its own occluder collection, so the two knobs
 *  that matter — how MANY emitters shadow, and how much geometry each of
 *  them sees — move together rather than one at a time.  Measured on the
 *  metal showcase at A5g: +1.3 ms at Low (3 emitters), +5.6 at Medium (7),
 *  +12.6 ms at High (15).  That is what a rung below the default is for.
 *
 *  Past `maxEmitters` an emitter still LIGHTS, flatly — the tier degrades
 *  the treatment, never the count, so dropping a rung dims no part of the
 *  scene.  Cycling from the default goes DOWN first: the question asked of
 *  this ladder is "can the cheap end still be seen", not "how expensive can
 *  it get". */
export const EMIT_SHADOW_TIERS: ReadonlyArray<{
  name: string; maxEmitters: number; maxOccluders: number;
}> = [
  { name: 'std',  maxEmitters: 4, maxOccluders: 12 },
  { name: 'lite', maxEmitters: 2, maxOccluders: 8  },
  { name: 'min',  maxEmitters: 1, maxOccluders: 6  },
  { name: 'more', maxEmitters: 6, maxOccluders: 12 },
  { name: 'max',  maxEmitters: 8, maxOccluders: 16 },
] as const;
let activeEmitShadowTierIndex = 0;
export function getEmitShadowTier(): { name: string; maxEmitters: number; maxOccluders: number } {
  return EMIT_SHADOW_TIERS[activeEmitShadowTierIndex];
}
export function getEmitShadowTierName(): string {
  return EMIT_SHADOW_TIERS[activeEmitShadowTierIndex].name;
}
export function cycleEmitShadowTier(): string {
  activeEmitShadowTierIndex =
    (activeEmitShadowTierIndex + 1) % EMIT_SHADOW_TIERS.length;
  return EMIT_SHADOW_TIERS[activeEmitShadowTierIndex].name;
}

/** DBG: the player's light as a DIRECTIONAL BEAM — a flashlight — instead of
 *  a radial glow.
 *
 *  The beam points along `player.rotation`, which is the AIM angle (the same
 *  one shots travel along), so the light goes where the ship is looking and
 *  needs no second control.  Everything the player's light does is masked by
 *  it — falloff, shadows and caustics alike — while the secondary emitters
 *  are not: a lit metal plate is its own light and radiates in every
 *  direction, which is what makes a beam sweeping past one read as the beam
 *  finding it.
 *
 *  `off` is the DEFAULT now (user call, superseding the earlier
 *  beam-default call): the flashlight became an in-game TOOL gated behind
 *  the Flashlight Kit module, so a ship without the kit carries no player
 *  light and this DBG cycle is the raw dev override underneath the tool.
 *  While the tool is ON it overrides this global entirely
 *  (`RenderSystem.playerLightToolHalfDeg`); while it is off — or the kit is
 *  not installed — the renderer falls back here, so a dev can still force
 *  any width from the debug menu.  `off` is a zero-width beam rather than a
 *  special case: the player's light draws nothing, so what is left on the
 *  layer is exactly the emitters — which makes it a useful thing to look at
 *  rather than a way to disable the feature (that is `Lighting: legacy`).
 *
 *  Half-angles, so `wide` is a 120-degree beam. */
export const FLASHLIGHT_CYCLE: ReadonlyArray<{ name: string; halfDeg: number }> = [
  { name: 'radial', halfDeg: 180 },
  // A HALF-CIRCLE.  Not a torch — everything ahead of the ship, nothing
  // behind it — which is the shape a headlight has and a useful middle
  // ground between the glow and a beam.
  { name: 'half',   halfDeg: 90  },
  { name: 'wide',   halfDeg: 60  },
  { name: 'beam',   halfDeg: 40  },
  { name: 'narrow', halfDeg: 22  },
  { name: 'tight',  halfDeg: 12  },
  // A 12-degree pencil.  At this width the soft edge (EDGE_DEG, 12) is as
  // wide as the beam itself, so it reads as a spot with no hard boundary at
  // all rather than as a narrower version of `tight`.
  { name: 'pin',    halfDeg: 6   },
  { name: 'off',    halfDeg: 0   },
] as const;
/** A6 — WORLD LIGHTS: the self-luminous movers (shots, the snitch) as
 *  first-class lights on the unified layer.
 *
 *  These are not EMITTERS.  An emitter is a surface the player's light fell
 *  on, so its brightness is `received x emits` and a beam gates it; a shot
 *  glows because it is on fire, whether or not anything else lights it — no
 *  `received` factor, no beam gate, and it exists outside the player light's
 *  radius entirely.  That is why they are their own small pass rather than
 *  rows in the emitter merge.
 *
 *  BUDGET: they spend what is left of the tier's `maxLights` after the
 *  player and the emitters have drawn — the tier's number stays the whole
 *  frame's light count, shared rather than added to.  In open space (where
 *  shots actually fly) the emitters are few, so shots get the budget; deep
 *  in a lit glass field they lose it, nearest-to-screen-centre first.
 *
 *  CULLED by the light's own disc against the layer rect BEFORE any budget
 *  is spent — a shot two screens away costs one rectangle test.
 *
 *  Radii in WORLD units; alphas are multipliers on the shared falloff
 *  gradient (so the brightness cycle scales these for free). */
export const WORLD_LIGHTS = {
  PROJECTILE_RADIUS: 110,
  /** A charged / plasma shell is a bigger fire. */
  CHARGED_MULT: 1.8,
  PROJECTILE_ALPHA: 0.55,
  /** The snitch is a comet — the one persistent world light. */
  SNITCH_RADIUS: 150,
  SNITCH_ALPHA: 0.7,
} as const;
/** A7 — DEPTH-SCOPED AMBIENT DARKNESS.  Each descent (GameEngine.stageIndex)
 *  adds the tier's `ambientPerStage` of fog-dark, capped at
 *  AMBIENT_DEPTH_CAP stages — so the hub and the surface look exactly as
 *  they always did and darkness is a property of DEPTH, not a global mood.
 *  It rides the fog compositor: the ambient level is folded into the fog's
 *  dark fill (whichever of the two is darker wins), so it is cut by the
 *  player's light, respects shadows, and darkens the minimap's memory veil
 *  — all for free, and `off` restores the exact pre-A7 picture.
 *
 *  SHIPS OFF (user call, 2026-08-20).  The descent "depth" it keys on is
 *  not yet a real place: today's post-boss rifts bounce between arenas that
 *  all hang off the one Overworld, `stageIndex` is a linear counter rather
 *  than a position in a world, and nothing persists — leave a "deep" arena
 *  through the overworld portal and return, and the darkness is gone.  The
 *  mechanism is built and tested; it switches on when the universe map
 *  structure gives depth an address (see docs/PARKING_LOT.md, "Depth-scoped
 *  darkness belongs to the universe map structure"). */
export const AMBIENT_DEPTH_CAP = 4;
let depthAmbientEnabled = false;
export function toggleDepthAmbient(): boolean {
  depthAmbientEnabled = !depthAmbientEnabled;
  return depthAmbientEnabled;
}
export function getDepthAmbientEnabled(): boolean { return depthAmbientEnabled; }

let worldLightsEnabled = true;
export function toggleWorldLights(): boolean {
  worldLightsEnabled = !worldLightsEnabled;
  return worldLightsEnabled;
}
export function getWorldLightsEnabled(): boolean { return worldLightsEnabled; }

/** FOG OF WAR — darkness the player's light cuts through.
 *
 *  The light layer already answers "what can I see": it is a lit shape with
 *  shadows cut out of it, so using it as the fog's MASK gives
 *  occlusion-aware fog for free — a tile's shadow stays dark, and a beam
 *  sweeping a room opens exactly what it illuminates.  Nothing about the
 *  geometry is computed twice.
 *
 *  TWO LAYERS or THREE.  `dim` and `dark` are the two-layer version: lit or
 *  not.  `memory` is the traditional three: never seen (darkest), seen
 *  before but not lit now (dimmed), and lit (clear).  The third layer needs
 *  a memory of where the player has been, which is a per-map texture that
 *  has to be reset on every map load — cheap (one texel per
 *  `FOG.CELL` world units, so a 6000-unit map is 125x125) but it is state,
 *  and state is the reason it is a separate rung rather than the default.
 *
 *  OFF is the default: this changes how the whole game reads, and which maps
 *  want it is a design question rather than a rendering one. */
export const FOG_CYCLE: ReadonlyArray<{
  name: string; dark: number; explored: number; memory: boolean;
}> = [
  { name: 'off',    dark: 0,    explored: 0,    memory: false },
  { name: 'dim',    dark: 0.55, explored: 0.55, memory: false },
  { name: 'dark',   dark: 0.85, explored: 0.85, memory: false },
  { name: 'memory', dark: 0.90, explored: 0.5,  memory: true  },
] as const;
let activeFogIndex = 0;
export function getFog(): { name: string; dark: number; explored: number; memory: boolean } {
  return FOG_CYCLE[activeFogIndex];
}
export function getFogName(): string { return FOG_CYCLE[activeFogIndex].name; }
export function cycleFog(): string {
  activeFogIndex = (activeFogIndex + 1) % FOG_CYCLE.length;
  return FOG_CYCLE[activeFogIndex].name;
}
/** The player light's PEAK ALPHA, mirrored here for the fog.
 *
 *  It is authored in `render/lighting.ts` beside the rest of the light's
 *  shape; the fog needs it to know how far to boost the light into a mask,
 *  and importing the lighting module for one number would tie a compositing
 *  pass to the geometry half.  `tests/lighting.spec.ts` pins the two
 *  together so the mirror cannot drift. */
export const PLAYER_LIGHT_PEAK = 0.34;

export const FOG = {
  /** The fog's own colour: BLACK.
   *
   *  The first attempt was a near-black blue (`4, 8, 18`) on the theory that
   *  it would read as unlit space rather than as a wash — and it BRIGHTENED
   *  the screen, because empty space in this game measures about 3 luminance
   *  and that tint is 10.  Fog that lightens the dark parts of the frame is
   *  worse than no fog.  Any colouring of the unlit world belongs to the
   *  light, which is the thing that has a colour. */
  COLOR: '0, 0, 0',
  /** World units per texel of the EXPLORED memory.  48 makes a 6000-unit map
   *  a 125x125 texture: small enough to stamp and blit every frame without
   *  thinking about it, coarse enough that the remembered edge is soft. */
  CELL: 48,
  /** How much of the light's radius counts as EXPLORED as the player passes.
   *  Under 1 because the rim of the light is where you can barely see. */
  MEMORY_FRAC: 0.7,
  /** A clear disc around the ship, in world units, whatever the light is
   *  doing.  WITHOUT IT A NARROW BEAM FOGS THE PLAYER'S OWN SHIP — the beam
   *  points away from it, so nothing lights the hull, and the ship
   *  disappears into the dark it is holding the torch in. */
  SELF_RADIUS: 70,
  /** How far into that disc the clearing fades, as a fraction of it. */
  SELF_FEATHER: 0.45,
  /** The fog opens where the LIGHT is, and the light's own alpha peaks at
   *  a third (PLAYER_LIGHT.PEAK) — so used raw it would only ever lift a
   *  third of the fog, and dimming the light with the brightness cycle would
   *  close the fog with it.  The mask is therefore BOOSTED by repeated
   *  additive draws (each doubles the alpha) until its peak saturates; this
   *  is the target it aims for and the cap on how many doublings it will
   *  spend getting there. */
  MASK_TARGET: 1.1,
  MASK_MAX_DOUBLINGS: 5,
} as const;

/** DBG: how much of the MATERIAL's colour is in the light it passes on.
 *
 *  Light that goes through green glass comes out green, and a body lit by a
 *  red torch cannot re-emit blue — both of which the layer got wrong in
 *  opposite directions.  Transmitted light carried the LIGHT's colour with no
 *  trace of the material, and an emitter carried the MATERIAL's colour with
 *  no trace of what lit it.
 *
 *  One knob, two applications, each monotone with today's behaviour at an
 *  end of the range:
 *
 *   - EMISSION and the refracted caustic take a blend `lerp(light, material,
 *     mix)`.  0 is the light's own colour, 1 is the body's (what A5i
 *     shipped).
 *   - STRAIGHT-THROUGH transmission is tinted by MULTIPLYING the light
 *     already in the umbra by `lerp(white, material, mix)` — 0 changes
 *     nothing (what shipped), 1 is the full product.  It has to be a
 *     multiply because that light is not drawn by the shadow pass; it is
 *     what the pass chose not to erase.
 *
 *  A true product everywhere would be the physical answer and it reads too
 *  dark: two saturated colours multiply toward black, and a light that goes
 *  black on contact with coloured glass looks broken rather than physical.
 *  So the default is a half-blend, which is a look call and lives in a cycle
 *  like every other look call here. */
/** With REFRACTION on, how much of a body's transmitted light goes straight
 *  through rather than into the deviated caustic.
 *
 *  A5e's refraction prototype MOVED all of it into the cone — "the energy is
 *  moved, not added" — which is right for a wedge and wrong for a pane, and
 *  it had a consequence nobody asked for: with refraction on (the shipped
 *  default) there is no straight-through light at all, so there is nothing
 *  for the material tint to colour and the umbra behind glass is simply
 *  dark.  Splitting it is both closer to a real slab and the difference
 *  between a feature you can see and one you cannot. */
export const TRANSMIT_STRAIGHT_FRAC = 0.5;

export const TINT_MIX_CYCLE: ReadonlyArray<{ name: string; mix: number }> = [
  // SHIPS OFF (user call, after device testing).  It is physically the right
  // model and it does not earn its keep: the materials' colours sit close to
  // the light's — glass indigo, metal steel-blue, both against a sky-blue
  // lamp — so what it buys is subtle, and the straight-through path costs a
  // fill per translucent group to buy it.  The knob stays because the effect
  // is real and worth another look on a map with more colourful terrain.
  { name: 'off',  mix: 0    },
  { name: '1/4',  mix: 0.25 },
  { name: '1/2',  mix: 0.5  },
  { name: '3/4',  mix: 0.75 },
  { name: 'full', mix: 1    },
] as const;
let activeTintMixIndex = 0;
export function getTintMix(): number { return TINT_MIX_CYCLE[activeTintMixIndex].mix; }
export function getTintMixName(): string { return TINT_MIX_CYCLE[activeTintMixIndex].name; }
export function cycleTintMix(): string {
  activeTintMixIndex = (activeTintMixIndex + 1) % TINT_MIX_CYCLE.length;
  return TINT_MIX_CYCLE[activeTintMixIndex].name;
}

/** DBG: what COLOUR the player's light is.
 *
 *  `ship` is the engine-glow blue the layer has always used — chosen so the
 *  light reads as coming FROM the ship rather than as a new system
 *  announcing itself — and stays the default.  The rest exist because a
 *  flashlight is a piece of equipment, and equipment has a character: a warm
 *  tungsten beam and a cold blue-white one light the same terrain into two
 *  different games.
 *
 *  The colour reaches everything the player's light does, including the
 *  REFRACTED cone, which is right: light that passes through glass keeps the
 *  colour it arrived with.  The secondary emitters are unaffected — they
 *  radiate the colour of the BODY, not of what lit it, which is the
 *  approximation A5i settled on. */
export const LIGHT_COLOR_CYCLE: ReadonlyArray<{ name: string; rgb: string }> = [
  { name: 'ship',   rgb: '125, 211, 252' },   // sky-300, the shipped light
  { name: 'white',  rgb: '245, 245, 245' },
  { name: 'warm',   rgb: '255, 214, 150' },   // tungsten
  { name: 'amber',  rgb: '255, 176,  80' },
  { name: 'green',  rgb: '150, 255, 170' },
  { name: 'violet', rgb: '198, 160, 255' },
  { name: 'red',    rgb: '255, 120, 110' },
] as const;
let activeLightColorIndex = 0;
export function getLightColorRgb(): string {
  return LIGHT_COLOR_CYCLE[activeLightColorIndex].rgb;
}
export function getLightColorName(): string {
  return LIGHT_COLOR_CYCLE[activeLightColorIndex].name;
}
export function cycleLightColor(): string {
  activeLightColorIndex = (activeLightColorIndex + 1) % LIGHT_COLOR_CYCLE.length;
  return LIGHT_COLOR_CYCLE[activeLightColorIndex].name;
}

/** Beam shaping, all of it a look call rather than physics.
 *
 *  SPILL is why the ship is not standing in a void: a real flashlight is held
 *  by someone who can still see their own hands, and a hard cut at the cone's
 *  edge reads as a rendering error rather than as a torch.  It is the
 *  fraction of the light left OUTSIDE the beam.
 *
 *  EDGE_DEG is the angular width of the soft edge, graded over PASSES erases
 *  — the same construction as the shadow penumbra, for the same reason: a
 *  hard angular edge sweeping across terrain is exactly the kind of moving
 *  hard line this whole gauntlet has been removing. */
export const FLASHLIGHT = {
  SPILL: 0.14,
  EDGE_DEG: 12,
  PASSES: 3,
  /** Extra bearing margin on the occluder cull, in degrees.  A body outside
   *  the beam cannot shadow into it (a shadow runs radially outward), so
   *  those bodies are skipped entirely — which is where a narrow beam gets
   *  cheaper than the radial light.  The margin covers the body's own
   *  angular size, the penumbra, and the fact that a REFRACTED cone leaves
   *  its body deviated rather than radial. */
  CULL_MARGIN_DEG: 25,
} as const;
let activeFlashlightIndex =
  FLASHLIGHT_CYCLE.findIndex(f => f.name === 'off');

/** THE LIGHT TOOL (user call): the ship's light is EQUIPMENT.  Tapping the
 *  ship (or E / the pad's action button) in open space cycles the level; the
 *  Light module (`flashlight_kit`) is what grants the tool at all, the same
 *  everything-is-a-module pattern as the Shield core.  Both ON levels wear
 *  the BEAM flashlight style (the 80-degree cone); what separates them is
 *  the LIGHTING TIER (user call): `medium` runs the light system at the
 *  'medium' rung and `high` at 'high' — longer reach, more occluders, soft
 *  penumbra, the whole ladder step, applied through the tier override below
 *  so every consumer of `getActiveLightingTier` agrees.  `off` is the
 *  default: a light you switch on. */
export const FLASHLIGHT_TOOL_LEVELS: ReadonlyArray<{ name: string; label: string; halfDeg: number; tier?: string }> = [
  // `name` is the internal/debug vocabulary (it names the TIER the level
  // runs); `label` is what the player reads over the ship — headlight
  // words, because "medium/high" are debugging terms (user call).
  { name: 'off',    label: 'Light off', halfDeg: 0 },
  { name: 'medium', label: 'Low beam',  halfDeg: 40, tier: 'medium' },
  { name: 'high',   label: 'High beam', halfDeg: 40, tier: 'high' },
] as const;
export function getFlashlightHalfDeg(): number {
  return FLASHLIGHT_CYCLE[activeFlashlightIndex].halfDeg;
}
export function getFlashlightName(): string {
  return FLASHLIGHT_CYCLE[activeFlashlightIndex].name;
}
export function cycleFlashlight(): string {
  activeFlashlightIndex = (activeFlashlightIndex + 1) % FLASHLIGHT_CYCLE.length;
  return FLASHLIGHT_CYCLE[activeFlashlightIndex].name;
}

/** DBG: which way the player's wake spins a nebula shard it passes.
 *
 *  The swirl pass (`PhysicsSystem.applyNebulaPlayerPull`) used to sign each
 *  shard's spin by its id's last-character parity — "varied vortices" — which
 *  means a pass has NO consistent handedness: half the cloud rotates against
 *  the wake (user report: a starboard-side shard should turn clockwise).
 *  `physical` (the default) signs the spin by the wake shear — the cross
 *  product of the ship's velocity with the ship→shard vector — so a shard
 *  off the starboard bow turns clockwise on screen and a port-side one
 *  counter-clockwise.  `inverted` is the same cross product negated, and
 *  `random` is the shipped parity behaviour; all three are one DBG click
 *  apart (Visual ▸ "Neb spin") so the two candidate handednesses can be
 *  A/B'd in flight.  PROPER rotational mechanics (angular momentum in the
 *  impulse solver, spin from off-centre hits) is parked for its own session
 *  — see docs/PARKING_LOT.md. */
export const NEBULA_WAKE_SPIN_CYCLE = ['physical', 'inverted', 'random'] as const;
export type NebulaWakeSpinMode = typeof NEBULA_WAKE_SPIN_CYCLE[number];
let activeNebulaWakeSpinIndex = 0;
export function getNebulaWakeSpinMode(): NebulaWakeSpinMode {
  return NEBULA_WAKE_SPIN_CYCLE[activeNebulaWakeSpinIndex];
}
export function cycleNebulaWakeSpin(): string {
  activeNebulaWakeSpinIndex = (activeNebulaWakeSpinIndex + 1) % NEBULA_WAKE_SPIN_CYCLE.length;
  return NEBULA_WAKE_SPIN_CYCLE[activeNebulaWakeSpinIndex];
}

/** DBG: how hard the CAUSTIC edges are — the two fades that keep a refracted
 *  cone from switching on and off.
 *
 *  Reported from the device as a click or flash on glass while drifting past
 *  it slowly, and it is two separate cliffs behind one symptom:
 *
 *   - TOTAL INTERNAL REFLECTION is a step.  Past the critical angle a face
 *     transmits nothing, so each face's cone appeared and vanished at FULL
 *     length as the body turned relative to the light.  Real transmission
 *     falls to zero AT that angle instead (Fresnel), so `tir` fades the cone
 *     out over a band of the Snell discriminant, which is 0 exactly at the
 *     critical angle.
 *   - THE OCCLUDER CAP is a step.  In a dense field the pool sits saturated
 *     — measured at 24 of 24 on the glass showcase — so bodies swap in and
 *     out of it as the ship moves, and an entering body brought its whole
 *     caustic at full strength.  `cap` fades a body's caustic out as it
 *     approaches the eviction boundary, so nothing visible is ever evicted.
 *
 *  Both are expressed as fractions rather than as alphas because every cone
 *  in a transmit group shares ONE compound path and therefore one fill: the
 *  weight rides the cone's THROW instead, and since the fill is the light's
 *  own falloff gradient, a shorter cone is a dimmer one.
 *
 *  'off' restores the cliffs exactly, which is the control case the fix was
 *  measured against. */
export const CAUSTIC_FADE_CYCLE: ReadonlyArray<{ name: string; tir: number; cap: number }> = [
  // The two fades are tuned very differently ON PURPOSE, because only one of
  // them has a measured benefit.  The TIR taper removes a cliff that was
  // MEASURED — per-face transmission flipping from full to nothing in a
  // single step of movement, now ramping over several.  The CAP fade is
  // mechanically sound but its benefit could not be separated from the
  // ordinary churn of 24 bodies moving, while its COST is measurable: at a
  // quarter of the ranks it costs a third of the caustic's total throw.  So
  // it ships light and is there to be turned up if the device disagrees.
  { name: 'smooth', tir: 0.25, cap: 0.08 },
  { name: 'soft',   tir: 0.45, cap: 0.20 },
  { name: 'heavy',  tir: 0.60, cap: 0.35 },
  { name: 'light',  tir: 0.12, cap: 0    },
  { name: 'off',    tir: 0,    cap: 0    },
] as const;
let activeCausticFadeIndex = 0;
export function getCausticFade(): { name: string; tir: number; cap: number } {
  return CAUSTIC_FADE_CYCLE[activeCausticFadeIndex];
}
export function getCausticFadeName(): string {
  return CAUSTIC_FADE_CYCLE[activeCausticFadeIndex].name;
}
export function cycleCausticFade(): string {
  activeCausticFadeIndex = (activeCausticFadeIndex + 1) % CAUSTIC_FADE_CYCLE.length;
  return CAUSTIC_FADE_CYCLE[activeCausticFadeIndex].name;
}

/** DBG: how long an emitter takes to FADE in or out, in seconds.
 *
 *  ADDED BECAUSE EMISSION FLASHED.  The set of emitters is chosen nearest-
 *  first and capped by the tier, so as the ship moves, bodies cross into and
 *  out of that budget — and a halo that is drawn at full strength on one
 *  frame and not at all on the next reads as a strobe, which is worse than
 *  no emission at all.  It is not a brightness problem: the alphas either
 *  side of the swap are both correct, and the swap itself is what the eye
 *  objects to.
 *
 *  So an emitter's alpha EASES toward its target and a body that leaves the
 *  budget fades out rather than vanishing — which needs the emitter to
 *  persist for a moment after it stops being chosen (see the emitter slots
 *  in render/lighting.ts).  `off` is the old instantaneous behaviour, kept
 *  as the control.
 *
 *  Time-based rather than per-frame, so the fade takes the same wall-clock
 *  time whatever the frame rate. */
export const EMIT_FADE_CYCLE: ReadonlyArray<{ name: string; sec: number }> = [
  { name: 'smooth', sec: 0.25 },
  { name: 'slow',   sec: 0.5  },
  { name: 'languid',sec: 1    },
  { name: 'fast',   sec: 0.12 },
  { name: 'off',    sec: 0    },
] as const;
let activeEmitFadeIndex = 0;
export function getEmitFadeSec(): number {
  return EMIT_FADE_CYCLE[activeEmitFadeIndex].sec;
}
export function getEmitFadeName(): string {
  return EMIT_FADE_CYCLE[activeEmitFadeIndex].name;
}
export function cycleEmitFade(): string {
  activeEmitFadeIndex = (activeEmitFadeIndex + 1) % EMIT_FADE_CYCLE.length;
  return EMIT_FADE_CYCLE[activeEmitFadeIndex].name;
}

let refractionEnabled = true;
export function getRefractionEnabled(): boolean { return refractionEnabled; }
export function toggleRefraction(): boolean {
  refractionEnabled = !refractionEnabled;
  return refractionEnabled;
}

/** DBG: how bright the refracted cone is, as a fraction of the light's OWN
 *  peak — the tuning knob for the prototype above.
 *
 *  Named as fractions rather than decimals because that is the quantity the
 *  rule is stated in: refracted light must be no more than HALF the source.
 *  Every entry therefore sits at or below 1/2, and `REFRACT.MAX_BRIGHTNESS_FRAC`
 *  in render/lighting.ts clamps on top of whatever this returns — so the rule
 *  survives someone adding a row here, which is the point of having it in two
 *  places.
 *
 *  A cycle rather than a number in a file, for the same reason as the shadow
 *  softness beside it: it is a look call, and the look call belongs on the
 *  device against real terrain.  Starts at the ceiling, so tuning only ever
 *  goes down from the brightest the rule allows. */
export const REFRACT_BRIGHTNESS_CYCLE: ReadonlyArray<{ name: string; frac: number }> = [
  { name: '1/2',  frac: 0.5   },
  // ABOVE the old ceiling, on device feedback: the caustic measured as only
  // marginally legible at Low (2.2 % of pixels changed), and a prototype you
  // cannot see is one you cannot judge.  "No brighter than half the source"
  // was the right instinct physically — refracted light is a redistribution
  // of light that already lost some of itself passing through the body — but
  // it is now the DEFAULT rather than a ceiling.  Cycling from the default
  // goes UP first, because that is the direction the question was asked in.
  { name: '2/3',  frac: 0.667 },
  { name: '3/4',  frac: 0.75  },
  { name: '1/1',  frac: 1     },
  { name: '1/3',  frac: 0.333 },
  { name: '1/4',  frac: 0.25  },
  { name: '1/6',  frac: 0.167 },
  { name: '1/10', frac: 0.1   },
  { name: '1/16', frac: 0.0625 },
] as const;
let activeRefractBrightnessIndex = 0;
export function getRefractBrightness(): number {
  return REFRACT_BRIGHTNESS_CYCLE[activeRefractBrightnessIndex].frac;
}
export function getRefractBrightnessName(): string {
  return REFRACT_BRIGHTNESS_CYCLE[activeRefractBrightnessIndex].name;
}
export function cycleRefractBrightness(): string {
  activeRefractBrightnessIndex =
    (activeRefractBrightnessIndex + 1) % REFRACT_BRIGHTNESS_CYCLE.length;
  return REFRACT_BRIGHTNESS_CYCLE[activeRefractBrightnessIndex].name;
}

/** DBG: how bright the player light is, as a multiplier on its own peak.
 *
 *  ADDED BECAUSE THE TIER CYCLE IS NOT THIS.  "Light tier" is a COST ladder
 *  — canvas resolution, occluder cap, radius — and dropping to `lowest`
 *  changes how much work the light does, not how bright it is.  Reported
 *  from the device as "I'm at the lowest setting and it still feels very
 *  bright", which is exactly right and exactly what that cycle does.
 *
 *  The ladder runs a long way down, because the complaint was not that the
 *  light was slightly hot: the bottom rung is a twelfth of today's value,
 *  which reads as a faint wash rather than a lamp.  100% is the current
 *  shipped look and stays the default, so this changes nothing until it is
 *  asked to. */
export const LIGHT_BRIGHTNESS_CYCLE: ReadonlyArray<{ name: string; mult: number }> = [
  { name: '100%', mult: 1    },
  { name: '70%',  mult: 0.7  },
  { name: '50%',  mult: 0.5  },
  { name: '35%',  mult: 0.35 },
  { name: '25%',  mult: 0.25 },
  { name: '15%',  mult: 0.15 },
  { name: '8%',   mult: 0.08 },
] as const;
let activeLightBrightnessIndex = 0;
export function getLightBrightness(): number {
  return LIGHT_BRIGHTNESS_CYCLE[activeLightBrightnessIndex].mult;
}
export function getLightBrightnessName(): string {
  return LIGHT_BRIGHTNESS_CYCLE[activeLightBrightnessIndex].name;
}
export function cycleLightBrightness(): string {
  activeLightBrightnessIndex =
    (activeLightBrightnessIndex + 1) % LIGHT_BRIGHTNESS_CYCLE.length;
  return LIGHT_BRIGHTNESS_CYCLE[activeLightBrightnessIndex].name;
}

/** DBG: shadow-edge SOFTNESS, as a multiplier on the tier's penumbra k.
 *
 *  A point light casts a perfectly hard shadow, which is what made the first
 *  version read as a drawn line rather than as lighting.  Softness here is
 *  an ANGLE (see PENUMBRA_DEG_PER_K in render/lighting.ts), so the soft band
 *  widens with distance from the caster the way a real area light's does —
 *  tight against the tile, spreading further out.  Cycling rather than a
 *  toggle because this is a look call that wants to be made on the device,
 *  against real terrain, not chosen from a number here.
 *
 *  'off' restores the hard shadow exactly, which is also the A5 penumbra
 *  stage's control case. */
export const SHADOW_SOFTNESS_CYCLE: ReadonlyArray<{ name: string; k: number }> = [
  { name: 'soft',    k: 2.5 },
  { name: 'softer',  k: 4.5 },
  // Three rungs past 'softer', added on device feedback.  They are usable
  // rather than decorative because the PASS COUNT scales with k (see
  // SOFT_STEPS in render/lighting.ts): a 14-degree band graded over the
  // three passes that suit 2.5 would read as three stripes, not as a soft
  // edge, so the softest settings buy themselves more gradations.
  { name: 'softest', k: 7   },
  { name: 'diffuse', k: 10  },
  { name: 'hazy',    k: 14  },
  { name: 'off',     k: 0   },
  { name: 'subtle',  k: 1.2 },
] as const;
/** SHIPPED DEFAULT: `diffuse` (user call, after device testing) — four rungs
 *  softer than the 'soft' this shipped at, and paid for by the pass count
 *  that scales with k, so the wider band is graded rather than striped.
 *  Found by NAME, like the lighting tier's default, so inserting a rung
 *  above it cannot silently change what ships. */
let activeSoftnessIndex = SHADOW_SOFTNESS_CYCLE.findIndex(s => s.name === 'diffuse');
export function getShadowSoftness(): number { return SHADOW_SOFTNESS_CYCLE[activeSoftnessIndex].k; }
export function getShadowSoftnessName(): string { return SHADOW_SOFTNESS_CYCLE[activeSoftnessIndex].name; }
export function cycleShadowSoftness(): string {
  activeSoftnessIndex = (activeSoftnessIndex + 1) % SHADOW_SOFTNESS_CYCLE.length;
  return SHADOW_SOFTNESS_CYCLE[activeSoftnessIndex].name;
}

/** Per-tier lighting budget.
 *
 *  `divisor` is how many CSS pixels of screen one light-layer pixel covers.
 *  It is never 1: a light layer is low-frequency by nature, so rendering it
 *  at full resolution buys nothing but fill rate.  At the Low tier's 3, a
 *  390x844 phone gets a 130x282 layer — 0.15 MB.
 *
 *  `maxOccluders` is load-bearing rather than defensive.  A 300-radius light
 *  covers pi*300^2 = 283k square units; at HEX_AREA = 1257 that is up to ~225
 *  hexes if the field were solid.  The cap takes the N NEAREST, because the
 *  nearest occluders subtend the largest shadow angle — so truncation loses
 *  the shadows least likely to be noticed, and the cost stays bounded by the
 *  cap rather than by how dense the terrain happens to be.
 *
 *  `maxRadius` of 300 at Low is anchored on the legacy models' own
 *  `glow.range` of 250, so a unified light reads at a scale players already
 *  know rather than announcing itself as a new system.
 *
 *  `ambientPerStage` is multiplied by min(stageIndex, 4) — ambient darkness
 *  is scoped to DEPTH, so the hub and the surface look exactly as they do
 *  today and darkness becomes a property of descending.  It was authored
 *  zero at Low when ambient was expected to need its own pass; A7 rides the
 *  fog compositor (0.3-0.5 ms measured), so Low now carries a modest value
 *  and only the emergency tiers below it stay at zero. */
export interface LightingTier {
  readonly name: string;
  readonly divisor: number;
  readonly maxLights: number;
  readonly maxOccluders: number;
  /** How many of `maxOccluders` mobile SHARDS may take while there is still
   *  terrain to fill the rest.  Debris is nearer than terrain almost by
   *  definition, so without a share cap a shatter hands the entire budget to
   *  the fragments and the intact tiles stop casting.  Measured at 100 % of
   *  the pool on the glass showcase under a shatter cadence before this
   *  existed.  Shards still get the WHOLE pool on a map with no tiles. */
  readonly maxShardOccluders: number;
  readonly maxRadius: number;
  /** Penumbra softness. 0 = hard shadows (Low pins this, so the penumbra
   *  stage is a no-op on the worst target by construction). */
  readonly penumbraK: number;
  readonly ambientPerStage: number;
}
export const LIGHTING_TIERS: ReadonlyArray<LightingTier> = [
  { name: 'minimal', divisor: 7, maxLights: 1, maxOccluders: 4,  maxShardOccluders: 2,  maxRadius: 180, penumbraK: 0,   ambientPerStage: 0    },
  { name: 'lowest', divisor: 5, maxLights: 2,  maxOccluders: 8,  maxShardOccluders: 3,  maxRadius: 220, penumbraK: 0,   ambientPerStage: 0    },
  { name: 'lower',  divisor: 4, maxLights: 3,  maxOccluders: 14, maxShardOccluders: 5,  maxRadius: 260, penumbraK: 0,   ambientPerStage: 0    },
  { name: 'low',    divisor: 3, maxLights: 4,  maxOccluders: 24, maxShardOccluders: 8,  maxRadius: 300, penumbraK: 0,   ambientPerStage: 0.08 },
  { name: 'medium', divisor: 2, maxLights: 8,  maxOccluders: 48, maxShardOccluders: 16, maxRadius: 400, penumbraK: 2.5, ambientPerStage: 0.10 },
  { name: 'high',   divisor: 2, maxLights: 16, maxOccluders: 96, maxShardOccluders: 32, maxRadius: 500, penumbraK: 4.0, ambientPerStage: 0.12 },
  { name: 'ultra',  divisor: 1, maxLights: 32, maxOccluders: 160, maxShardOccluders: 56, maxRadius: 650, penumbraK: 5.0, ambientPerStage: 0.14 },
] as const;
// SEVEN RUNGS, and the ends are the interesting ones.  `minimal` renders
// the light layer at a SEVENTH of screen resolution with a single light and
// four occluders — the setting for a device that cannot afford `lowest`,
// where the question is whether to have a light at all.  `ultra` runs the
// layer at FULL screen resolution with 32 lights: not a play setting, but
// the one that answers "what would this look like without the budget", and
// the emissive prototype in particular is bounded by `maxLights`, so it has
// nowhere to show itself below `medium`.
//
// TWO TIERS BELOW LOW, added when the worst-case cost stopped having
// comfortable headroom (~1.7 ms p95 against a 2.0 ms budget that has never
// been re-derived on a device).  Every knob that drives cost moves together
// — a coarser light canvas, fewer occluders, a shorter radius — because the
// point is a real step down in work, not a nudge.  `lowest` renders the
// layer at a FIFTH of screen resolution and casts from 8 bodies; it is meant
// to be the setting that keeps the light at all on a device that cannot
// afford `low`, not a setting anyone would choose for looks.
//
// LOW REMAINS THE DEFAULT.  This index must track the position of 'low' in
// the array above rather than being a literal, or inserting a tier silently
// changes what ships.
let activeLightingTierIndex = LIGHTING_TIERS.findIndex(t => t.name === 'low');
/** The LIGHT TOOL's tier, while the tool is ON (see FLASHLIGHT_TOOL_LEVELS)
 *  — set per frame by GameEngine.draw, -1 when the tool is off.  While set
 *  it wins over the DBG tier row for EVERY consumer, which is the point:
 *  "high" on the tool means the whole light system steps up, not just the
 *  player's cone.  The DBG row stays the raw dev override underneath,
 *  exactly the flashlight-width arrangement. */
let lightingTierOverrideIndex = -1;
export function setLightingTierOverride(name: string | null): void {
  lightingTierOverrideIndex = name === null
    ? -1 : LIGHTING_TIERS.findIndex(t => t.name === name);
}
export function getActiveLightingTier(): LightingTier {
  return LIGHTING_TIERS[lightingTierOverrideIndex >= 0
    ? lightingTierOverrideIndex : activeLightingTierIndex];
}
export function cycleLightingTier(): LightingTier {
  activeLightingTierIndex = (activeLightingTierIndex + 1) % LIGHTING_TIERS.length;
  return LIGHTING_TIERS[activeLightingTierIndex];
}

// ─── DBG: HUD (React) update rate ────────────────────────────────────────────
//
// `GameEngine.onStatsUpdate` is a React setState, and it fires EVERY FRAME.
// The reconciliation it triggers walks the whole (unmemoized, ~2500-line)
// UIOverlay tree and is neither `draw()` nor the sim, so no engine timer saw
// it — until one was built for it.
//
// THE ORIGINAL JUSTIFICATION FOR THIS KNOB WAS WRONG.  It read: a hardware
// capture (2026-08-09, Ring World, iPhone) showed 35 ms frames carrying only
// 1 ms render + 2 ms sim, ~32 ms unaccounted, and that residual was
// attributed here.  It is not this.  Measured with a React `<Profiler>`,
// reconciliation costs **0.1 ms median / 0.2 ms p95 in play** and 0.3 / 0.5 ms
// with the heaviest overlay up — three orders of magnitude off the number
// that motivated the knob.  Cutting React out of the frame entirely moves
// frame time ~2 %.  The 32 ms residual is real but lives somewhere else;
// `renderMs` times CPU-side canvas call issuing, not the rasterization those
// calls queue.  See docs/GAUNTLET_REACT_LOG.md.
//
// So this knob is a LEFTOVER, kept because it is harmless and occasionally
// handy for A/B work — NOT a tuning lever, and not evidence that the HUD is
// expensive.  Its ceiling is ~0.05 ms in play.  Do not cite it, or the
// capture above, as a reason to go optimizing the React layer; that case was
// investigated in full and declined on evidence.
//
// The HUD is text chips and bars; it does not need 60 Hz.  Everything that
// must stay frame-perfect is canvas-drawn (minimap, loadout strip, wave
// banners, damage text) and is unaffected by this.  60 is index 0 and stays
// the default — now on the measurement above rather than on caution.
export const HUD_RATE_CYCLE: ReadonlyArray<number> = [60, 30, 15] as const;
let activeHudRateIndex = 0;
export function getActiveHudRate(): number { return HUD_RATE_CYCLE[activeHudRateIndex]; }
export function getActiveHudRateName(): string { return `${HUD_RATE_CYCLE[activeHudRateIndex]}Hz`; }
export function cycleHudRate(): number {
  activeHudRateIndex = (activeHudRateIndex + 1) % HUD_RATE_CYCLE.length;
  return HUD_RATE_CYCLE[activeHudRateIndex];
}

export const SIM_RATE_CYCLE: ReadonlyArray<number> = [120, 60] as const;
let activeSimRateIndex = 0;
/** The sim rate currently selected, in Hz. */
export function getActiveSimRate(): number { return SIM_RATE_CYCLE[activeSimRateIndex]; }
export function getActiveSimRateName(): string { return `${SIM_RATE_CYCLE[activeSimRateIndex]}Hz`; }
/** The live fixed timestep.  Read this instead of SIMULATION_CONSTANTS.FIXED_DT
 *  anywhere the rate must be honoured (the accumulator loop). */
export function getSimDt(): number { return 1 / SIM_RATE_CYCLE[activeSimRateIndex]; }
/**
 * How many BASELINE (1/120 s) steps one current step covers: 1 at 120 Hz,
 * 2 at 60 Hz.
 *
 * Constants tuned PER STEP rather than per second have to be rescaled by this
 * or they silently change meaning with the rate.  Deriving the scale from the
 * existing 120 Hz numbers — rather than re-authoring them as per-second rates
 * — is deliberate: it guarantees the 120 Hz path is bit-for-bit what it is
 * today, so the toggle is a clean A/B rather than a retune of both branches.
 *
 * Two conversions are EXACT:
 *   - exponential decay:   d_eff = d ** stepScale   (0.97 -> 0.9409)
 *   - linear accumulation: s_eff = s * stepScale    (0.08 -> 0.16)
 * Anything that INTERLEAVES the two in one step differs by a second-order
 * term, and the iterative collision solver does not convert at all — that is
 * where the real feel change lives, and why this is a toggle and not an edit.
 */
export function simStepScale(): number { return 120 / SIM_RATE_CYCLE[activeSimRateIndex]; }
/** Substep clamp scaled to the rate, so the spiral-of-death guard covers the
 *  same amount of WALL TIME at either rate (5 steps @120Hz ≈ 3 @60Hz). */
export function getMaxSubsteps(): number {
  return Math.max(2, Math.round(getActiveSubstepCap() / simStepScale()));
}
export function cycleSimRate(): number {
  activeSimRateIndex = (activeSimRateIndex + 1) % SIM_RATE_CYCLE.length;
  return SIM_RATE_CYCLE[activeSimRateIndex];
}

export const LOCAL_GRAVITY_CONSTANTS = {
  RANGE: 400,          // Pixel radius where gravity takes effect
  STRENGTH: 0.00015,     // Reduced 100x again (1000x total reduction)
  MIN_DIST: 50,        // Clamp to prevent infinite force at center
  PLAYER_INFLUENCE: 0.00001 // Reduced 100x again
};

// Asteroid clustering force model removed — see git history for the
// pairwise + density-bias implementations.  Today the chaotic-debris
// feel relies on the flow-field nudge and stick-bond cohesion alone.

// ── Shard-pair collision pacing ─────────────────────────────────────
// Shard ↔ shard pairs run through the cheap `resolveAsteroidPair`
// (circle-only, no SAT) but still pay O(k²) per cell × hundreds of
// shards in dense fields — the dominant cost of the collision pass
// during cannon spam.  Two lightweight optimisations applied:
//
//   1. FRAME_INTERVAL — resolve shard-shard pairs only every Nth
//      physics substep.  Other dynamic-vs-dynamic pairs (player,
//      enemy, projectile) still resolve every frame.  N=1 matches
//      pre-optimisation behaviour; N=3 default cuts work to ~1/3
//      with at most ~50 ms of visible overlap (3 frames @ 60 Hz)
//      before separation kicks in next interval frame.
//   2. STABLE_REL_VEL_SQ + STABLE_OVERLAP_FRACTION — inside the
//      resolver, skip the impulse + position correction when both
//      relative velocity² is below threshold AND overlap is below
//      a fraction of contact distance.  Settled piles become free
//      to evaluate.
export const SHARD_PAIR_CONSTANTS = {
  // Physics substeps between shard-shard resolution passes.  Cycled
  // via the DBG panel ShPair button (AUTO → 1 → 2 → 3 → 4 → 6 → 8).
  // 0 = AUTO (scaled by previous frame's maxCellDensity per the
  // table below); ≥1 = manual override.  Default AUTO so the field
  // self-tunes to dense fights without dev intervention.
  FRAME_INTERVAL: 0,
  // (rel-vel)² gate for stable-pair skip.  Combines with the overlap
  // gate below — both must be true to bail early inside
  // resolveAsteroidPair.  0.04 ≈ 0.2 px/frame relative drift.
  STABLE_REL_VEL_SQ: 0.04,
  // Overlap fraction of (rA + rB) below which a pair is considered
  // settled.  0.04 = 4 % of contact distance — visually unnoticeable.
  STABLE_OVERLAP_FRACTION: 0.04,
  // ── AUTO-mode density → interval mapping ────────────────────────
  // In AUTO mode the effective interval is selected from the
  // previous step's `maxCellDensity` (the peak shard count in any
  // single 3x3 collision cell — direct signal for shard-pair
  // pressure).  Steps are deliberately coarse so the active interval
  // doesn't hop every frame as density fluctuates by 1-2.  Light
  // fields (a few drifting shards) keep N=1 so impact response
  // feels crisp; heavy piles climb through powers-of-2 to N=16/32
  // so settled clusters stop dominating the frame budget — at those
  // densities pairs are visually settled and the human eye won't
  // notice a 1/4-sec separation lag.  First entry whose `maxDensity`
  // ≥ observed wins.
  AUTO_THRESHOLDS: [
    { maxDensity: 8,    interval: 1 },
    { maxDensity: 16,   interval: 2 },
    { maxDensity: 32,   interval: 4 },
    { maxDensity: 64,   interval: 8 },
    { maxDensity: 128,  interval: 16 },
    { maxDensity: 9999, interval: 32 },
  ] as const,
  // Manual cycle order, including AUTO sentinel (0).  Spans 1..1028
  // so dense fields can pin a very high interval for stress testing.
  // Powers-of-2 progression keeps the cycle short while still giving
  // 1-frame granularity at the low end where it matters most.  At
  // 1028 substeps (~17 s @ 60 Hz) shards effectively never resolve
  // each other — useful for measuring the absolute floor of collision
  // cost.
  CYCLE_ORDER: [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1028] as const,
  // Viewport-gated cadence: a shard-pair where BOTH shards are
  // offscreen resolves only once every OFFSCREEN_RESOLVE_DIVISOR
  // shard-pair passes (a "catch-up" phase); any pair with at least one
  // shard on/near the camera resolves every pass.  Targets the
  // unbounded cost of free-drift shards the player kicked and abandoned
  // — those never sleep (no friction) and otherwise resolve at full
  // cadence forever, off-screen and unseen.  The catch-up phase keeps
  // off-screen piles from interpenetrating without bound, and any shard
  // entering the (CULL_MARGIN-padded) viewport resolves at full rate
  // before it's visible, so the gate is invisible.  8 ≈ resolve
  // off-screen pairs ~7-8× less often.
  OFFSCREEN_RESOLVE_DIVISOR: 8,
};

// ─────────────────────────────────────────────────────────────────────
// Collision-sleep for mobile shards.
//
// A shard whose speed² and |spin| both stay below the epsilons below
// for DELAY_SECONDS is flagged `asleep`.  resolveShardPairs then skips
// the SAT+impulse `resolveAsteroidPair` call for asleep↔asleep pairs —
// the dominant cost in a settled field, where almost every pair is two
// resting shards.  Pairs with at least one awake party always resolve,
// and a resolved collision wakes both ends, so a disturbance ripples
// through a contact island over successive substeps (no explicit
// island bookkeeping needed).  Sleeping shards stay rendered,
// merge-eligible, and collidable against awake bodies.
//
// Epsilons are deliberately small: rock/glass shards have no friction
// (free-drift), so a moving one keeps its speed and stays awake until
// it actually collides; only genuinely-at-rest shards (the bulk of an
// undisturbed field) sleep.  DELAY_SECONDS adds hysteresis so a shard
// grazed to a near-stop doesn't flicker asleep/awake at the threshold.
export const SHARD_SLEEP_CONSTANTS = {
  SPEED_EPSILON_SQ: 0.08 * 0.08,   // ≈ 0.08 vel-units; below this counts as still
  SPIN_EPSILON: 0.03,              // radians/substep
  DELAY_SECONDS: 0.4,              // rest dwell before sleeping
};

// ─────────────────────────────────────────────────────────────────────
// Shard render LOD (level-of-detail).
//
// A mobile shard whose apparent (zoom-scaled) radius falls below
// MIN_APPARENT_RADIUS_PX is too small for its polygon irregularity,
// edge stroke, or power-up bloom to read — at a few pixels a 5-9-gon
// and a disc are indistinguishable.  At that size RenderSystem skips
// the per-frame beginPath + per-vertex lineTo + fill (+ stroke + glow)
// and blits a cached solid-disc bitmap (one drawImage), tinted to the
// shard's fill colour.  Purely visual: collision/merge/physics are
// untouched, and the threshold is small enough that the swap is
// sub-pixel.  Special states (hit-flash, power-up glow) keep the full
// path so they still read.  DEFAULT_ZOOM (0.65) means radius 9 px ≈ a
// 28-world-unit shard — i.e. the small chips a dense field is made of.
export const SHARD_LOD_CONSTANTS = {
  MIN_APPARENT_RADIUS_PX: 9,
  // Rock chips below THIS apparent radius collapse to a cached solid-disc
  // blit (full polygon + tint render skipped).  Smaller than the metal
  // threshold above so a rock keeps its jagged silhouette until it's only a
  // few screen pixels — by then the shape is imperceptible anyway.
  CHIP_LOD_RADIUS_PX: 6,
  // Offscreen disc bitmap resolution.  Blitted downscaled to a handful
  // of pixels, so 48² is ample and keeps each cached colour tiny.
  DISC_BITMAP_SIZE: 48,
};

// ─────────────────────────────────────────────────────────────────────
// Shard ↔ static-tile pair resolution.
// Mirrors SHARD_PAIR_CONSTANTS for the dedicated shard-vs-tile scan
// (`PhysicsSystem.resolveShardTilePairs`).  That pass is opt-in via
// the DBG `Sh↔Tl` toggle; when it is on, this interval gates how
// often it actually fires per physics substep.  Same density signal
// as SHARD_PAIR (lastMaxCellDensity proxies the outer-loop size —
// the shard count drives the cost).
export const SHARD_TILE_PAIR_CONSTANTS = {
  // Default AUTO so behaviour matches the shard-pair UX: light
  // fields resolve every frame for crisp impacts, dense fields back
  // off so the scan doesn't dominate `coll` ms.
  FRAME_INTERVAL: 0,
  AUTO_THRESHOLDS: [
    { maxDensity: 8,    interval: 1 },
    { maxDensity: 16,   interval: 2 },
    { maxDensity: 32,   interval: 4 },
    { maxDensity: 64,   interval: 8 },
    { maxDensity: 128,  interval: 16 },
    { maxDensity: 9999, interval: 32 },
  ] as const,
  CYCLE_ORDER: [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1028] as const,
};

// ─────────────────────────────────────────────────────────────────────
// Central performance controller (engine/systems/PerfController.ts).
//
// One coordinator replaces the scattered per-system AUTO tables: it
// samples a load signal each sim step, quantises it into a small number
// of tiers (with hysteresis so the interval doesn't hop every frame),
// and hands each registered skippable task an effective frame-skip
// interval scaled between its own min/max.  Phase offsets (assigned by
// registration order) stagger same-interval tasks so a heavy step never
// stacks every pass at once.
export const PERF_CONTROLLER_CONSTANTS = {
  // Master AUTO default — matches the existing "0 = AUTO" UX where the
  // field self-tunes without dev intervention.  Flip via the DBG Perf
  // section; OFF runs every AUTO task every step (manual pins still win).
  AUTO_DEFAULT: true,
  // ── Load-signal normalisation ──────────────────────────────────────
  // Each raw signal is normalised to [0,1] against its REF; the
  // instantaneous load is the max of the three (the binding constraint
  // wins).  Peak collision-cell density is the reliable, vsync-
  // independent clustering signal; sim-time is a secondary booster so a
  // genuinely slow substep can escalate further.
  //
  // The entity term uses the DYNAMIC (mobile) entity count — the exact
  // set the collision broadphase iterates — NOT total entities.  Total
  // count is dominated by inert mass=∞ tiles (TILE_HEAVY ships 4000+)
  // that cost ~nothing per frame, so keying off it falsely pegged the
  // throttle at max from frame 0.  ~1500 mobile entities ≈ full load.
  DYNAMIC_COUNT_REF: 1500,
  CELL_DENSITY_REF: 96,
  // Per-substep sim time (updatePhysics + updateGameLogic, ms) that maps
  // to load 1.0.  Deliberately uses SIM time, NOT render frame time —
  // render frame time is vsync-capped (~16.6 ms even when idle) and would
  // read as permanent high load.  ~6 ms/substep is already heavy.
  SIM_MS_REF: 6,
  // EWMA smoothing for the per-substep sim-time sample (de-spikes it).
  SIM_MS_EWMA_ALPHA: 0.15,
  // EWMA smoothing for the combined load level.  Lower = steadier (less
  // interval hopping as the raw signals fluctuate frame-to-frame).
  LOAD_EWMA_ALPHA: 0.06,
  // ── Discrete load tiers (with hysteresis) ──────────────────────────
  // The smoothed load is quantised into NUM_TIERS levels.  A task's
  // effective interval interpolates from its minInterval (tier 0) to its
  // maxInterval (top tier).  Coarse tiers + hysteresis stop the interval
  // from oscillating as load wobbles around a boundary.
  NUM_TIERS: 5,
  // Upward thresholds (length NUM_TIERS-1): smoothed load must exceed
  // TIER_THRESH_UP[t] to climb to tier t+1.  Dropping back requires load
  // to fall below TIER_THRESH_UP[t] - TIER_HYSTERESIS.  Nudged down from
  // [0.18, 0.38, 0.6, 0.82] so the higher frame-skip intervals engage at
  // a slightly lower load (≈ lower dynamic-entity count) — trading a
  // little settling fidelity for smoother frames under pressure.
  TIER_THRESH_UP: [0.16, 0.34, 0.55, 0.76] as const,
  TIER_HYSTERESIS: 0.06,
  // Human-readable tier names for the DBG load readout.
  TIER_NAMES: ['idle', 'light', 'med', 'heavy', 'max'] as const,
  // ── Load-driven merge-rate floor ───────────────────────────────────
  // The shard merge / plastic-eat RATE lerps from its full local-density
  // boost at idle DOWN to this floor at peak load (loadLevel = 1).  The
  // density boost speeds merging in crowded pockets, which auto-relieves
  // load — counterproductive when you want to *observe* sustained high-
  // load performance.  Flooring the rate under load (below 1.0× here, vs
  // up to MAX_BOOST=6× at idle) makes the field stop culling itself, so
  // the heavy state persists for testing.  Set to 1.0 to disable.
  MERGE_LOAD_SCALE_MIN: 0.25,
};

// Per-task throttle profiles read by PerfController.registerDefaults().
// minInterval / maxInterval bound the effective frame-skip interval;
// costWeight scales how aggressively the task climbs toward maxInterval
// as the load tier rises (>1 backs off sooner, <1 stays responsive
// longer).  Order here is the registration order, which also assigns the
// deterministic phase offset (0,1,2,…) so equal-interval tasks stagger.
//
//   shardPair / shardTilePair  — migrated from SHARD_*_PAIR_CONSTANTS.
//   colorBlend                 — migrated from NEBULA blend interval.
//   plasticCosmetic            — PAuto neighbour-count scan; backs off
//                                hardest (costWeight 1.2) since it's
//                                purely cosmetic and held stale safely.
//   ai / flowField / nebulaNeighbors / dropScan —
//                                new skippable passes (see PerfController).
//
// `autoCurve` (optional, default 1 = linear) is a convexity exponent on
// the load fraction.  >1 keeps low/mid load responsive then ramps hard
// toward maxInterval near peak.  The shard collision passes use a wide
// 1→128 span with autoCurve 2 so they only reach the very high
// intervals under genuine pressure — letting the field back off harder
// (smoother) at heavy/peak load without over-throttling light fields.
// Resulting shardPair ladder across the 5 tiers (idle…max):
// [1, 9, 33, 72, 128] — vs the old linear-to-32 [1, 9, 17, 24, 32].
export const PERF_TASKS = {
  shardPair:        { minInterval: 1, maxInterval: 128, costWeight: 1.0, autoCurve: 2.0 },
  shardTilePair:    { minInterval: 1, maxInterval: 128, costWeight: 1.0, autoCurve: 2.0 },
  // colorBlend drives the ambient nebula/plastic hue equilibration.  Its
  // visual rate is alpha × (1/interval) — the pass is intentionally NOT
  // skip-compensated, so a lower interval blends FASTER.  minInterval is
  // a deliberate floor (not 1): at low/idle load (which nebula maps now
  // correctly report, since the load signal counts dynamic entities, not
  // the ~1500 static nebula tiles) running it every frame blends ~6× too
  // fast and the per-step palette re-snap reads as the tiles flashing.
  // Flooring at 6 keeps the idle blend calm — matching the cadence these
  // maps saw before the load-signal fix un-throttled it.
  colorBlend:       { minInterval: 6, maxInterval: 16,  costWeight: 0.8, autoCurve: 1.0 },
  plasticCosmetic:  { minInterval: 1, maxInterval: 32,  costWeight: 1.2, autoCurve: 1.0 },
  ai:               { minInterval: 1, maxInterval: 3,   costWeight: 0.7, autoCurve: 1.0 },
  flowField:        { minInterval: 1, maxInterval: 2,   costWeight: 1.0, autoCurve: 1.0 },
  nebulaNeighbors:  { minInterval: 1, maxInterval: 4,   costWeight: 0.9, autoCurve: 1.0 },
  dropScan:         { minInterval: 1, maxInterval: 2,   costWeight: 0.6, autoCurve: 1.0 },
  // O(N²) drop merge pass (DropSystem.mergeDrops).  Up to
  // DROP_CONFIG.MAX_ACTIVE_DROPS² pair-ops + damping + nudges per
  // step; not time-critical (drops settle over many frames), so a
  // 4-step cadence at peak load drops cost ~75 % while staying
  // visually responsive.
  dropMerge:        { minInterval: 1, maxInterval: 4,   costWeight: 0.5, autoCurve: 1.0 },
  // Consume-and-grow neighbour scan (GameEngine.updateConsumers, Stage 3b).
  // O(consumers × nearby candidates); only non-empty once a consumer (bubble /
  // dragon) is on the field, so it early-outs cheaply most of the time and a
  // few-step cadence is imperceptible (eating settles over frames).
  consume:          { minInterval: 1, maxInterval: 4,   costWeight: 0.5, autoCurve: 1.0 },
  // Rival re-acquire + loot-vacuum scan (GameEngine.updateRivals, Stage 7).
  // Two per-rival full-list walks — targeting is O(rivals × live enemies) and
  // the loot vacuum is O(rivals × active drops).  Steering, firing, and the
  // lifecycle still run EVERY step against the cached target (recomputing only
  // the O(1) distance to it), so this cadence only defers WHICH enemy a rival
  // re-picks and WHEN a nearby drop is snatched — both imperceptible.  min 1 →
  // identical to the old every-step behaviour at low load; stretches to 4 only
  // under real pressure (many rivals + a dense wave), exactly when it matters.
  rivalScan:        { minInterval: 1, maxInterval: 4,   costWeight: 0.6, autoCurve: 1.0 },
} as const;

export type PerfTaskId = keyof typeof PERF_TASKS;

// ── LOCAL-density-driven merge / absorption rate ──────────────────────
// Replaces the old global total-entity-count merge-rate ladder.  Rather
// than speeding up EVERY merge when the whole field is crowded, the
// acceleration is focused on the dense pockets (hotspots) that actually
// drive collision cost: a shard's merge/absorb rate scales with the
// occupancy of its local merge-grid cell, and slows as the absorbing
// rock grows (so a big rock consolidates its cluster gradually rather
// than vacuuming it in a spike).  Applied by ShardSystem in tickBonds
// (bond timer + per-frame budget) and the plastic-eat pass; gated by the
// DBG MrgRt toggle (off → neutral 1.0×, no acceleration).
export const LOCAL_MERGE_CONSTANTS = {
  // Local-density boost: a shard whose merge-grid cell holds DENSITY_LO
  // or fewer bodies gets no boost (sparse → 1.0×); at DENSITY_HI or more
  // it gets the full MAX_BOOST; linear between.  Cells are GRAVITY_RANGE
  // (380) wide, so occupancy is a coarse "am I in a crowd" proxy.  Tuned
  // so even a modest huddle (DENSITY_HI) saturates the boost — once
  // shards group up they consolidate quickly.
  DENSITY_LO: 3,
  DENSITY_HI: 10,
  MAX_BOOST: 6.0,
  // Per-frame merge budget multiplier (× CLEANUP_CONSTANTS
  // .MAX_REMOVALS_PER_FRAME) when the rate feature is enabled — caps how
  // many merges fire per tick so a hotspot consolidates over several
  // frames instead of one spike.  1× when disabled.
  BUDGET_MULT: 5,
};

// Blow-back shockwave emitted when shards condense into a tile (glass-
// shard → glass-tile, rock-shard → rock-tile).  Reuses the Plasma Cannon
// shockwave mechanism (an expanding isExplosionRing that pushes entities
// the wavefront reaches) but smaller and NON-damaging — a satisfying
// "pop" as the tile snaps into place that shoves nearby loose shards
// clear without hurting them.  Cannon reference: radius 110, damage 10,
// knockback 6, lifetime 0.35.
export const MERGE_BLOWBACK = {
  RADIUS: 55,        // world units (½ the cannon's reach)
  DAMAGE: 0,         // non-damaging — pure knockback
  KNOCKBACK: 4,      // shove impulse at centre, falls off to 0 at rim
  LIFETIME: 0.22,    // seconds — snappier than the cannon's 0.35
  COLOR: '#a855f7',  // purple — match the plasma cannon shock front
};

// Hot-spot collapse — cure for the overlapping-shard pile-up that the
// throttled shard-pair separation can't disperse under load.  When
// separation runs only every Nth frame, merge-pulled rock/glass shards
// stack on top of each other and visibly pulse in phase with the skip
// interval.  This pass buckets shards into a fine, tile-sized grid; any
// cell holding >= MIN_COUNT shards of one material is a genuine overlap
// stack (at low load separation keeps them touching-but-apart, so a cell
// can't fill — the mechanism is self-gating to the pathology).  Each such
// stack snaps into ONE static tile of that material at the nearest free
// hex (surplus shards fade out), removing the whole pile from the dynamic
// grid in one shot.  A field of stacks therefore condenses into a CLUSTER
// of tiles.  Capped per pass so a big field clears over a few passes
// instead of spiking (and so the per-tile merge blow-back stays sane).
export const HOTSPOT_COLLAPSE = {
  ENABLED: true,
  CELL: 48,                // fine-grid cell ≈ one hex-tile footprint (2×HEX_SIZE=44)
  MIN_COUNT: 4,            // same-material shards stacked in one cell ⇒ collapse
  MAX_TILES_PER_PASS: 6,   // tiles spawned per merge pass (bounds cost + blow-backs)
  // Plastic hotspot collapse removed with plastic-revert — plastic-shards
  // no longer self-merge/condense; the cohesion-only bonds hold the
  // cluster without spawning tiles.
  PLASTIC_ENABLED: false,
  PLASTIC_MIN_COUNT: 4,
  PLASTIC_MAX_SIZE: 80,
  // Metal triangle reassembly into tiles is PAUSED — metal triangles now
  // snap into free-form rigid structures instead (see ShardSystem).  Flip
  // back to true to restore the hex-tile collapse.
  METAL_ENABLED: false,
  METAL_MIN_COUNT: 6,
};

// ── Metal rigid-composite assembly ──────────────────────────────────────
// Loose metal triangles snap into rigid composites on a shared triangular
// lattice (ShardSystem.tickMetalAssembly).  `FORM_RANGE` is the centroid
// distance at which two loose triangles fuse into a 2-cell composite;
// `SNAP_RANGE` is how close a loose triangle's centroid must come to a
// composite's empty boundary cell to lock into it.  Both are multiples of
// a triangle's circumradius R (≈ HEX_SIZE/√3 ≈ 12.7), so they scale with
// the piece size.
//
// DAMPING values are velocity/spin RETENTION factors per 60 Hz step
// (applied as Math.pow(value, timeScale) in PhysicsSystem): 1.0 = lossless
// inertial drift, < 1.0 bleeds motion.  A gentle bleed (≈0.99 ≈ 30 %/s) lets
// a freed composite drift visibly for several seconds, then coast to rest
// and SLEEP — so it stops driving the PerfController's dynamic-load signal
// (asleep shards are excluded from it).  Without this, never-sleeping
// composites accumulate on metal maps and throttle shared passes (which
// starves nebula collision resolution).  REST_SPEED/REST_SPIN snap a
// near-stopped composite to a hard rest so it sleeps cleanly.
// BREAK_SPEED_MULT scales the ejection velocity of the triangle shards a
// metal tile releases when it breaks (applied on the dent-break path in
// DropSystem.spawnDentShard), so the pieces pop apart energetically before
// the assembly pull reels them into a hexagon.
//
// Hexagon lifecycle: every composite builds exactly ONE hexagon (6 triangle
// slots).  Loose triangles snap into its empty slots; once all 6 are filled
// the composite keeps absorbing more loose triangles as invisible "excess"
// mass (metalExcessCells, up to TILE_SNAP.METAL_MAX_EXCESS_CELLS), each +6
// climbing one DENSITY TIER while the composite still shows 6 lattice cells
// (rendered per-cell lighter as depth builds — see RenderSystem).  When the
// speed gate (TILE_SNAP.REST_SPEED_SQ) is satisfied it snaps onto the nearest
// free grid hex as a static metal tile at tier ⌊N/6⌋, releasing only the
// partial-layer remainder as loose triangles.  So the metal cycle closes:
// tile → shatter → triangles → hexagon (+ tiers) → settle → tiered tile.
export const METAL_ASSEMBLY = {
  ENABLED: true,
  FORM_RANGE_R: 1.6,    // × R — loose+loose fuse within this centroid distance
  SNAP_RANGE_R: 1.7,    // × R — loose locks to a composite's empty slot within this
  LINEAR_DAMPING: 0.99, // velocity retention/step (gentle bleed → drift then settle)
  ANGULAR_DAMPING: 0.99,
  // No hard rest-snap (0 = disabled, like rock / glass / plastic shards): a
  // composite coasts to a stop under its damping instead of freezing the
  // instant it dips below a floor.  It still reaches the shard sleep
  // thresholds (SHARD_SLEEP_CONSTANTS), so a completed hexagon still settles
  // and snaps to a tile — just more smoothly.
  REST_SPEED: 0,
  REST_SPIN: 0,
  BREAK_SPEED_MULT: 2.0, // × normal dent-debris speed for metal-tile shards
  SPAWN_SPIN: 1.0,       // ± baseline random spin (rad/s) a composite gets on formation, like loose shards
  RELEASE_POP_SPEED: 1.5, // outward speed given to triangles released on merge overflow
  MERGE_OVERLAP_FACTOR: 0.95, // composites merge when centroid gap < this × sum of bounding radii
};

// ── Metal density (shard-layer) brightness ──────────────────────────
// Metal's coherent "denser = lighter, more polished" cue, driven by a
// DENSITY TIER counted in hexagon layers of 6 shards:
//   - tier 1 (6 shards, one full hexagon) = darkest / least dense FLOOR
//   - each +6 shards = +1 tier = one step lighter, up to METAL_MAX_DENSITY_TIER
// A floating composite accumulates shards (per-cell, see RenderSystem) and
// snaps into a tile at its completed tier; map-load tiles seed their tier
// from cluster neighbour count.  ONE axis (densityTier) drives brightness,
// break-shard count, and tile HP for every metal form, so the look + mass
// survive the tile↔shard↔tile cycle.  (Contrast with rock, which DARKENS
// toward ROCK_AGGREGATION_TINT_FLOOR; metal BRIGHTENS with density.)
export const METAL_HEX_CELLS = 6;                 // shards per hexagon layer (= 1 tier)
export const METAL_MAX_DENSITY_TIER = 6;          // tier cap (rare — 36 shards)
export const METAL_AGGREGATION_BRIGHT_CEIL = 1.5; // brightness at the top tier
// De-white target (material-palette-residual, decision #30 → gauntlet step 5
// G7).  Density brightening used to SCALE every channel by the same factor,
// which drives a mid steel-blue toward its own ceiling on all three channels
// at once — the colour desaturates as it climbs and dense metal ends up
// reading as pale near-white hex.  Brightening toward an explicit SHINY
// STEEL-BLUE instead keeps the material blue at every density, and gives the
// "shiny metal" direction a colour to aim at rather than a brightness knob.
// (Interpolation lives in the renderer; this is the endpoint.)
export const METAL_BRIGHT_TARGET = '#a5d8f0';
// Shards released when a metal tile breaks = densityTier × this.  Below the
// 6/tier it took to BUILD the tile, so ~half the metal is "destroyed" in the
// break — keeps dense clusters from flooding the field with debris.
export const METAL_BREAK_SHARDS_PER_TIER = 3;

/** Brightness multiplier for a metal body at density `tier` (1 = darkest
 *  floor, METAL_MAX_DENSITY_TIER = lightest).  tier ≤ 1 (and loose shards)
 *  return 1 (base); climbs linearly to METAL_AGGREGATION_BRIGHT_CEIL. */
export function metalDensityBrightness(
  tier: number,
  maxTier: number = METAL_MAX_DENSITY_TIER,
): number {
  if (tier <= 1) return 1;
  const t = Math.min(1, (tier - 1) / Math.max(1, maxTier - 1));
  return 1 + t * (METAL_AGGREGATION_BRIGHT_CEIL - 1);
}

// Grace period (seconds) stamped on freshly-shattered rock/glass shards:
// the hot-spot collapse ignores shards younger than this so a just-
// destroyed tile's debris scatters instead of instantly re-condensing.
// DBG-cyclable (perf panel "Grace" button) 0.6 → 3.6s in 0.6s steps.
export const SHATTER_GRACE_CYCLE: ReadonlyArray<number> = [
  0.6, 1.2, 1.8, 2.4, 3.0, 3.6,
] as const;
let activeShatterGraceIndex = 4; // 3.0s
export function getActiveShatterGraceDelay(): number {
  return SHATTER_GRACE_CYCLE[activeShatterGraceIndex];
}
export function getActiveShatterGraceName(): string {
  return SHATTER_GRACE_CYCLE[activeShatterGraceIndex].toFixed(1) + 's';
}
export function cycleShatterGrace(): number {
  activeShatterGraceIndex = (activeShatterGraceIndex + 1) % SHATTER_GRACE_CYCLE.length;
  return activeShatterGraceIndex;
}

// ── Rock-shard condensation grid (5 sizes × 5 densities) ──────────────
// Rock self-merges condense CONTINUOUSLY (any two shards, never refused)
// through a discrete size × density grid, preferring density (denser-
// first / smallest footprint) so a packed cluster collapses into fewer,
// heavier shards that take up less space.  A merge keeps the larger
// input's size and bumps density; it only grows size once density is
// maxed.  The top cell (largest size, max density) is the cap — once a
// shard's mass would exceed it, the shard condenses into a STATIC rock-
// tile (the only tile-forming event, so tiles are rare and form after a
// cluster is already consolidated — they don't get smashed mid-process).
// mass(s,d) = MASS_COEFF × DIAMETERS[s]² × DENSITY_MULT[d]; MASS_COEFF
// matches the rock-shard spawn sizeToMass so a tier-1/density-1 shard
// weighs exactly as much as a freshly spawned 20px rock.
export const ROCK_CONDENSE = {
  // 25 size tiers (diameter) — 5× deeper grid per user direction.  Same
  // ≈ √2 ratio so area still doubles per tier; top diameter ~1500 px
  // (≈ map-quarter) supports very large condensed boulders without
  // exceeding the playfield.
  DIAMETERS: [
    20, 24, 29, 34, 41, 49, 58, 70, 84, 100,
    120, 144, 173, 207, 248, 297, 356, 426, 510, 611,
    731, 875, 1048, 1254, 1500,
  ],
  // 25 density tiers (mass-per-area multiplier) — also 5× deeper.
  // Doubling all the way: a top-tier boulder is 2^24 = 16.8M × denser
  // than a base shard; combined with the 75× larger diameter this
  // makes condensed rocks effectively un-shoveable.
  DENSITY_MULT: [
    1, 2, 4, 8, 16, 32, 64, 128, 256, 512,
    1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288,
    1048576, 2097152, 4194304, 8388608, 16777216,
  ],
  MASS_COEFF: 0.018,
};

export const TRAIL_CONSTANTS = {
  LIFETIME: 2.5, // Seconds until trail part fades completely (longer = exhaust-like plume)
  MIN_DISTANCE_SQ: 30 // Minimum squared distance to move before recording a new trail point
};

// Player thrust trail — small rings emitted from the player position that
// expand outward and fade as they age.  Replaces the older polygon-strip
// exhaust plume.  Each emission is independent (no detached-trail bookkeeping).
export const PLAYER_TRAIL_CONSTANTS = {
  LIFETIME: 3.0,         // Seconds for each ring to expand and fade out
  EMIT_INTERVAL: 0.09,   // Seconds between emissions at full throttle (~11/sec)
  START_RADIUS: 3,       // Ring radius at birth
  END_RADIUS: 32,        // Ring radius at death
  PEAK_ALPHA: 0.75,      // Alpha at birth, linearly fades to 0
  LINE_WIDTH: 2.0,       // Stroke width in world units
  COLOR: '125, 211, 252',// RGB triplet (brighter cyan)
};

export const SHOOTING_STAR_CONSTANTS = {
  MIN_TIMER: 300,
  MAX_TIMER: 700,
  SPEED_MIN: 300,
  SPEED_MAX: 900
};

// ─── The star field ──────────────────────────────────────────────────────────
//
// DENSITY IS PER UNIT AREA, NOT A FIXED COUNT.  The star count used to be
// absolute — 60 bands x 400 stars = 24 000 stars over whatever the viewport
// happened to be — so a smaller window was a denser sky.  Measured (gauntlet
// star field, S1): a 390x844 phone showed 729 stars per 10k CSS px^2 against
// 185 on a 1440x900 desktop window, a 3.95x density delta over a 3.94x area
// ratio.  On the phone that put 26.9% of every pixel on screen inside a star,
// which reads as TV static rather than as a sky.
//
// The unit is CSS px^2, not device px^2, and that is deliberate: a star should
// subtend the same apparent size whatever the display's pixel ratio, and CSS
// px is the unit that means "apparent size".  `BackgroundManager` derives its
// scene size as `canvas.width / effectiveDpr()`, which is exactly the CSS
// viewport, so the two agree by construction.
export const STARFIELD_CONSTANTS = {
  /** Scroll rate of the FARTHEST depth layer, as a fraction of camera motion.
   *  Not zero: a layer pinned to the camera reads as a texture stuck to the
   *  screen rather than as distant sky. */
  DEPTH_FLOOR: 0.02,
  /** Where the milky way sits in the depth range, as a `t` in [0, 1] on the
   *  same quadratic curve the depth layers use.  Expressed as a DEPTH rather
   *  than a fixed speed so it keeps its place in the stack when the parallax
   *  spread is changed — a hardcoded rate would drift relative to everything
   *  else.  0.0707 reproduces its original 0.03 at the default spread. */
  MILKY_WAY_DEPTH: 0.0707,
  /** Milky-way stars per 1000 CSS px of viewport WIDTH.  The milky way is a
   *  LINE feature — its stars are placed along a diagonal spanning the
   *  viewport width — so it scales linearly with width, where the star field
   *  proper scales with area.  Anchored to the phone's original count (80 at
   *  390 px wide): it is an authored feature that should still read on the
   *  target device, and it spent its whole life buried under the haze that
   *  the density fix above removes. */
  MILKY_WAY_PER_1K_WIDTH: 205,
} as const;

// ─── DBG: parallax depth layers ──────────────────────────────────────────────
//
// How many discrete scroll speeds the field is quantised into.  The star budget
// is split evenly across them, so this changes the SMOOTHNESS OF THE DEPTH and
// not the density.
//
// This was 60 and effectively frozen there, because a layer used to BE a
// full-viewport canvas: 60 of them cost 80 MB on a phone and 316 MB on a
// desktop window, so more depth meant more memory in whole megabytes.  Since
// the field became data (S4) a layer is five numbers and a scroll accumulator —
// 240 layers cost about 10 KB and 240 float updates per frame — so depth is
// essentially free and there is no longer a reason to be stingy with it.
//
// 240 IS THE DEFAULT (user call, on the S6 evidence): 4x the depth granularity
// at no measurable cost.  60 stays in the cycle as the pre-S6 value.
export const STAR_BANDS_CYCLE: ReadonlyArray<number> = [240, 120, 480, 60] as const;
let activeStarBandsIndex = 0;
export function getActiveStarBands(): number { return STAR_BANDS_CYCLE[activeStarBandsIndex]; }
export function getActiveStarBandsName(): string { return `${STAR_BANDS_CYCLE[activeStarBandsIndex]}`; }
export function cycleStarBands(): number {
  activeStarBandsIndex = (activeStarBandsIndex + 1) % STAR_BANDS_CYCLE.length;
  return STAR_BANDS_CYCLE[activeStarBandsIndex];
}

// ─── PER-MAP SKY: ALTITUDE, DENSITY AND PARALLAX ─────────────────────────────
//
// Every map gets its OWN star density, and its parallax spread follows from
// that density rather than being set beside it.
//
// The idea the numbers encode is ALTITUDE.  A map high in deep space shows a
// dense, distant sky whose layers barely separate as you move.  A map low near
// a planet or a landing site shows fewer stars, and the ones it does show sweep
// past with much more depth separation because you are closer to everything.
// So DENSITY FALLS and PARALLAX RISES as you descend, and the hub's test-portal
// column is arranged vertically to match: the LOWER a portal sits on the map,
// the LOWER the density behind it.
//
// The inverse relation is DERIVED, not hand-maintained.  Writing two numbers
// per map and trusting them to stay anti-correlated is exactly the kind of
// pairing that drifts the first time someone tunes one of them, so a map
// declares only its density and `parallaxForDensity` does the rest.  If a map
// ever needs to break the relation, that is the moment to add an override
// field — not before.
export const STAR_DENSITY_RANGE = {
  /** Lowest sky — closest to a planet.  Below the old 185 floor, per the
   *  "perhaps a layer lower than this" the range was asked for with. */
  MIN: 90,
  /** Densest sky — deep space, far from anything. */
  MAX: 729,
} as const;

/** Parallax spread at each end of the density range.  Inverted on purpose:
 *  sparse skies are NEAR skies, and near things separate more as you move. */
export const STAR_PARALLAX_RANGE = {
  AT_MIN_DENSITY: 8,
  AT_MAX_DENSITY: 1,
} as const;

/** The inverse relation, in one place.  Linear in density between the two
 *  endpoints, clamped outside them so a hand-set override cannot produce a
 *  negative or absurd spread. */
export function parallaxForDensity(density: number): number {
  const { MIN, MAX } = STAR_DENSITY_RANGE;
  const t = Math.max(0, Math.min(1, (density - MIN) / (MAX - MIN)));
  const { AT_MIN_DENSITY, AT_MAX_DENSITY } = STAR_PARALLAX_RANGE;
  return AT_MIN_DENSITY + t * (AT_MAX_DENSITY - AT_MIN_DENSITY);
}

/** Each map's sky, as a single number: stars per 10 000 CSS px^2.
 *
 *  Read as ALTITUDE — high value = high above everything = dense distant sky.
 *  The six showcase fields are the test ladder the hub's portal column steps
 *  through, so their values are spread evenly across the whole range and their
 *  ORDER here matches the portals' vertical order on the hub. */
export const STAR_DENSITY_BY_MAP: Record<MapType, number> = {
  // The hub is home: high, open, and the densest sky in the game.
  [MapType.OVERWORLD]:            729,

  // Wave arenas, descending.
  [MapType.UNIVERSE]:             650,
  [MapType.RING]:                 520,
  [MapType.SEVEN_RINGS]:          420,
  [MapType.POCKET]:               300,

  // The test ladder — evenly spread MIN..MAX, matching the hub column.
  [MapType.ASTEROID_FIELD]:       729,
  [MapType.GLASS_FIELD]:          600,
  [MapType.METAL_FIELD]:          460,
  [MapType.PLASTIC_FIELD]:        330,
  [MapType.ROCK_FIELD]:           185,
  [MapType.NEBULA_FIELD]:          90,

  // Remaining showcase maps — not on the ladder, sensible middles.
  [MapType.INDESTRUCTIBLE_FIELD]: 400,
  [MapType.TILE_HEAVY]:           400,
};

// ─── DBG: star density and parallax ──────────────────────────────────────────
//
// Both cycles lead with AUTO (0), which means "use this map's own value" — the
// per-map table above.  The explicit steps are OVERRIDES, for comparing two
// settings on one map without flying somewhere else.
//
// The panel shows the resolved number alongside, e.g. `Auto 185`, so the map's
// current sky is legible without a detour into the source.
//
// A density override does NOT drag parallax with it: the two DBG rows are
// independent so either can be isolated. The DERIVED inverse relation applies
// to the per-map values, which is where it belongs.
//
// The cycle runs PAST the top of STAR_DENSITY_RANGE on purpose.  1200 was
// reported handling easily on a mobile browser at the 'device' star size, and
// the pre-gauntlet phone sky measured ~2693 stars per 10k CSS px^2 — so the
// steps above MAX exist to reach the density the field used to have, which is
// the one comparison the per-map ladder cannot make on its own.  They are
// OVERRIDES only: no map declares a density above MAX, because the parallax
// relation is defined across the range and `parallaxForDensity` merely clamps
// beyond it.  If one of these ever becomes a map's own value, raise MAX and
// re-space the ladder rather than leaving a map outside the range.
export const STAR_DENSITY_CYCLE: ReadonlyArray<number> =
  [0, 729, 400, 185, 90, 1200, 1800, 2700] as const;
let activeStarDensityIndex = 0;
export function getStarDensityOverride(): number { return STAR_DENSITY_CYCLE[activeStarDensityIndex]; }
export function cycleStarDensity(): number {
  activeStarDensityIndex = (activeStarDensityIndex + 1) % STAR_DENSITY_CYCLE.length;
  return STAR_DENSITY_CYCLE[activeStarDensityIndex];
}
/** The density actually used for `mapType` — the override if one is set,
 *  otherwise the map's own value. */
export function resolveStarDensity(mapType: MapType): number {
  const o = getStarDensityOverride();
  return o > 0 ? o : (STAR_DENSITY_BY_MAP[mapType] ?? STAR_DENSITY_RANGE.MAX);
}
export function getActiveStarDensityName(mapType?: MapType): string {
  const o = getStarDensityOverride();
  if (o > 0) return `${o}`;
  return mapType === undefined ? 'Auto' : `Auto ${resolveStarDensity(mapType)}`;
}

export const STAR_PARALLAX_CYCLE: ReadonlyArray<number> = [0, 2, 4, 8, 1, 0.5] as const;
let activeStarParallaxIndex = 0;
export function getStarParallaxOverride(): number { return STAR_PARALLAX_CYCLE[activeStarParallaxIndex]; }
export function cycleStarParallax(): number {
  activeStarParallaxIndex = (activeStarParallaxIndex + 1) % STAR_PARALLAX_CYCLE.length;
  return STAR_PARALLAX_CYCLE[activeStarParallaxIndex];
}
/** The spread actually used for `mapType`: the override if set, otherwise
 *  derived from the map's density so the inverse relation always holds. */
export function resolveStarParallax(mapType: MapType): number {
  const o = getStarParallaxOverride();
  if (o > 0) return o;
  return parallaxForDensity(STAR_DENSITY_BY_MAP[mapType] ?? STAR_DENSITY_RANGE.MAX);
}
export function getActiveStarParallaxName(mapType?: MapType): string {
  const o = getStarParallaxOverride();
  if (o > 0) return `${o}x`;
  return mapType === undefined ? 'Auto' : `Auto ${resolveStarParallax(mapType).toFixed(1)}x`;
}

// STAR REGIONS (non-uniform density across the map) WERE TRIED AND REMOVED.
//
// The idea was that density would vary by WHERE IN THE MAP the camera sits —
// fly into a rich region and the sky fills in, fly into a void and it thins
// out — implemented as a torus-periodic plane-wave field gating a prefix of
// each draw group.  It worked as specified and it read as a defect: stars
// appearing and disappearing in view.  The edge fade bought smoothness, not
// legitimacy — the stars still arrived and left in front of the player, which
// is not something a sky does.  See the S13 decision in the ledger, and S7 for
// the flow field this was NOT built on and why.
//
// The parts worth keeping are recorded rather than the code: a field built
// from INTEGER wave vectors is exactly periodic over the map and therefore
// seam-continuous on the torus, and those vectors must share NO COMMON FACTOR
// or the same regions tile several times across the map.  Anything that varies
// the backdrop spatially will need both facts again.

// STAR MOTION IS SUB-PIXEL, AND THERE IS NO LONGER A CHOICE ABOUT IT.
//
// Stars are drawn at their exact fractional position, so the field scrolls
// continuously at any speed.  Canvas antialiases the rect across the pixels it
// straddles, which makes a star marginally softer than a pixel-snapped one.
//
// A 'crisp' pixel-snapped mode existed briefly and was REMOVED after testing:
// snapping is what made the field jitter at low ship speeds (measured at 99% of
// stars frozen on any given frame at ship speed 2), and no amount of sharpness
// paid for that.  A per-star dither was tried before it and was worse still.
// Both are recorded in docs/GAUNTLET_STARFIELD_LOG.md (S8, S9, S10) so the dead
// ends are not re-explored.
//
// Snapping was never load-bearing for correctness, which is the part worth
// remembering: the cross-browser bug this gauntlet started from was the
// `drawImage` BLIT FILTER on the old pre-rendered band canvases, and those
// canvases are gone.  What remains is fillRect coverage antialiasing on an
// axis-aligned rect — analytic, and consistent across engines.

// ─── DBG: star size floor ────────────────────────────────────────────────────
//
// Star bands are generated at DEVICE resolution and blitted 1:1 at whole
// device-pixel offsets, so a star occupies exactly the pixels it is drawn into
// and no resampling filter is in the path (see the star-field gauntlet, S3).
// That makes the SIZE FLOOR a real choice for the first time — before, every
// star was a 1-CSS-px fillRect at a fractional origin, which antialiased into
// a ~2x2 smear and then got filtered again on the way to the screen.
//
//   'device' — a star may be a single DEVICE pixel: max(1, round(size x dpr)).
//              The finest, sharpest sky a display can show; on a dpr-2 phone
//              most stars become 1-2 device px.  DEFAULT.
//   'css'    — a star is never smaller than one CSS pixel: the apparent-size
//              floor the field had before S3, but crisp instead of filtered.
//
// At dpr 1 the two are IDENTICAL — the knob only differs where the problem
// was, which is dpr >= 2.
export type StarSizeMode = 'device' | 'css';
export const STAR_SIZE_CYCLE: ReadonlyArray<StarSizeMode> = ['device', 'css'] as const;
let activeStarSizeIndex = 0;
export function getActiveStarSizeMode(): StarSizeMode { return STAR_SIZE_CYCLE[activeStarSizeIndex]; }
export function getActiveStarSizeName(): string {
  return STAR_SIZE_CYCLE[activeStarSizeIndex] === 'device' ? 'Device px' : 'CSS px';
}
export function cycleStarSize(): StarSizeMode {
  activeStarSizeIndex = (activeStarSizeIndex + 1) % STAR_SIZE_CYCLE.length;
  return STAR_SIZE_CYCLE[activeStarSizeIndex];
}

export const PLAYER_MOVEMENT_CONFIG: Record<MapType, { maxSpeed: number, acceleration: number, friction: number }> = {
  [MapType.OVERWORLD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.UNIVERSE]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.RING]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.SEVEN_RINGS]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.POCKET]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  // Single-element 6k showcase maps — keep movement identical to the
  // other full-size maps so the element under test is the only variable.
  [MapType.ASTEROID_FIELD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.GLASS_FIELD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.PLASTIC_FIELD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.METAL_FIELD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.INDESTRUCTIBLE_FIELD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.NEBULA_FIELD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.ROCK_FIELD]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
  [MapType.TILE_HEAVY]: {
    maxSpeed: 120,
    acceleration: 0.085,
    friction: 0.998
  },
};

// DBG runtime multipliers on the per-map player movement config so the
// PThr / PSpd buttons can A/B-test feel without a rebuild.  Both read
// live in GameEngine.updatePlayerMovement(): effective acceleration =
// config.acceleration × thrust-mult, effective maxSpeed = config.maxSpeed
// × speed-mult.  Note the coupling: terminal cruise is friction-limited
// at acceleration/(1−friction), so the THRUST cycle is what actually
// raises everyday top speed; the SPEED cycle only bites once the cap
// drops below (or thrust pushes cruise above) that terminal velocity.
export const PLAYER_THRUST_CYCLE: ReadonlyArray<number> = [
  0.75, 1.0, 1.25, 1.5,
] as const;
export const PLAYER_SPEED_CYCLE: ReadonlyArray<number> = [
  0.5, 0.75, 1.0, 1.5, 2.0, 3.0,
] as const;

let activePlayerThrustIndex = 0; // 0.75× — default a touch below base, room to ramp up
let activePlayerSpeedIndex = 2;  // 1.0× — base config cap

export function getActivePlayerThrustMult(): number {
  return PLAYER_THRUST_CYCLE[activePlayerThrustIndex];
}
export function getActivePlayerThrustName(): string {
  return `${PLAYER_THRUST_CYCLE[activePlayerThrustIndex]}×`;
}
export function cyclePlayerThrust(): number {
  activePlayerThrustIndex = (activePlayerThrustIndex + 1) % PLAYER_THRUST_CYCLE.length;
  return activePlayerThrustIndex;
}

export function getActivePlayerSpeedMult(): number {
  return PLAYER_SPEED_CYCLE[activePlayerSpeedIndex];
}
export function getActivePlayerSpeedName(): string {
  return `${PLAYER_SPEED_CYCLE[activePlayerSpeedIndex]}×`;
}
export function cyclePlayerSpeed(): number {
  activePlayerSpeedIndex = (activePlayerSpeedIndex + 1) % PLAYER_SPEED_CYCLE.length;
  return activePlayerSpeedIndex;
}

export const STRUCTURE_CONSTANTS = {
  SIZE: 30,
  HEALTH: 1, // Single shot destroy
  MASS: Infinity, // Immovable walls
  CRASH_VELOCITY_THRESHOLD: 4, // Player speed needed to break through
  // AUDIO ONLY (no gameplay effect): the relative speed above which player
  // contact with a MOBILE SHARD makes a sound.  Far below the break
  // threshold above, because a loose rock knocking off the hull is an
  // audible event long before it is a destructive one — gating shard
  // contact at the break speed made ordinary bumping silent.  PROVISIONAL.
  SHARD_CONTACT_SPEED: 1.2,
  // Fraction of velocity the player KEEPS per breakable-tile crash-
  // through.  At 0.5 a 3-tile plow retained ~12 % of entry speed and
  // read as bouncing off the cluster; 0.65 retains ~27 % and reads as
  // shoving through while still costing something.
  // Static tiles take the full cut.  Mobile shards scale the cut by
  // min(1, shard.mass / player.mass) and receive the shed momentum
  // (Δv capped at (1 − retention) × player speed for light shards),
  // so plowing a pebble field doesn't bleed the player dry and the
  // debris of a killed rock carries the crash velocity forward.
  CRASH_VELOCITY_RETENTION: 0.65,
  // Momentum threshold (asteroid.mass × impactSpeed) above which an
  // asteroid plows through a tile permanently.  At 200 a cruising
  // size-100 merged cluster just barely crashes, while a 20-mass
  // shard at drift speed doesn't.
  ASTEROID_CRASH_MOMENTUM: 200,
  // Pressure accumulator — sustained sub-crash-momentum impacts from
  // "large enough" asteroids also break a tile permanently, simulating
  // repeated-impact pressure without a full stress model.  A tile
  // breaks the first time its accumulator reaches ASTEROID_PRESSURE_HITS
  // within the rolling ASTEROID_PRESSURE_WINDOW.  Only asteroids with
  // mass ≥ ASTEROID_PRESSURE_MIN_MASS contribute, so trivial drift
  // shards don't count.  ASTEROID_PRESSURE_COOLDOWN debounces multi-
  // substep re-hits from a single bouncing rock.
  ASTEROID_PRESSURE_HITS: 5,
  ASTEROID_PRESSURE_WINDOW: 2.0,
  ASTEROID_PRESSURE_MIN_MASS: 40,
  ASTEROID_PRESSURE_COOLDOWN: 0.1,
  TILE_REGEN_DELAY: 12, // Seconds before a destroyed tile reappears
};

// ── Tile variants ───────────────────────────────────────────────────────────
// Every STRUCTURE tile belongs to one variant. The variant drives how much
// damage the tile can soak, its sprite, and whether it can be destroyed at
// all.  Damage-state visualisation is procedural (see renderCracks in
// RenderSystem) — same approach asteroids use — so variants only need one
// sprite each, not a per-tier atlas.
//
// Glass (default) is single-hit to match the original behaviour.
// Plastic and metal add intermediate HP.  Indestructible tiles never
// take damage and never regenerate — they're permanent walls.
export const STRUCTURE_VARIANTS = {
  glass: {
    health: 1,
    mass: Infinity,
    indestructible: false,
    sprite: ASSETS.HEX_STRUCTURE,
    color: COLORS.STRUCTURE,
  },
  plastic: {
    // 8 HP — plastic dents progressively over ~8 hits, then bursts
    // into a cluster of plastic-shards.  Deliberately lighter than
    // metal (24) so plastic reads as a softer, more fragile material
    // both in look (deep soft denting) and toughness.  Per-shard
    // durability (12 HP) is set on `plastic-tile.dent.shardHealth`.
    health: 8,
    mass: Infinity,
    indestructible: false,
    // sprite left empty so RenderSystem falls through to the polygon
    // material-tile branch (solid fill + selective outline + dent).
    // ASSETS.HEX_STRUCTURE_PLASTIC is kept in the manifest for a
    // future per-variant sprite.
    sprite: '',
    color: COLORS.STRUCTURE_PLASTIC,
  },
  metal: {
    // 24 HP — 3× the original 8 — so the player has to commit to
    // breaking a tile free.  Same hit count as plastic but reads as
    // harder via the subtle per-hit dent and the post-break
    // fragmentation (two shards instead of one).
    health: 24,
    mass: Infinity,
    indestructible: false,
    // sprite left empty so the polygon fallback fires — see plastic above.
    sprite: '',
    color: COLORS.STRUCTURE_METAL,
  },
  indestructible: {
    // Sentinel health — tile is never destroyed, but keep a finite positive
    // value so any stray damage arithmetic doesn't flip it negative.
    health: 9999,
    mass: Infinity,
    indestructible: true,
    sprite: ASSETS.HEX_STRUCTURE_INDESTRUCTIBLE,
    color: COLORS.STRUCTURE_INDESTRUCTIBLE,
  },
  // Stage 7: rock-tile family — clusters of solid rock that shatter
  // into rock-shards on death (the unified "tile is the parent of
  // every shard" architecture, see docs/SHARD_SYSTEM.md).  Visual:
  // slate / gray to read as rock; HP between glass (1) and heavy (5).
  // Sprite intentionally unset so the renderer falls through to the
  // asteroid polygon path (solid entity.color fill).  This makes
  // rock-tiles read with the same texture as rock-shards rather than
  // the glass-aesthetic translucent hex.
  rock: {
    // 5 HP (was 3) — modest bump so the seeded damage-crack overlay has
    // room to accrue a couple of fractures (one per ~1.3 hits, see
    // MATERIAL_DAMAGE_CRACKS) before the tile shatters.  Still brittle.
    health: 5,
    mass: Infinity,
    indestructible: false,
    sprite: '',
    color: COLORS.ASTEROID,
  },
} as const;

export type StructureVariant = keyof typeof STRUCTURE_VARIANTS;

// ── Rock break model (probabilistic, size/density-scaled) ──────────────────
// Rock tiles / asteroids / rock-shards no longer break at a flat HP.  Each
// entity's maxHealth is repurposed as a HIT CEILING: it always cracks on the
// first hit (never breaks), and from the second hit on every blaster hit
// rolls an EARLY break whose odds climb toward a guaranteed break at the
// ceiling.  The ceiling scales with size (and density), so small rocks cap at
// MIN_HITS and big / dense boulders ride up to MAX_HITS — bigger rocks resist
// longer because the same hit number is a smaller fraction of their ceiling.
//
//   ceiling      = rockHitCeiling(size, densityTier)   (MIN_HITS..MAX_HITS)
//   breakChance  = ((hitsTaken - 1) / (ceiling - 1)) ^ CURVE   (0 at hit 1,
//                  1 at the ceiling)
export const ROCK_BREAK = {
  MIN_HITS: 4,   // smallest rock — crack, then ~50/50 break on hits 2-3, forced by 4
  MAX_HITS: 6,   // largest / densest boulder
  SIZE_MIN: 20,  // size mapping to MIN_HITS
  SIZE_MAX: 160, // size mapping to MAX_HITS (linear between, clamped outside)
  // Density tiers add to the ceiling: +1 hit per this many tiers (clamped
  // to MAX_HITS).  Keeps condensed rock-shards / merged boulders meatier.
  DENSITY_TIERS_PER_BONUS: 8,
  // Break-curve exponent.  1 = linear rise to a guaranteed break at the
  // ceiling.  >1 delays the odds (rocks resist longer); <1 front-loads them.
  CURVE: 1.0,
} as const;

// Size/density → hit ceiling (also the entity's maxHealth).
export function rockHitCeiling(size: number, densityTier?: number): number {
  const span = ROCK_BREAK.SIZE_MAX - ROCK_BREAK.SIZE_MIN;
  const t = Math.max(0, Math.min(1, (size - ROCK_BREAK.SIZE_MIN) / span));
  let hits = ROCK_BREAK.MIN_HITS + Math.round(t * (ROCK_BREAK.MAX_HITS - ROCK_BREAK.MIN_HITS));
  if (densityTier !== undefined && densityTier > 0) {
    hits += Math.floor(densityTier / ROCK_BREAK.DENSITY_TIERS_PER_BONUS);
  }
  return Math.max(ROCK_BREAK.MIN_HITS, Math.min(ROCK_BREAK.MAX_HITS, hits));
}

// Early-break probability after `hitsTaken` hits given the entity's ceiling.
// 0 on the first hit (always cracks), 1 once the ceiling is reached.
export function rockBreakChance(hitsTaken: number, ceiling: number): number {
  if (hitsTaken <= 1) return 0;
  if (hitsTaken >= ceiling) return 1;
  const frac = (hitsTaken - 1) / (ceiling - 1);
  return Math.pow(frac, ROCK_BREAK.CURVE);
}

// ── Rock chipping (conservation of mass) ───────────────────────────────────
// The base material layer.  Every NON-killing hit on a rock entity (tile or
// asteroid) cracks (the seeded overlay) and CHIPS one piece off the parent:
//  - usually pulverised dust — a tinted nebula-shard,
//  - sometimes (ROCK_FRACTION) a solid rock-shard chunk.
// Mobile asteroids shrink by the chip's footprint so the rock's mass is
// ~conserved across its life (static tiles can't move off their hex, so they
// conserve via the in-place dent); the killing hit breaks the remainder into
// multiple pieces via the shatter path.  See GameEngine.releaseRockChip.
export const ROCK_CHIP = {
  // Perf: not every non-killing hit shedds a chip — most just crack (the
  // overlay).  Lower this to thin the chip-entity stream (render + sim cost);
  // raise toward 1 for the old "chip every hit" feel.  "Sometimes chips."
  CHIP_CHANCE:      0.7,  // P(a non-killing hit emits ANY chip; else just cracks)
  ROCK_FRACTION:    0.5,  // of emitting hits: P(solid rock-shard chunk); else dust roll
  // Dust nebula-shards are the priciest entity to render (tinted sprites) and
  // they accumulate (no lifetime — only clear via merge/shot), so a dust roll
  // only actually puffs this fraction of the time.  Keeps occasional ambient
  // dust without flooding the field.
  DUST_CHANCE:      0.5,
  ROCK_SIZE_FRAC:   0.45, // solid chip diameter ÷ parent effective diameter
  NEBULA_SIZE_FRAC: 0.5,  // dust-puff diameter ÷ parent effective diameter
  // Dust is mostly pulverised vapour, so it removes only this fraction of its
  // footprint from a mobile parent — a shard whittled by dust alone still
  // slims down, but far slower than one losing solid chunks.
  NEBULA_MASS_FRAC: 0.25,
  MIN_SHARD_DIAM:   12,   // never shrink a mobile rock-shard below this diameter
  // Below this parent diameter a hit can't shed a SOLID chunk (it would be a
  // useless sliver) — tiny shards only puff dust until they break.
  SOLID_MIN_PARENT_DIAM: 30,
} as const;

// ── Material damage cracks ─────────────────────────────────────────────────
// Drives the seeded fracture overlay (RenderSystem.drawDamageCracks) for the
// rocky / metal destructibles.  Rock now caps at 4-6 hits (ROCK_BREAK), so it
// shows one crack per hit (freq 1) up to MAX_HITS — the escalating fracture
// reads the accumulating damage.  Metal stays tough and quiet.
//
//   crackCount = min(cap, floor((maxHealth - health) / freq))
//
// `maxHealth` is the LIVE value (metal scales it ×densityTier; rock's is its
// hit ceiling), so denser bodies crack proportionally up to the cap.
export const MATERIAL_DAMAGE_CRACKS = {
  // Rock: one crack per hit (maxHealth is the hit ceiling), capped at the
  // largest ceiling so a 6-hit boulder can show all six fractures.
  rock:  { freq: 1, cap: ROCK_BREAK.MAX_HITS },
  // Metal tiles (24 HP) + metal composites: tough, so cracks accrue slowly —
  // first split after ~5 hits, capped at 5 so even a dense block stays read.
  metal: { freq: 5,   cap: 5 },
} as const;

// ── Nebula tile configuration ──────────────────────────────────────────────
// Nebula tiles share the same hex grid as glass (STRUCTURE) tiles but are
// pass-through debris: players and enemies drift through them, shattering
// them into cloud-like shards with heavy linear & angular damping.  Each
// collision spawns SHARDS_PER_SHATTER children whose total disc area equals
// the parent's area (scaled by SHARD_TOTAL_AREA_RATIO) — the cloud keeps
// coverage constant on impact, and a gravity-driven merge pass re-absorbs
// small shards back into larger neighbours to re-form tiles over time.
export const NEBULA_CONSTANTS = {
  // Per-shatter child count and explicit linear size ratio.
  // child_diameter = parent_diameter × SHARD_LINEAR_RATIO.  At 0.60 with
  // N = 3, total child area = 3 × 0.36 = 1.08 × parent — a modest 8 %
  // growth per shatter.  Permanent area inflation is checked by tile
  // regeneration (grown tiles revert to canonical hex size on respawn).
  SHARDS_PER_SHATTER: 3,
  SHARD_LINEAR_RATIO: 0.60,
  // Minimum diameter below which a shard is no longer shatter-able.  Keeps
  // the system bounded under repeated impacts — sub-min shards simply
  // pass-through without fragmenting further.
  MIN_SHATTER_DIAMETER: 10,
  // Seconds a PLAYER/ENEMY must wait after shattering a nebula before they
  // can shatter another.  Prevents a single fly-through from ripping an
  // entire cluster apart simultaneously.  140 px/s × 0.2 s ≈ 28 px traversal
  // ≈ one tile width, so roughly every other tile gets broken in a row.
  IMPACT_COOLDOWN: 0.2,
  // How far from the destroyed parent's centre to spawn new shards, in
  // multiples of the parent's radius.  At 1.5 they sit ~0.75 tile-widths
  // behind the striker — close enough that the "dragged along" visual
  // reads well, far enough that the re-collision cooldown (IMPACT_COOLDOWN)
  // safely clears before the player overlaps the shard again.
  SHARD_SPAWN_OFFSET_RATIO: 1.5,
  // Regen delay: nebula tiles reappear after this many seconds.  Much
  // shorter than the glass-tile cadence (12 s) — nebulae are the
  // "soft" cloud layer, they should heal quickly so clusters don't
  // stay punched-out behind the player for long.
  REGEN_DELAY: 3,
  // Base (slow-collision) fade durations.  Actual per-entity durations
  // scale inversely with impact speed via nebulaFadeRateScale() — a
  // fast collision produces a shorter, snappier fade while a gentle
  // drift-through keeps the slow graceful dissolution.
  FADE_DURATION: 1.0,
  FADE_IN_DURATION: 1.5,
  // Impact-speed → fade-rate mapping.  impactSpeed/REFERENCE_SPEED gives
  // the rate scale, clamped to [1, MAX_SCALE].  At rateScale = 1 the
  // base durations above are used; higher scales divide the duration
  // (faster fade).  REFERENCE_SPEED is in px/frame — a "moderate"
  // collision (about half player max thrust) maps to rateScale > 1.
  FADE_RATE_REFERENCE_SPEED: 1.0,
  FADE_RATE_MAX_SCALE: 3.0,
  // Per-frame damping (60Hz reference).  Applied as
  //   velocity *= Math.pow(damping, dt * 60)
  // so behaviour is framerate-independent.  Values closer to 1.0 = less
  // damping = shards drift longer.  LINEAR at 0.97 → velocity halves
  // in ~23 frames (~0.38 s).  Nebula shards already skip the flow-
  // field velocity correction (see GameEngine.applyFlow), so this
  // damping only has to bleed off transient kicks (shatter scatter,
  // gravity pull, collision impulse) — 0.97 lets the cloud drift
  // briefly after a kick instead of slamming to a halt.
  LINEAR_DAMPING: 0.97,
  ANGULAR_DAMPING: 0.98,
  // Speed-based opacity falloff for shards — fast shards read slightly
  // translucent, settled shards are fully opaque.  Applied as
  //   mul = max(SHARD_SPEED_OPACITY_MIN, 1 − speedSq × SHARD_SPEED_OPACITY_K)
  // in RenderSystem.  Uses speed-squared so we skip the sqrt; the
  // coefficient K is tuned against typical launch speeds (2–5 px/frame
  // → speedSq 4–25) to drop opacity by ~0.25 at peak scatter.
  SHARD_SPEED_OPACITY_K:   0.01,
  SHARD_SPEED_OPACITY_MIN: 0.75,
  // Velocity below which shards snap to rest (prevents infinite micro-drift).
  REST_SPEED: 0.005,
  REST_SPIN: 0.01,
  // ── Velocity-aligned stretch (nebula shard) ──────────────────────
  // Continuous render-side deformation: while a nebula-shard moves,
  // it stretches along its velocity axis (1 + K × speed, capped at
  // MAX_STRETCH) and squashes perpendicular by SQUASH_RATIO ×
  // stretch.  Reads as "wind tugging the cloud forward."  Cost
  // gated on speed² > VEL_STRETCH_REST_SPEED_SQ so settled shards
  // skip the math.  Always uses the "free" rotation mode — only
  // the squash axis aligns to velocity, the sprite keeps
  // entity.rotation.
  //
  // The K multiplier is selected at runtime from VEL_STRETCH_K_CYCLE
  // via the DBG NStr button — getActiveNebulaStretchK() returns
  // the current value.  K = 0 disables the stretch entirely.
  VEL_STRETCH_REST_SPEED_SQ: 0.01,
  VEL_STRETCH_MAX:           0.4,
  VEL_STRETCH_SQUASH_RATIO:  0.6,
  // Rotation magnitude applied to shards at shatter.  Scales with striker speed.
  SPIN_PER_UNIT_SPEED: 1.2,
  MAX_SPIN: 6.0,  // rad/s cap
  // Post-shatter shard velocity: shards are "dragged along" in the
  // striker's direction of travel (forward-biased) rather than pushed
  // away perpendicular to it.  Parallel component dominates; a tiny
  // perpendicular push based on tangent side gives each shard a slight
  // lateral drift that matches its rotation direction.
  //
  // At FORWARD_DRAG_FACTOR = 0.9 with LINEAR_DAMPING = 0.991, shards
  // launch a bit slower than the striker and decay more gently, so the
  // total coast distance is preserved while per-frame motion feels
  // noticeably slower.  The 0.75× scaling of launch velocities is
  // matched by a 0.75× scaling of (1 − damping), keeping
  // ∫V₀·d^t·dt = V₀/(1−d) constant.
  //
  // parallel_velocity = max(MIN_PARALLEL_SPEED,
  //                         impactSpeed × FORWARD_DRAG_FACTOR)
  // perp_velocity     = impactSpeed × PERP_SCATTER_FACTOR
  FORWARD_DRAG_FACTOR: 0.9,
  PERP_SCATTER_FACTOR: 0.03,
  MIN_PARALLEL_SPEED: 0.225,
  // Shatter fan half-angle — 3 children are spread symmetrically around
  // the striker's forward direction within ±FAN_HALF_ANGLE.
  FAN_HALF_ANGLE: Math.PI / 3,  // 60° (so ±60° → 120° full fan)
  // Gravity pull: each shard is attracted to the nearest larger nebula
  // entity within GRAVITY_RANGE.  The force curve is G / max(dist, MIN).
  // Stronger pull shortens the drift-to-merge beat; paired with heavier
  // LINEAR_DAMPING below so shards don't overshoot their target.
  GRAVITY_RANGE: 380,
  GRAVITY_STRENGTH: 380,
  GRAVITY_MIN_DIST: 15,
  // Player→nebula-shard swirl (PhysicsSystem.applyNebulaPlayerPull).
  // The player↔nebula-shard interaction mirrors the player↔nebula-TILE
  // feel: a pure PASS-THROUGH (no SAT bounce) plus a soft ROTATION push,
  // so the ship swirls the cloud in its wake instead of shoving it.
  // Active every substep the ship is within PLAYER_PULL_RANGE of a
  // nebula-shard; falloff is linear (full at the centre, zero at the
  // range edge).  STRENGTH is the TANGENTIAL swirl velocity (units/s)
  // added at the centre — perpendicular to the ship→shard line, signed
  // per-shard so the cloud reads as varied vortices rather than a single
  // pinwheel; damping (LINEAR_DAMPING) bounds it into a gentle orbit.
  // SPIN is the rotation-rate ramp (rad/s per step at the centre), capped
  // at MAX_SPIN.  Applied CONTINUOUSLY (no cooldown gate) so the swirl is
  // smooth, not a once-a-second jerk — the range/strength are tuned for a
  // visible-but-cheap wake.  The shatter path is independent: nebula
  // TILES still shatter on player contact; nebula SHARDS never do (pure
  // pass-through).  A DBG toggle (PhysicsSystem.playerNebulaCollisionEnabled,
  // default OFF) can instead route the pair through the hard SAT impulse
  // for a "part the cloud" look; when that toggle is on this swirl is
  // skipped so the two don't compound.
  PLAYER_PULL_RANGE: 150,
  PLAYER_PULL_STRENGTH: 0.025,
  PLAYER_PULL_SPIN: 0.03,
  // Merge proximity: when (dist < (r_large + r_small) × MERGE_PROXIMITY_K)
  // the larger nebula absorbs the smaller one.  K = 0.55 means the
  // shards must substantially OVERLAP, not merely touch, before a merge
  // fires — keeps shards visible as distinct polygons for longer.
  MERGE_PROXIMITY_K: 0.55,
  // Per-shard merge cooldown — a freshly-spawned shard (from a tile
  // shatter OR a recent merge) cannot participate in another merge for
  // this many seconds.  Also stamped on shards just touched by the
  // player→shard pull (PhysicsSystem.applyNebulaPlayerPull) so the
  // same value gates pull, shatter, and merge.  Kept ≤ the high-load
  // bond-timer floor (5 s / LOCAL_MERGE_CONSTANTS.MAX_BOOST = 0.83 s
  // at 6× boost, ~ 1 s here) so the cooldown reliably expires between
  // back-to-back merges in dense clusters — otherwise every shard in
  // a hotspot would spend more time on cooldown than off, and the
  // player pull would almost never find an eligible target.  Prevents
  // the cascade where 4–6 shards spawn together and all collapse into
  // one circle on frame 1–2.  Ticked each substep by PhysicsSystem
  // and consulted by NebulaSystem.updateDynamics before considering
  // any merge pair.
  MERGE_COOLDOWN: 1.0,
  // Tile regeneration toggle.  When false, shattered tiles are gone
  // forever (no respawn at their original grid cell) and the ONLY way
  // new tiles appear is via shard → tile transmutation.  Combined with
  // per-shard effective-area accumulation (see NebulaSystem spawn /
  // merge / tryTransmute), this keeps total tile population bounded:
  // 1 tile shatter produces ≤1 new tile via transmutation.  Clusters
  // can SHRINK (player kills shards mid-merge) but never GROW.
  TILE_REGEN_ENABLED: false,
  // Reference sprite world size for a FULL nebula tile (effective area
  // = HEX_AREA).  Every nebula sprite — tile or shard — is drawn at
  //     drawSize = TILE_SPRITE_WORLD_SIZE × sqrt(nebulaTileArea / HEX_AREA)
  // so visual size scales proportionally with the effective area the
  // entity carries.  A fresh shard from a 3-way shatter draws at
  //   120 × sqrt(1/3) ≈ 69 world units
  // and grows as it merges:
  //   half-merged → 120 × sqrt(0.5) ≈ 85
  //   fully-merged (about to transmute) → 120
  // Tune this one number to make nebula tiles visually bigger or smaller;
  // shard sprites follow automatically.
  TILE_SPRITE_WORLD_SIZE: 120,
  // Cluster generation moved to MAP_POPULATION (Stage 7) — see the
  // 'nebula-tile' tileCluster entries per map for cluster counts +
  // size ranges.  Inner / outer split lives on the per-map record.
  // Base palette — nebula tiles draw from the full 360° hue wheel
  // (blue / indigo / violet / pink / red / yellow / green all available).
  // Regen uses circular hue math so wraparound is handled correctly.
  // SATURATION and LIGHTNESS match the background nebula aesthetic
  // (BackgroundManager.createPuffVariants uses 100%/60%).
  PALETTE_SATURATION: 100,
  PALETTE_LIGHTNESS: 62,
  // Minimum hue delta (in degrees) a regenerated nebula tile must have
  // from its previous hue.  If the rule-based blend produces a result
  // closer than this to the old hue, the regen code forces a step of
  // at least this many degrees along the palette arc so every
  // regeneration is visibly distinct from the last.
  REGEN_MIN_HUE_SHIFT: 40,
  // Default composition hex used if a tile spawns with no palette selection.
  DEFAULT_HEX: '#a78bfa',
  // ── Twinkle (random fading-in/out star within the sprite) ────────
  // Each tile and shard maintains its own next-twinkle schedule; the
  // renderer draws a pre-rendered star bitmap at a random position
  // within the sprite, alpha-curved as sin(t·π) so it smoothly fades
  // in and out over TWINKLE_DURATION seconds, then waits a random
  // interval in [TWINKLE_INTERVAL_MIN, TWINKLE_INTERVAL_MAX] before
  // the next one.  Star positions reroll per cycle.
  TWINKLE_DURATION: 1.2,
  TWINKLE_INTERVAL_MIN: 4.0,
  TWINKLE_INTERVAL_MAX: 9.0,
  TWINKLE_STAR_SIZE: 10,
  TWINKLE_PLACEMENT_RANGE: 0.35,
  // ── Standard drops (salvage) ─────────────────────────────────────
  // Nebula tiles and shards occasionally release a salvage drop on
  // shatter — low frequency so breaking a cluster yields the
  // occasional reward without flooding the map.  The roll is
  // independent of shard creation: shard count/size math is
  // untouched, the salvage drop (if any) is a bonus that spawns
  // alongside the usual shards.
  SALVAGE_DROP_CHANCE: 0.06, // 6 % per shatter (tile OR shard)

  // ── Color equilibration ───────────────────────────────────────
  // Per-frame circular-hue lerp alphas for NebulaSystem's
  // continuous color-equilibration pass.  Tiles drift toward their
  // 6-hex-neighbour weighted average; shards drift toward the
  // nearest tile.  Tiles are anchors (no influence from shards).
  // Cycled via DBG TileBlend / ShardBlend buttons.  0 = off; small
  // values equilibrate over seconds, larger ones in fractions of
  // a second.  At 60 Hz, alpha 0.02 ≈ 95 % blend in ~2.5 s.
  BLEND_TILE_ALPHA: 0,
  // 0.02 → "Med" on the ShardBlend button: nebula shards equilibrate
  // toward the nearest tile's hue out of the gate (cycle to 0 for off).
  BLEND_SHARD_ALPHA: 0.02,
  BLEND_TILE_ALPHA_CYCLE: [0, 0.005, 0.02, 0.08] as const,
  BLEND_SHARD_ALPHA_CYCLE: [0, 0.02, 0.08, 0.25] as const,
  // Physics substeps between color-equilibration passes.  Same
  // skip pattern as SHARD_PAIR_CONSTANTS.FRAME_INTERVAL: lets the
  // user trade smoothness for perf when nebula entity counts are
  // high.  Smoothing rate is set by the alpha cycles above and is
  // independent of this — bumping the interval slows the visual
  // equilibration proportionally (interval × alpha = total rate).
  // 0 = AUTO (selects interval from the previous run's active
  // nebula entity count); ≥1 = manual override.
  BLEND_FRAME_INTERVAL: 0,
  BLEND_FRAME_INTERVAL_CYCLE: [0, 1, 2, 4, 8, 16, 32, 64] as const,
  // AUTO-mode active-nebula-count → interval mapping.  Walked at
  // each run-frame (cheap O(N) count, never on skip frames).
  // First entry whose maxCount ≥ observed wins.  Light clusters
  // run every frame for crisp visual blend; heavy clusters back
  // off so the per-pass cost doesn't dominate `neb` ms.
  BLEND_FRAME_INTERVAL_AUTO_THRESHOLDS: [
    { maxCount: 100,  interval: 1 },
    { maxCount: 300,  interval: 2 },
    { maxCount: 600,  interval: 4 },
    { maxCount: 1200, interval: 8 },
    { maxCount: 9999, interval: 16 },
  ] as const,
};

/**
 * Map an impact speed (px/frame) to a nebula fade rate scale in
 * [1, NEBULA_CONSTANTS.FADE_RATE_MAX_SCALE].  Higher scales produce
 * faster fade-out AND fade-in durations (duration = base / scale).
 *
 * Shared by PhysicsSystem (when arming a tile/shard's fade-out timer)
 * and GameEngine (when arming a newly-spawned shard's fade-in timer)
 * so destruction and rebirth feel synchronized for the same hit.
 */
export function nebulaFadeRateScale(impactSpeed: number): number {
  const raw = impactSpeed / NEBULA_CONSTANTS.FADE_RATE_REFERENCE_SPEED;
  if (raw <= 1) return 1;
  if (raw >= NEBULA_CONSTANTS.FADE_RATE_MAX_SCALE) return NEBULA_CONSTANTS.FADE_RATE_MAX_SCALE;
  return raw;
}

export const EXPLOSION_CONSTANTS = {
  DURATION: 0.6, // Seconds
  SIZE_MULTIPLIER: -1.8
};

export const PARTICLE_CONSTANTS = {
  LIFETIME_MIN: 0.25,
  LIFETIME_MAX: 0.45,
  SPEED_MIN: 2,
  SPEED_MAX: 5,
  SIZE_MIN: 1,
  SIZE_MAX: 3
};


// ── Charge-shot HUD tuning ───────────────────────────────────────────────────
// Visual feedback for the hold-to-charge model.  Ring is drawn around the
// player ship while `player.chargeProgress` > 0; fills from 0 → 1 over
// INPUT_CONSTANTS.CHARGE_FULL seconds.  Two visual states only:
// "priming" while filling, "full" at completion (matches the firing
// gate — charged shot only fires when the ring is full).
export const CHARGE_CONSTANTS = {
  RING_RADIUS_OFFSET: 14,    // px past player half-extent for the ring
  RING_WIDTH: 3,             // line width
  RING_COLOR_PRIMING: '#94a3b8', // slate-400 — held but not yet full
  RING_COLOR_FULL:    '#ffffff', // white — held to full (charged shot armed)
};

// ── Lightning chain tuning ───────────────────────────────────────────────────
export const LIGHTNING_CHAIN_RANGE = 280;           // hop range for subsequent chains
export const LIGHTNING_CHAIN_COUNT = 3;             // additional chain hops (depth) after projectile impact — depth 0 is the direct hit
export const LIGHTNING_CHAIN_BRANCHES = 2;          // simultaneous jumps per chain node — turns the chain into a branching tree (saturated tree: 1+2+4+8 = 15 entities)
// Mobile shard variants the lightning chain refuses to hop to.  Conductive
// targets (enemies, glass-shards, nebula-shards) still chain freely — only
// inert/dielectric materials sit this dance out.  Static tiles are already
// excluded structurally (entityIndex.asteroids holds mobile shards only).
//
// NOTE for future material work (Phase 1 g2 — plastic-shard / metal-shard):
//   - 'plastic-shard' SHOULD be added here (plastic is an insulator).
//   - 'metal-shard'   should NOT be added (metal conducts — let it chain).
// Update this set when those variants are introduced.
export const LIGHTNING_CHAIN_EXCLUDED_VARIANTS: ReadonlySet<ShardVariantId> = new Set<ShardVariantId>([
  'rock-shard',
]);
export const LIGHTNING_ARC_LIFETIME = 0.5;          // seconds the visual arc persists
export const LIGHTNING_GRAVITY_STRENGTH = 400;      // acceleration toward nearest target (gravity-like pull)
export const LIGHTNING_GRAVITY_RANGE = 300;         // max range for gravity attraction

// ── Homing projectile tuning ─────────────────────────────────────────────────
export const HOMING_ACQUIRE_RANGE = 400;            // max range at which a homing projectile locks onto an enemy

// Tile regeneration pop-in burst
export const REGEN_POP_CONSTANTS = {
  DURATION: 0.2,      // seconds for scale overshoot animation
  CHIP_COUNT: 6,      // particles on regen complete
  CHIP_SPEED_MIN: 40,
  CHIP_SPEED_MAX: 80,
  CHIP_LIFETIME: 0.4,
};

// Wave announcement banners
export const WAVE_ANNOUNCE_CONSTANTS = {
  FADEIN: 0.3,
  HOLD: 1.0,
  FADEOUT: 0.5,
  // Banner type sizes.  These are the DESIGN sizes on a roomy viewport;
  // RenderSystem.fitFontPx shrinks a line that would overflow (banner text is
  // authored content — boss names, reward labels — so its width isn't known
  // at design time, and the game is played on a 390px-wide phone).  The MIN
  // sizes are the readability floor: below them, clipping is the better
  // failure, but in practice no shipped string reaches them.
  TEXT_PX: 48,
  TEXT_MIN_PX: 18,
  SUBTEXT_PX: 24,
  SUBTEXT_MIN_PX: 11,
  /** Clear space kept at each edge when fitting a banner line. */
  SIDE_MARGIN: 16,
};

// Glitter trail — bright points trailing behind the player along travel path.
// Separate from the thrust trail; emits whenever the player is in motion.
export const GLITTER_TRAIL_CONSTANTS = {
  COUNT_PER_FRAME: 1,     // particles spawned per frame while moving
  MIN_SPEED_SQ: 0.04,     // below this (per-frame speed²), stop emitting
  LIFETIME_MIN: 0.08,
  LIFETIME_MAX: 0.18,
  SIZE_MIN: 0.4,
  SIZE_MAX: 1.2,
  // Bright multi-hue palette — white + saturated rainbow sparks
  COLORS: [
    '#ffffff', // white
    '#f9a8d4', // pink
    '#c084fc', // purple
    '#7dd3fc', // cyan
    '#86efac', // green
    '#fde047', // yellow
    '#fb923c', // orange
    '#f87171', // red
  ] as string[],
};

export const PROJECTILE_CONSTANTS = {
  SPEED: 3, // Reduced from 12
  SIZE: 8,
  COLOR: '#facc15', // Yellow
  LIFETIME: 1.5, // Seconds
  MASS: 1, // Light projectile
  // Fraction of the shooter's velocity added to the muzzle velocity at
  // spawn (1.0 = full inheritance).  Keeps a moving shooter from
  // outrunning its own shots: forward shots lead the ship and strafing
  // shots drift with it.  A per-weapon muzzle-speed floor (config.speed
  // along the aim direction) still applies on top, so a fast retreat
  // can't fire a backward-drifting shot.  Weapon `speed` values were
  // rescaled (~1.8x over the pre-inheritance values) alongside this so
  // standstill shots stay punchy on the larger maps without imparting so
  // much momentum that hits blow shards across the field.
  INHERIT_SHOOTER_VELOCITY: 1.0,
};

// ── Global entity caps ───────────────────────────────────────────────────────
// Hard ceilings on live projectiles and particles to bound per-frame cost.
// When exceeded, oldest entries of that type are dropped first (FIFO).
export const MAX_PROJECTILES = 600;
export const MAX_PARTICLES   = 400;

export const ENEMY_CONSTANTS = {
  HEALTH: 30,
  SIZE: 20,
  COLOR: '#f87171',
  VISION_RANGE: 2500,
  ACCELERATION: 100,
  MAX_SPEED: 200,
  MASS: 10
};

// Enemy death dust: on death an enemy releases a handful of nebula-shards
// (cloud fragments) tinted to its own body colour, mirroring the rock-tile
// death burst.  Purely cosmetic — the puffs drift, fade in, and feed the
// normal nebula merge/condense system like any other nebula-shard.  The
// burst is gated by MAX_COUNT > 0; set it to 0 to disable.
// ── Explosion variety (Phase 3 Pair B, roadmap step (b)) ─────────────────────
// Per-class death FX on the EXISTING ParticleSystem.  Before this table every
// enemy died the same way, tinted by `entity.color` — so a gnat, a tank and a
// bomber were the same event at three sizes.  A profile differentiates the
// four things the eye actually reads: SHAPE (ring scale + how many rings),
// COUNT/SPEED/SIZE of debris, PALETTE (an accent colour mixed into the debris,
// so a class reads by hue and not only by tint), and SCALE (shake).
//
// PARTICLE BUDGET.  `debris + spark + accent` is the profile's total particle
// spend, and the whole table is calibrated against the PR #69 trimmed budgets:
// the previous single burst spent 15–18 particles, and STANDARD still spends
// 16.  Where a profile spends more (HEAVY, KAMIKAZE, BOSS) it is on a rarer
// death; where a death happens in BULK (SWARM) it spends less than before.
// The MAX_PARTICLES cap is the backstop either way, exactly as it was.
//
// `sfx` is the profile's SFX_INVENTORY id, carried HERE rather than resolved
// separately, so the differentiated visual and its sound are chosen by one
// lookup and cannot drift apart.
//
// PROVISIONAL: every number reasoned about, not measured on the user's
// hardware (see docs/GAUNTLET_PAIR_B_LOG.md, FOR-USER-REVIEW).
export interface ExplosionProfile {
  /** Main ring radius as a multiple of the entity's diameter.  0 = no ring. */
  ringScale: number;
  ringLifetime: number;
  /** Inner white core-flash ring.  0 = none (the "no hot core" classes). */
  coreScale: number;
  coreLifetime: number;
  /** Accent colour blended into the burst alongside the entity's own colour;
   *  undefined = pure body colour. */
  accent?: string;
  accentCount: number;
  debrisCount: number;
  debrisSpeedMin: number; debrisSpeedMax: number;
  debrisSizeMin: number;  debrisSizeMax: number;
  debrisLifeMin: number;  debrisLifeMax: number;
  /** Hot spark layer (white).  0 = none. */
  sparkCount: number;
  sparkSpeedMin: number; sparkSpeedMax: number;
  /** Screen punch.  Added to the tier scaling where the class uses it. */
  shake: number;
  /** SFX_INVENTORY id fired with this burst. */
  sfx: string;
}

export const EXPLOSION_PROFILES = {
  // A gnat POPS.  Deliberately the cheapest profile in the table: dozens die
  // in one step, so it spends 7 particles and no shake at all.
  SWARM: {
    ringScale: 1.6, ringLifetime: 0.2, coreScale: 0, coreLifetime: 0,
    accentCount: 0,
    debrisCount: 5, debrisSpeedMin: 3, debrisSpeedMax: 10,
    debrisSizeMin: 1.5, debrisSizeMax: 3, debrisLifeMin: 0.18, debrisLifeMax: 0.4,
    sparkCount: 2, sparkSpeedMin: 6, sparkSpeedMax: 14,
    shake: 0, sfx: 'destroy.enemy.small',
  },
  // The workhorse kill — the shape everything else is read against.
  STANDARD: {
    ringScale: 2.4, ringLifetime: 0.34, coreScale: 1.3, coreLifetime: 0.22,
    accentCount: 0,
    debrisCount: 11, debrisSpeedMin: 4, debrisSpeedMax: 16,
    debrisSizeMin: 2, debrisSizeMax: 4.5, debrisLifeMin: 0.3, debrisLifeMax: 0.7,
    sparkCount: 5, sparkSpeedMin: 7, sparkSpeedMax: 20,
    shake: 2.5, sfx: 'destroy.enemy.standard',
  },
  // Structural failure: BIGGER but SLOWER, with amber embers that outlive the
  // flash.  Slow heavy debris is what makes a tank's death read as mass.
  HEAVY: {
    ringScale: 3.1, ringLifetime: 0.5, coreScale: 1.6, coreLifetime: 0.3,
    accent: '#fbbf24', accentCount: 6,
    debrisCount: 12, debrisSpeedMin: 2.5, debrisSpeedMax: 11,
    debrisSizeMin: 3, debrisSizeMax: 6.5, debrisLifeMin: 0.5, debrisLifeMax: 1.1,
    sparkCount: 4, sparkSpeedMin: 5, sparkSpeedMax: 14,
    shake: 5, sfx: 'destroy.enemy.heavy',
  },
  // A real bomb: fastest debris in the table, hot orange core, heavy punch.
  KAMIKAZE: {
    ringScale: 3.6, ringLifetime: 0.42, coreScale: 2.0, coreLifetime: 0.26,
    accent: '#fb923c', accentCount: 8,
    debrisCount: 14, debrisSpeedMin: 8, debrisSpeedMax: 26,
    debrisSizeMin: 2, debrisSizeMax: 5, debrisLifeMin: 0.25, debrisLifeMax: 0.6,
    sparkCount: 7, sparkSpeedMin: 12, sparkSpeedMax: 30,
    shake: 8, sfx: 'destroy.enemy.kamikaze',
  },
  // A membrane bursting, not a hull exploding: NO hot core, no shake, slow
  // fat droplets that fall apart rather than fly.  The one death in the game
  // that should not look like combustion.
  BUBBLE: {
    ringScale: 2.0, ringLifetime: 0.45, coreScale: 0, coreLifetime: 0,
    accent: '#a5f3fc', accentCount: 7,
    debrisCount: 10, debrisSpeedMin: 1.5, debrisSpeedMax: 6,
    debrisSizeMin: 3, debrisSizeMax: 7, debrisLifeMin: 0.5, debrisLifeMax: 1.0,
    sparkCount: 0, sparkSpeedMin: 0, sparkSpeedMax: 0,
    shake: 0, sfx: 'destroy.enemy.bubble',
  },
  // A player-pattern ship dying, seen from outside: the player's own cyan
  // energy signature rather than an enemy's.
  RIVAL: {
    ringScale: 2.6, ringLifetime: 0.4, coreScale: 1.5, coreLifetime: 0.26,
    accent: '#38bdf8', accentCount: 6,
    debrisCount: 11, debrisSpeedMin: 4, debrisSpeedMax: 15,
    debrisSizeMin: 2, debrisSizeMax: 4.5, debrisLifeMin: 0.35, debrisLifeMax: 0.75,
    sparkCount: 5, sparkSpeedMin: 8, sparkSpeedMax: 20,
    shake: 3, sfx: 'destroy.rival',
  },
  // The run ending.  The biggest ring in the table and the longest-lived
  // debris, because the player is looking straight at it.
  PLAYER: {
    ringScale: 3.4, ringLifetime: 0.6, coreScale: 1.8, coreLifetime: 0.32,
    accent: '#ffffff', accentCount: 6,
    debrisCount: 14, debrisSpeedMin: 4, debrisSpeedMax: 14,
    debrisSizeMin: 2, debrisSizeMax: 4.5, debrisLifeMin: 0.5, debrisLifeMax: 1.2,
    sparkCount: 6, sparkSpeedMin: 6, sparkSpeedMax: 16,
    shake: 6, sfx: 'destroy.player',
  },
  // A boss dies in ITS PHASE COLOUR (the caller passes the phase tint as the
  // body colour), so the last thing you see is the state you beat.  The
  // payout beat in payBossBounty layers on top of this.
  BOSS: {
    ringScale: 4.2, ringLifetime: 0.7, coreScale: 2.2, coreLifetime: 0.36,
    accent: '#ffffff', accentCount: 10,
    debrisCount: 18, debrisSpeedMin: 5, debrisSpeedMax: 22,
    debrisSizeMin: 3, debrisSizeMax: 7, debrisLifeMin: 0.5, debrisLifeMax: 1.3,
    sparkCount: 8, sparkSpeedMin: 10, sparkSpeedMax: 26,
    shake: 9, sfx: 'boss.death',
  },
  // ── Materials ──
  // Glass SHATTERS: fast, small, bright, with a white sparkle layer.  The
  // most kinetic material break.
  GLASS: {
    ringScale: 0, ringLifetime: 0, coreScale: 0, coreLifetime: 0,
    accent: '#e0f2fe', accentCount: 4,
    debrisCount: 6, debrisSpeedMin: 5, debrisSpeedMax: 14,
    debrisSizeMin: 1, debrisSizeMax: 2.2, debrisLifeMin: 0.2, debrisLifeMax: 0.5,
    sparkCount: 0, sparkSpeedMin: 0, sparkSpeedMax: 0,
    shake: 0, sfx: '',
  },
  // Rock CRUMBLES: slow, fat, dull, no sparkle.  The inverse of glass on
  // every axis, which is what makes the two tellable apart at a glance.
  ROCK: {
    ringScale: 0, ringLifetime: 0, coreScale: 0, coreLifetime: 0,
    accent: '#64748b', accentCount: 3,
    debrisCount: 6, debrisSpeedMin: 1.5, debrisSpeedMax: 5,
    debrisSizeMin: 2, debrisSizeMax: 4, debrisLifeMin: 0.35, debrisLifeMax: 0.8,
    sparkCount: 0, sparkSpeedMin: 0, sparkSpeedMax: 0,
    shake: 0, sfx: '',
  },
  // Metal FAILS: grey chips plus hot orange sparks, the only material break
  // with a spark layer — it is the only one that reads as stressed steel.
  METAL: {
    ringScale: 0, ringLifetime: 0, coreScale: 0, coreLifetime: 0,
    accent: '#fb923c', accentCount: 5,
    debrisCount: 6, debrisSpeedMin: 3, debrisSpeedMax: 9,
    debrisSizeMin: 1.5, debrisSizeMax: 3.2, debrisLifeMin: 0.3, debrisLifeMax: 0.7,
    sparkCount: 3, sparkSpeedMin: 8, sparkSpeedMax: 18,
    shake: 0, sfx: '',
  },
} as const satisfies Record<string, ExplosionProfile>;

export const ENEMY_NEBULA_BURST = {
  MIN_COUNT: 2,
  MAX_COUNT: 4,
  SIZE_FRACTION: 0.6,   // shard diameter relative to the enemy diameter
  ALPHA_MUL: 0.5,       // per-shard alpha (wispy cloud, matches rock burst)
  SPREAD_JITTER: 0.5,   // position scatter as a fraction of the enemy diameter
};

// Hit feedback — every projectile hit on an enemy gives a damage-scaled
// knockback (in the shot's travel direction) plus a brief stagger.  The
// stagger ALSO suspends the AI max-speed clamp, so the knockback actually
// carries the enemy back instead of being instantly clamped to its slow
// cruise — that's what makes the impact read.  Uncapped (per testing): the
// kick is purely KICK_PER_DMG × applied (post-armor) damage, so heavy hits
// shove hard and chip hits on armor barely nudge.
export const HIT_FEEDBACK = {
  /* ── KNOCKBACK IS AN IMPULSE, NOT A VELOCITY (user call) ──────────────
   *
   * This used to be `KICK_PER_DMG: 1.0` applied as `dv = damage * 1.0` —
   * a velocity step with NO MASS IN IT, so one Plasma Cannon hit added
   * dv = 18 to a mass-4 gnat and to a mass-500 dragon alike, and dv = 18 is
   * several times any enemy's own top speed.  That is what launched NPCs off
   * screen on every hit, and it is why they behaved unlike shards: the shard
   * push right below is `projSpeed * 0.20 / max(1, mass/10)` — mass-aware,
   * landing in the 0.7 .. 3.2 range.  (The dragon's ENEMY_VARIANTS row even
   * says "heavy: barely shoved", documenting an intent the code did not
   * implement.)
   *
   * Momentum in, velocity out — the same move the screen shake made:
   *
   *     dv = damage * KICK_IMPULSE_PER_DMG / mass
   *
   * At the shipped weapon damages that lands NPCs in the shard range, and
   * orders them by weight the way everything else in the collision code
   * does.  dv from one Cannon hit (18 dmg): gnat 9.0, Charger 4.5, Drone
   * 3.6, Tank 2.0, Turret 0.7, Warden 0.26, Dragon 0.07 (was 18 for every
   * one of them).
   *
   * The cap is expressed in the TARGET'S OWN top speed rather than as an
   * absolute, so it means the same thing across a roster whose speeds vary
   * 4x: a hit can never shove a body faster than it can fly under its own
   * power.  The floor keeps a bolted-down emplacement (maxSpeed 0: Turret,
   * Nest) flinching rather than being immovable. */
  KICK_IMPULSE_PER_DMG: 2.0,   // momentum per point of applied damage
  KICK_MAX_SPEED_FRAC: 0.9,    // never shove past this fraction of own maxSpeed
  KICK_SPEED_FLOOR: 3.0,       // ...but a maxSpeed-0 body still flinches
  STUN_SEC: 0.12,     // stagger: no AI force AND no speed-clamp while > 0
  // Player-hit response scales with the incoming shot's intrinsic damage so a
  // heavy slug (Tank, 16) lands like a wallop and a chip pellet (Drone, 5)
  // barely registers — both shake and a directional knockback.  Uses the
  // projectile's own damage (not the post-shield/armor value) so a heavy hit
  // jolts even when the shield eats it.
  /* A SHOT MUST NOT RIVAL A COLLISION (user call).
   *
   * These numbers predate the impact model and were on their own scale, so
   * they landed far up the body-impact range: a 5-damage Drone PELLET
   * produced 10.0 — as much as a 40px rock hitting the hull at speed 20 —
   * and a 16-damage slug produced 23.2, nearly a full-tilt wall crash (30).
   * Being shot by a pea-shooter outweighed flying into terrain.
   *
   * A projectile's actual momentum against the hull is negligible (mass 1 at
   * speed 16 against a 100-mass ship is dv = 0.16, an order of magnitude
   * under `SHAKE.IMPACT_DV_MIN`), so this shake is deliberately a LEGIBILITY
   * signal — "you got hurt" — rather than a physical one, and damage is the
   * right input for it.  What it needed was a place in the same scale:
   *
   *   pellet (5 dmg)  -> 4.0   below a wall crash at the break threshold (6)
   *   Charger (7)     -> 5.0
   *   slug (16)       -> 9.5
   *   Bastion (18)    -> 10.5  about a 40px rock at speed 20 (10.5)
   *   cap             -> 11    under a wall crash at speed 8 (12)
   *
   * So the heaviest shell in the game feels like a real rock hitting you,
   * a pellet feels like less than a scrape, and nothing fired can approach
   * ramming terrain.  Direction is unchanged: the shot's travel axis. */
  PLAYER_SHAKE_BASE: 1.5,      // floor shake on any player hit
  PLAYER_SHAKE_PER_DMG: 0.5,   // + this per point of shot damage
  PLAYER_SHAKE_MAX: 11,        // cap — under a moderate crash, never near HEAVY
  /* The player's own shove is the same rule, normalised so the LEAN ship is
   * unchanged: 12 / PHYSICS_CONSTANTS.PLAYER_MASS (100) = the old 0.12 per
   * damage point.  Only a laden hull differs, and it differs the way the
   * screen shake already does — more ship, less shove. */
  PLAYER_KICK_IMPULSE_PER_DMG: 12,
  // Explosion knockback overshoot: a blast (e.g. kamikaze) drives the player
  // PAST the normal maxSpeed cap and that overshoot decays back to cap by this
  // per-60fps-step factor (≈0.95 → ~95% gone in 1s), so the player is launched
  // and accelerates away instead of the hard speed-cap eating the impulse.
  PLAYER_KNOCKBACK_DECAY: 0.95,
};

export const DAMAGE_TEXT_CONSTANTS = {
  LIFETIME: 1.2, // Seconds
  SPEED: 35, // Pixels per second upward
  SIZE: 14,
  // Muted red chip — only shown on NON-lethal hits to multi-HP survivors
  // now (lethal hits and dent tiles are gated out), so it never collides
  // with the gold points popups.  Kept distinct from any gold.
  COLOR: '#fca5a5',
  CRIT_COLOR: '#fca5a5',
  DAMAGE_FONT_SCALE: 0.8, // damage chips render small vs. points popups
};

// ── Rainbow weapon order: Red → Orange → Yellow → Green → Cyan → Blue → Purple ──
//
// Stat budgeting (d2 weapon overhaul):
//   Each weapon owns a distinct tactical niche.  ROF spans ~10× across the
//   lineup (Blaster 7/s vs Cannon ~0.7/s); damage trades inversely with ROF
//   so per-shot damage spans ~5× (Blaster 4 vs Cannon 18).  Each weapon
//   composes existing primitives (homing / pierce / bounce / lightning /
//   spread / burst) plus the new `explosionRadius` AoE primitive on the
//   Cannon.  Charged-shot variants (held mouse for the full INPUT_CONSTANTS
//   .CHARGE_FULL window then released) cost only the charge time — ammo was
//   deleted as a system (pivot 1b); weapon pressure = cooldown + the 2-slot
//   loadout commitment.  Bouncer/Lightning cooldowns were raised in the same
//   change to replace the ammo tax they leaned on.
export const WEAPONS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.BLASTER]: {
    type: WeaponType.BLASTER,
    name: 'Blaster',
    cooldown: 0.14,    // 7 shots/s — all-rounder cadence
    speed: 16,
    damage: 4,
    lifetime: 1.5,
    color: '#ef4444', // Red — the starter all-rounder
    size: 6,
    count: 1,
    spread: 2,
    recoil: 0.5,
    pierce: 0,
  },
  [WeaponType.BURST]: {
    type: WeaponType.BURST,
    name: 'Burst Rifle',
    cooldown: 0.45,    // ~2.2 bursts/s
    speed: 20,
    damage: 5,
    lifetime: 3.0,
    color: '#f97316', // Orange
    size: 5,
    count: 1,
    spread: 1,
    recoil: 0.3,
    pierce: 2,
    burstCount: 3,
    burstDelay: 0.04,
  },
  [WeaponType.SHOTGUN]: {
    type: WeaponType.SHOTGUN,
    name: 'Shotgun',
    cooldown: 0.65,    // 1.5 shots/s — close-range slug, commits per shot
    speed: 20,
    damage: 3,
    lifetime: 0.8,     // doubled — pellets reach further before fading
    color: '#facc15', // Yellow
    size: 5,
    count: 6,
    spread: 17.5,      // halved — tighter cone, more focused damage
    recoil: 3.0,
    pierce: 1,
  },
  [WeaponType.BOUNCER]: {
    type: WeaponType.BOUNCER,
    name: 'Laser',
    cooldown: 0.55,    // 0.40 → 0.55 (pivot 1b): the 15-ammo/s tax was its real
                       // downside; with ammo gone the crowd-rake needs a brake.
                       // Cooldown (not per-beam damage) so each volley keeps its
                       // line-deleting punch — same lever as Lightning.
    speed: 30,         // fast straight beam — stays the quickest projectile
    damage: 5,
    lifetime: 4,       // bounded; the bounceCount cap usually ends it sooner
    color: '#22c55e',  // Green — beam that pierces enemies + bounces off tiles
    size: 6,
    count: 3,          // 3-beam forward fan
    spread: 30,        // ±15° cone
    recoil: 0.5,
    pierce: 99,        // effectively infinite enemy penetration; tile bounces still cap via bounceCount
    bounceCount: 3,    // reflects up to 3 times off tiles before dissipating
  },
  [WeaponType.LIGHTNING]: {
    type: WeaponType.LIGHTNING,
    name: 'Lightning',
    cooldown: 0.65,    // 0.50 → 0.65 (pivot 1b): compensates for free ammo —
                       // chain falloff already limits single-target value
    speed: 26,         // gravity pull curves the projectile toward targets
    damage: 9,         // direct hit; chain hops scale down by 1/(totalHops-1) per hop
    lifetime: 15,      // bounded — prevents unbounded accumulation in target-poor areas
    color: '#22d3ee',  // Cyan — projectile that chains on impact
    size: 6,
    count: 1,
    spread: 3,
    recoil: 0.3,
    pierce: 0,         // stops on first hit, then chains
  },
  [WeaponType.HOMING]: {
    type: WeaponType.HOMING,
    name: 'Seeker Missiles',
    cooldown: 0.65,    // 1.5 shots/s — slow ROF in exchange for guaranteed hits
    speed: 12,
    damage: 8,         // 6 → 8 (pivot 1d): "can't miss" shouldn't be "can't kill" —
                       // the designated anti-evasive answer once traits expand
    lifetime: 3.0,
    color: '#3b82f6', // Blue
    size: 8,
    count: 1,
    spread: 10,
    recoil: 0.5,
    pierce: 0,
    homing: true,
  },
  [WeaponType.CANNON]: {
    type: WeaponType.CANNON,
    name: 'Plasma Cannon',
    cooldown: 1.40,    // ~0.7 shots/s — heavy artillery
    speed: 18,
    damage: 18,
    lifetime: 2.5,
    color: '#a855f7', // Purple
    size: 16,
    count: 1,
    spread: 0,
    recoil: 4.0,       // halved from 8.0 — a slower ROF + AoE makes huge recoil punitive
    pierce: 0,
    explosionRadius: 110,   // world units of radial AoE on impact
    explosionDamage: 10,    // damage applied to every entity in radius (excluding the direct-hit target which already took config.damage)
    explosionKnockback: 6,  // velocity impulse magnitude at the impact point (falls off with distance)
  },
};

// Full rainbow order — canonical weapon ordering (Drydock catalog, DBG).
// In-game cycling/selection runs over the player's 2-slot loadout, not this.
export const WEAPON_LIST = [
  WeaponType.BLASTER,
  WeaponType.BURST,
  WeaponType.SHOTGUN,
  WeaponType.BOUNCER,
  WeaponType.LIGHTNING,
  WeaponType.HOMING,
  WeaponType.CANNON,
];

// (WEAPON_SLOT_LABELS deleted with the 8-cell ammo strip — the 2-slot
// loadout HUD is wide enough to render full weapon names.)

// ── Adaptive-trigger profiles (DualSense, WebHID) ─────────────────────────
// What the RIGHT trigger feels like per equipped weapon.  This is the one
// piece of hardware feedback the Gamepad API cannot express at all — rumble
// says "something happened", a trigger clutch says "this is what you are
// holding" — so the table is written to make the guns distinguishable BY
// FEEL rather than to make each one maximally dramatic.
//
// Units are NORMALISED, not wire values: `start`/`end` are fractions of the
// trigger's travel and `strength` is 0..1.  The two competing wire encodings
// disagree about ranges (raw 0–255 bytes vs ten 0–9 travel zones with a 0–8
// force), and the design intent — "the Cannon is the deepest pull in the
// game" — is true in both.  engine/systems/DualSenseHID.ts converts.
//
// Six shapes are available (see TriggerKind); these seven use five of them.
// The rule followed here: a gun's trigger should say what the gun IS before
// it says anything else, so cadence picks the shape and the numbers only
// separate guns that already share one.
export const WEAPON_TRIGGERS: Record<WeaponType, TriggerProfile> = {
  // 7 shots/s.  A CLICK 7x/s is not feedback, it is fatigue — and it is also
  // a lie, because the gun is not asking you to commit to each shot.  A
  // low-frequency RATTLE is what an automatic weapon feels like.
  [WeaponType.BLASTER]: {
    kind: 'vibration', start: 0.30, end: 0, strength: 0.45, frequency: 0.30,
  },
  // Three-round burst: a click, but a TEXTURED one — three notches on the
  // way down, so the trigger says how many rounds are coming.
  [WeaponType.BURST]: {
    kind: 'texture', start: 0.30, end: 0.70, strength: 0.6,
    zones: [0, 0, 0.7, 0, 0.7, 0, 0.7],
  },
  // 1.5 shots/s slug.  Commits per shot, and the trigger should say so: a
  // firm break with nothing before it, so the whole pull is the commitment.
  [WeaponType.SHOTGUN]: {
    kind: 'weapon', start: 0.42, end: 0.62, strength: 0.80,
  },
  // Held beam — a smooth wall.  No break, because there is no per-shot
  // moment to mark; you are leaning on it.
  [WeaponType.BOUNCER]: {
    kind: 'resistance', start: 0.30, end: 0, strength: 0.45,
  },
  // Held chain.  A fast, fine BUZZ over the wall — electricity, not recoil.
  [WeaponType.LIGHTNING]: {
    kind: 'vibration', start: 0.35, end: 0, strength: 0.60, frequency: 0.85,
  },
  // Lock-and-release.  The pull gets HARDER as it goes (the lock winding up)
  // and then the shot leaves at the top.
  [WeaponType.HOMING]: {
    kind: 'slope', start: 0.30, end: 0.65, strength: 0.25, endStrength: 0.85,
  },
  // Artillery.  The deepest, heaviest pull in the game, ramping the whole
  // way — the one gun where reaching the shot is work.
  [WeaponType.CANNON]: {
    kind: 'slope', start: 0.25, end: 0.75, strength: 0.35, endStrength: 1.0,
  },
};

// LEFT trigger under the trigger-thrust scheme.  A SLOPE that stiffens with
// the ship's speed: free at rest, and a real push once you are near the cap,
// so "already flat out" is something the hand knows.  Quantised by the caller
// for the same reason the charge ramp is — each step is an HID write.
export const THRUST_TRIGGER_STEPS = 5;
export function THRUST_TRIGGER(speedFraction: number): TriggerProfile {
  const q = Math.round(Math.max(0, Math.min(1, speedFraction)) * THRUST_TRIGGER_STEPS) / THRUST_TRIGGER_STEPS;
  return {
    kind: 'slope',
    start: 0.10,
    end: 0.90,
    // A light detent at the bottom always, so the throttle has a bite point.
    strength: 0.15 + 0.25 * q,
    endStrength: 0.25 + 0.55 * q,
  };
}

// Held CHARGE (Overcharge).  Overrides the weapon profile while a charged
// shot winds up — and unlike every profile above, it is not static: the
// trigger STIFFENS as the ring fills, so the charge is something the hand
// feels building rather than a wall that simply appeared.  This is the one
// thing an adaptive trigger can say that no other output in the game can,
// which is why it gets the only state-driven profile.
//
// `chargeTrigger(t)` is called with the charge fraction and QUANTISED by the
// caller: each distinct profile is an HID write, and the pad's endpoint is
// not a frame buffer.
export const CHARGE_TRIGGER_MAX_STRENGTH = 0.95;
export const CHARGE_TRIGGER_STEPS = 5;
export function chargeTrigger(t: number): TriggerProfile {
  const q = Math.round(Math.max(0, Math.min(1, t)) * CHARGE_TRIGGER_STEPS) / CHARGE_TRIGGER_STEPS;
  return {
    kind: 'slope',
    start: 0.12,
    end: 0.85,
    // Already firm at the bottom so the wall is there the moment the hold
    // starts; the RAMP is what grows.
    strength: 0.30 + 0.30 * q,
    endStrength: 0.45 + (CHARGE_TRIGGER_MAX_STRENGTH - 0.45) * q,
  };
}

// Burst-fire parameters for shooting enemies.
// Pattern: BURST_SIZE rapid shots (BURST_GAP apart), then BURST_RELOAD reload.
// Simple enemy blaster (separate so we can tune independently of player weapons)
export const ENEMY_WEAPON: WeaponConfig = {
  type: WeaponType.BLASTER,
  name: 'Enemy Blaster',
  cooldown: 1.2,
  speed: 9,
  damage: 10,
  lifetime: 3.5,
  color: '#f97316',
  size: 6,
  count: 1,
  spread: 4,
  recoil: 0,
  pierce: 0,
};

// ── Boss weapons ((h)) ────────────────────────────────────────────────────────
// WEAPONS_AMMO_PLAN §6 weapon parity: a weapon-boss WIELDS a themed variant of
// the literal PLAYER archetype, built by spreading the player's own WEAPONS
// entry and overriding the enemy-facing numbers.  Same projectile family, cone
// and colour the player knows — so the telegraph reads "that's MY shotgun" —
// with NO parallel weapon table.  Overrides only: WeaponSystem merges these as
// `{...ENEMY_WEAPON, ...arch.weapon, ...entity.weaponOverride}`, so anything
// not named here falls back to ENEMY_WEAPON.
//
// Damage numbers are PROVISIONAL (first-pass boss tuning; the plan's step-6
// economy/progression pass owns the real balance).
export const BOSS_WEAPONS: Record<'SCATTER' | 'SIEGE', Partial<WeaponConfig>> = {
  // Reaver's scattergun — the player Shotgun's cone and pellet look, slowed to
  // a readable boss beat and given per-pellet bite, so a full cone at brawling
  // range really hurts while a single clipped pellet does not.
  SCATTER: {
    ...WEAPONS[WeaponType.SHOTGUN],
    name: 'Reaver Scattergun',
    cooldown: 1.5,     // vs the player's 0.65 — a boss beat you can read
    damage: 5,         // per pellet (player: 3); 7 pellets = 35 on a full cone
    count: 7,
    spread: 21,
    speed: 15,
    lifetime: 0.95,
    recoil: 0,         // enemies take no recoil
    pierce: 0,
  },
  // Bastion's siege battery — the player Plasma Cannon, AoE and all: the same
  // purple heavy slug that splashes on impact.  Halved damage and a much
  // longer beat, because a boss lobbing the player's artillery on the player's
  // cadence would be unsurvivable.  The splash is what makes hiding behind
  // cover (or hugging the hull) stop working.
  SIEGE: {
    ...WEAPONS[WeaponType.CANNON],
    name: 'Bastion Siege Battery',
    cooldown: 3.2,          // vs the player's 1.40 — a slow, readable lob
    damage: 9,              // direct hit (player: 18)
    speed: 11,              // slow shells you can see coming and boost out of
    lifetime: 3.2,
    explosionRadius: 130,
    explosionDamage: 6,     // splash (player: 10)
    explosionKnockback: 5,
    recoil: 0,
    pierce: 0,
  },
};

// --- ASSETS ---
export { ASSETS };

export const SHIELD_CONSTANTS = {
  MAX_CHARGE: 50,            // Shield capacity (half of 100 HP)
  RECHARGE_RATE: 10,          // Points/sec — full recharge in ~5s
  RECHARGE_DELAY: 2.0,       // Brief pause after last hit before recharge kicks in
  HIT_FLASH_DURATION: 1.3,   // How long the shield ring stays visible after a hit
  CONTACT_FLASH_DURATION: 0.45, // Shorter flash for non-damaging contact
  COLOR: '#60a5fa',          // Blue-400
  COLLISION_MULTIPLIER: 1.8, // Player collision radius multiplier when shield > 0
  DAMAGE_THRESHOLD: 2.0,     // Min impact speed to actually drain shield (below = flash only)
  // Directional arc shield (Bulwark): the interception ring radius as a
  // fraction of the entity's max size.  Matches the rendered ring
  // (baseR 0.62 × 1.6 ≈ 0.99·size) so a covered shot is absorbed AT the
  // visible arc instead of tunneling to the hull.
  ARC_REACH_FACTOR: 0.99,
};

export const WAVE_CONSTANTS = {
  // Bumped from 3.0 → 4.5 so the post-wave graceful cleanup window
  // (offscreen-first, paced shard removal in ShardSystem) has time to
  // drain pressure before the next wave lands.  Keeps reaction-time
  // budget unchanged for the player while letting the field breathe.
  GRACE_PERIOD: 4.5, // Seconds between wave clear and next wave spawn
  // Extra world-unit buffer beyond the visible half-diagonal when picking
  // wave-spawn radii.  Guarantees enemies materialise comfortably outside
  // the player's viewport on every aspect ratio.
  OFFSCREEN_MARGIN: 120,
  // Radial depth of the spawn ring (added on top of the viewport-derived
  // minimum distance).  Keeps the ring visually varied without bringing
  // any spawn point on-screen.
  SPAWN_RING_SPREAD: 200,
};

// ── Score system ─────────────────────────────────────────────────────────────
// Points incentivise hunting enemies down across the big maps.  Kills are
// tier-scaled; clearing a timed wave's full spawn budget before time-up
// pays a wave-scaled bonus on top (see WaveSystem early-clear path).
// Survivors despawned at time-up bypass the death path and award nothing.
export const SCORE_CONSTANTS = {
  POINTS_PER_TIER: 100,           // tier-1 kill = 100, tier-2 = 200, tier-3 = 300
  // Wave completion (kill-all model): a flat base on every clear plus a
  // speed-graded bonus = SPEED_SCALE × wave × fraction, where the fraction
  // is 1 when cleared within the wave's spawn-window "par" and decays to 0
  // at 2× par.  Clearing fast is worth more.
  WAVE_COMPLETE_BASE: 50,
  EARLY_CLEAR_BONUS_PER_WAVE: 50, // speed-bonus scale (× wave number)
  // Shard / tile destruction — player-attributed kills only (see
  // GameEntity.killedByPlayer; environmental deaths award nothing).
  // Tiles pay per point of maxHealth so tiered materials (plastic,
  // metal × densityTier) are worth proportionally more than glass.
  // Nebula variants are excluded — ambient clouds shatter constantly.
  SHARD_DESTROY_POINTS: 5,        // flat, per mobile shard
  TILE_DESTROY_POINTS_PER_HP: 10, // glass 10, plastic 30, metal 10 × tier…
  // Snitch catch — large flat payout; catching it also ends the wave
  // immediately (no early-clear bonus stacks on top).  150 × 10: a nod
  // to quidditch's 150, scaled to sit above a typical full wave's kills.
  SNITCH_POINTS: 1500,
  // Catching the snitch also wipes every live enemy on the field, each
  // worth this fraction of its normal kill value (a board-clear bonus).
  SNITCH_SWEEP_KILL_FRACTION: 0.5,
  POPUP_COLOR: '#facc15',         // floating "+N" kill popup (gold family)
  POPUP_LIFETIME: 1.6,            // a touch longer than damage text so it registers
  // HUD score ticker: the displayed total catches up to the true score by
  // at least 1 and at most this fraction of the gap per frame, so big
  // awards (snitch, combos) roll up over ~0.2s instead of snapping.
  DISPLAY_CATCHUP_FRAC: 0.2,
  // ── Kill combo ────────────────────────────────────────────────────────
  // Rapid enemy kills build a combo: every COMBO_KILLS_PER_TIER kills steps
  // the multiplier up one (capped), and it multiplies enemy-kill points.
  // The combo resets if no enemy dies for COMBO_WINDOW_SEC.  Shard/tile
  // kills neither build nor consume it — only ships count.
  COMBO_WINDOW_SEC: 3.5,
  COMBO_KILLS_PER_TIER: 3,
  COMBO_MAX_MULTIPLIER: 5,
};

// ── Modules: hex-slot outfitting with inventory (module-config increment) ────
// EVERY piece of progression is a discrete, NON-UPGRADEABLE module ITEM.
// Stat families come in fixed Mk I/II/III varieties (own price, own fixed
// effect — no per-level curve, no in-place upgrades; a better mark is a new
// purchase you swap in).  Purchases land in the INVENTORY (a tile grid);
// outfitting is moving items between inventory tiles and the two 7-hex
// installation groups (SHIP / WEAPON — a center tile + one at each side).
// Gun placement is SLOT-AGNOSTIC: a gun may sit in ANY weapon-group hex,
// but no more than MAX_INSTALLED_GUNS may be mounted at once (the 2-gun
// loadout lives on as a COUNT limit, clearly surfaced as "Guns N/2" in
// the docking UI; raising the limit is a future ship purchase — see the
// ship-catalog entry in docs/PARKING_LOT.md).  Going WEAPONLESS is
// allowed — every gun carries a WEIGHT, and a light ship accelerates
// harder (SHIP_WEIGHT below).
//
// ADJACENCY REQUIREMENTS (MODULE_REQUIREMENTS): an installed module only
// FUNCTIONS while it touches an ACTIVE module of its required family —
// engine⇢hull, thrusters⇢engine, shield/plating⇢hull, capacitor⇢shield,
// weapon-mods⇢gun.  Hull and guns are the roots of their groups (no
// requirement), so a hull module is the prerequisite for the whole ship
// tree ("a hull module should always be required").  Activity is computed
// as a fixpoint over HEX_ADJACENCY; inactive modules contribute nothing
// and render dimmed with the unmet requirement shown.
//
// Kind 'ship-part' remains RESERVED schema (see docs/PARKING_LOT.md —
// superseded Option B).  Duplicates are allowed (two Hull Mk I stack).
export type ModuleKind = 'weapon' | 'weapon-mod' | 'ship' | 'ship-part';
export type ModuleGroup = 'ship' | 'weapon';
export type ModuleFamily =
  | 'hull' | 'plating' | 'capacitor' | 'engine' | 'thrusters' | 'shield'
  | 'gun' | 'gunnery' | 'autoloader' | 'overcharge' | 'utility';

/** Fixed effect payload of one module VARIETY (summed over ACTIVE modules).
 *  Base values modified: HP 100, shield SHIELD_CONSTANTS.MAX_CHARGE,
 *  recharge SHIELD_CONSTANTS.RECHARGE_RATE. */
export interface ModuleEffect {
  maxHp?: number;           // hull
  maxShield?: number;       // plating (only counts while a shield core is active)
  shieldRegenFrac?: number; // capacitor
  speedFrac?: number;       // engine
  accelFrac?: number;       // thrusters
  damageFrac?: number;      // gunnery
  cooldownFrac?: number;    // autoloader
  shieldCore?: boolean;     // the Shield module itself (enables maxShield base)
  overcharge?: boolean;     // enables hold-to-charge shots
  flashlight?: boolean;     // Flashlight Kit — enables the ship-tap light tool
}

export interface ModuleDef {
  id: string;              // variety id: 'hull_mk2', 'wpn_shotgun', …
  family: ModuleFamily;
  mark: number;            // 1..3 (1 for single-variety families)
  group: ModuleGroup;
  kind: ModuleKind;
  label: string;
  desc: string;
  cost: number;
  weapon?: WeaponType;     // family 'gun' only
  // Module mass.  Adds to the SHIP's total weight, which drags acceleration
  // via the SHIP_WEIGHT curve — no gun mounted = a slight accel boost.  Only
  // guns set it today; the fold reads it off any module.
  weight?: number;
  effect?: ModuleEffect;
}

export const MODULE_SLOT_COUNT = 7;   // hex flower: 1 center + 6 sides
export const MAX_INSTALLED_GUNS = 2;  // gun COUNT limit in the weapon group (slot-agnostic)
export const INVENTORY_CAPACITY = 12; // inventory tile count (future ships vary this)
// Module resale: SELL-BACK pays 90% of cost but needs a station (any —
// every station drydocks); SCRAP pays 9% from anywhere on the map — the
// steep cut is the price of not flying home.  Both act on INVENTORY
// tiles only (uninstall first).
export const MODULE_RESALE = {
  SELL_FRACTION: 0.9,
  SCRAP_FRACTION: 0.09,
};
// Autoloader stack floor — cadence never drops below 40% of base.
export const COOLDOWN_FLOOR = 0.4;

// ── Ship weight → acceleration ──────────────────────────────────────────────
// WEIGHT IS A SHIP ATTRIBUTE, not a property of any one module: the ship has
// a HULL weight of its own, every mounted module adds to it, and the ship's
// total weight is what drags thrust:
//   BASE_BOOST / (1 + DRAG_PER_WEIGHT × ship weight)
// where ship weight = HULL_BASE + Σ (weight of every ACTIVE module).
//
// `HULL_BASE` is 0 TODAY — the current hull contributes nothing, so the
// arithmetic is unchanged (the starter Blaster, weight 1, is EXACTLY the 1.0
// baseline; flying weaponless gives the +10% BASE_BOOST; heavy arsenals like
// Cannon + Homing ≈ 4.5 weight drag to ≈0.76×).  It exists as the seam for
// SHIP CLASSES: a heavier hull sets a higher HULL_BASE and starts the whole
// curve further along, without any other code moving.  Numbers provisional
// pending playtest.
//
// Only guns carry a `weight` in MODULE_DEFS today, but the fold is
// module-agnostic — give any module a weight and it joins the ship's total.
export const SHIP_WEIGHT = {
  HULL_BASE: 0,
  // Base thrust with an unladen ship, and how hard each unit of weight drags.
  // EVERY module carries a weight now (user call), so a fully-outfitted ship
  // is several times heavier than a lean one and DRAG_PER_WEIGHT was halved
  // (0.10 -> 0.05) while BASE_BOOST was raised slightly (1.10 -> 1.15) to
  // compensate.  Net effect at the two ends of the curve:
  //   weaponless bare frame (w 1.0)  -> x1.10  (was x1.10 — the fly-light hook)
  //   lean start, hull + Blaster (2.0) -> x1.05  (was x1.00 — the slight base bump)
  //   fully outfitted (w ~13.9)      -> x0.68  (was x0.82 with guns only)
  // So a maxed ship is now genuinely heavy and leans on Engine/Thrusters to
  // stay nimble, which is the point of weighting every module.
  BASE_BOOST: 1.15,
  DRAG_PER_WEIGHT: 0.05,
  // Weight is PHYSICAL, not just a thrust number: the player's collision mass
  // scales with it, so a heavy ship shrugs off impacts and plows debris while
  // a stripped one gets shoved around.  Normalised so the LEAN loadout
  // (MASS_REFERENCE) is exactly today's PHYSICS_CONSTANTS.PLAYER_MASS; the
  // MASS_BASE term is the hull's own inertia, which keeps the ratio finite
  // when every module is stripped off.
  MASS_BASE: 4,
  MASS_REFERENCE: 2,
};

/** Which family an installed module must TOUCH (an ACTIVE module of any
 *  listed family, adjacent per HEX_ADJACENCY) to function.  Absent =
 *  root (hull, gun) — always active while installed. */
export const MODULE_REQUIREMENTS: Partial<Record<ModuleFamily, ModuleFamily[]>> = {
  engine:     ['hull'],
  thrusters:  ['engine'],
  shield:     ['hull'],
  plating:    ['hull'],
  capacitor:  ['shield'],
  gunnery:    ['gun'],
  autoloader: ['gun'],
  overcharge: ['gun'],
  utility:    ['hull'],
};

/** Neighbour indices per hex slot in the 7-flower: 0 = center (touches
 *  all six); ring tiles touch the center + their two ring neighbours. */
export const HEX_ADJACENCY: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 5, 6],
  [0, 2, 6], [0, 1, 3], [0, 2, 4], [0, 3, 5], [0, 4, 6], [0, 5, 1],
];

// Mk pricing ≈ the CUMULATIVE cost of the old per-level curve at that
// level (rounded) so the salvage economy is unchanged in total: reaching
// "Mk III power" costs about what L3 used to.
const MK = ['', ' Mk I', ' Mk II', ' Mk III'];
/** `mk1Weight` is the Mk I mass; Mk II/III scale linearly with the mark, the
 *  same way their effects and prices do — a bigger plate is a heavier plate. */
const statMks = (
  family: ModuleFamily, group: ModuleGroup, kind: ModuleKind, label: string,
  descOf: (mk: number) => string, costs: number[], effOf: (mk: number) => ModuleEffect,
  mk1Weight: number,
): ModuleDef[] => costs.map((cost, i) => ({
  id: `${family}_mk${i + 1}`, family, mark: i + 1, group, kind,
  label: `${label}${MK[i + 1]}`, desc: descOf(i + 1), cost, effect: effOf(i + 1),
  weight: +(mk1Weight * (i + 1)).toFixed(1),
}));

export const MODULE_DEFS: readonly ModuleDef[] = [
  // ── Ship group ──
  // Every run STARTS with the free Base Hull mounted on the center ship
  // hex (mirror of the starter Blaster on gun hex W1): it adds no stats
  // but is the adjacency ROOT the whole ship-module tree chains from, so
  // bought modules work out of the box.  cost 0 keeps it out of the shop.
  { id: 'hull_base', family: 'hull', mark: 0, group: 'ship', kind: 'ship', label: 'Base Hull', desc: 'Integral hull frame — ship modules chain from hull contact', cost: 0, weight: 1.0 },
  ...statMks('hull', 'ship', 'ship', 'Hull', mk => `+${25 * mk} max HP`, [4000, 10000, 18000], mk => ({ maxHp: 25 * mk }), 0.8),
  { id: 'shield', family: 'shield', mark: 1, group: 'ship', kind: 'ship', label: 'Shield', desc: 'Deflector shield core', cost: 30000, effect: { shieldCore: true }, weight: 0.6 },
  { id: 'flashlight_kit', family: 'utility', mark: 1, group: 'ship', kind: 'ship', label: 'Light', desc: 'Ship light — tap your ship to cycle it off / medium / high', cost: 9000, effect: { flashlight: true }, weight: 0.3 },
  ...statMks('plating', 'ship', 'ship', 'Plating', mk => `+${15 * mk} max shield`, [4000, 10000, 18000], mk => ({ maxShield: 15 * mk }), 0.5),
  ...statMks('capacitor', 'ship', 'ship', 'Capacitor', mk => `+${25 * mk}% shield regen`, [5000, 12500, 23000], mk => ({ shieldRegenFrac: 0.25 * mk }), 0.3),
  ...statMks('engine', 'ship', 'ship', 'Engine', mk => `+${8 * mk}% top speed`, [6000, 15000, 27500], mk => ({ speedFrac: 0.08 * mk }), 0.6),
  ...statMks('thrusters', 'ship', 'ship', 'Thrusters', mk => `+${12 * mk}% acceleration`, [6000, 15000, 27500], mk => ({ accelFrac: 0.12 * mk }), 0.4),
  // ── Weapon group: guns (gun hexes only) ──
  { id: 'wpn_blaster',   family: 'gun', mark: 1, group: 'weapon', kind: 'weapon', weapon: WeaponType.BLASTER,   label: 'Blaster',   desc: 'Starter sidearm',   cost: 0, weight: 1.0 },
  { id: 'wpn_burst',     family: 'gun', mark: 1, group: 'weapon', kind: 'weapon', weapon: WeaponType.BURST,     label: 'Burst',     desc: '3-shot burst',      cost: 25000, weight: 1.3 },
  { id: 'wpn_shotgun',   family: 'gun', mark: 1, group: 'weapon', kind: 'weapon', weapon: WeaponType.SHOTGUN,   label: 'Shotgun',   desc: 'Pellet cone',       cost: 32500, weight: 1.5 },
  // Player-facing name unified to "Laser" (pivot 1d, user decision); code
  // identifiers (WeaponType.BOUNCER, isBouncer, …) unchanged.
  { id: 'wpn_bouncer',   family: 'gun', mark: 1, group: 'weapon', kind: 'weapon', weapon: WeaponType.BOUNCER,   label: 'Laser',     desc: 'Piercing beams',    cost: 40000, weight: 1.6 },
  { id: 'wpn_lightning', family: 'gun', mark: 1, group: 'weapon', kind: 'weapon', weapon: WeaponType.LIGHTNING, label: 'Lightning', desc: 'Chain lightning',   cost: 45000, weight: 1.8 },
  { id: 'wpn_homing',    family: 'gun', mark: 1, group: 'weapon', kind: 'weapon', weapon: WeaponType.HOMING,    label: 'Homing',    desc: 'Tracking missiles', cost: 50000, weight: 2.0 },
  { id: 'wpn_cannon',    family: 'gun', mark: 1, group: 'weapon', kind: 'weapon', weapon: WeaponType.CANNON,    label: 'Cannon',    desc: 'AoE plasma',        cost: 60000, weight: 2.5 },
  // ── Weapon group: performance mods (non-gun hexes; must touch a gun) ──
  ...statMks('gunnery', 'weapon', 'weapon-mod', 'Gunnery', mk => `+${12 * mk}% weapon damage`, [8000, 20000, 38000], mk => ({ damageFrac: 0.12 * mk }), 0.2),
  ...statMks('autoloader', 'weapon', 'weapon-mod', 'Autoloader', mk => `-${8 * mk}% fire cooldown`, [10000, 26000, 51500], mk => ({ cooldownFrac: 0.08 * mk }), 0.3),
  { id: 'overcharge', family: 'overcharge', mark: 1, group: 'weapon', kind: 'weapon-mod', label: 'Overcharge', desc: 'Hold-to-charge shots', cost: 45000, effect: { overcharge: true }, weight: 0.5 },
];

export function moduleDef(id: string): ModuleDef | undefined {
  return MODULE_DEFS.find(d => d.id === id);
}
/** True when `def` may sit in `group` slot index `idx`.  Placement is
 *  slot-agnostic within a group (guns + weapon mods mix freely in the
 *  weapon flower — the gun LIMIT is a count, enforced at move time);
 *  `idx` stays in the signature for future per-slot ship layouts. */
export function moduleFitsSlot(def: ModuleDef, group: ModuleGroup, _idx: number): boolean {
  if (def.group !== group) return false;
  if (group === 'weapon') return def.kind === 'weapon' || def.kind === 'weapon-mod';
  return def.kind === 'ship' || def.kind === 'ship-part';
}

// ── Timed-wave config ────────────────────────────────────────────────────────
// Waves are timed windows: enemies stream in continuously until the clock
// runs out.  Killing the full spawn budget before time-up ends the wave
// early; survivors at time-up are NEVER despawned — they carry over and
// keep fighting alongside the next wave's stream.
export const TIMED_WAVE_CONFIG = {
  // Duration scaling: wave 1 = BASE, +PER_WAVE each wave, capped.
  BASE_DURATION_SEC: 30,
  DURATION_PER_WAVE_SEC: 5,
  DURATION_CAP_SEC: 90,
  // Spawn stream: unscaled budget = floor(duration / interval), where the
  // interval shrinks per wave so later waves are denser as well as longer.
  // DIFFICULTY_SCALES multiplies the budget (same duration → lower
  // difficulty = proportionally slower spawn rate; 0 disables waves).
  BASE_SPAWN_INTERVAL_SEC: 5.0,
  SPAWN_INTERVAL_DECAY_PER_WAVE: 0.15,
  MIN_SPAWN_INTERVAL_SEC: 1.8,
  MAX_SPAWN_BUDGET: 30,        // per-wave ceiling regardless of duration math
  // Final-quarter crescendo: spawn density multiplier over the last
  // FRACTION of the wave window (the schedule is precomputed from this
  // piecewise density, so the budget total is exact).
  FINAL_QUARTER_FRACTION: 0.25,
  FINAL_QUARTER_RATE_MULT: 1.5,
  // Stream pressure valve: scheduled spawns are held while this many wave
  // enemies are alive; the backlog then drains at most one spawn per
  // BACKLOG_MIN_GAP_SEC so a freed cap never dumps a clump at once.
  MAX_CONCURRENT_ENEMIES: 10,
  BACKLOG_MIN_GAP_SEC: 0.4,
  // Wave-index → tier-weight row mapping for the weighted-random mix
  // (see WAVE_TIER_WEIGHTS next to WAVE_DEFINITIONS).
  TIER_SET_LENGTH: 3,
};

// ── Audio ─────────────────────────────────────────────────────────────────────
// Mixer + voice-budget tuning for AudioSystem.  WHAT plays and with what
// per-sound parameters lives in docs/SFX_INVENTORY.md (and, in code, in the
// SfxRegistry defs); this block is only the global machinery.
//
// The three voice ceilings are the anti-mass-death budget: a single sim step
// in this engine can kill 40 enemies (snitch board-clear) or shatter a merged
// rock parent into 200 fragments.  Tier 3 stops being admitted first, then
// tier 2; tier 1 (the sounds the player acts on) always plays.  Together with
// the per-id retrigger COLLAPSE (which bumps the live voice's gain instead of
// stacking a new one), a bulk event reads as one HEAVIER sound rather than as
// hundreds of thin ones — the same "cosmetic output, safe to drop" reasoning
// as enforceCap for particles, applied to a budget the ear rather than the
// frame time enforces.
//
// PROVISIONAL: every number here was reasoned about, not measured on the
// user's hardware (gauntlet log, FOR-USER-REVIEW).
export const AUDIO_CONSTANTS = {
    /** A decoded sample peaking below this is treated as a BROKEN export and
     *  discarded in favour of the synth draft.  `play()` multiplies by the
     *  def's mix gain (~0.3) and then by distance attenuation, so anything
     *  under this cannot be heard in play whatever it was meant to be — the
     *  file has not made the sound quieter, it has removed it.  ~-26 dBFS. */
    SAMPLE_MIN_PEAK: 0.05,

  /** IMPACT VOICING — the ear reads the same dial as the camera
   *  (docs/SFX_INVENTORY.md §4.4).  A body collision produces two pieces of
   *  feedback, and they used to be computed from two unrelated scales with
   *  no mass in either.  Both now come from `I` — the struck body's own
   *  velocity step normalised by `COLLISION_CONFIG.SHAKE.IMPACT_MAX`, i.e.
   *  literally `shake / 30`.
   *
   *  The TILE span is load-bearing rather than taste: dividing dv by 18
   *  reproduces the shipped `impactSpeed / 12` curve exactly, so the wall
   *  crash is bit-for-bit unchanged and only lighter impactors get quieter —
   *  the same isolating claim the shake change makes.  The trade it buys is
   *  that above its span a row is already at full gain, so the camera can
   *  still separate a hard crash from a catastrophic one and the ear cannot.
   *
   *  PITCH is taken from MASS, not size, because mass is already the term
   *  inside `I` — so the two cues cannot disagree, and a 40px metal shard
   *  knocks lower than a same-size rock, which it should, since it also
   *  shakes harder. */
  /** The dv at which a row reaches FULL gain.  Per row, not global: the tile
   *  crash is gated at closing speed 4 and can reach dv 30, while the shard
   *  row is gated at 1.2 and tops out around dv 7 — normalising both by the
   *  same span pinned every shard contact to its floor, i.e. a voice with no
   *  dynamics at all.  Each row now uses the range it can actually reach, so
   *  "harder is louder" holds WITHIN a row; the absolute level ordering
   *  BETWEEN rows stays where the mix levels put it.
   *
   *  TILE is 18 because that is the parity number: it reproduces the shipped
   *  `impactSpeed / 12` curve exactly (a static body takes the whole step, so
   *  dv = 1.5 v). */
  IMPACT_SPAN_TILE: 18,
  IMPACT_SPAN_SHARD: 6,
  IMPACT_SPAN_ENEMY: 12,
  IMPACT_PITCH_REF_MASS: 25,   // (REF / mass) ^ EXP
  IMPACT_PITCH_EXP: 0.25,
  /** The clamps are set to the MEASURED extremes of everything that actually
   *  reaches a mass-pitched row, so the curve can reach its own ends.
   *
   *  At 0.70/1.60 they were binding on **20.9%** of hits — a fifth of every
   *  impact in the game played at one of exactly two pitches, with no
   *  dynamics at all. Worst were the smallest glass shards (all pinned to the
   *  top) and the heaviest rock (all pinned to the bottom), i.e. precisely the
   *  extremes the cue exists to distinguish. At 0.46/2.50 it is **0.4%**.
   *
   *  THREE rows consume this (PhysicsSystem.impactVoice) and the bounds come
   *  from their real populations:
   *    · `crash.player.shard` — glass 0.69–8.2, plastic 4.9–10.3, metal 19.4,
   *      rock 7.2–460.7 → wants 0.483 … 2.450
   *    · `crash.player.enemy` — SWARM mass 4 → 1.581, DRAGON mass 500 → 0.473
   *    · `crash.player.tile`  — passes Infinity, so it is unpitched by design
   *
   *  NEBULA shards are deliberately NOT a consumer despite a 0.01 sentinel
   *  mass that would demand a clamp of 7.07: player↔nebula-shard hard
   *  collision is default OFF (they pass through and swirl), so that row never
   *  fires for them. If that toggle is ever turned on by default, this comment
   *  is the thing that breaks.
   *
   *  Heavier still is possible — rock merges past 460 over a long run — and
   *  that is what a floor is FOR. The bound is "every population can reach its
   *  own ends", not "nothing is ever clamped". */
  IMPACT_PITCH_MIN: 0.46,
  IMPACT_PITCH_MAX: 2.50,
  /** Per-row gain floors (docs/SFX_INVENTORY.md §4.4).  A floor is what stops
   *  a voice fading to nothing: the tile crash has none because it is gated
   *  hard enough that a quiet one is meaningful, while the light-contact rows
   *  keep a presence. */
  IMPACT_FLOOR_TILE: 0,
  IMPACT_FLOOR_SHARD: 0.25,
  IMPACT_FLOOR_ENEMY: 0.30,

  DEFAULT_VOLUME: 0.7,     // master gain at boot; in-memory only (no persistence)
  MAX_VOICES: 24,          // hard ceiling across all tiers
  MAX_VOICES_TIER2: 20,    // tier-2 triggers stop being admitted here
  MAX_VOICES_TIER3: 14,    // tier-3 (material chatter) stops first
  COLLAPSE_BUMP: 1.22,     // gain multiplier per collapsed retrigger
  COLLAPSE_BUMP_CAP: 2.2,  // saturation, so 40 collapses ≠ 40× loud
  VOICE_RELEASE_PAD: 0.03, // slack added to a voice's tracked lifetime (s)
  LOOP_RAMP: 0.09,         // loop fade in/out time constant (s)
  NOISE_BUFFER_SEC: 2,     // shared white-noise buffer length
  // Positional model.  Distances are world units, measured torus-wrapped.
  NEAR_RADIUS: 420,        // full volume inside this
  FAR_RADIUS: 2600,        // inaudible beyond this (linear between)
  // AMBIENT shard chatter — shards colliding, merging and snapping with
  // each other somewhere the player is not.  At the normal radius a dense
  // field chatters constantly from events the player has nothing to do
  // with, so these carry only in CLOSE PROXIMITY.  The same material
  // destroyed BY the player (killedByPlayer: shot, rammed, chained,
  // splashed) is played at the normal radius instead — proximity is the
  // rule for ambient events, not for the player's own.
  SHARD_NEAR_RADIUS: 240,
  SHARD_FAR_RADIUS: 850,
  // POI presence loops.  Both swell with proximity rather than switching
  // on at the interaction range — the loop starts from the NEAREST POI at
  // any distance and the attenuation does the work, so walking toward a
  // station or a rift is an audible approach.  The station carries further
  // because it is a much larger object.
  PORTAL_NEAR_RADIUS: 300,
  PORTAL_FAR_RADIUS: 1600,
  STATION_NEAR_RADIUS: 420,
  STATION_FAR_RADIUS: 2200,
  // The snitch, whose whole job is to be FOUND — distance and bearing are
  // the information, and the sound is only the carrier.
  //
  // It needs its own radii rather than the default 420/2600 because the
  // caller used to gate the loop at 1200 units while the default far
  // radius was 2600: across the entire range it could be heard the
  // attenuation never fell below 0.64, so it snapped on at two-thirds
  // volume and stayed there.  That is why it read as non-positional
  // despite being flagged positional and panning correctly.
  //
  // NEAR is deliberately tiny — full volume only when practically on top
  // of it — and the CURVE is what does the real work: a linear fade is
  // still at half amplitude halfway out, about 6 dB down, which the ear
  // reads as "close but quieter" rather than "far".  Raising it to a power
  // makes the same crossing a dramatic one.  At 500 units of 1500 the
  // linear model gives 0.70; this gives 0.41.
  SNITCH_NEAR_RADIUS: 90,
  SNITCH_FAR_RADIUS: 1500,
  SNITCH_DISTANCE_CURVE: 2.5,
  PAN_WIDTH: 900,          // world units mapping to full L/R pan
} as const;

// ─── DBG: voice COLLAPSE mode ────────────────────────────────────────────────
//
// A single frame can kill 40 enemies or shatter 200 shards, and the shipped
// answer is to COLLAPSE simultaneous triggers of one id into a single louder
// voice (AUDIO_CONSTANTS.COLLAPSE_BUMP) so bulk reads as HEAVIER rather than
// as forty thin copies or one forty-times-louder one.
//
// That is a judgement, not a fact, and it was never A/B-able — so this cycle
// exists to hear the alternatives instead of arguing about them.  Three
// scales move together, because relaxing one alone changes nothing: the
// share of in-window triggers that still get a voice, the per-id POLYPHONY
// cap, and the global tier CEILINGS.  Let more through without raising the
// caps and the extras are simply dropped a step later.
//
//   Merge  — shipped.  One heavier voice per burst.
//   Some   — half the window, double the voices.  A burst of 40 lands as
//            roughly 20 distinct hits instead of 1.
//   All    — no collapse at all: every trigger that arrives gets a voice,
//            subject only to a much-raised ceiling.  This is the honest
//            "what does 40-at-once actually sound like" test, and it is
//            expected to be ugly — that is the evidence.
//
// DELIBERATELY A DBG CYCLE AND NOT A SETTING.  `All` can put dozens of
// voices in one frame; it is a listening tool, not a supported mix.
export interface CollapseMode {
  name: string;
  /** Fraction of the triggers arriving INSIDE the retrigger window that
   *  still get their own voice.  0 = none (the shipped merge), 1 = all.
   *
   *  A fraction rather than a window scale, because a mass-death frame
   *  fires every trigger at the same context time: the gap between them is
   *  exactly zero, so no window is small enough to let a second one
   *  through.  Counting them is the only thing that can subdivide a burst,
   *  and a first version that scaled the window measured 1 voice from 40
   *  triggers in BOTH of its modes. */
  pass: number;
  /** Multiplies each id's polyphony cap. */
  poly: number;
  /** Multiplies the global + per-tier voice ceilings. */
  ceiling: number;
  /** Whether a collapsed retrigger still bumps the live voice's gain. */
  bump: boolean;
}
export const COLLAPSE_MODES: ReadonlyArray<CollapseMode> = [
  { name: 'Merge', pass: 0,   poly: 1, ceiling: 1, bump: true  },
  { name: 'Some',  pass: 0.5, poly: 3, ceiling: 3, bump: true  },
  { name: 'All',   pass: 1,   poly: 8, ceiling: 6, bump: false },
] as const;
let activeCollapseIndex = 0;
export function getActiveCollapseMode(): CollapseMode { return COLLAPSE_MODES[activeCollapseIndex]; }
export function getActiveCollapseModeName(): string { return COLLAPSE_MODES[activeCollapseIndex].name; }
export function cycleCollapseMode(): CollapseMode {
  activeCollapseIndex = (activeCollapseIndex + 1) % COLLAPSE_MODES.length;
  return COLLAPSE_MODES[activeCollapseIndex];
}

// ── Snitch ───────────────────────────────────────────────────────────────────
// A golden-comet snitch rides the asteroid flow field with a burst/coast AI
// and PERSISTS across waves — one keeps flying until the player catches it.
// Both speed states sit below the player's cruise, so a steady chase always
// closes; the weave + panic darts are what keep it slippery.  Catching it
// (collide or shoot — catch mode is a DBG toggle while playtesting) pays
// SCORE_CONSTANTS.SNITCH_POINTS and ends the current wave; the next wave
// spawns a fresh one.
export const SNITCH_CONSTANTS = {
  SIZE: 14,              // core diameter (world units)
  MASS: 2,               // finite → dynamic grid; broadphase still skips it (non-drop INTERACTABLE)
  // ── Burst/coast AI ────────────────────────────────────────────────────
  // The snitch alternates between two states instead of flying flat-out:
  //   coast — lazy drift along the flow at COAST_SPEED_FRACTION of the
  //           player's terminal cruise; this is the catch window.
  //   dart  — short, violent acceleration to DART_SPEED_FRACTION (briefly
  //           faster than the player) before bleeding back down to coast.
  // Darts fire on a random coast timer AND whenever the player closes
  // inside PANIC_RADIUS (panic darts bias away from the player by
  // PANIC_AWAY_BIAS).  PANIC_COOLDOWN guarantees a coast window between
  // panic darts so a persistent chaser always gets another chance.
  // Speed fractions apply to the friction-limited player cruise
  // (acceleration/(1−friction), clamped by maxSpeed).
  // Per-CATCH speed ramp.  The snitch's headline (dart) speed is
  // WAVE_SPEED_STEP × (catchCount + 1) as a fraction of player cruise — the
  // FIRST snitch = 0.05×, after one catch = 0.10×, etc. — capped at
  // WAVE_SPEED_MAX so it never gets hopelessly uncatchable.  Speed ramps
  // only when the snitch is CAUGHT (not per wave), so the player can defer
  // it to keep it slow.  Coast drifts at COAST_RATIO of the dart speed,
  // preserving the burst/coast catch window.  The DBG SNITCH_SPEED_CYCLE
  // multiplier scales the whole thing on top.
  WAVE_SPEED_STEP: 0.05,
  WAVE_SPEED_MAX: 1.2,
  COAST_RATIO: 0.30,
  DART_RATIO: 1.0,
  SPEED_EASE_DART: 6.5,  // 1/s ease toward the dart speed — near-instant burst
  SPEED_EASE_COAST: 2.0, // 1/s ease back down — visible deceleration tail
  COAST_STEER_RATE: 0.06, // per-60Hz-frame velocity lerp while coasting
  DART_STEER_RATE: 0.18,  // snappier course-holding mid-dart
  COAST_DURATION_MIN: 1.6, // seconds before a spontaneous dart
  COAST_DURATION_MAX: 3.6,
  DART_DURATION_MIN: 0.6,
  DART_DURATION_MAX: 1.0,
  PANIC_RADIUS: 700,     // world units — player inside this triggers a panic dart
  PANIC_COOLDOWN: 2.2,   // seconds of guaranteed coast eligibility between panic darts
  PANIC_AWAY_BIAS: 0.65, // 0..1 blend of away-from-player into the dart direction
  // Wander: the sampled flow direction is rotated by sin(t·FREQ + phase)·AMP
  // so the snitch weaves around its streamline instead of railing it.
  WANDER_AMPLITUDE: 0.9, // radians (~±51°)
  WANDER_FREQ: 2.2,      // rad/s
  // Catch geometry.  Collide mode: hull-to-hull contact plus this grace.
  // Shoot mode: any player-owned projectile core within this radius.
  COLLIDE_GRACE: 8,
  SHOOT_RADIUS: 18,
  // Spawn ring — same off-screen contract as wave-enemy spawns.
  SPAWN_MARGIN: 240,     // world units beyond the viewport half-diagonal
  // Visuals — golden comet: hot core (RenderSystem isSnitch branch), gold
  // trail strip (TrailPoint array, projectile-style strip), sparkle motes.
  CORE_COLOR: '#fde047',
  GLOW_COLOR: '#f59e0b',
  TRAIL_LIFETIME: 0.5,   // seconds per trail point — sets the comet-tail length
  TRAIL_SCALE: 0.9,
  SPARKLE_COLORS: ['#fde047', '#fbbf24', '#fff7cc', '#f59e0b'] as string[],
  CATCH_BURST_COUNT: 40, // gold particle burst on catch
};

// DBG snitch-speed multiplier on both AI speed states (coast + dart).
// Cycled live from the DBG panel (Player ▸ Snitch spd) so the chase feel
// can be tuned without a rebuild.  Multiplies the cruise-relative target
// speed in GameEngine.updateSnitch, so it scales coast and dart together
// and tracks player-cruise changes.  Default 1.0× = the base fractions.
export const SNITCH_SPEED_CYCLE: ReadonlyArray<number> = [
  0.5, 0.75, 1.0, 1.5, 2.0,
] as const;
let activeSnitchSpeedIndex = 2; // 1.0×
export function getActiveSnitchSpeedMult(): number {
  return SNITCH_SPEED_CYCLE[activeSnitchSpeedIndex];
}
export function getActiveSnitchSpeedName(): string {
  return `${SNITCH_SPEED_CYCLE[activeSnitchSpeedIndex]}×`;
}
export function cycleSnitchSpeed(): number {
  activeSnitchSpeedIndex = (activeSnitchSpeedIndex + 1) % SNITCH_SPEED_CYCLE.length;
  return activeSnitchSpeedIndex;
}

/** Does this entity STEER ITSELF around portals rather than being captured?
 *
 *  ONE predicate, so "aware of the rift" is a property of the world rather
 *  than a behaviour each mover re-implements.  The default is by TYPE — every
 *  ENEMY (which is what a bubble, a dragon head and a rival all are) plus the
 *  snitch — so a future roamer built on those types is covered the day it
 *  exists, with no physics change and nothing to remember.  `avoidsPortals`
 *  on the entity overrides it in either direction: opt something else in, or
 *  opt a specific enemy out so a rift can eat it.
 *
 *  The PLAYER is deliberately not included: a human is already aware of the
 *  hole, and taking their steering away is the one thing the tug must never
 *  do.  Loose matter is not included either — shards and drops spiralling in
 *  is the effect, not a bug. */
export function avoidsPortals(e: GameEntity): boolean {
  if (e.avoidsPortals !== undefined) return e.avoidsPortals;
  return e.type === EntityType.ENEMY || e.isSnitch === true;
}

/** The portal's event-horizon radius in WORLD units — the black disc the
 *  renderer draws AND the radius at which the well swallows a shard.
 *
 *  ONE definition, called by both, because they are the same circle: matter
 *  has to disappear exactly where the hole is drawn, and two copies of this
 *  arithmetic would drift the moment either side was tuned.  (Same argument
 *  as `computeMinimapRect` — see CLAUDE.md §8, "ONE screen corner, one rect".)
 *
 *  Scales with the DESTINATION's map span, stamped on the entity as
 *  `portalDestSpan` by `BaseMapLayer.addPortal` — passed as data rather than
 *  looked up here, because the map classes import `constants`, so reading map
 *  dimensions from this module would be an import cycle.  A portal with no
 *  span recorded falls back to the reference (1×) rather than vanishing. */
export function portalHorizonRadius(e: GameEntity): number {
  const H = PORTAL_CONSTANTS.HORIZON;
  const span = e.portalDestSpan;
  const scale = span && span > 0
    ? Math.min(H.MAX_SCALE, Math.max(H.MIN_SCALE,
        Math.pow(span / H.REFERENCE_SPAN, H.EXPONENT)))
    : 1;
  return (e.size.x / 2) * H.BASE_FRACTION * scale * getPortalSizeMult();
}

// ── DBG portal tuning (user call: the rift reads as too POWERFUL) ───────────
// Five live multipliers over the wormhole's shipped numbers, so how strong a
// portal is can be judged by FLYING past one rather than by rebuilding.  Every
// one is applied at the READ, never baked into the portal entity: the entity
// keeps PORTAL_CONSTANTS as its base truth, so a knob takes effect on the
// portals already in the world (no map reload) and nothing drifts out of sync.
//
// The reported dizziness is a MOTION complaint — strafing the mouth swings the
// lensed star field back and forth — so the lens is split into two knobs, one
// for how far it displaces and one for how fast it turns.  Either can be taken
// to 0 independently, which is what separates "the warp is too strong" from
// "the warp must not MOVE" as answers.
//
// SIZE scales the drawn rift, its swallow horizon and its lens radius
// together (all three are `size.x` reads).  It deliberately does NOT touch
// USE_RANGE: how close you must be to ENTER is an interaction rule, not a look,
// and a knob that quietly moved it would make every other A/B unreadable.
export const PORTAL_SIZE_CYCLE: ReadonlyArray<number> = [1.0, 0.75, 0.5, 0.35, 1.25] as const;
// The well was tuned DOWN to 0.25x strength / 0.5x range and baked, so both
// cycles now run well ABOVE 1x as well as below it: 4x strength and 2x range
// together reproduce the old g6000/1050 rift exactly, which is what makes the
// change itself re-testable from inside the game rather than only in git.
export const PORTAL_GRAVITY_CYCLE: ReadonlyArray<number> =
  [1.0, 0.5, 0.25, 0, 1.5, 2.0, 3.0, 4.0] as const;
export const PORTAL_GRAVITY_RANGE_CYCLE: ReadonlyArray<number> =
  [1.0, 0.75, 0.5, 1.5, 2.0, 3.0] as const;
// Strengths ABOVE 1 are here because "how far can this be pushed" is a real
// question to ask of a look, and the shipped value is only the current answer.
// Nothing clamps them: the twist stays bounded by construction (TWIST +
// TWIST_SWING < 2*PI at 1x, so 3x is still under two turns and cannot band),
// and the push is a fraction of the lens radius, so it scales without ever
// out-reaching the region it belongs to.
// Index 0 is what ships.  The high end runs well past plausible on purpose:
// the twist is CLAMPED below one turn at the read (BackgroundManager), so
// even 12× cannot bring the banding back — it only drives the radial push
// harder, which is the half of the warp that has no failure mode.
export const PORTAL_LENS_CYCLE: ReadonlyArray<number> =
  [1.0, 0.5, 0.25, 0, 1.5, 2.0, 3.0, 5.0, 8.0, 12.0] as const;
/** Lens RADIUS as a multiple of the rift's horizon — how much sky the warp
 *  covers, separate from how hard it bends it.  Index 0 is LENS.RADIUS_MULT,
 *  the shipped value; the steps above it are what "hug the hole" looks like
 *  when it is loosened back off. */
export const PORTAL_LENS_RADIUS_CYCLE: ReadonlyArray<number> = [14, 4, 6, 9, 20, 30, 2.5] as const;
let activePortalLensRadiusIndex = 0;
export function getPortalLensRadiusMult(): number {
  return PORTAL_LENS_RADIUS_CYCLE[activePortalLensRadiusIndex];
}
export function getPortalLensRadiusName(): string {
  return `${PORTAL_LENS_RADIUS_CYCLE[activePortalLensRadiusIndex]}×`;
}
export function cyclePortalLensRadius(): number {
  activePortalLensRadiusIndex = (activePortalLensRadiusIndex + 1) % PORTAL_LENS_RADIUS_CYCLE.length;
  return activePortalLensRadiusIndex;
}
export const PORTAL_LENS_SPIN_CYCLE: ReadonlyArray<number> = [1.0, 0.5, 0.25, 0, 2.0, 4.0] as const;
// Index 0 of every cycle is the SHIPPED value, so the panel opens on what the
// player just flew through and the first click is always the A/B.
let activePortalSizeIndex = 0;
let activePortalGravityIndex = 0;
let activePortalGravityRangeIndex = 0;
let activePortalLensIndex = 0;
let activePortalLensSpinIndex = 0;

export function getPortalSizeMult(): number { return PORTAL_SIZE_CYCLE[activePortalSizeIndex]; }
export function getPortalGravityMult(): number { return PORTAL_GRAVITY_CYCLE[activePortalGravityIndex]; }
export function getPortalGravityRangeMult(): number { return PORTAL_GRAVITY_RANGE_CYCLE[activePortalGravityRangeIndex]; }
export function getPortalLensMult(): number { return PORTAL_LENS_CYCLE[activePortalLensIndex]; }
export function getPortalLensSpinMult(): number { return PORTAL_LENS_SPIN_CYCLE[activePortalLensSpinIndex]; }

/** The outward speed the arrival is thrown at, SOLVED against the exit rift's
 *  well rather than tuned beside it.
 *
 *  This is a number that has to agree with four others — GRAVITY_STRENGTH,
 *  GRAVITY_PLAYER_SCALE, GRAVITY_RANGE and ARRIVAL_OFFSET — and it stopped
 *  agreeing the moment the well was retuned: the literal it replaced was
 *  sized against a 700-unit well and left standing when the well grew to
 *  1050, which still escaped on a clear run but reached the rim with almost
 *  nothing left, so one clip of terrain on the way out left the ship stuck
 *  in the throat.  Solving makes the agreement structural: the well can be
 *  retuned, or the DBG knobs dialled, and the arrival is re-sized to match
 *  with nothing to remember.
 *
 *  The model is the sim's own arithmetic, not an approximation of it — the
 *  player-side gravity read from `PhysicsSystem.applyGravity` (including its
 *  0.2 acceleration clamp and the `max(distSq, 1e4)` near-field floor) and
 *  the integrate-then-damp order from the same file's integration step, at
 *  the 60 Hz reference the velocity units are quoted in.  A closed form was
 *  not usable: friction is what actually decides the trip (a purely
 *  ballistic escape needs only ~3.7 px/step, which crawls out over several
 *  seconds and reads as being let go rather than thrown), so the criterion
 *  has to be "outside the range within CLEAR_SEC", which the drag term makes
 *  transcendental.  Forty bisection steps over a ~45-step forward integration
 *  is a few microseconds, once per transit — free at this call rate.
 *
 *  Reads the DBG gravity knobs, like every other portal consumer, so an A/B
 *  on the well's strength carries the escape with it instead of quietly
 *  breaking the way home. */
export function playerEjectSpeed(mapType: MapType): number {
  const P = PORTAL_CONSTANTS;
  const T = P.TRANSIT;
  const move = PLAYER_MOVEMENT_CONFIG[mapType];
  const friction = move.friction;
  // What the PLAYER feels: the well's strength times its player fraction,
  // times the DBG knob.  Mass never enters — gravity is applied as an
  // acceleration — so hull weight cannot change the escape.
  const pull = P.GRAVITY_STRENGTH * P.GRAVITY_PLAYER_SCALE * getPortalGravityMult();
  const range = P.GRAVITY_RANGE * getPortalGravityRangeMult();
  const budget = Math.max(1, Math.round(T.PLAYER_CLEAR_SEC * 60));

  // Does an arrival at v0 get outside `range` within the budget?
  const clears = (v0: number): boolean => {
    let d = P.ARRIVAL_OFFSET, v = v0;
    for (let i = 0; i < budget; i++) {
      v -= Math.min(pull / Math.max(d * d, 1e4), 0.2);
      d += v;
      v *= friction;
      if (d >= range) return true;
      if (d <= 1) return false;          // fell back through the mouth
    }
    return false;
  };

  // Cruise is the friction-limited top speed the ship reaches under its own
  // thrust; the shove is capped as a fraction of it so it can never read as
  // a launch.  Note the spec is stated against GRAVITY_RANGE, not against the
  // pull, so a well switched OFF at the DBG knob still spits the player the
  // same distance clear of the door rather than parking them in it.
  const cruise = move.acceleration / Math.max(1e-6, 1 - friction);
  const ceiling = cruise * T.PLAYER_EJECT_CRUISE_FRAC;
  // Degenerate config guard: an arrival already outside the range needs no
  // shove at all.  (Not the gravity-knob-off case — with the pull switched
  // off a resting ship still never crosses the rim, so that one solves for
  // the speed that simply covers the distance.)
  if (clears(0)) return 0;
  let lo = 0, hi = ceiling;
  if (!clears(hi)) return hi;            // deeper than CLEAR_SEC allows — cap wins
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

export function getPortalSizeName(): string { return `${PORTAL_SIZE_CYCLE[activePortalSizeIndex]}×`; }
export function getPortalGravityName(): string {
  const v = PORTAL_GRAVITY_CYCLE[activePortalGravityIndex];
  return v === 0 ? 'off' : `${v}×`;
}
export function getPortalGravityRangeName(): string { return `${PORTAL_GRAVITY_RANGE_CYCLE[activePortalGravityRangeIndex]}×`; }
export function getPortalLensName(): string {
  const v = PORTAL_LENS_CYCLE[activePortalLensIndex];
  return v === 0 ? 'off' : `${v}×`;
}
export function getPortalLensSpinName(): string {
  const v = PORTAL_LENS_SPIN_CYCLE[activePortalLensSpinIndex];
  return v === 0 ? 'frozen' : `${v}×`;
}
/** Live readout of what the knobs currently resolve to, in the units the
 *  constants are authored in — so a chosen combination can be copied back
 *  into PORTAL_CONSTANTS once an A/B settles. */
export function getPortalTuningInfo(): string {
  const size = Math.round(PORTAL_CONSTANTS.SIZE * getPortalSizeMult());
  const str = Math.round(PORTAL_CONSTANTS.GRAVITY_STRENGTH * getPortalGravityMult());
  const rng = Math.round(PORTAL_CONSTANTS.GRAVITY_RANGE * getPortalGravityRangeMult());
  return `${size}px g${str}/${rng}`;
}

export function cyclePortalSize(): number {
  activePortalSizeIndex = (activePortalSizeIndex + 1) % PORTAL_SIZE_CYCLE.length;
  return activePortalSizeIndex;
}
export function cyclePortalGravity(): number {
  activePortalGravityIndex = (activePortalGravityIndex + 1) % PORTAL_GRAVITY_CYCLE.length;
  return activePortalGravityIndex;
}
export function cyclePortalGravityRange(): number {
  activePortalGravityRangeIndex = (activePortalGravityRangeIndex + 1) % PORTAL_GRAVITY_RANGE_CYCLE.length;
  return activePortalGravityRangeIndex;
}
export function cyclePortalLens(): number {
  activePortalLensIndex = (activePortalLensIndex + 1) % PORTAL_LENS_CYCLE.length;
  return activePortalLensIndex;
}
/** DBG transit-warp duration (seconds), 0 = the beat OFF.  Index 0 is the
 *  shipped value, like every other Portals row, so the first click is the A/B.
 *  Cycling it takes effect on the NEXT transit — the beat reads its length
 *  once, at the moment it starts. */
// Index 0 is what ships.  The long tail is deliberately silly at the top —
// "extreme" is a legitimate thing to want to SEE once, and a beat you can
// stretch to six seconds is how you inspect a frame of it without a
// screenshot harness.
export const PORTAL_WARP_CYCLE: ReadonlyArray<number> =
  [1.4, 0.9, 0.6, 2.2, 3.5, 6.0, 10.0, 0] as const;
let activePortalWarpIndex = 0;
export function getPortalWarpDuration(): number { return PORTAL_WARP_CYCLE[activePortalWarpIndex]; }
export function getPortalWarpName(): string {
  const v = PORTAL_WARP_CYCLE[activePortalWarpIndex];
  return v === 0 ? 'off' : `${v}s`;
}
export function cyclePortalWarp(): number {
  activePortalWarpIndex = (activePortalWarpIndex + 1) % PORTAL_WARP_CYCLE.length;
  return activePortalWarpIndex;
}

export function cyclePortalLensSpin(): number {
  activePortalLensSpinIndex = (activePortalLensSpinIndex + 1) % PORTAL_LENS_SPIN_CYCLE.length;
  return activePortalLensSpinIndex;
}

// ── Control schemes (user directive, step 5 G9) ──────────────────────────────
// Picked at game start (main menu) and changeable from the pause menu.  Like
// DIFFICULTY, the choice is a PREFERENCE: it survives restarts and is not
// part of run state.
//
// The axis that matters is the TOUCH MODEL.  The two touch schemes are
// mutually exclusive ways to drive the same ship — blending them (which is
// what shipped first) has the floating stick and the drag-to-fly gesture
// fighting over the same finger.  Keyboard and controller do NOT switch touch
// off; they select the standard touch model AND stop the MOUSE from dragging
// the ship, because on those schemes steering is the keys' or the stick's job
// and a click should only shoot.
//
//   scheme            stick+button   mouse drags   touch drags   tap fires
//   touch             no             yes           yes           yes
//   joystick-left     YES (L/R)      no            no (stick)    no (button)
//   joystick-right    YES (R/L)      no            no (stick)    no (button)
//   keyboard          no             NO            yes           yes
//   gamepad           no             NO            yes           yes
//
// The two joystick schemes are the same scheme MIRRORED — stick left + fire
// right, or stick right + fire left — because which thumb wants the stick is
// handedness, not preference about the game.  In both, the ship AIMS WHERE IT
// FLIES: the stick writes the synthetic pointer, so there is no separate aim
// gesture to compete with it.
//
// `keyboard` and `gamepad` are deliberately identical in TOUCH behaviour —
// the honest reading of "the controller and keyboard options should also
// allow simultaneous touch control".  What differs between them is which
// device the help panel leads with.
export const CONTROL_SCHEMES: ReadonlyArray<{
  id: ControlScheme;
  label: string;
  /** One line for the menu button's caption. */
  blurb: string;
}> = [
  { id: 'touch',          label: 'Touch',            blurb: 'Drag to fly and aim · tap to shoot' },
  { id: 'joystick-left',  label: 'Joystick (right-handed)', blurb: 'Stick left · fire button right' },
  { id: 'joystick-right', label: 'Joystick (left-handed)',  blurb: 'Stick right · fire button left' },
  { id: 'keyboard',       label: 'Keyboard',         blurb: 'WASD + mouse · touch still works' },
  { id: 'gamepad',        label: 'Controller',       blurb: 'Gamepad · touch still works' },
  { id: 'gamepad-thrust', label: 'Controller (trigger thrust)', blurb: 'Either trigger throttles · either stick steers + aims' },
  { id: 'gamepad-left',   label: 'Controller (left stick)',      blurb: 'Left stick / D-pad flies + aims · bottom face button shoots' },
] as const;

export function controlSchemeDef(id: ControlScheme) {
  return CONTROL_SCHEMES.find(c => c.id === id) ?? CONTROL_SCHEMES[0];
}

/** Per-scheme behaviour flags.  One table, read by InputSystem and by the
 *  engine's tap-to-fire gate — so "what does this scheme do" is answerable in
 *  one place rather than by grepping for the scheme name. */
export const CONTROL_SCHEME_RULES: Record<ControlScheme, {
  joystick: boolean;
  fireButton: boolean;
  mouseDragMoves: boolean;
  touchDragMoves: boolean;
  tapFires: boolean;
  /** Does a POINTER drag set the aim?  False under the joystick schemes,
   *  where the ship AIMS WHERE IT FLIES (user directive): the stick writes
   *  the synthetic pointer, so a second aim channel would only fight it. */
  pointerAims: boolean;
  /** Which side of the screen the stick lives on; the fire button takes the
   *  other.  Undefined for schemes with neither. */
  stickSide?: 'left' | 'right';
  /** Does the LEFT TRIGGER act as an analogue throttle, with the left stick
   *  reduced to steering only?  A separate scheme rather than a toggle
   *  because it changes what a stick deflection MEANS — under `gamepad` the
   *  stick's magnitude is thrust, here it is discarded — and two answers to
   *  that cannot be live at once. */
  triggerThrust?: boolean;
  /** Does the MOVE stick also write the aim — the ship aiming where it flies?
   *  True for both pad schemes that give up the right stick: under
   *  `gamepad-thrust` because a minimal pad may not have one, and under
   *  `gamepad-left` because the user asked for the left stick to carry
   *  direction and thrust together.  When set, the right stick is ignored
   *  rather than allowed to fight for the pointer. */
  stickAims?: boolean;
  /** Is the gun the bottom FACE button rather than the right trigger?  Set
   *  wherever the triggers are doing something else or may not exist. */
  fireFace?: boolean;
}> = {
  touch:            { joystick: false, fireButton: false, mouseDragMoves: true,  touchDragMoves: true,  tapFires: true,  pointerAims: true },
  'joystick-left':  { joystick: true,  fireButton: true,  mouseDragMoves: false, touchDragMoves: false, tapFires: false, pointerAims: false, stickSide: 'left'  },
  'joystick-right': { joystick: true,  fireButton: true,  mouseDragMoves: false, touchDragMoves: false, tapFires: false, pointerAims: false, stickSide: 'right' },
  keyboard:         { joystick: false, fireButton: false, mouseDragMoves: false, touchDragMoves: true,  tapFires: true,  pointerAims: true },
  gamepad:          { joystick: false, fireButton: false, mouseDragMoves: false, touchDragMoves: true,  tapFires: true,  pointerAims: true },
  // Same as `gamepad` in every touch respect — the trigger changes what the
  // LEFT STICK means, not what a finger means, so touch stays exactly alive.
  'gamepad-thrust': { joystick: false, fireButton: false, mouseDragMoves: false, touchDragMoves: true,  tapFires: true,  pointerAims: true, triggerThrust: true, stickAims: true, fireFace: true },
  // Same again: the LEFT stick carries heading, aim and throttle together and
  // the gun sits on the bottom face button, which changes nothing a finger
  // does.
  'gamepad-left':   { joystick: false, fireButton: false, mouseDragMoves: false, touchDragMoves: true,  tapFires: true,  pointerAims: true, stickAims: true, fireFace: true },
};

// ── Minimap material layer (decision #43, gauntlet step 5 G5) ────────────────
// What the minimap says about MATERIAL, as a three-way DBG cycle so the three
// candidates can be judged against each other in motion rather than argued
// about:
//   'flow'  — streamlines sampled from the asteroid flow field: where material
//             MOVES, instead of ten thousand dots saying where it is.
//   'dots'  — one dot per mobile shard.  DEFAULT (user call): in play the
//             question the map is asked is "what is out there", and a dot
//             answers it directly where a streamline answers a question about
//             the field.  Flow stays one step of the cycle away.
//   'off'   — neither.  The control, and the honest answer if the streamlines
//             fail to read at 75px.
// Static TILES are unaffected — they come from the pre-rendered static layer,
// which is the minimap's actual terrain reading.
export const MINIMAP_MATERIAL_MODES = ['flow', 'dots', 'off'] as const;
export type MinimapMaterialMode = typeof MINIMAP_MATERIAL_MODES[number];
let activeMinimapMaterialIndex = MINIMAP_MATERIAL_MODES.indexOf('dots');
export function getActiveMinimapMaterial(): MinimapMaterialMode {
  return MINIMAP_MATERIAL_MODES[activeMinimapMaterialIndex];
}
export function getActiveMinimapMaterialName(): string {
  const m = MINIMAP_MATERIAL_MODES[activeMinimapMaterialIndex];
  return m === 'flow' ? 'Flow' : m === 'dots' ? 'Dots' : 'Off';
}
export function cycleMinimapMaterial(): number {
  activeMinimapMaterialIndex = (activeMinimapMaterialIndex + 1) % MINIMAP_MATERIAL_MODES.length;
  return activeMinimapMaterialIndex;
}

// DBG: gnat (Swarm) movement mode — cycle to feel each behavior side-by-side.
// 'weave' (serpentine dive) is the default; the others are the picked
// alternatives kept for live DBG comparison.  See AISystem.updateSwarm.
export const SWARM_MOVE_MODES = ['boids', 'vortex', 'weave', 'burst'] as const;
export type SwarmMove = typeof SWARM_MOVE_MODES[number];
let activeSwarmMoveIndex = SWARM_MOVE_MODES.indexOf('weave');
export function getActiveSwarmMove(): SwarmMove {
  return SWARM_MOVE_MODES[activeSwarmMoveIndex];
}
export function getActiveSwarmMoveName(): string {
  return SWARM_MOVE_MODES[activeSwarmMoveIndex];
}
export function cycleSwarmMove(): number {
  activeSwarmMoveIndex = (activeSwarmMoveIndex + 1) % SWARM_MOVE_MODES.length;
  return activeSwarmMoveIndex;
}

// (AMMO_CONSTANTS deleted — the ammo system was removed in pivot 1b.)

// ── Drop-type registry ────────────────────────────────────────────────────────
// Single source of truth for per-drop-type properties.  `collectible` marks a
// magnet/proximity PICKUP (salvage / health): kept OUT of the dynamic collision
// grid (projectiles + ships pass through; collection is the GameEngine drop
// scan) and carried by the flow-drift / merge passes.  Non-collectible drops
// (glass) are environmental debris and full physics participants.
//
// To add a future drop type: extend the DropType union (types.ts), add a row
// here, and add its effect (DropSystem.applyDropEffect) + render style
// (RenderSystem drop-shard branch).  The cross-cutting physics/flow/merge sites
// route through `isCollectibleDrop` and need no edits.
export interface DropTypeDef {
  collectible: boolean;
}
export const DROP_TYPES: Record<DropType, DropTypeDef> = {
  health:  { collectible: true },
  salvage: { collectible: true },  // money drop — pays credits on collection
  glass:   { collectible: false },
};
/** True for a magnet/proximity pickup drop (the non-physics, non-shootable
 *  kind).  The cross-cutting test used by the collision-grid skip, the
 *  flow-drift pass, and the same-type merge. */
export function isCollectibleDrop(e: GameEntity): boolean {
  return e.type === EntityType.INTERACTABLE
    && e.dropType !== undefined
    && DROP_TYPES[e.dropType].collectible;
}

// ── Salvage economy ──────────────────────────────────────────────────────────
// Salvage is the money drop (weapons-ammo pivot increment 1a): it replaced
// ammo in every drop source, and collecting it is now the ONLY way to earn
// credits (the awardScore 1:1 score→Salvage mirror is gone).  Drops carry
// value 1 and merge value-conservingly like ammo did; the credit conversion
// happens once at collection.
//
// CREDITS_PER_DROP arithmetic (provisional — pending playtest): expected
// salvage per enemy kill = 0.55 + 0.25 = 0.8 units.  Wave spawn budgets at
// default difficulty run 6/7/8/9 for waves 1-4, so combat income ≈ 4.8 →
// 7.2 units/wave (cumulative ≈ 17 by end of wave 3).  Terrain mining
// (asteroid 45 %, dent shard 85 %, plastic 20 %, nebula 6 %) plus the
// 6-9 destructible shards each kill sprays adds very roughly another
// 50-100 % for a player who mines casually — call it ~25 units collected by
// wave 3.  At 1 000 credits/unit the first weapon (Burst, 25 000) lands
// around wave 2-4, matching the plan target (WEAPONS_AMMO_PLAN §5) without
// touching the gun price ladder.
export const SALVAGE_CONSTANTS = {
  CREDITS_PER_DROP: 1000,     // credits per salvage unit, applied at collection
  // Death penalty (interim, user call): dying forfeits this fraction of the
  // player's UNSPENT Salvage, charged once when the run-summary screen is
  // raised so the summary can report exactly what it cost.  0.25 is
  // PROVISIONAL — big enough that a death stings, small enough that it never
  // wipes a run — and is placeholder for the dynamic system the economy
  // tuning pass (roadmap step 6) will design.  Money already SPENT on modules
  // is untouched: the penalty taxes hoarding, not investment.
  DEATH_PENALTY_FRACTION: 0.25,
  // ...and a FLOOR, so death still costs something at a low balance where a
  // percentage rounds to pocket change.  The charge is
  //   min(balance, max(fraction × balance, MIN))
  // — whichever of the two is higher, but never more than the player has, so
  // it can bring them to zero and never below.  12 500 ≈ 12–13 salvage drops
  // (CREDITS_PER_DROP 1000), i.e. roughly two waves of combat income, and it
  // is the binding term below a 50 000 balance.  PROVISIONAL like the
  // fraction: both are placeholders for the economy tuning pass (step 6).
  DEATH_PENALTY_MIN: 12500,
  DROP_COLOR: '#cbd5e1',      // silver scrap — steel-grey chunk, white glint rim
                              // (deliberately NOT gold: gold "+N" popups mean
                              // score, which no longer pays money)
  // Snitch-catch payout: the snitch pays score but score no longer mints
  // credits, so the catch also sprays this many salvage units (≈ a wave-and-
  // a-half of combat income — it's the biggest chase reward in the game).
  SNITCH_CATCH_DROPS: 8,
  // Wave-clear reward beat (pivot 1c — replaced the free upgrade cards):
  // every wave clear sprays this many salvage units beside the player.
  // Sizing: combat income runs ≈ 4.8-7.2 units/wave (0.8 × budget), so +3
  // is a noticeable ~50% early-wave topper without dwarfing the fighting
  // itself.  The early-clear SPEED bonus stays score-only.
  WAVE_CLEAR_DROPS: 3,
};

// ── Space station POI (economy-pivot increment 1e) ──────────────────────────
// One station sits at the center of the OVERWORLD map — the home of the
// Drydock shop, the loadout swaps (station-only commitment: undocked =
// locked loadout), and hull repair.  It's an EntityType.INTERACTABLE with
// mass ∞ and no dropType: the physics broadphase skips non-drop
// INTERACTABLE pairs entirely, the static grid and the flow-field obstacle
// bake both exclude INTERACTABLEs, and handleAsteroidRespawn already
// avoids POIs — so the station is pure scenery + a dock zone with zero
// collision/flow surprises.  Docking freezes the sim (cardChoicePending-
// style loop short-circuit) and opens the station UI.
export const STATION_CONSTANTS = {
  SIZE: 180,             // world-unit diameter of the station body
  COLOR: '#38bdf8',      // sky — matches the Drydock UI headers; minimap dot + chevron colour
  NAME: 'STATION',
  // Dock proximity — a single O(1) torus-wrapped distance check per sim
  // step (player → fixed point; no scan, no PerfController task needed).
  // The player spawn sits inside this radius so a fresh Overworld run
  // opens with the DOCK affordance visible (discoverability).
  DOCK_RANGE: 260,
  // Placement clearance: map generation drops every entity seeded within
  // this radius of the station so it never spawns buried in a cluster.
  CLEARANCE: 520,
  // Hull repair — pay-per-HP, PRO-RATED (decision: station-poi 1e).
  // 30 salvage/HP ⇒ a full base-hull (100 HP) repair ≈ 3 000 credits,
  // ~half a wave of combat income (CREDITS_PER_DROP arithmetic above) and
  // well under the cheapest weapon (25 000).  If the player can't afford
  // the full repair the button heals what they CAN pay for.
  REPAIR_COST_PER_HP: 30,
};

// ── Station variants + services (module-config increment) ───────────────────
// Space stations carry a SERVICES mix; the docked UI shows only the panels
// the station offers.  EVERY station has (at minimum) DRYDOCK
// functionality — dock anywhere and reconfigure the ship (move modules
// between inventory and hex slots); hull repair rides along as part of
// drydock work.  On top of that baseline, stations add shop sites: the
// current roster is the player's HOME base (drydock only — in the future
// persistent state, created on player creation), a SHIP-systems shop, a
// WEAPON-systems shop, and a TRADE HUB carrying both.  Future variations
// (missions, hangar/ship purchases, other sites to visit) slot in as new
// service flags.
export type StationKind = 'home' | 'shipwright' | 'armory' | 'tradehub';
export interface StationServices {
  drydock: boolean;    // move/install modules (inventory ↔ hex slots) — true everywhere today
  repair: boolean;     // pay-per-HP hull repair (part of drydock work)
  shipShop: boolean;   // sells ship-group modules
  weaponShop: boolean; // sells weapon-group modules
}
export const STATION_VARIANTS: Record<StationKind, { name: string; color: string; services: StationServices }> = {
  home:       { name: 'HOME STATION', color: '#38bdf8', services: { drydock: true, repair: true, shipShop: false, weaponShop: false } },
  shipwright: { name: 'SHIPWRIGHT',   color: '#34d399', services: { drydock: true, repair: true, shipShop: true,  weaponShop: false } },
  armory:     { name: 'ARMORY',       color: '#c084fc', services: { drydock: true, repair: true, shipShop: false, weaponShop: true } },
  tradehub:   { name: 'TRADE HUB',    color: '#fbbf24', services: { drydock: true, repair: true, shipShop: true,  weaponShop: true } },
};
/** Overworld station placement (world units; map is 12k, torus).  The home
 *  station sits at the player-spawn center; the shop stations are spread
 *  well apart so finding each is a flight (chevrons + minimap dots point
 *  the way). */
export const OVERWORLD_STATIONS: readonly { kind: StationKind; x: number; y: number }[] = [
  { kind: 'home',       x: 0,     y: 0 },
  { kind: 'shipwright', x: -3600, y: -2400 },
  { kind: 'armory',     x: 3600,  y: 2400 },
  { kind: 'tradehub',   x: 3800,  y: -2600 },
];

// ── Overworld map (wave-free home map, increment 1e) ────────────────────────
// Population is standard mixed terrain (MAP_POPULATION[OVERWORLD]) plus the
// ambient systems that need no waves: bubbles (automatic fauna), rivals
// (score-cadence warp-ins), and a roaming dragon kept alive by GameEngine:
// the first spawns shortly after the run starts, and a fresh one rifts in
// a while after the previous one dies or leaves.
export const OVERWORLD_CONSTANTS = {
  DRAGON_FIRST_SPAWN_SEC: 25,
  DRAGON_RESPAWN_SEC: 90,
};

// ── Map portals (roadmap step (k)) ─────────────────────────────────────────
// Traversable rifts that connect the wave-free hub to the wave arenas — the
// in-game path that makes a run span earn → outfit → fight (decision #39d).
// A portal is the STATION's entity recipe exactly: INTERACTABLE + mass ∞ +
// no dropType, so the broadphase, the static grid, and the flow-field
// obstacle bake all skip it, while the existing POI paths hand it a minimap
// dot and an off-screen chevron for free.  Destinations are MAP-DESCRIPTOR
// IDS (engine/maps/MapDescriptors.ts), never bare MapType values.
export const PORTAL_CONSTANTS = {
  // Rift SIZE, GRAVITY_STRENGTH and GRAVITY_RANGE below are the values a
  // play-testing pass settled on (user call): a much smaller mouth with a
  // stronger, wider well than the first draft shipped.  They are BAKED here
  // rather than left as a standing DBG multiplier, so `1×` on every knob
  // still means "what ships" and the live readout reports the real numbers.
  SIZE: 70,                 // world-unit diameter of the rift mouth (reads as
                             // a landmark at gameplay zoom, like the station)
  COLOR: '#a855f7',          // violet — the established rift language (dragon/rival warps)
  RETURN_COLOR: '#38bdf8',   // sky — return rifts match the hub/station palette
  // DESCENT rift (boss capstone → next stage).  Its own AMBER reads as neither
  // the violet way-out nor the sky way-home: "deeper".  DESCENT_OFFSET is how
  // far from the fallen boss it opens, so it isn't buried in the wreck debris.
  DESCENT_COLOR: '#f59e0b',
  DESCENT_OFFSET: 190,
  // How far from a rift's mouth the player surfaces when a transition puts
  // them BESIDE it (coming home from an arena arrives at that arena's hub
  // rift, not at the player's base).  Just clear of the mouth — the rift stays
  // on screen and still in USE_RANGE, so turning around is one tap.
  ARRIVAL_OFFSET: 165,
  // Interaction proximity.  Slightly under the station's DOCK_RANGE so that
  // when a portal and a station overlap in range the nearest-wins arbiter
  // has a clear winner rather than a coin flip at the boundary.
  USE_RANGE: 240,
  // Placement clearance: map generation drops entities seeded inside this
  // radius so a portal never spawns buried in a cluster (mirrors the
  // station's CLEARANCE).
  CLEARANCE: 460,
  // Transit VFX — the openPortal() burst fired on departure and arrival.
  // The IDLE rift is pure render-side animation (RenderSystem), so a live
  // portal costs no particles until it's actually used.
  BURST_RADIUS: 320,
  BURST_DURATION: 0.75,
  // ── Wormhole gravity well ─────────────────────────────────────────
  // Portals declare gravityRange/gravityStrength on their entity, so the
  // existing attractor machinery does everything: PhysicsSystem's
  // applyGravity pulls every finite-mass dynamic (shards, enemies, drops,
  // even projectiles curve), the close-attractor crush branch SWALLOWS a
  // mobile shard that reaches the mouth (radius SIZE/2 — it vanishes into
  // the horizon rather than shattering), and RenderSystem's attractor
  // bucket (gravityStrength > 500) feeds the background star lensing.
  //
  // Calibration (velocity units are px per 60 Hz tick; ambient shard drift
  // is ~1): force = STRENGTH / max(distSq, 1e4).  At the range edge the
  // kick is ~0.005/step (a slow drift-in), at 150 px it is ~0.067/step,
  // and the near-mouth clamp region tops out at 0.15/step — a current you
  // notice rather than a hazard you fight, and far below the 5.0 solver cap
  // so nothing gets flung.
  //
  // These are the play-tested values (user call): the well was g6000 out to
  // 1050 and read as far too strong, so it was A/B'd down through the DBG
  // knobs to 0.25× strength and 0.5× range and BAKED here.  The knobs
  // return to 1× accordingly — "1×" has to keep meaning "what ships", or
  // every escape speed and standoff radius derived from these numbers is
  // quietly describing a rift nobody plays.
  GRAVITY_RANGE: 525,
  GRAVITY_STRENGTH: 1500,
  // The PLAYER feels only this fraction of the well (gravityPlayerScale).
  // Entering a portal is a deliberate E/tap, so proximity must never be
  // commitment: at its strongest the tug is 0.4 × 0.12 = 0.048/step,
  // comfortably under the 0.085/step thrust — a felt lean, never a trap.
  GRAVITY_PLAYER_SCALE: 0.12,
  // ── Debris transit (GameEngine.transitionToMap) ───────────────────
  // Everything loose around the player travels WITH them: mobile shards
  // and collectible drops within RADIUS of the ship are captured before
  // the map swap and re-emerge from the exit rift's mouth AFTER the
  // player, staggered over DELAY_MIN..MAX seconds, each flung in a random
  // direction at a random SPEED (px per 60 Hz tick; ambient drift is ~1,
  // so the top of the range reads as an energetic spit).  MAX_ENTITIES
  // caps a transit from the middle of a dense field (nearest win).
  // GRACE_SEC of portal-gravity immunity (portalGraceTimer) lets the
  // ejecta actually LEAVE — without it the well that just spat them out
  // (escape speed ~8 from the mouth) would swallow most of them back.
  // Enemies deliberately do NOT travel: combat leftovers stay behind
  // (decision #39d — a portal clears the fight), and the hub is wave-free
  // by design.
  TRANSIT: {
    RADIUS: 450,
    MAX_ENTITIES: 36,
    DELAY_MIN: 0.25,
    DELAY_MAX: 1.6,
    SPEED_MIN: 1.5,
    SPEED_MAX: 5.5,
    SCATTER: 70,
    GRACE_SEC: 2.5,
    // The PLAYER is EJECTED, not deposited (user call).  Arriving
    // dead-stopped ARRIVAL_OFFSET from the mouth leaves the ship inside the
    // exit rift's own well, which then tugs it straight back toward the hole
    // it just came out of.  Coming out of a wormhole should throw you clear,
    // so the arrival carries an outward velocity sized to LEAVE THE WELL
    // OUTRIGHT rather than merely to look energetic.
    //
    // That speed is SOLVED against the well rather than hand-set beside it
    // (see playerEjectSpeed).  It used to be a literal, and a literal is
    // exactly what goes stale: retuning GRAVITY_STRENGTH/RANGE left the old
    // number climbing a well half again as wide, which still escaped but
    // arrived at the rim with nothing left — so a single knock into terrain
    // on the way out stranded the ship in the throat.  The SPEC is what
    // survives a retune, so the spec is what is written down here.
    //
    // CLEAR_SEC is that spec: the arrival must be outside GRAVITY_RANGE this
    // many seconds after it starts, which is what makes the escape read as
    // decisive rather than as a slow crawl that happens to end outside.
    PLAYER_CLEAR_SEC: 0.75,
    // …and never faster than this fraction of the ship's own cruise, so the
    // shove can never read as a launch however the well is retuned.  At the
    // shipped well the solve lands at ~20.7 px/step against a ~42.5 cruise,
    // comfortably inside the cap; the cap is what catches a future well so
    // deep that leaving it in CLEAR_SEC would mean firing the player out of
    // the arena.
    PLAYER_EJECT_CRUISE_FRAC: 0.8,
  },
  // ── Transit warp (the flight THROUGH the wormhole) ────────────────
  // A short screen-space beat played on ARRIVAL, over the destination map,
  // which is already loaded and waiting behind it.  Sequence: the lens
  // distortion UNROLLS into radial lines, the sky streams outward past the
  // ship as it flies up the throat, then the whole thing decelerates and the
  // arena is revealed.
  //
  // Structurally it is the STAGE-CLEAR freeze reused: the sim is held for the
  // duration (the loop's short-circuit), so nothing shoots the player while
  // they are inside the tunnel and the beat costs no simulation at all.  The
  // animation runs off WALL CLOCK, which is exactly what a frozen sim leaves
  // available, and draws no particles and allocates nothing — it is one veil
  // rect, a few dozen stroked arcs and a batched path of star streaks.
  //
  // A star field is effectively at infinity, so "flying forward" through one
  // is a convention rather than a projection — what sells it is that outer
  // stars sweep fastest and everything accelerates then eases.  Scaling each
  // star's radius gives exactly that (dr = r x dE) while keeping the field
  // recognisably the one already on screen, where a depth model fitted onto
  // real stars bunched them into a solid disc as their wrapped depths
  // converged.
  //
  // The tunnel is drawn as the REAL STAR FIELD streaking outward
  // (BackgroundManager.renderWarpStars) — the same stars, bearings, colours
  // and sizes already on screen.  There are deliberately NO rings or arcs any
  // more (user call): a synthetic ring set drew a tunnel that the sky was not
  // part of, and the streaks alone carry the motion.
  WARP: {
    DURATION: 1.1,
    // How far the sky is swept outward over the beat: every star's distance
    // from the vanishing point is multiplied by 1 -> EXPAND.  At 1 the field
    // is EXACTLY the sky already on screen, which is what makes the opening
    // continuous; by the end it has spread over EXPAND^2 times the area, so
    // the streaks thin out on their own instead of piling into a solid mass.
    // Outer stars therefore move fastest (dr = r x dE) — the perspective cue,
    // without needing a depth model the real star field does not have.
    EXPAND: 7,
    STREAK: 0.26,           // streak length as a fraction of a star's radius
    // FULLY OPAQUE, and there is no dim-in at all (user report: the
    // destination flashed before the beat).  The map swaps synchronously
    // when the transit fires, so anything the veil lets through is the
    // arena this beat exists to reveal — 0.93 let 7% of it through, and a
    // ramp-in let all of it through on the transit's own frame.  The ship
    // and the streaking sky are drawn ABOVE this, so opaque costs nothing
    // that matters: what the player sees mid-tunnel is their own hull and
    // the stars, which is the whole intent.
    VEIL: 1.0,
    VEIL_OUT: 0.38,         // fraction spent revealing the arena
  },
  // ── Too big to swallow (user call) ────────────────────────────────
  // A hole can only eat what fits in its mouth.  An object whose OWN radius
  // reaches SIZE_FRACTION of the horizon does not fall in: it crosses the
  // centre and is FLUNG out along its own heading, the way a collision would
  // throw it — so a boulder ploughs straight through a rift and keeps going,
  // while gravel still disappears down it.
  //
  // Sizing the rule against the HORIZON rather than an absolute number is
  // what makes it read as physics instead of as a threshold: the same rock
  // that shoots through a Pocket rift (horizon 18) is small enough to vanish
  // into Deep Space's (52).  Destination scaling and the DBG Size knob come
  // along for free, because both already move the horizon.
  //
  // SPEED must clear the well outright or the eject is a stutter rather than
  // an exit.  Against the shipped well (g1500 out to 525, clamped at
  // 0.15/step inside 100) escape from a hub mouth costs ~25/v of speed —
  // 0.15 × 85 from the 14.7 horizon out to the clamp, then
  // 1500 × (1/100 − 1/525) beyond it — so the escape speed is ~7.1 px/step.
  // It was ~14.5 against the old, four-times-deeper well, and 20 is kept
  // unchanged through that retune ON PURPOSE: the throw's absolute speed is
  // what the eject FEELS like, and only its margin over escape moved (1.4× →
  // 2.8×).  A weaker well should make a boulder ploughing through look more
  // decisive, not less.  GRACE_SEC of immunity covers the rest: the same
  // trick the transit debris uses, and for the same reason.
  //
  // The PLAYER is deliberately exempt.  Its radius (10) sits near the
  // threshold for a mid-sized rift, so the rule would fire on some
  // destinations and not others; and a ship is the one thing here that
  // enters a portal ON PURPOSE, with its own transit and its own arrival
  // ejection.  Being punted while lining that up would fight the
  // interaction rather than serve it.  Projectiles are exempt too: a shot
  // is not an object being thrown around.
  EJECT: {
    SIZE_FRACTION: 0.55,
    SPEED: 20,
    BOOST: 1.6,       // or this multiple of its own speed, whichever is more
    SPIN: 2.5,        // random tumble added on the way out
    GRACE_SEC: 2.0,
  },
  // ── Steering clear (user call) ────────────────────────────────────
  // Anything that steers ITSELF — enemies, bubbles, dragons, rivals, the
  // snitch, and whatever comes next — gets an outward push near a rift, so
  // nothing with a mind of its own can be captured and parked in the throat.
  //
  // It is ONE rule in ONE place (PhysicsSystem.applyGravity, which already
  // walks every dynamic against every attractor) rather than avoidance code
  // in five different AI routines: the dragon, the rivals, the bubbles and
  // the AISystem strategies all move by different machinery, and a future
  // roamer would have had to remember to add a sixth copy.  `avoidsPortals`
  // (types.ts) overrides the default for anything that is not an ENEMY.
  //
  // The pull is deliberately NOT cancelled — being drawn toward a rift from
  // across the arena is the flavour worth keeping.  The push simply WINS
  // closer in: at 1.4 peak against a pull now clamped at 0.15, the two
  // balance around 236 units out (215 against the old, deeper well — the
  // standoff drifted out slightly when the well was tuned down, and stays
  // comfortably inside RANGE_MIN, so the shape of the rule is unchanged).  So
  // they drift in, then hold off and slide around it, and a determined
  // chaser can still push through toward the player rather than hitting a
  // wall.  RANGE has a floor because a small rift's horizon would otherwise
  // put the standoff inside the pull's own clamp radius.
  AVOID: {
    RANGE_MULT: 5,
    RANGE_MIN: 240,
    ACCEL: 1.4,
  },
  // ── The event horizon (user call) ─────────────────────────────────
  // The rift's WORLD ART is now exactly one thing: a black disc.  Every
  // decoration it used to carry — the bloom, the inspiral arms, the energy
  // ring, the photon ring, the coloured rim, the funnel throat, the white
  // core and the in-range halo — was deleted, because the star LENS is what
  // says "wormhole" and the drawn ornament was competing with it.  What is
  // left is a hole, the lens bending light around it, the destination tag
  // and the off-screen chevron.
  //
  // Its radius READS THE DESTINATION: a rift is a window onto the arena at
  // the other end, so a bigger world shows a bigger mouth.  BASE_FRACTION is
  // of the entity's own half-size at the REFERENCE span, and every
  // destination lands under the old 0.62 disc (the biggest, Deep Space at
  // 16k, comes out ≈0.52) — "smaller than the default, varying up and down
  // from there".
  //
  // Spans in the game today, and what they draw at (entity half-size 100,
  // DBG Size 1×): Pocket 4k → 18, showcase 6k → 25, hub / Ring / Seven
  // Rings 12k → 42, Deep Space 16k → 52.  The EXPONENT is what makes that
  // range legible: raw linear scaling would put Pocket at 14 against Deep
  // Space's 56, which reads as two unrelated objects rather than one kind
  // of thing sized by where it goes.
  HORIZON: {
    BASE_FRACTION: 0.42,
    REFERENCE_SPAN: 12000,   // the hub's span — what every return rift shows
    EXPONENT: 0.75,
    MIN_SCALE: 0.35,
    MAX_SCALE: 1.35,
  },
  // ── Background star lensing (BackgroundManager.renderStars) ───────
  // Screen-space warp around each on-screen attractor: stars inside the
  // lens radius are pushed radially outward (the Einstein-ring evacuation
  // of the throat) and SHEARED around the centre, both easing to zero at
  // the rim on a quadratic falloff so the warp joins the untouched sky
  // with no seam.
  //
  // EVERYTHING HERE IS RELATIVE, so the whole lens is self-similar across
  // destinations and DBG Size steps.  The radius is a multiple of the
  // rift's HORIZON (`portalHorizonRadius`) rather than of its entity size,
  // so the void HUGS the hole (user call) instead of standing off it by a
  // fixed 600 units — and it inherits the destination-span scaling, so a
  // Pocket rift warps a small patch of sky and a Deep Space rift a wide
  // one.  PUSH is likewise a FRACTION of that radius: an absolute pixel
  // push would be a gentle nudge inside the biggest lens and a violent
  // ring inside the smallest.
  //
  // TWIST IS BOUNDED, AND THAT IS THE WHOLE POINT (user report: "multiple
  // bands of stars, each alternating rotational direction going outward",
  // and the DBG Lens knob barely changing them).  The shear used to be
  // `f² × (WIND + elapsed × RATE)` — an angle that GREW WITHOUT BOUND with
  // wall-clock time, which is what a real accretion disk does and exactly
  // what a picture must not: every 2π of accumulated twist is one visible
  // band, so the field wound itself into ~4 bands a minute in and ~10 after
  // three, and scaling a 60-radian twist by 0.25 still left 15 radians —
  // far past 2π, so the knob could not change the band COUNT and appeared
  // to do nothing.  The total shear is now capped below one full turn
  // (TWIST + TWIST_SWING < 2π), which makes banding impossible BY
  // CONSTRUCTION rather than by tuning, and makes the knob linear in the
  // thing the eye actually reads: how bent the sky is.  Motion comes from
  // BREATHING that bounded shear (a sine at SWIRL_RATE) rather than from
  // accumulating it, so the warp still lives without ever winding up.
  LENS: {
    RADIUS_MULT: 4.0,      // × the horizon radius
    PUSH_FRAC: 0.42,       // radial push at the throat, × the lens radius
    TWIST: 0.825,          // radians of shear at the throat (see the clamp below)
    TWIST_SWING: 0.27,     // how much of that shear breathes
    SWIRL_RATE: 0.70,      // breathing rate (rad/s of the sine's phase)
    // The nebula-puff layer takes the same treatment at its own scale —
    // a wider, softer bend, since the puffs are the far backdrop.
    PUFF_RADIUS_MULT: 24.0,
    PUFF_PUSH_FRAC: 0.22,
  },
  // Off-screen indicator range.  A portal is a FIXED landmark, so a chevron
  // for a rift on the far side of the map is noise, not navigation — the
  // arrow only appears once the player is close enough for that rift to be
  // a real option.
  //
  // Inside that range the arrow now behaves like every other contact
  // (decision #46b, gauntlet step 5 G6): it is SUPPRESSED once the rift is
  // on screen, because the rift itself and its own world-space destination
  // tag are already there and a third naming of the same place is the arrow
  // at its least useful.  So the two rules bracket exactly the case the
  // arrow is good for — close enough to matter, not yet visible.  Finding a
  // rift from further out is the MINIMAP's job (its anomaly blip clamps to
  // the border rather than being culled, and G5 cleared the shard-dot wash
  // that used to hide it).
  INDICATOR_RANGE: 1500,
};

/** Hub portal placement (world units; the Overworld is 12k square, torus).
 *  One portal per full-game arena, spread well clear of the four stations
 *  at (0,0) / (-3600,-2400) / (3600,2400) / (3800,-2600) and of each other,
 *  so reaching one is a flight — chevrons + minimap dots point the way.
 *  Showcase maps get NO portal: they stay menu-only. */
export const HUB_PORTAL_SITES: readonly { targetId: string; x: number; y: number }[] = [
  { targetId: 'arena_universe',    x: -3600, y:  2400 },
  { targetId: 'arena_ring',        x:     0, y: -4200 },
  { targetId: 'arena_seven_rings', x:     0, y:  4200 },
  { targetId: 'arena_pocket',      x: -4400, y:     0 },
];

/** TEST PORTALS — a vertical rack beside the home station, one per showcase
 *  map, stepping the whole star-density range in order.
 *
 *  The column is the point: +Y is DOWN, so a portal further down the map leads
 *  to a LOWER-density sky.  Read as descending altitude — the top of the rack
 *  is deep space and the bottom is the closest thing the game has to a planet
 *  approach.  Densities are not repeated here; each target's value lives in
 *  STAR_DENSITY_BY_MAP, and `tests/starfield.spec.ts` asserts the two tables
 *  agree so they cannot drift apart.
 *
 *  Placed at x = +1400: clear of the home station's CLEARANCE (520) and of the
 *  player spawn, and spaced 600 apart so only one is ever inside USE_RANGE. */
export const HUB_TEST_PORTAL_SITES: readonly { targetId: string; x: number; y: number }[] = [
  { targetId: 'field_asteroid', x: 1400, y: -1500 },   // densest sky
  { targetId: 'field_glass',    x: 1400, y:  -900 },
  { targetId: 'field_metal',    x: 1400, y:  -300 },
  { targetId: 'field_plastic',  x: 1400, y:   300 },
  { targetId: 'field_rock',     x: 1400, y:   900 },
  { targetId: 'field_nebula',   x: 1400, y:  1500 },   // sparsest sky
];

/** Where an arena's return portal sits relative to that map's playerSpawn.
 *  Close enough to be visible from the arrival point (the way home is never
 *  a search) and INSIDE the 350-unit spawn safe zone the arena maps already
 *  clear, so no extra terrain filtering is needed — yet outside USE_RANGE,
 *  so arriving in an arena never puts the player straight back on the exit. */
export const RETURN_PORTAL_OFFSET = { x: 0, y: -300 };

export const DROP_CONFIG = {
  // Salvage-spawn probabilities — carried over 1:1 from the old ammo-roll
  // chances (WEAPONS_AMMO_PLAN §4: reuse today's rates as the starting
  // point).  Every salvage drop carries value 1; there is no per-source
  // amount anymore.
  SALVAGE_DROP_CHANCE_ASTEROID:        0.45, // 45 % chance an asteroid drops salvage
  SALVAGE_DROP_CHANCE_DENT_SHARD:      0.85, // dent shards take several hits — higher reward
  // Plastic-shards may break into a small number of sub-shards (each
  // a drop opportunity), so their per-shard drop chance is cut well
  // below the generic dent-shard rate.
  SALVAGE_DROP_CHANCE_PLASTIC_SHARD:   0.20,
  SALVAGE_DROP_CHANCE_ENEMY_PRIMARY:   0.55, // primary enemy salvage roll
  SALVAGE_DROP_CHANCE_ENEMY_SECONDARY: 0.25, // secondary roll (independent)
  // Health
  HEALTH_HEAL_AMOUNT:        100,   // HP restored per milestone (wave-clear) health drop
  // Enemy-kill health drops (added because the expanded roster hits harder).
  // Rolled INDEPENDENTLY at the same two chances as the salvage slots above, so
  // enemy-kill pickups roughly double and split ~50/50 salvage/health.  Each heals
  // this much (merges sum, like salvage) — modest so frequent drops sustain rather
  // than trivialise.
  HEALTH_PER_ENEMY:           15,
  // General
  COLLECT_RADIUS:             30,   // world units
  MAGNET_RANGE:              150,   // world units — a drop only starts pulling
                                    // once the player is this close.  Once it
                                    // latches it homes to completion (see
                                    // `magnetized`), even if the player leaves.
  MAGNET_SPEED:                6,   // world-units/step pull toward the player.
                                    // Eased to `dist` within this radius so a
                                    // drop lands on the player instead of
                                    // overshooting.
  LIFETIME:                20.0, // seconds before drop despawns
  MAX_ACTIVE_DROPS:       100,   // hard cap
};

// ── Drop ↔ drop pull ───────────────────────────────────────────────
// Mutual gravity between non-magnetised same-type collectible drops
// (salvage / health), applied inside DropSystem.mergeDrops on the same
// O(N²) pair walk that consolidates touching drops.  Pairs already in
// contact merge as before; pairs in (sumR, RANGE] receive a small
// 1/dist velocity nudge toward each other so a cluster from a wave
// kill converges and merges over a fraction of a second instead of
// sitting put waiting for the player.  Magnetised drops (already
// homing on the player) skip the pull so the magnet path keeps a
// clean trajectory.
export const DROP_PULL = {
  /** Centre-to-centre distance above which the pull turns off.
   *  Inside the player magnet range (DROP_CONFIG.MAGNET_RANGE) so
   *  the player still has the final say on collection cadence. */
  RANGE: 120,
  /** Per-substep velocity nudge magnitude toward the partner.
   *  Multiplied by 1/dist so distant pairs get a softer pull and
   *  close pairs converge faster.  At FIXED_DT 1/120 a constant
   *  STRENGTH 0.08 means ~9.6 units/s of velocity accumulation
   *  when the pair holds at 1 unit apart — strong, but capped
   *  naturally by the merge contact distance. */
  STRENGTH: 0.08,
  /** Per-substep velocity multiplier applied to both drops in the
   *  pull band (before the pull itself adds new velocity).  0.97
   *  per step at FIXED_DT 1/120 retains ~2.5 % per second — heavy
   *  damping that kills tangential drift before it forms orbits.
   *  Without this, the pull purely ADDS velocity each step and a
   *  pair with even slight perpendicular motion settles into a
   *  stable orbit that never quite contacts; with it, drops spiral
   *  cleanly into each other and merge calmly. */
  DAMP_PER_STEP: 0.97,
} as const;

/**
 * Compute the 2-slot loadout-HUD layout for a given screen size.
 *
 * Two wide slots, centered in the space right of the minimap:
 *   [SLOT 1] ⎢SLOT_GAP⎥ [SLOT 2]
 *
 * Returns the per-slot x positions so the renderer and the tap hit-test
 * (GameEngine fire-event routing) share one geometry source.
 */
/**
 * The minimap's screen rect — ONE definition of the bottom-left corner
 * (gauntlet 5d, U3; audit findings E1/E2).
 *
 * Four places computed this independently: the renderer that draws it, the
 * fire-event handler that catches the expand tap, the joystick exclusion zone
 * that must refuse it, and the wave banner that has to clear it.  The banner
 * got it WRONG — it reserved `MINIMAP_CONSTANTS.SIZE` (75px, the COLLAPSED
 * height) unconditionally, so with the map open the banner drew inside the
 * 280px expanded one.  Two of the other three used `MARGIN` for the left
 * offset and `LOADOUT_HUD_CONSTANTS.BOTTOM_MARGIN` for the bottom, which is
 * why "one corner, three margins" was a finding rather than a nitpick.
 *
 * Every caller now asks here, and the EXPANDED flag is a parameter rather
 * than an assumption.
 */
export function computeMinimapRect(screenHeight: number, expanded: boolean): {
  x: number; y: number; size: number;
} {
  const { SIZE, EXPANDED_SIZE, MARGIN } = MINIMAP_CONSTANTS;
  const size = expanded ? EXPANDED_SIZE : SIZE;
  return {
    x: MARGIN,
    y: screenHeight - size - LOADOUT_HUD_CONSTANTS.BOTTOM_MARGIN,
    size,
  };
}

/**
 * The OFF-SCREEN INDICATOR rect — the inset viewport rect the edge arrows
 * ride (user call: "the chevrons hide behind the HUD").
 *
 * It used to be a symmetric inset of `EDGE_INSET` on all four sides, derived
 * inline from the screen half-extents.  That put the top edge of the rect at
 * y=26 — underneath the readout chip stack — and the bottom edge under the
 * loadout strip and the minimap.  An arrow at a near-vertical bearing
 * therefore drew BEHIND the HUD, and a near-vertical bearing is exactly
 * "directly ahead of you" and "directly behind you".
 *
 * So the rect is asymmetric now: the two HUD bands are reserved, and the
 * arrows ride the largest rect that clears them.  Pure and exported for the
 * same reason `computeMinimapRect` is (5d U4): it is wrong in a way nothing
 * reports — an arrow under a chip throws no error and logs nothing.
 */
export function computeIndicatorRect(
  screenWidth: number,
  screenHeight: number,
  bossBar: boolean = false,
): { left: number; right: number; top: number; bottom: number } {
  const {
    EDGE_INSET, TOP_INSET, BOSS_BAR_INSET, BOTTOM_INSET, MIN_BAND,
    NARROW_WIDTH, WRAP_INSET,
  } = UI_CONSTANTS.INDICATORS;
  const left  = Math.min(EDGE_INSET, Math.max(0, screenWidth  * 0.5 - 8));
  const right = screenWidth - left;
  // The boss bar is the one part of the top band that comes and goes, and it
  // is the tallest.  Reserving its height permanently would cost every
  // ordinary fight ~60px of play area for a widget that is not on screen, so
  // the band grows while it is up instead — and likewise narrows back when
  // the readout row is wide enough not to wrap.
  let top     = EDGE_INSET + TOP_INSET
              + (bossBar ? BOSS_BAR_INSET : 0)
              + (screenWidth < NARROW_WIDTH ? WRAP_INSET : 0);
  let bottom  = screenHeight - EDGE_INSET - BOTTOM_INSET;
  // A short window (a landscape phone) would otherwise have the two bands
  // meet or cross.  The bands give way rather than the arrows vanishing.
  if (bottom - top < MIN_BAND) {
    const mid = screenHeight * 0.5;
    top    = Math.max(0, mid - MIN_BAND * 0.5);
    bottom = Math.min(screenHeight, mid + MIN_BAND * 0.5);
  }
  return { left, right, top, bottom };
}

export function computeLoadoutHUDLayout(screenWidth: number, screenHeight: number): {
  startY: number;
  slotW: number;
  slotXs: [number, number];
} {
  const { SLOT_W_MAX, SLOT_W_MIN, SLOT_H, SLOT_GAP, BOTTOM_MARGIN } = LOADOUT_HUD_CONSTANTS;
  const { MARGIN: MM, SIZE: MS } = MINIMAP_CONSTANTS;

  // Horizontal: start just right of the minimap, leave symmetric margin on the right
  const leftClear   = MM + MS + SLOT_GAP * 2;   // minimap right edge + small gap
  const rightEdge   = screenWidth - MM;
  const availableW  = rightEdge - leftClear;

  const slotW  = Math.max(SLOT_W_MIN, Math.min(SLOT_W_MAX, Math.floor((availableW - SLOT_GAP) / 2)));
  const totalW = slotW * 2 + SLOT_GAP;
  const startX = leftClear + Math.max(0, (availableW - totalW) / 2);
  const startY = screenHeight - SLOT_H - BOTTOM_MARGIN;

  return { startY, slotW, slotXs: [startX, startX + slotW + SLOT_GAP] };
}

// Difficulty (enemy count multiplier) 0 = none, 3 = full
export const DIFFICULTY_SCALES: Record<number, number> = {
  0: 0,    // No enemies
  1: 0.35, // Low
  2: 0.65, // Moderate
  3: 1     // High (current default)
};

// Health drop wave interval per difficulty — spawn one health drop every N waves.
// Lower values = more frequent healing.  Add new keys here when adding difficulty levels.
export const HEALTH_DROP_INTERVAL: Record<number, number> = {
  0: 10,   // No enemies — same as easy (health drops still spawn for asteroid damage)
  1: 10,   // Easy — every 10 waves
  2: 15,   // Medium — every 15 waves
  3: 20,   // Hard — every 20 waves
};

// Difficulty stat multipliers — scale individual enemy health, speed, damage
export const DIFFICULTY_STAT_SCALES: Record<number, { health: number; speed: number; damage: number }> = {
  0: { health: 1.0,  speed: 1.0, damage: 1.0 }, // N/A (no enemies)
  1: { health: 0.7,  speed: 0.8, damage: 0.7 }, // Low — weaker, slower, softer
  2: { health: 0.85, speed: 0.9, damage: 0.85 }, // Moderate
  3: { health: 1.0,  speed: 1.0, damage: 1.0 }, // Full difficulty
};

// ── Enemy scaling (per-wave) ──────────────────────────────────────────────────
// On top of the per-difficulty multipliers, enemies scale with the wave number
// so the run stays honest as the player upgrades.  Tuned for a COMFORTABLE
// lead: growth is gentle (the player out-scales faster), and both terms cap.
//   Final enemy HP  = baseTierHP × difficulty.health × enemyHpMult(waveIndex)
//   Final enemy dmg = baseAttackDmg × difficulty.damage × enemyDamageMult(idx)
// waveIndex is 0-based, so wave 1 (index 0) → ×1.0 (no scaling).
export const ENEMY_SCALING = {
  HP_GROWTH_PER_WAVE: 0.06,  // +6% enemy HP per wave …
  HP_MULT_CAP: 2.5,          // … capped at 2.5×
  DMG_GROWTH_PER_WAVE: 0.04, // +4% enemy damage per wave …
  DMG_MULT_CAP: 2.0,         // … capped at 2.0×
};
// DBG global multiplier on the per-wave growth (Player ▸ "Enemy scale"):
// 0 = no wave scaling, 1 = tuned, 2 = double growth.  Feel the margin live.
export const ENEMY_SCALE_CYCLE: ReadonlyArray<number> = [1, 0, 0.5, 1.5, 2] as const;
let activeEnemyScaleIndex = 0; // 1×
export function getActiveEnemyScaleMult(): number { return ENEMY_SCALE_CYCLE[activeEnemyScaleIndex]; }
export function getActiveEnemyScaleName(): string { return `${ENEMY_SCALE_CYCLE[activeEnemyScaleIndex]}×`; }
export function cycleEnemyScale(): number {
  activeEnemyScaleIndex = (activeEnemyScaleIndex + 1) % ENEMY_SCALE_CYCLE.length;
  return activeEnemyScaleIndex;
}
export function enemyHpMult(waveIndex: number): number {
  return Math.min(ENEMY_SCALING.HP_MULT_CAP,
    1 + ENEMY_SCALING.HP_GROWTH_PER_WAVE * Math.max(0, waveIndex) * getActiveEnemyScaleMult());
}
export function enemyDamageMult(waveIndex: number): number {
  return Math.min(ENEMY_SCALING.DMG_MULT_CAP,
    1 + ENEMY_SCALING.DMG_GROWTH_PER_WAVE * Math.max(0, waveIndex) * getActiveEnemyScaleMult());
}

// Visual hit-reaction magnitude (0..1): a hit's damage as a fraction of the
// target's max-health pool, used by RenderSystem to scale the sprite's
// scale-punch.  Frail enemies take big-%% hits and snap hard; tanky beasts
// (dragon ~500 HP, bubble 50+) chip-flinch.  One abstraction so every present
// and future enemy reacts in proportion to how much it just lost.
export function hitReactStrength(damage: number, maxHealth: number): number {
  if (!(damage > 0) || !(maxHealth > 0)) return 0;
  return Math.min(1, damage / maxHealth);
}

/**
 * Stamp the two VISUAL hit timers together (gauntlet 5d, U5).
 *
 * `hitFlash` is the ~0.1–0.3s whiten-and-scale-punch each damage site already
 * set for itself; `healthBarTimer` is the much longer window the world-space
 * health bar is visible for.  They are separate fields — a bar that lived as
 * long as a flash would strobe rather than inform — but they are stamped by
 * the same event, so folding them into one call is what stops the two from
 * drifting apart as damage paths are added.  Each site keeps its OWN flash
 * duration, because those were tuned per impact type.
 *
 * Purely presentational: nothing in the sim reads either field, so this is
 * safe to call from any damage path without touching behaviour.  Takes a
 * loosely-typed entity so `constants.ts` stays free of a `types.ts` import.
 */
export function markDamaged(
  entity: { hitFlash?: number; healthBarTimer?: number },
  flash: number,
) {
  entity.hitFlash = flash;
  entity.healthBarTimer = UI_CONSTANTS.HEALTH_BAR.SHOW_DURATION;
}

/**
 * Arm the bar window for a hit the SHIELD ate (gauntlet 5d, U5).
 *
 * A shot fully absorbed by a shield costs no health, so it never reached
 * `markDamaged` — and the bar is where the shield STRIP lives, so without
 * this a player could never watch a shield drain: the readout would only
 * appear once the shield had already failed and the hull was taking hits.
 * That is precisely backwards, and it is what the U5 suite caught.
 *
 * No `hitFlash`: the hull did not take the hit, and the shield has its own
 * `shieldHitFlash`. Only the bar's visibility window is armed.
 */
export function markShieldDamaged(entity: { healthBarTimer?: number }) {
  entity.healthBarTimer = UI_CONSTANTS.HEALTH_BAR.SHOW_DURATION;
}

// ── Enemy variant configs ─────────────────────────────────────────────────────
// Two roles: RAMMING (charge into player) and SHOOTING (keep distance, fire).
// Three tiers per role — each tier is strictly faster/tougher than the last.
// To add a new enemy type: add entries to EnemySubtype, EnemyRole, ENEMY_ROLE,
// and ENEMY_VARIANTS, then reference the new subtype in WAVE_DEFINITIONS.

// Enemy archetype table.  EVERY enemy is now a shooter (`shoots`); variety
// comes from the movement role (RAMMING = rush in close, SHOOTING = keep
// distance & strafe), the per-archetype `weapon` override on ENEMY_WEAPON,
// `contactDamage` (rushers hurt on touch; ranged keep 0), and defenses
// (ENEMY_TRAITS armor / ENEMY_ATTACK_EFFECTS corrosion).
export const ENEMY_VARIANTS: Record<EnemySubtype, {
  color: string; size: number; health: number;
  maxSpeed: number; accel: number; turnRate: number;
  sprite: string; mass: number; shape: EnemyShape;
  shoots: boolean; contactDamage: number; diesOnContact?: boolean; weapon?: Partial<WeaponConfig>;
  // Optional burst pattern: fire `size` shots `gap` seconds apart, then
  // reload for the archetype weapon's full `cooldown`.  Absent → one shot
  // per `cooldown` (the common case).  The per-archetype `cooldown` is the
  // real fire cadence (the old global burst override is gone), so each
  // enemy's rhythm is its own.
  burst?: { size: number; gap: number };
  // Optional attack telegraph: seconds before a shot lands during which the
  // enemy visibly winds up (muzzle charge glow + forward aim line, scaled by
  // a 0→1 `aimCharge` WeaponSystem sets).  Reserved for the slow / heavy
  // shooters whose shots are worth dodging — Tank, Sniper, Charger.  Must be
  // ≤ the weapon `cooldown` (it only shows in the final lead-up).  Absent →
  // no tell (fast peashooters stay snappy and unpredictable).
  telegraph?: number;
  // Sniper-only: draw a full-length lock-on laser to the player during the
  // telegraph (vs the plain muzzle-charge tell), and hold still while locked
  // (AISystem brakes to a stop) so it reads as a deliberate camping shooter
  // rather than a continuous strafing stream.
  aimLaser?: boolean;
  // Kamikaze self-destruct payload (Stage 0).  When set, the enemy stamps
  // explosionRadius/Damage/Knockback at spawn; on first contact with the
  // player it deals `contactDamage` and detonates an AoE shockwave instantly
  // at the contact point (GameEngine.handleEntityDeath via detonateOnDeath).
  detonate?: { radius: number; damage: number; knockback: number };
  // Defensive shield (Stage 0, Bulwark).  `shield` seeds both shield and
  // maxShield at spawn; `shieldRegen` is the per-second recharge (slow, so the
  // shield is a soft barrier the player burns through, not an invuln).  When
  // `shieldArc` is set the shield is a directional sector (covering
  // `shieldArc.deg` degrees) that ATTEMPTS to track the player — AISystem
  // slews `shieldArcAngle` toward the player bearing at up to `shieldArc.slew`
  // rad/s, so out-maneuvering the slew (flanking fast) exposes the hull.  Only
  // hits from the covered side are absorbed.  Absent → a full bubble.  The
  // generalized PhysicsSystem absorption path applies the arc gate; recharge
  // is shared with the player tick.
  shield?: number;
  shieldRegen?: number;
  shieldArc?: { deg: number; slew: number };
  // Nest spawner (Stage 4): periodically births `batch` `subtype` brood every
  // `interval` seconds, up to `maxBrood` live brood (a hard cap on the
  // self-replicating population).  Brood are spawned at the nest and DON'T gate
  // wave completion (Stage 2b countsTowardWave=false).  A boss PHASE stamps the
  // same shape per-entity (GameEntity.spawner) to raise / drop escorts.
  spawner?: SpawnerConfig;
  // Preferred stand-off distance for the 'skirmisher' movement strategy,
  // overriding the shared AI_CONFIG.SKIRMISHER.PREFERRED_DIST.  This is what
  // gives an archetype its own RANGE BAND (the (h) siege boss stands well back
  // and lobs; the rank-and-file keep the shared default).  Absent → the shared
  // constant.  No effect on non-skirmisher strategies.
  preferredDistance?: number;
  // Stagger resistance ((h)): a heavy hull ignores the per-hit stun below
  // `stunDamage` and takes `knockScale`× the normal knockback impulse, so chip
  // fire can't lock it up or shove it around.  Absent → full kick, always stun.
  poise?: PoiseConfig;
  // Consume-and-grow (Stage 3b/5): stamped onto the entity at spawn so
  // GameEngine.updateConsumers feeds the bubble nearby shards.  Absent → not a
  // consumer.
  consume?: ConsumeConfig;
  // Self-replication (Stage 5, bubble): an UNprovoked consumer that has grown
  // to `atSize` splits — it resets to base size and births one offspring (so
  // eat→grow→split is a cycle), capped at `maxPopulation` live units of the
  // subtype.  Offspring don't gate wave completion.  Absent → never multiplies.
  multiply?: { atSize: number; maxPopulation: number };
  // Ambient fauna (Stage 5, bubble): NOT a wave enemy.  An `ambient` archetype
  // never gates wave completion (countsTowardWave forced false at spawn however
  // it's built) and is kept present in the world by GameEngine.maintainAmbient-
  // Bubbles instead of the wave spawner.  Absent → a normal wave enemy.
  ambient?: boolean;
  // Third party / neutral (Stage 5, bubble): stamped onto the entity so enemy
  // fire can damage it (friendly-fire filter bypassed) and it retaliates
  // against whoever attacks it — player OR enemy.  Absent → a normal enemy that
  // only fights the player and ignores enemy fire.
  thirdParty?: boolean;
}> = {
  // ── Rushers — close in and fire (rose → orange → amber) ──
  // Drone: a frantic peashooter — tiny, fast, weak rose pellets while it
  // dives at you.  High rate of fire, trivial per-shot damage.
  [EnemySubtype.RAMMER_1]: {
    color: '#ef4444', size: 28, health: 1,
    maxSpeed: 5,   accel: 3.5, turnRate: 2.8,
    sprite: ASSETS.ENEMY_DRONE,    mass: 10, shape: 'circle',
    shoots: true, contactDamage: 8,
    weapon: { cooldown: 0.7, damage: 5, speed: 9, size: 4, color: '#fb7185' },
  },
  // Charger: a strafing twin-cannon — fires a 2-shot orange fan on a longer
  // beat as it lines up a dash.
  [EnemySubtype.RAMMER_2]: {
    color: '#f97316', size: 28, health: 2,
    maxSpeed: 8,   accel: 5.5, turnRate: 3.2,
    sprite: ASSETS.ENEMY_CHARGER,  mass: 8, shape: 'arrow',
    shoots: true, contactDamage: 10,
    weapon: { cooldown: 1.15, damage: 7, speed: 9, size: 5, count: 2, spread: 14, color: '#fb923c' },
    telegraph: 0.3,
  },
  // Tank: a heavy siege slug — slow, big, solid amber shell that hits hard
  // (no glow: it reads as a dense slug, not a plasma ball, and its impact is
  // sold by the damage-scaled player shake/knockback, not brightness).  The
  // armor trait + this lumbering cannon make it the "bring the right tool" enemy.
  [EnemySubtype.RAMMER_3]: {
    color: '#facc15', size: 32, health: 5,
    maxSpeed: 4.5, accel: 3,   turnRate: 1.6,
    sprite: ASSETS.ENEMY_TANK,     mass: 18, shape: 'hexagon',
    shoots: true, contactDamage: 14,
    weapon: { cooldown: 2.2, damage: 16, speed: 7, size: 10, color: '#fde047' },
    telegraph: 0.9,
  },
  // ── Skirmishers — keep distance and fire (green → acid → blue) ──
  // Skirmisher: the baseline kiter — steady, single green bolts on a calm beat.
  [EnemySubtype.SHOOTER_1]: {
    color: '#4ade80', size: 28, health: 1,
    maxSpeed: 4,   accel: 2.5, turnRate: 1.3,
    sprite: ASSETS.ENEMY_SKIRMISHER, mass: 12, shape: 'diamond',
    shoots: true, contactDamage: 0,
    weapon: { cooldown: 1.1, damage: 6, speed: 9, size: 5, color: '#4ade80' },
  },
  // Orbiter: an acid spitter — a glowing double-tap of corrosive rounds
  // (colour forced to acid-green by the ENEMY_ATTACK_EFFECTS path) on a
  // burst rhythm.  Low impact, nasty DoT.
  [EnemySubtype.SHOOTER_2]: {
    color: '#22d3ee', size: 28, health: 2,
    maxSpeed: 5.5, accel: 3,   turnRate: 1.2,
    sprite: ASSETS.ENEMY_ORBITER,  mass: 10, shape: 'pentagon',
    shoots: true, contactDamage: 0,
    weapon: { cooldown: 1.5, damage: 5, speed: 8, size: 6, glow: true },
    burst: { size: 2, gap: 0.18 },
  },
  // Sniper: a camping railgun — mostly stationary, holds still and snaps a
  // lock-on laser onto the player, then fires one thin, very fast, bright-blue
  // high-damage tracer.  Slow to reposition (low maxSpeed) and slow to fire
  // (long cooldown) so each shot is a deliberate, dodgeable event, not a
  // stream.  Punishing if you stand in the laser.
  [EnemySubtype.SHOOTER_3]: {
    color: '#3b82f6', size: 26, health: 3,
    maxSpeed: 4,   accel: 3,   turnRate: 1.8,
    sprite: ASSETS.ENEMY_SNIPER,   mass: 9, shape: 'chevron',
    shoots: true, contactDamage: 0,
    weapon: { cooldown: 2.8, damage: 15, speed: 16, size: 4, color: '#60a5fa', glow: true },
    telegraph: 0.75, aimLaser: true,
  },
  // ── Core-roster additions (Stage 0) ──
  // Kamikaze: a frail magenta star that screams in on a hard, fast dive and
  // self-destructs on contact — a modest contact bite plus a detonation AoE.
  // Low HP + a readable pre-detonation tell make it a kill-early-or-peel-away
  // threat: pop it before it reaches you, or boost clear of the blast.  Does
  // not shoot.
  [EnemySubtype.KAMIKAZE]: {
    color: '#e879f9', size: 26, health: 2,
    maxSpeed: 9, accel: 7, turnRate: 4.0,
    sprite: ASSETS.ENEMY_DRONE, mass: 7, shape: 'star',
    shoots: false, contactDamage: 10,
    detonate: { radius: 170, damage: 34, knockback: 1.5 },
  },
  // Bulwark: a slow violet octagon fortress behind a regenerating shield,
  // lobbing a 3-shot fan.  The shield soaks chip fire and recharges, so it
  // demands burst-through / flanking — a soft counter, not a hard wall.
  [EnemySubtype.BULWARK]: {
    color: '#a78bfa', size: 34, health: 4,
    maxSpeed: 3.5, accel: 2.2, turnRate: 1.1,
    sprite: ASSETS.ENEMY_TANK, mass: 16, shape: 'octagon',
    shoots: true, contactDamage: 0,
    weapon: { cooldown: 1.8, damage: 3.5, speed: 8, size: 5, count: 3, spread: 22, color: '#c4b5fd' },
    shield: 54, shieldRegen: 4, shieldArc: { deg: 150, slew: 2.8 },
    telegraph: 0.5,
  },
  // ── Stage 1 ──
  // Turret: a stationary steel emplacement (maxSpeed 0 → AISystem no-move
  // branch) that rotates to track the player and lobs SLOW HOMING missiles on
  // a long, telegraphed beat.  It can't chase, so it's a position-denial /
  // priority-target threat: dodge the missiles by juking (their turn rate is
  // gentle) or close in and destroy it.  Tanky + heavy so it reads as fixed.
  [EnemySubtype.TURRET]: {
    color: '#94a3b8', size: 36, health: 8,
    maxSpeed: 0, accel: 0, turnRate: 1.8,
    sprite: ASSETS.ENEMY_TANK, mass: 50, shape: 'cross',
    shoots: true, contactDamage: 0,
    weapon: { cooldown: 2.6, damage: 12, speed: 5, size: 7, color: '#fb7185',
              homing: true, homingStrength: 0.5, glow: true },
    telegraph: 0.7,
  },
  // ── Stage 4 ──
  // Swarm: a cheap, weak, fast gnat (1 HP, tiny) that flocks toward the player
  // with a light boids tick ('swarm' behavior — seek + separation + jitter), so
  // a pack reads as a darting cloud rather than a clean line.  Low contact bite;
  // the threat is numbers.  RAMMING role (rush in).
  [EnemySubtype.SWARM]: {
    color: '#2dd4bf', size: 16, health: 1,
    maxSpeed: 7.5, accel: 7, turnRate: 4.5,
    sprite: ASSETS.ENEMY_DRONE, mass: 4, shape: 'triangle',
    shoots: false, contactDamage: 3, diesOnContact: true,
  },
  // Nest: a near-static fleshy hive (high HP, heavy, maxSpeed 0 → no-move
  // branch; doesn't shoot) that periodically births SWARM brood until killed.
  // A priority target — clear the nest to stop the bleeding.  Its brood don't
  // gate wave completion (Stage 2b); killing the nest just stops new ones.
  [EnemySubtype.NEST]: {
    color: '#0d9488', size: 46, health: 14,
    maxSpeed: 0, accel: 0, turnRate: 0.6,
    sprite: ASSETS.ENEMY_TANK, mass: 60, shape: 'nest',
    shoots: false, contactDamage: 0,
    spawner: { subtype: EnemySubtype.SWARM, interval: 4.0, batch: 2, maxBrood: 10 },
  },
  // ── Stage 5 ──
  // Bubble: a translucent soft-body blob.  PASSIVE by default — it drifts
  // lazily, eats nearby mobile shards to grow (`consume`), and once fat enough
  // SPLITS in two (`multiply`), so an ignored field of them quietly breeds.  It
  // takes no notice of the player until SHOT: a hit sets `provoked` (Stage 3a),
  // and from then on it homes in, latches onto the player on contact (Stage 3c
  // attach), and EMPs weapon + shield ('disable' status) for a few seconds
  // before releasing and popping.  Fragile (low HP) so you can shoot it off —
  // but provoking the field stops the breeding and turns it on you.  RAMMING
  // role (rush when provoked).  Cyan-violet membrane; no engine flame.
  [EnemySubtype.BUBBLE]: {
    color: '#67e8f9', size: 15, health: 50, // maxHealth then scales LINEARLY
                                            // with size as it grows (updateBubbles.syncBubbleMaxHealth)
    maxSpeed: 3.4, accel: 3.0, turnRate: 1.6,
    sprite: ASSETS.ENEMY_DRONE, mass: 9, shape: 'bubble',
    shoots: false, contactDamage: 0,
    // growthPerEat / hpPerEat / the digest time are all SCALED per-eat by the
    // shard's richness (mass/energy conserved — see shardRichness): denser/
    // stronger shards take longer to digest and give more growth + health.
    consume: { eats: 'shard', range: 150, growthPerEat: 3, maxSize: 58, hpPerEat: 2, pull: 14 },
    multiply: { atSize: 50, maxPopulation: 14 },
    ambient: true, thirdParty: true,
  },
  // ── Stage 6 ──
  // Dragon: a big segmented serpent mini-boss.  Enters via a portal, rides the
  // flow field weaving across the map and DEVOURS tiles (consume eats:'tile' →
  // consumeTile) to grow longer + thicker, deals contact damage along its body,
  // and leaves via portal if not killed.  Engine-managed (GameEngine.update-
  // Dragon); the 'dragon' AI strategy is a no-op.  Tanky combat HP on the head.
  [EnemySubtype.DRAGON]: {
    color: '#34d399', size: 64, health: 500, // big boss HP (> the bubble's max)
    maxSpeed: 6, accel: 4, turnRate: 1.2,
    sprite: ASSETS.ENEMY_TANK, mass: 500, shape: 'dragon', // heavy: barely shoved
    shoots: false, contactDamage: 16,
    consume: { eats: 'tile', range: 90, growthPerEat: 4, maxSize: 150 },
  },
  // ── (h) Bosses ──
  // Warden (BOSS_WARDEN): the CHASSIS boss — the plain capstone that proves the
  // framework needs no new mechanics.  A huge, heavy bastion prow that holds
  // mid-range and lobs slow, heavy siege bolts on a readable telegraph.  Its
  // defence is layered rather than novel: a full barrier shield in phase 1
  // (the generalized absorption path), ARMOR underneath it (the trait shipped
  // with the Tank), and POISE so a stream of chip fire can neither stagger it
  // nor push it off its line.  Phase 2 blows the barrier AND the plating off
  // and calls a swarm escort — a pure damage race.  SHOOTING role: it keeps
  // its distance and makes you come to it.
  [EnemySubtype.BOSS_WARDEN]: {
    color: '#38bdf8', size: 82, health: 120, // PROVISIONAL — see BOSS_CONSTANTS
    maxSpeed: 3.2, accel: 2.0, turnRate: 1.0,
    sprite: ASSETS.ENEMY_TANK, mass: 140, shape: 'warden',
    shoots: true, contactDamage: 18,
    weapon: { cooldown: 2.0, damage: 14, speed: 8, size: 12, color: '#7dd3fc', glow: true },
    telegraph: 0.8,
    poise: { stunDamage: 12, knockScale: 0.12 },
  },
  // Reaver (BOSS_SCATTER): the first WEAPON-boss.  A fast, forward-raked
  // twin-prong brawler that wields a THEMED VARIANT OF THE PLAYER'S OWN
  // SHOTGUN (BOSS_WEAPONS.SCATTER — same yellow pellet cone, enemy-tuned
  // numbers), so the read is "that's MY shotgun" (WEAPONS_AMMO_PLAN §6).
  // Its counterplay identity is the EVASIVE trait: it side-steps straight
  // shots, so the Seeker (homing) is the designated answer while cones and
  // chains still land.  RAMMING role — it closes to scattergun range and
  // brawls, the opposite range band to the Warden.  Lighter poise than the
  // Warden: it is a duellist, not a fortress, so a real hit still rocks it.
  [EnemySubtype.BOSS_SCATTER]: {
    color: '#fbbf24', size: 74, health: 105, // PROVISIONAL
    maxSpeed: 6.2, accel: 5.0, turnRate: 2.4,
    sprite: ASSETS.ENEMY_TANK, mass: 90, shape: 'talon',
    shoots: true, contactDamage: 16,
    weapon: BOSS_WEAPONS.SCATTER,
    telegraph: 0.45,
    poise: { stunDamage: 9, knockScale: 0.3 },
  },
  // Bastion (BOSS_SIEGE): the second WEAPON-boss and the Reaver's inverse on
  // every axis — slow, huge and plated instead of fast and evasive, lobbing
  // the PLAYER'S OWN Plasma Cannon (BOSS_WEAPONS.SIEGE, splash and all) in
  // 2-shell salvos from a LONG stand-off (`preferredDistance`) instead of
  // brawling.  Its counterplay identity is the pair of B3 traits: a permanent
  // FRONT-SHIELD plate (face-tanking never becomes viable — flank it, ricochet
  // into its back, or splash past the plate edge) over REGEN that only a
  // genuine damage BURST shuts off.  SHOOTING role, and the only archetype
  // that overrides the shared skirmisher stand-off.
  [EnemySubtype.BOSS_SIEGE]: {
    color: '#c084fc', size: 92, health: 150, // PROVISIONAL
    maxSpeed: 2.4, accel: 1.6, turnRate: 0.8,
    sprite: ASSETS.ENEMY_TANK, mass: 200, shape: 'bastion',
    shoots: true, contactDamage: 20,
    weapon: BOSS_WEAPONS.SIEGE,
    burst: { size: 2, gap: 0.55 },
    telegraph: 1.0,
    preferredDistance: 620, // long stand-off — the third distinct range band
    poise: { stunDamage: 14, knockScale: 0.08 },
  },
};

// Kamikaze proximity fuse (Stage 0): a bomber detonates this many world units
// BEFORE its hull would actually touch the player (added on top of the two
// half-sizes), so the blast goes off slightly ahead of contact rather than on
// overlap.  Tuned per-frame in GameEngine.updateKamikazeProximity.
export const KAMIKAZE_DETONATE_BUFFER = 36;

// ── Status effects ────────────────────────────────────────────────────────────
// Corrosion: a stacking damage-over-time the Orbiter (Shooter-tier-2) applies
// with its acid rounds.  Bleeds health directly (past the shield); each hit
// adds a stack (capped) and refreshes the duration.  v1 effect — the framework
// is generic so disables / scramble / slow can join later.
export const CORROSION = {
  DMG_PER_SEC: 3,    // per stack
  DURATION: 4,       // seconds, refreshed on re-hit
  MAX_STACKS: 3,     // up to 9 dmg/s
  COLOR: '#a3e635',  // acid green — projectile + HUD badge + ship tint
};

// Disable / EMP (Stage 3c): a status effect that takes the player's weapon AND
// shield offline for a duration (no firing, no absorb, no recharge).  Applied
// by the reactive bubble on attach; DBG-self-appliable.  Single non-stacking
// instance, refreshed on re-hit.
export const DISABLE = {
  DURATION: 2.5,     // seconds
  COLOR: '#f59e0b',  // amber — HUD badge + ship tint
};

// Reactive bubble (Stage 5): the latch / contact / multiply behaviour run by
// GameEngine.updateBubbles.  The AI feel (wander vs seek) lives in
// AI_CONFIG.BUBBLE; this block is the engagement payload.
export const BUBBLE_CONSTANTS = {
  /** How much of the light falling on a bubble it RE-EMITS (unified light
   *  layer, DBG "Emissive").  A bubble is a translucent membrane, so a beam
   *  sweeping across one should light it up like a paper lantern — the same
   *  treatment glass and nebula get, at a lower fraction because a bubble is
   *  thin and mostly empty.  It emits WITHOUT occluding: a soft blob casting
   *  a hard shadow volume would read wrong, and the emitter buffer exists
   *  exactly for "lights but does not shadow". */
  EMITS: 0.35,
  // Latch: when a provoked bubble touches the player it attaches and EMPs.
  CONTACT_PAD: 6,         // extra units added to the two half-sizes for the grab
  LATCH_DURATION: 2.6,    // seconds the bubble clings before it tires + falls off
  LATCH_DPS: 6,           // BASE health/sec drained at base size, scaled UP
                          // LINEARLY by the bubble's size (bigger/older bubble =
                          // harder bite): drain = LATCH_DPS × size / baseSize
  // A MODERATE collision (more than a light touch) with the player or an enemy
  // aggros a passive bubble onto the collider — relative impact speed ≥ this.
  COLLIDE_AGGRO_SPEED: 3.5,
  // EMP refresh window applied each latched step.  Kept short so the disable
  // ends ~immediately when the bubble detaches (the latch IS the lockout — no
  // long tail past it).  Re-applied every step, so it never lapses mid-latch.
  EMP_REFRESH: 0.4,       // seconds
  // Knock-off: a latched bubble falls off (→ sick) on the LATCH_DURATION timer,
  // OR early if it's shot (any projectile hit) OR if the player slams a tile /
  // asteroid at ≥ KNOCK_SPEED (a deliberate shake-it-off counter).
  KNOCK_SPEED: 6,         // player impact speed that shakes a latched bubble free
  // Sickness: after breaking a latch, OR after eating a TOXIC shard (plastic /
  // green-nebula), the bubble turns green + goes sluggish and can't eat for a
  // while — and loses aggro.  This replaces the old latch-death.
  SICK_DURATION: 2.8,     // seconds
  SICK_SPEED_MULT: 0.3,   // movement-speed multiplier while sick (sluggish)
  SICK_COLOR: '#84cc16',  // queasy lime — membrane tint while sick
  // Aggro leash: a hunting bubble gives up if its target gets this far away.
  AGGRO_LOSE_RANGE: 950,
  // Mass/energy-conserved eating: each eat's digest time, growth and health are
  // scaled by the shard's RICHNESS (shardRichness), clamped to this band.  A
  // dense metal shard (high) takes longer + feeds more than a light glass one.
  RICH_MIN: 0.6,
  RICH_MAX: 2.0,
  HEAL_PER_RICH: 6,       // current-HP healed per eat (× richness; capped at maxHP)
  // Multiply: a passive bubble that has grown to its `multiply.atSize` splits.
  SPLIT_SPEED: 3.5,       // outward speed imparted to parent + child on a split
  COLOR_PROVOKED: '#fb7185', // angry membrane tint once provoked (render)
  CALM_VISIBILITY: 0.45,  // membrane alpha multiplier while passive (faint, easy
                          // to miss) — provoked bubbles render at full opacity
                          // (a hit-flash still cuts through so shots read)
  FEED_PULSE: 0.22,       // seconds the membrane bulges after swallowing a shard
  DIGEST_DURATION: 5.5,   // BASE seconds to digest a shard (× richness) — slow,
                          // one meal at a time
  // Ambient population: bubbles are always-present fauna, not wave enemies.
  // GameEngine.maintainAmbientBubbles keeps at least AMBIENT_POPULATION alive,
  // spawning one offscreen every AMBIENT_RESPAWN_INTERVAL seconds while below
  // it (breeding can carry the count higher, up to multiply.maxPopulation).
  AMBIENT_POPULATION: 5,
  AMBIENT_RESPAWN_INTERVAL: 4,  // seconds between top-up spawns while short
  SPAWN_MARGIN: 220,            // units past the viewport edge to spawn a fresh bubble
};

// Stage 6: the dragon mini-boss.  Engine-managed lifecycle (GameEngine.spawn-
// Dragon / updateDragon): enter (portal) → roam (flow-weave + devour tiles) →
// leave (portal), or die when its head HP runs out.  The body is a chain of
// segments drawn by RenderSystem along the head's recorded path.
export const DRAGON_CONSTANTS = {
  SPEED_FRAC: 0.13,        // cruise speed as a fraction of the player's terminal cruise
                          // — deliberately slow + ponderous (a roaming siege beast)
  WEAVE_FREQ: 1.1,         // serpentine weave frequency (rad/s)
  WEAVE_AMP: 0.55,         // weave amplitude (radians, rotates the flow heading)
  STEER_RATE: 0.04,        // velocity easing toward the target heading (×dt×60)
  // Head attacks (Stage 6): periodically spits a SWARM gnat and lobs a slow
  // HOMING missile at the player while roaming.
  GNAT_INTERVAL: 3.2,      // seconds between brood spits (+ up to half, random)
  MISSILE_INTERVAL: 2.6,   // seconds between homing missiles
  MISSILE: { speed: 4.5, damage: 12, size: 7, lifetime: 6, color: '#fb7185', homingStrength: 0.55 },
  ENTER_DURATION: 1.1,     // seconds of portal emergence before it starts roaming
  ROAM_DURATION: 28,       // seconds roaming before it heads out (if not killed)
  LEAVE_DURATION: 9,       // safety cap: seconds before the leave is force-finished
                          // (the real exit is the head+tail crossing the portal)
  PORTAL_AHEAD: 320,       // units ahead of the head to open the exit portal
  PORTAL_CONSUME_RADIUS: 70, // head/segment within this of the portal centre → swallowed
  LEAVE_SPEED_MULT: 1.8,   // speed boost while diving for the exit portal
  PATH_SPACING: 11,        // world units between recorded head-path points
  PATH_MAX: 200,           // cap on stored path points (enough for MAX_SEGMENTS)
  // Snake body: each tile the dragon eats is appended as a real chain-followed
  // segment, spaced SEGMENT_SPACING apart, up to MAX_SEGMENTS.
  SEGMENT_SPACING: 36,     // world units between body segments
  MAX_SEGMENTS: 28,        // body length cap (further tiles are just devoured)
  SEGMENT_MASS: 6,         // finite mass so a segment is dynamic + shootable
  START_SEGMENTS: 10,      // body tiles it spawns with (a coherent random material)
  SEGMENTS: 16,            // body segments at base size (grows with size)
  SEG_PER_SIZE: 7,         // +1 segment per this many size-units grown
  SEGMENT_STRIDE: 2,       // path points between consecutive rendered segments
  SEGMENT_TAPER: 0.97,     // segment-radius multiplier toward the tail
  BODY_RADIUS_FRAC: 0.46,  // first body segment radius as a fraction of head size
  CONTACT_CD: 0.7,         // seconds between body-contact hits on the player
  PORTAL_RADIUS: 160,      // portal ring max radius
  PORTAL_DURATION: 0.9,    // portal ring VFX lifetime
  PORTAL_COLOR: '#a78bfa', // violet rift
  COLOR: '#34d399',        // emerald scales
  EYE_COLOR: '#fde047',    // head eye glow
  SCORE: 3000,             // kill payout
  SPAWN_MARGIN: 300,       // units past the viewport edge to open the entry portal
};

// ─── Rival ships (Stage 7) ───────────────────────────────────────────────
// Player-like EntityType.ENEMY roamers that warp in via portal, hunt the WAVE
// enemies (denying the player the kill points + drops they'd otherwise get),
// and—per disposition—may also fight the player.  Engine-managed lifecycle
// (GameEngine.updateRivals), rendered from an old enemy PNG with a disposition
// ring.  Three dispositions: hostile (fights player + enemies), ally (fights
// enemies only, never the player), neutral (fights enemies for loot, ignores
// the player UNTIL attacked, then retaliates).
export const RIVAL_CONSTANTS = {
  // Cadence: a fresh random rival warps in every SCORE_INTERVAL points earned,
  // up to MAX_RIVALS alive at once.
  SCORE_INTERVAL: 1000, MAX_RIVALS: 6,
  ROAM_DURATION: 280,        // seconds it hunts before warping back out (10× the
                            // dragon's roam — rivals are long-term companions/rivals)
  ENTER_DURATION: 0.9,       // portal-emergence beat before it engages
  SPAWN_MARGIN: 280,         // units past the viewport edge to open the entry portal
  // Disposition spawn weights + team colours (the render ring + score popup).
  WEIGHTS: { hostile: 0.34, ally: 0.30, neutral: 0.36 },
  COLORS: { hostile: '#f87171', ally: '#34d399', neutral: '#fbbf24' } as Record<string, string>,
  // Ship feel.  SIZE is the on-screen sprite size AND the collision footprint
  // (rivals draw 1:1, so hull == hitbox).  Movement (thrust/friction/top speed)
  // is NOT tuned here — rivals fly with the player's map movement config, so
  // they handle like a baseline player ship.
  HEALTH: 120, MASS: 11, SIZE: 38, MAX_SPEED: 5.4,
  VISION: 760,               // target-acquisition range
  FIRE_RANGE: 520,           // opens fire within this of its target
  PREFERRED_DIST: 300,       // strafes to hold roughly this gap from its target
  TIER: 4,                   // kill-bounty tier (SCORE POINTS_PER_TIER × this) when downed
  WEAPON: { speed: 8.5, damage: 9, cooldown: 0.5, lifetime: 1.4, size: 4.5, color: '#e2e8f0' },
  LOOT_RANGE: 150,           // vacuums collectible drops within this (denies the player)
  HEAL_PER_LOOT: 6,          // self-heal per drop eaten
  // Warp-out portal (mirrors the dragon's fly-through, single ship).
  PORTAL_RADIUS: 150, PORTAL_DURATION: 0.85, PORTAL_COLOR: '#a78bfa',
  PORTAL_AHEAD: 300, PORTAL_CONSUME_RADIUS: 64, LEAVE_SPEED_MULT: 1.7, LEAVE_DURATION: 8,
  // Sprite pool — the retired enemy art (one picked at random per rival).
  SPRITES: [
    ASSETS.ENEMY_DRONE, ASSETS.ENEMY_CHARGER, ASSETS.ENEMY_TANK,
    ASSETS.ENEMY_SKIRMISHER, ASSETS.ENEMY_ORBITER, ASSETS.ENEMY_SNIPER,
  ],
};
export type RivalDisposition = 'hostile' | 'ally' | 'neutral';

// Per-subtype attack effect: a shooter whose subtype appears here fires rounds
// that apply the effect to the player on hit (and render in the effect colour).
export const ENEMY_ATTACK_EFFECTS: Partial<Record<EnemySubtype, EffectPayload>> = {
  [EnemySubtype.SHOOTER_2]: {
    kind: 'corrosion', duration: CORROSION.DURATION,
    dmgPerSec: CORROSION.DMG_PER_SEC, maxStacks: CORROSION.MAX_STACKS,
  },
};

// ── Enemy counterplay traits ──────────────────────────────────────────────────
// Soft-counter levers stamped on an enemy at spawn (WaveSystem.buildEnemy).
// SOFT by design: a chip weapon still works, just slowly, while the demanded
// tool trivialises the threat.  The trait-counterplay map that keeps every
// weapon a "right answer" somewhere is WEAPONS_AMMO_PLAN §7.
//   armor.chipThreshold — per-hit damage at/above this lands in full
//   armor.reduction     — fraction cut from hits BELOW the threshold
// So Blaster (4) / Shotgun-pellet (3) chip the Tank, while Cannon (18) /
// Lightning (9) / charged shots — and a Gunnery-boosted Blaster past 6 — punch
// through.  AoE/explosion damage isn't chip-resisted (it's an answer).
//
// A trait SET is also what a (h) boss phase carries (BossPhaseDef.traits): a
// phase REPLACES the set, so a boss can trade one defence for another as it
// breaks down.  front-shield / regen join in milestone B3.
//
// EVASIVE ((h) bosses): the enemy senses STRAIGHT player projectiles closing on
// it and JUKES sideways — a real dodge, not a damage-reduction fudge.  Three
// deliberate blind spots keep the §7 counterplay table honest:
//   - HOMING shots are ignored (they re-acquire mid-juke) — the SEEKER is the
//     designated answer.
//   - Lightning arcs never exist as travelling projectiles, so chains connect.
//   - One juke per `cooldown`, so a Shotgun cone or a Cannon splash still lands.
// Gated by `physics.traitsEnabled` (DBG "Traits") exactly like armor.
//   sense       — radius (units) within which incoming shots are noticed
//   missRadius  — perpendicular miss distance that still counts as "aimed at me"
//   impulse     — lateral velocity kick applied to the juke
//   cooldown    — seconds between jukes (the counterplay window)
// Numbers PROVISIONAL.
//
// FRONT-SHIELD ((h) B3): a PERMANENT directional armour plate centred on the
// entity's FACING — the Bulwark's arc geometry generalized, but with NO pool to
// deplete, so face-tanking never becomes viable no matter how long you hold the
// trigger.  Its answers fall out of WHERE damage is applied rather than from
// special cases: lightning chains and shockwave rings damage in GameEngine,
// OUTSIDE the projectile path, so they bypass the plate for free; a Laser
// ricochet arrives from behind; and a slow fortress can simply be flanked.
//   deg       — total covered arc, centred on `rotation`
//   reduction — fraction cut from a covered hit
//
// REGEN ((h) B3): heals `perSec` unless a damage BURST shuts it off.  The burst
// window is a FIXED BUCKET, not a sliding one, and that IS the mechanic: the
// first damaging hit ARMS the bucket and it expires on schedule regardless of
// what lands inside.  A refreshing window would instead measure "damage until
// the player pauses" — any sustained weapon clears that, chip damage would stop
// healing through, and the trait would invert.  With fixed buckets the
// arithmetic lands on the §7 table by construction (per `windowSec` = 0.4s):
//   Blaster  ≈12  → heals through (chip)      Shotgun cone 18 → opens the burn
//   Burst Rifle 15 → just under the gate      Cannon 18 (+10 splash) → opens it
//   Seeker 8 / Lightning 9 → under (their answers are other traits)
//   perSec      — health per second while not burning
//   burstDamage — damage inside one bucket that shuts regen off
//   windowSec   — bucket length (armed by the first hit)
//   burnSec     — how long regen stays off after a burst
// Damage from EVERY player path feeds the bucket via noteTraitDamage(), so
// splash and chain damage count toward a burst exactly like pellets do.
export interface EnemyTraitSet {
  armor?: { chipThreshold: number; reduction: number };
  evasive?: { sense: number; missRadius: number; impulse: number; cooldown: number };
  frontShield?: { deg: number; reduction: number };
  regen?: { perSec: number; burstDamage: number; windowSec: number; burnSec: number };
}

/**
 * Feed one applied-damage event into a REGEN-trait entity's fixed burst bucket.
 * Called from every path that damages an enemy on the player's behalf — the
 * PhysicsSystem projectile hit, the lightning chain, and the shockwave ring —
 * so splash and chain damage count toward a burst like pellets do.
 *
 * The bucket is FIXED, not sliding: only the FIRST hit arms the timer (see the
 * EnemyTraitSet comment for why that distinction is the whole trait).  No-op
 * for entities without the trait, so call sites stay unconditional.
 */
export function noteTraitDamage(entity: GameEntity, damage: number) {
  const cfg = entity.regen;
  if (!cfg || !(damage > 0)) return;
  if ((entity.regenBucketTimer ?? 0) <= 0) {
    // First hit of a new bucket arms the window.
    entity.regenBucketTimer = cfg.windowSec;
    entity.regenBucket = 0;
  }
  entity.regenBucket = (entity.regenBucket ?? 0) + damage;
  if (entity.regenBucket >= cfg.burstDamage) {
    entity.regenBurnTimer = cfg.burnSec;
    entity.regenBucketTimer = 0;
    entity.regenBucket = 0;
  }
}
export const ENEMY_TRAITS: Partial<Record<EnemySubtype, EnemyTraitSet>> = {
  [EnemySubtype.RAMMER_3]: { armor: { chipThreshold: 6, reduction: 0.7 } }, // Tank
  // Warden (chassis boss): the same chip-resist lesson at capstone scale — its
  // phase table re-states it (and trades it away in phase 2), but the archetype
  // row is what a DBG/one-off spawn gets before the first phase stamps.
  [EnemySubtype.BOSS_WARDEN]: { armor: { chipThreshold: 8, reduction: 0.65 } },
  // Reaver (weapon boss 1): pure EVASION — no armor, so every weapon hurts it
  // once it is actually HIT.  Its phase 3 trades evasion for armor (BOSS_DEFS).
  [EnemySubtype.BOSS_SCATTER]: {
    evasive: { sense: 340, missRadius: 46, impulse: 7.5, cooldown: 0.85 },
  },
  // Bastion (weapon boss 2): plate + regen.  Its phase table layers them (both
  // at once in phase 2 is the hard part of the fight) — this row is what a
  // DBG/one-off spawn gets before the first phase stamps.
  [EnemySubtype.BOSS_SIEGE]: {
    frontShield: { deg: 150, reduction: 0.75 },
    regen: { perSec: 3.5, burstDamage: 16, windowSec: 0.4, burnSec: 3.0 },
  },
};

// Maps each subtype to its role — used by AI routing and shooting logic.
export const ENEMY_ROLE: Record<EnemySubtype, EnemyRole> = {
  [EnemySubtype.RAMMER_1]:  EnemyRole.RAMMING,
  [EnemySubtype.RAMMER_2]:  EnemyRole.RAMMING,
  [EnemySubtype.RAMMER_3]:  EnemyRole.RAMMING,
  [EnemySubtype.SHOOTER_1]: EnemyRole.SHOOTING,
  [EnemySubtype.SHOOTER_2]: EnemyRole.SHOOTING,
  [EnemySubtype.SHOOTER_3]: EnemyRole.SHOOTING,
  [EnemySubtype.KAMIKAZE]:  EnemyRole.RAMMING,
  [EnemySubtype.BULWARK]:   EnemyRole.SHOOTING,
  [EnemySubtype.TURRET]:    EnemyRole.SHOOTING, // stationary (no-move guard in AISystem)
  [EnemySubtype.SWARM]:     EnemyRole.RAMMING,
  [EnemySubtype.NEST]:      EnemyRole.SHOOTING, // stationary spawner (no-move guard)
  [EnemySubtype.BUBBLE]:    EnemyRole.RAMMING,  // passive until provoked, then rushes
  [EnemySubtype.DRAGON]:    EnemyRole.RAMMING,  // engine-managed roamer (no-op AI)
  [EnemySubtype.BOSS_WARDEN]: EnemyRole.SHOOTING, // holds mid-range and shells you
  [EnemySubtype.BOSS_SCATTER]: EnemyRole.RAMMING, // closes to scattergun range and brawls
  [EnemySubtype.BOSS_SIEGE]:   EnemyRole.SHOOTING, // stands well back and lobs shells
};

// ── AI behavior-dispatch table (Stage 2a) ─────────────────────────────────────
// Per-subtype movement strategy.  AISystem routes each enemy through the named
// strategy via a lookup table instead of an `ENEMY_ROLE`-keyed if/else, so a
// new behavior is a TABLE ENTRY (add a strategy fn in AISystem + a row here),
// not a growing switch.  The value is an object so future per-subtype knobs
// (targeting mode, an optional special-tick) drop in without restructuring.
//
// Today every subtype maps to one of the two original routines exactly as
// ENEMY_ROLE did (RAMMING → 'dogfighter', SHOOTING → 'skirmisher'), so play is
// byte-for-byte identical; the per-subtype quirks (Drone jitter, Orbiter true-
// orbit, Sniper lock, Turret no-move) still live inside those routines.
export type EnemyMovement = 'dogfighter' | 'skirmisher' | 'swarm' | 'bubble' | 'dragon';
export interface EnemyBehaviorDef {
  /** Which AISystem movement/targeting routine runs for this subtype. */
  move: EnemyMovement;
  // Extension points (add here + a matching strategy/handler in AISystem):
  //   target?: 'player' | 'nearestEnemy' | …
  //   special?: 'arcShieldSlew' | 'boids' | 'nestSpawn' | …
}
export const ENEMY_BEHAVIOR: Record<EnemySubtype, EnemyBehaviorDef> = {
  [EnemySubtype.RAMMER_1]:  { move: 'dogfighter' },
  [EnemySubtype.RAMMER_2]:  { move: 'dogfighter' },
  [EnemySubtype.RAMMER_3]:  { move: 'dogfighter' },
  [EnemySubtype.KAMIKAZE]:  { move: 'dogfighter' },
  [EnemySubtype.SHOOTER_1]: { move: 'skirmisher' },
  [EnemySubtype.SHOOTER_2]: { move: 'skirmisher' },
  [EnemySubtype.SHOOTER_3]: { move: 'skirmisher' },
  [EnemySubtype.BULWARK]:   { move: 'skirmisher' },
  [EnemySubtype.TURRET]:    { move: 'skirmisher' },
  [EnemySubtype.SWARM]:     { move: 'swarm' },
  [EnemySubtype.NEST]:      { move: 'skirmisher' }, // maxSpeed 0 → no-move guard
  [EnemySubtype.BUBBLE]:    { move: 'bubble' },     // wander → (on hit) chase + latch
  [EnemySubtype.DRAGON]:    { move: 'dragon' },     // no-op (GameEngine.updateDragon drives it)
  // (h) bosses ride the EXISTING strategies — the boss-ness lives in the
  // BOSS_DEFS phase table + traits, never in a bespoke movement routine.
  [EnemySubtype.BOSS_WARDEN]: { move: 'skirmisher' },
  [EnemySubtype.BOSS_SCATTER]: { move: 'dogfighter' },
  [EnemySubtype.BOSS_SIEGE]:   { move: 'skirmisher' }, // + its own preferredDistance
};

// ── (h) Bosses ────────────────────────────────────────────────────────────────
// Bosses are WAVE-ARENA CAPSTONES (decision #39e): every
// BOSS_CONSTANTS.WAVE_INTERVAL-th wave of an arena is a boss wave — the boss
// warps in through the shared rift VFX (GameEngine.openPortal) alongside a
// reduced normal spawn budget, and the wave only clears when it is dead.  The
// Overworld hub runs no waves, so it gets no bosses for free.
//
// A boss is NOT a new entity category.  It is an ENEMY_VARIANTS archetype like
// any other, routed through ENEMY_BEHAVIOR and tracked as a COUNTED wave enemy,
// with a BOSS_DEFS row on top describing its PHASES.  A phase is expressed
// entirely through fields the existing systems already read — a
// `Partial<WeaponConfig>` override, a shield (arc or bubble), a brood spawner,
// a trait set, a speed multiplier, a colour — so a phase change is a STAMP,
// never a script (strategy guardrail #36e).  GameEngine.updateBosses applies a
// phase once, on the health-fraction transition.
//
// PAYOUT: a boss pays SALVAGE plus a RANDOM MODULE dropped into the inventory
// (GameEngine.grantBossModule).  The module replaced a timed SHOP DISCOUNT
// (user call, playtest): a countdown you must be near a shop to spend is worse
// than a thing you carry away, and removing it also removed the buy/sell
// money-pump the discount created.  There is still deliberately NO
// weapon-unlock plumbing: weapons stay purely purchased.
export const BOSS_CONSTANTS = {
  /** NORMAL waves per stage, BEFORE the capstone.  The boss then gets its OWN
   *  wave on top (user call) — a stage is `WAVE_INTERVAL` ordinary waves and
   *  then wave `WAVE_INTERVAL + 1`, which is the boss wave and nothing else.
   *  A capstone therefore never lands inside a normal wave's stream, and the
   *  stage cannot clear until wave 5 is fully cleared.  See STAGE_WAVE_COUNT. */
  WAVE_INTERVAL: 5,
  /** The normal spawn budget of a boss wave, scaled down — the boss IS most of
   *  the wave, so a capstone isn't also a crowd.  Now that the boss owns its
   *  own wave, this budget buys the boss's OWN ESCORT (BossDef.companions),
   *  not a slice of the ordinary wave mix.  PROVISIONAL. */
  COMPANION_BUDGET_FRAC: 0.55,
  /** Score paid on a boss kill, on top of the normal tier kill points. */
  SCORE: 2500,
  // Beat before the stage-clear screen (seconds).  Standard reward-moment
  // pacing: let the KILL land first — explosion, debris, shake, the salvage
  // spray converging — and only then take control away for the summary.
  // Cutting straight to a menu on the killing blow throws away the payoff the
  // fight was for.  ~1.9s covers the explosion (EXPLOSION_CONSTANTS.DURATION)
  // plus a short quiet beat; the overlay then FADES in rather than snapping.
  STAGE_CLEAR_DELAY_SEC: 1.9,
  /** Salvage units sprayed on a boss kill — the model-(d) income accelerator.
   *  PROVISIONAL sizing against today's economy: combat income runs ≈5–7
   *  units/wave and a snitch catch pays 8, so 12 (≈12,000 credits) is worth
   *  roughly two waves of fighting without trivialising a 25k–60k module.
   *  The stage-clear screen reports this in CREDITS (× CREDITS_PER_DROP), not
   *  as a drop count — 12 rendered with a money glyph read as 12 credits. */
  SALVAGE_DROPS: 12,
  /** Debris particles thrown on the death payoff beat (on top of the normal
   *  enemy explosion).  Matches the dragon's scale — a capstone should read
   *  as an event, not as a big drone popping. */
  DEATH_DEBRIS: 26,
  /** Entrance / death rift VFX (GameEngine.openPortal). */
  PORTAL_RADIUS: 300,
  PORTAL_DURATION: 1.1,
  /** Aura ring drawn around a live boss (RenderSystem). */
  AURA_SCALE: 1.24,
  AURA_ALPHA: 0.5,
} as const;

/** One phase of a boss fight.  Entered when health/maxHealth ≤ `atHealthFrac`
 *  (phases listed in DESCENDING order; phase 0 must be 1 = full health).  Every
 *  field maps onto machinery that already exists — see the block comment. */
export interface BossPhaseDef {
  atHealthFrac: number;
  /** Banner text on entry (a normal wave announcement). */
  announce?: string;
  /** Hull tint for the phase (also the aura + HUD bar colour). */
  color?: string;
  /** Multiplier on the archetype maxSpeed while in this phase. */
  speedMult?: number;
  /** Weapon override merged over the archetype weapon (GameEntity
   *  .weaponOverride → WeaponSystem.updateEnemyShooting). */
  weapon?: Partial<WeaponConfig>;
  /** Shield raised for this phase — a full bubble, or a tracking sector when
   *  `arc` is set (the Bulwark's geometry).  ABSENT → any existing shield is
   *  dropped on entry, so a phase can also mean "barrier blown". */
  shield?: { amount: number; regen: number; arc?: { deg: number; slew: number } };
  /** Escort brood spawned while in this phase (GameEntity.spawner →
   *  GameEngine.updateNests).  Absent → escorts stop. */
  spawner?: SpawnerConfig;
  /** Traits active in this phase, REPLACING the archetype's ENEMY_TRAITS row —
   *  so a phase can trade a defence away as well as add one. */
  traits?: EnemyTraitSet;
}

export interface BossDef {
  /** Display name for the HUD boss bar + banners. */
  name: string;
  /** Phases, descending by `atHealthFrac`; index 0 must be 1. */
  phases: BossPhaseDef[];
  /** The boss's OWN ESCORT — the only enemies its dedicated wave streams in
   *  (cycled to fill the COMPANION_BUDGET_FRAC budget).  A boss wave is not an
   *  ordinary wave with a boss bolted on: the escort is chosen to state the
   *  same problem the boss states, so the wave reads as one encounter.  Omit
   *  and the boss fights alone. */
  companions?: EnemySubtype[];
}

export const BOSS_DEFS: Partial<Record<EnemySubtype, BossDef>> = {
  // ── Warden — the chassis boss ──
  // Phase 1  a barrier shield over armor plating: chip fire does almost
  //          nothing, so you have to bring a big hit (or wear the shield down
  //          and then bring one).
  // Phase 2  barrier blown AND plating gone: it speeds up, shortens its beat
  //          and calls a swarm escort — every weapon works now, the question is
  //          whether you can out-damage the escort.
  [EnemySubtype.BOSS_WARDEN]: {
    name: 'WARDEN',
    // Escort: an ARMOURED honour guard that restates the boss's own lesson —
    // a Bulwark's arc shield and a Tank's armor both punish chip fire, so the
    // whole wave asks the same question the Warden asks.
    companions: [EnemySubtype.BULWARK, EnemySubtype.RAMMER_3, EnemySubtype.SHOOTER_2],
    phases: [
      {
        atHealthFrac: 1,
        color: '#38bdf8',
        shield: { amount: 80, regen: 5 },
        traits: { armor: { chipThreshold: 8, reduction: 0.65 } },
      },
      {
        atHealthFrac: 0.5,
        announce: 'WARDEN — BARRIER DOWN',
        color: '#f97316',
        speedMult: 1.35,
        weapon: { cooldown: 1.2, damage: 11, speed: 9, size: 10, count: 2, spread: 12, color: '#fdba74', glow: true },
        spawner: { subtype: EnemySubtype.SWARM, interval: 5.0, batch: 3, maxBrood: 9 },
      },
    ],
  },
  // ── Reaver — the scattergun boss (weapon-boss 1) ──
  // Phase 1  brawls with the themed player Shotgun and JUKES straight shots:
  //          the Seeker is the felt answer, everything else has to lead it.
  // Phase 2  raises a TRACKING ARC SHIELD on top of the evasion — face-tanking
  //          stops working and you have to flank (the Bulwark's soft counter at
  //          boss scale).  Slower jukes, tighter/faster cone.
  // Phase 3  shield gone, evasion TRADED for ARMOR, a wider point-blank cone
  //          and a KAMIKAZE escort — the right answer flips from Seeker
  //          (dodge) to a big-hit weapon (chip-resist) mid-fight.
  [EnemySubtype.BOSS_SCATTER]: {
    name: 'REAVER',
    // Escort: a FAST pack.  The Reaver's problem is hitting something that
    // jukes; the escort makes standing still to line a shot up expensive.
    companions: [EnemySubtype.RAMMER_1, EnemySubtype.SWARM, EnemySubtype.KAMIKAZE],
    phases: [
      {
        atHealthFrac: 1,
        color: '#fbbf24',
        traits: { evasive: { sense: 340, missRadius: 46, impulse: 7.5, cooldown: 0.85 } },
      },
      {
        atHealthFrac: 0.66,
        announce: 'REAVER RAISES ITS GUARD',
        color: '#f59e0b',
        speedMult: 1.1,
        shield: { amount: 90, regen: 6, arc: { deg: 160, slew: 2.4 } },
        weapon: { ...BOSS_WEAPONS.SCATTER, cooldown: 1.25, spread: 16, count: 8 },
        traits: { evasive: { sense: 340, missRadius: 46, impulse: 7.5, cooldown: 1.1 } },
      },
      {
        atHealthFrac: 0.33,
        announce: 'REAVER — ENRAGED',
        color: '#ef4444',
        speedMult: 1.25,
        weapon: { ...BOSS_WEAPONS.SCATTER, cooldown: 0.95, spread: 30, count: 9, damage: 4 },
        spawner: { subtype: EnemySubtype.KAMIKAZE, interval: 6.0, batch: 2, maxBrood: 4 },
        traits: { armor: { chipThreshold: 6, reduction: 0.6 } },
      },
    ],
  },
  // ── Bastion — the siege boss (weapon-boss 2) ──
  // Phase 1  a FRONT-SHIELD plate only: shooting it in the face barely
  //          scratches it, so the lesson is "get behind it" (or splash /
  //          chain past the plate, which bypass the projectile path entirely).
  // Phase 2  plate PLUS regen — the hard part of the fight.  Note the
  //          deliberate ORDERING in PhysicsSystem: the plate reduces damage
  //          BEFORE the burst bucket sees it, so bursting a plated target
  //          means bursting it FROM BEHIND.
  // Phase 3  plate blown off, regen stronger, a TURRET escort pins you down:
  //          a pure damage race in the open.
  [EnemySubtype.BOSS_SIEGE]: {
    name: 'BASTION',
    // Escort: EMPLACEMENTS.  The Bastion's answer is to flank it; turrets and
    // a nest make the flanking lane the thing you have to earn.
    companions: [EnemySubtype.TURRET, EnemySubtype.NEST, EnemySubtype.SHOOTER_3],
    phases: [
      {
        atHealthFrac: 1,
        color: '#c084fc',
        traits: { frontShield: { deg: 150, reduction: 0.75 } },
      },
      {
        atHealthFrac: 0.7,
        announce: 'BASTION — REPAIR SYSTEMS ONLINE',
        color: '#a855f7',
        weapon: { ...BOSS_WEAPONS.SIEGE, cooldown: 2.6 },
        traits: {
          frontShield: { deg: 150, reduction: 0.75 },
          regen: { perSec: 3.5, burstDamage: 16, windowSec: 0.4, burnSec: 3.0 },
        },
      },
      {
        atHealthFrac: 0.35,
        announce: 'BASTION — PLATING BREACHED',
        color: '#f472b6',
        speedMult: 1.3,
        weapon: { ...BOSS_WEAPONS.SIEGE, cooldown: 2.1, explosionRadius: 160 },
        spawner: { subtype: EnemySubtype.TURRET, interval: 8.0, batch: 1, maxBrood: 3 },
        traits: { regen: { perSec: 5, burstDamage: 16, windowSec: 0.4, burnSec: 3.0 } },
      },
    ],
  },
};

/** Boss rotation — each boss wave takes the next entry, cycling.  Order is the
 *  intended teaching order (the plain chassis lesson first). */
export const BOSS_ROTATION: EnemySubtype[] = [
  EnemySubtype.BOSS_WARDEN,   // the plain chassis lesson first
  EnemySubtype.BOSS_SCATTER,  // then evasion — bring the Seeker
  EnemySubtype.BOSS_SIEGE,    // then plate + regen — flank it, and burst it
];

/** Waves in ONE STAGE: `WAVE_INTERVAL` ordinary waves plus the boss's own
 *  dedicated wave.  This is the stride the boss rotation, the boss test, and
 *  `WaveSystem.waveOffset` all step by — keep them reading THIS constant so a
 *  stage-length change stays one edit. */
export const STAGE_WAVE_COUNT = BOSS_CONSTANTS.WAVE_INTERVAL + 1;

/** True when the 0-based wave index is a boss-capstone wave.  The capstone is
 *  the LAST wave of the stage and carries nothing but the boss and its own
 *  escort — so wave `WAVE_INTERVAL` must be fully cleared before it starts. */
export function isBossWave(index: number): boolean {
  return BOSS_ROTATION.length > 0
    && (index + 1) % STAGE_WAVE_COUNT === 0;
}

/** The boss subtype for a given 0-based boss-wave index (cycles the rotation). */
export function bossForWave(index: number): EnemySubtype {
  const n = Math.floor((index + 1) / STAGE_WAVE_COUNT) - 1;
  return BOSS_ROTATION[Math.max(0, n) % BOSS_ROTATION.length];
}

/** The spawn list for a BOSS wave: the boss's own escort, cycled to fill the
 *  budget.  Deliberately NOT `buildWaveSpawnList` — a capstone wave is a
 *  designed encounter, not the ordinary weighted mix with a boss added. */
export function buildBossWaveSpawnList(boss: EnemySubtype, budget: number): EnemySubtype[] {
  const escort = BOSS_DEFS[boss]?.companions;
  if (!escort || escort.length === 0) return [];
  const list: EnemySubtype[] = [];
  for (let i = 0; i < budget; i++) list.push(escort[i % escort.length]);
  return list;
}

// ── Wave definitions ──────────────────────────────────────────────────────────
// Scripted teaching waves.  Waves 1–3 keep hand-authored compositions so each
// enemy role gets a clean introduction (ram-only → shoot-only → mixed).  The
// composition is cycled to fill the timed wave's spawn budget, so counts
// express the mix ratio, not the absolute spawn total.  Waves 4+ roll a
// weighted-random mix instead — see buildWaveSpawnList().
//
// (The old per-wave `powerup` field was dead code — powerup drops were removed
// from DropSystem — and is gone; weapon unlocks return with the (h) bosses.)
export const WAVE_DEFINITIONS: { enemies: { subtype: EnemySubtype; count: number }[] }[] = [
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 4 }] },                                                // W1  Ramming
  { enemies: [{ subtype: EnemySubtype.SHOOTER_1, count: 4 }] },                                                // W2  Shooting
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 2 }, { subtype: EnemySubtype.SHOOTER_1, count: 2 }] }, // W3  Mixed
  { enemies: [{ subtype: EnemySubtype.KAMIKAZE,  count: 3 }, { subtype: EnemySubtype.RAMMER_1,  count: 1 }] }, // W4  Kamikaze intro
  { enemies: [{ subtype: EnemySubtype.BULWARK,   count: 2 }, { subtype: EnemySubtype.SHOOTER_1, count: 2 }] }, // W5  Bulwark intro
  { enemies: [{ subtype: EnemySubtype.TURRET,    count: 2 }, { subtype: EnemySubtype.RAMMER_1,  count: 2 }] }, // W6  Turret intro
  { enemies: [{ subtype: EnemySubtype.NEST,      count: 1 }, { subtype: EnemySubtype.SWARM,     count: 5 }] }, // W7  Nest + swarm intro (ratio is cycled to budget)
  // NOTE: BUBBLE is ambient fauna (always-present, never a wave enemy) — it's
  // maintained by GameEngine.maintainAmbientBubbles, not spawned by waves.
];

// Tier-weight progression for the weighted-random waves (index 3+).  Row =
// min(floor(index / TIMED_WAVE_CONFIG.TIER_SET_LENGTH), last), so the blend
// walks L1 → ½L1+½L2 → L2 → ⅓ each → ½L2+½L3 → L3 over the first 18 waves
// and stays pure tier-3 from then on.  Shape: [w_tier1, w_tier2, w_tier3].
const WAVE_TIER_WEIGHTS: [number, number, number][] = [
  [1, 0, 0],
  [0.5, 0.5, 0],
  [0, 1, 0],
  [1 / 3, 1 / 3, 1 / 3],
  [0, 0.5, 0.5],
  [0, 0, 1],
];

const SUBTYPE_BY_ROLE_TIER: Record<EnemyRole, EnemySubtype[]> = {
  [EnemyRole.RAMMING]:  [EnemySubtype.RAMMER_1,  EnemySubtype.RAMMER_2,  EnemySubtype.RAMMER_3],
  [EnemyRole.SHOOTING]: [EnemySubtype.SHOOTER_1, EnemySubtype.SHOOTER_2, EnemySubtype.SHOOTER_3],
};

/** Length of the timed window for a 0-based wave index, in seconds. */
export function getWaveDurationSec(index: number): number {
  return Math.min(
    TIMED_WAVE_CONFIG.BASE_DURATION_SEC + index * TIMED_WAVE_CONFIG.DURATION_PER_WAVE_SEC,
    TIMED_WAVE_CONFIG.DURATION_CAP_SEC,
  );
}

/** Unscaled total spawn budget for a wave (before DIFFICULTY_SCALES). */
export function getWaveSpawnBudget(index: number): number {
  const interval = Math.max(
    TIMED_WAVE_CONFIG.MIN_SPAWN_INTERVAL_SEC,
    TIMED_WAVE_CONFIG.BASE_SPAWN_INTERVAL_SEC - index * TIMED_WAVE_CONFIG.SPAWN_INTERVAL_DECAY_PER_WAVE,
  );
  return Math.min(
    TIMED_WAVE_CONFIG.MAX_SPAWN_BUDGET,
    Math.max(1, Math.floor(getWaveDurationSec(index) / interval)),
  );
}

/** Roll a 0-based tier from a [w1, w2, w3] weight row. */
function rollTier(weights: [number, number, number]): number {
  const r = Math.random() * (weights[0] + weights[1] + weights[2]);
  if (r < weights[0]) return 0;
  if (r < weights[0] + weights[1]) return 1;
  return 2;
}

/**
 * Build the ordered subtype list a timed wave will spawn (length = budget).
 *
 * Scripted waves (index < WAVE_DEFINITIONS.length) cycle their authored
 * composition to fill the budget.  Later waves roll each slot independently:
 * 50/50 ram/shoot role, tier from the WAVE_TIER_WEIGHTS row for the wave's
 * set.  A variety guarantee re-rolls one slot's role when a random wave with
 * budget ≥ 3 lands all-rammer or all-shooter, so every such wave mixes types.
 */
export function buildWaveSpawnList(index: number, budget: number, forced?: EnemySubtype | null): EnemySubtype[] {
  // DBG enemy-test override: spawn ONLY the forced subtype (ignores the
  // scripted/weighted mix) so a specific enemy/trait can be tested in isolation.
  if (forced) return new Array(budget).fill(forced);
  const list: EnemySubtype[] = [];
  if (index < WAVE_DEFINITIONS.length) {
    const flat: EnemySubtype[] = [];
    for (const g of WAVE_DEFINITIONS[index].enemies) {
      for (let i = 0; i < g.count; i++) flat.push(g.subtype);
    }
    for (let i = 0; i < budget; i++) list.push(flat[i % flat.length]);
    return list;
  }

  const set = Math.min(
    Math.floor(index / TIMED_WAVE_CONFIG.TIER_SET_LENGTH),
    WAVE_TIER_WEIGHTS.length - 1,
  );
  const weights = WAVE_TIER_WEIGHTS[set];
  for (let i = 0; i < budget; i++) {
    const role = Math.random() < 0.5 ? EnemyRole.RAMMING : EnemyRole.SHOOTING;
    list.push(SUBTYPE_BY_ROLE_TIER[role][rollTier(weights)]);
  }

  if (budget >= 3) {
    const hasRam   = list.some(s => ENEMY_ROLE[s] === EnemyRole.RAMMING);
    const hasShoot = list.some(s => ENEMY_ROLE[s] === EnemyRole.SHOOTING);
    if (!hasRam || !hasShoot) {
      const k = Math.floor(Math.random() * budget);
      const tier = SUBTYPE_BY_ROLE_TIER[ENEMY_ROLE[list[k]]].indexOf(list[k]);
      list[k] = SUBTYPE_BY_ROLE_TIER[hasRam ? EnemyRole.SHOOTING : EnemyRole.RAMMING][tier];
    }
  }
  return list;
}

/**
 * Precomputed per-(variant, tier) density multiplier table.  Looked
 * up at render time in O(1).  Shape: variantId → number[tier].
 *
 * Each entry is the RGB multiplier applied to the variant's base
 * colour at the given tier.  Tier 0 is exactly 1.0 (no change —
 * preserves the variant's pre-density visual identity), tier
 * `density.maxSteps` is exactly the variant's `density.tintFloor`
 * (max-allowed-darkness against the active background palette),
 * intermediate tiers linearly interpolate.
 *
 * Built once at module init from SHARD_VARIANTS so the renderer
 * pays no per-frame allocation.  Variants without `density` (today:
 * tile families) get a single-entry [1.0] array — calling sites
 * that hit a missing variant or out-of-range tier degrade to 1.0.
 */
export function densityTintMultiplier(variantId: ShardVariantId, tier: number): number {
  if (tier <= 0) return 1.0;
  if (!_densityTintTableInit) ensureDensityTintTable();
  const table = DENSITY_TINT_TABLE[variantId];
  if (!table) return 1.0;
  if (tier >= table.length) return table[table.length - 1];
  return table[tier];
}

const DENSITY_TINT_TABLE: Partial<Record<ShardVariantId, number[]>> = (() => {
  const out: Partial<Record<ShardVariantId, number[]>> = {};
  // SHARD_VARIANTS is declared further down in this module, but the
  // factory closure runs at module-init AFTER all top-level decls
  // (the Record literal initialiser executes once when SHARD_VARIANTS
  // is queried — this IIFE runs eagerly).  Defer the actual read to
  // first call via a lazy lookup so the cyclic-ish structure resolves.
  return out;
})();

let _densityTintTableInit = false;
function ensureDensityTintTable(): void {
  if (_densityTintTableInit) return;
  _densityTintTableInit = true;
  const ids: ShardVariantId[] = Object.keys(SHARD_VARIANTS) as ShardVariantId[];
  for (const id of ids) {
    const variant = SHARD_VARIANTS[id];
    const density = variant.density;
    if (!density?.enabled) continue;
    // Tier indices [0..maxSteps].  Linear ramp 1.0 → tintFloor.
    const arr = new Array<number>(density.maxSteps + 1);
    for (let t = 0; t <= density.maxSteps; t++) {
      const frac = density.maxSteps === 0 ? 0 : t / density.maxSteps;
      arr[t] = 1.0 - frac * (1.0 - density.tintFloor);
    }
    DENSITY_TINT_TABLE[id] = arr;
  }
}

// Eager init at import time — `SHARD_VARIANTS` is fully constructed
// before any consumer of `densityTintMultiplier` actually runs (the
// renderer is built after constants imports complete), so calling
// this at the bottom of the constants module (after SHARD_VARIANTS
// is declared) is safe.  Done via a lazy guard so test paths that
// import bits of this module in isolation still work.

// ── Graceful cleanup tuning ─────────────────────────────────────────
// Knobs for the offscreen-first, paced shard cleanup pipeline that
// keeps high-density shard fields from popping out of existence on
// the player.  `MAX_REMOVALS_PER_FRAME` caps the per-tick fade-out
// budget so removals bleed down over ~0.5–1.5 s rather than instantly;
// `LARGE_COLLAPSE_BUDGET_PER_FRAME` similarly throttles the
// large-shard-collapse pass.  `MERGE_FADE_DURATION` is the per-entity
// fade-out window when a density compaction retires the smaller
// party (replaces today's instantaneous `b.active = false` for
// non-nebula compose merges).
export const CLEANUP_CONSTANTS = {
  // Per ShardSystem tick — how many shards may begin a fade-out due to
  // count-pressure cleanup.  Conservative default: 2 starts/frame at
  // 60Hz ≈ 120 starts/s, well above natural attrition while still
  // visibly paced when a sudden cleanup is triggered.
  MAX_REMOVALS_PER_FRAME: 2,
  // Per ShardSystem tick — how many shards may collapse inward via
  // the large-shard-collapse pass.  Caps the cascade rate so a giant
  // field doesn't all snap to the dense baseline in a single frame.
  LARGE_COLLAPSE_BUDGET_PER_FRAME: 4,
  // Fade-out duration (seconds) for the smaller party of a density
  // compose merge.  Chosen to read as a smooth dissolve without
  // dragging out the merge feedback.  Matches the spirit of the
  // existing nebula `FADE_DURATION` (1.0 s) but at half the length
  // — non-nebula merges shouldn't linger like a cloud puff.
  MERGE_FADE_DURATION: 0.5,
};

// ── ShardSystem variant table ───────────────────────────────────────
// See docs/SHARD_SYSTEM.md for the design rationale.  This table is
// the source of truth for tile / shard regen, merge, shatter, dent,
// repel, glow and pass-through behaviour — read at runtime by
// ShardSystem, PhysicsSystem, RenderSystem, and the variant-aware
// branches in GameEngine.
//
// All shard-family entities share `carrier: EntityType.STRUCTURE`;
// static-vs-dynamic dispatch is by `mass` (Infinity → static grid,
// finite → dynamic grid).  pass-through is per-variant flag.

const TILE_REGEN_POP_BURST = {
  chipCount:    REGEN_POP_CONSTANTS.CHIP_COUNT,
  chipSpeedMin: REGEN_POP_CONSTANTS.CHIP_SPEED_MIN,
  chipSpeedMax: REGEN_POP_CONSTANTS.CHIP_SPEED_MAX,
  chipLifetime: REGEN_POP_CONSTANTS.CHIP_LIFETIME,
};

// Spawn shape used by tile variants whose shatter spawns mobile
// glass-shards (today's "tile-shard" debris from STRUCTURE death).
// sizeMin = 20 matches the per-map rock-shard minSize universally
// (see MAP_POPULATION) so the asteroid-style shatter's MIN_SIZE
// gate is consistent with the spawn population.
// Glass shards: 3 or 4 vertices.  Sharp/narrow silhouettes from
// high angle jitter and high radius variance — splinter-like.  When
// 4 verts roll, the irregular jitter produces kite-like / asymmetric
// quads that don't overlap with plastic-shard's near-square shape.
const GLASS_SHARD_SPAWN_SHAPE = {
  sizeMin: 20, sizeMax: 200,
  polyVerticesMin: 3, polyVerticesMax: 4,
  polyVerticesOptions: [3, 4],
  angleJitter: 0.5, radiusMin: 0.45, radiusRange: 0.75,
  // Weight ∝ area (d²) so small shards are trivially pushable and big
  // ones are heavy.  Material coefficient makes glass the LIGHTEST of
  // the solids (glass 0.010 : rock 0.018 : metal 0.030 ≈ 1 : 1.8 : 3).
  sizeToMass: (d: number) => d * d * 0.010,
};

// Base config shared by glass / plastic / metal STRUCTURE tiles.
// indestructible-tile and rock-tile override pieces of this.
const STRUCTURE_TILE_BASE: Omit<ShardVariantDef, 'id'> = {
  carrier: EntityType.STRUCTURE,
  // Tiles spawn via TileGenerator at HEX_SIZE; the schema's spawn
  // shape is unused on the tile entity itself but populated with
  // sensible defaults so downstream code can read it without a
  // null-check.
  spawn: GLASS_SHARD_SPAWN_SHAPE,
  regen: {
    kind: 'timer',
    delaySeconds: STRUCTURE_CONSTANTS.TILE_REGEN_DELAY,
    popBurst: TILE_REGEN_POP_BURST,
    rewriteColor: 'none',
  },
  merge: {
    attractedTo: 'none',
    bondsWith: 'none',
    defaultOutcome: 'compose',
  },
  shatter: {
    // Glass-tile death's visual debris comes from
    // DropSystem.spawnGlassShards (called from spawnDrops); the
    // policy below mirrors that glass-shard population so it stays
    // a usable spec for any variant inheriting STRUCTURE_TILE_BASE.
    kind: 'powerlaw',
    style: 'asteroid',
    countMin: 4, countMax: 6,
    alphaMin: 1.0, alphaMax: 1.0,
    childVariant: 'glass-shard',
    forwardDrag: 0.0, perpScatter: 0.0,
    scatterHalfCone: Math.PI,
  },
  passThrough: false,
  spawnsDropsOnDeath: true,
};

// Rock shards: 5, 7, or 9 vertices (odd counts only).  Organic /
// irregular silhouette with moderate jitter and moderate radius
// variance.  Discrete odd counts keep the visual distinct from
// metal's even counts (6/8/10) so a player can tell rock from metal
// at a glance.
const SHARD_SPAWN_SHAPE_ROCK = {
  // sizeMin doubles as the asteroid-shatter chunk floor (ShardSystem
  // MIN_SIZE): shatter children below it are dropped, and a parent
  // without room for two of them stops shattering.  Raised above the
  // free-spawn floor (MAP_POPULATION rock-shard minSize = 20, a separate
  // knob) so asteroid breaks yield fewer, chunkier shards and the
  // recursive re-shatter swarm terminates a generation sooner — shards
  // below ~42 diameter no longer split.
  sizeMin: 30, sizeMax: 200,
  polyVerticesMin: 5, polyVerticesMax: 9,
  polyVerticesOptions: [5, 7, 9],
  angleJitter: 0.5, radiusMin: 0.60, radiusRange: 0.55,
  // Weight ∝ area (d²); rock sits mid-weight between glass and metal.
  sizeToMass: (d: number) => d * d * 0.018,
};

const SHARD_SPAWN_SHAPE_NEBULA = {
  sizeMin: 8, sizeMax: 44,                    // diameter = radius*4 from spawnShards
  polyVerticesMin: 4, polyVerticesMax: 6,
  angleJitter: 0.25, radiusMin: 0.6, radiusRange: 0.55,
  // Near-zero mass: striker impulse drops by ~3 orders of magnitude
  // vs. today's `mass = size` (~8–44).  Combined with linearDamping /
  // angularDamping fields the shard reads as "cloud being shoved
  // aside" without slowing the striker.
  sizeToMass: () => 0.01,
};

// Plastic shards: 4-vertex polygon with mild jitter — distinct
// silhouette from rock (5/7/9) / metal (6/8/10) / glass (3/4 with
// high jitter).  Standard rock/metal-style polygon render via the
// rocky-asteroid branch in RenderSystem.
//
// Damping reverted to default (free-drift): plastic now matches rock /
// glass / metal — no per-step friction, no rest-snap.  PhysicsSystem
// skips the damping path entirely when the four fields are absent.
const SHARD_SPAWN_SHAPE_PLASTIC = {
  sizeMin: 20, sizeMax: 200,
  polyVerticesMin: 4, polyVerticesMax: 4,
  angleJitter: 0.25, radiusMin: 0.65, radiusRange: 0.45,
  // Weight ∝ area (d²); plastic sits between glass (0.010) and
  // rock (0.018), so it shoves glass and is shoved by rock.
  sizeToMass: (d: number) => d * d * 0.013,
};

// Metal shards: 6, 8, or 10 vertices (even counts only).  Low
// jitter + low radius variance for a clean, hex-like or polygon-
// machined silhouette.  Discrete even counts pair with rock's odd
// counts so the two materials read as visually distinct families.
const SHARD_SPAWN_SHAPE_METAL = {
  sizeMin: 20, sizeMax: 120,
  polyVerticesMin: 6, polyVerticesMax: 10,
  polyVerticesOptions: [6, 8, 10],
  angleJitter: 0.20, radiusMin: 0.88, radiusRange: 0.18,
  // Weight ∝ area (d²); metal is the heaviest solid — hardest to shove.
  sizeToMass: (d: number) => d * d * 0.030,
};

// ── Rock aggregation tint floor ─────────────────────────────────────
// Single source of truth for "how dark fully-aggregated rock gets".
// Rock has TWO color-shift systems that must agree so the material reads
// coherently: the rock-TILE neighbour automata (darkens packed cluster
// interiors) and the rock-SHARD density tint (darkens compacted shards).
// Both ramp from base (lone / loose) to this floor (max aggregated), so
// a packed tile interior and a max-density shard reach identical darkness.
// Keep them locked here rather than tuning two separate numbers.
export const ROCK_AGGREGATION_TINT_FLOOR = 0.55;

// ── Nebula → material condensation map ────────────────────────────────
// When two nebula-shards bond and condense into a SOLID shard (the
// non-tile outcome of NebulaSystem.onComposeNebulaShardPair), the blended
// cloud HUE selects which material the dust crystallises into — so the
// nebula's COLOUR, not a fixed flag, spreads the four solid materials
// across the field.  Bands are scanned in order; the first whose upper
// bound the hue falls under wins (lower bound = previous band's hueMax,
// wrapping at 360).  Desaturated greys read as hue 0 → first band.
// Together the bands must cover [0, 360); reorder / resize freely to
// retune which colours yield which material.
//   red / orange   → rock      (warm, mineral)
//   yellow / green  → plastic    (matches plastic's greens + ambers)
//   cyan / blue     → glass      (cool, glassy)
//   indigo / violet → metal      (cold steel sheen)
//   magenta wrap    → rock       (closes the wheel back to red)
// NOTE: rock-origin dust (the `fromRock` flag) bypasses this map and
// always returns to rock — only ambient cloud / glass-dust / enemy-puff
// nebula-shards (which carry real hues) get spread across materials.
// The four solid materials a nebula cloud can crystallise into.
export type NebulaCondenseMaterial = 'rock-shard' | 'glass-shard' | 'plastic-shard' | 'metal-shard';

export const NEBULA_MATERIAL_BANDS: ReadonlyArray<{ hueMax: number; variant: NebulaCondenseMaterial }> = [
  { hueMax: 45,  variant: 'rock-shard'    }, //   0– 45  red → orange
  { hueMax: 160, variant: 'plastic-shard' }, //  45–160  yellow → green
  { hueMax: 255, variant: 'glass-shard'   }, // 160–255  cyan → blue
  { hueMax: 345, variant: 'metal-shard'   }, // 255–345  indigo → violet
  { hueMax: 360, variant: 'rock-shard'    }, // 345–360  magenta wrap → rock
];

// Pick the condensed-shard material for a blended nebula hue (degrees).
export function nebulaHueToShardVariant(hueDeg: number): NebulaCondenseMaterial {
  const h = ((hueDeg % 360) + 360) % 360;
  for (let i = 0; i < NEBULA_MATERIAL_BANDS.length; i++) {
    if (h < NEBULA_MATERIAL_BANDS[i].hueMax) return NEBULA_MATERIAL_BANDS[i].variant;
  }
  return 'rock-shard';
}

// ── Conservation of mass: nebula → material build cost ────────────────
// Crystallising a solid shard out of a nebula cloud isn't free.  A
// condensing cloud must accumulate `units` worth of nebula-shards (base
// shard = 1 unit; coalescing sums the units of both parties) BEFORE it
// can crystallise into the hue's material — until then each bond just
// grows a single bigger nebula-shard.  Cost rises with the material's
// toughness, so a metal or plastic shard takes far more nebula than a
// rock or glass one.  The condensed shard's HP tracks the same scale, so
// what you spend to build it ≈ what it takes to destroy it (conservation
// of energy too).  Rock is the cheapest solid AND crystallises at the
// LOWEST density tier.
//   glass : 2 units (1 pair),  hp  1  — brittle, cheapest
//   rock  : 2 units (1 pair),  hp  3  — lowest density
//   plastic: 4 units (2 pairs), hp  6  — springy, pricier
//   metal : 6 units (3 pairs),  hp 12  — most nebula, toughest
export const NEBULA_CONDENSE: Record<
  'rock-shard' | 'glass-shard' | 'plastic-shard' | 'metal-shard',
  { units: number; hp: number }
> = {
  'glass-shard':   { units: 2, hp: 1 },
  'rock-shard':    { units: 2, hp: 3 },
  'plastic-shard': { units: 4, hp: 6 },
  'metal-shard':   { units: 6, hp: 12 },
};

// Anti-stuck patience: a cloud LOCKS its target material once it starts
// growing (so off-hue bonds can't cheap-crystallise it).  But to avoid an
// expensive target (metal) ballooning forever in a thin field, after this
// many coalescences without reaching the target's cost the cloud
// force-crystallises into its committed material with whatever mass it has.
// Any surplus over the cost is split off as a leftover nebula-shard
// carrying the off-target "remainder" colours (which then seed other
// materials), so mass and colour are conserved.
export const NEBULA_CONDENSE_STALL_BONDS = 6;

export const SHARD_VARIANTS: Readonly<Record<ShardVariantId, ShardVariantDef>> = {
  'glass-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'glass-tile',
    // Re-emits half the light it receives (DBG "Emissive").  Glass is
    // translucent and scatters what passes into it; a pane that simply
    // absorbed every photon reaching it would read as slate.
    emits: 0.5,
    // Glass is drawn as a translucent panel, so a solid umbra behind it
    // contradicts the art.  Roughly half the unified light layer's
    // contribution passes through instead of being withheld — enough that
    // a glass wall reads as glass rather than as rock, and not so much
    // that its shadow stops registering as one.
    transmit: 0.55,
    // Neighbour-count OPACITY automata (DBG "Tile shade"), BIPOLAR
    // around the neutral default: a half-surrounded tile (~3 of 6
    // neighbours) renders at the normal opacity — the MIDDLE of the
    // range — while sparser tiles trend more opaque (clamped at solid)
    // and dense interiors fade see-through (down to 0.45× at a full
    // 6-neighbour ring).  Glass is translucent, so a brightness
    // multiply just muddies the tint; fading reads as real depth.
    // Glass renders through the cached HEX_STRUCTURE sprite, so
    // RenderSystem bakes the alpha into the static-tile cache and
    // re-stamps when the count changes.  saturationOpacity = the
    // most-transparent (interior) endpoint; the opaque endpoint mirrors
    // it about 1.0 (→ 1.55×).
    automata: { maxNeighbors: 6, saturationOpacity: 0.45 },
    // Glass tiles do not respawn at their original hex once
    // shattered.  Fresh glass-tiles only appear via the
    // glass-shard → glass-tile transmute path
    // (ShardSystem.tryTransmuteGlassShardToTile), which is the new
    // canonical glass-tile spawn source after the tier-transition
    // mechanic landed.  Matches plastic / metal / rock / nebula —
    // glass was the last variant on the timer-regen path.
    regen: { kind: 'none' },
    // Light hint-level repel — a soft outward nudge that reads as
    // "the tile is alive" without actually blocking the player.
    // Range ≤ 2 × SPATIAL_GRID_SIZE (240) so the broadphase 5×5
    // outer ring covers it.
    repel: { range: 200, strength: 0.04 },
    // Cyan-200 face + edge-stroke glow paired 1:1 with the repel field
    // — same range, intensity follows the per-tile repelImpulse, which
    // (see PhysicsSystem) accumulates only from the player / enemies so
    // the glow tracks the player's repel field, not passing shards.
    glow:  { color: '#a5f3fc', range: 250, peakAlpha: 0.85 },
  },
  'plastic-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'plastic-tile',
    // TRANSLUCENT, but the DULL end of it.  Plastic is the cloudy material of
    // the three: it passes light and re-emits its own colour like glass does,
    // at roughly half glass's strength, which is what "more opaque" means in
    // the two numbers this system has.  Its colour is per INSTANCE (the
    // plastic palettes), so a field of it emits in its own greens and pinks
    // rather than in one authored tint.
    transmit: 0.28,
    emits: 0.25,
    // Soft light-green proximity glow — the tile FACE brightens as the
    // player passes, drawn by RenderSystem.renderProximityBloom (fill-
    // only radial bloom from the player-facing edge, no edge stroke).
    // Matches the green tile fill so the brighten reads as the tile
    // lighting up rather than a clashing tint.
    glow: { color: '#bbf7d0', range: 250, peakAlpha: 0.33 },
    // Soft denting — each hit pulls the closest hex vertex AND both
    // immediate neighbours inward (pullVertexCount: 3) by up to 30 %
    // of their current radius, uniformly (centerVertexJitterMul: 1).
    // The wide, uniform, deep pull reads as a soft polymer squish —
    // distinct from metal's small sharp single-vertex pinch
    // (vertexJitter 0.13, pullCount 1) and rock's jagged two-notch
    // fracture (centerVertexJitterMul 10).  Over the tile's 8 HP the
    // hex visibly crumples before bursting.  On death it releases a
    // burst of 8–12 plastic-shards (no inheritParentPolygon — shards
    // use the variant's own polygon).  shardHealth: 12 sets the
    // released shards' durability (denting, ~12 hits each),
    // decoupled from the tile's 8-HP face.
    //
    // sizeFraction range 0.44-0.64: chunky shards.  At a ~120-
    // diameter hex tile the burst spawns 8-12 shards in the 53-77
    // diameter range — overlapping the tile footprint so the break
    // reads as the sheet fragmenting into big visible chunks.
    regen: { kind: 'none' },
    dent: {
      vertexJitter: 0.30,
      pullVertexCount: 3,
      centerVertexJitterMul: 1,
      shardHealth: 24,
      breakShards: [
        {
          variant: 'plastic-shard',
          sizeFraction: 0.54,                   // fallback when range fields unset
          sizeFractionMin: 0.44,
          sizeFractionMax: 0.64,
          countMin: 8,
          countMax: 12,
        },
      ],
    },
  },
  'metal-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'metal-tile',
    // Re-emits half the light it receives (DBG "Emissive").  Metal is the
    // specular case: it does not scatter light so much as throw it back,
    // and a matte plate is the one thing it should never look like.
    emits: 0.5,
    // Metal brightness is driven by densityTier (shard layers), NOT this
    // automata — see metalDensityBrightness.  The automata block is kept
    // only as the marker that makes recomputeMaterialNeighbors count a
    // metal tile's same-variant hex neighbours; ShardSystem converts that
    // count into the tile's initial densityTier at load (denser natural
    // clusters → higher tier → lighter + tougher).  No saturationBrightness:
    // the render path bypasses the automata factor for metal entirely.
    automata: { maxNeighbors: 6 },
    // Heavy repel — 1.5× glass strength.  Reads as a real shove
    // when the player approaches; the field is the warning.  Range
    // matches glass so dense mixed clusters present a single
    // coherent "stay-back" footprint rather than two nested shells.
    repel: { range: 200, strength: 0.06 },
    // Purple-pink (fuchsia) glow — a vivid "live field" against the
    // slate-gray metal face, distinct from glass-tile's pale cyan
    // (`#a5f3fc`) and plastic-tile's green so the materials never
    // confuse at a glance.  Renders as a fill + thin edge stroke driven
    // by `entity.repelImpulse` (RenderSystem material-tile branch).
    glow:  { color: '#d946ef', range: 250, peakAlpha: 0.75 },
    // Metal deforms subtly — each closest-to-impact vertex pulled
    // inward by up to 13 % per hit.  Same 24-hit lifetime as plastic
    // but the surface reads as harder via the smaller per-hit warp;
    // on detach it releases a single shard matching the deformed
    // tile's silhouette exactly (see breakShards below).
    regen: { kind: 'none' },
    dent: {
      vertexJitter: 0.13,
      // On detach the tile breaks into 5-6 equilateral triangle shards
      // (each 1/6 of a hex tile, side = HEX_SIZE) ejected at BREAK_SPEED_MULT ×
      // the normal dent-debris speed.  They keep metal-shard health and
      // assemble into a fresh hexagon (see ShardSystem.tickMetalAssembly).
      breakShards: [
        { variant: 'metal-shard', sizeFraction: 1.0, equilateralTriangle: true, countMin: 5, countMax: 6 },
      ],
    },
  },
  'indestructible-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'indestructible-tile',
    // Glass-like: the deep violet reads as a solid crystal, and a crystal
    // that stopped every photon would be indistinguishable from rock.  A
    // shade under glass on both counts, because it is the denser-looking
    // material of the two.
    transmit: 0.5,
    emits: 0.45,
    // Deep-purple proximity lighting (fill-only radial bloom, no edge
    // stroke).  Reads as the "void" tile — the unbreakable face of
    // the map — distinct from glass's cyan and rock's orange.
    glow:    { color: '#4c1d95', range: 250, peakAlpha: 0.75 },
    regen:   { kind: 'none' },
    shatter: {
      kind: 'powerlaw',
      style: 'asteroid',
      countMin: 0, countMax: 0,
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'glass-shard',
      forwardDrag: 0.0, perpScatter: 0.0,
      scatterHalfCone: Math.PI,
    },
    spawnsDropsOnDeath: false,
  },
  'rock-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'rock-tile',
    // Neighbour-count brightness automata (DBG "Tile shade").  Rock
    // DARKENS dense interiors (saturationBrightness < 1, the nebula
    // rule) so the centre of a slab recedes into shadow and the broken
    // edges catch the light — reinforcing the brittle-stone read.
    // Saturates at the full 6-neighbour hex ring.  Note: the automata
    // re-stamps only on neighbour-count change (tile destroy), so it
    // does NOT reintroduce the every-frame cache churn that motivated
    // rock-tile's no-glow decision.
    // Aligned with rock-shard density: both darken toward the shared
    // ROCK_AGGREGATION_TINT_FLOOR as the rock gets more aggregated
    // (tile = neighbour count, shard = density tier).
    automata: { maxNeighbors: 6, saturationBrightness: ROCK_AGGREGATION_TINT_FLOOR },
    // Rock-tile has no proximity glow — the brittle slate fill reads
    // cleanly without a warming halo, and removing the glow lets the
    // static-tile world canvas keep the tile cached even when the
    // player is nearby (no fast↔slow transition churn).
    // Rock-tile uses the 'pull' dent kind (default) with
    // pullVertexCount = 3: each hit pulls the closest vertex AND
    // both immediate neighbours inward, each by its own random
    // jitter.  The wider 3-vertex pull creates multiple inverted
    // angles along one side of the polygon per hit, reading as
    // fractured stone rather than a single dimple.  No per-hit
    // shard release (unlike the previous triangle-delete approach);
    // the freed material accumulates and is delivered on the
    // killing hit via breakShards.  No regen.  Shatter stays
    // kind='none' so ShardSystem.shatter doesn't double-spawn on
    // top of dent's breakShards (GameEngine.handleEntityDeath skips
    // shatter for any dent variant).
    regen: { kind: 'none' },
    shatter: {
      kind: 'none',
      style: 'asteroid',
      countMin: 0, countMax: 0,
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'rock-shard',
      forwardDrag: 0, perpScatter: 0,
      scatterHalfCone: 0,
    },
    dent: {
      // GENTLE dent now that the seeded crack overlay carries the per-hit
      // damage read (see MATERIAL_DAMAGE_CRACKS / ROCK_BREAK).  The old
      // settings (jitter 0.20 × mul 10, two vertices pulled to the 5 %
      // K_MIN floor, plus a chunky per-hit chip) caved the hex in and
      // flung a ~30 px shard off on the FIRST hit — so a 4-HP tile *looked*
      // destroyed after one shot.  Now one vertex takes a shallow pull and
      // the silhouette only erodes slightly across its 4-hit life; the
      // cracks do the talking, and the tile shatters via breakShards on the
      // killing hit.
      vertexJitter: 0.06,
      centerVertexJitterMul: 2.0,
      pullVertexCount: 2,
      deepVertexCount: 1,
      // No per-hit chip — the crack overlay is the per-hit feedback now, and
      // a chunk flying off every shot read as the tile breaking.  Freed
      // material is delivered on the killing hit via breakShards.
      // Final break: 3 rock-shards at sizeFraction 0.75 each (linear
      // fraction of deformed diameter).  Sum of squares = 1.69 so
      // the freed material exceeds the deformed area — visually
      // chunkier fragments at the cost of some "material creation,"
      // which the user prefers over the previous area-conservative
      // 3 × 0.577 split where each shard read as undersized.
      breakShards: [
        { variant: 'rock-shard', sizeFraction: 0.75 },
        { variant: 'rock-shard', sizeFraction: 0.75 },
        { variant: 'rock-shard', sizeFraction: 0.75 },
      ],
    },
  },
  'nebula-tile': {
    id: 'nebula-tile',
    // Re-emits half the light it receives (DBG "Emissive"), in its OWN
    // colour — a nebula is a glowing cloud, and the one material in the game
    // whose colour is per-BODY rather than per-variant (`nebulaBlendedHex`,
    // blended from its composition).  It is also the one emitter that is
    // `passThrough`: it casts no shadow and never enters the occluder pool,
    // so emission had to stop being a by-product of being a shadow caster
    // (see the emitter buffer in render/lighting.ts).
    emits: 0.5,
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_NEBULA,
    regen: {
      kind: NEBULA_CONSTANTS.TILE_REGEN_ENABLED ? 'timer' : 'none',
      delaySeconds: NEBULA_CONSTANTS.REGEN_DELAY,
      // Nebulae fade in instead of pop-burst.
      rewriteColor: 'neighborhood-blend',
    },
    merge: {
      // Tiles are immutable sinks: shards merge INTO tiles via shard→tile
      // transmutation, not the other way around.
      attractedTo: 'none', bondsWith: 'none',
      defaultOutcome: 'compose',
    },
    shatter: {
      kind: 'powerlaw',
      style: 'nebula',
      countMin: 2, countMax: 3,                 // count = 2 + floor(rand*2)
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'nebula-shard',
      forwardDrag: NEBULA_CONSTANTS.FORWARD_DRAG_FACTOR,
      perpScatter: NEBULA_CONSTANTS.PERP_SCATTER_FACTOR,
      scatterHalfCone: NEBULA_CONSTANTS.FAN_HALF_ANGLE,
      fadeInSeconds: NEBULA_CONSTANTS.FADE_IN_DURATION,
      postShatterMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN,
    },
    // Mass = ∞ alone makes the tile a solid wall.  passThrough lets
    // strikers fly through and shatter on contact while the tile
    // keeps its static-grid placement.  See docs/SHARD_SYSTEM.md §6.C.
    passThrough: true,
    // Slow-path tint compute is expensive enough to merit caching.
    renderCache: 'composition',
    spawnsDropsOnDeath: false,                  // NebulaSystem handles its own salvage roll
  },
  'rock-shard': {
    id: 'rock-shard',
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_ROCK,
    regen: { kind: 'none' },
    merge: {
      attractedTo: 'none',                      // contact-stick only
      bondsWith: 'self',                        // same-material only
      bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
      defaultOutcome: 'compose',
    },
    shatter: {
      kind: 'powerlaw',
      style: 'asteroid',
      // countMax lowered 5 → 3: an asteroid break yields 2–3 chunky
      // mass-conserving pieces instead of a 2–5 spray, so the field
      // doesn't flood with chips when a cluster is shot apart.
      countMin: 2, countMax: 3,
      alphaMin: 0.4, alphaMax: 2.0,
      childVariant: 'rock-shard',
      // forwardDrag lowered 0.35 → 0.12: shards inherit far less of the
      // impactor's speed so an asteroid breaks into a gentle outward spread
      // rather than rocketing the pieces away (a blaster shot at speed 16
      // used to fling shards at ~6.6; now ~2).  The scatter is also hard-
      // capped in shatterAsteroidStyle so a fast weapon can't blow it up.
      forwardDrag: 0.12, perpScatter: 0.0,
      scatterHalfCone: Math.PI * 0.55,
    },
    onShatterParticles: { color: '#94a3b8', count: 5 },
    passThrough: false,
    spawnsDropsOnDeath: true,
    // Density compaction: rocks are the canonical "many small chunks"
    // family, so 4 tiers of darkening with an aggressive shrink let a
    // packed cluster condense into a few dark, dense fragments instead
    // of a single oversized rock.  largeShardCollapseSize=130 catches
    // map-spawned giants (sizeMax=160) and trims them on first tick.
    density: {
      enabled: true,
      maxSteps: 4,
      areaThreshold: 32 * 32, // ~MIN_SIZE² × 2.5 — micro chips stay separate
      largeShardCollapseSize: 130,
      // Shared with the rock-tile automata so tile-interior and dense-shard
      // darkness match (see ROCK_AGGREGATION_TINT_FLOOR).
      tintFloor: ROCK_AGGREGATION_TINT_FLOOR,
      shrinkFactor: 0.88,
    },
  },
  'glass-shard': {
    id: 'glass-shard',
    carrier: EntityType.STRUCTURE,
    emits: 0.5,                               // as the tile it broke off
    // Same translucency as the tile it broke off — see 'glass-tile'.
    transmit: 0.55,
    spawn: GLASS_SHARD_SPAWN_SHAPE,
    regen: { kind: 'none' },
    merge: {
      attractedTo: 'none',
      bondsWith: 'self',                        // same-material only
      bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
      defaultOutcome: 'compose',
    },
    shatter: {
      kind: 'powerlaw',
      style: 'asteroid',
      countMin: 2, countMax: 5,
      alphaMin: 0.4, alphaMax: 2.0,
      childVariant: 'glass-shard',
      forwardDrag: 0.35, perpScatter: 0.0,
      scatterHalfCone: Math.PI * 0.55,
    },
    onShatterParticles: 'inherit',
    passThrough: false,
    // Glass shards are the same substance as their parent tile —
    // they drift through the glass-tile repel field unimpeded.
    repelImmune: true,
    spawnsDropsOnDeath: true,
    // Density compaction: glass shards already render with a soft
    // translucent tint, so the floor stays at 0.55 (matches rock).
    // Glass tiles spawn shards in a power-law area distribution
    // (DropSystem.spawnGlassShards), so most live below the
    // largeShardCollapseSize and only the rare big chunk collapses.
    density: {
      enabled: true,
      maxSteps: 4,
      areaThreshold: 32 * 32,
      largeShardCollapseSize: 130,
      tintFloor: 0.55,
      shrinkFactor: 0.88,
    },
  },
  'plastic-shard': {
    id: 'plastic-shard',
    // Same as the tile it broke off — see plastic-tile.
    transmit: 0.28,
    emits: 0.25,
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_PLASTIC,
    regen: { kind: 'none' },
    // Cohesion-only cross-material bonds + self-compose growth.
    // Plastic-shards stick to every variant EXCEPT nebula-tile /
    // nebula-shard.  Cross-material partners (glass / rock / metal /
    // indestructible, tiles + shards, plus plastic-tile) are marked
    // cohesionOnly so the bond timer never fires compose — plastic
    // grips foreign material firmly but never absorbs it.  Strong tier
    // means a much faster cohesion lock + much longer break distance
    // (see STRONG_* in ShardSystem).  plastic-shard ↔ plastic-shard
    // is intentionally absent: the bond falls through to defaultOutcome
    // 'compose', which routes through composeEntities' isPlasticSelfMerge
    // branch — area-conserving growth, no size cap, no tile transmute
    // (per user direction).  attractedTo + pull* drive a heavy 1/dist
    // gravity toward every non-nebula shard (mirror of bondsWith), so
    // plastic actively SEEKS contact with neighbouring material
    // instead of relying on stray drift to trigger bond formation.
    // The spatial hash never holds static tiles, so the `nebula-tile`
    // entry in the exclude list is defensive only — the pull pass
    // wouldn't see tiles regardless.
    // pullInnerRange 80 turns the gravity OFF inside ~contact distance
    // for typical plastic-shard sizes (20-200 dia) so bond cohesion
    // takes over cleanly at close range instead of fighting the pull.
    // Outside 80px the pull seeks the nearest qualifying neighbour
    // (no size or completed-hexagon filter — those were metal-
    // specific and have been dropped from the generic pull pass).
    merge: {
      attractedTo: { exclude: ['nebula-tile', 'nebula-shard'] },
      pullRange:    300,
      pullInnerRange: 80,
      pullStrength: 500,
      pullMinDist:  15,
      bondsWith: { exclude: ['nebula-tile', 'nebula-shard'] },
      bondTimeSeconds: 10,
      bondTimeSizeRef: 20,
      bondTimeSizePower: 1.5,
      bondPartners: [
        { partner: 'glass-tile',          cohesionOnly: true, strength: 'strong'  },
        { partner: 'glass-shard',         cohesionOnly: true, strength: 'strong'  },
        { partner: 'rock-tile',           cohesionOnly: true, strength: 'strong'  },
        { partner: 'rock-shard',          cohesionOnly: true, strength: 'strong'  },
        { partner: 'metal-tile',          cohesionOnly: true, strength: 'strong'  },
        { partner: 'metal-shard',         cohesionOnly: true, strength: 'strong'  },
        { partner: 'indestructible-tile', cohesionOnly: true, strength: 'strong'  },
        { partner: 'plastic-tile',        cohesionOnly: true, strength: 'default' },
      ],
      defaultOutcome: 'compose',
    },
    // Plastic-shards take the standard rock/metal-style shatter on
    // death.  No per-size count override and no fractional child
    // sizing — the asteroid power-law over parent area + MIN_SIZE
    // floor terminates the recursion naturally.
    shatter: {
      kind: 'powerlaw',
      style: 'asteroid',
      countMin: 2, countMax: 5,
      alphaMin: 1.0, alphaMax: 1.6,
      childVariant: 'plastic-shard',
      forwardDrag: 0.0, perpScatter: 0.0,
      scatterHalfCone: Math.PI,
    },
    onShatterParticles: 'inherit',
    passThrough: false,
    // Plastic shards drift through the plastic-tile repel field
    // (plastic-tiles don't emit a field today, but the immunity is
    // declared symmetrically with glass / metal).
    repelImmune: true,
    spawnsDropsOnDeath: true,
    // Density compaction disabled — plastic-shards stay individually
    // visible.  The cohesion-only bonds above hold the cluster
    // together without any compose path.
    density: {
      enabled: false,
      maxSteps: 0,
      areaThreshold: 0,
      largeShardCollapseSize: 99999,
      tintFloor: 1.0,
      shrinkFactor: 1.0,
    },
    // Soft denting — same character as plastic-tile (deep, uniform
    // pull) but two vertices per hit so the dent matches the tile's
    // "half the polygon deforms" feel without collapsing the 4-gon
    // (pullVertexCount: 3 on a 4-gon would leave a single anchor
    // vertex and pinch the shard to a sliver).  vertexJitter 0.30
    // pushes corners in by up to 30 % each hit.  preserveBounding
    // Radius scales the polygon back after the pull so the bounding
    // circle holds at the spawn extent — the shard reads as
    // "squished" rather than "smaller" as hits accumulate, and the
    // per-dent snap-back pass (ShardSystem.tickPlasticDentRecovery)
    // subtracts each dent's stored delta from polygonPoints when
    // its individual timer expires.  Each hit costs 1 HP (isDentEntity
    // contract) and gives the free-floating shard a small velocity
    // kick (PhysicsSystem).  breakShards is EMPTY so the variant's
    // `shatter` policy still fires on death (GameEngine.handleEntity
    // Death routes empty-breakShards dent entities to ShardSystem
    // .shatter) — the shard fragments into smaller plastic-shards.
    dent: {
      vertexJitter: 0.30,
      pullVertexCount: 2,
      preserveBoundingRadius: true,
      breakShards: [],
    },
  },
  'metal-shard': {
    id: 'metal-shard',
    carrier: EntityType.STRUCTURE,
    emits: 0.5,                               // as the tile it broke off
    spawn: SHARD_SPAWN_SHAPE_METAL,
    regen: { kind: 'none' },
    merge: {
      // Metal triangles assemble into RIGID COMPOSITES (see
      // ShardSystem.tickMetalAssembly), not soft cohesion bonds — so
      // bondsWith is 'none' here and the assembly pass owns all metal-
      // metal locking.  A gentle short-range pull still draws loose
      // triangles toward each other / toward existing composites so they
      // reach snapping range.
      attractedTo: { include: ['metal-shard'] },
      pullRange: 140, pullStrength: 120, pullMinDist: 12,
      bondsWith: 'none',
      // Unreachable while bondsWith is 'none' — no bond ever forms, so no
      // outcome is ever resolved.  Present because the schema requires it,
      // and 'compose' is what metal WOULD do if the assembly pass ever
      // handed the close-range case back to bonds.
      defaultOutcome: 'compose',
    },
    // Metal shards are dent-driven: deform per hit, destroyed cleanly
    // on health = 0 with drops + particles.  No recursive sub-shards.
    shatter: {
      kind: 'none',
      style: 'asteroid',
      countMin: 0, countMax: 0,
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'metal-shard',
      forwardDrag: 0, perpScatter: 0,
      scatterHalfCone: 0,
    },
    // Cool slate particle puff matches the gunmetal body colour.
    onShatterParticles: { color: '#cbd5e1', count: 5 },
    passThrough: false,
    // Metal shards feel the metal-tile repel field (priming g3
    // attraction work where metal-shards orbit metal clusters) but
    // ignore glass-tile fields — metal "wins" against glass.
    // Without this immunity the glass-tile repel field would push
    // the metal-shard away before contact ever happens, defeating
    // the passthroughShatter rule below.  Glass-shard / plastic-
    // shard stay fully `repelImmune` (their own family is the only
    // field they'd care about, and they pass through it).
    repelImmuneFrom: ['glass-tile'],
    // g3 material-interactions: metal-shards pass through glass-
    // tiles and glass-shards with zero impulse and instantly
    // shatter them on overlap.  The metal-shard's HP and trajectory
    // are unaffected; the glass target falls through its normal
    // death pipeline (glass-tile → DropSystem.spawnGlassShards,
    // glass-shard → ShardSystem.shatter tier chain).
    passthroughShatter: { targets: ['glass-tile', 'glass-shard'] },
    spawnsDropsOnDeath: true,
    density: {
      enabled: true,
      maxSteps: 4,
      areaThreshold: 32 * 32,
      largeShardCollapseSize: 130,
      // NOTE: this darkening tintFloor is INERT for colour — loose metal
      // shards never go through densityTintForRender's tint (they render at
      // base), and composites/tiles brighten by density TIER via
      // metalDensityBrightness, not this table.  The block is kept only for
      // the non-colour fields below (largeShardCollapseSize / shrinkFactor).
      tintFloor: 0.50,
      shrinkFactor: 0.88,
    },
    // Metal shards deform subtly per hit (vertexJitter 0.10 vs
    // tile's 0.13) — the surface still reads as hard even after
    // detaching from the grid.  Empty breakShards: clean destruction
    // on health = 0.
    dent: {
      vertexJitter: 0.10,
      breakShards: [],
    },
  },
  'nebula-shard': {
    id: 'nebula-shard',
    // Same as the tile it broke off, and for the same reason: a shard of a
    // glowing cloud is still glowing cloud.
    emits: 0.5,
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_NEBULA,
    regen: { kind: 'merge-only' },              // tiles regrow only via transmutation
    merge: {
      // Same-material only: nebula-shards pull toward and bond with
      // other nebula-shards exclusively.  Pull is the self-coalesce
      // gravity; bonds drive the pair-transmute self-merge below.
      attractedTo: 'self',
      pullRange:    NEBULA_CONSTANTS.GRAVITY_RANGE,
      pullStrength: NEBULA_CONSTANTS.GRAVITY_STRENGTH,
      pullMinDist:  NEBULA_CONSTANTS.GRAVITY_MIN_DIST,
      // Stick-bonds: nebula self-coalesce runs on the standard
      // bondsWith pipeline (5 s contact timer; per-pair, pair-
      // consuming).
      bondsWith: 'self',
      // Base bond time — multiplied by (avgSize / bondTimeSizeRef)
      // ^bondTimeSizePower per the resolver.  At ref-size shards
      // (≈20 diameter) the effective threshold ≈ 5 s; larger pairs
      // wait proportionally longer.  Self-bonds fire the dedicated
      // pair-transmute path in ShardSystem.composeNebulaShards
      // (50/50 nebula-tile vs glass-shard at the pair's midpoint),
      // variant-routed inside composeEntities.
      bondTimeSeconds: 5,
      bondTimeSizeRef: 20,
      bondTimeSizePower: 1.5,
      defaultOutcome: 'compose',
      postMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN,
    },
    // No-op shatter: nebula-shards are indestructible from the
    // player's perspective.  They glide past the ship under the
    // applyNebulaPlayerPull gravity field; contact does not destroy
    // them.  They still merge / transmute into nebula-tiles through
    // the standard ShardSystem self-coalesce path above.
    shatter: { kind: 'none', countMin: 0, countMax: 0, alphaMin: 1, alphaMax: 1, childVariant: 'nebula-shard', forwardDrag: 0, perpScatter: 0, scatterHalfCone: 0 },
    // passThrough = true so shard-vs-shard and shard-vs-striker
    // contacts skip collision impulse entirely.  Mass = 0.01 alone
    // would let strikers pass with negligible impulse, but
    // shard-vs-shard pairs (both low-mass) would bounce apart
    // elastically — breaking the gravity-pull-then-merge cycle.
    // The flag is the cleanest fix and matches today's "shards are
    // INDESTRUCTIBLE — they pass through unchanged" behaviour.
    passThrough: true,
    // Nebula shards interact ONLY with other nebula entities, so they ignore
    // the metal-tile / glass-tile repel fields too (those would otherwise
    // shove a passing nebula shard — the one cross-family push that bypasses
    // passThrough).
    repelImmune: true,
    spawnsDropsOnDeath: false,
    // Density compaction: nebula shards already grow toward
    // transmutation (HEX_AREA accumulation).  Density layers a
    // visual signal — successive merges darken the cloud — without
    // touching the existing area-based tile transmutation, which is
    // gated on `nebulaTileArea`, not size or tier.  Lower maxSteps
    // (3) since most shards transmute well before reaching the cap;
    // gentler shrinkFactor (0.92) preserves the cloud-style growth
    // feel while still trimming the merged shard slightly so it
    // reads as compaction.  areaThreshold=0 keeps every nebula
    // merge eligible — transmutation depends on it.
    density: {
      enabled: true,
      maxSteps: 3,
      areaThreshold: 0,
      largeShardCollapseSize: 110,
      tintFloor: 0.55,
      shrinkFactor: 0.92,
    },
  },
};

// ── Per-map entity-count table ──────────────────────────────────────
// Source of truth for "how many of variant X spawn on map Y", see
// docs/SHARD_SYSTEM.md §6.E.  Source of truth for rock-shard
// free-spawn counts (read via getRockShardFreeSpawn) and per-map
// tile-cluster sizing (read by MapClasses.populate).  Replaces
// the legacy ASTEROID_GENERATION_CONFIG + NEBULA_CONSTANTS.CLUSTER_*
// fields, both deleted in Stage 7.

export const MAP_POPULATION: Record<MapType, Partial<Record<ShardVariantId, PerMapVariantSpawn>>> = {
  // Overworld (wave-free home map, 12k) — standard mixed terrain, read
  // directly from this table by OverworldMap.init().  Since G7 every
  // natural map reads its tile-variant mix from here; the table is the
  // authority rather than a parallel description of one.
  [MapType.OVERWORLD]: {
    'rock-shard': { freeSpawn: { count: 120, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 5000 } },
    'glass-tile':   { tileCluster: { clusterCount: 10, minClusterSize: 10, maxClusterSize: 30 } },
    'plastic-tile': { tileCluster: { clusterCount:  4, minClusterSize:  8, maxClusterSize: 20 } },
    'metal-tile':   { tileCluster: { clusterCount:  3, minClusterSize:  6, maxClusterSize: 14 } },
    'nebula-tile':  { tileCluster: { clusterCount: 42, minClusterSize: 12, maxClusterSize: 36 } },
  },
  // Deep Space (16k arena).  These counts are what UniverseMap.init HAS
  // been generating; before G7 the class hardcoded them and this entry
  // said something else entirely (glass 14 / nebula 65+120), so the table
  // documented a map that had not existed for a long time.  The numbers
  // moved here unchanged — G7 was a data move, not a rebalance.
  [MapType.UNIVERSE]: {
    'rock-shard': { freeSpawn: { count: 140, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 6000 } },
    // The old 42-cluster budget split 64 / 23 / 13 glass / plastic / metal.
    // Written out as counts, because a percentage split of a budget is a
    // second thing to keep in sync and the counts are what get generated.
    'glass-tile':          { tileCluster: { clusterCount: 27, minClusterSize: 10, maxClusterSize: 34 } },
    'plastic-tile':        { tileCluster: { clusterCount: 10, minClusterSize:  8, maxClusterSize: 22 } },
    'metal-tile':          { tileCluster: { clusterCount:  5, minClusterSize:  6, maxClusterSize: 14 } },
    // indestructible-tile intentionally absent — per decision #6,
    // reserved for deliberate border/structure placement, not random
    // clusters in the natural maps.  INDESTRUCTIBLE_FIELD showcase
    // still spawns it for stress testing.
    //
    // The inner/outer split is gone rather than moved: UniverseMap stopped
    // applying it long ago (its own comment records why — on smaller maps
    // it visibly concentrated clusters in the centre) and merely AVERAGED
    // the two size ranges into one pass.  Carrying a field no code reads is
    // how the entry above came to be wrong in the first place.
    'nebula-tile': {
      tileCluster: { clusterCount: 75, minClusterSize: 11, maxClusterSize: 34 },
    },
  },
  [MapType.RING]: {
    'rock-shard': { freeSpawn: { count: 280, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 5000 } },
  },
  // Seven Rings (12k arena).  A ring map's tile-variant "ratio" is WHICH
  // RING is made of what, so it is expressed as ring indices rather than
  // cluster counts — inner rings soft, outer wall indestructible, which is
  // the map's whole readable-difficulty idea.  The ring GEOMETRY (count,
  // radii, thinning) stays in SevenRingsMap: that is the map's shape.
  // indestructible-tile appears here and nowhere else in the natural maps,
  // which is exactly what decision #6 reserves it for — deliberate border
  // placement, never a random cluster.
  [MapType.SEVEN_RINGS]: {
    'rock-shard': { freeSpawn: { count: 280, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 5000 } },
    'glass-tile':          { tileRings: [0, 1] },
    'plastic-tile':        { tileRings: [2, 3] },
    'metal-tile':          { tileRings: [4, 5] },
    'indestructible-tile': { tileRings: [6] },
  },
  // Pocket sandbox (4k).  The cluster COUNTS here already matched what
  // PocketMap.init hardcoded; only the nebula SIZE range disagreed (the
  // class generates 6–12, this said 6–20), so the table is corrected to
  // the map that exists.
  [MapType.POCKET]: {
    'rock-shard': { freeSpawn: { count: 1, minSize: 20, maxSize: 80, speedMultiplier: 1.5, spawnRadius: 1600 } },
    'glass-tile':          { tileCluster: { clusterCount: 8, minClusterSize: 6, maxClusterSize: 14 } },
    'plastic-tile':        { tileCluster: { clusterCount: 5, minClusterSize: 5, maxClusterSize: 10 } },
    'metal-tile':          { tileCluster: { clusterCount: 3, minClusterSize: 4, maxClusterSize:  8 } },
    // indestructible-tile intentionally absent — see UNIVERSE entry
    // above for the decision-#6 rationale.
    'nebula-tile': {
      tileCluster: { clusterCount: 12, minClusterSize: 6, maxClusterSize: 12 },
    },
  },
  [MapType.ASTEROID_FIELD]: {
    'rock-shard': { freeSpawn: { count: 1200, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 2500 } },
  },
  [MapType.GLASS_FIELD]: {
    'glass-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.PLASTIC_FIELD]: {
    'plastic-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.METAL_FIELD]: {
    'metal-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.INDESTRUCTIBLE_FIELD]: {
    'indestructible-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.NEBULA_FIELD]: {
    'nebula-tile': {
      tileCluster: { clusterCount: 65, minClusterSize: 14, maxClusterSize: 42 },
    },
  },
  [MapType.ROCK_FIELD]: {
    'rock-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  // Tile-heavy stress map — `TileHeavyMap.init()` populates the map
  // directly with hardcoded counts (it doesn't read MAP_POPULATION),
  // so this entry only exists to satisfy the Record<MapType, …> shape.
  [MapType.TILE_HEAVY]: {},
};

/**
 * Helper: read the rock-shard freeSpawn config for a map type.
 * Returns the MAP_POPULATION values; falls back to defaults for
 * maps that don't free-spawn rock-shards (e.g. tile-only showcases)
 * so the respawn-loop's count/size arithmetic doesn't blow up on
 * undefined.  Shape mirrors the legacy ASTEROID_GENERATION_CONFIG
 * record so call sites read like simple field accesses.
 */
export function getRockShardFreeSpawn(mapType: MapType): {
  count: number;
  minSize: number;
  maxSize: number;
  radius: number;
  speedMultiplier: number;
} {
  const cfg = MAP_POPULATION[mapType]?.['rock-shard']?.freeSpawn;
  return {
    count:           cfg?.count           ?? 0,
    minSize:         cfg?.minSize         ?? 20,
    maxSize:         cfg?.maxSize         ?? 160,
    radius:          cfg?.spawnRadius     ?? 2500,
    speedMultiplier: cfg?.speedMultiplier ?? 1.5,
  };
}
