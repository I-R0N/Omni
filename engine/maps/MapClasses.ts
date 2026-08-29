
import { MapType, GameEntity, EntityType, Vector2, EnemySubtype } from '../../types';
import { TileGenerator, HEX_SIZE, HEX_WIDTH, HEX_V_SPACING, pixelToHexCoord, hexCoordToPixel } from './TileGenerator';
import { COLORS, randomRockShade, getRockShardFreeSpawn, ASSETS, ENEMY_CONSTANTS, ENEMY_VARIANTS, MAP_POPULATION, StructureVariant, SHARD_VARIANTS, rockHitCeiling, STATION_CONSTANTS, STATION_VARIANTS, OVERWORLD_STATIONS, PORTAL_CONSTANTS, HUB_PORTAL_SITES, HUB_TEST_PORTAL_SITES, RETURN_PORTAL_OFFSET } from '../../constants';
import { mapDescriptor, HUB_DESCRIPTOR } from './MapDescriptors';
import { sampleFlow, FlowVector } from '../systems/FlowField';
import { ShardVariantId } from '../systems/ShardSystem.types';
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
   * Generate this map's destructible tile clusters from MAP_POPULATION
   * (gauntlet step 5 G7).
   *
   * Before G7 three of the natural maps hardcoded their own variant mix —
   * Deep Space as a 42-cluster budget split 64/23/13, Pocket as three
   * private static counts — while MAP_POPULATION carried a DIFFERENT set of
   * numbers that nothing read. CLAUDE.md §5 warned about exactly that
   * ("treat MAP_POPULATION as authoritative for documentation but verify
   * the relevant MapClasses subclass too"). Now there is one place.
   *
   * `indestructible-tile` is deliberately not handled here: decision #6
   * reserves it for deliberate border placement, so a map that wants it
   * says so as a RING (see `populateTileRings`), never as a random cluster.
   */
  protected populateTileClusters(
    mapType: MapType,
    clusterW: number,
    clusterH: number,
    hexSize: number,
    occupied: Set<string>,
  ) {
    const pop = MAP_POPULATION[mapType];
    const pairs: [StructureVariant, ShardVariantId][] = [
      ['glass', 'glass-tile'],
      ['plastic', 'plastic-tile'],
      ['metal', 'metal-tile'],
    ];
    for (const [variant, key] of pairs) {
      const c = pop[key]?.tileCluster;
      if (!c) continue;
      this.entities.push(...TileGenerator.generateClusteredMesh(
          clusterW, clusterH, hexSize,
          c.clusterCount, c.minClusterSize, c.maxClusterSize, occupied, variant,
      ));
    }
  }

  /** Nebula clusters from MAP_POPULATION, recording each cluster's centre
   *  so the background puff layer can match it (see `nebulaClusterCenters`).
   *  Split from `populateTileClusters` because nebula goes through a
   *  different generator and carries that recording slot. */
  protected populateNebulaClusters(
    mapType: MapType,
    clusterW: number,
    clusterH: number,
    hexSize: number,
    occupied: Set<string>,
  ) {
    const c = MAP_POPULATION[mapType]['nebula-tile']?.tileCluster;
    if (!c) return;
    this.entities.push(...TileGenerator.generateNebulaClusters(
        clusterW, clusterH, hexSize,
        c.clusterCount, c.minClusterSize, c.maxClusterSize,
        occupied,
        this.nebulaClusterCenters,
    ));
  }

  /**
   * Which tile variant each ring of a ring-shaped map is made of, read off
   * MAP_POPULATION's `tileRings` entries (G7).  The map class still owns the
   * ring GEOMETRY — how many rings, how far out, how thinned — because that
   * is the map's shape; only the material assignment is population data.
   */
  protected ringVariants(mapType: MapType, ringCount: number): StructureVariant[] {
    const pop = MAP_POPULATION[mapType];
    const out: StructureVariant[] = new Array(ringCount).fill('glass');
    const pairs: [StructureVariant, ShardVariantId][] = [
      ['glass', 'glass-tile'],
      ['plastic', 'plastic-tile'],
      ['metal', 'metal-tile'],
      ['indestructible', 'indestructible-tile'],
    ];
    for (const [variant, key] of pairs) {
      for (const idx of pop[key]?.tileRings ?? []) {
        if (idx >= 0 && idx < ringCount) out[idx] = variant;
      }
    }
    return out;
  }

  /**
   * Spawn a traversable rift leading to the map descriptor `targetId`
   * (roadmap step (k)).  The entity recipe is the space station's exactly
   * — EntityType.INTERACTABLE + mass ∞ + no dropType — so the physics
   * broadphase skips every pair it is in, the static grid and the
   * flow-field obstacle bake exclude it, and the existing POI paths hand
   * it a minimap dot, an off-screen chevron, and asteroid-respawn
   * avoidance for free.  The destination's display name rides on `name`.
   */
  protected addPortal(targetId: string, pos: Vector2, color: string) {
    this.entities.push({
      id: nextId('portal'),
      type: EntityType.INTERACTABLE,
      isPortal: true,
      portalTargetId: targetId,
      name: mapDescriptor(targetId)?.name ?? targetId,
      position: { x: pos.x, y: pos.y },
      velocity: { x: 0, y: 0 },
      size: { x: PORTAL_CONSTANTS.SIZE, y: PORTAL_CONSTANTS.SIZE },
      rotation: 0,
      color,
      active: true,
      health: 1,
      maxHealth: 1,
      mass: Infinity,
      // Wormhole gravity well: picked up by PhysicsSystem.initializeAttractors
      // at map load (shards/enemies/drops spiral in; a shard reaching the
      // mouth is swallowed by the close-attractor crush) and by RenderSystem's
      // attractor bucket, which feeds the background star lensing.  The
      // player feels only GRAVITY_PLAYER_SCALE of it — a tug, never a trap.
      gravityRange: PORTAL_CONSTANTS.GRAVITY_RANGE,
      gravityStrength: PORTAL_CONSTANTS.GRAVITY_STRENGTH,
      gravityPlayerScale: PORTAL_CONSTANTS.GRAVITY_PLAYER_SCALE,
    });
  }

  /**
   * The way home: one ALWAYS-ACTIVE return rift beside this arena's
   * player spawn.  Called by the four portal-linked arena maps (the
   * showcase field maps stay menu-only and carry no portals).  The
   * offset lands inside the spawn safe zone those maps already clear,
   * so no extra terrain filtering is needed.
   */
  protected addReturnPortal() {
    const pos = {
      x: this.playerSpawn.x + RETURN_PORTAL_OFFSET.x,
      y: this.playerSpawn.y + RETURN_PORTAL_OFFSET.y,
    };
    wrapPosition(pos);
    this.addPortal(HUB_DESCRIPTOR.id, pos, PORTAL_CONSTANTS.RETURN_COLOR);
  }

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
    // Free-spawned rock-shards use the variant's spawn config so the
    // free-floating rocks read the same as tile-detached rock-shards
    // (5 / 7 / 9 verts, organic / irregular silhouette).  Vertex count,
    // angle jitter, and radius variance all come from
    // SHARD_VARIANTS['rock-shard'].spawn — see constants.ts.  Discrete
    // polyVerticesOptions (when set) takes priority over Min/Max.
    const spawn = SHARD_VARIANTS['rock-shard'].spawn;
    const numPoints = spawn.polyVerticesOptions
      ? spawn.polyVerticesOptions[Math.floor(Math.random() * spawn.polyVerticesOptions.length)]
      : spawn.polyVerticesMin
        + Math.floor(Math.random() * (spawn.polyVerticesMax - spawn.polyVerticesMin + 1));
    const baseR = (size / 2) * 0.82;
    const rawPts: { angle: number; r: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
        const baseAngle   = (i / numPoints) * Math.PI * 2;
        const angleJitter = (Math.random() - 0.5) * (Math.PI / numPoints) * spawn.angleJitter * 2;
        const radiusFrac  = spawn.radiusMin + Math.random() * spawn.radiusRange;
        rawPts.push({
            angle: baseAngle + angleJitter,
            r:     baseR * radiusFrac,
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
    // maxHealth is the size-scaled hit ceiling for the probabilistic break
    // model (ROCK_BREAK): the asteroid cracks on hit 1 and from hit 2 on
    // rolls an early break that's guaranteed by the ceiling.  Bigger rocks
    // get a higher ceiling, so they resist longer.
    const hp = rockHitCeiling(size);

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
        // Per-instance rock shade (G7): a free-spawned belt is the biggest
        // expanse of rock in the game and was one flat slate.
        color: randomRockShade(),
        active: true,
        health: hp,
        maxHealth: hp,
        polygonPoints: points,
        mass: SHARD_VARIANTS['rock-shard'].spawn.sizeToMass(size),
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
  public static readonly WIDTH  = 16000;
  public static readonly HEIGHT = 16000;

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

    // Landmark clusters — uniform distribution across the 95 % zone,
    // counts and size ranges from MAP_POPULATION (G7: the table is the
    // authority; this class used to hardcode a 42-cluster budget split
    // 64/23/13 and the table said something else entirely).  Per decision
    // #6, indestructible-tile is reserved for deliberate border placement
    // (SevenRingsMap's outer ring) and has no entry here.
    this.populateTileClusters(MapType.UNIVERSE, CLUSTER_W, CLUSTER_H, 22, occupied);

    // Nebula cloud clusters — same 95 %-zone uniform distribution.
    // Records each cluster's world-space start position into
    // `nebulaClusterCenters`, which GameEngine pipes into
    // BackgroundManager so the background-nebula layer renders puffs
    // at the same positions — one unified cloud, with parallax drift
    // of the backdrop as the camera moves.
    this.populateNebulaClusters(MapType.UNIVERSE, CLUSTER_W, CLUSTER_H, 22, occupied);

    // Clear a safe open area around spawn
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 350 * 350;
    });

    // The way home — added AFTER the spawn-clearance filter so the rift
    // isn't swept up by it.
    this.addReturnPortal();
  }
}

/**
 * Overworld — the wave-free home map (economy-pivot increment 1e).
 * Standard mixed terrain (asteroids + glass/plastic/metal clusters +
 * nebulae, counts read from MAP_POPULATION[OVERWORLD]) with the space
 * station POI at map center.  WaveSystem never starts a wave here; the
 * living-world population is the ambient systems (bubbles, rivals, the
 * engine-respawned roaming dragon).  The player spawns just beside the
 * station — inside dock range, so a fresh run opens with the DOCK
 * affordance visible.
 */
export class OverworldMap extends BaseMapLayer {
  public static readonly WIDTH  = 12000;
  public static readonly HEIGHT = 12000;

  constructor() {
    super('overworld_01', 'Overworld', MapType.OVERWORLD);
    this.width  = OverworldMap.WIDTH;
    this.height = OverworldMap.HEIGHT;
    this.playerSpawn = { x: 0, y: STATION_CONSTANTS.DOCK_RANGE * 0.8 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const gen = getRockShardFreeSpawn(MapType.OVERWORLD);
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    for (const e of this.entities) wrapPosition(e.position);

    // Same 95 %-of-map cluster zone as the UniverseMap (5 % dead ring at
    // the wrap seam); counts come straight from MAP_POPULATION.
    const CLUSTER_W = MAP_WIDTH  * 0.95;
    const CLUSTER_H = MAP_HEIGHT * 0.95;
    const occupied = new Set<string>();
    this.populateTileClusters(MapType.OVERWORLD, CLUSTER_W, CLUSTER_H, 22, occupied);
    this.populateNebulaClusters(MapType.OVERWORLD, CLUSTER_W, CLUSTER_H, 22, occupied);

    // Clear every station's and every portal's home patch: nothing
    // generates on top of them (the home station's clearance doubles as
    // the spawn-safe bubble — the player spawns just off it).
    const clear2 = STATION_CONSTANTS.CLEARANCE ** 2;
    const portalClear2 = PORTAL_CONSTANTS.CLEARANCE ** 2;
    this.entities = this.entities.filter(e =>
        OVERWORLD_STATIONS.every(st => {
            const dx = e.position.x - st.x, dy = e.position.y - st.y;
            return dx * dx + dy * dy > clear2;
        })
        && HUB_PORTAL_SITES.every(p => {
            const dx = e.position.x - p.x, dy = e.position.y - p.y;
            return dx * dx + dy * dy > portalClear2;
        })
    );

    // The stations — indestructible, non-colliding INTERACTABLEs (mass ∞
    // + no dropType: skipped by the broadphase, the static grid, and the
    // flow-field obstacle bake).  Each carries its variant kind; the
    // SERVICES mix (drydock / repair / shops) lives in STATION_VARIANTS.
    // GameEngine collects them by the isStation flag at map load.
    for (const st of OVERWORLD_STATIONS) {
      const variant = STATION_VARIANTS[st.kind];
      this.entities.push({
        id: nextId('station'),
        type: EntityType.INTERACTABLE,
        isStation: true,
        stationKind: st.kind,
        name: variant.name,
        position: { x: st.x, y: st.y },
        velocity: { x: 0, y: 0 },
        size: { x: STATION_CONSTANTS.SIZE, y: STATION_CONSTANTS.SIZE },
        rotation: 0,
        color: variant.color,
        active: true,
        health: 1,
        maxHealth: 1,
        mass: Infinity,
      });
    }

    // The rifts out to the wave arenas — one per full-game arena, spread
    // clear of the stations and each other.  Destinations are descriptor
    // ids; GameEngine.transitionToMap resolves them at entry time.
    for (const p of HUB_PORTAL_SITES) {
      this.addPortal(p.targetId, { x: p.x, y: p.y }, PORTAL_CONSTANTS.COLOR);
    }

    // The TEST RACK — a vertical column of portals into the showcase maps,
    // stepping the star-density range from densest at the top to sparsest at
    // the bottom.  +Y is down, so descending the column is descending altitude.
    for (const p of HUB_TEST_PORTAL_SITES) {
      this.addPortal(p.targetId, { x: p.x, y: p.y }, PORTAL_CONSTANTS.COLOR);
    }
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
  private static readonly RING_TILE_RADIUS = 1400;
  public  static readonly WIDTH  = 12000;
  public  static readonly HEIGHT = 12000;

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
    // keepEvery = 2: ring radius doubled to track the 2× map, so thin
    // to half the tiles to preserve the original ring tile count.
    emitGlassTileRing(this.entities, RingMap.RING_TILE_RADIUS, HEX_SIZE, 'glass', 2);

    // Clear a safe open area around spawn (same rule as UniverseMap so
    // the player never spawns inside an asteroid).
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 350 * 350;
    });

    // The way home — added AFTER the spawn-clearance filter.
    this.addReturnPortal();
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
  private static readonly INNER_RADIUS = 800;
  private static readonly OUTER_RADIUS = 4400;
  public  static readonly WIDTH  = 12000;
  public  static readonly HEIGHT = 12000;

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
    // WHICH ring is made of what now comes from MAP_POPULATION's `tileRings`
    // entries (G7) — inner glass, mid plastic, outer metal, outermost
    // indestructible, so the player can read difficulty by radius.  The
    // geometry below stays here: a map named Seven Rings does not get its
    // ring count from a population table.
    const RING_VARIANTS = this.ringVariants(MapType.SEVEN_RINGS, SevenRingsMap.RING_COUNT);
    const step = (SevenRingsMap.OUTER_RADIUS - SevenRingsMap.INNER_RADIUS) /
                 (SevenRingsMap.RING_COUNT - 1);
    for (let i = 0; i < SevenRingsMap.RING_COUNT; i++) {
      const r = SevenRingsMap.INNER_RADIUS + step * i;
      // keepEvery = 2: ring radii doubled to track the 2× map, so thin
      // each ring to half its tiles to preserve the original counts.
      emitGlassTileRing(this.entities, r, HEX_SIZE, RING_VARIANTS[i] ?? 'glass', 2);
    }

    // Keep a spawn bubble clear — use a radius slightly smaller than the
    // innermost ring so the player doesn't materialize inside a tile.
    const safeClear = Math.min(350, SevenRingsMap.INNER_RADIUS - HEX_SIZE * 1.5);
    const safeClearSq = safeClear * safeClear;
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > safeClearSq;
    });

    // The way home — added AFTER the spawn-clearance filter.
    this.addReturnPortal();
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
  public static readonly WIDTH  = 4000;
  public static readonly HEIGHT = 4000;

  // Cluster counts live in MAP_POPULATION[POCKET] (G7).  The sandbox is a
  // showcase, so its population leans heavy on tiles / nebulae and light on
  // asteroids; background nebula puffs match the nebula cluster count 1:1
  // via nebulaClusterCenters, so raising it also densifies the backdrop.

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

    // Tile variants — destructible flavours, in mid-sized clusters so
    // each variant reads as a distinct landmark rather than a stray
    // hex.  Per decision #6, indestructible-tile is reserved for
    // deliberate border placement and is not spawned here.  Nebula shares
    // the same occupancy set, so tiles and nebulae never overlap.
    this.populateTileClusters(MapType.POCKET, CLUSTER_W, CLUSTER_H, HEX_SIZE, occupied);
    this.populateNebulaClusters(MapType.POCKET, CLUSTER_W, CLUSTER_H, HEX_SIZE, occupied);

    // Keep a small safe bubble around spawn so the player doesn't
    // materialise inside a tile.
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 120 * 120;
    });

    // The way home — added AFTER the spawn-clearance filter.
    this.addReturnPortal();
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
 
    // A way home.  These maps are reachable from the hub's TEST RACK now, and
    // a destination you can enter but not leave is a trap rather than a test.
    // Added AFTER the clearance filter, exactly as the wave arenas do it, or
    // the rift would be swept up with the terrain.
    this.addReturnPortal();
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
 
    // A way home.  These maps are reachable from the hub's TEST RACK now, and
    // a destination you can enter but not leave is a trap rather than a test.
    // Added AFTER the clearance filter, exactly as the wave arenas do it, or
    // the rift would be swept up with the terrain.
    this.addReturnPortal();
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
 * Tile-heavy stress map — dense clusters of every destructible /
 * permanent tile variant packed across the 6 k × 6 k playfield.  Used
 * for evaluating tile-glow render cost (`·tLit` in the F3 overlay)
 * with a representative on-screen tile count.  No asteroid free-spawn
 * and no nebulae so the scene is purely tiles.
 */
export class TileHeavyMap extends BaseMapLayer {
  public static readonly WIDTH  = SINGLE_ELEMENT_MAP_SIZE;
  public static readonly HEIGHT = SINGLE_ELEMENT_MAP_SIZE;

  constructor() {
    super('tile_heavy_01', 'Tile Heavy', MapType.TILE_HEAVY);
    this.width  = TileHeavyMap.WIDTH;
    this.height = TileHeavyMap.HEIGHT;
    this.playerSpawn = { x: 0, y: 0 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const CLUSTER_W = MAP_WIDTH  * SINGLE_ELEMENT_CLUSTER_FRAC;
    const CLUSTER_H = MAP_HEIGHT * SINGLE_ELEMENT_CLUSTER_FRAC;
    const occupied = new Set<string>();

    // ~5 × the single-variant showcase density: each destructible
    // variant gets ~80 clusters × ~14 tiles = ~1 100 tiles, plus
    // ~40 small indestructible clusters.  Total ≈ 4 700 tiles, which
    // gives the player ~300-500 visible at default zoom — enough to
    // exercise the per-frame tile-bloom loop under realistic load.
    const PERVAR_CLUSTERS  = 80;
    const PERVAR_MIN_SIZE  = 12;
    const PERVAR_MAX_SIZE  = 16;
    const INDESTR_CLUSTERS = 40;
    const INDESTR_MIN_SIZE = 5;
    const INDESTR_MAX_SIZE = 10;

    for (const variant of ['glass', 'plastic', 'metal', 'rock'] as const) {
        this.entities.push(...TileGenerator.generateClusteredMesh(
            CLUSTER_W, CLUSTER_H, HEX_SIZE,
            PERVAR_CLUSTERS, PERVAR_MIN_SIZE, PERVAR_MAX_SIZE,
            occupied, variant
        ));
    }
    this.entities.push(...TileGenerator.generateClusteredMesh(
        CLUSTER_W, CLUSTER_H, HEX_SIZE,
        INDESTR_CLUSTERS, INDESTR_MIN_SIZE, INDESTR_MAX_SIZE,
        occupied, 'indestructible'
    ));

    // Keep the spawn point clear so the player doesn't materialise
    // inside a wall (mirrors the SingleVariantTileFieldMap pattern).
    const clearSq = SINGLE_ELEMENT_SPAWN_CLEAR * SINGLE_ELEMENT_SPAWN_CLEAR;
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > clearSq;
    });
 
    // A way home.  These maps are reachable from the hub's TEST RACK now, and
    // a destination you can enter but not leave is a trap rather than a test.
    // Added AFTER the clearance filter, exactly as the wave arenas do it, or
    // the rift would be swept up with the terrain.
    this.addReturnPortal();
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
 
    // A way home.  These maps are reachable from the hub's TEST RACK now, and
    // a destination you can enter but not leave is a trap rather than a test.
    // Added AFTER the clearance filter, exactly as the wave arenas do it, or
    // the rift would be swept up with the terrain.
    this.addReturnPortal();
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
    variant: StructureVariant = 'glass',
    // Thin the ring: keep 1 of every `keepEvery` candidate tiles
    // (evenly by angle).  A solid hex ring's tile count scales with
    // radius, so when the ring radius is scaled up to track a larger
    // map we pass keepEvery = scale factor to preserve the original
    // tile count with proportionally wider spacing.  Default 1 = solid.
    keepEvery: number = 1,
): void {
  const maxCol = Math.ceil((radius + HEX_SIZE) / HEX_WIDTH) + 1;
  const maxRow = Math.ceil((radius + HEX_SIZE) / HEX_V_SPACING) + 1;
  const w = HEX_WIDTH;
  const h = 2 * HEX_SIZE;
  // NOTE: no hoisted points array here.  buildStructureTile mints each
  // tile its own polygon; tile geometry is mutated in place by the dent
  // path, so one shared array would make the whole ring deform as a unit.
  const stride = Math.max(1, Math.round(keepEvery));
  // Collect ring candidates so they can be thinned evenly by angle.
  // Tiles stay on their hex-grid coords (c, r) — only which ones are
  // kept changes — so the position === hexCoord invariant holds.
  const cand: { c: number; r: number; x: number; y: number; a: number }[] = [];
  for (let r = -maxRow; r <= maxRow; r++) {
    for (let c = -maxCol; c <= maxCol; c++) {
      const { x, y } = hexCoordToPixel(c, r);
      const d = Math.sqrt(x * x + y * y);
      if (Math.abs(d - radius) > band) continue;
      cand.push({ c, r, x, y, a: Math.atan2(y, x) });
    }
  }
  if (stride > 1) cand.sort((p, q) => p.a - q.a);
  for (let i = 0; i < cand.length; i++) {
    if (stride > 1 && (i % stride) !== 0) continue;
    const t = cand[i];
    entities.push(TileGenerator.buildStructureTile(t.c, t.r, t.x, t.y, w, h, variant));
  }
}
