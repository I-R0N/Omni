/**
 * One balance job per process: `node <bundle> '<json job>'` prints one JSON
 * result.  scripts/balance.mjs fans the jobs out across cores.
 */
import { playArena, duel, hubTransit, staticTables } from './balance';

const job = JSON.parse(process.argv[2] ?? '{}');
let out: unknown;
switch (job.kind) {
  case 'arena': out = playArena(job); break;
  case 'duel': out = duel(job.weapon, job.subtype, !!job.gunned, job.wave ?? 0); break;
  case 'duels': out = (job.list as Array<{ weapon: string; subtype: string; gunned: boolean }>).map((d) => duel(d.weapon, d.subtype, d.gunned)); break;
  case 'transit': out = hubTransit(job.portal, job.seed ?? 1); break;
  case 'static': out = staticTables(); break;
  default: throw new Error(`balance-cli: unknown job kind ${job.kind}`);
}
process.stdout.write(JSON.stringify(out));
