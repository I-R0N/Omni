#!/usr/bin/env node
/**
 * scripts/sim-test.mjs — run the HEADLESS SIM tests (tests/sim/*.test.ts).
 *
 * These drive the real GameEngine in Node through the headless platform
 * (platform/headless.ts), with no browser and no dev server, so a sim-level
 * assertion costs milliseconds instead of a Playwright page.  They are NOT
 * part of the Playwright suites and not run by `npm test`; `npm run test:sim`
 * is its own gate (CI runs it before the browser suites).
 *
 * How: esbuild bundles each test file (resolving the two virtual manifest
 * modules the way vite.config.ts does) into node_modules/.cache, then the
 * Node built-in test runner executes the bundles.  `--filter <substring>`
 * runs only the test files whose name contains it.
 *
 * `scripts/sim-hash.mjs` uses `bundle()` too, to give the browser parity test
 * (tests/headless.spec.ts) a Node hash series to compare against.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// esbuild is vite's own dependency (always installed, hoisted), so it is not
// declared a second time here — that would churn the lockfile for nothing.
import { build } from 'esbuild';
import { isTableId, loadTableModule } from './toml-tables.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'node_modules', '.cache', 'omni-sim');

/** The virtual modules vite.config.ts provides: the two manifests, scanned the
 *  same way, and the TOML content tables, parsed by the SAME loader
 *  (scripts/toml-tables.mjs) so Node and the browser build cannot disagree. */
function scan(dir, re, mapper) {
  try {
    return fs.readdirSync(path.join(root, dir)).filter((f) => re.test(f)).sort().map(mapper);
  } catch {
    return [];
  }
}
const virtualManifests = {
  name: 'omni-virtual-manifests',
  setup(b) {
    b.onResolve({ filter: /^virtual:(nebula|sfx)-manifest$|^virtual:table\// }, (a) => ({ path: a.path, namespace: 'omni-virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'omni-virtual' }, (a) => {
      if (isTableId(a.path)) return { contents: loadTableModule(a.path), loader: 'js' };
      if (a.path.startsWith('virtual:table/')) throw new Error(`unknown content table ${a.path} - add it to TABLES in scripts/toml-tables.mjs`);
      const list = a.path === 'virtual:nebula-manifest'
        ? scan('public/assets', /^Nebula\d+\.png$/i, (f) => `/assets/${f}`)
        : scan('public/assets/sfx', /\.wav$/i, (f) => f);
      return { contents: `export default ${JSON.stringify(list)};`, loader: 'js' };
    });
  },
};

/** Bundle `entry` (a .ts file) to `<outDir>/<name>.mjs` and return that path. */
export async function bundle(entry, name = path.basename(entry).replace(/\.[tj]s$/, '')) {
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [path.resolve(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    plugins: [virtualManifests],
    define: { __APP_VERSION__: '"sim"', __BUILD_TIME__: '"sim"' },
    // `node:*` builtins stay external; the sim imports nothing else bare.
    logLevel: 'error',
    sourcemap: 'inline',
  });
  return outfile;
}

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--filter');
  const filter = fi >= 0 ? args[fi + 1] : '';
  const dir = path.join(root, 'tests', 'sim');
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts') && f.includes(filter)).sort();
  if (entries.length === 0) {
    console.error('sim-test: no test files matched');
    process.exit(1);
  }
  const bundles = [];
  for (const f of entries) bundles.push(await bundle(path.join('tests', 'sim', f)));
  const r = spawnSync(process.execPath, ['--test', '--enable-source-maps', ...bundles], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
