// Plain HTTP for adapters that read a public API or server-rendered page (no browser).
export const USER_AGENT = 'Mozilla/5.0 (compatible; Schelagg/0.4; +https://github.com/bryanw121/schelagg)';

// Politeness across sources (#52): requests to one host go one at a time, at least
// SCHELAGG_HOST_GAP_MS apart (the scrape workflow sets it; 0 in tests and local runs), however
// many regions and sources share that host. Different hosts run in parallel.
const hostQueues = new Map(); // host -> promise of the last request's turn
const hostGap = () => Math.max(0, Number(process.env.SCHELAGG_HOST_GAP_MS) || 0);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `task` when it's this host's turn. Exported for the manual-page watcher and tests. */
export function onHost(url, task) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return task(); }
  const prev = hostQueues.get(host) ?? Promise.resolve();
  const turn = prev.then(task);
  // The next request to this host waits for this one to settle, plus the gap.
  hostQueues.set(host, turn.catch(() => {}).then(() => pause(hostGap())));
  return turn;
}

/**
 * GET a URL and return { status, ok, text }. `fetch` can be swapped in tests; `signal`
 * lets a caller (the live check API) cut the request short; otherwise `timeoutMs` applies.
 * Requests to the same host are queued (onHost).
 */
export async function get(url, { fetch: f = globalThis.fetch, signal, timeoutMs = 30000, headers = {} } = {}) {
  return onHost(url, async () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await f(url, {
      headers: { 'user-agent': USER_AGENT, ...headers },
      redirect: 'follow',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return { status: res.status, ok: res.ok, text: await res.text() };
  });
}
