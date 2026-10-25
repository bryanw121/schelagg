// Scrape every configured source (config/sources.json), merge in hand-checked sessions,
// validate, and write public/data/schedule.json. A source that fails keeps its last good
// sessions, flagged so the UI shows "Couldn't recheck".
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { today, addDays } from '../lib/time.js';
import { repoPath } from '../lib/paths.js';
import { loadSources } from '../lib/registry.js';
import { SCHEMA_VERSION, tagSession, validateSessions } from '../lib/session.js';
import { FEED_VERSION, toOccurrences } from '../lib/occurrences.js';

const { sources: SOURCES, manual: MANUAL } = loadSources();
const OUT = repoPath('public/data/schedule.json');
const FEED = repoPath('public/data/occurrences.json');
const FEED_HORIZON_DAYS = 28;
const WATCH = repoPath('data/watch.json');
const HORIZON_DAYS = 14;

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const ref = today();
const prev = await readJson(OUT, { sessions: [], sources: [] });
const manual = MANUAL ? (await readJson(repoPath(MANUAL.file), { sessions: [] })).sessions : [];
const publicCourts = await readJson(repoPath('data/public-courts.json'), null);
const watch = await readJson(WATCH, {});

const browser = await chromium.launch();
const sources = [];
let sessions = [];

for (const s of SOURCES) {
  const checkedAt = new Date().toISOString();
  const srcRef = today(new Date(), s.timezone);
  try {
    const r = await s.adapter.scrape({ browser, ref: srcRef, options: s.options });
    const { ok, warnings } = validateSessions(r.sessions.map((x) => ({ ...tagSession(x, s), verifiedAt: srcRef })));
    sessions.push(...ok);
    const allWarnings = [...(r.warnings ?? []), ...warnings];
    sources.push({ id: s.id, sport: s.sport, region: s.region, ok: true, checkedAt, count: ok.length, warnings: allWarnings.length ? allWarnings : undefined });
    console.log(`ok    ${s.id}: ${ok.length} sessions${warnings.length ? ` (${warnings.length} warnings)` : ''}`);
  } catch (e) {
    const kept = prev.sessions.filter((x) => x.sourceId === s.id).map((x) => ({ ...tagSession(x, s), checkFailed: srcRef }));
    sessions.push(...kept);
    sources.push({ id: s.id, sport: s.sport, region: s.region, ok: false, checkedAt, error: e.message, kept: kept.length });
    console.log(`FAIL  ${s.id}: ${e.message} (kept ${kept.length} from last run)`);
  }
}
await browser.close();

// Hand-checked sessions: watch their source pages and flag them when a page changes.
for (const m of manual) {
  const entry = tagSession(m, MANUAL);
  if (m.source) {
    try {
      const res = await fetch(m.source, { headers: { 'user-agent': 'Mozilla/5.0 (Schelagg schedule checker)' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
      const w = (watch[m.source] ||= { hash, changedOn: null });
      if (w.hash !== hash) { w.hash = hash; w.changedOn = ref; }
      if (w.changedOn && (!m.verifiedAt || w.changedOn > m.verifiedAt)) entry.sourceChanged = w.changedOn;
    } catch (e) {
      entry.watchError = e.message; // can't watch it; freshness falls back to verifiedAt age
    }
  }
  sessions.push(entry);
}

// Keep dated sessions from today through the horizon.
const horizon = addDays(ref, HORIZON_DAYS);
sessions = sessions.filter((x) => !x.date || (x.date >= ref && x.date <= horizon));
// Manual entries are hand-written, so they go through the same checks.
const checked = validateSessions(sessions);
if (checked.warnings.length) console.log(checked.warnings.map((w) => `warn  ${w}`).join('\n'));
sessions = checked.ok;

const out = { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), sources, sessions, publicCourts };
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
// The public feed consumers read (vteam pulls this). Every sport and region; consumers filter.
const occurrences = toOccurrences(sessions, { horizonDays: FEED_HORIZON_DAYS });
await writeFile(FEED, JSON.stringify({ feedVersion: FEED_VERSION, generatedAt: out.generatedAt, horizonDays: FEED_HORIZON_DAYS, occurrences }, null, 2) + '\n');
await writeFile(WATCH, JSON.stringify(watch, null, 2) + '\n');

// Summary for GitHub Actions, and a failures file the workflow turns into an issue.
const failed = sources.filter((s) => !s.ok);
const lines = sources.map((s) => `- ${s.ok ? '✅' : '❌'} **${s.id}** ${s.ok ? `${s.count} sessions` : s.error}`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Schedule scrape ${ref}\n${lines.join('\n')}\n`);
await writeFile(repoPath('scrape-failures.md'), failed.length ? `Sources that failed on ${ref}:\n\n${lines.filter((l) => l.includes('❌')).join('\n')}\n\nTheir last good sessions are still shown, flagged "Couldn't recheck".` : '');
console.log(`wrote ${OUT}: ${sessions.length} sessions, ${failed.length} failed sources`);
