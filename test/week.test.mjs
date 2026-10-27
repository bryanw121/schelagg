// public/week.js: the day strip's two calendar weeks, starting on Sunday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendar, weekOf, moveWeek, swipeDirection } from '../public/week.js';

test('the strip starts on the Sunday of the current week, whatever day today is', () => {
  // Tue Oct 27, 2026
  const tue = calendar('2026-10-27');
  assert.equal(tue.days.length, 14);
  assert.deepEqual([tue.days[0], tue.days[6], tue.days[7], tue.days[13]], ['2026-10-25', '2026-10-31', '2026-11-01', '2026-11-07']);
  assert.equal(tue.days[tue.today], '2026-10-27');
  assert.equal(tue.today, 2);
  // Sunday: today is the first day.
  assert.equal(calendar('2026-10-25').today, 0);
  assert.equal(calendar('2026-10-25').days[0], '2026-10-25');
  // Saturday: next week still gives a full Sun–Sat ahead.
  const sat = calendar('2026-10-31');
  assert.deepEqual([sat.days[0], sat.today, sat.days[13]], ['2026-10-25', 6, '2026-11-07']);
});

test('the strip crosses month, year and the DST change without drifting', () => {
  assert.deepEqual(calendar('2026-11-01').days.slice(0, 2), ['2026-11-01', '2026-11-02']); // DST ends that morning
  const nye = calendar('2026-12-31'); // Thursday
  assert.equal(nye.days[0], '2026-12-27');
  assert.equal(nye.days[13], '2027-01-09');
  assert.equal(calendar('2027-03-14').days[0], '2027-03-14'); // DST starts
});

test('every day shown is within the 14 days the scrape collects', () => {
  for (let d = 25; d <= 31; d++) {
    const today = `2026-10-${d}`;
    const { days, today: t } = calendar(today);
    const ahead = days.length - 1 - t;
    assert.ok(ahead >= 7 && ahead <= 13, `${today}: ${ahead} days ahead`);
  }
});

test('moving weeks keeps the weekday, never lands before today, and stops at the ends', () => {
  assert.equal(weekOf(0), 0);
  assert.equal(weekOf(9), 1);
  // Today is Tuesday (2). Thursday this week -> Thursday next week and back.
  assert.equal(moveWeek({ di: 4, delta: 1, today: 2 }), 11);
  assert.equal(moveWeek({ di: 11, delta: -1, today: 2 }), 4);
  // Monday next week -> back to this week would be yesterday: today instead.
  assert.equal(moveWeek({ di: 8, delta: -1, today: 2 }), 2);
  // No week before the first or after the last.
  assert.equal(moveWeek({ di: 3, delta: -1, today: 2 }), null);
  assert.equal(moveWeek({ di: 10, delta: 1, today: 2 }), null);
});

test('only a mostly sideways swipe changes the week', () => {
  assert.equal(swipeDirection(-80, 5), -1);
  assert.equal(swipeDirection(90, -10), 1);
  assert.equal(swipeDirection(-20, 0), 0); // too short: a tap
  assert.equal(swipeDirection(-60, 70), 0); // mostly vertical: scrolling the page
});
