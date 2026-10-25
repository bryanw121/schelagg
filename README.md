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

- **Deploy site** (`.github/workflows/pages.yml`): every 15 minutes, on every push, and after each nightly refresh.
  Fetches court calendars, then publishes `public/` to GitHub Pages.
- **Refresh schedules** (`.github/workflows/scrape.yml`): nightly. Runs tests, scrapes, commits `public/data/schedule.json`.

First-time setup: **Settings → Pages → Source: GitHub Actions**, then run both workflows once from the Actions tab.

## Run locally

```bash
npm install
npx playwright install chromium   # only needed for npm run scrape
npm test                          # recurrence, hours and parser tests
npm run test:skedda               # checks the court calendars respond to a plain script
npm run courts                    # write public/data/courts.json
npm run scrape                    # rebuild public/data/schedule.json
npm run dev                       # http://localhost:5173 (serves a live /api/courts if courts.json is absent)
```

`api/courts.js` + `vercel.json` also let the same repo deploy to Vercel with on-request court data, if you prefer that later.

## Layout

```
lib/skedda.js            Skedda fetch, recurrence expansion, opening hours
lib/time.js              Austin-time date helpers
scripts/build-courts.mjs court calendars -> public/data/courts.json
scripts/scrape.mjs       nightly job; scrapers in scripts/sources/
data/manual.json         hand-checked sessions
data/public-courts.json  free city courts
public/                  the site (index.html, app.js, styles.css, data/)
api/courts.js            optional live API (Vercel / local dev)
test/                    node:test suites
```

## Adding a venue

- **Uses Skedda?** Add it to `VENUES` in `lib/skedda.js` with its subdomain and court names.
- **Hosts meets on Reclub?** Add the club URL to `CLUBS` in `scripts/sources/reclub.mjs`, and its venue to `VENUES` there.
- **Has a schedule page?** Add `scripts/sources/<name>.mjs` exporting `id`, `parse(text)` and `scrape({ browser, ref })`,
  add a test with copied page text, and register it in `scripts/scrape.mjs`.
- **Neither?** Add it to `data/manual.json` with `verifiedAt`.
