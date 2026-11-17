# Austin events: pop-ups, seasonal events, Asian-inspired things

The daily discovery run (in Muse, not GitHub Actions — Instagram is unreliable from
Actions runners) finds Austin pop-ups, seasonal events, and Asian-inspired things and
publishes them as a JSON feed. This repo stores the feed and loads it into Neon.

## The feed

`public/data/events.json`, on the `data` branch (like the schedules feed):

```json
{
  "feedVersion": 1,
  "generatedAt": "2026-11-17T14:00:00.000Z",
  "events": [
    {
      "id": "evt-9f2c41a8b7e6d5c3",
      "category": "seasonal",
      "title": "Miracle on 5th Street",
      "venue": "The Eleanor",
      "area": "Downtown",
      "city": "Austin",
      "startDate": "2026-11-12",
      "endDate": "2026-12-30",
      "sourceUrl": "https://www.instagram.com/reel/...",
      "source": "instagram",
      "description": "Christmas pop-up bar"
    }
  ]
}
```

- `category` is `popup`, `seasonal`, or `asian-inspired`.
- `id` is deterministic: `evt-` + the first 16 hex chars of `sha256(sourceUrl|startDate)`,
  so the same event found again is the same row.
- Unknown optional fields are omitted, not nulled. `city` is `Austin` unless a named suburb.
- An event may also carry `lat`, `lng` and `located` (`address` | `manual` | `source`):
  coordinates for the map pin. They ride through `buildFeed` and `eventRow` untouched,
  and the whole feed event is stored in the `data` column, so the site and the database
  see the same point.

## Coordinates

`scripts/geocode-events.mjs` gives every feed event coordinates, so the site's map can
pin it. It runs after the discovery run (and the daily discovery cron invokes it):

1. Read `public/data/events.json` and the cache, `public/data/event-venues.json`.
2. For each event without coordinates, resolve its venue (`lib/event-venues.js`):
   a hand-placed cache entry wins; otherwise the street-address portion of the venue
   string ("The Eleanor, 307 W 5th St" → "307 W 5th St") goes to the US Census
   geocoder, and a match outside the region (Austin center + 60 km) is refused.
   An event with two venues in one string pins the first in v1.
3. Write `lat`/`lng`/`located` onto the feed events and update the cache.

The cache is keyed by the normalized venue string (lowercase, collapsed whitespace):

```json
{
  "zilker park": { "lat": 30.2672, "lng": -97.7713, "located": "manual", "matched": "Zilker Park, Austin, TX" },
  "somewhere, austin": { "unresolved": true, "lastTried": "2026-11-17T00:00:00.000Z" }
}
```

- `located` is `address` (a Census match on the venue's street address), `manual`
  (hand-placed — the only route for bare names like Zilker Park or Republic Square),
  or `source` (coordinates from the event's own page).
- `matched` is the address the coordinates came from (the Census match, or the
  hand-placed note). `unresolved` means no address could be geocoded and no hand-placed
  entry exists yet; the event stays list-only until one is added.
- The cache lives under `public/data/`, so `scripts/data-branch.sh` overlays it onto
  the `data` branch with the feed, and the site reads the coordinates from the feed.

```sh
node scripts/geocode-events.mjs          # fill in what's missing and write the files
node scripts/geocode-events.mjs --dry    # print what it would set, write nothing
```

## The site

The site reads the same feed (`data/events.json`, overlaid from the `data` branch at
deploy). The events UI itself is being redesigned as an events-first experience; the
feed shape and coordinates above are what it builds on.

## The database

`db/migrations/0002_events.sql` creates the `events` table (same shape as the feed, plus
`first_seen_at` / `last_seen_at` / `updated_at` / `removed_at`). An event that leaves the
feed keeps its row with `removed_at` set; it is cleared again if the event comes back.
The read-only `schelagg_reader` role can read it (see `db/grants.sql`).

`lib/events.js` holds the feed merge (`buildFeed`), the load plan (`planEvents`), the
write (`writeEvents`, `persistEvents`) and the reader (`queryEvents`), mirroring `lib/db.js`.

## The loader

`.github/workflows/load-events.yml` runs daily at 9:45am CT (8:45am CST), after the 9am
discovery run, plus on demand (`workflow_dispatch`):

1. `scripts/data-branch.sh pull` — overlay the latest feed from the `data` branch.
2. `node scripts/db-migrate.mjs` — apply pending migrations (no-op when up to date).
3. `node scripts/load-events.mjs` — write the feed into Neon.

A failed load writes `scrape-failures/events.md` and opens (or updates) one issue,
"Events load: database write failed"; the issue closes when a load succeeds again.
Without `DATABASE_URL` the load is skipped and the JSON feed stays the fallback.

## Local commands

```sh
npm run db:migrate        # apply db/migrations/*.sql to DATABASE_URL
npm run load:events       # load public/data/events.json into DATABASE_URL
node scripts/geocode-events.mjs --dry   # preview coordinates for the feed's events
node --test test/events.test.mjs test/event-venues.test.mjs
```
