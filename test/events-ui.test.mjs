// The Events view's pure helpers (public/events-ui.js): pagination, date ranges, place lines,
// map places, month groups, and the Sports dropdown's state. Nothing here touches the DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAT_COLOR, CAT_LABEL, EVENT_CATS, EVENTS_PER_PAGE, clampPage, countByCategory, dropdownNext,
  eventDateRange, eventPinName, eventPlaceParts, eventPlaces, groupByMonth, isEventCat,
  paginate, sortEvents,
} from '../public/events-ui.js';

const ev = (over = {}) => ({ id: 'evt-x', category: 'seasonal', title: 'T', venue: 'V', city: 'Austin', startDate: '2026-12-05', ...over });
const twelve = Array.from({ length: 12 }, (_, i) => ev({ id: `evt-${i}`, title: `Event ${String(i + 1).padStart(2, '0')}`, startDate: `2026-11-${String(10 + i).padStart(2, '0')}` }));

test('paginate: 10 per page, clamped, with Showing numbers', () => {
  assert.equal(EVENTS_PER_PAGE, 10);
  const p1 = paginate(twelve, 1);
  assert.deepEqual([p1.items.length, p1.page, p1.pageCount, p1.total, p1.start, p1.end], [10, 1, 2, 12, 1, 10]);
  const p2 = paginate(twelve, 2);
  assert.deepEqual([p2.items.length, p2.page, p2.start, p2.end], [2, 2, 11, 12]);
  assert.equal(paginate(twelve, 0).page, 1, 'page 0 clamps to 1');
  assert.equal(paginate(twelve, 99).page, 2, 'past the end clamps to the last page');
  assert.equal(paginate(twelve, NaN).page, 1);
  const empty = paginate([], 3);
  assert.deepEqual([empty.items, empty.page, empty.pageCount, empty.total, empty.start, empty.end], [[], 1, 0, 0, 0, 0]);
  assert.equal(clampPage(5, 3), 3);
  assert.equal(clampPage(0, 3), 1);
  assert.equal(clampPage(2, 0), 1, 'no pages yet: page 1');
});

test('sortEvents: soonest first, ties by title', () => {
  const sorted = sortEvents([ev({ title: 'B', startDate: '2026-12-05' }), ev({ title: 'A', startDate: '2026-12-05' }), ev({ title: 'C', startDate: '2026-11-12' })]);
  assert.deepEqual(sorted.map((e) => e.title), ['C', 'A', 'B']);
});

test('countByCategory: each chip and the total', () => {
  assert.deepEqual(countByCategory([
    ev({ category: 'popup' }), ev({ category: 'popup' }), ev({ category: 'seasonal' }), ev({ category: 'asian-inspired' }),
  ]), { all: 4, popup: 2, seasonal: 1, 'asian-inspired': 1 });
  assert.deepEqual(countByCategory([]), { all: 0, popup: 0, seasonal: 0, 'asian-inspired': 0 });
  assert.deepEqual(EVENT_CATS.map((c) => c.id), ['all', 'popup', 'seasonal', 'asian-inspired']);
  assert.equal(isEventCat('popup'), true);
  assert.equal(isEventCat('nope'), false);
  assert.deepEqual(CAT_LABEL, { popup: 'Pop-up', seasonal: 'Seasonal', 'asian-inspired': 'Asian-inspired' });
  assert.deepEqual(CAT_COLOR, { popup: 'var(--indoor)', seasonal: 'var(--grass)', 'asian-inspired': 'var(--changed)' });
});

test('eventDateRange: one day, same month, across months, across years', () => {
  assert.equal(eventDateRange(ev({ startDate: '2026-12-05' })), 'Sat, Dec 5');
  assert.equal(eventDateRange(ev({ startDate: '2026-11-12', endDate: '2026-11-23' })), 'Nov 12 – 23');
  assert.equal(eventDateRange(ev({ startDate: '2026-11-12', endDate: '2026-12-30' })), 'Nov 12 – Dec 30');
  assert.equal(eventDateRange(ev({ startDate: '2026-11-21', endDate: '2027-01-03' })), 'Nov 21 – Jan 3');
  assert.equal(eventDateRange(ev({ startDate: '2026-12-05', endDate: '2026-12-05' })), 'Sat, Dec 5', 'a one-day range is one day');
});

test('eventPlaceParts: venue, area, city — without repeating a part the venue already names', () => {
  assert.deepEqual(eventPlaceParts(ev({ venue: '1209 E Cesar Chavez St', area: 'East Austin', city: 'Austin' })), ['1209 E Cesar Chavez St', 'East Austin'], 'East Austin already says Austin');
  assert.deepEqual(eventPlaceParts(ev({ venue: 'The Eleanor, 307 W 5th St', area: 'Downtown', city: 'Austin' })), ['The Eleanor, 307 W 5th St', 'Downtown', 'Austin']);
  assert.deepEqual(eventPlaceParts(ev({ venue: 'Vista Brewing, 13551 FM 150 W, Driftwood', area: 'Driftwood', city: 'Driftwood' })), ['Vista Brewing, 13551 FM 150 W, Driftwood']);
  assert.deepEqual(eventPlaceParts(ev({ venue: 'Zilker Park', city: 'Austin' })), ['Zilker Park', 'Austin']);
  assert.deepEqual(eventPlaceParts(ev({ venue: 'Wingman Kitchens', city: undefined })), ['Wingman Kitchens']);
});

test('eventPinName: the name before the address; the whole string when that is all there is', () => {
  assert.equal(eventPinName('Palmer Events Center, 900 Barton Springs Rd'), 'Palmer Events Center');
  assert.equal(eventPinName('Zilker Park'), 'Zilker Park');
  assert.equal(eventPinName('1209 E Cesar Chavez St'), '1209 E Cesar Chavez St');
});

test('eventPlaces: one pin per venue, grouped; happening now and the next date', () => {
  const places = eventPlaces([
    ev({ title: 'A Christmas Affair', venue: 'Palmer Events Center, 900 Barton Springs Rd', area: 'Zilker', startDate: '2026-11-19', endDate: '2026-11-22', lat: 30.26, lng: -97.77 }),
    ev({ title: 'Armadillo Christmas Bazaar', venue: 'Palmer Events Center, 900 Barton Springs Rd', area: 'Zilker', startDate: '2026-12-12', endDate: '2026-12-21', price: '$15', lat: 30.26, lng: -97.77 }),
    ev({ title: 'Flower Shop', venue: '1209 E Cesar Chavez St', area: 'East Austin', startDate: '2026-11-12', endDate: '2026-11-23', lat: 30.25979, lng: -97.7325 }),
    ev({ title: 'No point', venue: 'Nowhere' }),
  ], '2026-11-17');
  assert.equal(places.length, 2, 'the unlocated event has no pin');
  const palmer = places.find((p) => p.name.startsWith('Palmer'));
  assert.equal(palmer.events.length, 2, 'both events at the same venue share the pin');
  assert.equal(palmer.short, 'Palmer Events Center');
  assert.equal(palmer.city, 'Zilker · Austin');
  assert.equal(palmer.status, '2 events · next Nov 19');
  assert.equal(palmer.aria, 'Palmer Events Center, 900 Barton Springs Rd: 2 events · next Nov 19');
  assert.deepEqual(palmer.sessions, [], 'the shared map machinery reads .sessions');
  assert.equal(palmer.done, false);
  const flower = places.find((p) => p.name.startsWith('1209'));
  assert.equal(flower.status, 'Happening now · 1 event', 'Nov 12–23 covers Nov 17');
  assert.equal(flower.short, '1209 E Cesar Chavez St');
});

test('groupByMonth: the page\'s events under month headers, in order', () => {
  const groups = groupByMonth([
    ev({ startDate: '2026-11-12' }), ev({ startDate: '2026-11-21' }), ev({ startDate: '2026-12-05' }),
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.events.length]), [['November 2026', 2], ['December 2026', 1]]);
  assert.deepEqual(groupByMonth([]), []);
});

test('dropdownNext: Sports toggles it; a pick, Events, outside, or Esc closes it', () => {
  assert.equal(dropdownNext(false, 'toggle'), true);
  assert.equal(dropdownNext(true, 'toggle'), false);
  for (const action of ['pick', 'outside', 'escape', 'events']) {
    assert.equal(dropdownNext(true, action), false, action);
    assert.equal(dropdownNext(false, action), false, `${action} when closed stays closed`);
  }
});
