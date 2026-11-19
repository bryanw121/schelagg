import { inWindow } from './when.js';
import { eventText, matchesText, searchTags } from './search.js';
// The Events view's pure helpers (public/app.js imports these; node tests import them too,
// so nothing here may touch the DOM or the network). The feed is public/data/events.json:
// { feedVersion, generatedAt, events: [{ id, category, title, venue, area, city, startDate,
// endDate, startTime, endTime, price, sourceUrl, source, description, lat, lng, located }] }.

/**
 * What kind of event it is (one) and its tags (any number). The feed's `category` is one of
 * popup / seasonal / asian-inspired; "Asian-inspired" is a theme, not a kind, so it reads as a
 * tag (a feed may also send `kind` and `tags` directly).
 */
export const EVENT_KINDS = [
  { id: 'popup', label: 'Pop-ups', one: 'Pop-up', hint: 'One-off shops, food and art' },
  { id: 'seasonal', label: 'Seasonal', one: 'Seasonal', hint: 'Holiday markets, lights and bars' },
];
export const EVENT_TAGS = [{ id: 'asian-inspired', label: 'Asian-inspired' }];
export const isEventKind = (k) => k === 'all' || EVENT_KINDS.some((x) => x.id === k);
export const isEventTag = (t) => EVENT_TAGS.some((x) => x.id === t);
export const eventKind = (ev) => ev?.kind ?? (EVENT_KINDS.some((k) => k.id === ev?.category) ? ev.category : null);
export const eventTags = (ev) => [...new Set([...(ev?.tags ?? []), ...(ev?.category && isEventTag(ev.category) ? [ev.category] : [])])];
export const kindLabel = (k) => EVENT_KINDS.find((x) => x.id === k)?.one ?? null;
export const tagLabel = (t) => EVENT_TAGS.find((x) => x.id === t)?.label ?? t;
/** How many events each kind and tag has (plus `all`), for the filter sheet. */
export function countEvents(events) {
  const counts = { all: 0 };
  for (const k of EVENT_KINDS) counts[k.id] = 0;
  for (const g of EVENT_TAGS) counts[g.id] = 0;
  for (const e of events ?? []) {
    counts.all++;
    const k = eventKind(e); if (k) counts[k]++;
    for (const g of eventTags(e)) if (counts[g] != null) counts[g]++;
  }
  return counts;
}
/** A feed covers one region (`region` on the feed or on an event; the first feed is Austin's). */
export const eventsForRegion = (feed, regionId) => (feed?.events ?? []).filter((e) => (e.region ?? feed?.region ?? 'austin') === regionId);

/** The feed's order: soonest first, ties by title. */
export const sortEvents = (events) => [...(events ?? [])].sort((a, b) =>
  (a.startDate || '').localeCompare(b.startDate || '') || (a.title || '').localeCompare(b.title || ''));

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parseDay = (iso) => { const [y, m, d] = (iso || '').split('-').map(Number); return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)); };
const shortDay = (iso) => { const d = parseDay(iso); return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`; };
/** A date always says its day of the week: "Sat, Dec 5". */
const weekDay = (iso) => WEEKDAY[parseDay(iso).getUTCDay()];
const fullDay = (iso) => `${weekDay(iso)}, ${shortDay(iso)}`;
/** "Sat, Dec 5" for one day; "Thu, Nov 12 – Mon, Nov 23" for a range. */
export function eventDateRange(ev) {
  const a = ev?.startDate, b = ev?.endDate;
  return !b || b === a ? fullDay(a) : `${fullDay(a)} – ${fullDay(b)}`;
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
      // What the pin and its row are called: the event on now (or the soonest), and how many more.
      title: shown.title,
      more: n - 1,
      avatar: avatarPath(shown),
      account: shown.account ?? null,
      city: parts.slice(1).join(' · '),
      lat: first.lat,
      lng: first.lng,
      sessions: [],
      booking: null,
      events: sortEvents(list),
      lead: shown, // the event the place is named for: decides which heading its row sits under
      status,
      detail: status,
      label: status,
      aria: `${shown.title}${n > 1 ? ` and ${n - 1} more` : ''} at ${eventPinName(first.venue)}: ${status}`,
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

const addDays = (iso, n) => { const d = parseDay(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastDay = (ev) => ev.endDate ?? ev.startDate;
/** On now: started and not over on `today`. */
export const isOn = (ev, today) => ev.startDate <= today && today <= lastDay(ev);

/**
 * The Events list's headings, like the Sports days: On now (ending soonest first), This
 * weekend (Fri–Sun of this week, or the rest of it), Next week (Mon–Sun), then each later
 * month. Each event sits under one heading, by when it starts; anything over is dropped.
 */
export function eventGroups(events, today) {
  const dow = parseDay(today).getUTCDay(); // 0 Sun … 6 Sat
  const fri = dow === 0 ? addDays(today, -2) : addDays(today, 5 - dow);
  const sun = addDays(fri, 2);
  const nextMon = addDays(sun, 1), nextSun = addDays(nextMon, 6);
  const live = (events ?? []).filter((e) => lastDay(e) >= today);
  const on = live.filter((e) => isOn(e, today)).sort((a, b) => lastDay(a).localeCompare(lastDay(b)) || a.title.localeCompare(b.title));
  const later = sortEvents(live.filter((e) => !isOn(e, today)));
  const groups = [];
  if (on.length) groups.push({ key: 'now', label: 'On now', sub: `${on.length} event${on.length === 1 ? '' : 's'} · ending soonest first`, events: on });
  const weekend = later.filter((e) => e.startDate <= sun);
  const wkFrom = today > fri ? today : fri;
  if (weekend.length) groups.push({ key: 'weekend', label: today >= fri || dow === 0 ? 'This weekend' : 'This week', sub: `${dayLabel(today < fri ? addDays(today, 1) : wkFrom)} – ${dayLabel(sun)} · ${weekend.length} event${weekend.length === 1 ? '' : 's'}`, events: weekend });
  const next = later.filter((e) => e.startDate > sun && e.startDate <= nextSun);
  if (next.length) groups.push({ key: 'next', label: 'Next week', sub: `${dayLabel(nextMon)} – ${dayLabel(nextSun)} · ${next.length} event${next.length === 1 ? '' : 's'}`, events: next });
  const months = new Map();
  for (const e of later.filter((x) => x.startDate > nextSun)) {
    const k = e.startDate.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(e);
  }
  for (const [k, list] of months) {
    const [y, m] = k.split('-').map(Number);
    groups.push({ key: k, label: MONTH_LONG[m - 1], sub: `${y} · ${list.length} event${list.length === 1 ? '' : 's'}`, events: list });
  }
  return groups;
}
const dayLabel = (iso) => { const d = parseDay(iso); return `${WEEKDAY[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`; };

/** Fri–Sun of this week (or the rest of it on a weekend): for the This weekend pill. */
export function weekendRange(today) {
  const dow = parseDay(today).getUTCDay();
  const fri = dow === 0 ? addDays(today, -2) : addDays(today, 5 - dow);
  return { from: today > fri ? today : fri, to: addDays(fri, 2) };
}

/**
 * The filters: a kind (or all), tags (all must match), "this weekend" (on any day of it), one
 * day (on that day), a time window (hours overlap it; events that list no hours stay), and a
 * search (every word found in its title, place, organizer, description, kind or tags).
 */
export function filterEvents(events, { kind = 'all', tags = [], weekend = false, day = null, window = null, q = '', topic = null } = {}, today) {
  const wk = weekend ? weekendRange(today) : null;
  return (events ?? []).filter((e) => (kind === 'all' || eventKind(e) === kind)
    && tags.every((g) => eventTags(e).includes(g))
    && (!wk || (e.startDate <= wk.to && lastDay(e) >= wk.from))
    && (!day || (e.startDate <= day && lastDay(e) >= day))
    && inWindow(e.startTime, e.endTime, window)
    && (!topic || searchTags(e).includes(topic))
    && (!q || matchesText(eventText(e, [kindLabel(eventKind(e)), ...eventTags(e).map(tagLabel)]), q)));
}

/** The left column of an event card: "Thru / Nov 23" when on now, "Sat / Nov 21", or "Nov 19 / to Nov 22". */
export function eventWhen(ev, today) {
  const end = lastDay(ev);
  if (isOn(ev, today) && end !== ev.startDate) return { top: `Thru ${weekDay(end)}`, main: shortDay(end) };
  if (end === ev.startDate) { const d = parseDay(ev.startDate); return { top: WEEKDAY[d.getUTCDay()], main: `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}` }; }
  return { top: shortDay(ev.startDate), main: `to ${weekDay(end)} ${shortDay(end)}`, range: true, dow: weekDay(ev.startDate) };
}

/** The card's main button: Instagram posts read "See the post", anything else "Event page". */
export const eventCta = (ev) => (/(^|\.)instagram\.com$/i.test((() => { try { return new URL(ev.sourceUrl).hostname; } catch { return ''; } })()) ? 'See the post' : 'Event page');

/** An event's saved organizer picture as a path under data/ ("avatars/<handle>.jpg"), or null. */
export const avatarPath = (ev) => (/^avatars\/[a-z0-9._]{1,30}\.(jpg|png|webp)$/.test(ev?.avatar ?? '') && !ev.avatar.includes('..') ? ev.avatar : null);

/**
 * The map's places under the same headings as the list (On now, This week, Next week, months),
 * each place under the heading of the event it is named for: [{ key, label, sub, places }].
 */
export function placeGroups(places, today) {
  const byLead = new Map((places ?? []).filter((p) => p.lead).map((p) => [p.lead, p]));
  return eventGroups([...byLead.keys()], today).map((g) => ({ key: g.key, label: g.label, sub: g.sub.replace(/(\d+) events?/, (_, n) => `${n} place${n === '1' ? '' : 's'}`), places: g.events.map((e) => byLead.get(e)) }));
}
