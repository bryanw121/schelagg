// Sport discovery (#21): give it a sport and a region, and it finds the venues, works out where
// each one publishes its schedule, and writes what it found for review.
//
//   node scripts/discover.mjs <sport> <region>            write discovered-<sport>.json + .md
//   node scripts/discover.mjs <sport> <region> --apply    also add the new venues to config/venues.json
//
// 1. Venues: OpenStreetMap via Overpass (free, storable, has coordinates), plus Google Places
//    Text Search when GOOGLE_PLACES_API_KEY is set (asked for place ids, names and websites only;
//    only the place id is stored, per Google's terms).
// 2. Each venue is matched to config/venues.json (OSM id, Google place id, or name); new ones are
//    candidates, known ones may get coordinates / ids filled in.
// 3. Schedule surface: the venue's website is fetched (homepage plus up to 3 schedule-looking
//    links on the same site) and matched against config/platforms.json, e.g. a DaySmart calendar
//    link -> "platform:daysmart, company chaparralice", which the daysmart adapter can read.
//
// The "Discover venues" workflow runs it weekly per sport and opens one pull request per sport.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { get } from '../lib/http.js';
import { loadEnv, repoPath } from '../lib/paths.js';
import { loadVenues, venueIndex } from '../lib/consolidate.js';

// Public Overpass instances, tried in order until one answers (the main one can refuse a client).
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OVERPASS_UA = 'Schelagg/0.4 (schedule aggregator; +https://github.com/bryanw121/schelagg)';
const PLACES = 'https://places.googleapis.com/v1/places:searchText';
const SCHEDULE_WORDS = /schedule|calendar|open[- ]?play|public[- ]?skat|drop[- ]?in|book|reserve|sessions|hours/i;
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 60).replace(/-+$/, '');

export const loadDiscovery = (path = repoPath('config/discovery.json')) => JSON.parse(readFileSync(path, 'utf8'));
export const loadPlatforms = (path = repoPath('config/platforms.json')) => JSON.parse(readFileSync(path, 'utf8')).platforms;

/** The box (south, west, north, east) around a point, radiusKm each way. */
export function bbox([lat, lng], radiusKm) {
  const dLat = radiusKm / 111.32, dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const r = (x) => +x.toFixed(4);
  return [r(lat - dLat), r(lng - dLng), r(lat + dLat), r(lng + dLng)];
}

/** The Overpass QL for a sport's selectors in the box around a point (a global bbox is far cheaper than around:). */
export function overpassQuery(selectors, center, radiusKm) {
  return `[out:json][timeout:90][bbox:${bbox(center, radiusKm).join(',')}];(${selectors.map((s) => `${s};`).join('')});out tags center;`;
}

/** Overpass JSON -> venues: { name, osm, lat, lng, website, city, indoor, lit, courts, access, openingHours, sports }. */
export function parseOverpass(json) {
  const out = [];
  for (const e of json?.elements ?? []) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    const name = t.name ?? t['name:en'];
    if (!name || lat == null) continue; // unnamed courts: a court exists, nothing to list
    const indoor = t.indoor === 'yes' || ['sports_hall', 'sports_centre'].includes(t.leisure) || t.building != null ? true
      : t.indoor === 'no' || t.leisure === 'pitch' ? false : null;
    out.push({
      name, osm: `${e.type}/${e.id}`, lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6),
      website: t.website ?? t['contact:website'] ?? t.url ?? null,
      city: t['addr:city'] ?? null,
      indoor, lit: t.lit === 'yes' ? true : t.lit === 'no' ? false : null,
      courts: Number.isFinite(+t.courts) && +t.courts > 0 ? +t.courts : null,
      access: t.access ?? (t.fee === 'yes' ? 'fee' : null),
      openingHours: t.opening_hours ?? null,
      seasonal: t.seasonal === 'yes' || null,
      sports: String(t.sport ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    });
  }
  // One entry per OSM object, and per name+place (a rink mapped as both a building and an area).
  const seen = new Set();
  return out.filter((v) => { const k = `${norm(v.name)}@${v.lat.toFixed(3)},${v.lng.toFixed(3)}`; if (seen.has(k) || seen.has(v.osm)) return false; seen.add(k); seen.add(v.osm); return true; });
}

/** Run an Overpass query (POSTed as a form), trying each public instance until one answers. */
export async function overpass(query, { fetch: f = globalThis.fetch, endpoints = OVERPASS } = {}) {
  const errors = [];
  for (const url of endpoints) {
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: '*/*', 'user-agent': OVERPASS_UA },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(await res.text());
    } catch (e) { errors.push(`${new URL(url).hostname} ${e.message}`); }
  }
  throw new Error(errors.join(', '));
}

/** Google Places Text Search (New): place ids, names and websites for one query. Only ids are kept long-term. */
export async function googleSearch(query, { key, center, radiusKm, includedType, fetch: f = globalThis.fetch }) {
  const body = { textQuery: query, pageSize: 20, locationBias: { circle: { center: { latitude: center[0], longitude: center[1] }, radius: Math.min(radiusKm * 1000, 50000) } } };
  if (includedType) body.includedType = includedType;
  const res = await f(PLACES, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': 'places.id,places.displayName,places.websiteUri' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  return ((await res.json()).places ?? []).map((p) => ({ googlePlaceId: p.id, name: p.displayName?.text ?? null, website: p.websiteUri ?? null }));
}

/** Links, iframes and scripts on a page, absolute. */
export function pageLinks(html, base) {
  const urls = [];
  for (const m of String(html).matchAll(/\b(?:href|src|data-src)\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    try { urls.push(new URL(m[1].replace(/&amp;/g, '&'), base).href); } catch { /* not a URL */ }
  }
  return [...new Set(urls)];
}

/** Which platforms a set of URLs points at: [{ id, label, url, company?, adapter?, loginOnly?, ticketsOnly? }]. */
export function detectPlatforms(urls, platforms) {
  const found = new Map();
  for (const url of urls) {
    let host = '';
    try { host = new URL(url).hostname; } catch { continue; }
    for (const p of platforms) {
      const hit = (p.hosts ?? []).some((h) => host === h || host.endsWith(`.${h}`)) || (p.patterns ?? []).some((re) => new RegExp(re, 'i').test(url));
      if (!hit || found.has(p.id)) continue;
      const company = p.company ? url.match(new RegExp(p.company, 'i'))?.[1] ?? null : null;
      found.set(p.id, { id: p.id, label: p.label, url, ...(company ? { company } : {}), ...(p.adapter ? { adapter: p.adapter } : {}), ...(p.loginOnly ? { loginOnly: true } : {}), ...(p.ticketsOnly ? { ticketsOnly: true } : {}) });
    }
  }
  return [...found.values()];
}

/**
 * Where a venue publishes its schedule, from its website: the homepage plus up to `follow`
 * same-site links that look like schedule pages. Returns { surface, platforms, checked }:
 * surface is platform:<id> (a readable platform first), login_only, tickets_only, website, or unknown.
 */
export async function classifySchedule(website, { platforms, fetch, follow = 3, delayMs = 500 }) {
  if (!website) return { surface: 'unknown', platforms: [], checked: [] };
  const checked = [], urls = [];
  const read = async (u) => {
    if (checked.length) await new Promise((r) => setTimeout(r, delayMs));
    checked.push(u);
    const res = await get(u, { fetch, timeoutMs: 15000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text;
  };
  let home;
  try { home = await read(website); } catch (e) { return { surface: 'unknown', platforms: [], checked, error: e.message }; }
  const links = pageLinks(home, website);
  urls.push(...links);
  const site = new URL(website).hostname.replace(/^www\./, '');
  const next = links.filter((u) => { try { return new URL(u).hostname.replace(/^www\./, '') === site && SCHEDULE_WORDS.test(u); } catch { return false; } }).slice(0, follow);
  for (const u of next) {
    try { urls.push(...pageLinks(await read(u), u)); } catch { /* skip a page that won't load */ }
  }
  const found = detectPlatforms(urls, platforms);
  const readable = found.find((p) => p.adapter) ?? found.find((p) => !p.loginOnly && !p.ticketsOnly);
  const surface = readable ? `platform:${readable.id}` : found.some((p) => p.loginOnly) ? 'login_only'
    : found.some((p) => p.ticketsOnly) ? 'tickets_only' : 'website';
  return { surface, platforms: found, checked };
}

/** Match discovered places to the registry: { known: [{ venue, place }], fresh: [place] }. */
export function matchVenues(places, venues, ignore = []) {
  const byName = venueIndex(venues);
  const byOsm = new Map(venues.filter((v) => v.osm).map((v) => [v.osm, v.id]));
  const byGoogle = new Map(venues.filter((v) => v.googlePlaceId).map((v) => [v.googlePlaceId, v.id]));
  const skip = new Set(ignore.map(norm));
  const known = [], fresh = [];
  for (const p of places) {
    if (skip.has(norm(p.name)) || (p.osm && skip.has(norm(p.osm)))) continue;
    const id = (p.osm && byOsm.get(p.osm)) || (p.googlePlaceId && byGoogle.get(p.googlePlaceId)) || byName.get(norm(p.name));
    if (id) known.push({ venue: id, place: p });
    else fresh.push(p);
  }
  return { known, fresh };
}

/** Merge Google results into OSM ones by name (Google adds place id / website), others become places of their own. */
export function mergePlaces(osm, google) {
  const out = osm.map((p) => ({ ...p }));
  for (const g of google) {
    const same = out.find((p) => norm(p.name) === norm(g.name));
    if (same) { same.googlePlaceId ??= g.googlePlaceId; same.website ??= g.website; }
    else if (!out.some((p) => p.googlePlaceId === g.googlePlaceId)) out.push({ name: g.name, googlePlaceId: g.googlePlaceId, website: g.website, lat: null, lng: null, osm: null, sports: [] });
  }
  return out;
}

/** A config/venues.json entry for a new place. */
export function venueEntry(p, sport, schedule) {
  return {
    id: slug(p.name), name: p.name, city: p.city ?? null, aliases: [],
    sports: [sport], osm: p.osm ?? null, googlePlaceId: p.googlePlaceId ?? null, lat: p.lat ?? null, lng: p.lng ?? null,
    website: p.website ?? null,
    ...(p.indoor != null ? { indoor: p.indoor } : {}), ...(p.lit != null ? { lit: p.lit } : {}),
    ...(p.courts ? { courts: p.courts } : {}), ...(p.access ? { access: p.access } : {}), ...(p.seasonal ? { seasonal: true } : {}),
    schedule: schedule ? { surface: schedule.surface, ...(schedule.platforms?.[0] ? { platform: schedule.platforms[0].id, url: schedule.platforms[0].url, ...(schedule.platforms[0].company ? { company: schedule.platforms[0].company } : {}) } : {}) } : { surface: 'unknown' },
  };
}

/** Fill gaps (osm id, google place id, coordinates, website) on known venues; never overwrite. Returns [{ id, fields }]. */
export function enrichments(known, venues) {
  const out = [];
  for (const { venue, place } of known) {
    const v = venues.find((x) => x.id === venue);
    const fields = {};
    for (const k of ['osm', 'googlePlaceId', 'lat', 'lng', 'website']) if (v[k] == null && place[k] != null) fields[k] = place[k];
    if (Object.keys(fields).length) out.push({ id: venue, fields });
  }
  return out;
}

/** The whole run for one sport and region. `google` is null without a key. */
export async function discover({ sport, region, discovery, platforms, venues, fetch, google = null, classify = true, delayMs = 500 }) {
  const reg = discovery.regions[region];
  const sp = discovery.sports[sport];
  if (!reg) throw new Error(`unknown region "${region}"`);
  if (!sp) throw new Error(`unknown sport "${sport}"`);
  const warnings = [];
  let osm = [];
  try {
    const q = overpassQuery(sp.osm, reg.center, reg.radiusKm);
    osm = parseOverpass(await overpass(q, { fetch }));
  } catch (e) { warnings.push(`OpenStreetMap: ${e.message}`); }
  const googlePlaces = [];
  if (google && sp.google) {
    for (const q of sp.google.queries ?? []) {
      try { googlePlaces.push(...await google(q, { center: reg.center, radiusKm: reg.radiusKm, includedType: sp.google.includedType })); }
      catch (e) { warnings.push(`Google "${q}": ${e.message}`); }
    }
  }
  const places = mergePlaces(osm, googlePlaces);
  const { known, fresh } = matchVenues(places, venues, sp.ignore);
  const candidates = [];
  for (const p of fresh) {
    const schedule = classify ? await classifySchedule(p.website, { platforms, fetch, delayMs }) : null;
    candidates.push({ place: p, schedule, entry: venueEntry(p, sport, schedule) });
  }
  // Ids must stay unique: a second "Pickleball Courts" gets its OSM id appended.
  const ids = new Set(venues.map((v) => v.id));
  for (const c of candidates) {
    if (!c.entry.id || ids.has(c.entry.id)) c.entry.id = slug(`${c.place.name} ${(c.place.osm ?? c.place.googlePlaceId ?? '').replace(/\//g, ' ')}`);
    ids.add(c.entry.id);
  }
  return { sport, region, counts: { osm: osm.length, google: googlePlaces.length, known: known.length, new: candidates.length }, candidates, enrich: enrichments(known, venues), warnings };
}

/** Markdown for the review pull request. */
export function reportMarkdown(r) {
  const row = (c) => {
    const p = c.place, s = c.schedule;
    const where = [p.city, p.indoor === true ? 'indoor' : p.indoor === false ? 'outdoor' : null, p.courts ? `${p.courts} courts` : null, p.lit ? 'lit' : null].filter(Boolean).join(' · ');
    const plat = s?.platforms?.length ? s.platforms.map((x) => `${x.label}${x.company ? ` (\`${x.company}\`)` : ''}`).join(', ') : '';
    return `| ${p.name} | ${where || '–'} | ${s?.surface ?? '–'}${plat ? `: ${plat}` : ''} | ${p.website ? `[site](${p.website})` : '–'} | ${p.osm ? `[osm](https://www.openstreetmap.org/${p.osm})` : 'Google'} |`;
  };
  const readable = r.candidates.filter((c) => c.schedule?.platforms?.some((p) => p.adapter));
  return [
    `Discovery for **${r.sport}** around **${r.region}**: ${r.counts.osm} places in OpenStreetMap${r.counts.google ? `, ${r.counts.google} from Google` : ''}; ${r.counts.known} already known, **${r.counts.new} new**.`,
    '',
    r.candidates.length ? '| Venue | Place | Schedule | Website | Source |\n|---|---|---|---|---|\n' + r.candidates.map(row).join('\n') : '_No new venues._',
    '',
    readable.length ? `**Readable now:** ${readable.map((c) => `${c.place.name} (${c.schedule.platforms.find((p) => p.adapter).adapter})`).join(', ')}. Add a source in \`config/sources.json\` for each to start scraping.` : '',
    r.enrich.length ? `**Filled in on known venues:** ${r.enrich.map((e) => `\`${e.id}\` (${Object.keys(e.fields).join(', ')})`).join(', ')}.` : '',
    r.warnings.length ? `**Warnings:** ${r.warnings.join('; ')}` : '',
    '',
    'Merging adds these to `config/venues.json`. Delete any you don\'t want from this branch first; to never see one again, add its name or OSM id to `ignore` for this sport in `config/discovery.json`.',
  ].filter((l) => l !== '').join('\n');
}

/** New venues and fills applied to the venues config text (unchanged text when there's nothing to apply). */
export function applyToVenues(text, r) {
  if (!r.enrich.length && !r.candidates.length) return text;
  const cfg = JSON.parse(text);
  for (const e of r.enrich) {
    const v = cfg.venues.find((x) => x.id === e.id);
    if (v) for (const [k, val] of Object.entries(e.fields)) if (v[k] == null) v[k] = val;
  }
  const ids = new Set(cfg.venues.map((v) => v.id));
  for (const c of r.candidates) if (!ids.has(c.entry.id)) { cfg.venues.push(c.entry); ids.add(c.entry.id); }
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

async function main([sport, region = 'austin', flag]) {
  if (!sport) { console.error('usage: node scripts/discover.mjs <sport> [region] [--apply]'); process.exit(2); }
  loadEnv();
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const r = await discover({
    sport, region, discovery: loadDiscovery(), platforms: loadPlatforms(), venues: loadVenues(),
    google: key ? (q, o) => googleSearch(q, { ...o, key }) : null,
  });
  writeFileSync(repoPath(`discovered-${sport}.json`), `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(repoPath(`discovered-${sport}.md`), `${reportMarkdown(r)}\n`);
  console.log(`${sport}/${region}: ${r.counts.osm} OSM, ${r.counts.google} Google, ${r.counts.known} known, ${r.counts.new} new, ${r.enrich.length} to fill in`);
  for (const w of r.warnings) console.log(`::warning::${w}`);
  console.log(`::notice::${sport}: ${r.counts.osm} OSM places, ${r.counts.new} new venues`);
  if (flag === '--apply') {
    const p = repoPath('config/venues.json');
    writeFileSync(p, applyToVenues(readFileSync(p, 'utf8'), r));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
