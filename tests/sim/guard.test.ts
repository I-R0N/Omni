/**
 * THE PLATFORM GUARD — nothing in the sim names a platform global.
 *
 * `window`, `document`, `navigator`, `performance`, `localStorage`,
 * `requestAnimationFrame` and `Date.now` are the platform.  The sim reaches
 * them only through the ports (engine/ports.ts), which is what lets the same
 * engine run in Node.  This test fails the day one creeps back.
 *
 * The rule is stated as an ALLOW-LIST OF ADAPTERS, not a list of sim files:
 * every file under engine/ plus constants.ts / types.ts / assets.ts is
 * guarded unless it is named below.  A new file is therefore guarded by
 * default, which is the direction a guard has to fail in.  Comments and
 * string literals are stripped first, so prose that says "the window"
 * cannot trip it — only code can.
 *
 * Math.random is guarded by tests/replay.spec.ts and stays there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

/** The adapters: the only engine files that may speak to the platform. */
const ADAPTERS = new Set<string>([
  'engine/systems/InputSystem.ts',       // DOM listeners, Gamepad API, WebHID
  'engine/systems/DualSenseHID.ts',      // WebHID
  'engine/systems/RenderSystem.ts',      // canvas
  'engine/systems/BackgroundManager.ts', // render-side star field
  'engine/systems/AudioSystem.ts',       // WebAudio
  'engine/systems/AdaptiveMusic.ts',     // WebAudio stems + document.hidden
  'engine/systems/PerfRecorder.ts',      // in-page capture harness (dev tool)
]);
/** A whole directory of adapters: everything the renderer draws with. */
const ADAPTER_DIRS = ['engine/systems/render/'];

const FORBIDDEN =
  /\b(?:window|document|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|performance)\b|\bDate\.now\b|\bglobalThis\.(?:crypto|window|document)\b/;

/** Remove comments and the CONTENT of string / template literals, keeping
 *  `${ … }` expressions (code) and line structure (so line numbers survive). */
export function stripNonCode(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  // Stack of template-literal brace depths; empty = not in a template.
  const tpl: number[] = [];
  let depth = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++;
      out += '""';
      continue;
    }
    if (c === '`') {
      i++;
      let inTemplate = true;
      while (inTemplate && i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; inTemplate = false; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          // code inside — push and fall back to the main loop
          tpl.push(depth);
          depth++;
          i += 2;
          inTemplate = false;
          out += '(';
          break;
        }
        if (src[i] === '\n') out += '\n';
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (tpl.length && tpl[tpl.length - 1] === depth) {
        tpl.pop();
        out += ')';
        i++;
        // resume the template literal
        while (i < n && src[i] !== '`') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '$' && src[i + 1] === '{') { tpl.push(depth); depth++; i += 2; out += '('; break; }
          if (src[i] === '\n') out += '\n';
          i++;
        }
        if (src[i] === '`') i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function* walk(dir: string): Generator<string> {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (/\.ts$/.test(ent.name)) yield p;
  }
}

function guardedFiles(): string[] {
  const files: string[] = ['constants.ts', 'types.ts', 'assets.ts'];
  for (const abs of walk(path.join(root, 'engine'))) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (ADAPTERS.has(rel) || ADAPTER_DIRS.some((d) => rel.startsWith(d))) continue;
    files.push(rel);
  }
  return files.sort();
}

test('the stripper reads code, not prose', () => {
  const src = [
    "const a = 1; // the window opens",
    "/* document.title */ const b = 'navigator.userAgent';",
    'const c = `x ${window.innerWidth} y`;',
    'const d = `a ${`b ${performance.now()}`} c`;',
    "const url = 'http://example.com';",
  ].join('\n');
  const code = stripNonCode(src);
  const hits = code.split('\n').map((l) => FORBIDDEN.test(l));
  assert.deepEqual(hits, [false, false, true, true, false]);
});

test('no sim module names window / document / navigator / performance / storage / rAF / Date.now', () => {
  const files = guardedFiles();
  assert.ok(files.length > 40, `expected to guard the whole sim, found ${files.length} files`);
  assert.ok(files.includes('engine/GameEngine.ts') && files.includes('engine/systems/PhysicsSystem.ts'));
  assert.ok(!files.includes('engine/systems/InputSystem.ts'), 'adapters are exempt');
  const offenders: string[] = [];
  for (const rel of files) {
    const code = stripNonCode(fs.readFileSync(path.join(root, rel), 'utf8'));
    code.split('\n').forEach((line, i) => {
      if (FORBIDDEN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'platform globals in the sim:\n' + offenders.join('\n'));
});

test('every ADAPTER entry still exists (a stale exemption is a hole)', () => {
  for (const rel of ADAPTERS) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is listed but missing`);
  for (const d of ADAPTER_DIRS) assert.ok(fs.existsSync(path.join(root, d)), `${d} is listed but missing`);
});
