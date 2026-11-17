// Event venue resolution (lib/event-venues.js): pure helpers plus the resolver with a
// stubbed geocoder. Nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventAddress, eventPoints, normalizeVenue, placeEvent, resolveEventVenue } from '../lib/event-venues.js';

const REGION = { center: [30.2672, -97.7431], radiusKm: 60 };
const NEAR = { lat: 30.25979, lng: -97.7325, matched: '1209 E CESAR CHAVEZ ST, AUSTIN, TX, 78702' };
const FAR = { lat: 31.5, lng: -97.0, matched: 'SOMEWHERE ELSE, TX' };

/** A stub geocoder fetch: `hits` maps the address in the request URL to a Census reply. */
function stubGet(hits, calls = []) {
  return async (url) => {
    calls.push(url);
    const address = new URL(url).searchParams.get('address') ?? '';
    const match = Object.entries(hits).find(([a]) => address.startsWith(a))?.[1] ?? null;
    return { ok: true, text: JSON.stringify({ result: { addressMatches: match ? [{ matchedAddress: match.matched, coordinates: { x: match.lng, y: match.lat } }] : [] } }) };
  };
}

test('normalizeVenue: lowercase, collapsed whitespace', () => {
  assert.equal(normalizeVenue('  Palmer Events Center,  900 Barton Springs Rd '), 'palmer events center, 900 barton springs rd');
  assert.equal(normalizeVenue(null), '');
});

test('eventAddress: the first house-numbered part, cut at &; null for bare names', () => {
  assert.equal(eventAddress('The Eleanor, 307 W 5th St'), '307 W 5th St');
  assert.equal(eventAddress('1209 E Cesar Chavez St'), '1209 E Cesar Chavez St');
  assert.equal(eventAddress("People's Plaza, Zach Theater, 202 S Lamar Blvd"), '202 S Lamar Blvd');
  assert.equal(eventAddress('SOCO Makers Market, 1501 S Congress & Kitsunori, 2310 S Lamar #102'), '1501 S Congress');
  assert.equal(eventAddress('Zilker Park'), null);
  assert.equal(eventAddress('Wingman Kitchens'), null);
  assert.equal(eventAddress('Junbi, Cedar Park & Alienated Majesty Books'), null);
  assert.equal(eventAddress(''), null);
});

test('placeEvent: no match or outside the region is unplaced', () => {
  assert.equal(placeEvent('Zilker Park', null, REGION), null);
  assert.deepEqual(placeEvent('1209 E Cesar Chavez St', NEAR, REGION), { lat: 30.25979, lng: -97.7325, located: 'address', matched: '1209 E CESAR CHAVEZ ST, AUSTIN, TX, 78702' });
  assert.equal(placeEvent('Somewhere', FAR, REGION), null); // ~140 km out: refused, not pinned elsewhere
  assert.deepEqual(placeEvent('Somewhere', FAR, null), { lat: 31.5, lng: -97, located: 'address', matched: 'SOMEWHERE ELSE, TX' }); // no guard, no refusal
});

test('resolveEventVenue: hand-placed cache entries win over the geocoder', async () => {
  const calls = [];
  const cache = { 'zilker park': { lat: 30.2672, lng: -97.7713, located: 'manual', matched: 'Zilker Park, Austin, TX' } };
  assert.deepEqual(
    await resolveEventVenue('Zilker Park', 'Austin', cache, { get: stubGet({}, calls) }),
    { lat: 30.2672, lng: -97.7713, located: 'manual', matched: 'Zilker Park, Austin, TX' },
  );
  assert.equal(calls.length, 0, 'no lookup when the cache places it');
});

test('resolveEventVenue: unresolved cache entries stay unplaced without another lookup', async () => {
  const calls = [];
  const cache = { 'somewhere, austin': { unresolved: true, lastTried: '2026-11-17T00:00:00.000Z' } };
  assert.equal(await resolveEventVenue('Somewhere, Austin', 'Austin', cache, { get: stubGet({}, calls) }), null);
  assert.equal(calls.length, 0);
});

test('resolveEventVenue: bare names without a cache entry are unplaced, no lookup', async () => {
  const calls = [];
  assert.equal(await resolveEventVenue('Zilker Park', 'Austin', {}, { get: stubGet({}, calls) }), null);
  assert.equal(calls.length, 0);
});

test('resolveEventVenue: the address portion goes to the Census geocoder', async () => {
  const get = stubGet({ '307 W 5th St': NEAR });
  assert.deepEqual(
    await resolveEventVenue('The Eleanor, 307 W 5th St', 'Austin', {}, { get, region: REGION }),
    { lat: 30.25979, lng: -97.7325, located: 'address', matched: '1209 E CESAR CHAVEZ ST, AUSTIN, TX, 78702' },
  );
  // No match, and a match outside the region, both stay unplaced.
  assert.equal(await resolveEventVenue('The Eleanor, 307 W 5th St', 'Austin', {}, { get: stubGet({}), region: REGION }), null);
  assert.equal(await resolveEventVenue('The Eleanor, 307 W 5th St', 'Austin', {}, { get: stubGet({ '307 W 5th St': FAR }), region: REGION }), null);
});

test('eventPoints: only the located events, as points', () => {
  assert.deepEqual(eventPoints({ events: [
    { title: 'A', lat: 30.1, lng: -97.7 },
    { title: 'B' },
    { title: 'C', lat: 30.2, lng: -97.8 },
  ] }), [{ lat: 30.1, lng: -97.7 }, { lat: 30.2, lng: -97.8 }]);
  assert.deepEqual(eventPoints(null), []);
});
