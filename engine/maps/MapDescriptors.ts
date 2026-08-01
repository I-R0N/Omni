import { MapType } from '../../types';

/**
 * Map-descriptor registry (roadmap step (k), decision #36e).
 *
 * A THIN typed lookup that names every map with a STABLE STRING ID and
 * records the handful of facts a map TRANSITION needs.  It WRAPS the
 * existing MapType plumbing rather than replacing it: the map classes
 * (`MapClasses.ts`), the movement config (`PLAYER_MOVEMENT_CONFIG`), and
 * the population table (`MAP_POPULATION`) all stay keyed by MapType.
 * Descriptors are the layer that portals and the engine's transition path
 * reference, so a destination is `'arena_universe'` — not a bare enum
 * value — and the future overworld phase can reference the same ids.
 *
 * Deliberately NOT here (guardrail #3 — expose extension points, don't
 * build the overworld early): procedural parameters, per-map persistent
 * world state, spawn tables, difficulty curves, a descriptor editor.
 * Every field below has a consumer THIS session; if it grows one without
 * a consumer, delete it.
 *
 *   id           stable string id — portal targets + transitionToMap()
 *   name         display name — portal name tag + the entry affordance
 *   mapType      the MapType GameEngine.buildMap() instantiates
 *   kind         'hub' (wave-free home) | 'arena' (wave gameplay)
 *   wavesEnabled what WaveSystem.init(ctx, enabled) is handed
 *
 * `kind` and `wavesEnabled` are separate on purpose: "is the home hub"
 * and "runs waves" are the same answer today, but the showcase maps are
 * arenas nobody portals into, and the hub lookup wants `kind` alone.
 */

export type MapKind = 'hub' | 'arena';

export interface MapDescriptor {
  /** Stable id — persists across refactors; portals store this, not MapType. */
  id: string;
  /** Player-facing name (portal tag, entry prompt). */
  name: string;
  /** The MapType `GameEngine.buildMap()` switches on. */
  mapType: MapType;
  /** 'hub' = the wave-free home map; 'arena' = a wave map. */
  kind: MapKind;
  /** Handed straight to `WaveSystem.init(ctx, enabled)` on load. */
  wavesEnabled: boolean;
}

/** Every map in the game, in menu order.  Adding a map = one row here
 *  plus the usual MapType plumbing (see CLAUDE.md §6a). */
export const MAP_DESCRIPTORS: readonly MapDescriptor[] = [
  // The hub — wave-free, stations, portals out to the arenas.
  { id: 'overworld',            name: 'Overworld',      mapType: MapType.OVERWORLD,   kind: 'hub',   wavesEnabled: false },

  // Full-game arenas.  These four are the portal-linked set: the hub
  // places one portal per entry in HUB_PORTAL_SITES, and each of these
  // maps carries a return portal home (BaseMapLayer.addReturnPortal).
  { id: 'arena_universe',       name: 'Deep Space',     mapType: MapType.UNIVERSE,    kind: 'arena', wavesEnabled: true },
  { id: 'arena_ring',           name: 'Ring World',     mapType: MapType.RING,        kind: 'arena', wavesEnabled: true },
  { id: 'arena_seven_rings',    name: 'Seven Rings',    mapType: MapType.SEVEN_RINGS, kind: 'arena', wavesEnabled: true },
  { id: 'arena_pocket',         name: 'Pocket',         mapType: MapType.POCKET,      kind: 'arena', wavesEnabled: true },

  // Single-element showcase maps — menu-only (no portals, unchanged).
  // Registered so `wavesEnabled` has ONE source of truth for every map.
  { id: 'field_asteroid',       name: 'Asteroid Field', mapType: MapType.ASTEROID_FIELD,       kind: 'arena', wavesEnabled: true },
  { id: 'field_glass',          name: 'Glass Field',    mapType: MapType.GLASS_FIELD,          kind: 'arena', wavesEnabled: true },
  { id: 'field_plastic',        name: 'Plastic Field',  mapType: MapType.PLASTIC_FIELD,        kind: 'arena', wavesEnabled: true },
  { id: 'field_metal',          name: 'Metal Field',    mapType: MapType.METAL_FIELD,          kind: 'arena', wavesEnabled: true },
  { id: 'field_indestructible', name: 'Indestructible', mapType: MapType.INDESTRUCTIBLE_FIELD, kind: 'arena', wavesEnabled: true },
  { id: 'field_nebula',         name: 'Nebula Field',   mapType: MapType.NEBULA_FIELD,         kind: 'arena', wavesEnabled: true },
  { id: 'field_rock',           name: 'Rock Field',     mapType: MapType.ROCK_FIELD,           kind: 'arena', wavesEnabled: true },
  { id: 'field_tile_heavy',     name: 'Tile Heavy',     mapType: MapType.TILE_HEAVY,           kind: 'arena', wavesEnabled: true },
];

// Built once — the registry is static, and both lookups run on the map-load
// path (never per frame).
const BY_ID = new Map<string, MapDescriptor>(MAP_DESCRIPTORS.map(d => [d.id, d]));
const BY_MAP_TYPE = new Map<MapType, MapDescriptor>(MAP_DESCRIPTORS.map(d => [d.mapType, d]));

/** Look up a descriptor by its stable id (portal targets, transitions). */
export function mapDescriptor(id: string | undefined): MapDescriptor | undefined {
  return id === undefined ? undefined : BY_ID.get(id);
}

/** Reverse lookup for the MapType-keyed call sites that still exist
 *  (the engine's `wavesEnabled` getter, the menu's map grid). */
export function descriptorForMapType(type: MapType | undefined): MapDescriptor | undefined {
  return type === undefined ? undefined : BY_MAP_TYPE.get(type);
}

/** The home hub — where a new run starts and where every return portal
 *  leads.  Resolved from `kind` so the id isn't hardcoded twice. */
export const HUB_DESCRIPTOR: MapDescriptor =
  MAP_DESCRIPTORS.find(d => d.kind === 'hub') ?? MAP_DESCRIPTORS[0];
