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
  // One sprite per tile variant — reinforced, heavy, indestructible.
  // Damage state is drawn procedurally via renderCracks (same as asteroids),
  // so variants don't need per-tier atlases.
  HEX_STRUCTURE_REINFORCED: string;
  HEX_STRUCTURE_HEAVY: string;
  HEX_STRUCTURE_INDESTRUCTIBLE: string;
  NEBULA_PUFF: string;
  // Seamless rock surface textures, drawn polygon-clipped onto rock-shard
  // and rock-tile silhouettes (see RenderSystem rocky-asteroid branch).
  ROCK_TEXTURE_1: string;
  ROCK_TEXTURE_2: string;
};

// Placeholder path used for assets that have no real image yet.
// A local 404 completes in milliseconds and lets the canvas fallback
// render immediately, without hanging external HTTP requests.
const PLACEHOLDER = '/assets/placeholder.png';

// Nebula images are auto-discovered at build time by vite.config.ts's
// nebula-manifest plugin, which scans public/assets/ for every file matching
// Nebula##.png.  Dropping a new file into that folder picks it up on the
// next dev reload / build — no code changes required.
import NEBULA_MANIFEST from 'virtual:nebula-manifest';

const basenameOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

// TEST MODE: restrict the active manifest to a hand-picked subset of textures
// so we can evaluate just this curated palette in isolation.  Remove this
// filter (revert NEBULA_IMAGES_ALL to `NEBULA_MANIFEST`) to use every
// discovered Nebula##.png again.
const TEST_SUBSET_BASENAMES = new Set([
  'Nebula00.png', 'Nebula06.png', 'Nebula14.png',
  'Nebula15.png', 'Nebula16.png', 'Nebula17.png',
  'Nebula18.png',
]);

// All nebula image URLs the game is allowed to use, sorted by filename.
export const NEBULA_IMAGES_ALL: readonly string[] =
  NEBULA_MANIFEST.filter(url => TEST_SUBSET_BASENAMES.has(basenameOf(url)));

// Historical baseline: the original nine nebula images (00-08).  Kept as a
// named subset so the DBG panel can A/B compare "old art" vs "everything".
// Rendered from the discovered manifest so a missing file stops rendering,
// but never includes any of the newer art by accident.
const SET_A_BASENAMES = new Set([
  'Nebula00.png', 'Nebula01.png', 'Nebula02.png',
  'Nebula03.png', 'Nebula04.png', 'Nebula05.png',
  'Nebula06.png', 'Nebula07.png', 'Nebula08.png',
]);

export const NEBULA_IMAGES_SET_A: readonly string[] =
  NEBULA_IMAGES_ALL.filter(url => SET_A_BASENAMES.has(basenameOf(url)));

// Everything discovered that isn't in set A — grows automatically as new
// Nebula##.png files are added past index 08.
export const NEBULA_IMAGES_SET_B: readonly string[] =
  NEBULA_IMAGES_ALL.filter(url => !SET_A_BASENAMES.has(basenameOf(url)));

export type NebulaSet = 'A' | 'B' | 'ALL' | 'N16';

// NEBULA_IMAGES is the currently-active list — swapped via
// setActiveNebulaSet() (wired to the DBG panel).  Consumers read the same
// array reference, so in-place mutation propagates to all of them.
export const NEBULA_IMAGES: string[] = [...NEBULA_IMAGES_ALL];

export function setActiveNebulaSet(set: NebulaSet): string[] {
  const n16 = NEBULA_IMAGES_ALL.filter(url => basenameOf(url) === 'Nebula16.png');
  const source =
      set === 'A'   ? NEBULA_IMAGES_SET_A
    : set === 'B'   ? NEBULA_IMAGES_SET_B
    : set === 'N16' ? n16
    : NEBULA_IMAGES_ALL;
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
  PORTAL:                       PLACEHOLDER,
  HEX_STRUCTURE:                PLACEHOLDER,
  HEX_STRUCTURE_REINFORCED:     PLACEHOLDER,
  HEX_STRUCTURE_HEAVY:          PLACEHOLDER,
  HEX_STRUCTURE_INDESTRUCTIBLE: PLACEHOLDER,
  ROCK_TEXTURE_1: '/assets/Rock00.png',
  ROCK_TEXTURE_2: '/assets/Rock01.png',
};
