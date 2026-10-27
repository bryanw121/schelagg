// Consolidation (lib/consolidate.js) and calendar files (lib/ics.js): venues, moves, dedup, ICS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVenues, loadVenueConfig, resolveVenues, markMoves, dedupe, sameSession, titleSimilarity } from '../lib/consolidate.js';
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
  assert.deepEqual(sessions.map((s) => s.area), ['north-austin', 'cedar-park-leander', undefined, undefined]);
  assert.deepEqual([...unknown], [['reclub', ['Pease Park']]]);
});

test('areas: every venue is in a known area, so the site can filter by it', () => {
  const { areas, venues } = loadVenueConfig();
  const ids = new Set(areas.map((a) => a.id));
  assert.ok(areas.length >= 2);
  const missing = venues.filter((v) => !ids.has(v.area)).map((v) => v.id);
  assert.deepEqual(missing, [], `pick an area in config/venues.json for: ${missing.join(', ')}`);
  // Each area holds at least one venue (an empty one would be a filter that never matches).
  for (const a of areas) assert.ok(venues.some((v) => v.area === a.id), `${a.id} has no venues`);

  const dir = mkdtempSync(join(tmpdir(), 'areas-'));
  const cfg = (body) => { const f = join(dir, 'v.json'); writeFileSync(f, JSON.stringify(body)); return () => loadVenueConfig(f); };
  assert.throws(cfg({ areas: [{ id: 'north', name: 'North' }], venues: [{ id: 'a1', name: 'x', area: 'south' }] }), /a1 has unknown area "south"/);
  assert.throws(cfg({ areas: [{ id: 'north', name: 'North' }, { id: 'north', name: 'N' }], venues: [] }), /duplicate area/);
  // A venue discovery just added, with no area yet, still loads (the test above flags it instead).
  assert.equal(cfg({ areas: [{ id: 'north', name: 'North' }], venues: [{ id: 'a1', name: 'x' }] })().venues.length, 1);
  rmSync(dir, { recursive: true, force: true });
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
  const ics = toIcs(occ, { sport: 'volleyball', name: 'Schelagg · Austin volleyball', generatedAt: '2026-10-27T12:00:00.000Z' });
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
