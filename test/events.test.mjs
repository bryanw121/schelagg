// Austin events (lib/events.js) against a real Postgres: PGlite, Postgres compiled to
// WASM and run in-process, so this is offline and the same on Linux, macOS and Windows. Each
// test gets a fresh database with the migrations applied. The pure helpers (id, row
// mapping, the load plan, the feed merge) are tested without one. Nothing here touches
// the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate, wrapPglite } from '../lib/db.js';
import {
  buildFeed, eventDiffFields, eventId, eventRow, isEventPast, persistEvents, planEvents,
  queryEvents, writeEvents,
} from '../lib/events.js';

const NOW = new Date('2026-11-17T16:00:00Z'); // Monday 10am in Austin
const HOUR = 3600e3;

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = () => { throw new Error('no network in tests: inject a fetch'); }; });
after(() => { globalThis.fetch = realFetch; });

const tmp = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'schelagg-events-')); tmp.push(d); return d; };
after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

/** A fresh migrated database for one test; closed afterwards. */
async function withDb(fn) {
  const db = wrapPglite(new PGlite());

  try {
    await migrate(db, { log: () => {} });
    return await fn(db);
  } finally {
    await db.end();
  }
}

// --- fixtures -------------------------------------------------------------------------------

const EVENTS = [
  {
    id: eventId('https://example.test/miracle', '2026-11-12'), category: 'seasonal', title: 'Miracle on 5th Street',
    venue: 'The Eleanor', area: 'Downtown', city: 'Austin', startDate: '2026-11-12', endDate: '2026-12-30',
    sourceUrl: 'https://example.test/miracle', source: 'instagram', description: 'Christmas pop-up bar',
  },
  {
    id: eventId('https://example.test/joy', '2026-11-20'), category: 'asian-inspired', title: 'joy(n) matcha cart',
    venue: 'SOCO Makers Market', area: 'South Congress', city: 'Austin', startDate: '2026-11-20',
    startTime: '10:00', endTime: '12:00', sourceUrl: 'https://example.test/joy', source: 'instagram',
  },
  {
    id: eventId('https://example.test/bluegenie', '2026-11-13'), category: 'seasonal', title: 'Blue Genie Art Bazaar',
    venue: '6100 Airport Blvd', area: 'North Austin', city: 'Austin', startDate: '2026-11-13', endDate: '2026-12-24',
    sourceUrl: 'https://example.test/bluegenie', source: 'instagram',
  },
];

const OLD = {
  id: eventId('https://example.test/old', '2026-11-10'), category: 'popup', title: 'Old popup',
  venue: 'Somewhere', area: 'Downtown', city: 'Austin', startDate: '2026-11-10', endDate: '2026-11-11',
  sourceUrl: 'https://example.test/old', source: 'instagram',
};

const byId = (id) => [...EVENTS, OLD].find((e) => e.id === id);
const event = async (db, id) => (await db.query('select * from events where id = $1', [id]))[0];

// --- pure helpers ---------------------------------------------------------------------------

test('eventId: deterministic, differs by url and by date', () => {
  const id = eventId('https://example.test/miracle', '2026-11-12');
  assert.equal(id, eventId('https://example.test/miracle', '2026-11-12'));
  assert.match(id, /^evt-[0-9a-f]{16}$/);
  assert.notEqual(id, eventId('https://example.test/miracle', '2026-11-13'));
  assert.notEqual(id, eventId('https://example.test/other', '2026-11-12'));
});

test('eventRow: maps the feed event, normalizing missing and empty fields to null', () => {
  const row = eventRow({ ...EVENTS[1], venue: '', price: '' });
  assert.deepEqual(
    [row.id, row.category, row.title, row.venue, row.area, row.city, row.start_date, row.end_date, row.start_time, row.price, row.source_url],
    [EVENTS[1].id, 'asian-inspired', 'joy(n) matcha cart', null, 'South Congress', 'Austin', '2026-11-20', null, '10:00', null, 'https://example.test/joy'],
  );
  assert.deepEqual(row.data, { ...EVENTS[1], venue: '', price: '' });
  assert.deepEqual(row.attributes, {});

  // An id is derived when the feed omits it.
  assert.equal(eventRow({ category: 'popup', title: 'No id', startDate: '2026-11-21', sourceUrl: 'https://example.test/noid' }).id,
    eventId('https://example.test/noid', '2026-11-21'));
});

test('eventDiffFields and isEventPast', () => {
  assert.deepEqual(eventDiffFields(EVENTS[0], EVENTS[0]), []);
  assert.deepEqual(eventDiffFields(EVENTS[0], { ...EVENTS[0], title: 'Miracle, again', price: '$10' }), ['price', 'title']);
  assert.deepEqual(eventDiffFields({ title: 'x' }, { title: 'x', venue: null }), []); // null/missing are the same

  assert.equal(isEventPast(EVENTS[0], NOW), false); // ends Dec 30
  assert.equal(isEventPast(OLD, NOW), true); // ended Nov 11
  assert.equal(isEventPast({ ...EVENTS[1] }, new Date('2026-11-21T16:00:00Z')), true); // single day, yesterday
});

test('planEvents: added, changed, removed, expired', () => {
  const prev = [
    { id: EVENTS[0].id, data: EVENTS[0], removed_at: null, updated_at: NOW },
    { id: EVENTS[1].id, data: EVENTS[1], removed_at: null, updated_at: NOW },
    { id: OLD.id, data: OLD, removed_at: null, updated_at: NOW },
  ];
  const later = new Date(NOW.getTime() + HOUR);
  const plan = planEvents({ prev, events: [{ ...EVENTS[0], title: 'Miracle on 5th St' }, EVENTS[2]], at: later });

  assert.deepEqual(plan.upserts.map((u) => u.event.id), [EVENTS[0].id, EVENTS[2].id]);
  assert.deepEqual(plan.removed, [EVENTS[1].id, OLD.id]); // both dropped; OLD is expired
  assert.deepEqual(plan.expired, [OLD.id]);
  assert.deepEqual(plan.changes.map((c) => [c.event_id, c.kind, c.fields]), [
    [EVENTS[0].id, 'changed', ['title']],
    [EVENTS[2].id, 'added', []],
    [EVENTS[1].id, 'removed', []],
  ]);
  assert.equal(plan.upserts[0].updated_at, later.toISOString()); // changed: new timestamp
  assert.equal(plan.upserts[1].updated_at, later.toISOString()); // added: new timestamp
});

test('buildFeed: merges with the previous feed, drops past events, sorts', () => {
  const previous = { feedVersion: 1, generatedAt: '2026-11-16T14:00:00.000Z', events: [OLD, EVENTS[0]] };
  const feed = buildFeed({ events: [{ ...EVENTS[0], title: 'Miracle on 5th Street (updated)' }, EVENTS[1]], previous, now: NOW });

  assert.equal(feed.feedVersion, 1);
  assert.equal(feed.generatedAt, NOW.toISOString());
  // OLD ended Nov 11: gone. The updated Miracle wins over the previous copy.
  assert.deepEqual(feed.events.map((e) => [e.startDate, e.title]), [
    ['2026-11-12', 'Miracle on 5th Street (updated)'],
    ['2026-11-20', 'joy(n) matcha cart'],
  ]);

  // A multi-day event that started before today but ends after it stays.
  const spanning = buildFeed({ events: [EVENTS[2]], previous: null, now: NOW });
  assert.equal(spanning.events.length, 1);
});

test('buildFeed and eventRow: coordinates ride through untouched', () => {
  const located = { ...EVENTS[0], lat: 30.26777, lng: -97.74569, located: 'address' };
  const feed = buildFeed({ events: [located], previous: null, now: NOW });
  assert.deepEqual([feed.events[0].lat, feed.events[0].lng, feed.events[0].located], [30.26777, -97.74569, 'address']);

  // The whole feed event lands in the data column, coordinates included.
  const row = eventRow(located);
  assert.deepEqual([row.data.lat, row.data.lng, row.data.located], [30.26777, -97.74569, 'address']);

  // An event without coordinates is untouched too (no nulls invented).
  const plain = buildFeed({ events: [EVENTS[1]], previous: null, now: NOW });
  assert.equal('lat' in plain.events[0], false);
});

// --- writeEvents ------------------------------------------------------------------------------

test('writeEvents: first load inserts, a repeat changes nothing, edits and drops are tracked', async () => {
  await withDb(async (db) => {
    assert.deepEqual(await writeEvents(db, { events: [...EVENTS, OLD], at: NOW }), { events: 4, added: 4, changed: 0, removed: 0, expired: 0 });

    const miracle = await event(db, EVENTS[0].id);
    // PGlite returns date columns as midnight-UTC Dates.
    assert.deepEqual(
      [miracle.category, miracle.title, miracle.venue, miracle.start_date.toISOString().slice(0, 10), miracle.end_date.toISOString().slice(0, 10), miracle.source_url, miracle.removed_at],
      ['seasonal', 'Miracle on 5th Street', 'The Eleanor', '2026-11-12', '2026-12-30', 'https://example.test/miracle', null],
    );
    assert.deepEqual(miracle.data, EVENTS[0]);
    assert.deepEqual([miracle.first_seen_at, miracle.last_seen_at, miracle.updated_at].map((d) => d.toISOString()), Array(3).fill(NOW.toISOString()));

    // The same feed again is a no-op (updated_at untouched).
    const later = new Date(NOW.getTime() + HOUR);
    assert.deepEqual(await writeEvents(db, { events: [...EVENTS, OLD], at: later }), { events: 4, added: 0, changed: 0, removed: 0, expired: 0 });
    assert.equal((await event(db, EVENTS[0].id)).updated_at.toISOString(), NOW.toISOString());

    // A changed title is a 'changed' write with a new updated_at; first_seen_at stays.
    assert.deepEqual(
      await writeEvents(db, { events: [{ ...EVENTS[0], title: 'Miracle on 5th St' }, EVENTS[1], EVENTS[2], OLD], at: later }),
      { events: 4, added: 0, changed: 1, removed: 0, expired: 0 },
    );
    const edited = await event(db, EVENTS[0].id);
    assert.deepEqual([edited.title, edited.updated_at.toISOString(), edited.first_seen_at.toISOString()],
      ['Miracle on 5th St', later.toISOString(), NOW.toISOString()]);

    // Dropping the future event removes it; dropping the past one expires it (no change counted).
    const nextDay = new Date(NOW.getTime() + 24 * HOUR);
    assert.deepEqual(
      await writeEvents(db, { events: [{ ...EVENTS[0], title: 'Miracle on 5th St' }, EVENTS[2]], at: nextDay }),
      { events: 2, added: 0, changed: 0, removed: 1, expired: 1 },
    );
    assert.equal((await event(db, EVENTS[1].id)).removed_at.toISOString(), nextDay.toISOString());
    assert.equal((await event(db, OLD.id)).removed_at.toISOString(), nextDay.toISOString());

    // It comes back if the feed lists it again.
    assert.deepEqual(
      await writeEvents(db, { events: [{ ...EVENTS[0], title: 'Miracle on 5th St' }, EVENTS[1], EVENTS[2]], at: nextDay }),
      { events: 3, added: 1, changed: 0, removed: 0, expired: 0 },
    );
    assert.equal((await event(db, EVENTS[1].id)).removed_at, null);

    // The reader gives the feed back: upcoming, current only.
    const q = await queryEvents(db, { from: '2026-11-17', to: '2026-12-31' });
    assert.equal(q.generatedAt, nextDay.toISOString());
    assert.deepEqual(q.events.map((e) => e.id), [EVENTS[0].id, EVENTS[2].id, EVENTS[1].id]);
    assert.deepEqual((await queryEvents(db, { category: 'asian-inspired', from: '2026-11-17', to: '2026-12-31' })).events.map((e) => e.id), [EVENTS[1].id]);
    // December still overlaps the two multi-day events; nothing runs in January.
    assert.deepEqual((await queryEvents(db, { from: '2026-12-01', to: '2026-12-31' })).events.map((e) => e.id), [EVENTS[0].id, EVENTS[2].id]);
    assert.deepEqual((await queryEvents(db, { from: '2027-01-01', to: '2027-01-31' })).events, []);
  });
});

test('writeEvents: a bad category fails the whole load', async () => {
  await withDb(async (db) => {
    await assert.rejects(writeEvents(db, { events: [{ ...EVENTS[0], category: 'other' }], at: NOW }), /violates check constraint/);
    assert.equal((await db.query('select count(*)::int as n from events'))[0].n, 0);
  });
});

// --- persistEvents ----------------------------------------------------------------------------

test('persistEvents: skipped without a URL, and a failed write is reported, never thrown', async () => {
  assert.deepEqual(await persistEvents({ url: undefined, feed: { events: EVENTS } }), { skipped: true });

  const dir = tempDir();
  const failuresFile = join(dir, 'events.md');
  const logs = [];
  const result = await persistEvents({
    url: 'postgres://user:pass@invalid.invalid/db',
    feed: { feedVersion: 1, generatedAt: NOW.toISOString(), events: EVENTS },
    failuresFile,
    log: (l) => logs.push(l),
    open: async () => { throw new Error('connect ECONNREFUSED'); },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
  assert.match(logs[0], /WARN  events load failed/);

  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(failuresFile, 'utf8'), /Events database load failed on 2026-11-17/);
});
