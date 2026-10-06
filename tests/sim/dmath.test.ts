/**
 * dmath — the deterministic math layer (engine-core S3, plan D30).
 *
 * Two different claims, tested separately because they fail separately:
 *
 *  1. AGREEMENT.  The same input gives the same BITS on every JS engine.  That
 *     cannot be proved from inside one engine, so the claim is made as a table:
 *     `fixtures/dmath.bits.json` holds the exact bit pattern of every function
 *     at a spread of inputs, this suite requires Node to reproduce it, and
 *     `tests/headless.spec.ts` requires Chromium to reproduce the very same file
 *     (and `webkit`, where that browser is installed).  If an engine's `+ − × ÷`
 *     or `sqrt` ever disagreed, this is where it would show.
 *  2. ACCURACY.  Agreement is the point, accuracy is merely required not to be
 *     embarrassing: within a few ULP of the native function over the ranges the
 *     sim actually uses.  A mistyped fdlibm constant shows up here, not in play.
 *
 * Regenerate the table (only when the algorithm changes on purpose, which moves
 * every replay hash, so it belongs with a rebaseline):
 *     OMNI_WRITE_DMATH_BITS=1 npm run test:sim -- --filter dmath
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as D from '../../engine/systems/dmath';

export const INPUTS: number[] = (() => {
  // Deterministic spread: structure (zeros, quadrant edges, small, large) plus
  // an LCG sweep, all derived arithmetically so the list is identical anywhere.
  const out: number[] = [0, 1, -1, 0.5, -0.5, 2, 3, 10, 100, 1e3, 1e4, 0.7853981633974483, 1.5707963267948966, 3.141592653589793, 6.283185307179586, 1e-8, 1e-300, 123456.789];
  let s = 20260610;
  for (let i = 0; i < 160; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const u = s / 4294967296;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = s / 4294967296;
    out.push((u - 0.5) * 2 * Math.pow(10, Math.floor(v * 7) - 2)); // ±[1e-2 .. 1e4]
  }
  return out;
})();

type Table = Record<string, string[]>;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Word order is a property of the host, the printed bit pattern is not: always
// print the high word first.
f64[0] = 1;
const HI = u32[1] === 0x3ff00000 ? 1 : 0;
function bits(x: number): string {
  f64[0] = x;
  return (u32[HI] >>> 0).toString(16).padStart(8, '0') + (u32[1 - HI] >>> 0).toString(16).padStart(8, '0');
}

function compute(): Table {
  const t: Table = {};
  const one = (name: string, f: (x: number) => number) => { t[name] = INPUTS.map((x) => bits(f(x))); };
  one('sin', D.sin);
  one('cos', D.cos);
  one('tan', D.tan);
  one('exp', (x) => D.exp(x / 100));
  one('log', (x) => D.log(Math.abs(x) + 1e-3));
  one('atan', D.atan);
  one('cbrt', D.cbrt);
  one('asin', (x) => D.asin(x / (Math.abs(x) + 1)));
  one('acos', (x) => D.acos(x / (Math.abs(x) + 1)));
  t.pow = INPUTS.map((x, i) => bits(D.pow(Math.abs(x) + 0.01, INPUTS[(i + 7) % INPUTS.length] / 400)));
  t.powInt = INPUTS.map((x, i) => bits(D.pow(x / 50, (i % 17) - 8)));
  t.atan2 = INPUTS.map((y, i) => bits(D.atan2(y, INPUTS[(i * 5 + 3) % INPUTS.length])));
  t.hypot = INPUTS.map((x, i) => bits(D.hypot(x, INPUTS[(i * 3 + 1) % INPUTS.length])));
  return t;
}

const FIXTURE = path.join(process.cwd(), 'tests/sim/fixtures/dmath.bits.json');

test('every function reproduces the pinned bit patterns', () => {
  const now = compute();
  if (process.env.OMNI_WRITE_DMATH_BITS) {
    fs.writeFileSync(FIXTURE, JSON.stringify({ inputs: INPUTS.map(bits), table: now }) + '\n');
  }
  const pinned = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { inputs: string[]; table: Table };
  assert.deepEqual(INPUTS.map(bits), pinned.inputs, 'the input list itself must be identical');
  for (const name of Object.keys(pinned.table)) {
    const want = pinned.table[name];
    const got = now[name];
    for (let i = 0; i < want.length; i++) {
      assert.equal(got[i], want[i], `${name}[${i}] (input ${INPUTS[i]})`);
    }
  }
  assert.deepEqual(Object.keys(now).sort(), Object.keys(pinned.table).sort(), 'same set of functions');
});

// ── accuracy against the native functions ────────────────────────────────────
let seed = 987654321;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const R = (lo: number, hi: number) => lo + (hi - lo) * rnd();

function worstAbs(f: (a: number, b: number) => number, g: (a: number, b: number) => number, gen: () => [number, number], n = 50000): number {
  let w = 0;
  for (let i = 0; i < n; i++) { const [a, b] = gen(); w = Math.max(w, Math.abs(f(a, b) - g(a, b))); }
  return w;
}
function worstRel(f: (a: number, b: number) => number, g: (a: number, b: number) => number, gen: () => [number, number], n = 50000): number {
  let w = 0;
  for (let i = 0; i < n; i++) { const [a, b] = gen(); w = Math.max(w, Math.abs(f(a, b) - g(a, b)) / Math.max(Math.abs(g(a, b)), 1e-300)); }
  return w;
}

test('sin / cos stay within 1e-15 of native over the sim range (and out to 5e4 rad)', () => {
  assert.ok(worstAbs((x) => D.sin(x), (x) => Math.sin(x), () => [R(-50, 50), 0]) < 1e-15);
  assert.ok(worstAbs((x) => D.cos(x), (x) => Math.cos(x), () => [R(-50, 50), 0]) < 1e-15);
  assert.ok(worstAbs((x) => D.sin(x), (x) => Math.sin(x), () => [R(-5e4, 5e4), 0]) < 1e-14);
  assert.ok(worstAbs((x) => D.cos(x), (x) => Math.cos(x), () => [R(-5e4, 5e4), 0]) < 1e-14);
});

test('exp / log / pow / cbrt stay within 1e-13 relative of native', () => {
  assert.ok(worstRel((x) => D.exp(x), (x) => Math.exp(x), () => [R(-700, 700), 0]) < 1e-13);
  assert.ok(worstAbs((x) => D.log(x), (x) => Math.log(x), () => [Math.exp(R(-30, 30)), 0]) < 1e-14);
  assert.ok(worstRel((x, y) => D.pow(x, y), (x, y) => Math.pow(x, y), () => [R(0.001, 100), R(-8, 8)]) < 1e-13);
  assert.ok(worstRel((x, y) => D.pow(x, y), (x, y) => Math.pow(x, y), () => [R(0.9, 1), R(0, 120)]) < 1e-13);
  assert.ok(worstRel((x, y) => D.pow(x, y), (x, y) => Math.pow(x, y), () => [R(-5, 5), Math.floor(R(-10, 10))]) < 1e-13);
  assert.ok(worstRel((x) => D.cbrt(x), (x) => Math.cbrt(x), () => [R(-1e4, 1e4), 0]) < 1e-14);
});

test('atan2 / asin / acos / hypot stay within 1e-15 of native', () => {
  assert.ok(worstAbs((y, x) => D.atan2(y, x), (y, x) => Math.atan2(y, x), () => [R(-1e3, 1e3), R(-1e3, 1e3)]) < 1e-15);
  assert.ok(worstAbs((x) => D.asin(x), (x) => Math.asin(x), () => [R(-1, 1), 0]) < 1e-15);
  assert.ok(worstAbs((x) => D.acos(x), (x) => Math.acos(x), () => [R(-1, 1), 0]) < 1e-15);
  assert.ok(worstRel((x, y) => D.hypot(x, y), (x, y) => Math.hypot(x, y), () => [R(-1e4, 1e4), R(-1e4, 1e4)]) < 1e-15);
});

// ── the edges the sim could meet ─────────────────────────────────────────────
test('special values follow the language', () => {
  assert.equal(D.sin(0), 0); assert.equal(D.cos(0), 1);
  assert.ok(Object.is(D.sin(-0), -0) || D.sin(-0) === 0);
  assert.ok(Number.isNaN(D.sin(Infinity))); assert.ok(Number.isNaN(D.cos(NaN)));
  assert.equal(D.exp(0), 1); assert.equal(D.exp(710), Infinity); assert.equal(D.exp(-800), 0);
  assert.equal(D.log(1), 0); assert.equal(D.log(0), -Infinity); assert.ok(Number.isNaN(D.log(-1)));
  assert.equal(D.pow(2, 10), 1024); assert.equal(D.pow(5, 0), 1); assert.equal(D.pow(0, 3), 0);
  assert.equal(D.pow(-2, 3), -8); assert.ok(Number.isNaN(D.pow(-8, 1 / 3))); assert.equal(D.pow(2, -2), 0.25);
  assert.equal(D.pow(0, -1), Infinity); assert.equal(D.pow(4, 0.5), 2);
  assert.ok(Number.isNaN(D.pow(1, NaN)));
  assert.equal(D.atan2(1, 0), Math.PI / 2); assert.equal(D.atan2(0, -1), Math.PI);
  assert.equal(D.atan2(-0, -1), -Math.PI); assert.equal(D.atan2(0, 1), 0); assert.equal(D.atan2(0, 0), 0);
  assert.equal(D.atan2(1, Infinity), 0); assert.equal(D.atan2(Infinity, Infinity), Math.PI / 4);
  assert.equal(D.hypot(3, 4), 5);
});

test('a result never depends on a previous call (no hidden state leaks)', () => {
  const a = [D.sin(1e4), D.cos(1e4), D.sin(0.3), D.cos(2.9)];
  D.sin(123.4); D.cos(77.7); D.pow(3, 4.5); D.exp(5); D.log(9);
  const b = [D.sin(1e4), D.cos(1e4), D.sin(0.3), D.cos(2.9)];
  assert.deepEqual(a, b);
});
