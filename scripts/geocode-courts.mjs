#!/usr/bin/env node
// Give every free public court (config/regions/<id>/public-courts.json) coordinates from its
// address, so the map can pin it (lib/geocode.js: US Census geocoder). Courts that already have
// lat/lng are left alone. Runs in GitHub Actions (geocode-courts.yml), one request a second.
//
//   node scripts/geocode-courts.mjs          fill in what's missing and write the files
//   node scripts/geocode-courts.mjs --dry    print what it would set, write nothing
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { get } from '../lib/http.js';
import { loadRegions } from '../lib/regions.js';
import { censusUrl, hasCoords, parseCensus, placeCourt } from '../lib/geocode.js';

const dry = process.argv.includes('--dry');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let placed = 0, missed = 0;

for (const r of loadRegions()) {
  const file = join(r.dir, 'public-courts.json');
  if (!existsSync(file)) continue;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  let changed = false;
  for (const [i, court] of (doc.courts ?? []).entries()) {
    if (hasCoords(court) || !court.address) continue;
    let hit = null;
    try {
      const res = await get(censusUrl(court.address, r.info.name));
      if (res.ok) hit = parseCensus(JSON.parse(res.text));
    } catch (e) { console.log(`  ${court.park}: ${e.message}`); }
    const next = placeCourt(court, hit, r.info);
    if (next) {
      doc.courts[i] = next; changed = true; placed++;
      console.log(`  ${court.park}: ${next.lat}, ${next.lng} (${hit.matched})`);
    } else {
      missed++;
      console.log(`  ${court.park}: ${hit ? `match outside ${r.info.name} (${hit.matched}), skipped` : 'no match'}`);
    }
    await pause(1100);
  }
  if (changed && !dry) writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}
console.log(`${placed} placed, ${missed} left without coordinates${dry ? ' (dry run)' : ''}.`);
