// Parser tests use text copied from each site on Oct 24, 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vw from '../scripts/sources/volleyworld.mjs';
import * as aces from '../scripts/sources/aces.mjs';
import * as atx from '../scripts/sources/atxbeach.mjs';
import * as vel from '../scripts/sources/velocity.mjs';

const REF = '2026-10-24';

test('Volleyworld: keeps adult sessions, drops youth/homeschool, reads cancellations', () => {
  const text = `October 25 — October 31
Saturday, Oct 24

07:30 PM CDT • (90 min)

Adult Volleyball Training

Adan

Pflugerville • Pflugerville, TX • PF Court 1

View Details
Sign Up
Sunday, Oct 25

10:00 AM CDT • (90 min)

Basecamp Pflugerville

Paty

Pflugerville • Pflugerville, TX • PF Court 1

View Details
Sign Up

05:30 PM CDT • (90 min)

Adult Volleyball Training

Adan

Georgetown • Georgetown, TX • GT Court 3

Canceled
Wednesday, Oct 28

10:30 AM CDT • (90 min)

Volleyworld Homeschool Volleyball Training

Paty

Pflugerville • Pflugerville, TX • PF Court 1

View Details
Sign Up

08:30 PM CDT • (90 min)

Adult Volleyball Training

Adan

Georgetown • Georgetown, TX • GT Court 1

View Details
Sign Up`;
  const s = vw.parse(text, REF);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => [x.date, x.start, x.end, x.city, !!x.canceled]), [
    ['2026-10-24', '19:30', '21:00', 'Pflugerville', false],
    ['2026-10-25', '17:30', '19:00', 'Georgetown', true],
    ['2026-10-28', '20:30', '22:00', 'Georgetown', false],
  ]);
  assert.equal(s[0].signup.label, 'Book on Volleyworld');
});

test('ACES: date, time and prices from an open-play page', () => {
  const text = `OCTOBER 26 REGISTER
Join us for an awesome open-play of Co-Ed Indoor in Pflugerville (Volleyworld)!
Indoor Open Play Start: October 26
Open Play Time: 7:30 PM – 10 PM
Registration Fees:
Indoor Pricing (individual): $6.00
Door Pricing : $10.00`;
  const s = aces.parse(text, aces.PAGES[0], REF);
  assert.equal(s.date, '2026-10-26');
  assert.equal(s.start, '19:30');
  assert.equal(s.end, '22:00');
  assert.equal(s.price, '$6 online · $10 door');
  assert.equal(s.signup.url, aces.PAGES[0].url);
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
