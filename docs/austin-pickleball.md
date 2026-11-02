# Austin pickleball pilot source review

Checked November 2, 2026 against the [official city programming page](https://www.austintexas.gov/parks/programs/pickleball) and the venue pages below.
These are source-published recurrences, not individually confirmed events. Costs, skill eligibility and capacity remain unset where unverified.

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

## Private club calendars

Austin Pickle Ranch and Eastside Paddle Club appear in a separate **More venue calendars** section, with addresses and directions. They create no synthetic sessions or availability claims. Their public frontend uses `/apis/v2/events`; unauthenticated GET checks for both tenants returned HTTP 401 on November 2. No sign-in, guest-account creation or credential workaround was attempted. Supported exports or an authorized integration are needed before automated club coverage. Picklr and YMCA remain separate access work.

- [Ranch program](https://austinpickleranch.com/ways-to-play) and [calendar](https://austinpickleranch.podplay.app/community/events?level=Casual&tag=Open+Play): skill and registration requirements vary.
- [Eastside program](https://eastsidepaddleclub.com/openplay) and [calendar](https://espc.podplay.app/community/events): account registration and skill/rating restrictions apply.

Venue addresses pass through `schedule.venues` to card controls. Coordinates remain null until sourced under the existing venue-data policy. Map apps handle driving directions; no user location is requested by these controls and no estimated driving distance is displayed. Copy failures leave the full address visible for manual copying.

Validation: run `npm test` and `npm run test:e2e`. Selected source fixtures omit contact numbers. Tests cover changed/missing blocks, strict time parsing, holiday holds, review expiry, HTTP failure, browser-free ingestion, dated feed/ICS output, sport isolation, map/copy controls, mobile layout and link-only calendars. City sessions say “Hours checked” / “Scheduled now” to distinguish published recurrences from live availability. Source warnings are visible in the freshness section. Generated production data is owned by the normal refresh workflow; this local implementation has not been deployed.
