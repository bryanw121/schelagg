// The public feed: every session expanded into dated occurrences with absolute
// start/end instants, for any sport or region. Consumers (vteam, or anything
// else) read public/data/occurrences.json and never need to understand weekly
// recurrence, seasons or time zones. Pure (no I/O) so it's unit tested.
import { addDays, dowName, toMin, today } from './time.js';

export const FEED_VERSION = 1;
const MAX_SESSION_MINUTES = 8 * 60;

/** UTC offset in minutes for a time zone at a UTC instant (e.g. -300 for Austin in CDT). */
function offsetMinutes(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** "2026-10-24" + "19:30" local to `timeZone` -> ISO instant. "24:00" rolls to the next day. */
export function localToIso(dateIso, hhmm, timeZone) {
  let [h, m] = hhmm.split(':').map(Number);
  let date = dateIso;
  if (h >= 24) { h -= 24; date = addDays(dateIso, 1); }
  const [y, mo, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, m);
  // Two passes handle the DST boundary (offset taken at the guessed instant).
  let offset = offsetMinutes(new Date(naive), timeZone);
  offset = offsetMinutes(new Date(naive - offset * 60000), timeZone);
  return new Date(naive - offset * 60000).toISOString();
}

// Fields that describe the session in a sport-specific way travel in `attributes`,
// so the top-level shape stays the same for every sport.
const CORE = new Set(['id', 'sourceId', 'sport', 'region', 'timezone', 'title', 'venue', 'city', 'date', 'days',
  'start', 'end', 'startsOn', 'validUntil', 'price', 'level', 'note', 'signup', 'source', 'verifiedAt',
  'canceled', 'checkFailed', 'sourceChanged', 'watchError', 'facility', 'venueId', 'status', 'previousStart']);

/** A session's sport-specific fields (everything outside the shared core), as the feed's `attributes`. */
export const sessionAttributes = (s) => Object.fromEntries(Object.entries(s).filter(([k, v]) => !CORE.has(k) && v != null));

/** Top-level keys of a feed occurrence, in the order occurrences.json emits them. */
export const OCCURRENCE_KEYS = ['id', 'session_id', 'source_id', 'sport', 'region', 'timezone', 'title', 'venue', 'city',
  'level', 'price', 'starts_at', 'ends_at', 'signup_url', 'signup_label', 'note', 'canceled', 'verified_at', 'attributes',
  'venue_id', 'status', 'previous_starts_at'];

function toOccurrence(s, date, id, verifiedAt) {
  const attributes = sessionAttributes(s);
  return {
    id,
    session_id: s.id,
    source_id: s.sourceId,
    sport: s.sport,
    region: s.region,
    timezone: s.timezone,
    title: s.title,
    venue: s.venue,
    city: s.city ?? null,
    level: s.level ?? null,
    price: s.price ?? null,
    starts_at: localToIso(date, s.start, s.timezone),
    ends_at: s.end ? localToIso(date, s.end, s.timezone) : null,
    signup_url: s.signup?.url ?? s.source ?? null,
    signup_label: s.signup?.label ?? null,
    note: s.note ?? null,
    canceled: !!s.canceled,
    verified_at: s.verifiedAt ?? verifiedAt,
    attributes,
    // Added in feed version 1 without a bump (new keys only): the canonical venue, the
    // OpenActive-style status, and where a rescheduled session was before.
    venue_id: s.venueId ?? null,
    status: s.status ?? (s.canceled ? 'cancelled' : 'scheduled'),
    previous_starts_at: s.previousStart ? localToIso(s.previousStart.slice(0, 10), s.previousStart.slice(11, 16), s.timezone) : null,
  };
}

/**
 * One occurrence per dated session from today (in each session's own time zone)
 * through `horizonDays`. Weekly sessions (`days: ['Mon', ...]`) expand to each
 * matching date inside their season (`startsOn` / `validUntil`). Sessions with
 * no start time (leagues before game times are posted) and all-day facility
 * hours are left out: neither is a session you can show at a time.
 */
export function toOccurrences(sessions, { now = new Date(), horizonDays = 28 } = {}) {
  const out = [];
  for (const s of sessions) {
    if (!s.start || !s.title || !s.venue || !s.timezone) continue;
    if (s.end && toMin(s.end) - toMin(s.start) >= MAX_SESSION_MINUTES) continue;
    const from = today(now, s.timezone);
    const until = addDays(from, horizonDays);
    if (s.date) {
      if (s.date >= from && s.date <= until) out.push(toOccurrence(s, s.date, s.id, from));
      continue;
    }
    for (let d = from; d <= until; d = addDays(d, 1)) {
      if (!(s.days ?? []).includes(dowName(d))) continue;
      if (s.startsOn && d < s.startsOn) continue;
      if (s.validUntil && d > s.validUntil) continue;
      out.push(toOccurrence(s, d, `${s.id}-${d}`, from));
    }
  }
  return out.sort(compareOccurrences);
}

/** Feed order: by start instant, then id. */
export const compareOccurrences = (a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id);

/** The local calendar date an occurrence starts on, in its own time zone. */
export const occurrenceDate = (o) => today(new Date(o.starts_at), o.timezone);

/** Occurrences on local dates from..to (inclusive), optionally one sport / region (null = any). */
export const filterOccurrences = (list, { sport = null, region = null, from, to }) => list.filter((o) => {
  if ((sport && o.sport !== sport) || (region && o.region !== region)) return false;
  const d = occurrenceDate(o);
  return d >= from && d <= to;
});
