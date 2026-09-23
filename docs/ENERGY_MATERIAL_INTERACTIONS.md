# Energy and material interactions

Delivery remains in the existing projectile, collision and weapon systems. Blaster,
Burst, Shotgun, Seeker and Cannon retain their kinetic model. The existing Laser
(`BOUNCER`) carries thermal energy; Lightning carries electrical energy. Weapon
configuration and projectiles have an optional `energyType`; missing values remain
mechanical. No weapon was added or removed.

`energyMaterial.ts` defines the event, material lookup, tuning limits, thermal
strength and three fracture controls. `EnergySystem` owns sparse heated state and
bounded electrical events. Its host supplies spatial queries, damage, cloud
motion, and feedback. `GameEntity.material` optionally overrides the existing
variant-derived material, leaving an extension point for ships and structures.
Existing unconverted actors retain their shield, armor and direct-hit rules.

| Material | Mechanical | Thermal | Electrical |
| --- | --- | --- | --- |
| Rock | Existing localized kinetic fracture; chunky grains and momentum | Stored heat lowers boundary work, enabling kinetic follow-up | Small boundary effect; stops chains |
| Glass | More concentrated small fragments and outward impulse | Stress accumulates; failure starts after 0.35 s above threshold; fewer, quieter pieces | Very little boundary effect; stops chains |
| Metal | Strong existing boundaries, fewer large restrained fragments | Stored heat weakens boundaries; a local share passes to metal neighbours | Strong direct coupling and bounded arcs through metal and other conductors |
| Plastic | Existing dent, movement, elasticity and bonds | Rapid heating releases cohesion before heat-dependent structural separation | Insulating; stops electrical bolts and chains |
| Nebula | Ship contact and ordinary-shot pass-through preserved from main | Agitation/dispersion; hot mobile clouds resist cohesion | Local energization, motion and arcs; temporarily suppresses cohesion |

## Mechanics and fracture

The kinetic formulas, mass scale, projectile energy bank, collision solver, and
Voronoi polygon generator are unchanged. Heat reduces the work needed to break
existing boundaries; it does not replace them with a separate HP pool. Boring
also charges the heated material's reduced grain cost. Cooling restores resistance
to future work but never repairs boundaries that have already broken.

Profiles adjust three existing controls: site-count scale, impact concentration,
and release impulse. Mechanical glass uses 1.4 times the authored clamped site
count, metal 0.3 times, and rock/plastic retain their count. The absolute count is
bounded to 2–32. Thermal glass uses 0.4 times the authored count and 0.18 times the
release impulse. Seed generation, cell geometry, area accounting, and progressive
separation remain the existing implementation.

A thermal impact may replace a pristine, undamaged cached pattern. Once any
boundaries have absorbed damage, the pattern stays fixed: already visible cracks
remain the actual seams. Thus heating previously fractured glass gives quieter
release but preserves its existing fragment pattern. This is intentional.

## State and performance bounds

- Heat uses internal game units, capped at 100, with linear cooling of 2 units/s.
- Only heated entities update, with at most 512 tracked bodies. At capacity new
  thermal state is rejected; there are no untracked permanently hot objects.
- Negligible heat and dead bodies leave the active set; map/run changes clear it.
- Fracture and cloud-spawn hooks transfer each child's share of the remaining
  heat using remaining material area, conserving heat through repeated breaks;
  existing shatter/merge grace periods continue to apply.
- Metal conduction runs only on deposition: four neighbours within 100 world
  units, with transferred heat deducted from the source. It does not recurse.
- Electrical traversal is iterative, with a visited set, at most 12 targets
  including the first, three hops, two branches per node (three when charged), 150-unit hops, a
  360-unit radius from the origin, and 0.6 per-hop energy retention before
  conductivity. Insulators cannot forward a chain.
- Queries use the existing toroidal static/dynamic grids and stop after 256
  in-range candidate visits. Selection follows spatial bucket order, avoiding
  global scans and full-list sorts. Dense local scenes may omit eligible targets.
- Soft additive heat glows share the lighting system's cached falloff gradients
  and are drawn during the existing visible-entity render pass. Sparks,
  arcs, and the breathy nebula impact sound reuse the current feedback systems.

Nebula retains the authored cloud breakup for both ship contact and energy
dispersal, including its geometry-only Voronoi decomposition, fade, composition
and shard wake. It never gains solid boundary damage. Ordinary kinetic shots
pass through cloud tiles/shards as on main, leaving them for the ship to disturb.
Cloud grain controls are not overridden by the solid-material profiles.

## Deliberate limits

No continuous-beam solver, realistic thermodynamics, persistent charge simulation,
mining, economic changes, or actor conversion is included. Laser retains its
existing moving beam/ricochet delivery, and deposits heat using its existing
finite energy bank. Lightning's charged projectile retains its extra branch per
node; all propagation overrides remain capped by the global safety limits.
Electrical contact with ordinary actors retains their direct damage and
launches a material-aware chain without hitting the first actor twice.

Balance is qualitative. Coarse metal has fewer boundaries; its boundary strength
is compensated by the inverse square root of the site-count scale so making
larger fragments does not quietly weaken existing walls. Glass has more fracture
seams. Further tuning should
measure these outcomes together, not independently change a weapon multiplier.

The next iteration should playtest mixed material encounters and tune heat lifetime,
metal coarseness and conductor targeting before extending the same responses to
actor armor. That iteration is not part of this change.

## Validation and compatibility

The added tests exercise all fifteen material/energy paths, invalid input,
cooling/removal, delayed glass failure, heat conservation, softened boundaries,
plastic bond release, capped conduction, electrical cycles/ranges/branching,
projectile pooling, real Laser/Lightning contacts, fragment geometry and cloud
dispersal. Runtime rendering was inspected: mechanical glass produced fourteen
small scattered pieces versus four quieter thermal pieces; heat glows and
metal arcs were visible.

Existing fracture expectations now reflect coarser metal and finer glass. The
metal boring fixture pays the compensated boundary price. The ordinary-speed
terrain control uses 30 rather than 60: after coarse metal breakup, 60 can need
the live collision sweep, making a deliberately disabled sweep an invalid
early-out control. The high-speed tunnelling tests are unchanged; the adjusted
control passed five consecutive repetitions.
The wall-charge fixture also stops when a rebounding ship retreats behind its
launch point, preventing a later trip around the toroidal map from being counted
as a forward escape. Its assertions still require the live sweep to prevent
crossing untouched tiles.

The initial feature validation passed all 137 affected tests, including 16 new energy tests.
Type checking and production build pass (the existing large-bundle warning
remains). Full-suite comparison against untouched base `c59ddc8` reproduced
unrelated economy, docking, flashlight, lighting, scanner and viewport failures;
those systems were left outside this feature. The PR records exact run totals
and the final focused regression result rather than claiming a clean full suite.
An earlier focused run also had one randomized rock-fragment apparent-size
assertion fail (3.05px versus a requested value below 3px); it passed five
isolated repeats and the final suite. Sixty baseline repeats passed, so that
isolated result is disclosed without claiming it is a verified baseline failure.

## Playtest corrections

Electrical insulation now terminates the moving projectile as well as stopping
its chain; residual delivery energy cannot carry it through glass or plastic.
Plastic deposits twice the usual heat, releases cohesion at 12 heat units, and
separates at 6 + 0.5 × excess heat units of boundary work per second. The heat
cap still applies, and Blaster kinetic tuning is unchanged. A real single-beam
Laser contact now produces plastic separation within one second in the test.

The initial PR mistakenly made ordinary shots disperse nebula and routed energy
breakup to the older puff fan. Both paths are corrected. A deterministic
ship-contact and shard-wake snapshot from untouched main c59ddc8 verifies exact
parity for fragment sizes, velocities, spin, fade, mass and cooldowns.

Correction validation: 117 energy, cloud, deflection, weapon and fracture tests
passed. After the final cloud-path cleanup, all 27 energy/cloud tests passed
again. Type checking and the production builds used by these runs passed.

Heat presentation follow-up: the orange outline is replaced by a soft glow,
using the existing lighting gradient cache without another map scan or shadow
query. Cooling is reduced from 5 to 2 units/s (2.5 times the heat lifetime).
All 20 energy/contact tests, type checking and production build passed; the
glow was visually inspected in the running game.

Material surface and inheritance follow-up: heated solid tiles and shards now
receive an additive tint on their actual polygon, using the object's existing
material color. The surrounding halo uses the same color. The overlay works
on cached tiles and moving fragments without changing their base appearance.

Fragment transfer formerly multiplied each child's original-area fraction by
an already depleted heat balance. It now uses remaining area and remaining
heat together. Partial chips, full Voronoi breakup, legacy solid/cloud breakup,
legacy DropSystem debris and metal-composite decomposition carry their share.
Children enter the sparse cooling set and can pass heat to another generation.
The existing 512-body heat cap still applies.

Validation: 83 energy/fracture tests passed, followed by 22 focused checks
including successive generations, partial chips and legacy tile breakup.
Type checking and production build passed. Material-colored surfaces and
halos were inspected in the running game.
