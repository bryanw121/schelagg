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
node --test test/events.test.mjs
```
