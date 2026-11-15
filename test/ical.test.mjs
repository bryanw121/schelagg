// Calendar-feed sessions (Meetup groups' iCal exports), from a trimmed sample with names removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedSessions, icsTime, parseIcs, scrape } from '../scripts/adapters/ical.mjs';

const ICS = readFileSync(new URL('./fixtures/sources/meetup-sample.ics', import.meta.url), 'utf8');
const TODAY = '2026-11-14';

test('unfolds lines and reads each event', () => {
  const evs = parseIcs(ICS);
  assert.equal(evs.length, 6);
  assert.match(evs[0].DESCRIPTION.value, /Sports Garden DFW/);
  assert.equal(evs[0].DTSTART.params.TZID, 'America/Chicago');
});

test('times: zoned wall time as is, UTC converted to Central, all-day has no time', () => {
  assert.deepEqual(icsTime({ value: '20261120T183000', params: { TZID: 'America/Chicago' } }, 'America/Chicago'), { date: '2026-11-20', time: '18:30' });
  assert.deepEqual(icsTime({ value: '20261122T003000Z', params: {} }, 'America/Chicago'), { date: '2026-11-21', time: '18:30' });
  assert.deepEqual(icsTime({ value: '20261120T183000', params: { TZID: 'America/New_York' } }, 'America/Chicago'), { date: '2026-11-20', time: '17:30' });
  assert.deepEqual(icsTime({ value: '20261120', params: {} }, 'America/Chicago'), { date: '2026-11-20', time: null });
});

test('events become dated sessions: sand from the description, venue after "@", clinics apart, no descriptions', () => {
  const s = feedSessions(ICS, { url: 'https://www.meetup.com/x/events/ical/', idPrefix: 'mu', host: 'A group' }, { today: TODAY });
  assert.deepEqual(s.map((x) => x.title), ['Friday - Sand Volleyball (South Location)', 'Adult Beginner Open Gym Volleyball Lewisville', 'Adult Volleyball Skills Clinic and Training', 'Saturday Open Gym']);
  const [sand, beginner, clinic, sat] = s;
  assert.deepEqual([sand.date, sand.start, sand.end, sand.surface, sand.venue, sand.type], ['2026-11-20', '18:30', '21:30', 'sand', 'Sports Garden DFW', 'Open play']);
  assert.equal(sand.signup.url, 'https://www.meetup.com/dfwvolleyballdallas/events/316813545/');
  assert.equal(sand.id, 'mu-event_316813545-2026-11-20');
  assert.deepEqual([beginner.surface, beginner.level, beginner.type], ['indoor', 'Beginner', 'Open play']);
  assert.equal(clinic.type, 'Clinic');
  assert.deepEqual([sat.date, sat.start], ['2026-11-21', '18:30']);
  assert.equal(sand.note, 'Hosted by A group.');
  for (const x of s) assert.ok(!JSON.stringify(x).match(/REGISTER|properly managed|groups by skill/), 'descriptions are not published');
});

test('include / exclude filter titles; feed venue and city win', () => {
  const s = feedSessions(ICS, { url: 'u', exclude: 'clinic', venue: 'The Gym', city: 'Lewisville', note: 'Pay in the app.' }, { today: TODAY });
  assert.ok(s.every((x) => x.type === 'Open play' && x.venue === 'The Gym' && x.city === 'Lewisville'));
  assert.equal(s[0].note, 'Pay in the app.');
  assert.deepEqual(feedSessions(ICS, { url: 'u', include: 'sand' }, { today: TODAY }).map((x) => x.date), ['2026-11-20']);
});

test('scrape: a feed that fails is a warning; all failing is an error; an empty feed is fine', async () => {
  const feeds = [{ url: 'https://a/ical' }, { url: 'https://b/ical' }];
  const pages = { 'https://a/ical': ICS, 'https://b/ical': 'BEGIN:VCALENDAR\nEND:VCALENDAR' };
  const fetch = async (u) => new Response(pages[u] ?? 'nope', { status: pages[u] ? 200 : 404 });
  // Far-future dates, so the test doesn't depend on today. Meetup's UIDs end in "@meetup.com": not part of the id.
  pages['https://a/ical'] = ICS.replace(/2026112/g, '2099112').replace('UID:event_316813545', 'UID:event_316813545@meetup' + '.com');
  const r = await scrape({ options: { feeds }, timezone: 'America/Chicago', fetch });
  assert.ok(r.sessions.length >= 1);
  assert.ok(r.sessions.some((x) => x.id === 'ical-event_316813545-2099-11-20'));
  assert.deepEqual(r.warnings, []);
  await assert.rejects(scrape({ options: { feeds: [{ url: 'https://c/ical' }] }, timezone: 'America/Chicago', fetch }));
});
