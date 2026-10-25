import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localToIso, toOccurrences } from '../lib/occurrences.js';

const AUSTIN = { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', sourceId: 'x' };
const NOW = new Date('2026-10-24T17:00:00Z'); // Oct 24 noon in Austin

test('localToIso handles CDT, CST, midnight rollover and other zones', () => {
  assert.equal(localToIso('2026-10-24', '19:30', 'America/Chicago'), '2026-10-25T00:30:00.000Z'); // CDT (UTC-5)
  assert.equal(localToIso('2026-12-01', '19:30', 'America/Chicago'), '2026-12-02T01:30:00.000Z'); // CST (UTC-6)
  assert.equal(localToIso('2026-10-24', '24:00', 'America/Chicago'), '2026-10-25T05:00:00.000Z');
  assert.equal(localToIso('2026-07-01', '09:00', 'America/Los_Angeles'), '2026-07-01T16:00:00.000Z');
});

test('dated sessions inside the window become one occurrence each', () => {
  const rows = toOccurrences([
    { ...AUSTIN, id: 'a', title: 'Open play', venue: 'V', date: '2026-10-25', start: '18:00', end: '20:00', surface: 'sand', type: 'Open play', signup: { url: 'https://s', label: 'Sign up' } },
    { ...AUSTIN, id: 'old', title: 'Old', venue: 'V', date: '2026-10-01', start: '18:00' },
  ], { now: NOW, horizonDays: 7 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].sport, 'volleyball');
  assert.equal(rows[0].starts_at, '2026-10-25T23:00:00.000Z');
  assert.deepEqual(rows[0].attributes, { surface: 'sand', type: 'Open play' });
  assert.equal(rows[0].signup_url, 'https://s');
});

test('weekly sessions expand within their season and skip missing start times', () => {
  const rows = toOccurrences([
    { ...AUSTIN, id: 'w', title: 'Weekly', venue: 'V', days: ['Sun'], start: '19:00', validUntil: '2026-11-02' },
    { ...AUSTIN, id: 'tba', title: 'TBA', venue: 'V', days: ['Mon'] },
  ], { now: NOW, horizonDays: 14 });
  assert.deepEqual(rows.map((r) => r.id), ['w-2026-10-25', 'w-2026-11-01']);
});

test('all-day facility hours are not listed as sessions', () => {
  const rows = toOccurrences([
    { ...AUSTIN, id: 'hours', title: 'Standard Open Play', venue: 'V', days: ['Mon'], start: '07:00', end: '18:00' },
  ], { now: NOW, horizonDays: 7 });
  assert.equal(rows.length, 0);
});

test('a non-volleyball session in another zone uses its own local date and offset', () => {
  const rows = toOccurrences([
    { id: 'pb', sport: 'pickleball', region: 'seattle', timezone: 'America/Los_Angeles', sourceId: 'y', title: 'Drop-in', venue: 'Court', date: '2026-10-24', start: '18:00', format: 'doubles' },
  ], { now: NOW, horizonDays: 3 });
  assert.equal(rows[0].starts_at, '2026-10-25T01:00:00.000Z');
  assert.deepEqual(rows[0].attributes, { format: 'doubles' });
});
