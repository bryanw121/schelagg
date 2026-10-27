// DaySmart Recreation adapter (scripts/adapters/daysmart.mjs) on events captured from its public
// JSON:API on Oct 26, 2026 (Chaparral Ice) and Ice & Field's published week of Oct 26, reduced to
// the event attributes the adapter reads. Private rentals have their descriptions blanked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as daysmart from '../scripts/adapters/daysmart.mjs';
import { loadSources } from '../lib/registry.js';
import { tagSession, validateSessions } from '../lib/session.js';
import { toOccurrences } from '../lib/occurrences.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const SOURCES = loadSources().sources;
const src = (id) => SOURCES.find((s) => s.id === id);
const records = (name) => JSON.parse(fixture(name)).data;
const CHAPARRAL = [...records('daysmart-chaparralice-events-p1.json'), ...records('daysmart-chaparralice-events-p2.json')];

test('Ice & Field: keeps published public skates on the listed rinks, with rink, capacity and themed titles', () => {
  const { sessions, skipped } = daysmart.parseEvents(records('daysmart-iceandfield-events.json'), src('ice-and-field').options);
  assert.equal(skipped, 0);
  assert.deepEqual(sessions.map((s) => `${s.date} ${s.start}-${s.end}`), [
    '2026-10-26 13:00-15:00', '2026-10-27 13:00-15:15', '2026-10-28 13:00-15:00', '2026-10-29 12:30-15:00',
    '2026-10-31 14:00-16:00', '2026-11-01 14:00-16:00',
  ]);
  const [mon] = sessions;
  assert.deepEqual([mon.id, mon.title, mon.type, mon.rink, mon.capacity, mon.surface, mon.venue, mon.city, mon.price],
    ['daysmart-iceandfield-10378', 'Public Skating', 'Public skate', 'Silver Rink', 250, 'indoor', 'Ice & Field at The Crossover', 'Cedar Park', '$14 · skates $6']);
  assert.equal(sessions[4].title, 'Public Skating Session - Halloween Skate with DJ Paul Secres');
  // Freestyle, stick & puck, hockey, lessons and the unpublished rental are all left out.
  assert.ok(sessions.every((s) => s.type === 'Public skate'));
  assert.ok(!sessions.some((s) => s.id === 'daysmart-iceandfield-99001'));
});

test('Chaparral: dated descriptions fall back to the type title; rinks not listed are skipped and counted', () => {
  const { sessions, skipped } = daysmart.parseEvents(CHAPARRAL, src('chaparral-ice').options);
  assert.deepEqual(sessions.map((s) => [s.id, s.date, s.start, s.end, s.title, s.type, s.rink]), [
    ['daysmart-chaparralice-345508', '2026-10-27', '09:45', '12:00', 'Public Skate', 'Public skate', 'Northcross Rink'],
    ['daysmart-chaparralice-345990', '2026-10-28', '19:30', '21:00', 'Adult Skate', 'Adult skate', 'Northcross Rink'],
  ]);
  assert.equal(skipped, 1); // the public skate on resource 3 (another building)
  assert.match(sessions[0].signup.url, /online\/chaparralice\/calendar/);
});

test('DaySmart sessions pass the publish checks and expand into the feed as ice_skating', () => {
  const s = src('ice-and-field');
  const { sessions } = daysmart.parseEvents(records('daysmart-iceandfield-events.json'), s.options);
  const { ok, warnings } = validateSessions(sessions.map((x) => ({ ...tagSession(x, s), verifiedAt: '2026-10-26' })));
  assert.equal(ok.length, sessions.length);
  assert.deepEqual(warnings, []);
  const feed = toOccurrences(ok, { now: new Date('2026-10-26T12:00:00Z') });
  const sun = feed.find((o) => o.session_id === 'daysmart-iceandfield-2381');
  assert.deepEqual([sun.sport, sun.starts_at, sun.ends_at], ['ice_skating', '2026-11-01T20:00:00.000Z', '2026-11-01T22:00:00.000Z']); // CST after DST ends
  assert.deepEqual([sun.attributes.rink, sun.attributes.type, sun.attributes.capacity], ['Silver Rink', 'Public skate', 250]);
});

test('scrape reads every page with the date filter, then reports shape; errors are clear', async () => {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const page = u.searchParams.get('page[number]');
    return new Response(fixture(`daysmart-chaparralice-events-p${page}.json`));
  };
  const r = await daysmart.scrape({ ref: '2026-10-26', options: src('chaparral-ice').options, fetch, delayMs: 0 });
  assert.equal(calls.length, 2);
  assert.deepEqual([...calls[0].searchParams.entries()], [
    ['company', 'chaparralice'], ['filter[start__gte]', '2026-10-26'], ['filter[start__lte]', '2026-11-09T23:59:59'],
    ['page[size]', '100'], ['page[number]', '1'],
  ]);
  assert.equal(r.sessions.length, 2);
  assert.deepEqual(r.warnings, ['1 public session on rinks not listed in options.resources']);
  for (const k of daysmart.reads) assert.ok(r.shape.includes(k), k);

  await assert.rejects(daysmart.scrape({ ref: '2026-10-26', options: src('chaparral-ice').options, fetch: async () => new Response('nope', { status: 503 }) }), /DaySmart chaparralice HTTP 503/);
  await assert.rejects(daysmart.scrape({ ref: '2026-10-26', options: src('chaparral-ice').options, fetch: async () => new Response('{"errors":[]}') }), /no data array/);
  const none = async () => new Response(JSON.stringify({ data: [], meta: { page: { 'last-page': 1 } } }));
  await assert.rejects(daysmart.scrape({ ref: '2026-10-26', options: src('chaparral-ice').options, fetch: none }), /no matching public sessions/);
});
