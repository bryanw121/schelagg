import { get } from '../../lib/http.js';
import { pageObjects, findObject } from '../../lib/public-page-data.js';
import { addDays } from '../../lib/time.js';
import { eventTimes } from './openplay-directory.mjs';
import { scheduleUrl } from '../../lib/opencourt-courts.js';

export const needsBrowser = false;
export const clubUrl = (slug) => `https://app.getopencourt.com/club/${slug}`;
const uuid = (v) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v ?? '');

export function upcoming(html, ref, timezone) {
  const data = findObject(pageObjects(html), (x) => Array.isArray(x.events?.events) && x.eventsParams?.eventTypes?.includes('OpenPlay'));
  if (!data) throw new Error('OpenCourt public event list missing');
  return data.events.events.filter((e) => {
    if (e.type !== 'OpenPlay' || e.open !== true || !uuid(e.eventId)) return false;
    const { date } = eventTimes(e.startTime, e.endTime, timezone);
    return date >= ref && date <= addDays(ref, 14);
  });
}

export function parseDetail(html, listed, options, timezone) {
  const e = findObject(pageObjects(html), (x) => x.event?.id === listed.eventId)?.event;
  if (!e) throw new Error('OpenCourt event detail missing');
  if (e.club?.slug !== options.slug) throw new Error('OpenCourt event belongs to another venue');
  if (e.deletedAt || e.privacy !== 'public' || e.type !== 'OpenPlay' || e.open !== true) return null;
  const allocations = e.spaceAllocations?.filter((a) => !a.deletedAt);
  if (!allocations?.length) throw new Error('OpenCourt event times missing');
  const times = eventTimes(allocations[0].startTime, allocations[0].endTime, timezone);
  if (!allocations.every((a) => a.startTime === allocations[0].startTime && a.endTime === allocations[0].endTime)) throw new Error('OpenCourt court times differ');
  const payment = e.metadata?.paymentData, amount = payment?.rules?.NON_MEMBER;
  const price = payment?.isPaid === false ? 'Free' : payment?.isPaid === true && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
    ? `$${amount} / person (nonmember)` : 'Price not published';
  const source = `${clubUrl(options.slug)}/schedule/event/${e.id}`;
  return { id: `opencourt-${e.id}`, ...times, sport: 'pickleball', title: `${options.venue} · ${e.name.trim()}`,
    venue: options.venue, city: options.city, surface: options.surface, type: 'Open play', price,
    ...(e.skillRating?.length === 2 ? { level: `${e.skillRating.join('–')}${e.skillRatingRequired ? ' required' : ' recommended'}` } : {}),
    note: 'Venue-published event. Reserve with the venue; confirm final charges and available spots before going.',
    source, signup: { url: source, label: 'View event & book' } };
}

/** Event ids on one day of the club's court schedule (the same public request its booking page makes). */
export function scheduleEventIds(body, iso) {
  const courts = body?.remappedReservations?.[iso]?.courts;
  if (!Array.isArray(courts)) throw new Error(`OpenCourt schedule for ${iso} missing`);
  return courts.flatMap((c) => (c.slots ?? []).map((s) => s.eventId)).filter(uuid);
}

/**
 * The club page embeds only its next 10 events (OpenCourt marks the list truncated), so busier
 * clubs lose sessions. The per-day court schedule names every event on the courts; each is then
 * read from its public event page, which says whether it is open play.
 */
export async function scrape({ ref, options, timezone, fetch }) {
  if (!/^[a-z0-9-]+$/.test(options.slug)) throw new Error('Invalid OpenCourt club');
  const home = await get(clubUrl(options.slug), { fetch });
  if (!home.ok) throw new Error(`OpenCourt calendar: HTTP ${home.status}`);
  const listed = new Set(upcoming(home.text, ref, timezone).map((e) => e.eventId)), ids = new Set(listed);
  for (let i = 0; i <= 14; i++) {
    const iso = addDays(ref, i);
    const res = await get(scheduleUrl(options.slug, iso), { fetch, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`OpenCourt schedule: HTTP ${res.status}`);
    let body;
    try { body = JSON.parse(res.text); } catch { throw new Error('OpenCourt schedule is not JSON'); }
    for (const id of scheduleEventIds(body, iso)) ids.add(id);
  }
  const sessions = [];
  for (const eventId of ids) {
    // An event the club page lists as open play must read cleanly; anything else found only on the
    // court schedule (a private booking, a league) may have no public page and is skipped.
    let session;
    try {
      const res = await get(`${clubUrl(options.slug)}/schedule/event/${eventId}`, { fetch });
      if (!res.ok) throw new Error(`OpenCourt event: HTTP ${res.status}`);
      session = parseDetail(res.text, { eventId }, options, timezone);
    } catch (e) { if (listed.has(eventId)) throw e; continue; }
    if (session && session.date >= ref && session.date <= addDays(ref, 14)) sessions.push(session);
  }
  return { sessions: [...new Map(sessions.map((s) => [s.id, s])).values()] };
}
