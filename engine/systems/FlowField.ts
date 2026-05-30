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

// ─── selectable flow patterns (DBG) ─────────────────────────────────────────
//
// A bank of analytical unit-vector fields the DBG "FF Pattern" cycle can
// swap in over a map's own flow.  All are pure functions of world position
// (no time/state), so the baked grid can sample them exactly like the map
// sampler.  DEFAULT is sentinel-only — GameEngine routes it to the active
// map's own sampleFlow() rather than this function.
//
// Gravity-well / spiral / outward patterns reference the map centre (0,0)
// and are NOT seam-continuous (opposite sides of the wrap point opposite
// ways); that's inherent to a radial field on a torus and acceptable for a
// debug pattern.  The directional + wavy-directional patterns use an
// integer number of waves per axis so they DO stay continuous across the
// seam.

export enum FlowPattern {
  DEFAULT           = 'DEFAULT',            // map's own sampleFlow()
  MEANDER           = 'MEANDER',            // golden-ratio meander (universe default)
  CIRCULAR          = 'CIRCULAR',           // CCW vortex about centre
  SPIRAL            = 'SPIRAL',             // inward + CCW swirl
  GRAVITY_WELL      = 'GRAVITY_WELL',       // radial inward to centre
  WAVY_GRAVITY_WELL = 'WAVY_GRAVITY_WELL',  // inward + radial-wave wobble
  OUTWARD           = 'OUTWARD',            // radial outward (source)
  HORIZONTAL        = 'HORIZONTAL',         // constant +x
  VERTICAL          = 'VERTICAL',           // constant +y
  WAVY_HORIZONTAL   = 'WAVY_HORIZONTAL',    // +x snaking with y
  WAVY_VERTICAL     = 'WAVY_VERTICAL',      // +y snaking with x
}

// Angle swing (radians) for the "wavy" variants, and the number of full
// wave cycles across each map axis.  Integer wave count keeps the wavy-
// directional fields continuous across the wrap seam.
const PATTERN_WAVE_AMP = 0.6;   // ≈ 34°
const PATTERN_WAVES    = 2;

/**
 * Sample one of the selectable DBG flow patterns at world position
 * (wx, wy).  Always returns a unit vector.  DEFAULT falls back to the
 * meander here, but callers should special-case it to the map sampler.
 */
export function samplePattern(pattern: FlowPattern, wx: number, wy: number): FlowVector {
  switch (pattern) {
    case FlowPattern.HORIZONTAL:
      return { x: 1, y: 0 };

    case FlowPattern.VERTICAL:
      return { x: 0, y: 1 };

    case FlowPattern.WAVY_HORIZONTAL: {
      const a = PATTERN_WAVE_AMP * Math.sin(TWO_PI_OVER_H * PATTERN_WAVES * wy);
      return { x: Math.cos(a), y: Math.sin(a) };
    }

    case FlowPattern.WAVY_VERTICAL: {
      const a = Math.PI / 2 + PATTERN_WAVE_AMP * Math.sin(TWO_PI_OVER_W * PATTERN_WAVES * wx);
      return { x: Math.cos(a), y: Math.sin(a) };
    }

    case FlowPattern.CIRCULAR: {
      const r2 = wx * wx + wy * wy;
      if (r2 < 1e-6) return { x: 1, y: 0 };
      const inv = 1 / Math.sqrt(r2);
      return { x: -wy * inv, y: wx * inv };   // CCW tangent
    }

    case FlowPattern.SPIRAL: {
      const r2 = wx * wx + wy * wy;
      if (r2 < 1e-6) return { x: 1, y: 0 };
      const inv = 1 / Math.sqrt(r2);
      // 70 % tangential (CCW) + 30 % inward → an in-drawing swirl.
      const sx = (-wy * inv) * 0.7 + (-wx * inv) * 0.3;
      const sy = ( wx * inv) * 0.7 + (-wy * inv) * 0.3;
      const m = Math.sqrt(sx * sx + sy * sy) || 1;
      return { x: sx / m, y: sy / m };
    }

    case FlowPattern.GRAVITY_WELL: {
      const r2 = wx * wx + wy * wy;
      if (r2 < 1e-6) return { x: 1, y: 0 };
      const inv = 1 / Math.sqrt(r2);
      return { x: -wx * inv, y: -wy * inv };  // inward
    }

    case FlowPattern.WAVY_GRAVITY_WELL: {
      const r2 = wx * wx + wy * wy;
      if (r2 < 1e-6) return { x: 1, y: 0 };
      const r = Math.sqrt(r2);
      // Inward angle, wobbled by a radial wave so the inflow snakes
      // through concentric "wavy" rings on its way to the centre.
      const baseA = Math.atan2(-wy, -wx);
      const a = baseA + PATTERN_WAVE_AMP * Math.sin(TWO_PI_OVER_W * PATTERN_WAVES * r);
      return { x: Math.cos(a), y: Math.sin(a) };
    }

    case FlowPattern.OUTWARD: {
      const r2 = wx * wx + wy * wy;
      if (r2 < 1e-6) return { x: 1, y: 0 };
      const inv = 1 / Math.sqrt(r2);
      return { x: wx * inv, y: wy * inv };    // outward
    }

    case FlowPattern.MEANDER:
    case FlowPattern.DEFAULT:
    default:
      return sampleFlow(wx, wy);
  }
}
