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

// ── THE MATH GUARD — the sim never calls the engine's libm ───────────────────
// `Math.sin / cos / pow / exp / log / atan2 …` are allowed to differ between JS
// engines in the last place, so a sim that calls them is bit-exact only within
// one engine.  engine/systems/dmath.ts replaces them with arithmetic every
// engine agrees on, and this test is what keeps it that way.  Same shape as the
// platform guard above: an allow-list of the files that never reach a replay
// hash (they draw, sound or decorate), so a NEW file is deterministic by default.
const MATH_PRESENTATION = new Set<string>([
  'engine/systems/RenderSystem.ts',
  'engine/systems/BackgroundManager.ts',
  'engine/systems/AudioSystem.ts',
  'engine/systems/AdaptiveMusic.ts',
  'engine/systems/SfxRegistry.ts',
  'engine/systems/ParticleSystem.ts',   // cosmetic: particles are excluded from the replay hash
  'engine/NebulaColor.ts',              // colour blending only (cbrt / gamma pow); strings, never read by the sim
  'engine/systems/dmath.ts',            // the replacement itself
]);
const MATH_PRESENTATION_DIRS = ['engine/systems/render/'];

const LIBM =
  /\bMath\.(?:sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b|\*\*/;

function mathGuardedFiles(): string[] {
  return guardedFiles().filter((rel) => !MATH_PRESENTATION.has(rel) && !MATH_PRESENTATION_DIRS.some((d) => rel.startsWith(d)));
}

test('no sim module calls the native libm (use dmath)', () => {
  const files = mathGuardedFiles();
  assert.ok(files.length > 30 && files.includes('engine/systems/PhysicsSystem.ts') && files.includes('constants.ts'));
  assert.ok(!files.includes('engine/systems/render/hud.ts'), 'presentation is exempt');
  const offenders: string[] = [];
  for (const rel of files) {
    const code = stripNonCode(fs.readFileSync(path.join(root, rel), 'utf8'));
    code.split('\n').forEach((line, i) => {
      if (LIBM.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'native libm in the sim (route through engine/systems/dmath):\n' + offenders.join('\n'));
});

test('the libm detector reads code, not prose, and catches the operator form', () => {
  const code = stripNonCode([
    '// Math.pow(a, b) is what this used to be',
    'const a = Math.sin(1);',
    'const b = x ** 2;',
    "const c = 'Math.cos(0)';",
    'const d = Math.sqrt(4) + Math.floor(1.5) + Math.imul(2, 3) + Math.PI;',
  ].join('\n'));
  assert.deepEqual(code.split('\n').map((l) => LIBM.test(l)), [false, true, true, false, false]);
});

test('every MATH_PRESENTATION entry still exists (a stale exemption is a hole)', () => {
  for (const rel of MATH_PRESENTATION) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is listed but missing`);
  for (const d of MATH_PRESENTATION_DIRS) assert.ok(fs.existsSync(path.join(root, d)), `${d} is listed but missing`);
});

test('the presentation files that exempt themselves really are all that is left', () => {
  // Anything in the allow-list that calls NO libm function is an exemption that
  // does nothing — and a reason to delete it, since each one is a place the sim
  // could hide.  (dmath.ts is the replacement: it calls none by construction.)
  const idle = [...MATH_PRESENTATION].filter((rel) => {
    const code = stripNonCode(fs.readFileSync(path.join(root, rel), 'utf8'));
    return !LIBM.test(code);
  });
  assert.deepEqual(idle.filter((r) => r !== 'engine/systems/dmath.ts'), [], 'exemptions that call no libm function:\n' + idle.join('\n'));
});
