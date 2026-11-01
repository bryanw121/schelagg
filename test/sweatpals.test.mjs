// Sweatpals adapter (scripts/adapters/sweatpals.mjs) on host pages captured by the "Capture source
// fixtures" workflow on Oct 31, 2026, reduced by scripts/sanitize-fixtures.mjs to the event lists in
// __NEXT_DATA__ (no hosts' accounts, attendees or descriptions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sp from '../scripts/adapters/sweatpals.mjs';
import { loadSources } from '../lib/registry.js';
import { tagSession, validateSessions } from '../lib/session.js';
import { sanitizeSweatpalsHost } from '../scripts/sanitize-fixtures.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const SRC = loadSources().sources.find((s) => s.id === 'sweatpals');
const O = SRC.options;
const CFG = { venues: sp.compileVenues(O.venues), fallback: O.fallbackVenue, include: O.include };
const host = (slug) => sp.parseHost(fixture(`sweatpals-host-${slug}.html`), O.hosts.find((h) => h.slug === slug), CFG).sessions;

test('Sweatpals: a weekly event becomes one dated session per upcoming date, at its venue', () => {
  const s = host('ATXBeach');
  assert.deepEqual(s.map((x) => x.date), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
  const [fri] = s;
  // 17:00Z is 11am in Austin (CST after Nov 1).
  assert.deepEqual([fri.id, fri.start, fri.end, fri.title, fri.type, fri.price], ['sweatpals-friday-lunch-open-play-2026-11-06-1100', '11:00', '14:00', 'Friday Lunch Open Play 🏐', 'Open play', '$10']);
  assert.deepEqual([fri.venue, fri.city, fri.surface], ['ATX Beach', 'North Austin', 'sand']);
  assert.equal(fri.signup.url, 'https://sweatpals.com/event/friday-lunch-open-play/2026-11-06');
  assert.equal(validateSessions(s.map((x) => tagSession(x, SRC))).warnings.length, 0);
});

test('Sweatpals: a host whose events are all volleyball keeps names without the word', () => {
  const [sun] = host('atxsandsocial');
  assert.deepEqual([sun.date, sun.start, sun.end, sun.venue, sun.surface, sun.type], ['2026-11-01', '19:00', '22:00', 'ATX Beach', 'sand', 'Open play']);
  // With the default filter it would be skipped: "Sunday Funday" doesn't say volleyball.
  assert.equal(sp.parseHost(fixture('sweatpals-host-atxsandsocial.html'), { slug: 'atxsandsocial' }, CFG).sessions.length, 0);
});

test('Sweatpals: tournaments and park venues', () => {
  const s = host('letsvolleyatx');
  assert.deepEqual(s.map((x) => [x.date, x.start, x.type, x.venue, x.surface, x.price]), [
    ['2026-11-08', '09:00', 'Open play', 'Mueller Lake Park', 'grass', '$10'],
    ['2026-11-14', '10:00', 'Tournament', 'Mueller Lake Park', 'grass', '$15'],
  ]);
});

test('Sweatpals: types, prices and skipped events', () => {
  assert.equal(sp.typeOf('Shamrock Slam Tourney'), 'Tournament');
  assert.equal(sp.typeOf('Thursday Fall League Play'), 'League');
  assert.equal(sp.typeOf('Tuesdays Intermediate Technique Tuesday'), 'Clinic');
  assert.equal(sp.typeOf('Rise & Volley - Sunday Drills + Open Play'), 'Open play');
  assert.equal(sp.priceOf({ isPaid: false }), 'Free');
  assert.equal(sp.priceOf({ prices: [{ priceAmount: 1500 }, { priceAmount: 750 }] }), '$7.50–15');
  const page = (events) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { dehydratedState: { queries: [{ queryKey: ['events', 'h', 'events'], state: { data: { pages: [{ data: events }] } } }] } } } })}</script>`;
  const base = { alias: 'x', name: 'Volleyball open play', tzid: 'America/Chicago', startDate: '2026-11-03T00:00:00Z', endDate: '2026-11-03T02:00:00Z', upcomingDays: [{ date: '2026-11-02', count: 1, times: ['2026-11-03T00:00:00.000Z'], lastEnd: '2026-11-03T02:00:00.000Z' }] };
  const events = [
    { ...base, id: '1' },
    { ...base, id: '2', alias: 'y', publishingState: 'draft' },
    { ...base, id: '3', alias: 'z', isOnlineEvent: true },
    { ...base, id: '4', alias: 'w', name: 'Run club' },
  ];
  const { sessions } = sp.parseHost(page(events), { slug: 'h' }, CFG);
  assert.deepEqual(sessions.map((s) => [s.id, s.date, s.start, s.end]), [['sweatpals-x-2026-11-02-1800', '2026-11-02', '18:00', '20:00']]);
  assert.throws(() => sp.hostEvents('<html>no data</html>'), /no __NEXT_DATA__/);
});

test('Sweatpals: scrape reads every host, and one failing host is a warning', async () => {
  const fetch = async (url) => {
    const slug = new URL(url).pathname.split('/').pop();
    if (slug === 'letsvolleyatx') return new Response('down', { status: 503 });
    return new Response(fixture(`sweatpals-host-${slug}.html`));
  };
  const r = await sp.scrape({ options: O, timezone: 'America/Chicago', ref: '2026-11-01', fetch });
  // Within the 14-day horizon: Sand Social on Nov 1 and the Fridays of Nov 6 and 13.
  assert.deepEqual(r.sessions.map((s) => s.date), ['2026-11-06', '2026-11-13', '2026-11-01']);
  assert.deepEqual(r.warnings, ['https://sweatpals.com/host/letsvolleyatx: HTTP 503']);
  assert.ok(sp.reads.every((k) => r.shape.includes(k)), 'every field the adapter reads is in the raw data');
  await assert.rejects(sp.scrape({ options: O, fetch: async () => new Response('down', { status: 503 }) }), /HTTP 503/);
});

test('Sweatpals fixtures keep no people or free text', () => {
  for (const h of O.hosts) {
    const html = fixture(`sweatpals-host-${h.slug}.html`);
    assert.equal(sanitizeSweatpalsHost(html), html, `${h.slug} is already sanitized`);
    assert.doesNotMatch(html, /"(author|eventLeaders|description|stripe\w*|fullName|login)"/);
  }
});
