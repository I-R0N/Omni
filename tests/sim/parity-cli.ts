/**
 * Prints, as JSON on stdout, what the browser parity test compares against:
 * the headless hash series for every parity map, the step-0 entity table, and
 * a libm fingerprint (see tests/headless.spec.ts for why).
 * Run by `scripts/sim-hash.mjs`.
 */
import {
  createHeadlessEngine, replaySeries,
  PARITY_INPUTS, PARITY_MAPS, PARITY_SEED, PARITY_STEPS, PARITY_EVERY,
} from './harness';
import { MapType } from '../../types';

const series: Record<string, unknown> = {};
for (const map of PARITY_MAPS) {
  series[map] = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, PARITY_INPUTS, PARITY_STEPS, PARITY_EVERY);
}

const world0: Record<string, unknown> = {};
for (const map of PARITY_MAPS) {
  const g = createHeadlessEngine().engine as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  g.beginSeededRun(PARITY_SEED, map as MapType);
  world0[map] = g.currentMap.entities
    .filter((e: any) => e.active && e.type !== 'PARTICLE') // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((e: any) => [e.id, e.type, e.position.x, e.position.y, e.velocity ? e.velocity.x : 0, // eslint-disable-line @typescript-eslint/no-explicit-any
      e.velocity ? e.velocity.y : 0, e.rotation, e.health, e.size ? e.size.x : 0]);
}

// The same probes the page runs (tests/headless.spec.ts) — keep them identical.
const libm: Record<string, number> = (() => {
  let s = 12345; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const f64 = new Float64Array(1), u = new Uint32Array(f64.buffer);
  const bits = (x: number) => { f64[0] = x; return u[0] ^ Math.imul(u[1], 31); };
  const fns: Record<string, (a: number, b: number) => number> = {
    sin: (a) => Math.sin(a * 20), cos: (a) => Math.cos(a * 20), pow: (a, b) => Math.pow(a * 10, b * 3),
    atan2: (a, b) => Math.atan2(a - 0.5, b - 0.5), hypot: (a, b) => Math.hypot(a * 100, b * 100),
    exp: (a) => Math.exp(a * 5), log: (a) => Math.log(a * 100 + 0.01), sqrt: (a) => Math.sqrt(a * 1000),
  };
  const out: Record<string, number> = {};
  for (const k in fns) { let h = 0x811c9dc5; s = 99; for (let i = 0; i < 20000; i++) { const a = r(), b = r(); h = Math.imul(h ^ bits(fns[k](a, b)), 16777619) >>> 0; } out[k] = h; }
  return out;
})();

process.stdout.write(JSON.stringify({ series, world0, libm }));
