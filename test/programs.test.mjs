// Leagues and tournaments: each reader against a saved page, and the feed's keep-last-good rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moneyRange, upcomingDate, monthDay, clean, regionAt, notAfter } from '../lib/programs/common.js';
import { parseAces } from '../lib/programs/aces.js';
import { parseLeagueLab } from '../lib/programs/leaguelab.js';
import { parseNagva, confirmedCounts, tournamentRecords, feeSchedule } from '../lib/programs/nagva.js';
import { clubCompetitions, competitionOf, competitionUrls, parseCompetition, read as readReclub } from '../lib/programs/reclub.js';
import { buildFeed, isDue, runSources, DUE_AFTER_MS, REQUIRED } from '../lib/programs/feed.js';
import { dateRange, parseTexasAO } from '../lib/programs/texasao.js';

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
  assert.equal(upcomingDate(2, 30, '2026-11-08'), null);
  assert.equal(notAfter('2027-11-13', '2027-01-10'), '2026-11-13');
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
  // After the early-bird cutoff, the higher price shows and the note goes.
  const late = parseLeagueLab(fx('leaguelab-austinssc.html'), { site: 'https://austinssc.leaguelab.com', org: 'Austin SSC', now: Date.parse('2026-11-15T18:00:00Z'), regionId: 'austin' })
    .find((p) => /Hanovers/.test(p.title));
  assert.equal(late.price_note, null);
  assert.equal(late.price_changes_on, null);
  assert.ok(Number(late.team_price.slice(1)) > 679);
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
  assert.equal(p.price_changes_on, null); // the last step: $650 from here on
  assert.equal(p.registration_deadline, null); // payment deadlines raise the fee; they don't end registration
  assert.equal(p.waitlist_on, '2026-12-16');
  assert.equal(p.status, 'open');
  assert.deepEqual(p.divisions.find((d) => d.name === 'A1'), { name: 'A1', cap: 12, confirmed: 7 });
  // Nothing about who runs it or who registered.
  assert.doesNotMatch(JSON.stringify(p), /@|venmo|paypal|Team \d|director|registrar/i);
  // Earlier in the season the lower fee shows, with when it goes up.
  const early = parseNagva(html, { now: Date.parse('2026-09-01T17:00:00Z'), regions: REGIONS }).find((x) => x.title === 'Battle of the Alamo 2026');
  assert.equal(early.team_price, '$550');
  assert.equal(early.price_changes_on, '2026-10-05');
  assert.equal(early.price_note, 'Current fee');
  // From the waitlist date, new teams wait.
  assert.equal(parseNagva(html, { now: Date.parse('2026-12-16T18:00:00Z'), regions: REGIONS })[0].status, 'waitlist');
});

test('Reclub: a club page gives its open-competition count; club links are read before the sitemap', async () => {
  // A club page as Reclub serves it: the club record in the Nuxt payload, plus any competition links.
  const clubPage = (active, body = '') => `<html><body>${body}<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(
    [{ data: 1 }, { 'club-@vex': 2 }, { club: 3 }, { name: 4, counts: 5 }, 'Vex Volleyball', { activeCompetitions: 6, pastCompetitions: 7 }, active, 13])}</script></body></html>`;
  const id = '01a178f5-367b-7a23-9ab3-22b8e93c63d6';
  assert.deepEqual(clubCompetitions(clubPage(1, `<a href="/c/${id}">League</a>`)), { name: 'Vex Volleyball', active: 1, links: [`https://reclub.co/c/${id}`] });
  assert.deepEqual(clubCompetitions('<html></html>'), { name: null, active: null, links: [] });

  const pages = {
    'https://reclub.co/clubs/@vex': clubPage(1, `<a href="/c/${id}">League</a>`),
    'https://reclub.co/clubs/@quiet': clubPage(2),
    [`https://reclub.co/c/${id}`]: fx('reclub-competition.html'),
  };
  const asked = [];
  const get = async (u) => { asked.push(u); return pages[u] ? { ok: true, status: 200, text: pages[u] } : { ok: false, status: 503, text: '' }; };
  const logs = [];
  // The sitemap is down: the club's linked league is still read, and a club with unlinked ones is logged.
  const out = await readReclub({ get, now: Date.parse('2026-11-01T17:00:00Z'), regions: REGIONS,
    options: { clubs: ['https://reclub.co/clubs/@vex', 'https://reclub.co/clubs/@quiet'] }, log: (m) => logs.push(m) });
  assert.deepEqual(out.map((p) => p.id), [`reclub-${id}`]);
  assert.equal(asked[0], 'https://reclub.co/clubs/@vex');
  assert.deepEqual(logs, ['Reclub: Vex Volleyball has 2 open competition(s), 0 linked on its page']);
  // Nothing reachable at all: an error, so the feed keeps the last good rows.
  await assert.rejects(readReclub({ get: async () => ({ ok: false, status: 503 }), regions: REGIONS, options: { clubs: ['https://reclub.co/clubs/@x'] } }));
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
  const row = (id, extra = {}) => ({ id, kind: 'league', sport: 'volleyball', org: 'X', source_id: 'x', title: id, starts_on: '2026-12-01', ends_on: '2027-01-01', registration_deadline: '2026-11-20', ...extra });
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

test('Texas Asian Olympics: the year\'s tournament from the home and registration pages', () => {
  assert.deepEqual(dateRange('Nov 14 - 15, 2026'), { starts_on: '2026-11-14', ends_on: '2026-11-15' });
  assert.deepEqual(dateRange('Oct 31 - Nov 1, 2026'), { starts_on: '2026-10-31', ends_on: '2026-11-01' });
  assert.deepEqual(dateRange('Dec 30 - Jan 2, 2027'), { starts_on: '2026-12-30', ends_on: '2027-01-02' });
  assert.equal(dateRange('3 Divisions'), null);
  const home = fx('texasao-home.html'), reg = fx('texasao-registration.html');
  const [p, ...more] = parseTexasAO(home, reg, { now: NOW, regions: REGIONS });
  assert.equal(more.length, 0);
  assert.equal(p.kind, 'tournament');
  assert.equal(p.series, 'asian-olympics');
  assert.equal(p.source_id, 'texasao');
  assert.equal(p.org, 'Texas Asian Olympics');
  assert.equal(p.starts_on, '2026-11-14');
  assert.equal(p.ends_on, '2026-11-15');
  assert.equal(p.venue, "Children's Health StarCenter Multisport Northlake");
  assert.equal(p.city, 'Northlake');
  assert.equal(p.state, 'TX');
  assert.equal(p.region, null); // Dallas–Fort Worth: listed with the rest of Texas
  assert.equal(p.team_price, '$300');
  assert.deepEqual(p.divisions, [{ name: 'Teams', cap: 64 }]);
  assert.equal(p.format, '3 divisions · up to 3 non-Asian players per team');
  assert.equal(p.status, 'open');
  assert.equal(p.signup_url, 'https://texasao.org/registration/');
  assert.doesNotMatch(JSON.stringify(p), /docs\.google|forms\.gle/); // the page, not the form or the roster sheet
  // Without the registration page: still listed, fee and cap unknown.
  const bare = parseTexasAO(home, '', { now: NOW })[0];
  assert.equal(bare.team_price, null);
  assert.deepEqual(bare.divisions, []);
  // A closed registration says so; once it's over it drops.
  assert.equal(parseTexasAO(home, reg.replace('<ul>', '<p>Registration is closed.</p><ul>'), { now: NOW })[0].status, 'closed');
  assert.deepEqual(parseTexasAO(home, reg, { now: Date.parse('2026-11-16T18:00:00Z') }), []);
  // Held in the region's own city, it's the region's.
  const local = parseTexasAO(home.replace('Northlake, TX 76262', 'Austin, TX 78701'), reg, { now: NOW, regions: [{ ...REGIONS[0], name: 'Austin, TX' }] })[0];
  assert.equal(local.region, 'austin');
});

test('feed: a row missing a required field is dropped and counted, never published', () => {
  const row = (id, extra = {}) => ({ id, kind: 'tournament', sport: 'volleyball', org: 'X', title: id, source_id: 'x', starts_on: '2026-12-01', ends_on: '2026-12-01', ...extra });
  const feed = buildFeed({ now: NOW, results: [{ id: 'x', programs: [row('good'), row('no-source', { source_id: null }), row('no-org', { org: '' })] }] });
  assert.deepEqual(feed.programs.map((p) => p.id), ['good']);
  assert.equal(feed.sources[0].dropped, 2);
});

test('every reader sets the required fields', () => {
  const rows = [
    ...parseAces(fx('aces-leagues.html'), { now: NOW, regions: REGIONS }),
    ...parseLeagueLab(fx('leaguelab-austinssc.html'), { site: 'https://austinssc.leaguelab.com', org: 'Austin SSC', now: NOW }),
    ...parseNagva(fx('nagva-tournaments.html'), { now: NOW, regions: REGIONS }),
    parseCompetition(competitionOf(fx('reclub-competition.html')), { now: Date.parse('2026-11-01T17:00:00Z'), regions: REGIONS }),
    ...parseTexasAO(fx('texasao-home.html'), fx('texasao-registration.html'), { now: NOW }),
  ];
  for (const p of rows) for (const k of REQUIRED) assert.ok(typeof p[k] === 'string' && p[k], `${p.id}: ${k}`);
});
