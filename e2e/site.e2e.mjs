// Site end to end: starts the real dev server (server.js on a free port), opens the page in
// Chromium with the clock fixed at Sunday Oct 25 2026, 5pm in Austin, and answers the data
// files from the synthetic schedule / courts below. Every request that isn't to our server
// (Google Fonts, venues) is aborted, and /api/* never reaches the real handlers' network.
//
//   npm run test:e2e                     needs `npx playwright install chromium` once
//   CHROMIUM_PATH=/path/to/chrome ...    use an already-installed Chromium instead (set it in .env)
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { repoPath, loadEnv } from '../lib/paths.js';

loadEnv();

const CLOCK = new Date('2026-10-25T22:00:00Z'); // Sun Oct 25, 5:00pm CDT
const TODAY = '2026-10-25';
const TOMORROW = '2026-10-26';
const SIGNUP = 'https://example.test/signup';

// --- fixture data (synthetic: no real hosts or people) ------------------------------------

const base = { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago', verifiedAt: TODAY };
const SESSIONS = [
  { ...base, id: 'vw-morning', sourceId: 'volleyworld', date: TODAY, start: '09:00', end: '11:00', title: 'Morning Adult Training', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', surface: 'indoor', type: 'Training', signup: { url: `${SIGNUP}/morning`, label: 'Book on Volleyworld' }, source: `${SIGNUP}/morning` },
  { ...base, id: 'sand-now', sourceId: 'atxbeach', date: TODAY, start: '16:00', end: '18:00', title: 'Afternoon Sand Open Play', venue: 'ATX Beach', city: 'North Austin', surface: 'sand', type: 'Open play', price: '$10', signup: { url: `${SIGNUP}/sand-now`, label: 'Drop in', dropIn: true }, source: `${SIGNUP}/sand-now` },
  { ...base, id: 'vw-canceled', sourceId: 'volleyworld', date: TODAY, start: '17:30', end: '19:00', title: 'Canceled Adult Training', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', surface: 'indoor', type: 'Training', canceled: true, signup: { url: `${SIGNUP}/canceled`, label: 'Book on Volleyworld' }, source: `${SIGNUP}/canceled` },
  { ...base, id: 'vw-evening', sourceId: 'volleyworld', date: TODAY, start: '18:00', end: '20:00', title: 'Evening Indoor Open Gym', venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville', surface: 'indoor', type: 'Open play', level: 'Adults', capacity: 12, spotsLeft: 3, signup: { url: `${SIGNUP}/evening`, label: 'Book on Volleyworld' }, source: `${SIGNUP}/evening` },
  { ...base, id: 'reclub-TREE01', sourceId: 'reclub', date: TODAY, start: '19:00', end: '22:00', title: 'Sunday Coed Net Volleyball', venue: 'Roots · Treehouse Gym', city: 'N. Austin', surface: 'indoor', type: 'Open play', facility: 'treehouse', checkFailed: TODAY, signup: { url: `${SIGNUP}/reclub`, label: 'Sign up on Reclub' }, source: `${SIGNUP}/reclub` },
  { ...base, id: 'manual-sand-sun', sourceId: 'manual', days: ['Sun'], start: '19:00', end: '22:00', title: 'Sunday Sand Social', venue: 'ATX Beach', city: 'North Austin', surface: 'sand', type: 'Open play', verifiedAt: '2026-10-20', sourceChanged: TODAY, signup: { url: `${SIGNUP}/social`, label: 'RSVP' }, source: `${SIGNUP}/social` },
  { ...base, id: 'manual-league', sourceId: 'manual', days: ['Sun'], start: null, end: null, title: 'Sunday Indoor League', venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville', surface: 'indoor', type: 'League', source: `${SIGNUP}/league` },
  { ...base, sport: 'ice_skating', id: 'rink-public', sourceId: 'rink', date: TODAY, start: '14:00', end: '16:00', title: 'Public Skating', venue: 'Example Ice Rink', city: 'Cedar Park', surface: 'indoor', type: 'Public skate', rink: 'Silver Rink', price: '$14 · skates $6', signup: { url: `${SIGNUP}/rink`, label: 'Public skating info' }, source: `${SIGNUP}/rink` },
  { ...base, sport: 'ice_skating', id: 'rink-late', sourceId: 'rink', date: TODAY, start: '16:30', end: '17:30', title: 'Evening Session', venue: 'Example Ice Rink', city: 'Cedar Park', surface: 'indoor', type: 'Public skate', rink: 'Silver Rink', signup: { url: `${SIGNUP}/rink-late`, label: 'Public skating info' }, source: `${SIGNUP}/rink-late` },
  { ...base, sport: 'ice_skating', id: 'rink-adult', sourceId: 'rink', date: TODAY, start: '19:30', end: '21:00', title: 'Adult Skate', venue: 'Example Ice Rink', city: 'Cedar Park', surface: 'indoor', type: 'Adult skate', rink: 'Gold Rink', signup: { url: `${SIGNUP}/rink-adult`, label: 'Rink calendar' }, source: `${SIGNUP}/rink-adult` },
  { ...base, sport: 'ice_skating', id: 'pop-up', sourceId: 'manual', days: ['Sun'], start: '18:00', end: '21:00', title: 'Holiday Rink', venue: 'Example Plaza Rink', city: 'Downtown', surface: 'outdoor', type: 'Public skate', signup: { url: `${SIGNUP}/pop-up`, label: 'Timed tickets' }, source: `${SIGNUP}/pop-up` },
  { ...base, id: 'aces-moved', sourceId: 'aces', date: TOMORROW, start: '20:00', end: '22:00', title: 'ACES Monday Open Play', venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville', surface: 'indoor', type: 'Open play', status: 'rescheduled', previousStart: `${TOMORROW} 19:30`, alsoOn: [{ sourceId: 'reclub', id: 'reclub-DUP', title: 'ACES Monday', signup: { url: `${SIGNUP}/reclub-dup` } }], signup: { url: `${SIGNUP}/aces`, label: 'Sign up' }, source: `${SIGNUP}/aces` },
  { ...base, id: 'vw-monday', sourceId: 'volleyworld', date: TOMORROW, start: '19:30', end: '21:00', title: 'Monday Night Training', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', surface: 'indoor', type: 'Training', signup: { url: `${SIGNUP}/monday`, label: 'Book on Volleyworld' }, source: `${SIGNUP}/monday` },
];
const SCHEDULE = {
  schemaVersion: 2,
  generatedAt: '2026-10-25T21:13:00.000Z',
  sources: [
    { id: 'volleyworld', name: 'Volleyworld', sport: 'volleyball', region: 'austin', ok: true, count: 4, checkedAt: '2026-10-25T21:12:00.000Z' },
    { id: 'reclub', name: 'Reclub', sport: 'volleyball', region: 'austin', ok: false, error: 'HTTP 503', kept: 1, checkedAt: '2026-10-25T21:12:30.000Z' },
    { id: 'rink', name: 'Example Ice Rink', sport: 'ice_skating', region: 'austin', ok: true, count: 2, checkedAt: '2026-10-25T21:12:40.000Z' },
  ],
  sessions: SESSIONS,
  publicCourts: { note: 'Free, first come first served.', courts: [
    { park: 'Lakeside Park', surface: 'sand', courts: 2, lights: true },
    { park: 'Riverside Field', surface: 'grass', courts: 1 },
  ] },
};
const COURTS = {
  fetchedAt: '2026-10-25T21:55:00.000Z', from: TODAY, days: 7, errors: [],
  venues: [{
    id: 'treehouse', region: 'austin', calendar: 'https://treehousegym.skedda.com/booking', calendarDay: 'https://treehousegym.skedda.com/booking?viewdate={date}', hours: Array(7).fill(['06:00', '23:00']),
    facilities: [{ id: 'treehouse', name: 'Roots · Treehouse Gym', city: 'N. Austin', surface: 'indoor', courts: [
      { name: 'Court #1', days: { [TODAY]: [['19:00', '22:00']] } }, // lines up with reclub-TREE01: open to sign up
      { name: 'Court #2', days: { [TODAY]: [['08:00', '10:00']] } }, // a private booking
    ] }],
  }],
};

// --- server, browser, per-test page -------------------------------------------------------

let server, origin, browser, context, page, apiCalls;

before(async () => {
  server = spawn(process.execPath, [repoPath('server.js')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  origin = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (d) => {
      out += d;
      const port = out.match(/localhost:(\d+)/)?.[1];
      if (port) resolve(`http://127.0.0.1:${port}`);
    });
    server.on('exit', (code) => reject(new Error(`server.js exited (${code}): ${out}`)));
  });
  // WebGL for the Map view: headless Chrome only offers it through SwiftShader when asked.
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** A fresh page (own localStorage) with data answered by `data` and the clock fixed. */
const titlesWithVenue = () => page.locator('#list .row .venue b').allTextContents();

let pageErrors = [];
// The app defaults to Events; the sports tests open an explicit sports view (/?view=openplay
// or a sport/region link, which the app also reads as sports). `waitFor` is what the page
// shows when its data arrives (the events list in the Events view, the session list in Sports).
async function open({ programs = null, schedule = SCHEDULE, courts = COURTS, events = null, apiCourts = { status: 500, body: '{"error":"down"}' }, index = null, regions = {}, occurrences = {}, maps = null, url = '/?view=openplay', timezoneId = 'America/Los_Angeles', clock = CLOCK, geolocation = null, touch = false, waitFor = '#list .row, #list .error, #list .empty' } = {}) {
  context = await browser.newContext({ timezoneId, locale: 'en-US', ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {}), ...(touch ? { hasTouch: true } : {}) }); // viewer elsewhere: the page still shows Austin time
  page = await context.newPage();
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.clock.setFixedTime(clock);
  apiCalls = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort(); // fonts, venues: never leave the machine
    const json = (v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: typeof v === 'string' ? v : JSON.stringify(v) });
    if (u.pathname.startsWith('/api/')) {
      apiCalls.push(u.pathname + u.search);
      if (u.pathname === '/api/courts') return json(apiCourts.body, apiCourts.status);
      return json({ id: u.searchParams.get('session'), status: 'changed', changes: ['start'] }); // any live check
    }
    // Without `index` there's no data/index.json: the page uses the combined schedule (data from before regions).
    if (u.pathname === '/data/index.json') return index ? json(index) : route.fulfill({ status: 404, body: 'Not found' });
    const reg = u.pathname.match(/^\/data\/regions\/([a-z-]+)\/schedule\.json$/);
    if (reg) return regions[reg[1]] ? json(regions[reg[1]]) : route.fulfill({ status: 404, body: 'Not found' });
    const occ = u.pathname.match(/^\/data\/regions\/([a-z-]+)\/occurrences\.json$/);
    if (occ) return occurrences[occ[1]] ? json(occurrences[occ[1]]) : route.fulfill({ status: 404, body: 'Not found' });
    if (u.pathname === '/data/schedule.json') return schedule ? json(schedule) : json('{"error":"nope"}', 500);
    if (u.pathname === '/data/courts.json') return courts ? json(courts) : route.fulfill({ status: 404, body: 'Not found' });
    if (u.pathname === '/data/programs.json') return programs ? json(programs) : route.fulfill({ status: 404, body: 'Not found' });
    if (u.pathname === '/data/events.json') return events ? json(events) : route.fulfill({ status: 404, body: 'Not found' });
    // Map view: maps.json says which regions have a map; the map file, fonts and icons aren't served
    // (pins and the place panel don't need them).
    if (u.pathname === '/maps/maps.json') return maps ? json(maps) : route.fulfill({ status: 404, body: 'Not found' });
    if (u.pathname.startsWith('/maps/')) return route.fulfill({ status: 404, body: 'Not found' });
    return route.continue(); // index.html, app.js, styles.css from server.js
  });
  await page.goto(`${origin}${url}`);
  await page.locator(waitFor).first().waitFor({ state: 'attached' });
}

beforeEach(() => { apiCalls = []; });
afterEach(async () => { await context?.close(); context = null; });

const rows = () => page.locator('#list .row');
const titles = () => page.locator('#list .row .title').allTextContents();
const row = (title) => page.locator('#list .row', { has: page.locator('.title', { hasText: title }) });
const tab = (k) => page.locator(`#tabs [data-tab="${k}"]`);
/** Level / court type and sport are chosen in bottom sheets: open the sheet, tap the option (it closes). */
async function pick(k) {
  await page.locator('#levelBtn').click();
  await tab(k).click();
  await page.locator('#levelSheet').waitFor({ state: 'hidden' });
}
/** A sport is picked in the sheet the Sports tab opens (it closes on the pick). */
async function pickSport(k) {
  await page.locator('#topTabs [data-section="sports"]').click();
  await page.locator(`#sportsOpts [data-sport="${k}"]`).click();
  await page.locator('#sportSheet').waitFor({ state: 'hidden' });
}
/** Each option's name and count ("Beginner3"), without its description line. */
const tabTexts = () => page.locator('#tabs .tab').evaluateAll((bs) => bs.map((b) => b.querySelector('.lbl').firstChild.textContent + b.querySelector('.n').textContent));

const PICKLE_SCHEDULE = { ...SCHEDULE, venues: [{ id: 'rec', name: 'Example Rec Center', address: '123 Main St, Suite A & B, Austin, TX 78701' }], sessions: [
  ...SESSIONS,
  { ...base, sport: 'pickleball', id: 'pickle-indoor', sourceId: 'manual', venueId: 'rec', venue: 'Example Rec Center', city: 'Austin',
    title: 'Indoor pickleball', type: 'Open play', surface: 'indoor', days: ['Sun'], start: '10:00', end: '12:00',
    startsOn: TODAY, validUntil: TODAY, source: `${SIGNUP}/pickle`, signup: { url: `${SIGNUP}/pickle`, label: 'Venue details' } },
  { ...base, sport: 'pickleball', id: 'pickle-outdoor', sourceId: 'manual', venue: 'Example Park', city: 'Austin',
    title: 'Outdoor pickleball', type: 'Open play', surface: 'outdoor', date: TODAY, start: '16:00', end: '18:00', source: `${SIGNUP}/pickle-park` },
] };

test('site: pickleball deep link, filters, directions and copy address keep sports separate', async () => {
  await open({ schedule: PICKLE_SCHEDULE, url: '/?sport=pickleball' });
  assert.deepEqual(await titles(), ['Indoor pickleball', 'Outdoor pickleball']);
  assert.deepEqual(await tabTexts(), ['All levels2', 'Beginner2', 'Intermediate2', 'Advanced2']);
  assert.equal(await page.locator('#courtsCard').isHidden(), true);
  assert.equal(await page.locator('#cal .g-venue', { hasText: 'Treehouse' }).count(), 0);
  assert.match(await page.locator('#subscribe a').first().getAttribute('href'), /pickleball\.ics$/);
  assert.match(await page.locator('#sourceStatus').textContent(), /hand-checked/);
  const indoor = row('Indoor pickleball');
  await page.locator('#list details.earlier > summary').click(); // 10am–noon: ended by 5pm, folded away
  // Address, directions and the fine print fold under Details (a tap, not a hover).
  assert.equal(await indoor.getByRole('link', { name: 'Google Maps' }).count(), 0);
  await indoor.locator('details.more summary').click();
  const google = new URL(await indoor.getByRole('link', { name: 'Google Maps' }).getAttribute('href'));
  assert.equal(google.searchParams.get('destination'), 'Example Rec Center, 123 Main St, Suite A & B, Austin, TX 78701');
  const apple = new URL(await indoor.getByRole('link', { name: 'Apple Maps' }).getAttribute('href'));
  assert.equal(apple.searchParams.get('destination'), google.searchParams.get('destination'));
  assert.equal(await row('Outdoor pickleball').locator('.location').count(), 0, 'no guessed address');
  assert.ok(await indoor.locator(':scope .body > .actions :is(.signup, .dropin)').first().isVisible(), 'the sign-up action stays outside Details');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedAddress = text; } } }));
  await indoor.getByRole('button', { name: 'Copy address' }).click();
  await indoor.getByRole('status').filter({ hasText: 'Address copied' }).waitFor();
  assert.equal(await page.evaluate(() => window.copiedAddress), '123 Main St, Suite A & B, Austin, TX 78701');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
  await indoor.getByRole('button', { name: 'Copy address' }).click();
  await indoor.getByRole('status').filter({ hasText: 'Could not copy' }).waitFor();
  await pick('beginner');
  assert.deepEqual(await titles(), ['Indoor pickleball', 'Outdoor pickleball']); // no level listed: shown under every level
  await page.reload();
  await row('Outdoor pickleball').waitFor();
  assert.equal(await tab('beginner').getAttribute('aria-pressed'), 'true');
  await page.locator('#days .day').nth(1).click();
  assert.match(await page.locator('#list .empty').textContent(), /No confirmed beginner open-play sessions/);
  assert.doesNotMatch(await page.locator('#list .empty').textContent(), /Rinks|Courts open to rent/);
  await pickSport('volleyball');
  assert.ok(!(await titles()).some((t) => t.includes('pickleball')));
});

test('site: bounded pickleball recurrence disappears after the review date', async () => {
  await open({ schedule: PICKLE_SCHEDULE, url: '/?sport=pickleball', clock: new Date('2026-11-01T18:00:00Z') });
  assert.equal(await rows().count(), 0);
  assert.match(await page.locator('#list .empty').textContent(), /open-play sessions/);
});

// --- tests --------------------------------------------------------------------------------

test('site: external pickleball calendars are separate from sessions and source warnings remain visible', async () => {
  const schedule = { ...PICKLE_SCHEDULE,
    sources: [...SCHEDULE.sources, { id: 'city', name: 'City pickleball', sport: 'pickleball', ok: true, count: 2,
      checkedAt: CLOCK.toISOString(), warnings: ['Example venue: source block changed; withheld until reviewed'] }],
    sessions: PICKLE_SCHEDULE.sessions.map((s) => s.sport === 'pickleball' ? { ...s, sourceId: 'city', scheduleBasis: 'published_recurring_hours' } : s),
    venues: [...PICKLE_SCHEDULE.venues, { id: 'club', name: 'Example Club', city: 'Austin', address: '456 Main St, Austin, TX 78701',
      calendarLink: { sport: 'pickleball', url: `${SIGNUP}/club`, note: 'Check skill eligibility and registration.',
        reviewedOn: TODAY, reviewBy: '2026-10-31', details: [
          { label: 'Opening hours', text: 'Mon–Fri 7am–11pm. Facility hours, not continuous open play.', url: `${SIGNUP}/hours` },
          { label: 'Open-play price', text: '$12–$18/person; confirm when booking.', url: `${SIGNUP}/prices` },
        ] } }],
  };
  await open({ schedule, url: '/?sport=pickleball' });
  assert.deepEqual(await titles(), ['Indoor pickleball', 'Outdoor pickleball']);
  assert.equal(await row('Indoor pickleball').locator('.pill').textContent(), 'Hours checked today');
  assert.equal(await row('Outdoor pickleball').locator('.pill').textContent(), 'Scheduled now');
  assert.equal(await page.locator('#venueCalendarsCard').isVisible(), true);
  assert.equal(await page.locator('#venueCalendars a', { hasText: 'View venue calendar' }).getAttribute('href'), `${SIGNUP}/club`);
  assert.match(await page.locator('#venueCalendars').textContent(), /Opening hours: Mon–Fri 7am–11pm/);
  assert.match(await page.locator('#venueCalendars').textContent(), /\$12–\$18\/person/);
  assert.match(await page.locator('#sourceList').textContent(), /withheld until reviewed/);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page fits viewport');
  await pickSport('volleyball');
  assert.equal(await page.locator('#venueCalendarsCard').isHidden(), true);
  await open({ schedule, url: '/?sport=pickleball', clock: new Date('2026-11-01T18:00:00Z') });
  assert.match(await page.locator('#venueCalendars').textContent(), /need rechecking/);
  assert.doesNotMatch(await page.locator('#venueCalendars').textContent(), /\$12–\$18/);
});

test('site: directory session prices and unlisted court types do not imply venue verification', async () => {
  const schedule = { ...PICKLE_SCHEDULE, sessions: [{ ...PICKLE_SCHEDULE.sessions.at(-1),
    title: 'Ranch level 2 open play', surface: 'unspecified', start: '19:00', end: '21:00',
    scheduleBasis: 'directory_listing', price: '$12 / person (listed)',
    note: 'Listed by OpenPlay, an independent directory. Confirm final price at booking.',
  }] };
  await open({ schedule, url: '/?sport=pickleball' });
  const listing = row('Ranch level 2 open play');
  assert.equal(await listing.locator('.pill').textContent(), 'Listed today');
  assert.match(await listing.textContent(), /\$12 \/ person \(listed\)/);
  assert.match(await listing.textContent(), /Court type unlisted/);
  assert.match(await listing.textContent(), /independent directory/);
  await pick('beginner'); // "level 2" is intermediate
  assert.equal(await rows().count(), 0);
  await pick('intermediate');
  assert.equal(await rows().count(), 1);
});

test('site: pickleball level chips read words, DUPR numbers and "Level N", and sessions with no level show under every level', async () => {
  const one = PICKLE_SCHEDULE.sessions.at(-1);
  const at = (id, title, extra = {}) => ({ ...one, id, title, ...extra });
  const schedule = { ...PICKLE_SCHEDULE, sessions: [
    at('l1', 'Level 1 open play'), at('l3', 'Level 3 open play'), at('l4', 'Level 4 open play'),
    at('dupr', 'Open play', { level: '3.25+' }), at('word', 'Beginner clinic'), at('none', 'Open play for all'),
  ] };
  await open({ schedule, url: '/?sport=pickleball' });
  assert.deepEqual(await tabTexts(), ['All levels6', 'Beginner3', 'Intermediate3', 'Advanced3']);
  await pick('beginner');
  assert.deepEqual((await titles()).sort(), ['Beginner clinic', 'Level 1 open play', 'Open play for all']);
  await pick('intermediate');
  assert.deepEqual((await titles()).sort(), ['Level 3 open play', 'Open play', 'Open play for all']);
  await pick('advanced');
  assert.deepEqual((await titles()).sort(), ['Level 4 open play', 'Open play', 'Open play for all']);
  await page.locator('[data-view="booking"]').click();
  assert.equal(await page.locator('#levelBtn').isHidden(), true, 'levels are for open play only');
});

test('site: today\'s schedule renders in Austin time with freshness labels and sign-up links', async () => {
  await open();
  assert.equal(await page.title(), 'Schelagg');
  assert.equal(await page.locator('#dayTitle').textContent(), 'Today · Sunday, Oct 25');
  // Older of the two refreshes (sessions 4:13pm, courts 4:55pm) against the 5pm clock.
  assert.equal(await page.locator('#asof').textContent(), 'Last updated 47 min ago');
  assert.match(await page.locator('#asof').getAttribute('title'), /^Sessions 4:13\s?PM · court calendars 4:55\s?PM$/);

  // Sorted by start; canceled and unconfirmed ones hidden by default.
  assert.deepEqual(await titles(), ['Morning Adult Training', 'Afternoon Sand Open Play', 'Evening Indoor Open Gym', 'Sunday Coed Net Volleyball', 'Sunday Sand Social']);
  assert.equal(await page.locator('#list > .empty').textContent(), '2 ended, canceled or unconfirmed sessions hidden.');

  const pill = (title) => row(title).locator('.pill').textContent();
  assert.equal(await pill('Morning Adult Training'), 'Verified today');
  assert.equal(await pill('Afternoon Sand Open Play'), 'Happening now');
  assert.equal(await pill('Sunday Coed Net Volleyball'), "Couldn't recheck"); // source failed: kept from last run
  assert.equal(await pill('Sunday Sand Social'), 'Source changed'); // hand-checked page changed
  assert.match(await row('Morning Adult Training').getAttribute('class'), /\bpast\b/);

  // Ended sessions fold into one line at the top; "Now" heads what's on and what's next.
  assert.equal(await page.locator('#list .now').textContent(), 'Now · 5pm');
  const order = await page.locator('#list .row .title, #list .now').allTextContents();
  assert.deepEqual(order.slice(0, 4), ['Morning Adult Training', 'Now · 5pm', 'Afternoon Sand Open Play', 'Evening Indoor Open Gym']);
  const earlier = page.locator('#list details.earlier');
  assert.equal(await earlier.locator(':scope > summary').textContent(), '1 ended earlier today');
  assert.equal(await row('Morning Adult Training').isVisible(), false, 'folded away');
  await earlier.locator(':scope > summary').click();
  assert.equal(await row('Morning Adult Training').isVisible(), true);

  const signup = row('Evening Indoor Open Gym').locator('a.signup');
  assert.equal(await signup.getAttribute('href'), `${SIGNUP}/evening`);
  assert.equal(await signup.getAttribute('target'), '_blank');
  assert.equal(await signup.textContent(), 'Book on Volleyworld ↗');
  // Drop-in sessions show a label plus a details link instead of a sign-up button.
  assert.equal(await row('Afternoon Sand Open Play').locator('.dropin').textContent(), 'Drop in');
  assert.equal(await row('Afternoon Sand Open Play').locator('a.signup').count(), 0);

  assert.equal(await page.locator('#sourceStatus').textContent(), 'Last check couldn\'t read: reclub. Their sessions show "Couldn\'t recheck".');
  assert.equal(await page.locator('#courtsTitle').textContent(), 'Free public courts · 2');
});

test('site: surface tabs filter the list, show counts and are remembered across reloads', async () => {
  await open();
  const counts = await page.locator('#tabs .tab .n').allTextContents();
  assert.deepEqual(counts, ['5', '3', '2', '']); // all, indoor, sand, grass (visible today)

  await pick('sand');
  assert.equal(await tab('sand').getAttribute('aria-pressed'), 'true');
  assert.equal(await tab('all').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await titles(), ['Afternoon Sand Open Play', 'Sunday Sand Social']);
  assert.equal(await page.locator('#courtsTitle').textContent(), 'Free public courts · 1');

  await page.reload();
  await rows().first().waitFor({ state: 'attached' });
  assert.equal(await tab('sand').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await titles(), ['Afternoon Sand Open Play', 'Sunday Sand Social']);

  await pick('indoor');
  assert.deepEqual(await titles(), ['Morning Adult Training', 'Evening Indoor Open Gym', 'Sunday Coed Net Volleyball']);
  assert.equal(await page.locator('#courtsCard').isHidden(), true); // no free indoor courts

  await pick('grass');
  assert.equal(await rows().count(), 0);
  assert.match(await page.locator('#list .empty').textContent(), /No confirmed grass sessions today\..*Grass has no scheduled play/);
});

test('site: the sport switcher shows each sport on its own, with its own filters, and is shareable', async () => {
  await open();
  const sport = (k) => page.locator(`#sportsOpts [data-sport="${k}"]`);
  assert.deepEqual(await page.locator('#sportsOpts .tab .lbl').evaluateAll((els) => els.map((e) => e.firstChild.textContent)), ['Volleyball', 'Ice skating']);
  assert.equal(await sport('volleyball').getAttribute('aria-pressed'), 'true');
  assert.ok(!(await titles()).includes('Public Skating')); // other sports stay out of the volleyball list
  await pick('sand');

  await pickSport('ice_skating');
  assert.equal(new URL(page.url()).searchParams.get('sport'), 'ice_skating');
  // No filter tabs for skating (almost all indoors); an outdoor rink says so on its session.
  assert.equal(await page.locator('#levelBtn').isHidden(), true);
  assert.deepEqual(await titles(), ['Public Skating', 'Evening Session', 'Holiday Rink', 'Adult Skate']);
  assert.equal(await row('Public Skating').locator('.meta').textContent(), 'Public skateSilver Rink· $14 · skates $6');
  assert.equal(await row('Holiday Rink').locator('.meta').textContent(), 'Public skateOutdoor');
  // Volleyball-only parts are hidden: court calendars, their key and note, and the free courts.
  assert.equal(await page.locator('#glance .key').isHidden(), true);
  assert.equal(await page.locator('#calNote').isHidden(), true);
  assert.equal(await page.locator('#courtsCard').isHidden(), true);
  assert.equal(await page.locator('#cal .g-group').first().textContent(), 'Public skatetap a block to see its sessions');
  assert.equal(await page.locator('#cal .g-group').count(), 1);
  // One row per rink: both Silver Rink sessions sit on the same row.
  const labels = await page.locator('#cal .g-row:not(.g-axis) .g-lab').allTextContents();
  assert.deepEqual(labels, ['Example Ice RinkSilver Rink', 'Example Plaza RinkHoliday Rink', 'Example Ice RinkGold Rink']);
  const silver = page.locator('#cal .g-row', { has: page.locator('.g-lab', { hasText: 'Silver Rink' }) });
  assert.deepEqual(await silver.locator('.g-bar').evaluateAll((els) => els.map((e) => e.dataset.label)), ['2–4p', '4:30–5:30p']);
  assert.equal(await page.locator('#sourceStatus').textContent(), 'Last check read all 1 scraped ice skating source.');
  // The footer lists this sport's sources by name.
  assert.equal(await page.locator('#footer').textContent(), 'Sources: Example Ice Rink and hand-checked pages. Rinks close for hockey and events; tap “Source” before you drive out.');

  // Remembered on reload; a shared link opens that sport even for a viewer who last chose another.
  await page.reload();
  await rows().first().waitFor({ state: 'attached' });
  assert.equal(await sport('ice_skating').getAttribute('aria-pressed'), 'true');
  await pickSport('volleyball');
  assert.equal(new URL(page.url()).searchParams.get('sport'), null);
  assert.equal(await page.locator('#levelBtn').isHidden(), false);
  assert.equal(await tab('all').getAttribute('aria-pressed'), 'true');
  await page.goto(`${origin}/?sport=ice_skating`);
  await rows().first().waitFor({ state: 'attached' });
  assert.deepEqual(await titles(), ['Public Skating', 'Evening Session', 'Holiday Rink', 'Adult Skate']);
});

test('site: freshness per source, calendar subscription, moved sessions and other listings', async () => {
  await open();
  assert.deepEqual(await page.locator('#sourceList li').allTextContents().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim())), [
    'Volleyworld ✓ checked 48 min ago · 4 sessions',
    'Reclub ⚠ checked 47 min ago · couldn\'t read, showing last good copy',
  ]);
  const sub = page.locator('#subscribe a').first();
  assert.equal(await sub.getAttribute('href'), `${origin.replace('http:', 'webcal:')}/data/volleyball.ics`);
  // "Copy calendar link" (plain words, not ".ics file") copies the feed for calendars that subscribe from a link.
  const copyCal = page.locator('#subscribe .copy-cal');
  assert.equal(await copyCal.textContent(), 'Copy calendar link');
  assert.equal(await page.locator('#subscribe').textContent().then((t) => t.includes('.ics')), false);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  // Court data arriving redraws this line; wait for it so the click isn't redrawn away (flaked on main).
  await page.waitForFunction(() => document.querySelector('#asof').title.includes('court calendars'));
  await copyCal.click();
  await page.locator('#subscribe .copy-cal', { hasText: 'Copied ✓' }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}/data/volleyball.ics`);

  await page.locator('#days [data-di="1"]').click();
  const moved = row('ACES Monday Open Play');
  assert.equal(await moved.locator('.moved').textContent(), 'Moved from 7:30pm');
  assert.equal(await moved.locator('a.also').textContent(), 'Also on Reclub ↗');
  assert.equal(await moved.locator('a.also').getAttribute('href'), `${SIGNUP}/reclub-dup`);

  await pickSport('ice_skating');
  assert.deepEqual(await page.locator('#sourceList li b').allTextContents(), ['Example Ice Rink']);
  assert.match(await page.locator('#subscribe a').first().getAttribute('href'), /\/data\/ice_skating\.ics$/);
});

test('site: spots left and capacity come from the source and say so', async () => {
  await open();
  const cap = row('Evening Indoor Open Gym').locator('.cap');
  assert.equal(await cap.textContent(), '· 3 of 12 spots left');
  assert.equal(await cap.getAttribute('title'), 'from Volleyworld at the last check');
  assert.equal(await row('Morning Adult Training').locator('.cap').count(), 0); // no data: nothing guessed
  await pickSport('ice_skating');
  assert.equal(await row('Public Skating').locator('.cap').count(), 0);
});

test('site: overlapping sessions at one place merge into one block with a count, and tapping it lists each with its sign-up', async () => {
  const sessions = [
    { ...base, id: 'a', sourceId: 'volleyworld', date: TODAY, start: '18:00', end: '20:00', title: 'Court A', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/a` }, source: `${SIGNUP}/a` },
    { ...base, id: 'b', sourceId: 'volleyworld', date: TODAY, start: '19:00', end: '21:00', title: 'Court B', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/b` }, source: `${SIGNUP}/b` },
    { ...base, id: 'c', sourceId: 'volleyworld', date: TODAY, start: '21:00', end: '22:00', title: 'Late', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/c` }, source: `${SIGNUP}/c` },
  ];
  await open({ schedule: { ...SCHEDULE, sessions } });
  const rowsInChart = page.locator('#cal .g-row:not(.g-axis)').filter({ has: page.locator('.g-bar') });
  assert.equal(await rowsInChart.count(), 1); // one row per venue
  const blocks = rowsInChart.locator('.g-bar');
  assert.deepEqual(await blocks.evaluateAll((els) => els.map((e) => e.dataset.label)), ['6–9p ×2', '9–10p']);
  assert.equal(await rowsInChart.locator('.g-lab').textContent(), 'Volleyworld (Georgetown)3 sessions');
  assert.equal(await page.locator('#cal .g-pop').count(), 0);
  await blocks.first().click();
  assert.equal(await blocks.first().getAttribute('aria-expanded'), 'true');
  assert.ok(await page.evaluate(() => document.activeElement?.dataset.block), 'focus stays on the block');
  const items = page.locator('#cal .g-pop .pop-item');
  assert.equal(await items.count(), 2);
  assert.match(await items.nth(0).textContent(), /Court A/);
  assert.equal(await items.nth(1).locator('a.signup').getAttribute('href'), `${SIGNUP}/b`);
  await blocks.first().click(); // tap again to close
  assert.equal(await page.locator('#cal .g-pop').count(), 0);
});

test('site: 📍 orders the calendar\'s venues nearest first, unsure ones a little later, and tapping again undoes it', async () => {
  const at = (id, venue, start, extra = {}) => ({ ...base, id, sourceId: 'manual', venueId: id, date: TODAY, start, end: `${+start.slice(0, 2) + 1}:00`, title: 'Open play', venue, city: 'Austin', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/${id}` }, source: `${SIGNUP}/${id}`, ...extra });
  const sessions = [
    at('nocoords', 'No Coordinates Gym', '07:00'),
    at('far', 'Far Gym', '08:00'),
    at('near', 'Near Gym', '09:00'),
    at('mid', 'Mid Gym', '10:00'),
    at('unsure', 'Unsure Gym', '11:00', { checkFailed: true }), // closest, but its source couldn't be rechecked
  ];
  const venues = [
    { id: 'far', name: 'Far Gym', city: 'Georgetown', lat: 30.63, lng: -97.68 },
    { id: 'near', name: 'Near Gym', city: 'Austin', lat: 30.27, lng: -97.74 },
    { id: 'mid', name: 'Mid Gym', city: 'Austin', lat: 30.35, lng: -97.73 },
    { id: 'unsure', name: 'Unsure Gym', city: 'Austin', lat: 30.268, lng: -97.742 },
    { id: 'nocoords', name: 'No Coordinates Gym', city: 'Austin' },
  ];
  await open({ schedule: { ...SCHEDULE, sessions, venues }, geolocation: { latitude: 30.2672, longitude: -97.7431 } });
  const names = () => page.locator('#cal .g-row:not(.g-axis) .g-lab').evaluateAll((els) => els.map((e) => e.firstChild.textContent).filter(Boolean));
  // Before anyone shares a location: no prompt, the usual order (first session of the day).
  assert.deepEqual(await names(), ['No Coordinates Gym', 'Far Gym', 'Near Gym', 'Mid Gym', 'Unsure Gym']);
  const pin = page.locator('#nearest');
  assert.equal(await pin.isVisible(), true); // one city: 📍 still shows, for distance
  assert.equal(await pin.getAttribute('aria-pressed'), 'false');
  await pin.click();
  await page.waitForFunction(() => document.querySelector('#nearest').getAttribute('aria-pressed') === 'true');
  assert.deepEqual(await names(), ['Near Gym', 'Unsure Gym', 'Mid Gym', 'Far Gym', 'No Coordinates Gym']);
  assert.match(await page.locator('#cal .g-lab', { hasText: 'Near Gym' }).locator('small').textContent(), /· <1 mi$/);
  assert.match(await page.locator('#cal .g-lab', { hasText: 'Far Gym' }).locator('small').textContent(), /· 2\d mi$/);
  // The session list keeps time order.
  assert.deepEqual((await titlesWithVenue()).slice(0, 2), ['No Coordinates Gym', 'Far Gym']);
  // Remembered on this device for the next visit…
  await page.reload();
  await page.locator('#cal .g-row').first().waitFor();
  assert.equal((await names())[0], 'Near Gym');
  // …and tapping 📍 again goes back to the usual order.
  await pin.click();
  assert.deepEqual(await names(), ['No Coordinates Gym', 'Far Gym', 'Near Gym', 'Mid Gym', 'Unsure Gym']);
});

test('site: the chart zooms to the day\'s hours; on a phone long days scroll sideways with names pinned', async () => {
  const at = (id, start, end) => ({ ...base, id, sourceId: 'manual', date: TODAY, start, end, title: `Session ${id}`, venue: `Gym ${id}`, city: 'Austin', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/${id}` }, source: `${SIGNUP}/${id}` });
  const axis = () => page.locator('#cal .g-axis').first().locator('.g-track span').allTextContents();
  // An evening-only day: 6pm–midnight (at least 6 hours), every hour labelled.
  await open({ schedule: { ...SCHEDULE, sessions: [at('a', '18:00', '20:00'), at('b', '19:30', '22:00')] }, clock: new Date('2026-10-25T15:00:00Z') });
  assert.deepEqual(await axis(), ['6p', '7p', '8p', '9p', '10p', '11p', '12a']);
  // A long day on a 390px phone: zoomed in (64px an hour, every hour labelled), so the chart scrolls; venue names stay put.
  await open({ schedule: { ...SCHEDULE, sessions: [at('a', '06:00', '08:00'), at('b', '20:00', '23:00')] }, clock: new Date('2026-10-25T15:00:00Z') });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload(); await page.locator('#cal .g-bar').first().waitFor();
  assert.deepEqual(await axis(), ['6a', '7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p']);
  const g = await page.locator('#cal').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, hourPx: el.querySelector('.g-row:not(.g-axis) .g-track').offsetWidth / 17, sticky: getComputedStyle(el.querySelector('.g-lab')).position }));
  assert.ok(g.sw > g.cw, 'scrolls sideways');
  assert.ok(g.hourPx >= 64, `an hour is ${g.hourPx}px`);
  assert.equal(g.sticky, 'sticky');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'only the chart scrolls, not the page');
  // Desktop: the whole day fits, no scrolling.
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.ok(await page.locator('#cal').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  // The breakpoint change redraws the chart; wait for the wider labels.
  await page.waitForFunction(() => document.querySelector('#cal .g-axis').querySelectorAll('.g-track span').length < 10);
  assert.deepEqual(await axis(), ['6a', '9a', '12p', '3p', '6p', '9p', '11p'], 'wider screens label every 3 hours');
});

test('site: on a phone, court booking opens at the current time once court data arrives', async () => {
  await open({ url: '/?view=booking', clock: new Date('2026-10-25T20:10:00Z') }); // 3:10pm in Austin
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await page.locator('#cal .g-venue').first().waitFor();
  await page.waitForTimeout(200);
  const first = await page.locator('#cal').evaluate((el) => {
    const left = el.getBoundingClientRect().left + el.querySelector('.g-lab').offsetWidth;
    return [...el.querySelectorAll('.g-axis .g-track span')].find((s) => s.getBoundingClientRect().left >= left - 2)?.textContent;
  });
  assert.equal(first, '2p', 'starts half an hour before now, on the hour');
});

test('site: court lanes tint open time and show closed time in solid gray', async () => {
  // The chart spans the day's opening hours; a venue that opens later and closes earlier shows closed time.
  const short = { ...COURTS.venues[0], id: 'short', hours: Array(7).fill(['09:00', '17:00']),
    facilities: [{ ...COURTS.venues[0].facilities[0], id: 'short', name: 'Short Hours Gym' }] };
  await open({ url: '/?view=booking', courts: { ...COURTS, venues: [...COURTS.venues, short] } });
  await page.locator('#cal [data-fac]').first().click(); // per-court lanes are folded under "2 courts ▾"
  const lane = page.locator('#cal .g-track.lane').first();
  await lane.waitFor();
  const bg = await lane.evaluate((el) => getComputedStyle(el).backgroundColor);
  const closed = await page.locator('#cal .g-closed').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(bg, closed);
  await page.locator('[data-view="openplay"]').click();
  // Session rows aren't tinted as "open to rent".
  assert.equal(await page.locator('#cal .g-bar').first().locator('xpath=..').getAttribute('class'), 'g-track');
});

test('site: regions: one city at a time, in its own time zone, with a picker, a shareable link and its own courts', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [
    { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball', 'ice_skating'] },
    { id: 'denver', name: 'Denver, CO', timezone: 'America/Denver', center: [39.74, -104.99], sports: ['ice_skating'] },
  ] };
  const denver = {
    schemaVersion: 2, generatedAt: SCHEDULE.generatedAt, region: { id: 'denver', name: 'Denver, CO', timezone: 'America/Denver' },
    sources: [{ id: 'den-rink', name: 'Denver Rink', sport: 'ice_skating', region: 'denver', ok: true, count: 1, checkedAt: '2026-10-25T21:12:00.000Z' }],
    sessions: [{ ...base, region: 'denver', timezone: 'America/Denver', sport: 'ice_skating', id: 'den-1', sourceId: 'den-rink', date: TODAY, start: '17:00', end: '18:00', title: 'Mile High Skate', venue: 'Denver Rink', city: 'Denver', surface: 'indoor', type: 'Public skate', signup: { url: `${SIGNUP}/den`, label: 'Info' }, source: `${SIGNUP}/den` }],
    publicCourts: null, venues: [],
  };
  const austin = { ...SCHEDULE, region: { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago' } };
  await open({ index: INDEX, regions: { austin, denver } });
  // Austin first (the first region), with its courts and a city menu.
  assert.equal(await page.locator('#regionPick').isVisible(), true);
  assert.deepEqual(await page.locator('#regionPick option').allTextContents(), ['Austin, TX', 'Denver, CO']);
  assert.equal(await page.locator('#list .now').textContent(), 'Now · 5pm'); // Austin time
  await page.locator('[data-view="booking"]').click();
  assert.ok((await page.locator('#cal .g-venue').allTextContents()).some((t) => t.startsWith('Roots · Treehouse Gym')));

  await page.locator('#regionPick').selectOption('denver');
  await page.locator('#list .row .title', { hasText: 'Mile High Skate' }).waitFor();
  // Denver only has skating; its time zone is an hour behind; Austin's courts aren't shown.
  assert.deepEqual(await page.locator('#sportsOpts .tab .lbl').evaluateAll((els) => els.map((e) => e.firstChild.textContent)), ['Ice skating']);
  assert.equal(await page.locator('#list .now').textContent(), 'Now · 4pm');
  assert.equal(new URL(page.url()).searchParams.get('region'), 'denver');
  assert.match(await page.locator('#subscribe a').first().getAttribute('href'), /\/data\/regions\/denver\/ice_skating\.ics$/);
  assert.equal(await page.locator('#cal .g-venue', { hasText: 'Treehouse' }).count(), 0);
  assert.equal(await page.locator('#footer').textContent(), 'Sources: Denver Rink. Rinks close for hockey and events; tap “Source” before you drive out.');

  // Remembered, and a shared link opens that city.
  await page.reload();
  await page.locator('#list .row .title', { hasText: 'Mile High Skate' }).waitFor();
  await context.close();
  await open({ index: INDEX, regions: { austin, denver }, url: '/?region=denver&sport=ice_skating' });
  assert.equal(await page.locator('#regionPick').inputValue(), 'denver');
  assert.deepEqual(await titles(), ['Mile High Skate']);
});

test('site: Map view: one pin per place with the first session\'s time, tap for its day; booking pins show the price; shareable', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] }] };
  const MAPS = { source: '20261107.pmtiles', maps: [{ region: 'austin', bbox: [-98.05, 30.1, -97.47, 30.78], maxzoom: 14 }] };
  const sched = structuredClone(SCHEDULE);
  sched.region = { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago' };
  sched.venues = [
    { id: 'gym', name: 'Austin North Gym', short: 'North Gym', city: 'Austin', lat: 30.4, lng: -97.7, bookingLink: { sport: 'volleyball', url: 'https://club.podplay.app/book/main', price: '$30/hr' } },
    { id: 'beach', name: 'ATX Beach', city: 'Austin', lat: 30.3, lng: -97.75 },
    { id: 'rec', name: 'Austin Alamo Recreation Center', city: 'Austin', lat: 30.28, lng: -97.71 },
    { id: 'nowhere', name: 'Unmapped Hall', city: 'Austin' },
    { id: 'park', name: 'Morning Park', city: 'Austin', lat: 30.25, lng: -97.8 },
  ];
  const at = (id, venueId, venue, start, end) => ({ ...base, id, sourceId: 'manual', date: TODAY, start, end, title: `Session ${id}`, venueId, venue, city: 'Austin', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/${id}` }, source: `${SIGNUP}/${id}` });
  sched.sessions = [at('g0', 'gym', 'North Gym', '09:00', '11:00'), at('g1', 'gym', 'North Gym', '18:00', '20:00'), at('g2', 'gym', 'North Gym', '20:00', '22:00'), at('b1', 'beach', 'ATX Beach', '18:30', '20:00'), at('u1', 'nowhere', 'Unmapped Hall', '19:00', '21:00'), at('p1', 'park', 'Morning Park', '08:00', '09:00'), at('r1', 'rec', 'Alamo Recreation Center', '19:30', '21:00')];
  // Live courts at North Gym: it's 5pm; court 1 is booked 5–7pm, court 2 5–11pm, so the next free court is at 7pm.
  const courts = { ...COURTS, venues: [{ id: 'gymcourts', sport: 'volleyball', region: 'austin', calendar: 'https://club.podplay.app/book/main', calendarDay: null, hours: Array(7).fill(['07:00', '23:00']),
    facilities: [{ id: 'gymcourts', venueId: 'gym', name: 'North Gym', city: 'Austin', surface: 'indoor', courts: [{ name: 'Court 1', days: { [TODAY]: [['17:00', '19:00']] } }, { name: 'Court 2', days: { [TODAY]: [['17:00', '23:00']] } }] }] }] };
  await open({ index: INDEX, regions: { austin: sched }, maps: MAPS, courts });
  const layout = page.locator('#layout');
  assert.equal(await layout.isVisible(), true);
  await layout.locator('[data-layout="map"]').click();
  assert.equal(new URL(page.url()).searchParams.get('layout'), 'map');
  assert.equal(await page.locator('#mapCard').isVisible(), true);
  assert.equal(await page.locator('#glance').isHidden(), true);
  assert.equal(await page.locator('#sessionsPanel').isHidden(), true);
  const pins = page.locator('#map .pin');
  await pins.first().waitFor();
  // Each pin is just the place (what's on is in the list below and in its label).
  assert.deepEqual((await pins.evaluateAll((els) => els.map((e) => [e.dataset.pin, e.textContent, e.getAttribute('aria-label')]))).sort(), [
    ['beach', 'ATX Beach', 'ATX Beach: 1 session · next 6:30pm'],
    ['gym', 'North Gym', 'Austin North Gym: 2 sessions still to come · next 6pm'], // its own short name; its 9am session has ended (it's 5pm)
    ['park', 'Morning Park', "Morning Park: Today's sessions have ended"],
    ['rec', 'Alamo Rec Center', 'Austin Alamo Recreation Center: 1 session · next 7:30pm'], // shortened: no "Austin", "Rec Center"
  ]);
  assert.equal(await page.locator('#map .pin[data-pin="park"]').evaluate((e) => e.classList.contains('done')), true);
  // Under the map, every place as a row: name, town, and what's on.
  assert.match(await page.locator('#mapPanel .map-hint').textContent(), /^4 places with volleyball today\. Tap one for its day and sign-ups\. 1 more without a location are in the list\.$/);
  assert.deepEqual(await page.locator('#mapPanel .place-row').evaluateAll((els) => els.map((e) => [e.dataset.pin, e.querySelector('.pr-status').textContent, e.classList.contains('dim')])), [
    ['beach', '1 session · next 6:30pm', false], ['rec', '1 session · next 7:30pm', false], ['gym', '2 sessions still to come · next 6pm', false], ['park', "Today's sessions have ended", true],
  ]);
  // Tap a pin: the place sheet opens over the map with that place's day, each sign-up and
  // the venue's Book (opened on this day); the list under the map stays and marks the pick.
  await page.locator('#map .pin[data-pin="gym"]').click();
  const panel = page.locator('#mapPanel'), sheet = page.locator('#placeSheet');
  await sheet.waitFor();
  assert.match(await sheet.locator('.g-venue small').textContent(), /^Austin$/, 'open play: no court price on the place');
  assert.equal(await sheet.locator('a.v-book, a.signup', { hasText: 'Book' }).first().getAttribute('href'), `https://club.podplay.app/book/main/${TODAY}`);
  assert.deepEqual(await sheet.locator('.pop-item a.signup').evaluateAll((els) => els.map((e) => e.getAttribute('href'))), [`${SIGNUP}/g0`, `${SIGNUP}/g1`, `${SIGNUP}/g2`]);
  assert.deepEqual(await sheet.locator('.pop-item').evaluateAll((els) => els.map((e) => e.classList.contains('past'))), [true, false, false], 'the ended session is dimmed');
  assert.equal(await page.locator('#map .pin[data-pin="gym"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.locator('.place-row[data-pin="gym"]').getAttribute('aria-pressed'), 'true');
  await sheet.locator('.ps-x').click(); // ✕ closes the sheet
  assert.equal(await sheet.isHidden(), true);
  assert.equal(await panel.locator('.place-row').count(), 4);
  await panel.locator('.place-row[data-pin="beach"]').click(); // a row picks its pin
  assert.equal(await page.locator('#map .pin[data-pin="beach"]').getAttribute('aria-pressed'), 'true');
  assert.match(await sheet.locator('.g-venue').textContent(), /ATX Beach/);
  await page.keyboard.press('Escape'); // Esc closes it too
  assert.equal(await sheet.isHidden(), true);
  await page.locator('#map .pin[data-pin="beach"]').click();
  await page.locator('#map .pin[data-pin="beach"]').click(); // tapping the pin again closes it
  assert.equal(await sheet.isHidden(), true);
  // Court booking: pins are the places to book, labelled with the price. The day and chips stay in the header.
  assert.equal(await page.locator('#filters').isVisible(), true);
  await page.locator('[data-view="booking"]').click();
  await page.locator('#map .pin.book').first().waitFor();
  assert.deepEqual(await page.locator('#map .pin').evaluateAll((els) => els.map((e) => [e.querySelector('b').textContent, e.getAttribute('aria-label')])), [['North Gym', 'Austin North Gym: Courts free 7pm–11pm · $30/hr']]);
  assert.equal(await panel.locator('.pr-status').textContent(), 'Courts free 7pm–11pm · $30/hr');
  await panel.locator('.place-row').click();
  assert.equal(await sheet.locator('.map-status').textContent(), 'Courts free 7pm–11pm · $30/hr');
  await sheet.locator('.ps-x').click();
  // The view is shareable and remembered; List brings the day's chart and lists back.
  await page.reload();
  await page.locator('#map .pin').first().waitFor();
  assert.equal(await page.locator('#mapCard').isVisible(), true);
  await page.locator('[data-layout="list"]').click();
  assert.equal(await page.locator('#mapCard').isHidden(), true);
  assert.equal(new URL(page.url()).searchParams.get('layout'), null);
});

test('site: Map view: free public courts with coordinates get their own pins in Court booking, with directions', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] }] };
  const sched = structuredClone(SCHEDULE);
  sched.region = { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago' };
  sched.venues = [{ id: 'gym', name: 'Austin North Gym', short: 'North Gym', city: 'Austin', lat: 30.4, lng: -97.7, bookingLink: { sport: 'volleyball', url: 'https://club.podplay.app/book/main', price: '$30/hr' } }];
  sched.sessions = [];
  sched.publicCourts = { note: 'Free, first-come.', courts: [
    { park: 'Pease District Park', address: '1100 Kingsbury St', lat: 30.2845, lng: -97.7539, surface: 'sand', courts: 3, lights: true, region: 'austin' },
    { park: 'Krieg Athletic Complex', address: '425 S Pleasant Valley Rd', lat: 30.2468, lng: -97.7167, surface: 'sand', courts: 4, lights: true, closedUntil: '2099-01-01', region: 'austin' },
    { park: 'Yates Pocket Park', address: '6015 Felix Ave', surface: 'grass', courts: 1, lights: false, region: 'austin' },
  ] };
  await open({ index: INDEX, regions: { austin: sched }, maps: { maps: [{ region: 'austin', bbox: [-98.05, 30.1, -97.47, 30.78] }] }, url: '/?layout=map' });
  await page.locator('[data-view="booking"]').click();
  await page.locator('#map .pin.free').first().waitFor();
  assert.deepEqual((await page.locator('#map .pin').evaluateAll((els) => els.map((e) => [e.dataset.pin, e.querySelector('b').textContent, e.className.includes('free'), e.className.includes('done')]))).sort(), [
    ['court:krieg-athletic-complex', 'Krieg Athletic Complex', true, true], // closed: on the map, dimmed
    ['court:pease-district-park', 'Pease Park', true, false],
    ['gym', 'North Gym', false, false],
  ]);
  const panel = page.locator('#mapPanel');
  assert.match(await panel.locator('.map-hint').textContent(), /^1 place to book a court and 2 free public courts today\. Tap one for its day, Book or directions\. 1 public court without a location is in the list\.$/);
  await page.locator('#map .pin[data-pin="court:pease-district-park"]').click();
  const sheet = page.locator('#placeSheet');
  assert.equal(await sheet.locator('.map-status').textContent(), 'Free, first come · 3 sand courts, lit');
  assert.match(await sheet.locator('.g-venue').textContent(), /Pease District Park\s*Free public court/);
  assert.match(await sheet.locator('a', { hasText: 'Google Maps' }).getAttribute('href'), /destination=Pease%20District%20Park%2C%201100%20Kingsbury%20St/);
  assert.equal(await sheet.locator('a.signup').count(), 0, 'nothing to book at a free court');
  // Grass only: the sand courts leave the map.
  await page.locator('#map .pin[data-pin="court:pease-district-park"]').click();
});

test('site: Map view: pins at the same spot fold into one "+N more" that zooms in when tapped', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] }] };
  const sched = structuredClone(SCHEDULE);
  sched.region = { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago' };
  sched.venues = [{ id: 'a', name: 'Twin A', city: 'Austin', lat: 30.3, lng: -97.75 }, { id: 'b', name: 'Twin B', city: 'Austin', lat: 30.3001, lng: -97.7501 }, { id: 'far', name: 'Far Park', city: 'Austin', lat: 30.6, lng: -97.4 }];
  const at = (id, venueId, venue) => ({ ...base, id, sourceId: 'manual', date: TODAY, start: '19:00', end: '21:00', title: id, venueId, venue, city: 'Austin', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/${id}` }, source: `${SIGNUP}/${id}` });
  sched.sessions = [at('s1', 'a', 'Twin A'), at('s2', 'b', 'Twin B'), at('s3', 'far', 'Far Park')];
  await open({ index: INDEX, regions: { austin: sched }, maps: { maps: [{ region: 'austin', bbox: [-98.05, 30.1, -97.3, 30.78] }] }, url: '/?layout=map' });
  await page.locator('#map .pin').first().waitFor();
  await page.waitForTimeout(300);
  const shown = page.locator('#map .pin:not([hidden])');
  assert.equal(await shown.count(), 2);
  const group = page.locator('#map .pin[data-group]');
  assert.equal(await group.locator('.more').textContent(), '+1 more');
  assert.match(await group.getAttribute('aria-label'), /1 more here: Twin [AB]\. Tap to zoom in\./);
  const before = await page.evaluate(() => window.__schelaggMap.getZoom());
  await group.click();
  await page.waitForFunction((z) => window.__schelaggMap.getZoom() > z + 2 && !window.__schelaggMap.isMoving(), before, { timeout: 8000 });
});

test('site: the level sheet and the sport sheet apply on a tap and close by Esc, ✕ or a tap outside', async () => {
  await open();
  const btn = page.locator('#levelBtn'), sheet = page.locator('#levelSheet');
  assert.equal(await btn.textContent(), 'All courts ▾');
  assert.equal(await sheet.isHidden(), true);
  await btn.click();
  assert.equal(await sheet.isVisible(), true);
  assert.equal(await page.locator('#levelSheetTitle').textContent(), 'Court type');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'all', 'focus starts on the current choice');
  await page.keyboard.press('Escape');
  assert.equal(await sheet.isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'levelBtn', 'focus goes back to the chip');
  await btn.click();
  await sheet.locator('[data-close]').click();
  assert.equal(await sheet.isHidden(), true);
  await btn.click();
  await page.mouse.click(10, 10); // the dimmed backdrop above the sheet
  assert.equal(await sheet.isHidden(), true);
  await pick('sand');
  assert.equal(await btn.textContent(), 'Sand ▾');
  assert.equal(await btn.evaluate((e) => e.classList.contains('on')), true);
  assert.deepEqual(await titles(), ['Afternoon Sand Open Play', 'Sunday Sand Social']);
  // Counts follow the day being viewed: tomorrow has no sand.
  await page.locator('#days [data-di="1"]').click();
  assert.deepEqual(await page.locator('#tabs .tab .n').allTextContents(), ['2', '2', '', '']);
  // The Sports tab opens the sport sheet: it closes on a tap outside, and the current sport is
  // the pressed option.
  assert.equal(await page.locator('#sportsOpts [data-sport="volleyball"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#topTabs [data-section="sports"]').click();
  assert.equal(await page.locator('#sportSheet').isVisible(), true);
  await page.mouse.click(10, 10);
  assert.equal(await page.locator('#sportSheet').isHidden(), true);
  await pickSport('ice_skating');
  assert.equal(await page.locator('#sportsOpts [data-sport="ice_skating"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await btn.isHidden(), true, 'skating has no level or court type');
});

test('site: late in the day, "Nothing else today" leads to tomorrow, and the ended fold stays open once opened', async () => {
  await open({ clock: new Date('2026-10-26T04:40:00Z') }); // Sun Oct 25, 11:40pm in Austin
  assert.equal(await page.locator('#list .now').count(), 0, 'no "Now" heading over nothing');
  const empty = page.locator('#list .empty', { hasText: 'Nothing else today.' });
  assert.equal(await empty.isVisible(), true);
  await page.locator('#list details.earlier > summary').click();
  await page.locator('#days [data-di="1"]').click(); // keyboard focus follows the redrawn day
  assert.equal(await page.evaluate(() => document.activeElement.dataset.di), '1');
  await page.locator('#days [data-di="0"]').click();
  assert.equal(await page.locator('#list details.earlier').getAttribute('open'), '', 'still open after a redraw');
  await empty.locator('button').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#dayTitle').textContent(), /^Tomorrow/);
  assert.equal(await page.evaluate(() => document.activeElement.closest('#days') && document.activeElement.dataset.di), '1', 'focus lands on the day');
});

test('site: no Map button without a map for the region', async () => {
  await open({ index: { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] }] }, regions: { austin: SCHEDULE }, url: '/?layout=map' });
  assert.equal(await page.locator('#layout').isHidden(), true);
  assert.equal(await page.locator('#mapCard').isHidden(), true);
  assert.equal(await page.locator('#glance').isVisible(), true);
  assert.equal(new URL(page.url()).searchParams.get('layout'), null);
});

test('site: with one region the city is a plain label, not a menu', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball', 'ice_skating'] }] };
  await open({ index: INDEX, regions: { austin: { ...SCHEDULE, region: { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago' } } } });
  assert.equal(await page.locator('#regionPick').isHidden(), true);
  assert.equal(await page.locator('#regionName').textContent(), 'Austin, TX');
  assert.equal(new URL(page.url()).searchParams.get('region'), null);
  assert.match(await page.locator('#subscribe a').first().getAttribute('href'), /\/data\/regions\/austin\/volleyball\.ics$/);
});

test('site: a viewer a day ahead (Tokyo) still gets Austin\'s today and its sessions', async () => {
  // 5pm Sunday in Austin is already 7am Monday in Tokyo.
  await open({ timezoneId: 'Asia/Tokyo' });
  assert.equal(await page.locator('#dayTitle').textContent(), 'Today · Sunday, Oct 25');
  assert.ok((await titles()).includes('Sunday Sand Social'));
  assert.ok(!(await titles()).includes('Monday Night Training'));
});

test('site: on the night clocks go back, 7:30pm CST is still Sunday Nov 1 in Austin', async () => {
  // 01:30Z on Nov 2 is 7:30pm CST (UTC−6) on Nov 1; with last week's −5 it would read 8:30pm.
  await open({ clock: new Date('2026-11-02T01:30:00Z'), timezoneId: 'UTC' });
  assert.equal(await page.locator('#dayTitle').textContent(), 'Today · Sunday, Nov 1');
  assert.ok((await titles()).includes('Sunday Sand Social')); // weekly, 7–10pm: still on
});

test('site: the day picker switches to other days of the week', async () => {
  await open();
  const days = page.locator('#days .day');
  assert.equal(await days.count(), 7);
  assert.deepEqual(await page.locator('#days .day .dn').allTextContents(), ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.equal(await days.nth(1).getAttribute('aria-label'), 'Monday 26, 2 sessions');

  await days.nth(1).click();
  assert.equal(await days.nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#dayTitle').textContent(), 'Tomorrow · Monday, Oct 26');
  assert.deepEqual(await titles(), ['Monday Night Training', 'ACES Monday Open Play']);
  assert.equal(await page.locator('#list .now').count(), 0, 'no "Now" marker on other days');
  assert.match(await page.locator('#calTitle').textContent(), /Open-play calendar · Mon, Oct 26/);

  await days.nth(2).click();
  assert.equal(await rows().count(), 0);
  assert.match(await page.locator('#list .empty').textContent(), /^No confirmed sessions\./);
});

test('site: "Show ended & unconfirmed" reveals canceled and unconfirmed sessions without sign-up links', async () => {
  await open();
  await page.locator('#showAll').check();
  assert.deepEqual(await titles(), ['Morning Adult Training', 'Afternoon Sand Open Play', 'Canceled Adult Training', 'Evening Indoor Open Gym', 'Sunday Coed Net Volleyball', 'Sunday Sand Social', 'Sunday Indoor League']);
  const canceled = row('Canceled Adult Training');
  assert.equal(await canceled.locator('.pill').textContent(), 'Canceled');
  assert.match(await canceled.getAttribute('class'), /\bdim\b/);
  assert.equal(await canceled.locator('a.signup').count(), 0);
  const league = row('Sunday Indoor League');
  assert.equal(await league.locator('.pill').textContent(), 'Unconfirmed');
  assert.equal(await league.locator('.time').textContent(), 'TBD');
  assert.equal(await page.locator('#list > .empty').count(), 0);

  await page.reload();
  await rows().first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('#showAll').isChecked(), true, 'remembered');
  assert.equal(await rows().count(), 7);
});

test('site: the day-at-a-glance chart shows sessions, court bookings and courts open for a meet', async () => {
  await open();
  const bars = page.locator('#cal .g-bar');
  assert.deepEqual(await bars.evaluateAll((els) => els.map((e) => e.dataset.label)), ['9–11a', '4–6p', '7–10p', '6–8p', '7–10p']); // one row per place: ATX Beach's two sessions share a row
  // Venue names wrap instead of being cut off with an ellipsis.
  const clipped = await page.locator('#cal .g-lab').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  assert.deepEqual(clipped, []);
  await bars.nth(3).click();
  assert.equal(await page.locator('#cal .g-pop a.signup').getAttribute('href'), `${SIGNUP}/evening`);

  assert.equal(await page.locator('#cal .g-track.lane').count(), 0);
  await page.locator('[data-view="booking"]').click();
  assert.equal(await page.locator('#cal .g-bar:not(.g-meet)').count(), 0, 'booking shows courts, not every session');
  assert.equal(await page.locator('#sessionsPanel').isHidden(), true);
  const venue = page.locator('#cal .g-venue', { hasText: 'Roots · Treehouse Gym' });
  const text = await venue.locator('small').textContent();
  assert.match(text, /· free 6am–11pm$/); // Court #2 is free whenever Court #1 isn't; sessions stay out of the header
  // One row for the venue: shading by how many courts are free, between every booking edge.
  assert.deepEqual(await page.locator('#cal .g-track.avail .g-seg').evaluateAll((els) => els.map((e) => [e.className, e.textContent])),
    [['g-seg all', ''], ['g-seg some', ''], ['g-seg all', ''], ['g-seg some', ''], ['g-seg all', '']]); // shading only
  assert.equal(await page.locator('#cal .g-seg.some').first().getAttribute('title'), '8am–10am: 1 of 2 courts free');
  // The booking that lines up with the Reclub meet is one blue block; tapping it lists the session with its sign-up.
  const meet = page.locator('#cal .g-meet');
  assert.equal(await meet.count(), 1);
  assert.equal(await meet.getAttribute('aria-label'), 'Roots · Treehouse Gym: Sunday Coed Net Volleyball, 7pm to 10pm');
  await meet.click();
  assert.equal(await meet.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#cal .g-pop a.signup').getAttribute('href'), `${SIGNUP}/reclub`);
  await meet.click();
  assert.equal(await page.locator('#cal .g-pop').count(), 0);
  // Per-court lanes are one tap away; the private booking is just booked.
  const toggle = page.locator('#cal [data-fac]');
  assert.equal(await toggle.textContent(), '2 courts ▾');
  assert.equal(await page.locator('#cal .g-track.lane').count(), 0);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#cal .g-track.lane').count(), 2);
  assert.equal(await page.locator('#cal div.g-book').getAttribute('title'), 'Booked 8am–10am');
  await toggle.click();
  assert.equal(await page.locator('#cal .g-track.lane').count(), 0);
  assert.equal(await page.locator('#cal .g-now').count() > 0, true);
  assert.match(await page.locator('#calNote').textContent(), /Checked 5 min ago/);
  assert.equal(await page.locator('#calErrors').textContent(), '');
});

test('site: long venue names show in full on a 320px phone and on desktop, and the page never scrolls sideways', async () => {
  const LONG = 'Northeast Metropolitan Community Recreation and Aquatics Center';
  const long = { ...base, id: 'long-venue', sourceId: 'manual', date: TODAY, start: '18:30', end: '21:00', title: `${LONG} · Open play`, venue: LONG, city: 'Austin', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/long`, label: 'Venue details' }, source: `${SIGNUP}/long` };
  await open({ schedule: { ...SCHEDULE, sessions: [...SESSIONS, long] } });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => !el.closest('.gantt') && el.getBoundingClientRect().right > innerWidth + 0.5).map((el) => `${el.tagName}.${el.className}`).slice(0, 5));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: page fits the screen (too wide: ${wide.join(', ')})`);
    // Every place the name appears shows all of it: no ellipsis, clamp or clipping, nothing past the screen edge.
    const cut = await page.evaluate((name) => [...document.querySelectorAll('.venue b, .g-lab, .title')].filter((el) => el.textContent.includes(name.split(' ')[0])).flatMap((el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const bad = [];
      if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) bad.push('truncated');
      if (el.scrollWidth > el.clientWidth + 1 || r.right > innerWidth + 1) bad.push('clipped');
      for (const s of el.querySelectorAll('small')) if (getComputedStyle(s).webkitLineClamp !== 'none' && getComputedStyle(s).webkitLineClamp) bad.push('sub-line clamped');
      return bad.map((b) => `${el.className}: ${b}`);
    }), LONG);
    assert.deepEqual(cut, [], `${width}px`);
    assert.equal(await row(LONG).locator('.venue b').textContent(), LONG);
  }
  // In the chart the line under the name doesn't repeat it.
  const lab = page.locator('#cal .g-lab', { hasText: LONG });
  assert.equal(await lab.textContent(), `${LONG}Open play`);
});

test('site: "Book a court" opens the venue calendar on the day being viewed', async () => {
  await open({ url: '/?view=booking' });
  const book = () => page.locator('#cal .g-venue', { hasText: 'Roots · Treehouse Gym' }).locator('a.v-book');
  assert.equal(await book().getAttribute('href'), `https://treehousegym.skedda.com/booking?viewdate=${TODAY}`);
  await page.locator('#days .day').nth(2).click();
  const later = await page.locator('#days .day').nth(2).getAttribute('data-iso').catch(() => null);
  const href = await book().getAttribute('href');
  assert.match(href, /^https:\/\/treehousegym\.skedda\.com\/booking\?viewdate=\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(href, `https://treehousegym.skedda.com/booking?viewdate=${TODAY}`);
  if (later) assert.equal(href, `https://treehousegym.skedda.com/booking?viewdate=${later}`);
});

test('site: a venue without a per-day link falls back to its calendar', async () => {
  const venue = { ...COURTS.venues[0] };
  delete venue.calendarDay;
  await open({ url: '/?view=booking', courts: { ...COURTS, venues: [venue] } });
  const book = page.locator('#cal .g-venue', { hasText: 'Roots · Treehouse Gym' }).locator('a.v-book');
  assert.equal(await book.getAttribute('href'), 'https://treehousegym.skedda.com/booking');
});

test('site: overlapping sessions on a venue\'s courts are one "N sessions" block listing each with its sign-up', async () => {
  const sched = structuredClone(SCHEDULE);
  const meetAt = sched.sessions.find((x) => x.facility === 'treehouse');
  sched.sessions.push({ ...meetAt, id: 'second-meet', title: 'Sunday Advanced Court', start: '20:00', end: '22:00', signup: { url: `${SIGNUP}/second` }, source: `${SIGNUP}/second` });
  const courts = structuredClone(COURTS);
  const tree = courts.venues.find((v) => v.facilities.some((f) => f.id === 'treehouse')).facilities.find((f) => f.id === 'treehouse');
  tree.courts[1].days[TODAY] = [...(tree.courts[1].days[TODAY] ?? []).filter(([s]) => s !== '20:00'), ['20:00', '22:00']];
  await open({ schedule: sched, url: '/?view=booking', courts });
  const meet = page.locator('#cal .g-meet');
  await meet.first().waitFor(); // court data loads after the schedule
  assert.equal(await meet.count(), 1);
  assert.equal(await meet.getAttribute('data-label'), '2 sessions');
  await meet.click();
  assert.deepEqual(await page.locator('#cal .g-pop .pop-item a.signup').evaluateAll((els) => els.map((e) => e.getAttribute('href'))), [`${SIGNUP}/reclub`, `${SIGNUP}/second`]);
});

test('site: court data falls back to /api/courts, and failures say so', async () => {
  // No pre-built courts.json: the page asks the live API.
  await open({ url: '/?view=booking', courts: null, apiCourts: { status: 200, body: { ...COURTS, errors: [{ venue: 'velocity', calendar: 'https://austinvelocity.skedda.com/booking', message: 'HTTP 503' }] } } });
  await page.locator('#cal .g-meet').waitFor();
  assert.deepEqual(apiCalls, ['/api/courts?days=7']);
  assert.match(await page.locator('#calErrors').textContent(), /Couldn't load some court calendars right now · open velocity calendar ↗/);
  await context.close();

  // Neither: an error, and the schedule still shows.
  await open({ url: '/?view=booking', courts: null });
  await page.locator('#calErrors .error').waitFor();
  assert.match(await page.locator('#calErrors').textContent(), /Couldn't load some court calendars right now/);
  assert.equal(await rows().count(), 5);
});

test('site: a schedule that fails to load shows an error', async () => {
  await open({ schedule: null });
  assert.match(await page.locator('#list .error').textContent(), /^Couldn't load schedules: data\/schedule\.json: HTTP 500$/);
  assert.equal(await page.locator('#asof').textContent(), 'Loading…');
});

test('site: no live-check UI yet, so the page never calls /api/check', async () => {
  // public/app.js has no "check before sign-up" flow today; /api/check is only for consumers.
  // The mock in open() answers any check with status "changed", so this test is where that
  // flow's assertions go once the site uses it.
  await open();
  await pick('indoor');
  await page.locator('#days .day').nth(1).click();
  await page.locator('#showAll').check();
  await row('Monday Night Training').locator('a.signup').hover();
  assert.deepEqual(apiCalls.filter((c) => c.startsWith('/api/check')), []);
});

test('site: pickleball court booking shows live court lanes where a club publishes them (OpenCourt), with open play linked', async () => {
  const holy = {
    id: 'holy', sport: 'pickleball', region: 'austin', calendar: 'https://app.getopencourt.com/club/holy/book', calendarDay: null, hours: Array(7).fill(['07:00', '23:00']),
    facilities: [{ id: 'holy', venueId: 'rec', name: 'Holy Courts', city: 'Austin', surface: 'outdoor', courts: [
      { name: 'Court 1', days: { [TODAY]: [['10:00', '12:00']] } }, // the indoor pickleball open play at 'rec'
      { name: 'Court 2', days: { [TODAY]: [['13:00', '14:30']] } }, // a member's booking
    ] }],
  };
  const errors = [{ venue: 'velocity', sport: 'volleyball', calendar: 'https://austinvelocity.skedda.com/booking', message: 'HTTP 503' }];
  const schedule = structuredClone(PICKLE_SCHEDULE);
  schedule.venues[0].bookingLink = { sport: 'pickleball', url: 'https://example.test/book-rec' };
  schedule.venues.push({ id: 'other', name: 'Other Club', city: 'Austin', bookingLink: { sport: 'pickleball', url: 'https://example.test/book-other' } });
  await open({ schedule, url: '/?sport=pickleball&view=booking', courts: { ...COURTS, errors, venues: [...COURTS.venues, holy] } });
  await page.locator('#cal .g-venue', { hasText: 'Holy Courts' }).waitFor(); // court data loads after the schedule
  assert.equal(await page.locator('#glance').isVisible(), true);
  assert.equal(await page.locator('#days').isVisible(), true);
  const group = page.locator('#cal .g-venue', { hasText: 'Holy Courts' });
  assert.equal(await group.locator('small').textContent(), 'Austin · Price not listed · free 7am–11pm');
  // The venue with live courts is booked from its row; the list below is the other venues.
  assert.deepEqual(await page.locator('#bookingCalendars .book-name b').allTextContents(), ['Other Club']);
  assert.equal(await page.locator('#cal .g-venue', { hasText: 'Treehouse' }).count(), 0, 'volleyball courts stay on volleyball');
  assert.equal(await page.locator('#cal .g-seg.some').count(), 2);
  await page.locator('#cal .g-meet').click();
  assert.equal(await page.locator('#cal .g-pop a.signup').getAttribute('href'), `${SIGNUP}/pickle`);
  await page.locator('#cal [data-fac="holy"]').click();
  assert.equal(await page.locator('#cal div.g-book').getAttribute('title'), 'Booked 1pm–2:30pm');
  assert.equal(await group.locator('a.v-book').getAttribute('href'), 'https://app.getopencourt.com/club/holy/book');
  assert.equal(await page.locator('#calErrors').textContent(), '', "volleyball's calendar errors aren't pickleball's");
  // A level chosen in open play doesn't hide courts.
  await page.locator('[data-view="openplay"]').click();
  await pick('advanced');
  await page.locator('[data-view="booking"]').click();
  assert.equal(await page.locator('#cal .g-venue', { hasText: 'Holy Courts' }).count(), 1);
  await pickSport('volleyball');
  assert.match(await page.locator('#calErrors').textContent(), /Couldn't load some court calendars/);
});

test('site: booking and sign-up links open on the chosen day where the site supports it, and court prices show', async () => {
  const schedule = structuredClone(PICKLE_SCHEDULE);
  schedule.venues = [
    { id: 'pod', name: 'Pod Club', city: 'Austin', bookingLink: { sport: 'pickleball', url: 'https://club.podplay.app/book/main', price: '$30–40/hr', reviewBy: '2099-01-01' } },
    { id: 'usta', name: 'Tennis Center', city: 'Austin', bookingLink: { sport: 'pickleball', url: 'https://playtennis.usta.com/austintenniscenter/Booking/BookByDate', price: '$5/person' } },
    { id: 'old', name: 'Old Prices', city: 'Austin', bookingLink: { sport: 'pickleball', url: 'https://example.test/book', price: '$1/hr', reviewBy: '2000-01-01' } },
  ];
  const one = schedule.sessions.at(-1);
  schedule.sessions = [{ ...one, id: 'dash', date: undefined, days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], title: 'Drop-in',
    signup: { url: 'https://apps.daysmartrecreation.com/dash/x/#/online/rink/calendar?location=1' } }];
  await open({ schedule, url: '/?sport=pickleball' });
  await page.locator('#days .day').nth(2).click();
  const day = await page.locator('#days .day').nth(2).getAttribute('data-iso');
  assert.equal(await row('Drop-in').locator('a.signup').getAttribute('href'), `https://apps.daysmartrecreation.com/dash/x/#/online/rink/calendar?location=1&start=${day}&end=${day}`);
  await page.locator('[data-view="booking"]').click();
  const book = (name) => page.locator('#bookingCalendars .book-row', { hasText: name });
  assert.equal(await book('Pod Club').locator('a.signup').getAttribute('href'), `https://club.podplay.app/book/main/${day}`);
  assert.equal(await book('Tennis Center').locator('a.signup').getAttribute('href'), `https://playtennis.usta.com/austintenniscenter/Booking/BookByDate#?date=${day}&role=guest`);
  assert.equal(await book('Old Prices').locator('a.signup').getAttribute('href'), 'https://example.test/book', 'other sites open as they are');
  assert.equal(await book('Pod Club').locator('.price').textContent(), '$30–40/hr');
  assert.equal(await book('Tennis Center').locator('.price').textContent(), '$5/person');
  assert.equal(await book('Old Prices').locator('.price').count(), 0, 'a price past its review date is not shown');
  assert.equal(await book('Old Prices').locator('.noprice').textContent(), 'Price not listed', 'a missing price says so');
});

test('site: pickleball booking is separate, shareable, remembered, and does not imply live vacancies', async () => {
  const schedule = structuredClone(PICKLE_SCHEDULE);
  schedule.venues[0].bookingLink={sport:'pickleball',url:'https://example.test/book',note:'Reserve a private court.'};
  await open({schedule,url:'/?sport=pickleball'});
  assert.equal(await page.locator('#sessionsPanel').isVisible(),true);
  assert.equal(await page.locator('#bookingCalendarsCard').isHidden(),true);
  await page.locator('[data-view="booking"]').click();
  assert.equal(await page.locator('#sessionsPanel').isHidden(),true);
  // No live court data for pickleball: no empty chart, just the venues to book with (the day picker
  // stays, since booking links open on the chosen day where the venue's site allows it).
  assert.equal(await page.locator('#glance').isHidden(),true);
  assert.equal(await page.locator('#days').isVisible(),true);
  assert.equal(await page.locator('#cal a.g-bar').count(),0);
  assert.equal(await page.locator('#bookingCalendars a.signup', {hasText:'Book'}).getAttribute('href'),'https://example.test/book');
  assert.equal(new URL(page.url()).searchParams.get('view'),'booking');
  await page.reload();
  await page.locator('#bookingCalendarsCard').waitFor();
  assert.equal(await page.locator('[data-view="booking"]').getAttribute('aria-pressed'),'true');
  await pickSport('ice_skating');
  assert.equal(await page.locator('#calendarModes').isHidden(),true);
  assert.equal(await page.locator('#sessionsPanel').isVisible(),true);
});

// --- Sign-ups: leagues and tournaments (data/programs.json) ---------------------------------

const prog = (id, extra) => ({ id, kind: 'league', sport: 'volleyball', surface: 'indoor', region: 'austin', state: 'TX', series: null, org: 'Example League Co', source_id: 'x', title: id,
  venue: 'Example Gym', city: 'Austin', address: null, lat: null, lng: null, format: null, level: null, divisions: [], starts_on: '2026-11-15', ends_on: '2027-01-10', weekdays: ['Sunday'],
  registration_opens: null, registration_deadline: '2026-11-13', waitlist_on: null, team_price: '$600', individual_price: '$90', price_note: null, price_changes_on: null, status: 'open',
  signup_url: `${SIGNUP}/${id}`, source_url: `${SIGNUP}/${id}`, feed_source: 'x', checked_at: '2026-10-25T13:00:00.000Z', ...extra });
const PROGRAMS = {
  feedVersion: 1, generatedAt: '2026-10-25T13:00:00.000Z',
  sources: [{ id: 'x', ok: true, checkedAt: '2026-10-25T13:00:00.000Z', count: 6 }, { id: 'y', ok: false, checkedAt: '2026-10-24T13:00:00.000Z', count: 0, error: 'HTTP 503' }],
  programs: [
    prog('Last Call Sand League', { surface: 'sand', registration_deadline: TODAY, weekdays: ['Monday'] }),
    prog('Holiday Spikes', { kind: 'tournament', starts_on: '2026-12-05', ends_on: '2026-12-05', weekdays: ['Saturday'], registration_deadline: '2026-12-04', team_price: '$315–415', individual_price: '$50', price_note: 'Early bird', price_changes_on: '2026-10-26' }),
    prog('Sunday Indoor League', {}),
    prog('Winter League', { registration_deadline: '2027-01-03', starts_on: '2027-01-10', ends_on: '2027-03-21', status: 'closed', registration_opens: '2026-12-01' }),
    prog('Austin Pride Cup', { kind: 'tournament', series: 'nagva', org: 'NAGVA', starts_on: '2026-11-28', ends_on: '2026-11-29', registration_deadline: '2026-11-20', individual_price: null, team_price: '$500', divisions: [{ name: 'BB', cap: 12, confirmed: 7 }] }),
    prog('Battle of the Example', { kind: 'tournament', series: 'nagva', org: 'NAGVA', region: null, city: 'San Antonio', starts_on: '2026-12-18', ends_on: '2026-12-19', registration_deadline: '2026-12-01', individual_price: null, team_price: '$650' }),
    prog('Pickle League', { sport: 'pickleball', surface: null }),
    prog('Dallas League', { region: 'dallas', city: 'Dallas' }),
  ],
};
const AUSTIN_INDEX = { regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball', 'pickleball', 'ice_skating'] }] };
const progTitles = () => page.locator('#programs .prog .p-title').allTextContents();
const groups = () => page.locator('#programs .p-group').evaluateAll((hs) => hs.map((h) => h.firstChild.textContent));
const hostChips = () => page.locator('#hosts .pill-btn').evaluateAll((bs) => bs.map((b) => b.firstChild.textContent.trim() + b.querySelector('.n').textContent));
const card = (t) => page.locator('#programs .prog', { has: page.locator('.p-title', { hasText: t }) });

test('site: Leagues and Tournaments are their own tabs, by deadline, filtered by host', async () => {
  await open({ programs: PROGRAMS, index: AUSTIN_INDEX, regions: { austin: SCHEDULE } });
  // Open play today: a league closing today is called out above the list, and leads to Leagues.
  const heads = page.locator('#list .heads-up');
  assert.match(await heads.textContent(), /Sign-ups closing today:\s*Last Call Sand League/);
  await heads.click();
  assert.equal(await page.locator('#calendarModes [data-view="leagues"]').getAttribute('aria-pressed'), 'true');
  assert.match(page.url(), /view=leagues/);
  // Not about a day: the day strip, charts and session list step aside.
  for (const id of ['days', 'sessionsPanel', 'glance', 'levelBtn']) assert.equal(await page.locator(`#${id}`).isHidden(), true, id);
  assert.deepEqual(await groups(), ['Closing this week', 'Open', 'Not open yet, full or closed']);
  // Leagues only, soonest deadline first; Dallas and pickleball aren't here.
  assert.deepEqual(await progTitles(), ['Last Call Sand League', 'Sunday Indoor League', 'Winter League']);
  assert.equal(await card('Last Call Sand League').locator('.p-badge').textContent(), 'Last day to sign up');
  assert.match(await card('Sunday Indoor League').locator('.p-price').textContent(), /\$600 team · \$90 free agent/);
  assert.match(await card('Sunday Indoor League').locator('.p-when').textContent(), /Sundays · Nov 15 – Jan 10/);
  assert.equal(await card('Sunday Indoor League').locator('.p-dl').textContent(), 'Sign up by Fri, Nov 13');
  assert.equal(await card('Winter League').locator('.p-dl').textContent(), 'Opens Dec 1');
  assert.equal(await card('Sunday Indoor League').getByRole('link', { name: /Sign up for Sunday Indoor League/ }).getAttribute('href'), `${SIGNUP}/Sunday Indoor League`);
  assert.match(await page.locator('#programsNote').textContent(), /couldn't read y/);
  assert.match(await page.locator('#asof').textContent(), /twice a day/);
  // One host among the leagues: no host chips.
  assert.equal(await page.locator('#hosts .pill-btn').count(), 0);

  // Tournaments: the region's, then the rest of Texas; hosts to filter by.
  await page.locator('#calendarModes [data-view="tournaments"]').click();
  // By the month they happen (sign-up deadlines stay on the cards), then the rest of Texas.
  assert.deepEqual(await groups(), ['November 2026', 'December 2026', 'Elsewhere in Texas']);
  assert.deepEqual(await progTitles(), ['Austin Pride Cup', 'Holiday Spikes', 'Battle of the Example']);
  assert.equal(await card('Holiday Spikes').locator('.p-badge').textContent(), 'Price goes up after tomorrow');
  assert.match(await card('Holiday Spikes').locator('.p-when').textContent(), /Sat, Dec 5/);
  assert.match(await card('Battle of the Example').locator('.p-org').textContent(), /San Antonio/);
  assert.deepEqual(await hostChips(), ['All hosts3', 'NAGVA2', 'Example League Co1']);
  await page.locator('#hosts [data-host="NAGVA"]').click();
  assert.deepEqual(await progTitles(), ['Austin Pride Cup', 'Battle of the Example']);
  assert.equal(await page.locator('#hosts [data-host="NAGVA"]').getAttribute('aria-pressed'), 'true');
  assert.match(page.url(), /view=tournaments&host=NAGVA/);
  assert.match(await page.locator('#programsCount').textContent(), /2 tournaments from NAGVA listed/);
  const cup = card('Austin Pride Cup');
  await cup.locator('details.more summary').click();
  assert.match(await cup.locator('.divs').textContent(), /BB · 7 of 12 teams confirmed/);
  // Switching tabs starts with every host again.
  await page.locator('#calendarModes [data-view="leagues"]').click();
  assert.doesNotMatch(page.url(), /host=/);

  // A shared host link opens the same view, before and after the feed loads; the old Sign-ups links still work.
  await context.close();
  await open({ programs: PROGRAMS, index: AUSTIN_INDEX, regions: { austin: SCHEDULE }, url: '/?view=tournaments&host=NAGVA' });
  await page.locator('#programs .prog').first().waitFor();
  assert.deepEqual(await progTitles(), ['Austin Pride Cup', 'Battle of the Example']);
  await context.close();
  await open({ programs: PROGRAMS, index: AUSTIN_INDEX, regions: { austin: SCHEDULE }, url: '/?view=signups&kind=nagva' });
  await page.locator('#programs .prog').first().waitFor();
  assert.equal(await page.locator('#calendarModes [data-view="tournaments"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await progTitles(), ['Austin Pride Cup', 'Battle of the Example']);
  // A host with nothing listed falls back to every host.
  await context.close();
  await open({ programs: PROGRAMS, index: AUSTIN_INDEX, regions: { austin: SCHEDULE }, url: '/?view=leagues&host=Nobody' });
  await page.locator('#programs .prog').first().waitFor();
  assert.equal((await progTitles()).length, 3);
  assert.doesNotMatch(page.url(), /host=/);
  // Pickleball has its own.
  await pickSport('pickleball');
  assert.deepEqual(await progTitles(), ['Pickle League']);
});

test('site: Leagues says so when the feed can\'t load, and open play is unaffected', async () => {
  await open({ programs: null, url: '/?view=leagues' });
  await page.locator('#programs .error').waitFor();
  assert.match(await page.locator('#programs .error').textContent(), /Couldn't load leagues/);
  await page.locator('#calendarModes [data-view="openplay"]').click();
  assert.ok((await titles()).length > 0);
  assert.equal(await page.locator('#list .heads-up').count(), 0);
});

test('site: Leagues work when the day\'s schedule can\'t load; a price step gets its own heads-up', async () => {
  await open({ programs: PROGRAMS, schedule: null, url: '/?view=leagues' });
  await page.locator('#programs .prog').first().waitFor();
  assert.ok((await progTitles()).includes('Sunday Indoor League'));
  assert.match(await page.locator('#programsCount').textContent(), /\d+ leagues listed/);
  await context.close();
  const priceDay = { ...PROGRAMS, programs: [prog('Early Bird Cup', { kind: 'tournament', registration_deadline: '2026-11-20', price_note: 'Early bird', price_changes_on: TODAY })] };
  await open({ programs: priceDay, index: AUSTIN_INDEX, regions: { austin: SCHEDULE } });
  await page.locator('#list .heads-up').waitFor();
  assert.match(await page.locator('#list .heads-up').textContent(), /Last day at today's price:\s*Early Bird Cup/);
  await page.locator('#list .heads-up').click();
  assert.equal(await page.locator('#calendarModes [data-view="tournaments"]').getAttribute('aria-pressed'), 'true');
});

test('site: a session with no venue name (a Meetup event) renders on every day, in List and Map, with no script errors', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago', center: [32.8, -96.95], sports: ['volleyball'] }] };
  const MAPS = { maps: [{ region: 'dallas', bbox: [-97.6, 32.4, -96.3, 33.3], maxzoom: 14 }] };
  const sched = structuredClone(SCHEDULE);
  sched.region = { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago' };
  sched.venues = [{ id: 'src-t4-court-rentals', name: 'Sports Garden', city: 'Coppell', lat: 32.96, lng: -96.99, region: 'dallas' }];
  const at = (id, date, venue, venueId) => ({ ...base, region: 'dallas', id, sourceId: 'dallas-meetup', date, start: '20:00', end: '22:00', title: `Adult Open Gym Volleyball ${id}`, venue, ...(venueId ? { venueId } : {}), city: 'Lewisville', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/${id}` }, source: `${SIGNUP}/${id}` });
  const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
  sched.sessions = [0, 1, 2, 3, 4, 5, 6].flatMap((n) => [at(`nv${n}`, day(n), null), at(`sg${n}`, day(n), 'Sports Garden', 'src-t4-court-rentals')]);
  await open({ index: INDEX, regions: { dallas: sched }, maps: MAPS, url: '/?region=dallas' });
  for (const layout of ['list', 'map']) {
    if (layout === 'map') await page.locator('#layout [data-layout="map"]').click();
    for (let di = 0; di < 7; di++) {
      await page.locator(`#days [data-di="${di}"]`).click();
      if (layout === 'list') assert.ok((await titles()).some((t) => /Adult Open Gym Volleyball nv/.test(t)), `day ${di}: the venue-less session is listed`);
      else {
        await page.locator('#map .pin').first().waitFor();
        assert.equal(await page.locator('#map .pin').count(), 1, `day ${di}: one pin (the placed venue); the venue-less session is in the list`);
      }
    }
  }
  assert.deepEqual(pageErrors, []);
});

test('sources page: opens from "N sources" on the schedule, lists each source with its link, what it gives and its status', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] }, { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago', center: [32.8, -96.95], sports: ['volleyball'] }] };
  const dallas = structuredClone(SCHEDULE);
  dallas.region = { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago' };
  dallas.sources = [
    { id: 'sportsgarden', name: 'The Sports Garden, Coppell', sport: 'volleyball', region: 'dallas', ok: true, checkedAt: SCHEDULE.generatedAt, count: 1, kind: "Venue's open-play hours page", site: 'https://sportsgardendfw.com/open-play/' },
    { id: 'dallas-reclub', name: 'Reclub · DFW clubs', sport: 'volleyball', region: 'dallas', ok: false, checkedAt: SCHEDULE.generatedAt, failingSince: '2026-10-20T12:00:00Z', error: 'No Reclub meets found', kept: 0, kind: 'Reclub club pages', links: [{ name: 'YNC Volleyball', url: 'https://reclub.co/clubs/@a' }, { name: 'Recreational DFW', url: 'https://reclub.co/clubs/@b' }] },
  ];
  dallas.sessions = [{ ...base, region: 'dallas', id: 'sg', sourceId: 'sportsgarden', days: ['Mon', 'Tue'], date: undefined, start: '15:00', end: '24:00', title: 'Sand open play', venue: 'The Sports Garden', surface: 'sand', type: 'Open play', signup: { url: `${SIGNUP}/sg` }, source: `${SIGNUP}/sg` }];
  const programs = { generatedAt: SCHEDULE.generatedAt, sources: [{ id: 'lonestar-ssc', name: 'Lone Star Sports & Social Club', ok: true, checkedAt: SCHEDULE.generatedAt, site: 'https://lonestarssc.leaguelab.com/', kind: 'League sign-up pages (LeagueLab)', regions: ['dallas'] }], programs: [{ id: 'p1', feed_source: 'lonestar-ssc', region: 'dallas', kind: 'league', sport: 'volleyball', title: 'Coed 6s', org: 'Lone Star', starts_on: '2026-12-01' }] };
  await open({ index: INDEX, regions: { austin: SCHEDULE, dallas }, programs, url: '/?region=dallas' });
  const link = page.locator('#sourcesLink');
  assert.equal(await link.textContent(), '2 sources');
  await link.click();
  await page.waitForURL(/sources\.html\?region=dallas/);
  await page.locator('.src').first().waitFor();
  const rows = page.locator('.src');
  assert.equal(await rows.count(), 3);
  // One line per source until "See details"; working ones first, the broken one last.
  assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.dataset.source)), ['sportsgarden', 'dallas-reclub', 'lonestar-ssc']);
  assert.equal(await page.locator('.src[data-source="sportsgarden"] .more').isVisible(), false);
  assert.equal(await page.locator('.src[data-source="dallas-reclub"] .count').textContent(), 'Not working');
  await page.locator('#details').click();
  assert.equal(await page.locator('#details').textContent(), 'Hide details');
  const sg = page.locator('.src[data-source="sportsgarden"]');
  assert.equal(await sg.locator('a').first().getAttribute('href'), 'https://sportsgardendfw.com/open-play/');
  assert.equal(await sg.locator('.count').textContent(), '1 weekly time slot');
  assert.match(await sg.locator('.status').textContent(), /^Working · checked/);
  const rc = page.locator('.src[data-source="dallas-reclub"]');
  assert.ok(await rc.evaluate((el) => el.classList.contains('bad')));
  assert.match(await rc.locator('.status').textContent(), /Not working since Oct 20 · No Reclub meets found/);
  assert.equal(await rc.locator('.links a').count(), 2);
  assert.equal(await page.locator('.src[data-source="lonestar-ssc"] .count').textContent(), '1 league open for sign-up');
  // The city picker switches cities; ← Schedule goes back to this city.
  assert.match(await page.locator('#back').getAttribute('href'), /\?region=dallas$/);
  await page.locator('#city').selectOption('austin');
  await page.waitForURL(/region=austin/);
  assert.deepEqual(pageErrors, []);
});

// --- Events view (the front page) -----------------------------------------------------------
// The clock is Sun Oct 25 2026, so the first three events below are happening now.
const EVENTS = { feedVersion: 1, generatedAt: '2026-10-25T21:00:00.000Z', events: [
  { id: 'evt-autumn', category: 'seasonal', title: 'Autumn Market', venue: 'Zilker Park', area: 'Zilker', city: 'Austin', startDate: '2026-10-20', endDate: '2026-10-30', startTime: '10:00', endTime: '18:00', price: '$10', sourceUrl: 'https://example.test/autumn', source: 'Example', description: 'Local makers and food trucks under the oaks.', lat: 30.2672, lng: -97.7729, located: 'manual' },
  { id: 'evt-matcha', category: 'asian-inspired', title: 'Matcha Cart', venue: 'South Congress Market', area: 'South Congress', city: 'Austin', startDate: '2026-10-25', endDate: '2026-11-01', price: '$8', sourceUrl: 'https://example.test/matcha', source: 'Example', description: 'Iced matcha and hojicha, poured to order.', lat: 30.25, lng: -97.76, located: 'manual' },
  { id: 'evt-sunday', category: 'popup', title: 'Sunday Pop-up', venue: 'Radio Coffee', area: 'South Austin', city: 'Austin', startDate: '2026-10-25', sourceUrl: 'https://example.test/sunday', source: 'Example', description: 'Coffee, records and vintage clothes.', lat: 30.24, lng: -97.73, located: 'manual' },
  { id: 'evt-night', category: 'popup', title: 'Night Market', venue: 'Republic Square', area: 'Downtown', city: 'Austin', startDate: '2026-10-28', startTime: '17:00', endTime: '22:00', price: 'Free', sourceUrl: 'https://example.test/night', source: 'Example', description: 'Sixty vendors after dark.', lat: 30.271, lng: -97.747, located: 'manual' },
  { id: 'evt-muertos', category: 'seasonal', title: 'Dia de los Muertos', venue: 'Zilker Park', area: 'Zilker', city: 'Austin', startDate: '2026-11-01', price: '$5', sourceUrl: 'https://example.test/muertos', source: 'Example', description: 'Altars, marigolds and pan dulce.', lat: 30.2672, lng: -97.7729, located: 'manual' },
  { id: 'evt-ramen', category: 'asian-inspired', title: 'Ramen Pop-up', venue: 'East Austin Eats', area: 'East Austin', city: 'Austin', startDate: '2026-11-05', endDate: '2026-11-08', sourceUrl: 'https://example.test/ramen', source: 'Example', description: 'Tonkotsu for four nights only.', lat: 30.26, lng: -97.72, located: 'manual' },
  { id: 'evt-flower', category: 'seasonal', title: 'Flower Shop', venue: 'East Cesar Chavez', area: 'East Austin', city: 'Austin', startDate: '2026-11-12', endDate: '2026-11-23', price: '$10/stem', sourceUrl: 'https://example.test/flower', source: 'Example', description: 'A plush flower shop, one stem at a time.', lat: 30.25979, lng: -97.7325, located: 'address' },
  { id: 'evt-vintage', category: 'popup', title: 'Vintage Market', venue: 'Vista Brewing', area: 'Driftwood', city: 'Driftwood', startDate: '2026-11-15', sourceUrl: 'https://example.test/vintage', source: 'Example', description: 'Artisan market out in Driftwood.', lat: 30.10485, lng: -98.02175, located: 'manual' },
  { id: 'evt-front', category: 'seasonal', title: 'Front Market', venue: 'Moody Amphitheater', area: 'Waterloo Park', city: 'Austin', startDate: '2026-11-21', endDate: '2026-11-22', price: 'Free', sourceUrl: 'https://example.test/front', source: 'Example', description: 'Makers and music at the park.', lat: 30.28, lng: -97.72, located: 'address' },
  { id: 'evt-tree', category: 'seasonal', title: 'Tree Lighting', venue: 'Zilker Park', area: 'Zilker', city: 'Austin', startDate: '2026-11-29', sourceUrl: 'https://example.test/tree', source: 'Example', description: 'The Zilker Holiday Tree lights up.', lat: 30.2672, lng: -97.7729, located: 'manual' },
  { id: 'evt-german', category: 'seasonal', title: 'German Market', venue: 'German Free School', area: 'Downtown', city: 'Austin', startDate: '2026-12-05', price: '$10', sourceUrl: 'https://example.test/german', source: 'Example', description: 'Glühwein and ornaments.', lat: 30.27, lng: -97.73, located: 'address' },
  { id: 'evt-finale', category: 'asian-inspired', title: 'Night Market Finale', venue: 'Distribution Hall', area: 'East Austin', city: 'Austin', startDate: '2026-12-12', endDate: '2026-12-13', price: 'Free', sourceUrl: 'https://example.test/finale', source: 'Example', description: 'The season closes with food stalls and DJs.', lat: 30.26, lng: -97.71, located: 'manual' },
] };
// The map test keeps its venues far apart (≥10km) so no two pins fold into each other.
const EVENTS_MAP = { feedVersion: 1, generatedAt: '2026-10-25T21:00:00.000Z', events: [
  { ...EVENTS.events[0] },
  { id: 'evt-matcha-north', category: 'asian-inspired', title: 'Matcha Cart', venue: 'Junbi, Cedar Park', area: 'Cedar Park', city: 'Cedar Park', startDate: '2026-10-25', endDate: '2026-11-01', price: '$8', sourceUrl: 'https://example.test/matcha', source: 'Example', description: 'Iced matcha up north.', lat: 30.505, lng: -97.82, located: 'manual' },
  { id: 'evt-night-north', category: 'popup', title: 'Night Market', venue: 'Pflugerville Plaza', area: 'Pflugerville', city: 'Pflugerville', startDate: '2026-10-28', startTime: '17:00', endTime: '22:00', price: 'Free', sourceUrl: 'https://example.test/night', source: 'Example', description: 'Sixty vendors after dark.', lat: 30.44, lng: -97.62, located: 'manual' },
  { ...EVENTS.events[4] },
  { ...EVENTS.events[7] },
  { id: 'evt-tree-east', category: 'seasonal', title: 'Tree Lighting', venue: 'Manor Market', area: 'Manor', city: 'Manor', startDate: '2026-11-29', sourceUrl: 'https://example.test/tree', source: 'Example', description: 'Lights out east.', lat: 30.34, lng: -97.55, located: 'manual' },
] };

const AUSTIN_ONLY = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] }] };
const MAPS_AUSTIN = { source: '20261107.pmtiles', maps: [{ region: 'austin', bbox: [-98.05, 30.1, -97.47, 30.78], maxzoom: 14 }] };
const austinSched = () => { const s = structuredClone(SCHEDULE); s.region = { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago' }; return s; };
const headings = () => page.locator('#events .ev-day').evaluateAll((els) => els.map((e) => [e.firstChild.textContent, e.querySelector('small').textContent]));

test('site: Events is the front page: On now, Next week and months, a few under each, Show more', async () => {
  // Sun Oct 25: three events are on now; Night Market and Dia de los Muertos are next week.
  await open({ events: EVENTS, url: '/', waitFor: '#events .row' });
  assert.equal(await page.locator('#topTabs [data-section="events"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#topTabs [data-section="sports"]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await headings(), [
    ['On now', '3 events · ending soonest first'],
    ['Next week', 'Mon Oct 26 – Sun Nov 1 · 2 events'],
    ['November', '2026 · 5 events'],
    ['December', '2026 · 2 events'],
  ]);
  assert.deepEqual(await page.locator('#events .ev-group[data-group="now"] .title').allTextContents(), ['Sunday Pop-up', 'Autumn Market', 'Matcha Cart'], 'ending soonest first');
  assert.equal(await page.locator('#events .ev-group[data-group="now"] .pill.fresh').count(), 3);
  // November has five: four shown, then Show 1 more.
  const nov = page.locator('#events .ev-group[data-group="2026-11"]');
  assert.equal(await nov.locator('.row').count(), 4);
  await nov.locator('[data-evmore]').click();
  assert.equal(await page.locator('#events .ev-group[data-group="2026-11"] .row').count(), 5);
  assert.equal(await page.locator('#events .ev-group[data-group="2026-11"] [data-evmore]').count(), 0);
  // A card: the date column, plain chips (a kind, a dashed tag), one main button, Details.
  const autumn = page.locator('#events .row', { hasText: 'Autumn Market' });
  assert.match(await autumn.locator('.time').textContent(), /^ThruOct 30/);
  assert.deepEqual(await autumn.locator('.chip').allTextContents(), ['Seasonal']);
  assert.equal(await autumn.locator('.chip.surf').count(), 0, 'no court-surface colours on events');
  assert.equal(await autumn.locator('a.signup').textContent(), 'Event page ↗');
  assert.equal(await autumn.locator('a.signup').getAttribute('href'), 'https://example.test/autumn');
  assert.equal(await autumn.locator('details.more').getAttribute('open'), null);
  await autumn.locator('details.more summary').click();
  assert.equal(await autumn.locator('details.more .note').textContent(), 'Local makers and food trucks under the oaks.');
  assert.match(await autumn.locator('details.more .actions').textContent(), /Google Maps/);
  assert.equal(await autumn.locator('.via').textContent(), 'Found via Example');
  const matcha = page.locator('#events .row', { hasText: 'Matcha Cart' });
  assert.deepEqual(await matcha.locator('.chip').evaluateAll((els) => els.map((e) => [e.textContent, e.classList.contains('tag')])), [['Asian-inspired', true]]);
  assert.equal(await page.locator('#eventsPager').count(), 0, 'no pager');
  assert.equal(await page.locator('#asof').textContent(), '12 events · checked Oct 25');
  assert.deepEqual(pageErrors, []);
});

test('site: Events filters: the sheet picks a kind and tags, This weekend narrows, links share them', async () => {
  await open({ events: EVENTS, url: '/', waitFor: '#events .row' });
  const pill = page.locator('#eventCats [data-sheet="eventsSheet"]');
  assert.equal(await pill.textContent(), 'All events ▾');
  await pill.click();
  const sheet = page.locator('#eventsSheet');
  assert.equal(await sheet.isVisible(), true);
  assert.deepEqual(await sheet.locator('.tab.opt').evaluateAll((els) => els.map((e) => [e.querySelector('.lbl').firstChild.textContent, e.querySelector('.n').textContent, e.getAttribute('aria-pressed')])), [
    ['All events', '12', 'true'], ['Pop-ups', '3', 'false'], ['Seasonal', '6', 'false'], ['Asian-inspired', '3', 'false'],
  ]);
  await sheet.locator('[data-evkind="seasonal"]').click();
  assert.equal(await sheet.locator('.go-btn').textContent(), 'Show 6 events');
  await sheet.locator('.go-btn').click();
  assert.equal(await sheet.isHidden(), true);
  assert.equal(await pill.textContent(), 'Seasonal ▾');
  assert.equal(await page.locator('#events .row').count(), 6, 'no heading has more than four seasonal events, so all six show');
  assert.match(await page.locator('#eventsCount').textContent(), /^6 of 12 events · Clear filters$/);
  assert.equal(new URL(page.url()).searchParams.get('type'), 'seasonal');
  // A tag on top of a kind: both must match (no seasonal event is Asian-inspired).
  await pill.click();
  await page.locator('#eventsSheet [data-evtag="asian-inspired"]').click();
  assert.equal(await page.locator('#eventsSheet .go-btn').textContent(), 'Show 0 events');
  await page.locator('#eventsSheet [data-evkind="all"]').click();
  assert.equal(await page.locator('#eventsSheet .go-btn').textContent(), 'Show 3 events');
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.locator('#events .row .title').allTextContents(), ['Matcha Cart', 'Ramen Pop-up', 'Night Market Finale']);
  assert.deepEqual(new URL(page.url()).searchParams.getAll('tag'), ['asian-inspired']);
  // Clear filters, then This weekend: on Sunday it's just today.
  await page.locator('#eventsCount [data-evclear]').click();
  assert.equal(await page.locator('#eventsCount').textContent(), '');
  await page.locator('#whenBtn').click();
  await page.locator('#whenSheet [data-evday="weekend"]').click();
  assert.equal(await page.locator('#whenSheet [data-evday="weekend"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#whenSheet .go-btn').click();
  assert.equal(await page.locator('#whenBtn').textContent(), 'This weekend ▾');
  assert.deepEqual(await page.locator('#events .row .title').allTextContents(), ['Sunday Pop-up', 'Autumn Market', 'Matcha Cart']);
  assert.equal(new URL(page.url()).searchParams.get('weekend'), '1');
  // Links open with their filters; an old ?cat= link still works (asian-inspired is a tag now).
  await open({ events: EVENTS, url: '/?view=events&type=popup', waitFor: '#events .row' });
  assert.deepEqual(await page.locator('#events .row .title').allTextContents(), ['Sunday Pop-up', 'Night Market', 'Vintage Market']);
  await open({ events: EVENTS, url: '/?view=events&cat=asian-inspired', waitFor: '#events .row' });
  assert.deepEqual(await page.locator('#events .row .title').allTextContents(), ['Matcha Cart', 'Ramen Pop-up', 'Night Market Finale']);
  assert.deepEqual(pageErrors, []);
});

test('site: the Sports tab opens the sport sheet; picking a sport loads it; Events is one tap back', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball', 'pickleball', 'ice_skating'] }] };
  await open({ index: INDEX, regions: { austin: austinSched() }, events: EVENTS, url: '/', waitFor: '#events .row' });
  const sheet = page.locator('#sportSheet');
  assert.equal(await sheet.isHidden(), true);
  await page.locator('#topTabs [data-section="sports"]').click();
  assert.equal(await sheet.isVisible(), true);
  assert.deepEqual(await page.locator('#sportsOpts .tab.opt .lbl').evaluateAll((els) => els.map((e) => e.firstChild.textContent)), ['Volleyball', 'Pickleball', 'Ice skating']);
  await page.keyboard.press('Escape');
  assert.equal(await sheet.isHidden(), true);
  assert.equal(await page.locator('#topTabs [data-section="events"]').getAttribute('aria-pressed'), 'true', 'closing the sheet keeps Events');
  await page.locator('#topTabs [data-section="sports"]').click();
  await page.locator('#sportsOpts [data-sport="ice_skating"]').click();
  assert.equal(await sheet.isHidden(), true);
  assert.equal(await page.locator('#topTabs [data-section="sports"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#list .row').first().waitFor({ state: 'attached' });
  assert.deepEqual(await page.locator('#list .row .title').allTextContents(), ['Public Skating', 'Evening Session', 'Holiday Rink', 'Adult Skate']);
  await page.locator('#topTabs [data-section="events"]').click();
  await page.locator('#events .row').first().waitFor();
  assert.equal((await headings())[0][0], 'On now');
  assert.deepEqual(pageErrors, []);
});

test('site: Events in a city without an events feed: says so, no Austin events, no map, a way to its open play', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [
    { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] },
    { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago', center: [32.78, -96.8], sports: ['volleyball'] },
  ] };
  const dallas = structuredClone(SCHEDULE); dallas.region = { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago' };
  const MAPS = { source: 'x', maps: [...MAPS_AUSTIN.maps, { region: 'dallas', bbox: [-97.5, 32.5, -96.5, 33.3], maxzoom: 14 }] };
  await open({ index: INDEX, regions: { austin: austinSched(), dallas }, maps: MAPS, events: EVENTS, url: '/?region=dallas&view=events', waitFor: '#events .ev-away' });
  assert.equal(await page.locator('#events .ev-away h2').textContent(), 'Events are Austin-only for now');
  assert.equal(await page.locator('#events .row').count(), 0);
  assert.equal(await page.locator('#layout').isHidden(), true, 'no map of Austin pins in Dallas');
  await page.locator('[data-go-sports]').click();
  await page.locator('#list .row').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('#topTabs [data-section="sports"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(pageErrors, []);
});

test('site: Events map: one pin per venue; a pin opens the place sheet (readable, closes by ✕, Esc or the map)', async () => {
  await open({ index: AUSTIN_ONLY, regions: { austin: austinSched() }, maps: MAPS_AUSTIN, events: EVENTS_MAP, url: '/?view=events', waitFor: '#events .row' });
  await page.locator('#layout [data-layout="map"]').click();
  assert.equal(await page.locator('#mapTitle').textContent(), 'Events · upcoming');
  const pins = page.locator('#map .pin');
  await pins.first().waitFor();
  // Six events, five venues: Zilker Park hosts two, so one pin per venue, named for its event
  // (not its address), with "+1 more" where there are several.
  assert.deepEqual((await pins.evaluateAll((els) => els.map((e) => [e.dataset.pin, e.textContent, e.getAttribute('aria-label')]))).sort(), [
    ['event:30.10485,-98.02175', 'Vintage Market', 'Vintage Market at Vista Brewing: 1 event · Sun, Nov 15'],
    ['event:30.26720,-97.77290', 'Autumn Market+1 more here', 'Autumn Market and 1 more at Zilker Park: Happening now · Oct 20 – 30'],
    ['event:30.34000,-97.55000', 'Tree Lighting', 'Tree Lighting at Manor Market: 1 event · Sun, Nov 29'],
    ['event:30.44000,-97.62000', 'Night Market', 'Night Market at Pflugerville Plaza: 1 event · Wed, Oct 28'],
    ['event:30.50500,-97.82000', 'Matcha Cart', 'Matcha Cart at Junbi: Happening now · Oct 25 – Nov 1'],
  ]);
  assert.equal(await page.locator('#mapPanel .place-row').count(), 5);
  // The rows under the map read the same way: the event, then the place.
  const zilker = page.locator('#mapPanel .place-row[data-pin="event:30.26720,-97.77290"]');
  assert.equal(await zilker.locator('.pr-name').evaluate((e) => e.firstChild.textContent.trim()), 'Autumn Market');
  assert.equal(await zilker.locator('.pr-more').textContent(), '+1 more');
  assert.equal(await zilker.locator('.pr-at').textContent(), 'Zilker Park · Austin');
  const sheet = page.locator('#placeSheet');
  assert.equal(await sheet.isHidden(), true);
  await page.locator('#map .pin[data-pin="event:30.26720,-97.77290"]').click();
  await sheet.waitFor();
  assert.equal(await sheet.locator('.v-name').evaluate((e) => e.firstChild.textContent), 'Zilker Park');
  assert.equal(await sheet.locator('.v-name small').textContent(), 'Austin · 2 events', 'no repeat of the name ("Zilker" is in it)');
  assert.deepEqual(await sheet.locator('.pop-item .pop-w b').allTextContents(), ['Autumn Market', 'Dia de los Muertos']);
  assert.deepEqual(await sheet.locator('.pop-item .pop-t').allTextContents(), ['Thru Oct 30', 'Sun Nov 1']);
  assert.equal(await sheet.locator('.pop-item a.src').first().getAttribute('href'), 'https://example.test/autumn');
  assert.match(await sheet.locator('.location .actions').textContent(), /Google Maps/);
  assert.equal(await page.locator('.maplibregl-popup').count(), 0, 'no MapLibre popup any more');
  // Theme colours: the sheet's text and background come from the page's own tokens.
  const colors = await sheet.evaluate((el) => { const s = getComputedStyle(el), b = getComputedStyle(document.body); return [s.color, b.color, s.backgroundColor]; });
  assert.equal(colors[0], colors[1], 'sheet text is the page ink');
  assert.notEqual(colors[2], 'rgba(0, 0, 0, 0)');
  await sheet.locator('.ps-x').click();
  assert.equal(await sheet.isHidden(), true);
  await page.locator('#mapPanel .place-row[data-pin="event:30.26720,-97.77290"]').click();
  await sheet.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await sheet.isHidden(), true);
  // The view is shareable and remembered; List brings the events list back.
  await page.reload();
  await page.locator('#map .pin').first().waitFor();
  await page.locator('[data-layout="list"]').click();
  assert.equal(await page.locator('#mapCard').isHidden(), true);
  assert.deepEqual(pageErrors, []);
});

test('site: an event with a saved organizer picture shows it on its card, its map row and its pin; others are unchanged', async () => {
  const feed = structuredClone(EVENTS_MAP);
  Object.assign(feed.events[0], { account: 'examplemarket', avatar: 'avatars/examplemarket.jpg', sourceId: 'instagram' });
  Object.assign(feed.events[1], { account: 'evil', avatar: 'https://evil.test/x.jpg' }); // not a saved picture: ignored
  await open({ index: AUSTIN_ONLY, regions: { austin: austinSched() }, maps: MAPS_AUSTIN, events: feed, url: '/?view=events', waitFor: '#events .row' });
  const card = page.locator('#events .row', { hasText: feed.events[0].title });
  assert.equal(await card.locator('.ev-by').textContent(), 'by @examplemarket');
  assert.equal(await card.locator('.ev-by img.av').getAttribute('src'), 'data/avatars/examplemarket.jpg');
  assert.equal(await card.locator('.ev-by img.av').getAttribute('alt'), '', 'decorative: the account is named beside it');
  assert.equal(await page.locator('#events img.av').count(), 1, 'only the event with a saved picture');
  assert.equal(await page.locator('#events .ev-by').count(), 1);
  await page.locator('#layout [data-layout="map"]').click();
  await page.locator('#map .pin').first().waitFor();
  assert.equal(await page.locator('#map .pin img.av').count(), 1);
  assert.equal(await page.locator('#map .pin.has-av img.av').getAttribute('src'), 'data/avatars/examplemarket.jpg');
  assert.equal(await page.locator('#mapPanel .place-row img.av').count(), 1);
  assert.deepEqual(pageErrors, []);
});

test('site: one map for every city: the other cities are bubbles, tapping or moving onto one switches to it, far out the pins fold into bubbles', async () => {
  const INDEX = { generatedAt: SCHEDULE.generatedAt, regions: [
    { id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], sports: ['volleyball'] },
    { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago', center: [32.8, -96.95], sports: ['volleyball'] },
  ] };
  const MAPS = { source: 'x', overview: { file: 'overview.pmtiles', bbox: [-98.7, 29.5, -96.1, 33.6], maxzoom: 8 }, maps: [...MAPS_AUSTIN.maps, { region: 'dallas', bbox: [-97.4, 32.6, -96.7, 33.05], maxzoom: 14 }] };
  const venue = (id, name, lat, lng) => ({ id, name, city: name, lat, lng });
  const sess = (id, venueId, venueName) => ({ ...SCHEDULE.sessions[0], id, date: TODAY, start: '18:00', end: '20:00', title: `Open gym ${id}`, venueId, venue: venueName, levelTag: 'all', sport: 'volleyball' });
  const austin = austinSched(); austin.venues = [venue('a1', 'North Gym', 30.3, -97.75)]; austin.sessions = [sess('a', 'a1', 'North Gym')];
  const dallas = structuredClone(SCHEDULE); dallas.region = { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago' };
  dallas.venues = [venue('d1', 'Dallas Gym', 32.8, -96.9)]; dallas.sessions = [sess('d', 'd1', 'Dallas Gym')];
  const occ = (n) => ({ occurrences: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, sport: 'volleyball', canceled: false, starts_at: `${TODAY}T18:00:00-06:00` })) });
  await open({ index: INDEX, regions: { austin, dallas }, occurrences: { dallas: occ(4), austin: occ(1) }, maps: MAPS, url: '/?view=openplay&layout=map', waitFor: '#map .pin' });
  // The map: a light file of the whole area, and the current city's detailed file from zoom 9.
  // The style arrives a moment after the map object does: wait for it rather than race it.
  const style = async () => { await page.waitForFunction(() => window.__schelaggMap?.getStyle?.()?.sources?.osm); return styleNow(); };
  const styleNow = () => page.evaluate(() => { const s = window.__schelaggMap.getStyle(); return { sources: Object.fromEntries(Object.entries(s.sources).map(([k, v]) => [k, v.url.split('/').pop()])), detailMin: Math.min(...s.layers.filter((l) => l.source === 'osm').map((l) => l.minzoom)), backgrounds: s.layers.filter((l) => l.type === 'background').length }; });
  assert.deepEqual(await style(), { sources: { overview: 'overview.pmtiles', osm: 'austin.pmtiles' }, detailMin: 9, backgrounds: 1 });
  // Opens on its own city with that city's pins; the other city is a bubble that says how much is on.
  assert.equal(await page.locator('#regionPick').inputValue(), 'austin');
  assert.deepEqual(await page.locator('#map .pin:not(.city)').allTextContents(), ['North Gym']);
  const bubble = page.locator('#map .pin.city');
  await page.locator('#map .pin.city span').waitFor({ state: 'attached' });
  assert.deepEqual(await bubble.evaluateAll((els) => els.map((e) => [e.dataset.city, e.querySelector('b').textContent, e.querySelector('span')?.textContent])), [['dallas', 'Dallas–Fort Worth', '4 open plays today']]);
  // Far out, the current city's pins fold into its own bubble.
  await page.evaluate(() => window.__schelaggMap.jumpTo({ zoom: 6 }));
  await page.locator('#map .pin.city[data-city="austin"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#map').evaluate((e) => e.classList.contains('far')), true);
  assert.equal(await page.locator('#map .pin:not(.city)').first().isVisible(), false);
  assert.equal(await page.locator('#map .pin.city[data-city="austin"] span').textContent(), '1 open play today');
  // Tap the other city's bubble: it becomes the city, with its pins and its detailed map.
  await page.locator('#map .pin.city[data-city="dallas"]').dispatchEvent('click');
  await page.locator('#map .pin:not(.city)', { hasText: 'Dallas Gym' }).waitFor();
  assert.equal(await page.locator('#regionPick').inputValue(), 'dallas');
  assert.equal((await style()).sources.osm, 'dallas.pmtiles');
  assert.equal(await page.locator('#map .pin.city[data-city="austin"]').count(), 1, 'Austin is the bubble now');
  // Moving the map onto another city (zoomed in) switches to it and leaves the map where it was put.
  await page.evaluate(() => { const m = window.__schelaggMap; m.jumpTo({ center: [-97.74, 30.27], zoom: 10 }); m.fire('moveend', { originalEvent: {} }); });
  await page.locator('#map .pin:not(.city)', { hasText: 'North Gym' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('#regionPick').inputValue(), 'austin');
  assert.deepEqual(await page.evaluate(() => { const m = window.__schelaggMap; return [m.getZoom(), +m.getCenter().lat.toFixed(2)]; }), [10, 30.27], 'the map stayed put');
  assert.deepEqual(pageErrors, []);
});

test('site: without the overview file the map is one city at a time, as before (no bubbles)', async () => {
  await open({ index: AUSTIN_ONLY, regions: { austin: austinSched() }, maps: MAPS_AUSTIN, events: EVENTS_MAP, url: '/?view=events&layout=map', waitFor: '#map .pin' });
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__schelaggMap.getStyle().sources)), ['osm']);
  assert.equal(await page.locator('#map .pin.city').count(), 0);
  assert.deepEqual(pageErrors, []);
});

test('site: the place sheet in dark mode reads light-on-dark (the old popup was white with light text)', async () => {
  await open({ index: AUSTIN_ONLY, regions: { austin: austinSched() }, maps: MAPS_AUSTIN, events: EVENTS_MAP, url: '/?view=events&layout=map', waitFor: '#map .pin' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#map .pin[data-pin="event:30.26720,-97.77290"]').click();
  const sheet = page.locator('#placeSheet');
  await sheet.waitFor();
  const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [fg, bg] = await sheet.locator('.v-name').evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el.closest('.place-sheet')).backgroundColor]);
  assert.ok(lum(fg) - lum(bg) > 120, `light text on a dark sheet (${fg} on ${bg})`);
  assert.deepEqual(pageErrors, []);
});

test('site: on a phone the place sheet sits at the bottom of the map and the picked pin stays above it; on a computer it docks left', async () => {
  await open({ index: AUSTIN_ONLY, regions: { austin: austinSched() }, maps: MAPS_AUSTIN, events: EVENTS_MAP, url: '/?view=events&layout=map', waitFor: '#map .pin', touch: true });
  const zoom0 = await page.evaluate(() => window.__schelaggMap.getZoom());
  // A pick keeps the pins and rows that are there (no rebuild): the same elements before and after.
  await page.evaluate(() => { window.__pin0 = document.querySelector('#map .pin'); window.__row0 = document.querySelector('#mapPanel .place-row'); });
  for (const w of [390, 320]) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.locator('#map .pin[data-pin="event:30.26720,-97.77290"]').click();
    const sheet = page.locator('#placeSheet');
    await sheet.waitFor();
    await page.waitForTimeout(900); // the map eases the pin up (a pan, then a zoom if the pan couldn't clear the sheet)
    const [m, s, p] = await page.evaluate(() => ['#map', '#placeSheet', '.pin.sel'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
    assert.ok(Math.abs(s.bottom - m.bottom) < 2 && s.left >= m.left - 1 && s.right <= m.right + 1, `${w}px: the sheet sits inside the map, at its bottom`);
    assert.ok(p.bottom <= s.top, `${w}px: the picked pin is above the sheet (${p.bottom} ≤ ${s.top})`);
    if (w === 390) assert.equal(await page.evaluate(() => window.__schelaggMap.getZoom()), zoom0, 'the map pans to clear the sheet; it does not zoom (a zoom loads new tiles)');
    assert.ok((await sheet.locator('.ps-x').evaluate((e) => e.getBoundingClientRect().height)) >= 44, `${w}px: ✕ is 44px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${w}px: the page fits`);
    await sheet.locator('.ps-x').click();
  }
  assert.equal(await page.evaluate(() => window.__pin0.isConnected && window.__row0.isConnected), true, 'picking and closing left the pins and rows in place');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#map .pin[data-pin="event:30.26720,-97.77290"]').click();
  const [m, s] = await page.evaluate(() => ['#map', '#placeSheet'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; }));
  assert.ok(s.width <= 350 && s.left - m.left < 20 && s.height > m.height * 0.8, 'computer: a panel docked at the map\'s left');
  assert.deepEqual(pageErrors, []);
});

test('site: Events on a phone: header, filters and Show more fit; tap targets are 44px; the map FAB stays clear', async () => {
  await open({ index: AUSTIN_ONLY, regions: { austin: austinSched() }, maps: MAPS_AUSTIN, events: EVENTS, url: '/', waitFor: '#events .row', touch: true });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const box = (sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
  for (const w of [390, 320]) {
    await page.setViewportSize({ width: w, height: 760 });
    assert.equal(await fits(), true, `${w}px: the page fits`);
    assert.ok((await box('#topTabs')).right <= w, `${w}px: the Events/Sports seg fits`);
    assert.ok((await box('#topTabs .seg-btn')).height >= 44, 'coarse pointer: seg buttons are 44px');
    assert.ok((await box('#eventCats .pill-btn')).height >= 44, 'coarse pointer: filter pills are 44px');
    assert.ok((await box('#events .show-more')).height >= 44, 'Show more is 44px');
    assert.ok((await box('#events a.signup')).height >= 40, 'the main button is a real button');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#layout [data-layout="map"]').click();
  await page.locator('#map .pin').first().waitFor();
  const fab = await box('#layout .fab');
  assert.ok(fab.height >= 44 && fab.right <= 390, '390px map: the FAB fits');
  const lastRow = page.locator('#mapPanel .place-row').last();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const row = await lastRow.evaluate((el) => { const r = el.getBoundingClientRect(); return { bottom: r.bottom }; });
  assert.ok(row.bottom <= (await box('#layout .fab')).top, '390px map: the last place row scrolls clear of the FAB');
  assert.deepEqual(pageErrors, []);
});

test('site: When on Events: a day and a time of day narrow the list, rows say how they fit, links carry it', async () => {
  await open({ events: EVENTS, url: '/?view=events&on=2026-10-28&from=17:00&to=24:00', waitFor: '#events .row' });
  assert.equal(await page.locator('#whenBtn').textContent(), 'Wed, Oct 28 · Evening ▾');
  const evening = await page.locator('#events .row .title').allTextContents();
  assert.ok(evening.includes('Night Market'), 'the 5pm market is on that evening');
  assert.match(await page.locator('#eventsCount').textContent(), /^\d+ of 12 events · Wed, Oct 28 · Evening · Clear filters$/);
  // Autumn Market runs 10am to 6pm on that day: it overlaps the evening and says so.
  assert.equal(await page.locator('#events .row', { hasText: 'Autumn Market' }).locator('.fit').textContent(), 'Started at 10am');
  // Morning instead: the evening market goes, the day stays.
  await page.locator('#whenBtn').click();
  assert.equal(await page.locator('#whenSheet [data-time="evening"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#whenSheet [data-time="morning"]').click();
  await page.locator('#whenSheet .go-btn').click();
  assert.equal(await page.locator('#whenBtn').textContent(), 'Wed, Oct 28 · Morning ▾');
  assert.ok(!(await page.locator('#events .row .title').allTextContents()).includes('Night Market'));
  assert.equal(new URL(page.url()).searchParams.get('from'), '00:00');
  assert.equal(new URL(page.url()).searchParams.get('to'), '12:00');
  // Clear filters puts everything back.
  await page.locator('#eventsCount [data-evclear]').click();
  assert.equal(await page.locator('#whenBtn').textContent(), 'When ▾');
  assert.equal(new URL(page.url()).searchParams.has('on'), false);
  assert.equal(new URL(page.url()).searchParams.has('from'), false);
  assert.deepEqual(pageErrors, []);
});

test('site: What time on Sports: open play narrows to the window; leagues ignore it', async () => {
  const at = (id, start, end) => ({ ...SESSIONS[0], id, title: `Open gym ${id}`, date: TODAY, days: undefined, start, end });
  await open({ schedule: { ...SCHEDULE, sessions: [at('am', '09:00', '11:00'), at('pm', '17:00', '19:00'), at('late', '20:00', '22:00')] }, url: '/?view=openplay', clock: new Date('2026-10-25T12:00:00Z') });
  const btn = page.locator('#timeBtn');
  assert.equal(await btn.textContent(), 'Any time ▾');
  assert.equal(await rows().count(), 3);
  await btn.click();
  assert.equal(await page.locator('#whenSheetTitle').textContent(), 'What time?');
  assert.equal(await page.locator('#whenSheet [data-evday]').count(), 0, 'the day strip picks the day');
  await page.locator('#whenFrom').fill('14:00');
  await page.locator('#whenTo').fill('18:00');
  await page.locator('#whenTo').blur();
  assert.equal(await page.locator('#whenSheet .go-btn').textContent(), 'Show 1 session');
  await page.locator('#whenSheet .go-btn').click();
  assert.equal(await btn.textContent(), '2pm–6pm ▾');
  assert.deepEqual(await titles(), ['Open gym pm']);
  assert.equal(await rows().locator('.fit').textContent(), 'Runs past 6pm');
  assert.equal(new URL(page.url()).searchParams.get('from'), '14:00');
  await btn.click();
  await page.locator('#whenSheet [data-time="any"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await rows().count(), 3);
  assert.deepEqual(pageErrors, []);
});

test('site: Events links never name a sport', async () => {
  await open({ events: EVENTS, url: '/?view=events&sport=pickleball', waitFor: '#events .row' });
  assert.equal(new URL(page.url()).searchParams.has('sport'), false);
  assert.deepEqual(pageErrors, []);
});
