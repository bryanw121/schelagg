import test from 'node:test';
import assert from 'node:assert/strict';
import { TIME_PRESETS, clockLabel, inWindow, parseWindow, presetOf, toHHMM, toMin, windowLabel, windowNote } from '../public/when.js';
import { filterEvents } from '../public/events-ui.js';

test('when: windows parse from link values, and nonsense is no window', () => {
  assert.deepEqual(parseWindow('14:00', '18:00'), { from: 840, to: 1080 });
  assert.deepEqual(parseWindow('14:00', null), { from: 840, to: 1440 }, 'from 2pm on');
  assert.deepEqual(parseWindow('', '12:00'), { from: 0, to: 720 }, 'until noon');
  assert.equal(parseWindow(null, null), null);
  assert.equal(parseWindow('18:00', '14:00'), null, 'backwards');
  assert.equal(parseWindow('2pm', 'x'), null);
  assert.equal(toMin('25:00'), null);
  assert.equal(toHHMM(1440), '24:00');
});

test('when: labels', () => {
  assert.equal(windowLabel(null), 'Any time');
  assert.equal(windowLabel(TIME_PRESETS[1]), 'Afternoon');
  assert.equal(presetOf({ from: 1020, to: 1440 }).id, 'evening');
  assert.equal(windowLabel({ from: 840, to: 1080 }), '2pm–6pm');
  assert.equal(clockLabel(870), '2:30pm');
  assert.equal(clockLabel(720), 'noon');
});

test('when: what overlaps the window, and what each row says', () => {
  const win = { from: 840, to: 1080 }; // 2pm to 6pm
  assert.equal(inWindow('15:00', '17:00', win), true);
  assert.equal(windowNote('15:00', '17:00', win), '', 'inside: nothing to say');
  assert.equal(inWindow('17:00', '19:00', win), true);
  assert.equal(windowNote('17:00', '19:00', win), 'Runs past 6pm');
  assert.equal(windowNote('10:00', '15:00', win), 'Started at 10am');
  assert.equal(windowNote('10:00', '20:00', win), 'Runs 10am to 8pm');
  assert.equal(inWindow('18:00', '20:00', win), false, 'starts as the window ends');
  assert.equal(inWindow('09:00', '14:00', win), false, 'ends as the window starts');
  assert.equal(inWindow(null, null, win), true, 'no hours listed: still on that day');
  assert.equal(windowNote(null, null, win), 'Hours not listed');
  assert.equal(inWindow('17:30', null, win), true, 'no end: counts as an hour');
  assert.equal(inWindow('22:00', '01:00', { from: 1020, to: 1440 }), true, 'past midnight');
  assert.equal(windowNote('22:00', '01:00', { from: 1020, to: 1440 }), '', 'evening has no end to run past');
  assert.equal(inWindow('09:00', '10:00', null), true);
});

test('filterEvents: a day and a time window', () => {
  const feed = [
    { title: 'Long', startDate: '2026-11-10', endDate: '2026-11-29' },
    { title: 'Sat day', startDate: '2026-11-21', startTime: '10:00', endTime: '13:00' },
    { title: 'Sat eve', startDate: '2026-11-21', startTime: '18:00', endTime: '22:00' },
    { title: 'Sun', startDate: '2026-11-22', startTime: '18:00' },
  ];
  assert.deepEqual(filterEvents(feed, { day: '2026-11-21' }, '2026-11-18').map((e) => e.title), ['Long', 'Sat day', 'Sat eve']);
  assert.deepEqual(filterEvents(feed, { day: '2026-11-21', window: { from: 1020, to: 1440 } }, '2026-11-18').map((e) => e.title), ['Long', 'Sat eve']);
  assert.deepEqual(filterEvents(feed, { window: { from: 0, to: 720 } }, '2026-11-18').map((e) => e.title), ['Long', 'Sat day']);
});
