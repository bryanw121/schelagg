// Finds Reclub clubs running volleyball meets in the area that config/sources.json doesn't list yet.
//
// Reclub only offers discovery inside its app, so candidates come from a web search API: results
// that point at reclub.co meet pages (/m/<code>) or club pages (/clubs/@<slug>). Each candidate
// meet page is read once: its data names the club, the sport, Reclub's community (its city
// grouping, e.g. "Austin, TX, USA") and the venue's coordinates. A club is a candidate when one of
// its meets is volleyball and is either in the configured community or within radiusKm of the
// center. Settings live in the reclub source's options.discover in config/sources.json.
//
//   node scripts/discover-reclub.mjs                 write discover-candidates.json (needs BRAVE_SEARCH_API_KEY)
//   node scripts/discover-reclub.mjs --urls <file>   same, from search results gathered elsewhere (a JSON array of
//                                                    URLs; the workflow has Claude run the searches when there's no key)
//   node scripts/discover-reclub.mjs --apply <slug>  add https://reclub.co/clubs/@<slug> to config/sources.json
//
// The "Discover Reclub clubs" workflow runs this daily and opens one pull request per new club.
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
 * Search, then read candidate meet pages. `search(query)` returns URLs; `fetch` is injected in tests.
 * Reads at most `maxPages` Reclub pages per run, `delayMs` apart, so a run stays a light touch.
 */
export async function discover({ options, search, fetch, maxPages = 40, meetsPerClub = 3, delayMs = 1000, queries }) {
  const d = options?.discover ?? {};
  const known = knownSlugs(options?.clubs);
  const warnings = [], urls = [];
  for (const q of queries ?? d.queries ?? []) {
    try { urls.push(...await search(q)); } catch (e) { warnings.push(`search "${q}": ${e.message}`); }
  }
  const links = reclubLinks(urls);
  const queue = [...links.meets];
  let pages = 0;
  const read = async (url) => {
    if (pages++ >= maxPages) return null;
    if (pages > 1) await pause(delayMs);
    const res = await get(url, { fetch });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text;
  };
  // Club pages from search: a few of each unknown club's meets.
  for (const slug of links.clubs.filter((s) => !known.has(s.toLowerCase()))) {
    try {
      const html = await read(clubUrl(slug));
      if (html != null) queue.push(...meetLinks(html).slice(0, meetsPerClub));
    } catch (e) { warnings.push(`${clubUrl(slug)}: ${e.message}`); }
  }
  const candidates = new Map(), rejected = [];
  for (const code of [...new Set(queue)]) {
    const url = meetUrl(code);
    let data;
    try {
      const html = await read(url);
      if (html == null) { warnings.push(`stopped after ${maxPages} pages`); break; }
      data = meetData(html);
    } catch (e) { warnings.push(`${url}: ${e.message}`); continue; }
    const slug = data?.group?.slug;
    if (!slug || !SLUG.test(slug) || known.has(slug.toLowerCase())) continue;
    const verdict = judgeMeet(data, d);
    if (!verdict.ok) { rejected.push({ url, club: slug, reason: verdict.reason }); continue; }
    const c = candidates.get(slug) ?? { slug, name: data.group.name?.trim() || slug, url: clubUrl(slug), reason: verdict.reason, meets: [] };
    c.meets.push({ url, name: String(data.meet.name ?? '').trim(), venue: data.meet.venue?.name ?? null });
    candidates.set(slug, c);
  }
  return { candidates: [...candidates.values()], rejected, warnings, searched: (queries ?? d.queries ?? []).length, urls: links.meets.length + links.clubs.length, pagesRead: Math.min(pages, maxPages) };
}

/**
 * This run's share of the queries: at most `max` (options.discover.maxQueriesPerRun, default 10),
 * rotating through the whole list run by run (`run` = week number in the workflow). Adding sports
 * or cities makes the list longer, so each query comes round less often; the cost of a run
 * (searches, and Claude usage when Claude searches) stays the same.
 */
export function queriesForRun(all = [], max = 10, run = 0) {
  if (all.length <= max) return [...all];
  const start = ((run * max) % all.length + all.length) % all.length;
  return Array.from({ length: max }, (_, i) => all[(start + i) % all.length]);
}

/**
 * The Reclub source's options from loaded sources. loadSources() resolves `adapter` to the adapter
 * module, so match on its id (comparing to the string 'reclub' never matches).
 */
export const reclubOptions = (sources) => sources.find((s) => s.adapter?.id === 'reclub' || s.adapter === 'reclub')?.options;

/** ISO week number of a date (1-53): the rotation index for weekly runs. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

/** URLs from a search-results file: a JSON array of strings (or of { url }), anything else ignored. */
export function readUrls(text) {
  let list;
  try { list = JSON.parse(text); } catch { return []; }
  return (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x?.url)).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
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

async function main(args) {
  const config = repoPath('config/sources.json');
  if (args[0] === '--apply') {
    writeFileSync(config, applyClub(readFileSync(config, 'utf8'), args[1] ?? ''));
    console.log(`Added ${clubUrl(args[1])} to config/sources.json`);
    return;
  }
  loadEnv();
  const opts = reclubOptions(loadSources().sources);
  const batch = queriesForRun(opts?.discover?.queries, opts?.discover?.maxQueriesPerRun ?? 10, isoWeek());
  if (args[0] === '--queries') {
    // The workflow hands this run's batch to Claude, so Claude never sees more than the budget.
    writeFileSync(args[1], `${JSON.stringify(batch, null, 2)}\n`);
    console.log(`::notice::Reclub discovery: ${batch.length} of ${opts?.discover?.queries?.length ?? 0} queries this run`);
    return;
  }
  const out = repoPath('discover-candidates.json');
  const key = process.env.BRAVE_SEARCH_API_KEY;
  const urlsFile = args[0] === '--urls' ? args[1] : null;
  let search;
  if (urlsFile) {
    // Results gathered outside (Claude's web search): hand them all over once, on the first query.
    const urls = readUrls(readFileSync(urlsFile, 'utf8'));
    let given = false;
    search = async () => (given ? [] : (given = true, urls));
  } else if (key) {
    search = (q) => braveSearch(q, { key });
  } else {
    console.log('::notice::No BRAVE_SEARCH_API_KEY and no --urls file; skipping Reclub club discovery.');
    writeFileSync(out, `${JSON.stringify({ candidates: [] }, null, 2)}\n`);
    return;
  }
  const result = await discover({ options: opts, search, queries: batch });
  result.candidates = result.candidates.map((c) => ({ ...c, body: prBody(c) }));
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`::notice::Reclub discovery: searched ${result.searched} queries, got ${result.urls} reclub.co links, read ${result.pagesRead} Reclub pages, ${result.candidates.length} new clubs.`);
  for (const c of result.candidates) console.log(`New club: ${c.name} (@${c.slug}), ${c.reason}`);
  for (const r of result.rejected) console.log(`Skipped @${r.club}: ${r.reason}`);
  for (const w of result.warnings) console.log(`::warning::${w}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
