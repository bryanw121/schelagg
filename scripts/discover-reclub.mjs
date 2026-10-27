// Finds Reclub clubs running volleyball meets in the area that config/sources.json doesn't list yet.
//
// Reclub only offers discovery inside its app, so candidates come from a web search API: results
// that point at reclub.co meet pages (/m/<code>) or club pages (/clubs/@<slug>). Each candidate
// meet page is read once: its data names the club, the sport, Reclub's community (its city
// grouping, e.g. "Austin, TX, USA") and the venue's coordinates. A club is a candidate when one of
// its meets is volleyball and is either in the configured community or within radiusKm of the
// center. Settings live in the reclub source's options.discover in config/sources.json.
//
//   node scripts/discover-reclub.mjs                    plan, search with Brave (BRAVE_SEARCH_API_KEY), write candidates
//   node scripts/discover-reclub.mjs --plan             write this run's queries to discover-queries.json (for Claude)
//   node scripts/discover-reclub.mjs --results <file>   same as the first, from results Claude gathered
//                                                       ({ "<query>": [urls] }) for the planned queries
//   node scripts/discover-reclub.mjs --apply <slug>     add https://reclub.co/clubs/@<slug> to config/sources.json
//
// discover-state.json (kept on the discover-state branch between runs) remembers each query's last
// run and whether it found anything, clubs already proposed or skipped, and which club each meet
// belongs to. Queries that keep finding nothing run less often (planQueries); see README.
//
// The "Discover Reclub clubs" workflow runs this weekly and opens one pull request per new club.
// Search comes from BRAVE_SEARCH_API_KEY if set, otherwise from Claude (CLAUDE_CODE_OAUTH_TOKEN)
// running the queries with web search; with neither it prints a notice and finds nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { get } from '../lib/http.js';
import { loadEnv, repoPath } from '../lib/paths.js';
import { loadSources } from '../lib/registry.js';
import { meetData, meetLinks, meetUrl } from './adapters/reclub.mjs';

export const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const clubUrl = (slug) => `https://reclub.co/clubs/@${slug}`;
const slugOf = (url) => String(url).match(/reclub\.co\/clubs\/@([A-Za-z0-9_.-]+)/i)?.[1];

/** Meet codes and club slugs in a list of URLs (search results), each once, in order. */
export function reclubLinks(urls) {
  const meets = new Set(), clubs = new Set();
  for (const u of urls) {
    const code = String(u).match(/reclub\.co\/m\/([A-Za-z0-9]{4,12})(?:[/?#]|$)/i)?.[1];
    if (code) meets.add(code);
    const slug = slugOf(u);
    if (slug && SLUG.test(slug)) clubs.add(slug);
  }
  return { meets: [...meets], clubs: [...clubs] };
}

/** Lowercased slugs of the clubs already configured. */
export const knownSlugs = (clubs = []) => new Set(clubs.map(slugOf).filter(Boolean).map((s) => s.toLowerCase()));

/** Great-circle distance in km between two [lat, lng] points. */
export function distanceKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Is this meet (meetData() of its page) a volleyball meet in the area? Returns { ok, reason }. */
export function judgeMeet(data, { sport = 'volleyball', community, center, radiusKm } = {}) {
  const meet = data?.meet;
  if (!meet) return { ok: false, reason: 'no meet data' };
  const key = String(meet.sport?.key ?? meet.sport?.name ?? '').toLowerCase();
  if (!key.includes(sport)) return { ok: false, reason: `sport is ${key || 'unknown'}` };
  if (community && meet.community?.name === community) return { ok: true, reason: `in ${community}` };
  const loc = meet.venue?.location;
  const point = Number.isFinite(loc?.latitude) && Number.isFinite(loc?.longitude) ? [loc.latitude, loc.longitude]
    : Number.isFinite(meet.community?.latitude) ? [meet.community.latitude, meet.community.longitude] : null;
  if (point && center && radiusKm) {
    const km = distanceKm(center, point);
    if (km <= radiusKm) return { ok: true, reason: `${Math.round(km)} km from the center` };
    return { ok: false, reason: `${Math.round(km)} km away${meet.community?.name ? ` (${meet.community.name})` : ''}` };
  }
  return { ok: false, reason: `outside the area${meet.community?.name ? ` (${meet.community.name})` : ''}` };
}

/** Brave Search web results -> URLs. https://api.search.brave.com */
export async function braveSearch(query, { key, fetch: f = globalThis.fetch, count = 20 } = {}) {
  const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(count) })}`;
  const res = await get(url, { fetch: f, headers: { accept: 'application/json', 'x-subscription-token': key } });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  return (JSON.parse(res.text).web?.results ?? []).map((r) => r.url).filter(Boolean);
}

const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : null);

/**
 * Search, then read candidate pages. `search(query)` returns URLs; `fetch` is injected in tests.
 *
 * What it already knows it doesn't read again (`state`, kept between runs): clubs already
 * proposed or skipped, and which club each meet code belongs to, so a meet of a known club found
 * by search costs nothing. Reads at most `maxPages` Reclub pages per run, `delayMs` apart.
 *
 * Every link remembers which queries returned it, so each candidate lists the queries that found
 * it (`credited`): that's what decides how often each query runs (planQueries / nextState).
 * `extraUrls` are results without a query; `seedClubs` are club slugs found some other way
 * (a venue's website linking to its Reclub club, from venue discovery).
 */
export async function discover({
  options, search, fetch, maxPages = 40, meetsPerClub = 3, delayMs = 1000,
  queries, extraUrls = [], seedClubs = [], state = {},
}) {
  const d = options?.discover ?? {};
  const configured = knownSlugs(options?.clubs);
  const decided = new Set([...Object.keys(state.clubs ?? {}), ...Object.keys(state.skipped ?? {})].map((x) => x.toLowerCase()));
  const settled = (slug) => configured.has(slug.toLowerCase()) || decided.has(slug.toLowerCase());
  const meetClub = { ...(state.meets ?? {}) };
  const warnings = [], failedQueries = [];
  const origin = new Map(); // 'meet:<code>' | 'club:<slug>' -> Set of queries that returned it
  const note = (key, from) => { if (!origin.has(key)) origin.set(key, new Set()); for (const q of from) origin.get(key).add(q); };
  const add = (urls, from) => { const l = reclubLinks(urls); for (const m of l.meets) note(`meet:${m}`, from); for (const c of l.clubs) note(`club:${c}`, from); return l; };

  const list = queries ?? d.queries ?? [];
  let links = 0;
  for (const q of list) {
    try { const l = add(await search(q), [q]); links += l.meets.length + l.clubs.length; }
    catch (e) { warnings.push(`search "${q}": ${e.message}`); failedQueries.push(q); }
  }
  links += [...reclubLinks(extraUrls).meets, ...reclubLinks(extraUrls).clubs].length;
  add(extraUrls, []);
  for (const slug of seedClubs) if (SLUG.test(slug)) note(`club:${slug}`, ['venues']);

  let pages = 0;
  const read = async (url) => {
    if (pages >= maxPages) return null;
    if (pages++ > 0) await pause(delayMs);
    const res = await get(url, { fetch });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text;
  };
  // Club pages: a few meets of each club we haven't decided on yet.
  const clubKeys = [...origin.keys()].filter((k) => k.startsWith('club:'));
  for (const key of clubKeys) {
    const slug = key.slice(5);
    if (settled(slug)) continue;
    try {
      const html = await read(clubUrl(slug));
      if (html == null) break;
      for (const code of meetLinks(html).slice(0, meetsPerClub)) { note(`meet:${code}`, origin.get(key)); meetClub[code] = slug; }
    } catch (e) { warnings.push(`${clubUrl(slug)}: ${e.message}`); }
  }
  const candidates = new Map(), rejected = [];
  let stopped = false;
  for (const [key, from] of origin) {
    if (!key.startsWith('meet:')) continue;
    const code = key.slice(5);
    if (meetClub[code] && settled(meetClub[code])) continue; // a known club's meet: nothing to learn
    const url = meetUrl(code);
    let data;
    try {
      const html = await read(url);
      if (html == null) { stopped = true; break; }
      data = meetData(html);
    } catch (e) { warnings.push(`${url}: ${e.message}`); continue; }
    const slug = data?.group?.slug;
    if (!slug || !SLUG.test(slug)) continue;
    meetClub[code] = slug;
    if (settled(slug)) continue;
    const verdict = judgeMeet(data, d);
    if (!verdict.ok) { if (!candidates.has(slug)) rejected.push({ url, club: slug, reason: verdict.reason }); continue; }
    const c = candidates.get(slug) ?? { slug, name: data.group.name?.trim() || slug, url: clubUrl(slug), reason: verdict.reason, meets: [], queries: [] };
    c.meets.push({ url, name: String(data.meet.name ?? '').trim(), venue: data.meet.venue?.name ?? null });
    c.queries = [...new Set([...c.queries, ...from])];
    candidates.set(slug, c);
  }
  if (stopped) warnings.push(`stopped after ${maxPages} pages`);
  // A club with a matching meet isn't "rejected" because another of its meets didn't match.
  const kept = rejected.filter((r) => !candidates.has(r.club));
  const found = [...candidates.values()];
  return {
    candidates: found, rejected: kept, warnings, failedQueries,
    credited: [...new Set(found.flatMap((c) => c.queries))].filter((q) => q !== 'venues'),
    searched: list.length, urls: links, pagesRead: pages, meets: meetClub,
  };
}

// --- scheduling: which queries run this time ---------------------------------------------------

/** Days a query waits before running again, by how many runs in a row found nothing new. */
export const BACKOFF_DAYS = [7, 14, 28, 56];
export const intervalDays = (empty = 0) => BACKOFF_DAYS[Math.min(Math.max(empty, 0), BACKOFF_DAYS.length - 1)];
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/**
 * This run's queries, up to `budget`. Order: queries that found a new club last time (so a proven
 * query never skips a week), then new queries (a sport or city just added), then the rest by how
 * overdue they are. A query that found nothing waits twice as long each time (2, 4, then 8 weeks).
 * A quarter of the budget is kept for new and overdue queries when any are due, so a long list of
 * productive queries can't starve them either.
 */
export function planQueries({ queries = [], state = {}, today, budget = 20 }) {
  const proven = [], fresh = [], overdue = [];
  queries.forEach((text, i) => {
    const s = state.queries?.[text];
    if (!s?.lastRun) { fresh.push({ text, i }); return; }
    const interval = intervalDays(s.empty);
    const age = daysBetween(s.lastRun, today);
    if (age < interval) return;
    if ((s.empty ?? 0) === 0 && s.lastFound) proven.push({ text, i, score: age / interval });
    else overdue.push({ text, i, score: age / interval });
  });
  const byScore = (a, b) => b.score - a.score || a.i - b.i;
  proven.sort(byScore); overdue.sort(byScore);
  const others = [...fresh, ...overdue];
  const reserve = others.length ? Math.min(others.length, Math.ceil(budget / 4)) : 0;
  const take = Math.min(proven.length, budget - reserve);
  const batch = [...proven.slice(0, take), ...others.slice(0, budget - take)].map((x) => x.text);
  return { batch, due: proven.length + others.length, total: queries.length, budget };
}

/**
 * State after a run: each query that ran gets lastRun (and its wait reset when it found a new club;
 * a query whose search failed is left as it was, so it's still due); proposed clubs are remembered
 * so they aren't read again; skipped clubs are re-checked after `skipDays`; the meet -> club map
 * keeps the newest `maxMeets` entries. Queries no longer configured are dropped.
 */
export function nextState(state = {}, { queries = [], batch = [], result, today, maxMeets = 2000, skipDays = 180 }) {
  const credited = new Set(result.credited ?? []);
  const failed = new Set(result.failedQueries ?? []);
  const q = {};
  for (const text of queries) if (state.queries?.[text]) q[text] = { ...state.queries[text] };
  for (const text of batch) {
    if (failed.has(text)) continue;
    const s = q[text] ?? {};
    q[text] = credited.has(text)
      ? { lastRun: today, empty: 0, lastFound: today }
      : { ...s, lastRun: today, empty: (s.empty ?? 0) + 1 };
  }
  const clubs = { ...(state.clubs ?? {}) };
  for (const c of result.candidates ?? []) clubs[c.slug.toLowerCase()] ??= today;
  const skipped = {};
  for (const [slug, v] of Object.entries(state.skipped ?? {})) if (daysBetween(v.on, today) < skipDays) skipped[slug] = v;
  for (const r of result.rejected ?? []) skipped[r.club.toLowerCase()] ??= { on: today, reason: r.reason };
  const entries = Object.entries(result.meets ?? state.meets ?? {});
  return { queries: q, clubs, skipped, meets: Object.fromEntries(entries.slice(-maxMeets)) };
}

/** Reclub club slugs that discovered venues link to (config/venues.json schedule.platform 'reclub'). */
export const seedsFromVenues = (venues = []) => [...new Set(venues
  .filter((v) => v.schedule?.platform === 'reclub' && v.schedule.company)
  .map((v) => v.schedule.company))];

/**
 * The reclub source's options from loaded sources. loadSources() resolves `adapter` to the adapter
 * module, so match on its id (comparing to the string 'reclub' never matches).
 */
export const reclubOptions = (sources) => sources.find((s) => s.adapter?.id === 'reclub' || s.adapter === 'reclub')?.options;

/**
 * Search results gathered elsewhere (Claude's web search): { "<query>": [urls] } keeps which
 * query found what; a plain array of URLs is accepted without that. Non-URLs are ignored.
 */
export function readResults(text) {
  const urlsOf = (list) => (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x?.url)).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  let data;
  try { data = JSON.parse(text); } catch { return { byQuery: new Map(), extra: [] }; }
  if (Array.isArray(data)) return { byQuery: new Map(), extra: urlsOf(data) };
  if (!data || typeof data !== 'object') return { byQuery: new Map(), extra: [] };
  return { byQuery: new Map(Object.entries(data).map(([q, list]) => [q, urlsOf(list)])), extra: [] };
}

/** Pull request body for one candidate. */
export function prBody(c) {
  return [
    `Discovery found **${c.name}** on Reclub running volleyball meets ${c.reason}.`,
    '',
    `Club page: ${c.url}`,
    '',
    'Meets seen:',
    ...c.meets.map((m) => `- [${m.name || 'meet'}](${m.url})${m.venue ? ` at ${m.venue}` : ''}`),
    '',
    'Merging adds the club to `options.clubs` in `config/sources.json`, so the next hourly scrape picks up its meets.',
    'If its venues aren\'t in `options.venues`, the scrape reports a "Reclub venue missing" warning to fill in.',
    'Close this pull request to skip the club; discovery won\'t suggest it again.',
  ].join('\n');
}

/** Add a club to the reclub source in the config text. Returns the new text (unchanged if already listed). */
export function applyClub(text, slug) {
  if (!SLUG.test(slug)) throw new RangeError(`not a Reclub club slug: ${slug}`);
  const cfg = JSON.parse(text);
  const src = cfg.sources.find((s) => s.adapter === 'reclub');
  if (!src) throw new Error('config has no reclub source');
  src.options ??= {};
  src.options.clubs ??= [];
  if (knownSlugs(src.options.clubs).has(slug.toLowerCase())) return text;
  src.options.clubs.push(clubUrl(slug));
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

const STATE = () => repoPath('discover-state.json');
const BATCH = () => repoPath('discover-queries.json');
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Queries per run: a bigger budget when searches are cheap (Brave), a smaller one when Claude runs them. */
export const budgetFor = (discoverOptions = {}, via) => discoverOptions.budget?.[via] ?? { brave: 100, claude: 20 }[via] ?? 20;

/** More queries due than the budget allows means quiet queries start waiting past 8 weeks: say so. */
function warnIfOverBudget(plan) {
  if (plan.due <= plan.budget) return;
  console.log(`::warning::Reclub discovery: ${plan.due} queries are due but the budget is ${plan.budget}, so ${plan.due - plan.budget} wait another week. `
    + 'Add the BRAVE_SEARCH_API_KEY secret (budget 100, about 1,000 free searches a month) or raise options.discover.budget.');
}

async function main(args) {
  const config = repoPath('config/sources.json');
  if (args[0] === '--apply') {
    writeFileSync(config, applyClub(readFileSync(config, 'utf8'), args[1] ?? ''));
    console.log(`Added ${clubUrl(args[1])} to config/sources.json`);
    return;
  }
  loadEnv();
  const opts = reclubOptions(loadSources().sources);
  const all = opts?.discover?.queries ?? [];
  const state = readJson(STATE(), {});
  const key = process.env.BRAVE_SEARCH_API_KEY;
  const via = args[0] === '--results' || args[0] === '--plan' ? 'claude' : 'brave';
  const today = todayUtc();

  if (args[0] === '--plan') {
    // The workflow hands this batch to Claude, so Claude never sees more than the budget.
    const plan = planQueries({ queries: all, state, today, budget: budgetFor(opts?.discover, 'claude') });
    writeFileSync(BATCH(), `${JSON.stringify(plan.batch, null, 2)}\n`);
    console.log(`::notice::Reclub discovery: ${plan.batch.length} queries this run (${plan.due} due of ${plan.total}, budget ${plan.budget})`);
    warnIfOverBudget(plan);
    return;
  }

  const out = repoPath('discover-candidates.json');
  let search, batch, extraUrls = [];
  if (args[0] === '--results') {
    const { byQuery, extra } = readResults(readFileSync(args[1], 'utf8'));
    batch = readJson(BATCH(), [...byQuery.keys()]);
    // A query Claude didn't report on counts as not searched (it stays due), not as "found nothing".
    search = async (q) => { if (!byQuery.has(q)) throw new Error('no results from Claude'); return byQuery.get(q); };
    extraUrls = extra;
  } else if (key) {
    const plan = planQueries({ queries: all, state, today, budget: budgetFor(opts?.discover, via) });
    batch = plan.batch;
    warnIfOverBudget(plan);
    search = (q) => braveSearch(q, { key });
  } else {
    console.log('::notice::No BRAVE_SEARCH_API_KEY and no --results file; skipping Reclub club discovery.');
    writeFileSync(out, `${JSON.stringify({ candidates: [] }, null, 2)}\n`);
    return;
  }
  let seedClubs = [];
  try { seedClubs = seedsFromVenues(JSON.parse(readFileSync(repoPath('config/venues.json'), 'utf8')).venues); } catch { /* no venues file */ }
  const result = await discover({ options: opts, search, queries: batch, extraUrls, seedClubs, state });
  writeFileSync(STATE(), `${JSON.stringify(nextState(state, { queries: all, batch, result, today }), null, 2)}\n`);
  const body = { ...result, meets: undefined, candidates: result.candidates.map((c) => ({ ...c, body: prBody(c) })) };
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`::notice::Reclub discovery (${via}): searched ${result.searched} of ${all.length} queries, got ${result.urls} reclub.co links, read ${result.pagesRead} Reclub pages, ${result.candidates.length} new clubs.`);
  for (const c of result.candidates) console.log(`New club: ${c.name} (@${c.slug}), ${c.reason}; found by ${c.queries.join(' | ')}`);
  for (const r of result.rejected) console.log(`Skipped @${r.club}: ${r.reason}`);
  for (const w of result.warnings) console.log(`::warning::${w}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
