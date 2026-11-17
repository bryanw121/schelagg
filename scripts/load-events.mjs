#!/usr/bin/env node

// Load public/data/events.json (the daily discovery feed, published on the data branch)
// into Schelagg's database (lib/events.js persistEvents).
//
//   node scripts/load-events.mjs
//
// With DATABASE_URL set, the feed is written to the events table (db/migrations/0002_events.sql).
// Without it this is a notice and exits 0: the JSON feed is the fallback, as with the scrape.
// A failed write goes in scrape-failures/events.md (the workflow's issue) and still exits 0;
// the next run loads the database again.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv, repoPath } from '../lib/paths.js';
import { persistEvents } from '../lib/events.js';

loadEnv();

const OUT = repoPath('public/data/events.json');
const FAILURES = repoPath('scrape-failures/events.md');

mkdirSync(repoPath('scrape-failures'), { recursive: true });

if (!existsSync(OUT)) {
  console.log('::notice::public/data/events.json is not present yet; nothing to load.');
  process.exit(0);
}

const feed = JSON.parse(readFileSync(OUT, 'utf8'));

const result = await persistEvents({
  url: process.env.DATABASE_URL,
  feed,
  failuresFile: FAILURES,
});

if (result.skipped) {
  console.log('::notice::DATABASE_URL is not set; skipping the events load.');
} else if (result.ok) {
  const { events, added, changed, removed, expired } = result.stats;
  console.log(`${events} events in the feed (+${added} ~${changed} -${removed}, ${expired} expired).`);
}

// A failed load goes in the failure report the workflow turns into an issue;
// anything else clears it, so the issue closes on recovery.
if (result.ok || result.skipped) writeFileSync(FAILURES, '');
