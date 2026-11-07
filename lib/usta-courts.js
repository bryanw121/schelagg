// Court calendars from USTA PlayTennis (playtennis.usta.com), the booking system Austin Tennis &
// Pickleball Center uses. Its public "Book by date" page loads one anonymous request,
//   GET /v0/VenueBooking/<venue>/GetVenueSessions?resourceID=&startDate=&endDate=&roleId=
// listing every court ("resource") by day with its sessions in minutes from local midnight.
// Category 0 ("Default") is time open to book; anything else (a club program, a booking) takes the
// court. Only times are kept: session names can describe who booked, and are never stored.
import { get } from './http.js';
import { addDays } from './time.js';

export const USTA = 'https://playtennis.usta.com';
export const sessionsUrl = (venue, from, to) =>
  `${USTA}/v0/VenueBooking/${venue}/GetVenueSessions?resourceID=&startDate=${from}&endDate=${to}&roleId=`;
const SLUG = /^[a-z0-9-]+$/i;
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dowOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const minute = (v) => Number.isInteger(v) && v >= 0 && v <= 24 * 60;

/**
 * The response -> { courts: Map(name -> { iso -> [[start, end]] busy }), open: { iso -> [first, last] } }
 * for the courts in `group` (the venue lists each court again under "All"). Throws on a shape it
 * doesn't recognise, so a change on their side reads as a failed calendar, not free courts.
 */
export function parseSessions(body, group, fromIso, toIso) {
  const groupId = body?.ResourceGroups?.find((g) => g.Name === group)?.ID;
  if (!groupId || !Array.isArray(body.Resources)) throw new Error(`USTA court group "${group}" missing`);
  const courts = new Map(), open = {};
  for (const r of body.Resources.filter((x) => x.ResourceGroupID === groupId)) {
    const days = {};
    for (const d of r.Days ?? []) {
      const iso = String(d.Date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('USTA day date invalid');
      if (iso < fromIso || iso > toIso) continue;
      const busy = [];
      for (const s of d.Sessions ?? []) {
        if (!minute(s.StartTime) || !minute(s.EndTime) || s.EndTime <= s.StartTime) throw new Error('USTA session times invalid');
        const o = open[iso];
        open[iso] = o ? [Math.min(o[0], s.StartTime), Math.max(o[1], s.EndTime)] : [s.StartTime, s.EndTime];
        if (s.Category !== 0) busy.push([s.StartTime, s.EndTime]);
      }
      if (busy.length) days[iso] = busy.sort((a, b) => a[0] - b[0]);
    }
    courts.set(r.Name, days);
  }
  return { courts, open };
}

/** Same shape as lib/skedda.js loadVenue. Court names in the config's `spaces` must match USTA's. */
export async function loadUstaVenue(venue, fromIso, days, { fetchImpl } = {}) {
  if (!SLUG.test(venue.slug ?? '')) throw new Error('Invalid USTA venue');
  const toIso = addDays(fromIso, days - 1);
  const res = await get(sessionsUrl(venue.slug, fromIso, toIso), { fetch: fetchImpl, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`USTA sessions: HTTP ${res.status}`);
  let body;
  try { body = JSON.parse(res.text); } catch { throw new Error('USTA sessions are not JSON'); }
  const { courts, open } = parseSessions(body, venue.group, fromIso, toIso);
  const spaces = venue.facilities.flatMap((f) => f.spaces);
  const missing = spaces.filter((s) => !courts.has(s));
  if (missing.length) throw new Error(`USTA has no court named ${missing.join(', ')}`);
  const hours = Array.from({ length: 7 }, () => null);
  for (const [iso, [a, b]] of Object.entries(open)) {
    const d = dowOf(iso), cur = hours[d];
    hours[d] = cur ? [Math.min(cur[0], a), Math.max(cur[1], b)] : [a, b];
  }
  const fmt = (bl) => bl.map(([a, b]) => [toHHMM(a), toHHMM(b)]);
  return {
    id: venue.id,
    sport: venue.sport,
    ...(venue.region ? { region: venue.region } : {}),
    ...(venue.note ? { note: venue.note } : {}),
    calendar: venue.calendar,
    calendarDay: venue.calendarDay ?? null,
    hours: hours.map((h) => (h ? [toHHMM(h[0]), toHHMM(h[1])] : null)),
    facilities: venue.facilities.map((f) => ({
      ...f,
      courts: f.spaces.map((name) => ({ name, days: Object.fromEntries(Object.entries(courts.get(name)).map(([d, bl]) => [d, fmt(bl)])) })),
    })),
  };
}
