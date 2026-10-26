// lib/health.js: noticing sources that still scrape but changed what they send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessHealth, shapeOf, shapeUnion, fieldCoverage, contentHash, findingsMarkdown, judgeFix, HISTORY } from '../lib/health.js';
import * as atx from '../scripts/adapters/atxbeach.mjs';
import * as vel from '../scripts/adapters/velocity.mjs';

const REF = '2026-10-25';
const session = (i, extra = {}) => ({ id: `s${i}`, end: '21:00', price: '$10', level: 'All', venue: 'Gym', city: 'Austin',
  surface: 'indoor', type: 'Open play', capacity: 12, spotsLeft: 3, signup: { url: 'https://x.test' }, ...extra });
const sessions = (n, extra) => Array.from({ length: n }, (_, i) => session(i, extra));
const ok = (id, n, more = {}) => ({ id, ok: true, count: n, warnings: [], sessions: sessions(n), ...more });

/** Run assessHealth over a sequence of runs, threading the stored health through. */
function runs(...steps) {
  let prev = {};
  return steps.map((step) => {
    const r = assessHealth({ prev, ref: REF, manual: [], ...step });
    prev = r.health;
    return r;
  });
}

test('shapeOf lists nested key paths, merging array elements', () => {
  assert.deepEqual([...shapeOf({ a: { b: 1 }, c: [{ d: 2 }, { e: 3 }], f: null })].sort(),
    ['a', 'a.b', 'c[]', 'c[].d', 'c[].e', 'f']);
  assert.deepEqual(shapeUnion([{ x: 1 }, { y: { z: 2 } }]), ['x', 'y', 'y.z']);
  assert.deepEqual(shapeUnion([]), []);
});

test('fieldCoverage is the share of sessions with each field', () => {
  const c = fieldCoverage([session(1), session(2, { price: null, capacity: undefined }), session(3, { price: '' }), session(4)]);
  assert.equal(c.price, 0.5);
  assert.equal(c.capacity, 0.75);
  assert.equal(c.venue, 1);
  assert.deepEqual(fieldCoverage([]), {});
});

test('a first run has no baseline, so it reports no drift', () => {
  const [r] = runs({ results: [ok('vw', 14, { shape: ['a', 'b'], reads: ['a', 'b'] }), ok('atx', 2, { contentHash: 'h1' })] });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.health.sources.vw.counts, [14]);
  assert.deepEqual(r.health.sources.vw.shape, ['a', 'b']);
  assert.equal(r.health.sources.atx.contentHash, 'h1');
});

test('a sudden drop in sessions is reported once, forgotten on recovery, and reported again if it recurs', () => {
  const usual = Array.from({ length: 5 }, () => ({ results: [ok('vw', 14)] }));
  const [,,,,, drop, stillDown, back, dropAgain] = runs(...usual,
    { results: [ok('vw', 3)] }, { results: [ok('vw', 2)] }, { results: [ok('vw', 13)] }, { results: [ok('vw', 4)] });
  assert.equal(drop.fresh.length, 1);
  assert.equal(drop.fresh[0].kind, 'count');
  assert.match(drop.fresh[0].message, /returned 3 sessions; it usually returns about 14/);
  // Still low an hour later: still a finding, but not new.
  assert.equal(stillDown.findings.length, 1);
  assert.equal(stillDown.fresh.length, 0);
  assert.deepEqual(back.findings, []);
  assert.deepEqual(back.health.reported, []);
  assert.equal(dropAgain.fresh.length, 1);
});

test('normal swings and small sources are not drops', () => {
  const [,,, swing] = runs({ results: [ok('vw', 14)] }, { results: [ok('vw', 12)] }, { results: [ok('vw', 15)] }, { results: [ok('vw', 6)] });
  assert.deepEqual(swing.findings, []);
  const [,, small] = runs({ results: [ok('atx', 2)] }, { results: [ok('atx', 2)] }, { results: [ok('atx', 0)] });
  assert.deepEqual(small.findings, []);
  // History is capped.
  const many = runs(...Array.from({ length: HISTORY + 5 }, () => ({ results: [ok('vw', 14)] })));
  assert.equal(many.at(-1).health.sources.vw.counts.length, HISTORY);
});

test('a field every session had disappearing from all of them is reported', () => {
  const noCapacity = { ...ok('vw', 14), sessions: sessions(14, { capacity: undefined }) };
  const [, r] = runs({ results: [ok('vw', 14)] }, { results: [noCapacity] });
  assert.deepEqual(r.fresh.map((f) => [f.kind, f.key]), [['fields', 'vw:field:capacity']]);
  assert.match(r.fresh[0].message, /no session has `capacity` any more \(100% did last run\)/);
  // A field that was only sometimes there, or too few sessions to judge, isn't reported.
  const someNoPrice = { ...ok('vw', 4), sessions: [...sessions(2), ...sessions(2, { price: null })] };
  const [, r2] = runs({ results: [someNoPrice] }, { results: [{ ...ok('vw', 4), sessions: sessions(4, { price: null }) }] });
  assert.deepEqual(r2.findings, []);
  const [, r3] = runs({ results: [ok('vw', 2)] }, { results: [{ ...ok('vw', 2), sessions: sessions(2, { capacity: null }) }] });
  assert.deepEqual(r3.findings, []);
});

test('a key the adapter reads vanishing from the raw data is reported, with what replaced it', () => {
  const reads = ['name', 'max_capacity', 'hostName'];
  const [, r] = runs(
    { results: [ok('vw', 14, { reads, shape: ['id', 'max_capacity', 'name'] })] },
    { results: [ok('vw', 14, { reads, shape: ['capacity', 'id', 'name'] })] },
  );
  assert.equal(r.fresh.length, 1);
  assert.equal(r.fresh[0].kind, 'shape');
  assert.match(r.fresh[0].message, /no longer has `max_capacity`, which the adapter reads\. New keys: `capacity`/);
  // Keys the adapter doesn't read, or never saw (hostName), don't matter.
  const [, quiet] = runs(
    { results: [ok('vw', 14, { reads, shape: ['extra', 'max_capacity', 'name'] })] },
    { results: [ok('vw', 14, { reads, shape: ['max_capacity', 'name'] })] },
  );
  assert.deepEqual(quiet.findings, []);
});

test('a changed page is reported once per change', () => {
  const [, changed, same, changedAgain] = runs(
    { results: [ok('atx', 2, { contentHash: 'h1' })] },
    { results: [ok('atx', 2, { contentHash: 'h2' })] },
    { results: [ok('atx', 2, { contentHash: 'h2' })] },
    { results: [ok('atx', 2, { contentHash: 'h3' })] },
  );
  assert.equal(changed.fresh[0].kind, 'content');
  assert.deepEqual(same.findings, []);
  assert.equal(changedAgain.fresh.length, 1);
});

test('new warnings are reported once', () => {
  const [first, second, third] = runs(
    { results: [ok('reclub', 5, { warnings: ['reclub-AB12: no surface'] })] },
    { results: [ok('reclub', 5, { warnings: ['reclub-AB12: no surface', 'https://reclub.co/m/CD34: HTTP 404'] })] },
    { results: [ok('reclub', 5)] },
  );
  assert.deepEqual(first.fresh.map((f) => f.message), ['reclub-AB12: no surface']);
  assert.deepEqual(second.fresh.map((f) => f.message), ['https://reclub.co/m/CD34: HTTP 404']);
  assert.deepEqual(third.findings, []);
});

test('a failed run keeps the baseline and what was already reported', () => {
  const usual = Array.from({ length: 3 }, () => ({ results: [ok('vw', 14, { contentHash: 'h1' })] }));
  const [,,, drop, failed, stillLow] = runs(...usual,
    { results: [ok('vw', 2, { contentHash: 'h1' })] }, { results: [{ id: 'vw', ok: false }] }, { results: [ok('vw', 2, { contentHash: 'h1' })] });
  assert.equal(drop.fresh.length, 1);
  assert.deepEqual(failed.findings, []);
  assert.deepEqual(failed.health.sources.vw, { ...drop.health.sources.vw, failStreak: 1 });
  assert.deepEqual(failed.health.reported, ['vw:count']);
  // Still low after it recovers: not reported a second time.
  assert.equal(stillLow.findings.length, 1);
  assert.equal(stillLow.fresh.length, 0);
});

test('a source failing several scrapes in a row is reported once; one success resets the streak', () => {
  const fail = { results: [{ id: 'aces', ok: false, error: 'HTTP 403' }] };
  const [one, two, three, four, back, again] = runs(fail, fail, fail, fail, { results: [ok('aces', 2)] }, fail);
  assert.deepEqual([one, two].map((r) => r.findings.length), [0, 0]);
  assert.deepEqual(three.fresh.map((f) => [f.kind, f.key]), [['failing', 'aces:failing']]);
  assert.match(three.fresh[0].message, /has failed 3 scrapes in a row \(HTTP 403\)/);
  assert.equal(four.findings.length, 1);
  assert.equal(four.fresh.length, 0);
  assert.equal(back.health.sources.aces.failStreak, undefined);
  assert.deepEqual(back.findings, []);
  assert.equal(again.health.sources.aces.failStreak, 1);
});

test('hand-checked sessions: changed pages, unwatchable pages, and stale or missing verification', () => {
  const manual = [
    { id: 'sand', verifiedAt: '2026-10-20', sourceChanged: '2026-10-25', source: 'https://x.test/sand' },
    { id: 'park', verifiedAt: '2026-10-20', watchError: 'HTTP 500', source: 'https://x.test/park' },
    { id: 'league', verifiedAt: '2026-09-01' },
    { id: 'clinic' },
    { id: 'fine', verifiedAt: '2026-10-24' },
  ];
  const [r, again] = runs({ manual }, { manual });
  assert.deepEqual(r.fresh.map((f) => f.key), [
    'manual:sand:changed:2026-10-25', 'manual:park:watch', 'manual:league:stale:2026-09-01', 'manual:clinic:unverified',
  ]);
  assert.match(r.fresh[0].message, /^sand: its source page changed on 2026-10-25/);
  assert.equal(again.fresh.length, 0);
  // Re-verifying clears it.
  const [, cleared] = runs({ manual }, { manual: [{ ...manual[0], sourceChanged: undefined, verifiedAt: REF }] });
  assert.ok(!cleared.findings.some((f) => f.key.startsWith('manual:sand')));
});

test('findingsMarkdown lists new findings for the issue, and is empty when there are none', () => {
  assert.equal(findingsMarkdown([], REF), '');
  const md = findingsMarkdown([{ source: 'vw', kind: 'count', message: 'returned 2 sessions' }], REF);
  assert.match(md, /^Source changes noticed on 2026-10-25:/);
  assert.match(md, /- \*\*vw\*\* · Fewer sessions than usual: returned 2 sessions/);
});

test('page adapters hash only the schedule lines they depend on', () => {
  const page = 'Standard Open Play is 7 AM-6 PM Monday thru Friday.\n$20 Friday Night Open Play & Pizza from 7 PM-11 PM\nFollow us! 1,204 likes';
  const otherNoise = page.replace('1,204', '1,305');
  assert.equal(contentHash(atx.watchedText(page)), contentHash(atx.watchedText(otherNoise)));
  assert.notEqual(contentHash(atx.watchedText(page)), contentHash(atx.watchedText(page.replace('$20', '$25'))));
  const v = 'Season Dates: October 1 – December 18, 2026\nWednesday Open Play\nTime: 8PM – Midnight\nLevel: Beginner\nNewsletter signup below';
  assert.notEqual(contentHash(vel.watchedText(v)), contentHash(vel.watchedText(v.replace('Beginner', 'Advanced'))));
  assert.equal(contentHash(' a  b\n'), contentHash('a b'));
});

test('judgeFix: mergeable only when the fixed source is clean and nothing else broke', () => {
  const batch = [{ key: 'vw:shape:max_capacity', source: 'vw', kind: 'shape', message: 'gone' }, { key: 'manual:x:unverified', source: 'manual', kind: 'manual', message: 'x' }];
  const baselineSources = [{ id: 'vw', ok: true }, { id: 'reclub', ok: true }, { id: 'aces', ok: false }];
  const okSources = [{ id: 'vw', ok: true }, { id: 'reclub', ok: true }, { id: 'aces', ok: false, error: 'HTTP 403' }];
  const baseline = { reported: ['aces:failing'] };

  // Clean: manual findings and an already-failing source don't block.
  assert.deepEqual(judgeFix({ batch, baseline, baselineSources, verify: { sources: okSources, findings: [{ key: 'aces:failing', source: 'aces', kind: 'failing', message: 'm' }] } }),
    { mergeable: true, reasons: [] });

  // The finding is still there.
  const still = judgeFix({ batch, baseline, baselineSources, verify: { sources: okSources, findings: [{ key: 'vw:field:capacity', source: 'vw', kind: 'fields', message: 'no capacity' }] } });
  assert.equal(still.mergeable, false);
  assert.match(still.reasons[0], /vw · Field disappeared: no capacity/);

  // The fixed source fails, or another one that worked breaks.
  assert.match(judgeFix({ batch, baseline, baselineSources, verify: { sources: [{ id: 'vw', ok: false, error: 'boom' }, ...okSources.slice(1)], findings: [] } }).reasons[0], /vw still fails: boom/);
  assert.match(judgeFix({ batch, baseline, baselineSources, verify: { sources: [okSources[0], { id: 'reclub', ok: false, error: 'HTTP 500' }, okSources[2]], findings: [] } }).reasons[0], /reclub worked before the change and fails now/);

  // A new problem elsewhere (shared code) blocks too.
  assert.equal(judgeFix({ batch, baseline, baselineSources, verify: { sources: okSources, findings: [{ key: 'reclub:count', source: 'reclub', kind: 'count', message: 'dropped' }] } }).mergeable, false);

  // Page changes always need a person; a batch with nothing verifiable can't merge.
  assert.match(judgeFix({ batch: [...batch, { source: 'atx', kind: 'content', key: 'atx:content:h' }], baseline, baselineSources, verify: { sources: okSources, findings: [] } }).reasons[0], /atx: its page changed/);
  assert.match(judgeFix({ batch: [batch[1]], baseline, baselineSources, verify: { sources: okSources, findings: [] } }).reasons[0], /nothing in this batch can be verified/);
});
