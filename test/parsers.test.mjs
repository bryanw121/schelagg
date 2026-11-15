// Parser tests use text copied from each site on Oct 24, 2026, and raw API responses / pages
// captured by the "Capture source fixtures" workflow on Oct 25, 2026 (test/fixtures/sources, stripped of
// personal data by scripts/sanitize-fixtures.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vw from '../scripts/adapters/volleyworld.mjs';
import * as aces from '../scripts/adapters/aces.mjs';
import * as atx from '../scripts/adapters/atxbeach.mjs';
import * as vel from '../scripts/adapters/velocity.mjs';
import { readFileSync } from 'node:fs';
import { loadSources } from '../lib/registry.js';
import { tagSession, validateSessions } from '../lib/session.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));
const SRC = { id: 'x', sport: 'volleyball', region: 'austin', timezone: 'America/Chicago' };

// Platform adapters take their venues from config/sources.json; test against the real config.
const options = (id) => loadSources().sources.find((s) => s.id === id).options;

const REF = '2026-10-24';

test('Volleyworld: the Arketa API keeps adult sessions, drops youth/homeschool, reads cancellations and spots', () => {
  const s = vw.parse(fixtureJson('arketa-volleyworld-schedule.json'));
  assert.equal(s.length, 13);
  assert.ok(s.every((x) => /adult/i.test(x.title) && !/homeschool/i.test(x.title)));
  // Same id scheme as the old page-text scraper, so consumers keep their rows.
  const byId = Object.fromEntries(s.map((x) => [x.id, x]));
  const gt = byId['volleyworld-2026-10-25-17:30-georgetown'];
  assert.deepEqual([gt.date, gt.start, gt.end, gt.city, gt.venue, gt.canceled], ['2026-10-25', '17:30', '19:00', 'Georgetown', 'Volleyworld (Georgetown)', true]);
  const pf = byId['volleyworld-2026-10-25-20:30-pflugerville'];
  assert.deepEqual([pf.end, pf.canceled, pf.level, pf.type, pf.surface], ['22:00', undefined, 'Adults', 'Training', 'indoor']);
  assert.deepEqual([byId['volleyworld-2026-10-28-20:30-georgetown'].capacity, byId['volleyworld-2026-10-28-20:30-georgetown'].spotsLeft], [12, 11]);
  assert.equal(byId['volleyworld-2026-11-01-07:30-pflugerville'].date, '2026-11-01'); // CDT -> CST weekend
  assert.equal(pf.signup.label, 'Book on Volleyworld');
  const { ok, warnings } = validateSessions(s.map((x) => tagSession(x, SRC)));
  assert.equal(ok.length, 13);
  assert.deepEqual(warnings, []);
});

test('Volleyworld: full and open-gym classes', () => {
  const base = { start_time: 1793237400, duration: 90, canceled: false, display: 'public', location: { name: 'Pflugerville', city: 'Pflugerville' } };
  const s = vw.parse({ data: { classes: [
    { ...base, id: 'a', name: 'Adult Open Gym', hostName: 'Coach', max_capacity: 12, total_booked: 12, isBookable: true },
    { ...base, id: 'b', name: 'Smashball', max_capacity: 24, total_booked: 0 },
  ] } });
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].type, s[0].full, s[0].spotsLeft, s[0].level], ['Open play', true, 0, 'Adults · Coach']);
  assert.throws(() => vw.parse({ error: 'nope' }), /data.classes/);
});

test('ACES: date, time and prices from an open-play page', () => {
  const text = `OCTOBER 26 REGISTER
Join us for an awesome open-play of Co-Ed Indoor in Pflugerville (Volleyworld)!
Indoor Open Play Start: October 26
Open Play Time: 7:30 PM – 10 PM
Registration Fees:
Indoor Pricing (individual): $6.00
Door Pricing : $10.00`;
  const s = aces.parse(text, options('aces').pages[0], REF);
  assert.equal(s.date, '2026-10-26');
  assert.equal(s.start, '19:30');
  assert.equal(s.end, '22:00');
  assert.equal(s.price, '$6 online · $10 door');
  assert.equal(s.signup.url, options('aces').pages[0].url);
});

test('ACES: the current page wording ("Time :", "10 PM" without minutes)', () => {
  const text = 'Open Play Details General Info: Indoor Open Play Start: October 26 Open Play Time : 7:30 PM - 10 PM All members must be 18 years or older to join! ... Registration Fees: Indoor Pricing (individual): $6.00 Door Pricing : $10.00 ...';
  const s = aces.parse(text, options('aces').pages[0], REF);
  assert.deepEqual([s.id, s.date, s.start, s.end, s.price], ['aces-2026-10-26-19:30', '2026-10-26', '19:30', '22:00', '$6 online · $10 door']);
});

test('ACES: other spellings of the same fields', () => {
  const page = options('aces').pages[1];
  const a = aces.parse('Wednesday Open Play\nOpen Play Start: Wednesday, Oct. 28\nOpen Play Time: 7:30 to 10:00 p.m.\nIndoor Pricing (individual) : $ 6\nDoor Pricing: $10', page, REF);
  assert.deepEqual([a.date, a.start, a.end, a.price], ['2026-10-28', '19:30', '22:00', '$6 online · $10 door']);
  const b = aces.parse('NOVEMBER 2 REGISTER\nOpen Play Time:\u00a07PM\u2013 9:30PM', page, REF);
  assert.deepEqual([b.date, b.start, b.end, b.price], ['2026-11-02', '19:00', '21:30', null]);
  assert.throws(() => aces.parse('Open Play Time: TBD', page, REF), /couldn't find date or time/);
});

test('ATX Beach: standard and Friday night open play', () => {
  const text = `Enjoy Unlimited Open Play Standard & Special Sessions.
Standard Open Play is 7 AM-6 PM Monday thru Friday.
Includes access to $20 Friday Night Open Play & Pizza from 7 PM-11 PM, plus any other Special Open Play Sessions announced.`;
  const s = atx.parse(text);
  assert.deepEqual(s[0].days, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.deepEqual([s[0].start, s[0].end], ['07:00', '18:00']);
  assert.deepEqual([s[1].start, s[1].end, s[1].price], ['19:00', '23:00', '$20']);
});

test('Velocity: season window and both nights', () => {
  const text = `Adult Open Play Volleyball
Season Dates: May 20 – August 14, 2026
Wednesday Open Play
Time: 8PM – Midnight
Courts: 5 Courts
Level: Beginner & Intermediate
Friday Open Play
Time: 8PM – Midnight
Courts: 5 Courts
Level: Intermediate & Advanced`;
  const s = vel.parse(text, REF);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].start, s[0].end, s[0].startsOn, s[0].validUntil], ['20:00', '24:00', '2026-05-20', '2026-08-14']);
  assert.equal(s[1].level, 'Intermediate & Advanced');
});

// The fall/winter 2026-27 season page (text from the live page, Nov 1, 2026): Sundays with two skipped.
const VELOCITY_SEASON_PAGE = `FALL/WINTER ADULT OPEN GYM
Sundays • 5PM–8PM • Indoor Open Play
Season Dates: November 15, 2026 – January 17, 2027
Eight Sunday evenings of competitive adult volleyball at The Crossover. Buy the season pass or drop in for a single night. Ages 17 and up.
LOCATION
The Crossover
SESSION DATES
November 15 & 22
December 6, 13, 20 & 27
January 3 & 17
Sundays, 5:00–8:00PM
8-SESSION PASS
$40 with code OPENPLAY40, through November 15
$50 from November 16
SINGLE SESSION
$10 reserved online in advance
$12 at the door
Any Sunday on the schedule
Drop in for one night. Space is capped at 42 players per session, so booking ahead is the safest way to get on a court.`;

test('Velocity: the season page lists each Sunday, across the new year, skipping the off weeks', () => {
  const url = 'https://www.austinvelocity.com/rentals/fall-winter-adult-open-gym';
  const s = vel.parse(VELOCITY_SEASON_PAGE, '2026-11-01', url);
  assert.deepEqual(s.map((x) => x.date), ['2026-11-15', '2026-11-22', '2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27', '2027-01-03', '2027-01-17']);
  assert.deepEqual([s[0].start, s[0].end, s[0].price, s[0].capacity, s[0].id], ['17:00', '20:00', '$10 online · $12 door', 42, 'velocity-2026-11-15']);
  assert.equal(s[0].signup.url, url);
  const { ok, warnings } = validateSessions(s.map((x) => tagSession(x, SRC)));
  assert.equal(ok.length, 8);
  assert.deepEqual(warnings, []);
});

test('Velocity: a season page without a date list runs weekly across the season', () => {
  const s = vel.parse('Sundays • 5PM–8PM\nSeason Dates: November 15, 2026 – January 17, 2027', '2026-11-01');
  assert.deepEqual([s[0].days, s[0].start, s[0].end, s[0].startsOn, s[0].validUntil], [['Sun'], '17:00', '20:00', '2026-11-15', '2027-01-17']);
});

test('Velocity: scrape follows the adult page\'s "See Dates & Pricing" link to the season page', async () => {
  const pages = {
    'https://www.austinvelocity.com/rentals/adult-volleyball-2': 'NOW BOOKING\nFALL/WINTER ADULT OPEN GYM\nSundays • 5PM–8PM • November 15, 2026 – January 17, 2027\nSee Dates & Pricing',
    'https://www.austinvelocity.com/rentals/fall-winter-adult-open-gym': VELOCITY_SEASON_PAGE,
  };
  let url = null;
  const page = {
    goto: async (u) => { url = u; },
    locator: (sel) => ({
      innerText: async () => pages[url],
      first: () => ({ getAttribute: async () => (sel === 'a' ? '/rentals/fall-winter-adult-open-gym' : null) }),
    }),
    close: async () => {},
  };
  const r = await vel.scrape({ browser: { newPage: async () => page }, ref: '2026-11-01' });
  assert.equal(r.sessions.length, 8);
  assert.equal(r.sessions[0].source, 'https://www.austinvelocity.com/rentals/fall-winter-adult-open-gym');
  assert.ok(r.contentHash);
});

test('Velocity: no season posted is an error', () => {
  assert.throws(() => vel.parse('ADULT VOLLEYBALL\nOpen gym and open play for ages 17 and up', '2026-11-01'), /Season dates not found/);
});

import * as reclub from '../scripts/adapters/reclub.mjs';
const RECLUB = options('reclub');
const RECLUB_VENUES = reclub.compileVenues(RECLUB.venues);

const parseFixtureMeet = (code) => reclub.parseMeet(fixture(`reclub-meet-${code}.html`), reclub.meetUrl(code), { venues: RECLUB_VENUES, fallback: RECLUB.fallbackVenue });

test('Reclub: club pages link their upcoming meets', () => {
  assert.deepEqual(reclub.meetLinks(fixture('reclub-club-vex_volleyball.html')), ['UEY4HO', '1QX0YR', 'VONMM8', '2O9PDP']);
  assert.deepEqual(reclub.meetLinks(fixture('reclub-club-austin-lawn-club.html')), ['5X380N']);
});

test('Reclub: Treehouse meet maps to the Treehouse court calendar', () => {
  const s = parseFixtureMeet('VONMM8');
  assert.deepEqual([s.id, s.date, s.start, s.end, s.facility, s.price, s.level], ['reclub-VONMM8', '2026-10-30', '19:00', '22:00', 'treehouse', '$12', 'B/BB']);
  assert.equal(s.venue, 'Roots · Treehouse Gym');
  assert.equal(s.title, 'Qilin B/BB Friday Coed Net Volleyball');
  assert.equal(s.note, 'Hosted by Vex Volleyball, every Friday. Runs on a privately booked court.');
  assert.equal(s.signup.url, 'https://reclub.co/m/VONMM8');
});

test('Reclub: Volleyworld meets get a venue (the old text scraper left it blank)', () => {
  const tue = parseFixtureMeet('UEY4HO');
  assert.deepEqual([tue.date, tue.start, tue.end, tue.venue, tue.city, tue.surface, tue.level], ['2026-10-27', '20:30', '23:30', 'Volleyworld (Pflugerville)', 'Pflugerville', 'indoor', 'C/B']);
  const thu = parseFixtureMeet('1QX0YR');
  assert.equal(thu.level, 'B/BB · men'); // curly apostrophe in "Men’s"
  assert.equal(thu.canceled, undefined);
  const { warnings } = validateSessions([tue, thu].map((x) => tagSession(x, SRC)));
  assert.deepEqual(warnings, []);
});

test('Reclub: lawn club meet in a park is grass', () => {
  const s = parseFixtureMeet('5X380N');
  assert.deepEqual([s.date, s.start, s.end, s.surface, s.price, s.capacity], ['2026-11-01', '10:00', '13:00', 'grass', '$6', 16]);
  assert.equal(s.venue, 'Mueller Lake Park');
  assert.equal(s.note, 'Hosted by Austin Lawn Club, every Sunday.');
});

test('Reclub: a page without meet data is an error, not a session', () => {
  assert.throws(() => reclub.parseMeet('<html><body>Not found</body></html>', 'https://reclub.co/m/XXXXXX'), /no meet data/);
});
