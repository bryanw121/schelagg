// Events from organizers' and listing sites' own pages (config/events.json), merged into the
// events feed (public/data/events.json). Each page is read for schema.org Event objects in its
// JSON-LD (AllEvents category pages, Visit Austin's event lists, organizers' pages): the same
// structured data those sites publish for search engines. Only pages robots.txt allows are
// listed in the config; sites that block automated reading (Do512, Eventbrite, the Austin
// Chronicle) or need a sign-in (Instagram) are never read.
//
// Kept: markets, pop-ups, fairs, festivals and seasonal things (lights, holiday markets);
// dropped: classes, talks, networking and anything outside the region. Each kept event gets a
// kind (popup / seasonal) and tags (asian-inspired), the same shape the site reads.

import { createHash } from 'node:crypto';
import { kmBetween } from './geocode.js';

const DATE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
export const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m));
const clean = (s) => decode(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Every schema.org Event in a page's JSON-LD (nested @graph, ItemList items included). */
export function jsonLdEvents(html) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const types = [].concat(o['@type'] ?? []);
    if (types.some((t) => /Event$/.test(String(t))) && o.name && o.startDate) { out.push(o); return; }
    for (const v of Object.values(o)) walk(v);
  };
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* a broken block is skipped */ }
  }
  return out;
}

const KEEP = /\b(markets?|bazaars?|pop[- ]?ups?|cook[- ]?offs?|supper clubs?|food trucks?|fairs?|festivals?|fest|expo|makers|craft|artisan|vendors?|flea|night market|holiday|christmas|xmas|santa|lights|luminations|tree lighting|winter|thanksgiving|halloween|new year|lunar|matsuri|parade|trail of lights)\b/i;
const DROP = /\b(class|classes|workshop|summit|webinar|meetup|networking|conference|seminar|course|bootcamp|training|startups?|career|job fair|hiring|info session|orientation|marketing|investor|panel|lecture|preview|worship|mass|service|concert|comedy|tour|recipes?|cookin'?|cooking|meal|bash|registration)\b|\blive:/i;
const SEASONAL = /\b(holiday|christmas|xmas|santa|winter|lights|luminations|tree lighting|thanksgiving|halloween|new year|hanukkah|chanukah|kwanzaa|valentine|easter|pumpkin|fall fest|spring fest|lunar new year|d[ií]a de (los )?muertos|mardi gras|trail of lights|peppermint|yule|noel|jingle)\b/i;
const ASIAN = /\b(asian|japan|japanese|matcha|mochi|boba|korean|k-?pop|chinese|lunar new year|vietnam(ese)?|pho|banh mi|thai|ramen|sushi|dumplings?|filipino|taiwan(ese)?|hong kong|anime|matsuri|izakaya|onigiri|hojicha|kimchi|indian|diwali|holi)\b/i;

/** Whether a listing is the kind of thing the Events tab is for. */
export const isWanted = (title, description = '') => KEEP.test(`${title} ${description}`) && !DROP.test(title);
/** popup or seasonal, and the tags, from the title and description. */
export function classify(title, description = '') {
  const text = `${title} ${description}`;
  return { kind: SEASONAL.test(text) ? 'seasonal' : 'popup', tags: ASIAN.test(text) ? ['asian-inspired'] : [] };
}

const money = (n) => (Number(n) === 0 ? 'Free' : Number.isFinite(Number(n)) ? `$${Number(n) % 1 ? Number(n).toFixed(2) : Number(n)}` : null);
function priceOf(offers) {
  const list = [].concat(offers ?? []).filter(Boolean);
  if (!list.length) return null;
  const nums = list.flatMap((o) => [o.lowPrice, o.price, o.highPrice]).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === 0 && hi === 0 ? 'Free' : lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`.replace('Free–', '$0–');
}
const short = (s, n = 180) => { const t = clean(s); if (t.length <= n) return t || null; const cut = t.slice(0, n); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! ')); return `${(end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')).trim()}${end > 60 ? '' : '…'}`; };
const hhmm = (h, m) => (h ? `${h}:${m}` : null);

const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
/** A listing's title without its decorations: emoji, a trailing date ("✨ Nov. 21"), "| AUSTIN". */
export function tidyTitle(t) {
  return clean(t).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(new RegExp(`[\\s,|–-]*${MONTHS}\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s*\\d{4})?\\s*$`, 'i'), '')
    .replace(/\s*[|–-]\s*(austin|atx)(,?\s*tx)?\s*$/i, '')
    .replace(/[\s!|–-]+$/, '').replace(/\s+/g, ' ').trim()
    // "JAPAN Fes Texas Unlimited | All-You-Can-Eat Japanese Festival" → the name before the tagline.
    .replace(/^(.{6,}?)\s+[|–-]\s+.*$/, (m, head) => (head.trim().split(/\s+/).length >= 2 ? head.trim() : m));
}

/** A schema.org Event as a feed event, or null when it isn't one we keep. */
export function toFeedEvent(o, { source, region, today }) {
  const title = tidyTitle(o.name);
  const description = short(o.description);
  if (!title || !isWanted(title, description ?? '')) return null;
  const s = String(o.startDate).match(DATE), e = o.endDate ? String(o.endDate).match(DATE) : null;
  if (!s) return null;
  const startDate = s[1], endDate = e && e[1] > startDate ? e[1] : null;
  if ((endDate ?? startDate) < today) return null;
  const place = [].concat(o.location ?? [])[0] ?? {};
  const addr = place.address ?? {};
  const street = clean(typeof addr === 'string' ? addr : addr.streetAddress).replace(/,\s*(United States|USA)$/i, '').replace(/,\s*[A-Za-z .]+,\s*TX\s*\d{5}(-\d{4})?$/i, '');
  const name = clean(place.name);
  // "Name, street", or one of them when the other says the same ("6100 Airport Blvd" and "6100 Airport Boulevard").
  const sameNumber = /^\d+\s/.test(name) && name.split(' ')[0] === street.split(' ')[0];
  const venue = (sameNumber ? street || name : [name, street && !name.toLowerCase().includes(street.toLowerCase().split(',')[0]) ? street : ''].filter(Boolean).join(', ')) || null;
  if (!venue) return null;
  const lat = Number(place.geo?.latitude), lng = Number(place.geo?.longitude);
  const located = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0;
  if (located && region?.center && region?.radiusKm && kmBetween(region.center, [lat, lng]) > region.radiusKm) return null;
  const city = clean(typeof addr === 'object' ? addr.addressLocality : '') || region?.city || null;
  const url = String(o.url ?? o['@id'] ?? '').split('#')[0];
  if (!/^https:\/\//.test(url)) return null;
  const { kind, tags } = classify(title, description ?? '');
  return {
    id: `evt-${createHash('sha256').update(`${url}|${startDate}`).digest('hex').slice(0, 16)}`,
    category: tags.includes('asian-inspired') && kind === 'popup' ? 'asian-inspired' : kind, // for older readers
    kind, tags, title, venue, city, startDate,
    ...(endDate ? { endDate } : {}),
    ...(hhmm(s[2], s[3]) && hhmm(s[2], s[3]) !== '00:00' ? { startTime: hhmm(s[2], s[3]) } : {}),
    ...(e && hhmm(e[2], e[3]) && hhmm(e[2], e[3]) !== '00:00' && hhmm(e[2], e[3]) !== '23:59' ? { endTime: hhmm(e[2], e[3]) } : {}),
    ...(priceOf(o.offers) ? { price: priceOf(o.offers) } : {}),
    sourceUrl: url, source,
    ...(description ? { description } : {}),
    region: region?.id ?? 'austin',
    ...(located ? { lat: +lat.toFixed(5), lng: +lng.toFixed(5), located: 'source' } : {}),
  };
}

/** Read every configured page; returns { results: [{ id, ok, error, events }] }. */
export async function readEventSources(config, { get, today, regions }) {
  const results = [];
  for (const src of config.sources ?? []) {
    const region = regions.find((r) => r.id === (src.region ?? 'austin'));
    const events = [];
    let failed = 0, error = null;
    for (const url of src.urls ?? []) {
      const r = await get(url).catch((e) => ({ ok: false, status: e.message }));
      if (!r.ok) { failed++; error = `${url}: ${r.status}`; continue; }
      for (const o of jsonLdEvents(r.text)) {
        const ev = toFeedEvent(o, { source: src.name, region: region && { ...region, city: region.name?.split(',')[0] }, today });
        if (ev && !events.some((x) => x.id === ev.id)) events.push(ev);
      }
    }
    const ok = failed < (src.urls ?? []).length;
    results.push({ id: src.id, ok, error: ok ? null : error, events });
  }
  return results;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'austin', 'atx', 'tx', 'annual', '2026', '2027', 'presents', 'x', 'with']);
const words = (t) => new Set(String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
/**
 * Two listings of the same thing: their dates overlap and their titles share most words
 * ("A Christmas Affair" Nov 18–22 on one site, Nov 19–22 on another).
 */
export function sameEvent(a, b) {
  if (a.sourceUrl && a.sourceUrl === b.sourceUrl) return true;
  const end = (e) => e.endDate ?? e.startDate;
  if (!(a.startDate <= end(b) && b.startDate <= end(a))) return false;
  // The same series at two places on one day ("Witches Market @ Buzz Mill", "@ The Brewtorium") are two events.
  if ([a.lat, a.lng, b.lat, b.lng].every(Number.isFinite) && kmBetween([a.lat, a.lng], [b.lat, b.lng]) > 1) return false;
  const x = words(a.title), y = words(b.title);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= (a.startDate === b.startDate ? 0.6 : 0.8);
}

/**
 * The new feed: this run's events from the sources, plus the previous feed's events from
 * anywhere else (another discovery run's) that this run doesn't duplicate and that aren't
 * over. A source that failed keeps its last events. A listing with coordinates wins a tie.
 */
export function mergeEvents(previous, results, today, sourceNames) {
  const fromSources = new Set(sourceNames);
  const failed = new Set(results.filter((r) => !r.ok).map((r) => r.id));
  const fresh = results.filter((r) => r.ok).flatMap((r) => r.events);
  const kept = (previous?.events ?? []).filter((e) => (e.endDate ?? e.startDate) >= today && (!fromSources.has(e.source) || failed.has(e.sourceId)));
  const out = [];
  for (const e of [...fresh, ...kept]) {
    const twin = out.findIndex((x) => sameEvent(x, e));
    if (twin < 0) { out.push(e); continue; }
    // Keep the first (this run's), borrowing the other's pin, address, times and price when it has none.
    const a = out[twin];
    if (!Number.isFinite(a.lat) && Number.isFinite(e.lat)) out[twin] = { ...a, lat: e.lat, lng: e.lng, located: e.located, ...(/\d/.test(a.venue) ? {} : { venue: e.venue }) };
    for (const k of ['startTime', 'endTime', 'price', 'description']) if (out[twin][k] == null && e[k] != null) out[twin] = { ...out[twin], [k]: e[k] };
  }
  // A listing without a pin borrows one from the last feed's copy of the same event (the same
  // source's earlier copy included), so a pin placed once isn't lost on the next read.
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i].lat)) continue;
    const prev = (previous?.events ?? []).find((p) => Number.isFinite(p.lat) && sameEvent(out[i], p));
    if (prev) out[i] = { ...out[i], lat: prev.lat, lng: prev.lng, located: prev.located, ...(/\d/.test(out[i].venue ?? '') || !prev.venue ? {} : { venue: prev.venue }) };
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
}

/**
 * Listing events another writer dropped. The feed has more than one writer (the listing readers
 * here, and an agent that adds Instagram finds), and a writer that rewrites the whole file can
 * leave the listing events out. `cached` is what the listing readers last found: any of those
 * still upcoming and no longer in the feed come back, so one writer never costs another its rows.
 */
export function missingListings(feedEvents, cached, today) {
  const have = feedEvents ?? [];
  return (cached ?? []).filter((e) => (e.endDate ?? e.startDate) >= today && !have.some((x) => sameEvent(x, e)));
}

/**
 * The ledger of accounts the feed has credited ("Instagram @x"), across runs:
 * { handle: { events: [event ids], first, last } }. A scout (an agent, a person) finds events by
 * hand; the ledger is how a repeat find turns into a fixed source (promotedAccounts).
 */
export function creditAccounts(ledger, events, today, handleOf) {
  const out = structuredClone(ledger ?? {});
  for (const e of events ?? []) {
    const h = handleOf(e.source);
    if (!h || !e.id) continue;
    const row = out[h] ?? (out[h] = { events: [], first: today, last: today });
    if (!row.events.includes(e.id)) { row.events = [...row.events, e.id].slice(-50); row.last = today; }
  }
  return out;
}
/** Accounts credited with `min` or more different events that aren't already followed or set aside: read by rule from now on. */
export const promotedAccounts = (ledger, known, min = 2) => Object.entries(ledger ?? {})
  .filter(([h, r]) => (r.events?.length ?? 0) >= min && !known.has(h)).map(([h]) => h).sort();
