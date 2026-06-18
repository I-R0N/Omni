

import { WeaponConfig, WeaponType, MapType, EnemySubtype, EnemyRole, EntityType, EffectPayload, EnemyShape } from './types';
import {
  ShardVariantId,
  ShardVariantDef,
  PerMapVariantSpawn,
} from './engine/systems/ShardSystem.types';
import { ASSETS } from './assets';

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

export function getActiveMetalGlowBrightness(): number {
  return MATERIAL_GLOW_BRIGHTNESS_CYCLE[activeMetalGlowBrightnessIndex];
}
export function getActiveMetalGlowBrightnessName(): string {
  return `${getActiveMetalGlowBrightness()}x`;
}
export function cycleMetalGlowBrightness(): number {
  activeMetalGlowBrightnessIndex =
    (activeMetalGlowBrightnessIndex + 1) % MATERIAL_GLOW_BRIGHTNESS_CYCLE.length;
  return activeMetalGlowBrightnessIndex;
}

// ── Glass-tile glow colour cycle (DBG-only) ─────────────────────────
// The default is the cool cyan baked into SHARD_VARIANTS['glass-tile']
// .glow.color (#a5f3fc); the cycle adds warm + diverse families so we
// can A/B the look.  RenderSystem reads the active hex through
// getActiveGlassGlowColor() (range + peakAlpha stay with the variant).
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

let activeGlassGlowIndex = 8; // default 'sky' — covers glass-tile glow + glass dust

export function getActiveGlassGlowColor(): string {
  return GLASS_GLOW_COLORS[activeGlassGlowIndex].hex;
}
export function getActiveGlassGlowColorName(): string {
  return GLASS_GLOW_COLORS[activeGlassGlowIndex].name;
}
export function cycleGlassGlowColor(): number {
  activeGlassGlowIndex = (activeGlassGlowIndex + 1) % GLASS_GLOW_COLORS.length;
  return activeGlassGlowIndex;
}

// ── Metal-tile glow colour cycle (DBG-only) ─────────────────────────
// Independent cycle through the SAME GLASS_GLOW_COLORS list — reuses
// the palette so the two tile glows can be A/B'd against a shared
// vocabulary.  Default index 4 = 'magenta' (#e879f9), the closest
// match to the legacy fuchsia `#d946ef` baked into SHARD_VARIANTS
// ['metal-tile'].glow.color.  RenderSystem reads the live hex via
// getActiveMetalGlowColor() in the metal-tile glow branch.
let activeMetalGlowIndex = 4; // 'magenta' — matches legacy fuchsia

export function getActiveMetalGlowColor(): string {
  return GLASS_GLOW_COLORS[activeMetalGlowIndex].hex;
}
export function getActiveMetalGlowColorName(): string {
  return GLASS_GLOW_COLORS[activeMetalGlowIndex].name;
}
export function cycleMetalGlowColor(): number {
  activeMetalGlowIndex = (activeMetalGlowIndex + 1) % GLASS_GLOW_COLORS.length;
  return activeMetalGlowIndex;
}

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
// same math at their fixed mass = 5, so all ammo drops cruise
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
  ENEMY_ROTATION_OFFSET: Math.PI*(3/4), // Match player art orientation
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
    CAP_MULTIPLIER: 1.5 // Multiplier for velocity-based shake
  }
};

export const UI_CONSTANTS = {
  HEALTH_BAR: {
    PLAYER_WIDTH: 44, PLAYER_HEIGHT: 5,
    ENEMY_WIDTH: 22, ENEMY_HEIGHT: 3,
    OFFSET_MODIFIER: 0.85, // Multiplier of entity size
    OFFSET_BASE: 10 // Pixel padding
  },
  INDICATORS: {
    RADIUS: 120, // Distance from center of screen
    TEXT_THRESHOLD_ENEMY: 250000, // Distance sq to show text
    TEXT_THRESHOLD_POI: 160000,
    MAX_VISIBLE: 5, // Max arrows for POIs
    // Enemy chevrons are range-unlimited (maps are big and live wave
    // enemies are capped at TIMED_WAVE_CONFIG.MAX_CONCURRENT_ENEMIES),
    // so every live enemy is always findable.  The cap here only guards
    // pathological counts; alpha fades with distance to a floor so far
    // chevrons read as "out there" without shouting.
    MAX_VISIBLE_ENEMY: 12,
    ENEMY_FADE_START: 800,   // world units — full opacity inside this
    ENEMY_FADE_END: 4000,    // world units — alpha floor from here out
    ENEMY_MIN_ALPHA: 0.35,
  }
};

export const AMMO_HUD_CONSTANTS = {
  SLOT_W_MAX:    36,   // shrunk post-d1 — per-slot ammo number moved to a dedicated box
  SLOT_W_MIN:    22,
  SLOT_H:        48,
  SLOT_GAP:      4,
  // Wider gap separating the always-firable blaster from the rest of the
  // bar.  The ammo readout + ammo-gated weapons sit on the right, glued
  // together by the regular SLOT_GAP, so the ammo box reads as belonging
  // to the weapon group rather than floating between two halves.
  SLOT_SEP:      14,
  SLOT_RADIUS:   5,
  BOTTOM_MARGIN: 14,
};

export const MINIMAP_CONSTANTS = {
  SIZE: 75,            // Smaller Default
  EXPANDED_SIZE: 280,  // Larger when touched
  MARGIN: 20,          // Distance from screen edge
  ZOOM_RANGE: 1000,    // World units radius shown in small (zoomed-in) minimap
  RANGE: 8000,         // World units radius shown in expanded (overview) map
  BG_COLOR: 'rgba(15, 23, 42, 0.85)',
  BORDER_COLOR: 'rgba(56, 189, 248, 0.4)',
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
};

export const INPUT_CONSTANTS = {
  // Charge-to-fire model (post-d2): tap (release before CHARGE_FULL) =
  // normal shot via fireEvents; hold for the full CHARGE_FULL duration
  // and release = charged shot via chargeReleaseEvents.  The ring HUD
  // fills 0 → 1 over the same window so the player only sees a charged
  // shot land when the ring is visibly complete.  Same TAP_DISTANCE_LIMIT
  // applies to the tap path — dragging the cursor cancels a tap.
  CHARGE_FULL: 1.0,        // seconds: hold time required for a charged shot AND for the ring to read "full"
  TAP_DISTANCE_LIMIT: 20,  // px: max finger travel for a tap to register
  THROTTLE_DISTANCE: 150,  // px from screen center that maps to full throttle (1.0)
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
};

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
  // O(N²) ammo-drop merge pass (DropSystem.mergeAmmoDrops).  Up to
  // DROP_CONFIG.MAX_ACTIVE_DROPS² pair-ops + damping + nudges per
  // step; not time-critical (drops settle over many frames), so a
  // 4-step cadence at peak load drops cost ~75 % while staying
  // visually responsive.
  dropMerge:        { minInterval: 1, maxInterval: 4,   costWeight: 0.5, autoCurve: 1.0 },
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

export const PLAYER_MOVEMENT_CONFIG: Record<MapType, { maxSpeed: number, acceleration: number, friction: number }> = {
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
    health: 3,
    mass: Infinity,
    indestructible: false,
    sprite: '',
    color: COLORS.ASTEROID,
  },
} as const;

export type StructureVariant = keyof typeof STRUCTURE_VARIANTS;

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
  // Player→nebula-shard pull (PhysicsSystem.applyNebulaPlayerPull).
  // Active when a player ship passes within PLAYER_PULL_RANGE of a
  // nebula-shard; falloff is linear (full at the centre, zero at the
  // range edge).  STRENGTH is the velocity nudge (units/s) added each
  // step at the centre.  SPIN_KICK is the rad/s nudge added per shard
  // per second of being in range — stable per-shard sign drawn from
  // the entity id so the cloud reads as varied swirls.  The shatter
  // path is independent — shards in range still shatter on direct
  // contact via the standard nebula pass-through trigger.
  //
  // Both the pull AND the shatter check skip shards whose
  // `nebulaMergeCooldown` is active — the same field already gates
  // shard↔shard merging, so freshly-spawned shatter children (which
  // carry the post-shatter cooldown) sit out the player interaction
  // until the cooldown elapses.  Single field gates all three nebula-
  // shard interactions: pull, shatter, merge.
  PLAYER_PULL_RANGE: 60,
  PLAYER_PULL_STRENGTH: 1,
  PLAYER_PULL_SPIN: 1.5,
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
  // ── Standard drops (ammo) ────────────────────────────────────────
  // Nebula tiles and shards occasionally release a standard ammo
  // drop on shatter — low frequency so breaking a cluster yields the
  // occasional reward without flooding the map.  The roll is
  // independent of shard creation: shard count/size math is
  // untouched, the ammo drop (if any) is a bonus that spawns
  // alongside the usual shards.  Post-d1 every ammo drop awards the
  // shared currency, so there is no per-weapon variant here.
  AMMO_DROP_CHANCE: 0.06, // 6 % per shatter (tile OR shard)
  AMMO_PER_NEBULA: 3,     // shared-pool ammo units per nebula drop

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

// Hit feedback — every projectile hit on an enemy gives a damage-scaled
// knockback (in the shot's travel direction) plus a brief stagger.  The
// stagger ALSO suspends the AI max-speed clamp, so the knockback actually
// carries the enemy back instead of being instantly clamped to its slow
// cruise — that's what makes the impact read.  Uncapped (per testing): the
// kick is purely KICK_PER_DMG × applied (post-armor) damage, so heavy hits
// shove hard and chip hits on armor barely nudge.
export const HIT_FEEDBACK = {
  KICK_PER_DMG: 1.0,  // knockback velocity per point of applied damage (uncapped)
  STUN_SEC: 0.12,     // stagger: no AI force AND no speed-clamp while > 0
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
//   .CHARGE_FULL window then released) consume `chargedAmmoCost` instead
//   and are dispatched per-weapon in WeaponSystem.firePlayerWeaponCharged().
export const WEAPONS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.BLASTER]: {
    type: WeaponType.BLASTER,
    name: 'Blaster',
    cooldown: 0.14,    // 7 shots/s — all-rounder cadence
    speed: 16,
    damage: 4,
    lifetime: 1.5,
    color: '#ef4444', // Red — infinite ammo starter
    size: 6,
    count: 1,
    spread: 2,
    recoil: 0.5,
    pierce: 0,
    ammoCost: 0,
    chargedAmmoCost: 0,
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
    ammoCost: 2,
    chargedAmmoCost: 3,
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
    ammoCost: 4,
    chargedAmmoCost: 6,
  },
  [WeaponType.BOUNCER]: {
    type: WeaponType.BOUNCER,
    name: 'Pierce Beam',
    cooldown: 0.40,    // 2.5 shots/s
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
    ammoCost: 6,
    chargedAmmoCost: 9,
  },
  [WeaponType.LIGHTNING]: {
    type: WeaponType.LIGHTNING,
    name: 'Lightning',
    cooldown: 0.50,    // 2 shots/s
    speed: 26,         // gravity pull curves the projectile toward targets
    damage: 9,         // direct hit; chain hops scale down by 1/(totalHops-1) per hop
    lifetime: 15,      // bounded — prevents unbounded accumulation in target-poor areas
    color: '#22d3ee',  // Cyan — projectile that chains on impact
    size: 6,
    count: 1,
    spread: 3,
    recoil: 0.3,
    pierce: 0,         // stops on first hit, then chains
    ammoCost: 8,
    chargedAmmoCost: 12,
  },
  [WeaponType.HOMING]: {
    type: WeaponType.HOMING,
    name: 'Seeker Missiles',
    cooldown: 0.65,    // 1.5 shots/s — slow ROF in exchange for guaranteed hits
    speed: 12,
    damage: 6,
    lifetime: 3.0,
    color: '#3b82f6', // Blue
    size: 8,
    count: 1,
    spread: 10,
    recoil: 0.5,
    pierce: 0,
    homing: true,
    ammoCost: 10,
    chargedAmmoCost: 15,
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
    ammoCost: 12,
    chargedAmmoCost: 18,
  },
};

// Full rainbow order — used for ammo HUD slot layout and weapon cycling
export const WEAPON_LIST = [
  WeaponType.BLASTER,
  WeaponType.BURST,
  WeaponType.SHOTGUN,
  WeaponType.BOUNCER,
  WeaponType.LIGHTNING,
  WeaponType.HOMING,
  WeaponType.CANNON,
];

// Pre-computed slot abbreviations for the ammo HUD (initials of each word in
// the weapon's display name, capped at 3 chars).  Built once on module init
// so the HUD render path avoids per-frame split/map/join string churn for
// every visible weapon slot.
export const WEAPON_SLOT_LABELS: Record<WeaponType, string> = (() => {
  const out = {} as Record<WeaponType, string>;
  for (const wt of WEAPON_LIST) {
    out[wt] = WEAPONS[wt].name.split(' ').map(w => w[0]).join('').substring(0, 3);
  }
  return out;
})();

// Burst-fire parameters for shooting enemies.
// Pattern: BURST_SIZE rapid shots (BURST_GAP apart), then BURST_RELOAD reload.
export const ENEMY_BURST_CONFIG = {
  BURST_SIZE: 2,        // shots per burst
  BURST_GAP: 0.15,      // seconds between shots within a burst
  BURST_RELOAD: 2.5,    // seconds between bursts
};

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
  ammoCost: 0,        // unused — enemies don't draw from a shared pool
  chargedAmmoCost: 0, // unused — enemies don't charge
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
  POPUP_COLOR: '#facc15',         // floating "+N" kill popup (ammo-yellow family)
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

// ── Progression: leveled stat upgrades ───────────────────────────────────────
// In-run progression spine.  Stat upgrades come ONLY from wave-completion cards
// (every wave); a normal card grants 1 level, and every 4th wave the cards roll
// "powerful" variants that grant +2/+3/+4 levels at once.  Levels are UNCAPPED
// (a focused build can stack a stat as high as picks allow).  GameEngine
// .applyUpgrades folds the run's `upgradeLevels` into the player's effective
// stats.  Unlocks (weapons / shield / overcharge) are the separate Salvage→
// Drydock module economy.
export type UpgradeId =
  | 'hull' | 'plating' | 'capacitor' | 'engine'
  | 'thrusters' | 'gunnery' | 'autoloader' | 'magazine';

export interface UpgradeDef {
  id: UpgradeId;
  label: string;   // DBG / card / menu label
  desc: string;    // one-line effect of one card (= one level)
  max: number;     // DBG-cycle soft cap ONLY — gameplay levels are uncapped
  // Dependency on a major MODULE — the card is withheld from the pool until
  // the module is installed (otherwise the augment would do nothing):
  //   'shield'    → needs the Shield module (Plating / Capacitor)
  //   'anyWeapon' → needs any non-Blaster weapon (Magazine; Blaster is free)
  requires?: 'shield' | 'anyWeapon';
}

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  { id: 'hull',       label: 'Hull',       desc: '+25 max HP'        , max: 10 },
  { id: 'plating',    label: 'Plating',    desc: '+15 max shield'    , max: 10, requires: 'shield' },
  { id: 'capacitor',  label: 'Capacitor',  desc: '+25% shield regen' , max: 10, requires: 'shield' },
  { id: 'engine',     label: 'Engine',     desc: '+8% top speed'     , max: 10 },
  { id: 'thrusters',  label: 'Thrusters',  desc: '+12% acceleration' , max: 10 },
  { id: 'gunnery',    label: 'Gunnery',    desc: '+12% weapon damage', max: 10 },
  { id: 'autoloader', label: 'Autoloader', desc: '-8% fire cooldown' , max: 10 },
  { id: 'magazine',   label: 'Magazine',   desc: '+40 ammo capacity' , max: 10, requires: 'anyWeapon' },
] as const;

// ── One-time unlocks ──────────────────────────────────────────────────────────
// The run starts LEAN — Blaster only, no shield, no charged shots.  These
// unlocks are bought in the Drydock (Salvage) or, rarely, offered as a free
// card.  Weapon unlocks map to a WeaponType; shield + overcharge are flags.
export interface UnlockDef {
  id: string;
  kind: 'shield' | 'overcharge' | 'weapon';
  weapon?: WeaponType;
  label: string;
  desc: string;
  cost: number;
}
export const UNLOCK_DEFS: readonly UnlockDef[] = [
  { id: 'shield',        kind: 'shield',     label: 'Shield',     desc: 'Deflector shield',  cost: 30000 },
  { id: 'overcharge',    kind: 'overcharge', label: 'Overcharge', desc: 'Hold-to-charge',    cost: 45000 },
  { id: 'wpn_burst',     kind: 'weapon', weapon: WeaponType.BURST,     label: 'Burst',     desc: '3-shot burst',      cost: 25000 },
  { id: 'wpn_shotgun',   kind: 'weapon', weapon: WeaponType.SHOTGUN,   label: 'Shotgun',   desc: 'Pellet cone',       cost: 32500 },
  { id: 'wpn_bouncer',   kind: 'weapon', weapon: WeaponType.BOUNCER,   label: 'Bouncer',   desc: 'Ricochet beams',    cost: 40000 },
  { id: 'wpn_lightning', kind: 'weapon', weapon: WeaponType.LIGHTNING, label: 'Lightning', desc: 'Chain lightning',   cost: 45000 },
  { id: 'wpn_homing',    kind: 'weapon', weapon: WeaponType.HOMING,    label: 'Homing',    desc: 'Tracking missiles', cost: 50000 },
  { id: 'wpn_cannon',    kind: 'weapon', weapon: WeaponType.CANNON,    label: 'Cannon',    desc: 'AoE plasma',        cost: 60000 },
] as const;

// Per-level effect magnitudes (read by GameEngine.applyUpgrades + the
// movement hook).  Base values they modify: HP 100, shield SHIELD_CONSTANTS
// .MAX_CHARGE, recharge SHIELD_CONSTANTS.RECHARGE_RATE, ammo AMMO MAX_POOL.
// Per-LEVEL effect magnitudes.  A normal card grants 1 level; powerful
// (every-4th-wave) cards grant +2/+3/+4 levels, so they're worth that many of
// these.  Base values they modify: HP 100, shield SHIELD_CONSTANTS.MAX_CHARGE,
// recharge SHIELD_CONSTANTS.RECHARGE_RATE, ammo AMMO MAX_POOL.
export const UPGRADE_EFFECTS = {
  HULL_HP_PER_LEVEL: 25,
  PLATING_SHIELD_PER_LEVEL: 15,
  CAPACITOR_RECHARGE_FRAC_PER_LEVEL: 0.25,
  ENGINE_SPEED_FRAC_PER_LEVEL: 0.08,
  THRUSTERS_ACCEL_FRAC_PER_LEVEL: 0.12,
  GUNNERY_DAMAGE_FRAC_PER_LEVEL: 0.12,
  AUTOLOADER_COOLDOWN_FRAC_PER_LEVEL: 0.08,
  AUTOLOADER_COOLDOWN_FLOOR: 0.4, // never below 40% of base cadence
  MAGAZINE_AMMO_PER_LEVEL: 40,
};

// ── Between-wave upgrade cards ────────────────────────────────────────────────
// After every Nth wave (WAVE_INTERVAL, DBG-cyclable) the game pauses and offers
// a free choice of CARD_COUNT cards.  Pool today: stat-upgrade cards (a free
// level of one of the UPGRADE_DEFS) + occasional Salvage cards.  Unlock cards
// (weapons / shield / overcharge) plug into the same pool once unlocks ship.
export const UPGRADE_CARD_CONSTANTS = {
  CARD_COUNT: 3,
  DEFAULT_WAVE_INTERVAL: 1,             // a card every wave
  WAVE_INTERVAL_CYCLE: [1, 2, 4, 8] as const,
  // Every Nth wave the offered cards are "powerful" — each grants a random
  // POWERFUL_MIN..POWERFUL_MAX levels instead of 1.
  POWERFUL_WAVE_INTERVAL: 4,
  POWERFUL_MIN_LEVELS: 2,
  POWERFUL_MAX_LEVELS: 4,
  SALVAGE_CARD_CHANCE: 0.30,            // chance one of the 3 slots is a Salvage card
  SALVAGE_CARD_BASE: 300,              // Salvage granted = BASE + PER_WAVE × waveNumber
  SALVAGE_CARD_PER_WAVE: 75,
  // Beat between a wave clearing and the card modal opening, so the
  // wave-clear celebration animation plays before the sim pauses.
  CARD_OPEN_DELAY_SEC: 1.1,
  // Chance one of the offered cards is a free (rare) unlock, when any
  // unlock is still unowned.
  UNLOCK_CARD_CHANCE: 0.18,
};

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

// Shared-ammo pool config (post-d1).  Caps the player's single ammo number
// and provides the canonical pickup colour used by every ammo drop entity
// (enemy / asteroid / nebula sources all reuse this).
//
// MAX_POOL rationale: pre-refactor there was no explicit per-weapon cap;
// debug fills filled to 999 and a typical playthrough stockpiled ~30-60 per
// weapon across ~6 weapons (~200-360 total).  200 in shared form keeps the
// "well-stocked" feel without drifting into infinite-ammo territory.
export const AMMO_CONSTANTS = {
  MAX_POOL:    200,
  DROP_COLOR: '#facc15', // canonical ammo-pickup yellow
};

export const DROP_CONFIG = {
  // Per-pickup ammo amounts — chosen to keep today's per-encounter expected
  // ammo close to the per-weapon-pool model (asteroid 1.80, enemy 2.15,
  // nebula 0.18 — see also NEBULA_CONSTANTS.AMMO_PER_NEBULA).
  AMMO_PER_ENEMY_PRIMARY:   3,    // primary enemy ammo drop (paired with AMMO_DROP_CHANCE_ENEMY_PRIMARY)
  AMMO_PER_ENEMY_SECONDARY: 2,    // secondary enemy ammo drop (independent roll)
  AMMO_PER_ASTEROID:        4,    // ammo units per asteroid drop
  // Dent-policy mobile shards (plastic-shard, metal-shard) take
  // multiple hits to destroy, so their drop rate + payload run
  // higher than a single-hit asteroid to reward the effort.
  AMMO_PER_DENT_SHARD:      6,
  // Drop-spawn probabilities
  AMMO_DROP_CHANCE_ASTEROID:        0.45, // 45 % chance an asteroid drops ammo
  AMMO_DROP_CHANCE_DENT_SHARD:      0.85, // 85 % chance a dent shard drops ammo
  // Plastic-shards may break into a small number of sub-shards (each
  // a drop opportunity), so their per-shard drop chance is cut well
  // below the generic dent-shard rate.
  AMMO_DROP_CHANCE_PLASTIC_SHARD:   0.20, // 20 % chance a plastic shard drops ammo
  AMMO_DROP_CHANCE_ENEMY_PRIMARY:   0.55, // 55 % chance an enemy drops its primary ammo
  AMMO_DROP_CHANCE_ENEMY_SECONDARY: 0.25, // 25 % chance an enemy drops its secondary ammo
  // Health
  HEALTH_HEAL_AMOUNT:        100,   // HP restored per health drop
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

// ── Ammo-drop ↔ ammo-drop pull ─────────────────────────────────────
// Mutual gravity between non-magnetised ammo drops, applied inside
// DropSystem.mergeAmmoDrops on the same O(N²) pair walk that
// consolidates touching drops.  Pairs already in contact merge as
// before; pairs in (sumR, RANGE] receive a small 1/dist velocity
// nudge toward each other so a cluster from a wave kill converges
// and merges over a fraction of a second instead of sitting put
// waiting for the player.  Magnetised drops (already homing on the
// player) skip the pull so the magnet path keeps a clean trajectory.
export const AMMO_DROP_PULL = {
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
 * Compute the ammo-HUD slot layout for a given screen size.
 *
 * Slot order (post-d1): [BLASTER]  ⎢SLOT_SEP⎥  [AMMO]⎢SLOT_GAP⎥[BURST][SHOTGUN]…
 *
 * The blaster sits alone on the left (infinite ammo, never gated).  The
 * shared-pool readout joins the ammo-gated weapons on the right, glued
 * together by the regular SLOT_GAP so the readout reads as part of that
 * group rather than floating in between.  Only one wider SLOT_SEP gap
 * separates blaster from the ammo+weapons cluster.
 *
 * Total cells = 1 (blaster) + 1 (ammo) + (WEAPON_LIST.length - 1) (other
 * weapons).  One SLOT_SEP gap (after blaster) + (WEAPON_LIST.length - 1)
 * SLOT_GAP gaps (ammo→burst + the inter-weapon gaps).
 */
export function computeAmmoHUDLayout(screenWidth: number, screenHeight: number): {
  startY: number;
  slotW: number;
  blasterX: number;
  ammoX: number;
  weaponsStartX: number;
  totalW: number;
} {
  const { SLOT_W_MAX, SLOT_W_MIN, SLOT_H, SLOT_GAP, SLOT_SEP, BOTTOM_MARGIN } = AMMO_HUD_CONSTANTS;
  const { MARGIN: MM, SIZE: MS } = MINIMAP_CONSTANTS;

  // Horizontal: start just right of the minimap, leave symmetric margin on the right
  const leftClear   = MM + MS + SLOT_GAP * 2;   // minimap right edge + small gap
  const rightEdge   = screenWidth - MM;
  const availableW  = rightEdge - leftClear;

  // Cells: blaster (1) + ammo (1) + non-blaster weapons (WEAPON_LIST.length - 1)
  const cells           = WEAPON_LIST.length + 1;
  // Gaps: 1 SLOT_SEP after the blaster + (cells - 2) regular gaps between
  // every other adjacent pair (ammo→burst + the inter-weapon gaps).
  const standardGaps    = cells - 2;
  const fixedGapsW      = SLOT_SEP + standardGaps * SLOT_GAP;

  // Scale slot width to fit
  const slotW = Math.max(
    SLOT_W_MIN,
    Math.min(SLOT_W_MAX, Math.floor((availableW - fixedGapsW) / cells))
  );
  const totalW = cells * slotW + fixedGapsW;

  // Center the scaled group within the available width
  const groupStartX = leftClear + Math.max(0, (availableW - totalW) / 2);
  const blasterX       = groupStartX;
  const ammoX          = blasterX + slotW + SLOT_SEP;
  const weaponsStartX  = ammoX + slotW + SLOT_GAP;
  const startY         = screenHeight - SLOT_H - BOTTOM_MARGIN;

  return { startY, slotW, blasterX, ammoX, weaponsStartX, totalW };
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
  shoots: boolean; contactDamage: number; weapon?: Partial<WeaponConfig>;
}> = {
  // ── Rushers — close in and fire (red → orange → yellow) ──
  [EnemySubtype.RAMMER_1]: {
    color: '#ef4444', size: 28, health: 1,
    maxSpeed: 5,   accel: 3.5, turnRate: 2.8,
    sprite: ASSETS.ENEMY_DRONE,    mass: 10, shape: 'triangle',
    shoots: true, contactDamage: 8, weapon: { cooldown: 0.9, damage: 6, speed: 8 },
  },
  [EnemySubtype.RAMMER_2]: {
    color: '#f97316', size: 28, health: 2,
    maxSpeed: 8,   accel: 5.5, turnRate: 3.2,
    sprite: ASSETS.ENEMY_CHARGER,  mass: 8, shape: 'arrow',
    shoots: true, contactDamage: 10, weapon: { cooldown: 1.0, damage: 8, count: 2, spread: 10 },
  },
  [EnemySubtype.RAMMER_3]: {
    color: '#facc15', size: 32, health: 5,
    maxSpeed: 4.5, accel: 3,   turnRate: 1.6,
    sprite: ASSETS.ENEMY_TANK,     mass: 18, shape: 'hexagon',
    shoots: true, contactDamage: 14, weapon: { cooldown: 2.0, damage: 16, speed: 7, size: 9 },
  },
  // ── Skirmishers — keep distance and fire (green → cyan → blue) ──
  [EnemySubtype.SHOOTER_1]: {
    color: '#4ade80', size: 28, health: 1,
    maxSpeed: 4,   accel: 2.5, turnRate: 1.3,
    sprite: ASSETS.ENEMY_SKIRMISHER, mass: 12, shape: 'diamond',
    shoots: true, contactDamage: 0,
  },
  [EnemySubtype.SHOOTER_2]: {
    color: '#22d3ee', size: 28, health: 2,
    maxSpeed: 5.5, accel: 3,   turnRate: 1.2,
    sprite: ASSETS.ENEMY_ORBITER,  mass: 10, shape: 'pentagon',
    shoots: true, contactDamage: 0,
  },
  [EnemySubtype.SHOOTER_3]: {
    color: '#3b82f6', size: 26, health: 3,
    maxSpeed: 7,   accel: 4,   turnRate: 1.5,
    sprite: ASSETS.ENEMY_SNIPER,   mass: 9, shape: 'chevron',
    shoots: true, contactDamage: 0, weapon: { cooldown: 1.8, damage: 14, speed: 14 },
  },
};

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

// Per-subtype attack effect: a shooter whose subtype appears here fires rounds
// that apply the effect to the player on hit (and render in the effect colour).
export const ENEMY_ATTACK_EFFECTS: Partial<Record<EnemySubtype, EffectPayload>> = {
  [EnemySubtype.SHOOTER_2]: {
    kind: 'corrosion', duration: CORROSION.DURATION,
    dmgPerSec: CORROSION.DMG_PER_SEC, maxStacks: CORROSION.MAX_STACKS,
  },
};

// ── Enemy counterplay traits ──────────────────────────────────────────────────
// Soft-counter levers stamped on an enemy at spawn (WaveSystem.spawnEnemy).
// SOFT by design: a chip weapon still works, just slowly, while the demanded
// tool trivialises the threat.  v1 = armor only (Tank); evasive / front-shield /
// regen join with their enemies + the bosses.
//   armor.chipThreshold — per-hit damage at/above this lands in full
//   armor.reduction     — fraction cut from hits BELOW the threshold
// So Blaster (4) / Shotgun-pellet (3) chip the Tank, while Cannon (18) /
// Lightning (9) / charged shots — and a Gunnery-boosted Blaster past 6 — punch
// through.  AoE/explosion damage isn't chip-resisted (it's an answer).
export const ENEMY_TRAITS: Partial<Record<EnemySubtype, {
  armor?: { chipThreshold: number; reduction: number };
}>> = {
  [EnemySubtype.RAMMER_3]: { armor: { chipThreshold: 6, reduction: 0.7 } }, // Tank
};

// Maps each subtype to its role — used by AI routing and shooting logic.
export const ENEMY_ROLE: Record<EnemySubtype, EnemyRole> = {
  [EnemySubtype.RAMMER_1]:  EnemyRole.RAMMING,
  [EnemySubtype.RAMMER_2]:  EnemyRole.RAMMING,
  [EnemySubtype.RAMMER_3]:  EnemyRole.RAMMING,
  [EnemySubtype.SHOOTER_1]: EnemyRole.SHOOTING,
  [EnemySubtype.SHOOTER_2]: EnemyRole.SHOOTING,
  [EnemySubtype.SHOOTER_3]: EnemyRole.SHOOTING,
};

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

export const SHARD_VARIANTS: Readonly<Record<ShardVariantId, ShardVariantDef>> = {
  'glass-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'glass-tile',
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
      // 3 adjacent vertices pulled per hit.  vertexJitter is the
      // base per-vertex max pull (0.20 = up to 20 % inward).  Two
      // of the three (the closest-to-impact vertex plus one
      // randomly-chosen neighbour, via deepVertexCount = 2) draw
      // jitter × centerVertexJitterMul = 0.20 × 10.0 = up to 2.0
      // nominal jitter — capped by applyDentStep's K_MIN floor so
      // an "infinitely deep" roll bottoms out at 5 % of the vertex's
      // current radius.  Every hit produces two deep notches plus
      // one softer side warp, reading as a chaotic brittle fracture
      // (cracks branch unevenly rather than dimpling at a single
      // point).
      vertexJitter: 0.20,
      centerVertexJitterMul: 10.0,
      pullVertexCount: 3,
      deepVertexCount: 2,
      // Each hit also chips off a rock-shard at the impact location.
      // sizeFraction 0.7 is linear relative to the deformed tile
      // diameter (~44 at start), so the chip is ~31 wide on hit 1 —
      // a chunky fragment that reads as a substantial chip flying
      // off, not a sliver.
      perHitShard: { variant: 'rock-shard', sizeFraction: 0.7 },
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
    spawnsDropsOnDeath: false,                  // NebulaSystem handles its own ammo roll
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
      forwardDrag: 0.35, perpScatter: 0.0,
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
  [MapType.UNIVERSE]: {
    'rock-shard': { freeSpawn: { count: 140, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 6000 } },
    'glass-tile':          { tileCluster: { clusterCount: 14, minClusterSize: 10, maxClusterSize: 34 } },
    'plastic-tile':        { tileCluster: { clusterCount:  5, minClusterSize:  8, maxClusterSize: 22 } },
    'metal-tile':          { tileCluster: { clusterCount:  3, minClusterSize:  6, maxClusterSize: 14 } },
    // indestructible-tile intentionally absent — per decision #6,
    // reserved for deliberate border/structure placement, not random
    // clusters in the natural maps.  INDESTRUCTIBLE_FIELD showcase
    // still spawns it for stress testing.
    'nebula-tile': {
      tileCluster: {
        clusterCount:    65,    // halved for 7.5k map (was 130)
        minClusterSize:  14,
        maxClusterSize:  42,
        outer: {
          clusterCount:   120,  // halved for 7.5k map (was 240)
          minClusterSize: 7,
          maxClusterSize: 26,
        },
      },
    },
  },
  [MapType.RING]: {
    'rock-shard': { freeSpawn: { count: 280, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 5000 } },
  },
  [MapType.SEVEN_RINGS]: {
    'rock-shard': { freeSpawn: { count: 280, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 5000 } },
  },
  [MapType.POCKET]: {
    'rock-shard': { freeSpawn: { count: 1, minSize: 20, maxSize: 80, speedMultiplier: 1.5, spawnRadius: 1600 } },
    'glass-tile':          { tileCluster: { clusterCount: 8, minClusterSize: 6, maxClusterSize: 14 } },
    'plastic-tile':        { tileCluster: { clusterCount: 5, minClusterSize: 5, maxClusterSize: 10 } },
    'metal-tile':          { tileCluster: { clusterCount: 3, minClusterSize: 4, maxClusterSize:  8 } },
    // indestructible-tile intentionally absent — see UNIVERSE entry
    // above for the decision-#6 rationale.
    'nebula-tile': {
      tileCluster: { clusterCount: 12, minClusterSize: 6, maxClusterSize: 20 },
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
