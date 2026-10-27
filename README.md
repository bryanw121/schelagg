# Schelagg

Where to play volleyball in Austin: open play, adult training, leagues and Reclub meets, split into indoor / sand / grass,
plus court availability at High Point, The Crossover and Roots' Treehouse Gym. Every session links to its sign-up.
Also public ice skating (the site's sport switcher; `?sport=ice_skating` links straight to it).

Hosted on GitHub Pages. Everything runs on GitHub Actions; the only optional extras are a Postgres database on Neon
(see [Database (Neon)](#database-neon)) and the Vercel API.

## How data stays fresh

| Data | How | How fresh |
|---|---|---|
| Court bookings + opening hours (High Point, Crossover, Treehouse) | `scripts/build-courts.mjs` reads their public Skedda calendars | Every ~15 min |
| Reclub meets (Vex Volleyball, Austin Lawn Club) | Plain fetch of each club page and its meet pages (server-rendered meet data) | Hourly, 6am–midnight; live via `/api/check` |
| New Reclub clubs | `scripts/discover-reclub.mjs` searches the web for Reclub meets in the area and opens a pull request per new club (see [Discovering Reclub clubs](#discovering-reclub-clubs)) | Daily |
| Volleyworld adult sessions | Arketa's public schedule API (the JSON its booking widget reads), incl. cancellations and spots left | Hourly, 6am–midnight; live via `/api/check` |
| ACES open play (Volleyworld) | Headless browser reads each ACES open-play page | Hourly, 6am–midnight |
| ATX Beach open play | TeamUp membership page | Hourly, 6am–midnight |
| Austin Velocity adult open play | Season dates on their adult page, so it switches itself on/off | Hourly, 6am–midnight |
| Ice skating: Chaparral Ice, Ice & Field at the Crossover | `scripts/adapters/daysmart.mjs` reads each rink's public DaySmart events API, keeping only published public/adult skate event types on the listed rinks | Hourly, 6am–midnight |
| Ice skating: Bee Cave on Ice, Four Seasons Ice Rodeo (seasonal outdoor) | `data/manual.json`: posted hours for the season, page watched for changes | `verifiedAt` age |
| Everything else (Sand Social, Hanovers, leagues) | `data/manual.json`, hand-checked. Each scrape run watches each source page and flags it if the page changes | `verifiedAt` age |

**Private bookings open to sign-ups.** When a court booking on a Skedda calendar starts and ends within 15 minutes of a
Reclub meet at the same gym, the chart shows that block in blue with a link to sign up. Skedda hides who booked a slot,
so this is how we tell a rental that's open to the public from one that isn't.

If a scraper breaks, its last good sessions stay up marked **Couldn't recheck**, and the workflow opens a GitHub issue.
If a court calendar can't be read, the last good copy from the live site stays up, marked as such.

### Consolidating sources

After validation, `lib/consolidate.js` (#20):

- **Venues.** Each session's venue name is matched to `config/venues.json` by name or alias, ignoring case and
  punctuation, and gets a `venueId`. A name that isn't listed becomes a source warning, so it shows up in the
  "source changed" issue; add it as a venue or an alias.
- **Moves.** A dated session whose date or start changed since the last run keeps its id and becomes `rescheduled`,
  with `previousStart`, until it's over or moves back. The site shows "Moved from 7:30pm".
- **Duplicates.** The same session from two sources (same sport, venue and date, start within 15 minutes, similar
  title) shows once. The first source in config order keeps it and links the other ("Also on Reclub"), filling in
  fields it lacks (`fieldSources` says which). `schedule.json`'s `merged` lists what was merged.

### Catching source changes

A scraper that throws is the easy case. The harder one is a source that changes and the scrape keeps "working": a class
gets renamed and drops out of the adult filter, an API field is renamed so capacity quietly disappears, or a page edits the
price the adapter hard-codes. After every scrape, `lib/health.js` compares the run with the last ones (stored in
`data/health.json`) and reports:

| Check | Catches |
|---|---|
| **Broken** | A source failing in a way an outage doesn't explain (a response that doesn't parse, a parser error, a missing data array), reported on the first failure |
| **Fewer sessions than usual** | A source returning a third or less of its usual count (median of the last 10 runs) |
| **More sessions than usual** | A source returning 3× or more its usual count (a filter stopped excluding youth classes, duplicates) |
| **Field disappeared** | A field most sessions had (`capacity`, `price`, `end`, ...) now missing from all of them |
| **API data changed shape** | A key the adapter reads (`reads` in Volleyworld and Reclub) gone from the raw data, with the keys that appeared |
| **Page changed** | The schedule lines ATX Beach and Velocity are read from changed, so details their adapters fill in may be stale |
| **New warning** | A new validation or adapter warning, such as a Reclub venue missing from `config/sources.json` |
| **Hand-checked session** | A `data/manual.json` source page that changed or can't be watched, an entry not verified in 30 days, or one dropped for malformed data |

New findings go to a **Schedule scrape: source changed** issue (one open issue, with a comment per new batch) and the
run summary. Each is reported once; when the problem clears it's forgotten, so a recurrence is reported again. Close the
issue once you've adjusted the adapter, config or manual data. The **source failed** issue closes itself once every
source scrapes again.

### Auto-fix

Right after a scrape that reports a new source finding (hand-checked sessions alone don't start it), the **autofix**
job in `.github/workflows/scrape.yml` runs Claude Code ([claude-code-action](https://github.com/anthropics/claude-code-action))
with the instructions in `.github/autofix-prompt.md`. It inspects the source (`node scripts/inspect-source.mjs <sourceId>`
saves the raw responses under the git-ignored `tmp/`), adapts the adapter or config, and adds a test. Then
`.github/autofix-finish.sh` (always the copy committed on `main`) decides:

| Result | What happens |
|---|---|
| Every gate passes | Merged to `main`, a fresh scrape starts, and the issue gets a comment |
| A gate fails | A pull request assigned to you, listing which gates failed |
| `npm test` fails | Nothing is pushed; the failure goes on the issue |
| No safe change | Claude's reasoning goes on the issue |

The gates: only adapters, `config/sources.json`, the fixture sanitizer and parser tests changed; existing parser tests
and fixtures are untouched (a fix may only add tests and new fixture files, so it can't pass by rewriting what a test
expects); `npm test` passes; the site e2e passes; and `scripts/verify-fix.mjs` re-runs the whole scrape live with the
fix, against the health baseline from before the source changed, and finds the reported problems gone, no source newly
broken, and the sessions that exist before and after keeping their ids, dates, times, venues and surfaces (one real
reschedule per source is allowed). Page-changed findings (new prices or wording) always go to review.

Failures are split by cause (`classifyError` in `lib/health.js`). A **format** failure (the source answered, but not in
a shape the adapter understands) starts the auto-fix on that same run. A **transient** one (network errors, timeouts,
5xx, 429, 401/403 blocks) waits for 3 failed scrapes in a row (about 3 hours), since it's usually an outage that an
adapter change can't fix.

Setup (once): run `claude setup-token` (uses your Claude Pro/Max subscription, not API billing) and add the token as the
repository secret `CLAUDE_CODE_OAUTH_TOKEN`. Without it the job is skipped. The token lasts a year; when it expires the
job comments on the issue saying so. Optionally enable **Settings → Actions → General → Allow GitHub Actions to create
and approve pull requests** so fixes that need review arrive as pull requests; without it they arrive as a branch with
a one-click link.

Pull requests opened by the job don't trigger the **Test** workflow (a GitHub rule for `GITHUB_TOKEN`); the job already
ran `npm test` and the site e2e.

## Workflows

- **Deploy site** (`.github/workflows/pages.yml`): every 15 minutes, on every push, and after each schedule refresh.
  Fetches court calendars, then publishes `public/` to GitHub Pages.
- **Refresh schedules** (`.github/workflows/scrape.yml`): hourly, 6am to midnight Austin time. Runs tests, migrates
  the database (skipped without the `DATABASE_URL` secret), scrapes, writes the run to the database, and commits
  `public/data/schedule.json`, the public feed `public/data/occurrences.json` and `data/health.json`. A failing
  source keeps one issue open and comments on it; a source that changed what it sends gets its own issue (see
  [Catching source changes](#catching-source-changes)).
- **Discover Reclub clubs** (`.github/workflows/discover.yml`): weekly (Wednesdays). Opens a pull request for each new Reclub club
  running volleyball meets in the area. Searches with Brave (`BRAVE_SEARCH_API_KEY`) or, without it, Claude Code
  (`CLAUDE_CODE_OAUTH_TOKEN`).
- **Discover venues** (`.github/workflows/discover-venues.yml`): weekly. One pull request per sport with new venues
  from OpenStreetMap (and Google Places with `GOOGLE_PLACES_API_KEY`) and where each publishes its schedule.
- **Test** (`.github/workflows/test.yml`): unit + integration tests and script checks on Linux, macOS and Windows,
  plus the site e2e in Chromium on Linux.

First-time setup: **Settings → Pages → Source: GitHub Actions**, then run both workflows once from the Actions tab.

### Discovering venues for any sport

`node scripts/discover.mjs <sport> [region] [--apply]` (#21) takes a sport from `config/discovery.json` and:

1. **Finds venues** in OpenStreetMap through Overpass (free, storable, with coordinates). When `GOOGLE_PLACES_API_KEY`
   is set it also runs Google Places Text Search, keeping only place ids (Google's terms); there's no Google type for
   pickleball or volleyball, so those use text queries.
2. **Matches them** to `config/venues.json` by OSM id, Google place id or name. New ones are candidates, and known
   ones get missing coordinates or ids filled in (never overwritten).
3. **Classifies the schedule** of each new venue from its website: the homepage plus up to 3 schedule-looking links
   on the same site, matched against `config/platforms.json`. The result is a `schedule.surface`:
   `platform:daysmart` (with the account, e.g. `chaparralice`, ready for a `daysmart` source), `login_only`
   (CourtReserve, PodPlay…: link out), `tickets_only`, `website` or `unknown`.

The **Discover venues** workflow runs it weekly for every sport and keeps one pull request per sport
(`discover/venues-<sport>`) with a table of what it found. Merge to add the venues; delete lines from the branch to
drop some; add a name or OSM id to the sport's `ignore` list to never see it again.

### Discovering Reclub clubs

Reclub only lets you browse clubs and meets by sport and location inside its app, so the scraper only reads the clubs
listed in `options.clubs`. Discovery fills that gap from the outside: `scripts/discover-reclub.mjs` runs the web
searches in `options.discover.queries` (Brave Search API), collects the reclub.co meet and club pages they turn up, and
reads each unknown club's meets. A club qualifies when one of its meets is volleyball (`sport`) and is in Reclub's
`community` (its city grouping, `"Austin, TX, USA"`) or within `radiusKm` of `center`. It reads at most 40 Reclub
pages a run, a second apart.

Each new club gets a pull request on `discover/reclub-<slug>` that adds it to `options.clubs`. Merge it and the next
hourly scrape picks the club up (add its venues to `options.venues` if the scrape warns they're missing); close it and
the club is never suggested again. Pull requests opened with the workflow's token don't start other workflows, so
tests run on the next push or scrape. Recall is limited to what search engines have indexed, so a brand-new club can
take a while to show up.

**Cost stays flat as sports and cities are added.** Each run uses at most `maxQueriesPerRun` (10) of the queries,
rotating through the whole list week by week; a longer list means each query comes round less often, not a bigger
run. Claude only ever sees that batch (`--queries discover-queries.json`), runs the searches in parallel, and has at most
25 turns.

Search: with the `BRAVE_SEARCH_API_KEY` secret (https://api.search.brave.com) the script calls Brave itself. Without it,
the workflow has Claude Code run the queries with its web search, using the `CLAUDE_CODE_OAUTH_TOKEN` secret the auto-fix
job already has, and passes the reclub.co URLs it found to `node scripts/discover-reclub.mjs --urls discover-urls.json`.
Claude only lists URLs; the script reads the pages and decides. Locally, put the key in `.env` and run
`node scripts/discover-reclub.mjs` (writes `discover-candidates.json`).

## Run locally

Works the same on macOS, Windows and Linux (Node 20.12+). Use the `npm run` commands below in Terminal, PowerShell
or cmd; nothing needs bash. Optional settings go in a `.env` file (copy `.env.example`), never shell-specific
`VAR=value` syntax.

```bash
npm install
npx playwright install chromium   # only needed for npm run scrape (ACES, ATX Beach, Velocity pages)
npm test                          # unit + integration tests (parsers, API handlers, scrape pipeline), all offline
npm run test:e2e                  # the site in Chromium against server.js, with fixture data (needs playwright's chromium)
npm run check:skedda              # checks the court calendars respond to a plain script
npm run courts                    # write public/data/courts.json
npm run scrape                    # rebuild public/data/schedule.json + occurrences.json (+ the database, if DATABASE_URL is set)
npm run db:migrate                # apply db/migrations to DATABASE_URL (does nothing without it)
npm run dev                       # http://localhost:5173 (+ live /api/courts, /api/check and /api/sessions)
```

`api/courts.js`, `api/check.js`, `api/sessions.js` + `vercel.json` also let the same repo deploy to Vercel with on-request data (see
[Live API](#live-api)).

## Independence and the public feed

Schelagg owns its data and knows nothing about the apps that use it. It has no credentials to any consumer's
database and never writes into one. Instead it publishes a feed, and consumers pull it:

- **`public/data/occurrences.json`** (served at `https://bryanw121.github.io/schelagg/data/occurrences.json`):
  every session for every sport and region, expanded into dated occurrences for the next 28 days with absolute
  `starts_at` / `ends_at` instants. Top-level fields are the same for every sport (`sport`, `region`, `timezone`,
  `title`, `venue`, `city`, `level`, `price`, `signup_url`, ...); sport-specific details are in `attributes`
  (volleyball: `surface` is `indoor` / `sand` / `grass`, `type` is `Open play` / `Training` / `League` /
  `Tournament` / `Clinic`; consumers filter on these, so `lib/session.js` flags any other value; where the source
  says, also `capacity`, `spotsLeft`, `full`, `waitlist`). `feedVersion` changes only for breaking changes.
- Also on each occurrence (added without a version bump, new keys only): `venue_id` (canonical venue from
  `config/venues.json`, or null), `status` (`scheduled` / `cancelled` / `rescheduled`, OpenActive's vocabulary) and
  `previous_starts_at` (where a rescheduled session was). `canceled` stays for existing consumers.
- **`public/data/<sport>.ics`** (`volleyball.ics`, `ice_skating.ics`): the same occurrences as calendar subscriptions.
  Cancelled sessions stay in with `STATUS:CANCELLED` and every occurrence keeps its UID, so a move shows as a move.
- A session missing from a run is gone at the source, so a consumer that mirrors the feed should delete upcoming
  rows that are no longer in it (that's how cancellations propagate) and treat a feed whose `generatedAt` is many
  hours old as stale.

vteam (the volleyball app) is one such consumer: a scheduled function in its own Supabase project pulls this feed
hourly and keeps only `sport: volleyball`, `region: austin`. Keep it that way: nothing in this repo should depend on
vteam or its database.

### Live API

Scheduled refreshes push their output (`public/data/schedule.json`, `occurrences.json`, `data/watch.json`, `data/health.json`) to the **`data` branch**, never `main` (`scripts/data-branch.sh`). Vercel deploys `main` only (`git.deploymentEnabled` in `vercel.json` turns the `data` branch off), so a refresh never uses a Vercel deployment: every push Vercel builds counts against its daily limit, even a skipped build. GitHub Pages is built from `main` with the `data` branch laid over it, and `/api/check` reads the latest published schedule from Pages (falling back to the copy bundled with the function). The copies of those files on `main` are only a seed for local development.

Small JSON endpoints for views that need fresher data than the hourly feed (e.g. a booking screen) or one window of it. They run as
Vercel functions (`api/*.js`, deployed with `vercel.json`; GitHub Pages only serves the static feed, so the API exists
once the repo is deployed to Vercel) and locally under `npm run dev`. All are `GET` only, send
`access-control-allow-origin: *` (an `OPTIONS` preflight gets `204`), and are cached at the CDN for 60 seconds
(`cache-control: public, s-maxage=60, stale-while-revalidate=120`), so every caller sees data at most a minute or two old.

#### `GET /api/check?session=<id>`

Re-checks one session at its source right now, for the moment someone taps "Sign up". `<id>` is a feed row's `id`
(the same as the session id for dated sessions, e.g. `reclub-VONMM8`, `volleyworld-2026-10-27-20:30-georgetown`).
The id must match `^[A-Za-z0-9][A-Za-z0-9:_-]{2,99}$` and belong to a configured source (its published `sourceId`,
else the source id it starts with); each adapter then checks its own id format. Nothing from the request is ever
used as a URL: adapters only call their own fixed hosts. The source gets about 4 seconds.

```jsonc
// 200
{
  "id": "reclub-VONMM8",
  "sourceId": "reclub",
  "published": true,                 // the id is in the current schedule.json
  "status": "scheduled",             // see below
  "checkedAt": "2026-10-25T20:00:00.000Z",
  "changes": ["start", "end"],       // only with status "changed": fields that differ from what was published
  "session": { ... },                // the session as the source has it now (schema v2), when found
  "occurrence": { ... }              // the same, shaped like a row of occurrences.json (starts_at, canceled, ...)
}
// 400  { "error": "..." }           malformed id, or no configured source owns it
// 405  { "error": "GET only" }
```

| `status` | Meaning | What a consumer should do |
|---|---|---|
| `scheduled` | Found at the source and matches what was published | Let them sign up |
| `canceled` | The source marks it canceled | Show canceled; don't send them to sign up |
| `changed` | Still on, but date/time/venue moved (`changes`, `session`). For Volleyworld a moved class has a new id; `session.id` is it | Show the new details before sending them on |
| `gone` | The source no longer lists it (meet page 404s, class no longer on that day) | Treat as canceled; the next feed run drops it |
| `unknown` | No fast source for it (ACES, ATX Beach, Velocity, hand-checked sessions), or the source failed or timed out (`error`: `"timeout"` / `"source unavailable"`) | Fall back to the feed; send them to the sign-up link |

Failed/timed-out checks are cached for only 5 seconds (`s-maxage=5`). Volleyworld asks Arketa for that one local day;
Reclub fetches that meet's page. Adapters implement it as
`check({ sessionId, options, timezone, expected, now, fetch, signal }) -> { status, session?, changes?, checkedAt }`,
where `expected` is the published session (if any) and `signal` aborts at the timeout.

#### `GET /api/sessions?sport=&region=&from=&to=`

Occurrences starting on local dates `from` to `to` (inclusive, `YYYY-MM-DD`, in each row's own time zone), optionally
for one `sport` / `region` (lowercase slugs). `from` defaults to today (Austin time) and `to` to 28 days after `from`;
a window may be at most 60 days. Each item is exactly an `occurrences.json` row, in the feed's order:

```jsonc
// 200 (cache-control: public, max-age=60, s-maxage=60, stale-while-revalidate=120)
{ "feedVersion": 1, "generatedAt": "...", "from": "2026-10-25", "to": "2026-11-22", "sport": "volleyball", "region": "austin", "occurrences": [ ... ] }
// 400  { "error": "..." }           bad date or slug, to before from, more than 60 days
// 503  { "error": "schedule unavailable" }
```

It reads the database with `DATABASE_URL_READONLY`, so past windows work too (history is kept). Without it, or if the
database fails or has no run yet, it filters the published `occurrences.json` (Pages, then the copy bundled with the
function). The `x-schelagg-source` header says which: `db`, `feed` or `bundled`. With `DATABASE_URL_READONLY` set,
`/api/check` also takes the published sessions from the database, with the same fallbacks as before.

#### `GET /api/courts?days=7`

Live court bookings and opening hours for High Point, The Crossover and Treehouse (Skedda), `days` 1 to 21 from today:
`{ fetchedAt, from, days, venues: [...], errors: [...] }`. A venue that fails keeps its last good copy marked `stale`.

## Database (Neon)

Schelagg's own Postgres database (on Neon) is the source of truth for what was scraped; the JSON files above are still
written from the same run and published unchanged, as a compatibility feed, so consumers keep working without
changes. Until the connection strings below are set, everything here is inert: the scrape writes files only, the
migration step prints a notice, and the API serves the published files.

**What's stored** (`db/migrations/0001_init.sql`):

| Table | Holds |
|---|---|
| `sources` | Every scrape source plus `manual`: sport, region, adapter, `last_ok_at`, `last_error`, `last_checked_at`, `count` |
| `sessions` | The published sessions (schema v2). Stable fields are columns (`title`, `venue`, `date`, `days`, `start_time`, `signup_url`, `canceled`, ...); sport-specific ones in `attributes` (same split as the feed); the session exactly as `schedule.json` has it in `data`. `first_seen_at`, `last_seen_at`, `updated_at`; `removed_at` once it leaves the schedule (cleared if it returns) |
| `occurrences` | The feed's dated rows, keyed by occurrence id: `starts_at` / `ends_at`, `local_date`, sport, region, `session_id`, `canceled`, and the full feed object in `data` |
| `session_changes` | History: `added`, `changed` (with `fields`), `canceled`, `uncanceled`, `removed`, with `before` / `after` |
| `scrape_runs` | One row per run: start / finish, `generated_at`, `ok`, per-source `summary`, health `findings`, write `stats` |

Each run is written in one transaction (`writeRun` in `lib/db.js`), with the same rules as the files:

- A source that fails keeps its last good sessions and upcoming occurrences; nothing of it is marked removed.
- A session missing from a source that succeeded gets `removed_at` and a `removed` change, and its upcoming
  occurrences are deleted (that's a cancellation). A dated session that is simply over expires quietly (`removed_at`,
  no change entry). Past occurrences are kept as history.
- Upcoming occurrences (from the run's time) of every source that succeeded are replaced by the run's feed.
- `changed` ignores bookkeeping and live availability (`verifiedAt`, `checkFailed`, `spotsLeft`, `full`, ...); the
  row still holds their current values.
- A run already written (same `generatedAt`) is skipped, so a retry is safe.

A failed database write never fails the scrape: it's logged, added to `scrape-failures.md` (so the **source failed**
issue reports it) and the step summary, and the JSON feed is published as usual.

**Connection strings** (Neon's pooled connection strings, with `sslmode=require`; never commit them):

| Variable | Where | Role |
|---|---|---|
| `DATABASE_URL` | GitHub repository secret, used by the scrape workflow | The owner role: runs migrations and writes each scrape |
| `DATABASE_URL_READONLY` | Vercel environment variable | `schelagg_reader`: read-only, for `/api/sessions` and `/api/check` |

**Migrations.** `scripts/db-migrate.mjs` (`npm run db:migrate`) applies `db/migrations/NNNN_name.sql` files not yet
in `schema_migrations`, each in a transaction, then `db/grants.sql`. It runs before every scrape and is idempotent;
add a new numbered file rather than editing one that has been applied. Without `DATABASE_URL` it exits 0 with a notice.

**Read-only role.** Migrations don't create roles. Once, in the Neon SQL editor as the owner, run
`create role schelagg_reader with login password '<generate one>';` (in SQL, not the console's Roles page, which
makes roles members of `neon_superuser`). The next migration run's `db/grants.sql` gives it `SELECT` on the tables
above (and on tables later migrations add); until the role exists that file does nothing. Build
`DATABASE_URL_READONLY` from it.

**Setup, once:** create the Neon project and database; add its owner connection string as the `DATABASE_URL`
repository secret; run **Refresh schedules**; create `schelagg_reader` as above and run it again; set
`DATABASE_URL_READONLY` in Vercel.

**Independence.** The database is Schelagg's alone. It holds no vteam credentials or data, and vteam has no
credentials to it: consumers keep reading the published feed (or the public API). Don't connect the two.

## Layout

```
config/sources.json      every scrape source: adapter, display name, sport, region, time zone, platform options
config/venues.json       canonical venues: id, name, city, aliases, parent, external ids (#20)
config/discovery.json    sport discovery: regions, OSM selectors and Google queries per sport (#21)
config/platforms.json    booking/schedule platform fingerprints (hosts, account pattern, adapter)
scripts/discover.mjs     sport + region -> venues and their schedule surfaces (review PR per sport)
lib/consolidate.js       venues, moves (status / previousStart) and cross-source dedup
lib/ics.js               per-sport calendar files from the feed
lib/registry.js          loads + validates the config; maps adapter names to scripts/adapters/
lib/session.js           the normalized session (schema v2) and its publish checks
lib/occurrences.js       sessions -> dated occurrences (the public feed)
lib/skedda.js            Skedda fetch, recurrence expansion, opening hours
lib/check.js             live re-check of one session (behind api/check.js)
lib/pipeline.js          runScrape + buildCourts: the scheduled jobs, with injectable paths / fetch / clock
lib/db.js                Postgres storage: connect, migrate, writeRun / persistRun, API reads (see Database)
lib/devalue.js           reads Nuxt's __NUXT_DATA__ payload (Reclub pages)
lib/http.js              plain GET for API/page adapters
lib/time.js              time-zone-aware date helpers
lib/paths.js             repo-anchored paths + .env loading (any OS)
scripts/build-courts.mjs court calendars -> public/data/courts.json (buildCourts)
scripts/scrape.mjs       hourly job: run every configured source, validate, write schedule + feed (runScrape) + database
scripts/discover-reclub.mjs  daily search for Reclub clubs not in the config (candidates; --apply <slug>)
scripts/db-migrate.mjs   apply db/migrations + db/grants.sql to DATABASE_URL
db/                      migrations/NNNN_name.sql and grants.sql (the read-only role's SELECT)
scripts/sanitize-fixtures.mjs  strips personal data from captured fixtures (run by capture-fixtures.mjs)
scripts/adapters/        one module per platform or site
data/manual.json         hand-checked sessions
data/public-courts.json  free city courts
public/                  the site (index.html, app.js, styles.css, data/)
api/courts.js            live court bookings (Vercel / local dev)
api/check.js             live re-check of one session (Vercel / local dev)
api/sessions.js          occurrences for a window, from the database or the feed (Vercel / local dev)
test/                    node:test suites (npm test); never touch the network: fetch is injected, fixtures in test/fixtures;
                         database tests run real Postgres in-process (PGlite)
e2e/                     Playwright site test (npm run test:e2e)
```

## Adding a venue, sport or region

Every source is an entry in `config/sources.json`. Each entry names an `adapter` and gets its `sport`, `region` and
`timezone` from `defaults` unless it sets its own, so another sport or city is just entries with different values.

- **On a platform we already read** (another Reclub club, another ACES page): add it to that source's `options` in
  `config/sources.json`. No code.
- **A new platform or site**: add `scripts/adapters/<name>.mjs` exporting `scrape({ browser, ref, options, timezone })`
  (plus a pure `parse` you can test with a captured response), register it in `ADAPTERS` in `lib/registry.js`, and add
  a config entry. Platform adapters should take venue details from `options` so one adapter serves many venues. Prefer
  a public API or server-rendered data over the headless browser, and export `needsBrowser = false` when you don't
  need it: the hourly scrape only starts Chromium if some source does. If the source can answer for one session
  quickly, also export `check()` (see [Live API](#live-api)). The "Capture source fixtures" workflow saves raw
  responses under `test/fixtures/sources/` to test against, run through `scripts/sanitize-fixtures.mjs` first
  (the repo is public: no hosts, participants, notes or tokens; a test fails if an email or phone number slips in).
- **A rink on DaySmart Recreation**: add a `daysmart` source with its `company` code, the `eventTypes` to keep
  (`/dash/jsonapi/api/v1/event-types?company=<code>` lists them) and the `resources` (rink sheets) to read. The raw
  API also returns private rentals; only `publish: true` events of listed types are kept.
- **Court calendars on Skedda**: add it to `VENUES` in `lib/skedda.js`. Each venue in `courts.json` / `/api/courts` has `calendar` (the booking page) and `calendarDay`, a template with `{date}` (YYYY-MM-DD) that opens the booking page on that day; a platform with no per-day link leaves `calendarDay` out, so consumers fall back to `calendar`.
- **No machine-readable source**: add it to `data/manual.json` with `verifiedAt` (tagged with the config defaults).

Every session is checked before it's published (`lib/session.js`): malformed ones are dropped and listed as warnings
on their source. The site (`public/app.js`) is still volleyball-shaped (surface filters); add a sport filter there
when a second sport goes live.
