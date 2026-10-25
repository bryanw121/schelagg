// Austin Velocity adult open play at The Crossover. Seasonal: we read the posted season dates
// so the sessions switch on or off by themselves when Velocity updates the page.
import { resolveMonthDay } from '../../lib/time.js';

export const id = 'velocity';
export const needsBrowser = true;
const URL_ = 'https://www.austinvelocity.com/rentals/adult-volleyball-2';

export function parse(text, ref) {
  const m = text.match(/Season Dates:\s*([A-Z][a-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})?/);
  if (!m) throw new Error('Season dates not found on Velocity adult page');
  const year = m[5] || ref.slice(0, 4);
  const from = resolveMonthDay(m[1], +m[2], `${year}-01-01`);
  const until = resolveMonthDay(m[3], +m[4], from);
  const nights = [];
  const block = (day) => text.match(new RegExp(`${day} Open Play[\\s\\S]{0,200}?Time:\\s*(\\d{1,2})\\s*PM\\s*[–-]\\s*(Midnight|\\d{1,2}\\s*PM)[\\s\\S]{0,200}?Level:\\s*([^\\n]+)`, 'i'));
  for (const [day, short] of [['Wednesday', 'Wed'], ['Friday', 'Fri']]) {
    const b = block(day);
    if (!b) continue;
    const end = /midnight/i.test(b[2]) ? '24:00' : `${String((+b[2].match(/\d+/)[0] % 12) + 12).padStart(2, '0')}:00`;
    nights.push({
      id: `velocity-${short.toLowerCase()}`, days: [short], start: `${String((+b[1] % 12) + 12).padStart(2, '0')}:00`, end,
      title: 'Austin Velocity Open Play', venue: 'The Crossover', city: 'Cedar Park', surface: 'indoor', type: 'Open play',
      level: b[3].trim(), startsOn: from, validUntil: until,
      note: 'Updates post on Instagram @austinvelocityadults.',
      signup: { url: 'https://www.instagram.com/austinvelocityadults/', label: 'Check Instagram for signup' }, source: URL_,
    });
  }
  if (!nights.length) throw new Error('No open-play nights found on Velocity adult page');
  return nights;
}

export async function scrape({ browser, ref }) {
  const page = await browser.newPage();
  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return { sessions: parse(await page.locator('body').innerText(), ref) };
  } finally { await page.close(); }
}

/** Weekly hours from a page that only changes by hand; there's nothing faster to re-check. */
export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
