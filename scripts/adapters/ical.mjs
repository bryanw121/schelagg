// Calendar feeds (iCalendar, .ics): any group that publishes one, read like a calendar app would.
// Today that's Meetup groups (www.meetup.com/<group>/events/ical/, Meetup's own export for
// calendar subscriptions; robots.txt leaves it open). One source can list several feeds:
//
//   options.feeds: [{ url, host, venue, city, surface, include?, exclude?, note?, signupLabel?, eventVenues? }]
//
// Meetup's feed has no LOCATION, but each event page names its venue with coordinates (the page's
// own data, "venue":{name,address,city,lat,lng}). With `eventVenues: true` (on by default for
// meetup.com feeds) the venue is read from the event pages, one page per distinct event title per
// run, so sessions get a venue name and a map pin (lib/consolidate.js sourceVenues).
//
// Each event becomes a dated session: its time, title and link. Descriptions are not published
// (they name organizers and coaches); they're only read to tell sand from indoor and to find a
// venue named "@ <venue>". `include` / `exclude` are regexes on the title (e.g. leave out socials).
import { get } from '../../lib/http.js';
import { addDays, localDateTime } from '../../lib/time.js';

/** Dated sessions this far ahead, like the schedule (lib/pipeline.js HORIZON_DAYS). */
const HORIZON_DAYS = 14;

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

/** The venue on a Meetup event page: { venue, city, venueAddress, venueLat, venueLng }, or null. */
export function meetupVenue(html) {
  const m = String(html).match(/"venue":\{"__typename":"Venue"[^{}]*\}/);
  if (!m) return null;
  let v;
  try { v = JSON.parse(m[0].slice(8)); } catch { return null; }
  if (!v?.name || /^online/i.test(v.name)) return null;
  const out = { venue: v.name, city: v.city ?? null };
  if (v.address) out.venueAddress = [v.address, v.city, v.state?.toUpperCase()].filter(Boolean).join(', ');
  if (Number.isFinite(v.lat) && Number.isFinite(v.lng) && (v.lat || v.lng)) Object.assign(out, { venueLat: v.lat, venueLng: v.lng });
  return out;
}

/** One feed's events → sessions (today onward). */
export function feedSessions(text, feed, { timezone = 'America/Chicago', today = localDateTime(Date.now(), timezone).date, horizonDays = null } = {}) {
  const until = horizonDays ? addDays(today, horizonDays) : null;
  const include = feed.include ? new RegExp(feed.include, 'i') : null;
  const exclude = feed.exclude ? new RegExp(feed.exclude, 'i') : null;
  const out = [];
  for (const ev of parseIcs(text)) {
    const title = unescape(ev.SUMMARY?.value).replace(/\s+/g, ' ');
    if (!title || (include && !include.test(title)) || (exclude && exclude.test(title))) continue;
    if (/^CANCELLED$/i.test(ev.STATUS?.value ?? '')) continue;
    const start = icsTime(ev.DTSTART, timezone);
    if (!start?.time || start.date < today || (until && start.date > until)) continue;
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

export async function scrape({ options, timezone, fetch, ref }) {
  const feeds = options?.feeds ?? [];
  if (!feeds.length) throw new Error('ical: no feeds configured');
  const sessions = [], warnings = [];
  for (const feed of feeds) {
    try {
      const res = await get(feed.url, { fetch });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!/BEGIN:VCALENDAR/.test(res.text)) throw new Error('not a calendar feed');
      const found = feedSessions(res.text, feed, { timezone, ...(ref ? { today: ref, horizonDays: HORIZON_DAYS } : {}) });
      if (feed.eventVenues ?? /(^|\.)meetup\.com$/.test(new URL(feed.url).hostname)) {
        // One event page per distinct title (a weekly series shares its venue); the feed's own venue wins.
        const byTitle = new Map();
        for (const x of found) if (!feed.venue && !byTitle.has(x.title) && x.signup?.url && x.signup.url !== feed.url) byTitle.set(x.title, x.signup.url);
        for (const [title, url] of [...byTitle].slice(0, 8)) {
          const page = await get(url, { fetch }).catch(() => null);
          const v = page?.ok ? meetupVenue(page.text) : null;
          if (!v) { warnings.push(`${url}: no venue on the event page`); continue; }
          for (const x of found) if (x.title === title) Object.assign(x, v, feed.city ? { city: feed.city } : {});
        }
      }
      sessions.push(...found);
    } catch (e) { warnings.push(`${feed.url}: ${e.message}`); }
  }
  if (!sessions.length && warnings.length === feeds.length) throw new Error(warnings.join('; '));
  return { sessions, warnings };
}

/** Feeds publish what's coming; nothing faster to re-check than reading them again. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
