import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../lib/registry.js';
import { pageObjects } from '../lib/public-page-data.js';
import { parse, eventTimes, scrape as directoryScrape } from '../scripts/adapters/openplay-directory.mjs';
import { upcoming, parseDetail, scrape, scheduleEventIds } from '../scripts/adapters/opencourt.mjs';
import { page, directory, holyId, holyListing, holyHome, holyDetail, holySchedule } from './fixtures/public-calendars.mjs';

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
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.startsWith('/api/club/')) return new Response(JSON.stringify(holySchedule(u.searchParams.get('date'))));
    return new Response(page(url.endsWith(holyId) ? holyDetail : holyHome));
  } });
  assert.equal(result.sessions.length, 1);
  assert.equal(calls.length, 1 + 15 + 1); // club page, 15 days of court schedule, one event page
  await assert.rejects(scrape({ ref: '2026-10-25', options: holyOptions, timezone: TZ, fetch: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(directoryScrape({ ref: '2026-10-25', options: directoryOptions, fetch: async () => new Response('Sign in', { status: 401 }) }), /HTTP 401/);
});

test('OpenCourt: events beyond the club page\'s first 10 come from the court schedule; ones without a public page are skipped', async () => {
  // The club page lists nothing; the court schedule holds holyId on Oct 25 and, on Oct 30, a second
  // open play plus a private event whose page is not public.
  const later = '00000000-0000-0000-0000-00000000000a', priv = '00000000-0000-0000-0000-00000000000b';
  const day = (iso) => {
    const body = holySchedule(iso), courts = body.remappedReservations[iso].courts;
    if (iso === '2026-10-30') { courts[0].slots[0].eventId = later; courts[1].slots[0].eventId = priv; }
    return body;
  };
  const laterDetail = { event: { ...holyDetail.event, id: later, spaceAllocations: [{ startTime: '$D2026-10-30T12:00:00Z', endTime: '$D2026-10-30T13:00:00Z', deletedAt: null }] } };
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/api/club/')) return new Response(JSON.stringify(day(u.searchParams.get('date'))));
    if (url.endsWith(priv)) return new Response('Not found', { status: 404 });
    if (url.endsWith(later)) return new Response(page(laterDetail));
    if (url.endsWith(holyId)) return new Response(page(holyDetail));
    return new Response(page([holyHome[0], { ...holyHome[1], events: { events: [], truncated: true } }]));
  };
  const { sessions } = await scrape({ ref: '2026-10-25', options: holyOptions, timezone: TZ, fetch });
  assert.deepEqual(sessions.map((x) => [x.date, x.start, x.end]), [['2026-10-25', '09:00', '11:00'], ['2026-10-30', '07:00', '08:00']]);
  assert.deepEqual(scheduleEventIds(day('2026-10-30'), '2026-10-30').filter((id) => id !== holyId).sort(), [later, priv]);
  assert.throws(() => scheduleEventIds({}, '2026-10-30'), /missing/);
  // An event the club page itself lists as open play must read cleanly.
  await assert.rejects(scrape({ ref: '2026-10-25', options: holyOptions, timezone: TZ, fetch: async (url) => (url.endsWith(holyId) ? new Response('gone', { status: 410 }) : fetch(url).then((r) => (new URL(url).pathname === '/club/holy-pickle' ? new Response(page(holyHome)) : r))) }), /HTTP 410/);
});

test('directory: CourtReserve keeps occurrence IDs and only applies reviewed rates to matching durations', () => {
  const e = {...directory.initialData.events[0], venueSlug:'pickle-pit-stop', price:null, bookingUrl:'https://app.courtreserve.com/Online/Events/Details/15273/ABC?resId=1&utm_source=test'};
  const run = events => parse(page({initialData:{...directory.initialData,events}}),'2026-10-25',directoryOptions,TZ);
  const rows = run([e,{...e,bookingUrl:e.bookingUrl.replace('resId=1','resId=2')}]).sessions;
  assert.equal(rows.length,2);
  assert.notEqual(rows[0].id,rows[1].id);
  assert.equal(new URL(rows[0].signup.url).search,'?resId=1');
  assert.equal(rows[0].price,'$18 / person (venue rate; confirm)');
  assert.match(rows[0].priceSource,/picklepitstop.com/);
  assert.equal(run([{...e,endsAt:'2026-10-26T01:00:00Z'}]).sessions[0].price,'Price not listed');
  assert.equal(run([{...e,bookingUrl:e.bookingUrl.replace('resId=1','missing=1')}]).sessions.length,0);
  const expired = structuredClone(directoryOptions); expired.venues.find(v=>v.slug==='pickle-pit-stop').openPlayRate.reviewBy='2026-10-24';
  assert.equal(parse(page({initialData:{...directory.initialData,events:[e]}}),'2026-10-25',expired,TZ).sessions[0].price,'Price not listed');
});

test('directory: private and restricted sessions are not imported as public open play', () => {
  const e = directory.initialData.events[0];
  const names = ['Private Event', 'Private Event - Open Play', 'Ladies Only Open Play', "Women's Open Play", "Men's Open Play 3.5+",
    'Members Only Open Play', 'Open Play (Invite Only)'];
  const events = names.map((name, i) => ({ ...e, name, bookingUrl: `${e.bookingUrl.slice(0, -1)}${i + 2}` }));
  const kept = ['Open Play: Level 2', 'Open Play: 3.5+ DUPR', 'Level 1 Session (Beginner Open Play)', 'Open Play: 7:00am Early Bird'];
  events.push(...kept.map((name, i) => ({ ...e, name, bookingUrl: `${e.bookingUrl.slice(0, -2)}9${i}` })));
  const result = parse(page({ initialData: { ...directory.initialData, events } }), '2026-10-25', directoryOptions, TZ);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.sessions.map((s) => s.title), kept);
});

test('directory: an evening session is dated by its Austin heading day, not the UTC date in directory URLs', () => {
  // openplaymap's own detail URLs use the UTC date (".../events/2026-11-05-...") for an 8pm Nov 4 CST session.
  const e = { ...directory.initialData.events[0], startsAt: '2026-11-05T02:00:00Z', endsAt: '2026-11-05T04:00:00Z' };
  const s = parse(page({ initialData: { ...directory.initialData, checkedAt: '2026-11-04T18:00:00Z', events: [e] } }), '2026-11-04', directoryOptions, TZ).sessions[0];
  assert.deepEqual([s.date, s.start, s.end], ['2026-11-04', '20:00', '22:00']);
  assert.match(s.signup.url, /^https:\/\/austinpickleranch\.podplay\.app\/community\/events\/[0-9a-f-]+$/, 'links the venue booking event, not the dated directory page');
});
