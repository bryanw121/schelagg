// The source registry: config/sources.json says which sources run and what they
// are (sport, region, time zone); this file maps adapter names to code.
//
// Adding a venue on a platform we already read (another Reclub club, another
// ACES page) is a config-only change. A new platform or site needs an adapter in
// scripts/adapters/ and one line in ADAPTERS below.
import { readFileSync } from 'node:fs';
import { repoPath } from './paths.js';
import * as volleyworld from '../scripts/adapters/volleyworld.mjs';
import * as aces from '../scripts/adapters/aces.mjs';
import * as atxbeach from '../scripts/adapters/atxbeach.mjs';
import * as velocity from '../scripts/adapters/velocity.mjs';
import * as reclub from '../scripts/adapters/reclub.mjs';

export const ADAPTERS = { volleyworld, aces, atxbeach, velocity, reclub };

const REQUIRED = ['sport', 'region', 'timezone'];

/** Read and check config/sources.json. Throws on anything malformed, before any scraping starts. */
export function loadSources(path = repoPath('config/sources.json')) {
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  return resolveSources(cfg);
}

/** Pure half of loadSources (unit tested): apply defaults and validate each entry. */
export function resolveSources(cfg) {
  const defaults = cfg.defaults ?? {};
  const seen = new Set();
  const sources = (cfg.sources ?? []).filter((s) => s.enabled !== false).map((s) => {
    if (!s.id) throw new Error('config: a source is missing "id"');
    if (seen.has(s.id)) throw new Error(`config: duplicate source id "${s.id}"`);
    seen.add(s.id);
    const adapter = ADAPTERS[s.adapter];
    if (!adapter) throw new Error(`config: source "${s.id}" uses unknown adapter "${s.adapter}"`);
    const resolved = { ...defaults, ...s, options: s.options ?? {}, adapter };
    for (const k of REQUIRED) if (!resolved[k]) throw new Error(`config: source "${s.id}" has no ${k}`);
    validTimeZone(resolved.timezone, s.id);
    return resolved;
  });
  const manual = cfg.manual ? { ...defaults, ...cfg.manual, id: 'manual' } : null;
  if (manual) validTimeZone(manual.timezone, 'manual');
  return { schemaVersion: cfg.schemaVersion, sources, manual };
}

function validTimeZone(tz, id) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
  catch { throw new Error(`config: source "${id}" has an invalid timezone "${tz}"`); }
}
