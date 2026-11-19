// Consolidation (lib/consolidate.js) and calendar files (lib/ics.js): venues, moves, dedup, ICS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegions } from '../lib/regions.js';
import { loadVenues, resolveVenues, sourceVenues, markMoves, dedupe, sameSession, titleSimilarity } from '../lib/consolidate.js';
import { toIcs, fold, escapeText } from '../lib/ics.js';
import { toOccurrences } from '../lib/occurrences.js';

const VENUES = loadVenues();
const base = { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', verifiedAt: '2026-10-27' };

test('venues: the real registry loads; bad entries are rejected', () => {
  assert.ok(VENUES.find((v) => v.id === 'crossover-ice').parent === 'crossover');
  const dir = mkdtempSync(join(tmpdir(), 'venues-'));
  const bad = (venues) => { const f = join(dir, 'v.json'); writeFileSync(f, JSON.stringify({ venues })); return () => loadVenues(f); };
  assert.throws(bad([{ id: 'Bad Id', name: 'x' }]), /bad id/);
  assert.throws(bad([{ id: 'a1', name: 'x' }, { id: 'a1', name: 'y' }]), /duplicate/);
  assert.throws(bad([{ id: 'a1', name: 'x', parent: 'nope' }]), /unknown parent/);
  assert.throws(bad([{ id: 'a1', name: 'x', lat: 30.2 }]), /both lat and lng/);
  assert.throws(bad([{ id: 'a1', name: 'x', lat: 130, lng: -97 }]), /bad coordinates/);
  assert.throws(bad([{ id: 'a1', name: 'x', lat: '30.2', lng: '-97.7' }]), /bad coordinates/);
  assert.equal(bad([{ id: 'a1', name: 'x', lat: 30.2672, lng: -97.7431 }, { id: 'a2', name: 'y', lat: null, lng: null }])().length, 2);
  // Every coordinate in the real registry is within its region's radius of its center.
  const regions = Object.fromEntries(loadRegions().map((r) => [r.info.id, r.info]));
  const km = ([a, b], [c, d]) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  for (const v of VENUES.filter((x) => x.lat != null)) {
    const r = regions[v.region];
    assert.ok(r && km(r.center, [v.lat, v.lng]) <= r.radiusKm + 25, `${v.id} is far from ${r?.name ?? v.region}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('resolveVenues: names and aliases match ignoring case and punctuation; unknown names are listed per source', () => {
  const { sessions, unknown } = resolveVenues([
    { id: 'a', sourceId: 'reclub', venue: 'Treehouse Gym (Home of Roots Volleyball)' },
    { id: 'b', sourceId: 'velocity', venue: 'the crossover' },
    { id: 'c', sourceId: 'reclub', venue: 'Pease Park' },
    { id: 'd', sourceId: 'reclub', venue: 'Pease Park', venueId: 'stale' },
  ], VENUES);
  assert.deepEqual(sessions.map((s) => s.venueId), ['treehouse', 'crossover', undefined, undefined]);
  assert.deepEqual([...unknown], [['reclub', ['Pease Park']]]);
});

test('markMoves: a moved dated session keeps its id, is rescheduled, and remembers the original time until it moves back', () => {
  const s = { ...base, id: 'x', date: '2026-10-30', start: '19:00' };
  const r1 = markMoves([{ ...s, start: '19:30' }], [s])[0];
  assert.deepEqual([r1.status, r1.previousStart], ['rescheduled', '2026-10-30 19:00']);
  // Next run: same new time -> still rescheduled from the original.
  const r2 = markMoves([{ ...s, start: '19:30' }], [r1])[0];
  assert.deepEqual([r2.status, r2.previousStart], ['rescheduled', '2026-10-30 19:00']);
  // Moved again: still measured from the original.
  assert.equal(markMoves([{ ...s, date: '2026-10-31', start: '18:00' }], [r2])[0].previousStart, '2026-10-30 19:00');
  // Back to the original time: scheduled again.
  assert.deepEqual(Object.keys(markMoves([s], [r2])[0]).includes('previousStart'), false);
  assert.equal(markMoves([s], [r2])[0].status, 'scheduled');
  // Cancelled wins; weekly sessions and new sessions are just scheduled.
  assert.equal(markMoves([{ ...s, canceled: true }], [s])[0].status, 'cancelled');
  assert.equal(markMoves([{ ...base, id: 'w', days: ['Sun'], start: '19:00' }], [{ ...base, id: 'w', days: ['Sun'], start: '18:00' }])[0].status, 'scheduled');
  assert.equal(markMoves([s], [])[0].status, 'scheduled');
});

test('dedupe: the same session from two sources shows once, from the higher-precedence source, linking the other', () => {
  const aces = { ...base, id: 'aces-1', sourceId: 'aces', title: 'ACES Monday Open Play', venue: 'Volleyworld (Pflugerville)', venueId: 'volleyworld-pflugerville', date: '2026-11-02', start: '19:30', signup: { url: 'https://example.test/aces' } };
  const reclub = { ...base, id: 'reclub-X', sourceId: 'reclub', title: 'ACES Monday Open Play B/BB', venue: 'Volleyworld', venueId: 'volleyworld-pflugerville', date: '2026-11-02', start: '19:40', end: '22:00', capacity: 24, signup: { url: 'https://example.test/reclub' } };
  const other = { ...base, id: 'vw-1', sourceId: 'volleyworld', title: 'Adult Volleyball Training', venueId: 'volleyworld-pflugerville', venue: 'Volleyworld (Pflugerville)', date: '2026-11-02', start: '19:30' };
  const { sessions, merged } = dedupe([reclub, other, aces], ['volleyworld', 'aces', 'reclub', 'manual']);
  assert.deepEqual(sessions.map((s) => s.id), ['vw-1', 'aces-1']); // original order kept
  const kept = sessions.find((s) => s.id === 'aces-1');
  assert.deepEqual(kept.alsoOn, [{ sourceId: 'reclub', id: 'reclub-X', title: 'ACES Monday Open Play B/BB', signup: { url: 'https://example.test/reclub' }, source: undefined }]);
  assert.deepEqual([kept.end, kept.capacity, kept.fieldSources], ['22:00', 24, { end: 'reclub', capacity: 'reclub' }]);
  assert.deepEqual(merged, [{ kept: 'aces-1', dropped: 'reclub-X' }]);
  // Different titles at the same place and time stay separate (the live data's only near-pair).
  assert.equal(sameSession(other, { ...reclub, title: 'Koi C/B Tuesday Coed Net Volleyball' }), false);
  assert.equal(sameSession(aces, { ...aces, sourceId: 'reclub', start: '20:00' }), false); // 30 min apart
  assert.equal(sameSession(aces, { ...aces, sourceId: 'reclub', sport: 'ice_skating' }), false);
  assert.equal(titleSimilarity('Public Skate', 'Public Skating'), 1); // filler words don't count
});

test('feed: venue_id, status and previous_starts_at (rescheduled across the DST change)', () => {
  const [o] = toOccurrences([{ ...base, id: 'm', sourceId: 'x', title: 'T', venue: 'V', venueId: 'atx-beach', date: '2026-11-02', start: '19:00', status: 'rescheduled', previousStart: '2026-10-31 19:00' }], { now: new Date('2026-10-27T12:00:00Z') });
  assert.deepEqual([o.venue_id, o.status, o.starts_at, o.previous_starts_at], ['atx-beach', 'rescheduled', '2026-11-03T01:00:00.000Z', '2026-11-01T00:00:00.000Z']);
  assert.equal(o.attributes.previousStart, undefined);
});

test('ics: one calendar per sport, cancellations kept as CANCELLED, text escaped and lines folded', () => {
  const occ = toOccurrences([
    { ...base, id: 'a', sourceId: 's', title: 'Open Play; B/BB, all welcome', venue: 'ATX Beach', city: 'North Austin', date: '2026-10-28', start: '19:00', end: '21:00', price: '$10', signup: { url: 'https://example.test/a', label: 'Drop in' } },
    { ...base, id: 'b', sourceId: 's', title: 'Gone', venue: 'ATX Beach', date: '2026-10-29', start: '19:00', canceled: true },
    { ...base, sport: 'ice_skating', id: 'c', sourceId: 'r', title: 'Public Skate', venue: 'Chaparral Ice', date: '2026-10-28', start: '10:00', end: '12:00' },
  ], { now: new Date('2026-10-27T12:00:00Z') });
  const ics = toIcs(occ, { sport: 'volleyball', name: 'Skelly · Austin volleyball', generatedAt: '2026-10-27T12:00:00.000Z' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2); // skating is in its own file
  assert.match(ics, /UID:a@schelagg\r\nDTSTAMP:20261027T120000Z\r\nDTSTART:20261029T000000Z\r\nDTEND:20261029T020000Z\r\n/);
  assert.match(ics, /SUMMARY:Open Play\\; B\/BB\\, all welcome/);
  assert.match(ics, /SUMMARY:Cancelled: Gone\r\n[\s\S]*?STATUS:CANCELLED/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.equal(fold('x'.repeat(80)), `${'x'.repeat(75)}\r\n ${'x'.repeat(5)}`);
  assert.equal(fold('é'.repeat(40)).split('\r\n')[0], 'é'.repeat(37)); // 2-byte characters aren't split
  assert.equal(escapeText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
});

test('sourceVenues: a venue the source placed becomes a pinned venue; known names, far-off points and no coordinates do not', () => {
  const venues = [{ id: 'atx-beach', name: 'ATX Beach', aliases: [], region: 'austin' }];
  const regions = { houston: { center: [29.76, -95.37], radiusKm: 60 }, austin: { center: [30.27, -97.74], radiusKm: 60 } };
  const at = (id, venue, region, lat, lng, extra = {}) => ({ id, sourceId: 'reclub', venue, region, city: 'Katy', ...(lat != null ? { venueLat: lat, venueLng: lng } : {}), ...extra });
  const { venues: added, sessions } = sourceVenues([
    at('a', 'T4 Court Rentals', 'houston', 29.7893, -95.7427, { venueAddress: '1419 Vander Wilt Lane, Katy, Tx' }),
    at('b', 'T4 Court Rentals', 'houston', 29.7893, -95.7427), // same place again: one venue
    at('c', 'ATX Beach', 'austin', 30.3, -97.7), // already in venues.json
    at('d', 'Somewhere Far', 'houston', 32.8, -96.95), // Dallas coordinates on a Houston session
    at('e', 'No Coords Gym', 'houston', null, null),
  ], venues, regions);
  assert.deepEqual(added, [{ id: 'src-t4-court-rentals', name: 'T4 Court Rentals', city: 'Katy', address: '1419 Vander Wilt Lane, Katy, Tx', lat: 29.7893, lng: -95.7427, aliases: [], region: 'houston', located: 'source' }]);
  assert.ok(sessions.every((x) => !('venueLat' in x) && !('venueAddress' in x)));
  // Resolving against the combined list stamps the new venue on its sessions.
  const r = resolveVenues(sessions, [...venues, ...added]);
  assert.deepEqual(r.sessions.map((x) => x.venueId ?? null), ['src-t4-court-rentals', 'src-t4-court-rentals', 'atx-beach', null, null]);
  // An id already taken gets a suffix.
  assert.equal(sourceVenues([at('x', 'T4 Court Rentals', 'houston', 29.79, -95.74)], [{ id: 'src-t4-court-rentals', name: 'Other', aliases: [] }], regions).venues[0].id, 'src-t4-court-rentals-2');
});

test('sourceVenues: a venue a source placed last run keeps its pin while a kept session names it', () => {
  const regions = { houston: { center: [29.76, -95.37], radiusKm: 60 } };
  // This run didn't re-read the source: its kept sessions carry no coordinates any more.
  const kept = [{ id: 'a', sourceId: 'reclub', venue: 'T4 Court Rentals', region: 'houston' }];
  const previous = [
    { id: 'src-t4-court-rentals', name: 'T4 Court Rentals', city: 'Katy', lat: 29.7893, lng: -95.7427, region: 'houston' },
    { id: 'src-gone-gym', name: 'Gone Gym', lat: 29.7, lng: -95.4, region: 'houston' }, // no session names it now
    { id: 'configured', name: 'T4 Court Rentals', lat: 1, lng: 1, region: 'houston' }, // not source-placed
  ];
  const { venues } = sourceVenues(kept, [], regions, previous);
  assert.deepEqual(venues.map((v) => [v.id, v.lat, v.located]), [['src-t4-court-rentals', 29.7893, 'source']]);
  assert.equal(resolveVenues(kept, venues).sessions[0].venueId, 'src-t4-court-rentals');
  // Fresh coordinates from the source win over last run's.
  const fresh = sourceVenues([{ ...kept[0], venueLat: 29.8, venueLng: -95.7 }], [], regions, previous).venues;
  assert.deepEqual(fresh.map((v) => [v.id, v.lat]), [['src-t4-court-rentals', 29.8]]);
  // Once the venue is in venues.json, the configured one is used.
  assert.deepEqual(sourceVenues(kept, [{ id: 't4', name: 'T4 Court Rentals', aliases: [] }], regions, previous).venues, []);
});

test('venueCoverage: venues seen only through groups that host there are leads', async () => {
  const { venueCoverage, coverageMarkdown } = await import('../lib/coverage.js');
  const sources = [{ id: 'reclub', adapter: 'reclub' }, { id: 'meetup', adapter: 'ical' }, { id: 'volleyworld', adapter: 'volleyworld' }];
  const schedule = {
    venues: [{ id: 'vw', name: 'Volleyworld', lat: 30.4, lng: -97.7 }, { id: 't4', name: 'T4 Court Rentals', lat: 29.7, lng: -95.7 }, { id: 'gym', name: 'Rental Gym', bookingLink: { url: 'https://x.example/book' } }],
    sessions: [
      { venue: 'Volleyworld', venueId: 'vw', sourceId: 'volleyworld', city: 'Austin' },
      { venue: 'Volleyworld', venueId: 'vw', sourceId: 'reclub', city: 'Austin' }, // also hosted there: still read directly
      { venue: 'T4 Court Rentals', venueId: 't4', sourceId: 'reclub', city: 'Katy' },
      { venue: 'T4 Court Rentals', venueId: 't4', sourceId: 'meetup', city: 'Katy' },
      { venue: 'Rental Gym', venueId: 'gym', sourceId: 'meetup' }, // hosted, but its courts are bookable through us
      { venue: 'Somewhere Park', sourceId: 'reclub' },
    ],
  };
  const rows = venueCoverage(schedule, sources);
  assert.deepEqual(rows.filter((r) => r.lead).map((r) => [r.venue, r.sessions, r.via, r.pinned]), [['T4 Court Rentals', 2, ['meetup', 'reclub'], true], ['Somewhere Park', 1, ['reclub'], false]]);
  assert.deepEqual(rows.filter((r) => !r.lead).map((r) => r.venue).sort(), ['Rental Gym', 'Volleyworld']);
  assert.match(coverageMarkdown([{ name: 'Houston, TX', rows }]), /4 venues with sessions: 2 read directly or bookable, 2 second-hand only\./);
});
