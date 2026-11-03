import { get } from '../../lib/http.js';
import { pageObjects, findObject } from '../../lib/public-page-data.js';
import { addDays } from '../../lib/time.js';
import { eventTimes } from './openplay-directory.mjs';

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

export async function scrape({ ref, options, timezone, fetch }) {
  if (!/^[a-z0-9-]+$/.test(options.slug)) throw new Error('Invalid OpenCourt club');
  const home = await get(clubUrl(options.slug), { fetch });
  if (!home.ok) throw new Error(`OpenCourt calendar: HTTP ${home.status}`);
  const events = upcoming(home.text, ref, timezone), sessions = [];
  for (const listed of events) {
    const res = await get(`${clubUrl(options.slug)}/schedule/event/${listed.eventId}`, { fetch });
    if (!res.ok) throw new Error(`OpenCourt event: HTTP ${res.status}`);
    const session = parseDetail(res.text, listed, options, timezone);
    if (session && session.date >= ref && session.date <= addDays(ref, 14)) sessions.push(session);
  }
  return { sessions: [...new Map(sessions.map((s) => [s.id, s])).values()] };
}
