// Consolidating sessions from many sources (#20), run by the scrape after validation:
//
//   resolveVenues  each session's venue string -> a canonical venue (config/regions/<id>/venues.json)
//                  (aliases cover each source's spelling); unknown names become source warnings
//   markMoves      a dated session whose date/start changed since the last run keeps its id and
//                  gets status 'rescheduled' + previousStart, until it's over
//   dedupe         the same session listed by two sources shows once: the first source in config
//                  order keeps it, the others are linked from it as alsoOn (nothing is deleted
//                  from the sources' own records; schedule.json lists what was merged)
//
// Pure (no I/O) so each piece is unit tested. The vocabulary follows OpenActive's
// SessionSeries / ScheduledSession model (status, previousStartDate), see #20.
import { readFileSync } from 'node:fs';
import { loadRegions } from './regions.js';

export const STATUSES = ['scheduled', 'cancelled', 'rescheduled'];

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Canonical venues: every region's venues.json (config/regions/<id>/venues.json) merged, each
 * tagged with its region, or one file when `path` is given. Ids must be unique across regions.
 */
export function loadVenues(path) {
  const lists = path
    ? [{ region: undefined, venues: JSON.parse(readFileSync(path, 'utf8')).venues ?? [] }]
    : loadRegions().map((r) => ({ region: r.info.id, venues: r.venues }));
  const all = lists.flatMap((l) => l.venues.map((v) => (l.region ? { ...v, region: l.region } : v)));
  const seen = new Set();
  for (const v of all) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(v.id ?? '')) throw new Error(`venues: bad id "${v.id}"`);
    if (seen.has(v.id)) throw new Error(`venues: duplicate id "${v.id}"`);
    seen.add(v.id);
    if (!v.name) throw new Error(`venues: ${v.id} has no name`);
  }
  for (const v of all) if (v.parent && !seen.has(v.parent)) throw new Error(`venues: ${v.id} has unknown parent "${v.parent}"`);
  return all;
}

/** name or alias (normalized) -> venue id. */
export const venueIndex = (venues) => new Map(venues.flatMap((v) => [v.name, ...(v.aliases ?? [])].map((n) => [norm(n), v.id])));

/**
 * Stamp venueId on each session whose venue is known. Returns { sessions, unknown } where
 * unknown maps sourceId -> [venue names not in the registry].
 */
export function resolveVenues(sessions, venues) {
  const index = venueIndex(venues);
  const unknown = new Map();
  const out = sessions.map((s) => {
    const id = index.get(norm(s.venue));
    if (id) return { ...s, venueId: id };
    if (s.venue) {
      const list = unknown.get(s.sourceId) ?? [];
      if (!list.includes(s.venue)) list.push(s.venue);
      unknown.set(s.sourceId, list);
    }
    const { venueId, ...rest } = s;
    return rest;
  });
  return { sessions: out, unknown };
}

const at = (s) => (s.date && s.start ? `${s.date} ${s.start}` : null);

/**
 * Status for every session, and moves for dated ones. `prev` is last run's sessions. A session
 * whose date or start differs from last run's is 'rescheduled' with previousStart
 * ("YYYY-MM-DD HH:MM", the original time), carried forward while it stays moved. Cancelled wins.
 */
export function markMoves(sessions, prev = []) {
  const before = new Map(prev.map((p) => [p.id, p]));
  return sessions.map((s) => {
    const p = before.get(s.id);
    let previousStart;
    if (s.date && s.start && p?.date && p?.start) {
      const original = p.previousStart ?? at(p);
      if (original !== at(s)) previousStart = original; // moved (now or in an earlier run), and not back
    }
    const { previousStart: _old, status: _s, ...rest } = s;
    const status = s.canceled ? 'cancelled' : previousStart ? 'rescheduled' : 'scheduled';
    return previousStart ? { ...rest, status, previousStart } : { ...rest, status };
  });
}

const STOP = new Set(['the', 'and', 'at', 'a', 'of', 'for', 'with', 'open', 'play', 'session', 'volleyball', 'skate', 'skating']);
const tokens = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
/** Jaccard similarity of two titles' meaningful words (1 when neither has any). */
export function titleSimilarity(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.size && !y.size) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}
const toMin = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);

/**
 * Is b the same real-world session as a, listed by another source? Same sport, same venue
 * (canonical id, else normalized name), same date, start within 15 minutes, similar title.
 */
export function sameSession(a, b, { minutes = 15, similarity = 0.5 } = {}) {
  if (a.sourceId === b.sourceId || a.sport !== b.sport) return false;
  if (!a.date || a.date !== b.date || !a.start || !b.start) return false;
  const va = a.venueId ?? norm(a.venue), vb = b.venueId ?? norm(b.venue);
  if (!va || va !== vb) return false;
  if (Math.abs(toMin(a.start) - toMin(b.start)) > minutes) return false;
  return titleSimilarity(a.title, b.title) >= similarity;
}

/**
 * Merge cross-source duplicates. `order` is source ids by precedence (config order; manual last).
 * The kept session gets alsoOn: [{ sourceId, id, title, signup, source }] and fills fields it
 * lacks from the others (price, end, level, capacity, spotsLeft), recording where each came from
 * in fieldSources. Returns { sessions, merged: [{ kept, dropped }] }.
 */
export function dedupe(sessions, order = []) {
  const rank = (s) => { const i = order.indexOf(s.sourceId); return i < 0 ? order.length : i; };
  const sorted = [...sessions].sort((a, b) => rank(a) - rank(b));
  const kept = [], merged = [];
  for (const s of sorted) {
    const into = kept.find((k) => sameSession(k, s));
    if (!into) { kept.push({ ...s }); continue; }
    into.alsoOn = [...(into.alsoOn ?? []), { sourceId: s.sourceId, id: s.id, title: s.title, signup: s.signup, source: s.source }];
    for (const f of ['end', 'price', 'level', 'capacity', 'spotsLeft']) {
      if (into[f] == null && s[f] != null) {
        into[f] = s[f];
        into.fieldSources = { ...(into.fieldSources ?? {}), [f]: s.sourceId };
      }
    }
    merged.push({ kept: into.id, dropped: s.id });
  }
  // Back in the original order, so output stays stable run to run.
  const pos = new Map(sessions.map((s, i) => [s.id, i]));
  return { sessions: kept.sort((a, b) => pos.get(a.id) - pos.get(b.id)), merged };
}
