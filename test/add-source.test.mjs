// "Add a source": what a typed name or link turns into, what the check decides, and what it writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPlan, checkSource, classify, knownSources, slugGuesses } from '../lib/add-source.js';
import { loadAddConfig } from '../lib/add-source-config.js';
import { resolveSources } from '../lib/registry.js';
import { createHandler } from '../api/add-source.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const config = loadAddConfig();
const NOW = new Date('2026-10-26T15:00:00Z');
/** A `get` that answers from a map of URL -> text (or { status }), and records what was asked. */
const web = (pages) => { const asked = []; const get = async (url) => { asked.push(url); const p = pages[url]; return p == null ? { ok: false, status: 404, text: '' } : typeof p === 'string' ? { ok: true, status: 200, text: p } : { ok: false, text: '', ...p }; }; get.asked = asked; return get; };
const run = (input, target, pages = {}, region = 'austin') => { const get = web(pages); return checkSource({ input, target, region }, { get, config, now: NOW }).then((r) => ({ ...r, asked: get.asked })); };
const eventPage = (events) => `<html><script type="application/ld+json">${JSON.stringify(events.map((e, i) => ({ '@type': 'Event', url: `https://market.example/e/${i}`, location: { '@type': 'Place', name: 'Somewhere', address: { addressLocality: 'Austin', addressRegion: 'TX' } }, ...e })))}</script></html>`;

test('classify / slugGuesses: links to the platforms, other links, Instagram, and names', () => {
  assert.deepEqual(classify('https://reclub.co/clubs/@vex_volleyball?x=1'), { kind: 'reclub', slug: 'vex_volleyball' });
  assert.deepEqual(classify('www.sweatpals.com/host/ATXBeach'), { kind: 'sweatpals', slug: 'ATXBeach' });
  assert.deepEqual(classify('https://www.meetup.com/austin-indoor-volleyball-meetup-group/events/'), { kind: 'meetup', slug: 'austin-indoor-volleyball-meetup-group' });
  assert.deepEqual(classify('@some.market'), { kind: 'instagram', slug: 'some.market' });
  assert.deepEqual(classify('https://instagram.com/some.market/'), { kind: 'instagram', slug: 'some.market' });
  assert.deepEqual(classify('http://example.org/events#top'), { kind: 'link', url: 'https://example.org/events' });
  assert.deepEqual(classify('example.org/events'), { kind: 'link', url: 'https://example.org/events' });
  assert.deepEqual(classify('  Volley Club ATX '), { kind: 'name', name: 'Volley Club ATX' });
  assert.deepEqual(classify('javascript:alert(1)'), { kind: 'name', name: 'javascript:alert(1)' });
  assert.deepEqual(slugGuesses('Volley Club ATX!'), ['volley-club-atx', 'volleyclubatx', 'volley_club_atx']);
  assert.deepEqual(slugGuesses('!!!'), []);
});

test('checkSource: what is already read says so without asking anything', async () => {
  const k = knownSources(config);
  assert.ok(k.reclub.has('vex_volleyball') && k.sweatpals.has('atxbeach') && k.meetup.has('austin-indoor-volleyball-meetup-group'));
  for (const input of ['https://reclub.co/clubs/@VEX_volleyball', 'sweatpals.com/host/atxbeach', 'Volleyworld', 'https://allevents.in/austin/markets/']) {
    const r = await run(input, input.includes('allevents') ? 'events' : 'volleyball');
    assert.equal(r.status, 'have', input);
    assert.deepEqual(r.asked, [], input);
  }
});

test('checkSource: a Reclub club with volleyball in the area is found, by link or by name', async () => {
  const pages = { 'https://reclub.co/clubs/@new-club': fixture('reclub-club-austin-lawn-club.html'), 'https://reclub.co/m/5X380N': fixture('reclub-meet-5X380N.html') };
  const byLink = await run('https://reclub.co/clubs/@new-club', 'volleyball', pages);
  assert.equal(byLink.status, 'ok');
  assert.equal(byLink.title, 'Added. Found 1 meet coming up.');
  assert.deepEqual(byLink.plan, { type: 'reclub', region: 'austin', sport: 'volleyball', slug: 'new-club' });
  const byName = await run('New Club', 'volleyball', pages);
  assert.deepEqual(byName.plan, byLink.plan);
  // The same club asked for pickleball, or from Houston, is not that.
  assert.match((await run('https://reclub.co/clubs/@new-club', 'pickleball', pages)).detail, /aren't pickleball around Austin \(sport is volleyball\)/);
  const far = await run('https://reclub.co/clubs/@new-club', 'volleyball', pages, 'houston');
  assert.equal(far.status, 'no');
  assert.match(far.detail, /around Houston/);
  // A link that opens nothing.
  assert.match((await run('https://reclub.co/clubs/@nobody', 'volleyball')).detail, /Couldn't open that Reclub page \(it answered 404\)/);
});

test('checkSource: Meetup by its calendar; a name nothing answers to asks for a link', async () => {
  const pages = { 'https://www.meetup.com/dfw-volleyball/events/ical/': fixture('meetup-sample.ics') };
  const r = await checkSource({ input: 'meetup.com/dfw-volleyball', target: 'volleyball', region: 'dallas' }, { get: web(pages), config, now: new Date('2026-01-01T12:00:00Z') });
  assert.equal(r.status, 'ok');
  assert.equal(r.plan.type, 'meetup');
  assert.equal(r.plan.slug, 'dfw-volleyball');
  const none = await run('Some Gym Nobody Lists', 'volleyball');
  assert.equal(none.status, 'no');
  assert.equal(none.needsLink, true);
  assert.match(none.detail, /Paste a link to its schedule/);
  assert.equal(none.asked.length, 9, 'three spellings on three platforms, and no more');
  assert.match((await run('@some.market', 'events')).detail, /Instagram accounts can't be read automatically/);
  assert.equal((await run('Some Market', 'events')).needsLink, true);
});

test('checkSource: an events page is read only if robots.txt allows, and kept only if the reader keeps something', async () => {
  const url = 'https://market.example/events';
  const good = eventPage([{ name: 'Holiday Night Market', startDate: '2026-12-05T17:00:00-06:00' }, { name: 'Board meeting', startDate: '2026-12-06' }]);
  const ok = await run(url, 'events', { 'https://market.example/robots.txt': 'User-agent: *\nDisallow: /admin', [url]: good });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.title, 'Added. Found 1 event coming up.');
  assert.deepEqual(ok.plan, { type: 'events', region: 'austin', url });
  assert.deepEqual(ok.sample, ['Holiday Night Market']);
  const closed = await run(url, 'events', { 'https://market.example/robots.txt': 'User-agent: *\nDisallow: /', [url]: good });
  assert.match(closed.detail, /asks not to be read automatically/);
  assert.deepEqual(closed.asked, ['https://market.example/robots.txt'], 'the page itself is never asked for');
  const noRobots = await run(url, 'events', { [url]: good });
  assert.equal(noRobots.status, 'ok', 'no robots.txt (404) closes nothing');
  assert.match((await run(url, 'events', { 'https://market.example/robots.txt': { status: 503 }, [url]: good })).detail, /Couldn't reach market\.example/);
  assert.match((await run(url, 'events', { [url]: eventPage([{ name: 'Board meeting', startDate: '2026-12-06' }]) })).detail, /lists 1 event, but none are upcoming pop-ups/);
  const bare = await run(url, 'events', { [url]: '<html><p>Markets every Sunday</p></html>' });
  assert.match(bare.detail, /aren't written in a form Skelly can read yet/);
  assert.equal(bare.wanted, true);
  assert.match((await run(url, 'events', { [url]: { status: 403 } })).detail, /it answered 403/);
});

test('checkSource: a venue\'s own site leads to its platform page, or says why it cannot be read', async () => {
  const site = 'https://gym.example/';
  const viaReclub = await run(site, 'volleyball', { [site]: '<a href="https://reclub.co/clubs/@new-club">Join</a>', 'https://reclub.co/clubs/@new-club': fixture('reclub-club-austin-lawn-club.html'), 'https://reclub.co/m/5X380N': fixture('reclub-meet-5X380N.html') });
  assert.equal(viaReclub.status, 'ok');
  assert.equal(viaReclub.plan.slug, 'new-club');
  assert.equal((await run(site, 'volleyball', { [site]: '<a href="https://reclub.co/clubs/@vex_volleyball">Join</a>' })).status, 'have');
  assert.match((await run(site, 'pickleball', { [site]: '<a href="https://gym.podplay.app/book">Book</a>' })).detail, /is on PodPlay, which needs a sign-in/);
  const none = await run(site, 'volleyball', { [site]: '<p>Open gym Tuesdays</p>' });
  assert.match(none.detail, /no schedule on it that Skelly can read yet/);
  assert.equal(none.wanted, true);
});

test('applyPlan: writes only what the plan names, once, and the config still loads', () => {
  const files = { sources: readFileSync(new URL('../config/regions/austin/sources.json', import.meta.url), 'utf8'), events: readFileSync(new URL('../config/events.json', import.meta.url), 'utf8') };
  const a = applyPlan({ type: 'reclub', region: 'austin', sport: 'volleyball', slug: 'new-club' }, files);
  assert.equal(a.changed, true);
  assert.ok(JSON.parse(a.text).sources.find((s) => s.id === 'reclub').options.clubs.includes('https://reclub.co/clubs/@new-club'));
  assert.equal(applyPlan({ type: 'reclub', region: 'austin', sport: 'volleyball', slug: 'new-club' }, { ...files, sources: a.text }).changed, false);
  const s = JSON.parse(applyPlan({ type: 'sweatpals', region: 'austin', sport: 'volleyball', slug: 'newhost' }, files).text);
  assert.deepEqual(s.sources.find((x) => x.id === 'sweatpals').options.hosts.at(-1), { slug: 'newhost' });
  const m = JSON.parse(applyPlan({ type: 'meetup', region: 'austin', sport: 'volleyball', slug: 'atx-volley', name: 'ATX Volley', city: 'Austin' }, files).text);
  assert.deepEqual(m.sources.find((x) => x.id === 'austin-meetup').options.feeds.at(-1), { url: 'https://www.meetup.com/atx-volley/events/ical/', idPrefix: 'meetup-atx-volley', host: 'ATX Volley', city: 'Austin' });
  // A sport the region has no such source for yet gets its own, and the whole file still validates.
  const p = applyPlan({ type: 'reclub', region: 'austin', sport: 'pickleball', slug: 'dink-club', city: 'Austin' }, files);
  const added = JSON.parse(p.text).sources.at(-1);
  assert.deepEqual({ id: added.id, adapter: added.adapter, sport: added.sport, clubs: added.options.clubs }, { id: 'reclub-austin-pickleball', adapter: 'reclub', sport: 'pickleball', clubs: ['https://reclub.co/clubs/@dink-club'] });
  assert.doesNotThrow(() => resolveSources({ ...JSON.parse(p.text), defaults: { sport: 'volleyball', region: 'austin', timezone: 'America/Chicago' } }));
  const e = applyPlan({ type: 'events', region: 'austin', url: 'https://www.market.example/events' }, files);
  assert.deepEqual(JSON.parse(e.text).sources.at(-1), { id: 'added-market-example-austin', name: 'market.example', region: 'austin', added: true, urls: ['https://www.market.example/events'] });
  assert.equal(applyPlan({ type: 'events', region: 'austin', url: 'https://allevents.in/austin/markets' }, files).changed, false);
  assert.throws(() => applyPlan({ type: 'reclub', region: 'austin', sport: 'volleyball', slug: '../../x' }, files), RangeError);
  assert.throws(() => applyPlan({ type: 'events', region: 'austin', url: 'http://plain.example/' }, files), RangeError);
});

test('api/add-source: answers the check, saves through one issue only when it passed, and never sends the plan', async () => {
  const call = async (handler, body, method = 'POST') => { const res = { setHeader() {}, end(t) { this.text = t; } }; await handler({ method, body }, res); return { status: res.statusCode, json: JSON.parse(res.text) }; };
  const posted = [];
  const fetch = async (url, init) => { posted.push({ url, sent: JSON.parse(init.body) }); return new Response('{}', { status: 201 }); };
  const check = async ({ input }) => input === 'good' ? { status: 'ok', title: 'Added. Found 2 sessions coming up.', detail: 'Soon.', steps: [], found: 2, plan: { type: 'reclub' }, label: 'Reclub · @x' }
    : input === 'want' ? { status: 'no', title: "Couldn't add it.", detail: 'No reader yet.', steps: [], found: 0, wanted: true } : { status: 'no', title: "Couldn't add it.", detail: 'Nope.', steps: [], found: 0 };
  const h = createHandler({ token: 't', fetch, config: {}, check });
  const ok = await call(h, { input: 'good', target: 'volleyball', region: 'austin' });
  assert.deepEqual(ok.json, { status: 'ok', title: 'Added. Found 2 sessions coming up.', detail: 'Soon.', steps: [], found: 2, label: 'Reclub · @x', saved: true });
  assert.equal(posted[0].url, 'https://api.github.com/repos/bryanw121/schelagg/issues');
  assert.deepEqual(posted[0].sent.labels, ['add-source']);
  assert.match(posted[0].sent.body, /```json\n\{"input":"good","target":"volleyball","region":"austin"\}\n```/);
  await call(h, { input: 'want', target: 'events', region: 'austin' });
  assert.deepEqual(posted[1].sent.labels, ['source-request']);
  await call(h, { input: 'bad', target: 'events', region: 'austin' });
  assert.equal(posted.length, 2, 'a plain no files nothing');
  const unsaved = await call(createHandler({ token: '', fetch, config: {}, check }), { input: 'good', target: 'volleyball', region: 'austin' });
  assert.equal(unsaved.json.saved, false);
  assert.match(unsaved.json.title, /^It checks out: 2 found\./);
  assert.equal((await call(h, {}, 'GET')).status, 405);
  assert.equal((await call(createHandler({ token: 't', fetch, config: {}, check: async () => { throw new Error('boom'); }, log() {} }), { input: 'x', target: 'events', region: 'austin' })).status, 502);
});
