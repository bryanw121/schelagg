// "Add a source" from the site: someone names a gym, a group, a market or an organizer, and this
// decides, by fixed rules and with no person in the loop, whether Schelagg can read it.
//
//   checkSource({ input, target, region }, { get, config })  ->  { status, title, detail, steps, found, plan? }
//     status 'have'  it is already read
//            'ok'    a reader fits and found something upcoming: `plan` says what to add to the config
//            'no'    it can't be added, and `detail` says why in plain words
//   applyPlan(plan, files)  ->  the config files' new text (run by the "Add a source" workflow)
//
// What it tries, in order: is it already a source; is it (or does a name lead to) a Reclub club, a
// Sweatpals host or a Meetup group with this sport in this region; for Events, does the linked
// page carry event data the listing reader keeps; and, for any other link, does the page point at
// a platform there is a reader for. Nothing typed is ever published: only what a reader finds is.
// robots.txt is honoured before any page that isn't one of those platforms is read.
import { jsonLdEvents, toFeedEvent } from './event-sources.js';
import { robotsAllows } from './robots.js';
import { today as todayIn } from './time.js';
import { meetData, meetLinks, meetUrl } from '../scripts/adapters/reclub.mjs';
import { hostUrl, parseHost } from '../scripts/adapters/sweatpals.mjs';
import { feedSessions } from '../scripts/adapters/ical.mjs';

export const MAX_INPUT = 200;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SPORT_WORDS = { volleyball: 'volley|🏐', pickleball: 'pickle', ice_skating: 'skat', basketball: 'basketball|hoops', soccer: 'soccer|futsal', tennis: 'tennis', badminton: 'badminton' };
const sportRe = (sport) => new RegExp(SPORT_WORDS[sport] ?? String(sport).replace(/_/g, ' '), 'i');
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const meetupFeed = (slug) => `https://www.meetup.com/${slug}/events/ical/`;

/** What was typed: a link to a platform we read, any other https link, an Instagram account, or a name. */
export function classify(input) {
  const text = String(input ?? '').trim();
  const at = /^@([A-Za-z0-9_.]{2,30})$/.exec(text);
  if (at) return { kind: 'instagram', slug: at[1] };
  if (/^(https?:\/\/|www\.)\S+$/i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(text)) {
    let u;
    try { u = new URL(/^https?:/i.test(text) ? text : `https://${text}`); } catch { return { kind: 'name', name: text }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'name', name: text };
    u.protocol = 'https:'; u.hash = '';
    const h = u.hostname.replace(/^www\./, '');
    let m;
    if (h === 'reclub.co' && (m = /^\/clubs\/@([A-Za-z0-9_.-]+)/.exec(u.pathname))) return { kind: 'reclub', slug: m[1] };
    if (h === 'sweatpals.com' && (m = /^\/host\/([A-Za-z0-9_.-]+)/.exec(u.pathname))) return { kind: 'sweatpals', slug: m[1] };
    if (h === 'meetup.com' && (m = /^\/([A-Za-z0-9-]{3,80})(\/|$)/.exec(u.pathname)) && !['find', 'topics', 'cities', 'apps', 'lp'].includes(m[1])) return { kind: 'meetup', slug: m[1] };
    if (h === 'instagram.com' && (m = /^\/([A-Za-z0-9_.]{2,30})\/?$/.exec(u.pathname))) return { kind: 'instagram', slug: m[1] };
    return { kind: 'link', url: u.href };
  }
  return { kind: 'name', name: text };
}

/** Spellings a name might have as an account on a platform: "Volley Club ATX" -> volley-club-atx, volleyclubatx, volley_club_atx. */
export function slugGuesses(name) {
  const words = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return [...new Set([words.join('-'), words.join(''), words.join('_')])].filter((s) => SLUG.test(s));
}

/** Everything already read, from the config: { reclub, sweatpals, meetup, instagram: Set<slug>, urls: Set<url>, names: [{ name, via }] }. */
export function knownSources(config) {
  const k = { reclub: new Set(), sweatpals: new Set(), meetup: new Set(), instagram: new Set(), urls: new Set(), hosts: new Map(), names: [] };
  const seeUrl = (url, via) => { if (!url) return; k.urls.add(String(url).replace(/\/+$/, '').toLowerCase()); const h = host(url); if (h && !['reclub.co', 'sweatpals.com', 'meetup.com', 'allevents.in'].includes(h)) k.hosts.set(h, via); };
  for (const r of config.regions ?? []) {
    for (const s of r.sources?.sources ?? []) {
      k.names.push({ name: s.name, via: s.name });
      seeUrl(s.site, s.name);
      const o = s.options ?? {};
      for (const c of o.clubs ?? []) { const m = /\/clubs\/@([A-Za-z0-9_.-]+)/.exec(c); if (m) k.reclub.add(m[1].toLowerCase()); }
      for (const h of o.hosts ?? []) if (h.slug) k.sweatpals.add(String(h.slug).toLowerCase());
      for (const f of o.feeds ?? []) { const m = /meetup\.com\/([A-Za-z0-9-]+)\//.exec(f.url ?? ''); if (m) k.meetup.add(m[1].toLowerCase()); else seeUrl(f.url, s.name); if (f.host) k.names.push({ name: f.host, via: s.name }); }
      for (const p of [...(o.pages ?? []), ...(o.series ?? [])]) seeUrl(p.url, s.name);
      for (const v of o.venues ?? []) if (v.name || v.venue) k.names.push({ name: v.name ?? v.venue, via: s.name });
      if (o.venue) k.names.push({ name: o.venue, via: s.name });
    }
    for (const v of r.venues ?? []) if (v.name) k.names.push({ name: v.name, via: null });
  }
  for (const s of config.events?.sources ?? []) { k.names.push({ name: s.name, via: s.name }); for (const u of s.urls ?? []) seeUrl(u, s.name); }
  for (const a of config.instagram?.accounts ?? []) if (a.handle) k.instagram.add(String(a.handle).toLowerCase());
  return k;
}

const have = (via, steps) => ({ status: 'have', title: 'We already have that one.', detail: via ? `It's read through ${via}.` : "It's already one of the places Skelly reads.", steps, found: 0 });
const no = (detail, steps, extra = {}) => ({ status: 'no', title: "Couldn't add it.", detail, steps, found: 0, ...extra });

/**
 * Decide. `config` is { regions: [{ info, sources, venues }], events, instagram, platforms };
 * `get(url)` answers { ok, status, text } (lib/http.js); `now` is for tests.
 */
export async function checkSource({ input, target, region: regionId }, { get, config, now = new Date() }) {
  const steps = [];
  const text = String(input ?? '').trim();
  if (!text) return no('Type a name or paste a link first.', steps);
  if (text.length > MAX_INPUT) return no(`Keep it under ${MAX_INPUT} characters.`, steps);
  const reg = (config.regions ?? []).find((r) => r.info.id === regionId);
  if (!reg) return no("That city isn't one Skelly covers yet.", steps);
  const events = target === 'events';
  const sport = events ? null : String(target ?? '');
  if (!events && !/^[a-z_]{3,30}$/.test(sport)) return no('Pick what it is for first.', steps);
  const city = reg.info.name.split(',')[0];
  const known = knownSources(config);
  const what = classify(text);
  const fetchPage = async (url) => get(url, { timeoutMs: 8000 }).catch((e) => ({ ok: false, status: String(e?.name === 'TimeoutError' ? 'no answer in time' : e?.message ?? e).slice(0, 80), text: '' }));

  // 1. Already read?
  if (what.kind !== 'name' && what.kind !== 'link' && known[what.kind].has(what.slug.toLowerCase())) return have({ reclub: 'Reclub', sweatpals: 'Sweatpals', meetup: 'Meetup', instagram: 'Instagram' }[what.kind], steps);
  if (what.kind === 'link') {
    if (known.urls.has(what.url.replace(/\/+$/, '').toLowerCase())) return have(null, steps);
    if (!events && known.hosts.has(host(what.url))) return have(known.hosts.get(host(what.url)), steps);
  }
  if (what.kind === 'name') {
    const n = norm(what.name);
    if (n.length < 3) return no('That name is too short to look up. Add a little more, or paste a link.', steps);
    const hit = known.names.find((x) => { const m = norm(x.name); return m === n || (n.length >= 6 && m.includes(n)); });
    if (hit) return have(hit.via, steps);
  }
  if (what.kind === 'instagram') return no("Instagram accounts can't be read automatically. Events posted there reach Skelly through a curated list instead. If it has a website or a Meetup, Reclub or Sweatpals page, paste that link.", steps);

  // 2. The platforms there are readers for.
  const probes = {
    async reclub(slug) {
      const url = `https://reclub.co/clubs/@${slug}`;
      const page = await fetchPage(url);
      if (!page.ok) return { miss: true, why: `Reclub answered ${page.status}` };
      const codes = meetLinks(page.text);
      if (!codes.length) return { why: 'It has a Reclub page, but nothing is coming up on it.' };
      const d = reg.sources?.sources?.find((s) => s.adapter === 'reclub')?.options?.discover ?? {};
      const { judgeMeet } = await import('../scripts/discover-reclub.mjs');
      let last = '';
      for (const code of codes.slice(0, 3)) {
        const meet = await fetchPage(meetUrl(code));
        if (!meet.ok) { last = `Reclub answered ${meet.status}`; continue; }
        const j = judgeMeet(meetData(meet.text), { sport, community: d.community, center: d.center ?? reg.info.center, radiusKm: d.radiusKm ?? reg.info.radiusKm });
        if (j.ok) return { found: codes.length, unit: 'meet', plan: { type: 'reclub', region: regionId, sport, slug }, label: `Reclub · @${slug}` };
        last = j.reason;
      }
      return { why: `It's on Reclub, but its meets aren't ${sport.replace(/_/g, ' ')} around ${city} (${last}).` };
    },
    async sweatpals(slug) {
      const page = await fetchPage(hostUrl(slug));
      if (!page.ok) return { miss: true, why: `Sweatpals answered ${page.status}` };
      let r;
      try { r = parseHost(page.text, { slug }, { venues: [], fallback: { city }, include: SPORT_WORDS[sport] ?? sport, timezone: reg.info.timezone, from: todayIn(now, reg.info.timezone) }); } catch { return { miss: true, why: 'not a Sweatpals host page' }; }
      if (!r.events?.length && !r.sessions.length) return { miss: true, empty: true, why: 'It has a Sweatpals page, but nothing is coming up on it.' };
      if (!r.sessions.length) return { why: `It's on Sweatpals, but nothing coming up there is ${sport.replace(/_/g, ' ')}.` };
      return { found: r.sessions.length, unit: 'session', plan: { type: 'sweatpals', region: regionId, sport, slug }, label: `Sweatpals · ${slug}` };
    },
    async meetup(slug) {
      const page = await fetchPage(meetupFeed(slug));
      if (!page.ok || !/BEGIN:VCALENDAR/.test(page.text)) return { miss: true, why: `Meetup answered ${page.status}` };
      const sessions = feedSessions(page.text, { url: meetupFeed(slug), idPrefix: `meetup-${slug.slice(0, 24)}`, host: slug }, { timezone: reg.info.timezone });
      const re = sportRe(sport);
      const mine = re.test(slug.replace(/-/g, ' ')) ? sessions : sessions.filter((s) => re.test(s.title ?? ''));
      if (!sessions.length) return { why: 'It has a Meetup group, but nothing is on its calendar.' };
      if (!mine.length) return { why: `It's on Meetup, but nothing on its calendar is ${sport.replace(/_/g, ' ')}.` };
      const name = /X-WR-CALNAME:(.+)/.exec(page.text)?.[1]?.replace(/^Events\s*-\s*/i, '').trim();
      return { found: mine.length, unit: 'session', plan: { type: 'meetup', region: regionId, sport, slug, ...(name ? { name: name.slice(0, 80) } : {}), ...(re.test(slug.replace(/-/g, ' ')) ? {} : { include: SPORT_WORDS[sport] ?? sport }) }, label: `Meetup · ${name ?? slug}` };
    },
  };
  const done = (p) => ({ status: 'ok', title: `Added. Found ${p.found} ${p.unit}${p.found === 1 ? '' : 's'} coming up.`, detail: "They'll be on Skelly within the hour.", steps, found: p.found, plan: p.plan, label: p.label });
  const platformNames = { reclub: 'Reclub', sweatpals: 'Sweatpals', meetup: 'Meetup' };

  if (probes[what.kind]) {
    if (events) return no(`${platformNames[what.kind]} pages are read for sports. For Events, paste a link to a page that lists the event with its date.`, steps);
    if (!SLUG.test(what.slug)) return no("That link doesn't look right. Check it and try again.", steps);
    const p = await probes[what.kind](what.slug);
    steps.push(`${platformNames[what.kind]}: ${p.plan ? 'found' : p.why}`);
    if (p.plan) return done(p);
    return no(p.miss && !p.empty ? `Couldn't open that ${platformNames[what.kind]} page (${p.why.replace(/^.*answered /, 'it answered ')}). Check the link.` : p.why, steps);
  }

  if (what.kind === 'name') {
    if (events) return no("Skelly can't look an event organizer up by name yet. Paste a link to the page that lists its events and it will be checked right away.", steps, { needsLink: true });
    let reason = null;
    for (const slug of slugGuesses(what.name)) {
      for (const kind of ['reclub', 'sweatpals', 'meetup']) {
        const p = await probes[kind](slug);
        if (p.plan) { steps.push(`${platformNames[kind]}: found ${slug}`); return done(p); }
        if (!p.miss) reason ??= p.why;
      }
    }
    steps.push('Looked for it on Reclub, Sweatpals and Meetup');
    return no(reason ?? "Couldn't find a page for that name on Reclub, Sweatpals or Meetup. Paste a link to its schedule and it will be checked right away.", steps, { needsLink: !reason });
  }

  // 3. Any other link: may the page be read, and what is on it?
  const u = new URL(what.url);
  const robots = await fetchPage(`${u.origin}/robots.txt`);
  const rules = robots.ok ? robots.text : /^(404|410)$/.test(String(robots.status)) ? '' : null;
  if (rules == null) { steps.push(`${u.hostname}: no answer`); return no(`Couldn't reach ${u.hostname} (${robots.status}). Check the link, or try again later.`, steps); }
  if (!robotsAllows(rules, u.pathname + u.search)) { steps.push('The site asks not to be read automatically'); return no(`${u.hostname} asks not to be read automatically, so Skelly leaves it alone.`, steps); }
  steps.push('The site allows reading it');
  const page = await fetchPage(what.url);
  if (!page.ok) return no(`${u.hostname} didn't let Skelly read that page (it answered ${page.status}).`, steps);
  steps.push('Read the page');

  if (events) {
    const today = todayIn(now, reg.info.timezone);
    const listed = jsonLdEvents(page.text);
    const kept = listed.map((o) => toFeedEvent(o, { source: u.hostname.replace(/^www\./, ''), region: { ...reg.info, city }, today })).filter(Boolean);
    if (kept.length) return { status: 'ok', title: `Added. Found ${kept.length} event${kept.length === 1 ? '' : 's'} coming up.`, detail: "They'll be on Skelly within the hour.", steps, found: kept.length, sample: kept.slice(0, 3).map((e) => e.title), plan: { type: 'events', region: regionId, url: what.url }, label: u.hostname.replace(/^www\./, '') };
    if (listed.length) return no(`The page lists ${listed.length} event${listed.length === 1 ? '' : 's'}, but none are upcoming pop-ups, markets or seasonal events around ${city}, which is what Skelly's Events tab shows.`, steps);
    return no("The page loaded, but its events aren't written in a form Skelly can read yet. It's been noted so a reader can be written.", steps, { wanted: true });
  }

  // A venue's own site: does it point at a platform there is a reader for?
  const links = [...page.text.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)].map((m) => m[0]);
  for (const link of links) {
    const c = classify(link);
    if (!probes[c.kind] || !SLUG.test(c.slug)) continue;
    if (known[c.kind].has(c.slug.toLowerCase())) return have(platformNames[c.kind], steps);
    const p = await probes[c.kind](c.slug);
    if (p.plan) { steps.push(`Its ${platformNames[c.kind]} page: found`); return done(p); }
  }
  const linked = new Set(links.map(host));
  const behind = (config.platforms?.platforms ?? []).find((p) => p.loginOnly && p.hosts.some((h) => [...linked].some((l) => l === h || l.endsWith(`.${h}`))));
  if (behind) return no(`Its schedule is on ${behind.label}, which needs a sign-in, so Skelly can't read it.`, steps);
  return no("The page loaded, but there's no schedule on it that Skelly can read yet. It's been noted so a reader can be written.", steps, { wanted: true });
}

/**
 * Carry out a plan on the config files' text. `files` is { sources: <region sources.json text>,
 * events: <config/events.json text> }; returns { file: 'sources' | 'events', text, changed }.
 * Only values the checker derived go in: slugs that match SLUG, an https URL, a region id.
 */
export function applyPlan(plan, files) {
  const out = (file, cfg, changed) => ({ file, text: changed ? `${JSON.stringify(cfg, null, 2)}\n` : files[file], changed });
  if (plan.type === 'events') {
    const cfg = JSON.parse(files.events);
    const u = new URL(plan.url);
    if (u.protocol !== 'https:') throw new RangeError('not an https link');
    const name = u.hostname.replace(/^www\./, '');
    const all = cfg.sources.flatMap((s) => s.urls ?? []).map((x) => x.replace(/\/+$/, '').toLowerCase());
    if (all.includes(plan.url.replace(/\/+$/, '').toLowerCase())) return out('events', cfg, false);
    let src = cfg.sources.find((s) => s.region === plan.region && s.added && s.name === name);
    if (!src) cfg.sources.push(src = { id: `added-${name.replace(/[^a-z0-9]+/g, '-')}-${plan.region}`, name, region: plan.region, added: true, urls: [] });
    src.urls.push(plan.url);
    return out('events', cfg, true);
  }
  if (!SLUG.test(plan.slug ?? '')) throw new RangeError(`not an account name: ${plan.slug}`);
  const cfg = JSON.parse(files.sources);
  const dflt = cfg.defaults?.sport ?? 'volleyball';
  const mine = (adapter, test = () => true) => cfg.sources.find((s) => s.adapter === adapter && (s.sport ?? dflt) === plan.sport && test(s));
  const fresh = (id, name, adapter, cadence, options) => { const s = { id: `${id}-${plan.region}${plan.sport === dflt ? '' : `-${plan.sport}`}`, name, adapter, cadence, ...(plan.sport === dflt ? {} : { sport: plan.sport }), options }; if (cfg.sources.some((x) => x.id === s.id)) throw new Error(`config already has a source "${s.id}"`); cfg.sources.push(s); return s; };
  const city = plan.city;
  if (plan.type === 'reclub') {
    const url = `https://reclub.co/clubs/@${plan.slug}`;
    const src = mine('reclub') ?? fresh('reclub', 'Reclub clubs', 'reclub', '1h', { clubs: [], venues: [], fallbackVenue: { ...(city ? { city } : {}), surface: null } });
    if (src.options.clubs.some((c) => c.toLowerCase() === url.toLowerCase())) return out('sources', cfg, false);
    src.options.clubs.push(url);
    return out('sources', cfg, true);
  }
  if (plan.type === 'sweatpals') {
    const src = mine('sweatpals') ?? fresh('sweatpals', 'Sweatpals', 'sweatpals', '1h', { hosts: [], include: SPORT_WORDS[plan.sport] ?? plan.sport, venues: [], fallbackVenue: { ...(city ? { city } : {}), surface: null } });
    if (src.options.hosts.some((h) => String(h.slug).toLowerCase() === plan.slug.toLowerCase())) return out('sources', cfg, false);
    src.options.hosts.push({ slug: plan.slug });
    return out('sources', cfg, true);
  }
  if (plan.type === 'meetup') {
    const url = meetupFeed(plan.slug);
    const src = mine('ical', (s) => (s.options?.feeds ?? []).every((f) => /meetup\.com/.test(f.url ?? ''))) ?? fresh('meetup', 'Meetup groups', 'ical', '6h', { feeds: [] });
    if (src.options.feeds.some((f) => f.url.toLowerCase() === url.toLowerCase())) return out('sources', cfg, false);
    src.options.feeds.push({ url, idPrefix: `meetup-${plan.slug.toLowerCase().slice(0, 24)}`, host: plan.name ?? plan.slug, ...(city ? { city } : {}), ...(plan.include ? { include: plan.include } : {}) });
    return out('sources', cfg, true);
  }
  throw new RangeError(`unknown plan: ${plan.type}`);
}
