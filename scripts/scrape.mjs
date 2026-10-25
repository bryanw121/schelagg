// Scrape every configured source (config/sources.json), merge in hand-checked sessions,
// validate, and write public/data/schedule.json + the public feed occurrences.json.
// A source that fails keeps its last good sessions, flagged so the UI shows "Couldn't recheck".
// The work is runScrape in lib/pipeline.js (tested offline in test/pipeline.test.mjs).
import { loadSources } from '../lib/registry.js';
import { runScrape } from '../lib/pipeline.js';

const { sources, manual } = loadSources();
await runScrape({ sources, manual, summaryFile: process.env.GITHUB_STEP_SUMMARY });
