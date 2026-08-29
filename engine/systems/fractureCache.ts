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

import { GameEntity } from '../../types';
import {
  SHARD_VARIANTS, FRACTURE_DETACH,
  getFractureRelax, getFractureSeparation, getFractureSiteScale,
  getFractureBiasOverride, getFractureTuningGen,
} from '../../constants';
import {
  computeFracture, collectInteriorEdges, seedFromEntityId,
  FractureCell, FractureEdge,
} from './fracture';

/** The impact point in entity-LOCAL coords, derived from
 *  `lastImpactVelocity`: the hit landed on the side the impactor came
 *  FROM.  Null when no usable impact is stamped. */
function localImpactPoint(e: GameEntity): { x: number; y: number } | null {
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
 *  ShardFracturePolicy). */
export function ensureFractureCells(e: GameEntity): FractureCell[] | null {
  if (e.shardVariant === undefined) return null;
  const f = SHARD_VARIANTS[e.shardVariant].fracture;
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

  const size = Math.max(e.size.x, e.size.y);
  let sites = Math.round((size / f.sizePerSite) * getFractureSiteScale());
  const merges = e.mergeCount ?? 1;
  if (merges > 1) sites = Math.max(sites, merges);
  sites = Math.max(f.siteCountMin, Math.min(f.siteCountMax, sites));

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
    relaxIterations: getFractureRelax(),
    minSeparation: getFractureSeparation(),
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
