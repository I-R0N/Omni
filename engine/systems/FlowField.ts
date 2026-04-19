/**
 * FlowField — continuous toroidal streaming field for asteroid motion.
 *
 * Previously a sum of CCW vortices centered on fixed world positions,
 * which produced convergence hotspots (asteroids piled up at the
 * central vortex centre and at vortex overlaps) and a discontinuity
 * across the wrap seam (the vortex at +7000 had no counterpart across
 * the +7500 edge, so a wrapping asteroid saw an abrupt direction
 * change).
 *
 * The new field is direction-only — every sample returns a unit vector,
 * so the magnitude is constant across the map and no point acts as a
 * sink or dead spot.  The angle is a periodic function of world
 * position, built from sine/cosine terms with wavelengths equal to
 * MAP_WIDTH / MAP_HEIGHT, so it lines up with the wrap seam:
 *
 *     θ(x, y) = BASE + AMP_X·sin(2π·x/MAP_WIDTH)
 *                    + AMP_Y·cos(2π·y/MAP_HEIGHT)
 *
 * BASE points along an irrational slope (1, φ-1) where φ is the
 * golden ratio; combined with the ±(AMP_X + AMP_Y) swing, the
 * resulting streamlines are non-closing meanders that drift across
 * the map while weaving in and out of the wrap edges — a long
 * twisting loop instead of a tight local orbit.
 *
 * The field is defined analytically so it's trivially periodic and
 * cheap to sample; FlowFieldGrid still bakes it into a per-cell
 * vector once on map load for the hot sim path.
 */

import { MAP_WIDTH, MAP_HEIGHT, onMapDimensionsChanged } from '../toroidal';

export interface FlowVector {
  x: number;
  y: number;
}

// Golden ratio minus one — irrational slope, so streamlines never close
// exactly (ergodic on the torus) and asteroids keep meandering instead
// of orbiting one location.
const PHI_MINUS_ONE = 0.6180339887498949;
const BASE_ANGLE = Math.atan2(PHI_MINUS_ONE, 1); // ≈ 31.7°

// Angle-swing amplitudes (radians).  Combined peak-to-peak swing is
// ±(AMP_X + AMP_Y) ≈ ±92° around BASE_ANGLE — wide enough for visible
// twisting without ever turning the flow fully back on itself, which
// would create local trap orbits.
const AMP_X = 0.8;
const AMP_Y = 0.8;

let TWO_PI_OVER_W = (2 * Math.PI) / MAP_WIDTH;
let TWO_PI_OVER_H = (2 * Math.PI) / MAP_HEIGHT;
onMapDimensionsChanged((w, h) => {
    TWO_PI_OVER_W = (2 * Math.PI) / w;
    TWO_PI_OVER_H = (2 * Math.PI) / h;
});

/**
 * Sample the flow field at world position (wx, wy).  Returns a unit
 * vector along the local stream direction.  Magnitude is always 1,
 * so the field has no stagnation points — no region where asteroids
 * can pile up or stall out.
 */
export function sampleFlow(wx: number, wy: number): FlowVector {
  const theta = BASE_ANGLE
              + AMP_X * Math.sin(TWO_PI_OVER_W * wx)
              + AMP_Y * Math.cos(TWO_PI_OVER_H * wy);
  return { x: Math.cos(theta), y: Math.sin(theta) };
}
