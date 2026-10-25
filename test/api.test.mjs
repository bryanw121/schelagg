// HTTP integration for the two live endpoints (api/check.js, api/courts.js): each handler is
// mounted on a real node:http server on an ephemeral loopback port, requested over HTTP, and
// backed by the real adapters / Skedda client with a fixture-answering fetch. Nothing here
// reaches the internet: the adapters' fetch is a stub, and global fetch throws.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFileSync } from 'node:fs';
import { loadSources } from '../lib/registry.js';
import { VENUES } from '../lib/skedda.js';
import { createHandler as checkHandler } from '../api/check.js';
import { createHandler as courtsHandler } from '../api/courts.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const ARKETA = fixture('arketa-volleyworld-schedule.json');
const MEET = fixture('reclub-meet-VONMM8.html');
const NOW = new Date('2026-10-25T20:00:00Z'); // Sunday 3pm in Austin
const { sources: SOURCES } = loadSources();
const OK_CACHE = 'public, s-maxage=60, stale-while-revalidate=120';
const FAIL_CACHE = 'public, s-maxage=5';

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = () => { throw new Error('no network in tests: inject a fetch'); }; });
after(() => { globalThis.fetch = realFetch; });

/** Serve one handler on 127.0.0.1:<random> for the duration of fn. */
async function withServer(handler, fn) {
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn((path, method = 'GET') => new Promise((resolve, reject) => {
      // node:http rather than fetch: no proxy settings or global stubs in the way.
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

/** A fetch stub: records URLs, answers from fn(url, init) -> { status, body, headers } (or throws). */
function stubFetch(fn) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push(String(url));
    const { status = 200, body = '', headers } = await fn(new URL(String(url)), init);
    return new Response(body, { status, headers });
  };
  f.calls = calls;
  return f;
}

/** Edit the meet object inside a Reclub page's __NUXT_DATA__ (same trick as check.test.mjs). */
function editMeet(html, edits) {
  const re = /(<script\b[^>]*id="__NUXT_DATA__"[^>]*>)([\s\S]*?)(<\/script>)/;
  const [, open, json, close] = html.match(re);
  const arr = JSON.parse(json);
  const meet = arr.find((v) => v && !Array.isArray(v) && typeof v === 'object' && 'referenceCode' in v && 'startDatetime' in v);
  for (const [k, v] of Object.entries(edits)) meet[k] = arr.push(v) - 1;
  return html.replace(re, () => `${open}${JSON.stringify(arr)}${close}`);
}

const arketa = (edit = (c) => c) => {
  const j = JSON.parse(ARKETA);
  j.data.classes = j.data.classes.map((c) => edit({ ...c })).filter(Boolean);
  return JSON.stringify(j);
};

// --- /api/check ---------------------------------------------------------------------------

const VW_TUE = 'volleyworld-2026-10-27-20:30-georgetown';
const VW_TUE_CLASS = 'Ct8jXEbGRG0DpnGv8SBz';
const VW_CANCELED = 'volleyworld-2026-10-25-17:30-georgetown';
const RC = 'reclub-VONMM8';

/** Published sessions as schedule.json would have them. */
const PUBLISHED = new Map([
  [VW_TUE, { id: VW_TUE, sourceId: 'volleyworld', classId: VW_TUE_CLASS, title: 'Adult Volleyball Training', date: '2026-10-27', start: '20:30', end: '22:00', venue: 'Volleyworld (Georgetown)' }],
  [RC, { id: RC, sourceId: 'reclub', date: '2026-10-30', start: '19:00', end: '22:00', venue: 'Roots · Treehouse Gym' }],
  ['atx-sand-social-sun', { id: 'atx-sand-social-sun', sourceId: 'manual', days: ['Sun'] }],
]);

/** A check handler on the real registry whose network answers from `pages`. */
function checkApp({ arketaBody = ARKETA, reclub = { body: MEET }, timeoutMs } = {}) {
  const fetch = stubFetch((u, init) => {
    if (u.hostname === 'reclub.co') return typeof reclub === 'function' ? reclub(u, init) : reclub;
    if (u.hostname === 'widget-api-tkaeguucxq-uc.a.run.app') return { body: arketaBody };
    throw new Error(`unexpected host ${u.hostname}`);
  });
  return { fetch, handler: checkHandler({ sources: SOURCES, published: PUBLISHED, fetch, now: () => NOW, timeoutMs }) };
}

test('/api/check over HTTP: Volleyworld scheduled, canceled, changed and gone from Arketa JSON', async () => {
  const cases = [
    { name: 'scheduled', body: ARKETA, id: VW_TUE, status: 'scheduled' },
    { name: 'canceled in the fixture', body: ARKETA, id: VW_CANCELED, status: 'canceled' },
    { name: 'moved an hour later', body: arketa((c) => (c.id === VW_TUE_CLASS ? { ...c, start_time: c.start_time + 3600 } : c)), id: VW_TUE, status: 'changed' },
    { name: 'dropped', body: arketa((c) => (c.id === VW_TUE_CLASS ? null : c)), id: VW_TUE, status: 'gone' },
  ];
  for (const c of cases) {
    const { handler, fetch } = checkApp({ arketaBody: c.body });
    await withServer(handler, async (get) => {
      const r = await get(`/api/check?session=${encodeURIComponent(c.id)}`);
      assert.equal(r.status, 200, c.name);
      assert.equal(r.headers['access-control-allow-origin'], '*', c.name);
      assert.equal(r.headers['content-type'], 'application/json; charset=utf-8', c.name);
      assert.equal(r.headers['cache-control'], OK_CACHE, c.name);
      assert.equal(r.json.status, c.status, c.name);
      assert.equal(r.json.sourceId, 'volleyworld', c.name);
      assert.equal(r.json.checkedAt, NOW.toISOString(), c.name);
      assert.equal(r.json.published, PUBLISHED.has(c.id), c.name);
      // Only Arketa's API, for that one local day.
      assert.equal(fetch.calls.length, 1, c.name);
      assert.equal(new URL(fetch.calls[0]).hostname, 'widget-api-tkaeguucxq-uc.a.run.app', c.name);
      if (c.status === 'gone') {
        assert.equal(r.json.session, undefined);
        assert.equal(r.json.occurrence, undefined);
      } else {
        // The current session (tagged like schedule.json) and the same as a feed row.
        assert.deepEqual([r.json.session.sport, r.json.session.region, r.json.session.sourceId], ['volleyball', 'austin', 'volleyworld'], c.name);
        assert.equal(r.json.occurrence.session_id, r.json.session.id, c.name);
        assert.equal(r.json.occurrence.canceled, c.status === 'canceled', c.name);
      }
      if (c.status === 'changed') {
        assert.deepEqual(r.json.changes, ['start', 'end']);
        assert.equal(r.json.session.id, 'volleyworld-2026-10-27-21:30-georgetown');
        assert.equal(r.json.occurrence.starts_at, '2026-10-28T02:30:00.000Z'); // 9:30pm CDT
      } else {
        assert.equal(r.json.changes, undefined, c.name);
      }
    });
  }
});

test('/api/check over HTTP: Reclub scheduled, canceled, changed and gone from the meet page', async () => {
  const moved = 1793404800 + 30 * 60; // 7:30pm instead of 7:00
  const cases = [
    { name: 'scheduled', reclub: { body: MEET }, status: 'scheduled' },
    { name: 'canceled', reclub: { body: editMeet(MEET, { isCancelled: true }) }, status: 'canceled' },
    { name: 'moved', reclub: { body: editMeet(MEET, { startDatetime: moved, endDatetime: moved + 10800 }) }, status: 'changed', changes: ['start', 'end'] },
    { name: '404', reclub: { status: 404, body: 'Not found' }, status: 'gone' },
    { name: 'no meet data', reclub: { body: '<html><body>Not a meet</body></html>' }, status: 'gone' },
  ];
  for (const c of cases) {
    const { handler, fetch } = checkApp({ reclub: c.reclub });
    await withServer(handler, async (get) => {
      const r = await get(`/api/check?session=${RC}`);
      assert.equal(r.status, 200, c.name);
      assert.equal(r.headers['cache-control'], OK_CACHE, c.name);
      assert.deepEqual([r.json.id, r.json.sourceId, r.json.published, r.json.status], [RC, 'reclub', true, c.status], c.name);
      assert.deepEqual(fetch.calls, ['https://reclub.co/m/VONMM8'], c.name);
      assert.deepEqual(r.json.changes, c.changes, c.name);
      if (c.status !== 'gone') {
        assert.equal(r.json.session.facility, 'treehouse', c.name);
        assert.equal(r.json.occurrence.signup_url, 'https://reclub.co/m/VONMM8', c.name);
      }
    });
  }
});

test('/api/check over HTTP: timeouts and source failures are 200 unknown, cached for 5s', async () => {
  const hang = (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const cases = [
    { name: 'timeout', app: checkApp({ reclub: hang, timeoutMs: 50 }), error: 'timeout' },
    { name: 'connection reset', app: checkApp({ reclub: () => { throw new Error('ECONNRESET'); } }), error: 'source unavailable' },
    { name: 'HTTP 500', app: checkApp({ reclub: { status: 500 } }), error: 'source unavailable' },
  ];
  for (const c of cases) {
    // The real Reclub adapter passes the abort signal through lib/http.js, so the timeout path is real.
    await withServer(c.app.handler, async (get) => {
      const r = await get(`/api/check?session=${RC}`);
      assert.equal(r.status, 200, c.name);
      assert.deepEqual([r.json.status, r.json.error, r.json.sourceId], ['unknown', c.error, 'reclub'], c.name);
      assert.equal(r.headers['cache-control'], FAIL_CACHE, c.name);
      assert.equal(r.headers['access-control-allow-origin'], '*', c.name);
    });
  }
});

test('/api/check over HTTP: sources without a fast check (ACES, manual) are unknown without fetching', async () => {
  const { handler, fetch } = checkApp();
  await withServer(handler, async (get) => {
    const aces = await get('/api/check?session=aces-2026-10-26-19:30');
    assert.deepEqual([aces.status, aces.json.status, aces.json.sourceId, aces.json.published], [200, 'unknown', 'aces', false]);
    assert.equal(aces.headers['cache-control'], OK_CACHE);
    const manual = await get('/api/check?session=atx-sand-social-sun');
    assert.deepEqual([manual.status, manual.json.status, manual.json.sourceId, manual.json.published], [200, 'unknown', 'manual', true]);
  });
  assert.equal(fetch.calls.length, 0);
});

test('/api/check over HTTP: bad and unknown ids are 400s and nothing is fetched', async () => {
  const { handler, fetch } = checkApp();
  await withServer(handler, async (get) => {
    for (const q of [
      '/api/check', '/api/check?session=', '/api/check?session=ab',
      `/api/check?session=${encodeURIComponent('https://reclub.co/m/VONMM8')}`,
      `/api/check?session=${encodeURIComponent('../../etc/passwd')}`,
      `/api/check?session=${'a'.repeat(101)}`,
      '/api/check?session=nope-123', // no configured source
      '/api/check?session=volleyworld-2026-10-27-25:30-georgetown', // adapter rejects its own id format
      '/api/check?session=volleyworld-2026-10-27-20:30-austin',
      '/api/check?session=reclub-x', // too short a meet code
    ]) {
      const r = await get(q);
      assert.equal(r.status, 400, q);
      assert.equal(typeof r.json.error, 'string', q);
      assert.equal(r.headers['access-control-allow-origin'], '*', q);
      assert.equal(r.headers['content-type'], 'application/json; charset=utf-8', q);
    }
  });
  assert.equal(fetch.calls.length, 0);
});

test('/api/check over HTTP: OPTIONS preflight, HEAD without a body, other methods 405', async () => {
  const { handler, fetch } = checkApp();
  await withServer(handler, async (req) => {
    const pre = await req(`/api/check?session=${RC}`, 'OPTIONS');
    assert.equal(pre.status, 204);
    assert.equal(pre.text, '');
    assert.equal(pre.headers['access-control-allow-origin'], '*');
    assert.equal(pre.headers['access-control-allow-methods'], 'GET');
    assert.equal(pre.headers['access-control-max-age'], '86400');

    const head = await req(`/api/check?session=${RC}`, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
    assert.equal(head.headers['cache-control'], OK_CACHE);
    assert.equal(head.headers['access-control-allow-origin'], '*');

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await req(`/api/check?session=${RC}`, method);
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.allow, 'GET', method);
      assert.equal(r.headers['access-control-allow-origin'], '*', method);
      assert.deepEqual(r.json, { error: 'GET only' }, method);
    }
  });
  assert.equal(fetch.calls.length, 1); // only the HEAD ran a check
});

// --- /api/courts --------------------------------------------------------------------------

/**
 * A synthetic Skedda: booking page with an anti-forgery token, /webs with spaces and
 * opening hours, /bookingslists with one booking per court on the requested start date.
 * Hosts in `down` answer 503.
 */
function skedda({ down = new Set() } = {}) {
  return stubFetch((u, init) => {
    const venue = VENUES.find((v) => v.host === u.hostname);
    if (!venue) throw new Error(`unexpected host ${u.hostname}`);
    if (down.has(u.hostname)) return { status: 503, body: 'down' };
    const names = venue.facilities.flatMap((f) => f.spaces);
    if (u.pathname === '/booking') {
      return { body: '<form><input name="__RequestVerificationToken" type="hidden" value="tok123"></form>', headers: { 'set-cookie': 'sk=abc; path=/' } };
    }
    assert.equal(init.headers['x-skedda-requestverificationtoken'], 'tok123');
    assert.equal(init.headers.cookie, 'sk=abc');
    if (u.pathname === '/webs') {
      return { body: JSON.stringify({
        venue: [{ hoursOfAvailability: { rules: [{ daysBitmask: 0b1111111, start: 360, end: 1320 }] } }],
        spaces: names.map((name, i) => ({ id: i + 1, name, venue: 1, nonAdminVisible: true })),
      }) };
    }
    if (u.pathname === '/bookingslists') {
      const day = u.searchParams.get('start').slice(0, 10);
      return { body: JSON.stringify({ bookings: [{ start: `${day}T18:00:00`, end: `${day}T20:00:00`, spaces: [1] }] }) };
    }
    return { status: 404 };
  });
}

test('/api/courts over HTTP: venues, hours and bookings from Skedda; days is clamped', async () => {
  const fetch = skedda();
  await withServer(courtsHandler({ fetch, now: () => NOW }), async (get) => {
    const r = await get('/api/courts?days=3');
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['cache-control'], OK_CACHE);
    assert.deepEqual([r.json.from, r.json.days, r.json.fetchedAt, r.json.errors], ['2026-10-25', 3, NOW.toISOString(), []]);
    assert.deepEqual(r.json.venues.map((v) => v.id), VENUES.map((v) => v.id));
    const velocity = r.json.venues.find((v) => v.id === 'velocity');
    assert.deepEqual(velocity.hours, Array(7).fill(['06:00', '22:00']));
    const hp1 = velocity.facilities.find((f) => f.id === 'highpoint').courts.find((c) => c.name === 'HP Court 1');
    assert.deepEqual(hp1.days, { '2026-10-25': [['18:00', '20:00']] });
    // The range asked of Skedda covers `days` local dates.
    const list = new URL(fetch.calls.find((c) => c.includes('/bookingslists') && c.includes('austinvelocity')));
    assert.deepEqual([list.searchParams.get('start'), list.searchParams.get('end')], ['2026-10-25T00:00:00', '2026-10-27T23:59:59.999']);

    for (const [q, days] of [['', 7], ['?days=0', 7], ['?days=abc', 7], ['?days=-4', 1], ['?days=99', 21]]) {
      assert.equal((await get(`/api/courts${q}`)).json.days, days, q);
    }
  });
  // Nothing but the two Skedda hosts was asked.
  assert.deepEqual([...new Set(fetch.calls.map((c) => new URL(c).hostname))].sort(), VENUES.map((v) => v.host).sort());
});

test('/api/courts over HTTP: cached for a minute, then a failing venue keeps its last good copy marked stale', async () => {
  let t = NOW.getTime();
  const down = new Set();
  const fetch = skedda({ down });
  await withServer(courtsHandler({ fetch, now: () => new Date(t) }), async (get) => {
    const first = await get('/api/courts?days=2');
    assert.equal(first.json.venues.length, 2);
    const calls = fetch.calls.length;

    down.add('treehousegym.skedda.com');
    t += 30 * 1000;
    const cached = await get('/api/courts?days=2');
    assert.equal(fetch.calls.length, calls, 'served from cache within the TTL');
    assert.deepEqual(cached.json, first.json);

    t += 31 * 1000;
    const after = await get('/api/courts?days=2');
    assert.equal(after.status, 200);
    assert.equal(after.headers['cache-control'], OK_CACHE);
    assert.equal(after.json.fetchedAt, new Date(t).toISOString());
    assert.deepEqual(after.json.errors.map((e) => [e.venue, e.calendar]), [['treehouse', 'https://treehousegym.skedda.com/booking']]);
    assert.match(after.json.errors[0].message, /HTTP 503/);
    const tree = after.json.venues.find((v) => v.id === 'treehouse');
    assert.equal(tree.stale, true);
    assert.deepEqual(tree.facilities, first.json.venues.find((v) => v.id === 'treehouse').facilities);
    assert.equal(after.json.venues.find((v) => v.id === 'velocity').stale, undefined);
  });
});

test('/api/courts over HTTP: a venue that never loaded is just an error (still 200)', async () => {
  const fetch = skedda({ down: new Set(VENUES.map((v) => v.host)) });
  await withServer(courtsHandler({ fetch, now: () => NOW }), async (get) => {
    const r = await get('/api/courts');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.venues, []);
    assert.deepEqual(r.json.errors.map((e) => e.venue), VENUES.map((v) => v.id));
  });
});

test('/api/courts over HTTP: OPTIONS preflight, HEAD without a body, other methods 405', async () => {
  const fetch = skedda();
  await withServer(courtsHandler({ fetch, now: () => NOW }), async (req) => {
    const pre = await req('/api/courts', 'OPTIONS');
    assert.deepEqual([pre.status, pre.text, pre.headers['access-control-allow-origin'], pre.headers['access-control-allow-methods'], pre.headers['access-control-max-age']], [204, '', '*', 'GET', '86400']);
    assert.equal(fetch.calls.length, 0);

    const head = await req('/api/courts', 'HEAD');
    assert.deepEqual([head.status, head.text, head.headers['cache-control']], [200, '', OK_CACHE]);

    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await req('/api/courts', method);
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.allow, 'GET', method);
      assert.equal(r.headers['access-control-allow-origin'], '*', method);
      assert.deepEqual(r.json, { error: 'GET only' }, method);
    }
  });
});
