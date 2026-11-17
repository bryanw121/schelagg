// Austin pop-up, seasonal and Asian-inspired events: the events table, the feed merge,
// and the loader's database write (lib/db.js's session storage, for the discovery feed).
//
// Discovery runs in Muse (Instagram is unreliable from GitHub Actions runners) and
// publishes public/data/events.json; scripts/load-events.mjs loads that feed into Neon
// (DATABASE_URL). The feed is the compatibility copy, as with schedule.json; the table is
// the source of truth. Everything here talks to the same driver-neutral handle as lib/db.js,
// so the same SQL runs against Neon and an in-process PGlite in the tests.

import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { canonical, connect, redact } from './db.js';
import { TZ, today } from './time.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const date = (v) => (typeof v === 'string' && DATE.test(v) ? v : null);
const text = (v) => (v == null || v === '' ? null : String(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());

export const CATEGORIES = ['popup', 'seasonal', 'asian-inspired'];

/** The deterministic id for a feed event: 'evt-' + sha256(sourceUrl|startDate), first 16 hex. */
export function eventId(sourceUrl, startDate) {
  return `evt-${createHash('sha256').update(`${sourceUrl}|${startDate}`).digest('hex').slice(0, 16)}`;
}

/** A feed event (events.json item) as an events row. */
export function eventRow(e) {
  return {
    id: e.id ?? eventId(e.sourceUrl, e.startDate),
    category: e.category,
    title: e.title,
    venue: text(e.venue),
    area: text(e.area),
    city: text(e.city),
    start_date: date(e.startDate),
    end_date: date(e.endDate),
    start_time: text(e.startTime),
    end_time: text(e.endTime),
    price: text(e.price),
    source_url: text(e.sourceUrl),
    source: text(e.source),
    description: text(e.description),
    attributes: {},
    data: e,
  };
}

/** Top-level event fields that differ (sorted). null/missing are the same. */
export function eventDiffFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => canonical(before?.[k]) !== canonical(after?.[k])).sort();
}

/** Whether an event is over by `at` (its last day before today in Austin). */
export function isEventPast(e, at) {
  const day = today(new Date(at), TZ);
  const last = e.endDate ?? e.startDate;
  return !!last && last < day;
}

/**
 * What one load changes, from the stored rows and the feed's events. Pure.
 *
 * - `prev`: stored rows { id, data, removed_at, updated_at } (current ones, plus any
 *   removed row whose id is back in this feed).
 * - `events`: the feed's events. `at`: the run's time.
 *
 * Returns { upserts: [{ event, updated_at }], removed: [id], changes: [{ event_id, kind,
 * before, after, fields }], expired: [id] }. An event that drops out before its date is
 * removed with a 'removed' change; one past its end date is removed without a change
 * (it ended; it wasn't taken down).
 */
export function planEvents({ prev = [], events = [], at }) {
  const atIso = iso(at);
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const current = new Set(events.map((e) => e.id ?? eventId(e.sourceUrl, e.startDate)));
  const upserts = [], changes = [], removed = [], expired = [];

  for (const e of events) {
    const id = e.id ?? eventId(e.sourceUrl, e.startDate);
    const event = { ...e, id };
    const p = prevById.get(id);

    if (!p || p.removed_at) {
      changes.push({ event_id: id, kind: 'added', before: null, after: event, fields: [] });
      upserts.push({ event, updated_at: atIso });
      continue;
    }

    const fields = eventDiffFields(p.data, event);

    if (fields.length) {
      changes.push({ event_id: id, kind: 'changed', before: p.data, after: event, fields });
    }

    upserts.push({ event, updated_at: fields.length ? atIso : iso(p.updated_at) ?? atIso });
  }

  for (const p of prev) {
    if (p.removed_at || current.has(p.id)) continue;

    removed.push(p.id);

    if (isEventPast(p.data, at)) expired.push(p.id);
    else changes.push({ event_id: p.id, kind: 'removed', before: p.data, after: null, fields: [] });
  }

  return { upserts, removed, changes, expired };
}

// --- writing a load --------------------------------------------------------------------------

const EVENT_COLUMNS = [
  ['id', 'text'], ['category', 'text'], ['title', 'text'], ['venue', 'text'], ['area', 'text'], ['city', 'text'],
  ['start_date', 'date'], ['end_date', 'date'], ['start_time', 'text'], ['end_time', 'text'], ['price', 'text'],
  ['source_url', 'text'], ['source', 'text'], ['description', 'text'], ['attributes', 'jsonb'], ['data', 'jsonb'],
  ['updated_at', 'timestamptz'],
];

const defs = (cols) => cols.map(([c, t]) => `"${c}" ${t}`).join(', ');
const names = (cols, prefix = '') => cols.map(([c]) => `${prefix}"${c}"`).join(', ');
const sets = (cols) => cols.filter(([c]) => c !== 'id').map(([c]) => `"${c}" = excluded."${c}"`).join(', ');
const json = (v) => JSON.stringify(v);

const UPSERT_EVENTS = `
  insert into events (${names(EVENT_COLUMNS)}, first_seen_at, last_seen_at, removed_at)
  select ${names(EVENT_COLUMNS, 'r.')}, $2::text::timestamptz, $2::text::timestamptz, null
  from jsonb_to_recordset($1::text::jsonb) as r(${defs(EVENT_COLUMNS)})
  on conflict (id) do update set ${sets(EVENT_COLUMNS)}, last_seen_at = excluded.last_seen_at, removed_at = null`;

const EVENTS_WRITE_LOCK = '7254917045'; // pg_advisory_xact_lock key: one events writer at a time

/**
 * Write one events feed to the database, in one transaction: events upserted, and those
 * missing from this feed marked removed_at. Returns what it did.
 */
export async function writeEvents(db, { events, at }) {
  const atIso = iso(at);
  const list = (events ?? []).map((e) => ({ ...e, id: e.id ?? eventId(e.sourceUrl, e.startDate) }));
  const ids = new Set(list.map((e) => e.id));

  return db.begin(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1::text::bigint)', [EVENTS_WRITE_LOCK]);

    const prev = await tx.query(
      `select id, data, removed_at, updated_at from events
       where removed_at is null or id in (select jsonb_array_elements_text($1::text::jsonb))`,
      [json([...ids])],
    );

    const plan = planEvents({ prev, events: list, at });

    if (plan.upserts.length) {
      await tx.query(UPSERT_EVENTS, [json(plan.upserts.map((u) => ({ ...eventRow(u.event), updated_at: u.updated_at }))), atIso]);
    }

    if (plan.removed.length) {
      await tx.query('update events set removed_at = $1::text::timestamptz where id in (select jsonb_array_elements_text($2::text::jsonb))', [atIso, json(plan.removed)]);
    }

    const count = (kind) => plan.changes.filter((c) => c.kind === kind).length;

    return {
      events: list.length, added: count('added'), changed: count('changed'),
      removed: count('removed'), expired: plan.expired.length,
    };
  });
}

/**
 * The loader's hook (scripts/load-events.mjs): write the feed to the database when `url`
 * (DATABASE_URL) is set. Never throws: a failed write is logged and appended to the
 * failures file the workflow turns into an issue, and the JSON feed stays published.
 * Returns { skipped } with no URL, { ok: true, stats } or { ok: false, error }.
 */
export async function persistEvents({
  url, feed, failuresFile, log = console.log, open = connect, timeoutMs = 60000,
}) {
  if (!url) return { skipped: true };

  let db, timer;

  try {
    db = await open(url);

    const write = writeEvents(db, { events: feed?.events ?? [], at: feed?.generatedAt ?? new Date() });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs); });
    const stats = await Promise.race([write, timeout]);

    log(`events  ${stats.events} events (+${stats.added} ~${stats.changed} -${stats.removed}, ${stats.expired} expired)`);

    return { ok: true, stats };
  } catch (e) {
    const error = redact(e?.message ?? e);

    log(`WARN  events load failed: ${error} (the JSON feed is still published)`);

    const note = `The events load failed: ${error}\n\nThe JSON feed is still published; the next run loads the database again.\n`;

    if (failuresFile) {
      const had = await readFile(failuresFile, 'utf8').catch(() => '');
      await (had.trim() ? appendFile(failuresFile, `\n\n${note}`) : writeFile(failuresFile, `Events database load failed on ${today(new Date(feed?.generatedAt ?? Date.now()))}.\n\n${note}`));
    }

    return { ok: false, error };
  } finally {
    clearTimeout(timer);
    await Promise.resolve(db?.end()).catch(() => {});
  }
}

// --- the feed --------------------------------------------------------------------------------

/**
 * Merge a discovered batch into the previous feed: new events win on id, past events drop
 * out, the rest sort by start date then title. `now` is the run's clock; `previous` the
 * last published feed (or null). An event is past once its last day (endDate, else
 * startDate) is before today in Austin, so a multi-day seasonal event stays until it ends.
 */
export function buildFeed({ events = [], previous = null, now = new Date() }) {
  const day = today(new Date(now), TZ);
  const byId = new Map();

  for (const e of [...(previous?.events ?? []), ...events]) {
    const id = e.id ?? eventId(e.sourceUrl, e.startDate);
    byId.set(id, { ...e, id });
  }

  const kept = [...byId.values()].filter((e) => {
    const last = e.endDate ?? e.startDate;
    return last && last >= day;
  });

  kept.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.title.localeCompare(b.title)));

  return { feedVersion: 1, generatedAt: new Date(now).toISOString(), events: kept };
}

// --- reading ---------------------------------------------------------------------------------

/**
 * Events overlapping a local date range (YYYY-MM-DD, inclusive), shaped as the feed:
 * an event counts while it runs, so a multi-day event that started before `from` is
 * included until it ends. `generatedAt` is the last load written (null when the
 * database has no events yet).
 */
export async function queryEvents(db, { category = null, from, to }) {
  const [last] = await db.query('select max(last_seen_at) as generated_at from events');

  const rows = await db.query(
    `select data from events
     where removed_at is null
       and start_date <= $3::text::date
       and coalesce(end_date, start_date) >= $2::text::date
       and ($1::text is null or category = $1::text)
     order by start_date, title`,
    [category, from, to],
  );

  return { generatedAt: iso(last?.generated_at), events: rows.map((r) => r.data) };
}
