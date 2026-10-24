// Volleyworld's public class calendar (Arketa). The data streams in over a websocket,
// so we render it in a headless browser and read the page text.
import { resolveMonthDay, to24, toHHMM, toMin } from '../../lib/time.js';

export const id = 'volleyworld';
const URL_ = 'https://app.arketa.co/iframe/volleyworld/schedule';
const ADULT = /adult|open gym|women'?s? only/i;
const DAY = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), ([A-Z][a-z]{2}) (\d{1,2})$/;
const TIME = /^(\d{1,2}:\d{2} [AP]M) [A-Z]{2,4} • \((\d+) min\)$/;

export function parse(text, ref) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  let date = null;
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(DAY);
    if (d) { date = resolveMonthDay(d[2], +d[3], ref); continue; }
    const t = lines[i].match(TIME);
    if (!t || !date) continue;
    const title = lines[i + 1] || '';
    const coach = lines[i + 2] || '';
    const where = lines[i + 3] || '';
    let status = '';
    for (let j = i + 4; j < Math.min(i + 8, lines.length) && !TIME.test(lines[j]) && !DAY.test(lines[j]); j++) {
      if (/^(Canceled|Cancelled|Sign Up|Not Available|Waitlist|Full)$/i.test(lines[j])) { status = lines[j]; break; }
    }
    if (!ADULT.test(title) || /homeschool/i.test(title)) continue;
    const city = /Georgetown/i.test(where) ? 'Georgetown' : 'Pflugerville';
    const start = to24(t[1]);
    out.push({
      id: `volleyworld-${date}-${start}-${city}`.toLowerCase(),
      date, start, end: toHHMM(Math.min(toMin(start) + Number(t[2]), 1440)),
      title, venue: `Volleyworld (${city})`, city, surface: 'indoor',
      type: /open gym/i.test(title) ? 'Open gym' : 'Training',
      level: coach && coach !== 'No Coach' ? `Adults · ${coach}` : 'Adults',
      canceled: /cancel/i.test(status) || undefined,
      full: /not available|full/i.test(status) || undefined,
      signup: { url: URL_, label: 'Book on Volleyworld' },
      source: URL_,
    });
  }
  return out;
}

export async function scrape({ browser, ref }) {
  const page = await browser.newPage();
  try {
    await page.goto(URL_, { waitUntil: 'networkidle', timeout: 45000 });
    await page.getByText(/\d{1,2}:\d{2} [AP]M/).first().waitFor({ timeout: 30000 });
    let text = await expandAll(page);
    // Move to next week: the arrow sits just right of the "October 25 — October 31" label.
    const range = page.getByText(/^[A-Z][a-z]+ \d{1,2} — [A-Z][a-z]+ \d{1,2}$/).first();
    const box = await range.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width + 16, box.y + box.height / 2);
      await page.waitForTimeout(2500);
      text += '\n' + (await expandAll(page));
    }
    const sessions = dedupe(parse(text, ref));
    if (!sessions.length) throw new Error('No adult sessions found — page layout may have changed');
    return { sessions };
  } finally {
    await page.close();
  }
}

async function expandAll(page) {
  for (let i = 0; i < 6; i++) {
    const more = page.getByRole('button', { name: 'Show More' });
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click(); await page.waitForTimeout(1200);
  }
  return page.locator('body').innerText();
}
const dedupe = (list) => [...new Map(list.map((s) => [s.id, s])).values()];
