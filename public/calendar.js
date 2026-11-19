// Add to calendar: one event or one session as a Google Calendar link or an .ics file (Apple
// Calendar, Outlook and anything else that opens one). Pure; the page builds the item.
//
// item: { title, date, endDate?, start?, end?, tz, location?, url?, details? }
//   date / endDate "YYYY-MM-DD", start / end "HH:MM" local to tz (an IANA zone).

const ymd = (iso) => iso.replaceAll('-', '');
const hms = (t) => `${t.replace(':', '')}00`;
const nextDay = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const plusHour = (t) => { const [h, m] = t.split(':').map(Number); return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

/**
 * When it is on the calendar: a timed block for something on one day with a start time (no end:
 * an hour; an end at or before the start: it runs past midnight), otherwise whole days (an end
 * date is inclusive here and exclusive in the calendar formats, hence the extra day).
 */
export function calendarSpan(item) {
  const oneDay = !item.endDate || item.endDate === item.date;
  if (item.start && oneDay) {
    const end = item.end ?? plusHour(item.start);
    const endDate = end <= item.start ? nextDay(item.date) : item.date;
    return { allDay: false, from: `${ymd(item.date)}T${hms(item.start)}`, to: `${ymd(endDate)}T${hms(end)}` };
  }
  return { allDay: true, from: ymd(item.date), to: ymd(nextDay(item.endDate ?? item.date)) };
}
const addMin = (t, n) => { const [h, m] = t.split(':').map(Number); const v = Math.min(h * 60 + m + n, 23 * 60 + 59); return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
/**
 * One visit to something that runs for days: that day only, from the time given for two hours
 * (or until it closes, when that is sooner); no time makes it that whole day.
 */
export function visitItem(item, date, time) {
  const { endDate, ...rest } = item;
  if (!time) return { ...rest, date, start: undefined, end: undefined };
  const two = addMin(time, 120);
  return { ...rest, date, start: time, end: item.end && item.end > time && item.end < two ? item.end : two };
}
/** Details as the calendar entry shows them: the item's own note, then where to find out more. */
const detailsOf = (item) => [item.details, item.url ? `More: ${item.url}` : ''].filter(Boolean).join('\n\n');

/** Google Calendar's "new event" page, filled in. */
export function googleCalendarUrl(item) {
  const s = calendarSpan(item);
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', item.title);
  u.searchParams.set('dates', `${s.from}/${s.to}`);
  if (!s.allDay && item.tz) u.searchParams.set('ctz', item.tz);
  if (detailsOf(item)) u.searchParams.set('details', detailsOf(item));
  if (item.location) u.searchParams.set('location', item.location);
  return u.href;
}

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines over 75 bytes are folded, as the format asks. */
const fold = (line) => { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; } out.push(rest); return out.join('\r\n'); };
/** A one-event .ics file. `uid` keeps a second add from making a duplicate in calendars that honour it. */
export function icsFile(item, { uid, now = new Date() } = {}) {
  const s = calendarSpan(item);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Skelly//Add to calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${esc(uid ?? `${s.from}-${item.title}`)}@skelly`, `DTSTAMP:${stamp}`,
    s.allDay ? `DTSTART;VALUE=DATE:${s.from}` : `DTSTART;TZID=${item.tz}:${s.from}`,
    s.allDay ? `DTEND;VALUE=DATE:${s.to}` : `DTEND;TZID=${item.tz}:${s.to}`,
    `SUMMARY:${esc(item.title)}`,
    item.location ? `LOCATION:${esc(item.location)}` : null,
    detailsOf(item) ? `DESCRIPTION:${esc(detailsOf(item))}` : null,
    item.url ? `URL:${item.url}` : null,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.filter(Boolean).map(fold).join('\r\n')}\r\n`;
}
/** A safe file name for the download: "night-market.ics". */
export const icsName = (title) => `${String(title ?? 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'event'}.ics`;
