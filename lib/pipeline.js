// The two scheduled jobs as functions: runScrape (scripts/scrape.mjs) and buildCourts
// (scripts/build-courts.mjs). The scripts are thin wrappers that pass the real config,
// repo paths and network; tests pass fixture-backed fetch, a temp output dir and a fixed clock.
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { today, addDays } from './time.js';
import { repoPath } from './paths.js';
import { SCHEMA_VERSION, tagSession, validateSessions } from './session.js';
import { FEED_VERSION, toOccurrences } from './occurrences.js';
import { VENUES, loadVenue } from './skedda.js';
import { assessHealth, findingsMarkdown } from './health.js';
import { loadVenues, resolveVenues, markMoves, dedupe } from './consolidate.js';
import { toIcs, calendarName } from './ics.js';
import { cadenceMs } from './registry.js';
import { loadRegions } from './regions.js';
import { onHost } from './http.js';

export const HORIZON_DAYS = 14;
export const FEED_HORIZON_DAYS = 28;
export const COURT_DAYS = 14;
/** A source is due a little early, so a 30m source checked at :13:40 runs again at the :43 tick. */
export const DUE_SLACK_MS = 10 * 60e3;
/** Sources scraped at once (requests to one host still queue, see lib/http.js). */
export const SOURCE_CONCURRENCY = 6;

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };

/** Where runScrape reads and writes (repo paths unless overridden). */
export const scrapePaths = (overrides = {}) => ({
  out: repoPath('public/data/schedule.json'),
  feed: repoPath('public/data/occurrences.json'),
  watch: repoPath('data/watch.json'),
  failures: repoPath('scrape-failures.md'), // per-region files go in scrape-failures/ next to it
  health: repoPath('data/health.json'),
  changes: repoPath('scrape-changes.md'),
  changesJson: repoPath('scrape-changes.json'),
  manualFile: (file) => repoPath(file),
  venues: undefined, // every region's venues.json
  ...overrides,
});

/**
 * Which sources to scrape now: a source is due when it has never run, failed last time, or its
 * cadence has passed since its last good check (minus DUE_SLACK_MS). `prev` is last run's
 * schedule.json. `force` makes everything due. Returns { due, skipped } (source objects).
 */
export function planSources(sources, prev = {}, { now = new Date(), force = false } = {}) {
  const last = new Map((prev.sources ?? []).map((r) => [r.id, r]));
  const due = [], skipped = [];
  for (const s of sources) {
    const r = last.get(s.id);
    const age = r?.checkedAt ? now - Date.parse(r.checkedAt) : Infinity;
    if (force || !r || !r.ok || age >= cadenceMs(s.cadence) - DUE_SLACK_MS) due.push(s); else skipped.push(s);
  }
  return { due, skipped };
}

/** Run `fn` over `items`, at most `limit` at a time; results in input order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const launchChromium = async () => (await import('playwright')).chromium.launch();

/**
 * Scrape the sources that are due, keep the rest from the last run, merge in hand-checked
 * sessions, validate, consolidate, and write: the combined schedule.json / occurrences.json /
 * <sport>.ics (every region, for existing consumers), one folder per region under
 * data/regions/<id>/ (what the site loads), data/index.json (the regions), watch.json,
 * health.json and the failures/changes files. A source that fails keeps its last good
 * sessions, flagged checkFailed. Returns { out, feed, failed, findings, fresh, ran, skipped }.
 *
 * `manuals` has one entry per region with hand-checked sessions (`manual` = one, older callers).
 * `force` scrapes every source regardless of cadence. `fetch` goes to the API/page adapters and
 * the manual-page watcher; `launchBrowser` is only called when a due source needs a browser.
 */
export async function runScrape({
  sources, manual = null, manuals = manual ? [manual] : [], regions, paths = scrapePaths(), fetch = globalThis.fetch,
  launchBrowser = launchChromium, now = () => new Date(), log = console.log, summaryFile, force = false,
} = {}) {
  const ref = today(now());
  const prev = await readJson(paths.out, { sessions: [], sources: [] });
  const watch = await readJson(paths.watch, {});
  const prevHealth = await readJson(paths.health, {});
  const regionList = regions ?? loadRegions().map((r) => ({ ...r.info, publicCourts: r.publicCourts }));

  const { due, skipped } = planSources(sources, prev, { now: now(), force });
  if (skipped.length) log(`skip  not due yet: ${skipped.map((s) => `${s.id} (${s.cadence})`).join(', ')}`);

  // Only start Chromium when a due source needs a browser (adapters declare `needsBrowser`).
  // If Chromium can't start (not installed because the plan saw no browser source due), only the
  // sources that need it fail this run; the rest go ahead.
  let browserError = null;
  const browser = due.some((s) => s.adapter.needsBrowser !== false)
    ? await launchBrowser().catch((e) => { browserError = e; return null; }) : null;
  const perSource = new Map(); // id -> { sessions, result, run }
  try {
    await mapLimit(due, SOURCE_CONCURRENCY, async (s) => {
      const checkedAt = now().toISOString();
      const srcRef = today(now(), s.timezone);
      try {
        if (s.adapter.needsBrowser !== false && !browser) throw new Error(`no browser: ${browserError?.message ?? 'not started'}`);
        const r = await s.adapter.scrape({ browser, ref: srcRef, options: s.options, timezone: s.timezone, fetch });
        const { ok, warnings } = validateSessions(r.sessions.map((x) => ({ ...tagSession(x, s), verifiedAt: srcRef })));
        const allWarnings = [...(r.warnings ?? []), ...warnings];
        perSource.set(s.id, {
          sessions: ok,
          result: { id: s.id, name: s.name ?? s.id, sport: s.sport, region: s.region, cadence: s.cadence, ok: true, checkedAt, count: ok.length, warnings: allWarnings.length ? allWarnings : undefined },
          run: { id: s.id, ok: true, count: ok.length, warnings: allWarnings, sessions: ok, shape: r.shape, reads: s.adapter.reads, contentHash: r.contentHash },
        });
        log(`ok    ${s.id}: ${ok.length} sessions${warnings.length ? ` (${warnings.length} warnings)` : ''}`);
      } catch (e) {
        const kept = prev.sessions.filter((x) => x.sourceId === s.id).map((x) => ({ ...tagSession(x, s), checkFailed: srcRef }));
        perSource.set(s.id, {
          sessions: kept,
          result: { id: s.id, name: s.name ?? s.id, sport: s.sport, region: s.region, cadence: s.cadence, ok: false, checkedAt, error: e.message, kept: kept.length },
          run: { id: s.id, ok: false, error: e.message },
        });
        log(`FAIL  ${s.id}: ${e.message} (kept ${kept.length} from last run)`);
      }
    });
  } finally {
    await browser?.close();
  }
  // Not due: last run's sessions and status as they were (still fresh by their cadence).
  const prevResult = new Map((prev.sources ?? []).map((r) => [r.id, r]));
  for (const s of skipped) {
    const kept = prev.sessions.filter((x) => x.sourceId === s.id).map((x) => tagSession(x, s));
    perSource.set(s.id, {
      sessions: kept,
      result: { ...prevResult.get(s.id), id: s.id, name: s.name ?? s.id, sport: s.sport, region: s.region, cadence: s.cadence },
      run: { id: s.id, skipped: true },
    });
  }
  // Config order, whatever order the sources finished in, so output is deterministic.
  const results = [], runs = [];
  let sessions = [];
  for (const s of sources) {
    const p = perSource.get(s.id);
    sessions.push(...p.sessions); results.push(p.result); runs.push(p.run);
  }

  // Hand-checked sessions: watch their source pages (when the region's manual cadence is due)
  // and flag them when a page changes.
  const manualEntries = [];
  for (const manualCfg of manuals) {
    const list = (await readJson(paths.manualFile(manualCfg.file), { sessions: [] })).sessions ?? [];
    const every = cadenceMs(manualCfg.cadence ?? '1d') - DUE_SLACK_MS;
    for (const m of list) {
      const entry = tagSession(m, manualCfg);
      if (m.source) {
        const w0 = watch[m.source];
        const watchDue = force || !w0?.checkedAt || now() - Date.parse(w0.checkedAt) >= every || w0.error;
        if (watchDue) {
          try {
            const res = await onHost(m.source, () => fetch(m.source, { headers: { 'user-agent': 'Mozilla/5.0 (Schelagg schedule checker)' }, signal: AbortSignal.timeout(20000) }));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
            const w = (watch[m.source] ||= { hash, changedOn: null });
            if (w.hash !== hash) { w.hash = hash; w.changedOn = ref; }
            w.checkedAt = now().toISOString();
            delete w.error;
          } catch (e) {
            const w = (watch[m.source] ||= { hash: null, changedOn: null });
            w.checkedAt = now().toISOString();
            w.error = e.message;
          }
        }
        const w = watch[m.source];
        if (w?.error) entry.watchError = w.error; // can't watch it; freshness falls back to verifiedAt age
        else if (w?.changedOn && (!m.verifiedAt || w.changedOn > m.verifiedAt)) entry.sourceChanged = w.changedOn;
      }
      sessions.push(entry);
      manualEntries.push(entry);
    }
  }

  // Hand-written entries that fail the publish checks are dropped below; report them like a
  // source's warnings so a typo in manual.json doesn't silently remove a session.
  if (manuals.length) {
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
    const w = names.map((n) => `venue "${n}" isn't in its region's venues.json`);
    const result = results.find((r) => r.id === sourceId);
    if (result && !skipped.some((s) => s.id === sourceId)) result.warnings = [...(result.warnings ?? []), ...w];
    const run = runs.find((r) => r.id === sourceId);
    if (run && !run.skipped) run.warnings = [...(run.warnings ?? []), ...w];
    log(`warn  ${sourceId}: ${w.join('; ')}`);
  }
  sessions = markMoves(sessions, prev.sessions);
  const deduped = dedupe(sessions, [...sources.map((s) => s.id), 'manual']);
  sessions = deduped.sessions;
  if (deduped.merged.length) log(`merge ${deduped.merged.map((m) => `${m.dropped} -> ${m.kept}`).join(', ')}`);

  const generatedAt = now();
  const venueRow = ({ id, name, city, parent, region }) => ({ id, name, city, ...(parent ? { parent } : {}), ...(region ? { region } : {}) });
  const courtsOf = (r) => (r.publicCourts ? { ...r.publicCourts, courts: (r.publicCourts.courts ?? []).map((c) => ({ ...c, region: r.id })) } : null);
  // Combined: every region. publicCourts keeps its old shape (one region's note + all courts).
  const allCourts = regionList.map(courtsOf).filter(Boolean);
  const out = {
    schemaVersion: SCHEMA_VERSION, generatedAt: generatedAt.toISOString(), sources: results, sessions,
    publicCourts: allCourts.length ? { ...allCourts[0], courts: allCourts.flatMap((c) => c.courts) } : null,
    venues: venues.map(venueRow),
    ...(deduped.merged.length ? { merged: deduped.merged } : {}),
  };
  await writeFile(paths.out, JSON.stringify(out, null, 2) + '\n');
  // The public feed consumers read (vteam pulls this). Every sport and region; consumers filter.
  const occurrences = toOccurrences(sessions, { now: generatedAt, horizonDays: FEED_HORIZON_DAYS });
  const feed = { feedVersion: FEED_VERSION, generatedAt: out.generatedAt, horizonDays: FEED_HORIZON_DAYS, occurrences };
  await writeFile(paths.feed, JSON.stringify(feed, null, 2) + '\n');
  // Calendar subscriptions, one per sport, next to the feed (public/data/<sport>.ics).
  const dataDir = paths.icsDir ?? dirname(paths.feed);
  for (const sport of [...new Set(sources.map((s) => s.sport))].sort()) {
    // One region: named for it, as before ("Schelagg · Austin volleyball"); several: just the sport.
    const only = regionList.length === 1 ? regionList[0] : null;
    await writeFile(join(dataDir, `${sport}.ics`), toIcs(occurrences, { sport, name: calendarName(sport, only?.name), generatedAt: out.generatedAt, timezone: only?.timezone }));
  }

  // One folder per region: what the site loads, so a visitor downloads one city, not all of them.
  const index = { generatedAt: out.generatedAt, regions: [] };
  for (const r of regionList) {
    const dir = join(paths.regionsDir ?? join(dataDir, 'regions'), r.id);
    await mkdir(dir, { recursive: true });
    const rs = sessions.filter((x) => x.region === r.id);
    const sports = [...new Set([...sources.filter((s) => s.region === r.id).map((s) => s.sport), ...rs.map((x) => x.sport)])].sort();
    const body = {
      schemaVersion: SCHEMA_VERSION, generatedAt: out.generatedAt,
      region: { id: r.id, name: r.name, timezone: r.timezone },
      sources: results.filter((x) => x.region === r.id), sessions: rs, publicCourts: courtsOf(r),
      venues: venues.filter((v) => v.region === r.id).map(venueRow),
    };
    await writeFile(join(dir, 'schedule.json'), JSON.stringify(body, null, 2) + '\n');
    const ro = occurrences.filter((o) => o.region === r.id);
    await writeFile(join(dir, 'occurrences.json'), JSON.stringify({ ...feed, occurrences: ro }, null, 2) + '\n');
    for (const sport of sports) {
      await writeFile(join(dir, `${sport}.ics`), toIcs(ro, { sport, name: calendarName(sport, r.name), generatedAt: out.generatedAt, timezone: r.timezone }));
    }
    index.regions.push({ id: r.id, name: r.name, timezone: r.timezone, center: r.center, sports, sessions: rs.length, venues: body.venues.length });
  }
  await writeFile(join(dataDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  await writeFile(paths.watch, JSON.stringify(watch, null, 2) + '\n');

  // Summary for GitHub Actions, and failures files the workflow turns into issues: one combined
  // (also where a failed database write is reported) and one per region with failures.
  const ran = new Set(due.map((s) => s.id));
  const failed = results.filter((s) => ran.has(s.id) && !s.ok);
  const line = (s) => `- ${s.ok ? '✅' : '❌'} **${s.id}** ${s.ok ? `${s.count} sessions` : s.error}`;
  const lines = results.filter((s) => ran.has(s.id)).map(line);
  if (summaryFile) {
    await appendFile(summaryFile, `### Schedule scrape ${ref}\n${lines.join('\n') || '- nothing due'}\n`
      + (skipped.length ? `\nNot due yet: ${skipped.map((s) => `${s.id} (every ${s.cadence})`).join(', ')}\n` : ''));
  }
  const failText = (list) => `Sources that failed on ${ref}:\n\n${list.map(line).join('\n')}\n\nTheir last good sessions are still shown, flagged "Couldn't recheck".`;
  await writeFile(paths.failures, failed.length ? failText(failed) : '');
  const failuresDir = paths.failuresDir ?? join(dirname(paths.failures), 'scrape-failures');
  await mkdir(failuresDir, { recursive: true });
  for (const r of regionList) {
    const rf = failed.filter((s) => s.region === r.id);
    await writeFile(join(failuresDir, `${r.id}.md`), rf.length ? failText(rf) : '');
  }

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
  log(`wrote ${paths.out}: ${sessions.length} sessions, ${due.length} sources scraped, ${skipped.length} not due, ${failed.length} failed, ${fresh.length} new changes`);
  return { out, feed, failed, findings, fresh, ran: due.map((s) => s.id), skipped: skipped.map((s) => s.id) };
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
