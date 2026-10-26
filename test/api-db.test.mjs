// The read API on Schelagg's database: GET /api/sessions (api/sessions.js) and /api/check
// (api/check.js) reading published sessions from it. Handlers are mounted on node:http on a
// loopback port, as in api.test.mjs, and get a PGlite-backed database (real Postgres in WASM,
// in-process) seeded through writeRun, or a stub fetch for the published-feed fallback.
// Nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadSources } from '../lib/registry.js';
import { toOccurrences, occurrenceDate, FEED_VERSION } from '../lib/occurrences.js';
import { wrapPglite, migrate, writeRun } from '../lib/db.js';
import { createHandler as sessionsHandler, FEED_URL, parseQuery } from '../api/sessions.js';
import { createHandler as checkHandler } from '../api/check.js';
import { PUBLISHED_URL } from '../lib/check.js';

const NOW = new Date('2026-10-25T20:00:00Z'); // Sunday 3pm in Austin
const OK_CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=120';
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = () => { throw new Error('no network in tests: inject a fetch'); }; });
after(() => { globalThis.fetch = realFetch; });
const tmp = mkdtempSync(join(tmpdir(), 'schelagg-api-db-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

async function withServer(handler, fn) {
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn((path, method = 'GET') => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: text ? JSON.parse(text) : null }));
      });
      req.on('error', reject);
      req.end();
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function stubFetch(fn) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push(String(url));
    const { status = 200, body = '' } = await fn(new URL(String(url)), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  f.calls = calls;
  return f;
}

// Synthetic sessions: Austin volleyball, an Austin pickleball one and a Denver volleyball one
// (another time zone), so the filters have something to tell apart.
const base = { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', verifiedAt: '2026-10-25' };
const SESSIONS = [
  { ...base, id: 'reclub-AAA111', sourceId: 'reclub', date: '2026-10-26', start: '19:00', end: '22:00', title: 'Monday Coed', venue: 'Treehouse', surface: 'indoor', type: 'Open play' },
  { ...base, id: 'manual-sand-sun', sourceId: 'manual', days: ['Sun'], start: '19:00', end: '22:00', title: 'Sunday Sand Social', venue: 'ATX Beach', surface: 'sand', type: 'Open play', price: '$10' },
  { ...base, id: 'manual-late-sat', sourceId: 'manual', days: ['Sat'], start: '22:30', end: '24:00', title: 'Late Saturday', venue: 'Gym', surface: 'indoor', type: 'Open play' },
  { ...base, id: 'pickle-1', sourceId: 'manual', sport: 'pickleball', date: '2026-10-27', start: '09:00', end: '11:00', title: 'Morning Pickleball', venue: 'Courts' },
  { ...base, id: 'denver-1', sourceId: 'manual', region: 'denver', timezone: 'America/Denver', date: '2026-10-31', start: '23:00', end: '23:59', title: 'Denver Night', venue: 'Mile High', surface: 'indoor', type: 'Open play' },
];
const GENERATED = NOW.toISOString();
const SCHEDULE = {
  schemaVersion: 2, generatedAt: GENERATED, sessions: SESSIONS,
  sources: [{ id: 'reclub', sport: 'volleyball', region: 'austin', ok: true, checkedAt: GENERATED, count: 1 }],
};
const FEED = { feedVersion: FEED_VERSION, generatedAt: GENERATED, horizonDays: 28, occurrences: toOccurrences(SESSIONS, { now: NOW, horizonDays: 28 }) };

let db;
before(async () => {
  db = wrapPglite(new PGlite());
  await migrate(db, { log: () => {} });
  await writeRun(db, { schedule: SCHEDULE, occurrences: FEED });
});
after(() => db.end());

const app = (opts = {}) => sessionsHandler({ db, fetch: stubFetch(() => { throw new Error('the feed should not be fetched'); }), now: () => NOW, log: () => {}, ...opts });
const ids = (r) => r.json.occurrences.map((o) => o.id);
const expected = (pred) => FEED.occurrences.filter(pred).map((o) => o.id);

test('/api/sessions: occurrences from the database, shaped like the feed, with CORS and a 60s cache', async () => {
  await withServer(app(), async (get) => {
    const r = await get('/api/sessions?sport=volleyball&region=austin');
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['cache-control'], OK_CACHE);
    assert.equal(r.headers['x-schelagg-source'], 'db');
    assert.deepEqual(Object.keys(r.json), ['feedVersion', 'generatedAt', 'from', 'to', 'sport', 'region', 'occurrences']);
    assert.deepEqual([r.json.feedVersion, r.json.generatedAt, r.json.from, r.json.to, r.json.sport, r.json.region],
      [FEED_VERSION, GENERATED, '2026-10-25', '2026-11-22', 'volleyball', 'austin']);
    // Exactly the feed's Austin volleyball rows, same objects, same order.
    assert.deepEqual(r.json.occurrences, FEED.occurrences.filter((o) => o.sport === 'volleyball' && o.region === 'austin'));
    assert.deepEqual(Object.keys(r.json.occurrences[0]), Object.keys(FEED.occurrences[0]));
  });
});

test('/api/sessions: sport, region and date filters (local dates, in each row\'s time zone)', async () => {
  await withServer(app(), async (get) => {
    // No filters: every sport and region in the default window.
    assert.deepEqual(ids(await get('/api/sessions')), FEED.occurrences.map((o) => o.id));
    assert.deepEqual(ids(await get('/api/sessions?sport=pickleball')), ['pickle-1']);
    assert.deepEqual(ids(await get('/api/sessions?region=denver')), ['denver-1']);
    assert.deepEqual(ids(await get('/api/sessions?sport=volleyball&region=denver')), ['denver-1']);
    assert.deepEqual(ids(await get('/api/sessions?sport=curling')), []);
    // One day. 7pm Sunday in Austin is already Monday in UTC; it still counts as Sunday.
    assert.deepEqual(ids(await get('/api/sessions?from=2026-10-25&to=2026-10-25')), ['manual-sand-sun-2026-10-25']);
    // Saturday 10:30pm-midnight in Austin, and 11pm in Denver (Sunday 05:00Z), are Saturday's.
    assert.deepEqual(ids(await get('/api/sessions?from=2026-10-31&to=2026-10-31')), ['manual-late-sat-2026-10-31', 'denver-1']);
    assert.deepEqual(ids(await get('/api/sessions?from=2026-11-01&to=2026-11-01')), ['manual-sand-sun-2026-11-01']);
    // Only `from`: the default window runs from there.
    const r = await get('/api/sessions?from=2026-11-01');
    assert.deepEqual([r.json.from, r.json.to], ['2026-11-01', '2026-11-29']);
    assert.deepEqual(ids(r), expected((o) => occurrenceDate(o) >= '2026-11-01'));
    assert.ok(!ids(r).includes('denver-1'), 'Saturday night in Denver is Oct 31 there, though Nov 1 in UTC');
  });
});

test('/api/sessions: bad input is a 400 with CORS, and nothing is queried', async () => {
  let queried = 0;
  const counting = { ...db, query: (...a) => { queried++; return db.query(...a); } };
  await withServer(app({ db: counting }), async (get) => {
    for (const q of [
      'from=2026-13-01', 'from=2026-02-30', 'from=26-10-25', 'from=2026-10-25T00:00', 'to=tomorrow', `from=${encodeURIComponent("2026-10-25'; drop table sessions; --")}`,
      'from=2026-10-25&to=2026-10-24', 'from=2026-10-01&to=2026-11-30', 'to=2027-01-01',
      'sport=Volleyball', 'sport=volley%20ball', `sport=${'a'.repeat(41)}`, 'region=../etc', 'region=-austin', 'sport=%E2%9C%93',
    ]) {
      const r = await get(`/api/sessions?${q}`);
      assert.equal(r.status, 400, q);
      assert.equal(typeof r.json.error, 'string', q);
      assert.equal(r.headers['access-control-allow-origin'], '*', q);
      assert.equal(r.headers['content-type'], 'application/json; charset=utf-8', q);
    }
    // Exactly 60 days is fine; 61 is not.
    assert.equal((await get('/api/sessions?from=2026-10-25&to=2026-12-23')).status, 200);
    assert.match((await get('/api/sessions?from=2026-10-25&to=2026-12-24')).json.error, /at most 60 days/);
  });
  assert.equal(queried, 2, 'only the one valid request queried (last run + occurrences)');
  assert.deepEqual(parseQuery(new URLSearchParams(''), NOW), { sport: null, region: null, from: '2026-10-25', to: '2026-11-22' });
});

test('/api/sessions: OPTIONS preflight, HEAD without a body, other methods 405', async () => {
  await withServer(app(), async (req) => {
    const pre = await req('/api/sessions', 'OPTIONS');
    assert.deepEqual([pre.status, pre.text, pre.headers['access-control-allow-origin'], pre.headers['access-control-allow-methods']], [204, '', '*', 'GET']);
    const head = await req('/api/sessions', 'HEAD');
    assert.deepEqual([head.status, head.text, head.headers['cache-control']], [200, '', OK_CACHE]);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await req('/api/sessions', method);
      assert.deepEqual([r.status, r.headers.allow, r.headers['access-control-allow-origin'], r.json], [405, 'GET', '*', { error: 'GET only' }], method);
    }
  });
});

test('/api/sessions: falls back to the published feed without a database, on a database error, or before any run', async () => {
  const empty = wrapPglite(new PGlite());
  await migrate(empty, { log: () => {} });
  const broken = { query: async () => { throw new Error('connect ECONNREFUSED postgresql://reader:s3cret@db.example.test/x'); } };
  const cases = [['no database', null], ['database error', broken], ['no runs yet', empty]];
  try {
    for (const [name, d] of cases) {
      const fetch = stubFetch(() => ({ body: FEED }));
      const logs = [];
      await withServer(app({ db: d, fetch, log: (l) => logs.push(l) }), async (get) => {
        const r = await get('/api/sessions?sport=volleyball&region=austin&from=2026-10-31&to=2026-10-31');
        assert.equal(r.status, 200, name);
        assert.equal(r.headers['x-schelagg-source'], 'feed', name);
        assert.equal(r.headers['access-control-allow-origin'], '*', name);
        assert.deepEqual([r.json.generatedAt, r.json.from, r.json.to], [GENERATED, '2026-10-31', '2026-10-31'], name);
        assert.deepEqual(ids(r), ['manual-late-sat-2026-10-31'], name);
      });
      assert.deepEqual(fetch.calls, [FEED_URL], name);
      if (d === broken) {
        assert.match(logs[0], /database read failed/);
        assert.doesNotMatch(logs[0], /s3cret/);
      }
    }
  } finally {
    await empty.end();
  }
});

test('/api/sessions: Pages down falls back to the bundled feed; neither is a 503', async () => {
  const bundled = join(tmp, 'occurrences.json');
  writeFileSync(bundled, JSON.stringify(FEED));
  for (const pages of [() => ({ status: 503, body: 'down' }), () => { throw new Error('ECONNRESET'); }, () => ({ body: '{"nope":1}' })]) {
    await withServer(app({ db: null, fetch: stubFetch(pages), bundled }), async (get) => {
      const r = await get('/api/sessions?sport=pickleball');
      assert.deepEqual([r.status, r.headers['x-schelagg-source'], ids(r)], [200, 'bundled', ['pickle-1']]);
    });
  }
  await withServer(app({ db: null, fetch: stubFetch(() => ({ status: 500 })), bundled: join(tmp, 'missing.json') }), async (get) => {
    const r = await get('/api/sessions');
    assert.deepEqual([r.status, r.json, r.headers['cache-control'], r.headers['access-control-allow-origin']], [503, { error: 'schedule unavailable' }, 'public, s-maxage=5', '*']);
  });
});

test('/api/sessions: without DATABASE_URL_READONLY the handler never opens a database', async () => {
  const saved = process.env.DATABASE_URL_READONLY;
  delete process.env.DATABASE_URL_READONLY;
  try {
    const fetch = stubFetch(() => ({ body: FEED }));
    await withServer(sessionsHandler({ fetch, now: () => NOW }), async (get) => {
      const r = await get('/api/sessions?sport=pickleball');
      assert.deepEqual([r.status, r.headers['x-schelagg-source'], ids(r)], [200, 'feed', ['pickle-1']]);
    });
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL_READONLY = saved;
  }
});

// --- /api/check with the database -----------------------------------------------------------

const { sources: SOURCES } = loadSources();

test('/api/check: published sessions come from the database when it is configured', async () => {
  const fetch = stubFetch((u) => { throw new Error(`unexpected fetch ${u}`); });
  await withServer(checkHandler({ sources: SOURCES, db, fetch, now: () => NOW, log: () => {} }), async (get) => {
    // A hand-checked session only the database knows: published, its sourceId from the stored row.
    const manual = await get('/api/check?session=manual-sand-sun');
    assert.deepEqual([manual.status, manual.json.published, manual.json.sourceId, manual.json.status], [200, true, 'manual', 'unknown']);
    const unknown = await get('/api/check?session=aces-2026-10-26-19:30');
    assert.deepEqual([unknown.status, unknown.json.published, unknown.json.sourceId], [200, false, 'aces']);
  });
  assert.deepEqual(fetch.calls, [], 'neither Pages nor a source was asked');
});

test('/api/check: a database error or an empty database falls back to the published schedule', async () => {
  const empty = wrapPglite(new PGlite());
  await migrate(empty, { log: () => {} });
  const broken = { query: async () => { throw new Error('too many connections'); } };
  try {
    for (const d of [broken, empty]) {
      const logs = [];
      const fetch = stubFetch((u) => {
        assert.equal(u.href, PUBLISHED_URL);
        return { body: { sessions: [{ id: 'manual-from-pages', sourceId: 'manual' }] } };
      });
      await withServer(checkHandler({ sources: SOURCES, db: d, fetch, now: () => NOW, log: (l) => logs.push(l) }), async (get) => {
        const r = await get('/api/check?session=manual-from-pages');
        assert.deepEqual([r.status, r.json.published, r.json.sourceId], [200, true, 'manual']);
        assert.equal((await get('/api/check?session=manual-sand-sun')).status, 400, 'not in the Pages copy: no source owns it');
      });
      assert.deepEqual(fetch.calls, [PUBLISHED_URL], 'loaded once, then cached');
      if (d === broken) assert.match(logs[0], /api\/check: database read failed/);
    }
  } finally {
    await empty.end();
  }
});
