// Times across the end of daylight saving time (#26): on Sun Nov 1, 2026 at 2am, Austin goes
// from CDT (UTC−5) to CST (UTC−6). Every source gets a session pinned on each side of the change,
// from its own input format (epoch seconds, offset-less local time, page text, hand-entered
// weekly times) through to the feed's UTC instant and the calendar file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vw from '../scripts/adapters/volleyworld.mjs';
import * as daysmart from '../scripts/adapters/daysmart.mjs';
import * as aces from '../scripts/adapters/aces.mjs';
import { localToIso, toOccurrences, occurrenceDate } from '../lib/occurrences.js';
import { localDateTime, today } from '../lib/time.js';
import { tagSession } from '../lib/session.js';
import { toIcs } from '../lib/ics.js';
import { loadSources } from '../lib/registry.js';

const TZ = 'America/Chicago';
const SRC = { id: 'x', sport: 'volleyball', region: 'austin', timezone: TZ };
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8'));
const options = (id) => loadSources().sources.find((s) => s.id === id).options;
const BEFORE = new Date('2026-10-25T17:00:00Z'); // a week ahead covers both sides
/** The feed instants for these sessions, keyed by session id. */
const instants = (sessions) => Object.fromEntries(
  toOccurrences(sessions.map((s) => tagSession(s, SRC)), { now: BEFORE, horizonDays: 14 }).map((o) => [o.id, [o.starts_at, o.ends_at]]));

test('localToIso: wall time to UTC on each side of Nov 1, through the repeated hour, and a 24:00 end', () => {
  const cases = [
    ['2026-10-31', '19:30', '2026-11-01T00:30:00.000Z'], // CDT, −5
    ['2026-10-31', '24:00', '2026-11-01T05:00:00.000Z'], // midnight that night, still CDT
    ['2026-11-01', '00:30', '2026-11-01T05:30:00.000Z'],
    ['2026-11-01', '01:30', '2026-11-01T06:30:00.000Z'], // 1:30 happens twice; the first (CDT) is taken
    ['2026-11-01', '02:30', '2026-11-01T08:30:00.000Z'], // CST from here
    ['2026-11-01', '14:00', '2026-11-01T20:00:00.000Z'],
    ['2026-11-01', '24:00', '2026-11-02T06:00:00.000Z'],
    ['2026-11-02', '19:30', '2026-11-03T01:30:00.000Z'],
  ];
  for (const [d, t, want] of cases) assert.equal(localToIso(d, t, TZ), want, `${d} ${t}`);
  // Another region's zone changes on the same night.
  assert.equal(localToIso('2026-10-31', '18:00', 'America/Denver'), '2026-11-01T00:00:00.000Z');
  assert.equal(localToIso('2026-11-02', '18:00', 'America/Denver'), '2026-11-03T01:00:00.000Z');
});

test('today(): the scrape\'s reference day around midnight on both sides (the runners are in UTC)', () => {
  assert.equal(today(new Date('2026-11-01T04:30:00Z')), '2026-10-31'); // 11:30pm Oct 31 CDT
  assert.equal(today(new Date('2026-11-01T05:30:00Z')), '2026-11-01'); // 12:30am Nov 1 CDT
  assert.equal(today(new Date('2026-11-02T05:30:00Z')), '2026-11-01'); // 11:30pm Nov 1 CST
  assert.equal(today(new Date('2026-11-02T06:30:00Z')), '2026-11-02'); // 12:30am Nov 2 CST
});

test('Volleyworld (epoch seconds): the same 7:30pm class on Oct 31 and Nov 2', () => {
  const base = fixture('arketa-volleyworld-schedule.json').data.classes.find((c) => /adult/i.test(c.name) && !/homeschool/i.test(c.name));
  const at = (iso) => ({ ...base, canceled: false, start_time: Date.parse(iso) / 1000, duration: 120 });
  const sessions = vw.parse({ data: { classes: [at('2026-11-01T00:30:00Z'), at('2026-11-03T01:30:00Z')] } }, TZ);
  assert.deepEqual(sessions.map((s) => [s.date, s.start, s.end]), [['2026-10-31', '19:30', '21:30'], ['2026-11-02', '19:30', '21:30']]);
  assert.deepEqual(Object.values(instants(sessions)), [
    ['2026-11-01T00:30:00.000Z', '2026-11-01T02:30:00.000Z'],
    ['2026-11-03T01:30:00.000Z', '2026-11-03T03:30:00.000Z'],
  ]);
});

test('Reclub (epoch seconds, venue time zone): a late meet lands on its local date on both sides', () => {
  assert.deepEqual(localDateTime(Date.parse('2026-11-01T04:30:00Z'), TZ), { date: '2026-10-31', time: '23:30' });
  assert.deepEqual(localDateTime(Date.parse('2026-11-02T05:30:00Z'), TZ), { date: '2026-11-01', time: '23:30' });
  assert.deepEqual(localDateTime(Date.parse('2026-11-02T00:00:00Z'), TZ), { date: '2026-11-01', time: '18:00' });
});

test('DaySmart (local time without an offset): Ice & Field\'s 2pm public skate on Oct 31 and Nov 1', () => {
  const rec = fixture('daysmart-iceandfield-events.json').data.find((r) => r.attributes.start.startsWith('2026-11-01T14:00'));
  assert.ok(rec, 'fixture has the Nov 1 2pm skate');
  const prev = { ...rec, id: `${rec.id}0`, attributes: { ...rec.attributes, start: '2026-10-31T14:00:00', end: '2026-10-31T16:00:00' } };
  const { sessions } = daysmart.parseEvents([prev, rec], options('ice-and-field'));
  assert.deepEqual(sessions.map((s) => [s.date, s.start, s.end]), [['2026-10-31', '14:00', '16:00'], ['2026-11-01', '14:00', '16:00']]);
  // The rink's own week file gives the Nov 1 skate as 14:00-06:00.
  assert.deepEqual(Object.values(instants(sessions)).map(([s]) => s), ['2026-10-31T19:00:00.000Z', '2026-11-01T20:00:00.000Z']);
});

test('Page text (ACES): "7:30 PM" on Oct 26 and Nov 2', () => {
  const page = options('aces').pages[0];
  const a = aces.parse('Open Play Start: October 26\nOpen Play Time: 7:30 PM – 10 PM', page, '2026-10-24');
  const b = aces.parse('Open Play Start: November 2\nOpen Play Time: 7:30 PM – 10 PM', page, '2026-10-24');
  const got = instants([a, b]);
  assert.deepEqual(got[a.id], ['2026-10-27T00:30:00.000Z', '2026-10-27T03:00:00.000Z']);
  assert.deepEqual(got[b.id], ['2026-11-03T01:30:00.000Z', '2026-11-03T04:00:00.000Z']);
});

test('Hand-entered weekly session: Monday 7:30pm keeps its wall time across the change', () => {
  const weekly = { id: 'weekly-mon', days: ['Mon'], start: '19:30', end: '22:00', title: 'Open play', venue: 'Gym' };
  const got = instants([weekly]);
  assert.deepEqual(got['weekly-mon-2026-10-26'], ['2026-10-27T00:30:00.000Z', '2026-10-27T03:00:00.000Z']);
  assert.deepEqual(got['weekly-mon-2026-11-02'], ['2026-11-03T01:30:00.000Z', '2026-11-03T04:00:00.000Z']);
  // A session running to midnight ends at the right instant on the changeover day.
  const sun = instants([{ id: 'sun', days: ['Sun'], start: '19:00', end: '24:00', title: 'Late', venue: 'Gym' }]);
  assert.deepEqual(sun['sun-2026-11-01'], ['2026-11-02T01:00:00.000Z', '2026-11-02T06:00:00.000Z']);
});

test('Feed dates and calendar files: the occurrence\'s local date, and DTSTART in UTC', () => {
  const [o] = toOccurrences([tagSession({ id: 's', date: '2026-11-01', start: '23:30', end: '24:00', title: 'Late skate', venue: 'Rink' }, SRC)], { now: BEFORE });
  assert.equal(o.starts_at, '2026-11-02T05:30:00.000Z');
  assert.equal(occurrenceDate(o), '2026-11-01'); // still Nov 1 in Austin, though Nov 2 in UTC
  const ics = toIcs([{ ...o, sport: 'volleyball' }], { sport: 'volleyball', name: 'x', generatedAt: '2026-10-25T17:00:00.000Z' });
  assert.match(ics, /DTSTART:20261102T053000Z/);
  assert.match(ics, /DTEND:20261102T060000Z/);
});
