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
import { SHARD_VARIANTS } from '../../constants';
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
  if (e.fractureCells !== undefined) return e.fractureCells;

  const size = Math.max(e.size.x, e.size.y);
  let sites = Math.round(size / f.sizePerSite);
  const merges = e.mergeCount ?? 1;
  if (merges > 1) sites = Math.max(sites, merges);
  sites = Math.max(f.siteCountMin, Math.min(f.siteCountMax, sites));

  const seed = e.crackSeed ?? (e.crackSeed = seedFromEntityId(e.id));

  const ip = localImpactPoint(e);
  const impact = ip !== null ? { x: ip.x, y: ip.y, bias: f.impactBias } : undefined;

  e.fractureEdges = undefined; // edges are derived — never outlive the cells
  e.fractureCells = computeFracture(e.polygonPoints, {
    siteCount: sites,
    seed,
    impact,
    minAreaFraction: f.minAreaFraction,
  }).cells;
  return e.fractureCells;
}

/** The decomposition's interior (bisector) edges — the entity's CRACKS —
 *  sorted nearest-the-impact first (falling back to centre-out) so the
 *  progressive HP reveal grows outward from where the hits land.  The
 *  order is fixed at build time: cracks only ever EXTEND, they never
 *  reshuffle between frames. */
export function ensureFractureEdges(e: GameEntity): FractureEdge[] | null {
  if (e.fractureEdges !== undefined) return e.fractureEdges;
  const cells = ensureFractureCells(e);
  if (cells === null || e.polygonPoints === undefined) return null;
  const edges = collectInteriorEdges(cells, e.polygonPoints);
  const ip = localImpactPoint(e);
  if (ip !== null) {
    edges.sort((a, b) =>
      ((a.mx - ip.x) ** 2 + (a.my - ip.y) ** 2)
      - ((b.mx - ip.x) ** 2 + (b.my - ip.y) ** 2));
  } else {
    edges.sort((a, b) => (a.mx * a.mx + a.my * a.my) - (b.mx * b.mx + b.my * b.my));
  }
  e.fractureEdges = edges;
  return edges;
}
