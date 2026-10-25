// ACES open-play pages. Each page lists the next date, the time range and prices.
// ACES blocks plain HTTP clients (and its WP REST API 403s from GitHub's IPs), so these
// load in the headless browser. The text varies ("Time:" / "Time :", "10 PM" / "10:00 PM"),
// so the patterns below are deliberately loose.
import { resolveMonthDay, to24 } from '../../lib/time.js';

export const id = 'aces';
export const needsBrowser = true;
// Pages come from config/sources.json (options.pages: { url, venue, city }).

const MONTH = '(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\\.?';
const CLOCK = '(\\d{1,2}(?::\\d{2})?)\\s*([AP]\\.?\\s*M\\.?)?';
// Prefer the labelled start date; fall back to the first "MONTH day" on the page (the page heading).
const START_DATE = new RegExp(`Open\\s*Play\\s*Start\\s*:?\\s*(?:[A-Z]+day,?\\s*)?${MONTH}\\s+(\\d{1,2})\\b`, 'i');
const ANY_DATE = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
const TIME = new RegExp(`Open\\s*Play\\s*Time\\s*:?\\s*${CLOCK}\\s*(?:[\\u2013\\u2014-]|to)\\s*${CLOCK}`, 'i');
const money = (label) => new RegExp(`${label}\\s*:?\\s*\\$\\s*(\\d+(?:\\.\\d{1,2})?)`, 'i');

/** "7:30" + "PM" -> "19:30"; a start without AM/PM borrows the end's ("7:30 - 10 PM"). */
const clock = (t, ampm, fallback) => to24(`${t} ${(ampm || fallback || '').replace(/[\s.]/g, '')}`);

export function parse(text, page, ref) {
  const t = String(text).replace(/[   ]/g, ' ');
  const date = t.match(START_DATE) ?? t.match(ANY_DATE);
  const time = t.match(TIME);
  if (!date || !time) throw new Error(`${page.url}: couldn't find date or time`);
  const end = clock(time[3], time[4]);
  const start = clock(time[1], time[2], time[4]);
  const iso = resolveMonthDay(date[1], +date[2], ref);
  if (!start || !end || !iso) throw new Error(`${page.url}: couldn't read "${time[0]}" / "${date[0]}"`);
  const online = t.match(money('Indoor\\s*Pricing\\s*\\(\\s*individual\\s*\\)'))?.[1];
  const door = t.match(money('Door\\s*Pricing'))?.[1];
  return {
    id: `aces-${iso}-${start}`,
    date: iso, start, end,
    title: 'ACES Indoor Open Play', venue: page.venue, city: page.city, surface: 'indoor', type: 'Open play',
    level: 'All levels, 18+',
    price: [online && `$${+online} online`, door && `$${+door} door`].filter(Boolean).join(' · ') || null,
    note: '1 court (more if signups allow). Winner stays on, games to 21.',
    signup: { url: page.url, label: 'Register on ACES' },
    source: page.url,
  };
}

export async function scrape({ browser, ref, options }) {
  const pages = options?.pages ?? [];
  if (!pages.length) throw new Error('aces: no pages configured');
  const page = await browser.newPage();
  const sessions = [], errors = [];
  try {
    for (const p of pages) {
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const text = await page.locator('main, body').first().innerText();
        try { sessions.push(parse(text, p, ref)); } catch (e) {
          // Say what we got instead (a bot-check page reads very differently from an event page).
          const title = await page.title().catch(() => '');
          throw new Error(`${e.message} (page "${title.slice(0, 80)}", ${text.length} chars: "${text.replace(/\s+/g, ' ').slice(0, 120)}")`);
        }
      } catch (e) { errors.push(e.message); }
    }
  } finally { await page.close(); }
  if (!sessions.length) throw new Error(errors.join('; ') || 'nothing parsed');
  return { sessions, warnings: errors };
}

/** No fast source for ACES (its API is blocked from servers), so a live check can't confirm a session. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
