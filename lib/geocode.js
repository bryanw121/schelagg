// Coordinates for free public courts, from their street addresses, so the map can pin them.
// The US Census Bureau's geocoder: free, no key, public-domain data, US addresses only. A court that
// already has coordinates keeps them (hand-placed ones win), and a match outside the region is
// refused (a wrong city or a mistyped street is better left off the map than pinned elsewhere).

export const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** The geocoder request for one address in a region ("1100 Kingsbury St" + "Austin, TX"). */
export function censusUrl(address, place) {
  const u = new URL(CENSUS_GEOCODER);
  u.searchParams.set('address', `${address}, ${place}`);
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('format', 'json');
  return u.href;
}

/** The best match in a geocoder reply: { lat, lng, matched }, or null when nothing matched. */
export function parseCensus(json) {
  const m = json?.result?.addressMatches?.[0];
  const x = m?.coordinates?.x, y = m?.coordinates?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { lat: round5(y), lng: round5(x), matched: m.matchedAddress ?? null };
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** Kilometres between two [lat, lng] points. */
export function kmBetween([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Whether a court already has usable coordinates. */
export const hasCoords = (c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lng);

/**
 * A court with the geocoded point added, or null when the point is outside the region
 * (`region.center` and `region.radiusKm`). Keys stay in order, coordinates after the address.
 */
export function placeCourt(court, hit, region) {
  if (!hit) return null;
  if (region?.center && region?.radiusKm && kmBetween(region.center, [hit.lat, hit.lng]) > region.radiusKm) return null;
  const out = {};
  for (const [k, v] of Object.entries(court)) {
    out[k] = v;
    if (k === 'address') Object.assign(out, { lat: hit.lat, lng: hit.lng, located: 'address' });
  }
  if (!('lat' in out)) Object.assign(out, { lat: hit.lat, lng: hit.lng, located: 'address' });
  return out;
}
