import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDay, loadOpenCourtVenue, scheduleUrl } from '../lib/opencourt-courts.js';
import { loadCourtVenue, VENUES } from '../lib/courts.js';
import { buildCourts } from '../lib/pipeline.js';
import { holySchedule } from './fixtures/public-calendars.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOLY = VENUES.find((v) => v.id === 'holy-pickle');

/** OpenCourt's per-day schedule for the club, from the fixture; `days` overrides individual dates. */
function opencourt({ days = {}, status = 200 } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (u.hostname !== 'app.getopencourt.com' || u.pathname !== '/api/club/holy-pickle/schedule') throw new Error(`unexpected request ${u.href}`);
    if (status !== 200) return new Response('down', { status });
    const iso = u.searchParams.get('date');
    return new Response(JSON.stringify(days[iso] ?? holySchedule(iso)));
  };
  f.calls = calls;
  return f;
}

test('OpenCourt courts: Holy Pickle is configured as a pickleball court calendar with its four courts', () => {
  assert.ok(HOLY, 'holy-pickle in config/regions/austin/courts.json');
  assert.deepEqual([HOLY.system, HOLY.slug, HOLY.sport, HOLY.region], ['opencourt', 'holy-pickle', 'pickleball', 'austin']);
  assert.deepEqual(HOLY.facilities.flatMap((f) => f.spaces), ['Court 1', 'Court 2', 'Court 3', 'Court 4']);
  assert.equal(HOLY.facilities[0].venueId, 'austin-holy-pickle');
  assert.equal(scheduleUrl('holy-pickle', '2026-10-25'), 'https://app.getopencourt.com/api/club/holy-pickle/schedule?date=2026-10-25');
});

test('OpenCourt courts: a day is opening hours plus each court\'s taken time, merged; only times are read', () => {
  const day = parseDay(holySchedule('2026-10-25'), '2026-10-25');
  assert.deepEqual(day.open, [7 * 60, 23 * 60]);
  assert.deepEqual(day.courts, [[[540, 660]], [[540, 660], [780, 870]], [[540, 660]], [[540, 660]]]);
  // One reservation over several slots is one block; back-to-back reservations stay separate, so an
  // open play right before a rental still matches its session.
  const touching = holySchedule('2026-10-26');
  const slots = touching.remappedReservations['2026-10-26'].courts[1].slots;
  for (const m of [870, 900]) slots[slots.findIndex((s) => s.startTimeInMinutes === m)].reservationId = 'r-next';
  assert.deepEqual(parseDay(touching, '2026-10-26').courts[1], [[780, 870], [870, 930]]);
  // A closed day has no hours and nothing booked.
  assert.deepEqual(parseDay(holySchedule('2026-10-27', { closed: true }), '2026-10-27'), { open: null, courts: [[], [], [], []] });
  // An unfamiliar response fails loudly instead of looking free all day.
  assert.throws(() => parseDay({}, '2026-10-25'), /missing/);
  const bad = holySchedule('2026-10-25');
  bad.remappedReservations['2026-10-25'].courts[0].slots[0].startTimeInMinutes = '7:00am';
  assert.throws(() => parseDay(bad, '2026-10-25'), /invalid/);
});

test('OpenCourt courts: loads the same shape as Skedda, by weekday and date, one request per day', async () => {
  const fetch = opencourt();
  const v = await loadCourtVenue(HOLY, '2026-10-25', 3, { fetchImpl: fetch });
  assert.deepEqual(fetch.calls.map((c) => new URL(c).searchParams.get('date')), ['2026-10-25', '2026-10-26', '2026-10-27']);
  assert.deepEqual([v.id, v.sport, v.region, v.calendar, v.calendarDay], ['holy-pickle', 'pickleball', 'austin', 'https://app.getopencourt.com/club/holy-pickle/book', null]);
  // Oct 25 is a Sunday: hours for Sun, Mon, Tue; the rest of the week unknown.
  assert.deepEqual(v.hours, [['07:00', '23:00'], ['07:00', '23:00'], ['07:00', '23:00'], null, null, null, null]);
  const [c1, c2] = v.facilities[0].courts;
  assert.deepEqual(c1, { name: 'Court 1', days: { '2026-10-25': [['09:00', '11:00']] } });
  assert.deepEqual(c2.days, { '2026-10-25': [['09:00', '11:00'], ['13:00', '14:30']], '2026-10-26': [['13:00', '14:30']], '2026-10-27': [['13:00', '14:30']] });
  assert.equal(JSON.stringify(v).includes('r-member'), false, 'reservation ids are not published');
});

test('OpenCourt courts: a court count that no longer matches the config, or a failed request, is an error', async () => {
  const three = holySchedule('2026-10-25');
  three.remappedReservations['2026-10-25'].courts.pop();
  await assert.rejects(loadOpenCourtVenue(HOLY, '2026-10-25', 1, { fetchImpl: opencourt({ days: { '2026-10-25': three } }) }), /lists 3 courts; config has 4/);
  await assert.rejects(loadOpenCourtVenue(HOLY, '2026-10-25', 1, { fetchImpl: opencourt({ status: 503 }) }), /HTTP 503/);
  await assert.rejects(loadOpenCourtVenue({ ...HOLY, slug: '../x' }, '2026-10-25', 1, { fetchImpl: opencourt() }), /Invalid OpenCourt club/);
});

test('build-courts: an OpenCourt venue lands in courts.json next to Skedda ones, and its failure names its sport', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'schelagg-oc-')), 'courts.json');
  const NOW = new Date('2026-10-25T17:00:00Z');
  const ok = await buildCourts({ venues: [HOLY], out, days: 2, fetch: opencourt(), now: () => NOW, log: () => {} });
  assert.deepEqual(ok.venues.map((v) => [v.id, v.sport]), [['holy-pickle', 'pickleball']]);
  const down = await buildCourts({ venues: [HOLY], out, days: 2, fetch: opencourt({ status: 503 }), now: () => NOW, log: () => {} });
  assert.deepEqual(down.errors.map((e) => [e.venue, e.sport]), [['holy-pickle', 'pickleball']]);
  assert.equal(down.venues[0].stale, true, 'kept the last good copy');
});
