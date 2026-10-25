# Schelagg

Where to play volleyball in Austin: open play, adult training, leagues and Reclub meets, split into indoor / sand / grass,
plus court availability at High Point, The Crossover and Roots' Treehouse Gym. Every session links to its sign-up.

Hosted on GitHub Pages. Everything runs on GitHub Actions; no server or extra accounts.

## How data stays fresh

| Data | How | How fresh |
|---|---|---|
| Court bookings + opening hours (High Point, Crossover, Treehouse) | `scripts/build-courts.mjs` reads their public Skedda calendars | Every ~15 min |
| Reclub meets (Vex Volleyball, Austin Lawn Club) | Plain fetch of each club page and its meet pages (server-rendered meet data) | Hourly, 6am–midnight; live via `/api/check` |
| Volleyworld adult sessions | Arketa's public schedule API (the JSON its booking widget reads), incl. cancellations and spots left | Hourly, 6am–midnight; live via `/api/check` |
| ACES open play (Volleyworld) | Headless browser reads each ACES open-play page | Hourly, 6am–midnight |
| ATX Beach open play | TeamUp membership page | Hourly, 6am–midnight |
| Austin Velocity adult open play | Season dates on their adult page, so it switches itself on/off | Hourly, 6am–midnight |
| Everything else (Sand Social, Hanovers, leagues) | `data/manual.json`, hand-checked. Each scrape run watches each source page and flags it if the page changes | `verifiedAt` age |

**Private bookings open to sign-ups.** When a court booking on a Skedda calendar starts and ends within 15 minutes of a
Reclub meet at the same gym, the chart shows that block in blue with a link to sign up. Skedda hides who booked a slot,
so this is how we tell a rental that's open to the public from one that isn't.

If a scraper breaks, its last good sessions stay up marked **Couldn't recheck**, and the workflow opens a GitHub issue.
If a court calendar can't be read, the last good copy from the live site stays up, marked as such.

## Workflows

- **Deploy site** (`.github/workflows/pages.yml`): every 15 minutes, on every push, and after each schedule refresh.
  Fetches court calendars, then publishes `public/` to GitHub Pages.
- **Refresh schedules** (`.github/workflows/scrape.yml`): hourly, 6am to midnight Austin time. Runs tests, scrapes,
  commits `public/data/schedule.json` and the public feed `public/data/occurrences.json`. A failing source keeps one
  issue open and comments on it.
- **Test** (`.github/workflows/test.yml`): unit + integration tests and script checks on Linux, macOS and Windows,
  plus the site e2e in Chromium on Linux.

First-time setup: **Settings → Pages → Source: GitHub Actions**, then run both workflows once from the Actions tab.

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
npm run scrape                    # rebuild public/data/schedule.json + occurrences.json
npm run dev                       # http://localhost:5173 (+ live /api/courts and /api/check)
```

`api/courts.js`, `api/check.js` + `vercel.json` also let the same repo deploy to Vercel with on-request data (see
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
- A session missing from a run is gone at the source, so a consumer that mirrors the feed should delete upcoming
  rows that are no longer in it (that's how cancellations propagate) and treat a feed whose `generatedAt` is many
  hours old as stale.

vteam (the volleyball app) is one such consumer: a scheduled function in its own Supabase project pulls this feed
hourly and keeps only `sport: volleyball`, `region: austin`. Keep it that way: nothing in this repo should depend on
vteam or its database.

### Live API

Two small JSON endpoints for views that need fresher data than the hourly feed (e.g. a booking screen). They run as
Vercel functions (`api/*.js`, deployed with `vercel.json`; GitHub Pages only serves the static feed, so the API exists
once the repo is deployed to Vercel) and locally under `npm run dev`. Both are `GET` only, send
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

#### `GET /api/courts?days=7`

Live court bookings and opening hours for High Point, The Crossover and Treehouse (Skedda), `days` 1 to 21 from today:
`{ fetchedAt, from, days, venues: [...], errors: [...] }`. A venue that fails keeps its last good copy marked `stale`.

## Layout

```
config/sources.json      every scrape source: adapter, sport, region, time zone, platform options
lib/registry.js          loads + validates the config; maps adapter names to scripts/adapters/
lib/session.js           the normalized session (schema v2) and its publish checks
lib/occurrences.js       sessions -> dated occurrences (the public feed)
lib/skedda.js            Skedda fetch, recurrence expansion, opening hours
lib/check.js             live re-check of one session (behind api/check.js)
lib/pipeline.js          runScrape + buildCourts: the scheduled jobs, with injectable paths / fetch / clock
lib/devalue.js           reads Nuxt's __NUXT_DATA__ payload (Reclub pages)
lib/http.js              plain GET for API/page adapters
lib/time.js              time-zone-aware date helpers
lib/paths.js             repo-anchored paths + .env loading (any OS)
scripts/build-courts.mjs court calendars -> public/data/courts.json (buildCourts)
scripts/scrape.mjs       hourly job: run every configured source, validate, write schedule + feed (runScrape)
scripts/sanitize-fixtures.mjs  strips personal data from captured fixtures (run by capture-fixtures.mjs)
scripts/adapters/        one module per platform or site
data/manual.json         hand-checked sessions
data/public-courts.json  free city courts
public/                  the site (index.html, app.js, styles.css, data/)
api/courts.js            live court bookings (Vercel / local dev)
api/check.js             live re-check of one session (Vercel / local dev)
test/                    node:test suites (npm test); never touch the network: fetch is injected, fixtures in test/fixtures
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
- **Court calendars on Skedda**: add it to `VENUES` in `lib/skedda.js`.
- **No machine-readable source**: add it to `data/manual.json` with `verifiedAt` (tagged with the config defaults).

Every session is checked before it's published (`lib/session.js`): malformed ones are dropped and listed as warnings
on their source. The site (`public/app.js`) is still volleyball-shaped (surface filters); add a sport filter there
when a second sport goes live.
