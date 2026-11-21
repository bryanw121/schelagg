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
 *
 * `incidental` tags (Food, Music) name things most markets have on the side: an art bazaar whose
 * description mentions coffee is not a food event. At a market, bazaar, fair, festival or expo
 * they count only when the title says so; for anything else (a pop-up, a cart) the description counts too.
 */
const MARKET_LIKE = / (market|markets|bazaar|bazaars|fair|fairs|festival|fest|fes|expo|show) /;
export const SEARCH_TAGS = [
  { id: 'night-market', label: 'Night market', words: ['night market', 'night markets', 'night bazaar', 'moonlight market', 'market after dark'] },
  { id: 'makers-market', label: 'Makers market', words: ['makers market', 'maker s market', 'makers fair', 'artisan market', 'artisan markets', 'craft market', 'craft fair', 'handmade', 'witches market', 'vendor market', 'marketplace', 'small business saturday', 'small biz saturday'] },
  { id: 'vintage', label: 'Vintage', words: ['vintage', 'thrift', 'flea market', 'flea'] },
  { id: 'matcha', label: 'Matcha', words: ['matcha'] },
  { id: 'food', label: 'Food', incidental: true, words: ['food truck', 'food trucks', 'food pop up', 'food festival', 'tasting', 'ramen', 'bbq', 'barbecue', 'tacos', 'taco', 'bakery', 'bake sale', 'bread', 'loaf', 'dumplings', 'dumpling', 'boba', 'coffee', 'koffie', 'supper club', 'pizza', 'burgers', 'brunch', 'dessert', 'desserts', 'donuts', 'ice cream', 'noodles', 'sushi', 'omakase', 'chef', 'kitchen', 'eats', 'bites', 'bake', 'cook off', 'cookoff', 'chili', 'gumbo', 'tamales', 'hot chicken', 'kimchi', 'mochi', 'katsu', 'malasadas', 'tiramisu', 'cinnamon rolls', 'sweet rolls', 'food vendors', 'thai dessert'] },
  { id: 'holiday', label: 'Holiday', words: ['holiday', 'holidays', 'christmas', 'xmas', 'santa', 'hanukkah', 'thanksgiving', 'winter market', 'trail of lights', 'winter wonderland', 'winter fest'] },
  { id: 'music', label: 'Music', incidental: true, words: ['live music', 'concert', 'dj set', 'live band', 'music festival'] },
  { id: 'art-lights', label: 'Art & lights', words: ['light show', 'light trail', 'light trails', 'lights', 'luminaria', 'luminarias', 'luminations', 'luminary', 'light installation', 'light installations', 'installations', 'festival of lights', 'tree lighting', 'lighting of', 'art bazaar', 'art market', 'art show', 'art walk', 'studio tour', 'gallery', 'art pop up'] },
  { id: 'farmers-market', label: 'Farmers market', words: ['farmers market', 'farmers markets', 'farmer s market', 'farm stand'] },
  { id: 'culture', label: 'Culture', words: ['dia de los muertos', 'day of the dead', 'tihar', 'diwali', 'lunar new year', 'japan fes', 'matsuri', 'celtic', 'cultural', 'heritage', 'bollyx', 'bollywood', 'fiesta', 'oktoberfest', 'juneteenth', 'folklorico'] },
  { id: 'kids-family', label: 'Kids & family', words: ['kids', 'kid', 'children', 'family friendly', 'whole family', 'family fun', 'meet santa', 'breakfast with santa', 'letters to santa', 'photos with santa', 'santa photos', 'storytime', 'story time'] },
  { id: 'drinks', label: 'Drinks', incidental: true, words: ['wine', 'wines', 'winery', 'cocktail', 'cocktails', 'beer', 'brewery', 'brewing', 'taproom', 'sake', 'pop up bar', 'porch pour'] },
  { id: 'wellness', label: 'Wellness', words: ['wellness', 'yoga', 'meditation', 'sound bath', 'reiki', 'pilates', 'breathwork'] },
  { id: 'free', label: 'Free', words: ['free admission', 'free entry', 'free to attend'] },
];
const hasWords = (hay, words) => words.some((w) => hay.includes(` ${w} `));
/** The search tags an event has, in SEARCH_TAGS order. */
export function searchTags(ev) {
  const title = ` ${fold(ev?.title)} `, hay = ` ${fold(`${ev?.title ?? ''} ${ev?.description ?? ''}`)} `;
  const market = MARKET_LIKE.test(title);
  return SEARCH_TAGS.filter((t) => hasWords(t.incidental && market ? title : hay, t.words) || (t.id === 'free' && /^\s*free\b/i.test(ev?.price ?? ''))).map((t) => t.id);
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
// Holiday comes last: most December events have it, so it says little next to a more specific one.
const ICON_ORDER = ['night-market', 'matcha', 'vintage', 'farmers-market', 'makers-market', 'culture', 'food', 'art-lights', 'drinks', 'wellness', 'music', 'kids-family', 'holiday'];
/** An event's topics, main one first (the order above), then the rest; Free is a fact, not a topic. */
export function eventTopics(ev) {
  const tags = searchTags(ev).filter((t) => t !== 'free');
  return [...ICON_ORDER.filter((t) => tags.includes(t)), ...tags.filter((t) => !ICON_ORDER.includes(t))];
}
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
  'art-lights': '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.500 2.500M15.500 15.500L18 18M6 18l2.500-2.500M15.500 8.500L18 6"/><circle cx="12" cy="12" r="2.200"/>',
  'farmers-market': '<path d="M12 21v-9M12 12c0-4 3-7 8-7 0 5-3 7-8 7zM12 14c0-3-2.500-5-7-5 0 4 2.500 5 7 5z"/>',
  culture: '<path d="M12 2v2M8 6h8M7 6c-1.500 2-1.500 8 0 10h10c1.500-2 1.500-8 0-10M8 16v2h8v-2M12 18v3"/>',
  'kids-family': '<path d="M12 3a5 5 0 0 1 5 5c0 3.500-3 6.500-5 6.500S7 11.500 7 8a5 5 0 0 1 5-5zM11 16.500h2l-1-2zM12 16.500c0 2-2 2.500-2 4.500"/>',
  drinks: '<path d="M8 3h8l-.500 5a3.500 3.500 0 0 1-7 0L8 3zM12 11.500V20M8.500 20h7"/>',
  wellness: '<path d="M12 20c-4 0-8-2-9-6 3-1 6 0 9 3 3-3 6-4 9-3-1 4-5 6-9 6zM12 17c-2-2-2.500-6 0-10 2.500 4 2 8 0 10z"/>',
  seasonal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
};
