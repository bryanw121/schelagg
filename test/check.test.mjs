// The live check: adapters' check() against captured fixtures (plus hand-made variants),
// and the /api/check handler with stubbed adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vw from '../scripts/adapters/volleyworld.mjs';
import * as reclub from '../scripts/adapters/reclub.mjs';
import * as aces from '../scripts/adapters/aces.mjs';
import { loadSources } from '../lib/registry.js';
import { runCheck, resolveSource } from '../lib/check.js';
import { createHandler } from '../api/check.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const ARKETA = fixture('arketa-volleyworld-schedule.json');
const NOW = new Date('2026-10-25T20:00:00Z');
const { sources: SOURCES } = loadSources();
const RECLUB = SOURCES.find((s) => s.id === 'reclub');

/** A fetch stub that records requested URLs and answers from a function. */
function stubFetch(answer) {
  const calls = [];
  const f = async (url, init) => {
    calls.push(String(url));
    const { status = 200, body = '' } = await answer(new URL(String(url)), init);
    return new Response(body, { status });
  };
  f.calls = calls;
  return f;
}

/** Edit the meet object inside a Reclub page's __NUXT_DATA__ (new values are appended, never shared). */
function editMeet(html, edits) {
  const re = /(<script\b[^>]*id="__NUXT_DATA__"[^>]*>)([\s\S]*?)(<\/script>)/;
  const [, open, json, close] = html.match(re);
  const arr = JSON.parse(json);
  const meet = arr.find((v) => v && !Array.isArray(v) && typeof v === 'object' && 'referenceCode' in v && 'startDatetime' in v);
  for (const [k, v] of Object.entries(edits)) meet[k] = arr.push(v) - 1;
  return html.replace(re, () => `${open}${JSON.stringify(arr)}${close}`);
}

// --- Volleyworld --------------------------------------------------------------------------

const arketa = (edit = (c) => c) => {
  const j = JSON.parse(ARKETA);
  j.data.classes = j.data.classes.map((c) => edit({ ...c })).filter(Boolean);
  return j;
};
const TUE = 'volleyworld-2026-10-27-20:30-georgetown';
const TUE_CLASS = 'Ct8jXEbGRG0DpnGv8SBz';

test('Volleyworld check: scheduled and canceled straight from the API', () => {
  const ok = vw.checkDay(arketa(), TUE);
  assert.equal(ok.status, 'scheduled');
  assert.equal(ok.session.id, TUE);
  assert.equal(ok.session.classId, TUE_CLASS);
  assert.equal(vw.checkDay(arketa(), 'volleyworld-2026-10-25-17:30-georgetown').status, 'canceled');
  const canceled = vw.checkDay(arketa((c) => (c.id === TUE_CLASS ? { ...c, canceled: true } : c)), TUE);
  assert.equal(canceled.status, 'canceled');
});

test('Volleyworld check: a class moved to another time is "changed" with the new session', () => {
  const later = arketa((c) => (c.id === TUE_CLASS ? { ...c, start_time: c.start_time + 3600 } : c));
  const expected = { id: TUE, classId: TUE_CLASS, title: 'Adult Volleyball Training', date: '2026-10-27', start: '20:30', end: '22:00', venue: 'Volleyworld (Georgetown)' };
  const r = vw.checkDay(later, TUE, { expected });
  assert.equal(r.status, 'changed');
  assert.deepEqual([r.session.start, r.session.end, r.session.id], ['21:30', '23:00', 'volleyworld-2026-10-27-21:30-georgetown']);
  assert.deepEqual(r.changes, ['start', 'end']);
  // Without knowing what was published, the old slot is simply gone.
  assert.equal(vw.checkDay(later, TUE).status, 'gone');
  // Same slot, longer class.
  const longer = vw.checkDay(arketa((c) => (c.id === TUE_CLASS ? { ...c, duration: 120 } : c)), TUE, { expected });
  assert.deepEqual([longer.status, longer.changes], ['changed', ['end']]);
});

test('Volleyworld check: missing from the API is "gone"', () => {
  assert.equal(vw.checkDay(arketa((c) => (c.id === TUE_CLASS ? null : c)), TUE).status, 'gone');
  assert.equal(vw.checkDay({ data: { classes: [] } }, TUE).status, 'gone');
});

test('Volleyworld check() asks Arketa for that one local day only', async () => {
  const f = stubFetch(() => ({ body: ARKETA }));
  const r = await vw.check({ sessionId: TUE, timezone: 'America/Chicago', now: NOW, fetch: f });
  assert.equal(r.status, 'scheduled');
  assert.equal(r.checkedAt, NOW.toISOString());
  const u = new URL(f.calls[0]);
  assert.equal(u.origin, 'https://widget-api-tkaeguucxq-uc.a.run.app');
  assert.equal(u.searchParams.get('startDateTime'), '2026-10-27T05:00:00.000Z');
  assert.equal(u.searchParams.get('endDateTime'), '2026-10-28T05:00:00.000Z');
  await assert.rejects(vw.check({ sessionId: 'volleyworld-2026-10-27-20:30-austin', fetch: f }), RangeError);
  await assert.rejects(vw.check({ sessionId: TUE, fetch: stubFetch(() => ({ status: 503 })) }), /HTTP 503/);
});

// --- Reclub -------------------------------------------------------------------------------

const MEET = fixture('reclub-meet-VONMM8.html');
const MEET_ID = 'reclub-VONMM8';
const reclubOpts = { options: RECLUB.options, timezone: 'America/Chicago' };

test('Reclub check: scheduled, canceled, moved and gone', () => {
  const ok = reclub.checkPage({ status: 200, text: MEET }, MEET_ID, reclubOpts);
  assert.equal(ok.status, 'scheduled');
  assert.equal(ok.session.venue, 'Roots · Treehouse Gym');

  const canceled = reclub.checkPage({ status: 200, text: editMeet(MEET, { isCancelled: true }) }, MEET_ID, reclubOpts);
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.session.canceled, true);

  const expected = { ...ok.session };
  const start = 1793404800 + 30 * 60; // 7:30 PM instead of 7:00
  const moved = reclub.checkPage({ status: 200, text: editMeet(MEET, { startDatetime: start, endDatetime: start + 10800 }) }, MEET_ID, { ...reclubOpts, expected });
  assert.deepEqual([moved.status, moved.changes, moved.session.start, moved.session.end], ['changed', ['start', 'end'], '19:30', '22:30']);
  assert.equal(reclub.checkPage({ status: 200, text: MEET }, MEET_ID, { ...reclubOpts, expected }).status, 'scheduled');

  assert.equal(reclub.checkPage({ status: 404, text: '' }, MEET_ID, reclubOpts).status, 'gone');
  assert.equal(reclub.checkPage({ status: 200, text: '<html>no meet</html>' }, MEET_ID, reclubOpts).status, 'gone');
  assert.throws(() => reclub.checkPage({ status: 500, text: '' }, MEET_ID, reclubOpts), /HTTP 500/);
});

test('Reclub check() fetches only reclub.co/m/<code>', async () => {
  const f = stubFetch(() => ({ body: MEET }));
  const r = await reclub.check({ sessionId: MEET_ID, ...reclubOpts, now: NOW, fetch: f });
  assert.equal(r.status, 'scheduled');
  assert.deepEqual(f.calls, ['https://reclub.co/m/VONMM8']);
  await assert.rejects(reclub.check({ sessionId: 'reclub-../../x', fetch: f }), RangeError);
});

test('ACES and the hand-checked sources have no fast source: unknown', async () => {
  assert.equal((await aces.check({ now: NOW })).status, 'unknown');
});

// --- runCheck + /api/check ----------------------------------------------------------------

const stubSources = (check) => [
  { id: 'stub', sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', options: {}, adapter: { check, parseId: (id) => /^stub-\d+$/.test(id) } },
  { id: 'aces', sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', options: {}, adapter: {} },
];

test('sources resolve from the published session first, then by id prefix', () => {
  const published = new Map([['aces-thu-6s-sand', { id: 'aces-thu-6s-sand', sourceId: 'manual' }]]);
  assert.equal(resolveSource('aces-thu-6s-sand', SOURCES, published).source.id, 'manual');
  assert.equal(resolveSource('aces-2026-10-26-19:30', SOURCES, published).source.id, 'aces');
  assert.equal(resolveSource('reclub-VONMM8', SOURCES).source.id, 'reclub');
  assert.equal(resolveSource('nope-1', SOURCES), null);
});

/** Call a handler like Vercel / node:http would and collect the response. */
async function call(handler, url, method = 'GET') {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    end(body) { this.body = body; },
  };
  await handler({ method, url }, res);
  return { status: res.statusCode, headers, json: res.body ? JSON.parse(res.body) : null };
}

test('/api/check: malformed or unknown ids are 400s and nothing is fetched', async () => {
  let called = 0;
  const h = createHandler({ sources: stubSources(async () => { called++; return { status: 'scheduled' }; }), published: new Map() });
  for (const q of ['', '?session=', '?session=https://evil.example/x', '?session=../../etc/passwd', '?session=stub-abc', '?session=nope-123', `?session=${'a'.repeat(200)}`]) {
    const r = await call(h, `/api/check${q}`);
    assert.equal(r.status, 400, q);
    assert.ok(r.json.error, q);
    assert.equal(r.headers['access-control-allow-origin'], '*');
  }
  assert.equal(called, 0);
});

test('/api/check: a source with no fast check answers 200 unknown', async () => {
  const h = createHandler({ sources: stubSources(), published: new Map(), now: () => NOW });
  const r = await call(h, '/api/check?session=aces-2026-10-26-19:30');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { id: 'aces-2026-10-26-19:30', sourceId: 'aces', published: false, status: 'unknown', checkedAt: NOW.toISOString() });
  assert.equal(r.headers['cache-control'], 'public, s-maxage=60, stale-while-revalidate=120');
});

test('/api/check: passes the published session as expected and returns the current one as a feed row', async () => {
  let seen;
  const session = { id: 'stub-1', title: 'Open play', venue: 'Gym', date: '2026-10-30', start: '19:30', end: '21:30', canceled: true, surface: 'indoor' };
  const h = createHandler({
    sources: stubSources(async (args) => { seen = args; return { status: 'canceled', session, checkedAt: NOW.toISOString() }; }),
    published: new Map([['stub-1', { id: 'stub-1', sourceId: 'stub', start: '19:30' }]]),
    now: () => NOW,
  });
  const r = await call(h, '/api/check?session=stub-1');
  assert.equal(r.status, 200);
  assert.equal(seen.expected.start, '19:30');
  assert.equal(seen.timezone, 'America/Chicago');
  assert.ok(seen.signal instanceof AbortSignal);
  assert.deepEqual([r.json.status, r.json.published, r.json.session.sourceId], ['canceled', true, 'stub']);
  assert.deepEqual([r.json.occurrence.id, r.json.occurrence.starts_at, r.json.occurrence.canceled], ['stub-1', '2026-10-31T00:30:00.000Z', true]);
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
});

test('/api/check: a slow or failing source is unknown, cached only briefly', async () => {
  const slow = createHandler({ sources: stubSources((args) => new Promise((resolve, reject) => args.signal.addEventListener('abort', () => reject(new Error('aborted'))))), published: new Map(), timeoutMs: 30 });
  const r = await call(slow, '/api/check?session=stub-1');
  assert.deepEqual([r.status, r.json.status, r.json.error], [200, 'unknown', 'timeout']);
  assert.equal(r.headers['cache-control'], 'public, s-maxage=5');
  const failing = createHandler({ sources: stubSources(async () => { throw new Error('ECONNRESET'); }), published: new Map() });
  const f = await call(failing, '/api/check?session=stub-1');
  assert.deepEqual([f.status, f.json.status, f.json.error], [200, 'unknown', 'source unavailable']);
});

test('/api/check: GET only, with a CORS preflight', async () => {
  const h = createHandler({ sources: stubSources(), published: new Map() });
  const post = await call(h, '/api/check?session=aces-x-1', 'POST');
  assert.equal(post.status, 405);
  const pre = await call(h, '/api/check', 'OPTIONS');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-methods'], 'GET');
});

test('runCheck end to end with the real registry and a stubbed network', async () => {
  const f = stubFetch((u) => (u.hostname === 'reclub.co' ? { body: MEET } : { body: ARKETA }));
  const r = await runCheck('reclub-VONMM8', { sources: SOURCES, now: NOW, fetch: f });
  assert.deepEqual([r.httpStatus, r.body.status, r.body.session.facility], [200, 'scheduled', 'treehouse']);
  const v = await runCheck('volleyworld-2026-10-25-17:30-georgetown', { sources: SOURCES, now: NOW, fetch: f });
  assert.deepEqual([v.httpStatus, v.body.status], [200, 'canceled']);
  const bad = await runCheck('volleyworld-2026-10-25-25:30-georgetown', { sources: SOURCES, now: NOW, fetch: f });
  assert.equal(bad.httpStatus, 400);
});
