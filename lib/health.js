// Source health: notice when a source changes what it sends, even though the scrape still
// "works". A scraper that throws is already reported (scrape-failures.md -> an issue); this
// catches the quiet failures that leave the site wrong without an error:
//
// - count:    a source suddenly returns far fewer sessions than usual (a renamed class falls
//             out of a filter, a club page stops linking its meets).
// - fields:   a field every session used to have is gone from all of them (an API field was
//             renamed, so capacity or price silently disappears).
// - shape:    a key the adapter reads is missing from the raw API records it was in last run.
// - content:  a page the adapter reads only partly changed (its hard-coded details, like a
//             drop-in price, may now be wrong).
// - warning:  a new validation or adapter warning (an unmapped venue, an unknown surface, a
//             meet page that 404s).
// - manual:   a hand-checked session's source page changed, can't be watched, or hasn't been
//             re-verified in a while.
// - failing:  a source failed FAIL_STREAK scrapes in a row. One failure is usually an outage
//             (a 503, a timeout); several in a row usually means its format changed.
//
// Each finding has a stable key. data/health.json remembers which keys were already reported,
// so an hourly scrape reports a problem once, not every hour; when the problem clears, its key
// is forgotten and a recurrence is reported again.
import { createHash } from 'node:crypto';
import { addDays } from './time.js';

/** Successful-run session counts kept per source. */
export const HISTORY = 10;
/** A count at or below median / COUNT_DROP is a drop... */
export const COUNT_DROP = 3;
/** ...once the usual count is at least this (small sources swing too much to judge). */
export const MIN_USUAL_COUNT = 3;
/** Session fields whose disappearance across a whole source is worth a look. */
export const FIELDS = ['end', 'price', 'level', 'venue', 'city', 'surface', 'type', 'capacity', 'spotsLeft', 'signup'];
/** A field counts as "usual" for a source when at least this share of its sessions had it... */
export const FIELD_USUAL = 0.75;
/** ...and the source had at least this many sessions to judge by. */
export const FIELD_MIN_SESSIONS = 3;
/** Hand-checked sessions not re-verified in this many days get a reminder. */
export const MANUAL_STALE_DAYS = 30;
/** Consecutive failed scrapes before a source is reported as failing (hourly: about 3 hours). */
export const FAIL_STREAK = 3;

/** Short hash of page text, ignoring whitespace differences. */
export const contentHash = (text) =>
  createHash('sha256').update(String(text).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

/**
 * Every key path in a value, e.g. { a: { b: 1 }, c: [{ d: 2 }] } -> a, a.b, c[], c[].d.
 * Arrays are collapsed (their object elements merged), and depth is capped so a deep
 * payload can't blow up the stored shape.
 */
export function shapeOf(value, prefix = '', out = new Set(), depth = 0) {
  if (depth > 4 || value == null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 50)) shapeOf(v, prefix, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(Array.isArray(v) ? `${path}[]` : path);
    shapeOf(v, Array.isArray(v) ? `${path}[]` : path, out, depth + 1);
  }
  return out;
}

/** The union of key paths across raw records, sorted (what adapters return as `shape`). */
export const shapeUnion = (records = []) => [...records.reduce((s, r) => shapeOf(r, '', s), new Set())].sort();

/** Share of sessions that have each field (rounded to 2 places). */
export function fieldCoverage(sessions) {
  const out = {};
  if (!sessions.length) return out;
  for (const f of FIELDS) {
    const n = sessions.filter((s) => s[f] != null && s[f] !== '').length;
    out[f] = Math.round((n / sessions.length) * 100) / 100;
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Compare one scrape with the stored health and return { health, findings, fresh }.
 *
 * - `prev`: data/health.json from the last run ({ sources: {}, manual: {} }).
 * - `results`: per-source run results: { id, ok, count, warnings, sessions, shape, reads,
 *    contentHash } when ok, { id, ok: false, error } when the scrape failed.
 * - `manual`: hand-checked sessions after the watcher ran (sourceChanged / watchError set).
 * - `ref`: today's date (YYYY-MM-DD).
 *
 * `findings` is everything wrong right now; `fresh` is the subset not reported before (what
 * goes in the issue). The returned `health` is what to store for next time.
 */
export function assessHealth({ prev = {}, results = [], manual = [], ref }) {
  const findings = [];
  const health = { sources: {}, manual: {} };

  for (const r of results) {
    const before = prev.sources?.[r.id] ?? {};
    const add = (key, kind, message) => findings.push({ key: `${r.id}:${key}`, source: r.id, kind, message });

    if (!r.ok) {
      // A failed run says nothing about drift: keep the baseline, and keep its reported keys
      // so the same drift isn't reported again after the source comes back. Count the streak.
      const failStreak = (before.failStreak ?? 0) + 1;
      health.sources[r.id] = { ...before, failStreak };
      if (failStreak >= FAIL_STREAK) {
        add('failing', 'failing', `has failed ${failStreak} scrapes in a row (${r.error ?? 'unknown error'}). Its last good sessions are still shown, marked "Couldn't recheck".`);
      }
      continue;
    }

    const counts = before.counts ?? [];
    const usual = median(counts);
    if (usual != null && usual >= MIN_USUAL_COUNT && r.count <= Math.floor(usual / COUNT_DROP)) {
      add('count', 'count', `returned ${r.count} sessions; it usually returns about ${usual}. Something may have changed upstream (a renamed class, a page that stopped listing events).`);
    }

    const coverage = fieldCoverage(r.sessions ?? []);
    for (const f of FIELDS) {
      const was = before.coverage?.[f];
      if (was >= FIELD_USUAL && (before.sessions ?? 0) >= FIELD_MIN_SESSIONS && r.count >= FIELD_MIN_SESSIONS && coverage[f] === 0) {
        add(`field:${f}`, 'fields', `no session has \`${f}\` any more (${Math.round(was * 100)}% did last run). The source may have renamed or dropped the field.`);
      }
    }

    if (r.shape && before.shape?.length) {
      const now = new Set(r.shape), had = new Set(before.shape);
      const missing = (r.reads ?? []).filter((p) => had.has(p) && !now.has(p));
      if (missing.length) {
        const added = r.shape.filter((p) => !had.has(p));
        add(`shape:${missing.join(',')}`, 'shape',
          `the raw data no longer has ${missing.map((p) => `\`${p}\``).join(', ')}, which the adapter reads.`
          + (added.length ? ` New keys: ${added.slice(0, 12).map((p) => `\`${p}\``).join(', ')}${added.length > 12 ? ', …' : ''}.` : ''));
      }
    }

    if (r.contentHash && before.contentHash && r.contentHash !== before.contentHash) {
      add(`content:${r.contentHash}`, 'content', 'the page it reads changed. The scrape still parsed it, but check the details the adapter fills in itself (prices, notes, labels).');
    }

    for (const w of r.warnings ?? []) add(`warning:${w}`, 'warning', w);

    health.sources[r.id] = {
      counts: [...counts, r.count].slice(-HISTORY),
      sessions: r.count,
      coverage,
      ...(r.shape ? { shape: r.shape } : before.shape ? { shape: before.shape } : {}),
      ...(r.contentHash ? { contentHash: r.contentHash } : {}),
    };
  }

  const stale = addDays(ref, -MANUAL_STALE_DAYS);
  for (const m of manual) {
    const add = (key, message) => findings.push({ key: `manual:${m.id}:${key}`, source: 'manual', kind: 'manual', message: `${m.id}: ${message}` });
    if (m.sourceChanged) add(`changed:${m.sourceChanged}`, `its source page changed on ${m.sourceChanged}. Re-check it and update \`verifiedAt\` in data/manual.json (${m.source}).`);
    if (m.watchError) add('watch', `its source page can't be watched (${m.watchError}), so changes won't be noticed (${m.source}).`);
    if (!m.verifiedAt) add('unverified', 'has no `verifiedAt`. Check it and set the date.');
    else if (m.verifiedAt < stale) add(`stale:${m.verifiedAt}`, `last verified ${m.verifiedAt}, over ${MANUAL_STALE_DAYS} days ago.`);
  }

  // Report each finding once; forget keys whose problem has cleared.
  const reported = new Set(prev.reported ?? []);
  const fresh = findings.filter((f) => !reported.has(f.key));
  // A failed source's previously reported keys stay remembered (its drift can't be judged today).
  const failedIds = new Set(results.filter((r) => !r.ok).map((r) => r.id));
  health.reported = [...new Set([
    ...findings.map((f) => f.key),
    ...[...reported].filter((k) => failedIds.has(k.split(':')[0])),
  ])].sort();

  return { health, findings, fresh };
}

const KIND_LABEL = {
  failing: 'Failing repeatedly',
  count: 'Fewer sessions than usual',
  fields: 'Field disappeared',
  shape: 'API data changed shape',
  content: 'Page changed',
  warning: 'New warning',
  manual: 'Hand-checked session',
};

/** Markdown for the "source changed" issue, or '' when nothing is new. */
export function findingsMarkdown(fresh, ref) {
  if (!fresh.length) return '';
  const lines = fresh.map((f) => `- **${f.source}** · ${KIND_LABEL[f.kind] ?? f.kind}: ${f.message}`);
  return `Source changes noticed on ${ref}:\n\n${lines.join('\n')}\n\n`
    + 'The scrape still published, so these may already be wrong on the site. Each is reported once; '
    + 'fix the adapter, config/sources.json or data/manual.json, then close this issue.';
}

/** Findings an auto-fix can be verified against: a live re-run shows them gone or not. */
export const VERIFIABLE_KINDS = ['failing', 'count', 'fields', 'shape', 'warning'];

/**
 * Decide whether an auto-fix can merge without review, from a live scrape run with the fixed
 * code against the health baseline from *before* the source changed (`baseline`).
 *
 * - `batch`: the findings the fix was made for (the scrape-changes.json of the run that found them).
 * - `baselineSources`: per-source status (schedule.json `sources`) from before the change.
 * - `verify`: { sources, findings } from the live re-run.
 *
 * Mergeable only when every source the batch was about scrapes again with none of its findings
 * left, nothing that worked before fails now, no source has a new verifiable finding (the fix
 * may touch shared code), and the batch has no page-changed findings (whether a new price or
 * label is right needs a person). Hand-checked session findings never come from code changes,
 * so they neither block nor count.
 */
export function judgeFix({ batch = [], baseline = {}, baselineSources = [], verify }) {
  const reasons = [];
  for (const f of batch.filter((x) => x.kind === 'content')) {
    reasons.push(`${f.source}: its page changed, and whether the new details are right needs a person`);
  }
  const targeted = new Set(batch.filter((f) => VERIFIABLE_KINDS.includes(f.kind)).map((f) => f.source));
  if (!targeted.size) reasons.push('nothing in this batch can be verified automatically');
  const status = Object.fromEntries((verify.sources ?? []).map((s) => [s.id, s]));
  for (const id of targeted) {
    if (!status[id]?.ok) reasons.push(`${id} still fails: ${status[id]?.error ?? 'not run'}`);
  }
  for (const s of baselineSources) {
    if (s.ok && status[s.id] && !status[s.id].ok) reasons.push(`${s.id} worked before the change and fails now: ${status[s.id].error}`);
  }
  const known = new Set(baseline.reported ?? []);
  for (const f of verify.findings ?? []) {
    if (VERIFIABLE_KINDS.includes(f.kind) && !known.has(f.key) && status[f.source]?.ok !== false) {
      reasons.push(`${f.source} · ${KIND_LABEL[f.kind] ?? f.kind}: ${f.message}`);
    }
  }
  return { mergeable: reasons.length === 0, reasons };
}
