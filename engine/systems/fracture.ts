/** Seeded Voronoi fracture core (gauntlet voronoi, V1).
 *
 *  Pure geometry — NO engine imports, no `Math.random`, no per-call state
 *  (the DualSenseHID precedent: `constants.ts` and the engine may import
 *  from here without a cycle, and the whole module is pinnable headlessly).
 *  Everything downstream (shatter fragments, the crack overlay, partial
 *  detach) reads ONE decomposition computed here, so the cracks a player
 *  watches grow are by construction the seams the entity breaks along.
 *
 *  Inputs are the entity's own `polygonPoints` (entity-local coords, as
 *  produced by `generateShardPolygon` / the tile builders) and the entity's
 *  `crackSeed` (see `drawUtils.crackSeedFor`).  Outputs are cells in the
 *  same local space.
 *
 *  Robustness contract (V1 hazard, resolved here by MEASUREMENT): parents
 *  are NOT guaranteed convex — rock spawns at radius 0.60±0.55 with 0.5
 *  angle jitter, and dented tiles are worse.  The first cut used
 *  Sutherland–Hodgman (concave subject × convex Voronoi region) with a
 *  post-split at duplicated vertices; the V1 suite's deep-star case
 *  (alternating radii 1.0/0.42, 24 sites) produced genuinely
 *  SELF-INTERSECTING cells — S-H's bridged output subdivides the doubled
 *  edge differently in each direction, so the bridges are not findable by
 *  vertex identity.  So each cell is instead built by REPEATED LINE
 *  SPLITTING: the parent is split by each bisector with the classic
 *  sorted-crossing algorithm (`splitPolygonKeepNeg`) — crossings of a
 *  simple polygon along the cut line alternate inside/outside, so pairing
 *  sorted crossings 0-1, 2-3… gives the interior bridges exactly, and
 *  stitching chains across them yields REAL disjoint pieces, each a simple
 *  polygon by construction.  Slivers below the minimum area are retired by
 *  REMOVING their site and recomputing — the neighbours inherit the
 *  territory, which IS the "merge slivers into neighbours" rule without
 *  needing a polygon union.
 */

export interface FracturePoint { x: number; y: number }

/** One Voronoi cell of the decomposition, in parent-local coords. */
export interface FractureCell {
  /** Simple polygon, winding normalised to positive signed area. */
  points: FracturePoint[];
  /** The site that owns this cell (a disconnected lobe keeps its owner's
   *  site even though the site lies in the other lobe). */
  site: FracturePoint;
  /** Index of the owning site in the FINAL (post-retirement) site list. */
  siteIndex: number;
  centroid: FracturePoint;
  area: number;
}

export interface FractureImpact {
  /** Impact point, parent-local coords.  May lie on/outside the boundary. */
  x: number;
  y: number;
  /** Fraction of sites biased toward the impact point (0..1).  Biased
   *  sites land within ~0.45·sqrt(parentArea) of the impact, so the
   *  pattern visibly radiates from where the hit landed. */
  bias: number;
}

export interface FractureOptions {
  /** Requested site count (≥ 2).  The result may carry FEWER sites when
   *  sliver retirement kicks in, and can carry MORE cells than sites when
   *  a concave parent disconnects a cell into lobes. */
  siteCount: number;
  /** PRNG seed — the entity's `crackSeed` (any finite number). */
  seed: number;
  impact?: FractureImpact;
  /** A cell piece below `minAreaFraction × parentArea / siteCount` is a
   *  sliver: its site is retired and the decomposition recomputed.
   *  Default 0.15. */
  minAreaFraction?: number;
}

export interface FractureResult {
  cells: FractureCell[];
  /** Final site list after sliver retirement. */
  sites: FracturePoint[];
  /** Σ|cell area| — callers assert conservation against parent area. */
  totalArea: number;
  /** Sites retired by the sliver rule (count). */
  retiredSites: number;
}

// ── PRNG ────────────────────────────────────────────────────────────
// mulberry32, the repo's seeded-PRNG precedent (BackgroundManager.starRand)
// re-stated as a pure factory.  NOT hash01 — the sin-fract hack correlates
// visibly at small integer strides, which is fine for crack angles and not
// fine for point sets.
export function mulberry32(seed: number): () => number {
  let s = (seed * 1_000_003) >>> 0; // spread small/fractional seeds
  // Fold the fractional part in so crackSeed's (h/997)*1000+1 values with
  // equal integer parts still diverge.
  s = (s + Math.floor((seed % 1) * 0xffffffff)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The crackSeedFor hash (drawUtils) restated pure: stable [1, 1001)
 *  seed from an entity id.  ShardSystem uses it to seed the decomposition
 *  without importing the render layer; drawUtils caches the SAME value on
 *  `entity.crackSeed`, so cracks and cells share one pattern by
 *  construction.  Keep the two implementations identical. */
export function seedFromEntityId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h / 997) * 1000 + 1;
}

// ── Polygon primitives ──────────────────────────────────────────────

export function polygonSignedArea(pts: ReadonlyArray<FracturePoint>): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polygonArea(pts: ReadonlyArray<FracturePoint>): number {
  return Math.abs(polygonSignedArea(pts));
}

export function polygonCentroid(pts: ReadonlyArray<FracturePoint>): FracturePoint {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    a += cross;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate: fall back to the vertex mean.
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    return { x: mx / pts.length, y: my / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(x: number, y: number, pts: ReadonlyArray<FracturePoint>): boolean {
  let inside = false;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const pi = pts[i], pj = pts[j];
    if ((pi.y > y) !== (pj.y > y)
      && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Segment intersection test for the simplicity check — proper crossings
 *  only (shared endpoints between adjacent edges are legal). */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
      && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when the polygon has no proper self-crossing.  O(n²) — validation
 *  and test use only, never a per-frame path. */
export function isSimplePolygon(pts: ReadonlyArray<FracturePoint>): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges (shared endpoint is not a crossing).
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = pts[j], d = pts[(j + 1) % n];
      if (segmentsCross(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return false;
    }
  }
  return true;
}

// ── Clipping ────────────────────────────────────────────────────────

/** Clip a polygon by the half-plane { p : (p − a)·n ≤ 0 }.  Standard
 *  Sutherland–Hodgman single-plane step; the subject may be concave (a
 *  disconnected result comes back bridged — see splitDegenerateLoops). */
function clipHalfPlane(
  pts: FracturePoint[],
  ax: number, ay: number, nx: number, ny: number,
): FracturePoint[] {
  const out: FracturePoint[] = [];
  const n = pts.length;
  if (n === 0) return out;
  let prev = pts[n - 1];
  let prevD = (prev.x - ax) * nx + (prev.y - ay) * ny;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const curD = (cur.x - ax) * nx + (cur.y - ay) * ny;
    if (curD <= 0) {
      if (prevD > 0) {
        const t = prevD / (prevD - curD);
        out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
      }
      out.push(cur);
    } else if (prevD <= 0) {
      const t = prevD / (prevD - curD);
      out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
    }
    prev = cur;
    prevD = curD;
  }
  return out;
}

/** Split a simple (possibly concave) polygon by the line through `a` with
 *  normal `n`, returning the pieces on the KEEP side (d = (p−a)·n < 0).
 *  The whole polygon comes back untouched when it lies entirely on the
 *  keep side; [] when entirely on the discard side.
 *
 *  Method: the crossings of a simple closed boundary with the cut line,
 *  sorted along the line, alternate inside/outside — so pairing sorted
 *  crossings (0-1, 2-3, …) gives exactly the polygon-interior bridges.
 *  Keep-side boundary chains hang between those crossings; stitching each
 *  bridge's exit chain to its entry chain closes the real disjoint pieces,
 *  each simple by construction.  Vertices within `eps` of the line are
 *  snapped to the keep side, so tangencies never produce odd crossing
 *  counts; a residual degenerate pairing (two same-kind events in a pair)
 *  falls back to single-polygon Sutherland–Hodgman, which conserves area
 *  even when its output is bridged. */
function splitPolygonKeepNeg(
  poly: FracturePoint[],
  ax: number, ay: number, nx: number, ny: number,
  eps: number,
): FracturePoint[][] {
  const n = poly.length;
  const d: number[] = new Array(n);
  let anyPos = false, anyNeg = false;
  for (let i = 0; i < n; i++) {
    let di = (poly[i].x - ax) * nx + (poly[i].y - ay) * ny;
    if (di > -eps && di < eps) di = -eps; // snap on-line vertices to keep
    d[i] = di;
    if (di > 0) anyPos = true; else anyNeg = true;
  }
  if (!anyPos) return [poly];
  if (!anyNeg) return [];

  // Start the walk at a discard-side vertex so every keep chain is opened
  // by an entry crossing and closed by an exit crossing.
  let start = 0;
  while (d[start] < 0) start++;

  interface Chain {
    pts: FracturePoint[];
    entryT: number;
    exitT: number;
    next?: Chain;
    visited?: boolean;
  }
  const dirx = -ny, diry = nx; // a direction along the cut line
  const chains: Chain[] = [];
  let cur: Chain | null = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n, j = (start + k + 1) % n;
    const pi = poly[i], pj = poly[j];
    const di = d[i], dj = d[j];
    if (di < 0 && cur !== null) cur.pts.push(pi);
    if ((di > 0) !== (dj > 0)) {
      const t = di / (di - dj);
      const P = { x: pi.x + (pj.x - pi.x) * t, y: pi.y + (pj.y - pi.y) * t };
      const pT = P.x * dirx + P.y * diry;
      if (di > 0) {
        cur = { pts: [P], entryT: pT, exitT: 0 };
      } else {
        cur!.pts.push(P);
        cur!.exitT = pT;
        chains.push(cur!);
        cur = null;
      }
    }
  }

  // Pair sorted crossings into bridges; each bridge links an exit to an
  // entry.  A same-kind pair means numeric degeneracy — fall back.
  interface Ev { t: number; chain: Chain; entry: boolean }
  const evs: Ev[] = [];
  for (const c of chains) {
    evs.push({ t: c.entryT, chain: c, entry: true });
    evs.push({ t: c.exitT, chain: c, entry: false });
  }
  evs.sort((a, b) => a.t - b.t);
  for (let k = 0; k + 1 < evs.length; k += 2) {
    const a = evs[k], b = evs[k + 1];
    if (a.entry === b.entry) {
      const sh = clipHalfPlane(poly, ax, ay, nx, ny);
      return sh.length >= 3 ? [sh] : [];
    }
    const exitEv = a.entry ? b : a;
    const entryEv = a.entry ? a : b;
    exitEv.chain.next = entryEv.chain;
  }

  const out: FracturePoint[][] = [];
  for (const c of chains) {
    if (c.visited) continue;
    const pts: FracturePoint[] = [];
    let cc: Chain | undefined = c;
    let guard = 0;
    while (cc !== undefined && !cc.visited && guard++ <= chains.length) {
      cc.visited = true;
      for (const p of cc.pts) pts.push(p);
      cc = cc.next;
    }
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

// ── Site placement ──────────────────────────────────────────────────

/** Place `count` sites inside the polygon, deterministically from `rand`.
 *  Rejection sampling in the bounding box with a soft minimum-separation
 *  rule (near-coincident sites make sliver cells); with an impact, the
 *  biased fraction lands in a disc around the impact point so the pattern
 *  radiates from the hit. */
export function placeFractureSites(
  poly: ReadonlyArray<FracturePoint>,
  count: number,
  rand: () => number,
  impact?: FractureImpact,
): FracturePoint[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const area = polygonArea(poly);
  const c = polygonCentroid(poly);
  const minSep = 0.35 * Math.sqrt(area / Math.max(1, count));
  const minSep2 = minSep * minSep;
  const biasR = 0.45 * Math.sqrt(area);
  const biasedCount = impact ? Math.round(Math.max(0, Math.min(1, impact.bias)) * count) : 0;

  const sites: FracturePoint[] = [];
  for (let i = 0; i < count; i++) {
    const biased = i < biasedCount && impact !== undefined;
    let placed = false;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      let x: number, y: number;
      if (biased) {
        const ang = rand() * Math.PI * 2;
        const r = biasR * Math.sqrt(rand());
        x = impact!.x + Math.cos(ang) * r;
        y = impact!.y + Math.sin(ang) * r;
      } else {
        x = minX + rand() * (maxX - minX);
        y = minY + rand() * (maxY - minY);
      }
      if (!pointInPolygon(x, y, poly)) continue;
      // Soft separation: enforced for the first 30 attempts, then waived
      // so a crowded request still terminates deterministically.
      if (attempt < 30) {
        let tooClose = false;
        for (const s of sites) {
          const dx = s.x - x, dy = s.y - y;
          if (dx * dx + dy * dy < minSep2) { tooClose = true; break; }
        }
        if (tooClose) continue;
      }
      sites.push({ x, y });
      placed = true;
    }
    if (!placed) {
      // Pathological polygon (or impact far outside) — pull toward the
      // centroid, which is inside for the star-shaped families.
      sites.push({
        x: c.x + (rand() - 0.5) * minSep,
        y: c.y + (rand() - 0.5) * minSep,
      });
    }
  }
  return sites;
}

// ── The decomposition ───────────────────────────────────────────────

function normalizeWinding(pts: FracturePoint[]): FracturePoint[] {
  return polygonSignedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

function buildCells(
  parent: ReadonlyArray<FracturePoint>,
  sites: ReadonlyArray<FracturePoint>,
  lineEps: number,
  tinyArea: number,
): FractureCell[] {
  const cells: FractureCell[] = [];
  for (let i = 0; i < sites.length; i++) {
    const si = sites[i];
    // Whittle the parent down by every bisector, keeping the side nearer
    // this site.  Splitting (not S-H clipping) is what keeps concave
    // parents honest: a bisector that disconnects the remainder yields
    // real separate pieces, each split independently by the next
    // bisector.
    let pieces: FracturePoint[][] = [parent as FracturePoint[]];
    for (let j = 0; j < sites.length && pieces.length > 0; j++) {
      if (j === i) continue;
      const sj = sites[j];
      const mx = (si.x + sj.x) / 2, my = (si.y + sj.y) / 2;
      const nx = sj.x - si.x, ny = sj.y - si.y;
      // Normalise so lineEps means a distance, not distance × |n|.
      const invLen = 1 / Math.max(Math.hypot(nx, ny), 1e-12);
      const next: FracturePoint[][] = [];
      for (const piece of pieces) {
        const parts = splitPolygonKeepNeg(piece, mx, my, nx * invLen, ny * invLen, lineEps);
        for (const part of parts) next.push(part);
      }
      pieces = next;
    }
    for (const piece of pieces) {
      const area = polygonArea(piece);
      if (area <= tinyArea) continue;
      const points = normalizeWinding(piece);
      cells.push({
        points,
        site: si,
        siteIndex: i,
        centroid: polygonCentroid(points),
        area,
      });
    }
  }
  return cells;
}

/** Compute the seeded Voronoi decomposition of a game polygon.
 *
 *  Deterministic: identical (poly, opts) → identical result.  Area is
 *  conserved (Σ cell areas = parent area to fp tolerance) because the
 *  cells partition the parent by construction.  Slivers below
 *  `minAreaFraction × parentArea / siteCount` retire their SITE and the
 *  decomposition recomputes, so neighbours absorb the territory; the loop
 *  is bounded and never drops below 2 sites. */
export function computeFracture(
  parent: ReadonlyArray<FracturePoint>,
  opts: FractureOptions,
): FractureResult {
  const parentArea = polygonArea(parent);
  const scale = Math.sqrt(Math.max(parentArea, 1e-12));
  const lineEps = scale * 1e-5;
  const tinyArea = parentArea * 1e-9;
  const count = Math.max(2, Math.floor(opts.siteCount));
  const minArea = (opts.minAreaFraction ?? 0.15) * (parentArea / count);

  const rand = mulberry32(opts.seed);
  let sites = placeFractureSites(parent, count, rand, opts.impact);

  let cells: FractureCell[] = [];
  let retired = 0;
  for (let attempt = 0; attempt <= count; attempt++) {
    cells = buildCells(parent, sites, lineEps, tinyArea);
    if (sites.length <= 2) break;
    // Worst sliver retires its whole site (all its loops go with it).
    let worstIdx = -1, worstArea = minArea;
    for (const cell of cells) {
      if (cell.area < worstArea) { worstArea = cell.area; worstIdx = cell.siteIndex; }
    }
    if (worstIdx < 0) break;
    sites = sites.filter((_, i) => i !== worstIdx);
    retired++;
  }

  // Re-stamp siteIndex against the final site list (indices shifted by
  // retirement are re-resolved by identity).
  if (retired > 0) {
    for (const cell of cells) {
      cell.siteIndex = sites.indexOf(cell.site);
    }
  }

  let total = 0;
  for (const cell of cells) total += cell.area;
  return { cells, sites: sites as FracturePoint[], totalArea: total, retiredSites: retired };
}

// ── Cell subtraction (partial fracture, V4) ─────────────────────────

interface BoundaryLoc { e: number; t: number; pt: FracturePoint }

/** Locate the point's closest position on the polygon boundary as
 *  (edge index, param t along that edge). */
function locateOnBoundary(p: FracturePoint, poly: ReadonlyArray<FracturePoint>): BoundaryLoc {
  let best: BoundaryLoc = { e: 0, t: 0, pt: p };
  let bestD = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + dx * t - p.x, qy = a.y + dy * t - p.y;
    const d = qx * qx + qy * qy;
    if (d < bestD) { bestD = d; best = { e: i, t, pt: p }; }
  }
  return best;
}

/** Walk the polygon boundary FORWARD (in vertex order) from one
 *  boundary location to another, returning the path points including
 *  both endpoints. */
function boundaryPathForward(
  poly: ReadonlyArray<FracturePoint>,
  from: BoundaryLoc, to: BoundaryLoc,
): FracturePoint[] {
  const out: FracturePoint[] = [from.pt];
  const n = poly.length;
  if (from.e === to.e && to.t >= from.t) { out.push(to.pt); return out; }
  for (let k = 1; k <= n; k++) {
    const idx = (from.e + k) % n;
    out.push(poly[idx]); // the start vertex of edge `idx`
    if (idx === to.e) { out.push(to.pt); return out; }
  }
  return out;
}

/** Remove near-duplicate consecutive points (splice seams). */
function dedupeLoop(pts: FracturePoint[], eps: number): FracturePoint[] {
  const out: FracturePoint[] = [];
  const eps2 = eps * eps;
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q !== undefined) {
      const dx = p.x - q.x, dy = p.y - q.y;
      if (dx * dx + dy * dy < eps2) continue;
    }
    out.push(p);
  }
  if (out.length >= 2) {
    const a = out[0], b = out[out.length - 1];
    const dx = a.x - b.x, dy = a.y - b.y;
    if (dx * dx + dy * dy < eps2) out.pop();
  }
  return out;
}

/** Subtract a BOUNDARY cell of a decomposition from its parent polygon —
 *  the geometric heart of partial fracture (V4): the cell detaches as a
 *  fragment and the parent keeps the spliced remainder.
 *
 *  Works by ARC SPLICING rather than general polygon boolean ops: a
 *  boundary cell's outline is one contiguous run of vertices ON the
 *  parent boundary (the arc) plus one interior chain (its bisector
 *  edges).  The remainder is the parent boundary walked the long way
 *  between the arc's endpoints, closed through the interior chain.  Both
 *  complementary walks are built and the one whose area matches
 *  parentArea − cellArea (and is simple) wins.
 *
 *  Returns null — meaning "do not detach this cell" — when the cell is
 *  interior (a hole), touches the boundary in more than one run
 *  (concave-parent pathology), covers the whole parent, or neither
 *  candidate validates.  Callers treat null as "no chip this hit". */
export function subtractBoundaryCell(
  parent: ReadonlyArray<FracturePoint>,
  cell: ReadonlyArray<FracturePoint>,
): FracturePoint[] | null {
  const parentArea = polygonArea(parent);
  const cellArea = polygonArea(cell);
  if (parentArea <= 0 || cellArea <= 0) return null;
  const eps = Math.sqrt(parentArea) * 5e-4;
  const eps2 = eps * eps;

  const n = cell.length;
  const onB: boolean[] = new Array(n);
  let boundaryCount = 0;
  for (let i = 0; i < n; i++) {
    onB[i] = onParentBoundary(cell[i].x, cell[i].y, parent, eps2);
    if (onB[i]) boundaryCount++;
  }
  if (boundaryCount < 2 || boundaryCount === n) return null;

  // Exactly one contiguous circular run of boundary vertices.
  let runs = 0, runStart = -1, runEnd = -1;
  for (let i = 0; i < n; i++) {
    const prev = onB[(i + n - 1) % n];
    if (onB[i] && !prev) { runs++; runStart = i; }
    if (onB[i] && !onB[(i + 1) % n]) runEnd = i;
  }
  if (runs !== 1 || runStart < 0 || runEnd < 0) return null;

  const sPt = cell[runStart];  // arc start (cell winding order)
  const ePt = cell[runEnd];    // arc end
  // Interior chain: cell vertices strictly between runEnd and runStart.
  const chain: FracturePoint[] = [];
  for (let k = 1; k < n; k++) {
    const idx = (runEnd + k) % n;
    if (idx === runStart) break;
    chain.push(cell[idx]);
  }
  if (chain.length === 0) return null; // straight-chord cells splice too,
  // but a chainless cell means arc-only geometry — nothing to close with.

  const locS = locateOnBoundary(sPt, parent);
  const locE = locateOnBoundary(ePt, parent);

  const target = parentArea - cellArea;
  const tol = Math.max(parentArea * 0.02, eps * eps);

  // Candidate A: parent forward e→s, close through the chain reversed.
  const candA = dedupeLoop(
    boundaryPathForward(parent, locE, locS).concat(chain.slice().reverse()), eps);
  // Candidate B: parent forward s→e, close through the chain in order.
  const candB = dedupeLoop(
    boundaryPathForward(parent, locS, locE).concat(chain), eps);

  let best: FracturePoint[] | null = null;
  let bestErr = tol;
  for (const cand of [candA, candB]) {
    if (cand.length < 3) continue;
    const err = Math.abs(polygonArea(cand) - target);
    if (err < bestErr && isSimplePolygon(cand)) {
      best = cand;
      bestErr = err;
    }
  }
  if (best === null) return null;
  return polygonSignedArea(best) < 0 ? best.slice().reverse() : best;
}

// ── Interior edges (the crack pattern, V3's input) ──────────────────

export interface FractureEdge {
  ax: number; ay: number; bx: number; by: number;
  /** Midpoint, for impact-distance ordering. */
  mx: number; my: number;
  /** siteIndexes of the cells this edge BINDS (V8, fracture
   *  propagation): the two cells sharing the bisector segment, or one
   *  when the twin didn't dedupe (a T-junction from independent
   *  splitting) — a single-owner edge simply binds its owner until
   *  revealed.  A cell whose binding edges are all revealed has a fully
   *  highlighted boundary and breaks off. */
  cells: number[];
}

function distToSegment2(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

function onParentBoundary(
  x: number, y: number,
  parent: ReadonlyArray<FracturePoint>, eps2: number,
): boolean {
  const n = parent.length;
  for (let i = 0; i < n; i++) {
    const a = parent[i], b = parent[(i + 1) % n];
    if (distToSegment2(x, y, a.x, a.y, b.x, b.y) <= eps2) return true;
  }
  return false;
}

/** Collect the INTERIOR cell edges of a decomposition — the bisector
 *  segments, which are the cracks the entity shows (V3) and the seams it
 *  detaches along (V4).  An edge is interior unless both endpoints AND its
 *  midpoint lie on the parent boundary.  Shared edges between two cells are
 *  deduplicated by a quantised endpoint key. */
export function collectInteriorEdges(
  cells: ReadonlyArray<FractureCell>,
  parent: ReadonlyArray<FracturePoint>,
): FractureEdge[] {
  const parentArea = polygonArea(parent);
  const eps = Math.sqrt(Math.max(parentArea, 1e-12)) * 5e-4;
  const eps2 = eps * eps;
  const q = 1 / Math.max(eps, 1e-9);
  const seen = new Map<string, FractureEdge>();
  const out: FractureEdge[] = [];
  for (const cell of cells) {
    const pts = cell.points;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (onParentBoundary(a.x, a.y, parent, eps2)
        && onParentBoundary(b.x, b.y, parent, eps2)
        && onParentBoundary(mx, my, parent, eps2)) continue;
      // Order-normalised quantised key so the twin from the adjacent cell
      // collapses onto the same entry — and hands it its second owner.
      const k1 = `${Math.round(a.x * q)},${Math.round(a.y * q)}`;
      const k2 = `${Math.round(b.x * q)},${Math.round(b.y * q)}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      const existing = seen.get(key);
      if (existing !== undefined) {
        if (!existing.cells.includes(cell.siteIndex)) existing.cells.push(cell.siteIndex);
        continue;
      }
      const edge: FractureEdge = {
        ax: a.x, ay: a.y, bx: b.x, by: b.y, mx, my,
        cells: [cell.siteIndex],
      };
      seen.set(key, edge);
      out.push(edge);
    }
  }
  return out;
}
