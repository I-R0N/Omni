/** THE TRANSIT WARP — the shape of the flight through a wormhole.
 *
 *  A short beat played on ARRIVAL, over the destination map, which is already
 *  loaded and sitting behind the veil:
 *
 *    1. the world washes out as the ship enters the throat,
 *    2. the sky STREAMS outward past the hull while it flies up the tunnel,
 *    3. everything DECELERATES and the arena is revealed.
 *
 *  This module owns steps 1 and 3 — the veil — and the CURVES that define the
 *  whole beat.  Step 2 is drawn by `BackgroundManager.renderWarpStars`,
 *  because the streaks are the REAL star field (user call): the same stars,
 *  at their own bearings, in their own colours and sizes, that the player was
 *  already looking at — swept outward.  A synthetic set of tunnel stars was
 *  tried first and thrown away; it is the same picture with none of the
 *  continuity, because the sky streaming past is then not the sky you were in.
 *
 *  Everything here is a pure function of ONE number, the beat's progress,
 *  which is what keeps it testable and impossible to leave in a bad state:
 *  there is no state to leave.
 */
import { PORTAL_CONSTANTS } from '../../../constants';

const W = PORTAL_CONSTANTS.WARP;

/** SMOOTHERSTEP — how far the sky has been swept outward, 1 -> EXPAND.
 *
 *  Speed is this curve's derivative: zero at both ends, peaking in the
 *  middle.  So the ship ROLLS INTO the throat rather than starting at full
 *  pelt (user call — an animation that opens at maximum speed reads as a cut,
 *  and gives the eye nothing to carry over from the world it just left), then
 *  decelerates onto the arena.
 *
 *  Quintic rather than the cubic ease-in-out: it zeroes ACCELERATION at the
 *  ends too, so there is no visible kick at the moment the veil starts
 *  moving — exactly where a discontinuity would be noticed. */
export function warpExpansion(p: number): number {
  const c = p * p * p * (p * (p * 6 - 15) + 10);
  return 1 + (W.EXPAND - 1) * c;
}

/** Normalised speed, 0..1 — the derivative of the curve above over its own
 *  peak (30p^2(1-p)^2, at most 1.875).  Drives streak length, so the
 *  acceleration and the deceleration are legible in the MARKS themselves and
 *  not only in how fast they travel: the sky draws itself out into lines as
 *  the ship winds up, and pulls back into points as it arrives. */
export function warpSpeed(p: number): number {
  const q = 1 - p;
  return 16 * p * p * q * q;
}

/** How present the beat is, 0..1 — the veil's own level, normalised.  The
 *  streak layer rides this, so the tunnel leaves WITH the darkness rather
 *  than hanging over the revealed arena.
 *
 *  IT OPENS AT FULL, and that is the fix for a real bug rather than a taste
 *  call (user report: "the destination arena appears briefly before the warp
 *  animation").  The map is swapped SYNCHRONOUSLY when the transit is
 *  triggered, so from that instant the world behind this veil is the
 *  DESTINATION.  Any ramp-in at all is therefore a window onto the place the
 *  beat exists to reveal — and the window was widest at the worst moment:
 *  the frame the transit happens in draws at p EXACTLY 0, where a fade-in is
 *  zero and the arena was fully visible for a frame, more if that frame was
 *  slow.  A fade cannot be made short enough to fix that; only starting at
 *  full can, which is why VEIL_IN is gone rather than merely small. */
export function warpFade(p: number): number {
  if (p > 1 - W.VEIL_OUT) return Math.max(0, Math.min(1, (1 - p) / W.VEIL_OUT));
  return 1;
}

/** The veil's actual alpha for this progress — what the renderer paints, and
 *  what `tests/maps.spec.ts` reads back to prove the destination cannot show
 *  through at any point before the reveal. */
export function warpVeilAlpha(p: number): number {
  return warpFade(p) * W.VEIL;
}

/** The veil: takes the world away, and gives it back.  Drawn over the world
 *  and UNDER the streaking sky, so what the player sees mid-beat is stars and
 *  their own hull, with the arena waiting behind it. */
/** Returns the alpha it ACTUALLY painted — 0 when it drew nothing.  The
 *  caller publishes that (RenderSystem.lastWarpVeilAlpha) so a test reads
 *  what reached the screen rather than what the maths says it should have:
 *  the bug this replaced was a guard that SKIPPED the draw, which a
 *  recomputed alpha would have reported as covered. */
export function renderPortalWarpVeil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: number,
): number {
  // p === 0 IS a drawn frame — the transit's own frame.  Skipping it (the
  // old `!(p > 0)` guard) is precisely how the destination flashed before
  // the beat: the swap is synchronous, so that frame already shows the
  // arena, and it was the one frame the veil declined to paint.
  if (p < 0 || p >= 1) return 0;
  const a = warpVeilAlpha(p);
  ctx.globalAlpha = a;
  ctx.fillStyle = '#05030c';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  return a;
}
