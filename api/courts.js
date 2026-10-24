// GET /api/courts?days=7  -> live court bookings + opening hours for High Point, Crossover and Treehouse.
// Runs as a Vercel serverless function; also mounted by server.js for local dev.
import { VENUES, loadVenue } from '../lib/skedda.js';
import { today } from '../lib/time.js';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, body }

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 21);
  const from = today();
  const key = `${from}|${days}`;

  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    const results = await Promise.allSettled(VENUES.map((v) => loadVenue(v, from, days)));
    const venues = [], errors = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') venues.push(r.value);
      else errors.push({ venue: VENUES[i].id, calendar: VENUES[i].calendar, message: r.reason?.message || String(r.reason) });
    });
    // If a venue failed but we served it recently, keep the old copy rather than show nothing.
    if (hit) for (const e of errors) {
      const prev = hit.body.venues.find((v) => v.id === e.venue);
      if (prev) venues.push({ ...prev, stale: true });
    }
    hit = { at: Date.now(), body: { fetchedAt: new Date().toISOString(), from, days, venues, errors } };
    cache.set(key, hit);
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  // Let Vercel's CDN share the result for 5 minutes, then refresh in the background.
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.end(JSON.stringify(hit.body));
}
