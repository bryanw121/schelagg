// "When are you free?": a time-of-day window (minutes from midnight, { from, to }) that the
// Events list and the Sports day list each filter by. Pure, shared by the page and its tests.

export const TIME_PRESETS = [
  { id: 'morning', label: 'Morning', hint: 'before noon', from: 0, to: 720 },
  { id: 'afternoon', label: 'Afternoon', hint: 'noon to 5pm', from: 720, to: 1020 },
  { id: 'evening', label: 'Evening', hint: 'after 5pm', from: 1020, to: 1440 },
];

/** "14:30" -> 870; anything else -> null. */
export function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ''));
  if (!m || +m[1] > 24 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
const pad = (n) => String(n).padStart(2, '0');
/** 870 -> "14:30" (1440 -> "24:00", the end of the day). */
export const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
/** 870 -> "2:30pm"; 0 and 1440 -> "midnight"; 720 -> "noon". */
export function clockLabel(min) {
  if (min === 0 || min === 1440) return 'midnight';
  if (min === 720) return 'noon';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ''}${h >= 12 ? 'pm' : 'am'}`;
}

/** A window from two "HH:MM" strings (a link's ?from= and ?to=). A missing side is the day's edge; nonsense is no window. */
export function parseWindow(from, to) {
  const f = toMin(from), t = toMin(to);
  if (f == null && t == null) return null;
  const win = { from: f ?? 0, to: t ?? 1440 };
  return win.from < win.to ? win : null;
}
export const presetOf = (win) => (win ? TIME_PRESETS.find((p) => p.from === win.from && p.to === win.to) ?? null : null);
/** "Afternoon", or "2pm–6pm" for a window of one's own. */
export function windowLabel(win) {
  if (!win) return 'Any time';
  return presetOf(win)?.label ?? `${clockLabel(win.from)}–${clockLabel(win.to)}`;
}

/** Start and end in minutes; an end at or before the start is past midnight; no end counts as an hour. */
function span(start, end) {
  const s = toMin(start);
  if (s == null) return null;
  let e = toMin(end) ?? s + 60;
  if (e <= s) e += 1440;
  return { s, e };
}
/** Does something with these hours overlap the window? Hours not listed: yes (it's on that day; the row says so). */
export function inWindow(start, end, win) {
  if (!win) return true;
  const x = span(start, end);
  return !x || (x.s < win.to && x.e > win.from);
}
/** What a row should say about the window: '' when it sits inside, else what sticks out. */
export function windowNote(start, end, win) {
  if (!win) return '';
  const x = span(start, end);
  if (!x) return 'Hours not listed';
  const early = x.s < win.from, late = x.e > win.to && win.to < 1440;
  if (early && late) return `Runs ${clockLabel(x.s)} to ${clockLabel(x.e % 1440)}`;
  if (early) return `Started at ${clockLabel(x.s)}`;
  if (late) return `Runs past ${clockLabel(win.to)}`;
  return '';
}
