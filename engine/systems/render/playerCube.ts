/** The player's WIREFRAME hull (user call): in place of the ship sprite, a
 *  3D wire cube rotating for real in the three axes the player already
 *  rotates in — yaw (the facing), pitch and roll (the directional-tilt
 *  angles, `GameEngine.tickPlayerRoll`).
 *
 *  Drawn in the entity's LOCAL frame: the caller's canvas transform already
 *  carries camera × translate × R(yaw), and a Z-rotation commutes with the
 *  ORTHOGRAPHIC projection (it only mixes x and y), so only pitch and roll
 *  need real 3D math here — Rx(roll) about the NOSE axis, then Ry(pitch)
 *  about the wing axis, signed so throttle-up lifts the nose toward the
 *  viewer, then drop z.  Deliberately NO perspective (user call): a level
 *  FLAT cube collapses to a clean square rather than a nested-frame box.
 *
 *  TWO base orientations (PLAYER_HULL_CYCLE steps 'Cube' and 'Diamond'):
 *   - FLAT — axis-aligned.  At rest the hull is a flat square with the
 *     NOSE FACE edge-on as the square's forward edge (drawn white); depth
 *     only appears once the ship tilts.
 *   - DIAMOND — the cube stood on a corner: one corner points directly UP
 *     (at the viewer — it projects to the hull's centre) and the adjacent
 *     corner leaning forward has its PROJECTION dead on the nose (exact
 *     "up" and exact "forward" can't both hold — adjacent cube corners
 *     subtend ~70.5°, not 90°, so up is exact and forward is the
 *     projection).  The silhouette is the hexagonal gem cut with a point
 *     at the aim; the three edges meeting at that forward corner draw
 *     white as the aim marker.
 *
 *  Two legibility rules shared by both: DEPTH is cued by alpha (nearer
 *  edges brighter), and the aim-marker edges draw LAST so they overdraw
 *  at every angle.  Takes no engine and no renderer — the enemyShapes
 *  contract.
 */

import { GameEntity } from '../../../types';

/** Corner i has cube-local coords (±1, ±1, ±1) by bit: bit0 → +x (the
 *  NOSE half), bit1 → +y, bit2 → +z. */
const cornerCoord = (i: number, bit: number) => ((i & bit) !== 0 ? 1 : -1);

/** DIAMOND base orientation — the rotation standing the cube on corner
 *  (1,1,1) (→ straight up, +z) with corner (1,1,−1) leaning forward (its
 *  projection along +x, the nose).  Orthonormal rows: forward = the
 *  leaning corner's perpendicular-to-up component, up = the main
 *  diagonal, side = their cross product. */
const D_FWD = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
const D_SIDE = [-1 / Math.sqrt(2), 1 / Math.sqrt(2), 0];
const D_UP = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];

/** The corner whose projection points along the nose in DIAMOND mode:
 *  (+x, +y, −z) → bits 011 → index 3.  (The up corner is (+x,+y,+z) = 7,
 *  and 3 is adjacent to it across the z edge.) */
const DIAMOND_NOSE_CORNER = 3;

/** Per-orientation unit vertices, precomputed once. */
const FLAT_BX = new Float64Array(8);
const FLAT_BY = new Float64Array(8);
const FLAT_BZ = new Float64Array(8);
const DIA_BX = new Float64Array(8);
const DIA_BY = new Float64Array(8);
const DIA_BZ = new Float64Array(8);
for (let i = 0; i < 8; i++) {
  const cx = cornerCoord(i, 1);
  const cy = cornerCoord(i, 2);
  const cz = cornerCoord(i, 4);
  FLAT_BX[i] = cx; FLAT_BY[i] = cy; FLAT_BZ[i] = cz;
  DIA_BX[i] = D_FWD[0] * cx + D_FWD[1] * cy + D_FWD[2] * cz;
  DIA_BY[i] = D_SIDE[0] * cx + D_SIDE[1] * cy + D_SIDE[2] * cz;
  DIA_BZ[i] = D_UP[0] * cx + D_UP[1] * cy + D_UP[2] * cz;
}

/** The 12 edges (index pairs differing in one bit), ordered BODY first and
 *  aim-marker (nose) edges LAST, with a parallel nose flag — one list per
 *  orientation because the marker differs: the nose FACE's four edges on
 *  the flat cube, the three edges meeting at the forward CORNER on the
 *  diamond. */
interface EdgeSet { a: Int8Array; b: Int8Array; nose: boolean[] }
function buildEdges(isNose: (a: number, b: number) => boolean): EdgeSet {
  const body: [number, number][] = [];
  const mark: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if ((i & bit) !== 0) continue;
      const j = i | bit;
      (isNose(i, j) ? mark : body).push([i, j]);
    }
  }
  const all = [...body, ...mark];
  return {
    a: Int8Array.from(all.map(e => e[0])),
    b: Int8Array.from(all.map(e => e[1])),
    nose: all.map((_, k) => k >= body.length),
  };
}
const FLAT_EDGES = buildEdges((a, b) => (a & 1) !== 0 && (b & 1) !== 0);
const DIAMOND_EDGES = buildEdges(
  (a, b) => a === DIAMOND_NOSE_CORNER || b === DIAMOND_NOSE_CORNER,
);

/** Projected-vertex scratch — one hull per frame, so module scratch beats
 *  per-call allocation (CLAUDE.md §8, mutate don't allocate). */
const _vx = new Float64Array(8);
const _vy = new Float64Array(8);
const _vz = new Float64Array(8);

/** Half-edge as a fraction of the entity's max dimension.  The sprite drew
 *  at 1.5× maxDim; a wire hull reads denser than a silhouette, so a touch
 *  smaller sits the same visual weight on the same hitbox. */
const HALF_EDGE_FRAC = 0.68;

export function drawPlayerCube(
  ctx: CanvasRenderingContext2D,
  entity: GameEntity,
  diamond: boolean,
) {
  const maxDim = Math.max(entity.size.x, entity.size.y);
  const h = maxDim * HALF_EDGE_FRAC;
  const p = entity.visualPitch ?? 0;
  const r = entity.visualRoll ?? 0;
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  const bx = diamond ? DIA_BX : FLAT_BX;
  const by = diamond ? DIA_BY : FLAT_BY;
  const bz = diamond ? DIA_BZ : FLAT_BZ;
  const edges = diamond ? DIAMOND_EDGES : FLAT_EDGES;

  for (let i = 0; i < 8; i++) {
    const x = bx[i] * h;
    const y = by[i] * h;
    const z = bz[i] * h;
    // Rx(roll) about the nose axis…
    const y1 = y * cr - z * sr;
    const z1 = y * sr + z * cr;
    // …then Ry(pitch) about the wing axis, nose-up = toward the viewer,
    // and an orthographic drop of z.
    _vx[i] = x * cp - z1 * sp;
    _vy[i] = y1;
    _vz[i] = x * sp + z1 * cp;
  }

  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let e = 0; e < 12; e++) {
    const a = edges.a[e];
    const b = edges.b[e];
    // Depth cue: vertex z is bounded by ±√3·h, so this maps near→bright
    // without clipping.
    const t = Math.max(0, Math.min(1, 0.5 + (_vz[a] + _vz[b]) / (4 * h)));
    ctx.strokeStyle = edges.nose[e]
      ? `rgba(255, 255, 255, ${(0.65 + 0.35 * t).toFixed(3)})`
      : `rgba(125, 211, 252, ${(0.30 + 0.55 * t).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(_vx[a], _vy[a]);
    ctx.lineTo(_vx[b], _vy[b]);
    ctx.stroke();
  }

  // Hit flash — the same blow-out-toward-white read the sprite had: one
  // white re-stroke of every edge, faded by the flash timer.
  if (entity.hitFlash && entity.hitFlash > 0) {
    const f = Math.min(1, entity.hitFlash * 3);
    ctx.strokeStyle = `rgba(255, 255, 255, ${f.toFixed(3)})`;
    for (let e = 0; e < 12; e++) {
      ctx.beginPath();
      ctx.moveTo(_vx[edges.a[e]], _vy[edges.a[e]]);
      ctx.lineTo(_vx[edges.b[e]], _vy[edges.b[e]]);
      ctx.stroke();
    }
  }
}
