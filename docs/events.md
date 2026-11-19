# Austin events: pop-ups, seasonal events, Asian-inspired things

## Where the events come from

- **Listing sites and organizers** (`config/events.json`, `lib/event-sources.js`,
  `scripts/events.mjs`): the scrape workflow reads each page's schema.org Event JSON-LD every 5+
  hours (AllEvents' Austin markets, craft fairs, festivals and food pages; Visit Austin's event
  lists), keeps markets, pop-ups, fairs, festivals and seasonal things (classes, talks, concerts
  and cooking classes are dropped), sorts each into a kind (popup / seasonal) and tags
  (asian-inspired), and merges them into the feed: one copy of each event (dates overlapping,
  titles alike, same place), the listing's link kept and the other copy's pin, price and times
  borrowed. Only pages robots.txt allows; Do512, Eventbrite, the Austin Chronicle and the Lady
  Bird Johnson Wildflower Center refuse automated reading, so they aren't read. Add a page to a
  source's `urls` (or a new source) when it publishes Event JSON-LD.
- **Instagram, through Meta's official API** (`config/instagram.json`, `lib/instagram.js`): when
  the Actions secrets `IG_USER_ID` and `IG_ACCESS_TOKEN` exist, the same step reads each listed
  organizer's recent posts with Business Discovery (business and creator accounts only; nothing
  is scraped and nobody signs in to instagram.com). A post becomes an event only when its caption
  plainly gives an event word, a date after the post and a place (a 📍 line, "at <Place>", or the
  account's `venue`); anything unclear is skipped. The event links to the post and carries our own
  one-line description, never the caption. Without the secrets the step is skipped.
- **Profile pictures** (`lib/avatars.js`): a small copy of each credited account's picture is kept
  under `data/avatars/` (Instagram's links expire; refreshed weekly) and its path is stamped on
  that account's events (`avatar`, `account`). The site shows it on the card ("by @x" for the
  organizer's own post, "via @x" for a credited repost), the map row and the pin; events without
  one look the same as before.
- **Other discovery runs** (Muse) may write events too: the merge keeps their events that the
  listing sites don't already have.

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
deploy), fetched first and in parallel with everything else, since Events is the front page.
A feed covers one region (`region` on the feed or an event; Austin when neither says), and a
city without one says "Events are Austin-only for now" and links to its open play.

The list follows the Sports days: headings for **On now** (ending soonest first), **This
week** / **This weekend**, **Next week**, then each month, four cards under each and "Show N
more". A card is the sessions' `.row`: the date column ("Thru Nov 23", "Sat Nov 21"), a plain
chip for the kind (Pop-up, Seasonal) and a dashed one for each tag (Asian-inspired is a tag:
`category: "asian-inspired"` still works, or send `kind` and `tags`), one main button ("See the
post" for Instagram, "Event page" otherwise), and Details ▾ for the description, directions and
who it was found via. Filters: the "All events ▾" sheet (kind and tags), This weekend, Near me;
links carry `?type=`, `?tag=`, `?weekend=1` (old `?cat=` links still work). Helpers are pure in
`public/events-ui.js` (`eventGroups`, `filterEvents`, `eventWhen`, ...), tested in
`test/events-ui.test.mjs`.

The floating List/Map button switches to the map: one pin per venue. Tapping a pin (or its row
under the map) opens the **place sheet** (`renderPlaceSheet` in `app.js`), in the page's own
colours: a bottom sheet over the map on a phone, a panel docked at the map's left from 760px.
✕, Esc, a tap on the map or a swipe down closes it. Sports pins use the same sheet.

The map's tiles are cut per region by `scripts/build-maps.mjs` (in the deploy); the
region's box folds in the feed's located points within the region's radius
(`lib/map-area.js` `eventPointsForRegion`), so a venue just outside the venues-only box
— Vista Brewing, just south of Austin's — is inside the tiles. The maps cache in
`.github/workflows/pages.yml` is keyed on the region and venue files, `build-maps.mjs`
and `map-area.js`; it does not yet include the feed, so a new event venue outside the
current box only widens the tiles after the monthly cache turn (or a cache-key change).

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

## When

The When pill on Events opens a sheet: a month calendar (a dot on days with events; tap a day, tap it again or
"Any day" to clear) and a time of day
(morning, afternoon, evening, or a From and To). Links carry it as `?on=YYYY-MM-DD&from=HH:MM&to=HH:MM`. An event
that lists hours shows when they overlap the window; one that lists only dates shows on its days, marked "Hours
not listed". The list and the map use the same filters. Sports has the same time pill on open play (the day strip
picks the day); the two tabs never mix. The rules are pure in `public/when.js`.

## Search and tags

The search box sits above the list and the map on Events (and on open play, where it reads session and venue
names). Each keystroke narrows the list; every word typed must start a word in the event's title, place,
organizer, description, kind or tags. Links carry it as `?q=`. Tags come from a fixed word list
(`SEARCH_TAGS` in `public/search.js`): an event has a tag when its title or description has one of the tag's
words, so tags never change from run to run. An event can have several. The tags with events show under the box
only while the box is open, each with its count. Tapping one (there or on a card) shows exactly the events that
carry it (`?topic=`), which is why the count on the tag and the list always agree; typing the same word is a
wider word search.

Every date on the site says its day of the week ("Fri, Nov 20").

## Links

The address always describes what is on screen, so copying it shares it: `view` (events, openplay, booking,
leagues, tournaments; always present on Sports, since a bare link opens Events), `region`, `sport`, `day`
(Sports: a day this week), `court` (the court-type filter), `layout=map`, `place` (the place open on the map),
`event` (the event whose details are open in the list: the link scrolls to it and opens it), plus the filters
above (`type`, `tag`, `on`, `weekend`, `from`, `to`, `q`).

## Map on a phone

The map takes about the top 45% of the screen with its places under it, grouped under the list's headings (On
now, This week, Next week, months). "Expand map" makes the map the whole screen (over the header too); "Collapse
map", at its top left, goes back; the choice is remembered on the device. The place sheet rises from the bottom of the screen.
On the Sports map the day strip and filters fold into one line ("Today · Open play · Sand"); a tap opens them.

## Add to calendar

Every event card and open-play session has a "＋ Calendar" button. Its sheet offers Google Calendar (a link to
Google's new-event page, filled in, in the event's time zone) and Apple Calendar (a one-event calendar file,
which Outlook and others open too). An event on one day with hours becomes a timed entry; one that runs several
days, or lists no hours, becomes whole days with any hours in the note. A session is added for the day it is
listed under. Pure in `public/calendar.js`.

Something that runs for more than one day asks **which day and what time you're going** (both filled in: today or its first day, and its opening time) and adds only that visit: two hours from the time picked, or until it closes; no time adds that one whole day.

The filter chips (kind, When, Near me) and the count sit above the list and above the map alike, so the map view has the same When sheet.

The site's own address is `skellyevents.com`; `schelagg.vercel.app` keeps working (vteam calls it). Any address other than GitHub Pages or a local copy reads data and maps from GitHub Pages.

Every event says when: its hours on the card, the map row and the place sheet, or "Hours on the post / event page" when its source gave none. Listing sites give a date only, so `scripts/events.mjs` reads each such event's own page once for its hours (`fillHours`, remembered in `public/data/event-hours.json`, at most 25 pages a run, only where robots.txt allows).

The Events sheet lists every tag with its count (Asian-inspired plus the search tags: night market, vintage, food, free...); a search tag is one at a time and shows in the search box too.
