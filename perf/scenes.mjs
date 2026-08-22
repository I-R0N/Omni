/** Capture-matrix scene definitions (gauntlet 5c, P1).
 *
 *  Each scene is a named, REPEATABLE recipe: pick a map, set the world up
 *  through the same debug handles the Playwright suites drive
 *  (`window.__omniEngine`, CLAUDE.md §8), then sample for a fixed window.
 *
 *  Two rules keep the matrix honest across runs and across branches:
 *
 *   1. `setup` runs ONCE before the sample window and must leave the world
 *      in the state the scene is named for.  Anything that has to happen
 *      DURING the window (a shatter storm, a mass-death frame) goes in
 *      `during`, which is called with the elapsed sample-window fraction so
 *      it can fire at a chosen moment.
 *   2. Randomness is the enemy of an A/B delta.  Every scene seeds
 *      `Math.random` through the page-side deterministic PRNG the driver
 *      installs before `setup`, so two runs of the same scene see the same
 *      world.  A scene that still needs to vary should say so in `notes`.
 *
 *  Scene bodies are stringified and evaluated in the page, so they may only
 *  reference their arguments — no imports, no closure over this module.
 */

/** Sample-window length in seconds of WALL time.  Deliberately wall and not
 *  sim time: we are measuring frames, and a frame is a wall-clock event. */
export const DEFAULT_WINDOW_SEC = 12;

/** The long-soak window (GC cadence / steady-state drift).  Its own constant
 *  because it is the one scene whose length is the point. */
export const SOAK_WINDOW_SEC = 300;

export const SCENES = [
  {
    id: 'hub-idle',
    map: 'OVERWORLD',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'Control. The wave-free hub with only ambient fauna — the floor every other scene is read against.',
    setup: (e) => { e.startGame(); },
  },

  {
    id: 'asteroid-6k',
    map: 'ASTEROID_FIELD',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'The shard-dense showcase: the reference case for the parked O(k^2) shard-pair cost.',
    setup: (e) => { e.startGame(); },
  },

  {
    id: 'tile-shatter-storm',
    map: 'GLASS_FIELD',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'Dense tile field, then repeated cannon-grade shatters into tight clusters — the PR #70 8k-entity spike shape.',
    setup: (e) => {
      e.startGame();
      e.debugOutfitAll();
    },
    // Shatter a tile cluster on a cadence so the window contains several
    // debris-burst frames rather than one lucky/unlucky moment.
    during: (e, frac, api) => {
      if (!api.everyMs(400)) return;
      api.shatterNearestTiles(24);
    },
  },

  {
    id: 'boss-capstone',
    map: 'UNIVERSE',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'A boss plus its escort mid-wave: aura ring, boss HUD bar, phase transitions, heavy projectile traffic.',
    setup: (e) => {
      e.startGame();
      e.debugOutfitAll();
      e.debugSpawnBoss('BOSS_WARDEN');
      e.debugSpawnBoss('BOSS_SIEGE');
    },
  },

  {
    id: 'roamer-stack',
    map: 'UNIVERSE',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'Stacked exotic roamers: 4 dragons (segment chains + tile eating) + 6 rivals + the ambient bubble population.',
    setup: (e) => {
      e.startGame();
      e.debugOutfitAll();
      for (let i = 0; i < 4; i++) e.debugSpawnDragon(['glass', 'rock', 'metal', 'mixed'][i]);
      for (let i = 0; i < 6; i++) e.debugSpawnRival(['hostile', 'ally', 'neutral'][i % 3]);
    },
  },

  {
    id: 'mass-death',
    map: 'UNIVERSE',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'The one-frame work burst: a large live enemy field wiped in a single frame (the snitch board-clear / capstone rout shape).',
    setup: (e) => {
      e.startGame();
      e.debugOutfitAll();
      // Build a big live field first; the rout happens inside the window.
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        e.waves.spawnAt(
          ['RAMMER_1', 'SHOOTER_1', 'RAMMER_2', 'SHOOTER_2', 'KAMIKAZE', 'SWARM'][i % 6],
          { x: e.player.position.x + Math.cos(a) * 700, y: e.player.position.y + Math.sin(a) * 700 },
          e.waveContext(),
          true,
        );
      }
    },
    during: (e, frac, api) => {
      // One rout, at the midpoint, so the burst frame lands inside the window.
      if (!api.once('rout', frac > 0.5)) return;
      api.routField();
    },
  },

  {
    id: 'stage-descent',
    map: 'UNIVERSE',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'Map-load transition. The ONE permitted long frame — what matters is the residue: substep pile-up and re-warm cost after it.',
    setup: (e) => { e.startGame(); },
    during: (e, frac, api) => {
      // Portal-travel on a cadence so the window holds several transitions
      // and the post-load frames of each are inside the sample.
      if (!api.everyMs(3000)) return;
      api.travel();
    },
  },

  // ── Lighting A/B (the shadow-casting light layer + the fog compositor) ──
  //
  // Three rungs of one ladder on the SAME map with the SAME seed, so the
  // deltas between them are the features' cost and nothing else.  GLASS_FIELD
  // because it is the worst case the lighting has: every tile is translucent
  // (occluder + transmission + caustic + emitter all at once), where rock
  // would exercise only the shadow half.  Read the `lit p99` / `fog p99`
  // columns — both are slices OF render, so the render column moves with them.

  {
    id: 'light-legacy',
    map: 'GLASS_FIELD',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'The lighting A/B floor: unified layer OFF (legacy renderer). lit/fog columns must read 0; the render column is the baseline the two scenes below are read against.',
    setup: (e) => {
      e.startGame();
      e.renderer.setLighting('legacy');
    },
  },

  {
    id: 'light-shipped',
    map: 'GLASS_FIELD',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'The SHIPPED lighting configuration, stated explicitly so a default change does not silently move this scene: unified, tier low, diffuse shadows, refraction + emission on, beam flashlight, emit shadows / tint mix / fog / depth all off.',
    setup: (e) => {
      e.startGame();
      e.renderer.setLighting('unified');
      for (let i = 0; i < 10 && e.renderer.getLightTier() !== 'low'; i++) e.renderer.cycleLightTier();
      for (let i = 0; i < 12 && e.renderer.getShadowSoftness() !== 'diffuse'; i++) e.renderer.cycleShadowSoftness();
      if (!e.renderer.getRefraction()) e.renderer.toggleRefraction();
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      if (e.renderer.getEmitShadows()) e.renderer.toggleEmitShadows();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'beam'; i++) e.renderer.cycleFlashlight();
      for (let i = 0; i < 8 && e.renderer.getTintMix() !== 'off'; i++) e.renderer.cycleTintMix();
      for (let i = 0; i < 8 && e.renderer.getFog() !== 'off'; i++) e.renderer.cycleFog();
    },
  },

  {
    id: 'light-max',
    map: 'GLASS_FIELD',
    windowSec: DEFAULT_WINDOW_SEC,
    notes: 'Everything the lighting can spend at once: shipped config plus emit shadows, three-layer memory fog, radial light (no beam cull), full tint mix — the ceiling a settings screen could reach, not a shipped state.',
    setup: (e) => {
      e.startGame();
      e.renderer.setLighting('unified');
      for (let i = 0; i < 10 && e.renderer.getLightTier() !== 'low'; i++) e.renderer.cycleLightTier();
      if (!e.renderer.getRefraction()) e.renderer.toggleRefraction();
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      if (!e.renderer.getEmitShadows()) e.renderer.toggleEmitShadows();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) e.renderer.cycleFlashlight();
      for (let i = 0; i < 8 && e.renderer.getTintMix() !== 'full'; i++) e.renderer.cycleTintMix();
      for (let i = 0; i < 8 && e.renderer.getFog() !== 'memory'; i++) e.renderer.cycleFog();
    },
  },

  {
    id: 'soak',
    map: 'UNIVERSE',
    windowSec: SOAK_WINDOW_SEC,
    notes: 'Long-soak steady state: GC cadence and heap drift, not peak compute. Waves run themselves.',
    setup: (e) => {
      e.startGame();
      e.debugOutfitAll();
    },
  },
];

export const SCENE_IDS = SCENES.map(s => s.id);

export function sceneById(id) {
  const s = SCENES.find(x => x.id === id);
  if (!s) throw new Error(`unknown scene "${id}" (have: ${SCENE_IDS.join(', ')})`);
  return s;
}
