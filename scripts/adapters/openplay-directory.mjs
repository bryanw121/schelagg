import { get } from '../../lib/http.js';
import { pageObjects, findObject } from '../../lib/public-page-data.js';
import { addDays, localDateTime } from '../../lib/time.js';
import { contentHash } from '../../lib/health.js';

export const needsBrowser = false;
export const SOURCE = 'https://openplaymap.com/open-play/austin';
// Names that say a session is not open to every player (private bookings, ladies/men-only,
// members-only, invite-only). Not public drop-in, so never imported as open play.
const RESTRICTED = /\b(private|ladies|women|womens|men|mens|invite|invitation|invitational|only)\b/i;

export function eventTimes(start, end, timezone = 'America/Chicago') {
  const a = Date.parse(String(start).replace(/^\$D/, '')), b = Date.parse(String(end).replace(/^\$D/, ''));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 12 * 3600000) throw new Error('Invalid event times');
  const s = localDateTime(a, timezone), e = localDateTime(b, timezone);
  if (s.date !== e.date && !(addDays(s.date, 1) === e.date && e.time === '00:00')) throw new Error('Unsupported overnight event');
  return { date: s.date, start: s.time, end: s.date === e.date ? e.time : '24:00' };
}

export function parse(html, ref, options, timezone) {
  const data = findObject(pageObjects(html), (x) => Array.isArray(x.initialData?.events))?.initialData;
  if (!data) throw new Error('OpenPlay directory event list missing');
  const checked = Date.parse(data.checkedAt);
  if (data.mode !== 'live' || data.freshnessStatus !== 'fresh' || !Number.isFinite(checked)
    || localDateTime(checked, timezone).date < addDays(ref, -2)) throw new Error('OpenPlay directory data is stale or not live');
  const updated = new Date(checked).toLocaleString('en-US', { timeZone: timezone ?? 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const sessions = [], warnings = [], seen = new Set();
  for (const e of data.events) {
    const venue = options.venues.find((v) => v.slug === e.venueSlug);
    if (!venue || e.preview || !/open\s*play/i.test(e.name ?? '') || RESTRICTED.test(e.name)) continue;
    try {
      const url = new URL(e.bookingUrl);
      const validPath = venue.bookingPathPrefix
        ? url.pathname.startsWith(venue.bookingPathPrefix) && /^\d+$/.test(url.searchParams.get('resId') ?? '')
        : /^\/community\/events\/[a-z0-9-]+$/.test(url.pathname);
      if (url.protocol !== 'https:' || url.hostname !== venue.bookingHost || !validPath) throw new Error('Unexpected booking URL');
      for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key);
      const times = eventTimes(e.startsAt, e.endsAt, timezone);
      if (times.date < ref || times.date > addDays(ref, 14)) continue;
      const id = `openplay-${venue.slug}-${venue.bookingPathPrefix ? contentHash(url.pathname + url.search) : url.pathname.split('/').pop()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      let price = typeof e.price === 'number' && Number.isFinite(e.price) && e.price >= 0
        ? `$${e.price} / person (listed)` : 'Price not listed';
      const rate = venue.openPlayRate;
      const useRate = price === 'Price not listed' && rate && times.date <= rate.reviewBy
        && (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60000 === rate.minutes;
      if (useRate) price = `$${rate.amount} / person (venue rate; confirm)`;
      sessions.push({ id, ...times, sport: 'pickleball', title: e.name, venue: venue.name, city: venue.city ?? 'Austin',
        surface: e.indoor === true ? 'indoor' : e.indoor === false ? 'outdoor' : venue.surface ?? 'unspecified', type: 'Open play',
        ...(e.skillLabel && e.skillLabel !== 'All levels' ? { level: e.skillLabel } : {}), price,
        ...(useRate ? { priceSource: rate.url } : {}),
        scheduleBasis: 'directory_listing',
        note: `Listed by OpenPlay, an independent directory, updated ${updated} Austin time. Confirm time, skill requirements, final price and availability with the venue. Membership discounts may apply.`,
        source: SOURCE, signup: { url: url.href, label: 'Book with venue' } });
    } catch (err) { warnings.push(`${venue.name}: ${err.message}; event withheld`); }
  }
  return { sessions, warnings };
}

export async function scrape({ ref, options, timezone, fetch }) {
  const res = await get(SOURCE, { fetch });
  if (!res.ok) throw new Error(`OpenPlay directory: HTTP ${res.status}`);
  return parse(res.text, ref, options, timezone);
}
