// Austin Velocity adult open gym / open play at The Crossover. Seasonal: the adult hub page links
// to the current season's page, which lists the session dates, times and prices. Both are read
// through WordPress's public REST API (no browser), so the sessions switch on and off by
// themselves when Velocity posts a new season.
import { addDays, resolveMonthDay, to24, today } from '../../lib/time.js';
import { contentHash } from '../../lib/health.js';
import { get } from '../../lib/http.js';

export const id = 'velocity';
export const needsBrowser = false;
const SITE = 'https://www.austinvelocity.com';
const HUB = 'adult-volleyball-2';
const HUB_URL = `${SITE}/rentals/${HUB}/`;
/** Dated sessions this far ahead, like the schedule (lib/pipeline.js HORIZON_DAYS). */
const HORIZON_DAYS = 14;
const FIELDS = 'id,slug,modified,link,title,content';
export const pagesUrl = (slugs) => `${SITE}/wp-json/wp/v2/pages?slug=${slugs.map(encodeURIComponent).join(',')}&_fields=${FIELDS}`;

const DAY = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
const MONTH = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const DASH = '\\s*[\\u2013\\u2014-]\\s*';
const RANGE = new RegExp(`${MONTH}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?${DASH}${MONTH}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'i');
const CLOCK = '(\\d{1,2}(?::\\d{2})?)\\s*([AP]\\.?M\\.?)?';
// "Sundays • 5PM–8PM", "Sundays, 5:00–8:00PM"
const WEEKLY = new RegExp(`\\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*days?\\s*[•·,|]\\s*${CLOCK}${DASH}(Midnight|${CLOCK})`, 'i');

const ENTITIES = { amp: '&', nbsp: ' ', ndash: '–', mdash: '—', bull: '•', rsquo: '’', lsquo: '‘', quot: '"', apos: "'", '#8211': '–', '#8212': '—', '#8226': '•', '#038': '&', '#8217': '’' };
/** WordPress HTML -> plain text, one line per paragraph, heading or <br>. */
export const htmlText = (html) => String(html)
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

/** "5" + "PM" -> "17:00"; a start without AM/PM borrows the end's ("5–8PM"). */
const clock = (t, ampm, fallback) => {
  const suffix = (ampm || fallback || '').replace(/[\s.]/g, '');
  return suffix ? to24(`${t} ${suffix}`) : null;
};
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s/])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** Season pages the hub links to (other /rentals/ pages on the site). */
export function seasonSlugs(hubHtml) {
  const out = [];
  for (const m of String(hubHtml).matchAll(/href="https?:\/\/(?:www\.)?austinvelocity\.com\/rentals\/([a-z0-9-]+)\/?"/gi)) {
    if (m[1] !== HUB && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** "SESSION DATES" block ("November 15 & 22" / "December 6, 13, 20 & 27") -> ISO dates, resolved from `from`. */
export function sessionDates(text, from) {
  const block = String(text).split(/\n/);
  const i = block.findIndex((l) => /^session dates$/i.test(l));
  if (i < 0) return [];
  const dates = [];
  for (const line of block.slice(i + 1)) {
    const m = line.match(new RegExp(`^${MONTH}\\s+((?:\\d{1,2}(?:st|nd|rd|th)?\\s*(?:,|&|and)?\\s*)+)$`, 'i'));
    if (!m) break;
    for (const d of m[2].match(/\d{1,2}/g)) dates.push(resolveMonthDay(m[1], +d, from));
  }
  return dates.filter(Boolean).sort();
}

/** A season page in the current format (weekday line, season range, optional session dates). */
export function parseSeason(html, url, ref, horizonDays = HORIZON_DAYS) {
  const text = htmlText(html);
  const weekly = text.match(WEEKLY);
  const range = text.match(RANGE);
  if (!weekly || !range) return [];
  const day = DAY[weekly[1].toLowerCase().slice(0, 3)];
  const end = /midnight/i.test(weekly[4]) ? '24:00' : clock(weekly[5], weekly[6]);
  const start = clock(weekly[2], weekly[3], weekly[6]);
  const from = resolveMonthDay(range[1], +range[2], range[3] ? `${range[3]}-01-01` : ref);
  const until = from && resolveMonthDay(range[4], +range[5], range[6] ? `${range[6]}-01-01` : from);
  if (!start || !end || !from || !until) return [];
  const heading = text.split('\n').find((l) => /adult open (gym|play)/i.test(l) && l === l.toUpperCase());
  const online = text.match(/\$\s*(\d+)\s*(?:reserved )?online/i)?.[1];
  const door = text.match(/\$\s*(\d+)\s*at the door/i)?.[1];
  const age = text.match(/ages?\s*(\d{2})\s*(?:and up|\+)/i)?.[1] ?? text.match(/(\d{2}) or older/i)?.[1];
  const capacity = Number(text.match(/capped at (\d+) players/i)?.[1]) || undefined;
  const book = String(html).match(/href="([^"]+)"[^>]*>\s*Book a Single Session/i)?.[1]?.replace(/&amp;/g, '&');
  const base = {
    start, end,
    title: `Austin Velocity ${heading ? titleCase(heading) : 'Adult Open Gym'}`,
    venue: 'The Crossover', city: 'Cedar Park', surface: 'indoor', type: 'Open play',
    level: [/competitive/i.test(text) && 'Competitive', age && `${age}+`].filter(Boolean).join(' · ') || null,
    price: [online && `$${online} online`, door && `$${door} door`].filter(Boolean).join(' · ') || null,
    capacity,
    note: 'Self-called, no referees. Updates post on Instagram @austinvelocityadults.',
    signup: book ? { url: book, label: 'Book a session' } : { url, label: 'Dates & pricing' },
    source: url,
  };
  // The listed dates (which skip holidays) within the horizon; before the season, or with no list, the weekly window.
  const dates = sessionDates(text, from).filter((d) => d >= from && d <= until && d >= ref && d <= addDays(ref, horizonDays));
  if (dates.length) return dates.map((date) => ({ id: `velocity-${date}`, date, ...base }));
  if (until < ref) return [];
  return [{ id: `velocity-${day.toLowerCase()}`, days: [day], startsOn: from, validUntil: until, ...base }];
}

/** The summer format: "Season Dates: May 20 – August 14, 2026", then "Wednesday Open Play / Time: 8PM – Midnight / Level: ...". */
export function parseNights(text, url, ref) {
  const m = String(text).match(/Season Dates:\s*([A-Z][a-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})?/);
  if (!m) return [];
  const year = m[5] || ref.slice(0, 4);
  const from = resolveMonthDay(m[1], +m[2], `${year}-01-01`);
  const until = resolveMonthDay(m[3], +m[4], from);
  const nights = [];
  const block = (day) => text.match(new RegExp(`${day} Open Play[\\s\\S]{0,200}?Time:\\s*(\\d{1,2})\\s*PM\\s*[–-]\\s*(Midnight|\\d{1,2}\\s*PM)[\\s\\S]{0,200}?Level:\\s*([^\\n]+)`, 'i'));
  for (const [day, short] of [['Sunday', 'Sun'], ['Monday', 'Mon'], ['Tuesday', 'Tue'], ['Wednesday', 'Wed'], ['Thursday', 'Thu'], ['Friday', 'Fri'], ['Saturday', 'Sat']]) {
    const b = block(day);
    if (!b) continue;
    const end = /midnight/i.test(b[2]) ? '24:00' : `${String((+b[2].match(/\d+/)[0] % 12) + 12).padStart(2, '0')}:00`;
    nights.push({
      id: `velocity-${short.toLowerCase()}`, days: [short], start: `${String((+b[1] % 12) + 12).padStart(2, '0')}:00`, end,
      title: 'Austin Velocity Open Play', venue: 'The Crossover', city: 'Cedar Park', surface: 'indoor', type: 'Open play',
      level: b[3].trim(), startsOn: from, validUntil: until,
      note: 'Updates post on Instagram @austinvelocityadults.',
      signup: { url: 'https://www.instagram.com/austinvelocityadults/', label: 'Check Instagram for signup' }, source: url,
    });
  }
  return nights;
}

/**
 * WordPress pages ([{ slug, link, content: { rendered } }]) -> sessions. Season pages win; the hub
 * is read too, for seasons posted on it directly in either format.
 */
export function parse(pages, ref, horizonDays = HORIZON_DAYS) {
  const out = new Map();
  const fromHub = new Set();
  const ordered = [...pages].sort((a, b) => (a.slug === HUB) - (b.slug === HUB));
  for (const p of ordered) {
    const html = p.content?.rendered ?? '';
    const url = p.link || HUB_URL;
    const found = parseSeason(html, url, ref, horizonDays);
    for (const s of found.length ? found : parseNights(htmlText(html), url, ref)) {
      if (out.has(s.id)) continue;
      out.set(s.id, s);
      if (p.slug === HUB) fromHub.add(s.id);
    }
  }
  // A season page with dated sessions makes the hub's weekly summary of the same season redundant.
  if ([...out.values()].some((s) => s.date)) for (const k of fromHub) if (!out.get(k).date) out.delete(k);
  if (!out.size) throw new Error('No current or upcoming open-play season on the Velocity adult pages');
  return [...out.values()];
}

/** The lines this adapter depends on (season, nights, times, levels, prices), for lib/health.js. */
export const watchedText = (text) => String(text).split('\n').filter((l) => /season|open (play|gym)|time\s*:|level\s*:|\$\s*\d|sign.?up|book|instagram|sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|january|february|march|april|may|june|july|august|september|october|november|december/i.test(l)).join('\n');

async function pages(slugs, http) {
  const res = await get(pagesUrl(slugs), { ...http, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Velocity WordPress API HTTP ${res.status}`);
  let json;
  try { json = JSON.parse(res.text); } catch { throw new Error('Velocity WordPress API returned non-JSON'); }
  if (!Array.isArray(json)) throw new Error('Velocity WordPress API: expected a list of pages');
  return json;
}

export async function scrape({ ref = today(), fetch }) {
  const hub = await pages([HUB], { fetch });
  if (!hub.length) throw new Error(`Velocity adult page "${HUB}" not found (renamed?)`);
  const slugs = seasonSlugs(hub[0].content?.rendered);
  const seasons = slugs.length ? await pages(slugs, { fetch }) : [];
  const all = [...seasons, ...hub];
  return {
    sessions: parse(all, ref),
    contentHash: contentHash(watchedText(all.map((p) => htmlText(p.content?.rendered ?? '')).join('\n'))),
  };
}

/** Season pages change by hand; there's nothing faster to re-check. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
