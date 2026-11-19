import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarSpan, googleCalendarUrl, icsFile, icsName } from '../public/calendar.js';

const tz = 'America/Chicago';

test('calendarSpan: timed on one day, whole days otherwise', () => {
  assert.deepEqual(calendarSpan({ date: '2026-11-21', start: '18:00', end: '22:00' }), { allDay: false, from: '20261121T180000', to: '20261121T220000' });
  assert.deepEqual(calendarSpan({ date: '2026-11-21', start: '18:00' }), { allDay: false, from: '20261121T180000', to: '20261121T190000' }, 'no end: an hour');
  assert.deepEqual(calendarSpan({ date: '2026-11-21', start: '22:00', end: '01:00' }), { allDay: false, from: '20261121T220000', to: '20261122T010000' }, 'past midnight');
  assert.deepEqual(calendarSpan({ date: '2026-11-21' }), { allDay: true, from: '20261121', to: '20261122' }, 'no hours: the day');
  assert.deepEqual(calendarSpan({ date: '2026-11-20', endDate: '2026-11-29', start: '10:00', end: '18:00' }), { allDay: true, from: '20261120', to: '20261130' }, 'a run of days, end exclusive');
  assert.deepEqual(calendarSpan({ date: '2026-12-31', endDate: '2026-12-31' }), { allDay: true, from: '20261231', to: '20270101' });
});

test('googleCalendarUrl: everything filled in, in the event\'s own time zone', () => {
  const u = new URL(googleCalendarUrl({ title: 'Night Market & Friends', date: '2026-11-21', start: '18:00', end: '22:00', tz, location: 'Republic Square, Austin', url: 'https://example.com/e/1', details: 'Free' }));
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.deepEqual(Object.fromEntries(u.searchParams), { action: 'TEMPLATE', text: 'Night Market & Friends', dates: '20261121T180000/20261121T220000', ctz: tz, details: 'Free\n\nMore: https://example.com/e/1', location: 'Republic Square, Austin' });
  const day = new URL(googleCalendarUrl({ title: 'Fair', date: '2026-11-21', tz }));
  assert.equal(day.searchParams.get('dates'), '20261121/20261122');
  assert.equal(day.searchParams.has('ctz'), false, 'whole days have no zone');
});

test('icsFile: one event a calendar app can open', () => {
  const ics = icsFile({ title: 'Open gym; all levels', date: '2026-11-21', start: '18:00', end: '20:00', tz, location: 'North Gym, Austin', url: 'https://example.com/s' }, { uid: 's:1:2026-11-21', now: new Date('2026-11-19T12:00:00Z') });
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(lines.includes('DTSTART;TZID=America/Chicago:20261121T180000'));
  assert.ok(lines.includes('DTEND;TZID=America/Chicago:20261121T200000'));
  assert.ok(lines.includes('SUMMARY:Open gym\; all levels'), 'punctuation escaped');
  assert.ok(lines.includes('LOCATION:North Gym\\, Austin'));
  assert.ok(lines.includes('DTSTAMP:20261119T120000Z'));
  assert.ok(lines.includes('UID:s:1:2026-11-21@skelly'));
  assert.ok(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
  const day = icsFile({ title: 'Fair', date: '2026-11-20', endDate: '2026-11-22', tz });
  assert.ok(day.includes('DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261123'));
  const long = icsFile({ title: 'x'.repeat(200), date: '2026-11-20', tz });
  assert.ok(long.split('\r\n').every((l) => l.length <= 75), 'long lines are folded');
  assert.equal(icsName('Night Market & Friends!'), 'night-market-friends.ics');
  assert.equal(icsName(''), 'event.ics');
});
