// LeagueApps event series (e.g. Volleyball Austin's open plays, volleyballaustin.leagueapps.com).
// A series page links one child event per date (/events/<id>-<slug>); each child page has its
// date ("Starts: Nov 15 '26"), time ("7:00pm to 9:00pm"), fee ("Regular $12.00") and location.
// robots.txt allows these pages. Plain fetch, no browser.
//
//   options.series: [{ url, title?, venue?, city?, surface?, host?, level?, max? }]
import { get } from '../../lib/http.js';
import { addDays, to24 } from '../../lib/time.js';

export const id = 'leagueapps';
export const needsBrowser = false;
/** Dated sessions this far ahead, like the schedule (lib/pipeline.js HORIZON_DAYS). */
const HORIZON_DAYS = 14;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ENT = { rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', amp: '&', middot: '·', nbsp: ' ' };

/** Page HTML → plain text on one line. */
export const pageText = (html) => String(html)
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&(\w+);/g, (m, e) => ENT[e] ?? m).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim();

/** Child event links on a series page, absolute, in page order. */
export function childLinks(html, seriesUrl) {
  const base = new URL(seriesUrl);
  const self = base.pathname.replace(/\/$/, '');
  const out = [];
  for (const m of String(html).matchAll(/href="((?:https?:\/\/[^"/]+)?\/events\/\d+-[^"?#]*)"/g)) {
    const u = new URL(m[1], base);
    if (u.host !== base.host || u.pathname.replace(/\/$/, '') === self) continue;
    if (!out.includes(u.href)) out.push(u.href);
  }
  return out;
}

/** One child event page → a dated session, or null when it has no date or time. */
export function parseEvent(html, url, series = {}) {
  const t = pageText(html);
  const d = t.match(/Starts:\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*[’']\s*(\d{2})/);
  const mo = d ? MONTHS.indexOf(d[1].toLowerCase()) + 1 : 0;
  const time = t.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)\s*to\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
  if (!mo || !time) return null;
  const date = `20${d[3]}-${String(mo).padStart(2, '0')}-${String(+d[2]).padStart(2, '0')}`;
  const fee = t.match(/Regular\s*\$(\d+(?:\.\d{2})?)/)?.[1];
  const venue = series.venue ?? t.match(/Location:\s*(.+?)\s+(?:Minimum age|Age as of|Mon Tue)/)?.[1]?.trim() ?? null;
  const name = t.match(/Register\s+(.+?)\s+Volleyball\s+Starts:/)?.[1]?.trim();
  const eventId = new URL(url).pathname.match(/\/events\/(\d+)/)?.[1] ?? date;
  return {
    id: `leagueapps-${eventId}`,
    date, start: to24(time[1].replace(/(\d)([ap]m)/i, '$1 $2')), end: to24(time[2].replace(/(\d)([ap]m)/i, '$1 $2')),
    title: series.title ? (/4-hour/i.test(name ?? '') ? `${series.title} (4 hours)` : series.title) : name ?? 'Open play',
    venue, city: series.city ?? null, surface: series.surface ?? 'indoor', type: 'Open play',
    level: series.level ?? 'All levels',
    price: fee ? `$${String(+fee)}${/Processing Fee/i.test(t) ? ' + fee' : ''}` : null,
    note: series.host ? `Hosted by ${series.host}.` : null,
    signup: { url, label: 'Register on LeagueApps' }, source: url,
  };
}

export async function scrape({ options, fetch, ref }) {
  const list = options?.series ?? [];
  if (!list.length) throw new Error('leagueapps: no series configured');
  const sessions = [], warnings = [];
  for (const series of list) {
    const res = await get(series.url, { fetch });
    if (!res.ok) { warnings.push(`${series.url}: HTTP ${res.status}`); continue; }
    const links = childLinks(res.text, series.url).slice(0, series.max ?? 12);
    if (!links.length) warnings.push(`${series.url}: no dated events listed`);
    for (const url of links) {
      try {
        const r = await get(url, { fetch });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const s = parseEvent(r.text, url, series);
        if (!s) throw new Error('no date or time on the page');
        if (!ref || (s.date >= ref && s.date <= addDays(ref, HORIZON_DAYS))) sessions.push(s);
      } catch (e) { warnings.push(`${url}: ${e.message}`); }
    }
  }
  if (!sessions.length && warnings.length) throw new Error(warnings.join('; '));
  return { sessions, warnings };
}

export async function check({ now = new Date() } = {}) {
  return { status: 'unknown', checkedAt: now.toISOString() };
}
