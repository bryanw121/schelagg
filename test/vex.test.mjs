// Vex Volleyball's league and tournaments, from trimmed copies of its pages (Nov 13, 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventDate, parseVexPage, read, sitePages, ORIGIN } from '../lib/programs/vex.js';

const page = (f) => readFileSync(new URL(`./fixtures/programs/vex/${f}.html`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-14T03:00:00Z'); // Nov 13, 9pm in Austin

test('dates as Vex writes them', () => {
  assert.equal(eventDate('12/5/2026'), '2026-12-05');
  assert.equal(eventDate('September 12th, 2026'), '2026-09-12');
  assert.equal(eventDate('July 11th, 2026'), '2026-07-11');
  assert.equal(eventDate('Registered Teams'), null);
  assert.equal(eventDate('13/40/2026'), null);
});

test('the menu gives the event pages, not cart, FAQs or open gyms', () => {
  const pages = sitePages(page('tournaments-2'));
  assert.ok(pages.includes(`${ORIGIN}/league`) && pages.includes(`${ORIGIN}/6-feet-and-under`));
  assert.ok(!pages.some((u) => /cart|faqs|open-gyms|events$/.test(u)));
});

test('the December tournament: date, early-bird fee until Nov 14, Google Form sign-up', () => {
  const p = parseVexPage(page('6-feet-and-under'), { url: `${ORIGIN}/6-feet-and-under`, now: NOW });
  assert.equal(p.kind, 'tournament');
  assert.equal(p.title, 'Vex · Dec. 6-Foot and Under Tourney');
  assert.equal(p.starts_on, '2026-12-05');
  assert.equal(p.team_price, '$360');
  assert.equal(p.price_note, 'Early bird; regular $420');
  assert.equal(p.price_changes_on, '2026-11-14');
  assert.equal(p.region, 'austin');
  assert.match(p.signup_url, /^https:\/\/docs\.google\.com\/forms\//);
  // After the early bird ends: the regular fee.
  const later = parseVexPage(page('6-feet-and-under'), { url: 'u', now: Date.parse('2026-11-20T18:00:00Z') });
  assert.equal(later.team_price, '$420');
  assert.equal(later.price_note, null);
});

test('the 2027 Winter League: Sundays, Jan 24 to the Mar 7 playoffs, $480 early / $600', () => {
  const p = parseVexPage(page('league'), { url: `${ORIGIN}/league`, now: NOW });
  assert.equal(p.kind, 'league');
  assert.equal(p.title, 'Vex 2027 Winter League');
  assert.equal(p.starts_on, '2027-01-24');
  assert.equal(p.ends_on, '2027-03-07');
  assert.deepEqual(p.weekdays, ['Sunday']);
  assert.equal(p.team_price, '$480');
  assert.equal(p.price_note, 'Early bird; regular $600');
  assert.equal(p.signup_url, 'https://forms.gle/6mPzfASej54AiLQ29');
});

test('past tournaments and pages that are not events are left out', () => {
  for (const f of ['qilin', 'koi', '6-feet-and-under-1', 'tournaments-2']) assert.equal(parseVexPage(page(f), { url: f, now: NOW }), null, f);
  assert.equal(parseVexPage('<main><h1>FAQs</h1></main>', { now: NOW }), null);
});

test('read: the menu, then each page; no team lists or names in what we publish', async () => {
  const files = { '/': 'tournaments-2', '/league': 'league', '/6-feet-and-under': '6-feet-and-under', '/6-feet-and-under-1': '6-feet-and-under-1', '/qilin': 'qilin', '/koi': 'koi', '/tournaments-2': 'tournaments-2', '/tournaments': 'tournaments-2', '/dragon': 'koi' };
  const get = async (u) => { const f = files[new URL(u).pathname]; return f ? { ok: true, status: 200, text: page(f) } : { ok: false, status: 404, text: '' }; };
  const out = await read({ get, now: NOW, regions: [{ id: 'austin' }] });
  assert.deepEqual(out.map((p) => p.kind).sort(), ['league', 'tournament']);
  assert.ok(!JSON.stringify(out).match(/Registered Teams|Free Agent/i));
  await assert.rejects(read({ get: async () => ({ ok: false, status: 503 }), now: NOW, regions: [] }));
});
