// Writes public/data/courts.json from the live Skedda calendars (High Point, Crossover, Treehouse).
// Runs every ~15 minutes on GitHub Actions. If a venue fails, keeps its last good copy marked stale.
import { readFile, writeFile } from 'node:fs/promises';
import { VENUES, loadVenue } from '../lib/skedda.js';
import { today } from '../lib/time.js';

const OUT = 'public/data/courts.json';
const DAYS = 14;
const from = today();
// Last good copy: the local file if present, otherwise what the live site is serving.
const prev = await readFile(OUT, 'utf8').then(JSON.parse).catch(async () => {
  if (!process.env.SITE_URL) return null;
  try { const r = await fetch(new URL('data/courts.json', process.env.SITE_URL.replace(/\/?$/, '/'))); return r.ok ? r.json() : null; }
  catch { return null; }
});

const results = await Promise.allSettled(VENUES.map((v) => loadVenue(v, from, DAYS)));
const venues = [], errors = [];
results.forEach((r, i) => {
  const v = VENUES[i];
  if (r.status === 'fulfilled') {
    venues.push(r.value);
    const courts = r.value.facilities.flatMap((f) => f.courts);
    console.log(`ok    ${v.id}: ${courts.length} courts, ${courts.filter((c) => c.days[from]?.length).length} booked today`);
  } else {
    errors.push({ venue: v.id, calendar: v.calendar, message: r.reason?.message || String(r.reason) });
    const old = prev?.venues?.find((x) => x.id === v.id);
    if (old) venues.push({ ...old, stale: true });
    console.log(`FAIL  ${v.id}: ${r.reason?.message}${old ? ' (kept last good copy)' : ''}`);
  }
});

await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), from, days: DAYS, venues, errors }) + '\n');
if (!venues.length) process.exitCode = 1; // nothing usable: fail the run so it shows up red
