/** The fracture-decomposition CACHE policy (voronoi gauntlet, V3).
 *
 *  One accessor pair shared by the SIM (ShardSystem.shatterVoronoiStyle
 *  consumes cells at death) and the RENDER layer (overlayMaterialCracks
 *  draws the interior edges as the entity's cracks) — the whole point of
 *  the gauntlet is that those two read the SAME decomposition, so the
 *  accessor cannot live in either layer.  Pure geometry stays in
 *  `fracture.ts` (no engine imports); THIS module owns the entity-facing
 *  policy: which variants fracture (`SHARD_VARIANTS[..].fracture`), the
 *  site-count mapping, the impact-point derivation, and the caching.
 *
 *  Laziness contract (the perf budget rule): nothing here runs per frame
 *  once cached — `ensureFractureCells` / `ensureFractureEdges` are O(1)
 *  lookups after the first call, and the first call happens at a damage
 *  event (crack draw or death), never in a steady-state path.
 *  Invalidation sites (compose, dent, plastic snap-back) clear BOTH
 *  fields; `applyDentStep` deliberately skips invalidation on the
 *  KILLING blow (health already ≤ 0) so the fragments separate along
 *  exactly the cracks the player was just shown.
 */

import { GameEntity, Vector2 } from '../../types';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';
import {
  SHARD_VARIANTS, FRACTURE_DETACH,
  getFractureRelaxOverride, getFractureSeparationOverride, getFractureSiteScale,
  grainRelaxFor, grainSeparationFor,
  getFractureBiasOverride, getFractureTuningGen,
  isProgressiveFracture, getBoundaryStrengthScale, grainSpecFor,
  getDamageSpreadOverride,
} from '../../constants';
import {
  computeFracture, collectInteriorEdges, seedFromEntityId, mulberry32,
  unionOfCells, onParentBoundary, pointToPolygonDistance2,
  polygonArea, polygonCentroid,
  FractureCell, FractureEdge,
} from './fracture';

/** The impact point in entity-LOCAL coords.  Prefers the REAL contact
 *  position stamped by the damage path (V12); falls back to the old
 *  direction proxy derived from `lastImpactVelocity` (the hit landed on
 *  the side the impactor came from) for damage sources that carry no
 *  contact point.  Null when neither is available. */
/** Record a damage event's REAL contact point in entity-local coords.
 *  Every damage path calls this before applying damage, so the pattern
 *  is biased toward where the hit landed AND the boundary spend starts
 *  there — one stamp serving the two halves of the model.  Toroidal, so
 *  a body across the seam is not stamped a map-width away. */
export function stampLocalImpact(e: GameEntity, worldPos: Vector2 | undefined): void {
  if (worldPos === undefined) return;
  const dx = wrapDeltaX(e.position.x, worldPos.x);
  const dy = wrapDeltaY(e.position.y, worldPos.y);
  const cs = Math.cos(-e.rotation), sn = Math.sin(-e.rotation);
  e.lastImpactLocal = { x: dx * cs - dy * sn, y: dx * sn + dy * cs };
}

function localImpactPoint(e: GameEntity): { x: number; y: number } | null {
  if (e.lastImpactLocal !== undefined) return e.lastImpactLocal;
  const iv = e.lastImpactVelocity;
  if (iv === undefined) return null;
  const s = Math.hypot(iv.x, iv.y);
  if (s <= 1e-3) return null;
  const size = Math.max(e.size.x, e.size.y);
  const cos = Math.cos(-e.rotation), sin = Math.sin(-e.rotation);
  const lx = (iv.x * cos - iv.y * sin) / s;
  const ly = (iv.x * sin + iv.y * cos) / s;
  const r = size * 0.4;
  return { x: -lx * r, y: -ly * r };
}

/** Compute (or return the cached) seeded Voronoi decomposition of the
 *  entity's polygon.  Null for variants without a `fracture` block or
 *  entities without a usable polygon.  Site count is a function of size
 *  + merge history only — never the killing hit — so the cracks shown
 *  while alive are the exact seams of the eventual break (see
 *  GrainSpec). */
export function ensureFractureCells(e: GameEntity): FractureCell[] | null {
  if (e.shardVariant === undefined) return null;
  const f = grainSpecFor(e.shardVariant);
  if (f === undefined) return null;
  if (e.polygonPoints === undefined || e.polygonPoints.length < 3) return null;
  // A DBG shape knob moved since this pattern was built (V11): drop it so
  // the new setting is visible on the next hit rather than only on
  // freshly-spawned terrain.  In normal play the generation never
  // changes, so this is one number compare on a cache hit.
  const gen = getFractureTuningGen();
  if (e.fractureCells !== undefined) {
    if (e.fractureGen === gen) return e.fractureCells;
    e.fractureCells = undefined;
    e.fractureEdges = undefined;
  }

  // GRAIN COUNT IS PROPORTIONAL TO AREA (user call), so `grainSize` is
  // the grain's own DIAMETER and a material's grains are the same size
  // whatever body they are in.  Counting by DIAMETER instead (the old
  // `size / grainSize`) made count linear in size, so grain area grew
  // with the body: a rock tile's grains measured ~12.7 units across
  // while the same material's shard had ~8.4 — a shard was quietly a
  // finer-grained material than its own tile.
  const bodyArea = polygonArea(e.polygonPoints);
  const grainArea = Math.PI * (f.grainSize * 0.5) ** 2;
  let sites = Math.round((bodyArea / Math.max(1e-6, grainArea)) * getFractureSiteScale());
  const merges = e.mergeCount ?? 1;
  if (merges > 1) sites = Math.max(sites, merges);
  // The FLOOR is the documented exception to constant grain size: a body
  // small enough to be one or two grains has almost no internal boundary
  // and so almost no derived HP, and would die to a single shot.  Below
  // it, grains are finer than the material's own — deliberately.  The
  // CEILING is a performance guard: decomposition is superlinear in site
  // count, so a very large body gets coarser grains rather than hundreds
  // of cells.  Constant grain size holds BETWEEN the two.
  sites = Math.max(f.grainCountMin, Math.min(f.grainCountMax, sites));

  const seed = e.crackSeed ?? (e.crackSeed = seedFromEntityId(e.id));

  const ip = localImpactPoint(e);
  const biasOverride = getFractureBiasOverride();
  const impact = ip !== null
    ? { x: ip.x, y: ip.y, bias: biasOverride ?? f.impactBias }
    : undefined;

  e.fractureEdges = undefined; // edges are derived — never outlive the cells
  e.fractureGen = gen;
  e.fractureCells = computeFracture(e.polygonPoints, {
    siteCount: sites,
    seed,
    impact,
    minAreaFraction: f.minAreaFraction,
    // Per-MATERIAL regularity (A1), with the DBG cycles as overrides
    // rather than the source.  Before this the two knobs were read
    // globally, so every material on the map shared one setting and
    // "metal regular, plastic ragged" could not be said at all.
    relaxIterations: getFractureRelaxOverride() ?? grainRelaxFor(f.regularity),
    minSeparation: getFractureSeparationOverride() ?? grainSeparationFor(f.regularity),
    sizeSpread: f.sizeSpread ?? 0,
  }).cells;
  return e.fractureCells;
}

/** How many of the entity's fracture edges are REVEALED at its current
 *  HP — the ONE formula the crack render and the progressive-detach sim
 *  share, so what the player sees highlighted and what breaks off
 *  cannot disagree (V8).  Runs 0 → all edges linearly over the entity's
 *  hit life: `hits / (maxHp / freq)` of the reveal-ordered edge list
 *  (cell-grouped since V10 — see ensureFractureEdges).
 *  FLOOR pacing on purpose, so an early hit on a small pattern reveals
 *  nothing and the body cracks before it sheds. */
export function fractureRevealedEdgeCount(
  e: GameEntity,
  edgeCount: number,
  freq: number,
): number {
  const maxHp = e.maxHealth ?? 0;
  const hp = e.health ?? maxHp;
  if (maxHp <= 0 || edgeCount <= 0) return 0;
  const hits = Math.floor((maxHp - hp) / freq);
  if (hits <= 0) return 0;
  // The pattern finishes revealing at REVEAL_COMPLETE_FRAC of the hit
  // life, leaving the tail for the last pieces to break off individually
  // instead of being dumped at death.
  const totalHits = Math.max(1, (maxHp / freq) * FRACTURE_DETACH.REVEAL_COMPLETE_FRAC);
  return Math.min(edgeCount, Math.floor((edgeCount * hits) / totalHits));
}

/** The decomposition's interior (bisector) edges — the entity's CRACKS —
 *  in REVEAL ORDER.  The order is fixed at build time: cracks only ever
 *  EXTEND, they never reshuffle between frames.
 *
 *  Ordered CELL BY CELL, nearest the impact first (V10).  Within a cell
 *  its binding edges come out together, so the highlight visibly traces
 *  ONE piece's outline and that piece breaks off when the tracing
 *  completes — which is the mechanic itself, not a presentation choice.
 *  A pure nearest-edge-first sort (V3-V9) looked the same on any single
 *  frame but completed almost nothing until the end: a cell only leaves
 *  when its LAST-RANKED binding edge is revealed, and under a global
 *  distance sort most cells' last edge sits near the end of the list, so
 *  a rock shed one piece mid-life and dumped the rest at death (measured
 *  on a real 9-hit rock tile: 1 piece).  Grouping by cell makes the
 *  cadence roughly one piece per (cell's edge count) hits. */
export function ensureFractureEdges(e: GameEntity): FractureEdge[] | null {
  // Cells FIRST: that call is what drops both caches when a DBG shape
  // knob moved (V11), so checking the edge cache ahead of it would hand
  // back edges belonging to a pattern that no longer exists.  It returns
  // immediately on a hit, so this stays O(1).
  const cells = ensureFractureCells(e);
  if (cells === null || e.polygonPoints === undefined) return null;
  if (e.fractureEdges !== undefined) return e.fractureEdges;
  const edges = collectInteriorEdges(cells, e.polygonPoints);
  const ip = localImpactPoint(e);
  const px = ip !== null ? ip.x : 0;
  const py = ip !== null ? ip.y : 0;
  const d2 = (x: number, y: number) => (x - px) ** 2 + (y - py) ** 2;

  // Cells nearest the impact are traced (and so break off) first.
  const order = cells
    .map(c => ({ site: c.siteIndex, d: d2(c.centroid.x, c.centroid.y) }))
    .sort((a, b) => a.d - b.d);

  const out: FractureEdge[] = [];
  const taken = new Set<FractureEdge>();
  for (const { site } of order) {
    // A cell's own edges, its nearest side first, so each piece's
    // outline is drawn from the impact outward rather than at random.
    const mine = edges.filter(ed => !taken.has(ed) && ed.cells.includes(site));
    mine.sort((a, b) => d2(a.mx, a.my) - d2(b.mx, b.my));
    for (const ed of mine) { taken.add(ed); out.push(ed); }
  }
  // Anything not bound to a surviving cell (shouldn't happen) keeps its
  // distance order at the tail so no edge is ever dropped.
  for (const ed of edges) if (!taken.has(ed)) out.push(ed);

  e.fractureEdges = out;
  return out;
}

// ── GRAIN BOUNDARIES (V15) ────────────────────────────────────────────
// The user's model: damage does not tick down a hand-authored HP pool,
// it ACCUMULATES ON THE BOUNDARIES of the pattern — nearest the impact
// first — and a cell leaves when every boundary still binding it has
// been broken through.  Two things fall out of that rather than being
// declared, which is the point:
//
//   1. HP IS DERIVED.  A body's health is `Σ edge strengths` over its
//      OWN decomposition.  A pattern with more (or longer) internal
//      boundaries is genuinely tougher, and material toughness is one
//      number per variant instead of a per-entity HP table.
//   2. NOTHING SHATTERS AT A LIMIT.  Total damage to break every
//      boundary IS the derived HP, so "health reached zero" and "the
//      last boundary broke" are the same event by construction.  The
//      body is consumed piece by piece; the final cell is the last
//      piece, not a dump of leftovers.
//
// Spill is what keeps (2) exact: damage that finishes an edge flows on
// to the next-nearest unbroken one, so no fraction of a hit is lost and
// the arithmetic cannot drift from the health readout.

/** Damage needed to break one interior boundary: its LENGTH times the
 *  material's strength per unit length.
 *
 *  Absolute length, deliberately not normalised by the body's own size.
 *  Normalising would cancel scale and force a separate strength number
 *  for tiles and for shards of the same material, which is exactly the
 *  "one number per material" the model exists to give.  With absolute
 *  length a big body has more boundary to break and is therefore tougher
 *  for free, and `bondStrength` reads as a real material property:
 *  damage per pixel of grain boundary. */
/** Derive one boundary's strength.  Called ONCE per boundary, at model
 *  build; every later read goes through `edgeNeed`.  That split is what
 *  makes per-grain DEFORMATION safe (B1): denting moves a boundary's
 *  endpoints, so a strength derived from its live length would drift the
 *  body's derived HP every time it was dented — health would stop
 *  mirroring the unbroken budget and the "health zero == last boundary
 *  broken" invariant would quietly fail. */
function computeEdgeNeed(
  e: GameEntity, edge: FractureEdge, strength: number, index = -1,
): number {
  const len = Math.hypot(edge.bx - edge.ax, edge.by - edge.ay);
  let s = strength;
  // BOND SPREAD (A2): a seeded per-boundary wobble around the material's
  // strength, so one material still breaks unevenly — some seams give
  // early, some hold.  Keyed on (body seed, boundary index) rather than
  // rolled per hit, so a body's weak seams are a FIXED property of that
  // body; a boundary that looked stubborn stays stubborn.
  const spread = e.shardVariant !== undefined
    ? grainSpecFor(e.shardVariant)?.bondSpread ?? 0 : 0;
  if (index >= 0) s *= bondVariance(e.crackSeed ?? 1, index, spread);
  return Math.max(0.05, s * len);
}

/** Widest swing `bondSpread` 1 can apply: ±60%, so the weakest seam in a
 *  body is ~4× easier than the strongest.  Beyond that a material stops
 *  reading as one material. */
export const BOND_SPREAD_RANGE = 0.6;

/** The BOND SPREAD law (A2), pure and exported so it can be pinned
 *  without a material having to carry a nonzero spread.
 *
 *  Returns the multiplier on a boundary's strength for a given body seed
 *  and boundary index.  Exactly 1 at spread 0 — which is what makes the
 *  feature inert until a material opts in — deterministic in
 *  (seed, index) so a body's weak seams are fixed rather than re-rolled
 *  per hit, and bounded to 1 ± BOND_SPREAD_RANGE × spread. */
export function bondVariance(seed: number, index: number, spread: number): number {
  const sp = Math.max(0, Math.min(1, spread));
  if (sp <= 0) return 1;
  const s = ((seed | 0) ^ ((index + 1) * 0x9e3779b1)) >>> 0;
  const u = mulberry32(s)();            // 0..1, deterministic
  return 1 + (u * 2 - 1) * sp * BOND_SPREAD_RANGE;
}

/** The variant's boundary strength under the live DBG multiplier, or
 *  null when this entity is not running the grain model (no `fracture`
 *  block, not progressive, no strength authored, or the legacy A/B). */
export function bondStrengthFor(e: GameEntity): number | null {
  if (e.shardVariant === undefined) return null;
  if (!isProgressiveFracture(e.shardVariant)) return null;
  const f = grainSpecFor(e.shardVariant);
  const s = f?.bondStrength;
  if (s === undefined) return null;
  return s * getBoundaryStrengthScale();
}

/** Build (or return) the entity's boundary model, converting its HP to
 *  the DERIVED total the first time.  Null when the entity is not
 *  running the grain model or carries no usable decomposition.
 *
 *  The conversion preserves the damage FRACTION already taken, so an
 *  entity that met the model mid-life (a tile chipped under the old
 *  rules, a shard that inherited HP from its parent) is not silently
 *  healed or killed by the swap. */
export function ensureBoundaryModel(
  e: GameEntity,
): { edges: FractureEdge[]; fill: number[]; strength: number } | null {
  const strength = bondStrengthFor(e);
  if (strength === null) return null;
  const edges = ensureFractureEdges(e);
  if (edges === null || edges.length === 0) return null;

  // The edge array is rebuilt whenever the pattern is (a DBG knob, a
  // merge): re-seed the fills to match rather than index a stale array.
  if (e.fractureEdgeFill === undefined || e.fractureEdgeFill.length !== edges.length
      || e.fractureEdgeNeed === undefined || e.fractureEdgeNeed.length !== edges.length) {
    const fill = new Array<number>(edges.length).fill(0);
    const needs = new Array<number>(edges.length);
    let total = 0;
    for (let i = 0; i < edges.length; i++) {
      needs[i] = computeEdgeNeed(e, edges[i], strength, i);
      total += needs[i];
    }
    e.fractureEdgeNeed = needs;
    const prevMax = e.maxHealth ?? 0;
    const prevHp = e.health ?? prevMax;
    const damagedFrac = prevMax > 0 ? Math.min(1, Math.max(0, 1 - prevHp / prevMax)) : 0;
    e.fractureEdgeFill = fill;
    e.fractureBoundaryHp = total;
    if (e.authoredMaxHealth === undefined) e.authoredMaxHealth = prevMax;
    e.maxHealth = total;
    e.health = total * (1 - damagedFrac);
    // Carry the damage already taken onto the boundaries themselves, or
    // a body converted mid-life would show full cracks and full health.
    if (damagedFrac > 0) spendOnBoundaries(e, edges, fill, strength, total * damagedFrac);
  }
  return { edges, fill: e.fractureEdgeFill, strength };
}

/** Pour `damage` into the unbroken boundaries, nearest the impact
 *  first, spilling from each as it breaks.  Returns the amount actually
 *  absorbed — less than `damage` only when every boundary is gone, which
 *  is the body's death. */
function spendOnBoundaries(
  e: GameEntity,
  edges: FractureEdge[],
  fill: number[],
  strength: number,
  damage: number,
): number {
  const ip = localImpactPoint(e);
  const px = ip !== null ? ip.x : 0;
  const py = ip !== null ? ip.y : 0;
  // Order is CELL BY CELL, nearest the contact first — NOT a flat sort
  // of edges by distance.  This is the V10 lesson restated in the damage
  // layer: a global nearest-edge order looks identical on any single
  // frame but completes almost no cell's ring until the very end, because
  // every cell's far-side boundary sorts late.  Measured that way, a rock
  // tile shed 3 pieces over its life and dumped 5 at death — the exact
  // "shatters at a limit" this model exists to remove.  Spending a
  // grain's whole ring before moving outward makes the pieces come off
  // one at a time, which is also what a struck grain popping out of a
  // real surface does.  Broken boundaries are skipped, so a second hit in
  // the same place drives deeper instead of re-breaking what it broke.
  const cells = e.fractureCells;
  const cellD = new Map<number, number>();
  if (cells !== undefined) {
    for (const c of cells) {
      cellD.set(c.siteIndex, (c.centroid.x - px) ** 2 + (c.centroid.y - py) ** 2);
    }
  }
  const cellKey = (ed: FractureEdge): number => {
    let best = Infinity;
    for (const site of ed.cells) {
      const d = cellD.get(site);
      if (d !== undefined && d < best) best = d;
    }
    return best;
  };
  const order: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (fill[i] < edgeNeed(e, i, strength)) order.push(i);
  }
  if (order.length === 0) return 0;

  // DAMAGE SPREAD (A4).  With a `damageSpread` set the spend stops being
  // sequential and becomes a distance-weighted WATER-FILL: every unbroken
  // boundary takes a share, near ones far more than far ones, so a hit
  // pre-charges a whole annulus instead of drilling one boundary at a
  // time.  That is what lets several grains come away together — the ring
  // of boundaries holding them completes at once rather than in series.
  const spread = damageSpreadFor(e);
  if (spread > 0) {
    return spendSpread(e, edges, fill, strength, damage, order, cellKey, spread);
  }

  order.sort((a, b) => {
    const ka = cellKey(edges[a]), kb = cellKey(edges[b]);
    if (ka !== kb) return ka - kb;
    const ea = edges[a], eb = edges[b];
    return ((ea.mx - px) ** 2 + (ea.my - py) ** 2)
         - ((eb.mx - px) ** 2 + (eb.my - py) ** 2);
  });
  let left = damage;
  for (const i of order) {
    if (left <= 0) break;
    const need = edgeNeed(e, i, strength) - fill[i];
    const put = Math.min(need, left);
    fill[i] += put;
    left -= put;
  }
  return damage - left;
}

/** The live damage-spread setting for this entity: the material's own
 *  `damageSpread` unless the global DBG cycle overrides it.  0 → the
 *  sequential spend above. */
function damageSpreadFor(e: GameEntity): number {
  const override = getDamageSpreadOverride();
  if (override !== null) return override;
  if (e.shardVariant === undefined) return 0;
  return grainSpecFor(e.shardVariant)?.damageSpread ?? 0;
}

/** Distance-weighted WATER-FILL of `damage` across the unbroken
 *  boundaries in `order`.
 *
 *  Weight is `exp(-d / (spread × bodyWidth))` with `d` the distance from
 *  the contact to the nearest CELL the boundary binds — cell distance,
 *  not edge-midpoint distance, so every boundary of one grain fills at
 *  the same rate and a grain's ring completes together.  That is the V10
 *  cell-grouping lesson carried into the weights: weighting per EDGE
 *  would fill each grain's near side long before its far side and
 *  complete almost nothing.
 *
 *  Two properties are load-bearing:
 *   - CONSERVATION.  Weights are normalised and surplus from a boundary
 *     that saturates is redistributed over the rest, so the total
 *     absorbed is exactly `damage` (up to the budget actually left in the
 *     body).  Without it every material's effective HP would silently
 *     rescale with the knob, and `health = Σ remaining` would drift.
 *   - TERMINATION.  Each round saturates at least one boundary or spends
 *     the whole remainder, so the loop runs at most `order.length` times
 *     — typically one or two on the ~13-22 boundaries a body carries. */
function spendSpread(
  e: GameEntity,
  edges: FractureEdge[],
  fill: number[],
  strength: number,
  damage: number,
  order: number[],
  cellKey: (ed: FractureEdge) => number,
  spread: number,
): number {
  const width = Math.max(1e-3, Math.max(e.size.x, e.size.y));
  const lambda = Math.max(1e-3, spread * width);

  // Bucket the weights once; `order` doubles as the active set and is
  // compacted in place as boundaries saturate.
  const w = new Array<number>(order.length);
  for (let k = 0; k < order.length; k++) {
    const d2 = cellKey(edges[order[k]]);
    const d = d2 === Infinity ? width : Math.sqrt(d2);
    w[k] = Math.exp(-d / lambda);
  }

  let left = damage;
  let n = order.length;
  const EPS = 1e-9;
  for (let round = 0; round < order.length && left > EPS && n > 0; round++) {
    let totalW = 0;
    for (let k = 0; k < n; k++) totalW += w[k];
    if (totalW <= EPS) break;
    const scale = left / totalW;

    // Which boundaries saturate at this scale?  Saturate only those, then
    // re-derive the scale over what is left — the standard water-fill, and
    // the reason a single pass would over- or under-spend.
    let anySaturated = false;
    for (let k = 0; k < n; k++) {
      if (w[k] * scale >= edgeNeed(e, order[k], strength) - fill[order[k]]) {
        anySaturated = true;
        break;
      }
    }
    if (!anySaturated) {
      for (let k = 0; k < n; k++) fill[order[k]] += w[k] * scale;
      left = 0;
      break;
    }
    let write = 0;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const capacity = edgeNeed(e, i, strength) - fill[i];
      if (w[k] * scale >= capacity) {
        fill[i] = edgeNeed(e, i, strength);
        left -= capacity;
      } else {
        order[write] = i;
        w[write] = w[k];
        write++;
      }
    }
    n = write;
  }
  return damage - Math.max(0, left);
}

/** Apply a damage event to the entity's grain boundaries.  Returns true
 *  when the entity is running the model (and so the caller must NOT
 *  also decrement `health` — this owns that number).
 *
 *  `health` is kept as an exact mirror of the unbroken boundary budget,
 *  which is what makes the HUD, the crack overlay, the damage-number
 *  gate and the death check agree with the fracture without any of them
 *  knowing the model exists. */
export function applyBoundaryDamage(e: GameEntity, damage: number): boolean {
  const model = ensureBoundaryModel(e);
  if (model === null) return false;
  spendOnBoundaries(e, model.edges, model.fill, model.strength, Math.max(0, damage));
  let remaining = 0;
  for (let i = 0; i < model.edges.length; i++) {
    remaining += Math.max(0, edgeNeed(e, i, model.strength) - model.fill[i]);
  }
  e.health = remaining;
  return true;
}

/** A boundary's strength, as fixed at model build.  Falls back to a live
 *  derivation only if the cached array is missing (a body mid-migration). */
function edgeNeed(e: GameEntity, index: number, strength: number): number {
  const cached = e.fractureEdgeNeed;
  if (cached !== undefined && index >= 0 && index < cached.length) return cached[index];
  const edges = e.fractureEdges;
  if (edges === undefined || index < 0 || index >= edges.length) return 0;
  return computeEdgeNeed(e, edges[index], strength, index);
}

/** How far through breaking this boundary is, 0..1 — the ONE number the
 *  crack overlay draws and the detach test reads, so what the player
 *  sees and what comes loose cannot disagree. */
export function edgeBreakFraction(e: GameEntity, index: number): number {
  const strength = bondStrengthFor(e);
  const edges = e.fractureEdges;
  const fill = e.fractureEdgeFill;
  if (strength === null || edges === undefined || fill === undefined) return 0;
  if (index < 0 || index >= edges.length || index >= fill.length) return 0;
  const need = edgeNeed(e, index, strength);
  return need <= 0 ? 1 : Math.min(1, fill[index] / need);
}

/** True once this boundary has been broken all the way through. */
export function edgeIsBroken(e: GameEntity, index: number): boolean {
  return edgeBreakFraction(e, index) >= 1;
}

// ── PER-GRAIN DEFORMATION (B1) ────────────────────────────────────────

/** Most dent steps one grain will take before it stops deforming.  A cap
 *  is needed because damage keeps arriving at the same face: without it a
 *  grain under sustained fire is pulled through its own centroid and the
 *  body's outline self-intersects. */
const GRAIN_DENT_MAX_STEPS = 6;
/** A grain may deform to no less than this fraction of the area it was
 *  CUT at (user call: two thirds).  Without a floor a grain under
 *  sustained fire is pulled down to almost nothing while still counting
 *  as a whole piece, and the body then sheds full-size shards that its
 *  own outline never loses — which is unsound, not just ugly. */
const GRAIN_DENT_MIN_AREA_FRAC = 0.67;
/** ...or this absolute area, whichever is GREATER, so small grains do
 *  not deform down to specks even though two thirds of very little is
 *  still very little.  ~= a radius-3 disc. */
const GRAIN_DENT_MIN_AREA_PX2 = 28;
/** Position quantisation for deciding that two grains share a vertex, as
 *  a fraction of the body's size.  Cells are cut from one polygon by
 *  exact line splits, so shared vertices agree to floating-point noise;
 *  this only has to be larger than that noise and much smaller than a
 *  grain. */
const VERTEX_WELD_FRAC = 0.01;

/** Dent the grain the shot landed on (B1).
 *
 *  THE CONSTRAINT that shapes this: grains must keep TILING the body
 *  exactly, because `unionOfCells` identifies an interior boundary by two
 *  surviving grains sharing an edge.  Deform a grain's copy of a shared
 *  vertex and its neighbour's copy no longer matches, the shared edge
 *  stops being recognised as interior, and the body's outline silently
 *  falls back to the arc splice or fails outright.
 *
 *  So the displacement is applied to the SHARED VERTEX SET: vertices are
 *  welded by position, only those ON THE BODY'S OUTLINE move (an interior
 *  vertex moving would change the pattern under the damage already
 *  recorded against it), and each one moves identically in every grain
 *  that references it.  The tiling is preserved by construction, and the
 *  visible result is a dimple in the silhouette where the shot landed.
 *
 *  Returns true when the body's outline changed. */
export function dentStruckGrain(e: GameEntity): boolean {
  const strength = bondStrengthFor(e);
  if (strength === null) return false;
  const spec = e.shardVariant !== undefined
    ? grainSpecFor(e.shardVariant) : undefined;
  const depth = spec?.grainDent ?? 0;
  if (depth <= 0) return false;

  const cells = e.fractureCells;
  const pts = e.polygonPoints;
  const local = e.lastImpactLocal;
  if (cells === undefined || cells.length === 0 || pts === undefined || local === undefined) {
    return false;
  }

  // The struck grain: nearest to the contact by its OWN outline, the same
  // rule the detach search uses, so the piece that dents is the piece
  // that would come off.
  let hit = -1, best = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const d = pointToPolygonDistance2(local.x, local.y, cells[i].points);
    if (d < best) { best = d; hit = i; }
  }
  if (hit < 0) return false;

  const site = cells[hit].siteIndex;
  const dents = e.fractureGrainDents ?? (e.fractureGrainDents = []);
  if ((dents[site] ?? 0) >= GRAIN_DENT_MAX_STEPS) return false;
  // A grain may not be deformed away.  Below this floor a further dent is
  // simply refused — see GRAIN_DENT_MIN_AREA_FRAC for why an unbounded
  // pull was not merely ugly but unsound.
  const floorFor = (c: FractureCell) => Math.max(
    (c.area0 ?? c.area) * GRAIN_DENT_MIN_AREA_FRAC, GRAIN_DENT_MIN_AREA_PX2);
  if (cells[hit].area <= floorFor(cells[hit])) return false;

  const span = Math.max(1, Math.max(e.size.x, e.size.y));
  const weld = span * VERTEX_WELD_FRAC;
  const eps2 = weld * weld;
  const key = (x: number, y: number) =>
    `${Math.round(x / weld)},${Math.round(y / weld)}`;

  // Which of the struck grain's vertices sit on the body's outline —
  // those are the only ones a dimple may move.
  const c = cells[hit];
  const moves = new Map<string, { dx: number; dy: number }>();
  const pull = depth * Math.sqrt(Math.abs(c.area) / Math.PI);
  for (const v of c.points) {
    if (!onParentBoundary(v.x, v.y, pts, eps2)) continue;
    const dx = c.centroid.x - v.x, dy = c.centroid.y - v.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    moves.set(key(v.x, v.y), { dx: (dx / len) * pull, dy: (dy / len) * pull });
  }
  if (moves.size === 0) return false;

  // Apply to EVERY grain that shares each moved vertex.
  const moved: FractureCell[] = cells.map(cell => {
    let touched = false;
    const nextPts = cell.points.map(v => {
      const m = moves.get(key(v.x, v.y));
      if (m === undefined) return v;
      touched = true;
      return { x: v.x + m.dx, y: v.y + m.dy };
    });
    if (!touched) return cell;
    // RECOMPUTE area and centroid.  Carrying the cut-time values across a
    // deformation is what made a shrivelled grain spawn a full-size
    // shard: `spawnDetachedCell` sizes the fragment from `cell.area` and
    // recentres its polygon on `cell.centroid`.  Measured on a plastic
    // tile before this: a grain reporting 2.06x its real area, and a hit
    // that shed 225 units of shard while the tile's own outline lost 2.3
    // — mass created from nothing.
    return { ...cell, points: nextPts,
      area: polygonArea(nextPts), centroid: polygonCentroid(nextPts) };
  });
  // Refuse the whole step if it would push ANY grain under its floor —
  // the pull moves shared vertices, so neighbours deform too.
  for (const cell of moved) {
    if (cell.area < floorFor(cell)) return false;
  }

  const outline = unionOfCells(moved, weld);
  // A dent that would break the body into islands, or produce a
  // self-intersecting outline SAT cannot carry, is simply not applied.
  if (outline === null || outline.length < 3) return false;
  // A DENT MAY NEVER ADD AREA.  The body's outline and the union of its
  // grains can drift apart (measured: a tile's polygon at 997.6 against
  // its own cells' union at 1126), and assigning the union then makes
  // the body GROW — a hit that spawned nothing and put 130 area back on
  // the tile.  Conservation must not depend on those two staying in
  // perfect agreement, so the dent simply refuses to hand back a bigger
  // body than it was given.
  if (polygonArea(outline) > polygonArea(pts) + 1e-6) return false;

  e.fractureCells = moved;
  e.polygonPoints = outline;
  dents[site] = (dents[site] ?? 0) + 1;

  // The boundary GEOMETRY moved, so the cracks must be redrawn from the
  // new endpoints — but their STRENGTHS and their absorbed damage must
  // not move with them, which is why `fractureEdgeNeed` is cached and
  // `fractureEdgeFill` is left exactly as it was.
  const edges = e.fractureEdges;
  if (edges !== undefined) {
    for (const ed of edges) {
      const ma = moves.get(key(ed.ax, ed.ay));
      if (ma !== undefined) { ed.ax += ma.dx; ed.ay += ma.dy; }
      const mb = moves.get(key(ed.bx, ed.by));
      if (mb !== undefined) { ed.bx += mb.dx; ed.by += mb.dy; }
      ed.mx = (ed.ax + ed.bx) / 2;
      ed.my = (ed.ay + ed.by) / 2;
    }
  }
  return true;
}
