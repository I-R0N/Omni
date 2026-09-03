/** The player's WIREFRAME hull (user call): in place of the ship sprite, a
 *  3D wire POLYHEDRON rotating for real in the three axes the player
 *  already rotates in — yaw (the facing), pitch and roll (the
 *  directional-tilt angles, `GameEngine.tickPlayerRoll`).
 *
 *  Drawn in the entity's LOCAL frame: the caller's canvas transform already
 *  carries camera × translate × R(yaw), and a Z-rotation commutes with the
 *  ORTHOGRAPHIC projection (it only mixes x and y), so only pitch and roll
 *  need real 3D math here — Rx(roll) about the NOSE axis, then Ry(pitch)
 *  about the wing axis, signed so throttle-up lifts the nose toward the
 *  viewer, then drop z.  Deliberately NO perspective (user call).
 *
 *  EVERY shape is a vertex/edge TABLE (`HullDef`), so a new hull is a
 *  table entry, never a new draw path.  A def carries unit-radius
 *  vertices, edges ordered BODY-first with the aim-marker (nose) edges
 *  LAST so they overdraw at every angle, and a per-shape draw scale so
 *  the silhouettes carry the same visual weight on the same hitbox.
 *  The shapes (PLAYER_HULL_CYCLE):
 *   - CUBE — axis-aligned; at rest a flat square with the NOSE FACE
 *     edge-on as the forward edge (drawn white).
 *   - DIAMOND — the cube stood on a corner: one corner points directly UP
 *     (at the viewer — it projects to the hull's centre) and the adjacent
 *     corner leaning forward has its PROJECTION dead on the nose (exact
 *     "up" and exact "forward" can't both hold — adjacent cube corners
 *     subtend ~70.5°).  Gem-cut hexagonal silhouette, aim = the three
 *     edges meeting at the forward corner.
 *   - SPHERE — three orthogonal great-circle rings; rotationally
 *     symmetric, so the aim marker is a small white ring around the nose
 *     pole (without it a sphere has no readable orientation at all).
 *   - DODECA — a regular dodecahedron, rotated so a pentagonal FACE
 *     normal lies on the nose axis; aim = that face's five edges.  Edges
 *     are found by the edge-length threshold rather than authored.
 *   - RHOMBIC — a rhombic dodecahedron (8 cube corners + 6 axis
 *     vertices); a degree-4 axis vertex is the nose, aim = its four
 *     edges.
 *   - TRI — the triangular DART ship (the one shape that is a ship
 *     rather than a solid): nose far forward, two swept wingtips, a
 *     dorsal peak and a ventral keel for 3D depth; aim = the four nose
 *     edges, the lit leading edge.
 *
 *  Under the REVERSED lean direction (DBG "Lean dir") every shape is
 *  RE-BASED nose-up (user call): the nose feature faces the VIEWER at
 *  rest instead of the aim — a +90° pitch of the geometry alone, applied
 *  before the dynamic roll/pitch so both keep acting in the travel frame.
 *
 *  Two legibility rules shared by all: DEPTH is cued by alpha (nearer
 *  edges brighter), and in TUMBLE tilt mode the aim marker HIDES (a
 *  marker spinning with the hull reads as noise) and a small fixed
 *  CHEVRON RETICLE ahead of the hull carries the aim instead — drawn in
 *  the yaw frame, so it ignores the tumble.  Takes no engine and no
 *  renderer — the enemyShapes contract.
 */

import { GameEntity } from '../../../types';
import type { PlayerHullMode } from '../../../constants';

interface HullDef {
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  ea: Int16Array;
  eb: Int16Array;
  /** Aim-marker flag per edge; marker edges are ordered LAST. */
  nose: boolean[];
  /** Draw radius as a fraction of the entity's max dimension — per shape,
   *  because a sphere's silhouette IS its bounding circle while a cube's
   *  resting square is well inside its corner radius. */
  scale: number;
}

/** Normalize raw vertices to UNIT bounding radius and order edges
 *  body-first / marker-last. */
function makeDef(
  verts: number[][],
  edges: [number, number][],
  isNose: (a: number, b: number) => boolean,
  scale: number,
): HullDef {
  const maxR = Math.max(...verts.map(v => Math.hypot(v[0], v[1], v[2])));
  const body = edges.filter(e => !isNose(e[0], e[1]));
  const mark = edges.filter(e => isNose(e[0], e[1]));
  const all = [...body, ...mark];
  return {
    vx: Float64Array.from(verts.map(v => v[0] / maxR)),
    vy: Float64Array.from(verts.map(v => v[1] / maxR)),
    vz: Float64Array.from(verts.map(v => v[2] / maxR)),
    ea: Int16Array.from(all.map(e => e[0])),
    eb: Int16Array.from(all.map(e => e[1])),
    nose: all.map((_, k) => k >= body.length),
    scale,
  };
}

/** Edges by mutual distance — the honest way to wire a polyhedron whose
 *  coordinates are known but whose adjacency is tedious to author. */
function edgesByLength(verts: number[][], len: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const d = Math.hypot(
        verts[i][0] - verts[j][0],
        verts[i][1] - verts[j][1],
        verts[i][2] - verts[j][2],
      );
      if (Math.abs(d - len) < 1e-6) out.push([i, j]);
    }
  }
  return out;
}

// ── CUBE / DIAMOND ─────────────────────────────────────────────────────
// Corner i = (±1,±1,±1) by bit: bit0 → +x (the NOSE half), bit1 → +y,
// bit2 → +z.
const bit = (i: number, b: number) => ((i & b) !== 0 ? 1 : -1);
const CUBE_VERTS = Array.from({ length: 8 }, (_, i) =>
  [bit(i, 1), bit(i, 2), bit(i, 4)]);
const CUBE_EDGES: [number, number][] = [];
for (let i = 0; i < 8; i++) {
  for (const b of [1, 2, 4]) if ((i & b) === 0) CUBE_EDGES.push([i, i | b]);
}
const CUBE = makeDef(
  CUBE_VERTS, CUBE_EDGES,
  (a, b) => (a & 1) !== 0 && (b & 1) !== 0,   // the +x nose face's 4 edges
  1.18,  // √3 × the shipped 0.68 half-edge — the cube draws as it always has
);

// DIAMOND base orientation — the rotation standing the cube on corner
// (1,1,1) (→ straight up, +z) with corner (1,1,−1) leaning forward (its
// projection along +x, the nose).  Rows: forward = the leaning corner's
// perpendicular-to-up component, up = the main diagonal, side = the cross.
const D_FWD = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
const D_SIDE = [-1 / Math.sqrt(2), 1 / Math.sqrt(2), 0];
const D_UP = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const DIAMOND_NOSE_CORNER = 3; // (+x,+y,−z), adjacent to the up corner 7
const DIAMOND = makeDef(
  CUBE_VERTS.map(v => [
    D_FWD[0] * v[0] + D_FWD[1] * v[1] + D_FWD[2] * v[2],
    D_SIDE[0] * v[0] + D_SIDE[1] * v[1] + D_SIDE[2] * v[2],
    D_UP[0] * v[0] + D_UP[1] * v[1] + D_UP[2] * v[2],
  ]),
  CUBE_EDGES,
  (a, b) => a === DIAMOND_NOSE_CORNER || b === DIAMOND_NOSE_CORNER,
  1.18,
);

// ── SPHERE ─────────────────────────────────────────────────────────────
// Three orthogonal great circles + the nose ring, each a closed polyline.
const SPHERE_VERTS: number[][] = [];
const SPHERE_EDGES: [number, number][] = [];
const SPHERE_NOSE_FIRST = (() => {
  const ring = (point: (t: number) => number[], n: number) => {
    const start = SPHERE_VERTS.length;
    for (let k = 0; k < n; k++) SPHERE_VERTS.push(point((k / n) * 2 * Math.PI));
    for (let k = 0; k < n; k++) SPHERE_EDGES.push([start + k, start + ((k + 1) % n)]);
    return start;
  };
  ring(t => [Math.cos(t), Math.sin(t), 0], 16);                 // equator (XY)
  ring(t => [Math.cos(t), 0, Math.sin(t)], 16);                 // meridian (XZ)
  ring(t => [0, Math.cos(t), Math.sin(t)], 16);                 // meridian (YZ)
  // The aim marker: a small ring around the +x pole — a sphere is the one
  // shape with no orientation to read without it.
  const beta = 0.45;
  return ring(t => [Math.cos(beta), Math.sin(beta) * Math.cos(t), Math.sin(beta) * Math.sin(t)], 8);
})();
const SPHERE = makeDef(
  SPHERE_VERTS, SPHERE_EDGES,
  (a, b) => a >= SPHERE_NOSE_FIRST && b >= SPHERE_NOSE_FIRST,
  0.78,
);

// ── DODECAHEDRON ───────────────────────────────────────────────────────
const PHI = (1 + Math.sqrt(5)) / 2;
const DODECA_RAW: number[][] = [];
for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
  DODECA_RAW.push([sx, sy, sz]);
}
for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
  DODECA_RAW.push([0, s1 / PHI, s2 * PHI]);
  DODECA_RAW.push([s1 / PHI, s2 * PHI, 0]);
  DODECA_RAW.push([s1 * PHI, 0, s2 / PHI]);
}
// Rotate the face whose normal is (1, 0, φ) onto the nose axis (+x) —
// a rotation about y, since the normal already has y = 0.
const DODECA_VERTS = (() => {
  const alpha = Math.atan2(PHI, 1);
  const c = Math.cos(-alpha), s = Math.sin(-alpha);
  return DODECA_RAW.map(v => [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]);
})();
const DODECA_EDGES = edgesByLength(DODECA_VERTS, 2 / PHI);
// The forward face's ring: the five most-forward vertices (they share the
// max x by construction, all other vertices sit measurably behind).
const DODECA_FACE = (() => {
  const maxX = Math.max(...DODECA_VERTS.map(v => v[0]));
  const set = new Set<number>();
  DODECA_VERTS.forEach((v, i) => { if (v[0] > maxX - 1e-6) set.add(i); });
  return set;
})();
const DODECA = makeDef(
  DODECA_VERTS, DODECA_EDGES,
  (a, b) => DODECA_FACE.has(a) && DODECA_FACE.has(b),
  0.92,
);

// ── RHOMBIC DODECAHEDRON ───────────────────────────────────────────────
// 8 cube corners + 6 axis vertices; every edge joins a corner to an
// adjacent axis vertex (length √3).  The +x axis vertex is the nose.
const RHOMBIC_VERTS: number[][] = [...CUBE_VERTS.map(v => [...v])];
for (const ax of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]]) {
  RHOMBIC_VERTS.push(ax);
}
const RHOMBIC_NOSE_VERTEX = 8; // (2, 0, 0)
const RHOMBIC = makeDef(
  RHOMBIC_VERTS, edgesByLength(RHOMBIC_VERTS, Math.sqrt(3)),
  (a, b) => a === RHOMBIC_NOSE_VERTEX || b === RHOMBIC_NOSE_VERTEX,
  0.95,
);

// ── TRI — the triangular DART ship ─────────────────────────────────────
// The one shape here that is a SHIP rather than a solid: a nose vertex
// far forward, two wingtips swept aft, and a dorsal peak + ventral keel
// amidships-aft giving the body real 3D depth — so a bank visibly dips a
// wing and a pitch shows the spine or the keel.  At rest the silhouette
// is a clean arrowhead with the ridge lines converging aft; the dorsal-
// to-keel strut projects to a point at rest (both sit on the centreline)
// and opens up as the hull tilts, which is itself a depth cue.  The four
// edges meeting at the nose are the white marker — the lit leading edge.
const TRI_VERTS: number[][] = [
  [2.0, 0, 0],        // 0 nose
  [-1.0, -1.15, 0],   // 1 port wingtip
  [-1.0, 1.15, 0],    // 2 starboard wingtip
  [-0.55, 0, 0.55],   // 3 dorsal peak
  [-0.55, 0, -0.35],  // 4 ventral keel
];
const TRI_EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [0, 4],  // leading edges + nose ridges
  [1, 2],                          // tail edge
  [1, 3], [2, 3],                  // wing → dorsal
  [1, 4], [2, 4],                  // wing → keel
  [3, 4],                          // aft strut (a point at rest)
];
const TRI = makeDef(
  TRI_VERTS, TRI_EDGES,
  (a, b) => a === 0 || b === 0,
  1.30,  // long and narrow — drawn larger so it carries the cube's visual mass
);

const HULL_DEFS: Partial<Record<PlayerHullMode, HullDef>> = {
  cube: CUBE,
  diamond: DIAMOND,
  sphere: SPHERE,
  dodeca: DODECA,
  rhombic: RHOMBIC,
  tri: TRI,
};

/** Projected-vertex scratch, sized for the largest shape (the sphere's
 *  56) — one hull per frame, so module scratch beats per-call allocation
 *  (CLAUDE.md §8, mutate don't allocate). */
const MAX_VERTS = Math.max(...Object.values(HULL_DEFS).map(d => d!.vx.length));
const _vx = new Float64Array(MAX_VERTS);
const _vy = new Float64Array(MAX_VERTS);
const _vz = new Float64Array(MAX_VERTS);

export function drawPlayerCube(
  ctx: CanvasRenderingContext2D,
  entity: GameEntity,
  mode: PlayerHullMode,
  tumble: boolean,
  noseUp: boolean,
) {
  const def = HULL_DEFS[mode] ?? CUBE;
  const maxDim = Math.max(entity.size.x, entity.size.y);
  const R = maxDim * def.scale;
  const p = entity.visualPitch ?? 0;
  const r = entity.visualRoll ?? 0;
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  const nV = def.vx.length;
  const nE = def.ea.length;

  for (let i = 0; i < nV; i++) {
    let x = def.vx[i] * R;
    const y = def.vy[i] * R;
    let z = def.vz[i] * R;
    // NOSE-UP re-base (user call, rides the Reversed lean direction): the
    // shape stands with its nose FEATURE facing the VIEWER at rest —
    // (x,y,z) → (−z,y,x), a +90° pitch of the GEOMETRY only, applied
    // before the dynamic rotations so roll and pitch keep acting in the
    // travel frame (bank still turns about the travel axis).
    if (noseUp) {
      const t = x;
      x = -z;
      z = t;
    }
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
  for (let e = 0; e < nE; e++) {
    const a = def.ea[e];
    const b = def.eb[e];
    // Depth cue: vertex z is bounded by ±R, so this maps near→bright
    // without clipping.
    const t = Math.max(0, Math.min(1, 0.5 + (_vz[a] + _vz[b]) / (3 * R)));
    // In TUMBLE the aim marker HIDES (user call): a marker spinning with
    // the hull reads as noise, not as an aim — the fixed reticle below
    // carries the direction instead.
    ctx.strokeStyle = !tumble && def.nose[e]
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
    for (let e = 0; e < nE; e++) {
      ctx.beginPath();
      ctx.moveTo(_vx[def.ea[e]], _vy[def.ea[e]]);
      ctx.lineTo(_vx[def.eb[e]], _vy[def.eb[e]]);
      ctx.stroke();
    }
  }

  // TUMBLE aim reticle (user call): a small white chevron parked ahead of
  // the hull.  Drawn in the yaw-rotated local frame — so it tracks the
  // AIM and ignores the tumbling pitch/roll entirely, which is exactly
  // what makes it readable while the hull spins.
  if (tumble) {
    const rx0 = R * 1.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx0, -R * 0.26);
    ctx.lineTo(rx0 + R * 0.3, 0);
    ctx.lineTo(rx0, R * 0.26);
    ctx.stroke();
  }
}
