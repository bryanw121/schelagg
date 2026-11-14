// Vex Volleyball (vexvolleyball.com, Austin): its league and tournaments, from its own Squarespace
// site (they aren't listed as Reclub competitions). Every page in the site menu is read; a page is
// an event when its first two headings are a title and a date ("Dec. 6-Foot and Under Tourney" /
// "12/5/2026"), or a league when its heading names a league and the page has a weekly schedule
// ("1/24 – Week 1"). From each we publish the dates, the early-bird and regular team fee, and the
// sign-up form, never the registered teams or free-agent lists. robots.txt allows these pages
// (it disallows /api/, /search and query views, and names AI crawlers we are not).
import { clean, dateIn, money, notAfter, program } from './common.js';

export const id = 'vex';
export const ORG = 'Vex Volleyball';
export const ORIGIN = 'https://vexvolleyball.com';
export const HOME = `${ORIGIN}/`;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && !Number.isNaN(Date.parse(iso(y, m, d)));

/** "12/5/2026", "September 12th, 2026", "July 11th, 2026" → YYYY-MM-DD, or null. */
export function eventDate(s) {
  const t = clean(s);
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m && valid(+m[3], +m[1], +m[2])) return iso(+m[3], +m[1], +m[2]);
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  const mo = m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1 : 0;
  return mo && valid(+m[3], mo, +m[2]) ? iso(+m[3], mo, +m[2]) : null;
}

/** "M/D" or "M/D/YYYY" (in the year of `near` when it has none), or null. */
function shortDate(s, near) {
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (!m) return null;
  const y = m[3] ? +m[3] : +near.slice(0, 4);
  return valid(y, +m[1], +m[2]) ? iso(y, +m[1], +m[2]) : null;
}

const mainOf = (html) => String(html).match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? String(html);
const headings = (main) => [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1])).filter(Boolean);
const textOf = (main) => clean(main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
const formLink = (main) => main.match(/https:\/\/(?:docs\.google\.com\/forms\/[^"'\s<]+|forms\.gle\/[A-Za-z0-9]+)/)?.[0]?.replace(/&amp;/g, '&') ?? null;

/** Internal pages linked from the site (the menu), as absolute URLs, in order. */
export function sitePages(html) {
  const out = [];
  for (const m of String(html).matchAll(/href="(\/[a-z0-9-]+)"/g)) {
    if (/^\/(cart|faqs|events|open-gyms-training|make-an-impact|account|search|config|api)\b/.test(m[1])) continue;
    const u = ORIGIN + m[1];
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** The program a page describes, or null (not an event page, or already over). */
export function parseVexPage(html, { url, now = Date.now(), tz = 'America/Chicago', region = 'austin' } = {}) {
  const main = mainOf(html);
  const [title, second] = headings(main);
  if (!title) return null;
  const text = textOf(main);
  const today = dateIn(now, tz);
  const signup = formLink(main);
  const base = { sport: 'volleyball', surface: 'indoor', region, state: 'TX', org: ORG, source_id: id, city: 'Austin', source_url: url };

  // A league: "Vex Volleyball 2027 Winter League", fees "$480 / $600", weeks "1/24 – Week 1" … "3/7 – Playoff Week".
  if (/\bleague\b/i.test(title)) {
    const year = title.match(/\b(20\d\d)\b/)?.[1];
    const weeks = [...text.matchAll(/(\d{1,2}\/\d{1,2})\s*[–-]\s*(?:Week \d+|Bye Week|Playoff)/gi)].map((m) => m[1]);
    if (!year || !weeks.length) return null;
    // Weeks run into the new year from a season named for it ("2027 Winter" starting in late January).
    const days = weeks.map((w) => shortDate(w, year));
    for (let i = 1; i < days.length; i++) if (days[i] < days[i - 1]) days[i] = `${+days[i].slice(0, 4) + 1}${days[i].slice(4)}`;
    const starts_on = days[0], ends_on = days[days.length - 1];
    if (!starts_on || ends_on < today) return null;
    const fees = text.match(/Fee:\s*\$(\d+)\s*\/\s*\$(\d+)/i);
    const weekday = text.match(/Schedule:\s*(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i)?.[1];
    return program({
      ...base, id: `vex-league-${starts_on}`, kind: 'league', title: title.replace(/^Vex Volleyball\s+/i, 'Vex '),
      weekdays: weekday ? [weekday[0].toUpperCase() + weekday.slice(1).toLowerCase()] : [],
      format: /2 matches per night/i.test(text) ? '2 matches a night · 5 weeks + playoffs' : null,
      starts_on, ends_on,
      team_price: money(fees ? +fees[1] : null), price_note: fees ? `Early bird; regular $${fees[2]}` : null,
      status: 'open', signup_url: signup ?? url,
    });
  }

  // A tournament: title then date, "Early Bird: $360 per team (ends on 11/14/2026) Regular: $420 per team".
  const day = eventDate(second ?? '');
  if (!day || !/tourn|tourney|division/i.test(title) || day < today) return null;
  const early = text.match(/Early Bird:\s*\$(\d+)\s*per team\s*\(ends on\s*([\d/]+)\s*\)/i);
  const regular = text.match(/Regular:\s*\$(\d+)\s*per team/i)?.[1];
  const earlyEnds = early ? notAfter(shortDate(early[2], day), day) : null;
  const earlyNow = Boolean(earlyEnds && today <= earlyEnds);
  const level = title.match(/\(([A-C]{1,2}(?:\+|\/[A-C]{1,2})?\+?)\)/)?.[1] ?? null;
  return program({
    ...base, id: `vex-${day}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`,
    kind: 'tournament', title: `Vex · ${title}`, level,
    format: /\$75 (?:team |refundable )?(?:reffing )?deposit|reffing deposit/i.test(text) ? 'Teams ref; $75 refundable deposit' : null,
    starts_on: day, ends_on: day,
    team_price: money(earlyNow ? +early[1] : regular ? +regular : early ? +early[1] : null),
    price_note: earlyNow ? `Early bird; regular $${regular ?? '?'}` : null, price_changes_on: earlyNow ? earlyEnds : null,
    status: /\bsold out\b/i.test(text) ? 'full' : 'open', signup_url: signup ?? url,
  });
}

/** Read the home page for the menu, then every page in it. */
export async function read({ get, now, tz, regions }) {
  const home = await get(HOME);
  if (!home.ok) throw new Error(`${HOME}: HTTP ${home.status}`);
  const pages = sitePages(home.text);
  if (!pages.length) throw new Error(`${HOME}: no pages in the menu`);
  const region = regions?.find((r) => r.id === 'austin')?.id ?? 'austin';
  const out = [];
  let failed = 0;
  for (const url of pages.slice(0, 25)) {
    const r = await get(url, { timeoutMs: 20000 }).catch(() => null);
    if (!r?.ok) { failed++; continue; }
    const p = parseVexPage(r.text, { url, now, tz, region });
    if (p && !out.some((o) => o.id === p.id)) out.push(p);
  }
  if (failed > Math.max(2, pages.length * 0.3)) throw new Error(`Vex: ${failed} of ${pages.length} pages couldn't be read`);
  return out;
}
