/**
 * wreck.ts — THE DEATH WRECK (plan D10; engine-core S2 gameplay PR).
 *
 * A death strips the INSTALLED loadout (D4/D11: cargo, credits and slot counts
 * survive).  D10 makes that loss recoverable: what was mounted is left as a
 * wreck at the spot the ship fell, and the player flies back for it.
 *
 *  - THE RECORD IS THE TRUTH, THE ENTITY IS A VIEW.  `g.wreck` is a
 *    `WreckRecord` (engine/save.ts) that goes in the save file; the wreck in
 *    the world is rebuilt from it whenever its map loads.  Nothing about any
 *    arena is serialized: the record pins that arena's SEED (D-S2-d1) and S1's
 *    seeded generation rebuilds the terrain, so the death position is still
 *    valid.  `loadMapSeeded` reads `wreckSeedFor` for that.
 *  - IT IS LOST ON A SECOND DEATH, never on a clock (D-S2-d2): dying again
 *    before recovery replaces the record, so the older loadout is gone.  A
 *    death with nothing worth leaving still destroys the old wreck — the rule
 *    is "second death", not "second wreck".
 *  - IT IS WRITTEN THE MOMENT THE SHIP FALLS, not when the player taps
 *    respawn: stripping at the tap would let a player who quits the app on the
 *    death screen keep the loadout they just lost.
 *  - It is a plain POI (non-drop INTERACTABLE, mass Infinity — the station's
 *    recipe), so the minimap and the off-screen arrow come free from the
 *    existing POI paths and the renderer needed nothing.  `found` from birth:
 *    the player knows where they died.
 *
 * Free functions taking `g: GameEngine`, like engine/roamers/*.
 */
import type { GameEngine } from './GameEngine';
import { EntityType, type GameEntity } from '../types';
import { MODULE_RESALE, moduleDef, WRECK_CONSTANTS } from '../constants';
import { descriptorForMapType, mapDescriptor } from './maps/MapDescriptors';
import { nextId } from './systems/IdAllocator';
import { wrapDeltaX, wrapDeltaY } from './toroidal';
import { modulePrice } from './outfitting';
import type { WreckRecord } from './save';

/** Modules a death takes: everything mounted that is not free.  The free Base
 *  Hull and Projector (cost 0) are what every ship restarts with, so a wreck
 *  holding a second copy would be a duplication. */
function leftBehind(slots: (string | null)[]): (string | null)[] {
  return slots.map((id) => (id !== null && (moduleDef(id)?.cost ?? 0) > 0 ? id : null));
}

/** Build the record for a ship that has just fallen, or null when nothing
 *  worth leaving was mounted.  Reads the CURRENT slots — call before the strip. */
export function makeWreckRecord(g: GameEngine): WreckRecord | null {
  const ship = leftBehind(g.shipSlots);
  const weapon = leftBehind(g.weaponSlots);
  if (!ship.some(Boolean) && !weapon.some(Boolean)) return null;
  const type = g.currentMap?.type;
  const id = type !== undefined ? descriptorForMapType(type)?.id : undefined;
  if (!id) return null; // a map with no descriptor (a DBG-only showcase) leaves no wreck
  return {
    arenaId: id,
    seed: g.arenaSeed,
    x: g.player.position.x,
    y: g.player.position.y,
    ship, weapon,
  };
}

/** The player has fallen: replace any outstanding wreck (D-S2-d2) and leave a
 *  new one for what was mounted.  Returns the new record (or null). */
export function leaveWreck(g: GameEngine): WreckRecord | null {
  removeWreckEntity(g);
  g.wreck = makeWreckRecord(g);
  spawnWreckEntity(g);
  return g.wreck;
}

/** The seed an arena load must use so its terrain matches the wreck's, or null. */
export function wreckSeedFor(g: GameEngine, mapId: string | undefined): number | null {
  const w = g.wreck;
  return w !== null && mapId !== undefined && w.arenaId === mapId && w.seed !== null ? w.seed : null;
}

function removeWreckEntity(g: GameEngine): void {
  if (g.wreckEntity) { g.wreckEntity.active = false; g.wreckEntity = null; }
}

/** Put the wreck in the loaded map if the record belongs to it.  Called after
 *  every map load and at the moment of death. */
export function spawnWreckEntity(g: GameEngine): void {
  removeWreckEntity(g);
  const w = g.wreck;
  const type = g.currentMap?.type;
  if (!w || type === undefined || descriptorForMapType(type)?.id !== w.arenaId) return;
  const e: GameEntity = {
    id: nextId('wreck'),
    type: EntityType.INTERACTABLE,
    position: { x: w.x, y: w.y },
    velocity: { x: 0, y: 0 },
    size: { x: WRECK_CONSTANTS.SIZE, y: WRECK_CONSTANTS.SIZE },
    rotation: 0,
    color: WRECK_CONSTANTS.COLOR,
    active: true,
    health: 1,
    maxHealth: 1,
    mass: Infinity,
    name: 'WRECK',
    isWreck: true,
    found: true,
  };
  g.currentMap.entities.push(e);
  g.wreckEntity = e;
}

/** One pass per sim step: recover the wreck when the hull reaches it. */
export function updateWreck(g: GameEngine): void {
  const e = g.wreckEntity;
  if (!e || !e.active || g.player.isExploding) return;
  const dx = wrapDeltaX(e.position.x, g.player.position.x);
  const dy = wrapDeltaY(e.position.y, g.player.position.y);
  const r = WRECK_CONSTANTS.RECOVER_RANGE;
  if (dx * dx + dy * dy <= r * r) recoverWreck(g);
}

/** Give the loadout back — TO CARGO ONLY (user call).  Recovery never installs
 *  anything: the player refits at a station, so a recovered ship is not
 *  silently rebuilt around them.  A module that finds cargo full pays its
 *  resale value instead, so a recovery never destroys anything.  `restored`
 *  stays in the result as 0 for callers that read it. */
export function recoverWreck(g: GameEngine): { restored: number; cargo: number; sold: number } {
  const w = g.wreck;
  const out = { restored: 0, cargo: 0, sold: 0 };
  if (!w) return out;
  const give = (slots: (string | null)[]) => {
    for (const id of slots) {
      if (id === null) continue;
      const def = moduleDef(id);
      if (!def) continue;
      const free = g.inventory.indexOf(null);
      if (free >= 0) { g.inventory[free] = id; out.cargo++; continue; }
      g.credits += Math.round(modulePrice(def.cost) * MODULE_RESALE.SELL_FRACTION);
      out.sold++;
    }
  };
  give(w.ship);
  give(w.weapon);
  removeWreckEntity(g);
  g.wreck = null;
  const n = out.cargo + out.sold;
  g.pushPlayerMessage(`WRECK RECOVERED — ${n} MODULE${n === 1 ? '' : 'S'} TO CARGO`, WRECK_CONSTANTS.COLOR);
  g.audio.play('pickup.salvage', { x: g.player.position.x, y: g.player.position.y });
  g.saveNow();
  return out;
}

/** Keep `wreckGuide` on the one contact that leads back to the wreck: the wreck
 *  itself when it is in this map, else the rift toward it (the hub's rift to the
 *  wreck's arena; from any other arena, its way home).  One pass per step. */
export function updateWreckGuide(g: GameEngine): void {
  if (g.wreckGuideEntity) { g.wreckGuideEntity.wreckGuide = false; g.wreckGuideEntity = null; }
  const w = g.wreck;
  if (!w || g.player.isExploding) return;
  let target: GameEntity | null = g.wreckEntity && g.wreckEntity.active ? g.wreckEntity : null;
  if (!target) {
    const inHub = mapDescriptor(w.arenaId)?.kind !== 'hub' && descriptorForMapType(g.currentMap?.type)?.kind === 'hub';
    for (const p of g.portals) {
      if (!p.active) continue;
      if (!inHub || p.portalTargetId === w.arenaId) { target = p; break; }
    }
  }
  if (target) { target.wreckGuide = true; g.wreckGuideEntity = target; }
}

/** Display name of the map a wreck lies in (the death summary). */
export function wreckMapName(w: WreckRecord): string {
  return mapDescriptor(w.arenaId)?.name ?? w.arenaId;
}

/** Count of modules a record holds. */
export function wreckModuleCount(w: WreckRecord): number {
  return w.ship.filter(Boolean).length + w.weapon.filter(Boolean).length;
}
