/**
 * scripts/toml-tables.mjs — the BUILD-TIME loader for the content tables in
 * `data/*.toml` (engine-core S3, plan D32).
 *
 * A table is written as TOML (comments are where this repo keeps the reasoning
 * behind each number) and reaches the game as a virtual module,
 * `virtual:table/<name>`, whose default export is the parsed value as plain
 * JSON.  The parser therefore runs at BUILD time and ships ZERO runtime bytes —
 * the same precedent as `virtual:nebula-manifest` / `virtual:sfx-manifest` — and
 * the single-file standalone build, which cannot fetch anything, gets the data
 * for free because it is already inside the module.
 *
 * THREE consumers resolve these ids and must agree, which is why the list and
 * the loader live HERE and are imported by each:
 *   1. vite.config.ts   — the dev server and `vite build` (and so Playwright's
 *                         webServer, and the standalone inline build);
 *   2. scripts/sim-test.mjs — the esbuild shim behind `npm run test:sim`,
 *                         `scripts/sim-hash.mjs` and the headless harness.
 * A new table is a new entry in TABLES and a new file; nothing else resolves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(root, 'data');

/** virtual id suffix -> file under data/. */
export const TABLES = {
  'map-population': 'map-population.toml',
  enemies: 'enemies.toml',
  bosses: 'bosses.toml',
};

export const TABLE_PREFIX = 'virtual:table/';

/** True for an id this loader owns. */
export function isTableId(id) {
  return id.startsWith(TABLE_PREFIX) && Object.hasOwn(TABLES, id.slice(TABLE_PREFIX.length));
}

/** The absolute file behind a table id. */
export function tableFile(id) {
  return path.join(DATA_DIR, TABLES[id.slice(TABLE_PREFIX.length)]);
}

/**
 * Parse one table to the JS module source that exports it.  A malformed file
 * fails the BUILD with the file name and the parser's line/column, rather than
 * shipping a half-table.  JSON-stringified so the objects the game receives are
 * ordinary ones (the parser's own objects have a null prototype).
 */
export function loadTableModule(id) {
  const file = tableFile(id);
  let value;
  try {
    value = parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${path.relative(root, file)}: ${err && err.message ? err.message : err}`);
  }
  return `export default ${JSON.stringify(value)};`;
}

/** The ids, for a watcher to match changed files against. */
export const TABLE_FILES = Object.values(TABLES);
