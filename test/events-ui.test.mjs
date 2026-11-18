// The Events view's pure helpers (public/events-ui.js): kinds and tags, headings, filters, date
// ranges, place lines and map places. Nothing here touches the DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_KINDS, EVENT_TAGS, countEvents, eventCta, eventDateRange, eventGroups, eventKind, eventPinName,
  eventPlaceParts, eventPlaces, eventTags, eventWhen, eventsForRegion, filterEvents, groupByMonth,
  isEventKind, isEventTag, isOn, sortEvents, weekendRange,
} from '../public/events-ui.js';

const ev = (over = {}) => ({ id: 'evt-x', category: 'seasonal', title: 'T', venue: 'V', city: 'Austin', startDate: '2026-12-05', ...over });

test('sortEvents: soonest first, ties by title', () => {
  const sorted = sortEvents([ev({ title: 'B', startDate: '2026-12-05' }), ev({ title: 'A', startDate: '2026-12-05' }), ev({ title: 'C', startDate: '2026-11-12' })]);
  assert.deepEqual(sorted.map((e) => e.title), ['C', 'A', 'B']);
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

test('eventPlaces: one pin per venue, grouped; the status shows the full date range', () => {
  const places = eventPlaces([
    ev({ title: 'A Christmas Affair', venue: 'Palmer Events Center, 900 Barton Springs Rd', area: 'Zilker', startDate: '2026-11-19', endDate: '2026-11-22', lat: 30.26, lng: -97.77 }),
    ev({ title: 'Armadillo Christmas Bazaar', venue: 'Palmer Events Center, 900 Barton Springs Rd', area: 'Zilker', startDate: '2026-12-12', endDate: '2026-12-21', price: '$15', lat: 30.26, lng: -97.77 }),
    ev({ title: 'Flower Shop', venue: '1209 E Cesar Chavez St', area: 'East Austin', startDate: '2026-11-12', endDate: '2026-11-23', lat: 30.25979, lng: -97.7325 }),
    ev({ title: 'Flower Weekend', venue: '1209 E Cesar Chavez St', area: 'East Austin', startDate: '2026-11-16', endDate: '2026-11-18', lat: 30.25979, lng: -97.7325 }),
    ev({ title: 'No point', venue: 'Nowhere' }),
  ], '2026-11-17');
  assert.equal(places.length, 2, 'the unlocated event has no pin');
  const palmer = places.find((p) => p.name.startsWith('Palmer'));
  assert.equal(palmer.events.length, 2, 'both events at the same venue share the pin');
  assert.equal(palmer.short, 'Palmer Events Center');
  assert.equal(palmer.city, 'Zilker · Austin');
  assert.equal(palmer.status, '2 events · Nov 19 – 22', 'the soonest event\'s full range, not just its start');
  assert.deepEqual([palmer.title, palmer.more], ['A Christmas Affair', 1], 'named for the soonest event, and how many more');
  assert.equal(palmer.aria, 'A Christmas Affair and 1 more at Palmer Events Center: 2 events · Nov 19 – 22');
  assert.deepEqual(palmer.sessions, [], 'the shared map machinery reads .sessions');
  assert.equal(palmer.done, false);
  const flower = places.find((p) => p.name.startsWith('1209'));
  assert.equal(flower.events.length, 2);
  assert.equal(flower.status, 'Happening now · Nov 16 – 18', 'Nov 12–23 and Nov 16–18 both cover Nov 17; the one ending soonest is shown');
  assert.equal(flower.short, '1209 E Cesar Chavez St');
  assert.deepEqual([flower.title, flower.more], ['Flower Weekend', 1], 'the event on now that ends soonest names the pin, not the address');
});

test('groupByMonth: the page\'s events under month headers, in order', () => {
  const groups = groupByMonth([
    ev({ startDate: '2026-11-12' }), ev({ startDate: '2026-11-21' }), ev({ startDate: '2026-12-05' }),
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.events.length]), [['November 2026', 2], ['December 2026', 1]]);
  assert.deepEqual(groupByMonth([]), []);
});


test('kinds and tags: Asian-inspired is a tag, not a kind; a feed may send kind and tags itself', () => {
  assert.deepEqual(EVENT_KINDS.map((k) => k.id), ['popup', 'seasonal']);
  assert.deepEqual(EVENT_TAGS.map((g) => g.id), ['asian-inspired']);
  assert.equal(eventKind(ev({ category: 'popup' })), 'popup');
  assert.equal(eventKind(ev({ category: 'asian-inspired' })), null);
  assert.deepEqual(eventTags(ev({ category: 'asian-inspired' })), ['asian-inspired']);
  assert.equal(eventKind(ev({ category: 'asian-inspired', kind: 'popup' })), 'popup');
  assert.deepEqual(eventTags(ev({ category: 'popup', tags: ['asian-inspired'] })), ['asian-inspired']);
  assert.ok(isEventKind('all') && isEventKind('seasonal') && !isEventKind('asian-inspired'));
  assert.ok(isEventTag('asian-inspired') && !isEventTag('popup'));
  assert.deepEqual(countEvents([ev({ category: 'popup' }), ev({ category: 'seasonal' }), ev({ category: 'asian-inspired' }), ev({ category: 'popup', tags: ['asian-inspired'] })]),
    { all: 4, popup: 2, seasonal: 1, 'asian-inspired': 2 });
});

test('eventsForRegion: a feed is Austin\'s unless it or an event says otherwise', () => {
  const feed = { events: [ev({ id: 'a' }), ev({ id: 'd', region: 'dallas' })] };
  assert.deepEqual(eventsForRegion(feed, 'austin').map((e) => e.id), ['a']);
  assert.deepEqual(eventsForRegion(feed, 'dallas').map((e) => e.id), ['d']);
  assert.deepEqual(eventsForRegion({ region: 'houston', events: [ev()] }, 'houston').length, 1);
  assert.deepEqual(eventsForRegion(null, 'austin'), []);
});

// Wed Nov 18 2026: Fri 20 – Sun 22 is this weekend; Mon 23 – Sun 29 is next week.
const TODAY = '2026-11-18';
const feed = [
  ev({ title: 'Flower Shop', startDate: '2026-11-12', endDate: '2026-11-23' }),
  ev({ title: 'Creek Show', startDate: '2026-11-13', endDate: '2026-11-21' }),
  ev({ title: 'Gone', startDate: '2026-11-01', endDate: '2026-11-10' }),
  ev({ title: 'Christmas Affair', startDate: '2026-11-19', endDate: '2026-11-22' }),
  ev({ title: 'Witches Market', startDate: '2026-11-21' }),
  ev({ title: 'Vista Market', startDate: '2026-11-27', endDate: '2026-12-20' }),
  ev({ title: 'German Market', startDate: '2026-12-05' }),
  ev({ title: 'New Year', startDate: '2027-01-02' }),
];

test('eventGroups: On now (ending soonest first), This week, Next week, then months; past events dropped', () => {
  const g = eventGroups(feed, TODAY);
  assert.deepEqual(g.map((x) => [x.key, x.label, x.events.map((e) => e.title)]), [
    ['now', 'On now', ['Creek Show', 'Flower Shop']],
    ['weekend', 'This week', ['Christmas Affair', 'Witches Market']],
    ['next', 'Next week', ['Vista Market']],
    ['2026-12', 'December', ['German Market']],
    ['2027-01', 'January', ['New Year']],
  ]);
  assert.equal(g[1].sub, 'Thu Nov 19 – Sun Nov 22 · 2 events');
  assert.equal(g[2].sub, 'Mon Nov 23 – Sun Nov 29 · 1 event');
  assert.equal(g[3].sub, '2026 · 1 event');
  assert.equal(eventGroups(feed, '2026-11-20')[1].label, 'This weekend', 'from Friday it is the weekend');
  assert.deepEqual(eventGroups([], TODAY), []);
});

test('weekendRange and filterEvents: kind, tags, and on any day of this weekend', () => {
  assert.deepEqual(weekendRange(TODAY), { from: '2026-11-20', to: '2026-11-22' });
  assert.deepEqual(weekendRange('2026-11-21'), { from: '2026-11-21', to: '2026-11-22' });
  assert.deepEqual(weekendRange('2026-11-22'), { from: '2026-11-22', to: '2026-11-22' });
  const wk = filterEvents(feed, { weekend: true }, TODAY).map((e) => e.title);
  assert.deepEqual(wk, ['Flower Shop', 'Creek Show', 'Christmas Affair', 'Witches Market']);
  const mixed = [ev({ title: 'P', category: 'popup' }), ev({ title: 'S', category: 'seasonal' }), ev({ title: 'A', category: 'asian-inspired' }), ev({ title: 'PA', category: 'popup', tags: ['asian-inspired'] })];
  assert.deepEqual(filterEvents(mixed, { kind: 'popup' }, TODAY).map((e) => e.title), ['P', 'PA']);
  assert.deepEqual(filterEvents(mixed, { tags: ['asian-inspired'] }, TODAY).map((e) => e.title), ['A', 'PA']);
  assert.deepEqual(filterEvents(mixed, { kind: 'popup', tags: ['asian-inspired'] }, TODAY).map((e) => e.title), ['PA']);
});

test('eventWhen and isOn: the card\'s date column; eventCta: what the button says', () => {
  assert.deepEqual(eventWhen(feed[0], TODAY), { top: 'Thru', main: 'Nov 23' });
  assert.deepEqual(eventWhen(feed[4], TODAY), { top: 'Sat', main: 'Nov 21' });
  assert.deepEqual(eventWhen(feed[3], TODAY), { top: 'Nov 19', main: 'to Nov 22', range: true });
  assert.ok(isOn(feed[0], TODAY) && !isOn(feed[3], TODAY) && !isOn(feed[2], TODAY));
  assert.equal(eventCta({ sourceUrl: 'https://www.instagram.com/p/x/' }), 'See the post');
  assert.equal(eventCta({ sourceUrl: 'https://www.austintexas.org/events/' }), 'Event page');
  assert.equal(eventCta({ sourceUrl: 'https://notinstagram.com.evil.test/' }), 'Event page');
  assert.equal(eventCta({}), 'Event page');
});
