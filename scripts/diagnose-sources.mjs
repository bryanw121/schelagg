#!/usr/bin/env node
// Why does a source fail? Runs each named source's adapter once, from wherever this runs (the
// "Diagnose sources" workflow runs it on GitHub's runners, which reach sites this repo's
// development sandboxes can't), and prints only what is safe in a public log:
//   - every request: status, URL, content type and size (never the body)
//   - a network failure's underlying cause (TLS, DNS, reset), which "fetch failed" hides
//   - the adapter's result: session count, warnings, error
//   - sessions without a surface or venue: their id, venue name and city (public places)
//
//   node scripts/diagnose-sources.mjs <sourceId> [<sourceId> ...]
import { appendFileSync } from 'node:fs';
import { loadSources } from '../lib/registry.js';
import { today } from '../lib/time.js';

const ids = process.argv.slice(2).flatMap((a) => a.split(/[\s,]+/)).filter(Boolean);
const { sources } = loadSources();
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };

/** The deepest `cause` of a fetch error, e.g. "UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate". */
export function rootCause(e) {
  let c = e, seen = 0;
  while (c?.cause && seen++ < 5) c = c.cause;
  return [c?.code, c?.message].filter(Boolean).join(': ') || String(e?.message ?? e);
}

for (const id of ids) {
  const src = sources.find((s) => s.id === id);
  say(`## ${id}`);
  if (!src) { say(`no such source (known: ${sources.map((s) => s.id).join(', ')})`); continue; }
  const requests = [];
  const fetchLogged = async (url, init) => {
    try {
      const res = await fetch(url, init);
      const body = await res.text();
      requests.push(`${res.status} ${url} · ${res.headers.get('content-type') ?? '?'} · ${body.length} chars${res.headers.get('server') ? ` · server ${res.headers.get('server')}` : ''}`);
      return new Response(body, { status: res.status, headers: res.headers });
    } catch (e) {
      requests.push(`FAILED ${url} · ${rootCause(e)}`);
      throw e;
    }
  };
  try {
    if (src.adapter.needsBrowser !== false) { say('needs a browser; not run here'); continue; }
    const r = await src.adapter.scrape({ ref: today(new Date(), src.timezone), options: src.options, timezone: src.timezone, fetch: fetchLogged });
    say(`ok: ${r.sessions.length} sessions`);
    for (const w of r.warnings ?? []) say(`warning: ${w}`);
    for (const x of r.sessions.filter((x) => !x.surface || !x.venue)) say(`missing ${!x.venue ? 'venue' : 'surface'}: ${x.id} · ${x.venue ?? '?'} · ${x.city ?? '?'}`);
  } catch (e) {
    say(`error: ${e.message}${e.cause ? ` (cause: ${rootCause(e)})` : ''}`);
  }
  for (const r of requests.slice(0, 40)) say(`- ${r}`);
  if (requests.length > 40) say(`- … ${requests.length - 40} more`);
  say();
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
