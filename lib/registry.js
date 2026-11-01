// The source registry: config/regions/<id>/sources.json says which sources run in each region
// and what they are (sport, cadence); region.json gives the region and its time zone. This file
// maps adapter names to code.
//
// Adding a venue on a platform we already read (another Reclub club, another ACES page) is a
// config-only change, and so is adding a city (a new regions/<id>/ folder, see lib/regions.js).
// A new platform or site needs an adapter in scripts/adapters/ and one line in ADAPTERS below.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { repoPath } from './paths.js';
import { loadRegions } from './regions.js';
import * as volleyworld from '../scripts/adapters/volleyworld.mjs';
import * as aces from '../scripts/adapters/aces.mjs';
import * as atxbeach from '../scripts/adapters/atxbeach.mjs';
import * as velocity from '../scripts/adapters/velocity.mjs';
import * as reclub from '../scripts/adapters/reclub.mjs';
import * as daysmart from '../scripts/adapters/daysmart.mjs';
import * as sweatpals from '../scripts/adapters/sweatpals.mjs';

export const ADAPTERS = { volleyworld, aces, atxbeach, velocity, reclub, daysmart, sweatpals };

const REQUIRED = ['sport', 'region', 'timezone'];

/** How often a source is scraped: '30m', '1h', '6h', '1d' ... -> milliseconds. */
export function cadenceMs(cadence = '30m') {
  const m = String(cadence).match(/^(\d+)(m|h|d)$/);
  if (!m || +m[1] <= 0) throw new Error(`config: bad cadence "${cadence}" (use e.g. 30m, 1h, 6h, 1d)`);
  return +m[1] * { m: 60e3, h: 3600e3, d: 864e5 }[m[2]];
}
export const DEFAULT_CADENCE = '30m';
export const MANUAL_CADENCE = '1d';

/**
 * Every region's sources, checked, as one list: { sources, manuals, manual, regions }.
 * Each source carries its region and time zone (from region.json) and a cadence. `manuals` has
 * one entry per region with a manual.json; `manual` is that entry when there's exactly one
 * region (older callers). `only` limits it to some regions. A path (string) reads one
 * sources.json the old way.
 */
export function loadSources(opts = {}) {
  if (typeof opts === 'string') return resolveSources(JSON.parse(readFileSync(opts, 'utf8')));
  const regions = loadRegions(opts);
  const sources = [], manuals = [];
  const seen = new Map();
  for (const r of regions) {
    const fixed = { region: r.info.id, timezone: r.info.timezone };
    const cfg = { ...r.sources, defaults: { ...(r.sources.defaults ?? {}), ...fixed } };
    const res = resolveSources(cfg, { fixed, baseDir: r.dir });
    for (const s of res.sources) {
      if (seen.has(s.id)) throw new Error(`config: source id "${s.id}" is in both ${seen.get(s.id)} and ${r.info.id}`);
      seen.set(s.id, r.info.id);
      sources.push(s);
    }
    if (res.manual) manuals.push(res.manual);
  }
  return { schemaVersion: 2, sources, manuals, manual: regions.length === 1 ? manuals[0] ?? null : null, regions: regions.map((r) => r.info) };
}

/**
 * Pure half of loadSources (unit tested): apply defaults and validate each entry. `fixed` values
 * (a region's id and time zone) win over the file; `baseDir` makes manual.file repo-relative.
 */
export function resolveSources(cfg, { fixed = {}, baseDir } = {}) {
  const defaults = cfg.defaults ?? {};
  const seen = new Set();
  const sources = (cfg.sources ?? []).filter((s) => s.enabled !== false).map((s) => {
    if (!s.id) throw new Error('config: a source is missing "id"');
    if (seen.has(s.id)) throw new Error(`config: duplicate source id "${s.id}"`);
    seen.add(s.id);
    const adapter = ADAPTERS[s.adapter];
    if (!adapter) throw new Error(`config: source "${s.id}" uses unknown adapter "${s.adapter}"`);
    const resolved = { cadence: DEFAULT_CADENCE, ...defaults, ...s, ...fixed, options: s.options ?? {}, adapter };
    for (const k of REQUIRED) if (!resolved[k]) throw new Error(`config: source "${s.id}" has no ${k}`);
    validTimeZone(resolved.timezone, s.id);
    cadenceMs(resolved.cadence);
    return resolved;
  });
  let manual = null;
  if (cfg.manual) {
    const file = baseDir ? relative(repoPath('.'), `${baseDir}/${cfg.manual.file}`).split('\\').join('/') : cfg.manual.file;
    manual = { cadence: MANUAL_CADENCE, ...defaults, ...cfg.manual, ...fixed, file, id: 'manual' };
    validTimeZone(manual.timezone, 'manual');
    cadenceMs(manual.cadence);
  }
  return { schemaVersion: cfg.schemaVersion, sources, manual };
}

function validTimeZone(tz, id) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
  catch { throw new Error(`config: source "${id}" has an invalid timezone "${tz}"`); }
}
