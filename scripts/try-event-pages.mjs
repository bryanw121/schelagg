#!/usr/bin/env node
// Would this page work as an Events source? For each URL: does its site's robots.txt allow a
// general crawler to read it, and how many events does the listing reader (lib/event-sources.js)
// find on it? Nothing is written to the feed. A page that passes can be added to config/events.json.
//
//   node scripts/try-event-pages.mjs <url> [<url> ...]     try these pages
//   node scripts/try-event-pages.mjs                       try config/event-candidates.json
//
// The "Try event pages" workflow runs it on demand (GitHub's runners reach sites this repo's
// development sandboxes can't) and prints the table in the run summary.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { get } from '../lib/http.js';
import { repoPath } from '../lib/paths.js';
import { loadRegions } from '../lib/regions.js';
import { today as todayIn } from '../lib/time.js';
import { jsonLdEvents, toFeedEvent } from '../lib/event-sources.js';
import { robotsAllows } from '../lib/robots.js';

const args = process.argv.slice(2).flatMap((a) => a.split(/\s+/)).filter(Boolean);
const file = repoPath('config/event-candidates.json');
const urls = args.length ? args : existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).urls : [];
const today = todayIn(new Date());
const austin = loadRegions().map((r) => r.info).find((r) => r.id === 'austin');
const region = austin && { ...austin, city: austin.name.split(',')[0] };
const robots = new Map();
const rows = [];
for (const url of urls) {
  const row = { url, robots: '', page: '', listed: 0, kept: 0, sample: '', left: '' };
  rows.push(row);
  let u;
  try { u = new URL(url); } catch { row.page = 'not a URL'; continue; }
  if (!robots.has(u.origin)) {
    const r = await get(`${u.origin}/robots.txt`).catch((e) => ({ ok: false, status: e.message }));
    robots.set(u.origin, r.ok ? r.text : null); // a missing robots.txt disallows nothing
  }
  const allowed = robotsAllows(robots.get(u.origin), u.pathname + u.search);
  row.robots = robots.get(u.origin) == null ? 'none found' : allowed ? 'allowed' : 'DISALLOWED';
  if (!allowed) { row.page = 'not read'; continue; }
  const r = await get(url).catch((e) => ({ ok: false, status: e.message }));
  if (!r.ok) { row.page = `failed: ${r.status}`; continue; }
  const listed = jsonLdEvents(r.text);
  const kept = listed.map((o) => toFeedEvent(o, { source: u.hostname, region, today })).filter(Boolean);
  // What the reader left out (other kinds of event, or past ones): for judging whether its rules miss something.
  row.left = listed.filter((o) => !toFeedEvent(o, { source: u.hostname, region, today })).slice(0, 12).map((o) => String(o.name ?? '').slice(0, 60)).join('; ');
  Object.assign(row, { page: 'read', listed: listed.length, kept: kept.length, sample: kept.slice(0, 3).map((e) => `${e.startDate} ${e.title}`).join('; ') });
}
const md = ['| Page | robots.txt | Page | Events listed | Kept (pop-ups, markets, seasonal) | Examples | Left out (examples) |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.url} | ${r.robots} | ${r.page} | ${r.listed} | ${r.kept} | ${r.sample.replace(/\|/g, '/')} | ${r.left.replace(/\|/g, '/')} |`)].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Event pages tried\n\n${md}\n`);
