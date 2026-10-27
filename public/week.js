// The day strip's calendar: two weeks that start on the Sunday of the current week (in Austin),
// so the strip reads Sun–Sat like a calendar instead of starting on today. Days before today
// are shown but can't be picked (past sessions aren't in the data). Pure, so it is unit-tested
// in test/week.test.mjs; app.js imports it in the browser.

export const WEEKS = 2;

const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dowOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/**
 * The strip for `today` (YYYY-MM-DD): { days, today, weeks } where `days` is 7 * weeks dates from
 * the Sunday on or before today and `today` is today's index in it. With two weeks this always
 * shows at least 8 days ahead (today is at most index 6), and never more than 13, so it stays
 * inside the 14 days the scrape collects.
 */
export function calendar(today, weeks = WEEKS) {
  const sunday = addDays(today, -dowOf(today));
  const days = Array.from({ length: 7 * weeks }, (_, i) => addDays(sunday, i));
  return { days, today: dowOf(today), weeks };
}

/** Which week (0-based) a day index is in. */
export const weekOf = (i) => Math.floor(i / 7);

/**
 * The day to select after moving `delta` weeks from day `di`: the same weekday in the new week,
 * clamped so it's never before today or past the last day. Returns null when there's no such
 * week (the strip stays where it is).
 */
export function moveWeek({ di, delta, today, weeks = WEEKS }) {
  const week = weekOf(di) + delta;
  if (week < 0 || week >= weeks) return null;
  return Math.min(Math.max(di + delta * 7, today), weeks * 7 - 1);
}

/** A horizontal swipe of at least `min` px that is mostly sideways: -1 (to the next week), 1 (back), or 0. */
export function swipeDirection(dx, dy, min = 40) {
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? -1 : 1;
}
