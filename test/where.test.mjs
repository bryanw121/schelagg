// GET /api/where: the covered city nearest to an approximate location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, nearestRegion } from '../api/where.js';
import { loadRegions } from '../lib/regions.js';

const regions = loadRegions().map((r) => r.info);
const ask = (headers) => { const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, end(t) { this.text = t; } }; createHandler({ regions })({ headers }, res); return { ...JSON.parse(res.text), cache: res.h['cache-control'] }; };

test('nearestRegion: the nearest covered city within about 100 miles, else none', () => {
  assert.equal(nearestRegion(regions, [30.27, -97.74]), 'austin');
  assert.equal(nearestRegion(regions, [33.02, -96.70]), 'dallas', 'Plano');
  assert.equal(nearestRegion(regions, [29.79, -95.82]), 'houston', 'Katy');
  assert.equal(nearestRegion(regions, [29.42, -98.49]), 'austin', 'San Antonio is within reach of Austin');
  assert.equal(nearestRegion(regions, [40.71, -74.0]), null, 'New York');
  assert.equal(nearestRegion(regions, [NaN, NaN]), null);
  assert.equal(nearestRegion(regions, null), null);
});

test('api/where: answers only a region id, from the request\'s location headers, never cached', () => {
  assert.deepEqual(ask({ 'x-vercel-ip-latitude': '32.78', 'x-vercel-ip-longitude': '-96.80', 'x-vercel-ip-city': 'Dallas' }), { region: 'dallas', cache: 'private, no-store' });
  assert.equal(ask({}).region, null);
  assert.equal(ask({ 'x-vercel-ip-latitude': '', 'x-vercel-ip-longitude': 'abc' }).region, null);
});
