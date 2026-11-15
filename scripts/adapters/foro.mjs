// FORO Sports Club (North Dallas, 14719 Preston Rd): registered sand volleyball open play, from its
// open-play page ("Volleyball Limited Space, Subject to Availability $10 registered Weekdays (M-Th):
// 8:30am-12am Weekends (S,S) 10:00AM-8:00PM"). Weekly sessions; when the page's hours change the
// sessions follow, and if the volleyball hours disappear the source fails (kept last good).
// robots.txt allows the page (it only disallows lightbox views).
import { get } from '../../lib/http.js';
import { to24 } from '../../lib/time.js';
import { contentHash } from '../../lib/health.js';

export const id = 'foro';
export const needsBrowser = false;
export const PAGE = 'https://www.forosportsclub.com/fridayopenplay';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LETTER = { M: 'Mon', T: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri', S: null, Sa: 'Sat', Su: 'Sun' };
const ENT = { amp: '&', nbsp: ' ', '#39': "'", quot: '"' };
const text = (html) => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? m).replace(/\s+/g, ' ');
const clock = (s) => { const t = s.trim().toLowerCase(); return t === '12am' || t === '12:00am' ? '24:00' : to24(t.replace(/(\d)([ap]m)$/, '$1 $2')); };
const CLOCK = '(\\d{1,2}(?::\\d{2})?\\s*[ap]m)';

/** "(M-Th)" -> Mon–Thu; "(S,S)" (a weekend) -> Sat, Sun. */
function dayList(spec, weekend) {
  if (weekend) return ['Sat', 'Sun'];
  const m = spec.match(/^(M|Tu|T|W|Th|F)\s*-\s*(M|Tu|T|W|Th|F)$/);
  if (!m) return [];
  const a = DAYS.indexOf(LETTER[m[1]] ?? (m[1] === 'Tu' ? 'Tue' : null)), b = DAYS.indexOf(LETTER[m[2]] ?? (m[2] === 'Tu' ? 'Tue' : null));
  return a < 0 || b < 0 ? [] : DAYS.slice(a, b + 1);
}

export function parse(html, url = PAGE) {
  const t = text(html);
  const block = t.match(/Volleyball\s+Limited Space[\s\S]*?(?=Interested in|Get in touch|$)/i)?.[0] ?? '';
  const price = block.match(/\$(\d+)\s*registered/i)?.[1];
  const out = [];
  for (const m of block.matchAll(new RegExp(`(Weekdays|Weeknights|Weekends)\\s*\\(([^)]+)\\)\\s*:?\\s*${CLOCK}\\s*[-–—]\\s*${CLOCK}`, 'gi'))) {
    const days = dayList(m[2].replace(/\s+/g, ''), /weekend/i.test(m[1]));
    const start = clock(m[3]), end = clock(m[4]);
    if (!days.length || !start || !end) continue;
    out.push({
      id: `foro-${days[0].toLowerCase()}-${start.replace(':', '')}`, days, start, end: end < start ? '24:00' : end,
      title: 'Sand volleyball open play', venue: 'FORO Sports Club', city: 'Dallas', surface: 'sand', type: 'Open play',
      level: 'All levels', price: price ? `$${price}` : null,
      note: 'Register ahead; limited space, subject to availability.',
      signup: { url, label: 'Register on FORO' }, source: url,
    });
  }
  if (!out.length) throw new Error('FORO volleyball open-play hours not found — page may have changed');
  return out;
}

export const watchedText = (html) => text(html).match(/Volleyball\s+Limited Space[\s\S]*?(?=Interested in|$)/i)?.[0] ?? '';

export async function scrape({ fetch }) {
  const res = await get(PAGE, { fetch });
  if (!res.ok) throw new Error(`${PAGE}: HTTP ${res.status}`);
  return { sessions: parse(res.text), contentHash: contentHash(watchedText(res.text)) };
}

export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
