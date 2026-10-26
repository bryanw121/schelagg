// GET /api/check?session=<id> -> is this session still on, right now, at its source?
// For consumers to re-check one session when someone taps "Sign up". Runs as a Vercel
// serverless function; also mounted by server.js for local dev. See README "Live API".
import { loadSources } from '../lib/registry.js';
import { CHECK_TIMEOUT_MS, loadPublished, runCheck } from '../lib/check.js';
import { lazyDb, loadPublishedFromDb, redact } from '../lib/db.js';

const PUBLISHED_TTL_MS = 60 * 1000;

/**
 * Published sessions from Schelagg's database (DATABASE_URL_READONLY), or null to fall back to
 * the published schedule.json (Pages, then the bundled copy): no database configured, a
 * database error, or no sessions written yet.
 */
async function publishedFromDb(getDb, log) {
  try {
    const db = await getDb();
    if (!db) return null;
    const map = await loadPublishedFromDb(db);
    return map.size ? map : null;
  } catch (e) {
    log(`api/check: database read failed, using the published schedule: ${redact(e?.message ?? e)}`);
    return null;
  }
}

/**
 * Build a handler; tests pass stub sources / published sessions, or `db` (a lib/db.js handle;
 * null for none) to load the published sessions from. Without either, DATABASE_URL_READONLY decides.
 */
export function createHandler({ sources, published, db, timeoutMs = CHECK_TIMEOUT_MS, fetch, now, log = console.warn } = {}) {
  let cfg = sources ?? null;
  let pub = published ? { at: Infinity, map: published } : null;
  const getSources = () => (cfg ??= loadSources().sources);
  const getDb = lazyDb(db);
  const getPublished = async () => {
    if (!pub || Date.now() - pub.at > PUBLISHED_TTL_MS) {
      const map = (await publishedFromDb(getDb, log)) ?? await loadPublished({ fetch: fetch ?? globalThis.fetch });
      pub = { at: Date.now(), map };
    }
    return pub.map;
  };

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
    const url = new URL(req.url, 'http://local');
    const { httpStatus, body } = await runCheck(url.searchParams.get('session'), {
      sources: getSources(), published: await getPublished(), timeoutMs, fetch, now: now?.() ?? new Date(),
    });
    res.statusCode = httpStatus;
    // CDN shares a result for a minute. A failed or timed-out check is only cached briefly.
    res.setHeader('cache-control', body.error && httpStatus === 200
      ? 'public, s-maxage=5'
      : 'public, s-maxage=60, stale-while-revalidate=120');
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
  };
}

export default createHandler();
