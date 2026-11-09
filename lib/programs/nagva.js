// NAGVA (North American Gay Volleyball Association) tournaments in one state (Texas here). The
// tournaments page (nagva.org/tournaments, a Wix site) embeds every tournament record as JSON:
// dates, city, facility with coordinates, divisions with caps, payment deadlines with the team fee
// due by each, and the tournament's own page. Each upcoming tournament's page lists its registered
// teams, from which we count confirmed teams per division (counts only: no team names, and none of
// the director / registrar contacts or payment handles the records also carry).
import { clean, dateIn, money, objectsAt, program, regionAt, surfaceOf } from './common.js';

export const id = 'nagva';
export const ORG = 'NAGVA';
export const ORIGIN = 'https://www.nagva.org';
export const URL_ = `${ORIGIN}/tournaments`;

const day = (v, tz) => (v && typeof v === 'object' && v.$date ? dateIn(Date.parse(v.$date), tz) : typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v) ? v.slice(0, 10) : null);

/** The state a record is in ("TX"), from its facility's address. */
export function stateOf(r) {
  const f = r.facility1Map;
  if (f && typeof f === 'object') {
    if (f.subdivision) return f.subdivision;
    const s = (f.subdivisions ?? []).find((x) => x.type === 'ADMINISTRATIVE_AREA_LEVEL_1');
    if (s) return s.code;
    const m = String(f.formatted ?? '').match(/,\s*([A-Z]{2})\s+\d{5}/);
    if (m) return m[1];
  }
  return typeof r.state === 'string' && r.state ? r.state : null;
}

/** Tournament records on the list page. */
export function tournamentRecords(html) {
  const seen = new Map();
  const text = String(html);
  // Each record has a link to its page; walk back from it to the record's opening brace.
  for (const m of text.matchAll(/"link-tournaments-1-title"/g)) {
    let i = m.index, depth = 0;
    for (; i > 0; i--) {
      const c = text[i];
      if (c === '}') depth++;
      else if (c === '{') { if (depth === 0) break; depth--; }
    }
    const [o] = objectsAt(text.slice(i, i + 200000), /^\{/g);
    if (o && o._id && o.title && o.date?.$date && o['link-tournaments-1-title'] && !seen.has(o._id)) seen.set(o._id, o);
  }
  return [...seen.values()];
}

/** Divisions with their caps ("division1" + "division1Cap"; the site has a "divison6Cap" typo). */
export function divisionsOf(r) {
  const out = [];
  for (let i = 1; i <= 12; i++) {
    const name = clean(r[`division${i}`]);
    if (!name) continue;
    const cap = Number(r[`division${i}Cap`] ?? r[`divison${i}Cap`]);
    out.push({ name, ...(Number.isFinite(cap) && cap > 0 ? { cap } : {}) });
  }
  return out;
}

/** Payment deadlines in order, each with the team fee due by it ([{ on, amount }]). */
export function feeSchedule(r, tz) {
  const amounts = [r.paymentDeadline1Amount, r.paymentDeadline2Amount, r.paymentDeadline3Amount ?? r.paymentDeadline];
  const out = [];
  for (let i = 1; i <= 3; i++) {
    const on = day(r[`paymentDeadline${i}`], tz);
    const amount = Number(String(amounts[i - 1] ?? '').replace(/[$,]/g, ''));
    if (on) out.push({ on, amount: Number.isFinite(amount) && amount > 0 ? amount : null });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
}

/** Confirmed teams per division from a tournament page's "Registered Teams" table. */
export function confirmedCounts(html) {
  const counts = {};
  for (const row of String(html).split(/<tr class="[^"]*wixui-table__row"[^>]*>/).slice(1)) {
    const cells = [...row.split('</tr>')[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]));
    if (cells.length < 5) continue;
    const [, , division, , status] = cells;
    if (division && /^confirmed$/i.test(status)) counts[division] = (counts[division] ?? 0) + 1;
  }
  return counts;
}

/**
 * Upcoming tournaments in `state` from the list page. `confirmed` maps a record id to its counts
 * (from confirmedCounts) when its page was read.
 */
export function parseNagva(html, { now = Date.now(), tz = 'America/Chicago', regions = [], state = 'TX', confirmed = {} } = {}) {
  const today = dateIn(now, tz);
  return tournamentRecords(html)
    .filter((r) => stateOf(r) === state)
    .map((r) => {
      const starts = day(r.date, tz);
      const ends = day(r.endDate, tz) ?? starts;
      const fees = feeSchedule(r, tz);
      const next = fees.find((f) => f.on >= today);
      const f = r.facility1Map && typeof r.facility1Map === 'object' ? r.facility1Map : {};
      const lat = f.location?.latitude, lng = f.location?.longitude;
      const counts = confirmed[r._id];
      const page = `${ORIGIN}${r['link-tournaments-1-title']}`;
      const waitlist = day(r.waitlistDate, tz);
      const deadline = fees.at(-1)?.on ?? null;
      return program({
        id: `nagva-${r._id}`, kind: 'tournament', sport: 'volleyball', surface: surfaceOf(r.title),
        region: regionAt(lat, lng, regions), state, series: 'nagva', org: ORG, source_id: id,
        title: clean(r.title), venue: clean(r.facility1) || null, city: clean(f.city ?? r.city) || null,
        address: f.formatted ?? null, lat, lng,
        divisions: divisionsOf(r).map((d) => (counts ? { ...d, confirmed: counts[d.name] ?? 0 } : d)),
        starts_on: starts, ends_on: ends,
        registration_deadline: deadline, waitlist_on: waitlist,
        team_price: money(next?.amount ?? fees.at(-1)?.amount),
        price_note: next && fees.indexOf(next) < fees.length - 1 ? `Until ${next.on}` : null,
        price_changes_on: next && fees.indexOf(next) < fees.length - 1 ? next.on : null,
        status: deadline && today > deadline ? 'closed' : waitlist && today >= waitlist ? 'waitlist' : 'open',
        signup_url: page, source_url: page,
      });
    })
    .filter((p) => p.ends_on && p.ends_on >= today);
}

/** Read the list page, then each upcoming tournament's page for its confirmed counts. */
export async function read({ get, now, tz, regions, options = {} }) {
  const state = options.state ?? 'TX';
  const res = await get(URL_);
  if (!res.ok) throw new Error(`${URL_}: HTTP ${res.status}`);
  if (!tournamentRecords(res.text).length) throw new Error(`${URL_}: no tournaments found on the page`);
  const upcoming = parseNagva(res.text, { now, tz, regions, state });
  const confirmed = {};
  for (const p of upcoming) {
    if (p.status === 'closed') continue;
    try {
      const page = await get(p.source_url);
      if (page.ok) confirmed[p.id.slice('nagva-'.length)] = confirmedCounts(page.text);
    } catch { /* counts are extra: the tournament still lists without them */ }
  }
  return parseNagva(res.text, { now, tz, regions, state, confirmed });
}
