// ACES open-play pages. Each page lists the next date, the time range and prices.
// ACES blocks plain HTTP clients, so these load in the headless browser too.
import { resolveMonthDay, to24 } from '../../lib/time.js';

export const id = 'aces';
// Pages come from config/sources.json (options.pages: { url, venue, city }).

export function parse(text, page, ref) {
  const date = text.match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{1,2})\b/);
  const time = text.match(/Open Play Time:\s*([\d:]+\s*[AP]M)\s*[–-]\s*([\d:]+\s*[AP]M)/i);
  if (!date || !time) throw new Error(`${page.url}: couldn't find date or time`);
  const online = text.match(/Indoor Pricing \(individual\):\s*\$([\d.]+)/i)?.[1];
  const door = text.match(/Door Pricing\s*:\s*\$([\d.]+)/i)?.[1];
  const iso = resolveMonthDay(date[1], +date[2], ref);
  const start = to24(time[1]), end = to24(time[2]);
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
        sessions.push(parse(await page.locator('main, body').first().innerText(), p, ref));
      } catch (e) { errors.push(e.message); }
    }
  } finally { await page.close(); }
  if (!sessions.length) throw new Error(errors.join('; ') || 'nothing parsed');
  return { sessions, warnings: errors };
}
