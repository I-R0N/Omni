// Vibe Jam 2026 build configuration.
//
// This module is the single switch that turns Omni's standard build
// into a Vibe Jam 2026 entry: it skips the main-menu / difficulty
// pickers, drops the player straight into a slightly smaller Deep
// Space arena on Hard difficulty, and adds the Vibe Jam start +
// exit portal pair (https://vibej.am/portal/2026 — see
// https://vibej.am/2026/).  Touching either portal opens a
// confirmation modal before the redirect so the player can't leave
// by accident in the middle of a wave.
//
// The widget badge itself is a separate concern — it's wired up
// directly in index.html via the official `<script async
// src="https://vibej.am/2026/widget.js">` tag.

import { Vector2 } from './types';

/**
 * Master switch.  When `true`, App.tsx skips the menu, the engine
 * auto-starts the game on a JAM_MAP_SIZE Deep Space map, and the
 * start + exit portal pair is seeded near spawn.  Flip back to
 * `false` to restore the regular menu-driven build.
 */
export const VIBE_JAM_MODE = true;

/**
 * World size used for the Vibe Jam Deep Space arena.  The standard
 * UniverseMap is 8000×8000; we shrink it for the jam build so the
 * player meets enemies (and the portal) much faster.
 */
export const JAM_MAP_SIZE = 5000;

/** Hard difficulty index — matches DIFFICULTY_SCALES indexing. */
export const JAM_DIFFICULTY = 3;

/** Seconds the engine waits before the first wave spawns.  Gives the
 *  player a beat to read the controls panel and look at the arena
 *  before enemies arrive. */
export const JAM_FIRST_WAVE_DELAY = 10;

/** Hard cap on simultaneous mobile shards (rock-shard + glass-shard)
 *  on the map.  Backstop for the rock-shard free-spawn target — once
 *  the live count crosses this, the asteroid respawn loop pauses
 *  until merges / culls bring the total back below.  Caps the
 *  framerate impact of tile-shatter buildup since glass-shards
 *  outlive their parents.
 *
 *  The free-spawn target itself lives in MAP_POPULATION
 *  ('rock-shard'.count = 60 for the jam map). */
export const JAM_MAX_MOBILE_SHARDS = 100;

/** Hard cap on total active dynamic entities (i.e. anything that's
 *  not a static-mass-Infinity tile).  Static tiles are cheap (one-
 *  shot static spatial grid + pre-rendered minimap layer), so the
 *  cap targets the entities that actually drive per-frame cost:
 *  shards, drops, particles, projectiles, enemies, etc.
 *
 *  Once the active dynamic count crosses this, the engine culls the
 *  oldest non-essential entities (everything except player, enemies,
 *  static tiles, and the Vibe Jam portals) until the count is back
 *  below.  Acts as a final framerate safety net when caps further
 *  upstream (MAX_PARTICLES, MAX_PROJECTILES, JAM_MAX_MOBILE_SHARDS)
 *  haven't been enough on their own. */
export const JAM_MAX_ACTIVE_ENTITIES = 1000;

/** Start (return) portal anchor — players arriving via `?portal=true`
 *  spawn here; touching it sends them back to the inbound `ref` URL.
 *  Falls back to the Vibe Jam home page when no ref is provided. */
export const SPAWN_PORTAL_POS: Vector2 = { x: -600, y: 0 };

/** Exit portal anchor — touching it hands off to the Vibe Jam portal
 *  redirector for a random next game in the webring. */
export const EXIT_PORTAL_POS: Vector2 = { x: 600, y: 0 };

/** Touch radius in world units — once the player gets within this,
 *  the portal opens its confirmation prompt.  Smaller than the
 *  earlier 110 so the portals read as compact rings rather than
 *  arena-spanning hazards. */
export const PORTAL_RADIUS = 70;

export interface PortalEntryParams {
    isFromPortal: boolean;
    username?: string;
    color?: string;
    speed?: number;
    ref?: string;
}

/** Read the GET parameters Vibe Jam's portal redirector forwards. */
export function readPortalEntryParams(): PortalEntryParams {
    if (typeof window === 'undefined') return { isFromPortal: false };
    const p = new URLSearchParams(window.location.search);
    const speedStr = p.get('speed');
    const speedNum = speedStr != null ? Number(speedStr) : NaN;
    return {
        isFromPortal: p.get('portal') === 'true',
        username: p.get('username') ?? undefined,
        color: p.get('color') ?? undefined,
        speed: Number.isFinite(speedNum) ? speedNum : undefined,
        ref: p.get('ref') ?? undefined,
    };
}

/** Build the redirect URL handed to `window.location.href` when the
 *  player enters the exit portal.  Forwards every state parameter
 *  the rules call out so the next game in the webring can spawn
 *  the player with continuity. */
export function buildPortalExitUrl(opts: {
    username?: string;
    color?: string;
    speed?: number;
    ref?: string;
}): string {
    const url = new URL('https://vibej.am/portal/2026');
    if (opts.username) url.searchParams.set('username', opts.username);
    if (opts.color)    url.searchParams.set('color',    opts.color);
    if (opts.speed != null && Number.isFinite(opts.speed)) {
        url.searchParams.set('speed', String(opts.speed));
    }
    if (opts.ref)      url.searchParams.set('ref',      opts.ref);
    return url.toString();
}
