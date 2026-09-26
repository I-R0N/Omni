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

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** HOW energy arrives.  A gun module IS one of these. */
export type Delivery = 'projectile' | 'beam' | 'spread' | 'homing' | 'radial';
export const DELIVERIES: readonly Delivery[] = ['projectile', 'beam', 'spread', 'homing', 'radial'];

/** WHAT KIND of energy a delivery carries.  An energy MODIFIER module is one
 *  of these; an unmodified delivery fires plain (weak) kinetic energy. */
export type EnergyModifier = 'kinetic' | 'electric' | 'thermal' | 'magnetic' | 'explosive';
export const ENERGY_MODIFIERS: readonly EnergyModifier[] =
  ['kinetic', 'electric', 'thermal', 'magnetic', 'explosive'];

/** The four PHYSICAL domains a material answers to.  Explosive is not one —
 *  it is a COMPOSITE that emits a mechanical and a thermal packet (§5). */
export type EnergyDomain = 'mechanical' | 'thermal' | 'electric' | 'magnetic';

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
  CANNON:    'projectile+explosive',
  // Catalog ids of the retired gun modules.
  wpn_blaster: 'projectile', wpn_burst: 'projectile+kinetic', wpn_shotgun: 'spread+kinetic',
  wpn_bouncer: 'beam+thermal', wpn_lightning: 'projectile+electric',
  wpn_homing: 'homing+kinetic', wpn_cannon: 'projectile+explosive',
};

/** Normalise any id — new key, old enum name, old catalog id — to a key. */
export function resolveWeaponKey(id: string | null | undefined): WeaponKey | null {
  if (!id) return null;
  if (parseWeaponKey(id)) return id;
  return LEGACY_WEAPON_MAP[id] ?? null;
}

// ── Materials ────────────────────────────────────────────────────────────────

/** A material is a small reusable property, not a tile flag: terrain derives
 *  it from its shard variant, and ANY entity may set `GameEntity.material`
 *  to opt in (a metal enemy is `material: 'metal'` away from a real metal
 *  response).  `generic` is the safe default for everything else. */
export type MaterialId = 'rock' | 'glass' | 'metal' | 'plastic' | 'nebula' | 'generic';

export function materialOf(e: GameEntity): MaterialId {
  if (e.material) return e.material;
  const v = e.shardVariant;
  if (!v) return 'generic';
  if (v.startsWith('rock')) return 'rock';
  if (v.startsWith('glass')) return 'glass';
  if (v.startsWith('metal')) return 'metal';
  if (v.startsWith('plastic')) return 'plastic';
  if (v.startsWith('nebula')) return 'nebula';
  return 'generic';   // indestructible, unknown
}

export interface MaterialResponse {
  /** MECHANICAL.  How much weaker a HOT body is to kinetic energy:
   *  damage × (1 + heatWeakening × heat).  This is the threshold drop —
   *  under the grain model a body's HP is its boundary total, so scaling
   *  what a hit spends on the boundaries IS lowering the threshold. */
  heatWeakening: number;
  /** THERMAL.  Fraction of a thermal packet that becomes heat, and how much
   *  energy (damage units) one unit of normalised heat costs. */
  heatAbsorb: number;
  heatCapacity: number;
  /** Fraction of heat lost per second (exponential cooling). */
  coolingPerSec: number;
  /** Fraction of heat passed to each nearby same-material body per conduct
   *  tick (metal only in practice). */
  conduct: number;
  /** Boundary damage per second at heat 1 — thermal cracking / softening /
   *  burning.  0 = heat never damages on its own. */
  thermalDps: number;
  /** Heat at which the body fails OUTRIGHT under the thermal profile (glass
   *  thermal fracture).  Infinity = never. */
  thermalFailAt: number;
  /** Heat above which cohesion bonds let go (plastic). Infinity = never. */
  bondReleaseAt: number;
  /** ELECTRIC.  0..1: 1 conducts perfectly, <CHAIN_MIN_CONDUCTIVITY is a
   *  terminal (the arc lands, nothing propagates). */
  conductivity: number;
  /** Fraction of an arc's magnitude that becomes damage. */
  electricDamage: number;
  /** MAGNETIC.  0..1 susceptibility; only metal is non-zero (nebula borrows
   *  a value while ENERGIZED — see `magneticSusceptibility`). */
  magnetic: number;
  /** THERMAL DIFFUSIVITY (world units² / s) — how fast a hot spot spreads
   *  through the body from where the heat went in.  Presentation only: the
   *  sim still reads the body's one `heat` value.  Metal smears a spot across
   *  a whole plate in well under a second; glass, rock and plastic hold it
   *  where it landed. */
  thermalDiffusivity: number;
}

/**
 * THE MATERIAL TABLE (§8).  Coefficients live here; BEHAVIOUR lives in the
 * paths that read them (glass fails under the thermal PROFILE, plastic lets
 * its bonds go, metal conducts and gets dragged, nebula is energised and then
 * steerable).  Read it as "what is this stuff", not as a damage chart.
 */
export const MATERIAL_RESPONSE: Readonly<Record<MaterialId, MaterialResponse>> = {
  //            weak   abs   cap  cool  cond  dps   fail      bonds     cond. eDmg  mag
  rock:    { heatWeakening: 1.5, heatAbsorb: 0.8, heatCapacity: 30, coolingPerSec: 0.25, conduct: 0,
             thermalDps: 1.5, thermalFailAt: Infinity, bondReleaseAt: Infinity,
             conductivity: 0.15, electricDamage: 0.3, magnetic: 0, thermalDiffusivity: 30 },
  glass:   { heatWeakening: 1.0, heatAbsorb: 0.9, heatCapacity: 24, coolingPerSec: 0.15, conduct: 0,
             thermalDps: 0, thermalFailAt: 1.0, bondReleaseAt: Infinity,
             conductivity: 0.05, electricDamage: 0.2, magnetic: 0, thermalDiffusivity: 12 },
  metal:   { heatWeakening: 2.5, heatAbsorb: 0.7, heatCapacity: 40, coolingPerSec: 0.35, conduct: 0.15,
             thermalDps: 0, thermalFailAt: Infinity, bondReleaseAt: Infinity,
             conductivity: 1.0, electricDamage: 1.0, magnetic: 1.0, thermalDiffusivity: 160 },
  plastic: { heatWeakening: 0.5, heatAbsorb: 1.0, heatCapacity: 12, coolingPerSec: 0.2, conduct: 0,
             thermalDps: 60, thermalFailAt: Infinity, bondReleaseAt: 0.3,
             conductivity: 0.03, electricDamage: 0.1, magnetic: 0, thermalDiffusivity: 8 },
  nebula:  { heatWeakening: 0, heatAbsorb: 1.0, heatCapacity: 8, coolingPerSec: 0.5, conduct: 0,
             thermalDps: 0, thermalFailAt: Infinity, bondReleaseAt: Infinity,
             conductivity: 0.7, electricDamage: 0, magnetic: 0, thermalDiffusivity: 60 },
  // Enemies, the player, indestructible terrain, anything unknown: a hull.
  // Conducts (ships are machines — the old Lightning chained through them),
  // burns (heat is a DoT), not magnetic until something declares `metal`.
  generic: { heatWeakening: 0.5, heatAbsorb: 0.8, heatCapacity: 20, coolingPerSec: 0.4, conduct: 0,
             thermalDps: 5, thermalFailAt: Infinity, bondReleaseAt: Infinity,
             conductivity: 0.8, electricDamage: 1.0, magnetic: 0, thermalDiffusivity: 40 },
};

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
  MAX_HEAT: 2.5,
  /** Below this a body is COLD and leaves the active-heated set. */
  HEAT_EPSILON: 0.02,
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

  // ELECTRIC chain caps (§6).  Every chain respects ALL of these.
  CHAIN_MAX_HOPS: 4,
  CHAIN_MAX_TARGETS: 12,
  CHAIN_MAX_RADIUS: 420,       // from the chain's ORIGIN
  CHAIN_HOP_RANGE: 150,        // per hop
  CHAIN_BRANCHES: 2,
  CHAIN_ATTENUATION: 0.72,     // magnitude × this × target conductivity per hop
  CHAIN_MIN_CONDUCTIVITY: 0.3, // below: the arc lands but does not propagate
  CHAIN_MIN_MAGNITUDE: 0.25,   // below: the chain has run out
  CHAIN_CANDIDATES: 48,        // max bodies considered per hop query
  /** How long a nebula body stays ENERGISED (steerable by magnetism). */
  ENERGIZE_SEC: 3.5,

  // MAGNETIC caps.
  MAG_MAX_TARGETS: 40,
  MAG_MAX_RADIUS: 360,
  /** Max velocity change one pulse may add to any body (no runaway force). */
  MAG_MAX_DV: 14,
  /** Susceptibility an ENERGISED nebula body borrows. */
  MAG_NEBULA_ENERGIZED: 0.6,
  /** A static metal tile at or below this health fraction is LOOSE: a strong
   *  enough pull drags a grain free (through the ordinary chip path). */
  MAG_LOOSE_HEALTH_FRAC: 0.6,
  MAG_LOOSE_MIN_PULL: 4,

  // EXPLOSIVE composite: of a detonation's magnitude, this fraction arrives as
  // HEAT on each body the blast reaches, beside the existing mechanical ring.
  EXPLOSIVE_THERMAL_FRAC: 0.3,
  EXPLOSIVE_MAX_TARGETS: 48,
} as const;

// ── Heat ─────────────────────────────────────────────────────────────────────

/** Heat a body gains from a thermal packet of `magnitude` (damage units). */
export function heatGain(mat: MaterialId, magnitude: number): number {
  const r = responseOf(mat);
  const m = safeMag(magnitude);
  if (!(r.heatCapacity > 0)) return 0;
  return (m * r.heatAbsorb) / r.heatCapacity;
}

/** Clamp heat into [0, MAX_HEAT]; NaN → 0. */
export function clampHeat(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.min(h, ENERGY_CONSTANTS.MAX_HEAT);
}

/** One cooling step.  Exponential, and snaps to 0 below HEAT_EPSILON so a
 *  body actually becomes COLD (and leaves the active set) in finite time. */
export function coolHeat(mat: MaterialId, heat: number, dt: number): number {
  const r = responseOf(mat);
  const h = clampHeat(heat) * Math.exp(-r.coolingPerSec * Math.max(0, dt));
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
  const a = responseOf(mat).thermalDiffusivity;
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

// ── Magnetic ─────────────────────────────────────────────────────────────────

/** 0..1.  Metal always; nebula only while energised; everything else 0. */
export function magneticSusceptibility(e: GameEntity, simClock: number): number {
  const mat = materialOf(e);
  if (mat === 'nebula') {
    return (e.energizedUntil ?? -Infinity) > simClock ? ENERGY_CONSTANTS.MAG_NEBULA_ENERGIZED : 0;
  }
  return responseOf(mat).magnetic;
}

/** Velocity change for a body under a pulse of `strength` at distance `d`
 *  of `radius`.  Linear falloff, divided by mass relative to a reference so
 *  a boulder moves less than a chip, and capped (MAG_MAX_DV). */
export function magneticDv(strength: number, d: number, radius: number, mass: number, susceptibility: number): number {
  const s = safeMag(strength, 100);
  if (!(radius > 0) || !(susceptibility > 0) || !(d >= 0) || d >= radius) return 0;
  const fall = 1 - d / radius;
  const m = Number.isFinite(mass) && mass > 0 ? mass : Infinity;
  if (m === Infinity) return 0;
  const massFactor = Math.min(3, Math.sqrt(MAG_REFERENCE_MASS / m));
  return Math.min(ENERGY_CONSTANTS.MAG_MAX_DV, s * fall * susceptibility * massFactor);
}
/** A mid-size metal shard, in scaled mass units. */
const MAG_REFERENCE_MASS = 60;

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
 *  - magnitude attenuates every hop by CHAIN_ATTENUATION × conductivity, and
 *    a body below CHAIN_MIN_CONDUCTIVITY is a TERMINAL: it takes its arc and
 *    the chain does not continue through it (glass, plastic, rock);
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
        const pc = parent.e ? responseOf(materialOf(parent.e)).conductivity : 1;
        const mag = parent.mag * C.CHAIN_ATTENUATION * Math.min(1, Math.max(pc, s.c));
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
// NEBULA HAS NO PROFILE — it is not a solid and never enters the solid
// fracture path (§8).  A profile never changes a material's TOUGHNESS: the
// boundary model rescales a thermal pattern's bond strength to keep derived
// HP (fractureCache `profileBondScale`).

export interface FractureProfile { siteScale: number; bias?: number; impulse: number }

/** Heat at or above which a breaking body takes the thermal profile. */
export const HOT_BREAK_HEAT = 0.5;

type SolidMaterial = Exclude<MaterialId, 'nebula'>;
const FRACTURE_BASE: Readonly<Record<SolidMaterial, Record<'mechanical' | 'thermal', FractureProfile>>> = {
  // Glass: a violent mechanical SHATTER (flung hard) against a thermal
  // STRESS failure (few, large, quiet pieces) — the headline contrast.
  glass:   { mechanical: { siteScale: 1, impulse: 1.5 },
             thermal:    { siteScale: 0.45, bias: 0.0, impulse: 0.2 } },
  // Rock: chunky and localised, carrying real momentum.
  rock:    { mechanical: { siteScale: 1, impulse: 1.15 },
             thermal:    { siteScale: 0.7, bias: 0.25, impulse: 0.5 } },
  // Metal: heavy and slow whatever broke it; the fewest, largest pieces of
  // any solid once heat has had it.
  metal:   { mechanical: { siteScale: 1, impulse: 0.4 },
             thermal:    { siteScale: 0.35, bias: 0.1, impulse: 0.25 } },
  // Plastic: gives rather than shatters.
  plastic: { mechanical: { siteScale: 1, impulse: 0.7 },
             thermal:    { siteScale: 0.6, bias: 0.1, impulse: 0.3 } },
  generic: { mechanical: { siteScale: 1, impulse: 1 },
             thermal:    { siteScale: 0.7, bias: 0.25, impulse: 0.5 } },
};

/** Resolve a profile.  Electric and magnetic resolve as MECHANICAL — a
 *  conducted arc cracks like an impact, a magnetically driven slam IS an
 *  impact.  A bigger mechanical hit flings its pieces a little harder;
 *  heat never does. */
export function fractureProfile(mat: MaterialId, domain: EnergyDomain, magnitude: number): FractureProfile | null {
  if (mat === 'nebula') return null;
  const base = FRACTURE_BASE[mat as SolidMaterial] ?? FRACTURE_BASE.generic;
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

// ── Explosive composite ──────────────────────────────────────────────────────

export interface EnergyPacket {
  domain: EnergyDomain;
  magnitude: number;
  x: number; y: number;
  dirX: number; dirY: number;
}

/** A detonation's packets: the mechanical impulse (dominant) and a smaller
 *  thermal packet at the same point.  Materials then answer through their
 *  ordinary mechanical and thermal columns. */
export function explosivePackets(x: number, y: number, magnitude: number): EnergyPacket[] {
  const m = safeMag(magnitude);
  return [
    { domain: 'mechanical', magnitude: m, x, y, dirX: 0, dirY: 0 },
    { domain: 'thermal', magnitude: m * ENERGY_CONSTANTS.EXPLOSIVE_THERMAL_FRAC, x, y, dirX: 0, dirY: 0 },
  ];
}

/** The domain a modifier's packets arrive in (explosive → its dominant). */
export function domainOf(mod: EnergyModifier | null | undefined): EnergyDomain {
  switch (mod) {
    case 'thermal': return 'thermal';
    case 'electric': return 'electric';
    case 'magnetic': return 'magnetic';
    default: return 'mechanical';
  }
}
