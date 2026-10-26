// Public Reclub meets from Austin volleyball clubs. A meet held on a court that also shows as
// booked on a Skedda calendar is a privately booked court that's open to sign-ups.
//
// Reclub pages are server-rendered (Nuxt), so plain fetches are enough: a club page links its
// upcoming meets (/m/<code>), and each meet page carries the meet as data in __NUXT_DATA__.
import { endAfter, localDateTime } from '../../lib/time.js';
import { nuxtData } from '../../lib/devalue.js';
import { get } from '../../lib/http.js';
import { shapeUnion } from '../../lib/health.js';

export const id = 'reclub';
export const needsBrowser = false;
/** Meet fields parseMeet() reads. lib/health.js reports any that vanish from Reclub's page data. */
export const reads = ['name', 'startDatetime', 'endDatetime', 'venue', 'venue.name', 'referenceCode',
  'feeAmount', 'feeCurrency', 'numPlayers', 'isCancelled', 'isPast'];

const ORIGIN = 'https://reclub.co';
const CODE = /^[A-Za-z0-9]{4,12}$/;
const ID = /^reclub-([A-Za-z0-9]{4,12})$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Clubs and the venue table come from config/sources.json (options.clubs, options.venues).
// A venue entry maps Reclub's venue name (regex source, case-insensitive) to how we show it,
// and to the Skedda facility (if any) it lives in.
export const compileVenues = (venues = []) => venues.map((v) => ({ ...v, match: new RegExp(v.match, 'i') }));

export const meetUrl = (code) => `${ORIGIN}/m/${code}`;

/** Meet codes linked from a club page, in page order. */
export function meetLinks(html) {
  const codes = [...String(html).matchAll(/href=["'](?:https?:\/\/reclub\.co)?\/m\/([A-Za-z0-9]{4,12})["'?#]/g)].map((m) => m[1]);
  return [...new Set(codes)];
}

/** The meet record (plus its club and schedule) from a meet page, or null if the page has none. */
export function meetData(html) {
  const root = nuxtData(html);
  const entry = Object.values(root?.data ?? {}).find((d) => d && typeof d === 'object' && d.meet && typeof d.meet === 'object');
  return entry ? { meet: entry.meet, group: entry.group ?? null, schedule: entry.schedule ?? null } : null;
}

const money = (amount, currency) => {
  if (!(Number(amount) > 0)) return null;
  return !currency || currency === 'USD' ? `$${+amount}` : `${+amount} ${currency}`;
};

/** Parse one meet page (HTML) into a normalized session. */
export function parseMeet(html, url, { venues = [], fallback = {}, timezone = 'America/Chicago' } = {}) {
  const data = meetData(html);
  if (!data) throw new Error(`${url}: no meet data on the page`);
  const { meet, group, schedule } = data;
  if (!Number.isFinite(meet.startDatetime)) throw new Error(`${url}: meet has no start time`);
  const tz = meet.venue?.location?.timezone || timezone;
  const name = String(meet.name ?? '').replace(/\s+/g, ' ').trim() || 'Reclub meet';
  const placeName = String(meet.venue?.name ?? '').trim();
  // Match on the venue name; meets without a venue often name it in a "Venue: ..." title prefix.
  const v = venues.find((x) => placeName && x.match.test(placeName))
    ?? (!placeName && venues.find((x) => x.match.test(name.split(':')[0])))
    ?? { city: null, surface: null, ...fallback, venue: placeName };
  const { date, time: start } = localDateTime(meet.startDatetime * 1000, tz);
  const minutes = Number.isFinite(meet.endDatetime) ? (meet.endDatetime - meet.startDatetime) / 60
    : Number.isFinite(meet.duration) ? meet.duration / 60 : null;
  const title = name.replace(/^[^:]+:\s*/, '');
  const level = title.match(/\b([A-D]{1,2}\/[A-D]{1,2})\b/)?.[1];
  const mens = /\bmen['’]?s\b/i.test(title) && !/women/i.test(title);
  const weekly = schedule?.frequencyType === 1 ? DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] : null;
  const club = group?.name?.trim();
  const capacity = Number(meet.numPlayers) > 0 ? Number(meet.numPlayers) : undefined;
  return {
    id: `reclub-${meet.referenceCode || url.split('/').pop()}`,
    date, start, end: minutes != null ? endAfter(start, minutes) : null,
    title, venue: v.venue || placeName, city: v.city, surface: v.surface,
    facility: v.facility, type: 'Open play',
    level: level ? `${level}${mens ? ' · men' : ''}` : 'All levels',
    price: money(meet.feeAmount, meet.feeCurrency),
    note: [club && `Hosted by ${club}${weekly ? `, every ${weekly}` : ''}.`, v.facility && 'Runs on a privately booked court.'].filter(Boolean).join(' ') || null,
    canceled: meet.isCancelled === true || undefined,
    capacity,
    signup: { url, label: 'Sign up on Reclub' },
    source: url,
  };
}

const opts = (options = {}) => ({ venues: compileVenues(options.venues), fallback: options.fallbackVenue ?? {} });

export async function scrape({ options, timezone, fetch }) {
  const clubs = options?.clubs ?? [];
  if (!clubs.length) throw new Error('reclub: no clubs configured');
  const { venues, fallback } = opts(options);
  const sessions = [], warnings = [], meets = [];
  for (const club of clubs) {
    let codes;
    try {
      const res = await get(club, { fetch });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      codes = meetLinks(res.text);
    } catch (e) { warnings.push(`${club}: ${e.message}`); continue; }
    for (const code of codes) {
      const url = meetUrl(code);
      try {
        const res = await get(url, { fetch });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = meetData(res.text);
        if (data?.meet) meets.push(data.meet);
        if (data?.meet?.isPast === true) continue;
        sessions.push(parseMeet(res.text, url, { venues, fallback, timezone }));
      } catch (e) { warnings.push(`${url}: ${e.message}`); }
    }
  }
  if (!sessions.length) throw new Error(warnings.join('; ') || 'No Reclub meets found');
  return { sessions: [...new Map(sessions.map((s) => [s.id, s])).values()], warnings, shape: shapeUnion(meets) };
}

export const parseId = (sessionId) => ID.test(sessionId);

const FIELDS = ['date', 'start', 'end', 'venue'];
const diff = (a, b) => (a ? FIELDS.filter((k) => a[k] != null && b[k] != null && a[k] !== b[k]) : []);

/** Pure half of check(): a meet page's HTTP status + body -> status. */
export function checkPage({ status, text }, sessionId, { options, timezone, expected } = {}) {
  const code = sessionId.match(ID)?.[1];
  if (!code) throw new RangeError(`not a Reclub session id: ${sessionId}`);
  if (status === 404 || status === 410) return { status: 'gone' };
  if (status < 200 || status >= 300) throw new Error(`Reclub HTTP ${status}`);
  const data = meetData(text);
  if (!data) return { status: 'gone' };
  const { venues, fallback } = opts(options);
  const session = parseMeet(text, meetUrl(code), { venues, fallback, timezone });
  if (session.canceled) return { status: 'canceled', session };
  const changes = diff(expected, session);
  return changes.length ? { status: 'changed', session, changes } : { status: 'scheduled', session };
}

/** Live re-check of one meet: fetch its page. */
export async function check({ sessionId, options, timezone = 'America/Chicago', expected, now = new Date(), fetch, signal }) {
  const code = sessionId.match(ID)?.[1];
  if (!code || !CODE.test(code)) throw new RangeError(`not a Reclub session id: ${sessionId}`);
  const res = await get(meetUrl(code), { fetch, signal, timeoutMs: 4000 });
  return { ...checkPage(res, sessionId, { options, timezone, expected }), checkedAt: now.toISOString() };
}
