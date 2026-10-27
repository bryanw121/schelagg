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
  { ...base, id: 'vw-evening', sourceId: 'volleyworld', date: TODAY, start: '18:00', end: '20:00', title: 'Evening Indoor Open Gym', venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville', surface: 'indoor', type: 'Open play', level: 'Adults', signup: { url: `${SIGNUP}/evening`, label: 'Book on Volleyworld' }, source: `${SIGNUP}/evening` },
  { ...base, id: 'reclub-TREE01', sourceId: 'reclub', date: TODAY, start: '19:00', end: '22:00', title: 'Sunday Coed Net Volleyball', venue: 'Roots · Treehouse Gym', city: 'N. Austin', surface: 'indoor', type: 'Open play', facility: 'treehouse', checkFailed: TODAY, signup: { url: `${SIGNUP}/reclub`, label: 'Sign up on Reclub' }, source: `${SIGNUP}/reclub` },
  { ...base, id: 'manual-sand-sun', sourceId: 'manual', days: ['Sun'], start: '19:00', end: '22:00', title: 'Sunday Sand Social', venue: 'ATX Beach', city: 'North Austin', surface: 'sand', type: 'Open play', verifiedAt: '2026-10-20', sourceChanged: TODAY, signup: { url: `${SIGNUP}/social`, label: 'RSVP' }, source: `${SIGNUP}/social` },
  { ...base, id: 'manual-league', sourceId: 'manual', days: ['Sun'], start: null, end: null, title: 'Sunday Indoor League', venue: 'Volleyworld (Pflugerville)', city: 'Pflugerville', surface: 'indoor', type: 'League', source: `${SIGNUP}/league` },
  { ...base, sport: 'ice_skating', id: 'rink-public', sourceId: 'rink', date: TODAY, start: '14:00', end: '16:00', title: 'Public Skating', venue: 'Example Ice Rink', city: 'Cedar Park', surface: 'indoor', type: 'Public skate', rink: 'Silver Rink', price: '$14 · skates $6', signup: { url: `${SIGNUP}/rink`, label: 'Public skating info' }, source: `${SIGNUP}/rink` },
  { ...base, sport: 'ice_skating', id: 'rink-adult', sourceId: 'rink', date: TODAY, start: '19:30', end: '21:00', title: 'Adult Skate', venue: 'Example Ice Rink', city: 'Cedar Park', surface: 'indoor', type: 'Adult skate', rink: 'Gold Rink', signup: { url: `${SIGNUP}/rink-adult`, label: 'Rink calendar' }, source: `${SIGNUP}/rink-adult` },
  { ...base, sport: 'ice_skating', id: 'pop-up', sourceId: 'manual', days: ['Sun'], start: '18:00', end: '21:00', title: 'Holiday Rink', venue: 'Example Plaza Rink', city: 'Downtown', surface: 'outdoor', type: 'Public skate', signup: { url: `${SIGNUP}/pop-up`, label: 'Timed tickets' }, source: `${SIGNUP}/pop-up` },
  { ...base, id: 'vw-monday', sourceId: 'volleyworld', date: TOMORROW, start: '19:30', end: '21:00', title: 'Monday Night Training', venue: 'Volleyworld (Georgetown)', city: 'Georgetown', surface: 'indoor', type: 'Training', signup: { url: `${SIGNUP}/monday`, label: 'Book on Volleyworld' }, source: `${SIGNUP}/monday` },
];
const SCHEDULE = {
  schemaVersion: 2,
  generatedAt: '2026-10-25T21:13:00.000Z',
  sources: [
    { id: 'volleyworld', sport: 'volleyball', region: 'austin', ok: true, count: 4 },
    { id: 'reclub', sport: 'volleyball', region: 'austin', ok: false, error: 'HTTP 503', kept: 1 },
    { id: 'rink', sport: 'ice_skating', region: 'austin', ok: true, count: 2 },
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
    id: 'treehouse', calendar: 'https://treehousegym.skedda.com/booking', calendarDay: 'https://treehousegym.skedda.com/booking?viewdate={date}', hours: Array(7).fill(['06:00', '23:00']),
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** A fresh page (own localStorage) with data answered by `data` and the clock fixed. */
async function open({ schedule = SCHEDULE, courts = COURTS, apiCourts = { status: 500, body: '{"error":"down"}' } } = {}) {
  context = await browser.newContext({ timezoneId: 'America/Los_Angeles', locale: 'en-US' }); // viewer elsewhere: the page still shows Austin time
  page = await context.newPage();
  await page.clock.setFixedTime(CLOCK);
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
    if (u.pathname === '/data/schedule.json') return schedule ? json(schedule) : json('{"error":"nope"}', 500);
    if (u.pathname === '/data/courts.json') return courts ? json(courts) : route.fulfill({ status: 404, body: 'Not found' });
    return route.continue(); // index.html, app.js, styles.css from server.js
  });
  await page.goto(`${origin}/`);
  await page.locator('#list .row, #list .error, #list .empty').first().waitFor();
}

beforeEach(() => { apiCalls = []; });
afterEach(async () => { await context?.close(); context = null; });

const rows = () => page.locator('#list .row');
const titles = () => page.locator('#list .row .title').allTextContents();
const row = (title) => page.locator('#list .row', { has: page.locator('.title', { hasText: title }) });
const tab = (surf) => page.locator(`#tabs [data-surf="${surf}"]`);

// --- tests --------------------------------------------------------------------------------

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
  assert.match(await page.locator('#list .empty').textContent(), /No confirmed grass sessions today\..*Grass has no scheduled play in Austin/);
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
  assert.deepEqual(await page.locator('#tabs .tab').allTextContents(), ['All3', 'Indoor2', 'Outdoor1']); // surface resets to All
  assert.equal(await tab('all').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await titles(), ['Public Skating', 'Holiday Rink', 'Adult Skate']);
  assert.match(await row('Public Skating').locator('.meta').textContent(), /Indoor.*Public skate.*Silver Rink.*\$14/);
  // Volleyball-only parts are hidden: court calendars, their key and note, and the free courts.
  assert.equal(await page.locator('#glance .key').isHidden(), true);
  assert.equal(await page.locator('#calNote').isHidden(), true);
  assert.equal(await page.locator('#courtsCard').isHidden(), true);
  assert.equal(await page.locator('#cal .g-group').first().textContent(), 'Public skatetap a bar for details');
  assert.equal(await page.locator('#cal .g-group').count(), 1);
  assert.equal(await page.locator('#sourceStatus').textContent(), 'Last check read all 1 scraped ice skating source.');
  assert.match(await page.locator('#footer').textContent(), /DaySmart/);

  await tab('outdoor').click();
  assert.deepEqual(await titles(), ['Holiday Rink']);

  // Remembered on reload; a shared link opens that sport even for a viewer who last chose another.
  await page.reload();
  await rows().first().waitFor();
  assert.equal(await sport('ice_skating').getAttribute('aria-pressed'), 'true');
  await sport('volleyball').click();
  assert.equal(new URL(page.url()).searchParams.get('sport'), null);
  assert.equal(await tab('all').getAttribute('aria-pressed'), 'true');
  await page.goto(`${origin}/?sport=ice_skating`);
  await rows().first().waitFor();
  assert.deepEqual(await titles(), ['Public Skating', 'Holiday Rink', 'Adult Skate']);
});

test('site: the day picker switches to other days of the week', async () => {
  await open();
  const days = page.locator('#days .day');
  assert.equal(await days.count(), 7);
  assert.deepEqual(await page.locator('#days .day .dn').allTextContents(), ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.equal(await days.nth(1).getAttribute('aria-label'), 'Monday 26, 1 sessions');

  await days.nth(1).click();
  assert.equal(await days.nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#dayTitle').textContent(), 'Tomorrow · Monday, Oct 26');
  assert.deepEqual(await titles(), ['Monday Night Training']);
  assert.equal(await page.locator('#list .now').count(), 0, 'no "Now" marker on other days');
  assert.match(await page.locator('#calTitle').textContent(), /Day at a glance · Mon, Oct 26/);

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
  const bars = page.locator('#cal a.g-bar');
  assert.deepEqual(await bars.allTextContents(), ['9am–11am', '4pm–6pm', '6pm–8pm', '7pm–10pm', '7pm–10pm']);
  assert.equal(await bars.nth(2).getAttribute('href'), `${SIGNUP}/evening`);

  const group = page.locator('#cal .g-group', { hasText: 'Roots · Treehouse Gym' });
  const text = await group.textContent();
  assert.match(text, /open 6am, closes 11pm/);
  assert.match(text, /courts free 6am–11pm/); // Court #2 is free whenever Court #1 isn't, and vice versa
  assert.match(text, /Sunday Coed Net Volleyball 7pm–10pm ↗/);
  // The booking that lines up with the Reclub meet links to its sign-up; the other is just booked.
  const open_ = page.locator('#cal a.g-book.open');
  assert.equal(await open_.count(), 1);
  assert.equal(await open_.getAttribute('href'), `${SIGNUP}/reclub`);
  assert.equal(await page.locator('#cal div.g-book').getAttribute('title'), 'Booked 8am–10am');
  assert.equal(await page.locator('#cal .g-now').count() > 0, true);
  assert.match(await page.locator('#calNote').textContent(), /Court calendars checked 5 min ago/);
  assert.equal(await page.locator('#calErrors').textContent(), '');
});

test('site: "Book a court" opens the venue calendar on the day being viewed', async () => {
  await open();
  const book = () => page.locator('#cal .g-group', { hasText: 'Roots · Treehouse Gym' }).locator('a.book', { hasText: 'Book a court' })
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
  await open({ courts: { ...COURTS, venues: [venue] } });
  const book = page.locator('#cal .g-group', { hasText: 'Roots · Treehouse Gym' }).locator('a.book', { hasText: 'Book a court' });
  assert.equal(await book.getAttribute('href'), 'https://treehousegym.skedda.com/booking');
});

test('site: court data falls back to /api/courts, and failures say so', async () => {
  // No pre-built courts.json: the page asks the live API.
  await open({ courts: null, apiCourts: { status: 200, body: { ...COURTS, errors: [{ venue: 'velocity', calendar: 'https://austinvelocity.skedda.com/booking', message: 'HTTP 503' }] } } });
  await page.locator('#cal a.g-book.open').waitFor();
  assert.deepEqual(apiCalls, ['/api/courts?days=7']);
  assert.match(await page.locator('#calErrors').textContent(), /Couldn't load some court calendars right now · open velocity calendar ↗/);
  await context.close();

  // Neither: an error, and the schedule still shows.
  await open({ courts: null });
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
