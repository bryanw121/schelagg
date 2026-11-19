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
import { mergeEvents, missingListings, readEventSources } from '../lib/event-sources.js';
import { handleOf, readInstagram } from '../lib/instagram.js';
import { saveAvatars, stampAvatars } from '../lib/avatars.js';

const args = new Set(process.argv.slice(2));
const OUT = repoPath('public/data/events.json');
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const now = Date.now();
// What the listing readers last found, kept beside the feed: the feed has other writers, and one
// that rewrites the file must not cost the listing events until the next read (up to 5 hours).
const CACHE = repoPath('public/data/event-listings.json');
if (args.has('--if-due') && previous?.listingsAt && now - Date.parse(previous.listingsAt) < 5 * 3600e3) {
  const cached = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')).events : [];
  const back = missingListings(previous.events, cached, todayIn(new Date(now)));
  if (back.length && !args.has('--dry')) {
    const events = [...previous.events, ...back].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
    writeFileSync(OUT, `${JSON.stringify({ ...previous, generatedAt: new Date(now).toISOString(), events }, null, 1)}\n`);
    console.log(`Put back ${back.length} listing event(s) another writer had dropped: ${back.map((e) => e.title).join('; ')}`);
  } else console.log(`Listing events were read at ${previous.listingsAt}; not due yet.`);
  process.exit(0);
}
const config = JSON.parse(readFileSync(repoPath('config/events.json'), 'utf8'));
const regions = loadRegions().map((r) => r.info);
const today = todayIn(new Date(now));
const results = await readEventSources(config, { get, today, regions });
// Instagram organizers through Meta's official API, when its two secrets exist (lib/instagram.js).
// Besides the configured accounts' posts, it looks up the profile picture of any account the feed
// already credits and has no fresh picture for.
const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
const AVATARS = repoPath('public/data/avatars');
let profiles = {};
if (IG_USER_ID && IG_ACCESS_TOKEN) {
  const ig = JSON.parse(readFileSync(repoPath('config/instagram.json'), 'utf8'));
  const index = existsSync(`${AVATARS}/index.json`) ? JSON.parse(readFileSync(`${AVATARS}/index.json`, 'utf8')) : {};
  const stale = (h) => !index[h] || now - Date.parse(index[h].fetchedAt) > 7 * 864e5;
  const credited = [...new Set((previous?.events ?? []).map((e) => handleOf(e.source)).filter(Boolean))].filter(stale);
  const r = await readInstagram(ig, { get, today, igUserId: IG_USER_ID, token: IG_ACCESS_TOKEN, extraHandles: credited });
  results.push({ id: 'instagram', ok: r.ok, error: r.error, events: r.events });
  profiles = Object.fromEntries(Object.entries(r.profiles).filter(([h]) => stale(h)));
  if (r.skipped.length) console.log(`Instagram: couldn't read ${r.skipped.map((h) => `@${h}`).join(', ')} (personal, private or renamed accounts).`);
} else console.log('Instagram: IG_USER_ID / IG_ACCESS_TOKEN not set; skipped.');
for (const r of results) for (const e of r.events) e.sourceId = r.id;
const events = mergeEvents(previous, results, today, config.sources.map((s) => s.name));
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: ${r.events.length} events${r.error ? ` (${r.error})` : ''}`);
console.log(`${events.length} events in the feed.`);
if (args.has('--dry')) {
  for (const e of results.flatMap((r) => r.events)) console.log(`  ${e.startDate}${e.endDate ? `..${e.endDate}` : ''}  ${e.kind.padEnd(8)} ${e.tags.join(',').padEnd(14)} ${e.title} · ${e.venue}${Number.isFinite(e.lat) ? '' : ' (no pin)'}`);
  process.exit(0);
}
if (Object.keys(profiles).length) console.log(`Saved ${await saveAvatars(profiles, AVATARS, { now })} profile picture(s).`);
stampAvatars(events, AVATARS);
const feed = { ...(previous ?? {}), feedVersion: 1, generatedAt: new Date(now).toISOString(), listingsAt: new Date(now).toISOString(), sources: results.map((r) => ({ id: r.id, ok: r.ok, count: r.events.length, ...(r.error ? { error: r.error } : {}) })), events };
mkdirSync(repoPath('public/data'), { recursive: true });
// The listing readers' own events as merged into the feed (with their pins), for missingListings above.
const listingIds = new Set(config.sources.map((x) => x.id));
writeFileSync(CACHE, `${JSON.stringify({ listingsAt: new Date(now).toISOString(), events: events.filter((e) => listingIds.has(e.sourceId)) }, null, 1)}\n`);
writeFileSync(OUT, `${JSON.stringify(feed, null, 1)}\n`);
mkdirSync(repoPath('scrape-failures'), { recursive: true });
const failed = results.filter((r) => !r.ok);
writeFileSync(repoPath('scrape-failures/events-sources.md'), failed.length ? `Events (events.json): ${failed.length} listing source(s) failed; their last events are kept.\n\n${failed.map((r) => `- **${r.id}**: ${r.error}`).join('\n')}\n` : '');
