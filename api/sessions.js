// GET /api/sessions?sport=&region=&from=YYYY-MM-DD&to=YYYY-MM-DD -> dated occurrences, the same
// objects as occurrences.json, for one window. Reads Schelagg's database through the read-only
// role (DATABASE_URL_READONLY); without it, or when the database fails or has no runs yet, it
// filters the published feed (GitHub Pages, then the copy bundled with the function).
// Runs as a Vercel serverless function; also mounted by server.js for local dev. See README.
import { readFile } from 'node:fs/promises';
import { repoPath } from '../lib/paths.js';
import { today, addDays, daysBetween } from '../lib/time.js';
import { FEED_VERSION, filterOccurrences } from '../lib/occurrences.js';
import { lazyDb, queryOccurrences, redact } from '../lib/db.js';

/** The published feed on GitHub Pages (the fallback). */
export const FEED_URL = 'https://bryanw121.github.io/schelagg/data/occurrences.json';
/** Longest window one request may ask for, in days (from and to inclusive). */
export const MAX_DAYS = 60;
/** Window when `to` is left out: today plus the feed's horizon. */
export const DEFAULT_DAYS = 28;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d) => DATE.test(d) && addDays(d, 0) === d; // rejects 2026-02-30
const OK_CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=120';

/**
 * Validate the query. Returns { sport, region, from, to } (sport/region null = any) or { error }.
 * `from` defaults to today (Austin time); `to` to `from` + DEFAULT_DAYS.
 */
export function parseQuery(params, now = new Date()) {
  const q = {};
  for (const k of ['sport', 'region']) {
    const v = params.get(k);
    if (v == null || v === '') { q[k] = null; continue; }
    if (!SLUG.test(v)) return { error: `${k} must be a lowercase slug like "volleyball"` };
    q[k] = v;
  }
  for (const k of ['from', 'to']) {
    const v = params.get(k);
    if (v != null && v !== '' && !realDate(v)) return { error: `${k} must be a date like 2026-10-25` };
    q[k] = v || null;
  }
  q.from ??= today(now);
  q.to ??= addDays(q.from, DEFAULT_DAYS);
  const days = daysBetween(q.from, q.to) + 1;
  if (days < 1) return { error: 'to must not be before from' };
  if (days > MAX_DAYS) return { error: `at most ${MAX_DAYS} days per request` };
  return q;
}

/**
 * Build a handler. Tests pass `db` (a lib/db.js handle, or null for "no database"), a stub
 * `fetch`, a clock and where the bundled feed is. Without `db`, DATABASE_URL_READONLY decides.
 */
export function createHandler({ db, fetch, now = () => new Date(), feedUrl = FEED_URL, bundled = repoPath('public/data/occurrences.json'), log = console.warn } = {}) {
  const getDb = lazyDb(db);

  /** { generatedAt, occurrences, via } from the database, or null to fall back. */
  async function fromDb(q) {
    try {
      const d = await getDb();
      if (!d) return null;
      const r = await queryOccurrences(d, q);
      return r.generatedAt ? { ...r, via: 'db' } : null; // no run written yet
    } catch (e) {
      log(`api/sessions: database read failed, serving the published feed: ${redact(e?.message ?? e)}`);
      return null;
    }
  }

  /** The published feed (Pages, then the bundled copy), filtered; null when neither loads. */
  async function fromFeed(q) {
    const f = fetch ?? globalThis.fetch;
    const attempts = [
      ['feed', async () => {
        const res = await f(feedUrl, { signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } });
        return res.ok ? res.json() : null;
      }],
      ['bundled', async () => JSON.parse(await readFile(bundled, 'utf8'))],
    ];
    for (const [via, load] of attempts) {
      try {
        const body = await load();
        if (Array.isArray(body?.occurrences)) return { generatedAt: body.generatedAt ?? null, occurrences: filterOccurrences(body.occurrences, q), via };
      } catch { /* next */ }
    }
    return null;
  }

  return async function handler(req, res) {
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('access-control-allow-methods', 'GET');
      res.setHeader('access-control-max-age', '86400');
      return res.end();
    }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET');
      return res.end(JSON.stringify({ error: 'GET only' }));
    }
    const send = (status, body, cache = OK_CACHE) => {
      res.statusCode = status;
      res.setHeader('cache-control', cache);
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    };

    const q = parseQuery(new URL(req.url, 'http://local').searchParams, now());
    if (q.error) return send(400, { error: q.error });

    const r = (await fromDb(q)) ?? (await fromFeed(q));
    if (!r) return send(503, { error: 'schedule unavailable' }, 'public, s-maxage=5');
    res.setHeader('x-schelagg-source', r.via);
    send(200, {
      feedVersion: FEED_VERSION, generatedAt: r.generatedAt,
      from: q.from, to: q.to, sport: q.sport, region: q.region,
      occurrences: r.occurrences,
    });
  };
}

export default createHandler();
