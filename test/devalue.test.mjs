import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nuxtData, unflatten } from '../lib/devalue.js';

test('plain objects, arrays and shared references', () => {
  const v = unflatten([{ a: 1, b: 2, c: 1 }, [3, 4], 'x', 7, 8]);
  assert.deepEqual(v, { a: [7, 8], b: 'x', c: [7, 8] });
  assert.equal(v.a, v.c); // one object, referenced twice
});

test('Nuxt reactivity wrappers unwrap to their values', () => {
  const v = unflatten([
    ['ShallowReactive', 1],
    { r: 2, ref: 4, shallow: 5, empty: 6, emptyFalse: 8, emptyNull: 11, emptyNum: 13 },
    ['Reactive', 3], { ok: 9 },
    ['Ref', 3],
    ['ShallowRef', 9],
    ['EmptyRef', 7], '_',
    ['EmptyRef', 10], true, 'false',
    ['EmptyShallowRef', 12], 'null',
    ['EmptyRef', 14], '0',
  ]);
  assert.deepEqual(v.r, { ok: true });
  assert.equal(v.ref, v.r);
  assert.equal(v.shallow, true);
  assert.equal(v.empty, undefined);
  assert.equal(v.emptyFalse, false);
  assert.equal(v.emptyNull, null);
  assert.equal(v.emptyNum, 0);
});

test('devalue built-ins: Date, Set, Map, null-prototype objects and special numbers', () => {
  const v = unflatten([
    { d: 1, s: 2, m: 5, n: 8, u: -1, nan: -3, inf: -4 },
    ['Date', '2026-10-25T00:00:00.000Z'],
    ['Set', 3, 4], 'a', 'b',
    ['Map', 6, 7], 'k', 42,
    ['null', 'x', 7],
  ]);
  assert.equal(v.d.toISOString(), '2026-10-25T00:00:00.000Z');
  assert.deepEqual([...v.s], ['a', 'b']);
  assert.equal(v.m.get('k'), 42);
  assert.equal(Object.getPrototypeOf(v.n), null);
  assert.equal(v.n.x, 42);
  assert.equal(v.u, undefined);
  assert.ok(Number.isNaN(v.nan));
  assert.equal(v.inf, Infinity);
});

test('cycles resolve without recursing forever', () => {
  const v = unflatten([{ self: 0, list: 1 }, [0]]);
  assert.equal(v.self, v);
  assert.equal(v.list[0], v);
});

test('bad payloads fail loudly', () => {
  assert.throws(() => unflatten({}), /not an array/);
  assert.throws(() => unflatten([{ a: 5 }]), /out of range/);
});

test('reads __NUXT_DATA__ from a real Reclub meet page', () => {
  const html = readFileSync(new URL('./fixtures/sources/reclub-meet-UEY4HO.html', import.meta.url), 'utf8');
  const root = nuxtData(html);
  const meet = root.data['meet-UEY4HO'].meet;
  assert.equal(meet.referenceCode, 'UEY4HO');
  assert.equal(meet.isCancelled, false); // ["EmptyRef", i] -> "false"
  assert.equal(meet.venue.name, 'Volleyworld');
  assert.equal(nuxtData('<html></html>'), null);
});

test('committed fixtures carry no personal data', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('./fixtures/sources/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${name}: email`);
    assert.doesNotMatch(text, /\b\d{3}[-. )]\s?\d{3}[-. ]\d{4}\b/, `${name}: phone number`);
    assert.doesNotMatch(text, /hostName|hostData|usersMap|participants|accessToken|"notes"|profileImage|avatar/i, `${name}: people fields`);
  }
});
