// Regions, cadence and per-host politeness (#52): config/regions/<id>/ folders, sources scraped
// only when due, one output folder per region, requests queued per host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegions, regionIds } from '../lib/regions.js';
import { loadSources, cadenceMs } from '../lib/registry.js';
import { planSources, runScrape, scrapePaths } from '../lib/pipeline.js';
import { onHost } from '../lib/http.js';

const tmp = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'schelagg-regions-')); tmp.push(d); return d; };
after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });
const write = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v)); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Two regions with one source each, written to a temp config/regions folder. */
function twoRegions() {
  const dir = tempDir();
  write(join(dir, 'austin/region.json'), { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74] });
  write(join(dir, 'austin/sources.json'), { defaults: { sport: 'volleyball' }, sources: [{ id: 'a-gym', adapter: 'volleyworld', cadence: '30m' }] });
  write(join(dir, 'denver/region.json'), { id: 'denver', name: 'Denver, CO', timezone: 'America/Denver', center: [39.74, -104.99] });
  write(join(dir, 'denver/sources.json'), { defaults: { sport: 'ice_skating' }, sources: [{ id: 'd-rink', adapter: 'daysmart', cadence: '1d', options: { company: 'x' } }], manual: { file: 'manual.json' } });
  return dir;
}

test('the real config has the Austin region with every source tagged by it', () => {
  assert.deepEqual(regionIds(), ['austin']);
  const { sources, manuals, manual, regions } = loadSources();
  assert.ok(sources.length >= 7);
  for (const s of sources) assert.deepEqual([s.region, s.timezone], ['austin', 'America/Chicago'], s.id);
  assert.equal(manuals.length, 1);
  assert.equal(manual.file, 'config/regions/austin/manual.json');
  assert.deepEqual(regions.map((r) => r.id), ['austin']);
});

test('regions: sources take the region and time zone from region.json; ids must be unique across regions', () => {
  const dir = twoRegions();
  const { sources, manuals, manual } = loadSources({ dir });
  assert.deepEqual(sources.map((s) => [s.id, s.region, s.timezone, s.sport, s.cadence]), [
    ['a-gym', 'austin', 'America/Chicago', 'volleyball', '30m'],
    ['d-rink', 'denver', 'America/Denver', 'ice_skating', '1d'],
  ]);
  assert.deepEqual(manuals.map((m) => [m.region, m.cadence]), [['denver', '1d']]);
  assert.equal(manual, null); // more than one region: callers use `manuals`
  assert.deepEqual(loadSources({ dir, only: ['denver'] }).sources.map((s) => s.id), ['d-rink']);

  // A region can't override its own time zone from sources.json.
  write(join(dir, 'denver/sources.json'), { defaults: { sport: 'ice_skating', timezone: 'Asia/Tokyo', region: 'x' }, sources: [{ id: 'd-rink', adapter: 'daysmart', options: { company: 'x' } }] });
  assert.equal(loadSources({ dir }).sources[1].timezone, 'America/Denver');

  write(join(dir, 'denver/sources.json'), { sources: [{ id: 'a-gym', adapter: 'volleyworld', sport: 'volleyball' }] });
  assert.throws(() => loadSources({ dir }), /source id "a-gym" is in both austin and denver/);
  write(join(dir, 'denver/region.json'), { id: 'dallas', timezone: 'America/Chicago', center: [0, 0] });
  assert.throws(() => loadRegions({ dir }), /id is "dallas", expected "denver"/);
  assert.throws(() => loadRegions({ dir, only: ['nowhere'] }), /no region "nowhere"/);
});

test('cadence: parsed, validated, and only due sources are planned', () => {
  assert.deepEqual(['30m', '1h', '6h', '1d'].map(cadenceMs), [1800e3, 3600e3, 21600e3, 864e5]);
  assert.throws(() => cadenceMs('often'), /bad cadence/);
  const at = (iso) => new Date(iso);
  const src = (id, cadence) => ({ id, cadence });
  const sources = [src('fast', '30m'), src('hourly', '1h'), src('daily', '1d'), src('broken', '1d'), src('new', '1d')];
  const prev = { sources: [
    { id: 'fast', ok: true, checkedAt: '2026-11-02T15:13:40Z' },
    { id: 'hourly', ok: true, checkedAt: '2026-11-02T15:13:40Z' },
    { id: 'daily', ok: true, checkedAt: '2026-11-02T03:13:00Z' },
    { id: 'broken', ok: false, checkedAt: '2026-11-02T15:13:00Z' },
  ] };
  // The :43 tick, 29.5 minutes later: the 30m source is due (10 minutes of slack), the hourly isn't.
  const { due, skipped } = planSources(sources, prev, { now: at('2026-11-02T15:43:05Z') });
  assert.deepEqual(due.map((s) => s.id), ['fast', 'broken', 'new']);
  assert.deepEqual(skipped.map((s) => s.id), ['hourly', 'daily']);
  assert.deepEqual(planSources(sources, prev, { now: at('2026-11-02T16:13:05Z') }).due.map((s) => s.id), ['fast', 'hourly', 'broken', 'new']);
  assert.equal(planSources(sources, prev, { now: at('2026-11-02T15:43:05Z'), force: true }).due.length, 5);
});

test('runScrape: a source that isn\'t due keeps its sessions and status untouched; each region gets its own folder', async () => {
  const dir = tempDir();
  const paths = scrapePaths({
    out: join(dir, 'schedule.json'), feed: join(dir, 'occurrences.json'), watch: join(dir, 'watch.json'),
    failures: join(dir, 'scrape-failures.md'), health: join(dir, 'health.json'), changes: join(dir, 'c.md'), changesJson: join(dir, 'c.json'),
  });
  const session = (id, extra) => ({ id, title: 'Open play', venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville', date: '2026-11-03', start: '19:00', end: '21:00', surface: 'indoor', type: 'Open play', ...extra });
  let calls = 0;
  const fast = { id: 'fast', name: 'Fast', sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', cadence: '30m', options: {},
    adapter: { needsBrowser: false, scrape: async () => { calls++; return { sessions: [session(`fast-${calls}`)] }; } } };
  const slow = { id: 'slow', name: 'Slow', sport: 'ice_skating', region: 'denver', timezone: 'America/Denver', cadence: '1d', options: {},
    adapter: { needsBrowser: false, scrape: async () => { calls++; return { sessions: [session(`slow-${calls}`, { sport: 'ice_skating', venue: 'Rink', surface: 'indoor', type: 'Public skate' })] }; } } };
  const regions = [
    { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], publicCourts: { note: 'Free.', courts: [{ park: 'P', surface: 'sand', courts: 1 }] } },
    { id: 'denver', name: 'Denver, CO', timezone: 'America/Denver', center: [39.74, -104.99], publicCourts: null },
  ];
  const run = (iso) => runScrape({ sources: [fast, slow], regions, paths, now: () => new Date(iso), log: () => {}, fetch: async () => { throw new Error('no network'); } });

  const first = await run('2026-11-02T15:13:00Z');
  assert.deepEqual([first.ran, first.skipped], [['fast', 'slow'], []]);
  const second = await run('2026-11-02T15:43:00Z');
  assert.deepEqual([second.ran, second.skipped], [['fast'], ['slow']]);
  const sched = readJson(paths.out);
  // The slow source's session and status are the first run's, untouched (no "Couldn't recheck").
  const slowSessions = sched.sessions.filter((s) => s.sourceId === 'slow');
  assert.deepEqual(slowSessions.map((s) => [s.id, s.checkFailed]), [['slow-2', undefined]]);
  assert.deepEqual([sched.sources[1].checkedAt, sched.sources[1].ok], ['2026-11-02T15:13:00.000Z', true]);
  assert.equal(sched.sessions.find((s) => s.sourceId === 'fast').id, 'fast-3');
  // Health keeps the skipped source's baseline.
  assert.ok(readJson(paths.health).sources.slow);

  // One folder per region, and an index of regions with their sports.
  const index = readJson(join(dir, 'index.json'));
  assert.deepEqual(index.regions.map((r) => [r.id, r.timezone, r.sports, r.sessions]), [
    ['austin', 'America/Chicago', ['volleyball'], 1], ['denver', 'America/Denver', ['ice_skating'], 1],
  ]);
  const austin = readJson(join(dir, 'regions/austin/schedule.json'));
  assert.deepEqual([austin.region.id, austin.sessions.map((s) => s.sourceId), austin.sources.map((s) => s.id)], ['austin', ['fast'], ['fast']]);
  assert.deepEqual(austin.publicCourts.courts.map((c) => c.region), ['austin']);
  assert.equal(readJson(join(dir, 'regions/denver/schedule.json')).publicCourts, null);
  assert.deepEqual(readJson(join(dir, 'regions/denver/occurrences.json')).occurrences.map((o) => o.region), ['denver']);
  const denverIcs = readFileSync(join(dir, 'regions/denver/ice_skating.ics'), 'utf8');
  assert.match(denverIcs, /X-WR-CALNAME:Schelagg · Denver public skating\r\nX-WR-TIMEZONE:America\/Denver/);
  // The combined files still hold every region, for existing consumers.
  assert.deepEqual([...new Set(readJson(paths.feed).occurrences.map((o) => o.region))].sort(), ['austin', 'denver']);

  // Failures go to their own region's file.
  const failing = { ...fast, adapter: { needsBrowser: false, scrape: async () => { throw new Error('HTTP 503'); } } };
  await runScrape({ sources: [failing, slow], regions, paths, now: () => new Date('2026-11-02T16:13:00Z'), log: () => {} });
  assert.match(readFileSync(join(dir, 'scrape-failures/austin.md'), 'utf8'), /\*\*fast\*\* HTTP 503/);
  assert.equal(readFileSync(join(dir, 'scrape-failures/denver.md'), 'utf8'), '');
});

test('onHost: one request at a time per host, different hosts in parallel', async () => {
  const log = [];
  const slowTask = (name, ms) => async () => { log.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); log.push(`end ${name}`); return name; };
  const results = await Promise.all([
    onHost('https://a.test/1', slowTask('a1', 30)),
    onHost('https://a.test/2', slowTask('a2', 5)),
    onHost('https://b.test/1', slowTask('b1', 5)),
  ]);
  assert.deepEqual(results, ['a1', 'a2', 'b1']);
  // a2 waits for a1; b1 doesn't wait for anything.
  assert.ok(log.indexOf('start a2') > log.indexOf('end a1'), log.join(', '));
  assert.ok(log.indexOf('start b1') < log.indexOf('end a1'), log.join(', '));
  // A failed request doesn't block the host.
  await assert.rejects(onHost('https://c.test/', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await onHost('https://c.test/', async () => 'after'), 'after');
});

test('runScrape: when Chromium can\'t start, only the sources that need it fail', async () => {
  const dir = tempDir();
  const paths = scrapePaths({
    out: join(dir, 'schedule.json'), feed: join(dir, 'occurrences.json'), watch: join(dir, 'watch.json'),
    failures: join(dir, 'scrape-failures.md'), health: join(dir, 'health.json'), changes: join(dir, 'c.md'), changesJson: join(dir, 'c.json'),
  });
  const base = { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', cadence: '30m', options: {} };
  const api = { ...base, id: 'api', adapter: { needsBrowser: false, scrape: async () => ({ sessions: [] }) } };
  const page = { ...base, id: 'page', adapter: { needsBrowser: true, scrape: async () => ({ sessions: [] }) } };
  const regions = [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [0, 0] }];
  const r = await runScrape({ sources: [api, page], regions, paths, log: () => {}, launchBrowser: async () => { throw new Error('Executable doesn\'t exist'); } });
  assert.deepEqual(r.out.sources.map((s) => [s.id, s.ok, s.error]), [['api', true, undefined], ['page', false, "no browser: Executable doesn't exist"]]);
});
