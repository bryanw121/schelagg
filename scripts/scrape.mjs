// Scrape the sources that are due (each region's config/regions/<id>/sources.json, by cadence),
// merge in hand-checked sessions, validate, and write the combined feed plus one folder per
// region. A source that fails keeps its last good sessions, flagged so the UI shows "Couldn't
// recheck". The work is runScrape in lib/pipeline.js (tested offline in test/pipeline.test.mjs).
//
//   node scripts/scrape.mjs            scrape what's due
//   node scripts/scrape.mjs --all      scrape every source, whatever its cadence
//   node scripts/scrape.mjs --plan     print what's due; with GITHUB_OUTPUT, also write
//                                      due=<n> and browser=true|false for the workflow
//
// With DATABASE_URL set, the run is then written to Schelagg's database (lib/db.js persistRun).
// That never fails the scrape: a failed write goes in scrape-failures.md (the workflow's issue)
// and the JSON feed is published either way.
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv, repoPath } from '../lib/paths.js';
import { ADAPTERS, loadSources } from '../lib/registry.js';
import { planSources, runScrape, scrapePaths } from '../lib/pipeline.js';
import { persistRun } from '../lib/db.js';
import { withOffsite } from '../lib/offsite.js';

loadEnv();

const args = process.argv.slice(2);
const force = args.includes('--all');
// Sources marked "runsAt": "home" are read from the home runner's result, not fetched (lib/offsite.js).
const loaded = loadSources();
const sources = withOffsite(loaded.sources);
const { manuals } = loaded;

if (args.includes('--plan')) {
  let prev = {};
  try { prev = JSON.parse(readFileSync(scrapePaths().out, 'utf8')); } catch { /* first run: everything is due */ }
  const { due, skipped } = planSources(sources, prev, { force });
  const browser = due.some((s) => s.adapter.needsBrowser !== false);
  console.log(`due: ${due.map((s) => s.id).join(', ') || 'none'}`);
  console.log(`not due: ${skipped.map((s) => `${s.id} (${s.cadence})`).join(', ') || 'none'}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `due=${due.length}\nbrowser=${browser}\n`);
  process.exit(0);
}

const startedAt = new Date();
mkdirSync(repoPath('scrape-failures'), { recursive: true });
writeFileSync(repoPath('scrape-failures/database.md'), '');
const result = await runScrape({ sources, manuals, force, summaryFile: process.env.GITHUB_STEP_SUMMARY });
await persistRun({
  url: process.env.DATABASE_URL,
  result,
  startedAt,
  adapters: Object.fromEntries(sources.map((s) => [s.id, Object.keys(ADAPTERS).find((k) => ADAPTERS[k] === s.adapter) ?? null])),
  // Its own file, so a failed database write gets its own issue (the workflow loops over scrape-failures/).
  failuresFile: repoPath('scrape-failures/database.md'),
  summaryFile: process.env.GITHUB_STEP_SUMMARY,
});
