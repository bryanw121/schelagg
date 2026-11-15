import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionBox } from '../lib/map-area.js';
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
