// The Sports Garden (Coppell): daily first-come sand open play on its North and South sides,
// read from its open-play page ("North Side Hours: Mon: 3 PM – Midnight ...", "South Side Hours
// (Mon–Fri only): 6 PM – Midnight", "$5 before 5 PM and $10 after"). Weekly sessions; when the
// hours text changes the sessions follow, and if it disappears the source fails (kept last good).
import { get } from '../../lib/http.js';
import { to24 } from '../../lib/time.js';
import { contentHash } from '../../lib/health.js';

export const id = 'sportsgarden';
export const needsBrowser = false;
export const PAGE = 'https://sportsgardendfw.com/open-play/';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ENT = { '#8212': '—', '#8211': '–', '#160': ' ', nbsp: ' ', amp: '&', mdash: '—', ndash: '–' };
const text = (html) => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? m).replace(/\s+/g, ' ');
const clock = (s) => (/midnight/i.test(s) ? '24:00' : to24(s.replace(/\s+/g, ' ').trim()));
const CLOCK = '(\\d{1,2}(?::\\d{2})?\\s*[AP]M|Midnight)';

export function parse(html, url = PAGE) {
  const t = text(html);
  const price = t.match(/\$(\d+)\s*before\s*(\d{1,2})\s*PM\s*and\s*\$(\d+)\s*after/i);
  const out = [];
  const add = (side, days, start, end) => {
    // Hours past midnight end at midnight here (the schedule's day ends at 24:00).
    const s = clock(start), e = clock(end);
    if (!s || !e) return;
    const endAt = e < s ? '24:00' : e;
    const key = `${side}-${s}-${endAt}`;
    const same = out.find((x) => x._key === key);
    if (same) { same.days.push(...days); return; }
    out.push({
      _key: key, id: `sportsgarden-${side.toLowerCase()}-${s.replace(':', '')}-${endAt.replace(':', '')}`, days: [...days], start: s, end: endAt,
      title: `Sand open play (${side} Side)`, venue: 'The Sports Garden', city: 'Coppell', surface: 'sand', type: 'Open play',
      level: 'All levels', price: price ? `$${price[1]} before ${price[2]} PM · $${price[3]} after` : null,
      note: 'First come, first served; courts not guaranteed. Check the court calendar before you go.',
      signup: { url, label: 'Drop in · court calendar', dropIn: true }, source: url,
    });
  };
  const north = t.match(/North Side Hours:\s*(.+?)(?:South Side Hours|Court availability)/i)?.[1] ?? '';
  for (const m of north.matchAll(new RegExp(`\\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*:\\s*${CLOCK}\\s*[–—-]\\s*${CLOCK}`, 'gi'))) {
    add('North', [DAYS.find((d) => d.toLowerCase() === m[1].slice(0, 3).toLowerCase())], m[2], m[3]);
  }
  const south = t.match(new RegExp(`South Side Hours\\s*\\((Mon|Sun)[a-z]*\\s*[–—-]\\s*(Fri|Sat|Sun)[a-z]*\\s*only\\)\\s*:\\s*${CLOCK}\\s*[–—-]\\s*${CLOCK}`, 'i'));
  if (south) {
    const i = DAYS.findIndex((d) => d.toLowerCase() === south[1].slice(0, 3).toLowerCase());
    const j = DAYS.findIndex((d) => d.toLowerCase() === south[2].slice(0, 3).toLowerCase());
    add('South', DAYS.slice(i, j + 1), south[3], south[4]);
  }
  if (!out.length) throw new Error('Sports Garden open-play hours not found — page may have changed');
  return out.map(({ _key, ...s }) => s);
}

export const watchedText = (html) => (text(html).match(/Open Play is available[\s\S]*?Court availability/i)?.[0] ?? '');

export async function scrape({ fetch }) {
  const res = await get(PAGE, { fetch });
  if (!res.ok) throw new Error(`${PAGE}: HTTP ${res.status}`);
  return { sessions: parse(res.text), contentHash: contentHash(watchedText(res.text)) };
}

export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
