// What the sources page (public/sources.html) shows about each source: a link to the source's own
// site, the pages or groups it reads (Meetup groups, Reclub clubs), and a plain description of
// what kind of source it is. Taken from config: `site` when a source sets it, else the first URL
// in its options. Shared by the schedule pipeline and the programs feed.

/** Plain-language kind for each adapter / reader id. */
export const KINDS = {
  reclub: 'Reclub club pages', ical: 'Meetup group calendars', leagueapps: 'LeagueApps event pages',
  active: 'City recreation programs (ACTIVE)', sportsgarden: "Venue's open-play hours page", foro: "Venue's open-play hours page",
  volleyworld: "Venue's schedule page", velocity: "Venue's schedule page", atxbeach: "Venue's schedule page",
  aces: 'Organizer calendar', sweatpals: 'Sweatpals host pages', 'openplay-directory': 'OpenPlay club directory',
  opencourt: 'OpenCourt booking calendar', daysmart: 'Rink schedule (DaySmart)', 'austin-pickleball': 'City parks schedule',
  'official-schedule': 'City parks schedule', leaguelab: 'League sign-up pages (LeagueLab)', nagva: 'NAGVA tournament list',
  texasao: 'Texas Asian Olympics page', vex: "Organizer's own site",
};

const isUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v);
/** A Reclub club's name from its address: "@ync-volleyball-dallas-texas-usa-95" -> "YNC Volleyball". */
export function clubName(u) {
  const slug = u.replace(/\/$/, '').split('@').pop().replace(/-(?:[a-z]+-)?texas-usa(?:-\d+)?$/, '').replace(/_/g, '-');
  return slug.split('-').filter(Boolean).map((w) => (w.length <= 3 && /^[^aeiou]+$/.test(w) && !['gym', 'by', 'my'].includes(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

/** The pages or groups a source reads, as [{ name, url }] (empty when it reads one site). */
export function sourceLinks(options = {}) {
  if (options.feeds) return options.feeds.map((f) => ({ name: f.host ?? new URL(f.url).hostname, url: f.url.replace(/events\/ical\/?$/, '') }));
  if (options.clubs?.length > 1) return options.clubs.map((u) => ({ name: clubName(u), url: u }));
  if (options.series) return options.series.map((x) => ({ name: x.title ?? x.host ?? 'Events', url: x.url }));
  if (options.sites?.length > 1) return options.sites.map((x) => ({ name: x.org ?? new URL(x.url).hostname, url: x.url }));
  if (options.hosts?.length > 1) return options.hosts.map((h) => (typeof h === 'string' ? { name: h, url: `https://sweatpals.com/host/${h}` } : { name: h.name ?? h.slug, url: h.url ?? `https://sweatpals.com/host/${h.slug}` }));
  return [];
}

/** The first URL anywhere in an options object (depth-first, in key order). */
function firstUrl(v) {
  if (isUrl(v)) return v;
  if (Array.isArray(v)) { for (const x of v) { const u = firstUrl(x); if (u) return u; } return null; }
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (k === 'discover' || k.startsWith('_')) continue; const u = firstUrl(x); if (u) return u; } }
  return null;
}

/** The link shown for a source: its `site`, else the first URL in its options. */
export function sourceSite(config) {
  if (isUrl(config.site)) return config.site;
  const u = firstUrl(config.options ?? {});
  return u ? u.replace(/events\/ical\/?$/, '') : null;
}

/** The fields the sources page needs, for a source's published status. */
export function sourceInfo(config, kindId) {
  const links = sourceLinks(config.options ?? {});
  return { kind: config.kind ?? KINDS[kindId] ?? null, site: sourceSite(config), ...(links.length ? { links } : {}) };
}
