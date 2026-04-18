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

// Two nebula-image sets for A/B comparison.  Set A is the original collection;
// Set B is the newer art.  NEBULA_IMAGES is the currently-active list — flip
// via GameEngine.toggleNebulaSet() (wired to the DBG panel).  Importers read
// the same array reference, so in-place mutation propagates to all consumers.
export const NEBULA_IMAGES_SET_A: readonly string[] = [
  '/assets/Nebula00.png',
  '/assets/Nebula01.png',
  '/assets/Nebula02.png',
  '/assets/Nebula03.png',
  '/assets/Nebula04.png',
  '/assets/Nebula05.png',
  '/assets/Nebula06.png',
  '/assets/Nebula07.png',
  '/assets/Nebula08.png',
];

export const NEBULA_IMAGES_SET_B: readonly string[] = [
  '/assets/Nebula09.png',
  '/assets/Nebula10.png',
  '/assets/Nebula11.png',
  '/assets/Nebula12.png',
  '/assets/Nebula13.png',
  '/assets/Nebula14.png',
  '/assets/Nebula15.png',
  '/assets/Nebula16.png',
];

export type NebulaSet = 'A' | 'B' | 'ALL' | 'N16';

export const NEBULA_IMAGES: string[] = [...NEBULA_IMAGES_SET_A];

export function setActiveNebulaSet(set: NebulaSet): string[] {
  const source =
      set === 'A'   ? NEBULA_IMAGES_SET_A
    : set === 'B'   ? NEBULA_IMAGES_SET_B
    : set === 'N16' ? ['/assets/Nebula16.png']
    : [...NEBULA_IMAGES_SET_A, ...NEBULA_IMAGES_SET_B];
  NEBULA_IMAGES.length = 0;
  NEBULA_IMAGES.push(...source);
  return NEBULA_IMAGES;
}

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
