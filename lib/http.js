// Plain HTTP for adapters that read a public API or server-rendered page (no browser).
export const USER_AGENT = 'Mozilla/5.0 (compatible; Schelagg/0.4; +https://github.com/bryanw121/schelagg)';

/**
 * GET a URL and return { status, ok, text }. `fetch` can be swapped in tests; `signal`
 * lets a caller (the live check API) cut the request short; otherwise `timeoutMs` applies.
 */
export async function get(url, { fetch: f = globalThis.fetch, signal, timeoutMs = 30000, headers = {} } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await f(url, {
    headers: { 'user-agent': USER_AGENT, ...headers },
    redirect: 'follow',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
}
