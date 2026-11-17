// Coordinates for Austin events (public/data/events.json), so the map can pin them.
// A venue string is usually "Name, street address" or just a bare name ("Zilker Park").
// The street-address portion goes to the US Census geocoder (lib/geocode.js, free, no key);
// a bare name is placed by hand in the cache (public/data/event-venues.json), which wins
// over the geocoder, and a match outside the region is refused (a wrong city or a mistyped
// street is better left off the map than pinned elsewhere). Mirrors lib/geocode.js.

import { get } from './http.js';
import { censusUrl, kmBetween, parseCensus } from './geocode.js';

/** The cache key for a venue string: lowercase, collapsed whitespace. */
export function normalizeVenue(venue) {
  return String(venue ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The street-address portion of a venue string, or null when it has none. The first
 * comma-part that starts with a house number wins, cut at ' & ' ("SOCO Makers Market,
 * 1501 S Congress & Kitsunori, 2310 S Lamar #102" -> "1501 S Congress": the first venue
 * in v1). "Zilker Park" and "Wingman Kitchens" have no address to extract.
 */
export function eventAddress(venue) {
  if (!venue) return null;
  for (const part of String(venue).split(',')) {
    const first = part.split('&')[0].trim();
    if (/^\d+\s+\S/.test(first)) return first;
  }
  return null;
}

/**
 * A venue with the geocoded point added, or null when there is no match or it is outside
 * the region (`region.center` and `region.radiusKm`). Mirrors placeCourt in lib/geocode.js.
 */
export function placeEvent(venue, hit, region) {
  if (!hit) return null;
  if (region?.center && region?.radiusKm && kmBetween(region.center, [hit.lat, hit.lng]) > region.radiusKm) return null;
  return { lat: hit.lat, lng: hit.lng, located: 'address', matched: hit.matched ?? null };
}

/**
 * Resolve one venue string to coordinates, or null when it can't be placed. Hand-placed
 * cache entries win (a cache entry with lat/lng, whatever its `located`); an entry marked
 * `unresolved` stays unplaced without another lookup. Otherwise the street-address portion
 * goes to the Census geocoder. `opts.region` is the radius guard, `opts.get` injects the
 * fetch (for tests).
 */
export async function resolveEventVenue(venue, city, cache = {}, opts = {}) {
  const key = normalizeVenue(venue);
  const hit = cache[key];
  if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
    return { lat: hit.lat, lng: hit.lng, located: hit.located ?? 'manual', matched: hit.matched ?? null };
  }
  if (hit?.unresolved) return null;
  const address = eventAddress(venue);
  if (!address) return null;
  let res;
  try {
    res = await (opts.get ?? get)(censusUrl(address, `${city ?? 'Austin'}, TX`));
  } catch {
    return null;
  }
  if (!res?.ok) return null;
  return placeEvent(venue, parseCensus(JSON.parse(res.text)), opts.region);
}

/** The located events of a feed, as { lat, lng } points (for the map box). */
export function eventPoints(feed) {
  return (feed?.events ?? [])
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .map((e) => ({ lat: e.lat, lng: e.lng }));
}
