/** THE REPLAY HARNESS — a run is (seed, input log), and replaying it must
 *  reproduce the world exactly (engine-core plan, S1).
 *
 *  The sim used to draw from `Math.random()`, so two runs of one input stream
 *  could never agree and a bug report could not be replayed.  Every draw now
 *  comes from a named, seeded stream (`engine/systems/rng.ts`), split into
 *  SIM streams (what changes the world) and COSMETIC streams (what only
 *  decorates it).  This suite pins the three claims the split rests on:
 *
 *   1. same seed + same input log ⇒ identical state hashes, step for step,
 *      across several maps;
 *   2. the cosmetic streams cannot reach the sim — advance them wildly and
 *      the hashes must not move;
 *   3. nothing in the codebase still reads `Math.random`, and the render
 *      layer never draws from a SIM stream.
 *
 *  Why a harness and not a spot check: determinism that is silently false is
 *  the one failure this exists to prevent, and it is wrong in a way nothing
 *  reports — a leaking stream still plays perfectly.  Every claim below has a
 *  CONTROL (a different seed, a different input) because a hash that ignored
 *  the world would pass the equality claims too.
 *
 *  Harness rule 9 applies: page functions are stringified, so everything they
 *  need is inlined or passed as `arg`.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot } from './helpers';

test.describe.configure({ timeout: 180_000 });

interface Hashes { steps: number[]; hash: number[]; rng: number[]; player: number[]; world: number[]; }

/** Replay `log` twice in the page and return both hash series (plus, when
 *  asked, a third run with the cosmetic streams hammered every step). */
async function replayOnce(page: any, arg: {
  seed: number; map: string; steps: number; every: number;
  inputs: any[]; burn?: number; fxSeed?: number;
}): Promise<Hashes> {
  return page.evaluate((a: any) => {
    const R = (window as any).__omniReplay;
    const g = (window as any).__omniEngine;
    const before = a.burn
      ? () => { if (a.fxSeed !== undefined) R.rng.seedFx(a.fxSeed + a.burn); R.rng.burnFx(a.burn); }
      : undefined;
    // eslint-disable-next-line
    const res = R.runReplay(g, { seed: a.seed, mapType: a.map, inputs: a.inputs }, a.steps, a.every, before);
    R.endReplay(g);
    const out: any = { steps: [], hash: [], rng: [], player: [], world: [] };
    for (const h of res.hashes) {
      out.steps.push(h.step); out.hash.push(h.hash); out.rng.push(h.rng);
      out.player.push(h.player); out.world.push(h.world);
    }
    return out;
  }, arg);
}

/** Fly right and a little up, fire a few taps off to one side. */
const INPUTS = [
  { at: 0, keys: ['KeyD'], aim: [700, 300] },
  { at: 100, fire: [[700, 300]] },
  { at: 300, keys: ['KeyD', 'KeyW'], aim: [600, 200] },
  { at: 400, fire: [[600, 200]] },
  { at: 500, fire: [[600, 200]] },
  { at: 700, keys: [], aim: [200, 400] },
  { at: 800, fire: [[200, 400]] },
];

// Maps chosen for coverage of what draws random numbers: a wave map with
// enemies (AI, waves), the hub (ambient fauna, roamers), the sandbox with
// every material (shards, nebula, drops) and a showcase field.
const MAPS = ['POCKET', 'UNIVERSE', 'OVERWORLD', 'NEBULA_FIELD'];
const STEPS = 1200;
const EVERY = 100;

test.describe('same seed + same inputs ⇒ the same world', () => {
  for (const map of MAPS) {
    test(`${map}: two replays agree at every checkpoint`, async ({ page }) => {
      await boot(page);
      const arg = { seed: 12345, map, steps: STEPS, every: EVERY, inputs: INPUTS };
      const a = await replayOnce(page, arg);
      const b = await replayOnce(page, arg);
      expect(a.steps.length).toBe(STEPS / EVERY + 1);
      expect(b.hash).toEqual(a.hash);
      // The run actually did something: the world moved off its first hash.
      expect(new Set(a.hash).size).toBeGreaterThan(5);
    });
  }

  test('CONTROL: a different seed gives a different world', async ({ page }) => {
    await boot(page);
    const base = { map: 'POCKET', steps: STEPS, every: EVERY, inputs: INPUTS };
    const a = await replayOnce(page, { ...base, seed: 1 });
    const b = await replayOnce(page, { ...base, seed: 2 });
    // Terrain generation alone separates them from step 0.
    expect(b.world[0]).not.toBe(a.world[0]);
    expect(b.hash[b.hash.length - 1]).not.toBe(a.hash[a.hash.length - 1]);
  });

  test('CONTROL: a different input log gives a different world', async ({ page }) => {
    await boot(page);
    const base = { seed: 7, map: 'POCKET', steps: STEPS, every: EVERY };
    const a = await replayOnce(page, { ...base, inputs: INPUTS });
    const b = await replayOnce(page, { ...base, inputs: [{ at: 0, keys: ['KeyA'], aim: [100, 300] }] });
    expect(b.player[b.player.length - 1]).not.toBe(a.player[a.player.length - 1]);
  });

  test('a replay is not a one-off: the seed survives a live run in between', async ({ page }) => {
    await boot(page);
    const arg = { seed: 99, map: 'UNIVERSE', steps: 600, every: 100, inputs: INPUTS };
    const a = await replayOnce(page, arg);
    // Hand the engine back to the frame loop for a while, then replay again.
    await page.waitForTimeout(1500);
    const b = await replayOnce(page, arg);
    expect(b.hash).toEqual(a.hash);
  });
});

test.describe('the cosmetic streams cannot reach the sim', () => {
  for (const map of ['POCKET', 'UNIVERSE']) {
    test(`${map}: hammering every fx stream moves no sim hash`, async ({ page }) => {
      await boot(page);
      const arg = { seed: 4242, map, steps: STEPS, every: EVERY, inputs: INPUTS };
      const quiet = await replayOnce(page, arg);
      // Reseed AND burn the cosmetic streams every step: particle counts,
      // sprite picks, shake and twinkle all change, and none may matter.
      const loud = await replayOnce(page, { ...arg, burn: 37, fxSeed: 1000 });
      expect(loud.hash).toEqual(quiet.hash);
    });
  }

  test('CONTROL: the same hammering of a SIM stream does move the hash', async ({ page }) => {
    await boot(page);
    const hashes = await page.evaluate((a: any) => {
      const R = (window as any).__omniReplay;
      const g = (window as any).__omniEngine;
      const run = (burnSim: boolean) => {
        const res = R.runReplay(g, { seed: a.seed, mapType: 'POCKET', inputs: a.inputs }, 600, 100,
          burnSim ? () => { R.rng.sim.drops(); R.rng.sim.shards(); R.rng.sim.ai(); } : undefined);
        R.endReplay(g);
        return res.hashes.map((h: any) => h.hash);
      };
      return { quiet: run(false), loud: run(true) };
    }, { seed: 4242, inputs: INPUTS });
    expect(hashes.loud).not.toEqual(hashes.quiet);
  });
});

test.describe('nothing in the sim reads Math.random', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const TREES = ['engine', 'components'];
  const FILES = ['constants.ts', 'assets.ts', 'App.tsx', 'types.ts', 'index.tsx'];

  function* walk(dir: string): Generator<string> {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) yield* walk(p);
      else if (/\.(ts|tsx)$/.test(ent.name)) yield p;
    }
  }

  /** Code only: comment lines (and trailing `//` comments) do not count. */
  function codeLines(file: string): Array<[number, string]> {
    const out: Array<[number, string]> = [];
    let inBlock = false;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      let l = line;
      if (inBlock) {
        const end = l.indexOf('*/');
        if (end < 0) return;
        inBlock = false;
        l = l.slice(end + 2);
      }
      for (;;) {
        const start = l.indexOf('/*');
        if (start < 0) break;
        const end = l.indexOf('*/', start + 2);
        if (end < 0) { inBlock = true; l = l.slice(0, start); break; }
        l = l.slice(0, start) + l.slice(end + 2);
      }
      const slash = l.indexOf('//');
      if (slash >= 0) l = l.slice(0, slash);
      out.push([i + 1, l]);
    });
    return out;
  }

  const files = [
    ...TREES.flatMap(t => [...walk(path.join(root, t))]),
    ...FILES.map(f => path.join(root, f)).filter(f => fs.existsSync(f)),
  ];

  test('no Math.random() call survives anywhere in the game code', () => {
    const hits: string[] = [];
    for (const f of files) {
      for (const [n, l] of codeLines(f)) {
        if (/\bMath\s*\.\s*random\b/.test(l)) hits.push(`${path.relative(root, f)}:${n}`);
      }
    }
    expect(hits, `Math.random is unseeded — draw from a stream in engine/systems/rng.ts: ${hits.join(', ')}`).toEqual([]);
  });

  test('the render layer never draws from a SIM stream', () => {
    const hits: string[] = [];
    for (const f of files) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (!rel.startsWith('engine/systems/render/') && rel !== 'engine/systems/AudioSystem.ts'
        && rel !== 'engine/systems/BackgroundManager.ts' && rel !== 'engine/systems/ParticleSystem.ts') continue;
      for (const [n, l] of codeLines(f)) {
        if (/\bsim\s*\.\s*[a-z]+\s*\(/.test(l)) hits.push(`${rel}:${n}`);
      }
    }
    expect(hits, `a presentation file draws from a sim stream (it would shift the world): ${hits.join(', ')}`).toEqual([]);
  });
});
