// DaySmart Recreation ("Dash"): the booking platform behind many ice rinks (Chaparral Ice,
// Ice & Field at the Crossover). Its JSON:API answers without a login for public calendars:
//
//   GET https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events
//       ?company=<company>&filter[start__gte]=<date>&filter[start__lte]=<date>&page[size]=100&page[number]=N
//
// The raw feed holds every event on the company's calendar, including unpublished private
// rentals linked to customers. We keep only `publish: true` events whose event type is in the
// source's `eventTypes` allowlist, and read nothing but the event's own attributes (no
// relationships, no customer or registrant data).
//
// Options (config/sources.json):
//   company      DaySmart company code, e.g. "chaparralice"
//   eventTypes   { "<event_type_id>": { "title", "type", "useDescription"? } }: what to keep and how to show it
//   resources    { "<resource_id>": "<rink name>" | { rink, venue, city, surface } }: the rink sheets to read.
//                Events on other resources are skipped (and counted in a warning), so a company that
//                also runs another building doesn't land under the wrong venue.
//   venue, city, surface, price, signup { url, label }, source (calendar link), note
import { endAfter } from '../../lib/time.js';
import { get } from '../../lib/http.js';
import { shapeUnion } from '../../lib/health.js';

export const id = 'daysmart';
export const needsBrowser = false;
/** Event attributes parseEvents() reads. lib/health.js reports any that vanish from the API. */
export const reads = ['start', 'end', 'event_type_id', 'resource_id', 'publish', 'desc', 'register_capacity'];

const API = 'https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events';
const DAYS = 14;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
// Descriptions like "Public Skate 10/27/26 9:45am-12:00pm" just repeat the type and time.
const DATED = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;

const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const minutesBetween = (a, b) => (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 60000;

export function eventsUrl(company, from, to, page = 1) {
  const q = new URLSearchParams({
    company,
    'filter[start__gte]': from,
    'filter[start__lte]': `${to}T23:59:59`,
    'page[size]': String(PAGE_SIZE),
    'page[number]': String(page),
  });
  return `${API}?${q}`;
}

/** JSON:API event records (one or more pages' `data`) -> { sessions, skipped } (skipped: public sessions on unlisted rinks). */
export function parseEvents(records, options = {}) {
  const { company, eventTypes = {}, resources, venue, city, surface = 'indoor', price, signup, source, note } = options;
  if (!company) throw new Error('daysmart: no company configured');
  const sessions = [];
  let skipped = 0;
  for (const r of records) {
    const a = r?.attributes ?? {};
    if (a.publish !== true) continue;
    const t = eventTypes[String(a.event_type_id)];
    if (!t) continue;
    const res = resources ? resources[String(a.resource_id)] : undefined;
    if (resources && !res) { skipped++; continue; }
    const place = typeof res === 'string' ? { rink: res } : (res ?? {});
    const s = String(a.start ?? '').match(LOCAL);
    const e = String(a.end ?? '').match(LOCAL);
    if (!s) continue;
    const desc = String(a.desc ?? a.best_description ?? '').replace(/\s+/g, ' ').trim();
    const title = t.useDescription && desc && !DATED.test(desc) ? desc : t.title;
    const minutes = e ? minutesBetween(a.start.slice(0, 19), a.end.slice(0, 19)) : null;
    const capacity = Number(a.register_capacity) > 0 ? Number(a.register_capacity) : undefined;
    sessions.push({
      id: `daysmart-${company}-${r.id}`,
      date: s[1], start: s[2], end: minutes > 0 ? endAfter(s[2], minutes) : null,
      title, venue: place.venue ?? venue, city: place.city ?? city, surface: place.surface ?? surface, type: t.type,
      rink: place.rink,
      price: price ?? null,
      capacity,
      note: note ?? null,
      signup: signup ?? (source ? { url: source, label: 'Check the rink calendar' } : undefined),
      source: source ?? `https://apps.daysmartrecreation.com/dash/x/#/online/${company}/calendar`,
    });
  }
  sessions.sort((x, y) => `${x.date} ${x.start}`.localeCompare(`${y.date} ${y.start}`) || x.id.localeCompare(y.id));
  return { sessions, skipped };
}

/** Read every page of events from `ref` through `days` ahead. */
export async function fetchEvents({ company, ref, days = DAYS, fetch, delayMs = 1000 }) {
  const to = addDays(ref, days);
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const res = await get(eventsUrl(company, ref, to, page), { fetch, headers: { accept: 'application/vnd.api+json' } });
    if (!res.ok) throw new Error(`DaySmart ${company} HTTP ${res.status}`);
    let json;
    try { json = JSON.parse(res.text); } catch { throw new Error(`DaySmart ${company}: response isn't JSON`); }
    if (!Array.isArray(json?.data)) throw new Error(`DaySmart ${company}: no data array`);
    records.push(...json.data);
    const last = Number(json.meta?.page?.['last-page'] ?? 1);
    if (page >= last || !json.data.length) break;
  }
  return records;
}

export async function scrape({ ref, options, fetch, delayMs }) {
  const records = await fetchEvents({ company: options?.company, ref, days: options?.days, fetch, delayMs });
  const { sessions, skipped } = parseEvents(records, options);
  if (!sessions.length) throw new Error(`DaySmart ${options?.company}: no matching public sessions in ${options?.days ?? DAYS} days`);
  const warnings = skipped ? [`${skipped} public session${skipped > 1 ? 's' : ''} on rinks not listed in options.resources`] : [];
  return { sessions, warnings, shape: shapeUnion(records.filter((r) => r?.attributes?.publish === true).map((r) => r.attributes)) };
}
