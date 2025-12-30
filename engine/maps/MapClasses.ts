
import { MapType, GameEntity, EntityType, Vector2, EnemySubtype } from '../../types';
import { TileGenerator } from './TileGenerator';
import { COLORS, ASTEROID_GENERATION_CONFIG, ASSETS, ENEMY_CONSTANTS, ENEMY_VARIANTS } from '../../constants';

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
        // Random distribution within radius, but try to avoid center slightly
        const dist = 500 + Math.random() * (radius - 500); 
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist;
        const size = minSize + Math.random() * (maxSize - minSize);
        this.entities.push(this.createAsteroid(x, y, size, speedMultiplier, allowedSprites));
    }
  }

  protected createAsteroid(
      x: number, 
      y: number, 
      size: number, 
      speedMultiplier: number = 1.0,
      allowedSprites: string[] = []
    ): GameEntity {
    // Generate random polygon points for hitbox
    const points: Vector2[] = [];
    const numPoints = 8;
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        // Hitbox slightly smaller than sprite to be forgiving
        const r = (size/2) * 0.8; 
        points.push({
            x: Math.cos(angle) * r,
            y: Math.sin(angle) * r
        });
    }

    // Randomize Asteroid Sprite
    let asteroidAssets = [ASSETS.ASTEROID_1, ASSETS.ASTEROID_2, ASSETS.ASTEROID_3, ASSETS.ASTEROID_ICE, ASSETS.ASTEROID_VOLCANIC];
    
    // Filter if allowedSprites provided
    if (allowedSprites.length > 0) {
        asteroidAssets = allowedSprites;
    }

    const randomSprite = asteroidAssets[Math.floor(Math.random() * asteroidAssets.length)];

    // Health logic
    const hp = size > 30 ? 2 : 1;

    return {
        id: `ast_${Date.now()}_${Math.random()}`,
        type: EntityType.ASTEROID,
        position: { x, y },
        velocity: { 
            x: (Math.random() - 0.5) * 2 * speedMultiplier,
            y: (Math.random() - 0.5) * 2 * speedMultiplier 
        },
        size: { x: size, y: size },
        rotation: Math.random() * Math.PI * 2,
        color: COLORS.ASTEROID,
        active: true,
        health: hp,
        maxHealth: hp,
        polygonPoints: points,
        mass: size, 
        sprite: randomSprite
    };
  }

  protected spawnEnemies(count: number, radius: number) {
      const scaledCount = Math.round(count * this.enemyScale);
      if (scaledCount <= 0) return;

      const types = [
          EnemySubtype.BASIC,
          EnemySubtype.FAST_CHARGER,
          EnemySubtype.TANK,
          EnemySubtype.SKIRMISHER
      ];

      for(let i=0; i<scaledCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 600 + Math.random() * (radius - 600);
          const x = Math.cos(angle) * dist;
          const y = Math.sin(angle) * dist;

          const subtype = types[Math.floor(Math.random() * types.length)];
          const config = ENEMY_VARIANTS[subtype];
          
          this.entities.push({
              id: `enemy_${Date.now()}_${i}`,
              type: EntityType.ENEMY,
              enemySubtype: subtype,
              position: { x, y },
              velocity: { x: 0, y: 0 },
              size: { x: config.size, y: config.size },
              rotation: Math.random() * Math.PI * 2,
              color: config.color,
              active: true,
              health: config.health,
              maxHealth: config.health,
              mass: config.mass,
              visionRange: ENEMY_CONSTANTS.VISION_RANGE,
              sprite: config.sprite
          });
      }
  }
}

export class UniverseMap extends BaseMapLayer {
  constructor() {
    super('universe_01', 'Galactic Sector Alpha', MapType.UNIVERSE);
    this.width = 24000;
    this.height = 24000;
    this.playerSpawn = { x: 0, y: 0 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Create Star Systems (Scaled x10)
    const stars = [
      { id: 'sol_sys', name: 'Sol System', pos: { x: 2000, y: -1000 }, color: COLORS.STAR },
      { id: 'alpha_sys', name: 'Alpha Centauri', pos: { x: -3000, y: 2000 }, color: '#ef4444' },
      { id: 'sirius_sys', name: 'Sirius', pos: { x: 0, y: 5000 }, color: '#3b82f6' },
    ];

    stars.forEach(star => {
      this.entities.push({
        id: star.id,
        name: star.name,
        type: EntityType.INTERACTABLE,
        position: star.pos,
        velocity: { x: 0, y: 0 },
        size: { x: 64, y: 64 },
        rotation: 0,
        color: star.color,
        active: true,
        health: 100,
        maxHealth: 100,
        targetMapId: star.id + '_map',
        targetMapType: MapType.SOLAR_SYSTEM,
        mass: Infinity,
        sprite: ASSETS.SUN,
        gravityRange: 1500,
        gravityStrength: 4000
      });
    });

    const gen = ASTEROID_GENERATION_CONFIG[MapType.UNIVERSE];
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
    this.spawnEnemies(25, 8000);

    // Cluster Generation
    this.entities.push(...TileGenerator.generateClusteredMesh(
        this.width, this.height, 
        20,   // hexSize
        400,  // clusterCount (Doubled)
        30,   // minClusterSize (Increased)
        100   // maxClusterSize (Increased)
    ));

    // Clear center but PRESERVE INTERACTABLES
    this.entities = this.entities.filter(e => {
        if (e.type === EntityType.INTERACTABLE) return true;
        const d2 = e.position.x**2 + e.position.y**2;
        return d2 > 300 * 300; 
    });
  }
}

export class SolarSystemMap extends BaseMapLayer {
  constructor(id: string, name: string) {
    super(id, name, MapType.SOLAR_SYSTEM);
    this.width = 10000;
    this.height = 10000;
    this.playerSpawn = { x: -3800, y: -3800 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.entities.push({
      id: 'sun',
      name: 'The Sun',
      type: EntityType.INTERACTABLE,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      size: { x: 120, y: 120 },
      rotation: 0,
      color: COLORS.STAR,
      active: true,
      health: 1000,
      maxHealth: 1000,
      mass: Infinity,
      sprite: ASSETS.SUN,
      gravityRange: 4000,
      gravityStrength: 10000
    });

    const planets = [
      { name: 'Terran Prime', dist: 1200, size: 40, color: COLORS.PLANET, sprite: ASSETS.PLANET_TERRAN },
      { name: 'Red Dust', dist: 2000, size: 35, color: '#f87171', sprite: ASSETS.PLANET_RED },
      { name: 'Ice Giant', dist: 3500, size: 60, color: '#a5f3fc', sprite: ASSETS.PLANET_ICE },
    ];

    planets.forEach((p, i) => {
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * p.dist;
      const y = Math.sin(angle) * p.dist;

      this.entities.push({
        id: `planet_${i}`,
        name: p.name,
        type: EntityType.INTERACTABLE,
        position: { x, y },
        velocity: { x: 0, y: 0 },
        size: { x: p.size, y: p.size },
        rotation: 0,
        color: p.color,
        active: true,
        health: 100,
        maxHealth: 100,
        targetMapId: `local_${i}`,
        targetMapType: MapType.LOCAL,
        mass: Infinity,
        sprite: p.sprite,
        orbitCenter: { x: 0, y: 0 },
        orbitRadius: p.dist,
        orbitSpeed: 0.05 / (i + 1),
        orbitAngle: angle,
        gravityRange: 400,
        gravityStrength: 800
      });
    });

    for (let i = 0; i < 30; i++) {
        const dist = 600 + Math.random() * 400;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist;
        const size = 30 + Math.random() * 40;
        this.entities.push(this.createAsteroid(x, y, size, 1.0, [ASSETS.ASTEROID_1]));
    }

    this.entities.push({
        id: 'warp_gate',
        name: 'Galactic Sector',
        type: EntityType.INTERACTABLE,
        position: { x: -4000, y: -4000 },
        velocity: { x: 0, y: 0 },
        size: { x: 50, y: 50 },
        rotation: 0,
        color: '#a855f7',
        active: true,
        health: 100,
        maxHealth: 100,
        targetMapId: this.parentId || 'universe_01',
        targetMapType: MapType.UNIVERSE,
        mass: Infinity,
        sprite: ASSETS.PORTAL
      });

    const gen = ASTEROID_GENERATION_CONFIG[MapType.SOLAR_SYSTEM];
    const solarAsteroids = [ASSETS.ASTEROID_1, ASSETS.ASTEROID_3, ASSETS.ASTEROID_ICE];
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier, solarAsteroids);
    this.spawnEnemies(20, 4000);

    // Cluster Generation
    this.entities.push(...TileGenerator.generateClusteredMesh(
        this.width, this.height, 
        20,   // hexSize
        300,  // clusterCount (Doubled)
        40,   // minClusterSize
        140   // maxClusterSize (Increased)
    ));

    this.entities = this.entities.filter(e => {
        if (e.type === EntityType.INTERACTABLE) return true;
        const d2 = e.position.x**2 + e.position.y**2;
        return d2 > 400 * 400;
    });
  }
}

export class LocalMap extends BaseMapLayer {
  constructor(id: string, name: string) {
    super(id, name, MapType.LOCAL);
    this.width = 6000;
    this.height = 6000;
    this.playerSpawn = { x: -500, y: -500 };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.entities.push({
      id: 'structure_entrance',
      name: 'Sub Level',
      type: EntityType.INTERACTABLE,
      position: { x: 200, y: 100 },
      velocity: { x: 0, y: 0 },
      size: { x: 48, y: 48 },
      rotation: 0,
      color: '#facc15',
      active: true,
      health: 100,
      maxHealth: 100,
      targetMapId: `sub_${this.id}`,
      targetMapType: MapType.SUB_MAP,
      mass: Infinity,
      sprite: ASSETS.PORTAL
    });

    this.entities.push({
        id: 'shuttle',
        name: 'Orbit',
        type: EntityType.INTERACTABLE,
        position: { x: -600, y: -600 },
        velocity: { x: 0, y: 0 },
        size: { x: 64, y: 64 },
        rotation: 0,
        color: '#94a3b8',
        active: true,
        health: 100,
        maxHealth: 100,
        targetMapId: this.parentId || 'sol_sys_map',
        targetMapType: MapType.SOLAR_SYSTEM,
        mass: Infinity,
        sprite: ASSETS.PLAYER_SHIP
      });

    const gen = ASTEROID_GENERATION_CONFIG[MapType.LOCAL];
    const localAsteroids = [ASSETS.ASTEROID_2, ASSETS.ASTEROID_VOLCANIC];
    this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier, localAsteroids);
    this.spawnEnemies(15, 2000);

    // Cluster Generation
    this.entities.push(...TileGenerator.generateClusteredMesh(
        this.width, this.height, 
        20,   // hexSize
        200,  // clusterCount (Doubled)
        20,   // minClusterSize
        150   // maxClusterSize (Increased)
    ));

    this.entities = this.entities.filter(e => {
        if (e.type === EntityType.INTERACTABLE) return true;
        const d2 = e.position.x**2 + e.position.y**2;
        return d2 > 200 * 200;
    });
  }
}

export class SubMap extends BaseMapLayer {
    constructor(id: string, name: string) {
      super(id, name, MapType.SUB_MAP);
      this.width = 3000;
      this.height = 3000;
      this.playerSpawn = { x: 0, y: 0 };
    }
  
    init() {
      if (this.initialized) return;
      this.initialized = true;

      this.entities.push({
        id: 'exit_hatch',
        name: 'Surface',
        type: EntityType.INTERACTABLE,
        position: { x: 0, y: -300 },
        velocity: { x: 0, y: 0 },
        size: { x: 32, y: 32 },
        rotation: 0,
        color: '#22c55e',
        active: true,
        health: 100,
        maxHealth: 100,
        targetMapId: this.parentId || 'prev_local',
        targetMapType: MapType.LOCAL,
        mass: Infinity,
        sprite: ASSETS.PORTAL
      });

      const gen = ASTEROID_GENERATION_CONFIG[MapType.SUB_MAP];
      this.spawnAsteroids(gen.count, gen.minSize, gen.maxSize, gen.radius, gen.speedMultiplier);
      this.spawnEnemies(10, 1000);

      // Cluster Generation - Denser for submap
      this.entities.push(...TileGenerator.generateClusteredMesh(
          this.width, this.height, 
          20,   // hexSize
          160,   // clusterCount (Doubled)
          80,   // minClusterSize
          250   // maxClusterSize (Increased)
      ));

      this.entities = this.entities.filter(e => {
        if (e.type === EntityType.INTERACTABLE) return true;
        const d2 = e.position.x**2 + (e.position.y + 300)**2; 
        const d2Center = e.position.x**2 + e.position.y**2;
        return d2 > 150 * 150 && d2Center > 150 * 150;
      });
    }
  }
