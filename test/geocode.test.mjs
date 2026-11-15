import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censusUrl, hasCoords, kmBetween, parseCensus, placeCourt } from '../lib/geocode.js';

const AUSTIN = { id: 'austin', name: 'Austin, TX', center: [30.2672, -97.7431], radiusKm: 60 };

test('builds a Census geocoder request for an address in the region', () => {
  const u = new URL(censusUrl('1100 Kingsbury St', 'Austin, TX'));
  assert.equal(u.origin + u.pathname, 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  assert.equal(u.searchParams.get('address'), '1100 Kingsbury St, Austin, TX');
  assert.equal(u.searchParams.get('format'), 'json');
});

test('reads the first match, rounded to 5 decimals; no match is null', () => {
  const reply = { result: { addressMatches: [{ matchedAddress: '1100 KINGSBURY ST, AUSTIN, TX, 78703', coordinates: { x: -97.754123456, y: 30.284567891 } }] } };
  assert.deepEqual(parseCensus(reply), { lat: 30.28457, lng: -97.75412, matched: '1100 KINGSBURY ST, AUSTIN, TX, 78703' });
  assert.equal(parseCensus({ result: { addressMatches: [] } }), null);
  assert.equal(parseCensus(null), null);
  assert.equal(parseCensus({ result: { addressMatches: [{ coordinates: { x: 'a', y: 1 } }] } }), null);
});

test('adds coordinates right after the address and marks where they came from', () => {
  const court = { park: 'Pease District Park', address: '1100 Kingsbury St', surface: 'sand', courts: 3, lights: true };
  const out = placeCourt(court, { lat: 30.28457, lng: -97.75412 }, AUSTIN);
  assert.deepEqual(Object.keys(out), ['park', 'address', 'lat', 'lng', 'located', 'surface', 'courts', 'lights']);
  assert.equal(out.located, 'address');
  assert.equal(hasCoords(out), true);
  assert.equal(hasCoords(court), false);
});

test('refuses a match outside the region, and no match at all', () => {
  const court = { park: 'Somewhere Park', address: '1 Main St' };
  assert.equal(placeCourt(court, { lat: 29.7604, lng: -95.3698 }, AUSTIN), null); // Houston
  assert.equal(placeCourt(court, null, AUSTIN), null);
  assert.ok(kmBetween(AUSTIN.center, [29.7604, -95.3698]) > 200);
});
