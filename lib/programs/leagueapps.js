// LeagueApps club sites (e.g. Volleyball Austin, volleyballaustin.leagueapps.com): the leagues and
// tournaments on the site's own listing pages (/leagues, /tournaments). Each program is one
// <li id="baseevent-N"> with its title link, "Starts" / "Ends" ("Jan 5 ’27"), registration date
// ranges ("Sep 28 ’26 – Oct 31 ’26 regular", "… late"), location, game nights, format and the
// regular / late fees. robots.txt allows every page. Rosters and team pages are never read.
//
//   options.sites: [{ url, kind: 'league' | 'tournament', org, region, state, city }]
import { clean, dateIn, money, program } from './common.js';

export const id = 'leagueapps';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

const text = (s) => clean(String(s ?? '').replace(/&rsquo;|&#8217;/g, '’').replace(/&ndash;|&#8211;/g, '–'));

/** "Jan 5 ’27" → "2027-01-05", or null. */
export function laDate(s) {
  const m = text(s).match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*[’']\s*(\d{2})\b/);
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  if (!mo) return null;
  const iso = `20${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** The text of the <dd> after the <dt> named `label` in one program block. */
const field = (block, label) => block.match(new RegExp(`<dt[^>]*>\\s*${label}:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i'))?.[1] ?? null;

/** Fee lists in a block: { 'Free Agent Fees': { regular, late }, 'Team Fees': … } in dollars. */
function fees(block) {
  const out = {};
  for (const m of block.matchAll(/<dl[^>]*>\s*<dt>([^<]*Fees?)<\/dt>([\s\S]*?)<\/dl>/gi)) {
    const f = {};
    for (const d of m[2].matchAll(/<dd class="(regular|late|early)-price">[\s\S]*?\$([\d,.]+)/gi)) f[d[1].toLowerCase()] ??= +d[2].replace(/,/g, '');
    out[clean(m[1])] = f;
  }
  return out;
}

/** One listing page → programs not yet over. */
export function parseListing(html, site, { now = Date.now(), tz = 'America/Chicago' } = {}) {
  const today = dateIn(now, tz);
  const origin = new URL(site.url).origin;
  const out = [];
  const blocks = String(html).split(/<li id="baseevent-/).slice(1);
  for (const raw of blocks) {
    const num = raw.match(/^(\d+)/)?.[1];
    const link = raw.match(/<h2>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!num || !link) continue;
    const title = clean(link[2]);
    const starts_on = laDate(field(raw, 'Starts') ?? '');
    const ends_on = laDate(field(raw, 'Ends') ?? '') ?? starts_on;
    if (!starts_on || ends_on < today) continue;
    const sport = text(raw.match(/<\/h2>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? '');
    if (!/volleyball/i.test(`${sport} ${title}`)) continue;
    // Registration windows: "Sep 28 ’26 – Oct 31 ’26 regular", "Nov 1 ’26 – Dec 5 ’26 late".
    const windows = [...text(field(raw, 'Registration Dates') ?? '').matchAll(/([A-Za-z]{3}\s+\d{1,2}\s*’\s*\d{2})\s*–\s*([A-Za-z]{3}\s+\d{1,2}\s*’\s*\d{2})\s*(regular|late|early)?/gi)]
      .map((m) => ({ from: laDate(m[1]), to: laDate(m[2]), tag: (m[3] ?? 'regular').toLowerCase() })).filter((w) => w.from && w.to);
    const current = windows.find((w) => w.from <= today && today <= w.to);
    const opens = windows.length ? windows[0].from : null;
    const deadline = windows.length ? windows.at(-1).to : null;
    const status = !windows.length ? null : current ? 'open' : 'closed';
    const f = fees(raw);
    const solo = Object.entries(f).find(([k]) => /free agent|individual/i.test(k))?.[1] ?? {};
    const team = Object.entries(f).find(([k]) => /team/i.test(k))?.[1] ?? {};
    const tag = current?.tag ?? 'regular';
    const late = windows.find((w) => w.tag === 'late');
    const pick = (x) => x[tag] ?? x.regular ?? null;
    const lateNote = (x) => (current && tag !== 'late' && late && x.late ? `Late fee $${x.late} from ${late.from}` : null);
    const venue = text(field(raw, 'Location') ?? '') || null;
    const nights = [...(raw.match(/<span class="base-gamedays">([\s\S]*?)<\/span>/i)?.[1] ?? '').matchAll(/<strong>(\w{3})<\/strong>/g)].map((m) => DAYS[m[1]]).filter(Boolean);
    const time = text(raw.match(/<span class="base-gamedays">[\s\S]*?<\/span>\s*<em>([\s\S]*?)<\/em>/i)?.[1] ?? '');
    // The game nights are listed again after the format ("… Game Nights: FRIDAYS …"): keep the format only.
    const format = text(raw.match(/<p class="base-format">([\s\S]*?)<\/p>/i)?.[1] ?? '').replace(/\s*\bGame Nights?:.*$/i, '');
    const city = /round rock/i.test(venue ?? '') ? 'Round Rock' : /cedar park/i.test(venue ?? '') ? 'Cedar Park' : /pflugerville/i.test(venue ?? '') ? 'Pflugerville' : site.city ?? null;
    out.push(program({
      id: `${site.idPrefix ?? 'leagueapps'}-${num}`, kind: site.kind ?? (/\/tournaments\//.test(link[1]) ? 'tournament' : 'league'),
      sport: 'volleyball', surface: /sand|beach/i.test(sport) ? 'sand' : /indoor/i.test(sport) ? 'indoor' : null,
      region: site.region ?? null, state: site.state ?? null, org: site.org, source_id: id, title: site.titlePrefix && !title.toLowerCase().startsWith(site.titlePrefix.toLowerCase()) ? `${site.titlePrefix} · ${title}` : title,
      venue, city,
      format: [format, time && nights.length ? `${nights.join(' / ')} ${time}` : null].filter(Boolean).join(' · ').slice(0, 300) || null,
      level: /all skill levels/i.test(sport) ? 'All levels' : null,
      starts_on, ends_on, weekdays: nights,
      registration_opens: opens && opens > today ? opens : null, registration_deadline: deadline,
      team_price: money(pick(team)), individual_price: money(pick(solo)),
      price_note: [lateNote(solo), solo[tag] || team[tag] ? 'Plus a processing fee' : null].filter(Boolean).join('; ') || null,
      price_changes_on: current && tag !== 'late' && late && late.from > today && (solo.late || team.late) ? late.from : null,
      status, signup_url: new URL(link[1], origin).href, source_url: site.url,
    }));
  }
  return out;
}

export async function read({ get, now, tz, options }) {
  const sites = options?.sites ?? [];
  if (!sites.length) throw new Error('leagueapps: no sites configured');
  const out = [];
  let failed = 0;
  for (const site of sites) {
    const r = await get(site.url).catch(() => null);
    if (!r?.ok) { failed++; continue; }
    if (!/<li id="baseevent-|program-list|Nothing is open|No programs/i.test(r.text)) { failed++; continue; }
    for (const p of parseListing(r.text, site, { now, tz })) if (!out.some((o) => o.id === p.id)) out.push(p);
  }
  if (failed === sites.length) throw new Error(`leagueapps: none of ${sites.length} listing pages could be read`);
  return out;
}
