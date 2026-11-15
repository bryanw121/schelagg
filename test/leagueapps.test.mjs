// LeagueApps event series (Volleyball Austin's open plays), from trimmed pages (Nov 14, 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { childLinks, parseEvent, scrape } from '../scripts/adapters/leagueapps.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/sources/${f}`, import.meta.url), 'utf8');
const SERIES = 'https://volleyballaustin.leagueapps.com/events/1647613-open-plays';
const OPTS = { url: SERIES, title: 'Volleyball Austin Open Play', host: 'Volleyball Austin', city: 'Austin' };

test('the series page links one event per date, not itself', () => {
  const links = childLinks(fx('leagueapps-series.html'), SERIES);
  assert.equal(links.length, 8);
  assert.ok(links.every((u) => u.startsWith('https://volleyballaustin.leagueapps.com/events/') && !u.includes('1647613')));
  assert.ok(links.some((u) => /4-hour-open-play/.test(u)));
});

test('an event page: date, 7–9pm, $12 + fee, Austin Sports Center', () => {
  const url = 'https://volleyballaustin.leagueapps.com/events/5185722-nov.-15-2026-sunday';
  const s = parseEvent(fx('leagueapps-event.html'), url, OPTS);
  assert.deepEqual([s.id, s.date, s.start, s.end, s.price, s.venue, s.type, s.surface], ['leagueapps-5185722', '2026-11-15', '19:00', '21:00', '$12 + fee', 'Austin Sports Center - Central', 'Open play', 'indoor']);
  assert.equal(s.title, 'Volleyball Austin Open Play');
  assert.equal(s.signup.url, url);
  assert.equal(parseEvent('<p>Coming soon</p>', url, OPTS), null);
});

test('scrape: each listed date; past ones and broken pages left out', async () => {
  const event = fx('leagueapps-event.html');
  const fetch = async (u) => {
    if (u === SERIES) return new Response(fx('leagueapps-series.html'));
    if (/5185722/.test(u)) return new Response(event);
    if (/5185727/.test(u)) return new Response(event.replace(/Nov&nbsp;15&nbsp;/g, 'Nov&nbsp;22&nbsp;').replace(/Nov 15/g, 'Nov 22'));
    return new Response('nope', { status: 404 });
  };
  const r = await scrape({ options: { series: [OPTS] }, fetch, ref: '2026-11-16' });
  assert.deepEqual(r.sessions.map((s) => s.date), ['2026-11-22']);
  assert.ok(r.warnings.length >= 6);
  await assert.rejects(scrape({ options: { series: [{ url: 'https://x.leagueapps.com/events/1-x' }] }, fetch: async () => new Response('', { status: 500 }) }));
});
