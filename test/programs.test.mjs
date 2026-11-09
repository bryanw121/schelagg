// Leagues and tournaments: each reader against a saved page, and the feed's keep-last-good rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moneyRange, upcomingDate, monthDay, clean, regionAt } from '../lib/programs/common.js';
import { parseAces } from '../lib/programs/aces.js';
import { parseLeagueLab } from '../lib/programs/leaguelab.js';
import { parseNagva, confirmedCounts, tournamentRecords, feeSchedule } from '../lib/programs/nagva.js';
import { competitionOf, competitionUrls, parseCompetition } from '../lib/programs/reclub.js';
import { buildFeed, isDue, runSources, DUE_AFTER_MS } from '../lib/programs/feed.js';

const fx = (f) => readFileSync(new URL(`./fixtures/programs/${f}`, import.meta.url), 'utf8');
const REGIONS = [{ id: 'austin', center: [30.2672, -97.7431], radiusKm: 60 }];
// The evening the pages were saved (Nov 8, 2026, 7pm in Austin).
const NOW = Date.parse('2026-11-09T01:00:00Z');

test('helpers: money ranges, year-less dates, entities, regions', () => {
  assert.equal(moneyRange([500, 400, 450]), '$400–500');
  assert.equal(moneyRange([105]), '$105');
  assert.equal(moneyRange([0, null]), null);
  assert.deepEqual(monthDay('Sunday, November 22'), [11, 22]);
  assert.equal(upcomingDate(11, 22, '2026-11-08'), '2026-11-22');
  assert.equal(upcomingDate(1, 31, '2026-11-08'), '2027-01-31');
  // A date a few weeks back stays in this year (a deadline that just passed).
  assert.equal(upcomingDate(10, 30, '2026-11-08'), '2026-10-30');
  assert.equal(clean('Coed 4&#039;s &amp; more'), "Coed 4's & more");
  assert.equal(regionAt(30.49, -97.55, REGIONS), 'austin');
  assert.equal(regionAt(29.39, -98.49, REGIONS), null);
});

test('ACES: every league and tournament with today’s price and the early-bird deadline', () => {
  const out = parseAces(fx('aces-leagues.html'), { now: NOW, regions: REGIONS });
  assert.equal(out.length, 13);
  const holiday = out.find((p) => /Holiday Spikes/.test(p.title));
  assert.equal(holiday.kind, 'tournament');
  assert.equal(holiday.surface, 'indoor');
  assert.equal(holiday.region, 'austin');
  assert.equal(holiday.starts_on, '2026-12-05');
  assert.equal(holiday.team_price, '$315–415');
  assert.equal(holiday.individual_price, '$50');
  assert.equal(holiday.price_note, 'Early bird');
  assert.equal(holiday.price_changes_on, '2026-11-08');
  const tuesday = out.find((p) => /Tuesday Co-Ed Sand 4s/.test(p.title));
  assert.equal(tuesday.kind, 'league');
  assert.equal(tuesday.registration_deadline, '2026-11-13');
  assert.equal(tuesday.status, 'open');
  assert.ok(out.every((p) => p.signup_url.startsWith('https://members.acesintexas.com/leagues/')));
});

test('LeagueLab: Austin SSC volleyball and pickleball leagues, dates anchored to the right year', () => {
  const out = parseLeagueLab(fx('leaguelab-austinssc.html'), { site: 'https://austinssc.leaguelab.com', org: 'Austin SSC', now: NOW, regionId: 'austin', state: 'TX' });
  assert.equal(out.length, 16);
  const sarc = out.find((p) => p.title === 'Sunday Indoor Volleyball November 2026 (SARC - South)');
  assert.equal(sarc.sport, 'volleyball');
  assert.equal(sarc.surface, 'indoor');
  assert.equal(sarc.venue, 'South Austin Recreation Center');
  assert.equal(sarc.starts_on, '2026-11-22');
  assert.equal(sarc.ends_on, '2027-01-31');
  assert.equal(sarc.registration_deadline, '2026-11-13');
  assert.equal(sarc.team_price, '$689');
  assert.equal(sarc.individual_price, '$99');
  assert.deepEqual(sarc.weekdays, ['Sunday']);
  const early = out.find((p) => /Hanovers/.test(p.title));
  assert.equal(early.price_note, 'Early bird');
  assert.equal(early.price_changes_on, '2026-11-13');
  assert.equal(early.team_price, '$679');
  assert.ok(out.some((p) => p.sport === 'pickleball' && p.surface === null));
});

test('LeagueLab: Meanwhile sand leagues decode the format text', () => {
  const out = parseLeagueLab(fx('leaguelab-meanwhile.html'), { site: 'https://meanwhile.leaguelab.com', org: 'Meanwhile Brewing', now: NOW, regionId: 'austin' });
  assert.equal(out.length, 4);
  assert.ok(out.every((p) => p.surface === 'sand' && p.team_price === '$700' && p.registration_deadline === '2026-12-14'));
  assert.match(out[0].format, /^Coed 4's/);
});

test('NAGVA: upcoming Texas tournaments only, with the current fee and confirmed teams', () => {
  const html = fx('nagva-tournaments.html');
  assert.equal(tournamentRecords(html).length, 93);
  const rec = tournamentRecords(html).find((r) => r.title === 'Battle of the Alamo 2026');
  assert.deepEqual(feeSchedule(rec, 'America/Chicago').map((f) => f.on), ['2026-10-05', '2026-11-03', '2026-12-01']);
  const confirmed = { [rec._id]: confirmedCounts(fx('nagva-battle-of-the-alamo-2026.html')) };
  const out = parseNagva(html, { now: NOW, regions: REGIONS, confirmed });
  assert.deepEqual(out.map((p) => p.title), ['Battle of the Alamo 2026']);
  const [p] = out;
  assert.equal(p.series, 'nagva');
  assert.equal(p.state, 'TX');
  assert.equal(p.region, null); // San Antonio is outside the Austin circle
  assert.equal(p.city, 'San Antonio');
  assert.equal(p.starts_on, '2026-12-18');
  assert.equal(p.ends_on, '2026-12-19');
  assert.equal(p.team_price, '$650');
  assert.equal(p.registration_deadline, '2026-12-01');
  assert.equal(p.waitlist_on, '2026-12-16');
  assert.deepEqual(p.divisions.find((d) => d.name === 'A1'), { name: 'A1', cap: 12, confirmed: 7 });
  // Nothing about who runs it or who registered.
  assert.doesNotMatch(JSON.stringify(p), /@|venmo|Team \d|Gonzalez/i);
  // Earlier in the season the lower fee shows, with when it goes up.
  const early = parseNagva(html, { now: Date.parse('2026-09-01T17:00:00Z'), regions: REGIONS }).find((x) => x.title === 'Battle of the Alamo 2026');
  assert.equal(early.team_price, '$550');
  assert.equal(early.price_changes_on, '2026-10-05');
});

test('Reclub: sitemap competitions, and a volleyball league near Austin', () => {
  assert.equal(competitionUrls(fx('reclub-sitemap.xml')).length, 3);
  const c = competitionOf(fx('reclub-competition.html'));
  const p = parseCompetition(c, { url: 'https://reclub.co/c/01a178f5-367b-7a23-9ab3-22b8e93c63d6', now: Date.parse('2026-11-01T17:00:00Z'), regions: REGIONS });
  assert.equal(p.kind, 'league');
  assert.equal(p.region, 'austin');
  assert.equal(p.title, 'PFLUGERVILLE MEN’S VOLLEYBALL LEAGUE – SEASON 1');
  assert.equal(p.venue, 'Volleyworld');
  assert.equal(p.starts_on, '2026-11-08');
  assert.equal(p.registration_deadline, '2026-11-04');
  assert.equal(p.team_price, '$510');
  assert.equal(p.status, 'closed'); // registration is locked on the page
  assert.equal(parseCompetition({ ...c, sportId: 2 }, { regions: REGIONS }), null);
  assert.equal(parseCompetition({ ...c, venue: { location: { latitude: 40.7, longitude: -74, address: 'New York, NY' } } }, { regions: REGIONS }), null);
});

test('feed: a failed source keeps its last good rows; past deadlines and ended rows drop', () => {
  const row = (id, extra = {}) => ({ id, kind: 'league', sport: 'volleyball', title: id, starts_on: '2026-12-01', ends_on: '2027-01-01', registration_deadline: '2026-11-20', ...extra });
  const first = buildFeed({ now: NOW, results: [{ id: 'a', programs: [row('a1'), row('a2', { registration_deadline: '2026-11-01' })] }, { id: 'b', programs: [row('b1', { registration_deadline: '2026-11-10' })] }] });
  assert.deepEqual(first.programs.map((p) => p.id), ['b1', 'a1']); // soonest deadline first; a2's has passed
  assert.ok(first.sources.every((s) => s.ok));
  const later = NOW + 12 * 3600e3;
  const second = buildFeed({ now: later, previous: first, results: [{ id: 'a', error: 'HTTP 503' }, { id: 'b', programs: [] }] });
  assert.deepEqual(second.programs.map((p) => p.id), ['a1']);
  const a = second.sources.find((s) => s.id === 'a');
  assert.equal(a.ok, false);
  assert.equal(a.checkedAt, first.generatedAt);
  assert.equal(a.count, 1);
  assert.match(a.error, /503/);
  // A kept row still drops once its deadline passes.
  const third = buildFeed({ now: Date.parse('2026-11-25T18:00:00Z'), previous: second, results: [{ id: 'a', error: 'down' }] });
  assert.deepEqual(third.programs, []);
});

test('feed: due twice a day; runSources turns a throwing reader into an error', async () => {
  assert.equal(isDue(null, NOW), true);
  assert.equal(isDue({ feedVersion: 1, generatedAt: new Date(NOW - DUE_AFTER_MS + 60e3).toISOString() }, NOW), false);
  assert.equal(isDue({ feedVersion: 1, generatedAt: new Date(NOW - DUE_AFTER_MS).toISOString() }, NOW), true);
  const get = async (url) => (url.includes('acesintexas') ? { ok: true, status: 200, text: fx('aces-leagues.html') } : { ok: false, status: 503, text: '' });
  const results = await runSources({ sources: [{ id: 'aces', reader: 'aces' }, { id: 'nagva-tx', reader: 'nagva' }, { id: 'x', reader: 'nope' }] }, { get, now: NOW, regions: REGIONS });
  assert.equal(results[0].programs.length, 13);
  assert.match(results[1].error, /503/);
  assert.match(results[2].error, /no reader/);
});
