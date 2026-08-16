/** Phase 1 self-validation + Phase 2 attribution probe for the React cost.
 *
 *  TEMPORARY SCAFFOLDING (gauntlet: react-reconciliation-cost).  Not part of
 *  `npm test`, not a merge gate.  Delete with the rest of the Phase 2
 *  scaffolding.
 *
 *  Same caveat as capture.mjs and for the same reason: this container
 *  rasterizes canvas in SOFTWARE, so frame-time LEVELS here are not the
 *  device's.  Unlike canvas, though, React reconciliation is pure JS on the
 *  main thread — no rasterization involved — so `uiActualMs` levels are far
 *  more transferable than `renderMs` levels are.  They are still a desktop
 *  container's CPU, not a phone's; treat them as an upper bound on the shape
 *  of the answer and a lower bound on the magnitude, and let the operator's
 *  on-device Perf REC captures settle the levels.
 *
 *  Usage:
 *    node perf/uiprobe.mjs --mode validate    # Phase 1 gate (ballast sweep)
 *    node perf/uiprobe.mjs --mode attribute   # Phase 2 states x HUD rates
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const mode = flag('mode', 'validate');
const SAMPLE_MS = Number(flag('ms', 6000));
const REPEATS = Number(flag('repeat', 3));

// ── server plumbing (lifted from capture.mjs) ──────────────────────────────
const up = () => new Promise((res) => {
  const s = connect(PORT, '127.0.0.1');
  s.on('connect', () => { s.end(); res(true); });
  s.on('error', () => res(false));
});

async function ensureServer() {
  if (await up()) return null;
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await up()) return p;
  }
  throw new Error('preview server did not come up');
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const r2 = (x) => x.toFixed(2);

/** Collect per-frame (uiActualMs, uiBaseMs, uiCommits, uiScheduleMs, frameMs)
 *  by sampling the engine's own snapshot on every rAF. */
const COLLECT = (ms) => new Promise((resolve) => {
  const out = { ui: [], base: [], sched: [], commits: [], frame: [] };
  // Tap the profiler feed directly rather than reading __omniStats: the stats
  // payload is only published on frames that PUSH, so at a throttled HUD rate
  // reading it would sample the very frames we most need to see as zero.
  const e = window.__omniEngine;
  const realNote = e.noteUiRender.bind(e);
  let ui = 0, base = 0, commits = 0;
  e.noteUiRender = (a, b) => { ui += a; base += b; commits++; realNote(a, b); };
  let last = performance.now();
  const t0 = last;
  const tick = () => {
    const now = performance.now();
    const dt = now - last; last = now;
    if (now - t0 > 500) {              // discard the first 500ms as warmup
      out.ui.push(ui);
      out.base.push(base);
      out.commits.push(commits);
      out.frame.push(dt);
      out.sched.push(window.__omniStats?.perf?.uiScheduleMs ?? 0);
    }
    ui = 0; base = 0; commits = 0;
    if (now - t0 < ms) requestAnimationFrame(tick);
    else { e.noteUiRender = realNote; resolve(out); }
  };
  requestAnimationFrame(tick);
});

function summarize(o) {
  // Frames that committed vs. all frames.  Both matter: per-COMMIT cost is
  // what a fix has to shrink, per-FRAME cost is what the budget actually pays.
  const committed = o.ui.filter((_, i) => o.commits[i] > 0);
  return {
    frames: o.ui.length,
    commitRate: o.commits.length ? o.commits.filter(c => c > 0).length / o.commits.length : 0,
    uiMed: median(o.ui), uiP95: pct(o.ui, 0.95),
    uiCommitMed: median(committed), uiCommitP95: pct(committed, 0.95),
    baseMed: median(o.base), baseP95: pct(o.base, 0.95),
    schedMed: median(o.sched), schedP95: pct(o.sched, 0.95),
    frameMed: median(o.frame), frameP95: pct(o.frame, 0.95),
  };
}

const row = (label, s) =>
  `${label.padEnd(26)} ui med ${r2(s.uiMed).padStart(6)} p95 ${r2(s.uiP95).padStart(6)}` +
  ` | per-commit med ${r2(s.uiCommitMed).padStart(6)} p95 ${r2(s.uiCommitP95).padStart(6)}` +
  ` | base med ${r2(s.baseMed).padStart(6)}` +
  ` | sched med ${r2(s.schedMed).padStart(5)}` +
  ` | frame med ${r2(s.frameMed).padStart(6)} p95 ${r2(s.frameP95).padStart(6)}` +
  ` | commit ${(s.commitRate * 100).toFixed(0)}% n=${s.frames}`;

/** Median-of-repeats over each summary field, so one noisy run can't carry. */
function medianOfRuns(runs) {
  const keys = Object.keys(runs[0]);
  const out = {};
  for (const k of keys) out[k] = median(runs.map(r => r[k]));
  return out;
}

async function boot(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });
}

async function startRun(page) {
  await page.evaluate(() => { window.__omniEngine.startGame(); });
  await page.waitForTimeout(600);
}

(async () => {
  const server = await ensureServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 3 });
  page.on('pageerror', e => console.error('[pageerror]', e.message));

  try {
    if (mode === 'validate') {
      // ── PHASE 1 GATE ──────────────────────────────────────────────────
      // Sweep a deliberately expensive component through the profiled tree.
      // The instrument passes only if uiActualMs tracks it proportionally
      // AND frame time moves with it.
      console.log(`\n=== PHASE 1 SELF-VALIDATION — ballast sweep (${REPEATS}x ${SAMPLE_MS}ms) ===\n`);
      const LEVELS = [0, 250, 1000, 4000];
      const results = [];
      for (const n of LEVELS) {
        const runs = [];
        for (let r = 0; r < REPEATS; r++) {
          await boot(page);
          await startRun(page);
          await page.evaluate((v) => { window.__omniBallast = v; }, n);
          await page.waitForTimeout(400);
          runs.push(summarize(await page.evaluate(COLLECT, SAMPLE_MS)));
        }
        const s = medianOfRuns(runs);
        results.push({ n, s });
        console.log(row(`ballast ${n}`, s));
      }
      const b0 = results[0].s, bMax = results[results.length - 1].s;
      console.log(`\nGATE: ui med ${r2(b0.uiMed)} -> ${r2(bMax.uiMed)} ms` +
        ` (x${(bMax.uiMed / Math.max(b0.uiMed, 0.001)).toFixed(1)})` +
        ` · frame med ${r2(b0.frameMed)} -> ${r2(bMax.frameMed)} ms` +
        ` · sched med ${r2(b0.schedMed)} -> ${r2(bMax.schedMed)} ms (control: should NOT move)`);
      console.log('\nProportionality (ui med vs ballast size):');
      for (const { n, s } of results) {
        console.log(`  n=${String(n).padStart(5)}  ui ${r2(s.uiMed).padStart(7)}ms  ` +
          `per-1k-nodes ${n ? r2((s.uiMed - b0.uiMed) / (n / 1000)) : '   —'}`);
      }
    } else if (mode === 'ablate') {
      // ── Independent cross-check: cut React out of the frame entirely ───
      // This does not use the Profiler at all, so it cannot inherit any of
      // the Profiler's assumptions.  If reconciliation were the ~32ms the
      // 2026-08-09 capture attributed to it, deleting it outright would be
      // impossible to miss in frame time.
      console.log(`\n=== REACT ABLATION A/B (${REPEATS}x ${SAMPLE_MS}ms, container) ===\n`);
      for (const [name, setup] of [
        ['in-play (hub)', async (p) => { await startRun(p); }],
        ['pause menu', async (p) => { await startRun(p); await p.evaluate(() => window.__omniEngine.pauseGame()); await p.waitForTimeout(500); }],
      ]) {
        for (const cut of [false, true]) {
          const runs = [];
          for (let r = 0; r < REPEATS; r++) {
            await boot(page);
            await setup(page);
            if (cut) await page.evaluate(() => { window.__omniEngine.onStatsUpdate = () => {}; });
            await page.waitForTimeout(300);
            runs.push(summarize(await page.evaluate(COLLECT, SAMPLE_MS)));
          }
          const s = medianOfRuns(runs);
          console.log(`${(name + (cut ? ' — REACT CUT' : ' — normal')).padEnd(30)}` +
            `frame med ${r2(s.frameMed).padStart(6)} p95 ${r2(s.frameP95).padStart(6)} ms  (ui med ${r2(s.uiMed)})`);
        }
        console.log('');
      }
    } else {
      // ── PHASE 2 ATTRIBUTION ───────────────────────────────────────────
      console.log(`\n=== PHASE 2 ATTRIBUTION (${REPEATS}x ${SAMPLE_MS}ms, container) ===\n`);
      await page.evaluate(() => { window.__omniBallast = 0; }).catch(() => {});

      const STATES = [
        ['in-play (hub)', async (p) => { await startRun(p); }],
        ['in-play (boss)', async (p) => {
          await startRun(p);
          await p.evaluate(() => window.__omniEngine.debugSpawnBoss(''));
          await p.waitForTimeout(1200);
        }],
        ['pause menu', async (p) => {
          await startRun(p);
          await p.evaluate(() => window.__omniEngine.pauseGame());
          await p.waitForTimeout(500);
        }],
        ['docked (trade hub)', async (p) => {
          await startRun(p);
          // Park on the Trade Hub — the station with BOTH shops, i.e. the
          // heaviest station panel there is (F2's worst case).
          await p.evaluate(() => {
            const e = window.__omniEngine;
            const st = (e.stations || []).find(s => s.stationKind === 'tradehub') || e.stations?.[0];
            if (st) { e.player.position.x = st.position.x; e.player.position.y = st.position.y; }
            e.player.velocity.x = 0; e.player.velocity.y = 0;
          });
          await p.waitForTimeout(600);
          const ok = await p.evaluate(() => window.__omniEngine.dockAtStation());
          if (!ok) console.log('   (warn: dock failed)');
          await p.waitForTimeout(500);
        }],
        ['death screen', async (p) => {
          await startRun(p);
          await p.evaluate(() => { const e = window.__omniEngine; e.player.health = 0; e.handleEntityDeath?.(e.player); });
          await p.waitForTimeout(3500);   // explosion + DEATH_SCREEN_DELAY beat
        }],
      ];

      for (const [name, setup] of STATES) {
        for (const hz of [60, 30, 15]) {
          const runs = [];
          let stateOk = true;
          for (let r = 0; r < REPEATS; r++) {
            await boot(page);
            // cycleHudRate walks [60,30,15]; step until we land on target.
            await page.evaluate((target) => {
              const e = window.__omniEngine;
              for (let i = 0; i < 4; i++) {
                if ((window.__omniStats?.hudRateName ?? '60Hz') === target + 'Hz') break;
                e.dbg.cycleHudRate();
              }
            }, hz);
            await setup(page);
            const s = summarize(await page.evaluate(COLLECT, SAMPLE_MS));
            if (r === 0) {
              const st = await page.evaluate(() => {
                const e = window.__omniEngine;
                return { paused: e.gameState, docked: !!e.dockedAtStation, dead: !!e.deathPending,
                         rate: window.__omniStats?.hudRateName, prof: !!window.__omniStats?.perf?.uiProfiled };
              });
              if (!st.prof) { console.log('  !! PROFILER NOT ACTIVE — rebuild with OMNI_PROFILE_REACT=1'); stateOk = false; }
            }
            runs.push(s);
          }
          if (stateOk) console.log(row(`${name} @${hz}Hz`, medianOfRuns(runs)));
        }
        console.log('');
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
})();
