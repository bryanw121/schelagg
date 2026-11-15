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
  assert.equal(result.sessions.length, 13);
  assert.equal(new Set(result.sessions.map((s) => s.id)).size, 13);
  assert.ok(result.sessions.every((s) => s.date >= '2026-11-02' && s.date <= '2026-11-08' && !s.days));
  assert.equal(result.sessions.find((s) => s.venue.startsWith('Montopolis') && s.date === '2026-11-02').start, '18:00');
  assert.equal(result.sessions.find((s) => s.venue.startsWith('Dottie')).end, '19:00');
});

test('city pickleball: changed or removed venue is withheld without dropping healthy venues', () => {
  const changed = parse(html.replace('4 p.m. to 8 p.m.', '5 p.m. to 8 p.m.'), '2026-11-02', options);
  assert.equal(changed.sessions.length, 12);
  assert.ok(!changed.sessions.some((s) => s.venue.startsWith('Alamo')));
  assert.match(changed.warnings[0], /Alamo.*changed \(fingerprint [0-9a-f]{16}\).*withheld/);
  const removed = parse(html.replace('Northwest Recreation Center', 'Different Recreation Center'), '2026-11-02', options);
  assert.equal(removed.sessions.length, 11);
  assert.match(removed.warnings[0], /Northwest.*disappeared/);
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
  assert.equal(result.sessions.length, 13);
});

test('city pickleball: Dove Springs and Gus Garcia day-per-line schedules (Nov 4 review)', () => {
  const result = parse(html, '2026-11-02', options);
  const at = (venue) => result.sessions.filter((s) => s.venue === venue).map((s) => `${s.date} ${s.start}-${s.end}`);
  assert.deepEqual(at('George Morales Dove Springs Recreation Center'), ['2026-11-02 09:00-12:00', '2026-11-04 18:00-20:30', '2026-11-06 09:00-12:00']);
  assert.deepEqual(at('Gus Garcia Recreation Center'), ['2026-11-03 11:00-13:00', '2026-11-05 11:00-13:00', '2026-11-07 10:00-12:00', '2026-11-08 13:00-14:30']);
  assert.ok(result.sessions.filter((s) => /Dove|Gus/.test(s.venue)).every((s) => s.surface === 'indoor' && /Price not published/.test(s.price)));
  assert.deepEqual(slots('Open Play Schedule: Monday: 9 a.m. - 12 p.m. Wednesday: 6 p.m.- 8:30 p.m.'), [{ days: ['Mon'], start: '09:00', end: '12:00' }, { days: ['Wed'], start: '18:00', end: '20:30' }]);
  assert.deepEqual(slots('Open Play Sunday 1:00 p.m. to 2:30 p.m.'), [{ days: ['Sun'], start: '13:00', end: '14:30' }]);
  assert.throws(() => slots('Open Play is free for residents. Sunday 1:00 p.m. to 2:30 p.m.'), /review required/);
  assert.throws(() => slots('Varsity Generation only: Sunday 1:00 p.m. to 2:30 p.m.'), /No explicit/);
});
