// Reclub competitions (leagues and tournaments run on reclub.co). Reclub's sitemap lists its
// newest competitions (reclub.co/c/<id>); each page carries the competition's record in its Nuxt
// data: sport, name, start, duration, registration window, fees in the currency's units, team
// cap and venue with coordinates. robots.txt allows all of it. We keep volleyball competitions
// whose venue is in one of our regions (or in `state`).
import { nuxtData } from '../devalue.js';
import { clean, dateIn, money, program, regionAt, surfaceOf } from './common.js';

export const id = 'reclub';
export const ORG = 'Reclub';
export const SITEMAP = 'https://reclub.co/__sitemap__/en-US.xml';
export const VOLLEYBALL = 10;

/** Competition page URLs in the sitemap, de-duplicated, in order. */
export function competitionUrls(xml) {
  return [...new Set([...String(xml).matchAll(/<loc>(https:\/\/reclub\.co\/c\/[0-9a-f-]{36})<\/loc>/g)].map((m) => m[1]))];
}

/** The competition record on a page, or null. */
export function competitionOf(html) {
  let data;
  try { data = nuxtData(html)?.data; } catch { return null; }
  for (const [k, v] of Object.entries(data ?? {})) if (k.startsWith('competition-') && v?.competition) return v.competition;
  return null;
}

/** The state an address ends in ("…, Pflugerville, Tx, United States" → "TX"). */
const stateOf = (address) => {
  const m = String(address ?? '').match(/,\s*(TX|Texas)\b/i);
  return m ? 'TX' : null;
};

/** A competition as a program, or null when it isn't volleyball in one of our places. */
export function parseCompetition(c, { url, now = Date.now(), regions = [], state = 'TX' } = {}) {
  if (!c || c.sportId !== VOLLEYBALL) return null;
  const loc = c.venue?.location ?? {};
  const tz = loc.timezone || 'America/Chicago';
  const region = regionAt(loc.latitude, loc.longitude, regions);
  const st = stateOf(loc.address);
  if (!region && st !== state) return null;
  const at = (s) => (Number.isFinite(s) && s > 0 ? dateIn(s * 1000, tz) : null);
  const end = Number.isFinite(c.endDatetime) && c.endDatetime > 0 ? c.endDatetime
    : Number.isFinite(c.duration) && c.duration > 0 ? c.startDatetime + c.duration : c.startDatetime;
  const deadline = at(c.registrationDeadline);
  const early = at(c.registrationEarlyBirdDeadline);
  const today = dateIn(now, tz);
  const earlyNow = early && today <= early && c.feeEarlyBirdAmount > 0;
  const team = c.participantType === 2;
  const fee = earlyNow ? c.feeEarlyBirdAmount : c.feeAmount;
  const freeAgent = earlyNow && c.feeFreeAgentEarlyBirdAmount > 0 ? c.feeFreeAgentEarlyBirdAmount : c.feeFreeAgentAmount;
  const name = clean(String(c.name ?? '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/^[\s–-]+|[\s–-]+$/g, ''));
  const closed = c.lockRegistration === 1 || Boolean(deadline && today > deadline);
  return program({
    id: `reclub-${c.id}`, kind: /\bleague\b/i.test(c.name) ? 'league' : 'tournament', sport: 'volleyball',
    surface: surfaceOf(c.name, c.venue?.name), region, state: st, org: ORG, source_id: id, title: name,
    venue: c.venue?.name ?? null, city: loc.locality ?? null, address: loc.address ?? null,
    lat: loc.latitude, lng: loc.longitude,
    divisions: c.participantMaxCount > 0 ? [{ name: team ? 'Teams' : 'Players', cap: c.participantMaxCount }] : [],
    starts_on: at(c.startDatetime), ends_on: at(end),
    registration_opens: at(c.registrationStart), registration_deadline: deadline,
    team_price: team ? money(fee) : null, individual_price: team ? money(freeAgent) : money(fee),
    price_note: earlyNow ? 'Early bird' : null, price_changes_on: earlyNow ? early : null,
    status: closed ? 'closed' : 'open', signup_url: url ?? `https://reclub.co/c/${c.id}`, source_url: url ?? `https://reclub.co/c/${c.id}`,
  });
}

/** Read the sitemap, then each competition page. */
export async function read({ get, now, regions, options = {} }) {
  const res = await get(SITEMAP);
  if (!res.ok) throw new Error(`${SITEMAP}: HTTP ${res.status}`);
  const urls = competitionUrls(res.text);
  if (!urls.length) throw new Error(`${SITEMAP}: no competitions listed`);
  const out = [];
  let read = 0;
  for (const url of urls.slice(0, options.max ?? 120)) {
    const page = await get(url).catch(() => null);
    if (!page?.ok) continue;
    read++;
    const p = parseCompetition(competitionOf(page.text), { url, now, regions, state: options.state ?? 'TX' });
    if (p) out.push(p);
  }
  if (!read) throw new Error('Reclub: no competition page could be read');
  return out;
}
