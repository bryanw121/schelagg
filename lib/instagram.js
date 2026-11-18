// Instagram organizers through Meta's official Graph API (Business Discovery): with our own
// Instagram professional account's id and token (IG_USER_ID / IG_ACCESS_TOKEN, Actions secrets),
// it returns a business or creator account's recent public posts and its profile picture by
// username. No scraping, no sign-in to instagram.com. Personal accounts can't be read.
//
// Posts become events only when the caption plainly says so: an event word (market, pop-up, …),
// a date after the post, and a place (a 📍 line, "at <Place>", or the account's own venue in
// config/instagram.json). Anything unclear is skipped rather than guessed. The event links to
// the post and carries our own short summary, never the whole caption.

import { createHash } from 'node:crypto';
import { classify, isWanted, tidyTitle } from './event-sources.js';

export const GRAPH = 'https://graph.facebook.com/v21.0';
export const isHandle = (h) => /^[a-z0-9._]{1,30}$/.test(h);
/** The "@handle" in an event's source ("Instagram @vistabrewing"), lowercased, or null. */
export const handleOf = (source) => { const m = String(source ?? '').match(/instagram\s*@([A-Za-z0-9._]+)/i); return m ? m[1].toLowerCase().replace(/\.$/, '') : null; };

/** The Business Discovery request for one account (the token goes in a header, never the URL). */
export function discoveryUrl(igUserId, handle, { posts = true } = {}) {
  if (!/^\d+$/.test(String(igUserId))) throw new Error('IG_USER_ID must be the numeric Instagram user id');
  if (!isHandle(handle)) throw new Error(`not an Instagram username: ${handle}`);
  const fields = `username,name,profile_picture_url${posts ? ',media.limit(12){caption,permalink,timestamp,media_type}' : ''}`;
  return `${GRAPH}/${igUserId}?fields=${encodeURIComponent(`business_discovery.username(${handle}){${fields}}`)}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const iso = (y, m, d) => { const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; const t = new Date(`${s}T00:00:00Z`); return t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? s : null; };

/**
 * The first date (or range) a caption names, on or after the day it was posted and within
 * 120 days of it: "Nov 21", "November 21-23", "Nov 28 – Dec 20", "11/21", "12/5-12/7".
 * Weekday words alone ("this Saturday") are not enough.
 */
export function captionDates(text, posted) {
  const y0 = +posted.slice(0, 4);
  const settle = (m, d) => { // the next such date on or after the post
    for (const y of [y0, y0 + 1]) { const s = iso(y, m, d); if (s && s >= posted) return s; }
    return null;
  };
  const within = (s) => s && (Date.parse(s) - Date.parse(posted)) / 864e5 <= 120;
  const t = String(text);
  const candidates = [];
  const words = new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:-|–|—|to|thru|through)\\s*(?:${MON}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?`, 'gi');
  for (const m of t.matchAll(words)) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const start = settle(mo, +m[2]);
    let end = null;
    if (m[4] && start) { const mo2 = m[3] ? MONTHS.indexOf(m[3].slice(0, 3).toLowerCase()) + 1 : mo; end = [iso(+start.slice(0, 4), mo2, +m[4]), iso(+start.slice(0, 4) + 1, mo2, +m[4])].find((s) => s && s > start) ?? null; }
    candidates.push({ at: m.index, start, end });
  }
  for (const m of t.matchAll(/(?<![\d/$.])(\d{1,2})\/(\d{1,2})(?:\s*(?:-|–|—)\s*(\d{1,2})\/(\d{1,2}))?(?![\d/])(?!\s*(?:off|price|lb|oz|cup|inch|"))/gi)) { // not "1/2 off"
    const start = settle(+m[1], +m[2]);
    const end = m[3] && start ? [iso(+start.slice(0, 4), +m[3], +m[4]), iso(+start.slice(0, 4) + 1, +m[3], +m[4])].find((s) => s && s > start) ?? null : null;
    candidates.push({ at: m.index, start, end });
  }
  const c = candidates.filter((x) => within(x.start)).sort((a, b) => a.at - b.at)[0];
  if (!c) return null;
  return { startDate: c.start, ...(c.end && within(c.end) ? { endDate: c.end } : {}) };
}

const clock = (h, min, ap, fallbackAp) => { let hh = +h % 12; const p = (ap ?? fallbackAp ?? '').toLowerCase(); if (p.startsWith('p')) hh += 12; return `${String(hh).padStart(2, '0')}:${min ?? '00'}`; };
/** "11am-3pm", "6–10 PM", "5:30pm to 9pm" → { startTime, endTime }; a lone "7pm" → { startTime }. */
export function captionTimes(text) {
  const t = String(text);
  const r = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|til|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (r && +r[1] >= 1 && +r[1] <= 12 && +r[4] >= 1 && +r[4] <= 12) return { startTime: clock(r[1], r[2], r[3], r[6]), endTime: clock(r[4], r[5], r[6]) };
  const one = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  return one && +one[1] >= 1 && +one[1] <= 12 ? { startTime: clock(one[1], one[2], one[3]) } : {};
}

const strip = (s) => String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ').replace(/#[\p{L}\d_]+/gu, ' ').replace(/\s+/g, ' ').trim();
/** Where: the 📍 line, or "at/@ <Capitalised place>" up to the sentence's end. */
export function captionVenue(text) {
  const pin = String(text).match(/📍\s*([^\n]+)/u);
  if (pin) { const v = strip(pin[1]).replace(/[.!,;]+$/, ''); if (v.length >= 3 && v.length <= 90) return v; }
  const at = String(text).match(/(?:\bat|@)\s+((?:the\s+)?[A-Z][\p{L}\d'’&.-]*(?:\s+(?:[A-Z&][\p{L}\d'’&.-]*|of|the|on|\d+[\p{L}]*)){0,6})/u);
  if (at) { const v = strip(at[1]).replace(/[.!,;]+$/, ''); if (v.length >= 3 && !/^(the|a|an)$/i.test(v)) return v; }
  return null;
}

/** A post as a feed event, or null when the caption doesn't plainly describe one. */
export function postToEvent(post, account, { today, region = 'austin', city = 'Austin' }) {
  const caption = String(post.caption ?? '');
  if (!caption || !/^https:\/\/www\.instagram\.com\//.test(post.permalink ?? '')) return null;
  const posted = String(post.timestamp ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(posted)) return null;
  const first = strip(caption.split(/\n/).find((l) => strip(l).length >= 4) ?? '');
  // The event's name: the caption's first line, up to its first sentence end.
  const title = tidyTitle(first.split(/(?<=[.!?])\s/)[0].replace(/[.!?:]+$/, '')).slice(0, 80).trim();
  if (!title || !isWanted(`${title} ${strip(caption).slice(0, 300)}`)) return null;
  const dates = captionDates(caption, posted);
  if (!dates || (dates.endDate ?? dates.startDate) < today) return null;
  const venue = captionVenue(caption) ?? account.venue ?? null;
  if (!venue) return null;
  const { kind, tags } = classify(title, strip(caption).slice(0, 300));
  const name = account.name ?? `@${account.handle}`;
  return {
    id: `evt-${createHash('sha256').update(`${post.permalink}|${dates.startDate}`).digest('hex').slice(0, 16)}`,
    category: tags.includes('asian-inspired') && kind === 'popup' ? 'asian-inspired' : kind,
    kind, tags, title, venue, city: account.city ?? city, ...dates, ...captionTimes(caption),
    sourceUrl: post.permalink, source: `Instagram @${account.handle}`, account: account.handle,
    description: `Posted by ${name} on Instagram. See the post for details.`,
    region,
  };
}

/**
 * Read the configured accounts' posts (and, for `avatarOnly` handles, just the profile).
 * Returns { ok, error, events, profiles: { handle: { name, picture } } }. A handle that can't
 * be read (personal account, renamed) is skipped; all failing is an error.
 */
export async function readInstagram(config, { get, today, igUserId, token, extraHandles = [] }) {
  const accounts = (config.accounts ?? []).filter((a) => isHandle(a.handle));
  const avatarOnly = [...new Set(extraHandles)].filter((h) => isHandle(h) && !accounts.some((a) => a.handle === h));
  const events = [], profiles = {}, skipped = [];
  let failed = 0, lastError = null;
  for (const a of [...accounts, ...avatarOnly.map((handle) => ({ handle, avatarOnly: true }))]) {
    const r = await get(discoveryUrl(igUserId, a.handle, { posts: !a.avatarOnly }), { headers: { authorization: `Bearer ${token}` } }).catch((e) => ({ ok: false, status: e.message, text: '' }));
    let body = null;
    try { body = JSON.parse(r.text); } catch { /* not JSON */ }
    const bd = body?.business_discovery;
    if (!r.ok || !bd) {
      // 190 = bad or expired token, 4/17/32/613 = rate limits: those fail the run. Anything else is this account.
      const code = body?.error?.code;
      if ([190, 4, 17, 32, 613, 10, 200].includes(code)) return { ok: false, error: `Instagram API: ${body.error.type ?? 'error'} ${code}${code === 190 ? ' (the token is invalid or expired)' : ''}`, events: [], profiles: {}, skipped };
      failed++; lastError = `@${a.handle}: ${code ?? r.status}`; skipped.push(a.handle);
      continue;
    }
    if (/^https:\/\//.test(bd.profile_picture_url ?? '')) profiles[a.handle] = { name: bd.name ?? null, picture: bd.profile_picture_url };
    if (a.avatarOnly) continue;
    for (const post of bd.media?.data ?? []) {
      const ev = postToEvent(post, { ...a, name: a.name ?? bd.name }, { today, region: config.region, city: config.city });
      if (ev && !events.some((x) => x.id === ev.id)) events.push(ev);
    }
  }
  const total = accounts.length + avatarOnly.length;
  if (total && failed === total) return { ok: false, error: `no account could be read (${lastError})`, events: [], profiles, skipped };
  return { ok: true, error: null, events, profiles, skipped };
}
