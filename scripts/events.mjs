#!/usr/bin/env node
// Build the Events tab's listing-site events into public/data/events.json (lib/event-sources.js),
// merged with whatever else the feed carries. Coordinates for venues without them come after,
// from scripts/geocode-events.mjs.
//
//   node scripts/events.mjs            build now
//   node scripts/events.mjs --if-due   build only if the last build is 5+ hours old (the scrape
//                                      workflow runs this every tick)
//   node scripts/events.mjs --dry      print what it found, write nothing
//   node scripts/events.mjs --now      build now (the same as no flag; the workflow passes it on a code push)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { get } from '../lib/http.js';
import { repoPath } from '../lib/paths.js';
import { loadRegions } from '../lib/regions.js';
import { today as todayIn } from '../lib/time.js';
import { mergeEvents, readEventSources } from '../lib/event-sources.js';

const args = new Set(process.argv.slice(2));
const OUT = repoPath('public/data/events.json');
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const now = Date.now();
if (args.has('--if-due') && previous?.listingsAt && now - Date.parse(previous.listingsAt) < 5 * 3600e3) {
  console.log(`Listing events were read at ${previous.listingsAt}; not due yet.`);
  process.exit(0);
}
const config = JSON.parse(readFileSync(repoPath('config/events.json'), 'utf8'));
const regions = loadRegions().map((r) => r.info);
const today = todayIn(new Date(now));
const results = await readEventSources(config, { get, today, regions });
for (const r of results) for (const e of r.events) e.sourceId = r.id;
const events = mergeEvents(previous, results, today, config.sources.map((s) => s.name));
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: ${r.events.length} events${r.error ? ` (${r.error})` : ''}`);
console.log(`${events.length} events in the feed.`);
if (args.has('--dry')) {
  for (const e of results.flatMap((r) => r.events)) console.log(`  ${e.startDate}${e.endDate ? `..${e.endDate}` : ''}  ${e.kind.padEnd(8)} ${e.tags.join(',').padEnd(14)} ${e.title} · ${e.venue}${Number.isFinite(e.lat) ? '' : ' (no pin)'}`);
  process.exit(0);
}
const feed = { ...(previous ?? {}), feedVersion: 1, generatedAt: new Date(now).toISOString(), listingsAt: new Date(now).toISOString(), sources: results.map((r) => ({ id: r.id, ok: r.ok, count: r.events.length, ...(r.error ? { error: r.error } : {}) })), events };
mkdirSync(repoPath('public/data'), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(feed, null, 1)}\n`);
mkdirSync(repoPath('scrape-failures'), { recursive: true });
const failed = results.filter((r) => !r.ok);
writeFileSync(repoPath('scrape-failures/events-sources.md'), failed.length ? `Events (events.json): ${failed.length} listing source(s) failed; their last events are kept.\n\n${failed.map((r) => `- **${r.id}**: ${r.error}`).join('\n')}\n` : '');
