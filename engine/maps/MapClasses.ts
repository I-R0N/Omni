
import { MapType, GameEntity, EntityType, Vector2, EnemySubtype } from '../../types';
import { TileGenerator, HEX_SIZE, HEX_WIDTH, HEX_V_SPACING, pixelToHexCoord, hexCoordToPixel } from './TileGenerator';
import { COLORS, ASTEROID_GENERATION_CONFIG, ASSETS, ENEMY_CONSTANTS, ENEMY_VARIANTS, NEBULA_CONSTANTS, STRUCTURE_CONSTANTS } from '../../constants';
import { sampleFlow, FlowVector } from '../systems/FlowField';
import { nextId } from '../systems/IdAllocator';
import { MAP_WIDTH, MAP_HEIGHT, wrapPosition } from '../toroidal';

export abstract class BaseMapLayer {
  public id: string;
  public type: MapType;
  public name: string;
  public entities: GameEntity[];
  public width: number;
  public height: number;
  public playerSpawn: Vector2;
  public parentId: string | null = null;
  public initialized: boolean = false;
  public enemyScale: number = 1;
  // World-space start positions of every generated nebula tile cluster.
  // Populated by `TileGenerator.generateNebulaClusters` when given this
  // array as a recording slot.  GameEngine forwards the list to the
  // background-nebula layer so BG puffs render at the same positions
  // as the interactable tile clusters — one unified cloud rather than
  // two independently-random layers.
  public nebulaClusterCenters: Vector2[] = [];

  constructor(id: string, name: string, type: MapType) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.entities = [];
    this.width = 100;
    this.height = 100;
    this.playerSpawn = { x: 0, y: 0 };
  }

  abstract init(): void;

  /**
   * Per-map flow sampler.  Default is the global analytical meander used
   * by the universe map; subclasses can override to give the map its
   * own streamline geometry (e.g. concentric rings).  Must return a
   * unit vector.  Also consumed by `FlowFieldGrid.buildAsteroidField`
   * via `GameEngine.loadMap`, so the baked grid matches the map-specific
   * flow visible in asteroid motion from frame 1.
   */
  public sampleFlow(wx: number, wy: number): FlowVector {
    return sampleFlow(wx, wy);
  }

  protected spawnAsteroids(
      count: number,
      minSize: number,
      maxSize: number,
      radius: number,
      speedMultiplier: number = 1.0,
      allowedSprites: string[] = []
  ) {
    // Spawn the majority of asteroids along a representative streamline
    // of the flow field so the belt reads as "following the current"
    // from the first frame rather than drifting into the stream over a
    // few seconds.  The flow field is ergodic on the torus (irrational
    // base slope), so integrating a single streamline from the origin
    // winds across the map and naturally covers most of the playable
    // area without creating a straight line of rocks.  Perpendicular
    // jitter widens the streamline into a band.
    //
    // Path step is sized so that pathCount × PATH_STEP ≈ MAP_WIDTH /
    // cos(BASE_ANGLE) — at the flow's ~32° base slope that's roughly
    // 1.2 × MAP_WIDTH of total arc length, which is just over one
    // full wrap along the dominant direction so the streamline lays
    // asteroids across the whole map in the flow axis.
    //
    // A smaller scatter pass fills in a uniform background of asteroids
    // outside the main current so the field doesn't look like one
    // compressed ribbon.
    const PATH_FRACTION    = 0.5;   // 50 % of asteroids on the main path
    const PATH_STEP        = 160;   // world units advanced per path sample
    const PATH_PERP_JITTER = 120;   // ± perpendicular spread around streamline
    const pathCount    = Math.round(count * PATH_FRACTION);
    const scatterCount = count - pathCount;

    let px = 0, py = 0; // streamline integrator state
    for (let i = 0; i < pathCount; i++) {
        const flow = this.sampleFlow(px, py);
        // Advance along the flow by one step length, then wrap.
        px += flow.x * PATH_STEP;
        py += flow.y * PATH_STEP;
        const stepPos = { x: px, y: py };
        wrapPosition(stepPos);
        px = stepPos.x;
        py = stepPos.y;

        // Lay the asteroid perpendicular to the flow by a random offset
        // so the streamline reads as a broad current rather than a line
        // of rocks in single file.
        const perpX = -flow.y;
        const perpY =  flow.x;
        const j = (Math.random() - 0.5) * 2 * PATH_PERP_JITTER;
        const pos = { x: px + perpX * j, y: py + perpY * j };
        wrapPosition(pos);

        const size = minSize + Math.random() * (maxSize - minSize);
        this.entities.push(this.createAsteroid(pos.x, pos.y, size, speedMultiplier, allowedSprites));
    }

    // Scatter the remainder across the original radial distribution so
    // the non-current regions of the map still have some asteroids to
    // bump into.
    for (let i = 0; i < scatterCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 500 + Math.random() * (radius - 500);
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist;
        const size = minSize + Math.random() * (maxSize - minSize);
        this.entities.push(this.createAsteroid(x, y, size, speedMultiplier, allowedSprites));
    }
  }

  public createAsteroid(
      x: number,
      y: number,
      size: number,
      speedMultiplier: number = 1.0,
      allowedSprites: string[] = []
    ): GameEntity {
    // Irregular convex-ish polygon: 9-12 points with varied radius and
    // slight angular jitter.  Variation is capped at ±25 % of base radius
    // so the shape stays approximately convex (safe for SAT collision).
    // Points are generated in angular order and sorted to guarantee correct
    // polygon winding regardless of jitter direction.
    const numPoints = 9 + Math.floor(Math.random() * 4); // 9–12
    const baseR    = (size / 2) * 0.82;
    const rawPts: { angle: number; r: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
        const baseAngle   = (i / numPoints) * Math.PI * 2;
        const angleJitter = (Math.random() - 0.5) * (Math.PI / numPoints) * 0.65;
        rawPts.push({
            angle: baseAngle + angleJitter,
            r:     baseR * (0.75 + Math.random() * 0.5), // 75 %–125 % of base
        });
    }
    rawPts.sort((a, b) => a.angle - b.angle);
    const points: Vector2[] = rawPts.map(p => ({
        x: Math.cos(p.angle) * p.r,
        y: Math.sin(p.angle) * p.r,
    }));

    let asteroidAssets = [ASSETS.ASTEROID_1, ASSETS.ASTEROID_2, ASSETS.ASTEROID_3, ASSETS.ASTEROID_ICE, ASSETS.ASTEROID_VOLCANIC];

    if (allowedSprites.length > 0) {
        asteroidAssets = allowedSprites;
    }

    const randomSprite = asteroidAssets[Math.floor(Math.random() * asteroidAssets.length)];
    const hp = size > 30 ? 2 : 1;

    // Blend flow direction (70%) with random drift (30%) for the initial velocity.
    // This seeds the asteroid into the vortex streamlines from spawn.
    const flow = this.sampleFlow(x, y);
    const randX = (Math.random() - 0.5) * 2;
    const randY = (Math.random() - 0.5) * 2;
    const FLOW_BIAS = 0.7;
    const vx = (flow.x * FLOW_BIAS + randX * (1 - FLOW_BIAS)) * speedMultiplier;
    const vy = (flow.y * FLOW_BIAS + randY * (1 - FLOW_BIAS)) * speedMultiplier;

    // Smaller rocks spin faster; scale is roughly 1.5 rad/s at size 20 down
    // to ~0.19 rad/s at size 160.  Random sign gives both CW and CCW tumble.
    const maxSpin = 1.5 / (size / 20);
    const rotationSpeed = (Math.random() - 0.5) * 2 * maxSpin;

    return {
        id: nextId('ast'),
        type: EntityType.ASTEROID,
        position: { x, y },
        velocity: { x: vx, y: vy },
        size: { x: size, y: size },
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed,
        color: COLORS.ASTEROID,
        active: true,
        health: hp,
        maxHealth: hp,
        polygonPoints: points,
        mass: size,
        sprite: randomSprite
    };
  }
}

/**
 * The single playable map — a large open universe used as an infinite arena.
 * Tile clusters act as visual landmarks. The player never leaves this map.
 */
export class UniverseMap extends BaseMapLayer {
  constructor() {
    super('universe_01', 'Deep Space', MapType.UNIVERSE);
    this.width = MAP_WIDTH;
    this.height = MAP_HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Asteroids spread around spawn
    const gen = ASTEROID_GENERATION_CONFIG[MapType.UNIVERSE];
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    // Asteroids are spawned on a linear radial distribution and may fall
    // just outside the canonical wrap range; normalise so every entity
    // sits in [-HALF, HALF) before any distance math runs.
    for (const e of this.entities) wrapPosition(e.position);

    // Shared occupancy set — every tile pass (glass inner, glass outer,
    // nebula inner, nebula outer) writes to this set so later passes
    // cannot place a tile on top of an earlier one.  Guarantees nebula
    // and glass tiles never overlap on the shared hex grid.
    const occupied = new Set<string>();

    // Cluster layout — seed zone is computed as a fraction of the
    // active map size (MAP_WIDTH / MAP_HEIGHT) so the visible dead
    // space around the wrap seam scales with the map.
    //
    //   SAFE_ZONE_FRAC  5 %   — width of the tile-free ring around
    //                           each wrap seam.  Cluster passes seed
    //                           at (1 − SAFE_ZONE_FRAC) of the map
    //                           extent; clusters can still grow
    //                           slightly past that via BFS neighbour
    //                           walk, but the visible dead ring stays
    //                           ≈5 % of the map.
    //
    // Inner/outer zone split was removed: on smaller maps it visibly
    // concentrated clusters in the centre.  All cluster passes now
    // target the full 95 %-of-map footprint, so cluster density is
    // roughly uniform across the playable area with a consistent
    // dead ring at every edge regardless of map size.
    //
    // Cluster counts are fixed regardless of map size so the expected
    // cluster-to-cluster spacing stays at a constant percentage of
    // map size.  For a random uniform distribution on an N×N zone
    // with C clusters, expected spacing ≈ N/√C, so spacing/N = 1/√C —
    // independent of N.  With C_glass + C_nebula = 234, expected
    // spacing ≈ 6.5 % of map size on every map, meaning a smaller
    // map has clusters that are physically closer together but
    // visually spaced identically relative to the viewport.
    const SAFE_ZONE_FRAC  = 0.05;
    const OUTER_ZONE_FRAC = 1 - SAFE_ZONE_FRAC;
    const CLUSTER_W = MAP_WIDTH  * OUTER_ZONE_FRAC;
    const CLUSTER_H = MAP_HEIGHT * OUTER_ZONE_FRAC;
    const GLASS_COUNT  = 84;   // → ~10.9 % spacing from glass alone
    const NEBULA_COUNT = 150;  // → ~6.5 % spacing combined (glass + nebula)

    // Glass landmark clusters — uniform distribution across the 95 %
    // zone.
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H,
        22,          // hexSize
        GLASS_COUNT, // scales with map axis
        10,          // minClusterSize
        34,          // maxClusterSize
        occupied
    ));

    // Nebula cloud clusters — same 95 %-zone uniform distribution.
    // Records each cluster's world-space start position into
    // `nebulaClusterCenters`, which GameEngine pipes into
    // BackgroundManager so the background-nebula layer renders puffs
    // at the same positions — one unified cloud, with parallax drift
    // of the backdrop as the camera moves.
    this.entities.push(...TileGenerator.generateNebulaClusters(
        CLUSTER_W, CLUSTER_H,
        22,
        NEBULA_COUNT,
        Math.round((NEBULA_CONSTANTS.MIN_CLUSTER_SIZE + NEBULA_CONSTANTS.OUTER_MIN_CLUSTER_SIZE) / 2),
        Math.round((NEBULA_CONSTANTS.MAX_CLUSTER_SIZE + NEBULA_CONSTANTS.OUTER_MAX_CLUSTER_SIZE) / 2),
        occupied,
        this.nebulaClusterCenters
    ));

    // Clear a safe open area around spawn
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 350 * 350;
    });
  }
}

/**
 * Ring map — a single ring of glass tiles around the spawn, wrapped by a
 * concentric rotational flow field.  Every streamline is a circle about
 * the origin, so the "featured" ring streamline naturally lives outside
 * the tile ring (any radius R > RING_TILE_RADIUS is one).
 */
export class RingMap extends BaseMapLayer {
  // Radius of the tile ring in world units.  Sized so it's clearly
  // visible from spawn (well inside the 3000-unit half-map) and
  // leaves a large safe zone at the centre.
  private static readonly RING_TILE_RADIUS = 700;

  constructor() {
    super('ring_01', 'Ring World', MapType.RING);
    this.width = MAP_WIDTH;
    this.height = MAP_HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  /**
   * Pure rotational flow — tangent to the circle of radius |r| at every
   * point, CCW.  Returns a unit vector; at the exact origin (undefined
   * tangent) we fall back to +x so the baked grid cell at the centre
   * still has a deterministic direction.
   */
  public sampleFlow(wx: number, wy: number): FlowVector {
    const r2 = wx * wx + wy * wy;
    if (r2 < 1e-6) return { x: 1, y: 0 };
    const inv = 1 / Math.sqrt(r2);
    return { x: -wy * inv, y: wx * inv };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Asteroids follow the concentric flow from spawn (sampleFlow above
    // is called by the base-class helper through `this.sampleFlow`).
    const gen = ASTEROID_GENERATION_CONFIG[MapType.RING];
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    for (const e of this.entities) wrapPosition(e.position);

    // Glass tile ring — enumerate every hex cell whose centre lies within
    // one hex of the target radius and emit a STRUCTURE there.  Using the
    // shared odd-r grid guarantees edges meet exactly between adjacent
    // tiles on the ring the same way cluster tiles do elsewhere.
    const R = RingMap.RING_TILE_RADIUS;
    const BAND = HEX_SIZE;              // single-tile-thick ring
    const maxCol = Math.ceil((R + HEX_SIZE) / HEX_WIDTH) + 1;
    const maxRow = Math.ceil((R + HEX_SIZE) / HEX_V_SPACING) + 1;
    for (let r = -maxRow; r <= maxRow; r++) {
      for (let c = -maxCol; c <= maxCol; c++) {
        const { x, y } = hexCoordToPixel(c, r);
        const d = Math.sqrt(x * x + y * y);
        if (Math.abs(d - R) > BAND) continue;
        this.entities.push(this.createRingGlassTile(c, r, x, y));
      }
    }

    // Clear a safe open area around spawn (same rule as UniverseMap so
    // the player never spawns inside an asteroid).
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 350 * 350;
    });
  }

  /**
   * Build a glass hex tile identical in shape/stats to the ones emitted
   * by TileGenerator.createHexEntity — inlined here so the ring pass
   * doesn't need to share TileGenerator's private occupancy plumbing.
   */
  private createRingGlassTile(c: number, r: number, cx: number, cy: number): GameEntity {
    const w = HEX_WIDTH;
    const h = 2 * HEX_SIZE;
    const pts: Vector2[] = [
      { x: 0, y: -h/2 },
      { x: w/2, y: -h/4 },
      { x: w/2, y: h/4 },
      { x: 0, y: h/2 },
      { x: -w/2, y: h/4 },
      { x: -w/2, y: -h/4 },
    ];
    return {
      id: nextId(`tile_${r}_${c}`),
      type: EntityType.STRUCTURE,
      position: { x: cx, y: cy },
      velocity: { x: 0, y: 0 },
      size: { x: w * 0.95, y: h * 0.95 },
      rotation: 0,
      color: Math.random() > 0.8 ? COLORS.STRUCTURE_BORDER : COLORS.STRUCTURE,
      active: true,
      health: STRUCTURE_CONSTANTS.HEALTH,
      maxHealth: STRUCTURE_CONSTANTS.HEALTH,
      mass: STRUCTURE_CONSTANTS.MASS,
      polygonPoints: pts,
      sprite: ASSETS.HEX_STRUCTURE,
    };
  }
}
