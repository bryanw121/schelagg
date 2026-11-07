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

async function open({ schedule = SCHEDULE, courts = COURTS, apiCourts = { status: 500, body: '{"error":"down"}' }, index = null, regions = {}, maps = null, url = '/', timezoneId = 'America/Los_Angeles', clock = CLOCK, geolocation = null } = {}) {
  context = await browser.newContext({ timezoneId, locale: 'en-US', ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {}) }); // viewer elsewhere: the page still shows Austin time
  page = await context.newPage();
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
    if (u.pathname === '/data/schedule.json') return schedule ? json(schedule) : json('{"error":"nope"}', 500);
    if (u.pathname === '/data/courts.json') return courts ? json(courts) : route.fulfill({ status: 404, body: 'Not found' });
    // Map view: maps.json says which regions have a map; the map file, fonts and icons aren't served
    // (pins and the place panel don't need them).
    if (u.pathname === '/maps/maps.json') return maps ? json(maps) : route.fulfill({ status: 404, body: 'Not found' });
    if (u.pathname.startsWith('/maps/')) return route.fulfill({ status: 404, body: 'Not found' });
    return route.continue(); // index.html, app.js, styles.css from server.js
  });
  await page.goto(`${origin}${url}`);
  await page.locator('#list .row, #list .error, #list .empty').first().waitFor({ state: 'attached' });
}

beforeEach(() => { apiCalls = []; });
afterEach(async () => { await context?.close(); context = null; });

const rows = () => page.locator('#list .row');
const titles = () => page.locator('#list .row .title').allTextContents();
const row = (title) => page.locator('#list .row', { has: page.locator('.title', { hasText: title }) });
const tab = (k) => page.locator(`#tabs [data-tab="${k}"]`);

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
  assert.deepEqual(await page.locator('#tabs .tab').allTextContents(), ['All levels2', 'Beginner2', 'Intermediate2', 'Advanced2']);
  assert.equal(await page.locator('#courtsCard').isHidden(), true);
  assert.equal(await page.locator('#cal .g-venue', { hasText: 'Treehouse' }).count(), 0);
  assert.match(await page.locator('#subscribe a').first().getAttribute('href'), /pickleball\.ics$/);
  assert.match(await page.locator('#sourceStatus').textContent(), /hand-checked/);
  const indoor = row('Indoor pickleball');
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
  await tab('beginner').click();
  assert.deepEqual(await titles(), ['Indoor pickleball', 'Outdoor pickleball']); // no level listed: shown under every level
  await page.reload();
  await row('Outdoor pickleball').waitFor();
  assert.equal(await tab('beginner').getAttribute('aria-pressed'), 'true');
  await page.locator('#days .day').nth(1).click();
  assert.match(await page.locator('#list .empty').textContent(), /No confirmed beginner open-play sessions/);
  assert.doesNotMatch(await page.locator('#list .empty').textContent(), /Rinks|Courts open to rent/);
  await page.locator('[data-sport="volleyball"]').click();
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
  await page.locator('[data-sport="volleyball"]').click();
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
  await tab('beginner').click(); // "level 2" is intermediate
  assert.equal(await rows().count(), 0);
  await tab('intermediate').click();
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
  assert.deepEqual(await page.locator('#tabs .tab').allTextContents(), ['All levels6', 'Beginner3', 'Intermediate3', 'Advanced3']);
  await tab('beginner').click();
  assert.deepEqual((await titles()).sort(), ['Beginner clinic', 'Level 1 open play', 'Open play for all']);
  await tab('intermediate').click();
  assert.deepEqual((await titles()).sort(), ['Level 3 open play', 'Open play', 'Open play for all']);
  await tab('advanced').click();
  assert.deepEqual((await titles()).sort(), ['Level 4 open play', 'Open play', 'Open play for all']);
  await page.locator('[data-view="booking"]').click();
  assert.equal(await page.locator('#tabs').isHidden(), true, 'levels are for open play only');
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

  // The "Now" marker sits between what's started and what's next.
  assert.equal(await page.locator('#list .now').textContent(), 'Now · 5pm');
  const order = await page.locator('#list > .row .title, #list > .now').allTextContents();
  assert.deepEqual(order.slice(1, 4), ['Afternoon Sand Open Play', 'Now · 5pm', 'Evening Indoor Open Gym']);

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

  await tab('sand').click();
  assert.equal(await tab('sand').getAttribute('aria-pressed'), 'true');
  assert.equal(await tab('all').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await titles(), ['Afternoon Sand Open Play', 'Sunday Sand Social']);
  assert.equal(await page.locator('#courtsTitle').textContent(), 'Free public courts · 1');

  await page.reload();
  await rows().first().waitFor();
  assert.equal(await tab('sand').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await titles(), ['Afternoon Sand Open Play', 'Sunday Sand Social']);

  await tab('indoor').click();
  assert.deepEqual(await titles(), ['Morning Adult Training', 'Evening Indoor Open Gym', 'Sunday Coed Net Volleyball']);
  assert.equal(await page.locator('#courtsCard').isHidden(), true); // no free indoor courts

  await tab('grass').click();
  assert.equal(await rows().count(), 0);
  assert.match(await page.locator('#list .empty').textContent(), /No confirmed grass sessions today\..*Grass has no scheduled play/);
});

test('site: the sport switcher shows each sport on its own, with its own filters, and is shareable', async () => {
  await open();
  const sport = (k) => page.locator(`#sports [data-sport="${k}"]`);
  assert.deepEqual(await page.locator('#sports .tab').allTextContents(), ['Volleyball', 'Ice skating']);
  assert.equal(await sport('volleyball').getAttribute('aria-pressed'), 'true');
  assert.ok(!(await titles()).includes('Public Skating')); // other sports stay out of the volleyball list
  await tab('sand').click();

  await sport('ice_skating').click();
  assert.equal(new URL(page.url()).searchParams.get('sport'), 'ice_skating');
  // No filter tabs for skating (almost all indoors); an outdoor rink says so on its session.
  assert.equal(await page.locator('#tabs').isHidden(), true);
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
  await rows().first().waitFor();
  assert.equal(await sport('ice_skating').getAttribute('aria-pressed'), 'true');
  await sport('volleyball').click();
  assert.equal(new URL(page.url()).searchParams.get('sport'), null);
  assert.equal(await page.locator('#tabs').isHidden(), false);
  assert.equal(await tab('all').getAttribute('aria-pressed'), 'true');
  await page.goto(`${origin}/?sport=ice_skating`);
  await rows().first().waitFor();
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
  assert.equal(await page.locator('#subscribe a[download]').getAttribute('href'), `${origin}/data/volleyball.ics`);

  await page.locator('#days [data-di="1"]').click();
  const moved = row('ACES Monday Open Play');
  assert.equal(await moved.locator('.moved').textContent(), 'Moved from 7:30pm');
  assert.equal(await moved.locator('a.also').textContent(), 'Also on Reclub ↗');
  assert.equal(await moved.locator('a.also').getAttribute('href'), `${SIGNUP}/reclub-dup`);

  await page.locator('#sports [data-sport="ice_skating"]').click();
  assert.deepEqual(await page.locator('#sourceList li b').allTextContents(), ['Example Ice Rink']);
  assert.match(await page.locator('#subscribe a').first().getAttribute('href'), /\/data\/ice_skating\.ics$/);
});

test('site: spots left and capacity come from the source and say so', async () => {
  await open();
  const cap = row('Evening Indoor Open Gym').locator('.cap');
  assert.equal(await cap.textContent(), '· 3 of 12 spots left');
  assert.equal(await cap.getAttribute('title'), 'from Volleyworld at the last check');
  assert.equal(await row('Morning Adult Training').locator('.cap').count(), 0); // no data: nothing guessed
  await page.locator('#sports [data-sport="ice_skating"]').click();
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
  await page.locator('#cal .g-axis').first().waitFor();
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
  assert.deepEqual(await page.locator('#sports .tab').allTextContents(), ['Ice skating']);
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
    { id: 'gym', name: 'North Gym', city: 'Austin', lat: 30.4, lng: -97.7, bookingLink: { sport: 'volleyball', url: 'https://club.podplay.app/book/main', price: '$30/hr' } },
    { id: 'beach', name: 'ATX Beach', city: 'Austin', lat: 30.3, lng: -97.75 },
    { id: 'nowhere', name: 'Unmapped Hall', city: 'Austin' },
    { id: 'park', name: 'Morning Park', city: 'Austin', lat: 30.25, lng: -97.8 },
  ];
  const at = (id, venueId, venue, start, end) => ({ ...base, id, sourceId: 'manual', date: TODAY, start, end, title: `Session ${id}`, venueId, venue, city: 'Austin', surface: 'indoor', type: 'Open play', signup: { url: `${SIGNUP}/${id}` }, source: `${SIGNUP}/${id}` });
  sched.sessions = [at('g0', 'gym', 'North Gym', '09:00', '11:00'), at('g1', 'gym', 'North Gym', '18:00', '20:00'), at('g2', 'gym', 'North Gym', '20:00', '22:00'), at('b1', 'beach', 'ATX Beach', '18:30', '20:00'), at('u1', 'nowhere', 'Unmapped Hall', '19:00', '21:00'), at('p1', 'park', 'Morning Park', '08:00', '09:00')];
  await open({ index: INDEX, regions: { austin: sched }, maps: MAPS });
  const layout = page.locator('#layout');
  assert.equal(await layout.isVisible(), true);
  await layout.locator('[data-layout="map"]').click();
  assert.equal(new URL(page.url()).searchParams.get('layout'), 'map');
  assert.equal(await page.locator('#mapCard').isVisible(), true);
  assert.equal(await page.locator('#glance').isHidden(), true);
  assert.equal(await page.locator('#sessionsPanel').isHidden(), true);
  const pins = page.locator('#map .pin');
  await pins.first().waitFor();
  assert.deepEqual((await pins.evaluateAll((els) => els.map((e) => [e.dataset.pin, e.textContent, e.getAttribute('aria-label')]))).sort(), [
    ['beach', '6:30p', 'ATX Beach: 1 session, next at 6:30pm'],
    ['gym', '6p +1', 'North Gym: 2 sessions still to come, next at 6pm'], // its 9am session has ended (it's 5pm)
    ['park', 'Ended', "Morning Park: today's sessions have ended"],
  ]);
  assert.equal(await page.locator('#map .pin[data-pin="park"]').evaluate((e) => e.classList.contains('done')), true);
  assert.match(await page.locator('#mapPanel').textContent(), /3 places with volleyball on Oct 25 · tap a pin · 1 more without a location are in the list/);
  // Tap a pin: that place's day, with each sign-up and the venue's Book (opened on this day).
  await page.locator('#map .pin[data-pin="gym"]').click();
  const panel = page.locator('#mapPanel');
  assert.match(await panel.locator('.g-venue').textContent(), /North Gym.*Austin · \$30\/hr/);
  assert.equal(await panel.locator('a.v-book, a.signup', { hasText: 'Book' }).first().getAttribute('href'), `https://club.podplay.app/book/main/${TODAY}`);
  assert.deepEqual(await panel.locator('.pop-item a.signup').evaluateAll((els) => els.map((e) => e.getAttribute('href'))), [`${SIGNUP}/g0`, `${SIGNUP}/g1`, `${SIGNUP}/g2`]);
  assert.deepEqual(await panel.locator('.pop-item').evaluateAll((els) => els.map((e) => e.classList.contains('past'))), [true, false, false], 'the ended session is dimmed');
  assert.equal(await page.locator('#map .pin[data-pin="gym"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#map .pin[data-pin="gym"]').click(); // tap again: back to the summary
  assert.match(await panel.textContent(), /tap a pin/);
  // Court booking: pins are the places to book, labelled with the price.
  await page.locator('[data-view="booking"]').click();
  await page.locator('#map .pin.book').first().waitFor();
  assert.deepEqual(await page.locator('#map .pin').evaluateAll((els) => els.map((e) => e.textContent)), ['$30/hr']);
  // The view is shareable and remembered; List brings the day's chart and lists back.
  await page.reload();
  await page.locator('#map .pin').first().waitFor();
  assert.equal(await page.locator('#mapCard').isVisible(), true);
  await page.locator('[data-layout="list"]').click();
  assert.equal(await page.locator('#mapCard').isHidden(), true);
  assert.equal(new URL(page.url()).searchParams.get('layout'), null);
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
  await rows().first().waitFor();
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
  await tab('indoor').click();
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
  assert.equal(await group.locator('small').textContent(), 'Austin · free 7am–11pm');
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
  await tab('advanced').click();
  await page.locator('[data-view="booking"]').click();
  assert.equal(await page.locator('#cal .g-venue', { hasText: 'Holy Courts' }).count(), 1);
  await page.locator('[data-sport="volleyball"]').click();
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
  await page.locator('[data-sport="ice_skating"]').click();
  assert.equal(await page.locator('#calendarModes').isHidden(),true);
  assert.equal(await page.locator('#sessionsPanel').isVisible(),true);
});
