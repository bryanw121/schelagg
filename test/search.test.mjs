import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_TAGS, eventText, highlightParts, matchesText, searchTags, searchWords, sessionText, tagCounts } from '../public/search.js';
import { filterEvents } from '../public/events-ui.js';

test('search: every word must start a word in the text', () => {
  assert.deepEqual(searchWords('  Night-Market! '), ['night', 'market']);
  assert.equal(matchesText('Asian Night Market · Downtown', 'night mar'), true);
  assert.equal(matchesText('Asian Night Market', 'market night'), true, 'any order');
  assert.equal(matchesText('Summary of the year', 'mar'), false, 'not inside a word');
  assert.equal(matchesText('Café Crème pop-up', 'creme'), true, 'accents fold');
  assert.equal(matchesText('anything', '   '), true, 'an empty search matches everything');
});

test('search tags: a fixed word list, whole words, several per event, the same every time', () => {
  const ev = { title: 'Moonlight Market', description: 'A night market with vintage racks and matcha.', price: 'Free' };
  assert.deepEqual(searchTags(ev), ['night-market', 'vintage', 'matcha', 'free']);
  assert.deepEqual(searchTags(ev), searchTags({ ...ev }), 'deterministic');
  assert.deepEqual(searchTags({ title: 'Freedom Run', description: 'Fleas welcome? No.' }), [], 'free and flea need whole words');
  assert.deepEqual(searchTags({ title: 'Holiday Makers Market' }), ['makers-market', 'holiday']);
  assert.ok(SEARCH_TAGS.every((t) => t.words.every((w) => w === w.toLowerCase() && !/[^a-z0-9 ]/.test(w))), 'tag words are plain lowercase');
  assert.deepEqual(tagCounts([ev, { title: 'Vintage Fair' }]).map((t) => [t.id, t.n]), [['vintage', 2], ['night-market', 1], ['matcha', 1], ['free', 1]]);
});

test('search: an event is found through its tag even when its title does not say it', () => {
  const feed = [
    { title: 'Moonlight Bazaar', description: 'Our monthly night market.', startDate: '2026-11-21' },
    { title: 'Plant Swap', venue: 'Tillery Street', startDate: '2026-11-21' },
  ];
  assert.deepEqual(filterEvents(feed, { q: 'Night market' }, '2026-11-18').map((e) => e.title), ['Moonlight Bazaar']);
  assert.deepEqual(filterEvents(feed, { q: 'tillery' }, '2026-11-18').map((e) => e.title), ['Plant Swap']);
  assert.match(eventText(feed[0], ['Pop-up']), /Pop-up/);
  assert.equal(matchesText(sessionText({ title: 'Coed 6v6', venue: 'Montopolis Rec', level: 'All levels' }, ['Indoor']), 'monto indoor'), true);
});

test('search: highlight marks the matched word starts', () => {
  assert.deepEqual(highlightParts('Asian Night Market', 'night mar'), [['Asian ', false], ['Night', true], [' ', false], ['Mar', true], ['ket', false]]);
  assert.deepEqual(highlightParts('Plain', ''), [['Plain', false]]);
});

test('search: a tag filter is exactly the tagged events; typing its name is a wider word search', () => {
  const feed = [
    { title: 'Taco Tasting', startDate: '2026-11-21' }, // tagged Food
    { title: 'Art Walk', description: 'Local art, with food available nearby.', startDate: '2026-11-21' }, // mentions food, not tagged
  ];
  assert.deepEqual(filterEvents(feed, { topic: 'food' }, '2026-11-18').map((e) => e.title), ['Taco Tasting']);
  assert.deepEqual(filterEvents(feed, { q: 'food' }, '2026-11-18').map((e) => e.title), ['Taco Tasting', 'Art Walk']);
});

test('eventIcon: the most specific tag decides the picture; no tag falls back to the kind', async () => {
  const { eventIcon, EVENT_ICONS, SEARCH_TAGS } = await import('../public/search.js');
  assert.equal(eventIcon({ title: 'Asian Night Market', description: 'Food trucks and vintage racks.' }), 'night-market');
  assert.equal(eventIcon({ title: 'Matcha & Makers Market' }), 'matcha');
  assert.equal(eventIcon({ title: 'Holiday Food Truck Rally' }), 'food');
  assert.equal(eventIcon({ title: 'Trail of Lanterns' }, 'seasonal'), 'seasonal');
  assert.equal(eventIcon({ title: 'Sneaker drop' }, 'popup'), 'popup');
  assert.equal(eventIcon({ title: 'Free yoga', price: 'Free' }), 'popup', 'Free is a tag without a picture');
  for (const t of SEARCH_TAGS) if (t.id !== 'free') assert.ok(EVENT_ICONS[t.id], `${t.id} has an icon`);
});
