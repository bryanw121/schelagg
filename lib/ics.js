// Calendar subscriptions (#20): one iCalendar file per sport from the feed's occurrences, so
// people can subscribe in Google / Apple / Outlook calendars. Cancelled sessions stay in the file
// with STATUS:CANCELLED (calendar apps show them struck through) rather than vanishing, and a
// rescheduled one keeps its UID so subscribers see it move. Pure; RFC 5545 text rules.

const CRLF = '\r\n';
const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Escape a TEXT value (backslash, semicolon, comma, newline). */
export const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line at 75 octets (continuation lines start with a space), never splitting a UTF-8 character. */
export function fold(line) {
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  if (bytes(line) <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    const limit = out.length ? 74 : 75; // continuation lines lose one octet to the leading space
    if (bytes(cur + ch) > limit) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join(`${CRLF} `);
}

/** One VEVENT's lines for a feed occurrence. */
function event(o, generatedAt) {
  const status = o.status === 'cancelled' || o.canceled ? 'CANCELLED' : 'CONFIRMED';
  const where = [o.venue, o.city].filter(Boolean).join(', ');
  const details = [
    o.status === 'rescheduled' && o.previous_starts_at ? `Moved from ${o.previous_starts_at}.` : null,
    o.price ? `Price: ${o.price}` : null,
    o.note,
    o.signup_url ? `${o.signup_label || 'Sign up'}: ${o.signup_url}` : null,
    'From Schelagg; times change, check the source before you go.',
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${o.id}@schelagg`,
    `DTSTAMP:${stamp(generatedAt)}`,
    `DTSTART:${stamp(o.starts_at)}`,
    o.ends_at ? `DTEND:${stamp(o.ends_at)}` : null,
    `SUMMARY:${escapeText(status === 'CANCELLED' ? `Cancelled: ${o.title}` : o.title)}`,
    where ? `LOCATION:${escapeText(where)}` : null,
    `DESCRIPTION:${escapeText(details)}`,
    o.signup_url ? `URL:${o.signup_url}` : null,
    `STATUS:${status}`,
    'END:VEVENT',
  ];
  return lines.filter(Boolean);
}

/** occurrences (feed items, any sports) -> an .ics calendar for one sport. `timezone` is the calendar's display zone. */
export function toIcs(occurrences, { sport, name, generatedAt, timezone = 'America/Chicago' }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Schelagg//Schedules//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${timezone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...occurrences.filter((o) => o.sport === sport).flatMap((o) => event(o, generatedAt)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}

/** How a sport reads in a calendar's name; a sport not listed gets its id. */
export const SPORT_LABELS = { volleyball: 'volleyball', ice_skating: 'public skating' };
/** A calendar's name: "Schelagg · Austin volleyball", or without a region "Schelagg · volleyball". */
export const calendarName = (sport, regionName) => `Schelagg · ${[regionName?.split(',')[0], SPORT_LABELS[sport] ?? sport].filter(Boolean).join(' ')}`;
