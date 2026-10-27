// Schelagg's database layer (lib/db.js) against a real Postgres: PGlite, Postgres compiled to
// WASM and run in-process, so this is offline and the same on Linux, macOS and Windows. Each
// test gets a fresh database with the migrations applied. The pure helpers (diffing, row
// mapping, the run plan) are tested without one. Nothing here touches the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadSources } from '../lib/registry.js';
import { runScrape, scrapePaths, FEED_HORIZON_DAYS } from '../lib/pipeline.js';
import { toOccurrences } from '../lib/occurrences.js';
import {
  wrapPglite, migrate, writeRun, persistRun, planRun, diffFields, sessionRow, occurrenceRow, sourceRows,
  canonical, feedOrder, isPast, redact, queryOccurrences, loadPublishedFromDb, UNTRACKED_FIELDS,
} from '../lib/db.js';

const NOW = new Date('2026-10-25T20:00:00Z'); // Sunday 3pm in Austin
const HOUR = 3600e3;
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = () => { throw new Error('no network in tests: inject a fetch'); }; });
after(() => { globalThis.fetch = realFetch; });

const tmp = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'schelagg-db-')); tmp.push(d); return d; };
after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

/** A fresh migrated database for one test; closed afterwards. */
async function withDb(fn) {
  const db = wrapPglite(new PGlite());
  try {
    await migrate(db, { log: () => {} });
    return await fn(db);
  } finally {
    await db.end();
  }
}

// --- synthetic runs (the shapes runScrape writes) --------------------------------------------

const base = { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', verifiedAt: '2026-10-25' };
const SESSIONS = [
  { ...base, id: 'reclub-AAA111', sourceId: 'reclub', date: '2026-10-26', start: '19:00', end: '22:00', title: 'Monday Coed', venue: 'Roots · Treehouse Gym', city: 'N. Austin', surface: 'indoor', type: 'Open play', facility: 'treehouse', signup: { url: 'https://example.test/m/AAA111', label: 'Sign up on Reclub' }, source: 'https://example.test/m/AAA111' },
  { ...base, id: 'reclub-BBB222', sourceId: 'reclub', date: '2026-10-28', start: '19:00', end: '21:00', title: 'Wednesday Coed', venue: 'Roots · Treehouse Gym', city: 'N. Austin', surface: 'indoor', type: 'Open play', signup: { url: 'https://example.test/m/BBB222', label: 'Sign up on Reclub' } },
  { ...base, id: 'volleyworld-2026-10-27-20:30-georgetown', sourceId: 'volleyworld', date: '2026-10-27', start: '20:30', end: '22:00', title: 'Adult Training', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', price: null, surface: 'indoor', type: 'Training', capacity: 12, spotsLeft: 5, classId: 'c1', signup: { url: 'https://example.test/vw', label: 'Book on Volleyworld' } },
  { ...base, id: 'manual-sand-sun', sourceId: 'manual', days: ['Sun'], start: '19:00', end: '22:00', title: 'Sunday Sand Social', venue: 'ATX Beach', city: 'North Austin', surface: 'sand', type: 'Open play', verifiedAt: '2026-10-20', validUntil: '2026-12-31', price: '$10' },
];
const byId = (id) => SESSIONS.find((s) => s.id === id);

/** A run as runScrape returns it: schedule.json body, the feed, findings. */
function run({ sessions = SESSIONS, at = NOW, failed = [] } = {}) {
  const generatedAt = at.toISOString();
  const sources = ['volleyworld', 'reclub'].map((id) => (failed.includes(id)
    ? { id, sport: 'volleyball', region: 'austin', ok: false, checkedAt: generatedAt, error: 'HTTP 503', kept: 0 }
    : { id, sport: 'volleyball', region: 'austin', ok: true, checkedAt: generatedAt, count: sessions.filter((s) => s.sourceId === id).length }));
  const schedule = { schemaVersion: 2, generatedAt, sources, sessions };
  const feed = { feedVersion: 1, generatedAt, horizonDays: FEED_HORIZON_DAYS, occurrences: toOccurrences(sessions, { now: at, horizonDays: FEED_HORIZON_DAYS }) };
  return { out: schedule, feed, findings: [] };
}
const write = (db, r, extra = {}) => writeRun(db, { schedule: r.out, occurrences: r.feed, health: { findings: r.findings }, startedAt: new Date(new Date(r.out.generatedAt).getTime() - 60e3), finishedAt: r.out.generatedAt, ...extra });
const edit = (id, patch) => SESSIONS.map((s) => (s.id === id ? { ...s, ...patch } : s));
const changesFor = (db, id) => db.query('select kind, fields, before, after, changed_at from session_changes where session_id = $1 order by id', [id]);
const session = async (db, id) => (await db.query('select * from sessions where id = $1', [id]))[0];
const occIds = async (db, sessionId) => (await db.query('select id from occurrences where session_id = $1 order by starts_at', [sessionId])).map((r) => r.id);

// --- migrations ----------------------------------------------------------------------------

test('migrations: apply cleanly, and a second run applies nothing', async () => {
  const db = wrapPglite(new PGlite());
  try {
    const logs = [];
    assert.deepEqual(await migrate(db, { log: (l) => logs.push(l) }), { applied: ['0001_init'] });
    assert.deepEqual(logs, ['applied 0001_init.sql']);
    assert.deepEqual(await migrate(db, { log: (l) => logs.push(l) }), { applied: [] });
    assert.equal(logs.length, 1);
    const versions = await db.query('select version, checksum from schema_migrations');
    assert.deepEqual(versions.map((r) => r.version), ['0001_init']);
    assert.match(versions[0].checksum, /^[0-9a-f]{64}$/);
    const tables = (await db.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).map((r) => r.table_name);
    assert.deepEqual(tables, ['occurrences', 'schema_migrations', 'scrape_runs', 'session_changes', 'sessions', 'sources']);
    const idx = (await db.query(`select indexdef from pg_indexes where tablename = 'occurrences'`)).map((r) => r.indexdef);
    assert.ok(idx.some((d) => /\(sport, region, starts_at\)/.test(d)), 'occurrences indexed on (sport, region, starts_at)');

    // A migration edited after it was applied is reported, not re-run.
    const dir = tempDir();
    writeFileSync(join(dir, '0001_init.sql'), '-- edited\n');
    writeFileSync(join(dir, 'README.md'), 'not a migration');
    const warned = [];
    assert.deepEqual(await migrate(db, { dir, log: (l) => warned.push(l) }), { applied: [] });
    assert.match(warned[0], /0001_init\.sql changed after it was applied/);
    // A new one is applied once.
    writeFileSync(join(dir, '0002_extra.sql'), 'create table extra (id int); create index extra_idx on extra (id);');
    assert.deepEqual(await migrate(db, { dir, log: () => {} }), { applied: ['0002_extra'] });
    assert.deepEqual(await migrate(db, { dir, log: () => {} }), { applied: [] });
  } finally {
    await db.end();
  }
});

test('grants: nothing without the schelagg_reader role; read-only once it exists', async () => {
  await withDb(async (db) => {
    // Without the role the DO block is a no-op (migrate already ran it).
    assert.equal((await db.query(`select 1 from pg_roles where rolname = 'schelagg_reader'`)).length, 0);
    await write(db, run());
    await db.exec('create role schelagg_reader');
    await migrate(db, { log: () => {} }); // re-runs db/grants.sql
    await db.exec('set role schelagg_reader');
    try {
      for (const t of ['sources', 'sessions', 'occurrences', 'session_changes', 'scrape_runs']) {
        assert.ok((await db.query(`select count(*)::int as n from ${t}`))[0].n > 0, t);
      }
      await assert.rejects(db.query(`delete from occurrences`), /permission denied/);
      await assert.rejects(db.query(`insert into sources (id, sport, region) values ('x', 'y', 'z')`), /permission denied/);
      await assert.rejects(db.query(`create table nope (id int)`), /permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });
});

// --- writeRun ------------------------------------------------------------------------------

test('writeRun: the first run inserts sources, sessions, occurrences, changes and the run', async () => {
  await withDb(async (db) => {
    const r = run();
    const stats = await write(db, r, { adapters: { reclub: 'reclub', volleyworld: 'volleyworld' } });
    assert.deepEqual({ ...stats, runId: undefined }, {
      runId: undefined, generatedAt: NOW.toISOString(), sessions: 4, occurrences: r.feed.occurrences.length, occurrencesDeleted: 0,
      added: 4, changed: 0, canceled: 0, uncanceled: 0, removed: 0, expired: 0, failedSources: [],
    });

    const sources = await db.query('select id, sport, region, adapter, last_ok_at, last_error, count from sources order by id');
    assert.deepEqual(sources.map((s) => [s.id, s.adapter, s.count, s.last_error]), [
      ['manual', 'manual', 1, null], ['reclub', 'reclub', 2, null], ['volleyworld', 'volleyworld', 1, null],
    ]);
    assert.ok(sources.every((s) => s.last_ok_at.toISOString() === NOW.toISOString()));

    // Stable fields are columns, sport-specific ones in attributes, the whole session in data.
    const vw = await session(db, 'volleyworld-2026-10-27-20:30-georgetown');
    assert.deepEqual([vw.source_id, vw.sport, vw.region, vw.timezone, vw.start_time, vw.end_time, vw.signup_url, vw.canceled],
      ['volleyworld', 'volleyball', 'austin', 'America/Chicago', '20:30', '22:00', 'https://example.test/vw', false]);
    assert.deepEqual(vw.attributes, { surface: 'indoor', type: 'Training', capacity: 12, spotsLeft: 5, classId: 'c1' });
    assert.deepEqual(vw.data, byId(vw.id));
    assert.equal(vw.removed_at, null);
    assert.deepEqual([vw.first_seen_at, vw.last_seen_at, vw.updated_at].map((d) => d.toISOString()), Array(3).fill(NOW.toISOString()));
    const sand = await session(db, 'manual-sand-sun');
    assert.deepEqual([sand.days, sand.date, sand.price, sand.source_id], [['Sun'], null, '$10', 'manual']);
    assert.equal((await session(db, 'reclub-AAA111')).facility, 'treehouse');

    // Occurrences hold the feed rows exactly; queryOccurrences gives them back in feed order.
    const stored = await db.query('select id, sport, region, local_date, starts_at, canceled, data from occurrences');
    assert.equal(stored.length, r.feed.occurrences.length);
    const feedById = new Map(r.feed.occurrences.map((o) => [o.id, o]));
    for (const row of stored) {
      assert.deepEqual(row.data, feedById.get(row.id), row.id);
      assert.equal(row.starts_at.toISOString(), feedById.get(row.id).starts_at, row.id);
    }
    const q = await queryOccurrences(db, { sport: 'volleyball', region: 'austin', from: '2026-10-25', to: '2026-11-30' });
    assert.equal(q.generatedAt, NOW.toISOString());
    assert.deepEqual(q.occurrences, r.feed.occurrences);
    assert.deepEqual(Object.keys(q.occurrences[0]), Object.keys(r.feed.occurrences[0]), 'top-level keys in feed order');

    const changes = await db.query('select session_id, kind, before, after, fields from session_changes order by session_id');
    assert.deepEqual(changes.map((c) => [c.session_id, c.kind, c.before, c.fields]), SESSIONS.map((s) => [s.id, 'added', null, []]).sort());
    const [runRow] = await db.query('select * from scrape_runs');
    assert.deepEqual([runRow.ok, runRow.generated_at.toISOString(), runRow.summary, runRow.stats.added], [true, NOW.toISOString(), r.out.sources, 4]);
    assert.equal(runRow.started_at.toISOString(), new Date(NOW.getTime() - 60e3).toISOString());

    // The published sessions, as /api/check wants them.
    const published = await loadPublishedFromDb(db);
    assert.deepEqual([...published.keys()].sort(), SESSIONS.map((s) => s.id).sort());

    // Writing the same run again (a retry) is a no-op.
    assert.deepEqual(await write(db, r), { skipped: true, generatedAt: NOW.toISOString() });
    assert.equal((await db.query('select count(*)::int as n from scrape_runs'))[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from session_changes'))[0].n, 4);
  });
});

test('writeRun: a changed time is a "changed" entry with the fields; bookkeeping-only changes are not', async () => {
  await withDb(async (db) => {
    await write(db, run());
    const later = new Date(NOW.getTime() + HOUR);
    // Reclub moves Monday Coed 30 minutes later; Volleyworld's spots left and everyone's verifiedAt move.
    const sessions = edit('reclub-AAA111', { start: '19:30', end: '22:30' })
      .map((s) => (s.id.startsWith('volleyworld') ? { ...s, spotsLeft: 2, verifiedAt: '2026-10-26' } : s));
    const stats = await write(db, run({ sessions, at: later }));
    assert.deepEqual([stats.added, stats.changed, stats.removed], [0, 1, 0]);

    const [c] = await changesFor(db, 'reclub-AAA111').then((rows) => rows.filter((x) => x.kind !== 'added'));
    assert.equal(c.kind, 'changed');
    assert.deepEqual(c.fields, ['end', 'start']);
    assert.deepEqual([c.before.start, c.after.start, c.before.end, c.after.end], ['19:00', '19:30', '22:00', '22:30']);
    assert.equal(c.changed_at.toISOString(), later.toISOString());
    const moved = await session(db, 'reclub-AAA111');
    assert.deepEqual([moved.start_time, moved.updated_at.toISOString(), moved.first_seen_at.toISOString(), moved.last_seen_at.toISOString()],
      ['19:30', later.toISOString(), NOW.toISOString(), later.toISOString()]);
    // The occurrence moved with it.
    assert.equal((await db.query(`select starts_at from occurrences where id = 'reclub-AAA111'`))[0].starts_at.toISOString(), '2026-10-27T00:30:00.000Z');

    // Spots left / verifiedAt: the row is current, but no history entry and updated_at stays.
    const vw = await session(db, 'volleyworld-2026-10-27-20:30-georgetown');
    assert.deepEqual([vw.data.spotsLeft, vw.attributes.spotsLeft, vw.updated_at.toISOString()], [2, 2, NOW.toISOString()]);
    assert.deepEqual((await changesFor(db, vw.id)).map((x) => x.kind), ['added']);
  });
});

test('writeRun: canceling and un-canceling a session are their own kinds', async () => {
  await withDb(async (db) => {
    const id = 'volleyworld-2026-10-27-20:30-georgetown';
    await write(db, run());
    await write(db, run({ sessions: edit(id, { canceled: true }), at: new Date(NOW.getTime() + HOUR) }));
    await write(db, run({ sessions: edit(id, { canceled: false }), at: new Date(NOW.getTime() + 2 * HOUR) }));
    const changes = await changesFor(db, id);
    assert.deepEqual(changes.map((c) => [c.kind, c.fields]), [['added', []], ['canceled', ['canceled']], ['uncanceled', ['canceled']]]);
    assert.equal((await session(db, id)).canceled, false);
  });
});

test('writeRun: a failed source keeps its sessions and upcoming occurrences, and records the error', async () => {
  await withDb(async (db) => {
    await write(db, run());
    const reclubOcc = await occIds(db, 'reclub-AAA111');
    assert.equal(reclubOcc.length, 1);
    // Next hour Reclub fails and (worst case) the run carries none of its sessions.
    const later = new Date(NOW.getTime() + HOUR);
    const stats = await write(db, run({ sessions: SESSIONS.filter((s) => s.sourceId !== 'reclub'), at: later, failed: ['reclub'] }));
    assert.deepEqual([stats.removed, stats.failedSources], [0, ['reclub']]);
    for (const id of ['reclub-AAA111', 'reclub-BBB222']) {
      const s = await session(db, id);
      assert.equal(s.removed_at, null, `${id} kept`);
      assert.equal(s.last_seen_at.toISOString(), NOW.toISOString(), `${id} last seen on the good run`);
      assert.deepEqual((await changesFor(db, id)).map((c) => c.kind), ['added']);
    }
    assert.deepEqual(await occIds(db, 'reclub-AAA111'), reclubOcc);
    const [src] = await db.query(`select * from sources where id = 'reclub'`);
    assert.deepEqual([src.last_error, src.count, src.last_ok_at.toISOString(), src.last_checked_at.toISOString()], ['HTTP 503', 2, NOW.toISOString(), later.toISOString()]);
    const [runRow] = await db.query('select ok from scrape_runs order by id desc limit 1');
    assert.equal(runRow.ok, false);

    // Kept sessions flagged checkFailed (what the file pipeline actually does) aren't a change either.
    const kept = SESSIONS.map((s) => (s.sourceId === 'reclub' ? { ...s, checkFailed: '2026-10-25' } : s));
    await write(db, run({ sessions: kept, at: new Date(NOW.getTime() + 2 * HOUR), failed: ['reclub'] }));
    assert.deepEqual((await changesFor(db, 'reclub-AAA111')).map((c) => c.kind), ['added']);
    assert.equal((await session(db, 'reclub-AAA111')).check_failed.toISOString().slice(0, 10), '2026-10-25');

    // Reclub recovers: the error clears and a session it no longer lists is removed.
    await write(db, run({ sessions: SESSIONS.filter((s) => s.id !== 'reclub-BBB222'), at: new Date(NOW.getTime() + 3 * HOUR) }));
    assert.equal((await db.query(`select last_error from sources where id = 'reclub'`))[0].last_error, null);
    assert.notEqual((await session(db, 'reclub-BBB222')).removed_at, null);
  });
});

test('writeRun: a session gone at the source gets removed_at, a "removed" change and loses its upcoming occurrences', async () => {
  await withDb(async (db) => {
    await write(db, run());
    assert.deepEqual(await occIds(db, 'reclub-BBB222'), ['reclub-BBB222']);
    const later = new Date(NOW.getTime() + HOUR);
    const stats = await write(db, run({ sessions: SESSIONS.filter((s) => s.id !== 'reclub-BBB222'), at: later }));
    assert.deepEqual([stats.removed, stats.expired, stats.occurrencesDeleted], [1, 0, 1]);
    const gone = await session(db, 'reclub-BBB222');
    assert.equal(gone.removed_at.toISOString(), later.toISOString());
    const changes = await changesFor(db, 'reclub-BBB222');
    assert.deepEqual(changes.map((c) => [c.kind, c.before === null, c.after === null]), [['added', true, false], ['removed', false, true]]);
    assert.deepEqual(changes[1].before, byId('reclub-BBB222'));
    assert.deepEqual(await occIds(db, 'reclub-BBB222'), []);
    assert.ok(!(await loadPublishedFromDb(db)).has('reclub-BBB222'));

    // It comes back: added again, removed_at cleared, first_seen_at kept.
    const back = new Date(NOW.getTime() + 2 * HOUR);
    await write(db, run({ at: back }));
    const again = await session(db, 'reclub-BBB222');
    assert.deepEqual([again.removed_at, again.first_seen_at.toISOString()], [null, NOW.toISOString()]);
    assert.deepEqual((await changesFor(db, 'reclub-BBB222')).map((c) => c.kind), ['added', 'removed', 'added']);
    assert.deepEqual(await occIds(db, 'reclub-BBB222'), ['reclub-BBB222']);
  });
});

test('writeRun: upcoming occurrences are replaced, past ones stay as history, ended sessions expire quietly', async () => {
  await withDb(async (db) => {
    await write(db, run());
    const sundays = ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22'].map((d) => `manual-sand-sun-${d}`);
    assert.deepEqual(await occIds(db, 'manual-sand-sun'), sundays);

    // Two days later (Tue Oct 27, 10am): Monday Coed is over and out of the schedule, and the
    // Sunday social moved to Saturdays.
    const later = new Date('2026-10-27T15:00:00Z');
    const sessions = SESSIONS.filter((s) => s.id !== 'reclub-AAA111').map((s) => (s.id === 'manual-sand-sun' ? { ...s, days: ['Sat'] } : s));
    const stats = await write(db, run({ sessions, at: later }));
    assert.deepEqual([stats.removed, stats.expired, stats.changed], [0, 1, 1]);

    // Past Sunday (Oct 25) is history; the upcoming Sundays are gone; Saturdays are in.
    const now = await occIds(db, 'manual-sand-sun');
    assert.equal(now[0], 'manual-sand-sun-2026-10-25');
    assert.ok(!now.some((id) => /2026-11-(01|08|15|22)$/.test(id)), 'future Sundays replaced');
    assert.deepEqual(now.slice(1), ['2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21'].map((d) => `manual-sand-sun-${d}`));
    const [c] = (await changesFor(db, 'manual-sand-sun')).filter((x) => x.kind === 'changed');
    assert.deepEqual(c.fields, ['days']);

    // The session that ended keeps its row and past occurrence, with no "removed" entry.
    const ended = await session(db, 'reclub-AAA111');
    assert.equal(ended.removed_at.toISOString(), later.toISOString());
    assert.deepEqual((await changesFor(db, 'reclub-AAA111')).map((x) => x.kind), ['added']);
    assert.deepEqual(await occIds(db, 'reclub-AAA111'), ['reclub-AAA111']);
    // ...and a past window still reads it back.
    const past = await queryOccurrences(db, { from: '2026-10-26', to: '2026-10-26' });
    assert.deepEqual(past.occurrences.map((o) => o.id), ['reclub-AAA111']);
  });
});

test('writeRun: one transaction, so a failure part-way leaves nothing behind', async () => {
  await withDb(async (db) => {
    const bad = run();
    bad.out.sessions = [...bad.out.sessions, { ...SESSIONS[0], id: 'reclub-NOTITLE', title: null }]; // violates NOT NULL
    await assert.rejects(write(db, bad), /null value/);
    for (const t of ['scrape_runs', 'sources', 'sessions', 'occurrences', 'session_changes']) {
      assert.equal((await db.query(`select count(*)::int as n from ${t}`))[0].n, 0, t);
    }
  });
});

// --- persistRun (the scrape hook) ----------------------------------------------------------

test('persistRun: inert without a URL; a failed write is reported, never thrown', async () => {
  let opened = 0;
  assert.deepEqual(await persistRun({ url: undefined, result: run(), open: async () => { opened++; } }), { skipped: true });
  assert.deepEqual(await persistRun({ url: '', result: run(), open: async () => { opened++; } }), { skipped: true });
  assert.equal(opened, 0);

  const dir = tempDir();
  const failuresFile = join(dir, 'scrape-failures.md');
  const summaryFile = join(dir, 'summary.md');
  const secret = 'postgresql://owner:hunter2@ep-example.neon.test/schelagg?sslmode=require';
  const logs = [];
  // No failed sources: the file starts empty, and the write fails with the URL in the message.
  writeFileSync(failuresFile, '');
  const r = await persistRun({ url: secret, result: run(), failuresFile, summaryFile, log: (l) => logs.push(l), open: async (u) => { throw new Error(`could not connect to ${u}`); } });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /hunter2/);
  const failures = readFileSync(failuresFile, 'utf8');
  assert.match(failures, /^Schelagg database write failed on 2026-10-25\./);
  assert.match(failures, /The database write failed: could not connect to postgres:\/\/…/);
  assert.match(failures, /JSON feed was still published/);
  assert.doesNotMatch(failures + readFileSync(summaryFile, 'utf8') + logs.join('\n'), /hunter2/);
  assert.match(readFileSync(summaryFile, 'utf8'), /\*\*database\*\* write failed/);
  assert.match(logs[0], /^WARN  database write failed/);

  // With source failures already in the file, the database note is appended to them.
  writeFileSync(failuresFile, 'Sources that failed on 2026-10-25:\n\n- ❌ **reclub** HTTP 503');
  const db = { begin: async () => { throw new Error('connection terminated'); }, end: async () => {} };
  const r2 = await persistRun({ url: 'postgres://x', result: run(), failuresFile, log: () => {}, open: async () => db });
  assert.deepEqual(r2, { ok: false, error: 'connection terminated' });
  assert.match(readFileSync(failuresFile, 'utf8'), /^Sources that failed on 2026-10-25:[\s\S]*❌ \*\*reclub\*\*[\s\S]*The database write failed: connection terminated/);

  // A write that hangs times out instead of holding the scrape.
  const hang = { begin: () => new Promise(() => {}), end: async () => {} };
  const r3 = await persistRun({ url: 'postgres://x', result: run(), log: () => {}, open: async () => hang, timeoutMs: 50 });
  assert.deepEqual(r3, { ok: false, error: 'timed out after 0.05s' });
});

test('persistRun: the real scrape pipeline on fixtures lands in the database and matches its files', async () => {
  const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
  const MEETS = { UEY4HO: 'reclub-meet-UEY4HO.html', '1QX0YR': 'reclub-meet-1QX0YR.html', VONMM8: 'reclub-meet-VONMM8.html', '5X380N': 'reclub-meet-5X380N.html' };
  const CLUBS = { '/clubs/@vex_volleyball': 'reclub-club-vex_volleyball.html', '/clubs/@austin-lawn-club': 'reclub-club-austin-lawn-club.html' };
  const network = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'widget-api-tkaeguucxq-uc.a.run.app') return new Response(fixture('arketa-volleyworld-schedule.json'));
    if (u.hostname === 'apps.daysmartrecreation.com') {
      // One page per company here; paging is covered in daysmart.test.mjs.
      if (u.searchParams.get('company') === 'iceandfield') return new Response(fixture('daysmart-iceandfield-events.json'));
      const data = [1, 2].flatMap((n) => JSON.parse(fixture(`daysmart-chaparralice-events-p${n}.json`)).data);
      return new Response(JSON.stringify({ data, meta: { page: { 'last-page': 1 } } }));
    }
    if (u.hostname === 'reclub.co') {
      if (CLUBS[u.pathname]) return new Response(fixture(CLUBS[u.pathname]));
      const code = u.pathname.match(/^\/m\/(\w+)$/)?.[1];
      return MEETS[code] ? new Response(fixture(MEETS[code])) : new Response('Not found', { status: 404 });
    }
    throw new Error(`unexpected host in test: ${u.hostname}`);
  };
  const dir = tempDir();
  const paths = scrapePaths({
    out: join(dir, 'schedule.json'), feed: join(dir, 'occurrences.json'), watch: join(dir, 'watch.json'),
    failures: join(dir, 'scrape-failures.md'), health: join(dir, 'health.json'), changes: join(dir, 'c.md'), changesJson: join(dir, 'c.json'),
  });
  const apiOnly = loadSources().sources.filter((s) => s.adapter.needsBrowser === false); // volleyworld, reclub and the two rinks
  const result = await runScrape({ sources: apiOnly, paths, fetch: network, now: () => NOW, log: () => {}, launchBrowser: async () => { throw new Error('no browser'); } });

  await withDb(async (db) => {
    const logs = [];
    const r = await persistRun({ url: 'pglite://test', result, startedAt: NOW, failuresFile: paths.failures, adapters: { volleyworld: 'volleyworld', reclub: 'reclub', 'chaparral-ice': 'daysmart', 'ice-and-field': 'daysmart' }, open: async () => ({ ...db, end: async () => {} }), log: (l) => logs.push(l) });
    assert.equal(r.ok, true, r.error);
    assert.match(logs[0], /^db    run 1: \d+ sessions/);
    assert.equal(readFileSync(paths.failures, 'utf8'), '', 'nothing to report');

    const schedule = JSON.parse(readFileSync(paths.out, 'utf8'));
    const feed = JSON.parse(readFileSync(paths.feed, 'utf8'));
    const published = await loadPublishedFromDb(db);
    assert.deepEqual(new Map(schedule.sessions.map((s) => [s.id, s])), published);
    // Each sport's query returns exactly that sport's part of the feed.
    for (const sport of ['volleyball', 'ice_skating']) {
      const q = await queryOccurrences(db, { sport, region: 'austin', from: '2026-10-25', to: '2026-11-30' });
      assert.ok(q.occurrences.length > 0, sport);
      assert.deepEqual(q.occurrences, feed.occurrences.filter((o) => o.sport === sport), sport);
    }
    const q = await queryOccurrences(db, { region: 'austin', from: '2026-10-25', to: '2026-11-30' });
    assert.deepEqual(q.occurrences, feed.occurrences);
    assert.equal(q.generatedAt, feed.generatedAt);
    const canceled = await session(db, 'volleyworld-2026-10-25-17:30-georgetown');
    assert.equal(canceled.canceled, true);
  });
});

// --- pure helpers --------------------------------------------------------------------------

test('diffFields: top-level differences, sorted, ignoring key order, null vs missing and untracked fields', () => {
  const a = { id: 'x', start: '19:00', signup: { url: 'u', label: 'l' }, days: ['Mon'], price: null, verifiedAt: '2026-10-24', spotsLeft: 3 };
  assert.deepEqual(diffFields(a, { ...a }), []);
  assert.deepEqual(diffFields(a, { ...a, signup: { label: 'l', url: 'u' } }), [], 'key order');
  assert.deepEqual(diffFields(a, { ...a, price: undefined }), [], 'null and missing');
  assert.deepEqual(diffFields(a, { ...a, verifiedAt: '2026-10-25', spotsLeft: 0, checkFailed: '2026-10-25' }), []);
  assert.deepEqual(diffFields(a, { ...a, start: '19:30', days: ['Mon', 'Wed'], venue: 'New' }), ['days', 'start', 'venue']);
  assert.deepEqual(diffFields(a, { ...a, signup: { url: 'v', label: 'l' } }), ['signup']);
  for (const f of ['verifiedAt', 'checkFailed', 'spotsLeft']) assert.ok(UNTRACKED_FIELDS.has(f));
  assert.equal(canonical({ b: 1, a: [1, { d: 2, c: null }] }), canonical({ a: [1, { c: null, d: 2 }], b: 1 }));
});

test('planRun: added, changed, canceled, removed, expired, and a failed source is never removed', () => {
  const at = '2026-10-27T15:00:00.000Z';
  const prev = [
    { id: 'same', source_id: 'a', data: { id: 'same', date: '2026-10-30', timezone: 'America/Chicago', start: '19:00' }, removed_at: null, updated_at: '2026-10-01T00:00:00Z' },
    { id: 'moved', source_id: 'a', data: { id: 'moved', date: '2026-10-30', timezone: 'America/Chicago', start: '19:00' }, removed_at: null, updated_at: '2026-10-01T00:00:00Z' },
    { id: 'off', source_id: 'a', data: { id: 'off', date: '2026-10-30', timezone: 'America/Chicago' }, removed_at: null, updated_at: '2026-10-01T00:00:00Z' },
    { id: 'gone', source_id: 'a', data: { id: 'gone', date: '2026-10-30', timezone: 'America/Chicago' }, removed_at: null },
    { id: 'over', source_id: 'a', data: { id: 'over', date: '2026-10-26', timezone: 'America/Chicago' }, removed_at: null },
    { id: 'season-over', source_id: 'a', data: { id: 'season-over', days: ['Mon'], validUntil: '2026-10-26', timezone: 'America/Chicago' }, removed_at: null },
    { id: 'kept', source_id: 'down', data: { id: 'kept', date: '2026-10-30', timezone: 'America/Chicago' }, removed_at: null },
    { id: 'back', source_id: 'a', data: { id: 'back', date: '2026-10-30', timezone: 'America/Chicago' }, removed_at: '2026-10-20T00:00:00Z' },
  ];
  const sessions = [
    { ...prev[0].data, verifiedAt: '2026-10-27' },
    { ...prev[1].data, start: '20:00' },
    { ...prev[2].data, canceled: true },
    prev[7].data,
    { id: 'new', date: '2026-10-31', timezone: 'America/Chicago' },
  ];
  const plan = planRun({ prev, sessions, failedSources: ['down'], at });
  assert.deepEqual(plan.changes.map((c) => [c.session_id, c.kind, c.fields]), [
    ['moved', 'changed', ['start']], ['off', 'canceled', ['canceled']], ['back', 'added', []], ['new', 'added', []], ['gone', 'removed', []],
  ]);
  assert.deepEqual(plan.removed, ['gone', 'over', 'season-over']);
  assert.deepEqual(plan.expired, ['over', 'season-over']);
  assert.deepEqual(Object.fromEntries(plan.upserts.map((u) => [u.session.id, u.updated_at])), {
    same: '2026-10-01T00:00:00.000Z', moved: at, off: at, back: at, new: at,
  });
  assert.equal(isPast({ date: '2026-10-27', timezone: 'America/Chicago' }, at), false, 'today is not past');
});

test('row mapping: sessions, occurrences, sources and feed key order', () => {
  const s = { ...SESSIONS[0], startsOn: 'soon', price: 6 };
  const row = sessionRow(s);
  assert.deepEqual([row.date, row.starts_on, row.price, row.signup_label, row.source_url, row.verified_at], ['2026-10-26', null, '6', 'Sign up on Reclub', 'https://example.test/m/AAA111', '2026-10-25']);
  assert.deepEqual(row.attributes, { surface: 'indoor', type: 'Open play' });
  assert.equal(row.data, s);

  const o = toOccurrences([SESSIONS[3]], { now: NOW, horizonDays: 7 })[0];
  const orow = occurrenceRow(o);
  assert.deepEqual([orow.id, orow.local_date, orow.starts_at, orow.source_id], ['manual-sand-sun-2026-10-25', '2026-10-25', '2026-10-26T00:00:00.000Z', 'manual']);
  // 7pm Sunday in Austin is Monday in UTC: the local date is the session's.
  const shuffled = Object.fromEntries(Object.entries(o).reverse());
  assert.deepEqual(Object.keys(feedOrder(shuffled)), Object.keys(o));

  const rows = sourceRows(run({ failed: ['reclub'] }).out, { volleyworld: 'volleyworld' });
  assert.deepEqual(rows.map((r) => [r.id, r.adapter, r.ok, r.error, r.count]), [
    ['volleyworld', 'volleyworld', true, null, 1], ['reclub', null, false, 'HTTP 503', null], ['manual', 'manual', true, null, 1],
  ]);
  assert.equal(redact('connect to postgresql://u:p@h/db?sslmode=require failed, password=abc'), 'connect to postgres://… failed, password=…');
});

// PGlite passes string parameters through as given; the `postgres` driver used on Neon
// re-serializes them by the type the server infers (a jsonb string JSON-encoded twice, any
// boolean but `true` sent as false). Casting every parameter from text sidesteps both, and
// this keeps it that way, since the tests' PGlite can't catch it.
test('every SQL parameter in lib/db.js is cast from text (driver-neutral)', () => {
  const src = readFileSync(new URL('../lib/db.js', import.meta.url), 'utf8');
  const typed = [...src.matchAll(/\$\d+::(?!text\b)\w+/g)].map((m) => m[0]);
  assert.deepEqual(typed, [], 'write $n::text::<type>');
});
