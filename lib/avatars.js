// Organizers' profile pictures for the Events tab: a small copy of each under
// public/data/avatars/<handle>.jpg with an index (Instagram's own picture links expire), and
// `avatar` / `account` stamped on every event the feed credits to that account.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { handleOf, isHandle } from './instagram.js';

const MAX_BYTES = 400 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Download each profile's picture into `dir`; returns how many were saved. */
export async function saveAvatars(profiles, dir, { now = Date.now(), fetch: f = globalThis.fetch } = {}) {
  mkdirSync(dir, { recursive: true });
  const indexPath = `${dir}/index.json`;
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
  let saved = 0;
  for (const [handle, p] of Object.entries(profiles)) {
    if (!isHandle(handle) || !/^https:\/\//.test(p.picture ?? '')) continue;
    try {
      const res = await f(p.picture, { signal: AbortSignal.timeout(20000) });
      const ext = TYPES[(res.headers.get('content-type') ?? '').split(';')[0].trim()];
      if (!res.ok || !ext) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES) continue;
      writeFileSync(`${dir}/${handle}.${ext}`, bytes);
      index[handle] = { file: `${handle}.${ext}`, name: p.name ?? null, fetchedAt: new Date(now).toISOString() };
      saved++;
    } catch { /* a picture that won't download is tried again next time */ }
  }
  writeFileSync(indexPath, `${JSON.stringify(index, null, 1)}\n`);
  return saved;
}

/** Put `account` and `avatar` (a path under data/) on each event credited to an account with a saved picture. */
export function stampAvatars(events, dir) {
  const indexPath = `${dir}/index.json`;
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
  for (const e of events) {
    const h = e.account ?? handleOf(e.source);
    if (h && index[h]) { e.account = h; e.avatar = `avatars/${index[h].file}`; } else delete e.avatar;
  }
  return events;
}
