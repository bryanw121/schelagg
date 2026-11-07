// The map area for a region: a box around its venues (plus its center), padded so pins near the
// edge aren't pressed against it. scripts/build-maps.mjs cuts this box out of the OpenStreetMap
// build; the site never shows anything outside it.

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
