// The Events view's pure helpers (public/app.js imports these; node tests import them too,
// so nothing here may touch the DOM or the network). The feed is public/data/events.json:
// { feedVersion, generatedAt, events: [{ id, category, title, venue, area, city, startDate,
// endDate, startTime, endTime, price, sourceUrl, source, description, lat, lng, located }] }.

/** The category chips, in order; `all` is the unfiltered view. */
export const EVENT_CATS = [
  { id: 'all', label: 'All' },
  { id: 'popup', label: 'Pop-ups' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'asian-inspired', label: 'Asian-inspired' },
];
export const isEventCat = (c) => EVENT_CATS.some((x) => x.id === c);
/** The chip on a card: its label and its color (schelagg's palette, like the surface chips). */
export const CAT_LABEL = { popup: 'Pop-up', seasonal: 'Seasonal', 'asian-inspired': 'Asian-inspired' };
export const CAT_COLOR = { popup: 'var(--indoor)', seasonal: 'var(--grass)', 'asian-inspired': 'var(--changed)' };
export const EVENTS_PER_PAGE = 10;

/** The feed's order: soonest first, ties by title. */
export const sortEvents = (events) => [...(events ?? [])].sort((a, b) =>
  (a.startDate || '').localeCompare(b.startDate || '') || (a.title || '').localeCompare(b.title || ''));

/** How many events each chip counts (plus `all`). */
export function countByCategory(events) {
  const counts = { all: 0, popup: 0, seasonal: 0, 'asian-inspired': 0 };
  for (const e of events ?? []) { counts.all++; if (counts[e.category] != null) counts[e.category]++; }
  return counts;
}

/** A page of a list: the slice, and the "Showing X–Y of N" numbers (0 when empty). */
export function paginate(items, page, perPage = EVENTS_PER_PAGE) {
  const total = items?.length ?? 0;
  const pageCount = Math.ceil(total / perPage);
  const p = pageCount < 1 ? 1 : Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = total ? (p - 1) * perPage + 1 : 0;
  return { items: (items ?? []).slice(start - 1, start - 1 + perPage), page: p, pageCount, total, start, end: total ? Math.min(start + perPage - 1, total) : 0 };
}

/** The page number a ?page= (or a remembered page) is allowed to be. */
export const clampPage = (page, pageCount) => (pageCount < 1 ? 1 : Math.min(Math.max(1, Math.floor(page) || 1), pageCount));

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parseDay = (iso) => { const [y, m, d] = (iso || '').split('-').map(Number); return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)); };
const shortDay = (iso) => { const d = parseDay(iso); return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`; };
/** "Sat, Dec 5" for one day; "Nov 12 – 23", "Nov 12 – Dec 30" or "Nov 21 – Jan 3" for a range. */
export function eventDateRange(ev) {
  const a = ev?.startDate, b = ev?.endDate;
  if (!b || b === a) { const d = parseDay(a); return `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`; }
  const [ay, am] = a.split('-'), [by, bm] = b.split('-');
  if (ay === by && am === bm) return `${shortDay(a)} – ${parseDay(b).getUTCDate()}`;
  return `${shortDay(a)} – ${shortDay(b)}`;
}

/**
 * The place line, deduplicated: the venue, then the area and city — except a part an earlier
 * one already names. The venue names a part by containing it ("Vista Brewing, 13551 FM 150 W,
 * Driftwood" already says Driftwood); an area names its city by ending with it ("East Austin"
 * already says Austin, "Downtown" doesn't). The first part is bolded by the card.
 */
export function eventPlaceParts(ev) {
  const parts = [ev?.venue, ev?.area, ev?.city].map((p) => String(p ?? '').trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const named = out.some((q, j) => q.toLowerCase().includes(p.toLowerCase()) && (j === 0 || q.toLowerCase().endsWith(p.toLowerCase())));
    if (!named) out.push(p);
  }
  return out;
}

/** A venue's name for a map pin: the name before its address, or the whole string when that's all there is. */
export function eventPinName(venue) {
  const first = String(venue ?? '').split(',')[0].trim();
  return /^\d+\s/.test(first) ? String(venue ?? '').trim() : first;
}

/**
 * The feed's places for the map, one pin per venue (events at the same coordinates share it),
 * shaped like mapPlaces() output so the map's pins, place list and picked-place panel work
 * unchanged: { id, name, short, city, lat, lng, sessions: [], booking, events, status, detail,
 * label, aria, done, full }. `today` is the region's ISO date, for "Happening now".
 */
export function eventPlaces(events, today) {
  const byCoords = new Map();
  for (const e of events ?? []) {
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;
    const key = `${e.lat.toFixed(5)},${e.lng.toFixed(5)}`;
    if (!byCoords.has(key)) byCoords.set(key, []);
    byCoords.get(key).push(e);
  }
  return [...byCoords.values()].map((list) => {
    const first = list[0];
    const parts = eventPlaceParts(first);
    const happeningList = list.filter((e) => e.startDate <= today && today <= (e.endDate ?? e.startDate));
    const happening = happeningList.length > 0;
    const next = [...list].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    // The date shown is the full range of the soonest event (or, when something is on
    // now, of the happening event that ends soonest) — not just its start date.
    const shown = happening
      ? [...happeningList].sort((a, b) => (a.endDate ?? a.startDate).localeCompare(b.endDate ?? b.startDate))[0]
      : next;
    const n = list.length;
    const status = happening ? `Happening now · ${eventDateRange(shown)}` : `${n} event${n === 1 ? '' : 's'} · ${eventDateRange(next)}`;
    return {
      id: `event:${first.lat.toFixed(5)},${first.lng.toFixed(5)}`,
      name: first.venue,
      short: eventPinName(first.venue),
      city: parts.slice(1).join(' · '),
      lat: first.lat,
      lng: first.lng,
      sessions: [],
      booking: null,
      events: sortEvents(list),
      status,
      detail: status,
      label: status,
      aria: `${first.venue}: ${status}`,
      done: false,
      full: false,
    };
  });
}

/** The page's events grouped by the month they start in, for the .p-group headers. */
export function groupByMonth(items) {
  const groups = new Map();
  for (const e of items ?? []) {
    const key = (e.startDate || '').slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups].map(([key, rows]) => {
    const [y, m] = key.split('-').map(Number);
    return { key, label: m ? `${MONTH_LONG[m - 1]} ${y}` : 'Date to be announced', events: rows };
  });
}

/**
 * The Sports dropdown's open state, as a pure transition: tapping Sports toggles it; picking a
 * sport, tapping Events, tapping outside it, or Esc closes it.
 */
export const dropdownNext = (open, action) => (action === 'toggle' ? !open : false);
