// The deployed site's Map view, end to end, with the real map files (no mocks): for every region
// in data/index.json, the map exists (maps/maps.json lists it), its .pmtiles file answers range
// requests, the map draws (a WebGL canvas, the style and tiles loaded), nothing throws, and where
// the region has sessions at venues with coordinates, some day this week shows pins.
//
// Runs after each deploy (pages.yml, "Check the live map") against the published site, and on
// demand: SITE_URL=https://bryanw121.github.io/schelagg/ npm run test:live-map
// The site e2e (site.e2e.mjs) covers behavior with mocked data; this covers what only the real
// deployment can break: map builds, missing regions, file paths, and today's data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const SITE = (process.env.SITE_URL || 'https://bryanw121.github.io/schelagg/').replace(/\/?$/, '/');
let browser, index, maps;

const getJson = async (path) => {
  const res = await fetch(new URL(path, SITE), { headers: { 'cache-control': 'no-cache' } });
  assert.equal(res.ok, true, `${path}: HTTP ${res.status}`);
  return res.json();
};

before(async () => {
  index = await getJson('data/index.json');
  maps = await getJson('maps/maps.json');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
});
after(async () => { await browser?.close(); });

test('live: every region on the site has a map', () => {
  const mapped = new Set((maps.maps ?? []).map((m) => m.region));
  const missing = index.regions.map((r) => r.id).filter((id) => !mapped.has(id));
  assert.deepEqual(missing, [], `regions without a map (the Map button is hidden for them): ${missing.join(', ')}`);
});

test('live: each region\'s map loads its tiles, draws, and pins this week\'s venues', async () => {
  for (const region of index.regions) {
    if (!(maps.maps ?? []).some((m) => m.region === region.id)) continue; // reported by the test above
    const schedule = await getJson(`data/regions/${region.id}/schedule.json`);
    const placed = new Set((schedule.venues ?? []).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng)).map((v) => v.id));
    const pinnable = (schedule.sessions ?? []).filter((s) => placed.has(s.venueId)).length;

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: region.timezone });
    const page = await context.newPage();
    const errors = [], tileStatus = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (/\.pmtiles(\?|$)/.test(r.url())) tileStatus.push(r.status()); });
    await page.goto(new URL(`?region=${region.id}&layout=map`, SITE).href, { waitUntil: 'domcontentloaded' });
    await page.locator('#map .maplibregl-canvas').waitFor({ timeout: 30000 });
    // The map is drawn once its style and the tiles in view have loaded.
    await page.waitForFunction(() => document.querySelector('#map .maplibregl-canvas') && !document.querySelector('#mapPanel .note'), null, { timeout: 30000 });
    await page.waitForTimeout(3000);
    assert.ok(tileStatus.length > 0, `${region.id}: the map never requested its .pmtiles file`);
    assert.ok(tileStatus.every((s) => s === 200 || s === 206), `${region.id}: .pmtiles answered ${[...new Set(tileStatus)].join(', ')}`);

    let mostPins = 0;
    for (let di = 0; di < 7; di++) {
      await page.locator(`#days [data-di="${di}"]`).click();
      await page.waitForTimeout(600);
      mostPins = Math.max(mostPins, await page.locator('#map .pin').count());
    }
    if (pinnable > 0) assert.ok(mostPins > 0, `${region.id}: ${pinnable} sessions are at venues with coordinates, but no day this week shows a pin`);
    assert.deepEqual(errors, [], `${region.id}: script errors`);
    console.log(`${region.id}: tiles ${[...new Set(tileStatus)].join('/')}, up to ${mostPins} pins a day, ${pinnable} pinnable sessions`);
    await context.close();
  }
});
