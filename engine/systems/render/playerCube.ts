/** The player's WIREFRAME-CUBE hull (user call): in place of the ship
 *  sprite, a 3D wire cube rotating for real in the three axes the player
 *  already rotates in — yaw (the facing), pitch and roll (the
 *  directional-tilt angles, `GameEngine.tickPlayerRoll`).
 *
 *  Drawn in the entity's LOCAL frame: the caller's canvas transform already
 *  carries camera × translate × R(yaw), and a Z-rotation commutes with this
 *  projection (it only mixes x and y, and the perspective divide reads only
 *  z), so only pitch and roll need real 3D math here — Rx(roll) about the
 *  NOSE axis, then Ry(pitch) about the wing axis, signed so throttle-up
 *  lifts the nose toward the viewer, then a MILD perspective divide.  The
 *  perspective is load-bearing, not flourish: orthographic, a level cube
 *  projects to a flat square (front and back faces coincide exactly) and
 *  the shape only reads as 3D once it tilts — the divide keeps the front
 *  face larger than the back at rest, so it reads as a cube at all times.
 *  Two more legibility rules: DEPTH is cued by alpha (nearer edges
 *  brighter), and the NOSE face's four edges draw last, in white, so the
 *  aim stays readable on a shape that is otherwise symmetric under every
 *  quarter turn.  Takes no engine and no renderer — the enemyShapes
 *  contract.
 */

import { GameEntity } from '../../../types';

/** Vertex i has local coords (±1, ±1, ±1) by bit: bit0 → +x (the NOSE
 *  half), bit1 → +y, bit2 → +z. */
const EDGES: ReadonlyArray<readonly [number, number]> = (() => {
  const body: [number, number][] = [];
  const nose: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if ((i & bit) !== 0) continue;
      const j = i | bit;
      // Nose-face edges connect two +x vertices; everything else is body.
      if ((i & 1) !== 0 && (j & 1) !== 0) nose.push([i, j]);
      else body.push([i, j]);
    }
  }
  // Body first, nose last, so the aim marker overdraws at every angle.
  return [...body, ...nose];
})();

/** Projected-vertex scratch — one hull per frame, so module scratch beats
 *  per-call allocation (CLAUDE.md §8, mutate don't allocate). */
const _vx = new Float64Array(8);
const _vy = new Float64Array(8);
const _vz = new Float64Array(8);

/** Cube half-edge as a fraction of the entity's max dimension.  The sprite
 *  drew at 1.5× maxDim; a cube reads denser than a silhouette, so a touch
 *  smaller sits the same visual weight on the same hitbox. */
const HALF_EDGE_FRAC = 0.68;

/** Perspective focal length as a multiple of the half-edge.  Smaller =
 *  deeper perspective; 3.5 puts the level cube's front face ~1.4× the
 *  back — clearly a cube, not yet a fisheye. */
const FOCAL_FRAC = 3.5;

export function drawPlayerCube(ctx: CanvasRenderingContext2D, entity: GameEntity) {
  const maxDim = Math.max(entity.size.x, entity.size.y);
  const h = maxDim * HALF_EDGE_FRAC;
  const p = entity.visualPitch ?? 0;
  const r = entity.visualRoll ?? 0;
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);

  const f = h * FOCAL_FRAC;
  for (let i = 0; i < 8; i++) {
    const x = (i & 1) ? h : -h;
    const y = (i & 2) ? h : -h;
    const z = (i & 4) ? h : -h;
    // Rx(roll) about the nose axis…
    const y1 = y * cr - z * sr;
    const z1 = y * sr + z * cr;
    // …then Ry(pitch) about the wing axis, nose-up = toward the viewer.
    const x2 = x * cp - z1 * sp;
    const z2 = x * sp + z1 * cp;
    // Perspective divide: nearer (positive z) draws larger.  |z2| ≤ 2h <
    // f, so the denominator never crosses zero.
    const s = f / (f - z2);
    _vx[i] = x2 * s;
    _vy[i] = y1 * s;
    _vz[i] = z2;
  }

  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let e = 0; e < EDGES.length; e++) {
    const [a, b] = EDGES[e];
    // Depth cue: each vertex z is bounded by ±2h across the tilt range, so
    // this maps near→1, far→0 without ever clipping.
    const t = Math.max(0, Math.min(1, 0.5 + (_vz[a] + _vz[b]) / (4 * h)));
    const nose = (a & 1) !== 0 && (b & 1) !== 0;
    ctx.strokeStyle = nose
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
    for (let e = 0; e < EDGES.length; e++) {
      const [a, b] = EDGES[e];
      ctx.beginPath();
      ctx.moveTo(_vx[a], _vy[a]);
      ctx.lineTo(_vx[b], _vy[b]);
      ctx.stroke();
    }
  }
}
