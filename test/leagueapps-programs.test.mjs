// Volleyball Austin's league and tournament listings on LeagueApps, from trimmed copies (Nov 15, 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { laDate, parseListing, read } from '../lib/programs/leagueapps.js';
import { READERS } from '../lib/programs/feed.js';

const page = (f) => readFileSync(new URL(`./fixtures/programs/leagueapps/${f}.html`, import.meta.url), 'utf8');
const SITE = { org: 'Volleyball Austin', region: 'austin', state: 'TX', city: 'Austin', idPrefix: 'vba', titlePrefix: 'Volleyball Austin' };
const LEAGUES = { ...SITE, url: 'https://volleyballaustin.leagueapps.com/leagues', kind: 'league' };
const TOURNAMENTS = { ...SITE, url: 'https://volleyballaustin.leagueapps.com/tournaments', kind: 'tournament' };
const NOW = Date.parse('2026-11-15T20:00:00Z');

test('LeagueApps dates', () => {
  assert.equal(laDate('Jan&nbsp;5&nbsp;&rsquo;27'), '2027-01-05');
  assert.equal(laDate("Sep 28 '26"), '2026-09-28');
  assert.equal(laDate('soon'), null);
});

test('the winter league: dates, game nights, late registration open until Dec 5, late fee', () => {
  const ps = parseListing(page('vba-leagues'), LEAGUES, { now: NOW });
  assert.deepEqual(ps.map((p) => p.id), ['vba-5173092'], 'the finished fall season is left out');
  const [p] = ps;
  assert.equal(p.title, 'Volleyball Austin Winter 2027 Season');
  assert.deepEqual([p.kind, p.surface, p.starts_on, p.ends_on], ['league', 'indoor', '2027-01-05', '2027-03-06']);
  assert.deepEqual(p.weekdays, ['Tuesday', 'Friday']);
  assert.equal(p.venue, 'Austin Sports Center - Central');
  assert.deepEqual([p.status, p.registration_deadline, p.individual_price], ['open', '2026-12-05', '$95']);
  assert.match(p.format, /^Indoor, 6s, rally scoring.* · Tuesday \/ Friday 6:30pm to 10:30pm$/);
  assert.ok(!/Game Nights/i.test(p.format));
  assert.match(p.signup_url, /^https:\/\/volleyballaustin\.leagueapps\.com\/leagues\//);
  // In the regular window: the regular fee, with the late fee and when it starts.
  const fall = parseListing(page('vba-leagues'), LEAGUES, { now: Date.parse('2026-10-10T18:00:00Z') });
  // The fall season is still on in October: listed, closed, no late-fee note.
  assert.deepEqual(fall.map((x) => [x.id, x.status, x.price_note]), [['vba-5018021', 'closed', 'Plus a processing fee'], ['vba-5173092', 'open', 'Late fee $95 from 2026-11-01; Plus a processing fee']]);
  const early = fall[1];
  assert.equal(early.individual_price, '$85');
  assert.equal(early.price_changes_on, '2026-11-01');
  assert.match(early.price_note, /Late fee \$95 from 2026-11-01/);
  // After registration: closed.
  assert.equal(parseListing(page('vba-leagues'), LEAGUES, { now: Date.parse('2026-12-20T18:00:00Z') }).find((x) => x.id === 'vba-5173092').status, 'closed');
});

test('the Heartbreaker Classic tournament in Round Rock', () => {
  const [t] = parseListing(page('vba-tournaments'), TOURNAMENTS, { now: NOW });
  assert.deepEqual([t.id, t.kind, t.title, t.starts_on, t.ends_on, t.venue, t.city], ['vba-5169668', 'tournament', 'Volleyball Austin · Heartbreaker Classic', '2027-02-07', '2027-02-07', 'Round Rock Sports Center', 'Round Rock']);
  assert.equal(t.status, null, 'the listing gives no registration dates');
});

test('read: both pages; a failing page is skipped; all failing is an error', async () => {
  assert.equal(READERS.leagueapps.id, 'leagueapps');
  const pages = { [LEAGUES.url]: page('vba-leagues'), [TOURNAMENTS.url]: page('vba-tournaments') };
  const get = async (u) => (pages[u] ? { ok: true, status: 200, text: pages[u] } : { ok: false, status: 404, text: '' });
  const all = await read({ get, now: NOW, options: { sites: [LEAGUES, TOURNAMENTS] } });
  assert.deepEqual(all.map((p) => p.id), ['vba-5173092', 'vba-5169668']);
  assert.equal((await read({ get, now: NOW, options: { sites: [LEAGUES, { ...TOURNAMENTS, url: 'https://x.test/t' }] } })).length, 1);
  await assert.rejects(read({ get, now: NOW, options: { sites: [{ ...LEAGUES, url: 'https://x.test/l' }] } }));
});
