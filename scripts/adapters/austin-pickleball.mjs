// City-published recurrences, not live reservations. Only reviewed venue blocks are
// eligible. Changed/removed blocks are quarantined (not kept as successful events).
// Each successful fetch produces a short dated window, capped by a separate review
// deadline. An unchanged HTTP response must never extend that deadline.
import { get } from '../../lib/http.js';
import { contentHash } from '../../lib/health.js';
import { addDays, dowName } from '../../lib/time.js';

export const id = 'austin-pickleball';
export const needsBrowser = false;
export const SOURCE = 'https://www.austintexas.gov/parks/programs/pickleball';
const DAYS = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?';
const TIME = '(\\d{1,2})(?::(\\d{2}))?\\s*([ap])\\.?\\s*m\\.?';
const SLOT = new RegExp(`(${DAYS}(?:\\s*(?:,|and|&)\\s*${DAYS})*)\\s*[:,]?\\s*${TIME}\\s*(?:to|[-–—])\\s*${TIME}`, 'gi');
const dateValid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && !Number.isNaN(Date.parse(d));

function text(html) {
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();
}

/** Only the recreation-program accordion; never all-day park/court opening hours. */
export function blocks(html) {
  const start = html.indexOf('Pickleball Programming at Rec Centers');
  const section = start < 0 ? null : html.slice(start).match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/i)?.[1];
  if (!section) throw new Error('City pickleball programming section not found');
  const out = new Map();
  for (const block of section.split(/<hr\b[^>]*>/i)) {
    const name = text(block.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '');
    if (!name) continue;
    // Exclude contact numbers from captured fixtures and fingerprints.
    const clean = text(block).replace(/\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]\d{4}/g, '').replace(/\s+/g, ' ').trim();
    if (out.has(name)) throw new Error(`Duplicate city venue block: ${name}`);
    out.set(name, clean);
  }
  if (!out.size) throw new Error('City pickleball venue blocks not found');
  return out;
}

const clock = (hour, minute, period) => {
  if (+hour < 1 || +hour > 12 || +(minute || 0) > 59) throw new Error('Invalid open-play clock');
  return `${String((+hour % 12) + (period.toLowerCase() === 'p' ? 12 : 0)).padStart(2, '0')}:${minute || '00'}`;
};

/** Strict schedule grammar. Unrecognized extra clauses invalidate the venue. */
export function slots(block) {
  // Labels seen on the city page: "Open play:", "Open Play Schedule:" and a bare "Open Play"
  // heading over one line per day. Anything else after the label still fails the remainder check.
  const at = block.search(/\bOpen play\b/i);
  if (at < 0) throw new Error('No explicit open-play schedule');
  const schedule = block.slice(at).replace(/^Open play(?:\s+schedule)?\s*:?\s*/i, '').split(/Equipment Rental/i)[0].trim();
  const result = [];
  for (const m of schedule.matchAll(SLOT)) {
    const start = clock(m[2], m[3], m[4]), end = clock(m[5], m[6], m[7]);
    if (end <= start) throw new Error('Invalid open-play time range');
    result.push({ days: [...m[1].matchAll(new RegExp(DAYS, 'gi'))].map((d) => d[0].slice(0, 3)), start, end });
  }
  const remainder = schedule.replace(SLOT, '').replace(/\band\b|[\s,.;]/gi, '');
  if (!result.length || remainder) throw new Error('Unrecognized open-play schedule; review required');
  return result;
}

export function parse(html, ref, options) {
  if (!dateValid(ref) || !dateValid(options.reviewedThrough)) throw new Error('Missing valid review dates');
  if (!options.venues?.length) throw new Error('No reviewed city venues configured');
  const sections = blocks(html), sessions = [], warnings = [];
  if (ref > options.reviewedThrough) return { sessions, warnings: ['City pickleball review expired; reconcile venue pages and holiday holds before extending reviewedThrough.'] };
  if (addDays(ref, 7) >= options.reviewedThrough) warnings.push(`City pickleball review due by ${options.reviewedThrough}; check venue schedules and holiday holds before extending.`);
  const days = options.horizonDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error('City horizonDays must be 1–14');
  const excluded = new Set(options.excludeDates ?? []);
  for (const v of options.venues) {
    const block = sections.get(v.venue);
    if (!block || contentHash(block) !== v.reviewedHash) {
      warnings.push(`${v.venue}: source block ${block ? `changed (fingerprint ${contentHash(block)})` : 'disappeared'}; withheld until reviewed`);
      continue;
    }
    let schedule;
    try { schedule = slots(block); }
    catch (e) { warnings.push(`${v.venue}: ${e.message}`); continue; }
    for (let n = 0; n < days; n++) {
      const date = addDays(ref, n);
      if (date > options.reviewedThrough || excluded.has(date)) continue;
      for (const [slot, s] of schedule.entries()) {
        if (!s.days.includes(dowName(date))) continue;
        sessions.push({ id: `pickleball-${v.id}-${slot}-${date}`, sport: 'pickleball', date,
          start: s.start, end: s.end, title: `${v.venue} · Pickleball open play`,
          venue: v.venue, city: 'Austin', surface: v.surface, type: 'Open play',
          scheduleBasis: 'published_recurring_hours', reviewBy: options.reviewedThrough,
          price: 'Price not published — confirm with venue',
          note: `${v.note} City-published recurring hours, not a live reservation. Confirm changes and access before going. Holiday dates are withheld pending venue confirmation.`,
          signup: { url: v.url, label: 'Venue details' }, source: SOURCE });
      }
    }
  }
  return { sessions, warnings, contentHash: contentHash(options.venues.map((v) => sections.get(v.venue) ?? 'missing').join('\n')) };
}

export async function scrape({ ref, options, fetch }) {
  const res = await get(SOURCE, { fetch });
  if (!res.ok) throw new Error(`Austin pickleball page: HTTP ${res.status}`);
  return parse(res.text, ref, options);
}
