import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, scrape, pageText, block } from '../scripts/adapters/official-schedule.mjs';
import { loadSources } from '../lib/registry.js';
import { sessionProblems } from '../lib/session.js';

// Both fixtures are rebuilt from text renderings of the official pages (see their header comments).
const georgetown = readFileSync(new URL('./fixtures/sources/georgetown-pickleball.html', import.meta.url), 'utf8');
const leander = readFileSync(new URL('./fixtures/sources/leander-pickleball.html', import.meta.url), 'utf8');
const sources = loadSources().sources;
const gt = sources.find((s) => s.id === 'georgetown-pickleball').options;
const ld = sources.find((s) => s.id === 'leander-pickleball').options;
const at = (sessions, venue) => sessions.filter((s) => s.venue === venue).map((s) => `${s.date} ${s.start}-${s.end}`);

test('Georgetown: reviewed Recreation Center and Tennis Center blocks become a dated week; McMaster is never imported', () => {
  const { sessions, warnings } = parse(georgetown, '2026-11-02', gt);
  assert.deepEqual(warnings, []);
  assert.deepEqual(at(sessions, 'Georgetown Recreation Center'), ['2026-11-03 08:00-12:00', '2026-11-04 18:00-20:45', '2026-11-05 08:00-12:00', '2026-11-08 12:00-15:00']);
  assert.deepEqual(at(sessions, 'Georgetown Tennis Center'), ['2026-11-02 18:00-20:00', '2026-11-03 18:00-20:00', '2026-11-04 18:00-20:00',
    '2026-11-05 18:00-20:00', '2026-11-06 18:00-20:00', '2026-11-07 18:00-20:00', '2026-11-08 14:30-17:30']);
  assert.ok(!sessions.some((s) => /McMaster/.test(s.venue)));
  const rec = sessions.find((s) => s.venue === 'Georgetown Recreation Center');
  assert.deepEqual([rec.city, rec.surface, rec.price, rec.source], ['Georgetown', 'indoor', '$6 day pass; included with membership', 'https://parks.georgetown.org/?p=18244']);
  assert.equal(sessions.find((s) => s.venue === 'Georgetown Tennis Center').price, '$6 drop-in (nonmember); free for members');
  assert.equal(new Set(sessions.map((s) => s.id)).size, sessions.length);
  for (const s of sessions) assert.deepEqual(sessionProblems({ ...s, region: 'austin', timezone: 'America/Chicago', sourceId: 'georgetown-pickleball' }).errors, []);
});

test('Leander: Monday/Wednesday evenings, door price, court type unlisted', () => {
  const { sessions, warnings } = parse(leander, '2026-11-02', ld);
  assert.deepEqual(warnings, []);
  assert.deepEqual(at(sessions, 'Leander Activity Center'), ['2026-11-02 17:00-21:00', '2026-11-04 17:00-21:00']);
  assert.deepEqual([sessions[0].city, sessions[0].surface, sessions[0].price], ['Leander', 'unspecified', '$4 / person; $2 Active Adult members (pay at the door)']);
});

test('official pages: a changed, missing or ambiguous block is withheld; other venues continue', () => {
  const changed = parse(georgetown.replace('Wednesday: 6-8:45 p.m.', 'Wednesday: 6-8 p.m.'), '2026-11-02', gt);
  assert.ok(!changed.sessions.some((s) => s.venue === 'Georgetown Recreation Center'));
  assert.ok(changed.sessions.some((s) => s.venue === 'Georgetown Tennis Center'));
  assert.match(changed.warnings[0], /Georgetown Recreation Center: source block changed \(fingerprint [0-9a-f]{16}\); withheld/);
  const price = parse(georgetown.replace('a $6 drop-in fee', 'a $8 drop-in fee'), '2026-11-02', gt);
  assert.match(price.warnings[0], /Tennis Center.*withheld/, 'prices are part of the reviewed block');
  const doubled = parse(georgetown.replace('</main>', '<p>400 Serenada Dr.</p></main>'), '2026-11-02', gt);
  assert.match(doubled.warnings[0], /Tennis Center: source block missing or ambiguous/);
  assert.throws(() => parse('<h1>Access denied</h1>', '2026-11-02', gt), /No reviewed venue block/);
  assert.throws(() => parse(leander.replace('Please Note', 'Note'), '2026-11-02', ld), /No reviewed venue block/);
});

test('official pages: contact details are not part of the fingerprint', () => {
  const text = pageText('<p>From here. Call 512-555-0100 or write a.person@example.gov today.</p><p>Stop</p>');
  assert.equal(block(text, 'From here', 'Stop'), 'From here. Call or write today.');
  const withContact = georgetown.replace('8 a.m. – noon', '8 a.m. – noon 512-555-0100 rec.desk@example.gov');
  assert.deepEqual(parse(withContact, '2026-11-02', gt).warnings, []);
});

test('official pages: holiday holds, review deadline and failed fetch never renew sessions', async () => {
  assert.ok(!parse(leander, '2026-11-09', ld).sessions.some((s) => s.date === '2026-11-11'));
  assert.ok(!parse(georgetown, '2026-11-23', gt).sessions.some((s) => ['2026-11-26', '2026-11-27'].includes(s.date)));
  const due = parse(georgetown, '2026-11-29', gt);
  assert.ok(due.sessions.every((s) => s.date <= '2026-11-30'));
  assert.match(due.warnings[0], /review due by 2026-11-30/);
  const expired = parse(georgetown, '2026-12-01', gt);
  assert.deepEqual(expired.sessions, []);
  assert.match(expired.warnings[0], /review expired/);
  await assert.rejects(scrape({ ref: '2026-11-02', options: ld, fetch: async () => new Response('down', { status: 503 }) }), /HTTP 503/);
});

test('official pages: config is validated; bad slots never become sessions', () => {
  const bad = (slot) => ({ ...ld, venues: [{ ...ld.venues[0], slots: [slot] }] });
  assert.throws(() => parse(leander, '2026-11-02', bad({ days: ['Mon'], start: '21:00', end: '17:00' })), /invalid reviewed slot/);
  assert.throws(() => parse(leander, '2026-11-02', bad({ days: ['Monday'], start: '17:00', end: '21:00' })), /invalid reviewed slot/);
  assert.throws(() => parse(leander, '2026-11-02', { ...ld, venues: [{ ...ld.venues[0], surface: 'gym' }] }), /surface/);
  assert.throws(() => parse(leander, 'soon', ld), /review dates/);
});

test('official pages: one plain HTTP fetch of the configured page, no browser', async () => {
  const calls = [];
  const result = await scrape({ ref: '2026-11-02', options: gt, fetch: async (url) => { calls.push(String(url)); return new Response(georgetown); } });
  assert.deepEqual(calls, ['https://parks.georgetown.org/?p=18244']);
  assert.equal(result.sessions.length, 11);
});
