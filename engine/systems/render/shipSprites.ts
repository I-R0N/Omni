/** PRE-RENDERED TILT SHEETS — the player hull as ART at each tilt pose,
 *  in place of the cos(tilt) squash that fakes foreshortening on one flat
 *  sprite (user call).
 *
 *  THE AXIS DECOMPOSITION IS THE WHOLE DESIGN, so it is worth stating
 *  before any of the code makes sense:
 *
 *   - YAW (the aim) is a rotation ABOUT THE VIEW AXIS.  It commutes with
 *     the orthographic projection — it IS an in-plane rotation of the
 *     image — so `ctx.rotate` reproduces it EXACTLY and no art is needed.
 *     Baking yaw into sprites would multiply every sheet by the number of
 *     headings and buy nothing but pixel-art crispness (and cost smooth
 *     aiming).  `yawSteps` exists for that deliberate trade; it is 0 by
 *     default and should stay there.
 *   - PITCH and ROLL are rotations about IN-PLANE axes.  They genuinely
 *     change the silhouette — depth rotates into view — and no 2D
 *     transform can produce them.  THAT is what the art is for.
 *
 *  So a sheet is a 2D grid over the TILT, and the tilt is stored in POLAR
 *  form because that is both how the sim computes it and how the reachable
 *  set is shaped:
 *
 *    theta = hypot(roll, pitch)   the tilt MAGNITUDE (how far over)
 *    psi   = atan2(pitch, roll)   the tilt AXIS AZIMUTH in the ship's own
 *                                 deck plane, measured from the NOSE (+x)
 *                                 toward the STARBOARD wing (+y)
 *
 *  A cell is therefore "rotate the model by `theta` about an axis lying in
 *  its deck plane at `psi` from the nose" — psi = 0 is a pure ROLL (about
 *  the nose, wings dip), psi = 90° is a pure PITCH (about the wing axis,
 *  nose dips).  `GameEngine.tickPlayerRoll` magnitude-clamps the tilt
 *  vector, so the reachable set is a DISC and a polar grid wastes no cells
 *  on corners that can never be drawn.
 *
 *  MIRRORING halves the art for a bilaterally symmetric hull.  Reflecting
 *  the ship across its nose axis maps a rotation about axis-azimuth psi to
 *  one about (180° - psi), so azimuths in [-90°, +90°] are AUTHORED and the
 *  rest are drawn with a flip about the nose line.  psi = ±90° (the two
 *  pure pitches) are the fixed points and are authored either way.  An
 *  asymmetric hull sets `mirrorRoll: false` and authors the full circle.
 *
 *  Cells snap to the NEAREST pose — deliberately, rather than cross-fading
 *  two cells.  A crossfade ghosts on a held lean, while a snap is only ever
 *  wrong by half a grid step in an angle the player has no reference for;
 *  the tilt spring crosses the whole range in ~0.3 s, so at a 15° ring step
 *  a lean plays ~20 distinct poses a second and reads as continuous.
 *
 *  A PARTIAL sheet is legal: an unloaded cell falls back to the nearest
 *  loaded one (and a sheet with nothing loaded falls back to the caller's
 *  legacy path), so art can be authored ring by ring and watched to
 *  improve.  Takes no engine and no renderer — the enemyShapes contract —
 *  and receives image lookup as a callback.
 *
 *  docs/SHIP_SPRITE_SHEETS.md is the authoring guide, and it is GENERATED
 *  from this module's own `enumerateCells` (scripts/gen-ship-sheet.mjs), so
 *  the table an artist works from cannot drift from the table the engine
 *  indexes.
 */

const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

/** The tilt sampling grid: concentric rings of tilt MAGNITUDE, each
 *  sampled at a number of AXIS AZIMUTHS.  Inner rings need fewer azimuths
 *  (at a shallow tilt the lean direction barely changes the silhouette —
 *  the shape error goes with sin(theta)), which is where most of the
 *  saving over a naive square grid comes from. */
export interface TiltGridSpec {
  /** Tilt magnitudes in RADIANS, ascending.  `rings[0]` must be 0 (the
   *  level pose).  The last ring is the clamp: a deeper tilt (a TUMBLE, or
   *  a spring overshoot) draws the outermost pose. */
  rings: number[];
  /** FULL-CIRCLE azimuth sample count per ring, parallel to `rings`.
   *  `azimuths[0]` must be 1 (a level ship has no lean direction); every
   *  other entry must be EVEN so the mirror pair lands on a sample. */
  azimuths: number[];
}

export interface ShipSpriteSheet {
  /** Stable id — the DBG readout and the generator's output folder. */
  id: string;
  grid: TiltGridSpec;
  /** Author only azimuths in [-90°, +90°] and flip for the rest.  Requires
   *  a hull symmetric about its nose axis, and `yawSteps === 0` (a flip
   *  about a baked-yaw nose line is not an axis-aligned flip, so it would
   *  reintroduce the resampling that baking yaw exists to avoid). */
  mirrorRoll: boolean;
  /** Radians to add to the facing so the ART's nose points along it.  New
   *  sheets should be authored NOSE-RIGHT (+x) so this is 0; the legacy
   *  `ship.png` points up-left, hence SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET. */
  artOffset: number;
  /** Draw size as a multiple of the entity's max dimension (the sprite
   *  path's own default is 1.5). */
  drawScale: number;
  /** Headings baked into the art.  0 (STRONGLY recommended) = the canvas
   *  rotates continuously, which is exact.  A positive value snaps the aim
   *  to that many headings — pixel-art crispness at the cost of a reticle
   *  that no longer agrees with the hull. */
  yawSteps: number;
  /** Packed delivery: one image, uniform cells, row-major in cell order. */
  sheet?: { src: string; columns: number; cellW: number; cellH: number };
  /** Loose delivery: one file per cell.  `{t}` = tilt degrees, `{a}` =
   *  azimuth degrees in 0..359, `{y}` = yaw degrees — each zero-padded to
   *  three digits.  Ignored when `sheet` is set. */
  cellPattern?: string;
}

/** One authored pose: everything an artist (or the generator) needs to
 *  produce the cell, and everything the loader needs to find it. */
export interface ShipCellSpec {
  index: number;
  /** Tilt magnitude, degrees. */
  thetaDeg: number;
  /** Tilt-axis azimuth from the nose, degrees, normalised to 0..359. */
  azimDeg: number;
  /** The same pose as the sim's own two components, degrees — this is what
   *  a 3D tool's pitch/roll fields take. */
  rollDeg: number;
  pitchDeg: number;
  /** Baked heading, degrees (always 0 while `yawSteps` is 0). */
  yawDeg: number;
  ring: number;
  azim: number;
  yaw: number;
  /** Resolved per-cell URL, or '' for a packed sheet. */
  file: string;
}

/** Where a live (roll, pitch, yaw) landed on the grid. */
export interface ShipCellRef {
  ring: number;
  azim: number;
  yaw: number;
  /** Draw flipped about the ship's nose axis. */
  mirror: boolean;
  index: number;
}

const pad3 = (n: number) => String(Math.round(n)).padStart(3, '0');

/** Stored azimuth samples for a ring: the full circle, or the mirrored
 *  half [-90°, +90°].  Sample k sits at psi = -90° + k * (360° / N), which
 *  is what puts BOTH mirror fixed points (±90°) on a sample. */
function storedAzimuths(count: number, mirror: boolean): number {
  if (count <= 1) return 1;
  return mirror ? count / 2 + 1 : count;
}

/** Every cell the sheet expects, in INDEX ORDER — yaw-major, then ring,
 *  then azimuth.  A packed sheet is read row-major in this order; loose
 *  files are named from it.  This is the single definition of the sheet
 *  contract: the loader, the tests and the authoring guide all read it. */
export function enumerateCells(sheet: ShipSpriteSheet): ShipCellSpec[] {
  const { rings, azimuths } = sheet.grid;
  const yawCount = Math.max(1, sheet.yawSteps);
  const mirror = sheet.mirrorRoll && sheet.yawSteps === 0;
  const out: ShipCellSpec[] = [];
  let index = 0;
  for (let y = 0; y < yawCount; y++) {
    const yawDeg = sheet.yawSteps > 0 ? (360 * y) / sheet.yawSteps : 0;
    for (let i = 0; i < rings.length; i++) {
      const thetaDeg = rings[i] * DEG;
      const n = azimuths[i];
      const stored = storedAzimuths(n, mirror);
      for (let k = 0; k < stored; k++) {
        // Ring 0 is the single level pose; its azimuth is meaningless, so
        // it is reported as 0 rather than the -90° that the formula would
        // otherwise give it.
        const psiDeg = n <= 1 ? 0 : -90 + (k * 360) / n;
        const psi = psiDeg / DEG;
        const theta = rings[i];
        const norm = ((psiDeg % 360) + 360) % 360;
        out.push({
          index,
          thetaDeg,
          azimDeg: norm,
          rollDeg: theta * Math.cos(psi) * DEG,
          pitchDeg: theta * Math.sin(psi) * DEG,
          yawDeg,
          ring: i,
          azim: k,
          yaw: y,
          file: sheet.cellPattern
            ? sheet.cellPattern
                .replace('{t}', pad3(thetaDeg))
                .replace('{a}', pad3(norm))
                .replace('{y}', pad3(yawDeg))
            : '',
        });
        index++;
      }
    }
  }
  return out;
}

/** Flat index of a (yaw, ring, azim) cell — the packed sheet's cell order
 *  and the lookup table's key.  Kept as arithmetic over the ring sizes
 *  rather than a search so the draw path stays O(1). */
export function cellIndex(sheet: ShipSpriteSheet, ring: number, azim: number, yaw: number): number {
  const { rings, azimuths } = sheet.grid;
  const mirror = sheet.mirrorRoll && sheet.yawSteps === 0;
  let perYaw = 0;
  for (let i = 0; i < rings.length; i++) perYaw += storedAzimuths(azimuths[i], mirror);
  let idx = yaw * perYaw;
  for (let i = 0; i < ring; i++) idx += storedAzimuths(azimuths[i], mirror);
  return idx + azim;
}

/** Snap a live tilt to its authored pose.
 *
 *  `roll` / `pitch` are `GameEntity.visualRoll` / `visualPitch` (radians);
 *  `yaw` is the facing, used only when the sheet bakes headings.  Tilt
 *  BEYOND the outermost ring clamps to it rather than wrapping — the same
 *  rule the legacy squash uses, and what keeps a TUMBLE (angles unbounded,
 *  wrapping at ±pi) from mirroring the hull. */
export function resolveTiltCell(
  sheet: ShipSpriteSheet, roll: number, pitch: number, yaw: number,
): ShipCellRef {
  const { rings, azimuths } = sheet.grid;
  const mirror = sheet.mirrorRoll && sheet.yawSteps === 0;

  const theta = Math.sqrt(roll * roll + pitch * pitch);
  // Nearest ring by absolute angle (not floor): a snap is only ever half a
  // step wrong either way.
  let ring = 0;
  let best = Infinity;
  for (let i = 0; i < rings.length; i++) {
    const d = Math.abs(theta - rings[i]);
    if (d < best) { best = d; ring = i; }
  }

  const n = azimuths[ring];
  let azim = 0;
  let flip = false;
  if (n > 1) {
    // Samples sit at psi_k = -90° + k * (360°/n).  Solve for k, wrap, then
    // fold the far half onto its mirror partner (k -> n - k), whose axis
    // azimuth is exactly 180° - psi_k.
    const psi = Math.atan2(pitch, roll);
    const step = TAU / n;
    let k = Math.round((psi + Math.PI / 2) / step);
    k = ((k % n) + n) % n;
    if (mirror && k > n / 2) { k = n - k; flip = true; }
    azim = k;
  }

  let yawIdx = 0;
  if (sheet.yawSteps > 0) {
    const step = TAU / sheet.yawSteps;
    yawIdx = ((Math.round(yaw / step) % sheet.yawSteps) + sheet.yawSteps) % sheet.yawSteps;
  }

  return { ring, azim, yaw: yawIdx, mirror: flip, index: cellIndex(sheet, ring, azim, yawIdx) };
}

/** A cell resolved to actual pixels: the source image plus the sub-rect to
 *  blit (the whole image, for loose per-cell files). */
export interface ShipCellImage {
  img: CanvasImageSource;
  sx: number; sy: number; sw: number; sh: number;
}

type GetImage = (src: string) => HTMLImageElement;

/** Per-sheet cell lookup + readiness, cached across frames.  Holds no
 *  pixels of its own: the images come from the caller's own image cache,
 *  so a sheet costs one array of specs and nothing else. */
export class ShipSheetCache {
  private specs: ShipCellSpec[];
  /** Latched once any cell loads — art never un-loads, so the readiness
   *  scan stops running every frame the moment it can succeed. */
  private _any = false;
  constructor(readonly sheet: ShipSpriteSheet) {
    this.specs = enumerateCells(sheet);
  }

  /** The pose list — what the generator renders and the guide tabulates. */
  cells(): ShipCellSpec[] { return this.specs; }

  /** Ask the image cache for every cell once, so nothing decodes inside a
   *  frame.  Cheap and idempotent: `getImage` memoises. */
  preload(getImage: GetImage) {
    if (this.sheet.sheet) { getImage(this.sheet.sheet.src); return; }
    for (const c of this.specs) if (c.file) getImage(c.file);
  }

  private ready(img: HTMLImageElement | undefined): boolean {
    return !!img && img.complete && img.naturalWidth > 0;
  }

  /** Pixels for one cell index, or null when that cell has no art yet. */
  imageFor(index: number, getImage: GetImage): ShipCellImage | null {
    const packed = this.sheet.sheet;
    if (packed) {
      const img = getImage(packed.src);
      if (!this.ready(img)) return null;
      const col = index % packed.columns;
      const row = Math.floor(index / packed.columns);
      // A short sheet is a partial sheet, not a broken one: a cell past the
      // last row simply has no art and falls back like any other.
      if ((row + 1) * packed.cellH > img.naturalHeight) return null;
      return { img, sx: col * packed.cellW, sy: row * packed.cellH, sw: packed.cellW, sh: packed.cellH };
    }
    const spec = this.specs[index];
    if (!spec || !spec.file) return null;
    const img = getImage(spec.file);
    if (!this.ready(img)) return null;
    return { img, sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
  }

  /** The resolved cell, or the NEAREST authored one — so a half-finished
   *  sheet degrades pose by pose instead of vanishing.  Distance is angular
   *  over the same (theta, psi) the resolver snaps in, and mirrored partners
   *  count as candidates, so filling one ring at a time works. */
  nearestImage(ref: ShipCellRef, getImage: GetImage): ShipCellImage | null {
    const direct = this.imageFor(ref.index, getImage);
    if (direct) return direct;
    const want = this.specs[ref.index];
    if (!want) return null;
    let best: ShipCellImage | null = null;
    let bestD = Infinity;
    for (const c of this.specs) {
      if (c.yaw !== want.yaw) continue;
      const dT = Math.abs(c.thetaDeg - want.thetaDeg);
      let dA = Math.abs(c.azimDeg - want.azimDeg) % 360;
      if (dA > 180) dA = 360 - dA;
      // Azimuth matters less the flatter the pose — the same weighting that
      // sets the ring azimuth counts in the first place.
      const d = dT + dA * Math.sin(Math.min(want.thetaDeg, 90) / DEG);
      if (d >= bestD) continue;
      const img = this.imageFor(c.index, getImage);
      if (!img) continue;
      best = img; bestD = d;
    }
    return best;
  }

  /** Whether ANY cell has art — the caller's cue to use this path at all
   *  rather than its legacy one. */
  anyReady(getImage: GetImage): boolean {
    if (this._any) return true;
    for (const c of this.specs) {
      if (this.imageFor(c.index, getImage)) { this._any = true; return true; }
    }
    return false;
  }
}

/** The local 2×2 (canvas [[a,c],[b,d]]) that orients a resolved cell.
 *
 *  Unmirrored this is the plain R(yaw + artOffset) every sprite uses.
 *  MIRRORED it is R(yaw) · diag(1,-1) · R(artOffset) — the flip has to
 *  happen about the SHIP's nose axis, between the facing and the art
 *  alignment, for the same reason the legacy squash sits there: it is the
 *  ship that is mirrored, not the sprite art's axes.  That product
 *  collapses to a reflection about the half-angle, which is why this is
 *  four trig calls and no matrix multiply.  With yaw BAKED the art already
 *  carries the heading, so only the art offset is left. */
export function cellMatrix(
  sheet: ShipSpriteSheet, ref: ShipCellRef, yaw: number,
): { l11: number; l12: number; l21: number; l22: number } {
  const facing = sheet.yawSteps > 0 ? 0 : yaw;
  if (!ref.mirror) {
    const a = facing + sheet.artOffset;
    const c = Math.cos(a), s = Math.sin(a);
    return { l11: c, l12: -s, l21: s, l22: c };
  }
  const u = facing - sheet.artOffset;
  const c = Math.cos(u), s = Math.sin(u);
  return { l11: c, l12: s, l21: s, l22: -c };
}
