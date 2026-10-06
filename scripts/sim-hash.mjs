#!/usr/bin/env node
/** Bundle and run tests/sim/parity-cli.ts; its stdout is the headless hash
 *  series as JSON.  The browser parity test (tests/headless.spec.ts) calls
 *  this, so the Node side of the comparison is built exactly as `test:sim`
 *  builds it. */
import { spawnSync } from 'node:child_process';
import { bundle } from './sim-test.mjs';

const file = await bundle('tests/sim/parity-cli.ts');
const r = spawnSync(process.execPath, [file], { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 26 });
process.exit(r.status ?? 1);
