# Ship tilt sheets — the authoring guide

**How many sprites does a ship need, and at what angles?**
**35** for a bilaterally symmetric hull. The table at the bottom is the
complete list, and it is generated from the same code the engine indexes
cells by (`node scripts/gen-ship-sheet.mjs --table`), so it cannot drift
from what the game actually looks up.

---

## 1. The one thing to read before making art

The ship rotates in **three** axes, and they are not equal.

**Yaw — the aim — needs no sprites.** A top-down view looks straight down
the yaw axis, so yawing is a rotation *about the view direction*: it
commutes with the projection and is, exactly, an in-plane rotation of the
image. `ctx.rotate()` reproduces it with zero error. Baking 24 headings
into the sheet would multiply every ship by 24 (35 → 840 cells) and buy
nothing except pixel-art crispness — while *costing* smooth aiming, since
the hull would snap to 15° while the reticle and the shots stay continuous.

**Pitch and roll do need sprites.** They are rotations about axes *lying in
the screen plane*. They rotate depth into view and genuinely change the
silhouette, and no 2D transform can produce that. Today they are faked with
a `cos(tilt)` horizontal squash, which is why the ship reads as a flattening
sticker rather than a banking hull. That is the gap this art fills.

So: **the sheet is a grid over the tilt only, and yaw stays free.**

## 2. How a pose is specified

A tilt is stored in polar form, because that is both how the sim computes it
and how the reachable set is shaped:

| | meaning |
|---|---|
| **θ** (theta) | tilt **magnitude** — how far the hull is leaned over |
| **ψ** (psi) | tilt **axis azimuth** — measured in the ship's own deck plane, from the **nose** toward the **starboard wing** |

A cell is: *rotate the model by **θ** about an axis lying in its deck plane,
pointing **ψ** away from the nose.*

- **ψ = 0°** → axis is the nose → a pure **roll** (wings dip)
- **ψ = 90°** → axis is the wing line → a pure **pitch** (nose dips)
- **ψ = 270°** → pure pitch the other way (nose rises)

If your tool takes pitch/roll instead of axis-angle, the table gives both —
they are just `roll = θ·cos ψ`, `pitch = θ·sin ψ`.

The engine clamps the tilt *vector*, so reachable poses form a **disc**, not
a square. A polar grid spends no cells on corners that can never be drawn.

## 3. Why 35, and where the number comes from

**Rings every 15°, out to 90°.** Snapping to the nearest pose moves the
silhouette by about `R·sin(θ)·step/2` — roughly 2px on a 48px hull at the
worst angle with a 15° step. Invisible in motion. At 30° it reads as
popping. 90° is past the sim's own ceiling (`MAX_TILT` ≈ 83°, itself only
reachable as a spring overshoot on the Deep preset), so the outer ring is
headroom.

**Azimuths grow with the ring.** The lean *direction* only matters in
proportion to `sin θ`: at 15° over, all lean directions look nearly alike;
at 75° they do not. Sampling every ring at the outer rate would nearly
double the art for poses nobody can tell apart.

**Mirroring halves it.** Reflecting a hull across its nose axis maps a
rotation about azimuth ψ to one about `180° − ψ`. So azimuths in
**[−90°, +90°]** are authored and the rest are drawn flipped. The two pure
pitches (ψ = ±90°) are the fixed points and are authored either way.

| ring θ | azimuths sampled | authored (mirrored) |
|---|---|---|
| 0° | 1 | 1 |
| 15° | 4 | 3 |
| 30° | 8 | 5 |
| 45° | 8 | 5 |
| 60° | 12 | 7 |
| 75° | 12 | 7 |
| 90° | 12 | 7 |
| | | **35** |

**An asymmetric hull** (one wing different, off-centre canopy) sets
`mirrorRoll: false` and authors the full circle: **57 cells**.

**Blocking in a new design?** `SHIP_TILT_GRID_COARSE` is 30° rings and
**15 cells**. Poses pop on a slow lean, so it is a stepping stone, not a
shipping target.

## 4. Rules the art must follow

1. **Square cells, all identical in size.** Any resolution; the engine
   scales to the entity.
2. **The pivot sits at the exact cell centre, in every cell.** This is the
   one that bites: the pivot is the point the ship rotates and orbits about,
   so if it wanders between cells the ship jitters as it leans. Do not crop
   to the ink — keep the frame fixed and let the ship move inside it.
3. **Size the cell for the *largest* projection**, not the level pose. A
   hull with depth (a dorsal fin, a raised canopy) sweeps *wider* when
   tilted. Pick the cell size once, from the widest pose, and pad the rest.
4. **Author nose-right (+x).** New sheets set `artOffset: 0`. The legacy
   `ship.png` points up-left, which is what
   `SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET` exists for; don't inherit it.
5. **Transparent background.** The hull is composited over the world.
6. **Consistent scale and lighting across cells.** The engine cross-fades
   nothing — it cuts between poses — so a cell that is 5% larger than its
   neighbour reads as a pulse.
7. **Only author ψ ∈ [−90°, +90°]** when `mirrorRoll` is true. Authoring the
   far half too is harmless (those files are simply never requested), but it
   is wasted work.

## 5. Delivering the files

**Loose files (default).** One PNG per cell, named for its own angles:

```
public/assets/ships/<id>/tilt_t{θ}_a{ψ}.png     e.g. tilt_t045_a315.png
```

θ and ψ are zero-padded to three digits, ψ normalised to 0–359. The name
carries the angle, so a mis-delivered file is visible rather than silent.

**Packed sheet.** Set a `sheet` block instead of `cellPattern`:

```ts
sheet: { src: '/assets/ships/<id>/tilt.png', columns: 6, cellW: 128, cellH: 128 }
```

Cells are read **row-major in the `#` order of the table below**.

**Partial sheets are legal and useful.** A missing cell falls back to the
nearest authored pose, and a sheet with nothing loaded falls back to the old
squash. So you can ship the level pose plus one ring, see it in the game,
and fill in from there — the ship never disappears.

## 6. Registering a ship

One row in `assets.ts`, no draw-path change:

```ts
export const SHIP_SHEET_INTERCEPTOR: ShipSpriteSheet = {
  id: 'interceptor',
  grid: SHIP_TILT_GRID_STANDARD,
  mirrorRoll: true,      // false for an asymmetric hull -> 57 cells
  artOffset: 0,          // author nose-right
  drawScale: 1.5,        // draw size as a multiple of the entity size
  yawSteps: 0,           // 0 = canvas rotation. See §1 before changing.
  cellPattern: '/assets/ships/interceptor/tilt_t{t}_a{a}.png',
};
```

Then add it to `SHIP_SHEETS`. Select the mode in game at
**pause ▸ Debug Menu ▸ Player ▸ "Hull" ▸ Sheet**.

## 7. Placeholder art, and checking your own

```
npm run build
node scripts/gen-ship-sheet.mjs --placeholder    # 35 stand-in cells
node scripts/gen-ship-sheet.mjs --table          # this table, regenerated
```

`--placeholder` renders every pose from the wireframe dart hull into
`public/assets/ships/base/`. That set ships with the repo so the path is
exercised in CI; **delete the folder** to fall back to the legacy squash, or
overwrite the files one at a time as real art lands.

## 8. If you *do* want yaw sprites

`yawSteps: N` bakes N headings, multiplying the cell count by N (35 → 840 at
N = 24). Two consequences, both real: the aim **snaps** to N headings while
the reticle and projectiles stay continuous, and `mirrorRoll` must be
`false` (a flip about a baked-yaw nose line is not an axis-aligned flip, so
it would reintroduce the resampling that baking yaw exists to avoid). Worth
it for pixel art that must never be resampled; not otherwise.

---

## The 35 cells

`roll` and `pitch` are the same pose expressed for a tool with pitch/roll
fields. Regenerate with `node scripts/gen-ship-sheet.mjs --table`.

| # | tilt θ | axis ψ | roll | pitch | file |
|---|---|---|---|---|---|
| 0 | 0° | 0° | 0.0° | 0.0° | `tilt_t000_a000.png` |
| 1 | 15° | 270° | 0.0° | -15.0° | `tilt_t015_a270.png` |
| 2 | 15° | 0° | 15.0° | 0.0° | `tilt_t015_a000.png` |
| 3 | 15° | 90° | 0.0° | 15.0° | `tilt_t015_a090.png` |
| 4 | 30° | 270° | 0.0° | -30.0° | `tilt_t030_a270.png` |
| 5 | 30° | 315° | 21.2° | -21.2° | `tilt_t030_a315.png` |
| 6 | 30° | 0° | 30.0° | 0.0° | `tilt_t030_a000.png` |
| 7 | 30° | 45° | 21.2° | 21.2° | `tilt_t030_a045.png` |
| 8 | 30° | 90° | 0.0° | 30.0° | `tilt_t030_a090.png` |
| 9 | 45° | 270° | 0.0° | -45.0° | `tilt_t045_a270.png` |
| 10 | 45° | 315° | 31.8° | -31.8° | `tilt_t045_a315.png` |
| 11 | 45° | 0° | 45.0° | 0.0° | `tilt_t045_a000.png` |
| 12 | 45° | 45° | 31.8° | 31.8° | `tilt_t045_a045.png` |
| 13 | 45° | 90° | 0.0° | 45.0° | `tilt_t045_a090.png` |
| 14 | 60° | 270° | 0.0° | -60.0° | `tilt_t060_a270.png` |
| 15 | 60° | 300° | 30.0° | -52.0° | `tilt_t060_a300.png` |
| 16 | 60° | 330° | 52.0° | -30.0° | `tilt_t060_a330.png` |
| 17 | 60° | 0° | 60.0° | 0.0° | `tilt_t060_a000.png` |
| 18 | 60° | 30° | 52.0° | 30.0° | `tilt_t060_a030.png` |
| 19 | 60° | 60° | 30.0° | 52.0° | `tilt_t060_a060.png` |
| 20 | 60° | 90° | 0.0° | 60.0° | `tilt_t060_a090.png` |
| 21 | 75° | 270° | 0.0° | -75.0° | `tilt_t075_a270.png` |
| 22 | 75° | 300° | 37.5° | -65.0° | `tilt_t075_a300.png` |
| 23 | 75° | 330° | 65.0° | -37.5° | `tilt_t075_a330.png` |
| 24 | 75° | 0° | 75.0° | 0.0° | `tilt_t075_a000.png` |
| 25 | 75° | 30° | 65.0° | 37.5° | `tilt_t075_a030.png` |
| 26 | 75° | 60° | 37.5° | 65.0° | `tilt_t075_a060.png` |
| 27 | 75° | 90° | 0.0° | 75.0° | `tilt_t075_a090.png` |
| 28 | 90° | 270° | 0.0° | -90.0° | `tilt_t090_a270.png` |
| 29 | 90° | 300° | 45.0° | -77.9° | `tilt_t090_a300.png` |
| 30 | 90° | 330° | 77.9° | -45.0° | `tilt_t090_a330.png` |
| 31 | 90° | 0° | 90.0° | 0.0° | `tilt_t090_a000.png` |
| 32 | 90° | 30° | 77.9° | 45.0° | `tilt_t090_a030.png` |
| 33 | 90° | 60° | 45.0° | 77.9° | `tilt_t090_a060.png` |
| 34 | 90° | 90° | 0.0° | 90.0° | `tilt_t090_a090.png` |

