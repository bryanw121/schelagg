// Nightly: scrape every source, merge with hand-checked sessions, write public/data/schedule.json.
// A source that fails keeps yesterday's sessions but is flagged so the UI shows "Couldn't recheck".
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { today, addDays } from '../lib/time.js';
import * as volleyworld from './sources/volleyworld.mjs';
import * as aces from './sources/aces.mjs';
import * as atxbeach from './sources/atxbeach.mjs';
import * as velocity from './sources/velocity.mjs';

const SCRAPERS = [volleyworld, aces, atxbeach, velocity];
const OUT = 'public/data/schedule.json';
const WATCH = 'data/watch.json';
const HORIZON_DAYS = 14;

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const ref = today();
const prev = await readJson(OUT, { sessions: [], sources: [] });
const manual = (await readJson('data/manual.json', { sessions: [] })).sessions;
const publicCourts = await readJson('data/public-courts.json', null);
const watch = await readJson(WATCH, {});

const browser = await chromium.launch();
const sources = [];
let sessions = [];

for (const s of SCRAPERS) {
  const checkedAt = new Date().toISOString();
  try {
    const r = await s.scrape({ browser, ref });
    sessions.push(...r.sessions.map((x) => ({ ...x, sourceId: s.id, verifiedAt: ref })));
    sources.push({ id: s.id, ok: true, checkedAt, count: r.sessions.length, warnings: r.warnings?.length ? r.warnings : undefined });
    console.log(`ok    ${s.id}: ${r.sessions.length} sessions`);
  } catch (e) {
    const kept = prev.sessions.filter((x) => x.sourceId === s.id).map((x) => ({ ...x, checkFailed: ref }));
    sessions.push(...kept);
    sources.push({ id: s.id, ok: false, checkedAt, error: e.message, kept: kept.length });
    console.log(`FAIL  ${s.id}: ${e.message} (kept ${kept.length} from last run)`);
  }
}
await browser.close();

// Hand-checked sessions: watch their source pages and flag them when a page changes.
for (const m of manual) {
  const entry = { ...m, sourceId: 'manual' };
  if (m.source) {
    try {
      const res = await fetch(m.source, { headers: { 'user-agent': 'Mozilla/5.0 (VolleyATX schedule checker)' }, signal: AbortSignal.timeout(20000) });
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

const out = { generatedAt: new Date().toISOString(), sources, sessions, publicCourts };
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
await writeFile(WATCH, JSON.stringify(watch, null, 2) + '\n');

// Summary for GitHub Actions, and a failures file the workflow turns into an issue.
const failed = sources.filter((s) => !s.ok);
const lines = sources.map((s) => `- ${s.ok ? '✅' : '❌'} **${s.id}** ${s.ok ? `${s.count} sessions` : s.error}`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Schedule scrape ${ref}\n${lines.join('\n')}\n`);
await writeFile('scrape-failures.md', failed.length ? `Sources that failed on ${ref}:\n\n${lines.filter((l) => l.includes('❌')).join('\n')}\n\nTheir last good sessions are still shown, flagged "Couldn't recheck".` : '');
console.log(`wrote ${OUT}: ${sessions.length} sessions, ${failed.length} failed sources`);
