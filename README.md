# Schelagg

Where to play volleyball in Austin: open play, adult training, leagues and Reclub meets, split into indoor / sand / grass,
plus court availability at High Point, The Crossover and Roots' Treehouse Gym. Every session links to its sign-up.

Hosted on GitHub Pages. Everything runs on GitHub Actions; no server or extra accounts.

## How data stays fresh

| Data | How | How fresh |
|---|---|---|
| Court bookings + opening hours (High Point, Crossover, Treehouse) | `scripts/build-courts.mjs` reads their public Skedda calendars | Every ~15 min |
| Reclub meets (Vex Volleyball, Austin Lawn Club) | Headless browser reads each club's upcoming meets | Hourly, 6am–midnight |
| Volleyworld adult sessions | Headless browser reads the Arketa class calendar | Hourly, 6am–midnight |
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
- **Test** (`.github/workflows/test.yml`): tests and script checks on Linux, macOS and Windows.

First-time setup: **Settings → Pages → Source: GitHub Actions**, then run both workflows once from the Actions tab.

## Run locally

Works the same on macOS, Windows and Linux (Node 20.12+). Use the `npm run` commands below in Terminal, PowerShell
or cmd; nothing needs bash. Optional settings go in a `.env` file (copy `.env.example`), never shell-specific
`VAR=value` syntax.

```bash
npm install
npx playwright install chromium   # only needed for npm run scrape
npm test                          # recurrence, hours and parser tests
npm run check:skedda              # checks the court calendars respond to a plain script
npm run courts                    # write public/data/courts.json
npm run scrape                    # rebuild public/data/schedule.json + occurrences.json
npm run dev                       # http://localhost:5173 (serves a live /api/courts if courts.json is absent)
```

`api/courts.js` + `vercel.json` also let the same repo deploy to Vercel with on-request court data, if you prefer that later.

## Independence and the public feed

Schelagg owns its data and knows nothing about the apps that use it. It has no credentials to any consumer's
database and never writes into one. Instead it publishes a feed, and consumers pull it:

- **`public/data/occurrences.json`** (served at `https://bryanw121.github.io/schelagg/data/occurrences.json`):
  every session for every sport and region, expanded into dated occurrences for the next 28 days with absolute
  `starts_at` / `ends_at` instants. Top-level fields are the same for every sport (`sport`, `region`, `timezone`,
  `title`, `venue`, `city`, `level`, `price`, `signup_url`, ...); sport-specific details are in `attributes`
  (volleyball: `surface` is `indoor` / `sand` / `grass`, `type` is `Open play` / `Training` / `League` /
  `Tournament` / `Clinic`; consumers filter on these, so `lib/session.js` flags any other value). `feedVersion` changes
  only for breaking changes.
- A session missing from a run is gone at the source, so a consumer that mirrors the feed should delete upcoming
  rows that are no longer in it (that's how cancellations propagate) and treat a feed whose `generatedAt` is many
  hours old as stale.

vteam (the volleyball app) is one such consumer: a scheduled function in its own Supabase project pulls this feed
hourly and keeps only `sport: volleyball`, `region: austin`. Keep it that way: nothing in this repo should depend on
vteam or its database.

## Layout

```
config/sources.json      every scrape source: adapter, sport, region, time zone, platform options
lib/registry.js          loads + validates the config; maps adapter names to scripts/adapters/
lib/session.js           the normalized session (schema v2) and its publish checks
lib/occurrences.js       sessions -> dated occurrences (the public feed)
lib/skedda.js            Skedda fetch, recurrence expansion, opening hours
lib/time.js              time-zone-aware date helpers
lib/paths.js             repo-anchored paths + .env loading (any OS)
scripts/build-courts.mjs court calendars -> public/data/courts.json
scripts/scrape.mjs       hourly job: run every configured source, validate, write schedule + feed
scripts/adapters/        one module per platform or site
data/manual.json         hand-checked sessions
data/public-courts.json  free city courts
public/                  the site (index.html, app.js, styles.css, data/)
api/courts.js            optional live API (Vercel / local dev)
test/                    node:test suites
```

## Adding a venue, sport or region

Every source is an entry in `config/sources.json`. Each entry names an `adapter` and gets its `sport`, `region` and
`timezone` from `defaults` unless it sets its own, so another sport or city is just entries with different values.

- **On a platform we already read** (another Reclub club, another ACES page): add it to that source's `options` in
  `config/sources.json`. No code.
- **A new platform or site**: add `scripts/adapters/<name>.mjs` exporting `scrape({ browser, ref, options })` (plus a
  pure `parse` you can test with copied page text), register it in `ADAPTERS` in `lib/registry.js`, and add a config
  entry. Platform adapters should take venue details from `options` so one adapter serves many venues.
- **Court calendars on Skedda**: add it to `VENUES` in `lib/skedda.js`.
- **No machine-readable source**: add it to `data/manual.json` with `verifiedAt` (tagged with the config defaults).

Every session is checked before it's published (`lib/session.js`): malformed ones are dropped and listed as warnings
on their source. The site (`public/app.js`) is still volleyball-shaped (surface filters); add a sport filter there
when a second sport goes live.
