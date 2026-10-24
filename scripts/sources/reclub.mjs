// Public Reclub meets from Austin volleyball clubs. A meet held on a court that also shows as
// booked on a Skedda calendar is a privately booked court that's open to sign-ups.
import { resolveMonthDay, to24, toHHMM, toMin } from '../../lib/time.js';

export const id = 'reclub';
export const CLUBS = [
  'https://reclub.co/clubs/@vex_volleyball',
  'https://reclub.co/clubs/@austin-lawn-club',
];
// Venue text on Reclub -> how we show it, and which Skedda facility (if any) it lives in.
const VENUES = [
  { match: /Treehouse Gym/i, venue: 'Roots · Treehouse Gym', city: 'N. Austin', surface: 'indoor', facility: 'treehouse' },
  { match: /Volleyworld/i, venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville', surface: 'indoor' },
  { match: /Crossover/i, venue: 'The Crossover', city: 'Cedar Park', surface: 'indoor', facility: 'crossover' },
  { match: /High ?Point/i, venue: 'High Point Center', city: 'Leander', surface: 'indoor', facility: 'highpoint' },
  { match: /ATX Beach/i, venue: 'ATX Beach', city: 'North Austin', surface: 'sand' },
  { match: /Park/i, venue: null, city: 'Austin', surface: 'grass' }, // lawn games in city parks
];

/** Parse one meet page's text. */
export function parseMeet(text, url, ref) {
  const t = text.replace(/\s+/g, ' ');
  const when = t.match(/(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, ([A-Z][a-z]{2}) (\d{1,2}) @ (\d{1,2}:\d{2} [AP]M)\s*(\d+(?:\.\d+)?) hours?/);
  if (!when) throw new Error(`${url}: no date/time found`);
  const title = t.match(/^(?:.*?English\s*)?(.+?) (?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, /)?.[1]?.trim() || 'Reclub meet';
  const afterHours = t.slice(t.indexOf(when[0]) + when[0].length);
  const place = afterHours.match(/^(?:\s*(?:Coed|Men's|Women's|Mixed))?\s*(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, [A-Z][a-z]{2} \d{1,2} @ \d{1,2}:\d{2} [AP]M\s*\d+(?:\.\d+)? hours?\s*)?(.+?)(\d{3,6} [^,]+, [^,]+, TX)/);
  const placeName = place?.[1]?.replace(/see map.*/i, '').trim() || '';
  const v = VENUES.find((x) => x.match.test(placeName)) || { venue: placeName, city: 'Austin', surface: 'indoor' };
  const price = t.match(/Per Player\s*\$(\d+(?:\.\d\d)?)/)?.[1];
  const level = title.match(/\b([A-D]{1,2}\/[A-D]{1,2})\b/)?.[1];
  const start = to24(when[3]);
  const date = resolveMonthDay(when[1], +when[2], ref);
  const club = t.match(/Brought to you by\s*(.+?)\s*Every /)?.[1];
  const weekly = t.match(/Every (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/)?.[1];
  return {
    id: `reclub-${url.split('/').pop()}`,
    date, start, end: toHHMM(Math.min(toMin(start) + Math.round(Number(when[4]) * 60), 1440)),
    title: title.replace(/^[^:]+:\s*/, ''), venue: v.venue || placeName, city: v.city, surface: v.surface,
    facility: v.facility, type: 'Open play',
    level: level ? `${level}${/men's/i.test(title) && !/women/i.test(title) ? ' · men' : ''}` : 'All levels',
    price: price ? `$${+price}` : null,
    note: [club && `Hosted by ${club}${weekly ? `, every ${weekly}` : ''}.`, v.facility && 'Runs on a privately booked court.'].filter(Boolean).join(' ') || null,
    signup: { url, label: 'Sign up on Reclub' },
    source: url,
  };
}

export async function scrape({ browser, ref }) {
  const page = await browser.newPage();
  const sessions = [], warnings = [];
  try {
    for (const club of CLUBS) {
      await page.goto(club, { waitUntil: 'networkidle', timeout: 45000 });
      const links = await page.$$eval('a[href*="/m/"]', (as) => [...new Set(as.map((a) => a.href))]);
      for (const url of links) {
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
          sessions.push(parseMeet(await page.locator('body').innerText(), url, ref));
        } catch (e) { warnings.push(e.message); }
      }
    }
  } finally { await page.close(); }
  if (!sessions.length) throw new Error(warnings.join('; ') || 'No Reclub meets found');
  return { sessions, warnings };
}
