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

## November 3 expansion and separate booking view

Volleyball and pickleball now have separate **Open play** and **Court booking** views, persisted locally and shareable with `?view=booking`. Open play contains dated sessions; booking contains existing Skedda court occupancy/availability for volleyball and venue booking links for pickleball. No pickleball vacancies are inferred from facility opening hours. Ice skating retains its public-skate view.

| Venue | Added coverage | Source / limits |
| --- | --- | --- |
| Austin PickleHaus | Dated public OpenCourt sessions with nonmember prices; hours 7am–midnight; private court booking link | [Official site](https://www.austinpicklehaus.com/), [public club page](https://app.getopencourt.com/club/austinpicklehaus). November 3 live check: 9 sessions. Homepage preview is limited. |
| Pickle Pit Stop | Directory sessions; $18/person for two hours, included for members; Sun–Thu 6am–10pm, Fri–Sat 6am–11pm, members 24/7 | [Official open-play page](https://picklepitstop.com/book-your-session/courtreserve-open-play-calendar/). November 3 live check: 114 directory sessions. Preserve CourtReserve resId to distinguish recurring occurrences. Apply venue-rate fallback only to two-hour sessions and through review date; it is not an event checkout quote. |
| Pickleland | Calendar and private court links, advertised rentals from $24/hour; Mon–Fri 8am–10pm, weekends 8am–8pm | [Official calendar](https://pickleland.com/calendar), [court booking](https://play.pickleland.com/book/pickleland). Nine indoor courts. Static programs JSON was last maintained in May; do not publish it as a current event feed. |
| Velocity / Crossover Diamond Courts | Source-linked recurring open-play notice: Tue/Thu 8am–noon, $5 drop-in; six indoor courts | [Official schedule](https://www.austinvelocity.com/rentals/pickleball). No registration; waiver required. Facility events can change the recurrence. Shown as a venue calendar notice, not imported dated sessions. |
| Austin Tennis & Pickleball Center | Private court booking; $5/person; singles up to 90 minutes, doubles 120 | [Official fees](https://playtennis.usta.com/austintenniscenter/Booking/CourtPricing), [booking](https://playtennis.usta.com/austintenniscenter/Booking/BookByDate). No current open-play timetable verified. |
| Bouldin Acres Braker | Private court booking: $10/half-hour Mon–Thu 11am–6pm, $20 evenings and Fri–Sun; league holds Mon/Wed 6–10pm | [Official venue page](https://braker.bouldinacres.com/pickleball). Early morning bookings apply to South Lamar only. Footer contains a suspect 11am closing time, so do not import that as opening hours. |

The directory live check also returned 80 Ranch and 109 Eastside sessions. These are point-in-time observations, not guaranteed availability. New editorial rates/details require re-review after November 30.

Remaining source audit: Picklr Austin West, Kingdom, YMCA/Pickleball Den, JCC, community organizers and the conflicting municipal schedules noted above. Access-restricted calendars need public-source alternatives or an approved integration. Do not interpret memberships, all-day park access, lessons or leagues as public drop-in events.

## November 4 additions: Dove Springs, Gus Garcia, Georgetown and Leander

Checked November 4, 2026 against each official page. The build environment's proxy blocks these hosts, so the pages
were read through a text rendering (WebFetch), not as raw HTML. Every time, day and price below was re-read on the
official page that day; anything that could not be confirmed was left out.

| Venue | Open play (verified Nov 4) | Price shown | Source / limits |
| --- | --- | --- | --- |
| George Morales Dove Springs Recreation Center, 5801 Ainez Dr, Austin, TX 78744 | Mon 9am–noon; Wed 6–8:30pm; Fri 9am–noon. Indoor, 3 courts | Price not published | [City programming page](https://www.austintexas.gov/parks/programs/pickleball); [venue page](https://www.austintexas.gov/parks/locations/george-morales-dove-springs-recreation-center) gives the address and no conflicting times. |
| Gus Garcia Recreation Center, 1201 E Rundberg Ln, Austin, TX 78753 | Tue & Thu 11am–1pm; Sat 10am–noon; Sun 1–2:30pm. Indoor, 1 multi-purpose court striped for 3 | Price not published | City programming page; [venue page](https://www.austintexas.gov/parks/locations/gustavo-gus-l-garcia-recreation-center) gives the address and no conflicting times. |
| Georgetown Recreation Center, 1003 N Austin Ave, Georgetown, TX 78626 | Tue & Thu 8am–noon (4 courts from 9am); Wed 6–8:45pm (3 courts); Sun noon–3pm (3 courts). Indoor, 6 lined courts; drop-in only, first come, no reservations | $6 day pass; included with membership | [Official Georgetown pickleball page](https://parks.georgetown.org/?p=18244). "Scheduled days and times of play are subject to change." |
| Georgetown Tennis Center, 400 Serenada Dr, Georgetown, TX 78628 | Mon–Thu 6–8pm (4 courts); Fri–Sat 6–8pm (6 courts); Sun 2:30–5:30pm (6 courts). Outdoor | $6 drop-in (nonmember); free for members | Same page, "Georgetown Tennis Center Open Play Pickleball Hours". Reservable courts and the instruction programs are not imported. |
| Leander Activity Center, 11880 Hero Way W, Suite 600, Leander, TX | Mon & Wed 5–9pm. All ages and levels, no registration | $4 / person; $2 Active Adult members (pay at the door) | [Official facility page](https://www.leandertx.gov/981/Leander-Activity-Center). No official page says indoor or outdoor, so the court type is "Court type unlisted". The page gives no ZIP code, so none is added. Courts are slightly larger than regulation size (city's note). |

Left out: **McMaster Athletic Complex** (Georgetown) publishes daylight court access, not open play. The other
municipal centers held back above are unchanged (Austin Recreation Center, Dittmar, Zaragoza, South Austin,
Varsity Generation sessions, Givens, which lists no open play).

**How.** Dove Springs and Gus Garcia join the `austin-pickleball` city adapter's reviewed venues. Their blocks use
"Open Play Schedule:" and a bare "Open Play" heading over one line per day, so the strict grammar now accepts those
two labels; any other text after the label still withholds the venue. Georgetown and Leander use the new
browser-free `official-schedule` adapter (`georgetown-pickleball`, `leander-pickleball` in `sources.json`): each
venue's slots and price are stored in config, read by a person, next to the fingerprint of the page text they were
read from (from the venue's `from` marker to its `to` marker, contact details removed). A run emits that venue's
sessions only while the fingerprint still matches; a changed, missing or ambiguous block is withheld with a warning
showing the new fingerprint, and a page with no recognisable block fails the source (keep-last-good flags it). The
same `reviewedThrough: 2026-11-30` deadline and seven-day window apply, and successful fetches never extend it.
Holiday holds copy the Austin city dates (November 11, 26, 27) for Georgetown and Leander as a conservative default
until those cities' notices are checked.

**Fixtures and first live run.** Because only a text rendering was available, the new fixture blocks
(`test/fixtures/sources/austin-pickleball.html` for the two Austin centers, `georgetown-pickleball.html`,
`leander-pickleball.html`) are rebuilt from it and labelled as such, and the five new `reviewedHash` values are
computed from those rebuilt blocks. The live page's markup may normalise to slightly different text. If it does, the
first scheduled run withholds that venue with "source block changed (fingerprint …)": compare the live block with the
table above and, if the schedule and price are unchanged, put the reported fingerprint in `reviewedHash`.

**OpenPlay directory checks (November 4).** Session names that mark a private or restricted session ("Private",
"Ladies", "Women's", "Men's", "Only", "Invite") are now excluded even when they also say "Open Play"; before, only
names without "open play" were dropped, so "Ladies Only Open Play" would have been published as public open play.
The live directory showed no such names that day. The audit's dates "one day later" come from openplaymap's own
event-detail URLs, which carry the UTC date (an 8pm Nov 4 CST session is `.../events/2026-11-05-...`). The adapter
dates sessions from the event's instants in Austin time and links the venue booking page (Podplay or CourtReserve
URLs carry no date), so imported dates match the heading day; a test pins this.
