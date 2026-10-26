// Live re-check of one published session, for consumers that want to confirm a session
// at the moment someone taps "Sign up" (api/check.js serves this). Adapters with a fast
// source export check(); everything else answers 'unknown'.
//
// Ids are checked against a strict pattern and must belong to a configured source, and
// adapters only ever request their own fixed hosts: nothing from the request is fetched as a URL.
import { readFile } from 'node:fs/promises';
import { repoPath } from './paths.js';
import { tagSession } from './session.js';
import { toOccurrences } from './occurrences.js';

export const STATUSES = ['scheduled', 'canceled', 'changed', 'gone', 'unknown'];
/** Session ids (and feed occurrence ids) are short slugs; ':' appears in times (volleyworld-...-19:30-...). */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{2,99}$/;
export const CHECK_TIMEOUT_MS = 4000;

/**
 * Which configured source an id belongs to: its published session's sourceId if we have it,
 * else the longest configured source id that prefixes it ("reclub-ABC123" -> reclub).
 * Returns { source, expected } or null.
 */
export function resolveSource(sessionId, sources, published = new Map()) {
  const expected = published.get(sessionId) ?? null;
  if (expected?.sourceId) {
    const source = sources.find((s) => s.id === expected.sourceId);
    if (source) return { source, expected };
    return { source: { id: expected.sourceId, adapter: {} }, expected }; // e.g. manual: no adapter to ask
  }
  const source = sources.filter((s) => sessionId.startsWith(`${s.id}-`)).sort((a, b) => b.id.length - a.id.length)[0];
  return source ? { source, expected: null } : null;
}

const withTimeout = (promise, ms, controller) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(Object.assign(new Error('timeout'), { timeout: true })); controller.abort(); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Check one session. Returns { httpStatus, body }:
 *   400 for an id that's malformed or belongs to no configured source,
 *   200 with body.status in STATUSES otherwise (errors and timeouts are 'unknown' with `error`).
 */
export async function runCheck(sessionId, { sources, published = new Map(), now = new Date(), timeoutMs = CHECK_TIMEOUT_MS, fetch } = {}) {
  const checkedAt = now.toISOString();
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    return { httpStatus: 400, body: { error: 'session must be a session id like "reclub-ABC123"' } };
  }
  const found = resolveSource(sessionId, sources, published);
  if (!found) return { httpStatus: 400, body: { error: 'unknown session id', id: sessionId } };
  const { source, expected } = found;
  const base = { id: sessionId, sourceId: source.id, published: !!expected };
  const adapter = source.adapter ?? {};
  if (typeof adapter.check !== 'function') {
    return { httpStatus: 200, body: { ...base, status: 'unknown', checkedAt } };
  }
  if (typeof adapter.parseId === 'function' && !adapter.parseId(sessionId)) {
    return { httpStatus: 400, body: { error: `not a ${source.id} session id`, id: sessionId } };
  }
  const controller = new AbortController();
  try {
    const r = await withTimeout(adapter.check({
      sessionId, options: source.options ?? {}, timezone: source.timezone, expected, now, fetch, signal: controller.signal,
    }), timeoutMs, controller);
    const status = STATUSES.includes(r?.status) ? r.status : 'unknown';
    const body = { ...base, status, checkedAt: r?.checkedAt ?? checkedAt };
    if (r?.changes?.length) body.changes = r.changes;
    if (r?.session) {
      body.session = source.sport ? tagSession(r.session, source) : r.session;
      body.occurrence = source.sport ? toOccurrences([body.session], { now, horizonDays: 60 })[0] ?? null : null;
    }
    return { httpStatus: 200, body };
  } catch (e) {
    if (e instanceof RangeError) return { httpStatus: 400, body: { error: e.message, id: sessionId } };
    return { httpStatus: 200, body: { ...base, status: 'unknown', checkedAt, error: e.timeout ? 'timeout' : 'source unavailable' } };
  }
}

/**
 * Where the live API reads the latest published schedule. Vercel does not
 * redeploy for data-only commits (vercel.json ignoreCommand), so the copy
 * bundled with the function can be hours old; the GitHub Pages copy is current.
 */
export const PUBLISHED_URL = 'https://bryanw121.github.io/schelagg/data/schedule.json';

const toMap = ({ sessions = [] } = {}) => new Map(sessions.map((s) => [s.id, s]));

/**
 * Published sessions by id, from the last scrape: the GitHub Pages copy when it
 * answers within 3s, else the copy bundled with the function
 * (public/data/schedule.json). Never throws; an empty Map when neither loads.
 */
export async function loadPublished({ path = repoPath('public/data/schedule.json'), url = PUBLISHED_URL, fetch = globalThis.fetch, timeoutMs = 3000 } = {}) {
  if (url && fetch) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.sessions)) return toMap(json);
      }
    } catch { /* fall back to the bundled copy */ }
  }
  try {
    return toMap(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return new Map();
  }
}
