import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, slots, scrape, SOURCE } from '../scripts/adapters/austin-pickleball.mjs';
import { loadSources } from '../lib/registry.js';

const html = readFileSync(new URL('./fixtures/sources/austin-pickleball.html', import.meta.url), 'utf8');
const { options } = loadSources().sources.find((s) => s.id === 'austin-city-pickleball');

test('city pickleball: only reviewed program blocks become seven days of dated sessions', () => {
  const result = parse(html, '2026-11-02', options);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sessions.length, 6);
  assert.equal(new Set(result.sessions.map((s) => s.id)).size, 6);
  assert.ok(result.sessions.every((s) => s.date >= '2026-11-02' && s.date <= '2026-11-08' && !s.days));
  assert.equal(result.sessions.find((s) => s.venue.startsWith('Montopolis') && s.date === '2026-11-02').start, '18:00');
  assert.equal(result.sessions.find((s) => s.venue.startsWith('Dottie')).end, '19:00');
});

test('city pickleball: changed or removed venue is withheld without dropping healthy venues', () => {
  const changed = parse(html.replace('4 p.m. to 8 p.m.', '5 p.m. to 8 p.m.'), '2026-11-02', options);
  assert.equal(changed.sessions.length, 5);
  assert.ok(!changed.sessions.some((s) => s.venue.startsWith('Alamo')));
  assert.match(changed.warnings[0], /Alamo.*withheld/);
  const removed = parse(html.replace('Northwest Recreation Center', 'Different Recreation Center'), '2026-11-02', options);
  assert.equal(removed.sessions.length, 4);
  assert.match(removed.warnings[0], /Northwest/);
});

test('city pickleball: holiday holds, review deadline and failed fetch never renew sessions', async () => {
  assert.ok(!parse(html, '2026-11-09', options).sessions.some((s) => s.date === '2026-11-11'));
  assert.ok(!parse(html, '2026-11-23', options).sessions.some((s) => ['2026-11-26', '2026-11-27'].includes(s.date)));
  assert.ok(parse(html, '2026-11-29', options).sessions.every((s) => s.date <= '2026-11-30'));
  const expired = parse(html, '2026-12-01', options);
  assert.deepEqual(expired.sessions, []);
  assert.match(expired.warnings[0], /review expired/);
  await assert.rejects(scrape({ ref: '2026-11-02', options, fetch: async () => new Response('down', { status: 503 }) }), /HTTP 503/);
});

test('city pickleball: strict grammar rejects restrictions and ambiguous clocks instead of making events', () => {
  assert.deepEqual(slots('Open Play: Monday and Wednesday, 10:30 a.m. to 1:30 p.m.'), [{ days: ['Mon', 'Wed'], start: '10:30', end: '13:30' }]);
  assert.throws(() => slots('Open Play: Thursday 4 p.m. to 8 p.m. except holidays'), /review required/);
  assert.throws(() => slots('Open Play: Thursday 13 p.m. to 8 p.m.'), /clock/);
  assert.throws(() => slots('Open Play: Thursday 8 p.m. to 4 p.m.'), /range/);
  assert.throws(() => slots('Open Play: Thursday 4 to 8 p.m.'), /review required/);
  assert.throws(() => parse('<h1>Access denied</h1>', '2026-11-02', options), /section not found/);
});

test('city pickleball: one plain HTTP fetch, no browser or login', async () => {
  const calls = [];
  const result = await scrape({ ref: '2026-11-02', options, fetch: async (url) => { calls.push(url); return new Response(html); } });
  assert.deepEqual(calls, [SOURCE]);
  assert.equal(result.sessions.length, 6);
});
