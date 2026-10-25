// Push the latest schedule into vteam's `external_sessions` table.
//
//   npm run sync:vteam   (macOS, Linux and Windows alike)
//
// Reads VTEAM_SUPABASE_URL and VTEAM_SERVICE_ROLE_KEY from the environment or a
// .env file at the repo root (see .env.example).
//
// Upserts every session from today through the next 4 weeks, then deletes
// future rows this run didn't touch (cancelled or removed at the source).
// Skips quietly when the env vars aren't set, so forks and local runs still work.
import { readFile } from 'node:fs/promises';
import { toVteamRows } from '../lib/vteam-rows.js';
import { loadEnv, repoPath } from '../lib/paths.js';

loadEnv();

const url = process.env.VTEAM_SUPABASE_URL;
const key = process.env.VTEAM_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log('sync-vteam: VTEAM_SUPABASE_URL / VTEAM_SERVICE_ROLE_KEY not set, skipping');
  process.exit(0);
}

const schedule = JSON.parse(await readFile(repoPath('public/data/schedule.json'), 'utf8'));
const runStartedAt = new Date().toISOString();
const rows = toVteamRows(schedule.sessions ?? []).map((r) => ({ ...r, updated_at: runStartedAt }));

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function call(method, path, body, extra = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, ...extra }, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
}

if (rows.length) {
  await call('POST', 'external_sessions?on_conflict=id', rows, { Prefer: 'resolution=merge-duplicates,return=minimal' });
}
// Anything still upcoming that this run didn't write is gone from the source.
await call('DELETE', `external_sessions?updated_at=lt.${encodeURIComponent(runStartedAt)}&starts_at=gte.${encodeURIComponent(runStartedAt)}`, null, { Prefer: 'return=minimal' });
console.log(`sync-vteam: upserted ${rows.length} sessions`);
