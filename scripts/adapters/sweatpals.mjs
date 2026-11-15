// Sweatpals (sweatpals.com), where community hosts post open plays, clinics and tournaments. Each
// host's public page carries its upcoming events in Next.js's __NEXT_DATA__ (the same data the page
// renders: name, address, time zone, prices and every upcoming date as an instant), so one plain
// GET per host covers it; no browser. Hosts come from options.hosts, venues from options.venues.
import { addDays, endAfter, localDateTime, today } from '../../lib/time.js';
import { get } from '../../lib/http.js';
import { shapeUnion } from '../../lib/health.js';

export const id = 'sweatpals';
export const needsBrowser = false;
/** Event fields parse() reads. lib/health.js reports any that vanish. */
export const reads = ['id', 'alias', 'name', 'upcomingDays[]', 'upcomingDays[].times[]', 'tzid', 'addressName', 'prices[]', 'prices[].priceAmount', 'publishingState', 'fitnessTypeName'];
/** Dated sessions this far ahead, like the schedule (lib/pipeline.js HORIZON_DAYS). */
const HORIZON_DAYS = 14;

const ORIGIN = 'https://sweatpals.com';
export const hostUrl = (slug) => `${ORIGIN}/host/${encodeURIComponent(slug)}`;
export const eventUrl = (alias, date) => `${ORIGIN}/event/${encodeURIComponent(alias)}/${date}`;
const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
// The host page's event lists (react-query keys ['events', <host id>, <kind>]); "experiences" repeats the others.
const KINDS = new Set(['events', 'classes']);

/** A host page -> its upcoming events (deduplicated), or throws if the page has no event data. */
export function hostEvents(html) {
  const m = String(html).match(NEXT_DATA);
  if (!m) throw new Error('no __NEXT_DATA__ on the host page');
  let data;
  try { data = JSON.parse(m[1]); } catch { throw new Error('host page __NEXT_DATA__ is not JSON'); }
  const queries = data?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) throw new Error('host page has no dehydratedState.queries');
  const lists = queries.filter((q) => q.queryKey?.[0] === 'events' && KINDS.has(q.queryKey?.[2]));
  if (!lists.length) throw new Error('host page has no event lists');
  const out = new Map();
  for (const q of lists) for (const p of q.state?.data?.pages ?? []) for (const e of p.data ?? []) if (e?.id && !out.has(e.id)) out.set(e.id, e);
  return [...out.values()];
}

/** Open play / tournament / league / clinic from the event name. */
export function typeOf(name) {
  if (/tourn(ey|ament)|\bshowdown\b|\bslam\b/i.test(name)) return 'Tournament';
  if (/\bleague\b/i.test(name)) return 'League';
  if (/open play|open gym|pick.?up|drop.?in|\bopen\b/i.test(name)) return 'Open play';
  if (/clinic|drills?\b|lesson|technique|training|skills/i.test(name)) return 'Clinic';
  return 'Open play';
}

const dollars = (cents) => `$${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;
/** "$10", "$10–15", "Free" from the event's ticket tiers. */
export function priceOf(e) {
  if (e.isPaid === false) return 'Free';
  const amounts = [...new Set((e.prices ?? []).map((p) => p.priceAmount).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!amounts.length) return null;
  if (amounts[0] === 0 && amounts.length === 1) return 'Free';
  return amounts.length === 1 ? dollars(amounts[0]) : `${dollars(amounts[0])}–${dollars(amounts.at(-1)).slice(1)}`;
}

export const compileVenues = (venues = []) => venues.map((v) => ({ ...v, match: new RegExp(v.match, 'i') }));
const surfaceOf = (e) => (/sand|beach/i.test(e.fitnessTypeName ?? '') ? 'sand' : /grass|lawn/i.test(e.fitnessTypeName ?? '') ? 'grass' : null);
const short = (alias) => String(alias).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 48).replace(/-+$/, '');

/**
 * A host page -> one dated session per upcoming occurrence. `host` is { slug, include? };
 * events whose name and sport type don't match `include` (default: volleyball) are skipped,
 * as are unpublished, deleted and online ones. With `from`, only dates from then through the horizon.
 */
export function parseHost(html, host, { venues = [], fallback = {}, include = 'volley|🏐', timezone = 'America/Chicago', from = null, horizonDays = HORIZON_DAYS } = {}) {
  const until = from && addDays(from, horizonDays);
  const keep = new RegExp(host.include ?? include, 'iu');
  const sessions = [], events = hostEvents(html);
  for (const e of events) {
    if (e.deletedAt || e.isOnlineEvent || (e.publishingState && e.publishingState !== 'published')) continue;
    const name = String(e.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name || !e.alias || !keep.test(`${name} ${e.fitnessTypeName ?? ''}`)) continue;
    const tz = e.tzid || timezone;
    const address = String(e.addressName ?? '').trim();
    const v = venues.find((x) => address && x.match.test(address)) ?? { city: null, surface: null, ...fallback, venue: null };
    const length = Date.parse(e.endDate) - Date.parse(e.startDate);
    for (const day of e.upcomingDays ?? []) {
      for (const t of day.times ?? []) {
        const at = Date.parse(t);
        if (!Number.isFinite(at)) continue;
        const endAt = day.count === 1 && Date.parse(day.lastEnd) > at ? Date.parse(day.lastEnd) : Number.isFinite(length) && length > 0 ? at + length : null;
        const { date, time: start } = localDateTime(at, tz);
        if (from && (date < from || date > until)) continue;
        sessions.push({
          id: `sweatpals-${short(e.alias)}-${date}-${start.replace(':', '')}`,
          date, start, end: endAt ? endAfter(start, Math.floor((endAt - at) / 60e3)) : null,
          title: name, venue: v.venue || address.split(',')[0] || null, city: v.city ?? null,
          surface: v.surface ?? surfaceOf(e) ?? fallback.surface ?? null, facility: v.facility,
          type: typeOf(name), level: null, price: priceOf(e),
          note: `Hosted on Sweatpals${e.rrule ? ', weekly' : ''}.`,
          signup: { url: eventUrl(e.alias, date), label: 'RSVP on Sweatpals' },
          source: hostUrl(host.slug),
        });
      }
    }
  }
  return { sessions, events };
}

export async function scrape({ options, timezone, ref, fetch }) {
  const hosts = options?.hosts ?? [];
  if (!hosts.length) throw new Error('sweatpals: no hosts configured');
  const cfg = { venues: compileVenues(options.venues), fallback: options.fallbackVenue ?? {}, include: options.include, timezone, from: ref ?? today(new Date(), timezone) };
  const sessions = [], warnings = [], raw = [];
  let read = 0;
  for (const host of hosts) {
    const url = hostUrl(host.slug);
    try {
      const res = await get(url, { fetch, headers: { accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = parseHost(res.text, host, cfg);
      sessions.push(...r.sessions);
      raw.push(...r.events);
      read++;
    } catch (e) { warnings.push(`${url}: ${e.message}`); }
  }
  // A host with nothing coming up is normal; every host failing is not.
  if (!read) throw new Error(warnings.join('; ') || 'No Sweatpals host could be read');
  if (!sessions.length) warnings.push('no upcoming events matched on any host');
  return { sessions: [...new Map(sessions.map((s) => [s.id, s])).values()], warnings, shape: raw.length ? shapeUnion(raw) : undefined };
}

/** Event pages could be re-checked, but nothing needs it yet; consumers fall back to the feed. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
