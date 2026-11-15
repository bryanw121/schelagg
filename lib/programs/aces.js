// ACES (Austin Crew of Everything Social): every league and tournament open for sign-up, from
// its members site's "Open leagues" page (members.acesintexas.com/leagues). The page is a Next.js
// page whose data rides in `self.__next_f.push([1, "..."])` script chunks; each league is a JSON
// record there with its dates, registration window, early-bird deadline, prices in cents per
// pricing tier, divisions and venue. robots.txt allows the page (it disallows /admin/ and /api/).
// Unlike acesintexas.com this site is not behind Cloudflare, so GitHub's runners can read it.
import { clean, dateIn, dayBefore, moneyRange, program, objectsAt, regionAt, DAY_NAMES } from './common.js';

export const id = 'aces';
export const ORG = 'ACES';
export const ORIGIN = 'https://members.acesintexas.com';
export const URL_ = `${ORIGIN}/leagues`;

/** The text of every Next.js data chunk on the page, joined and unescaped. */
export function nextChunks(html) {
  let out = '';
  for (const m of String(html).matchAll(/self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]); } catch { /* skip a chunk we can't read */ }
  }
  return out;
}

/** League records on the page: objects with an id, a name, a start date and pricing tiers. */
export function leagueRecords(html) {
  const text = nextChunks(html);
  const seen = new Map();
  for (const o of objectsAt(text, /\{"id":"[0-9a-f-]{36}","name":/g)) {
    if (o && o.start_date && Array.isArray(o.pricing_tiers) && (o.type === 'league' || o.type === 'tournament') && !seen.has(o.id)) seen.set(o.id, o);
  }
  return [...seen.values()];
}

/** Which pricing period applies on `today`: early bird until its deadline, late once late registration starts. */
export function periodOn(r, today) {
  if (r.late_registration_start_date && today >= r.late_registration_start_date) return 'late';
  if (r.early_bird_deadline && today <= String(r.early_bird_deadline).slice(0, 10)) return 'early_bird';
  return 'regular';
}

/** The price shown for `type` (team | individual) today: the current period's tiers, else every tier. */
function priceFor(r, type, today) {
  const tiers = [...(r.pricing_tiers ?? []), ...(r.divisions ?? []).flatMap((d) => d.pricing_tiers ?? [])]
    .filter((t) => t.registration_type === type && Number(t.total_cost_cents) > 0);
  if (!tiers.length) return null;
  const now = tiers.filter((t) => t.pricing_period === periodOn(r, today));
  return moneyRange((now.length ? now : tiers).map((t) => t.total_cost_cents / 100));
}

/** Programs from the page's HTML. `regions` (with center and radius) place each venue in a region. */
export function parseAces(html, { now = Date.now(), tz = 'America/Chicago', regions = [] } = {}) {
  const today = dateIn(now, tz);
  return leagueRecords(html)
    .filter((r) => !r.deleted_at && !r.is_template)
    .map((r) => {
      const v = r.venue ?? {};
      const period = periodOn(r, today);
      const early = r.early_bird_deadline ? String(r.early_bird_deadline).slice(0, 10) : null;
      return program({
        id: `aces-${r.id}`, kind: r.type, sport: 'volleyball',
        surface: ['sand', 'indoor', 'grass'].includes(r.sport) ? r.sport : null,
        region: regionAt(v.latitude, v.longitude, regions), state: v.state ?? null,
        org: ORG, source_id: id, title: clean(String(r.name).replace(/^'\d\d\s+/, '')),
        venue: v.name ?? r.location ?? null, city: v.city ?? null, address: v.formatted_address ?? null,
        lat: v.latitude, lng: v.longitude,
        format: [r.format, r.division].filter(Boolean).join(' · ') || null,
        divisions: (r.divisions ?? []).filter((d) => d.is_active !== false).map((d) => ({ name: d.name })),
        starts_on: r.start_date, ends_on: r.end_date ?? r.start_date,
        weekdays: (r.play_days ?? []).map((d) => DAY_NAMES[d]).filter(Boolean),
        registration_opens: r.registration_open_date ?? null, registration_deadline: r.registration_close_date ?? null,
        team_price: priceFor(r, 'team', today), individual_price: priceFor(r, 'individual', today),
        price_note: period === 'early_bird' ? 'Early bird' : period === 'late' ? 'Late registration' : null,
        // The last day at today's price: the early-bird deadline, or the day before late registration starts.
        price_changes_on: period === 'early_bird' ? early : r.late_registration_start_date && today < r.late_registration_start_date ? dayBefore(r.late_registration_start_date) : null,
        status: r.status === 'open' ? 'open' : r.status === 'waitlist' ? 'waitlist' : r.status === 'full' ? 'full' : 'closed',
        signup_url: `${ORIGIN}/leagues/${r.id}`, source_url: URL_,
      });
    });
}

/** Read the live page. `get` is lib/http.js's. */
export async function read({ get, now, tz, regions }) {
  const res = await get(URL_);
  if (!res.ok) throw new Error(`${URL_}: HTTP ${res.status}`);
  const out = parseAces(res.text, { now, tz, regions });
  if (!out.length) throw new Error(`${URL_}: no leagues found on the page`);
  return out;
}
