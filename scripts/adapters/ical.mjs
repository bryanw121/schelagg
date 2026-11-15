// Calendar feeds (iCalendar, .ics): any group that publishes one, read like a calendar app would.
// Today that's Meetup groups (www.meetup.com/<group>/events/ical/, Meetup's own export for
// calendar subscriptions; robots.txt leaves it open). One source can list several feeds:
//
//   options.feeds: [{ url, host, venue, city, surface, include?, exclude?, note?, signupLabel? }]
//
// Each event becomes a dated session: its time, title and link. Descriptions are not published
// (they name organizers and coaches); they're only read to tell sand from indoor and to find a
// venue named "@ <venue>". `include` / `exclude` are regexes on the title (e.g. leave out socials).
import { get } from '../../lib/http.js';
import { localDateTime } from '../../lib/time.js';

export const id = 'ical';
export const needsBrowser = false;

/** Unfolded content lines → events: { NAME: { value, params } } (first occurrence of each). */
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m || cur[m[1]]) continue;
    const params = Object.fromEntries([...m[2].matchAll(/;([A-Z-]+)=([^;]*)/g)].map((p) => [p[1], p[2]]));
    cur[m[1]] = { value: m[3], params };
  }
  return events;
}

const unescape = (s) => String(s ?? '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/** A DTSTART / DTEND as { date, time } in `timezone`. Floating and TZID times are local already. */
export function icsTime(prop, timezone) {
  const v = prop?.value ?? '';
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  if (m[7]) return localDateTime(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), timezone);
  const tz = prop.params?.TZID;
  if (tz && tz !== timezone) {
    // Re-express another zone's wall time in ours (rare: feeds for this region use its zone).
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const offset = (ms, zone) => { const p = localDateTime(ms, zone); return Date.parse(`${p.date}T${p.time}:00Z`) - ms; };
    return localDateTime(asUtc - offset(asUtc, tz), timezone);
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/** One feed's events → sessions (today onward). */
export function feedSessions(text, feed, { timezone = 'America/Chicago', today = localDateTime(Date.now(), timezone).date } = {}) {
  const include = feed.include ? new RegExp(feed.include, 'i') : null;
  const exclude = feed.exclude ? new RegExp(feed.exclude, 'i') : null;
  const out = [];
  for (const ev of parseIcs(text)) {
    const title = unescape(ev.SUMMARY?.value).replace(/\s+/g, ' ');
    if (!title || (include && !include.test(title)) || (exclude && exclude.test(title))) continue;
    if (/^CANCELLED$/i.test(ev.STATUS?.value ?? '')) continue;
    const start = icsTime(ev.DTSTART, timezone);
    if (!start?.time || start.date < today) continue;
    const end = icsTime(ev.DTEND, timezone);
    const desc = unescape(ev.DESCRIPTION?.value);
    const named = desc.match(/@\s*([A-Z][^.\n(]{2,60}?)\s*(?:\(|\.|\n|$)/)?.[1]?.trim();
    const surface = /\bsand\b|\bbeach\b/i.test(`${title} ${desc}`) ? 'sand' : /\bgrass\b/i.test(title) ? 'grass' : feed.surface ?? 'indoor';
    const url = /^https?:\/\//.test(ev.URL?.value ?? '') ? ev.URL.value : feed.url;
    const uid = (ev.UID?.value ?? `${start.date}-${start.time}-${title}`).replace(/@.*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-');
    out.push({
      id: `${feed.idPrefix ?? 'ical'}-${uid}-${start.date}`,
      date: start.date, start: start.time, end: end?.date === start.date ? end.time : null,
      title, venue: feed.venue ?? named ?? null, city: feed.city ?? null, surface,
      type: /clinic|training|lesson|skills/i.test(title) ? 'Clinic' : 'Open play',
      level: /beginner/i.test(title) ? 'Beginner' : 'All levels',
      price: null,
      note: [feed.host && `Hosted by ${feed.host}.`, feed.note].filter(Boolean).join(' ') || null,
      signup: { url, label: feed.signupLabel ?? 'Details and RSVP' },
      source: url,
    });
  }
  return out;
}

export async function scrape({ options, timezone, fetch }) {
  const feeds = options?.feeds ?? [];
  if (!feeds.length) throw new Error('ical: no feeds configured');
  const sessions = [], warnings = [];
  for (const feed of feeds) {
    try {
      const res = await get(feed.url, { fetch });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!/BEGIN:VCALENDAR/.test(res.text)) throw new Error('not a calendar feed');
      sessions.push(...feedSessions(res.text, feed, { timezone }));
    } catch (e) { warnings.push(`${feed.url}: ${e.message}`); }
  }
  if (!sessions.length && warnings.length === feeds.length) throw new Error(warnings.join('; '));
  return { sessions, warnings };
}

/** Feeds publish what's coming; nothing faster to re-check than reading them again. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
