// Date helpers that always work in Austin time, whatever timezone the server runs in.
export const TZ = 'America/Chicago';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Today's date as YYYY-MM-DD in a time zone (Austin unless a source says otherwise). */
export function today(now = new Date(), timeZone = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** Add n days to a YYYY-MM-DD string. */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
/** Day of week for a YYYY-MM-DD string: 0 = Sunday. */
export function dow(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const dowName = (iso) => DOW[dow(iso)];
/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 864e5);
}
export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** "7:30 PM" / "7 PM" / "7PM" -> "19:30" */
export function to24(s) {
  const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?$/);
  if (!m) return null;
  let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
}
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
/** Resolve "Oct 26" / "OCTOBER 26" to the nearest YYYY-MM-DD on or after ~2 months ago. */
export function resolveMonthDay(monthName, day, ref = today()) {
  const mi = MONTHS.findIndex((m) => m.startsWith(monthName.toLowerCase().slice(0, 3)));
  if (mi < 0) return null;
  let y = +ref.slice(0, 4);
  let iso = `${y}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (daysBetween(ref, iso) < -60) iso = `${y + 1}${iso.slice(4)}`;
  return iso;
}
