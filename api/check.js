// GET /api/check?session=<id> -> is this session still on, right now, at its source?
// For consumers to re-check one session when someone taps "Sign up". Runs as a Vercel
// serverless function; also mounted by server.js for local dev. See README "Live API".
import { loadSources } from '../lib/registry.js';
import { CHECK_TIMEOUT_MS, loadPublished, runCheck } from '../lib/check.js';

const PUBLISHED_TTL_MS = 60 * 1000;

/** Build a handler; tests pass stub sources / published sessions. */
export function createHandler({ sources, published, timeoutMs = CHECK_TIMEOUT_MS, fetch, now } = {}) {
  let cfg = sources ?? null;
  let pub = published ? { at: Infinity, map: published } : null;
  const getSources = () => (cfg ??= loadSources().sources);
  const getPublished = async () => {
    if (!pub || Date.now() - pub.at > PUBLISHED_TTL_MS) pub = { at: Date.now(), map: await loadPublished() };
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
