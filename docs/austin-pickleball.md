# Austin pickleball pilot source review

Checked November 2, 2026 against the [official city programming page](https://www.austintexas.gov/parks/programs/pickleball) and the venue pages below.
City sessions are source-published recurrences, not individually confirmed events. Their pages do not clearly state the open-play fee; the site explicitly says “Price not published” instead of assuming free access. Skill eligibility and capacity remain unset where unverified.

| Venue | Published open play | Venue/address source |
| --- | --- | --- |
| Alamo | Thursday 4–8pm, covered outdoor pavilion | [Venue](https://www.austintexas.gov/parks/alamo-recreation-center): 2100 Alamo St, Austin, TX 78722. Building closes earlier; the program is outdoors. |
| Dottie Jordan | Thursday 4–7pm, outdoor | [Venue](https://www.austintexas.gov/parks/dottie-jordan-recreation-center): 2803 Loyola Lane, Austin, TX 78723. Equipment checkout ends at 6pm. |
| Montopolis | Monday 6–9pm; Saturday 10am–noon, indoor | [Venue](https://www.austintexas.gov/parks/locations/montopolis-recreation-and-community-center): 1200 Montopolis Dr, Austin, TX 78741. |
| Northwest | Monday/Wednesday 10:30am–1:30pm, indoor | [Venue](https://www.austintexas.gov/parks/locations/northwest-recreation-center): 2913 Northland Dr, Austin, TX 78757. |

## Automatic city checks

The browser-free `austin-pickleball` adapter replaces the initial manual entries. It reads the city programming accordion daily, checks each reviewed venue block's normalized fingerprint, and produces seven days of dated sessions. Changed or missing venue blocks are withheld with a warning; other venues continue. Unknown venues are not automatically enrolled. The November 2 live check returned six sessions across four venues with no warnings.

`reviewedThrough: 2026-11-30` is an editorial review deadline, not a season end, and successful fetches never renew it. The source warns seven days before review is due and emits no sessions after expiry. Reconcile the index with venue schedules, access rules and holiday notices before extending it or approving changed fingerprints. An unchanged city page cannot prove that an operator has published every cancellation.

November 11, 26 and 27 are withheld pending venue-specific confirmation based on the [official city holiday calendar](https://www.austintexas.gov/human-resources/official-city-holidays). This does not claim every outdoor court is closed. The source's seven-day dated window ages out on network failure; existing keep-last-good behavior cannot create future weeks indefinitely. A successful changed-block check removes that venue's old sessions instead of retaining its old hours.

Held back: Austin Recreation Center has conflicting end times; Zaragoza's index says Monday evening while its venue page says Wednesday noon–2pm; Dittmar has an expired October schedule. South Austin's all-ages session still needs its gym timetable reconciled. Varsity Generation eligibility is not assumed unrestricted. No lessons, leagues, park hours or private bookings are converted into open-play sessions.

## Private club sessions, prices and opening hours

**Austin Pickle Ranch and Eastside:** the `openplay-directory` adapter reads dated open-play records embedded in the public [OpenPlay Austin calendar](https://openplaymap.com/open-play/austin). This is an independent directory, not a direct venue feed. The November 2 live check returned 183 sessions with listed prices of $12, $15, $17 or $18 per person. Each card identifies its directory provenance, directory update time, and links directly to the venue booking event. Venue-specific skill labels are preserved; missing court type is “Court type unlisted” and appears under All only. No remaining-spot claims are copied. Preview/demo data, stale directory snapshots, lessons, unreviewed venues and unexpected booking hosts are excluded. Source changes fail visibly, preserving the existing flagged last-good behavior.

Both Podplay `/apis/v2/events` and `/apis/v2/community/events` require sign-in. No sign-in, anonymous account creation or credential workaround is used. A sample Ranch event's public Open Graph metadata independently confirmed the directory's date and time; directory prices remain explicitly listed prices, not checkout quotes.

The **Venue hours, prices & calendars** section separates facility hours from open-play sessions:

- [Ranch Braker hours](https://austinpickleranch.com/plan-a-visit/braker): Mon 7am–11pm, Tue–Fri 7am–midnight, Sat 8am–midnight, Sun 8am–11pm. Its [pricing FAQ](https://austinpickleranch.com/faq/how-much-does-it-cost-to-play) directs players to event-specific prices. The [membership page](https://austinpickleranch.com/membership) lists Wrangler $99/month and Trailboss $149/month plus $299 initiation, with eligibility and daily session limits.
- [Eastside hours](https://eastsidepaddleclub.com/openplay): Mon–Fri 6am–10pm, Sat 7am–10pm, Sun 7am–8pm. Its [FAQ](https://eastsidepaddleclub.com/faq) says nonmember open play $15–$18/session, private courts $20–$40/hour, and paddle rental $5. The directory also lists $12 sessions; the UI discloses the discrepancy and directs players to the final booking price.

**Holy Pickle**, 7001 Burnet Rd, Austin, TX 78757: the `opencourt` adapter reads upcoming OpenPlay events from the [venue's public homepage](https://app.getopencourt.com/club/holy-pickle), then each public event detail page for its actual dates, court allocations, public/open status, and nonmember price. The live check returned six dated events, each $10/person. Example: November 3, 7–9pm CST. The [organizer's October announcement](https://buttondown.com/soul_serve/archive/new-open-play-at-holy-pickle-trosky-grand-opening/) corroborates outdoor play and the Burnet address. General facility hours are not published on the booking page, so none are invented. The homepage is a limited preview, not a promise of complete event coverage; its full calendar remains linked.

Both new sources refresh on the 30-minute scrape cadence. UTC event timestamps are converted to Austin time across daylight-saving changes. No recurring club sessions are fabricated. Public page JSON is decoded with JSON.parse, never executed. Only selected event fields are persisted; fixtures contain no participants or contact data. General hours/pricing details were reviewed November 2 and are hidden after November 30 pending recheck; this editorial deadline does not stop the dated club feeds. Picklr, Pickleland and YMCA remain additional coverage work.

Venue addresses pass through `schedule.venues` to card controls. Coordinates remain null until sourced under the existing venue-data policy. Map apps handle driving directions; no user location is requested by these controls and no estimated driving distance is displayed. Copy failures leave the full address visible for manual copying.

Validation: run `npm test` and `npm run test:e2e`. Tests cover source changes, strict time parsing, daylight-saving conversion, holiday holds, review expiry, HTTP failure, browser-free ingestion, dated feed/ICS/database output, sport isolation, directory provenance, price display, unknown court type, map/copy controls and mobile layout. City sessions say “Hours checked”; directory sessions say “Listed today.” Source warnings remain visible. Generated production data is owned by the normal refresh workflow, triggered automatically when source changes deploy.
