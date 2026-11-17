#!/usr/bin/env node
// Give every event in public/data/events.json coordinates, so the map can pin it
// (lib/event-venues.js: hand-placed cache first, else the US Census geocoder on the
// venue's street address). The cache is public/data/event-venues.json, keyed by the
// normalized venue string; hand-placed entries there are curated by hand and win. Runs
// after the daily discovery run (or by hand), one geocoder request a second.
//
//   node scripts/geocode-events.mjs          fill in what's missing and write the files
//   node scripts/geocode-events.mjs --dry    print what it would set, write nothing
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadRegions } from '../lib/regions.js';
import { repoPath } from '../lib/paths.js';
import { eventAddress, normalizeVenue, resolveEventVenue } from '../lib/event-venues.js';

const dry = process.argv.includes('--dry');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const FEED = repoPath('public/data/events.json');
const CACHE = repoPath('public/data/event-venues.json');

const feed = JSON.parse(readFileSync(FEED, 'utf8'));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
// The events are Austin's; the guard is its center and radius from region.json.
const region = loadRegions().find((r) => r.info.id === 'austin')?.info ?? null;

let placed = 0, kept = 0, missed = 0;
let cacheChanged = false, feedChanged = false;

for (const e of feed.events ?? []) {
  if (Number.isFinite(e.lat) && Number.isFinite(e.lng)) {
    // Already placed: make sure the cache knows it, so a later feed without
    // coordinates still resolves (the discovery merge is by id, new copy wins).
    const key = normalizeVenue(e.venue);
    if (!cache[key]?.lat) {
      cache[key] = { lat: e.lat, lng: e.lng, located: e.located ?? 'manual', matched: cache[key]?.matched ?? null };
      cacheChanged = true;
    }
    kept++;
    continue;
  }
  const before = cache[normalizeVenue(e.venue)];
  const hit = await resolveEventVenue(e.venue, e.city, cache, { region });
  if (hit) {
    e.lat = hit.lat; e.lng = hit.lng; e.located = hit.located;
    feedChanged = true; placed++;
    const key = normalizeVenue(e.venue);
    if (cache[key]?.lat !== hit.lat || cache[key]?.lng !== hit.lng) {
      cache[key] = { lat: hit.lat, lng: hit.lng, located: hit.located, matched: hit.matched ?? null };
      cacheChanged = true;
    }
    console.log(`  ${e.venue}: ${hit.lat}, ${hit.lng} (${hit.located}${hit.matched ? `, ${hit.matched}` : ''})`);
  } else {
    missed++;
    const key = normalizeVenue(e.venue);
    if (!before?.unresolved) {
      cache[key] = { unresolved: true, lastTried: new Date().toISOString() };
      cacheChanged = true;
    }
    console.log(`  ${e.venue}: ${eventAddress(e.venue) ? 'no match' : 'no address to geocode'} — add a hand-placed entry to ${CACHE}`);
  }
  await pause(1100);
}

if (feedChanged && !dry) writeFileSync(FEED, `${JSON.stringify(feed, null, 2)}\n`);
if (cacheChanged && !dry) writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
console.log(`${placed} placed, ${kept} already had coordinates, ${missed} left without coordinates${dry ? ' (dry run)' : ''}.`);
