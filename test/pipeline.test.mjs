// The scheduled jobs end to end, offline: runScrape (scripts/scrape.mjs) over the real source
// config with every adapter fed fixtures (Arketa JSON and Reclub pages via a stub fetch; the
// browser-based adapters via a fake browser that returns page text), and buildCourts
// (scripts/build-courts.mjs) against a synthetic Skedda. Output goes to a temp dir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSources } from '../lib/registry.js';
import { repoPath } from '../lib/paths.js';
import { validateSessions, SCHEMA_VERSION, SPORT_ATTRIBUTES } from '../lib/session.js';
import { FEED_VERSION } from '../lib/occurrences.js';
import { VENUES } from '../lib/skedda.js';
import { runScrape, scrapePaths, buildCourts, HORIZON_DAYS, FEED_HORIZON_DAYS } from '../lib/pipeline.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-25T20:00:00Z'); // Sunday 3pm in Austin
const REF = '2026-10-25';
const { sources: SOURCES, manual: MANUAL } = loadSources();
const ADAPTER_IDS = ['volleyworld', 'aces', 'atxbeach', 'velocity', 'reclub'];

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = () => { throw new Error('no network in tests: inject a fetch'); }; });
after(() => { globalThis.fetch = realFetch; });

const tmp = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'schelagg-test-')); tmp.push(d); return d; };
after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// --- inputs -------------------------------------------------------------------------------

// Page text for the browser adapters, worded like the live pages (see parsers.test.mjs).
const PAGE_TEXT = {
  'https://acesintexas.com/ptx-monday-indoor-open-plays-volleyworld-pflugerville/':
    'OCTOBER 26 REGISTER\nIndoor Open Play Start: October 26\nOpen Play Time: 7:30 PM – 10 PM\nIndoor Pricing (individual): $6.00\nDoor Pricing : $10.00',
  'https://acesintexas.com/wednesday-indoor-open-plays-volleyworld-pflugerville/':
    'Wednesday Open Play\nOpen Play Start: Wednesday, Oct. 28\nOpen Play Time: 7:30 to 10:00 p.m.\nIndoor Pricing (individual) : $ 6\nDoor Pricing: $10',
  'https://goteamup.com/w9142954/p/9142954-atx-beach/memberships/223927/':
    'Standard Open Play is 7 AM-6 PM Monday thru Friday.\nIncludes access to $20 Friday Night Open Play & Pizza from 7 PM-11 PM, plus any other Special Open Play Sessions announced.',
  'https://www.austinvelocity.com/rentals/adult-volleyball-2':
    'Adult Open Play Volleyball\nSeason Dates: October 1 – December 18, 2026\nWednesday Open Play\nTime: 8PM – Midnight\nLevel: Beginner & Intermediate\nFriday Open Play\nTime: 8PM – Midnight\nLevel: Intermediate & Advanced',
};

/** Enough of Playwright's Browser for the adapters: newPage().goto/locator/innerText/title/close. */
function fakeBrowser(text = PAGE_TEXT) {
  const b = { launched: 0, closed: 0, visited: [] };
  b.newPage = async () => {
    let url = null;
    const body = () => {
      if (!(url in text)) throw new Error(`net::ERR_NAME_NOT_RESOLVED at ${url}`);
      return text[url];
    };
    const locator = () => ({ first: locator, innerText: async () => body() });
    return {
      goto: async (u) => { url = u; b.visited.push(u); body(); },
      locator,
      title: async () => 'Fake page',
      close: async () => {},
    };
  };
  b.close = async () => { b.closed++; };
  b.launch = async () => { b.launched++; return b; };
  return b;
}

const MEETS = { UEY4HO: 'reclub-meet-UEY4HO.html', '1QX0YR': 'reclub-meet-1QX0YR.html', VONMM8: 'reclub-meet-VONMM8.html', '5X380N': 'reclub-meet-5X380N.html' };
const CLUBS = { '/clubs/@vex_volleyball': 'reclub-club-vex_volleyball.html', '/clubs/@austin-lawn-club': 'reclub-club-austin-lawn-club.html' };

/** Hand-checked sessions (synthetic) whose pages the watcher fetches from example.test. */
const MANUAL_SESSIONS = [
  { id: 'manual-sand-sun', days: ['Sun'], start: '19:00', end: '22:00', title: 'Sunday Sand Social', venue: 'ATX Beach', city: 'North Austin',
    surface: 'sand', type: 'Open play', verifiedAt: '2026-10-20', signup: { url: 'https://example.test/sand', label: 'RSVP' }, source: 'https://example.test/sand' },
  { id: 'manual-grass-sat', days: ['Sat'], start: '10:00', end: '13:00', title: 'Saturday Park Play', venue: 'Zilker Park', city: 'Austin',
    surface: 'grass', type: 'Open play', verifiedAt: '2026-10-20', source: 'https://example.test/broken' },
  { id: 'manual-league-tbd', days: ['Thu'], start: null, end: null, title: 'Thursday League', venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville',
    surface: 'indoor', type: 'League', verifiedAt: '2026-10-20' },
  { id: 'manual-bad', title: 'Malformed, no date or days', venue: 'Nowhere', surface: 'indoor', type: 'Open play', verifiedAt: '2026-10-20' },
];

/**
 * The network as the adapters see it. `down` lists hostnames that answer 503; `pages`
 * overrides example.test bodies (the manual watcher).
 */
function network({ down = new Set(), pages = {}, arketa } = {}) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(String(url));
    calls.push(u.href);
    const res = (body, status = 200) => new Response(body, { status });
    if (down.has(u.hostname)) return res('down', 503);
    if (u.hostname === 'widget-api-tkaeguucxq-uc.a.run.app') return res(arketa ?? fixture('arketa-volleyworld-schedule.json'));
    if (u.hostname === 'reclub.co') {
      if (CLUBS[u.pathname]) return res(fixture(CLUBS[u.pathname]));
      const code = u.pathname.match(/^\/m\/(\w+)$/)?.[1];
      return MEETS[code] ? res(fixture(MEETS[code])) : res('Not found', 404); // 2O9PDP has no fixture
    }
    if (u.hostname === 'example.test') {
      if (u.pathname === '/broken') return res('oops', 500);
      return res(pages[u.pathname] ?? '<html><body><h1>Sunday Sand Social</h1><p>7pm, $10</p><script>var t=1</script></body></html>');
    }
    throw new Error(`unexpected host in test: ${u.hostname}`);
  };
  f.calls = calls;
  return f;
}

/** A temp workspace: output paths + a manual.json + public-courts copy; optionally a previous schedule. */
function workspace({ prev } = {}) {
  const dir = tempDir();
  writeFileSync(join(dir, 'manual.json'), JSON.stringify({ sessions: MANUAL_SESSIONS }));
  const paths = scrapePaths({
    out: join(dir, 'schedule.json'),
    feed: join(dir, 'occurrences.json'),
    watch: join(dir, 'watch.json'),
    failures: join(dir, 'scrape-failures.md'),
    health: join(dir, 'health.json'),
    changes: join(dir, 'scrape-changes.md'),
    publicCourts: repoPath('data/public-courts.json'),
    manualFile: (file) => join(dir, file),
  });
  if (prev) writeFileSync(paths.out, JSON.stringify(prev));
  return { dir, paths };
}

async function scrape({ ws = workspace(), fetch = network(), browser = fakeBrowser(), sources = SOURCES, now = NOW, summaryFile } = {}) {
  const logs = [];
  const result = await runScrape({
    sources, manual: { ...MANUAL, file: 'manual.json' }, paths: ws.paths, fetch,
    launchBrowser: browser.launch, now: () => new Date(now), log: (l) => logs.push(l), summaryFile,
  });
  return { ...result, ws, fetch, browser, logs, schedule: readJson(ws.paths.out), occurrences: readJson(ws.paths.feed) };
}

// --- runScrape ----------------------------------------------------------------------------

test('scrape pipeline: every configured source runs on fixtures and schedule.json is publishable', async () => {
  const r = await scrape();
  const { schedule } = r;
  assert.equal(schedule.schemaVersion, SCHEMA_VERSION);
  assert.equal(schedule.generatedAt, NOW.toISOString());
  assert.deepEqual(schedule.publicCourts, readJson(repoPath('data/public-courts.json')));

  // One status per configured source, in config order, all ok.
  assert.deepEqual(schedule.sources.map((s) => s.id), ADAPTER_IDS);
  for (const s of schedule.sources) {
    assert.equal(s.ok, true, `${s.id}: ${s.error}`);
    assert.deepEqual([s.sport, s.region, s.checkedAt], ['volleyball', 'austin', NOW.toISOString()], s.id);
    assert.ok(s.count > 0, s.id);
    assert.equal(s.count, schedule.sessions.filter((x) => x.sourceId === s.id).length, s.id);
  }
  // The meet linked from the club page without a fixture is a warning, not a failure.
  assert.ok(schedule.sources.find((s) => s.id === 'reclub').warnings.some((w) => /2O9PDP: HTTP 404/.test(w)));

  // Every published session passes the publish checks again, with unique ids and tags.
  const ids = schedule.sessions.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'unique session ids');
  assert.equal(validateSessions(schedule.sessions).ok.length, schedule.sessions.length);
  for (const s of schedule.sessions) {
    assert.deepEqual([s.sport, s.region, s.timezone], ['volleyball', 'austin', 'America/Chicago'], s.id);
    assert.ok([...ADAPTER_IDS, 'manual'].includes(s.sourceId), s.id);
    if (s.date) assert.ok(s.date >= REF && s.date <= '2026-11-08', `${s.id} inside the ${HORIZON_DAYS}-day horizon`);
    if (s.sourceId !== 'manual') assert.equal(s.verifiedAt, REF, s.id);
  }
  // Known rows from each kind of source.
  const byId = Object.fromEntries(schedule.sessions.map((s) => [s.id, s]));
  assert.equal(byId['volleyworld-2026-10-25-17:30-georgetown'].canceled, true);
  assert.equal(byId['reclub-VONMM8'].facility, 'treehouse');
  assert.equal(byId['aces-2026-10-26-19:30'].price, '$6 online · $10 door');
  assert.deepEqual(byId['manual-sand-sun'].sourceId, 'manual');
  // The malformed hand-checked session is dropped, not published.
  assert.equal(byId['manual-bad'], undefined);
  assert.ok(r.logs.some((l) => /dropped manual-bad: needs a date or recurring days/.test(l)));

  // One Chromium for all the browser sources, closed at the end.
  assert.deepEqual([r.browser.launched, r.browser.closed], [1, 1]);
  assert.equal(r.failed.length, 0);
  assert.equal(readFileSync(r.ws.paths.failures, 'utf8'), '');
});

test('scrape pipeline: occurrences.json is the documented feed', async () => {
  const { schedule, occurrences: feed } = await scrape();
  assert.deepEqual(Object.keys(feed), ['feedVersion', 'generatedAt', 'horizonDays', 'occurrences']);
  assert.deepEqual([feed.feedVersion, feed.generatedAt, feed.horizonDays], [FEED_VERSION, schedule.generatedAt, FEED_HORIZON_DAYS]);
  assert.ok(feed.occurrences.length > 20);

  const sessions = new Map(schedule.sessions.map((s) => [s.id, s]));
  const ids = feed.occurrences.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'unique occurrence ids');
  const sorted = [...feed.occurrences].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
  assert.deepEqual(ids, sorted.map((o) => o.id), 'sorted by start');
  const KEYS = ['id', 'session_id', 'source_id', 'sport', 'region', 'timezone', 'title', 'venue', 'city', 'level', 'price',
    'starts_at', 'ends_at', 'signup_url', 'signup_label', 'note', 'canceled', 'verified_at', 'attributes'];
  const until = new Date(NOW.getTime() + (FEED_HORIZON_DAYS + 1) * 864e5).toISOString();
  for (const o of feed.occurrences) {
    assert.deepEqual(Object.keys(o), KEYS, o.id);
    assert.deepEqual([o.sport, o.region, o.timezone], ['volleyball', 'austin', 'America/Chicago'], o.id);
    const s = sessions.get(o.session_id);
    assert.ok(s, `${o.id} comes from a published session`);
    assert.equal(o.source_id, s.sourceId, o.id);
    // Dated sessions keep their id; weekly ones get -<local date>.
    if (s.date) assert.equal(o.id, s.id);
    else assert.match(o.id, new RegExp(`^${s.id}-\\d{4}-\\d{2}-\\d{2}$`));
    assert.match(o.starts_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/, o.id);
    assert.ok(o.starts_at >= '2026-10-25T05:00:00.000Z' && o.starts_at < until, `${o.id} inside the feed horizon`);
    if (o.ends_at) assert.ok(o.ends_at > o.starts_at, o.id);
    assert.equal(typeof o.canceled, 'boolean', o.id);
    for (const [k, allowed] of Object.entries(SPORT_ATTRIBUTES.volleyball)) assert.ok(allowed.includes(o.attributes[k]), `${o.id} ${k}`);
  }
  // Sessions without a start time (league before game times) stay out of the feed.
  assert.ok(sessions.has('manual-league-tbd'));
  assert.ok(!feed.occurrences.some((o) => o.session_id === 'manual-league-tbd'));
  // Weekly sessions expand to each matching date: Sundays from Oct 25 through Nov 22.
  assert.deepEqual(feed.occurrences.filter((o) => o.session_id === 'manual-sand-sun').map((o) => o.id),
    ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22'].map((d) => `manual-sand-sun-${d}`));
  // Velocity's season ends Dec 18, so its Wednesday/Friday nights are in the feed.
  assert.ok(feed.occurrences.some((o) => o.source_id === 'velocity'));
});

test('scrape pipeline: the same inputs give byte-identical output', async () => {
  const a = await scrape();
  const b = await scrape();
  for (const k of ['out', 'feed', 'watch', 'failures', 'health', 'changes']) {
    assert.equal(readFileSync(a.ws.paths[k], 'utf8'), readFileSync(b.ws.paths[k], 'utf8'), k);
  }
});

test('scrape pipeline: a failing source keeps its last good sessions, flagged, and records the error', async () => {
  const first = await scrape();
  const prevReclub = first.schedule.sessions.filter((s) => s.sourceId === 'reclub');
  assert.ok(prevReclub.length >= 3);
  // Next hour Reclub is down and the ACES pages don't load; everything else is fine.
  const ws = workspace({ prev: first.schedule });
  const noAces = fakeBrowser(Object.fromEntries(Object.entries(PAGE_TEXT).filter(([k]) => !k.includes('acesintexas'))));
  const summaryFile = join(ws.dir, 'summary.md');
  const later = new Date(NOW.getTime() + 3600e3);
  const r = await scrape({ ws, fetch: network({ down: new Set(['reclub.co']) }), browser: noAces, now: later, summaryFile });

  const status = Object.fromEntries(r.schedule.sources.map((s) => [s.id, s]));
  assert.deepEqual(r.failed.map((s) => s.id), ['aces', 'reclub']);
  assert.equal(status.reclub.ok, false);
  assert.match(status.reclub.error, /reclub\.co\/clubs\/@vex_volleyball: HTTP 503/);
  assert.equal(status.reclub.kept, prevReclub.length);
  assert.equal(status.reclub.checkedAt, later.toISOString());
  assert.match(status.aces.error, /ERR_NAME_NOT_RESOLVED/);
  assert.equal(status.aces.kept, first.schedule.sessions.filter((s) => s.sourceId === 'aces').length);
  assert.equal(status.volleyworld.ok, true);

  // The kept sessions are the previous ones, flagged with the day the recheck failed.
  const kept = r.schedule.sessions.filter((s) => s.sourceId === 'reclub');
  assert.deepEqual(kept.map((s) => s.id).sort(), prevReclub.map((s) => s.id).sort());
  for (const s of kept) {
    assert.equal(s.checkFailed, REF, s.id);
    assert.equal(s.verifiedAt, REF, `${s.id} keeps its last verified date`);
  }
  // Fresh sources aren't flagged, and the kept sessions still reach the feed.
  assert.ok(r.schedule.sessions.filter((s) => s.sourceId === 'volleyworld').every((s) => !s.checkFailed));
  assert.ok(r.occurrences.occurrences.some((o) => o.session_id === 'reclub-VONMM8'));

  // The failures file (turned into a GitHub issue) and the step summary name the failed sources.
  const failures = readFileSync(ws.paths.failures, 'utf8');
  assert.match(failures, /^Sources that failed on 2026-10-25:/);
  assert.match(failures, /❌ \*\*reclub\*\*/);
  assert.match(failures, /❌ \*\*aces\*\*/);
  assert.doesNotMatch(failures, /\*\*volleyworld\*\*/);
  const summary = readFileSync(summaryFile, 'utf8');
  assert.match(summary, /### Schedule scrape 2026-10-25/);
  assert.match(summary, /✅ \*\*volleyworld\*\* \d+ sessions/);
});

test('scrape pipeline: kept sessions that have since passed drop out of the horizon', async () => {
  const prev = {
    sessions: [
      { id: 'reclub-OLD123', sourceId: 'reclub', title: 'Last week', venue: 'Gym', date: '2026-10-18', start: '19:00', end: '21:00', surface: 'indoor', type: 'Open play', verifiedAt: '2026-10-18' },
      { id: 'reclub-NEW123', sourceId: 'reclub', title: 'Next week', venue: 'Gym', date: '2026-10-29', start: '19:00', end: '21:00', surface: 'indoor', type: 'Open play', verifiedAt: '2026-10-24' },
    ],
  };
  const reclubOnly = SOURCES.filter((s) => s.id === 'reclub');
  const r = await scrape({ ws: workspace({ prev }), fetch: network({ down: new Set(['reclub.co']) }), sources: reclubOnly });
  assert.equal(r.schedule.sources[0].kept, 2);
  assert.deepEqual(r.schedule.sessions.filter((s) => s.sourceId === 'reclub').map((s) => s.id), ['reclub-NEW123']);
});

test('scrape pipeline: Chromium only starts when a source needs it', async () => {
  const apiOnly = SOURCES.filter((s) => s.adapter.needsBrowser === false);
  assert.deepEqual(apiOnly.map((s) => s.id), ['volleyworld', 'reclub']);
  const r = await scrape({ sources: apiOnly });
  assert.deepEqual([r.browser.launched, r.browser.closed], [0, 0]);
  assert.ok(r.schedule.sources.every((s) => s.ok));
  // ...and is closed even when the source using it throws.
  const broken = [{ ...SOURCES.find((s) => s.id === 'aces'), adapter: { needsBrowser: true, scrape: async () => { throw new Error('boom'); } } }];
  const b = await scrape({ sources: broken });
  assert.deepEqual([b.browser.launched, b.browser.closed], [1, 1]);
  assert.equal(b.schedule.sources[0].error, 'boom');
});

test('scrape pipeline: hand-checked pages are watched and flagged when they change', async () => {
  const apiOnly = SOURCES.filter((s) => s.id === 'volleyworld');
  const ws = workspace();
  const first = await scrape({ ws, sources: apiOnly });
  const watch1 = readJson(ws.paths.watch);
  assert.deepEqual(Object.keys(watch1), ['https://example.test/sand']);
  assert.equal(watch1['https://example.test/sand'].changedOn, null);
  assert.match(watch1['https://example.test/sand'].hash, /^[0-9a-f]{16}$/);
  const m1 = Object.fromEntries(first.schedule.sessions.filter((s) => s.sourceId === 'manual').map((s) => [s.id, s]));
  assert.equal(m1['manual-sand-sun'].sourceChanged, undefined);
  assert.equal(m1['manual-grass-sat'].watchError, 'HTTP 500');
  assert.equal(m1['manual-league-tbd'].watchError, undefined); // nothing to watch
  // Only the hand-checked pages were fetched from outside the adapters' hosts.
  assert.deepEqual(first.fetch.calls.filter((u) => u.startsWith('https://example.test/')).sort(), ['https://example.test/broken', 'https://example.test/sand']);

  // Same text, different markup and scripts: not a change.
  const same = await scrape({ ws, sources: apiOnly, fetch: network({ pages: { '/sand': '<div><h1>Sunday Sand Social</h1> <p>7pm, $10</p><script>var t=2</script><style>p{}</style></div>' } }) });
  assert.equal(same.schedule.sessions.find((s) => s.id === 'manual-sand-sun').sourceChanged, undefined);
  assert.deepEqual(readJson(ws.paths.watch), watch1);

  // New wording: flagged from today on, and remembered.
  const changed = await scrape({ ws, sources: apiOnly, fetch: network({ pages: { '/sand': '<h1>Sunday Sand Social</h1><p>Moved to 8pm</p>' } }) });
  assert.equal(changed.schedule.sessions.find((s) => s.id === 'manual-sand-sun').sourceChanged, REF);
  assert.equal(readJson(ws.paths.watch)['https://example.test/sand'].changedOn, REF);
  assert.notEqual(readJson(ws.paths.watch)['https://example.test/sand'].hash, watch1['https://example.test/sand'].hash);
});

test('scrape pipeline: a source that still scrapes but changed what it sends is reported once', async () => {
  const volleyworld = SOURCES.filter((s) => s.id === 'volleyworld');
  const ws = workspace();
  const arketa = JSON.parse(fixture('arketa-volleyworld-schedule.json'));
  const withClasses = (classes) => JSON.stringify({ ...arketa, data: { ...arketa.data, classes } });

  // First run: no baseline yet, so only the hand-checked sessions that need a look.
  const first = await scrape({ ws, sources: volleyworld });
  assert.ok(first.fresh.every((f) => f.source === 'manual'));
  const changes1 = readFileSync(ws.paths.changes, 'utf8');
  assert.match(changes1, /^Source changes noticed on 2026-10-25:/);
  assert.match(changes1, /manual-grass-sat: its source page can't be watched \(HTTP 500\)/);
  // The malformed hand-written entry is dropped from the site, and that's reported too.
  assert.match(changes1, /\*\*manual\*\* · New warning: dropped manual-bad: needs a date or recurring days/);
  const usual = first.schedule.sources[0].count;
  assert.ok(usual >= 9);
  const health = readJson(ws.paths.health);
  assert.deepEqual(health.sources.volleyworld.counts, [usual]);
  assert.ok(health.sources.volleyworld.shape.includes('max_capacity'));

  // Same data again: nothing new to report.
  const same = await scrape({ ws, sources: volleyworld });
  assert.equal(same.fresh.length, 0);
  assert.equal(readFileSync(ws.paths.changes, 'utf8'), '');

  // Arketa renames max_capacity: the scrape still works, but capacity and spots left vanish.
  const renamed = withClasses(arketa.data.classes.map(({ max_capacity, ...c }) => ({ ...c, capacity_max: max_capacity })));
  const r = await scrape({ ws, sources: volleyworld, fetch: network({ arketa: renamed }) });
  assert.equal(r.failed.length, 0);
  assert.deepEqual(r.fresh.map((f) => f.kind).sort(), ['fields', 'fields', 'shape']);
  const changes = readFileSync(ws.paths.changes, 'utf8');
  assert.match(changes, /\*\*volleyworld\*\* · Field disappeared: no session has `capacity` any more/);
  assert.match(changes, /\*\*volleyworld\*\* · API data changed shape: the raw data no longer has `max_capacity`, which the adapter reads\. New keys: `capacity_max`/);

  // Classes renamed so most fall out of the adult filter: far fewer sessions than usual.
  const fewer = withClasses(arketa.data.classes.map((c, i) => (i % 6 ? { ...c, name: `Program ${i}` } : c)));
  const summaryFile = join(ws.dir, 'summary.md');
  const drop = await scrape({ ws, sources: volleyworld, fetch: network({ arketa: fewer }), summaryFile });
  assert.ok(drop.schedule.sources[0].count <= usual / 3);
  assert.ok(drop.fresh.some((f) => f.kind === 'count'));
  assert.match(readFileSync(ws.paths.changes, 'utf8'), /Fewer sessions than usual: returned \d+ sessions; it usually returns about \d+/);
  assert.match(readFileSync(summaryFile, 'utf8'), /#### Needs a look/);
});

// --- buildCourts --------------------------------------------------------------------------

/** A synthetic Skedda (booking page + /webs + /bookingslists); hosts in `down` answer 503. */
function skedda({ down = new Set(), site } = {}) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(String(url));
    calls.push(u.href);
    const json = (v) => new Response(JSON.stringify(v));
    if (site && u.href.startsWith(site.base)) return site.body ? json(site.body) : new Response('nope', { status: 404 });
    const venue = VENUES.find((v) => v.host === u.hostname);
    if (!venue) throw new Error(`unexpected host in test: ${u.hostname}`);
    if (down.has(u.hostname)) return new Response('down', { status: 503 });
    if (u.pathname === '/booking') return new Response('<input name="__RequestVerificationToken" value="t">');
    const names = venue.facilities.flatMap((x) => x.spaces);
    if (u.pathname === '/webs') {
      return json({ venue: [{ hoursOfAvailability: { rules: [{ daysBitmask: 0b0111110, start: 480, end: 1380 }] } }], spaces: names.map((name, i) => ({ id: i + 1, name, venue: 1, nonAdminVisible: true })) });
    }
    return json({ bookings: [{ start: '2026-10-26T09:00:00', end: '2026-10-26T11:30:00', spaces: [1, 2], recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=MO\r\n' }] });
  };
  f.calls = calls;
  return f;
}

test('build-courts: writes courts.json for every venue from Skedda', async () => {
  const out = join(tempDir(), 'courts.json');
  const body = await buildCourts({ out, fetch: skedda(), now: () => NOW, log: () => {} });
  const file = readJson(out);
  assert.deepEqual(file, body);
  assert.deepEqual([file.from, file.days, file.fetchedAt, file.errors], [REF, 14, NOW.toISOString(), []]);
  assert.deepEqual(file.venues.map((v) => v.id), VENUES.map((v) => v.id));
  for (const v of file.venues) {
    assert.deepEqual(v.hours, [null, ...Array(5).fill(['08:00', '23:00']), null], v.id);
    const first = v.facilities[0].courts[0];
    // Weekly Monday booking: Oct 26 and Nov 2 fall in Oct 25 to Nov 7.
    assert.deepEqual(Object.keys(first.days), ['2026-10-26', '2026-11-02'], v.id);
    assert.deepEqual(first.days['2026-10-26'], [['09:00', '11:30']], v.id);
  }
});

test('build-courts: a failing venue keeps the last good copy from the local file, marked stale', async () => {
  const out = join(tempDir(), 'courts.json');
  await buildCourts({ out, fetch: skedda(), now: () => NOW, log: () => {} });
  const good = readJson(out).venues.find((v) => v.id === 'treehouse');
  const logs = [];
  const body = await buildCourts({ out, fetch: skedda({ down: new Set(['treehousegym.skedda.com']) }), now: () => new Date(NOW.getTime() + 900e3), log: (l) => logs.push(l) });
  assert.deepEqual(body.errors.map((e) => [e.venue, e.calendar]), [['treehouse', 'https://treehousegym.skedda.com/booking']]);
  assert.deepEqual(body.venues.find((v) => v.id === 'treehouse'), { ...good, stale: true });
  assert.equal(body.venues.find((v) => v.id === 'velocity').stale, undefined);
  assert.ok(logs.some((l) => /FAIL  treehouse: .*HTTP 503 \(kept last good copy\)/.test(l)));
});

test('build-courts: with no local file, the last good copy comes from the live site; nothing usable is an empty run', async () => {
  const dir = tempDir();
  const live = { venues: [{ id: 'velocity', calendar: 'https://austinvelocity.skedda.com/booking', hours: [], facilities: [] }] };
  const allDown = new Set(VENUES.map((v) => v.host));
  const fetch = skedda({ down: allDown, site: { base: 'https://example.test/schelagg/data/courts.json', body: live } });
  const body = await buildCourts({ out: join(dir, 'a.json'), siteUrl: 'https://example.test/schelagg', fetch, now: () => NOW, log: () => {} });
  assert.ok(fetch.calls.includes('https://example.test/schelagg/data/courts.json'));
  assert.deepEqual(body.venues, [{ ...live.venues[0], stale: true }]);
  assert.equal(body.errors.length, 2);

  // No local file, no site copy, every venue down: nothing usable (the script exits 1 on this).
  const empty = await buildCourts({ out: join(dir, 'b.json'), fetch: skedda({ down: allDown }), now: () => NOW, log: () => {} });
  assert.deepEqual(empty.venues, []);
  assert.deepEqual(readJson(join(dir, 'b.json')).venues, []);
});
