// ATX Beach open play, from its TeamUp membership page.
import { to24 } from '../../lib/time.js';
import { contentHash } from '../../lib/health.js';

export const id = 'atxbeach';
export const needsBrowser = true;
const URL_ = 'https://goteamup.com/w9142954/p/9142954-atx-beach/memberships/223927/';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const span = (a, b) => { const i = DAYS.findIndex((d) => a.startsWith(d)), j = DAYS.findIndex((d) => b.startsWith(d)); return i < 0 || j < 0 ? null : DAYS.slice(i, j + 1); };

export function parse(text) {
  const out = [];
  const std = text.match(/Standard Open Play is (\d{1,2}(?::\d{2})?\s*[AP]M)\s*-\s*(\d{1,2}(?::\d{2})?\s*[AP]M)\s+(\w+)\s+thru\s+(\w+)/i);
  if (std) out.push({
    id: 'atxbeach-standard', days: span(std[3], std[4]), start: to24(std[1]), end: to24(std[2]),
    title: 'Standard Open Play', venue: 'ATX Beach', city: 'North Austin', surface: 'sand', type: 'Open play',
    level: 'All levels', price: '$10 drop-in · membership available', note: 'Check in at the Turtle Shack. Waiver required.',
    signup: { url: URL_, label: 'Drop in · or get membership', dropIn: true }, source: URL_,
  });
  const fri = text.match(/\$(\d+)\s+Friday Night Open Play[^\n]*?(\d{1,2}(?::\d{2})?\s*[AP]M)\s*-\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
  if (fri) out.push({
    id: 'atxbeach-friday', days: ['Fri'], start: to24(fri[2]), end: to24(fri[3]),
    title: 'Friday Night Open Play & Pizza', venue: 'ATX Beach', city: 'North Austin', surface: 'sand', type: 'Open play',
    level: 'All levels', price: `$${fri[1]}`,
    signup: { url: URL_, label: 'Drop in · or get membership', dropIn: true }, source: URL_,
  });
  if (!out.length) throw new Error('ATX Beach open play text not found — page may have changed');
  return out;
}

/**
 * The lines this adapter depends on: open-play hours and prices. parse() hard-codes some
 * details (the drop-in price, the check-in note), so lib/health.js flags when these change.
 */
export const watchedText = (text) => String(text).split('\n').filter((l) => /open play|\$\s*\d|drop.?in|waiver|check.?in/i.test(l)).join('\n');

export async function scrape({ browser }) {
  const page = await browser.newPage();
  try {
    await page.goto(URL_, { waitUntil: 'networkidle', timeout: 45000 });
    const text = await page.locator('body').innerText();
    return { sessions: parse(text), contentHash: contentHash(watchedText(text)) };
  } finally { await page.close(); }
}

/** Weekly hours from a page that only changes by hand; there's nothing faster to re-check. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
