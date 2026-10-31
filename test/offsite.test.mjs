import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsiteAdapter, withOffsite, maxAgeMs } from '../lib/offsite.js';
import { loadSources } from '../lib/registry.js';

const src = { id: 'aces', cadence: '1h', runsAt: 'home', adapter: { id: 'aces', needsBrowser: true, scrape: () => { throw new Error('should not fetch'); } } };
const now = () => new Date('2026-11-01T12:00:00Z');
const session = { id: 'aces-2026-11-02-19:30', date: '2026-11-02', start: '19:30', end: '22:00', title: 'ACES Indoor Open Play' };

test('withOffsite swaps only home sources for a reader that needs no browser', () => {
  const other = { id: 'x', adapter: { id: 'x' } };
  const [a, b] = withOffsite([src, other], { read: () => ({}), now });
  assert.equal(a.adapter.needsBrowser, false);
  assert.equal(a.adapter.id, 'offsite:aces');
  assert.equal(b, other);
});

test('a fresh home result is served as the source\'s sessions', async () => {
  const r = await offsiteAdapter(src, { now, read: () => ({ ok: true, checkedAt: '2026-11-01T11:23:00Z', sessions: [session] }) }).scrape();
  assert.deepEqual(r.sessions, [session]);
});

test('a stale, failed or missing home result fails the source (so it keeps its last sessions)', async () => {
  const stale = new Date(now() - maxAgeMs('1h') - 1).toISOString();
  await assert.rejects(offsiteAdapter(src, { now, read: () => ({ ok: true, checkedAt: stale, sessions: [] }) }).scrape(), /home computer off/);
  await assert.rejects(offsiteAdapter(src, { now, read: () => ({ ok: false, checkedAt: '2026-11-01T11:23:00Z', error: '403' }) }).scrape(), /home runner: 403/);
  await assert.rejects(offsiteAdapter(src, { now, read: () => { throw new Error('ENOENT'); } }).scrape(), /not reported yet/);
  assert.equal(maxAgeMs('1h'), 3 * 3600_000);
  assert.equal(maxAgeMs('6h'), 18 * 3600_000);
});

test('ACES is configured to run at home', () => {
  assert.equal(loadSources().sources.find((s) => s.id === 'aces').runsAt, 'home');
});
