// Search: words typed into the box narrow the Events list or the day's open play, and Events
// has tags (a fixed word list per tag, so an event's tags never change from run to run).
// Pure, shared by the page and its tests.

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** The words of a search, lowercased and without punctuation ("Night-Market!" -> ["night", "market"]). */
export const searchWords = (q) => fold(q).split(' ').filter(Boolean);
/** Every word of the search starts a word somewhere in the text ("mar" finds "market", not "summary"). */
export function matchesText(text, q) {
  const words = searchWords(q);
  if (!words.length) return true;
  const hay = ` ${fold(text)}`;
  return words.every((w) => hay.includes(` ${w}`));
}

/**
 * Search tags. An event has a tag when its title or description has one of the tag's words (whole
 * words), or, for Free, when its price says so. Add a tag by adding a line here.
 */
export const SEARCH_TAGS = [
  { id: 'night-market', label: 'Night market', words: ['night market', 'night markets', 'night bazaar', 'moonlight market', 'market after dark'] },
  { id: 'makers-market', label: 'Makers market', words: ['makers market', 'maker s market', 'makers fair', 'artisan market', 'craft market', 'craft fair', 'handmade'] },
  { id: 'vintage', label: 'Vintage', words: ['vintage', 'thrift', 'flea market', 'flea'] },
  { id: 'matcha', label: 'Matcha', words: ['matcha'] },
  { id: 'food', label: 'Food', words: ['food truck', 'food trucks', 'tasting', 'ramen', 'bbq', 'barbecue', 'tacos', 'bakery', 'bake sale', 'dumplings', 'boba', 'coffee', 'supper club', 'food festival'] },
  { id: 'holiday', label: 'Holiday', words: ['holiday', 'holidays', 'christmas', 'xmas', 'santa', 'hanukkah', 'thanksgiving', 'winter market', 'trail of lights'] },
  { id: 'music', label: 'Music', words: ['live music', 'concert', 'dj set', 'live band', 'music festival'] },
  { id: 'free', label: 'Free', words: ['free admission', 'free entry', 'free to attend'] },
];
const hasWords = (hay, words) => words.some((w) => hay.includes(` ${w} `));
/** The search tags an event has, in SEARCH_TAGS order. */
export function searchTags(ev) {
  const hay = ` ${fold(`${ev?.title ?? ''} ${ev?.description ?? ''}`)} `;
  return SEARCH_TAGS.filter((t) => hasWords(hay, t.words) || (t.id === 'free' && /^\s*free\b/i.test(ev?.price ?? ''))).map((t) => t.id);
}
export const searchTagLabel = (id) => SEARCH_TAGS.find((t) => t.id === id)?.label ?? id;
/** Tags that have events, most first, as [{ id, label, n }]. */
export function tagCounts(events) {
  const n = new Map();
  for (const e of events ?? []) for (const t of searchTags(e)) n.set(t, (n.get(t) ?? 0) + 1);
  return SEARCH_TAGS.filter((t) => n.has(t.id)).map((t) => ({ id: t.id, label: t.label, n: n.get(t.id) })).sort((a, b) => b.n - a.n);
}

/** What a search reads on an event: its title, place, organizer, description, kind, tags. `labels` are the kind and tag names shown on its card. */
export const eventText = (ev, labels = []) => [ev?.title, ev?.venue, ev?.area, ev?.city, ev?.description, ev?.account, ev?.source, ...labels, ...searchTags(ev).map(searchTagLabel)].filter(Boolean).join(' · ');
/** What a search reads on an open-play session. */
export const sessionText = (x, labels = []) => [x?.title, x?.venue, x?.city, x?.type, x?.level, x?.surface, x?.rink, ...labels].filter(Boolean).join(' · ');

/** Split text into [part, isMatch] pairs so the page can highlight the words that matched (at word starts). */
export function highlightParts(text, q) {
  const s = String(text ?? '');
  const words = searchWords(q);
  if (!words.length) return [[s, false]];
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc.join('|')})`, 'giu');
  const out = [];
  let last = 0, m;
  while ((m = re.exec(s))) {
    const at = m.index + m[1].length;
    if (at > last) out.push([s.slice(last, at), false]);
    out.push([m[2], true]);
    last = at + m[2].length;
  }
  if (last < s.length) out.push([s.slice(last), false]);
  return out;
}

/**
 * The picture an event leads with when there is no organizer photo: the icon of its most specific
 * tag (a night market that also has food is a night market), else of its kind. Fixed order, so an
 * event always shows the same picture. Returns an icon id from EVENT_ICONS.
 */
const ICON_ORDER = ['night-market', 'matcha', 'vintage', 'makers-market', 'food', 'holiday', 'music'];
export function eventIcon(ev, kind = null) {
  const tags = searchTags(ev);
  return ICON_ORDER.find((t) => tags.includes(t)) ?? (kind === 'seasonal' ? 'seasonal' : 'popup');
}
/** Icon id -> the paths of a 24×24 line drawing (stroke, no fill). */
export const EVENT_ICONS = {
  'night-market': '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  'makers-market': '<path d="M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5"/>',
  vintage: '<path d="M12 8a2 2 0 1 1 2-2M12 8v2M12 10l9 7H3l9-7z"/>',
  matcha: '<path d="M5 10h12v3a6 6 0 0 1-12 0v-3zM17 11h1.500a2 2 0 0 1 0 4H16.600M9 6c0-1.200 1-1.200 1-2.400M13 6c0-1.200 1-1.200 1-2.400M4 21h14"/>',
  food: '<path d="M7 3v18M4.500 3v4.500a2.500 2.500 0 0 0 5 0V3M16.500 3c-2.200 2-2.200 7 0 9v9"/>',
  holiday: '<path d="M12 3l2.600 5.600 6.100.700-4.500 4.200 1.200 6-5.400-3-5.400 3 1.200-6L3.300 9.300l6.100-.700z"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  popup: '<path d="M12 21s7-6.200 7-11a7 7 0 0 0-14 0c0 4.800 7 11 7 11z"/><circle cx="12" cy="10" r="2.500"/>',
  seasonal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
};
