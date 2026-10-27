// Sport discovery (scripts/discover.mjs) on synthetic Overpass / Places / website responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  overpassQuery, overpass, parseOverpass, pageLinks, detectPlatforms, classifySchedule, matchVenues, mergePlaces,
  discover, reportMarkdown, applyToVenues, loadDiscovery, loadPlatforms, slug, enrichments,
} from '../scripts/discover.mjs';
import { loadVenues } from '../lib/consolidate.js';

const DISCOVERY = loadDiscovery();
const PLATFORMS = loadPlatforms();
const VENUES = loadVenues();

const OVERPASS = { elements: [
  { type: 'way', id: 11, center: { lat: 30.37, lon: -97.73 }, tags: { leisure: 'ice_rink', name: 'Chaparral Ice', website: 'https://example.test/chaparral', sport: 'ice_skating;ice_hockey', building: 'yes' } },
  { type: 'node', id: 22, lat: 30.2, lon: -97.8, tags: { leisure: 'ice_rink', name: 'Frosty Rink', website: 'https://frosty.test/', seasonal: 'yes', indoor: 'no' } },
  { type: 'way', id: 33, center: { lat: 30.5, lon: -97.6 }, tags: { leisure: 'pitch', sport: 'pickleball', name: 'Park Courts', courts: '6', lit: 'yes', access: 'yes' } },
  { type: 'way', id: 44, center: { lat: 30.51, lon: -97.61 }, tags: { leisure: 'pitch', sport: 'pickleball' } }, // unnamed: skipped
  { type: 'relation', id: 55, center: { lat: 30.2, lon: -97.8 }, tags: { leisure: 'ice_rink', name: 'Frosty Rink' } }, // same place twice
] };
const PAGES = {
  'https://frosty.test/': '<a href="/public-skating">Public skating</a><a href="/about">About</a><script src="https://cdn.example.test/x.js"></script>',
  'https://frosty.test/public-skating': '<iframe src="https://apps.daysmartrecreation.com/dash/x/#/online/frostyice/calendar?location=1"></iframe>',
  'https://example.test/chaparral': '<a href="https://apps.daysmartrecreation.com/dash/x/#/online/chaparralice/calendar">Calendar</a>',
};
const fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/api/interpreter')) {
    assert.equal(init?.method, 'POST');
    assert.match(String(init.body), /^data=%5Bout%3Ajson%5D%5Btimeout%3A90%5D%5Bbbox%3A/);
    return new Response(JSON.stringify(OVERPASS));
  }
  return PAGES[u] ? new Response(PAGES[u]) : new Response('not found', { status: 404 });
};

test('overpassQuery asks for each selector inside the box around the center', () => {
  assert.equal(overpassQuery(['nwr["leisure"="ice_rink"]'], [30.2672, -97.7431], 60),
    '[out:json][timeout:90][bbox:29.7282,-98.3672,30.8062,-97.119];(nwr["leisure"="ice_rink"];);out tags center;');
});

test('parseOverpass: named places with attributes; unnamed and duplicate places dropped', () => {
  const v = parseOverpass(OVERPASS);
  assert.deepEqual(v.map((x) => x.osm), ['way/11', 'node/22', 'way/33']);
  assert.deepEqual([v[0].indoor, v[0].sports], [true, ['ice_skating', 'ice_hockey']]);
  assert.deepEqual([v[1].indoor, v[1].seasonal], [false, true]);
  assert.deepEqual([v[2].indoor, v[2].courts, v[2].lit, v[2].access], [false, 6, true, 'yes']);
});

test('platform detection from links, iframes and scripts, with the venue account', () => {
  const urls = pageLinks('<a href="https://reclub.co/clubs/@vex_volleyball">x</a><iframe src="//austinvelocity.skedda.com/booking"></iframe><a href="/cal.ics">ics</a><a href="https://app.courtreserve.com/Online/Portal/Index/123">book</a>', 'https://v.test/');
  const found = detectPlatforms(urls, PLATFORMS);
  assert.deepEqual(found.map((p) => [p.id, p.company ?? null]), [['reclub', 'vex_volleyball'], ['skedda', 'austinvelocity'], ['ics', null], ['courtreserve', null]]);
  assert.equal(found.find((p) => p.id === 'courtreserve').loginOnly, true);
});

test('classifySchedule follows schedule-looking links on the same site', async () => {
  const s = await classifySchedule('https://frosty.test/', { platforms: PLATFORMS, fetch, delayMs: 0 });
  assert.equal(s.surface, 'platform:daysmart');
  assert.deepEqual([s.platforms[0].company, s.platforms[0].adapter], ['frostyice', 'daysmart']);
  assert.deepEqual(s.checked, ['https://frosty.test/', 'https://frosty.test/public-skating']); // /about isn't followed
  assert.equal((await classifySchedule(null, { platforms: PLATFORMS, fetch })).surface, 'unknown');
  assert.match((await classifySchedule('https://gone.test/', { platforms: PLATFORMS, fetch })).error, /404/);
});

test('matching: known venues by name, OSM or Google id; ignore list; Google merged into OSM by name', () => {
  const merged = mergePlaces(parseOverpass(OVERPASS), [
    { googlePlaceId: 'g-frosty', name: 'Frosty Rink', website: null },
    { googlePlaceId: 'g-new', name: 'Brand New Rink', website: 'https://new.test/' },
  ]);
  assert.equal(merged.find((p) => p.name === 'Frosty Rink').googlePlaceId, 'g-frosty');
  assert.equal(merged.at(-1).name, 'Brand New Rink');
  const { known, fresh } = matchVenues(merged, VENUES, ['Park Courts']);
  assert.deepEqual(known.map((k) => k.venue), ['chaparral-northcross']);
  assert.deepEqual(fresh.map((p) => p.name), ['Frosty Rink', 'Brand New Rink']);
  // Known venues get gaps filled, never overwritten.
  assert.deepEqual(enrichments(known, VENUES), [{ id: 'chaparral-northcross', fields: { osm: 'way/11', lat: 30.37, lng: -97.73, website: 'https://example.test/chaparral' } }]);
  assert.equal(slug('Frosty Rink & Café!'), 'frosty-rink-cafe');
});

test('discover: a full run for ice skating, its report, and applying it to the venues config', async () => {
  const google = async () => [{ googlePlaceId: 'g-new', name: 'Brand New Rink', website: null }];
  const r = await discover({ sport: 'ice_skating', region: 'austin', discovery: DISCOVERY, platforms: PLATFORMS, venues: VENUES, fetch, google, delayMs: 0 });
  assert.deepEqual(r.counts, { osm: 3, google: 2, known: 1, new: 3 }); // google stub answers both queries
  assert.deepEqual(r.candidates.map((c) => [c.entry.id, c.entry.schedule.surface]), [
    ['frosty-rink', 'platform:daysmart'], ['park-courts', 'unknown'], ['brand-new-rink', 'unknown'],
  ]);
  assert.equal(r.candidates[0].entry.schedule.company, 'frostyice');
  const md = reportMarkdown(r);
  assert.match(md, /\*\*3 new\*\*/);
  assert.match(md, /\| Frosty Rink \| outdoor \| platform:daysmart: DaySmart Recreation \(`frostyice`\)/);
  assert.match(md, /Readable now:\*\* Frosty Rink \(daysmart\)/);
  assert.match(md, /Filled in on known venues:\*\* `chaparral-northcross` \(osm, lat, lng, website\)/);
  const text = readFileSync(new URL('../config/venues.json', import.meta.url), 'utf8');
  const next = JSON.parse(applyToVenues(text, r));
  assert.equal(next.venues.length, VENUES.length + 3);
  assert.equal(next.venues.find((v) => v.id === 'chaparral-northcross').osm, 'way/11');
  assert.deepEqual(next.venues.find((v) => v.id === 'frosty-rink').sports, ['ice_skating']);
  await assert.rejects(discover({ sport: 'curling', region: 'austin', discovery: DISCOVERY, platforms: PLATFORMS, venues: VENUES, fetch }), /unknown sport/);
});

test('overpass: falls back to the next instance when one refuses', async () => {
  const calls = [];
  const f = async (url) => { calls.push(new URL(url).hostname); return calls.length === 1 ? new Response('no', { status: 406 }) : new Response('{"elements":[]}'); };
  assert.deepEqual(await overpass('[out:json];', { fetch: f }), { elements: [] });
  assert.deepEqual(calls, ['overpass-api.de', 'overpass.private.coffee']);
});

test('discover: OpenStreetMap down is a warning, not a crash', async () => {
  const down = async () => new Response('busy', { status: 504 });
  const r = await discover({ sport: 'pickleball', region: 'austin', discovery: DISCOVERY, platforms: PLATFORMS, venues: VENUES, fetch: down });
  assert.deepEqual([r.counts.osm, r.candidates.length], [0, 0]);
  assert.deepEqual(r.warnings, ['OpenStreetMap: overpass-api.de HTTP 504, overpass.private.coffee HTTP 504, overpass.kumi.systems HTTP 504']);
  const text = readFileSync(new URL('../config/venues.json', import.meta.url), 'utf8');
  assert.equal(applyToVenues(text, r), text, 'nothing found: config untouched');
  assert.equal(JSON.stringify(JSON.parse(text), null, 2) + '\n', text, 'venues.json is kept in the format applyToVenues writes');
});
