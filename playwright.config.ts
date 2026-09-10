import { defineConfig, devices } from '@playwright/test';

/** Playwright config for the Omni smoke suites (roadmap 5b, decision #46a).
 *
 *  The suites drive the REAL engine in a REAL browser through the
 *  `window.__omniEngine` / `window.__omniStats` debug handles (CLAUDE.md §8),
 *  which exist for exactly this and cost nothing per frame.  Nothing here
 *  stubs the sim.
 *
 *  `webServer` BUILDS and then previews, every run.  That is deliberate:
 *  `vite preview` serves `dist/`, and a stale `dist/` is how a prior session
 *  got a false pass out of a suite that was testing week-old code.  Building
 *  is the price of `npm test` meaning "test what is in the working tree".
 *
 *  Viewport is 390×844 — the phone this game is played on, and the size every
 *  layout assertion in the suites is written against.  (Parameterising the
 *  suites over more viewports is roadmap 5d, not this session.)
 */
export default defineConfig({
  testDir: './tests',
  // The sim runs on a fixed timestep and this container renders canvas in
  // software, so sim-seconds elapse slower than wall-clock seconds.  Tests
  // that advance the world need real room.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One worker: several suites drive a single shared idea of "the game", and
  // software canvas rendering under contention is where the flakes live.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
    ...devices['Desktop Chrome'],
    // devices spreads its own viewport — re-apply ours after it.
    // (Object spread order matters; keep this line last.)
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'phone-390',
      use: { viewport: { width: 390, height: 844 }, isMobile: false },
    },
  ],

  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
