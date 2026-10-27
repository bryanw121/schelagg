// The two scheduled jobs as functions: runScrape (scripts/scrape.mjs) and buildCourts
// (scripts/build-courts.mjs). The scripts are thin wrappers that pass the real config,
// repo paths and network; tests pass fixture-backed fetch, a temp output dir and a fixed clock.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { today, addDays } from './time.js';
import { repoPath } from './paths.js';
import { SCHEMA_VERSION, tagSession, validateSessions } from './session.js';
import { FEED_VERSION, toOccurrences } from './occurrences.js';
import { VENUES, loadVenue } from './skedda.js';
import { assessHealth, findingsMarkdown } from './health.js';
import { loadVenues, resolveVenues, markMoves, dedupe } from './consolidate.js';
import { toIcs, CALENDAR_NAMES } from './ics.js';

export const HORIZON_DAYS = 14;
export const FEED_HORIZON_DAYS = 28;
export const COURT_DAYS = 14;

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };

/** Where runScrape reads and writes (repo paths unless overridden). */
export const scrapePaths = (overrides = {}) => ({
  out: repoPath('public/data/schedule.json'),
  feed: repoPath('public/data/occurrences.json'),
  watch: repoPath('data/watch.json'),
  publicCourts: repoPath('data/public-courts.json'),
  failures: repoPath('scrape-failures.md'),
  health: repoPath('data/health.json'),
  changes: repoPath('scrape-changes.md'),
  changesJson: repoPath('scrape-changes.json'),
  manualFile: (file) => repoPath(file),
  venues: repoPath('config/venues.json'),
  ...overrides,
});

const launchChromium = async () => (await import('playwright')).chromium.launch();

/**
 * Scrape every source, merge in hand-checked sessions, validate, and write schedule.json,
 * occurrences.json, watch.json, health.json and the failures/changes files. A source that
 * fails keeps its last good sessions, flagged checkFailed. Sources that still work but
 * changed what they send are reported through lib/health.js. Returns { out, feed, failed, findings, fresh }.
 *
 * `fetch` goes to the API/page adapters and the manual-page watcher; `launchBrowser` is
 * only called when some source declares it needs a browser; `now` is a clock.
 */
export async function runScrape({
  sources, manual = null, paths = scrapePaths(), fetch = globalThis.fetch,
  launchBrowser = launchChromium, now = () => new Date(), log = console.log, summaryFile,
} = {}) {
  const ref = today(now());
  const prev = await readJson(paths.out, { sessions: [], sources: [] });
  const manualSessions = manual ? (await readJson(paths.manualFile(manual.file), { sessions: [] })).sessions : [];
  const publicCourts = await readJson(paths.publicCourts, null);
  const watch = await readJson(paths.watch, {});
  const prevHealth = await readJson(paths.health, {});

  // Only start Chromium when a configured source still needs a browser (adapters declare
  // `needsBrowser`); the API-backed ones (Volleyworld, Reclub) use plain fetch.
  const browser = sources.some((s) => s.adapter.needsBrowser !== false) ? await launchBrowser() : null;
  const results = [];
  const runs = []; // what lib/health.js compares run to run (not published)
  const manualEntries = [];
  let sessions = [];

  try {
    for (const s of sources) {
      const checkedAt = now().toISOString();
      const srcRef = today(now(), s.timezone);
      try {
        const r = await s.adapter.scrape({ browser, ref: srcRef, options: s.options, timezone: s.timezone, fetch });
        const { ok, warnings } = validateSessions(r.sessions.map((x) => ({ ...tagSession(x, s), verifiedAt: srcRef })));
        sessions.push(...ok);
        const allWarnings = [...(r.warnings ?? []), ...warnings];
        results.push({ id: s.id, name: s.name ?? s.id, sport: s.sport, region: s.region, ok: true, checkedAt, count: ok.length, warnings: allWarnings.length ? allWarnings : undefined });
        runs.push({ id: s.id, ok: true, count: ok.length, warnings: allWarnings, sessions: ok, shape: r.shape, reads: s.adapter.reads, contentHash: r.contentHash });
        log(`ok    ${s.id}: ${ok.length} sessions${warnings.length ? ` (${warnings.length} warnings)` : ''}`);
      } catch (e) {
        const kept = prev.sessions.filter((x) => x.sourceId === s.id).map((x) => ({ ...tagSession(x, s), checkFailed: srcRef }));
        sessions.push(...kept);
        results.push({ id: s.id, name: s.name ?? s.id, sport: s.sport, region: s.region, ok: false, checkedAt, error: e.message, kept: kept.length });
        runs.push({ id: s.id, ok: false, error: e.message });
        log(`FAIL  ${s.id}: ${e.message} (kept ${kept.length} from last run)`);
      }
    }
  } finally {
    await browser?.close();
  }

  // Hand-checked sessions: watch their source pages and flag them when a page changes.
  for (const m of manualSessions) {
    const entry = tagSession(m, manual);
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
    manualEntries.push(entry);
  }

  // Hand-written entries that fail the publish checks are dropped below; report them like a
  // source's warnings so a typo in manual.json doesn't silently remove a session.
  if (manual) {
    const { ok, warnings } = validateSessions(manualEntries);
    runs.push({ id: 'manual', ok: true, count: ok.length, warnings, sessions: ok });
  }

  // Keep dated sessions from today through the horizon.
  const horizon = addDays(ref, HORIZON_DAYS);
  sessions = sessions.filter((x) => !x.date || (x.date >= ref && x.date <= horizon));
  // Manual entries are hand-written, so they go through the same checks.
  const checked = validateSessions(sessions);
  if (checked.warnings.length) log(checked.warnings.map((w) => `warn  ${w}`).join('\n'));
  sessions = checked.ok;

  // Consolidate (lib/consolidate.js): canonical venues, moves, and one card per real session.
  const venues = loadVenues(paths.venues);
  const resolved = resolveVenues(sessions, venues);
  sessions = resolved.sessions;
  for (const [sourceId, names] of resolved.unknown) {
    const w = names.map((n) => `venue "${n}" isn't in config/venues.json`);
    const result = results.find((r) => r.id === sourceId);
    if (result) result.warnings = [...(result.warnings ?? []), ...w];
    const run = runs.find((r) => r.id === sourceId);
    if (run) run.warnings = [...(run.warnings ?? []), ...w];
    log(`warn  ${sourceId}: ${w.join('; ')}`);
  }
  sessions = markMoves(sessions, prev.sessions);
  const deduped = dedupe(sessions, [...sources.map((s) => s.id), 'manual']);
  sessions = deduped.sessions;
  if (deduped.merged.length) log(`merge ${deduped.merged.map((m) => `${m.dropped} -> ${m.kept}`).join(', ')}`);

  const generatedAt = now();
  const out = {
    schemaVersion: SCHEMA_VERSION, generatedAt: generatedAt.toISOString(), sources: results, sessions, publicCourts,
    venues: venues.map(({ id, name, city, parent }) => ({ id, name, city, ...(parent ? { parent } : {}) })),
    ...(deduped.merged.length ? { merged: deduped.merged } : {}),
  };
  await writeFile(paths.out, JSON.stringify(out, null, 2) + '\n');
  // The public feed consumers read (vteam pulls this). Every sport and region; consumers filter.
  const occurrences = toOccurrences(sessions, { now: generatedAt, horizonDays: FEED_HORIZON_DAYS });
  const feed = { feedVersion: FEED_VERSION, generatedAt: out.generatedAt, horizonDays: FEED_HORIZON_DAYS, occurrences };
  await writeFile(paths.feed, JSON.stringify(feed, null, 2) + '\n');
  // Calendar subscriptions, one per sport, next to the feed (public/data/<sport>.ics).
  const icsDir = paths.icsDir ?? dirname(paths.feed);
  for (const sport of [...new Set(sources.map((s) => s.sport))].sort()) {
    await writeFile(join(icsDir, `${sport}.ics`), toIcs(occurrences, { sport, name: CALENDAR_NAMES[sport] ?? sport, generatedAt: out.generatedAt }));
  }
  await writeFile(paths.watch, JSON.stringify(watch, null, 2) + '\n');

  // Summary for GitHub Actions, and a failures file the workflow turns into an issue.
  const failed = results.filter((s) => !s.ok);
  const lines = results.map((s) => `- ${s.ok ? '✅' : '❌'} **${s.id}** ${s.ok ? `${s.count} sessions` : s.error}`);
  if (summaryFile) await appendFile(summaryFile, `### Schedule scrape ${ref}\n${lines.join('\n')}\n`);
  await writeFile(paths.failures, failed.length ? `Sources that failed on ${ref}:\n\n${lines.filter((l) => l.includes('❌')).join('\n')}\n\nTheir last good sessions are still shown, flagged "Couldn't recheck".` : '');

  // Sources that still work but changed what they send: report each change once.
  const { health, findings, fresh } = assessHealth({ prev: prevHealth, results: runs, manual: manualEntries, ref });
  await writeFile(paths.health, JSON.stringify(health, null, 2) + '\n');
  const changes = findingsMarkdown(fresh, ref);
  await writeFile(paths.changes, changes);
  // The same new findings, machine-readable, for the auto-fix job.
  await writeFile(paths.changesJson, JSON.stringify(fresh, null, 2) + '\n');
  if (summaryFile && findings.length) {
    await appendFile(summaryFile, `\n#### Needs a look (${fresh.length} new)\n${findings.map((f) => `- ${fresh.includes(f) ? '🆕 ' : ''}**${f.source}**: ${f.message}`).join('\n')}\n`);
  }
  for (const f of fresh) log(`new   ${f.source}: ${f.message}`);
  log(`wrote ${paths.out}: ${sessions.length} sessions, ${failed.length} failed sources, ${fresh.length} new changes`);
  return { out, feed, failed, findings, fresh };
}

/**
 * Court calendars -> courts.json. A venue that fails keeps its last good copy (the local
 * file, else what `siteUrl` is serving) marked stale. Returns the written body; callers
 * treat `venues.length === 0` as a failed run.
 */
export async function buildCourts({
  venues = VENUES, out = repoPath('public/data/courts.json'), siteUrl, days = COURT_DAYS,
  fetch = globalThis.fetch, now = () => new Date(), log = console.log,
} = {}) {
  const from = today(now());
  // Last good copy: the local file if present, otherwise what the live site is serving.
  const prev = await readFile(out, 'utf8').then(JSON.parse).catch(async () => {
    if (!siteUrl) return null;
    try { const r = await fetch(new URL('data/courts.json', siteUrl.replace(/\/?$/, '/'))); return r.ok ? r.json() : null; }
    catch { return null; }
  });

  const results = await Promise.allSettled(venues.map((v) => loadVenue(v, from, days, { fetchImpl: fetch })));
  const ok = [], errors = [];
  results.forEach((r, i) => {
    const v = venues[i];
    if (r.status === 'fulfilled') {
      ok.push(r.value);
      const courts = r.value.facilities.flatMap((f) => f.courts);
      log(`ok    ${v.id}: ${courts.length} courts, ${courts.filter((c) => c.days[from]?.length).length} booked today`);
    } else {
      errors.push({ venue: v.id, calendar: v.calendar, message: r.reason?.message || String(r.reason) });
      const old = prev?.venues?.find((x) => x.id === v.id);
      if (old) ok.push({ ...old, stale: true });
      log(`FAIL  ${v.id}: ${r.reason?.message}${old ? ' (kept last good copy)' : ''}`);
    }
  });

  const body = { fetchedAt: now().toISOString(), from, days, venues: ok, errors };
  await writeFile(out, JSON.stringify(body) + '\n');
  return body;
}
