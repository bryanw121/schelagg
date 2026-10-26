// Schelagg's Postgres storage (Neon in production): the source of truth for scraped sessions,
// with the JSON files (schedule.json, occurrences.json) still published from the same run as a
// compatibility feed. Inert until a connection string is configured:
//
//   DATABASE_URL           the owner role. The scrape writes each run (persistRun -> writeRun)
//                          and scripts/db-migrate.mjs applies db/migrations/*.sql.
//   DATABASE_URL_READONLY  the schelagg_reader role (db/grants.sql). api/sessions.js and
//                          api/check.js read from it, falling back to the published files.
//
// Everything here talks to a small driver-neutral handle, so the same SQL runs against Neon
// (the `postgres` package, see connect) and an in-process PGlite in the tests (wrapPglite):
//   { query(text, params) -> rows, exec(multiStatementText), begin(fn(tx)), end() }
// Parameters are always strings (or null), cast from text in the SQL ($1::text::jsonb): the
// server then types every parameter as text, so neither driver re-encodes it (`postgres`
// serializes by the inferred type: it would JSON-encode a jsonb string a second time and send
// any boolean but `true` as false). Bulk rows travel as one jsonb parameter expanded with
// jsonb_to_recordset, so each table is one round trip.
import { createHash } from 'node:crypto';
import { readFile, readdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoPath } from './paths.js';
import { today } from './time.js';
import { OCCURRENCE_KEYS, compareOccurrences, occurrenceDate, sessionAttributes } from './occurrences.js';

// --- connections ---------------------------------------------------------------------------

/** The handle over a `postgres` (porsager) client or transaction. */
export function wrapPostgres(sql) {
  return {
    query: (text, params = []) => sql.unsafe(text, params),
    exec: (text) => sql.unsafe(text).simple(),
    begin: (fn) => sql.begin((tx) => fn(wrapPostgres(tx))),
    end: () => sql.end?.({ timeout: 5 }),
  };
}

/** The same handle over a PGlite instance (tests, local experiments). */
export function wrapPglite(pg) {
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    exec: (text) => pg.exec(text),
    begin: (fn) => pg.transaction((tx) => fn(wrapPglite(tx))),
    end: () => pg.close?.(),
  };
}

/**
 * Connect to Postgres by URL (Neon: the pooled connection string, with sslmode=require).
 * One connection, no prepared statements (Neon's pooler runs PgBouncer in transaction mode).
 * The driver is only loaded here, so nothing touches it until a URL is configured.
 */
export async function connect(url, options = {}) {
  const { default: postgres } = await import('postgres');
  return wrapPostgres(postgres(url, {
    max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => {}, ...options,
  }));
}

/**
 * A getter for the API's read-only handle: `db` when a caller (a test) passes one (null means
 * "no database"), else a connection from process.env[envVar], opened on first use and reused
 * across warm invocations. Resolves to null when nothing is configured.
 */
export function lazyDb(db, envVar = 'DATABASE_URL_READONLY') {
  let pending = null;
  return async () => {
    if (db !== undefined) return db;
    const url = process.env[envVar];
    if (!url) return null;
    pending ??= connect(url).catch((e) => { pending = null; throw e; });
    return pending;
  };
}

/** Error text without connection strings or passwords (it ends up in logs and issues). */
export const redact = (message) => String(message ?? '')
  .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://…')
  .replace(/password=\S+/gi, 'password=…');

// --- migrations ----------------------------------------------------------------------------

const MIGRATION = /^\d{4}_[\w-]+\.sql$/;
const MIGRATE_LOCK = '7254917043'; // pg_advisory_xact_lock key: one migrator at a time
const WRITE_LOCK = '7254917044'; // ...and one run writer

/**
 * Apply db/migrations/NNNN_name.sql files not yet in schema_migrations, in order, each in its
 * own transaction, then db/grants.sql (idempotent). Safe to run every scrape and concurrently.
 * A migration edited after it was applied is reported, not re-run: write a new one instead.
 */
export async function migrate(db, { dir = repoPath('db/migrations'), grants = repoPath('db/grants.sql'), log = console.log } = {}) {
  await db.exec(`create table if not exists schema_migrations (
    version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  const done = new Map((await db.query('select version, checksum from schema_migrations')).map((r) => [r.version, r.checksum]));
  const applied = [];
  for (const file of (await readdir(dir)).filter((f) => MIGRATION.test(f)).sort()) {
    const text = await readFile(join(dir, file), 'utf8');
    const version = file.replace(/\.sql$/, '');
    const checksum = createHash('sha256').update(text).digest('hex');
    if (done.has(version)) {
      if (done.get(version) !== checksum) log(`warn  ${file} changed after it was applied; add a new migration instead`);
      continue;
    }
    const ran = await db.begin(async (tx) => {
      await tx.query('select pg_advisory_xact_lock($1::text::bigint)', [MIGRATE_LOCK]);
      if ((await tx.query('select 1 from schema_migrations where version = $1', [version])).length) return false;
      await tx.exec(text);
      await tx.query('insert into schema_migrations (version, checksum) values ($1, $2)', [version, checksum]);
      return true;
    });
    if (ran) { applied.push(version); log(`applied ${file}`); }
  }
  if (grants) await db.exec(await readFile(grants, 'utf8'));
  return { applied };
}

// --- pure helpers (unit tested without a database) -----------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v) => (typeof v === 'string' && DATE.test(v) ? v : null);
const text = (v) => (v == null || v === '' ? null : String(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());

/**
 * Session fields left out of the change history: run bookkeeping that moves every hour
 * (verifiedAt, checkFailed, watch flags) and live availability (spotsLeft, full, waitlist).
 * They are still stored on the session row; they just don't make a session_changes entry.
 */
export const UNTRACKED_FIELDS = new Set(['verifiedAt', 'checkFailed', 'watchError', 'sourceChanged', 'spotsLeft', 'full', 'waitlist']);

/** JSON with sorted keys, so jsonb round trips (which reorder keys) compare equal. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Top-level session fields that differ (sorted), ignoring UNTRACKED_FIELDS. null/missing are the same. */
export function diffFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => !UNTRACKED_FIELDS.has(k) && canonical(before?.[k]) !== canonical(after?.[k])).sort();
}

/** A published session (schedule.json, schema v2) as a sessions row. */
export function sessionRow(s) {
  return {
    id: s.id,
    source_id: s.sourceId,
    sport: s.sport,
    region: s.region,
    timezone: s.timezone,
    title: s.title,
    venue: text(s.venue),
    city: text(s.city),
    date: date(s.date),
    days: Array.isArray(s.days) ? s.days.map(String) : null,
    start_time: text(s.start),
    end_time: text(s.end),
    starts_on: date(s.startsOn),
    valid_until: date(s.validUntil),
    price: text(s.price),
    level: text(s.level),
    note: text(s.note),
    signup_url: text(s.signup?.url),
    signup_label: text(s.signup?.label),
    source_url: text(s.source),
    facility: text(s.facility),
    canceled: !!s.canceled,
    verified_at: date(s.verifiedAt),
    check_failed: date(s.checkFailed),
    attributes: sessionAttributes(s),
    data: s,
  };
}

/** A feed occurrence (occurrences.json item) as an occurrences row. */
export function occurrenceRow(o) {
  return {
    id: o.id,
    session_id: o.session_id,
    source_id: o.source_id,
    sport: o.sport,
    region: o.region,
    timezone: o.timezone,
    local_date: occurrenceDate(o),
    starts_at: o.starts_at,
    ends_at: o.ends_at ?? null,
    canceled: !!o.canceled,
    data: o,
  };
}

/** A stored occurrence's data with its keys back in feed order (jsonb doesn't keep order). */
export function feedOrder(data) {
  const out = {};
  for (const k of OCCURRENCE_KEYS) if (k in data) out[k] = data[k];
  for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k];
  return out;
}

/** Whether a session is over by `at` (a dated session before today, a season that has ended). */
export function isPast(s, at) {
  const day = today(new Date(at), s.timezone);
  if (s.date) return s.date < day;
  return !!(s.validUntil && s.validUntil < day);
}

/**
 * What one run changes, from the stored rows and the run's sessions. Pure.
 *
 * - `prev`: stored rows { id, source_id, data, removed_at, updated_at } (current ones, plus any
 *   removed row whose id is back in this run).
 * - `sessions`: the run's published sessions. `failedSources`: source ids that failed this run;
 *   their stored sessions are never removed (keep last good, like the file pipeline).
 * - `at`: the run's time.
 *
 * Returns { upserts: [{ session, updated_at }], removed: [id], changes: [{ session_id, kind,
 * before, after, fields }], expired: [id] }. A session that drops out because it is over is
 * removed without a 'removed' change (it ended; it wasn't taken down).
 */
export function planRun({ prev = [], sessions = [], failedSources = [], at }) {
  const atIso = iso(at);
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const current = new Set(sessions.map((s) => s.id));
  const failed = new Set(failedSources);
  const upserts = [], changes = [], removed = [], expired = [];

  for (const s of sessions) {
    const p = prevById.get(s.id);
    if (!p || p.removed_at) {
      changes.push({ session_id: s.id, kind: 'added', before: null, after: s, fields: [] });
      upserts.push({ session: s, updated_at: atIso });
      continue;
    }
    const fields = diffFields(p.data, s);
    if (fields.length) {
      const was = !!p.data?.canceled, is = !!s.canceled;
      const kind = was === is ? 'changed' : is ? 'canceled' : 'uncanceled';
      changes.push({ session_id: s.id, kind, before: p.data, after: s, fields });
    }
    upserts.push({ session: s, updated_at: fields.length ? atIso : iso(p.updated_at) ?? atIso });
  }

  for (const p of prev) {
    if (p.removed_at || current.has(p.id) || failed.has(p.source_id)) continue;
    removed.push(p.id);
    if (isPast(p.data, at)) expired.push(p.id);
    else changes.push({ session_id: p.id, kind: 'removed', before: p.data, after: null, fields: [] });
  }
  return { upserts, removed, changes, expired };
}

/**
 * Source rows for a run: each entry of schedule.json `sources`, plus pseudo-sources that only
 * appear on sessions (the hand-checked "manual" entries), which count as succeeding.
 */
export function sourceRows(schedule, adapters = {}) {
  const at = schedule.generatedAt;
  const rows = (schedule.sources ?? []).map((s) => ({
    id: s.id, sport: s.sport, region: s.region, adapter: adapters[s.id] ?? null,
    ok: !!s.ok, checked_at: s.checkedAt ?? at, error: s.ok ? null : text(s.error) ?? 'failed', count: s.ok ? s.count ?? 0 : null,
  }));
  const listed = new Set(rows.map((r) => r.id));
  const extra = new Map();
  for (const s of schedule.sessions ?? []) {
    if (listed.has(s.sourceId)) continue;
    const r = extra.get(s.sourceId) ?? { id: s.sourceId, sport: s.sport, region: s.region, adapter: adapters[s.sourceId] ?? (s.sourceId === 'manual' ? 'manual' : null), ok: true, checked_at: at, error: null, count: 0 };
    r.count++;
    extra.set(s.sourceId, r);
  }
  return [...rows, ...extra.values()];
}

// --- writing a run -------------------------------------------------------------------------

const SESSION_COLUMNS = [
  ['id', 'text'], ['source_id', 'text'], ['sport', 'text'], ['region', 'text'], ['timezone', 'text'], ['title', 'text'],
  ['venue', 'text'], ['city', 'text'], ['date', 'date'], ['days', 'text[]'], ['start_time', 'text'], ['end_time', 'text'],
  ['starts_on', 'date'], ['valid_until', 'date'], ['price', 'text'], ['level', 'text'], ['note', 'text'],
  ['signup_url', 'text'], ['signup_label', 'text'], ['source_url', 'text'], ['facility', 'text'], ['canceled', 'boolean'],
  ['verified_at', 'date'], ['check_failed', 'date'], ['attributes', 'jsonb'], ['data', 'jsonb'], ['updated_at', 'timestamptz'],
];
const OCCURRENCE_COLUMNS = [
  ['id', 'text'], ['session_id', 'text'], ['source_id', 'text'], ['sport', 'text'], ['region', 'text'], ['timezone', 'text'],
  ['local_date', 'date'], ['starts_at', 'timestamptz'], ['ends_at', 'timestamptz'], ['canceled', 'boolean'], ['data', 'jsonb'],
];
const defs = (cols) => cols.map(([c, t]) => `"${c}" ${t}`).join(', ');
const names = (cols, prefix = '') => cols.map(([c]) => `${prefix}"${c}"`).join(', ');
const sets = (cols) => cols.filter(([c]) => c !== 'id').map(([c]) => `"${c}" = excluded."${c}"`).join(', ');
const json = (v) => JSON.stringify(v);

const UPSERT_SOURCES = `
  insert into sources (id, sport, region, adapter, last_ok_at, last_error, last_checked_at, count)
  select r.id, r.sport, r.region, r.adapter, case when r.ok then r.checked_at end, r.error, r.checked_at, r.count
  from jsonb_to_recordset($1::text::jsonb) as r(id text, sport text, region text, adapter text, ok boolean, checked_at timestamptz, error text, count integer)
  on conflict (id) do update set
    sport = excluded.sport, region = excluded.region, adapter = coalesce(excluded.adapter, sources.adapter),
    last_ok_at = coalesce(excluded.last_ok_at, sources.last_ok_at), last_error = excluded.last_error,
    last_checked_at = excluded.last_checked_at, count = coalesce(excluded.count, sources.count)`;

const UPSERT_SESSIONS = `
  insert into sessions (${names(SESSION_COLUMNS)}, first_seen_at, last_seen_at, removed_at)
  select ${names(SESSION_COLUMNS, 'r.')}, $2::text::timestamptz, $2::text::timestamptz, null
  from jsonb_to_recordset($1::text::jsonb) as r(${defs(SESSION_COLUMNS)})
  on conflict (id) do update set ${sets(SESSION_COLUMNS)}, last_seen_at = excluded.last_seen_at, removed_at = null`;

const UPSERT_OCCURRENCES = `
  insert into occurrences (${names(OCCURRENCE_COLUMNS)}, first_seen_at, updated_at)
  select ${names(OCCURRENCE_COLUMNS, 'r.')}, $2::text::timestamptz, $2::text::timestamptz
  from jsonb_to_recordset($1::text::jsonb) as r(${defs(OCCURRENCE_COLUMNS)})
  on conflict (id) do update set ${sets(OCCURRENCE_COLUMNS)},
    updated_at = case when occurrences.data is distinct from excluded.data then excluded.updated_at else occurrences.updated_at end`;

/**
 * Write one scrape run, in one transaction:
 *   - a scrape_runs row (a run already written, same generatedAt, is skipped: safe to retry);
 *   - sources upserted with their status (a failing source keeps last_ok_at and count);
 *   - sessions upserted, and those missing from this run marked removed_at, but only for
 *     sources that succeeded: a failed source keeps its last good sessions, as in the files;
 *   - session_changes for each session added, changed, canceled, uncanceled or removed;
 *   - occurrences upserted, and upcoming ones (from the run's time) no longer in the feed
 *     deleted, again except for failed sources. Past occurrences stay as history.
 *
 * `schedule` is schedule.json's body, `occurrences` the feed (occurrences.json body or its
 * array), `health` the run's findings ({ findings } or an array), `adapters` an optional
 * { sourceId: adapterName }. Returns what it did.
 */
export async function writeRun(db, { schedule, occurrences, health, startedAt, finishedAt, adapters = {} }) {
  const at = iso(schedule.generatedAt);
  const sessions = schedule.sessions ?? [];
  const feed = Array.isArray(occurrences) ? occurrences : occurrences?.occurrences ?? [];
  const sources = sourceRows(schedule, adapters);
  const failedSources = sources.filter((s) => !s.ok).map((s) => s.id);
  const findings = Array.isArray(health) ? health : health?.findings ?? [];
  const sessionIds = new Set(sessions.map((s) => s.id));
  const occ = feed.filter((o) => sessionIds.has(o.session_id)); // every feed row comes from a session; be sure

  return db.begin(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1::text::bigint)', [WRITE_LOCK]);
    const [run] = await tx.query(
      `insert into scrape_runs (started_at, finished_at, generated_at, ok, summary, findings)
       values ($1::text::timestamptz, $2::text::timestamptz, $3::text::timestamptz, $4::text::boolean, $5::text::jsonb, $6::text::jsonb)
       on conflict (generated_at) do nothing returning id`,
      [iso(startedAt ?? at), iso(finishedAt ?? at), at, String(!failedSources.length), json(schedule.sources ?? []), json(findings)],
    );
    if (!run) return { skipped: true, generatedAt: at };
    const runId = String(run.id);

    await tx.query(UPSERT_SOURCES, [json(sources)]);

    const prev = await tx.query(
      `select id, source_id, data, removed_at, updated_at from sessions
       where removed_at is null or id in (select jsonb_array_elements_text($1::text::jsonb))`,
      [json([...sessionIds])],
    );
    const plan = planRun({ prev, sessions, failedSources, at });

    if (plan.upserts.length) {
      await tx.query(UPSERT_SESSIONS, [json(plan.upserts.map((u) => ({ ...sessionRow(u.session), updated_at: u.updated_at }))), at]);
    }
    if (plan.removed.length) {
      await tx.query('update sessions set removed_at = $1::text::timestamptz where id in (select jsonb_array_elements_text($2::text::jsonb))', [at, json(plan.removed)]);
    }
    if (plan.changes.length) {
      await tx.query(
        `insert into session_changes (run_id, session_id, changed_at, kind, before, after, fields)
         select $2::text::bigint, r.session_id, $3::text::timestamptz, r.kind, r.before, r.after, coalesce(r.fields, '{}')
         from jsonb_to_recordset($1::text::jsonb) as r(session_id text, kind text, before jsonb, after jsonb, fields text[])`,
        [json(plan.changes), runId, at],
      );
    }

    if (occ.length) await tx.query(UPSERT_OCCURRENCES, [json(occ.map(occurrenceRow)), at]);
    const deleted = await tx.query(
      `delete from occurrences
       where starts_at >= $1::text::timestamptz
         and id not in (select jsonb_array_elements_text($2::text::jsonb))
         and source_id not in (select jsonb_array_elements_text($3::text::jsonb))
       returning id`,
      [at, json(occ.map((o) => o.id)), json(failedSources)],
    );

    const count = (kind) => plan.changes.filter((c) => c.kind === kind).length;
    const stats = {
      runId, generatedAt: at, sessions: sessions.length, occurrences: occ.length, occurrencesDeleted: deleted.length,
      added: count('added'), changed: count('changed'), canceled: count('canceled'), uncanceled: count('uncanceled'),
      removed: count('removed'), expired: plan.expired.length, failedSources,
    };
    await tx.query('update scrape_runs set stats = $1::text::jsonb where id = $2::text::bigint', [json(stats), runId]);
    return stats;
  });
}

/**
 * The scrape's hook (scripts/scrape.mjs): write runScrape's result to the database when
 * `url` (DATABASE_URL) is set. Never throws: a failed write is logged and appended to the
 * failures file the workflow turns into an issue, and the JSON feed is published regardless.
 * Returns { skipped } with no URL, { ok: true, stats } or { ok: false, error }.
 */
export async function persistRun({
  url, result, startedAt, finishedAt = new Date(), adapters, failuresFile, summaryFile,
  open = connect, log = console.log, timeoutMs = 60000,
}) {
  if (!url) return { skipped: true };
  let db, timer;
  try {
    db = await open(url);
    const write = writeRun(db, { schedule: result.out, occurrences: result.feed, health: { findings: result.findings }, startedAt, finishedAt, adapters });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs); });
    const stats = await Promise.race([write, timeout]);
    log(stats.skipped
      ? `db    run ${stats.generatedAt} was already written`
      : `db    run ${stats.runId}: ${stats.sessions} sessions (+${stats.added} ~${stats.changed + stats.canceled + stats.uncanceled} -${stats.removed}), ${stats.occurrences} occurrences`);
    return { ok: true, stats };
  } catch (e) {
    const error = redact(e?.message ?? e);
    log(`WARN  database write failed: ${error} (the JSON feed was still published)`);
    const note = `The database write failed: ${error}\n\nThe JSON feed was still published; the next run writes the database again.\n`;
    if (failuresFile) {
      const had = await readFile(failuresFile, 'utf8').catch(() => '');
      await (had.trim() ? appendFile(failuresFile, `\n\n${note}`) : writeFile(failuresFile, `Schelagg database write failed on ${today(new Date(result?.out?.generatedAt ?? Date.now()))}.\n\n${note}`));
    }
    if (summaryFile) await appendFile(summaryFile, `\n- ⚠️ **database** write failed: ${error}\n`).catch(() => {});
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
    await Promise.resolve(db?.end()).catch(() => {});
  }
}

// --- reading (the API) ---------------------------------------------------------------------

/** Published sessions by id (what schedule.json `sessions` holds), for /api/check. */
export async function loadPublishedFromDb(db) {
  const rows = await db.query('select data from sessions where removed_at is null');
  return new Map(rows.map((r) => [r.data.id, r.data]));
}

/**
 * Occurrences starting on local dates from..to (YYYY-MM-DD, inclusive, in each row's own time
 * zone), optionally for one sport / region, shaped and ordered as occurrences.json.
 * `generatedAt` is the last run written (null when the database has no runs yet).
 */
export async function queryOccurrences(db, { sport = null, region = null, from, to }) {
  const [last] = await db.query('select generated_at from scrape_runs order by generated_at desc limit 1');
  // The starts_at range (a day of slack each side covers any time zone) lets the index work;
  // local_date is the exact test.
  const rows = await db.query(
    `select data from occurrences
     where starts_at >= $3::text::date - interval '1 day' and starts_at < $4::text::date + interval '2 days'
       and local_date between $3::text::date and $4::text::date
       and ($1::text is null or sport = $1::text) and ($2::text is null or region = $2::text)`,
    [sport, region, from, to],
  );
  return { generatedAt: iso(last?.generated_at), occurrences: rows.map((r) => feedOrder(r.data)).sort(compareOccurrences) };
}
