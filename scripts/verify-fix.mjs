// Decide whether an auto-fix can merge without review: run the full scrape live with the fixed
// code, against the health baseline from before the source changed, and check that the findings
// the fix was made for are gone and nothing else broke (lib/health.js judgeFix).
//
//   node scripts/verify-fix.mjs <baselineDir> <batch.json> [out.json]
//
// <baselineDir> holds health.json and schedule.json as they were before the run that reported
// the change. <batch.json> is that run's scrape-changes.json. Writes { mergeable, reasons,
// sources } to out.json (default verify-result.json). Nothing in the repo is modified: the
// scrape writes to a temp dir.
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSources } from '../lib/registry.js';
import { runScrape, scrapePaths } from '../lib/pipeline.js';
import { judgeFix } from '../lib/health.js';
import { repoPath } from '../lib/paths.js';

const [baseDir, batchFile, outFile = 'verify-result.json'] = process.argv.slice(2);
if (!baseDir || !batchFile) {
  console.error('usage: node scripts/verify-fix.mjs <baselineDir> <batch.json> [out.json]');
  process.exit(2);
}
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };

const baseline = await readJson(join(baseDir, 'health.json'), null);
const baselineSchedule = await readJson(join(baseDir, 'schedule.json'), { sources: [], sessions: [] });
const batch = await readJson(batchFile, []);

let verdict;
if (!baseline) {
  verdict = { mergeable: false, reasons: ['no health baseline from before the change to compare against'] };
} else {
  const dir = await mkdtemp(join(tmpdir(), 'schelagg-verify-'));
  await writeFile(join(dir, 'health.json'), JSON.stringify(baseline));
  await writeFile(join(dir, 'schedule.json'), JSON.stringify(baselineSchedule));
  await copyFile(repoPath('data/watch.json'), join(dir, 'watch.json')).catch(() => {});
  const paths = scrapePaths({
    out: join(dir, 'schedule.json'), feed: join(dir, 'occurrences.json'), watch: join(dir, 'watch.json'),
    health: join(dir, 'health.json'), failures: join(dir, 'failures.md'), changes: join(dir, 'changes.md'),
    changesJson: join(dir, 'changes.json'),
  });
  const { sources, manuals } = loadSources();
  // Every source, whatever its cadence: the point is to see whether the fix clears the findings.
  const r = await runScrape({ sources, manuals, paths, force: true });
  verdict = {
    ...judgeFix({ batch, baseline, baselineSources: baselineSchedule.sources ?? [], verify: { sources: r.out.sources, findings: r.findings } }),
    sources: r.out.sources.map(({ id, ok, count, error }) => ({ id, ok, count, error })),
  };
}

await writeFile(outFile, JSON.stringify(verdict, null, 2) + '\n');
console.log(verdict.mergeable ? 'mergeable: every gate passed' : `not mergeable:\n${verdict.reasons.map((x) => `- ${x}`).join('\n')}`);
