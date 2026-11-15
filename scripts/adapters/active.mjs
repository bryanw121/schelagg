// City recreation programs listed on ACTIVE.com (e.g. the City of Fort Worth's community-center
// open plays). A city's listing page (www.active.com/<city>-tx/volleyball) links its programs;
// each program page has schema.org Event data (season start and end with times, the venue and
// address) and names its weekday ("September 07 - November 30, 2026 Monday"). Each program
// becomes a weekly session for its season, so a new season's page is picked up from the
// listing by itself. robots.txt allows these pages.
//
//   options.listings: [url]; options.include: title regex (default: volleyball, not other sports)
import { get } from '../../lib/http.js';

export const id = 'active';
export const needsBrowser = false;
const ORIGIN = 'https://www.active.com';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_INCLUDE = 'volleyball';
const OTHER_SPORTS = /basketball|pickle|table-tennis|tennis|soccer|badminton|futsal/i;

/** Program links on a listing page (absolute), volleyball ones only, in order. */
export function programLinks(html, include = DEFAULT_INCLUDE) {
  const want = new RegExp(include, 'i');
  const out = [];
  for (const m of String(html).matchAll(/href="(\/[a-z-]+-tx\/volleyball\/[a-z-]+\/[a-z0-9-]+-\d{6,})"/g)) {
    const slug = m[1].split('/').pop();
    if (!want.test(slug) || OTHER_SPORTS.test(slug)) continue;
    const u = ORIGIN + m[1];
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

const ldEvents = (html) => [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
  .filter((d) => d?.['@type'] === 'Event');

/** "2026-09-07T18:00:00.000-0500" → { date, time } as written (the city's own local time). */
const local = (s) => { const m = String(s).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/); return m ? { date: m[1], time: `${m[2]}:${m[3]}` } : null; };

/** A program page → a weekly session for its season, or null. */
export function parseProgram(html, url) {
  const ev = ldEvents(html)[0];
  const from = local(ev?.startDate), until = local(ev?.endDate);
  if (!from || !until) return null;
  const text = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const dayWords = text.match(/\d{4}\s+((?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)[,\s&]*)+)Add to calendar/)?.[1] ?? '';
  let days = [...dayWords.matchAll(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*/g)].map((m) => m[1]);
  if (!days.length) days = [DAYS[new Date(`${from.date}T12:00:00Z`).getUTCDay()]];
  const ages = text.match(/Ages\s+(\d+)\s*-\s*(\d+)/);
  const name = String(ev.name ?? '').replace(/\s+-\s+[A-Z][a-z]+(?: [A-Z][a-z]+)*, TX\b.*$/, '').replace(/^Open Play - /, 'Open Play: ').trim();
  const place = ev.location ?? {};
  const a = place.address ?? {};
  const pid = url.match(/-(\d{6,})$/)?.[1];
  return {
    id: `active-${pid}`,
    days: [...new Set(days)], start: from.time, end: until.time, startsOn: from.date, validUntil: until.date,
    title: name || 'Open play', venue: place.name ?? null, city: a.addressLocality ?? null,
    venueAddress: [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(', ') || undefined,
    surface: 'indoor', type: 'Open play',
    level: ages && +ages[1] >= 40 ? `Ages ${ages[1]}+` : 'All levels',
    price: null,
    note: [ev.organizer?.name ?? (/City of ([A-Z][\w ]+?) More events/.exec(text)?.[0]?.replace(/ More events$/, '')), 'Check the city page for fees and any skipped dates.'].filter(Boolean).join('. ').replace(/^City/, 'Run by the City') + '',
    signup: { url, label: 'Details on ACTIVE' }, source: url,
  };
}

export async function scrape({ options, fetch, ref }) {
  const listings = options?.listings ?? [];
  if (!listings.length) throw new Error('active: no listing pages configured');
  const links = [], warnings = [];
  for (const l of listings) {
    const res = await get(l, { fetch });
    if (!res.ok) { warnings.push(`${l}: HTTP ${res.status}`); continue; }
    for (const u of programLinks(res.text, options.include)) if (!links.includes(u)) links.push(u);
  }
  const sessions = [];
  for (const url of links.slice(0, options.max ?? 15)) {
    try {
      const r = await get(url, { fetch });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s = parseProgram(r.text, url);
      if (!s) throw new Error('no event data on the page');
      if (!ref || s.validUntil >= ref) sessions.push(s);
    } catch (e) { warnings.push(`${url}: ${e.message}`); }
  }
  if (!sessions.length && warnings.length === listings.length + links.length && warnings.length) throw new Error(warnings.join('; '));
  return { sessions, warnings };
}

export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
