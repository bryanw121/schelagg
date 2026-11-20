// GET /api/where -> { region: "<id>" | null }: the covered city nearest to the caller, from the
// approximate location Vercel attaches to every request (x-vercel-ip-latitude / -longitude, looked
// up from the caller's network address). No prompt, nothing stored or logged, and only the region
// id is sent back, never the coordinates. Used once, on a first visit with no saved or linked
// city, so someone in Dallas opens on Dallas. null when the location is unknown or too far from
// any region (the site then keeps its default).
import { loadRegions } from '../lib/regions.js';
import { kmBetween } from '../lib/geocode.js';

export const MAX_KM = 160; // about 100 miles: a region's surroundings, not the next metro

/** The region whose center is nearest to `at` ([lat, lng]) and within maxKm, or null. */
export function nearestRegion(regions, at, maxKm = MAX_KM) {
  if (!Array.isArray(at) || !at.every(Number.isFinite)) return null;
  let best = null;
  for (const r of regions) {
    if (!Array.isArray(r.center)) continue;
    const km = kmBetween(r.center, at);
    if (km <= maxKm && (!best || km < best.km)) best = { id: r.id, km };
  }
  return best?.id ?? null;
}

export function createHandler({ regions } = {}) {
  let list = regions ?? null;
  return function handler(req, res) {
    const h = req.headers ?? {};
    const num = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN);
    list ??= loadRegions().map((r) => r.info);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'private, no-store'); // the answer depends on who asks
    res.end(JSON.stringify({ region: nearestRegion(list, [num(h['x-vercel-ip-latitude']), num(h['x-vercel-ip-longitude'])]) }));
  };
}

export default createHandler();
