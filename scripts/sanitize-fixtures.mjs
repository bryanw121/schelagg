// Strip personal data from captured source fixtures (test/fixtures/sources) before they're
// committed: this repo is public. Keeps only what the adapters and tests read.
//
//   node scripts/sanitize-fixtures.mjs        rewrite every fixture in place (idempotent)
//
// capture-fixtures.mjs runs this after each capture, so new captures are clean too.
// Arketa: whitelisted class fields only (no hosts/coaches, descriptions, images, links).
// Reclub meet pages: only the meet / venue / community / club / schedule fields the adapter
// uses survive in __NUXT_DATA__ (no participants, usersMap, notes, tokens); the rest of the
// HTML is dropped. Reclub club pages: only the meet links.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { repoPath } from '../lib/paths.js';

export const FIXTURES = repoPath('test/fixtures/sources');

// --- Arketa ---------------------------------------------------------------------------------

const CLASS_FIELDS = ['id', 'name', 'start_time', 'duration', 'experience_type', 'canceled', 'display', 'max_capacity',
  'total_booked', 'waitlistLength', 'isBookable', 'isWaitlistFull', 'timezoneCalculated'];
const LOCATION_FIELDS = ['id', 'name', 'city', 'state', 'address'];
const PROGRAMS = /^(Basecamp|Ascend|Peak|Apex|Summit|Smashball|NXTLVL|VW Fours|Fast Fours)\b/i;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/** Arketa schedule response -> same shape, venue/class facts only. `maxOther` caps non-adult classes kept. */
export function sanitizeArketa(json, { maxOther = 12 } = {}) {
  const classes = json?.data?.classes ?? [];
  let other = 0;
  const kept = classes.filter((c) => {
    if (/adult|open gym|women'?s? only/i.test(c.name ?? '')) return true;
    if (/homeschool/i.test(c.name ?? '')) return true; // the filter's exclusion case
    // Other classes only from Volleyworld's named programs: private bookings are named after people.
    return PROGRAMS.test(c.name ?? '') && other++ < maxOther;
  });
  return { data: { classes: kept.map((c) => ({ ...pick(c, CLASS_FIELDS), location: pick(c.location, LOCATION_FIELDS) })) } };
}

// --- Reclub ---------------------------------------------------------------------------------

const KEEP = true;
// Which keys survive, per object; KEEP keeps a whole subtree (venue/community/sport facts only).
const MEET = Object.fromEntries(['id', 'referenceCode', 'type', 'status', 'startDatetime', 'duration', 'endDatetime',
  'communityId', 'sportId', 'numPlayers', 'numReserved', 'privacy', 'name', 'feeType', 'feeAmount', 'feeCurrency',
  'gender', 'venueId', 'scheduleId', 'venue', 'community', 'sport', 'isPast', 'isCancelled'].map((k) => [k, KEEP]));
const GROUP = Object.fromEntries(['id', 'type', 'slug', 'name', 'communityId', 'sportId'].map((k) => [k, KEEP]));
const SCHEDULE = Object.fromEntries(['id', 'meetType', 'status', 'sportId', 'frequencyType', 'frequencyUnit', 'startTime',
  'duration', 'numPlayers', 'name', 'feeType', 'feeAmount', 'feeCurrency', 'venueId'].map((k) => [k, KEEP]));
const MEET_PAGE = {
  data: { '*': { meet: MEET, group: GROUP, schedule: SCHEDULE, community: KEEP, status: KEEP } },
  serverRendered: KEEP,
};
const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef']);

/**
 * Prune a flattened devalue array in place of a copy: objects lose keys not in `spec`, and every
 * entry no longer reachable from the root becomes null. Indices stay stable, so the wrappers
 * (Reactive/Ref/EmptyRef) the decoder must handle are preserved exactly.
 */
export function pruneFlat(input, spec) {
  const arr = structuredClone(input);
  const reached = new Set();
  const visit = (i, s) => {
    if (typeof i !== 'number' || i < 0 || i >= arr.length) return;
    const v = arr[i];
    if (s === KEEP) { // whole subtree
      if (reached.has(`${i}|*`)) return;
      reached.add(`${i}|*`);
    }
    reached.add(i);
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {
        if (WRAPPERS.has(v[0])) return visit(v[1], s);
        for (const x of v.slice(1)) if (typeof x === 'number') visit(x, KEEP); // Date/Set/Map payloads
        return;
      }
      for (const x of v) visit(x, s);
      return;
    }
    if (s === KEEP) { for (const x of Object.values(v)) visit(x, KEEP); return; }
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const child = s?.[k] ?? s?.['*'];
      if (child === undefined) continue;
      out[k] = x;
      visit(x, child);
    }
    arr[i] = out;
  };
  visit(0, spec);
  return arr.map((v, i) => (reached.has(i) ? v : null));
}

const NUXT = /<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

/** A Reclub meet page reduced to its sanitized __NUXT_DATA__ script. */
export function sanitizeReclubMeet(html) {
  const m = String(html).match(NUXT);
  const data = m ? JSON.stringify(pruneFlat(JSON.parse(m[1]), MEET_PAGE)) : '[]';
  return `<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n<script type="application/json" data-nuxt-data="nuxt-app" data-ssr="true" id="__NUXT_DATA__">${data}</script>\n</body></html>\n`;
}

/** A Reclub club page reduced to its meet links. */
export function sanitizeReclubClub(html) {
  const codes = [...new Set([...String(html).matchAll(/href=["'](?:https?:\/\/reclub\.co)?\/m\/([A-Za-z0-9]{4,12})["'?#]/g)].map((x) => x[1]))];
  return `<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n${codes.map((c) => `<a href="/m/${c}">${c}</a>`).join('\n')}\n</body></html>\n`;
}

// --- WordPress REST pages (Austin Velocity) -------------------------------------------------

/**
 * A WordPress `wp/v2/pages` response -> the page facts an adapter reads (slug, title, content),
 * with emails, phone numbers and chat invite links scrubbed out of the content.
 */
export function sanitizeWpPages(json) {
  const pages = Array.isArray(json) ? json : [];
  return pages.map((p) => ({
    id: p.id, slug: p.slug, modified: p.modified, link: p.link,
    title: { rendered: scrubText(p.title?.rendered ?? '') },
    content: { rendered: scrubText(p.content?.rendered ?? '').replace(/https?:\/\/(?:web\.)?groupme\.com\/join_group\/[^"'\s<]+/g, 'https://groupme.com/join_group/redacted') },
  }));
}

// --- anything else --------------------------------------------------------------------------

/** Last-resort scrub for free text (e.g. ACES WordPress pages): emails and phone numbers. */
export const scrubText = (s) => String(s)
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'redacted@example.com')
  .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '000-000-0000');

/** Sanitize one fixture's contents by file name. */
export function sanitize(name, text) {
  if (name.startsWith('arketa-')) return JSON.stringify(sanitizeArketa(JSON.parse(text)), null, 1) + '\n';
  if (name.startsWith('reclub-meet-')) return sanitizeReclubMeet(text);
  if (name.startsWith('reclub-club-')) return sanitizeReclubClub(text);
  if (name.endsWith('-wp-pages.json')) return JSON.stringify(sanitizeWpPages(JSON.parse(text)), null, 1) + '\n';
  return scrubText(text);
}

export async function sanitizeAll(dir = FIXTURES) {
  for (const name of (await readdir(dir)).sort()) {
    const path = `${dir}/${name}`;
    const before = await readFile(path, 'utf8');
    const after = sanitize(name, before);
    if (after !== before) await writeFile(path, after);
    console.log(`sanitized ${name}: ${before.length}B -> ${after.length}B`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await sanitizeAll();
