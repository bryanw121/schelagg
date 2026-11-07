import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessions, loadUstaVenue, sessionsUrl } from '../lib/usta-courts.js';
import { loadCourtVenue, VENUES } from '../lib/courts.js';

const ATC = VENUES.find((v) => v.id === 'austin-atc');
const GROUPS = [{ ID: 'all', Name: 'All' }, { ID: 'ten', Name: 'Tennis' }, { ID: 'pb', Name: 'Pickleball' }];
const open = (a = 420, b = 1320) => ({ ID: `d-${a}`, Category: 0, SubCategory: 0, Name: 'Default', StartTime: a, EndTime: b, Capacity: 4 });

/**
 * A synthetic GetVenueSessions answer, times only. Eight pickleball courts open 7am–10pm, listed under
 * both "All" and "Pickleball"; on Nov 7 a club program (category 2000) holds courts 1–3 8:30–11:30am
 * and a booking holds court 5 6–7:30pm. Real program names can name people; these are placeholders.
 */
function sessions(from, to) {
  const dates = []; for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const day = (iso, n) => {
    const s = [];
    if (iso === '2026-11-07' && n <= 3) s.push(open(420, 510), { ID: 'prog', Category: 2000, SubCategory: 2990, Name: 'x', StartTime: 510, EndTime: 690, Capacity: 0, Recurrence: true }, open(690, 1320));
    else if (iso === '2026-11-07' && n === 5) s.push(open(420, 1080), { ID: 'bk', Category: 1, SubCategory: 0, Name: 'x', StartTime: 1080, EndTime: 1170, Capacity: 0 }, open(1170, 1320));
    else s.push(open());
    return { Date: `${iso}T00:00:00`, Sessions: s };
  };
  const court = (group, n) => ({ ID: `${group}${n}`, ResourceGroupID: group, Name: `Pickleball ${n}`, Days: dates.map((iso) => day(iso, n)) });
  return { TimeZone: 'America/Chicago', EarliestStartTime: 420, LatestEndTime: 1320, ResourceGroups: GROUPS,
    Resources: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [court('all', n), court('pb', n)]).concat([{ ID: 't1', ResourceGroupID: 'ten', Name: 'Tennis Court 1', Days: dates.map((iso) => ({ Date: `${iso}T00:00:00`, Sessions: [open()] })) }]) };
}

function usta({ status = 200, body } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (u.hostname !== 'playtennis.usta.com' || u.pathname !== '/v0/VenueBooking/austintenniscenter/GetVenueSessions') throw new Error(`unexpected request ${u.href}`);
    if (status !== 200) return new Response('down', { status });
    return new Response(JSON.stringify(body ?? sessions(u.searchParams.get('startDate'), u.searchParams.get('endDate'))));
  };
  f.calls = calls;
  return f;
}

test('USTA courts: Austin Tennis & Pickleball Center is configured with its eight pickleball courts', () => {
  assert.ok(ATC, 'austin-atc in config/regions/austin/courts.json');
  assert.deepEqual([ATC.system, ATC.slug, ATC.group, ATC.sport, ATC.region], ['usta', 'austintenniscenter', 'Pickleball', 'pickleball', 'austin']);
  assert.deepEqual(ATC.facilities.flatMap((f) => f.spaces), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Pickleball ${n}`));
  assert.equal(ATC.facilities[0].venueId, 'austin-atc');
  assert.equal(sessionsUrl('austintenniscenter', '2026-11-07', '2026-11-08'),
    'https://playtennis.usta.com/v0/VenueBooking/austintenniscenter/GetVenueSessions?resourceID=&startDate=2026-11-07&endDate=2026-11-08&roleId=');
});

test('USTA courts: open time is category 0; programs and bookings take the court; only the chosen group is read', () => {
  const { courts, open: hours } = parseSessions(sessions('2026-11-07', '2026-11-08'), 'Pickleball', '2026-11-07', '2026-11-08');
  assert.deepEqual([...courts.keys()], [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Pickleball ${n}`));
  assert.deepEqual(courts.get('Pickleball 1'), { '2026-11-07': [[510, 690]] });
  assert.deepEqual(courts.get('Pickleball 5'), { '2026-11-07': [[1080, 1170]] });
  assert.deepEqual(courts.get('Pickleball 8'), {});
  assert.deepEqual(hours, { '2026-11-07': [420, 1320], '2026-11-08': [420, 1320] });
  assert.throws(() => parseSessions(sessions('2026-11-07', '2026-11-07'), 'Padel', '2026-11-07', '2026-11-07'), /group "Padel" missing/);
  const bad = sessions('2026-11-07', '2026-11-07');
  bad.Resources[1].Days[0].Sessions[0].StartTime = '7:00';
  assert.throws(() => parseSessions(bad, 'Pickleball', '2026-11-07', '2026-11-07'), /times invalid/);
});

test('USTA courts: one request for the range, the same shape as Skedda, and nothing about who booked', async () => {
  const fetch = usta();
  const v = await loadCourtVenue(ATC, '2026-11-07', 2, { fetchImpl: fetch });
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual([v.id, v.sport, v.region, v.calendarDay], ['austin-atc', 'pickleball', 'austin', 'https://playtennis.usta.com/austintenniscenter/Booking/BookByDate#?date={date}&role=guest']);
  // Nov 7 is a Saturday, Nov 8 a Sunday.
  assert.deepEqual(v.hours, [['07:00', '22:00'], null, null, null, null, null, ['07:00', '22:00']]);
  const courts = v.facilities[0].courts;
  assert.deepEqual(courts[0], { name: 'Pickleball 1', days: { '2026-11-07': [['08:30', '11:30']] } });
  assert.deepEqual(courts[4].days, { '2026-11-07': [['18:00', '19:30']] });
  assert.equal(JSON.stringify(v).includes('"bk"') || JSON.stringify(v).includes('prog'), false, 'session ids and names are not published');
  assert.match(v.note, /2 days ahead/);
});

test('USTA courts: a missing court, a failed request or a bad slug is an error', async () => {
  const body = sessions('2026-11-07', '2026-11-07');
  body.Resources = body.Resources.filter((r) => r.Name !== 'Pickleball 8');
  await assert.rejects(loadUstaVenue(ATC, '2026-11-07', 1, { fetchImpl: usta({ body }) }), /no court named Pickleball 8/);
  await assert.rejects(loadUstaVenue(ATC, '2026-11-07', 1, { fetchImpl: usta({ status: 503 }) }), /HTTP 503/);
  await assert.rejects(loadUstaVenue({ ...ATC, slug: '../x' }, '2026-11-07', 1, { fetchImpl: usta() }), /Invalid USTA venue/);
});
