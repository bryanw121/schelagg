#!/usr/bin/env node
// Give every free public court (config/regions/<id>/public-courts.json) and every venue with an
// address (config/regions/<id>/venues.json) coordinates from that address, so the map can pin it
// (lib/geocode.js: US Census geocoder). Entries that already have lat/lng are left alone. Runs in
// GitHub Actions (geocode-courts.yml), one request a second.
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
  for (const [name, list, label] of [['public-courts.json', 'courts', 'park'], ['venues.json', 'venues', 'name']]) {
    const file = join(r.dir, name);
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    let changed = false;
    for (const [i, item] of (doc[list] ?? []).entries()) {
      if (hasCoords(item) || !item.address) continue;
      let hit = null;
      try {
        // A venue's address is usually complete ("…, Coppell, TX 75019"); a court's is a street in the region.
        const res = await get(/,\s*[A-Z]{2}\b/.test(item.address) ? censusUrl(item.address.replace(/,\s*([^,]+,\s*[A-Z]{2}\b.*)$/, ''), item.address.match(/,\s*([^,]+,\s*[A-Z]{2}\b.*)$/)[1]) : censusUrl(item.address, r.info.name));
        if (res.ok) hit = parseCensus(JSON.parse(res.text));
      } catch (e) { console.log(`  ${item[label]}: ${e.message}`); }
      const next = placeCourt(item, hit, r.info);
      if (next) {
        doc[list][i] = next; changed = true; placed++;
        console.log(`  ${item[label]}: ${next.lat}, ${next.lng} (${hit.matched})`);
      } else {
        missed++;
        console.log(`  ${item[label]}: ${hit ? `match outside ${r.info.name} (${hit.matched}), skipped` : 'no match'}`);
      }
      await pause(1100);
    }
    if (changed && !dry) writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
}
console.log(`${placed} placed, ${missed} left without coordinates${dry ? ' (dry run)' : ''}.`);
