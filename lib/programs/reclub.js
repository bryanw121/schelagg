// Reclub competitions (leagues and tournaments run on reclub.co). Two places list them: the
// Texas volleyball clubs we follow (`options.clubs`: each club page carries how many competitions
// the club has open, and links any it shows), and Reclub's sitemap, which lists only its ~100 newest
// competitions worldwide (mostly Asia), so it rarely reaches Texas. Competition pages (reclub.co/c/<id>) each page carries the competition's record in its Nuxt
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

/** A club page's competition count and the competition pages it links. */
export function clubCompetitions(html) {
  let club = null;
  try {
    const data = nuxtData(html)?.data ?? {};
    for (const [k, v] of Object.entries(data)) if (k.startsWith('club-') && v?.club) { club = v.club; break; }
  } catch { /* not a club page */ }
  const links = [...new Set([...String(html).matchAll(/\/c\/([0-9a-f-]{36})\b/g)].map((m) => `https://reclub.co/c/${m[1]}`))];
  const active = Number(club?.counts?.activeCompetitions);
  return { name: club?.name ?? null, active: Number.isFinite(active) ? active : null, links };
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

/**
 * Read the followed clubs, then the sitemap, then each competition page found (club links first).
 * A club that says it has open competitions we found no link for is logged, so a gap shows up.
 */
export async function read({ get, now, regions, options = {}, log = console.log }) {
  const fromClubs = [];
  let clubsRead = 0;
  for (const club of options.clubs ?? []) {
    const page = await get(club, { timeoutMs: 15000 }).catch(() => null);
    if (!page?.ok) continue;
    clubsRead++;
    const c = clubCompetitions(page.text);
    fromClubs.push(...c.links);
    if (c.active > c.links.length) log(`Reclub: ${c.name ?? club} has ${c.active} open competition(s), ${c.links.length} linked on its page`);
  }
  const res = await get(SITEMAP).catch((e) => ({ ok: false, status: e.message }));
  if (!res.ok && !clubsRead) throw new Error(`${SITEMAP}: HTTP ${res.status}`);
  const fromSitemap = res.ok ? competitionUrls(res.text).slice(0, options.max ?? 120) : [];
  if (!fromSitemap.length && !clubsRead) throw new Error(`${SITEMAP}: no competitions listed`);
  const out = [];
  let read = 0, failed = 0;
  const deadline = Date.now() + (options.budgetMs ?? 4 * 60e3);
  const list = [...new Set([...fromClubs, ...fromSitemap])];
  for (const url of list) {
    if (Date.now() > deadline) throw new Error(`Reclub: out of time after ${read + failed} of ${list.length} pages`);
    const page = await get(url, { timeoutMs: 15000 }).catch(() => null);
    if (!page?.ok) { failed++; continue; }
    read++;
    const p = parseCompetition(competitionOf(page.text), { url, now, regions, state: options.state ?? 'TX' });
    if (p) out.push(p);
  }
  // A run that couldn't read many pages keeps the last good rows instead of replacing them.
  if (failed > Math.max(2, list.length * 0.2)) throw new Error(`Reclub: ${failed} of ${list.length} competition pages couldn't be read`);
  return out;
}
