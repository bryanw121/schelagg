import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, busyBySpace, openingHours, spaceNames, merge } from '../lib/skedda.js';
import { addDays, dow, to24, resolveMonthDay } from '../lib/time.js';

test('one-off booking only on its date', () => {
  const b = { start: '2026-10-25T16:00:00', end: '2026-10-25T19:00:00' };
  assert.deepEqual(occurrences(b, '2026-10-24', '2026-10-31'), ['2026-10-25']);
  assert.deepEqual(occurrences(b, '2026-10-26', '2026-10-31'), []);
});

test('weekly BYDAY with UNTIL and EXDATE', () => {
  const b = { start: '2026-10-27T08:00:00', end: '2026-10-27T12:00:00',
    recurrenceRule: 'DTSTART:20261027T080000Z\r\nRRULE:FREQ=WEEKLY;UNTIL=20261105T235959Z;INTERVAL=1;BYDAY=TU,TH\r\nEXDATE:20261029T000000Z\r\n' };
  assert.deepEqual(occurrences(b, '2026-10-24', '2026-11-30'), ['2026-10-27', '2026-11-03', '2026-11-05']);
});

test('weekly COUNT counts excluded dates', () => {
  const b = { start: '2026-09-19T07:00:00', end: '2026-09-19T14:00:00',
    recurrenceRule: 'RRULE:FREQ=WEEKLY;COUNT=8;INTERVAL=1;BYDAY=SA\r\nEXDATE:20261024T000000Z,20261003T000000Z\r\n' };
  // Sep 19 + 7 more Saturdays = through Nov 7; Oct 3 and Oct 24 skipped.
  assert.deepEqual(occurrences(b, '2026-10-17', '2026-11-30'), ['2026-10-17', '2026-10-31', '2026-11-07']);
});

test('every-other-week interval', () => {
  const b = { start: '2026-10-05T18:00:00', end: '2026-10-05T19:00:00', recurrenceRule: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO\r\n' };
  assert.deepEqual(occurrences(b, '2026-10-01', '2026-11-03'), ['2026-10-05', '2026-10-19', '2026-11-02']);
});

test('busy blocks merge per court and map space ids to names', () => {
  const names = { 1: 'CO Court 1', 2: 'CO Court 2' };
  const bookings = [
    { start: '2026-10-26T15:00:00', end: '2026-10-26T16:30:00', spaces: ['1', '2'] },
    { start: '2026-10-26T16:00:00', end: '2026-10-26T20:30:00', spaces: ['1'] },
  ];
  const busy = busyBySpace(bookings, names, '2026-10-24', '2026-10-31');
  assert.deepEqual(busy['CO Court 1']['2026-10-26'], [[900, 1230]]);
  assert.deepEqual(busy['CO Court 2']['2026-10-26'], [[900, 990]]);
});

test('opening hours from Skedda bitmask rules (bit 0 = Sunday)', () => {
  const webs = { venue: [{ hoursOfAvailability: { rules: [
    { spaceIds: null, start: 480, end: 1260, daysBitmask: 30 },  // Mon-Thu
    { spaceIds: null, start: 480, end: 1320, daysBitmask: 32 },  // Fri
    { spaceIds: null, start: 480, end: 1260, daysBitmask: 65 },  // Sat+Sun
  ] } }] };
  const h = openingHours(webs);
  assert.deepEqual(h[1], [480, 1260]);
  assert.deepEqual(h[5], [480, 1320]);
  assert.deepEqual(h[0], [480, 1260]);
});

test('space names found anywhere in /webs', () => {
  const webs = { spaces: [{ name: 'HP Court 1', nonAdminVisible: false, index: 0, venue: '181081', id: '993108' }] };
  assert.deepEqual(spaceNames(webs), { 993108: 'HP Court 1' });
});

test('time helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(dow('2026-10-24'), 6);
  assert.equal(to24('7:30 PM'), '19:30');
  assert.equal(to24('12 AM'), '00:00');
  assert.equal(resolveMonthDay('OCTOBER', 26, '2026-10-24'), '2026-10-26');
  assert.equal(resolveMonthDay('Jan', 5, '2026-11-20'), '2027-01-05');
  assert.deepEqual(merge([[60, 120], [100, 200], [300, 400]]), [[60, 200], [300, 400]]);
});
