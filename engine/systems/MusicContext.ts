/**
 * MUSIC CONTEXT — where the player IS, as a handful of tags the adaptive
 * score's director picks layer VARIANTS from (AdaptiveMusic, docs/MUSIC_PIPELINE.md).
 *
 * The tags are the contract the music is composed against:
 *
 *   station     within `MUSIC_STATION_*` screens of a space station
 *   portal      within `MUSIC_PORTAL_*` screens of a portal / rift
 *   rare-item   within `MUSIC_RARE_*` screens of a high-value pickup: a salvage
 *               drop carrying at least `MUSIC_RARE_DROP_VALUE` units (merged
 *               drops sum their value, so this is a FAT pile — a snitch-catch
 *               spray, a boss payout), the golden SNITCH, or any POI that
 *               declares a `poiTier` at the scanner's rare rung or above
 *   danger      within `MUSIC_DANGER_*` screens of something that hurts and is
 *               not an engaged fight: a body hot enough to burn a hull
 *               (`HOT_BREAK_HEAT`), a charged body that arcs to ships
 *               (`energizedUntil`), or a dragon (a mini-boss that is passive
 *               until provoked — the game's one "high-threat area")
 *   deep-space  none of the above for `MUSIC_DEEP_SPACE_DWELL_SEC`
 *
 * Radii are in SCREENS (`GameEngine.viewportHalfDiagonal`), like every other
 * `MUSIC_*` radius, with HYSTERESIS: a context is entered at its ENTER radius
 * and only left past its wider LEAVE radius.  `warm` lists the contexts within
 * `MUSIC_PREFETCH_MULT` × their enter radius, which is what the director
 * pre-decodes variants for.
 *
 * This is a plain class over arrays the engine already owns: it allocates
 * nothing per frame, and the engine hands it the lists rather than itself, so
 * the tag logic has no engine dependency.
 */
import { AUDIO_CONSTANTS, DETECT_TIER } from '../../constants';
import { HOT_BREAK_HEAT } from './energy';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';
import type { GameEntity } from '../../types';

export const CONTEXT_TAGS = ['danger', 'rare-item', 'station', 'portal', 'deep-space'] as const;

export interface MusicContextInputs {
  px: number; py: number;
  /** `GameEngine.viewportHalfDiagonal()` — one SCREEN, in world units. */
  screens: number;
  /** `GameEngine.simClock` — monotonic sim seconds. */
  now: number;
  stations: readonly GameEntity[];
  portals: readonly GameEntity[];
  drops: readonly GameEntity[];
  snitch: GameEntity | null;
  dragons: readonly { head: GameEntity }[];
  heated: readonly GameEntity[];
  energized: readonly GameEntity[];
}

const C = AUDIO_CONSTANTS;

const d2To = (px: number, py: number, e: GameEntity): number => {
  const dx = wrapDeltaX(px, e.position.x), dy = wrapDeltaY(py, e.position.y);
  return dx * dx + dy * dy;
};

const nearest2 = (px: number, py: number, list: readonly GameEntity[], from = Infinity): number => {
  let best = from;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const dx = wrapDeltaX(px, e.position.x), dy = wrapDeltaY(py, e.position.y);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return best;
};

export class MusicContextTracker {
  /** Active tags this frame (rebuilt in place). */
  readonly tags: string[] = [];
  /** Contexts close to triggering (inside the prefetch radius). */
  readonly warm: string[] = [];
  private on = { station: false, portal: false, rare: false, danger: false };
  private quietSince = -1;
  private deep = false;

  /** A new map: every context is measured against entities that are gone. */
  reset() {
    this.on.station = this.on.portal = this.on.rare = this.on.danger = false;
    this.quietSince = -1;
    this.deep = false;
    this.tags.length = 0;
    this.warm.length = 0;
  }

  update(i: MusicContextInputs) {
    const { px, py, screens, now } = i;
    const S = screens * screens;
    const dStation = nearest2(px, py, i.stations);
    const dPortal = nearest2(px, py, i.portals);

    let dRare = Infinity;
    const drops = i.drops;
    for (let k = 0; k < drops.length; k++) {
      const d = drops[k];
      if ((d.dropValue ?? 0) < C.MUSIC_RARE_DROP_VALUE || d.dropType !== 'salvage') continue;
      const dx = wrapDeltaX(px, d.position.x), dy = wrapDeltaY(py, d.position.y);
      const d2 = dx * dx + dy * dy;
      if (d2 < dRare) dRare = d2;
    }
    if (i.snitch && i.snitch.active) dRare = Math.min(dRare, d2To(px, py, i.snitch));
    // A POI that declared itself rare (none ship yet — the seam the scanner's
    // POI rungs already use).
    for (let k = 0; k < i.stations.length; k++) {
      const s = i.stations[k];
      if ((s.poiTier ?? 0) >= DETECT_TIER.POI_RARE) dRare = Math.min(dRare, d2To(px, py, s));
    }
    for (let k = 0; k < i.portals.length; k++) {
      const s = i.portals[k];
      if ((s.poiTier ?? 0) >= DETECT_TIER.POI_RARE) dRare = Math.min(dRare, d2To(px, py, s));
    }

    let dDanger = Infinity;
    for (let k = 0; k < i.heated.length; k++) {
      const e = i.heated[k];
      if ((e.heat ?? 0) < HOT_BREAK_HEAT) continue;
      const dx = wrapDeltaX(px, e.position.x), dy = wrapDeltaY(py, e.position.y);
      const d2 = dx * dx + dy * dy;
      if (d2 < dDanger) dDanger = d2;
    }
    for (let k = 0; k < i.energized.length; k++) {
      const e = i.energized[k];
      if (!e.active || (e.energizedUntil ?? 0) <= now) continue;
      const dx = wrapDeltaX(px, e.position.x), dy = wrapDeltaY(py, e.position.y);
      const d2 = dx * dx + dy * dy;
      if (d2 < dDanger) dDanger = d2;
    }
    for (let k = 0; k < i.dragons.length; k++) {
      const h = i.dragons[k].head;
      if (!h.active || h.isExploding) continue;
      dDanger = Math.min(dDanger, d2To(px, py, h));
    }

    const o = this.on;
    const within = (d2: number, enter: number, leave: number, was: boolean) =>
      d2 <= (was ? leave : enter) * (was ? leave : enter) * S;
    o.station = within(dStation, C.MUSIC_STATION_ENTER_SCREENS, C.MUSIC_STATION_LEAVE_SCREENS, o.station);
    o.portal = within(dPortal, C.MUSIC_PORTAL_ENTER_SCREENS, C.MUSIC_PORTAL_LEAVE_SCREENS, o.portal);
    o.rare = within(dRare, C.MUSIC_RARE_ENTER_SCREENS, C.MUSIC_RARE_LEAVE_SCREENS, o.rare);
    o.danger = within(dDanger, C.MUSIC_DANGER_ENTER_SCREENS, C.MUSIC_DANGER_LEAVE_SCREENS, o.danger);

    // DEEP SPACE is the absence of the rest, held for the dwell.  It is left
    // the instant anything else is entered.
    const quiet = !o.station && !o.portal && !o.rare && !o.danger;
    if (quiet) {
      if (this.quietSince < 0) this.quietSince = now;
      this.deep = now - this.quietSince >= C.MUSIC_DEEP_SPACE_DWELL_SEC;
    } else { this.quietSince = -1; this.deep = false; }

    let n = 0;
    const T = this.tags;
    if (o.danger) T[n++] = 'danger';
    if (o.rare) T[n++] = 'rare-item';
    if (o.station) T[n++] = 'station';
    if (o.portal) T[n++] = 'portal';
    if (this.deep) T[n++] = 'deep-space';
    if (T.length !== n) T.length = n;

    const pm = C.MUSIC_PREFETCH_MULT;
    const near = (d2: number, enter: number) => d2 <= enter * pm * enter * pm * S;
    n = 0;
    const W = this.warm;
    if (near(dDanger, C.MUSIC_DANGER_ENTER_SCREENS)) W[n++] = 'danger';
    if (near(dRare, C.MUSIC_RARE_ENTER_SCREENS)) W[n++] = 'rare-item';
    if (near(dStation, C.MUSIC_STATION_ENTER_SCREENS)) W[n++] = 'station';
    if (near(dPortal, C.MUSIC_PORTAL_ENTER_SCREENS)) W[n++] = 'portal';
    if (quiet) W[n++] = 'deep-space';
    if (W.length !== n) W.length = n;
  }
}
