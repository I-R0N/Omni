
import { MapType, GameEntity, EntityType, Vector2, EnemySubtype } from '../../types';
import { TileGenerator } from './TileGenerator';
import { COLORS, ASTEROID_GENERATION_CONFIG, ASSETS, ENEMY_CONSTANTS, ENEMY_VARIANTS } from '../../constants';
import { sampleFlow } from '../systems/FlowField';

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
        id: `ast_${Date.now()}_${Math.random()}`,
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
    this.width = 30000;
    this.height = 30000;
    this.playerSpawn = { x: 0, y: 0 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Asteroids spread around spawn
    const gen = ASTEROID_GENERATION_CONFIG[MapType.UNIVERSE];
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);

    // Landmark clusters in the inner zone — sparse enough to leave clear
    // flow corridors between chunks for asteroids to stream through
    this.entities.push(...TileGenerator.generateClusteredMesh(
        8000, 8000,  // inner zone
        22,          // hexSize
        70,          // clusterCount  (was 250 — dense walls)
        12,          // minClusterSize (was 20)
        40           // maxClusterSize (was 70)
    ));

    // Sparse outer landmarks — well-separated chunks across deep space
    this.entities.push(...TileGenerator.generateClusteredMesh(
        this.width, this.height,
        22,
        100,         // was 350
        6,           // was 15
        24           // was 55
    ));

    // Clear a safe open area around spawn
    this.entities = this.entities.filter(e => {
        const d2 = e.position.x ** 2 + e.position.y ** 2;
        return d2 > 350 * 350;
    });
  }
}
