// Listing-site events (lib/event-sources.js), from JSON-LD copied off AllEvents' Austin markets
// page and Visit Austin's events page on Nov 18, 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, isWanted, jsonLdEvents, mergeEvents, readEventSources, sameEvent, tidyTitle, toFeedEvent } from '../lib/event-sources.js';

const page = (f) => readFileSync(new URL(`./fixtures/events/${f}.html`, import.meta.url), 'utf8');
const REGION = { id: 'austin', center: [30.2672, -97.7431], radiusKm: 60, city: 'Austin' };
const TODAY = '2026-11-18';
const feedOf = (f, source = 'AllEvents') => jsonLdEvents(page(f)).map((o) => toFeedEvent(o, { source, region: REGION, today: TODAY })).filter(Boolean);

test('AllEvents markets: markets kept with their pins, classes and talks dropped, titles tidied', () => {
  assert.equal(jsonLdEvents(page('allevents-markets')).length, 15);
  const evs = feedOf('allevents-markets');
  assert.deepEqual(evs.map((e) => e.title), [
    'The Front Market', 'Full Moon Austin Witches Market @ The Brewtorium', 'Vibe Artisan Markets',
    'Full Moon Austin Witches Market @ Buzz Mill', 'Full Moon Austin Witches Market @ Yarrow & Sage South',
    'Austin Art & Craft Marketplace', 'Austin Holiday Handmade Expo', 'Kids Markets At Zach Theater',
  ]);
  const front = evs[0];
  assert.deepEqual([front.startDate, front.endDate, front.venue, front.city, front.kind, front.located, front.region], ['2026-11-21', '2026-11-22', 'Moody Amphitheater, 1400 Trinity St', 'Austin', 'popup', 'source', 'austin']);
  assert.ok(Number.isFinite(front.lat) && Number.isFinite(front.lng));
  assert.match(front.sourceUrl, /^https:\/\/allevents\.in\/austin\/the-front-market\//);
  assert.equal(evs.find((e) => /Handmade/.test(e.title)).kind, 'seasonal', 'holiday → seasonal');
  assert.equal(evs.find((e) => /Handmade/.test(e.title)).venue, '6100 Airport Boulevard', 'no "6100 Airport Blvd, 6100 Airport Boulevard"');
});

test('Visit Austin: its event list (no coordinates; the geocoder places them later)', () => {
  const evs = feedOf('visit-austin-events', 'Visit Austin');
  assert.deepEqual(evs.map((e) => [e.title, e.startDate, e.endDate, e.kind, e.venue]), [
    ['A Christmas Affair', '2026-11-18', '2026-11-22', 'seasonal', 'Palmer Events Center'],
    ['Miracle on 5th Street Christmas Pop-Up Bar', '2026-11-12', '2026-12-30', 'seasonal', 'The Eleanor'],
    ['Peppermint in the Park', '2026-11-12', '2027-01-03', 'seasonal', 'COTALAND'],
  ]);
  assert.ok(evs.every((e) => !('lat' in e)));
});

test('what is kept, and how it is sorted into kinds and tags', () => {
  assert.ok(isWanted('Holiday Vibe Market'));
  assert.ok(isWanted('Tiny Loaf pop-up'));
  assert.ok(!isWanted('In-person class: French Patisserie: From Scratch'));
  assert.ok(!isWanted('Business & Trade Summit 2026'));
  assert.ok(!isWanted('Comedy Night'), 'not a market, fair, festival or seasonal thing');
  assert.deepEqual(classify('Matcha pop-up at SoCo'), { kind: 'popup', tags: ['asian-inspired'] });
  assert.deepEqual(classify('Trail of Lights'), { kind: 'seasonal', tags: [] });
  assert.deepEqual(classify('Lunar New Year Night Market'), { kind: 'seasonal', tags: ['asian-inspired'] });
  assert.equal(tidyTitle('Full Moon Austin Witches Market @ The Brewtorium! ✨ Nov. 21'), 'Full Moon Austin Witches Market @ The Brewtorium');
  assert.equal(tidyTitle('Vibe Artisan Markets | AUSTIN'), 'Vibe Artisan Markets');
  assert.equal(tidyTitle('JAPAN Fes Texas Unlimited | All-You-Can-Eat Japanese Festival'), 'JAPAN Fes Texas Unlimited');
  assert.equal(tidyTitle('Austin Wine Festival - 40+ Types of Wine to Try Included'), 'Austin Wine Festival');
  assert.equal(tidyTitle('Pop-Up | Night'), 'Pop-Up | Night', 'a one-word name keeps its tail');
  assert.ok(!isWanted('The Peterson Brothers Live: Post-Thanksgiving Bash at The Continental Club'));
  assert.ok(!isWanted("Home Cookin': Holiday Recipes & Stories"));
  assert.ok(!isWanted('Friendsgiving: Make & Share a Holiday Meal Together'));
});

test('past events, far-away pins and non-https links are dropped', () => {
  const base = { '@type': 'Event', name: 'Night Market', url: 'https://example.test/e', location: { name: 'Plaza', geo: { latitude: 30.27, longitude: -97.74 } } };
  assert.ok(toFeedEvent({ ...base, startDate: '2026-11-20' }, { source: 'X', region: REGION, today: TODAY }));
  assert.equal(toFeedEvent({ ...base, startDate: '2026-11-01' }, { source: 'X', region: REGION, today: TODAY }), null);
  assert.equal(toFeedEvent({ ...base, startDate: '2026-11-20', location: { name: 'Dallas Plaza', geo: { latitude: 32.78, longitude: -96.8 } } }, { source: 'X', region: REGION, today: TODAY }), null);
  assert.equal(toFeedEvent({ ...base, startDate: '2026-11-20', url: 'http://example.test/e' }, { source: 'X', region: REGION, today: TODAY }), null);
});

test('sameEvent and mergeEvents: one listing per event, the other copy\'s pin borrowed, other feeds\' events kept', () => {
  const affairVA = { title: 'A Christmas Affair', startDate: '2026-11-18', endDate: '2026-11-22', venue: 'Palmer Events Center', source: 'Visit Austin', sourceUrl: 'https://www.austintexas.org/event/a-christmas-affair/387371/' };
  const affairIG = { title: 'A Christmas Affair', startDate: '2026-11-19', endDate: '2026-11-22', venue: 'Palmer Events Center, 900 Barton Springs Rd', source: 'Instagram @someone', sourceUrl: 'https://www.instagram.com/p/x/', lat: 30.26, lng: -97.75, located: 'address', price: '$25/day' };
  const brew = { title: 'Full Moon Austin Witches Market @ The Brewtorium', startDate: '2026-11-21', lat: 30.32592, lng: -97.7, source: 'AllEvents', sourceUrl: 'https://allevents.in/a' };
  const buzz = { title: 'Full Moon Austin Witches Market @ Buzz Mill', startDate: '2026-11-21', lat: 30.24173, lng: -97.72, source: 'AllEvents', sourceUrl: 'https://allevents.in/b' };
  assert.ok(sameEvent(affairVA, affairIG), 'overlapping dates, same title');
  assert.ok(!sameEvent(brew, buzz), 'same series, two places');
  const old = { title: 'Old Market', startDate: '2026-11-01', source: 'Instagram @x', sourceUrl: 'https://www.instagram.com/p/old/' };
  const muse = { title: 'Tiny Loaf Asian Milk Bread', startDate: '2026-11-21', endDate: '2026-11-29', source: 'Instagram', sourceUrl: 'https://www.instagram.com/p/y/' };
  const out = mergeEvents({ events: [affairIG, old, muse] }, [{ id: 'visit-austin', ok: true, events: [affairVA] }, { id: 'allevents-austin', ok: true, events: [brew, buzz] }], TODAY, ['Visit Austin', 'AllEvents']);
  assert.deepEqual(out.map((e) => e.title), ['A Christmas Affair', 'Full Moon Austin Witches Market @ Buzz Mill', 'Full Moon Austin Witches Market @ The Brewtorium', 'Tiny Loaf Asian Milk Bread']);
  const affair = out[0];
  assert.equal(affair.source, 'Visit Austin', 'the listing wins');
  assert.deepEqual([affair.lat, affair.venue, affair.price], [30.26, 'Palmer Events Center, 900 Barton Springs Rd', '$25/day'], 'borrowed pin, address and price');
  // A source that failed keeps its last events.
  const kept = mergeEvents({ events: [{ ...brew, sourceId: 'allevents-austin' }] }, [{ id: 'allevents-austin', ok: false, events: [] }], TODAY, ['AllEvents']);
  assert.equal(kept.length, 1);
});

test('readEventSources: each page read, a source fails only when all its pages do', async () => {
  const pages = { 'https://a.test/1': page('allevents-markets') };
  const get = async (u) => (pages[u] ? { ok: true, status: 200, text: pages[u] } : { ok: false, status: 404, text: '' });
  const [a, b] = await readEventSources({ sources: [
    { id: 'a', name: 'AllEvents', urls: ['https://a.test/1', 'https://a.test/2'] },
    { id: 'b', name: 'Other', urls: ['https://b.test/1'] },
  ] }, { get, today: TODAY, regions: [{ id: 'austin', name: 'Austin, TX', center: REGION.center, radiusKm: 60 }] });
  assert.deepEqual([a.ok, a.events.length, b.ok, b.events.length], [true, 8, false, 0]);
  assert.match(b.error, /404/);
});
