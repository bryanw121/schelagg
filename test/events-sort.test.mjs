// Sorting the Events list (the Sort pill) and the card's summary line. Pure helpers in public/events-ui.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventSummary, forYouScore, isEventSort, isNewFind, lastChance, sortGroup } from '../public/events-ui.js';
import { mergeEvents } from '../lib/event-sources.js';

const TODAY = '2026-11-21'; // a Saturday
const ev = (id, o = {}) => ({ id, title: id, startDate: TODAY, ...o });

test('lastChance: only a run that ends within two days; one-day events and later starts get nothing', () => {
  assert.equal(lastChance(ev('a', { startDate: '2026-11-13', endDate: '2026-11-21' }), TODAY), 'Last day');
  assert.equal(lastChance(ev('b', { startDate: '2026-11-13', endDate: '2026-11-22' }), TODAY), 'Ends tomorrow');
  assert.equal(lastChance(ev('c', { startDate: '2026-11-13', endDate: '2026-11-23' }), TODAY), 'Ends Mon');
  assert.equal(lastChance(ev('d', { startDate: '2026-11-13', endDate: '2026-11-24' }), TODAY), null);
  assert.equal(lastChance(ev('e'), TODAY), null, 'a one-day event isn\'t a last chance');
  assert.equal(lastChance(ev('f', { startDate: '2026-11-22', endDate: '2026-11-23' }), TODAY), null, 'not started yet');
});

test('isNewFind: listed within the last week', () => {
  assert.equal(isNewFind(ev('a', { firstSeen: '2026-11-15' }), TODAY), true);
  assert.equal(isNewFind(ev('b', { firstSeen: '2026-11-13' }), TODAY), false);
  assert.equal(isNewFind(ev('c'), TODAY), false, 'no date: not new');
});

test('forYouScore: picked topics count most (two at most), then a last chance, a new find, and distance', () => {
  const matcha = ev('m', { title: 'Matcha cart' });
  const both = ev('b', { title: 'Matcha and ramen night market' });
  assert.equal(forYouScore(matcha, { likes: ['matcha'], today: TODAY }), 3);
  assert.equal(forYouScore(both, { likes: ['matcha', 'food', 'night-market'], today: TODAY }), 6, 'two topics count');
  assert.equal(forYouScore(ev('x', { startDate: '2026-11-20', endDate: TODAY, firstSeen: TODAY }), { likes: [], today: TODAY }), 3);
  assert.equal(forYouScore(matcha, { likes: ['matcha'], today: TODAY, miles: 10 }), 1, '5 miles cost a point');
  assert.equal(forYouScore(ev('f', { price: 'Free' }), { likes: ['free'], today: TODAY }), 3, 'Free can be picked too');
});

test('sortGroup: Soonest keeps the heading\'s order; For you and Ending soon reorder, ties stay put', () => {
  const list = [
    ev('pop', { title: 'Sneaker pop-up' }),
    ev('run', { title: 'Lights', startDate: '2026-11-01', endDate: '2026-12-31' }),
    ev('matcha', { title: 'Matcha cart' }),
    ev('ends', { title: 'Craft show', startDate: '2026-11-14', endDate: '2026-11-22' }),
  ];
  const ids = (xs) => xs.map((e) => e.id);
  assert.deepEqual(ids(sortGroup(list, { sort: 'soonest', today: TODAY })), ['pop', 'run', 'matcha', 'ends']);
  assert.deepEqual(ids(sortGroup(list, { sort: 'foryou', likes: ['matcha'], today: TODAY })), ['matcha', 'ends', 'pop', 'run']);
  assert.deepEqual(ids(sortGroup(list, { sort: 'ending', today: TODAY })), ['pop', 'matcha', 'ends', 'run']);
  // Near me on: distance breaks the tie between two otherwise equal events.
  const near = sortGroup([ev('far'), ev('close')], { sort: 'foryou', today: TODAY, milesOf: (e) => (e.id === 'far' ? 12 : 1) });
  assert.deepEqual(ids(near), ['close', 'far']);
  assert.deepEqual(list.map((e) => e.id), ['pop', 'run', 'matcha', 'ends'], 'the input is not changed');
  assert.equal(isEventSort('foryou'), true); assert.equal(isEventSort('price'), false);
});

test('eventSummary: the first sentence, cut at a word, never the title again or boilerplate', () => {
  assert.equal(eventSummary({ title: 'Creek Show', description: 'Light installations along Waller Creek, nightly. Nov 17 is Pride Night.' }), 'Light installations along Waller Creek, nightly.');
  assert.equal(eventSummary({ title: 'X', description: 'About this Event Join the biggest holiday market in Central Texas this weekend.' }), 'Join the biggest holiday market in Central Texas this weekend.');
  assert.equal(eventSummary({ title: 'X', description: 'Nearby Attractions Michael Martin Murphey has 2 upcoming events.' }), null);
  assert.equal(eventSummary({ title: 'Matcha cart pop-up', description: 'Matcha cart pop-up.' }), null, 'same as the title');
  assert.equal(eventSummary({ title: 'X' }), null);
  const long = eventSummary({ title: 'X', description: 'A very long description that keeps going without any full stop at all, about vendors, music, food trucks, kids activities and more fun' });
  assert.ok(long.endsWith('…') && long.length <= 111, long);
});

test('mergeEvents: firstSeen is today for a new listing and kept for one already in the feed', () => {
  const a = { id: 'evt-a', title: 'Alpha Market', venue: 'Zilker', city: 'Austin', startDate: '2026-11-28', source: 'AllEvents', sourceId: 'allevents-austin' };
  const b = { id: 'evt-b', title: 'Beta Fair', venue: 'Domain', city: 'Austin', startDate: '2026-11-29', source: 'AllEvents', sourceId: 'allevents-austin' };
  const prev = { events: [{ ...a, firstSeen: '2026-11-10' }, { id: 'evt-old', title: 'Old', venue: 'X', city: 'Austin', startDate: '2026-11-30', source: 'Visit Austin' }] };
  const out = mergeEvents(prev, [{ id: 'allevents-austin', ok: true, events: [a, b] }], TODAY, ['AllEvents']);
  const by = Object.fromEntries(out.map((e) => [e.id, e.firstSeen]));
  assert.deepEqual(by, { 'evt-a': '2026-11-10', 'evt-b': TODAY, 'evt-old': undefined }, 'an older event from before firstSeen stays without one');
});
