/**
 * FlowField — analytical vortex flow field for asteroid streaming.
 *
 * Mimics the level-set streaming you get from a Fast Marching Method distance
 * field, but evaluated analytically so it works on an infinite map at O(1)
 * per sample with zero memory overhead.
 *
 * Each vortex contributes a tangential (orbital) velocity at every point.
 * Alternating spin directions create saddle-shaped channels between vortices
 * that asteroids naturally flow through — visually similar to FMM streamlines.
 */

interface Vortex {
  x: number;
  y: number;
  spin: 1 | -1;    // +1 = CCW, -1 = CW
  radius: number;  // Influence radius (soft falloff)
  strength: number;
}

// Four vortex centres placed at ±2 000 units in a 2×2 grid.
// Alternating spin produces "river" channels along the diagonals and axes.
const VORTICES: Vortex[] = [
  { x:  2200, y:  2200, spin:  1, radius: 3500, strength: 1.0 },
  { x: -2200, y:  2200, spin: -1, radius: 3500, strength: 1.0 },
  { x:  2200, y: -2200, spin: -1, radius: 3500, strength: 1.0 },
  { x: -2200, y: -2200, spin:  1, radius: 3500, strength: 1.0 },
];

export interface FlowVector {
  x: number;
  y: number;
}

/**
 * Sample the flow field at world position (wx, wy).
 * Returns a unit vector (approximately) in the dominant flow direction.
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
  if (mag < 0.001) return { x: 1, y: 0 };
  return { x: fx / mag, y: fy / mag };
}
