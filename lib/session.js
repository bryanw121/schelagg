// The normalized session every adapter produces, and the checks every session
// must pass before it's published. One bad record shouldn't reach the site or
// any consumer, so failures are dropped and reported as source warnings.
//
// Schema v2 adds sport / region / timezone (stamped from the source config, so
// adapters don't repeat them). Sport-specific details stay as top-level fields
// for now (volleyball: surface, level, type); a second sport would add its own.
export const SCHEMA_VERSION = 2;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sport-specific metadata consumers filter on. Unknown values are kept but
 * flagged, so a scraper that starts emitting e.g. "beach" gets noticed before
 * consumers silently drop it from a filter.
 */
export const SPORT_ATTRIBUTES = {
  volleyball: {
    surface: ['indoor', 'sand', 'grass'],
    type: ['Open play', 'Training', 'League', 'Tournament', 'Clinic'],
  },
};
const TIME = /^\d{2}:\d{2}$/;

/** Stamp where a session came from and what it is. Adapter values win over config. */
export function tagSession(raw, src) {
  return {
    ...raw,
    sourceId: src.id,
    sport: raw.sport ?? src.sport,
    region: raw.region ?? src.region,
    timezone: raw.timezone ?? src.timezone,
  };
}

/**
 * Problems with one session. `errors` make it unpublishable (malformed data a
 * consumer would choke on); `notes` are worth fixing at the source but the
 * session is still shown (e.g. an unknown venue name).
 */
export function sessionProblems(s) {
  const errors = [], notes = [];
  for (const k of ['id', 'title', 'sport', 'region', 'timezone', 'sourceId']) {
    if (typeof s[k] !== 'string' || !s[k].trim()) errors.push(`missing ${k}`);
  }
  if (!s.date && !(Array.isArray(s.days) && s.days.length)) errors.push('needs a date or recurring days');
  if (s.date && !DATE.test(s.date)) errors.push(`bad date "${s.date}"`);
  for (const k of ['start', 'end']) if (s[k] != null && !TIME.test(s[k])) errors.push(`bad ${k} "${s[k]}"`);
  const link = s.signup?.url ?? s.source;
  if (link != null && !/^https?:\/\//.test(link)) errors.push(`bad link "${link}"`);
  if (!s.venue) notes.push('no venue name');
  for (const [k, allowed] of Object.entries(SPORT_ATTRIBUTES[s.sport] ?? {})) {
    if (s[k] == null) notes.push(`no ${k}`);
    else if (!allowed.includes(s[k])) notes.push(`unknown ${k} "${s[k]}"`);
  }
  return { errors, notes };
}

/** Drop unpublishable sessions; describe what was dropped or needs a look. */
export function validateSessions(sessions) {
  const ok = [], warnings = [];
  for (const s of sessions) {
    const { errors, notes } = sessionProblems(s);
    if (errors.length) { warnings.push(`dropped ${s.id ?? '(no id)'}: ${errors.join(', ')}`); continue; }
    if (notes.length) warnings.push(`${s.id}: ${notes.join(', ')}`);
    ok.push(s);
  }
  return { ok, warnings };
}
