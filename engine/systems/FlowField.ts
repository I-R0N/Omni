/**
 * FlowField — analytical vortex flow field for asteroid streaming.
 *
 * A central galactic vortex dominates the inner map with smooth CCW rotation.
 * Four spiral-arm vortices (offset ~17° from the cardinal axes, same spin)
 * add secondary layered streams that interweave between tile clusters without
 * creating convergence/saddle points.  Because all vortices share the same
 * spin direction there are no cancellation points within the active map area.
 */

interface Vortex {
  x: number;
  y: number;
  spin: 1 | -1;    // +1 = CCW, -1 = CW
  radius: number;  // Influence radius (soft falloff)
  strength: number;
}

// Central galactic vortex + four spiral-arm vortices, all CCW.
// Arms are placed at ~17° off the cardinal axes so their local flow
// patterns don't align with the grid and produce a richer, non-symmetric field.
const VORTICES: Vortex[] = [
  // Dominant central rotation — smooth large-scale CCW sweep
  { x:     0, y:     0, spin:  1, radius: 8000, strength: 1.0 },
  // Spiral arms — secondary interweaving streams
  { x:  3200, y:  1000, spin:  1, radius: 2800, strength: 0.45 },
  { x: -1000, y:  3200, spin:  1, radius: 2800, strength: 0.45 },
  { x: -3200, y: -1000, spin:  1, radius: 2800, strength: 0.45 },
  { x:  1000, y: -3200, spin:  1, radius: 2800, strength: 0.45 },
];

export interface FlowVector {
  x: number;
  y: number;
}

/**
 * Sample the flow field at world position (wx, wy).
 * Returns a unit vector in the dominant flow direction.
 */
export function sampleFlow(wx: number, wy: number): FlowVector {
  let fx = 0;
  let fy = 0;

  for (let i = 0; i < VORTICES.length; i++) {
    const v = VORTICES[i];
    const dx = wx - v.x;
    const dy = wy - v.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < 1) continue;

    // Smooth falloff: influence drops to ~0 beyond v.radius
    const influence = v.strength / (1 + r / v.radius);

    // Tangential direction (perpendicular to radial, signed by spin)
    fx += v.spin * (-dy / r) * influence;
    fy += v.spin * ( dx / r) * influence;
  }

  const mag = Math.sqrt(fx * fx + fy * fy);
  if (mag < 0.001) return { x: 0, y: 1 };
  return { x: fx / mag, y: fy / mag };
}
