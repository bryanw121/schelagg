// programs.json: every league and tournament open for sign-up, from every reader in
// config/programs.json. Built twice a day (scripts/programs.mjs). A reader that fails keeps its
// last good programs, so one broken site never empties the feed; rows whose sign-up deadline or
// last day has passed are dropped at every build, kept or fresh.
import { dateIn } from './common.js';
import * as aces from './aces.js';
import * as leaguelab from './leaguelab.js';
import * as nagva from './nagva.js';
import * as reclub from './reclub.js';
import * as texasao from './texasao.js';

export const FEED_VERSION = 1;
export const READERS = { aces, leaguelab, nagva, reclub, texasao };
/** How long after the last build the next one is due (twice a day, with slack for late runs). */
export const DUE_AFTER_MS = 11 * 3600e3;

/** Fields every published program has; a reader's row without one is dropped (and counted) rather than published. */
export const REQUIRED = ['id', 'kind', 'sport', 'org', 'title', 'source_id'];
const complete = (p) => REQUIRED.every((k) => typeof p[k] === 'string' && p[k] !== '');

/** Whether a program can still be signed up for (or is still running) on `today`. */
export const current = (p, today) => !(p.ends_on && p.ends_on < today) && !(p.registration_deadline && p.registration_deadline < today);

/** Deadline first (soonest), then start date, then title. */
const order = (a, b) => (a.registration_deadline ?? '9999').localeCompare(b.registration_deadline ?? '9999')
  || (a.starts_on ?? '9999').localeCompare(b.starts_on ?? '9999') || a.title.localeCompare(b.title);

/**
 * The new feed from this run's results and the previous feed. `results`: [{ id, programs } | { id, error }]
 * (one per configured source id). Failed sources keep the previous run's programs for that source.
 */
export function buildFeed({ results, previous = null, now = Date.now(), tz = 'America/Chicago' }) {
  const today = dateIn(now, tz);
  const at = new Date(now).toISOString();
  const prevSources = new Map((previous?.sources ?? []).map((s) => [s.id, s]));
  const prevPrograms = previous?.programs ?? [];
  const sources = [], programs = [];
  for (const r of results) {
    if (r.error) {
      const before = prevSources.get(r.id);
      // Kept as they were, except a price whose last day has passed: what it is now isn't known.
      const kept = prevPrograms.filter((p) => p.feed_source === r.id)
        .map((p) => (p.price_changes_on && p.price_changes_on < today ? { ...p, price_note: null, price_changes_on: null, team_price: null, individual_price: null } : p));
      sources.push({ id: r.id, ok: false, checkedAt: before?.checkedAt ?? null, failedAt: at, count: kept.length, error: String(r.error).slice(0, 300) });
      programs.push(...kept);
    } else {
      const good = r.programs.filter(complete);
      sources.push({ id: r.id, ok: true, checkedAt: at, count: good.length, ...(good.length < r.programs.length ? { dropped: r.programs.length - good.length } : {}) });
      programs.push(...good.map((p) => ({ ...p, feed_source: r.id, checked_at: at })));
    }
  }
  const seen = new Set();
  const out = programs.filter((p) => current(p, today) && !seen.has(p.id) && seen.add(p.id)).sort(order);
  for (const s of sources) s.count = out.filter((p) => p.feed_source === s.id).length;
  return { feedVersion: FEED_VERSION, generatedAt: at, sources, programs: out };
}

/** Whether a build is due: no previous feed, or the last one is older than DUE_AFTER_MS. */
export function isDue(previous, now = Date.now()) {
  const t = Date.parse(previous?.generatedAt ?? '');
  return !Number.isFinite(t) || now - t >= DUE_AFTER_MS || previous?.feedVersion !== FEED_VERSION;
}

/** Run every configured source. `config.sources`: [{ id, reader, options }]. */
export async function runSources(config, { get, now = Date.now(), tz = 'America/Chicago', regions = [] }) {
  const results = [];
  for (const s of config.sources) {
    const reader = READERS[s.reader];
    try {
      if (!reader) throw new Error(`no reader "${s.reader}"`);
      const programs = await reader.read({ get, now, tz, regions, options: s.options ?? {} });
      results.push({ id: s.id, programs });
    } catch (e) {
      results.push({ id: s.id, error: e?.message ?? String(e) });
    }
  }
  return results;
}
