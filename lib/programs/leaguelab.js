// LeagueLab league listings (Austin Sports & Social Club, Meanwhile Brewing…): one public page per
// organizer lists every upcoming league, each in a `.league-listing` block with data attributes
// (id, name, sport, days, league type), its location, "Starts:" and "Deadline:" lines (no year),
// per-division team / individual options with a status and cost, and the dates it plays.
import { clean, dateIn, monthDay, moneyRange, notAfter, program, surfaceOf, upcomingDate } from './common.js';

export const id = 'leaguelab';

const attr = (block, name) => clean(block.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '');
const STATUS = { open: 'open', waitlist: 'waitlist', 'wait list': 'waitlist', full: 'full', closed: 'closed' };

/** Each listing's HTML. */
export function listingBlocks(html) {
  const parts = String(html).split(/<div class="league-listing\b/).slice(1);
  return parts.map((p) => `<div class="league-listing${p}`);
}

/** Dollar amounts in a snippet ("$689.00 Total", "$239 ($279 after 11/13)"). */
const amounts = (s) => [...String(s).matchAll(/\$([\d,]+(?:\.\d\d)?)/g)].map((m) => +m[1].replace(/,/g, ''));

/**
 * One listing as a program. `site` is the organizer's LeagueLab origin, `org` its name, `today`
 * (YYYY-MM-DD) anchors the year-less dates.
 */
export function parseListing(block, { site, org, today, regionId = null, state = null, sports = ['Volleyball', 'Pickleball'] }) {
  const leagueId = attr(block, 'data-leagueid');
  const name = attr(block, 'data-leaguename');
  const sportText = attr(block, 'data-sport');
  const sport = /pickleball/i.test(sportText) ? 'pickleball' : /volleyball/i.test(sportText) ? 'volleyball' : null;
  if (!leagueId || !name || !sport || !sports.some((s) => sportText.toLowerCase().includes(s.toLowerCase()))) return null;
  const type = attr(block, 'data-league-type');
  const kind = /tourn/i.test(type) ? 'tournament' : 'league';
  const venue = clean(block.match(/class="locations"[\s\S]*?<a href="\/location\/\d+">([\s\S]*?)<\/a>/)?.[1] ?? '') || null;
  const starts = monthDay(block.match(/Starts:\s*(?:[A-Za-z]+,\s*)?([A-Za-z]+\s+\d{1,2})/)?.[1]);
  const deadline = monthDay(block.match(/Deadline:\s*(?:[A-Za-z]+,\s*)?([A-Za-z]+\s+\d{1,2})/)?.[1]);
  const startsOn = starts ? upcomingDate(...starts, today) : null;
  // "Dates: 11.22, 12.6, … 1.31": the last one is the season's end, in the year after the start when it wraps.
  const dates = [...(block.match(/<strong>Dates:<\/strong>([^<]*)/)?.[1] ?? '').matchAll(/(\d{1,2})\.(\d{1,2})/g)].map((m) => [+m[1], +m[2]]);
  let endsOn = null;
  if (startsOn && dates.length) {
    let year = +startsOn.slice(0, 4), prevMonth = +startsOn.slice(5, 7);
    for (const [mo, d] of dates) { if (mo < prevMonth) year++; prevMonth = mo; endsOn = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  }
  // Per division: each registration option's status and cost.
  const divisions = [];
  const team = [], indiv = [], statuses = [];
  for (const d of block.split(/<li class="division-option/).slice(1)) {
    const dname = clean(d.match(/<h4>([\s\S]*?)<\/h4>/)?.[1] ?? '');
    if (dname) divisions.push({ name: dname });
    for (const opt of d.split(/<li class="(?=[A-Za-z ]*(?:team|individual)")/).slice(1)) {
      const isTeam = /^[A-Za-z ]*team"/.test(opt);
      const status = clean(opt.match(/class="status [^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '').toLowerCase();
      if (status) statuses.push(STATUS[status] ?? null);
      // A team's price is its total (after the deposit); an individual's is its cost.
      // (…and its later price, "($759.00 after 11/13)", when there's an early bird.)
      const total = [...amounts(opt.match(/\$[\d,.]+[^<]*Total/i)?.[0] ?? ''), ...amounts((opt.match(/\$[\d,.]+\s*after/gi) ?? []).join(' '))];
      const cost = amounts(opt.match(/class="cost-item"[\s\S]*?<\/li>/)?.[0] ?? '');
      (isTeam ? team : indiv).push(...(isTeam && total.length ? total : isTeam ? cost.filter((n) => !/Deposit/.test(opt)) : cost));
    }
  }
  // Early-bird pricing ("$239 ($279 after 11/13)"): when the price goes up.
  // The year comes from the start: neither the deadline nor the early-bird cutoff is after it.
  const after = block.match(/after\s+(\d{1,2})\/(\d{1,2})/i);
  const cutoff = after ? notAfter(upcomingDate(+after[1], +after[2], today), startsOn) : null;
  const changes = cutoff && cutoff >= today ? cutoff : null; // past the cutoff: the higher price applies
  const higher = cutoff && !changes;
  const status = statuses.includes('open') ? 'open' : statuses.includes('waitlist') ? 'waitlist' : statuses.includes('full') ? 'full' : statuses.length ? 'closed' : null;
  return program({
    id: `leaguelab-${new URL(site).hostname.split('.')[0]}-${leagueId}`, kind, sport,
    surface: sport === 'volleyball' ? surfaceOf(sportText, name) : null,
    region: regionId, state, org, source_id: id, title: name,
    venue, format: clean(block.match(/class="sport">[\s\S]*?<\/a><br\/>([\s\S]*?)<\/div>/)?.[1] ?? '').replace(/\s*-\s*/g, ' · ') || null,
    divisions, starts_on: startsOn, ends_on: endsOn ?? startsOn,
    weekdays: attr(block, 'data-days').split(/,\s*/).filter(Boolean),
    registration_deadline: deadline ? notAfter(upcomingDate(...deadline, today), startsOn) : null,
    // Only the lowest of a "($279 after …)" pair is today's price.
    team_price: moneyRange(changes ? [Math.min(...team)] : higher ? [Math.max(...team)] : team),
    individual_price: moneyRange(changes ? [Math.min(...indiv)] : higher ? [Math.max(...indiv)] : indiv),
    price_note: changes ? 'Early bird' : null, price_changes_on: changes,
    status, signup_url: `${site}/league/${leagueId}/details`, source_url: `${site}/league/${leagueId}/details`,
  });
}

/** Every listing on an organizer's page. */
export function parseLeagueLab(html, { site, org, now = Date.now(), tz = 'America/Chicago', regionId = null, state = null, sports }) {
  const today = dateIn(now, tz);
  return listingBlocks(html).map((b) => parseListing(b, { site, org, today, regionId, state, sports })).filter(Boolean);
}

/** Read each organizer in `sites` ([{ url, org, region, state, sports }]). */
export async function read({ get, now, tz, options }) {
  const out = [];
  for (const s of options.sites) {
    const res = await get(s.url);
    if (!res.ok) throw new Error(`${s.url}: HTTP ${res.status}`);
    const found = parseLeagueLab(res.text, { site: new URL(s.url).origin, org: s.org, now, tz, regionId: s.region, state: s.state, sports: s.sports });
    if (!listingBlocks(res.text).length) throw new Error(`${s.url}: no league listings on the page`);
    out.push(...found);
  }
  return out;
}
