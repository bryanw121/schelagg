// Property tests for dates, time zones and weekly recurrence (#44). The example tests sit around
// Nov 1, 2026; these draw hundreds of random dates (2024-2030, both DST changes included), times
// and zones from a seeded generator, so a failure always reproduces. No dependencies: a small
// mulberry32 generator instead of fast-check. Set PROPERTY_SEED to try another seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, dow, localDateTime, toHHMM } from '../lib/time.js';
import { localToIso, toOccurrences } from '../lib/occurrences.js';

const SEED = Number(process.env.PROPERTY_SEED ?? 20261120);
const RUNS = 400;
const ZONES = ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'America/Phoenix', 'America/Denver',
  'Europe/London', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Chatham'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gen = (r) => {
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (xs) => xs[int(0, xs.length - 1)];
  // A third of dates land on a US or EU DST change (or the day either side), where bugs live.
  const DST = ['2024-03-10', '2024-11-03', '2025-03-09', '2025-11-02', '2026-03-08', '2026-11-01', '2027-03-14', '2027-11-07',
    '2026-03-29', '2026-10-25', '2026-04-05', '2026-10-04'];
  const date = () => (r() < 0.35 ? addDays(pick(DST), int(-1, 1)) : addDays('2024-01-01', int(0, 7 * 365)));
  const time = () => toHHMM(int(0, 23) * 60 + pick([0, 15, 30, 45, int(0, 59)]));
  return { int, pick, date, time, zone: () => pick(ZONES) };
};
/** Run `prop(g, i)` RUNS times; on failure, name the seed and case so it can be replayed. */
function forAll(name, prop) {
  const g = gen(rng(SEED));
  for (let i = 0; i < RUNS; i++) {
    try { prop(g, i); } catch (e) { e.message = `${name}: case ${i} (PROPERTY_SEED=${SEED})\n${e.message}`; throw e; }
  }
}
/** Whether any instant shows `date time` on the clock in `zone` (false inside a spring-forward gap). */
function exists(date, time, zone) {
  const start = Date.parse(`${addDays(date, -1)}T00:00:00Z`);
  for (let ms = start; ms < start + 3 * 864e5; ms += 15 * 60e3) {
    const l = localDateTime(ms, zone);
    if (l.date === date && l.time.slice(0, 4) === time.slice(0, 4) && Math.abs(Number(l.time.slice(3)) - Number(time.slice(3))) < 15) return true;
  }
  return false;
}

test('property: addDays and daysBetween agree, and a week later is the same weekday', () => {
  forAll('dates', (g) => {
    const d = g.date(), n = g.int(-400, 400);
    const e = addDays(d, n);
    assert.match(e, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(addDays(e, -n), d);
    assert.equal(daysBetween(d, e), n);
    assert.equal(dow(addDays(d, 7 * g.int(-50, 50))), dow(d));
    assert.equal(dow(addDays(d, 1)), (dow(d) + 1) % 7);
    if (n > 0) assert.ok(e > d); // ISO dates sort as strings
  });
});

test('property: a local time turned into an instant reads back as the same local time, in any zone', () => {
  forAll('round trip', (g) => {
    const date = g.date(), time = g.time(), zone = g.zone();
    const iso = localToIso(date, time, zone);
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    const back = localDateTime(Date.parse(iso), zone);
    if (back.date === date && back.time === time) return;
    // Only a clock time that never happens (skipped when clocks spring forward) may come back
    // different, and then it lands later the same morning, never on another day.
    assert.equal(exists(date, time, zone), false, `${date} ${time} ${zone} -> ${iso} reads back as ${back.date} ${back.time}`);
    assert.equal(back.date, date);
    assert.ok(back.time > time);
  });
});

test('property: an instant shown in a zone and turned back gives the same instant (outside the fall-back hour)', () => {
  forAll('instant', (g) => {
    const zone = g.zone();
    const ms = Date.parse(`${g.date()}T00:00:00Z`) + g.int(0, 1439) * 60e3;
    const l = localDateTime(ms, zone);
    const again = Date.parse(localToIso(l.date, l.time, zone));
    // In the repeated hour two instants share one clock time; localToIso picks one of them.
    if (again !== ms) assert.equal(Math.abs(again - ms) <= 60 * 60e3 && Number.isInteger((again - ms) / (30 * 60e3)), true, `${new Date(ms).toISOString()} in ${zone}`);
  });
});

test('property: "24:00" is midnight at the end of the day', () => {
  forAll('midnight', (g) => {
    const date = g.date(), zone = g.zone();
    if (!exists(addDays(date, 1), '00:00', zone)) return; // a zone that skips midnight itself
    assert.equal(localToIso(date, '24:00', zone), localToIso(addDays(date, 1), '00:00', zone));
  });
});

test('property: a weekly session keeps its wall-clock time and weekdays across DST, and stays inside its season', () => {
  forAll('weekly', (g) => {
    const zone = g.zone();
    const days = DAY_NAMES.filter(() => g.int(0, 2) === 0);
    if (!days.length) days.push(g.pick(DAY_NAMES));
    const start = toHHMM(g.int(6, 21) * 60 + g.pick([0, 30])); // sessions don't start in the 2am gap
    const end = toHHMM(Math.min(toMin(start) + g.pick([60, 90, 120, 180]), 1440));
    const now = new Date(Date.parse(`${g.date()}T12:00:00Z`));
    const startsOn = g.int(0, 3) === 0 ? addDays(now.toISOString().slice(0, 10), g.int(0, 20)) : undefined;
    const validUntil = g.int(0, 3) === 0 ? addDays(now.toISOString().slice(0, 10), g.int(5, 40)) : undefined;
    const s = { id: 'p', sourceId: 'x', sport: 'volleyball', region: 'r', timezone: zone, title: 'T', venue: 'V', days, start, end, startsOn, validUntil };
    const horizonDays = g.int(7, 35);
    const occ = toOccurrences([s], { now, horizonDays });
    const ids = new Set();
    for (const o of occ) {
      const a = localDateTime(Date.parse(o.starts_at), zone);
      assert.equal(a.time, start, `${zone} ${o.id}`);
      assert.ok(days.includes(DAY_NAMES[dow(a.date)]), `${a.date} is a ${DAY_NAMES[dow(a.date)]}, not in ${days}`);
      if (startsOn) assert.ok(a.date >= startsOn);
      if (validUntil) assert.ok(a.date <= validUntil);
      const b = localDateTime(Date.parse(o.ends_at), zone); // ends on the clock time it says, "24:00" being next midnight
      assert.deepEqual([b.date, b.time], end === '24:00' ? [addDays(a.date, 1), '00:00'] : [a.date, end], `${zone} ${o.id} ends`);
      assert.ok(!ids.has(o.id), `duplicate id ${o.id}`);
      ids.add(o.id);
    }
    // And nothing is missed: one occurrence per matching day in the window.
    const from = localDateTime(now.getTime(), zone).date;
    let want = 0;
    for (let d = from; d <= addDays(from, horizonDays); d = addDays(d, 1)) {
      if (days.includes(DAY_NAMES[dow(d)]) && !(startsOn && d < startsOn) && !(validUntil && d > validUntil)) want++;
    }
    assert.equal(occ.length, want);
  });
});

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
