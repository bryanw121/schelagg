#!/usr/bin/env node
// Cuts each region's map out of Protomaps' free daily OpenStreetMap build (one file per region,
// public/maps/<region>.pmtiles), read by the site's Map view. Runs in the deploy (pages.yml), which
// caches the result for a month: the map doesn't need to be fresher than that.
//
//   node scripts/build-maps.mjs [--pmtiles <path to the pmtiles CLI>] [--maxzoom 15]
//
// Needs the pmtiles CLI (github.com/protomaps/go-pmtiles); it reads only the part of the planet
// file inside each box, with HTTP range requests. Map data © OpenStreetMap contributors (ODbL).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { loadRegions } from '../lib/regions.js';
import { eventPointsForRegion, overviewBox, regionBox } from '../lib/map-area.js';
import { repoPath } from '../lib/paths.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const PMTILES = arg('pmtiles', 'pmtiles');
const MAXZOOM = arg('maxzoom', '15');

const builds = await (await fetch('https://build-metadata.protomaps.dev/builds.json')).json();
const latest = builds.map((b) => b.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort().at(-1);
if (!latest) throw new Error('no Protomaps build listed');
const planet = `https://build.protomaps.com/${latest}`;

const out = repoPath('public/maps');
mkdirSync(out, { recursive: true });
// The events feed (public/data/events.json, overlaid from the data branch by data-branch.sh pull
// before this runs in the deploy) also pins places on the map, so its points widen each region's
// box: Vista Brewing sits just south of Austin's venue-only box. Absent locally, no widening.
const feedPath = repoPath('public/data/events.json');
const feed = existsSync(feedPath) ? JSON.parse(readFileSync(feedPath, 'utf8')) : null;
const made = [];
for (const r of loadRegions()) {
  const box = regionBox({ center: r.info.center, venues: [...r.venues, ...eventPointsForRegion(feed, r.info)] });
  const file = `${out}/${r.info.id}.pmtiles`;
  execFileSync(PMTILES, ['extract', planet, file, `--bbox=${box.join(',')}`, `--maxzoom=${MAXZOOM}`], { stdio: 'inherit' });
  made.push({ region: r.info.id, bbox: box, maxzoom: +MAXZOOM, bytes: statSync(file).size });
  console.log(`ok    ${r.info.id}: ${(statSync(file).size / 1e6).toFixed(1)} MB, box ${box.join(',')}`);
}
// One light map of everything between the regions (zooms 0-8: highways, city names, water), so the
// site's map can zoom out from one city and into another. A failure here only leaves the map as
// it was: one city at a time.
const OVERVIEW_MAXZOOM = 8;
let overview = null;
if (made.length > 1) {
  try {
    const box = overviewBox(made.map((m) => m.bbox));
    const file = `${out}/overview.pmtiles`;
    execFileSync(PMTILES, ['extract', planet, file, `--bbox=${box.join(',')}`, `--maxzoom=${OVERVIEW_MAXZOOM}`], { stdio: 'inherit' });
    overview = { file: 'overview.pmtiles', bbox: box, maxzoom: OVERVIEW_MAXZOOM, bytes: statSync(file).size };
    console.log(`ok    overview: ${(overview.bytes / 1e6).toFixed(1)} MB, box ${box.join(',')}`);
  } catch (e) { console.log(`FAIL  overview: ${e.message}`); }
}
// Label fonts and map icons, copied next to the maps so the site loads nothing from elsewhere: the
// three Noto Sans styles the basemap uses, for Latin text (0-511) and punctuation (8192-8447), and the
// light and dark icon sheets. Text outside those ranges (rare in these cities) isn't labelled.
const ASSETS = 'https://protomaps.github.io/basemaps-assets';
const save = async (url, file) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};
for (const font of ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']) {
  for (const range of ['0-255', '256-511', '8192-8447']) await save(`${ASSETS}/fonts/${encodeURIComponent(font)}/${range}.pbf`, `${out}/fonts/${font}/${range}.pbf`);
}
for (const flavor of ['light', 'dark']) {
  for (const ext of ['.json', '.png', '@2x.json', '@2x.png']) await save(`${ASSETS}/sprites/v4/${flavor}${ext}`, `${out}/sprites/${flavor}${ext}`);
}
writeFileSync(`${out}/maps.json`, `${JSON.stringify({ source: latest, attribution: '© OpenStreetMap contributors', built: new Date().toISOString(), ...(overview ? { overview } : {}), maps: made }, null, 2)}\n`);
