// Regions (#52): each city is a folder, config/regions/<id>/, holding everything about it.
//
//   region.json         id, name, timezone, center [lat, lng], radiusKm
//   sources.json        what to scrape there (lib/registry.js)
//   venues.json         canonical venues (lib/consolidate.js)
//   manual.json         hand-checked sessions
//   public-courts.json  free public courts (optional)
//   courts.json         Skedda court calendars (optional, lib/skedda.js)
//
// Adding a city is adding a folder. Ids (sources, venues) must be unique across all regions, so
// session ids and the feed stay unambiguous.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from './paths.js';

export const REGIONS_DIR = () => repoPath('config/regions');
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readOptional = (p, fallback) => (existsSync(p) ? readJson(p) : fallback);

/** Region ids, sorted. */
export function regionIds(dir = REGIONS_DIR()) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'region.json')))
    .map((d) => d.name).sort();
}

/** One region's region.json, checked. */
export function regionInfo(id, dir = REGIONS_DIR()) {
  const r = readJson(join(dir, id, 'region.json'));
  if (r.id !== id) throw new Error(`regions/${id}/region.json: id is "${r.id}", expected "${id}"`);
  if (!ID.test(id)) throw new Error(`regions: bad region id "${id}"`);
  try { new Intl.DateTimeFormat('en-US', { timeZone: r.timezone }); } catch { throw new Error(`regions/${id}: invalid timezone "${r.timezone}"`); }
  if (!Array.isArray(r.center) || r.center.length !== 2) throw new Error(`regions/${id}: center must be [lat, lng]`);
  return { id, name: r.name ?? id, timezone: r.timezone, center: r.center, radiusKm: r.radiusKm ?? 50 };
}

/** Everything about every region (or the listed ones): { info, dir, sources, venues, publicCourts, courts }. */
export function loadRegions({ dir = REGIONS_DIR(), only } = {}) {
  const ids = regionIds(dir).filter((id) => !only || only.includes(id));
  if (only) for (const id of only) if (!ids.includes(id)) throw new Error(`regions: no region "${id}"`);
  return ids.map((id) => {
    const d = join(dir, id);
    return {
      info: regionInfo(id, dir),
      dir: d,
      sources: readOptional(join(d, 'sources.json'), { sources: [] }),
      venues: readOptional(join(d, 'venues.json'), { venues: [] }).venues ?? [],
      publicCourts: readOptional(join(d, 'public-courts.json'), null),
      courts: readOptional(join(d, 'courts.json'), { venues: [] }).venues ?? [],
    };
  });
}

/** A region's file path, e.g. regionFile('austin', 'venues.json'). */
export const regionFile = (id, file, dir = REGIONS_DIR()) => join(dir, id, file);
