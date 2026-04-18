
import { MapType, GameEntity, EntityType, Vector2, EnemySubtype } from '../../types';
import { TileGenerator } from './TileGenerator';
import { COLORS, ASTEROID_GENERATION_CONFIG, ASSETS, ENEMY_CONSTANTS, ENEMY_VARIANTS, NEBULA_CONSTANTS } from '../../constants';
import { sampleFlow } from '../systems/FlowField';
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

  protected spawnAsteroids(
      count: number,
      minSize: number,
      maxSize: number,
      radius: number,
      speedMultiplier: number = 1.0,
      allowedSprites: string[] = []
  ) {
    for (let i = 0; i < count; i++) {
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
    const flow = sampleFlow(x, y);
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
    // Cluster counts scale linearly with the map axis (not area), so
    // the average cluster-to-cluster spacing stays at a fixed
    // percentage of map size as the map grows or shrinks.  Spacing on
    // a random uniform distribution is ∝ N / √count, so count ∝ N
    // gives spacing ∝ N (constant as a fraction of N).
    const SAFE_ZONE_FRAC  = 0.05;
    const OUTER_ZONE_FRAC = 1 - SAFE_ZONE_FRAC;
    const CLUSTER_W = MAP_WIDTH  * OUTER_ZONE_FRAC;
    const CLUSTER_H = MAP_HEIGHT * OUTER_ZONE_FRAC;
    const GLASS_CLUSTERS_PER_AXIS  = 0.014; // ≈ 84 clusters on a 6000 map
    const NEBULA_CLUSTERS_PER_AXIS = 0.025; // ≈ 150 clusters on a 6000 map
    const GLASS_COUNT  = Math.round(MAP_WIDTH * GLASS_CLUSTERS_PER_AXIS);
    const NEBULA_COUNT = Math.round(MAP_WIDTH * NEBULA_CLUSTERS_PER_AXIS);

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
