// Reclub club discovery (scripts/discover-reclub.mjs) against captured meet pages. Variants of one
// meet page stand in for other clubs, sports and cities. No network: search and fetch are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyClub, budgetFor, communityClubs, discover, distanceKm, intervalDays, judgeMeet, knownSlugs, nextState, planQueries, prBody, readResults, reclubLinks, reclubOptions, seedsFromVenues } from '../scripts/discover-reclub.mjs';
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
  const text = readFileSync(new URL('../config/regions/austin/sources.json', import.meta.url), 'utf8');
  const next = applyClub(text, 'north_austin_vb');
  const clubs = JSON.parse(next).sources.find((s) => s.id === 'reclub').options.clubs;
  assert.equal(clubs.at(-1), 'https://reclub.co/clubs/@north_austin_vb');
  assert.equal(applyClub(next, 'North_Austin_VB'), next);
  assert.equal(applyClub(text, 'vex_volleyball'), text);
  assert.throws(() => applyClub(text, 'x; rm -rf /'), RangeError);
});




test('reclubOptions finds the Reclub source in loaded sources (adapter resolved to its module)', () => {
  const opts = reclubOptions(loadSources().sources);
  assert.ok(opts.discover.queries.length >= 5);
  assert.deepEqual([budgetFor(opts.discover, 'brave'), budgetFor(opts.discover, 'claude')], [100, 20]);
});

test('readResults keeps which query found what; a plain array has no query; junk is ignored', () => {
  const r = readResults('{"q1": ["https://reclub.co/m/NEW001", {"url": "https://reclub.co/clubs/@x"}, "javascript:alert(1)"], "q2": []}');
  assert.deepEqual([...r.byQuery], [['q1', ['https://reclub.co/m/NEW001', 'https://reclub.co/clubs/@x']], ['q2', []]]);
  assert.deepEqual(readResults('["https://reclub.co/m/A1B2C3", 3]'), { byQuery: new Map(), extra: ['https://reclub.co/m/A1B2C3'] });
  assert.deepEqual(readResults('not json'), { byQuery: new Map(), extra: [] });
});

test('planQueries: new first, productive weekly, quiet ones back off to 2/4/8 weeks, capped by budget', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(intervalDays), [7, 14, 28, 56, 56]);
  const today = '2026-11-04';
  const state = { queries: {
    found: { lastRun: '2026-10-28', empty: 0, lastFound: '2026-10-28' },  // 7 days ago, wait 7: due
    quiet1: { lastRun: '2026-10-28', empty: 1 },                          // 7 days ago, wait 14: not due
    quiet2: { lastRun: '2026-10-07', empty: 2 },                          // 28 days ago, wait 28: due
    dead: { lastRun: '2026-09-16', empty: 5 },                            // 49 days ago, wait 56: not due
    late: { lastRun: '2026-10-14', empty: 0 },                            // 21 days ago, wait 7: 3x overdue
  } };
  const all = ['found', 'quiet1', 'quiet2', 'dead', 'late', 'brand-new'];
  const p = planQueries({ queries: all, state, today, budget: 10 });
  assert.deepEqual(p.batch, ['found', 'brand-new', 'late', 'quiet2']); // proven, new, then most overdue
  assert.deepEqual([p.due, p.total], [4, 6]);
  // Budget 2: the proven query keeps its weekly slot; one slot is kept for new / overdue.
  assert.deepEqual(planQueries({ queries: all, state, today, budget: 2 }).batch, ['found', 'brand-new']);
  assert.deepEqual(planQueries({ queries: ['x', 'y'], state: {}, today, budget: 1 }).batch, ['x']);
});

test('planQueries keeps productive queries weekly however long the list gets', () => {
  // 50 queries: 10 keep finding clubs, 40 have found nothing for 3+ runs. Simulate 16 weeks at budget 20.
  const all = Array.from({ length: 50 }, (_, i) => `q${i}`);
  const productive = new Set(all.slice(0, 10));
  let state = {};
  const ran = Object.fromEntries(all.map((q) => [q, []]));
  for (let w = 0; w < 16; w++) {
    const today = new Date(Date.UTC(2026, 10, 4 + 7 * w)).toISOString().slice(0, 10);
    const { batch } = planQueries({ queries: all, state, today, budget: 20 });
    for (const q of batch) ran[q].push(w);
    const credited = batch.filter((q) => productive.has(q));
    state = nextState(state, { queries: all, batch, today, result: { credited, candidates: [], rejected: [], failedQueries: [] } });
  }
  // Once a query has found something, it runs every week from then on, even while new ones queue.
  for (const q of productive) {
    const first = ran[q][0];
    assert.deepEqual(ran[q], Array.from({ length: 16 - first }, (_, i) => i + first), q);
    assert.ok(first <= 2, `${q} first ran in week ${first}`); // 50 new queries at 20 a run: all start within 3 weeks
  }
  // Quiet ones still come round at least every 8 weeks.
  for (const q of all.slice(10)) {
    const gaps = ran[q].slice(1).map((w, i) => w - ran[q][i]);
    assert.ok(Math.max(...gaps) <= 8, `${q}: ${ran[q]}`);
  }
});

test('nextState: credit resets the wait, failures stay due, removed queries dropped, clubs and meets remembered', () => {
  const state = { queries: { a: { lastRun: '2026-10-21', empty: 2 }, b: { lastRun: '2026-10-21', empty: 0 }, gone: { lastRun: '2026-10-01', empty: 0 } },
    skipped: { old: { on: '2026-01-01', reason: 'x' }, recent: { on: '2026-10-01', reason: 'y' } } };
  const result = { credited: ['a'], failedQueries: ['c'], candidates: [{ slug: 'New_Club' }], rejected: [{ club: 'Pickle', reason: 'sport is pickleball' }], meets: { M1: 'new_club' } };
  const s = nextState(state, { queries: ['a', 'b', 'c'], batch: ['a', 'b', 'c'], result, today: '2026-10-28' });
  assert.deepEqual(s.queries, { a: { lastRun: '2026-10-28', empty: 0, lastFound: '2026-10-28' }, b: { lastRun: '2026-10-28', empty: 1 } });
  assert.deepEqual(s.clubs, { new_club: '2026-10-28' });
  assert.deepEqual(Object.keys(s.skipped), ['recent', 'pickle']); // 'old' expired after 180 days
  assert.deepEqual(s.meets, { M1: 'new_club' });
});

test('discover: credits the queries that found each club, skips what the state already knows, reads seed clubs', async () => {
  const byQuery = {
    'q-meet': ['https://reclub.co/m/NEW001'],
    'q-club': ['https://reclub.co/clubs/@club_only'],
    'q-known': ['https://reclub.co/m/VEX001', 'https://reclub.co/m/DAL001'],
    'q-empty': [],
  };
  const calls = [];
  const fetch = async (url, init) => { calls.push(String(url)); return fakeFetch(url, init); };
  const r = await discover({ options, search: async (q) => byQuery[q], fetch, delayMs: 0, queries: Object.keys(byQuery), seedClubs: ['seed_club'], communities: [] });
  assert.deepEqual(r.candidates.map((c) => [c.slug, c.queries]), [['north_austin_vb', ['q-meet']], ['club_only', ['q-club']]]);
  assert.deepEqual(r.credited, ['q-meet', 'q-club']);
  assert.ok(calls.includes('https://reclub.co/clubs/@seed_club')); // checked without a search (404 here: a warning)
  assert.deepEqual(r.meets, { NEW001: 'north_austin_vb', CLB001: 'club_only', VEX001: 'vex_volleyball', DAL001: 'dallas_vb' });

  // Next run with that state: the same results cost no Reclub pages at all.
  const state = nextState({}, { queries: Object.keys(byQuery), batch: Object.keys(byQuery), result: r, today: '2026-10-28' });
  calls.length = 0;
  const again = await discover({ options, search: async (q) => byQuery[q], fetch, delayMs: 0, queries: Object.keys(byQuery), state, communities: [] });
  assert.deepEqual([again.candidates.length, again.credited, calls], [0, [], []]);
});

test('seedsFromVenues: Reclub clubs that discovered venues link to', () => {
  assert.deepEqual(seedsFromVenues([
    { id: 'a', schedule: { surface: 'platform:reclub', platform: 'reclub', company: 'gym_club' } },
    { id: 'b', schedule: { surface: 'platform:daysmart', platform: 'daysmart', company: 'rink' } },
    { id: 'c' },
  ]), ['gym_club']);
});

// A Reclub community page links each club as href="/clubs/@<slug>" (reclub.co/communities/us/texas/austin, Oct 31, 2026).
const community = (...slugs) => `<a href="/communities">Communities</a>${slugs.map((x) => `<a href="/clubs/@${x}" class="club">${x}</a>`).join('')}<a href="/platform/clubs">Clubs</a>`;

test('communityClubs reads the club links off a community page', () => {
  assert.deepEqual(communityClubs(community('austin-lawn-club', 'atx.womens_vb', 'austin-lawn-club')), ['austin-lawn-club', 'atx.womens_vb']);
  assert.deepEqual(communityClubs('<a href="https://reclub.co/clubs/@vex_volleyball/">x</a><a href="/clubs">all</a>'), ['vex_volleyball']);
});

test('discover: community pages find clubs without any search, nearest cities first, a few per run', async () => {
  const pages = {
    ...PAGES,
    'https://reclub.co/communities/us/texas/austin': community('vex_volleyball', 'club_only'),
    'https://reclub.co/communities/us/texas': community('club_only', 'dallas_club', 'houston_club', 'another'),
    'https://reclub.co/clubs/@dallas_club': '<a href="/m/DAL001">meet</a>',
  };
  const calls = [];
  const fetch = async (url) => { calls.push(String(url)); const body = pages[url]; return { status: body ? 200 : 404, ok: !!body, text: async () => body ?? 'not found' }; };
  const communities = ['https://reclub.co/communities/us/texas/austin', 'https://reclub.co/communities/us/texas', 'https://evil.example/communities/x'];
  const r = await discover({ options, search: async () => [], fetch, delayMs: 0, queries: [], communities, communityClubsPerRun: 2 });
  // vex_volleyball is already configured; club_only qualifies; dallas_club is read and rejected; the cap stops there.
  assert.deepEqual(r.candidates.map((c) => [c.slug, c.queries]), [['club_only', ['communities']]]);
  assert.deepEqual(r.rejected.map((x) => x.club), ['dallas_vb']);
  assert.equal(r.fromCommunities, 2);
  assert.deepEqual(r.credited, []); // community finds don't count for any query's schedule
  assert.ok(!calls.some((u) => u.includes('evil.example')), 'only reclub.co community pages are read');
  assert.ok(!calls.includes('https://reclub.co/clubs/@houston_club'), 'clubs past the per-run cap wait for the next run');

  // Next run, with what this one decided: the cap moves on to the clubs not seen yet.
  const state = nextState({}, { queries: [], batch: [], result: r, today: '2026-11-04' });
  calls.length = 0;
  const next = await discover({ options, search: async () => [], fetch, delayMs: 0, queries: [], communities, communityClubsPerRun: 2, state });
  assert.ok(calls.includes('https://reclub.co/clubs/@houston_club'));
  assert.ok(!calls.includes('https://reclub.co/clubs/@club_only'));
});

test('the Austin config lists Reclub community pages for discovery', () => {
  const d = options.discover;
  assert.ok(d.communities.length >= 1);
  assert.ok(d.communities.every((u) => /^https:\/\/reclub\.co\/communities\/us\/texas(\/[a-z-]+)?$/.test(u)));
  assert.equal(d.communities[0], 'https://reclub.co/communities/us/texas/austin');
});
