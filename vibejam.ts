// Vibe Jam 2026 build configuration.
//
// This module is the single switch that turns Omni's standard build
// into a Vibe Jam 2026 entry: it skips the main-menu / difficulty
// pickers, drops the player straight into a slightly smaller Deep
// Space arena on Hard difficulty, and adds an exit portal that
// hands the player off to the Vibe Jam portal redirector
// (https://vibej.am/portal/2026 — see https://vibej.am/2026/).
//
// The widget badge itself is a separate concern — it's wired up
// directly in index.html via the official `<script async
// src="https://vibej.am/2026/widget.js">` tag.

import { Vector2 } from './types';

/**
 * Master switch.  When `true`, App.tsx skips the menu, the engine
 * auto-starts the game on a JAM_MAP_SIZE Deep Space map, and a pair
 * of portals is seeded near spawn.  Flip back to `false` to restore
 * the regular menu-driven build.
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

/** World-space anchor of the exit portal.  Visible from spawn. */
export const EXIT_PORTAL_POS: Vector2 = { x: 600, y: 0 };

/** World-space anchor of the spawn portal.  Players arriving from
 *  another Vibe Jam game (`?portal=true`) land here. */
export const SPAWN_PORTAL_POS: Vector2 = { x: -600, y: 0 };

/** Touch radius in world units — once the player gets within this,
 *  the exit portal redirects.  Sized so a fast player can't glance
 *  past it without triggering. */
export const PORTAL_RADIUS = 110;

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
