/**
 * arenaWaves.ts — WHAT AN ARENA REMEMBERS OF ITS WAVES (user call, S2 follow-up).
 *
 * Wave progress used to be fresh on every entry (`WaveSystem.init` zeroes it),
 * so an accidental exit threw the fight away.  Now, whenever the player is in an
 * arena the engine keeps `g.arenaWaves[arenaId]` = the wave, how many of its
 * enemies were already down, and the wall-clock time the player was last there:
 *
 *   within GRACE_SEC (5 min)  — the wave comes back exactly: same wave, same
 *                               kills already scored (the live enemies are not
 *                               restored; the stream carries on from there);
 *   after that                — the wave starts over from its top;
 *   and every DECAY_SEC (1 h) — starts over one wave earlier.
 *
 * "Leaving" is the last moment the player was there, stamped by every save
 * while in the arena and just before any map unloads (portal, respawn, quit), so
 * a portal, quitting the app and an OS kill all read the same.  A finished
 * ladder (boss dead) is forgotten.  Only the WAVE SCRIPT is remembered — not the
 * arena's world, which stays S6's (a wreck still pins its arena's seed, D-S2-d1).
 *
 * The one epoch read is `Clock.wallMs()`; the sim step never reads it.
 */
import type { GameEngine } from './GameEngine';
import { ARENA_WAVE_MEMORY } from '../constants';
import { clock } from './ports';

function currentArenaId(g: GameEngine): string | null {
  const d = g.currentDescriptor();
  return d && d.kind === 'arena' && d.wavesEnabled ? d.id : null;
}

/** Remember the wave the player is in the middle of, or forget it if the
 *  ladder is finished.  Cheap; called from every save and every map unload. */
export function stampArenaWave(g: GameEngine): void {
  const id = currentArenaId(g);
  if (id === null || g.player.isExploding || g.dropArenaStamp) return;
  const w = g.waves;
  if (w.halted) {
    const bossAlive = g.currentMap.entities.some((e) => e.isBoss === true && e.active);
    if (bossAlive) g.arenaWaves[id] = { wave: w.waveIndex, progress: 0, leftAt: clock().wallMs() };
    else delete g.arenaWaves[id]; // the ladder is finished
    return;
  }
  if (w.waveState === 'active') {
    g.arenaWaves[id] = { wave: w.waveIndex, progress: w.progressDone(g.currentMap.entities), leftAt: clock().wallMs() };
  } else if (w.waveState === 'cleared') {
    g.arenaWaves[id] = { wave: w.waveIndex + 1, progress: 0, leftAt: clock().wallMs() };
  }
}

/** The arena's ladder is over (its boss fell): nothing to come back to. */
export function clearArenaWave(g: GameEngine): void {
  const id = currentArenaId(g);
  if (id !== null) delete g.arenaWaves[id];
}

/** Where a wave script starts on entering `mapId`. */
export function arenaWaveFor(g: GameEngine, mapId: string | undefined): { wave: number; progress: number } {
  const m = mapId === undefined ? undefined : g.arenaWaves[mapId];
  if (!m) return { wave: 0, progress: 0 };
  // A clock set backwards reads as no time away, so it can only be generous.
  const away = Math.max(0, (clock().wallMs() - m.leftAt) / 1000);
  if (away <= ARENA_WAVE_MEMORY.GRACE_SEC) return { wave: m.wave, progress: m.progress };
  return { wave: Math.max(0, m.wave - Math.floor(away / ARENA_WAVE_MEMORY.DECAY_SEC)), progress: 0 };
}
