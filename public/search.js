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
