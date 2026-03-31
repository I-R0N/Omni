// Centralized asset manifest for game visuals. Update these URLs when swapping art.
export type AssetManifest = {
  PLAYER_SHIP: string;
  ENEMY_DRONE: string;
  ENEMY_CHARGER: string;
  ENEMY_TANK: string;
  ENEMY_SKIRMISHER: string;
  ENEMY_ORBITER: string;
  ENEMY_SNIPER: string;
  EXPLOSION: string;
  ASTEROID_1: string;
  ASTEROID_2: string;
  ASTEROID_3: string;
  ASTEROID_ICE: string;
  ASTEROID_VOLCANIC: string;
  SUN: string;
  PLANET_TERRAN: string;
  PLANET_RED: string;
  PLANET_ICE: string;
  PORTAL: string;
  HEX_STRUCTURE: string;
  NEBULA_PUFF: string;
};

// Placeholder path used for assets that have no real image yet.
// A local 404 completes in milliseconds and lets the canvas fallback
// render immediately, without hanging external HTTP requests.
const PLACEHOLDER = '/assets/placeholder.png';

// List image paths here to replace the procedural nebula generation with real images.
// Supported formats: PNG, JPEG, WebP. Use white/light-colored images on a transparent
// or black background — the engine tints them at runtime with per-nebula colors.
// Leave empty to keep the built-in procedural generation.
// Example: ['/assets/nebula_1.png', '/assets/nebula_2.png']
export const NEBULA_IMAGES: string[] = [];

// TODO: Replace PLACEHOLDER entries with real asset locations (CDN/object storage).
export const ASSETS: AssetManifest = {
  NEBULA_PUFF: 'generated_puff',

  PLAYER_SHIP: '/assets/ship.png',
  ENEMY_DRONE: '/assets/drone.png',
  ENEMY_CHARGER: '/assets/charger.png',
  ENEMY_TANK: '/assets/tank.png',
  ENEMY_SKIRMISHER: '/assets/skirmisher.png',
  ENEMY_ORBITER: '/assets/orbiter.png',
  ENEMY_SNIPER: '/assets/sniper.png',
  EXPLOSION:          PLACEHOLDER,

  ASTEROID_1:         PLACEHOLDER,
  ASTEROID_2:         PLACEHOLDER,
  ASTEROID_3:         PLACEHOLDER,
  ASTEROID_ICE:       PLACEHOLDER,
  ASTEROID_VOLCANIC:  PLACEHOLDER,

  SUN:            PLACEHOLDER,
  PLANET_TERRAN:  PLACEHOLDER,
  PLANET_RED:     PLACEHOLDER,
  PLANET_ICE:     PLACEHOLDER,
  PORTAL:         PLACEHOLDER,
  HEX_STRUCTURE:  PLACEHOLDER,
};
