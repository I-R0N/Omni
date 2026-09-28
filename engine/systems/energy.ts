/**
 * ENERGY — the pure half of the delivery × energy × material pipeline.
 *
 *   DELIVERY MODULE + ENERGY MODIFIER → ENERGY PACKETS → MATERIAL RESPONSE
 *     → FRACTURE PROFILE / BOND / PROPAGATION → shards + physics + feedback
 *
 * Everything in this file is PURE: types, the material response table, the
 * fracture-profile resolver, heat arithmetic and the bounded chain planner.
 * Nothing here touches the engine, the grids or the world — the side effects
 * live in `engine/energyEffects.ts`, which calls into this.  That split is
 * what lets the numerics be pinned headlessly (`window.__omniEnergy`) without
 * a scene, the same argument `__omniHud` and `__omniHid` make.
 *
 * UNITS.  A packet's `magnitude` is DAMAGE-EQUIVALENT: one unit is
 * `IMPACT_ENERGY_PER_DAMAGE` of energy, the conversion the kinetic model is
 * already calibrated against.  So a kinetic packet of magnitude 4 is exactly
 * a 4-damage bite, and a thermal packet of 4 carries the same energy as heat.
 * Heat itself is NORMALISED per material: 1.0 is that material's critical
 * heat (glass fails, plastic bonds have let go, metal is at its weakest).
 *
 * KINETIC STAYS WHERE IT WAS.  The mechanical path is the existing energy
 * model — projectile banks, grain-boundary spend, crash energy — and this
 * file does not re-derive any of it.  What it adds is the one multiplier the
 * other domains are allowed to put on it: HEAT WEAKENS (`mechanicalScale`),
 * which is how "heat metal, then hit it" becomes more effective without any
 * combo bookkeeping.
 */

import type { GameEntity } from '../../types';
import type { GrainSpec } from './ShardSystem.types';

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** HOW energy arrives.  A gun module IS one of these. */
export type Delivery = 'projectile' | 'beam' | 'spread' | 'homing' | 'cannon';
export const DELIVERIES: readonly Delivery[] = ['projectile', 'beam', 'spread', 'homing', 'cannon'];

/** WHAT KIND of energy a delivery carries.  An energy MODIFIER module is one
 *  of these; an unmodified delivery fires plain (weak) kinetic energy. */
export type EnergyModifier = 'kinetic' | 'electric' | 'thermal';
export const ENERGY_MODIFIERS: readonly EnergyModifier[] = ['kinetic', 'electric', 'thermal'];

/** The PHYSICAL domains a material answers to.  (Magnetic and the explosive
 *  composite were removed — user call; the BLAST now belongs to the Cannon
 *  DELIVERY rather than to an energy.) */
export type EnergyDomain = 'mechanical' | 'thermal' | 'electric';

/** A weapon's identity: a delivery, optionally modified.  `'projectile'` or
 *  `'projectile+thermal'`.  A string key rather than an object so it can sit
 *  in the loadout arrays and the HUD exactly where the old enum did. */
export type WeaponKey = string;

export function weaponKey(delivery: Delivery, energy: EnergyModifier | null | undefined): WeaponKey {
  return energy ? `${delivery}+${energy}` : delivery;
}

/** Parse a key, or null when it is not one (unknown ids fail SAFE — the
 *  caller falls back rather than throwing). */
export function parseWeaponKey(key: string | null | undefined):
  { delivery: Delivery; energy: EnergyModifier | null } | null {
  if (!key) return null;
  const [d, e] = key.split('+');
  if (!(DELIVERIES as readonly string[]).includes(d)) return null;
  if (e === undefined) return { delivery: d as Delivery, energy: null };
  if (!(ENERGY_MODIFIERS as readonly string[]).includes(e)) return null;
  return { delivery: d as Delivery, energy: e as EnergyModifier };
}

/** THE OLD ROSTER → the combination it became.  There is no save file in
 *  Omni (run state is in-memory only), so this map's job is every place an
 *  OLD ID can still arrive from: DBG grants, the headless suites, and anyone
 *  poking `player.currentWeapon = 'CANNON'` from a console.  Each old gun is
 *  mapped to the combination whose behaviour it already was, and each such
 *  KINETIC-OR-MODIFIED combination inherits that gun's tuning, so the
 *  modifiers are what make a weapon strong (§9) and the old guns survive as
 *  named points in the new space rather than disappearing. */
export const LEGACY_WEAPON_MAP: Readonly<Record<string, WeaponKey>> = {
  BLASTER:   'projectile',            // the starter → the plain delivery
  BURST:     'projectile+kinetic',    // the dense slug
  SHOTGUN:   'spread+kinetic',
  BOUNCER:   'beam+thermal',          // "Laser" — a laser is heat
  LIGHTNING: 'projectile+electric',
  HOMING:    'homing+kinetic',
  CANNON:    'cannon',                // the Plasma Cannon IS the bare cannon delivery
  // Catalog ids of the retired gun modules.
  wpn_blaster: 'projectile', wpn_burst: 'projectile+kinetic', wpn_shotgun: 'spread+kinetic',
  wpn_bouncer: 'beam+thermal', wpn_lightning: 'projectile+electric',
  wpn_homing: 'homing+kinetic', wpn_cannon: 'cannon',
  // Keys of the removed PULSE delivery and the removed MAGNETIC / EXPLOSIVE
  // energies.  The shell that was `projectile+explosive` is the cannon now;
  // everything else falls back to the bare delivery it rode on.
  'projectile+explosive': 'cannon', 'projectile+magnetic': 'projectile',
  'beam+explosive': 'beam', 'beam+magnetic': 'beam',
  'spread+explosive': 'spread', 'spread+magnetic': 'spread',
  'homing+explosive': 'homing', 'homing+magnetic': 'homing',
  radial: 'cannon', 'radial+kinetic': 'cannon+kinetic', 'radial+electric': 'cannon+electric',
  'radial+thermal': 'cannon+thermal', 'radial+magnetic': 'cannon', 'radial+explosive': 'cannon',
};

/** Normalise any id — new key, old enum name, old catalog id — to a key. */
export function resolveWeaponKey(id: string | null | undefined): WeaponKey | null {
  if (!id) return null;
  if (parseWeaponKey(id)) return id;
  return LEGACY_WEAPON_MAP[id] ?? null;
}

// ── Materials ────────────────────────────────────────────────────────────────

/** A material is a small reusable property, not a tile flag: terrain gets
 *  it from its shard variant's `material` field (SHARD_VARIANTS), and ANY
 *  entity may set `GameEntity.material` to opt in (a metal enemy is
 *  `material: 'metal'` away from a real metal response).  `generic` is the
 *  safe default for everything else. */
export type MaterialId = 'rock' | 'glass' | 'metal' | 'plastic' | 'nebula' | 'generic';
export const MATERIAL_IDS: readonly MaterialId[] = ['rock', 'glass', 'metal', 'plastic', 'nebula', 'generic'];

/** Shard variant → material, filled from SHARD_VARIANTS' own `material`
 *  fields at load (`registerVariantMaterials`).  The variant table SAYS what
 *  each row is made of; nothing parses a name. */
const VARIANT_MATERIAL: Record<string, MaterialId> = {};
export function registerVariantMaterials(table: Readonly<Record<string, { material?: MaterialId }>>): void {
  for (const k of Object.keys(table)) {
    const m = table[k].material;
    if (m) VARIANT_MATERIAL[k] = m;
  }
}

export function materialOf(e: GameEntity): MaterialId {
  if (e.material) return e.material;
  const v = e.shardVariant;
  return (v && VARIANT_MATERIAL[v]) || 'generic';
}

export interface MaterialResponse {
  // ── STATE ─────────────────────────────────────────────────────────────────
  /** A GAS is not a solid: it takes no damage from any energy (it is
   *  displaced, heated, energised instead), has no fracture profile, is not
   *  stamped with impact points, and beams pass through it.  One flag, so a
   *  second gas material needs no code. */
  gas: boolean;

  // ── MECHANICAL ────────────────────────────────────────────────────────────
  /** How much weaker a HOT body is to kinetic energy:
   *  damage × (1 + heatWeakening × heat).  This is the threshold drop —
   *  under the grain model a body's HP is its boundary total, so scaling
   *  what a hit spends on the boundaries IS lowering the threshold. */
  heatWeakening: number;

  // ── THERMAL ───────────────────────────────────────────────────────────────
  /** Fraction of a thermal packet that becomes heat. */
  heatAbsorb: number;
  /** SPECIFIC HEAT, J/(g·K), roughly the real material's.  The one number
   *  behind two derived ones (user call): how much energy a unit of heat
   *  costs (`heatCapacityOf`) and how hot the body can get (`maxHeatOf`).
   *  So plastic, with the highest real specific heat, is the SLOWEST solid
   *  to heat and the one that can hold the most. */
  specificHeat: number;
  /** Fraction of heat lost per second (exponential cooling). */
  coolingPerSec: number;
  /** THERMAL CONDUCTIVITY, 0..1 — real-world ORDER (steel ≈ 50, granite ≈ 2.5,
   *  glass ≈ 1, plastic ≈ 0.2 W/m·K), compressed so the low end still reads.
   *  Drives BOTH how fast a hot spot spreads through the body
   *  (`thermalDiffusivityOf`) and how much heat crosses to a neighbour
   *  (`conductShare`, harmonic mean of the two conductivities). */
  thermalConductivity: number;
  /** Boundary damage per second at heat 1 — thermal cracking / softening /
   *  burning.  0 = heat never damages on its own. */
  thermalDps: number;
  /** Heat at which the body fails OUTRIGHT under the thermal profile (glass
   *  thermal fracture).  Infinity = never. */
  thermalFailAt: number;
  /** Heat above which cohesion bonds let go (plastic). Infinity = never. */
  bondReleaseAt: number;
  /** GAS response to heat: how hard a drifting body is stirred per unit of
   *  heat (0 = not at all), and the heat at which a STATIC gas body
   *  disperses (Infinity = never). */
  agitation: number;
  disperseAt: number;

  // ── ELECTRIC ──────────────────────────────────────────────────────────────
  /** 0..1: 1 conducts perfectly.  A chain passes ON through a body at its
   *  conductivity (the arc out of it carries that fraction), so a poor
   *  conductor passes a weak arc and only a near-perfect insulator
   *  (< CHAIN_MIN_CONDUCTIVITY) is a dead end. */
  conductivity: number;
  /** Fraction of an arc's magnitude that becomes damage. */
  electricDamage: number;
  /** Seconds an arc leaves the body ENERGISED (it glitters with sparks)
   *  instead of damaging it.  0 = never energised. */
  energizeSec: number;

  // ── OPTICAL (light: beams, and the radiant heat of hot bodies) ────────────
  /** Fraction of arriving light REFLECTED at the surface (a mirror image of
   *  the ray, which carries on).  Metal is the mirror. */
  reflectivity: number;
  /** Fraction of the light that is not reflected that ENTERS the body and
   *  travels through it (the rest is absorbed at the surface).  0 = opaque. */
  transmissivity: number;
  /** The same, for THERMAL light (infrared).  Glass is clear to a visible
   *  beam and nearly opaque to heat — which is what lets a heat lance make a
   *  pane fail while an ordinary beam passes through it. */
  thermalTransmissivity: number;
  /** Refractive index: how far a ray bends crossing the surface (Snell). */
  refractiveIndex: number;
  /** Inside the body, each GRAIN BOUNDARY a ray crosses turns it by up to
   *  this many radians (deflection inside tiles and shards)... */
  boundaryScatter: number;
  /** ...takes this fraction of its energy (deposited on that boundary — the
   *  low per-boundary damage of a deep pass-through)... */
  boundaryLoss: number;
  /** ...and SPLITS this fraction of it off as a new ray (bounded). */
  boundarySplit: number;
}

/** How a material LOOKS hot: `heatRamp` maps local temperature (0..1) to a
 *  colour ([t, r, g, b] stops), `heatTint` caps how much of the body the heat
 *  colour covers, `heatEmit` is the emissivity (how much of the T⁴ radiance
 *  becomes visible light).  Presentation only (render/energyFx.ts). */
export interface MaterialLook {
  heatRamp: readonly (readonly [number, number, number, number])[];
  heatTint: number;
  heatEmit: number;
}

export interface FractureProfile { siteScale: number; bias?: number; impulse: number }

/** EVERYTHING a material is, in one place (user call: a central material
 *  table).  The energy response (MaterialResponse) plus:
 *   - `grain`    the GRAIN geometry + bond strength its tile AND its shard
 *                share (`radialSpeed` is per variant — how fast pieces fly
 *                is about being mobile, not about the grain).  null = no
 *                grain model.
 *   - `density`  the impact density (mass per diameter²) its shard mass
 *                ladders read; null for materials that are not shards.
 *   - `fracture` break shape per domain; null = never fractures (a gas).
 *   - `look`     how it looks hot.
 *   - `sfx`      the impact / break voice suffix (`impact.tile.<sfx>`).
 *  A new material is one entry here plus its shard rows naming it. */
export interface MaterialDef extends MaterialResponse {
  grain: Omit<GrainSpec, 'radialSpeed'> | null;
  density: number | null;
  fracture: { mechanical: FractureProfile; thermal: FractureProfile } | null;
  look: MaterialLook;
  sfx: string;
}

/**
 * THE MATERIAL TABLE (§8).  Coefficients live here; BEHAVIOUR lives in the
 * paths that read them, and those paths branch on these PROPERTIES, never on
 * a material's name — so a new material, or a changed behaviour, is a row
 * edit rather than new code.  Read it as "what is this stuff", not as a
 * damage chart.
 */
export const MATERIALS: Readonly<Record<MaterialId, MaterialDef>> = {
  rock: {
    gas: false, heatWeakening: 1.5,
    heatAbsorb: 0.8, specificHeat: 0.8,  coolingPerSec: 0.25, thermalConductivity: 0.12,
    thermalDps: 1.5, thermalFailAt: Infinity, bondReleaseAt: Infinity, agitation: 0, disperseAt: Infinity,
    conductivity: 0.15, electricDamage: 0.3, energizeSec: 0,
    // Opaque and dull: absorbs almost all light.
    reflectivity: 0.06, transmissivity: 0, thermalTransmissivity: 0, refractiveIndex: 1,
    boundaryScatter: 0, boundaryLoss: 0, boundarySplit: 0,
    grain: { grainCountMin: 3, grainCountMax: 16, grainSize: 14, impactBias: 0.75, regularity: 0.5,
             progressive: true, bondStrength: 0.4 },
    density: 0.18,
    // Chunky and localised, carrying real momentum.
    fracture: { mechanical: { siteScale: 1, impulse: 1.15 },
                thermal:    { siteScale: 0.7, bias: 0.25, impulse: 0.5 } },
    // Stays in magma reds and ambers; never whitens.
    look: { heatRamp: [[0, 70, 26, 18], [0.35, 140, 34, 14], [0.7, 205, 70, 18], [1, 240, 145, 50]],
            heatTint: 0.6, heatEmit: 0.5 },
    sfx: 'rock',
  },
  glass: {
    gas: false, heatWeakening: 1.0,
    heatAbsorb: 0.9, specificHeat: 0.84, coolingPerSec: 0.15, thermalConductivity: 0.08,
    thermalDps: 0, thermalFailAt: 1.0, bondReleaseAt: Infinity, agitation: 0, disperseAt: Infinity,
    // Low but NOT zero (user call): an arc lands on glass, cracks it and
    // passes on weakly, rather than glass being a dead end.
    conductivity: 0.1, electricDamage: 0.35, energizeSec: 0,
    // Clear: most light passes through, bending at the faces, glancing off each
    // grain boundary and splitting a little at each one (a prism); opaque to heat.
    reflectivity: 0.12, transmissivity: 0.95, thermalTransmissivity: 0.15, refractiveIndex: 1.5,
    boundaryScatter: 0.14, boundaryLoss: 0.05, boundarySplit: 0.2,
    grain: { grainCountMin: 6, grainCountMax: 10, grainSize: 15, impactBias: 0.75, regularity: 0.5,
             progressive: true, bondStrength: 0.4 },
    density: 0.10,
    // A violent mechanical SHATTER (flung hard) against a thermal STRESS
    // failure (few, large, quiet pieces) — the headline contrast.
    fracture: { mechanical: { siteScale: 1, impulse: 1.5 },
                thermal:    { siteScale: 0.45, bias: 0.0, impulse: 0.2 } },
    // Clear, so heat shows THROUGH it and covers less: soft amber to straw.
    look: { heatRamp: [[0, 150, 80, 40], [0.4, 220, 120, 45], [0.75, 245, 175, 80], [1, 255, 225, 150]],
            heatTint: 0.42, heatEmit: 0.55 },
    sfx: 'glass',
  },
  metal: {
    gas: false, heatWeakening: 2.5,
    heatAbsorb: 0.7, specificHeat: 0.45, coolingPerSec: 0.1, thermalConductivity: 1.0,
    thermalDps: 0, thermalFailAt: Infinity, bondReleaseAt: Infinity, agitation: 0, disperseAt: Infinity,
    conductivity: 1.0, electricDamage: 1.0, energizeSec: 0,
    // The mirror: reflects most light, absorbs the rest, lets none through.
    reflectivity: 0.8, transmissivity: 0, thermalTransmissivity: 0, refractiveIndex: 1,
    boundaryScatter: 0, boundaryLoss: 0, boundarySplit: 0,
    grain: { grainCountMin: 8, grainCountMax: 22, grainSize: 8, impactBias: 0.35, regularity: 0.95,
             sizeSpread: 0, bondSpread: 0, grainDent: 0.05, progressive: true, bondStrength: 1.8 },
    density: 0.30,
    // Heavy and slow whatever broke it; the fewest, largest pieces of any
    // solid once heat has had it.
    fracture: { mechanical: { siteScale: 1, impulse: 0.4 },
                thermal:    { siteScale: 0.35, bias: 0.1, impulse: 0.25 } },
    // The incandescent ladder: cherry → orange → near-white.
    look: { heatRamp: [[0, 90, 24, 18], [0.3, 170, 34, 16], [0.6, 235, 92, 28], [0.85, 250, 170, 70], [1, 255, 228, 175]],
            heatTint: 0.62, heatEmit: 0.7 },
    sfx: 'metal',
  },
  plastic: {
    gas: false, heatWeakening: 0.5,
    heatAbsorb: 1.0, specificHeat: 1.5, coolingPerSec: 0.2, thermalConductivity: 0.03,
    thermalDps: 60, thermalFailAt: Infinity, bondReleaseAt: 0.3, agitation: 0, disperseAt: Infinity,
    conductivity: 0.03, electricDamage: 0.1, energizeSec: 0,
    // Translucent and cloudy: light gets in, is scattered hard by every grain
    // and soaked up quickly.
    reflectivity: 0.05, transmissivity: 0.5, thermalTransmissivity: 0.3, refractiveIndex: 1.45,
    boundaryScatter: 0.45, boundaryLoss: 0.2, boundarySplit: 0.1,
    grain: { grainCountMin: 8, grainCountMax: 16, grainSize: 6, impactBias: 0.5, regularity: 0.55,
             sizeSpread: 0, bondSpread: 0, grainDent: 0.10, dentRecoverSeconds: 2.5,
             progressive: true, bondStrength: 1.8 },
    density: 0.13,
    // Gives rather than shatters.
    fracture: { mechanical: { siteScale: 1, impulse: 0.7 },
                thermal:    { siteScale: 0.6, bias: 0.1, impulse: 0.3 } },
    // SCORCHES — yellowing then browning, a dim ember at the very top.
    look: { heatRamp: [[0, 150, 125, 55], [0.4, 120, 80, 32], [0.75, 70, 40, 22], [1, 150, 55, 20]],
            heatTint: 0.58, heatEmit: 0.18 },
    sfx: 'plastic',
  },
  // Gas: stirred by heat, energised (not damaged) by arcs, passed through by
  // beams, shoved by kinetic rounds, never fractured.  It takes the voronoi
  // GEOMETRY but no bondStrength (no damage model — CLAUDE.md §8).
  nebula: {
    gas: true, heatWeakening: 0,
    heatAbsorb: 1.0, specificHeat: 1.0, coolingPerSec: 0.5, thermalConductivity: 0.05,
    thermalDps: 0, thermalFailAt: Infinity, bondReleaseAt: Infinity, agitation: 0.4, disperseAt: 1.0,
    conductivity: 0.7, electricDamage: 0, energizeSec: 3.5,
    // A gas: light passes straight through (the beam's gas branch).
    reflectivity: 0, transmissivity: 1, thermalTransmissivity: 1, refractiveIndex: 1,
    boundaryScatter: 0, boundaryLoss: 0, boundarySplit: 0,
    grain: { grainCountMin: 3, grainCountMax: 14, grainSize: 20, impactBias: 0.5, regularity: 0.15,
             sizeSpread: 0.6 },
    density: null,
    fracture: null,
    // Warms to a rose-pink and takes light only (no hard outline to tint).
    look: { heatRamp: [[0, 150, 60, 90], [0.5, 225, 110, 140], [1, 255, 190, 205]],
            heatTint: 0, heatEmit: 0.35 },
    sfx: 'nebula',
  },
  // Enemies, the player, indestructible terrain, anything unknown: a hull.
  // Electrically it IS metal (user call: an arc on a metal tile must be able
  // to jump to the ship beside it at full strength); thermally a little less
  // conductive, and it burns (heat is a DoT).  It sounds like metal.
  generic: {
    gas: false, heatWeakening: 0.5,
    heatAbsorb: 0.8, specificHeat: 0.5, coolingPerSec: 0.4, thermalConductivity: 0.8,
    thermalDps: 5, thermalFailAt: Infinity, bondReleaseAt: Infinity, agitation: 0, disperseAt: Infinity,
    conductivity: 1.0, electricDamage: 1.0, energizeSec: 0,
    // A hull: dull metal paint — some glint, mostly absorbed.
    reflectivity: 0.15, transmissivity: 0, thermalTransmissivity: 0, refractiveIndex: 1,
    boundaryScatter: 0, boundaryLoss: 0, boundarySplit: 0,
    grain: null,
    density: null,
    fracture: { mechanical: { siteScale: 1, impulse: 1 },
                thermal:    { siteScale: 0.7, bias: 0.25, impulse: 0.5 } },
    // A hull is metal, dimmer.
    look: { heatRamp: [[0, 90, 24, 18], [0.35, 160, 36, 16], [0.7, 220, 95, 30], [1, 245, 175, 90]],
            heatTint: 0.5, heatEmit: 0.45 },
    sfx: 'metal',
  },
};

/** The energy-response view of the table (kept as its own name: every energy
 *  path and the `__omniEnergy` suites read it). */
export const MATERIAL_RESPONSE: Readonly<Record<MaterialId, MaterialResponse>> = MATERIALS;

export function materialDef(mat: MaterialId | string | undefined): MaterialDef {
  return MATERIALS[(mat ?? 'generic') as MaterialId] ?? MATERIALS.generic;
}

export function responseOf(mat: MaterialId | string | undefined): MaterialResponse {
  return MATERIAL_RESPONSE[(mat ?? 'generic') as MaterialId] ?? MATERIAL_RESPONSE.generic;
}

// ── Numerics ─────────────────────────────────────────────────────────────────

/** Finite, non-negative, capped.  Every magnitude entering the pipeline goes
 *  through this, so a NaN from upstream becomes 0 rather than a NaN health. */
export function safeMag(x: number, cap: number = ENERGY_CONSTANTS.MAX_PACKET): number {
  return Number.isFinite(x) && x > 0 ? Math.min(x, cap) : 0;
}

export const ENERGY_CONSTANTS = {
  /** Hard ceiling on one packet's magnitude (damage units). */
  MAX_PACKET: 500,
  /** Heat is clamped here — no runaway temperature. */
  MAX_HEAT: 5,
  /** Below this a body is COLD and leaves the active-heated set. */
  HEAT_EPSILON: 0.02,
  /** A burn rate (damage units/s) below this is not handed to a fragment:
   *  a share that small would only spend a heated-set slot. */
  MIN_SHARED_BURN: 0.5,
  /** PRESENTATION: the drawn temperature eases toward the real one — this
   *  fast when heating, this slowly when cooling (seconds, time constant).
   *  Deposits, conduction and the cold snap all move the true peak in steps;
   *  drawn raw, each step read as a flash (user report). */
  SHOW_RISE_SEC: 0.18,
  SHOW_FALL_SEC: 0.9,
  /** A body whose drawn heat has faded below this leaves the set. */
  SHOW_MIN: 0.01,
  /** Heat also caps mechanical weakening from running away with it. */
  MAX_WEAKENING: 4,
  /** Hard cap on how many bodies can be heated at once.  Past it, new
   *  bodies still take the immediate effect but are not tracked for
   *  cooling/burn — a bounded set, whatever happens on screen. */
  MAX_HEATED: 400,
  /** Conduction (metal) runs on a cadence, to at most this many neighbours. */
  CONDUCT_INTERVAL_SEC: 0.25,
  CONDUCT_NEIGHBOURS: 3,
  CONDUCT_RADIUS: 70,
  /** A hull (the player's, an enemy's) TOUCHING a hot body takes heat by
   *  conduction when their surfaces are within this gap. */
  CONTACT_GAP: 6,

  // RADIANT HEAT — light carries heat (user call).  A hot body is a light
  // source whose power follows T⁴ (`heatRadiance`) × the material's
  // emissivity (`look.heatEmit`), and what reaches a neighbour is the share
  // of that light its silhouette intercepts at that distance.
  /** Radiant power (damage units/s) of a body at heat 1 with emissivity 1. */
  RADIATE_POWER: 60,
  /** How far radiant heat is worth tracking. */
  RADIATE_RADIUS: 130,
  /** Bodies below this heat do not radiate enough to matter. */
  RADIATE_MIN_HEAT: 0.25,
  /** At most this many radiators per effect tick, and receivers each. */
  RADIATE_MAX_SOURCES: 48,
  RADIATE_MAX_RECEIVERS: 8,

  // ELECTRIC chain caps (§6).  Every chain respects ALL of these.
  CHAIN_MAX_HOPS: 4,
  CHAIN_MAX_TARGETS: 12,
  CHAIN_MAX_RADIUS: 420,       // from the chain's ORIGIN
  CHAIN_HOP_RANGE: 150,        // per hop
  CHAIN_BRANCHES: 2,
  CHAIN_ATTENUATION: 0.72,     // magnitude × this × the conductivity of the body it passes through
  CHAIN_MIN_CONDUCTIVITY: 0.02, // below: a true insulator — the arc lands and goes no further
  CHAIN_MIN_MAGNITUDE: 0.25,   // below: the chain has run out
  CHAIN_CANDIDATES: 48,        // max bodies considered per hop query

  // MATERIAL → HEAT DERIVATIONS.  Each is calibrated so ROCK is unchanged
  // from the hand-set table these replaced (capacity 30, ceiling 2.5).
  /** Energy per unit of normalised heat, per J/(g·K) of specific heat. */
  HEAT_CAPACITY_PER_SPECIFIC: 37.5,
  /** A material's heat ceiling, per J/(g·K) of specific heat. */
  MAX_HEAT_PER_SPECIFIC: 3.125,
  /** Hot-spot spreading speed (world units²/s) per unit of thermal
   *  conductivity.  Presentation only. */
  SPREAD_PER_CONDUCTIVITY: 400,
  /** Share of the heat DIFFERENCE crossing to one neighbour per conduct tick,
   *  per unit of the pair's (harmonic-mean) thermal conductivity. */
  CONDUCT_PER_CONDUCTIVITY: 0.15,
} as const;

// ── Heat ─────────────────────────────────────────────────────────────────────

/** Heat a body gains from a thermal packet of `magnitude` (damage units). */
export function heatGain(mat: MaterialId, magnitude: number): number {
  const r = responseOf(mat);
  const m = safeMag(magnitude);
  const cap = heatCapacityOf(mat);
  if (!(cap > 0)) return 0;
  return (m * r.heatAbsorb) / cap;
}

/** Energy (damage units) one unit of normalised heat costs — derived from the
 *  material's specific heat. */
export function heatCapacityOf(mat: MaterialId | string | undefined): number {
  return responseOf(mat).specificHeat * ENERGY_CONSTANTS.HEAT_CAPACITY_PER_SPECIFIC;
}

/** The hottest this material can get — derived from its specific heat, and
 *  never above the global MAX_HEAT. */
export function maxHeatOf(mat: MaterialId | string | undefined): number {
  return Math.min(ENERGY_CONSTANTS.MAX_HEAT,
    responseOf(mat).specificHeat * ENERGY_CONSTANTS.MAX_HEAT_PER_SPECIFIC);
}

/** How fast a hot spot spreads through a body of this material. */
export function thermalDiffusivityOf(mat: MaterialId | string | undefined): number {
  return responseOf(mat).thermalConductivity * ENERGY_CONSTANTS.SPREAD_PER_CONDUCTIVITY;
}

/** Share of the heat difference that crosses between two touching bodies per
 *  conduct tick.  The HARMONIC mean of their conductivities — two materials in
 *  series — so metal↔metal is fast, metal↔rock slow and rock↔rock barely
 *  moves, and an insulator on either side throttles the pair. */
export function conductShare(a: MaterialId | string | undefined, b: MaterialId | string | undefined): number {
  const ka = responseOf(a).thermalConductivity, kb = responseOf(b).thermalConductivity;
  if (!(ka > 0) || !(kb > 0)) return 0;
  return ENERGY_CONSTANTS.CONDUCT_PER_CONDUCTIVITY * (2 * ka * kb) / (ka + kb);
}

/** Clamp heat into [0, ceiling]; NaN → 0.  Pass the body's material
 *  ceiling (`maxHeatOf`); the default is the global one. */
export function clampHeat(h: number, ceiling: number = ENERGY_CONSTANTS.MAX_HEAT): number {
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.min(h, ceiling);
}

/** One cooling step.  Exponential, and snaps to 0 below HEAT_EPSILON so a
 *  body actually becomes COLD (and leaves the active set) in finite time. */
export function coolHeat(mat: MaterialId, heat: number, dt: number): number {
  const r = responseOf(mat);
  const h = clampHeat(heat, maxHeatOf(mat)) * Math.exp(-r.coolingPerSec * Math.max(0, dt));
  return h < ENERGY_CONSTANTS.HEAT_EPSILON ? 0 : h;
}

// ── Heat distribution (presentation) ─────────────────────────────────────────
//
// A body's `heat` is one number and every SIM rule reads only that.  Where the
// heat sits INSIDE the body is carried separately as a single Gaussian hot
// spot — a centre in the body's local frame and a spread σ — which is all the
// renderer needs to draw heat radiating from where it went in.
//
// Two exact results for a Gaussian are all it takes:
//   - DIFFUSION: a Gaussian stays Gaussian, with σ² growing by 4αt (2D), so
//     spreading is one sqrt per tick and needs no grid.
//   - A NEW DEPOSIT merges by MOMENT MATCHING: the combined centre is the
//     heat-weighted mean of the two centres, and the combined σ² keeps the
//     same second moment (each σ² plus its centre's squared offset from the
//     new mean).  Heat-weighted, so a big old spot drifts only slightly toward
//     a small new one.

/** σ after `dt` seconds of diffusion, capped at `cap` (the spot has filled
 *  the body — past that it is uniform and further growth means nothing). */
export function diffuseSpread(mat: MaterialId, spread: number, dt: number, cap: number): number {
  const a = thermalDiffusivityOf(mat);
  const s = Number.isFinite(spread) && spread > 0 ? spread : 0;
  const out = Math.sqrt(s * s + 4 * Math.max(0, a) * Math.max(0, dt));
  return Math.min(Number.isFinite(cap) && cap > 0 ? cap : out, out);
}

/** Merge a new deposit of `gain` at (px, py) with spot size `s0` into an
 *  existing spot (x, y, spread) that holds `heat`.  Writes into `out`
 *  (x, y, spread) so the hot path allocates nothing. */
export function mixHeatSpot(
  heat: number, x: number, y: number, spread: number,
  gain: number, px: number, py: number, s0: number,
  out: { x: number; y: number; spread: number },
): void {
  const w0 = heat > 0 && Number.isFinite(heat) ? heat : 0;
  const w1 = gain > 0 && Number.isFinite(gain) ? gain : 0;
  const W = w0 + w1;
  if (W <= 0) { out.x = px; out.y = py; out.spread = s0; return; }
  const mx = (w0 * x + w1 * px) / W, my = (w0 * y + w1 * py) / W;
  const d0 = (x - mx) * (x - mx) + (y - my) * (y - my);
  const d1 = (px - mx) * (px - mx) + (py - my) * (py - my);
  const v = (w0 * (spread * spread + d0) + w1 * (s0 * s0 + d1)) / W;
  out.x = mx; out.y = my; out.spread = Math.sqrt(Math.max(v, 0));
}

/** Peak normalised temperature of a spot: the body's MEAN heat concentrated
 *  into a Gaussian of σ = `spread` over a body of radius `bodyR`.  Never
 *  below the mean (a spot that has filled the body is uniform), and capped
 *  so a pinpoint deposit cannot read as infinitely hot. */
export function heatPeak(heat: number, spread: number, bodyR: number): number {
  if (!(heat > 0)) return 0;
  const s = Math.max(spread, 1e-3);
  const concentrated = heat * (bodyR * bodyR) / (2 * s * s);
  return Math.min(ENERGY_CONSTANTS.MAX_HEAT, Math.max(heat, concentrated));
}

/** Visible radiance of a spot at normalised temperature `t`.  A body glows by
 *  T⁴ (Stefan–Boltzmann), measured above the ambient it already sits at, so
 *  warm reads as barely there and near-critical reads as a light source.
 *  0 at t = 0, 1 at t = 1. */
/** One step of the DRAWN temperature easing toward `target` (presentation
 *  only — no sim rule reads it).  Exponential in both directions, rising at
 *  `SHOW_RISE_SEC` and falling at `SHOW_FALL_SEC`, so a jump in the true
 *  peak becomes a blend instead of a flash, and a body cooling to exactly
 *  zero fades out rather than vanishing. */
export function easeShownHeat(shown: number, target: number, dt: number): number {
  const s = Number.isFinite(shown) && shown > 0 ? shown : 0;
  const t = Number.isFinite(target) && target > 0 ? target : 0;
  const tau = t > s ? ENERGY_CONSTANTS.SHOW_RISE_SEC : ENERGY_CONSTANTS.SHOW_FALL_SEC;
  const out = s + (t - s) * (1 - Math.exp(-Math.max(0, dt) / tau));
  return out < ENERGY_CONSTANTS.SHOW_MIN && t <= 0 ? 0 : out;
}

export function heatRadiance(t: number): number {
  if (!(t > 0)) return 0;
  const T0 = 0.35;
  const hi = (1 + T0) ** 4 - T0 ** 4;
  return Math.min(1.5, ((t + T0) ** 4 - T0 ** 4) / hi);
}

/** Multiplier on MECHANICAL energy for a body at `heat` — how heat lowers the
 *  fracture threshold.  1 when cold; bounded by MAX_WEAKENING. */
export function mechanicalScale(mat: MaterialId, heat: number | undefined): number {
  const h = clampHeat(heat ?? 0);
  if (h <= 0) return 1;
  return Math.min(ENERGY_CONSTANTS.MAX_WEAKENING, 1 + responseOf(mat).heatWeakening * Math.min(h, 1));
}

// ── Electric chain planner ───────────────────────────────────────────────────

export interface ChainNode { e: GameEntity; mag: number; depth: number; from: GameEntity | null }

/** The caps a chain is planned under.  Defaults are ENERGY_CONSTANTS; the
 *  weapon combos narrow them (a spread's forks are short, a nova is wide). */
export interface ChainCaps {
  maxHops: number; maxTargets: number; maxRadius: number; hopRange: number; branches: number;
}
export function defaultChainCaps(): ChainCaps {
  const C = ENERGY_CONSTANTS;
  return { maxHops: C.CHAIN_MAX_HOPS, maxTargets: C.CHAIN_MAX_TARGETS,
           maxRadius: C.CHAIN_MAX_RADIUS, hopRange: C.CHAIN_HOP_RANGE, branches: C.CHAIN_BRANCHES };
}

/**
 * Plan a BOUNDED electric chain.  Pure: the caller supplies `neighbours`, a
 * spatial query that fills `out` with bodies near (x,y) (and must itself be
 * bounded — the engine's is a grid radius walk capped at CHAIN_CANDIDATES),
 * and `dist` for torus distance.  Guarantees, whatever the query returns:
 *
 *  - no body is visited twice (a visited set by id — cycles terminate);
 *  - at most `maxHops` levels, `maxTargets` bodies, all within `maxRadius`
 *    of the origin and `hopRange` of their parent;
 *  - magnitude attenuates every hop by CHAIN_ATTENUATION × the conductivity
 *    of the body the current passes THROUGH to make that hop, so a poor
 *    conductor (glass, rock, plastic) passes on only a weak arc and a metal
 *    plate passes on nearly all of it.  Only a body below
 *    CHAIN_MIN_CONDUCTIVITY is a dead end (it takes its arc, nothing more);
 *  - it stops when magnitude falls below CHAIN_MIN_MAGNITUDE.
 *
 * Candidate order is conductivity-weighted distance (d / conductivity), so an
 * arc prefers the metal plate over the nearer glass pane beside it.
 */
export function planChain(
  first: GameEntity | null,
  origin: { x: number; y: number },
  magnitude: number,
  caps: ChainCaps,
  neighbours: (x: number, y: number, r: number, out: GameEntity[]) => void,
  dist: (ax: number, ay: number, bx: number, by: number) => number,
  exclude?: (e: GameEntity) => boolean,
): ChainNode[] {
  const C = ENERGY_CONSTANTS;
  const out: ChainNode[] = [];
  const visited = new Set<string>();
  let frontier: ChainNode[] = [];
  const mag0 = safeMag(magnitude);
  if (mag0 <= 0) return out;
  if (first) {
    const n = { e: first, mag: mag0, depth: 0, from: null };
    out.push(n); visited.add(first.id);
    if (responseOf(materialOf(first)).conductivity >= C.CHAIN_MIN_CONDUCTIVITY) frontier.push(n);
  }
  const maxHops = Math.max(0, Math.min(caps.maxHops, 16));
  const maxTargets = Math.max(1, Math.min(caps.maxTargets, 64));
  const buf: GameEntity[] = [];
  const scored: { e: GameEntity; s: number; c: number }[] = [];
  // No first body (a beam arcing from the ship, a nova): the ORIGIN is the
  // parent of depth 1.
  const originNode: ChainNode | null = first ? null
    : { e: null as unknown as GameEntity, mag: mag0, depth: 0, from: null };
  if (originNode) frontier.push(originNode);

  for (let depth = 1; depth <= maxHops && frontier.length > 0 && out.length < maxTargets; depth++) {
    const next: ChainNode[] = [];
    for (const parent of frontier) {
      if (out.length >= maxTargets) break;
      const px = parent.e ? parent.e.position.x : origin.x;
      const py = parent.e ? parent.e.position.y : origin.y;
      buf.length = 0;
      neighbours(px, py, caps.hopRange, buf);
      scored.length = 0;
      for (let i = 0; i < buf.length && i < C.CHAIN_CANDIDATES; i++) {
        const e = buf[i];
        if (!e.active || e.isExploding || visited.has(e.id)) continue;
        if (exclude && exclude(e)) continue;
        const c = responseOf(materialOf(e)).conductivity;
        if (!(c > 0.01)) continue;
        const d = dist(px, py, e.position.x, e.position.y);
        if (!(d <= caps.hopRange)) continue;
        if (dist(origin.x, origin.y, e.position.x, e.position.y) > caps.maxRadius) continue;
        scored.push({ e, s: d / c, c });
      }
      scored.sort((a, b) => a.s - b.s);
      let taken = 0;
      for (const s of scored) {
        if (taken >= caps.branches || out.length >= maxTargets) break;
        if (visited.has(s.e.id)) continue;
        // The current reaches this body THROUGH the parent, so it carries the
        // parent's conductivity (an arc from the origin is not attenuated
        // by a body).  Continuous, not a switch: glass passes a weak arc.
        const pc = parent.e ? responseOf(materialOf(parent.e)).conductivity : 1;
        const mag = parent.mag * C.CHAIN_ATTENUATION * Math.min(1, pc);
        if (mag < C.CHAIN_MIN_MAGNITUDE) continue;
        visited.add(s.e.id);
        const node: ChainNode = { e: s.e, mag, depth, from: parent.e ?? null };
        out.push(node);
        taken++;
        if (s.c >= C.CHAIN_MIN_CONDUCTIVITY) next.push(node);
      }
    }
    frontier = next;
  }
  return out;
}

// ── Fracture profiles (§7) ───────────────────────────────────────────────────
//
// THE EXISTING VORONOI IS DRIVEN, NOT REPLACED.  A profile is THREE numbers,
// and each one scales a parameter the fracture path already has:
//
//   `siteScale` → the pattern's SITE COUNT (fractureCache, beside the global
//        DBG "Frac sites" multiplier and composing with it) — fewer sites,
//        fewer and larger pieces.  Read at FIRST decomposition only: a
//        pattern is fixed once made (V8).
//   `bias`      → the pattern's IMPACT BIAS (`grain.impactBias`); undefined
//        keeps the material's own.
//   `impulse`   → the shatter's post-fracture SCATTER (the cell radial speed
//        and the forward term from `lastImpactVelocity`): 0 is a quiet
//        collapse where the body stood.
//
// A COLD MECHANICAL BREAK KEEPS THE MATERIAL'S OWN GRAIN.  Grain size,
// regularity and bond strength are play-tested material identity (metal fine
// and near-honeycomb, grain size a material constant — pinned by
// tests/fracture.spec.ts), and the kinetic path is the existing destruction,
// so the mechanical profile changes only how hard the pieces FLY: glass
// sprays, rock throws chunks, metal and plastic barely scatter.  What changes
// the GEOMETRY is heat: a body that is HOT when it breaks — whatever delivers
// the final blow (`HOT_BREAK_HEAT`) — breaks under the THERMAL profile, fewer
// and larger pieces that barely move.  That is the sequential interaction the
// materials are specified by (glass: heat → thermal-stress failure; metal:
// heat then a slug → few, large, heavy, slow pieces) with no combo
// bookkeeping, and it is also the MINING hook: violent → the material's small
// grains, controlled thermal → big pieces.
//
// A GAS (nebula) HAS NO PROFILE — it is not a solid and never enters the solid
// fracture path (§8).  A profile never changes a material's TOUGHNESS: the
// boundary model rescales a thermal pattern's bond strength to keep derived
// HP (fractureCache `profileBondScale`).

/** Heat at or above which a breaking body takes the thermal profile. */
export const HOT_BREAK_HEAT = 0.5;

/** Resolve a profile.  Electric resolves as MECHANICAL — a conducted arc
 *  cracks like an impact.  A GAS has no profile.  A bigger mechanical hit flings its pieces a little harder;
 *  heat never does. */
export function fractureProfile(mat: MaterialId, domain: EnergyDomain, magnitude: number): FractureProfile | null {
  const base = materialDef(mat).fracture;
  if (!base) return null;
  const p = domain === 'thermal' ? base.thermal : base.mechanical;
  const bump = domain === 'thermal' ? 0 : Math.min(1, safeMag(magnitude) / 40);
  return {
    siteScale: clamp(p.siteScale, 0.25, 2),
    bias: p.bias === undefined ? undefined : clamp(p.bias, 0, 1),
    impulse: clamp(p.impulse * (1 + 0.3 * bump), 0, 2.5),
  };
}

/** Stamp the profile of an energy event onto a body (the ONE writer).  A
 *  body already HOT breaks under the thermal profile whatever the energy.
 *  Nebula and non-structure bodies are left alone. */
export function stampFractureProfile(e: GameEntity, domain: EnergyDomain, magnitude: number): void {
  if (!e.shardVariant) return;
  const effective: EnergyDomain = domain !== 'thermal' && (e.heat ?? 0) >= HOT_BREAK_HEAT ? 'thermal' : domain;
  const p = fractureProfile(materialOf(e), effective, magnitude);
  if (p) e.fractureProfile = p;
}

function clamp(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;
}

/** The domain a modifier's packets arrive in. */
export function domainOf(mod: EnergyModifier | null | undefined): EnergyDomain {
  switch (mod) {
    case 'thermal': return 'thermal';
    case 'electric': return 'electric';
    default: return 'mechanical';
  }
}
