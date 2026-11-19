// Coverage: which venues the schedule knows only second-hand. A session posted by a group on a
// shared platform (Reclub, Sweatpals, Meetup, a club directory) names the gym or court it is held
// at; when no source reads that venue's own schedule and it has no booking link, the venue is a
// lead: its own site may list open play or court rentals we don't have. Pure; scripts/coverage.mjs
// runs it over the published schedules.

/** Adapters that read groups hosting at someone else's venue, not the venue's own calendar. */
export const HOSTED_ADAPTERS = new Set(['reclub', 'sweatpals', 'ical', 'openplay-directory']);

/**
 * @param schedule a region's schedule.json ({ sessions, venues })
 * @param sources  the region's sources.json entries ([{ id, adapter }])
 * @returns [{ venue, city, sport, sessions, via: [source ids], pinned, booking, lead }] busiest first;
 *          `lead` is true when the venue is seen only through hosted adapters and has no booking link.
 */
export function venueCoverage(schedule, sources) {
  const adapterOf = new Map((sources ?? []).map((s) => [s.id, s.adapter]));
  const venueById = new Map((schedule?.venues ?? []).map((v) => [v.id, v]));
  const rows = new Map();
  for (const x of schedule?.sessions ?? []) {
    const name = (x.venue ?? '').trim();
    if (!name) continue;
    const sport = x.sport ?? 'volleyball';
    const key = `${sport}|${name.toLowerCase()}`;
    const v = venueById.get(x.venueId);
    const row = rows.get(key) ?? rows.set(key, { venue: name, city: x.city ?? v?.city ?? '', sport, sessions: 0, via: new Set(), pinned: Number.isFinite(v?.lat), booking: !!v?.bookingLink, own: false }).get(key);
    row.sessions += 1;
    row.via.add(x.sourceId);
    if (!HOSTED_ADAPTERS.has(adapterOf.get(x.sourceId))) row.own = true;
  }
  return [...rows.values()]
    .map(({ own, via, ...r }) => ({ ...r, via: [...via].sort(), lead: !own && !r.booking }))
    .sort((a, b) => Number(b.lead) - Number(a.lead) || b.sessions - a.sessions || a.venue.localeCompare(b.venue));
}

/** The report as Markdown: per region, the leads first, then what is already read directly. */
export function coverageMarkdown(regions) {
  const out = ['# Venue coverage', '', 'Venues the schedule sees only through groups that host there (Reclub, Sweatpals, Meetup, club directories). Each is a lead: check its own site for open play or court rentals.', ''];
  for (const { name, rows } of regions) {
    const leads = rows.filter((r) => r.lead), direct = rows.length - leads.length;
    out.push(`## ${name}`, '', `${rows.length} venues with sessions: ${direct} read directly or bookable, ${leads.length} second-hand only.`, '');
    if (leads.length) {
      out.push('| Venue | City | Sport | Sessions | Seen via | Pin |', '|---|---|---|---|---|---|');
      for (const r of leads) out.push(`| ${r.venue.replace(/\|/g, '/')} | ${r.city} | ${r.sport} | ${r.sessions} | ${r.via.join(', ')} | ${r.pinned ? 'yes' : 'no'} |`);
      out.push('');
    }
  }
  return `${out.join('\n')}\n`;
}
