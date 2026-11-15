// Court calendars from OpenCourt (app.getopencourt.com), the booking system Holy Pickle uses.
// A club's booking page loads one public, anonymous request per day,
//   GET /api/club/<slug>/schedule?date=YYYY-MM-DD
// listing each court in 30-minute slots in the club's local time. A slot with a reservationId is
// taken (a member's booking or the club's own event); the rest is open to rent.
// Only times are kept: the response also names who booked, and Schelagg never reads or stores that.
import { get } from './http.js';
import { addDays } from './time.js';

export const OPENCOURT = 'https://app.getopencourt.com';
export const scheduleUrl = (slug, iso) => `${OPENCOURT}/api/club/${slug}/schedule?date=${iso}`;
const SLUG = /^[a-z0-9-]+$/;

const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dowOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/**
 * Join a reservation's slots into one block. Back-to-back reservations stay separate, so an open
 * play followed by a rental still lines up with its session on the site (and links to sign up).
 */
function merge(blocks) {
  const out = [];
  for (const [s, e, id] of [...blocks].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && id === last[2] && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e, id]);
  }
  return out.map(([s, e]) => [s, e]);
}

/**
 * One day's response -> { open: [first, last] minutes | null, courts: [[busy blocks]] } with courts in
 * the order the club lists them. Throws on a shape we don't recognise, so a change on their side
 * shows up as a failed calendar rather than a court that looks free all day.
 */
export function parseDay(body, iso) {
  const day = body?.remappedReservations?.[iso];
  if (!day || !Array.isArray(day.courts)) throw new Error(`OpenCourt schedule for ${iso} missing`);
  if (day.closedDay) return { open: null, courts: day.courts.map(() => []) };
  let first = Infinity, last = -Infinity;
  const courts = day.courts.map((c) => {
    if (!Array.isArray(c.slots)) throw new Error('OpenCourt court slots missing');
    const busy = [];
    for (const s of c.slots) {
      const start = s.startTimeInMinutes, len = s.duration;
      if (!Number.isInteger(start) || !Number.isInteger(len) || len <= 0 || start < 0 || start + len > 24 * 60) throw new Error('OpenCourt slot times invalid');
      first = Math.min(first, start); last = Math.max(last, start + len);
      if (s.reservationId || s.eventId) busy.push([start, start + len, s.reservationId || s.eventId]);
    }
    return merge(busy);
  });
  return { open: Number.isFinite(first) ? [first, last] : null, courts };
}

/**
 * Same shape as lib/skedda.js loadVenue: opening hours by weekday (0 = Sunday) and, per court,
 * booked times by date as "HH:MM". Court names come from the config's `spaces`, in the club's order.
 */
export async function loadOpenCourtVenue(venue, fromIso, days, { fetchImpl } = {}) {
  if (!SLUG.test(venue.slug ?? '')) throw new Error('Invalid OpenCourt club');
  const hours = Array.from({ length: 7 }, () => null);
  const spaces = venue.facilities.flatMap((f) => f.spaces);
  const busy = spaces.map(() => ({}));
  for (let i = 0; i < days; i++) {
    const iso = addDays(fromIso, i);
    const res = await get(scheduleUrl(venue.slug, iso), { fetch: fetchImpl, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`OpenCourt schedule: HTTP ${res.status}`);
    let body;
    try { body = JSON.parse(res.text); } catch { throw new Error('OpenCourt schedule is not JSON'); }
    const { open, courts } = parseDay(body, iso);
    if (courts.length !== spaces.length) throw new Error(`OpenCourt lists ${courts.length} courts; config has ${spaces.length}`);
    if (open) {
      const d = dowOf(iso), cur = hours[d];
      hours[d] = cur ? [Math.min(cur[0], open[0]), Math.max(cur[1], open[1])] : open;
    }
    courts.forEach((blocks, n) => { if (blocks.length) busy[n][iso] = blocks.map(([a, b]) => [toHHMM(a), toHHMM(b)]); });
  }
  let n = 0;
  return {
    id: venue.id,
    sport: venue.sport,
    ...(venue.region ? { region: venue.region } : {}),
    ...(venue.note ? { note: venue.note } : {}),
    calendar: venue.calendar,
    calendarDay: null,
    hours: hours.map((h) => (h ? [toHHMM(h[0]), toHHMM(h[1])] : null)),
    facilities: venue.facilities.map((f) => ({ ...f, courts: f.spaces.map((name) => ({ name, days: busy[n++] })) })),
  };
}
