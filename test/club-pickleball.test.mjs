import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../lib/registry.js';
import { pageObjects } from '../lib/public-page-data.js';
import { parse, eventTimes, scrape as directoryScrape } from '../scripts/adapters/openplay-directory.mjs';
import { upcoming, parseDetail, scrape } from '../scripts/adapters/opencourt.mjs';
import { page, directory, holyId, holyListing, holyHome, holyDetail } from './fixtures/public-calendars.mjs';

const sources = loadSources().sources;
const directoryOptions = sources.find((s) => s.id === 'austin-club-openplay').options;
const holyOptions = sources.find((s) => s.id === 'holy-pickle').options;
const TZ = 'America/Chicago';

test('public page data: split JSON is decoded without executing page scripts', () => {
  assert.deepEqual(pageObjects(page(directory)), [directory]);
  assert.throws(() => pageObjects('<h1>Sign in</h1>'), /missing/);
  assert.throws(() => pageObjects('<script>self.__next_f.push([1,alert(1)])</script>'));
});

test('directory: dated times, listed per-person prices, skill restrictions, and unknown surface stay distinct', () => {
  const result = parse(page(directory), '2026-10-25', directoryOptions, TZ);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sessions.length, 2);
  const [ranch, east] = result.sessions;
  assert.deepEqual([ranch.date, ranch.start, ranch.end], ['2026-10-25', '19:00', '21:00']);
  assert.equal(ranch.price, '$12 / person (listed)');
  assert.equal(ranch.surface, 'unspecified');
  assert.equal(east.level, '4.0+');
  assert.equal(ranch.scheduleBasis, 'directory_listing');
  assert.match(ranch.note, /independent directory/);
  assert.match(ranch.signup.url, /^https:\/\/austinpickleranch.podplay.app/);
});

test('directory: stale/demo data fails; previews, lessons, unrelated venues, past dates and unsafe links are excluded', () => {
  assert.throws(() => parse(page(directory), '2026-10-29', directoryOptions, TZ), /stale/);
  for (const change of [{ mode: 'demo' }, { freshnessStatus: 'stale' }, { checkedAt: null }]) {
    assert.throws(() => parse(page({ initialData: { ...directory.initialData, ...change } }), '2026-10-25', directoryOptions, TZ), /stale/);
  }
  const e = directory.initialData.events[0];
  const events = [{ ...e, preview: true }, { ...e, name: 'Lesson' }, { ...e, venueSlug: 'unknown' },
    { ...e, startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-10-20T02:00:00Z' }, { ...e, bookingUrl: 'https://evil.test/community/events/abc' }];
  const result = parse(page({ initialData: { ...directory.initialData, events } }), '2026-10-25', directoryOptions, TZ);
  assert.equal(result.sessions.length, 0);
  assert.match(result.warnings[0], /booking URL/);
  const prices = [null, 0, -5].map((price) => parse(page({ initialData: { ...directory.initialData, events: [{ ...e, price }] } }), '2026-10-25', directoryOptions, TZ).sessions[0].price);
  assert.deepEqual(prices, ['Price not listed', '$0 / person (listed)', 'Price not listed']);
});

test('event times: Austin DST and midnight ends are converted from instants', () => {
  assert.deepEqual(eventTimes('2026-11-04T01:00:00Z', '2026-11-04T03:00:00Z', TZ), { date: '2026-11-03', start: '19:00', end: '21:00' });
  assert.equal(eventTimes('2026-11-04T04:00:00Z', '2026-11-04T06:00:00Z', TZ).end, '24:00');
  assert.throws(() => eventTimes('bad', 'bad', TZ));
  assert.throws(() => eventTimes('2026-11-04T03:00:00Z', '2026-11-04T01:00:00Z', TZ));
});

test('OpenCourt: ignore open court rentals; read dated event and nonmember price from venue details', () => {
  assert.deepEqual(upcoming(page(holyHome), '2026-10-25', TZ), [holyListing]);
  const s = parseDetail(page(holyDetail), holyListing, holyOptions, TZ);
  assert.deepEqual([s.date, s.start, s.end, s.price], ['2026-10-25', '09:00', '11:00', '$10 / person (nonmember)']);
  assert.equal(s.signup.url, `https://app.getopencourt.com/club/holy-pickle/schedule/event/${holyId}`);
  assert.equal(s.spotsLeft, undefined, 'do not infer live availability from a cached preview');
  for (const change of [{ deletedAt: '2026-10-24' }, { privacy: 'private' }, { open: false }, { type: 'Clinic' }]) {
    assert.equal(parseDetail(page({ event: { ...holyDetail.event, ...change } }), holyListing, holyOptions, TZ), null);
  }
  assert.throws(() => parseDetail(page({ event: { ...holyDetail.event, club: { slug: 'elsewhere' } } }), holyListing, holyOptions, TZ), /another venue/);
  assert.equal(parseDetail(page({ event: { ...holyDetail.event, metadata: {} } }), holyListing, holyOptions, TZ).price, 'Price not published');
});

test('club scrapes: plain public reads; failure does not silently publish a partial list', async () => {
  const calls = [];
  const result = await scrape({ ref: '2026-10-25', options: holyOptions, timezone: TZ, fetch: async (url) => {
    calls.push(url); return new Response(page(url.endsWith(holyId) ? holyDetail : holyHome));
  } });
  assert.equal(result.sessions.length, 1);
  assert.equal(calls.length, 2);
  await assert.rejects(scrape({ ref: '2026-10-25', options: holyOptions, timezone: TZ, fetch: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(directoryScrape({ ref: '2026-10-25', options: directoryOptions, fetch: async () => new Response('Sign in', { status: 401 }) }), /HTTP 401/);
});
