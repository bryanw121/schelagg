// Texas Asian Olympics volleyball (texasao.org): one tournament a year, somewhere in Texas (Austin
// area through 2025, Dallas–Fort Worth in 2026). A small static site: the home page has the dates
// ("Nov 14 - 15, 2026", and a countdown to the start time), the venue and its address, and the
// number of divisions; /registration/ has the entry fee, team cap, roster rule and the sign-up form.
// We publish only those facts, never the roster sheet it links to. No robots.txt (the site is
// static files; a missing one answers 403), so nothing is disallowed.
import { clean, dateIn, money, monthDay, program } from './common.js';

export const id = 'texasao';
export const ORG = 'Texas Asian Olympics';
export const ORIGIN = 'https://texasao.org';
export const HOME = `${ORIGIN}/`;
export const REGISTRATION = `${ORIGIN}/registration/`;

const text = (html, re) => clean(String(html).match(re)?.[1] ?? '');

/** "Nov 14 - 15, 2026", "Nov 30 - Dec 1, 2026", "Nov 14, 2026" → { starts_on, ends_on }, or null. */
export function dateRange(s) {
  const m = String(s).match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s*[-–]\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2}))?,\s*(\d{4})/);
  if (!m) return null;
  const [, mon1, d1, mon2, d2, year] = m;
  const a = monthDay(`${mon1} ${d1}`), b = d2 ? monthDay(`${mon2 ?? mon1} ${d2}`) : a;
  if (!a || !b) return null;
  const iso = (y, [mo, d]) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const y = +year;
  return { starts_on: iso(b[0] < a[0] ? y - 1 : y, a), ends_on: iso(y, b) };
}

/** The tournament from the home and registration pages (either may be '' when it couldn't be read). */
export function parseTexasAO(home, registration = '', { now = Date.now(), tz = 'America/Chicago', regions = [] } = {}) {
  const chips = [...String(home).matchAll(/<span class="chip(?![^"]*countdown)[^"]*">([\s\S]*?)<\/span>/g)].map((m) => clean(m[1]));
  const dates = chips.map(dateRange).find(Boolean);
  if (!dates) return [];
  // The countdown's start time is the most exact start date the page has.
  const startIso = String(home).match(/new Date\('(\d{4}-\d\d-\d\d)T[\d:]+[+-]\d\d:\d\d'\)/)?.[1];
  const starts_on = startIso && startIso <= dates.ends_on ? startIso : dates.starts_on;
  const today = dateIn(now, tz);
  if (dates.ends_on < today) return [];
  const venue = text(home, /class="venue-name">([\s\S]*?)<\//) || null;
  const address = text(home, /class="venue-address">([\s\S]*?)<\//) || null;
  const city = address?.match(/,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}/)?.[1] ?? null;
  const state = address?.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] ?? 'TX';
  const divisionCount = chips.map((c) => c.match(/^(\d+)\s+Divisions?$/i)?.[1]).find(Boolean);
  const fee = registration.match(/Entry fee:\s*\$([\d,]+(?:\.\d\d)?)\s*per team/i)?.[1];
  const cap = registration.match(/Team cap:\s*(\d+)\s*teams/i)?.[1];
  const rule = text(registration, /<li>\s*(Up to \d+ non-Asian players? per team)\s*<\/li>/i);
  const roster = rule ? rule.charAt(0).toLowerCase() + rule.slice(1) : '';
  const page = clean(registration).toLowerCase();
  const status = /registration (?:is )?closed|sold out/.test(page) ? 'closed' : /\b(?:full|at capacity)\b/.test(page) ? 'full' : /wait ?list/.test(page) ? 'waitlist' : 'open';
  return [program({
    id: `texasao-${starts_on}`, kind: 'tournament', sport: 'volleyball', surface: null,
    // No coordinates on the page: in a region only when the city is the region's own ("Austin, TX"),
    // else placed by state, so it lists with the state's tournaments.
    region: regions.find((r) => city && r.name && r.name.split(',')[0].trim().toLowerCase() === city.toLowerCase())?.id ?? null, state,
    series: 'asian-olympics', org: ORG, title: 'Texas Asian Olympics · Volleyball',
    venue, city, address,
    format: [divisionCount && `${divisionCount} divisions`, roster].filter(Boolean).join(' · ') || null,
    divisions: cap ? [{ name: 'Teams', cap: +cap }] : [],
    starts_on, ends_on: dates.ends_on,
    team_price: money(fee?.replace(/,/g, '')),
    status, signup_url: REGISTRATION, source_url: HOME,
  })];
}

/** Read both pages. The home page is required; without the registration page the fee and cap stay null. */
export async function read({ get, now, tz, regions }) {
  const home = await get(HOME);
  if (!home.ok) throw new Error(`${HOME}: HTTP ${home.status}`);
  const reg = await get(REGISTRATION).catch(() => null);
  const out = parseTexasAO(home.text, reg?.ok ? reg.text : '', { now, tz, regions });
  if (!out.length && !/Asian Olympics/i.test(home.text)) throw new Error(`${HOME}: not the page we expect`);
  return out;
}
