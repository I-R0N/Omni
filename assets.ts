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

// TODO: Replace these placeholder URLs with real asset locations (CDN/object storage).
export const ASSETS: AssetManifest = {
  NEBULA_PUFF: 'generated_puff',

  PLAYER_SHIP: '/assets/ship.png',
  ENEMY_DRONE: '/assets/drone.png',
  ENEMY_CHARGER: '/assets/charger.png',
  ENEMY_TANK: '/assets/tank.png',
  ENEMY_SKIRMISHER: '/assets/skirmisher.png',
  ENEMY_ORBITER: '/assets/orbiter.png',
  ENEMY_SNIPER: '/assets/sniper.png',
  EXPLOSION: 'https://via.placeholder.com/128/FF4400/FFFFFF?text=BOOM',

  ASTEROID_1: 'https://via.placeholder.com/100/808080/FFFFFF?text=Ast1',
  ASTEROID_2: 'https://via.placeholder.com/100/606060/FFFFFF?text=Ast2',
  ASTEROID_3: 'https://via.placeholder.com/100/404040/FFFFFF?text=Ast3',
  ASTEROID_ICE: 'https://via.placeholder.com/100/A0FFFF/000000?text=Ice',
  ASTEROID_VOLCANIC: 'https://via.placeholder.com/100/502020/FFFFFF?text=Lava',

  SUN: 'https://via.placeholder.com/120/FFFF00/000000?text=Sun',
  PLANET_TERRAN: 'https://via.placeholder.com/80/44FF44/000000?text=Terran',
  PLANET_RED: 'https://via.placeholder.com/70/FF4444/000000?text=Mars',
  PLANET_ICE: 'https://via.placeholder.com/100/88FFFF/000000?text=IceG',
  PORTAL: 'https://via.placeholder.com/90/AA00FF/FFFFFF?text=Portal',
  HEX_STRUCTURE: 'https://via.placeholder.com/80/4444FF/FFFFFF?text=Hex',
};
