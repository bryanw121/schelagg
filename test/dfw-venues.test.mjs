// DFW readers: City of Fort Worth programs on ACTIVE.com, and The Sports Garden's open-play hours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as active from '../scripts/adapters/active.mjs';
import * as sg from '../scripts/adapters/sportsgarden.mjs';
import { tagSession, validateSessions } from '../lib/session.js';

const fx = (f) => readFileSync(new URL(`./fixtures/sources/${f}`, import.meta.url), 'utf8');
const SRC = { id: 'x', sport: 'volleyball', region: 'dallas', timezone: 'America/Chicago' };

test('ACTIVE listing: volleyball programs only (not basketball, pickleball or table tennis)', () => {
  const links = active.programLinks(fx('active-listing.html'));
  assert.deepEqual(links.map((u) => u.split('-').pop()), ['109915599', '110117958', '110185229']);
});

test('ACTIVE program: a weekly session for its season, from the page\'s event data', () => {
  const url = 'https://www.active.com/fort-worth-tx/volleyball/volleyball-classes/open-play-volleyball-2026-110117958';
  const s = active.parseProgram(fx('active-program-openplay.html'), url);
  assert.deepEqual([s.id, s.days, s.start, s.end, s.startsOn, s.validUntil], ['active-110117958', ['Mon'], '18:00', '20:00', '2026-09-07', '2026-11-30']);
  assert.deepEqual([s.venue, s.city, s.level, s.signup.url], ['Worth Heights Community Center', 'Fort Worth', 'All levels', url]);
  const legends = active.parseProgram(fx('active-program-legends.html'), 'https://www.active.com/a-109915599');
  assert.deepEqual([legends.days, legends.start, legends.end, legends.level, legends.title], [['Thu'], '11:00', '14:00', 'Ages 45+', 'Open Play: Legends Volleyball']);
  assert.equal(validateSessions([s, legends].map((x) => tagSession(x, SRC))).ok.length, 2);
  assert.equal(active.parseProgram('<html></html>', url), null);
});

test('ACTIVE scrape: programs from the listing; seasons already over are left out', async () => {
  const pages = { 'https://www.active.com/fort-worth-tx/volleyball': fx('active-listing.html') };
  const fetch = async (u) => {
    if (pages[u]) return new Response(pages[u]);
    if (/110117958/.test(u)) return new Response(fx('active-program-openplay.html'));
    if (/109915599/.test(u)) return new Response(fx('active-program-legends.html'));
    return new Response('gone', { status: 404 });
  };
  const r = await active.scrape({ options: { listings: ['https://www.active.com/fort-worth-tx/volleyball'] }, fetch, ref: '2026-11-28' });
  assert.deepEqual(r.sessions.map((s) => s.id), ['active-110117958']);
  assert.equal(r.warnings.length, 1);
});

test('Sports Garden: daily North Side hours by day, South Side weekdays, price by time of day', () => {
  const s = sg.parse(fx('sportsgarden-open-play.html'));
  assert.deepEqual(s.map((x) => [x.id, x.days.join(','), x.start, x.end]), [
    ['sportsgarden-north-1500-2400', 'Mon,Tue,Wed,Thu,Fri', '15:00', '24:00'],
    ['sportsgarden-north-1100-2400', 'Sat', '11:00', '24:00'],
    ['sportsgarden-north-1100-2300', 'Sun', '11:00', '23:00'],
    ['sportsgarden-south-1800-2400', 'Mon,Tue,Wed,Thu,Fri', '18:00', '24:00'],
  ]);
  assert.equal(s[0].price, '$5 before 5 PM · $10 after');
  assert.ok(s.every((x) => x.surface === 'sand' && x.city === 'Coppell'));
  assert.equal(validateSessions(s.map((x) => tagSession(x, SRC))).ok.length, 4);
  assert.throws(() => sg.parse('<p>Closed for the season</p>'), /hours not found/);
});
