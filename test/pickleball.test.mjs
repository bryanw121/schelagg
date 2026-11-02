import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSources } from '../lib/registry.js';
import { runScrape, scrapePaths } from '../lib/pipeline.js';
import { sessionProblems } from '../lib/session.js';
import { toOccurrences } from '../lib/occurrences.js';

test('Austin pickleball source survives the pipeline, keeps addresses and emits only its dated window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'schelagg-pickleball-'));
  try {
    const { sources, regions } = loadSources();
    const fixture = await readFile(new URL('./fixtures/sources/austin-pickleball.html', import.meta.url), 'utf8');
    const result = await runScrape({ sources: sources.filter((s) => s.id === 'austin-city-pickleball'), regions,
      paths: scrapePaths({ out: join(dir, 'schedule.json'), feed: join(dir, 'occurrences.json'),
        watch: join(dir, 'watch.json'), health: join(dir, 'health.json'),
        failures: join(dir, 'failures.md'), changes: join(dir, 'changes.md'), changesJson: join(dir, 'changes.json') }),
      now: () => new Date('2026-11-02T18:00:00Z'),
      fetch: async () => new Response(fixture), log: () => {},
      launchBrowser: () => { throw new Error('manual pilot needs no browser'); },
    });
    const sessions = result.out.sessions.filter((s) => s.sport === 'pickleball');
    assert.equal(sessions.length, 6);
    assert.equal(new Set(sessions.map((s) => s.venueId)).size, 4);
    for (const s of sessions) {
      assert.deepEqual(sessionProblems(s), { errors: [], notes: [] });
      assert.equal(s.region, 'austin');
      assert.equal(s.type, 'Open play');
      assert.equal(s.sourceId, 'austin-city-pickleball');
      assert.equal(s.reviewBy, '2026-11-30');
      const v = result.out.venues.find((v) => v.id === s.venueId);
      assert.match(v.address, /Austin, TX \d{5}$/);
    }
    const occurrences = result.feed.occurrences.filter((o) => o.sport === 'pickleball');
    assert.equal(occurrences.length, 6);
    assert.ok(occurrences.every((o) => o.attributes.type === 'Open play'));
    assert.equal(occurrences.find((o) => o.session_id === 'pickleball-austin-montopolis-rec-0-2026-11-02').starts_at, '2026-11-03T00:00:00.000Z');
    assert.deepEqual(toOccurrences(sessions, { now: new Date('2026-11-09T18:00:00Z') }), []);
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    assert.ok(index.regions.find((r) => r.id === 'austin').sports.includes('pickleball'));
    const regional = JSON.parse(await readFile(join(dir, 'regions/austin/schedule.json'), 'utf8'));
    assert.ok(regional.venues.find((v) => v.id === 'austin-northwest-rec').address);
    const ics = await readFile(join(dir, 'regions/austin/pickleball.ics'), 'utf8');
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 6);
    assert.match(ics, /X-WR-CALNAME:Schelagg · Austin pickleball/);
    assert.doesNotMatch(ics, /Ice Rodeo|Volleyball|ATX Sand Social/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
