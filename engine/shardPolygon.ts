// Shared helper for generating the jittered radial shard polygons used
// by asteroid / tile / nebula / enemy-shard spawners.  The algorithm is
// identical across call sites — only `numPoints`, `baseR`, `rMin`,
// `rRange` and `angleJitterK` differ per shard style — so keeping one
// implementation here avoids 8 near-identical copies drifting apart.
//
// Geometry: numPoints vertices are placed at (i/numPoints)·2π with a
// small angular jitter of ±(π/numPoints)·(angleJitterK/2), each at a
// radius of baseR·(rMin + rand·rRange).  Points are then sorted by
// angle so they form a non-self-intersecting convex-ish polygon.

import { Vector2 } from '../types';

export function buildShardPolygon(
    numPoints: number,
    baseR: number,
    rMin: number,
    rRange: number,
    angleJitterK: number,
): Vector2[] {
    const rawPts: { angle: number; r: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
        const baseAngle = (i / numPoints) * Math.PI * 2;
        const jitter    = (Math.random() - 0.5) * (Math.PI / numPoints) * angleJitterK;
        rawPts.push({ angle: baseAngle + jitter, r: baseR * (rMin + Math.random() * rRange) });
    }
    rawPts.sort((a, b) => a.angle - b.angle);
    return rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));
}
