// Contract with vteam (#42): every row of our public feeds must still carry what vteam's imports
// read, with the same types. The keys and types live in test/contracts/vteam.json; a change that
// removes or renames one of them, or changes its type, fails here until FEED_VERSION is bumped
// (and vteam told). Feeds are built from real config (every region's hand-checked sessions) and
// captured source fixtures, the way the scrape builds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSources } from '../lib/registry.js';
import { tagSession } from '../lib/session.js';
import { FEED_VERSION as OCC_VERSION, toOccurrences } from '../lib/occurrences.js';
import { FEED_VERSION as PROGRAMS_VERSION, buildFeed } from '../lib/programs/feed.js';
import * as vw from '../scripts/adapters/volleyworld.mjs';
import * as daysmart from '../scripts/adapters/daysmart.mjs';
import { parseAces } from '../lib/programs/aces.js';
import { parseLeagueLab } from '../lib/programs/leaguelab.js';
import { parseNagva } from '../lib/programs/nagva.js';
import { parseTexasAO } from '../lib/programs/texasao.js';

const CONTRACT = JSON.parse(readFileSync(new URL('./contracts/vteam.json', import.meta.url), 'utf8'));
const text = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** The problems with `value` against a contract type ('string', 'date?', ...), or null. */
export function typeProblem(type, value, present) {
  const optional = type.endsWith('?');
  const t = optional ? type.slice(0, -1) : type;
  if (!present || value === null) return optional ? null : present ? 'is null' : 'is missing';
  const ok = {
    string: () => typeof value === 'string',
    number: () => typeof value === 'number' && Number.isFinite(value),
    boolean: () => typeof value === 'boolean',
    object: () => typeof value === 'object' && !Array.isArray(value),
    array: () => Array.isArray(value),
    date: () => typeof value === 'string' && DATE.test(value),
    instant: () => typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value)),
  }[t];
  if (!ok) return `has an unknown contract type "${type}"`;
  return ok() ? null : `should be ${t}, got ${JSON.stringify(value)}`;
}

/** Every mismatch of `obj` against `shape` ({ key: type }), as "<where>.<key> <problem>". */
export function check(shape, obj, where) {
  return Object.entries(shape).flatMap(([k, type]) => {
    const p = typeProblem(type, obj?.[k], obj != null && Object.hasOwn(obj, k));
    return p ? [`${where}.${k} ${p}`] : [];
  });
}

const NOW = new Date('2026-11-09T18:00:00Z');

function occurrencesFeed() {
  const { sources, manuals } = loadSources();
  const sessions = [];
  for (const m of manuals) sessions.push(...JSON.parse(text(`../${m.file}`)).sessions.map((s) => tagSession(s, m)));
  const src = (id) => sources.find((s) => s.id === id);
  sessions.push(...vw.parse(JSON.parse(text('./fixtures/sources/arketa-volleyworld-schedule.json'))).map((s) => ({ ...tagSession(s, src('volleyworld')), verifiedAt: '2026-10-25' })));
  const ice = JSON.parse(text('./fixtures/sources/daysmart-iceandfield-events.json'));
  sessions.push(...daysmart.parseEvents(ice.data ?? ice, src('ice-and-field').options).sessions.map((s) => ({ ...tagSession(s, src('ice-and-field')), verifiedAt: '2026-10-25' })));
  // A kept session from a source that failed, as vteam can receive it.
  sessions.push({ ...sessions.at(-1), id: 'kept-1', checkFailed: '2026-10-26' });
  const now = new Date('2026-10-25T17:00:00Z');
  return { feedVersion: OCC_VERSION, generatedAt: now.toISOString(), horizonDays: 28, occurrences: toOccurrences(sessions, { now, horizonDays: 28 }) };
}

function programsFeed() {
  const REGIONS = [{ id: 'austin', center: [30.2672, -97.7431], radiusKm: 60 }];
  const t = Date.parse('2026-11-09T01:00:00Z');
  const fx = (f) => text(`./fixtures/programs/${f}`);
  const results = [
    { id: 'aces', programs: parseAces(fx('aces-leagues.html'), { now: t, regions: REGIONS }) },
    { id: 'austinssc', programs: parseLeagueLab(fx('leaguelab-austinssc.html'), { site: 'https://austinssc.leaguelab.com', org: 'Austin SSC', now: t, regionId: 'austin', state: 'TX' }) },
    { id: 'nagva', programs: parseNagva(fx('nagva-tournaments.html'), { now: t, regions: REGIONS }) },
    { id: 'texasao', programs: parseTexasAO(fx('texasao-home.html'), fx('texasao-registration.html'), { now: t, regions: REGIONS }) },
  ];
  return buildFeed({ results, now: t });
}

for (const [name, build, version] of [['occurrences', occurrencesFeed, OCC_VERSION], ['programs', programsFeed, PROGRAMS_VERSION]]) {
  const c = CONTRACT[name];
  test(`contract (vteam): ${name}.json keeps the version vteam reads`, () => {
    assert.equal(version, c.feedVersion,
      `${name} FEED_VERSION changed: vteam's import expects ${c.feedVersion}. Update test/contracts/vteam.json and tell vteam before publishing.`);
  });

  test(`contract (vteam): every ${name} row has what vteam reads, with the same types`, () => {
    const feed = build();
    const rows = feed[name];
    assert.ok(rows.length >= 5, `expected a real feed to check, got ${rows.length} rows`);
    const problems = [...check(c.top, feed, name)];
    rows.forEach((r, i) => {
      problems.push(...check(c.row, r, `${name}[${i}] ${r.id}`));
      if (c.attributes) problems.push(...check(c.attributes, r.attributes, `${name}[${i}] ${r.id}.attributes`));
    });
    assert.deepEqual(problems.slice(0, 20), [], `${problems.length} rows break vteam's import`);
  });

  test(`contract (vteam): every ${name} key vteam reads is still produced somewhere`, () => {
    // A rename shows up here even when the old key was optional: nothing emits it any more.
    const rows = build()[name];
    const seen = new Set(rows.flatMap((r) => Object.keys(r)));
    assert.deepEqual(Object.keys(c.row).filter((k) => !seen.has(k)), []);
  });
}

test('contract (vteam): the type checker itself', () => {
  assert.equal(typeProblem('string', 'x', true), null);
  assert.equal(typeProblem('string?', null, true), null);
  assert.equal(typeProblem('string?', undefined, false), null);
  assert.equal(typeProblem('string', undefined, false), 'is missing');
  assert.equal(typeProblem('string', null, true), 'is null');
  assert.match(typeProblem('number?', '3', true), /should be number/);
  assert.equal(typeProblem('date', '2026-11-09', true), null);
  assert.match(typeProblem('date', '11/09/2026', true), /should be date/);
  assert.equal(typeProblem('instant', '2026-11-09T18:00:00.000Z', true), null);
  assert.match(typeProblem('instant', '2026-11-09', true), /should be instant/);
  assert.deepEqual(check({ a: 'string', b: 'array?' }, { b: 3 }, 'row'), ['row.a is missing', 'row.b should be array, got 3']);
});
