// Scrape every configured source (config/sources.json), merge in hand-checked sessions,
// validate, and write public/data/schedule.json + the public feed occurrences.json.
// A source that fails keeps its last good sessions, flagged so the UI shows "Couldn't recheck".
// The work is runScrape in lib/pipeline.js (tested offline in test/pipeline.test.mjs).
//
// With DATABASE_URL set, the run is then written to Schelagg's database (lib/db.js persistRun).
// That never fails the scrape: a failed write goes in scrape-failures.md (the workflow's issue)
// and the JSON feed is published either way.
import { loadEnv } from '../lib/paths.js';
import { ADAPTERS, loadSources } from '../lib/registry.js';
import { runScrape, scrapePaths } from '../lib/pipeline.js';
import { persistRun } from '../lib/db.js';

loadEnv();

const { sources, manual } = loadSources();
const startedAt = new Date();
const result = await runScrape({ sources, manual, summaryFile: process.env.GITHUB_STEP_SUMMARY });
await persistRun({
  url: process.env.DATABASE_URL,
  result,
  startedAt,
  adapters: Object.fromEntries(sources.map((s) => [s.id, Object.keys(ADAPTERS).find((k) => ADAPTERS[k] === s.adapter) ?? null])),
  failuresFile: scrapePaths().failures,
  summaryFile: process.env.GITHUB_STEP_SUMMARY,
});
