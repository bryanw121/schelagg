// The map area for a region: a box around its venues (plus its center), padded so pins near the
// edge aren't pressed against it. scripts/build-maps.mjs cuts this box out of the OpenStreetMap
// build; the site never shows anything outside it.

import { kmBetween } from './geocode.js';

const PAD = 0.08; // degrees, about 8 km

/** [west, south, east, north] around the region's venues and center, padded and rounded to 3 decimals. */
export function regionBox({ center, venues = [] }) {
  const pts = venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng)).map((v) => [v.lat, v.lng]);
  if (Array.isArray(center) && center.length === 2) pts.push(center);
  if (!pts.length) throw new Error('map area: no coordinates');
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  const r = (n) => Math.round(n * 1000) / 1000;
  return [r(Math.min(...lngs) - PAD), r(Math.min(...lats) - PAD), r(Math.max(...lngs) + PAD), r(Math.max(...lats) + PAD)];
}

/**
 * The events feed's located points inside this region (its center + radiusKm), as { lat, lng }
 * for regionBox. Events are city-wide, not per-region, so a region only takes the ones near it;
 * a point outside the radius (a wrong city, a mistyped street) stays out of every region's map.
 * Without a feed (a local run before the data-branch pull) there is nothing to add.
 */
export function eventPointsForRegion(feed, region) {
  const center = region?.center, radiusKm = region?.radiusKm ?? 50;
  if (!Array.isArray(center) || center.length !== 2) return [];
  return (feed?.events ?? [])
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .filter((e) => kmBetween(center, [e.lat, e.lng]) <= radiusKm)
    .map((e) => ({ lat: e.lat, lng: e.lng }));
}
