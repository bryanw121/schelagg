// Leagues and tournaments ("programs"): shared shapes and helpers for the readers in this folder.
//
// A program is one league season or one tournament, as its organizer lists it for sign-up. The
// readers only report what a source states: a price, deadline, cap or status the page doesn't give
// stays null. Times are dates (YYYY-MM-DD) in the region's zone; sign-up happens on the organizer's site.

export const KINDS = ['league', 'tournament'];
export const STATUSES = ['open', 'waitlist', 'full', 'closed'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "$40", "$40.50" from dollars; null for nothing or zero. */
export function money(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** "$400" or "$400–500" from a list of dollar amounts (the low and high), null when there are none. */
export function moneyRange(amounts) {
  const xs = amounts.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const lo = xs[0], hi = xs.at(-1);
  return lo === hi ? money(lo) : `${money(lo)}–${String(money(hi)).slice(1)}`;
}

/** The date (YYYY-MM-DD) an instant falls on in `tz`. */
export function dateIn(ms, tz = 'America/Chicago') {
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Great-circle distance in km. */
export function distanceKm([lat1, lng1], [lat2, lng2]) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** The region (id) whose circle holds the point, or null. `regions`: [{ id, center: [lat, lng], radiusKm }]. */
export function regionAt(lat, lng, regions) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return regions.find((g) => g.center && distanceKm([lat, lng], g.center) <= (g.radiusKm ?? 60))?.id ?? null;
}

/**
 * A month and day with no year ("November 22", "11.22") as the first such date on or after
 * `from` (YYYY-MM-DD) minus `slackDays`: listings drop the year and always mean the coming one.
 */
export function upcomingDate(month, day, from, slackDays = 60) {
  const [y] = from.split('-').map(Number);
  const floor = new Date(`${from}T00:00:00Z`).getTime() - slackDays * 864e5;
  for (const year of [y - 1, y, y + 1]) {
    const t = Date.UTC(year, month - 1, day);
    if (t >= floor) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "November 22" / "Nov 22" → [11, 22], or null. */
export function monthDay(text) {
  const m = String(text ?? '').match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/);
  if (!m) return null;
  const i = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
  return i < 0 ? null : [i + 1, +m[2]];
}

/** Collapse whitespace and decode the few HTML entities listings use. */
export function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0*39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&bull;/g, '•')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

/** Volleyball surface from a sport or title ("Sand Volleyball", "Indoor 6s"), or null. */
export function surfaceOf(...texts) {
  const s = texts.join(' ').toLowerCase();
  if (/\b(sand|beach)\b/.test(s)) return 'sand';
  if (/\bgrass\b/.test(s)) return 'grass';
  if (/\b(indoor|gym)\b/.test(s)) return 'indoor';
  return null;
}

/**
 * Parse every JSON object in `text` that starts at a `{` matched by `startRe` (a RegExp with the
 * `g` flag, matching the object's opening). Objects that don't parse are skipped.
 */
export function objectsAt(text, startRe) {
  const out = [];
  for (const m of text.matchAll(startRe)) {
    const start = m.index;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) continue;
    try { out.push(JSON.parse(text.slice(start, end))); } catch { /* not an object we can read */ }
  }
  return out;
}

/** A program with every field present (null when the source didn't say), in a stable key order. */
export function program(p) {
  return {
    id: p.id, kind: p.kind, sport: p.sport ?? 'volleyball', surface: p.surface ?? null,
    region: p.region ?? null, state: p.state ?? null, series: p.series ?? null,
    org: p.org, source_id: p.source_id, title: p.title,
    venue: p.venue ?? null, city: p.city ?? null, address: p.address ?? null,
    lat: Number.isFinite(p.lat) ? p.lat : null, lng: Number.isFinite(p.lng) ? p.lng : null,
    format: p.format ?? null, level: p.level ?? null, divisions: p.divisions ?? [],
    starts_on: p.starts_on ?? null, ends_on: p.ends_on ?? null, weekdays: p.weekdays ?? [],
    registration_opens: p.registration_opens ?? null, registration_deadline: p.registration_deadline ?? null,
    waitlist_on: p.waitlist_on ?? null,
    team_price: p.team_price ?? null, individual_price: p.individual_price ?? null,
    price_note: p.price_note ?? null, price_changes_on: p.price_changes_on ?? null,
    status: STATUSES.includes(p.status) ? p.status : null,
    signup_url: p.signup_url ?? null, source_url: p.source_url ?? null,
  };
}
