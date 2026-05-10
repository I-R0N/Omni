
import { MapType, GameEntity, EntityType, Vector2, EnemySubtype } from '../../types';
import { TileGenerator, HEX_SIZE, HEX_WIDTH, HEX_V_SPACING, pixelToHexCoord, hexCoordToPixel } from './TileGenerator';
import { COLORS, getRockShardFreeSpawn, ASSETS, ENEMY_CONSTANTS, ENEMY_VARIANTS, MAP_POPULATION, StructureVariant } from '../../constants';
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
        // Free-floating asteroids unify onto the shard-family carrier
        // as the rock-shard variant.
        type: EntityType.STRUCTURE,
        shardVariant: 'rock-shard',
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
  // Deep Space is the largest of the three main maps — 8 000 world units
  // per axis gives room for many landmark clusters before the player
  // meets the wrap seam.  Other maps override this with their own
  // constants.
  public static readonly WIDTH  = 8000;
  public static readonly HEIGHT = 8000;

  constructor() {
    super('universe_01', 'Deep Space', MapType.UNIVERSE);
    this.width  = UniverseMap.WIDTH;
    this.height = UniverseMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Asteroids spread around spawn
    const gen = getRockShardFreeSpawn(MapType.UNIVERSE);
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
    const GLASS_COUNT  = 42;   // Halved on 2026-04-19 (see commit note)
    const NEBULA_COUNT = 75;   // Halved on 2026-04-19 (see commit note)

    // Glass landmark clusters — uniform distribution across the 95 %
    // zone.  Most clusters are stock glass (single-hit) to preserve the
    // original destructible feel; a smaller share rolls as plastic or
    // metal tiles, plus a few rare indestructible landmarks that never
    // break or regenerate.  Cluster counts roughly split:
    //   glass       ~60 %
    //   plastic     ~22 %
    //   metal       ~12 %
    //   indestructible ~6 %
    const GLASS_CLUSTERS          = Math.round(GLASS_COUNT * 0.60);
    const PLASTIC_CLUSTERS        = Math.round(GLASS_COUNT * 0.22);
    const METAL_CLUSTERS          = Math.round(GLASS_COUNT * 0.12);
    const INDESTRUCTIBLE_CLUSTERS = GLASS_COUNT - GLASS_CLUSTERS - PLASTIC_CLUSTERS - METAL_CLUSTERS;
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, 22,
        GLASS_CLUSTERS, 10, 34, occupied, 'glass'
    ));
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, 22,
        PLASTIC_CLUSTERS, 8, 22, occupied, 'plastic'
    ));
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, 22,
        METAL_CLUSTERS, 6, 14, occupied, 'metal'
    ));
    // Indestructible landmarks are small (3-8 tiles) so they read as
    // permanent obstacles rather than large impassable walls.
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, 22,
        INDESTRUCTIBLE_CLUSTERS, 3, 8, occupied, 'indestructible'
    ));

    // Nebula cloud clusters — same 95 %-zone uniform distribution.
    // Records each cluster's world-space start position into
    // `nebulaClusterCenters`, which GameEngine pipes into
    // BackgroundManager so the background-nebula layer renders puffs
    // at the same positions — one unified cloud, with parallax drift
    // of the backdrop as the camera moves.
    // Cluster size span averages the inner + outer values from
    // MAP_POPULATION[UNIVERSE]['nebula-tile'].
    const nebPop = MAP_POPULATION[MapType.UNIVERSE]['nebula-tile']?.tileCluster;
    const nebMinSize = Math.round(((nebPop?.minClusterSize ?? 14) + (nebPop?.outer?.minClusterSize ?? 7)) / 2);
    const nebMaxSize = Math.round(((nebPop?.maxClusterSize ?? 42) + (nebPop?.outer?.maxClusterSize ?? 26)) / 2);
    this.entities.push(...TileGenerator.generateNebulaClusters(
        CLUSTER_W, CLUSTER_H,
        22,
        NEBULA_COUNT,
        nebMinSize,
        nebMaxSize,
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
  // visible from spawn (well inside the half-map) and leaves a large
  // safe zone at the centre.
  private static readonly RING_TILE_RADIUS = 700;
  public  static readonly WIDTH  = 6000;
  public  static readonly HEIGHT = 6000;

  constructor() {
    super('ring_01', 'Ring World', MapType.RING);
    this.width  = RingMap.WIDTH;
    this.height = RingMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  /**
   * Pure rotational flow — tangent to the circle of radius |r| at every
   * point, CCW.  Returns a unit vector; at the exact origin (undefined
   * tangent) we fall back to +x so the baked grid cell at the centre
   * still has a deterministic direction.
   */
  public sampleFlow(wx: number, wy: number): FlowVector {
    return concentricRingFlow(wx, wy);
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Asteroids follow the concentric flow from spawn (sampleFlow above
    // is called by the base-class helper through `this.sampleFlow`).
    const gen = getRockShardFreeSpawn(MapType.RING);
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    for (const e of this.entities) wrapPosition(e.position);

    // Glass tile ring at the featured radius.
    emitGlassTileRing(this.entities, RingMap.RING_TILE_RADIUS, HEX_SIZE);

    // Clear a safe open area around spawn (same rule as UniverseMap so
    // the player never spawns inside an asteroid).
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 350 * 350;
    });
  }
}

/**
 * Seven-rings map — seven concentric hex-tile rings stepping outward
 * from the spawn, under the same concentric rotational flow as RingMap.
 * Radii are evenly spaced between a safe inner gap (so the player
 * isn't boxed in) and ~73 % of the half-map (keeps the outermost ring
 * clear of the wrap seam).
 */
export class SevenRingsMap extends BaseMapLayer {
  private static readonly RING_COUNT = 7;
  private static readonly INNER_RADIUS = 400;
  private static readonly OUTER_RADIUS = 2200;
  public  static readonly WIDTH  = 6000;
  public  static readonly HEIGHT = 6000;

  constructor() {
    super('seven_rings_01', 'Seven Rings', MapType.SEVEN_RINGS);
    this.width  = SevenRingsMap.WIDTH;
    this.height = SevenRingsMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  public sampleFlow(wx: number, wy: number): FlowVector {
    return concentricRingFlow(wx, wy);
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const gen = getRockShardFreeSpawn(MapType.SEVEN_RINGS);
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    for (const e of this.entities) wrapPosition(e.position);

    // Evenly-spaced radii from inner to outer.  Division by (COUNT - 1)
    // places the first and last rings exactly at the declared bounds.
    // Each ring rolls a variant based on index so the player can visually
    // read difficulty: inner = glass, mid = plastic, outer plastic
    // is punctuated by metal rings, and the outermost is indestructible.
    const RING_VARIANTS: StructureVariant[] = [
        'glass',        // ring 0 — soft inner
        'glass',        // ring 1
        'plastic',      // ring 2
        'plastic',      // ring 3
        'metal',        // ring 4
        'metal',        // ring 5
        'indestructible', // ring 6 — outer wall
    ];
    const step = (SevenRingsMap.OUTER_RADIUS - SevenRingsMap.INNER_RADIUS) /
                 (SevenRingsMap.RING_COUNT - 1);
    for (let i = 0; i < SevenRingsMap.RING_COUNT; i++) {
      const r = SevenRingsMap.INNER_RADIUS + step * i;
      emitGlassTileRing(this.entities, r, HEX_SIZE, RING_VARIANTS[i] ?? 'glass');
    }

    // Keep a spawn bubble clear — use a radius slightly smaller than the
    // innermost ring so the player doesn't materialize inside a tile.
    const safeClear = Math.min(350, SevenRingsMap.INNER_RADIUS - HEX_SIZE * 1.5);
    const safeClearSq = safeClear * safeClear;
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > safeClearSq;
    });
  }
}

/**
 * Pocket sandbox — 1 000 × 1 000 wrap box that spawns every element type
 * (asteroids + all four STRUCTURE variants + nebula clusters) in a
 * single tiny playfield.  Intended for iterating on cross-system
 * interactions (collision, regen, pathing, nebula shatter) without
 * having to fly around a full-size map to find each element.
 */
export class PocketMap extends BaseMapLayer {
  public static readonly WIDTH  = 2000;
  public static readonly HEIGHT = 2000;

  // Cluster counts — the sandbox is a showcase so population leans
  // heavy on tiles / nebulae and light on asteroids.  Background nebula
  // puffs match `NEBULA_CLUSTERS` 1:1 via nebulaClusterCenters, so
  // bumping this also densifies the backdrop.
  private static readonly GLASS_CLUSTERS          = 8;
  private static readonly PLASTIC_CLUSTERS        = 5;
  private static readonly METAL_CLUSTERS          = 3;
  private static readonly INDESTRUCTIBLE_CLUSTERS = 2;
  private static readonly NEBULA_CLUSTERS         = 12;

  constructor() {
    super('pocket_01', 'Pocket', MapType.POCKET);
    this.width  = PocketMap.WIDTH;
    this.height = PocketMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Asteroids on the shared analytical meander — same sampler as
    // Deep Space, so motion reads consistently between maps.
    const gen = getRockShardFreeSpawn(MapType.POCKET);
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    for (const e of this.entities) wrapPosition(e.position);

    // 90 %-of-map cluster zone keeps every spawn well inside the seam.
    const CLUSTER_W = PocketMap.WIDTH  * 0.9;
    const CLUSTER_H = PocketMap.HEIGHT * 0.9;
    const occupied = new Set<string>();

    // Tile variants — every flavour, in mid-sized clusters so each
    // variant reads as a distinct landmark rather than a stray hex.
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        PocketMap.GLASS_CLUSTERS, 6, 14, occupied, 'glass'
    ));
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        PocketMap.PLASTIC_CLUSTERS, 5, 10, occupied, 'plastic'
    ));
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        PocketMap.METAL_CLUSTERS, 4, 8, occupied, 'metal'
    ));
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        PocketMap.INDESTRUCTIBLE_CLUSTERS, 3, 5, occupied, 'indestructible'
    ));

    // Nebula clusters — same shared occupancy so tiles and nebulae
    // never overlap.
    this.entities.push(...TileGenerator.generateNebulaClusters(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        PocketMap.NEBULA_CLUSTERS, 6, 12,
        occupied,
        this.nebulaClusterCenters,
    ));

    // Keep a small safe bubble around spawn so the player doesn't
    // materialise inside a tile.
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 120 * 120;
    });
  }
}

/**
 * Concentric rotational flow — tangent to the circle of radius |r| at
 * every point, CCW.  Shared by RingMap, SevenRingsMap, and
 * AsteroidFieldMap so every "ring weather" map reads as the same
 * vortex with different contents on top.
 */
function concentricRingFlow(wx: number, wy: number): FlowVector {
  const r2 = wx * wx + wy * wy;
  if (r2 < 1e-6) return { x: 1, y: 0 };
  const inv = 1 / Math.sqrt(r2);
  return { x: -wy * inv, y: wx * inv };
}

/**
 * Single-element showcase maps — 6 000 × 6 000 playfields that each
 * spawn exactly one entity type.  Used to stress one system at a time
 * (flow field, tile regen, nebula shatter) without cross-element
 * interference.
 *
 * Each map keeps the same 350-unit spawn bubble clear so the player
 * never materialises inside a tile/asteroid regardless of which element
 * is selected.
 */
const SINGLE_ELEMENT_MAP_SIZE   = 6000;
const SINGLE_ELEMENT_SPAWN_CLEAR = 350;
// Cluster zone shrinks by the same 5 % safe-fraction used on the
// UniverseMap so clusters never crowd the wrap seam.
const SINGLE_ELEMENT_CLUSTER_FRAC = 0.95;

/**
 * Asteroid-only field — asteroids spread across the 6k map, riding a
 * concentric rotational flow so the belt reads as one giant vortex.
 * No tiles, no nebulae.
 */
export class AsteroidFieldMap extends BaseMapLayer {
  public static readonly WIDTH  = SINGLE_ELEMENT_MAP_SIZE;
  public static readonly HEIGHT = SINGLE_ELEMENT_MAP_SIZE;

  constructor() {
    super('asteroid_field_01', 'Asteroid Field', MapType.ASTEROID_FIELD);
    this.width  = AsteroidFieldMap.WIDTH;
    this.height = AsteroidFieldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  public sampleFlow(wx: number, wy: number): FlowVector {
    return concentricRingFlow(wx, wy);
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const gen = getRockShardFreeSpawn(MapType.ASTEROID_FIELD);
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    for (const e of this.entities) wrapPosition(e.position);

    const clearSq = SINGLE_ELEMENT_SPAWN_CLEAR * SINGLE_ELEMENT_SPAWN_CLEAR;
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > clearSq;
    });
  }
}

/**
 * Base for the single-variant tile-field maps.  Subclasses supply the
 * STRUCTURE variant and cluster-size range; the shared init emits
 * clusters over ~95 % of the 6k map with a clear spawn bubble.  No
 * asteroids, no nebulae.
 */
abstract class SingleVariantTileFieldMap extends BaseMapLayer {
  public static readonly WIDTH  = SINGLE_ELEMENT_MAP_SIZE;
  public static readonly HEIGHT = SINGLE_ELEMENT_MAP_SIZE;

  protected abstract readonly variant: StructureVariant;
  protected abstract readonly clusterCount: number;
  protected abstract readonly minClusterSize: number;
  protected abstract readonly maxClusterSize: number;

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const CLUSTER_W = MAP_WIDTH  * SINGLE_ELEMENT_CLUSTER_FRAC;
    const CLUSTER_H = MAP_HEIGHT * SINGLE_ELEMENT_CLUSTER_FRAC;
    const occupied = new Set<string>();

    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        this.clusterCount, this.minClusterSize, this.maxClusterSize,
        occupied, this.variant
    ));

    const clearSq = SINGLE_ELEMENT_SPAWN_CLEAR * SINGLE_ELEMENT_SPAWN_CLEAR;
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > clearSq;
    });
  }
}

// Shared cluster sizing for the variant-tile field maps.  100 clusters
// × 12 tiles = 1 200 entities, matching the asteroid-field count so
// the debug render-time HUD compares like-for-like across maps.  The
// (min, max) pair must satisfy max = min + 1 because
// `generateClusteredMesh` computes target size as
// `floor(min + random() * (max - min))` — random() ∈ [0, 1) collapses
// to a constant when the span is exactly 1.
const SINGLE_ELEMENT_CLUSTER_COUNT = 100;
const SINGLE_ELEMENT_CLUSTER_SIZE  = 12;

/** Glass-only field — single-hit destructible tiles spread across the map. */
export class GlassFieldMap extends SingleVariantTileFieldMap {
  protected readonly variant: StructureVariant = 'glass';
  protected readonly clusterCount   = SINGLE_ELEMENT_CLUSTER_COUNT;
  protected readonly minClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE;
  protected readonly maxClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE + 1;

  constructor() {
    super('glass_field_01', 'Glass Field', MapType.GLASS_FIELD);
    this.width  = SingleVariantTileFieldMap.WIDTH;
    this.height = SingleVariantTileFieldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }
}

/**
 * Plastic-only field — 3-HP plastic tiles spread across the map.  The
 * mid-tier destructible: harder than glass, softer than metal; useful
 * for tuning damage feel and crack visuals against the matte polymer
 * aesthetic in isolation.
 */
export class PlasticFieldMap extends SingleVariantTileFieldMap {
  protected readonly variant: StructureVariant = 'plastic';
  protected readonly clusterCount   = SINGLE_ELEMENT_CLUSTER_COUNT;
  protected readonly minClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE;
  protected readonly maxClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE + 1;

  constructor() {
    super('plastic_field_01', 'Plastic Field', MapType.PLASTIC_FIELD);
    this.width  = SingleVariantTileFieldMap.WIDTH;
    this.height = SingleVariantTileFieldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }
}

/**
 * Metal-only field — 5-HP metal tiles spread across the map.  The
 * hardest destructible variant; every cluster requires sustained fire
 * (or a high-momentum asteroid crash) to break.
 */
export class MetalFieldMap extends SingleVariantTileFieldMap {
  protected readonly variant: StructureVariant = 'metal';
  protected readonly clusterCount   = SINGLE_ELEMENT_CLUSTER_COUNT;
  protected readonly minClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE;
  protected readonly maxClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE + 1;

  constructor() {
    super('metal_field_01', 'Metal Field', MapType.METAL_FIELD);
    this.width  = SingleVariantTileFieldMap.WIDTH;
    this.height = SingleVariantTileFieldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }
}

/**
 * Indestructible field — permanent wall clusters spread across the
 * map.  Never take damage, never regenerate; a maze of fixed obstacles.
 * Cluster sizing matches the other tile fields so the entity count
 * (and therefore the debug render-time stat) is comparable across
 * single-element maps.
 */
export class IndestructibleFieldMap extends SingleVariantTileFieldMap {
  protected readonly variant: StructureVariant = 'indestructible';
  protected readonly clusterCount   = SINGLE_ELEMENT_CLUSTER_COUNT;
  protected readonly minClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE;
  protected readonly maxClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE + 1;

  constructor() {
    super('indestructible_field_01', 'Indestructible Field', MapType.INDESTRUCTIBLE_FIELD);
    this.width  = SingleVariantTileFieldMap.WIDTH;
    this.height = SingleVariantTileFieldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }
}

/**
 * Rock-tile field (Stage 7 of shard-system overhaul) — clusters of
 * 3-HP rock tiles that, when broken, shatter into mobile rock-shards
 * (the same drift / merge / accrete lifecycle as today's free-floating
 * asteroids).  Exercises the unified tile→shard lineage in isolation;
 * cluster count + size match the other tile-only showcases so DBG
 * render-time numbers compare apples-to-apples.
 */
export class RockFieldMap extends SingleVariantTileFieldMap {
  protected readonly variant: StructureVariant = 'rock';
  protected readonly clusterCount   = SINGLE_ELEMENT_CLUSTER_COUNT;
  protected readonly minClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE;
  protected readonly maxClusterSize = SINGLE_ELEMENT_CLUSTER_SIZE + 1;

  constructor() {
    super('rock_field_01', 'Rock Field', MapType.ROCK_FIELD);
    this.width  = SingleVariantTileFieldMap.WIDTH;
    this.height = SingleVariantTileFieldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }
}

/**
 * Nebula-only field — pass-through nebula clusters spread across the
 * 6k map.  Each cluster center is recorded into `nebulaClusterCenters`
 * so the background layer renders puffs at the same positions as the
 * interactable tiles.
 */
export class NebulaFieldMap extends BaseMapLayer {
  public static readonly WIDTH  = SINGLE_ELEMENT_MAP_SIZE;
  public static readonly HEIGHT = SINGLE_ELEMENT_MAP_SIZE;

  // Match the variant-tile field cluster shape so the nebula map ends
  // with ≈1 200 entities, on par with the other single-element maps.
  // Overrides the legacy NEBULA_CONSTANTS-derived sizing used elsewhere
  // (UniverseMap), which would emit ~2× more tiles here.
  private static readonly CLUSTER_COUNT = SINGLE_ELEMENT_CLUSTER_COUNT;

  constructor() {
    super('nebula_field_01', 'Nebula Field', MapType.NEBULA_FIELD);
    this.width  = NebulaFieldMap.WIDTH;
    this.height = NebulaFieldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const CLUSTER_W = MAP_WIDTH  * SINGLE_ELEMENT_CLUSTER_FRAC;
    const CLUSTER_H = MAP_HEIGHT * SINGLE_ELEMENT_CLUSTER_FRAC;
    const occupied = new Set<string>();

    this.entities.push(...TileGenerator.generateNebulaClusters(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        NebulaFieldMap.CLUSTER_COUNT,
        SINGLE_ELEMENT_CLUSTER_SIZE,
        SINGLE_ELEMENT_CLUSTER_SIZE + 1,
        occupied,
        this.nebulaClusterCenters
    ));

    const clearSq = SINGLE_ELEMENT_SPAWN_CLEAR * SINGLE_ELEMENT_SPAWN_CLEAR;
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > clearSq;
    });
  }
}

/**
 * Append a single-tile-thick ring of STRUCTURE tiles to `entities`.
 * Iterates every odd-r grid cell within a bounding box of the target
 * radius and emits one where the cell centre is within `band` world
 * units of that radius.  Using the shared grid guarantees edges meet
 * exactly between adjacent ring tiles.  The optional `variant` argument
 * controls which STRUCTURE_VARIANT the ring tiles spawn as (defaults to
 * glass to preserve legacy ring behaviour).
 */
function emitGlassTileRing(
    entities: GameEntity[],
    radius: number,
    band: number,
    variant: StructureVariant = 'glass'
): void {
  const maxCol = Math.ceil((radius + HEX_SIZE) / HEX_WIDTH) + 1;
  const maxRow = Math.ceil((radius + HEX_SIZE) / HEX_V_SPACING) + 1;
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
  for (let r = -maxRow; r <= maxRow; r++) {
    for (let c = -maxCol; c <= maxCol; c++) {
      const { x, y } = hexCoordToPixel(c, r);
      const d = Math.sqrt(x * x + y * y);
      if (Math.abs(d - radius) > band) continue;
      entities.push(TileGenerator.buildStructureTile(c, r, x, y, w, h, pts, variant));
    }
  }
}
