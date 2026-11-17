import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventPointsForRegion, regionBox } from '../lib/map-area.js';
import { loadRegions } from '../lib/regions.js';

test('map area: a padded box around the venues and the center, ignoring venues without coordinates', () => {
  const box = regionBox({ center: [30.27, -97.74], venues: [{ lat: 30.5, lng: -97.6 }, { lat: 30.2, lng: -97.9 }, { lat: null, lng: null }] });
  assert.deepEqual(box, [-97.98, 30.12, -97.52, 30.58]);
  assert.throws(() => regionBox({ venues: [] }), /no coordinates/);
});

test('map area: every region\'s box holds all its venues', () => {
  for (const r of loadRegions()) {
    const [w, s, e, n] = regionBox({ center: r.info.center, venues: r.venues });
    for (const v of r.venues.filter((x) => Number.isFinite(x.lat))) assert.ok(v.lng > w && v.lng < e && v.lat > s && v.lat < n, `${v.id} inside ${r.info.id}'s map`);
    assert.ok(e - w < 2 && n - s < 2, `${r.info.id}'s map stays city-sized`);
  }
});

// Austin's center and radius (config/regions/austin/region.json): Vista Brewing in Driftwood is
// ~32 km south, inside the 60 km radius; a point in another city is not.
const AUSTIN = { center: [30.2672, -97.7431], radiusKm: 60 };
const FEED = { events: [
  { title: 'Vista Brewing Artisan Market', lat: 30.10485, lng: -98.02175 },
  { title: 'Flower Shop', lat: 30.25979, lng: -97.7325 },
  { title: 'No point', venue: 'Nowhere' },
  { title: 'Far away', lat: 32.8, lng: -96.95 }, // Dallas: outside Austin's radius
] };

test('map area: a region takes only the feed\'s points near it', () => {
  assert.deepEqual(eventPointsForRegion(FEED, AUSTIN), [{ lat: 30.10485, lng: -98.02175 }, { lat: 30.25979, lng: -97.7325 }]);
  assert.deepEqual(eventPointsForRegion(FEED, { center: [32.8, -96.95], radiusKm: 60 }), [{ lat: 32.8, lng: -96.95 }]);
  assert.deepEqual(eventPointsForRegion(null, AUSTIN), []);
  assert.deepEqual(eventPointsForRegion(FEED, null), []);
});

test('map area: the events widen Austin\'s box south to Vista Brewing', () => {
  const austin = loadRegions({ only: ['austin'] })[0];
  const [, south] = regionBox({ center: austin.info.center, venues: [...austin.venues, ...eventPointsForRegion(FEED, austin.info)] });
  assert.ok(south < 30.10485, `south edge ${south} is below Vista Brewing`);
  const [, southVenuesOnly] = regionBox({ center: austin.info.center, venues: austin.venues });
  assert.ok(southVenuesOnly > 30.10485, 'venues alone leave Vista Brewing outside the box');
});
