// Open play published as prose on an official (city) page, with no machine-readable feed.
// Each venue's slots were read by a person and stored in config next to a fingerprint of
// the page text they were read from. A run re-reads the page and only emits sessions for a
// venue whose block still has that fingerprint; a changed, missing or ambiguous block is
// withheld with a warning (showing the new fingerprint) until someone re-reviews it.
// Like the Austin city adapter: a short dated window per successful fetch, capped by an
// editorial review deadline that a successful fetch never extends, and holiday holds.
import { get } from '../../lib/http.js';
import { contentHash } from '../../lib/health.js';
import { addDays, dowName } from '../../lib/time.js';

export const id = 'official-schedule';
export const needsBrowser = false;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SURFACES = ['indoor', 'outdoor', 'unspecified'];
const dateValid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && !Number.isNaN(Date.parse(d));
const timeValid = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t ?? '');
const ENTITIES = { nbsp: ' ', amp: '&', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', quot: '"', apos: "'" };

/** Page text: no scripts/styles/tags, entities decoded, whitespace collapsed. */
export function pageText(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}

/**
 * The venue's block: from its `from` marker (which must occur exactly once) up to the next
 * `to` marker. Contact emails and phone numbers are dropped so fixtures carry none and staff
 * changes alone don't withhold sessions. Returns null when the block can't be found.
 */
export function block(text, from, to) {
  const start = text.indexOf(from);
  if (start < 0 || text.indexOf(from, start + 1) >= 0) return null;
  const end = text.indexOf(to, start + from.length);
  if (end < 0) return null;
  return text.slice(start, end)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
    .replace(/\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]\d{4}/g, '')
    .replace(/\s+/g, ' ').trim();
}

function checkVenue(v) {
  if (!v.id || !v.venue || !v.city || !v.from || !v.to || !v.reviewedHash || !v.price || !/^https:\/\//.test(v.url ?? '')) throw new Error(`${v.venue ?? v.id}: incomplete venue config`);
  if (!SURFACES.includes(v.surface)) throw new Error(`${v.venue}: surface must be ${SURFACES.join(', ')}`);
  if (!v.slots?.length) throw new Error(`${v.venue}: no reviewed slots`);
  for (const s of v.slots) {
    if (!s.days?.length || !s.days.every((d) => DAY_NAMES.includes(d)) || !timeValid(s.start) || !timeValid(s.end) || s.end <= s.start) {
      throw new Error(`${v.venue}: invalid reviewed slot`);
    }
  }
}

export function parse(html, ref, options) {
  if (!dateValid(ref) || !dateValid(options.reviewedThrough)) throw new Error('Missing valid review dates');
  if (!/^https:\/\//.test(options.url ?? '')) throw new Error('Missing source url');
  if (!options.venues?.length) throw new Error('No reviewed venues configured');
  options.venues.forEach(checkVenue);
  const days = options.horizonDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error('horizonDays must be 1–14');
  const text = pageText(html);
  const found = options.venues.map((v) => block(text, v.from, v.to));
  // Nothing recognisable at all: a block page, a redesign or an error page. Fail the source
  // (keep-last-good flags it) rather than report a healthy run with no sessions.
  if (found.every((b) => b === null)) throw new Error('No reviewed venue block found on the page');
  const sessions = [], warnings = [];
  if (ref > options.reviewedThrough) {
    return { sessions, warnings: ['Pickleball review expired; reconcile the official page and holiday holds before extending reviewedThrough.'] };
  }
  if (addDays(ref, 7) >= options.reviewedThrough) warnings.push(`Pickleball review due by ${options.reviewedThrough}; recheck the official page and holiday holds before extending.`);
  const excluded = new Set(options.excludeDates ?? []);
  options.venues.forEach((v, i) => {
    const b = found[i];
    if (b === null) { warnings.push(`${v.venue}: source block missing or ambiguous; withheld until reviewed`); return; }
    if (contentHash(b) !== v.reviewedHash) { warnings.push(`${v.venue}: source block changed (fingerprint ${contentHash(b)}); withheld until reviewed`); return; }
    for (let n = 0; n < days; n++) {
      const date = addDays(ref, n);
      if (date > options.reviewedThrough || excluded.has(date)) continue;
      v.slots.forEach((s, slot) => {
        if (!s.days.includes(dowName(date))) return;
        sessions.push({ id: `pickleball-${v.id}-${slot}-${date}`, sport: 'pickleball', date,
          start: s.start, end: s.end, title: `${v.venue} · Pickleball open play`,
          venue: v.venue, city: v.city, surface: v.surface, type: 'Open play',
          scheduleBasis: 'published_recurring_hours', reviewBy: options.reviewedThrough,
          price: v.price,
          note: `${v.note ? `${v.note} ` : ''}City-published recurring hours, not a live reservation. Confirm changes and access before going. Holiday dates are withheld pending venue confirmation.`,
          signup: { url: v.url, label: 'Venue details' }, source: options.url });
      });
    }
  });
  return { sessions, warnings, contentHash: contentHash(found.map((b) => b ?? 'missing').join('\n')) };
}

export async function scrape({ ref, options, fetch }) {
  const res = await get(options.url, { fetch });
  if (!res.ok) throw new Error(`Official pickleball page: HTTP ${res.status}`);
  return parse(res.text, ref, options);
}
