// Volleyworld's class calendar on Arketa. The booking widget reads a public JSON API,
// which we call directly (no browser): one request returns every class in a date range.
import { addDays, endAfter, localDateTime } from '../../lib/time.js';
import { localToIso } from '../../lib/occurrences.js';
import { get } from '../../lib/http.js';
import { shapeUnion } from '../../lib/health.js';

export const id = 'volleyworld';
export const needsBrowser = false;
/** Arketa class fields parse() reads. lib/health.js reports any that vanish from the API. */
export const reads = ['name', 'display', 'start_time', 'duration', 'location', 'location.name', 'location.city',
  'max_capacity', 'total_booked', 'hostName', 'canceled', 'isBookable', 'waitlistLength', 'id'];

const URL_ = 'https://app.arketa.co/iframe/volleyworld/schedule';
const API = 'https://widget-api-tkaeguucxq-uc.a.run.app/ejkJj0YI8MYhO9if44ItXiKYhrt2/schedule';
const HEADERS = { accept: 'application/json', origin: 'https://app.arketa.co', referer: 'https://app.arketa.co/' };
const HORIZON_DAYS = 14;
const ADULT = /adult|open gym|women'?s? only/i;
const CITIES = ['Georgetown', 'Pflugerville'];
/** Session ids: volleyworld-<date>-<HH:MM>-<location>, the scheme the old page-text scraper used. */
const ID = /^volleyworld-(\d{4}-\d{2}-\d{2})-([01]\d|2[0-3]):([0-5]\d)-(georgetown|pflugerville)$/;

const cityOf = (c) => CITIES.find((x) => new RegExp(x, 'i').test(`${c.location?.name ?? ''} ${c.location?.city ?? ''}`)) ?? null;

/** Arketa schedule API response ({ data: { classes } }) -> normalized adult sessions. */
export function parse(json, timeZone = 'America/Chicago') {
  const classes = json?.data?.classes;
  if (!Array.isArray(classes)) throw new Error('Arketa response has no data.classes');
  const out = new Map();
  for (const c of classes) {
    const title = String(c.name ?? '').replace(/\s+/g, ' ').trim();
    if (!ADULT.test(title) || /homeschool/i.test(title)) continue;
    if (c.display && c.display !== 'public') continue;
    if (!Number.isFinite(c.start_time) || !Number.isFinite(c.duration)) continue;
    const city = cityOf(c);
    if (!city) continue;
    const { date, time: start } = localDateTime(c.start_time * 1000, timeZone);
    const capacity = Number.isFinite(c.max_capacity) ? c.max_capacity : null;
    const booked = Number.isFinite(c.total_booked) ? c.total_booked : null;
    const spotsLeft = capacity != null && booked != null ? Math.max(capacity - booked, 0) : null;
    const coach = String(c.hostName ?? '').trim();
    const s = {
      id: `volleyworld-${date}-${start}-${city}`.toLowerCase(),
      date, start, end: endAfter(start, c.duration),
      title, venue: `Volleyworld (${city})`, city, surface: 'indoor',
      type: /open gym/i.test(title) ? 'Open play' : 'Training',
      level: coach && coach !== 'No Coach' ? `Adults · ${coach}` : 'Adults',
      canceled: c.canceled === true || undefined,
      full: (spotsLeft === 0 || c.isBookable === false) && c.canceled !== true ? true : undefined,
      capacity: capacity ?? undefined,
      spotsLeft: spotsLeft ?? undefined,
      waitlist: c.waitlistLength > 0 ? c.waitlistLength : undefined,
      classId: c.id || undefined,
      signup: { url: URL_, label: 'Book on Volleyworld' },
      source: URL_,
    };
    // Two classes in the same slot: keep the bookable one.
    const prev = out.get(s.id);
    if (!prev || (prev.canceled && !s.canceled)) out.set(s.id, s);
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Fetch the schedule for local dates [from, from + days). */
async function fetchRange(from, days, timeZone, http) {
  const u = new URL(API);
  u.searchParams.set('startDateTime', localToIso(from, '00:00', timeZone));
  u.searchParams.set('endDateTime', localToIso(addDays(from, days), '00:00', timeZone));
  u.searchParams.set('timezone', timeZone);
  const res = await get(u, { ...http, headers: HEADERS });
  if (!res.ok) throw new Error(`Arketa API HTTP ${res.status}`);
  try { return JSON.parse(res.text); } catch { throw new Error('Arketa API returned non-JSON'); }
}

export async function scrape({ ref, timezone = 'America/Chicago', fetch }) {
  const json = await fetchRange(ref, HORIZON_DAYS + 1, timezone, { fetch });
  const sessions = parse(json, timezone);
  if (!sessions.length) throw new Error('No adult sessions in the Arketa schedule — class names may have changed');
  return { sessions, shape: shapeUnion(json.data.classes) };
}

/** Pure half of check(): compare one day's classes with the session id (and what we published, if known). */
export function checkDay(json, sessionId, { timezone = 'America/Chicago', expected } = {}) {
  const m = sessionId.match(ID);
  if (!m) throw new RangeError(`not a Volleyworld session id: ${sessionId}`);
  const day = parse(json, timezone).filter((s) => s.date === m[1]);
  let session = day.find((s) => s.id === sessionId) ?? null;
  // A class moved to another time gets a new id: find it by Arketa class id, else by title at the same location.
  if (!session && expected) {
    session = day.find((s) => expected.classId && s.classId === expected.classId)
      ?? day.find((s) => s.city.toLowerCase() === m[4] && s.title === expected.title) ?? null;
  }
  if (!session) return { status: 'gone' };
  if (session.canceled) return { status: 'canceled', session };
  const changes = diff(expected ?? { date: m[1], start: `${m[2]}:${m[3]}` }, session);
  return changes.length ? { status: 'changed', session, changes } : { status: 'scheduled', session };
}

export const parseId = (sessionId) => ID.test(sessionId);

/** Live re-check of one session: query Arketa for that day only. */
export async function check({ sessionId, timezone = 'America/Chicago', expected, now = new Date(), fetch, signal }) {
  const m = sessionId.match(ID);
  if (!m) throw new RangeError(`not a Volleyworld session id: ${sessionId}`);
  const json = await fetchRange(m[1], 1, timezone, { fetch, signal, timeoutMs: 4000 });
  return { ...checkDay(json, sessionId, { timezone, expected }), checkedAt: now.toISOString() };
}

const FIELDS = ['date', 'start', 'end', 'venue'];
export const diff = (a, b) => (a ? FIELDS.filter((k) => a[k] != null && b[k] != null && a[k] !== b[k]) : []);
