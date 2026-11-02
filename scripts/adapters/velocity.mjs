// Austin Velocity adult open play at The Crossover. Seasonal: we read the posted season so the
// sessions switch on or off by themselves when Velocity updates its pages.
//
// The adult page has used two layouts:
//   - weekly nights: "Season Dates: May 20 – August 14, 2026", then "Wednesday Open Play /
//     Time: 8PM – Midnight / Level: ..." blocks (summer 2026);
//   - a season page linked from the adult page ("See Dates & Pricing"): "Sundays • 5PM–8PM",
//     "Season Dates: November 15, 2026 – January 17, 2027" and a "SESSION DATES" list with the
//     exact dates ("November 15 & 22 / December 6, 13, 20 & 27 / January 3 & 17"), since some
//     Sundays in the range are skipped (fall/winter 2026-27).
import { resolveMonthDay, dowName, to24 } from '../../lib/time.js';
import { contentHash } from '../../lib/health.js';

export const id = 'velocity';
export const needsBrowser = true;
const URL_ = 'https://www.austinvelocity.com/rentals/adult-volleyball-2';
const INSTAGRAM = 'https://www.instagram.com/austinvelocityadults/';

const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\.?';
const SEASON = new RegExp(`Season Dates:\\s*${MONTH}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?\\s*[–—-]\\s*${MONTH}\\s+(\\d{1,2}),?\\s*(\\d{4})?`, 'i');
const DAY_NAMES = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
// "Sundays • 5PM–8PM" / "Sundays, 5:00–8:00PM"
const WEEKLY_TIME = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*days?\s*[•,·]\s*(\d{1,2}(?::\d{2})?)\s*([AP]M)?\s*[–—-]\s*(\d{1,2}(?::\d{2})?)\s*([AP]M)/i;

/** "5" + "PM" -> "17:00"; a start without AM/PM borrows the end's. */
const clock = (t, ampm) => to24(`${t.includes(':') ? t : `${t}:00`} ${ampm}`);

/** { from, until } from "Season Dates: ...", the first date's year taken from the end's when it has none. */
function season(text, ref) {
  const m = text.match(SEASON);
  if (!m) return null;
  const endYear = m[6] || ref.slice(0, 4);
  const startYear = m[3] || endYear;
  const from = resolveMonthDay(m[1], +m[2], `${startYear}-01-01`);
  const until = resolveMonthDay(m[4], +m[5], from);
  return from && until ? { from, until } : null;
}

/** The dates listed under "SESSION DATES", inside the season: "December 6, 13, 20 & 27" -> four dates. */
function listedDates(text, { from, until }) {
  const at = text.search(/SESSION DATES/i);
  if (at < 0) return [];
  const dates = [];
  for (const line of text.slice(at).split('\n').slice(1)) {
    const m = line.trim().match(new RegExp(`^${MONTH}\\s+([\\d,&\\s]+(?:and\\s+\\d+)?)$`, 'i'));
    if (!m) { if (dates.length) break; continue; }
    for (const d of m[2].match(/\d{1,2}/g)) {
      const iso = resolveMonthDay(m[1], +d, from);
      if (iso && iso >= from && iso <= until) dates.push(iso);
    }
  }
  return [...new Set(dates)].sort();
}

function price(text) {
  const online = text.match(/\$\s*(\d+(?:\.\d{2})?)\s+reserved online/i)?.[1];
  const door = text.match(/\$\s*(\d+(?:\.\d{2})?)\s+at the door/i)?.[1];
  return [online && `$${+online} online`, door && `$${+door} door`].filter(Boolean).join(' · ') || null;
}

/** The season page's sessions: one per listed date (or weekly across the season when no list is posted). */
function parseSeasonPage(text, ref, url) {
  const window = season(text, ref);
  const t = text.match(WEEKLY_TIME);
  if (!window || !t) return null;
  const day = DAY_NAMES[t[1].slice(0, 3).toLowerCase()];
  const start = clock(t[2], t[3] || t[5]);
  const end = clock(t[4], t[5]);
  if (!start || !end) return null;
  const base = {
    start, end, title: 'Austin Velocity Adult Open Gym', venue: 'The Crossover', city: 'Cedar Park', surface: 'indoor',
    type: 'Open play', level: 'Ages 17+ · competitive, self-called', price: price(text),
    capacity: Number(text.match(/capped at (\d+) players/i)?.[1]) || undefined,
    note: 'Season pass or drop in. Updates post on Instagram @austinvelocityadults.',
    signup: { url, label: 'Book on Austin Velocity' }, source: url,
  };
  const dates = listedDates(text, window).filter((d) => dowName(d) === day);
  if (dates.length) return dates.map((date) => ({ ...base, id: `velocity-${date}`, date }));
  return [{ ...base, id: `velocity-${day.toLowerCase()}`, days: [day], startsOn: window.from, validUntil: window.until }];
}

/** The older layout: one weekly session per "<Day> Open Play" block inside the season. */
function parseNights(text, ref) {
  const window = season(text, ref);
  if (!window) return null;
  const nights = [];
  const block = (day) => text.match(new RegExp(`${day} Open Play[\\s\\S]{0,200}?Time:\\s*(\\d{1,2})\\s*PM\\s*[–-]\\s*(Midnight|\\d{1,2}\\s*PM)[\\s\\S]{0,200}?Level:\\s*([^\\n]+)`, 'i'));
  for (const [day, short] of [['Sunday', 'Sun'], ['Monday', 'Mon'], ['Tuesday', 'Tue'], ['Wednesday', 'Wed'], ['Thursday', 'Thu'], ['Friday', 'Fri'], ['Saturday', 'Sat']]) {
    const b = block(day);
    if (!b) continue;
    const end = /midnight/i.test(b[2]) ? '24:00' : `${String((+b[2].match(/\d+/)[0] % 12) + 12).padStart(2, '0')}:00`;
    nights.push({
      id: `velocity-${short.toLowerCase()}`, days: [short], start: `${String((+b[1] % 12) + 12).padStart(2, '0')}:00`, end,
      title: 'Austin Velocity Open Play', venue: 'The Crossover', city: 'Cedar Park', surface: 'indoor', type: 'Open play',
      level: b[3].trim(), startsOn: window.from, validUntil: window.until,
      note: 'Updates post on Instagram @austinvelocityadults.',
      signup: { url: INSTAGRAM, label: 'Check Instagram for signup' }, source: URL_,
    });
  }
  return nights.length ? nights : null;
}

/** Page text (the season page's when there is one, else the adult page's) -> sessions. */
export function parse(text, ref, url = URL_) {
  const sessions = parseNights(text, ref) ?? parseSeasonPage(text, ref, url);
  if (sessions) return sessions;
  if (!SEASON.test(text)) throw new Error('Season dates not found on Velocity adult page');
  throw new Error('No open-play nights found on Velocity adult page');
}

/** The lines this adapter depends on (season, days, times, dates, prices), for lib/health.js. */
export const watchedText = (text) => String(text).split('\n')
  .filter((l) => new RegExp(`season|open (play|gym)|time\\s*:|level\\s*:|\\$\\s*\\d|sign.?up|instagram|days?\\s*[•,]|^${MONTH}\\s+\\d`, 'i').test(l.trim())).join('\n');

export async function scrape({ browser, ref }) {
  const page = await browser.newPage();
  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 });
    let text = await page.locator('body').innerText();
    let url = URL_;
    // The current season has its own page ("See Dates & Pricing"); read that when it's linked.
    if (!parseNights(text, ref)) {
      const href = await page.locator('a', { hasText: /dates/i }).first().getAttribute('href').catch(() => null);
      if (href) {
        url = new URL(href, URL_).href;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        text = await page.locator('body').innerText();
      }
    }
    return { sessions: parse(text, ref, url), contentHash: contentHash(watchedText(text)) };
  } finally { await page.close(); }
}

/** Hours from a page that only changes by hand; there's nothing faster to re-check. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
