#!/usr/bin/env node
/**
 * scripts/balance.mjs — the BALANCE HARNESS driver (engine-core S3, D-S3-e).
 *
 *   node scripts/balance.mjs                     # the full baseline (long)
 *   node scripts/balance.mjs --quick             # 1 seed, 2 maps, a few duels
 *   node scripts/balance.mjs --seeds 3 --jobs 4  # more seeds, 4 workers
 *   node scripts/balance.mjs --report            # re-render from the saved JSON
 *
 * Bundles tests/sim/balance-cli.ts (the same esbuild shim `npm run test:sim`
 * uses), fans one process per job across the cores, writes the raw results to
 * docs/balance-baseline.json and the readable report to docs/BALANCE_BASELINE.md.
 * NOT part of `npm test` or CI: it is minutes long and its output is a
 * measurement to read, not an assertion.  tests/sim/balance.test.ts is the
 * fast check that the instruments still work.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { bundle } from './sim-test.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : (args[i + 1] ?? true); };
const has = (n) => args.includes(`--${n}`);

const JSON_OUT = path.join(root, 'docs', 'balance-baseline.json');
const MD_OUT = path.join(root, 'docs', 'BALANCE_BASELINE.md');

const quick = has('quick');
const seeds = Number(flag('seeds', quick ? 1 : 2));
const workers = Number(flag('jobs', Math.max(1, os.cpus().length)));
const maxSec = Number(flag('max-sec', 900));
const MAPS = quick ? ['POCKET', 'UNIVERSE'] : ['POCKET', 'UNIVERSE', 'RING', 'SEVEN_RINGS'];

function runJob(cli, job) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [cli, JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`job ${JSON.stringify(job).slice(0, 120)} failed (${code}): ${err.slice(-400)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`bad output for ${JSON.stringify(job).slice(0, 120)}: ${out.slice(-200)}`)); }
    });
  });
}

async function pool(cli, jobs, label) {
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  const t0 = Date.now();
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await runJob(cli, jobs[i]);
      done++;
      process.stderr.write(`\r[${label}] ${done}/${jobs.length}  ${Math.round((Date.now() - t0) / 1000)}s   `);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker));
  process.stderr.write('\n');
  return results;
}

const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d));

async function measure() {
  const cliPath = await bundle('tests/sim/balance-cli.ts', 'balance-cli');
  const st = await runJob(cliPath, { kind: 'static' });
  const out = { generated: new Date().toISOString(), seeds, maxSec, maps: MAPS, static: st };

  // transit
  const portalIds = ['arena_universe', 'arena_ring', 'arena_seven_rings', 'arena_pocket'];
  out.transit = await pool(cliPath, portalIds.map((portal) => ({ kind: 'transit', portal })), 'transit');

  // duels, sharded so each process amortises its start-up
  const weapons = quick ? ['projectile', 'projectile+kinetic', 'cannon'] : st.weaponKeys;
  const subtypes = st.enemies.filter((e) => !e.ambient).map((e) => e.subtype);
  const list = [];
  for (const gunned of [false, true]) for (const weapon of weapons) for (const subtype of subtypes) list.push({ weapon, subtype, gunned });
  const shards = []; const n = Math.max(workers * 2, 1);
  for (let i = 0; i < n; i++) shards.push({ kind: 'duels', list: list.filter((_, k) => k % n === i) });
  out.duels = (await pool(cliPath, shards, 'duels')).flat();

  // arenas
  const jobs = [];
  for (const map of MAPS) for (const loadout of ['lean', 'mk3']) for (const rivals of [true, false])
    for (let s = 1; s <= seeds; s++) jobs.push({ kind: 'arena', map, loadout, rivals, seed: s, maxSec });
  jobs.sort((a, b) => (a.loadout === 'lean' ? 0 : 1) - (b.loadout === 'lean' ? 0 : 1));
  out.arenas = await pool(cliPath, jobs, 'arenas');
  fs.writeFileSync(JSON_OUT, JSON.stringify(out) + '\n');
  return out;
}

// The difficulty ladder: the lean start at the levels below today's top, rivals on
// (as shipped), merged into the existing JSON so the baseline is not re-run.
async function ladder() {
  const cliPath = await bundle('tests/sim/balance-cli.ts', 'balance-cli');
  const d = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
  const levels = [1, 2];
  const jobs = [];
  for (const difficulty of levels) for (const map of d.maps) for (let seed = 1; seed <= d.seeds; seed++)
    jobs.push({ kind: 'arena', map, loadout: 'lean', rivals: true, seed, difficulty, maxSec: d.maxSec });
  d.ladder = await pool(cliPath, jobs, 'ladder');
  fs.writeFileSync(JSON_OUT, JSON.stringify(d) + '\n');
  return d;
}

// ── report ───────────────────────────────────────────────────────────────────
function render(d) {
  const L = [];
  const P = (s = '') => L.push(s);
  const st = d.static;
  const mins = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

  P('# Balance baseline — what the game does today');
  P();
  P(`_Generated ${d.generated} by \`node scripts/balance.mjs\` — ${d.seeds} seed(s) per cell, ${d.maxSec}s sim cap, difficulty 3 (the shipped default and today's highest)._`);
  P();
  P('This is the **measurement** the user asked for in D-S3-e before any target is set. It changes no number.');
  P();
  P('## How to read it');
  P();
  P('- **The bot is a yardstick, not a player.** It aims perfectly at the nearest hostile, kites at a fixed range, never dodges and never charges a shot. A human dodges better and aims worse; what carries over is the *difference between configurations*, not the absolute seconds.');
  P('- **Two loadouts.** `lean` is the free start (Base Hull + Projector). `mk3` is the debug "Outfit all": every Mk III module, a Shield, Mk V scanner, and a Projector+Thermal / Beam+Electric pair — the strongest thing a player can wear today.');
  P('- **Time is simulated seconds** at the fixed 120 Hz step; `mm:ss` where long.');
  P('- **1 salvage unit = 1,000 credits.** Module prices below are shown in units.');
  P();

  // ── run length
  P('## 1. A portal run: how long, and how it ends');
  P();
  P('One arena ladder = waves 1–5 plus the boss wave (wave 6). "Run length" is sim time from arrival to the boss dying, the player dying, or the cap.');
  P();
  P('| Arena | Loadout | Rivals | Ended by (of N) | Run length (median) | Waves cleared (median) |');
  P('|---|---|---|---|---|---|');
  for (const map of d.maps) for (const loadout of ['lean', 'mk3']) for (const rivals of [true, false]) {
    const rs = d.arenas.filter((r) => r.map === map && r.loadout === loadout && r.rivals === rivals);
    if (!rs.length) continue;
    const ends = {}; rs.forEach((r) => { ends[r.endedBy] = (ends[r.endedBy] ?? 0) + 1; });
    P(`| ${map} | ${loadout} | ${rivals ? 'on' : 'off'} | ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(', ')} (of ${rs.length}) | ${mins(median(rs.map((r) => r.endSec)))} | ${f(median(rs.map((r) => r.wavesCleared)), 0)} |`);
  }
  P();
  const tr = d.transit;
  P(`**Hub → rift** (bot flies the shortest wrapped line, knowing where the rift is): ${tr.map((t) => `${t.portal.replace('arena_', '')} ${t.reached ? f(t.seconds, 1) + ' s' : 'not reached'}`).join(' · ')}. A player has to *find* the rift, so this is a floor.`);
  P();

  // ── per-wave table
  P('## 2. Wave by wave (rivals on, as shipped)');
  P();
  P('Median across arenas and seeds. `window` is the spawn-stream window the design allows; `clear` is when the field was actually empty.');
  P();
  for (const loadout of ['lean', 'mk3']) {
    P(`### ${loadout}`);
    P();
    P('| Wave | window s | enemies (budget) | seen spawned | clear time s | salvage units | hull lost | rivals alive (max) |');
    P('|---|---|---|---|---|---|---|---|');
    for (let w = 1; w <= 6; w++) {
      const rows = d.arenas.filter((r) => r.loadout === loadout && r.rivals).flatMap((r) => r.waves.filter((x) => x.wave === w));
      if (!rows.length) { P(`| ${w} | ${st.waves[w - 1]?.windowSec} | ${st.waves[w - 1]?.budget} | — | — | — | — | — |`); continue; }
      const cleared = rows.filter((x) => x.durationSec != null);
      P(`| ${w} | ${st.waves[w - 1]?.windowSec} | ${st.waves[w - 1]?.budget} | ${f(median(rows.map((x) => x.spawned)), 0)} | ${f(median(cleared.map((x) => x.durationSec)))}${cleared.length < rows.length ? ` (${cleared.length}/${rows.length} cleared)` : ''} | ${f(median(rows.map((x) => x.salvageUnits)))} | ${f(median(rows.map((x) => x.hullLost)), 0)} | ${f(median(rows.map((x) => x.rivalsAlive)), 0)} |`);
    }
    P();
  }

  // ── rivals
  P('## 3. How much of the pressure is the rivals');
  P();
  P('Same maps and seeds with and without rival warp-ins (`nextRivalScore = ∞`). Rivals warp in every 1,000 score; 34 % hostile, 30 % ally, 36 % neutral.');
  P();
  P('| Loadout | Rivals | rivals seen | first rival at (s) | hits taken: enemies / rivals | kills stolen | salvage units / cleared wave | hull lost | run length |');
  P('|---|---|---|---|---|---|---|---|---|');
  for (const loadout of ['lean', 'mk3']) for (const rivals of [true, false]) {
    const rs = d.arenas.filter((r) => r.loadout === loadout && r.rivals === rivals);
    if (!rs.length) continue;
    P(`| ${loadout} | ${rivals ? 'on' : 'off'} | ${f(median(rs.map((r) => r.rivalsSeen)), 0)} | ${f(median(rs.map((r) => r.firstRivalSec)), 0)} | ${f(median(rs.map((r) => r.hitsFromEnemies)), 0)} / ${f(median(rs.map((r) => r.hitsFromRivals)), 0)} | ${f(median(rs.map((r) => r.killsStolenByRivals)), 0)} | ${f(median(rs.flatMap((r) => r.waves.filter((w) => w.durationSec != null).map((w) => w.salvageUnits))))} | ${f(median(rs.map((r) => r.hullLost)), 0)} | ${mins(median(rs.map((r) => r.endSec)))} |`);
  }
  P();
  const on = d.arenas.filter((r) => r.rivals), tot = (k) => on.reduce((a, r) => a + r[k], 0);
  const hostile = on.reduce((a, r) => a + (r.rivalDispositions.hostile ?? 0), 0), allR = on.reduce((a, r) => a + r.rivalsSeen, 0);
  P(`Across every rivals-on run: **${allR} rivals** warped in (${hostile} hostile); the player took **${tot('hitsFromRivals')}** rival hits against **${tot('hitsFromEnemies')}** from wave enemies, and rivals stole **${tot('killsStolenByRivals')}** kills (${f(tot('kills'))} paid to the player).`);
  P();

  // ── duels
  P('## 4. Weapon vs enemy: seconds to kill one');
  P();
  P('One enemy pinned 250 units ahead, shooter stationary, firing on cooldown, perfect aim. `base` = the gun (+ its energy modifier) alone. `gunned` = the same with 3× Gunnery Mk III beside it. Beams are pulled, not held, so they read slightly pessimistic. **Wave-1 HP**; wave scaling is +6 %/wave (cap ×2.5).');
  P();
  const subs = [...new Set(d.duels.map((x) => x.subtype))];
  const weps = [...new Set(d.duels.map((x) => x.weapon))];
  for (const gunned of [false, true]) {
    P(`### ${gunned ? 'gunned (3× Gunnery Mk III)' : 'base'}`);
    P();
    P(`| weapon | ${subs.map((s) => s.replace('_', ' ')).join(' | ')} |`);
    P(`|---|${subs.map(() => '---').join('|')}|`);
    const hp = subs.map((s) => d.duels.find((x) => x.subtype === s)?.targetHp);
    P(`| _HP_ | ${hp.map((x) => f(x, 0)).join(' | ')} |`);
    for (const w of weps) {
      const cells = subs.map((s) => { const x = d.duels.find((q) => q.weapon === w && q.subtype === s && q.gunned === gunned); return !x ? '—' : x.killed ? `${f(x.seconds)}s · ${x.shots}` : 'no kill'; });
      P(`| ${w} | ${cells.join(' | ')} |`);
    }
    P();
  }
  P('Cell = seconds · shots fired until dead. **Read the `spread+electric` and `spread+thermal` rows with suspicion**: a 1-HP target taking 40–180 shots means those pellets (which curl and weave, or need a chain/heat to land) mostly miss a *pinned stationary* target at 250 units — either a real weakness of those two guns or an artifact of the duel setup; this baseline does not decide which. `no kill` = still alive after 30 s.');
  P();

  // ── income
  P('## 5. Income against prices');
  P();
  const units = (rs) => rs.flatMap((r) => r.waves.filter((w) => w.durationSec != null).map((w) => w.salvageUnits));
  for (const loadout of ['lean', 'mk3']) {
    const rs = d.arenas.filter((r) => r.loadout === loadout && r.rivals);
    const perWave = median(units(rs));
    const perRun = median(rs.map((r) => r.salvageUnits));
    P(`- **${loadout}**: median **${f(perWave)} units per cleared wave**, **${f(perRun)} units per run** (runs ended as above).`);
  }
  P(`- Spec: ${st.dropChances.enemyPrimary} + ${st.dropChances.enemySecondary} salvage rolls per enemy kill, +${st.waveClearDrops} units per wave clear, +${st.snitchCatchDrops} per snitch catch. Rivals vacuum drops within ${150} units.`);
  P();
  const leanWave = median(units(d.arenas.filter((r) => r.loadout === 'lean' && r.rivals))) || null;
  const leanRun = median(d.arenas.filter((r) => r.loadout === 'lean' && r.rivals).map((r) => r.salvageUnits)) || null;
  const MK3 = ['hull_mk3', 'shield', 'capacitor_mk3', 'plating_mk3', 'engine_mk3', 'thrusters_mk3', 'scanner_mk5', 'dlv_beam', 'gunnery_mk3', 'autoloader_mk3', 'overcharge', 'nrg_thermal', 'nrg_electric'];
  const mk3Cost = st.modules.filter((m) => MK3.includes(m.id) && !m.rewardOnly).reduce((a, m) => a + m.units, 0);
  P(`**The \`mk3\` loadout the bot wears costs ${f(mk3Cost, 0)} units** in the shops (every Mk III, Shield, Beam, Thermal, Electric, Overcharge; the Mk V scanner it also wears is a reward-only find and is not counted) — about ${leanWave ? f(mk3Cost / leanWave, 0) : '—'} cleared waves, or ${leanRun ? f(mk3Cost / leanRun, 1) : '—'} lean runs, of income. A death strips what was *installed* (cargo survives), so that figure is also what a bare death risks if nothing is in the hold.`);
  P();
  P(`| Module | Mk | Price (units) | Cleared waves of lean income (${leanWave ? f(leanWave) : '—'} u/wave) |`);
  P('|---|---|---|---|');
  for (const m of st.modules) P(`| ${m.label}${m.rewardOnly ? ' _(reward only)_' : ''} | ${m.mark || '—'} | ${f(m.units, m.units % 1 ? 1 : 0)} | ${leanWave ? f(m.units / leanWave) : '—'} |`);
  P();

  // ── static
  P('## 6. The tables the numbers come from');
  P();
  P('| Wave | window s | budget | enemy HP × | enemy damage × |');
  P('|---|---|---|---|---|');
  for (const w of st.waves) P(`| ${w.wave} | ${w.windowSec} | ${w.budget} | ${f(w.hpMult, 2)} | ${f(w.dmgMult, 2)} |`);
  P();
  P('Difficulty today (index → spawn budget ×, enemy health / speed / damage ×): ' +
    Object.keys(st.difficulty.spawn).map((k) => `**${k}**: ${st.difficulty.spawn[k]}× · ${st.difficulty.stats[k].health}/${st.difficulty.stats[k].speed}/${st.difficulty.stats[k].damage}`).join(' · '));
  P();
  if (d.ladder) {
    P('## 7. Where the starter gun stops being enough (difficulty ladder)');
    P();
    P('The lean start (Base Hull + Projector, nothing bought), rivals on as shipped, same maps and seeds at each level. Level 3 is the section-1 data. Enemy multipliers are the `DIFFICULTY_*` tables in section 6.');
    P();
    P('| Level | spawn × | enemy HP / dmg × | Boss dead (of N) | Waves cleared (median) | Run length (median) | Hull lost / run | Salvage / run |');
    P('|---|---|---|---|---|---|---|---|');
    const rowsAt = (lvl) => lvl === 3 ? d.arenas.filter((r) => r.loadout === 'lean' && r.rivals) : d.ladder.filter((r) => r.difficulty === lvl);
    for (const lvl of [1, 2, 3]) {
      const rs = rowsAt(lvl);
      const dead = rs.filter((r) => r.endedBy === 'boss-dead').length;
      P(`| ${lvl} | ${st.difficulty.spawn[lvl]}× | ${st.difficulty.stats[lvl].health} / ${st.difficulty.stats[lvl].damage} | ${dead} (of ${rs.length}) | ${f(median(rs.map((r) => r.wavesCleared)), 0)} | ${mins(median(rs.map((r) => r.endSec)))} | ${f(median(rs.map((r) => r.hullLost)), 0)} | ${f(median(rs.map((r) => r.salvageUnits)))} |`);
    }
    P();
    P('Per map (waves cleared by the lean start, median over seeds; the boss is wave 6):');
    P();
    P('| Map | L1 | L2 | L3 |');
    P('|---|---|---|---|');
    for (const map of d.maps) P(`| ${map} | ${[1, 2, 3].map((lvl) => f(median(rowsAt(lvl).filter((r) => r.map === map).map((r) => r.wavesCleared)), 0)).join(' | ')} |`);
    P();
  }
  fs.writeFileSync(MD_OUT, L.join('\n') + '\n');
}

if (has('ladder')) {
  render(await ladder());
} else if (has('report')) {
  // Prices and tables are cheap to re-read, so a re-render never shows stale ones.
  const d = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
  d.static = await runJob(await bundle('tests/sim/balance-cli.ts', 'balance-cli'), { kind: 'static' });
  fs.writeFileSync(JSON_OUT, JSON.stringify(d) + '\n');
  render(d);
} else {
  const d = await measure();
  render(d);
}
console.error(`wrote ${path.relative(root, MD_OUT)}`);
