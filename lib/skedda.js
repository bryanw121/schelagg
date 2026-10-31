// Reads public Skedda booking calendars (no login) and turns them into
// per-court busy blocks and opening hours for a date range.
//
// Skedda hides who booked each slot from the public, so we only ever get times.
import { addDays, dow, toHHMM } from './time.js';
import { loadRegions } from './regions.js';

/**
 * Skedda opens its booking calendar on a given day with ?viewdate=YYYY-MM-DD.
 * Published as `calendarDay` (a template with {date}) so consumers can link
 * straight to the day someone is looking at without knowing the platform.
 */
export const skeddaDayUrl = (calendar) => `${calendar}?viewdate={date}`;

/**
 * Every region's Skedda court calendars (config/regions/<id>/courts.json), each venue tagged with
 * its region. Read once at load; the scrape and the courts API both use it.
 */
export const loadCourtVenues = () => loadRegions().flatMap((r) => r.courts.map((v) => ({ ...v, region: r.info.id })));
export const VENUES = loadCourtVenues();

const UA = 'Mozilla/5.0 (compatible; VolleyATX/0.2; +https://github.com/)';

/** Load the booking page, then use its anti-forgery token + cookies to call the JSON endpoints. */
export async function fetchSkedda(host, fromIso, toIso, { fetchImpl = fetch } = {}) {
  const page = await fetchImpl(`https://${host}/booking`, { headers: { 'user-agent': UA }, redirect: 'follow' });
  if (!page.ok) throw new Error(`${host} booking page HTTP ${page.status}`);
  const origin = new URL(page.url || `https://${host}/booking`).origin; // skedda.com may redirect to allbooked.com
  const html = await page.text();
  const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new Error(`${host}: no verification token on booking page`);
  const setCookies = page.headers.getSetCookie?.() ?? [page.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const headers = { 'user-agent': UA, accept: 'application/json', 'x-skedda-requestverificationtoken': token, cookie };

  const [websRes, listRes] = await Promise.all([
    fetchImpl(`${origin}/webs`, { headers }),
    fetchImpl(`${origin}/bookingslists?start=${fromIso}T00:00:00&end=${toIso}T23:59:59.999`, { headers }),
  ]);
  if (!websRes.ok) throw new Error(`${host} /webs HTTP ${websRes.status}`);
  if (!listRes.ok) throw new Error(`${host} /bookingslists HTTP ${listRes.status}`);
  const webs = await websRes.json();
  const list = await listRes.json();
  if (!Array.isArray(list.bookings)) throw new Error(`${host}: unexpected bookings response`);
  return { webs, bookings: list.bookings };
}

/** Map of space id -> name, found anywhere in the /webs payload. */
export function spaceNames(webs) {
  const out = {};
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      if (typeof v.name === 'string' && v.id && 'venue' in v && 'nonAdminVisible' in v) out[String(v.id)] = v.name;
      Object.values(v).forEach(walk);
    }
  };
  walk(webs);
  return out;
}

/** Opening hours per weekday (0 = Sun) as [openMin, closeMin], from the venue's availability rules. */
export function openingHours(webs) {
  const rules = webs?.venue?.[0]?.hoursOfAvailability?.rules ?? [];
  const hours = Array.from({ length: 7 }, () => null);
  for (const r of rules) {
    if (r.spaceIds) continue; // venue-wide rules only
    for (let d = 0; d < 7; d++) {
      if (!(r.daysBitmask & (1 << d))) continue;
      const cur = hours[d];
      hours[d] = cur ? [Math.min(cur[0], r.start), Math.max(cur[1], r.end)] : [r.start, r.end];
    }
  }
  return hours;
}

const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** Dates (YYYY-MM-DD) a booking occurs on within [fromIso, toIso]. Handles Skedda's weekly/daily RRULEs. */
export function occurrences(booking, fromIso, toIso) {
  const startDate = booking.start.slice(0, 10);
  const rr = booking.recurrenceRule;
  if (!rr) return startDate >= fromIso && startDate <= toIso ? [startDate] : [];

  const get = (k) => rr.match(new RegExp(`${k}=([^;\\r\\n]+)`))?.[1] ?? null;
  const freq = get('FREQ');
  const interval = Number(get('INTERVAL') || 1);
  const until = get('UNTIL') ? ymd(get('UNTIL')) : null;
  const count = get('COUNT') ? Number(get('COUNT')) : null;
  const byday = (get('BYDAY') || '').split(',').filter(Boolean).map((d) => BYDAY[d]);
  const exdates = new Set((rr.match(/EXDATE:([^\r\n]+)/)?.[1] || '').split(',').filter(Boolean).map(ymd));

  const out = [];
  const startDow = dow(startDate);
  const weekStart = addDays(startDate, -startDow);
  let n = 0;
  for (let i = 0, d = startDate; d <= toIso; i++, d = addDays(startDate, i)) {
    if (until && d > until) break;
    let hit = false;
    if (freq === 'WEEKLY') {
      const week = Math.floor((Date.parse(d) - Date.parse(weekStart)) / (7 * 864e5));
      hit = week % interval === 0 && (byday.length ? byday.includes(dow(d)) : dow(d) === startDow);
    } else if (freq === 'DAILY') {
      hit = i % interval === 0;
    } else {
      hit = i === 0; // unknown rule: keep the first occurrence only
    }
    if (!hit) continue;
    n++; // COUNT includes excluded dates per RFC 5545
    if (count && n > count) break;
    if (exdates.has(d)) continue;
    if (d >= fromIso) out.push(d);
  }
  return out;
}

/** Merge overlapping [startMin, endMin] blocks. */
export function merge(blocks) {
  const sorted = [...blocks].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** { [spaceName]: { [date]: [[startMin, endMin], ...] } } for the range. */
export function busyBySpace(bookings, names, fromIso, toIso) {
  const out = {};
  for (const b of bookings) {
    const s = toMinutes(b.start), e = toMinutes(b.end) || 1440;
    for (const date of occurrences(b, fromIso, toIso)) {
      for (const id of b.spaces || []) {
        const name = names[String(id)] ?? String(id);
        ((out[name] ||= {})[date] ||= []).push([s, e <= s ? 1440 : e]);
      }
    }
  }
  for (const days of Object.values(out)) for (const d of Object.keys(days)) days[d] = merge(days[d]);
  return out;
}
const toMinutes = (iso) => { const t = iso.slice(11, 16); const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Everything the UI needs for one venue over the range. Times are returned as "HH:MM". */
export async function loadVenue(venue, fromIso, days, opts) {
  const toIso = addDays(fromIso, days - 1);
  const { webs, bookings } = await fetchSkedda(venue.host, fromIso, toIso, opts);
  const names = spaceNames(webs);
  const hours = openingHours(webs);
  const busy = busyBySpace(bookings, names, fromIso, toIso);
  const fmt = (blocks) => blocks.map(([a, b]) => [toHHMM(a), toHHMM(b)]);
  return {
    id: venue.id,
    ...(venue.region ? { region: venue.region } : {}),
    ...(venue.note ? { note: venue.note } : {}),
    calendar: venue.calendar,
    calendarDay: skeddaDayUrl(venue.calendar),
    hours: hours.map((h) => (h ? [toHHMM(h[0]), toHHMM(h[1])] : null)),
    facilities: venue.facilities.map((f) => ({
      ...f,
      courts: f.spaces.map((name) => ({
        name,
        days: Object.fromEntries(Object.entries(busy[name] || {}).map(([d, bl]) => [d, fmt(bl)])),
      })),
    })),
  };
}
