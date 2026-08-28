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
  // One sprite per tile variant — plastic, metal, indestructible.
  // Damage state is drawn procedurally via renderCracks (same as asteroids),
  // so variants don't need per-tier atlases.
  HEX_STRUCTURE_PLASTIC: string;
  HEX_STRUCTURE_METAL: string;
  HEX_STRUCTURE_INDESTRUCTIBLE: string;
  NEBULA_PUFF: string;
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

// All discovered nebula image URLs, sorted by filename.
export const NEBULA_IMAGES_ALL: readonly string[] = NEBULA_MANIFEST;

// Historical baseline: the original nine nebula images (00-08).  Kept as a
// named subset so the DBG panel can A/B compare "old art" vs "everything".
// Rendered from the discovered manifest so a missing file stops rendering,
// but never includes any of the newer art by accident.
const SET_A_BASENAMES = new Set([
  'Nebula00.png', 'Nebula01.png', 'Nebula02.png',
  'Nebula03.png', 'Nebula04.png', 'Nebula05.png',
  'Nebula06.png', 'Nebula07.png', 'Nebula08.png',
]);
const basenameOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

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
  HEX_STRUCTURE_PLASTIC:        PLACEHOLDER,
  HEX_STRUCTURE_METAL:          PLACEHOLDER,
  HEX_STRUCTURE_INDESTRUCTIBLE: PLACEHOLDER,
};

// ── SHIP TILT SHEETS ───────────────────────────────────────────────────
// Pre-rendered hull poses, one per (tilt magnitude, tilt axis azimuth) —
// the art that replaces the cos(tilt) squash.  The grid, the mirroring
// rule and the cell order live in engine/systems/render/shipSprites.ts;
// this is only the per-ship manifest.  docs/SHIP_SPRITE_SHEETS.md is the
// authoring guide (generated from the same table).
import type { ShipSpriteSheet, TiltGridSpec } from './engine/systems/render/shipSprites';

const D = Math.PI / 180;

/** THE STANDARD GRID — the recommended sampling for a new ship.
 *
 *  Rings every 15° out to 90°.  15° is the step at which snapping to the
 *  nearest pose moves the silhouette by ~2px on a 48px hull at the worst
 *  angle (the error goes as R·sin(theta)·step/2) — invisible in motion,
 *  where 30° reads as popping.  90° is past the sim's own ceiling
 *  (PLAYER_ROLL_CONSTANTS.MAX_TILT = 1.45 rad ≈ 83°, itself only reachable
 *  as a Deep-preset spring overshoot), so the outer ring is headroom.
 *
 *  Azimuths grow with the ring because the lean DIRECTION only matters in
 *  proportion to sin(theta): at 15° over, all lean directions look nearly
 *  alike; at 75° they do not.  Sampling every ring at the outer ring's rate
 *  would nearly double the art for poses no one can tell apart.
 *
 *  With mirroring that is 35 authored cells (1 + 3 + 5 + 5 + 7 + 7 + 7);
 *  57 without.  See the guide for the coarse and fine alternatives. */
export const SHIP_TILT_GRID_STANDARD: TiltGridSpec = {
  rings:    [0, 15 * D, 30 * D, 45 * D, 60 * D, 75 * D, 90 * D],
  azimuths: [1, 4,      8,      8,      12,     12,     12],
};

/** A quick-to-author grid for blocking a new design in: 15 cells, 30°
 *  rings.  Poses pop on a slow lean, so it is a stepping stone rather than
 *  a shipping target. */
export const SHIP_TILT_GRID_COARSE: TiltGridSpec = {
  rings:    [0, 30 * D, 60 * D, 83 * D],
  azimuths: [1, 6,      8,      8],
};

/** The base hull's sheet.  Authored NOSE-RIGHT (artOffset 0) — unlike the
 *  legacy ship.png, which points up-left and needs
 *  SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET.  Loose per-cell files rather
 *  than a packed sheet so cells can land one at a time; swap in a `sheet`
 *  block to use a packed atlas instead. */
export const SHIP_SHEET_BASE: ShipSpriteSheet = {
  id: 'base',
  grid: SHIP_TILT_GRID_STANDARD,
  mirrorRoll: true,
  artOffset: 0,
  drawScale: 1.5,
  yawSteps: 0,
  cellPattern: '/assets/ships/base/tilt_t{t}_a{a}.png',
};

/** Every ship sheet the game knows.  A new design is a row here plus its
 *  art — no draw-path change. */
export const SHIP_SHEETS: Record<string, ShipSpriteSheet> = {
  base: SHIP_SHEET_BASE,
};
