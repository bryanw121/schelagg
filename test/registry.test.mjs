import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources, resolveSources } from '../lib/registry.js';
import { tagSession, validateSessions } from '../lib/session.js';

test('the real config loads: every source has an adapter, sport, region and time zone', () => {
  const { sources, manual } = loadSources();
  assert.ok(sources.length >= 5);
  for (const s of sources) {
    assert.equal(typeof s.adapter.scrape, 'function', s.id);
    assert.ok(s.sport && s.region && s.timezone, s.id);
  }
  assert.equal(manual.id, 'manual');
});

test('defaults apply and a source can override them (another sport or city)', () => {
  const { sources } = resolveSources({
    defaults: { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago' },
    sources: [
      { id: 'a', adapter: 'aces' },
      { id: 'b', adapter: 'reclub', sport: 'pickleball', region: 'seattle', timezone: 'America/Los_Angeles' },
      { id: 'off', adapter: 'aces', enabled: false },
    ],
  });
  assert.deepEqual(sources.map((s) => [s.id, s.sport, s.region]), [['a', 'volleyball', 'austin'], ['b', 'pickleball', 'seattle']]);
});

test('bad config fails loudly before any scraping', () => {
  const base = { defaults: { sport: 'v', region: 'r', timezone: 'America/Chicago' } };
  assert.throws(() => resolveSources({ ...base, sources: [{ id: 'x', adapter: 'nope' }] }), /unknown adapter/);
  assert.throws(() => resolveSources({ ...base, sources: [{ id: 'x', adapter: 'aces' }, { id: 'x', adapter: 'aces' }] }), /duplicate/);
  assert.throws(() => resolveSources({ ...base, sources: [{ id: 'x', adapter: 'aces', timezone: 'Mars/Base' }] }), /invalid timezone/);
  assert.throws(() => resolveSources({ sources: [{ id: 'x', adapter: 'aces' }] }), /has no sport/);
});

test('sessions are tagged from their source and malformed ones are dropped', () => {
  const src = { id: 'aces', sport: 'volleyball', region: 'austin', timezone: 'America/Chicago' };
  const good = tagSession({ id: 'g', title: 'Open play', venue: 'V', date: '2026-10-30', start: '19:00', end: '21:00', signup: { url: 'https://x' } }, src);
  const noVenue = tagSession({ id: 'n', title: 'Meet', venue: '', date: '2026-10-30', start: '19:00' }, src);
  const bad = tagSession({ id: 'b', title: 'Broken', venue: 'V', date: 'Oct 30', start: '7pm' }, src);
  const { ok, warnings } = validateSessions([good, noVenue, bad]);
  assert.deepEqual(ok.map((s) => s.id), ['g', 'n']);
  assert.equal(good.sport, 'volleyball');
  assert.equal(good.sourceId, 'aces');
  assert.ok(warnings.some((w) => w.startsWith('dropped b:')));
  assert.ok(warnings.some((w) => w.startsWith('n: no venue')));
});

test('volleyball sessions are checked against the known surface and type values', () => {
  const src = { id: 'x', sport: 'volleyball', region: 'austin', timezone: 'America/Chicago' };
  const s = (extra) => tagSession({ id: 'v', title: 'T', venue: 'V', date: '2026-10-30', start: '19:00', ...extra }, src);
  const { ok, warnings } = validateSessions([s({ surface: 'sand', type: 'Open play' }), s({ id: 'b', surface: 'beach', type: 'Open play' }), s({ id: 'n', type: 'League' })]);
  assert.equal(ok.length, 3); // flagged, not dropped
  assert.ok(warnings.some((w) => w.includes('unknown surface "beach"')));
  assert.ok(warnings.some((w) => w.startsWith('n:') && w.includes('no surface')));
  assert.ok(!warnings.some((w) => w.startsWith('v:')));
});
