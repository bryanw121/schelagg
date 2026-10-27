// Reclub club discovery (scripts/discover-reclub.mjs) against captured meet pages. Variants of one
// meet page stand in for other clubs, sports and cities. No network: search and fetch are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyClub, discover, distanceKm, judgeMeet, knownSlugs, prBody, readUrls, reclubLinks } from '../scripts/discover-reclub.mjs';
import { meetData } from '../scripts/adapters/reclub.mjs';
import { loadSources } from '../lib/registry.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const VEX = fixture('reclub-meet-VONMM8.html'); // Vex Volleyball at Treehouse Gym, Austin community
const options = loadSources().sources.find((s) => s.id === 'reclub').options;

const asClub = (html, slug, name) => html.replaceAll('"vex_volleyball"', `"${slug}"`).replaceAll('"Vex Volleyball"', `"${name}"`);
const inDallas = (html) => html.replaceAll('Austin, TX, USA', 'Dallas, TX, USA').replaceAll('30.453922', '32.7767').replaceAll('-97.67734', '-96.797');
const asSport = (html, sport) => html.replaceAll('"volleyball"', `"${sport}"`);

const NEW = asClub(VEX, 'north_austin_vb', 'North Austin VB');
const PAGES = {
  'https://reclub.co/m/NEW001': NEW,
  'https://reclub.co/m/NEW002': NEW,
  'https://reclub.co/m/VEX001': VEX,
  'https://reclub.co/m/DAL001': inDallas(asClub(VEX, 'dallas_vb', 'Dallas VB')),
  'https://reclub.co/m/PKL001': asSport(asClub(VEX, 'atx_pickle', 'ATX Pickle'), 'pickleball'),
  'https://reclub.co/m/CLB001': asClub(VEX, 'club_only', 'Club Only'),
  'https://reclub.co/clubs/@club_only': '<a href="/m/CLB001">meet</a>',
};
const fakeFetch = async (url) => {
  const body = PAGES[url];
  return { status: body ? 200 : 404, ok: !!body, text: async () => body ?? 'not found' };
};

test('reclubLinks pulls meet codes and club slugs out of search results', () => {
  const { meets, clubs } = reclubLinks([
    'https://reclub.co/m/NEW001', 'https://reclub.co/m/NEW001?ref=x', 'https://www.reclub.co/m/AB12CD/',
    'https://reclub.co/clubs/@vex_volleyball', 'https://reclub.co/clubs/@club_only/members', 'https://example.com/m/ZZZZZZ',
  ]);
  assert.deepEqual(meets, ['NEW001', 'AB12CD']);
  assert.deepEqual(clubs, ['vex_volleyball', 'club_only']);
});

test('knownSlugs reads the configured clubs', () => {
  assert.ok(knownSlugs(options.clubs).has('vex_volleyball'));
  assert.ok(knownSlugs(options.clubs).has('austin-lawn-club'));
});

test('judgeMeet keeps volleyball in the community or radius, drops other sports and cities', () => {
  const d = options.discover;
  assert.equal(judgeMeet(meetData(VEX), d).ok, true);
  assert.match(judgeMeet(meetData(asSport(VEX, 'pickleball')), d).reason, /pickleball/);
  const dallas = judgeMeet(meetData(inDallas(VEX)), d);
  assert.equal(dallas.ok, false);
  assert.match(dallas.reason, /km away \(Dallas/);
  // Outside the community but inside the radius (e.g. a Round Rock community) still counts.
  const nearby = judgeMeet(meetData(VEX.replaceAll('Austin, TX, USA', 'Round Rock, TX, USA')), d);
  assert.equal(nearby.ok, true);
  assert.ok(Math.abs(distanceKm([30.2672, -97.7431], [32.7767, -96.797]) - 292) < 5);
});

test('discover finds new clubs from meet and club results, once each, skipping known, other-sport and far ones', async () => {
  const search = async (q) => (q.includes('Treehouse')
    ? ['https://reclub.co/m/NEW002', 'https://reclub.co/clubs/@club_only']
    : ['https://reclub.co/m/NEW001', 'https://reclub.co/m/VEX001', 'https://reclub.co/m/DAL001', 'https://reclub.co/m/PKL001', 'https://reclub.co/m/GONE01']);
  const r = await discover({ options, search, fetch: fakeFetch, delayMs: 0 });
  assert.deepEqual(r.candidates.map((c) => c.slug), ['north_austin_vb', 'club_only']);
  const na = r.candidates[0];
  assert.equal(na.name, 'North Austin VB');
  assert.equal(na.url, 'https://reclub.co/clubs/@north_austin_vb');
  assert.equal(na.meets.length, 2);
  assert.match(na.meets[0].venue, /Treehouse/);
  assert.deepEqual(r.rejected.map((x) => x.club).sort(), ['atx_pickle', 'dallas_vb']);
  assert.ok(r.warnings.some((w) => w.includes('GONE01') && w.includes('404')));
  assert.match(prBody(na), /North Austin VB[\s\S]*reclub\.co\/m\/NEW001[\s\S]*Close this pull request/);
});

test('discover stops at maxPages and reports search failures', async () => {
  let calls = 0;
  const search = async (q) => { if (calls++ === 0) throw new Error('search HTTP 429'); return Object.keys(PAGES).filter((u) => u.includes('/m/')); };
  const r = await discover({ options, search, fetch: fakeFetch, delayMs: 0, maxPages: 2 });
  assert.equal(r.pagesRead, 2);
  assert.ok(r.warnings.some((w) => w.includes('429')));
  assert.ok(r.warnings.some((w) => w.includes('stopped after 2 pages')));
});

test('applyClub adds a club to the config once and rejects bad slugs', () => {
  const text = readFileSync(new URL('../config/sources.json', import.meta.url), 'utf8');
  const next = applyClub(text, 'north_austin_vb');
  const clubs = JSON.parse(next).sources.find((s) => s.id === 'reclub').options.clubs;
  assert.equal(clubs.at(-1), 'https://reclub.co/clubs/@north_austin_vb');
  assert.equal(applyClub(next, 'North_Austin_VB'), next);
  assert.equal(applyClub(text, 'vex_volleyball'), text);
  assert.throws(() => applyClub(text, 'x; rm -rf /'), RangeError);
});

test('readUrls takes a JSON array of URLs (or { url } objects) and ignores anything else', () => {
  assert.deepEqual(readUrls('["https://reclub.co/m/NEW001", {"url": "https://reclub.co/clubs/@x"}, 3, "javascript:alert(1)", null]'),
    ['https://reclub.co/m/NEW001', 'https://reclub.co/clubs/@x']);
  assert.deepEqual(readUrls('not json'), []);
  assert.deepEqual(readUrls('{"urls": []}'), []);
});
