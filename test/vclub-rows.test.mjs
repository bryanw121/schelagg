import { test } from 'node:test';
import assert from 'node:assert/strict';
import { austinToIso, toVclubRows } from '../lib/vclub-rows.js';

test('austinToIso handles CDT, CST and midnight rollover', () => {
  assert.equal(austinToIso('2026-10-24', '19:30'), '2026-10-25T00:30:00.000Z'); // CDT (UTC-5)
  assert.equal(austinToIso('2026-12-01', '19:30'), '2026-12-02T01:30:00.000Z'); // CST (UTC-6)
  assert.equal(austinToIso('2026-10-24', '24:00'), '2026-10-25T05:00:00.000Z');
});

test('dated sessions inside the window become one row each', () => {
  const rows = toVclubRows([
    { id: 'a', title: 'Open play', venue: 'V', date: '2026-10-25', start: '18:00', end: '20:00', sourceId: 'x', surface: 'sand', signup: { url: 'https://s', label: 'Sign up' } },
    { id: 'old', title: 'Old', venue: 'V', date: '2026-10-01', start: '18:00' },
  ], { from: '2026-10-24', horizonDays: 7 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].surface, 'sand');
  assert.equal(rows[0].signup_url, 'https://s');
});

test('weekly sessions expand within their season and skip missing start times', () => {
  const rows = toVclubRows([
    { id: 'w', title: 'Weekly', venue: 'V', days: ['Sun'], start: '19:00', validUntil: '2026-11-02' },
    { id: 'tba', title: 'TBA', venue: 'V', days: ['Mon'] },
  ], { from: '2026-10-24', horizonDays: 14 });
  assert.deepEqual(rows.map((r) => r.id), ['w-2026-10-25', 'w-2026-11-01']);
});

test('all-day facility hours are not listed as sessions', () => {
  const rows = toVclubRows([
    { id: 'hours', title: 'Standard Open Play', venue: 'V', days: ['Mon'], start: '07:00', end: '18:00' },
  ], { from: '2026-10-24', horizonDays: 7 });
  assert.equal(rows.length, 0);
});
