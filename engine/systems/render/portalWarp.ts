/** THE TRANSIT WARP — the flight through a wormhole.
 *
 *  A short screen-space beat played on ARRIVAL, over the destination map,
 *  which is already loaded and sitting behind the veil.  The sequence the
 *  frame is built around:
 *
 *    1. the lens distortion UNROLLS — the standing twist around the rift
 *       straightens into radial lines as the ship enters the throat,
 *    2. the sky STREAMS outward past the hull while it flies up the tunnel,
 *    3. everything DECELERATES and the arena is revealed.
 *
 *  Like `enemyShapes` and `dropShapes` this takes neither an engine nor a
 *  renderer — the whole effect is a function of ONE number, the beat's
 *  progress — which is what keeps it testable and impossible to leave in a
 *  bad state: there is no state to leave.
 *
 *  IT IS A PROJECTION, NOT A SCALE-UP.  A point at depth z draws at radius
 *  NEAR_R/z, so flying forward (z shrinking) sweeps points outward the way
 *  real motion does: barely moving near the vanishing point, then rushing as
 *  they pass the ship.  Scaling a ring set by a growing factor gives uniform
 *  radial motion instead, which reads as a zoom rather than as travel.
 *
 *  Cost per frame: one rect, ~19 stroked arcs, and one batched path of ~200
 *  line segments.  No allocation — the per-star constants are module-scope
 *  typed arrays seeded once, and every frame is derived from progress alone,
 *  so nothing has to be advanced, stored or reset between frames.
 */
import { PORTAL_CONSTANTS } from '../../../constants';

const W = PORTAL_CONSTANTS.WARP;

/** Per-star bearing and depth phase, seeded ONCE.  Deterministic (a fixed
 *  LCG rather than Math.random) so the tunnel is the same every transit —
 *  a beat the player sees dozens of times per run should not shimmer
 *  differently each time for no reason. */
const starAngle = new Float32Array(W.STARS);
const starPhase = new Float32Array(W.STARS);
const starBright = new Float32Array(W.STARS);
(() => {
  let s = 0x9e3779b9;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), s | 1) ^ (s + 0x6d2b79f5)) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < W.STARS; i++) {
    starAngle[i] = rand() * Math.PI * 2;
    starPhase[i] = rand();
    starBright[i] = 0.35 + rand() * 0.65;
  }
})();

/** Depth remaining for a point whose phase is `u`, after travelling `t`.
 *  Wrapped into (0, 1], so a point that passes the ship re-enters at the
 *  vanishing point and the tunnel never runs out of walls. */
function depth(u: number, t: number): number {
  const z = (u - t) % 1;
  return z <= 0 ? z + 1 : z;
}

/** Ease-out cubic — the deceleration.  The beat's whole shape lives here:
 *  travel is `TRAVEL × easeOut(p)`, so speed is the derivative, high at
 *  entry and heading to zero exactly as the arena appears.  A linear travel
 *  would arrive at full speed and cut, which reads as a dropped frame. */
function easeOut(p: number): number {
  const q = 1 - p;
  return 1 - q * q * q;
}

/** Draw the whole beat.  `p` is progress 0→1; `w`/`h` are CSS pixels, and the
 *  caller is expected to have the identity-ish DPR transform in place (the
 *  same space the HUD draws in). */
export function renderPortalWarp(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: number,
): void {
  if (!(p > 0) || p >= 1) return;

  const cx = w / 2;
  const cy = h / 2;
  const half = Math.hypot(w, h) / 2;      // corner distance — the cull radius
  const nearR = half * W.NEAR_R;

  const travel = W.TRAVEL * easeOut(p);
  // Normalised speed, for streak length and for how hard the arcs are drawn.
  // d/dp of easeOut is 3(1-p)^2, at its largest (3) on entry.
  const speed = (1 - p) * (1 - p);

  // ── The veil ────────────────────────────────────────────────────────────
  // Dims the world fast on entry and lifts it over the tail, which IS the
  // reveal — the arena behind it was loaded before the beat started, so
  // nothing has to be timed against a load.  Left slightly translucent at its
  // deepest so the ship stays faintly visible at the centre: the player
  // should be able to see they are the thing moving.
  let veil: number;
  if (p < W.VEIL_IN) veil = (p / W.VEIL_IN) * W.VEIL;
  else if (p > 1 - W.VEIL_OUT) veil = ((1 - p) / W.VEIL_OUT) * W.VEIL;
  else veil = W.VEIL;
  ctx.globalAlpha = Math.max(0, Math.min(1, veil));
  ctx.fillStyle = '#05030c';
  ctx.fillRect(0, 0, w, h);

  // Everything below fades with the veil, so the tunnel arrives and leaves
  // with the darkness rather than hanging over the revealed arena.
  const fade = Math.max(0, Math.min(1, veil / W.VEIL));
  if (fade <= 0.01) { ctx.globalAlpha = 1; return; }

  const [pr, pg, pb] = [168, 85, 247];   // PORTAL_CONSTANTS.COLOR, violet

  // ── The tunnel walls: concentric depth rings ────────────────────────────
  // Evenly spaced in DEPTH, which puts them unevenly on screen — bunched at
  // the vanishing point, spreading as they approach — and that spacing is the
  // whole perspective cue.
  ctx.lineWidth = 1.4;
  for (let i = 0; i < W.RINGS; i++) {
    const z = depth(i / W.RINGS, travel);
    const r = nearR / z;
    if (r > half * 1.6) continue;
    // Fade in from the vanishing point and out again as they sweep past, so
    // rings neither pop into existence nor clip at the screen edge.
    const a = fade * 0.5 * Math.min(1, (1 - z) * 2.2) * Math.min(1, (half * 1.6 - r) / half);
    if (a <= 0.01) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgb(${pr},${pg},${pb})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── The Smith-chart family: circles tangent at the vanishing point ──────
  // Each is centred out along its own bearing at exactly its own radius, so
  // it passes through the centre.  A Smith chart's constant-reactance arcs
  // are this same family, and the tangency is what makes the mouth read as a
  // funnel converging on where the ship is going rather than as flat rings.
  ctx.lineWidth = 1;
  for (let i = 0; i < W.ARCS; i++) {
    const z = depth((i + 0.5) / W.ARCS, travel);
    const rho = nearR / z;
    if (rho > half * 2.4) continue;
    const ang = starAngle[i * 7 % W.STARS];
    const a = fade * 0.3 * Math.min(1, (1 - z) * 2.2) * Math.min(1, (half * 2.4 - rho) / half);
    if (a <= 0.01) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgb(${pr},${pg},${pb})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * rho, cy + Math.sin(ang) * rho, rho, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── The sky streaming past ──────────────────────────────────────────────
  // One batched path for every streak, then a single stroke: ~200 segments at
  // the cost of one canvas state change.  Streak length follows SPEED, so the
  // stars draw themselves out into lines on entry and pull back into points
  // as the ship slows — the deceleration is legible in the marks themselves,
  // not only in how fast they move.
  ctx.globalAlpha = fade;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const streakK = W.STREAK * (0.25 + speed * 3);
  for (let i = 0; i < W.STARS; i++) {
    const z = depth(starPhase[i], travel);
    const r = nearR / z;
    if (r > half * 1.35) continue;
    const ca = Math.cos(starAngle[i]);
    const sa = Math.sin(starAngle[i]);
    const tail = Math.max(1, r * streakK);
    ctx.moveTo(cx + ca * r, cy + sa * r);
    ctx.lineTo(cx + ca * (r + tail), cy + sa * (r + tail));
  }
  ctx.stroke();

  // ── The throat ──────────────────────────────────────────────────────────
  // A small bright core at the vanishing point: the far end of the tunnel,
  // the thing being flown toward.  It swells as the ship arrives, which is
  // the last cue before the veil lifts on the arena.
  const coreR = nearR * (0.5 + p * 1.6);
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`);
  core.addColorStop(0.45, `rgba(${pr},${pg},${pb},${0.5 * fade})`);
  core.addColorStop(1, `rgba(${pr},${pg},${pb},0)`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}
